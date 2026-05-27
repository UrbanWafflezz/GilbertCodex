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
import { recordModelProviderUsage } from "../../../services/usageTracker";
import { getNineRouterCodexContextWindowTokens, isNineRouterCodexModelId } from "../../../lib/models";

export function compactProviderMessages(deps: WorkspaceRuntimeDeps, messages: ChatMessage[], settingsOverride: ProviderSettings, options: { target?: number; threshold?: number; toolBridge?: ProviderToolBridgeOptions }) {
  const { AUTO_COMPACT_CONTEXT_TARGET, AUTO_COMPACT_CONTEXT_THRESHOLD, compactMessagesForContext, createToolAwareProviderSettings, estimateModelProviderPayloadUsage, getProviderCompactionBaseline, recordContextCompaction, resolveContextWindowForModel } = deps;

    const effectiveSettings = createToolAwareProviderSettings(settingsOverride);
    const requestedThreshold = options.threshold ?? AUTO_COMPACT_CONTEXT_THRESHOLD;
    const providerCompactionBaseline = options.threshold === undefined ? getProviderCompactionBaseline(requestedThreshold) : null;
    const threshold = providerCompactionBaseline ? 0 : requestedThreshold;
    // Read the live context window from the ref so long-running tool-call
    // loops and async retries always see the current resolved value rather
    // than the snapshot captured when the request was first kicked off.
    // The selected-model lookup also lets us recover the correct per-model
    // window when a tool pass runs against a model that differs from the
    // chat's active selection (e.g. helper subagents, summarizers).
    const liveContextWindow = resolveContextWindowForModel(effectiveSettings.model, effectiveSettings);

    let compaction = compactMessagesForContext({
      contextWindowTokens: liveContextWindow.tokens,
      maxOutputTokens: effectiveSettings.maxTokens,
      messages,
      model: effectiveSettings.model,
      source: liveContextWindow.source,
      systemPrompt: effectiveSettings.systemPrompt,
      target: options.target,
      threshold,
      usageEstimator: (candidateMessages) =>
        estimateModelProviderPayloadUsage({
          contextWindowTokens: liveContextWindow.tokens,
          messages: candidateMessages,
          settings: effectiveSettings,
          source: liveContextWindow.source,
          toolBridge: options.toolBridge,
        }),
    });

    if ((compaction.afterUsage.overflowTokens ?? 0) > 0 || compaction.afterUsage.fitsContextWindow === false) {
      const emergencyCompaction = compactMessagesForContext({
        contextWindowTokens: liveContextWindow.tokens,
        maxOutputTokens: effectiveSettings.maxTokens,
        messages: compaction.messages,
        model: effectiveSettings.model,
        source: liveContextWindow.source,
        systemPrompt: effectiveSettings.systemPrompt,
        target: options.target ?? AUTO_COMPACT_CONTEXT_TARGET,
        threshold: 0,
        usageEstimator: (candidateMessages) =>
          estimateModelProviderPayloadUsage({
            contextWindowTokens: liveContextWindow.tokens,
            messages: candidateMessages,
            settings: effectiveSettings,
            source: liveContextWindow.source,
            toolBridge: options.toolBridge,
          }),
      });

      if (emergencyCompaction.compacted || emergencyCompaction.afterUsage.inputTokens <= compaction.afterUsage.inputTokens) {
        compaction = emergencyCompaction;
      }
    }

    const contextCompaction = compaction.compacted ? recordContextCompaction(compaction, providerCompactionBaseline) : undefined;

    return {
      ...compaction,
      contextCompaction,
    };
  }

