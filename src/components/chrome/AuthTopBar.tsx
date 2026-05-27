import { useEffect, useMemo, useRef, useState } from "react";
import { closeWindow, maximizeWindow, minimizeWindow, quitApp } from "../../app/windowClient";
import { useDismissableLayer } from "../../lib/useDismissableLayer";
import { runTopBarEditCommand } from "./topBarEditCommands";
import { TopBarMenus, type TopBarMenuAction, type TopBarMenuDefinition } from "./TopBarMenus";
import { handleTopBarDoubleClick, handleTopBarMouseDown } from "./topBarWindowInteractions";
import { WindowControls } from "./WindowControls";
import { formatShortcutForPlatform, getHostPlatform, isMacHostPlatform, type HostPlatform } from "../../lib/hostPlatform";

type AuthMenuId = "file" | "edit" | "view" | "window" | "help";
type AuthMode = "create" | "login";

interface AuthTopBarProps {
  activeMode: AuthMode;
  hasAccounts: boolean;
  hostPlatform?: HostPlatform;
  onModeChange: (mode: AuthMode) => void;
}

const menuDefinitions: TopBarMenuDefinition<AuthMenuId>[] = [
  { id: "file", label: "File" },
  { id: "edit", label: "Edit" },
  { id: "view", label: "View" },
  { id: "window", label: "Window" },
  { id: "help", label: "Help" },
];

export function AuthTopBar({ activeMode, hasAccounts, hostPlatform, onModeChange }: AuthTopBarProps) {
  const topbarRef = useRef<HTMLElement>(null);
  const [openMenu, setOpenMenu] = useState<AuthMenuId | null>(null);
  const resolvedHostPlatform = hostPlatform ?? getHostPlatform();
  const isMac = isMacHostPlatform(resolvedHostPlatform);
  const shortcut = (value: string) => formatShortcutForPlatform(value, resolvedHostPlatform);

  const menus = useMemo<Record<AuthMenuId, TopBarMenuAction[]>>(
    () => ({
      file: [
        { checked: activeMode === "create", label: "Create account", onSelect: () => onModeChange("create") },
        { checked: activeMode === "login", disabled: !hasAccounts, label: "Sign in", onSelect: () => onModeChange("login") },
        { danger: true, label: isMac ? "Quit Gilbert Codex" : "Exit", separatorBefore: true, shortcut: isMac ? "Command+Q" : undefined, onSelect: quitApp },
      ],
      edit: [
        { label: "Undo", shortcut: shortcut("Ctrl+Z"), onSelect: () => runTopBarEditCommand("undo") },
        { label: "Cut", shortcut: shortcut("Ctrl+X"), separatorBefore: true, onSelect: () => runTopBarEditCommand("cut") },
        { label: "Copy", shortcut: shortcut("Ctrl+C"), onSelect: () => runTopBarEditCommand("copy") },
        { label: "Paste", shortcut: shortcut("Ctrl+V"), onSelect: () => runTopBarEditCommand("paste") },
        { label: "Select all", shortcut: shortcut("Ctrl+A"), separatorBefore: true, onSelect: () => runTopBarEditCommand("selectAll") },
      ],
      view: [
        { checked: activeMode === "create", label: "Create account", onSelect: () => onModeChange("create") },
        { checked: activeMode === "login", disabled: !hasAccounts, label: "Sign in", onSelect: () => onModeChange("login") },
      ],
      window: [
        { label: "Minimize", shortcut: isMac ? "Command+M" : undefined, onSelect: minimizeWindow },
        { label: isMac ? "Zoom" : "Maximize or restore", onSelect: maximizeWindow },
        { danger: true, label: "Close window", separatorBefore: true, shortcut: isMac ? "Command+W" : undefined, onSelect: closeWindow },
      ],
      help: [{ label: "About Gilbert Codex", onSelect: () => undefined }],
    }),
    [activeMode, hasAccounts, isMac, onModeChange, shortcut],
  );

  useDismissableLayer({
    active: openMenu !== null,
    keyboardTarget: "window",
    onDismiss: () => setOpenMenu(null),
    refs: [topbarRef],
  });

  useEffect(() => {
    if (!isMac) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (!event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "q") {
        event.preventDefault();
        void quitApp();
      } else if (key === "w") {
        event.preventDefault();
        void closeWindow();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isMac]);

  return (
    <header ref={topbarRef} className="app-topbar auth-topbar" data-tauri-drag-region onDoubleClick={handleTopBarDoubleClick} onMouseDown={handleTopBarMouseDown}>
      <div className="topbar-left">
        {isMac ? <WindowControls hostPlatform={resolvedHostPlatform} /> : null}
        <TopBarMenus ariaLabel="Application menu" className="auth-topbar-menus" definitions={menuDefinitions} menus={menus} openMenu={openMenu} onOpenMenuChange={setOpenMenu} />
      </div>
      <div className="topbar-center">
        <img className="topbar-logo auth-topbar-logo" src="/gilbert-codex-logo.svg" alt="" aria-hidden="true" draggable={false} />
        <span>Gilbert Codex</span>
      </div>
      {!isMac ? <WindowControls hostPlatform={resolvedHostPlatform} /> : null}
    </header>
  );
}
