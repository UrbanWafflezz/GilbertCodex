# Gilbert Codex Progress

This file tracks the current product state for collaborators. It should describe what is live now, what is being hardened, and what remains open for the next alpha releases.

## Current Phase: v0.8.1 Platform Hotfix Alpha

Status: v0.8.1 keeps the major v0.8.0 platform release moving with a hotfix build for real tester friction. The current build ships MCP server management, app-managed Skills, a working plugin directory foundation, stronger thinking/tool visibility, safer local tool behavior, stateful MCP stdio sessions, 9Router LAN access metadata, Discord ngrok path recovery, and Windows, macOS, and Linux release artifacts.

Delivered:

- Tauri 2 desktop shell with custom window chrome, local app metadata, branded installer assets, and update-ready release configuration.
- React chat workspace with project grouping, searchable history, pinned chats, attachments, planning mode, thinking controls, queued sends, queued steering behavior, and local persistence.
- Multi-provider model routing for OpenRouter, OpenAI, Anthropic, Google Gemini, xAI, LM Studio, Ollama, Groq, Mistral, and DeepSeek.
- Subscription account routing for Codex / ChatGPT, Claude Code, Gemini CLI / Cloud Code, Antigravity, GitHub Copilot, Kiro, Kilo Code, Cline, Qwen Code, iFlow, Qoder, Kimi Coding, and CodeBuddy where the local subscription runtime supports them.
- Codex / ChatGPT subscription sign-in with browser OAuth handoff, local callback handling, account status, and subscription model selection.
- Image generation through attached media tooling, with composer controls, model-facing prompt guidance, progress cards, generated image grids, lightbox preview, and downloads.
- Host-managed local action runtime with schema adapters for OpenAI-compatible chat, OpenAI Responses, and Anthropic Messages requests.
- Local capability families for diagnostics, file reads/search/listing, editing, terminal execution, browser preview, local Git, GitHub API surfaces, web search, and MCP server discovery/tool calls where settings and permissions allow them.
- Apps > MCP with HTTP, localhost, and stdio server setup; secure bearer/env storage; 20 featured presets; registry search; streaming setup tests; cached tool schemas; and chat-callable MCP list/call tools.
- v0.8.1 keeps stdio MCP subprocesses alive per configured server while the app is open, which preserves server-owned state for deploy jobs and other multi-step workflows.
- Apps > Skills with premade workflows, custom skill creation, `SKILL.md` folder import, enable/disable controls, trigger copying, composer mention support, and prompt-aware skill matching.
- Plugin directory foundation with Discover, Installed, Create, and Marketplace views; 27 curated listings; component/permission metadata; manifest preview; installed-state tracking; and OpenAI/Codex marketplace skill-import routes.
- Permission filtering that keeps read-only work smoother while gating terminal, destructive, credential, publish, and outside-scope actions.
- Tool result finalization that prevents raw tool output from leaking into final assistant answers and pushes the model toward a synthesized response when needed.
- Host-managed DuckDuckGo/Brave web search with source cards and a six-source cap.
- SQL-backed local database for desktop auth, chats, settings, integrations, browser preview state, and agent-run records, with database work shifted off the UI path.
- Discord slash-command bridge setup/runtime for forwarding requests into Gilbert chat.
- GitHub OAuth device-flow setup, account state, repository actions, and release/workflow surfaces.
- Apps page with live Gmail, Google Calendar, GitHub, MCP, plugin, and Skills management surfaces.
- Documentation refreshed for the current public alpha story, updater release path, and contributor readiness.
- Repository licensing now separates MIT-licensed implementation code from proprietary Gilbert Codex UI, visual design, branding, screenshots, installer artwork, promotional assets, and agent tool system.
- v0.8.x subscription setup keeps install, sign-in, model selection, usage/quota, and fallback states separated so users can understand what is ready before they send.
- Model and composer labels now show the route source, including subscription accounts, OpenRouter routes, direct provider APIs, and local model servers.
- Full-computer workspace mode can lazily resolve host roots for precise absolute paths while normal selected-folder mode remains project-scoped.
- Local computer tooling now includes guarded copy support, faster ordered batch writes, stale-edit retry guidance, and clearer binary-asset handling.
- Context-window and research surfaces now replace embedded data URLs with short metadata placeholders instead of feeding large media blobs into text context.
- Automations now generate cleaner task prompts/results, filter source cards to actual web-search runs, and avoid empty or protocol-style sections in inbox summaries.
- Coding review now reports captured tool activity and tool coverage so users can see what the agent actually used during a run.
- v0.8.1 improves Firebase MCP fallback guidance, local MCP result synthesis, 9Router private-LAN URL surfacing, Discord ngrok executable discovery, and CI/release runner selection for steadier all-platform builds.

Known alpha limits:

- ChatGPT GPT-5.3 Spark is a known read-only route for now: file reads work, but write/edit tool calls do not complete reliably. Other Codex/ChatGPT, OpenRouter, and local routes remain the recommended paths for workspace edits.
- Tool reliability still varies by provider and model, especially around malformed or incomplete tool calls.
- Approval UX and activity grouping need more polish before the bridge feels final.
- Image generation is first-class for the Codex / ChatGPT subscription path, while broader provider image routes still need more field testing.
- The plugin marketplace foundation is live, but deeper install/update flows beyond native connectors, MCP presets/search, and skill import still need polish.
- macOS and Linux artifacts are published, but official platform confidence still needs real-device launch smoke testing.
- The Windows installer remains unsigned unless a release is built with a valid code-signing configuration.
- Some advanced workflow automation and multimodal surfaces are still roadmap work, not promised release behavior.
- v0.8.1 uses the GitHub release workflow for Windows x64, macOS Apple Silicon, macOS Intel, and Linux x64, with updater signatures, checksums, and `latest.json` expected from the tag build.

## Next Hardening Work

- Add more provider compatibility tests for subscription routes, image generation, tool schemas, tool-result replay, malformed-call recovery, and streaming edge cases.
- Tighten terminal, editing, Git, GitHub, browser preview, and MCP approval flows with clearer review cards.
- Improve activity and inspector presentation so tools, files, approvals, sources, artifacts, and retries scan cleanly.
- Keep provider-visible request accounting aligned with the exact serialized request body each provider receives.
- Continue GitHub/source-control UI polish with diff review, PR handoff, release workflows, and CI visibility.
- Polish the Apps, Skills, and Plugins hub now that Gmail, Google Calendar, GitHub, MCP, Skills, and plugin surfaces are live.
- Finish macOS and Linux real-device verification, signing/notarization decisions, packaging diagnostics, and platform-specific fixes.
- Add public alpha validation notes after each packaged release is built and installed on a real machine.

## Open Questions

- Which tool families should be enabled by default for first-time users once the bridge has more field data.
- Whether high-impact GitHub release and workflow actions should require a dedicated confirmation card even in full-access mode.
- How much provider-native tool behavior should be exposed versus normalized through the app bridge.
- Which voice and multimodal capabilities should land before the next larger public milestone.
- Whether a formal contributor agreement is needed before accepting larger outside UI, branding, design, or AI tool contributions.