export function resolveContextWindowForModel(deps: WorkspaceRuntimeDeps, model: string, settings: ProviderSettings): { maxOutputTokens?: number; source: "estimate" | "openrouter" | "provider"; tokens: number } {
  const { contextWindowRef, getConfiguredContextWindow, getFallbackContextWindowTokens, getManualModelBudgetOverride, modelContextWindowsRef } = deps;

    const normalizedModel = model.trim();
    const manualOverride = getManualModelBudgetOverride(settings, normalizedModel || settings.model.trim());
    const resolvedModel = normalizedModel || settings.model.trim();
    if (settings.provider === "9router" && isNineRouterCodexModelId(resolvedModel)) {
      return {
        maxOutputTokens: manualOverride?.maxOutputTokens,
        source: "provider",
        tokens: getNineRouterCodexContextWindowTokens(settings.subscriptionOptimization?.codexContextWindow),
      };
    }

    if (manualOverride?.contextWindowTokens) {
      return {
        maxOutputTokens: manualOverride.maxOutputTokens,
        source: "provider",
        tokens: manualOverride.contextWindowTokens,
      };
    }

    const configuredWindow = getConfiguredContextWindow(settings);
    if (configuredWindow && (!model.trim() || model.trim() === settings.model.trim())) {
      return configuredWindow;
    }

    const fromMap = normalizedModel ? modelContextWindowsRef.current[normalizedModel] : undefined;
    if (fromMap && fromMap.tokens > 0) {
      return fromMap;
    }
    const active = contextWindowRef.current;
    if (active.tokens > 0) {
      return active;
    }
    return { source: "estimate", tokens: getFallbackContextWindowTokens(normalizedModel) };
  }

export function getManualModelBudgetOverride(deps: WorkspaceRuntimeDeps, settings: ProviderSettings, model: string) {

    const normalizedModel = model.trim();
    return normalizedModel ? settings.modelBudgetOverrides?.[settings.provider]?.[normalizedModel] : undefined;
  }

export function getConfiguredContextWindow(deps: WorkspaceRuntimeDeps, settings: ProviderSettings): { source: "provider"; tokens: number } | null {
  const { isLocalModelProvider } = deps;

    if (!isLocalModelProvider(settings.provider)) {
      return null;
    }

    const tokens = settings.contextWindowTokens?.[settings.provider];

    return typeof tokens === "number" && Number.isFinite(tokens) && tokens > 0
      ? { source: "provider", tokens: Math.round(tokens) }
      : null;
  }

export function createContextBoundLocalToolExecutionPolicy(deps: WorkspaceRuntimeDeps, basePolicy: LocalComputerToolExecutionPolicy): LocalComputerToolExecutionPolicy {
  const { contextWindowRef, getModelVisibleToolResultCharBudget, minNullableCharCap } = deps;

    // Use the ref so this policy reflects the latest resolved context
    // window even when invoked partway through a long tool-call sequence.
    const modelVisibleResultChars = getModelVisibleToolResultCharBudget(contextWindowRef.current.tokens);

    return {
      ...basePolicy,
      maxToolCallOutputChars: minNullableCharCap(basePolicy.maxToolCallOutputChars ?? null, Math.max(modelVisibleResultChars, 96_000)),
      maxToolResultsChars: minNullableCharCap(basePolicy.maxToolResultsChars ?? null, modelVisibleResultChars),
    };
  }

export function getModelVisibleToolResultCharBudget(deps: WorkspaceRuntimeDeps, contextWindowTokens: number, settingsOverride?: ProviderSettings) {

    const level = settingsOverride?.subscriptionOptimization?.tokenSaverLevel ?? deps.providerSettings.subscriptionOptimization?.tokenSaverLevel ?? "low";
    const budget = getTokenSaverToolResultBudget(level);
    const tokenBudget = Math.min(Math.max(Math.floor(contextWindowTokens * budget.ratio), budget.minTokens), budget.maxTokens);

    return tokenBudget * 4;
  }

function getTokenSaverToolResultBudget(level: ProviderSettings["subscriptionOptimization"]["tokenSaverLevel"]) {
  switch (level) {
    case "max":
      return { maxTokens: 20_000, minTokens: 3_000, ratio: 0.08 };
    case "high":
      return { maxTokens: 32_000, minTokens: 4_000, ratio: 0.12 };
    case "medium":
      return { maxTokens: 48_000, minTokens: 5_000, ratio: 0.16 };
    case "off":
    case "low":
    default:
      return { maxTokens: 60_000, minTokens: 6_000, ratio: 0.2 };
  }
}

export function minNullableCharCap(deps: WorkspaceRuntimeDeps, cap: number | null, budget: number) {

    if (cap === null || !Number.isFinite(cap)) {
      return budget;
    }

    return Math.min(cap, budget);
  }

