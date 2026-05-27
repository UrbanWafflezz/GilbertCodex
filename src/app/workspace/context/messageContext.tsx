// @ts-nocheck
import type { SetStateAction } from "react";

import type { AgentRuntimeDecision } from "../../../agentRuntime/codingAgent";
import type { LocalComputerToolExecutionPolicy, LocalSubagentResult, LocalSubagentTask } from "../../../localWorkspace/localToolRuntimeDisabled";
import type { ContextCompactionNotice, ContextWindowUsage, ModelContextWindowMap, compactMessagesForContext } from "../../../lib/contextWindow";
import type { PlanningProviderRequest } from "../../../services/planningClient";
import type { ProviderToolBridgeOptions, ToolBridgeExecutionBatch, ToolCallRequest, ToolDefinition, ToolExecutionContext, ToolMemorySearchRequest, ToolResultMessage } from "../../../toolBridge";
import type { AppInfo } from "../../../types/app";
import type { AgentApproval, AgentApprovalDecision, AgentRun } from "../../../types/agentRun";
import type { AuthSession } from "../../../types/auth";
import type { ChatArtifact, ChatAttachment, ChatContextCompaction, ChatComposerDraft, ChatMessage, ChatPlanningInputAnswer, ChatProgressItem, ChatResearchReference, ChatSendInput, ChatSource, ChatSummary, ChatToolCall, ChatWebSearch, ChatWorkTraceItem } from "../../../types/chat";
import type { DiscordBridgeSettings } from "../../../types/discord";
import type { LocalWorkspaceSettings } from "../../../types/localWorkspace";
import type { PrimaryRoute } from "../../../types/navigation";
import type { CreateProjectOptions, ProjectSummary } from "../../../types/project";
import type { ProviderReasoningState } from "../../../types/reasoning";
import type { AppPersonalizationSettings, AppearanceMode, ProviderSettings, WebSearchSettings } from "../../../types/settings";
import type { ToolRegistrySettings } from "../../../types/tools";
import type { SettingsSectionId } from "../../../pages/settings/types";
import type { DiscordInteractionEvent } from "../../tauriClient";
import type { ActiveGeneration, ApprovedPlanExecutionContext, AssistantToolResponse, ComposerDraftRestoreRequest, DiscordReplyTarget, DiscordStreamUpdate, QueuedChatSend, SessionApprovalDecisionMap, SessionApprovalDecisionsByWorkspace, StartSendMessageOptions } from "../WorkspaceApp";
import type { WorkspaceRuntimeDeps } from "../runtimeTypes";
import { createProjectGoalContextContent, getActiveProjectGoal } from "../../../lib/projectGoals";

const WORKSPACE_ROOT_RESOLUTION_TIMEOUT_MS = 1_500;

