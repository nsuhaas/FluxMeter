# FluxMeter

FluxMeter is a lightweight desktop widget for macOS that shows you how much of your Claude Pro/Max credit you've used — in real time, always visible on your screen.

Think of it like a fuel gauge for your AI usage. If you're a heavy Claude user, you've probably hit the rate limit mid-conversation with no warning it was coming. FluxMeter sits in the corner of your screen and gives you a live heads-up so you can pace yourself.

![FluxMeter Widget](https://github.com/nsuhaas/FluxMeter/raw/main/preview.png)

## Built With

- **Electron** — wraps the app as a native macOS desktop window, always on top, with a system tray icon
- **Node.js** — handles credential reading, API polling, and window management in the background
- **HTML / CSS / SVG** — the entire UI is vanilla web tech; the fuel tank, wave animation, and color transitions are all pure SVG and CSS
- **macOS Keychain** — where your Claude OAuth token lives; read securely at runtime via the `security` CLI
- **Anthropic OAuth API** — the single endpoint that returns your live session and weekly usage data
- **Electron IPC + contextBridge** — safely passes data between the Node.js backend and the browser UI without exposing Node APIs to the renderer

No frameworks, no bundlers, no build step — just vanilla web tech inside Electron.

## Features

- Live fuel-tank visualization — fills from bottom, color-coded by usage
- 5-hour session usage + weekly usage tracking
- Countdown timer to next credit reset
- Auto-detects your Claude model from local usage history
- Reads credentials directly from macOS Keychain — no token setup needed
- Collapses to a tiny pill when you want it out of the way
- Polls every 60 seconds, serves stale cache on rate limit
- **Usage Report** — detailed breakdown window with charts and token stats

## Requirements

- macOS, Windows, or Linux
- [Claude Code](https://claude.ai/code) installed and authenticated via `claude auth login`
- Node.js

## Installation

```bash
git clone https://github.com/nsuhaas/FluxMeter.git
cd FluxMeter
npm install
```

## Usage

```bash
npm start
```

The widget appears in the bottom-right corner of your screen. It reads your OAuth token automatically from the macOS Keychain — no configuration needed.

### Controls

| Action | How |
|---|---|
| Move | Drag the widget anywhere |
| Open usage report | Click `📊` in the header |
| Minimize to pill | Click `—` in the header |
| Expand from pill | Click `↑` on the pill |
| Manual refresh | Click the status dot (bottom-left) |
| Quit | Click `✕` in the header, or right-click the menu bar icon → Quit |

### Usage Report

Click the **📊** button to open a detailed report window showing:

- **Current Usage** — 5-hour session and 7-day weekly progress bars with exact reset timestamps
- **All-Time Summary** — total messages, sessions, output and input token counts
- **Model Breakdown** — per-model token usage table with your primary model highlighted
- **Daily Activity** — bar chart of the last 14 days of message counts

![FluxMeter Report](https://github.com/nsuhaas/FluxMeter/raw/main/preview-report.png)

### Status dot colors

| Color | Meaning |
|---|---|
| 🟢 Green | Live data |
| 🟡 Yellow | Cached (rate limited) |
| 🔴 Red | Error |

## Tank colors

| Remaining | Color |
|---|---|
| 50–100% | Green |
| 25–50% | Yellow |
| 10–25% | Orange |
| 0–10% | Red (pulsing) |

## Authentication

FluxMeter reads your OAuth token automatically — nothing needs to be configured manually.

| Platform | Token location |
|---|---|
| macOS | Keychain (via `security` CLI) |
| Linux | `~/.claude/.credentials.json` |
| Windows | `%APPDATA%\Claude\.credentials.json` |

If the widget shows a setup screen, run:

```bash
claude auth login
```

Then relaunch FluxMeter.

## Linux Notes

Glassmorphism (blur effect) requires a compositor such as [picom](https://github.com/yshui/picom). Without one, the widget falls back to a solid dark background — everything still works.

## Windows Notes

Run from **PowerShell** or **Windows Terminal**. The widget appears in the bottom-right corner and a tray icon appears in the system tray.

## Security

- Token is read-only from Keychain at runtime
- Only one outbound request: `GET https://api.anthropic.com/api/oauth/usage`
- `contextIsolation: true`, `nodeIntegration: false` in Electron
- No analytics, no telemetry, no third-party services
