param(
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$toolBridgeRoot = Join-Path $repoRoot "src\toolBridge"
$indexPath = Join-Path $toolBridgeRoot "index.ts"
$markerPath = Join-Path $toolBridgeRoot ".public-shim"
$parsersPath = Join-Path $toolBridgeRoot "parsers.ts"
$markerVersion = "gilbert-codex-public-toolbridge-shim-v2"
$legacyMarkerVersion = "gilbert-codex-public-toolbridge-shim-v1"

function Test-LegacyPublicShim {
  if (-not (Test-Path $indexPath) -or -not (Test-Path $parsersPath)) {
    return $false
  }

  $index = Get-Content -LiteralPath $indexPath -Raw
  $parsers = Get-Content -LiteralPath $parsersPath -Raw
  $hasLegacyParserStubs = (
    $parsers -match 'export function parseAnthropicToolCalls\([^)]*\)[^{]*\{\s*return \[\];\s*\}' -and
    $parsers -match 'export function parseResponsesToolCalls\([^)]*\)[^{]*\{\s*return \[\];\s*\}'
  )
  $hasLegacyIndexStub = (
    $index -match 'Provider tool bridge is not bundled in this public build\.' -and
    $index -match 'export function selectAdvertisedBridgeTools\([^)]*\)[^{]*\{\s*return \[\] as ToolDefinition\[\];\s*\}'
  )
  return ($hasLegacyParserStubs -and $hasLegacyIndexStub)
}

function Test-ManagedPublicShim {
  if (-not (Test-Path $markerPath)) {
    return $false
  }

  try {
    $markerContent = Get-Content -LiteralPath $markerPath -Raw
    if ($markerContent.Trim() -eq $legacyMarkerVersion) {
      return $true
    }

    $marker = $markerContent | ConvertFrom-Json
    if ($marker.version -ne $markerVersion -or $null -eq $marker.files) {
      return Test-LegacyPublicShim
    }

    foreach ($file in $marker.files) {
      $target = Join-Path $toolBridgeRoot $file.path
      if (-not (Test-Path $target)) {
        return $false
      }
      $hash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($hash -ne $file.sha256) {
        return $false
      }
    }
    return $true
  } catch {
    return $false
  }
}

$isPublicShim = Test-ManagedPublicShim
if (-not $isPublicShim) {
  $isPublicShim = Test-LegacyPublicShim
}

if ((Test-Path $indexPath) -and -not $Force -and -not $isPublicShim) {
  Write-Host "Existing local tool bridge found; public shim not needed."
  exit 0
}

New-Item -ItemType Directory -Force -Path $toolBridgeRoot | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $toolBridgeRoot "adapters") | Out-Null
$shimFiles = @()

function Write-ShimFile {
  param(
    [Parameter(Mandatory = $true)][string]$RelativePath,
    [Parameter(Mandatory = $true)][string]$Content
  )

  $target = Join-Path $toolBridgeRoot $RelativePath
  $targetDir = Split-Path -Parent $target
  New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
  Set-Content -LiteralPath $target -Value $Content -Encoding utf8
  $script:shimFiles += $RelativePath
}

Write-ShimFile "types.ts" @'
import type { ChatToolCall } from "../types/chat";
import type { LocalPermissionMode } from "../types/localWorkspace";
import type { ProviderReasoningState } from "../types/reasoning";
import type { AppAgentEnvironment, ModelProviderId, WebSearchSettings } from "../types/settings";
import type { TerminalShellId } from "../types/terminal";

export type ToolBridgeProviderFormat = "openai-compatible" | "anthropic-messages" | "openai-responses";
export type ToolBridgeRisk = "diagnostic" | "read" | "mutating" | "terminal" | "network" | "destructive" | "credential" | "publish";
export type ToolBridgeToolFamily = "diagnostic" | "files" | "editing" | "terminal" | "git" | "github" | "web" | "media" | "mcp" | "browser" | "workflow" | "memory" | "gmail" | "calendar";
export type ToolBridgePermissionRequirement = "diagnostic" | "read-only" | "mutating" | "terminal" | "network" | "destructive" | "external-path" | "credential" | "publish";
export type ToolBridgeToolChoice = "auto" | "none" | "required";
export type ToolBridgeSchedulerMode = "parallel" | "exclusive";
export type ToolIntent =
  | "none"
  | "workspace_evidence"
  | "workspace_mutation"
  | "git_review"
  | "web_search"
  | "terminal"
  | "browser"
  | "media_generation"
  | "memory"
  | "gmail"
  | "calendar"
  | "diagnostic";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonSchema = Record<string, unknown>;

export interface ToolMemorySearchRequest {
  includeProjectMap?: boolean;
  includeRecentEvents?: boolean;
  includeToolLessons?: boolean;
  maxChars?: number;
  maxRecords?: number;
  query: string;
}

export interface ToolMemorySearchResponse {
  chatTitle?: string;
  content: string;
  projectName?: string;
  projectRecordCount?: number;
  storedRecordCount?: number;
  toolLessonCount?: number;
}

