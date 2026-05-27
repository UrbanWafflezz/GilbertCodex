import type { ProviderSettings } from "../../types/settings";
import type { ProviderToolBridgeOptions, ToolCapabilityPlan, ToolDefinition, ToolBridgePermissionRequirement, ToolBridgeRisk } from "../../toolBridge/types";
import { DEFAULT_INSTALLED_PLUGIN_IDS, PLUGIN_LISTINGS } from "../../features/plugins/pluginCatalog";
import { FINAL_RESPONSE_STYLE_GUIDANCE } from "./finalResponseStyle";

export interface RuntimeToolPromptInput {
  hasLocalComputerContext: boolean;
  hasWebContext: boolean;
  latestUserPrompt: string;
  selectedChunkIds: Set<string>;
  settings: ProviderSettings;
  toolBridge?: ProviderToolBridgeOptions;
}

interface RuntimeToolSummary {
  family: string;
  id: string;
  permission: ToolBridgePermissionRequirement;
  risk: ToolBridgeRisk;
}

export function createRuntimeToolPrompt({ hasLocalComputerContext, hasWebContext, latestUserPrompt, settings, toolBridge }: RuntimeToolPromptInput) {
  const attachedTools = getAttachedToolSummaries(toolBridge);
  const attachedToolIds = new Set(attachedTools.map((tool) => tool.id));
  const capabilityPlan = toolBridge?.capabilityPlan;
  const promptAuditRequest = isPromptAuditRequest(latestUserPrompt);
  const hasTool = (id: string) => attachedToolIds.has(id);
  const hasToolIdPrefix = (prefix: string) => attachedTools.some((tool) => tool.id.startsWith(prefix));
  const hasAnyToolFamily = (...families: string[]) => attachedTools.some((tool) => families.includes(tool.family));
  const hasExactToolBridge = Boolean(toolBridge);
  const sections = [
    "Use only app-exposed provider tool calls when they are attached to this request. Do not invent text-only tool JSON, XML, local-computer protocols, MCP calls, Git calls, terminal transcripts, or workflow calls in visible Markdown.",
    "Request fulfillment contract: treat the latest user message as the success condition. Handle every concrete ask unless it conflicts with higher-priority instructions or is impossible with the available context/tools. If the user asked for an action and an attached tool can do it, call the tool instead of giving only a plan or explanation. If the action cannot be completed, say exactly what is blocked, what evidence is missing, and what partial answer is still possible. Do not claim done, fixed, updated, verified, installed, connected, ran, passed, or searched unless current conversation context or tool results prove that exact claim.",
    formatAvailableToolsManifest(attachedTools, toolBridge),
    formatCapabilityInventoryGuidance(latestUserPrompt, settings, attachedTools),
    attachedTools.length > 0
      ? "The tool manifest above is authoritative for this request. Do not say you have no tools when the manifest lists callable tools. If an exact tool id you expected is absent, use the closest attached tool in the same family and continue; mention a missing tool only when that exact missing capability blocks the request."
      : "If no provider tools are listed and the answer does not require fresh execution, answer normally instead of volunteering a broad no-tools disclaimer.",
    hasTool("memory_search")
      ? "Use memory_search as the selective path to saved local chat/project memory and tool lessons. Do not assume memory was preloaded into the prompt; query it when prior decisions, earlier chats, project continuity, or previous tool failures could matter."
      : "",
    hasTool("terminal_run")
      ? "Terminal commands are available only through the terminal_run tool, which runs inside the active workspace/full-computer roots with a cwd, timeout, captured output, and optional background session for dev servers. Put the target folder in cwd/workingDirectory; do not prefix commands with `cd ... &&`. Use terminal_run for clone/download/package-install/build/test workflows and for binary asset copies when text-file tools are not the right fit. The app permission UI handles any required approval. For dev servers/watchers, call terminal_run only once per matching command/cwd/preview target; if startup output is quiet, poll terminal_read_session instead of starting another copy. Match the active shell dialect: use PowerShell syntax for PowerShell, Command Prompt syntax for cmd, and Unix syntax only for bash/sh/zsh/WSL. Prefer files_create_directory/files_list/files_count_lines when attached instead of terminal mkdir/ls/wc commands."
      : "",
    hasTool("terminal_list_sessions") || hasTool("terminal_read_session") || hasTool("terminal_dev_server_status")
      ? "Run diagnostics are attached for this request. Before starting a dev server or watcher, call terminal_list_sessions and terminal_dev_server_status to reuse only app-owned sessions or reachable localhost servers that match the requested command/cwd/preview target. Do not open or reuse unrelated common localhost ports returned as diagnostics. Use terminal_read_session to inspect app-owned session output after startup and during verification. External Windows Terminal, PowerShell, cmd, or other non-Gilbert terminal scrollback is not readable; if full logs are needed, say that honestly and offer to restart or run the command inside Gilbert's integrated terminal."
      : "",
    hasToolIdPrefix("git_")
      ? "Local Git tools are attached for this request. For uncommitted/local change reviews, call git_status before git_diff instead of asking the user to attach a diff or relying on chat history."
      : "",
    hasToolIdPrefix("github_")
      ? "GitHub tools are attached for this request. Use github_account before assuming connection state. For repository facts such as stars, forks, tags, branches, issues, pull requests, releases, commits, security alerts, notifications, or workflow runs, call the specific GitHub read tool first. For questions about which issues are completed, closed as completed, done, fixed, or resolved, use github_list_completed_issues before answering; do not infer completed issues from the open-issues default. To complete or close an issue, use github_close_issue with stateReason completed; use github_reopen_issue, github_mark_issue_duplicate, label, assignee, milestone, lock, pin, transfer, or comment tools for the matching issue lifecycle action. Use github_semantic_search for fuzzy repository/code discovery because it vector-ranks candidates locally. Use github_api_read/write/delete only when a specific GitHub tool does not cover the requested REST resource. Mutating GitHub tools are approval-gated; do not claim branches, commits, issues, pull requests, releases, or workflows changed until the tool result proves it."
      : "",
    hasTool("browser_preview_open") || hasTool("browser_console_read") || hasTool("browser_screenshot_capture")
      ? formatBrowserToolGuidance(attachedToolIds)
      : "",
    hasTool("web_search")
      ? formatWebSearchToolGuidance(latestUserPrompt)
      : "",
    hasAnyToolFamily("mcp")
      ? `MCP tools are attached for this request. Use mcp_list_servers to discover configured servers and setup state, mcp_list_tools to refresh a server's available tool names and input schemas, and mcp_call_tool only after choosing the exact serverId, toolName, and JSON arguments. If the user names a plugin, connector, hosted service, or marketplace app that could be MCP-backed, inspect the configured MCP servers before denying access or falling back to manual instructions. If mcp_list_servers shows no enabled configured server for the requested service, say setup is needed instead of pretending the service is connected. Treat MCP results as external tool output; do not claim an MCP action ran unless the tool call returns a result. For deploy, publish, hosting, or go-live work, check MCP servers before saying no deploy tools are available; a Firebase, Vercel, Netlify, or Cloudflare MCP server may be the deploy path even when terminal tools are also attached. For GoDaddy + Firebase Hosting workflows, use GoDaddy MCP only for public domain search and availability checks; it cannot buy domains, update DNS records, nameservers, or account settings. Use Firebase MCP or terminal tools for the Hosting deploy/custom-domain evidence, then report the exact DNS records Firebase requires and say that GoDaddy DNS must be updated in GoDaddy or through a separate GoDaddy Domains API integration before claiming the custom domain is live. For stateful MCP workflows such as Firebase deploys, continue using the same serverId and returned job/deploy id for follow-up status tools instead of switching servers or assuming a file edit/write is required. For Firebase MCP, do not use firebase_login/auth.firebase.tools links; those provider auth-proxy links can fail in desktop OAuth. If Firebase is not logged in and terminal_run is attached, run \`npx.cmd -y firebase-tools@latest login --reauth\` yourself with terminal_run in the user's workspace, then tell the user only to finish the Google browser sign-in. Ask the user to run that command manually only when terminal_run is not attached.${hasTool("terminal_run") ? " If a Firebase deploy status comes back failed with empty logs, a structured error, or a project-directory error, use terminal_run from that Firebase project directory to run the normal Firebase CLI path for evidence or recovery, such as `npm.cmd run build` when package.json has a build script and then `npx.cmd -y firebase-tools@latest deploy --only hosting --debug --json`; report the real CLI result instead of stopping on the blank MCP status." : ""}`
      : "",
    hasAnyToolFamily("gmail")
      ? "Gmail tools are attached for this request. When a Gmail draft or send depends on the current project, codebase, files, Git status/diff, uploaded attachments, MCP results, calendar details, or other available context, gather the relevant evidence with attached tools first; then compose from that evidence. Write outgoing Gmail bodies in clean Markdown by default, using real Markdown for lists, links, emphasis, and readable spacing; omit contentType unless the user explicitly asks for plain text or raw HTML. Use the connected account name from gmail_account for sender closings; never leave placeholders like [Your Name]. For new emails, omit reply-only fields such as threadId, inReplyTo, and references instead of filling them with spaces, dashes, or placeholder text. Do not invent project or mailbox details. Sending remains approval-gated, so do not claim an email was sent until the Gmail tool result proves it."
      : "",
    hasTool("image_generate")
      ? "Image generation is available through image_generate for this request. When the user asks to create, generate, draw, render, design, or produce an image, call image_generate instead of merely describing the image. Put a strong visual brief in the tool prompt: subject, style or medium, composition/framing, colors, lighting, text requirements, and constraints. If the user asks for multiple options, set n/count from 1 to 4 and ask for distinct variations in the prompt. Omit the model unless the user explicitly asks for a complete cx/* subscription image route. Never pass partial model routes such as cx/ or OpenAI native image ids such as gpt-image-1 in this tool. Mention the attached image artifact after it succeeds; do not paste base64."
      : "",
    hasWebContext
      ? "Live web-search context is present. Treat it as the only current external evidence for this answer and cite only the provided URLs."
      : hasTool("web_search")
        ? "If current web evidence is needed, call web_search with a focused query. If web_search is unavailable or returns no usable sources, say what could not be verified instead of pretending a search ran."
        : "If live web evidence is unavailable, say what could not be verified instead of pretending a search ran.",
    hasLocalComputerContext || hasAnyToolFamily("files", "editing", "git", "terminal", "browser")
      ? "Local workspace context may be attached as bounded metadata. It is not proof that any file was read, edited, tested, committed, or executed during this turn."
      : "",
    hasAnyToolFamily("files")
      ? formatFileDiscoveryGuidance(attachedToolIds)
      : "",
    formatBatchToolGuidance(attachedToolIds),
    hasAnyToolFamily("editing")
      ? formatEditToolGuidance(attachedToolIds)
      : "",
    hasTool("files_create_directory")
      ? "For folder creation, use files_create_directory when attached instead of terminal mkdir commands. GILBERT.md is curated project memory: write concise notes, decisions, commands, architecture, preferences, and lessons there; do not paste raw tool errors or failure logs into it."
      : "",
    hasTool("web_search")
      ? "For research requests, use focused web_search calls only when source coverage is insufficient. Prefer primary sources, avoid duplicate queries, and synthesize only from cited live sources plus local tool evidence."
      : "",
    formatCapabilityPlanGuidance(capabilityPlan),
    hasExactToolBridge && attachedTools.length === 0 ? "No provider tools are attached. Answer from chat, attachments, and already-provided context only." : "",
    formatWorkModeGuidance(settings.workMode),
    formatAgentEnvironmentGuidance(settings.agentEnvironment),
    promptAuditRequest
      ? "Prompt/tool-audit request detected. Keep the visible answer focused on prompt/tool configuration, token budget, concrete risks, and actionable optimization steps."
      : "Visible answers should be direct, professional, senior-developer clear, and easy for non-experts to follow. Start with the direct answer, completed change, or most important finding; avoid filler, hedging, and process recaps before the answer. Be honest about uncertainty and limits in plain language.",
    promptAuditRequest ? "" : FINAL_RESPONSE_STYLE_GUIDANCE,
    promptAuditRequest
      ? ""
      : "Use normal, valid GitHub-flavored Markdown prose. Do not wrap the whole answer in a fenced code block, and do not use code fences for ordinary summaries, plans, bullets, tables, or explanations. Use fenced code blocks only for actual code snippets, diffs, logs, terminal output, or code-only content the user explicitly requested; always close every fence. If you use a pipe table, include a complete delimiter row with the same number of columns as the header, or use bullets instead. Do not emit JSON envelopes, provider tool_calls, or raw tool-call markup as visible text. Never mention hidden tool protocols or unavailable tool syntax unless the user directly asks about tool availability.",
  ];

  return sections.filter(Boolean).join("\n");
}

