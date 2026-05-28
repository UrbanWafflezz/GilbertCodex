import type { ChatToolCall } from "../types/chat";
import { recordPlanUsage } from "../services/planUsageLimiter";
import { resolveToolPermission } from "./permissions";
import { ToolRegistry, createDefaultToolRegistry } from "./registry";
import { createBridgeChatToolCall } from "./results";
import { coalesceToolBridgeCalls, createToolExecutionSegments } from "./scheduler";
import type { ProviderReasoningState } from "../types/reasoning";
import type {
  ToolApprovalCallback,
  ToolBridgeExecutionBatch,
  ToolBridgeExecutionStep,
  ToolBridgeProviderFormat,
  ToolBridgeProviderTurn,
  ToolBridgeToolFamily,
  ToolBridgeTelemetryEvent,
  ToolBridgeTelemetrySink,
  ToolCallRequest,
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolResultMessage,
} from "./types";
import { validateToolArguments } from "./validation";

const DEFAULT_BRIDGE_MAX_CONCURRENCY = 4;
const DEFAULT_BRIDGE_MAX_LOOPS = 4;
const DEFAULT_TOOL_TIMEOUT_MS = 30_000;
const TOOL_PROGRESS_UPDATE_MIN_INTERVAL_MS = 120;
const TOOL_PROGRESS_MAX_CONTENT_CHARS = 8_000;
const TOOL_TIMEOUT_MS_BY_FAMILY: Partial<Record<ToolBridgeToolFamily, number>> = {
  browser: 20_000,
  calendar: 30_000,
  diagnostic: 15_000,
  editing: 30_000,
  files: 30_000,
  git: 45_000,
  github: 30_000,
  gmail: 30_000,
  mcp: 100_000,
  media: 120_000,
  memory: 10_000,
  terminal: 120_000,
  web: 25_000,
  workflow: 30_000,
};
const TOOL_PARALLEL_LIMIT_BY_FAMILY: Partial<Record<ToolBridgeToolFamily, number>> = {
  calendar: 2,
  github: 2,
  gmail: 2,
  mcp: 2,
  web: 1,
};

export interface ExecuteToolBridgeCallsOptions {
  approval?: ToolApprovalCallback;
  calls: ToolCallRequest[];
  context: ToolExecutionContext;
  // Caps concurrent tool executions per batch; use 1 to force sequential execution.
  maxConcurrency?: number;
  onToolCallUpdate?: (toolCall: ChatToolCall) => void;
  registry?: ToolRegistry;
  telemetry?: ToolBridgeTelemetrySink;
  toolTimeoutByFamilyMs?: Partial<Record<ToolBridgeToolFamily, number>>;
  toolTimeoutMs?: number | null;
}

export interface ToolBridgeOrchestratorOptions {
  approval?: ToolApprovalCallback;
  context: ToolExecutionContext;
  maxConcurrency?: number;
  maxLoops?: number;
  onToolCallUpdate?: (toolCall: ChatToolCall) => void;
  // Provider format used to filter tools before advertising them on each turn.
  providerFormat?: ToolBridgeProviderFormat;
  registry?: ToolRegistry;
  send: (request: {
    loopIndex: number;
    toolResultMessages: ToolResultMessage[];
    tools: ToolDefinition[];
  }) => Promise<ToolBridgeProviderTurn>;
  telemetry?: ToolBridgeTelemetrySink;
  toolTimeoutByFamilyMs?: Partial<Record<ToolBridgeToolFamily, number>>;
  toolTimeoutMs?: number | null;
}

export interface ToolBridgeOrchestratorResult {
  abortedBySignal: boolean;
  content: string;
  loopCount: number;
  reasoningState?: ProviderReasoningState;
  resultMessages: ToolResultMessage[];
  steps: ToolBridgeExecutionStep[];
  stoppedAtMaxLoops: boolean;
}

