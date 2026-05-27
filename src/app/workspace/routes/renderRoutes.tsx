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
import type { AppAppearanceSettings, AppPersonalizationSettings, AppearanceMode, ProviderSettings, WebSearchSettings } from "../../../types/settings";
import type { ToolRegistrySettings } from "../../../types/tools";
import type { SettingsSectionId } from "../../../pages/settings/types";
import type { DiscordInteractionEvent } from "../../tauriClient";
import type { ActiveGeneration, ApprovedPlanExecutionContext, AssistantToolResponse, ComposerDraftRestoreRequest, DiscordReplyTarget, DiscordStreamUpdate, QueuedChatSend, SessionApprovalDecisionMap, SessionApprovalDecisionsByWorkspace, StartSendMessageOptions } from "../WorkspaceApp";
import type { WorkspaceRuntimeDeps } from "../runtimeTypes";

const EMPTY_CHAT_MESSAGES: ChatMessage[] = [];
const EMPTY_STRING_ARRAY: string[] = [];

export function renderUtilityPage(deps: WorkspaceRuntimeDeps) {
  const { activeChat, activeRoute, activeSettingsSection, appearanceMode, appearanceSettings, appInfo, AppsPage, automationDraft, automationMcpServers, automationSkillRegistry, automationState, discordBridgeSettings, generalSettings, handleAcknowledgeAutomationRun, handleCreateAutomationTask, handleDeleteAutomationTask, handleDuplicateAutomationTask, handleLocalWorkspaceChange, handleOpenAutomationRunChat, handlePauseAllAutomationTasks, handlePauseAutomationTask, handleProviderConnectionChoice, handleRunAutomationTask, handleSimulateAutomationTask, handleSnoozeAutomationRun, handleSubscriptionSandboxUninstalled, handleUpdateAutomationTask, localWorkspace, locationServicesEnabled, personalizationSettings, projects, providerSettings, setActiveRoute, setActiveSettingsSection, setAppearanceMode, setAppearanceSettings, setAutomationDraft, setDiscordBridgeSettings, setGeneralSettings, setPersonalizationSettings, setProviderSettings, SettingsPage, TasksPage, WeatherRadarPage } = deps;

    if (activeRoute === "apps") {
      return (
        <AppsPage
          locationServicesEnabled={locationServicesEnabled}
          onBackToChat={() => setActiveRoute("chat")}
          onOpenGithubSettings={() => {
            setActiveSettingsSection("github");
            setActiveRoute("settings");
          }}
          onOpenGoogleSettings={() => {
            setActiveSettingsSection("google");
            setActiveRoute("settings");
          }}
          onOpenKeysSettings={() => {
            setActiveSettingsSection("keys");
            setActiveRoute("settings");
          }}
          onOpenRadar={() => handleRouteChange("radar")}
        />
      );
    }

    if (activeRoute === "tasks") {
      return (
        <TasksPage
          activeProjectName={activeChat.project}
          discordSettings={discordBridgeSettings}
          draft={automationDraft}
          globalPaused={automationState.globalPaused}
          mcpServers={automationMcpServers ?? []}
          projects={projects}
          runs={automationState.runs}
          skillRegistry={automationSkillRegistry}
          tasks={automationState.tasks}
          onAcknowledgeRun={handleAcknowledgeAutomationRun}
          onBackToChat={() => setActiveRoute("chat")}
          onClearDraft={() => setAutomationDraft(null)}
          onCreateTask={handleCreateAutomationTask}
          onDeleteTask={handleDeleteAutomationTask}
          onDuplicateTask={handleDuplicateAutomationTask}
          onOpenRunChat={handleOpenAutomationRunChat}
          onPauseAll={handlePauseAllAutomationTasks}
          onPauseTask={handlePauseAutomationTask}
          providerSettings={providerSettings}
          onRunTask={handleRunAutomationTask}
          onSimulateTask={handleSimulateAutomationTask}
          onSnoozeRun={handleSnoozeAutomationRun}
          onUpdateTask={handleUpdateAutomationTask}
        />
      );
    }

    if (activeRoute === "radar") {
      if (!locationServicesEnabled) {
        return null;
      }

      return (
        <WeatherRadarPage
          onBackToChat={() => setActiveRoute("chat")}
          onOpenMapboxSettings={() => {
            setActiveSettingsSection("weatherSources");
            setActiveRoute("settings");
          }}
        />
      );
    }

    if (activeRoute === "settings") {
      return (
        <SettingsPage
          activeSection={activeSettingsSection}
          appInfo={appInfo}
          appearanceMode={appearanceMode}
          appearanceSettings={appearanceSettings}
          discordBridge={discordBridgeSettings}
          generalSettings={generalSettings}
          localWorkspace={localWorkspace}
          personalization={personalizationSettings}
          projects={projects}
          settings={providerSettings}
          onActiveSectionChange={setActiveSettingsSection}
          onAppearanceModeChange={setAppearanceMode}
          onAppearanceSettingsChange={setAppearanceSettings}
          onDiscordBridgeChange={setDiscordBridgeSettings}
          onGeneralSettingsChange={setGeneralSettings}
          onLocalWorkspaceChange={handleLocalWorkspaceChange}
          onPersonalizationChange={setPersonalizationSettings}
          onActivateProvider={handleProviderConnectionChoice}
          onSettingsChange={setProviderSettings}
          onSubscriptionSandboxUninstalled={handleSubscriptionSandboxUninstalled}
        />
      );
    }

    return null;
  }

