import type { MutableRefObject, SetStateAction } from "react";

import type { ContextCompactionNotice } from "../../../lib/contextWindow";
import type { PlanningProviderRequest } from "../../../services/planningClient";
import type { ProviderUsage } from "../../../services/modelProviderClient";
import type { PlanResearchEvidence } from "../../../services/planResearchClient";
import type { AgentApproval, AgentApprovalDecision, AgentRun } from "../../../types/agentRun";
import type { ChatArtifact, ChatAttachment, ChatComposerDraft, ChatMessage, ChatPlanningInputRequest, ChatProgressItem, ChatResearchReference, ChatSendInput, ChatSource, ChatSummary, ChatToolCall, ChatWebSearch, ChatWorkTraceItem } from "../../../types/chat";
import type { LocalWorkspaceSettings } from "../../../types/localWorkspace";
import type { PrimaryRoute } from "../../../types/navigation";
import type { ProviderSettings, WebSearchSettings } from "../../../types/settings";
import type { ToolAutomationScope } from "../../../toolBridge";
import type { ToolRegistrySettings } from "../../../types/tools";
import type { ApprovedPlanExecutionContext, AssistantToolResponse, DiscordReplyTarget, DiscordStreamUpdate, StartSendMessageOptions } from "../WorkspaceApp";
import type { WorkspaceRuntimeDeps } from "../runtimeTypes";

type QueuedSendTarget = { chatId: string; queuedMessageId: string };

type NoticeDialogState = { description?: string; title: string } | null;

interface DiscordResponseStreamer {
  fail: (content: string) => Promise<void>;
  finish: (content: string, update?: DiscordStreamUpdate) => Promise<void>;
  update: (update: DiscordStreamUpdate) => void;
}

interface PlanningRunSnapshot {
  content?: string;
  progress: ChatProgressItem[];
  reasoning?: string;
}

interface PlanningRunResult extends PlanningRunSnapshot {
  content: string;
  providerRequest?: PlanningProviderRequest;
  usage?: ProviderUsage;
}

export function resolveStoredChatModelSelection(
  currentChat: Pick<ChatSummary, "model" | "provider">,
  effectiveProviderSettings: Pick<ProviderSettings, "model" | "provider">,
  options: Pick<StartSendMessageOptions, "preserveChatModelSelection"> = {},
): Pick<ChatSummary, "model" | "provider"> {
  return options.preserveChatModelSelection
    ? {
        model: currentChat.model,
        provider: currentChat.provider,
      }
    : {
        model: effectiveProviderSettings.model,
        provider: effectiveProviderSettings.provider,
      };
}

interface StreamAssistantWithLocalToolsOptions {
  approvalDecisions?: Record<string, AgentApprovalDecision>;
  approvedPlanExecution?: ApprovedPlanExecutionContext;
  automationScope?: ToolAutomationScope;
  chatId: string;
  controller: AbortController;
  memoryToolsEnabled?: boolean;
  messageId: string;
  messagesForProvider: ChatMessage[];
  onExternalUpdate?: (update: DiscordStreamUpdate) => void;
  previousToolCalls?: ChatToolCall[];
  prompt: string;
  providerSettingsOverrides?: Partial<ProviderSettings>;
  requestId: number;
  resumeToolCallContent?: string;
  runId?: string;
  runtimeToolOverrides?: Partial<ProviderSettings["tools"]>;
  toolSelectionPrompt?: string;
  webSearchSettingsOverride?: WebSearchSettings;
  workspaceSettings: LocalWorkspaceSettings;
}

interface RunAppOwnedCodingAgentOptions {
  chatId: string;
  controller: AbortController;
  messageId: string;
  messagesForProvider: ChatMessage[];
  onExternalUpdate?: (update: DiscordStreamUpdate) => void;
  prompt: string;
  requestId: number;
  runId?: string;
  webSearchSettingsOverride?: WebSearchSettings;
  workspaceSettings: LocalWorkspaceSettings;
}

