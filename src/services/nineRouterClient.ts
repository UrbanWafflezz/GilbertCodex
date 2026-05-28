import {
  finishNineRouterOAuthCallback,
  isTauriDesktopRuntime,
  nineRouterLocalHttp,
  openExternalUrl,
  startNineRouterOAuthCallback,
} from "../app/tauriClient";
import {
  getDefaultModelForProvider,
  getModelRouteSourceInfo,
  isNineRouterCodexModelId,
  NINE_ROUTER_ANTIGRAVITY_MODEL_IDS,
  NINE_ROUTER_CLAUDE_CODE_MODEL_IDS,
  NINE_ROUTER_CLINE_MODEL_IDS,
  NINE_ROUTER_CODEX_MODEL_IDS,
  NINE_ROUTER_GEMINI_CLI_MODEL_IDS,
  NINE_ROUTER_GITHUB_COPILOT_MODEL_IDS,
  NINE_ROUTER_IFLOW_MODEL_IDS,
  NINE_ROUTER_KILO_CODE_MODEL_IDS,
  NINE_ROUTER_KIMI_CODING_MODEL_IDS,
  NINE_ROUTER_KIRO_MODEL_IDS,
  NINE_ROUTER_QWEN_CODE_MODEL_IDS,
  normalizeNineRouterDiscoveredModelId,
} from "../lib/models";
import { headersToRecord, normalizeNativeRequestBody, normalizeNativeRequestMethod } from "./nativeHttp";
import { getConfiguredNineRouterDashboardUrl, isNineRouterNativeBridgeUrl, withNineRouterCloudAuthHeaders } from "./nineRouterCloud";

export const NINE_ROUTER_PROVIDER_ID = "9router" as const;
export const NINE_ROUTER_DASHBOARD_FALLBACK = getConfiguredNineRouterDashboardUrl("http://127.0.0.1:20128");
export const NINE_ROUTER_CODEX_REDIRECT_URI = "http://localhost:1455/auth/callback";
export const NINE_ROUTER_CODEX_PROXY_APP_PORT = "20128";
export const NINE_ROUTER_CODEX_POLL_INTERVAL_MS = 1_500;
export const NINE_ROUTER_CODEX_MAX_POLL_ATTEMPTS = 200;
export const NINE_ROUTER_DEVICE_POLL_MAX_ATTEMPTS = 90;

export type NineRouterAccountFlow = "authorization_code" | "codex" | "device_code";

export interface NineRouterAccountProvider {
  description: string;
  flow: NineRouterAccountFlow;
  id: string;
  name: string;
  usageNote: string;
}

export interface NineRouterConnection {
  authType?: string | null;
  displayName?: string | null;
  email?: string | null;
  expiresAt?: string | null;
  id: string;
  isActive?: boolean | null;
  lastError?: string | null;
  name?: string | null;
  provider: string;
  providerSpecificData?: {
    chatgptPlanType?: string | null;
  } | null;
  testStatus?: string | null;
}

export interface NineRouterAuthorizeResponse {
  authUrl?: string;
  codeVerifier?: string;
  redirectUri?: string;
  state?: string;
}

export interface NineRouterDeviceCodeResponse {
  _authMethod?: string;
  _clientId?: string;
  _clientSecret?: string;
  _region?: string;
  _startUrl?: string;
  codeVerifier?: string;
  device_code?: string;
  expires_in?: number;
  interval?: number;
  user_code?: string;
  verification_uri?: string;
  verification_uri_complete?: string;
}

export interface NineRouterOAuthPollResponse {
  connection?: {
    displayName?: string | null;
    email?: string | null;
    id?: string;
    provider?: string;
  };
  error?: string;
  errorDescription?: string;
  pending?: boolean;
  success?: boolean;
}

export interface NineRouterExchangeResponse extends NineRouterOAuthPollResponse {}

export interface NineRouterCodexProxyResponse {
  reason?: string;
  serverSide?: boolean;
  success?: boolean;
}

export interface NineRouterCodexPollResponse {
  connectionId?: string;
  email?: string;
  error?: string;
  status?: "done" | "error" | "pending" | "unknown" | string;
}

