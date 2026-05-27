import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AppInfo } from "../types/app";
import type { DiscordBridgeResponseStyle, DiscordTunnelProvider } from "../types/discord";
import type { ProjectOpenTargetId } from "../types/projectOpen";
import { getHostPlatform } from "../lib/hostPlatform";
import { unregisterBackgroundTerminalSession } from "../lib/terminalSessions";
import type {
  TerminalCreateSessionRequest,
  TerminalCreateSessionResponse,
  TerminalDrainResponse,
  TerminalRunCommandRequest,
  TerminalRunCommandResponse,
} from "../types/terminal";

declare global {
  interface Window {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  }
}

const fallbackAppInfo: AppInfo = {
  name: "Gilbert Codex",
  version: "0.5.6",
  phase: "Public alpha",
  runtime: "Browser preview",
  platform: getHostPlatform(),
  arch: "browser",
};

const DISCORD_INTERACTION_EVENT = "discord-interaction";
const DISCORD_BRIDGE_STATUS_EVENT = "discord-bridge-status";
const DESKTOP_NOTIFICATION_ACTIVATED_EVENT = "desktop-notification-activated";
const MOBILE_BRIDGE_UPDATED_EVENT = "mobile-bridge-updated";

export type DesktopNotificationKind = "completion" | "permission" | "question";

export interface NativeDesktopNotificationRequest {
  body: string;
  chatId?: string;
  id: number;
  kind: DesktopNotificationKind;
  title: string;
}

export interface NativeDesktopNotificationActivation {
  chatId?: string;
  kind?: DesktopNotificationKind;
}

/** Request shape for the native browser-preview helper. */
export interface BrowserAutomationRequest {
  action: "assert_text" | "click_link" | "inspect" | "open";
  text?: string;
  url: string;
}

/** Normalized browser inspection result returned by Rust. */
export interface BrowserAutomationResponse {
  action: string;
  links: Array<{
    href: string;
    text: string;
  }>;
  matched: boolean;
  status: number;
  targetUrl?: string | null;
  textSnippet: string;
  title: string;
  url: string;
}

export interface BrowserPreviewCaptureClip {
  height: number;
  scale?: number;
  width: number;
  x: number;
  y: number;
}

export interface BrowserPreviewCaptureRequest {
  clip?: BrowserPreviewCaptureClip;
  format?: "png";
  label?: string;
}

export interface BrowserPreviewCaptureResponse {
  clip?: BrowserPreviewCaptureClip | null;
  dataUrl: string;
  label: string;
  mimeType: string;
  sizeBytes: number;
  url?: string | null;
}

export type NativeDictationState =
  | "blocked"
  | "error"
  | "idle"
  | "missingModel"
  | "ready"
  | "recording"
  | "transcribing"
  | "warming";

export interface NativeDictationStatus {
  accelerator: string;
  canFallback: boolean;
  engine: string;
  gpuAvailable: boolean;
  gpuDeviceId?: number | null;
  gpuDeviceName?: string | null;
  message: string;
  model: string;
  modelAvailable: boolean;
  modelLoaded: boolean;
  modelPath?: string | null;
  recordingDurationMs?: number | null;
  sampleRate?: number | null;
  state: NativeDictationState;
}

export interface NativeDictationStopResponse {
  durationMs: number;
  status: NativeDictationStatus;
  transcript: string;
}

export interface NativeDictationStopRequest {
  dictionary?: string;
}

export interface NativeDictationAudioLevelResponse {
  level: number;
  peak: number;
  recordingDurationMs?: number | null;
  sampleRate?: number | null;
  state: NativeDictationState;
}

export interface UserConfigInfo {
  exists: boolean;
  hasDeprecatedHooksFlag: boolean;
  message: string;
  path: string;
}

export interface WorkspaceDependencyDiagnostic {
  codexVersion?: string | null;
  details: string[];
  message: string;
  nodePath: string;
  nodeVersion?: string | null;
  pythonPath: string;
  pythonVersion?: string | null;
  status: "error" | "success" | string;
  version: string;
}

