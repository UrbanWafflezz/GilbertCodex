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

export function isChatSending(deps: WorkspaceRuntimeDeps, chatId: string | undefined) {
  const { activeGenerationsRef } = deps;

    return Boolean(chatId && activeGenerationsRef.current.has(chatId));
  }

export function isAnyChatSending(deps: WorkspaceRuntimeDeps, chatIds: Iterable<string>) {
  const { isChatSending } = deps;

    for (const chatId of chatIds) {
      if (isChatSending(chatId)) {
        return true;
      }
    }

    return false;
  }

export function getSendingChatIds(deps: WorkspaceRuntimeDeps, chatIds: Iterable<string>) {
  const { isChatSending } = deps;

    return [...new Set([...chatIds].filter((chatId) => isChatSending(chatId)))];
  }

export function setChatSending(deps: WorkspaceRuntimeDeps, chatId: string, sending: boolean) {
  const { setSendingChatIds } = deps;

    setSendingChatIds((currentIds) => {
      const hasChatId = currentIds.includes(chatId);

      if (sending) {
        return hasChatId ? currentIds : [...currentIds, chatId];
      }

      return hasChatId ? currentIds.filter((id) => id !== chatId) : currentIds;
    });
  }

export function getActiveGenerationByRequest(deps: WorkspaceRuntimeDeps, requestId: number) {
  const { activeGenerationsRef, activeRequestChatIdsRef } = deps;

    const chatId = activeRequestChatIdsRef.current.get(requestId);

    return chatId ? activeGenerationsRef.current.get(chatId) : undefined;
  }

export function getActiveGenerationByMessage(deps: WorkspaceRuntimeDeps, messageId: string | undefined) {
  const { activeGenerationsRef } = deps;

    if (!messageId) {
      return undefined;
    }

    for (const activeGeneration of activeGenerationsRef.current.values()) {
      if (activeGeneration.messageId === messageId) {
        return activeGeneration;
      }
    }

    return undefined;
  }

export function createActiveGeneration(deps: WorkspaceRuntimeDeps, chatId: string, previousChat: ChatSummary, previousChatExisted: boolean, restoreDraft: ChatComposerDraft, target: { messageId: string }) {
  const { activeGenerationsRef, activeRequestChatIdsRef, activeSendRef, setChatSending } = deps;

    const requestId = activeSendRef.current + 1;
    const controller = new AbortController();

    activeSendRef.current = requestId;
    activeRequestChatIdsRef.current.set(requestId, chatId);
    activeGenerationsRef.current.set(chatId, {
      chatId,
      controller,
      messageId: target?.messageId,
      previousChat,
      previousChatExisted,
      requestId,
      restoreDraft,
    });
    setChatSending(chatId, true);

    return { controller, requestId };
  }

export function setActiveGenerationTarget(deps: WorkspaceRuntimeDeps, requestId: number, chatId: string, messageId: string) {
  const { getActiveGenerationByRequest } = deps;

    const activeGeneration = getActiveGenerationByRequest(requestId);

    if (!activeGeneration || activeGeneration.chatId !== chatId || activeGeneration.requestId !== requestId) {
      return;
    }

    activeGeneration.messageId = messageId;
  }

export function isRequestInactive(deps: WorkspaceRuntimeDeps, requestId: number, controller: AbortController) {
  const { getActiveGenerationByRequest } = deps;

    const activeGeneration = getActiveGenerationByRequest(requestId);

    return controller.signal.aborted || !activeGeneration || activeGeneration.requestId !== requestId;
  }

export function finishActiveGeneration(deps: WorkspaceRuntimeDeps, requestId: number) {
  const { activeGenerationsRef, activeRequestChatIdsRef, getActiveGenerationByRequest, setChatSending } = deps;

    const activeGeneration = getActiveGenerationByRequest(requestId);

    if (activeGeneration?.requestId === requestId) {
      activeGenerationsRef.current.delete(activeGeneration.chatId);
      activeRequestChatIdsRef.current.delete(requestId);
      setChatSending(activeGeneration.chatId, false);
    }
  }

export function handleStopGeneration(deps: WorkspaceRuntimeDeps, messageId: unknown) {
  const { activeChat, activeGenerationsRef, getActiveGenerationByMessage, stopActiveGeneration } = deps;

    const requestedMessageId = typeof messageId === "string" ? messageId : undefined;
    const activeGeneration = requestedMessageId ? getActiveGenerationByMessage(requestedMessageId) : activeGenerationsRef.current.get(activeChat.id);
    const targetMessageId = requestedMessageId ?? activeGeneration?.messageId;
    stopActiveGeneration({ activeGeneration, messageId: targetMessageId, restoreDraft: !targetMessageId });
  }