export type NineRouterUsagePeriod = "24h" | "30d" | "60d" | "7d" | "all" | "today";

export interface NineRouterUsageBucket {
  completionTokens?: number;
  cost?: number;
  lastUsed?: string;
  promptTokens?: number;
  provider?: string;
  rawModel?: string;
  requests?: number;
}

export interface NineRouterUsageRequest {
  completionTokens?: number;
  model?: string;
  promptTokens?: number;
  provider?: string;
  status?: string;
  timestamp?: string;
}

export interface NineRouterUsageStats {
  activeRequests?: Array<{ account?: string; count?: number; model?: string; provider?: string }>;
  byAccount?: Record<string, NineRouterUsageBucket>;
  byEndpoint?: Record<string, NineRouterUsageBucket>;
  byModel?: Record<string, NineRouterUsageBucket>;
  byProvider?: Record<string, NineRouterUsageBucket>;
  errorProvider?: string;
  recentRequests?: NineRouterUsageRequest[];
  totalCompletionTokens?: number;
  totalCost?: number;
  totalPromptTokens?: number;
  totalRequests?: number;
}

export interface NineRouterUsageChartPoint {
  cost?: number;
  label?: string;
  tokens?: number;
}

export interface NineRouterUsageProvider {
  id: string;
  name: string;
}

export interface NineRouterUsageSnapshot {
  chart: NineRouterUsageChartPoint[];
  logs: string[];
  period: NineRouterUsagePeriod;
  providers: NineRouterUsageProvider[];
  stats: NineRouterUsageStats;
  syncedAt: string;
}

export type NineRouterComboStrategy = "fallback" | "round-robin";

export interface NineRouterCoreSettings {
  authMode?: string;
  cavemanEnabled?: boolean;
  cavemanLevel?: string;
  comboStickyRoundRobinLimit?: number;
  comboStrategies?: Record<string, {
    fallbackStrategy?: NineRouterComboStrategy | string;
    stickyRoundRobinLimit?: number;
  }>;
  comboStrategy?: NineRouterComboStrategy | string;
  enableRequestLogs?: boolean;
  enableTranslator?: boolean;
  hasPassword?: boolean;
  outboundNoProxy?: string;
  outboundProxyEnabled?: boolean;
  outboundProxyUrl?: string;
  rtkEnabled?: boolean;
  tunnelDashboardAccess?: boolean;
}

export interface NineRouterTunnelStatus {
  alreadyRunning?: boolean;
  enabled?: boolean;
  error?: string;
  publicUrl?: string;
  running?: boolean;
  shortId?: string;
  tunnelUrl?: string;
  url?: string;
}

export type NineRouterStatusMessage = {
  kind: "error" | "success" | "warning";
  text: string;
};

export interface NineRouterConnectOptions {
  isActive?: () => boolean;
  onStatus?: (message: NineRouterStatusMessage) => void;
}