export interface ToolExecutionContext {
  agentEnvironment?: AppAgentEnvironment;
  automationScope?: ToolAutomationScope;
  memorySearch?: (request: ToolMemorySearchRequest) => Promise<ToolMemorySearchResponse> | ToolMemorySearchResponse;
  model: string;
  permissionMode: LocalPermissionMode;
  provider: ModelProviderId;
  providerApiKey?: string;
  reportProgress?: ToolExecutionProgressReporter;
  signal?: AbortSignal;
  terminalDefaultShell?: TerminalShellId;
  webSearchMaxResults?: number;
  webSearchSettings?: WebSearchSettings;
  workspaceRoots?: string[];
}

export interface ToolAutomationScope {
  allowedFamilies?: ToolBridgeToolFamily[];
  allowedToolIds?: string[];
  autonomous: boolean;
  maxModelLoops?: number;
  maxRuntimeSeconds?: number;
  maxToolCalls?: number;
  taskId: string;
  taskTitle?: string;
}

export interface ToolExecutionResult {
  content: string;
  data?: JsonValue;
  error?: string;
  ok: boolean;
  skippedReason?: string;
}

export type ToolExecutionProgressReporter = (result: ToolExecutionResult) => void;

export interface ToolDefinition {
  compatibleProviders?: ToolBridgeProviderFormat[];
  description: string;
  executorMetadata?: {
    family: ToolBridgeToolFamily;
    version: number;
  };
  execute: (args: Record<string, unknown>, context: ToolExecutionContext) => Promise<ToolExecutionResult> | ToolExecutionResult;
  id: string;
  inputSchema: JsonSchema;
  permission: ToolBridgePermissionRequirement;
  risk: ToolBridgeRisk;
  scheduler?: { mode?: ToolBridgeSchedulerMode };
  title: string;
}

export interface ToolCapabilityBlockedReason {
  code: string;
  detail: string;
  family?: ToolBridgeToolFamily;
  toolId?: string;
}

export interface ToolCapabilityPlan {
  blockedReasons: ToolCapabilityBlockedReason[];
  canCallProvider: boolean;
  intent: ToolIntent[];
  mustUseTools: boolean;
  prompt: string;
  providerFormat?: ToolBridgeProviderFormat;
  providerVisibleToolIds: string[];
  requiredFamilies: ToolBridgeToolFamily[];
  selectedToolIds: string[];
  selectedTools: ToolDefinition[];
  toolChoice: ToolBridgeToolChoice;
}

export interface ToolCallRequest {
  arguments: unknown;
  argumentsParseError?: string;
  id: string;
  name: string;
  provider: ModelProviderId;
  raw?: unknown;
}

export interface ToolResultMessage {
  arguments: unknown;
  callId: string;
  name: string;
  providerTurnId?: number;
  rawCall?: unknown;
  reasoningState?: ProviderReasoningState;
  result: ToolExecutionResult;
}

export interface ProviderToolBridgeOptions {
  maxToolResultContentChars?: number | null;
  parallelToolCalls?: boolean;
  reasoningState?: ProviderReasoningState;
  capabilityPlan?: ToolCapabilityPlan;
  providerVisibleToolIds?: string[];
  resultsHistoryAlreadyContainsAssistantTurns?: boolean;
  runtimeBudget?: {
    maxExecutions?: number;
    maxPasses?: number;
    maxToolResultContentChars?: number | null;
    remainingExecutions?: number;
    remainingPasses?: number;
  };
  toolChoice?: ToolBridgeToolChoice;
  toolResultDelivery?: "native" | "inline-user-message";
  toolResultMessages?: ToolResultMessage[];
  tools?: ToolDefinition[];
}

export interface ToolPermissionDecision {
  allowed: boolean;
  reason?: string;
  requiresApproval: boolean;
}

export interface ToolValidationResult {
  args?: Record<string, unknown>;
  error?: string;
  ok: boolean;
}

export interface ToolBridgeExecutionStep {
  call: ToolCallRequest;
  chatToolCall: ChatToolCall;
  result: ToolExecutionResult;
  resultMessage: ToolResultMessage;
}

export interface ToolBridgeExecutionBatch {
  coalescedCount?: number;
  executedCount: number;
  handledCount: number;
  hostExecutionCount?: number;
  requestedCount: number;
  resultMessages: ToolResultMessage[];
  steps: ToolBridgeExecutionStep[];
  toolCalls: ChatToolCall[];
}

export interface ToolBridgeProviderTurn {
  content: string;
  reasoningState?: ProviderReasoningState;
  toolCalls?: ToolCallRequest[];
}

export interface ToolApprovalRequest {
  call: ToolCallRequest;
  reason?: string;
  tool: ToolDefinition;
}

export interface ToolApprovalDecision {
  approved: boolean;
  reason?: string;
}

export type ToolApprovalCallback = (request: ToolApprovalRequest) => Promise<ToolApprovalDecision> | ToolApprovalDecision;
export type ToolBridgeTelemetryEvent =
  | {
      callId: string;
      durationMs: number;
      error?: string;
      family?: string;
      ok: boolean;
      toolId: string;
      type: "tool-invoked";
      version?: number;
    }
  | { callId: string; reason: string; toolId: string; type: "tool-skipped" }
  | { callId: string; error: string; toolId: string; type: "tool-validation-failed" }
  | { callId: string; reason?: string; toolId: string; type: "tool-approval-requested" }
  | { approved: boolean; callId: string; reason?: string; toolId: string; type: "tool-approval-resolved" }
  | { coalescedCount: number; fromToolIds: string[]; requestedCount: number; toToolIds: string[]; type: "tool-batch-coalesced" }
  | { exclusiveCount: number; parallelCount: number; segmentCount: number; type: "tool-batch-scheduled" }
  | { loopIndex: number; reason: "max-loops" | "signal"; type: "tool-loop-aborted" }
  | { callId: string; toolName: string; type: "tool-call-duplicate" };