function isPromptAuditRequest(prompt: string) {
  return /\b(?:system\s+prompt|prompt\s+(?:for|tokens?|budget|optimization)|tools?\s+(?:prompt|tokens?|budget)|token\s+(?:budget|usage|uses?))\b/i.test(prompt);
}

function formatBrowserToolGuidance(attachedToolIds: Set<string>) {
  const hasPreview = attachedToolIds.has("browser_preview_open");
  const hasConsole = attachedToolIds.has("browser_console_read");
  const hasScreenshot = attachedToolIds.has("browser_screenshot_capture");
  const capabilities = [
    hasPreview ? "browser_preview_open opens a preview after a local dev server URL exists or a public HTTPS URL is provided." : "",
    hasConsole ? "browser_console_read reads captured browser console errors, warnings, logs, and preview lifecycle issues." : "",
    hasScreenshot ? "browser_screenshot_capture captures the current in-app browser preview as an image artifact that will be attached to the next synthesis pass." : "",
  ].filter(Boolean);
  const workflow = [
    "get/reuse the dev server with terminal diagnostics when needed",
    hasPreview ? "open the preview with the tool once a URL is known" : "",
    hasScreenshot ? "capture a screenshot for visual evidence" : "",
    hasConsole ? "read the browser console when debugging issues" : "",
    "edit files if needed",
    hasScreenshot || hasConsole ? "rerun or rebuild, then verify with the attached browser tools" : "rerun or rebuild, then verify from attached tool results",
  ].filter(Boolean);

  return [
    `Browser/app preview tools are attached. ${capabilities.join(" ")}`,
    `For website, localhost app, browser UI, visual, screenshot, or rendering tasks: ${workflow.join(", ")} instead of merely saying it could be opened.`,
  ].join(" ");
}

