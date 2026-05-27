import type { AppFollowUpBehavior, ModelProviderId } from "./settings";
import type { LocalWorkspaceSettings } from "./localWorkspace";
import type { TerminalShellId } from "./terminal";
import type { WebSearchProvider } from "./settings";
import type { AgentApproval, AgentRunStatus } from "./agentRun";

export type ChatRole = "assistant" | "user";

export interface ChatAttachmentBase {
  createdAt: string;
  id: string;
  mimeType: string;
  name: string;
  size: number;
}

export interface ChatFileAttachment extends ChatAttachmentBase {
  dataUrl?: string;
  kind: "file";
  text?: string;
}

export interface ChatImageAttachment extends ChatAttachmentBase {
  dataUrl: string;
  height?: number;
  kind: "image";
  width?: number;
}

export interface ChatVideoAttachment extends ChatAttachmentBase {
  dataUrl: string;
  kind: "video";
}

export type ChatAttachment = ChatFileAttachment | ChatImageAttachment | ChatVideoAttachment;

export type ChatMessageMode = "chat" | "plan";

export interface ChatPlanningQuestionOption {
  description?: string;
  id: string;
  label: string;
}

export interface ChatPlanningQuestion {
  id: string;
  options?: ChatPlanningQuestionOption[];
  placeholder?: string;
  question: string;
  required?: boolean;
}

export interface ChatPlanningInputAnswer {
  optionId?: string;
  questionId: string;
  value: string;
}

export interface ChatPlanningInputRequest {
  answeredAt?: string;
  answers?: ChatPlanningInputAnswer[];
  detail?: string;
  id: string;
  questions: ChatPlanningQuestion[];
  requestedAt: string;
  title: string;
}

export interface ChatPlanning {
  completedAt?: string;
  inputRequest?: ChatPlanningInputRequest;
  inputRequests?: ChatPlanningInputRequest[];
  maxPasses: number;
  passCount: number;
  planContent?: string;
  startedAt: string;
}

export type ChatProgressStatus = "active" | "complete" | "pending";

export interface ChatProgressItem {
  detail?: string;
  id?: string;
  label: string;
  status: ChatProgressStatus;
}

export type ChatArtifactKind = "code" | "document" | "file" | "image" | "other" | "preview";

export interface ChatArtifact {
  detail?: string;
  height?: number;
  id?: string;
  kind?: ChatArtifactKind;
  mimeType?: string;
  sizeBytes?: number;
  sourceFormat?: "markdown" | "text";
  sourceText?: string;
  title: string;
  url?: string;
  width?: number;
}

export interface ChatSource {
  detail?: string;
  id?: string;
  imageUrl?: string;
  sourceType?: "answer" | "image" | "news" | "place" | "video" | "web";
  thumbnailUrl?: string;
  title: string;
  url: string;
}

export type ChatToolCallStatus = "active" | "complete" | "error" | "skipped" | "waiting_approval";

export interface ChatToolCallTerminal {
  command?: string;
  exitCode?: number | null;
  live?: boolean;
  outputTruncated?: boolean;
  sessionId?: string;
  shell?: TerminalShellId;
  timedOut?: boolean;
  workingDirectory?: string;
}

export type ChatToolResultKind =
  | "diagnostic"
  | "edit"
  | "file_content"
  | "git"
  | "search"
  | "summary"
  | "terminal"
  | "unknown";

export type ChatToolResultVisibleMode = "allow_raw" | "safe_summary" | "synthesize";

export interface ChatToolResultPolicy {
  mode: ChatToolResultVisibleMode;
  resultKind: ChatToolResultKind;
  synthesizeAfterwards: boolean;
}

export interface ChatToolFileChange {
  additions: number;
  deletions: number;
  diffPreview?: ChatToolFileChangeLine[];
  diffTruncated?: boolean;
  kind?: "create" | "delete" | "move" | "update";
  path: string;
}

export interface ChatToolFileChangeLine {
  content: string;
  kind: "add" | "context" | "hunk" | "meta" | "remove";
  newLine?: number;
  oldLine?: number;
}

export type ChatToolBatchFileStatus = "error" | "ok" | "skipped";

export interface ChatToolBatchFileResult {
  additions: number;
  deletions: number;
  detail?: string;
  kind?: ChatToolFileChange["kind"];
  path: string;
  requestedPath?: string;
  status: ChatToolBatchFileStatus;
}