export interface SendActionsDeps extends Pick<WorkspaceRuntimeDeps, "activeChat" | "pendingChatsRef" | "setActiveChatId" | "setChats"> {
  CONTEXT_COMPACTION_PROGRESS_ID: string;
  createActiveGeneration: (
    chatId: string,
    previousChat: ChatSummary,
    previousChatExisted: boolean,
    restoreDraft: ChatComposerDraft,
    target?: { messageId: string },
  ) => { controller: AbortController; requestId: number };
  createAgentRunForMessage: (params: {
    chatId: string;
    localWorkspace?: LocalWorkspaceSettings;
    messageId: string;
    mode: "chat" | "plan";
    prompt: string;
    title?: string;
  }) => AgentRun;
  createChatToolSelectionPrompt: (prompt: string, existingMessages: ChatMessage[], workspaceSettings: LocalWorkspaceSettings) => string;
  createDiscordResponseStreamer: (target: DiscordReplyTarget) => DiscordResponseStreamer;
  createDiscordRuntimeContextMessages: (workspaceSettings: LocalWorkspaceSettings, webSearchToolAvailable: boolean, webSearchProvider: WebSearchSettings["provider"]) => ChatMessage[];
  createEmptyChat: (project?: string) => ChatSummary;
  createFallbackChatTitle: (input: { attachments: ChatAttachment[]; content: string }) => string;
  createId: (prefix: string) => string;
  createMessage: (role: ChatMessage["role"], content: string, status?: ChatMessage["status"], reasoning?: string, attachments?: ChatAttachment[]) => ChatMessage;
  createMessagesForProvider: (
    existingMessages: ChatMessage[],
    userMessage: ChatMessage,
    projectName: string,
    workspaceSettings: LocalWorkspaceSettings,
    prompt: string,
    webContextMessages: ChatMessage[],
    settings: ProviderSettings,
    onCompaction: (notice: ContextCompactionNotice) => void,
  ) => Promise<ChatMessage[]>;
  createPlanningExecutionApproval: (runId: string, messageId: string, planContent: string, prompt: string) => AgentApproval;
  createPlanningInputRequest: (
    settings: ProviderSettings,
    messages: ChatMessage[],
    options?: {
      onProviderRequest?: (request: PlanningProviderRequest) => void;
      onProviderUsage?: (request: PlanningProviderRequest, usage: ProviderUsage | undefined) => void;
      signal?: AbortSignal;
    },
  ) => Promise<ChatPlanningInputRequest | null>;
  createPlanningProgress: (phase: "input" | "researching" | "drafting" | "complete", evidence?: { filesRead: number; searches: number }) => ChatProgressItem[];
  createPlanResearchFollowupInstruction: (evidence: PlanResearchEvidence) => ChatMessage;
  createPlanResearchInstruction: (originalRequest: string, context?: { workspaceRoots?: string[] }) => ChatMessage;
  createPromptAwareProviderSettings: (prompt: string, overrides: Partial<ProviderSettings>, chat: ChatSummary | null | undefined) => ProviderSettings;
  createToolAwareProviderSettings: (overrides: Partial<ProviderSettings>, chat: ChatSummary | null | undefined) => ProviderSettings;
  DEFAULT_PROJECT: string;
  enqueueChatSend: (input: ChatSendInput) => string | undefined;
  finishActiveGeneration: (requestId: number) => void;
  formatResearchPayload: (findings: string, evidence: PlanResearchEvidence) => string;
  formatTokenCount: (tokens: number) => string;
  getEnabledWorkspaceRoots: (workspaceSettings: LocalWorkspaceSettings) => string[];
  getRuntimeWebSearchSettings: (settings: ProviderSettings, requestedWebSearch: ChatSendInput["webSearch"] | ChatWebSearch | undefined) => WebSearchSettings;
  handleSteerQueuedMessage: (messageId: string, content: string) => void;
  isAbortError: (error: unknown) => boolean;
  isChatSending: (chatId: string | undefined) => boolean;
  isRequestInactive: (requestId: number, controller: AbortController) => boolean;
  isResearchDeepEnough: (evidence: PlanResearchEvidence) => boolean;
  localWorkspaceRef: MutableRefObject<LocalWorkspaceSettings>;
  mergeAgentApprovals: (existing: AgentApproval[], incoming: AgentApproval[]) => AgentApproval[];
  mergeChatArtifacts: (existing: ChatArtifact[] | undefined, incoming: ChatArtifact[] | undefined) => ChatArtifact[] | undefined;
  mergeChatSources: (existing: ChatSource[] | undefined, incoming: ChatSource[] | undefined) => ChatSource[] | undefined;
  notifyPlanningInputNeeded: (inputRequest: ChatPlanningInputRequest, chatId: string) => void;
  notifyRunComplete: (message: ChatMessage, chatId: string) => void;
  notifyRunNeedsAttention: (message: string, chatId: string) => void;
  PLAN_RESEARCH_BUDGET: { maxFollowupPasses: number };
  preserveVisibleResponseThinking: (previousMessage: ChatMessage, nextMessage: ChatMessage) => ChatMessage;
  recordPlanningProviderRequest: (chatId: string, request: PlanningProviderRequest) => void;
  recordPlanningProviderUsage: (chatId: string, request: PlanningProviderRequest, usage: ProviderUsage | undefined) => void;
  resolveChatResearchReferences: (input: ChatSendInput, currentChatId: string) => ChatResearchReference[];
  resolveWorkspaceForChatProject: (projectName: string, fallback: LocalWorkspaceSettings) => LocalWorkspaceSettings;
  runAppOwnedCodingAgent: (options: RunAppOwnedCodingAgentOptions) => Promise<AssistantToolResponse>;
  runPlanningMode: (options: {
    messages: ChatMessage[];
    onProviderRequest?: (request: PlanningProviderRequest) => void;
    onProviderUsage?: (request: PlanningProviderRequest, usage: ProviderUsage | undefined) => void;
    onUpdate: (snapshot: PlanningRunSnapshot) => void;
    researchFindings?: string;
    signal?: AbortSignal;
    settings: ProviderSettings;
  }) => Promise<PlanningRunResult>;
  scheduleGeneratedChatTitle: (params: {
    attachments: ChatAttachment[];
    chatId: string;
    content: string;
    fallbackTitle: string;
    settings: ProviderSettings;
    userMessageId: string;
  }) => void;
  sendDiscordReply: (target: DiscordReplyTarget | undefined, content: string) => Promise<void>;
  setActiveGenerationTarget: (requestId: number, chatId: string, messageId: string) => void;
  setActiveRoute: (route: PrimaryRoute) => void;
  setAgentRunCompleted: (runId: string | undefined, message: ChatMessage) => void;
  setAgentRunFailed: (runId: string | undefined, errorMessage: string) => void;
  setAgentRunWaiting: (runId: string | undefined, label: string, detail: string, approvals?: AgentApproval[], pendingToolCallContent?: string) => void;
  setNoticeDialog: (action: SetStateAction<NoticeDialogState>) => void;
  shouldStartAppAgentRun: (params: { mode: "chat" | "plan"; prompt: string; toolSettings: ToolRegistrySettings; workspace: LocalWorkspaceSettings }) => boolean;
  sortChatsByUpdatedAt: (chats: ChatSummary[]) => ChatSummary[];
  startSendMessage: (input: ChatSendInput, queuedSend?: QueuedSendTarget, options?: StartSendMessageOptions) => Promise<void>;
  stopStaleStreamingMessages: (chatId: string, activeMessageId?: string) => void;
  streamAssistantWithLocalTools: (options: StreamAssistantWithLocalToolsOptions) => Promise<AssistantToolResponse>;
  summarizeResearchEvidence: (toolCalls: ChatToolCall[] | undefined) => PlanResearchEvidence;
  toolSettings: ToolRegistrySettings;
  touchProject: (projectName: string) => void;
  updateAgentRun: (runId: string | undefined, updater: (run: AgentRun, now: string) => AgentRun) => AgentRun | undefined;
  updateGeneratedMessage: (chatId: string, messageId: string, updateMessage: (message: ChatMessage) => ChatMessage, sortByUpdatedAt?: boolean) => void;
  withContextCompactionMarker: (message: ChatMessage, notice: ContextCompactionNotice | undefined) => ChatMessage;
  withContextCompactionProgress: (compactionProgress: ChatProgressItem, progress: ChatProgressItem[] | undefined) => ChatProgressItem[];
  withLocalComputerProgress: (localProgress: ChatProgressItem | undefined, progress: ChatProgressItem[] | undefined) => ChatProgressItem[] | undefined;
  withWebSearchProgress: (webSearch: ChatWebSearch | undefined, progress: ChatProgressItem[] | undefined) => ChatProgressItem[] | undefined;
}

