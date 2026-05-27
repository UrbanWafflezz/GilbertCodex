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
import { NINE_ROUTER_ALWAYS_FREE_MODEL, NINE_ROUTER_SMART_SAVER_MODEL } from "../../../lib/models";
import { NINE_ROUTER_PROVIDER_ID } from "../../../services/nineRouterClient";
import { getBackgroundTerminalSessions } from "../../../lib/terminalSessions";

export function handleNewChat(deps: WorkspaceRuntimeDeps, project: string) {
  const { activeChat, activeChatIdRef, createEmptyChat, DEFAULT_PROJECT, generalSettings, isDiscardableEmptyChat, normalizeProjectName, pendingChatsRef, pruneEmptyChats, restoreProjectLocalWorkspace, sameProjectName, setActiveChatId, setActiveRoute, setChats, setSearchOpen, sortChatsByUpdatedAt, touchProject } = deps;

    const projectName = normalizeProjectName(project ?? (generalSettings?.defaultProjectlessChat ? DEFAULT_PROJECT : activeChat.project));
    const currentActiveChat = pendingChatsRef.current.find((chat) => chat.id === activeChatIdRef.current && !chat.archived);
    const nextChat = currentActiveChat && isDiscardableEmptyChat(currentActiveChat) && sameProjectName(currentActiveChat.project, projectName)
      ? currentActiveChat
      : createEmptyChat(projectName);

    restoreProjectLocalWorkspace(projectName);
    const existingChats = pendingChatsRef.current.some((chat) => chat.id === nextChat.id) ? pendingChatsRef.current : [nextChat, ...pendingChatsRef.current];
    const nextChats = sortChatsByUpdatedAt(pruneEmptyChats(existingChats, nextChat.id));
    pendingChatsRef.current = nextChats;
    setChats(nextChats);
    touchProject(projectName);
    setActiveChatId(nextChat.id);
    setActiveRoute("chat");
    setSearchOpen(false);
  }

export function handleSelectChat(deps: WorkspaceRuntimeDeps, chatId: string) {
  const { activeChatIdRef, activeRoute, pendingChatsRef, pruneEmptyChats, restoreProjectLocalWorkspace, setActiveChatId, setActiveRoute, setChats, setSearchOpen } = deps;

    const selectedChat = pendingChatsRef.current.find((chat) => chat.id === chatId);

    if (!selectedChat) {
      setSearchOpen(false);
      return;
    }

    if (chatId === activeChatIdRef.current && activeRoute === "chat") {
      setSearchOpen(false);
      return;
    }

    activeChatIdRef.current = chatId;
    setActiveChatId(chatId);
    setActiveRoute("chat");
    setSearchOpen(false);

    runAfterNextPaint(() => {
      if (activeChatIdRef.current !== chatId) {
        return;
      }

      restoreProjectLocalWorkspace(selectedChat.project);

      const nextChats = pruneEmptyChats(pendingChatsRef.current, chatId);
      if (nextChats.length !== pendingChatsRef.current.length) {
        pendingChatsRef.current = nextChats;
        setChats(nextChats);
      }
    });
  }

export function handleActiveChatModelChange(deps: WorkspaceRuntimeDeps, nextModel: string, nextProvider: ProviderSettings["provider"]) {
  const { activeChatIdRef, activeChatProviderSettings, isModelProviderId, setChats, setProviderSettings } = deps;

    const model = nextModel.trim();
    const provider = isModelProviderId(nextProvider) ? nextProvider : activeChatProviderSettings.provider;
    const activeChatId = activeChatIdRef.current;

    if (!model) {
      return;
    }

    setProviderSettings((settings) => {
      const disabledValues = (settings.disabledModels[provider] ?? []).filter((value) => value !== model);
      const disabledModels = {
        ...settings.disabledModels,
        [provider]: disabledValues,
      };

      if (disabledValues.length === 0) {
        delete disabledModels[provider];
      }

      return {
        ...settings,
        disabledModels,
        model,
        provider,
        providerModels: {
          ...settings.providerModels,
          [settings.provider]: settings.model,
          [provider]: model,
        },
        subscriptionOptimization: getSubscriptionOptimizationForSelectedModel(settings, provider, model),
      };
    });

    setChats((currentChats) => {
      let changed = false;
      const nextChats = currentChats.map((chat) => {
        if (chat.id !== activeChatId) {
          return chat;
        }

        if (chat.model === model && chat.provider === provider) {
          return chat;
        }

        changed = true;
        return {
          ...chat,
          model,
          provider,
        };
      });

      return changed ? nextChats : currentChats;
    });
}

export function handleProviderConnectionChoice(deps: WorkspaceRuntimeDeps, nextProvider: ProviderSettings["provider"], nextModel: string) {
  const { activeChatIdRef, getDefaultBaseUrlForProvider, isModelProviderId, providerSettings, setChats, setProviderSettings } = deps;

    const model = nextModel.trim();
    const provider = isModelProviderId(nextProvider) ? nextProvider : providerSettings.provider;
    const activeChatId = activeChatIdRef.current;

    if (!model) {
      return;
    }

    setProviderSettings((settings) => {
      const disabledValues = (settings.disabledModels[provider] ?? []).filter((value) => value !== model);
      const disabledModels = {
        ...settings.disabledModels,
        [provider]: disabledValues,
      };

      if (disabledValues.length === 0) {
        delete disabledModels[provider];
      }

      return {
        ...settings,
        baseUrls: {
          ...settings.baseUrls,
          [provider]: settings.baseUrls[provider] || getDefaultBaseUrlForProvider(provider),
        },
        disabledModels,
        model,
        provider,
        providerModels: {
          ...settings.providerModels,
          [settings.provider]: settings.model,
          [provider]: model,
        },
        subscriptionOptimization: getSubscriptionOptimizationForSelectedModel(settings, provider, model),
      };
    });

    setChats((currentChats) => {
      let changed = false;
      const nextChats = currentChats.map((chat) => {
        if (chat.id !== activeChatId) {
          return chat;
        }

        if (chat.model === model && chat.provider === provider) {
          return chat;
        }

        changed = true;
        return {
          ...chat,
          model,
          provider,
        };
      });

    return changed ? nextChats : currentChats;
    });
  }