export async function steerActiveResponse(deps: WorkspaceRuntimeDeps, {
    activeGeneration,
    assistantMessageIndex,
    contentOverride,
    currentChat,
    queuedSend,
  }: {
    activeGeneration: ActiveGeneration;
    assistantMessageIndex: number;
    contentOverride?: string;
    currentChat: ChatSummary;
    queuedSend: QueuedChatSend;
  }) {
  const { activeGenerationsRef, activeRequestChatIdsRef, CONTEXT_COMPACTION_PROGRESS_ID, createActiveGeneration, createChatToolSelectionPrompt, createMessage, createMessagesForProvider, createPromptAwareProviderSettings, createSteeringInstruction, finishActiveGeneration, formatTokenCount, getLatestUserPrompt, isAbortError, isRequestInactive, localWorkspaceRef, mergeChatArtifacts, notifyRunComplete, notifyRunNeedsAttention, pendingChatsRef, preserveVisibleResponseThinking, removeSteeringProgress, resolveWorkspaceForChatProject, setActiveChatId, setActiveRoute, setChats, sortChatsByUpdatedAt, streamAssistantWithLocalTools, touchProject, updateGeneratedMessage, updateQueuedChatSends, withContextCompactionMarker, withContextCompactionProgress, withLocalComputerProgress, withSteeringProgress } = deps;

    const queuedMessage = currentChat.messages.find((message) => message.id === queuedSend.userMessageId);
    const assistantMessage = currentChat.messages[assistantMessageIndex];
    const steerContent = contentOverride?.trim() || queuedMessage?.content.trim() || queuedSend.input.content.trim();

    if (!assistantMessage || assistantMessage.role !== "assistant" || !steerContent) {
      return;
    }

    const now = new Date().toISOString();
    const visibleSteerMessage: ChatMessage = {
      ...(queuedMessage ?? createMessage("user", steerContent, undefined, undefined, queuedSend.input.attachments)),
      attachments: queuedSend.input.attachments.length > 0 ? queuedSend.input.attachments : queuedMessage?.attachments,
      content: steerContent,
      source: queuedMessage?.source,
      status: undefined,
    };
    const messagesWithoutQueuedSteer = currentChat.messages.filter((message) => message.id !== queuedSend.userMessageId);
    const nextAssistantMessageIndex = messagesWithoutQueuedSteer.findIndex((message) => message.id === assistantMessage.id);

    if (nextAssistantMessageIndex < 0) {
      return;
    }

    activeGeneration.controller.abort();
    activeGenerationsRef.current.delete(activeGeneration.chatId);
    activeRequestChatIdsRef.current.delete(activeGeneration.requestId);
    updateQueuedChatSends((currentQueue) => currentQueue.filter((candidate) => candidate.id !== queuedSend.id));

    const messagesBeforeAssistant = messagesWithoutQueuedSteer.slice(0, nextAssistantMessageIndex);
    const messagesAfterAssistant = messagesWithoutQueuedSteer.slice(nextAssistantMessageIndex + 1);
    const previousChatSnapshot = {
      ...currentChat,
      messages: [...messagesBeforeAssistant, visibleSteerMessage, ...messagesAfterAssistant],
      updatedAt: now,
    };
    const { controller, requestId } = createActiveGeneration(currentChat.id, previousChatSnapshot, true, undefined, {
      messageId: assistantMessage.id,
    });
    const latestPrompt = getLatestUserPrompt(messagesBeforeAssistant);
    const steeringPrompt = [latestPrompt, `Steer: ${steerContent}`].filter(Boolean).join("\n\n");
    const partialAssistantContent = assistantMessage.content.trim();
    const steeringInstruction = createMessage("user", createSteeringInstruction(steerContent, latestPrompt));
    const providerBaseMessages = [
      ...messagesBeforeAssistant.filter((message) => message.status !== "queued"),
      ...(partialAssistantContent ? [createMessage("assistant", partialAssistantContent)] : []),
    ];

    setActiveChatId(currentChat.id);
    setActiveRoute("chat");
    setChats((currentChats) => {
      const nextChats = currentChats.map((chat) =>
        chat.id === currentChat.id
          ? {
              ...chat,
              messages: [
                ...messagesBeforeAssistant,
                visibleSteerMessage,
                {
                  ...assistantMessage,
                  isStreaming: true,
                  progress: withSteeringProgress(assistantMessage.progress),
                  status: undefined,
                } satisfies ChatMessage,
                ...messagesAfterAssistant,
              ],
              updatedAt: now,
            }
          : chat,
      );

      pendingChatsRef.current = nextChats;
      return nextChats;
    });

    const workspaceSettings = resolveWorkspaceForChatProject(currentChat.project, queuedSend.input.localWorkspace ?? localWorkspaceRef.current);
    const effectiveProviderSettings = createPromptAwareProviderSettings(steeringPrompt, {}, currentChat);

    try {
      const messagesForProvider = await createMessagesForProvider(
        providerBaseMessages,
        steeringInstruction,
        currentChat.project,
        workspaceSettings,
        steeringPrompt,
        [],
        effectiveProviderSettings,
        (notice) => {
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
        },
      );

      if (isRequestInactive(requestId, controller)) {
        return;
      }

      const assistantResponse = await streamAssistantWithLocalTools({
        chatId: currentChat.id,
        controller,
        messageId: assistantMessage.id,
        messagesForProvider,
        prompt: steeringPrompt,
        requestId,
        runId: assistantMessage.agentRunId,
        toolSelectionPrompt: createChatToolSelectionPrompt(steeringPrompt, messagesBeforeAssistant, workspaceSettings),
        workspaceSettings,
      });

      if (isRequestInactive(requestId, controller)) {
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
                      ? preserveVisibleResponseThinking(message, {
                            ...message,
                            artifacts: mergeChatArtifacts(message.artifacts, assistantResponse.artifacts),
                            content: assistantResponse.content,
                          isStreaming: false,
                          progress: withLocalComputerProgress(assistantResponse.progress, removeSteeringProgress(message.progress)),
                          reasoning: assistantResponse.reasoning ?? message.reasoning,
                          toolCalls: assistantResponse.toolCalls ?? message.toolCalls,
                        })
                      : message,
                  ),
                  updatedAt: new Date().toISOString(),
                }
              : chat,
          ),
        ),
      );
      notifyRunComplete({
        ...assistantMessage,
        artifacts: mergeChatArtifacts(assistantMessage.artifacts, assistantResponse.artifacts),
        content: assistantResponse.content,
        isStreaming: false,
        progress: withLocalComputerProgress(assistantResponse.progress, removeSteeringProgress(assistantMessage.progress)),
        toolCalls: assistantResponse.toolCalls ?? assistantMessage.toolCalls,
      });
      touchProject(currentChat.project);
    } catch (error) {
      if (isAbortError(error) || isRequestInactive(requestId, controller)) {
        return;
      }

      const errorContent = error instanceof Error ? error.message : "The steered response failed.";

      updateGeneratedMessage(
        currentChat.id,
        assistantMessage.id,
        (message) => ({
          ...message,
          content: errorContent,
          isStreaming: false,
          progress: removeSteeringProgress(message.progress),
          status: "error",
        }),
        true,
      );
      notifyRunNeedsAttention(errorContent);
      touchProject(currentChat.project);
    } finally {
      finishActiveGeneration(requestId);
    }
  }