export interface ChatToolBatchSummary {
  failureCount: number;
  fileCount: number;
  operation: "edit" | "write";
  requestedCount: number;
  skippedCount: number;
  successCount: number;
}

export interface ChatToolCall {
  batchFileResults?: ChatToolBatchFileResult[];
  batchSummary?: ChatToolBatchSummary;
  detail?: string;
  fileChanges?: ChatToolFileChange[];
  id: string;
  input?: string;
  label: string;
  output?: string;
  resultPolicy?: ChatToolResultPolicy;
  status: ChatToolCallStatus;
  terminal?: ChatToolCallTerminal;
  toolId?: string;
}

export interface ChatWorkTraceToolItem {
  id: string;
  kind: "tool";
  toolCall: ChatToolCall;
}

export interface ChatWorkTraceProgressItem {
  id: string;
  kind: "progress";
  progress: ChatProgressItem;
}

export type ChatWorkTraceItem = ChatWorkTraceToolItem | ChatWorkTraceProgressItem;

export type ChatWebSearchStatus = "active" | "complete" | "error";

export interface ChatWebSearch {
  enabled: boolean;
  error?: string;
  fallbackReason?: string;
  maxResults?: number;
  provider: WebSearchProvider;
  query?: string;
  resultCount?: number;
  resultProvider?: WebSearchProvider;
  searchedAt?: string;
  status?: ChatWebSearchStatus;
}

export interface ChatContextCompaction {
  afterTokens: number;
  beforeTokens: number;
  compactedAt: string;
  compactedMessageCount: number;
  contextWindowTokens?: number;
  forcedByProviderUsage?: boolean;
  strategy?: string;
  summaryVersion?: number;
  thresholdTokens?: number;
}

export interface ChatMessageSource {
  channelId?: string;
  commandName?: string;
  guildId?: string;
  kind: "discord";
  receivedAt?: string;
  userId?: string;
  username?: string;
}

export interface ChatResearchReference {
  chatId: string;
  project: string;
  title: string;
  updatedAt: string;
}

export interface ChatStreamTiming {
  completedAt?: string;
  firstByteAt?: string;
  firstProviderEventAt?: string;
  firstTokenAt?: string;
  firstVisibleTokenAt?: string;
  requestStartedAt: string;
  responseStartedAt?: string;
  timeToFirstByteMs?: number;
  timeToFirstProviderEventMs?: number;
  timeToFirstTokenMs?: number;
  timeToFirstVisibleTokenMs?: number;
  timeToResponseStartMs?: number;
  totalMs?: number;
}

export interface ChatMessage {
  agentRunId?: string;
  agentRunStatus?: AgentRunStatus;
  approvals?: AgentApproval[];
  attachments?: ChatAttachment[];
  artifacts?: ChatArtifact[];
  content: string;
  contextCompactions?: ChatContextCompaction[];
  createdAt: string;
  feedback?: "disliked" | "liked";
  id: string;
  isStreaming?: boolean;
  mode?: ChatMessageMode;
  planning?: ChatPlanning;
  progress?: ChatProgressItem[];
  reasoning?: string;
  researchReferences?: ChatResearchReference[];
  role: ChatRole;
  source?: ChatMessageSource;
  sources?: ChatSource[];
  status?: "error" | "queued";
  streamTiming?: ChatStreamTiming;
  toolCalls?: ChatToolCall[];
  webSearch?: ChatWebSearch;
  workTrace?: ChatWorkTraceItem[];
}

export interface ChatSendInput {
  attachments: ChatAttachment[];
  content: string;
  followUpBehavior?: AppFollowUpBehavior;
  localWorkspace?: LocalWorkspaceSettings;
  mode?: ChatMessageMode;
  planning?: Record<string, never>;
  referencedChatIds?: string[];
  webSearch?: {
    enabled: boolean;
    maxResults?: number;
    provider: WebSearchProvider;
  };
}

export interface ChatComposerDraft {
  attachments: ChatAttachment[];
  content: string;
}

export interface ChatSummary {
  archived?: boolean;
  composerDraft?: ChatComposerDraft;
  id: string;
  isDraft?: boolean;
  messages: ChatMessage[];
  messagesClearedAt?: string;
  messagesLoaded?: boolean;
  model?: string;
  pinned?: boolean;
  project: string;
  provider?: ModelProviderId;
  title: string;
  toolRuntimeVersion?: number;
  updatedAt: string;
}