export const NINE_ROUTER_ACCOUNT_PROVIDERS: NineRouterAccountProvider[] = [
  {
    description: "Codex subscription routes for GPT-5.5, GPT-5.4, Codex 5.3, and Spark.",
    flow: "codex",
    id: "codex",
    name: "Codex subscription",
    usageNote: "Shows Codex 5-hour, weekly, review, and Spark windows when available.",
  },
  {
    description: "Claude Code subscription routes for coding models.",
    flow: "authorization_code",
    id: "claude",
    name: "Claude Code subscription",
    usageNote: "Shows Claude session and weekly usage windows.",
  },
  {
    description: "Gemini subscription routes from Gemini CLI or Cloud Code.",
    flow: "authorization_code",
    id: "gemini-cli",
    name: "Gemini subscription",
    usageNote: "Shows Cloud Code Assist quota and reset windows.",
  },
  {
    description: "Antigravity subscription routes.",
    flow: "authorization_code",
    id: "antigravity",
    name: "Antigravity subscription",
    usageNote: "Shows subscription quota when available from Google.",
  },
  {
    description: "GitHub Copilot subscription routes for coding models.",
    flow: "device_code",
    id: "github",
    name: "GitHub Copilot subscription",
    usageNote: "Shows Copilot quota snapshots when GitHub reports them.",
  },
  {
    description: "Kiro subscription routes.",
    flow: "device_code",
    id: "kiro",
    name: "Kiro subscription",
    usageNote: "Shows Kiro request usage and reset information.",
  },
  {
    description: "Kilo Code subscription routes.",
    flow: "device_code",
    id: "kilocode",
    name: "Kilo Code subscription",
    usageNote: "Shows Kilo account status; quota appears when available.",
  },
  {
    description: "Cline subscription routes.",
    flow: "authorization_code",
    id: "cline",
    name: "Cline subscription",
    usageNote: "Shows account status; quota appears when available.",
  },
  {
    description: "Qwen Code subscription routes.",
    flow: "device_code",
    id: "qwen",
    name: "Qwen Code subscription",
    usageNote: "Shows account status and quota messages when available.",
  },
  {
    description: "iFlow subscription routes.",
    flow: "authorization_code",
    id: "iflow",
    name: "iFlow subscription",
    usageNote: "Shows account status and usage messages when available.",
  },
  {
    description: "Qoder subscription routes.",
    flow: "authorization_code",
    id: "qoder",
    name: "Qoder subscription",
    usageNote: "Shows account status and usage messages when available.",
  },
  {
    description: "Kimi Coding subscription routes.",
    flow: "device_code",
    id: "kimi-coding",
    name: "Kimi Coding subscription",
    usageNote: "Shows account status and quota messages when available.",
  },
  {
    description: "CodeBuddy subscription routes.",
    flow: "device_code",
    id: "codebuddy",
    name: "CodeBuddy subscription",
    usageNote: "Shows account status and quota messages when available.",
  },
];

export async function loadNineRouterConnections(dashboardUrl = NINE_ROUTER_DASHBOARD_FALLBACK) {
  const payload = await fetchNineRouterJson<{ connections?: NineRouterConnection[] }>(joinLocalUrl(dashboardUrl, "/api/providers"));
  return payload.connections ?? [];
}

export async function loadNineRouterModels(baseUrl: string) {
  const payload = await fetchNineRouterJson<{ data?: Array<{ id?: string }>; error?: { message?: string } }>(joinLocalUrl(baseUrl, "/models"));
  const seen = new Set<string>();

  return (payload.data ?? []).flatMap((model) => {
    const modelId = normalizeNineRouterDiscoveredModelId(model.id);

    if (!modelId || seen.has(modelId)) {
      return [];
    }

    seen.add(modelId);
    return [modelId];
  });
}

export async function loadNineRouterUsageSnapshot(dashboardUrl = NINE_ROUTER_DASHBOARD_FALLBACK, period: NineRouterUsagePeriod = "7d"): Promise<NineRouterUsageSnapshot> {
  const chartPeriod = period === "all" ? "60d" : period;
  const [stats, chart, providers, logs] = await Promise.all([
    fetchNineRouterJson<NineRouterUsageStats>(createNineRouterUrl(dashboardUrl, "/api/usage/stats", { period })),
    fetchOptionalNineRouterJson<NineRouterUsageChartPoint[]>(createNineRouterUrl(dashboardUrl, "/api/usage/chart", { period: chartPeriod }), []),
    fetchOptionalNineRouterJson<{ providers?: NineRouterUsageProvider[] }>(joinLocalUrl(dashboardUrl, "/api/usage/providers"), { providers: [] }),
    fetchOptionalNineRouterJson<string[]>(joinLocalUrl(dashboardUrl, "/api/usage/logs"), []),
  ]);

  return {
    chart: Array.isArray(chart) ? chart : [],
    logs: Array.isArray(logs) ? logs : [],
    period,
    providers: Array.isArray(providers.providers) ? providers.providers : [],
    stats,
    syncedAt: new Date().toISOString(),
  };
}

export async function loadNineRouterCoreSettings(dashboardUrl = NINE_ROUTER_DASHBOARD_FALLBACK) {
  return fetchNineRouterJson<NineRouterCoreSettings>(joinLocalUrl(dashboardUrl, "/api/settings"));
}

