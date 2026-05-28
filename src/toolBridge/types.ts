import type { ChatToolCall } from "../types/chat";
import type { LocalPermissionMode } from "../types/localWorkspace";
import type { ProviderReasoningState } from "../types/reasoning";
import type { AppAgentEnvironment, BillingPlanSettings, ModelProviderId, WebSearchSettings } from "../types/settings";
import type { TerminalShellId } from "../types/terminal";

export type ToolBridgeProviderFormat = "openai-compatible" | "anthropic-messages" | "openai-responses";
export type ToolBridgeRisk = "diagnostic" | "read" | "mutating" | "terminal" | "network" | "destructive" | "credential" | "publish";
export type ToolBridgeToolFamily = "diagnostic" | "files" | "editing" | "terminal" | "git" | "github" | "web" | "media" | "mcp" | "browser" | "workflow" | "memory" | "gmail" | "calendar";
export type ToolBridgePermissionRequirement =
  | "diagnostic"
  | "read-only"
  | "mutating"
  | "terminal"
  | "network"
  | "destructive"
  | "external-path"
  | "credential"
  | "publish";
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
  automationScope?: ToolAutomationScope;
  billingPlan?: BillingPlanSettings;
  memorySearch?: (request: ToolMemorySearchRequest) => Promise<ToolMemorySearchResponse> | ToolMemorySearchResponse;
  agentEnvironment?: AppAgentEnvironment;
  model: string;
  providerApiKey?: string;
  permissionMode: LocalPermissionMode;
  provider: ModelProviderId;
  reportProgress?: ToolExecutionProgressReporter;
  signal?: AbortSignal;
  terminalDefaultShell?: TerminalShellId;
  webSearchMaxResults?: number;
  webSearchSettings?: WebSearchSettings;
  workspaceRoots?: string[];
}

export interface ToolAutomationScope {
  allowedFamilies?: ToolBridgeToolFamily[];
  allowedMcpServers?: Array<{
    serverId: string;
    toolNames: string[];
  }>;
  allowedToolIds?: string[];
  autonomous: boolean;
  maxModelLoops?: number;
  maxRuntimeSeconds?: number;
  maxToolCalls?: number;
  taskId: string;
  taskTitle?: string;
}

export interface ToolExecutionResult {
  data?: JsonValue;
  error?: string;
  content: string;
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
  scheduler?: {
    /**
     * Parallel tools may run in the same bounded worker segment. Exclusive
     * tools flush pending parallel work and run alone, preserving safety for
     * terminal sessions, writes, publishes, credentials, and destructive work.
     */
    mode?: ToolBridgeSchedulerMode;
  };
  timeoutMs?: number | null;
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
  // Parse error for raw JSON arguments; the orchestrator reports it without schema validation.
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
  rawCall?: unknown;
  result: ToolExecutionResult;
}

export interface ProviderToolBridgeOptions {
  // Enables provider-native multi-function-call output when the provider supports it.
  parallelToolCalls?: boolean;
  // When true, adapters skip synthetic assistant tool-call turns because history already contains them.
  resultsHistoryAlreadyContainsAssistantTurns?: boolean;
  // Native provider tool-result turns are best for tool use, but weaker models often synthesize
  // more reliably when completed results are supplied as plain user context.
  toolResultDelivery?: "native" | "inline-user-message";
  // Maximum completed tool output characters to include in the next provider request.
  maxToolResultContentChars?: number | null;
  // Opaque provider-native reasoning state to replay only in native tool-result continuations.
  reasoningState?: ProviderReasoningState;
  capabilityPlan?: ToolCapabilityPlan;
  providerVisibleToolIds?: string[];
  toolChoice?: ToolBridgeToolChoice;
  toolResultMessages?: ToolResultMessage[];
  runtimeBudget?: {
    maxExecutions?: number;
    maxPasses?: number;
    maxToolResultContentChars?: number | null;
    remainingExecutions?: number;
    remainingPasses?: number;
  };
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
