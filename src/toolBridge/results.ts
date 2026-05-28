import type { ChatToolCall } from "../types/chat";
import type { TerminalShellId } from "../types/terminal";
import type { JsonValue, ToolCallRequest, ToolDefinition, ToolExecutionResult } from "./types";
import { createToolResultContent, finalizeToolResult, limitToolResultContentForProvider } from "./resultFinalizer";

// Prefix applied to synthesized ChatToolCall IDs so downstream consumers can correlate bridge calls.
export const BRIDGE_TOOL_CALL_ID_PREFIX = "bridge-";

export interface ToolResultContentFormatOptions {
  maxChars?: number | null;
}

export function formatToolResultContent(result: ToolExecutionResult, options: ToolResultContentFormatOptions = {}) {
  const content = createToolResultContent(result);

  return limitToolResultContentForProvider(content, options.maxChars);
}

export function createBridgeChatToolCall(
  call: ToolCallRequest,
  tool: ToolDefinition | undefined,
  result: ToolExecutionResult,
  status: ChatToolCall["status"],
): ChatToolCall {
  const toolId = tool?.id ?? call.name;
  const finalization = finalizeToolResult({
    arguments: call.arguments,
    label: tool?.title ?? call.name,
    result,
    toolId,
  });

  return {
    batchFileResults: extractBatchFileResults(result),
    batchSummary: extractBatchSummary(result, toolId),
    detail: result.error || result.skippedReason || undefined,
    fileChanges: extractFileChanges(result),
    id: `${BRIDGE_TOOL_CALL_ID_PREFIX}${call.id}`,
    input: safeStringify(call.arguments ?? {}),
    label: tool?.title ?? call.name,
    output: result.ok
      ? finalization.toolRecordContent
      : result.error ?? result.skippedReason ?? finalization.toolRecordContent,
    resultPolicy: finalization.visiblePolicy,
    status,
    terminal: extractTerminalMetadata(result),
    toolId,
  };
}

function extractTerminalMetadata(result: ToolExecutionResult): ChatToolCall["terminal"] {
  const data = result.data;

  if (!data || typeof data !== "object" || Array.isArray(data) || !("terminal" in data)) {
    return undefined;
  }

  const terminal = (data as { terminal?: unknown }).terminal;

  if (!terminal || typeof terminal !== "object" || Array.isArray(terminal)) {
    return undefined;
  }

  const record = terminal as Record<string, unknown>;
  return {
    command: typeof record.command === "string" ? record.command : undefined,
    exitCode: typeof record.exitCode === "number" || record.exitCode === null ? record.exitCode : undefined,
    live: record.live === true ? true : record.live === false ? false : undefined,
    outputTruncated: record.outputTruncated === true ? true : record.outputTruncated === false ? false : undefined,
    sessionId: typeof record.sessionId === "string" ? record.sessionId : undefined,
    shell: normalizeTerminalShell(record.shell),
    timedOut: record.timedOut === true ? true : record.timedOut === false ? false : undefined,
    workingDirectory: typeof record.workingDirectory === "string" ? record.workingDirectory : undefined,
  };
}

function normalizeTerminalShell(value: unknown): TerminalShellId | undefined {
  return value === "powershell" || value === "cmd" || value === "bash" || value === "zsh" || value === "sh"
    ? value
    : undefined;
}

function extractFileChanges(result: ToolExecutionResult): ChatToolCall["fileChanges"] {
  const data = result.data;

  if (!data || typeof data !== "object" || Array.isArray(data) || !("fileChanges" in data)) {
    return undefined;
  }

  const fileChanges = (data as { fileChanges?: unknown }).fileChanges;

  if (!Array.isArray(fileChanges)) {
    return undefined;
  }

  return fileChanges.flatMap(normalizeFileChange);
}

function extractBatchSummary(result: ToolExecutionResult, toolId: string): ChatToolCall["batchSummary"] {
  const operation = getBatchOperation(toolId);
  const data = getResultDataRecord(result);

  if (!operation || !data) {
    return undefined;
  }

  const explicitSummary = extractExplicitBatchSummary(data, operation);
  if (explicitSummary) {
    return explicitSummary;
  }

  if (!Array.isArray(data.files)) {
    return undefined;
  }

  const fileResults = extractBatchFileResults(result) ?? [];
  const fileCount = fileResults.length;

  if (fileCount === 0) {
    return undefined;
  }

  return {
    failureCount: fileResults.filter((item) => item.status === "error").length,
    fileCount,
    operation,
    requestedCount: fileCount,
    skippedCount: fileResults.filter((item) => item.status === "skipped").length,
    successCount: fileResults.filter((item) => item.status === "ok").length,
  };
}