export async function updateNineRouterCoreSettings(dashboardUrl = NINE_ROUTER_DASHBOARD_FALLBACK, settings: Partial<NineRouterCoreSettings>) {
  return patchNineRouterJson<NineRouterCoreSettings>(joinLocalUrl(dashboardUrl, "/api/settings"), settings);
}

export async function loadNineRouterTunnelStatus(dashboardUrl = NINE_ROUTER_DASHBOARD_FALLBACK) {
  return fetchNineRouterJson<NineRouterTunnelStatus>(joinLocalUrl(dashboardUrl, "/api/tunnel/status"));
}

export async function setNineRouterTunnelEnabled(dashboardUrl = NINE_ROUTER_DASHBOARD_FALLBACK, enabled: boolean) {
  return postNineRouterJson<NineRouterTunnelStatus>(joinLocalUrl(dashboardUrl, enabled ? "/api/tunnel/enable" : "/api/tunnel/disable"), {});
}

export async function connectNineRouterAccount(provider: NineRouterAccountProvider, dashboardUrl = NINE_ROUTER_DASHBOARD_FALLBACK, options: NineRouterConnectOptions = {}) {
  if (provider.flow === "codex") {
    await connectCodexAccount(dashboardUrl, options);
    return;
  }

  if (provider.flow === "device_code") {
    await connectDeviceCodeProvider(provider, dashboardUrl, options);
    return;
  }

  await connectAuthorizationCodeProvider(provider, dashboardUrl, options);
}

export function getNineRouterCodexRedirectUri(dashboardUrl = NINE_ROUTER_DASHBOARD_FALLBACK) {
  void dashboardUrl;
  return NINE_ROUTER_CODEX_REDIRECT_URI;
}

export function chooseNineRouterModel(savedModel: string, models: string[]) {
  const normalizedSavedModel = savedModel.trim();

  if (models.length > 0) {
    return normalizedSavedModel && models.includes(normalizedSavedModel) ? normalizedSavedModel : models[0];
  }

  return normalizedSavedModel || getDefaultModelForProvider(NINE_ROUTER_PROVIDER_ID);
}

const NINE_ROUTER_ACCOUNT_ROUTE_GROUPS: Record<string, string> = {
  antigravity: "9router-antigravity",
  claude: "9router-claude-code",
  cline: "9router-cline",
  codebuddy: "9router-codebuddy",
  codex: "9router-codex",
  "gemini-cli": "9router-gemini-cli",
  github: "9router-github-copilot",
  iflow: "9router-iflow",
  "kimi-coding": "9router-kimi-coding",
  kilocode: "9router-kilo-code",
  kiro: "9router-kiro",
  qoder: "9router-qoder",
  qwen: "9router-qwen-code",
};

const NINE_ROUTER_ACCOUNT_MODEL_PRIORITIES: Record<string, readonly string[]> = {
  antigravity: NINE_ROUTER_ANTIGRAVITY_MODEL_IDS,
  claude: NINE_ROUTER_CLAUDE_CODE_MODEL_IDS,
  cline: NINE_ROUTER_CLINE_MODEL_IDS,
  codex: NINE_ROUTER_CODEX_MODEL_IDS,
  "gemini-cli": NINE_ROUTER_GEMINI_CLI_MODEL_IDS,
  github: NINE_ROUTER_GITHUB_COPILOT_MODEL_IDS,
  iflow: NINE_ROUTER_IFLOW_MODEL_IDS,
  "kimi-coding": NINE_ROUTER_KIMI_CODING_MODEL_IDS,
  kilocode: NINE_ROUTER_KILO_CODE_MODEL_IDS,
  kiro: NINE_ROUTER_KIRO_MODEL_IDS,
  qwen: NINE_ROUTER_QWEN_CODE_MODEL_IDS,
};

