const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

let mainWindow = null;
let tray = null;
let pollInterval = null;
let cachedUsage = null;
let lastFetchTime = null;
let isMinimized = false;

const CONFIG_DIR = path.join(os.homedir(), '.fluxmeter');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// ── Token helpers ──────────────────────────────────────────────────────────────

function readConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
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

async function getToken() {
  // 1. Check local config first (user-pasted token)
  const cfg = readConfig();
  if (cfg.access_token) return cfg.access_token;

  // 2. macOS Keychain via keytar
  if (process.platform === 'darwin') {
    // Use macOS `security` CLI — more reliable than keytar in Electron context
    try {
      const raw = execSync(
        'security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null',
        { encoding: 'utf8', timeout: 5000 }
      ).trim();
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          // Claude Code stores token under claudeAiOauth.accessToken
          if (parsed?.claudeAiOauth?.accessToken) return parsed.claudeAiOauth.accessToken;
          if (parsed?.access_token) return parsed.access_token;
        } catch (_) {
          if (raw.length > 10) return raw;
        }
      }
    } catch (_) {}
  }

  // 3. ~/.claude/.credentials.json (Linux / WSL / macOS fallback)
  try {
    const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
    if (fs.existsSync(credPath)) {
      const creds = JSON.parse(fs.readFileSync(credPath, 'utf8'));
      if (creds.access_token) return creds.access_token;
      // Some versions nest it
      const vals = Object.values(creds);
      for (const v of vals) {
        if (v && typeof v === 'object' && v.access_token) return v.access_token;
      }
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
      if (cachedUsage) {
        mainWindow?.webContents.send('usage-update', { ...cachedUsage, stale: true });
      }
      return;
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();

    // Actual API shape: five_hour / seven_day / limits[]
    const sessionLimit = data?.limits?.find(l => l.group === 'session');
    const weeklyLimit  = data?.limits?.find(l => l.group === 'weekly');

    // Read actual model from Claude Code's local stats cache
    let model = 'Pro';
    try {
      const statsPath = path.join(os.homedir(), '.claude', 'stats-cache.json');
      const stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
      const modelKeys = Object.keys(stats?.modelUsage || {});
      if (modelKeys.length > 0) {
        // Pick the model with most output tokens (most actively used)
        const best = modelKeys.reduce((a, b) =>
          (stats.modelUsage[a]?.outputTokens ?? 0) >= (stats.modelUsage[b]?.outputTokens ?? 0) ? a : b
        );
        // Format: "claude-sonnet-4-6" → "Sonnet 4.6"
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
    lastFetchTime = Date.now();
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

// ── Tray icon (1×1 png fallback if no asset) ──────────────────────────────────

function createTrayIcon() {
  // Create a tiny colored circle as the tray icon
  const size = 16;
  // Use a simple colored square as fallback
  const img = nativeImage.createEmpty();
  return img;
}

// ── Window ────────────────────────────────────────────────────────────────────

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  const winW = 220;
  const winH = 320;

  mainWindow = new BrowserWindow({
    width: winW,
    height: winH,
    x: width - winW - 16,
    y: height - winH - 16,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    level: 'floating',
    visibleOnAllWorkspaces: true,
    visibleOnFullScreen: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('closed', () => { mainWindow = null; });
}

function createTray() {
  // Build a small 16×16 tray image programmatically
  const trayImg = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAbwAAAG8B8aLcQwAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAABUSURBVDiNY/z//z8DJYCJgUIwagCFgBIX+P//PyMjIyMjI2NjYyMjI2NjYyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIw0AAPkECgEUSmIAAAAASUVORK5CYII='
  );

  tray = new Tray(trayImg);
  tray.setToolTip('FluxMeter');

  const menu = Menu.buildFromTemplate([
    {
      label: 'Show / Hide FluxMeter',
      click: () => {
        if (!mainWindow) return;
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
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

ipcMain.on('minimize-window', () => {
  if (!mainWindow) return;
  isMinimized = !isMinimized;
  if (isMinimized) {
    mainWindow.setSize(120, 44);
  } else {
    mainWindow.setSize(220, 320);
  }
  mainWindow.webContents.send('toggle-minimized', isMinimized);
});

// ── App lifecycle ──────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow();
  createTray();

  // Initial fetch after window loads
  mainWindow.webContents.once('did-finish-load', () => {
    fetchUsage();
    pollInterval = setInterval(fetchUsage, 60_000);
  });
});

app.on('window-all-closed', (e) => {
  // Keep app alive — tray icon stays
  e.preventDefault();
});

app.on('before-quit', () => {
  clearInterval(pollInterval);
});
