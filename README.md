# FluxMeter

A floating always-on-top desktop widget that monitors your Claude Pro/Max credit usage in real time.

![FluxMeter Widget](https://github.com/nsuhaas/FluxMeter/raw/main/preview.png)

## Features

- Live fuel-tank visualization — fills from bottom, color-coded by usage
- 5-hour session usage + weekly usage tracking
- Countdown timer to next credit reset
- Auto-detects your Claude model from local usage history
- Reads credentials directly from macOS Keychain — no token setup needed
- Collapses to a tiny pill when you want it out of the way
- Polls every 60 seconds, serves stale cache on rate limit

## Requirements

- macOS
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
| Minimize to pill | Click `—` in the header |
| Expand from pill | Click `↑` on the pill |
| Manual refresh | Click the status dot (bottom-left) |
| Quit | Click `✕` in the header, or right-click the menu bar icon → Quit |

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

FluxMeter reads your OAuth token from the macOS Keychain entry written by `claude auth login`. Nothing is stored inside the app — your token never touches the project folder.

If the widget shows a setup screen, run:

```bash
claude auth login
```

Then relaunch FluxMeter.

## Security

- Token is read-only from Keychain at runtime
- Only one outbound request: `GET https://api.anthropic.com/api/oauth/usage`
- `contextIsolation: true`, `nodeIntegration: false` in Electron
- No analytics, no telemetry, no third-party services