export function chooseNineRouterModelForAccount(providerId: string, savedModel: string, models: string[]) {
  const normalizedSavedModel = savedModel.trim();
  const priorityModels = NINE_ROUTER_ACCOUNT_MODEL_PRIORITIES[providerId] ?? [];

  if (normalizedSavedModel && modelBelongsToNineRouterAccount(providerId, normalizedSavedModel) && (models.length === 0 || models.includes(normalizedSavedModel))) {
    return normalizedSavedModel;
  }

  const priorityModel = priorityModels.find((model) => models.includes(model));
  if (priorityModel) {
    return priorityModel;
  }

  const liveProviderModel = models.find((model) => modelBelongsToNineRouterAccount(providerId, model));
  if (liveProviderModel) {
    return liveProviderModel;
  }

  if (priorityModels.length > 0) {
    return priorityModels[0];
  }

  return "";
}

export function chooseNineRouterConnectedAccountProvider(connections: NineRouterConnection[], excludedProviderId?: string) {
  return NINE_ROUTER_ACCOUNT_PROVIDERS.find((provider) => {
    if (provider.id === excludedProviderId) {
      return false;
    }

    return hasNineRouterAccountConnection(connections, provider.id);
  }) ?? null;
}

export function chooseNineRouterModelForConnectedAccounts(savedModel: string, models: string[], connections: NineRouterConnection[]) {
  const savedRouteProviderId = getNineRouterAccountProviderForModel(savedModel);
  if (savedRouteProviderId && hasNineRouterAccountConnection(connections, savedRouteProviderId)) {
    return chooseNineRouterModelForAccount(savedRouteProviderId, savedModel, models);
  }

  const connectedProvider = chooseNineRouterConnectedAccountProvider(connections);
  return connectedProvider ? chooseNineRouterModelForAccount(connectedProvider.id, savedModel, models) : "";
}

export function getNineRouterAccountProviderForModel(model: string) {
  const groupId = getModelRouteSourceInfo(NINE_ROUTER_PROVIDER_ID, model).groupId;
  return Object.entries(NINE_ROUTER_ACCOUNT_ROUTE_GROUPS).find(([, routeGroupId]) => routeGroupId === groupId)?.[0] ?? null;
}

export function hasNineRouterAccountConnection(connections: NineRouterConnection[], providerId: string) {
  return Boolean(choosePreferredConnection(connections.filter((connection) => connection.provider === providerId)));
}

export function shouldShowNineRouterCodexContextSettings(connections: NineRouterConnection[], selectedModel: string) {
  return hasNineRouterAccountConnection(connections, "codex") && isNineRouterCodexModelId(selectedModel);
}

function modelBelongsToNineRouterAccount(providerId: string, model: string) {
  const groupId = NINE_ROUTER_ACCOUNT_ROUTE_GROUPS[providerId];

  return Boolean(groupId && getModelRouteSourceInfo(NINE_ROUTER_PROVIDER_ID, model).groupId === groupId);
}

export function choosePreferredConnection(connections: NineRouterConnection[]) {
  return connections.find((connection) => isConnectionActive(connection)) ?? connections[0] ?? null;
}

export function isConnectionActive(connection: NineRouterConnection | null | undefined) {
  if (!connection || connection.isActive === false) {
    return false;
  }

  const status = connection.testStatus?.toLowerCase();
  return status === "active" || status === "success";
}

export function formatConnectionIdentity(connection: NineRouterConnection | null | undefined) {
  return connection?.email || connection?.displayName || connection?.name || "";
}

export function formatConnectionExpiry(connection: NineRouterConnection | null | undefined) {
  if (!connection?.expiresAt) {
    return connection ? "Auto-refresh" : "Not connected";
  }

  const expiresAt = new Date(connection.expiresAt);

  if (Number.isNaN(expiresAt.getTime())) {
    return "Auto-refresh";
  }

  const days = Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000);

  if (days <= 0) {
    return "Expired";
  }

  return `${days}d left`;
}

export function joinLocalUrl(baseUrl: string, path: string) {
  const normalizedBase = baseUrl.trim().replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  return `${normalizedBase}${normalizedPath}`;
}

export function createNineRouterUrl(baseUrl: string, path: string, params?: Record<string, string>) {
  const url = new URL(joinLocalUrl(baseUrl, path));

  Object.entries(params ?? {}).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  return url.toString();
}