export function stopActiveGeneration(deps: WorkspaceRuntimeDeps, { activeGeneration, messageId, restoreDraft }: { activeGeneration?: ActiveGeneration; messageId?: string; restoreDraft: boolean }) {
  const { activeChat, activeGenerationsRef, activeRequestChatIdsRef, createId, getActiveGenerationByMessage, preserveQueuedMessagesForSnapshot, restoreChatSnapshot, setChatSending, setComposerDraftToRestore, stopStaleStreamingMessages, stopStreamingMessage } = deps;

    const generationToStop = activeGeneration ?? getActiveGenerationByMessage(messageId);

    if (!generationToStop) {
      if (messageId) {
        stopStreamingMessage(messageId);
      } else {
        stopStaleStreamingMessages(activeChat.id);
      }
      return;
    }

    const isTargetedStop = Boolean(messageId);
    const stopMatchesActiveGeneration = !messageId || !generationToStop.messageId || generationToStop.messageId === messageId;

    if (!stopMatchesActiveGeneration) {
      stopStreamingMessage(messageId);
      return;
    }

    generationToStop.controller.abort();

    if (restoreDraft && generationToStop.restoreDraft) {
      setComposerDraftToRestore({
        draft: generationToStop.restoreDraft,
        id: createId("composer-restore"),
      });
    }

    if (isTargetedStop && messageId) {
      stopStreamingMessage(messageId);
    } else {
      restoreChatSnapshot(preserveQueuedMessagesForSnapshot(generationToStop.previousChat), generationToStop.previousChatExisted);
    }

    activeGenerationsRef.current.delete(generationToStop.chatId);
    activeRequestChatIdsRef.current.delete(generationToStop.requestId);
    setChatSending(generationToStop.chatId, false);
  }

export function stopStreamingMessage(deps: WorkspaceRuntimeDeps, messageId: string) {
  const { pendingChatsRef, setAgentRunCancelled, setChats, stopStreamingAssistantMessage } = deps;

    const stoppedRunId = pendingChatsRef.current.flatMap((chat) => chat.messages).find((message) => message.id === messageId && message.role === "assistant" && message.isStreaming)?.agentRunId;

    setChats((currentChats) => {
      let changed = false;
      const stoppedAt = new Date().toISOString();
      const nextChats = currentChats.map((chat) => {
        let chatChanged = false;
        const nextMessages = chat.messages.map((message) => {
          if (message.id !== messageId || message.role !== "assistant" || !message.isStreaming) {
            return message;
          }

          changed = true;
          chatChanged = true;
          return stopStreamingAssistantMessage(message, stoppedAt);
        });

        return chatChanged
          ? {
              ...chat,
              messages: nextMessages,
              updatedAt: stoppedAt,
            }
          : chat;
      });

      if (!changed) {
        return currentChats;
      }

      pendingChatsRef.current = nextChats;
      return nextChats;
    });

    setAgentRunCancelled(stoppedRunId, "Response stopped.");
  }

export function stopStaleStreamingMessages(deps: WorkspaceRuntimeDeps, chatId: string, exceptMessageId: string) {
  const { pendingChatsRef, setAgentRunCancelled, setChats, stopStreamingAssistantMessage } = deps;

    const stoppedRunIds = new Set(
      pendingChatsRef.current
        .filter((chat) => chat.id === chatId)
        .flatMap((chat) => chat.messages)
        .filter((message) => message.role === "assistant" && message.isStreaming && message.id !== exceptMessageId && message.agentRunId)
        .map((message) => message.agentRunId!),
    );

    setChats((currentChats) => {
      let changed = false;
      const stoppedAt = new Date().toISOString();
      const nextChats = currentChats.map((chat) => {
        if (chat.id !== chatId) {
          return chat;
        }

        let chatChanged = false;
        const nextMessages = chat.messages.map((message) => {
          if (message.role !== "assistant" || !message.isStreaming || message.id === exceptMessageId) {
            return message;
          }

          changed = true;
          chatChanged = true;
          return stopStreamingAssistantMessage(message, stoppedAt);
        });

        return chatChanged
          ? {
              ...chat,
              messages: nextMessages,
              updatedAt: stoppedAt,
            }
          : chat;
      });

      if (!changed) {
        return currentChats;
      }

      pendingChatsRef.current = nextChats;
      return nextChats;
    });

    stoppedRunIds.forEach((runId) => setAgentRunCancelled(runId, "Stale response stopped before starting the next message."));
  }