export async function createMessagesForProvider(deps: WorkspaceRuntimeDeps, existingMessages: ChatMessage[], userMessage: ChatMessage, projectName: string, workspaceSettings: LocalWorkspaceSettings, prompt: string, webContextMessages: ChatMessage[], settings: ProviderSettings, onCompaction: (notice: ContextCompactionNotice) => void) {
  const { compactProviderMessages, createActiveProjectBoundaryMessage, createChatResearchContextMessages, createLocalWorkspaceContextMessages, createMessage, createPdfLibraryContextMessages, createSourceControlContextMessages, normalizeProjectName, projects, shouldSkipLocalContextForGithub } = deps;

    const visibleMessages = existingMessages.filter((message) => message.status !== "error");
    const normalizedProjectName = normalizeProjectName(projectName);
    const projectGoal = getActiveProjectGoal(projects ?? [], normalizedProjectName);
    const sourceControlContextMessages = await createSourceControlContextMessages(prompt);
    const projectBoundaryMessages = [createActiveProjectBoundaryMessage(projectName, workspaceSettings)];
    const projectGoalContextMessages = projectGoal
      ? [createMessage("user", createProjectGoalContextContent(normalizedProjectName, projectGoal))]
      : [];
    const chatResearchContextMessages = createChatResearchContextMessages(userMessage.researchReferences);
    const pdfContextMessages = createPdfLibraryContextMessages(projectName);
    const localContextMessages = shouldSkipLocalContextForGithub(prompt)
      ? []
      : await createLocalWorkspaceContextMessages(workspaceSettings, prompt, projectName);
    const compaction = compactProviderMessages(
      [
        ...visibleMessages,
        ...sourceControlContextMessages,
        ...projectBoundaryMessages,
        ...projectGoalContextMessages,
        ...chatResearchContextMessages,
        ...pdfContextMessages,
        ...localContextMessages,
        ...webContextMessages,
        userMessage,
      ],
      settings,
    );

    if (compaction.contextCompaction) {
      onCompaction?.(compaction.contextCompaction);
    }

    return compaction.messages;
  }

const TOOL_SELECTION_ACKNOWLEDGEMENT_PATTERN = /^\s*(?:thanks?|thank you|ok(?:ay)?|cool|nice|got it|sounds good|perfect|great)\s*[.!?]*\s*$/i;
const LOCAL_CODE_TOOL_CONTEXT_PATTERN =
  /\b(?:app|codebase|component|config(?:uration)?|file|implementation|model|provider|registry|repo|repository|runtime|service|settings?|source|tool|workspace|src[\\/]|\.tsx?\b|\.jsx?\b)\b/i;