export class ToolBridgeOrchestrator {
  private readonly approval: ToolApprovalCallback | undefined;
  private readonly context: ToolExecutionContext;
  private readonly maxConcurrency: number;
  private readonly maxLoops: number;
  private readonly onToolCallUpdate: ((toolCall: ChatToolCall) => void) | undefined;
  private readonly providerFormat: ToolBridgeProviderFormat | undefined;
  private readonly registry: ToolRegistry;
  private readonly send: ToolBridgeOrchestratorOptions["send"];
  private readonly telemetry: ToolBridgeTelemetrySink | undefined;
  private readonly toolTimeoutByFamilyMs: Partial<Record<ToolBridgeToolFamily, number>> | undefined;
  private readonly toolTimeoutMs: number | null | undefined;

  constructor(options: ToolBridgeOrchestratorOptions) {
    this.approval = options.approval;
    this.context = options.context;
    this.maxConcurrency = Math.max(1, options.maxConcurrency ?? DEFAULT_BRIDGE_MAX_CONCURRENCY);
    this.maxLoops = Math.max(1, options.maxLoops ?? DEFAULT_BRIDGE_MAX_LOOPS);
    this.onToolCallUpdate = options.onToolCallUpdate;
    this.providerFormat = options.providerFormat;
    this.registry = options.registry ?? createDefaultToolRegistry();
    this.send = options.send;
    this.telemetry = options.telemetry;
    this.toolTimeoutByFamilyMs = options.toolTimeoutByFamilyMs;
    this.toolTimeoutMs = options.toolTimeoutMs;
  }

  async run(): Promise<ToolBridgeOrchestratorResult> {
    const resultMessages: ToolResultMessage[] = [];
    const steps: ToolBridgeExecutionStep[] = [];
    let lastContent = "";
    let lastReasoningState: ProviderReasoningState | undefined;

    for (let loopIndex = 0; loopIndex < this.maxLoops; loopIndex += 1) {
      if (this.context.signal?.aborted) {
        emitTelemetry(this.telemetry, { loopIndex, reason: "signal", type: "tool-loop-aborted" });
        return {
          abortedBySignal: true,
          content: lastContent,
          loopCount: loopIndex,
          reasoningState: lastReasoningState,
          resultMessages,
          steps,
          stoppedAtMaxLoops: false,
        };
      }

      const turn = await this.send({
        loopIndex,
        toolResultMessages: resultMessages,
        tools: this.registry.listForContext(this.context, this.providerFormat, {
          includePendingApproval: Boolean(this.approval),
        }),
      });

      if (turn.content) {
        lastContent = turn.content;
      }
      if (turn.reasoningState !== undefined) {
        lastReasoningState = turn.reasoningState;
      }

      if (!turn.toolCalls?.length) {
        return {
          abortedBySignal: false,
          content: turn.content,
          loopCount: loopIndex + 1,
          reasoningState: turn.reasoningState,
          resultMessages,
          steps,
          stoppedAtMaxLoops: false,
        };
      }

      const batch = await executeToolBridgeCalls({
        approval: this.approval,
        calls: turn.toolCalls,
        context: this.context,
        maxConcurrency: this.maxConcurrency,
        onToolCallUpdate: this.onToolCallUpdate,
        registry: this.registry,
        telemetry: this.telemetry,
        toolTimeoutByFamilyMs: this.toolTimeoutByFamilyMs,
        toolTimeoutMs: this.toolTimeoutMs,
      });

      resultMessages.push(...batch.resultMessages);
      steps.push(...batch.steps);

      if (this.context.signal?.aborted) {
        emitTelemetry(this.telemetry, { loopIndex, reason: "signal", type: "tool-loop-aborted" });
        return {
          abortedBySignal: true,
          content: lastContent,
          loopCount: loopIndex + 1,
          reasoningState: lastReasoningState,
          resultMessages,
          steps,
          stoppedAtMaxLoops: false,
        };
      }
    }

    emitTelemetry(this.telemetry, { loopIndex: this.maxLoops, reason: "max-loops", type: "tool-loop-aborted" });
    return {
      abortedBySignal: false,
      content: lastContent,
      loopCount: this.maxLoops,
      reasoningState: lastReasoningState,
      resultMessages,
      steps,
      stoppedAtMaxLoops: true,
    };
  }
}

