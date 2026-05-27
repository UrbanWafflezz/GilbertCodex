# Gilbert Codex Promo Assets

This folder contains a lightweight promotional scene for sharing Gilbert Codex as a source-available desktop agent workspace with a protected UI, tool system, and brand.

Last reviewed for the v0.8.2 release prep on May 25, 2026. Recapture the screenshots after major composer, chat workspace, subscription, image-generation, voice, Apps, MCP, Keys, or settings UI changes so the public README does not drift behind the app.

## Outputs

- `../assets/github/gilbert-codex-social-preview.png`: primary GitHub README banner and social preview artwork.
- `../assets/readme/gilbert-codex-overview.png`: focused chat workspace screenshot.
- `../assets/readme/gilbert-codex-chat-progress.png`: chat thread with live progress, sources, approvals, and activity state.
- `../assets/readme/gilbert-codex-settings.png`: General settings screenshot.
- `../assets/readme/gilbert-codex-provider-settings.png`: AI and Providers screenshot with subscription model routing.
- `../assets/readme/gilbert-codex-subscriptions.png`: Subscriptions setup screenshot.
- `../assets/github/gilbert-codex-github-logo.png`: square GitHub-ready Source Compass logo.
- `../assets/brand/gilbert-codex-source-compass-icon.png`: source PNG used to regenerate desktop app icon sizes.
- `promo.html`: optional source scene for generating a longer standalone promo video outside release assets.

## Refreshing The README Screenshots

Start the local app first:

```powershell
npm.cmd run dev -- --host localhost --port 1420
```

Then run:

```powershell
$env:GILBERT_CODEX_DEMO_WORKSPACE = "C:\Projects\GilbertCodex"
node docs/promo/capture-readme-assets.mjs
```

The capture script seeds a browser-only demo account and writes contributor-safe screenshots under `docs/assets/readme/`.
Use `GILBERT_CODEX_CAPTURE_URL` to point at a different local dev server and `GILBERT_CODEX_DEMO_WORKSPACE` to control the demo path shown in screenshots.
It requires Playwright and a Chromium-based browser in the local tooling environment; they stay out of the production app dependencies.

## Optional Standalone Video

The renderer uses Playwright to open the HTML scene and record the canvas animation with the browser's built-in WebM encoder.

```bash
node docs/promo/render-promo-video.mjs
```

If Playwright is not available in the local environment, install it outside the app runtime or run the scene manually in a Chromium-based browser and use a screen recorder. This promo tooling is intentionally kept out of the production dependency graph. The command is platform-neutral, but the generated video should still be checked locally after renderer or browser changes.

## GitHub Sharing Notes

GitHub READMEs are friendlier to images than repo-hosted video tags. Keep release assets focused on installable builds and checksums. Use the social preview banner plus current screenshots in README copy, and only attach standalone video to issues, discussions, or social posts when needed. These screenshots and promo assets are Reserved Materials under the repository license.
