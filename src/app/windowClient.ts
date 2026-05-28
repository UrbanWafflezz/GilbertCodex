import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, type WindowOptions } from "@tauri-apps/api/window";
import type { WebviewOptions } from "@tauri-apps/api/webview";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { isTauriDesktopRuntime } from "./tauriClient";
import { getHostPlatform, isMacHostPlatform, type HostPlatform } from "../lib/hostPlatform";

type PlatformWebviewWindowOptions = Pick<WebviewOptions, "acceptFirstMouse"> & Pick<WindowOptions, "tabbingIdentifier">;

const MACOS_WEBVIEW_WINDOW_OPTIONS = {
  acceptFirstMouse: true,
  tabbingIdentifier: "gilbert-codex",
} satisfies PlatformWebviewWindowOptions;

async function withWindow(action: (window: ReturnType<typeof getCurrentWindow>) => Promise<void>) {
  try {
    await action(getCurrentWindow());
  } catch {
    return;
  }
}

export async function minimizeWindow() {
  await withWindow((window) => window.minimize());
}

export async function maximizeWindow() {
  await withWindow((window) => window.toggleMaximize());
}

export async function closeWindow() {
  await withWindow((window) => window.close());
}

export async function quitApp() {
  if (!isTauriDesktopRuntime()) {
    window.close();
    return;
  }

  try {
    await invoke<void>("app_quit");
  } catch {
    await closeWindow();
  }
}

export async function startWindowDrag() {
  await withWindow((window) => window.startDragging());
}

export async function bringCurrentWindowToForeground() {
  await withWindow(async (window) => {
    await window.show().catch(() => undefined);
    await window.unminimize().catch(() => undefined);
    await window.setFocus();
  });
}

export async function openChatWindow(chatId: string, title: string) {
  const url = createChatRouteUrl(chatId);

  if (!isTauriDesktopRuntime()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  const label = `chat-${sanitizeWindowLabel(chatId)}`;
  const existingWindow = await WebviewWindow.getByLabel(label);

  if (existingWindow) {
    await existingWindow.setFocus();
    return;
  }

  const webview = new WebviewWindow(label, {
    center: true,
    decorations: false,
    fullscreen: false,
    height: 740,
    maximized: false,
    minHeight: 560,
    minWidth: 800,
    preventOverflow: true,
    title: title.trim() || "Gilbert Codex",
    url,
    visible: false,
    width: 1120,
    ...getPlatformWebviewWindowOptions(),
  });

  await new Promise<void>((resolve, reject) => {
    void webview.once("tauri://created", () => resolve());
    void webview.once("tauri://error", (event) => reject(new Error(String(event.payload || "Could not open chat window."))));
  });

  await webview.show().catch(() => undefined);
  await webview.setFocus().catch(() => undefined);
}

export function createChatRouteUrl(chatId: string) {
  const currentUrl = new URL(window.location.href);
  currentUrl.hash = `chat=${encodeURIComponent(chatId)}`;
  return currentUrl.pathname + currentUrl.search + currentUrl.hash;
}

function sanitizeWindowLabel(value: string) {
  return value.replace(/[^a-zA-Z0-9-/:_]/g, "-").slice(0, 96) || `${Date.now()}`;
}

export function getPlatformWebviewWindowOptions(platform: HostPlatform | string | null | undefined = getHostPlatform()): PlatformWebviewWindowOptions {
  return isMacHostPlatform(platform) ? MACOS_WEBVIEW_WINDOW_OPTIONS : {};
}