export async function executeToolBridgeCalls(
  options: ExecuteToolBridgeCallsOptions,
): Promise<ToolBridgeExecutionBatch> {
  const registry = options.registry ?? createDefaultToolRegistry();
  const maxConcurrency = Math.max(1, options.maxConcurrency ?? DEFAULT_BRIDGE_MAX_CONCURRENCY);
  const requestedCalls = options.calls;
  const total = requestedCalls.length;

  // Skip duplicate call IDs so one provider call cannot execute twice or collide in result replay.
  const seen = new Map<string, number>();
  const uniqueCalls: ToolCallRequest[] = [];
  const originalPositionByCallId = new Map<string, number>();
  const prefilledSteps: Array<{ position: number; step: ToolBridgeExecutionStep }> = [];

  requestedCalls.forEach((call, position) => {
    const count = seen.get(call.id) ?? 0;
    seen.set(call.id, count + 1);

    if (count > 0) {
      emitTelemetry(options.telemetry, { callId: call.id, toolName: call.name, type: "tool-call-duplicate" });
      const duplicateStep = makeDuplicateStep(call);
      prefilledSteps.push({ position, step: duplicateStep });
      notifyToolUpdate(options.onToolCallUpdate, duplicateStep.chatToolCall);
      return;
    }

    uniqueCalls.push(call);
    originalPositionByCallId.set(call.id, position);
  });

  const repairedCalls = uniqueCalls.map((call) => repairRecoverableToolCall(call, registry));
  const coalesced = coalesceToolBridgeCalls(repairedCalls, registry);

  if (coalesced.coalescedCount > 0) {
    emitTelemetry(options.telemetry, {
      coalescedCount: coalesced.coalescedCount,
      fromToolIds: coalesced.fromToolIds,
      requestedCount: coalesced.requestedCount,
      toToolIds: coalesced.toToolIds,
      type: "tool-batch-coalesced",
    });
  }

  const segments = createToolExecutionSegments(coalesced.calls, registry);
  emitTelemetry(options.telemetry, {
    exclusiveCount: segments.filter((segment) => segment.mode === "exclusive").reduce((count, segment) => count + segment.calls.length, 0),
    parallelCount: segments.filter((segment) => segment.mode === "parallel").reduce((count, segment) => count + segment.calls.length, 0),
    segmentCount: segments.length,
    type: "tool-batch-scheduled",
  });

  const executedSteps: Array<{ position: number; step: ToolBridgeExecutionStep }> = [];

  async function executeCall(call: ToolCallRequest): Promise<{ position: number; step: ToolBridgeExecutionStep }> {
    return {
      position: getOriginalCallPosition(call, originalPositionByCallId, total),
      step: await executeSingleToolCall(
        call,
        registry,
        options.context,
        options.onToolCallUpdate,
        options.approval,
        options.telemetry,
        options.toolTimeoutMs,
        options.toolTimeoutByFamilyMs,
      ),
    };
  }

  for (const segment of segments) {
    if (segment.mode === "exclusive") {
      for (const call of segment.calls) {
        executedSteps.push(await executeCall(call));
      }
      continue;
    }

    executedSteps.push(...await executeParallelSegmentCalls(segment.calls, registry, maxConcurrency, executeCall));
  }

  const orderedSteps = [...prefilledSteps, ...executedSteps]
    .sort((left, right) => left.position - right.position)
    .map((entry) => entry.step);

  return {
    coalescedCount: coalesced.coalescedCount,
    executedCount: orderedSteps.filter((step) => step.result.ok).length,
    handledCount: orderedSteps.length,
    hostExecutionCount: coalesced.calls.length,
    requestedCount: total,
    resultMessages: orderedSteps.map((step) => step.resultMessage),
    steps: orderedSteps,
    toolCalls: orderedSteps.map((step) => step.chatToolCall),
  };
}

