// @ts-nocheck
import type { SetStateAction } from "react";

import type { AgentRuntimeDecision } from "../../../agentRuntime/codingAgent";
import type { LocalComputerToolExecutionPolicy, LocalSubagentResult, LocalSubagentTask } from "../../../localWorkspace/localToolRuntimeDisabled";
import type { ContextCompactionNotice, ContextWindowUsage, ModelContextWindowMap, compactMessagesForContext } from "../../../lib/contextWindow";
import { createVisibleToolApprovalThinking, createVisibleToolPlanThinking, createVisibleToolResultThinking } from "../../../lib/thinkingTrace";
import type { PlanningProviderRequest } from "../../../services/planningClient";
import type { ProviderToolBridgeOptions, ToolBridgeExecutionBatch, ToolBridgeToolFamily, ToolCallRequest, ToolCapabilityPlan, ToolDefinition, ToolExecutionContext, ToolIntent, ToolMemorySearchRequest, ToolResultMessage } from "../../../toolBridge";
import type { AppInfo } from "../../../types/app";
import type { AgentApproval, AgentApprovalDecision, AgentRun } from "../../../types/agentRun";
import type { AuthSession } from "../../../types/auth";
import type { ChatArtifact, ChatAttachment, ChatContextCompaction, ChatComposerDraft, ChatMessage, ChatPlanningInputAnswer, ChatProgressItem, ChatResearchReference, ChatSendInput, ChatSource, ChatStreamTiming, ChatSummary, ChatToolCall, ChatWebSearch, ChatWorkTraceItem } from "../../../types/chat";
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
import { withCodingBridgeBatch, withCodingTelemetryEvent, withCodingToolHealth } from "../../../coding/evidence";
import { createToolHealthSnapshot } from "../../../coding/toolHealth";
import { DEFAULT_INSTALLED_PLUGIN_IDS, PLUGIN_LISTINGS } from "../../../features/plugins/pluginCatalog";
import {
  createPlainTextRevisionBridgeCalls as createFallbackRevisionBridgeCalls,
  formatApprovalRevisionOriginalCalls as formatFallbackRevisionOriginalCalls,
} from "./approvalRevisionFallback";
import {
  createConnectedToolEvidenceRecoveryInstruction,
  createDeploymentEvidenceRecoveryInstruction,
  hasConnectedToolEvidence,
  hasDeploymentToolAttempt,
  looksLikeUnsupportedConnectedToolActionAnswer,
  looksLikeUnsupportedDeploymentAnswer,
  promptRequestsConnectedToolAction,
  promptRequestsDeploymentAction,
} from "../../chatRuntime";

const CAPABILITY_INVENTORY_PROMPT_PATTERN =
  /\b(?:what|which|list|show|tell(?:\s+me)?|explain|describe)\b[\s\S]{0,180}\b(?:tools?|plugins?|apps?|skills?|capabilities?|connectors?)\b|\b(?:tools?|plugins?|apps?|skills?|capabilities?|connectors?)\b[\s\S]{0,180}\b(?:available|enabled|installed|connected|do\s+you\s+have|can\s+you\s+(?:access|call|use|do))\b/i;

function hasMcpToolEvidence(toolCalls: ChatToolCall[] = []) {
  return toolCalls.some((toolCall) =>
    typeof toolCall.toolId === "string" &&
    toolCall.toolId.startsWith("mcp_") &&
    (toolCall.status === "complete" || toolCall.status === "error" || toolCall.status === "skipped")
  );
}

function markFirstVisibleStreamToken(timing: ChatStreamTiming | undefined, visibleContent: string): ChatStreamTiming | undefined {
  if (!timing || timing.firstVisibleTokenAt || !visibleContent.trim()) {
    return timing;
  }

  const now = new Date();
  const startedAtMs = Date.parse(timing.requestStartedAt);
  const elapsedMs = Number.isFinite(startedAtMs) ? Math.max(0, now.getTime() - startedAtMs) : undefined;

  return {
    ...timing,
    firstVisibleTokenAt: now.toISOString(),
    timeToFirstVisibleTokenMs: elapsedMs,
  };
}

