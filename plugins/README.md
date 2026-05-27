# Gilbert Codex Plugins

Last updated: May 25, 2026 for the v0.8.2 build.

This folder is the canonical home for Gilbert Codex plugin bundles. Every plugin must live in its own subfolder and keep its files scoped to that folder unless a shared registry explicitly needs an update.

## Folder Contract

- Use `plugins/<plugin-name>/` for every plugin.
- Keep plugin names lower-case and hyphenated.
- Keep `.codex-plugin/plugin.json` as the required manifest.
- Keep optional integrations beside the manifest as `.app.json`, `.mcp.json`, `skills/`, `assets/`, `scripts/`, or `hooks.json`.
- Add one focused `README.md` inside each plugin folder when product behavior, safety rules, or setup details matter.
- Keep `.agents/plugins/marketplace.json` aligned with real plugin folders only.

## Engineering Rules

- Treat plugin code as production code because plugins can touch private user data and external services.
- Start with read-only behavior, then add write actions behind explicit review and confirmation flows.
- Do not expose destructive actions without a visible confirmation step and an audit trail.
- Keep comments single-line, professional, and reserved for non-obvious behavior.
- Avoid stale placeholders in manifests once a plugin is shown in the app UI.
- Keep auth scopes narrow and document why each scope exists before requesting it.
- Validate all tool inputs server-side, even when the model generated the arguments.

## First-Party Plugins

- `gmail`: Gmail workflow foundation for inbox reading, organization, draft creation, and review-before-send behavior.
- `google-calendar`: Google Calendar workflow foundation for agenda review, availability checks, meeting prep, and review-gated scheduling behavior.
- `github`: GitHub workflow foundation for local Git, repositories, completed-issue discovery, full issue lifecycle, pull request reviews, releases, Actions jobs/artifacts, security alerts, notifications, stats, tags, semantic discovery, and approval-gated writes.
- `linkedin`: LinkedIn profile setup, authenticated self-profile reads, user-supplied profile research briefs, and post draft review through a compliant local MCP server.

## Marketplace Expansion

`.agents/plugins/marketplace.json` keeps these first-party plugins local and adds upstream public marketplace entries as `git-subdir` sources pointing at `https://github.com/openai/plugins.git`.

Those remote entries make the broader Codex-style catalog discoverable without vendoring all plugin folders into this repo. Gilbert still only treats a plugin as runnable after one of its real routes is configured: native app install, MCP save/test, registry-backed MCP setup, or local skill import.