export function renderChatPage(deps: WorkspaceRuntimeDeps) {
  const { activeChat, activeChatProviderSettings, activeRoute, activeToolAwareProviderSettings, agentRuns, appInfo, browserPreviewTarget, ChatPage, chats, composerDraftToRestore, contextWindow, generalSettings, getModelProvider, getProviderApiKey, handleActiveChatModelChange, handleAddAutomation, handleArchiveActiveChat, handleClearProjectGoal, handleCompleteProjectGoal, handleComposerDraftChange, handleCopyChatDeeplink, handleCopyChatMarkdown, handleCopySessionId, handleCopyWorkingDirectory, handleCreateProjectGoal, handleDeleteQueuedMessage, handleEditUserMessageAndRegenerate, handleForkActiveChatLocal, handleForkChatFromMessage, handleForkActiveChatWorktree, handleHoldQueuedMessage, handleLocalWorkspaceChange, handleMessageFeedback, handleNewChat, handleOpenActiveChatInNewWindow, handleOpenProjectInTool, handleOpenProjectRun, handleOpenRenameChat, handlePauseProjectGoal, handleRegenerateResponse, handleRequestPlanRevision, handleResolveToolApproval, handleResumeProjectGoal, handleSelectChat, handleSelectProject, handleSendMessage, handleSteerQueuedMessage, handleStopGeneration, handleSubmitPlanningInput, handleTogglePin, handleToggleTerminal, handleUpdateProjectGoal, isChatSending, lastContextCompaction, lastProviderContextUsage, loadingChatIds, localWorkspace, modelContextWindows, openCreateProjectDialog, projects, queuedChatSends, setBrowserPreviewTarget, setComposerDraftToRestore, setProviderSettings, terminalOpen, toolSettings } = deps;
  const activeQueuedSends = queuedChatSends.filter((queuedSend) => queuedSend.chatId === activeChat.id);
  const activeQueuedMessages = activeQueuedSends.length === 0 ? EMPTY_CHAT_MESSAGES : activeQueuedSends.map((queuedSend) => {
    const existingMessage = activeChat.messages.find((message) => message.id === queuedSend.userMessageId);

    if (existingMessage) {
      return existingMessage;
    }

    return {
      attachments: queuedSend.input.attachments,
      content: queuedSend.input.content,
      createdAt: activeChat.updatedAt,
      id: queuedSend.userMessageId,
      mode: queuedSend.input.mode,
      researchReferences: (queuedSend.input.referencedChatIds ?? []).flatMap((chatId) => {
        const referencedChat = chats.find((candidate) => candidate.id === chatId);

        return referencedChat
          ? [
              {
                chatId: referencedChat.id,
                project: referencedChat.project,
                title: referencedChat.title,
                updatedAt: referencedChat.updatedAt,
              },
            ]
          : [];
      }),
      role: "user",
      status: "queued",
    } satisfies ChatMessage;
  });

    return (
      <ChatPage
        active={activeRoute === "chat"}
        agentRuns={agentRuns}
        appInfo={appInfo}
        chat={activeChat}
        chatLoading={activeChat.messagesLoaded === false || loadingChatIds.includes(activeChat.id)}
        chats={chats}
        browserPreviewEnabled={toolSettings.browserPreview}
        browserPreviewRequestId={browserPreviewTarget?.id ?? 0}
        browserPreviewUrl={browserPreviewTarget?.url ?? null}
        codeReviewBehavior={generalSettings.codeReviewBehavior}
        composerDraft={activeChat.composerDraft ?? null}
        composerRestoreDraft={composerDraftToRestore?.draft ?? null}
        composerRestoreDraftId={composerDraftToRestore?.id ?? null}
        contextWindowSource={contextWindow.source}
        contextWindowTokens={contextWindow.tokens}
        defaultOpenTarget={generalSettings.defaultOpenTarget}
        dictationDictionary={generalSettings.dictation.dictionary}
        dictationHoldHotkey={generalSettings.dictation.holdHotkey}
        dictationToggleHotkey={generalSettings.dictation.toggleHotkey}
        followUpBehavior={generalSettings.followUpBehavior}
        hasApiKey={!getModelProvider(activeChatProviderSettings.provider).requiresApiKey || Boolean(getProviderApiKey(activeChatProviderSettings).trim())}
        isSending={isChatSending(activeChat.id)}
        lastContextCompaction={lastContextCompaction?.chatId === activeChat.id && lastContextCompaction.contextWindowTokens === contextWindow.tokens ? lastContextCompaction : null}
        localWorkspace={localWorkspace}
        model={activeChatProviderSettings.model}
        modelContextWindows={modelContextWindows}
        onComposerDraftApplied={() => setComposerDraftToRestore(null)}
        onComposerDraftChange={handleComposerDraftChange}
        onAddAutomation={handleAddAutomation}
        onArchiveChat={handleArchiveActiveChat}
        onCopyChatDeeplink={() => void handleCopyChatDeeplink()}
        onCopyChatMarkdown={() => void handleCopyChatMarkdown()}
        onCopySessionId={() => void handleCopySessionId()}
        onCopyWorkingDirectory={() => void handleCopyWorkingDirectory()}
        onForkChatLocal={handleForkActiveChatLocal}
        onForkChatFromMessage={handleForkChatFromMessage}
        onForkChatWorktree={handleForkActiveChatWorktree}
        onMessageFeedback={handleMessageFeedback}
        onOpenProjectRun={handleOpenProjectRun}
        onOpenProjectTool={(target) => handleOpenProjectInTool(activeChat.project, target)}
        onLocalWorkspaceChange={handleLocalWorkspaceChange}
        onModelChange={handleActiveChatModelChange}
        onProjectGoalClear={handleClearProjectGoal}
        onProjectGoalComplete={handleCompleteProjectGoal}
        onProjectGoalCreate={handleCreateProjectGoal}
        onProjectGoalPause={handlePauseProjectGoal}
        onProjectGoalResume={handleResumeProjectGoal}
        onProjectGoalUpdate={handleUpdateProjectGoal}
        onEditUserMessage={handleEditUserMessageAndRegenerate}
        onRequestPlanRevision={handleRequestPlanRevision}
        onRegenerateResponse={handleRegenerateResponse}
        onResolveToolApproval={handleResolveToolApproval}
        onSendMessage={handleSendMessage}
        onDeleteQueuedMessage={handleDeleteQueuedMessage}
        onHoldQueuedMessage={handleHoldQueuedMessage}
        onSteerQueuedMessage={handleSteerQueuedMessage}
        onStopGeneration={handleStopGeneration}
        onSubmitPlanningInput={handleSubmitPlanningInput}
        lastProviderContextUsage={lastProviderContextUsage?.chatId === activeChat.id ? lastProviderContextUsage.usage : null}
        onCreateProject={openCreateProjectDialog}
        providerSettings={activeToolAwareProviderSettings}
        projectGoal={projects.find((project) => project.name.toLowerCase() === activeChat.project.toLowerCase())?.projectGoal}
        projects={projects}
        queuedMessageCount={activeQueuedSends.length}
        queuedMessageDetails={activeQueuedMessages}
        heldQueuedMessageIds={activeQueuedSends.length === 0 ? EMPTY_STRING_ARRAY : activeQueuedSends.filter((queuedSend) => queuedSend.held).map((queuedSend) => queuedSend.userMessageId)}
        onSelectProject={handleSelectProject}
        onImageGenerationChange={(enabled) => setProviderSettings((settings) => ({ ...settings, tools: { ...settings.tools, imageGeneration: enabled } }))}
        onThinkingChange={(nextThinking) => setProviderSettings((settings) => ({ ...settings, thinking: nextThinking }))}
        onWebSearchChange={(nextWebSearch) => setProviderSettings((settings) => ({ ...settings, webSearch: nextWebSearch }))}
        requireCtrlEnterForLongPrompts={generalSettings.requireCtrlEnterForLongPrompts}
        thinking={activeChatProviderSettings.thinking}
        webSearch={activeChatProviderSettings.webSearch}
        onTogglePin={() => activeChat && handleTogglePin(activeChat.id)}
        onToggleTerminal={handleToggleTerminal}
        onBrowserPreviewClose={() => setBrowserPreviewTarget(null)}
        onOpenChatInNewWindow={handleOpenActiveChatInNewWindow}
        onOpenSideChat={() => handleNewChat(activeChat.project)}
        onRenameChat={() => handleOpenRenameChat(activeChat)}
        onSelectChat={handleSelectChat}
        terminalEnabled={toolSettings.terminal}
        terminalOpen={terminalOpen}
      />
    );
  }

