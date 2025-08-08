# Screenshot Manager

[![CI](https://github.com/jtatum/ssmanager/actions/workflows/ci.yml/badge.svg)](https://github.com/jtatum/ssmanager/actions/workflows/ci.yml)

A tiny, fast Mac app for quickly managing screenshots on your desktop. View all your screenshots in one place and delete them instantly with mouse clicks or keyboard shortcuts.

## The Story

If you're like me, when you take a screenshot on Mac, you'll use it for whatever you need and then forget about it. At least, until you notice that your desktop has dozens of ancient, useless screenshots. 

I wanted a way to quickly go through them and delete the screenshots I don't need anymore. That's why I made this, and why I made it fast - it's a tiny app and has keyboard shortcuts for really quick reviews and deletes. 

Let's clean! 🧹

**Built with:** Tauri 2 + React + TypeScript

## Download & Install

1. **Download the latest release:**
   - Go to [Releases](https://github.com/jtatum/screenshot-manager/releases)
   - Download `Screenshot.Manager_x.x.x_universal.dmg` 

2. **Install:**
   - Open the DMG file
   - Drag Screenshot Manager to your Applications folder
   - Launch from Applications or Spotlight

3. **First run:**
   - macOS will ask you to acknowledge the app came from the internet (click "Open")
   - Grant permission to read your Desktop when prompted
   - **Optional:** For quick keyboard undo (Cmd+Z), grant Full Disk Access in System Settings → Privacy & Security → Full Disk Access
   - If you skip Full Disk Access, the app will help you recover files from Trash using Finder instead

## How to Use

- **Navigate:** Use WASD keys or arrow keys to select screenshots
- **Delete:** Press X, Delete, or Backspace to move unwanted screenshots to trash
- **Undo:** Press Cmd+Z to restore accidentally deleted screenshots
- **Sort:** Change sorting by date, name, or size using the dropdown

The app automatically scans your Desktop for screenshot files and shows them in a clean gallery view.

---

## For Developers

### Development Setup

1) Install dependencies

```bash
npm install
```

2) Run the desktop app in development

```bash
npm run tauri dev
```

This starts Vite on `http://localhost:1420` and launches the Tauri window with HMR.

### Build

- Desktop bundle (via Tauri):

```bash
npm run tauri build
```

- Static web build only:

```bash
npm run build
```

### Testing

- All tests (frontend + Rust):

```
npm test
```

- Frontend only:

```bash
npm run test:ui
```

- Rust (backend) only:

```bash
npm run test:rust
```

### Prerequisites

- Node.js and npm
- Rust toolchain (for Tauri): `rustup` with a recent stable toolchain
- Platform prerequisites for Tauri 2 (Xcode CLTs on macOS, etc.)

### Project Structure

- `src/`: React frontend
- `src-tauri/`: Tauri Rust backend (commands and configuration)
- `vite.config.ts`: Dev server config (fixed port `1420`)

### Troubleshooting

- Port `1420` must be free (`strictPort: true`). Stop anything else using it.
- If the Tauri CLI is missing, it’s already in `devDependencies`; ensure `npm install` completes successfully.
- Set `TAURI_DEV_HOST` if you need HMR over your LAN (see `vite.config.ts`).

### Recommended IDE Setup

- VS Code + Tauri extension + rust-analyzer