const TOOL_SELECTION_FOLLOWUP_PATTERN =
  /\b(?:it|this|that|these|those|they|them|feature|implementation|provider|setting|tool|works?\s+with|supports?)\b/i;
const CONNECTED_APP_TOOL_CONTEXT_PATTERN =
  /\b(?:gmail|mailbox|inbox|email(?:s| message| thread)?|google calendar|primary calendar|calendar account|calendar events?|free[-\s/]?busy|all[-\s]?day event)\b/i;
const CONNECTED_APP_TOOL_FOLLOWUP_PATTERN =
  /\b(?:again|check|look|now|one more time|1 more time|refresh|recheck|re-check|same|show|today|tomorrow|yesterday)\b/i;

export function createChatToolSelectionPrompt(deps: WorkspaceRuntimeDeps, prompt: string, existingMessages: ChatMessage[], workspaceSettings: LocalWorkspaceSettings) {
  const { activeChat, normalizeProjectName, projects, referencesSelectedWorkspaceForToolSelection, shouldAttachWebSearch } = deps;

    const trimmedPrompt = prompt.trim();

    if (!trimmedPrompt || TOOL_SELECTION_ACKNOWLEDGEMENT_PATTERN.test(trimmedPrompt)) {
      return trimmedPrompt;
    }

    const recentContext = existingMessages
      .filter((message) => message.status !== "queued" && (message.role === "assistant" || message.role === "user"))
      .slice(-4)
      .map((message) => `${message.role}: ${message.content.replace(/\s+/g, " ").trim().slice(0, 900)}`)
      .filter((line) => line.length > 12)
      .join("\n");

    const looksLikeFollowUp =
      trimmedPrompt.split(/\s+/).filter(Boolean).length <= 18 ||
      TOOL_SELECTION_FOLLOWUP_PATTERN.test(trimmedPrompt);
    const looksLikeConnectedAppFollowUp =
      Boolean(recentContext) &&
      CONNECTED_APP_TOOL_CONTEXT_PATTERN.test(recentContext) &&
      looksLikeFollowUp &&
      CONNECTED_APP_TOOL_FOLLOWUP_PATTERN.test(trimmedPrompt);
    const activeProjectGoal = getActiveProjectGoal(projects ?? [], activeChat?.project ?? "");
    const projectGoalContext = activeProjectGoal
      ? [
          "Active Project Goal for tool selection only:",
          `Project: ${normalizeProjectName(activeChat.project)}`,
          activeProjectGoal.objective,
          "Keep local project tools available when the user is continuing, steering, or verifying this goal.",
        ].join("\n")
      : "";

    if (projectGoalContext) {
      return [trimmedPrompt, projectGoalContext, recentContext ? `Recent conversation context for tool selection only:\n${recentContext}` : ""]
        .filter(Boolean)
        .join("\n\n");
    }

    if (shouldAttachWebSearch(trimmedPrompt) && !referencesSelectedWorkspaceForToolSelection(trimmedPrompt) && !looksLikeConnectedAppFollowUp) {
      return trimmedPrompt;
    }

    if (!recentContext || !looksLikeFollowUp) {
      return trimmedPrompt;
    }

    if (looksLikeConnectedAppFollowUp) {
      return [
        trimmedPrompt,
        "Recent app/tool conversation context for tool selection only:",
        recentContext,
        "If the user is following up on Gmail, Google Calendar, or another connected app result, keep the same app tools available for the next answer.",
      ].join("\n\n");
    }

    if (!workspaceSettings.enabled || !LOCAL_CODE_TOOL_CONTEXT_PATTERN.test(recentContext)) {
      return trimmedPrompt;
    }

    return [
      trimmedPrompt,
      "Local-code conversation context for tool selection only:",
      recentContext,
      "If the user is asking about the selected workspace, gather fresh workspace evidence before the final answer.",
    ].join("\n\n");
  }