export interface DiscordBridgeStartRequest {
  allowedChannelIds?: string;
  allowedGuildIds?: string;
  applicationId: string;
  configKey?: string;
  localPort?: number;
  ngrokAuthToken?: string;
  ngrokPath?: string;
  publicKey: string;
  responseStyle?: DiscordBridgeResponseStyle;
  tunnelProvider?: DiscordTunnelProvider;
}

export interface DiscordBridgeStatus {
  configKey?: string | null;
  error?: string | null;
  localUrl?: string | null;
  message: string;
  port?: number | null;
  publicUrl?: string | null;
  running: boolean;
  tunnelProvider?: DiscordTunnelProvider | null;
}

export interface DiscordSlashCommandRegisterResponse {
  commandId: string;
  commandName: string;
  guildId?: string | null;
  message: string;
  scope: "guild" | "global" | string;
}

export interface DiscordInteractionEvent {
  applicationId: string;
  channelId?: string | null;
  commandName?: string | null;
  guildId?: string | null;
  id: string;
  prompt: string;
  receivedAt: number;
  token: string;
  userId?: string | null;
  username?: string | null;
}

export interface AppUpdateCheckResponse {
  available: boolean;
  body?: string | null;
  currentVersion: string;
  date?: string | null;
  feedStatus?: "ready" | "missing";
  message?: string | null;
  target?: string | null;
  version?: string | null;
}

export interface WeatherFetchJsonRequest {
  token?: string;
  url: string;
}

export interface WeatherFetchJsonResponse {
  contentType?: string | null;
  payload: unknown;
  status: number;
  url: string;
}

export interface ProjectOpenRequest {
  path: string;
  target: ProjectOpenTargetId;
}

export interface ProjectOpenResponse {
  message: string;
  path: string;
  target: ProjectOpenTargetId;
  targetLabel: string;
}

export type AppUpdateInstallEvent =
  | {
      event: "started";
      data: {
        contentLength?: number | null;
      };
    }
  | {
      event: "progress";
      data: {
        chunkLength: number;
        contentLength?: number | null;
        downloaded: number;
      };
    }
  | {
      event: "finished";
      data?: null;
    };

export interface NineRouterLocalStatus {
  baseUrl: string;
  autoStartEnabled: boolean;
  built: boolean;
  dashboardUrl: string;
  lanBaseUrls?: string[];
  lanDashboardUrls?: string[];
  dataDir?: string | null;
  dockerVersion?: string | null;
  gitVersion?: string | null;
  installDir?: string | null;
  installed: boolean;
  launchSupported: boolean;
  launched: boolean;
  message: string;
  nodeVersion?: string | null;
  npmVersion?: string | null;
  pid?: number | null;
  running: boolean;
}

export type NineRouterInstallEvent =
  | {
      event: "started";
      data: {
        message: string;
      };
    }
  | {
      event: "step";
      data: {
        message: string;
      };
    }
  | {
      event: "output";
      data: {
        label: string;
        stderr: string;
        stdout: string;
      };
    }
  | {
      event: "finished";
      data: {
        status: NineRouterLocalStatus;
      };
    };

export interface NineRouterHttpRequest {
  body?: string;
  headers?: Record<string, string>;
  method: "DELETE" | "GET" | "PATCH" | "POST" | "PUT";
  timeoutMs?: number;
  url: string;
}

export interface NineRouterHttpResponse {
  body: string;
  headers: Record<string, string>;
  status: number;
}

export type NineRouterHttpStreamEvent =
  | {
      event: "started";
      data: {
        headers: Record<string, string>;
        status: number;
      };
    }
  | {
      event: "chunk";
      data: {
        bytesBase64: string;
      };
    }
  | {
      event: "finished";
      data?: null;
    };

export interface NineRouterOAuthCallbackStartResponse {
  id: string;
  redirectUri: string;
}

export interface NineRouterOAuthCallbackResponse {
  code?: string | null;
  error?: string | null;
  errorDescription?: string | null;
  state?: string | null;
}

export interface MobileBridgeStartRequest {
  port?: number;
}

export interface MobileBridgeStatus {
  baseUrl?: string | null;
  desktopName: string;
  desktopSyncVersion: number;
  emulatorUrl?: string | null;
  lanUrls: string[];
  lastMobileSyncAt?: number | null;
  pairingPayload?: string | null;
  port?: number | null;
  queuedMobilePayloads: number;
  queuedMobileRequests: number;
  running: boolean;
  startedAt?: number | null;
  token?: string | null;
}