export type ToolBridgeTelemetrySink = (event: ToolBridgeTelemetryEvent) => void;
'@

Write-ShimFile "resultFinalizer.ts" @'
import type { ChatToolCall, ChatToolResultPolicy } from "../types/chat";
import type { ToolExecutionResult } from "./types";

export type ToolResultKind = "diagnostic" | "edit" | "file_content" | "git" | "search" | "summary" | "terminal" | "unknown";
export type VisibleToolResultMode = "allow_raw" | "safe_summary" | "synthesize";

export interface ToolResultFinalizationOptions {
  arguments?: unknown;
  label?: string;
  maxProviderChars?: number | null;
  result: ToolExecutionResult;
  toolId: string;
}

export interface ToolResultFinalization {
  providerContent: string;
  providerRawCharCount: number;
  resultKind: ToolResultKind;
  toolRecordContent: string;
  visibleFallback: string;
  visiblePolicy: ChatToolResultPolicy;
}

export function finalizeToolResult(options: ToolResultFinalizationOptions): ToolResultFinalization {
  const rawContent = createToolResultContent(options.result);
  const providerContent = limitToolResultContentForProvider(rawContent, options.maxProviderChars);
  return {
    providerContent,
    providerRawCharCount: rawContent.length,
    resultKind: "unknown",
    toolRecordContent: rawContent,
    visibleFallback: providerContent,
    visiblePolicy: {
      mode: "safe_summary",
      resultKind: "unknown",
      synthesizeAfterwards: true,
    },
  };
}

export function createToolResultContent(result: ToolExecutionResult) {
  return result.content.trim() || result.error || (result.data === undefined ? "" : safeJson(result.data));
}

export function createVisibleFallbackFromToolCall(toolCall: ChatToolCall) {
  return toolCall.output || toolCall.detail || "";
}

export function shouldToolCallForceSynthesis(toolCall: ChatToolCall) {
  return Boolean(toolCall.resultPolicy?.synthesizeAfterwards);
}

export function isVisibleToolResultLeak(content: string) {
  return /\bTOOL RESULT EVIDENCE\b/i.test(content);
}

function limitToolResultContentForProvider(content: string, maxChars: number | null | undefined) {
  if (typeof maxChars !== "number" || maxChars < 0 || content.length <= maxChars) {
    return content;
  }
  return `${content.slice(0, Math.max(0, maxChars))}\n\n[Tool output truncated for provider context.]`;
}

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
'@

Write-ShimFile "adapters\sharedUtils.ts" @'
import type { JsonSchema, ToolDefinition, ToolResultMessage } from "../types";
import { finalizeToolResult } from "../resultFinalizer";

export function normalizeRemainingChars(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(Math.floor(value), 0);
}

export function decrementRemainingChars(remaining: number | null, rawLength: number): number | null {
  return remaining === null ? null : Math.max(remaining - rawLength, 0);
}

export function createInlineToolResultMessage(result: ToolResultMessage, remainingChars: number | null) {
  const finalization = finalizeToolResult({
    arguments: result.arguments,
    maxProviderChars: remainingChars,
    result: result.result,
    toolId: result.name,
  });
  return {
    content: finalization.providerContent,
    providerRawCharCount: finalization.providerRawCharCount,
  };
}

export function createBudgetedToolResultMessages(results: ToolResultMessage[], maxChars: number | null | undefined) {
  const finalized = new Array<ReturnType<typeof createInlineToolResultMessage>>(results.length);
  let remaining = normalizeRemainingChars(maxChars);

  for (let index = results.length - 1; index >= 0; index -= 1) {
    const result = results[index];
    if (!result) {
      continue;
    }
    const message = createInlineToolResultMessage(result, remaining);
    remaining = decrementRemainingChars(remaining, message.providerRawCharCount);
    finalized[index] = message;
  }

  return finalized;
}

export function appendInlineUserToolResultMessages(currentMessages: unknown, results: ToolResultMessage[], options: { maxToolResultContentChars?: number | null }) {
  const messages = Array.isArray(currentMessages) ? [...currentMessages] : [];
  const finalized = createBudgetedToolResultMessages(results, options.maxToolResultContentChars);
  for (const inlineResult of finalized) {
    messages.push({ content: inlineResult.content, role: "user" });
  }
  return messages;
}

export function createProviderVisibleToolSchema(tool: ToolDefinition) {
  return {
    description: tool.description,
    inputSchema: tool.inputSchema as JsonSchema,
    name: tool.id,
  };
}
'@

Write-ShimFile "adapters\index.ts" @'
import type { ProviderReasoningState } from "../../types/reasoning";
import type { ProviderToolBridgeOptions, ToolBridgeProviderFormat, ToolDefinition } from "../types";
import { isToolCompatibleWithProvider } from "../registry";
import {
  appendInlineUserToolResultMessages,
  createBudgetedToolResultMessages,
} from "./sharedUtils";

