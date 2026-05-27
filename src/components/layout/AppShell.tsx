import { lazy, Suspense, useCallback, useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { PanelLeft } from "lucide-react";
import { AppTopBar } from "../chrome/AppTopBar";
import { ShellSidebar } from "./ShellSidebar";
import { SearchDialog } from "../search/SearchDialog";
import { useAnimatedPresence } from "../../lib/useAnimatedPresence";
import { scheduleIdleTask } from "../../lib/idleTask";
import { getHostPlatform, normalizeHostPlatform } from "../../lib/hostPlatform";
import { useInteractionLatencyProbe } from "../../lib/interactionLatencyProbe";
import type { AppInfo } from "../../types/app";
import type { AuthUser } from "../../types/auth";
import type { ChatSummary } from "../../types/chat";
import type { PrimaryRoute } from "../../types/navigation";
import type { CreateProjectOptions, ProjectSummary } from "../../types/project";
import type { ProjectOpenTargetId } from "../../types/projectOpen";
import type { AppearanceMode } from "../../types/settings";
import type { TerminalAttachedSession, TerminalShellId } from "../../types/terminal";
import type { SettingsSectionId } from "../../pages/settings/types";

const loadTerminalPanel = () => import("../terminal/TerminalPanel");
const TerminalPanel = lazy(() => loadTerminalPanel().then((module) => ({ default: module.TerminalPanel })));

interface AppShellProps {
  activeRoute: PrimaryRoute;
  activeSettingsSection: SettingsSectionId;
  appInfo: AppInfo;
  appearanceMode: AppearanceMode;
  authUser: AuthUser;
  chats: ChatSummary[];
  children: ReactNode;
  defaultOpenTarget?: ProjectOpenTargetId;
  defaultTerminalShell?: TerminalShellId;
  desktopRuntime: boolean;
  locationServicesEnabled: boolean;
  activeChatId: string;
  onCreateProject: (options?: CreateProjectOptions) => void | string | null | Promise<string | null | void>;
  onAppearanceModeChange: (mode: AppearanceMode) => void;
  onClearChatMessages: (chatId: string) => void;
  onCloseSearch: () => void;
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
  onShowAbout: () => void;
  onCloseTerminal: () => void;
  onTerminalHeightChange: (height: number) => void;
  onSelectChat: (chatId: string) => void;
  onSettingsSectionChange: (section: SettingsSectionId) => void;
  onToggleTerminal: () => void;
  onTogglePin: (chatId: string) => void;
  onToggleSidebar: () => void;
  projects: ProjectSummary[];
  searchOpen: boolean;
  sidebarOpen: boolean;
  terminalHeight: number;
  terminalAttachedSession?: TerminalAttachedSession | null;
  terminalOpen: boolean;
  terminalWorkingDirectory?: string;
}

export function AppShell({
  activeChatId,
  activeRoute,
  activeSettingsSection,
  appInfo,
  appearanceMode,
  authUser,
  chats,
  children,
  defaultOpenTarget,
  defaultTerminalShell,
  desktopRuntime,
  locationServicesEnabled,
  onAppearanceModeChange,
  onClearChatMessages,
  onCreateProject,
  onCloseSearch,
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
  onShowAbout,
  onCloseTerminal,
  onTerminalHeightChange,
  onSelectChat,
  onSettingsSectionChange,
  onToggleTerminal,
  onTogglePin,
  onToggleSidebar,
  projects,
  searchOpen,
  sidebarOpen,
  terminalHeight,
  terminalAttachedSession,
  terminalOpen,
  terminalWorkingDirectory,
}: AppShellProps) {
  useInteractionLatencyProbe("Gilbert UI", desktopRuntime);

  const sidebarPresence = useAnimatedPresence(sidebarOpen, 360);
  const sidebarState = sidebarOpen ? "open" : sidebarPresence.exiting ? "closing" : "closed";
  const terminalPresence = useAnimatedPresence(terminalOpen, 160);
  const terminalState = terminalOpen ? "open" : terminalPresence.exiting ? "closing" : "closed";
  const terminalWasMountedRef = useRef(terminalPresence.mounted);
  if (terminalPresence.mounted) {
    terminalWasMountedRef.current = true;
  }
  const shouldRenderTerminalPanel = terminalPresence.mounted || terminalWasMountedRef.current;
  const hostPlatform = normalizeHostPlatform(appInfo.platform ?? getHostPlatform());
  const rootStyle = {
    "--terminal-height": `${terminalHeight}px`,
  } as CSSProperties;

  useEffect(() => {
    if (!desktopRuntime) {
      return undefined;
    }

    return scheduleIdleTask(() => {
      void loadTerminalPanel();
    }, 250);
  }, [desktopRuntime]);

  const closeSidebarOnSmallScreens = useCallback(() => {
    if (typeof window === "undefined" || !sidebarOpen) {
      return;
    }

    if (window.matchMedia("(max-width: 820px)").matches) {
      onToggleSidebar();
    }
  }, [onToggleSidebar, sidebarOpen]);
  const handleSidebarCreateProject = useCallback(
    async (options?: CreateProjectOptions) => {
      const createdProjectName = await onCreateProject(options);
      closeSidebarOnSmallScreens();
      return createdProjectName;
    },
    [closeSidebarOnSmallScreens, onCreateProject],
  );
  const handleSidebarDeleteChat = useCallback(
    (chatId: string) => {
      onDeleteChat(chatId);
      closeSidebarOnSmallScreens();
    },
    [closeSidebarOnSmallScreens, onDeleteChat],
  );
  const handleSidebarClearChatMessages = useCallback(
    (chatId: string) => {
      onClearChatMessages(chatId);
      closeSidebarOnSmallScreens();
    },
    [closeSidebarOnSmallScreens, onClearChatMessages],
  );
  const handleSidebarDeleteProject = useCallback(
    (projectName: string) => {
      onDeleteProject(projectName);
      closeSidebarOnSmallScreens();
    },
    [closeSidebarOnSmallScreens, onDeleteProject],
  );
  const handleSidebarNewChat = useCallback(
    (project?: string) => {
      onNewChat(project);
      closeSidebarOnSmallScreens();
    },
    [closeSidebarOnSmallScreens, onNewChat],
  );
  const handleSidebarOpenBulkDeleteChats = useCallback(() => {
    onOpenBulkDeleteChats();
    closeSidebarOnSmallScreens();
  }, [closeSidebarOnSmallScreens, onOpenBulkDeleteChats]);
  const handleSidebarOpenProjectInTool = useCallback(
    (projectName: string, target: ProjectOpenTargetId) => {
      void onOpenProjectInTool(projectName, target);
      closeSidebarOnSmallScreens();
    },
    [closeSidebarOnSmallScreens, onOpenProjectInTool],
  );
  const handleSidebarOpenSearch = useCallback(() => {
    onOpenSearch();
    closeSidebarOnSmallScreens();
  }, [closeSidebarOnSmallScreens, onOpenSearch]);
  const handleSidebarRouteChange = useCallback(
    (route: PrimaryRoute) => {
      onRouteChange(route);
      closeSidebarOnSmallScreens();
    },
    [closeSidebarOnSmallScreens, onRouteChange],
  );
  const handleSidebarSelectChat = useCallback(
    (chatId: string) => {
      onSelectChat(chatId);
      closeSidebarOnSmallScreens();
    },
    [closeSidebarOnSmallScreens, onSelectChat],
  );
  const handleSidebarSettingsSectionChange = useCallback(
    (section: SettingsSectionId) => {
      onSettingsSectionChange(section);
      closeSidebarOnSmallScreens();
    },
    [closeSidebarOnSmallScreens, onSettingsSectionChange],
  );

  return (
    <div
      className="desktop-root"
      data-runtime={desktopRuntime ? "desktop" : "web"}
      data-platform={hostPlatform}
      data-terminal-open={terminalOpen}
      data-terminal-state={terminalState}
      style={rootStyle}
    >
      <AppTopBar
        activeRoute={activeRoute}
        appInfo={appInfo}
        appearanceMode={appearanceMode}
        desktopRuntime={desktopRuntime}
        hostPlatform={hostPlatform}
        locationServicesEnabled={locationServicesEnabled}
        sidebarOpen={sidebarOpen}
        terminalOpen={terminalOpen}
        onAppearanceModeChange={onAppearanceModeChange}
        onNewChat={onNewChat}
        onOpenSearch={onOpenSearch}
        onPreloadRoute={onPreloadRoute}
        onRouteChange={onRouteChange}
        onShowAbout={onShowAbout}
        onToggleTerminal={onToggleTerminal}
        onToggleSidebar={onToggleSidebar}
      />
      <button
        className="mobile-sidebar-toggle"
        type="button"
        aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
        aria-expanded={sidebarOpen}
        data-open={sidebarOpen}
        onClick={onToggleSidebar}
      >
        <PanelLeft size={18} aria-hidden="true" />
      </button>
      <div className="workspace-shell" data-sidebar-open={sidebarOpen} data-sidebar-state={sidebarState}>
        <div className="sidebar-stage" data-sidebar-state={sidebarState}>
          {sidebarPresence.mounted ? (
            <ShellSidebar
              activeChatId={activeChatId}
              activeRoute={activeRoute}
              activeSettingsSection={activeSettingsSection}
              authUser={authUser}
              chats={chats}
              defaultOpenTarget={defaultOpenTarget}
              locationServicesEnabled={locationServicesEnabled}
              open={sidebarOpen && !sidebarPresence.exiting}
              projects={projects}
              onClearChatMessages={handleSidebarClearChatMessages}
              onCreateProject={handleSidebarCreateProject}
              onDeleteChat={handleSidebarDeleteChat}
              onDeleteProject={handleSidebarDeleteProject}
              onNewChat={handleSidebarNewChat}
              onOpenBulkDeleteChats={handleSidebarOpenBulkDeleteChats}
              onOpenProjectInTool={handleSidebarOpenProjectInTool}
              onOpenSearch={handleSidebarOpenSearch}
              onLogout={onLogout}
              onPreloadRoute={onPreloadRoute}
              onPreloadSettingsSection={onPreloadSettingsSection}
              onRouteChange={handleSidebarRouteChange}
              onSelectChat={handleSidebarSelectChat}
              onSettingsSectionChange={handleSidebarSettingsSectionChange}
              onTogglePin={onTogglePin}
            />
          ) : null}
        </div>
        <button
          className="sidebar-mobile-backdrop"
          type="button"
          aria-hidden={!sidebarOpen}
          aria-label="Close sidebar"
          data-open={sidebarOpen}
          tabIndex={sidebarOpen ? 0 : -1}
          onClick={() => {
            if (sidebarOpen) {
              onToggleSidebar();
            }
          }}
        />
        <main className="app-main">{children}</main>
      </div>
      {shouldRenderTerminalPanel ? (
        <div className="terminal-presence" data-presence={terminalPresence.exiting ? "exit" : "enter"}>
          <Suspense fallback={null}>
            <TerminalPanel
              attachedSession={terminalAttachedSession}
              defaultShell={defaultTerminalShell}
              desktopRuntime={desktopRuntime}
              height={terminalHeight}
              open={terminalPresence.mounted}
              workingDirectory={terminalWorkingDirectory}
              onClose={onCloseTerminal}
              onHeightChange={onTerminalHeightChange}
            />
          </Suspense>
        </div>
      ) : null}
      <SearchDialog chats={chats} hostPlatform={hostPlatform} open={searchOpen} onClose={onCloseSearch} onSelectChat={onSelectChat} />
    </div>
  );
}