export async function fetchNineRouterJson<T>(url: string) {
  const response = await fetchWithTimeout(url, { method: "GET" });
  const payload = await readJsonResponse<T & { error?: { message?: string } }>(response);

  if (!response.ok) {
    throw new Error(payload.error?.message || `Subscriptions request failed with HTTP ${response.status}.`);
  }

  return payload;
}

async function fetchOptionalNineRouterJson<T>(url: string, fallback: T): Promise<T> {
  try {
    return await fetchNineRouterJson<T>(url);
  } catch {
    return fallback;
  }
}

export async function postNineRouterJson<T>(url: string, body: unknown) {
  const response = await fetchWithTimeout(url, {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const payload = await readJsonResponse<T & { error?: { message?: string } | string }>(response);

  if (!response.ok) {
    const error = payload.error;
    throw new Error(typeof error === "string" ? error : error?.message || `Subscriptions request failed with HTTP ${response.status}.`);
  }

  return payload;
}

export async function putNineRouterJson<T>(url: string, body: unknown) {
  const response = await fetchWithTimeout(url, {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
    },
    method: "PUT",
  });
  const payload = await readJsonResponse<T & { error?: { message?: string } | string }>(response);

  if (!response.ok) {
    const error = payload.error;
    throw new Error(typeof error === "string" ? error : error?.message || `Subscriptions request failed with HTTP ${response.status}.`);
  }

  return payload;
}

export async function patchNineRouterJson<T>(url: string, body: unknown) {
  const response = await fetchWithTimeout(url, {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
    },
    method: "PATCH",
  });
  const payload = await readJsonResponse<T & { error?: { message?: string } | string }>(response);

  if (!response.ok) {
    const error = payload.error;
    throw new Error(typeof error === "string" ? error : error?.message || `Subscriptions request failed with HTTP ${response.status}.`);
  }

  return payload;
}

async function connectCodexAccount(dashboardUrl: string, options: NineRouterConnectOptions) {
  if (!isNineRouterNativeBridgeUrl(dashboardUrl)) {
    await connectCodexAccountWithDesktopCallback(dashboardUrl, options);
    return;
  }

  await stopCodexOAuthProxy(dashboardUrl);
  const redirectUri = getNineRouterCodexRedirectUri(dashboardUrl);

  try {
    const authUrl = createNineRouterUrl(dashboardUrl, "/api/oauth/codex/authorize", {
      redirect_uri: redirectUri,
    });
    const authData = await fetchNineRouterJson<NineRouterAuthorizeResponse>(authUrl);

    if (!authData.authUrl || !authData.state || !authData.codeVerifier) {
      throw new Error("Subscriptions did not return a complete Codex sign-in request.");
    }

    const proxyUrl = createNineRouterUrl(dashboardUrl, "/api/oauth/codex/start-proxy", {
      app_port: NINE_ROUTER_CODEX_PROXY_APP_PORT,
      code_verifier: authData.codeVerifier,
      redirect_uri: redirectUri,
      state: authData.state,
    });
    const proxy = await fetchNineRouterJson<NineRouterCodexProxyResponse>(proxyUrl);

    if (!proxy.success || !proxy.serverSide) {
      throw new Error(proxy.reason === "port_busy" ? "Codex sign-in is already open. Finish or close the previous sign-in window, then retry." : "Subscriptions could not start the Codex sign-in callback.");
    }

    options.onStatus?.({ kind: "warning", text: "Finish the OpenAI sign-in in your browser. Gilbert will pick it up automatically." });
    await openExternalUrl(authData.authUrl);
    await waitForCodexConnection(dashboardUrl, authData.state, options);
  } finally {
    void stopCodexOAuthProxy(dashboardUrl);
  }
}