export function referencesSelectedWorkspaceForToolSelection(deps: WorkspaceRuntimeDeps, prompt: string) {

    return /\b(?:our|this|the|selected)\s+(?:app|code|codebase|component|config(?:uration)?|file|implementation|project|repo|repository|runtime|service|settings?|source|tool|workspace)\b|\b(?:local|workspace|repo|repository|codebase|source\s+code|src[\\/]|\.tsx?\b|\.jsx?\b)\b/i.test(prompt);
  }

export function resolveChatResearchReferences(deps: WorkspaceRuntimeDeps, input: ChatSendInput, currentChatId: string): ChatResearchReference[] {
  const { contentReferencesChatTitle, getChatResearchCandidates, normalizeProjectName } = deps;

    const referencedIds = new Set((input.referencedChatIds ?? []).filter(Boolean));
    const candidates = getChatResearchCandidates(currentChatId);

    for (const candidate of candidates) {
      if (contentReferencesChatTitle(input.content, candidate.title)) {
        referencedIds.add(candidate.id);
      }
    }

    const references = candidates
      .filter((chat) => referencedIds.has(chat.id))
      .map((chat) => ({
        chatId: chat.id,
        project: normalizeProjectName(chat.project),
        title: chat.title || "Untitled chat",
        updatedAt: chat.updatedAt,
      }));

    return references;
  }

export function getChatResearchCandidates(deps: WorkspaceRuntimeDeps, currentChatId: string) {
  const { isPlainResearchChat, pendingChatsRef, sortChatsByUpdatedAt } = deps;

    return sortChatsByUpdatedAt(
      pendingChatsRef.current.filter((chat) => isPlainResearchChat(chat, currentChatId)),
    );
  }

export function createChatResearchContextMessages(deps: WorkspaceRuntimeDeps, references: ChatResearchReference[]) {
  const { createChatResearchContextContent, createMessage, isPlainResearchChat, pendingChatsRef, sortChatsByUpdatedAt } = deps;

    if (!references?.length) {
      return [];
    }

    const referencedIds = new Set(references.map((reference) => reference.chatId));
    const referencedChats = sortChatsByUpdatedAt(
      pendingChatsRef.current.filter((chat) => referencedIds.has(chat.id) && isPlainResearchChat(chat)),
    );

    if (referencedChats.length === 0) {
      return [];
    }

    return [
      createMessage(
        "user",
        createChatResearchContextContent(referencedChats),
      ),
    ];
  }

export function createActiveProjectBoundaryMessage(deps: WorkspaceRuntimeDeps, projectName: string, workspaceSettings: LocalWorkspaceSettings) {
  const { createMessage, normalizeProjectName } = deps;

    const normalizedProjectName = normalizeProjectName(projectName);
    const roots = workspaceSettings.enabled && workspaceSettings.roots.length > 0 ? workspaceSettings.roots.join(" | ") : "none";
    const fullComputer = workspaceSettings.enabled && workspaceSettings.scope === "full-computer";

    return createMessage(
      "user",
      [
        "ACTIVE PROJECT BOUNDARY",
        `Project: ${normalizedProjectName}`,
        `Workspace roots for this request: ${roots}`,
        fullComputer
          ? "Full computer mode is enabled. The roots above are focused starting points, not the whole allowed filesystem boundary; app-exposed file and terminal tools may resolve host drive roots lazily for precise absolute paths, sibling projects, assets, downloads, and clone targets."
          : workspaceSettings.enabled && workspaceSettings.roots.length > 0
          ? "The workspace roots above are the authoritative selected folder context for this request."
          : "No local folder is selected for this request; do not describe any other project as a substitute. PDF export requests may still return downloadable chat artifacts directly in this conversation.",
        fullComputer
          ? "Use this active chat plus current tool/web evidence when describing or changing a project. If the user names another local folder or asks to compare/copy from another codebase, use precise tool calls against that path instead of refusing because it is outside the focused root."
          : "Use only this active chat, these workspace roots, and this request's tool/web evidence when describing or changing a project.",
        "Treat prior file listings, terminal output, sources, or project descriptions from any other project as stale unless the user explicitly asks to compare projects.",
      ].join("\n"),
    );
  }

