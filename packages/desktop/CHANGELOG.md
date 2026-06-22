# Changelog

## [0.0.4] - 2026-06-22

### Added
- ntfy push notification service: session idle, waiting-input, and termination events
- ntfy settings page with enable toggle, server URL, topic, and test button
- File manager: copy/cut/paste files and directories
- File manager: drag-and-drop to move files between directories
- File manager: upload and download files from context menu and toolbar
- File manager: multi-select with Ctrl+click and Shift+click
- File manager: toast notifications for all operations (copy, paste, delete, rename, create)
- File manager: tree row height setting in appearance settings (24-48px slider)
- File manager: "Create session in this directory" in context menu
- File manager: image preview when selecting image files

### Fixed
- Android file manager long-press freeze: transparent touch overlay blocks native contextmenu
- Mobile user turn navigation showing system messages
- "Load from this turn" not working due to message truncation
- Mobile speech input icon rapid flickering
- Android browser tab switch losing latest messages
- Page refresh stuck at "load from this turn" position

## [0.0.3] - 2026-06-01

### Fixed
- Allow unsigned macOS desktop builds when Developer ID signing secrets are not configured.

## [0.0.2] - 2026-06-01

### Added
- Windows local installer script for testing the desktop app from a normal per-user installation.
- Claude child-process diagnostics for Windows session startup failures.

### Fixed
- Desktop startup health probe and allowed-host handling for Windows Tauri origins.

## [0.0.1] - 2026-06-01

### Added
- Disposable desktop release for validating CI artifacts, signing fallback, and release publishing.

## [0.1.0] - Unreleased

### Added
- Initial desktop app with setup wizard
- Bundled Bun runtime for running Yep Anywhere server
- Agent installation (Claude Code, Codex CLI)
- System tray with server management
- Auto-start and window state persistence
- Auto-updater support
