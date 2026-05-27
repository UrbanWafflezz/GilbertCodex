import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PanelLeft } from "lucide-react";
import { closeWindow, maximizeWindow, minimizeWindow, quitApp } from "../../app/windowClient";
import { IconButton } from "../common/IconButton";
import { AppUpdateIndicator, useAppUpdateController } from "./AppUpdateIndicator";
import { runTopBarEditCommand } from "./topBarEditCommands";
import { TopBarMenus, type TopBarMenuAction, type TopBarMenuDefinition } from "./TopBarMenus";
import { handleTopBarDoubleClick, handleTopBarMouseDown } from "./topBarWindowInteractions";
import { WeatherTopBarIndicator } from "./WeatherTopBarIndicator";
import { WindowControls } from "./WindowControls";
import { useDismissableLayer } from "../../lib/useDismissableLayer";
import { formatShortcutForPlatform, isMacHostPlatform, type HostPlatform } from "../../lib/hostPlatform";
import type { AppInfo } from "../../types/app";
import type { PrimaryRoute } from "../../types/navigation";
import type { AppearanceMode } from "../../types/settings";

interface AppTopBarProps {
  activeRoute: PrimaryRoute;
  appInfo: AppInfo;
  appearanceMode: AppearanceMode;
  desktopRuntime: boolean;
  hostPlatform: HostPlatform;
  locationServicesEnabled: boolean;
  onNewChat: () => void;
  onOpenSearch: () => void;
  onAppearanceModeChange: (mode: AppearanceMode) => void;
  onPreloadRoute?: (route: PrimaryRoute) => void;
  onRouteChange: (route: PrimaryRoute) => void;
  onShowAbout: () => void;
  onToggleSidebar: () => void;
  onToggleTerminal: () => void;
  sidebarOpen: boolean;
  terminalOpen: boolean;
}

type MenuId = "file" | "edit" | "view" | "window" | "help";

const menuDefinitions: TopBarMenuDefinition<MenuId>[] = [
  { id: "file", label: "File" },
  { id: "edit", label: "Edit" },
  { id: "view", label: "View" },
  { id: "window", label: "Window" },
  { id: "help", label: "Help" },
];

