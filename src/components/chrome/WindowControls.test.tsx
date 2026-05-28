import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AppTopBar, dispatchAppMenuCommand } from "./AppTopBar";
import { AuthTopBar } from "./AuthTopBar";
import { WindowControls } from "./WindowControls";
import type { AppMenuCommand } from "../../app/tauriClient";

vi.mock("../../app/windowClient", () => ({
  closeWindow: vi.fn(),
  maximizeWindow: vi.fn(),
  minimizeWindow: vi.fn(),
  quitApp: vi.fn(),
}));

vi.mock("../../app/tauriClient", () => ({
  checkForAppUpdate: vi.fn(),
  installAppUpdate: vi.fn(),
  isTauriDesktopRuntime: vi.fn(() => true),
  listenForAppMenuCommands: vi.fn(async () => vi.fn()),
}));

describe("desktop chrome platform rendering", () => {
  it("uses the same non-mac window controls for Linux and Windows", () => {
    const linux = renderToStaticMarkup(<WindowControls hostPlatform="linux" />);
    const windows = renderToStaticMarkup(<WindowControls hostPlatform="windows" />);

    expect(linux).toBe(windows);
    expect(linux).toContain('class="window-controls"');
    expect(linux).toContain('aria-label="Maximize window"');
    expect(linux).toContain('class="close-control"');
    expect(linux).not.toContain("window-controls-macos");
    expect(linux).not.toContain("macos-close-control");
  });

  it("keeps macOS on the traffic-light control layout", () => {
    const markup = renderToStaticMarkup(<WindowControls hostPlatform="macos" />);

    expect(markup).toContain("window-controls-macos");
    expect(markup).toContain("macos-close-control");
    expect(markup).toContain("macos-minimize-control");
    expect(markup).toContain("macos-zoom-control");
    expect(markup).not.toContain('aria-label="Maximize window"');
  });

  it("keeps auth chrome on the non-mac layout for Linux", () => {
    const markup = renderToStaticMarkup(<AuthTopBar activeMode="create" desktopRuntime hostPlatform="linux" onModeChange={vi.fn()} />);

    expect(markup).toContain("auth-topbar-menus");
    expect(markup).toContain('aria-label="Maximize window"');
    expect(markup).toContain('class="window-controls"');
    expect(markup).not.toContain("window-controls-macos");
  });

  it("keeps auth chrome on the macOS layout when requested", () => {
    const markup = renderToStaticMarkup(<AuthTopBar activeMode="login" desktopRuntime hostPlatform="macos" onModeChange={vi.fn()} />);

    expect(markup).toContain("window-controls-macos");
    expect(markup).toContain("macos-close-control");
    expect(markup).not.toContain("auth-topbar-menus");
    expect(markup).not.toContain(">File<");
    expect(markup).not.toContain('aria-label="Maximize window"');
  });

  it("keeps the in-window application menus on Windows and Linux desktop", () => {
    const windows = renderToStaticMarkup(<TestAppTopBar hostPlatform="windows" />);
    const linux = renderToStaticMarkup(<TestAppTopBar hostPlatform="linux" />);

    expect(windows).toContain('aria-label="Application menu"');
    expect(windows).toContain(">File<");
    expect(windows).toContain(">Help<");
    expect(windows).not.toContain("window-controls-macos");
    expect(linux).toContain('aria-label="Application menu"');
    expect(linux).toContain(">File<");
    expect(linux).toContain(">Help<");
    expect(linux).not.toContain("window-controls-macos");
  });

  it("removes the duplicate in-window application menus on macOS desktop", () => {
    const markup = renderToStaticMarkup(<TestAppTopBar hostPlatform="macos" />);

    expect(markup).toContain("window-controls-macos");
    expect(markup).toContain('aria-label="Toggle sidebar"');
    expect(markup).not.toContain('aria-label="Application menu"');
    expect(markup).not.toContain(">File<");
    expect(markup).not.toContain(">Help<");
    expect(markup).not.toContain('aria-label="Maximize window"');
  });

  it("routes native macOS app menu commands to the same topbar actions", () => {
    const actions = {
      locationServicesEnabled: true,
      onAppearanceModeChange: vi.fn(),
      onCheckForUpdates: vi.fn(),
      onNewChat: vi.fn(),
      onOpenSearch: vi.fn(),
      onRouteChange: vi.fn(),
      onShowAbout: vi.fn(),
      onToggleSidebar: vi.fn(),
      onToggleTerminal: vi.fn(),
    };
    const commands: AppMenuCommand[] = [
      "new-chat",
      "search-chats",
      "settings",
      "show-chat",
      "show-apps",
      "show-tasks",
      "show-radar",
      "toggle-sidebar",
      "toggle-terminal",
      "appearance-system",
      "appearance-dark",
      "appearance-light",
      "check-updates",
      "show-about",
    ];

    for (const command of commands) {
      dispatchAppMenuCommand(command, actions);
    }

    expect(actions.onNewChat).toHaveBeenCalledTimes(1);
    expect(actions.onOpenSearch).toHaveBeenCalledTimes(1);
    expect(actions.onRouteChange).toHaveBeenCalledWith("settings");
    expect(actions.onRouteChange).toHaveBeenCalledWith("chat");
    expect(actions.onRouteChange).toHaveBeenCalledWith("apps");
    expect(actions.onRouteChange).toHaveBeenCalledWith("tasks");
    expect(actions.onRouteChange).toHaveBeenCalledWith("radar");
    expect(actions.onToggleSidebar).toHaveBeenCalledTimes(1);
    expect(actions.onToggleTerminal).toHaveBeenCalledTimes(1);
    expect(actions.onAppearanceModeChange).toHaveBeenCalledWith("system");
    expect(actions.onAppearanceModeChange).toHaveBeenCalledWith("dark");
    expect(actions.onAppearanceModeChange).toHaveBeenCalledWith("light");
    expect(actions.onCheckForUpdates).toHaveBeenCalledTimes(1);
    expect(actions.onShowAbout).toHaveBeenCalledTimes(1);
  });

  it("keeps the native Radar menu command inert when location services are off", () => {
    const actions = {
      locationServicesEnabled: false,
      onAppearanceModeChange: vi.fn(),
      onCheckForUpdates: vi.fn(),
      onNewChat: vi.fn(),
      onOpenSearch: vi.fn(),
      onRouteChange: vi.fn(),
      onShowAbout: vi.fn(),
      onToggleSidebar: vi.fn(),
      onToggleTerminal: vi.fn(),
    };

    dispatchAppMenuCommand("show-radar", actions);

    expect(actions.onRouteChange).not.toHaveBeenCalled();
  });
});

function TestAppTopBar({ hostPlatform }: { hostPlatform: "linux" | "macos" | "windows" }) {
  return (
    <AppTopBar
      activeRoute="chat"
      appInfo={{
        arch: "test",
        name: "Gilbert Codex",
        phase: "Test",
        platform: hostPlatform,
        runtime: "Desktop",
        version: "0.0.0",
      }}
      appearanceMode="dark"
      desktopRuntime
      hostPlatform={hostPlatform}
      locationServicesEnabled={false}
      sidebarOpen={false}
      terminalOpen={false}
      onAppearanceModeChange={vi.fn()}
      onNewChat={vi.fn()}
      onOpenSearch={vi.fn()}
      onRouteChange={vi.fn()}
      onShowAbout={vi.fn()}
      onToggleSidebar={vi.fn()}
      onToggleTerminal={vi.fn()}
    />
  );
}
