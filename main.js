const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

const IS_MAC   = process.platform === 'darwin';
const IS_WIN   = process.platform === 'win32';
const IS_LINUX = process.platform === 'linux';

let mainWindow = null;
let reportWindow = null;
let tray = null;
let pollInterval = null;
let cachedUsage = null;
let cachedRawData = null;
let isMinimized = false;

const CONFIG_DIR = path.join(os.homedir(), '.fluxmeter');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// ── Config helpers ─────────────────────────────────────────────────────────────

function readConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (_) {}
  return {};
}

function writeConfig(data) {
  try {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to write config:', e.message);
  }
}

// ── Extract token from a parsed credentials object ────────────────────────────

function extractToken(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (obj?.claudeAiOauth?.accessToken) return obj.claudeAiOauth.accessToken;
  if (obj?.access_token) return obj.access_token;
  // Nested one level (some Claude Code versions)
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') {
      if (v?.claudeAiOauth?.accessToken) return v.claudeAiOauth.accessToken;
      if (v?.access_token) return v.access_token;
    }
  }
  return null;
}

// ── Token resolution (platform-aware) ─────────────────────────────────────────

async function getToken() {
  // 1. User-pasted token always wins
  const cfg = readConfig();
  if (cfg.access_token) return cfg.access_token;

  // 2. macOS — Keychain via `security` CLI
  if (IS_MAC) {
    try {
      const raw = execSync(
        'security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null',
        { encoding: 'utf8', timeout: 5000 }
      ).trim();
      if (raw) {
        try { return extractToken(JSON.parse(raw)) || (raw.length > 10 ? raw : null); }
        catch (_) { if (raw.length > 10) return raw; }
      }
    } catch (_) {}
  }

  // 3. Linux — ~/.claude/.credentials.json
  if (IS_LINUX) {
    const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
    try {
      if (fs.existsSync(credPath)) {
        return extractToken(JSON.parse(fs.readFileSync(credPath, 'utf8')));
      }
    } catch (_) {}
  }

  // 4. Windows — %APPDATA%\Claude\.credentials.json then home fallback
  if (IS_WIN) {
    const winPaths = [
      path.join(process.env.APPDATA || '', 'Claude', '.credentials.json'),
      path.join(os.homedir(), '.claude', '.credentials.json'),
      path.join(process.env.LOCALAPPDATA || '', 'Claude', '.credentials.json'),
    ];
    for (const p of winPaths) {
      try {
        if (fs.existsSync(p)) {
          const token = extractToken(JSON.parse(fs.readFileSync(p, 'utf8')));
          if (token) return token;
        }
      } catch (_) {}
    }
  }

  // 5. Generic fallback — works for WSL / any missed path
  const fallbackPath = path.join(os.homedir(), '.claude', '.credentials.json');
  try {
    if (fs.existsSync(fallbackPath)) {
      const token = extractToken(JSON.parse(fs.readFileSync(fallbackPath, 'utf8')));
      if (token) return token;
    }
  } catch (_) {}

  return null;
}

// ── Usage fetch ────────────────────────────────────────────────────────────────

async function fetchUsage() {
  const token = await getToken();
  if (!token) {
    mainWindow?.webContents.send('token-missing');
    return;
  }

  try {
    const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
      },
    });

    if (res.status === 429) {
      if (cachedUsage) mainWindow?.webContents.send('usage-update', { ...cachedUsage, stale: true });
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();

    const sessionLimit = data?.limits?.find(l => l.group === 'session');
    const weeklyLimit  = data?.limits?.find(l => l.group === 'weekly');

    // Detect model from local stats cache
    let model = 'Pro';
    try {
      const statsPath = path.join(os.homedir(), '.claude', 'stats-cache.json');
      const stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
      const modelKeys = Object.keys(stats?.modelUsage || {});
      if (modelKeys.length > 0) {
        const best = modelKeys.reduce((a, b) =>
          (stats.modelUsage[a]?.outputTokens ?? 0) >= (stats.modelUsage[b]?.outputTokens ?? 0) ? a : b
        );
        model = best
          .replace(/^claude-/, '')
          .replace(/-(\d)/, ' $1')
          .replace(/\b\w/g, c => c.toUpperCase());
      }
    } catch (_) {}

    const payload = {
      sessionPercent: sessionLimit?.percent ?? data?.five_hour?.utilization ?? null,
      resetsAt:       sessionLimit?.resets_at ?? data?.five_hour?.resets_at ?? null,
      weeklyPercent:  weeklyLimit?.percent ?? data?.seven_day?.utilization ?? null,
      model,
      stale: false,
      fetchedAt: Date.now(),
    };

    cachedUsage = payload;
    cachedRawData = data;
    mainWindow?.webContents.send('usage-update', payload);
  } catch (err) {
    console.error('Fetch error:', err.message);
    if (cachedUsage) {
      mainWindow?.webContents.send('usage-update', { ...cachedUsage, stale: true });
    } else {
      mainWindow?.webContents.send('fetch-error', err.message);
    }
  }
}