function repairRecoverableToolCall(call: ToolCallRequest, registry: ToolRegistry): ToolCallRequest {
  if (call.argumentsParseError) {
    return call;
  }

  const tool = registry.get(call.name);
  if (!tool || (tool.id !== "files_read" && tool.id !== "files_read_many" && tool.id !== "files_read_range")) {
    return call;
  }

  if (hasPathLikeArgument(call.arguments) || !registry.get("files_tree_summary")) {
    return call;
  }

  return {
    ...call,
    arguments: { maxDepth: 3 },
    name: "files_tree_summary",
    raw: {
      repairedFrom: {
        arguments: call.arguments,
        name: call.name,
      },
      reason: "missing_file_read_path",
      raw: call.raw,
    },
  };
}

function hasPathLikeArgument(args: unknown) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return false;
  }

  const record = args as Record<string, unknown>;
  const pathKeys = [
    "path",
    "file",
    "filePath",
    "filepath",
    "file_path",
    "filePaths",
    "file_paths",
    "relativePath",
    "relative_path",
    "targetPath",
    "target_path",
  ];

  if (pathKeys.some((key) => typeof record[key] === "string" && record[key].trim().length > 0)) {
    return true;
  }

  if (typeof record.paths === "string" && record.paths.trim().length > 0) {
    return true;
  }

  if (Array.isArray(record.paths) && record.paths.some((path) => typeof path === "string" && path.trim().length > 0)) {
    return true;
  }

  return Array.isArray(record.files) && record.files.some((path) => typeof path === "string" && path.trim().length > 0);
}

function getOriginalCallPosition(call: ToolCallRequest, originalPositionByCallId: Map<string, number>, fallbackPosition: number) {
  const directPosition = originalPositionByCallId.get(call.id);
  if (directPosition !== undefined) {
    return directPosition;
  }

  const raw = call.raw;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return fallbackPosition;
  }

  const coalescedCallIds = (raw as { coalescedCallIds?: unknown }).coalescedCallIds;
  if (!Array.isArray(coalescedCallIds)) {
    return fallbackPosition;
  }

  for (const callId of coalescedCallIds) {
    if (typeof callId !== "string") {
      continue;
    }

    const position = originalPositionByCallId.get(callId);
    if (position !== undefined) {
      return position;
    }
  }

  return fallbackPosition;
}

async function executeParallelSegmentCalls(
  calls: ToolCallRequest[],
  registry: ToolRegistry,
  maxConcurrency: number,
  executeCall: (call: ToolCallRequest) => Promise<{ position: number; step: ToolBridgeExecutionStep }>,
) {
  if (calls.length === 0) {
    return [];
  }

  const results = new Array<{ position: number; step: ToolBridgeExecutionStep }>(calls.length);
  const pendingIndexes = calls.map((_call, index) => index);
  const activeByFamily = new Map<ToolBridgeToolFamily, number>();
  let activeCount = 0;
  let completedCount = 0;

  return new Promise<Array<{ position: number; step: ToolBridgeExecutionStep }>>((resolve, reject) => {
    const schedule = () => {
      while (activeCount < maxConcurrency && pendingIndexes.length > 0) {
        const pendingOffset = pendingIndexes.findIndex((index) => canStartParallelCall(calls[index]!, registry, activeByFamily));
        if (pendingOffset === -1) {
          break;
        }

        const index = pendingIndexes.splice(pendingOffset, 1)[0]!;
        const call = calls[index]!;
        const family = registry.get(call.name)?.executorMetadata?.family;
        activeCount += 1;
        if (family) {
          activeByFamily.set(family, (activeByFamily.get(family) ?? 0) + 1);
        }

        executeCall(call)
          .then((result) => {
            results[index] = result;
          })
          .then(() => {
            activeCount -= 1;
            if (family) {
              const nextCount = (activeByFamily.get(family) ?? 1) - 1;
              if (nextCount > 0) {
                activeByFamily.set(family, nextCount);
              } else {
                activeByFamily.delete(family);
              }
            }

            completedCount += 1;
            if (completedCount === calls.length) {
              resolve(results.filter((entry): entry is { position: number; step: ToolBridgeExecutionStep } => Boolean(entry)));
              return;
            }

            schedule();
          })
          .catch(reject);
      }
    };

    schedule();
  });
}