function getSubscriptionOptimizationForSelectedModel(settings: ProviderSettings, provider: ProviderSettings["provider"], model: string) {
  if (provider !== NINE_ROUTER_PROVIDER_ID) {
    return settings.subscriptionOptimization;
  }

  if (model === NINE_ROUTER_SMART_SAVER_MODEL || model === NINE_ROUTER_ALWAYS_FREE_MODEL) {
    return {
      ...settings.subscriptionOptimization,
      fallbackMode: "always-free" as const,
    };
  }

  return settings.subscriptionOptimization;
}

export function handleSelectProject(deps: WorkspaceRuntimeDeps, project: string) {
  const { bindActiveChatToProject } = deps;

    bindActiveChatToProject(project);
  }

export async function openCreateProjectDialog(deps: WorkspaceRuntimeDeps, options: CreateProjectOptions): Promise<string | null> {
  const { createProjectFromFolder, localWorkspaceRef, pickComputerFolder, readErrorMessage, setNoticeDialog, setSearchOpen } = deps;

    setSearchOpen(false);

    try {
      const selectedPath = await pickComputerFolder(localWorkspaceRef.current.roots[0]);

      if (!selectedPath) {
        return null;
      }

      return createProjectFromFolder(selectedPath, options);
    } catch (error) {
      setNoticeDialog({
        description: readErrorMessage(error, "Choose a readable folder from your computer."),
        title: "Could not add project folder",
      });
      return null;
    }
  }

export function createProjectFromFolder(deps: WorkspaceRuntimeDeps, folderPath: string, options: { bindToActiveChat?: boolean; projectNameHint?: string }): string | null {
  const { bindActiveChatToProject, buildComputerFileIndex, createId, createProjectBaseName, createUniqueProjectName, localWorkspaceRef, normalizeSelectedProjectPath, projectNameFromPath, projectsRef, readErrorMessage, rememberProjectMapSnapshot, restoreProjectLocalWorkspace, samePathSet, saveWorkspaceForProject, setLocalWorkspace, setNoticeDialog, setProjects, sortProjectsByUpdatedAt } = deps;

    const root = normalizeSelectedProjectPath(folderPath);
    const shouldBindToActiveChat = options.bindToActiveChat !== false;

    if (!root) {
      setNoticeDialog({
        description: "Choose a readable folder from your computer.",
        title: "Could not add project folder",
      });
      return null;
    }

    const existingProject = projectsRef.current.find((project) => samePathSet(project.localWorkspace?.roots ?? [], [root]));

    if (existingProject) {
      if (shouldBindToActiveChat) {
        bindActiveChatToProject(existingProject.name, existingProject.localWorkspace);
      } else if (existingProject.localWorkspace) {
        restoreProjectLocalWorkspace(existingProject.name, existingProject.localWorkspace);
      }

      return existingProject.name;
    }

    const now = new Date().toISOString();
    const baseProjectName = createProjectBaseName(options.projectNameHint ?? projectNameFromPath(root));
    const reusableProject = projectsRef.current.find(
      (project) => project.name.toLowerCase() === baseProjectName.toLowerCase() && (project.localWorkspace?.roots.length ?? 0) === 0,
    );
    const projectName = reusableProject?.name ?? createUniqueProjectName(baseProjectName, projectsRef.current);
    const indexingWorkspace: LocalWorkspaceSettings = {
      ...localWorkspaceRef.current,
      enabled: true,
      indexReason: "Indexing project folder",
      indexStatus: "indexing",
      indexSummary: undefined,
      indexUpdatedAt: undefined,
      lastError: undefined,
      roots: [root],
      scope: "selected-folder",
    };
    const nextProject: ProjectSummary = reusableProject
      ? {
          ...reusableProject,
          localWorkspace: indexingWorkspace,
          name: projectName,
          updatedAt: now,
        }
      : {
          createdAt: now,
          id: createId("project"),
          localWorkspace: indexingWorkspace,
          name: projectName,
          updatedAt: now,
        };
    localWorkspaceRef.current = indexingWorkspace;
    setLocalWorkspace(indexingWorkspace);
    const nextProjects = sortProjectsByUpdatedAt(
      reusableProject ? projectsRef.current.map((project) => (project.id === reusableProject.id ? nextProject : project)) : [nextProject, ...projectsRef.current],
    );
    projectsRef.current = nextProjects;
    setProjects(nextProjects);

    if (shouldBindToActiveChat) {
      bindActiveChatToProject(projectName, indexingWorkspace);
    }

    window.setTimeout(() => {
      void buildComputerFileIndex([root], "selected-folder")
        .then((summary) => {
          const indexedWorkspace: LocalWorkspaceSettings = {
            ...indexingWorkspace,
            indexReason: undefined,
            indexStatus: "idle",
            indexSummary: summary,
            indexUpdatedAt: new Date().toISOString(),
            lastError: undefined,
          };

          saveWorkspaceForProject(projectName, indexedWorkspace);
          rememberProjectMapSnapshot(projectName, indexedWorkspace);
          setLocalWorkspace((currentWorkspace) => {
            const nextWorkspace = samePathSet(currentWorkspace.roots, [root]) ? indexedWorkspace : currentWorkspace;
            localWorkspaceRef.current = nextWorkspace;
            return nextWorkspace;
          });
        })
        .catch((error) => {
          const message = readErrorMessage(error, "Could not index this project folder.");
          const erroredWorkspace: LocalWorkspaceSettings = {
            ...indexingWorkspace,
            indexReason: undefined,
            indexStatus: "error",
            lastError: message,
          };

          saveWorkspaceForProject(projectName, erroredWorkspace);
          rememberProjectMapSnapshot(projectName, erroredWorkspace);
          setLocalWorkspace((currentWorkspace) => {
            const nextWorkspace = samePathSet(currentWorkspace.roots, [root]) ? erroredWorkspace : currentWorkspace;
            localWorkspaceRef.current = nextWorkspace;
            return nextWorkspace;
          });
        });
    }, 0);

    return projectName;
  }