export function applyToolBridgeToProviderRequest<T>(body: T, format: ToolBridgeProviderFormat, toolBridge?: ProviderToolBridgeOptions): T {
  if (!toolBridge) {
    return body;
  }

  const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
  appendToolResults(record, format, toolBridge);

  if (!toolBridge.tools?.length || toolBridge.toolChoice === "none") {
    return body;
  }

  const providerVisibleToolIds = toolBridge.providerVisibleToolIds
    ? new Set(toolBridge.providerVisibleToolIds)
    : undefined;
  const tools = toolBridge.tools.filter((tool) =>
    (!providerVisibleToolIds || providerVisibleToolIds.has(tool.id))
      && isToolCompatibleWithProvider(tool, format),
  );

  if (tools.length === 0) {
    return body;
  }

  if (format === "anthropic-messages") {
    record.tools = tools.map(toAnthropicTool);
  } else if (format === "openai-responses") {
    record.tools = tools.map(toResponsesTool);
  } else {
    record.tools = tools.map(toOpenAiCompatibleTool);
  }

  if (format === "anthropic-messages" && toolBridge.toolChoice === "required") {
    record.tool_choice = record.thinking ? { type: "auto" } : { type: "any" };
  } else if (toolBridge.toolChoice && toolBridge.toolChoice !== "auto") {
    record.tool_choice = toolBridge.toolChoice;
  }

  return body;
}

function appendToolResults(
  record: Record<string, unknown>,
  format: ToolBridgeProviderFormat,
  toolBridge: ProviderToolBridgeOptions,
) {
  const results = toolBridge.toolResultMessages ?? [];
  if (results.length === 0) {
    return;
  }

  if (toolBridge.toolResultDelivery === "inline-user-message") {
    const key = format === "openai-responses" ? "input" : "messages";
    record[key] = appendInlineUserToolResultMessages(record[key], results, toolBridge);
    return;
  }

  const finalized = createBudgetedToolResultMessages(
    results,
    toolBridge.maxToolResultContentChars,
  ).map((message, index) => ({
    content: message.content,
    result: results[index]!,
  }));
  const includeAssistantTurn = !toolBridge.resultsHistoryAlreadyContainsAssistantTurns;
  const turns = groupFinalizedToolResultsByProviderTurn(finalized, toolBridge.reasoningState);

  if (format === "openai-responses") {
    const input = Array.isArray(record.input) ? [...record.input] : [];
    for (const turn of turns) {
      if (includeAssistantTurn) {
        input.push(...createResponsesReasoningItems(turn.reasoningState));
        input.push(...turn.results.map(({ result }) => createResponsesFunctionCall(result)));
      }
      input.push(...turn.results.map(({ result, content }) => ({
        call_id: result.callId,
        output: content,
        type: "function_call_output",
      })));
    }
    record.input = input;
    return;
  }

  const messages = Array.isArray(record.messages) ? [...record.messages] : [];
  if (format === "anthropic-messages") {
    for (const turn of turns) {
      if (includeAssistantTurn) {
        messages.push({
          content: [
            ...createAnthropicReasoningBlocks(turn.reasoningState),
            ...turn.results.map(({ result }) => createAnthropicToolUse(result)),
          ],
          role: "assistant",
        });
      }
      messages.push({
        content: turn.results.map(({ result, content }) => ({
          content,
          is_error: !result.result.ok,
          tool_use_id: result.callId,
          type: "tool_result",
        })),
        role: "user",
      });
    }
  } else {
    for (const turn of turns) {
      if (includeAssistantTurn) {
        messages.push(createOpenAiCompatibleAssistantTurn(
          turn.results.map(({ result }) => result),
          turn.reasoningState,
        ));
      }
      messages.push(...turn.results.map(({ result, content }) => ({
        content,
        role: "tool",
        tool_call_id: result.callId,
      })));
    }
  }
  record.messages = messages;
}

function groupFinalizedToolResultsByProviderTurn(
  finalized: Array<{
    content: string;
    result: NonNullable<ProviderToolBridgeOptions["toolResultMessages"]>[number];
  }>,
  fallbackReasoningState?: ProviderReasoningState,
) {
  const turns: Array<{
    providerTurnId?: number;
    reasoningState?: ProviderReasoningState;
    results: typeof finalized;
  }> = [];

  for (const item of finalized) {
    const current = turns[turns.length - 1];
    if (!current || current.providerTurnId !== item.result.providerTurnId) {
      turns.push({
        providerTurnId: item.result.providerTurnId,
        reasoningState: item.result.reasoningState ?? fallbackReasoningState,
        results: [item],
      });
    } else {
      current.results.push(item);
    }
  }
  return turns;
}

function createAnthropicReasoningBlocks(reasoningState?: ProviderReasoningState) {
  if (reasoningState?.format !== "anthropic-thinking") {
    return [];
  }
  return reasoningState.entries.map((entry) => entry.value);
}