function canStartParallelCall(
  call: ToolCallRequest,
  registry: ToolRegistry,
  activeByFamily: Map<ToolBridgeToolFamily, number>,
) {
  const family = registry.get(call.name)?.executorMetadata?.family;
  if (!family) {
    return true;
  }

  const familyLimit = TOOL_PARALLEL_LIMIT_BY_FAMILY[family];
  return familyLimit === undefined || (activeByFamily.get(family) ?? 0) < familyLimit;
}

function makeDuplicateStep(call: ToolCallRequest): ToolBridgeExecutionStep {
  const reason = `Duplicate tool call id "${call.id}"; only the first instance was executed.`;
  const result: ToolExecutionResult = { content: reason, ok: false, skippedReason: reason };
  const chatToolCall = createBridgeChatToolCall(call, undefined, result, "skipped");

  return {
    call,
    chatToolCall,
    result,
    resultMessage: {
      arguments: call.arguments,
      callId: call.id,
      name: call.name,
      rawCall: call.raw,
      result,
    },
  };
}

async function executeSingleToolCall(
  call: ToolCallRequest,
  registry: ToolRegistry,
  context: ToolExecutionContext,
  onToolCallUpdate: ((toolCall: ChatToolCall) => void) | undefined,
  approval: ToolApprovalCallback | undefined,
  telemetry: ToolBridgeTelemetrySink | undefined,
  toolTimeoutMs: number | null | undefined,
  toolTimeoutByFamilyMs: Partial<Record<ToolBridgeToolFamily, number>> | undefined,
): Promise<ToolBridgeExecutionStep> {
  const tool = registry.get(call.name);
  const activeResult: ToolExecutionResult = {
    content: "Tool bridge call started.",
    ok: true,
  };
  const activeToolCall = createBridgeChatToolCall(call, tool, activeResult, "active");
  notifyToolUpdate(onToolCallUpdate, activeToolCall);

  if (!tool) {
    const reason = `No bridge tool is registered as ${call.name}.`;
    emitTelemetry(telemetry, { callId: call.id, reason, toolId: call.name, type: "tool-skipped" });
    const result = createSkippedResult(reason);
    const chatToolCall = createBridgeChatToolCall(call, undefined, result, "skipped");
    notifyToolUpdate(onToolCallUpdate, chatToolCall);
    return buildStep(call, chatToolCall, result);
  }

  if (context.signal?.aborted) {
    const reason = createToolRunCanceledMessage("before-start");
    emitTelemetry(telemetry, { callId: call.id, reason, toolId: tool.id, type: "tool-skipped" });
    const result = createSkippedResult(reason);
    const chatToolCall = createBridgeChatToolCall(call, tool, result, "skipped");
    notifyToolUpdate(onToolCallUpdate, chatToolCall);
    return buildStep(call, chatToolCall, result);
  }

  const result = await executeResolvedToolCall(tool, call, context, approval, onToolCallUpdate, telemetry, toolTimeoutMs, toolTimeoutByFamilyMs);
  const status: ChatToolCall["status"] = result.skippedReason ? "skipped" : result.ok ? "complete" : "error";
  const chatToolCall = createBridgeChatToolCall(call, tool, result, status);
  notifyToolUpdate(onToolCallUpdate, chatToolCall);

  return buildStep(call, chatToolCall, result);
}