export function getProviderCompactionBaseline(deps: WorkspaceRuntimeDeps, threshold: number) {
  const { activeChat, lastProviderContextUsage } = deps;

    const usage = lastProviderContextUsage?.chatId === activeChat.id ? lastProviderContextUsage.usage : null;

    if (!usage || usage.tokenSource === "estimate") {
      return null;
    }

    // Compare the recorded usage against the context window that was active
    // when the usage was measured, NOT the current contextWindow.tokens.
    // The ContextWindowUsage record already carries its own contextWindowTokens,
    // so this avoids the "stale numerator over fresh denominator" race where
    // a transient fallback drop (effect re-run while keys/baseUrls churn)
    // would otherwise force-compact at threshold=0 spuriously.
    const baselineWindow = Math.max(usage.contextWindowTokens, 1);

    const requestTokens = usage.requestedTotalTokens ?? usage.totalTokens;

    return usage.inputTokens > Math.floor(baselineWindow * threshold) || requestTokens > baselineWindow ? usage : null;
  }

export function recordContextCompaction(deps: WorkspaceRuntimeDeps, compaction: ReturnType<typeof compactMessagesForContext>, providerBaseline: ContextWindowUsage | null): ContextCompactionNotice {
  const { activeChat, CONTEXT_COMPACTION_STRATEGY, CONTEXT_COMPACTION_SUMMARY_VERSION, setLastContextCompaction } = deps;

    const beforeTokens = providerBaseline?.inputTokens ?? compaction.beforeUsage.inputTokens;
    const notice = {
      afterTokens: compaction.afterUsage.inputTokens,
      beforeTokens,
      chatId: activeChat.id,
      compactedAt: new Date().toISOString(),
      compactedMessageCount: compaction.compactedMessageCount,
      contextWindowTokens: compaction.afterUsage.contextWindowTokens,
      forcedByProviderUsage: Boolean(providerBaseline),
      strategy: CONTEXT_COMPACTION_STRATEGY,
      summaryVersion: CONTEXT_COMPACTION_SUMMARY_VERSION,
      thresholdTokens: compaction.thresholdTokens,
    } satisfies ContextCompactionNotice;

    setLastContextCompaction(notice);

    return notice;
  }

export function createContextCompactionProgress(deps: WorkspaceRuntimeDeps, compaction: ReturnType<typeof compactMessagesForContext> & { contextCompaction?: ContextCompactionNotice }): ChatProgressItem {
  const { CONTEXT_COMPACTION_PROGRESS_ID, formatTokenCount } = deps;

    const notice = compaction.contextCompaction;
    const afterTokens = notice?.afterTokens ?? compaction.afterUsage.inputTokens;
    const contextTokens = notice?.contextWindowTokens ?? compaction.afterUsage.contextWindowTokens;
    const compactedMessageCount = notice?.compactedMessageCount ?? compaction.compactedMessageCount;

    return {
      detail: `${compactedMessageCount} older messages compacted. Active request is now ${formatTokenCount(afterTokens)} / ${formatTokenCount(contextTokens)}.`,
      id: CONTEXT_COMPACTION_PROGRESS_ID,
      label: "Automatically compacting context",
      status: "complete",
    };
  }

export function withContextCompactionProgress(deps: WorkspaceRuntimeDeps, compactionProgress: ChatProgressItem, progress: ChatProgressItem[] | undefined) {
  const { CONTEXT_COMPACTION_PROGRESS_ID } = deps;

    const progressWithoutCompaction = (progress ?? []).filter((item) => item.id !== CONTEXT_COMPACTION_PROGRESS_ID);

    return [compactionProgress, ...progressWithoutCompaction];
  }

export function withContextCompactionMarker(deps: WorkspaceRuntimeDeps, message: ChatMessage, notice: ContextCompactionNotice | undefined): ChatMessage {
  const { createChatContextCompaction, getContextCompactionMarkerKey } = deps;

    if (!notice) {
      return message;
    }

    const marker = createChatContextCompaction(notice);
    const contextCompactions = message.contextCompactions ?? [];

    if (contextCompactions.some((candidate) => candidate.compactedAt === marker.compactedAt)) {
      return message;
    }

    const existingIndex = contextCompactions.findIndex((candidate) => getContextCompactionMarkerKey(candidate) === getContextCompactionMarkerKey(marker));

    if (existingIndex >= 0) {
      return {
        ...message,
        contextCompactions: contextCompactions.map((candidate, index) => index === existingIndex ? marker : candidate),
      };
    }

    return {
      ...message,
      contextCompactions: [...contextCompactions, marker],
    };
  }