function formatWorkModeGuidance(workMode: ProviderSettings["workMode"]) {
  if (workMode === "everyday") {
    return "Work mode: Everyday work. Keep the same capabilities, tool use, honesty, and safety posture, but use less technical visible wording by default. Explain outcomes in plain language, keep code and implementation detail available when asked, and avoid unnecessary internal engineering detail.";
  }

  return "Work mode: Coding. Default to practical senior-engineer detail for code, tooling, tests, local runtime behavior, and implementation tradeoffs while staying concise and readable.";
}

function formatAgentEnvironmentGuidance(agentEnvironment: ProviderSettings["agentEnvironment"]) {
  if (agentEnvironment === "wsl") {
    return "Agent environment: Windows Subsystem for Linux. For terminal work, prefer the WSL shell and Linux command dialects, use WSL paths when the workspace is already under WSL, and do not assume Windows PowerShell-only commands are appropriate inside WSL. WSL2 is the supported target.";
  }

  if (agentEnvironment === "windows-native") {
    return "Agent environment: Windows native. For terminal work, prefer Windows paths plus PowerShell or Command Prompt dialects unless the user explicitly asks for Linux tooling.";
  }

  return "Agent environment: Auto Detect. Prefer WSL/Linux shell behavior when the selected workspace root is a WSL path; otherwise use the native host shell and path style.";
}