function createAnthropicToolUse(result: NonNullable<ProviderToolBridgeOptions["toolResultMessages"]>[number]) {
  const raw = readRecord(result.rawCall);
  return raw.type === "tool_use" && argumentsMatch(raw.input, result.arguments)
    ? raw
    : {
        id: result.callId,
        input: result.arguments,
        name: result.name,
        type: "tool_use",
      };
}

function createResponsesReasoningItems(reasoningState?: ProviderReasoningState) {
  if (reasoningState?.format !== "openai-responses") {
    return [];
  }
  return reasoningState.entries.map((entry) => entry.value);
}

function createResponsesFunctionCall(result: NonNullable<ProviderToolBridgeOptions["toolResultMessages"]>[number]) {
  const raw = readRecord(result.rawCall);
  return raw.type === "function_call" && argumentsMatch(raw.arguments, result.arguments)
    ? raw
    : {
        arguments: stringifyArguments(result.arguments),
        call_id: result.callId,
        name: result.name,
        type: "function_call",
      };
}

function createOpenAiCompatibleAssistantTurn(
  results: NonNullable<ProviderToolBridgeOptions["toolResultMessages"]>,
  reasoningState?: ProviderReasoningState,
) {
  const message: Record<string, unknown> = {
    content: null,
    role: "assistant",
    tool_calls: results.map((result) => {
      const raw = readRecord(result.rawCall);
      const rawFunction = readRecord(raw.function);
      return raw.type === "function"
        && typeof rawFunction.name === "string"
        && argumentsMatch(rawFunction.arguments, result.arguments)
        ? normalizeOpenAiCompatibleToolCallRaw(raw)
        : {
            function: {
              arguments: stringifyArguments(result.arguments),
              name: result.name,
            },
            id: result.callId,
            type: "function",
          };
    }),
  };

  for (const entry of reasoningState?.entries ?? []) {
    if (entry.type === "reasoning_details" || entry.type === "reasoning_content" || entry.type === "reasoning" || entry.type === "thinking") {
      const existing = message[entry.type];
      if (typeof existing === "string" && typeof entry.value === "string") {
        message[entry.type] = existing + entry.value;
      } else if (Array.isArray(existing) && Array.isArray(entry.value)) {
        message[entry.type] = [...existing, ...entry.value];
      } else if (existing === undefined) {
        message[entry.type] = entry.value;
      }
    }
  }
  return message;
}

function normalizeOpenAiCompatibleToolCallRaw(raw: Record<string, unknown>) {
  const { index: _index, ...normalized } = raw;
  return normalized;
}

function argumentsMatch(rawArguments: unknown, executedArguments: unknown) {
  let normalizedRaw = rawArguments;
  if (typeof rawArguments === "string") {
    try {
      normalizedRaw = JSON.parse(rawArguments);
    } catch {
      return false;
    }
  }
  return stringifyArguments(normalizedRaw) === stringifyArguments(executedArguments);
}

function stringifyArguments(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value ?? {});
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function toOpenAiCompatibleTool(tool: ToolDefinition) {
  return {
    function: {
      description: tool.description,
      name: tool.id,
      parameters: tool.inputSchema,
    },
    type: "function",
  };
}

function toResponsesTool(tool: ToolDefinition) {
  return {
    description: tool.description,
    name: tool.id,
    parameters: tool.inputSchema,
    type: "function",
  };
}

function toAnthropicTool(tool: ToolDefinition) {
  return {
    description: tool.description,
    input_schema: tool.inputSchema,
    name: tool.id,
  };
}
'@

Write-ShimFile "permissions.ts" @'
import type { LocalPermissionMode } from "../types/localWorkspace";
import type { ToolDefinition, ToolExecutionContext, ToolPermissionDecision } from "./types";

export interface FilterToolsForPermissionOptions {
  context?: ToolExecutionContext;
}

export function normalizeToolBridgePermissionMode(value: unknown): LocalPermissionMode {
  return value === "auto-review" || value === "full-access" || value === "default" ? value : "default";
}

export function resolveToolPermission(tool: ToolDefinition, context: Pick<ToolExecutionContext, "automationScope" | "permissionMode">): ToolPermissionDecision {
  if (context.permissionMode === "full-access") {
    return {
      allowed: true,
      requiresApproval: false,
    };
  }

  if (tool.permission === "diagnostic" || tool.permission === "read-only") {
    return {
      allowed: true,
      requiresApproval: false,
    };
  }

  return {
    allowed: false,
    reason: "Tool requires approval before execution.",
    requiresApproval: true,
  };
}

export function filterToolsForPermission(
  tools: ToolDefinition[] = [],
  _context?: Pick<ToolExecutionContext, "automationScope" | "permissionMode">,
  _options: FilterToolsForPermissionOptions = {},
) {
  return tools;
}

export function toolBridgePermissionLabel(value: unknown) {
  return String(value ?? "default");
}
'@

Write-ShimFile "registry.ts" @'
import type { ToolBridgeProviderFormat, ToolDefinition, ToolExecutionContext } from "./types";
import { filterToolsForPermission, type FilterToolsForPermissionOptions } from "./permissions";