export function createChatContextCompaction(deps: WorkspaceRuntimeDeps, notice: ContextCompactionNotice): ChatContextCompaction {

    return {
      afterTokens: notice.afterTokens,
      beforeTokens: notice.beforeTokens,
      compactedAt: notice.compactedAt,
      compactedMessageCount: notice.compactedMessageCount,
      contextWindowTokens: notice.contextWindowTokens,
      forcedByProviderUsage: notice.forcedByProviderUsage,
      strategy: notice.strategy,
      summaryVersion: notice.summaryVersion,
      thresholdTokens: notice.thresholdTokens,
    };
  }

export function getContextCompactionMarkerKey(deps: WorkspaceRuntimeDeps, compaction: ChatContextCompaction) {

    return `${compaction.strategy ?? "context-compaction"}:${compaction.summaryVersion ?? "unknown"}`;
  }

export function recordProviderContextUsage(deps: WorkspaceRuntimeDeps, chatId: string, messages: ChatMessage[], settings: ProviderSettings, options: { allowDecrease?: boolean; stream?: boolean; toolBridge?: ProviderToolBridgeOptions }) {
  const { annotateProviderPayloadSpike, countAutoCompactedProviderMessages, estimateProviderContextUsageForDisplay, lastProviderContextUsageRef, preserveContextUsageHighWaterMark, setLastProviderContextUsage } = deps;

    const previousRecord = lastProviderContextUsageRef.current?.chatId === chatId ? lastProviderContextUsageRef.current : null;
    const previousUsage = previousRecord?.usage ?? null;
    const previousCompactedCount = previousRecord?.compactedMessageCount ?? 0;
    const compactedMessageCount = countAutoCompactedProviderMessages(messages);
    // Only allow the displayed counter to drop when a NEW compaction happened
    // relative to the last recorded usage. Counting (rather than checking
    // "is any marker present?") prevents the high-water-mark from being
    // permanently disabled after the first compaction, which was previously
    // letting small helper / sub-agent / streaming updates collapse the
    // displayed counter mid-conversation.
    const allowDecrease = Boolean(options.allowDecrease || compactedMessageCount > previousCompactedCount);
    const usage = preserveContextUsageHighWaterMark(
      annotateProviderPayloadSpike(estimateProviderContextUsageForDisplay(messages, settings, options), previousUsage),
      previousUsage,
      { allowDecrease },
    );

    const nextUsage = {
      chatId,
      compactedMessageCount,
      usage,
    };
    lastProviderContextUsageRef.current = nextUsage;
    setLastProviderContextUsage(nextUsage);

    return usage;
  }

export function recordProviderActualUsage(deps: WorkspaceRuntimeDeps, chatId: string, messages: ChatMessage[], settings: ProviderSettings, usage: Awaited<ReturnType<typeof streamProviderMessage>>["usage"], options: { allowDecrease?: boolean; stream?: boolean; toolBridge?: ProviderToolBridgeOptions }) {
  const { applyProviderUsageToContextEstimate, countAutoCompactedProviderMessages, estimateProviderContextUsageForDisplay, lastProviderContextUsageRef, preserveContextUsageHighWaterMark, setLastProviderContextUsage } = deps;

    const previousRecord = lastProviderContextUsageRef.current?.chatId === chatId ? lastProviderContextUsageRef.current : null;
    const previousUsage = previousRecord?.usage ?? null;
    const previousCompactedCount = previousRecord?.compactedMessageCount ?? 0;
    const compactedMessageCount = countAutoCompactedProviderMessages(messages);
    const allowDecrease = Boolean(options.allowDecrease || compactedMessageCount > previousCompactedCount);
    const measuredUsage = preserveContextUsageHighWaterMark(
      applyProviderUsageToContextEstimate(estimateProviderContextUsageForDisplay(messages, settings, options), usage),
      previousUsage,
      { allowDecrease },
    );
    const nextUsage = {
      chatId,
      compactedMessageCount,
      usage: measuredUsage,
    };
    lastProviderContextUsageRef.current = nextUsage;
    setLastProviderContextUsage(nextUsage);
    recordModelProviderUsage({
      chatId,
      measuredUsage,
      rawUsage: usage,
      settings,
    });
  }