export function handleLocalWorkspaceChange(deps: WorkspaceRuntimeDeps, nextWorkspace: LocalWorkspaceSettings) {
  const { activeChat, bindActiveChatToProject, createProjectFromFolder, isNoProjectName, localWorkspaceRef, normalizeProjectName, normalizeSelectedProjectPath, projectsRef, samePathSet, saveWorkspaceForProject, setLocalWorkspace } = deps;

    localWorkspaceRef.current = nextWorkspace;
    setLocalWorkspace(nextWorkspace);

    const activeProjectName = normalizeProjectName(activeChat.project);

    if (isNoProjectName(activeProjectName) && nextWorkspace.enabled && nextWorkspace.scope !== "full-computer" && nextWorkspace.roots[0]) {
      const root = normalizeSelectedProjectPath(nextWorkspace.roots[0]);

      if (root) {
        const projectWorkspace: LocalWorkspaceSettings = {
          ...nextWorkspace,
          roots: [root],
          scope: "selected-folder",
        };
        const existingProject = projectsRef.current.find((project) => samePathSet(project.localWorkspace?.roots ?? [], [root]));

        if (existingProject) {
          saveWorkspaceForProject(existingProject.name, projectWorkspace);
          bindActiveChatToProject(existingProject.name, projectWorkspace);
          return;
        }

        createProjectFromFolder(root);
        return;
      }
    }

    saveWorkspaceForProject(activeProjectName, nextWorkspace);
  }

export function bindActiveChatToProject(deps: WorkspaceRuntimeDeps, project: string, workspaceOverride: LocalWorkspaceSettings) {
  const { activeChatIdRef, createEmptyChat, createNoProjectWorkspace, isDiscardableEmptyChat, isNoProjectName, localWorkspaceRef, normalizeProjectName, pendingChatsRef, pruneEmptyChats, resolveWorkspaceForChatProject, sameLocalWorkspaceSettings, setActiveChatId, setActiveRoute, setChats, setLocalWorkspace, setSearchOpen, sortChatsByUpdatedAt } = deps;

    const projectName = normalizeProjectName(project);
    const now = new Date().toISOString();
    const currentActiveChat = pendingChatsRef.current.find((chat) => chat.id === activeChatIdRef.current && !chat.archived);
    const currentProjectName = normalizeProjectName(currentActiveChat?.project);
    const sameProjectSelected = currentActiveChat && currentProjectName.toLowerCase() === projectName.toLowerCase();

    if (sameProjectSelected) {
      const projectWorkspace = isNoProjectName(projectName)
        ? createNoProjectWorkspace(localWorkspaceRef.current)
        : workspaceOverride ?? resolveWorkspaceForChatProject(projectName, localWorkspaceRef.current);
      if (!sameLocalWorkspaceSettings(projectWorkspace, localWorkspaceRef.current)) {
        localWorkspaceRef.current = projectWorkspace;
        setLocalWorkspace(projectWorkspace);
      }
      setActiveRoute("chat");
      setSearchOpen(false);
      return;
    }

    const shouldStartFreshProjectChat =
      currentActiveChat &&
      !isDiscardableEmptyChat(currentActiveChat) &&
      currentProjectName.toLowerCase() !== projectName.toLowerCase();
    let targetChatId = shouldStartFreshProjectChat ? "" : activeChatIdRef.current;
    let updatedExistingChat = false;
    let nextChats = pendingChatsRef.current.map((chat) => {
      if (chat.id !== targetChatId || chat.archived) {
        return chat;
      }

      updatedExistingChat = true;
      return {
        ...chat,
        project: projectName,
        updatedAt: now,
      };
    });

    if (!updatedExistingChat) {
      const nextChat = createEmptyChat(projectName);
      targetChatId = nextChat.id;
      nextChats = [nextChat, ...nextChats];
    }

    nextChats = sortChatsByUpdatedAt(pruneEmptyChats(nextChats, targetChatId));
    pendingChatsRef.current = nextChats;
    activeChatIdRef.current = targetChatId;
    setChats(nextChats);
    setActiveChatId(targetChatId);

    if (isNoProjectName(projectName)) {
      const noProjectWorkspace = createNoProjectWorkspace(localWorkspaceRef.current);
      if (!sameLocalWorkspaceSettings(noProjectWorkspace, localWorkspaceRef.current)) {
        localWorkspaceRef.current = noProjectWorkspace;
        setLocalWorkspace(noProjectWorkspace);
      }
    } else {
      const projectWorkspace = workspaceOverride ?? resolveWorkspaceForChatProject(projectName, localWorkspaceRef.current);
      if (!sameLocalWorkspaceSettings(projectWorkspace, localWorkspaceRef.current)) {
        localWorkspaceRef.current = projectWorkspace;
        setLocalWorkspace(projectWorkspace);
      }
    }

    setActiveRoute("chat");
    setSearchOpen(false);
  }

export function handleToggleTerminal(deps: WorkspaceRuntimeDeps) {
  const { setTerminalOpen, toolSettings } = deps;

    if (!toolSettings.terminal) {
      return;
    }

    setTerminalOpen((open) => !open);
  }

