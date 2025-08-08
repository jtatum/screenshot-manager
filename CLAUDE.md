# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Screenshot Manager is a Mac desktop application built with Tauri 2 + React + TypeScript. It scans the user's Desktop directory for screenshot files, displays them in a gallery interface, and allows quick deletion with mouse/keyboard shortcuts. The app supports undo functionality by moving files to trash and restoring them.

## Architecture

### Frontend (React + TypeScript)
- **Single Page App**: `src/App.tsx` contains the main gallery interface
- **State Management**: Uses React hooks for local state (no external state library)
- **Tauri Integration**: Uses `@tauri-apps/api/core` for backend communication via `invoke()`
- **Key Features**: Grid gallery, keyboard navigation (arrow keys), sorting, undo with toast notifications

### Backend (Rust + Tauri)
- **File Operations**: `src-tauri/src/lib.rs` contains three main Tauri commands:
  - `list_screenshots()`: Scans Desktop directory, filters by screenshot naming patterns
  - `delete_to_trash()`: Moves files to system trash, maintains undo stack
  - `undo_last_delete()`: Restores files from trash with collision handling
- **Screenshot Detection**: Pattern matching for macOS screenshot names ("Screen Shot", "Screenshot", etc.)
- **Platform Specific**: Uses `objc2` for macOS-specific file operations

### Key Data Flow
1. Frontend calls `invoke("list_screenshots")` with sort options
2. Rust scans Desktop directory, filters screenshot files, returns metadata
3. React renders gallery with thumbnails using `convertFileSrc()`
4. User interactions (delete/undo) call respective Tauri commands
5. Backend maintains undo stack for restoration functionality

## Development Commands

### Setup and Development
```bash
npm install                    # Install all dependencies
npm run tauri dev             # Run desktop app with hot reload (port 1420)
npm run dev                   # Run web UI only (for rapid UI development)
```

### Testing
```bash
npm test                      # Run all tests (frontend + Rust)
npm run test:ui               # Frontend tests only (Vitest)
npm run test:rust             # Rust tests only (Cargo)
npm run test:watch            # Frontend tests in watch mode
```

### Building
```bash
npm run tauri build           # Create desktop app bundle + DMG
npm run build                 # Build web assets only
```

### Single Test Execution
```bash
# Frontend: Use Vitest filtering
npx vitest run --reporter=verbose --run src/__tests__/App.test.tsx

# Rust: Use Cargo test filtering  
cargo test --manifest-path src-tauri/Cargo.toml [test_name] -- --test-threads=1
```

## Important Configuration

### Port Configuration
- **Fixed Port**: Vite dev server uses port `1420` (strictPort: true)
- **HMR**: Port `1421` for hot module replacement
- **Environment**: Set `TAURI_DEV_HOST` for LAN development

### Test Configuration
- **Frontend**: Vitest with jsdom environment, React Testing Library
- **Rust**: Single-threaded test execution (`--test-threads=1`) to avoid file system conflicts
- **CI**: Tests include 100ms DOM settling delays for keyboard navigation reliability

### Platform Dependencies
- **macOS Only**: Uses `objc2` crates for native file operations
- **Tauri v2**: Latest stable, requires platform-specific system dependencies

## Key Implementation Details

### Screenshot Detection Logic
The `is_screenshot_name()` function identifies screenshot files by:
- Name patterns: "Screen Shot", "Screenshot", variations with unicode characters
- File extensions: .png, .jpg, .jpeg, .heic, .tiff, .gif, .bmp
- Case-insensitive matching

### Undo System
- **Stack-based**: `UNDO_STACK` maintains deletion history using `parking_lot::Mutex`
- **Collision Handling**: Restored files get " (restored)" suffix if original path exists
- **Metadata Preservation**: Tracks original and trashed paths for restoration

### Keyboard Navigation
- **Arrow Keys**: Navigate between screenshot thumbnails
- **Delete/Backspace**: Delete selected screenshots
- **Cmd+Z**: Undo last deletion batch
- **Test Reliability**: CI tests use DOM settling delays before keyboard events

## Test Notes

### Frontend Tests
- Located in `src/__tests__/App.test.tsx`
- Mock Tauri `invoke()` calls for isolated testing
- Test keyboard navigation, deletion workflows, error handling
- Use 100ms delays before keyboard events for CI reliability

### Rust Tests
- Embedded in `src-tauri/src/lib.rs` as `#[cfg(test)]` modules
- Test screenshot name detection, sorting, trash operations
- Use temporary directories and mock file systems
- Single-threaded execution prevents file system race conditions