async function executeResolvedToolCall(
  tool: ToolDefinition,
  call: ToolCallRequest,
  context: ToolExecutionContext,
  approval: ToolApprovalCallback | undefined,
  onToolCallUpdate: ((toolCall: ChatToolCall) => void) | undefined,
  telemetry: ToolBridgeTelemetrySink | undefined,
  toolTimeoutMs: number | null | undefined,
  toolTimeoutByFamilyMs: Partial<Record<ToolBridgeToolFamily, number>> | undefined,
): Promise<ToolExecutionResult> {
  if (call.argumentsParseError) {
    const errorMessage = createToolArgumentParseRecoveryMessage(tool, call.argumentsParseError);
    emitTelemetry(telemetry, { callId: call.id, error: errorMessage, toolId: tool.id, type: "tool-validation-failed" });
    return {
      content: errorMessage,
      error: errorMessage,
      ok: false,
    };
  }

  const validation = validateToolArguments(tool, call.arguments);

  if (!validation.ok || !validation.args) {
    const errorMessage = validation.error || "Invalid tool arguments.";
    emitTelemetry(telemetry, { callId: call.id, error: errorMessage, toolId: tool.id, type: "tool-validation-failed" });
    return {
      content: errorMessage,
      error: errorMessage,
      ok: false,
    };
  }

  const permission = resolveToolPermission(tool, context);

  if (!permission.allowed) {
    if (!permission.requiresApproval || !approval) {
      emitTelemetry(telemetry, {
        callId: call.id,
        reason: permission.reason ?? `Tool ${tool.id} requires approval.`,
        toolId: tool.id,
        type: "tool-skipped",
      });
      return createSkippedResult(permission.reason || `Tool ${tool.id} requires approval.`);
    }

    emitTelemetry(telemetry, { callId: call.id, reason: permission.reason, toolId: tool.id, type: "tool-approval-requested" });
    notifyToolUpdate(
      onToolCallUpdate,
      createBridgeChatToolCall(
        call,
        tool,
        { content: permission.reason ?? "Awaiting approval.", ok: true },
        "waiting_approval",
      ),
    );

    let decision;
    try {
      decision = await approval({ call, reason: permission.reason, tool });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Approval callback failed.";
      emitTelemetry(telemetry, { approved: false, callId: call.id, reason: message, toolId: tool.id, type: "tool-approval-resolved" });
      return createSkippedResult(message);
    }

    emitTelemetry(telemetry, {
      approved: decision.approved,
      callId: call.id,
      reason: decision.reason,
      toolId: tool.id,
      type: "tool-approval-resolved",
    });

    if (!decision.approved) {
      return createSkippedResult(decision.reason || permission.reason || "Approval denied.");
    }
  }

  if (context.signal?.aborted) {
    const reason = createToolRunCanceledMessage("before-start");
    emitTelemetry(telemetry, { callId: call.id, reason, toolId: tool.id, type: "tool-skipped" });
    return createSkippedResult(reason);
  }

  const startedAt = nowMs();
  const progressEmitter = createToolProgressEmitter(context, onToolCallUpdate, call, tool);
  try {
    recordPlanUsage(context.billingPlan, "toolRuns", 1, context.provider);
    const progressContext: ToolExecutionContext = {
      ...context,
      reportProgress: progressEmitter.report,
    };
    const timeoutMs = resolveToolTimeoutMs(tool, toolTimeoutMs, toolTimeoutByFamilyMs);
    const result = await runToolWithTimeout(tool, validation.args, progressContext, timeoutMs);
    progressEmitter.flush();
    if (isToolRunCanceledResult(result, context)) {
      const reason = createToolRunCanceledMessage("during-run");
      emitTelemetry(telemetry, { callId: call.id, reason, toolId: tool.id, type: "tool-skipped" });
      return createSkippedResult(reason);
    }
    emitTelemetry(telemetry, {
      callId: call.id,
      durationMs: nowMs() - startedAt,
      error: result.error,
      family: tool.executorMetadata?.family,
      ok: result.ok,
      toolId: tool.id,
      type: "tool-invoked",
      version: tool.executorMetadata?.version,
    });
    return result;
  } catch (error) {
    progressEmitter.flush();
    const message = error instanceof Error ? error.message : "Tool execution failed.";
    if (isToolExecutionAbortedError(error)) {
      const reason = createToolRunCanceledMessage("during-run");
      emitTelemetry(telemetry, { callId: call.id, reason, toolId: tool.id, type: "tool-skipped" });
      return createSkippedResult(reason);
    }

    emitTelemetry(telemetry, {
      callId: call.id,
      durationMs: nowMs() - startedAt,
      error: message,
      family: tool.executorMetadata?.family,
      ok: false,
      toolId: tool.id,
      type: "tool-invoked",
      version: tool.executorMetadata?.version,
    });
    return {
      content: message,
      error: message,
      ok: false,
    };
  } finally {
    progressEmitter.close();
  }
}