export function attachLiveTerminalSession(deps: WorkspaceRuntimeDeps, toolCalls: ChatToolCall[]) {
  const { setTerminalAttachedSession, setTerminalOpen, terminalAttachedSession } = deps;

    const liveTerminalCall = [...(toolCalls ?? [])].reverse().find((toolCall) => toolCall.terminal?.live && toolCall.terminal.sessionId);
    const terminal = liveTerminalCall?.terminal;

    if (!liveTerminalCall || !terminal?.sessionId) {
      return;
    }

    if (terminalAttachedSession?.sessionId === terminal.sessionId) {
      setTerminalOpen(true);
      return;
    }

    const backgroundSession = getBackgroundTerminalSessions().find((session) => session.sessionId === terminal.sessionId);

    setTerminalAttachedSession({
      command: terminal.command ?? liveTerminalCall.label,
      initialOutput: backgroundSession?.outputPreview ?? liveTerminalCall.output,
      sessionId: terminal.sessionId,
      shell: terminal.shell,
      workingDirectory: terminal.workingDirectory,
    });
    setTerminalOpen(true);
  }

export function handleTogglePin(deps: WorkspaceRuntimeDeps, chatId: string) {
  const { setChats, sortChatsByUpdatedAt } = deps;

    setChats((currentChats) =>
      sortChatsByUpdatedAt(
        currentChats.map((chat) =>
          chat.id === chatId
            ? {
                ...chat,
                pinned: !chat.pinned,
                updatedAt: new Date().toISOString(),
              }
            : chat,
        ),
      ),
    );
  }

export function handleOpenRenameChat(deps: WorkspaceRuntimeDeps, chat: ChatSummary) {
  const { setRenameChatError, setRenameChatId, setRenameChatTitle } = deps;

    setRenameChatId(chat.id);
    setRenameChatTitle(chat.title || "New chat");
    setRenameChatError(null);
  }

export function confirmRenameChat(deps: WorkspaceRuntimeDeps) {
  const { renameChatId, renameChatTitle, setChats, setRenameChatError, setRenameChatId, setRenameChatTitle, sortChatsByUpdatedAt } = deps;

    if (!renameChatId) {
      return;
    }

    const nextTitle = renameChatTitle.trim();

    if (!nextTitle) {
      setRenameChatError("Enter a chat name.");
      return;
    }

    setChats((currentChats) =>
      sortChatsByUpdatedAt(
        currentChats.map((chat) =>
          chat.id === renameChatId
            ? {
                ...chat,
                title: nextTitle,
                updatedAt: new Date().toISOString(),
              }
            : chat,
        ),
      ),
    );
    setRenameChatId(null);
    setRenameChatTitle("");
    setRenameChatError(null);
  }

export function handleArchiveActiveChat(deps: WorkspaceRuntimeDeps) {
  const { activeChat, createEmptyChat, DEFAULT_PROJECT, isChatSending, pendingChatsRef, setActiveChatId, setActiveRoute, setChats, setNoticeDialog, sortChatsByUpdatedAt, updateQueuedChatSends } = deps;

    const chatToArchive = pendingChatsRef.current.find((chat) => chat.id === activeChat.id);

    if (!chatToArchive) {
      return;
    }

    if (isChatSending(chatToArchive.id)) {
      setNoticeDialog({
        description: "Wait for the current response to finish, then archive the chat.",
        title: "Chat is still responding",
      });
      return;
    }

    const now = new Date().toISOString();
    let nextChats = sortChatsByUpdatedAt(
      pendingChatsRef.current.map((chat) =>
        chat.id === chatToArchive.id
          ? {
              ...chat,
              archived: true,
              updatedAt: now,
            }
          : chat,
      ),
    );
    const nextActiveChat = nextChats.find((chat) => !chat.archived) ?? createEmptyChat(DEFAULT_PROJECT);

    if (!nextChats.some((chat) => chat.id === nextActiveChat.id)) {
      nextChats = sortChatsByUpdatedAt([nextActiveChat, ...nextChats]);
    }

    pendingChatsRef.current = nextChats;
    setChats(nextChats);
    updateQueuedChatSends((currentQueue) => currentQueue.filter((queuedSend) => queuedSend.chatId !== chatToArchive.id));
    setActiveChatId(nextActiveChat.id);
    setActiveRoute("chat");
  }

export async function handleCopyWorkingDirectory(deps: WorkspaceRuntimeDeps) {
  const { copyLabeledTextToClipboard, getActiveWorkingDirectory, setNoticeDialog } = deps;

    const workingDirectory = getActiveWorkingDirectory();

    if (!workingDirectory) {
      setNoticeDialog({
        description: "Choose a local project folder or enable a workspace before copying a working directory.",
        title: "No working directory selected",
      });
      return;
    }

    await copyLabeledTextToClipboard("Working directory", workingDirectory);
  }

export async function handleCopySessionId(deps: WorkspaceRuntimeDeps) {
  const { activeChat, copyLabeledTextToClipboard } = deps;

    await copyLabeledTextToClipboard("Session ID", activeChat.id);
  }

export async function handleCopyChatDeeplink(deps: WorkspaceRuntimeDeps) {
  const { activeChat, copyLabeledTextToClipboard, createChatDeeplink } = deps;

    await copyLabeledTextToClipboard("Deeplink", createChatDeeplink(activeChat.id));
  }

export async function handleCopyChatMarkdown(deps: WorkspaceRuntimeDeps) {
  const { activeChat, copyLabeledTextToClipboard, formatChatAsMarkdown } = deps;

    await copyLabeledTextToClipboard("Chat Markdown", formatChatAsMarkdown(activeChat));
  }

export function handleForkActiveChatLocal(deps: WorkspaceRuntimeDeps) {
  const { activateForkedChat, activeChat, createForkedChat, localWorkspaceRef, resolveWorkspaceForChatProject, setNoticeDialog } = deps;

    const forkedChat = createForkedChat(activeChat, activeChat.project);
    activateForkedChat(forkedChat, resolveWorkspaceForChatProject(activeChat.project, localWorkspaceRef.current));
    setNoticeDialog({
      description: `${forkedChat.title} is ready in ${forkedChat.project}.`,
      title: "Chat forked locally",
    });
  }