export type ToolRegistryListOptions = FilterToolsForPermissionOptions;

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  constructor(tools: ToolDefinition[] = []) {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  get(id: string) {
    return this.tools.get(id);
  }

  has(id: string) {
    return this.tools.has(id);
  }

  list() {
    return [...this.tools.values()];
  }

  listForContext(
    context: Pick<ToolExecutionContext, "automationScope" | "permissionMode">,
    providerFormat?: ToolBridgeProviderFormat,
    options?: ToolRegistryListOptions,
  ) {
    return filterToolsForPermission(this.list(), context, options).filter((tool) =>
      isToolCompatibleWithProvider(tool, providerFormat),
    );
  }

  register(tool: ToolDefinition) {
    this.tools.set(tool.id, tool);
    return this;
  }
}

export function createDefaultToolRegistry() {
  return new ToolRegistry();
}

export function isToolCompatibleWithProvider(tool: ToolDefinition, providerFormat: ToolBridgeProviderFormat | undefined) {
  return !providerFormat || !tool.compatibleProviders || tool.compatibleProviders.includes(providerFormat);
}
'@

Write-ShimFile "parsers.ts" @'
import type { ModelProviderId } from "../types/settings";
import type { ToolCallRequest } from "./types";

export function createToolCallRequest(provider: ModelProviderId, id: string, name: string, args: unknown, raw?: unknown): ToolCallRequest {
  const request: ToolCallRequest = {
    arguments: args,
    id,
    name,
    provider,
    raw,
  };

  if (typeof args === "string") {
    const parsed = parseJsonArguments(args);
    request.arguments = parsed.ok ? parsed.value : {};
    request.argumentsParseError = parsed.ok ? undefined : parsed.error;
  }

  return request;
}

export function parseVisibleTextToolCalls(): ToolCallRequest[] {
  return [];
}

export function parseAnthropicStreamToolCallDelta(payload: unknown): { argumentsDelta?: string; argumentsParseError?: string; argumentsSnapshot?: unknown; id?: string; index: number; name?: string; raw?: unknown } | undefined {
  const record = readRecord(payload);
  const index = typeof record.index === "number" ? record.index : 0;
  const block = readRecord(record.content_block);
  if (record.type === "content_block_start" && block.type === "tool_use") {
    const input = readRecord(block.input);
    return {
      argumentsSnapshot: Object.keys(input).length > 0 ? input : undefined,
      id: typeof block.id === "string" ? block.id : undefined,
      index,
      name: typeof block.name === "string" ? block.name : undefined,
      raw: payload,
    };
  }

  const delta = readRecord(record.delta);
  if (record.type === "content_block_delta" && delta.type === "input_json_delta") {
    return {
      argumentsDelta: typeof delta.partial_json === "string" ? delta.partial_json : "",
      index,
      raw: payload,
    };
  }

  return undefined;
}

export function parseAnthropicToolCalls(payload: unknown, provider: ModelProviderId): ToolCallRequest[] {
  return readArray(readRecord(payload).content).flatMap((rawCall, index) => {
    const call = readRecord(rawCall);
    const name = typeof call.name === "string" ? call.name : "";
    if (call.type !== "tool_use" || !name) {
      return [];
    }

    return [createToolCallRequest(
      provider,
      typeof call.id === "string" ? call.id : `${name}-${index + 1}`,
      name,
      call.input ?? {},
      rawCall,
    )];
  });
}

export function parseOpenAiCompatibleStreamToolCallDeltas(payload: unknown): Array<{ argumentsDelta?: string; argumentsParseError?: string; argumentsSnapshot?: unknown; id?: string; index: number; name?: string; raw?: unknown }> {
  const choice = readArray(readRecord(payload).choices)[0];
  const delta = readRecord(readRecord(choice).delta);
  return readArray(delta.tool_calls).map((rawCall, fallbackIndex) => {
    const call = readRecord(rawCall);
    const fn = readRecord(call.function);
    return {
      argumentsDelta: typeof fn.arguments === "string" ? fn.arguments : undefined,
      id: typeof call.id === "string" ? call.id : undefined,
      index: typeof call.index === "number" ? call.index : fallbackIndex,
      name: typeof fn.name === "string" ? fn.name : undefined,
      raw: rawCall,
    };
  });
}

export function parseOpenAiCompatibleToolCalls(message: unknown, provider: ModelProviderId): ToolCallRequest[] {
  return readArray(readRecord(message).tool_calls).flatMap((rawCall, index) => {
    const call = readRecord(rawCall);
    const fn = readRecord(call.function);
    const name = typeof fn.name === "string" ? fn.name : "";
    if (!name) {
      return [];
    }

    return [createToolCallRequest(
      provider,
      typeof call.id === "string" ? call.id : `${name}-${index + 1}`,
      name,
      fn.arguments ?? {},
      rawCall,
    )];
  });
}

