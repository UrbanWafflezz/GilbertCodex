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

export async function handleResolveToolApproval(deps: WorkspaceRuntimeDeps, messageId: string, approvalId: string, decision: AgentApprovalDecision) {
  const { activeChat, agentRunsRef, approvedPlanRequiresMutation, compactProviderMessages, createActiveGeneration, createActiveProjectBoundaryMessage, createApprovedPlanExecutionInstruction, createApprovedPlanExecutionPrompt, createId, createLocalComputerProgress, createLocalWorkspaceContextMessages, createMessage, finishActiveGeneration, getLatestUserPrompt, isAbortError, isChatSending, isRequestInactive, localWorkspaceRef, mergeAgentApprovals, mergeChatArtifacts, notifyRunComplete, notifyRunNeedsAttention, preserveVisibleResponseThinking, rememberSessionApprovalDecision, resolveWorkspaceForChatProject, setActiveChatId, setActiveRoute, setAgentRunCompleted, setAgentRunFailed, setAgentRunWaiting, setChats, setNoticeDialog, sortChatsByUpdatedAt, streamAssistantWithLocalTools, toolSettings, touchProject, updateAgentRun, withLocalComputerProgress } = deps;

    if (!toolSettings.provider) {
      setNoticeDialog({
        description: "Turn Model Provider back on in Settings before resuming an agent run.",
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
    const approval = assistantMessage?.approvals?.find((candidate) => candidate.id === approvalId);

    if (!assistantMessage || !approval) {
      return;
    }

    const run = agentRunsRef.current.find((candidate) => candidate.id === (approval.runId ?? assistantMessage.agentRunId));
    const resumeToolCallContent = approval.resumeToolCallContent ?? run?.pendingToolCallContent;

    if (!resumeToolCallContent && approval.tool !== "planning_handoff") {
      setNoticeDialog({
        description: "This approval does not have a resumable tool request saved with it.",
        title: "Cannot resume this run",
      });
      return;
    }

    const resolvedAt = new Date().toISOString();
    const resolvedApproval: AgentApproval = {
      ...approval,
      editedArgs: decision.editedArgs,
      resolutionNote: decision.note ?? (decision.scope === "session" ? "Allowed for this workspace session." : undefined),
      resolvedAt,
      status: decision.status,
    };
    const workspaceSettings = resolveWorkspaceForChatProject(currentChat.project, run?.localWorkspace ?? localWorkspaceRef.current);
    rememberSessionApprovalDecision(approval, decision, workspaceSettings, currentChat.id);
    const prompt = run?.prompt ?? getLatestUserPrompt(currentChat.messages.slice(0, assistantMessageIndex));
    const resolvedPlanContent = approval.tool === "planning_handoff"
      ? typeof decision.editedArgs?.plan === "string"
        ? decision.editedArgs.plan
        : typeof approval.args?.plan === "string"
          ? approval.args.plan
          : assistantMessage.content
      : undefined;
    const { controller, requestId } = createActiveGeneration(currentChat.id, currentChat, true, undefined, {
      messageId,
    });

    setActiveChatId(currentChat.id);
    setActiveRoute("chat");
    updateAgentRun(assistantMessage.agentRunId, (run, startedAt) => ({
      ...run,
      events: [
        ...run.events,
        {
          at: startedAt,
          id: createId("agent-event"),
          label: "Approval decision submitted",
          type: "resume",
        },
      ],
      status: "running",
      steps: [
        ...run.steps,
        {
          id: createId("agent-step"),
          label: "Resume after approval",
          startedAt,
          status: "running",
          type: "approval",
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
                      ...message,
                      agentRunStatus: "running",
                      approvals: (message.approvals ?? []).map((candidate) => (candidate.id === approvalId ? resolvedApproval : candidate)),
                      isStreaming: true,
                      planning: resolvedPlanContent && message.planning
                        ? {
                            ...message.planning,
                            planContent: resolvedPlanContent,
                          }
                        : message.planning,
                      progress: withLocalComputerProgress(createLocalComputerProgress("active", "Resuming approved action"), message.progress),
                    }
                  : message,
              ),
              updatedAt: resolvedAt,
            }
          : chat,
      ),
    );

    updateAgentRun(approval.runId ?? assistantMessage.agentRunId, (existingRun, now) => ({
      ...existingRun,
      approvals: mergeAgentApprovals(existingRun.approvals, [resolvedApproval]),
      events: [
        ...existingRun.events,
        {
          at: now,
          detail: decision.status === "denied"
            ? "The user denied the pending tool action."
            : decision.scope === "session"
              ? "The user approved this tool for the current workspace session."
              : "The user approved the pending tool action.",
          id: createId("agent-event"),
          label: "Approval resolved",
          type: "resume",
        },
      ],
      status: "running",
      steps: [
        ...existingRun.steps,
        {
          approvalId,
          id: createId("agent-step"),
          label: decision.status === "denied" ? "Apply denied approval" : "Resume approved tool action",
          startedAt: now,
          status: "running",
          type: "approval",
        },
      ],
      updatedAt: now,
    }));

    try {
      const priorMessages = currentChat.messages.slice(0, assistantMessageIndex).filter((message) => message.status !== "error");
      const projectBoundaryMessage = createActiveProjectBoundaryMessage(currentChat.project, workspaceSettings);
      const localContextMessages = await createLocalWorkspaceContextMessages(workspaceSettings, prompt, currentChat.project);
      if (approval.tool === "planning_handoff" && decision.status === "denied") {
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
                            agentRunStatus: "cancelled",
                            isStreaming: false,
                          }
                        : message,
                    ),
                    updatedAt: new Date().toISOString(),
                  }
                : chat,
            ),
          ),
        );
        updateAgentRun(approval.runId ?? assistantMessage.agentRunId, (existingRun, now) => ({
          ...existingRun,
          events: [
            ...existingRun.events,
            {
              at: now,
              detail: "The user denied plan execution.",
              id: createId("agent-event"),
              label: "Plan execution cancelled",
              type: "status",
            },
          ],
          status: "cancelled",
          updatedAt: now,
        }));
        touchProject(currentChat.project);
        return;
      }

      const planContent = resolvedPlanContent ?? assistantMessage.content;
      const approvedPlanExecution = approval.tool === "planning_handoff"
        ? {
            originalPrompt: prompt,
            planContent,
            requiresMutation: approvedPlanRequiresMutation(prompt, planContent),
          }
        : undefined;
      const executionPrompt = approvedPlanExecution
        ? createApprovedPlanExecutionPrompt(prompt, planContent)
        : prompt;
      const messagesForProvider = approval.tool === "planning_handoff"
        ? compactProviderMessages([
            ...priorMessages,
            projectBoundaryMessage,
            ...localContextMessages,
            createMessage("assistant", `APPROVED PLAN\n${planContent}`),
            createMessage("user", createApprovedPlanExecutionInstruction(prompt, planContent)),
          ]).messages
        : compactProviderMessages([...priorMessages, projectBoundaryMessage, ...localContextMessages]).messages;
      const assistantResponse = await streamAssistantWithLocalTools({
        approvalDecisions: {
          [approvalId]: decision,
        },
        approvedPlanExecution,
        chatId: currentChat.id,
        controller,
        messageId,
        messagesForProvider,
        previousToolCalls: approval.tool === "planning_handoff" ? undefined : assistantMessage.toolCalls,
        prompt: executionPrompt,
        requestId,
        runId: assistantMessage.agentRunId,
        resumeToolCallContent: approval.tool === "planning_handoff" ? undefined : resumeToolCallContent,
        runtimeToolOverrides: approvedPlanExecution
          ? {
              codeEdit: true,
              codeView: true,
              fileBrowser: true,
              fileCreation: true,
              fileSearch: true,
              sourceControl: true,
              testingTools: true,
              typescriptTools: true,
            }
          : undefined,
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
                          planning: approvedPlanExecution && message.planning
                            ? {
                                ...message.planning,
                                planContent,
                              }
                            : message.planning,
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
          approval.runId ?? assistantMessage.agentRunId,
          "Tool approval required",
          "Review the next pending tool action to continue the same run.",
          assistantResponse.approvalRequests ?? [],
          assistantResponse.pendingToolCallContent,
        );
        notifyRunNeedsAttention("Another tool action is waiting for your approval.");
        touchProject(currentChat.project);
        return;
      }

      setAgentRunCompleted(approval.runId ?? assistantMessage.agentRunId, {
        ...assistantMessage,
        agentRunStatus: "completed",
        artifacts: mergeChatArtifacts(assistantMessage.artifacts, assistantResponse.artifacts),
        content: assistantResponse.content,
        isStreaming: false,
        toolCalls: assistantResponse.toolCalls,
      });
      notifyRunComplete({
        ...assistantMessage,
        artifacts: mergeChatArtifacts(assistantMessage.artifacts, assistantResponse.artifacts),
        content: assistantResponse.content,
        isStreaming: false,
        toolCalls: assistantResponse.toolCalls,
      });
      touchProject(currentChat.project);
    } catch (error) {
      if (isAbortError(error) || isRequestInactive(requestId, controller)) {
        return;
      }

      const errorContent = error instanceof Error ? error.message : "The provider request failed while resuming the approval.";

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
      setAgentRunFailed(approval.runId ?? assistantMessage.agentRunId, errorContent);
      notifyRunNeedsAttention(errorContent);
      touchProject(currentChat.project);
    } finally {
      finishActiveGeneration(requestId);
    }
  }