export function handleForkChatFromMessage(deps: WorkspaceRuntimeDeps, messageId: string) {
  const { activateForkedChat, activeChat, createForkedChat, localWorkspaceRef, resolveWorkspaceForChatProject, setNoticeDialog } = deps;
  const sourceMessage = activeChat.messages.find((message) => message.id === messageId);

    if (!sourceMessage) {
      setNoticeDialog({
        description: "That message is no longer available in the active chat.",
        title: "Could not fork chat",
      });
      return;
    }

    if (sourceMessage.role !== "assistant" || sourceMessage.isStreaming || sourceMessage.status === "queued") {
      setNoticeDialog({
        description: "Branch from a completed assistant response.",
        title: "Could not fork chat",
      });
      return;
    }

    const forkedChat = createForkedChat(activeChat, activeChat.project, `Fork: ${activeChat.title || "New chat"}`, { throughMessageId: messageId });
    activateForkedChat(forkedChat, resolveWorkspaceForChatProject(activeChat.project, localWorkspaceRef.current));
    setNoticeDialog({
      description: `${forkedChat.title} continues from that response.`,
      title: "Branched in a new chat",
    });
  }

export function handleMessageFeedback(deps: WorkspaceRuntimeDeps, messageId: string, feedback: ChatMessage["feedback"]) {
  const { activeChat, setChats } = deps;

    setChats((currentChats) =>
      currentChats.map((chat) => {
        if (chat.id !== activeChat.id) {
          return chat;
        }

        let changed = false;
        const messages = chat.messages.map((message) => {
          if (message.id !== messageId || message.role !== "assistant" || message.isStreaming) {
            return message;
          }

          const nextFeedback = message.feedback === feedback ? undefined : feedback;

          if (message.feedback === nextFeedback) {
            return message;
          }

          changed = true;
          return {
            ...message,
            feedback: nextFeedback,
          };
        });

        return changed ? { ...chat, messages } : chat;
      }),
    );
  }

export async function handleForkActiveChatWorktree(deps: WorkspaceRuntimeDeps) {
  const { activateForkedChat, activeChat, createComputerGitWorktree, createForkedChat, createProjectFromFolder, localWorkspaceRef, projectNameFromPath, readErrorMessage, resolveWorkspaceForChatProject, setNoticeDialog } = deps;

    const sourceWorkspace = resolveWorkspaceForChatProject(activeChat.project, localWorkspaceRef.current);
    const sourceRoot = sourceWorkspace.enabled ? sourceWorkspace.roots[0] : localWorkspaceRef.current.roots[0];

    if (!sourceRoot) {
      setNoticeDialog({
        description: "Choose a Git-backed project folder before forking into a new worktree.",
        title: "No project folder selected",
      });
      return;
    }

    try {
      const worktree = await createComputerGitWorktree(sourceRoot, {
        title: activeChat.title,
      });
      const projectName = createProjectFromFolder(worktree.path, {
        bindToActiveChat: false,
        projectNameHint: `${projectNameFromPath(worktree.path)} worktree`,
      });

      if (!projectName) {
        return;
      }

      const worktreeWorkspace = resolveWorkspaceForChatProject(projectName, {
        ...sourceWorkspace,
        enabled: true,
        roots: [worktree.path],
        scope: "selected-folder",
      });
      const forkedChat = createForkedChat(activeChat, projectName, `Worktree: ${activeChat.title}`);

      activateForkedChat(forkedChat, worktreeWorkspace);
      setNoticeDialog({
        description: `${worktree.branchName} was created at ${worktree.path}.`,
        title: "Worktree fork ready",
      });
    } catch (error) {
      setNoticeDialog({
        description: readErrorMessage(error, "Could not create a Git worktree for this chat."),
        title: "Worktree fork failed",
      });
    }
  }

export function handleAddAutomation(deps: WorkspaceRuntimeDeps) {
  const { setNoticeDialog, setSearchOpen } = deps;

    setSearchOpen(false);
    setNoticeDialog({
      description: "Workflow automation was removed with the tool runtime cleanup. Web search remains available from chat.",
      title: "Workflows removed",
    });
  }

export async function handleOpenActiveChatInNewWindow(deps: WorkspaceRuntimeDeps) {
  const { activeChat, openChatWindow, readErrorMessage, setNoticeDialog } = deps;

    try {
      await openChatWindow(activeChat.id, activeChat.title);
    } catch (error) {
      setNoticeDialog({
        description: readErrorMessage(error, "Could not open this chat in a new window."),
        title: "Could not open window",
      });
    }
  }

export function getActiveWorkingDirectory(deps: WorkspaceRuntimeDeps) {
  const { activeChat, defaultTerminalWorkingDirectory, localWorkspaceRef, resolveWorkspaceForChatProject } = deps;

    const workspace = resolveWorkspaceForChatProject(activeChat.project, localWorkspaceRef.current);

    return workspace.roots[0] || localWorkspaceRef.current.roots[0] || defaultTerminalWorkingDirectory;
  }

export async function copyLabeledTextToClipboard(deps: WorkspaceRuntimeDeps, label: string, text: string) {
  const { copyTextToClipboard, readErrorMessage, setNoticeDialog } = deps;

    try {
      const copied = await copyTextToClipboard(text);

      if (!copied) {
        throw new Error(`Could not copy ${label.toLowerCase()}.`);
      }

      setNoticeDialog({
        description: label,
        title: "Copied",
      });
    } catch (error) {
      setNoticeDialog({
        description: readErrorMessage(error, `Could not copy ${label.toLowerCase()}.`),
        title: "Copy failed",
      });
    }
  }

