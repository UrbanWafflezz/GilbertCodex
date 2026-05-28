import type {
  ToolBridgeSchedulerMode,
  ToolCallRequest,
  ToolDefinition,
} from "./types";
import { validateToolArguments } from "./validation";
import type { ToolRegistry } from "./registry";

export interface CoalescedToolBridgeCalls {
  calls: ToolCallRequest[];
  coalescedCount: number;
  fromToolIds: string[];
  requestedCount: number;
  toToolIds: string[];
}

export interface ToolExecutionSegment {
  calls: ToolCallRequest[];
  mode: ToolBridgeSchedulerMode;
}

type EditOperation = "append" | "exact_replace" | "insert_at_line" | "replace_range" | "replace_span";

interface CoalescibleCall {
  args: Record<string, unknown>;
  call: ToolCallRequest;
  index: number;
  toolId: string;
}

interface CoalescibleCandidate {
  item: CoalescibleCall;
  key: string;
}

const READ_SINGLE_TOOL_ID = "files_read";
const READ_BATCH_TOOL_ID = "files_read_many";
const WRITE_SINGLE_TOOL_ID = "files_write";
const WRITE_BATCH_TOOL_ID = "files_write_many";
const EDIT_BATCH_TOOL_ID = "files_edit_many";
const EDIT_SINGLE_TOOL_IDS = new Set([
  "files_append",
  "files_exact_replace",
  "files_insert_at_line",
  "files_replace_range",
  "files_replace_span",
]);

export function coalesceToolBridgeCalls(
  calls: ToolCallRequest[],
  registry: ToolRegistry,
): CoalescedToolBridgeCalls {
  const usedIndexes = new Set<number>();
  const replacementByFirstIndex = new Map<number, ToolCallRequest>();
  const fromToolIds: string[] = [];
  const toToolIds: string[] = [];

  coalesceReadCalls(calls, registry).forEach((group) => {
    recordCoalescedGroup(group, READ_BATCH_TOOL_ID, replacementByFirstIndex, usedIndexes, fromToolIds, toToolIds);
  });
  coalesceWriteCalls(calls, registry).forEach((group) => {
    recordCoalescedGroup(group, WRITE_BATCH_TOOL_ID, replacementByFirstIndex, usedIndexes, fromToolIds, toToolIds);
  });
  coalesceEditCalls(calls, registry).forEach((group) => {
    recordCoalescedGroup(group, EDIT_BATCH_TOOL_ID, replacementByFirstIndex, usedIndexes, fromToolIds, toToolIds);
  });

  const nextCalls = calls.flatMap((call, index) => {
    const replacement = replacementByFirstIndex.get(index);
    if (replacement) {
      return [replacement];
    }
    return usedIndexes.has(index) ? [] : [call];
  });

  return {
    calls: nextCalls,
    coalescedCount: calls.length - nextCalls.length,
    fromToolIds,
    requestedCount: calls.length,
    toToolIds,
  };
}

export function createToolExecutionSegments(
  calls: ToolCallRequest[],
  registry: ToolRegistry,
): ToolExecutionSegment[] {
  const segments: ToolExecutionSegment[] = [];
  let parallelCalls: ToolCallRequest[] = [];

  function flushParallelCalls() {
    if (parallelCalls.length > 0) {
      segments.push({ calls: parallelCalls, mode: "parallel" });
      parallelCalls = [];
    }
  }

  for (const call of calls) {
    const tool = registry.get(call.name);
    const mode = getToolSchedulerMode(tool);

    if (mode === "parallel") {
      parallelCalls.push(call);
      continue;
    }

    flushParallelCalls();
    segments.push({ calls: [call], mode: "exclusive" });
  }

  flushParallelCalls();
  return segments;
}

export function getToolSchedulerMode(tool: ToolDefinition | undefined): ToolBridgeSchedulerMode {
  if (!tool) {
    return "parallel";
  }

  if (tool.scheduler?.mode) {
    return tool.scheduler.mode;
  }

  if (
    tool.permission === "diagnostic" ||
    tool.permission === "read-only" ||
    tool.risk === "diagnostic" ||
    tool.risk === "read" ||
    (tool.risk === "network" && tool.permission === "network")
  ) {
    return "parallel";
  }

  return "exclusive";
}