export async function handleSendMessage(deps: SendActionsDeps, input: ChatSendInput) {
  const { activeChat, enqueueChatSend, handleSteerQueuedMessage, isChatSending, startSendMessage } = deps;

    if (isChatSending(activeChat.id)) {
      const queuedMessageId = enqueueChatSend(input);

      if (input.followUpBehavior === "steer" && queuedMessageId) {
        const defer = typeof window === "undefined" ? setTimeout : window.setTimeout;
        defer(() => handleSteerQueuedMessage(queuedMessageId, input.content), 0);
      }

      return;
    }

    await startSendMessage(input);
  }

const SUBSCRIPTION_RUNTIME_WARMUP_PROGRESS_ID = "subscription-runtime-warmup";

function createAssistantStartupProgress(settings: ProviderSettings): ChatProgressItem | undefined {
  void settings;
  return undefined;
}

function createAssistantStartupWorkTrace(params: {
  assistantMessageId: string;
  progress?: ChatProgressItem;
}): ChatWorkTraceItem[] | undefined {
  const items: ChatWorkTraceItem[] = [];

  if (params.progress) {
    items.push({
      id: `${params.assistantMessageId}-subscription-runtime`,
      kind: "progress",
      progress: params.progress,
    });
  }

  return items.length > 0 ? items : undefined;
}

function withStartupProgress(progress: ChatProgressItem[] | undefined, startupProgress: ChatProgressItem | undefined) {
  if (!startupProgress) {
    return progress;
  }

  return [startupProgress, ...(progress ?? [])];
}

function completeStartupProgress(progress: ChatProgressItem[] | undefined) {
  if (!progress?.length) {
    return progress;
  }

  return progress.map((item) =>
    item.id === SUBSCRIPTION_RUNTIME_WARMUP_PROGRESS_ID && item.status === "active"
      ? {
          ...item,
          detail: "Subscription runtime checked.",
          status: "complete" as const,
        }
      : item,
  );
}

