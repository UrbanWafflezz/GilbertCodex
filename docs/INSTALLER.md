# Installer, Release, And Updates

Gilbert Codex ships as a Tauri NSIS setup executable for Windows x64. The installer is meant for customer-style distribution: it installs the desktop app, creates shortcuts, checks the required WebView2 runtime, and uses branded light/dark-safe installer artwork.

## Build The Installer

Run this from the repo root on Windows:

```powershell
npm.cmd run app:installer
```

The script regenerates the NSIS bitmap artwork, builds the React frontend, compiles the Tauri host, and writes the setup executable under:

```text
src-tauri\target\release\bundle\nsis\
```

On Windows, the native helper may shorten Cargo's target directory to avoid long path issues. In that case, the local test installer is written under:

```text
C:\gcn\release\bundle\nsis\
```

Use `npm.cmd run app:build` when you only need the normal Tauri bundle without regenerating installer artwork. On macOS and Linux, `npm run app:build` dispatches to the native app/DMG or deb/AppImage build instead of the Windows installer path.

## Build An Auto-Update Release

Automatic updates require a signed updater bundle and a `latest.json` release asset. The normal local installer script intentionally does not create those artifacts because Tauri requires the private updater signing key at build time.

For a release-capable local build, set the updater signing key in the current PowerShell session and run:

```powershell
$keyPath = "C:\Users\you\.tauri\gilbert-codex.key"
$env:TAURI_SIGNING_PRIVATE_KEY=$keyPath
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
npm.cmd run app:release
```

The generic `app:release` script dispatches by host OS: Windows builds the NSIS updater release, macOS builds app/DMG updater artifacts, and Linux builds deb/AppImage updater artifacts. Windows merges `src-tauri/tauri.updater.conf.json`; macOS and Linux use `src-tauri/tauri.macos.updater.conf.json` and `src-tauri/tauri.linux.updater.conf.json` so updater artifacts keep the same platform-specific bundle settings as normal local builds.

The GitHub `Release` workflow builds the Windows NSIS installer, macOS app/DMG artifacts, and Linux deb/AppImage artifacts with the updater config. If Apple Developer signing and notarization secrets are not configured, macOS artifacts are still uploaded as ad-hoc signed, unnotarized DMG/app updater artifacts. The workflow reads the release body from `docs/releases/<tag>.md` when that file exists, computes SHA-256 checksum files for the downloadable artifacts, and uploads the packages, `.sha256` files, updater signatures, and merged `latest.json` feed to GitHub Releases.

The official product repo is private, so GitHub Releases are no longer the public updater endpoint. On tag releases, the workflow downloads the private release assets, rewrites `latest.json` to point at Firebase Storage URLs, creates `manifest.json` for the website, and uploads public files to:

```text
gs://gilbertcodex-40428.firebasestorage.app/releases/latest.json
gs://gilbertcodex-40428.firebasestorage.app/releases/manifest.json
gs://gilbertcodex-40428.firebasestorage.app/releases/<tag>/
```

The desktop app checks the Firebase Storage `latest.json` URL, and the website reads the matching manifest for its download buttons. Manual workflow dispatches still create draft GitHub releases for review. Tag pushes are the path that publishes the public Firebase download/update feed.

Add these repository secrets before publishing any updater release:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` when the key is password-protected
- `GCP_RELEASE_SERVICE_ACCOUNT_KEY` as a Google service-account JSON key with Storage Object Admin access to the Firebase release bucket

The official private line uses the updater public key embedded in `src-tauri/tauri.conf.json`. Keep the matching private key and password in a password manager and in GitHub Actions secrets. The local working copy can keep emergency copies under `.local-secrets/`, which is ignored by Git. If that private key or password is lost, installed builds that trust this public key cannot receive future signed updates.

Add these additional repository secrets before publishing trusted, notarized macOS release artifacts:

- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_ID`
- `APPLE_PASSWORD`
- `APPLE_TEAM_ID`
- `KEYCHAIN_PASSWORD`