export interface MobileBridgeUpdateEvent {
  kind?: "payload" | "request";
  lastMobileSyncAt?: number | null;
  queuedMobilePayloads?: number;
  queuedMobileRequests?: number;
}

/** Detects the desktop runtime before invoking Tauri-only commands. */
export function isTauriDesktopRuntime() {
  return Boolean(isTauri()) || (typeof window !== "undefined" && (Boolean(window.__TAURI_INTERNALS__) || Boolean(window.__TAURI__)));
}

/** Reads app metadata from Rust and falls back for browser-only previews. */
export async function getAppInfo(): Promise<AppInfo> {
  try {
    return await invoke<AppInfo>("get_app_info");
  } catch {
    return fallbackAppInfo;
  }
}

export async function openExternalUrl(url: string): Promise<void> {
  if (!isTauriDesktopRuntime()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  await invoke<void>("open_external_url", { url });
}

export async function openProjectInExternalTool(request: ProjectOpenRequest): Promise<ProjectOpenResponse> {
  if (!isTauriDesktopRuntime()) {
    throw new Error("Opening projects in local apps is available in the desktop app.");
  }

  return invoke<ProjectOpenResponse>("project_open_external_tool", { request });
}

export async function showNativeDesktopNotification(request: NativeDesktopNotificationRequest): Promise<boolean> {
  if (!isTauriDesktopRuntime()) {
    return false;
  }

  try {
    return await invoke<boolean>("desktop_notification_show", { request });
  } catch {
    return false;
  }
}

export async function listenForDesktopNotificationActivations(onActivation: (activation: NativeDesktopNotificationActivation) => void): Promise<UnlistenFn> {
  if (!isTauriDesktopRuntime()) {
    return () => undefined;
  }

  return await listen<NativeDesktopNotificationActivation>(DESKTOP_NOTIFICATION_ACTIVATED_EVENT, (event) => {
    onActivation(event.payload);
  });
}

export async function ensureNineRouterLocal(): Promise<NineRouterLocalStatus> {
  if (!isTauriDesktopRuntime()) {
    return {
      baseUrl: "http://127.0.0.1:20128/v1",
      autoStartEnabled: false,
      built: false,
      dashboardUrl: "http://127.0.0.1:20128",
      dataDir: null,
      dockerVersion: null,
      gitVersion: null,
      installDir: null,
      installed: false,
      launchSupported: false,
      launched: false,
      message: "Subscriptions start when you use subscription routing in the desktop app.",
      nodeVersion: null,
      npmVersion: null,
      pid: null,
      running: false,
    };
  }

  return invoke<NineRouterLocalStatus>("nine_router_local_ensure");
}

export async function setNineRouterLocalAutoStart(enabled: boolean): Promise<NineRouterLocalStatus> {
  if (!isTauriDesktopRuntime()) {
    return {
      baseUrl: "http://127.0.0.1:20128/v1",
      autoStartEnabled: enabled,
      built: false,
      dashboardUrl: "http://127.0.0.1:20128",
      dataDir: null,
      dockerVersion: null,
      gitVersion: null,
      installDir: null,
      installed: false,
      launchSupported: false,
      launched: false,
      message: enabled ? "Subscription auto-start is available in the desktop app." : "Subscription auto-start is disabled.",
      nodeVersion: null,
      npmVersion: null,
      pid: null,
      running: false,
    };
  }

  return invoke<NineRouterLocalStatus>("nine_router_local_set_auto_start", { enabled });
}

export async function getNineRouterLocalStatus(): Promise<NineRouterLocalStatus> {
  if (!isTauriDesktopRuntime()) {
    return ensureNineRouterLocal();
  }

  return invoke<NineRouterLocalStatus>("nine_router_local_status");
}

export async function stopNineRouterLocal(): Promise<NineRouterLocalStatus> {
  if (!isTauriDesktopRuntime()) {
    return {
      baseUrl: "http://127.0.0.1:20128/v1",
      autoStartEnabled: false,
      built: false,
      dashboardUrl: "http://127.0.0.1:20128",
      dataDir: null,
      dockerVersion: null,
      gitVersion: null,
      installDir: null,
      installed: false,
      launchSupported: false,
      launched: false,
      message: "Subscription stop is available in the desktop app.",
      nodeVersion: null,
      npmVersion: null,
      pid: null,
      running: false,
    };
  }

  return invoke<NineRouterLocalStatus>("nine_router_local_stop");
}

export async function uninstallNineRouterLocal(): Promise<NineRouterLocalStatus> {
  if (!isTauriDesktopRuntime()) {
    throw new Error("Sandbox subscriptions can be uninstalled from the desktop app.");
  }

  return invoke<NineRouterLocalStatus>("nine_router_local_uninstall");
}

export async function installNineRouterLocal(onEvent: (event: NineRouterInstallEvent) => void): Promise<NineRouterLocalStatus> {
  if (!isTauriDesktopRuntime()) {
    throw new Error("Subscription setup is available in the desktop app.");
  }

  const onEventChannel = new Channel<NineRouterInstallEvent>(onEvent);
  return invoke<NineRouterLocalStatus>("nine_router_local_install", { onEvent: onEventChannel });
}

export async function nineRouterLocalHttp(request: NineRouterHttpRequest): Promise<NineRouterHttpResponse> {
  if (!isTauriDesktopRuntime()) {
    const response = await fetch(request.url, {
      body: request.body,
      headers: request.headers,
      method: request.method,
    });

    return {
      body: await response.text(),
      headers: Object.fromEntries(response.headers.entries()),
      status: response.status,
    };
  }

  return invoke<NineRouterHttpResponse>("nine_router_local_http", { request });
}

export async function nineRouterLocalStream(request: NineRouterHttpRequest, onEvent: (event: NineRouterHttpStreamEvent) => void): Promise<void> {
  if (!isTauriDesktopRuntime()) {
    throw new Error("Subscription streaming is available in the desktop app.");
  }

  const onEventChannel = new Channel<NineRouterHttpStreamEvent>(onEvent);
  return invoke<void>("nine_router_local_stream", { request, onEvent: onEventChannel });
}

export async function startNineRouterOAuthCallback(): Promise<NineRouterOAuthCallbackStartResponse> {
  if (!isTauriDesktopRuntime()) {
    throw new Error("Subscription account sign-in is available in the desktop app.");
  }

  return invoke<NineRouterOAuthCallbackStartResponse>("nine_router_oauth_callback_start");
}

export async function finishNineRouterOAuthCallback(id: string, timeoutMs = 300_000): Promise<NineRouterOAuthCallbackResponse> {
  if (!isTauriDesktopRuntime()) {
    throw new Error("Subscription account sign-in is available in the desktop app.");
  }

  return invoke<NineRouterOAuthCallbackResponse>("nine_router_oauth_callback_finish", {
    request: { id, timeoutMs },
  });
}

export async function startMobileBridge(request?: MobileBridgeStartRequest): Promise<MobileBridgeStatus> {
  if (!isTauriDesktopRuntime()) {
    return createBrowserMobileBridgeStatus(false);
  }

  return invoke<MobileBridgeStatus>("mobile_bridge_start", { request: request ?? null });
}

export async function getMobileBridgeStatus(): Promise<MobileBridgeStatus> {
  if (!isTauriDesktopRuntime()) {
    return createBrowserMobileBridgeStatus(false);
  }

  return invoke<MobileBridgeStatus>("mobile_bridge_status");
}

export async function stopMobileBridge(): Promise<MobileBridgeStatus> {
  if (!isTauriDesktopRuntime()) {
    return createBrowserMobileBridgeStatus(false);
  }

  return invoke<MobileBridgeStatus>("mobile_bridge_stop");
}

export async function resetMobileBridgePairing(): Promise<MobileBridgeStatus> {
  if (!isTauriDesktopRuntime()) {
    return createBrowserMobileBridgeStatus(false);
  }

  return invoke<MobileBridgeStatus>("mobile_bridge_reset_pairing");
}

export async function updateMobileBridgeDesktopPayload(payload: unknown): Promise<MobileBridgeStatus> {
  if (!isTauriDesktopRuntime()) {
    return createBrowserMobileBridgeStatus(false);
  }

  return invoke<MobileBridgeStatus>("mobile_bridge_update_desktop_payload", { payload });
}

export async function takeMobileBridgePayloads(): Promise<unknown[]> {
  if (!isTauriDesktopRuntime()) {
    return [];
  }

  return invoke<unknown[]>("mobile_bridge_take_mobile_payloads");
}

export async function takeMobileBridgeRequests(): Promise<unknown[]> {
  if (!isTauriDesktopRuntime()) {
    return [];
  }

  return invoke<unknown[]>("mobile_bridge_take_mobile_requests");
}

export async function listenForMobileBridgeUpdates(onUpdate: (update: MobileBridgeUpdateEvent) => void): Promise<UnlistenFn> {
  if (!isTauriDesktopRuntime()) {
    return () => undefined;
  }

  return await listen<MobileBridgeUpdateEvent>(MOBILE_BRIDGE_UPDATED_EVENT, (event) => {
    onUpdate(event.payload);
  });
}

export async function checkForAppUpdate(): Promise<AppUpdateCheckResponse> {
  if (!isTauriDesktopRuntime()) {
    return {
      available: false,
      currentVersion: fallbackAppInfo.version,
      feedStatus: "ready",
    };
  }

  return invoke<AppUpdateCheckResponse>("app_update_check");
}

export async function installAppUpdate(onEvent: (event: AppUpdateInstallEvent) => void): Promise<void> {
  if (!isTauriDesktopRuntime()) {
    throw new Error("App updates are available in the desktop app.");
  }

  const onEventChannel = new Channel<AppUpdateInstallEvent>(onEvent);
  return invoke<void>("app_update_install", { onEvent: onEventChannel });
}

/** Runs one native browser automation action from the in-app browser preview. */
export async function runBrowserAutomation(request: BrowserAutomationRequest): Promise<BrowserAutomationResponse> {
  return invoke<BrowserAutomationResponse>("browser_automation", { request });
}

/** Captures the current in-app browser preview as a PNG data URL. */
export async function captureBrowserPreview(request: BrowserPreviewCaptureRequest): Promise<BrowserPreviewCaptureResponse> {
  if (!isTauriDesktopRuntime()) {
    throw new Error("Browser screenshot capture is available in the desktop app.");
  }

  return invoke<BrowserPreviewCaptureResponse>("browser_preview_capture", { request });
}

export async function getNativeDictationStatus(): Promise<NativeDictationStatus> {
  if (!isTauriDesktopRuntime()) {
    return createBrowserDictationStatus();
  }

  return invoke<NativeDictationStatus>("dictation_status");
}

export async function prepareNativeDictation(): Promise<NativeDictationStatus> {
  if (!isTauriDesktopRuntime()) {
    return createBrowserDictationStatus();
  }

  return invoke<NativeDictationStatus>("dictation_prepare");
}

export async function startNativeDictation(): Promise<NativeDictationStatus> {
  if (!isTauriDesktopRuntime()) {
    return createBrowserDictationStatus();
  }

  return invoke<NativeDictationStatus>("dictation_start");
}

export async function stopNativeDictation(request?: NativeDictationStopRequest): Promise<NativeDictationStopResponse> {
  if (!isTauriDesktopRuntime()) {
    throw new Error("Offline dictation is available in the desktop app.");
  }

  return invoke<NativeDictationStopResponse>("dictation_stop", { request });
}

export async function cancelNativeDictation(): Promise<NativeDictationStatus> {
  if (!isTauriDesktopRuntime()) {
    return createBrowserDictationStatus();
  }

  return invoke<NativeDictationStatus>("dictation_cancel");
}

export async function getNativeDictationAudioLevel(): Promise<NativeDictationAudioLevelResponse> {
  if (!isTauriDesktopRuntime()) {
    return {
      level: 0,
      peak: 0,
      recordingDurationMs: null,
      sampleRate: null,
      state: "idle",
    };
  }

  return invoke<NativeDictationAudioLevelResponse>("dictation_audio_level");
}

export async function fetchWeatherJson(request: WeatherFetchJsonRequest): Promise<WeatherFetchJsonResponse> {
  if (isTauriDesktopRuntime()) {
    return invoke<WeatherFetchJsonResponse>("weather_fetch_json", { request });
  }

  const url = validateBrowserWeatherFetchUrl(request.url);
  const headers: Record<string, string> = {
    Accept: "application/geo+json, application/ld+json, application/json, text/csv, text/plain;q=0.8, */*;q=0.5",
  };

  if (shouldAttachBrowserWeatherToken(url) && request.token?.trim()) {
    headers.token = request.token.trim();
  }

  const response = await fetch(url.href, {
    cache: "no-store",
    headers,
    method: "GET",
  });
  const contentType = response.headers.get("content-type");
  const text = await response.text();
  const payload = parseWeatherResponsePayload(text);

  if (!response.ok) {
    throw new Error(`Weather request failed with HTTP ${response.status}: ${summarizeWeatherPayload(payload)}`);
  }

  return {
    contentType,
    payload,
    status: response.status,
    url: response.url || url.href,
  };
}

const BROWSER_WEATHER_ALLOWED_HOSTS = [
  "api.open-meteo.com",
  "geocoding-api.open-meteo.com",
  "noaa.gov",
  "weather.gov",
  "api.weather.gov",
  "digital.weather.gov",
  "forecast.weather.gov",
  "mapservices.weather.noaa.gov",
  "www.ncei.noaa.gov",
  "www.nws.noaa.gov",
  "opengeo.ncep.noaa.gov",
  "mrms.ncep.noaa.gov",
  "nomads.ncep.noaa.gov",
  "radar.weather.gov",
  "water.noaa.gov",
  "api.water.noaa.gov",
  "api.tidesandcurrents.noaa.gov",
  "aviationweather.gov",
  "www.aviationweather.gov",
  "www.nhc.noaa.gov",
  "www.spc.noaa.gov",
  "www.cpc.ncep.noaa.gov",
  "www.swpc.noaa.gov",
  "api.weather.gc.ca",
  "dd.weather.gc.ca",
  "weather.gc.ca",
  "dwd.de",
  "opendata.dwd.de",
  "maps.dwd.de",
  "api.meteoalarm.org",
  "feeds.meteoalarm.org",
  "meteoalarm.org",
  "api.met.no",
  "thredds.met.no",
  "met.no",
  "bom.gov.au",
  "reg.bom.gov.au",
  "sws-data.sws.bom.gov.au",
  "cma.gov.cn",
  "data.cma.cn",
  "smn.conagua.gob.mx",
  "conagua.gob.mx",
  "www.gob.mx",
  "alertingauthority.wmo.int",
  "worldweather.wmo.int",
  "severeweather.wmo.int",
  "wmo.int",
];

function validateBrowserWeatherFetchUrl(rawUrl: string) {
  const url = new URL(rawUrl.trim());

  if (url.protocol !== "https:") {
    throw new Error("Weather requests must use https URLs.");
  }

  const host = url.hostname.toLowerCase();
  if (!BROWSER_WEATHER_ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
    throw new Error(`Weather requests are limited to registered weather provider hosts. Blocked host: ${host}`);
  }

  return url;
}

function shouldAttachBrowserWeatherToken(url: URL) {
  return url.hostname.toLowerCase() === "www.ncei.noaa.gov" && url.pathname.startsWith("/cdo-web/");
}

export async function getUserConfigInfo(): Promise<UserConfigInfo> {
  if (!isTauriDesktopRuntime()) {
    return {
      exists: false,
      hasDeprecatedHooksFlag: false,
      message: "Open the desktop app to manage config.toml.",
      path: "~/.codex/config.toml",
    };
  }

  return invoke<UserConfigInfo>("settings_get_user_config");
}

export async function openUserConfig(): Promise<UserConfigInfo> {
  if (!isTauriDesktopRuntime()) {
    throw new Error("Open config.toml is available in the desktop app.");
  }

  return invoke<UserConfigInfo>("settings_open_user_config");
}

export async function diagnoseWorkspaceDependencies(): Promise<WorkspaceDependencyDiagnostic> {
  if (!isTauriDesktopRuntime()) {
    return createWorkspaceDependencyPreviewDiagnostic("Open the desktop app to diagnose bundled workspace dependencies.");
  }

  return invoke<WorkspaceDependencyDiagnostic>("workspace_dependencies_diagnose");
}

export async function reinstallWorkspaceDependencies(): Promise<WorkspaceDependencyDiagnostic> {
  if (!isTauriDesktopRuntime()) {
    return createWorkspaceDependencyPreviewDiagnostic("Open the desktop app to reset or reinstall bundled workspace dependencies.");
  }

  return invoke<WorkspaceDependencyDiagnostic>("workspace_dependencies_reinstall");
}

export async function getDiscordBridgeStatus(): Promise<DiscordBridgeStatus> {
  if (!isTauriDesktopRuntime()) {
    return {
      message: "Open the desktop app to run the Discord bridge.",
      running: false,
    };
  }

  return invoke<DiscordBridgeStatus>("discord_bridge_status");
}

export async function startDiscordBridge(request: DiscordBridgeStartRequest): Promise<DiscordBridgeStatus> {
  if (!isTauriDesktopRuntime()) {
    throw new Error("Open the desktop app to start the Discord bridge.");
  }

  return invoke<DiscordBridgeStatus>("discord_bridge_start", { request });
}

export async function stopDiscordBridge(): Promise<DiscordBridgeStatus> {
  if (!isTauriDesktopRuntime()) {
    return {
      message: "The Discord bridge only runs in the desktop app.",
      running: false,
    };
  }

  return invoke<DiscordBridgeStatus>("discord_bridge_stop");
}

export async function sendDiscordInteractionResponse(request: { applicationId: string; content: string; token: string }): Promise<void> {
  if (!isTauriDesktopRuntime()) {
    throw new Error("Discord interaction responses are only available in the desktop app.");
  }

  return invoke<void>("discord_bridge_send_interaction_response", { request });
}

export async function sendDiscordChannelMessage(request: { botToken: string; channelId: string; content: string }): Promise<void> {
  if (!isTauriDesktopRuntime()) {
    throw new Error("Discord channel messages are only available in the desktop app.");
  }

  return invoke<void>("discord_bridge_send_channel_message", { request });
}

export async function sendDiscordWebhookMessage(request: { content: string; webhookUrl: string }): Promise<void> {
  if (!isTauriDesktopRuntime()) {
    throw new Error("Discord webhook messages are only available in the desktop app.");
  }

  return invoke<void>("discord_bridge_send_webhook_message", { request });
}

export async function registerDiscordSlashCommand(request: {
  applicationId: string;
  botToken: string;
  commandName?: string;
  guildId?: string;
}): Promise<DiscordSlashCommandRegisterResponse> {
  if (!isTauriDesktopRuntime()) {
    throw new Error("Registering Discord slash commands is only available in the desktop app.");
  }

  return invoke<DiscordSlashCommandRegisterResponse>("discord_register_slash_command", { request });
}

export async function listenForDiscordInteractions(onInteraction: (interaction: DiscordInteractionEvent) => void) {
  if (!isTauriDesktopRuntime()) {
    return () => undefined;
  }

  return await listen<DiscordInteractionEvent>(DISCORD_INTERACTION_EVENT, (event) => {
    onInteraction(event.payload);
  });
}

/** Listens for Discord bridge health updates emitted by the Rust command layer. */
export async function listenForDiscordBridgeStatus(onStatus: (status: DiscordBridgeStatus) => void) {
  if (!isTauriDesktopRuntime()) {
    return () => undefined;
  }

  return await listen<DiscordBridgeStatus>(DISCORD_BRIDGE_STATUS_EVENT, (event) => {
    onStatus(event.payload);
  });
}

function createWorkspaceDependencyPreviewDiagnostic(message: string): WorkspaceDependencyDiagnostic {
  return {
    details: [message],
    message,
    nodePath: "",
    nodeVersion: null,
    pythonPath: "",
    pythonVersion: null,
    status: "error",
    version: "desktop-only",
  };
}

function createBrowserMobileBridgeStatus(running: boolean): MobileBridgeStatus {
  return {
    baseUrl: null,
    desktopName: "Browser preview",
    desktopSyncVersion: 0,
    emulatorUrl: null,
    lanUrls: [],
    lastMobileSyncAt: null,
    pairingPayload: null,
    port: null,
    queuedMobilePayloads: 0,
    queuedMobileRequests: 0,
    running,
    startedAt: null,
    token: null,
  };
}

function createBrowserDictationStatus(): NativeDictationStatus {
  return {
    accelerator: "browser",
    canFallback: true,
    engine: "browser-speech",
    gpuAvailable: false,
    gpuDeviceId: null,
    gpuDeviceName: null,
    message: "Offline Whisper dictation is available in the desktop app.",
    model: "Browser speech recognition",
    modelAvailable: false,
    modelLoaded: false,
    modelPath: null,
    recordingDurationMs: null,
    sampleRate: null,
    state: "missingModel",
  };
}

function parseWeatherResponsePayload(text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { text };
  }
}