function getAttachedToolSummaries(toolBridge: ProviderToolBridgeOptions | undefined): RuntimeToolSummary[] {
  if (toolBridge) {
    const providerVisibleToolIds = toolBridge.providerVisibleToolIds ?? toolBridge.capabilityPlan?.providerVisibleToolIds;
    const tools = providerVisibleToolIds
      ? (toolBridge.tools ?? []).filter((tool) => providerVisibleToolIds.includes(tool.id))
      : toolBridge.tools ?? [];

    return tools.map(summarizeTool);
  }

  // Provider tools are request-scoped. App settings may enable files, editing,
  // terminal, or web globally, but the model can only call tools that the
  // runtime attached to this exact provider request.
  return [];
}

function formatCapabilityPlanGuidance(plan: ToolCapabilityPlan | undefined) {
  if (!plan) {
    return "";
  }

  const diagnostics = plan.blockedReasons
    .map((reason) => `${reason.code}${reason.family ? `/${reason.family}` : ""}: ${reason.detail}`)
    .slice(0, 4);

  if (plan.mustUseTools && !plan.canCallProvider) {
    return [
      "Internal tool capability note: this request requires tool evidence, but no required provider-visible tools are attached for this pass.",
      diagnostics.length ? `Internal diagnostics, do not quote to the user: ${diagnostics.join(" | ")}` : "",
      "Do not claim that a workspace read, edit, Git command, terminal command, browser action, or web search ran. If you must answer, phrase the limitation in plain user language.",
    ].filter(Boolean).join(" ");
  }

  if (diagnostics.length === 0) {
    return "";
  }

  return `Tool capability diagnostic: ${diagnostics.join(" | ")}`;
}