function extractExplicitBatchSummary(
  data: Record<string, unknown>,
  fallbackOperation: NonNullable<ChatToolCall["batchSummary"]>["operation"],
): ChatToolCall["batchSummary"] {
  const value = data.batchSummary;

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const operation = record.operation === "write" || record.operation === "edit" ? record.operation : fallbackOperation;
  const fileCount = countValue(record.fileCount);

  if (fileCount <= 0) {
    return undefined;
  }

  return {
    failureCount: countValue(record.failureCount),
    fileCount,
    operation,
    requestedCount: countValue(record.requestedCount) || fileCount,
    skippedCount: countValue(record.skippedCount),
    successCount: countValue(record.successCount),
  };
}

function extractBatchFileResults(result: ToolExecutionResult): ChatToolCall["batchFileResults"] {
  const data = getResultDataRecord(result);

  if (!data || !Array.isArray(data.files)) {
    return undefined;
  }

  const results = data.files.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }

    const record = item as Record<string, unknown>;
    const fileChanges = Array.isArray(record.fileChanges) ? record.fileChanges.flatMap(normalizeFileChange) : [];
    const firstChange = fileChanges[0];
    const path = stringValue(record.path) || firstChange?.path || stringValue(record.requestedPath);

    if (!path) {
      return [];
    }

    return [{
      additions: firstChange?.additions ?? 0,
      deletions: firstChange?.deletions ?? 0,
      detail: stringValue(record.error) || stringValue(record.skippedReason) || undefined,
      kind: firstChange?.kind,
      path,
      requestedPath: stringValue(record.requestedPath) || undefined,
      status: record.skipped === true ? "skipped" as const : record.ok === false ? "error" as const : "ok" as const,
    }];
  });

  return results.length > 0 ? results : undefined;
}

function normalizeFileChange(change: unknown): NonNullable<ChatToolCall["fileChanges"]> {
  if (!change || typeof change !== "object" || Array.isArray(change)) {
    return [];
  }

  const record = change as Record<string, unknown>;
  const path = typeof record.path === "string" ? record.path : "";
  const additions = typeof record.additions === "number" ? record.additions : 0;
  const deletions = typeof record.deletions === "number" ? record.deletions : 0;

  if (!path) {
    return [];
  }

  return [{
    additions,
    deletions,
    diffPreview: normalizeDiffPreview(record.diffPreview),
    diffTruncated: record.diffTruncated === true,
    kind: normalizeFileChangeKind(record.kind),
    path,
  }];
}

function getResultDataRecord(result: ToolExecutionResult): Record<string, unknown> | undefined {
  const data = result.data;
  return data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : undefined;
}

function getBatchOperation(toolId: string): NonNullable<ChatToolCall["batchSummary"]>["operation"] | undefined {
  if (toolId === "files_write_many") {
    return "write";
  }

  if (toolId === "files_edit_many") {
    return "edit";
  }

  return undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function countValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function normalizeDiffPreview(value: unknown): NonNullable<ChatToolCall["fileChanges"]>[number]["diffPreview"] {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.flatMap((line) => {
    if (!line || typeof line !== "object" || Array.isArray(line)) {
      return [];
    }

    const record = line as Record<string, unknown>;
    const content = typeof record.content === "string" ? record.content : "";
    const kind = record.kind === "add" || record.kind === "context" || record.kind === "hunk" || record.kind === "meta" || record.kind === "remove"
      ? record.kind
      : undefined;

    if (!kind) {
      return [];
    }

    return [{
      content,
      kind,
      newLine: typeof record.newLine === "number" ? record.newLine : undefined,
      oldLine: typeof record.oldLine === "number" ? record.oldLine : undefined,
    }];
  });
}

function normalizeFileChangeKind(value: unknown): NonNullable<ChatToolCall["fileChanges"]>[number]["kind"] {
  return value === "create" || value === "delete" || value === "move" || value === "update" ? value : undefined;
}

// JSON.stringify wrapper that replaces circular references and falls back to String(value).
export function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  try {
    return JSON.stringify(value, (_key, current: unknown) => {
      if (typeof current === "bigint") {
        return current.toString();
      }

      if (current !== null && typeof current === "object") {
        if (seen.has(current as object)) {
          return "[Circular]";
        }
        seen.add(current as object);
      }

      return current as JsonValue;
    }) ?? "";
  } catch {
    try {
      return String(value);
    } catch {
      return "";
    }
  }
}
