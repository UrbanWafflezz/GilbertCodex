import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatToolCall } from "../../types/chat";
import { applyToolBridgeToProviderRequest } from "../adapters";
import { createProviderVisibleToolSchema } from "../adapters/sharedUtils";
import { createToolBridgeHealthAudit } from "../audit";
import { ToolBridgeOrchestrator, executeToolBridgeCalls } from "../orchestrator";
import { normalizeToolBridgePermissionMode, resolveToolPermission } from "../permissions";
import { createDefaultToolRegistry, ToolRegistry } from "../registry";
import { createMcpTools } from "../tools/mcp";
import { createToolCapabilityPlan, selectToolCapabilityPlan } from "../capabilityPlan";
import { selectAdvertisedBridgeTools, shouldAttachWebSearch } from "../selection";
import {
  __resetToolCallIdCounterForTests,
  parseAnthropicToolCalls,
  parseOpenAiCompatibleToolCalls,
  parseResponsesToolCalls,
  parseToolCallArgumentsDetailed,
  parseVisibleTextToolCalls,
} from "../parsers";
import type {
  ToolApprovalCallback,
  ToolBridgeTelemetryEvent,
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from "../types";
import { validateToolArguments } from "../validation";
import { safeStringify } from "../results";
import { finalizeToolResult, isVisibleToolResultLeak } from "../resultFinalizer";

const context: ToolExecutionContext = {
  model: "test-model",
  permissionMode: "default",
  provider: "openai",
};

beforeEach(() => {
  __resetToolCallIdCounterForTests();
});

describe("tool bridge permissions and registry", () => {
  it("migrates legacy permission modes to the simple bridge modes", () => {
    expect(normalizeToolBridgePermissionMode("ask-first")).toBe("default");
    expect(normalizeToolBridgePermissionMode("gilbert-review")).toBe("default");
    expect(normalizeToolBridgePermissionMode("read-only")).toBe("default");
    expect(normalizeToolBridgePermissionMode("full-workspace")).toBe("full-access");
    expect(normalizeToolBridgePermissionMode("auto-review")).toBe("auto-review");
  });

  it("exposes only allowed and provider-compatible tools by default", () => {
    const providerSpecificTool: ToolDefinition = {
      compatibleProviders: ["anthropic-messages"],
      description: "Only for Anthropic format.",
      execute: () => ({ content: "ok", ok: true }),
      id: "anthropic_only",
      inputSchema: { type: "object" },
      permission: "diagnostic",
      risk: "diagnostic",
      title: "Anthropic only",
    };
    const registry = new ToolRegistry([...createDefaultToolRegistry().list(), providerSpecificTool]);

    expect(registry.listForContext(context, "openai-compatible").some((tool) => tool.id === "bridge_echo")).toBe(true);
    expect(registry.listForContext(context, "openai-compatible").some((tool) => tool.id === "anthropic_only")).toBe(false);
    expect(registry.listForContext(context, "anthropic-messages").some((tool) => tool.id === "anthropic_only")).toBe(true);
  });

  it("registers search, batch read, range read, and tree summary file tools in the default bridge registry", () => {
    const registry = createDefaultToolRegistry();
    const visibleReadTools = registry
      .listForContext(context, "openai-compatible")
      .filter((tool) => tool.executorMetadata?.family === "files")
      .map((tool) => tool.id);

    expect(registry.get("files_search")).toBeDefined();
    expect(registry.get("files_read_many")).toBeDefined();
    expect(registry.get("files_read_range")).toBeDefined();
    expect(registry.get("files_tree_summary")).toBeDefined();
    expect(visibleReadTools).toContain("files_search");
    expect(visibleReadTools).toContain("files_read_many");
    expect(visibleReadTools).toContain("files_read_range");
    expect(visibleReadTools).toContain("files_tree_summary");
  });

  it("registers the diagnostic tool smoke test", () => {
    const registry = createDefaultToolRegistry();
    const visibleDiagnosticTools = registry
      .listForContext(context, "openai-compatible")
      .filter((tool) => tool.executorMetadata?.family === "diagnostic")
      .map((tool) => tool.id);

    expect(registry.get("tool_smoke_test")).toBeDefined();
    expect(visibleDiagnosticTools).toContain("tool_smoke_test");
  });

  it("selects prompt-relevant bridge tools and hides diagnostics from normal chat advertising", () => {
    const registry = createDefaultToolRegistry();
    const baseTools = registry.listForContext(context, "openai-compatible", { includePendingApproval: true });
    const selected = selectAdvertisedBridgeTools(baseTools, {
      prompt: "fix src/App.jsx and run the tests",
      webSearchEnabled: false,
    }).map((tool) => tool.id);

    expect(selected).toContain("files_read");
    expect(selected).toContain("files_edit_many");
    expect(selected).toContain("files_exact_replace");
    expect(selected).toContain("files_insert_at_line");
    expect(selected).toContain("files_replace_range");
    expect(selected).toContain("files_replace_span");
    expect(selected).toContain("files_append");
    expect(selected).toContain("files_apply_patch");
    expect(selected).toContain("terminal_run");
    expect(selected).toContain("terminal_list_sessions");
    expect(selected).toContain("terminal_read_session");
    expect(selected).toContain("terminal_dev_server_status");
    expect(selected).not.toContain("bridge_echo");
    expect(selected).not.toContain("bridge_sum");
    expect(selected).not.toContain("tool_smoke_test");
    expect(selected).not.toContain("web_search");
  });

  it("attaches terminal and copy tools for sibling project asset and clone workflows", () => {
    const registry = createDefaultToolRegistry();
    const baseTools = registry.listForContext(context, "openai-compatible", { includePendingApproval: true });
    const selected = selectAdvertisedBridgeTools(baseTools, {
      prompt: "clone another project and copy photos from that codebase into this Vite app",
      terminalEnabled: true,
      webSearchEnabled: false,
    }).map((tool) => tool.id);

    expect(selected).toContain("terminal_run");
    expect(selected).toContain("files_search");
    expect(selected).toContain("files_copy");
  });

  it("advertises edit tools for UI improvement prompts that do not name a file", () => {
    const registry = createDefaultToolRegistry();
    const baseTools = registry.listForContext(context, "openai-compatible", { includePendingApproval: true });
    const selected = selectAdvertisedBridgeTools(baseTools, {
      prompt: "make it better more readable better design and more party like",
      webSearchEnabled: false,
    }).map((tool) => tool.id);

    expect(selected).toContain("files_read_many");
    expect(selected).toContain("files_edit_many");
    expect(selected).toContain("files_apply_patch");
    expect(selected).toContain("files_write_many");
  });

  it("advertises edit tools for game improvement prompts that do not name a file", () => {
    const registry = createDefaultToolRegistry();
    const baseTools = registry.listForContext(context, "openai-compatible", { includePendingApproval: true });
    const selected = selectAdvertisedBridgeTools(baseTools, {
      prompt: "make the game better and add more things to do",
      webSearchEnabled: false,
    }).map((tool) => tool.id);

    expect(selected).toContain("files_search");
    expect(selected).toContain("files_read_many");
    expect(selected).toContain("files_edit_many");
    expect(selected).toContain("files_apply_patch");
  });

  it("advertises workspace edit tools for natural app navigation behavior requests", () => {
    const registry = createDefaultToolRegistry();
    const baseTools = registry.listForContext(context, "openai-compatible", { includePendingApproval: true });
    const selected = selectAdvertisedBridgeTools(baseTools, {
      prompt: "when user sends message from ghome screen it should go to a chat workplace page for the chat and ide like experinec",
      webSearchEnabled: false,
    }).map((tool) => tool.id);

    expect(selected).toContain("files_search");
    expect(selected).toContain("files_read_many");
    expect(selected).toContain("files_edit_many");
    expect(selected).toContain("files_apply_patch");
    expect(selected).toContain("files_write_many");
  });

  it("understands rough human wording and typos for prompt/runtime edits", () => {
    const registry = createDefaultToolRegistry();
    const baseTools = registry.listForContext(context, "openai-compatible", { includePendingApproval: true });
    const selected = selectAdvertisedBridgeTools(baseTools, {
      prompt: "we need to modiy prompt making it more human friendly and look into tool calls, do research and use web",
      webSearchEnabled: true,
    }).map((tool) => tool.id);

    expect(selected).toContain("files_search");
    expect(selected).toContain("files_read_many");
    expect(selected).toContain("files_edit_many");
    expect(selected).toContain("web_search");
  });

  it("advertises diagnostics and edit tools for broad tool-hardening requests", () => {
    const registry = createDefaultToolRegistry();
    const baseTools = registry.listForContext(context, "openai-compatible", { includePendingApproval: true });
    const selected = selectAdvertisedBridgeTools(baseTools, {
      prompt: "test our tools all of them and find bugs research in depth making these tools reliable work correctly always and extremely fast like Claude Code and ChatGPT Codex",
      webSearchEnabled: true,
    }).map((tool) => tool.id);

    expect(selected).toContain("tool_smoke_test");
    expect(selected).toContain("files_search");
    expect(selected).toContain("files_edit_many");
    expect(selected).toContain("terminal_run");
    expect(selected).toContain("web_search");
  });

  it("advertises edit tools for terse follow-ups using recent local-code context", () => {
    const registry = createDefaultToolRegistry();
    const baseTools = registry.listForContext(context, "openai-compatible", { includePendingApproval: true });
    const selected = selectAdvertisedBridgeTools(baseTools, {
      prompt: [
        "do the job",
        "Local-code conversation context for tool selection only:",
        "user: make it better more readable better design and more party like",
        "assistant: I see the files tool isn't attached.",
      ].join("\n"),
      webSearchEnabled: false,
    }).map((tool) => tool.id);

    expect(selected).toContain("files_read_many");
    expect(selected).toContain("files_edit_many");
    expect(selected).toContain("files_apply_patch");
    expect(selected).toContain("files_write_many");
  });

  it("keeps workspace tools reachable when a follow-up says tools disappeared", () => {
    const registry = createDefaultToolRegistry();
    const baseTools = registry.listForContext(context, "openai-compatible", { includePendingApproval: true });
    const selected = selectAdvertisedBridgeTools(baseTools, {
      prompt: [
        "do it",
        "Local-code conversation context for tool selection only:",
        "assistant: I don't have the workspace tools attached in this response.",
      ].join("\n"),
      webSearchEnabled: false,
    }).map((tool) => tool.id);

    expect(selected).toContain("memory_search");
    expect(selected).toContain("files_search");
    expect(selected).toContain("files_read_many");
    expect(selected).toContain("files_edit_many");
    expect(selected).toContain("files_apply_patch");
    expect(selected).toContain("files_write_many");
  });

  it("keeps Google Calendar tools reachable for terse re-check follow-ups with app context", () => {
    const registry = createDefaultToolRegistry();
    const baseTools = registry.listForContext(context, "openai-compatible", { includePendingApproval: true });
    const selected = selectAdvertisedBridgeTools(baseTools, {
      prompt: [
        "check 1 more time",
        "Recent app/tool conversation context for tool selection only:",
        "assistant: Your Google Calendar is connected for innovexiaweb@gmail.com.",
        "assistant: For today, Wednesday, May 20, 2026, I found no events on your primary calendar.",
      ].join("\n"),
      webSearchEnabled: false,
    }).map((tool) => tool.id);

    expect(selected).toContain("calendar_account");
    expect(selected).toContain("calendar_search_events");
    expect(selected).toContain("calendar_free_busy");
    expect(selected).not.toContain("calendar_create_event");
    expect(selected).not.toContain("calendar_delete_event");
  });

  it("advertises Google Calendar tools for common schedule typos", () => {
    const registry = createDefaultToolRegistry();
    const baseTools = registry.listForContext(context, "openai-compatible", { includePendingApproval: true });
    const selected = selectAdvertisedBridgeTools(baseTools, {
      prompt: "todays scehedule",
      webSearchEnabled: false,
    }).map((tool) => tool.id);

    expect(selected).toContain("calendar_account");
    expect(selected).toContain("calendar_search_events");
  });

  it("advertises Google Tasks and full Calendar write tools for Calendar task requests", () => {
    const registry = createDefaultToolRegistry();
    const baseTools = registry.listForContext(context, "openai-compatible", { includePendingApproval: true });
    const selected = selectAdvertisedBridgeTools(baseTools, {
      prompt: "create a Google Task to submit invoices tomorrow and make a new task list for finance",
      webSearchEnabled: false,
    }).map((tool) => tool.id);

    expect(selected).toContain("calendar_list_task_lists");
    expect(selected).toContain("calendar_create_task");
    expect(selected).toContain("calendar_create_task_list");
    expect(selected).toContain("calendar_api_write");
    expect(selected).not.toContain("files_edit_many");
  });

  it("advertises direct Gmail send tools for natural email send requests", () => {
    const registry = createDefaultToolRegistry();
    const baseTools = registry.listForContext(context, "openai-compatible", { includePendingApproval: true });
    const selected = selectAdvertisedBridgeTools(baseTools, {
      prompt: "send a email to elijahkobejoe@gmail.com subject work and say he has to job interview tuesday make it professional",
      webSearchEnabled: false,
    }).map((tool) => tool.id);

    expect(selected).toContain("gmail_account");
    expect(selected).toContain("gmail_create_draft");
    expect(selected).toContain("gmail_send_message");
    expect(selected).toContain("gmail_send_separate_messages");
    expect(selected).not.toContain("gmail_trash_message");
    expect(selected).not.toContain("gmail_api_delete");
    expect(selected).not.toContain("files_edit_many");
    expect(selected).not.toContain("files_copy");
  });

  it("adds local code and Git context tools for project-aware Gmail composition", () => {
    const registry = createDefaultToolRegistry();
    const baseTools = registry.listForContext(context, "openai-compatible", { includePendingApproval: true });
    const selected = selectAdvertisedBridgeTools(baseTools, {
      prompt: "send an email to dev@example.com about the current tool integration with Gilbert Codex",
      webSearchEnabled: false,
    }).map((tool) => tool.id);

    expect(selected).toContain("gmail_account");
    expect(selected).toContain("gmail_send_message");
    expect(selected).toContain("files_search");
    expect(selected).toContain("files_read_many");
    expect(selected).toContain("files_tree_summary");
    expect(selected).toContain("git_status");
    expect(selected).toContain("git_diff");
    expect(selected).toContain("memory_search");
    expect(selected).not.toContain("files_edit_many");
    expect(selected).not.toContain("files_copy");
  });

  it("keeps full Gmail read and generic Gmail API tools registered with aliases", () => {
    const registry = createDefaultToolRegistry();
    const advertisedToolIds = registry.listForContext(context, "openai-compatible").map((tool) => tool.id);

    expect(advertisedToolIds).toContain("gmail_read_full_message");
    expect(advertisedToolIds).toContain("gmail_read_full_thread");
    expect(registry.get("gmail.api_read")?.id).toBe("gmail_api_read");
    expect(registry.get("gmail.api_write")?.id).toBe("gmail_api_write");
    expect(registry.get("gmail.api_delete")?.id).toBe("gmail_api_delete");
    expect(registry.get("gmail_send")?.id).toBe("gmail_send_message");
  });

  it("advertises broad GitHub read tools for issues, PRs, Actions, tags, and stats without lifecycle writes", () => {
    const registry = createDefaultToolRegistry();
    const baseTools = registry.listForContext(context, "openai-compatible", { includePendingApproval: true });
    const selected = selectAdvertisedBridgeTools(baseTools, {
      prompt: "use GitHub to check stars forks tags branches issues PRs and actions for this repo",
      webSearchEnabled: false,
    }).map((tool) => tool.id);

    expect(selected).toContain("github_account");
    expect(selected).toContain("github_get_repository");
    expect(selected).toContain("github_list_tags");
    expect(selected).toContain("github_list_issues");
    expect(selected).toContain("github_list_completed_issues");
    expect(selected).not.toContain("github_close_issue");
    expect(selected).not.toContain("github_create_issue");
    expect(selected).toContain("github_list_pull_requests");
    expect(selected).toContain("github_list_pull_request_files");
    expect(selected).not.toContain("github_create_pull_request");
    expect(selected).not.toContain("github_merge_pull_request");
    expect(selected).toContain("github_list_workflows");
    expect(selected).toContain("github_list_workflow_runs");
    expect(selected).toContain("github_list_workflow_run_jobs");
    expect(selected).not.toContain("github_dispatch_workflow");
    expect(selected).not.toContain("github_cancel_workflow_run");
    expect(selected).toContain("github_semantic_search");
    expect(selected).not.toContain("git_status");
    expect(selected).not.toContain("git_diff");
  });

  it("advertises GitHub issue lifecycle tools for terse completion follow-ups", () => {
    const registry = createDefaultToolRegistry();
    const baseTools = registry.listForContext(context, "openai-compatible", { includePendingApproval: true });
    const selected = selectAdvertisedBridgeTools(baseTools, {
      prompt: "complete them and close the issues in GitHub",
      webSearchEnabled: false,
    }).map((tool) => tool.id);

    expect(selected).toContain("github_close_issue");
    expect(selected).toContain("github_list_completed_issues");
    expect(selected).toContain("github_reopen_issue");
    expect(selected).toContain("github_mark_issue_duplicate");
    expect(selected).toContain("github_comment_issue");
  });

  it("advertises completed issue reads for completed issue questions", () => {
    const registry = createDefaultToolRegistry();
    const baseTools = registry.listForContext(context, "openai-compatible", { includePendingApproval: true });
    const selected = selectAdvertisedBridgeTools(baseTools, {
      prompt: "what issues have all been completed in this repo",
      webSearchEnabled: false,
    }).map((tool) => tool.id);

    expect(selected).toContain("github_list_completed_issues");
    expect(selected).toContain("github_search_issues");
    expect(selected).toContain("github_list_issues");
  });

  it("does not attach fallback tools for conversation-only acknowledgements", () => {
    const registry = createDefaultToolRegistry();
    const baseTools = registry.listForContext(context, "openai-compatible", { includePendingApproval: true });
    const selected = selectAdvertisedBridgeTools(baseTools, {
      prompt: "ok",
      webSearchEnabled: true,
    }).map((tool) => tool.id);

    expect(selected).toEqual([]);
  });

  it("can suppress memory search for execution-critical passes", () => {
    const registry = createDefaultToolRegistry();
    const baseTools = registry.listForContext(context, "openai-compatible", { includePendingApproval: true });
    const selected = selectAdvertisedBridgeTools(baseTools, {
      memoryEnabled: false,
      prompt: "fix src/App.jsx and run the tests",
      webSearchEnabled: false,
    }).map((tool) => tool.id);

    expect(selected).toContain("files_read");
    expect(selected).not.toContain("memory_search");
  });

  it("advertises MCP tools for explicit MCP requests even when old settings have MCP disabled", () => {
    const registry = createDefaultToolRegistry();
    const baseTools = registry.listForContext(context, "openai-compatible", { includePendingApproval: true });
    const selected = selectAdvertisedBridgeTools(baseTools, {
      mcpServersEnabled: false,
      prompt: "Use my Local Echo MCP server. List MCP servers, list its tools, then call echo.",
      webSearchEnabled: false,
    }).map((tool) => tool.id);

    expect(selected).toContain("mcp_list_servers");
    expect(selected).toContain("mcp_list_tools");
    expect(selected).toContain("mcp_call_tool");
  });

  it("advertises MCP tools for known connected-service requests", () => {
    const registry = createDefaultToolRegistry();
    const baseTools = registry.listForContext(context, "openai-compatible", { includePendingApproval: true });
    const selected = selectAdvertisedBridgeTools(baseTools, {
      mcpServersEnabled: true,
      prompt: "Check Firebase project status and inspect Figma design context.",
      webSearchEnabled: false,
    }).map((tool) => tool.id);

    expect(selected).toContain("mcp_list_servers");
    expect(selected).toContain("mcp_list_tools");
    expect(selected).toContain("mcp_call_tool");
  });

  it("advertises MCP discovery for marketplace plugin service names beyond curated presets", () => {
    const registry = createDefaultToolRegistry();
    const baseTools = registry.listForContext(context, "openai-compatible", { includePendingApproval: true });
    const slackSelected = selectAdvertisedBridgeTools(baseTools, {
      mcpServersEnabled: true,
      prompt: "Use the Slack plugin to post a launch update.",
      webSearchEnabled: false,
    }).map((tool) => tool.id);
    const netlifySelected = selectAdvertisedBridgeTools(baseTools, {
      mcpServersEnabled: true,
      prompt: "Check Netlify deploy logs and publish the latest site.",
      terminalEnabled: true,
      webSearchEnabled: false,
    }).map((tool) => tool.id);
    const goDaddySelected = selectAdvertisedBridgeTools(baseTools, {
      mcpServersEnabled: true,
      prompt: "Use GoDaddy MCP to check whether my launch domain is available.",
      webSearchEnabled: false,
    }).map((tool) => tool.id);

    expect(slackSelected).toContain("mcp_list_servers");
    expect(slackSelected).toContain("mcp_list_tools");
    expect(slackSelected).toContain("mcp_call_tool");
    expect(goDaddySelected).toContain("mcp_list_servers");
    expect(goDaddySelected).toContain("mcp_list_tools");
    expect(goDaddySelected).toContain("mcp_call_tool");
    expect(netlifySelected).toContain("mcp_list_servers");
    expect(netlifySelected).toContain("mcp_list_tools");
    expect(netlifySelected).toContain("mcp_call_tool");
    expect(netlifySelected).toContain("terminal_run");
  });

  it("advertises terminal recovery tools alongside MCP for Firebase deploys", () => {
    const registry = createDefaultToolRegistry();
    const baseTools = registry.listForContext(context, "openai-compatible", { includePendingApproval: true });
    const selected = selectAdvertisedBridgeTools(baseTools, {
      mcpServersEnabled: true,
      prompt: "deploy my Firebase app and track status",
      terminalEnabled: true,
      webSearchEnabled: false,
    }).map((tool) => tool.id);

    expect(selected).toContain("mcp_list_servers");
    expect(selected).toContain("mcp_list_tools");
    expect(selected).toContain("mcp_call_tool");
    expect(selected).toContain("terminal_run");
    expect(selected).toContain("terminal_read_session");
  });

  it("advertises MCP discovery for generic hosting deploy requests when MCP is enabled", () => {
    const registry = createDefaultToolRegistry();
    const baseTools = registry.listForContext(context, "openai-compatible", { includePendingApproval: true });
    const selected = selectAdvertisedBridgeTools(baseTools, {
      mcpServersEnabled: true,
      prompt: "update the website and deploy it to hosting",
      terminalEnabled: true,
      webSearchEnabled: false,
    }).map((tool) => tool.id);

    expect(selected).toContain("mcp_list_servers");
    expect(selected).toContain("mcp_list_tools");
    expect(selected).toContain("mcp_call_tool");
    expect(selected).toContain("terminal_run");
  });

  it("advertises MCP inventory tools for capability questions when MCP is enabled", () => {
    const registry = createDefaultToolRegistry();
    const baseTools = registry.listForContext(context, "openai-compatible", { includePendingApproval: true });
    const selected = selectAdvertisedBridgeTools(baseTools, {
      mcpServersEnabled: true,
      prompt: "what tools and connected apps do you have set up?",
      webSearchEnabled: false,
    }).map((tool) => tool.id);

    expect(selected).toContain("mcp_list_servers");
    expect(selected).toContain("mcp_list_tools");
    expect(selected).toContain("mcp_call_tool");
  });

  it("lists and calls MCP tools through the bridge backend", async () => {
    const server = {
      args: ["echo.js"],
      command: "node",
      enabled: true,
      environment: [],
      headers: [],
      hasAuthorizationToken: false,
      id: "local-echo",
      name: "Local Echo",
      tools: [{
        description: "Echo a message back.",
        inputSchema: {
          properties: { message: { type: "string" } },
          required: ["message"],
          type: "object",
        },
        name: "echo",
      }],
      transport: "stdio" as const,
    };
    const state = {
      connected: true,
      enabledServerCount: 1,
      maxServers: 50,
      servers: [server],
    };
    const [listServers, listTools, callTool] = createMcpTools({
      callTool: async (request) => ({
        content: `hello ${String(request.arguments?.message ?? "")}`,
        isError: false,
        ok: true,
        rawResult: { content: [{ text: "hello from test", type: "text" }] },
        server,
        structuredContent: { message: request.arguments?.message ?? "" },
        toolName: request.toolName,
      }),
      getState: async () => state,
      listTools: async () => ({
        server,
        state,
        tools: server.tools,
      }),
    });

    const serverList = await listServers!.execute({}, context);
    const toolList = await listTools!.execute({ serverId: "local-echo" }, context);
    const toolResult = await callTool!.execute({ arguments: { message: "from Gilbert" }, serverId: "local-echo", toolName: "echo" }, context);

    expect(serverList.ok).toBe(true);
    expect(serverList.content).toContain("local-echo");
    expect(toolList.ok).toBe(true);
    expect(toolList.content).toContain("Input schema");
    expect(toolResult.ok).toBe(true);
    expect(toolResult.content).toContain("hello from Gilbert");
  });

  it("filters MCP inventory and calls to the automation MCP scope", async () => {
    const localEcho = {
      args: ["echo.js"],
      command: "node",
      enabled: true,
      environment: [],
      headers: [],
      hasAuthorizationToken: false,
      id: "local-echo",
      name: "Local Echo",
      tools: [
        { description: "Echo a message back.", name: "echo" },
        { description: "Delete something.", name: "delete_everything" },
      ],
      transport: "stdio" as const,
    };
    const firebase = {
      args: ["firebase-tools@latest", "mcp"],
      command: "npx.cmd",
      enabled: true,
      environment: [],
      headers: [],
      hasAuthorizationToken: false,
      id: "firebase",
      name: "Firebase",
      tools: [{ description: "Check deploy status.", name: "firebase_deploy_status" }],
      transport: "stdio" as const,
    };
    const state = {
      connected: true,
      enabledServerCount: 2,
      maxServers: 50,
      servers: [localEcho, firebase],
    };
    const [listServers, listTools, callTool] = createMcpTools({
      callTool: async (request) => ({
        content: `called ${request.serverId}/${request.toolName}`,
        isError: false,
        ok: true,
        rawResult: {},
        server: localEcho,
        toolName: request.toolName,
      }),
      getState: async () => state,
      listTools: async () => ({
        server: localEcho,
        state,
        tools: localEcho.tools,
      }),
    });
    const scopedContext: ToolExecutionContext = {
      ...context,
      automationScope: {
        allowedFamilies: ["mcp"],
        allowedMcpServers: [{ serverId: "local-echo", toolNames: ["echo"] }],
        allowedToolIds: ["mcp_list_servers", "mcp_list_tools", "mcp_call_tool"],
        autonomous: true,
        taskId: "task-1",
      },
    };

    const serverList = await listServers!.execute({}, scopedContext);
    const toolList = await listTools!.execute({ serverId: "local-echo" }, scopedContext);
    const blockedServer = await listTools!.execute({ serverId: "firebase" }, scopedContext);
    const blockedTool = await callTool!.execute({ serverId: "local-echo", toolName: "delete_everything" }, scopedContext);
    const allowedTool = await callTool!.execute({ serverId: "local-echo", toolName: "echo" }, scopedContext);

    expect(serverList.content).toContain("local-echo");
    expect(serverList.content).not.toContain("firebase");
    expect(toolList.content).toContain("echo");
    expect(toolList.content).not.toContain("delete_everything");
    expect(blockedServer.ok).toBe(false);
    expect(blockedTool.ok).toBe(false);
    expect(allowedTool.ok).toBe(true);
  });

  it("surfaces structured MCP errors when text logs are empty", async () => {
    const server = {
      args: ["firebase-tools@latest", "mcp"],
      command: "npx.cmd",
      enabled: true,
      environment: [],
      headers: [],
      hasAuthorizationToken: false,
      id: "firebase",
      name: "Firebase",
      tools: [{
        description: "Check deploy status.",
        inputSchema: {
          properties: { jobId: { type: "string" } },
          required: ["jobId"],
          type: "object",
        },
        name: "firebase_deploy_status",
      }],
      transport: "stdio" as const,
    };
    const state = {
      connected: true,
      enabledServerCount: 1,
      maxServers: 50,
      servers: [server],
    };
    const callTool = createMcpTools({
      callTool: async (request) => ({
        content: "Job ID: 1779662380537\nStatus: failed\nProgress: 0%\n\nLogs:\n",
        isError: false,
        ok: true,
        rawResult: { content: [{ text: "Job ID: 1779662380537\nStatus: failed\nProgress: 0%\n\nLogs:\n", type: "text" }] },
        server,
        structuredContent: {
          error: "Expected to be in a project directory, but none was found.",
          logs: [],
          progress: 0,
          status: "failed",
        },
        toolName: request.toolName,
      }),
      getState: async () => state,
      listTools: async () => ({
        server,
        state,
        tools: server.tools,
      }),
    }).find((tool) => tool.id === "mcp_call_tool");

    const result = await callTool!.execute({ arguments: { jobId: "1779662380537" }, serverId: "firebase", toolName: "firebase_deploy_status" }, context);

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Logs:");
    expect(result.content).toContain("--- Structured content ---");
    expect(result.content).toContain("Error: Expected to be in a project directory");
  });

  it("advertises web only for source-backed/current prompts when enabled", () => {
    const registry = createDefaultToolRegistry();
    const baseTools = registry.listForContext(context, "openai-compatible", { includePendingApproval: true });
    const webSelected = selectAdvertisedBridgeTools(baseTools, {
      prompt: "look up the latest official docs online",
      webSearchEnabled: true,
    }).map((tool) => tool.id);
    const localWithOfficialDocs = selectAdvertisedBridgeTools(baseTools, {
      prompt: "check our local adapter code against the latest official API docs",
      webSearchEnabled: true,
    }).map((tool) => tool.id);
    const localDocsOnly = selectAdvertisedBridgeTools(baseTools, {
      prompt: "read the local docs in this workspace",
      webSearchEnabled: true,
    }).map((tool) => tool.id);
    const localOnly = selectAdvertisedBridgeTools(baseTools, {
      prompt: "fix the local settings panel",
      webSearchEnabled: true,
    }).map((tool) => tool.id);
    const localFollowupWithContext = selectAdvertisedBridgeTools(baseTools, {
      prompt: [
        "what providers does it work with",
        "",
        "Local-code conversation context for tool selection only:",
        "assistant: The provider settings live in src/lib/models.ts.",
        "If the user is asking about the selected workspace, gather fresh workspace evidence before the final answer.",
      ].join("\n"),
      webSearchEnabled: true,
    }).map((tool) => tool.id);
    const externalCurrentWithContext = selectAdvertisedBridgeTools(baseTools, {
      prompt: [
        "verify whether GTA 6's release date changed today",
        "",
        "Local-code conversation context for tool selection only:",
        "assistant: The provider settings live in src/lib/models.ts.",
      ].join("\n"),
      webSearchEnabled: true,
    }).map((tool) => tool.id);
    const releaseDatePrompt = selectAdvertisedBridgeTools(baseTools, {
      prompt: "GTA 6 release daye",
      webSearchEnabled: true,
    }).map((tool) => tool.id);
    const webDisabled = selectAdvertisedBridgeTools(baseTools, {
      prompt: "look up the latest docs online",
      webSearchEnabled: false,
    }).map((tool) => tool.id);
    const diagnosticSelected = selectAdvertisedBridgeTools(baseTools, {
      prompt: "run the tool smoke test",
      webSearchEnabled: false,
    }).map((tool) => tool.id);

    expect(webSelected).toContain("web_search");
    expect(localWithOfficialDocs).toContain("web_search");
    expect(localDocsOnly).not.toContain("web_search");
    expect(localOnly).not.toContain("web_search");
    expect(localFollowupWithContext).not.toContain("web_search");
    expect(externalCurrentWithContext).toContain("web_search");
    expect(releaseDatePrompt).toContain("web_search");
    expect(releaseDatePrompt).not.toContain("github_list_releases");
    expect(releaseDatePrompt).not.toContain("github_create_release");
    expect(webDisabled).not.toContain("web_search");
    expect(diagnosticSelected).toContain("tool_smoke_test");
  });

  it("plans provider-visible workspace tools when fresh workspace evidence is required", () => {
    const registry = createDefaultToolRegistry();
    const baseTools = registry.listForContext(context, "openai-compatible", { includePendingApproval: true });
    const plan = selectToolCapabilityPlan({
      availableTools: baseTools,
      browserPreviewEnabled: true,
      editingEnabled: true,
      fileToolsEnabled: true,
      gitEnabled: true,
      mustUseTools: true,
      prompt: "inspect our app tool calling path",
      providerFormat: "openai-compatible",
      requiredFamilies: ["files", "editing", "git", "terminal", "browser"],
      terminalEnabled: true,
      webSearchEnabled: false,
    });

    expect(plan.canCallProvider).toBe(true);
    expect(plan.toolChoice).toBe("required");
    expect(plan.providerVisibleToolIds).toEqual(expect.arrayContaining(["files_read", "files_read_many", "files_search"]));
  });

  it("blocks provider calls when required workspace tools are disabled before selection", () => {
    const registry = createDefaultToolRegistry();
    const baseTools = registry.listForContext(context, "openai-compatible", { includePendingApproval: true });
    const plan = selectToolCapabilityPlan({
      availableTools: baseTools,
      browserPreviewEnabled: false,
      editingEnabled: false,
      fileToolsEnabled: false,
      gitEnabled: false,
      memoryEnabled: false,
      mustUseTools: true,
      prompt: "inspect our app tool calling path",
      providerFormat: "openai-compatible",
      requiredFamilies: ["files", "editing", "git", "terminal", "browser"],
      terminalEnabled: false,
      webSearchEnabled: false,
    });

    expect(plan.selectedToolIds).not.toContain("files_read");
    expect(plan.providerVisibleToolIds).toEqual([]);
    expect(plan.canCallProvider).toBe(false);
    expect(plan.toolChoice).toBe("none");
    expect(plan.blockedReasons.map((reason) => reason.code)).toContain("required_family_unavailable");
  });

  it("blocks mutation-required passes when only read tools are provider-visible", () => {
    const registry = createDefaultToolRegistry();
    const baseTools = registry.listForContext(context, "openai-compatible", { includePendingApproval: true });
    const plan = selectToolCapabilityPlan({
      availableTools: baseTools,
      browserPreviewEnabled: false,
      editingEnabled: false,
      fileToolsEnabled: true,
      gitEnabled: false,
      mustUseTools: true,
      prompt: "inspect the game project",
      providerFormat: "openai-compatible",
      requiredFamilies: ["files", "editing"],
      terminalEnabled: false,
      toolIntent: ["workspace_mutation"],
      webSearchEnabled: false,
    });

    expect(plan.providerVisibleToolIds).toEqual(expect.arrayContaining(["files_read", "files_read_many"]));
    expect(plan.providerVisibleToolIds).not.toContain("files_edit_many");
    expect(plan.canCallProvider).toBe(false);
    expect(plan.toolChoice).toBe("none");
    expect(plan.blockedReasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "required_family_unavailable", family: "editing" }),
    ]));
  });

  it("uses tool_choice none when the tool budget is already reached", () => {
    const webTool = createDefaultToolRegistry().get("web_search");
    expect(webTool).toBeDefined();

    const plan = createToolCapabilityPlan({
      mustUseTools: true,
      prompt: "look up the latest docs",
      providerFormat: "openai-compatible",
      requiredFamilies: ["web"],
      selectedTools: webTool ? [webTool] : [],
      toolBudgetReached: true,
      toolIntent: ["web_search"],
    });

    expect(plan.providerVisibleToolIds).toEqual([]);
    expect(plan.canCallProvider).toBe(false);
    expect(plan.toolChoice).toBe("none");
    expect(plan.blockedReasons.map((reason) => reason.code)).toContain("tool_budget_reached");
  });

  it("treats release and launch timing prompts as live-web evidence", () => {
    expect(shouldAttachWebSearch("GTA 6 release date")).toBe(true);
    expect(shouldAttachWebSearch("GTA 6 release daye")).toBe(true);
    expect(shouldAttachWebSearch("when is the Switch 2 game coming out")).toBe(true);
    expect(shouldAttachWebSearch("check the local docs in this repo")).toBe(false);
  });

  it("respects active runtime toggles when advertising terminal and preview tools", () => {
    const registry = createDefaultToolRegistry();
    const baseTools = registry.listForContext(context, "openai-compatible", { includePendingApproval: true });
    const selected = selectAdvertisedBridgeTools(baseTools, {
      browserPreviewEnabled: false,
      prompt: "start the dev server and open a localhost preview",
      terminalEnabled: false,
      webSearchEnabled: true,
    }).map((tool) => tool.id);

    expect(selected).not.toContain("terminal_run");
    expect(selected).not.toContain("browser_preview_open");
    expect(selected).not.toContain("browser_screenshot_capture");
    expect(selected).not.toContain("browser_console_read");
  });

  it("advertises run diagnostics for 9router subscription routes without provider-specific tool changes", () => {
    const registry = createDefaultToolRegistry();
    const subscriptionContext: ToolExecutionContext = {
      ...context,
      model: "cx/gpt-5.5",
      provider: "9router",
    };
    const baseTools = registry.listForContext(subscriptionContext, "openai-compatible", { includePendingApproval: true });
    const selected = selectAdvertisedBridgeTools(baseTools, {
      browserPreviewEnabled: true,
      prompt: "planning mode: run app, start dev server, debug browser error",
      terminalEnabled: true,
      webSearchEnabled: false,
    }).map((tool) => tool.id);

    expect(selected).toContain("terminal_run");
    expect(selected).toContain("terminal_list_sessions");
    expect(selected).toContain("terminal_read_session");
    expect(selected).toContain("terminal_dev_server_status");
    expect(selected).toContain("browser_preview_open");
    expect(selected).toContain("browser_screenshot_capture");
    expect(selected).toContain("browser_console_read");
  });

  it("advertises workspace read tools for provider configuration follow-ups", () => {
    const registry = createDefaultToolRegistry();
    const baseTools = registry.listForContext(context, "openai-compatible", { includePendingApproval: true });
    const selected = selectAdvertisedBridgeTools(baseTools, {
      prompt: "what providers does it work with",
      webSearchEnabled: false,
    }).map((tool) => tool.id);

    expect(selected).toContain("files_search");
    expect(selected).toContain("files_read_many");
    expect(selected).not.toContain("web_search");
  });

  it("advertises browser preview for website and visual verification prompts", () => {
    const registry = createDefaultToolRegistry();
    const baseTools = registry.listForContext(context, "openai-compatible", { includePendingApproval: true });
    const selected = selectAdvertisedBridgeTools(baseTools, {
      browserPreviewEnabled: true,
      prompt: "check this website page visually and make sure it looks right",
      webSearchEnabled: false,
    }).map((tool) => tool.id);

    expect(selected).toContain("browser_preview_open");
    expect(selected).toContain("browser_screenshot_capture");
    expect(selected).toContain("browser_console_read");
  });

  it("advertises browser console access for console debugging prompts", () => {
    const registry = createDefaultToolRegistry();
    const baseTools = registry.listForContext(context, "openai-compatible", { includePendingApproval: true });
    const selected = selectAdvertisedBridgeTools(baseTools, {
      browserPreviewEnabled: true,
      prompt: "read the browser console and fix the website error",
      webSearchEnabled: false,
    }).map((tool) => tool.id);

    expect(selected).toContain("browser_screenshot_capture");
    expect(selected).toContain("browser_console_read");
  });

  it("advertises folder creation for folder prompts without relying on terminal mkdir", () => {
    const registry = createDefaultToolRegistry();
    const baseTools = registry.listForContext(context, "openai-compatible", { includePendingApproval: true });
    const selected = selectAdvertisedBridgeTools(baseTools, {
      prompt: "create a folder for the new chat feature",
      webSearchEnabled: false,
    }).map((tool) => tool.id);

    expect(selected).toContain("files_create_directory");
  });

  it("keeps local git prompts out of GitHub and editing schema profiles", () => {
    const registry = createDefaultToolRegistry();
    const baseTools = registry.listForContext(context, "openai-compatible", { includePendingApproval: true });
    const selected = selectAdvertisedBridgeTools(baseTools, {
      prompt: "git status and diff this branch",
      webSearchEnabled: false,
    }).map((tool) => tool.id);

    expect(selected).toContain("git_status");
    expect(selected).toContain("git_diff");
    expect(selected).not.toContain("github_create_release");
    expect(selected).not.toContain("files_exact_replace");
  });

  it("advertises local git read tools for change review wording without explicit git terms", () => {
    const registry = createDefaultToolRegistry();
    const baseTools = registry.listForContext(context, "openai-compatible", { includePendingApproval: true });
    const selected = selectAdvertisedBridgeTools(baseTools, {
      prompt: "Based on the files read, explain what changed and what the fixes appear to be.",
      webSearchEnabled: false,
    }).map((tool) => tool.id);

    expect(selected).toContain("git_status");
    expect(selected).toContain("git_diff");
    expect(selected).not.toContain("git_commit");
    expect(selected).not.toContain("github_create_release");
  });

  it("keeps release prompts focused on Git and GitHub release tools", () => {
    const registry = createDefaultToolRegistry();
    const baseTools = registry.listForContext(context, "openai-compatible", { includePendingApproval: true });
    const selected = selectAdvertisedBridgeTools(baseTools, {
      prompt: "push this to git and create a GitHub release",
      webSearchEnabled: false,
    }).map((tool) => tool.id);

    expect(selected).toContain("git_push");
    expect(selected).toContain("github_create_release");
    expect(selected).toContain("github_generate_release_notes");
    expect(selected).not.toContain("files_write_many");
    expect(selected).not.toContain("files_exact_replace");
  });

  it("keeps common schema profiles under regression budgets", () => {
    const registry = createDefaultToolRegistry();
    const baseTools = registry.listForContext(context, "openai-compatible", { includePendingApproval: true });
    const estimateSchemaTokens = (tools: ToolDefinition[]) =>
      Math.ceil(JSON.stringify(tools.map(createProviderVisibleToolSchema)).length / 4);
    const codeTools = selectAdvertisedBridgeTools(baseTools, {
      prompt: "fix src/App.jsx and run the tests",
      webSearchEnabled: false,
    });
    const simpleTools = selectAdvertisedBridgeTools(baseTools, {
      prompt: "summarize this conversation",
      webSearchEnabled: false,
    });
    const githubReadTools = selectAdvertisedBridgeTools(baseTools, {
      prompt: "use GitHub to check stars forks tags branches issues PRs and actions for this repo",
      webSearchEnabled: false,
    });
    const gmailSendTools = selectAdvertisedBridgeTools(baseTools, {
      prompt: "send an email to teammate@example.com with a professional update",
      webSearchEnabled: false,
    });
    const calendarAgendaTools = selectAdvertisedBridgeTools(baseTools, {
      prompt: "show today's Google Calendar agenda and free time",
      webSearchEnabled: false,
    });
    const mcpTools = selectAdvertisedBridgeTools(baseTools, {
      mcpServersEnabled: true,
      prompt: "list MCP servers, list tools, then call the selected MCP tool",
      webSearchEnabled: false,
    });
    const webTools = selectAdvertisedBridgeTools(baseTools, {
      prompt: "look up the latest official docs online",
      webSearchEnabled: true,
    });

    expect(estimateSchemaTokens(simpleTools)).toBeLessThan(500);
    expect(estimateSchemaTokens(codeTools)).toBeLessThan(5000);
    expect(estimateSchemaTokens(githubReadTools)).toBeLessThan(7000);
    expect(estimateSchemaTokens(gmailSendTools)).toBeLessThan(4500);
    expect(estimateSchemaTokens(calendarAgendaTools)).toBeLessThan(3000);
    expect(estimateSchemaTokens(mcpTools)).toBeLessThan(1800);
    expect(estimateSchemaTokens(webTools)).toBeLessThan(800);
    expect(codeTools.map((tool) => tool.id)).toContain("files_edit_many");
    expect(codeTools.map((tool) => tool.id)).toContain("files_replace_range");
    expect(codeTools.map((tool) => tool.id)).toContain("files_replace_span");
    expect(githubReadTools.map((tool) => tool.id)).not.toContain("github_api_delete");
    expect(gmailSendTools.map((tool) => tool.id)).not.toContain("gmail_trash_message");
    expect(mcpTools.map((tool) => tool.id)).toEqual(["mcp_list_servers", "mcp_list_tools", "mcp_call_tool"]);
  });

  it("retains concise parameter guidance only for complex provider-visible schemas", () => {
    const registry = createDefaultToolRegistry();
    const gmailSend = registry.get("gmail_send_message");
    const mcpCall = registry.get("mcp_call_tool");
    const fileRead = registry.get("files_read");
    const fileEditMany = registry.get("files_edit_many");
    const fileWriteMany = registry.get("files_write_many");

    expect(gmailSend).toBeDefined();
    expect(mcpCall).toBeDefined();
    expect(fileRead).toBeDefined();
    expect(fileEditMany).toBeDefined();
    expect(fileWriteMany).toBeDefined();

    const gmailSchema = createProviderVisibleToolSchema(gmailSend!);
    const mcpSchema = createProviderVisibleToolSchema(mcpCall!);
    const readSchema = createProviderVisibleToolSchema(fileRead!);
    const editSchema = createProviderVisibleToolSchema(fileEditMany!);
    const writeSchema = createProviderVisibleToolSchema(fileWriteMany!);
    const editSchemaText = JSON.stringify(editSchema.inputSchema);
    const writeSchemaText = JSON.stringify(writeSchema.inputSchema);

    expect(JSON.stringify(gmailSchema.inputSchema)).toContain("Optional sender header");
    expect(JSON.stringify(mcpSchema.inputSchema)).toContain("Exact MCP tool name");
    expect(editSchemaText).toContain("Workspace-relative file path");
    expect(editSchemaText).toContain("ensureNewline");
    expect(editSchemaText).toContain("replace_span");
    expect(editSchemaText).toContain("startColumn");
    expect(editSchemaText).toContain("endColumn");
    expect(editSchemaText).not.toContain("insertNewlineBeforeContent");
    expect(writeSchemaText).toContain("createParentDirs");
    expect(writeSchemaText).toContain("forceEol");
    expect(writeSchemaText).toContain("overwrite");
    expect(writeSchemaText).not.toContain("allowOverwrite");
    expect(writeSchemaText).not.toContain("lineEnding");
    expect(JSON.stringify(readSchema.inputSchema)).not.toContain("description");
  });

  it("creates a repeatable tool health audit across canonical prompt families", () => {
    const report = createToolBridgeHealthAudit({
      runtimeBudget: {
        maxExecutions: 48,
        maxPasses: 12,
        maxToolResultContentChars: 120_000,
      },
    });
    const byId = new Map(report.scenarios.map((scenario) => [scenario.id, scenario]));
    const githubReview = byId.get("github_review");
    const gmailSend = byId.get("gmail_send");
    const webDocs = byId.get("web_docs");

    expect(report.registryToolCount).toBeGreaterThan(150);
    expect(report.runtimeBudget.maxExecutions).toBe(48);
    expect(githubReview?.selectedToolIds).toContain("github_list_issues");
    expect(githubReview?.selectedToolIds).not.toContain("github_close_issue");
    expect(gmailSend?.selectedToolIds).toContain("gmail_send_message");
    expect(gmailSend?.selectedToolIds).not.toContain("gmail_trash_message");
    expect(webDocs?.selectedToolIds).toEqual(["web_search"]);
    expect(report.scenarios.every((scenario) => scenario.schedulerSegments.length > 0 || scenario.selectedToolCount === 0)).toBe(true);
  });

  it("registers local Git and GitHub bridge tools", () => {
    const registry = createDefaultToolRegistry();

    expect(registry.get("git_status")).toBeDefined();
    expect(registry.get("git_diff")).toBeDefined();
    expect(registry.get("git.commit")?.id).toBe("git_commit");
    expect(registry.get("github_list_repositories")).toBeDefined();
    expect(registry.get("github.read_file")?.id).toBe("github_read_file");
  });

  it("registers the web search bridge tool and common web aliases", () => {
    const registry = createDefaultToolRegistry();
    const advertisedToolIds = registry.listForContext(context, "openai-compatible").map((tool) => tool.id);

    expect(registry.get("web_search")).toBeDefined();
    expect(registry.get("web")?.id).toBe("web_search");
    expect(registry.get("brave_search")?.id).toBe("web_search");
    expect(registry.get("duckduckgo.search")?.id).toBe("web_search");
    expect(advertisedToolIds).toContain("web_search");
  });

  it("registers Google Calendar full-access and Tasks aliases", () => {
    const registry = createDefaultToolRegistry();

    expect(registry.get("calendar_api_read")).toBeDefined();
    expect(registry.get("calendar.create_calendar")?.id).toBe("calendar_create_calendar");
    expect(registry.get("google_calendar.create_task")?.id).toBe("calendar_create_task");
    expect(registry.get("google_tasks")?.id).toBe("calendar_list_tasks");
    expect(registry.get("calendar.clear_completed_tasks")?.id).toBe("calendar_clear_completed_tasks");
  });

  it("registers the image generation bridge tool and selects it for image prompts", () => {
    const registry = createDefaultToolRegistry();
    const baseTools = registry.listForContext(context, "openai-compatible", { includePendingApproval: true });
    const selected = selectAdvertisedBridgeTools(baseTools, {
      prompt: "generate an image of a clean app icon",
      webSearchEnabled: false,
    }).map((tool) => tool.id);

    expect(registry.get("image_generate")).toBeDefined();
    expect(registry.get("generate_image")?.id).toBe("image_generate");
    expect(registry.get("image.generate")?.id).toBe("image_generate");
    expect(selected).toContain("image_generate");
  });

  it("does not advertise image generation when the capability is disabled", () => {
    const registry = createDefaultToolRegistry();
    const baseTools = registry.listForContext(context, "openai-compatible", { includePendingApproval: true });
    const selected = selectAdvertisedBridgeTools(baseTools, {
      imageGenerationEnabled: false,
      prompt: "generate an image of a clean app icon",
      webSearchEnabled: false,
    }).map((tool) => tool.id);

    expect(selected).not.toContain("image_generate");
  });

  it("registers the browser console and screenshot bridge tools with common aliases", () => {
    const registry = createDefaultToolRegistry();

    expect(registry.get("browser_console_read")).toBeDefined();
    expect(registry.get("browser.console")?.id).toBe("browser_console_read");
    expect(registry.get("read_browser_console")?.id).toBe("browser_console_read");
    expect(registry.get("browser_screenshot_capture")).toBeDefined();
    expect(registry.get("browser.screenshot")?.id).toBe("browser_screenshot_capture");
    expect(registry.get("take_screenshot")?.id).toBe("browser_screenshot_capture");
  });

  it("registers the memory search bridge tool and common memory aliases", () => {
    const registry = createDefaultToolRegistry();
    const advertisedToolIds = registry.listForContext(context, "openai-compatible").map((tool) => tool.id);

    expect(registry.get("memory_search")).toBeDefined();
    expect(registry.get("memory")?.id).toBe("memory_search");
    expect(registry.get("memory.search")?.id).toBe("memory_search");
    expect(registry.get("recall_memory")?.id).toBe("memory_search");
    expect(advertisedToolIds).toContain("memory_search");
  });

  it("executes memory search through the bridge context instead of prompt preloading", async () => {
    const registry = createDefaultToolRegistry();
    const batch = await executeToolBridgeCalls({
      calls: [
        {
          arguments: { query: "previous adapter path decision", maxRecords: 3 },
          id: "call-memory",
          name: "memory_search",
          provider: "openai",
        },
      ],
      context: {
        ...context,
        memorySearch: (request) => ({
          content: `Remembered query: ${request.query}`,
          projectName: "Gilbert Codex",
          storedRecordCount: 7,
          toolLessonCount: 2,
        }),
      },
      registry,
    });

    expect(batch.executedCount).toBe(1);
    expect(batch.resultMessages[0]?.result.content).toContain("LOCAL MEMORY SEARCH RESULTS");
    expect(batch.resultMessages[0]?.result.content).toContain("Remembered query: previous adapter path decision");
  });

  it("resolves common file tool aliases without advertising duplicate tools", () => {
    const registry = createDefaultToolRegistry();
    const advertisedToolIds = registry.listForContext(context, "openai-compatible").map((tool) => tool.id);

    expect(registry.get("read")?.id).toBe("files_read");
    expect(registry.get("read_range")?.id).toBe("files_read_range");
    expect(registry.get("grep")?.id).toBe("files_search");
    expect(registry.get("ls")?.id).toBe("files_list");
    expect(registry.get("tree")?.id).toBe("files_tree_summary");
    expect(registry.get("files_edit")?.id).toBe("files_exact_replace");
    expect(registry.get("file_edit")?.id).toBe("files_exact_replace");
    expect(registry.get("files_applypatch")?.id).toBe("files_apply_patch");
    expect(registry.get("files.copy")?.id).toBe("files_copy");
    expect(registry.get("copy_file")?.id).toBe("files_copy");
    expect(registry.get("mkdir")?.id).toBe("files_create_directory");
    expect(registry.get("create_folder")?.id).toBe("files_create_directory");
    expect(advertisedToolIds).toContain("files_read");
    expect(advertisedToolIds).toContain("files_search");
    expect(advertisedToolIds).toContain("files_tree_summary");
    expect(advertisedToolIds).not.toContain("read");
    expect(advertisedToolIds).not.toContain("grep");
  });

  it("denies future mutating tools in default permissions", async () => {
    const mutatingTool: ToolDefinition = {
      description: "Future mutating tool.",
      execute: () => ({ content: "changed", ok: true }),
      id: "future_write",
      inputSchema: { type: "object" },
      permission: "mutating",
      risk: "mutating",
      title: "Future write",
    };
    const registry = new ToolRegistry([mutatingTool]);

    expect(resolveToolPermission(mutatingTool, context).allowed).toBe(false);

    const batch = await executeToolBridgeCalls({
      calls: [{ arguments: {}, id: "call-write", name: "future_write", provider: "openai" }],
      context,
      registry,
    });

    expect(batch.toolCalls[0]?.status).toBe("skipped");
    expect(batch.resultMessages[0]?.result.skippedReason).toContain("Default permissions");
  });

  it("hard-gates a tool whose risk is destructive even if permission claims it is mutating", () => {
    const sneakyTool: ToolDefinition = {
      description: "Mislabelled mutating tool with destructive risk.",
      execute: () => ({ content: "boom", ok: true }),
      id: "sneaky_delete",
      inputSchema: { type: "object" },
      permission: "mutating",
      risk: "destructive",
      title: "Sneaky delete",
    };

    const decision = resolveToolPermission(sneakyTool, { permissionMode: "full-access" });
    expect(decision.allowed).toBe(false);
    expect(decision.requiresApproval).toBe(true);
  });

  it("keeps connected app write tools approval-gated even in full access", () => {
    const gmailSendTool = createDefaultToolRegistry().get("gmail_send_message");
    const calendarCreateTool = createDefaultToolRegistry().get("calendar_create_event");

    expect(gmailSendTool).toBeDefined();
    expect(calendarCreateTool).toBeDefined();
    expect(resolveToolPermission(gmailSendTool!, { permissionMode: "full-access" }).requiresApproval).toBe(true);
    expect(resolveToolPermission(calendarCreateTool!, { permissionMode: "full-access" }).requiresApproval).toBe(true);
    expect(resolveToolPermission(calendarCreateTool!, { permissionMode: "full-access" }).reason).toContain("current chat");
  });

  it("advertises approval-pending tools when an approval callback is wired", () => {
    const mutatingTool: ToolDefinition = {
      description: "Pending tool.",
      execute: () => ({ content: "ok", ok: true }),
      id: "pending_tool",
      inputSchema: { type: "object" },
      permission: "mutating",
      risk: "mutating",
      title: "Pending tool",
    };
    const registry = new ToolRegistry([mutatingTool]);

    const advertisedWithoutApproval = registry.listForContext(context);
    const advertisedWithApproval = registry.listForContext(context, undefined, { includePendingApproval: true });

    expect(advertisedWithoutApproval.some((tool) => tool.id === "pending_tool")).toBe(false);
    expect(advertisedWithApproval.some((tool) => tool.id === "pending_tool")).toBe(true);
  });
});