export function stopStreamingAssistantMessage(deps: WorkspaceRuntimeDeps, message: ChatMessage, stoppedAt: string): ChatMessage {
  const { completeActiveProgress } = deps;

    return {
      ...message,
      agentRunStatus: message.agentRunStatus === "running" || message.agentRunStatus === "queued" ? "cancelled" : message.agentRunStatus,
      isStreaming: false,
      progress: completeActiveProgress(message.progress),
      toolCalls: message.toolCalls?.map((toolCall) =>
        toolCall.status === "active"
          ? {
              ...toolCall,
              detail: toolCall.detail ?? "Stopped.",
              status: "error",
              terminal: toolCall.terminal
                ? {
                    ...toolCall.terminal,
                    live: false,
                  }
                : toolCall.terminal,
            }
          : toolCall,
      ),
    };
  }

export function completeActiveProgress(deps: WorkspaceRuntimeDeps, progress: ChatProgressItem[] | undefined) {

    const nextProgress = (progress ?? []).map((item) =>
      item.status === "active"
        ? {
            ...item,
            detail: item.detail ?? "Stopped.",
            status: "complete" as const,
          }
        : item,
    );

    return nextProgress.length > 0 ? nextProgress : undefined;
  }

export function preserveQueuedMessagesForSnapshot(deps: WorkspaceRuntimeDeps, chatSnapshot: ChatSummary) {
  const { pendingChatsRef, queuedChatSendsRef } = deps;

    const queuedMessageIds = new Set(queuedChatSendsRef.current.filter((queuedSend) => queuedSend.chatId === chatSnapshot.id).map((queuedSend) => queuedSend.userMessageId));

    if (queuedMessageIds.size === 0) {
      return chatSnapshot;
    }

    const snapshotMessageIds = new Set(chatSnapshot.messages.map((message) => message.id));
    const liveChat = pendingChatsRef.current.find((chat) => chat.id === chatSnapshot.id);
    const queuedMessagesToKeep = liveChat?.messages.filter((message) => queuedMessageIds.has(message.id) && !snapshotMessageIds.has(message.id)) ?? [];

    if (queuedMessagesToKeep.length === 0) {
      return chatSnapshot;
    }

    return {
      ...chatSnapshot,
      messages: [...chatSnapshot.messages, ...queuedMessagesToKeep],
      updatedAt: new Date().toISOString(),
    };
  }

export function restoreChatSnapshot(deps: WorkspaceRuntimeDeps, chatSnapshot: ChatSummary, existed: boolean) {
  const { pendingChatsRef, setChats, sortChatsByUpdatedAt } = deps;

    setChats((currentChats) => {
      const otherChats = currentChats.filter((chat) => chat.id !== chatSnapshot.id);

      const nextChats = sortChatsByUpdatedAt(existed ? [chatSnapshot, ...otherChats] : otherChats);
      pendingChatsRef.current = nextChats;
      return nextChats;
    });
  }

export function updateQueuedChatSends(deps: WorkspaceRuntimeDeps, updater: (currentQueue: QueuedChatSend[]) => QueuedChatSend[]) {
  const { queuedChatSendsRef, setQueuedChatSends } = deps;

    setQueuedChatSends((currentQueue) => {
      const nextQueue = updater(currentQueue);
      queuedChatSendsRef.current = nextQueue;
      return nextQueue;
    });
  }