function createToolProgressEmitter(
  context: ToolExecutionContext,
  onToolCallUpdate: ((toolCall: ChatToolCall) => void) | undefined,
  call: ToolCallRequest,
  tool: ToolDefinition,
) {
  let closed = false;
  let lastEmittedAt = 0;
  let pendingProgress: ToolExecutionResult | null = null;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;

  function clearPendingTimer() {
    if (pendingTimer === null) {
      return;
    }

    clearTimeout(pendingTimer);
    pendingTimer = null;
  }

  function emit(progressResult: ToolExecutionResult) {
    if (closed) {
      return;
    }

    const visibleProgressResult = limitToolProgressResultForUi(progressResult);
    pendingProgress = null;
    lastEmittedAt = nowMs();
    try {
      context.reportProgress?.(visibleProgressResult);
    } catch {
      // Progress observers must not break the actual tool run.
    }
    notifyToolUpdate(
      onToolCallUpdate,
      createBridgeChatToolCall(call, tool, visibleProgressResult, "active"),
    );
  }

  function schedulePending(delayMs: number) {
    if (pendingTimer !== null) {
      return;
    }

    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      const progressResult = pendingProgress;
      if (!progressResult) {
        return;
      }

      emit(progressResult);
    }, Math.max(0, delayMs));
  }

  return {
    close() {
      closed = true;
      clearPendingTimer();
      pendingProgress = null;
    },
    flush() {
      if (closed || !pendingProgress) {
        return;
      }

      clearPendingTimer();
      emit(pendingProgress);
    },
    report(progressResult: ToolExecutionResult) {
      if (closed) {
        return;
      }

      const elapsedMs = nowMs() - lastEmittedAt;
      if (lastEmittedAt === 0 || elapsedMs >= TOOL_PROGRESS_UPDATE_MIN_INTERVAL_MS) {
        clearPendingTimer();
        emit(progressResult);
        return;
      }

      pendingProgress = progressResult;
      schedulePending(TOOL_PROGRESS_UPDATE_MIN_INTERVAL_MS - elapsedMs);
    },
  };
}

function limitToolProgressResultForUi(result: ToolExecutionResult): ToolExecutionResult {
  const content = limitToolProgressContent(result.content);
  const error = result.error ? limitToolProgressContent(result.error) : undefined;

  if (content === result.content && error === result.error) {
    return result;
  }

  return {
    ...result,
    content,
    error,
  };
}

function limitToolProgressContent(value: string): string {
  if (value.length <= TOOL_PROGRESS_MAX_CONTENT_CHARS) {
    return value;
  }

  return `${value.slice(0, TOOL_PROGRESS_MAX_CONTENT_CHARS).trimEnd()}\n\n[Tool progress truncated for UI performance.]`;
}

class ToolExecutionTimeoutError extends Error {
  constructor(toolId: string, timeoutMs: number) {
    super(`Tool ${toolId} timed out after ${timeoutMs.toLocaleString("en-US")}ms.`);
    this.name = "ToolExecutionTimeoutError";
  }
}

class ToolExecutionAbortedError extends Error {
  constructor(toolId: string) {
    super(`Tool ${toolId} stopped because the tool bridge run was aborted.`);
    this.name = "ToolExecutionAbortedError";
  }
}

function isToolExecutionAbortedError(error: unknown) {
  return error instanceof ToolExecutionAbortedError
    || (error instanceof Error && error.name === "ToolExecutionAbortedError");
}

function createToolRunCanceledMessage(phase: "before-start" | "during-run") {
  return phase === "before-start"
    ? "Tool run was canceled before it could start."
    : "Tool run was canceled before it finished.";
}