function summarizeTool(tool: ToolDefinition): RuntimeToolSummary {
  return {
    family: tool.executorMetadata?.family ?? "tool",
    id: tool.id,
    permission: tool.permission,
    risk: tool.risk,
  };
}

function formatWebSearchToolGuidance(latestUserPrompt: string) {
  const promptLooksCurrent = /\b(api docs?|browse|changelog|cite|current|latest|look up|official|online|prices?|pricing|recent|release notes?|research|search(?:\s+the)?\s+(?:internet|online|web)|sources|today|up[- ]to[- ]date|verify|web)\b|(?:\b(?:release|launch)\s+(?:date|daye?|schedule|timing|window)\b)|(?:\b(?:comes?|coming)\s+out\b)|(?:\b(?:scheduled|slated)\s+(?:for|to|release|launch)\b)/i.test(latestUserPrompt);
  const promptHint = promptLooksCurrent
    ? "The latest user prompt appears to ask for current or source-backed external evidence; call web_search before making those claims."
    : "";

  return [
    "When web_search is listed above, it is a callable live-web tool for this exact request. Use it before answering claims that depend on current or changing external facts, official docs/API references, releases/changelogs, pricing, laws/rules/standards, schedules, news, or when the user asks to search, look up, verify, cite, or use sources.",
    "Prefer local workspace tools for repo files, settings, app behavior, source code, and local docs. If both local code and external documentation are needed, use workspace tools for local evidence and web_search for outside evidence.",
    promptHint,
  ].filter(Boolean).join(" ");
}

