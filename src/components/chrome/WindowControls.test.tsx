import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AuthTopBar } from "./AuthTopBar";
import { WindowControls } from "./WindowControls";

vi.mock("../../app/windowClient", () => ({
  closeWindow: vi.fn(),
  maximizeWindow: vi.fn(),
  minimizeWindow: vi.fn(),
  quitApp: vi.fn(),
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
    const markup = renderToStaticMarkup(<AuthTopBar activeMode="create" hasAccounts={false} hostPlatform="linux" onModeChange={vi.fn()} />);

    expect(markup).toContain("auth-topbar-menus");
    expect(markup).toContain('aria-label="Maximize window"');
    expect(markup).toContain('class="window-controls"');
    expect(markup).not.toContain("window-controls-macos");
  });

  it("keeps auth chrome on the macOS layout when requested", () => {
    const markup = renderToStaticMarkup(<AuthTopBar activeMode="login" hasAccounts hostPlatform="macos" onModeChange={vi.fn()} />);

    expect(markup).toContain("window-controls-macos");
    expect(markup).toContain("macos-close-control");
    expect(markup).not.toContain('aria-label="Maximize window"');
  });
});
