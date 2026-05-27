import { describe, expect, it } from "vitest";

import { defaultProviderSettings } from "../../lib/appStorage";
import { createRuntimeToolPrompt } from "./runtimeToolPrompt";
import type { ToolDefinition } from "../../toolBridge/types";

function attachedTool(id: string, family: NonNullable<ToolDefinition["executorMetadata"]>["family"]): ToolDefinition {
  return {
    description: `${id} test tool`,
    execute: () => ({ content: "ok", ok: true }),
    executorMetadata: { family, version: 1 },
    id,
    inputSchema: { type: "object" },
    permission: family === "terminal" ? "terminal" : "read-only",
    risk: family === "terminal" ? "terminal" : family === "web" || family === "media" ? "network" : "read",
    title: id,
  };
}

describe("createRuntimeToolPrompt", () => {
  it("keeps research guidance focused when web search is enabled", () => {
    const prompt = createRuntimeToolPrompt({
      hasLocalComputerContext: true,
      hasWebContext: false,
      latestUserPrompt: "research the latest Brave Search API docs",
      selectedChunkIds: new Set(),
      settings: {
        ...defaultProviderSettings,
        thinking: {
          enabled: true,
          effort: "high",
        },
        tools: {
          ...defaultProviderSettings.tools,
          webSearch: true,
        },
      },
      toolBridge: {
        tools: [attachedTool("web_search", "web")],
      },
    });

    expect(prompt).toContain("For research requests, use focused web_search calls");
    expect(prompt).toContain("callable live-web tool");
    expect(prompt).toContain("call web_search before making those claims");
    expect(prompt).toContain("use workspace tools for local evidence and web_search for outside evidence");
    expect(prompt).toContain("Prefer primary sources");
    expect(prompt).not.toContain(["Deep", "Research"].join(" "));
    expect(prompt).not.toContain("do not attempt iterative tool loops");
  });

  it("keeps research honest when web_search is disabled", () => {
    const prompt = createRuntimeToolPrompt({
      hasLocalComputerContext: true,
      hasWebContext: false,
      latestUserPrompt: "research the latest Brave Search API docs",
      selectedChunkIds: new Set(),
      settings: {
        ...defaultProviderSettings,
        thinking: {
          enabled: true,
          effort: "high",
        },
        tools: {
          ...defaultProviderSettings.tools,
          webSearch: false,
        },
      },
      toolBridge: {
        tools: [],
      },
    });

    expect(prompt).not.toContain(["Deep", "Research"].join(" "));
    expect(prompt).toContain("say what could not be verified");
    expect(prompt).not.toContain("web_search tool only");
  });

  it("nudges attached web_search for release-date questions even without explicit search wording", () => {
    const prompt = createRuntimeToolPrompt({
      hasLocalComputerContext: false,
      hasWebContext: false,
      latestUserPrompt: "GTA 6 release daye",
      selectedChunkIds: new Set(),
      settings: defaultProviderSettings,
      toolBridge: {
        tools: [attachedTool("web_search", "web")],
      },
    });

    expect(prompt).toContain("web_search");
    expect(prompt).toContain("call web_search before making those claims");
  });

  it("tells the model to prefer batch file tools for multi-file workspace work", () => {
    const prompt = createRuntimeToolPrompt({
      hasLocalComputerContext: true,
      hasWebContext: false,
      latestUserPrompt: "update these related files",
      selectedChunkIds: new Set(),
      settings: defaultProviderSettings,
      toolBridge: {
        tools: [
          attachedTool("memory_search", "memory"),
          attachedTool("files_search", "files"),
          attachedTool("files_tree_summary", "files"),
          attachedTool("files_read_range", "files"),
          attachedTool("files_read_many", "files"),
          attachedTool("files_write_many", "editing"),
          attachedTool("files_edit_many", "editing"),
          attachedTool("files_exact_replace", "editing"),
          attachedTool("files_insert_at_line", "editing"),
          attachedTool("files_replace_range", "editing"),
          attachedTool("files_replace_span", "editing"),
          attachedTool("files_append", "editing"),
          attachedTool("files_apply_patch", "editing"),
        ],
      },
    });

    expect(prompt).toContain("prefer batch tools by default");
    expect(prompt).toContain("memory_search");
    expect(prompt).toContain("Do not assume memory was preloaded");
    expect(prompt).toContain("files_search as grep-style discovery");
    expect(prompt).toContain("discover before reading guessed files");
    expect(prompt).toContain("files_read_range");
    expect(prompt).toContain("files_read_many");
    expect(prompt).toContain("files_write_many");
    expect(prompt).toContain("files_edit_many");
    expect(prompt).toContain("files_apply_patch");
    expect(prompt).toContain("files_exact_replace");
    expect(prompt).toContain("files_insert_at_line");
    expect(prompt).toContain("files_replace_range");
    expect(prompt).toContain("files_replace_span");
    expect(prompt).toContain("single-character edit");
    expect(prompt).toContain("files_append");
    expect(prompt).toContain("Do not say you have no tools when the manifest lists callable tools");
    expect(prompt).toContain("use the closest attached tool in the same family");
    expect(prompt).toContain("including several changes in a single file");
    expect(prompt).toContain("Use files_edit_many as the default");
    expect(prompt).toContain("Keep files_edit_many edits narrow");
    expect(prompt).toContain("patch the smallest current block");
    expect(prompt).toContain("Use replace_range only with line numbers from a fresh read");
    expect(prompt).toContain("endColumn is exclusive");
    expect(prompt).toContain("make oldText unique");
    expect(prompt).toContain("matched multiple times");
    expect(prompt).toContain("do not set replaceAll unless every occurrence should change");
    expect(prompt).toContain("do not stop: re-read the current slice");
    expect(prompt).toContain("deliberate full-file rewrites");
    expect(prompt).not.toContain("create_files");
    expect(prompt).not.toContain("edit_files");
  });

  it("tells the model to actually open browser previews for UI verification", () => {
    const prompt = createRuntimeToolPrompt({
      hasLocalComputerContext: true,
      hasWebContext: false,
      latestUserPrompt: "preview the localhost app and verify the browser UI",
      selectedChunkIds: new Set(),
      settings: {
        ...defaultProviderSettings,
        tools: {
          ...defaultProviderSettings.tools,
          browserPreview: true,
        },
      },
      toolBridge: {
        runtimeBudget: {
          maxExecutions: 48,
          maxPasses: 12,
          maxToolResultContentChars: 24000,
          remainingExecutions: 47,
          remainingPasses: 11,
        },
        tools: [
          attachedTool("browser_preview_open", "browser"),
          attachedTool("browser_console_read", "browser"),
        ],
      },
    });

    expect(prompt).toContain("browser_preview_open");
    expect(prompt).toContain("browser_console_read");
    expect(prompt).toContain("open the preview with the tool");
    expect(prompt).toContain("read the browser console");
    expect(prompt).toContain("instead of merely saying it could be opened");
    expect(prompt).toContain("budget: passes 11/12; executions 47/48");
  });

  it("tells the model to reuse terminal sessions and localhost servers for run diagnostics", () => {
    const prompt = createRuntimeToolPrompt({
      hasLocalComputerContext: true,
      hasWebContext: false,
      latestUserPrompt: "run app and debug browser error",
      selectedChunkIds: new Set(),
      settings: defaultProviderSettings,
      toolBridge: {
        tools: [
          attachedTool("terminal_list_sessions", "terminal"),
          attachedTool("terminal_dev_server_status", "terminal"),
          attachedTool("terminal_read_session", "terminal"),
          attachedTool("terminal_run", "terminal"),
          attachedTool("browser_preview_open", "browser"),
          attachedTool("browser_console_read", "browser"),
        ],
      },
    });

    expect(prompt).toContain("terminal_list_sessions");
    expect(prompt).toContain("terminal_dev_server_status");
    expect(prompt).toContain("terminal_read_session");
    expect(prompt).toContain("reuse only app-owned sessions or reachable localhost servers that match the requested command/cwd/preview target");
    expect(prompt).toContain("Do not open or reuse unrelated common localhost ports");
    expect(prompt).toContain("External Windows Terminal, PowerShell, cmd, or other non-Gilbert terminal scrollback is not readable");
  });

  it("tells the model to use attached image generation for visual creation", () => {
    const prompt = createRuntimeToolPrompt({
      hasLocalComputerContext: false,
      hasWebContext: false,
      latestUserPrompt: "generate an image of a clean app icon",
      selectedChunkIds: new Set(),
      settings: defaultProviderSettings,
      toolBridge: {
        tools: [attachedTool("image_generate", "media")],
      },
    });

    expect(prompt).toContain("image_generate");
    expect(prompt).toContain("call image_generate instead of merely describing the image");
    expect(prompt).toContain("subject, style or medium, composition/framing, colors, lighting, text requirements, and constraints");
    expect(prompt).toContain("set n/count from 1 to 4");
    expect(prompt).toContain("Omit the model unless the user explicitly asks for a complete cx/* subscription image route");
    expect(prompt).toContain("Never pass partial model routes such as cx/");
    expect(prompt).toContain("OpenAI native image ids such as gpt-image-1");
    expect(prompt).toContain("attached image artifact");
    expect(prompt).toContain("do not paste base64");
  });

  it("tells the model to use attached local Git tools for change reviews", () => {
    const prompt = createRuntimeToolPrompt({
      hasLocalComputerContext: true,
      hasWebContext: false,
      latestUserPrompt: "explain what changed in the current status",
      selectedChunkIds: new Set(),
      settings: defaultProviderSettings,
      toolBridge: {
        tools: [
          attachedTool("git_status", "git"),
          attachedTool("git_diff", "git"),
        ],
      },
    });

    expect(prompt).toContain("git_status");
    expect(prompt).toContain("git_diff");
    expect(prompt).toContain("call git_status before git_diff");
    expect(prompt).toContain("instead of asking the user to attach a diff");
  });

  it("tells the model to inspect MCP setup and preserve stateful service workflows", () => {
    const prompt = createRuntimeToolPrompt({
      hasLocalComputerContext: true,
      hasWebContext: false,
      latestUserPrompt: "deploy my Firebase app and track status",
      selectedChunkIds: new Set(),
      settings: defaultProviderSettings,
      toolBridge: {
        tools: [
          attachedTool("mcp_list_servers", "mcp"),
          attachedTool("mcp_list_tools", "mcp"),
          attachedTool("mcp_call_tool", "mcp"),
        ],
      },
    });

    expect(prompt).toContain("mcp_list_servers");
    expect(prompt).toContain("setup state");
    expect(prompt).toContain("plugin, connector, hosted service, or marketplace app");
    expect(prompt).toContain("inspect the configured MCP servers before denying access");
    expect(prompt).toContain("If mcp_list_servers shows no enabled configured server");
    expect(prompt).toContain("For GoDaddy + Firebase Hosting workflows");
    expect(prompt).toContain("it cannot buy domains, update DNS records");
    expect(prompt).toContain("separate GoDaddy Domains API integration");
    expect(prompt).toContain("same serverId and returned job/deploy id");
    expect(prompt).toContain("instead of switching servers or assuming a file edit/write is required");
  });

  it("tells the model to recover blank Firebase MCP deploy failures with terminal CLI evidence", () => {
    const prompt = createRuntimeToolPrompt({
      hasLocalComputerContext: true,
      hasWebContext: false,
      latestUserPrompt: "deploy my Firebase app and track status",
      selectedChunkIds: new Set(),
      settings: defaultProviderSettings,
      toolBridge: {
        tools: [
          attachedTool("mcp_list_servers", "mcp"),
          attachedTool("mcp_list_tools", "mcp"),
          attachedTool("mcp_call_tool", "mcp"),
          attachedTool("terminal_run", "terminal"),
        ],
      },
    });

    expect(prompt).toContain("Firebase deploy status comes back failed with empty logs");
    expect(prompt).toContain("structured error");
    expect(prompt).toContain("project-directory error");
    expect(prompt).toContain("npx.cmd -y firebase-tools@latest deploy --only hosting --debug --json");
  });

  it("tells the model to check MCP before denying deploy tools", () => {
    const prompt = createRuntimeToolPrompt({
      hasLocalComputerContext: true,
      hasWebContext: false,
      latestUserPrompt: "update the website and deploy it to hosting",
      selectedChunkIds: new Set(),
      settings: defaultProviderSettings,
      toolBridge: {
        tools: [
          attachedTool("mcp_list_servers", "mcp"),
          attachedTool("mcp_list_tools", "mcp"),
          attachedTool("mcp_call_tool", "mcp"),
          attachedTool("terminal_run", "terminal"),
        ],
      },
    });

    expect(prompt).toContain("For deploy, publish, hosting, or go-live work");
    expect(prompt).toContain("check MCP servers before saying no deploy tools are available");
  });

  it("does not name unavailable tool ids when the exact bridge has no tools", () => {
    const prompt = createRuntimeToolPrompt({
      hasLocalComputerContext: false,
      hasWebContext: false,
      latestUserPrompt: "answer normally",
      selectedChunkIds: new Set(),
      settings: defaultProviderSettings,
      toolBridge: {
        tools: [],
      },
    });

    expect(prompt).toContain("- none");
    expect(prompt).toContain("answer normally instead of volunteering a broad no-tools disclaimer");
    expect(prompt).not.toContain("terminal_run");
    expect(prompt).not.toContain("browser_preview_open");
    expect(prompt).not.toContain("web_search tool only");
    expect(prompt).not.toContain("memory_search");
  });

  it("adds plain-language guidance for tool and plugin inventory questions", () => {
    const prompt = createRuntimeToolPrompt({
      hasLocalComputerContext: false,
      hasWebContext: false,
      latestUserPrompt: "what tools do you have and plugins",
      selectedChunkIds: new Set(),
      settings: defaultProviderSettings,
      toolBridge: {
        tools: [],
      },
    });

    expect(prompt).toContain("Capability inventory request detected");
    expect(prompt).toContain("Answer the user directly and conversationally");
    expect(prompt).toContain("Enabled app capability toggles");
    expect(prompt).toContain("Bundled catalog default entries");
    expect(prompt).toContain("not proof that each plugin is currently connected");
    expect(prompt).toContain("Do not claim a plugin, skill, MCP server");
    expect(prompt).toContain("Do not expose internal phrases");
    expect(prompt).toContain("no_selected_tools");
    expect(prompt).toContain("required_family_unavailable");
    expect(prompt).toContain("blocked gates");
  });

  it("does not advertise globally enabled tools when no provider tools are attached", () => {
    const prompt = createRuntimeToolPrompt({
      hasLocalComputerContext: true,
      hasWebContext: false,
      latestUserPrompt: "make it better",
      selectedChunkIds: new Set(),
      settings: {
        ...defaultProviderSettings,
        tools: {
          ...defaultProviderSettings.tools,
          codeEdit: true,
          fileCreation: true,
          terminal: true,
          webSearch: true,
        },
      },
    });

    expect(prompt).toContain("- none");
    expect(prompt).not.toContain("files_edit_many");
    expect(prompt).not.toContain("files_apply_patch");
    expect(prompt).not.toContain("terminal_run");
    expect(prompt).not.toContain("web_search tool only");
  });

  it("does not tell the model to call tools when the capability plan has no provider-visible tools", () => {
    const readTool = attachedTool("files_read", "files");
    const prompt = createRuntimeToolPrompt({
      hasLocalComputerContext: true,
      hasWebContext: false,
      latestUserPrompt: "inspect our app",
      selectedChunkIds: new Set(),
      settings: defaultProviderSettings,
      toolBridge: {
        capabilityPlan: {
          blockedReasons: [{
            code: "required_family_unavailable",
            detail: "None of the required tool families are provider-visible for this pass: files.",
          }],
          canCallProvider: false,
          intent: ["workspace_evidence"],
          mustUseTools: true,
          prompt: "inspect our app",
          providerFormat: "openai-compatible",
          providerVisibleToolIds: [],
          requiredFamilies: ["files"],
          selectedToolIds: ["files_read"],
          selectedTools: [readTool],
          toolChoice: "none",
        },
        providerVisibleToolIds: [],
        tools: [readTool],
      },
    });

    expect(prompt).toContain("- none");
    expect(prompt).toContain("Internal tool capability note");
    expect(prompt).toContain("no required provider-visible tools are attached");
    expect(prompt).toContain("phrase the limitation in plain user language");
    expect(prompt).not.toContain("Blocked gates");
    expect(prompt).not.toContain("- files:");
    expect(prompt).not.toContain("call files_read");
    expect(prompt).not.toContain("Use the real provider tool-call channel");
  });

  it("tells the model not to wrap ordinary answers in code fences", () => {
    const prompt = createRuntimeToolPrompt({
      hasLocalComputerContext: false,
      hasWebContext: false,
      latestUserPrompt: "answer normally",
      selectedChunkIds: new Set(),
      settings: defaultProviderSettings,
      toolBridge: {
        tools: [],
      },
    });

    expect(prompt).toContain("Do not wrap the whole answer in a fenced code block");
    expect(prompt).toContain("latest user message as the success condition");
    expect(prompt).toContain("call the tool instead of giving only a plan");
    expect(prompt).toContain("Do not claim done, fixed, updated, verified");
    expect(prompt).toContain("Be honest about uncertainty and limits");
    expect(prompt).toContain("senior-developer clear");
    expect(prompt).toContain("easy for non-experts to follow");
    expect(prompt).toContain("Default final responses should be concise, structured, and scannable");
    expect(prompt).toContain("**Changed Files**");
    expect(prompt).toContain("**Verification**");
    expect(prompt).toContain("go exhaustive only when the user explicitly asks for a full report or complete detail");
    expect(prompt).toContain("Use fenced code blocks only for actual code snippets");
    expect(prompt).toContain("always close every fence");
    expect(prompt).toContain("complete delimiter row");
    expect(prompt).toContain("ordinary summaries, plans, bullets, tables, or explanations");
    expect(prompt).toContain("Do not emit JSON envelopes, provider tool_calls");
  });
});