export async function streamAssistantWithLocalTools(deps: WorkspaceRuntimeDeps, {
    approvalDecisions,
    approvedPlanExecution,
    automationScope,
    chatId,
    controller,
    messageId,
    messagesForProvider,
    memoryToolsEnabled = true,
    onExternalUpdate,
    previousToolCalls,
    prompt,
    providerSettingsOverrides,
    requestId,
    runId,
    resumeToolCallContent,
    runtimeToolOverrides,
    toolSelectionPrompt,
    webSearchSettingsOverride,
    workspaceSettings,
  }: {
    approvalDecisions?: Record<string, AgentApprovalDecision>;
    approvedPlanExecution?: ApprovedPlanExecutionContext;
    automationScope?: ToolExecutionContext["automationScope"];
    chatId: string;
    controller: AbortController;
    messageId: string;
    memoryToolsEnabled?: boolean;
    messagesForProvider: ChatMessage[];
    onExternalUpdate?: (update: DiscordStreamUpdate) => void;
    previousToolCalls?: ChatToolCall[];
    prompt: string;
    providerSettingsOverrides?: Partial<ProviderSettings>;
    requestId: number;
    runId?: string;
    resumeToolCallContent?: string;
    /**
     * Tools that should be force-enabled or force-disabled for this run only,
     * overriding the user's chat-mode toggles. Plan-mode research uses this to
     * guarantee `fileSearch` / `fileBrowser` / `codeView` are on even if the
     * user has turned them off for normal chat.
     */
    runtimeToolOverrides?: Partial<ProviderSettings["tools"]>;
    toolSelectionPrompt?: string;
    webSearchSettingsOverride?: WebSearchSettings;
    workspaceSettings: LocalWorkspaceSettings;
  }): Promise<AssistantToolResponse> {
  const { activeChat, appendAutoCompactionContinuation, attachLiveTerminalSession, BRIDGE_TOOL_APPROVAL_RESUME_KIND, coalesceToolBridgeCalls, compactProviderMessages, completeStreamingWorkThinking, contextWindowRef, createActiveLocalToolCalls, createApprovalSessionDecisionKey, createApprovedPlanExecutionFailedAnswer, createApprovedPlanExecutionRetryInstruction, createAssistantToolRequestContent, createBridgeChatToolCall, createContextBoundLocalToolExecutionPolicy, createContextCompactionProgress, createDefaultToolRegistry, createFabricatedToolProgressRecoveryInstruction, createFinalAnswerRecoveryInstruction, createFinalOnlyProviderSettings, createFreshLocalToolEvidenceInstruction, createId, createLocalComputerProgress, createLocalToolBudgetFinalInstruction, createLocalToolFinalInstruction, createMalformedToolCallRecoveryInstruction, createMemorySearchForRequest, createMessage, createNeutralToolSynthesisFailureMessage, createNoExecutedToolFinalAnswer, createNoExecutedToolFinalInstruction, createPromptAwareProviderSettings, createRecoverableBridgeToolRetryInstruction, createRecoverableLocalEditRetryInstruction, createRuntimeApprovalDecisions, createSimpleLocalTaskCompletionAnswer, createToolActionPromiseRecoveryInstruction, createToolFinalAnswerUnavailableMessage, createToolProtocolNarrationRecoveryInstruction, createUnappliedFileEditRecoveryInstruction, createUnnecessaryLocalActionConfirmationRecoveryInstruction, detectSimpleLocalTaskCompletion, executeToolBridgeCalls, formatDiscordToolStatus, formatLocalToolPreviewProgress, generalSettings, getModelVisibleToolResultCharBudget, getRuntimeWebSearchSettings, getToolMemoryProjectName, hasLocalComputerToolCalls, hasRequestScopedWorkspaceToolsEnabled, hasSuccessfulApprovedPlanMutation, hasSuccessfulApprovedPlanWorkspaceTool, inferProviderToolBridgeFormat, isAbortError, isEmptySelectedScaffoldProbe, isMissingFileReadError, isRecoverableLocalEditFailure, isRequestInactive, isSimpleLocalScaffoldRequest, isVisibleToolResultLeak, LOCAL_TOOL_FINAL_MIN_TOKENS, looksLikeContradictedSuccessfulFileMutationAnswer, looksLikeFabricatedToolProgress, looksLikeInFlightToolPlanning, looksLikeInternalToolRecoveryAnswer, looksLikeOnlyToolPrelude, looksLikePrivateThinkingNarration, looksLikeSubstantiveVisibleAnswer, looksLikeToolProtocolNarration, looksLikeUnappliedFileEditAnswer, looksLikeUnexecutedToolActionPromise, looksLikeUnnecessaryLocalActionConfirmation, MAX_LOCAL_TOOL_EXECUTIONS, MAX_LOCAL_TOOL_PASSES, MAX_MALFORMED_TOOL_RECOVERY_RETRIES, MAX_RECOVERABLE_LOCAL_EDIT_RETRIES, MAX_TOOL_FINALIZATION_RETRIES, mergeAgentApprovals, mergeChatArtifacts, mergeChatSources, needsFreshLocalToolEvidence, parseVisibleTextToolCalls, pendingChatsRef, providerSettings, recordProviderActualUsage, recordProviderContextUsage, rememberProjectToolMemoryFromBridgeRun, rememberProjectToolMemoryFromChatToolCalls, requiresWorkspaceMutationForPrompt, requiresWorkspaceToolCallForPrompt, resolveContextWindowForModel, resolveEnabledWorkspaceRoots, resolveToolPermission, routePrimitiveEvidenceBatchToWorkflow, runLocalComputerToolCalls, runParallelSubagents, sanitizeLocalToolCallsForDisplay, selectToolCapabilityPlan, sendProviderMessage, setBrowserPreviewTarget, shouldAttachWebSearch, shouldHoldStreamingContentForToolCalls, shouldSynthesizeEmptyFinalFromToolResults, stampLocalToolCallIds, STANDARD_LOCAL_COMPUTER_TOOL_EXECUTION_POLICY, streamProviderMessageWithRetry, stripLeadingToolPreludeForDisplay, supportsProviderParallelToolCalls, toolSettings, updateAgentRun, updateGeneratedMessage, upsertToolCall, validateToolArguments, withContextCompactionMarker, withContextCompactionProgress, withLocalComputerProgress, withStreamingWorkThinking } = deps;

    function applyToolOverrides(settings: ProviderSettings): ProviderSettings {
      if (!runtimeToolOverrides) return settings;
      return { ...settings, tools: { ...settings.tools, ...runtimeToolOverrides } };
    }
    const runtimeChat = pendingChatsRef.current.find((chat) => chat.id === chatId && !chat.archived) ?? activeChat;
    let messages = messagesForProvider;
    let localProgress: ChatProgressItem | undefined;
    let finalResponse: AssistantToolResponse = {
      content: "",
      toolCalls: undefined,
    };

    let totalExecutedToolCalls = 0;
    let allArtifacts: ChatArtifact[] = [];
    let allSources: ChatSource[] = [];
    let allToolCalls: ChatToolCall[] = [];
    let finalizationRetries = 0;
    let freshLocalToolEvidenceRetries = 0;
    let malformedToolRecoveryRetries = 0;
    let recoverableBridgeToolRetries = 0;
    let recoverableEditRetries = 0;
    let emptyScaffoldRecoveryUsed = false;

    let passIndex = 0;
    const baseRuntimeSettings = applyToolOverrides(createPromptAwareProviderSettings(prompt, providerSettingsOverrides ?? {}, runtimeChat));
    const toolExecutionPolicy = createContextBoundLocalToolExecutionPolicy(STANDARD_LOCAL_COMPUTER_TOOL_EXECUTION_POLICY);
    const runtimeWebSearchSettings = getRuntimeWebSearchSettings(providerSettings, webSearchSettingsOverride);
    const runtimeWebSearchMaxResults = runtimeWebSearchSettings.maxResults;
    const simpleLocalScaffoldRequest = isSimpleLocalScaffoldRequest(prompt);
    const maxToolPasses = Math.max(1, Math.min(automationScope?.maxModelLoops ?? (simpleLocalScaffoldRequest ? 5 : MAX_LOCAL_TOOL_PASSES), simpleLocalScaffoldRequest ? 5 : MAX_LOCAL_TOOL_PASSES));
    const maxToolExecutions = Math.max(0, Math.min(automationScope?.maxToolCalls ?? (simpleLocalScaffoldRequest ? 16 : MAX_LOCAL_TOOL_EXECUTIONS), simpleLocalScaffoldRequest ? 16 : MAX_LOCAL_TOOL_EXECUTIONS));
    const bridgeRegistry = createDefaultToolRegistry();
    const bridgeToolResultMessages: ToolResultMessage[] = [];
    const enabledWorkspaceRoots = typeof resolveEnabledWorkspaceRoots === "function"
      ? await resolveEnabledWorkspaceRoots(workspaceSettings)
      : (workspaceSettings.enabled ? workspaceSettings.roots : []);
    let bridgeReasoningState: ProviderReasoningState | undefined;
    let approvalRevisionPrompt: string | undefined;
    let approvalRevisionRequiredFamilies: ToolBridgeToolFamily[] = [];
    let approvalRevisionRequiresToolCall = false;
    let pendingApprovalRevision: { calls: ToolCallRequest[]; note: string; requiredFamilies: ToolBridgeToolFamily[] } | undefined;
    const memorySearch = createMemorySearchForRequest(chatId, getToolMemoryProjectName(chatId), workspaceSettings);
    const updateCodingRun = (updater: (run: AgentRun) => AgentRun) => {
      if (!runId) return;
      updateAgentRun(runId, (run) => updater(run));
    };
    const bridgeTelemetry = runId
      ? (event) => updateCodingRun((run) => withCodingTelemetryEvent(run, event))
      : undefined;

    function rememberBridgeToolResults(
      resultMessages: ToolResultMessage[],
      providerTurnId: number,
      reasoningState?: ProviderReasoningState,
    ) {
      bridgeToolResultMessages.push(...resultMessages.map((message) => ({
        ...message,
        providerTurnId,
        reasoningState,
      })));
    }

    function createActiveBridgeToolPreviews(calls: ToolCallRequest[], activePassIndex: number): ChatToolCall[] {
      return stampLocalToolCallIds(
        calls.map((call) =>
          createBridgeChatToolCall(
            call,
            bridgeRegistry.get(call.name),
            { content: "Preparing tool call.", ok: true },
            "active",
          ),
        ),
        activePassIndex,
      );
    }

    function maybeFinishSimpleLocalScaffold(): typeof finalResponse | null {
      if (!simpleLocalScaffoldRequest) {
        return null;
      }

      const completion = detectSimpleLocalTaskCompletion(prompt, allToolCalls);

      if (!completion) {
        return null;
      }

      const content = createSimpleLocalTaskCompletionAnswer(completion);
      const completedProgress = createLocalComputerProgress("complete", "Starter app verified");
      localProgress = completedProgress;
      finalResponse = {
        artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
        content,
        progress: completedProgress,
        sources: allSources.length > 0 ? allSources : undefined,
        toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
      };
      updateGeneratedMessage(chatId, messageId, (message) => ({
        ...message,
        agentRunStatus: "completed",
        artifacts: allArtifacts.length > 0 ? mergeChatArtifacts(message.artifacts, allArtifacts) : message.artifacts,
        content,
        progress: withLocalComputerProgress(completedProgress, message.progress),
        sources: allSources.length > 0 ? mergeChatSources(message.sources, allSources) : message.sources,
        toolCalls: allToolCalls.length > 0 ? allToolCalls : message.toolCalls,
      }));
      onExternalUpdate?.({
        content,
        progress: completedProgress,
        status: "Starter app verified.",
        toolCall: allToolCalls[allToolCalls.length - 1],
      });

      return finalResponse;
    }

    function createToolCapabilityBlockedAnswer(plan: ToolCapabilityPlan) {
      if (CAPABILITY_INVENTORY_PROMPT_PATTERN.test(prompt)) {
        return createFriendlyCapabilityInventoryAnswer(baseRuntimeSettings, plan);
      }

      if (promptRequestsConnectedToolAction(prompt) || promptRequestsDeploymentAction(prompt)) {
        const blockedReasons = plan.blockedReasons
          .map((reason) => `${reason.code}${reason.family ? `/${reason.family}` : ""}: ${reason.detail}`)
          .slice(0, 4);
        const requestedFamilies = plan.requiredFamilies.length > 0
          ? `Requested tool families: ${plan.requiredFamilies.join(", ")}.`
          : "";

        return [
          "I could not start the required connected-tool pass because this provider request has no matching callable tools attached.",
          blockedReasons.length > 0 ? `Blocked gates: ${blockedReasons.join(" | ")}` : "",
          requestedFamilies,
          "No MCP, connected-app, connector, terminal deploy, or external service action ran in this turn, so I cannot claim it worked.",
        ].filter(Boolean).join("\n\n");
      }

      const blockedReasons = plan.blockedReasons
        .map((reason) => `${reason.code}${reason.family ? `/${reason.family}` : ""}: ${reason.detail}`)
        .slice(0, 4);
      const requiredFamilies = plan.requiredFamilies.length > 0
        ? `Required tool families: ${plan.requiredFamilies.join(", ")}.`
        : "";
      const providerVisibleTools = plan.providerVisibleToolIds.length > 0
        ? `Provider-visible tools: ${plan.providerVisibleToolIds.join(", ")}.`
        : "Provider-visible tools: none.";

      return [
        "I could not start the required workspace tool pass because this provider request has no required callable tools attached.",
        blockedReasons.length > 0 ? `Blocked gates: ${blockedReasons.join(" | ")}` : "",
        [requiredFamilies, providerVisibleTools].filter(Boolean).join(" "),
        "No fresh workspace read, edit, Git command, terminal command, browser action, or web search ran in this turn.",
      ].filter(Boolean).join("\n\n");
    }

    function createFriendlyCapabilityInventoryAnswer(settings: ProviderSettings, plan: ToolCapabilityPlan) {
      const enabledCapabilities = formatEnabledToolSettings(settings);
      const defaultCatalogEntries = PLUGIN_LISTINGS
        .filter((plugin) => (DEFAULT_INSTALLED_PLUGIN_IDS as readonly string[]).includes(plugin.id))
        .map((plugin) => plugin.name)
        .slice(0, 8);
      const pluginCategories = [...new Set(PLUGIN_LISTINGS.map((plugin) => plugin.category))].slice(0, 10);
      const selectedTools = plan.selectedToolIds.length > 0
        ? `The tool selector picked ${plan.selectedToolIds.length} tool${plan.selectedToolIds.length === 1 ? "" : "s"} for this request, but none were callable in this provider pass.`
        : "The live callable-tool manifest was not attached for this provider pass.";

      return [
        "I can help with a bunch of app tools, but I could not inspect the live callable-tool manifest in this turn.",
        "",
        "In this chat, the enabled capability areas are:",
        enabledCapabilities.length > 0 ? enabledCapabilities.map((capability) => `- ${capability}`).join("\n") : "- Plain chat and reasoning from the current conversation.",
        "",
        defaultCatalogEntries.length > 0
          ? `Bundled catalog default entries include ${defaultCatalogEntries.join(", ")}. That is catalog/default metadata, not proof every plugin is connected in this chat.`
          : "",
        pluginCategories.length > 0
          ? `The plugin catalog also has categories like ${pluginCategories.join(", ")}.`
          : "",
        "",
        `${selectedTools} Exact live tools can change with the selected workspace, tool toggles, connected accounts, and installed plugins. I should not claim a plugin, skill, MCP server, account, or connector is live unless the current app state or a tool result proves it.`,
      ].filter(Boolean).join("\n");
    }

    function formatEnabledToolSettings(settings: ProviderSettings) {
      const tools = settings.tools;
      return [
        tools.fileBrowser || tools.fileSearch || tools.codeView ? "Workspace files and code reading/search" : "",
        tools.codeEdit || tools.codeGeneration || tools.fileCreation ? "Code editing, file creation, and implementation work" : "",
        tools.sourceControl ? "Git/source-control review and actions" : "",
        tools.terminal ? "Terminal commands for builds, tests, installs, and dev servers" : "",
        tools.browserPreview ? "Browser preview and console inspection" : "",
        tools.webSearch ? "Web search for current/source-backed facts when enabled for the run" : "",
        tools.imageGeneration ? "Image generation" : "",
        tools.planning ? "Planning mode" : "",
        tools.thinking ? "Thinking mode" : "",
        tools.mcpServers ? "MCP/server-backed integrations" : "",
      ].filter(Boolean);
    }

    function createSimpleScaffoldToolPlanContent() {
      return "";
    }

    async function recoverEmptySimpleScaffold(): Promise<typeof finalResponse | null> {
      emptyScaffoldRecoveryUsed = true;
      const recoveryPassIndex = passIndex + 1;
      const recoveryToolContent = createSimpleScaffoldToolPlanContent();
      const activeProgress = createLocalComputerProgress("active", "Scaffolding empty starter app");
      const activeToolCalls = createActiveLocalToolCalls(recoveryToolContent, recoveryPassIndex, toolExecutionPolicy);
      let liveToolCalls = activeToolCalls;

      updateGeneratedMessage(chatId, messageId, (message) => ({
        ...(activeToolCalls.length > 0 ? withStreamingWorkThinking(message, createVisibleToolPlanThinking(activeToolCalls), "active") : message),
        agentRunStatus: "running",
        content: "",
        progress: withLocalComputerProgress(activeProgress, message.progress),
        toolCalls: activeToolCalls.length > 0 ? [...allToolCalls, ...activeToolCalls] : message.toolCalls,
      }));
      onExternalUpdate?.({
        progress: activeProgress,
        status: "Scaffolding empty starter app...",
        toolCall: activeToolCalls[0],
      });

      const toolRun = await runLocalComputerToolCalls({
        approvalDecisions: createRuntimeApprovalDecisions(workspaceSettings, approvalDecisions, chatId),
        assistantContent: recoveryToolContent,
        executionPolicy: toolExecutionPolicy,
        onRunSubagents: (tasks) => runParallelSubagents(tasks, messages, prompt, controller.signal, runtimeChat),
        onToolCallUpdate: (_callNumber, toolCall) => {
          const [stampedToolCall] = stampLocalToolCallIds([toolCall], recoveryPassIndex);

          if (!stampedToolCall) {
            return;
          }

          liveToolCalls = upsertToolCall(liveToolCalls, stampedToolCall);
          attachLiveTerminalSession([stampedToolCall]);
          updateGeneratedMessage(chatId, messageId, (message) => ({
            ...message,
            content: "",
            progress: withLocalComputerProgress(activeProgress, message.progress),
            toolCalls: [...allToolCalls, ...liveToolCalls],
          }));
          onExternalUpdate?.({
            progress: activeProgress,
            status: formatDiscordToolStatus(stampedToolCall),
            toolCall: stampedToolCall,
          });
        },
        settings: workspaceSettings,
        signal: controller.signal,
        toolSettings,
        userPrompt: prompt,
        webSearchSettings: runtimeWebSearchSettings,
        webSearchMaxResults: runtimeWebSearchMaxResults,
      });

      if (toolRun.browserPreviewUrl && toolSettings.browserPreview) {
        setBrowserPreviewTarget((currentTarget) => ({
          id: (currentTarget?.id ?? 0) + 1,
          url: toolRun.browserPreviewUrl!,
        }));
      }

      totalExecutedToolCalls += toolRun.executedCount;
      const completedToolCalls = stampLocalToolCallIds(toolRun.toolCalls, recoveryPassIndex);
      rememberProjectToolMemoryFromChatToolCalls(chatId, workspaceSettings, prompt, completedToolCalls);
      allArtifacts = mergeChatArtifacts(allArtifacts, toolRun.artifacts) ?? [];
      allSources = mergeChatSources(allSources, toolRun.sources);
      allToolCalls = [...allToolCalls, ...completedToolCalls];
      attachLiveTerminalSession(allToolCalls);
      localProgress = toolRun.waitingForApproval ? toolRun.progress : createLocalComputerProgress("complete", `${totalExecutedToolCalls} ran`);
      finalResponse.artifacts = allArtifacts.length > 0 ? allArtifacts : undefined;
      finalResponse.sources = allSources.length > 0 ? allSources : undefined;
      finalResponse.toolCalls = allToolCalls;
      finalResponse.approvalRequests = toolRun.approvalRequests.map((approval) => ({
        ...approval,
        messageId,
        resumeToolCallContent: recoveryToolContent,
      }));
      finalResponse.pendingToolCallContent = toolRun.waitingForApproval ? recoveryToolContent : undefined;
      finalResponse.waitingForApproval = toolRun.waitingForApproval;

      updateGeneratedMessage(chatId, messageId, (message) => ({
        ...withStreamingWorkThinking(
          message,
          toolRun.waitingForApproval ? createVisibleToolApprovalThinking(allToolCalls) : createVisibleToolResultThinking(completedToolCalls),
          "complete",
        ),
        agentRunStatus: toolRun.waitingForApproval ? "waiting_for_approval" : "running",
        approvals: toolRun.waitingForApproval ? mergeAgentApprovals(message.approvals ?? [], finalResponse.approvalRequests ?? []) : message.approvals,
        artifacts: mergeChatArtifacts(message.artifacts, toolRun.artifacts),
        content: "",
        progress: withLocalComputerProgress(localProgress, message.progress),
        sources: toolRun.sources.length > 0 ? mergeChatSources(message.sources, toolRun.sources) : message.sources,
        toolCalls: allToolCalls,
      }));
      onExternalUpdate?.({
        progress: localProgress,
        sources: toolRun.sources,
        status: toolRun.waitingForApproval ? "Tool approval is needed in Gilbert Codex." : `${totalExecutedToolCalls} tool call${totalExecutedToolCalls === 1 ? "" : "s"} completed.`,
        toolCall: allToolCalls[allToolCalls.length - 1],
      });

      if (toolRun.waitingForApproval) {
        return {
          ...finalResponse,
          progress: toolRun.progress,
        };
      }

      const completedResponse = maybeFinishSimpleLocalScaffold();
      if (completedResponse) {
        return completedResponse;
      }

      messages = [
        ...messages,
        createMessage("assistant", recoveryToolContent),
        createMessage("user", toolRun.contextMessage),
        createMessage("user", createLocalToolFinalInstruction(prompt)),
      ];
      passIndex = recoveryPassIndex + 1;
      return null;
    }

    async function synthesizeAnswerFromSavedToolResults(
      synthesisMessages: ChatMessage[],
      detail: string,
      synthesisToolBridge?: ProviderToolBridgeOptions,
    ): Promise<typeof finalResponse | null> {
      if (isRequestInactive(requestId, controller)) {
        return null;
      }

      const activeProgress: ChatProgressItem = allToolCalls.length > 0
        ? createLocalComputerProgress("active", "Writing final answer from gathered tool results")
        : {
            detail: "Continuing from the work log",
            id: "final-answer-recovery",
            label: "Thinking",
            status: "active",
          };
      updateGeneratedMessage(chatId, messageId, (message) => ({
        ...message,
        content: "",
        progress: withLocalComputerProgress(activeProgress, message.progress),
        toolCalls: allToolCalls.length > 0 ? allToolCalls : message.toolCalls,
      }));
      onExternalUpdate?.({
        progress: activeProgress,
        status: allToolCalls.length > 0 ? "Writing final answer from gathered tool results..." : "Continuing from the work log...",
      });

      const baseSynthesisSettings = createFinalOnlyProviderSettings(prompt, runtimeChat, providerSettingsOverrides ?? {});
      const synthesisSettings: ProviderSettings = {
        ...baseSynthesisSettings,
        maxTokens: Math.max(baseSynthesisSettings.maxTokens, LOCAL_TOOL_FINAL_MIN_TOKENS),
        thinking: {
          ...baseSynthesisSettings.thinking,
          enabled: false,
          effort: "low",
        },
        temperature: Math.min(baseSynthesisSettings.temperature, 0.25),
      };
      const synthesisRetries = [
        "",
        [
          "The previous final-answer attempt exposed internal runtime state instead of answering the user.",
          "Rewrite only the user-facing answer. Do not mention the app, provider, tool loop, tool calls, saved evidence, continuation, fallback, or recovery.",
        ].join("\n"),
      ];

      for (const retryInstruction of synthesisRetries) {
        const synthesisDetail = [
          allToolCalls.length > 0
            ? `The prior tool pass supplied ${totalExecutedToolCalls} observation${totalExecutedToolCalls === 1 ? "" : "s"} for this request.`
            : "Use the conversation, web-search, and local workspace context already provided above as evidence.",
          detail,
          "Use those observations silently and write only the visible answer the user asked for.",
          retryInstruction,
        ].filter(Boolean).join("\n");
        const synthesisInstruction = allToolCalls.length > 0
          ? createLocalToolBudgetFinalInstruction(prompt, synthesisDetail)
          : createFinalAnswerRecoveryInstruction(prompt, synthesisDetail);
        const synthesisCompaction = compactProviderMessages([...synthesisMessages, createMessage("user", synthesisInstruction)], synthesisSettings, {
          toolBridge: synthesisToolBridge,
        });

        if (synthesisCompaction.contextCompaction) {
          const compactionProgress = createContextCompactionProgress(synthesisCompaction);

          updateGeneratedMessage(chatId, messageId, (message) => ({
            ...withContextCompactionMarker(message, synthesisCompaction.contextCompaction),
            progress: withContextCompactionProgress(compactionProgress, message.progress),
          }));
        }

        try {
          recordProviderContextUsage(chatId, synthesisCompaction.messages, synthesisSettings, { stream: false, toolBridge: synthesisToolBridge });
          const response = await sendProviderMessage(synthesisSettings, synthesisCompaction.messages, {
            contextWindowTokens: resolveContextWindowForModel(synthesisSettings.model, synthesisSettings).tokens,
            signal: controller.signal,
            toolBridge: synthesisToolBridge,
          });
          recordProviderActualUsage(chatId, synthesisCompaction.messages, synthesisSettings, response.usage, { stream: false, toolBridge: synthesisToolBridge });

          if (isRequestInactive(requestId, controller)) {
            return null;
          }

          const content = sanitizeLocalToolCallsForDisplay(response.content, toolExecutionPolicy).trim();

          if (
            !content ||
            looksLikeOnlyToolPrelude(content) ||
            looksLikeInternalToolRecoveryAnswer(content) ||
            looksLikeFabricatedToolProgress(content, allToolCalls) ||
            isVisibleToolResultLeak(content, allToolCalls)
          ) {
            continue;
          }

          return {
            content,
            artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
            progress: localProgress,
            sources: allSources.length > 0 ? allSources : undefined,
            toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
          };
        } catch (error) {
          if (isAbortError(error) || isRequestInactive(requestId, controller)) {
            throw error;
          }

          return null;
        }
      }

      return null;
    }

    function createBridgeSynthesisToolBridgeOptions(): ProviderToolBridgeOptions | undefined {
      const synthesisToolResultMessages = getSynthesisToolResultMessages();
      return synthesisToolResultMessages.length > 0
        ? {
            maxToolResultContentChars: getModelVisibleToolResultCharBudget(contextWindowRef.current.tokens),
            toolChoice: "none",
            toolResultDelivery: "inline-user-message",
            toolResultMessages: synthesisToolResultMessages,
            tools: [],
          }
        : undefined;
    }

    function getSynthesisToolResultMessages() {
      const successfulMessages = bridgeToolResultMessages.filter((message) => message.result.ok);

      return successfulMessages.length > 0 ? successfulMessages : bridgeToolResultMessages;
    }

    function createBridgeToolContinuationInstruction(run: ToolBridgeExecutionBatch) {
      const handledCount = getBridgeHandledCount(run);
      const failedCount = Math.max(0, handledCount - run.executedCount);
      const recoverableFailureGuidance = createBridgeRunRecoverableFailureGuidance(run);
      const mutationEvidence = createBridgeRunMutationEvidence(run);
      return [
        "BRIDGE TOOL RESULTS AVAILABLE",
        `Original user request: ${prompt}`,
        `The app just handled ${handledCount} bridge tool call${handledCount === 1 ? "" : "s"}: ${run.executedCount} succeeded, ${failedCount} failed or was skipped.`,
        "Use the attached tool result messages as current evidence.",
        mutationEvidence,
        failedCount > 0 ? "If a tool failed because the arguments were invalid JSON or failed validation, retry the operation with corrected valid JSON instead of stopping on the raw error." : "",
        recoverableFailureGuidance,
        "If more work is needed, emit the next needed tool call now.",
        "If the request is done, write the normal final answer now.",
        "Do not answer with a raw tool result, tool recap, Latest completed result, recovery note, or continuation note.",
      ].filter(Boolean).join("\n\n");
    }

    function createBridgeRunMutationEvidence(run: ToolBridgeExecutionBatch) {
      const changedPaths = collectBridgeRunChangedPaths(run);

      if (changedPaths.length === 0) {
        return "";
      }

      const preview = changedPaths.slice(0, 8).join(", ");
      const remaining = changedPaths.length > 8 ? `, and ${changedPaths.length - 8} more` : "";

      return [
        `Successful workspace file changes are already applied to ${changedPaths.length} file${changedPaths.length === 1 ? "" : "s"}: ${preview}${remaining}.`,
        "Do not say you only have read-only evidence, no edit result, or no write result for those files. Continue from the successful mutation result.",
      ].join("\n");
    }

    function collectBridgeRunChangedPaths(run: ToolBridgeExecutionBatch) {
      const paths = new Set<string>();

      for (const toolCall of run.toolCalls) {
        if (toolCall.status !== "complete") {
          continue;
        }

        const toolId = toolCall.toolId ?? "";
        const isMutatingFileTool =
          /^files_(?:append|apply_patch|create_directory|edit_many|exact_replace|insert_at_line|move|replace_range|replace_span|write|write_many)\b/i.test(toolId) ||
          toolCall.batchSummary?.operation === "edit" ||
          toolCall.batchSummary?.operation === "write" ||
          (toolCall.fileChanges?.length ?? 0) > 0;

        if (!isMutatingFileTool) {
          continue;
        }

        for (const result of toolCall.batchFileResults ?? []) {
          if (result.status === "ok") {
            paths.add(result.path);
          }
        }

        for (const change of toolCall.fileChanges ?? []) {
          paths.add(change.path);
        }
      }

      return [...paths];
    }

    function createBridgeRunRecoverableFailureGuidance(run: ToolBridgeExecutionBatch) {
      const failedOutputs = run.steps
        .filter((step) => !step.result.ok)
        .map((step) => step.result.content || step.result.error || step.result.skippedReason || "")
        .filter(Boolean);

      if (failedOutputs.some((output) => /try\s+files_read\s+on\s+one\s+of:/i.test(output) || /a directory named .+ exists/i.test(output))) {
        return [
          "A failed file read included candidate paths.",
          "Do not stop on that error. Pick the closest suggested file path and retry files_read/files_read_range now.",
        ].join("\n");
      }

      if (failedOutputs.some((output) => /try\s+files_search\s+with\s+query/i.test(output) || isMissingFileReadError(output))) {
        return [
          "A failed file read did not have a direct path match.",
          "Do not stop on that error. Use files_search to locate the file by name before answering that it is missing.",
        ].join("\n");
      }

      if (failedOutputs.some((output) => /cannot replace lines \d+-\d+[\s\S]{0,160}\bfile has \d+ line/i.test(output) || /line range is stale/i.test(output))) {
        return [
          "A range edit used stale or out-of-bounds line numbers.",
          "Do not retry the same range. Re-read the current file or nearby section, then retry with files_edit_many using exact_replace or files_apply_patch anchored to current text.",
          "Use replace_range again only when the fresh read gives the exact current line numbers.",
        ].join("\n");
      }

      if (failedOutputs.some((output) => /\bchanged since it was last read\b/i.test(output))) {
        return [
          "An edit used a stale file hash.",
          "Do not stop on that error. Re-read the current file or nearby section, then retry the same edit against the latest content.",
          "For append or exact_replace, omit stale expectedSha256 on retry and anchor to the current text; for line or column edits, use fresh coordinates from the new read.",
        ].join("\n");
      }

      if (failedOutputs.some((output) => /\barguments\.paths?\s+is\s+required\b/i.test(output))) {
        return [
          "A workspace file read tool was called without a path.",
          "Do not stop on that validation error. If the intent is project discovery, call files_tree_summary or files_list with path \".\" now.",
          "If the intent is to read a specific file, call files_search first to find the path, then read the matching file.",
        ].join("\n");
      }

      if (failedOutputs.some((output) => /\b(arguments?|maxBytes|offset|replaceAll)\b[\s\S]{0,120}\b(?:must be|is not allowed|invalid|required)\b/i.test(output))) {
        return "A tool argument shape failed validation. Retry the same intent with corrected argument types and only schema-supported keys. If a required path is unknown, discover it with files_search/files_tree_summary before reading.";
      }

      return "";
    }

    function getBridgeHandledCount(run: ToolBridgeExecutionBatch) {
      return run.handledCount || run.resultMessages.length || run.requestedCount;
    }

    function applyBridgeRunSideEffects(run: ToolBridgeExecutionBatch, toolCalls: ChatToolCall[]) {
      attachLiveTerminalSession(toolCalls);

      const sources = findBridgeRunSources(run);
      if (sources.length > 0) {
        allSources = mergeChatSources(allSources, sources);
        updateGeneratedMessage(chatId, messageId, (message) => ({
          ...message,
          sources: mergeChatSources(message.sources, sources),
        }));
      }

      const artifacts = findBridgeRunArtifacts(run);
      if (artifacts.length > 0) {
        allArtifacts = mergeChatArtifacts(allArtifacts, artifacts) ?? [];
        updateGeneratedMessage(chatId, messageId, (message) => ({
          ...message,
          artifacts: mergeChatArtifacts(message.artifacts, artifacts),
        }));
      }

      const previewUrl = findBridgeRunBrowserPreviewUrl(run);
      if (!previewUrl || !toolSettings.browserPreview) {
        return;
      }

      setBrowserPreviewTarget((currentTarget) => ({
        id: (currentTarget?.id ?? 0) + 1,
        url: previewUrl,
      }));
    }

    function findBridgeRunBrowserPreviewUrl(run: ToolBridgeExecutionBatch) {
      for (const step of [...run.steps].reverse()) {
        const data = step.result.data;

        if (!data || typeof data !== "object" || Array.isArray(data)) {
          continue;
        }

        const record = data as Record<string, unknown>;
        const candidate = typeof record.browserPreviewUrl === "string"
          ? record.browserPreviewUrl
          : typeof record.url === "string"
            ? record.url
            : undefined;

        if (candidate) {
          return candidate;
        }
      }

      return undefined;
    }

    function findBridgeRunSources(run: ToolBridgeExecutionBatch) {
      const sources = run.steps.flatMap((step) => {
        if (step.chatToolCall.toolId !== "web_search") {
          return [];
        }

        const data = step.result.data;

        if (!data || typeof data !== "object" || Array.isArray(data) || !("sources" in data)) {
          return [];
        }

        const rawSources = (data as { sources?: unknown }).sources;
        if (!Array.isArray(rawSources)) {
          return [];
        }

        return rawSources.flatMap((source, index) => normalizeBridgeSource(source, index));
      });

      return mergeChatSources(undefined, sources);
    }

    function findBridgeRunArtifacts(run: ToolBridgeExecutionBatch) {
      const artifacts = run.steps.flatMap((step) => {
        const data = step.result.data;

        if (!data || typeof data !== "object" || Array.isArray(data) || !("artifacts" in data)) {
          return [];
        }

        const rawArtifacts = (data as { artifacts?: unknown }).artifacts;
        if (!Array.isArray(rawArtifacts)) {
          return [];
        }

        return rawArtifacts.flatMap((artifact, index) => normalizeBridgeArtifact(artifact, index));
      });

      return mergeChatArtifacts(undefined, artifacts) ?? [];
    }

    function normalizeBridgeArtifact(artifact: unknown, index: number): ChatArtifact[] {
      if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
        return [];
      }

      const record = artifact as Record<string, unknown>;
      const title = typeof record.title === "string" && record.title.trim()
        ? record.title.trim()
        : `generated-artifact-${index + 1}`;
      const url = typeof record.url === "string" && record.url.trim() ? record.url.trim() : undefined;
      const sourceText = typeof record.sourceText === "string" && record.sourceText.trim() ? record.sourceText : undefined;
      const sizeBytes = typeof record.sizeBytes === "number" && Number.isFinite(record.sizeBytes) ? Math.max(0, Math.round(record.sizeBytes)) : undefined;
      const sourceFormat = record.sourceFormat === "markdown" || record.sourceFormat === "text" ? record.sourceFormat : undefined;
      const width = typeof record.width === "number" && Number.isFinite(record.width) ? Math.max(1, Math.round(record.width)) : undefined;
      const height = typeof record.height === "number" && Number.isFinite(record.height) ? Math.max(1, Math.round(record.height)) : undefined;

      if (!url && !sourceText) {
        return [];
      }

      return [{
        detail: typeof record.detail === "string" && record.detail.trim() ? record.detail.trim() : undefined,
        height,
        id: typeof record.id === "string" && record.id.trim() ? record.id.trim() : `bridge-artifact-${index + 1}`,
        kind: normalizeBridgeArtifactKind(record.kind),
        mimeType: typeof record.mimeType === "string" && record.mimeType.trim() ? record.mimeType.trim() : undefined,
        sizeBytes,
        sourceFormat,
        sourceText,
        title,
        url,
        width,
      }];
    }

    function normalizeBridgeArtifactKind(value: unknown): ChatArtifact["kind"] {
      return value === "code" || value === "document" || value === "file" || value === "image" || value === "other" || value === "preview"
        ? value
        : undefined;
    }

    function createBridgeRunVisualEvidenceMessages(run: ToolBridgeExecutionBatch): ChatMessage[] {
      const attachments = findBridgeRunVisualEvidenceAttachments(run);

      if (attachments.length === 0) {
        return [];
      }

      const names = attachments.map((attachment) => attachment.name).join(", ");

      return [
        createMessage(
          "user",
          [
            "BROWSER SCREENSHOT EVIDENCE",
            `The attached image${attachments.length === 1 ? "" : "s"} came from browser_screenshot_capture in this same app tool run: ${names}.`,
            "Use the screenshot as visual evidence for layout, rendering, browser UI, and before/after verification. If more work is needed, continue with file edits, terminal checks, browser console reads, and another screenshot.",
          ].join("\n\n"),
          undefined,
          undefined,
          attachments,
        ),
      ];
    }

    function findBridgeRunVisualEvidenceAttachments(run: ToolBridgeExecutionBatch): ChatAttachment[] {
      const artifacts = findBridgeRunArtifacts(run);

      return artifacts
        .filter((artifact) => artifact.kind === "image" && typeof artifact.url === "string" && artifact.url.startsWith("data:image/"))
        .slice(-1)
        .map((artifact, index) => {
          const mimeType = artifact.mimeType || readDataUrlMimeType(artifact.url) || "image/png";

          return {
            createdAt: new Date().toISOString(),
            dataUrl: artifact.url!,
            height: artifact.height,
            id: artifact.id || `bridge-visual-evidence-${index + 1}`,
            kind: "image",
            mimeType,
            name: artifact.title || `Browser screenshot ${index + 1}`,
            size: artifact.sizeBytes ?? estimateDataUrlBytes(artifact.url!),
            width: artifact.width,
          };
        });
    }

    function readDataUrlMimeType(dataUrl: string) {
      return dataUrl.match(/^data:([^;,]+)[;,]/i)?.[1];
    }

    function estimateDataUrlBytes(dataUrl: string) {
      const base64 = dataUrl.includes(",") ? dataUrl.split(",").pop() ?? "" : dataUrl;

      return Math.max(0, Math.floor((base64.length * 3) / 4));
    }

    function normalizeBridgeSource(source: unknown, index: number): ChatSource[] {
      if (!source || typeof source !== "object" || Array.isArray(source)) {
        return [];
      }

      const record = source as Record<string, unknown>;
      const title = typeof record.title === "string" ? record.title.trim() : "";
      const url = typeof record.url === "string" ? record.url.trim() : "";

      if (!title || !url) {
        return [];
      }

      return [{
        detail: typeof record.detail === "string" ? record.detail : undefined,
        id: typeof record.id === "string" ? record.id : `bridge-web-source-${index + 1}`,
        imageUrl: typeof record.imageUrl === "string" ? record.imageUrl : undefined,
        sourceType: normalizeBridgeSourceType(record.sourceType),
        thumbnailUrl: typeof record.thumbnailUrl === "string" ? record.thumbnailUrl : undefined,
        title,
        url,
      }];
    }

    function normalizeBridgeSourceType(value: unknown): ChatSource["sourceType"] {
      return value === "answer" || value === "image" || value === "news" || value === "place" || value === "video" || value === "web" ? value : undefined;
    }

    function formatBridgeToolRunProgress(run: ToolBridgeExecutionBatch, noun: string) {
      const handledCount = getBridgeHandledCount(run);
      const pluralNoun = `${noun}${handledCount === 1 ? "" : "s"}`;

      if (handledCount === 0) {
        return `No ${noun}s ran`;
      }

      if (run.executedCount === handledCount) {
        return `${handledCount} ${pluralNoun} ran`;
      }

      if (run.executedCount === 0) {
        return `${handledCount} ${pluralNoun} handled with errors`;
      }

      return `${run.executedCount} of ${handledCount} ${pluralNoun} ran`;
    }

    function serializeBridgeToolApprovalResume(calls: ToolCallRequest[], reasoningState?: ProviderReasoningState) {
      return JSON.stringify({
        calls,
        kind: BRIDGE_TOOL_APPROVAL_RESUME_KIND,
        reasoningState,
        version: 1,
      });
    }

    function parseBridgeToolApprovalResume(content: string | undefined): { calls: ToolCallRequest[]; reasoningState?: ProviderReasoningState } | null {
      if (!content) {
        return null;
      }

      try {
        const parsed = JSON.parse(content) as { calls?: unknown; kind?: unknown; reasoningState?: unknown };

        if (parsed.kind !== BRIDGE_TOOL_APPROVAL_RESUME_KIND || !Array.isArray(parsed.calls)) {
          return null;
        }

        const calls = parsed.calls.filter((call): call is ToolCallRequest =>
          Boolean(
            call &&
              typeof call === "object" &&
              typeof (call as ToolCallRequest).id === "string" &&
              typeof (call as ToolCallRequest).name === "string" &&
              typeof (call as ToolCallRequest).provider === "string",
          ),
        );
        const reasoningState = isProviderReasoningState(parsed.reasoningState) ? parsed.reasoningState : undefined;

        return calls.length > 0 ? { calls, reasoningState } : null;
      } catch {
        return null;
      }
    }

    function isProviderReasoningState(value: unknown): value is ProviderReasoningState {
      return Boolean(
        value &&
          typeof value === "object" &&
          Array.isArray((value as ProviderReasoningState).entries) &&
          typeof (value as ProviderReasoningState).format === "string" &&
          typeof (value as ProviderReasoningState).provider === "string",
      );
    }

    function createBridgeApprovalShell(call: ToolCallRequest, tool: ToolDefinition, preview?: string, reasoningState?: ProviderReasoningState): AgentApproval {
      const args = typeof call.arguments === "object" && call.arguments !== null && !Array.isArray(call.arguments) ? call.arguments as Record<string, unknown> : undefined;
      const command = formatBridgeApprovalCommand(args);
      const path = formatBridgeApprovalPath(args);
      const kind = bridgeApprovalKind(tool);

      return {
        args,
        command,
        createdAt: new Date().toISOString(),
        detail: formatBridgeApprovalDetail(tool, command, path),
        id: createId("approval"),
        kind,
        path,
        preview,
        resumeToolCallContent: serializeBridgeToolApprovalResume([call], reasoningState),
        risk: bridgeApprovalRisk(tool),
        status: "pending",
        title: tool.title,
        tool: tool.id,
        toolCallId: call.id,
      };
    }

    function formatBridgeApprovalCommand(args: Record<string, unknown> | undefined) {
      return typeof args?.command === "string" && args.command.trim() ? args.command.trim() : undefined;
    }

    function formatBridgeApprovalPath(args: Record<string, unknown> | undefined) {
      if (!args) {
        return undefined;
      }

      if (typeof args.fromPath === "string" && typeof args.toPath === "string") {
        return `${args.fromPath} -> ${args.toPath}`;
      }

      if (Array.isArray(args.files)) {
        const paths = args.files.flatMap((item) =>
          item && typeof item === "object" && !Array.isArray(item) && typeof (item as { path?: unknown }).path === "string"
            ? [(item as { path: string }).path]
            : [],
        );
        return formatBatchApprovalPath(paths, "file");
      }

      if (Array.isArray(args.edits)) {
        const paths = args.edits.flatMap((item) =>
          item && typeof item === "object" && !Array.isArray(item) && typeof (item as { path?: unknown }).path === "string"
            ? [(item as { path: string }).path]
            : [],
        );
        return formatBatchApprovalPath(paths, "file");
      }

      if (Array.isArray(args.paths)) {
        return formatBatchApprovalPath(args.paths.filter((path): path is string => typeof path === "string"), "path");
      }

      if (typeof args.path === "string" && args.path.trim()) {
        return args.path.trim();
      }

      if (typeof args.cwd === "string" && args.cwd.trim()) {
        return args.cwd.trim();
      }

      if (typeof args.workingDirectory === "string" && args.workingDirectory.trim()) {
        return args.workingDirectory.trim();
      }

      if (typeof args.url === "string" && args.url.trim()) {
        return args.url.trim();
      }

      return undefined;
    }

    function formatBatchApprovalPath(paths: string[], noun: "file" | "path") {
      const uniquePaths = [...new Set(paths.filter((path) => path.trim()).map((path) => path.trim()))];

      if (uniquePaths.length === 0) {
        return undefined;
      }

      if (uniquePaths.length === 1) {
        return uniquePaths[0];
      }

      return `${uniquePaths.length} ${noun}${uniquePaths.length === 1 ? "" : "s"}: ${uniquePaths.slice(0, 3).join(", ")}${uniquePaths.length > 3 ? ` and ${uniquePaths.length - 3} more` : ""}`;
    }

    function formatBridgeApprovalDetail(tool: ToolDefinition, command: string | undefined, path: string | undefined) {
      if (tool.executorMetadata?.family === "terminal" || tool.id === "terminal_run") {
        return [
          `${tool.title} wants to run a local command.`,
          command ? `Command: ${command}` : "",
          path ? `cwd: ${path}` : "",
        ].filter(Boolean).join("\n");
      }

      if (tool.executorMetadata?.family === "browser") {
        return path ? `${tool.title} wants to open ${path}.` : `${tool.title} wants to open the in-app browser preview.`;
      }

      return path ? `${tool.title} wants to change ${path}.` : `${tool.title} needs approval before it runs.`;
    }

    function bridgeApprovalKind(tool: ToolDefinition): AgentApproval["kind"] {
      const toolId = tool.id;

      if (tool.executorMetadata?.family === "terminal" || toolId === "terminal_run") {
        return "terminal";
      }

      if (tool.executorMetadata?.family === "browser") {
        return "browser";
      }

      if (toolId === "files_write" || toolId === "files_write_many") {
        return "write";
      }

      if (
        toolId === "files_exact_replace" ||
        toolId === "files_insert_at_line" ||
        toolId === "files_replace_range" ||
        toolId === "files_append" ||
        toolId === "files_edit_many" ||
        toolId === "files_apply_patch" ||
        toolId === "files_move"
      ) {
        return "edit";
      }

      return "custom_tool";
    }

    function bridgeApprovalRisk(tool: ToolDefinition): AgentApproval["risk"] {
      if (tool.risk === "terminal" || tool.risk === "destructive" || tool.risk === "credential" || tool.risk === "publish") {
        return "high";
      }

      if (tool.risk === "read" || tool.permission === "read-only") {
        return "low";
      }

      return "medium";
    }

    async function createBridgeApprovalPreview(tool: ToolDefinition, call: ToolCallRequest, bridgeContext: ToolExecutionContext) {
      const validation = validateToolArguments(tool, call.arguments);

      if (!validation.ok || !validation.args) {
        return validation.error || "Invalid tool arguments.";
      }

      try {
        const preview = await tool.execute({ ...validation.args, dryRun: true }, bridgeContext);
        return preview.content;
      } catch (error) {
        return error instanceof Error ? error.message : "Could not preview this tool call.";
      }
    }

    async function collectPendingBridgeApprovals(calls: ToolCallRequest[], bridgeContext: ToolExecutionContext) {
      const runtimeDecisions = createRuntimeApprovalDecisions(workspaceSettings, approvalDecisions, chatId) ?? {};
      const approvals: AgentApproval[] = [];
      const waitingToolCalls: ChatToolCall[] = [];

      for (const call of calls) {
        const tool = bridgeRegistry.get(call.name);

        if (!tool) {
          continue;
        }

        const permission = resolveToolPermission(tool, bridgeContext);

        if (permission.allowed || !permission.requiresApproval) {
          continue;
        }

        if (call.argumentsParseError) {
          continue;
        }

        const validation = validateToolArguments(tool, call.arguments);
        if (!validation.ok) {
          continue;
        }

        const normalizedCall = validation.args ? { ...call, arguments: validation.args } : call;
        const shell = createBridgeApprovalShell(normalizedCall, tool, undefined, bridgeReasoningState);
        const reusableDecision = runtimeDecisions[createApprovalSessionDecisionKey(shell)];

        if (reusableDecision?.status === "approved") {
          continue;
        }

        const preview = await createBridgeApprovalPreview(tool, normalizedCall, bridgeContext);
        const approval = createBridgeApprovalShell(normalizedCall, tool, preview, bridgeReasoningState);
        approvals.push(approval);
        waitingToolCalls.push(createBridgeChatToolCall(
          normalizedCall,
          tool,
          { content: preview || permission.reason || "Approval required before this tool action can run.", ok: true },
          "waiting_approval",
        ));
      }

      return {
        approvals,
        waitingToolCalls,
      };
    }

    function applyEditedBridgeApprovalArgs(calls: ToolCallRequest[], decision?: AgentApprovalDecision) {
      if (decision?.status !== "edited" || !decision.editedArgs) {
        return calls;
      }

      const [firstCall, ...restCalls] = calls;

      return firstCall
        ? [{ ...firstCall, arguments: decision.editedArgs, raw: undefined }, ...restCalls]
        : calls;
    }

    function bridgeApprovalEditRequiresProviderRevision(calls: ToolCallRequest[], decision?: AgentApprovalDecision) {
      return Boolean(
        decision?.status === "edited" &&
          decision.editedArgs &&
          calls.some((call) => call.provider === "google" && hasGoogleThoughtSignature(call.raw)),
      );
    }

    function hasGoogleThoughtSignature(raw: unknown) {
      if (!raw || typeof raw !== "object") {
        return false;
      }

      const extraContent = (raw as { extra_content?: unknown }).extra_content;
      if (!extraContent || typeof extraContent !== "object") {
        return false;
      }

      const google = (extraContent as { google?: unknown }).google;
      return Boolean(
        google &&
          typeof google === "object" &&
          typeof (google as { thought_signature?: unknown }).thought_signature === "string" &&
          (google as { thought_signature: string }).thought_signature.trim(),
      );
    }

    function getBridgeCallFamilies(calls: ToolCallRequest[]): ToolBridgeToolFamily[] {
      return [...new Set(calls.flatMap((call) => {
        const family = bridgeRegistry.get(call.name)?.executorMetadata?.family;
        return family ? [family] : [];
      }))];
    }

    function formatApprovalRevisionOriginalCalls(calls: ToolCallRequest[]) {
      return JSON.stringify(calls.map((call) => ({
        arguments: call.arguments,
        name: call.name,
      })), null, 2);
    }

    async function createApprovalRevisionFallbackResponse(
      assistantContent: string,
      bridgeContext: ToolExecutionContext,
      fallbackPassIndex: number,
    ): Promise<typeof finalResponse | null> {
      if (!pendingApprovalRevision) {
        return null;
      }

      const revisedCalls = createFallbackRevisionBridgeCalls(
        pendingApprovalRevision.calls,
        assistantContent,
        (call) => bridgeRegistry.get(call.name)?.executorMetadata?.family,
      );
      const approvals: AgentApproval[] = [];
      const waitingToolCalls: ChatToolCall[] = [];

      for (const call of revisedCalls) {
        const tool = bridgeRegistry.get(call.name);

        if (!tool) {
          continue;
        }

        const validation = validateToolArguments(tool, call.arguments);
        if (!validation.ok) {
          continue;
        }

        const normalizedCall = validation.args ? { ...call, arguments: validation.args } : call;
        const preview = await createBridgeApprovalPreview(tool, normalizedCall, bridgeContext);
        const approval = {
          ...createBridgeApprovalShell(normalizedCall, tool, preview),
          detail: "Review the revised action before it runs. Gilbert rebuilt this approval after the edit request so nothing can send or change silently.",
          messageId,
        };

        approvals.push(approval);
        waitingToolCalls.push(createBridgeChatToolCall(
          normalizedCall,
          tool,
          { content: preview || "Review the revised action before it runs.", ok: true },
          "waiting_approval",
        ));
      }

      if (approvals.length === 0) {
        return null;
      }

      const approvalProgress = createLocalComputerProgress("pending", "Revised tool approval required");
      const waitingStampedToolCalls = stampLocalToolCallIds(waitingToolCalls, fallbackPassIndex);

      finalResponse = {
        approvalRequests: approvals,
        content: "",
        pendingToolCallContent: approvals[0]?.resumeToolCallContent,
        progress: approvalProgress,
        toolCalls: [...allToolCalls, ...waitingStampedToolCalls],
        waitingForApproval: true,
      };

      updateGeneratedMessage(chatId, messageId, (message) => ({
        ...withStreamingWorkThinking(message, createVisibleToolApprovalThinking(waitingStampedToolCalls), "complete"),
        agentRunStatus: "waiting_for_approval",
        approvals: mergeAgentApprovals(message.approvals ?? [], approvals),
        content: "",
        progress: withLocalComputerProgress(approvalProgress, message.progress),
        toolCalls: finalResponse.toolCalls,
      }));
      onExternalUpdate?.({
        progress: approvalProgress,
        status: "Revised tool approval is needed in Gilbert Codex.",
        toolCall: waitingStampedToolCalls[0],
      });

      return finalResponse;
    }

    function createPlainTextRevisionBridgeCalls(calls: ToolCallRequest[], assistantContent: string): ToolCallRequest[] {
      return calls.map((call) => {
        const tool = bridgeRegistry.get(call.name);
        const family = tool?.executorMetadata?.family;

        if (family === "gmail") {
          return reviseGmailBridgeCallFromPlainText(call, assistantContent);
        }

        return call;
      });
    }

    function reviseGmailBridgeCallFromPlainText(call: ToolCallRequest, assistantContent: string): ToolCallRequest {
      const args = recordFromUnknown(call.arguments);
      const parsed = parsePlainTextEmailRevision(assistantContent);

      if (!parsed) {
        return call;
      }

      return {
        ...call,
        arguments: {
          ...args,
          ...(parsed.to.length > 0 ? { to: parsed.to } : {}),
          ...(parsed.subject ? { subject: parsed.subject } : {}),
          ...(parsed.body ? { body: parsed.body } : {}),
          inReplyTo: cleanOptionalEmailMetadata(args.inReplyTo),
          references: cleanOptionalEmailMetadata(args.references),
          threadId: cleanOptionalEmailMetadata(args.threadId),
        },
      };
    }

    function recordFromUnknown(value: unknown): Record<string, unknown> {
      return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    }

    function parsePlainTextEmailRevision(value: string) {
      const text = value.replace(/\r\n/g, "\n").trim();
      const to = parseEmailRevisionRecipients(readLabeledValue(text, "To"));
      const subject = readLabeledValue(text, "Subject");
      const body = readLabeledBlock(text, "Body");

      if (to.length === 0 && !subject && !body) {
        return null;
      }

      return {
        body: body ? cleanRevisedEmailBody(body) : undefined,
        subject: subject ? stripMarkdownFormatting(subject) : undefined,
        to,
      };
    }

    function readLabeledValue(text: string, label: string) {
      const match = text.match(new RegExp(`^\\s*(?:[-*]\\s*)?(?:\\*\\*)?${label}(?:\\*\\*)?\\s*:\\s*(.+)$`, "im"));
      return match?.[1]?.trim();
    }

    function readLabeledBlock(text: string, label: string) {
      const match = text.match(new RegExp(`^\\s*(?:[-*]\\s*)?(?:\\*\\*)?${label}(?:\\*\\*)?\\s*:\\s*\\n?([\\s\\S]*)$`, "im"));

      if (!match?.[1]) {
        return undefined;
      }

      return match[1]
        .replace(/\n\s*(?:Reply|Respond|Please confirm|Tell me|Say ["“']?send|Press send)\b[\s\S]*$/i, "")
        .trim();
    }

    function parseEmailRevisionRecipients(value?: string) {
      if (!value) {
        return [];
      }

      return value
        .split(/[,;]/)
        .map((item) => item.trim())
        .flatMap((item) => {
          const match = item.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
          return match ? [match[0]] : [];
        });
    }

    function cleanRevisedEmailBody(value: string) {
      return value
        .replace(/^\s*```(?:text|markdown)?\s*/i, "")
        .replace(/\s*```\s*$/i, "")
        .trim();
    }

    function stripMarkdownFormatting(value: string) {
      return value
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/^>\s?/gm, "")
        .trim();
    }

    function cleanOptionalEmailMetadata(value: unknown) {
      if (typeof value !== "string") {
        return undefined;
      }

      const normalized = value.trim();
      return normalized && !/^[-—]+$/.test(normalized) ? normalized : undefined;
    }

    const approvedBridgeResume = parseBridgeToolApprovalResume(resumeToolCallContent);

    if (approvedBridgeResume) {
      const submittedDecision = Object.values(approvalDecisions ?? {})[0];
      bridgeReasoningState = approvedBridgeResume.reasoningState ?? bridgeReasoningState;

      if (submittedDecision?.status === "denied") {
        const deniedProgress = createLocalComputerProgress("complete", "Approved tool action was denied");
        const deniedToolCalls = stampLocalToolCallIds(
          approvedBridgeResume.calls.map((call) =>
            createBridgeChatToolCall(call, bridgeRegistry.get(call.name), { content: "Approval denied. No tool action ran.", ok: false, skippedReason: "Approval denied." }, "skipped"),
          ),
          passIndex,
        );

        return {
          content: "Approval denied. No tool action ran.",
          progress: deniedProgress,
          toolCalls: deniedToolCalls,
        };
      }

      const revisionNote = submittedDecision?.status === "edited" && !submittedDecision.editedArgs
        ? submittedDecision.note?.trim()
        : "";
      const signedEditRequiresProviderRevision = bridgeApprovalEditRequiresProviderRevision(approvedBridgeResume.calls, submittedDecision);

      if (revisionNote || signedEditRequiresProviderRevision) {
        const revisionInstruction = revisionNote
          ? `User requested changes: ${revisionNote}`
          : `User edited the pending tool arguments to this JSON. Reissue the tool call with these arguments so the provider can create a fresh signed call: ${JSON.stringify(submittedDecision?.editedArgs ?? {})}`;
        const revisionProgress = createLocalComputerProgress("active", "Revising approved tool action");
        approvalRevisionPrompt = [
          prompt,
          "Revise the pending approval tool arguments.",
          revisionInstruction,
          "Original pending tool call JSON:",
          formatFallbackRevisionOriginalCalls(approvedBridgeResume.calls),
        ].join("\n");
        approvalRevisionRequiredFamilies = getBridgeCallFamilies(approvedBridgeResume.calls);
        approvalRevisionRequiresToolCall = true;
        pendingApprovalRevision = {
          calls: approvedBridgeResume.calls,
          note: revisionNote || revisionInstruction,
          requiredFamilies: approvalRevisionRequiredFamilies,
        };

        updateGeneratedMessage(chatId, messageId, (message) => ({
          ...withStreamingWorkThinking(message, "I\u2019m revising the pending tool action before it runs.", "active"),
          agentRunStatus: "running",
          content: "",
          progress: withLocalComputerProgress(revisionProgress, message.progress),
        }));

        messages = [
          ...messages,
          createMessage("user", [
            "REVISE PENDING TOOL ACTION",
            "The previous tool action was not approved as written.",
            revisionInstruction,
            "Original pending tool call JSON:",
            formatFallbackRevisionOriginalCalls(approvedBridgeResume.calls),
            "You must call the appropriate attached tool again with revised arguments. Do not answer with a plain-text draft or prose confirmation. The app will show a new approval card before anything runs.",
          ].join("\n")),
        ];
        localProgress = revisionProgress;
        passIndex += 1;
        resumeToolCallContent = undefined;
      } else {
      const activeProgress = createLocalComputerProgress("active", "Running approved tool action");
      const resumeBridgeContext: ToolExecutionContext = {
        agentEnvironment: baseRuntimeSettings.agentEnvironment ?? generalSettings.agentEnvironment,
        automationScope,
        memorySearch,
        model: baseRuntimeSettings.model,
        permissionMode: workspaceSettings.permissionMode,
        provider: baseRuntimeSettings.provider,
        providerApiKey: baseRuntimeSettings.apiKeys[baseRuntimeSettings.provider]?.trim() || "",
        signal: controller.signal,
        terminalDefaultShell: generalSettings.terminalShell,
        webSearchMaxResults: runtimeWebSearchMaxResults,
        webSearchSettings: runtimeWebSearchSettings,
        workspaceRoots: enabledWorkspaceRoots,
      };
      const approvedBridgeResumeCalls = applyEditedBridgeApprovalArgs(approvedBridgeResume.calls, submittedDecision);
      const activeApprovedBridgeToolCalls = createActiveBridgeToolPreviews(approvedBridgeResumeCalls, passIndex);
      let liveToolCalls: ChatToolCall[] = activeApprovedBridgeToolCalls;

      updateGeneratedMessage(chatId, messageId, (message) => ({
        ...withStreamingWorkThinking(message, "I’m resuming the approved tool action now.", "active"),
        agentRunStatus: "running",
        content: "",
        progress: withLocalComputerProgress(activeProgress, message.progress),
        toolCalls: activeApprovedBridgeToolCalls.length > 0 ? activeApprovedBridgeToolCalls : message.toolCalls,
      }));

      const bridgeRun = await executeToolBridgeCalls({
        approval: () => ({ approved: true }),
        calls: approvedBridgeResumeCalls,
        context: resumeBridgeContext,
        onToolCallUpdate: (toolCall) => {
          const [stampedToolCall] = stampLocalToolCallIds([toolCall], passIndex);

          if (!stampedToolCall) {
            return;
          }

          liveToolCalls = upsertToolCall(liveToolCalls, stampedToolCall);
          attachLiveTerminalSession([stampedToolCall]);
          updateGeneratedMessage(chatId, messageId, (message) => ({
            ...message,
            content: "",
            progress: withLocalComputerProgress(activeProgress, message.progress),
            toolCalls: liveToolCalls,
          }));
        },
        registry: bridgeRegistry,
        telemetry: bridgeTelemetry,
      });
      const completedBridgeToolCalls = stampLocalToolCallIds(bridgeRun.toolCalls, passIndex);
      updateCodingRun((run) => withCodingBridgeBatch(run, completedBridgeToolCalls));
      totalExecutedToolCalls += getBridgeHandledCount(bridgeRun);
      rememberBridgeToolResults(bridgeRun.resultMessages, passIndex, bridgeReasoningState);
      rememberProjectToolMemoryFromBridgeRun(chatId, workspaceSettings, prompt, bridgeRun);
      allToolCalls = [...allToolCalls, ...completedBridgeToolCalls];
      applyBridgeRunSideEffects(bridgeRun, completedBridgeToolCalls);
      localProgress = createLocalComputerProgress("complete", formatBridgeToolRunProgress(bridgeRun, "approved tool"));

      updateGeneratedMessage(chatId, messageId, (message) => ({
        ...withStreamingWorkThinking(message, createVisibleToolResultThinking(completedBridgeToolCalls), "complete"),
        content: "",
        progress: withLocalComputerProgress(localProgress, message.progress),
        toolCalls: allToolCalls,
      }));

      messages = [
        ...messages,
        createMessage("user", [
          "APPROVED TOOL RESULT",
          "Use the attached tool result messages as the source of truth.",
          "If the approved action failed because the tool arguments were invalid JSON or failed validation, retry with corrected valid JSON instead of stopping on the raw error.",
          "If no more work is needed, finish the user's request normally.",
        ].join("\n")),
        ...createBridgeRunVisualEvidenceMessages(bridgeRun),
      ];
      passIndex += 1;
      resumeToolCallContent = undefined;
      }
    }

    if (resumeToolCallContent) {
      const activeProgress = createLocalComputerProgress("active", "Resuming approved tool action");
      const activeToolCalls = createActiveLocalToolCalls(resumeToolCallContent, passIndex, toolExecutionPolicy);
      let liveToolCalls = activeToolCalls;

      updateGeneratedMessage(chatId, messageId, (message) => ({
        ...(activeToolCalls.length > 0 ? withStreamingWorkThinking(message, createVisibleToolPlanThinking(activeToolCalls), "active") : message),
        agentRunStatus: "running",
        content: "",
        progress: withLocalComputerProgress(activeProgress, message.progress),
        toolCalls: activeToolCalls.length > 0 ? activeToolCalls : message.toolCalls,
      }));
      onExternalUpdate?.({
        progress: activeProgress,
        status: activeProgress.label,
      });

      const toolRun = await runLocalComputerToolCalls({
        approvalDecisions: createRuntimeApprovalDecisions(workspaceSettings, approvalDecisions, chatId),
        assistantContent: resumeToolCallContent,
        executionPolicy: toolExecutionPolicy,
        onRunSubagents: (tasks) => runParallelSubagents(tasks, messages, prompt, controller.signal, runtimeChat),
        previousToolCalls,
        onToolCallUpdate: (_callNumber, toolCall) => {
          const [stampedToolCall] = stampLocalToolCallIds([toolCall], passIndex);

          if (!stampedToolCall) {
            return;
          }

          liveToolCalls = upsertToolCall(liveToolCalls, stampedToolCall);
          attachLiveTerminalSession([stampedToolCall]);
          updateGeneratedMessage(chatId, messageId, (message) => ({
            ...message,
            content: "",
            progress: withLocalComputerProgress(activeProgress, message.progress),
            toolCalls: liveToolCalls,
          }));
          onExternalUpdate?.({
            progress: activeProgress,
            status: formatDiscordToolStatus(stampedToolCall),
            toolCall: stampedToolCall,
          });
        },
        settings: workspaceSettings,
        signal: controller.signal,
        toolSettings,
        userPrompt: prompt,
        webSearchSettings: runtimeWebSearchSettings,
        webSearchMaxResults: runtimeWebSearchMaxResults,
      });

      if (toolRun.browserPreviewUrl && toolSettings.browserPreview) {
        setBrowserPreviewTarget((currentTarget) => ({
          id: (currentTarget?.id ?? 0) + 1,
          url: toolRun.browserPreviewUrl!,
        }));
      }

      totalExecutedToolCalls += toolRun.executedCount;
      allArtifacts = mergeChatArtifacts(allArtifacts, toolRun.artifacts) ?? [];
      allSources = mergeChatSources(allSources, toolRun.sources);
      const completedToolCalls = stampLocalToolCallIds(toolRun.toolCalls, passIndex);
      rememberProjectToolMemoryFromChatToolCalls(chatId, workspaceSettings, prompt, completedToolCalls);
      allToolCalls = completedToolCalls;
      attachLiveTerminalSession(allToolCalls);
      localProgress = toolRun.waitingForApproval ? toolRun.progress : createLocalComputerProgress("complete", `${totalExecutedToolCalls} ran`);
      finalResponse.artifacts = allArtifacts.length > 0 ? allArtifacts : undefined;
      finalResponse.sources = allSources.length > 0 ? allSources : undefined;
      finalResponse.toolCalls = allToolCalls;
      finalResponse.approvalRequests = toolRun.approvalRequests.map((approval) => ({
        ...approval,
        messageId,
        resumeToolCallContent,
      }));
      finalResponse.pendingToolCallContent = toolRun.waitingForApproval ? resumeToolCallContent : undefined;
      finalResponse.waitingForApproval = toolRun.waitingForApproval;

      updateGeneratedMessage(chatId, messageId, (message) => ({
        ...withStreamingWorkThinking(
          message,
          toolRun.waitingForApproval ? createVisibleToolApprovalThinking(allToolCalls) : createVisibleToolResultThinking(completedToolCalls),
          "complete",
        ),
        agentRunStatus: toolRun.waitingForApproval ? "waiting_for_approval" : "running",
        approvals: toolRun.waitingForApproval ? mergeAgentApprovals(message.approvals ?? [], finalResponse.approvalRequests ?? []) : message.approvals,
        artifacts: mergeChatArtifacts(message.artifacts, toolRun.artifacts),
        content: "",
        progress: withLocalComputerProgress(localProgress, message.progress),
        sources: toolRun.sources.length > 0 ? mergeChatSources(message.sources, toolRun.sources) : message.sources,
        toolCalls: allToolCalls,
      }));
      onExternalUpdate?.({
        progress: localProgress,
        sources: toolRun.sources,
        status: toolRun.waitingForApproval ? "Tool approval is needed in Gilbert Codex." : `${totalExecutedToolCalls} tool call${totalExecutedToolCalls === 1 ? "" : "s"} completed.`,
        toolCall: allToolCalls[allToolCalls.length - 1],
      });

      if (toolRun.waitingForApproval) {
        return {
          ...finalResponse,
          progress: toolRun.progress,
        };
      }

      const simpleScaffoldResponse = maybeFinishSimpleLocalScaffold();
      if (simpleScaffoldResponse) {
        return simpleScaffoldResponse;
      }

      messages = [
        ...messages,
        createMessage("assistant", resumeToolCallContent),
        createMessage("user", toolRun.contextMessage),
      ];
      passIndex += 1;
    }

    while (!isRequestInactive(requestId, controller)) {
      const toolBudgetReached = passIndex >= maxToolPasses || totalExecutedToolCalls >= maxToolExecutions;
      const approvedPlanNeedsWorkspaceTool = Boolean(approvedPlanExecution && !hasSuccessfulApprovedPlanWorkspaceTool(allToolCalls));
      const approvedPlanNeedsMutation = Boolean(approvedPlanExecution?.requiresMutation && !hasSuccessfulApprovedPlanMutation(allToolCalls));
      const approvedPlanNeedsToolExecution = approvedPlanNeedsWorkspaceTool || approvedPlanNeedsMutation;
      const approvalRevisionToolCallRequiredForPass = approvalRevisionRequiresToolCall && !toolBudgetReached;
      const bridgeSelectionPrompt = approvalRevisionToolCallRequiredForPass
        ? approvalRevisionPrompt ?? toolSelectionPrompt ?? prompt
        : toolSelectionPrompt ?? prompt;
      const workspaceMutationNeeded = !approvedPlanExecution && requiresWorkspaceMutationForPrompt(bridgeSelectionPrompt, workspaceSettings.enabled);
      const workspaceMutationIncomplete = Boolean(workspaceMutationNeeded && !hasSuccessfulApprovedPlanMutation(allToolCalls) && !toolBudgetReached);
      const deploymentActionRequested = promptRequestsDeploymentAction(bridgeSelectionPrompt);
      const deploymentEvidenceRequiredForPass = Boolean(deploymentActionRequested && !hasDeploymentToolAttempt(allToolCalls) && !toolBudgetReached);
      const connectedToolActionRequested = !deploymentActionRequested && promptRequestsConnectedToolAction(bridgeSelectionPrompt);
      const connectedToolEvidenceRequiredForPass = Boolean(connectedToolActionRequested && !hasConnectedToolEvidence(allToolCalls) && !toolBudgetReached);
      const capabilitySelectionPrompt = [
        bridgeSelectionPrompt,
        deploymentEvidenceRequiredForPass ? "MCP deployment/hosting tool discovery is required for this pass." : "",
        connectedToolEvidenceRequiredForPass ? "Connected app, connector, plugin, and MCP tool discovery is required for this pass." : "",
      ].filter(Boolean).join("\n\n");
      const latestUserPromptNeedsWebSearch = shouldAttachWebSearch(prompt);
      const freshLocalEvidenceNeeded = needsFreshLocalToolEvidence(bridgeSelectionPrompt, workspaceSettings.enabled);
      const freshLocalEvidenceRequiredForPass = freshLocalEvidenceNeeded && allToolCalls.length === 0 && !toolBudgetReached;
      const runtimeSettings = applyToolOverrides(toolBudgetReached ? createFinalOnlyProviderSettings(prompt, runtimeChat, providerSettingsOverrides ?? {}) : createPromptAwareProviderSettings(prompt, providerSettingsOverrides ?? {}, runtimeChat));
      const minPassTokens = localProgress ? LOCAL_TOOL_FINAL_MIN_TOKENS : 0;
      const passSettings: ProviderSettings = minPassTokens > 0
        ? {
            ...runtimeSettings,
            maxTokens: Math.max(runtimeSettings.maxTokens, minPassTokens),
          }
        : runtimeSettings;
      const workspaceToolCallRequiredForPass =
        allToolCalls.length === 0 &&
        !toolBudgetReached &&
        hasRequestScopedWorkspaceToolsEnabled(passSettings) &&
        requiresWorkspaceToolCallForPrompt(bridgeSelectionPrompt, workspaceSettings.enabled);
      const mustUseToolsForPass =
        approvedPlanNeedsToolExecution ||
        workspaceMutationIncomplete ||
        deploymentEvidenceRequiredForPass ||
        connectedToolEvidenceRequiredForPass ||
        freshLocalEvidenceRequiredForPass ||
        workspaceToolCallRequiredForPass ||
        approvalRevisionToolCallRequiredForPass;
      const webSearchEnabledForPass =
        passSettings.tools.webSearch &&
        runtimeWebSearchSettings.enabled &&
        !approvedPlanNeedsToolExecution &&
        !workspaceMutationIncomplete &&
        (!freshLocalEvidenceRequiredForPass || latestUserPromptNeedsWebSearch) &&
        (!workspaceToolCallRequiredForPass || latestUserPromptNeedsWebSearch);
      const bridgeContext: ToolExecutionContext = {
        agentEnvironment: passSettings.agentEnvironment ?? generalSettings.agentEnvironment,
        automationScope,
        memorySearch,
        model: passSettings.model,
        permissionMode: workspaceSettings.permissionMode,
        provider: passSettings.provider,
        providerApiKey: passSettings.apiKeys[passSettings.provider]?.trim() || "",
        signal: controller.signal,
        terminalDefaultShell: generalSettings.terminalShell,
        webSearchMaxResults: runtimeWebSearchMaxResults,
        webSearchSettings: runtimeWebSearchSettings,
        workspaceRoots: enabledWorkspaceRoots,
      };
      const availableBridgeTools = bridgeRegistry.listForContext(bridgeContext, undefined, {
        includePendingApproval: true,
      });
      const providerFormat = inferProviderToolBridgeFormat(passSettings);
      const workspaceToolFamilies: ToolBridgeToolFamily[] = ["files", "editing", "git", "github", "terminal", "browser"];
      const workspaceToolsEnabled = hasRequestScopedWorkspaceToolsEnabled(passSettings);
      const requiredFamilies: ToolBridgeToolFamily[] = [
        ...(approvedPlanNeedsMutation || workspaceMutationIncomplete ? ["editing" as const] : []),
        ...(approvedPlanNeedsWorkspaceTool || workspaceMutationIncomplete || freshLocalEvidenceRequiredForPass || workspaceToolCallRequiredForPass ? workspaceToolFamilies : []),
        ...(deploymentEvidenceRequiredForPass ? ["mcp" as const, "terminal" as const] : []),
        ...(connectedToolEvidenceRequiredForPass ? ["mcp" as const, "github" as const, "gmail" as const, "calendar" as const] : []),
        ...(approvalRevisionToolCallRequiredForPass ? approvalRevisionRequiredFamilies : []),
      ];
      const toolIntent: ToolIntent[] = [
        ...(approvedPlanNeedsMutation || workspaceMutationIncomplete ? ["workspace_mutation" as const] : []),
        ...(approvedPlanNeedsWorkspaceTool || workspaceMutationIncomplete || freshLocalEvidenceRequiredForPass || workspaceToolCallRequiredForPass ? ["workspace_evidence" as const] : []),
        ...(deploymentEvidenceRequiredForPass ? ["terminal" as const] : []),
        ...(connectedToolEvidenceRequiredForPass ? ["gmail" as const, "calendar" as const] : []),
        ...(approvalRevisionToolCallRequiredForPass && approvalRevisionRequiredFamilies.includes("gmail") ? ["gmail" as const] : []),
        ...(approvalRevisionToolCallRequiredForPass && approvalRevisionRequiredFamilies.includes("calendar") ? ["calendar" as const] : []),
        ...(latestUserPromptNeedsWebSearch ? ["web_search" as const] : []),
      ];
      const baseBlockedReasons = [
        workspaceSettings.enabled ? undefined : {
          code: "workspace_disabled",
          detail: "The selected workspace is disabled for this chat.",
        },
        workspaceSettings.enabled && enabledWorkspaceRoots.length === 0 ? {
          code: "workspace_roots_unavailable",
          detail: "No enabled workspace roots are available for this chat.",
        } : undefined,
        (approvedPlanNeedsToolExecution || workspaceMutationIncomplete || freshLocalEvidenceRequiredForPass || workspaceToolCallRequiredForPass) && !workspaceToolsEnabled ? {
          code: "workspace_tool_settings_disabled",
          detail: "The current tool settings do not enable request-scoped workspace tools.",
        } : undefined,
      ].filter(Boolean);
      const selectionFlags = {
        browserPreviewEnabled: passSettings.tools.browserPreview,
        editingEnabled: passSettings.tools.codeEdit || passSettings.tools.codeGeneration || passSettings.tools.fileCreation,
        fileToolsEnabled: passSettings.tools.fileBrowser || passSettings.tools.fileSearch || passSettings.tools.codeView,
        gitEnabled: passSettings.tools.sourceControl,
        imageGenerationEnabled: passSettings.tools.imageGeneration,
        mcpServersEnabled: passSettings.tools.mcpServers,
        memoryEnabled: memoryToolsEnabled && !approvedPlanNeedsToolExecution && !workspaceMutationIncomplete && !freshLocalEvidenceRequiredForPass && !workspaceToolCallRequiredForPass,
        terminalEnabled: passSettings.tools.terminal,
      };
      let toolCapabilityPlan = selectToolCapabilityPlan({
        ...selectionFlags,
        availableTools: availableBridgeTools,
        blockedReasons: baseBlockedReasons,
        mustUseTools: mustUseToolsForPass,
        prompt: capabilitySelectionPrompt,
        providerFormat,
        requestedToolChoice: approvalRevisionToolCallRequiredForPass ? "required" : undefined,
        requiredFamilies,
        toolBudgetReached,
        toolIntent,
        webSearchEnabled: webSearchEnabledForPass,
      });

      if (toolCapabilityPlan.selectedTools.length === 0 && workspaceToolCallRequiredForPass && !toolBudgetReached) {
        toolCapabilityPlan = selectToolCapabilityPlan({
          ...selectionFlags,
          availableTools: availableBridgeTools,
          blockedReasons: [
            ...baseBlockedReasons,
            {
              code: "workspace_selection_fallback",
              detail: "The original prompt selected no workspace tools, so the runtime tried the standard workspace read/edit fallback.",
            },
          ],
          imageGenerationEnabled: false,
          memoryEnabled: false,
          mustUseTools: true,
          prompt: "fix the selected workspace app. read relevant files and edit code with the attached file tools.",
          providerFormat,
          requiredFamilies: workspaceToolFamilies,
          toolBudgetReached,
          toolIntent: ["workspace_evidence", "workspace_mutation"],
          webSearchEnabled: false,
        });
      }
      const initialWebSearchRequiredForPass =
        latestUserPromptNeedsWebSearch &&
        toolCapabilityPlan.selectedTools.some((tool) => tool.id === "web_search") &&
        !allToolCalls.some((toolCall) => toolCall.toolId === "web_search");

      if (initialWebSearchRequiredForPass && !toolCapabilityPlan.mustUseTools) {
        toolCapabilityPlan = selectToolCapabilityPlan({
          ...selectionFlags,
          availableTools: availableBridgeTools,
          blockedReasons: baseBlockedReasons,
          mustUseTools: true,
          prompt: capabilitySelectionPrompt,
          providerFormat,
          requiredFamilies: ["web"],
          requestedToolChoice: "required",
          toolBudgetReached,
          toolIntent,
          webSearchEnabled: webSearchEnabledForPass,
        });
      }
      const bridgeTools = toolCapabilityPlan.selectedTools;
      const bridgeToolResultCharBudget = getModelVisibleToolResultCharBudget(resolveContextWindowForModel(passSettings.model).tokens, passSettings);
      const bridgeOptions = bridgeTools.length > 0 || bridgeToolResultMessages.length > 0
        ? {
            capabilityPlan: toolCapabilityPlan,
            maxToolResultContentChars: bridgeToolResultCharBudget,
            parallelToolCalls: toolBudgetReached ? undefined : supportsProviderParallelToolCalls(passSettings.provider) ? true : undefined,
            providerVisibleToolIds: toolCapabilityPlan.providerVisibleToolIds,
            reasoningState: bridgeReasoningState,
            runtimeBudget: {
              maxExecutions: maxToolExecutions,
              maxPasses: maxToolPasses,
              maxToolResultContentChars: bridgeToolResultCharBudget,
              remainingExecutions: Math.max(maxToolExecutions - totalExecutedToolCalls, 0),
              remainingPasses: Math.max(maxToolPasses - passIndex, 0),
            },
            toolChoice: toolCapabilityPlan.toolChoice,
            toolResultDelivery: bridgeToolResultMessages.length > 0 ? "native" as const : undefined,
            toolResultMessages: bridgeToolResultMessages,
            tools: bridgeTools,
          }
        : undefined;
      if (runId) {
        updateCodingRun((run) => withCodingToolHealth(run, createToolHealthSnapshot({
          availableTools: availableBridgeTools,
          budgetReached: toolBudgetReached,
          model: passSettings.model,
          parallelToolCalls: bridgeOptions?.parallelToolCalls,
          passIndex,
          permissionMode: workspaceSettings.permissionMode,
          prompt: bridgeSelectionPrompt,
          provider: passSettings.provider,
          registryTools: bridgeRegistry.list(),
          runtimeBudget: bridgeOptions?.runtimeBudget,
          toolCapabilityPlan,
          selectedTools: bridgeTools,
          toolChoice: bridgeOptions?.toolChoice,
          workspaceRoots: enabledWorkspaceRoots,
        })));
      }
      if (toolCapabilityPlan.mustUseTools && !toolCapabilityPlan.canCallProvider && bridgeToolResultMessages.length === 0) {
        const blockedProgress = createLocalComputerProgress("complete", "Required tools unavailable");
        const blockedContent = createToolCapabilityBlockedAnswer(toolCapabilityPlan);

        updateGeneratedMessage(chatId, messageId, (message) => ({
          ...message,
          content: blockedContent,
          progress: withLocalComputerProgress(blockedProgress, message.progress),
          toolCalls: allToolCalls.length > 0 ? allToolCalls : message.toolCalls,
        }));
        onExternalUpdate?.({
          content: blockedContent,
          progress: blockedProgress,
          status: "Required tools unavailable.",
        });

        return {
          artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
          content: blockedContent,
          progress: blockedProgress,
          sources: allSources.length > 0 ? allSources : undefined,
          toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
        };
      }
      const passCompaction = compactProviderMessages(messages, passSettings, { toolBridge: bridgeOptions });
      if (passCompaction.compacted) {
        const compactionProgress = createContextCompactionProgress(passCompaction);

        updateGeneratedMessage(chatId, messageId, (message) => ({
          ...withContextCompactionMarker(message, passCompaction.contextCompaction),
          progress: withContextCompactionProgress(compactionProgress, message.progress),
        }));
        onExternalUpdate?.({
          progress: compactionProgress,
          status: "Compacting local chat context...",
        });
      }
      messages = passCompaction.compacted ? appendAutoCompactionContinuation(passCompaction.messages, prompt, totalExecutedToolCalls) : passCompaction.messages;
      let assistantResponse: Awaited<ReturnType<typeof streamProviderMessageWithRetry>>;

      try {
        assistantResponse = await streamProviderMessageWithRetry(
          chatId,
          passSettings,
          messages,
          (snapshot) => {
            if (isRequestInactive(requestId, controller)) {
              return;
            }

            const streamingToolRequestContent = routePrimitiveEvidenceBatchToWorkflow(
              createAssistantToolRequestContent(snapshot.content, undefined, toolExecutionPolicy),
              prompt,
              toolSettings,
              toolExecutionPolicy,
            );
            const hasStreamingLocalToolCalls = hasLocalComputerToolCalls(streamingToolRequestContent, toolExecutionPolicy);
            const streamingToolCalls = hasStreamingLocalToolCalls ? createActiveLocalToolCalls(streamingToolRequestContent, passIndex, toolExecutionPolicy) : [];
            const streamingBridgeToolCalls = !hasStreamingLocalToolCalls && snapshot.toolCalls?.length
              ? stampLocalToolCallIds(
                  snapshot.toolCalls.map((call) =>
                    createBridgeChatToolCall(
                      call,
                      bridgeRegistry.get(call.name),
                      { content: "Preparing tool call.", ok: true },
                      "active",
                    ),
                  ),
                  passIndex,
                )
              : [];
            const hasStreamingBridgeToolCalls = streamingBridgeToolCalls.length > 0;
            const waitingForRequiredLocalEvidence =
              freshLocalEvidenceRequiredForPass &&
              !hasStreamingLocalToolCalls &&
              !hasStreamingBridgeToolCalls &&
              allToolCalls.length === 0;
            const rawSanitizedContent = sanitizeLocalToolCallsForDisplay(snapshot.content, toolExecutionPolicy);
            const displaySanitizedContent = stripLeadingToolPreludeForDisplay(rawSanitizedContent);
            const hasSubstantiveVisibleAnswer = looksLikeSubstantiveVisibleAnswer(displaySanitizedContent);
            const heldToolCallContent = shouldHoldStreamingContentForToolCalls(rawSanitizedContent, hasStreamingLocalToolCalls || hasStreamingBridgeToolCalls);
            const inFlightToolPlanning = !heldToolCallContent && !hasSubstantiveVisibleAnswer && looksLikeInFlightToolPlanning(rawSanitizedContent);
            const privateThinkingNarration = !heldToolCallContent && looksLikePrivateThinkingNarration(rawSanitizedContent);
            const promisedToolAction = !hasStreamingLocalToolCalls && !hasSubstantiveVisibleAnswer && looksLikeUnexecutedToolActionPromise(snapshot.content);
            const unappliedFileEditAnswer = !hasStreamingLocalToolCalls && (workspaceMutationIncomplete || !hasSubstantiveVisibleAnswer) && looksLikeUnappliedFileEditAnswer(rawSanitizedContent, allToolCalls);
            const unnecessaryConfirmation = !hasStreamingLocalToolCalls && !hasSubstantiveVisibleAnswer && looksLikeUnnecessaryLocalActionConfirmation(rawSanitizedContent, allToolCalls);
            const waitingForRevisedApprovalToolCall =
              approvalRevisionToolCallRequiredForPass &&
              !hasStreamingLocalToolCalls &&
              !hasStreamingBridgeToolCalls;
            const streamingLocalProgress = hasStreamingLocalToolCalls
              ? createLocalComputerProgress("active", formatLocalToolPreviewProgress(streamingToolCalls))
              : hasStreamingBridgeToolCalls
                ? createLocalComputerProgress("active", formatLocalToolPreviewProgress(streamingBridgeToolCalls))
                : waitingForRevisedApprovalToolCall
                  ? createLocalComputerProgress("active", "Preparing revised approval")
                : workspaceMutationIncomplete || unappliedFileEditAnswer || unnecessaryConfirmation
                  ? createLocalComputerProgress("active", "Preparing file changes")
                : waitingForRequiredLocalEvidence && rawSanitizedContent.trim()
                  ? createLocalComputerProgress("active", "Getting current workspace evidence")
                : inFlightToolPlanning || promisedToolAction || privateThinkingNarration
                  ? createLocalComputerProgress("active", "Preparing tool action")
                  : localProgress;
            const sanitizedContent = hasStreamingLocalToolCalls ? "" : displaySanitizedContent;
            const shouldHideVisibleContent =
              heldToolCallContent ||
              waitingForRevisedApprovalToolCall ||
              waitingForRequiredLocalEvidence ||
              unappliedFileEditAnswer ||
              unnecessaryConfirmation ||
              inFlightToolPlanning ||
              privateThinkingNarration ||
              promisedToolAction ||
              looksLikeFabricatedToolProgress(sanitizedContent, allToolCalls) ||
              looksLikeToolProtocolNarration(sanitizedContent);
            const visibleContent = shouldHideVisibleContent ? "" : sanitizedContent;
            const hiddenWorkStatus = shouldHideVisibleContent
              ? streamingLocalProgress?.label || (privateThinkingNarration || inFlightToolPlanning || promisedToolAction ? "Preparing tool action" : "Preparing response")
              : "";
            const hostThinkingContent = createVisibleToolPlanThinking([...streamingToolCalls, ...streamingBridgeToolCalls]) || hiddenWorkStatus;
            const streamTiming = markFirstVisibleStreamToken(snapshot.streamTiming, visibleContent);

            updateGeneratedMessage(chatId, messageId, (message) => ({
              ...(hostThinkingContent ? withStreamingWorkThinking(message, hostThinkingContent, "active") : completeStreamingWorkThinking(message)),
              content: visibleContent,
              progress: streamingLocalProgress ? withLocalComputerProgress(streamingLocalProgress, message.progress) : message.progress,
              streamTiming: streamTiming ?? message.streamTiming,
              thinking: message.thinking,
              toolCalls: streamingToolCalls.length > 0
                ? [...allToolCalls, ...streamingToolCalls]
                : streamingBridgeToolCalls.length > 0
                  ? [...allToolCalls, ...streamingBridgeToolCalls]
                  : message.toolCalls,
            }));
            onExternalUpdate?.({
              content: visibleContent,
              progress: streamingLocalProgress,
              status: hasStreamingLocalToolCalls
                ? "Preparing tool request..."
                : hasStreamingBridgeToolCalls
                ? "Preparing tool call..."
                : unappliedFileEditAnswer || unnecessaryConfirmation
                  ? "Preparing file changes..."
                : waitingForRequiredLocalEvidence
                  ? "Requesting fresh workspace evidence..."
                : inFlightToolPlanning || promisedToolAction || privateThinkingNarration
                  ? "Preparing tool action..."
                    : visibleContent
                      ? "Streaming answer..."
                      : "Thinking...",
            });
          },
          {
            signal: controller.signal,
            toolBridge: bridgeOptions,
          },
          messageId,
        );
      } catch (error) {
        if (isAbortError(error) || isRequestInactive(requestId, controller) || allToolCalls.length === 0) {
          throw error;
        }

        const synthesizedResponse = await synthesizeAnswerFromSavedToolResults(
          messages,
          "The streaming final response failed after the app gathered tool results.",
          createBridgeSynthesisToolBridgeOptions(),
        );

        if (synthesizedResponse) {
          return synthesizedResponse;
        }

        return {
          artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
          content: createToolFinalAnswerUnavailableMessage(allToolCalls, prompt),
          progress: localProgress,
          sources: allSources.length > 0 ? allSources : undefined,
          toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
        };
      }

      bridgeReasoningState = assistantResponse.reasoningState ?? bridgeReasoningState;
      const visibleToolCallRecoveryText = assistantResponse.content;
      const rawBridgeToolCalls = assistantResponse.toolCalls?.length
        ? assistantResponse.toolCalls
        : parseVisibleTextToolCalls(visibleToolCallRecoveryText, passSettings.provider);
      const allowedRawBridgeToolCalls = memoryToolsEnabled
        ? rawBridgeToolCalls
        : rawBridgeToolCalls.filter((call) => bridgeRegistry.get(call.name)?.executorMetadata?.family !== "memory");
      const bridgeToolCalls = allowedRawBridgeToolCalls.length
        ? coalesceToolBridgeCalls(allowedRawBridgeToolCalls, bridgeRegistry).calls
        : allowedRawBridgeToolCalls;

      if (bridgeToolCalls.length) {
        const activeProgress = createLocalComputerProgress("active", "Running bridge tools");
        let liveBridgeToolCalls: ChatToolCall[] = [];
        const pendingBridgeApprovals = await collectPendingBridgeApprovals(bridgeToolCalls, bridgeContext);

        if (pendingBridgeApprovals.approvals.length > 0) {
          const approvalProgress = createLocalComputerProgress("pending", "Tool approval required");
          const waitingToolCalls = stampLocalToolCallIds(pendingBridgeApprovals.waitingToolCalls, passIndex);

          finalResponse = {
            approvalRequests: pendingBridgeApprovals.approvals.map((approval) => ({
              ...approval,
              messageId,
            })),
            content: "",
            pendingToolCallContent: pendingBridgeApprovals.approvals[0]?.resumeToolCallContent,
            progress: approvalProgress,
            toolCalls: [...allToolCalls, ...waitingToolCalls],
            waitingForApproval: true,
          };

          updateGeneratedMessage(chatId, messageId, (message) => ({
            ...withStreamingWorkThinking(message, createVisibleToolApprovalThinking(waitingToolCalls), "complete"),
            agentRunStatus: "waiting_for_approval",
            approvals: mergeAgentApprovals(message.approvals ?? [], finalResponse.approvalRequests ?? []),
            content: "",
            progress: withLocalComputerProgress(approvalProgress, message.progress),
            toolCalls: finalResponse.toolCalls,
          }));
          onExternalUpdate?.({
            progress: approvalProgress,
            status: "Tool approval is needed in Gilbert Codex.",
            toolCall: waitingToolCalls[0],
          });

          return finalResponse;
        }

        const activeBridgeToolCalls = createActiveBridgeToolPreviews(bridgeToolCalls, passIndex);
        liveBridgeToolCalls = activeBridgeToolCalls;
        updateGeneratedMessage(chatId, messageId, (message) => ({
          ...withStreamingWorkThinking(message, createVisibleToolPlanThinking(activeBridgeToolCalls), "active"),
          content: "",
          progress: withLocalComputerProgress(activeProgress, message.progress),
          toolCalls: [...allToolCalls, ...activeBridgeToolCalls],
        }));
        onExternalUpdate?.({
          progress: activeProgress,
          status: activeProgress.label,
        });

        const bridgeRun = await executeToolBridgeCalls({
          approval: () => ({ approved: true }),
          calls: bridgeToolCalls,
          context: bridgeContext,
          onToolCallUpdate: (toolCall) => {
            const [stampedToolCall] = stampLocalToolCallIds([toolCall], passIndex);

            if (!stampedToolCall) {
              return;
            }

            liveBridgeToolCalls = upsertToolCall(liveBridgeToolCalls, stampedToolCall);
            attachLiveTerminalSession([stampedToolCall]);
            updateGeneratedMessage(chatId, messageId, (message) => ({
              ...message,
              content: "",
              progress: withLocalComputerProgress(activeProgress, message.progress),
              toolCalls: [...allToolCalls, ...liveBridgeToolCalls],
            }));
            onExternalUpdate?.({
              progress: activeProgress,
              status: formatDiscordToolStatus(stampedToolCall),
              toolCall: stampedToolCall,
            });
          },
          registry: bridgeRegistry,
          telemetry: bridgeTelemetry,
        });
        const completedBridgeToolCalls = stampLocalToolCallIds(bridgeRun.toolCalls, passIndex);
        updateCodingRun((run) => withCodingBridgeBatch(run, completedBridgeToolCalls));
        totalExecutedToolCalls += getBridgeHandledCount(bridgeRun);
        rememberBridgeToolResults(bridgeRun.resultMessages, passIndex, bridgeReasoningState);
        rememberProjectToolMemoryFromBridgeRun(chatId, workspaceSettings, prompt, bridgeRun);
        allToolCalls = [...allToolCalls, ...completedBridgeToolCalls];
        applyBridgeRunSideEffects(bridgeRun, completedBridgeToolCalls);
        localProgress = createLocalComputerProgress("complete", formatBridgeToolRunProgress(bridgeRun, "bridge tool"));

        updateGeneratedMessage(chatId, messageId, (message) => ({
          ...withStreamingWorkThinking(message, createVisibleToolResultThinking(completedBridgeToolCalls), "complete"),
          content: "",
          progress: withLocalComputerProgress(localProgress, message.progress),
          toolCalls: allToolCalls,
        }));
      onExternalUpdate?.({
        progress: localProgress,
        status: `${formatBridgeToolRunProgress(bridgeRun, "bridge tool")}.`,
        toolCall: allToolCalls[allToolCalls.length - 1],
      });

      messages = [
        ...messages,
        createMessage("user", createBridgeToolContinuationInstruction(bridgeRun)),
        ...createBridgeRunVisualEvidenceMessages(bridgeRun),
      ];
      passIndex += 1;
      continue;
    }

      const assistantToolRequestContent = routePrimitiveEvidenceBatchToWorkflow(
        createAssistantToolRequestContent(assistantResponse.content, undefined, toolExecutionPolicy),
        prompt,
        toolSettings,
        toolExecutionPolicy,
      );
      const assistantHasLocalToolCalls = hasLocalComputerToolCalls(assistantToolRequestContent, toolExecutionPolicy);

      const finalVisibleContent = assistantHasLocalToolCalls ? "" : stripLeadingToolPreludeForDisplay(sanitizeLocalToolCallsForDisplay(assistantResponse.content, toolExecutionPolicy));

      finalResponse = {
        artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
        content: finalVisibleContent,
        sources: allSources.length > 0 ? allSources : undefined,
        streamTiming: markFirstVisibleStreamToken(assistantResponse.streamTiming, finalVisibleContent),
        toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
      };

      if (isRequestInactive(requestId, controller)) {
        return guardRecoveryFinalResponse(finalResponse);
      }

      if (!assistantHasLocalToolCalls && shouldSynthesizeEmptyFinalFromToolResults(finalResponse.content, allToolCalls)) {
        const recoverableBridgeRetryInstruction = createRecoverableBridgeToolRetryInstruction(allToolCalls, prompt);

        if (recoverableBridgeRetryInstruction && recoverableBridgeToolRetries < MAX_MALFORMED_TOOL_RECOVERY_RETRIES) {
          recoverableBridgeToolRetries += 1;
          const retryProgress = createLocalComputerProgress("active", "Retrying corrected tool call");

          updateGeneratedMessage(chatId, messageId, (message) => ({
            ...message,
            content: "",
            progress: withLocalComputerProgress(retryProgress, message.progress),
            toolCalls: allToolCalls.length > 0 ? allToolCalls : message.toolCalls,
          }));
          onExternalUpdate?.({
            progress: retryProgress,
            status: "Retrying corrected tool call...",
          });

          messages = [
            ...messages,
            createMessage("user", recoverableBridgeRetryInstruction),
          ];
          passIndex += 1;
          continue;
        }

        const synthesizedResponse = await synthesizeAnswerFromSavedToolResults(
          messages,
          "The provider returned no visible final answer after completed tool results. Use the attached tool result messages and write the requested answer now.",
          createBridgeSynthesisToolBridgeOptions(),
        );

        if (synthesizedResponse) {
          return synthesizedResponse;
        }

        return {
          artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
          content: createToolFinalAnswerUnavailableMessage(allToolCalls, prompt),
          progress: localProgress,
          sources: allSources.length > 0 ? allSources : undefined,
          toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
        };
      }

      if (toolBudgetReached && assistantHasLocalToolCalls) {
        finalizationRetries += 1;

        if (finalizationRetries <= MAX_TOOL_FINALIZATION_RETRIES) {
          updateGeneratedMessage(chatId, messageId, (message) => ({
            ...message,
            content: "",
            progress: withLocalComputerProgress(createLocalComputerProgress("active", "Synthesizing gathered tool results"), message.progress),
            toolCalls: allToolCalls.length > 0 ? allToolCalls : message.toolCalls,
          }));
          onExternalUpdate?.({
            progress: createLocalComputerProgress("active", "Synthesizing gathered tool results"),
            status: "Synthesizing gathered tool results...",
          });
          messages = [
            ...messages,
            createMessage("assistant", assistantToolRequestContent),
            createMessage(
              "user",
              createLocalToolBudgetFinalInstruction(
                prompt,
                [
                  `The app already gathered ${totalExecutedToolCalls} local tool result${totalExecutedToolCalls === 1 ? "" : "s"} across ${passIndex} pass${passIndex === 1 ? "" : "es"}.`,
                  "The previous assistant response requested more tools, but the next step is to synthesize from the saved results unless user input is truly required.",
                ].join("\n"),
              ),
            ),
          ];
          passIndex += 1;
          continue;
        }

        const synthesizedResponse = await synthesizeAnswerFromSavedToolResults(
          [...messages, createMessage("assistant", assistantToolRequestContent)],
          "The model requested more tools after the configured tool budget. Synthesize from the saved results instead of asking for more tools.",
        );

        if (synthesizedResponse) {
          return synthesizedResponse;
        }

        return {
          artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
          content: createToolFinalAnswerUnavailableMessage(allToolCalls, prompt),
          progress: localProgress,
          sources: allSources.length > 0 ? allSources : undefined,
          toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
        };
      }

      if (!assistantHasLocalToolCalls) {
        const fabricatedToolProgress = looksLikeFabricatedToolProgress(finalResponse.content, allToolCalls);
        const hasSubstantiveFinalAnswer = looksLikeSubstantiveVisibleAnswer(finalResponse.content);
        const inFlightToolPlanning = !hasSubstantiveFinalAnswer && looksLikeInFlightToolPlanning(finalResponse.content);
        const privateThinkingNarration = looksLikePrivateThinkingNarration(finalResponse.content);
        const toolProtocolNarration = looksLikeToolProtocolNarration(finalResponse.content);
        const unexecutedToolActionPromise = !hasSubstantiveFinalAnswer && looksLikeUnexecutedToolActionPromise(finalResponse.content);
        const unappliedFileEditAnswer = (workspaceMutationIncomplete || !hasSubstantiveFinalAnswer) && looksLikeUnappliedFileEditAnswer(finalResponse.content, allToolCalls);
        const unnecessaryConfirmation = !hasSubstantiveFinalAnswer && looksLikeUnnecessaryLocalActionConfirmation(finalResponse.content, allToolCalls);
        const contradictedSuccessfulFileMutation = looksLikeContradictedSuccessfulFileMutationAnswer(finalResponse.content, allToolCalls);
        const visibleToolResultLeak = isVisibleToolResultLeak(finalResponse.content, allToolCalls);
        const unsupportedDeploymentAnswer = deploymentActionRequested && looksLikeUnsupportedDeploymentAnswer(finalResponse.content, allToolCalls);
        const unsupportedConnectedToolAnswer = connectedToolActionRequested && looksLikeUnsupportedConnectedToolActionAnswer(finalResponse.content, allToolCalls);
        const localToolEvidenceRequired =
          allToolCalls.length === 0 &&
          freshLocalToolEvidenceRetries < 2 &&
          !toolBudgetReached &&
          freshLocalEvidenceNeeded;
        const approvedPlanExecutionIncomplete = Boolean(approvedPlanExecution && !toolBudgetReached && approvedPlanNeedsToolExecution);
        const approvalRevisionIncomplete = approvalRevisionRequiresToolCall && !toolBudgetReached;

        if (approvedPlanExecutionIncomplete || workspaceMutationIncomplete || deploymentEvidenceRequiredForPass || connectedToolEvidenceRequiredForPass || approvalRevisionIncomplete || localToolEvidenceRequired || looksLikeOnlyToolPrelude(finalResponse.content) || looksLikeInternalToolRecoveryAnswer(finalResponse.content) || fabricatedToolProgress || inFlightToolPlanning || privateThinkingNarration || toolProtocolNarration || unexecutedToolActionPromise || unappliedFileEditAnswer || unnecessaryConfirmation || contradictedSuccessfulFileMutation || unsupportedDeploymentAnswer || unsupportedConnectedToolAnswer || visibleToolResultLeak) {
          if (approvalRevisionIncomplete) {
            const fallbackApprovalResponse = await createApprovalRevisionFallbackResponse(finalResponse.content, bridgeContext, passIndex);

            if (fallbackApprovalResponse) {
              return fallbackApprovalResponse;
            }
          }

          if (localToolEvidenceRequired) {
            freshLocalToolEvidenceRetries += 1;
          }
          finalizationRetries += 1;

          if (finalizationRetries > MAX_TOOL_FINALIZATION_RETRIES) {
            if (approvedPlanExecutionIncomplete && approvedPlanExecution) {
              return {
                artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
                content: createApprovedPlanExecutionFailedAnswer(approvedPlanExecution, allToolCalls),
                progress: localProgress,
                sources: allSources.length > 0 ? allSources : undefined,
                toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
              };
            }

            if (workspaceMutationIncomplete) {
              const synthesizedMcpResponse = hasMcpToolEvidence(allToolCalls)
                ? await synthesizeAnswerFromSavedToolResults(
                    [...messages, createMessage("assistant", assistantResponse.content)],
                    "The saved tool results include MCP/server-backed actions. Do not reduce this to a missing file edit/write result. Summarize the MCP outcome, successful MCP calls, failed MCP calls, and the next concrete blocker if one remains.",
                  )
                : null;

              if (synthesizedMcpResponse) {
                return synthesizedMcpResponse;
              }

              return {
                artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
                content: "I could not complete the requested workspace edit cleanly. No successful file edit/write tool result was recorded, so no file changes were applied.",
                progress: localProgress,
                sources: allSources.length > 0 ? allSources : undefined,
                toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
              };
            }

            if (deploymentEvidenceRequiredForPass) {
              return {
                artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
                content: "I could not complete the requested deployment cleanly. No successful MCP or terminal deploy/publish tool result was recorded, so I cannot claim the site is live.",
                progress: localProgress,
                sources: allSources.length > 0 ? allSources : undefined,
                toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
              };
            }

            if (connectedToolEvidenceRequiredForPass) {
              return {
                artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
                content: "I could not complete the requested connected-tool action cleanly. No MCP, native app, or connector tool result was recorded, so I cannot claim it ran.",
                progress: localProgress,
                sources: allSources.length > 0 ? allSources : undefined,
                toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
              };
            }

            const synthesizedResponse = await synthesizeAnswerFromSavedToolResults(
              [...messages, createMessage("assistant", assistantResponse.content)],
              fabricatedToolProgress
                ? "The previous finalization attempt claimed tool progress that was not backed by app tool-call records. Do not repeat that claim."
                : approvedPlanExecutionIncomplete
                  ? "The previous finalization attempt answered before executing the approved plan. Do not repeat that answer."
                : workspaceMutationIncomplete
                  ? "The previous finalization attempt answered without applying the requested file changes. Do not repeat that answer; use real edit/write tools instead."
                : approvalRevisionIncomplete
                  ? "The previous finalization attempt answered in prose after an approval edit request. Do not send or claim anything. The next response must call the revised Gmail or Google Calendar tool so the app can show a new approval card."
                : inFlightToolPlanning
                  ? "The previous finalization attempt exposed in-flight tool planning instead of using real app tool calls or writing a final answer. Do not repeat that planning text."
                : privateThinkingNarration
                  ? "The previous finalization attempt exposed private reasoning instead of a user-facing answer. Do not repeat that reasoning text."
                : toolProtocolNarration
                  ? "The previous finalization attempt exposed tool-call protocol narration. Do not repeat it."
                : unnecessaryConfirmation
                  ? "The previous finalization attempt asked for confirmation instead of executing an ordinary requested local action. Use real tools instead."
                : unexecutedToolActionPromise
                  ? "The previous finalization attempt promised a tool action without executing it. Do not repeat the promise."
                : unappliedFileEditAnswer
                  ? "The previous finalization attempt pasted proposed updated files, but no mutating edit/write tool call succeeded. Apply the edit with real tools instead."
                : contradictedSuccessfulFileMutation
                  ? "The previous finalization attempt contradicted successful file edit/write tool evidence. Treat the saved file mutation results as already applied and write a normal answer."
                : unsupportedDeploymentAnswer
                  ? "The previous finalization attempt claimed or deferred deployment without a successful deploy/publish tool result. Use MCP or terminal deployment tools instead of repeating that answer."
                : unsupportedConnectedToolAnswer
                  ? "The previous finalization attempt claimed, deferred, or denied a connected-tool action without current connected-tool evidence. Use MCP, Gmail, Google Calendar, or GitHub tools instead of repeating that answer."
                : visibleToolResultLeak
                  ? "The previous finalization attempt repeated raw tool result text. Use the saved tool evidence to write a normal answer instead."
                : "The previous finalization attempt exposed tool progress instead of a user-facing answer. Write the actual answer from the completed tool evidence.",
            );

            if (synthesizedResponse) {
              return synthesizedResponse;
            }

            return {
              artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
              content: createToolFinalAnswerUnavailableMessage(allToolCalls, prompt),
              progress: localProgress,
              sources: allSources.length > 0 ? allSources : undefined,
              toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
            };
          }

          const recoveryProgress: ChatProgressItem = localProgress ?? (approvedPlanExecutionIncomplete
            ? createLocalComputerProgress("active", "Executing approved plan")
            : workspaceMutationIncomplete
              ? createLocalComputerProgress("active", "Applying file changes")
            : deploymentEvidenceRequiredForPass
              ? createLocalComputerProgress("active", "Deploying requested site")
            : connectedToolEvidenceRequiredForPass
              ? createLocalComputerProgress("active", "Using connected tools")
            : approvalRevisionIncomplete
              ? createLocalComputerProgress("active", "Revising approved tool action")
            : {
                detail: "Continuing from the work log",
                id: "final-answer-recovery",
                label: "Thinking",
                status: "active",
              });
          updateGeneratedMessage(chatId, messageId, (message) => ({
            ...message,
            content: "",
            progress: withLocalComputerProgress(recoveryProgress, message.progress),
            toolCalls: allToolCalls.length > 0 ? allToolCalls : message.toolCalls,
          }));
          onExternalUpdate?.({
            progress: recoveryProgress,
            status: approvedPlanExecutionIncomplete
              ? "Executing approved plan..."
              : workspaceMutationIncomplete
                ? "Applying requested file changes..."
              : deploymentEvidenceRequiredForPass
                ? "Requesting deployment tool evidence..."
              : connectedToolEvidenceRequiredForPass
                ? "Requesting connected tool evidence..."
              : approvalRevisionIncomplete
                ? "Requesting revised tool action..."
              : localToolEvidenceRequired
                ? "Requesting fresh tool evidence..."
                : localProgress
                  ? "Synthesizing gathered tool results..."
                  : "Continuing from the work log...",
          });
          messages = [
            ...messages,
            createMessage("assistant", assistantToolRequestContent),
            createMessage(
              "user",
              approvedPlanExecutionIncomplete && approvedPlanExecution
                ? createApprovedPlanExecutionRetryInstruction(approvedPlanExecution, finalResponse.content, allToolCalls)
                : workspaceMutationIncomplete
                ? createUnappliedFileEditRecoveryInstruction(bridgeSelectionPrompt, finalResponse.content)
                : deploymentEvidenceRequiredForPass
                ? createDeploymentEvidenceRecoveryInstruction(bridgeSelectionPrompt, finalResponse.content, {
                    canUseProviderTools: Boolean(bridgeOptions?.tools?.length),
                  })
                : connectedToolEvidenceRequiredForPass
                ? createConnectedToolEvidenceRecoveryInstruction(bridgeSelectionPrompt, finalResponse.content, {
                    canUseProviderTools: Boolean(bridgeOptions?.tools?.length),
                  })
                : approvalRevisionIncomplete
                ? createFinalAnswerRecoveryInstruction(
                    prompt,
                    "The previous response wrote the revised email/event in plain text. That is not enough. Call the revised Gmail or Google Calendar tool now with the updated arguments. Do not answer in prose, do not ask for confirmation, and do not claim the action happened; the app approval card handles confirmation.",
                  )
                : localToolEvidenceRequired
                ? createFreshLocalToolEvidenceInstruction(prompt, finalResponse.content, {
                    blockedReasons: toolCapabilityPlan.blockedReasons.map((reason) => `${reason.code}: ${reason.detail}`),
                    canUseProviderTools: Boolean(bridgeOptions?.tools?.length),
                  })
                : fabricatedToolProgress
                ? createFabricatedToolProgressRecoveryInstruction(prompt, finalResponse.content, allToolCalls)
                : inFlightToolPlanning
                ? createToolActionPromiseRecoveryInstruction(prompt, finalResponse.content)
                : privateThinkingNarration
                  ? createFinalAnswerRecoveryInstruction(
                      prompt,
                      "The previous response exposed private reasoning instead of answering the user. Rewrite it as the actual final answer now.",
                    )
                : toolProtocolNarration
                  ? createToolProtocolNarrationRecoveryInstruction(prompt, finalResponse.content)
                : unnecessaryConfirmation
                  ? createUnnecessaryLocalActionConfirmationRecoveryInstruction(prompt, finalResponse.content)
                : unexecutedToolActionPromise
                  ? createToolActionPromiseRecoveryInstruction(prompt, finalResponse.content)
                : unappliedFileEditAnswer
                  ? createUnappliedFileEditRecoveryInstruction(prompt, finalResponse.content)
                : contradictedSuccessfulFileMutation
                  ? createFinalAnswerRecoveryInstruction(
                      prompt,
                      "The previous response said there was no edit/write result even though a successful file mutation tool result exists. Treat the file changes as already applied and summarize the completed work.",
                    )
                : unsupportedDeploymentAnswer
                  ? createDeploymentEvidenceRecoveryInstruction(prompt, finalResponse.content, {
                      canUseProviderTools: Boolean(bridgeOptions?.tools?.length),
                    })
                : unsupportedConnectedToolAnswer
                  ? createConnectedToolEvidenceRecoveryInstruction(prompt, finalResponse.content, {
                      canUseProviderTools: Boolean(bridgeOptions?.tools?.length),
                    })
                : localProgress
                ? createLocalToolFinalInstruction(prompt)
                : createFinalAnswerRecoveryInstruction(
                    prompt,
                    "The previous response exposed internal continuation text instead of answering the user. Rewrite it as the actual final answer now.",
                  ),
            ),
          ];
          passIndex += 1;
          continue;
        }

        return guardRecoveryFinalResponse(finalResponse);
      }

      const activeProgress = createLocalComputerProgress("active", "Running requested agent tools");
      const activeToolCalls = createActiveLocalToolCalls(assistantToolRequestContent, passIndex, toolExecutionPolicy);
      let liveToolCalls = activeToolCalls;

      updateGeneratedMessage(chatId, messageId, (message) => ({
        ...(activeToolCalls.length > 0 ? withStreamingWorkThinking(message, createVisibleToolPlanThinking(activeToolCalls), "active") : message),
        content: "",
        progress: withLocalComputerProgress(activeProgress, message.progress),
        toolCalls: activeToolCalls.length > 0 ? [...allToolCalls, ...activeToolCalls] : message.toolCalls,
      }));
      onExternalUpdate?.({
        progress: activeProgress,
        status: activeProgress.label,
        toolCall: activeToolCalls[0],
      });

      const toolRun = await runLocalComputerToolCalls({
        approvalDecisions: createRuntimeApprovalDecisions(workspaceSettings, approvalDecisions, chatId),
        assistantContent: assistantToolRequestContent,
        executionPolicy: toolExecutionPolicy,
        onRunSubagents: (tasks) => runParallelSubagents(tasks, messages, prompt, controller.signal, runtimeChat),
        onToolCallUpdate: (_callNumber, toolCall) => {
          const [stampedToolCall] = stampLocalToolCallIds([toolCall], passIndex);

          if (!stampedToolCall) {
            return;
          }

          liveToolCalls = upsertToolCall(liveToolCalls, stampedToolCall);
          attachLiveTerminalSession([stampedToolCall]);
          updateGeneratedMessage(chatId, messageId, (message) => ({
            ...message,
            content: "",
            progress: withLocalComputerProgress(activeProgress, message.progress),
            toolCalls: [...allToolCalls, ...liveToolCalls],
          }));
          onExternalUpdate?.({
            progress: activeProgress,
            status: formatDiscordToolStatus(stampedToolCall),
            toolCall: stampedToolCall,
          });
        },
        settings: workspaceSettings,
        signal: controller.signal,
        toolSettings,
        userPrompt: prompt,
        webSearchSettings: runtimeWebSearchSettings,
        webSearchMaxResults: runtimeWebSearchMaxResults,
      });

      if (toolRun.browserPreviewUrl && toolSettings.browserPreview) {
        setBrowserPreviewTarget((currentTarget) => ({
          id: (currentTarget?.id ?? 0) + 1,
          url: toolRun.browserPreviewUrl!,
        }));
      }

      totalExecutedToolCalls += toolRun.executedCount;
      const completedToolCalls = stampLocalToolCallIds(toolRun.toolCalls, passIndex);
      rememberProjectToolMemoryFromChatToolCalls(chatId, workspaceSettings, prompt, completedToolCalls);
      allArtifacts = mergeChatArtifacts(allArtifacts, toolRun.artifacts) ?? [];
      allSources = mergeChatSources(allSources, toolRun.sources);
      allToolCalls = [...allToolCalls, ...completedToolCalls];
      attachLiveTerminalSession(allToolCalls);
      localProgress = toolRun.waitingForApproval ? toolRun.progress : createLocalComputerProgress("complete", `${totalExecutedToolCalls} ran`);
      finalResponse.artifacts = allArtifacts.length > 0 ? allArtifacts : undefined;
      finalResponse.sources = allSources.length > 0 ? allSources : undefined;
      finalResponse.toolCalls = allToolCalls;
      finalResponse.approvalRequests = toolRun.approvalRequests.map((approval) => ({
        ...approval,
        messageId,
        resumeToolCallContent: assistantToolRequestContent,
      }));
      finalResponse.pendingToolCallContent = toolRun.waitingForApproval ? assistantToolRequestContent : undefined;
      finalResponse.waitingForApproval = toolRun.waitingForApproval;

      if (toolRun.waitingForApproval) {
        updateGeneratedMessage(chatId, messageId, (message) => ({
          ...withStreamingWorkThinking(message, createVisibleToolApprovalThinking(allToolCalls), "complete"),
          agentRunStatus: "waiting_for_approval",
          approvals: mergeAgentApprovals(message.approvals ?? [], finalResponse.approvalRequests ?? []),
          artifacts: mergeChatArtifacts(message.artifacts, toolRun.artifacts),
          content: "",
          progress: withLocalComputerProgress(toolRun.progress, message.progress),
          sources: toolRun.sources.length > 0 ? mergeChatSources(message.sources, toolRun.sources) : message.sources,
          toolCalls: allToolCalls,
        }));
        onExternalUpdate?.({
          progress: toolRun.progress,
          sources: toolRun.sources,
          status: "Tool approval is needed in Gilbert Codex.",
          toolCall: allToolCalls[allToolCalls.length - 1],
        });

        return {
          ...finalResponse,
          progress: toolRun.progress,
        };
      }

      if (toolRun.requestedCount === 0) {
        malformedToolRecoveryRetries += 1;

        if (malformedToolRecoveryRetries <= MAX_MALFORMED_TOOL_RECOVERY_RETRIES) {
          updateGeneratedMessage(chatId, messageId, (message) => ({
            ...message,
            content: "",
            progress: withLocalComputerProgress(createLocalComputerProgress("active", "Recovering tool request"), message.progress),
            toolCalls: allToolCalls.length > 0 ? allToolCalls : message.toolCalls,
          }));
          messages = [
            ...messages,
            createMessage("assistant", assistantToolRequestContent),
            createMessage("user", createMalformedToolCallRecoveryInstruction(prompt)),
          ];
          passIndex += 1;
          continue;
        }

        const synthesizedResponse = await synthesizeAnswerFromSavedToolResults(
          [...messages, createMessage("assistant", assistantToolRequestContent)],
          "The previous assistant output looked like an unreadable tool request. Write the final answer from the completed tool evidence.",
        );

        if (synthesizedResponse) {
          return synthesizedResponse;
        }

        return guardRecoveryFinalResponse({
          artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
          content: sanitizeLocalToolCallsForDisplay(assistantResponse.content, toolExecutionPolicy) || createToolFinalAnswerUnavailableMessage(allToolCalls, prompt),
          progress: localProgress,
          sources: allSources.length > 0 ? allSources : undefined,
          toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
        });
      }

      updateGeneratedMessage(chatId, messageId, (message) => ({
        ...withStreamingWorkThinking(message, createVisibleToolResultThinking(completedToolCalls), "complete"),
        artifacts: mergeChatArtifacts(message.artifacts, toolRun.artifacts),
        content: "",
        progress: withLocalComputerProgress(localProgress, message.progress),
        sources: toolRun.sources.length > 0 ? mergeChatSources(message.sources, toolRun.sources) : message.sources,
        toolCalls: allToolCalls,
      }));
      onExternalUpdate?.({
        progress: localProgress,
        sources: toolRun.sources,
        status: `${totalExecutedToolCalls} tool call${totalExecutedToolCalls === 1 ? "" : "s"} completed.`,
        toolCall: allToolCalls[allToolCalls.length - 1],
      });

      if (!emptyScaffoldRecoveryUsed && isEmptySelectedScaffoldProbe(prompt, toolRun.contextMessage, completedToolCalls)) {
        const recoveredResponse = await recoverEmptySimpleScaffold();
        if (recoveredResponse) {
          return recoveredResponse;
        }
        continue;
      }

      const hasRecoverableToolFailure =
        toolRun.requestedCount > 0 &&
        isRecoverableLocalEditFailure(toolRun.contextMessage, completedToolCalls, toolRun.recoverableFailure);

      if (hasRecoverableToolFailure && recoverableEditRetries < MAX_RECOVERABLE_LOCAL_EDIT_RETRIES) {
        recoverableEditRetries += 1;
        const retryProgress = createLocalComputerProgress("active", "Recovering file change");

        updateGeneratedMessage(chatId, messageId, (message) => ({
          ...message,
          content: "",
          progress: withLocalComputerProgress(retryProgress, message.progress),
          sources: toolRun.sources.length > 0 ? mergeChatSources(message.sources, toolRun.sources) : message.sources,
          toolCalls: allToolCalls,
        }));
        onExternalUpdate?.({
          progress: retryProgress,
          sources: toolRun.sources,
          status: "Recovering file change...",
          toolCall: allToolCalls[allToolCalls.length - 1],
        });

        messages = [
          ...messages,
          createMessage("assistant", assistantToolRequestContent),
          createMessage("user", toolRun.contextMessage),
          createMessage("user", createRecoverableLocalEditRetryInstruction(prompt, toolRun.contextMessage, toolRun.recoverableFailure)),
        ];
        passIndex += 1;
        continue;
      }

      if (toolRun.directAnswer) {
        return {
          artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
          content: toolRun.directAnswer,
          progress: localProgress,
          sources: allSources.length > 0 ? allSources : undefined,
          toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
        };
      }

      if (toolRun.requestedCount > 0 && toolRun.executedCount === 0) {
        const synthesizedResponse = await synthesizeAnswerFromSavedToolResults(
          [...messages, createMessage("assistant", assistantToolRequestContent), createMessage("user", toolRun.contextMessage)],
          createNoExecutedToolFinalInstruction(toolRun.contextMessage, hasRecoverableToolFailure),
        );

        if (synthesizedResponse) {
          return synthesizedResponse;
        }

        return {
          artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
          content: createNoExecutedToolFinalAnswer(toolRun.contextMessage),
          progress: localProgress,
          sources: allSources.length > 0 ? allSources : undefined,
          toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
        };
      }

      const simpleScaffoldResponse = maybeFinishSimpleLocalScaffold();
      if (simpleScaffoldResponse) {
        return simpleScaffoldResponse;
      }

      const nextPassWillReachBudget = passIndex + 1 >= maxToolPasses || totalExecutedToolCalls >= maxToolExecutions;
      messages = [
        ...messages,
        createMessage("assistant", assistantToolRequestContent),
        createMessage("user", toolRun.contextMessage),
        ...(nextPassWillReachBudget
          ? [
              createMessage(
                "user",
                createLocalToolBudgetFinalInstruction(
                  prompt,
                  `The app has gathered ${totalExecutedToolCalls} local tool result${totalExecutedToolCalls === 1 ? "" : "s"} across ${passIndex + 1} pass${passIndex + 1 === 1 ? "" : "es"}. Synthesize the answer from those results now unless user input is required.`,
                ),
              ),
            ]
          : []),
      ];

      passIndex += 1;
    }

    return guardRecoveryFinalResponse(finalResponse);

    function guardRecoveryFinalResponse(response: typeof finalResponse) {
      const content = response.content.trim();

      if (!content) {
        return {
          ...response,
          progress: localProgress,
        };
      }

      if (looksLikeInternalToolRecoveryAnswer(content) || isVisibleToolResultLeak(content, allToolCalls)) {
        return {
          ...response,
          content: createNeutralToolSynthesisFailureMessage(),
          progress: localProgress,
        };
      }

      return {
        ...response,
        progress: localProgress,
      };
    }
  }
