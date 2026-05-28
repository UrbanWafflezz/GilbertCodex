// Shared adapter helpers for budgeting model-visible tool output while preserving full tool records.

import type { JsonSchema, ToolDefinition, ToolResultMessage } from "../types";
import { finalizeToolResult } from "../resultFinalizer";

const MAX_PROVIDER_TOOL_DESCRIPTION_CHARS = 180;
const MAX_COMPLEX_TOOL_DESCRIPTION_CHARS = 280;
const MAX_PROVIDER_SCHEMA_DESCRIPTION_CHARS = 120;
const DESCRIPTION_RICH_FAMILIES = new Set(["calendar", "github", "gmail", "mcp"]);
const DESCRIPTION_RICH_TOOL_IDS = new Set(["files_edit_many", "files_write_many"]);

export function normalizeRemainingChars(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(Math.floor(value), 0);
}

export function decrementRemainingChars(remaining: number | null, rawLength: number): number | null {
  if (remaining === null) {
    return null;
  }
  return Math.max(remaining - rawLength, 0);
}

export function createInlineToolResultMessage(result: ToolResultMessage, remainingChars: number | null) {
  const finalization = finalizeToolResult({
    arguments: result.arguments,
    maxProviderChars: remainingChars,
    result: result.result,
    toolId: result.name,
  });
  const content = [
    "TOOL RESULT EVIDENCE",
    `Tool: ${result.name}`,
    `Call id: ${result.callId}`,
    `Status: ${result.result.ok ? "complete" : "error"}`,
    `Arguments: ${safeInlineJson(result.arguments ?? {})}`,
    "Output:",
    finalization.providerContent,
  ].join("\n");

  return {
    content,
    providerRawCharCount: finalization.providerRawCharCount,
  };
}

export function appendInlineUserToolResultMessages(
  currentMessages: unknown,
  results: ToolResultMessage[],
  options: { maxToolResultContentChars?: number | null },
) {
  const messages = Array.isArray(currentMessages) ? [...currentMessages] : [];
  let remainingToolResultChars = normalizeRemainingChars(options.maxToolResultContentChars);

  for (const result of results) {
    const inlineResult = createInlineToolResultMessage(result, remainingToolResultChars);
    remainingToolResultChars = decrementRemainingChars(remainingToolResultChars, inlineResult.providerRawCharCount);
    messages.push({
      content: inlineResult.content,
      role: "user",
    });
  }

  return messages;
}

export function createProviderVisibleToolSchema(tool: ToolDefinition) {
  return {
    description: compactDescription(tool.description, maxToolDescriptionChars(tool)),
    inputSchema: compactInputSchemaForProvider(tool),
    name: tool.id,
  };
}

function compactDescription(value: string, maxChars = MAX_PROVIDER_TOOL_DESCRIPTION_CHARS) {
  const compacted = value.replace(/\s+/g, " ").trim();
  return compacted.length > maxChars
    ? `${compacted.slice(0, maxChars - 1).replace(/\s+\S*$/, "").trim()}...`
    : compacted;
}

function compactInputSchemaForProvider(tool: ToolDefinition): JsonSchema {
  if (tool.id === "files_edit_many") {
    return createCompactFilesEditManySchema();
  }

  if (tool.id === "files_write_many") {
    return createCompactFilesWriteManySchema();
  }

  return stripProviderSchemaNoise(tool.inputSchema, {
    preserveDescriptions: shouldPreserveSchemaDescriptions(tool),
  }) as JsonSchema;
}

function stripProviderSchemaNoise(
  value: unknown,
  options: { preserveDescriptions: boolean },
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripProviderSchemaNoise(item, options));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const next: Record<string, unknown> = {};

  for (const [key, nestedValue] of Object.entries(value)) {
    if (key === "description") {
      if (options.preserveDescriptions && typeof nestedValue === "string") {
        next.description = compactDescription(nestedValue, MAX_PROVIDER_SCHEMA_DESCRIPTION_CHARS);
      }
      continue;
    }

    if (key === "title" || key === "$comment" || key === "examples") {
      continue;
    }
    next[key] = stripProviderSchemaNoise(nestedValue, options);
  }

  return next;
}

function shouldPreserveSchemaDescriptions(tool: ToolDefinition) {
  const family = tool.executorMetadata?.family;
  return DESCRIPTION_RICH_TOOL_IDS.has(tool.id) || Boolean(family && DESCRIPTION_RICH_FAMILIES.has(family));
}

function maxToolDescriptionChars(tool: ToolDefinition) {
  return shouldPreserveSchemaDescriptions(tool)
    ? MAX_COMPLEX_TOOL_DESCRIPTION_CHARS
    : MAX_PROVIDER_TOOL_DESCRIPTION_CHARS;
}

function createCompactFilesEditManySchema(): JsonSchema {
  return {
    additionalProperties: false,
    properties: {
      dryRun: { type: "boolean" },
      edits: {
        items: {
          additionalProperties: false,
          properties: {
            content: { description: "Replacement or appended text for this edit.", type: "string" },
            endColumn: { description: "1-based exclusive column for replace_span.", minimum: 1, type: "integer" },
            endLine: { minimum: 1, type: "integer" },
            ensureNewline: { type: "boolean" },
            expectedSha256: { type: "string" },
            line: { minimum: 1, type: "integer" },
            newText: { description: "New text for exact_replace.", type: "string" },
            oldText: { description: "Existing text to replace exactly.", type: "string" },
            operation: { description: "Edit operation to apply to the file.", enum: ["exact_replace", "replace_range", "replace_span", "insert_at_line", "append"], type: "string" },
            path: { description: "Workspace-relative file path.", minLength: 1, type: "string" },
            replaceAll: { type: "boolean" },
            startColumn: { description: "1-based inclusive column for replace_span.", minimum: 1, type: "integer" },
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
  };
}

function createCompactFilesWriteManySchema(): JsonSchema {
  return {
    additionalProperties: false,
    properties: {
      createParentDirs: { type: "boolean" },
      dryRun: { type: "boolean" },
      files: {
        items: {
          additionalProperties: false,
          properties: {
            allowWholeFileReplacement: { type: "boolean" },
            content: { description: "Complete file content to write.", type: "string" },
            createParentDirs: { type: "boolean" },
            expectedSha256: { type: "string" },
            forceEol: { enum: ["lf", "crlf"], type: "string" },
            overwrite: { type: "boolean" },
            path: { description: "Workspace-relative file path.", minLength: 1, type: "string" },
          },
          required: ["path", "content"],
          type: "object",
        },
        minItems: 1,
        type: "array",
      },
      forceEol: { enum: ["lf", "crlf"], type: "string" },
      overwrite: { type: "boolean" },
    },
    required: ["files"],
    type: "object",
  };
}

function safeInlineJson(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return "{}";
  }
}