export function scheduleGeneratedChatTitle(deps: WorkspaceRuntimeDeps, {
    attachments,
    chatId,
    content,
    fallbackTitle,
    settings,
    userMessageId,
  }: {
    attachments: ChatAttachment[];
    chatId: string;
    content: string;
    fallbackTitle: string;
    settings: ProviderSettings;
    userMessageId: string;
  }) {
  const { applyGeneratedChatTitle, generateChatTitle, titleGenerationRequestsRef } = deps;

    titleGenerationRequestsRef.current.get(chatId)?.abort();

    const controller = new AbortController();
    titleGenerationRequestsRef.current.set(chatId, controller);

    void generateChatTitle(settings, { attachments, content }, { signal: controller.signal })
      .then((generatedTitle) => {
        if (controller.signal.aborted || titleGenerationRequestsRef.current.get(chatId) !== controller) {
          return;
        }

        applyGeneratedChatTitle({
          chatId,
          fallbackTitle,
          title: generatedTitle,
          userMessageId,
        });
      })
      .catch(() => {
        if (controller.signal.aborted || titleGenerationRequestsRef.current.get(chatId) !== controller) {
          return;
        }

        applyGeneratedChatTitle({
          chatId,
          fallbackTitle,
          title: fallbackTitle,
          userMessageId,
        });
      })
      .finally(() => {
        if (titleGenerationRequestsRef.current.get(chatId) === controller) {
          titleGenerationRequestsRef.current.delete(chatId);
        }
      });
  }

export function applyGeneratedChatTitle(deps: WorkspaceRuntimeDeps, {
    chatId,
    fallbackTitle,
    title,
    userMessageId,
  }: {
    chatId: string;
    fallbackTitle: string;
    title: string;
    userMessageId: string;
  }) {
  const { PENDING_CHAT_TITLE, pendingChatsRef, setChats } = deps;

    const cleanTitle = title.trim();

    if (!cleanTitle) {
      return;
    }

    setChats((currentChats) => {
      let changed = false;
      const nextChats = currentChats.map((chat) => {
        if (chat.id !== chatId || chat.archived) {
          return chat;
        }

        const firstUserMessage = chat.messages.find((message) => message.role === "user");

        if (firstUserMessage?.id !== userMessageId) {
          return chat;
        }

        if (chat.title !== PENDING_CHAT_TITLE && chat.title !== fallbackTitle && chat.title !== "New chat") {
          return chat;
        }

        if (chat.title === cleanTitle) {
          return chat;
        }

        changed = true;
        return {
          ...chat,
          title: cleanTitle,
        };
      });

      if (!changed) {
        return currentChats;
      }

      pendingChatsRef.current = nextChats;
      return nextChats;
    });
  }

export function shouldPreserveExistingTitleAfterUserEdit(deps: WorkspaceRuntimeDeps, chat: ChatSummary, userMessage: ChatMessage) {
  const { PENDING_CHAT_TITLE, titleFromMessage } = deps;

    const title = chat.title.trim();

    if (!title || title === PENDING_CHAT_TITLE || title === "New chat") {
      return false;
    }

    return title !== titleFromMessage(userMessage.content, userMessage.attachments ?? []);
  }

export function enqueueChatSend(deps: WorkspaceRuntimeDeps, input: ChatSendInput) {
  const { activeChat, createChatProviderSettings, createEmptyChat, createId, createMessage, DEFAULT_PROJECT, PENDING_CHAT_TITLE, pendingChatsRef, resolveChatResearchReferences, setActiveChatId, setActiveRoute, setChats, sortChatsByUpdatedAt, touchProject, updateQueuedChatSends } = deps;

    const content = input.content.trim();
    const attachments = input.attachments;

    if (!content && attachments.length === 0) {
      return;
    }

    const currentChat = activeChat ?? createEmptyChat(DEFAULT_PROJECT);
    const now = new Date().toISOString();
    const effectiveProviderSettings = createChatProviderSettings(currentChat);
    const researchReferences = resolveChatResearchReferences(
      {
        ...input,
        content,
      },
      currentChat.id,
    );
    const userMessage = {
      ...createMessage("user", content, "queued", undefined, attachments),
      createdAt: now,
      researchReferences: researchReferences.length > 0 ? researchReferences : undefined,
    };
    const queuedSend: QueuedChatSend = {
      chatId: currentChat.id,
      id: createId("queued-send"),
      input: {
        ...input,
        content,
      },
      userMessageId: userMessage.id,
    };

    updateQueuedChatSends((currentQueue) => [...currentQueue, queuedSend]);
    setActiveChatId(currentChat.id);
    setActiveRoute("chat");
    setChats((currentChats) => {
      const chatForQueue = currentChats.find((chat) => chat.id === currentChat.id) ?? currentChat;
      const hasCurrentChat = currentChats.some((chat) => chat.id === currentChat.id);
      const shouldGenerateTitle = chatForQueue.messages.length === 0;
      const updatedChat: ChatSummary = {
        ...chatForQueue,
        isDraft: undefined,
        messages: [...chatForQueue.messages, userMessage],
        model: effectiveProviderSettings.model,
        provider: effectiveProviderSettings.provider,
        title: shouldGenerateTitle ? PENDING_CHAT_TITLE : chatForQueue.title,
        updatedAt: now,
      };
      const nextChats = sortChatsByUpdatedAt(hasCurrentChat ? currentChats.map((chat) => (chat.id === currentChat.id ? updatedChat : chat)) : [updatedChat, ...currentChats]);

      pendingChatsRef.current = nextChats;
      return nextChats;
    });
    touchProject(currentChat.project);
    return userMessage.id;
  }