async function connectCodexAccountWithDesktopCallback(dashboardUrl: string, options: NineRouterConnectOptions) {
  const callback = await startNineRouterOAuthCallback({ path: "/auth/callback", port: 1455 });
  const redirectUri = callback.redirectUri;
  const authData = await fetchNineRouterJson<NineRouterAuthorizeResponse>(createNineRouterUrl(dashboardUrl, "/api/oauth/codex/authorize", {
    redirect_uri: redirectUri,
  }));

  if (!authData.authUrl || !authData.state || !authData.codeVerifier) {
    throw new Error("Subscriptions did not return a complete Codex sign-in request.");
  }

  options.onStatus?.({ kind: "warning", text: "Finish the OpenAI sign-in in your browser. Gilbert will pick it up automatically." });
  await openExternalUrl(authData.authUrl);
  const callbackData = await finishNineRouterOAuthCallback(callback.id, 300_000);

  if (!isConnectActive(options)) {
    return;
  }

  if (callbackData.error) {
    throw new Error(callbackData.errorDescription || callbackData.error);
  }

  if (!callbackData.code) {
    throw new Error("OpenAI did not return an authorization code.");
  }

  if (callbackData.state && callbackData.state !== authData.state) {
    throw new Error("OpenAI sign-in returned an unexpected state. Restart Codex sign-in and try again.");
  }

  const exchange = await postNineRouterJson<NineRouterExchangeResponse>(joinLocalUrl(dashboardUrl, "/api/oauth/codex/exchange"), {
    code: callbackData.code,
    codeVerifier: authData.codeVerifier,
    redirectUri,
    state: authData.state,
  });

  if (!exchange.success) {
    throw new Error(exchange.errorDescription || exchange.error || "Codex sign-in did not complete.");
  }
}

async function connectDeviceCodeProvider(provider: NineRouterAccountProvider, dashboardUrl: string, options: NineRouterConnectOptions) {
  const deviceData = await fetchNineRouterJson<NineRouterDeviceCodeResponse>(joinLocalUrl(dashboardUrl, `/api/oauth/${provider.id}/device-code`));
  const deviceCode = deviceData.device_code?.trim();
  const verifyUrl = deviceData.verification_uri_complete || deviceData.verification_uri;

  if (!deviceCode || !verifyUrl) {
    throw new Error(`Subscriptions did not return a complete ${provider.name} device sign-in request.`);
  }

  const userCode = deviceData.user_code?.trim();
  options.onStatus?.({
    kind: "warning",
    text: userCode ? `Finish ${provider.name} sign-in in your browser. Code: ${userCode}` : `Finish ${provider.name} sign-in in your browser. Gilbert will pick it up automatically.`,
  });
  await openExternalUrl(verifyUrl);
  await waitForDeviceCodeConnection(provider, dashboardUrl, deviceData, options);
}

async function connectAuthorizationCodeProvider(provider: NineRouterAccountProvider, dashboardUrl: string, options: NineRouterConnectOptions) {
  const callback = await startNineRouterOAuthCallback();
  const authData = await fetchNineRouterJson<NineRouterAuthorizeResponse>(createNineRouterUrl(dashboardUrl, `/api/oauth/${provider.id}/authorize`, {
    redirect_uri: callback.redirectUri,
  }));

  if (!authData.authUrl || !authData.state) {
    throw new Error(`Subscriptions did not return a complete ${provider.name} sign-in request.`);
  }

  if (provider.id !== "cline" && !authData.codeVerifier) {
    throw new Error(`Subscriptions did not return a code verifier for ${provider.name}.`);
  }

  options.onStatus?.({ kind: "warning", text: `Finish ${provider.name} sign-in in your browser. Gilbert will close the loop automatically.` });
  await openExternalUrl(authData.authUrl);
  const callbackData = await finishNineRouterOAuthCallback(callback.id, 300_000);

  if (!isConnectActive(options)) {
    return;
  }

  if (callbackData.error) {
    throw new Error(callbackData.errorDescription || callbackData.error);
  }

  if (!callbackData.code) {
    throw new Error(`${provider.name} did not return an authorization code.`);
  }

  const exchange = await postNineRouterJson<NineRouterExchangeResponse>(joinLocalUrl(dashboardUrl, `/api/oauth/${provider.id}/exchange`), {
    code: callbackData.code,
    codeVerifier: authData.codeVerifier,
    redirectUri: callback.redirectUri,
    state: callbackData.state || authData.state,
  });

  if (!exchange.success) {
    throw new Error(exchange.errorDescription || exchange.error || `${provider.name} sign-in did not complete.`);
  }
}

