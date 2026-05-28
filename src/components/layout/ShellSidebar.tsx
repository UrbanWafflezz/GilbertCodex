import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Eraser, Folder, FolderOpen, FolderPlus, ListPlus, LogOut, MessageSquarePlus, Pin, Puzzle, Search, Settings, Trash2, UserRound, Workflow } from "lucide-react";
import { DEFAULT_PROJECT, formatChatAge, hasComposerDraftContent, isDiscardableEmptyChat, isEmptyChat, isNoProjectName, normalizeProjectName, sortChatsByUpdatedAt } from "../../lib/chatUtils";
import { SettingsSideMenu } from "../../pages/settings/SettingsSideMenu";
import { SidebarSection } from "../sidebar/SidebarSection";
import { ProjectOpenIcon } from "../project/ProjectOpenIcon";
import { getHostPlatform } from "../../lib/hostPlatform";
import type { AuthUser } from "../../types/auth";
import type { ChatMessage, ChatSummary } from "../../types/chat";
import type { PrimaryRoute } from "../../types/navigation";
import type { CreateProjectOptions, ProjectSummary } from "../../types/project";
import { getProjectOpenTarget, getProjectOpenTargetsForPlatform, getRecommendedProjectOpenTarget, type ProjectOpenTargetId } from "../../types/projectOpen";
import type { SettingsSectionId } from "../../pages/settings/types";
import type { SidebarItemActivity } from "../sidebar/SidebarSection";

interface ShellSidebarProps {
  activeChatId: string;
  activeRoute: PrimaryRoute;
  activeSettingsSection: SettingsSectionId;
  authUser: AuthUser;
  chats: ChatSummary[];
  defaultOpenTarget?: ProjectOpenTargetId;
  locationServicesEnabled: boolean;
  onCreateProject: (options?: CreateProjectOptions) => void | string | null | Promise<string | null | void>;
  onClearChatMessages: (chatId: string) => void;
  onDeleteChat: (chatId: string) => void;
  onDeleteProject: (projectName: string) => void;
  onNewChat: (project?: string) => void;
  onOpenBulkDeleteChats: () => void;
  onOpenProjectInTool: (projectName: string, target: ProjectOpenTargetId) => void | Promise<void>;
  onOpenSearch: () => void;
  onLogout: () => void;
  onPreloadRoute?: (route: PrimaryRoute) => void;
  onPreloadSettingsSection?: (section: SettingsSectionId) => void;
  onRouteChange: (route: PrimaryRoute) => void;
  onSelectChat: (chatId: string) => void;
  onSettingsSectionChange: (section: SettingsSectionId) => void;
  onTogglePin: (chatId: string) => void;
  open: boolean;
  projects: ProjectSummary[];
}

const PROJECT_CHAT_PREVIEW_LIMIT = 6;