describe("tool bridge validation", () => {
  it("validates diagnostic tool arguments with JSON Schema", () => {
    const sumTool = createDefaultToolRegistry().get("bridge_sum");

    expect(sumTool).toBeDefined();
    expect(validateToolArguments(sumTool!, { values: [1, 2, 3] }).ok).toBe(true);
    expect(validateToolArguments(sumTool!, { values: ["nope"] }).ok).toBe(false);
  });

  it("does not require unsafe-eval to validate tool arguments", () => {
    const originalFunction = globalThis.Function;
    const sumTool = createDefaultToolRegistry().get("bridge_sum");

    try {
      globalThis.Function = (() => {
        throw new Error("CSP blocked unsafe-eval");
      }) as unknown as FunctionConstructor;

      expect(sumTool).toBeDefined();
      expect(validateToolArguments(sumTool!, { values: [1, 2, 3] }).ok).toBe(true);
      expect(validateToolArguments(sumTool!, { values: ["nope"] }).ok).toBe(false);
    } finally {
      globalThis.Function = originalFunction;
    }
  });

  it("rejects missing, extra, and out-of-range tool arguments", () => {
    const echoTool = createDefaultToolRegistry().get("bridge_echo");
    const readTool = createDefaultToolRegistry().get("files_read");

    expect(echoTool).toBeDefined();
    expect(readTool).toBeDefined();
    expect(validateToolArguments(echoTool!, {}).ok).toBe(false);
    expect(validateToolArguments(echoTool!, { message: "ok", extra: true }).ok).toBe(false);
    expect(validateToolArguments(readTool!, { maxBytes: 0, path: "src/app/App.tsx" }).ok).toBe(false);
  });

  it("normalizes primitive string arguments before validation", () => {
    const readTool = createDefaultToolRegistry().get("files_read");
    const rangeTool = createDefaultToolRegistry().get("files_read_range");
    const replaceTool = createDefaultToolRegistry().get("files_exact_replace");

    expect(readTool).toBeDefined();
    expect(rangeTool).toBeDefined();
    expect(replaceTool).toBeDefined();

    const readValidation = validateToolArguments(readTool!, { maxBytes: "3000", offset: "820", path: "src/app/App.tsx" });
    const rangeValidation = validateToolArguments(rangeTool!, { endLine: "20", path: "src/app/App.tsx", startLine: "10" });
    const pathOnlyRangeValidation = validateToolArguments(rangeTool!, { path: "src/app/App.tsx" });
    const replaceValidation = validateToolArguments(replaceTool!, {
      newText: "new",
      oldText: "old",
      path: "src/app/App.tsx",
      replaceAll: "false",
    });

    expect(readValidation).toMatchObject({ ok: true, args: { maxBytes: 3000, offset: 820 } });
    expect(rangeValidation).toMatchObject({ ok: true, args: { endLine: 20, startLine: 10 } });
    expect(pathOnlyRangeValidation).toMatchObject({ ok: true, args: { path: "src/app/App.tsx" } });
    expect(replaceValidation).toMatchObject({ ok: true, args: { replaceAll: false } });
  });

  it("normalizes legacy batch edit and write arguments before validation", () => {
    const registry = createDefaultToolRegistry();
    const editManyTool = registry.get("files_edit_many");
    const writeManyTool = registry.get("files_write_many");
    const applyPatchTool = registry.get("files_apply_patch");

    expect(editManyTool).toBeDefined();
    expect(writeManyTool).toBeDefined();
    expect(applyPatchTool).toBeDefined();

    const editValidation = validateToolArguments(editManyTool!, {
      dryRun: false,
      edits: [{
        content: "replacement",
        endLine: 3,
        expectedSha256: "",
        insertNewlineBeforeContent: false,
        line: 1,
        newText: "",
        oldText: "",
        operation: "replace_range",
        path: "src/App.css",
        replaceAll: false,
        startLine: 1,
      }],
    });
    const writeValidation = validateToolArguments(writeManyTool!, {
      createParentDirectories: false,
      dryRun: true,
      files: [{
        allowOverwrite: true,
        allowWholeFileReplacement: true,
        content: "x",
        createParentDirectories: false,
        expectedSha256: "unknown",
        lineEnding: "lf",
        path: "src/__tmp.txt",
      }],
      lineEnding: "lf",
      overwrite: true,
    });

    expect(editValidation.ok).toBe(true);
    expect(editValidation.args?.edits).toEqual([{
      content: "replacement",
      endLine: 3,
      ensureNewline: false,
      line: 1,
      newText: "",
      operation: "replace_range",
      path: "src/App.css",
      replaceAll: false,
      startLine: 1,
    }]);
    expect(writeValidation.ok).toBe(true);
    expect(writeValidation.args).toMatchObject({
      createParentDirs: false,
      dryRun: true,
      files: [{
        allowWholeFileReplacement: true,
        content: "x",
        createParentDirs: false,
        forceEol: "lf",
        overwrite: true,
        path: "src/__tmp.txt",
      }],
      forceEol: "lf",
      overwrite: true,
    });

    expect(validateToolArguments(applyPatchTool!, {
      expectedSha256: "unknown",
      patch: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n",
    })).toMatchObject({
      args: {
        patch: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n",
      },
      ok: true,
    });
  });

  it("normalizes Gmail send metadata before validation", () => {
    const gmailSendTool = createDefaultToolRegistry().get("gmail_send_message");

    expect(gmailSendTool).toBeDefined();

    const placeholderValidation = validateToolArguments(gmailSendTool!, {
      account_email: "innovexiaweb@gmail.com",
      body: "Hi there",
      content_type: "text/plain",
      in_reply_to: "-",
      references: "none",
      subject: "Hello",
      thread_id: "thread-1",
      to: ["recipient@example.com"],
    });

    expect(placeholderValidation.ok).toBe(true);
    expect(placeholderValidation.args).toMatchObject({
      accountEmail: "innovexiaweb@gmail.com",
      body: "Hi there",
      contentType: "text/plain",
      subject: "Hello",
      to: ["recipient@example.com"],
    });
    expect(placeholderValidation.args).not.toHaveProperty("threadId");
    expect(placeholderValidation.args).not.toHaveProperty("inReplyTo");
    expect(placeholderValidation.args).not.toHaveProperty("references");

    const threadValidation = validateToolArguments(gmailSendTool!, {
      body: "Hi there",
      subject: "Hello",
      threadId: "18fabc123def456",
      to: ["recipient@example.com"],
    });

    expect(threadValidation).toMatchObject({
      args: {
        threadId: "18fabc123def456",
      },
      ok: true,
    });
  });

  it("returns a clear error when arguments are a raw string", () => {
    const sumTool = createDefaultToolRegistry().get("bridge_sum")!;

    const validation = validateToolArguments(sumTool, "{\"values\":[1,");

    expect(validation.ok).toBe(false);
    expect(validation.error).toContain("could not be parsed as JSON");
  });
});