function isToolRunCanceledResult(result: ToolExecutionResult, context: ToolExecutionContext) {
  if (!context.signal?.aborted || result.ok) {
    return false;
  }

  const text = `${result.error ?? ""}\n${result.skippedReason ?? ""}\n${result.content ?? ""}`;
  return /\btool bridge run (?:was )?aborted\b|\baborted before\b|\boperation was aborted\b/i.test(text);
}

async function runToolWithTimeout(
  tool: ToolDefinition,
  args: Record<string, unknown>,
  context: ToolExecutionContext,
  timeoutMs: number | null,
): Promise<ToolExecutionResult> {
  if (context.signal?.aborted) {
    throw new ToolExecutionAbortedError(tool.id);
  }

  const execution = Promise.resolve().then(() => tool.execute(args, context));

  if (timeoutMs === null) {
    return execution;
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let abortHandler: (() => void) | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new ToolExecutionTimeoutError(tool.id, timeoutMs)), timeoutMs);
  });

  const abort = new Promise<never>((_, reject) => {
    if (!context.signal) {
      return;
    }

    abortHandler = () => reject(new ToolExecutionAbortedError(tool.id));
    context.signal.addEventListener("abort", abortHandler, { once: true });
  });

  try {
    return await Promise.race([execution, timeout, abort]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
    if (abortHandler && context.signal) {
      context.signal.removeEventListener("abort", abortHandler);
    }
  }
}

function resolveToolTimeoutMs(
  tool: ToolDefinition,
  globalTimeoutMs: number | null | undefined,
  byFamilyMs: Partial<Record<ToolBridgeToolFamily, number>> | undefined,
) {
  if (globalTimeoutMs !== undefined) {
    return normalizeToolTimeoutMs(globalTimeoutMs);
  }

  const family = tool.executorMetadata?.family;
  if (family && byFamilyMs?.[family] !== undefined) {
    return normalizeToolTimeoutMs(byFamilyMs[family]);
  }

  if (tool.timeoutMs !== undefined) {
    return normalizeToolTimeoutMs(tool.timeoutMs);
  }

  if (family && TOOL_TIMEOUT_MS_BY_FAMILY[family] !== undefined) {
    return normalizeToolTimeoutMs(TOOL_TIMEOUT_MS_BY_FAMILY[family]);
  }

  return DEFAULT_TOOL_TIMEOUT_MS;
}

function normalizeToolTimeoutMs(value: number | null | undefined) {
  if (value === null) {
    return null;
  }

  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_TOOL_TIMEOUT_MS;
  }

  return Math.max(1, Math.floor(value));
}

function buildStep(call: ToolCallRequest, chatToolCall: ChatToolCall, result: ToolExecutionResult): ToolBridgeExecutionStep {
  return {
    call,
    chatToolCall,
    result,
    resultMessage: {
      arguments: call.arguments,
      callId: call.id,
      name: call.name,
      rawCall: call.raw,
      result,
    },
  };
}

function createSkippedResult(reason: string): ToolExecutionResult {
  return {
    content: reason,
    ok: false,
    skippedReason: reason,
  };
}

function createToolArgumentParseRecoveryMessage(tool: ToolDefinition, parseError: string) {
  const editHint = tool.id.startsWith("files_")
    ? "No file was changed. Retry the same operation with a valid JSON object. For large text content, keep it inside one JSON string and escape every newline as \\n, quote as \\\", and backslash as \\\\."
    : "Retry the same tool with a valid JSON object for its arguments.";

  return [
    `Tool ${tool.id} received invalid JSON arguments.`,
    parseError,
    editHint,
  ].join("\n");
}

function notifyToolUpdate(callback: ((toolCall: ChatToolCall) => void) | undefined, toolCall: ChatToolCall) {
  if (!callback) {
    return;
  }
  // A throwing UI handler must not break tool execution.
  try {
    callback(toolCall);
  } catch {
    // Intentionally swallow; tool execution must continue.
  }
}

function emitTelemetry(sink: ToolBridgeTelemetrySink | undefined, event: ToolBridgeTelemetryEvent) {
  if (!sink) {
    return;
  }
  // Telemetry must never break execution.
  try {
    sink(event);
  } catch {
    // Intentionally swallow.
  }
}

function nowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}
