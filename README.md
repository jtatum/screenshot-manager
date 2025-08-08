# Screenshot Manager (Tauri + React + TypeScript)

[![CI](https://github.com/jtautm/ssmanager/actions/workflows/ci.yml/badge.svg)](https://github.com/jtautm/ssmanager/actions/workflows/ci.yml)

A desktop app built with Tauri 2, Vite, React, and TypeScript for managing screenshots on your machine.

## Quick Start

1) Install dependencies

```bash
npm install
```

2) Run the desktop app in development

```bash
npm run tauri dev
```

This starts Vite on `http://localhost:1420` and launches the Tauri window with HMR.

3) Run the web UI only (no Tauri shell)

```bash
npm run dev
```

Serves the UI at `http://localhost:1420`.

## Build

- Desktop bundle (via Tauri):

```bash
npm run tauri build
```

- Static web build only:

```bash
npm run build
```

## Testing

- All tests (frontend + Rust):

```
npm test
```

- Frontend only:

```
npm run test:ui
```

- Rust (backend) only:

```
npm run test:rust
```

## Prerequisites

- Node.js and npm
- Rust toolchain (for Tauri): `rustup` with a recent stable toolchain
- Platform prerequisites for Tauri 2 (Xcode CLTs on macOS, etc.)

## Project Structure

- `src/`: React frontend
- `src-tauri/`: Tauri Rust backend (commands and configuration)
- `vite.config.ts`: Dev server config (fixed port `1420`)

## Troubleshooting

- Port `1420` must be free (`strictPort: true`). Stop anything else using it.
- If the Tauri CLI is missing, it’s already in `devDependencies`; ensure `npm install` completes successfully.
- Set `TAURI_DEV_HOST` if you need HMR over your LAN (see `vite.config.ts`).

## Recommended IDE Setup

- VS Code + Tauri extension + rust-analyzer