export function activateForkedChat(deps: WorkspaceRuntimeDeps, forkedChat: ChatSummary, workspace: LocalWorkspaceSettings) {
  const { pendingChatsRef, restoreProjectLocalWorkspace, setActiveChatId, setActiveRoute, setChats, setSearchOpen, sortChatsByUpdatedAt, touchProject } = deps;

    const nextChats = sortChatsByUpdatedAt([forkedChat, ...pendingChatsRef.current]);

    pendingChatsRef.current = nextChats;
    setChats(nextChats);
    restoreProjectLocalWorkspace(forkedChat.project, workspace);
    touchProject(forkedChat.project);
    setActiveChatId(forkedChat.id);
    setActiveRoute("chat");
    setSearchOpen(false);
  }

export function notifyPlanningInputNeeded(deps: WorkspaceRuntimeDeps, inputRequest: ChatPlanningInputRequest, chatId?: string) {
  const { activeChat, createNeedsInputNotification, notifyAgentRunStatus } = deps;
  const context = createNotificationContext(deps, chatId ?? activeChat.id);

    notifyAgentRunStatus({
      chatId: context.chatId,
      context,
      notification: createNeedsInputNotification(inputRequest.detail || inputRequest.title, context),
    });
  }

export function notifyRunNeedsAttention(deps: WorkspaceRuntimeDeps, detail?: string, chatId?: string) {
  const { activeChat, createNeedsAttentionNotification, notifyAgentRunStatus } = deps;
  const context = createNotificationContext(deps, chatId ?? activeChat.id);

    notifyAgentRunStatus({
      chatId: context.chatId,
      context,
      notification: createNeedsAttentionNotification(detail, context),
    });
  }

export function notifyRunComplete(deps: WorkspaceRuntimeDeps, message: ChatMessage, chatId?: string) {
  const { activeChat, notifyAgentRunStatus } = deps;
  const context = createNotificationContext(deps, chatId ?? activeChat.id);

    notifyAgentRunStatus({
      chatId: context.chatId,
      context,
      message,
    });
  }

function createNotificationContext(deps: WorkspaceRuntimeDeps, chatId: string) {
  const { activeChat, pendingChatsRef, titleFromMessage } = deps;
  const chat = pendingChatsRef.current.find((candidate: ChatSummary) => candidate.id === chatId) ?? activeChat;
  const latestUserMessage = [...(chat.messages ?? [])].reverse().find((message: ChatMessage) => message.role === "user");
  const fallbackTitle = latestUserMessage ? titleFromMessage(latestUserMessage.content) : chat.project;
  const chatTitle = isPlaceholderChatTitle(chat.title) ? fallbackTitle : chat.title;

  return {
    chatId: chat.id,
    chatTitle,
    project: chat.project,
  };
}

function isPlaceholderChatTitle(title: string) {
  return !title.trim() || /^new chat$/i.test(title) || /^naming chat/i.test(title);
}

export function touchProject(deps: WorkspaceRuntimeDeps, projectName: string) {
  const { createId, isNoProjectName, normalizeProjectName, projectsRef, setProjects, sortProjectsByUpdatedAt } = deps;

    const normalizedProjectName = normalizeProjectName(projectName);

    if (isNoProjectName(normalizedProjectName)) {
      return;
    }

    const now = new Date().toISOString();

    setProjects((currentProjects) => {
      const projectExists = currentProjects.some((project) => project.name.toLowerCase() === normalizedProjectName.toLowerCase());

      if (!projectExists) {
        const nextProjects = sortProjectsByUpdatedAt([
          {
            createdAt: now,
            id: createId("project"),
            name: normalizedProjectName,
            updatedAt: now,
          },
          ...currentProjects,
        ]);
        projectsRef.current = nextProjects;
        return nextProjects;
      }

      const nextProjects = sortProjectsByUpdatedAt(
        currentProjects.map((project) =>
          project.name.toLowerCase() === normalizedProjectName.toLowerCase()
            ? {
                ...project,
                updatedAt: now,
              }
            : project,
        ),
      );
      projectsRef.current = nextProjects;
      return nextProjects;
    });
  }

export function restoreProjectLocalWorkspace(deps: WorkspaceRuntimeDeps, projectName: string, workspaceOverride: LocalWorkspaceSettings) {
  const { createNoProjectWorkspace, isNoProjectName, localWorkspaceRef, normalizeProjectName, projectsRef, sameLocalWorkspaceSettings, setLocalWorkspace } = deps;

    const normalizedProjectName = normalizeProjectName(projectName);

    if (isNoProjectName(normalizedProjectName)) {
      const noProjectWorkspace = createNoProjectWorkspace(localWorkspaceRef.current);
      if (!sameLocalWorkspaceSettings(noProjectWorkspace, localWorkspaceRef.current)) {
        localWorkspaceRef.current = noProjectWorkspace;
        setLocalWorkspace(noProjectWorkspace);
      }
      return;
    }

    const projectWorkspace = workspaceOverride ?? projectsRef.current.find((project) => project.name.toLowerCase() === normalizedProjectName.toLowerCase())?.localWorkspace;

    if (projectWorkspace) {
      if (!sameLocalWorkspaceSettings(projectWorkspace, localWorkspaceRef.current)) {
        localWorkspaceRef.current = projectWorkspace;
        setLocalWorkspace(projectWorkspace);
      }
      return;
    }

    const noProjectWorkspace = createNoProjectWorkspace(localWorkspaceRef.current);
    if (!sameLocalWorkspaceSettings(noProjectWorkspace, localWorkspaceRef.current)) {
      localWorkspaceRef.current = noProjectWorkspace;
      setLocalWorkspace(noProjectWorkspace);
    }
  }

