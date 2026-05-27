import { lazy, startTransition, Suspense, useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import { Info, Trash2 } from "lucide-react";
import { ConfirmDialog, NoticeDialog, TextInputDialog } from "../../components/dialogs/AppDialog";
import { BulkDeleteChatsDialog } from "../../components/dialogs/BulkDeleteChatsDialog";
import { AppShell } from "../../components/layout/AppShell";
import { OnboardingDialog } from "../../components/onboarding/OnboardingDialog";
import { ProviderConnectionDialog } from "../../components/onboarding/ProviderConnectionDialog";
import { ProjectRunDialog } from "../../components/projectRun/ProjectRunDialog";
import { ChatPage } from "../../pages/ChatPage";
import { SettingsPage, preloadSettingsSection } from "../../pages/settings/SettingsPage";
import type { SettingsSectionId } from "../../pages/settings/types";
import { resolveSettingsNavSection } from "../../pages/settings/settingsNavigation";
import {
  loadActiveChatId,
  loadAppAppearanceSettings,
  loadAppGeneralSettings,
  loadAppPersonalizationSettings,
  loadAppearanceMode,
  loadChatById,
  loadChats,
  loadDiscordBridgeSettings,
  loadLocalWorkspaceSettings,
  loadPersistentString,
  loadProjects,
  loadProviderSettings,
  saveActiveChatId,
  saveAppAppearanceSettings,
  saveAppGeneralSettings,
  saveAppPersonalizationSettings,
  saveAppearanceMode,
  saveChats,
  saveDiscordBridgeSettings,
  saveLocalWorkspaceSettings,
  savePersistentString,
  saveProjects,
  saveProviderSettings,
} from "../../lib/appStorage";
import { applyAppAppearanceToDocument } from "../../lib/appearance";
import {
  createEmptyChat,
  createId,
  createMessage,
  DEFAULT_PROJECT,
  hasComposerDraftContent,
  isDiscardableEmptyChat,
  isEmptyChat,
  isNoProjectName,
  isPlainResearchChat,
  normalizeProjectName,
  sortChatsByUpdatedAt,
  titleFromMessage,
} from "../../lib/chatUtils";
import { contentReferencesChatTitle, createChatResearchContextContent } from "../../lib/chatResearchContext";
import {
  AUTO_COMPACT_CONTEXT_TARGET,
  AUTO_COMPACT_CONTEXT_THRESHOLD,
  compactMessagesForContext,
  CONTEXT_COMPACTION_STRATEGY,
  CONTEXT_COMPACTION_SUMMARY_VERSION,
  formatTokenCount,
  getFallbackContextWindowTokens,
  getFallbackModelContextWindow,
  getFallbackModelContextWindows,
  type ContextCompactionNotice,
  type ContextWindowUsage,
  type ModelContextWindow,
  type ModelContextWindowMap,
} from "../../lib/contextWindow";
import { getEffectiveMaxOutputTokens, isLocalModelProvider } from "../../lib/generationSettings";
import { formatHostPlatformLabel, getHostPlatform } from "../../lib/hostPlatform";
import { matchesHotkey } from "../../lib/hotkeys";
import { copyTextToClipboard } from "../../lib/clipboard";
import {
  detectProjectRunConfigForWorkspace,
  getProjectRunActionPreviewUrl,
  normalizeProjectRunConfig,
  updateProjectRunLastRun,
} from "../../lib/projectRunConfig";
import {
  createProjectGoal,
  createProjectGoalContinuePrompt,
  getProjectGoalForProject,
  normalizeProjectGoalObjective,
  parseProjectGoalCommandAction,
} from "../../lib/projectGoals";
import { CHAT_MODEL_OPTIONS, getDefaultBaseUrlForProvider, getDefaultModelForProvider, getModelProvider, getNineRouterCodexContextWindowTokens, getProviderApiKey, isModelProviderId, isNineRouterCodexModelId, isNineRouterGithubCopilotModelId, supportsProviderThinking } from "../../lib/models";
import { scheduleDelayedIdleTask, scheduleIdleTask } from "../../lib/idleTask";
import {
  computeAutomationSchedulerDelayMs,
  computeNextRunAt,
  createAutomationRunPrompt,
  createAutomationRuntimeToolOverrides,
  createAutomationSimulationSummary,
  createAutomationTaskFromDraft,
  createAutomationToolScope,
  createAutomationToolSelectionPrompt,
  createAutomationUserMessageContent,
  filterAutomationWebSources,
  formatAutomationInboxResult,
  formatAutomationNotificationSummary,
  isAutomationTaskDue,
  normalizeAutomationState,
} from "../../lib/automationScheduler";
import { createPdfLibraryContextMessages, syncPdfLibraryFromChats } from "../../lib/pdfLibrary";
import {
  createChatMemoryFingerprint,
  createDurableMemoryContext,
  createDurableMemoryScopeFromChat,
  createDurableProjectMemoryScope,
  loadDurableChatMemoryState,
  loadDurableProjectMemoryState,
  persistDurableMemoryFromChat,
  saveDurableProjectMemoryState,
  updateDurableProjectMemoryMap,
} from "../../memory";
import {
  createPlanningInputRequest,
  createPlanningProgress,
  runPlanningMode,
  type PlanningProviderRequest,
} from "../../services/planningClient";
import {
  createPlanResearchFollowupInstruction,
  createPlanResearchInstruction,
  formatResearchPayload,
  isResearchDeepEnough,
  PLAN_RESEARCH_BUDGET,
  summarizeResearchEvidence,
} from "../../services/planResearchClient";
import { createFallbackChatTitle, generateChatTitle } from "../../services/chatTitleClient";
import { fetchProviderModelContextLengths, isProviderEmptyResponseError, sendProviderMessage, streamProviderMessage } from "../../services/modelProviderClient";
import { annotateProviderPayloadSpike, applyProviderUsageToContextEstimate, countAutoCompactedProviderMessages, estimateModelProviderPayloadUsage, preserveContextUsageHighWaterMark } from "../../services/modelProviderUsage";
import { loadSkillRegistry, subscribeSkillRegistry } from "../../services/skillRegistry";
import {
  createBridgeChatToolCall,
  createDefaultToolRegistry,
  coalesceToolBridgeCalls,
  inferProviderToolBridgeFormat,
  createProjectToolMemoryContext,
  createProjectToolMemoryScope,
  executeToolBridgeCalls,
  isVisibleToolResultLeak,
  learnProjectToolMemoryFromBridgeRun,
  learnProjectToolMemoryFromChatToolCalls,
  loadProjectToolMemoryState,
  parseVisibleTextToolCalls,
  resolveToolPermission,
  saveProjectToolMemoryState,
  selectAdvertisedBridgeTools,
  selectToolCapabilityPlan,
  shouldAttachWebSearch,
  validateToolArguments,
} from "../../toolBridge";
import type { ProviderToolBridgeOptions, ToolAutomationScope, ToolBridgeExecutionBatch } from "../../toolBridge";
import { buildComputerFileIndex, createComputerGitWorktree, createLocalWorkspaceContext, getComputerFileIndexSummary, pickComputerFolder, resolveLocalWorkspaceRoots } from "../../localWorkspace/files";
import {
  createLocalComputerProgress,
  createApprovalSessionDecisionKey,
  hasLocalComputerToolCalls,
  runLocalComputerToolCalls,
  sanitizeLocalToolCallsForDisplay,
  STANDARD_LOCAL_COMPUTER_TOOL_EXECUTION_POLICY,
  type LocalComputerToolExecutionPolicy,
  type LocalSubagentResult,
  type LocalSubagentTask,
  routePrimitiveEvidenceBatchToWorkflow,
} from "../../localWorkspace/localToolRuntimeDisabled";
import {
  createActiveLocalToolCalls,
  createAssistantToolRequestContent,
  createCompletedToolFallbackSummary,
  createFabricatedToolProgressRecoveryInstruction,
  createFinalAnswerRecoveryInstruction,
  createInterruptedResponseContinuationInstruction,
  createLocalToolBudgetFinalInstruction,
  createLocalToolFinalInstruction,
  createMalformedToolCallRecoveryInstruction,
  createNeutralToolSynthesisFailureMessage,
  createFreshLocalToolEvidenceInstruction,
  createRecoverableLocalEditRetryInstruction,
  createToolActionPromiseRecoveryInstruction,
  createToolProtocolNarrationRecoveryInstruction,
  createUnnecessaryLocalActionConfirmationRecoveryInstruction,
  createUnappliedFileEditRecoveryInstruction,
  createPlanningAnswerMessages,
  createSimpleLocalTaskCompletionAnswer,
  getLatestUserPrompt,
  getPendingPlanningInputRequest,
  getPlanningInputRequests,
  detectSimpleLocalTaskCompletion,
  isSimpleLocalScaffoldRequest,
  isEmptySelectedScaffoldProbe,
  isFileReadSynthesisToolCall,
  isRecoverableLocalEditFailure,
  isAbortError,
  isInterruptedAssistantMessage,
  isToolResultFallbackAnswer,
  looksLikeInFlightToolPlanning,
  looksLikeFabricatedToolProgress,
  looksLikeInternalToolRecoveryAnswer,
  looksLikeOnlyToolPrelude,
  looksLikePrivateThinkingNarration,
  looksLikeSubstantiveVisibleAnswer,
  looksLikeToolProtocolNarration,
  looksLikeUnnecessaryLocalActionConfirmation,
  looksLikeUnappliedFileEditAnswer,
  looksLikeUnexecutedToolActionPromise,
  needsFreshLocalToolEvidence,
  requiresWorkspaceMutationForPrompt,
  requiresWorkspaceToolCallForPrompt,
  shouldSynthesizeEmptyFinalFromToolResults,
  shouldHoldStreamingContentForToolCalls,
  stripLeadingToolPreludeForDisplay,
  markPlanningInputAnswered,
  mergeChatSources,
  hasSuccessfulMutatingFileToolCall,
  stampLocalToolCallIds,
  withLocalComputerProgress,
  withWebSearchProgress,
} from "../chatRuntime";
import { createNoProjectWorkspace, mergeProjectsWithChats, sameLocalWorkspaceSettings, samePathSet, sortProjectsByUpdatedAt } from "../projectState";
import { refreshWorkspaceContext } from "../../localWorkspace/workspaceContext";
import { formatWebSearchProviderLabel, MAX_WEB_SEARCH_RESULTS } from "../../services/webSearchClient";
import { NINE_ROUTER_PROVIDER_ID } from "../../services/nineRouterClient";
import {
  createAgentPrimitiveToolContent,
  createAgentRunRequest,
  createAgentRunWorkflowToolContent,
  createAgentRuntimeDecisionInstruction,
  parseAgentRuntimeDecision,
  shouldStartAppAgentRun,
  summarizeAgentRuntimeDecision,
  type AgentRuntimeDecision,
} from "../../agentRuntime/codingAgent";
import {
  getAppInfo,
  getDefaultTerminalWorkingDirectory,
  isTauriDesktopRuntime,
  listenForDiscordInteractions,
  listenForMobileBridgeUpdates,
  openProjectInExternalTool,
  sendDiscordChannelMessage,
  sendDiscordWebhookMessage,
  sendDiscordInteractionResponse,
  startMobileBridge,
  takeMobileBridgePayloads,
  takeMobileBridgeRequests,
  updateMobileBridgeDesktopPayload,
  type DiscordInteractionEvent,
} from "../tauriClient";
import { createDesktopMobileSyncPayload, mergeMobilePayloadIntoDesktopState, type SyncTombstone } from "../../mobileBridge/mobileSync";
import { createDiscordBridgeAutoStartKey, ensureDiscordBridgeAutoStarted } from "../discordBridgeAutoStart";
import { listAgentRuns, saveAgentRun } from "../agentRunClient";
import { loadAutomationState, saveAutomationState } from "../automationClient";
import { getMcpState, mcpDesktopAvailable } from "../mcpClient";
import { bringCurrentWindowToForeground, openChatWindow } from "../windowClient";
import {
  configureDesktopNotificationActivation,
  configureDesktopNotifications,
  createNeedsAttentionNotification,
  createNeedsInputNotification,
  notifyAgentRunStatus,
  prepareDesktopNotifications,
} from "../desktopNotifications";
import type { AppInfo } from "../../types/app";
import type { AgentApproval, AgentApprovalDecision, AgentRun } from "../../types/agentRun";
import type { AutomationRun, AutomationRunReason, AutomationState, AutomationTask, AutomationTaskDraft } from "../../types/automation";
import type { AuthSession } from "../../types/auth";
import type {
  ChatArtifact,
  ChatAttachment,
  ChatContextCompaction,
  ChatComposerDraft,
  ChatMessage,
  ChatPlanningInputAnswer,
  ChatPlanningInputRequest,
  ChatProgressItem,
  ChatResearchReference,
  ChatSendInput,
  ChatSource,
  ChatStreamTiming,
  ChatSummary,
  ChatToolCall,
  ChatWebSearch,
} from "../../types/chat";
import type { LocalWorkspaceSettings } from "../../types/localWorkspace";
import type { McpServerState } from "../../types/mcp";
import type { PrimaryRoute } from "../../types/navigation";
import type { CreateProjectOptions, ProjectGoal, ProjectSummary } from "../../types/project";
import type { ProjectOpenTargetId } from "../../types/projectOpen";
import type { ProjectRunAction, ProjectRunConfig } from "../../types/projectRun";
import type { DiscordBridgeSettings } from "../../types/discord";
import type { TerminalAttachedSession } from "../../types/terminal";
import type { AppAppearanceSettings, AppGeneralSettings, AppPersonalizationSettings, AppearanceMode, ProviderSettings, WebSearchSettings } from "../../types/settings";
import type { SkillRegistryState } from "../../types/skills";
import { normalizeToolRegistrySettings } from "../../types/tools";
import type { ToolRegistrySettings } from "../../types/tools";

import type { WorkspaceRuntimeDeps } from "./runtimeTypes";
import {
  RouteLoading,
  formatDiscordStreamMessage,
  waitForDiscordFlushSlot,
  formatLocalToolPreviewProgress,
  formatDiscordToolStatus,
  getChatIdFromLocationHash,
  createChatDeeplink,
  formatChatAsMarkdown,
  createForkedChat,
  createUniqueProjectName,
  createProjectBaseName,
  projectNameFromPath,
  normalizeSelectedProjectPath,
  looksLikeContradictedSuccessfulFileMutationAnswer,
  readErrorMessage,
  upsertToolCall,
  mergeMessageWorkTrace,
  mergeAgentApprovals,
  mergeChatArtifacts,
  recoverInterruptedAgentRun,
} from "./workspaceHelpers";
import { persistChatState as persistChatStateImpl, setChats as setChatsImpl, handleComposerDraftChange as handleComposerDraftChangeImpl, queueDurableMemoryForChangedChats as queueDurableMemoryForChangedChatsImpl, queueDurableMemoryForChatIds as queueDurableMemoryForChatIdsImpl, scheduleDurableMemoryFlush as scheduleDurableMemoryFlushImpl, flushDurableMemoryQueue as flushDurableMemoryQueueImpl, takeNextDurableMemoryChatId as takeNextDurableMemoryChatIdImpl, persistDurableMemoryForChatId as persistDurableMemoryForChatIdImpl } from "./state/chatPersistence";
import { resolveWorkspaceForChatProject as resolveWorkspaceForChatProjectImpl, isActiveChatProject as isActiveChatProjectImpl } from "./state/workspaceLookup";
import { persistAgentRun as persistAgentRunImpl, createAgentRunForMessage as createAgentRunForMessageImpl, updateAgentRun as updateAgentRunImpl, setAgentRunWaiting as setAgentRunWaitingImpl, setAgentRunCompleted as setAgentRunCompletedImpl, setAgentRunFailed as setAgentRunFailedImpl, setAgentRunCancelled as setAgentRunCancelledImpl, setAgentRunContinuing as setAgentRunContinuingImpl, createPlanningExecutionApproval as createPlanningExecutionApprovalImpl } from "./state/agentRuns";
import { handleNewChat as handleNewChatImpl, handleSelectChat as handleSelectChatImpl, handleActiveChatModelChange as handleActiveChatModelChangeImpl, handleProviderConnectionChoice as handleProviderConnectionChoiceImpl, handleSelectProject as handleSelectProjectImpl, openCreateProjectDialog as openCreateProjectDialogImpl, createProjectFromFolder as createProjectFromFolderImpl, handleLocalWorkspaceChange as handleLocalWorkspaceChangeImpl, bindActiveChatToProject as bindActiveChatToProjectImpl, handleToggleTerminal as handleToggleTerminalImpl, attachLiveTerminalSession as attachLiveTerminalSessionImpl, handleTogglePin as handleTogglePinImpl, handleOpenRenameChat as handleOpenRenameChatImpl, confirmRenameChat as confirmRenameChatImpl, handleArchiveActiveChat as handleArchiveActiveChatImpl, handleCopyWorkingDirectory as handleCopyWorkingDirectoryImpl, handleCopySessionId as handleCopySessionIdImpl, handleCopyChatDeeplink as handleCopyChatDeeplinkImpl, handleCopyChatMarkdown as handleCopyChatMarkdownImpl, handleForkActiveChatLocal as handleForkActiveChatLocalImpl, handleForkChatFromMessage as handleForkChatFromMessageImpl, handleForkActiveChatWorktree as handleForkActiveChatWorktreeImpl, handleMessageFeedback as handleMessageFeedbackImpl, handleAddAutomation as handleAddAutomationImpl, handleOpenActiveChatInNewWindow as handleOpenActiveChatInNewWindowImpl, getActiveWorkingDirectory as getActiveWorkingDirectoryImpl, copyLabeledTextToClipboard as copyLabeledTextToClipboardImpl, activateForkedChat as activateForkedChatImpl, notifyPlanningInputNeeded as notifyPlanningInputNeededImpl, notifyRunNeedsAttention as notifyRunNeedsAttentionImpl, notifyRunComplete as notifyRunCompleteImpl, touchProject as touchProjectImpl, restoreProjectLocalWorkspace as restoreProjectLocalWorkspaceImpl, saveWorkspaceForProject as saveWorkspaceForProjectImpl, handleClearChatMessages as handleClearChatMessagesImpl, handleDeleteChat as handleDeleteChatImpl, handleDeleteProject as handleDeleteProjectImpl, handleOpenBulkDeleteChats as handleOpenBulkDeleteChatsImpl, handleToggleBulkDeleteChat as handleToggleBulkDeleteChatImpl, handleSelectAllBulkDeleteChats as handleSelectAllBulkDeleteChatsImpl, handleClearBulkDeleteChats as handleClearBulkDeleteChatsImpl, confirmClearChatMessages as confirmClearChatMessagesImpl, confirmDeleteChat as confirmDeleteChatImpl, confirmDeleteProject as confirmDeleteProjectImpl, confirmBulkDeleteChats as confirmBulkDeleteChatsImpl } from "./state/projectActions";
import { isChatSending as isChatSendingImpl, isAnyChatSending as isAnyChatSendingImpl, getSendingChatIds as getSendingChatIdsImpl, setChatSending as setChatSendingImpl, getActiveGenerationByRequest as getActiveGenerationByRequestImpl, getActiveGenerationByMessage as getActiveGenerationByMessageImpl, createActiveGeneration as createActiveGenerationImpl, setActiveGenerationTarget as setActiveGenerationTargetImpl, isRequestInactive as isRequestInactiveImpl, finishActiveGeneration as finishActiveGenerationImpl, handleStopGeneration as handleStopGenerationImpl, stopActiveGeneration as stopActiveGenerationImpl, stopStreamingMessage as stopStreamingMessageImpl, stopStaleStreamingMessages as stopStaleStreamingMessagesImpl, stopStreamingAssistantMessage as stopStreamingAssistantMessageImpl, completeActiveProgress as completeActiveProgressImpl, preserveQueuedMessagesForSnapshot as preserveQueuedMessagesForSnapshotImpl, restoreChatSnapshot as restoreChatSnapshotImpl, updateQueuedChatSends as updateQueuedChatSendsImpl, scheduleGeneratedChatTitle as scheduleGeneratedChatTitleImpl, applyGeneratedChatTitle as applyGeneratedChatTitleImpl, shouldPreserveExistingTitleAfterUserEdit as shouldPreserveExistingTitleAfterUserEditImpl, enqueueChatSend as enqueueChatSendImpl, handleDeleteQueuedMessage as handleDeleteQueuedMessageImpl, handleHoldQueuedMessage as handleHoldQueuedMessageImpl, handleUpdateQueuedMessage as handleUpdateQueuedMessageImpl, handleEditUserMessageAndRegenerate as handleEditUserMessageAndRegenerateImpl, handleSteerQueuedMessage as handleSteerQueuedMessageImpl } from "./chat/generationQueue";
import { steerActiveResponse as steerActiveResponseImpl, createMessagesForProvider as createMessagesForProviderImpl, createChatToolSelectionPrompt as createChatToolSelectionPromptImpl, referencesSelectedWorkspaceForToolSelection as referencesSelectedWorkspaceForToolSelectionImpl, resolveChatResearchReferences as resolveChatResearchReferencesImpl, getChatResearchCandidates as getChatResearchCandidatesImpl, createChatResearchContextMessages as createChatResearchContextMessagesImpl, createActiveProjectBoundaryMessage as createActiveProjectBoundaryMessageImpl, createMemorySearchForRequest as createMemorySearchForRequestImpl, clampMemoryToolInteger as clampMemoryToolIntegerImpl, limitMemoryToolContent as limitMemoryToolContentImpl, rememberProjectMapSnapshot as rememberProjectMapSnapshotImpl, loadToolMemoryForProject as loadToolMemoryForProjectImpl, saveToolMemoryForProject as saveToolMemoryForProjectImpl, createToolMemoryScope as createToolMemoryScopeImpl, getEnabledWorkspaceRoots as getEnabledWorkspaceRootsImpl, resolveEnabledWorkspaceRoots as resolveEnabledWorkspaceRootsImpl, rememberProjectToolMemoryFromBridgeRun as rememberProjectToolMemoryFromBridgeRunImpl, rememberProjectToolMemoryFromChatToolCalls as rememberProjectToolMemoryFromChatToolCallsImpl, getToolMemoryProjectName as getToolMemoryProjectNameImpl, createSourceControlContextMessages as createSourceControlContextMessagesImpl, shouldSkipLocalContextForGithub as shouldSkipLocalContextForGithubImpl, createLocalWorkspaceContextMessages as createLocalWorkspaceContextMessagesImpl, hasAnyLocalWorkspaceToolEnabled as hasAnyLocalWorkspaceToolEnabledImpl, getAutomaticWorkspaceContextCharBudget as getAutomaticWorkspaceContextCharBudgetImpl, syncLocalWorkspaceIndexSummary as syncLocalWorkspaceIndexSummaryImpl } from "./context/messageContext";
import { compactProviderMessages as compactProviderMessagesImpl, resolveContextWindowForModel as resolveContextWindowForModelImpl, getManualModelBudgetOverride as getManualModelBudgetOverrideImpl, getConfiguredContextWindow as getConfiguredContextWindowImpl, createContextBoundLocalToolExecutionPolicy as createContextBoundLocalToolExecutionPolicyImpl, getModelVisibleToolResultCharBudget as getModelVisibleToolResultCharBudgetImpl, minNullableCharCap as minNullableCharCapImpl, getProviderCompactionBaseline as getProviderCompactionBaselineImpl, recordContextCompaction as recordContextCompactionImpl, createContextCompactionProgress as createContextCompactionProgressImpl, withContextCompactionProgress as withContextCompactionProgressImpl, withContextCompactionMarker as withContextCompactionMarkerImpl, createChatContextCompaction as createChatContextCompactionImpl, getContextCompactionMarkerKey as getContextCompactionMarkerKeyImpl, recordProviderContextUsage as recordProviderContextUsageImpl, recordProviderActualUsage as recordProviderActualUsageImpl, estimateProviderContextUsageForDisplay as estimateProviderContextUsageForDisplayImpl, createProviderPayloadGuardrailProgress as createProviderPayloadGuardrailProgressImpl, withProviderPayloadGuardrailProgress as withProviderPayloadGuardrailProgressImpl, recordPlanningProviderRequest as recordPlanningProviderRequestImpl, recordPlanningProviderUsage as recordPlanningProviderUsageImpl, createToolAwareProviderSettings as createToolAwareProviderSettingsImpl, createPromptAwareProviderSettings as createPromptAwareProviderSettingsImpl, hasRequestScopedWorkspaceToolsEnabled as hasRequestScopedWorkspaceToolsEnabledImpl, createPromptAwareThinkingSettings as createPromptAwareThinkingSettingsImpl, createFinalOnlyProviderSettings as createFinalOnlyProviderSettingsImpl, rememberSessionApprovalDecision as rememberSessionApprovalDecisionImpl, createRuntimeApprovalDecisions as createRuntimeApprovalDecisionsImpl, getRuntimeWebSearchMaxResults as getRuntimeWebSearchMaxResultsImpl, getRuntimeWebSearchSettings as getRuntimeWebSearchSettingsImpl, supportsProviderParallelToolCalls as supportsProviderParallelToolCallsImpl, createLocationAwareWebSearchSettings as createLocationAwareWebSearchSettingsImpl } from "./context/contextWindow";
import { createAppAgentToolCall as createAppAgentToolCallImpl, appendAgentRuntimeStep as appendAgentRuntimeStepImpl, completeLatestAgentRuntimeStep as completeLatestAgentRuntimeStepImpl, mapAgentDecisionToStepType as mapAgentDecisionToStepTypeImpl, runAppOwnedCodingAgent as runAppOwnedCodingAgentImpl } from "./agentRuntime/appAgentRunner";
import { streamAssistantWithLocalTools as streamAssistantWithLocalToolsImpl } from "./tools/localToolStreaming";
import { createToolFinalAnswerUnavailableMessage as createToolFinalAnswerUnavailableMessageImpl, createSynthesisRecoveryFallback as createSynthesisRecoveryFallbackImpl, summarizeUserFacingFailure as summarizeUserFacingFailureImpl, createRecoverableBridgeToolRetryInstruction as createRecoverableBridgeToolRetryInstructionImpl, getToolCallRawOutput as getToolCallRawOutputImpl, extractSuggestedFileReadCandidates as extractSuggestedFileReadCandidatesImpl, extractNearbyPathCandidates as extractNearbyPathCandidatesImpl, extractSuggestedFileSearchQuery as extractSuggestedFileSearchQueryImpl, isMissingFileReadToolCall as isMissingFileReadToolCallImpl, isMissingFileReadError as isMissingFileReadErrorImpl, extractMissingReadPath as extractMissingReadPathImpl, extractToolInputPath as extractToolInputPathImpl, createMissingReadSearchQuery as createMissingReadSearchQueryImpl, getLastPathSegment as getLastPathSegmentImpl, isRecoverableBridgeArgumentError as isRecoverableBridgeArgumentErrorImpl, summarizeCompletedToolFallback as summarizeCompletedToolFallbackImpl, shouldKeepToolOutputOutOfChat as shouldKeepToolOutputOutOfChatImpl, countTextLines as countTextLinesImpl, limitFallbackToolOutput as limitFallbackToolOutputImpl, createGitToolFallbackAnswer as createGitToolFallbackAnswerImpl, parseGitStatusFallbackFiles as parseGitStatusFallbackFilesImpl, parseGitDiffStatFallbackFiles as parseGitDiffStatFallbackFilesImpl, extractToolStdout as extractToolStdoutImpl, cleanGitFallbackPath as cleanGitFallbackPathImpl, dedupeGitFallbackFiles as dedupeGitFallbackFilesImpl, groupGitStatusFallbackFiles as groupGitStatusFallbackFilesImpl, formatGitStatusFallbackGroup as formatGitStatusFallbackGroupImpl, formatGitStatSuffix as formatGitStatSuffixImpl, createNoExecutedToolFinalInstruction as createNoExecutedToolFinalInstructionImpl, createNoExecutedToolFinalAnswer as createNoExecutedToolFinalAnswerImpl, extractFirstUnsuccessfulToolSection as extractFirstUnsuccessfulToolSectionImpl, summarizeUnsuccessfulToolSection as summarizeUnsuccessfulToolSectionImpl, stripToolSectionHeader as stripToolSectionHeaderImpl, stripToolAdaptationRecommendation as stripToolAdaptationRecommendationImpl, appendAutoCompactionContinuation as appendAutoCompactionContinuationImpl, isAutoCompactionContinuationMessage as isAutoCompactionContinuationMessageImpl } from "./tools/toolFallbacks";
import { runParallelSubagents as runParallelSubagentsImpl, streamProviderMessageWithRetry as streamProviderMessageWithRetryImpl, runProviderRetryWithTimeout as runProviderRetryWithTimeoutImpl, createProviderRetryInstruction as createProviderRetryInstructionImpl, isRetryableProviderMessageError as isRetryableProviderMessageErrorImpl, hasLocalToolEvidence as hasLocalToolEvidenceImpl, createEmptyResponseRetrySettings as createEmptyResponseRetrySettingsImpl, updateGeneratedMessage as updateGeneratedMessageImpl, preserveVisibleResponseThinking as preserveVisibleResponseThinkingImpl, createInterruptedResponseContextMessages as createInterruptedResponseContextMessagesImpl, createSteeringInstruction as createSteeringInstructionImpl, withSteeringProgress as withSteeringProgressImpl, removeSteeringProgress as removeSteeringProgressImpl, type ProviderStreamingDeps } from "./providers/providerStreaming";
import { handleDiscordInteraction as handleDiscordInteractionImpl, resolveDiscordSourceChat as resolveDiscordSourceChatImpl, findLatestDiscordConversationChat as findLatestDiscordConversationChatImpl, discordSourceMatchesInteraction as discordSourceMatchesInteractionImpl, createDiscordMessageSource as createDiscordMessageSourceImpl, isDiscordNewChatCommand as isDiscordNewChatCommandImpl, normalizeDiscordCommandName as normalizeDiscordCommandNameImpl, resolveDiscordChatProject as resolveDiscordChatProjectImpl, sendDiscordReply as sendDiscordReplyImpl, createDiscordResponseStreamer as createDiscordResponseStreamerImpl } from "./discord/discordActions";
import { handleSendMessage as handleSendMessageImpl, startSendMessage as startSendMessageImpl, type SendActionsDeps } from "./chat/sendActions";
import { handleResolveToolApproval as handleResolveToolApprovalImpl } from "./tools/approvalActions";
import { handleSubmitPlanningInput as handleSubmitPlanningInputImpl, handleRequestPlanRevision as handleRequestPlanRevisionImpl } from "./chat/planningActions";
import { handleRegenerateResponse as handleRegenerateResponseImpl } from "./chat/regenerateActions";
import { renderUtilityPage as renderUtilityPageImpl, renderChatPage as renderChatPageImpl, handleSkipOnboarding as handleSkipOnboardingImpl, handleNeverShowOnboarding as handleNeverShowOnboardingImpl, handleOpenOnboardingSettings as handleOpenOnboardingSettingsImpl, handleOpenProviderConnectionNineRouterSettings as handleOpenProviderConnectionNineRouterSettingsImpl, handleOpenProviderConnectionKeySettings as handleOpenProviderConnectionKeySettingsImpl, handleRouteChange as handleRouteChangeImpl, handleSettingsSectionChange as handleSettingsSectionChangeImpl } from "./routes/renderRoutes";

const loadAppsPage = () => import("../../pages/apps/AppsPage");
const loadTasksPage = () => import("../../pages/TasksPage");
const loadWeatherRadarPage = () => import("../../pages/WeatherRadarPage");
const AppsPage = lazy(() => loadAppsPage().then((module) => ({ default: module.AppsPage })));
const TasksPage = lazy(() => loadTasksPage().then((module) => ({ default: module.TasksPage })));
const WeatherRadarPage = lazy(() => loadWeatherRadarPage().then((module) => ({ default: module.WeatherRadarPage })));

export interface ActiveGeneration {
  chatId: string;
  controller: AbortController;
  messageId?: string;
  previousChat: ChatSummary;
  previousChatExisted: boolean;
  requestId: number;
  restoreDraft?: ChatComposerDraft;
}

export interface QueuedChatSend {
  chatId: string;
  held?: boolean;
  id: string;
  input: ChatSendInput;
  userMessageId: string;
}

export interface ComposerDraftRestoreRequest {
  draft: ChatComposerDraft;
  id: string;
}

export interface DiscordReplyTarget {
  applicationId: string;
  channelId?: string | null;
  interactionId: string;
  token: string;
  username?: string | null;
}

export interface StartSendMessageOptions {
  automationScope?: ToolAutomationScope;
  background?: boolean;
  discordReply?: DiscordReplyTarget;
  onAssistantMessageCreated?: (details: {
    agentRunId: string;
    chatId: string;
    messageId: string;
    model: string;
    provider: ProviderSettings["provider"];
    userMessageId: string;
  }) => void;
  onAssistantMessageSettled?: (details: {
    agentRunId: string;
    approvals?: AgentApproval[];
    chatId: string;
    content: string;
    error?: string;
    messageId: string;
    model: string;
    provider: ProviderSettings["provider"];
    sources?: ChatSource[];
    status: "completed" | "failed" | "waiting_for_approval";
    toolCalls?: ChatToolCall[];
  }) => void;
  preserveExistingTitle?: boolean;
  preserveChatModelSelection?: boolean;
  providerPrompt?: string;
  providerSettingsOverrides?: Partial<ProviderSettings>;
  runtimeToolOverrides?: Partial<ProviderSettings["tools"]>;
  sourceChat?: ChatSummary;
  toolSelectionPrompt?: string;
  userMessageSource?: ChatMessage["source"];
}

export interface DiscordStreamUpdate {
  content?: string;
  progress?: ChatProgressItem;
  sources?: ChatSource[];
  status?: string;
  toolCall?: ChatToolCall;
}

export interface AssistantToolResponse {
  approvalRequests?: AgentApproval[];
  artifacts?: ChatArtifact[];
  content: string;
  pendingToolCallContent?: string;
  progress?: ChatProgressItem;
  reasoning?: string;
  sources?: ChatSource[];
  streamTiming?: ChatStreamTiming;
  toolCalls?: ChatToolCall[];
  waitingForApproval?: boolean;
}

export interface ApprovedPlanExecutionContext {
  originalPrompt: string;
  planContent: string;
  requiresMutation: boolean;
}

export type SessionApprovalDecisionMap = Record<string, AgentApprovalDecision>;
export type SessionApprovalDecisionsByWorkspace = Record<string, SessionApprovalDecisionMap>;

const MAX_PLANNING_INPUT_ROUNDS = 3;
const PINNED_MODEL_IDS = CHAT_MODEL_OPTIONS.map((option) => option.value);
const LOCAL_TOOL_FINAL_MIN_TOKENS = 4096;
const MAX_LOCAL_TOOL_PASSES = 12;
const MAX_LOCAL_TOOL_EXECUTIONS = 48;
const MAX_TOOL_FINALIZATION_RETRIES = 3;
const MAX_MALFORMED_TOOL_RECOVERY_RETRIES = 2;
const MAX_RECOVERABLE_LOCAL_EDIT_RETRIES = 4;
const MESSAGE_RETRY_TIMEOUT_MS = 10_000;
const CONTEXT_COMPACTION_PROGRESS_ID = "context-compaction";
const PROVIDER_PAYLOAD_GUARDRAIL_PROGRESS_ID = "provider-payload-guardrail";
const BRIDGE_TOOL_APPROVAL_RESUME_KIND = "bridge_tool_calls";
const DISCORD_NEW_CHAT_COMMAND = "gilbertnewchat";
const DISCORD_STREAM_UPDATE_INTERVAL_MS = 2_400;
const LIVE_CHAT_COMMIT_MIN_INTERVAL_MS = 50;
const LIVE_AGENT_RUN_COMMIT_MIN_INTERVAL_MS = 120;
const AGENT_RUN_SAVE_DELAY_MS = 600;
const STEERING_PROGRESS_ID = "response-steering";
const ONBOARDING_NEVER_SHOW_KEY = "gilbert-codex.onboarding.never-show.v1";
const PROVIDER_CONNECTION_PROMPT_LAST_SHOWN_VERSION_KEY = "gilbert-codex.provider-connection.last-shown-version.v1";
const PROVIDER_CONNECTION_PROMPT_NEVER_SHOW_KEY = "gilbert-codex.provider-connection.never-show.v1";
const LAST_ACTIVE_PROJECT_KEY = "gilbert-codex.last-active-project.v1";
const PENDING_CHAT_TITLE = "Naming chat...";
const DURABLE_MEMORY_PERSIST_DELAY_MS = 350;
const DURABLE_MEMORY_BACKFILL_DELAY_MS = 45_000;
const DURABLE_MEMORY_BATCH_DELAY_MS = 700;
const LIVE_CHAT_PERSISTENCE_DELAY_MS = 2_000;
const MOBILE_BRIDGE_SYNC_DELAY_MS = 100;
const MOBILE_BRIDGE_MOBILE_DRAIN_INTERVAL_MS = 150;
const AGENT_RUN_RECOVERY_DELAY_MS = 8_000;
const DEFAULT_TERMINAL_CWD_DELAY_MS = 4_000;
const DESKTOP_NOTIFICATION_PREPARE_DELAY_MS = 20_000;
const DISCORD_BRIDGE_AUTOSTART_DELAY_MS = 15_000;
const MODEL_CONTEXT_REFRESH_DELAY_MS = 6_000;
const ROUTE_PRELOAD_DELAY_MS = 35_000;
const WORKSPACE_CONTEXT_REFRESH_DELAY_MS = 8_000;
const CHAT_HYDRATION_SWITCH_SETTLE_DELAY_MS = 140;
const DURABLE_MEMORY_BATCH_SIZE = 1;

function createApprovedPlanExecutionPrompt(originalPrompt: string, planContent: string) {
  return [
    "Execute the approved plan now.",
    `Original request: ${originalPrompt}`,
    "Approved plan:",
    planContent,
  ].join("\n\n");
}

function createApprovedPlanExecutionInstruction(originalPrompt: string, planContent: string) {
  return [
    "APPROVED PLAN EXECUTION CONTRACT",
    `Original request: ${originalPrompt}`,
    "The user approved the plan. This is no longer plan/research mode.",
    "Execute the approved plan now using the app-exposed workspace tools.",
    "Do not answer with a memory-only recap, implementation plan, status summary, or statement that you are missing file access.",
    "Memory search is optional context only; it never satisfies execution. Verify current files with file tools, apply the planned edits, run the relevant checks, and then summarize the real changes.",
    "If a tool call fails because its arguments are malformed, retry with corrected arguments instead of stopping.",
    "If a risky write/terminal action needs approval, request that approval and wait.",
    "",
    "Approved plan:",
    planContent,
  ].join("\n");
}

function approvedPlanRequiresMutation(originalPrompt: string, planContent: string) {
  const text = `${originalPrompt}\n${planContent}`;

  if (/\b(?:no files? to change|no code changes?|read[-\s]?only|analysis only|plan only)\b/i.test(text)) {
    return false;
  }

  return /\b(?:add|append|change|create|delete|edit|fix|implement|insert|move|patch|refactor|remove|rename|replace|update|write|files? to change)\b/i.test(text);
}

function hasSuccessfulApprovedPlanWorkspaceTool(toolCalls: ChatToolCall[] = []) {
  return toolCalls.some((toolCall) => {
    if (toolCall.status !== "complete") {
      return false;
    }

    const toolId = toolCall.toolId ?? "";
    return (
      toolId.startsWith("files_") ||
      toolId.startsWith("git_") ||
      toolId === "terminal_run" ||
      toolId === "browser_preview_open"
    );
  });
}

function hasSuccessfulApprovedPlanMutation(toolCalls: ChatToolCall[] = []) {
  return toolCalls.some((toolCall) => {
    if (toolCall.status !== "complete") {
      return false;
    }

    const toolId = toolCall.toolId ?? "";
    const input = toolCall.input ?? "";
    const dryRun = /"dryRun"\s*:\s*true|dryRun:\s*true/i.test(input);
    const changedFiles = hasSuccessfulMutatingFileToolCall([toolCall]);

    if (changedFiles && !dryRun) {
      return true;
    }

    return (
      !dryRun &&
      /^git_(?:branch|commit|stage)$/.test(toolId)
    );
  });
}

function createApprovedPlanExecutionRetryInstruction(context: ApprovedPlanExecutionContext, attemptedAnswer: string, toolCalls: ChatToolCall[] = []) {
  const hasWorkspaceTool = hasSuccessfulApprovedPlanWorkspaceTool(toolCalls);
  const hasMutation = hasSuccessfulApprovedPlanMutation(toolCalls);
  const excerpt = attemptedAnswer.replace(/\s+/g, " ").trim().slice(0, 700);

  return [
    "APPROVED PLAN EXECUTION NOT COMPLETE",
    `Original request: ${context.originalPrompt}`,
    "The user approved the plan, so a descriptive recap is not an acceptable final answer.",
    !hasWorkspaceTool
      ? "No successful current workspace file/edit/terminal/browser/git tool call has run yet in this execution pass."
      : context.requiresMutation && !hasMutation
        ? "Current workspace tools have run, but no successful file/edit/write mutation from the approved plan is recorded yet."
        : "",
    "Continue executing the approved plan with the real app-exposed tools now. Prefer files_read_many/files_search/files_list for current source, files_create_directory for folders, files_edit_many/files_apply_patch/files_write_many for changes, and terminal_run with cwd/workingDirectory for verification.",
    "Do not use memory_search as a substitute for current source. Do not say you lack file access while workspace tools are attached.",
    excerpt ? `Rejected non-execution answer excerpt: ${excerpt}` : "",
    "",
    "Approved plan:",
    context.planContent,
  ].filter(Boolean).join("\n\n");
}

function createApprovedPlanExecutionFailedAnswer(context: ApprovedPlanExecutionContext, toolCalls: ChatToolCall[] = []) {
  const hasWorkspaceTool = hasSuccessfulApprovedPlanWorkspaceTool(toolCalls);
  const hasMutation = hasSuccessfulApprovedPlanMutation(toolCalls);

  return [
    "I could not start the approved plan execution cleanly.",
    !hasWorkspaceTool
      ? "The model did not produce a successful current workspace tool call after the plan was approved."
      : context.requiresMutation && !hasMutation
        ? "The model inspected tools but did not produce a successful file edit/write from the approved plan."
        : "",
    "No file changes were applied from that approved plan.",
  ].filter(Boolean).join("\n\n");
}

export interface InitialChatState {
  activeChatId: string;
  chats: ChatSummary[];
}

function loadInitialChatState(): InitialChatState {
  const durableChats = sortChatsByUpdatedAt(loadChats().filter((chat) => !isDiscardableEmptyChat(chat)));
  const hashChatId = getChatIdFromLocationHash();
  const hashChat = hashChatId ? durableChats.find((chat) => chat.id === hashChatId && !chat.archived) : undefined;

  if (hashChat) {
    return {
      activeChatId: hashChat.id,
      chats: durableChats,
    };
  }

  const storedActiveChatId = loadActiveChatId();
  const storedActiveChat = durableChats.find((chat) => chat.id === storedActiveChatId && !chat.archived);

  if (storedActiveChat) {
    return {
      activeChatId: storedActiveChat.id,
      chats: durableChats,
    };
  }

  const lastProjectName = normalizeProjectName(loadPersistentString(LAST_ACTIVE_PROJECT_KEY) || durableChats.find((chat) => !chat.archived)?.project || DEFAULT_PROJECT);
  const startupChat = createEmptyChat(lastProjectName);

  return {
    activeChatId: startupChat.id,
    chats: sortChatsByUpdatedAt([startupChat, ...durableChats]),
  };
}

function pruneEmptyChats(chats: ChatSummary[], keepChatId?: string) {
  return chats.filter((chat) => chat.id === keepChatId || !isDiscardableEmptyChat(chat));
}

function sameProjectName(left?: string | null, right?: string | null) {
  return normalizeProjectName(left).toLowerCase() === normalizeProjectName(right).toLowerCase();
}

function sameComposerDraft(left?: ChatComposerDraft | null, right?: ChatComposerDraft | null) {
  const normalizedLeft = hasComposerDraftContent(left) ? left : null;
  const normalizedRight = hasComposerDraftContent(right) ? right : null;

  if (!normalizedLeft && !normalizedRight) {
    return true;
  }

  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
}

function createApprovalWorkspaceSessionKey(settings: LocalWorkspaceSettings) {
  const roots = settings.roots.map((root) => root.trim().replace(/[\\/]+$/, "")).filter(Boolean).sort();

  return JSON.stringify({
    enabled: settings.enabled,
    roots,
    scope: settings.scope,
  });
}

function createLocationAwareToolSettings(tools: unknown, locationServicesEnabled: boolean): ToolRegistrySettings {
  const normalizedTools = normalizeToolRegistrySettings(tools);

  return {
    ...normalizedTools,
    weatherTools: locationServicesEnabled && normalizedTools.weatherTools,
  };
}

function isSubscriptionRouteModel(model: string | undefined) {
  const normalizedModel = model?.trim().toLowerCase() ?? "";

  return Boolean(
    normalizedModel &&
    (
      normalizedModel.startsWith("cx/") ||
      normalizedModel.startsWith("gh/") ||
      normalizedModel.startsWith("github/") ||
      normalizedModel.startsWith("github-copilot/") ||
      normalizedModel.startsWith("github_copilot/") ||
      isNineRouterCodexModelId(normalizedModel) ||
      isNineRouterGithubCopilotModelId(normalizedModel)
    ),
  );
}

function createDiscordRuntimeContextMessages(workspaceSettings: LocalWorkspaceSettings, webSearchToolAvailable: boolean, webSearchProvider: WebSearchSettings["provider"]) {
  const providerLabel = formatWebSearchProviderLabel(webSearchProvider);

  return [
    createMessage(
      "user",
      [
        "DISCORD REMOTE REQUEST CONTEXT",
        "The latest user message came from Discord through Gilbert's signed bridge. Treat it like a normal Gilbert Codex app request.",
        "Use only app-exposed provider tools that are attached to this request. Do not invent visible terminal, Git, file, browser preview, MCP, workflow, or weather actions.",
        workspaceSettings.enabled
          ? "Local workspace metadata may be attached as host-provided context; use actual tool results when precise file, Git, terminal, or preview evidence is required."
          : "No local folder is selected for this request.",
        webSearchToolAvailable
          ? `The web_search tool may be attached with ${providerLabel}. Call it only when current, latest, date-sensitive, source-backed, or official web evidence is actually needed.`
          : "Web search is disabled for this turn. If current, latest, date-sensitive, or source-backed facts are needed, say what could not be verified instead of inventing a search.",
      ].join("\n"),
    ),
  ];
}

function createProjectRunRequestPrompt({
  action,
  projectName,
  root,
}: {
  action: ProjectRunAction;
  projectName: string;
  root: string;
}) {
  const cwd = action.cwd?.trim() || root;
  const configuredPreviewUrl = action.previewUrl?.trim();
  const previewUrl = getProjectRunActionPreviewUrl(action);
  const previewPort = getPreviewUrlPort(previewUrl);

  return [
    `Run this project using the saved Run action "${action.label}".`,
    "",
    `Project: ${projectName}`,
    `Workspace root: ${root}`,
    `Working directory: ${cwd}`,
    `Action kind: ${action.kind}`,
    `Shell: ${action.shell ?? "default"}`,
    `Background dev server/watch mode: ${action.background ? "yes" : "no"}`,
    configuredPreviewUrl ? `Configured preview URL: ${configuredPreviewUrl}` : "Configured preview URL: none",
    previewUrl && previewUrl !== configuredPreviewUrl ? `Inferred preview URL: ${previewUrl}` : null,
    previewPort ? `Preview port: ${previewPort}` : "Preview port: unknown",
    "",
    "Command:",
    "```",
    action.command.trim(),
    "```",
    "",
    "Use the real app tools for this run. First call terminal_list_sessions and terminal_dev_server_status with the working directory, command, and configured/inferred preview URL and port above. Reuse only an app-owned session or external localhost server that matches this exact target command/cwd/preview URL. Do not treat unrelated reachable common localhost ports as reusable, and do not open them in the browser. Be honest that external Windows Terminal or PowerShell scrollback cannot be read; if full logs are needed, offer to restart or run the command inside Gilbert's integrated terminal.",
    "",
    action.background
      ? `If no matching server is reusable, call terminal_run with background=true, backgroundWaitMs=15000, the command above, cwd/workingDirectory, shell when configured${previewUrl ? `, and previewUrl "${previewUrl}"` : ""}.`
      : "If no matching completed run is reusable, call terminal_run with background=false, the command above, cwd/workingDirectory, and shell when configured.",
    "",
    "Never call terminal_run more than once for this same command/cwd/preview target in one run. If startup output is quiet or incomplete, poll terminal_read_session on the existing session instead of starting another npm/dev-server process.",
    "",
    "After startup, call terminal_read_session for any app-owned session you started or reused. Open the browser preview at the configured/inferred target URL, or at a URL produced by the terminal_run output for this same command. Never open an unrelated localhost port from a broad diagnostic scan. Then call browser_console_read. Read terminal and browser diagnostics, fix important errors if this request requires code changes, and verify again after fixes.",
  ].filter((line): line is string => line !== null).join("\n");
}

function getPreviewUrlPort(previewUrl: string | undefined) {
  if (!previewUrl) {
    return undefined;
  }

  try {
    const url = new URL(previewUrl);
    return url.port || (url.protocol === "https:" ? "443" : "80");
  } catch {
    return undefined;
  }
}

function preloadRouteBundles(locationServicesEnabled: boolean) {
  const loaders = [
    loadAppsPage,
    loadTasksPage,
    ...(locationServicesEnabled ? [loadWeatherRadarPage] : []),
  ];
  let index = 0;

  const loadNext = () => {
    const loader = loaders[index];
    index += 1;

    if (!loader) {
      return;
    }

    void loader().finally(() => {
      if (index < loaders.length) {
        scheduleIdleTask(loadNext, 1_500);
      }
    });
  };

  loadNext();
}

function mergeHydratedChat(summaryChat: ChatSummary, loadedChat: ChatSummary): ChatSummary {
  return {
    ...loadedChat,
    archived: summaryChat.archived ?? loadedChat.archived,
    composerDraft: summaryChat.composerDraft ?? loadedChat.composerDraft,
    isDraft: loadedChat.messages.length === 0 ? summaryChat.isDraft ?? loadedChat.isDraft : undefined,
    messagesLoaded: true,
    pinned: summaryChat.pinned ?? loadedChat.pinned,
    project: summaryChat.project || loadedChat.project,
    title: summaryChat.title || loadedChat.title,
    updatedAt: summaryChat.updatedAt || loadedChat.updatedAt,
  };
}

function summarizeMobileBridgeRequests(requests: unknown[]) {
  const firstRequest = unwrapMobileBridgeRequest(requests[0]);
  const prompt = typeof firstRequest?.prompt === "string" ? firstRequest.prompt.trim().replace(/\s+/g, " ").slice(0, 220) : "";
  const project = typeof firstRequest?.projectName === "string" ? firstRequest.projectName.trim() : "";
  const permissionMode = typeof firstRequest?.permissionMode === "string" ? firstRequest.permissionMode : "";
  const suffix = requests.length > 1 ? ` ${requests.length - 1} more mobile request${requests.length === 2 ? "" : "s"} are queued.` : "";

  if (!prompt) {
    return `Gilbert Codex Mobile queued ${requests.length} desktop-only action request${requests.length === 1 ? "" : "s"}. Review workspace permissions before running anything.`;
  }

  return `Gilbert Codex Mobile requested desktop work${project ? ` for ${project}` : ""}: "${prompt}"${permissionMode ? ` Permission mode: ${permissionMode}.` : ""} Review workspace permissions before running anything.${suffix}`;
}

function unwrapMobileBridgeRequest(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const nested = record.request;
  if (nested && typeof nested === "object") {
    return nested as Record<string, unknown>;
  }
  return record;
}

function readMobileBridgePayload(value: unknown): Record<string, unknown> | null {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : null;
  const payload = record?.payload && typeof record.payload === "object" ? record.payload as Record<string, unknown> : record;
  const nestedPayload = payload?.payload && typeof payload.payload === "object" ? payload.payload as Record<string, unknown> : payload;
  return nestedPayload ?? null;
}

function readMobileBridgeSyncWorkspace(value: unknown): Record<string, unknown> | null {
  const nestedPayload = readMobileBridgePayload(value);
  return nestedPayload?.workspace && typeof nestedPayload.workspace === "object" ? nestedPayload.workspace as Record<string, unknown> : null;
}

function readMobileBridgeTombstones(value: unknown, key: "deletedChatIds" | "deletedProjectNames"): SyncTombstone[] {
  const workspace = readMobileBridgeSyncWorkspace(value);
  const rawItems = Array.isArray(workspace?.[key]) ? workspace[key] as unknown[] : [];

  return rawItems.flatMap((item) => {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : null;
    const id = typeof record?.id === "string" ? record.id.trim() : "";
    const deletedAtMillis = typeof record?.deletedAtMillis === "number" && Number.isFinite(record.deletedAtMillis)
      ? record.deletedAtMillis
      : Date.now();

    return id ? [{ deletedAtMillis, id }] : [];
  });
}

function readMobileAutomationTaskStatuses(value: unknown): Array<{ status: "enabled" | "paused"; taskId: string }> {
  const payload = readMobileBridgePayload(value);
  const extras = payload?.extras && typeof payload.extras === "object" ? payload.extras as Record<string, unknown> : null;
  const desktopExtras = extras?.desktop && typeof extras.desktop === "object" ? extras.desktop as Record<string, unknown> : null;
  const automationState = (desktopExtras?.automationState && typeof desktopExtras.automationState === "object"
    ? desktopExtras.automationState
    : extras?.automationState && typeof extras.automationState === "object"
      ? extras.automationState
      : null) as Record<string, unknown> | null;
  const tasks = Array.isArray(automationState?.tasks) ? automationState.tasks : [];

  return tasks.flatMap((task) => {
    const record = task && typeof task === "object" ? task as Record<string, unknown> : null;
    const taskId = typeof record?.id === "string" ? record.id.trim() : "";
    const status = record?.status === "enabled" ? "enabled" : record?.status === "paused" ? "paused" : null;
    return taskId && status ? [{ taskId, status }] : [];
  });
}

function mergeSyncTombstoneList(current: SyncTombstone[], incoming: SyncTombstone[]) {
  if (incoming.length === 0) {
    return { changed: false, value: current };
  }

  const byId = new Map(current.map((item) => [item.id, item]));
  let changed = false;
  for (const item of incoming) {
    const existing = byId.get(item.id);
    if (!existing || item.deletedAtMillis > existing.deletedAtMillis) {
      byId.set(item.id, item);
      changed = true;
    }
  }

  return { changed, value: changed ? [...byId.values()] : current };
}

interface WorkspaceAppProps {
  authSession: AuthSession;
  onLogout: () => void;
}

export function WorkspaceApp({ authSession, onLogout }: WorkspaceAppProps) {
  const initialChatStateRef = useRef<InitialChatState | null>(null);
  if (!initialChatStateRef.current) {
    initialChatStateRef.current = loadInitialChatState();
  }

  const [activeRoute, setActiveRoute] = useState<PrimaryRoute>("chat");
  const [chats, setChatsState] = useState<ChatSummary[]>(() => initialChatStateRef.current?.chats ?? [createEmptyChat(DEFAULT_PROJECT)]);
  const [projects, setProjects] = useState<ProjectSummary[]>(() => mergeProjectsWithChats(loadProjects(), initialChatStateRef.current?.chats ?? []));
  const [activeChatId, setActiveChatId] = useState(() => initialChatStateRef.current?.activeChatId ?? "");
  const [providerSettings, setProviderSettings] = useState<ProviderSettings>(() => loadProviderSettings());
  const [discordBridgeSettings, setDiscordBridgeSettings] = useState<DiscordBridgeSettings>(() => loadDiscordBridgeSettings());
  const [localWorkspace, setLocalWorkspace] = useState<LocalWorkspaceSettings>(() => loadLocalWorkspaceSettings());
  const [appearanceMode, setAppearanceMode] = useState<AppearanceMode>(() => loadAppearanceMode());
  const [appearanceSettings, setAppearanceSettings] = useState<AppAppearanceSettings>(() => loadAppAppearanceSettings());
  const [generalSettings, setGeneralSettings] = useState<AppGeneralSettings>(() => loadAppGeneralSettings());
  const [personalizationSettings, setPersonalizationSettings] = useState<AppPersonalizationSettings>(() => loadAppPersonalizationSettings());
  const [appInfo, setAppInfo] = useState<AppInfo>({
    name: "Gilbert Codex",
    phase: "Public alpha",
    runtime: isTauriDesktopRuntime() ? "Tauri desktop" : "Frontend preview",
    version: "0.5.5",
    platform: getHostPlatform(),
    arch: "browser",
  });
  const [appInfoResolved, setAppInfoResolved] = useState(false);
  const [sendingChatIds, setSendingChatIds] = useState<string[]>([]);
  const [loadingChatIds, setLoadingChatIds] = useState<string[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSectionId>("general");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalAttachedSession, setTerminalAttachedSession] = useState<TerminalAttachedSession | null>(null);
  const [browserPreviewTarget, setBrowserPreviewTarget] = useState<{ id: number; url: string } | null>(null);
  const [projectRunDialogOpen, setProjectRunDialogOpen] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(284);
  const [defaultTerminalWorkingDirectory, setDefaultTerminalWorkingDirectory] = useState("");
  const [aboutOpen, setAboutOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(() => loadPersistentString(ONBOARDING_NEVER_SHOW_KEY) !== "true");
  const [providerConnectionOpen, setProviderConnectionOpen] = useState(false);
  const [providerConnectionPromptEvaluated, setProviderConnectionPromptEvaluated] = useState(false);
  const [noticeDialog, setNoticeDialog] = useState<{ description?: string; title: string } | null>(null);
  const [renameChatId, setRenameChatId] = useState<string | null>(null);
  const [renameChatTitle, setRenameChatTitle] = useState("");
  const [renameChatError, setRenameChatError] = useState<string | null>(null);
  const [pendingClearChatId, setPendingClearChatId] = useState<string | null>(null);
  const [pendingDeleteChatId, setPendingDeleteChatId] = useState<string | null>(null);
  const [pendingDeleteProjectName, setPendingDeleteProjectName] = useState<string | null>(null);
  const [bulkDeleteChatsOpen, setBulkDeleteChatsOpen] = useState(false);
  const [bulkDeleteChatIds, setBulkDeleteChatIds] = useState<string[]>([]);
  const [composerDraftToRestore, setComposerDraftToRestore] = useState<ComposerDraftRestoreRequest | null>(null);
  const [contextWindow, setContextWindow] = useState<{ source: "estimate" | "openrouter" | "provider"; tokens: number }>(() => ({
    source: "estimate",
    tokens: getFallbackContextWindowTokens(providerSettings.model),
  }));
  const [modelContextWindows, setModelContextWindows] = useState<ModelContextWindowMap>(() =>
    getFallbackModelContextWindows([...PINNED_MODEL_IDS, providerSettings.model]),
  );
  const [lastProviderContextUsage, setLastProviderContextUsage] = useState<{ chatId: string; compactedMessageCount: number; usage: ContextWindowUsage } | null>(null);
  const [lastContextCompaction, setLastContextCompaction] = useState<ContextCompactionNotice | null>(null);
  // Mirrors of contextWindow / modelContextWindows so long-running async work
  // (tool-call loops, streaming responses, follow-up compactions) always
  // reads the latest resolved values instead of the snapshot captured when
  // the request was kicked off.
  const contextWindowRef = useRef(contextWindow);
  const lastProviderContextUsageRef = useRef(lastProviderContextUsage);
  const modelContextWindowsRef = useRef(modelContextWindows);
  useEffect(() => {
    contextWindowRef.current = contextWindow;
  }, [contextWindow]);
  useEffect(() => {
    lastProviderContextUsageRef.current = lastProviderContextUsage;
  }, [lastProviderContextUsage]);
  useEffect(() => {
    modelContextWindowsRef.current = modelContextWindows;
  }, [modelContextWindows]);
  const [queuedChatSends, setQueuedChatSends] = useState<QueuedChatSend[]>([]);
  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([]);
  const [automationState, setAutomationState] = useState<AutomationState>(() => loadAutomationState());
  const [automationDraft, setAutomationDraft] = useState<AutomationTaskDraft | null>(null);
  const [automationMcpServers, setAutomationMcpServers] = useState<McpServerState[]>([]);
  const [automationSkillRegistry, setAutomationSkillRegistry] = useState<SkillRegistryState>(() => loadSkillRegistry());
  const [mobileBridgeTombstoneVersion, setMobileBridgeTombstoneVersion] = useState(0);
  const isDesktopRuntime = isTauriDesktopRuntime() || appInfo.runtime.toLowerCase().includes("tauri");
  const locationServicesEnabled = personalizationSettings.locationServicesEnabled;
  const toolSettings = createLocationAwareToolSettings(providerSettings.tools, locationServicesEnabled);
  const activeSendRef = useRef(0);
  const activeGenerationsRef = useRef(new Map<string, ActiveGeneration>());
  const activeRequestChatIdsRef = useRef(new Map<number, string>());
  const hydratingChatIdsRef = useRef(new Set<string>());
  const hydratedChatCacheRef = useRef(new Map<string, ChatSummary>());
  const discordAutoStartKeyRef = useRef<string | null>(null);
  const discordBridgeSettingsRef = useRef(discordBridgeSettings);
  const providerSettingsRef = useRef(providerSettings);
  const titleGenerationRequestsRef = useRef(new Map<string, AbortController>());
  const activeChatIdRef = useRef(activeChatId);
  const localWorkspaceRef = useRef(localWorkspace);
  const projectsRef = useRef<ProjectSummary[]>(projects);
  const generalSettingsRef = useRef(generalSettings);
  const pendingChatsRef = useRef<ChatSummary[]>(chats);
  const mobileBridgeKnownChatIdsRef = useRef(new Set(chats.map((chat) => chat.id)));
  const mobileBridgeKnownProjectNamesRef = useRef(new Set(projects.map((project) => project.name.toLowerCase())));
  const mobileBridgeDeletedChatIdsRef = useRef<SyncTombstone[]>([]);
  const mobileBridgeDeletedProjectNamesRef = useRef<SyncTombstone[]>([]);
  const pendingLiveChatsCommitRef = useRef<ChatSummary[] | null>(null);
  const liveChatsCommitFrameRef = useRef<number | null>(null);
  const liveChatsCommitTimerRef = useRef<number | null>(null);
  const liveChatsLastCommitAtRef = useRef(0);
  const agentRunsRef = useRef<AgentRun[]>([]);
  const pendingAgentRunsCommitRef = useRef<AgentRun[] | null>(null);
  const agentRunsCommitFrameRef = useRef<number | null>(null);
  const agentRunsCommitTimerRef = useRef<number | null>(null);
  const agentRunsLastCommitAtRef = useRef(0);
  const pendingAgentRunSavesRef = useRef(new Map<string, AgentRun>());
  const automationStateRef = useRef(automationState);
  const runningAutomationTaskIdsRef = useRef(new Set<string>());
  const appStartAutomationTaskIdsRef = useRef(new Set<string>());
  const queuedChatSendsRef = useRef<QueuedChatSend[]>([]);
  const queuedStartersRef = useRef(new Set<string>());
  const sessionApprovalDecisionsRef = useRef<SessionApprovalDecisionsByWorkspace>({});
  const chatMemoryFingerprintsRef = useRef(new Map<string, string>());
  const runtimeRef = useRef<WorkspaceRuntimeDeps>({} as WorkspaceRuntimeDeps);
  const runtime = runtimeRef.current;
  const durableMemoryBackfillTimerRef = useRef<number | null>(null);
  const durableMemoryFlushTimerRef = useRef<number | null>(null);
  const pendingDurableMemoryChatIdsRef = useRef(new Set<string>());
  const priorityDurableMemoryChatIdsRef = useRef(new Set<string>());
  const pendingIdlePersistenceRef = useRef(new Map<string, { cancel: () => void; run: () => void }>());
  const activeToolAwareProviderSettingsRef = useRef<{
    chat: ChatSummary;
    contextWindow: typeof contextWindow;
    generalSettings: AppGeneralSettings;
    locationServicesEnabled: boolean;
    modelContextWindows: ModelContextWindowMap;
    providerSettings: ProviderSettings;
    value: ProviderSettings;
  } | null>(null);

  const flushIdlePersistence = useCallback((key?: string) => {
    const entries = key
      ? [...pendingIdlePersistenceRef.current.entries()].filter(([entryKey]) => entryKey === key)
      : [...pendingIdlePersistenceRef.current.entries()];

    for (const [entryKey, entry] of entries) {
      pendingIdlePersistenceRef.current.delete(entryKey);
      entry.cancel();
      entry.run();
    }
  }, []);

  const scheduleIdlePersistence = useCallback((key: string, run: () => void, timeoutMs = 500) => {
    pendingIdlePersistenceRef.current.get(key)?.cancel();
    const wrappedRun = () => {
      pendingIdlePersistenceRef.current.delete(key);
      run();
    };
    const cancel = scheduleIdleTask(wrappedRun, timeoutMs);
    pendingIdlePersistenceRef.current.set(key, { cancel, run: wrappedRun });
  }, []);

  const scheduleChatStatePersistence = useCallback((nextChats: ChatSummary[], timeoutMs = 250) => {
    scheduleIdlePersistence("chats", () => {
      saveChats(nextChats);
      syncPdfLibraryFromChats(nextChats);
    }, timeoutMs);
  }, [scheduleIdlePersistence]);

  useEffect(() => {
    return () => {
      cancelLiveChatsCommit();
      cancelLiveAgentRunsCommit();
      flushPendingAgentRunSaves();
    };
  }, []);

  useEffect(() => {
    automationStateRef.current = automationState;
    scheduleIdlePersistence("automation-state", () => saveAutomationState(automationState), 350);
  }, [automationState, scheduleIdlePersistence]);

  useEffect(() => {
    const previousChatIds = mobileBridgeKnownChatIdsRef.current;
    const nextChatIds = new Set(chats.map((chat) => chat.id));
    const deletedChatIds = [...previousChatIds].filter((chatId) => !nextChatIds.has(chatId));
    const previousProjectNames = mobileBridgeKnownProjectNamesRef.current;
    const nextProjectNames = new Set(projects.map((project) => project.name.toLowerCase()));
    const deletedProjectNames = [...previousProjectNames].filter((projectName) => !nextProjectNames.has(projectName));

    mobileBridgeKnownChatIdsRef.current = nextChatIds;
    mobileBridgeKnownProjectNamesRef.current = nextProjectNames;

    if (deletedChatIds.length === 0 && deletedProjectNames.length === 0) {
      return;
    }

    const deletedAtMillis = Date.now();
    const chatMerge = mergeSyncTombstoneList(
      mobileBridgeDeletedChatIdsRef.current,
      deletedChatIds.map((id) => ({ deletedAtMillis, id })),
    );
    const projectMerge = mergeSyncTombstoneList(
      mobileBridgeDeletedProjectNamesRef.current,
      deletedProjectNames.map((id) => ({ deletedAtMillis, id })),
    );
    mobileBridgeDeletedChatIdsRef.current = chatMerge.value;
    mobileBridgeDeletedProjectNamesRef.current = projectMerge.value;
    if (chatMerge.changed || projectMerge.changed) {
      setMobileBridgeTombstoneVersion((version) => version + 1);
    }
  }, [chats, projects]);

  useEffect(() => subscribeSkillRegistry(setAutomationSkillRegistry), []);

  useEffect(() => {
    if (activeRoute === "tasks") {
      setAutomationSkillRegistry(loadSkillRegistry());
    }
  }, [activeRoute]);

  useEffect(() => {
    if (activeRoute !== "tasks") {
      return;
    }

    if (!mcpDesktopAvailable()) {
      setAutomationMcpServers([]);
      return;
    }

    let cancelled = false;

    void getMcpState()
      .then((connection) => {
        if (!cancelled) {
          setAutomationMcpServers(connection.servers ?? []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAutomationMcpServers([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeRoute]);

  function persistChatState(nextChats: ChatSummary[], previousChats: ChatSummary[] = pendingChatsRef.current) {
    return (persistChatStateImpl as any)(runtime, nextChats, previousChats);
  }

  function setChats(update: SetStateAction<ChatSummary[]>) {
    cancelLiveChatsCommit();
    return (setChatsImpl as any)(runtime, update);
  }

  function cancelLiveChatsCommit() {
    if (liveChatsCommitFrameRef.current !== null) {
      window.cancelAnimationFrame(liveChatsCommitFrameRef.current);
      liveChatsCommitFrameRef.current = null;
    }

    if (liveChatsCommitTimerRef.current !== null) {
      window.clearTimeout(liveChatsCommitTimerRef.current);
      liveChatsCommitTimerRef.current = null;
    }

    pendingLiveChatsCommitRef.current = null;
  }

  function requestLiveChatsCommit() {
    const requestFrame = typeof window.requestAnimationFrame === "function"
      ? window.requestAnimationFrame.bind(window)
      : (callback: FrameRequestCallback) => window.setTimeout(() => callback(Date.now()), 16);
    liveChatsCommitFrameRef.current = requestFrame(() => {
      liveChatsCommitFrameRef.current = null;
      const nextChats = pendingLiveChatsCommitRef.current;
      pendingLiveChatsCommitRef.current = null;

      if (!nextChats) {
        return;
      }

      liveChatsLastCommitAtRef.current = Date.now();
      startTransition(() => {
        setChatsState(nextChats);
      });
    });
  }

  function scheduleLiveChatsCommit(nextChats: ChatSummary[]) {
    pendingLiveChatsCommitRef.current = nextChats;

    if (liveChatsCommitFrameRef.current !== null || liveChatsCommitTimerRef.current !== null) {
      return;
    }

    const elapsedMs = Date.now() - liveChatsLastCommitAtRef.current;
    const delayMs = Math.max(0, LIVE_CHAT_COMMIT_MIN_INTERVAL_MS - elapsedMs);

    if (delayMs > 0) {
      liveChatsCommitTimerRef.current = window.setTimeout(() => {
        liveChatsCommitTimerRef.current = null;
        requestLiveChatsCommit();
      }, delayMs);
      return;
    }

    requestLiveChatsCommit();
  }

  function setChatsLive(update: SetStateAction<ChatSummary[]>) {
    const currentChats = pendingChatsRef.current;
    const nextChats = typeof update === "function" ? (update as (currentChats: ChatSummary[]) => ChatSummary[])(currentChats) : update;

    if (nextChats === currentChats) {
      return;
    }

    pendingChatsRef.current = nextChats;
    scheduleChatStatePersistence(nextChats, LIVE_CHAT_PERSISTENCE_DELAY_MS);
    scheduleLiveChatsCommit(nextChats);
  }

  function flushPendingAgentRunSaves() {
    const pendingRuns = [...pendingAgentRunSavesRef.current.values()];
    pendingAgentRunSavesRef.current.clear();

    for (const run of pendingRuns) {
      void saveAgentRun(run).catch(() => undefined);
    }
  }

  function queueAgentRunSave(run: AgentRun, options: { immediate?: boolean } = {}) {
    pendingAgentRunSavesRef.current.set(run.id, run);

    if (options.immediate) {
      flushPendingAgentRunSaves();
      return;
    }

    scheduleIdlePersistence("agent-runs-save", flushPendingAgentRunSaves, AGENT_RUN_SAVE_DELAY_MS);
  }

  function cancelLiveAgentRunsCommit() {
    if (agentRunsCommitFrameRef.current !== null) {
      window.cancelAnimationFrame(agentRunsCommitFrameRef.current);
      agentRunsCommitFrameRef.current = null;
    }

    if (agentRunsCommitTimerRef.current !== null) {
      window.clearTimeout(agentRunsCommitTimerRef.current);
      agentRunsCommitTimerRef.current = null;
    }

    pendingAgentRunsCommitRef.current = null;
  }

  function requestLiveAgentRunsCommit() {
    const requestFrame = typeof window.requestAnimationFrame === "function"
      ? window.requestAnimationFrame.bind(window)
      : (callback: FrameRequestCallback) => window.setTimeout(() => callback(Date.now()), 16);
    agentRunsCommitFrameRef.current = requestFrame(() => {
      agentRunsCommitFrameRef.current = null;
      const nextRuns = pendingAgentRunsCommitRef.current;
      pendingAgentRunsCommitRef.current = null;

      if (!nextRuns) {
        return;
      }

      agentRunsLastCommitAtRef.current = Date.now();
      startTransition(() => {
        setAgentRuns(nextRuns);
      });
    });
  }

  function scheduleLiveAgentRunsCommit(nextRuns: AgentRun[]) {
    pendingAgentRunsCommitRef.current = nextRuns;

    if (agentRunsCommitFrameRef.current !== null || agentRunsCommitTimerRef.current !== null) {
      return;
    }

    const elapsedMs = Date.now() - agentRunsLastCommitAtRef.current;
    const delayMs = Math.max(0, LIVE_AGENT_RUN_COMMIT_MIN_INTERVAL_MS - elapsedMs);

    if (delayMs > 0) {
      agentRunsCommitTimerRef.current = window.setTimeout(() => {
        agentRunsCommitTimerRef.current = null;
        requestLiveAgentRunsCommit();
      }, delayMs);
      return;
    }

    requestLiveAgentRunsCommit();
  }

  function setAgentRunsLive(nextRuns: AgentRun[]) {
    agentRunsRef.current = nextRuns;
    scheduleLiveAgentRunsCommit(nextRuns);
  }

  function applyHydratedChatToView(chatId: string, loadedChat: ChatSummary) {
    let changed = false;
    const nextChats = pendingChatsRef.current.map((chat) => {
      if (chat.id !== chatId) {
        return chat;
      }

      if (chat.messagesLoaded !== false) {
        return chat;
      }

      changed = true;
      return mergeHydratedChat(chat, loadedChat);
    });

    if (!changed) {
      return;
    }

    pendingChatsRef.current = nextChats;
    setChatsState(nextChats);
  }

  function handleComposerDraftChange(chatId: string, draft: ChatComposerDraft | null) {
    return (handleComposerDraftChangeImpl as any)(runtime, chatId, draft);
  }

  function queueDurableMemoryForChangedChats(nextChats: ChatSummary[], previousChats: ChatSummary[]) {
    return (queueDurableMemoryForChangedChatsImpl as any)(runtime, nextChats, previousChats);
  }

  function queueDurableMemoryForChatIds(chatIds: string[], delayMs = DURABLE_MEMORY_PERSIST_DELAY_MS, priority = false) {
    return (queueDurableMemoryForChatIdsImpl as any)(runtime, chatIds, delayMs, priority);
  }

  function scheduleDurableMemoryFlush(delayMs: number) {
    return (scheduleDurableMemoryFlushImpl as any)(runtime, delayMs);
  }

  function flushDurableMemoryQueue() {
    return (flushDurableMemoryQueueImpl as any)(runtime);
  }

  function takeNextDurableMemoryChatId() {
    return (takeNextDurableMemoryChatIdImpl as any)(runtime);
  }

  function persistDurableMemoryForChatId(chatId: string) {
    return (persistDurableMemoryForChatIdImpl as any)(runtime, chatId);
  }


  useEffect(() => {
    return () => {
      flushIdlePersistence();

      if (durableMemoryBackfillTimerRef.current !== null) {
        window.clearTimeout(durableMemoryBackfillTimerRef.current);
      }
      if (durableMemoryFlushTimerRef.current !== null) {
        window.clearTimeout(durableMemoryFlushTimerRef.current);
      }

      for (const activeGeneration of activeGenerationsRef.current.values()) {
        activeGeneration.controller.abort();
      }
      activeGenerationsRef.current.clear();
      activeRequestChatIdsRef.current.clear();
      queuedChatSendsRef.current = [];
      queuedStartersRef.current.clear();

      for (const controller of titleGenerationRequestsRef.current.values()) {
        controller.abort();
      }

      titleGenerationRequestsRef.current.clear();
    };
  }, [flushIdlePersistence]);

  useEffect(() => {
    durableMemoryBackfillTimerRef.current = window.setTimeout(() => {
      queueDurableMemoryForChatIds(
        pendingChatsRef.current
          .filter((chat) => chat.messagesLoaded !== false && !isEmptyChat(chat))
          .map((chat) => chat.id),
        DURABLE_MEMORY_BATCH_DELAY_MS,
        false,
      );
    }, DURABLE_MEMORY_BACKFILL_DELAY_MS);

    return () => {
      if (durableMemoryBackfillTimerRef.current !== null) {
        window.clearTimeout(durableMemoryBackfillTimerRef.current);
        durableMemoryBackfillTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    return scheduleIdleTask(() => {
      void getAppInfo()
        .then(setAppInfo)
        .finally(() => setAppInfoResolved(true));
    }, 500);
  }, []);

  useEffect(() => {
    if (!appInfoResolved) {
      return;
    }

    const currentVersion = appInfo.version.trim() || "unknown";

    if (loadPersistentString(PROVIDER_CONNECTION_PROMPT_NEVER_SHOW_KEY) === "true") {
      setProviderConnectionPromptEvaluated(true);
      return;
    }

    if (loadPersistentString(PROVIDER_CONNECTION_PROMPT_LAST_SHOWN_VERSION_KEY) === currentVersion) {
      setProviderConnectionPromptEvaluated(true);
      return;
    }

    savePersistentString(PROVIDER_CONNECTION_PROMPT_LAST_SHOWN_VERSION_KEY, currentVersion);
    setProviderConnectionOpen(true);
    setProviderConnectionPromptEvaluated(true);
  }, [appInfo.version, appInfoResolved]);

  useEffect(() => {
    let mounted = true;
    const cancelIdleLoad = scheduleDelayedIdleTask(() => {
      void listAgentRuns().then(async (storedRuns) => {
        if (!mounted) {
          return;
        }

        const now = new Date().toISOString();
        const recoveredRuns = storedRuns.map((run) => recoverInterruptedAgentRun(run, now));
        agentRunsRef.current = recoveredRuns;
        setAgentRuns(recoveredRuns);

        await Promise.all(
          recoveredRuns
            .filter((run, index) => run !== storedRuns[index])
            .map((run) => saveAgentRun(run).catch(() => undefined)),
        );
      });
    }, AGENT_RUN_RECOVERY_DELAY_MS, 3_000);

    return () => {
      mounted = false;
      cancelIdleLoad();
    };
  }, []);

  useEffect(() => {
    agentRunsRef.current = agentRuns;
  }, [agentRuns]);

  useEffect(() => {
    configureDesktopNotifications(generalSettings.notifications);
  }, [generalSettings.notifications]);

  useEffect(() => {
    if (!isDesktopRuntime) {
      return configureDesktopNotificationActivation(null);
    }

    return configureDesktopNotificationActivation((activation) => {
      void bringCurrentWindowToForeground();

      const chatId = activation.chatId?.trim();
      if (!chatId) {
        setActiveRoute("chat");
        setSearchOpen(false);
        return;
      }

      const targetChat = pendingChatsRef.current.find((chat) => chat.id === chatId && !chat.archived);
      if (!targetChat) {
        setActiveRoute("chat");
        setSearchOpen(false);
        return;
      }

      const nextHash = `#chat=${encodeURIComponent(targetChat.id)}`;
      if (window.location.hash !== nextHash) {
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${nextHash}`);
      }

      const nextChats = pruneEmptyChats(pendingChatsRef.current, targetChat.id);
      if (nextChats.length !== pendingChatsRef.current.length) {
        pendingChatsRef.current = nextChats;
        setChats(nextChats);
      }
      restoreProjectLocalWorkspace(targetChat.project);
      activeChatIdRef.current = targetChat.id;
      setActiveChatId(targetChat.id);
      setActiveRoute("chat");
      setSearchOpen(false);
    });
  }, [isDesktopRuntime]);

  useEffect(() => {
    if (!generalSettings.popoutWindowHotkey || typeof window === "undefined") {
      return;
    }

    const handlePopoutHotkey = (event: KeyboardEvent) => {
      if (!matchesHotkey(event, generalSettings.popoutWindowHotkey)) {
        return;
      }

      event.preventDefault();
      void handleOpenActiveChatInNewWindow();
    };

    window.addEventListener("keydown", handlePopoutHotkey);
    return () => window.removeEventListener("keydown", handlePopoutHotkey);
  }, [activeChatId, generalSettings.popoutWindowHotkey]);

  useEffect(() => {
    if (!isDesktopRuntime) {
      return;
    }

    return scheduleDelayedIdleTask(() => {
      void prepareDesktopNotifications();
    }, DESKTOP_NOTIFICATION_PREPARE_DELAY_MS, 5_000);
  }, [generalSettings.notifications, isDesktopRuntime]);

  useEffect(() => {
    if (!isDesktopRuntime) {
      return;
    }

    let disposed = false;
    const cancelIdleLoad = scheduleDelayedIdleTask(() => {
      void getDefaultTerminalWorkingDirectory()
        .then((path) => {
          if (!disposed) {
            setDefaultTerminalWorkingDirectory(path);
          }
        })
        .catch(() => undefined);
    }, DEFAULT_TERMINAL_CWD_DELAY_MS, 2_000);

    return () => {
      disposed = true;
      cancelIdleLoad();
    };
  }, [isDesktopRuntime]);

  useEffect(() => {
    if (pendingChatsRef.current !== chats) {
      persistChatState(chats);
    }
  }, [chats]);

  useEffect(() => {
    queuedChatSendsRef.current = queuedChatSends;
  }, [queuedChatSends]);

  useEffect(() => {
    if (queuedChatSends.length === 0 || !toolSettings.provider) {
      return;
    }

    const startingChatIds = new Set<string>();
    const queuedSendsToStart: QueuedChatSend[] = [];

    for (const queuedSend of queuedChatSends) {
      if (queuedSend.held || activeGenerationsRef.current.has(queuedSend.chatId) || startingChatIds.has(queuedSend.chatId) || queuedStartersRef.current.has(queuedSend.id)) {
        continue;
      }

      startingChatIds.add(queuedSend.chatId);
      queuedSendsToStart.push(queuedSend);
    }

    if (queuedSendsToStart.length === 0) {
      return;
    }

    const startingIds = new Set(queuedSendsToStart.map((queuedSend) => queuedSend.id));

    for (const queuedSend of queuedSendsToStart) {
      queuedStartersRef.current.add(queuedSend.id);
    }

    setQueuedChatSends((currentQueue) => {
      const nextQueue = currentQueue.filter((queuedSend) => !startingIds.has(queuedSend.id));
      queuedChatSendsRef.current = nextQueue;
      return nextQueue;
    });

    for (const queuedSend of queuedSendsToStart) {
      void startSendMessage(queuedSend.input, {
        chatId: queuedSend.chatId,
        queuedMessageId: queuedSend.userMessageId,
      }).finally(() => {
        queuedStartersRef.current.delete(queuedSend.id);
      });
    }
  }, [queuedChatSends, sendingChatIds, toolSettings.provider]);

  useEffect(() => {
    function savePendingChats() {
      scheduleChatStatePersistence(pendingChatsRef.current);
      flushIdlePersistence();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        savePendingChats();
      }
    }

    window.addEventListener("pagehide", savePendingChats);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pagehide", savePendingChats);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [flushIdlePersistence, scheduleChatStatePersistence]);

  useEffect(() => {
    projectsRef.current = projects;
    scheduleIdlePersistence("projects", () => saveProjects(projects), 500);
  }, [projects, scheduleIdlePersistence]);

  useEffect(() => {
    providerSettingsRef.current = providerSettings;
    scheduleIdlePersistence("provider-settings", () => saveProviderSettings(providerSettings), 500);
  }, [providerSettings, scheduleIdlePersistence]);

  useEffect(() => {
    generalSettingsRef.current = generalSettings;
    scheduleIdlePersistence("general-settings", () => saveAppGeneralSettings(generalSettings), 500);
  }, [generalSettings, scheduleIdlePersistence]);

  useEffect(() => {
    scheduleIdlePersistence("personalization", () => saveAppPersonalizationSettings(personalizationSettings), 500);
  }, [personalizationSettings, scheduleIdlePersistence]);

  useEffect(() => {
    if (locationServicesEnabled) {
      return;
    }

    if (activeRoute === "radar") {
      setActiveRoute("chat");
      setNoticeDialog({
        description: "Weather, radar, Mapbox weather settings, and location-based refreshes stay hidden while location services are off. Turn them back on in Settings > Weather & Maps.",
        title: "Location services are off",
      });
    }

    if (activeSettingsSection === "mapbox") {
      setActiveSettingsSection("weatherSources");
    }
  }, [activeRoute, activeSettingsSection, locationServicesEnabled]);

  useEffect(() => {
    discordBridgeSettingsRef.current = discordBridgeSettings;
    scheduleIdlePersistence("discord-bridge", () => saveDiscordBridgeSettings(discordBridgeSettings), 500);
  }, [discordBridgeSettings, scheduleIdlePersistence]);

  useEffect(() => {
    if (!isDesktopRuntime) {
      return;
    }

    let disposed = false;
    let unlisten: (() => void) | undefined;

    void listenForDiscordInteractions((interaction) => {
      if (!disposed) {
        void handleDiscordInteraction(interaction);
      }
    }).then((nextUnlisten) => {
      if (disposed) {
        nextUnlisten();
        return;
      }

      unlisten = nextUnlisten;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [discordBridgeSettings.enabled, discordBridgeSettings.mode, isDesktopRuntime, localWorkspace, providerSettings, toolSettings.provider, toolSettings.webSearch]);

  useEffect(() => {
    if (!isDesktopRuntime) {
      return;
    }

    const autoStartKey = createDiscordBridgeAutoStartKey(discordBridgeSettings);

    if (!autoStartKey) {
      return;
    }

    if (discordAutoStartKeyRef.current === autoStartKey) {
      return;
    }

    discordAutoStartKeyRef.current = autoStartKey;

    return scheduleDelayedIdleTask(() => {
      void ensureDiscordBridgeAutoStarted(discordBridgeSettings)
        .then((result) => {
          if (!result.status?.publicUrl) {
            return;
          }

          setDiscordBridgeSettings((currentSettings) => ({
            ...currentSettings,
            interactionsEndpointUrl: result.status?.publicUrl ?? currentSettings.interactionsEndpointUrl,
            publicInteractionsUrl: result.status?.publicUrl ?? currentSettings.publicInteractionsUrl,
          }));
        })
        .catch(() => {
          discordAutoStartKeyRef.current = null;
        });
    }, DISCORD_BRIDGE_AUTOSTART_DELAY_MS, 5_000);
  }, [discordBridgeSettings, isDesktopRuntime]);

  useEffect(() => {
    localWorkspaceRef.current = localWorkspace;
    scheduleIdlePersistence("local-workspace", () => saveLocalWorkspaceSettings(localWorkspace), 500);
    return scheduleDelayedIdleTask(() => {
      void refreshWorkspaceContext(localWorkspace);
    }, WORKSPACE_CONTEXT_REFRESH_DELAY_MS, 3_000);
  }, [localWorkspace, scheduleIdlePersistence]);

  useEffect(() => {
    if (!isDesktopRuntime) {
      return;
    }

    void startMobileBridge().catch(() => undefined);
  }, [isDesktopRuntime]);

  useEffect(() => {
    if (!isDesktopRuntime) {
      return;
    }

    const handle = window.setTimeout(() => {
      const payload = createDesktopMobileSyncPayload({
        activeChatId,
        appearanceMode,
        appearanceSettings,
        automationSkillRegistry,
        automationState,
        chats,
        deletedChatIds: mobileBridgeDeletedChatIdsRef.current,
        deletedProjectNames: mobileBridgeDeletedProjectNamesRef.current,
        discordBridgeSettings,
        generalSettings,
        localWorkspace,
        personalizationSettings,
        projects,
        providerSettings,
        session: authSession,
      });

      void updateMobileBridgeDesktopPayload(payload).catch(() => undefined);
    }, MOBILE_BRIDGE_SYNC_DELAY_MS);

    return () => window.clearTimeout(handle);
  }, [
    activeChatId,
    appearanceMode,
    appearanceSettings,
    authSession,
    automationSkillRegistry,
    automationState,
    chats,
    discordBridgeSettings,
    generalSettings,
    isDesktopRuntime,
    localWorkspace,
    mobileBridgeTombstoneVersion,
    personalizationSettings,
    projects,
    providerSettings,
  ]);

  useEffect(() => {
    if (!isDesktopRuntime) {
      return;
    }

    let disposed = false;
    let drainQueued = false;
    async function pollMobileBridge() {
      drainQueued = false;
      try {
        const payloads = await takeMobileBridgePayloads();
        if (disposed) {
          return;
        }

        let changedDesktopState = false;
        let appliedTaskSyncUpdates = 0;
        for (const payload of payloads) {
          const chatTombstones = mergeSyncTombstoneList(mobileBridgeDeletedChatIdsRef.current, readMobileBridgeTombstones(payload, "deletedChatIds"));
          const projectTombstones = mergeSyncTombstoneList(mobileBridgeDeletedProjectNamesRef.current, readMobileBridgeTombstones(payload, "deletedProjectNames"));
          mobileBridgeDeletedChatIdsRef.current = chatTombstones.value;
          mobileBridgeDeletedProjectNamesRef.current = projectTombstones.value;
          if (chatTombstones.changed || projectTombstones.changed) {
            setMobileBridgeTombstoneVersion((version) => version + 1);
          }

          const merge = mergeMobilePayloadIntoDesktopState(
            {
              activeChatId: activeChatIdRef.current,
              chats: pendingChatsRef.current,
              generalSettings: generalSettingsRef.current,
              localWorkspace: localWorkspaceRef.current,
              projects: projectsRef.current,
              providerSettings: providerSettingsRef.current,
            },
            payload,
          );
          appliedTaskSyncUpdates += applyMobileAutomationTaskStatusUpdates(readMobileAutomationTaskStatuses(payload));

          if (!merge.changed) {
            continue;
          }

          changedDesktopState = true;
          if (merge.chats !== pendingChatsRef.current) {
            pendingChatsRef.current = merge.chats;
            setChats(merge.chats);
          }
          if (merge.projects !== projectsRef.current) {
            projectsRef.current = merge.projects;
            setProjects(merge.projects);
          }
          if (merge.providerSettings !== providerSettingsRef.current) {
            providerSettingsRef.current = merge.providerSettings;
            setProviderSettings(merge.providerSettings);
          }
          if (merge.localWorkspace !== localWorkspaceRef.current) {
            localWorkspaceRef.current = merge.localWorkspace;
            setLocalWorkspace(merge.localWorkspace);
          }
          if (merge.generalSettings !== generalSettingsRef.current) {
            generalSettingsRef.current = merge.generalSettings;
            setGeneralSettings(merge.generalSettings);
          }
          if (merge.activeChatId !== activeChatIdRef.current) {
            activeChatIdRef.current = merge.activeChatId;
            setActiveChatId(merge.activeChatId);
          }
        }

        if (changedDesktopState) {
          flushIdlePersistence();
        }
        if (appliedTaskSyncUpdates > 0) {
          flushIdlePersistence("automation-state");
        }

        const requests = await takeMobileBridgeRequests();
        if (!disposed && requests.length > 0) {
          const appliedTaskRequests = applyMobileAutomationTaskRequests(requests);
          const remainingRequests = requests.filter((request) => unwrapMobileBridgeRequest(request)?.type !== "automation_task_status");
          if (remainingRequests.length > 0) {
            const summary = summarizeMobileBridgeRequests(remainingRequests);
            setNoticeDialog({
              title: "Mobile action requested",
              description: summary || "Gilbert Codex Mobile queued a desktop-only action. Review workspace permissions before running the requested action on desktop.",
            });
          } else if (appliedTaskRequests > 0) {
            flushIdlePersistence("automation-state");
            setNoticeDialog({
              title: "Mobile task updated",
              description: `${appliedTaskRequests} task ${appliedTaskRequests === 1 ? "was" : "were"} updated from mobile.`,
            });
          }
        }
      } catch {
        // The bridge is best-effort; pairing settings shows detailed status.
      }
    }

    function drainMobileBridgeSoon() {
      if (disposed || drainQueued) {
        return;
      }

      drainQueued = true;
      window.setTimeout(() => {
        if (!disposed) {
          void pollMobileBridge();
        }
      }, 0);
    }

    let unlistenUpdates: (() => void) | undefined;
    void listenForMobileBridgeUpdates(() => {
      drainMobileBridgeSoon();
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      unlistenUpdates = unlisten;
    });

    void pollMobileBridge();
    const interval = window.setInterval(() => {
      void pollMobileBridge();
    }, MOBILE_BRIDGE_MOBILE_DRAIN_INTERVAL_MS);

    return () => {
      disposed = true;
      unlistenUpdates?.();
      window.clearInterval(interval);
    };
  }, [flushIdlePersistence, isDesktopRuntime]);

  useEffect(() => {
    if (!toolSettings.terminal && terminalOpen) {
      setTerminalOpen(false);
    }
  }, [terminalOpen, toolSettings.terminal]);

  useEffect(() => {
    if (!toolSettings.browserPreview) {
      setBrowserPreviewTarget(null);
    }
  }, [toolSettings.browserPreview]);

  const activeChat =
    chats.find((chat) => chat.id === activeChatId && !chat.archived) ??
    chats.find((chat) => !chat.archived) ??
    createEmptyChat(DEFAULT_PROJECT);
  const activeChatProviderSettings = createChatProviderSettings(activeChat);

  useEffect(() => {
    if (activeChat.messagesLoaded !== false) {
      return;
    }

    const chatId = activeChat.id;
    const cachedChat = hydratedChatCacheRef.current.get(chatId);
    if (cachedChat) {
      applyHydratedChatToView(chatId, cachedChat);
      setLoadingChatIds((currentIds) => currentIds.filter((id) => id !== chatId));
      return;
    }

    setLoadingChatIds((currentIds) => currentIds.includes(chatId) ? currentIds : [...currentIds, chatId]);

    if (hydratingChatIdsRef.current.has(chatId)) {
      return;
    }

    const hydrateActiveChat = () => {
      if (activeChatIdRef.current !== chatId || hydratingChatIdsRef.current.has(chatId)) {
        return;
      }

      hydratingChatIdsRef.current.add(chatId);

      void loadChatById(chatId)
        .then((loadedChat) => {
          if (!loadedChat) {
            return;
          }

          hydratedChatCacheRef.current.set(chatId, loadedChat);

          if (activeChatIdRef.current === chatId) {
            applyHydratedChatToView(chatId, loadedChat);
          }
        })
        .finally(() => {
          hydratingChatIdsRef.current.delete(chatId);
          setLoadingChatIds((currentIds) => currentIds.filter((id) => id !== chatId));
        });
    };

    if (typeof window === "undefined") {
      hydrateActiveChat();
      return;
    }

    const hydrationTimer = window.setTimeout(hydrateActiveChat, CHAT_HYDRATION_SWITCH_SETTLE_DELAY_MS);

    return () => {
      window.clearTimeout(hydrationTimer);
      setLoadingChatIds((currentIds) => currentIds.includes(chatId) ? currentIds.filter((id) => id !== chatId) : currentIds);
    };
  }, [activeChat.id, activeChat.messagesLoaded]);

  useEffect(() => {
    const selectedSettings = activeChatProviderSettings;
    const selectedModel = selectedSettings.model.trim();
    const modelIds = Array.from(new Set([...PINNED_MODEL_IDS, selectedModel].filter(Boolean)));
    const applyCodexContextWindowSetting = (modelId: string, window: ModelContextWindow): ModelContextWindow => {
      if (selectedSettings.provider === "9router" && isNineRouterCodexModelId(modelId)) {
        return {
          ...window,
          source: "provider",
          tokens: getNineRouterCodexContextWindowTokens(selectedSettings.subscriptionOptimization?.codexContextWindow),
        };
      }

      return window;
    };
    const fallbackWindows = Object.entries(getFallbackModelContextWindows(modelIds)).reduce<ModelContextWindowMap>((windows, [modelId, window]) => {
      windows[modelId] = applyCodexContextWindowSetting(modelId, window);
      return windows;
    }, {});
    const manualSelectedOverride = selectedModel ? getManualModelBudgetOverride(selectedSettings, selectedModel) : null;
    const configuredSelectedWindow = selectedModel && selectedSettings.provider === "9router" && isNineRouterCodexModelId(selectedModel)
      ? { maxOutputTokens: manualSelectedOverride?.maxOutputTokens, source: "provider" as const, tokens: getNineRouterCodexContextWindowTokens(selectedSettings.subscriptionOptimization?.codexContextWindow) }
      : selectedModel && manualSelectedOverride?.contextWindowTokens
      ? { maxOutputTokens: manualSelectedOverride.maxOutputTokens, source: "provider" as const, tokens: manualSelectedOverride.contextWindowTokens }
      : selectedModel ? getConfiguredContextWindow(selectedSettings) : null;
    if (selectedModel && configuredSelectedWindow) {
      fallbackWindows[selectedModel] = configuredSelectedWindow;
    }
    const controller = new AbortController();
    const fallbackCandidate = selectedModel
      ? fallbackWindows[selectedModel] ?? getFallbackModelContextWindow(selectedModel)
      : getFallbackModelContextWindow("");

    // Merge with previously-resolved values. A transient settings change
    // (api key edit, baseUrl tweak, sibling provider apiKey added) re-runs
    // this effect; previously we would synchronously overwrite a known-good
    // provider/openrouter value with the static fallback and only restore
    // the real value once the /models round-trip completed. While the fetch
    // was in flight, compaction would evaluate the 80% threshold against
    // the downgraded window, firing far too aggressively. We now preserve
    // any value sourced from the provider until something better is known.
    setModelContextWindows((previousWindows) => {
      const merged: ModelContextWindowMap = { ...fallbackWindows };
      for (const [modelId, existingWindow] of Object.entries(previousWindows)) {
        const fallback = merged[modelId];
        const effectiveExistingWindow = applyCodexContextWindowSetting(modelId, existingWindow);
        const previousIsBetter =
          effectiveExistingWindow.source !== "estimate" ||
          (fallback ? effectiveExistingWindow.tokens > fallback.tokens : true);
        if (previousIsBetter) {
          merged[modelId] = effectiveExistingWindow;
        } else if (!fallback) {
          merged[modelId] = effectiveExistingWindow;
        }
      }
      return merged;
    });

    // Same idea for the singular active contextWindow. If we already have
    // a resolved (provider/openrouter) value for the selected model, keep
    // it. If we only have an older estimate but it's larger than the new
    // fallback, keep it (covers releases where the registry hasn't been
    // updated yet). Otherwise show the new fallback.
    const previousWindowForModel = selectedModel && modelContextWindowsRef.current[selectedModel]
      ? applyCodexContextWindowSetting(selectedModel, modelContextWindowsRef.current[selectedModel])
      : null;
    const initialSelectedWindow =
      previousWindowForModel &&
      (previousWindowForModel.source !== "estimate" || previousWindowForModel.tokens >= fallbackCandidate.tokens)
        ? previousWindowForModel
        : fallbackCandidate;
    setContextWindow(initialSelectedWindow);

    const cancelContextLengthFetch = scheduleDelayedIdleTask(() => {
      void fetchProviderModelContextLengths(selectedSettings, modelIds, {
        signal: controller.signal,
      })
        .then((contextLengths) => {
          if (controller.signal.aborted) {
            return;
          }

          setModelContextWindows((previousWindows) => {
            const merged: ModelContextWindowMap = { ...previousWindows };
            for (const [model, tokens] of Object.entries(contextLengths)) {
              if (configuredSelectedWindow && model === selectedModel) {
                merged[model] = configuredSelectedWindow;
                continue;
              }
              const fallbackTokens = fallbackWindows[model]?.tokens ?? 0;
              const providerTokens = applyCodexContextWindowSetting(model, {
                source: "provider",
                tokens: Math.max(tokens, fallbackTokens),
              }).tokens;
              const existing = merged[model];
              if (!existing || providerTokens >= existing.tokens || existing.source === "estimate") {
                merged[model] = { source: "provider", tokens: providerTokens };
              }
            }
            return merged;
          });

          const providerTokensForSelected = contextLengths[selectedModel];
          if (selectedModel && configuredSelectedWindow) {
            setContextWindow(configuredSelectedWindow);
          } else if (selectedModel && typeof providerTokensForSelected === "number" && providerTokensForSelected > 0) {
            const candidateTokens = Math.max(providerTokensForSelected, fallbackCandidate.tokens);
            setContextWindow((current) =>
              candidateTokens >= current.tokens || current.source === "estimate"
                ? { source: "provider", tokens: candidateTokens }
                : current,
            );
          }
        })
        .catch(() => {
          return;
        });
    }, MODEL_CONTEXT_REFRESH_DELAY_MS, 3_000);

    return () => {
      cancelContextLengthFetch();
      controller.abort();
    };
  }, [
    activeChatProviderSettings.model,
    activeChatProviderSettings.provider,
    activeChatProviderSettings.apiKeys,
    activeChatProviderSettings.baseUrls,
    activeChatProviderSettings.contextWindowTokens,
    activeChatProviderSettings.modelBudgetOverrides,
    activeChatProviderSettings.subscriptionOptimization,
  ]);

  useEffect(() => {
    scheduleIdlePersistence("appearance", () => {
      saveAppearanceMode(appearanceMode);
      saveAppAppearanceSettings(appearanceSettings);
    }, 500);

    const mediaQuery = window.matchMedia("(prefers-color-scheme: light)");

    function applyAppearance() {
      applyAppAppearanceToDocument(appearanceMode, appearanceSettings);
    }

    applyAppearance();
    mediaQuery.addEventListener("change", applyAppearance);

    return () => mediaQuery.removeEventListener("change", applyAppearance);
  }, [appearanceMode, appearanceSettings, scheduleIdlePersistence]);

  useEffect(() => {
    activeChatIdRef.current = activeChatId;

    if (activeChatId) {
      scheduleIdlePersistence("active-chat", () => saveActiveChatId(activeChatId), 300);
    }
  }, [activeChatId, scheduleIdlePersistence]);

  useEffect(() => {
    if (chats.some((chat) => chat.id === activeChatId && !chat.archived)) {
      return;
    }

    const lastProjectName = normalizeProjectName(loadPersistentString(LAST_ACTIVE_PROJECT_KEY) || chats.find((chat) => !chat.archived)?.project || DEFAULT_PROJECT);
    const nextChat = createEmptyChat(lastProjectName);
    const nextChats = sortChatsByUpdatedAt([nextChat, ...pruneEmptyChats(chats)]);

    pendingChatsRef.current = nextChats;
    setChats(nextChats);
    setActiveChatId(nextChat.id);
  }, [activeChatId, chats]);

  useEffect(() => {
    const projectName = normalizeProjectName(activeChat.project);
    scheduleIdlePersistence("last-active-project", () => savePersistentString(LAST_ACTIVE_PROJECT_KEY, projectName), 300);
  }, [activeChat.project, scheduleIdlePersistence]);

  useEffect(() => {
    function selectChatFromHash() {
      const chatId = getChatIdFromLocationHash();

      if (!chatId) {
        return;
      }

      const targetChat = pendingChatsRef.current.find((chat) => chat.id === chatId && !chat.archived);

      if (!targetChat) {
        return;
      }

      const nextChats = pruneEmptyChats(pendingChatsRef.current, targetChat.id);
      if (nextChats.length !== pendingChatsRef.current.length) {
        pendingChatsRef.current = nextChats;
        setChats(nextChats);
      }
      restoreProjectLocalWorkspace(targetChat.project);
      activeChatIdRef.current = targetChat.id;
      setActiveChatId(targetChat.id);
      setActiveRoute("chat");
    }

    selectChatFromHash();
    window.addEventListener("hashchange", selectChatFromHash);

    return () => window.removeEventListener("hashchange", selectChatFromHash);
  }, []);

  useEffect(() => {
    const activeProjectName = normalizeProjectName(activeChat.project);
    const currentWorkspace = localWorkspaceRef.current;

    if (isNoProjectName(activeProjectName)) {
      const noProjectWorkspace = createNoProjectWorkspace(currentWorkspace);

      if (!sameLocalWorkspaceSettings(noProjectWorkspace, currentWorkspace)) {
        localWorkspaceRef.current = noProjectWorkspace;
        setLocalWorkspace(noProjectWorkspace);
      }

      return;
    }

    const projectWorkspace = projects.find((project) => project.name.toLowerCase() === activeProjectName.toLowerCase())?.localWorkspace;

    if (projectWorkspace && !sameLocalWorkspaceSettings(projectWorkspace, currentWorkspace)) {
      localWorkspaceRef.current = projectWorkspace;
      setLocalWorkspace(projectWorkspace);
      return;
    }

    if (!projectWorkspace && currentWorkspace.enabled) {
      const noProjectWorkspace = createNoProjectWorkspace(currentWorkspace);
      localWorkspaceRef.current = noProjectWorkspace;
      setLocalWorkspace(noProjectWorkspace);
    }
  }, [activeChat.project, projects]);
  function resolveWorkspaceForChatProject(projectName: string, fallback: LocalWorkspaceSettings = localWorkspaceRef.current) {
    return (resolveWorkspaceForChatProjectImpl as any)(runtime, projectName, fallback);
  }

  function isActiveChatProject(projectName: string) {
    return (isActiveChatProjectImpl as any)(runtime, projectName);
  }

  function persistAgentRun(nextRun: AgentRun) {
    return (persistAgentRunImpl as any)(runtime, nextRun);
  }

  function createAgentRunForMessage(params: {
    chatId: string;
    localWorkspace?: LocalWorkspaceSettings;
    messageId: string;
    mode: "chat" | "plan";
    prompt: string;
    title?: string;
  }) {
    return (createAgentRunForMessageImpl as any)(runtime, params);
  }

  function updateAgentRun(runId: string | undefined, updater: (run: AgentRun, now: string) => AgentRun) {
    return (updateAgentRunImpl as any)(runtime, runId, updater);
  }

  function setAgentRunWaiting(runId: string | undefined, label: string, detail?: string, approvals: AgentApproval[] = [], pendingToolCallContent?: string) {
    return (setAgentRunWaitingImpl as any)(runtime, runId, label, detail, approvals, pendingToolCallContent);
  }

  function setAgentRunCompleted(runId: string | undefined, message: ChatMessage) {
    return (setAgentRunCompletedImpl as any)(runtime, runId, message);
  }

  function setAgentRunFailed(runId: string | undefined, errorMessage: string) {
    return (setAgentRunFailedImpl as any)(runtime, runId, errorMessage);
  }

  function setAgentRunCancelled(runId: string | undefined, detail?: string) {
    return (setAgentRunCancelledImpl as any)(runtime, runId, detail);
  }

  function setAgentRunContinuing(runId: string | undefined, label: string, detail?: string) {
    return (setAgentRunContinuingImpl as any)(runtime, runId, label, detail);
  }

  function createPlanningExecutionApproval(runId: string, messageId: string, planContent: string, prompt: string): AgentApproval {
    return (createPlanningExecutionApprovalImpl as any)(runtime, runId, messageId, planContent, prompt);
  }

  function handleNewChat(project?: string) {
    return (handleNewChatImpl as any)(runtime, project);
  }

  function handleSelectChat(chatId: string) {
    return (handleSelectChatImpl as any)(runtime, chatId);
  }

  function handleActiveChatModelChange(nextModel: string, nextProvider: ProviderSettings["provider"]) {
    return (handleActiveChatModelChangeImpl as any)(runtime, nextModel, nextProvider);
  }

  function handleProviderConnectionChoice(nextProvider: ProviderSettings["provider"], nextModel: string) {
    return (handleProviderConnectionChoiceImpl as any)(runtime, nextProvider, nextModel);
  }

  function handleCloseProviderConnectionDialog() {
    setProviderConnectionOpen(false);
  }

  function handleNeverShowProviderConnectionDialog() {
    savePersistentString(PROVIDER_CONNECTION_PROMPT_NEVER_SHOW_KEY, "true");
    setProviderConnectionOpen(false);
  }

  function handleSubscriptionSandboxUninstalled(nextSettings: ProviderSettings) {
    const openRouterModel = nextSettings.providerModels.openrouter?.trim() || nextSettings.model.trim() || getDefaultModelForProvider("openrouter");
    const fallbackSettings: ProviderSettings = {
      ...nextSettings,
      model: openRouterModel,
      provider: "openrouter",
      providerModels: {
        ...nextSettings.providerModels,
        [NINE_ROUTER_PROVIDER_ID]: "",
        openrouter: openRouterModel,
      },
    };

    setProviderSettings(fallbackSettings);
    setChats((currentChats) => {
      let changed = false;
      const nextChats = currentChats.map((chat) => {
        if (chat.provider !== NINE_ROUTER_PROVIDER_ID && !isSubscriptionRouteModel(chat.model)) {
          return chat;
        }

        changed = true;
        return {
          ...chat,
          model: openRouterModel,
          provider: "openrouter" as const,
        };
      });

      return changed ? nextChats : currentChats;
    });
  }

  function handleSelectProject(project: string) {
    return (handleSelectProjectImpl as any)(runtime, project);
  }

  async function openCreateProjectDialog(options: CreateProjectOptions = {}): Promise<string | null> {
    return (openCreateProjectDialogImpl as any)(runtime, options);
  }

  function createProjectFromFolder(folderPath: string, options: { bindToActiveChat?: boolean; projectNameHint?: string } = {}): string | null {
    return (createProjectFromFolderImpl as any)(runtime, folderPath, options);
  }

  function handleLocalWorkspaceChange(nextWorkspace: LocalWorkspaceSettings) {
    return (handleLocalWorkspaceChangeImpl as any)(runtime, nextWorkspace);
  }

  function bindActiveChatToProject(project: string, workspaceOverride?: LocalWorkspaceSettings) {
    return (bindActiveChatToProjectImpl as any)(runtime, project, workspaceOverride);
  }

  function handleToggleTerminal() {
    return (handleToggleTerminalImpl as any)(runtime);
  }

  function attachLiveTerminalSession(toolCalls?: ChatToolCall[]) {
    return (attachLiveTerminalSessionImpl as any)(runtime, toolCalls);
  }

  function handleTogglePin(chatId: string) {
    return (handleTogglePinImpl as any)(runtime, chatId);
  }

  function handleOpenRenameChat(chat: ChatSummary) {
    return (handleOpenRenameChatImpl as any)(runtime, chat);
  }

  function confirmRenameChat() {
    return (confirmRenameChatImpl as any)(runtime);
  }

  function handleArchiveActiveChat() {
    return (handleArchiveActiveChatImpl as any)(runtime);
  }

  async function handleCopyWorkingDirectory() {
    return (handleCopyWorkingDirectoryImpl as any)(runtime);
  }

  async function handleCopySessionId() {
    return (handleCopySessionIdImpl as any)(runtime);
  }

  async function handleCopyChatDeeplink() {
    return (handleCopyChatDeeplinkImpl as any)(runtime);
  }

  async function handleCopyChatMarkdown() {
    return (handleCopyChatMarkdownImpl as any)(runtime);
  }

  function handleForkActiveChatLocal() {
    return (handleForkActiveChatLocalImpl as any)(runtime);
  }

  function handleForkChatFromMessage(messageId: string) {
    return (handleForkChatFromMessageImpl as any)(runtime, messageId);
  }

  function handleMessageFeedback(messageId: string, feedback: ChatMessage["feedback"]) {
    return (handleMessageFeedbackImpl as any)(runtime, messageId, feedback);
  }

  async function handleForkActiveChatWorktree() {
    return (handleForkActiveChatWorktreeImpl as any)(runtime);
  }

  function handleAddAutomation() {
    const latestUserMessage = [...activeChat.messages].reverse().find((message) => message.role === "user");
    const sourcePrompt = latestUserMessage?.content.trim() || `Use the context from "${activeChat.title}" and run the recurring task I define.`;
    const chatProviderSettings = createChatProviderSettings(activeChat);

    setSearchOpen(false);
    setAutomationDraft({
      capabilityScope: {
        autonomyLevel: "review",
        capabilities: [],
      },
      notificationPolicy: {
        desktop: true,
        discord: false,
        privacy: "summary",
      },
      model: chatProviderSettings.model,
      prompt: sourcePrompt,
      projectName: activeChat.project,
      provider: chatProviderSettings.provider,
      sourceChatId: activeChat.id,
      status: "paused",
      title: `Task: ${activeChat.title}`,
      trigger: { kind: "manual" },
    });
    setActiveRoute("tasks");
  }

  async function handleOpenActiveChatInNewWindow() {
    return (handleOpenActiveChatInNewWindowImpl as any)(runtime);
  }

  function getActiveWorkingDirectory() {
    return (getActiveWorkingDirectoryImpl as any)(runtime);
  }

  async function copyLabeledTextToClipboard(label: string, text: string) {
    return (copyLabeledTextToClipboardImpl as any)(runtime, label, text);
  }

  function activateForkedChat(forkedChat: ChatSummary, workspace: LocalWorkspaceSettings) {
    return (activateForkedChatImpl as any)(runtime, forkedChat, workspace);
  }

  function notifyPlanningInputNeeded(inputRequest: ChatPlanningInputRequest, chatId?: string) {
    return (notifyPlanningInputNeededImpl as any)(runtime, inputRequest, chatId);
  }

  function notifyRunNeedsAttention(detail?: string, chatId?: string) {
    return (notifyRunNeedsAttentionImpl as any)(runtime, detail, chatId);
  }

  function notifyRunComplete(message: ChatMessage, chatId?: string) {
    return (notifyRunCompleteImpl as any)(runtime, message, chatId);
  }

  function touchProject(projectName: string) {
    return (touchProjectImpl as any)(runtime, projectName);
  }

  function restoreProjectLocalWorkspace(projectName: string, workspaceOverride?: LocalWorkspaceSettings) {
    return (restoreProjectLocalWorkspaceImpl as any)(runtime, projectName, workspaceOverride);
  }

  function saveWorkspaceForProject(projectName: string, nextWorkspace: LocalWorkspaceSettings) {
    return (saveWorkspaceForProjectImpl as any)(runtime, projectName, nextWorkspace);
  }

  function handleClearChatMessages(chatId: string) {
    return (handleClearChatMessagesImpl as any)(runtime, chatId);
  }

  function handleDeleteChat(chatId: string) {
    return (handleDeleteChatImpl as any)(runtime, chatId);
  }

  function handleDeleteProject(projectName: string) {
    return (handleDeleteProjectImpl as any)(runtime, projectName);
  }

  function handleOpenBulkDeleteChats() {
    return (handleOpenBulkDeleteChatsImpl as any)(runtime);
  }

  function handleToggleBulkDeleteChat(chatId: string) {
    return (handleToggleBulkDeleteChatImpl as any)(runtime, chatId);
  }

  function handleSelectAllBulkDeleteChats() {
    return (handleSelectAllBulkDeleteChatsImpl as any)(runtime);
  }

  function handleClearBulkDeleteChats() {
    return (handleClearBulkDeleteChatsImpl as any)(runtime);
  }

  function confirmDeleteChat() {
    return (confirmDeleteChatImpl as any)(runtime);
  }

  function confirmClearChatMessages() {
    return (confirmClearChatMessagesImpl as any)(runtime);
  }

  function confirmDeleteProject() {
    return (confirmDeleteProjectImpl as any)(runtime);
  }

  function confirmBulkDeleteChats() {
    return (confirmBulkDeleteChatsImpl as any)(runtime);
  }

  function isChatSending(chatId: string | undefined) {
    return (isChatSendingImpl as any)(runtime, chatId);
  }

  function isAnyChatSending(chatIds: Iterable<string>) {
    return (isAnyChatSendingImpl as any)(runtime, chatIds);
  }

  function getSendingChatIds(chatIds: Iterable<string>) {
    return (getSendingChatIdsImpl as any)(runtime, chatIds);
  }

  function setChatSending(chatId: string, sending: boolean) {
    return (setChatSendingImpl as any)(runtime, chatId, sending);
  }

  function getActiveGenerationByRequest(requestId: number) {
    return (getActiveGenerationByRequestImpl as any)(runtime, requestId);
  }

  function getActiveGenerationByMessage(messageId: string | undefined) {
    return (getActiveGenerationByMessageImpl as any)(runtime, messageId);
  }

  function createActiveGeneration(chatId: string, previousChat: ChatSummary, previousChatExisted: boolean, restoreDraft?: ChatComposerDraft, target?: { messageId: string }) {
    return (createActiveGenerationImpl as any)(runtime, chatId, previousChat, previousChatExisted, restoreDraft, target);
  }

  function setActiveGenerationTarget(requestId: number, chatId: string, messageId: string) {
    return (setActiveGenerationTargetImpl as any)(runtime, requestId, chatId, messageId);
  }

  function isRequestInactive(requestId: number, controller: AbortController) {
    return (isRequestInactiveImpl as any)(runtime, requestId, controller);
  }

  function finishActiveGeneration(requestId: number) {
    return (finishActiveGenerationImpl as any)(runtime, requestId);
  }

  function handleStopGeneration(messageId?: unknown) {
    return (handleStopGenerationImpl as any)(runtime, messageId);
  }

  function stopActiveGeneration(arg0: { activeGeneration?: ActiveGeneration; messageId?: string; restoreDraft: boolean }) {
    return (stopActiveGenerationImpl as any)(runtime, arg0);
  }

  function stopStreamingMessage(messageId: string) {
    return (stopStreamingMessageImpl as any)(runtime, messageId);
  }

  function stopStaleStreamingMessages(chatId: string, exceptMessageId?: string) {
    return (stopStaleStreamingMessagesImpl as any)(runtime, chatId, exceptMessageId);
  }

  function stopStreamingAssistantMessage(message: ChatMessage, stoppedAt: string): ChatMessage {
    return (stopStreamingAssistantMessageImpl as any)(runtime, message, stoppedAt);
  }

  function completeActiveProgress(progress: ChatProgressItem[] | undefined) {
    return (completeActiveProgressImpl as any)(runtime, progress);
  }

  function preserveQueuedMessagesForSnapshot(chatSnapshot: ChatSummary) {
    return (preserveQueuedMessagesForSnapshotImpl as any)(runtime, chatSnapshot);
  }

  function restoreChatSnapshot(chatSnapshot: ChatSummary, existed: boolean) {
    return (restoreChatSnapshotImpl as any)(runtime, chatSnapshot, existed);
  }

  function updateQueuedChatSends(updater: (currentQueue: QueuedChatSend[]) => QueuedChatSend[]) {
    return (updateQueuedChatSendsImpl as any)(runtime, updater);
  }

  function scheduleGeneratedChatTitle(arg0: {
    attachments: ChatAttachment[];
    chatId: string;
    content: string;
    fallbackTitle: string;
    settings: ProviderSettings;
    userMessageId: string;
  }) {
    return (scheduleGeneratedChatTitleImpl as any)(runtime, arg0);
  }

  function applyGeneratedChatTitle(arg0: {
    chatId: string;
    fallbackTitle: string;
    title: string;
    userMessageId: string;
  }) {
    return (applyGeneratedChatTitleImpl as any)(runtime, arg0);
  }

  function shouldPreserveExistingTitleAfterUserEdit(chat: ChatSummary, userMessage: ChatMessage) {
    return (shouldPreserveExistingTitleAfterUserEditImpl as any)(runtime, chat, userMessage);
  }

  function enqueueChatSend(input: ChatSendInput) {
    return (enqueueChatSendImpl as any)(runtime, input);
  }

  function handleDeleteQueuedMessage(messageId: string) {
    return (handleDeleteQueuedMessageImpl as any)(runtime, messageId);
  }

  function handleHoldQueuedMessage(messageId: string, held: boolean) {
    return (handleHoldQueuedMessageImpl as any)(runtime, messageId, held);
  }

  function handleUpdateQueuedMessage(messageId: string, content: string) {
    return (handleUpdateQueuedMessageImpl as any)(runtime, messageId, content);
  }

  async function handleEditUserMessageAndRegenerate(messageId: string, content: string) {
    return (handleEditUserMessageAndRegenerateImpl as any)(runtime, messageId, content);
  }

  function handleSteerQueuedMessage(messageId: string, contentOverride?: string) {
    return (handleSteerQueuedMessageImpl as any)(runtime, messageId, contentOverride);
  }

  async function steerActiveResponse(arg0: {
    activeGeneration: ActiveGeneration;
    assistantMessageIndex: number;
    contentOverride?: string;
    currentChat: ChatSummary;
    queuedSend: QueuedChatSend;
  }) {
    return (steerActiveResponseImpl as any)(runtime, arg0);
  }

  async function createMessagesForProvider(existingMessages: ChatMessage[], userMessage: ChatMessage, projectName: string, workspaceSettings: LocalWorkspaceSettings, prompt: string, webContextMessages: ChatMessage[] = [], settings: ProviderSettings = createToolAwareProviderSettings(), onCompaction?: (notice: ContextCompactionNotice) => void) {
    return (createMessagesForProviderImpl as any)(runtime, existingMessages, userMessage, projectName, workspaceSettings, prompt, webContextMessages, settings, onCompaction);
  }

  function createChatToolSelectionPrompt(prompt: string, existingMessages: ChatMessage[], workspaceSettings: LocalWorkspaceSettings) {
    return (createChatToolSelectionPromptImpl as any)(runtime, prompt, existingMessages, workspaceSettings);
  }

  function referencesSelectedWorkspaceForToolSelection(prompt: string) {
    return (referencesSelectedWorkspaceForToolSelectionImpl as any)(runtime, prompt);
  }

  function resolveChatResearchReferences(input: ChatSendInput, currentChatId: string): ChatResearchReference[] {
    return (resolveChatResearchReferencesImpl as any)(runtime, input, currentChatId);
  }

  function getChatResearchCandidates(currentChatId: string) {
    return (getChatResearchCandidatesImpl as any)(runtime, currentChatId);
  }

  function createChatResearchContextMessages(references?: ChatResearchReference[]) {
    return (createChatResearchContextMessagesImpl as any)(runtime, references);
  }

  function createActiveProjectBoundaryMessage(projectName: string, workspaceSettings: LocalWorkspaceSettings) {
    return (createActiveProjectBoundaryMessageImpl as any)(runtime, projectName, workspaceSettings);
  }

  function createMemorySearchForRequest(chatId: string, projectName: string, workspaceSettings: LocalWorkspaceSettings) {
    return (createMemorySearchForRequestImpl as any)(runtime, chatId, projectName, workspaceSettings);
  }

  function clampMemoryToolInteger(value: number | undefined, fallback: number, min: number, max: number) {
    return (clampMemoryToolIntegerImpl as any)(runtime, value, fallback, min, max);
  }

  function limitMemoryToolContent(content: string, maxChars: number) {
    return (limitMemoryToolContentImpl as any)(runtime, content, maxChars);
  }

  function rememberProjectMapSnapshot(projectName: string, workspaceSettings: LocalWorkspaceSettings) {
    return (rememberProjectMapSnapshotImpl as any)(runtime, projectName, workspaceSettings);
  }

  function loadToolMemoryForProject(projectName: string, workspaceSettings: LocalWorkspaceSettings) {
    return (loadToolMemoryForProjectImpl as any)(runtime, projectName, workspaceSettings);
  }

  function saveToolMemoryForProject(state: ReturnType<typeof loadProjectToolMemoryState>) {
    return (saveToolMemoryForProjectImpl as any)(runtime, state);
  }

  function createToolMemoryScope(projectName: string, workspaceSettings: LocalWorkspaceSettings) {
    return (createToolMemoryScopeImpl as any)(runtime, projectName, workspaceSettings);
  }

  function getEnabledWorkspaceRoots(workspaceSettings: LocalWorkspaceSettings) {
    return (getEnabledWorkspaceRootsImpl as any)(runtime, workspaceSettings);
  }

  function resolveEnabledWorkspaceRoots(workspaceSettings: LocalWorkspaceSettings) {
    return (resolveEnabledWorkspaceRootsImpl as any)(runtime, workspaceSettings);
  }

  function rememberProjectToolMemoryFromBridgeRun(chatId: string, workspaceSettings: LocalWorkspaceSettings, prompt: string, run: ToolBridgeExecutionBatch) {
    return (rememberProjectToolMemoryFromBridgeRunImpl as any)(runtime, chatId, workspaceSettings, prompt, run);
  }

  function rememberProjectToolMemoryFromChatToolCalls(chatId: string, workspaceSettings: LocalWorkspaceSettings, prompt: string, toolCalls: ChatToolCall[]) {
    return (rememberProjectToolMemoryFromChatToolCallsImpl as any)(runtime, chatId, workspaceSettings, prompt, toolCalls);
  }

  function getToolMemoryProjectName(chatId: string) {
    return (getToolMemoryProjectNameImpl as any)(runtime, chatId);
  }

  async function createSourceControlContextMessages(_prompt: string) {
    return (createSourceControlContextMessagesImpl as any)(runtime, _prompt);
  }

  function shouldSkipLocalContextForGithub(_prompt: string) {
    return (shouldSkipLocalContextForGithubImpl as any)(runtime, _prompt);
  }

  async function createLocalWorkspaceContextMessages(workspaceSettings: LocalWorkspaceSettings, prompt: string, projectName: string) {
    return (createLocalWorkspaceContextMessagesImpl as any)(runtime, workspaceSettings, prompt, projectName);
  }

  function hasAnyLocalWorkspaceToolEnabled() {
    return (hasAnyLocalWorkspaceToolEnabledImpl as any)(runtime);
  }

  function getAutomaticWorkspaceContextCharBudget(contextWindowTokens: number) {
    return (getAutomaticWorkspaceContextCharBudgetImpl as any)(runtime, contextWindowTokens);
  }

  async function syncLocalWorkspaceIndexSummary(projectName: string, workspaceSettings: LocalWorkspaceSettings) {
    return (syncLocalWorkspaceIndexSummaryImpl as any)(runtime, projectName, workspaceSettings);
  }

  function compactProviderMessages(messages: ChatMessage[], settingsOverride?: ProviderSettings, options: { target?: number; threshold?: number; toolBridge?: ProviderToolBridgeOptions } = {}) {
    return (compactProviderMessagesImpl as any)(runtime, messages, settingsOverride, options);
  }

  function resolveContextWindowForModel(model: string, settings: ProviderSettings = providerSettings): { maxOutputTokens?: number; source: "estimate" | "openrouter" | "provider"; tokens: number } {
    return (resolveContextWindowForModelImpl as any)(runtime, model, settings);
  }

  function getManualModelBudgetOverride(settings: ProviderSettings, model: string) {
    return (getManualModelBudgetOverrideImpl as any)(runtime, settings, model);
  }

  function getConfiguredContextWindow(settings: ProviderSettings): { source: "provider"; tokens: number } | null {
    return (getConfiguredContextWindowImpl as any)(runtime, settings);
  }

  function createContextBoundLocalToolExecutionPolicy(basePolicy: LocalComputerToolExecutionPolicy): LocalComputerToolExecutionPolicy {
    return (createContextBoundLocalToolExecutionPolicyImpl as any)(runtime, basePolicy);
  }

  function getModelVisibleToolResultCharBudget(contextWindowTokens: number, settingsOverride?: ProviderSettings) {
    return (getModelVisibleToolResultCharBudgetImpl as any)(runtime, contextWindowTokens, settingsOverride);
  }

  function minNullableCharCap(cap: number | null, budget: number) {
    return (minNullableCharCapImpl as any)(runtime, cap, budget);
  }

  function getProviderCompactionBaseline(threshold: number) {
    return (getProviderCompactionBaselineImpl as any)(runtime, threshold);
  }

  function recordContextCompaction(compaction: ReturnType<typeof compactMessagesForContext>, providerBaseline: ContextWindowUsage | null): ContextCompactionNotice {
    return (recordContextCompactionImpl as any)(runtime, compaction, providerBaseline);
  }

  function createContextCompactionProgress(compaction: ReturnType<typeof compactMessagesForContext> & { contextCompaction?: ContextCompactionNotice }): ChatProgressItem {
    return (createContextCompactionProgressImpl as any)(runtime, compaction);
  }

  function withContextCompactionProgress(compactionProgress: ChatProgressItem, progress: ChatProgressItem[] | undefined) {
    return (withContextCompactionProgressImpl as any)(runtime, compactionProgress, progress);
  }

  function withContextCompactionMarker(message: ChatMessage, notice: ContextCompactionNotice | undefined): ChatMessage {
    return (withContextCompactionMarkerImpl as any)(runtime, message, notice);
  }

  function createChatContextCompaction(notice: ContextCompactionNotice): ChatContextCompaction {
    return (createChatContextCompactionImpl as any)(runtime, notice);
  }

  function getContextCompactionMarkerKey(compaction: ChatContextCompaction) {
    return (getContextCompactionMarkerKeyImpl as any)(runtime, compaction);
  }

  function recordProviderContextUsage(chatId: string, messages: ChatMessage[], settings: ProviderSettings, options: { allowDecrease?: boolean; stream?: boolean; toolBridge?: ProviderToolBridgeOptions } = {}) {
    return (recordProviderContextUsageImpl as any)(runtime, chatId, messages, settings, options);
  }

  function recordProviderActualUsage(chatId: string, messages: ChatMessage[], settings: ProviderSettings, usage: Awaited<ReturnType<typeof streamProviderMessage>>["usage"], options: { allowDecrease?: boolean; stream?: boolean; toolBridge?: ProviderToolBridgeOptions } = {}) {
    return (recordProviderActualUsageImpl as any)(runtime, chatId, messages, settings, usage, options);
  }

  function estimateProviderContextUsageForDisplay(messages: ChatMessage[], settings: ProviderSettings, options: { stream?: boolean; toolBridge?: ProviderToolBridgeOptions } = {}) {
    return (estimateProviderContextUsageForDisplayImpl as any)(runtime, messages, settings, options);
  }

  function createProviderPayloadGuardrailProgress(usage: ContextWindowUsage): ChatProgressItem | null {
    return (createProviderPayloadGuardrailProgressImpl as any)(runtime, usage);
  }

  function withProviderPayloadGuardrailProgress(guardrailProgress: ChatProgressItem | null, progress: ChatProgressItem[] | undefined) {
    return (withProviderPayloadGuardrailProgressImpl as any)(runtime, guardrailProgress, progress);
  }

  function recordPlanningProviderRequest(chatId: string, request: PlanningProviderRequest) {
    return (recordPlanningProviderRequestImpl as any)(runtime, chatId, request);
  }

  function recordPlanningProviderUsage(chatId: string, request: PlanningProviderRequest, usage: Awaited<ReturnType<typeof streamProviderMessage>>["usage"]) {
    return (recordPlanningProviderUsageImpl as any)(runtime, chatId, request, usage);
  }

  function createChatProviderSettings(chat: ChatSummary | null | undefined, overrides: Partial<ProviderSettings> = {}): ProviderSettings {
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

  function createToolAwareProviderSettings(overrides: Partial<ProviderSettings> = {}, chat: ChatSummary | null | undefined = activeChat): ProviderSettings {
    return (createToolAwareProviderSettingsImpl as any)(runtime, overrides, chat);
  }

  function createPromptAwareProviderSettings(prompt: string, overrides: Partial<ProviderSettings> = {}, chat: ChatSummary | null | undefined = activeChat): ProviderSettings {
    return (createPromptAwareProviderSettingsImpl as any)(runtime, prompt, overrides, chat);
  }

  function hasRequestScopedWorkspaceToolsEnabled(settings: ProviderSettings) {
    return (hasRequestScopedWorkspaceToolsEnabledImpl as any)(runtime, settings);
  }

  function createPromptAwareThinkingSettings(thinking: ProviderSettings["thinking"], prompt: string): ProviderSettings["thinking"] {
    return (createPromptAwareThinkingSettingsImpl as any)(runtime, thinking, prompt);
  }

  function createFinalOnlyProviderSettings(prompt?: string, chat: ChatSummary | null | undefined = activeChat, overrides: Partial<ProviderSettings> = {}): ProviderSettings {
    return (createFinalOnlyProviderSettingsImpl as any)(runtime, prompt, chat, overrides);
  }

  function rememberSessionApprovalDecision(approval: AgentApproval, decision: AgentApprovalDecision, workspaceSettings: LocalWorkspaceSettings, chatId?: string) {
    return (rememberSessionApprovalDecisionImpl as any)(runtime, approval, decision, workspaceSettings, chatId);
  }

  function createRuntimeApprovalDecisions(workspaceSettings: LocalWorkspaceSettings, approvalDecisions?: Record<string, AgentApprovalDecision>, chatId?: string) {
    return (createRuntimeApprovalDecisionsImpl as any)(runtime, workspaceSettings, approvalDecisions, chatId);
  }

  function getRuntimeWebSearchMaxResults(settings: ProviderSettings, requestedMaxResults?: number) {
    return (getRuntimeWebSearchMaxResultsImpl as any)(runtime, settings, requestedMaxResults);
  }

  function getRuntimeWebSearchSettings(settings: ProviderSettings, requestedWebSearch?: ChatSendInput["webSearch"] | ChatWebSearch): WebSearchSettings {
    return (getRuntimeWebSearchSettingsImpl as any)(runtime, settings, requestedWebSearch);
  }

  function supportsProviderParallelToolCalls(provider: ProviderSettings["provider"]) {
    return (supportsProviderParallelToolCallsImpl as any)(runtime, provider);
  }

  function createLocationAwareWebSearchSettings(settings: WebSearchSettings, locationServicesEnabled: boolean): WebSearchSettings {
    return (createLocationAwareWebSearchSettingsImpl as any)(runtime, settings, locationServicesEnabled);
  }

  function createAppAgentToolCall(messageId: string, status: ChatToolCall["status"], detail: string, output?: string, fileChanges?: ChatToolCall["fileChanges"]): ChatToolCall {
    return (createAppAgentToolCallImpl as any)(runtime, messageId, status, detail, output, fileChanges);
  }

  function appendAgentRuntimeStep(runId: string | undefined, type: AgentRun["steps"][number]["type"], label: string, detail?: string) {
    return (appendAgentRuntimeStepImpl as any)(runtime, runId, type, label, detail);
  }

  function completeLatestAgentRuntimeStep(runId: string | undefined, status: AgentRun["steps"][number]["status"], detail?: string) {
    return (completeLatestAgentRuntimeStepImpl as any)(runtime, runId, status, detail);
  }

  function mapAgentDecisionToStepType(decision: AgentRuntimeDecision): AgentRun["steps"][number]["type"] {
    return (mapAgentDecisionToStepTypeImpl as any)(runtime, decision);
  }

  async function runAppOwnedCodingAgent(arg0: {
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
  }): Promise<AssistantToolResponse> {
    return (runAppOwnedCodingAgentImpl as any)(runtime, arg0);
  }

  async function streamAssistantWithLocalTools(arg0: {
    approvalDecisions?: Record<string, AgentApprovalDecision>;
    approvedPlanExecution?: ApprovedPlanExecutionContext;
    automationScope?: ToolAutomationScope;
    chatId: string;
    controller: AbortController;
    messageId: string;
    memoryToolsEnabled?: boolean;
    messagesForProvider: ChatMessage[];
    onExternalUpdate?: (update: DiscordStreamUpdate) => void;
    previousToolCalls?: ChatToolCall[];
    prompt: string;
    requestId: number;
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
    return (streamAssistantWithLocalToolsImpl as any)(runtime, arg0);
  }

  function createToolFinalAnswerUnavailableMessage(toolCalls: ChatToolCall[] = [], originalPrompt = "") {
    return (createToolFinalAnswerUnavailableMessageImpl as any)(runtime, toolCalls, originalPrompt);
  }

  function createSynthesisRecoveryFallback(toolCall: ChatToolCall, fallbackOutput: string) {
    return (createSynthesisRecoveryFallbackImpl as any)(runtime, toolCall, fallbackOutput);
  }

  function summarizeUserFacingFailure(output: string) {
    return (summarizeUserFacingFailureImpl as any)(runtime, output);
  }

  function createRecoverableBridgeToolRetryInstruction(toolCalls: ChatToolCall[], originalPrompt: string) {
    return (createRecoverableBridgeToolRetryInstructionImpl as any)(runtime, toolCalls, originalPrompt);
  }

  function getToolCallRawOutput(toolCall: ChatToolCall) {
    return (getToolCallRawOutputImpl as any)(runtime, toolCall);
  }

  function extractSuggestedFileReadCandidates(output: string) {
    return (extractSuggestedFileReadCandidatesImpl as any)(runtime, output);
  }

  function extractNearbyPathCandidates(output: string) {
    return (extractNearbyPathCandidatesImpl as any)(runtime, output);
  }

  function extractSuggestedFileSearchQuery(output: string) {
    return (extractSuggestedFileSearchQueryImpl as any)(runtime, output);
  }

  function isMissingFileReadToolCall(toolCall: ChatToolCall, output: string) {
    return (isMissingFileReadToolCallImpl as any)(runtime, toolCall, output);
  }

  function isMissingFileReadError(output: string) {
    return (isMissingFileReadErrorImpl as any)(runtime, output);
  }

  function extractMissingReadPath(output: string) {
    return (extractMissingReadPathImpl as any)(runtime, output);
  }

  function extractToolInputPath(input: string | undefined) {
    return (extractToolInputPathImpl as any)(runtime, input);
  }

  function createMissingReadSearchQuery(path: string) {
    return (createMissingReadSearchQueryImpl as any)(runtime, path);
  }

  function getLastPathSegment(path: string) {
    return (getLastPathSegmentImpl as any)(runtime, path);
  }

  function isRecoverableBridgeArgumentError(output: string) {
    return (isRecoverableBridgeArgumentErrorImpl as any)(runtime, output);
  }

  function summarizeCompletedToolFallback(toolCall: ChatToolCall, output: string) {
    return (summarizeCompletedToolFallbackImpl as any)(runtime, toolCall, output);
  }

  function shouldKeepToolOutputOutOfChat(toolCall: ChatToolCall, output: string) {
    return (shouldKeepToolOutputOutOfChatImpl as any)(runtime, toolCall, output);
  }

  function countTextLines(value: string) {
    return (countTextLinesImpl as any)(runtime, value);
  }

  function limitFallbackToolOutput(output: string) {
    return (limitFallbackToolOutputImpl as any)(runtime, output);
  }

  function createGitToolFallbackAnswer(toolCalls: ChatToolCall[], originalPrompt: string) {
    return (createGitToolFallbackAnswerImpl as any)(runtime, toolCalls, originalPrompt);
  }

  function parseGitStatusFallbackFiles(output: string) {
    return (parseGitStatusFallbackFilesImpl as any)(runtime, output);
  }

  function parseGitDiffStatFallbackFiles(output: string) {
    return (parseGitDiffStatFallbackFilesImpl as any)(runtime, output);
  }

  function extractToolStdout(output: string) {
    return (extractToolStdoutImpl as any)(runtime, output);
  }

  function cleanGitFallbackPath(value: string) {
    return (cleanGitFallbackPathImpl as any)(runtime, value);
  }

  function dedupeGitFallbackFiles(files: Array<{ path: string; status: string }>) {
    return (dedupeGitFallbackFilesImpl as any)(runtime, files);
  }

  function groupGitStatusFallbackFiles(files: Array<{ path: string; status: string }>) {
    return (groupGitStatusFallbackFilesImpl as any)(runtime, files);
  }

  function formatGitStatusFallbackGroup(label: string, files: Array<{ path: string; status: string }>) {
    return (formatGitStatusFallbackGroupImpl as any)(runtime, label, files);
  }

  function formatGitStatSuffix(file: { additions: number; deletions: number }) {
    return (formatGitStatSuffixImpl as any)(runtime, file);
  }

  function createNoExecutedToolFinalInstruction(contextMessage: string, retryBudgetExhausted = false) {
    return (createNoExecutedToolFinalInstructionImpl as any)(runtime, contextMessage, retryBudgetExhausted);
  }

  function createNoExecutedToolFinalAnswer(contextMessage: string) {
    return (createNoExecutedToolFinalAnswerImpl as any)(runtime, contextMessage);
  }

  function extractFirstUnsuccessfulToolSection(contextMessage: string) {
    return (extractFirstUnsuccessfulToolSectionImpl as any)(runtime, contextMessage);
  }

  function summarizeUnsuccessfulToolSection(section: string) {
    return (summarizeUnsuccessfulToolSectionImpl as any)(runtime, section);
  }

  function stripToolSectionHeader(section: string) {
    return (stripToolSectionHeaderImpl as any)(runtime, section);
  }

  function stripToolAdaptationRecommendation(value: string) {
    return (stripToolAdaptationRecommendationImpl as any)(runtime, value);
  }

  function appendAutoCompactionContinuation(messages: ChatMessage[], prompt: string, executedToolCalls: number) {
    return (appendAutoCompactionContinuationImpl as any)(runtime, messages, prompt, executedToolCalls);
  }

  function isAutoCompactionContinuationMessage(message: ChatMessage) {
    return (isAutoCompactionContinuationMessageImpl as any)(runtime, message);
  }

  function providerStreamingDeps(): ProviderStreamingDeps {
    return runtime as unknown as ProviderStreamingDeps;
  }

  function sendActionsDeps(): SendActionsDeps {
    return runtime as unknown as SendActionsDeps;
  }

  async function runParallelSubagents(tasks: LocalSubagentTask[], baseMessages: ChatMessage[], prompt: string, signal: AbortSignal, chat: ChatSummary | null | undefined = activeChat): Promise<LocalSubagentResult[]> {
    return runParallelSubagentsImpl(providerStreamingDeps(), tasks, baseMessages, prompt, signal, chat);
  }

  async function streamProviderMessageWithRetry(chatId: string, settings: ProviderSettings, messages: ChatMessage[], onUpdate: Parameters<typeof streamProviderMessage>[2], options: Parameters<typeof streamProviderMessage>[3] = {}, messageId?: string) {
    return streamProviderMessageWithRetryImpl(providerStreamingDeps(), chatId, settings, messages, onUpdate, options, messageId);
  }

  async function runProviderRetryWithTimeout<T>(parentSignal: AbortSignal | undefined, run: (signal: AbortSignal) => Promise<T>) {
    return runProviderRetryWithTimeoutImpl(providerStreamingDeps(), parentSignal, run);
  }

  function createProviderRetryInstruction(messages: ChatMessage[], emptyResponse: boolean) {
    return createProviderRetryInstructionImpl(providerStreamingDeps(), messages, emptyResponse);
  }

  function isRetryableProviderMessageError(error: unknown) {
    return isRetryableProviderMessageErrorImpl(providerStreamingDeps(), error);
  }

  function hasLocalToolEvidence(messages: ChatMessage[]) {
    return hasLocalToolEvidenceImpl(providerStreamingDeps(), messages);
  }

  function createEmptyResponseRetrySettings(settings: ProviderSettings): ProviderSettings {
    return createEmptyResponseRetrySettingsImpl(providerStreamingDeps(), settings);
  }

  function updateGeneratedMessage(chatId: string, messageId: string, updateMessage: (message: ChatMessage) => ChatMessage, sortByUpdatedAt = false) {
    return updateGeneratedMessageImpl(providerStreamingDeps(), chatId, messageId, updateMessage, sortByUpdatedAt);
  }

  function preserveVisibleResponseThinking(previousMessage: ChatMessage, nextMessage: ChatMessage): ChatMessage {
    return preserveVisibleResponseThinkingImpl(providerStreamingDeps(), previousMessage, nextMessage);
  }

  function createInterruptedResponseContextMessages(message: ChatMessage, prompt: string) {
    return createInterruptedResponseContextMessagesImpl(providerStreamingDeps(), message, prompt);
  }

  function createSteeringInstruction(steerContent: string, originalPrompt: string) {
    return createSteeringInstructionImpl(providerStreamingDeps(), steerContent, originalPrompt);
  }

  function withSteeringProgress(progress: ChatProgressItem[] | undefined) {
    return withSteeringProgressImpl(providerStreamingDeps(), progress);
  }

  function removeSteeringProgress(progress: ChatProgressItem[] | undefined) {
    return removeSteeringProgressImpl(providerStreamingDeps(), progress);
  }


  function findActiveAssistantMessageIndex(messages: ChatMessage[]) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];

      if (message?.role === "assistant" && message.isStreaming) {
        return index;
      }
    }

    return -1;
  }
  async function handleDiscordInteraction(interaction: DiscordInteractionEvent) {
    return (handleDiscordInteractionImpl as any)(runtime, interaction);
  }

  function resolveDiscordSourceChat(interaction: DiscordInteractionEvent) {
    return (resolveDiscordSourceChatImpl as any)(runtime, interaction);
  }

  function findLatestDiscordConversationChat(interaction: DiscordInteractionEvent) {
    return (findLatestDiscordConversationChatImpl as any)(runtime, interaction);
  }

  function discordSourceMatchesInteraction(source: NonNullable<ChatMessage["source"]>, interaction: DiscordInteractionEvent) {
    return (discordSourceMatchesInteractionImpl as any)(runtime, source, interaction);
  }

  function createDiscordMessageSource(interaction: DiscordInteractionEvent): NonNullable<ChatMessage["source"]> {
    return (createDiscordMessageSourceImpl as any)(runtime, interaction);
  }

  function isDiscordNewChatCommand(interaction: DiscordInteractionEvent) {
    return (isDiscordNewChatCommandImpl as any)(runtime, interaction);
  }

  function normalizeDiscordCommandName(commandName?: string | null) {
    return (normalizeDiscordCommandNameImpl as any)(runtime, commandName);
  }

  function resolveDiscordChatProject() {
    return (resolveDiscordChatProjectImpl as any)(runtime);
  }

  async function sendDiscordReply(target: DiscordReplyTarget | undefined, content: string) {
    return (sendDiscordReplyImpl as any)(runtime, target, content);
  }

  function createDiscordResponseStreamer(target: DiscordReplyTarget) {
    return (createDiscordResponseStreamerImpl as any)(runtime, target);
  }

  async function handleSendMessage(input: ChatSendInput) {
    const projectGoalAction = parseProjectGoalCommandAction(input.content);

    if (projectGoalAction !== null) {
      if (projectGoalAction.kind === "empty") {
        setNoticeDialog({
          description: `Add the outcome after /goal, for example: /goal ship the settings redesign and verify the build.`,
          title: "Project Goal needs an objective",
        });
        return;
      }

      if (projectGoalAction.kind === "set") {
        return handleCreateProjectGoal(projectGoalAction.objective, {
          input: {
            ...input,
            content: projectGoalAction.objective,
          },
          start: true,
        });
      }

      if (projectGoalAction.kind === "continue") {
        const goal = getProjectGoalForProject(projectsRef.current, activeChat.project);

        if (!goal || goal.status !== "active") {
          setNoticeDialog({
            description: "Start or resume a Project Goal before continuing it.",
            title: "No active Project Goal",
          });
          return;
        }

        return handleSendMessageImpl(sendActionsDeps(), {
          ...input,
          content: createProjectGoalContinuePrompt(goal),
        });
      }

      if (projectGoalAction.kind === "pause") {
        handlePauseProjectGoal();
        return;
      }

      if (projectGoalAction.kind === "resume") {
        handleResumeProjectGoal();
        return;
      }

      if (projectGoalAction.kind === "complete") {
        handleCompleteProjectGoal();
        return;
      }

      handleClearProjectGoal();
      return;
    }

    return handleSendMessageImpl(sendActionsDeps(), input);
  }

  async function startSendMessage(input: ChatSendInput, queuedSend?: { chatId: string; queuedMessageId: string }, options: StartSendMessageOptions = {}) {
    return startSendMessageImpl(sendActionsDeps(), input, queuedSend, options);
  }

  function updateAutomationState(updater: (state: AutomationState, now: string) => AutomationState) {
    const now = new Date().toISOString();
    const nextState = normalizeAutomationState(updater(automationStateRef.current, now), now);
    automationStateRef.current = nextState;
    setAutomationState(nextState);
    return nextState;
  }

  function applyMobileAutomationTaskStatusUpdates(updates: Array<{ status: "enabled" | "paused"; taskId: string }>) {
    let applied = 0;
    for (const update of updates) {
      const taskId = update.taskId.trim();
      const status = update.status;
      if (!taskId) {
        continue;
      }

      const canApply = automationStateRef.current.tasks.some((task) => task.id === taskId && task.status !== "archived" && task.status !== status);
      if (!canApply) {
        continue;
      }

      updateAutomationState((state, now) => ({
        ...state,
        tasks: state.tasks.map((task) =>
          task.id === taskId && task.status !== "archived"
            ? {
                ...task,
                nextRunAt: status === "enabled" ? computeNextRunAt(task, now) : task.nextRunAt,
                status,
                updatedAt: now,
              }
            : task,
        ),
        updatedAt: now,
      }));
      applied += 1;
    }

    return applied;
  }

  function applyMobileAutomationTaskRequests(requests: unknown[]) {
    const updates: Array<{ status: "enabled" | "paused"; taskId: string }> = [];
    for (const rawRequest of requests) {
      const request = unwrapMobileBridgeRequest(rawRequest);
      if (request?.type !== "automation_task_status") {
        continue;
      }

      const taskId = typeof request.taskId === "string" ? request.taskId.trim() : "";
      const status = request.status === "enabled" ? "enabled" : request.status === "paused" ? "paused" : null;
      if (!taskId || !status) {
        continue;
      }

      updates.push({ taskId, status });
    }

    return applyMobileAutomationTaskStatusUpdates(updates);
  }

  function handleCreateAutomationTask(draft: AutomationTaskDraft) {
    const now = new Date().toISOString();
    const task = createAutomationTaskFromDraft(draft, now);

    updateAutomationState((state) => ({
      ...state,
      tasks: [task, ...state.tasks],
      updatedAt: now,
    }));
  }

  function handleUpdateAutomationTask(taskId: string, draft: AutomationTaskDraft) {
    updateAutomationState((state, now) => ({
      ...state,
      tasks: state.tasks.map((task) => {
        if (task.id !== taskId) {
          return task;
        }

        const normalizedDraft = createAutomationTaskFromDraft({
          ...draft,
          status: draft.status ?? task.status,
        }, now);
        const projectChanged = normalizeProjectName(task.projectName).toLowerCase() !== normalizeProjectName(normalizedDraft.projectName).toLowerCase();
        const nextTask: AutomationTask = {
          ...task,
          capabilityScope: normalizedDraft.capabilityScope,
          chatId: projectChanged ? undefined : task.chatId,
          description: normalizedDraft.description,
          model: normalizedDraft.model,
          notificationPolicy: normalizedDraft.notificationPolicy,
          prompt: normalizedDraft.prompt,
          projectName: normalizedDraft.projectName,
          provider: normalizedDraft.provider,
          runLimits: normalizedDraft.runLimits,
          sourceChatId: normalizedDraft.sourceChatId,
          status: normalizedDraft.status,
          title: normalizedDraft.title,
          trigger: normalizedDraft.trigger,
          updatedAt: now,
        };

        return {
          ...nextTask,
          nextRunAt: computeNextRunAt(nextTask, now),
        };
      }),
      updatedAt: now,
    }));
  }

  function handlePauseAutomationTask(taskId: string, paused: boolean) {
    updateAutomationState((state, now) => ({
      ...state,
      tasks: state.tasks.map((task) =>
        task.id === taskId
          ? {
              ...task,
              nextRunAt: paused ? task.nextRunAt : computeNextRunAt(task, now),
              status: paused ? "paused" : "enabled",
              updatedAt: now,
            }
          : task,
      ),
      updatedAt: now,
    }));
  }

  function handleDeleteAutomationTask(taskId: string) {
    updateAutomationState((state, now) => ({
      ...state,
      tasks: state.tasks.filter((task) => task.id !== taskId),
      updatedAt: now,
    }));
  }

  function handleDuplicateAutomationTask(taskId: string) {
    updateAutomationState((state, now) => {
      const sourceTask = state.tasks.find((task) => task.id === taskId);

      if (!sourceTask) {
        return state;
      }

      const duplicatedTask: AutomationTask = {
        ...sourceTask,
        chatId: undefined,
        createdAt: now,
        id: createId("task"),
        lastResult: undefined,
        lastRunAt: undefined,
        nextRunAt: computeNextRunAt(sourceTask, now),
        runCount: 0,
        status: sourceTask.status,
        title: `${sourceTask.title} copy`,
        updatedAt: now,
      };

      return {
        ...state,
        tasks: [duplicatedTask, ...state.tasks],
        updatedAt: now,
      };
    });
  }

  function handlePauseAllAutomationTasks(paused: boolean) {
    updateAutomationState((state, now) => ({
      ...state,
      globalPaused: paused,
      updatedAt: now,
    }));
  }

  function handleAcknowledgeAutomationRun(runId: string) {
    updateAutomationState((state, now) => ({
      ...state,
      runs: state.runs.map((run) => run.id === runId ? { ...run, acknowledgedAt: now, updatedAt: now } : run),
      updatedAt: now,
    }));
  }

  function handleSnoozeAutomationRun(runId: string, minutes: number) {
    const snoozedUntil = new Date(Date.now() + Math.max(5, minutes) * 60_000).toISOString();

    updateAutomationState((state, now) => ({
      ...state,
      runs: state.runs.map((run) => run.id === runId ? { ...run, snoozedUntil, updatedAt: now } : run),
      updatedAt: now,
    }));
  }

  function handleOpenAutomationRunChat(run: AutomationRun) {
    if (!run.chatId) {
      return;
    }

    setActiveChatId(run.chatId);
    setActiveRoute("chat");
  }

  function handleRunAutomationTask(taskId: string) {
    void runAutomationTask(taskId, "manual");
  }

  function handleSimulateAutomationTask(taskId: string) {
    void runAutomationTask(taskId, "simulated", { dryRun: true });
  }

  function createAutomationProviderSettingsOverrides(task: AutomationTask): Partial<ProviderSettings> {
    if (!task.provider || !task.model) {
      return {};
    }

    return {
      model: task.model,
      provider: task.provider,
      providerModels: {
        ...providerSettingsRef.current.providerModels,
        [task.provider]: task.model,
      },
    };
  }

  async function runAutomationTask(taskId: string, reason: AutomationRunReason, options: { dryRun?: boolean } = {}) {
    const currentState = automationStateRef.current;
    const task = currentState.tasks.find((candidate) => candidate.id === taskId);

    if (!task || task.status === "archived") {
      return;
    }

    if (!options.dryRun && currentState.globalPaused && reason !== "manual") {
      return;
    }

    if (runningAutomationTaskIdsRef.current.has(task.id)) {
      appendAutomationRun(task, {
        error: "A previous run for this task is still active.",
        finalSummary: "Skipped because this task is already running.",
        reason,
        status: "failed",
      });
      return;
    }

    runningAutomationTaskIdsRef.current.add(task.id);
    const now = new Date().toISOString();
    const runId = createId("automation-run");
    const runReason: AutomationRunReason = options.dryRun ? "simulated" : reason;

    const startedRun = appendAutomationRun(task, {
      dryRun: options.dryRun,
      id: runId,
      model: task.model,
      provider: task.provider,
      reason: runReason,
      status: options.dryRun ? "completed" : "running",
      startedAt: now,
    });

    if (options.dryRun) {
      const summary = createAutomationSimulationSummary(task);
      finalizeAutomationRun(task.id, runId, {
        content: summary,
        status: "completed",
      });
      runningAutomationTaskIdsRef.current.delete(task.id);
      return;
    }

    void sendAutomationRunStartedNotification(task, startedRun);

    let created = false;
    let settled = false;

    try {
      const sourceChat = resolveAutomationSourceChat(task);
      const taskProjectName = normalizeProjectName(task.projectName ?? sourceChat.project);
      const workspaceFallback = isNoProjectName(taskProjectName)
        ? localWorkspaceRef.current
        : createNoProjectWorkspace(localWorkspaceRef.current);
      const taskWorkspace = resolveWorkspaceForChatProject(taskProjectName, workspaceFallback);
      const prompt = createAutomationRunPrompt(task, { reason });
      const displayPrompt = createAutomationUserMessageContent(task, { dryRun: options.dryRun });
      const webSearchEnabled = task.capabilityScope.capabilities.includes("web.search");
      const providerSettingsOverrides = createAutomationProviderSettingsOverrides(task);

      await startSendMessage({
        attachments: [],
        content: displayPrompt,
        localWorkspace: taskWorkspace,
        mode: "chat",
        webSearch: {
          enabled: webSearchEnabled,
          maxResults: providerSettingsRef.current.webSearch.maxResults,
          provider: providerSettingsRef.current.webSearch.provider,
        },
      }, undefined, {
        automationScope: createAutomationToolScope(task),
        background: true,
        onAssistantMessageCreated: (details) => {
          created = true;
          updateAutomationState((state, eventAt) => ({
            ...state,
            runs: state.runs.map((run) =>
              run.id === runId
                ? {
                    ...run,
                    agentRunId: details.agentRunId,
                    chatId: details.chatId,
                    messageId: details.messageId,
                    model: details.model,
                    provider: details.provider,
                    updatedAt: eventAt,
                  }
                : run,
            ),
            tasks: state.tasks.map((candidate) =>
              candidate.id === task.id
                ? {
                    ...candidate,
                    chatId: details.chatId,
                    updatedAt: eventAt,
                  }
                : candidate,
            ),
            updatedAt: eventAt,
          }));
        },
        onAssistantMessageSettled: (details) => {
          settled = true;
          finalizeAutomationRun(task.id, runId, {
            agentRunId: details.agentRunId,
            approvals: details.approvals,
            chatId: details.chatId,
            content: details.content,
            error: details.error,
            messageId: details.messageId,
            model: details.model,
            provider: details.provider,
            sources: details.sources,
            status: details.status,
            toolCalls: details.toolCalls,
          });
        },
        preserveExistingTitle: true,
        preserveChatModelSelection: true,
        providerPrompt: prompt,
        providerSettingsOverrides,
        runtimeToolOverrides: createAutomationRuntimeToolOverrides(task),
        sourceChat,
        toolSelectionPrompt: createAutomationToolSelectionPrompt(task),
      });

      if (!settled) {
        finalizeAutomationRun(task.id, runId, {
          content: created
            ? "Task run stopped before producing a final result. It may have hit the task runtime limit or been interrupted."
            : "Task run could not start. Check provider settings and whether this task chat is already running.",
          error: created ? "Task run stopped before completion." : "Task run could not start.",
          status: "failed",
        });
      }
    } catch (error) {
      const message = readErrorMessage(error, "Task run failed.");
      finalizeAutomationRun(task.id, runId, {
        content: message,
        error: message,
        status: "failed",
      });
    } finally {
      runningAutomationTaskIdsRef.current.delete(task.id);
    }
  }

  function appendAutomationRun(
    task: AutomationTask,
    partialRun: Partial<AutomationRun> & Pick<AutomationRun, "reason" | "status">,
  ) {
    const now = partialRun.startedAt ?? new Date().toISOString();
    const run: AutomationRun = {
      id: partialRun.id ?? createId("automation-run"),
      notificationAttempts: [],
      startedAt: now,
      taskId: task.id,
      updatedAt: now,
      ...partialRun,
    };

    const nextState = updateAutomationState((state, eventAt) => ({
      ...state,
      runs: [run, ...state.runs].slice(0, 500),
      tasks: state.tasks.map((candidate) =>
        candidate.id === task.id
          ? {
              ...candidate,
              lastRunAt: now,
              runCount: candidate.runCount + 1,
              updatedAt: eventAt,
            }
          : candidate,
      ),
      updatedAt: eventAt,
    }));

    return nextState.runs.find((candidate) => candidate.id === run.id) ?? run;
  }

  function finalizeAutomationRun(
    taskId: string,
    runId: string,
    details: {
      agentRunId?: string;
      approvals?: AgentApproval[];
      chatId?: string;
      content: string;
      error?: string;
      messageId?: string;
      model?: string;
      provider?: ProviderSettings["provider"];
      sources?: ChatSource[];
      status: "completed" | "failed" | "waiting_for_approval";
      toolCalls?: ChatToolCall[];
    },
  ) {
    const completedAt = new Date().toISOString();
    const summary = formatAutomationInboxResult(details.content.trim() || details.error || "Task run finished.");
    const displaySources = filterAutomationWebSources(details.sources, details.toolCalls);
    const nextState = updateAutomationState((state) => {
      const task = state.tasks.find((candidate) => candidate.id === taskId);
      if (!task) {
        return state;
      }

      const nextTask: AutomationTask = {
        ...task,
        lastResult: summary,
        lastRunAt: completedAt,
        nextRunAt: computeNextRunAt({ ...task, lastRunAt: completedAt }, completedAt),
        updatedAt: completedAt,
      };

      const runs = state.runs.map((run) => {
        if (run.id !== runId) {
          return run;
        }

        const nextRun: AutomationRun = {
          ...run,
          agentRunId: details.agentRunId ?? run.agentRunId,
          approvalCount: details.approvals?.length ?? run.approvalCount ?? 0,
          chatId: details.chatId ?? run.chatId,
          completedAt,
          error: details.error,
          finalSummary: summary,
          messageId: details.messageId ?? run.messageId,
          model: details.model ?? run.model,
          notificationAttempts: [
            ...run.notificationAttempts,
            {
              at: completedAt,
              channel: "tasks_inbox",
              detail: "Saved to Tasks inbox.",
              ok: true,
            },
          ],
          sources: displaySources,
          status: details.status,
          provider: details.provider ?? run.provider,
          toolCallCount: details.toolCalls?.length ?? run.toolCallCount ?? 0,
          toolCalls: details.toolCalls,
          updatedAt: completedAt,
        };

        return nextRun;
      });

      return {
        ...state,
        runs,
        tasks: state.tasks.map((candidate) => candidate.id === taskId ? nextTask : candidate),
        updatedAt: completedAt,
      };
    });

    if (details.chatId && details.messageId && details.status !== "waiting_for_approval") {
      updateGeneratedMessage(details.chatId, details.messageId, (message) => ({
        ...message,
        content: summary,
        sources: displaySources,
      }));
    }

    const notificationTask = nextState.tasks.find((task) => task.id === taskId);
    const notificationRun = nextState.runs.find((run) => run.id === runId);

    if (notificationTask && notificationRun) {
      void sendAutomationNotifications(notificationTask, notificationRun);
    }
  }

  function resolveAutomationSourceChat(task: AutomationTask): ChatSummary {
    const taskProjectName = normalizeProjectName(task.projectName);
    const existingChat = task.chatId
      ? pendingChatsRef.current.find((chat) =>
          chat.id === task.chatId &&
          !chat.archived &&
          normalizeProjectName(chat.project).toLowerCase() === taskProjectName.toLowerCase()
        )
      : undefined;

    if (existingChat) {
      return existingChat;
    }

    return {
      ...createEmptyChat(taskProjectName),
      isDraft: undefined,
      title: `Task: ${task.title}`,
    };
  }

  async function sendAutomationNotifications(task: AutomationTask, run: AutomationRun) {
    const summary = formatAutomationNotificationSummary(task, run);

    if (task.notificationPolicy.desktop) {
      notifyAgentRunStatus({
        chatId: run.chatId,
        context: {
          chatId: run.chatId,
          chatTitle: task.title,
          project: task.projectName ?? "Tasks",
        },
        notification: {
          body: summary,
          title: run.status === "waiting_for_approval" ? "Task needs approval" : `Task: ${task.title}`,
        },
      });
      appendAutomationNotificationAttempt(run.id, {
        channel: "desktop",
        detail: "Desktop notification queued.",
        ok: true,
      });
    }

    if (task.notificationPolicy.discord) {
      const result = await sendAutomationDiscordNotification(summary);
      appendAutomationNotificationAttempt(run.id, {
        channel: "discord",
        detail: result.ok ? "Discord completion notification sent." : result.detail,
        ok: result.ok,
      });
    }
  }

  async function sendAutomationRunStartedNotification(task: AutomationTask, run: AutomationRun) {
    if (!task.notificationPolicy.discord) {
      return;
    }

    const result = await sendAutomationDiscordNotification(formatAutomationRunStartedSummary(task, run));
    appendAutomationNotificationAttempt(run.id, {
      channel: "discord",
      detail: result.ok ? "Discord start notification sent." : result.detail,
      ok: result.ok,
    });
  }

  function formatAutomationRunStartedSummary(task: AutomationTask, run: AutomationRun) {
    const raw =
      task.notificationPolicy.privacy === "private"
        ? `${task.title}: task run started. Results will appear in Tasks.`
        : `${task.title}: task run started (${run.reason}). Results will appear in Tasks when it finishes.`;
    const maxChars = Math.max(120, Math.min(task.notificationPolicy.maxSummaryChars || 900, task.runLimits.maxNotificationChars || 900));

    return raw.length > maxChars ? `${raw.slice(0, maxChars - 3).trim()}...` : raw;
  }

  function appendAutomationNotificationAttempt(
    runId: string,
    attempt: Pick<AutomationRun["notificationAttempts"][number], "channel" | "detail" | "ok">,
  ) {
    updateAutomationState((state, now) => ({
      ...state,
      runs: state.runs.map((run) =>
        run.id === runId
          ? {
              ...run,
              notificationAttempts: [
                ...run.notificationAttempts,
                {
                  ...attempt,
                  at: now,
                },
              ],
              updatedAt: now,
            }
          : run,
      ),
      updatedAt: now,
    }));
  }

  async function sendAutomationDiscordNotification(content: string): Promise<{ detail: string; ok: boolean }> {
    const settings = discordBridgeSettingsRef.current;
    const webhookUrl = settings.incomingWebhookUrl.trim();

    if (!webhookUrl) {
      return sendAutomationDiscordBotChannelNotification(content, settings);
    }

    try {
      if (isTauriDesktopRuntime()) {
        await sendDiscordWebhookMessage({
          content,
          webhookUrl,
        });

        return {
          detail: "Discord notification sent.",
          ok: true,
        };
      }

      const response = await fetch(createDiscordWebhookWaitUrl(webhookUrl), {
        body: JSON.stringify({
          allowed_mentions: {
            parse: [],
          },
          content,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });

      return {
        detail: response.ok ? "Discord notification sent." : await formatDiscordWebhookFailure(response),
        ok: response.ok,
      };
    } catch (error) {
      return {
        detail: readErrorMessage(error, "Discord notification failed."),
        ok: false,
      };
    }
  }

  function createDiscordWebhookWaitUrl(webhookUrl: string) {
    const trimmed = webhookUrl.trim();

    if (/\bwait=/.test(trimmed.split("?")[1] ?? "")) {
      return trimmed;
    }

    return `${trimmed}${trimmed.includes("?") ? "&" : "?"}wait=true`;
  }

  async function formatDiscordWebhookFailure(response: Response) {
    let body = "";

    try {
      body = await response.text();
    } catch {
      body = "";
    }

    const detail = body.trim();

    if (!detail) {
      return `Discord rejected the webhook message with status ${response.status}.`;
    }

    const limited = detail.length > 700 ? `${detail.slice(0, 684)} [truncated]` : detail;
    return `Discord rejected the webhook message with status ${response.status}: ${limited}`;
  }

  async function sendAutomationDiscordBotChannelNotification(
    content: string,
    settings: DiscordBridgeSettings,
  ): Promise<{ detail: string; ok: boolean }> {
    const channelId = getFirstDiscordId(settings.allowedChannelIds);
    const botToken = normalizeDiscordBotToken(settings.botToken);

    if (!settings.enabled || !botToken || !channelId) {
      return {
        detail: "Discord task notifications need an incoming webhook, or an enabled Discord bridge with bot token and an allowed channel ID.",
        ok: false,
      };
    }

    try {
      if (isTauriDesktopRuntime()) {
        await sendDiscordChannelMessage({
          botToken,
          channelId,
          content,
        });

        return {
          detail: "Discord bot channel notification sent.",
          ok: true,
        };
      }

      const response = await fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages`, {
        body: JSON.stringify({ content }),
        headers: {
          authorization: `Bot ${botToken}`,
          "content-type": "application/json",
        },
        method: "POST",
      });

      return {
        detail: response.ok ? "Discord bot channel notification sent." : `Discord bot channel post returned ${response.status}.`,
        ok: response.ok,
      };
    } catch (error) {
      return {
        detail: readErrorMessage(error, "Discord bot channel notification failed."),
        ok: false,
      };
    }
  }

  function getFirstDiscordId(value: string) {
    return value
      .split(/[\s,;]+/)
      .map((part) => part.trim())
      .find((part) => /^\d{12,24}$/.test(part));
  }

  function normalizeDiscordBotToken(value: string) {
    return value.trim().replace(/^Bot\s+/i, "").trim();
  }

  function runDueAutomationTasks() {
    const state = automationStateRef.current;

    if (state.globalPaused) {
      return;
    }

    const now = new Date().toISOString();
    const dueTasks = state.tasks.filter((task) =>
      task.trigger.kind !== "app_start" &&
      isAutomationTaskDue(task, now) &&
      !runningAutomationTaskIdsRef.current.has(task.id),
    );

    for (const task of dueTasks.slice(0, 3)) {
      void runAutomationTask(task.id, "scheduled");
    }
  }

  function runAppStartAutomationTasks() {
    const state = automationStateRef.current;

    if (state.globalPaused) {
      return;
    }

    for (const task of state.tasks) {
      if (task.status !== "enabled" || task.trigger.kind !== "app_start" || appStartAutomationTaskIdsRef.current.has(task.id)) {
        continue;
      }

      appStartAutomationTaskIdsRef.current.add(task.id);
      void runAutomationTask(task.id, "app_start");
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    let schedulerTimer: number | undefined;
    let disposed = false;

    const scheduleNextTick = (delayMs: number) => {
      schedulerTimer = window.setTimeout(() => {
        if (disposed) {
          return;
        }

        runAppStartAutomationTasks();
        runDueAutomationTasks();
        scheduleNextTick(computeAutomationSchedulerDelayMs(automationStateRef.current));
      }, delayMs);
    };

    scheduleNextTick(1_500);

    return () => {
      disposed = true;
      if (schedulerTimer !== undefined) {
        window.clearTimeout(schedulerTimer);
      }
    };
  }, [automationState.globalPaused, automationState.tasks]);

  function updateProjectGoalForProject(projectName: string, updater: (goal: ProjectGoal | undefined, now: string) => ProjectGoal | undefined) {
    const normalizedProjectName = normalizeProjectName(projectName);

    if (isNoProjectName(normalizedProjectName)) {
      setNoticeDialog({
        description: "Choose or create a project before starting a Project Goal.",
        title: "No project selected",
      });
      return false;
    }

    const now = new Date().toISOString();

    const currentProjects = projectsRef.current;
    const existingProject = currentProjects.find((project) => project.name.toLowerCase() === normalizedProjectName.toLowerCase());
    const nextGoal = updater(existingProject?.projectGoal, now);

    if (!existingProject && !nextGoal) {
      return true;
    }

    const nextProject: ProjectSummary = {
      ...(existingProject ?? {
        createdAt: now,
        id: createId("project"),
        localWorkspace: localWorkspaceRef.current.enabled ? localWorkspaceRef.current : undefined,
        name: normalizedProjectName,
      }),
      projectGoal: nextGoal,
      updatedAt: now,
    };
    const nextProjects = existingProject
      ? currentProjects.map((project) => (project.name.toLowerCase() === normalizedProjectName.toLowerCase() ? nextProject : project))
      : [nextProject, ...currentProjects];
    const sortedProjects = sortProjectsByUpdatedAt(nextProjects);
    projectsRef.current = sortedProjects;
    setProjects(sortedProjects);

    return true;
  }

  async function handleCreateProjectGoal(objective: string, options: { input?: ChatSendInput; start?: boolean } = {}) {
    const normalizedObjective = normalizeProjectGoalObjective(objective);

    if (!normalizedObjective) {
      setNoticeDialog({
        description: "Project Goals need a concrete outcome or completion criteria.",
        title: "Project Goal needs an objective",
      });
      return;
    }

    const updated = updateProjectGoalForProject(activeChat.project, (_goal, now) =>
      createProjectGoal({
        id: createId("project-goal"),
        now,
        objective: normalizedObjective,
        status: "active",
      }),
    );

    if (updated && options.start) {
      await handleSendMessageImpl(sendActionsDeps(), {
        ...(options.input ?? {
          attachments: [],
          content: normalizedObjective,
        }),
        content: normalizedObjective,
      });
    }
  }

  function handleUpdateProjectGoal(objective: string) {
    const normalizedObjective = normalizeProjectGoalObjective(objective);

    if (!normalizedObjective) {
      setNoticeDialog({
        description: "Project Goals need a concrete outcome or completion criteria.",
        title: "Project Goal needs an objective",
      });
      return;
    }

    updateProjectGoalForProject(activeChat.project, (goal, now) => {
      if (!goal) {
        return createProjectGoal({
          id: createId("project-goal"),
          now,
          objective: normalizedObjective,
          status: "active",
        });
      }

      return {
        ...goal,
        completedAt: undefined,
        objective: normalizedObjective,
        status: "active",
        updatedAt: now,
      };
    });
  }

  function handlePauseProjectGoal() {
    updateProjectGoalForProject(activeChat.project, (goal, now) =>
      goal
        ? {
            ...goal,
            status: "paused",
            updatedAt: now,
          }
        : undefined,
    );
  }

  function handleResumeProjectGoal() {
    updateProjectGoalForProject(activeChat.project, (goal, now) =>
      goal
        ? {
            ...goal,
            completedAt: undefined,
            status: "active",
            updatedAt: now,
          }
        : undefined,
    );
  }

  function handleCompleteProjectGoal() {
    updateProjectGoalForProject(activeChat.project, (goal, now) =>
      goal
        ? {
            ...goal,
            completedAt: now,
            status: "complete",
            updatedAt: now,
          }
        : undefined,
    );
  }

  function handleClearProjectGoal() {
    updateProjectGoalForProject(activeChat.project, () => undefined);
  }

  function saveProjectRunConfigForProject(projectName: string, config: ProjectRunConfig | undefined) {
    const normalizedProjectName = normalizeProjectName(projectName);

    if (isNoProjectName(normalizedProjectName)) {
      return;
    }

    const normalizedConfig = normalizeProjectRunConfig(config);
    const now = new Date().toISOString();

    setProjects((currentProjects) => {
      const nextProjects = currentProjects.some((project) => project.name.toLowerCase() === normalizedProjectName.toLowerCase())
        ? currentProjects.map((project) =>
            project.name.toLowerCase() === normalizedProjectName.toLowerCase()
              ? {
                  ...project,
                  runConfig: normalizedConfig,
                  updatedAt: now,
                }
              : project,
          )
        : [
            {
              createdAt: now,
              id: createId("project"),
              localWorkspace: localWorkspaceRef.current.enabled ? localWorkspaceRef.current : undefined,
              name: normalizedProjectName,
              runConfig: normalizedConfig,
              updatedAt: now,
            },
            ...currentProjects,
          ];
      const sortedProjects = sortProjectsByUpdatedAt(nextProjects);
      projectsRef.current = sortedProjects;
      return sortedProjects;
    });
  }

  async function handleOpenProjectRun() {
    setSearchOpen(false);
    setProjectRunDialogOpen(true);

    const projectName = normalizeProjectName(activeChat.project);
    if (isNoProjectName(projectName)) {
      return;
    }

    const workspace = resolveWorkspaceForChatProject(projectName, localWorkspaceRef.current);
    const root = workspace.enabled ? workspace.roots[0] : "";
    if (!root) {
      return;
    }

    const project = projectsRef.current.find((candidate) => candidate.name.toLowerCase() === projectName.toLowerCase());
    const detectedConfig = await detectProjectRunConfigForWorkspace(workspace, project?.runConfig);
    if (detectedConfig) {
      saveProjectRunConfigForProject(projectName, detectedConfig);
    }
  }

  async function handleOpenProjectInTool(project: string, target: ProjectOpenTargetId) {
    const projectName = normalizeProjectName(project);
    const workspace = resolveWorkspaceForChatProject(projectName, localWorkspaceRef.current);
    const root = workspace.enabled ? workspace.roots[0] : "";

    if (isNoProjectName(projectName) || !root) {
      setNoticeDialog({
        description: "Add or select a project folder before opening it in another app.",
        title: "No project folder selected",
      });
      return;
    }

    try {
      await openProjectInExternalTool({
        path: root,
        target,
      });
      touchProject(projectName);
    } catch (error) {
      setNoticeDialog({
        description: readErrorMessage(error, "Install the app or add its launcher to PATH, then try again."),
        title: "Could not open project",
      });
    }
  }

  function handleSaveProjectRunConfig(config: ProjectRunConfig) {
    saveProjectRunConfigForProject(activeChat.project, config);
    setProjectRunDialogOpen(false);
  }

  async function handleSaveAndRunProjectRun(config: ProjectRunConfig, action: ProjectRunAction) {
    const projectName = normalizeProjectName(activeChat.project);
    const workspace = resolveWorkspaceForChatProject(projectName, localWorkspaceRef.current);
    const root = workspace.enabled ? workspace.roots[0] : "";

    if (!root || !action.command.trim()) {
      setNoticeDialog({
        description: root ? "Enter a command before running this project." : "Choose a project folder before running commands.",
        title: "Run action is not ready",
      });
      return;
    }

    const runningConfig = updateProjectRunLastRun(config, action, {
      status: "running",
    });
    saveProjectRunConfigForProject(projectName, runningConfig);
    setProjectRunDialogOpen(false);

    await startSendMessage({
      attachments: [],
      content: createProjectRunRequestPrompt({
        action,
        projectName,
        root,
      }),
      localWorkspace: workspace,
      mode: "chat",
      webSearch: {
        enabled: false,
        maxResults: providerSettings.webSearch.maxResults,
        provider: providerSettings.webSearch.provider,
      },
    }, undefined, {
      preserveExistingTitle: true,
    });
  }

  async function handleResolveToolApproval(messageId: string, approvalId: string, decision: AgentApprovalDecision) {
    return (handleResolveToolApprovalImpl as any)(runtime, messageId, approvalId, decision);
  }

  async function handleSubmitPlanningInput(messageId: string, answers: ChatPlanningInputAnswer[]) {
    return (handleSubmitPlanningInputImpl as any)(runtime, messageId, answers);
  }

  async function handleRequestPlanRevision(messageId: string, feedback: string) {
    return (handleRequestPlanRevisionImpl as any)(runtime, messageId, feedback);
  }

  async function handleRegenerateResponse(messageId: string) {
    return (handleRegenerateResponseImpl as any)(runtime, messageId);
  }

  function renderUtilityPage() {
    return (renderUtilityPageImpl as any)(runtime);
  }

  function renderChatPage() {
    return (renderChatPageImpl as any)(runtime);
  }

  function handleSkipOnboarding() {
    return (handleSkipOnboardingImpl as any)(runtime);
  }

  function handleNeverShowOnboarding() {
    return (handleNeverShowOnboardingImpl as any)(runtime);
  }

  function handleOpenOnboardingSettings() {
    return (handleOpenOnboardingSettingsImpl as any)(runtime);
  }

  function handleOpenProviderConnectionNineRouterSettings() {
    return (handleOpenProviderConnectionNineRouterSettingsImpl as any)(runtime);
  }

  function handleOpenProviderConnectionKeySettings() {
    return (handleOpenProviderConnectionKeySettingsImpl as any)(runtime);
  }

  function handleRouteChange(route: PrimaryRoute) {
    return (handleRouteChangeImpl as any)(runtime, route);
  }

  function handleSettingsSectionChange(section: SettingsSectionId) {
    return (handleSettingsSectionChangeImpl as any)(runtime, section);
  }

  const handlePreloadRoute = useCallback((route: PrimaryRoute) => {
    if (route === "apps") {
      void loadAppsPage();
    } else if (route === "tasks") {
      void loadTasksPage();
    } else if (route === "settings") {
      void preloadSettingsSection(activeSettingsSection);
    } else if (route === "radar" && locationServicesEnabled) {
      void loadWeatherRadarPage();
    }
  }, [activeSettingsSection, locationServicesEnabled]);

  const handlePreloadSettingsSection = useCallback((section: SettingsSectionId) => {
    void preloadSettingsSection(section);
  }, []);

  useEffect(() => {
    return scheduleDelayedIdleTask(() => {
      preloadRouteBundles(locationServicesEnabled);
    }, ROUTE_PRELOAD_DELAY_MS, 5_000);
  }, [locationServicesEnabled]);



  Object.assign(runtime, {
    activateForkedChat,
    activeChat,
    activeChatId,
    activeChatIdRef,
    activeChatProviderSettings,
    activeGenerationsRef,
    activeRequestChatIdsRef,
    activeRoute,
    activeSendRef,
    activeSettingsSection,
    agentRuns,
    agentRunsRef,
    annotateProviderPayloadSpike,
    appearanceMode,
    appearanceSettings,
    appendAgentRuntimeStep,
    appendAutoCompactionContinuation,
    appInfo,
    applyGeneratedChatTitle,
    applyProviderUsageToContextEstimate,
    approvedPlanRequiresMutation,
    AppsPage,
    automationDraft,
    automationMcpServers,
    automationSkillRegistry,
    automationState,
    attachLiveTerminalSession,
    AUTO_COMPACT_CONTEXT_TARGET,
    AUTO_COMPACT_CONTEXT_THRESHOLD,
    bindActiveChatToProject,
    BRIDGE_TOOL_APPROVAL_RESUME_KIND,
    browserPreviewTarget,
    buildComputerFileIndex,
    bulkDeleteChatIds,
    chatMemoryFingerprintsRef,
    ChatPage,
    chats,
    clampMemoryToolInteger,
    cleanGitFallbackPath,
    coalesceToolBridgeCalls,
    compactMessagesForContext,
    compactProviderMessages,
    completeActiveProgress,
    completeLatestAgentRuntimeStep,
    composerDraftToRestore,
    contentReferencesChatTitle,
    CONTEXT_COMPACTION_PROGRESS_ID,
    CONTEXT_COMPACTION_STRATEGY,
    CONTEXT_COMPACTION_SUMMARY_VERSION,
    contextWindow,
    contextWindowRef,
    copyLabeledTextToClipboard,
    copyTextToClipboard,
    countAutoCompactedProviderMessages,
    countTextLines,
    createActiveGeneration,
    createActiveLocalToolCalls,
    createActiveProjectBoundaryMessage,
    createAgentPrimitiveToolContent,
    createAgentRunForMessage,
    createAgentRunRequest,
    createAgentRuntimeDecisionInstruction,
    createAgentRunWorkflowToolContent,
    createAppAgentToolCall,
    createApprovalSessionDecisionKey,
    createApprovalWorkspaceSessionKey,
    createApprovedPlanExecutionFailedAnswer,
    createApprovedPlanExecutionInstruction,
    createApprovedPlanExecutionPrompt,
    createApprovedPlanExecutionRetryInstruction,
    createAssistantToolRequestContent,
    createBridgeChatToolCall,
    createChatContextCompaction,
    createChatDeeplink,
    createChatMemoryFingerprint,
    createChatProviderSettings,
    createChatResearchContextContent,
    createChatResearchContextMessages,
    createChatToolSelectionPrompt,
    createCompletedToolFallbackSummary,
    createComputerGitWorktree,
    createContextBoundLocalToolExecutionPolicy,
    createContextCompactionProgress,
    createDefaultToolRegistry,
    createDiscordMessageSource,
    createDiscordResponseStreamer,
    createDiscordRuntimeContextMessages,
    createDurableMemoryContext,
    createDurableMemoryScopeFromChat,
    createDurableProjectMemoryScope,
    createEmptyChat,
    createEmptyResponseRetrySettings,
    createFabricatedToolProgressRecoveryInstruction,
    createFallbackChatTitle,
    createFinalAnswerRecoveryInstruction,
    createFinalOnlyProviderSettings,
    createForkedChat,
    createFreshLocalToolEvidenceInstruction,
    createGitToolFallbackAnswer,
    createId,
    createInterruptedResponseContextMessages,
    createInterruptedResponseContinuationInstruction,
    createLocalComputerProgress,
    createLocalToolBudgetFinalInstruction,
    createLocalToolFinalInstruction,
    createLocalWorkspaceContext,
    createLocalWorkspaceContextMessages,
    createLocationAwareToolSettings,
    createLocationAwareWebSearchSettings,
    createMalformedToolCallRecoveryInstruction,
    createMemorySearchForRequest,
    createMessage,
    createMessagesForProvider,
    createMissingReadSearchQuery,
    createNeedsAttentionNotification,
    createNeedsInputNotification,
    createNeutralToolSynthesisFailureMessage,
    createNoExecutedToolFinalAnswer,
    createNoExecutedToolFinalInstruction,
    createNoProjectWorkspace,
    createPdfLibraryContextMessages,
    createPlanningAnswerMessages,
    createPlanningExecutionApproval,
    createPlanningInputRequest,
    createPlanningProgress,
    createPlanResearchFollowupInstruction,
    createPlanResearchInstruction,
    createProjectBaseName,
    createProjectFromFolder,
    createProjectToolMemoryContext,
    createProjectToolMemoryScope,
    createPromptAwareProviderSettings,
    createPromptAwareThinkingSettings,
    createProviderPayloadGuardrailProgress,
    createProviderRetryInstruction,
    createRecoverableBridgeToolRetryInstruction,
    createRecoverableLocalEditRetryInstruction,
    createRuntimeApprovalDecisions,
    createSimpleLocalTaskCompletionAnswer,
    createSourceControlContextMessages,
    createSteeringInstruction,
    createSynthesisRecoveryFallback,
    createToolActionPromiseRecoveryInstruction,
    createToolAwareProviderSettings,
    createToolFinalAnswerUnavailableMessage,
    createToolMemoryScope,
    createToolProtocolNarrationRecoveryInstruction,
    createUnappliedFileEditRecoveryInstruction,
    createUniqueProjectName,
    createUnnecessaryLocalActionConfirmationRecoveryInstruction,
    dedupeGitFallbackFiles,
    DEFAULT_PROJECT,
    defaultTerminalWorkingDirectory,
    detectSimpleLocalTaskCompletion,
    DISCORD_NEW_CHAT_COMMAND,
    DISCORD_STREAM_UPDATE_INTERVAL_MS,
    discordBridgeSettings,
    discordBridgeSettingsRef,
    discordSourceMatchesInteraction,
    DOMException,
    DURABLE_MEMORY_BATCH_DELAY_MS,
    DURABLE_MEMORY_BATCH_SIZE,
    DURABLE_MEMORY_PERSIST_DELAY_MS,
    durableMemoryFlushTimerRef,
    enqueueChatSend,
    estimateModelProviderPayloadUsage,
    estimateProviderContextUsageForDisplay,
    executeToolBridgeCalls,
    extractFirstUnsuccessfulToolSection,
    extractMissingReadPath,
    extractNearbyPathCandidates,
    extractSuggestedFileReadCandidates,
    extractSuggestedFileSearchQuery,
    extractToolInputPath,
    extractToolStdout,
    findActiveAssistantMessageIndex,
    findLatestDiscordConversationChat,
    finishActiveGeneration,
    flushDurableMemoryQueue,
    formatChatAsMarkdown,
    formatDiscordStreamMessage,
    formatDiscordToolStatus,
    formatGitStatSuffix,
    formatGitStatusFallbackGroup,
    formatLocalToolPreviewProgress,
    formatResearchPayload,
    formatTokenCount,
    generateChatTitle,
    generalSettings,
    getActiveGenerationByMessage,
    getActiveGenerationByRequest,
    getActiveWorkingDirectory,
    getAutomaticWorkspaceContextCharBudget,
    getChatResearchCandidates,
    getComputerFileIndexSummary,
    getConfiguredContextWindow,
    getContextCompactionMarkerKey,
    getDefaultBaseUrlForProvider,
    getEffectiveMaxOutputTokens,
    getEnabledWorkspaceRoots,
    resolveEnabledWorkspaceRoots,
    getFallbackContextWindowTokens,
    getLastPathSegment,
    getLatestUserPrompt,
    getManualModelBudgetOverride,
    getModelProvider,
    getModelVisibleToolResultCharBudget,
    getPendingPlanningInputRequest,
    getPlanningInputRequests,
    getProviderApiKey,
    getProviderCompactionBaseline,
    getRuntimeWebSearchMaxResults,
    getRuntimeWebSearchSettings,
    getSendingChatIds,
    getToolCallRawOutput,
    getToolMemoryProjectName,
    groupGitStatusFallbackFiles,
    handleActiveChatModelChange,
    handleAcknowledgeAutomationRun,
    handleAddAutomation,
    handleArchiveActiveChat,
    handleComposerDraftChange,
    handleCopyChatDeeplink,
    handleCopyChatMarkdown,
    handleCopySessionId,
    handleCopyWorkingDirectory,
    handleClearProjectGoal,
    handleCompleteProjectGoal,
    handleCreateProjectGoal,
    handleCreateAutomationTask,
    handleDeleteAutomationTask,
    handleDeleteQueuedMessage,
    handleDuplicateAutomationTask,
    handleEditUserMessageAndRegenerate,
    handleForkActiveChatLocal,
    handleForkChatFromMessage,
    handleForkActiveChatWorktree,
    handleHoldQueuedMessage,
    handleLocalWorkspaceChange,
    handleMessageFeedback,
    handleNewChat,
    handleOpenActiveChatInNewWindow,
    handleOpenAutomationRunChat,
    handleOpenProjectInTool,
    handleOpenProjectRun,
    handleOpenRenameChat,
    handlePauseProjectGoal,
    handlePauseAllAutomationTasks,
    handlePauseAutomationTask,
    handleRegenerateResponse,
    handleRequestPlanRevision,
    handleResumeProjectGoal,
    handleRunAutomationTask,
    handleResolveToolApproval,
    handleRouteChange,
    handleSelectChat,
    handleSelectProject,
    handleSendMessage,
    handleSimulateAutomationTask,
    handleSnoozeAutomationRun,
    handleSteerQueuedMessage,
    handleStopGeneration,
    handleSubscriptionSandboxUninstalled,
    handleSubmitPlanningInput,
    handleTogglePin,
    handleToggleTerminal,
    handleUpdateProjectGoal,
    handleUpdateAutomationTask,
    handleUpdateQueuedMessage,
    hasAnyLocalWorkspaceToolEnabled,
    hasComposerDraftContent,
    hasLocalComputerToolCalls,
    hasLocalToolEvidence,
    hasRequestScopedWorkspaceToolsEnabled,
    hasSuccessfulApprovedPlanMutation,
    hasSuccessfulApprovedPlanWorkspaceTool,
    inferProviderToolBridgeFormat,
    isAbortError,
    isActiveChatProject,
    isAnyChatSending,
    isAutoCompactionContinuationMessage,
    isChatSending,
    isDiscardableEmptyChat,
    isDiscordNewChatCommand,
    isEmptyChat,
    isEmptySelectedScaffoldProbe,
    isFileReadSynthesisToolCall,
    isInterruptedAssistantMessage,
    isLocalModelProvider,
    isMissingFileReadError,
    isMissingFileReadToolCall,
    isModelProviderId,
    isNoProjectName,
    isPlainResearchChat,
    isProviderEmptyResponseError,
    isRecoverableBridgeArgumentError,
    isRecoverableLocalEditFailure,
    isRequestInactive,
    isResearchDeepEnough,
    isRetryableProviderMessageError,
    isSimpleLocalScaffoldRequest,
    isToolResultFallbackAnswer,
    isVisibleToolResultLeak,
    lastContextCompaction,
    lastProviderContextUsage,
    lastProviderContextUsageRef,
    learnProjectToolMemoryFromBridgeRun,
    learnProjectToolMemoryFromChatToolCalls,
    limitFallbackToolOutput,
    limitMemoryToolContent,
    loadDurableChatMemoryState,
    loadDurableProjectMemoryState,
    loadPersistentString,
    loadProjectToolMemoryState,
    loadToolMemoryForProject,
    LOCAL_TOOL_FINAL_MIN_TOKENS,
    localWorkspace,
    localWorkspaceRef,
    locationServicesEnabled,
    loadingChatIds,
    looksLikeContradictedSuccessfulFileMutationAnswer,
    looksLikeFabricatedToolProgress,
    looksLikeInFlightToolPlanning,
    looksLikeInternalToolRecoveryAnswer,
    looksLikeOnlyToolPrelude,
    looksLikePrivateThinkingNarration,
    looksLikeSubstantiveVisibleAnswer,
    looksLikeToolProtocolNarration,
    looksLikeUnappliedFileEditAnswer,
    looksLikeUnexecutedToolActionPromise,
    looksLikeUnnecessaryLocalActionConfirmation,
    mapAgentDecisionToStepType,
    markPlanningInputAnswered,
    MAX_LOCAL_TOOL_EXECUTIONS,
    MAX_LOCAL_TOOL_PASSES,
    MAX_MALFORMED_TOOL_RECOVERY_RETRIES,
    MAX_PLANNING_INPUT_ROUNDS,
    MAX_RECOVERABLE_LOCAL_EDIT_RETRIES,
    MAX_TOOL_FINALIZATION_RETRIES,
    MAX_WEB_SEARCH_RESULTS,
    mergeAgentApprovals,
    mergeChatArtifacts,
    mergeChatSources,
    mergeMessageWorkTrace,
    MESSAGE_RETRY_TIMEOUT_MS,
    minNullableCharCap,
    modelContextWindows,
    modelContextWindowsRef,
    needsFreshLocalToolEvidence,
    normalizeDiscordCommandName,
    normalizeProjectName,
    normalizeSelectedProjectPath,
    notifyAgentRunStatus,
    notifyPlanningInputNeeded,
    notifyRunComplete,
    notifyRunNeedsAttention,
    ONBOARDING_NEVER_SHOW_KEY,
    openChatWindow,
    openCreateProjectDialog,
    parseAgentRuntimeDecision,
    parseGitDiffStatFallbackFiles,
    parseGitStatusFallbackFiles,
    parseVisibleTextToolCalls,
    PENDING_CHAT_TITLE,
    pendingChatsRef,
    pendingClearChatId,
    pendingDeleteChatId,
    pendingDeleteProjectName,
    pendingDurableMemoryChatIdsRef,
    persistAgentRun,
    persistChatState,
    persistDurableMemoryForChatId,
    persistDurableMemoryFromChat,
    personalizationSettings,
    pickComputerFolder,
    PLAN_RESEARCH_BUDGET,
    preserveContextUsageHighWaterMark,
    preserveQueuedMessagesForSnapshot,
    preserveVisibleResponseThinking,
    priorityDurableMemoryChatIdsRef,
    projectNameFromPath,
    projects,
    projectsRef,
    PROVIDER_PAYLOAD_GUARDRAIL_PROGRESS_ID,
    providerSettings,
    pruneEmptyChats,
    queueAgentRunSave,
    queuedChatSends,
    queuedChatSendsRef,
    queueDurableMemoryForChangedChats,
    queueDurableMemoryForChatIds,
    readErrorMessage,
    recordContextCompaction,
    recordPlanningProviderRequest,
    recordPlanningProviderUsage,
    recordProviderActualUsage,
    recordProviderContextUsage,
    referencesSelectedWorkspaceForToolSelection,
    rememberProjectMapSnapshot,
    rememberProjectToolMemoryFromBridgeRun,
    rememberProjectToolMemoryFromChatToolCalls,
    rememberSessionApprovalDecision,
    removeSteeringProgress,
    renameChatId,
    renameChatTitle,
    requiresWorkspaceMutationForPrompt,
    requiresWorkspaceToolCallForPrompt,
    resolveChatResearchReferences,
    resolveContextWindowForModel,
    resolveDiscordChatProject,
    resolveDiscordSourceChat,
    resolveLocalWorkspaceRoots,
    resolveSettingsNavSection,
    resolveToolPermission,
    resolveWorkspaceForChatProject,
    restoreChatSnapshot,
    restoreProjectLocalWorkspace,
    routePrimitiveEvidenceBatchToWorkflow,
    runAppOwnedCodingAgent,
    runLocalComputerToolCalls,
    runParallelSubagents,
    runPlanningMode,
    runProviderRetryWithTimeout,
    sameComposerDraft,
    sameLocalWorkspaceSettings,
    samePathSet,
    sameProjectName,
    sanitizeLocalToolCallsForDisplay,
    saveAgentRun,
    saveChats,
    saveDurableProjectMemoryState,
    savePersistentString,
    saveProjectToolMemoryState,
    saveToolMemoryForProject,
    saveWorkspaceForProject,
    scheduleChatStatePersistence,
    scheduleDurableMemoryFlush,
    scheduleGeneratedChatTitle,
    selectAdvertisedBridgeTools,
    selectToolCapabilityPlan,
    sendDiscordInteractionResponse,
    sendDiscordReply,
    sendProviderMessage,
    sessionApprovalDecisionsRef,
    setActiveChatId,
    setActiveGenerationTarget,
    setActiveRoute,
    setActiveSettingsSection,
    setAgentRunCancelled,
    setAgentRunCompleted,
    setAgentRunContinuing,
    setAgentRunFailed,
    setAgentRuns,
    setAgentRunsLive,
    setAgentRunWaiting,
    setAutomationDraft,
    setAppearanceMode,
    setAppearanceSettings,
    setBrowserPreviewTarget,
    setBulkDeleteChatIds,
    setBulkDeleteChatsOpen,
    setChats,
    setChatsLive,
    setChatSending,
    setChatsState,
    setComposerDraftToRestore,
    setDiscordBridgeSettings,
    setGeneralSettings,
    setLastContextCompaction,
    setLastProviderContextUsage,
    setLocalWorkspace,
    setNoticeDialog,
    setOnboardingOpen,
    setPendingClearChatId,
    setPendingDeleteChatId,
    setPendingDeleteProjectName,
    setPersonalizationSettings,
    setProjects,
    setProviderConnectionOpen,
    setProviderSettings,
    setQueuedChatSends,
    setRenameChatError,
    setRenameChatId,
    setRenameChatTitle,
    setSearchOpen,
    setSendingChatIds,
    setTerminalAttachedSession,
    setTerminalOpen,
    SettingsPage,
    shouldAttachWebSearch,
    shouldHoldStreamingContentForToolCalls,
    shouldKeepToolOutputOutOfChat,
    shouldPreserveExistingTitleAfterUserEdit,
    shouldSkipLocalContextForGithub,
    shouldStartAppAgentRun,
    shouldSynthesizeEmptyFinalFromToolResults,
    sortChatsByUpdatedAt,
    sortProjectsByUpdatedAt,
    stampLocalToolCallIds,
    STANDARD_LOCAL_COMPUTER_TOOL_EXECUTION_POLICY,
    startSendMessage,
    steerActiveResponse,
    STEERING_PROGRESS_ID,
    stopActiveGeneration,
    stopStaleStreamingMessages,
    stopStreamingAssistantMessage,
    stopStreamingMessage,
    streamAssistantWithLocalTools,
    streamProviderMessage,
    streamProviderMessageWithRetry,
    stripLeadingToolPreludeForDisplay,
    stripToolAdaptationRecommendation,
    stripToolSectionHeader,
    summarizeAgentRuntimeDecision,
    summarizeCompletedToolFallback,
    summarizeResearchEvidence,
    summarizeUnsuccessfulToolSection,
    summarizeUserFacingFailure,
    supportsProviderParallelToolCalls,
    supportsProviderThinking,
    syncLocalWorkspaceIndexSummary,
    syncPdfLibraryFromChats,
    takeNextDurableMemoryChatId,
    terminalOpen,
    TasksPage,
    titleFromMessage,
    titleGenerationRequestsRef,
    toolSettings,
    touchProject,
    updateAgentRun,
    updateDurableProjectMemoryMap,
    updateGeneratedMessage,
    updateQueuedChatSends,
    upsertToolCall,
    validateToolArguments,
    waitForDiscordFlushSlot,
    WeatherRadarPage,
    withContextCompactionMarker,
    withContextCompactionProgress,
    withLocalComputerProgress,
    withProviderPayloadGuardrailProgress,
    withSteeringProgress,
    withWebSearchProgress,
  });

  const activeToolAwareProviderSettingsCache = activeToolAwareProviderSettingsRef.current;
  const activeToolAwareProviderSettings =
    activeToolAwareProviderSettingsCache &&
    activeToolAwareProviderSettingsCache.chat === activeChat &&
    activeToolAwareProviderSettingsCache.contextWindow === contextWindow &&
    activeToolAwareProviderSettingsCache.generalSettings === generalSettings &&
    activeToolAwareProviderSettingsCache.locationServicesEnabled === locationServicesEnabled &&
    activeToolAwareProviderSettingsCache.modelContextWindows === modelContextWindows &&
    activeToolAwareProviderSettingsCache.providerSettings === providerSettings
      ? activeToolAwareProviderSettingsCache.value
      : createToolAwareProviderSettings({}, activeChat);
  activeToolAwareProviderSettingsRef.current = {
    chat: activeChat,
    contextWindow,
    generalSettings,
    locationServicesEnabled,
    modelContextWindows,
    providerSettings,
    value: activeToolAwareProviderSettings,
  };
  runtime.activeToolAwareProviderSettings = activeToolAwareProviderSettings;

  const pendingClearChat = pendingClearChatId ? chats.find((chat) => chat.id === pendingClearChatId) : undefined;
  const pendingDeleteChat = pendingDeleteChatId ? chats.find((chat) => chat.id === pendingDeleteChatId) : undefined;
  const pendingRenameChat = renameChatId ? chats.find((chat) => chat.id === renameChatId) : undefined;
  const pendingDeleteProject = pendingDeleteProjectName ? projects.find((project) => project.name.toLowerCase() === pendingDeleteProjectName.toLowerCase()) : undefined;
  const pendingDeleteProjectChats = pendingDeleteProject
    ? chats.filter((chat) => chat.project.toLowerCase() === pendingDeleteProject.name.toLowerCase())
    : [];
  const activeRunProjectName = normalizeProjectName(activeChat.project);
  const activeRunProject = projects.find((project) => project.name.toLowerCase() === activeRunProjectName.toLowerCase());
  const activeRunWorkspace = resolveWorkspaceForChatProject(activeRunProjectName, localWorkspace);
  const activeRunProjectRoot = activeRunWorkspace.enabled ? activeRunWorkspace.roots[0] : "";

  return (
    <>
      <AppShell
        activeChatId={activeChatId}
        activeRoute={activeRoute}
        activeSettingsSection={activeSettingsSection}
        appInfo={appInfo}
        appearanceMode={appearanceMode}
        authUser={authSession.user}
        chats={chats}
        defaultOpenTarget={generalSettings.defaultOpenTarget}
        defaultTerminalShell={generalSettings.terminalShell}
        desktopRuntime={isDesktopRuntime}
        locationServicesEnabled={locationServicesEnabled}
        projects={projects}
        searchOpen={searchOpen}
        sidebarOpen={sidebarOpen}
        onAppearanceModeChange={setAppearanceMode}
        onClearChatMessages={handleClearChatMessages}
        onCreateProject={openCreateProjectDialog}
        onCloseSearch={() => setSearchOpen(false)}
        onDeleteChat={handleDeleteChat}
        onDeleteProject={handleDeleteProject}
        onNewChat={handleNewChat}
        onOpenBulkDeleteChats={handleOpenBulkDeleteChats}
        onOpenProjectInTool={handleOpenProjectInTool}
        onOpenSearch={() => setSearchOpen(true)}
        onLogout={onLogout}
        onPreloadRoute={handlePreloadRoute}
        onPreloadSettingsSection={handlePreloadSettingsSection}
        onRouteChange={handleRouteChange}
        onShowAbout={() => setAboutOpen(true)}
        onCloseTerminal={() => setTerminalOpen(false)}
        onSelectChat={handleSelectChat}
        onSettingsSectionChange={handleSettingsSectionChange}
        onTerminalHeightChange={setTerminalHeight}
        onToggleTerminal={handleToggleTerminal}
        onTogglePin={handleTogglePin}
        onToggleSidebar={() => setSidebarOpen((open) => !open)}
        terminalAttachedSession={terminalAttachedSession}
        terminalHeight={terminalHeight}
        terminalOpen={terminalOpen}
        terminalWorkingDirectory={localWorkspace.enabled && localWorkspace.roots[0] ? localWorkspace.roots[0] : defaultTerminalWorkingDirectory}
      >
        <div className="route-stack">
          <div className="route-panel" data-active={activeRoute === "chat"} data-route="chat" aria-hidden={activeRoute !== "chat"}>
            {renderChatPage()}
          </div>
          {activeRoute !== "chat" ? (
            <div className="route-panel" data-active="true" data-route={activeRoute}>
              <Suspense fallback={<RouteLoading />}>
                {renderUtilityPage()}
              </Suspense>
            </div>
          ) : null}
        </div>
      </AppShell>

      <ProviderConnectionDialog
        open={providerConnectionOpen}
        settings={providerSettings}
        onActivateProvider={handleProviderConnectionChoice}
        onClose={handleCloseProviderConnectionDialog}
        onNeverShowAgain={handleNeverShowProviderConnectionDialog}
        onOpenNineRouterSettings={handleOpenProviderConnectionNineRouterSettings}
        onOpenProviderSettings={handleOpenProviderConnectionKeySettings}
      />

      <OnboardingDialog
        open={providerConnectionPromptEvaluated && !providerConnectionOpen && onboardingOpen}
        onClose={handleSkipOnboarding}
        onNeverShowAgain={handleNeverShowOnboarding}
        onOpenSettings={handleOpenOnboardingSettings}
      />

      <ProjectRunDialog
        config={activeRunProject?.runConfig}
        open={projectRunDialogOpen}
        projectName={activeRunProjectName}
        projectRoot={activeRunProjectRoot}
        onClose={() => setProjectRunDialogOpen(false)}
        onSave={handleSaveProjectRunConfig}
        onSaveAndRun={handleSaveAndRunProjectRun}
      />

      <BulkDeleteChatsDialog
        chats={chats}
        open={bulkDeleteChatsOpen}
        selectedChatIds={bulkDeleteChatIds}
        sendingChatIds={sendingChatIds}
        onClearSelection={handleClearBulkDeleteChats}
        onClose={() => {
          setBulkDeleteChatsOpen(false);
          setBulkDeleteChatIds([]);
        }}
        onConfirm={confirmBulkDeleteChats}
        onSelectAll={handleSelectAllBulkDeleteChats}
        onToggleChat={handleToggleBulkDeleteChat}
      />

      <TextInputDialog
        confirmLabel="Rename"
        description={pendingRenameChat ? `Current project: ${pendingRenameChat.project}` : undefined}
        error={renameChatError}
        label="Chat name"
        open={Boolean(pendingRenameChat)}
        placeholder="Chat name"
        title="Rename chat"
        value={renameChatTitle}
        onChange={(value) => {
          setRenameChatTitle(value);
          setRenameChatError(null);
        }}
        onClose={() => {
          setRenameChatId(null);
          setRenameChatTitle("");
          setRenameChatError(null);
        }}
        onSubmit={confirmRenameChat}
      />

      <ConfirmDialog
        confirmLabel="Delete messages"
        description="This deletes every message in the chat and syncs that cleared state to paired devices."
        icon={Trash2}
        open={Boolean(pendingClearChat)}
        title="Delete all messages?"
        tone="danger"
        onClose={() => setPendingClearChatId(null)}
        onConfirm={confirmClearChatMessages}
      >
        {pendingClearChat ? (
          <dl className="dialog-detail-list">
            <div>
              <dt>Chat</dt>
              <dd>{pendingClearChat.title}</dd>
            </div>
            <div>
              <dt>Messages</dt>
              <dd>{pendingClearChat.messages.length}</dd>
            </div>
          </dl>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        confirmLabel="Delete chat"
        description="This removes the chat from local history."
        icon={Trash2}
        open={Boolean(pendingDeleteChat)}
        title="Delete chat?"
        tone="danger"
        onClose={() => setPendingDeleteChatId(null)}
        onConfirm={confirmDeleteChat}
      >
        {pendingDeleteChat ? (
          <dl className="dialog-detail-list">
            <div>
              <dt>Chat</dt>
              <dd>{pendingDeleteChat.title}</dd>
            </div>
            <div>
              <dt>Project</dt>
              <dd>{pendingDeleteChat.project}</dd>
            </div>
            <div>
              <dt>Messages</dt>
              <dd>{pendingDeleteChat.messages.length}</dd>
            </div>
          </dl>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        confirmLabel="Delete project"
        description="This removes the project and all of its chats from local history."
        icon={Trash2}
        open={Boolean(pendingDeleteProject)}
        title="Delete project?"
        tone="danger"
        onClose={() => setPendingDeleteProjectName(null)}
        onConfirm={confirmDeleteProject}
      >
        {pendingDeleteProject ? (
          <dl className="dialog-detail-list">
            <div>
              <dt>Project</dt>
              <dd>{pendingDeleteProject.name}</dd>
            </div>
            <div>
              <dt>Chats</dt>
              <dd>{pendingDeleteProjectChats.length}</dd>
            </div>
          </dl>
        ) : null}
      </ConfirmDialog>

      <NoticeDialog
        description={noticeDialog?.description}
        open={Boolean(noticeDialog)}
        title={noticeDialog?.title ?? ""}
        onClose={() => setNoticeDialog(null)}
      />

      <NoticeDialog
        buttonLabel="Close"
        description="Desktop agent workspace"
        icon={Info}
        open={aboutOpen}
        title={appInfo.name}
        onClose={() => setAboutOpen(false)}
      >
        <dl className="dialog-detail-list">
          <div>
            <dt>Version</dt>
            <dd>{appInfo.version}</dd>
          </div>
          <div>
            <dt>Phase</dt>
            <dd>{appInfo.phase}</dd>
          </div>
          <div>
            <dt>Runtime</dt>
            <dd>{appInfo.runtime}</dd>
          </div>
          <div>
            <dt>Platform</dt>
            <dd>{formatHostPlatformLabel(appInfo.platform, appInfo.arch)}</dd>
          </div>
        </dl>
      </NoticeDialog>
    </>
  );
}
