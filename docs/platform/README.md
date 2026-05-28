# Platform Support And Porting Notes

This document tracks what is known about running Gilbert Codex on Windows, macOS, and Linux.

Last updated: May 28, 2026 for the v0.8.5 build.

## Current Support State

| Platform | Status | Notes |
| --- | --- | --- |
| Windows x64 | Verified alpha | The current public release and local verification were done on Windows with a Tauri NSIS customer installer. |
| macOS arm64/x64 | Release workflow ready, Apple notarization pending, native launch unverified | Frontend platform detection, Mac shortcut labels, left-side traffic-light window controls, Keychain-backed secure storage, app/DMG build scripts, macOS Rust CI, native desktop command-path coverage, 9Router native tool-path checks, and GitHub Actions release jobs are in place. Release artifacts are ad-hoc signed and unnotarized until Apple Developer signing/notarization secrets are configured, and a maintainer still needs to run the packaged app and complete the native QA checklist before this becomes verified support. |
| Linux x64 | Release workflow ready, pending native launch verification | Tauri, terminal shell selection, npm scripts, Secret Service-backed secure storage, ngrok path handling, native desktop command-path coverage, 9Router native tool-path checks, deb/AppImage packaging config, Linux Rust CI, and GitHub Actions release jobs are in place. The desktop app still needs someone on Linux to run the package and finish native QA before this becomes verified support. |

The macOS and Linux port is intentionally marked launch-unverified. The codebase and release workflow should no longer be Windows-locked, but native desktop behavior needs real OS coverage before the project should promise fully verified support.

## What Has Been Ported

- Windows installer configuration now includes branded NSIS artwork, installer/uninstaller icons, WebView2 runtime checks, install-scope selection, Start menu grouping, license metadata, and downgrade blocking.
- Tauri build hooks use cross-platform `npm run ...` commands instead of Windows-only `npm.cmd`.
- Tauri bundle scripts are platform-specific: Windows uses NSIS, macOS uses the `app` and `dmg` targets with `src-tauri/tauri.macos.conf.json`, and Linux uses the `deb` and `appimage` targets with `src-tauri/tauri.linux.conf.json`.
- Platform updater release scripts keep those same native bundle settings through `src-tauri/tauri.macos.updater.conf.json` and `src-tauri/tauri.linux.updater.conf.json` instead of merging only the generic updater flag.
- `npm run app:build` and `npm run app:release` dispatch to the native host's desktop build or updater-release script instead of assuming Windows.
- The GitHub `Release` workflow builds Windows first, then macOS Apple Silicon/Intel, then Linux x64 so updater metadata is merged without parallel upload races. macOS artifacts use ad-hoc signing when Apple Developer signing/notarization secrets are not configured.
- Tag releases publish the public website/updater feed to Firebase Storage after the private GitHub release artifacts exist. The installed app checks Firebase Storage instead of a private GitHub URL.
- Official product builds use the hosted Cloud Run 9Router gateway for subscription routes, so normal users do not need Docker or a local subscription runtime to use Free, Plus trial, or Pro routing.
- Main and detached chat windows use Tauri window-state persistence so the next launch restores the user's last size, screen position, maximized state, and fullscreen state instead of forcing a fresh maximize.
- First-launch window defaults are centered, resizable, constrained to the working area, and sized to fit common laptop and snapped-window layouts.
- The desktop terminal host code supports PowerShell/cmd on Windows and Bash/Zsh/sh on macOS and Linux, with macOS zsh/bash interactive sessions started as login shells so Homebrew and user shell paths behave like Terminal.
- macOS secure secrets use Keychain through the native `security` tool.
- Linux secure secrets use the freedesktop Secret Service path through `secret-tool`, with native desktop PATH recovery for GUI launches, so Debian/Ubuntu packages depend on `libsecret-tools`.
- The frontend renders Mac-appropriate shortcut labels and window controls when the host platform is macOS.
- Shared native command resolution covers GUI-launched macOS/Linux helper processes such as Git, MCP stdio package runners, `open`, `xdg-open`, and Linux `secret-tool`.
- Native terminal, browser preview, file picker, source context, MCP stdio servers, and packaging behavior still need OS-specific verification.
- ngrok setup accepts a generic executable path instead of assuming `ngrok.exe`, expands `~` paths, and uses the shared native command resolver so packaged macOS/Linux app launches can still find Homebrew, MacPorts, Volta/asdf/nvm, user-bin, Flatpak/Snap, and system-path installs.
- Subscriptions/9Router source install and startup use the same native command resolver for Git, Node, npm, Docker status, and port cleanup tools. macOS checks Homebrew, MacPorts, Docker Desktop, Volta/asdf/nvm/user bins, and system paths; Linux checks user bins, Volta/asdf/nvm, Flatpak/Snap, sbin, and system paths.
- Browser automation uses a platform-appropriate user agent.
- Setup docs now use cross-platform `npm` commands, with a Windows `npm.cmd` note where useful.

## Windows Packaging

Use this command on Windows to build the customer installer:

```powershell
npm.cmd run app:installer
```

See [Windows Installer](../INSTALLER.md) for the bundled dependency notes, release checklist, and signing status.

## What Still Needs Native Testers

Someone with access to macOS and Linux should verify:

- `npm install`
- `npm run dev`
- `npm run app:dev:macos`
- `npm run check`
- `npm run app:build:macos`
- `npm run app:release:macos`
- `npm run app:release`
- `cargo test --manifest-path src-tauri/Cargo.toml terminal`
- `cargo test --manifest-path src-tauri/Cargo.toml ngrok`
- `cargo test --manifest-path src-tauri/Cargo.toml nine_router`
- `cargo test --manifest-path src-tauri/Cargo.toml native_path`
- `cargo test --manifest-path src-tauri/Cargo.toml mcp`
- First launch, local account creation, sign-in, and local app storage.
- File picker, selected workspace roots, file indexing, read/write/delete safeguards, and full-computer scope behavior.
- Terminal execution, browser preview, local Git, GitHub, MCP stdio servers, and source-context behavior.
- Terminal startup and command execution for Bash, Zsh, and sh.
- GitHub device-flow login, token persistence, repository reads, branch creation, API commits, pull request creation, release helpers, and workflow actions.
- Discord slash-command bridge startup, ngrok discovery, interaction validation, and response editing.
- Subscriptions/9Router install, auto-start, account sign-in, Free Auto routing, local/LAN URLs, tunnel toggle, and uninstall.
- Hosted 9Router routing, Firebase-authenticated billing refresh, Plus trial entitlement, and model picker gates.
- Desktop notifications and permission prompts.
- Browser preview panel and local dev-server URL detection.
- Packaged app launch from the generated macOS or Linux artifact.

## macOS Notes

Expected baseline:

- Node.js 18 or newer for the Gilbert app; Node.js 20 or newer for installing the local Subscriptions/9Router source runtime.
- Rust and Cargo.
- Xcode Command Line Tools.
- Tauri 2 prerequisites for macOS from the official Tauri docs.

Useful commands:

```bash
npm install
npm run app:dev:macos
npm run check
npm run app:build:macos
npm run app:release
./scripts/macos-verify.sh
```

`scripts/macos-verify.sh` requires Node.js 20+, npm, Git, and ngrok. If ngrok is installed outside the recovered GUI-app `PATH`, set `GILBERT_NGROK_PATH=/full/path/to/ngrok` before running the script and use that same path in Settings > Discord during packaged-app QA.

Potential follow-up work:

- Confirm the custom traffic-light window chrome works correctly in dev and packaged app windows.
- Keep Apple Developer signing and notarization secrets configured in GitHub before presenting macOS as a fully trusted public download. Local macOS bundles still use ad-hoc signing when those credentials are not available.
- Verify whether `zsh`, `bash`, and `sh` shells should all remain visible in the terminal selector.
- Validate app data paths, Keychain prompts, file picker permissions, notifications, and security prompts.

## Linux Notes

Expected baseline:

- Node.js 18 or newer for the Gilbert app; Node.js 20 or newer for installing the local Subscriptions/9Router source runtime.
- Rust and Cargo.
- Tauri 2 Linux system dependencies, including WebKitGTK and appindicator/tray-related packages where required by the target distribution.
- `libsecret-tools` and a Secret Service provider such as GNOME Keyring or KWallet for MCP bearer tokens and other OS-backed secrets.

Useful commands:

```bash
npm install
npm run app:dev
npm run check
npm run app:build:linux
npm run app:release:linux
npm run app:release
./scripts/linux-verify.sh
```

`scripts/linux-verify.sh` requires Node.js 20+, npm, Git, and ngrok. If ngrok is installed outside PATH, set `GILBERT_NGROK_PATH=/full/path/to/ngrok` before running the script and use that same path in Settings > Discord during packaged-app QA.

Potential follow-up work:

- Document exact package install commands for Ubuntu/Debian, Fedora, and Arch after real testing.
- Verify Wayland and X11 behavior.
- Validate WebKitGTK version requirements and packaging output.
- Confirm file picker behavior, notifications, shell execution, Secret Service prompts, MCP stdio servers, source-control helpers, and browser preview behavior across common desktops.

## Port Completion Checklist

Before calling macOS or Linux officially supported:

- A maintainer or contributor runs the full checklist on the real OS.
- Any native runtime fixes are merged.
- Packaging artifacts are generated on that OS and launched outside the dev environment.
- Known limitations are recorded in release notes.
- Checksums are published for new release artifacts.
- Firebase Storage `releases/latest.json` and `releases/manifest.json` are public and point at the current release files.
- The README and website download sections are updated from private/internal release status to the official public download flow.

## Reporting Results

When testing macOS or Linux, include:

- OS name and version.
- CPU architecture.
- Node, npm, Rust, Cargo, and Tauri CLI versions.
- The exact command that failed.
- Relevant terminal output with secrets removed.
- Screenshots for UI, file picker, notification, or packaging issues.