function summarizeWeatherPayload(payload: unknown) {
  if (typeof payload === "object" && payload) {
    const record = payload as Record<string, unknown>;
    const message = record.detail ?? record.message ?? record.errorMessage ?? record.text;

    if (typeof message === "string" && message.trim()) {
      return message.trim().slice(0, 600);
    }
  }

  if (typeof payload === "string") {
    return payload.trim().slice(0, 600);
  }

  try {
    return JSON.stringify(payload).slice(0, 600);
  } catch {
    return "No readable error body.";
  }
}

export async function createTerminalSession(request: TerminalCreateSessionRequest): Promise<TerminalCreateSessionResponse> {
  return withNativeCommandTimeout(
    invoke<TerminalCreateSessionResponse>("terminal_create_session", { request }),
    20_000,
    "Terminal session startup",
  );
}

export async function getDefaultTerminalWorkingDirectory(): Promise<string> {
  if (!isTauriDesktopRuntime()) {
    return "";
  }

  return invoke<string>("terminal_get_default_working_directory");
}

/** Runs a command through the native terminal session manager. */
export async function runTerminalCommand(request: TerminalRunCommandRequest): Promise<TerminalRunCommandResponse> {
  const commandTimeoutMs = Math.max(1_000, request.timeoutMs ?? 45_000);
  return withNativeCommandTimeout(
    invoke<TerminalRunCommandResponse>("terminal_run_command", { request }),
    commandTimeoutMs + 4_000,
    "Terminal command runner",
  );
}