describe("tool bridge diagnostics", () => {
  it("runs the in-memory tool smoke test", async () => {
    const tool = createDefaultToolRegistry().get("tool_smoke_test");

    expect(tool).toBeDefined();

    const result = await tool!.execute({}, context);

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Tool smoke test passed");
    expect(result.content).toContain("Full HTML read stays out of visible chat");
    expect(result.content).toContain("Malformed write returns recovery error without mutation");
    expect(result.content).toContain("Exact replace coerces string booleans");
    expect(result.content).toContain("Git status and diff report cleanly");
    expect(result.content).toContain("Payload guardrail identifies spike cause");
  });
});

describe("tool result finalizer", () => {
  it("keeps raw file content for tool records and provider evidence while forcing visible synthesis", () => {
    const finalization = finalizeToolResult({
      arguments: { path: "src/app/App.tsx" },
      maxProviderChars: 12,
      result: { content: "abcdefghijklmnopqrstuvwxyz", ok: true },
      toolId: "files_read",
    });

    expect(finalization.toolRecordContent).toBe("abcdefghijklmnopqrstuvwxyz");
    expect(finalization.providerContent).toContain("Provider-visible tool output excerpt ended");
    expect(finalization.providerContent).not.toContain("truncated for provider context");
    expect(finalization.visiblePolicy).toMatchObject({
      mode: "synthesize",
      resultKind: "file_content",
      synthesizeAfterwards: true,
    });
    expect(finalization.visibleFallback).toContain("Read `src/app/App.tsx`.");
  });

  it("treats failed file reads as recoverable synthesis evidence", () => {
    const finalization = finalizeToolResult({
      arguments: { path: "src/App.tsx" },
      label: "Read workspace file",
      result: {
        content: "",
        error: [
          "Could not read C:\\repo\\src\\App.tsx.",
          "A directory named app exists. Try files_read on one of: C:\\repo\\src\\app\\App.tsx",
        ].join(" "),
        ok: false,
      },
      toolId: "files_read",
    });

    expect(finalization.visiblePolicy).toMatchObject({
      mode: "safe_summary",
      resultKind: "file_content",
      synthesizeAfterwards: true,
    });
    expect(finalization.visibleFallback).toContain("Read workspace file");
    expect(finalization.visibleFallback).toContain("Try files_read on one of");
  });

  it("detects metadata-backed raw tool recaps as unsafe visible chat content", () => {
    const finalization = finalizeToolResult({
      arguments: { path: "C:\\repo" },
      result: {
        content: [
          "Workspace tree summary for C:\\repo",
          "Scanned 2 directories and 6 files to depth 4.",
          "repo/ (3 files)",
        ].join("\n"),
        ok: true,
      },
      toolId: "files_tree_summary",
    });

    expect(isVisibleToolResultLeak(finalization.toolRecordContent, [{
      id: "tool-tree",
      input: JSON.stringify({ path: "C:\\repo" }),
      label: "Workspace tree summary",
      output: finalization.toolRecordContent,
      resultPolicy: finalization.visiblePolicy,
      status: "complete",
      toolId: "files_tree_summary",
    }])).toBe(true);
  });

  it("allows raw output only for tools whose policy explicitly permits it", () => {
    const finalization = finalizeToolResult({
      arguments: { message: "hello" },
      result: { content: "hello", ok: true },
      toolId: "bridge_echo",
    });

    expect(finalization.visiblePolicy).toMatchObject({
      mode: "allow_raw",
      synthesizeAfterwards: false,
    });
    expect(isVisibleToolResultLeak("hello", [{
      id: "tool-echo",
      input: JSON.stringify({ message: "hello" }),
      label: "Echo diagnostic",
      output: "hello",
      resultPolicy: finalization.visiblePolicy,
      status: "complete",
      toolId: "bridge_echo",
    }])).toBe(false);
  });
});

