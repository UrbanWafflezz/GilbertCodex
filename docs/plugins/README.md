# Plugin Marketplace Notes

Last updated: May 25, 2026 for the v0.8.2 build.

Gilbert Codex now treats plugins as a marketplace-backed surface inside Apps instead of only hand-built first-party cards.

## What Gilbert Is Doing

Gilbert Codex plugins are marketplace entries that point at plugin folders. A plugin can bundle:

- `skills/` for reusable workflow instructions.
- `.app.json` for hosted app or connector mappings.
- `.mcp.json` for bundled MCP server configuration.
- hooks and assets for richer install surfaces.

Gilbert loads an upstream public plugin catalog in Apps so users can discover broad plugin bundles without us manually recreating every card.

## What Gilbert Can Actually Run

Gilbert should only mark a plugin usable when there is a real local execution route:

- Native route: Gmail, Google Calendar, and GitHub continue using Gilbert's app-owned auth and tool bridge.
- MCP route: plugins such as LinkedIn, Figma, Stripe, Vercel, Notion, Linear, Atlassian, Cloudflare, Supabase, and Sentry map to curated MCP presets, then reuse Save, Test, secure storage, and chat MCP tools.
- Skill route: plugins with bundled `SKILL.md` files can import those skills into Gilbert's local skill registry.
- Registry route: app-only marketplace entries search the public MCP Registry for a runnable server replacement.

v0.8.2 expands the MCP route with more cloud, hosting, database, browser/search, repo, observability, and local-context presets. It also lets setup forms use Settings > Keys for non-model credentials, secret HTTP headers, secret query params, bearer tokens, and stdio env values without returning those values to chat.

Hosted `.app.json` connector IDs are not enough for Gilbert to call tools directly. Those IDs depend on another hosted connector runtime, so the app must not claim them as live tools unless a native or MCP implementation exists.

## Sources Checked

- Codex plugin docs: plugins bundle skills, app integrations, and MCP servers; marketplace files live under repo or personal `.agents/plugins/marketplace.json`.
- Public plugin repo: `openai/plugins` contains the upstream curated marketplace and plugin manifests.
- MCP docs: remote MCP servers and connectors expose tools through list/call flows.
- MCP Registry docs: the public registry is the official metadata and install-hint source for publicly accessible MCP servers.
