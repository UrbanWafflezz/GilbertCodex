import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { getPlatformWebviewWindowOptions } from "./windowClient";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: class {
    static getByLabel = vi.fn(async () => null);
  },
}));

vi.mock("./tauriClient", () => ({
  isTauriDesktopRuntime: vi.fn(() => false),
}));

type TauriWindowConfig = {
  acceptFirstMouse?: boolean;
  tabbingIdentifier?: string;
};

type TauriConfig = {
  app?: {
    windows?: TauriWindowConfig[];
  };
};

function readTauriConfig(path: string): TauriConfig {
  return JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")) as TauriConfig;
}

function readText(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

describe("platform window options", () => {
  it("enables native first-click and tab grouping only for macOS webview windows", () => {
    expect(getPlatformWebviewWindowOptions("macos")).toEqual({
      acceptFirstMouse: true,
      tabbingIdentifier: "gilbert-codex",
    });
    expect(getPlatformWebviewWindowOptions("darwin")).toEqual({
      acceptFirstMouse: true,
      tabbingIdentifier: "gilbert-codex",
    });
    expect(getPlatformWebviewWindowOptions("windows")).toEqual({});
    expect(getPlatformWebviewWindowOptions("linux")).toEqual({});
    expect(getPlatformWebviewWindowOptions("unknown")).toEqual({});
  });

  it("keeps the main macOS app window on the same native options in dev and release configs", () => {
    const expected = {
      acceptFirstMouse: true,
      tabbingIdentifier: "gilbert-codex",
    };

    expect(readTauriConfig("src-tauri/tauri.macos.conf.json").app?.windows?.[0]).toMatchObject(expected);
    expect(readTauriConfig("src-tauri/tauri.macos.updater.conf.json").app?.windows?.[0]).toMatchObject(expected);
  });

  it("does not add macOS-only window behavior to Linux or default Windows config", () => {
    const linuxConfig = readText("src-tauri/tauri.linux.conf.json");
    const defaultConfig = readText("src-tauri/tauri.conf.json");

    expect(linuxConfig).not.toContain("acceptFirstMouse");
    expect(linuxConfig).not.toContain("tabbingIdentifier");
    expect(defaultConfig).not.toContain("acceptFirstMouse");
    expect(defaultConfig).not.toContain("tabbingIdentifier");
  });
});