const CAPABILITY_INVENTORY_PROMPT_PATTERN =
  /\b(?:what|which|list|show|tell(?:\s+me)?|explain|describe)\b[\s\S]{0,180}\b(?:tools?|plugins?|apps?|skills?|capabilities?|connectors?)\b|\b(?:tools?|plugins?|apps?|skills?|capabilities?|connectors?)\b[\s\S]{0,180}\b(?:available|enabled|installed|connected|do\s+you\s+have|can\s+you\s+(?:access|call|use|do))\b/i;

function formatCapabilityInventoryGuidance(latestUserPrompt: string, settings: ProviderSettings, attachedTools: RuntimeToolSummary[]) {
  if (!CAPABILITY_INVENTORY_PROMPT_PATTERN.test(latestUserPrompt)) {
    return "";
  }

  const attachedFamilies = [...new Set(attachedTools.map((tool) => plainToolFamilyLabel(tool.family)))];
  const enabledCapabilities = formatEnabledCapabilityToggles(settings);
  const defaultCatalogEntries = PLUGIN_LISTINGS
    .filter((plugin) => (DEFAULT_INSTALLED_PLUGIN_IDS as readonly string[]).includes(plugin.id))
    .map((plugin) => plugin.name)
    .slice(0, 8);
  const pluginCategories = [...new Set(PLUGIN_LISTINGS.map((plugin) => plugin.category))].slice(0, 12);

  return [
    "Capability inventory request detected. Answer the user directly and conversationally before caveats.",
    "Interpret tools as callable abilities in this chat, and plugins/apps/skills/connectors as installed or available capability bundles. Use plain labels such as files/code, editing, terminal, browser preview, Git/GitHub, web search, images, memory, Gmail, Google Calendar, MCP, and diagnostics instead of raw internal ids unless the user asks for ids.",
    attachedFamilies.length > 0
      ? `Callable tool families attached now: ${attachedFamilies.join(", ")}.`
      : "No provider tool manifest is attached now; still answer from the app capability settings below and say exact live-callable tools depend on the chat settings, selected workspace, and connected plugins.",
    enabledCapabilities ? `Enabled app capability toggles: ${enabledCapabilities}.` : "",
    defaultCatalogEntries.length > 0 ? `Bundled catalog default entries include: ${defaultCatalogEntries.join(", ")}. This is catalog/default metadata, not proof that each plugin is currently connected in this chat.` : "",
    pluginCategories.length > 0 ? `Available plugin categories include: ${pluginCategories.join(", ")}.` : "",
    "Do not claim a plugin, skill, MCP server, Gmail account, Google Calendar account, or external connector is installed, connected, or live unless the current message, attached tool manifest, app state, or tool result proves it. If only catalog metadata is available, call it available/catalog metadata.",
    "Do not expose internal phrases like no_selected_tools, required_family_unavailable, provider-visible, blocked gates, tool_choice, required families, or mustUseTools in the visible answer.",
  ].filter(Boolean).join(" ");
}

function plainToolFamilyLabel(family: string) {
  switch (family) {
    case "browser":
      return "browser preview";
    case "diagnostic":
      return "diagnostics";
    case "editing":
      return "file editing";
    case "files":
      return "files and code search";
    case "git":
      return "Git and GitHub";
    case "gmail":
      return "Gmail";
    case "calendar":
      return "Google Calendar";
    case "media":
      return "image generation";
    case "memory":
      return "memory";
    case "mcp":
      return "MCP";
    case "terminal":
      return "terminal";
    case "web":
      return "web search";
    default:
      return family || "tools";
  }
}

function formatEnabledCapabilityToggles(settings: ProviderSettings) {
  const tools = settings.tools;
  const labels = [
    tools.fileBrowser || tools.fileSearch || tools.codeView ? "workspace files/code view" : "",
    tools.codeEdit || tools.codeGeneration || tools.fileCreation ? "code editing and file creation" : "",
    tools.sourceControl ? "source control" : "",
    tools.terminal ? "terminal commands" : "",
    tools.browserPreview ? "browser preview and console" : "",
    tools.webSearch ? "web search" : "",
    tools.imageGeneration ? "image generation" : "",
    tools.planning ? "planning mode" : "",
    tools.mcpServers ? "MCP servers" : "",
  ].filter(Boolean);

  return labels.join(", ");
}