export function saveWorkspaceForProject(deps: WorkspaceRuntimeDeps, projectName: string, nextWorkspace: LocalWorkspaceSettings) {
  const { createId, isNoProjectName, normalizeProjectName, projectsRef, setProjects, sortProjectsByUpdatedAt } = deps;

    const normalizedProjectName = normalizeProjectName(projectName);

    if (isNoProjectName(normalizedProjectName)) {
      return;
    }

    const now = new Date().toISOString();

    setProjects((currentProjects) => {
      const projectExists = currentProjects.some((project) => project.name.toLowerCase() === normalizedProjectName.toLowerCase());

      if (!projectExists) {
        const nextProjects = sortProjectsByUpdatedAt([
          {
            createdAt: now,
            id: createId("project"),
            localWorkspace: nextWorkspace,
            name: normalizedProjectName,
            updatedAt: now,
          },
          ...currentProjects,
        ]);
        projectsRef.current = nextProjects;
        return nextProjects;
      }

      const nextProjects = sortProjectsByUpdatedAt(
        currentProjects.map((project) =>
          project.name.toLowerCase() === normalizedProjectName.toLowerCase()
            ? {
                ...project,
                localWorkspace: nextWorkspace,
                updatedAt: now,
              }
            : project,
        ),
      );
      projectsRef.current = nextProjects;
      return nextProjects;
    });
  }

export function handleDeleteChat(deps: WorkspaceRuntimeDeps, chatId: string) {
  const { chats, isChatSending, setNoticeDialog, setPendingDeleteChatId } = deps;

    const chatToDelete = chats.find((chat) => chat.id === chatId);

    if (!chatToDelete) {
      return;
    }

    if (isChatSending(chatId)) {
      setNoticeDialog({
        description: "Wait for the current response to finish, then delete the chat from the sidebar menu.",
        title: "Chat is still responding",
      });
      return;
    }

    setPendingDeleteChatId(chatId);
  }

export function handleClearChatMessages(deps: WorkspaceRuntimeDeps, chatId: string) {
  const { chats, isChatSending, setNoticeDialog, setPendingClearChatId } = deps;

    const chatToClear = chats.find((chat) => chat.id === chatId);

    if (!chatToClear) {
      return;
    }

    if (isChatSending(chatId)) {
      setNoticeDialog({
        description: "Wait for the current response to finish, then delete all messages in this chat.",
        title: "Chat is still responding",
      });
      return;
    }

    if (chatToClear.messages.length === 0) {
      setNoticeDialog({
        description: "This chat does not have messages to delete.",
        title: "No messages",
      });
      return;
    }

    setPendingClearChatId(chatId);
  }

export function handleDeleteProject(deps: WorkspaceRuntimeDeps, projectName: string) {
  const { chats, isAnyChatSending, isNoProjectName, projects, setNoticeDialog, setPendingDeleteProjectName } = deps;

    const projectToDelete = projects.find((project) => project.name.toLowerCase() === projectName.toLowerCase());

    if (!projectToDelete || isNoProjectName(projectToDelete.name)) {
      return;
    }

    const projectChatIds = new Set(chats.filter((chat) => chat.project.toLowerCase() === projectToDelete.name.toLowerCase()).map((chat) => chat.id));

    if (isAnyChatSending(projectChatIds)) {
      setNoticeDialog({
        description: "Wait for the current response to finish, then delete the project from the sidebar menu.",
        title: "Project is still responding",
      });
      return;
    }

    setPendingDeleteProjectName(projectToDelete.name);
  }

export function handleOpenBulkDeleteChats(deps: WorkspaceRuntimeDeps) {
  const { setBulkDeleteChatIds, setBulkDeleteChatsOpen, setSearchOpen } = deps;

    setBulkDeleteChatIds([]);
    setBulkDeleteChatsOpen(true);
    setSearchOpen(false);
  }

export function handleToggleBulkDeleteChat(deps: WorkspaceRuntimeDeps, chatId: string) {
  const { isChatSending, setBulkDeleteChatIds } = deps;

    if (isChatSending(chatId)) {
      return;
    }

    setBulkDeleteChatIds((currentIds) => (currentIds.includes(chatId) ? currentIds.filter((id) => id !== chatId) : [...currentIds, chatId]));
  }

export function handleSelectAllBulkDeleteChats(deps: WorkspaceRuntimeDeps) {
  const { chats, isChatSending, isEmptyChat, setBulkDeleteChatIds, sortChatsByUpdatedAt } = deps;

    setBulkDeleteChatIds(sortChatsByUpdatedAt(chats.filter((chat) => !chat.archived && !isEmptyChat(chat) && !isChatSending(chat.id))).map((chat) => chat.id));
  }

export function handleClearBulkDeleteChats(deps: WorkspaceRuntimeDeps) {
  const { setBulkDeleteChatIds } = deps;

    setBulkDeleteChatIds([]);
  }

export function confirmDeleteChat(deps: WorkspaceRuntimeDeps) {
  const { activeChatId, chats, createEmptyChat, DEFAULT_PROJECT, isChatSending, pendingDeleteChatId, setActiveChatId, setChats, setNoticeDialog, setPendingDeleteChatId, sortChatsByUpdatedAt, updateQueuedChatSends } = deps;

    const chatToDelete = chats.find((chat) => chat.id === pendingDeleteChatId);

    if (!chatToDelete) {
      setPendingDeleteChatId(null);
      return;
    }

    if (isChatSending(chatToDelete.id)) {
      setPendingDeleteChatId(null);
      setNoticeDialog({
        description: "Wait for the current response to finish, then delete the chat from the sidebar menu.",
        title: "Chat is still responding",
      });
      return;
    }

    const nextChats = sortChatsByUpdatedAt(chats.filter((chat) => chat.id !== chatToDelete.id));

    if (chatToDelete.id === activeChatId) {
      const nextActiveChat = nextChats.find((chat) => !chat.archived) ?? createEmptyChat(DEFAULT_PROJECT);

      if (!nextChats.some((chat) => chat.id === nextActiveChat.id)) {
        nextChats.unshift(nextActiveChat);
      }

      setActiveChatId(nextActiveChat.id);
    }

    setChats(nextChats);
    updateQueuedChatSends((currentQueue) => currentQueue.filter((queuedSend) => queuedSend.chatId !== chatToDelete.id));
    setPendingDeleteChatId(null);
  }