async function waitForDeviceCodeConnection(
  provider: NineRouterAccountProvider,
  dashboardUrl: string,
  deviceData: NineRouterDeviceCodeResponse,
  options: NineRouterConnectOptions,
) {
  let intervalSeconds = Math.max(2, Number(deviceData.interval ?? 5) || 5);
  const extraData = provider.id === "kiro"
    ? {
        _authMethod: deviceData._authMethod,
        _clientId: deviceData._clientId,
        _clientSecret: deviceData._clientSecret,
        _region: deviceData._region,
        _startUrl: deviceData._startUrl,
      }
    : null;

  for (let attempt = 0; attempt < NINE_ROUTER_DEVICE_POLL_MAX_ATTEMPTS; attempt += 1) {
    if (!isConnectActive(options)) {
      return;
    }

    await delay(intervalSeconds * 1_000);

    const payload = await postNineRouterJson<NineRouterOAuthPollResponse>(joinLocalUrl(dashboardUrl, `/api/oauth/${provider.id}/poll`), {
      codeVerifier: deviceData.codeVerifier,
      deviceCode: deviceData.device_code,
      extraData,
    });

    if (payload.success) {
      return payload;
    }

    if (payload.error === "slow_down") {
      intervalSeconds = Math.min(intervalSeconds + 5, 30);
      continue;
    }

    if (payload.pending || payload.error === "authorization_pending" || !payload.error) {
      continue;
    }

    throw new Error(payload.errorDescription || payload.error || `${provider.name} sign-in failed.`);
  }

  throw new Error(`${provider.name} sign-in timed out. Try again from Subscriptions settings.`);
}

async function waitForCodexConnection(dashboardUrl: string, state: string, options: NineRouterConnectOptions) {
  for (let attempt = 0; attempt < NINE_ROUTER_CODEX_MAX_POLL_ATTEMPTS; attempt += 1) {
    if (!isConnectActive(options)) {
      return;
    }

    const payload = await fetchNineRouterJson<NineRouterCodexPollResponse>(createNineRouterUrl(dashboardUrl, "/api/oauth/codex/poll-status", {
      state,
    }));

    if (payload.status === "done") {
      return payload;
    }

    if (payload.status === "error") {
      throw new Error(payload.error || "Codex sign-in failed.");
    }

    await delay(NINE_ROUTER_CODEX_POLL_INTERVAL_MS);
  }

  throw new Error("Codex sign-in timed out. Try again from Subscriptions settings.");
}

async function stopCodexOAuthProxy(dashboardUrl: string) {
  try {
    await fetchNineRouterJson<{ success?: boolean }>(createNineRouterUrl(dashboardUrl, "/api/oauth/codex/stop-proxy"));
  } catch {
    // The proxy may not be running yet.
  }
}

function isConnectActive(options: NineRouterConnectOptions) {
  return options.isActive?.() ?? true;
}

function delay(ms: number) {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

async function fetchWithTimeout(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timeoutMs = isNineRouterNativeBridgeUrl(url) ? 10_000 : 60_000;
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  try {
    if (isTauriDesktopRuntime() && isNineRouterNativeBridgeUrl(url)) {
      const nativeResponse = await nineRouterLocalHttp({
        body: normalizeNativeRequestBody(init.body, "Subscriptions bridge"),
        headers: headersToRecord(init.headers),
        method: normalizeNativeRequestMethod(init.method, "Subscriptions bridge"),
        timeoutMs,
        url,
      });

      return new Response(nativeResponse.body, {
        headers: nativeResponse.headers,
        status: nativeResponse.status,
      });
    }

    const requestInit = await withNineRouterCloudAuthHeaders(url, init);
    return await fetch(url, {
      ...requestInit,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Subscriptions did not answer ${url} within ${Math.round(timeoutMs / 1000)} seconds.`);
    }

    const message = error instanceof Error ? error.message : String(error);
    if (/failed to fetch|load failed|networkerror|request failed|connection refused|could not connect/i.test(message)) {
      throw new Error(`Could not reach Subscriptions at ${url}. Open Subscriptions, then retry.`);
    }

    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();

  if (!text) {
    return {} as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return {} as T;
  }
}
