import type { ChatSource, ChatToolCall } from "./chat";
import type { ModelProviderId } from "./settings";
import type { ToolBridgeToolFamily } from "../toolBridge/types";

export type AutomationTaskStatus = "enabled" | "paused" | "archived";
export type AutomationRunStatus = "queued" | "running" | "completed" | "failed" | "waiting_for_approval" | "cancelled";
export type AutomationRunReason = "manual" | "scheduled" | "app_start" | "simulated";

export type AutomationTrigger =
  | { kind: "manual" }
  | { everyMinutes: number; kind: "interval" }
  | { kind: "daily"; time: string }
  | { kind: "app_start" };

export type AutomationCapabilityId =
  | "gmail.read"
  | "gmail.send"
  | "gmail.manage"
  | "calendar.read"
  | "calendar.edit"
  | "discord.post"
  | "web.search"
  | "github.read";

export type AutomationAutonomyLevel = "review" | "scoped";

export interface AutomationMcpServerScope {
  serverId: string;
  serverName: string;
  toolNames: string[];
}

export interface AutomationSkillScope {
  id: string;
  name: string;
  trigger: string;
}

export interface AutomationCapabilityScope {
  autonomyLevel: AutomationAutonomyLevel;
  capabilities: AutomationCapabilityId[];
  mcpServers: AutomationMcpServerScope[];
  skills: AutomationSkillScope[];
}

export type AutomationNotificationPrivacy = "private" | "summary";

export interface AutomationNotificationPolicy {
  desktop: boolean;
  discord: boolean;
  maxSummaryChars: number;
  privacy: AutomationNotificationPrivacy;
  tasksInbox: true;
}

export interface AutomationRunLimits {
  maxModelLoops: number;
  maxNotificationChars: number;
  maxRuntimeSeconds: number;
  maxToolCalls: number;
}

export interface AutomationTask {
  capabilityScope: AutomationCapabilityScope;
  chatId?: string;
  createdAt: string;
  description?: string;
  id: string;
  lastResult?: string;
  lastRunAt?: string;
  model?: string;
  nextRunAt?: string;
  notificationPolicy: AutomationNotificationPolicy;
  prompt: string;
  projectName?: string;
  provider?: ModelProviderId;
  runCount: number;
  sourceChatId?: string;
  status: AutomationTaskStatus;
  title: string;
  trigger: AutomationTrigger;
  updatedAt: string;
  runLimits: AutomationRunLimits;
}

export interface AutomationNotificationAttempt {
  at: string;
  channel: "desktop" | "discord" | "tasks_inbox";
  detail?: string;
  ok: boolean;
}

export interface AutomationRun {
  acknowledgedAt?: string;
  agentRunId?: string;
  approvalCount?: number;
  chatId?: string;
  completedAt?: string;
  dryRun?: boolean;
  error?: string;
  finalSummary?: string;
  id: string;
  messageId?: string;
  model?: string;
  notificationAttempts: AutomationNotificationAttempt[];
  provider?: ModelProviderId;
  reason: AutomationRunReason;
  snoozedUntil?: string;
  sources?: ChatSource[];
  startedAt: string;
  status: AutomationRunStatus;
  taskId: string;
  toolCallCount?: number;
  toolCalls?: ChatToolCall[];
  updatedAt: string;
}

export interface AutomationState {
  globalPaused: boolean;
  runs: AutomationRun[];
  tasks: AutomationTask[];
  updatedAt: string;
  version: 1;
}

export interface AutomationTaskDraft {
  capabilityScope?: Partial<AutomationCapabilityScope>;
  description?: string;
  notificationPolicy?: Partial<AutomationNotificationPolicy>;
  model?: string;
  prompt?: string;
  projectName?: string;
  provider?: ModelProviderId;
  sourceChatId?: string;
  status?: AutomationTaskStatus;
  title?: string;
  trigger?: AutomationTrigger;
  runLimits?: Partial<AutomationRunLimits>;
}

export interface AutomationCapabilityDefinition {
  description: string;
  familyHints: ToolBridgeToolFamily[];
  id: AutomationCapabilityId;
  label: string;
  promptHint: string;
  risk: "low" | "medium" | "high";
  toolIds: string[];
}