export async function writeTerminalSession(sessionId: string, input: string): Promise<void> {
  return withNativeCommandTimeout(
    invoke<void>("terminal_write_session", {
      request: {
        input,
        sessionId,
      },
    }),
    5_000,
    "Terminal input",
  );
}

export async function resizeTerminalSession(sessionId: string, cols: number, rows: number): Promise<void> {
  return withNativeCommandTimeout(
    invoke<void>("terminal_resize_session", {
      request: {
        cols,
        rows,
        sessionId,
      },
    }),
    3_000,
    "Terminal resize",
  );
}

export async function drainTerminalSession(sessionId: string): Promise<TerminalDrainResponse> {
  return withNativeCommandTimeout(
    invoke<TerminalDrainResponse>("terminal_drain_session", {
      request: {
        sessionId,
      },
    }),
    8_000,
    "Terminal output drain",
  );
}

export async function killTerminalSession(sessionId: string): Promise<void> {
  try {
    return await withNativeCommandTimeout(
      invoke<void>("terminal_kill_session", {
        request: {
          sessionId,
        },
      }),
      2_500,
      "Terminal stop",
    );
  } finally {
    unregisterBackgroundTerminalSession(sessionId);
  }
}

function withNativeCommandTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  const safeTimeoutMs = Math.max(1_000, Math.min(timeoutMs, 610_000));

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      reject(new Error(`${label} did not respond within ${Math.round(safeTimeoutMs / 1000)} seconds.`));
    }, safeTimeoutMs);

    promise.then(
      (value) => {
        if (settled) {
          return;
        }

        settled = true;
        window.clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        if (settled) {
          return;
        }

        settled = true;
        window.clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}
