# MCP Support

Last updated: May 28, 2026 for the v0.8.5 build.

Gilbert Codex supports Model Context Protocol servers through the Apps page.

The desktop app currently supports both standard MCP transports:

- `https://...` remote endpoints
- `http://localhost`, `http://127.0.0.1`, and `http://[::1]` development endpoints
- optional bearer-token authentication stored through the app's OS-backed secure storage
- secret HTTP query parameters for providers such as Browserbase
- custom HTTP header secrets for providers such as Context7
- command-line stdio servers launched as subprocesses
- stdio command arguments, working directories, and environment variables

Configured servers are saved per local Gilbert user. Bearer tokens, HTTP query secrets, custom header secrets, and stdio environment values are not returned to the React UI or chat tools; the UI only sees whether a secret exists. Non-model service credentials can be saved once in Settings > Keys, then applied to MCP setup fields from the Apps page. The Keys preset catalog also covers common skill, app, and service credentials such as GitHub, Google OAuth, Discord, Slack, Sentry, Mapbox, ngrok, Firebase, and browser/search services. Model-provider keys remain in the model/provider settings surfaces instead of the Keys catalog.

## Stdio Servers

Many MCP servers are installed as command-line tools. Add these from Apps > MCP with transport set to `Stdio`:

- `Command`: executable to launch, such as `node`, `python`, `uvx`, or `npx`
- `Arguments`: one argument per line, such as the server script path or package command args
- `Working directory`: optional folder used as the subprocess current directory
- `Environment`: `NAME=value` lines, with values protected through secure storage

The desktop backend keeps a running stdio subprocess per configured server while the app is open, initializes MCP over stdin/stdout once, sends `notifications/initialized`, then reuses that process for `tools/list` and `tools/call`. This preserves server-owned state for workflows such as Firebase deploy job IDs. The cached process is restarted when the server config changes, the server is removed, or the subprocess exits. Stderr is captured only for diagnostics, because MCP stdio servers must write only JSON-RPC messages to stdout.

Stdio startup/list/call waits up to 90 seconds so first-run package downloads and provider sign-in bridges have enough time to initialize.

The Apps MCP dialog uses a streaming test command for setup checks. While a package-backed server starts, Gilbert shows live startup steps and npm/uvx stderr lines so users can see first-run downloads, OAuth bridge messages, and initialization progress instead of waiting on a silent spinner.

Visible MCP output is sanitized before it is returned to chat or setup progress. OAuth callback URLs have temporary values such as `code`, `state`, and token query parameters redacted so a provider redirect like `http://localhost:9005/?code=...` is not echoed back as a secret.

Firebase is launched through `npx`, so fallback login guidance uses `npx.cmd -y firebase-tools@latest login --reauth` on Windows instead of requiring a global `firebase` executable. Do not prefer `--no-localhost` on normal desktop installs; Firebase's remote auth-proxy flow can fail before the code is returned, while the local login flow starts a callback server on the user's machine.

The Firebase MCP `firebase_login` tool is hidden/blocked by Gilbert because it uses Firebase's auth-proxy URL (`auth.firebase.tools/login?...`) and can return `Unable to verify client`. When terminal tools are available, the assistant should run `npx.cmd -y firebase-tools@latest login --reauth` itself and ask the user only to finish the Google browser consent. If terminal tools are unavailable, show that exact command as the manual fallback. After the shared Firebase CLI credential store is authenticated, the Firebase MCP server can be retried.

## Chat Tools

When MCP is enabled in tool settings and the request asks for MCP or external connected tools, the runtime can attach:

- `mcp_list_servers` to inspect configured servers and cached tool names
- `mcp_list_tools` to initialize one server and refresh its `tools/list` schema
- `mcp_call_tool` to call one server tool with JSON object arguments