export function handleDeleteQueuedMessage(deps: WorkspaceRuntimeDeps, messageId: string) {
  const { pendingChatsRef, queuedChatSendsRef, setChats, updateQueuedChatSends } = deps;

    const queuedSend = queuedChatSendsRef.current.find((candidate) => candidate.userMessageId === messageId);

    if (!queuedSend) {
      return;
    }

    updateQueuedChatSends((currentQueue) => currentQueue.filter((candidate) => candidate.userMessageId !== messageId));
    setChats((currentChats) => {
      const nextChats = currentChats.map((chat) =>
        chat.id === queuedSend.chatId
          ? {
              ...chat,
              messages: chat.messages.filter((message) => message.id !== messageId),
              updatedAt: new Date().toISOString(),
            }
          : chat,
      );

      pendingChatsRef.current = nextChats;
      return nextChats;
    });
  }

export function handleHoldQueuedMessage(deps: WorkspaceRuntimeDeps, messageId: string, held: boolean) {
  const { updateQueuedChatSends } = deps;

    updateQueuedChatSends((currentQueue) =>
      currentQueue.map((queuedSend) =>
        queuedSend.userMessageId === messageId
          ? {
              ...queuedSend,
              held,
            }
          : queuedSend,
      ),
    );
  }

export function handleUpdateQueuedMessage(deps: WorkspaceRuntimeDeps, messageId: string, content: string) {
  const { pendingChatsRef, queuedChatSendsRef, resolveChatResearchReferences, setChats, updateQueuedChatSends } = deps;

    const trimmedContent = content.trim();
    const queuedSend = queuedChatSendsRef.current.find((candidate) => candidate.userMessageId === messageId);

    if (!queuedSend || !trimmedContent) {
      return;
    }

    const researchReferences = resolveChatResearchReferences(
      {
        ...queuedSend.input,
        content: trimmedContent,
      },
      queuedSend.chatId,
    );

    updateQueuedChatSends((currentQueue) =>
      currentQueue.map((candidate) =>
        candidate.userMessageId === messageId
          ? {
              ...candidate,
              input: {
                ...candidate.input,
                content: trimmedContent,
              },
            }
          : candidate,
      ),
    );
    setChats((currentChats) => {
      const nextChats = currentChats.map((chat) =>
        chat.id === queuedSend.chatId
          ? {
              ...chat,
              messages: chat.messages.map((message) =>
                message.id === messageId
                  ? {
                      ...message,
                      content: trimmedContent,
                      researchReferences: researchReferences.length > 0 ? researchReferences : undefined,
                    }
                  : message,
              ),
              updatedAt: new Date().toISOString(),
            }
          : chat,
      );

      pendingChatsRef.current = nextChats;
      return nextChats;
    });
  }