export function parseResponsesStreamToolCallDeltas(payload: unknown): Array<{ argumentsDelta?: string; argumentsParseError?: string; argumentsSnapshot?: unknown; id?: string; index: number; name?: string; raw?: unknown }> {
  const record = readRecord(payload);
  const type = typeof record.type === "string" ? record.type : "";
  const index = typeof record.output_index === "number" ? record.output_index : 0;

  if (type === "response.output_item.added") {
    const item = readRecord(record.item);
    if (item.type !== "function_call") {
      return [];
    }

    return [{
      argumentsDelta: typeof item.arguments === "string" ? item.arguments : undefined,
      id: typeof item.call_id === "string" ? item.call_id : typeof item.id === "string" ? item.id : undefined,
      index,
      name: typeof item.name === "string" ? item.name : undefined,
      raw: item,
    }];
  }

  if (type === "response.function_call_arguments.delta") {
    return [{
      argumentsDelta: typeof record.delta === "string" ? record.delta : "",
      index,
      raw: { arguments: typeof record.delta === "string" ? record.delta : "" },
    }];
  }

  if (type === "response.function_call_arguments.done") {
    const parsed = typeof record.arguments === "string" ? parseJsonArguments(record.arguments) : undefined;
    return [{
      argumentsParseError: parsed && !parsed.ok ? parsed.error : undefined,
      argumentsSnapshot: parsed?.ok ? parsed.value : undefined,
      index,
      name: typeof record.name === "string" ? record.name : undefined,
      raw: typeof record.name === "string" ? { name: record.name } : undefined,
    }];
  }

  return [];
}

export function parseResponsesStreamToolCalls(payload: unknown, provider: ModelProviderId): ToolCallRequest[] {
  const response = readRecord(readRecord(payload).response);
  return parseResponsesOutput(response.output, provider);
}

export function parseResponsesToolCalls(payload: unknown, provider: ModelProviderId): ToolCallRequest[] {
  return parseResponsesOutput(readRecord(payload).output, provider);
}

function parseResponsesOutput(output: unknown, provider: ModelProviderId): ToolCallRequest[] {
  return readArray(output).flatMap((rawCall, index) => {
    const call = readRecord(rawCall);
    const name = typeof call.name === "string" ? call.name : "";
    if (call.type !== "function_call" || !name) {
      return [];
    }

    return [createToolCallRequest(
      provider,
      typeof call.call_id === "string"
        ? call.call_id
        : typeof call.id === "string" ? call.id : `${name}-${index + 1}`,
      name,
      call.arguments ?? {},
      rawCall,
    )];
  });
}

function parseJsonArguments(value: string): { ok: true; value: unknown } | { error: string; ok: false } {
  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: true, value: {} };
  }

  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch (error) {
    return {
      error: `Could not parse tool arguments as JSON: ${error instanceof Error ? error.message : String(error)}`,
      ok: false,
    };
  }
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
'@

Write-ShimFile "index.ts" @'
import type { ChatToolCall } from "../types/chat";
import type { ProviderSettings } from "../types/settings";
import type { ToolRegistry } from "./registry";
import type {
  ToolBridgeExecutionBatch,
  ToolBridgeProviderFormat,
  ToolBridgeToolChoice,
  ToolBridgeToolFamily,
  ToolCallRequest,
  ToolCapabilityBlockedReason,
  ToolCapabilityPlan,
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolIntent,
  ToolResultMessage,
  ToolValidationResult,
} from "./types";

export * from "./types";
export * from "./permissions";
export { ToolRegistry, createDefaultToolRegistry, isToolCompatibleWithProvider, type ToolRegistryListOptions } from "./registry";
export * from "./resultFinalizer";
export { applyToolBridgeToProviderRequest } from "./adapters";
export { parseVisibleTextToolCalls } from "./parsers";
export { createProviderVisibleToolSchema, decrementRemainingChars, normalizeRemainingChars } from "./adapters/sharedUtils";

export const BRIDGE_TOOL_CALL_ID_PREFIX = "bridge-tool-";

export function createBridgeChatToolCall(call: ToolCallRequest, tool: ToolDefinition | undefined, result: ToolExecutionResult, status: ChatToolCall["status"] = result.ok ? "complete" : "error"): ChatToolCall {
  return {
    detail: result.skippedReason || result.error,
    id: `${BRIDGE_TOOL_CALL_ID_PREFIX}${call.id}`,
    input: safeStringify(call.arguments ?? {}),
    label: tool?.title || call.name,
    output: result.content || result.error,
    status,
    toolId: call.name,
  };
}

export function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function formatToolResultContent(result: ToolExecutionResult) {
  return result.content || result.error || "";
}

export function coalesceToolBridgeCalls(calls: ToolCallRequest[]) {
  return { calls, coalescedCount: 0 };
}

export function createToolExecutionSegments(calls: ToolCallRequest[]) {
  return [calls];
}

export function getToolSchedulerMode() {
  return "parallel" as const;
}

export async function executeToolBridgeCalls(options: { calls?: ToolCallRequest[]; registry?: ToolRegistry }): Promise<ToolBridgeExecutionBatch> {
  const calls = options.calls ?? [];
  const toolCalls = calls.map((call) =>
    createBridgeChatToolCall(
      call,
      options.registry?.get(call.name),
      { content: "Provider tool bridge is not bundled in this public build.", ok: false, skippedReason: "Tool bridge unavailable." },
      "skipped",
    ),
  );
  const resultMessages: ToolResultMessage[] = calls.map((call) => ({
    arguments: call.arguments,
    callId: call.id,
    name: call.name,
    rawCall: call.raw,
    result: { content: "Provider tool bridge is not bundled in this public build.", ok: false, skippedReason: "Tool bridge unavailable." },
  }));
  return {
    executedCount: 0,
    handledCount: calls.length,
    requestedCount: calls.length,
    resultMessages,
    steps: [],
    toolCalls,
  };
}