export const ShellSidebar = memo(function ShellSidebar({
  activeChatId,
  activeRoute,
  activeSettingsSection,
  authUser,
  chats,
  defaultOpenTarget,
  locationServicesEnabled,
  onCreateProject,
  onClearChatMessages,
  onDeleteChat,
  onDeleteProject,
  onNewChat,
  onOpenBulkDeleteChats,
  onOpenProjectInTool,
  onOpenSearch,
  onLogout,
  onPreloadRoute,
  onPreloadSettingsSection,
  onRouteChange,
  onSelectChat,
  onSettingsSectionChange,
  onTogglePin,
  open,
  projects,
}: ShellSidebarProps) {
  const visibleChats = useMemo(() => sortChatsByUpdatedAt(chats.filter((chat) => !chat.archived && !isDiscardableEmptyChat(chat))), [chats]);
  const activeChat = useMemo(() => chats.find((chat) => chat.id === activeChatId && !chat.archived), [activeChatId, chats]);
  const pinnedChats = useMemo(() => visibleChats.filter((chat) => chat.pinned), [visibleChats]);
  const recentChats = useMemo(() => visibleChats.filter((chat) => isNoProjectName(chat.project) && !chat.pinned), [visibleChats]);
  const hostPlatform = useMemo(() => getHostPlatform(), []);
  const chatsByProject = useMemo(() => {
    const groupedChats = new Map<string, ChatSummary[]>();

    for (const chat of visibleChats) {
      const projectKey = normalizeProjectName(chat.project).toLowerCase();
      const projectChats = groupedChats.get(projectKey);

      if (projectChats) {
        projectChats.push(chat);
      } else {
        groupedChats.set(projectKey, [chat]);
      }
    }

    return groupedChats;
  }, [visibleChats]);
  const projectList = useMemo(
    () => sortProjectsForSidebar(projects.filter((project) => !isNoProjectName(project.name))),
    [projects],
  );
  const initialExpandedProject = activeChat && !isNoProjectName(activeChat.project) ? normalizeProjectName(activeChat.project) : projectList[0]?.name;
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => new Set(initialExpandedProject ? [initialExpandedProject] : []));
  const [projectChatLimits, setProjectChatLimits] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!activeChat?.project) {
      return;
    }

    setExpandedProjects((currentProjects) => {
      const activeProjectName = normalizeProjectName(activeChat.project);

      if (isNoProjectName(activeProjectName) || currentProjects.has(activeProjectName)) {
        return currentProjects;
      }

      const nextProjects = new Set(currentProjects);
      nextProjects.add(activeProjectName);
      return nextProjects;
    });
  }, [activeChat?.project, activeChatId]);

  const chatOptions = useCallback((chat: ChatSummary) => [
    {
      icon: Pin,
      label: chat.pinned ? "Unpin chat" : "Pin chat",
      onSelect: () => onTogglePin(chat.id),
    },
    ...(chat.messages.length > 0
      ? [
          {
            danger: true,
            icon: Eraser,
            label: "Delete all messages",
            onSelect: () => onClearChatMessages(chat.id),
          },
        ]
      : []),
    {
      danger: true,
      icon: Trash2,
      label: "Delete chat",
      onSelect: () => onDeleteChat(chat.id),
    },
  ], [onClearChatMessages, onDeleteChat, onTogglePin]);

  const projectOptions = useCallback((project: ProjectSummary) => {
    const projectRoot = project.localWorkspace?.roots[0];
    const recommendedTarget = defaultOpenTarget
      ? getProjectOpenTarget(defaultOpenTarget, hostPlatform)
      : getRecommendedProjectOpenTarget({ platform: hostPlatform, projectName: project.name, projectRoot });
    const projectOpenTargets = [
      recommendedTarget,
      ...getProjectOpenTargetsForPlatform(hostPlatform).filter((target) => target.id !== recommendedTarget.id),
    ];

    return [
      ...projectOpenTargets.map((target) => ({
        iconElement: <ProjectOpenIcon color={target.brandColor} size={16} target={target.id} />,
        label: target.id === recommendedTarget.id ? `Open in ${target.label} (recommended)` : `Open in ${target.label}`,
        onSelect: () => {
          void onOpenProjectInTool(project.name, target.id);
        },
      })),
      {
        danger: true,
        icon: Trash2,
        label: "Delete project",
        onSelect: () => onDeleteProject(project.name),
      },
    ];
  }, [defaultOpenTarget, hostPlatform, onDeleteProject, onOpenProjectInTool]);

  function getProjectChatLimit(projectName: string) {
    return projectChatLimits[getProjectKey(projectName)] ?? PROJECT_CHAT_PREVIEW_LIMIT;
  }

  const handleSelectProject = useCallback((projectName: string) => {
    const projectChats = chatsByProject.get(projectName.toLowerCase()) ?? [];
    const expanded = expandedProjects.has(projectName);

    setExpandedProjects((currentProjects) => {
      const nextProjects = new Set(currentProjects);

      if (expanded) {
        nextProjects.delete(projectName);
      } else {
        nextProjects.add(projectName);
      }

      return nextProjects;
    });

    if (expanded) {
      return;
    }

    if (projectChats.length === 0) {
      onNewChat(projectName);
      return;
    }

    const targetChat = projectChats.find((chat) => chat.id === activeChatId) ?? projectChats[0];
    const activeProjectSelected = activeRoute === "chat" && sameProjectName(activeChat?.project, projectName);

    if (!activeProjectSelected || targetChat.id !== activeChatId) {
      onSelectChat(targetChat.id);
    }
  }, [activeChat?.project, activeChatId, activeRoute, chatsByProject, expandedProjects, onNewChat, onSelectChat]);

  const handleCreateProject = useCallback(async () => {
    const createdProjectName = await onCreateProject({ bindToActiveChat: false });

    if (typeof createdProjectName === "string" && createdProjectName.trim()) {
      setExpandedProjects((currentProjects) => {
        if (currentProjects.has(createdProjectName)) {
          return currentProjects;
        }

        const nextProjects = new Set(currentProjects);
        nextProjects.add(createdProjectName);
        return nextProjects;
      });
      onNewChat(createdProjectName);
    }
  }, [onCreateProject, onNewChat]);

  const handleNewProjectChat = useCallback((projectName: string) => {
    setExpandedProjects((currentProjects) => {
      if (currentProjects.has(projectName)) {
        return currentProjects;
      }

      const nextProjects = new Set(currentProjects);
      nextProjects.add(projectName);
      return nextProjects;
    });
    onNewChat(projectName);
  }, [onNewChat]);

  const handleLoadMoreProjectChats = useCallback((projectName: string) => {
    setProjectChatLimits((currentLimits) => {
      const projectKey = getProjectKey(projectName);
      const currentLimit = currentLimits[projectKey] ?? PROJECT_CHAT_PREVIEW_LIMIT;

      return {
        ...currentLimits,
        [projectKey]: currentLimit + PROJECT_CHAT_PREVIEW_LIMIT,
      };
    });
  }, []);
  const handleCreateProjectAction = useCallback(() => void handleCreateProject(), [handleCreateProject]);
  const handleNewDefaultChat = useCallback(() => onNewChat(DEFAULT_PROJECT), [onNewChat]);

  const createChatItem = useCallback((chat: ChatSummary) => {
    const activity = getChatActivity(chat);

    return {
      active: chat.id === activeChatId && activeRoute === "chat",
      activity,
      activityLabel: activity ? formatActivityLabel(activity) : undefined,
      id: chat.id,
      label: chat.title,
      menuItems: chatOptions(chat),
      meta: hasComposerDraftContent(chat.composerDraft) && isEmptyChat(chat) ? "Draft" : formatChatAge(chat.updatedAt),
      onSelect: onSelectChat,
    };
  }, [activeChatId, activeRoute, chatOptions, onSelectChat]);

  const projectItems = useMemo(
    () =>
      projectList.map((project) => {
        const projectChats = chatsByProject.get(project.name.toLowerCase()) ?? [];
        const expanded = expandedProjects.has(project.name);
        const visibleChatLimit = getProjectChatLimit(project.name);
        const visibleProjectChats = projectChats.slice(0, visibleChatLimit);
        const hiddenChatCount = Math.max(projectChats.length - visibleProjectChats.length, 0);
        const activity = getProjectActivity(projectChats);

        return {
          active: sameProjectName(activeChat?.project, project.name) && activeRoute === "chat",
          activity,
          activityLabel: activity ? `${formatActivityLabel(activity)} in ${project.name}` : undefined,
          children: [
            ...visibleProjectChats.map(createChatItem),
            ...(hiddenChatCount > 0
              ? [
                  {
                    icon: ListPlus,
                    id: `${project.name}-load-more`,
                    label: "Load more",
                    meta: `${hiddenChatCount} more`,
                    onSelect: () => handleLoadMoreProjectChats(project.name),
                  },
                ]
              : []),
          ],
          expanded,
          icon: expanded ? FolderOpen : Folder,
          id: project.name,
          label: project.name,
          menuItems: projectOptions(project),
          onQuickAction: handleNewProjectChat,
          onSelect: handleSelectProject,
          quickActionIcon: MessageSquarePlus,
          quickActionLabel: `New chat in ${project.name}`,
        };
      }),
    [
      activeChat?.project,
      activeRoute,
      chatsByProject,
      createChatItem,
      expandedProjects,
      handleLoadMoreProjectChats,
      handleNewProjectChat,
      handleSelectProject,
      projectChatLimits,
      projectList,
      projectOptions,
    ],
  );

  const chatItems = useMemo(
    () => [
      ...pinnedChats.map((chat) => ({
        ...createChatItem(chat),
        icon: Pin,
      })),
      ...recentChats.map(createChatItem),
    ],
    [createChatItem, pinnedChats, recentChats],
  );

  if (activeRoute === "settings") {
    return (
      <SettingsSideMenu
        activeSection={activeSettingsSection}
        locationServicesEnabled={locationServicesEnabled}
        open={open}
        onLogout={onLogout}
        onRouteChange={onRouteChange}
        onSectionChange={onSettingsSectionChange}
        onSectionPreload={onPreloadSettingsSection}
      />
    );
  }

  return (
    <aside className="shell-sidebar" data-open={open}>
      <div className="sidebar-primary-actions">
        <button className="sidebar-action" data-active={activeRoute === "chat"} type="button" onClick={handleNewDefaultChat}>
          <MessageSquarePlus size={17} aria-hidden="true" />
          <span>New chat</span>
        </button>
        <button className="sidebar-action" type="button" onClick={onOpenSearch}>
          <Search size={17} aria-hidden="true" />
          <span>Search</span>
        </button>
        <button
          className="sidebar-action"
          data-active={activeRoute === "apps"}
          data-latency-label="sidebar:apps"
          type="button"
          onFocus={() => onPreloadRoute?.("apps")}
          onMouseEnter={() => onPreloadRoute?.("apps")}
          onClick={() => onRouteChange("apps")}
        >
          <Puzzle size={17} aria-hidden="true" />
          <span>Apps</span>
        </button>
        <button
          className="sidebar-action"
          data-active={activeRoute === "tasks"}
          data-latency-label="sidebar:tasks"
          type="button"
          onFocus={() => onPreloadRoute?.("tasks")}
          onMouseEnter={() => onPreloadRoute?.("tasks")}
          onClick={() => onRouteChange("tasks")}
        >
          <Workflow size={17} aria-hidden="true" />
          <span>Tasks</span>
        </button>
      </div>

      <div className="sidebar-scroll">
        <SidebarSection
          title="Projects"
          actionIcon={FolderPlus}
          actionLabel="Add project folder"
          onAction={handleCreateProjectAction}
          items={projectItems}
        />
        <SidebarSection
          title="Chats"
          actionIcon={MessageSquarePlus}
          actionLabel="New chat outside project"
          emptyMessage="No chats"
          secondaryIcon={visibleChats.length > 0 ? Trash2 : undefined}
          secondaryActionLabel="Delete chats"
          onAction={handleNewDefaultChat}
          onSecondaryAction={visibleChats.length > 0 ? onOpenBulkDeleteChats : undefined}
          items={chatItems}
        />
      </div>

      <div className="sidebar-footer">
        <section className="sidebar-account-card" aria-label="Account">
          <div className="sidebar-account">
            <div className="sidebar-account-avatar" aria-hidden="true">
              {getUserInitials(authUser)}
            </div>
            <div className="sidebar-account-copy">
              <strong>{authUser.displayName}</strong>
              <span>@{authUser.username}</span>
            </div>
            <button className="sidebar-account-signout" type="button" aria-label="Sign out" title="Sign out" onClick={onLogout}>
              <LogOut size={16} aria-hidden="true" />
            </button>
          </div>

          <button
            className="sidebar-settings sidebar-account-settings"
            data-active={false}
            data-latency-label="sidebar:settings"
            type="button"
            onFocus={() => onPreloadRoute?.("settings")}
            onMouseEnter={() => onPreloadRoute?.("settings")}
            onClick={() => onRouteChange("settings")}
          >
            <Settings size={16} aria-hidden="true" />
            <span>Settings</span>
          </button>
        </section>
      </div>
    </aside>
  );
}, areShellSidebarPropsEqual);