The selector also treats well-known MCP-backed service names such as Firebase, GoDaddy Domains, Figma, Supabase, AWS, Azure, GitLab, GitHub MCP, Linear, LinkedIn, Stripe, Atlassian, Vercel, Netlify, Heroku, Pulumi, Neon, Notion, Cloudflare, Context7, Brave Search, Exa, Firecrawl, Tavily, Apify, Browserbase, Redis, MongoDB, Postgres, Slack, Filesystem, Memory, Sequential Thinking, Playwright, Puppeteer, JetBrains, Sentry, and Kubernetes as MCP-intent prompts when MCP tools are enabled. This lets a user ask for the service naturally without having to say "MCP" first.

GoDaddy's official Domains MCP endpoint is included as a public read-only preset for domain search and availability checks. It does not purchase domains, update DNS records, change nameservers, or manage account settings. For a GoDaddy domain on Firebase Hosting, Gilbert should use Firebase MCP or terminal evidence for the Hosting deploy and custom-domain records, then clearly state the GoDaddy DNS changes that still need to be made in GoDaddy or through a separate GoDaddy Domains API integration.

Tool discovery is treated as a read operation so the model can list configured servers and schemas before deciding what to call. `mcp_call_tool` uses the same app-owned permission path as other external actions. The model should list servers and tools before calling a tool unless the exact server id, tool name, and input schema are already known.

## Registry Discovery

Apps > MCP includes a registry-backed discovery surface. It searches the official MCP Registry through the desktop backend, normalizes remote endpoints and npm/PyPI stdio packages into Gilbert's existing server form, and then reuses the same save, test, secure-storage, and chat-tool path as manually configured servers.

Gilbert supports up to 50 configured MCP servers. This keeps the UI and cached tool inventory manageable while allowing a serious local workspace to keep the major daily services installed.

Featured presets are provided for Firebase, GoDaddy Domains, Figma Remote/Desktop, Supabase, AWS, Azure, GitLab, GitHub MCP, Linear, LinkedIn, Stripe, Atlassian, Vercel, Netlify, Heroku, Pulumi, Neon, Notion, Cloudflare API/Docs/Browser, Context7, Brave Search, Exa, Firecrawl, Tavily, Apify, Browserbase, Redis, MongoDB, Postgres, Slack, Filesystem, Memory, Sequential Thinking, Playwright, Puppeteer, JetBrains IDE, Sentry, and Kubernetes. These presets only prefill configuration; users still review, save, and test the server before chat can call its tools.

The Apps page presents MCPs as individual cards: configured server cards, a custom add-server card, featured preset cards, and registry result cards. The page also includes a Test all action that iterates through enabled servers and runs `tools/list` against each one, updating cached tool schemas and surfacing failures per server.

Remote Registry results are configured through the standard `mcp-remote` stdio bridge by default. Gilbert's direct HTTP transport can send bearer tokens, but the bridge gives OAuth-based providers such as Figma, Linear, Notion, Vercel, and GitLab a working browser sign-in path today.

The featured catalog and registry results are paginated in Apps > MCP so the page can keep growing without becoming a wall of cards.

For stdio MCP servers, Gilbert resolves common desktop runtime paths before spawning. On Windows, a saved `npx` command is resolved to `npx.cmd` from PATH or common Node.js install folders. On macOS and Linux, packaged-app launches include common Homebrew, MacPorts, Volta/asdf/nvm, user-bin, Flatpak/Snap, and system paths so npm- and Python-based MCP servers do not require users to paste absolute launcher paths.

## Protocol Notes

The implementation follows MCP JSON-RPC flows for Streamable HTTP and stdio:

- Streamable HTTP posts JSON-RPC requests to the configured endpoint.
- HTTP sends `MCP-Protocol-Version: 2025-03-26`, accepts `application/json` and `text/event-stream`, and preserves `Mcp-Session-Id` from server responses when present.
- Stdio launches the server as a subprocess, writes one JSON-RPC message per newline to stdin, and reads newline-delimited JSON-RPC responses from stdout.
- Both transports initialize the server, send `notifications/initialized`, then use `tools/list` or `tools/call`.

References:

- [OpenAI MCP tool docs](https://developers.openai.com/api/docs/mcp)
- [MCP transports specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
- [MCP tools specification](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