// ── Tray icon ─────────────────────────────────────────────────────────────────

// 16×16 green circle PNG (valid cross-platform)
const TRAY_ICON_B64 =
  'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAoklEQVQ4jWNgG' +
  'AXkACEE+f8MDAz/GRgY/jMwMPxHpv9jYGBgZGBg+E9OHqeBgYHhPwMDw38G' +
  'BgYGBgaG//8ZGP4zMDD8Z0AGDAz/GRj+MzAw/Ecm/2NgYPjPwMDwn4GBYT8D' +
  'A8N/BgYGBgaG//8ZGP4zMDD8Z2Bg+M/AwPCfgYHhPwMDw38GBoZ9DAwMDAwM' +
  'DP8ZGBgYGBj+MzAwMCAN/gcAqREP4SiMxLMAAAAASUVORK5CYII=';

// ── Window ────────────────────────────────────────────────────────────────────

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const winW = 220, winH = 320;

  const opts = {
    width: winW,
    height: winH,
    x: width - winW - 16,
    y: height - winH - 16,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`--platform=${process.platform}`],
    },
  };

  // macOS-only options
  if (IS_MAC) {
    opts.level = 'floating';
    opts.visibleOnAllWorkspaces = true;
    opts.visibleOnFullScreen = true;
  }

  // On Linux without a compositor, transparency may not work —
  // the renderer CSS has a solid fallback background for this case.
  if (IS_LINUX) {
    opts.backgroundColor = '#00000000';
  }

  mainWindow = new BrowserWindow(opts);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });

  // Keep window on top on all workspaces (Linux/Windows alternative)
  if (!IS_MAC) {
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
  }
}

function createTray() {
  let trayImg;
  try {
    trayImg = nativeImage.createFromDataURL(TRAY_ICON_B64);
  } catch (_) {
    trayImg = nativeImage.createEmpty();
  }

  tray = new Tray(trayImg);
  tray.setToolTip('FluxMeter');

  const menu = Menu.buildFromTemplate([
    {
      label: 'Show / Hide FluxMeter',
      click: () => {
        if (!mainWindow) return;
        mainWindow.isVisible() ? mainWindow.hide() : (mainWindow.show(), mainWindow.focus());
      },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);

  tray.setContextMenu(menu);
  tray.on('click', () => {
    if (!mainWindow) return;
    mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  });
}

// ── IPC handlers ───────────────────────────────────────────────────────────────

ipcMain.handle('save-token', async (_e, token) => {
  const cfg = readConfig();
  cfg.access_token = token.trim();
  writeConfig(cfg);
  await fetchUsage();
  return { ok: true };
});

ipcMain.handle('refresh-now', async () => {
  await fetchUsage();
  return { ok: true };
});

ipcMain.on('quit-app', () => app.quit());

ipcMain.on('open-report', () => {
  if (reportWindow && !reportWindow.isDestroyed()) {
    reportWindow.focus();
    return;
  }
  reportWindow = new BrowserWindow({
    width: 560,
    height: 620,
    minWidth: 480,
    minHeight: 500,
    title: 'FluxMeter — Usage Report',
    backgroundColor: '#13131f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  reportWindow.loadFile(path.join(__dirname, 'renderer', 'report.html'));
  reportWindow.on('closed', () => { reportWindow = null; });
});

ipcMain.handle('get-report-data', () => {
  let stats = null;
  try {
    const statsPath = path.join(os.homedir(), '.claude', 'stats-cache.json');
    stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
  } catch (_) {}

  return {
    usage: cachedUsage,
    raw: cachedRawData,
    stats,
    generatedAt: Date.now(),
  };
});

ipcMain.on('minimize-window', () => {
  if (!mainWindow) return;
  isMinimized = !isMinimized;
  mainWindow.setSize(isMinimized ? 120 : 220, isMinimized ? 44 : 320);
  mainWindow.webContents.send('toggle-minimized', isMinimized);
});

// ── App lifecycle ──────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow();
  createTray();
  mainWindow.webContents.once('did-finish-load', () => {
    fetchUsage();
    pollInterval = setInterval(fetchUsage, 60_000);
  });
});

app.on('window-all-closed', (e) => e.preventDefault());
app.on('before-quit', () => clearInterval(pollInterval));