export function validateToolArguments(_tool: ToolDefinition | undefined, args: unknown): ToolValidationResult {
  return typeof args === "object" && args !== null
    ? { args: args as Record<string, unknown>, ok: true }
    : { args: {}, ok: true };
}

export function selectAdvertisedBridgeTools() {
  return [] as ToolDefinition[];
}

export interface SelectToolCapabilityPlanOptions {
  availableTools: ToolDefinition[];
  blockedReasons?: ToolCapabilityBlockedReason[];
  mustUseTools?: boolean;
  prompt: string;
  providerFormat?: ToolBridgeProviderFormat;
  requiredFamilies?: ToolBridgeToolFamily[];
  requestedToolChoice?: ToolBridgeToolChoice;
  toolBudgetReached?: boolean;
  toolIntent?: ToolIntent[];
}

export function inferProviderToolBridgeFormat(settings: ProviderSettings): ToolBridgeProviderFormat {
  if (settings.provider === "anthropic") {
    return "anthropic-messages";
  }

  if (settings.provider === "openai" && settings.thinking.enabled) {
    return "openai-responses";
  }

  return "openai-compatible";
}

export function createToolCapabilityPlan(options: {
  blockedReasons?: ToolCapabilityBlockedReason[];
  mustUseTools?: boolean;
  prompt: string;
  providerFormat?: ToolBridgeProviderFormat;
  requestedToolChoice?: ToolBridgeToolChoice;
  requiredFamilies?: ToolBridgeToolFamily[];
  selectedTools: ToolDefinition[];
  toolBudgetReached?: boolean;
  toolIntent?: ToolIntent[];
}): ToolCapabilityPlan {
  const selectedTools = options.toolBudgetReached ? [] : options.selectedTools;
  const providerVisibleToolIds = selectedTools.map((tool) => tool.id);
  const canCallProvider = !options.mustUseTools || (providerVisibleToolIds.length > 0 && !options.toolBudgetReached);

  return {
    blockedReasons: options.blockedReasons ?? [],
    canCallProvider,
    intent: options.toolIntent?.length ? [...new Set(options.toolIntent)] : ["none"],
    mustUseTools: Boolean(options.mustUseTools),
    prompt: options.prompt,
    providerFormat: options.providerFormat,
    providerVisibleToolIds,
    requiredFamilies: [...new Set(options.requiredFamilies ?? [])],
    selectedToolIds: selectedTools.map((tool) => tool.id),
    selectedTools,
    toolChoice: options.toolBudgetReached || !canCallProvider ? "none" : options.requestedToolChoice ?? (options.mustUseTools ? "required" : "auto"),
  };
}

export function selectToolCapabilityPlan(options: SelectToolCapabilityPlanOptions): ToolCapabilityPlan {
  return createToolCapabilityPlan({
    blockedReasons: options.blockedReasons,
    mustUseTools: options.mustUseTools,
    prompt: options.prompt,
    providerFormat: options.providerFormat,
    requestedToolChoice: options.requestedToolChoice,
    requiredFamilies: options.requiredFamilies,
    selectedTools: options.availableTools,
    toolBudgetReached: options.toolBudgetReached,
    toolIntent: options.toolIntent,
  });
}

export function shouldAttachWebSearch(prompt = "") {
  return /\b(?:search|web|latest|current|source|verify|cite)\b/i.test(prompt);
}

export interface SelectAdvertisedBridgeToolsOptions {
  [key: string]: unknown;
}

export function createProjectToolMemoryContext() {
  return "";
}

export function createProjectToolMemoryScope(input: unknown) {
  return input;
}

export function learnProjectToolMemoryFromBridgeRun<T>(state: T) {
  return state;
}

export function learnProjectToolMemoryFromChatToolCalls<T>(state: T) {
  return state;
}

export function loadProjectToolMemoryState(_scope?: unknown, options?: { load?: (key: string) => string | null }) {
  const raw = options?.load?.("project-tool-memory");
  if (!raw) {
    return { entries: [], version: 1 };
  }
  try {
    return JSON.parse(raw);
  } catch {
    return { entries: [], version: 1 };
  }
}

export function saveProjectToolMemoryState(state: unknown, options?: { save?: (key: string, value: string) => void }) {
  options?.save?.("project-tool-memory", safeStringify(state));
}

export function projectToolMemoryStorageKey() {
  return "project-tool-memory";
}

export interface ProjectToolMemoryEntry {
  [key: string]: unknown;
}

export interface ProjectToolMemoryScope {
  [key: string]: unknown;
}

export interface ProjectToolMemoryState {
  entries?: ProjectToolMemoryEntry[];
  version?: number;
}

export interface ProjectToolMemoryStorage {
  load?: (key: string) => string | null;
  save?: (key: string, value: string) => void;
}
'@

$markerFiles = $shimFiles | ForEach-Object {
  $target = Join-Path $toolBridgeRoot $_
  @{
    path = $_
    sha256 = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}
@{
  files = @($markerFiles)
  version = $markerVersion
} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $markerPath -Encoding utf8

Write-Host "Generated public-safe tool bridge shim for CI/release builds."