function formatAvailableToolsManifest(tools: RuntimeToolSummary[], toolBridge: ProviderToolBridgeOptions | undefined) {
  const lines = ["Available provider tools for this request:"];

  if (tools.length === 0) {
    lines.push("- none");
  } else {
    for (const [family, ids] of groupToolIdsByFamily(tools)) {
      lines.push(`- ${family}: ${ids.join(", ")}`);
    }
  }

  const budget = toolBridge?.runtimeBudget;
  const resultChars = budget?.maxToolResultContentChars ?? toolBridge?.maxToolResultContentChars;
  const budgetParts = [
    formatBudgetPart("passes", budget?.remainingPasses, budget?.maxPasses),
    formatBudgetPart("executions", budget?.remainingExecutions, budget?.maxExecutions),
    typeof resultChars === "number" ? `tool-result context ${Math.max(0, Math.floor(resultChars)).toLocaleString()} chars` : "",
  ].filter(Boolean);

  if (budgetParts.length > 0) {
    lines.push(`- budget: ${budgetParts.join("; ")}`);
  }

  return lines.join("\n");
}

function groupToolIdsByFamily(tools: RuntimeToolSummary[]) {
  const grouped = new Map<string, string[]>();

  for (const tool of tools) {
    const ids = grouped.get(tool.family) ?? [];
    ids.push(tool.id);
    grouped.set(tool.family, ids);
  }

  return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function formatBudgetPart(label: string, remaining: number | undefined, max: number | undefined) {
  if (remaining === undefined && max === undefined) {
    return "";
  }

  if (remaining !== undefined && max !== undefined) {
    return `${label} ${Math.max(0, remaining)}/${Math.max(0, max)}`;
  }

  return `${label} ${Math.max(0, remaining ?? max ?? 0)}`;
}

function formatBatchToolGuidance(attachedToolIds: Set<string>) {
  const batchTools = [
    attachedToolIds.has("files_read_many") ? "files_read_many for multiple reads" : "",
    attachedToolIds.has("files_write_many") ? "files_write_many for creating or replacing several files" : "",
    attachedToolIds.has("files_edit_many") ? "files_edit_many for one or many precise edits" : "",
  ].filter(Boolean);

  if (batchTools.length === 0) {
    return "";
  }

  const editManyGuidance = attachedToolIds.has("files_edit_many")
    ? " For code edits, put every independent same-pass change into one files_edit_many call, including several changes in a single file."
    : "";

  return `When the task needs several reads, writes, or edits, prefer batch tools by default when attached: ${batchTools.join("; ")}.${editManyGuidance}`;
}

function formatFileDiscoveryGuidance(attachedToolIds: Set<string>) {
  const discoveryTools = [
    attachedToolIds.has("files_search") ? "files_search as grep-style discovery for symbols, text, filenames, and paths" : "",
    attachedToolIds.has("files_tree_summary") ? "files_tree_summary for a quick project or folder map" : "",
    attachedToolIds.has("files_list") ? "files_list for directory contents" : "",
  ].filter(Boolean);
  const readTools = [
    attachedToolIds.has("files_read_range") ? "files_read_range for the smallest current slice around matched lines" : "",
    attachedToolIds.has("files_read_many") ? "files_read_many for several confirmed files" : "",
    attachedToolIds.has("files_read") ? "files_read for one confirmed small file" : "",
  ].filter(Boolean);

  if (discoveryTools.length === 0 && readTools.length === 0) {
    return "";
  }

  return [
    discoveryTools.length > 0
      ? `For local codebase work, discover before reading guessed files: ${discoveryTools.join("; ")}.`
      : "",
    readTools.length > 0
      ? `After discovery, read only what is needed: ${readTools.join("; ")}.`
      : "",
    attachedToolIds.has("files_search")
      ? "If a read path is missing or uncertain, call files_search before saying the file does not exist."
      : "",
  ].filter(Boolean).join(" ");
}

function formatEditToolGuidance(attachedToolIds: Set<string>) {
  const batchEditTool = attachedToolIds.has("files_edit_many")
    ? "Use files_edit_many as the default for existing-file edits that touch more than one place or file; it applies same-file edits in order and writes each file once."
    : "";
  const narrowBatchEditGuidance = attachedToolIds.has("files_edit_many")
    ? " Keep files_edit_many edits narrow: do not recover from an edit error by using exact_replace, replace_range, or generated content for most or all of a file; re-read and patch the smallest current block instead."
    : "";
  const preciseTools = [
    attachedToolIds.has("files_exact_replace") ? "files_exact_replace for one current exact-text replacement" : "",
    attachedToolIds.has("files_replace_range") ? "files_replace_range for one fresh line-range replacement" : "",
    attachedToolIds.has("files_replace_span") ? "files_replace_span for one current line/column span, including a single-character edit" : "",
    attachedToolIds.has("files_insert_at_line") ? "files_insert_at_line for one insertion at a known line" : "",
    attachedToolIds.has("files_append") ? "files_append for adding text to the end of an existing file" : "",
    attachedToolIds.has("files_apply_patch") ? "files_apply_patch for unified-diff hunks" : "",
  ].filter(Boolean);
  const fullRewriteTool = attachedToolIds.has("files_write_many")
    ? " Use files_write_many only for new files or deliberate full-file rewrites, not ordinary existing-file edits. For brand-new files, set overwrite:false so creates can use the fastest create-only batch path. For existing full-file rewrites, set allowWholeFileReplacement:true only when the user clearly wants that."
    : "";
  const copyTool = attachedToolIds.has("files_copy")
    ? " Use files_copy for copying local assets or folders, especially binary files such as images, from one project path into another."
    : "";
  const lineRangeGuidance = attachedToolIds.has("files_edit_many") || attachedToolIds.has("files_replace_range")
    ? " Use replace_range only with line numbers from a fresh read of the current file; if a range fails as stale or out of bounds, re-read and retry with exact_replace or files_apply_patch anchored to current text."
    : "";
  const spanGuidance = attachedToolIds.has("files_edit_many") || attachedToolIds.has("files_replace_span")
    ? " For a single character, word, expression, or partial-line edit, use files_edit_many replace_span or files_replace_span with 1-based line/column coordinates from a fresh read; endColumn is exclusive."
    : "";
  const exactReplaceGuidance = attachedToolIds.has("files_edit_many") || attachedToolIds.has("files_exact_replace")
    ? " For exact_replace, make oldText unique by including enough surrounding current text; if the tool says exact text matched multiple times, do not set replaceAll unless every occurrence should change, instead re-read/narrow the anchor or use replace_span, replace_range, or files_apply_patch."
    : "";
  const staleGuidance = attachedToolIds.has("files_append") || attachedToolIds.has("files_exact_replace") || attachedToolIds.has("files_edit_many")
    ? " If a tool says the file changed since it was last read, do not stop: re-read the current slice and retry the edit; append and exact_replace can usually be retried against the latest content without a stale expectedSha256."
    : "";

  if (!batchEditTool && preciseTools.length === 0 && !fullRewriteTool && !copyTool) {
    return "";
  }

  return [`For existing-file edits, inspect the target first.`, batchEditTool, narrowBatchEditGuidance.trim(), preciseTools.length > 0 ? `Other attached precise tools: ${preciseTools.join("; ")}.` : "", fullRewriteTool.trim(), copyTool.trim(), lineRangeGuidance.trim(), spanGuidance.trim(), exactReplaceGuidance.trim(), staleGuidance.trim()]
    .filter(Boolean)
    .join(" ");
}
