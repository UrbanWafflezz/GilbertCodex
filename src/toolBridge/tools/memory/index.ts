import type { JsonValue, ToolDefinition, ToolExecutionContext, ToolExecutionResult, ToolMemorySearchRequest } from "../../types";

const DEFAULT_MEMORY_TOOL_MAX_RECORDS = 10;
const DEFAULT_MEMORY_TOOL_MAX_CHARS = 8_000;
const MAX_MEMORY_TOOL_RECORDS = 24;
const MAX_MEMORY_TOOL_CHARS = 24_000;

export function createMemorySearchTool(): ToolDefinition {
  return {
    description:
      "Search saved local chat/project memory and project-specific tool lessons for context that may help this task. " +
      "Use this when prior decisions, previous tool failures, remembered project structure, planning context, or continuity from older chats could matter. " +
      "Memory can be stale: verify current files with file tools before making code claims or edits.",
    execute: async (args, context) => executeMemorySearchTool(args, context),
    executorMetadata: { family: "memory", version: 1 },
    id: "memory_search",
    inputSchema: {
      additionalProperties: false,
      properties: {
        includeProjectMap: {
          description: "Include remembered project/file-map hints when available. Default true.",
          type: "boolean",
        },
        includeRecentEvents: {
          description: "Include a small recent-event timeline when useful for continuity. Default true.",
          type: "boolean",
        },
        includeToolLessons: {
          description: "Include project-specific lessons from previous tool failures and recoveries. Default true.",
          type: "boolean",
        },
        maxChars: {
          description: "Maximum characters of memory context to return.",
          maximum: MAX_MEMORY_TOOL_CHARS,
          minimum: 1_200,
          type: "integer",
        },
        maxRecords: {
          description: "Maximum durable memory records to return.",
          maximum: MAX_MEMORY_TOOL_RECORDS,
          minimum: 1,
          type: "integer",
        },
        query: {
          description: "Focused memory query. Mention the project area, file, feature, bug, prior decision, or tool behavior you need.",
          maxLength: 500,
          minLength: 1,
          type: "string",
        },
      },
      required: ["query"],
      type: "object",
    },
    permission: "read-only",
    risk: "read",
    scheduler: { mode: "parallel" },
    title: "Search memory",
  };
}

export function createMemoryTools(): ToolDefinition[] {
  return [
    createMemorySearchTool(),
  ];
}

export const memoryTools: ToolDefinition[] = createMemoryTools();

async function executeMemorySearchTool(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const query = stringArg(args.query);

  if (!query) {
    return createErrorResult("memory_search requires a non-empty query.");
  }

  if (!context.memorySearch) {
    return createErrorResult("Memory search is not connected for this runtime.");
  }

  const request: ToolMemorySearchRequest = {
    includeProjectMap: booleanArg(args.includeProjectMap, true),
    includeRecentEvents: booleanArg(args.includeRecentEvents, true),
    includeToolLessons: booleanArg(args.includeToolLessons, true),
    maxChars: integerArg(args.maxChars, DEFAULT_MEMORY_TOOL_MAX_CHARS, 1_200, MAX_MEMORY_TOOL_CHARS),
    maxRecords: integerArg(args.maxRecords, DEFAULT_MEMORY_TOOL_MAX_RECORDS, 1, MAX_MEMORY_TOOL_RECORDS),
    query,
  };
  const response = await context.memorySearch(request);
  const content = formatMemorySearchToolOutput(request, response.content, {
    projectName: response.projectName,
    storedRecordCount: response.storedRecordCount,
    toolLessonCount: response.toolLessonCount,
  });

  return {
    content,
    data: {
      chatTitle: response.chatTitle ?? null,
      projectName: response.projectName ?? null,
      query,
      storedRecordCount: response.storedRecordCount ?? null,
      toolLessonCount: response.toolLessonCount ?? null,
    } satisfies JsonValue,
    ok: true,
  };
}

function formatMemorySearchToolOutput(
  request: ToolMemorySearchRequest,
  rawContent: string,
  metadata: { projectName?: string; storedRecordCount?: number; toolLessonCount?: number },
) {
  const content = rawContent.trim();
  const header = [
    "LOCAL MEMORY SEARCH RESULTS",
    `Query: ${request.query}`,
    metadata.projectName ? `Project: ${metadata.projectName}` : "",
    typeof metadata.storedRecordCount === "number" ? `Stored durable records searched: ${metadata.storedRecordCount}` : "",
    typeof metadata.toolLessonCount === "number" ? `Project tool lessons searched: ${metadata.toolLessonCount}` : "",
    "Use these results as local continuity context. Memory can be stale; verify current source files, commands, and external facts with the appropriate tools before relying on them.",
  ].filter(Boolean);

  if (!content) {
    return [
      ...header,
      "No saved local memory matched this query.",
    ].join("\n");
  }

  return [
    ...header,
    "",
    content,
  ].join("\n");
}

function stringArg(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function booleanArg(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function integerArg(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return Math.max(min, Math.min(max, Math.round(fallback)));
  }

  return Math.max(min, Math.min(max, Math.round(value)));
}

function createErrorResult(message: string): ToolExecutionResult {
  return {
    content: message,
    error: message,
    ok: false,
  };
}