describe("tool bridge adapters", () => {
  const tools = createDefaultToolRegistry().listForContext(context);

  it("attaches OpenAI-compatible tool schemas and result messages", () => {
    const body = applyToolBridgeToProviderRequest(
      { messages: [{ content: "hello", role: "user" }], model: "test" },
      "openai-compatible",
      {
        parallelToolCalls: true,
        toolResultMessages: [
          {
            arguments: { message: "hi" },
            callId: "call-1",
            name: "bridge_echo",
            result: { content: "hi", ok: true },
          },
        ],
        tools,
      },
    );

    expect((body.tools as Array<{ function: { name: string } }>)[0]?.function.name).toBe("bridge_echo");
    expect(body.parallel_tool_calls).toBe(true);
    expect((body.messages as Array<{ role: string }>).map((message) => message.role)).toEqual(["user", "assistant", "tool"]);
  });

  it("adds compact Anthropic input examples for nested batch editing tools", () => {
    const registry = createDefaultToolRegistry();
    const editMany = registry.get("files_edit_many");
    const writeMany = registry.get("files_write_many");
    const read = registry.get("files_read");
    expect(editMany).toBeDefined();
    expect(writeMany).toBeDefined();
    expect(read).toBeDefined();

    const body = applyToolBridgeToProviderRequest(
      { messages: [{ content: "hello", role: "user" }], model: "claude-test" },
      "anthropic-messages",
      {
        tools: [editMany!, writeMany!, read!],
      },
    );
    const bodyTools = body.tools as Array<{ input_examples?: Array<Record<string, unknown>>; name: string }>;
    const editTool = bodyTools.find((tool) => tool.name === "files_edit_many");
    const writeTool = bodyTools.find((tool) => tool.name === "files_write_many");
    const readTool = bodyTools.find((tool) => tool.name === "files_read");

    expect(editTool?.input_examples?.[0]).toMatchObject({
      edits: [
        {
          operation: "exact_replace",
          path: "src/App.tsx",
        },
      ],
    });
    expect(JSON.stringify(editTool?.input_examples)).toContain("replace_span");
    expect(writeTool?.input_examples?.[0]).toMatchObject({
      files: [
        {
          path: "src/newFeature.ts",
        },
      ],
      overwrite: false,
    });
    expect(readTool?.input_examples).toBeUndefined();
  });

  it("replays OpenRouter reasoning details only on the native assistant tool-call turn", () => {
    const body = applyToolBridgeToProviderRequest(
      { messages: [{ content: "hello", role: "user" }], model: "test" },
      "openai-compatible",
      {
        reasoningState: {
          entries: [{ type: "reasoning_details", value: [{ data: "opaque", type: "reasoning.encrypted" }] }],
          format: "openrouter-reasoning",
          provider: "openrouter",
        },
        toolResultMessages: [
          {
            arguments: { message: "hi" },
            callId: "call-1",
            name: "bridge_echo",
            result: { content: "hi", ok: true },
          },
        ],
      },
    );
    const assistantTurn = (body.messages as Array<{ reasoning_details?: unknown[]; role: string }>).find((message) => message.role === "assistant");

    expect(assistantTurn?.reasoning_details).toEqual([{ data: "opaque", type: "reasoning.encrypted" }]);
  });

  it("can skip synthesizing the assistant tool_call turn when history already contains it", () => {
    const body = applyToolBridgeToProviderRequest(
      { messages: [{ content: "hello", role: "user" }], model: "test" },
      "openai-compatible",
      {
        resultsHistoryAlreadyContainsAssistantTurns: true,
        toolResultMessages: [
          {
            arguments: { message: "hi" },
            callId: "call-1",
            name: "bridge_echo",
            result: { content: "hi", ok: true },
          },
        ],
      },
    );

    expect((body.messages as Array<{ role: string }>).map((message) => message.role)).toEqual(["user", "tool"]);
  });

  it("caps model-visible tool result content without changing stored tool output", () => {
    const body = applyToolBridgeToProviderRequest(
      { messages: [{ content: "hello", role: "user" }], model: "test" },
      "openai-compatible",
      {
        maxToolResultContentChars: 12,
        toolResultMessages: [
          {
            arguments: { path: "src/app/App.tsx" },
            callId: "call-read",
            name: "files_read",
            result: { content: "abcdefghijklmnopqrstuvwxyz", ok: true },
          },
          {
            arguments: { path: "src/toolBridge/index.ts" },
            callId: "call-read-2",
            name: "files_read",
            result: { content: "0123456789", ok: true },
          },
        ],
      },
    );
    const toolMessages = (body.messages as Array<{ content: string; role: string }>).filter((message) => message.role === "tool");

    expect(toolMessages[0]?.content).toContain("Provider-visible tool output excerpt ended");
    expect(toolMessages[0]?.content).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(toolMessages[1]?.content).toContain("Provider-visible tool output excerpt omitted");
    expect(toolMessages.join("\n")).not.toContain("truncated for provider context");
  });

  it("does not cap bridge tool results when no explicit provider limit is supplied", () => {
    const content = "abcdefghijklmnopqrstuvwxyz".repeat(200);
    const body = applyToolBridgeToProviderRequest(
      { messages: [{ content: "hello", role: "user" }], model: "test" },
      "openai-compatible",
      {
        toolResultDelivery: "inline-user-message",
        toolResultMessages: [
          {
            arguments: { path: "src/app/App.tsx" },
            callId: "call-read",
            name: "files_read",
            result: { content, ok: true },
          },
        ],
      },
    );
    const messages = body.messages as Array<{ content: string; role: string }>;

    expect(messages[1]?.content).toContain(content);
    expect(messages[1]?.content).not.toContain("Provider-visible tool output excerpt ended");
    expect(messages[1]?.content).not.toContain("truncated for provider context");
  });

  it("can inline tool results as plain user context for synthesis compatibility", () => {
    const body = applyToolBridgeToProviderRequest(
      { messages: [{ content: "hello", role: "user" }], model: "test" },
      "openai-compatible",
      {
        maxToolResultContentChars: 80,
        toolChoice: "none",
        toolResultDelivery: "inline-user-message",
        toolResultMessages: [
          {
            arguments: { path: "src/styles/variables.scss" },
            callId: "call-read",
            name: "files_read",
            result: { content: "$color: red;", ok: true },
          },
        ],
      },
    );
    const messages = body.messages as Array<{ content: string; role: string; tool_call_id?: string }>;

    expect(body.tool_choice).toBeUndefined();
    expect(messages.map((message) => message.role)).toEqual(["user", "user"]);
    expect(messages[1]?.content).toContain("TOOL RESULT EVIDENCE");
    expect(messages[1]?.content).toContain("files_read");
    expect(messages[1]?.tool_call_id).toBeUndefined();
  });

  it("propagates an explicit none tool_choice for OpenAI-compatible providers", () => {
    const body = applyToolBridgeToProviderRequest({ messages: [], model: "test" }, "openai-compatible", {
      toolChoice: "none",
      tools,
    });

    expect(body.tool_choice).toBe("none");
    expect(body.tools).toBeUndefined();
  });

  it("attaches Responses tools with automatic model choice", () => {
    const webTool = createDefaultToolRegistry().get("web_search");
    expect(webTool).toBeDefined();

    const body = applyToolBridgeToProviderRequest({ input: [{ content: "hello", role: "user" }], model: "test" }, "openai-responses", {
      toolChoice: "auto",
      tools: webTool ? [webTool] : [],
    });

    expect(body.tool_choice).toBe("auto");
    expect((body.tools as Array<{ name: string; strict?: boolean }>)[0]).toMatchObject({
      name: "web_search",
      strict: false,
      type: "function",
    });
  });

  it("keeps Responses provider-visible tools aligned with the capability plan after filtering", () => {
    const registry = createDefaultToolRegistry();
    const webTool = registry.get("web_search");
    const echoTool = registry.get("bridge_echo");
    expect(webTool).toBeDefined();
    expect(echoTool).toBeDefined();
    const openAiOnlyTool: ToolDefinition = {
      ...echoTool!,
      compatibleProviders: ["openai-compatible"],
      id: "openai_only_echo",
      title: "OpenAI compatible only echo",
    };
    const plan = createToolCapabilityPlan({
      prompt: "look up the latest docs",
      providerFormat: "openai-responses",
      selectedTools: webTool ? [webTool, openAiOnlyTool] : [openAiOnlyTool],
      toolIntent: ["web_search"],
    });
    const body = applyToolBridgeToProviderRequest({ input: [{ content: "hello", role: "user" }], model: "test" }, "openai-responses", {
      capabilityPlan: plan,
      toolChoice: "auto",
      tools: plan.selectedTools,
    });
    const bodyToolNames = (body.tools as Array<{ name: string }>).map((tool) => tool.name);

    expect(plan.providerVisibleToolIds).toEqual(["web_search"]);
    expect(bodyToolNames).toEqual(plan.providerVisibleToolIds);
  });

  it("attaches Anthropic Messages tools", () => {
    const body = applyToolBridgeToProviderRequest({ messages: [], model: "claude" }, "anthropic-messages", { tools });
    const attachedTools = body.tools as Array<{ cache_control?: unknown; name: string }>;

    expect(attachedTools[0]?.name).toBe("bridge_echo");
    expect(attachedTools[attachedTools.length - 1]?.cache_control).toEqual({ type: "ephemeral" });
  });

  it("replays Anthropic thinking blocks before native tool_use blocks", () => {
    const body = applyToolBridgeToProviderRequest(
      { messages: [{ content: "hello", role: "user" }], model: "claude" },
      "anthropic-messages",
      {
        reasoningState: {
          entries: [{
            type: "thinking",
            value: { signature: "sig", thinking: "private", type: "thinking" },
          }],
          format: "anthropic-thinking",
          provider: "anthropic",
        },
        toolResultMessages: [
          {
            arguments: { message: "hi" },
            callId: "call-1",
            name: "bridge_echo",
            result: { content: "hi", ok: true },
          },
        ],
      },
    );
    const assistantTurn = (body.messages as Array<{ content?: Array<{ type: string }>; role: string }>).find((message) => message.role === "assistant");

    expect(assistantTurn?.content?.map((item) => item.type)).toEqual(["thinking", "tool_use"]);
  });

  it("attaches Responses tools and function outputs", () => {
    const body = applyToolBridgeToProviderRequest(
      { input: [{ content: "hello", role: "user" }], model: "gpt" },
      "openai-responses",
      {
        parallelToolCalls: true,
        toolResultMessages: [
          {
            arguments: { values: [2, 3] },
            callId: "call-2",
            name: "bridge_sum",
            result: { content: "5", ok: true },
          },
        ],
        tools,
      },
    );

    expect((body.tools as Array<{ name: string }>)[0]?.name).toBe("bridge_echo");
    expect(body.parallel_tool_calls).toBe(true);
    expect((body.input as Array<{ type?: string }>).map((item) => item.type)).toEqual([undefined, "function_call", "function_call_output"]);
  });

  it("replays OpenAI Responses reasoning items before function call outputs", () => {
    const body = applyToolBridgeToProviderRequest(
      { input: [{ content: "hello", role: "user" }], model: "gpt" },
      "openai-responses",
      {
        reasoningState: {
          entries: [{ id: "rs_1", type: "reasoning", value: { id: "rs_1", type: "reasoning" } }],
          format: "openai-responses",
          provider: "openai",
        },
        toolResultMessages: [
          {
            arguments: { values: [2, 3] },
            callId: "call-2",
            name: "bridge_sum",
            result: { content: "5", ok: true },
          },
        ],
      },
    );

    expect((body.input as Array<{ type?: string }>).map((item) => item.type)).toEqual([undefined, "reasoning", "function_call", "function_call_output"]);
  });
});