The older public-repo workflow can restore a private release overlay. The official private repo should usually already contain the product-only app code, so the overlay step is a fallback rather than the normal product path. If the workflow is run from a source tree that does not include `src/toolBridge/index.ts`, the overlay can contain:

```text
src/toolBridge/
plugins/
.agents/plugins/
```

`src/toolBridge/index.ts` is required for release builds and is committed directly to the private official repo. Optional plugin bundles can still live in `plugins/` or `.agents/plugins/` when they are meant to ship with the product build.

The release workflow does not require GitHub OAuth, Google OAuth, provider-key, or other app-user credentials. GitHub and Google OAuth setup is entered by each user in Settings, and provider keys stay in local app storage. Do not add app-user OAuth client secrets, tokens, downloaded Google credential JSON, provider keys, private account data, or local databases to release variables.

The current macOS local bundle config uses ad-hoc signing (`signingIdentity = "-"`) so builds can still be inspected without Apple credentials. The GitHub Release workflow publishes ad-hoc signed, unnotarized macOS artifacts until a Developer ID Application certificate and Apple notarization secrets are available.

Offline dictation is prepared during the Windows release build. The workflow downloads and verifies the Whisper `ggml-base.en.bin` model, prepares pinned LLVM/libclang and Vulkan SDK assets under `.tools`, and builds with the `offline-dictation-gpu` feature so the packaged Windows app can use bundled offline voice input without committing the large model or SDK to the public repository. macOS and Linux release jobs build the standard desktop feature set and still bundle the prepared model resource through the shared Tauri build hook.

## What The Installer Includes

- The compiled Gilbert Codex desktop executable.
- The built React frontend from `dist`.
- Bundled Rust-side runtime dependencies, including SQLite through `rusqlite`'s bundled feature.
- Offline dictation resources prepared during the build, including the verified Whisper model bundled as a Tauri resource.
- App icons, Windows shortcut metadata, publisher metadata, homepage metadata, and the repository license page.
- A WebView2 runtime check. If WebView2 is missing or older than the configured minimum, the installer downloads and runs Microsoft's bootstrapper silently.
- A selectable install scope so the user can install for the current account or system-wide.

## What Stays Local

Provider API keys, OAuth client secrets, GitHub tokens, Discord settings, local accounts, logs, local databases, workspace files, local scan artifacts, release signing credentials, and updater private keys are not bundled into public installers. Those are created or connected by the user after installation or used only by GitHub Actions during packaging.

## Light And Dark Mode

The installer artwork uses a split light/dark visual treatment so the setup flow looks intentional on either Windows theme. Inside the app, Gilbert Codex defaults to the system theme and can be pinned to Light or Dark from Settings > Appearance.

## Release Checklist

Before publishing an installer:

1. Bump `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json` to the release version.
2. Run `npm.cmd run check`.
3. Run `npm.cmd run audit:prod`.
4. Run `npm.cmd run app:release`, or run the GitHub `Release` workflow for the tagged version.
5. Confirm GitHub Releases includes the Windows setup executable, macOS DMG/app updater archive, Linux deb/AppImage, matching `.sha256` files, matching `.sig` files, and the private-release `latest.json`.
6. Confirm Firebase Storage includes public `releases/latest.json`, `releases/manifest.json`, and `releases/<tag>/...`.
7. Confirm the public `latest.json` points at Firebase Storage URLs, not private GitHub release URLs.
8. Confirm the website download buttons read from `releases/manifest.json`.
9. Confirm the SHA-256 values in `docs/releases/<tag>.md` match the uploaded `.sha256` files after the final workflow run.
10. Launch the packaged app from a real install on Windows, macOS, and Linux before calling those platforms verified.
11. Use the in-app update checker against the published Firebase Storage feed.
12. Update `docs/releases/<tag>.md` with file names, sizes, checksums, signing/notarization status, updater feed status, validation status, and known limits before pushing the release tag.

The Windows installer is still unsigned unless a release build is produced with a valid code-signing configuration. Unsigned builds can trigger SmartScreen warnings.