export function createMemorySearchForRequest(deps: WorkspaceRuntimeDeps, chatId: string, projectName: string, workspaceSettings: LocalWorkspaceSettings) {
  const { clampMemoryToolInteger, createDurableMemoryContext, createDurableMemoryScopeFromChat, createProjectToolMemoryContext, limitMemoryToolContent, loadDurableChatMemoryState, loadDurableProjectMemoryState, loadPersistentString, loadToolMemoryForProject, normalizeProjectName, pendingChatsRef, savePersistentString } = deps;

    return (request: ToolMemorySearchRequest) => {
      const query = request.query.trim();
      const maxChars = clampMemoryToolInteger(request.maxChars, 8_000, 1_200, 24_000);
      const maxRecords = clampMemoryToolInteger(request.maxRecords, 10, 1, 24);
      const chat = pendingChatsRef.current.find((candidate) => candidate.id === chatId) ?? {
        id: chatId,
        messages: [],
        project: projectName,
        title: "Current chat",
        updatedAt: new Date().toISOString(),
      };
      const scope = createDurableMemoryScopeFromChat(chat, workspaceSettings);
      const chatState = loadDurableChatMemoryState(scope, {
        read: loadPersistentString,
        write: savePersistentString,
      });
      const projectState = loadDurableProjectMemoryState(scope, {
        read: loadPersistentString,
        write: savePersistentString,
      });
      const durableContent = createDurableMemoryContext(chatState, projectState, {
        includeProjectMap: request.includeProjectMap !== false,
        includeRecentEvents: request.includeRecentEvents !== false,
        maxChars: Math.max(1_200, Math.round(maxChars * 0.72)),
        maxRecords,
        prompt: query,
      });
      const toolState = request.includeToolLessons === false
        ? undefined
        : loadToolMemoryForProject(projectName, workspaceSettings);
      const toolLessonContent = toolState
        ? createProjectToolMemoryContext(toolState, {
            maxChars: Math.max(800, Math.round(maxChars * 0.35)),
            maxEntries: Math.min(maxRecords, 12),
            prompt: query,
          })
        : "";
      const content = limitMemoryToolContent([durableContent, toolLessonContent].filter((item) => item.trim()).join("\n\n"), maxChars);

      return {
        chatTitle: chat.title,
        content,
        projectName: normalizeProjectName(projectName),
        projectRecordCount: projectState.records.length,
        storedRecordCount: chatState.records.length + projectState.records.length,
        toolLessonCount: toolState?.entries.length ?? 0,
      };
    };
  }

export function clampMemoryToolInteger(deps: WorkspaceRuntimeDeps, value: number | undefined, fallback: number, min: number, max: number) {

    if (typeof value !== "number" || !Number.isFinite(value)) {
      return fallback;
    }

    return Math.max(min, Math.min(max, Math.round(value)));
  }

export function limitMemoryToolContent(deps: WorkspaceRuntimeDeps, content: string, maxChars: number) {

    if (content.length <= maxChars) {
      return content;
    }

    const marker = "\n[Memory search results ended at the requested size. Query memory_search again with a narrower query for more precise context.]";
    return `${content.slice(0, Math.max(0, maxChars - marker.length)).trimEnd()}${marker}`;
  }

export function rememberProjectMapSnapshot(deps: WorkspaceRuntimeDeps, projectName: string, workspaceSettings: LocalWorkspaceSettings) {
  const { createDurableProjectMemoryScope, loadDurableProjectMemoryState, loadPersistentString, saveDurableProjectMemoryState, savePersistentString, updateDurableProjectMemoryMap } = deps;

    try {
      const scope = createDurableProjectMemoryScope(projectName, workspaceSettings);
      const state = loadDurableProjectMemoryState(scope, {
        read: loadPersistentString,
        write: savePersistentString,
      });
      const nextState = updateDurableProjectMemoryMap(state, {
        indexSummary: workspaceSettings.indexSummary,
        now: new Date().toISOString(),
        workspaceSettings,
      });

      if (nextState !== state) {
        saveDurableProjectMemoryState(nextState, {
          read: loadPersistentString,
          write: savePersistentString,
        });
      }
    } catch {
      return;
    }
  }