describe("tool bridge parsers", () => {
  it("parses OpenAI-compatible tool_calls", () => {
    const calls = parseOpenAiCompatibleToolCalls(
      {
        tool_calls: [
          {
            function: { arguments: "{\"message\":\"hi\"}", name: "bridge_echo" },
            id: "call-openai",
            type: "function",
          },
        ],
      },
      "openai",
    );

    expect(calls[0]).toMatchObject({ arguments: { message: "hi" }, id: "call-openai", name: "bridge_echo" });
    expect(calls[0]?.argumentsParseError).toBeUndefined();
  });

  it("parses Anthropic tool_use blocks", () => {
    const calls = parseAnthropicToolCalls(
      {
        content: [{ id: "call-anthropic", input: { message: "hi" }, name: "bridge_echo", type: "tool_use" }],
      },
      "anthropic",
    );

    expect(calls[0]).toMatchObject({ arguments: { message: "hi" }, id: "call-anthropic", name: "bridge_echo" });
  });

  it("parses Responses function_call output", () => {
    const calls = parseResponsesToolCalls(
      {
        output: [{ arguments: "{\"values\":[1,2]}", call_id: "call-responses", name: "bridge_sum", type: "function_call" }],
      },
      "openai",
    );

    expect(calls[0]).toMatchObject({ arguments: { values: [1, 2] }, id: "call-responses", name: "bridge_sum" });
  });

  it("surfaces a JSON parse error when arguments cannot be decoded", () => {
    const detailed = parseToolCallArgumentsDetailed("{\"oops\":");
    expect(detailed.error).toBeDefined();

    const calls = parseOpenAiCompatibleToolCalls(
      {
        tool_calls: [
          {
            function: { arguments: "{\"oops\":", name: "bridge_echo" },
            id: "call-bad",
            type: "function",
          },
        ],
      },
      "openai",
    );

    expect(calls[0]?.argumentsParseError).toContain("Could not parse");
  });

  it("repairs common malformed batch file arguments with raw code quotes and newlines", () => {
    const detailed = parseToolCallArgumentsDetailed(String.raw`{"files":[{"path":"src/App.jsx","content":"import React from "react";
console.log("hello", value);
export default App;"}]}`);

    expect(detailed.error).toBeUndefined();
    expect(detailed.value).toEqual({
      files: [{
        content: "import React from \"react\";\nconsole.log(\"hello\", value);\nexport default App;",
        path: "src/App.jsx",
      }],
    });
  });

  it("repairs single file writes with code quotes before braces and brackets", () => {
    const detailed = parseToolCallArgumentsDetailed(String.raw`{"path":"src/App.jsx","content":"const rows = [{ label: "Chat" }];
const ids = ["home", "chat"];
export default function App() {
  return <button aria-label="Open chat">Chat</button>;
}","allowWholeFileReplacement":true}`);

    expect(detailed.error).toBeUndefined();
    expect(detailed.value).toEqual({
      allowWholeFileReplacement: true,
      content: "const rows = [{ label: \"Chat\" }];\nconst ids = [\"home\", \"chat\"];\nexport default function App() {\n  return <button aria-label=\"Open chat\">Chat</button>;\n}",
      path: "src/App.jsx",
    });
  });

  it("repairs malformed file arguments with raw Windows path backslashes", () => {
    const detailed = parseToolCallArgumentsDetailed(String.raw`{"path":"C:\Users\Kobe Work\Documents\GilbertChat\chatgpt-mobile-app\src\App.jsx","content":"export const title = "Chat";"}`);

    expect(detailed.error).toBeUndefined();
    expect(detailed.value).toEqual({
      content: "export const title = \"Chat\";",
      path: String.raw`C:\Users\Kobe Work\Documents\GilbertChat\chatgpt-mobile-app\src\App.jsx`,
    });
  });

  it("uses a deterministic counter for fallback tool call ids", () => {
    const first = parseOpenAiCompatibleToolCalls(
      { tool_calls: [{ function: { arguments: "{}", name: "bridge_echo" } }] },
      "openai",
    );
    const second = parseOpenAiCompatibleToolCalls(
      { tool_calls: [{ function: { arguments: "{}", name: "bridge_echo" } }] },
      "openai",
    );

    expect(first[0]?.id).toBe("bridge_echo-fallback-1");
    expect(second[0]?.id).toBe("bridge_echo-fallback-2");
  });

  it("recovers provider-native tool_calls JSON printed as visible text", () => {
    const content = String.raw`I'll continue examining more parts of this codebase.

{ "tool_calls": [ { "id": "chatcmpl-tool-new1", "function": "files_read", "parameters": { "path": "C:\Users\Kobe Work\Documents\GilbertCodex\src\localWorkspace\files.ts" } }, { "id": "chatcmpl-tool-new2", "function": "files_read", "parameters": { "path": "C:\Users\Kobe Work\Documents\GilbertCodex\src\services\modelProviderClient.ts" } } ] }`;
    const calls = parseVisibleTextToolCalls(content, "openrouter");

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      arguments: { path: String.raw`C:\Users\Kobe Work\Documents\GilbertCodex\src\localWorkspace\files.ts` },
      id: "chatcmpl-tool-new1",
      name: "files_read",
    });
    expect(calls[1]?.arguments).toMatchObject({ path: String.raw`C:\Users\Kobe Work\Documents\GilbertCodex\src\services\modelProviderClient.ts` });
  });

  it("recovers OpenAI-style function tool_calls JSON printed as visible text", () => {
    const content = String.raw`{"tool_calls":[{"id":"call-1","type":"function","function":{"name":"files_read","arguments":"{\"path\":\"src/app/App.tsx\"}"}}]}`;
    const calls = parseVisibleTextToolCalls(content, "openrouter");

    expect(calls[0]).toMatchObject({
      arguments: { path: "src/app/App.tsx" },
      id: "call-1",
      name: "files_read",
    });
  });

  it("recovers legacy bridge sentinel tool calls printed as visible text", () => {
    const content = String.raw`BRIDGE_TOOL_CALL:{"tool":"terminal_run","args":{"command":"npm run build","cwd":"C:\Users\Kobe Work\Documents\HelloWorld","timeoutMs":12000}}Updated the app theme colors.`;
    const calls = parseVisibleTextToolCalls(content, "openrouter");

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      arguments: {
        command: "npm run build",
        cwd: String.raw`C:\Users\Kobe Work\Documents\HelloWorld`,
        timeoutMs: 12000,
      },
      id: "visible-bridge-tool-call-1",
      name: "terminal_run",
    });
  });

  it("recovers legacy bridge terminal calls with quoted Windows paths inside PowerShell commands", () => {
    const command = String.raw`Get-ChildItem -Path src-tauri -Recurse -Include *.rs,*.toml | Select-Object -First 40 -ExpandProperty FullName | ForEach-Object { $_.Replace("C:\Users\Kobe Work\Documents\GilbertCodex\", "") }`;
    const cwd = String.raw`C:\Users\Kobe Work\Documents\GilbertCodex`;
    const content = String.raw`BRIDGE_TOOL_CALL:{"tool":"terminal_run","args":{"command":"Get-ChildItem -Path src-tauri -Recurse -Include *.rs,*.toml | Select-Object -First 40 -ExpandProperty FullName | ForEach-Object { $_.Replace("C:\Users\Kobe Work\Documents\GilbertCodex\", "") }","cwd":"C:\Users\Kobe Work\Documents\GilbertCodex","shell":"powershell","timeoutMs":45000}}`;
    const calls = parseVisibleTextToolCalls(content, "openrouter");

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      arguments: {
        command,
        cwd,
        shell: "powershell",
        timeoutMs: 45000,
      },
      id: "visible-bridge-tool-call-1",
      name: "terminal_run",
    });
  });

  it("recovers direct XML-style bridge tool tags printed as visible text", () => {
    const content = String.raw`<files_read_range> <path>src/App.jsx</path> <startLine>195</startLine> <endLine>280</endLine> </files_read_range>`;
    const calls = parseVisibleTextToolCalls(content, "openrouter");

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      arguments: {
        endLine: 280,
        path: "src/App.jsx",
        startLine: 195,
      },
      id: "visible-xml-tool-call-1",
      name: "files_read_range",
    });
  });

  it("recovers DSML bridge tool calls printed as visible text", () => {
    const content = [
      `< | DSML | tool_calls>`,
      `< | DSML | invoke name="files_read_range">`,
      `< | DSML | parameter name="path" string="true">src/App.jsx</ | DSML | parameter>`,
      `< | DSML | parameter name="startLine" string="false">195</ | DSML | parameter>`,
      `< | DSML | parameter name="endLine" string="false">280</ | DSML | parameter>`,
      `</ | DSML | invoke>`,
      `</ | DSML | tool_calls>`,
    ].join(" ");
    const calls = parseVisibleTextToolCalls(content, "openrouter");

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      arguments: {
        endLine: 280,
        path: "src/App.jsx",
        startLine: 195,
      },
      id: "visible-dsml-tool-call-1",
      name: "files_read_range",
    });
  });
});

