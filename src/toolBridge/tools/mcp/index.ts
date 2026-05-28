import {
  callMcpTool,
  callMcpToolWithProgress,
  getMcpState,
  listMcpServerTools,
} from "../../../app/mcpClient";
import type {
  McpCallToolRequest,
  McpConnectionState,
  McpListToolsResponse,
  McpServerProgressEvent,
  McpServerState,
  McpToolCallResponse,
} from "../../../types/mcp";
import type { JsonValue, ToolDefinition, ToolExecutionContext, ToolExecutionResult } from "../../types";

const MCP_PROGRESS_MIN_INTERVAL_MS = 400;
const MCP_PROGRESS_MAX_MESSAGE_CHARS = 800;

export interface McpToolBackend {
  callTool: (request: McpCallToolRequest) => Promise<McpToolCallResponse>;
  callToolWithProgress?: (request: McpCallToolRequest, onEvent: (event: McpServerProgressEvent) => void) => Promise<McpToolCallResponse>;
  getState: () => Promise<McpConnectionState>;
  listTools: (request: { serverId: string }) => Promise<McpListToolsResponse>;
}

export const defaultMcpToolBackend: McpToolBackend = {
  callTool: (request) => callMcpTool(request),
  callToolWithProgress: (request, onEvent) => callMcpToolWithProgress(request, onEvent),
  getState: () => getMcpState(),
  listTools: (request) => listMcpServerTools(request),
};

export function createMcpTools(backend: McpToolBackend = defaultMcpToolBackend): ToolDefinition[] {
  return [
    createMcpListServersTool(backend),
    createMcpListToolsTool(backend),
    createMcpCallTool(backend),
  ];
}

export const mcpTools: ToolDefinition[] = createMcpTools();

