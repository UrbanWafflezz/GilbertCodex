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
import type { AppPersonalizationSettings, AppearanceMode, ProviderSettings, WebSearchSettings } from "../../../types/settings";
import type { ToolRegistrySettings } from "../../../types/tools";
import type { SettingsSectionId } from "../../../pages/settings/types";
import type { DiscordInteractionEvent } from "../../tauriClient";
import type { ActiveGeneration, ApprovedPlanExecutionContext, AssistantToolResponse, ComposerDraftRestoreRequest, DiscordReplyTarget, DiscordStreamUpdate, QueuedChatSend, SessionApprovalDecisionMap, SessionApprovalDecisionsByWorkspace, StartSendMessageOptions } from "../WorkspaceApp";
import type { WorkspaceRuntimeDeps } from "../runtimeTypes";

export async function handleRegenerateResponse(deps: WorkspaceRuntimeDeps, messageId: string) {
  const { activeChat, compactProviderMessages, createActiveGeneration, createActiveProjectBoundaryMessage, createContextCompactionProgress, createInterruptedResponseContextMessages, createLocalWorkspaceContextMessages, createPlanningAnswerMessages, createPlanningExecutionApproval, createPlanningProgress, createToolAwareProviderSettings, finishActiveGeneration, getLatestUserPrompt, getPlanningInputRequests, isAbortError, isChatSending, isInterruptedAssistantMessage, isRequestInactive, localWorkspaceRef, mergeAgentApprovals, mergeChatArtifacts, notifyRunComplete, notifyRunNeedsAttention, preserveVisibleResponseThinking, recordPlanningProviderRequest, recordPlanningProviderUsage, resolveWorkspaceForChatProject, runPlanningMode, setActiveChatId, setActiveGenerationTarget, setActiveRoute, setAgentRunCompleted, setAgentRunContinuing, setAgentRunFailed, setAgentRunWaiting, setChats, setNoticeDialog, sortChatsByUpdatedAt, stopStaleStreamingMessages, streamAssistantWithLocalTools, toolSettings, touchProject, updateGeneratedMessage, withContextCompactionMarker, withContextCompactionProgress, withLocalComputerProgress, withWebSearchProgress } = deps;

    if (!toolSettings.provider) {
      setNoticeDialog({
        description: "Turn Model Provider back on in Settings before regenerating a response.",
        title: "Model Provider is off",
      });
      return;
    }

    const currentChat = activeChat;

    if (isChatSending(currentChat.id)) {
      return;
    }

    const assistantMessageIndex = currentChat.messages.findIndex((message) => message.id === messageId && message.role === "assistant");
    const assistantMessage = assistantMessageIndex >= 0 ? currentChat.messages[assistantMessageIndex] : undefined;

    if (!assistantMessage || assistantMessage.isStreaming) {
      return;
    }

    const priorMessages = currentChat.messages.slice(0, assistantMessageIndex);
    const hasUserContext = priorMessages.some((message) => message.role === "user");

    if (!hasUserContext) {
      return;
    }

    const isPlanningMode = toolSettings.planning && (assistantMessage.mode === "plan" || Boolean(assistantMessage.planning));
    const answeredPlanningInputRequests = getPlanningInputRequests(assistantMessage.planning).filter((request) => request.answeredAt && request.answers?.length);
    const continueInterruptedResponse = isInterruptedAssistantMessage(assistantMessage);
    const regeneratePrompt = getLatestUserPrompt(priorMessages);
    const { controller, requestId } = createActiveGeneration(currentChat.id, currentChat, true);
    const now = new Date().toISOString();
    const regeneratedAssistantMessage: ChatMessage = {
      ...assistantMessage,
      artifacts: undefined,
      agentRunStatus: "running",
      approvals: continueInterruptedResponse ? assistantMessage.approvals : undefined,
      content: "",
      contextCompactions: undefined,
      createdAt: now,
      isStreaming: true,
      mode: isPlanningMode ? "plan" : "chat",
      planning: isPlanningMode
        ? {
            inputRequest: answeredPlanningInputRequests[answeredPlanningInputRequests.length - 1],
            inputRequests: answeredPlanningInputRequests,
            maxPasses: 1,
            passCount: 0,
            startedAt: now,
          }
        : undefined,
      progress: isPlanningMode ? createPlanningProgress("drafting") : undefined,
      sources: continueInterruptedResponse ? assistantMessage.sources : undefined,
      status: undefined,
      toolCalls: continueInterruptedResponse ? assistantMessage.toolCalls : undefined,
      webSearch: undefined,
    };
    setActiveGenerationTarget(requestId, currentChat.id, regeneratedAssistantMessage.id);

    setActiveChatId(currentChat.id);
    setActiveRoute("chat");
    setAgentRunContinuing(
      assistantMessage.agentRunId,
      continueInterruptedResponse ? "Continue interrupted response" : "Regenerate response",
      continueInterruptedResponse ? "Continuing from the saved partial response and tool results." : "Regenerating the assistant response.",
    );
    setChats((currentChats) =>
      sortChatsByUpdatedAt(
        currentChats.map((chat) =>
          chat.id === currentChat.id
            ? {
                ...chat,
                messages: [...currentChat.messages.slice(0, assistantMessageIndex), regeneratedAssistantMessage],
                updatedAt: now,
              }
            : chat,
        ),
      ),
    );
    stopStaleStreamingMessages(currentChat.id, regeneratedAssistantMessage.id);

    try {
      const workspaceSettings = resolveWorkspaceForChatProject(currentChat.project, localWorkspaceRef.current);
      const projectBoundaryMessage = createActiveProjectBoundaryMessage(currentChat.project, workspaceSettings);
      const localContextMessages = await createLocalWorkspaceContextMessages(workspaceSettings, regeneratePrompt, currentChat.project);
      const interruptedResponseContextMessages = continueInterruptedResponse
        ? createInterruptedResponseContextMessages(assistantMessage, regeneratePrompt)
        : [];
      const providerCompaction = compactProviderMessages(
        [
          ...priorMessages.filter((message) => message.status !== "error"),
          projectBoundaryMessage,
          ...localContextMessages,
          ...createPlanningAnswerMessages(answeredPlanningInputRequests),
          ...interruptedResponseContextMessages,
        ],
        createToolAwareProviderSettings({}, currentChat),
      );
      const messagesForProvider = providerCompaction.messages;

      if (providerCompaction.contextCompaction) {
        const compactionProgress = createContextCompactionProgress(providerCompaction);

        updateGeneratedMessage(currentChat.id, messageId, (message) => ({
          ...withContextCompactionMarker(message, providerCompaction.contextCompaction),
          progress: withContextCompactionProgress(compactionProgress, message.progress),
        }));
      }

      if (isPlanningMode) {
        const assistantResponse = await runPlanningMode({
          messages: messagesForProvider,
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
                        message.id === messageId
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

        const planApproval = assistantMessage.agentRunId ? createPlanningExecutionApproval(assistantMessage.agentRunId, messageId, assistantResponse.content, regeneratePrompt) : undefined;

        setChats((currentChats) =>
          sortChatsByUpdatedAt(
            currentChats.map((chat) =>
              chat.id === currentChat.id
                ? {
                    ...chat,
                    messages: chat.messages.map((message) =>
                      message.id === messageId
                        ? preserveVisibleResponseThinking(message, {
                            ...message,
                            agentRunStatus: planApproval ? "waiting_for_approval" : "completed",
                            approvals: planApproval ? mergeAgentApprovals(message.approvals ?? [], [planApproval]) : message.approvals,
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
        if (planApproval) {
          setAgentRunWaiting(assistantMessage.agentRunId, "Plan approval required", "Review the regenerated plan, then accept it or ask for another change.", [planApproval]);
          notifyRunNeedsAttention("A regenerated plan is ready for approval.");
          touchProject(currentChat.project);
          return;
        }

        setAgentRunCompleted(assistantMessage.agentRunId, {
          ...regeneratedAssistantMessage,
          agentRunStatus: "completed",
          content: assistantResponse.content,
          isStreaming: false,
          planning: regeneratedAssistantMessage.planning
            ? {
                ...regeneratedAssistantMessage.planning,
                completedAt: new Date().toISOString(),
                passCount: 1,
                planContent: assistantResponse.content,
              }
            : undefined,
        });
        notifyRunComplete({
          ...regeneratedAssistantMessage,
          agentRunStatus: "completed",
          content: assistantResponse.content,
          isStreaming: false,
          planning: regeneratedAssistantMessage.planning
            ? {
                ...regeneratedAssistantMessage.planning,
                completedAt: new Date().toISOString(),
                passCount: 1,
                planContent: assistantResponse.content,
              }
            : undefined,
        });
      } else {
        const assistantResponse = await streamAssistantWithLocalTools({
          chatId: currentChat.id,
          controller,
          messageId,
          messagesForProvider,
          prompt: regeneratePrompt,
          requestId,
          runId: assistantMessage.agentRunId,
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
                      message.id === messageId
                        ? preserveVisibleResponseThinking(message, {
                            ...message,
                            agentRunStatus: assistantResponse.waitingForApproval ? "waiting_for_approval" : "completed",
                            approvals: assistantResponse.approvalRequests && assistantResponse.approvalRequests.length > 0
                              ? mergeAgentApprovals(message.approvals ?? [], assistantResponse.approvalRequests)
                              : message.approvals,
                            artifacts: mergeChatArtifacts(message.artifacts, assistantResponse.artifacts),
                            content: assistantResponse.content,
                            isStreaming: false,
                            progress: withLocalComputerProgress(assistantResponse.progress, message.progress),
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
        if (assistantResponse.waitingForApproval) {
          setAgentRunWaiting(
            assistantMessage.agentRunId,
            "Tool approval required",
            "Review the pending tool action, then allow, deny, or approve edited arguments to continue the same run.",
            assistantResponse.approvalRequests ?? [],
            assistantResponse.pendingToolCallContent,
          );
          notifyRunNeedsAttention("A tool action is waiting for your approval.");
          touchProject(currentChat.project);
          return;
        }

        setAgentRunCompleted(assistantMessage.agentRunId, {
          ...regeneratedAssistantMessage,
          agentRunStatus: "completed",
          artifacts: mergeChatArtifacts(regeneratedAssistantMessage.artifacts, assistantResponse.artifacts),
          content: assistantResponse.content,
          isStreaming: false,
          toolCalls: assistantResponse.toolCalls ?? regeneratedAssistantMessage.toolCalls,
        });
        notifyRunComplete({
          ...regeneratedAssistantMessage,
          agentRunStatus: "completed",
          artifacts: mergeChatArtifacts(regeneratedAssistantMessage.artifacts, assistantResponse.artifacts),
          content: assistantResponse.content,
          isStreaming: false,
          toolCalls: assistantResponse.toolCalls ?? regeneratedAssistantMessage.toolCalls,
        });
      }
      touchProject(currentChat.project);
    } catch (error) {
      if (isAbortError(error) || isRequestInactive(requestId, controller)) {
        return;
      }

      const errorContent = error instanceof Error ? error.message : "The regeneration request failed.";

      setChats((currentChats) =>
        sortChatsByUpdatedAt(
          currentChats.map((chat) =>
            chat.id === currentChat.id
              ? {
                  ...chat,
                  messages: chat.messages.map((message) =>
                    message.id === messageId
                      ? {
                          ...message,
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
      setAgentRunFailed(assistantMessage.agentRunId, errorContent);
      notifyRunNeedsAttention(errorContent);
      touchProject(currentChat.project);
    } finally {
      finishActiveGeneration(requestId);
    }
  }