export async function startSendMessage(deps: SendActionsDeps, input: ChatSendInput, queuedSend?: QueuedSendTarget, options: StartSendMessageOptions = {}) {
  const { activeChat, CONTEXT_COMPACTION_PROGRESS_ID, createActiveGeneration, createAgentRunForMessage, createChatToolSelectionPrompt, createDiscordResponseStreamer, createDiscordRuntimeContextMessages, createEmptyChat, createFallbackChatTitle, createId, createMessage, createMessagesForProvider, createPlanningExecutionApproval, createPlanningInputRequest, createPlanningProgress, createPlanResearchFollowupInstruction, createPlanResearchInstruction, createPromptAwareProviderSettings, createToolAwareProviderSettings, DEFAULT_PROJECT, finishActiveGeneration, formatResearchPayload, formatTokenCount, getEnabledWorkspaceRoots, getRuntimeWebSearchSettings, isAbortError, isChatSending, isRequestInactive, isResearchDeepEnough, localWorkspaceRef, mergeAgentApprovals, mergeChatArtifacts, mergeChatSources, notifyPlanningInputNeeded, notifyRunComplete, notifyRunNeedsAttention, pendingChatsRef, PLAN_RESEARCH_BUDGET, preserveVisibleResponseThinking, recordPlanningProviderRequest, recordPlanningProviderUsage, resolveChatResearchReferences, resolveWorkspaceForChatProject, runAppOwnedCodingAgent, runPlanningMode, scheduleGeneratedChatTitle, sendDiscordReply, setActiveChatId, setActiveGenerationTarget, setActiveRoute, setAgentRunCompleted, setAgentRunFailed, setAgentRunWaiting, setChats, setNoticeDialog, shouldStartAppAgentRun, sortChatsByUpdatedAt, stopStaleStreamingMessages, streamAssistantWithLocalTools, summarizeResearchEvidence, toolSettings, touchProject, updateAgentRun, updateGeneratedMessage, withContextCompactionMarker, withContextCompactionProgress, withLocalComputerProgress, withWebSearchProgress } = deps;

    const content = input.content.trim();
    const providerPrompt = (options.providerPrompt ?? content).trim() || content;
    const attachments = input.attachments;
    const sourceChat = options.sourceChat ?? (queuedSend ? pendingChatsRef.current.find((chat) => chat.id === queuedSend.chatId && !chat.archived) : activeChat);
    const currentChat = sourceChat ?? createEmptyChat(DEFAULT_PROJECT);

    if (isChatSending(currentChat.id)) {
      await sendDiscordReply(options.discordReply, "Gilbert is already working in that conversation. Try again after that response finishes.");
      return;
    }

    if (!toolSettings.provider) {
      setNoticeDialog({
        description: "Turn Model Provider back on in Settings before sending a chat request.",
        title: "Model Provider is off",
      });
      await sendDiscordReply(options.discordReply, "Gilbert's model provider is off. Turn it back on in Settings before using Discord chat.");
      return;
    }

    const isPlanningMode = toolSettings.planning && input.mode === "plan";
    const workspaceSettings = resolveWorkspaceForChatProject(currentChat.project, input.localWorkspace ?? localWorkspaceRef.current);
    const effectiveProviderSettings = createPromptAwareProviderSettings(providerPrompt, options.providerSettingsOverrides ?? {}, currentChat);
    const runtimeWebSearchSettings = getRuntimeWebSearchSettings(effectiveProviderSettings, input.webSearch);
    const webSearchToolAvailable = Boolean(toolSettings.webSearch && runtimeWebSearchSettings.enabled);
    const discordStreamer = options.discordReply ? createDiscordResponseStreamer(options.discordReply) : undefined;
    const queuedMessageIndex = queuedSend ? currentChat.messages.findIndex((message) => message.id === queuedSend.queuedMessageId && message.role === "user") : -1;
    const queuedMessage = queuedMessageIndex >= 0 ? currentChat.messages[queuedMessageIndex] : undefined;

    const currentChatExisted = pendingChatsRef.current.some((chat) => chat.id === currentChat.id);
    const restoreDraft: ChatComposerDraft = { attachments, content };
    const messagesBeforeUser = queuedSend ? (queuedMessage ? currentChat.messages.slice(0, queuedMessageIndex) : currentChat.messages) : currentChat.messages;
    const messagesAfterUser = queuedSend && queuedMessage ? currentChat.messages.slice(queuedMessageIndex + 1) : [];
    const shouldGenerateChatTitle = messagesBeforeUser.length === 0 && !options.preserveExistingTitle;
    const fallbackChatTitle = createFallbackChatTitle({ attachments, content });
    const researchReferences = resolveChatResearchReferences(
      {
        ...input,
        content,
      },
      currentChat.id,
    );
    const previousChatSnapshot = queuedSend
      ? {
          ...currentChat,
          messages: [...messagesBeforeUser, ...messagesAfterUser],
          title: shouldGenerateChatTitle ? fallbackChatTitle : currentChat.title,
        }
      : currentChat;
    const { controller, requestId } = createActiveGeneration(currentChat.id, previousChatSnapshot, currentChatExisted, restoreDraft);
    const automationRuntimeTimeoutMs = options.automationScope?.maxRuntimeSeconds
      ? Math.max(1, options.automationScope.maxRuntimeSeconds) * 1000
      : 0;
    const automationRuntimeTimer = automationRuntimeTimeoutMs > 0
      ? setTimeout(() => controller.abort(), automationRuntimeTimeoutMs)
      : undefined;

    let userMessage!: ChatMessage;
    let assistantMessage!: ChatMessage;
    let agentRun!: AgentRun;
    let titleGenerationScheduled = false;
    let scheduleTitleGenerationAfterPrimaryStream = () => {};

    try {
    const now = new Date().toISOString();
    userMessage =
      queuedSend && queuedMessage
        ? {
            ...queuedMessage,
            attachments: attachments.length > 0 ? attachments : undefined,
            content,
            researchReferences: researchReferences.length > 0 ? researchReferences : undefined,
            source: options.userMessageSource ?? queuedMessage.source,
            status: undefined,
          }
        : {
            ...createMessage("user", content, undefined, undefined, attachments),
            ...(queuedSend ? { id: queuedSend.queuedMessageId } : {}),
            researchReferences: researchReferences.length > 0 ? researchReferences : undefined,
            source: options.userMessageSource,
          };
    const discordContextMessages = options.discordReply ? createDiscordRuntimeContextMessages(workspaceSettings, webSearchToolAvailable, runtimeWebSearchSettings.provider) : [];
    const assistantDraft = createMessage("assistant", "");
    const startupProgress = createAssistantStartupProgress(effectiveProviderSettings);
    assistantMessage = {
      ...assistantDraft,
      isStreaming: true,
      mode: isPlanningMode ? "plan" : "chat",
      planning: isPlanningMode
        ? {
            maxPasses: 1,
            passCount: 0,
            startedAt: now,
          }
        : undefined,
      progress: withStartupProgress(isPlanningMode ? createPlanningProgress("input") : undefined, startupProgress),
      workTrace: createAssistantStartupWorkTrace({
        assistantMessageId: assistantDraft.id,
        progress: startupProgress,
      }),
    };
    agentRun = createAgentRunForMessage({
      chatId: currentChat.id,
      localWorkspace: workspaceSettings,
      messageId: assistantMessage.id,
      mode: isPlanningMode ? "plan" : "chat",
      prompt: providerPrompt,
      title: fallbackChatTitle,
    });
    assistantMessage.agentRunId = agentRun.id;
    assistantMessage.agentRunStatus = agentRun.status;
    setActiveGenerationTarget(requestId, currentChat.id, assistantMessage.id);
    options.onAssistantMessageCreated?.({
      agentRunId: agentRun.id,
      chatId: currentChat.id,
      messageId: assistantMessage.id,
      model: effectiveProviderSettings.model,
      provider: effectiveProviderSettings.provider,
      userMessageId: userMessage.id,
    });

    if (!options.background) {
      setActiveChatId(currentChat.id);
      setActiveRoute("chat");
    }

    setChats((currentChats) => {
      const hasCurrentChat = currentChats.some((chat) => chat.id === currentChat.id);
      const nextMessages = queuedSend ? [...messagesBeforeUser, userMessage, assistantMessage, ...messagesAfterUser] : [...currentChat.messages, userMessage, assistantMessage];
      const storedModelSelection = resolveStoredChatModelSelection(currentChat, effectiveProviderSettings, options);
      const updatedChat: ChatSummary = {
        ...currentChat,
        composerDraft: undefined,
        isDraft: undefined,
        messages: nextMessages,
        model: storedModelSelection.model,
        provider: storedModelSelection.provider,
        title: shouldGenerateChatTitle ? fallbackChatTitle : currentChat.title,
        updatedAt: now,
      };

      const nextChats = hasCurrentChat ? currentChats.map((chat) => (chat.id === currentChat.id ? updatedChat : chat)) : [updatedChat, ...currentChats];

      const sortedChats = sortChatsByUpdatedAt(nextChats);
      pendingChatsRef.current = sortedChats;
      return sortedChats;
    });
    stopStaleStreamingMessages(currentChat.id, assistantMessage.id);
    touchProject(currentChat.project);

    scheduleTitleGenerationAfterPrimaryStream = () => {
      if (!shouldGenerateChatTitle || titleGenerationScheduled || controller.signal.aborted) {
        return;
      }

      titleGenerationScheduled = true;
      scheduleGeneratedChatTitle({
        attachments,
        chatId: currentChat.id,
        content,
        fallbackTitle: fallbackChatTitle,
        settings: effectiveProviderSettings,
        userMessageId: userMessage.id,
      });
    };

      const providerUserMessage = providerPrompt === content ? userMessage : { ...userMessage, content: providerPrompt };
      const messagesForProvider = await createMessagesForProvider(messagesBeforeUser, providerUserMessage, currentChat.project, workspaceSettings, providerPrompt, discordContextMessages, effectiveProviderSettings, (notice) => {
        const compactionProgress = {
          detail: `${notice.compactedMessageCount} older messages compacted. Active request is now ${formatTokenCount(notice.afterTokens)} / ${formatTokenCount(notice.contextWindowTokens)}.`,
          id: CONTEXT_COMPACTION_PROGRESS_ID,
          label: "Automatically compacting context",
          status: "complete",
        } satisfies ChatProgressItem;

        updateGeneratedMessage(currentChat.id, assistantMessage.id, (message) => ({
          ...withContextCompactionMarker(message, notice),
          progress: withContextCompactionProgress(compactionProgress, message.progress),
        }));
      });

      if (isRequestInactive(requestId, controller)) {
        return;
      }

      if (isPlanningMode) {
        const inputRequest = await createPlanningInputRequest(effectiveProviderSettings, messagesForProvider, {
          onProviderRequest: (request) => recordPlanningProviderRequest(currentChat.id, request),
          onProviderUsage: (request, usage) => recordPlanningProviderUsage(currentChat.id, request, usage),
          signal: controller.signal,
        });

        if (isRequestInactive(requestId, controller)) {
          return;
        }

        if (inputRequest) {
          setChats((currentChats) =>
            sortChatsByUpdatedAt(
              currentChats.map((chat) =>
                chat.id === currentChat.id
                  ? {
                      ...chat,
                      messages: chat.messages.map((message) =>
                        message.id === assistantMessage.id
                          ? {
                              ...message,
                              agentRunStatus: "waiting_for_approval",
                              isStreaming: false,
                              planning: message.planning
                                ? {
                                    ...message.planning,
                                    inputRequest,
                                    inputRequests: [inputRequest],
                                  }
                                : undefined,
                              progress: withWebSearchProgress(message.webSearch, createPlanningProgress("input")),
                            }
                          : message,
                      ),
                      updatedAt: new Date().toISOString(),
                    }
                  : chat,
              ),
            ),
          );
          setAgentRunWaiting(agentRun.id, "Planning input needed", inputRequest.detail || inputRequest.title);
          touchProject(currentChat.project);
          notifyPlanningInputNeeded(inputRequest, currentChat.id);
          if (discordStreamer) {
            await discordStreamer.finish("Gilbert needs input inside the app before this Discord request can continue.");
          } else {
            await sendDiscordReply(options.discordReply, "Gilbert needs input inside the app before this Discord request can continue.");
          }
          return;
        }

        // --- Plan research phase ---
        // Run the agentic research loop with prompts that DEMAND real tool
        // calls. If the agent settles without enough evidence (it sometimes
        // just summarizes from context), re-prompt once with a follow-up that
        // tells it exactly what's missing.
        //
        // Force-enable the read-only research tools regardless of chat-mode
        // toggles. The user opted into plan mode, which implies they want real
        // research — chat-mode toggles for fileSearch/fileBrowser/codeView
        // shouldn't gate that. Runtime/browser tools remain governed by user prefs,
        // but the selection prompt below makes them available when the request asks
        // for preview, screenshots, console evidence, or dev-server diagnostics.
        const planResearchToolOverrides: Partial<ProviderSettings["tools"]> = {
          codeView: true,
          fileBrowser: true,
          fileSearch: true,
        };
        const researchInstruction = createPlanResearchInstruction(providerPrompt, {
          workspaceRoots: getEnabledWorkspaceRoots(workspaceSettings),
        });
        const planResearchToolSelectionPrompt = [
          "Plan mode codebase research. Search workspace directories, grep source files, and read relevant files before drafting. If the request mentions runtime behavior, browser UI, localhost, preview, screenshots, or console errors, also use terminal diagnostics plus browser preview, screenshot, and console tools before drafting.",
          providerPrompt,
        ].join("\n");
        setChats((currentChats) =>
          currentChats.map((chat) =>
            chat.id === currentChat.id
              ? {
                  ...chat,
                  messages: chat.messages.map((message) =>
                    message.id === assistantMessage.id
                      ? preserveVisibleResponseThinking(message, {
                          ...message,
                          content: "",
                          progress: withWebSearchProgress(message.webSearch, createPlanningProgress("researching")),
                        })
                      : message,
                  ),
                }
              : chat,
          ),
        );
        let researchMessages: ChatMessage[] = [...messagesForProvider, researchInstruction];
        let researchResponse = await streamAssistantWithLocalTools({
          chatId: currentChat.id,
          controller,
          messageId: assistantMessage.id,
          memoryToolsEnabled: false,
          messagesForProvider: researchMessages,
          prompt: providerPrompt,
          requestId,
          runId: agentRun.id,
          runtimeToolOverrides: planResearchToolOverrides,
          toolSelectionPrompt: planResearchToolSelectionPrompt,
          webSearchSettingsOverride: runtimeWebSearchSettings,
          workspaceSettings,
        });

        if (isRequestInactive(requestId, controller)) {
          return;
        }

        if (researchResponse.waitingForApproval) {
          setChats((currentChats) =>
            sortChatsByUpdatedAt(
              currentChats.map((chat) =>
                chat.id === currentChat.id
                  ? {
                      ...chat,
                      messages: chat.messages.map((message) =>
                        message.id === assistantMessage.id
                          ? {
                              ...message,
                              agentRunStatus: "waiting_for_approval",
                              approvals: researchResponse.approvalRequests && researchResponse.approvalRequests.length > 0
                                ? mergeAgentApprovals(message.approvals ?? [], researchResponse.approvalRequests)
                                : message.approvals,
                              content: researchResponse.content,
                              isStreaming: false,
                              progress: withLocalComputerProgress(researchResponse.progress, message.progress),
                              toolCalls: researchResponse.toolCalls ?? message.toolCalls,
                            }
                          : message,
                      ),
                      updatedAt: new Date().toISOString(),
                    }
                  : chat,
              ),
            ),
          );
          setAgentRunWaiting(
            agentRun.id,
            "Approval required during plan research",
            "A prior local-tool approval is still pending from saved chat state.",
            researchResponse.approvalRequests ?? [],
            researchResponse.pendingToolCallContent,
          );
          notifyRunNeedsAttention("An approval is waiting during plan research.", currentChat.id);
          touchProject(currentChat.project);
          return;
        }

        // Combine tool calls from across all research passes so the evidence
        // ledger reflects the full picture, not just the most recent call.
        let accumulatedResearchToolCalls: ChatToolCall[] = researchResponse.toolCalls ?? [];
        let accumulatedResearchContent = researchResponse.content?.trim() || "";
        let researchEvidence = summarizeResearchEvidence(accumulatedResearchToolCalls);
        let followupPasses = 0;

        while (!isResearchDeepEnough(researchEvidence) && followupPasses < PLAN_RESEARCH_BUDGET.maxFollowupPasses) {
          followupPasses += 1;
          const followupInstruction = createPlanResearchFollowupInstruction(researchEvidence);
          // Build the next conversation: prior research messages + the agent's
          // prior digest (so the model can see what it already wrote) + the
          // follow-up nudge.
          researchMessages = [
            ...researchMessages,
            createMessage("assistant", accumulatedResearchContent || "(no digest produced)"),
            followupInstruction,
          ];

          const followupResponse = await streamAssistantWithLocalTools({
            chatId: currentChat.id,
            controller,
            messageId: assistantMessage.id,
            memoryToolsEnabled: false,
            messagesForProvider: researchMessages,
            prompt: providerPrompt,
            requestId,
            runId: agentRun.id,
            runtimeToolOverrides: planResearchToolOverrides,
            toolSelectionPrompt: planResearchToolSelectionPrompt,
            webSearchSettingsOverride: runtimeWebSearchSettings,
            workspaceSettings,
          });

          if (isRequestInactive(requestId, controller)) {
            return;
          }

          if (followupResponse.waitingForApproval) {
            // Abandon further research; the existing approval-handling path is
            // adjacent (above) and the chat state already reflects the pending
            // approval from the helper. Fall through with whatever we have.
            break;
          }

          accumulatedResearchToolCalls = followupResponse.toolCalls ?? accumulatedResearchToolCalls;
          accumulatedResearchContent = (followupResponse.content?.trim() || accumulatedResearchContent);
          researchEvidence = summarizeResearchEvidence(accumulatedResearchToolCalls);
          researchResponse = followupResponse;
        }

        const researchFindings = formatResearchPayload(accumulatedResearchContent, researchEvidence);

        setChats((currentChats) =>
          currentChats.map((chat) =>
            chat.id === currentChat.id
              ? {
                  ...chat,
                  messages: chat.messages.map((message) =>
                    message.id === assistantMessage.id
                      ? preserveVisibleResponseThinking(message, {
                          ...message,
                          content: "",
                          isStreaming: true,
                          progress: withWebSearchProgress(
                            message.webSearch,
                            createPlanningProgress("drafting", {
                              filesRead: researchEvidence.filesRead.length,
                              searches: researchEvidence.searchQueries.length + researchEvidence.webQueries.length,
                            }),
                          ),
                          toolCalls: researchResponse.toolCalls ?? message.toolCalls,
                        })
                      : message,
                  ),
                }
              : chat,
          ),
        );

        const assistantResponse = await runPlanningMode({
          messages: messagesForProvider,
          researchFindings,
          signal: controller.signal,
          settings: createToolAwareProviderSettings({}, currentChat),
          onProviderRequest: (request) => recordPlanningProviderRequest(currentChat.id, request),
          onProviderUsage: (request, usage) => recordPlanningProviderUsage(currentChat.id, request, usage),
          onUpdate: (snapshot) => {
            if (isRequestInactive(requestId, controller)) {
              return;
            }

            setChats((currentChats) =>
              currentChats.map((chat) =>
                chat.id === currentChat.id
                  ? {
                      ...chat,
                      messages: chat.messages.map((message) =>
                        message.id === assistantMessage.id
                          ? preserveVisibleResponseThinking(message, {
                          ...message,
                          content: snapshot.content ?? message.content,
                          progress: withWebSearchProgress(message.webSearch, snapshot.progress),
                          reasoning: snapshot.reasoning ?? message.reasoning,
                        })
                          : message,
                      ),
                    }
                  : chat,
              ),
            );
          },
        });

        if (isRequestInactive(requestId, controller)) {
          return;
        }

        const planApproval = createPlanningExecutionApproval(agentRun.id, assistantMessage.id, assistantResponse.content, providerPrompt);

        setChats((currentChats) =>
          sortChatsByUpdatedAt(
            currentChats.map((chat) =>
              chat.id === currentChat.id
                ? {
                    ...chat,
                    messages: chat.messages.map((message) =>
                      message.id === assistantMessage.id
                        ? preserveVisibleResponseThinking(message, {
                            ...message,
                            agentRunStatus: "waiting_for_approval",
                            approvals: mergeAgentApprovals(message.approvals ?? [], [planApproval]),
                            content: assistantResponse.content,
                            isStreaming: false,
                            planning: message.planning
                              ? {
                                  ...message.planning,
                                  completedAt: new Date().toISOString(),
                                  passCount: 1,
                                  planContent: assistantResponse.content,
                                }
                              : undefined,
                            progress: withWebSearchProgress(message.webSearch, assistantResponse.progress),
                            reasoning: assistantResponse.reasoning ?? message.reasoning,
                          })
                        : message,
                    ),
                    updatedAt: new Date().toISOString(),
                  }
                : chat,
            ),
          ),
        );
        setAgentRunWaiting(agentRun.id, "Plan approval required", "Approve the plan to hand it into the executable agent loop.", [planApproval]);
        notifyRunNeedsAttention("A plan is ready for approval before execution.", currentChat.id);
        touchProject(currentChat.project);
        if (discordStreamer) {
          await discordStreamer.finish("Gilbert made a plan, but it needs approval inside the app before execution.");
        } else {
          await sendDiscordReply(options.discordReply, "Gilbert made a plan, but it needs approval inside the app before execution.");
        }
        return;
      } else {
        const useAppAgentRuntime = !options.automationScope && shouldStartAppAgentRun({
          mode: "chat",
          prompt: providerPrompt,
          toolSettings,
          workspace: workspaceSettings,
        });

        if (useAppAgentRuntime) {
          updateAgentRun(agentRun.id, (run, eventAt) => ({
            ...run,
            events: [
              ...run.events,
              {
                at: eventAt,
                detail: "Gilbert will run workspace actions through the app-owned agent runtime instead of model-facing primitive tools.",
                id: createId("agent-event"),
                label: "App-owned agent runtime selected",
                type: "status",
              },
            ],
            updatedAt: eventAt,
          }));
        }

        const assistantResponse = useAppAgentRuntime
          ? await runAppOwnedCodingAgent({
              chatId: currentChat.id,
              controller,
              messageId: assistantMessage.id,
              messagesForProvider,
              onExternalUpdate: discordStreamer?.update,
              prompt: providerPrompt,
              requestId,
              runId: agentRun.id,
              webSearchSettingsOverride: runtimeWebSearchSettings,
              workspaceSettings,
            })
          : await streamAssistantWithLocalTools({
              automationScope: options.automationScope,
              chatId: currentChat.id,
              controller,
              messageId: assistantMessage.id,
              messagesForProvider,
              onExternalUpdate: discordStreamer?.update,
              prompt: providerPrompt,
              providerSettingsOverrides: options.providerSettingsOverrides,
              requestId,
              runId: agentRun.id,
              runtimeToolOverrides: options.runtimeToolOverrides,
              toolSelectionPrompt: options.toolSelectionPrompt ?? createChatToolSelectionPrompt(providerPrompt, messagesBeforeUser, workspaceSettings),
              webSearchSettingsOverride: runtimeWebSearchSettings,
              workspaceSettings,
            });

        if (isRequestInactive(requestId, controller)) {
          return;
        }

        setChats((currentChats) => {
          const nextChats = sortChatsByUpdatedAt(
            currentChats.map((chat) =>
              chat.id === currentChat.id
                ? {
                    ...chat,
                    messages: chat.messages.map((message) =>
                      message.id === assistantMessage.id
                        ? preserveVisibleResponseThinking(message, {
                            ...message,
                            agentRunStatus: assistantResponse.waitingForApproval ? "waiting_for_approval" : "completed",
                            approvals: assistantResponse.approvalRequests && assistantResponse.approvalRequests.length > 0
                              ? mergeAgentApprovals(message.approvals ?? [], assistantResponse.approvalRequests)
                              : message.approvals,
                            artifacts: mergeChatArtifacts(message.artifacts, assistantResponse.artifacts),
                            content: assistantResponse.content,
                            isStreaming: false,
                            progress: completeStartupProgress(withLocalComputerProgress(assistantResponse.progress, message.progress)),
                            reasoning: assistantResponse.reasoning ?? message.reasoning,
                            sources: assistantResponse.sources && assistantResponse.sources.length > 0 ? mergeChatSources(message.sources, assistantResponse.sources) : message.sources,
                            streamTiming: assistantResponse.streamTiming ?? message.streamTiming,
                            toolCalls: assistantResponse.toolCalls ?? message.toolCalls,
                          })
                        : message,
                    ),
                    updatedAt: new Date().toISOString(),
                  }
                : chat,
            ),
          );

          pendingChatsRef.current = nextChats;
          return nextChats;
        });
        if (assistantResponse.waitingForApproval) {
          setAgentRunWaiting(
            agentRun.id,
            "Tool approval required",
            "Review the pending tool action, then allow, deny, or approve edited arguments to continue the same run.",
            assistantResponse.approvalRequests ?? [],
            assistantResponse.pendingToolCallContent,
          );
          options.onAssistantMessageSettled?.({
            agentRunId: agentRun.id,
            approvals: assistantResponse.approvalRequests,
            chatId: currentChat.id,
            content: assistantResponse.content,
            messageId: assistantMessage.id,
            model: effectiveProviderSettings.model,
            provider: effectiveProviderSettings.provider,
            sources: assistantResponse.sources,
            status: "waiting_for_approval",
            toolCalls: assistantResponse.toolCalls,
          });
          notifyRunNeedsAttention("A tool action is waiting for your approval.", currentChat.id);
          touchProject(currentChat.project);
          if (discordStreamer) {
            await discordStreamer.finish("Gilbert needs tool approval inside the app before this Discord request can finish.");
          } else {
            await sendDiscordReply(options.discordReply, "Gilbert needs tool approval inside the app before this Discord request can finish.");
          }
          return;
        }

        const completedAssistantMessage: ChatMessage = {
          ...assistantMessage,
          agentRunStatus: "completed",
          artifacts: mergeChatArtifacts(assistantMessage.artifacts, assistantResponse.artifacts),
          content: assistantResponse.content,
          isStreaming: false,
          sources: assistantResponse.sources && assistantResponse.sources.length > 0 ? mergeChatSources(assistantMessage.sources, assistantResponse.sources) : assistantMessage.sources,
          streamTiming: assistantResponse.streamTiming,
          toolCalls: assistantResponse.toolCalls,
        };
        setAgentRunCompleted(agentRun.id, completedAssistantMessage);
        options.onAssistantMessageSettled?.({
          agentRunId: agentRun.id,
          chatId: currentChat.id,
          content: assistantResponse.content,
          messageId: assistantMessage.id,
          model: effectiveProviderSettings.model,
          provider: effectiveProviderSettings.provider,
          sources: assistantResponse.sources,
          status: "completed",
          toolCalls: assistantResponse.toolCalls,
        });
        notifyRunComplete(completedAssistantMessage, currentChat.id);
        if (discordStreamer) {
          await discordStreamer.finish(assistantResponse.content, {
            sources: assistantResponse.sources ?? [],
          });
        } else {
          await sendDiscordReply(options.discordReply, assistantResponse.content);
        }
      }
      touchProject(currentChat.project);
    } catch (error) {
      if (isAbortError(error) || isRequestInactive(requestId, controller)) {
        return;
      }

      const errorContent = error instanceof Error ? error.message : "The provider request failed.";

      if (!assistantMessage || !agentRun) {
        const failedUserMessage = userMessage ?? {
          ...createMessage("user", content, undefined, undefined, attachments),
          researchReferences: researchReferences.length > 0 ? researchReferences : undefined,
          source: options.userMessageSource,
        };
        const failedAssistantMessage: ChatMessage = {
          ...createMessage("assistant", errorContent),
          agentRunStatus: "failed",
          content: errorContent,
          isStreaming: false,
          mode: isPlanningMode ? "plan" : "chat",
          status: "error",
        };

        setChats((currentChats) => {
          const hasCurrentChat = currentChats.some((chat) => chat.id === currentChat.id);
          const existingChat = currentChats.find((chat) => chat.id === currentChat.id) ?? currentChat;
          const updatedChat: ChatSummary = {
            ...existingChat,
            composerDraft: undefined,
            isDraft: undefined,
            messages: [...messagesBeforeUser, failedUserMessage, failedAssistantMessage, ...messagesAfterUser],
            title: shouldGenerateChatTitle ? fallbackChatTitle : existingChat.title,
            updatedAt: new Date().toISOString(),
          };
          const nextChats = sortChatsByUpdatedAt(hasCurrentChat ? currentChats.map((chat) => (chat.id === currentChat.id ? updatedChat : chat)) : [updatedChat, ...currentChats]);
          pendingChatsRef.current = nextChats;
          return nextChats;
        });
        notifyRunNeedsAttention(errorContent, currentChat.id);
        touchProject(currentChat.project);
        if (discordStreamer) {
          await discordStreamer.fail(`Gilbert hit an error while handling the Discord request: ${errorContent}`);
        } else {
          await sendDiscordReply(options.discordReply, `Gilbert hit an error while handling the Discord request: ${errorContent}`);
        }
        return;
      }

      setChats((currentChats) =>
        sortChatsByUpdatedAt(
          currentChats.map((chat) =>
            chat.id === currentChat.id
              ? {
                  ...chat,
                  messages: chat.messages.map((message) =>
                    message.id === assistantMessage.id
                      ? {
                          ...message,
                          agentRunStatus: "failed",
                          content: errorContent,
                          isStreaming: false,
                          status: "error",
                        }
                      : message,
                  ),
                  updatedAt: new Date().toISOString(),
                }
              : chat,
          ),
        ),
      );
      setAgentRunFailed(agentRun.id, errorContent);
      options.onAssistantMessageSettled?.({
        agentRunId: agentRun.id,
        chatId: currentChat.id,
        content: errorContent,
        error: errorContent,
        messageId: assistantMessage.id,
        model: effectiveProviderSettings.model,
        provider: effectiveProviderSettings.provider,
        status: "failed",
      });
      notifyRunNeedsAttention(errorContent, currentChat.id);
      touchProject(currentChat.project);
      if (discordStreamer) {
        await discordStreamer.fail(`Gilbert hit an error while handling the Discord request: ${errorContent}`);
      } else {
        await sendDiscordReply(options.discordReply, `Gilbert hit an error while handling the Discord request: ${errorContent}`);
      }
    } finally {
      if (automationRuntimeTimer) {
        clearTimeout(automationRuntimeTimer);
      }
      scheduleTitleGenerationAfterPrimaryStream();
      finishActiveGeneration(requestId);
    }
  }