export function loadToolMemoryForProject(deps: WorkspaceRuntimeDeps, projectName: string, workspaceSettings: LocalWorkspaceSettings) {
  const { createToolMemoryScope, loadPersistentString, loadProjectToolMemoryState, savePersistentString } = deps;

    return loadProjectToolMemoryState(createToolMemoryScope(projectName, workspaceSettings), {
      read: loadPersistentString,
      write: savePersistentString,
    });
  }

export function saveToolMemoryForProject(deps: WorkspaceRuntimeDeps, state: ReturnType<typeof loadProjectToolMemoryState>) {
  const { loadPersistentString, savePersistentString, saveProjectToolMemoryState } = deps;

    saveProjectToolMemoryState(state, {
      read: loadPersistentString,
      write: savePersistentString,
    });
  }

export function createToolMemoryScope(deps: WorkspaceRuntimeDeps, projectName: string, workspaceSettings: LocalWorkspaceSettings) {
  const { createProjectToolMemoryScope, normalizeProjectName } = deps;

    return createProjectToolMemoryScope({
      projectName: normalizeProjectName(projectName),
      workspaceRoots: workspaceSettings.enabled ? workspaceSettings.roots : [],
    });
  }

export function getEnabledWorkspaceRoots(deps: WorkspaceRuntimeDeps, workspaceSettings: LocalWorkspaceSettings) {

    return workspaceSettings.enabled ? workspaceSettings.roots : [];
  }

export async function resolveEnabledWorkspaceRoots(deps: WorkspaceRuntimeDeps, workspaceSettings: LocalWorkspaceSettings) {
  const fallbackRoots = getEnabledWorkspaceRoots(deps, workspaceSettings);

    if (!workspaceSettings.enabled) {
      return [];
    }

    if (typeof deps.resolveLocalWorkspaceRoots !== "function") {
      return fallbackRoots;
    }

    try {
      const roots = await withWorkspaceRootResolutionTimeout(deps.resolveLocalWorkspaceRoots(workspaceSettings), fallbackRoots);
      const resolvedRoots = Array.isArray(roots)
        ? roots.filter((root): root is string => typeof root === "string" && root.trim().length > 0)
        : [];

      return resolvedRoots.length > 0 ? resolvedRoots : fallbackRoots;
    } catch {
      return fallbackRoots;
    }
  }

function withWorkspaceRootResolutionTimeout(promise: Promise<string[]>, fallbackRoots: string[]) {
    return Promise.race([
      promise,
      new Promise<string[]>((resolve) => {
        globalThis.setTimeout(() => resolve(fallbackRoots), WORKSPACE_ROOT_RESOLUTION_TIMEOUT_MS);
      }),
    ]);
  }

export function rememberProjectToolMemoryFromBridgeRun(deps: WorkspaceRuntimeDeps, chatId: string, workspaceSettings: LocalWorkspaceSettings, prompt: string, run: ToolBridgeExecutionBatch) {
  const { getToolMemoryProjectName, learnProjectToolMemoryFromBridgeRun, loadToolMemoryForProject, saveToolMemoryForProject } = deps;

    const projectName = getToolMemoryProjectName(chatId);
    const state = loadToolMemoryForProject(projectName, workspaceSettings);
    const nextState = learnProjectToolMemoryFromBridgeRun(state, run, { prompt });

    if (nextState !== state) {
      saveToolMemoryForProject(nextState);
    }
  }

export function rememberProjectToolMemoryFromChatToolCalls(deps: WorkspaceRuntimeDeps, chatId: string, workspaceSettings: LocalWorkspaceSettings, prompt: string, toolCalls: ChatToolCall[]) {
  const { getToolMemoryProjectName, learnProjectToolMemoryFromChatToolCalls, loadToolMemoryForProject, saveToolMemoryForProject } = deps;

    const projectName = getToolMemoryProjectName(chatId);
    const state = loadToolMemoryForProject(projectName, workspaceSettings);
    const nextState = learnProjectToolMemoryFromChatToolCalls(state, toolCalls, { prompt });

    if (nextState !== state) {
      saveToolMemoryForProject(nextState);
    }
  }