describe("safeStringify", () => {
  it("renders circular references as [Circular]", () => {
    const node: Record<string, unknown> = { name: "root" };
    node.self = node;

    const rendered = safeStringify(node);

    expect(rendered).toContain("root");
    expect(rendered).toContain("[Circular]");
  });

  it("renders bigints as their decimal string form", () => {
    expect(safeStringify({ amount: 12n })).toBe("{\"amount\":\"12\"}");
  });
});

describe("tool bridge orchestrator", () => {
  it("returns a final answer when the provider does not call tools", async () => {
    const orchestrator = new ToolBridgeOrchestrator({
      context,
      send: async () => ({ content: "done" }),
    });

    await expect(orchestrator.run()).resolves.toMatchObject({
      abortedBySignal: false,
      content: "done",
      loopCount: 1,
      stoppedAtMaxLoops: false,
    });
  });

  it("runs one diagnostic tool call then continues to a final answer", async () => {
    const orchestrator = new ToolBridgeOrchestrator({
      context,
      send: async ({ loopIndex, toolResultMessages }) =>
        loopIndex === 0
          ? {
              content: "",
              toolCalls: [{ arguments: { values: [2, 3] }, id: "call-sum", name: "bridge_sum", provider: "openai" }],
            }
          : {
              content: `sum ${toolResultMessages[0]?.result.content}`,
            },
    });

    await expect(orchestrator.run()).resolves.toMatchObject({
      content: "sum 5",
      resultMessages: [{ result: { content: "5", ok: true } }],
      stoppedAtMaxLoops: false,
    });
  });

  it("runs multiple diagnostic tool calls in one batch", async () => {
    const batch = await executeToolBridgeCalls({
      calls: [
        { arguments: { message: "hi" }, id: "call-echo", name: "bridge_echo", provider: "openai" },
        { arguments: { values: [1, 2, 4] }, id: "call-sum", name: "bridge_sum", provider: "openai" },
      ],
      context,
    });

    expect(batch.requestedCount).toBe(2);
    expect(batch.executedCount).toBe(2);
    expect(batch.handledCount).toBe(2);
    expect(batch.resultMessages.map((message) => message.result.content)).toEqual(["hi", "7"]);
  });

  it("coalesces repeated single-file reads into one host batch read", async () => {
    const executed: string[] = [];
    const readTool: ToolDefinition = {
      description: "Single read placeholder.",
      execute: () => {
        executed.push("single");
        return { content: "single", ok: true };
      },
      id: "files_read",
      inputSchema: {
        additionalProperties: false,
        properties: { path: { type: "string" } },
        required: ["path"],
        type: "object",
      },
      permission: "read-only",
      risk: "read",
      title: "Read workspace file",
    };
    const readManyTool: ToolDefinition = {
      description: "Batch read placeholder.",
      execute: (args) => {
        const paths = Array.isArray(args.paths) ? args.paths.filter((path): path is string => typeof path === "string") : [];
        executed.push(`batch:${paths.join(",")}`);
        return {
          content: `Read ${paths.length} files.`,
          data: {
            files: paths.map((path) => ({ content: `content:${path}`, ok: true, path, requestedPath: path })),
          },
          ok: true,
        };
      },
      id: "files_read_many",
      inputSchema: {
        additionalProperties: false,
        properties: {
          paths: { items: { type: "string" }, minItems: 1, type: "array" },
        },
        required: ["paths"],
        type: "object",
      },
      permission: "read-only",
      risk: "read",
      title: "Read many workspace files",
    };
    const events: ToolBridgeTelemetryEvent[] = [];
    const batch = await executeToolBridgeCalls({
      calls: [
        { arguments: { path: "src/a.ts" }, id: "read-a", name: "files_read", provider: "openai" },
        { arguments: { path: "src/b.ts" }, id: "read-b", name: "files_read", provider: "openai" },
      ],
      context,
      registry: new ToolRegistry([readTool, readManyTool]),
      telemetry: (event) => events.push(event),
    });

    expect(executed).toEqual(["batch:src/a.ts,src/b.ts"]);
    expect(batch.coalescedCount).toBe(1);
    expect(batch.hostExecutionCount).toBe(1);
    expect(batch.requestedCount).toBe(2);
    expect(batch.toolCalls).toHaveLength(1);
    expect(batch.toolCalls[0]?.toolId).toBe("files_read_many");
    expect(events.some((event) => event.type === "tool-batch-coalesced")).toBe(true);
  });

  it("coalesces repeated file writes before approval", async () => {
    const writeTool: ToolDefinition = {
      description: "Single write placeholder.",
      execute: () => ({ content: "single", ok: true }),
      id: "files_write",
      inputSchema: {
        additionalProperties: false,
        properties: {
          content: { type: "string" },
          path: { type: "string" },
        },
        required: ["path", "content"],
        type: "object",
      },
      permission: "mutating",
      risk: "mutating",
      title: "Write workspace file",
    };
    const writeManyTool: ToolDefinition = {
      description: "Batch write placeholder.",
      execute: (args) => {
        const files = Array.isArray(args.files) ? args.files : [];
        return { content: `Wrote ${files.length} files.`, ok: true };
      },
      id: "files_write_many",
      inputSchema: {
        additionalProperties: false,
        properties: {
          files: {
            items: {
              additionalProperties: false,
              properties: {
                content: { type: "string" },
                path: { type: "string" },
              },
              required: ["path", "content"],
              type: "object",
            },
            minItems: 1,
            type: "array",
          },
        },
        required: ["files"],
        type: "object",
      },
      permission: "mutating",
      risk: "mutating",
      title: "Write many workspace files",
    };
    const approval: ToolApprovalCallback = vi.fn(async () => ({ approved: true }));

    const batch = await executeToolBridgeCalls({
      approval,
      calls: [
        { arguments: { content: "a", path: "src/a.ts" }, id: "write-a", name: "files_write", provider: "openai" },
        { arguments: { content: "b", path: "src/b.ts" }, id: "write-b", name: "files_write", provider: "openai" },
      ],
      context: { ...context, permissionMode: "auto-review" },
      registry: new ToolRegistry([writeTool, writeManyTool]),
    });

    expect(approval).toHaveBeenCalledOnce();
    expect(vi.mocked(approval).mock.calls[0]?.[0].tool.id).toBe("files_write_many");
    expect(batch.coalescedCount).toBe(1);
    expect(batch.toolCalls[0]?.toolId).toBe("files_write_many");
  });

  it("coalesces repeated single-edit tools into one host batch edit", async () => {
    const executed: string[] = [];
    let receivedEdits: unknown[] = [];
    const exactReplaceTool: ToolDefinition = {
      description: "Single exact replace placeholder.",
      execute: () => {
        executed.push("single-exact");
        return { content: "single", ok: true };
      },
      id: "files_exact_replace",
      inputSchema: {
        additionalProperties: false,
        properties: {
          newText: { type: "string" },
          oldText: { minLength: 1, type: "string" },
          path: { type: "string" },
        },
        required: ["path", "oldText", "newText"],
        type: "object",
      },
      permission: "mutating",
      risk: "mutating",
      title: "Exact replace",
    };
    const replaceRangeTool: ToolDefinition = {
      description: "Single range replace placeholder.",
      execute: () => {
        executed.push("single-range");
        return { content: "single", ok: true };
      },
      id: "files_replace_range",
      inputSchema: {
        additionalProperties: false,
        properties: {
          content: { type: "string" },
          endLine: { minimum: 1, type: "integer" },
          path: { type: "string" },
          startLine: { minimum: 1, type: "integer" },
        },
        required: ["path", "startLine", "endLine", "content"],
        type: "object",
      },
      permission: "mutating",
      risk: "mutating",
      title: "Replace range",
    };
    const replaceSpanTool: ToolDefinition = {
      description: "Single span replace placeholder.",
      execute: () => {
        executed.push("single-span");
        return { content: "single", ok: true };
      },
      id: "files_replace_span",
      inputSchema: {
        additionalProperties: false,
        properties: {
          content: { type: "string" },
          endColumn: { minimum: 1, type: "integer" },
          endLine: { minimum: 1, type: "integer" },
          path: { type: "string" },
          startColumn: { minimum: 1, type: "integer" },
          startLine: { minimum: 1, type: "integer" },
        },
        required: ["path", "startLine", "startColumn", "endColumn", "content"],
        type: "object",
      },
      permission: "mutating",
      risk: "mutating",
      title: "Replace span",
    };
    const editManyTool: ToolDefinition = {
      description: "Batch edit placeholder.",
      execute: (args) => {
        receivedEdits = Array.isArray(args.edits) ? args.edits : [];
        executed.push(`batch:${receivedEdits.length}`);
        return { content: `Edited ${receivedEdits.length} items.`, ok: true };
      },
      id: "files_edit_many",
      inputSchema: {
        additionalProperties: false,
        properties: {
          dryRun: { type: "boolean" },
          edits: {
            items: {
              additionalProperties: false,
              properties: {
                content: { type: "string" },
                endColumn: { minimum: 1, type: "integer" },
                endLine: { minimum: 1, type: "integer" },
                newText: { type: "string" },
                oldText: { type: "string" },
                operation: { enum: ["exact_replace", "replace_range", "replace_span"], type: "string" },
                path: { type: "string" },
                startColumn: { minimum: 1, type: "integer" },
                startLine: { minimum: 1, type: "integer" },
              },
              required: ["path", "operation"],
              type: "object",
            },
            minItems: 1,
            type: "array",
          },
        },
        required: ["edits"],
        type: "object",
      },
      permission: "mutating",
      risk: "mutating",
      title: "Edit many",
    };

    const batch = await executeToolBridgeCalls({
      calls: [
        { arguments: { newText: "next", oldText: "old", path: "src/App.jsx" }, id: "edit-a", name: "files_exact_replace", provider: "openai" },
        { arguments: { content: "line", endLine: 12, path: "src/App.jsx", startLine: 10 }, id: "edit-b", name: "files_replace_range", provider: "openai" },
        { arguments: { content: "x", endColumn: 8, path: "src/App.jsx", startColumn: 7, startLine: 14 }, id: "edit-c", name: "files_replace_span", provider: "openai" },
      ],
      context: { ...context, permissionMode: "full-access" },
      registry: new ToolRegistry([exactReplaceTool, replaceRangeTool, replaceSpanTool, editManyTool]),
    });

    expect(executed).toEqual(["batch:3"]);
    expect(receivedEdits).toEqual([
      { newText: "next", oldText: "old", operation: "exact_replace", path: "src/App.jsx" },
      { content: "line", endLine: 12, operation: "replace_range", path: "src/App.jsx", startLine: 10 },
      { content: "x", endColumn: 8, operation: "replace_span", path: "src/App.jsx", startColumn: 7, startLine: 14 },
    ]);
    expect(batch.coalescedCount).toBe(2);
    expect(batch.hostExecutionCount).toBe(1);
    expect(batch.requestedCount).toBe(3);
    expect(batch.toolCalls).toHaveLength(1);
    expect(batch.toolCalls[0]?.toolId).toBe("files_edit_many");
  });

  it("does not coalesce writes across an intervening exclusive tool", async () => {
    const order: string[] = [];
    const writeTool: ToolDefinition = {
      description: "Single write placeholder.",
      execute: (args) => {
        order.push(`write:${String(args.path)}`);
        return { content: "single", ok: true };
      },
      id: "files_write",
      inputSchema: {
        additionalProperties: false,
        properties: {
          content: { type: "string" },
          path: { type: "string" },
        },
        required: ["path", "content"],
        type: "object",
      },
      permission: "mutating",
      risk: "mutating",
      title: "Write workspace file",
    };
    const writeManyTool: ToolDefinition = {
      description: "Batch write placeholder.",
      execute: (args) => {
        const files = Array.isArray(args.files) ? args.files : [];
        order.push(`batch:${files.map((file) =>
          file && typeof file === "object" && !Array.isArray(file) ? String((file as { path?: unknown }).path) : "unknown",
        ).join(",")}`);
        return { content: `Wrote ${files.length} files.`, ok: true };
      },
      id: "files_write_many",
      inputSchema: {
        additionalProperties: false,
        properties: {
          files: {
            items: {
              additionalProperties: false,
              properties: {
                content: { type: "string" },
                path: { type: "string" },
              },
              required: ["path", "content"],
              type: "object",
            },
            minItems: 1,
            type: "array",
          },
        },
        required: ["files"],
        type: "object",
      },
      permission: "mutating",
      risk: "mutating",
      title: "Write many workspace files",
    };
    const exclusiveTool: ToolDefinition = {
      description: "Exclusive scheduler stand-in.",
      execute: () => {
        order.push("exclusive");
        return { content: "exclusive", ok: true };
      },
      id: "exclusive_step",
      inputSchema: { type: "object" },
      permission: "diagnostic",
      risk: "diagnostic",
      scheduler: { mode: "exclusive" },
      title: "Exclusive step",
    };

    const batch = await executeToolBridgeCalls({
      calls: [
        { arguments: { content: "a", path: "src/a.ts" }, id: "write-a", name: "files_write", provider: "openai" },
        { arguments: {}, id: "exclusive", name: "exclusive_step", provider: "openai" },
        { arguments: { content: "b", path: "src/b.ts" }, id: "write-b", name: "files_write", provider: "openai" },
      ],
      context: { ...context, permissionMode: "full-access" },
      registry: new ToolRegistry([writeTool, writeManyTool, exclusiveTool]),
    });

    expect(order).toEqual(["write:src/a.ts", "exclusive", "write:src/b.ts"]);
    expect(batch.coalescedCount).toBe(0);
    expect(batch.hostExecutionCount).toBe(3);
  });

  it("returns structured errors for invalid args", async () => {
    const batch = await executeToolBridgeCalls({
      calls: [{ arguments: { values: ["bad"] }, id: "call-bad", name: "bridge_sum", provider: "openai" }],
      context,
    });

    expect(batch.toolCalls[0]?.status).toBe("error");
    expect(batch.resultMessages[0]?.result.error).toContain("number");
  });

  it("surfaces an argumentsParseError as the call failure reason", async () => {
    const batch = await executeToolBridgeCalls({
      calls: [
        {
          arguments: {},
          argumentsParseError: "Could not parse tool arguments as JSON: Unexpected end of JSON input",
          id: "call-bad-json",
          name: "bridge_echo",
          provider: "openai",
        },
      ],
      context,
    });

    expect(batch.toolCalls[0]?.status).toBe("error");
    expect(batch.resultMessages[0]?.result.error).toContain("Could not parse");
  });

  it("does not request approval for a malformed mutating tool call", async () => {
    const approval = vi.fn(() => ({ approved: true }));
    const batch = await executeToolBridgeCalls({
      approval,
      calls: [
        {
          arguments: {},
          argumentsParseError: "Could not parse tool arguments as JSON: Bad control character in string literal",
          id: "call-bad-write-json",
          name: "files_write",
          provider: "openai",
        },
      ],
      context,
    });

    expect(approval).not.toHaveBeenCalled();
    expect(batch.executedCount).toBe(0);
    expect(batch.handledCount).toBe(1);
    expect(batch.toolCalls[0]?.status).toBe("error");
    expect(batch.resultMessages[0]?.result.error).toContain("No file was changed");
  });

  it("continues the tool loop after a malformed tool call result", async () => {
    let sendCount = 0;
    const orchestrator = new ToolBridgeOrchestrator({
      context,
      send: async ({ toolResultMessages }) => {
        sendCount += 1;
        if (sendCount === 1) {
          return {
            content: "",
            toolCalls: [
              {
                arguments: {},
                argumentsParseError: "Could not parse tool arguments as JSON: Unterminated string",
                id: "call-bad-write-json",
                name: "files_write",
                provider: "openai",
              },
            ],
          };
        }

        return {
          content: `Recovered from: ${toolResultMessages[0]?.result.error}`,
        };
      },
    });

    const result = await orchestrator.run();

    expect(sendCount).toBe(2);
    expect(result.resultMessages).toHaveLength(1);
    expect(result.resultMessages[0]?.result.ok).toBe(false);
    expect(result.content).toContain("Recovered from:");
    expect(result.content).toContain("invalid JSON arguments");
  });

  it("stops repeated tool loops at the max loop count and keeps the last content", async () => {
    const orchestrator = new ToolBridgeOrchestrator({
      context,
      maxLoops: 2,
      send: async () => ({
        content: "still working",
        reasoningState: {
          entries: [{ type: "reasoning", value: "loop forever" }],
          format: "provider-effort",
          provider: "openai",
        },
        toolCalls: [{ arguments: { message: "again" }, id: "call-loop", name: "bridge_echo", provider: "openai" }],
      }),
    });

    await expect(orchestrator.run()).resolves.toMatchObject({
      content: "still working",
      loopCount: 2,
      reasoningState: {
        entries: [{ type: "reasoning", value: "loop forever" }],
      },
      resultMessages: [{ result: { content: "again", ok: true } }, { result: { content: "again", ok: true } }],
      stoppedAtMaxLoops: true,
    });
  });

  it("aborts before sending when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const send = vi.fn(async () => ({ content: "should not happen" }));
    const orchestrator = new ToolBridgeOrchestrator({
      context: { ...context, signal: controller.signal },
      send,
    });

    const result = await orchestrator.run();

    expect(send).not.toHaveBeenCalled();
    expect(result.abortedBySignal).toBe(true);
    expect(result.stoppedAtMaxLoops).toBe(false);
  });

  it("aborts between loops when the signal flips mid-run", async () => {
    const controller = new AbortController();
    let sendCount = 0;
    const orchestrator = new ToolBridgeOrchestrator({
      context: { ...context, signal: controller.signal },
      maxLoops: 5,
      send: async () => {
        sendCount += 1;
        if (sendCount === 1) {
          return {
            content: "running",
            toolCalls: [{ arguments: { message: "hi" }, id: "call-1", name: "bridge_echo", provider: "openai" }],
          };
        }
        controller.abort();
        return {
          content: "running",
          toolCalls: [{ arguments: { message: "hi" }, id: `call-${sendCount}`, name: "bridge_echo", provider: "openai" }],
        };
      },
    });

    const result = await orchestrator.run();

    expect(result.abortedBySignal).toBe(true);
    // Should have stopped before maxLoops once the signal was honored.
    expect(result.loopCount).toBeLessThan(5);
  });

  it("marks in-flight tool aborts as canceled instead of failed issues", async () => {
    const controller = new AbortController();
    const slowTool: ToolDefinition = {
      description: "Waits until canceled.",
      execute: async () => new Promise<ToolExecutionResult>(() => undefined),
      id: "slow_read",
      inputSchema: { type: "object" },
      permission: "read-only",
      risk: "read",
      title: "Slow read",
    };
    const telemetry: ToolBridgeTelemetryEvent[] = [];
    const batchPromise = executeToolBridgeCalls({
      calls: [{ arguments: {}, id: "call-slow", name: "slow_read", provider: "openai" }],
      context: { ...context, signal: controller.signal },
      registry: new ToolRegistry([slowTool]),
      telemetry: (event) => telemetry.push(event),
    });

    await Promise.resolve();
    controller.abort();
    const batch = await batchPromise;

    expect(batch.toolCalls[0]?.status).toBe("skipped");
    expect(batch.toolCalls[0]?.detail).toBe("Tool run was canceled before it finished.");
    expect(batch.toolCalls[0]?.output).not.toContain("tool bridge run was aborted");
    expect(batch.resultMessages[0]?.result.skippedReason).toBe("Tool run was canceled before it finished.");
    expect(batch.resultMessages[0]?.result.error).toBeUndefined();
    expect(telemetry).toContainEqual(expect.objectContaining({
      reason: "Tool run was canceled before it finished.",
      toolId: "slow_read",
      type: "tool-skipped",
    }));
  });

  it("normalizes tool-returned abort messages as canceled skips", async () => {
    const controller = new AbortController();
    const abortingTool: ToolDefinition = {
      description: "Returns an internal abort result.",
      execute: () => {
        controller.abort();
        return { content: "Tool bridge run aborted before files_read_many finished reading files.", ok: false };
      },
      id: "abort_result_read",
      inputSchema: { type: "object" },
      permission: "read-only",
      risk: "read",
      title: "Abort result read",
    };
    const batch = await executeToolBridgeCalls({
      calls: [{ arguments: {}, id: "call-abort-result", name: "abort_result_read", provider: "openai" }],
      context: { ...context, signal: controller.signal },
      registry: new ToolRegistry([abortingTool]),
    });

    expect(batch.toolCalls[0]?.status).toBe("skipped");
    expect(batch.toolCalls[0]?.detail).toBe("Tool run was canceled before it finished.");
    expect(batch.toolCalls[0]?.output).not.toContain("Tool bridge run aborted");
  });

  it("dedupes tool calls that share an id and only executes the first", async () => {
    const executed: string[] = [];
    const counterTool: ToolDefinition = {
      description: "Records each execution.",
      execute: (args) => {
        executed.push(String(args.tag));
        return { content: String(args.tag), ok: true };
      },
      id: "diag_counter",
      inputSchema: {
        additionalProperties: false,
        properties: { tag: { type: "string" } },
        required: ["tag"],
        type: "object",
      },
      permission: "diagnostic",
      risk: "diagnostic",
      title: "Diag counter",
    };
    const registry = new ToolRegistry([counterTool]);

    const batch = await executeToolBridgeCalls({
      calls: [
        { arguments: { tag: "first" }, id: "shared", name: "diag_counter", provider: "openai" },
        { arguments: { tag: "second" }, id: "shared", name: "diag_counter", provider: "openai" },
      ],
      context,
      registry,
    });

    expect(executed).toEqual(["first"]);
    expect(batch.toolCalls.map((call) => call.status)).toEqual(["complete", "skipped"]);
    expect(batch.resultMessages[1]?.result.skippedReason).toContain("Duplicate tool call id");
  });

  it("caps concurrency at the configured max", async () => {
    let inflight = 0;
    let peakInflight = 0;
    const slowTool: ToolDefinition = {
      description: "Tracks inflight count.",
      execute: async () => {
        inflight += 1;
        peakInflight = Math.max(peakInflight, inflight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inflight -= 1;
        return { content: "ok", ok: true };
      },
      id: "slow_tool",
      inputSchema: { type: "object" },
      permission: "diagnostic",
      risk: "diagnostic",
      title: "Slow tool",
    };
    const registry = new ToolRegistry([slowTool]);

    await executeToolBridgeCalls({
      calls: Array.from({ length: 10 }, (_, index) => ({
        arguments: {},
        id: `slow-${index}`,
        name: "slow_tool",
        provider: "openai" as const,
      })),
      context,
      maxConcurrency: 2,
      registry,
    });

    expect(peakInflight).toBeLessThanOrEqual(2);
  });

  it("applies lower concurrency caps to connected app and web families", async () => {
    let githubInflight = 0;
    let githubPeakInflight = 0;
    let webInflight = 0;
    let webPeakInflight = 0;
    const githubTool: ToolDefinition = {
      description: "Connected GitHub read.",
      execute: async () => {
        githubInflight += 1;
        githubPeakInflight = Math.max(githubPeakInflight, githubInflight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        githubInflight -= 1;
        return { content: "ok", ok: true };
      },
      executorMetadata: { family: "github", version: 1 },
      id: "github_slow_read",
      inputSchema: { type: "object" },
      permission: "read-only",
      risk: "read",
      title: "GitHub slow read",
    };
    const webTool: ToolDefinition = {
      description: "Web read.",
      execute: async () => {
        webInflight += 1;
        webPeakInflight = Math.max(webPeakInflight, webInflight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        webInflight -= 1;
        return { content: "ok", ok: true };
      },
      executorMetadata: { family: "web", version: 1 },
      id: "web_slow_read",
      inputSchema: { type: "object" },
      permission: "read-only",
      risk: "read",
      title: "Web slow read",
    };

    await executeToolBridgeCalls({
      calls: Array.from({ length: 5 }, (_, index) => ({
        arguments: {},
        id: `github-${index}`,
        name: "github_slow_read",
        provider: "openai" as const,
      })),
      context,
      maxConcurrency: 4,
      registry: new ToolRegistry([githubTool]),
    });
    await executeToolBridgeCalls({
      calls: Array.from({ length: 3 }, (_, index) => ({
        arguments: {},
        id: `web-${index}`,
        name: "web_slow_read",
        provider: "openai" as const,
      })),
      context,
      maxConcurrency: 4,
      registry: new ToolRegistry([webTool]),
    });

    expect(githubPeakInflight).toBeLessThanOrEqual(2);
    expect(webPeakInflight).toBe(1);
  });

  it("does not let a capped web call serialize unrelated file reads", async () => {
    let globalInflight = 0;
    let globalPeakInflight = 0;
    let fileInflight = 0;
    let filePeakInflight = 0;
    let webInflight = 0;
    let webPeakInflight = 0;
    const trackStart = (family: "files" | "web") => {
      globalInflight += 1;
      globalPeakInflight = Math.max(globalPeakInflight, globalInflight);

      if (family === "files") {
        fileInflight += 1;
        filePeakInflight = Math.max(filePeakInflight, fileInflight);
      } else {
        webInflight += 1;
        webPeakInflight = Math.max(webPeakInflight, webInflight);
      }
    };
    const trackEnd = (family: "files" | "web") => {
      globalInflight -= 1;
      if (family === "files") {
        fileInflight -= 1;
      } else {
        webInflight -= 1;
      }
    };
    const fileTool: ToolDefinition = {
      description: "File read.",
      execute: async () => {
        trackStart("files");
        await new Promise((resolve) => setTimeout(resolve, 5));
        trackEnd("files");
        return { content: "file", ok: true };
      },
      executorMetadata: { family: "files", version: 1 },
      id: "files_slow_read",
      inputSchema: { type: "object" },
      permission: "read-only",
      risk: "read",
      title: "Files slow read",
    };
    const webTool: ToolDefinition = {
      description: "Web read.",
      execute: async () => {
        trackStart("web");
        await new Promise((resolve) => setTimeout(resolve, 5));
        trackEnd("web");
        return { content: "web", ok: true };
      },
      executorMetadata: { family: "web", version: 1 },
      id: "web_slow_read",
      inputSchema: { type: "object" },
      permission: "read-only",
      risk: "read",
      title: "Web slow read",
    };

    await executeToolBridgeCalls({
      calls: [
        { arguments: {}, id: "web-0", name: "web_slow_read", provider: "openai" },
        { arguments: {}, id: "file-0", name: "files_slow_read", provider: "openai" },
        { arguments: {}, id: "file-1", name: "files_slow_read", provider: "openai" },
      ],
      context,
      maxConcurrency: 3,
      registry: new ToolRegistry([webTool, fileTool]),
    });

    expect(webPeakInflight).toBe(1);
    expect(filePeakInflight).toBeGreaterThan(1);
    expect(globalPeakInflight).toBeGreaterThan(1);
  });

  it("fails a hanging tool through the central timeout wrapper", async () => {
    const events: ToolBridgeTelemetryEvent[] = [];
    const hangingTool: ToolDefinition = {
      description: "Never resolves.",
      execute: () => new Promise<ToolExecutionResult>(() => undefined),
      executorMetadata: { family: "github", version: 1 },
      id: "github_hanging_read",
      inputSchema: { type: "object" },
      permission: "read-only",
      risk: "read",
      title: "GitHub hanging read",
    };

    const batch = await executeToolBridgeCalls({
      calls: [{ arguments: {}, id: "hang", name: "github_hanging_read", provider: "openai" }],
      context,
      registry: new ToolRegistry([hangingTool]),
      telemetry: (event) => events.push(event),
      toolTimeoutMs: 5,
    });

    expect(batch.executedCount).toBe(0);
    expect(batch.toolCalls[0]?.status).toBe("error");
    expect(batch.resultMessages[0]?.result.error).toContain("timed out");
    expect(events).toContainEqual(expect.objectContaining({
      ok: false,
      toolId: "github_hanging_read",
      type: "tool-invoked",
    }));
  });

  it("runs exclusive tools between parallel-safe segments", async () => {
    const order: string[] = [];
    const readTool: ToolDefinition = {
      description: "Slow read.",
      execute: async (args) => {
        const tag = String(args.tag);
        order.push(`start-${tag}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push(`end-${tag}`);
        return { content: tag, ok: true };
      },
      id: "read_segment",
      inputSchema: {
        additionalProperties: false,
        properties: { tag: { type: "string" } },
        required: ["tag"],
        type: "object",
      },
      permission: "read-only",
      risk: "read",
      title: "Read segment",
    };
    const terminalTool: ToolDefinition = {
      description: "Exclusive scheduler stand-in.",
      execute: () => {
        order.push("terminal");
        return { content: "terminal", ok: true };
      },
      id: "terminal_segment",
      inputSchema: { type: "object" },
      permission: "diagnostic",
      risk: "diagnostic",
      scheduler: { mode: "exclusive" },
      title: "Terminal segment",
    };

    await executeToolBridgeCalls({
      calls: [
        { arguments: { tag: "a" }, id: "read-a", name: "read_segment", provider: "openai" },
        { arguments: {}, id: "term", name: "terminal_segment", provider: "openai" },
        { arguments: { tag: "b" }, id: "read-b", name: "read_segment", provider: "openai" },
      ],
      context,
      maxConcurrency: 3,
      registry: new ToolRegistry([readTool, terminalTool]),
    });

    expect(order).toEqual(["start-a", "end-a", "terminal", "start-b", "end-b"]);
  });

  it("routes approval-required calls through the approval callback when provided", async () => {
    const mutatingTool: ToolDefinition = {
      description: "Mutates something.",
      execute: () => ({ content: "mutated", ok: true }),
      id: "mutator",
      inputSchema: { type: "object" },
      permission: "mutating",
      risk: "mutating",
      title: "Mutator",
    };
    const registry = new ToolRegistry([mutatingTool]);
    const approval: ToolApprovalCallback = vi.fn(async () => ({ approved: true }));

    const batch = await executeToolBridgeCalls({
      approval,
      calls: [{ arguments: {}, id: "call-mutator", name: "mutator", provider: "openai" }],
      context: { ...context, permissionMode: "auto-review" },
      registry,
    });

    expect(approval).toHaveBeenCalledOnce();
    expect(batch.toolCalls[0]?.status).toBe("complete");
    expect(batch.resultMessages[0]?.result.content).toBe("mutated");
  });

  it("treats a denied approval as a skip", async () => {
    const mutatingTool: ToolDefinition = {
      description: "Mutates something.",
      execute: () => ({ content: "mutated", ok: true }),
      id: "mutator_deny",
      inputSchema: { type: "object" },
      permission: "mutating",
      risk: "mutating",
      title: "Mutator deny",
    };
    const registry = new ToolRegistry([mutatingTool]);
    const approval: ToolApprovalCallback = async () => ({ approved: false, reason: "user said no" });

    const batch = await executeToolBridgeCalls({
      approval,
      calls: [{ arguments: {}, id: "call-mutator-deny", name: "mutator_deny", provider: "openai" }],
      context: { ...context, permissionMode: "auto-review" },
      registry,
    });

    expect(batch.toolCalls[0]?.status).toBe("skipped");
    expect(batch.resultMessages[0]?.result.skippedReason).toBe("user said no");
  });

  it("swallows throwing onToolCallUpdate callbacks", async () => {
    const batch = await executeToolBridgeCalls({
      calls: [{ arguments: { message: "hi" }, id: "call-echo", name: "bridge_echo", provider: "openai" }],
      context,
      onToolCallUpdate: () => {
        throw new Error("UI exploded");
      },
    });

    expect(batch.toolCalls[0]?.status).toBe("complete");
  });

  it("coalesces rapid tool progress updates before the final tool result", async () => {
    const observedProgress: ToolExecutionResult[] = [];
    const updates: ChatToolCall[] = [];
    const progressTool: ToolDefinition = {
      description: "Reports noisy progress.",
      execute: (_args, executionContext) => {
        executionContext.reportProgress?.({ content: "step 1", ok: true });
        executionContext.reportProgress?.({ content: "step 2", ok: true });
        executionContext.reportProgress?.({ content: "step 3", ok: true });
        return { content: "done", ok: true };
      },
      id: "progress_noise",
      inputSchema: { type: "object" },
      permission: "diagnostic",
      risk: "diagnostic",
      title: "Progress noise",
    };
    const registry = new ToolRegistry([progressTool]);

    const batch = await executeToolBridgeCalls({
      calls: [{ arguments: {}, id: "call-progress-noise", name: "progress_noise", provider: "openai" }],
      context: {
        ...context,
        reportProgress: (progress) => observedProgress.push(progress),
      },
      onToolCallUpdate: (toolCall) => updates.push(toolCall),
      registry,
    });

    const activeUpdates = updates.filter((toolCall) => toolCall.status === "active");

    expect(observedProgress.map((progress) => progress.content)).toEqual(["step 1", "step 3"]);
    expect(activeUpdates.map((toolCall) => toolCall.output)).toEqual(["Tool bridge call started.", "step 1", "step 3"]);
    expect(batch.toolCalls[0]?.status).toBe("complete");
    expect(updates[updates.length - 1]?.status).toBe("complete");
  });

  it("caps oversized active progress payloads without changing the final result", async () => {
    const observedProgress: ToolExecutionResult[] = [];
    const hugeProgress = "x".repeat(9_000);
    const progressTool: ToolDefinition = {
      description: "Reports oversized progress.",
      execute: (_args, executionContext) => {
        executionContext.reportProgress?.({ content: hugeProgress, ok: true });
        return { content: hugeProgress, ok: true };
      },
      id: "progress_huge",
      inputSchema: { type: "object" },
      permission: "diagnostic",
      risk: "diagnostic",
      title: "Progress huge",
    };
    const registry = new ToolRegistry([progressTool]);

    const batch = await executeToolBridgeCalls({
      calls: [{ arguments: {}, id: "call-progress-huge", name: "progress_huge", provider: "openai" }],
      context: {
        ...context,
        reportProgress: (progress) => observedProgress.push(progress),
      },
      registry,
    });

    expect(observedProgress[0]?.content).toContain("[Tool progress truncated for UI performance.]");
    expect(observedProgress[0]?.content.length).toBeLessThan(hugeProgress.length);
    expect(batch.resultMessages[0]?.result.content).toBe(hugeProgress);
  });

  it("emits telemetry events for invocation, validation failure, and approval", async () => {
    const events: ToolBridgeTelemetryEvent[] = [];
    const sink = (event: ToolBridgeTelemetryEvent) => {
      events.push(event);
    };

    const mutatingTool: ToolDefinition = {
      description: "Mutates something.",
      execute: () => ({ content: "mutated", ok: true }),
      executorMetadata: { family: "files", version: 1 },
      id: "telemetry_mutator",
      inputSchema: { type: "object" },
      permission: "mutating",
      risk: "mutating",
      title: "Telemetry mutator",
    };
    const registry = new ToolRegistry([...createDefaultToolRegistry().list(), mutatingTool]);

    await executeToolBridgeCalls({
      approval: async () => ({ approved: true }),
      calls: [
        { arguments: { values: ["nope"] }, id: "call-fail", name: "bridge_sum", provider: "openai" },
        { arguments: {}, id: "call-mut", name: "telemetry_mutator", provider: "openai" },
      ],
      context: { ...context, permissionMode: "auto-review" },
      registry,
      telemetry: sink,
    });

    const eventTypes = events.map((event) => event.type);
    expect(eventTypes).toContain("tool-validation-failed");
    expect(eventTypes).toContain("tool-approval-requested");
    expect(eventTypes).toContain("tool-approval-resolved");
    expect(eventTypes).toContain("tool-invoked");
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