function recordCoalescedGroup(
  group: CoalescibleCall[],
  targetToolId: string,
  replacementByFirstIndex: Map<number, ToolCallRequest>,
  usedIndexes: Set<number>,
  fromToolIds: string[],
  toToolIds: string[],
) {
  if (group.length < 2) {
    return;
  }

  const first = group[0]!;
  const replacement = createCoalescedCall(group, targetToolId);
  replacementByFirstIndex.set(first.index, replacement);
  toToolIds.push(targetToolId);

  for (const item of group) {
    usedIndexes.add(item.index);
    fromToolIds.push(item.toolId);
  }
}

function coalesceReadCalls(calls: ToolCallRequest[], registry: ToolRegistry) {
  if (!registry.get(READ_BATCH_TOOL_ID)) {
    return [];
  }

  return scanContiguousCoalescibleGroups(calls, registry, (call, index) => {
    const item = createValidatedCoalescibleCall(call, index, registry, (toolId) => toolId === READ_SINGLE_TOOL_ID);
    if (!item) {
      return null;
    }

    const path = stringArg(item.args.path);
    if (!path || item.args.offset !== undefined) {
      return null;
    }

    const maxBytes = optionalNumber(item.args.maxBytes);
    return { item, key: `maxBytes:${maxBytes ?? "full"}` };
  });
}

function coalesceWriteCalls(calls: ToolCallRequest[], registry: ToolRegistry) {
  if (!registry.get(WRITE_BATCH_TOOL_ID)) {
    return [];
  }

  return scanContiguousCoalescibleGroups(calls, registry, (call, index) => {
    const item = createValidatedCoalescibleCall(call, index, registry, (toolId) => toolId === WRITE_SINGLE_TOOL_ID);
    if (!item) {
      return null;
    }

    if (!stringArg(item.args.path) || typeof item.args.content !== "string") {
      return null;
    }

    return { item, key: `dryRun:${item.args.dryRun === true}` };
  });
}

function coalesceEditCalls(calls: ToolCallRequest[], registry: ToolRegistry) {
  if (!registry.get(EDIT_BATCH_TOOL_ID)) {
    return [];
  }

  return scanContiguousCoalescibleGroups(calls, registry, (call, index) => {
    const item = createValidatedCoalescibleCall(call, index, registry, (toolId) => EDIT_SINGLE_TOOL_IDS.has(toolId));
    if (!item) {
      return null;
    }

    if (!toBatchEditItem(item.toolId, item.args)) {
      return null;
    }

    return { item, key: `dryRun:${item.args.dryRun === true}` };
  });
}

function scanContiguousCoalescibleGroups(
  calls: ToolCallRequest[],
  registry: ToolRegistry,
  createCandidate: (call: ToolCallRequest, index: number, registry: ToolRegistry) => CoalescibleCandidate | null,
) {
  const groups: CoalescibleCall[][] = [];
  let currentGroup: CoalescibleCall[] = [];
  let currentKey: string | undefined;

  function flushCurrentGroup() {
    if (currentGroup.length > 1) {
      groups.push(currentGroup);
    }
    currentGroup = [];
    currentKey = undefined;
  }

  calls.forEach((call, index) => {
    const candidate = createCandidate(call, index, registry);
    if (!candidate) {
      flushCurrentGroup();
      return;
    }

    if (currentKey !== undefined && candidate.key !== currentKey) {
      flushCurrentGroup();
    }

    currentKey = candidate.key;
    currentGroup.push(candidate.item);
  });

  flushCurrentGroup();
  return groups;
}

function createValidatedCoalescibleCall(
  call: ToolCallRequest,
  index: number,
  registry: ToolRegistry,
  acceptsToolId: (toolId: string) => boolean,
) {
  if (call.argumentsParseError) {
    return null;
  }

  const tool = registry.get(call.name);
  if (!tool || !acceptsToolId(tool.id)) {
    return null;
  }

  const validation = validateToolArguments(tool, call.arguments);
  if (!validation.ok || !validation.args) {
    return null;
  }

  return { args: validation.args, call, index, toolId: tool.id };
}