export function estimateProviderContextUsageForDisplay(deps: WorkspaceRuntimeDeps, messages: ChatMessage[], settings: ProviderSettings, options: { stream?: boolean; toolBridge?: ProviderToolBridgeOptions }) {
  const { estimateModelProviderPayloadUsage, resolveContextWindowForModel } = deps;

    // Resolve per the message's target model so the recorded usage is paired
    // with the correct contextWindowTokens. This is what later compaction
    // baselines compare against, so an accurate window here is critical.
    const liveContextWindow = resolveContextWindowForModel(settings.model, settings);
    return estimateModelProviderPayloadUsage({
      contextWindowTokens: liveContextWindow.tokens,
      messages,
      settings,
      source: liveContextWindow.source,
      stream: options.stream ?? true,
      toolBridge: options.toolBridge,
    });
  }

export function createProviderPayloadGuardrailProgress(deps: WorkspaceRuntimeDeps, usage: ContextWindowUsage): ChatProgressItem | null {
  const { PROVIDER_PAYLOAD_GUARDRAIL_PROGRESS_ID } = deps;

    const spike = usage.payloadSpike;

    if (!spike) {
      return null;
    }

    return {
      detail: spike.summary,
      id: PROVIDER_PAYLOAD_GUARDRAIL_PROGRESS_ID,
      label: "Provider payload guardrail",
      status: "pending",
    };
  }

export function withProviderPayloadGuardrailProgress(deps: WorkspaceRuntimeDeps, guardrailProgress: ChatProgressItem | null, progress: ChatProgressItem[] | undefined) {
  const { PROVIDER_PAYLOAD_GUARDRAIL_PROGRESS_ID } = deps;

    const progressWithoutGuardrail = (progress ?? []).filter((item) => item.id !== PROVIDER_PAYLOAD_GUARDRAIL_PROGRESS_ID);

    return guardrailProgress ? [guardrailProgress, ...progressWithoutGuardrail] : progressWithoutGuardrail;
  }

export function recordPlanningProviderRequest(deps: WorkspaceRuntimeDeps, chatId: string, request: PlanningProviderRequest) {
  const { recordProviderContextUsage } = deps;

    recordProviderContextUsage(chatId, request.messages, request.settings, { stream: request.stream });
  }

export function recordPlanningProviderUsage(deps: WorkspaceRuntimeDeps, chatId: string, request: PlanningProviderRequest, usage: Awaited<ReturnType<typeof streamProviderMessage>>["usage"]) {
  const { recordProviderActualUsage } = deps;

    recordProviderActualUsage(chatId, request.messages, request.settings, usage, { stream: request.stream });
  }

export function createChatProviderSettings(deps: WorkspaceRuntimeDeps, chat: ChatSummary | null | undefined, overrides: Partial<ProviderSettings>): ProviderSettings {
  const { generalSettings, getModelProvider, isModelProviderId, providerSettings } = deps;

    const baseSettings = {
      ...providerSettings,
      ...overrides,
      providerModels: {
        ...providerSettings.providerModels,
        ...overrides.providerModels,
      },
    };
    const overrideProvider = isModelProviderId(overrides.provider) ? overrides.provider : undefined;
    const chatProvider = isModelProviderId(chat?.provider) ? chat.provider : undefined;
    const provider = overrideProvider ?? chatProvider ?? baseSettings.provider;
    const overrideModel = typeof overrides.model === "string" ? overrides.model.trim() : "";
    const chatModel = typeof chat?.model === "string" ? chat.model.trim() : "";
    const rememberedProviderModel = baseSettings.providerModels[provider]?.trim() ?? "";
    const model =
      overrideModel ||
      chatModel ||
      rememberedProviderModel ||
      (provider === baseSettings.provider ? baseSettings.model.trim() : "") ||
      getModelProvider(provider).defaultModel;

    return {
      ...baseSettings,
      agentEnvironment: generalSettings.agentEnvironment,
      model,
      provider,
      providerModels: {
        ...baseSettings.providerModels,
        [provider]: model,
      },
    };
  }