export function confirmClearChatMessages(deps: WorkspaceRuntimeDeps) {
  const { chats, isChatSending, pendingChatsRef, pendingClearChatId, setChats, setNoticeDialog, setPendingClearChatId, sortChatsByUpdatedAt, updateQueuedChatSends } = deps;

    const chatToClear = chats.find((chat) => chat.id === pendingClearChatId);

    if (!chatToClear) {
      setPendingClearChatId(null);
      return;
    }

    if (isChatSending(chatToClear.id)) {
      setPendingClearChatId(null);
      setNoticeDialog({
        description: "Wait for the current response to finish, then delete all messages in this chat.",
        title: "Chat is still responding",
      });
      return;
    }

    const now = new Date().toISOString();
    const nextChats = sortChatsByUpdatedAt(
      chats.map((chat) =>
        chat.id === chatToClear.id
          ? {
              ...chat,
              isDraft: true,
              messages: [],
              messagesClearedAt: now,
              updatedAt: now,
            }
          : chat,
      ),
    );

    pendingChatsRef.current = nextChats;
    setChats(nextChats);
    updateQueuedChatSends((currentQueue) => currentQueue.filter((queuedSend) => queuedSend.chatId !== chatToClear.id));
    setPendingClearChatId(null);
  }

export function confirmDeleteProject(deps: WorkspaceRuntimeDeps) {
  const { activeChatId, chats, createEmptyChat, DEFAULT_PROJECT, isAnyChatSending, pendingDeleteProjectName, projects, projectsRef, setActiveChatId, setActiveRoute, setChats, setNoticeDialog, setPendingDeleteProjectName, setProjects, setSearchOpen, sortChatsByUpdatedAt, sortProjectsByUpdatedAt, updateQueuedChatSends } = deps;

    if (!pendingDeleteProjectName) {
      return;
    }

    const projectToDelete = projects.find((project) => project.name.toLowerCase() === pendingDeleteProjectName.toLowerCase());

    if (!projectToDelete) {
      setPendingDeleteProjectName(null);
      return;
    }

    const projectKey = projectToDelete.name.toLowerCase();
    const deletedChatIds = new Set(chats.filter((chat) => chat.project.toLowerCase() === projectKey).map((chat) => chat.id));

    if (isAnyChatSending(deletedChatIds)) {
      setPendingDeleteProjectName(null);
      setNoticeDialog({
        description: "Wait for the current response to finish, then delete the project from the sidebar menu.",
        title: "Project is still responding",
      });
      return;
    }

    const nextProjects = sortProjectsByUpdatedAt(projects.filter((project) => project.name.toLowerCase() !== projectKey));
    let nextChats = sortChatsByUpdatedAt(chats.filter((chat) => chat.project.toLowerCase() !== projectKey));

    const activeChatWasDeleted = deletedChatIds.has(activeChatId);

    if (!nextChats.some((chat) => chat.id === activeChatId && !chat.archived)) {
      const nextActiveChat = nextChats.find((chat) => !chat.archived) ?? createEmptyChat(DEFAULT_PROJECT);

      if (!nextChats.some((chat) => chat.id === nextActiveChat.id)) {
        nextChats = sortChatsByUpdatedAt([nextActiveChat, ...nextChats]);
      }

      setActiveChatId(nextActiveChat.id);
    }

    projectsRef.current = nextProjects;
    setProjects(nextProjects);
    setChats(nextChats);
    updateQueuedChatSends((currentQueue) => currentQueue.filter((queuedSend) => !deletedChatIds.has(queuedSend.chatId)));
    setPendingDeleteProjectName(null);
    setSearchOpen(false);
    if (activeChatWasDeleted) {
      setActiveRoute("chat");
    }
  }

export function confirmBulkDeleteChats(deps: WorkspaceRuntimeDeps) {
  const { activeChatId, bulkDeleteChatIds, chats, createEmptyChat, DEFAULT_PROJECT, getSendingChatIds, pendingChatsRef, setActiveChatId, setActiveRoute, setBulkDeleteChatIds, setBulkDeleteChatsOpen, setChats, setNoticeDialog, setSearchOpen, sortChatsByUpdatedAt, updateQueuedChatSends } = deps;

    const selectedIds = new Set(bulkDeleteChatIds);

    if (selectedIds.size === 0) {
      return;
    }

    const selectedSendingChatIds = getSendingChatIds(selectedIds);

    if (selectedSendingChatIds.length > 0) {
      setNoticeDialog({
        description: "Wait for the current response to finish, then include that chat in a bulk delete.",
        title: "A selected chat is still responding",
      });
      setBulkDeleteChatIds((currentIds) => currentIds.filter((id) => !selectedSendingChatIds.includes(id)));
      return;
    }

    let nextChats = sortChatsByUpdatedAt(chats.filter((chat) => !selectedIds.has(chat.id)));

    if (!nextChats.some((chat) => !chat.archived)) {
      nextChats = [createEmptyChat(DEFAULT_PROJECT)];
    }

    if (!nextChats.some((chat) => chat.id === activeChatId && !chat.archived)) {
      const nextActiveChat = nextChats.find((chat) => !chat.archived) ?? createEmptyChat(DEFAULT_PROJECT);

      if (!nextChats.some((chat) => chat.id === nextActiveChat.id)) {
        nextChats = sortChatsByUpdatedAt([nextActiveChat, ...nextChats]);
      }

      setActiveChatId(nextActiveChat.id);
      setActiveRoute("chat");
    }

    pendingChatsRef.current = nextChats;
    setChats(nextChats);
    updateQueuedChatSends((currentQueue) => currentQueue.filter((queuedSend) => !selectedIds.has(queuedSend.chatId)));
    setBulkDeleteChatsOpen(false);
    setBulkDeleteChatIds([]);
    setSearchOpen(false);
  }

function runAfterNextPaint(callback: () => void) {
  if (typeof window === "undefined") {
    callback();
    return;
  }

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(callback);
  });
}