function createMcpListServersTool(backend: McpToolBackend): ToolDefinition {
  return mcpReadTool({
    description: "List configured MCP servers and their cached tool summaries without exposing bearer tokens.",
    execute: async (args, context) => {
      try {
        const state = await backend.getState();
        const includeDisabled = args.includeDisabled === true;
        const servers = filterMcpServersForAutomation(
          includeDisabled ? state.servers : state.servers.filter((server) => server.enabled),
          context,
        );

        return {
          content: formatMcpServerList(state, servers, includeDisabled),
          data: { ...state, servers } as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not list MCP servers."));
      }
    },
    id: "mcp_list_servers",
    inputSchema: {
      additionalProperties: false,
      properties: {
        includeDisabled: {
          description: "Include disabled MCP servers in the inventory.",
          type: "boolean",
        },
      },
      type: "object",
    },
    title: "List MCP servers",
  });
}

function createMcpListToolsTool(backend: McpToolBackend): ToolDefinition {
  return mcpNetworkReadTool({
    description: "Refresh and list tools exposed by one configured MCP server. Use this before mcp_call_tool unless the exact tool name and schema are already known.",
    execute: async (args, context) => {
      const serverId = stringArg(args.serverId);

      if (!serverId) {
        return createErrorResult("mcp_list_tools requires serverId.");
      }

      const serverScope = resolveAutomationMcpServerScope(context, serverId);
      if (serverScope && !serverScope.allowed) {
        return createErrorResult(serverScope.reason);
      }

      try {
        const response = await backend.listTools({ serverId });
        const allowedToolNames = serverScope?.allowed ? serverScope.toolNames : undefined;
        const tools = filterMcpToolsForAutomation(response.tools, allowedToolNames);
        const server = {
          ...response.server,
          tools: filterMcpToolsForAutomation(response.server.tools, allowedToolNames),
        };

        return {
          content: formatMcpToolList({ ...response, server, tools }),
          data: { ...response, server, tools } as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not list MCP tools."));
      }
    },
    id: "mcp_list_tools",
    inputSchema: {
      additionalProperties: false,
      properties: {
        serverId: {
          description: "Configured MCP server id from mcp_list_servers.",
          minLength: 1,
          type: "string",
        },
      },
      required: ["serverId"],
      type: "object",
    },
    title: "List MCP tools",
  });
}

function createMcpCallTool(backend: McpToolBackend): ToolDefinition {
  return {
    description:
      "Call a tool on a configured MCP server. Use only after choosing a serverId and exact toolName from mcp_list_servers or mcp_list_tools, and pass arguments that match that tool's input schema.",
    execute: async (args, context) => {
      const serverId = stringArg(args.serverId);
      const toolName = stringArg(args.toolName);
      const toolArguments = objectArg(args.arguments);

      if (!serverId || !toolName) {
        return createErrorResult("mcp_call_tool requires serverId and toolName.");
      }

      if (!toolArguments.ok) {
        return createErrorResult(toolArguments.error);
      }

      const toolScope = resolveAutomationMcpToolScope(context, serverId, toolName);
      if (!toolScope.allowed) {
        return createErrorResult(toolScope.reason);
      }

      try {
        const request = {
          arguments: toolArguments.value,
          serverId,
          toolName,
        };
        const progressReporter = createMcpToolProgressReporter(context, serverId, toolName);
        const response = backend.callToolWithProgress
          ? await backend.callToolWithProgress(request, progressReporter)
          : await backend.callTool(request);

        return {
          content: formatMcpCallResponse(response),
          data: response as unknown as JsonValue,
          error: response.ok ? undefined : response.content,
          ok: response.ok,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not call the MCP tool."));
      }
    },
    executorMetadata: { family: "mcp", version: 1 },
    id: "mcp_call_tool",
    inputSchema: {
      additionalProperties: false,
      properties: {
        arguments: {
          additionalProperties: true,
          description: "JSON object arguments for the selected MCP tool.",
          type: "object",
        },
        serverId: {
          description: "Configured MCP server id from mcp_list_servers.",
          minLength: 1,
          type: "string",
        },
        toolName: {
          description: "Exact MCP tool name from mcp_list_tools.",
          minLength: 1,
          type: "string",
        },
      },
      required: ["serverId", "toolName"],
      type: "object",
    },
    permission: "network",
    risk: "network",
    scheduler: { mode: "exclusive" },
    title: "Call MCP tool",
  };
}

function createMcpToolProgressReporter(
  context: ToolExecutionContext,
  serverId: string,
  toolName: string,
): (event: McpServerProgressEvent) => void {
  let lastOutputReportedAt = 0;
  let skippedOutputCount = 0;
  let latestSkippedOutput = "";
  let latestSkippedStream: McpServerProgressEvent["stream"];

  return (event) => {
    if (event.kind === "output") {
      const now = Date.now();
      if (lastOutputReportedAt > 0 && now - lastOutputReportedAt < MCP_PROGRESS_MIN_INTERVAL_MS) {
        skippedOutputCount += 1;
        latestSkippedOutput = event.message?.trim() ?? latestSkippedOutput;
        latestSkippedStream = event.stream;
        return;
      }

      lastOutputReportedAt = now;
      reportMcpToolProgress(context, event, serverId, toolName);
      return;
    }

    if (skippedOutputCount > 0) {
      reportMcpToolProgress(
        context,
        {
          kind: "output",
          message: `${skippedOutputCount} additional MCP output update${skippedOutputCount === 1 ? "" : "s"} suppressed for UI performance.${latestSkippedOutput ? ` Latest: ${latestSkippedOutput}` : ""}`,
          stream: latestSkippedStream,
        },
        serverId,
        toolName,
      );
      skippedOutputCount = 0;
      latestSkippedOutput = "";
      latestSkippedStream = undefined;
      lastOutputReportedAt = Date.now();
    }

    reportMcpToolProgress(context, event, serverId, toolName);
  };
}

function reportMcpToolProgress(
  context: ToolExecutionContext,
  event: McpServerProgressEvent,
  serverId: string,
  toolName: string,
) {
  const message = event.message?.trim();

  if (!message) {
    return;
  }

  context.reportProgress?.({
    content: formatMcpProgressEvent(event),
    data: {
      kind: event.kind,
      message,
      serverId,
      stream: event.stream,
      toolName,
    } as unknown as JsonValue,
    ok: true,
  });
}

function formatMcpProgressEvent(event: McpServerProgressEvent) {
  const message = limitMcpProgressMessage(event.message);
  const prefix = event.kind === "output"
    ? event.stream ? `MCP ${event.stream}` : "MCP output"
    : `MCP ${event.kind}`;

  return `${prefix}: ${message}`;
}

function limitMcpProgressMessage(message: string | undefined) {
  const trimmed = message?.trim() ?? "";
  if (trimmed.length <= MCP_PROGRESS_MAX_MESSAGE_CHARS) {
    return trimmed;
  }

  return `${trimmed.slice(0, MCP_PROGRESS_MAX_MESSAGE_CHARS).trimEnd()}...`;
}

function mcpReadTool(tool: Omit<ToolDefinition, "executorMetadata" | "permission" | "risk">): ToolDefinition {
  return {
    ...tool,
    executorMetadata: { family: "mcp", version: 1 },
    permission: "read-only",
    risk: "read",
  };
}

function mcpNetworkReadTool(tool: Omit<ToolDefinition, "executorMetadata" | "permission" | "risk">): ToolDefinition {
  return {
    ...tool,
    executorMetadata: { family: "mcp", version: 1 },
    permission: "read-only",
    risk: "read",
  };
}

function formatMcpServerList(state: McpConnectionState, servers: McpServerState[], includeDisabled: boolean) {
  if (servers.length === 0) {
    return includeDisabled
      ? "No MCP servers are configured. Add one from the Apps page before using MCP tools."
      : "No enabled MCP servers are configured. Add or enable one from the Apps page before using MCP tools.";
  }

  return [
    `MCP servers: ${servers.length} shown, ${state.enabledServerCount}/${state.maxServers} enabled.`,
    "Use mcp_list_tools with a serverId before calling a server tool unless the exact tool name and schema are already known.",
    "",
    servers.map((server, index) => formatMcpServerSummary(server, index + 1)).join("\n\n"),
  ].join("\n");
}

function formatMcpServerSummary(server: McpServerState, index: number) {
  const tools = server.tools ?? [];

  return [
    `${index}. ${server.name}${server.enabled ? "" : " (disabled)"}`,
    `serverId: ${server.id}`,
    `Transport: ${server.transport === "stdio" ? "stdio" : "HTTP"}`,
    `Target: ${formatMcpServerTarget(server)}`,
    server.serverName ? `Server info: ${server.serverName}${server.serverVersion ? ` ${server.serverVersion}` : ""}` : undefined,
    `Cached tools: ${tools.length}`,
    server.lastError ? `Last error: ${server.lastError}` : undefined,
    tools.length ? `Tool names: ${tools.slice(0, 12).map((tool) => tool.name).join(", ")}${tools.length > 12 ? ", ..." : ""}` : undefined,
  ].filter(Boolean).join("\n");
}

function formatMcpServerTarget(server: McpServerState) {
  if (server.transport === "stdio") {
    const command = [server.command, ...(server.args ?? [])].filter(Boolean).join(" ");

    return command || "stdio server";
  }

  return server.endpoint ?? "HTTP endpoint";
}

function filterMcpServersForAutomation(servers: McpServerState[], context: ToolExecutionContext) {
  const scopes = context.automationScope?.allowedMcpServers;

  if (!context.automationScope) {
    return servers;
  }

  if (!scopes?.length) {
    return [];
  }

  const scopeByServerId = new Map(scopes.map((scope) => [scope.serverId, scope]));

  return servers
    .filter((server) => scopeByServerId.has(server.id))
    .map((server) => ({
      ...server,
      tools: filterMcpToolsForAutomation(server.tools, scopeByServerId.get(server.id)?.toolNames),
    }));
}

function filterMcpToolsForAutomation(tools: McpServerState["tools"], allowedToolNames?: string[]) {
  if (!allowedToolNames) {
    return tools;
  }

  const allowed = new Set(allowedToolNames);
  return (tools ?? []).filter((tool) => allowed.has(tool.name));
}

function resolveAutomationMcpServerScope(
  context: ToolExecutionContext,
  serverId: string,
): { allowed: true; toolNames: string[] } | { allowed: false; reason: string } | undefined {
  if (!context.automationScope) {
    return undefined;
  }

  const scope = context.automationScope.allowedMcpServers?.find((candidate) => candidate.serverId === serverId);

  if (!scope) {
    return {
      allowed: false,
      reason: `This task is not allowed to use MCP server ${serverId}.`,
    };
  }

  return {
    allowed: true,
    toolNames: scope.toolNames,
  };
}

function resolveAutomationMcpToolScope(
  context: ToolExecutionContext,
  serverId: string,
  toolName: string,
): { allowed: true } | { allowed: false; reason: string } {
  const serverScope = resolveAutomationMcpServerScope(context, serverId);

  if (!serverScope) {
    return { allowed: true };
  }

  if (!serverScope.allowed) {
    return serverScope;
  }

  if (!serverScope.toolNames.includes(toolName)) {
    return {
      allowed: false,
      reason: `This task is not allowed to call MCP tool ${toolName} on server ${serverId}.`,
    };
  }

  return { allowed: true };
}

function formatMcpToolList(response: McpListToolsResponse) {
  const tools = response.tools ?? [];

  if (tools.length === 0) {
    return `MCP server ${response.server.name} returned no tools.`;
  }

  return [
    `MCP tools for ${response.server.name}`,
    `serverId: ${response.server.id}`,
    `Tools: ${tools.length}`,
    "",
    tools.map((tool, index) => [
      `${index + 1}. ${tool.name}`,
      tool.description ? `Description: ${tool.description}` : undefined,
      tool.inputSchema ? `Input schema: ${truncate(serialize(tool.inputSchema), 1800)}` : undefined,
    ].filter(Boolean).join("\n")).join("\n\n"),
    "",
    "Call mcp_call_tool with this serverId, an exact toolName, and arguments matching the selected input schema.",
  ].join("\n");
}

function formatMcpCallResponse(response: McpToolCallResponse) {
  const structured = formatStructuredMcpContent(response.structuredContent, response.content);

  return [
    `MCP TOOL RESULT - ${response.server.name} / ${response.toolName}`,
    `Status: ${response.ok ? "ok" : "tool reported error"}`,
    "",
    response.content || "(No content returned.)",
    structured ? `\n--- Structured content ---\n${structured}` : "",
  ].join("\n");
}

function formatStructuredMcpContent(value: unknown, visibleContent: string) {
  if (value === undefined || value === null) {
    return "";
  }

  const details = readStructuredMcpDetails(value);
  if (!details || visibleContent.includes(details)) {
    return "";
  }

  return details;
}

function readStructuredMcpDetails(value: unknown): string {
  if (!isPlainObject(value)) {
    return serialize(value);
  }

  const lines: string[] = [];
  const record = value as Record<string, unknown>;

  for (const [key, label] of [
    ["status", "Status"],
    ["progress", "Progress"],
    ["error", "Error"],
    ["message", "Message"],
    ["jobId", "Job ID"],
  ] as const) {
    const text = scalarText(record[key]);
    if (text) {
      lines.push(`${label}: ${text}`);
    }
  }

  if (Array.isArray(record.logs)) {
    const logs = record.logs.map(scalarText).filter(Boolean).slice(0, 20);
    if (logs.length > 0) {
      lines.push(`Logs:\n${logs.join("\n")}`);
    }
  }

  return lines.length > 0 ? lines.join("\n") : serialize(value);
}

function scalarText(value: unknown) {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return "";
}

function isPlainObject(value: unknown) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringArg(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function objectArg(value: unknown): { ok: true; value: Record<string, unknown> } | { error: string; ok: false } {
  if (value === undefined || value === null) {
    return { ok: true, value: {} };
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    return { ok: true, value: value as Record<string, unknown> };
  }

  return { error: "MCP tool arguments must be a JSON object.", ok: false };
}

function serialize(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}\n[truncated]` : value;
}

function createErrorResult(message: string): ToolExecutionResult {
  return {
    content: message,
    error: message,
    ok: false,
  };
}

function readErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : typeof error === "string" && error.trim() ? error : fallback;
}