export function createToolAwareProviderSettings(deps: WorkspaceRuntimeDeps, overrides: Partial<ProviderSettings>, chat: ChatSummary | null | undefined): ProviderSettings {
  const { createChatProviderSettings, createLocationAwareToolSettings, getEffectiveMaxOutputTokens, getManualModelBudgetOverride, locationServicesEnabled, resolveContextWindowForModel, supportsProviderThinking } = deps;

    const chatScopedSettings = createChatProviderSettings(chat, overrides);
    const mergedSettings = {
      ...chatScopedSettings,
      thinking: {
        ...chatScopedSettings.thinking,
        ...overrides.thinking,
      },
      tools: createLocationAwareToolSettings(overrides.tools ?? chatScopedSettings.tools, locationServicesEnabled),
    };
    // Use the resolved per-model window so helper subagents and switched-
    // model passes get an accurate output budget rather than the chat's
    // last-rendered window.
    const manualOverride = getManualModelBudgetOverride(mergedSettings, mergedSettings.model);
    const maxTokens = manualOverride?.maxOutputTokens ?? getEffectiveMaxOutputTokens(mergedSettings, resolveContextWindowForModel(mergedSettings.model, mergedSettings).tokens);

    return {
      ...mergedSettings,
      maxTokens,
      thinking: {
        ...mergedSettings.thinking,
        enabled: mergedSettings.thinking.enabled && supportsProviderThinking(mergedSettings.provider, mergedSettings.thinking.effort, mergedSettings.model),
      },
    };
  }

export function createPromptAwareProviderSettings(deps: WorkspaceRuntimeDeps, prompt: string, overrides: Partial<ProviderSettings>, chat: ChatSummary | null | undefined): ProviderSettings {
  const { createPromptAwareThinkingSettings, createToolAwareProviderSettings } = deps;

    const settings = createToolAwareProviderSettings(overrides, chat);

    return {
      ...settings,
      thinking: createPromptAwareThinkingSettings(settings.thinking, prompt),
    };
  }

export function hasRequestScopedWorkspaceToolsEnabled(deps: WorkspaceRuntimeDeps, settings: ProviderSettings) {

    return Boolean(
      settings.tools.fileBrowser ||
      settings.tools.fileSearch ||
      settings.tools.codeView ||
      settings.tools.codeEdit ||
      settings.tools.fileCreation ||
      settings.tools.terminal ||
      settings.tools.browserPreview ||
      settings.tools.sourceControl,
    );
  }

export function createPromptAwareThinkingSettings(deps: WorkspaceRuntimeDeps, thinking: ProviderSettings["thinking"], prompt: string): ProviderSettings["thinking"] {
  void deps;
  void prompt;
    return thinking;
  }

export function createFinalOnlyProviderSettings(deps: WorkspaceRuntimeDeps, prompt: string, chat: ChatSummary | null | undefined, overrides: Partial<ProviderSettings> = {}): ProviderSettings {
  const { createLocationAwareToolSettings, createPromptAwareThinkingSettings, createToolAwareProviderSettings, locationServicesEnabled, providerSettings } = deps;

    const tools = createLocationAwareToolSettings(overrides.tools ?? providerSettings.tools, locationServicesEnabled);

    const settings = createToolAwareProviderSettings({
      ...overrides,
      tools: {
        ...tools,
        browserPreview: false,
        codeEdit: false,
        codeGeneration: false,
        codeView: false,
        colorTools: false,
        desktopComputer: false,
        fileCreation: false,
        fileSafety: false,
        fileBrowser: false,
        fileSearch: false,
        imageGeneration: false,
        mcpServers: false,
        pdfTools: false,
        permissions: false,
        planning: false,
        reactNativeTools: false,
        sourceControl: false,
        sqlTools: false,
        terminal: false,
        testingTools: false,
        typescriptTools: false,
        webSearch: false,
        weatherTools: false,
        workflowAutomation: false,
      },
    }, chat);

    return prompt
      ? {
          ...settings,
          thinking: createPromptAwareThinkingSettings(settings.thinking, prompt),
        }
      : settings;
  }

function createApprovalChatSessionKey(deps: WorkspaceRuntimeDeps, workspaceSettings: LocalWorkspaceSettings, chatId?: string) {
  const { activeChat, createApprovalWorkspaceSessionKey } = deps;
  const resolvedChatId = chatId ?? activeChat?.id ?? "active-chat";

  return JSON.stringify({
    chatId: resolvedChatId,
    workspace: createApprovalWorkspaceSessionKey(workspaceSettings),
  });
}