function createCoalescedCall(group: CoalescibleCall[], targetToolId: string): ToolCallRequest {
  const first = group[0]!;

  return {
    arguments: createCoalescedArguments(group, targetToolId),
    id: createCoalescedCallId(targetToolId, first.call.id),
    name: targetToolId,
    provider: first.call.provider,
    raw: {
      coalescedCallIds: group.map((item) => item.call.id),
      coalescedFrom: group.map((item) => item.call.raw ?? {
        arguments: item.call.arguments,
        id: item.call.id,
        name: item.call.name,
      }),
    },
  };
}

function createCoalescedArguments(group: CoalescibleCall[], targetToolId: string): Record<string, unknown> {
  if (targetToolId === READ_BATCH_TOOL_ID) {
    const maxBytes = optionalNumber(group[0]?.args.maxBytes);
    return {
      ...(maxBytes === undefined ? {} : { maxBytes }),
      paths: group.map((item) => stringArg(item.args.path)).filter(Boolean),
    };
  }

  if (targetToolId === WRITE_BATCH_TOOL_ID) {
    const dryRun = group[0]?.args.dryRun === true;
    return {
      ...(dryRun ? { dryRun } : {}),
      files: group.map((item) => copyDefinedProperties({
        allowWholeFileReplacement: item.args.allowWholeFileReplacement,
        content: item.args.content,
        createParentDirs: item.args.createParentDirs,
        expectedSha256: item.args.expectedSha256,
        forceEol: item.args.forceEol,
        overwrite: item.args.overwrite,
        path: item.args.path,
      })),
    };
  }

  const dryRun = group[0]?.args.dryRun === true;
  return {
    ...(dryRun ? { dryRun } : {}),
    edits: group.flatMap((item) => {
      const edit = toBatchEditItem(item.toolId, item.args);
      return edit ? [edit] : [];
    }),
  };
}

function toBatchEditItem(toolId: string, args: Record<string, unknown>): Record<string, unknown> | null {
  const path = stringArg(args.path);
  if (!path) {
    return null;
  }

  const base = copyDefinedProperties({
    expectedSha256: args.expectedSha256,
    path,
  });

  if (toolId === "files_exact_replace") {
    const oldText = stringArg(args.oldText);
    if (!oldText || typeof args.newText !== "string") {
      return null;
    }

    return copyDefinedProperties({
      ...base,
      newText: args.newText,
      oldText,
      operation: "exact_replace" satisfies EditOperation,
      replaceAll: args.replaceAll,
    });
  }

  if (toolId === "files_append") {
    if (typeof args.content !== "string" || !args.content) {
      return null;
    }

    return copyDefinedProperties({
      ...base,
      content: args.content,
      ensureNewline: args.ensureNewline,
      operation: "append" satisfies EditOperation,
    });
  }

  if (toolId === "files_insert_at_line") {
    if (typeof args.content !== "string" || typeof args.line !== "number") {
      return null;
    }

    return copyDefinedProperties({
      ...base,
      content: args.content,
      line: args.line,
      operation: "insert_at_line" satisfies EditOperation,
    });
  }

  if (toolId === "files_replace_range") {
    if (typeof args.content !== "string" || typeof args.startLine !== "number" || typeof args.endLine !== "number") {
      return null;
    }

    return copyDefinedProperties({
      ...base,
      content: args.content,
      endLine: args.endLine,
      operation: "replace_range" satisfies EditOperation,
      startLine: args.startLine,
    });
  }

  if (toolId === "files_replace_span") {
    if (typeof args.content !== "string" || typeof args.startLine !== "number" || typeof args.startColumn !== "number" || typeof args.endColumn !== "number") {
      return null;
    }

    return copyDefinedProperties({
      ...base,
      content: args.content,
      endColumn: args.endColumn,
      endLine: args.endLine,
      operation: "replace_span" satisfies EditOperation,
      startColumn: args.startColumn,
      startLine: args.startLine,
    });
  }

  return null;
}

function createCoalescedCallId(targetToolId: string, firstCallId: string) {
  return `${targetToolId}-batch-${firstCallId}`;
}

function stringArg(value: unknown) {
  return typeof value === "string" && value.trim() ? value : "";
}

function optionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function copyDefinedProperties(record: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}