function areShellSidebarPropsEqual(previous: ShellSidebarProps, next: ShellSidebarProps) {
  return (
    previous.activeChatId === next.activeChatId &&
    previous.activeRoute === next.activeRoute &&
    previous.activeSettingsSection === next.activeSettingsSection &&
    previous.authUser === next.authUser &&
    previous.chats === next.chats &&
    previous.locationServicesEnabled === next.locationServicesEnabled &&
    previous.open === next.open &&
    previous.projects === next.projects
  );
}

function getUserInitials(user: AuthUser) {
  const initials = user.displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return initials || <UserRound size={16} aria-hidden="true" />;
}

function getProjectKey(projectName: string) {
  return projectName.toLowerCase();
}

function sortProjectsForSidebar(projects: ProjectSummary[]) {
  return [...projects].sort((left, right) => {
    const leftCreatedAt = parseProjectDate(left.createdAt);
    const rightCreatedAt = parseProjectDate(right.createdAt);

    if (leftCreatedAt !== rightCreatedAt) {
      return rightCreatedAt - leftCreatedAt;
    }

    return left.name.localeCompare(right.name);
  });
}

function parseProjectDate(value: string) {
  const timestamp = Date.parse(value);

  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function getProjectActivity(projectChats: ChatSummary[]): SidebarItemActivity | undefined {
  let activity: SidebarItemActivity | undefined;

  for (const chat of projectChats) {
    activity = pickHigherActivity(activity, getChatActivity(chat));

    if (activity === "waiting") {
      break;
    }
  }

  return activity;
}

function getChatActivity(chat: ChatSummary): SidebarItemActivity | undefined {
  let activity: SidebarItemActivity | undefined;

  for (let index = chat.messages.length - 1; index >= 0; index -= 1) {
    activity = pickHigherActivity(activity, getMessageActivity(chat.messages[index]));

    if (activity === "waiting") {
      break;
    }
  }

  return activity;
}

function getMessageActivity(message: ChatMessage): SidebarItemActivity | undefined {
  const needsReview =
    message.agentRunStatus === "waiting_for_approval" ||
    message.approvals?.some((approval) => approval.status === "pending") ||
    message.toolCalls?.some((toolCall) => toolCall.status === "waiting_approval") ||
    hasPendingPlanningInput(message);

  if (needsReview) {
    return "waiting";
  }

  const isWorking =
    message.isStreaming ||
    message.progress?.some((progressItem) => progressItem.status === "active") ||
    message.toolCalls?.some((toolCall) => toolCall.status === "active") ||
    message.webSearch?.status === "active";

  if (isWorking) {
    return "working";
  }

  if (message.status === "queued") {
    return "queued";
  }

  return undefined;
}

function hasPendingPlanningInput(message: ChatMessage) {
  const planningRequests = message.planning?.inputRequests ?? (message.planning?.inputRequest ? [message.planning.inputRequest] : []);

  return planningRequests.some((request) => !request.answeredAt);
}

function pickHigherActivity(currentActivity: SidebarItemActivity | undefined, nextActivity: SidebarItemActivity | undefined) {
  if (!nextActivity) {
    return currentActivity;
  }

  if (!currentActivity || getActivityPriority(nextActivity) > getActivityPriority(currentActivity)) {
    return nextActivity;
  }

  return currentActivity;
}

function getActivityPriority(activity: SidebarItemActivity) {
  if (activity === "waiting") {
    return 3;
  }

  if (activity === "working") {
    return 2;
  }

  return 1;
}

function formatActivityLabel(activity: SidebarItemActivity) {
  if (activity === "waiting") {
    return "Needs review";
  }

  if (activity === "queued") {
    return "Queued";
  }

  return "Working";
}

function sameProjectName(left?: string | null, right?: string | null) {
  return normalizeProjectName(left).toLowerCase() === normalizeProjectName(right).toLowerCase();
}