export async function handleEditUserMessageAndRegenerate(deps: WorkspaceRuntimeDeps, messageId: string, content: string) {
  const { activeChat, activeGenerationsRef, activeRequestChatIdsRef, agentRunsRef, getRuntimeWebSearchSettings, localWorkspaceRef, pendingChatsRef, providerSettings, setAgentRunCancelled, setChatSending, setNoticeDialog, shouldPreserveExistingTitleAfterUserEdit, startSendMessage, toolSettings, updateQueuedChatSends } = deps;

    const currentChat = pendingChatsRef.current.find((chat) => chat.id === activeChat.id && chat.messages.some((message) => message.id === messageId)) ?? activeChat;
    const userMessageIndex = currentChat.messages.findIndex((message) => message.id === messageId && message.role === "user" && message.status !== "queued");
    const userMessage = userMessageIndex >= 0 ? currentChat.messages[userMessageIndex] : undefined;

    if (!userMessage || userMessage.role !== "user") {
      return;
    }

    const trimmedContent = content.trim();
    const attachments = userMessage.attachments ?? [];

    if (!trimmedContent && attachments.length === 0) {
      return;
    }

    if (!toolSettings.provider) {
      setNoticeDialog({
        description: "Turn Model Provider back on in Settings before resending an edited message.",
        title: "Model Provider is off",
      });
      return;
    }

    const messagesAfterUser = currentChat.messages.slice(userMessageIndex + 1);
    const removedMessageIds = new Set(messagesAfterUser.map((message) => message.id));
    const staleAssistantMessage = messagesAfterUser.find((message) => message.role === "assistant");
    const activeGeneration = activeGenerationsRef.current.get(currentChat.id);

    if (activeGeneration) {
      const activeRunId =
        messagesAfterUser.find((message) => message.id === activeGeneration.messageId && message.role === "assistant")?.agentRunId ??
        messagesAfterUser.find((message) => message.role === "assistant" && message.isStreaming)?.agentRunId;

      activeGeneration.controller.abort();
      activeGenerationsRef.current.delete(activeGeneration.chatId);
      activeRequestChatIdsRef.current.delete(activeGeneration.requestId);
      setChatSending(activeGeneration.chatId, false);

      if (activeRunId) {
        setAgentRunCancelled(activeRunId, "Response replaced after editing the user message.");
      }
    }

    if (removedMessageIds.size > 0) {
      updateQueuedChatSends((currentQueue) => currentQueue.filter((queuedSend) => queuedSend.chatId !== currentChat.id || !removedMessageIds.has(queuedSend.userMessageId)));
    }

    const staleRun = staleAssistantMessage?.agentRunId ? agentRunsRef.current.find((run) => run.id === staleAssistantMessage.agentRunId) : undefined;
    const runtimeWebSearchSettings = getRuntimeWebSearchSettings(providerSettings, staleAssistantMessage?.webSearch ?? providerSettings.webSearch);
    const editedWebSearch = staleAssistantMessage?.webSearch?.enabled || providerSettings.webSearch.enabled
      ? {
          enabled: true,
          maxResults: runtimeWebSearchSettings.maxResults,
          provider: runtimeWebSearchSettings.provider,
        }
      : undefined;
    const sourceChatForEdit: ChatSummary = {
      ...currentChat,
      messages: currentChat.messages.slice(0, userMessageIndex + 1),
    };

    await startSendMessage(
      {
        attachments,
        content: trimmedContent,
        localWorkspace: staleRun?.localWorkspace ?? localWorkspaceRef.current,
        mode: staleAssistantMessage?.mode === "plan" || staleAssistantMessage?.planning ? "plan" : userMessage.mode,
        referencedChatIds: userMessage.researchReferences?.map((reference) => reference.chatId),
        webSearch: editedWebSearch,
      },
      {
        chatId: currentChat.id,
        queuedMessageId: userMessage.id,
      },
      {
        preserveExistingTitle: shouldPreserveExistingTitleAfterUserEdit(currentChat, userMessage),
        sourceChat: sourceChatForEdit,
        userMessageSource: userMessage.source,
      },
    );
  }

export function handleSteerQueuedMessage(deps: WorkspaceRuntimeDeps, messageId: string, contentOverride: string) {
  const { activeGenerationsRef, findActiveAssistantMessageIndex, handleHoldQueuedMessage, handleUpdateQueuedMessage, pendingChatsRef, queuedChatSendsRef, steerActiveResponse } = deps;

    const queuedSend = queuedChatSendsRef.current.find((candidate) => candidate.userMessageId === messageId);
    const activeGeneration = queuedSend ? activeGenerationsRef.current.get(queuedSend.chatId) : undefined;

    if (!queuedSend || !activeGeneration) {
      if (queuedSend && contentOverride?.trim()) {
        handleUpdateQueuedMessage(messageId, contentOverride);
        handleHoldQueuedMessage(messageId, false);
      }
      return;
    }

    const currentChat = pendingChatsRef.current.find((chat) => chat.id === queuedSend.chatId && !chat.archived);
    const assistantMessageIndex = currentChat ? findActiveAssistantMessageIndex(currentChat.messages) : -1;

    if (!currentChat || assistantMessageIndex < 0) {
      return;
    }

    void steerActiveResponse({
      activeGeneration,
      assistantMessageIndex,
      contentOverride,
      currentChat,
      queuedSend,
    });
  }