export function AppTopBar({
  activeRoute,
  appInfo,
  appearanceMode,
  desktopRuntime,
  hostPlatform,
  locationServicesEnabled,
  onNewChat,
  onOpenSearch,
  onAppearanceModeChange,
  onPreloadRoute,
  onRouteChange,
  onShowAbout,
  onToggleSidebar,
  onToggleTerminal,
  sidebarOpen,
  terminalOpen,
}: AppTopBarProps) {
  const topbarRef = useRef<HTMLElement>(null);
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const updateController = useAppUpdateController(desktopRuntime);
  const isMac = isMacHostPlatform(hostPlatform);
  const shortcut = useCallback((value: string) => formatShortcutForPlatform(value, hostPlatform), [hostPlatform]);
  const preloadRoute = useCallback((route: PrimaryRoute) => () => onPreloadRoute?.(route), [onPreloadRoute]);

  const menus = useMemo<Record<MenuId, TopBarMenuAction[]>>(
    () => ({
      file: [
        { label: "New chat", shortcut: shortcut("Ctrl+N"), onSelect: onNewChat },
        { label: "Search chats", shortcut: shortcut("Ctrl+K"), onSelect: onOpenSearch },
        { label: "Settings", shortcut: shortcut("Ctrl+,"), separatorBefore: true, onPreload: preloadRoute("settings"), onSelect: () => onRouteChange("settings") },
        { label: isMac ? `Quit ${appInfo.name}` : "Exit", shortcut: isMac ? "Command+Q" : undefined, danger: true, separatorBefore: true, onSelect: quitApp },
      ],
      edit: [
        { label: "Undo", shortcut: shortcut("Ctrl+Z"), onSelect: () => runTopBarEditCommand("undo") },
        { label: "Cut", shortcut: shortcut("Ctrl+X"), separatorBefore: true, onSelect: () => runTopBarEditCommand("cut") },
        { label: "Copy", shortcut: shortcut("Ctrl+C"), onSelect: () => runTopBarEditCommand("copy") },
        { label: "Paste", shortcut: shortcut("Ctrl+V"), onSelect: () => runTopBarEditCommand("paste") },
        { label: "Select all", shortcut: shortcut("Ctrl+A"), separatorBefore: true, onSelect: () => runTopBarEditCommand("selectAll") },
      ],
      view: [
        { label: "Show sidebar", shortcut: shortcut("Ctrl+B"), checked: sidebarOpen, onSelect: onToggleSidebar },
        { label: "Terminal", shortcut: shortcut("Ctrl+`"), checked: terminalOpen, disabled: !desktopRuntime, onSelect: onToggleTerminal },
        { label: "Chat", checked: activeRoute === "chat", separatorBefore: true, onPreload: preloadRoute("chat"), onSelect: () => onRouteChange("chat") },
        { label: "Apps", checked: activeRoute === "apps", onPreload: preloadRoute("apps"), onSelect: () => onRouteChange("apps") },
        { label: "Tasks", checked: activeRoute === "tasks", onPreload: preloadRoute("tasks"), onSelect: () => onRouteChange("tasks") },
        ...(locationServicesEnabled ? [{ label: "Radar", checked: activeRoute === "radar", onPreload: preloadRoute("radar"), onSelect: () => onRouteChange("radar") }] : []),
        { label: "Settings", checked: activeRoute === "settings", onPreload: preloadRoute("settings"), onSelect: () => onRouteChange("settings") },
        { label: "System theme", checked: appearanceMode === "system", separatorBefore: true, onSelect: () => onAppearanceModeChange("system") },
        { label: "Dark theme", checked: appearanceMode === "dark", onSelect: () => onAppearanceModeChange("dark") },
        { label: "Light theme", checked: appearanceMode === "light", onSelect: () => onAppearanceModeChange("light") },
      ],
      window: [
        { label: "Minimize", shortcut: isMac ? "Command+M" : undefined, onSelect: minimizeWindow },
        { label: isMac ? "Zoom" : "Maximize or restore", onSelect: maximizeWindow },
        { label: "Close window", shortcut: isMac ? "Command+W" : undefined, danger: true, separatorBefore: true, onSelect: closeWindow },
      ],
      help: [
        {
          disabled: !desktopRuntime || updateController.busy,
          label: "Check for updates",
          onSelect: updateController.checkNow,
        },
        { label: `About ${appInfo.name}`, onSelect: onShowAbout },
        { label: "Open settings", separatorBefore: true, onPreload: preloadRoute("settings"), onSelect: () => onRouteChange("settings") },
      ],
    }),
    [
      activeRoute,
      appInfo,
      appearanceMode,
      desktopRuntime,
      hostPlatform,
      isMac,
      onAppearanceModeChange,
      onNewChat,
      onOpenSearch,
      onPreloadRoute,
      onRouteChange,
      onShowAbout,
      onToggleSidebar,
      onToggleTerminal,
      locationServicesEnabled,
      preloadRoute,
      shortcut,
      sidebarOpen,
      terminalOpen,
      updateController.busy,
      updateController.checkNow,
    ],
  );

  useDismissableLayer({
    active: openMenu !== null,
    keyboardTarget: "window",
    onDismiss: () => setOpenMenu(null),
    refs: [topbarRef],
  });

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const usesCommandKey = isMac ? event.metaKey : event.ctrlKey || event.metaKey;
      const target = event.target instanceof HTMLElement ? event.target : null;

      if (!usesCommandKey || target?.closest("[role='dialog']")) {
        return;
      }

      const key = event.key.toLowerCase();

      if (key === "n") {
        event.preventDefault();
        onNewChat();
      } else if (key === "k") {
        event.preventDefault();
        onOpenSearch();
      } else if (key === "b") {
        event.preventDefault();
        onToggleSidebar();
      } else if (desktopRuntime && (event.code === "Backquote" || event.key === "`")) {
        event.preventDefault();
        onToggleTerminal();
      } else if (key === ",") {
        event.preventDefault();
        onRouteChange("settings");
      } else if (isMac && key === "q") {
        event.preventDefault();
        void quitApp();
      } else if (isMac && key === "w") {
        event.preventDefault();
        void closeWindow();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [desktopRuntime, isMac, onNewChat, onOpenSearch, onRouteChange, onToggleSidebar, onToggleTerminal]);

  return (
    <header ref={topbarRef} className="app-topbar" data-tauri-drag-region onDoubleClick={handleTopBarDoubleClick} onMouseDown={handleTopBarMouseDown}>
      <div className="topbar-left">
        {isMac ? <WindowControls hostPlatform={hostPlatform} /> : null}
        <IconButton ariaLabel="Toggle sidebar" icon={PanelLeft} pressed={sidebarOpen} onClick={onToggleSidebar} />
        <TopBarMenus ariaLabel="Application menu" definitions={menuDefinitions} menus={menus} openMenu={openMenu} onOpenMenuChange={setOpenMenu} />
      </div>
      <div className="topbar-center">
        <img className="topbar-logo" src="/gilbert-codex-logo.svg" alt="" aria-hidden="true" draggable={false} />
        <span>{appInfo.name}</span>
      </div>
      {locationServicesEnabled ? <WeatherTopBarIndicator onOpenRadar={() => onRouteChange("radar")} /> : null}
      <div className="topbar-right" data-topbar-interactive="true">
        <AppUpdateIndicator controller={updateController} />
        {!isMac ? <WindowControls hostPlatform={hostPlatform} /> : null}
      </div>
    </header>
  );
}