export function getToolMemoryProjectName(deps: WorkspaceRuntimeDeps, chatId: string) {
  const { activeChat, DEFAULT_PROJECT, pendingChatsRef } = deps;

    return pendingChatsRef.current.find((chat) => chat.id === chatId)?.project ?? activeChat?.project ?? DEFAULT_PROJECT;
  }

export async function createSourceControlContextMessages(deps: WorkspaceRuntimeDeps, _prompt: string) {

    return [];
  }

export function shouldSkipLocalContextForGithub(deps: WorkspaceRuntimeDeps, _prompt: string) {

    return false;
  }

export async function createLocalWorkspaceContextMessages(deps: WorkspaceRuntimeDeps, workspaceSettings: LocalWorkspaceSettings, prompt: string, projectName: string) {
  const { contextWindowRef, createLocalWorkspaceContext, createMessage, getAutomaticWorkspaceContextCharBudget, hasAnyLocalWorkspaceToolEnabled, syncLocalWorkspaceIndexSummary, toolSettings } = deps;

    if (!workspaceSettings.enabled || !hasAnyLocalWorkspaceToolEnabled()) {
      return [];
    }

    try {
      const localContext = await createLocalWorkspaceContext(workspaceSettings, prompt, toolSettings, {
        maxContextChars: getAutomaticWorkspaceContextCharBudget(contextWindowRef.current.tokens),
      });
      void syncLocalWorkspaceIndexSummary(projectName, workspaceSettings);
      return localContext.trim() ? [createMessage("user", localContext)] : [];
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Local computer file tool failed.";
      return [createMessage("user", `LOCAL COMPUTER FILE TOOL\nTool note: ${detail}\nContinue honestly and ask me to adjust local workspace access if needed.`)];
    }
  }

export function hasAnyLocalWorkspaceToolEnabled(deps: WorkspaceRuntimeDeps) {
  const { toolSettings } = deps;

    return (
      toolSettings.fileBrowser ||
      toolSettings.fileSearch ||
      toolSettings.codeView ||
      toolSettings.codeEdit ||
      toolSettings.fileCreation ||
      toolSettings.fileSafety ||
      toolSettings.desktopComputer ||
      toolSettings.testingTools ||
      toolSettings.typescriptTools ||
      toolSettings.sqlTools ||
      toolSettings.reactNativeTools ||
      toolSettings.codeGeneration ||
      toolSettings.sourceControl
    );
  }

export function getAutomaticWorkspaceContextCharBudget(deps: WorkspaceRuntimeDeps, contextWindowTokens: number) {

    const contextChars = Math.max(Math.round(contextWindowTokens || 0), 1) * 4;

    return Math.min(Math.max(Math.round(contextChars * 0.08), 24_000), 320_000);
  }

export async function syncLocalWorkspaceIndexSummary(deps: WorkspaceRuntimeDeps, projectName: string, workspaceSettings: LocalWorkspaceSettings) {
  const { getComputerFileIndexSummary, isActiveChatProject, localWorkspaceRef, rememberProjectMapSnapshot, resolveLocalWorkspaceRoots, samePathSet, saveWorkspaceForProject, setLocalWorkspace } = deps;

    try {
      const [roots, summary] = await Promise.all([resolveLocalWorkspaceRoots(workspaceSettings), getComputerFileIndexSummary()]);

      if (summary.entryCount <= 0 || !samePathSet(summary.roots, roots)) {
        return;
      }

      const nextWorkspace = {
        ...workspaceSettings,
        indexReason: undefined,
        indexSummary: summary,
        indexStatus: "idle" as const,
        indexUpdatedAt: new Date().toISOString(),
        lastError: undefined,
        roots: workspaceSettings.roots.length > 0 ? workspaceSettings.roots : roots,
      };

      if (isActiveChatProject(projectName)) {
        setLocalWorkspace((currentWorkspace) => {
          if (!samePathSet(currentWorkspace.roots, workspaceSettings.roots)) {
            return currentWorkspace;
          }

          localWorkspaceRef.current = nextWorkspace;
          return nextWorkspace;
        });
      }
      saveWorkspaceForProject(projectName, nextWorkspace);
      rememberProjectMapSnapshot(projectName, nextWorkspace);
    } catch {
      return;
    }
  }