export function rememberSessionApprovalDecision(deps: WorkspaceRuntimeDeps, approval: AgentApproval, decision: AgentApprovalDecision, workspaceSettings: LocalWorkspaceSettings, chatId?: string) {
  const { createApprovalSessionDecisionKey, sessionApprovalDecisionsRef } = deps;

    if (decision.scope !== "session" || decision.status === "denied" || approval.tool === "planning_handoff") {
      return;
    }

    const workspaceKey = createApprovalChatSessionKey(deps, workspaceSettings, chatId);
    const workspaceDecisions = sessionApprovalDecisionsRef.current[workspaceKey] ?? {};
    const exactDecision: AgentApprovalDecision = {
      editedArgs: decision.editedArgs,
      note: decision.note,
      scope: "session",
      status: decision.status,
    };
    const reusableDecision: AgentApprovalDecision = {
      note: decision.note,
      scope: "session",
      status: "approved",
    };
    const reusableKey = createApprovalSessionDecisionKey(approval);
    const shouldReuseForToolSession = decision.status === "approved" && !decision.editedArgs;

    sessionApprovalDecisionsRef.current = {
      ...sessionApprovalDecisionsRef.current,
      [workspaceKey]: {
        ...workspaceDecisions,
        [approval.id]: exactDecision,
        ...(shouldReuseForToolSession ? { [reusableKey]: reusableDecision } : {}),
      },
    };
  }

export function createRuntimeApprovalDecisions(deps: WorkspaceRuntimeDeps, workspaceSettings: LocalWorkspaceSettings, approvalDecisions?: Record<string, AgentApprovalDecision>, chatId?: string) {
  const { sessionApprovalDecisionsRef } = deps;

    const sessionDecisions = sessionApprovalDecisionsRef.current[createApprovalChatSessionKey(deps, workspaceSettings, chatId)] ?? {};

    if (Object.keys(sessionDecisions).length === 0) {
      return approvalDecisions;
    }

    return {
      ...sessionDecisions,
      ...(approvalDecisions ?? {}),
    };
  }

export function getRuntimeWebSearchMaxResults(deps: WorkspaceRuntimeDeps, settings: ProviderSettings, requestedMaxResults: number) {
  const { MAX_WEB_SEARCH_RESULTS } = deps;

    const requested = requestedMaxResults ?? settings.webSearch.maxResults;

    return Math.min(Math.max(Math.round(requested), 1), MAX_WEB_SEARCH_RESULTS);
  }

export function getRuntimeWebSearchSettings(deps: WorkspaceRuntimeDeps, settings: ProviderSettings, requestedWebSearch: ChatSendInput["webSearch"] | ChatWebSearch): WebSearchSettings {
  const { createLocationAwareWebSearchSettings, getRuntimeWebSearchMaxResults, locationServicesEnabled } = deps;

    const runtimeSettings: WebSearchSettings = {
      ...settings.webSearch,
      enabled: requestedWebSearch?.enabled ?? settings.webSearch.enabled,
      maxResults: getRuntimeWebSearchMaxResults(settings, requestedWebSearch?.maxResults),
      provider: requestedWebSearch?.provider ?? settings.webSearch.provider,
    };

    return createLocationAwareWebSearchSettings(runtimeSettings, locationServicesEnabled);
  }

export function supportsProviderParallelToolCalls(deps: WorkspaceRuntimeDeps, provider: ProviderSettings["provider"]) {

    return provider === "openai" || provider === "openrouter" || provider === "groq" || provider === "xai";
  }

export function createLocationAwareWebSearchSettings(deps: WorkspaceRuntimeDeps, settings: WebSearchSettings, locationServicesEnabled: boolean): WebSearchSettings {

    if (locationServicesEnabled) {
      return settings;
    }

    return {
      ...settings,
      brave: {
        ...settings.brave,
        enablePlaceSearch: false,
        locationCity: "",
        locationCountry: "",
        locationLatitude: "",
        locationLongitude: "",
        locationPostalCode: "",
        locationState: "",
        locationStateName: "",
        locationTimezone: "",
        placeLocation: "",
      },
    };
  }
