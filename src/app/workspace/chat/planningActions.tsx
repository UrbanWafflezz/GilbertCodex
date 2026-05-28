// @ts-nocheck
import type { SetStateAction } from "react";

import type { AgentRuntimeDecision } from "../../../agentRuntime/codingAgent";
import type { LocalComputerToolExecutionPolicy, LocalSubagentResult, LocalSubagentTask } from "../../../localWorkspace/localToolRuntimeDisabled";
import type { ContextCompactionNotice, ContextWindowUsage, ModelContextWindowMap, compactMessagesForContext } from "../../../lib/contextWindow";
import type { PlanningProviderRequest } from "../../../services/planningClient";
import { formatProviderErrorForUser } from "../../../services/providerErrors";
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

export async function handleSubmitPlanningInput(deps: WorkspaceRuntimeDeps, messageId: string, answers: ChatPlanningInputAnswer[]) {
  const { activeChat, compactProviderMessages, createActiveGeneration, createContextCompactionProgress, createId, createPlanningAnswerMessages, createPlanningExecutionApproval, createPlanningInputRequest, createPlanningProgress, createToolAwareProviderSettings, finishActiveGeneration, getLatestUserPrompt, getPendingPlanningInputRequest, getPlanningInputRequests, isAbortError, isChatSending, isRequestInactive, markPlanningInputAnswered, MAX_PLANNING_INPUT_ROUNDS, mergeAgentApprovals, notifyPlanningInputNeeded, notifyRunComplete, notifyRunNeedsAttention, preserveVisibleResponseThinking, recordPlanningProviderRequest, recordPlanningProviderUsage, runPlanningMode, setActiveChatId, setActiveRoute, setAgentRunWaiting, setChats, setNoticeDialog, sortChatsByUpdatedAt, toolSettings, touchProject, updateAgentRun, withContextCompactionMarker, withContextCompactionProgress, withWebSearchProgress } = deps;

    if (!toolSettings.provider) {
      setNoticeDialog({
        description: "Turn Model Provider back on in Settings before continuing a planning run.",
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
    const inputRequest = getPendingPlanningInputRequest(assistantMessage?.planning);

    if (!assistantMessage || !inputRequest) {
      return;
    }

    const { controller, requestId } = createActiveGeneration(currentChat.id, currentChat, true, undefined, {
      messageId,
    });
    const now = new Date().toISOString();
    const planningInputRequests = getPlanningInputRequests(assistantMessage.planning);
    const answeredInputRequests = markPlanningInputAnswered(planningInputRequests, inputRequest.id, answers, now);
    const providerCompaction = compactProviderMessages(
      [
        ...currentChat.messages.slice(0, assistantMessageIndex).filter((message) => message.status !== "error"),
        ...createPlanningAnswerMessages(answeredInputRequests),
      ],
      createToolAwareProviderSettings({}, currentChat),
    );
    const messagesForProvider = providerCompaction.messages;
    const compactionProgress = providerCompaction.contextCompaction ? createContextCompactionProgress(providerCompaction) : undefined;

    setActiveChatId(currentChat.id);
    setActiveRoute("chat");
    updateAgentRun(assistantMessage.agentRunId, (run, startedAt) => ({
      ...run,
      events: [
        ...run.events,
        {
          at: startedAt,
          id: createId("agent-event"),
          label: "Planning input submitted",
          type: "resume",
        },
      ],
      status: "running",
      steps: [
        ...run.steps,
        {
          id: createId("agent-step"),
          label: "Continue planning",
          startedAt,
          status: "running",
          type: "planning",
        },
      ],
      updatedAt: startedAt,
    }));

    setChats((currentChats) =>
      currentChats.map((chat) =>
        chat.id === currentChat.id
          ? {
              ...chat,
              messages: chat.messages.map((message) =>
                message.id === messageId
                  ? {
                      ...withContextCompactionMarker(message, providerCompaction.contextCompaction),
                      isStreaming: true,
                      planning: message.planning
                        ? {
                            ...message.planning,
                            inputRequest: {
                              ...inputRequest,
                              answeredAt: now,
                              answers,
                            },
                            inputRequests: answeredInputRequests,
                          }
                        : undefined,
                      progress: compactionProgress
                        ? withContextCompactionProgress(compactionProgress, withWebSearchProgress(message.webSearch, createPlanningProgress("drafting")))
                        : withWebSearchProgress(message.webSearch, createPlanningProgress("drafting")),
                      status: undefined,
                    }
                  : message,
              ),
              updatedAt: now,
            }
          : chat,
      ),
    );

    try {
      if (answeredInputRequests.length < MAX_PLANNING_INPUT_ROUNDS) {
        const followUpInputRequest = await createPlanningInputRequest(createToolAwareProviderSettings({}, currentChat), messagesForProvider, {
          onProviderRequest: (request) => recordPlanningProviderRequest(currentChat.id, request),
          onProviderUsage: (request, usage) => recordPlanningProviderUsage(currentChat.id, request, usage),
          signal: controller.signal,
        });

        if (isRequestInactive(requestId, controller)) {
          return;
        }

        if (followUpInputRequest) {
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
                              agentRunStatus: "waiting_for_approval",
                              isStreaming: false,
                              planning: message.planning
                                ? {
                                    ...message.planning,
                                    inputRequest: followUpInputRequest,
                                    inputRequests: [...answeredInputRequests, followUpInputRequest],
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
          setAgentRunWaiting(assistantMessage.agentRunId, "Planning input needed", followUpInputRequest.detail || followUpInputRequest.title);
          touchProject(currentChat.project);
          notifyPlanningInputNeeded(followUpInputRequest);
          return;
        }
      }

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

      const prompt = getLatestUserPrompt(currentChat.messages.slice(0, assistantMessageIndex));
      const planApproval = assistantMessage.agentRunId ? createPlanningExecutionApproval(assistantMessage.agentRunId, messageId, assistantResponse.content, prompt) : undefined;

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
        setAgentRunWaiting(assistantMessage.agentRunId, "Plan approval required", "Approve the plan to hand it into the executable agent loop.", [planApproval]);
        touchProject(currentChat.project);
        notifyRunNeedsAttention("A plan is ready for approval before execution.");
        return;
      }

      touchProject(currentChat.project);
      notifyRunComplete({
        ...assistantMessage,
        content: assistantResponse.content,
        isStreaming: false,
        planning: assistantMessage.planning
          ? {
              ...assistantMessage.planning,
              completedAt: new Date().toISOString(),
              passCount: 1,
              planContent: assistantResponse.content,
            }
          : undefined,
      });
    } catch (error) {
      if (isAbortError(error) || isRequestInactive(requestId, controller)) {
        return;
      }

      const errorContent = formatProviderErrorForUser(error, "The planning request failed.");

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
      touchProject(currentChat.project);
      notifyRunNeedsAttention(errorContent);
    } finally {
      finishActiveGeneration(requestId);
    }
  }

export async function handleRequestPlanRevision(deps: WorkspaceRuntimeDeps, messageId: string, feedback: string) {
  const { activeChat, compactProviderMessages, createActiveGeneration, createActiveProjectBoundaryMessage, createAgentRunForMessage, createContextCompactionProgress, createId, createLocalWorkspaceContextMessages, createMessage, createPlanningExecutionApproval, createPlanningProgress, createToolAwareProviderSettings, finishActiveGeneration, getLatestUserPrompt, isAbortError, isChatSending, isRequestInactive, localWorkspace, localWorkspaceRef, notifyRunNeedsAttention, preserveVisibleResponseThinking, recordPlanningProviderRequest, recordPlanningProviderUsage, resolveWorkspaceForChatProject, runPlanningMode, setActiveChatId, setActiveGenerationTarget, setActiveRoute, setAgentRunFailed, setAgentRunWaiting, setChats, setNoticeDialog, sortChatsByUpdatedAt, stopStaleStreamingMessages, titleFromMessage, toolSettings, touchProject, updateAgentRun, updateGeneratedMessage, withContextCompactionMarker, withContextCompactionProgress, withWebSearchProgress } = deps;

    const revisionFeedback = feedback.trim();

    if (!revisionFeedback) {
      return;
    }

    if (!toolSettings.provider) {
      setNoticeDialog({
        description: "Turn Model Provider back on in Settings before revising a plan.",
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

    if (!assistantMessage || assistantMessage.isStreaming || !(assistantMessage.mode === "plan" || assistantMessage.planning)) {
      return;
    }

    const originalPrompt = getLatestUserPrompt(currentChat.messages.slice(0, assistantMessageIndex));
    const { controller, requestId } = createActiveGeneration(currentChat.id, currentChat, true);
    const now = new Date().toISOString();
    const revisionUserMessage = createMessage("user", revisionFeedback);
    const revisedAssistantMessage: ChatMessage = {
      ...createMessage("assistant", ""),
      agentRunStatus: "running",
      isStreaming: true,
      mode: "plan",
      planning: {
        maxPasses: 1,
        passCount: 0,
        startedAt: now,
      },
      progress: createPlanningProgress("drafting"),
    };
    const agentRun = createAgentRunForMessage({
      chatId: currentChat.id,
      localWorkspace,
      messageId: revisedAssistantMessage.id,
      mode: "plan",
      prompt: originalPrompt || revisionFeedback,
      title: titleFromMessage(originalPrompt || revisionFeedback, []),
    });
    setActiveGenerationTarget(requestId, currentChat.id, revisedAssistantMessage.id);
    const supersededPlanMessage: ChatMessage = {
      ...assistantMessage,
      agentRunStatus: assistantMessage.agentRunStatus === "waiting_for_approval" ? "cancelled" : assistantMessage.agentRunStatus,
      approvals: assistantMessage.approvals?.map((approval) =>
        approval.tool === "planning_handoff" && approval.status === "pending"
          ? {
              ...approval,
              resolutionNote: "Replaced by revised plan feedback.",
              resolvedAt: now,
              status: "expired",
            }
          : approval,
      ),
    };

    updateAgentRun(assistantMessage.agentRunId, (run) => ({
      ...run,
      events: [
        ...run.events,
        {
          at: now,
          detail: revisionFeedback,
          id: createId("agent-event"),
          label: "Plan revision requested",
          type: "status",
        },
      ],
      status: run.status === "waiting_for_approval" ? "cancelled" : run.status,
      updatedAt: now,
    }));

    setActiveChatId(currentChat.id);
    setActiveRoute("chat");
    setChats((currentChats) =>
      sortChatsByUpdatedAt(
        currentChats.map((chat) =>
          chat.id === currentChat.id
            ? {
                ...chat,
                messages: [
                  ...currentChat.messages.slice(0, assistantMessageIndex),
                  supersededPlanMessage,
                  revisionUserMessage,
                  revisedAssistantMessage,
                  ...currentChat.messages.slice(assistantMessageIndex + 1),
                ],
                updatedAt: now,
              }
            : chat,
        ),
      ),
    );
    stopStaleStreamingMessages(currentChat.id, revisedAssistantMessage.id);

    try {
      const workspaceSettings = resolveWorkspaceForChatProject(currentChat.project, localWorkspaceRef.current);
      const projectBoundaryMessage = createActiveProjectBoundaryMessage(currentChat.project, workspaceSettings);
      const localContextMessages = await createLocalWorkspaceContextMessages(workspaceSettings, originalPrompt || revisionFeedback, currentChat.project);
      const revisionInstruction = createMessage(
        "user",
        [
          "PLAN REVISION REQUEST",
          originalPrompt ? `Original request: ${originalPrompt}` : "",
          "Revise the immediately preceding plan using this feedback. Return a complete new plan that can be accepted for execution.",
          revisionFeedback,
        ]
          .filter(Boolean)
          .join("\n\n"),
      );
      const providerCompaction = compactProviderMessages(
        [
          ...currentChat.messages.slice(0, assistantMessageIndex + 1).filter((message) => message.status !== "error"),
          projectBoundaryMessage,
          ...localContextMessages,
          revisionInstruction,
        ],
        createToolAwareProviderSettings({}, currentChat),
      );
      const messagesForProvider = providerCompaction.messages;

      if (providerCompaction.contextCompaction) {
        const compactionProgress = createContextCompactionProgress(providerCompaction);

        updateGeneratedMessage(currentChat.id, revisedAssistantMessage.id, (message) => ({
          ...withContextCompactionMarker(message, providerCompaction.contextCompaction),
          progress: withContextCompactionProgress(compactionProgress, message.progress),
        }));
      }

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

          updateGeneratedMessage(currentChat.id, revisedAssistantMessage.id, (message) => ({
            ...message,
            content: snapshot.content ?? message.content,
            progress: withWebSearchProgress(message.webSearch, snapshot.progress),
            reasoning: snapshot.reasoning ?? message.reasoning,
          }));
        },
      });

      if (isRequestInactive(requestId, controller)) {
        return;
      }

      const planApproval = createPlanningExecutionApproval(agentRun.id, revisedAssistantMessage.id, assistantResponse.content, originalPrompt || revisionFeedback);

      setChats((currentChats) =>
        sortChatsByUpdatedAt(
          currentChats.map((chat) =>
            chat.id === currentChat.id
              ? {
                  ...chat,
                  messages: chat.messages.map((message) =>
                    message.id === revisedAssistantMessage.id
                      ? preserveVisibleResponseThinking(message, {
                          ...message,
                          agentRunStatus: "waiting_for_approval",
                          approvals: [planApproval],
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
      setAgentRunWaiting(agentRun.id, "Plan approval required", "Review the revised plan, then accept it or ask for another change.", [planApproval]);
      notifyRunNeedsAttention("A revised plan is ready for approval.");
      touchProject(currentChat.project);
    } catch (error) {
      if (isAbortError(error) || isRequestInactive(requestId, controller)) {
        return;
      }

      const errorContent = formatProviderErrorForUser(error, "The plan revision request failed.");

      setChats((currentChats) =>
        sortChatsByUpdatedAt(
          currentChats.map((chat) =>
            chat.id === currentChat.id
              ? {
                  ...chat,
                  messages: chat.messages.map((message) =>
                    message.id === revisedAssistantMessage.id
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
      notifyRunNeedsAttention(errorContent);
      touchProject(currentChat.project);
    } finally {
      finishActiveGeneration(requestId);
    }
  }