export function handleSkipOnboarding(deps: WorkspaceRuntimeDeps) {
  const { setOnboardingOpen } = deps;

    setOnboardingOpen(false);
  }

export function handleNeverShowOnboarding(deps: WorkspaceRuntimeDeps) {
  const { ONBOARDING_NEVER_SHOW_KEY, savePersistentString, setOnboardingOpen } = deps;

    savePersistentString(ONBOARDING_NEVER_SHOW_KEY, "true");
    setOnboardingOpen(false);
  }

export function handleOpenOnboardingSettings(deps: WorkspaceRuntimeDeps) {
  const { setActiveRoute, setActiveSettingsSection, setOnboardingOpen } = deps;

    setActiveSettingsSection("model");
    setActiveRoute("settings");
    setOnboardingOpen(false);
  }

export function handleOpenProviderConnectionNineRouterSettings(deps: WorkspaceRuntimeDeps) {
  const { setActiveRoute, setActiveSettingsSection, setProviderConnectionOpen } = deps;

    setActiveSettingsSection("nineRouter");
    setActiveRoute("settings");
    setProviderConnectionOpen(false);
  }

export function handleOpenProviderConnectionKeySettings(deps: WorkspaceRuntimeDeps) {
  const { setActiveRoute, setActiveSettingsSection, setProviderConnectionOpen } = deps;

    setActiveSettingsSection("model");
    setActiveRoute("settings");
    setProviderConnectionOpen(false);
  }

export function handleRouteChange(deps: WorkspaceRuntimeDeps, route: PrimaryRoute) {
  const { locationServicesEnabled, setActiveRoute, setNoticeDialog } = deps;

    if (route === "radar" && !locationServicesEnabled) {
      setActiveRoute("chat");
      setNoticeDialog({
        description: "Weather, radar, Mapbox weather settings, and location-based refreshes stay hidden while location services are off. Turn them back on in Settings > Weather & Maps.",
        title: "Location services are off",
      });
      return;
    }

    setActiveRoute(route);
  }

export function handleSettingsSectionChange(deps: WorkspaceRuntimeDeps, section: SettingsSectionId) {
  const { resolveSettingsNavSection, setActiveSettingsSection } = deps;

    setActiveSettingsSection(resolveSettingsNavSection(section));
  }
