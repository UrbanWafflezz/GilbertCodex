import { createEmptyChat, DEFAULT_PROJECT, isDiscardableEmptyChat, isEmptyChat, isNoProjectName, normalizeProjectName, titleFromMessage } from "./chatUtils";
import {
  DEFAULT_LOCAL_MAX_TOKENS,
  DEFAULT_LOCAL_TEMPERATURE,
  DEFAULT_LOCAL_TOP_K,
  DEFAULT_LOCAL_TOP_P,
  normalizeContextWindowTokens,
  normalizeMaxTokens,
  normalizeTemperature,
  normalizeTopK,
  normalizeTopP,
} from "./generationSettings";
import { getDefaultTerminalShell, isTerminalShellId } from "./terminalShells";
import {
  DEFAULT_CHAT_MODEL,
  DEFAULT_PROVIDER_ID,
  getDefaultBaseUrlForProvider,
  getDefaultProviderBaseUrls,
  getDefaultProviderModels,
  isModelProviderId,
  normalizeProviderBaseUrl,
  normalizeProviderModelId,
} from "./models";
import { DEFAULT_APP_APPEARANCE_SETTINGS, normalizeAppAppearanceSettings } from "./appearance";
import { DEFAULT_WEB_SEARCH_MAX_RESULTS, MAX_WEB_SEARCH_RESULTS } from "../services/webSearchClient";
import { normalizeToolBridgePermissionMode } from "../toolBridge/permissions";
import { DEFAULT_DISCORD_BRIDGE_SETTINGS, normalizeDiscordBridgeSettings } from "../types/discord";
import { DEFAULT_TOOL_REGISTRY_SETTINGS, normalizeToolRegistrySettings } from "../types/tools";
import { autoFinalizeDeviceDatabaseMigration, isDeviceDatabaseAvailable, loadDeviceDatabaseChat, loadDeviceDatabaseNamespace, saveDeviceDatabaseValues, type DeviceDatabaseSeed } from "./deviceDatabase";
import { scheduleDelayedIdleTask, scheduleIdleTask } from "./idleTask";
import { normalizeProjectRunConfig } from "./projectRunConfig";
import { normalizeProjectGoal } from "./projectGoals";
import type {
  ChatAttachment,
  ChatArtifact,
  ChatContextCompaction,
  ChatComposerDraft,
  ChatFileAttachment,
  ChatImageAttachment,
  ChatMessage,
  ChatPlanning,
  ChatProgressItem,
  ChatResearchReference,
  ChatSource,
  ChatStreamTiming,
  ChatSummary,
  ChatToolCall,
  ChatVideoAttachment,
  ChatWebSearch,
  ChatWorkTraceItem,
} from "../types/chat";
import type { AgentApproval } from "../types/agentRun";
import type { ApiKeyRecord, ApiKeyVaultState } from "../types/apiKeys";
import type { LocalPermissionMode, LocalWorkspaceIndexStatus, LocalWorkspaceScope, LocalWorkspaceSettings } from "../types/localWorkspace";
import type { ProjectSummary } from "../types/project";
import type { DiscordBridgeSettings } from "../types/discord";
import type { PdfLibraryOrigin, PdfLibraryRecord, PdfLibrarySourceFormat, PdfLibraryState, PdfProjectInstruction } from "../types/pdfLibrary";
import type { ProviderUsageRecord, UsageHistoryState } from "../types/usage";
import { CHAT_MEMORY_STORAGE_PREFIX, PROJECT_MEMORY_STORAGE_PREFIX } from "../memory";
import {
  DEFAULT_BRAVE_SEARCH_SETTINGS,
  type AppAgentEnvironment,
  type AppCodeReviewBehavior,
  type AppFollowUpBehavior,
  type AppGeneralSettings,
  type AppInferenceSpeed,
  type AppLanguageMode,
  type AppTurnCompletionNotificationMode,
  type AppWorkMode,
  type AppAppearanceSettings,
  type AppPersonalizationSettings,
  type AppearanceMode,
  type BraveSearchFreshness,
  type BraveSearchRequestMethod,
  type BraveSearchResultFilter,
  type BraveSearchSafeSearch,
  type BraveSearchUnits,
  type BraveAnswersModel,
  type ProviderContextWindowMap,
  type ProviderModelBudgetOverrideMap,
  type ProviderModelVisibilityMap,
  type ProviderSettings,
  type ReasoningEffort,
  type SubscriptionCodexContextWindow,
  type SubscriptionFallbackMode,
  type SubscriptionOptimizationSettings,
  type SubscriptionTokenSaverLevel,
  type ThinkingSettings,
  type WebSearchProvider,
  type WebSearchSettings,
} from "../types/settings";
import { DEFAULT_PROJECT_OPEN_TARGET_ID, PROJECT_OPEN_TARGETS, type ProjectOpenTargetId } from "../types/projectOpen";

const CHATS_KEY = "gilbert-codex.chats.v1";
const PROJECTS_KEY = "gilbert-codex.projects.v1";
const SETTINGS_KEY = "gilbert-codex.provider-settings.v1";
const THINKING_KEY = "gilbert-codex.thinking-settings.v1";
const THINKING_REBUILD_MIGRATION_KEY = "gilbert-codex.thinking-rebuild-enabled.v1";
const APPEARANCE_KEY = "gilbert-codex.appearance.v1";
const APPEARANCE_SETTINGS_KEY = "gilbert-codex.appearance-settings.v1";
const GENERAL_SETTINGS_KEY = "gilbert-codex.general-settings.v1";
const PERSONALIZATION_KEY = "gilbert-codex.personalization.v1";
const ACTIVE_CHAT_KEY = "gilbert-codex.active-chat.v1";
const LOCAL_WORKSPACE_KEY = "gilbert-codex.local-workspace.v1";
const TOOL_REGISTRY_KEY = "gilbert-codex.tool-registry.v1";
const GITHUB_OAUTH_CLIENT_ID_KEY = "gilbert-codex.github-oauth-client-id.v1";
const GOOGLE_OAUTH_SETTINGS_KEY = "gilbert-codex.google-oauth-settings.v1";
const API_KEY_VAULT_KEY = "gilbert-codex.api-key-vault.v1";
const DISCORD_BRIDGE_KEY = "gilbert-codex.discord-bridge.v1";
const BROWSER_SETTINGS_KEY = "gilbert-codex.browser-settings.v1";
const BROWSER_HISTORY_KEY = "gilbert-codex.browser-history.v1";
const BROWSER_PREVIEW_SESSION_KEY = "gilbert-codex.browser-preview.v2";
const LEGACY_BROWSER_PREVIEW_SESSION_KEY = "gilbert-codex.browser-preview.v1";
const BROWSER_AUTH_DB_KEY = "gilbert-codex.local-auth-db.v1";
const BROWSER_AGENT_RUNS_KEY = "gilbert-codex.agent-runs.v1";
const PDF_LIBRARY_KEY = "gilbert-codex.pdf-library.v1";
const MAPBOX_SETTINGS_KEY = "gilbert-codex.mapbox-settings.v1";
const WEATHER_LOCATION_KEY = "gilbert-codex.weather-location.v1";
const USAGE_HISTORY_KEY = "gilbert-codex.usage-history.v1";
const PROJECT_TOOL_MEMORY_STORAGE_PREFIX = "gilbert-codex.project-tool-memory.v1.";
const PERSISTED_STORAGE_KEYS = [
  CHATS_KEY,
  PROJECTS_KEY,
  SETTINGS_KEY,
  THINKING_KEY,
  THINKING_REBUILD_MIGRATION_KEY,
  APPEARANCE_KEY,
  APPEARANCE_SETTINGS_KEY,
  GENERAL_SETTINGS_KEY,
  PERSONALIZATION_KEY,
  ACTIVE_CHAT_KEY,
  LOCAL_WORKSPACE_KEY,
  TOOL_REGISTRY_KEY,
  GITHUB_OAUTH_CLIENT_ID_KEY,
  GOOGLE_OAUTH_SETTINGS_KEY,
  API_KEY_VAULT_KEY,
  DISCORD_BRIDGE_KEY,
  BROWSER_SETTINGS_KEY,
  BROWSER_HISTORY_KEY,
  BROWSER_PREVIEW_SESSION_KEY,
  LEGACY_BROWSER_PREVIEW_SESSION_KEY,
  BROWSER_AGENT_RUNS_KEY,
  PDF_LIBRARY_KEY,
  MAPBOX_SETTINGS_KEY,
  WEATHER_LOCATION_KEY,
  USAGE_HISTORY_KEY,
];
const PERSISTED_STORAGE_KEY_PREFIXES = [PROJECT_TOOL_MEMORY_STORAGE_PREFIX, CHAT_MEMORY_STORAGE_PREFIX, PROJECT_MEMORY_STORAGE_PREFIX];
const LEGACY_BROWSER_ONLY_KEYS = [BROWSER_AUTH_DB_KEY];
const PENDING_DEVICE_WRITE_PREFIX = "gilbert-codex.pending-device-write.v1.";
const PENDING_DEVICE_WRITE_INDEX_PREFIX = "gilbert-codex.pending-device-write-index.v1.";
const PENDING_DEVICE_RECOVERY_WRITE_DELAY_MS = 250;
const PENDING_DEVICE_RECOVERY_LEGACY_SCAN_LIMIT = 250;
const PREFIXED_SEED_MIGRATION_MARKER_PREFIX = "gilbert-codex.prefixed-storage-seeds-migrated.v1.";
const PREFIXED_SEED_MIGRATION_DELAY_MS = 45_000;
const PREFIXED_SEED_MIGRATION_CHUNK_SIZE = 75;
const LEGACY_BROWSER_STORAGE_CLEANUP_DELAY_MS = 60_000;
let storageNamespace = "legacy";
let deviceDatabasePath: string | null = null;
let deviceStorageInitialized = false;
let deviceStorageValues = new Map<string, string>();
let storageInitializationToken = 0;
const deviceStorageWriteQueues = new Map<string, Promise<void>>();
const deviceStoragePendingWrites = new Map<string, { key: string; namespace: string; value: string }>();
const deviceStoragePendingRecoveryWrites = new Map<string, PendingDeviceStorageWrite>();
const deviceStoragePendingRecoveryTimers = new Map<string, number>();
let deviceStorageRecoveryFlushRegistered = false;
const prefixedSeedMigrationNamespaces = new Set<string>();

interface PendingDeviceStorageWrite {
  key: string;
  namespace: string;
  updatedAt: number;
  value: string;
}

export const defaultProviderSettings: ProviderSettings = {
  apiKeys: {},
  baseUrls: getDefaultProviderBaseUrls(),
  contextWindowTokens: {},
  disabledModels: {},
  maxTokens: DEFAULT_LOCAL_MAX_TOKENS,
  model: DEFAULT_CHAT_MODEL,
  modelBudgetOverrides: {},
  openRouterApiKey: "",
  provider: DEFAULT_PROVIDER_ID,
  providerModels: getDefaultProviderModels(),
  subscriptionOptimization: {
    codexContextWindow: "standard",
    fallbackMode: "off",
    tokenSaverLevel: "low",
  },
  systemPrompt: "You are Gilbert Codex, a careful local coding assistant. Be concise, practical, and honest about limitations.",
  thinking: {
    effort: "medium",
    enabled: true,
  },
  temperature: DEFAULT_LOCAL_TEMPERATURE,
  topK: DEFAULT_LOCAL_TOP_K,
  topP: DEFAULT_LOCAL_TOP_P,
  tools: DEFAULT_TOOL_REGISTRY_SETTINGS,
  userInstructions: "",
  webSearch: {
    brave: DEFAULT_BRAVE_SEARCH_SETTINGS,
    enabled: false,
    maxResults: DEFAULT_WEB_SEARCH_MAX_RESULTS,
    provider: "duckduckgo",
  },
  workMode: "coding",
  workspaceDependencies: {
    enabled: true,
  },
};

export const defaultAppGeneralSettings: AppGeneralSettings = {
  agentEnvironment: "auto",
  codeReviewBehavior: "inline",
  defaultOpenTarget: DEFAULT_PROJECT_OPEN_TARGET_ID,
  defaultProjectlessChat: false,
  dictation: {
    dictionary: "We need to\nCodex\nGilbertCodex",
    holdHotkey: "Ctrl",
    toggleHotkey: "Ctrl+Alt+D",
  },
  followUpBehavior: "queue",
  inferenceSpeed: "standard",
  language: "auto",
  notifications: {
    permissionNotifications: true,
    questionNotifications: true,
    turnCompletion: "unfocused",
  },
  popoutWindowHotkey: "",
  requireCtrlEnterForLongPrompts: false,
  terminalShell: getDefaultTerminalShell(),
};

export const defaultAppPersonalizationSettings: AppPersonalizationSettings = {
  locationServicesEnabled: true,
};

export interface GoogleOAuthSettings {
  clientId: string;
  clientSecret: string;
}

export const DEFAULT_GOOGLE_OAUTH_SETTINGS: GoogleOAuthSettings = {
  clientId: "",
  clientSecret: "",
};

export function setStorageNamespace(userId: string | null) {
  const nextNamespace = userId ? `user.${sanitizeStorageScope(userId)}` : "legacy";

  if (nextNamespace === storageNamespace) {
    return;
  }

  flushPendingDeviceStorageRecoveries();
  storageNamespace = nextNamespace;
  storageInitializationToken += 1;
  deviceDatabasePath = null;
  deviceStorageInitialized = false;
  deviceStorageValues = new Map();
}

export async function initializeDeviceStorage(userId: string | null) {
  setStorageNamespace(userId);

  const initializationToken = ++storageInitializationToken;
  const namespace = storageNamespace;
  deviceDatabasePath = null;
  deviceStorageInitialized = false;
  deviceStorageValues = new Map();

  if (!isDeviceDatabaseAvailable()) {
    deviceStorageInitialized = true;
    return;
  }

  const snapshot = await loadDeviceDatabaseNamespace(namespace, collectStartupLocalStorageSeeds());

  if (initializationToken !== storageInitializationToken || namespace !== storageNamespace) {
    return;
  }

  deviceDatabasePath = snapshot?.databasePath ?? null;
  const recoveredStorage = recoverPendingDeviceStorageWrites(namespace, snapshot?.values ?? {});
  deviceStorageValues = new Map(Object.entries(recoveredStorage.values));
  deviceStorageInitialized = true;

  for (const recoveredWrite of recoveredStorage.pendingWrites) {
    queueDeviceStorageWrite(recoveredWrite.namespace, recoveredWrite.key, recoveredWrite.value);
  }

  schedulePrefixedLocalStorageSeedMigration(namespace);
  scheduleLegacyBrowserStorageCleanup();
  scheduleDelayedIdleTask(() => {
    void autoFinalizeDeviceDatabaseMigration().catch(() => undefined);
  }, 45_000, 5_000);
}

export function getDeviceDatabasePath() {
  return deviceDatabasePath;
}

export function loadChats(): ChatSummary[] {
  const storedChats = readJson<ChatSummary[]>(CHATS_KEY);

  if (!Array.isArray(storedChats) || storedChats.length === 0) {
    return [createEmptyChat(DEFAULT_PROJECT)];
  }

  const normalizedChats = storedChats.map(normalizeStoredChat);

  const durableChats = normalizedChats.filter((chat) => !isDiscardableEmptyChat(chat));

  return durableChats.length > 0 ? durableChats : [createEmptyChat(DEFAULT_PROJECT)];
}

export async function loadChatById(chatId: string): Promise<ChatSummary | null> {
  const normalizedChatId = chatId.trim();

  if (!normalizedChatId) {
    return null;
  }

  const cachedChat = readJson<ChatSummary[]>(CHATS_KEY)?.find((chat) => chat.id === normalizedChatId);

  if (cachedChat && cachedChat.messagesLoaded !== false) {
    return normalizeStoredChat(cachedChat);
  }

  if (isDeviceDatabaseAvailable()) {
    const rawChat = await loadDeviceDatabaseChat(storageNamespace, normalizedChatId);

    if (rawChat) {
      try {
        return normalizeStoredChat({
          ...(JSON.parse(rawChat) as ChatSummary),
          messagesLoaded: true,
        });
      } catch {
        return null;
      }
    }
  }

  return loadChats().find((chat) => chat.id === normalizedChatId) ?? null;
}

export function saveChats(chats: ChatSummary[]) {
  writeJson(CHATS_KEY, chats.filter((chat) => !isDiscardableEmptyChat(chat)));
}

function normalizeStoredChat(chat: ChatSummary): ChatSummary {
  const messagesLoaded = chat.messagesLoaded === false ? false : undefined;
  const messages = messagesLoaded === false
    ? []
    : Array.isArray(chat.messages) ? chat.messages.map(normalizeChatMessage) : [];
  const composerDraft = normalizeComposerDraft(chat.composerDraft);
  const project = normalizeProjectName(chat.project);
  const provider = isModelProviderId(chat.provider) ? chat.provider : undefined;
  const model = normalizeOptionalText(chat.model);
  const isLegacyDiscordChat = project.toLowerCase() === "discord" && messages.some((message) => message.source?.kind === "discord");
  const firstUserMessage = messages.find((message) => message.role === "user");

  return {
    ...chat,
    composerDraft,
    isDraft: isEmptyChat({ messages, messagesLoaded }) ? true : undefined,
    messages,
    messagesClearedAt: normalizeOptionalIso(chat.messagesClearedAt),
    messagesLoaded,
    model,
    project: isLegacyDiscordChat ? DEFAULT_PROJECT : project,
    provider,
    title: isLegacyDiscordChat && firstUserMessage ? titleFromMessage(firstUserMessage.content) : chat.title || "New chat",
    toolRuntimeVersion: 0,
    updatedAt: chat.updatedAt || new Date().toISOString(),
  };
}

function normalizeOptionalIso(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

export function loadProjects(): ProjectSummary[] {
  const storedProjects = readJson<ProjectSummary[]>(PROJECTS_KEY);

  if (!Array.isArray(storedProjects) || storedProjects.length === 0) {
    return [];
  }

  return storedProjects.flatMap((project) => {
    const name = normalizeProjectName(project.name);

    if (isNoProjectName(name) || (name.toLowerCase() === "discord" && !project.localWorkspace)) {
      return [];
    }

    return [
      {
        ...project,
        createdAt: project.createdAt || new Date().toISOString(),
        id: project.id || `project-${name}`,
        localWorkspace: project.localWorkspace ? normalizeLocalWorkspaceSettings(project.localWorkspace) : undefined,
        name,
        projectGoal: normalizeProjectGoal(project.projectGoal),
        runConfig: normalizeProjectRunConfig(project.runConfig),
        updatedAt: project.updatedAt || project.createdAt || new Date().toISOString(),
      },
    ];
  });
}

export function saveProjects(projects: ProjectSummary[]) {
  writeJson(PROJECTS_KEY, projects.map((project) => ({
    ...project,
    projectGoal: normalizeProjectGoal(project.projectGoal),
    runConfig: normalizeProjectRunConfig(project.runConfig),
  })));
}

export function loadProviderSettings(): ProviderSettings {
  const storedSettings = readJson<Partial<ProviderSettings>>(SETTINGS_KEY);
  const storedThinking = readJson<Partial<ThinkingSettings>>(THINKING_KEY);
  const thinkingRebuildMigrated = readString(THINKING_REBUILD_MIGRATION_KEY) === "1";
  const storedTools = readJson(TOOL_REGISTRY_KEY);
  const provider = normalizeModelProvider(storedSettings?.provider);
  const apiKeys = normalizeProviderSecretMap(storedSettings?.apiKeys);
  const baseUrls = normalizeProviderBaseUrls(storedSettings?.baseUrls);
  const contextWindowTokens = normalizeProviderContextWindowTokens(storedSettings?.contextWindowTokens);
  const disabledModels = normalizeDisabledProviderModels(storedSettings?.disabledModels);
  const modelBudgetOverrides = normalizeProviderModelBudgetOverrides(storedSettings?.modelBudgetOverrides);
  const providerModels = normalizeProviderModels(storedSettings?.providerModels);
  const legacyOpenRouterApiKey = typeof storedSettings?.openRouterApiKey === "string" ? storedSettings.openRouterApiKey : "";
  const tools = normalizeToolRegistrySettings(storedTools ?? storedSettings?.tools);

  if (!apiKeys.openrouter && legacyOpenRouterApiKey) {
    apiKeys.openrouter = legacyOpenRouterApiKey;
  }

  const model = normalizeModel(storedSettings?.model, provider, providerModels);
  removeDisabledProviderModelValue(disabledModels, provider, model);
  providerModels[provider] = model;

  const thinking = normalizeThinkingSettings(storedThinking ?? storedSettings?.thinking, {
    forceEnabled: !thinkingRebuildMigrated,
  });

  if (!thinkingRebuildMigrated) {
    writeString(THINKING_REBUILD_MIGRATION_KEY, "1");
  }

  return {
    ...defaultProviderSettings,
    ...storedSettings,
    apiKeys,
    baseUrls,
    contextWindowTokens,
    disabledModels,
    maxTokens: normalizeMaxTokens(storedSettings?.maxTokens, defaultProviderSettings.maxTokens),
    model,
    modelBudgetOverrides,
    openRouterApiKey: apiKeys.openrouter ?? "",
    provider,
    providerModels,
    subscriptionOptimization: normalizeSubscriptionOptimizationSettings(storedSettings?.subscriptionOptimization),
    thinking,
    temperature: normalizeTemperature(storedSettings?.temperature, defaultProviderSettings.temperature),
    topK: normalizeTopK(storedSettings?.topK, defaultProviderSettings.topK),
    topP: normalizeTopP(storedSettings?.topP, defaultProviderSettings.topP),
    tools: {
      ...tools,
      browserPreview: true,
      terminal: true,
    },
    userInstructions: normalizeText(storedSettings?.userInstructions, defaultProviderSettings.userInstructions),
    webSearch: normalizeWebSearchSettings(storedSettings?.webSearch),
    workMode: normalizeAppWorkMode(storedSettings?.workMode),
    workspaceDependencies: normalizeWorkspaceDependencySettings(storedSettings?.workspaceDependencies),
  };
}

export function saveProviderSettings(settings: ProviderSettings) {
  const apiKeys = normalizeProviderSecretMap({
    ...settings.apiKeys,
    openrouter: settings.apiKeys?.openrouter || settings.openRouterApiKey,
  });
  const baseUrls = normalizeProviderBaseUrls(settings.baseUrls);
  const contextWindowTokens = normalizeProviderContextWindowTokens(settings.contextWindowTokens);
  const disabledModels = normalizeDisabledProviderModels(settings.disabledModels);
  const modelBudgetOverrides = normalizeProviderModelBudgetOverrides(settings.modelBudgetOverrides);
  const providerModels = normalizeProviderModels({
    ...settings.providerModels,
    [settings.provider]: settings.model,
  });
  const normalizedSettings = {
    ...settings,
    apiKeys,
    baseUrls,
    contextWindowTokens,
    disabledModels,
    modelBudgetOverrides,
    openRouterApiKey: apiKeys.openrouter ?? "",
    providerModels,
    subscriptionOptimization: normalizeSubscriptionOptimizationSettings(settings.subscriptionOptimization),
    thinking: normalizeThinkingSettings(settings.thinking),
    tools: normalizeToolRegistrySettings(settings.tools),
    webSearch: normalizeWebSearchSettings(settings.webSearch),
    workMode: normalizeAppWorkMode(settings.workMode),
    workspaceDependencies: normalizeWorkspaceDependencySettings(settings.workspaceDependencies),
  };

  const { tools, ...providerSettingsWithoutTools } = normalizedSettings;

  writeJson(SETTINGS_KEY, providerSettingsWithoutTools);
  writeJson(THINKING_KEY, normalizedSettings.thinking);
  writeJson(TOOL_REGISTRY_KEY, tools);
}

export function loadAppearanceMode(): AppearanceMode {
  const storedMode = readString(APPEARANCE_KEY);

  if (storedMode === "light" || storedMode === "dark" || storedMode === "system") {
    return storedMode;
  }

  return "system";
}

export function saveAppearanceMode(mode: AppearanceMode) {
  writeString(APPEARANCE_KEY, mode);
}

export function loadAppAppearanceSettings(): AppAppearanceSettings {
  return normalizeAppAppearanceSettings(readJson<Partial<AppAppearanceSettings>>(APPEARANCE_SETTINGS_KEY) ?? DEFAULT_APP_APPEARANCE_SETTINGS);
}

export function saveAppAppearanceSettings(settings: AppAppearanceSettings) {
  writeJson(APPEARANCE_SETTINGS_KEY, normalizeAppAppearanceSettings(settings));
}

export function loadAppGeneralSettings(): AppGeneralSettings {
  return normalizeAppGeneralSettings(readJson<Partial<AppGeneralSettings>>(GENERAL_SETTINGS_KEY));
}

export function saveAppGeneralSettings(settings: AppGeneralSettings) {
  writeJson(GENERAL_SETTINGS_KEY, normalizeAppGeneralSettings(settings));
}

export function loadAppPersonalizationSettings(): AppPersonalizationSettings {
  return normalizeAppPersonalizationSettings(readJson<Partial<AppPersonalizationSettings>>(PERSONALIZATION_KEY));
}

export function saveAppPersonalizationSettings(settings: AppPersonalizationSettings) {
  writeJson(PERSONALIZATION_KEY, normalizeAppPersonalizationSettings(settings));
}

export function loadActiveChatId() {
  return readString(ACTIVE_CHAT_KEY);
}

export function saveActiveChatId(chatId: string) {
  writeString(ACTIVE_CHAT_KEY, chatId);
}

export function loadLocalWorkspaceSettings(): LocalWorkspaceSettings {
  return normalizeLocalWorkspaceSettings(readJson<Partial<LocalWorkspaceSettings>>(LOCAL_WORKSPACE_KEY));
}

export function saveLocalWorkspaceSettings(settings: LocalWorkspaceSettings) {
  writeJson(LOCAL_WORKSPACE_KEY, normalizeLocalWorkspaceSettings(settings));
}

export function loadGithubOAuthClientId(defaultClientId = "") {
  return readString(GITHUB_OAUTH_CLIENT_ID_KEY)?.trim() || defaultClientId.trim();
}

export function saveGithubOAuthClientId(clientId: string) {
  writeString(GITHUB_OAUTH_CLIENT_ID_KEY, clientId.trim());
}

export function loadGoogleOAuthSettings(): GoogleOAuthSettings {
  return normalizeGoogleOAuthSettings(readJson<Partial<GoogleOAuthSettings>>(GOOGLE_OAUTH_SETTINGS_KEY));
}

export function saveGoogleOAuthSettings(settings: GoogleOAuthSettings) {
  writeJson(GOOGLE_OAUTH_SETTINGS_KEY, normalizeGoogleOAuthSettings(settings));
}

export function clearGoogleOAuthSettings() {
  writeJson(GOOGLE_OAUTH_SETTINGS_KEY, DEFAULT_GOOGLE_OAUTH_SETTINGS);
}

export function loadApiKeyVault(): ApiKeyVaultState {
  return normalizeApiKeyVault(readJson<Partial<ApiKeyVaultState>>(API_KEY_VAULT_KEY));
}

export function saveApiKeyVault(vault: ApiKeyVaultState) {
  writeJson(API_KEY_VAULT_KEY, normalizeApiKeyVault(vault));
}

export function upsertApiKeyRecord(record: Omit<ApiKeyRecord, "createdAt" | "id" | "updatedAt"> & { createdAt?: string; id?: string; updatedAt?: string }) {
  const vault = loadApiKeyVault();
  const now = new Date().toISOString();
  const id = normalizeApiKeyId(record.id) || createApiKeyRecordId(record.service, record.keyName, record.label);
  const existing = vault.keys.find((key) => key.id === id);
  const nextRecord = normalizeApiKeyRecord({
    createdAt: existing?.createdAt ?? record.createdAt ?? now,
    id,
    keyName: record.keyName,
    kind: record.kind,
    label: record.label,
    service: record.service,
    updatedAt: record.updatedAt ?? now,
    value: record.value,
  });
  if (!nextRecord) {
    throw new Error("API key records need a label, service, key name, and value.");
  }

  const keys = [
    nextRecord,
    ...vault.keys.filter((key) => key.id !== id),
  ].sort((left, right) => left.label.localeCompare(right.label));
  const nextVault = normalizeApiKeyVault({ keys, version: 1 });

  saveApiKeyVault(nextVault);
  return nextVault;
}

export function deleteApiKeyRecord(id: string) {
  const vault = loadApiKeyVault();
  const normalizedId = normalizeApiKeyId(id);
  const nextVault = normalizeApiKeyVault({
    keys: vault.keys.filter((key) => key.id !== normalizedId),
    version: 1,
  });

  saveApiKeyVault(nextVault);
  return nextVault;
}

export function loadDiscordBridgeSettings(): DiscordBridgeSettings {
  return normalizeDiscordBridgeSettings(readJson<Partial<DiscordBridgeSettings>>(DISCORD_BRIDGE_KEY) ?? DEFAULT_DISCORD_BRIDGE_SETTINGS);
}

export function saveDiscordBridgeSettings(settings: DiscordBridgeSettings) {
  writeJson(DISCORD_BRIDGE_KEY, normalizeDiscordBridgeSettings(settings));
}

export function loadPdfLibraryState(): PdfLibraryState {
  return normalizePdfLibraryState(readJson<Partial<PdfLibraryState>>(PDF_LIBRARY_KEY));
}

export function savePdfLibraryState(state: PdfLibraryState) {
  writeJson(PDF_LIBRARY_KEY, normalizePdfLibraryState(state));
}

export function loadUsageHistory(): UsageHistoryState {
  return normalizeUsageHistoryState(readJson<Partial<UsageHistoryState>>(USAGE_HISTORY_KEY));
}

export function saveUsageHistory(state: UsageHistoryState) {
  writeJson(USAGE_HISTORY_KEY, normalizeUsageHistoryState(state));
}

export function appendUsageHistoryRecord(record: ProviderUsageRecord, options: { maxRecords?: number } = {}) {
  const history = loadUsageHistory();
  const maxRecords = Math.max(Math.round(options.maxRecords ?? 10_000), 100);
  const dedupeId = record.id.trim();
  const records = [
    ...history.records.filter((item) => item.id !== dedupeId),
    normalizeUsageRecord(record),
  ]
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
    .slice(-maxRecords);

  saveUsageHistory({
    records,
    updatedAt: new Date().toISOString(),
    version: 1,
  });
}

export function clearUsageHistory() {
  saveUsageHistory({
    records: [],
    updatedAt: new Date().toISOString(),
    version: 1,
  });
}

export function loadPersistentString(key: string) {
  return readString(key);
}

export function savePersistentString(key: string, value: string) {
  writeString(key, value);
}

function readJson<T>(key: string): T | null {
  try {
    const rawValue = readString(key);
    return rawValue ? (JSON.parse(rawValue) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  writeString(key, JSON.stringify(value));
}

function normalizeGoogleOAuthSettings(settings: Partial<GoogleOAuthSettings> | null | undefined): GoogleOAuthSettings {
  return {
    clientId: typeof settings?.clientId === "string" ? settings.clientId.trim() : "",
    clientSecret: typeof settings?.clientSecret === "string" ? settings.clientSecret.trim() : "",
  };
}

function normalizeApiKeyVault(value: Partial<ApiKeyVaultState> | null | undefined): ApiKeyVaultState {
  const records = Array.isArray(value?.keys) ? value.keys : [];
  const deduped = new Map<string, ApiKeyRecord>();

  for (const record of records) {
    const normalized = normalizeApiKeyRecord(record as Partial<ApiKeyRecord>);

    if (!normalized) {
      continue;
    }

    deduped.set(normalized.id, normalized);
  }

  return {
    keys: [...deduped.values()].sort((left, right) => left.label.localeCompare(right.label)),
    version: 1,
  };
}

function normalizeApiKeyRecord(value: Partial<ApiKeyRecord> | null | undefined): ApiKeyRecord | null {
  const label = normalizeText(value?.label, "");
  const service = normalizeApiKeyService(value?.service);
  const keyName = normalizeApiKeyName(value?.keyName);
  const secretValue = typeof value?.value === "string" ? value.value.trim() : "";

  if (!label || !service || !keyName || !secretValue) {
    return null;
  }

  const now = new Date().toISOString();

  return {
    createdAt: normalizeIsoDate(value?.createdAt, now),
    id: normalizeApiKeyId(value?.id) || createApiKeyRecordId(service, keyName, label),
    keyName,
    kind: normalizeApiKeyKind(value?.kind),
    label,
    service,
    updatedAt: normalizeIsoDate(value?.updatedAt, now),
    value: secretValue,
  };
}

function normalizeApiKeyKind(value: unknown): ApiKeyRecord["kind"] {
  return value === "app" || value === "mcp" || value === "provider" || value === "service" || value === "skill" || value === "custom" ? value : "custom";
}

function normalizeApiKeyService(value: unknown) {
  return normalizeText(value, "")
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function normalizeApiKeyName(value: unknown) {
  return normalizeText(value, "")
    .replace(/[^A-Za-z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 96);
}

function normalizeApiKeyId(value: unknown) {
  return normalizeText(value, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function createApiKeyRecordId(service: string, keyName: string, label: string) {
  const base = normalizeApiKeyId(`${service}-${keyName}-${label}`) || `key-${Date.now().toString(36)}`;

  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeIsoDate(value: unknown, fallback: string) {
  if (typeof value !== "string" || Number.isNaN(new Date(value).getTime())) {
    return fallback;
  }

  return value;
}

function readString(key: string) {
  try {
    if (deviceStorageInitialized && deviceStorageValues.has(key)) {
      return deviceStorageValues.get(key) ?? null;
    }

    return readRawStorageValue(key);
  } catch {
    return null;
  }
}

function writeString(key: string, value: string) {
  if (deviceStorageInitialized && isDeviceDatabaseAvailable()) {
    queuePendingDeviceStorageRecovery(storageNamespace, key, value);
    deviceStorageValues.set(key, value);
    queueDeviceStorageWrite(storageNamespace, key, value);
    return;
  }

  try {
    window.localStorage.setItem(scopedStorageKey(key), value);
  } catch {
    return;
  }
}

function queueDeviceStorageWrite(namespace: string, key: string, value: string) {
  const pendingKey = `${namespace}\0${key}`;
  deviceStoragePendingWrites.set(pendingKey, { key, namespace, value });
  scheduleDeviceStorageWriteQueue(namespace);
}

function scheduleDeviceStorageWriteQueue(namespace: string) {
  if (deviceStorageWriteQueues.has(namespace)) {
    return;
  }

  const queuedWrite = drainDeviceStorageWriteQueue(namespace).finally(() => {
    deviceStorageWriteQueues.delete(namespace);

    if (hasPendingNamespaceWrites(namespace)) {
      scheduleDeviceStorageWriteQueue(namespace);
    }
  });

  deviceStorageWriteQueues.set(namespace, queuedWrite);
  void queuedWrite.catch(() => undefined);
}

async function drainDeviceStorageWriteQueue(namespace: string) {
  while (hasPendingNamespaceWrites(namespace)) {
    const pendingWrites = takePendingNamespaceWrites(namespace);

    if (pendingWrites.length === 0) {
      return;
    }

    try {
      await saveDeviceDatabaseValues(
        namespace,
        pendingWrites.map((pendingWrite) => ({ key: pendingWrite.key, value: pendingWrite.value })),
      );
      for (const pendingWrite of pendingWrites) {
        clearPendingDeviceStorageRecovery(pendingWrite.namespace, pendingWrite.key, pendingWrite.value);
      }
    } catch {
      for (const pendingWrite of pendingWrites) {
        deviceStoragePendingWrites.set(`${pendingWrite.namespace}\0${pendingWrite.key}`, pendingWrite);
      }
      return;
    }
  }
}

function hasPendingNamespaceWrites(namespace: string) {
  for (const pendingWrite of deviceStoragePendingWrites.values()) {
    if (pendingWrite.namespace === namespace) {
      return true;
    }
  }

  return false;
}

function takePendingNamespaceWrites(namespace: string) {
  const pendingWrites: Array<{ key: string; namespace: string; value: string }> = [];

  for (const [pendingKey, pendingWrite] of deviceStoragePendingWrites.entries()) {
    if (pendingWrite.namespace !== namespace) {
      continue;
    }

    deviceStoragePendingWrites.delete(pendingKey);
    pendingWrites.push(pendingWrite);
  }

  return pendingWrites;
}

function recoverPendingDeviceStorageWrites(namespace: string, values: Record<string, string>) {
  const pendingWrites = readPendingDeviceStorageRecoveries(namespace);

  if (pendingWrites.length === 0) {
    return {
      pendingWrites,
      values,
    };
  }

  const recoveredValues = {
    ...values,
  };

  for (const pendingWrite of pendingWrites) {
    recoveredValues[pendingWrite.key] = pendingWrite.value;
  }

  return {
    pendingWrites,
    values: recoveredValues,
  };
}

function queuePendingDeviceStorageRecovery(namespace: string, key: string, value: string) {
  if (typeof window === "undefined") {
    return;
  }

  registerPendingDeviceStorageRecoveryFlush();

  const storageKey = pendingDeviceStorageKey(namespace, key);
  const pendingWrite: PendingDeviceStorageWrite = {
    key,
    namespace,
    updatedAt: Date.now(),
    value,
  };
  const pendingTimer = deviceStoragePendingRecoveryTimers.get(storageKey);

  if (pendingTimer !== undefined) {
    window.clearTimeout(pendingTimer);
  }

  deviceStoragePendingRecoveryWrites.set(storageKey, pendingWrite);
  const recoveryTimer = window.setTimeout(() => {
    deviceStoragePendingRecoveryTimers.delete(storageKey);
    const latestPendingWrite = deviceStoragePendingRecoveryWrites.get(storageKey);

    if (!latestPendingWrite) {
      return;
    }

    writePendingDeviceStorageRecovery(latestPendingWrite);
  }, PENDING_DEVICE_RECOVERY_WRITE_DELAY_MS);
  deviceStoragePendingRecoveryTimers.set(storageKey, recoveryTimer);
}

function writePendingDeviceStorageRecovery(pendingWrite: PendingDeviceStorageWrite) {
  try {
    const storageKey = pendingDeviceStorageKey(pendingWrite.namespace, pendingWrite.key);
    window.localStorage.setItem(storageKey, JSON.stringify(pendingWrite));
    addPendingDeviceStorageRecoveryIndex(pendingWrite.namespace, storageKey);
  } catch {
    return;
  }
}

function clearPendingDeviceStorageRecovery(namespace: string, key: string, value: string) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const storageKey = pendingDeviceStorageKey(namespace, key);
    const pendingTimer = deviceStoragePendingRecoveryTimers.get(storageKey);
    const queuedPendingWrite = deviceStoragePendingRecoveryWrites.get(storageKey);

    if (pendingTimer !== undefined && (!queuedPendingWrite || queuedPendingWrite.value === value)) {
      window.clearTimeout(pendingTimer);
      deviceStoragePendingRecoveryTimers.delete(storageKey);
    }

    if (!queuedPendingWrite || queuedPendingWrite.value === value) {
      deviceStoragePendingRecoveryWrites.delete(storageKey);
    }

    const pendingWrite = parsePendingDeviceStorageWrite(window.localStorage.getItem(storageKey));

    if (!pendingWrite || pendingWrite.value === value) {
      window.localStorage.removeItem(storageKey);
      removePendingDeviceStorageRecoveryIndex(namespace, storageKey);
    }
  } catch {
    return;
  }
}

function flushPendingDeviceStorageRecoveries() {
  if (typeof window === "undefined") {
    return;
  }

  for (const pendingTimer of deviceStoragePendingRecoveryTimers.values()) {
    window.clearTimeout(pendingTimer);
  }

  deviceStoragePendingRecoveryTimers.clear();

  for (const pendingWrite of deviceStoragePendingRecoveryWrites.values()) {
    writePendingDeviceStorageRecovery(pendingWrite);
  }
}

function registerPendingDeviceStorageRecoveryFlush() {
  if (deviceStorageRecoveryFlushRegistered || typeof window === "undefined") {
    return;
  }

  deviceStorageRecoveryFlushRegistered = true;
  window.addEventListener?.("pagehide", flushPendingDeviceStorageRecoveries);
  window.addEventListener?.("beforeunload", flushPendingDeviceStorageRecoveries);
}

function readPendingDeviceStorageRecoveries(namespace: string) {
  if (typeof window === "undefined") {
    return [];
  }

  const indexedPendingWrites = readIndexedPendingDeviceStorageRecoveries(namespace);

  if (indexedPendingWrites.length > 0) {
    return indexedPendingWrites.sort((left, right) => left.updatedAt - right.updatedAt);
  }

  try {
    if (window.localStorage.length > PENDING_DEVICE_RECOVERY_LEGACY_SCAN_LIMIT) {
      return [];
    }
  } catch {
    return [];
  }

  const pendingWrites: PendingDeviceStorageWrite[] = [];
  const namespacePrefix = pendingDeviceStorageNamespacePrefix(namespace);

  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const storageKey = window.localStorage.key(index);

      if (!storageKey?.startsWith(namespacePrefix)) {
        continue;
      }

      const pendingWrite = parsePendingDeviceStorageWrite(window.localStorage.getItem(storageKey));

      if (pendingWrite?.namespace === namespace) {
        pendingWrites.push(pendingWrite);
      }
    }
  } catch {
    return [];
  }

  return pendingWrites.sort((left, right) => left.updatedAt - right.updatedAt);
}

function readIndexedPendingDeviceStorageRecoveries(namespace: string) {
  const pendingWrites: PendingDeviceStorageWrite[] = [];

  for (const storageKey of readPendingDeviceStorageRecoveryIndex(namespace)) {
    try {
      const pendingWrite = parsePendingDeviceStorageWrite(window.localStorage.getItem(storageKey));

      if (pendingWrite?.namespace === namespace) {
        pendingWrites.push(pendingWrite);
      }
    } catch {
      continue;
    }
  }

  return pendingWrites;
}

function readPendingDeviceStorageRecoveryIndex(namespace: string) {
  try {
    const rawIndex = window.localStorage.getItem(pendingDeviceStorageIndexKey(namespace));
    const parsed = rawIndex ? JSON.parse(rawIndex) : [];

    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string" && value.trim().length > 0) : [];
  } catch {
    return [];
  }
}

function addPendingDeviceStorageRecoveryIndex(namespace: string, storageKey: string) {
  const indexedKeys = new Set(readPendingDeviceStorageRecoveryIndex(namespace));
  indexedKeys.add(storageKey);
  writePendingDeviceStorageRecoveryIndex(namespace, Array.from(indexedKeys));
}

function removePendingDeviceStorageRecoveryIndex(namespace: string, storageKey: string) {
  const indexedKeys = readPendingDeviceStorageRecoveryIndex(namespace).filter((indexedKey) => indexedKey !== storageKey);
  writePendingDeviceStorageRecoveryIndex(namespace, indexedKeys);
}

function writePendingDeviceStorageRecoveryIndex(namespace: string, indexedKeys: string[]) {
  try {
    const indexKey = pendingDeviceStorageIndexKey(namespace);

    if (indexedKeys.length === 0) {
      window.localStorage.removeItem(indexKey);
      return;
    }

    window.localStorage.setItem(indexKey, JSON.stringify(indexedKeys));
  } catch {
    return;
  }
}

function parsePendingDeviceStorageWrite(value: string | null): PendingDeviceStorageWrite | null {
  if (!value) {
    return null;
  }

  try {
    const pendingWrite = JSON.parse(value) as Partial<PendingDeviceStorageWrite>;

    if (typeof pendingWrite.namespace !== "string" || typeof pendingWrite.key !== "string" || typeof pendingWrite.value !== "string") {
      return null;
    }

    return {
      key: pendingWrite.key,
      namespace: pendingWrite.namespace,
      updatedAt: typeof pendingWrite.updatedAt === "number" && Number.isFinite(pendingWrite.updatedAt) ? pendingWrite.updatedAt : 0,
      value: pendingWrite.value,
    };
  } catch {
    return null;
  }
}

function pendingDeviceStorageNamespacePrefix(namespace: string) {
  return `${PENDING_DEVICE_WRITE_PREFIX}${encodeURIComponent(namespace)}.`;
}

function pendingDeviceStorageIndexKey(namespace: string) {
  return `${PENDING_DEVICE_WRITE_INDEX_PREFIX}${encodeURIComponent(namespace)}`;
}

function pendingDeviceStorageKey(namespace: string, key: string) {
  return `${pendingDeviceStorageNamespacePrefix(namespace)}${encodeURIComponent(key)}`;
}

function scopedStorageKey(key: string) {
  if (storageNamespace === "legacy") {
    return key;
  }

  return `${key}.${storageNamespace}`;
}

function readRawString(key: string) {
  return window.localStorage.getItem(key);
}

function readRawStorageValue(key: string) {
  try {
    if (storageNamespace !== "legacy") {
      return readRawString(scopedStorageKey(key));
    }

    return readRawString(key);
  } catch {
    return null;
  }
}

function collectStartupLocalStorageSeeds(): DeviceDatabaseSeed[] {
  if (typeof window === "undefined") {
    return [];
  }

  const seeds = new Map<string, string>();

  for (const key of PERSISTED_STORAGE_KEYS) {
    const value = readRawStorageValue(key);

    if (value !== null) {
      seeds.set(key, value);
    }
  }

  return Array.from(seeds.entries()).map(([key, value]) => ({ key, value }));
}

function schedulePrefixedLocalStorageSeedMigration(namespace: string) {
  if (typeof window === "undefined" || prefixedSeedMigrationNamespaces.has(namespace)) {
    return;
  }

  const markerKey = prefixedSeedMigrationMarkerKey(namespace);
  try {
    if (window.localStorage.getItem(markerKey) === "true") {
      return;
    }
  } catch {
    return;
  }

  prefixedSeedMigrationNamespaces.add(namespace);
  let index = 0;

  const migrateChunk = () => {
    if (namespace !== storageNamespace || !deviceStorageInitialized || !isDeviceDatabaseAvailable()) {
      prefixedSeedMigrationNamespaces.delete(namespace);
      return;
    }

    const migrated = migratePrefixedLocalStorageSeedChunk(namespace, index, PREFIXED_SEED_MIGRATION_CHUNK_SIZE);
    index = migrated.nextIndex;

    if (!migrated.complete) {
      scheduleIdleTask(migrateChunk, 1_500);
      return;
    }

    try {
      window.localStorage.setItem(markerKey, "true");
    } catch {
      // A marker is only a startup optimization; the migrated values already live in the database queue.
    } finally {
      prefixedSeedMigrationNamespaces.delete(namespace);
    }
  };

  scheduleDelayedIdleTask(migrateChunk, PREFIXED_SEED_MIGRATION_DELAY_MS, 5_000);
}

function migratePrefixedLocalStorageSeedChunk(namespace: string, startIndex: number, chunkSize: number) {
  let index = startIndex;
  let scanned = 0;

  try {
    const total = window.localStorage.length;

    while (index < total && scanned < chunkSize) {
      const rawKey = window.localStorage.key(index);
      index += 1;
      scanned += 1;

      const seed = createPrefixedLocalStorageSeed(namespace, rawKey);

      if (!seed || deviceStorageValues.has(seed.key)) {
        continue;
      }

      deviceStorageValues.set(seed.key, seed.value);
      queueDeviceStorageWrite(namespace, seed.key, seed.value);
    }

    return {
      complete: index >= total,
      nextIndex: index,
    };
  } catch {
    return {
      complete: true,
      nextIndex: index,
    };
  }
}

function createPrefixedLocalStorageSeed(namespace: string, rawKey: string | null): DeviceDatabaseSeed | null {
  if (!rawKey) {
    return null;
  }

  const namespaceSuffix = namespace === "legacy" ? "" : `.${namespace}`;

  try {
    const key = namespaceSuffix
      ? rawKey.endsWith(namespaceSuffix)
        ? rawKey.slice(0, -namespaceSuffix.length)
        : ""
      : rawKey;

    if (!key || !PERSISTED_STORAGE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      return null;
    }

    const value = window.localStorage.getItem(rawKey);

    return value !== null ? { key, value } : null;
  } catch {
    return null;
  }
}

function prefixedSeedMigrationMarkerKey(namespace: string) {
  return `${PREFIXED_SEED_MIGRATION_MARKER_PREFIX}${encodeURIComponent(namespace)}`;
}

function scheduleLegacyBrowserStorageCleanup() {
  scheduleDelayedIdleTask(purgeLegacyBrowserStorage, LEGACY_BROWSER_STORAGE_CLEANUP_DELAY_MS, 5_000);
}

function purgeLegacyBrowserStorage() {
  if (typeof window === "undefined") {
    return;
  }

  const allLegacyKeys = [...PERSISTED_STORAGE_KEYS, ...LEGACY_BROWSER_ONLY_KEYS];

  try {
    for (const key of allLegacyKeys) {
      window.localStorage.removeItem(key);

      if (storageNamespace !== "legacy") {
        window.localStorage.removeItem(scopedStorageKey(key));
      }
    }
  } catch {
    return;
  }
}

function sanitizeStorageScope(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 80) || "local";
}

function normalizeNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeText(value: unknown, fallback: string) {
  return typeof value === "string" ? value : fallback;
}

function normalizeModel(value: unknown, provider: ProviderSettings["provider"], providerModels: ProviderSettings["providerModels"]) {
  if (typeof value === "string" && value.trim()) {
    return normalizeProviderModelId(provider, value.trim());
  }

  const providerModel = providerModels[provider];

  return normalizeProviderModelId(provider, typeof providerModel === "string" && providerModel.trim() ? providerModel.trim() : defaultProviderSettings.providerModels[provider] ?? defaultProviderSettings.model);
}

function normalizeModelProvider(value: unknown): ProviderSettings["provider"] {
  return isModelProviderId(value) ? value : defaultProviderSettings.provider;
}

function normalizeProviderSecretMap(value: unknown): ProviderSettings["apiKeys"] {
  const storedMap = typeof value === "object" && value ? (value as Partial<Record<string, unknown>>) : {};

  return Object.entries(defaultProviderSettings.baseUrls).reduce<ProviderSettings["apiKeys"]>((map, [providerId]) => {
    const value = storedMap[providerId];

    if (typeof value === "string") {
      map[providerId as ProviderSettings["provider"]] = value;
    }

    return map;
  }, {});
}

function normalizeProviderBaseUrls(value: unknown): ProviderSettings["baseUrls"] {
  const storedMap = typeof value === "object" && value ? (value as Partial<Record<string, unknown>>) : {};

  return Object.entries(defaultProviderSettings.baseUrls).reduce<ProviderSettings["baseUrls"]>((baseUrls, [providerId, fallbackUrl]) => {
    const value = storedMap[providerId];
    const provider = providerId as ProviderSettings["provider"];

    baseUrls[provider] = normalizeProviderBaseUrl(provider, typeof value === "string" && value.trim() ? value.trim() : fallbackUrl || getDefaultBaseUrlForProvider(provider));

    return baseUrls;
  }, {});
}

function normalizeProviderContextWindowTokens(value: unknown): ProviderContextWindowMap {
  const storedMap = typeof value === "object" && value ? (value as Partial<Record<string, unknown>>) : {};

  return Object.entries(defaultProviderSettings.baseUrls).reduce<ProviderContextWindowMap>((contextWindows, [providerId]) => {
    const provider = providerId as ProviderSettings["provider"];
    const storedValue = storedMap[providerId];

    if (typeof storedValue === "number" && Number.isFinite(storedValue) && storedValue > 0) {
      contextWindows[provider] = normalizeContextWindowTokens(storedValue);
    }

    return contextWindows;
  }, {});
}

function normalizeProviderModelBudgetOverrides(value: unknown): ProviderModelBudgetOverrideMap {
  const storedMap = typeof value === "object" && value ? (value as Partial<Record<string, unknown>>) : {};
  const overrides: ProviderModelBudgetOverrideMap = {};

  for (const [providerId] of Object.entries(defaultProviderSettings.baseUrls)) {
    const provider = providerId as ProviderSettings["provider"];
    const providerOverrides = typeof storedMap[providerId] === "object" && storedMap[providerId]
      ? (storedMap[providerId] as Partial<Record<string, unknown>>)
      : {};
    const normalizedProviderOverrides: NonNullable<ProviderModelBudgetOverrideMap[ProviderSettings["provider"]]> = {};

    for (const [rawModel, rawOverride] of Object.entries(providerOverrides)) {
      if (!rawModel.trim() || typeof rawOverride !== "object" || !rawOverride) {
        continue;
      }

      const override = rawOverride as Partial<Record<string, unknown>>;
      const contextWindowTokens = typeof override.contextWindowTokens === "number" && Number.isFinite(override.contextWindowTokens) && override.contextWindowTokens > 0
        ? normalizeContextWindowTokens(override.contextWindowTokens)
        : undefined;
      const maxOutputTokens = typeof override.maxOutputTokens === "number" && Number.isFinite(override.maxOutputTokens) && override.maxOutputTokens > 0
        ? normalizeMaxTokens(override.maxOutputTokens)
        : undefined;

      if (contextWindowTokens || maxOutputTokens) {
        normalizedProviderOverrides[rawModel.trim()] = {
          contextWindowTokens,
          maxOutputTokens,
        };
      }
    }

    if (Object.keys(normalizedProviderOverrides).length > 0) {
      overrides[provider] = normalizedProviderOverrides;
    }
  }

  return overrides;
}

function normalizeProviderModels(value: unknown): ProviderSettings["providerModels"] {
  const storedMap = typeof value === "object" && value ? (value as Partial<Record<string, unknown>>) : {};

  return Object.entries(defaultProviderSettings.providerModels).reduce<ProviderSettings["providerModels"]>((models, [providerId, fallbackModel]) => {
    const value = storedMap[providerId];
    const provider = providerId as ProviderSettings["provider"];

    models[provider] = normalizeProviderModelId(provider, typeof value === "string" && value.trim() ? value.trim() : fallbackModel ?? defaultProviderSettings.model);

    return models;
  }, {});
}

function normalizeDisabledProviderModels(value: unknown): ProviderModelVisibilityMap {
  const storedMap = typeof value === "object" && value ? (value as Partial<Record<string, unknown>>) : {};

  return Object.entries(defaultProviderSettings.providerModels).reduce<ProviderModelVisibilityMap>((models, [providerId]) => {
    const provider = providerId as ProviderSettings["provider"];
    const values = Array.isArray(storedMap[providerId]) ? storedMap[providerId] : [];
    const seen = new Set<string>();
    const normalizedValues = values.flatMap((value) => {
      if (typeof value !== "string" || !value.trim()) {
        return [];
      }

      const normalizedValue = value.trim();

      if (!normalizedValue || seen.has(normalizedValue)) {
        return [];
      }

      seen.add(normalizedValue);
      return [normalizedValue];
    });

    if (normalizedValues.length > 0) {
      models[provider] = normalizedValues;
    }

    return models;
  }, {});
}

function removeDisabledProviderModelValue(disabledModels: ProviderModelVisibilityMap, provider: ProviderSettings["provider"], model: string) {
  const normalizedModel = normalizeProviderModelId(provider, model);
  const disabledValues = disabledModels[provider];

  if (!normalizedModel || !disabledValues?.length) {
    return;
  }

  const nextValues = disabledValues.filter((value) => value !== normalizedModel);

  if (nextValues.length > 0) {
    disabledModels[provider] = nextValues;
  } else {
    delete disabledModels[provider];
  }
}

function normalizeChatMessage(message: ChatMessage): ChatMessage {
  const legacyDiscordMessage = parseLegacyDiscordMessage(message.content);

  return {
    ...message,
    agentRunId: typeof message.agentRunId === "string" && message.agentRunId ? message.agentRunId : undefined,
    agentRunStatus: normalizeAgentRunStatus(message.agentRunStatus),
    approvals: normalizeAgentApprovals(message.approvals),
    artifacts: normalizeArtifacts(message.artifacts),
    attachments: normalizeAttachments(message.attachments),
    contextCompactions: normalizeContextCompactions(message.contextCompactions),
    content: legacyDiscordMessage?.content ?? (typeof message.content === "string" ? message.content : ""),
    createdAt: message.createdAt || new Date().toISOString(),
    feedback: normalizeChatMessageFeedback(message.feedback),
    id: message.id || `message-${Date.now()}`,
    isStreaming: false,
    mode: normalizeChatMessageMode(message.mode),
    planning: normalizeChatPlanning(message.planning),
    progress: normalizeProgressItems(message.progress),
    reasoning: normalizeVisibleReasoning(message.reasoning),
    role: message.role === "assistant" ? "assistant" : "user",
    researchReferences: normalizeResearchReferences(message.researchReferences),
    source: normalizeChatMessageSource(message.source) ?? legacyDiscordMessage?.source,
    sources: normalizeChatSources(message.sources),
    status: message.status === "error" ? "error" : undefined,
    streamTiming: normalizeChatStreamTiming(message.streamTiming),
    toolCalls: normalizeToolCalls(message.toolCalls),
    webSearch: normalizeChatWebSearch(message.webSearch),
    workTrace: normalizeWorkTraceItems(message.workTrace),
  };
}

function normalizeChatMessageFeedback(value: unknown): ChatMessage["feedback"] {
  return value === "liked" || value === "disliked" ? value : undefined;
}

function normalizeComposerDraft(value: unknown): ChatComposerDraft | undefined {
  if (typeof value !== "object" || !value) {
    return undefined;
  }

  const draft = value as Partial<ChatComposerDraft>;
  const content = typeof draft.content === "string" ? draft.content : "";
  const attachments = normalizeAttachments(draft.attachments) ?? [];

  if (!content.trim() && attachments.length === 0) {
    return undefined;
  }

  return {
    attachments,
    content,
  };
}

function normalizeResearchReferences(value: unknown): ChatResearchReference[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const references = value.flatMap((item): ChatResearchReference[] => {
    if (!isRecord(item)) {
      return [];
    }

    const chatId = normalizeOptionalText(item.chatId);

    if (!chatId) {
      return [];
    }

    return [
      {
        chatId,
        project: normalizeProjectName(normalizeOptionalText(item.project)),
        title: normalizeOptionalText(item.title) || "Untitled chat",
        updatedAt: normalizeOptionalText(item.updatedAt) || new Date().toISOString(),
      },
    ];
  });

  return references.length > 0 ? references : undefined;
}

function normalizeChatMessageMode(value: unknown): ChatMessage["mode"] | undefined {
  return value === "chat" || value === "plan" ? value : undefined;
}

function normalizeChatStreamTiming(value: unknown): ChatStreamTiming | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const requestStartedAt = normalizeOptionalText(value.requestStartedAt);

  if (!requestStartedAt) {
    return undefined;
  }

  return {
    completedAt: normalizeOptionalText(value.completedAt),
    firstByteAt: normalizeOptionalText(value.firstByteAt),
    firstProviderEventAt: normalizeOptionalText(value.firstProviderEventAt),
    firstTokenAt: normalizeOptionalText(value.firstTokenAt),
    firstVisibleTokenAt: normalizeOptionalText(value.firstVisibleTokenAt),
    requestStartedAt,
    responseStartedAt: normalizeOptionalText(value.responseStartedAt),
    timeToFirstByteMs: normalizeNonNegativeNumber(value.timeToFirstByteMs),
    timeToFirstProviderEventMs: normalizeNonNegativeNumber(value.timeToFirstProviderEventMs),
    timeToFirstTokenMs: normalizeNonNegativeNumber(value.timeToFirstTokenMs),
    timeToFirstVisibleTokenMs: normalizeNonNegativeNumber(value.timeToFirstVisibleTokenMs),
    timeToResponseStartMs: normalizeNonNegativeNumber(value.timeToResponseStartMs),
    totalMs: normalizeNonNegativeNumber(value.totalMs),
  };
}

function normalizeChatPlanning(value: unknown): ChatPlanning | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const inputRequest = normalizePlanningInputRequest(value.inputRequest);
  const inputRequests = normalizePlanningInputRequests(value.inputRequests);
  const startedAt = normalizeOptionalText(value.startedAt);

  if (!startedAt && !inputRequest && !inputRequests?.length) {
    return undefined;
  }

  return {
    completedAt: normalizeOptionalText(value.completedAt),
    inputRequest,
    inputRequests,
    maxPasses: Math.max(normalizeNumber(value.maxPasses, 1), 1),
    passCount: Math.max(normalizeNumber(value.passCount, 0), 0),
    planContent: normalizeOptionalText(value.planContent),
    startedAt: startedAt ?? new Date().toISOString(),
  };
}

function normalizePlanningInputRequests(value: unknown): ChatPlanning["inputRequests"] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const requests = value.flatMap((item) => {
    const request = normalizePlanningInputRequest(item);
    return request ? [request] : [];
  });

  return requests.length > 0 ? requests : undefined;
}

function normalizePlanningInputRequest(value: unknown): ChatPlanning["inputRequest"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const id = normalizeOptionalText(value.id);
  const title = normalizeOptionalText(value.title);
  const requestedAt = normalizeOptionalText(value.requestedAt);
  const questions = normalizePlanningQuestions(value.questions);

  if (!id || !title || !requestedAt || questions.length === 0) {
    return undefined;
  }

  return {
    answeredAt: normalizeOptionalText(value.answeredAt),
    answers: normalizePlanningAnswers(value.answers),
    detail: normalizeOptionalText(value.detail),
    id,
    questions,
    requestedAt,
    title,
  };
}

function normalizePlanningQuestions(value: unknown): NonNullable<ChatPlanning["inputRequest"]>["questions"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    const id = normalizeOptionalText(item.id);
    const question = normalizeOptionalText(item.question);

    if (!id || !question) {
      return [];
    }

    return [
      {
        id,
        options: normalizePlanningQuestionOptions(item.options),
        placeholder: normalizeOptionalText(item.placeholder),
        question,
        required: typeof item.required === "boolean" ? item.required : undefined,
      },
    ];
  });
}

function normalizePlanningQuestionOptions(value: unknown): NonNullable<NonNullable<ChatPlanning["inputRequest"]>["questions"][number]["options"]> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const options = value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    const id = normalizeOptionalText(item.id);
    const label = normalizeOptionalText(item.label);

    if (!id || !label) {
      return [];
    }

    return [
      {
        description: normalizeOptionalText(item.description),
        id,
        label,
      },
    ];
  });

  return options.length > 0 ? options : undefined;
}

function normalizePlanningAnswers(value: unknown): NonNullable<ChatPlanning["inputRequest"]>["answers"] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const answers = value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    const questionId = normalizeOptionalText(item.questionId);
    const answerValue = typeof item.value === "string" ? item.value : undefined;

    if (!questionId || answerValue === undefined) {
      return [];
    }

    return [
      {
        optionId: normalizeOptionalText(item.optionId),
        questionId,
        value: answerValue,
      },
    ];
  });

  return answers.length > 0 ? answers : undefined;
}

function normalizeChatSources(value: unknown): ChatSource[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const sources = value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    const title = normalizeOptionalText(item.title);
    const url = normalizeOptionalText(item.url);

    if (!title || !url) {
      return [];
    }

    return [
      {
        detail: normalizeOptionalText(item.detail),
        id: normalizeOptionalText(item.id),
        imageUrl: normalizeOptionalText(item.imageUrl),
        sourceType: normalizeChatSourceType(item.sourceType),
        thumbnailUrl: normalizeOptionalText(item.thumbnailUrl),
        title,
        url,
      },
    ];
  });

  return sources.length > 0 ? sources : undefined;
}

function normalizeChatSourceType(value: unknown): ChatSource["sourceType"] | undefined {
  return value === "answer" || value === "image" || value === "news" || value === "place" || value === "video" || value === "web" ? value : undefined;
}

function normalizeChatWebSearch(value: unknown): ChatWebSearch | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    enabled: Boolean(value.enabled),
    error: normalizeOptionalText(value.error),
    fallbackReason: normalizeOptionalText(value.fallbackReason),
    maxResults: typeof value.maxResults === "number" && Number.isFinite(value.maxResults) ? Math.max(1, Math.round(value.maxResults)) : undefined,
    provider: normalizeWebSearchProvider(value.provider),
    query: normalizeOptionalText(value.query),
    resultCount: typeof value.resultCount === "number" && Number.isFinite(value.resultCount) ? Math.max(0, Math.round(value.resultCount)) : undefined,
    resultProvider: normalizeOptionalWebSearchProvider(value.resultProvider),
    searchedAt: normalizeOptionalText(value.searchedAt),
    status: normalizeChatWebSearchStatus(value.status),
  };
}

function normalizeChatWebSearchStatus(value: unknown): ChatWebSearch["status"] | undefined {
  return value === "active" || value === "complete" || value === "error" ? value : undefined;
}

function normalizeOptionalWebSearchProvider(value: unknown): WebSearchProvider | undefined {
  return value === "brave" || value === "duckduckgo" ? value : undefined;
}

function normalizeChatMessageSource(value: unknown): ChatMessage["source"] | undefined {
  if (typeof value !== "object" || !value) {
    return undefined;
  }

  const source = value as Partial<NonNullable<ChatMessage["source"]>>;

  if (source.kind !== "discord") {
    return undefined;
  }

  return {
    channelId: normalizeOptionalText(source.channelId),
    commandName: normalizeOptionalText(source.commandName),
    guildId: normalizeOptionalText(source.guildId),
    kind: "discord",
    receivedAt: normalizeOptionalText(source.receivedAt),
    userId: normalizeOptionalText(source.userId),
    username: normalizeOptionalText(source.username),
  };
}

function parseLegacyDiscordMessage(content: unknown): { content: string; source: NonNullable<ChatMessage["source"]> } | null {
  if (typeof content !== "string" || !content.startsWith("DISCORD SLASH COMMAND")) {
    return null;
  }

  const lines = content.split(/\r?\n/);
  const command = findLegacyDiscordValue(lines, "Command:");
  const from = findLegacyDiscordValue(lines, "From:");
  const promptIndex = lines.findIndex((line) => line.trim().toLowerCase() === "user prompt:");
  const prompt = promptIndex >= 0 ? lines.slice(promptIndex + 1).join("\n").trim() : content.replace(/^DISCORD SLASH COMMAND\s*/i, "").trim();
  const fromParts = from ? from.split(/\s+/).filter(Boolean) : [];
  const possibleUserId = fromParts.find((part) => /^\d{10,}$/.test(part));
  const username = fromParts.filter((part) => part !== possibleUserId).join(" ");

  return {
    content: prompt || content,
    source: {
      channelId: findLegacyDiscordValue(lines, "Channel ID:"),
      commandName: command?.replace(/^\//, ""),
      guildId: findLegacyDiscordValue(lines, "Guild ID:"),
      kind: "discord",
      userId: possibleUserId,
      username: username || undefined,
    },
  };
}

function findLegacyDiscordValue(lines: string[], label: string) {
  const line = lines.find((candidate) => candidate.trim().startsWith(label));
  return line?.slice(line.indexOf(label) + label.length).trim() || undefined;
}

function normalizeOptionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeVisibleReasoning(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.replace(/\r\n/g, "\n").trim();
  return normalized ? normalized.slice(0, 12_000) : undefined;
}

function normalizeArtifacts(value: unknown): ChatArtifact[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const artifacts = value.flatMap((item) => {
    if (typeof item !== "object" || !item) {
      return [];
    }

    const artifact = item as Partial<ChatArtifact>;
    const title = typeof artifact.title === "string" && artifact.title.trim() ? artifact.title.trim() : "";

    if (!title) {
      return [];
    }

    return [
      {
        detail: normalizeOptionalText(artifact.detail),
        id: normalizeOptionalText(artifact.id),
        kind: normalizeArtifactKind(artifact.kind),
        mimeType: normalizeOptionalText(artifact.mimeType),
        sizeBytes: typeof artifact.sizeBytes === "number" && Number.isFinite(artifact.sizeBytes) ? artifact.sizeBytes : undefined,
        sourceFormat: artifact.sourceFormat === "markdown" || artifact.sourceFormat === "text" ? artifact.sourceFormat : undefined,
        sourceText: typeof artifact.sourceText === "string" ? artifact.sourceText : undefined,
        title,
        url: typeof artifact.url === "string" ? artifact.url : undefined,
      } satisfies ChatArtifact,
    ];
  });

  return artifacts.length > 0 ? artifacts : undefined;
}

function normalizeArtifactKind(value: unknown): ChatArtifact["kind"] | undefined {
  return value === "code" || value === "document" || value === "file" || value === "image" || value === "other" || value === "preview" ? value : undefined;
}

function normalizeContextCompactions(value: unknown): ChatContextCompaction[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const compacted = value.flatMap((item) => {
    if (typeof item !== "object" || !item) {
      return [];
    }

    const compaction = item as Partial<ChatContextCompaction>;

    if (typeof compaction.compactedAt !== "string") {
      return [];
    }

    return [
      {
        afterTokens: normalizeNumber(compaction.afterTokens, 0),
        beforeTokens: normalizeNumber(compaction.beforeTokens, 0),
        compactedAt: compaction.compactedAt,
        compactedMessageCount: normalizeNumber(compaction.compactedMessageCount, 0),
        contextWindowTokens: typeof compaction.contextWindowTokens === "number" ? compaction.contextWindowTokens : undefined,
        forcedByProviderUsage: Boolean(compaction.forcedByProviderUsage),
        strategy: typeof compaction.strategy === "string" ? compaction.strategy : undefined,
        summaryVersion: typeof compaction.summaryVersion === "number" ? Math.round(compaction.summaryVersion) : undefined,
        thresholdTokens: typeof compaction.thresholdTokens === "number" ? compaction.thresholdTokens : undefined,
      } satisfies ChatContextCompaction,
    ];
  });

  return compacted.length > 0 ? compacted : undefined;
}

function normalizeProgressItems(value: unknown): ChatProgressItem[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const progress = value.flatMap((item) => {
    if (typeof item !== "object" || !item) {
      return [];
    }

    const progressItem = item as Partial<ChatProgressItem>;

    if (typeof progressItem.label !== "string" || !progressItem.label.trim()) {
      return [];
    }

    const id = normalizeProgressItemId(progressItem.id);

    return [
      {
        detail: progressItem.status === "active" ? "Stopped when the app reloaded." : progressItem.detail,
        id,
        label: id === "local-computer-tools" ? "Tool progress" : progressItem.label,
        status: progressItem.status === "pending" ? "pending" : "complete",
      } satisfies ChatProgressItem,
    ];
  });
  const dedupedProgress = dedupeProgressItems(progress);

  return dedupedProgress.length > 0 ? dedupedProgress : undefined;
}

function normalizeProgressItemId(id: unknown) {
  if (typeof id !== "string" || !id.trim()) {
    return undefined;
  }

  return id === "local-tools-disabled" ? "local-computer-tools" : id;
}

function dedupeProgressItems(progress: ChatProgressItem[]) {
  const deduped: ChatProgressItem[] = [];
  const idIndexes = new Map<string, number>();

  for (const item of progress) {
    if (!item.id) {
      deduped.push(item);
      continue;
    }

    const existingIndex = idIndexes.get(item.id);

    if (existingIndex === undefined) {
      idIndexes.set(item.id, deduped.length);
      deduped.push(item);
    } else {
      deduped[existingIndex] = item;
    }
  }

  return deduped;
}

function normalizeToolCalls(value: unknown): ChatToolCall[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const toolCalls = value.flatMap((item) => {
    if (typeof item !== "object" || !item) {
      return [];
    }

    const toolCall = item as Partial<ChatToolCall>;

    if (typeof toolCall.label !== "string" || !toolCall.label.trim()) {
      return [];
    }

    return [
      {
        batchFileResults: normalizeToolCallBatchFileResults(toolCall.batchFileResults),
        batchSummary: normalizeToolCallBatchSummary(toolCall.batchSummary),
        detail: typeof toolCall.detail === "string" ? toolCall.detail : undefined,
        fileChanges: normalizeToolCallFileChanges(toolCall.fileChanges),
        id: typeof toolCall.id === "string" && toolCall.id ? toolCall.id : `tool-call-${Date.now()}`,
        input: typeof toolCall.input === "string" ? toolCall.input : undefined,
        label: toolCall.label,
        output: toolCall.status === "active" ? "This tool run was interrupted before it returned a result." : toolCall.output,
        resultPolicy: normalizeToolResultPolicy(toolCall.resultPolicy),
        status: toolCall.status === "active" ? "error" : normalizeToolCallStatus(toolCall.status),
        terminal: normalizeToolCallTerminal(toolCall.terminal),
        toolId: normalizeOptionalText(toolCall.toolId),
      } satisfies ChatToolCall,
    ];
  });

  return toolCalls.length > 0 ? toolCalls : undefined;
}

function normalizeToolCallBatchFileResults(value: unknown): ChatToolCall["batchFileResults"] {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const fileResults = value.flatMap((item) => {
    if (typeof item !== "object" || !item) {
      return [];
    }

    const result = item as NonNullable<ChatToolCall["batchFileResults"]>[number];
    if (typeof result.path !== "string" || !result.path.trim()) {
      return [];
    }

    const status: NonNullable<ChatToolCall["batchFileResults"]>[number]["status"] = result.status === "error" || result.status === "skipped" ? result.status : "ok";

    return [
      {
        additions: typeof result.additions === "number" && Number.isFinite(result.additions) ? Math.max(0, Math.round(result.additions)) : 0,
        deletions: typeof result.deletions === "number" && Number.isFinite(result.deletions) ? Math.max(0, Math.round(result.deletions)) : 0,
        detail: typeof result.detail === "string" && result.detail.trim() ? result.detail : undefined,
        kind: result.kind === "create" || result.kind === "delete" || result.kind === "move" || result.kind === "update" ? result.kind : undefined,
        path: result.path,
        requestedPath: typeof result.requestedPath === "string" && result.requestedPath.trim() ? result.requestedPath : undefined,
        status,
      },
    ];
  });

  return fileResults.length > 0 ? fileResults : undefined;
}

function normalizeToolCallBatchSummary(value: unknown): ChatToolCall["batchSummary"] {
  if (typeof value !== "object" || !value) {
    return undefined;
  }

  const summary = value as Partial<NonNullable<ChatToolCall["batchSummary"]>>;
  const operation = summary.operation === "write" ? "write" : summary.operation === "edit" ? "edit" : undefined;

  if (!operation) {
    return undefined;
  }

  return {
    failureCount: normalizeCount(summary.failureCount),
    fileCount: normalizeCount(summary.fileCount),
    operation,
    requestedCount: normalizeCount(summary.requestedCount),
    skippedCount: normalizeCount(summary.skippedCount),
    successCount: normalizeCount(summary.successCount),
  };
}

function normalizeCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function normalizeWorkTraceItems(value: unknown): ChatWorkTraceItem[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const items: ChatWorkTraceItem[] = [];

  for (const item of value) {
    if (typeof item !== "object" || !item) {
      continue;
    }

    const traceItem = item as Record<string, unknown>;
    const id = typeof traceItem.id === "string" && traceItem.id.trim() ? traceItem.id.trim() : `work-trace-${Date.now()}`;

    if (traceItem.kind === "tool") {
      const [toolCall] = normalizeToolCalls([traceItem.toolCall]) ?? [];

      if (toolCall) {
        items.push({
          id,
          kind: "tool",
          toolCall,
        });
      }
      continue;
    }

    if (traceItem.kind === "progress") {
      const [progress] = normalizeProgressItems([traceItem.progress]) ?? [];

      if (progress) {
        items.push({
          id,
          kind: "progress",
          progress,
        });
      }
    }
  }

  return items.length > 0 ? items : undefined;
}

function normalizeToolCallFileChanges(value: unknown): ChatToolCall["fileChanges"] {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const fileChanges = value.flatMap((item) => {
    if (typeof item !== "object" || !item) {
      return [];
    }

    const change = item as NonNullable<ChatToolCall["fileChanges"]>[number];
    if (typeof change.path !== "string" || !change.path.trim()) {
      return [];
    }

    return [
      {
        additions: typeof change.additions === "number" && Number.isFinite(change.additions) ? Math.max(0, Math.round(change.additions)) : 0,
        deletions: typeof change.deletions === "number" && Number.isFinite(change.deletions) ? Math.max(0, Math.round(change.deletions)) : 0,
        diffPreview: normalizeToolCallDiffPreview(change.diffPreview),
        diffTruncated: typeof change.diffTruncated === "boolean" ? change.diffTruncated : undefined,
        kind: change.kind === "create" || change.kind === "delete" || change.kind === "move" || change.kind === "update" ? change.kind : undefined,
        path: change.path,
      },
    ];
  });

  return fileChanges.length > 0 ? fileChanges : undefined;
}

function normalizeToolCallDiffPreview(value: unknown): NonNullable<NonNullable<ChatToolCall["fileChanges"]>[number]["diffPreview"]> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const lines = value.flatMap((item) => {
    if (typeof item !== "object" || !item) {
      return [];
    }

    const line = item as NonNullable<NonNullable<ChatToolCall["fileChanges"]>[number]["diffPreview"]>[number];
    const kind = line.kind === "add" || line.kind === "context" || line.kind === "hunk" || line.kind === "meta" || line.kind === "remove" ? line.kind : undefined;

    if (!kind || typeof line.content !== "string") {
      return [];
    }

    return [
      {
        content: line.content,
        kind,
        newLine: normalizeOptionalNumber(line.newLine),
        oldLine: normalizeOptionalNumber(line.oldLine),
      },
    ];
  });

  return lines.length > 0 ? lines.slice(0, 120) : undefined;
}

function normalizeToolResultPolicy(value: unknown): ChatToolCall["resultPolicy"] {
  if (typeof value !== "object" || !value) {
    return undefined;
  }

  const policy = value as Partial<NonNullable<ChatToolCall["resultPolicy"]>>;
  const mode = normalizeToolResultVisibleMode(policy.mode);
  const resultKind = normalizeToolResultKind(policy.resultKind);

  if (!mode || !resultKind) {
    return undefined;
  }

  return {
    mode,
    resultKind,
    synthesizeAfterwards: Boolean(policy.synthesizeAfterwards),
  };
}

function normalizeToolResultVisibleMode(value: unknown): NonNullable<ChatToolCall["resultPolicy"]>["mode"] | undefined {
  return value === "allow_raw" || value === "safe_summary" || value === "synthesize" ? value : undefined;
}

function normalizeToolResultKind(value: unknown): NonNullable<ChatToolCall["resultPolicy"]>["resultKind"] | undefined {
  return value === "diagnostic" || value === "edit" || value === "file_content" || value === "git" || value === "search" || value === "summary" || value === "terminal" || value === "unknown"
    ? value
    : undefined;
}

function normalizeToolCallTerminal(value: unknown): ChatToolCall["terminal"] {
  if (typeof value !== "object" || !value) {
    return undefined;
  }

  const terminal = value as NonNullable<ChatToolCall["terminal"]>;
  const shell = isTerminalShellId(terminal.shell) ? terminal.shell : undefined;

  return {
    command: typeof terminal.command === "string" ? terminal.command : undefined,
    exitCode: typeof terminal.exitCode === "number" || terminal.exitCode === null ? terminal.exitCode : undefined,
    live: typeof terminal.live === "boolean" ? terminal.live : undefined,
    outputTruncated: typeof terminal.outputTruncated === "boolean" ? terminal.outputTruncated : undefined,
    sessionId: typeof terminal.sessionId === "string" ? terminal.sessionId : undefined,
    shell,
    timedOut: typeof terminal.timedOut === "boolean" ? terminal.timedOut : undefined,
    workingDirectory: typeof terminal.workingDirectory === "string" ? terminal.workingDirectory : undefined,
  };
}

function normalizeToolCallStatus(status: unknown): ChatToolCall["status"] {
  if (status === "complete" || status === "error" || status === "skipped" || status === "waiting_approval") {
    return status;
  }

  return "skipped";
}

function normalizeAgentRunStatus(status: unknown): ChatMessage["agentRunStatus"] {
  if (status === "queued" || status === "running" || status === "waiting_for_approval" || status === "completed" || status === "failed" || status === "cancelled") {
    return status;
  }

  return undefined;
}

function normalizeAgentApprovals(value: unknown): AgentApproval[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const approvals = value.flatMap((item) => {
    if (typeof item !== "object" || !item) {
      return [];
    }

    const approval = item as Partial<AgentApproval>;
    const id = typeof approval.id === "string" && approval.id ? approval.id : `approval-${Date.now()}`;
    const status = normalizeAgentApprovalStatus(approval.status);

    return [
      {
        args: isRecord(approval.args) ? approval.args : undefined,
        command: typeof approval.command === "string" ? approval.command : undefined,
        createdAt: typeof approval.createdAt === "string" ? approval.createdAt : new Date().toISOString(),
        detail: typeof approval.detail === "string" ? approval.detail : undefined,
        editedArgs: isRecord(approval.editedArgs) ? approval.editedArgs : undefined,
        id,
        kind: normalizeAgentApprovalKind(approval.kind),
        messageId: typeof approval.messageId === "string" ? approval.messageId : undefined,
        path: typeof approval.path === "string" ? approval.path : undefined,
        preview: typeof approval.preview === "string" ? approval.preview : undefined,
        resolvedAt: typeof approval.resolvedAt === "string" ? approval.resolvedAt : undefined,
        resolutionNote: typeof approval.resolutionNote === "string" ? approval.resolutionNote : undefined,
        resumeToolCallContent: typeof approval.resumeToolCallContent === "string" ? approval.resumeToolCallContent : undefined,
        risk: approval.risk === "high" || approval.risk === "medium" || approval.risk === "low" ? approval.risk : "medium",
        runId: typeof approval.runId === "string" ? approval.runId : undefined,
        status,
        title: typeof approval.title === "string" && approval.title.trim() ? approval.title : "Approval required",
        tool: typeof approval.tool === "string" && approval.tool.trim() ? approval.tool : "local_tool",
        toolCallId: typeof approval.toolCallId === "string" ? approval.toolCallId : undefined,
      } satisfies AgentApproval,
    ];
  });

  return approvals.length > 0 ? approvals : undefined;
}

function normalizeAgentApprovalStatus(status: unknown): AgentApproval["status"] {
  if (status === "approved" || status === "denied" || status === "edited" || status === "expired") {
    return status;
  }

  return "pending";
}

function normalizeAgentApprovalKind(kind: unknown): AgentApproval["kind"] {
  if (kind === "browser" || kind === "custom_tool" || kind === "delete" || kind === "edit" || kind === "file_create" || kind === "terminal" || kind === "write" || kind === "other") {
    return kind;
  }

  return "other";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeAttachments(value: unknown): ChatAttachment[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const attachments = value.flatMap((attachment) => {
    const normalized = normalizeAttachment(attachment);
    return normalized ? [normalized] : [];
  });

  return attachments.length > 0 ? attachments : undefined;
}

function normalizeAttachment(value: unknown): ChatAttachment | null {
  if (typeof value !== "object" || !value) {
    return null;
  }

  const attachment = value as Partial<ChatAttachment>;
  const kind = attachment.kind;
  const name = typeof attachment.name === "string" && attachment.name.trim() ? attachment.name : "Attachment";
  const mimeType = typeof attachment.mimeType === "string" && attachment.mimeType.trim() ? attachment.mimeType : "application/octet-stream";
  const size = normalizeNumber(attachment.size, 0);
  const base = {
    createdAt: typeof attachment.createdAt === "string" && attachment.createdAt ? attachment.createdAt : new Date().toISOString(),
    id: typeof attachment.id === "string" && attachment.id ? attachment.id : `attachment-${Date.now()}-${Math.round(Math.random() * 100000)}`,
    mimeType,
    name,
    size,
  };

  if (kind === "image") {
    const image = attachment as Partial<ChatImageAttachment>;

    if (typeof image.dataUrl !== "string" || !image.dataUrl.startsWith("data:image/")) {
      return null;
    }

    return {
      ...base,
      dataUrl: image.dataUrl,
      height: normalizeOptionalNumber(image.height),
      kind: "image",
      width: normalizeOptionalNumber(image.width),
    };
  }

  if (kind === "video") {
    const video = attachment as Partial<ChatVideoAttachment>;

    if (typeof video.dataUrl !== "string" || !video.dataUrl.startsWith("data:video/")) {
      return null;
    }

    return {
      ...base,
      dataUrl: video.dataUrl,
      kind: "video",
    };
  }

  if (kind === "file") {
    const file = attachment as Partial<ChatFileAttachment>;
    const dataUrl = typeof file.dataUrl === "string" && file.dataUrl.startsWith("data:") ? file.dataUrl : undefined;
    const text = typeof file.text === "string" ? file.text : undefined;

    return {
      ...base,
      dataUrl,
      kind: "file",
      text,
    } satisfies ChatFileAttachment;
  }

  return null;
}

function normalizeOptionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function normalizeNonNegativeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
}

function normalizePdfLibraryState(value: unknown): PdfLibraryState {
  const state = typeof value === "object" && value ? (value as Partial<PdfLibraryState>) : {};
  const deletedSourceIds = Array.isArray(state.deletedSourceIds)
    ? Array.from(new Set(state.deletedSourceIds.filter((id): id is string => typeof id === "string" && Boolean(id.trim())).map((id) => id.trim())))
    : [];
  const records = Array.isArray(state.records)
    ? state.records.flatMap((record) => {
        const normalized = normalizePdfLibraryRecord(record);
        return normalized ? [normalized] : [];
      })
    : [];

  return {
    deletedSourceIds,
    projectInstructions: normalizePdfProjectInstructions(state.projectInstructions),
    records,
  };
}

function normalizeUsageHistoryState(value: unknown): UsageHistoryState {
  const state = typeof value === "object" && value ? (value as Partial<UsageHistoryState>) : {};
  const records = Array.isArray(state.records)
    ? state.records.flatMap((record) => {
        const normalized = normalizeUsageRecord(record);
        return normalized.totalTokens > 0 || normalized.requestCount > 0 ? [normalized] : [];
      })
    : [];

  return {
    records,
    updatedAt: typeof state.updatedAt === "string" && state.updatedAt.trim() ? state.updatedAt : null,
    version: 1,
  };
}

function normalizeUsageRecord(value: unknown): ProviderUsageRecord {
  const record = typeof value === "object" && value ? (value as Partial<ProviderUsageRecord>) : {};
  const createdAt = normalizeIsoTimestamp(record.createdAt);
  const provider = isModelProviderId(record.provider) ? record.provider : defaultProviderSettings.provider;
  const model = typeof record.model === "string" && record.model.trim() ? record.model.trim() : defaultProviderSettings.model;
  const cacheCreationInputTokens = normalizeTokenCount(record.cacheCreationInputTokens);
  const cachedInputTokens = normalizeTokenCount(record.cachedInputTokens);
  const inputTokens = normalizeTokenCount(record.inputTokens);
  const outputTokens = normalizeTokenCount(record.outputTokens ?? record.completionTokens);
  const completionTokens = normalizeTokenCount(record.completionTokens ?? outputTokens);
  const reasoningTokens = normalizeTokenCount(record.reasoningTokens);
  const totalTokens = normalizeTokenCount(record.totalTokens || inputTokens + outputTokens + reasoningTokens);
  const unitCost = normalizeUsageCostBreakdown(record.unitCost);

  return {
    chatId: normalizeOptionalText(record.chatId),
    completionTokens,
    costSource: normalizeUsageCostSource(record.costSource),
    createdAt,
    dateKey: normalizeUsageDateKey(record.dateKey, createdAt),
    dayKey: normalizeUsageDateKey(record.dayKey, createdAt),
    endpoint: normalizeOptionalText(record.endpoint),
    id: typeof record.id === "string" && record.id.trim() ? record.id.trim() : `usage-${createdAt}-${provider}-${hashStableText(model)}`,
    cacheCreationInputTokens,
    cacheSavingsUsd: normalizeCurrency(record.cacheSavingsUsd),
    cachedInputTokens,
    inputTokens,
    model,
    monthKey: normalizeUsageMonthKey(record.monthKey, createdAt),
    outputTokens,
    pricingNote: normalizeOptionalText(record.pricingNote),
    provider,
    providerLabel: typeof record.providerLabel === "string" && record.providerLabel.trim() ? record.providerLabel.trim() : provider,
    reasoningTokens,
    requestCount: normalizeTokenCount(record.requestCount || 1),
    source: normalizeUsageRecordSource(record.source),
    totalCostUsd: normalizeCurrency(record.totalCostUsd),
    totalTokens,
    unitCost,
    weekKey: normalizeUsageWeekKey(record.weekKey, createdAt),
  };
}

function normalizeUsageRecordSource(value: unknown): ProviderUsageRecord["source"] {
  return value === "9router" || value === "estimated" || value === "provider" ? value : "estimated";
}

function normalizeUsageCostSource(value: unknown): ProviderUsageRecord["costSource"] {
  return value === "catalog" || value === "free" || value === "subscription" || value === "unknown" ? value : "unknown";
}

function normalizeUsageCostBreakdown(value: unknown): ProviderUsageRecord["unitCost"] {
  if (typeof value !== "object" || !value) {
    return undefined;
  }

  const breakdown = value as Partial<NonNullable<ProviderUsageRecord["unitCost"]>>;

  return {
    cacheCreationInputUsd: normalizeCurrency(breakdown.cacheCreationInputUsd),
    cachedInputUsd: normalizeCurrency(breakdown.cachedInputUsd),
    inputUsd: normalizeCurrency(breakdown.inputUsd),
    outputUsd: normalizeCurrency(breakdown.outputUsd),
    reasoningUsd: normalizeCurrency(breakdown.reasoningUsd),
    requestUsd: normalizeCurrency(breakdown.requestUsd),
    totalUsd: normalizeCurrency(breakdown.totalUsd),
  };
}

function normalizeIsoTimestamp(value: unknown) {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  return new Date().toISOString();
}

function normalizeUsageDateKey(value: unknown, timestamp: string) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  return timestamp.slice(0, 10);
}

function normalizeUsageMonthKey(value: unknown, timestamp: string) {
  if (typeof value === "string" && /^\d{4}-\d{2}$/.test(value)) {
    return value;
  }

  return timestamp.slice(0, 7);
}

function normalizeUsageWeekKey(value: unknown, timestamp: string) {
  if (typeof value === "string" && /^\d{4}-W\d{2}$/.test(value)) {
    return value;
  }

  return createUsageWeekKey(new Date(timestamp));
}

function createUsageWeekKey(date: Date) {
  const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((utcDate.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);

  return `${utcDate.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function normalizeTokenCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function normalizeCurrency(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Number(value.toFixed(8)) : 0;
}

function normalizePdfProjectInstructions(value: unknown): Record<string, PdfProjectInstruction> {
  if (typeof value !== "object" || !value) {
    return {};
  }

  const entries = Object.entries(value as Record<string, unknown>).flatMap(([projectKey, item]) => {
    if (typeof item !== "object" || !item) {
      return [];
    }

    const instruction = item as Partial<PdfProjectInstruction>;
    const project = normalizeProjectName(typeof instruction.project === "string" ? instruction.project : projectKey);
    const markdown = typeof instruction.markdown === "string" ? instruction.markdown : "";

    if (!markdown.trim()) {
      return [];
    }

    return [
      [
        project,
        {
          markdown,
          project,
          updatedAt: typeof instruction.updatedAt === "string" && instruction.updatedAt ? instruction.updatedAt : new Date().toISOString(),
        } satisfies PdfProjectInstruction,
      ] as const,
    ];
  });

  return Object.fromEntries(entries);
}

function normalizePdfLibraryRecord(value: unknown): PdfLibraryRecord | null {
  if (typeof value !== "object" || !value) {
    return null;
  }

  const record = value as Partial<PdfLibraryRecord>;
  const title = typeof record.title === "string" && record.title.trim() ? record.title.trim() : typeof record.fileName === "string" && record.fileName.trim() ? record.fileName.trim() : "";

  if (!title) {
    return null;
  }

  const id =
    typeof record.id === "string" && record.id.trim()
      ? record.id.trim()
      : `pdf-${hashStableText(`${title}:${record.createdAt ?? ""}:${record.sourceId ?? ""}`)}`;
  const now = new Date().toISOString();

  return {
    chatId: normalizeOptionalText(record.chatId),
    createdAt: typeof record.createdAt === "string" && record.createdAt ? record.createdAt : now,
    dataUrl: normalizePdfDataUrl(record.dataUrl),
    enabledAsContext: Boolean(record.enabledAsContext),
    fileName: typeof record.fileName === "string" && record.fileName.trim() ? record.fileName.trim() : title,
    guidanceMarkdown: typeof record.guidanceMarkdown === "string" ? record.guidanceMarkdown : undefined,
    id,
    messageId: normalizeOptionalText(record.messageId),
    mimeType: typeof record.mimeType === "string" && record.mimeType.trim() ? record.mimeType.trim() : "application/pdf",
    origin: normalizePdfOrigin(record.origin),
    project: normalizeProjectName(record.project),
    sizeBytes: normalizeNumber(record.sizeBytes, 0),
    sourceFormat: normalizePdfSourceFormat(record.sourceFormat),
    sourceId: normalizeOptionalText(record.sourceId),
    sourceText: typeof record.sourceText === "string" ? record.sourceText : undefined,
    title,
    updatedAt: typeof record.updatedAt === "string" && record.updatedAt ? record.updatedAt : now,
  };
}

function normalizePdfDataUrl(value: unknown) {
  return typeof value === "string" && value.startsWith("data:application/pdf") ? value : undefined;
}

function normalizePdfOrigin(value: unknown): PdfLibraryOrigin {
  return value === "ai" || value === "manual" || value === "upload" ? value : "manual";
}

function normalizePdfSourceFormat(value: unknown): PdfLibrarySourceFormat | undefined {
  return value === "markdown" || value === "text" ? value : undefined;
}

function hashStableText(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash.toString(36);
}

function normalizeThinkingSettings(value: unknown, options: { forceEnabled?: boolean } = {}): ThinkingSettings {
  const storedThinking = typeof value === "object" && value ? (value as Partial<ThinkingSettings>) : {};

  return {
    ...defaultProviderSettings.thinking,
    ...storedThinking,
    effort: normalizeReasoningEffort(storedThinking.effort),
    enabled: options.forceEnabled ? true : typeof storedThinking.enabled === "boolean" ? storedThinking.enabled : defaultProviderSettings.thinking.enabled,
  };
}

function normalizeWebSearchSettings(value: unknown): WebSearchSettings {
  const storedSettings = typeof value === "object" && value ? (value as Partial<WebSearchSettings>) : {};
  const maxResults = normalizeNumber(storedSettings.maxResults, defaultProviderSettings.webSearch.maxResults);

  return {
    brave: normalizeBraveSearchSettings(storedSettings.brave),
    enabled: typeof storedSettings.enabled === "boolean" ? storedSettings.enabled : defaultProviderSettings.webSearch.enabled,
    maxResults: Math.min(Math.max(Math.round(maxResults), 1), MAX_WEB_SEARCH_RESULTS),
    provider: normalizeWebSearchProvider(storedSettings.provider),
  };
}

function normalizeWebSearchProvider(value: unknown): WebSearchProvider {
  return value === "brave" || value === "duckduckgo" ? value : defaultProviderSettings.webSearch.provider;
}

function normalizeBraveSearchSettings(value: unknown) {
  const storedSettings = typeof value === "object" && value ? (value as Partial<WebSearchSettings["brave"]>) : {};

  return {
    apiKey: normalizeText(storedSettings.apiKey, DEFAULT_BRAVE_SEARCH_SETTINGS.apiKey),
    apiVersion: normalizeDateText(storedSettings.apiVersion),
    answersMaxCompletionTokens: normalizeIntegerRange(storedSettings.answersMaxCompletionTokens, DEFAULT_BRAVE_SEARCH_SETTINGS.answersMaxCompletionTokens, 128, 4000),
    answersModel: normalizeBraveAnswersModel(storedSettings.answersModel),
    cacheControlNoCache: normalizeBoolean(storedSettings.cacheControlNoCache, DEFAULT_BRAVE_SEARCH_SETTINGS.cacheControlNoCache),
    country: normalizeCountryCode(storedSettings.country, DEFAULT_BRAVE_SEARCH_SETTINGS.country),
    enableAnswers: normalizeBoolean(storedSettings.enableAnswers, DEFAULT_BRAVE_SEARCH_SETTINGS.enableAnswers),
    enableImageSearch: normalizeBoolean(storedSettings.enableImageSearch, DEFAULT_BRAVE_SEARCH_SETTINGS.enableImageSearch),
    enableNewsSearch: normalizeBoolean(storedSettings.enableNewsSearch, DEFAULT_BRAVE_SEARCH_SETTINGS.enableNewsSearch),
    enablePlaceSearch: normalizeBoolean(storedSettings.enablePlaceSearch, DEFAULT_BRAVE_SEARCH_SETTINGS.enablePlaceSearch),
    enableRichCallback: normalizeBoolean(storedSettings.enableRichCallback, DEFAULT_BRAVE_SEARCH_SETTINGS.enableRichCallback),
    enableSemanticRerank: normalizeBoolean(storedSettings.enableSemanticRerank, DEFAULT_BRAVE_SEARCH_SETTINGS.enableSemanticRerank),
    enableVideoSearch: normalizeBoolean(storedSettings.enableVideoSearch, DEFAULT_BRAVE_SEARCH_SETTINGS.enableVideoSearch),
    extraSnippets: normalizeBoolean(storedSettings.extraSnippets, DEFAULT_BRAVE_SEARCH_SETTINGS.extraSnippets),
    freshness: normalizeBraveFreshness(storedSettings.freshness),
    freshnessEndDate: normalizeDateText(storedSettings.freshnessEndDate),
    freshnessStartDate: normalizeDateText(storedSettings.freshnessStartDate),
    goggles: normalizeText(storedSettings.goggles, DEFAULT_BRAVE_SEARCH_SETTINGS.goggles),
    imageResultCount: normalizeIntegerRange(storedSettings.imageResultCount, DEFAULT_BRAVE_SEARCH_SETTINGS.imageResultCount, 1, 24),
    includeFetchMetadata: normalizeBoolean(storedSettings.includeFetchMetadata, DEFAULT_BRAVE_SEARCH_SETTINGS.includeFetchMetadata),
    locationCity: normalizeShortText(storedSettings.locationCity, DEFAULT_BRAVE_SEARCH_SETTINGS.locationCity, 80),
    locationCountry: normalizeOptionalCountryCode(storedSettings.locationCountry),
    locationLatitude: normalizeCoordinateText(storedSettings.locationLatitude, -90, 90),
    locationLongitude: normalizeCoordinateText(storedSettings.locationLongitude, -180, 180),
    locationPostalCode: normalizeShortText(storedSettings.locationPostalCode, DEFAULT_BRAVE_SEARCH_SETTINGS.locationPostalCode, 24),
    locationState: normalizeShortText(storedSettings.locationState, DEFAULT_BRAVE_SEARCH_SETTINGS.locationState, 3),
    locationStateName: normalizeShortText(storedSettings.locationStateName, DEFAULT_BRAVE_SEARCH_SETTINGS.locationStateName, 80),
    locationTimezone: normalizeTimezoneText(storedSettings.locationTimezone),
    newsResultCount: normalizeIntegerRange(storedSettings.newsResultCount, DEFAULT_BRAVE_SEARCH_SETTINGS.newsResultCount, 1, 24),
    offset: normalizeIntegerRange(storedSettings.offset, DEFAULT_BRAVE_SEARCH_SETTINGS.offset, 0, 9),
    operators: normalizeBoolean(storedSettings.operators, DEFAULT_BRAVE_SEARCH_SETTINGS.operators),
    placeLocation: normalizeShortText(storedSettings.placeLocation, DEFAULT_BRAVE_SEARCH_SETTINGS.placeLocation, 120),
    placeRadiusMeters: normalizeIntegerRange(storedSettings.placeRadiusMeters, DEFAULT_BRAVE_SEARCH_SETTINGS.placeRadiusMeters, 1, 50000),
    placeResultCount: normalizeIntegerRange(storedSettings.placeResultCount, DEFAULT_BRAVE_SEARCH_SETTINGS.placeResultCount, 1, 24),
    requestMethod: normalizeBraveRequestMethod(storedSettings.requestMethod),
    resultFilter: normalizeBraveResultFilter(storedSettings.resultFilter),
    safesearch: normalizeBraveSafeSearch(storedSettings.safesearch),
    searchLang: normalizeLanguageCode(storedSettings.searchLang, DEFAULT_BRAVE_SEARCH_SETTINGS.searchLang),
    showImageResults: normalizeBoolean(storedSettings.showImageResults, DEFAULT_BRAVE_SEARCH_SETTINGS.showImageResults),
    spellcheck: normalizeBoolean(storedSettings.spellcheck, DEFAULT_BRAVE_SEARCH_SETTINGS.spellcheck),
    summary: normalizeBoolean(storedSettings.summary, DEFAULT_BRAVE_SEARCH_SETTINGS.summary),
    textDecorations: normalizeBoolean(storedSettings.textDecorations, DEFAULT_BRAVE_SEARCH_SETTINGS.textDecorations),
    uiLang: normalizeUiLanguageCode(storedSettings.uiLang, DEFAULT_BRAVE_SEARCH_SETTINGS.uiLang),
    units: normalizeBraveUnits(storedSettings.units),
    videoResultCount: normalizeIntegerRange(storedSettings.videoResultCount, DEFAULT_BRAVE_SEARCH_SETTINGS.videoResultCount, 1, 24),
  };
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeCountryCode(value: unknown, fallback: string) {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);
  return normalized.length === 2 ? normalized : fallback;
}

function normalizeOptionalCountryCode(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  const normalized = value.trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);
  return normalized.length === 2 ? normalized : "";
}

function normalizeLanguageCode(value: unknown, fallback: string) {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase().replace(/[^a-z-]/g, "").slice(0, 8);
  return normalized.length >= 2 ? normalized : fallback;
}

function normalizeUiLanguageCode(value: unknown, fallback: string) {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().replace(/[^a-zA-Z-]/g, "").slice(0, 12);
  return normalized.length >= 2 ? normalized : fallback;
}

function normalizeDateText(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  const normalized = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
}

function normalizeIntegerRange(value: unknown, fallback: number, min: number, max: number) {
  const normalized = normalizeNumber(value, fallback);
  return Math.min(Math.max(Math.round(normalized), min), max);
}

function normalizeCoordinateText(value: unknown, min: number, max: number) {
  if (typeof value !== "string" && typeof value !== "number") {
    return "";
  }

  const rawValue = String(value).trim();
  const parsed = Number.parseFloat(rawValue);

  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    return "";
  }

  return rawValue.replace(/[^0-9.+-]/g, "").slice(0, 16);
}

function normalizeShortText(value: unknown, fallback: string, maxLength: number) {
  if (typeof value !== "string") {
    return fallback;
  }

  return value.replace(/[\r\n\t]/g, " ").trim().slice(0, maxLength);
}

function normalizeTimezoneText(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().replace(/[^a-zA-Z0-9_+\-/]/g, "").slice(0, 64);
}

function normalizeBraveFreshness(value: unknown): BraveSearchFreshness {
  return value === "any" || value === "custom" || value === "pd" || value === "pw" || value === "pm" || value === "py" ? value : DEFAULT_BRAVE_SEARCH_SETTINGS.freshness;
}

function normalizeBraveSafeSearch(value: unknown): BraveSearchSafeSearch {
  return value === "off" || value === "moderate" || value === "strict" ? value : DEFAULT_BRAVE_SEARCH_SETTINGS.safesearch;
}

function normalizeBraveUnits(value: unknown): BraveSearchUnits {
  return value === "imperial" || value === "metric" ? value : DEFAULT_BRAVE_SEARCH_SETTINGS.units;
}

function normalizeBraveRequestMethod(value: unknown): BraveSearchRequestMethod {
  return value === "post" || value === "get" ? value : DEFAULT_BRAVE_SEARCH_SETTINGS.requestMethod;
}

function normalizeBraveAnswersModel(value: unknown): BraveAnswersModel {
  return value === "brave-pro" || value === "brave" ? value : DEFAULT_BRAVE_SEARCH_SETTINGS.answersModel;
}

function normalizeBraveResultFilter(value: unknown): BraveSearchResultFilter[] {
  if (!Array.isArray(value)) {
    return DEFAULT_BRAVE_SEARCH_SETTINGS.resultFilter;
  }

  const filters = new Set<BraveSearchResultFilter>();

  for (const item of value) {
    if (isBraveResultFilter(item)) {
      filters.add(item);
    }
  }

  return [...filters];
}

function isBraveResultFilter(value: unknown): value is BraveSearchResultFilter {
  return value === "discussions" || value === "faq" || value === "infobox" || value === "locations" || value === "news" || value === "query" || value === "summarizer" || value === "videos" || value === "web";
}

function normalizeSubscriptionOptimizationSettings(value: unknown): SubscriptionOptimizationSettings {
  const storedSettings = typeof value === "object" && value ? (value as Partial<SubscriptionOptimizationSettings>) : {};

  return {
    codexContextWindow: normalizeSubscriptionCodexContextWindow(storedSettings.codexContextWindow),
    fallbackMode: normalizeSubscriptionFallbackMode(storedSettings.fallbackMode),
    tokenSaverLevel: normalizeSubscriptionTokenSaverLevel(storedSettings.tokenSaverLevel),
  };
}

function normalizeSubscriptionCodexContextWindow(value: unknown): SubscriptionCodexContextWindow {
  return value === "extended" || value === "1m" || value === "full" ? "extended" : defaultProviderSettings.subscriptionOptimization.codexContextWindow;
}

function normalizeSubscriptionFallbackMode(value: unknown): SubscriptionFallbackMode {
  if (value === "smart-saver" || value === "auto-free" || value === "free") {
    return "always-free";
  }

  if (value === "always-free" || value === "off") {
    return value;
  }

  return defaultProviderSettings.subscriptionOptimization.fallbackMode;
}

function normalizeSubscriptionTokenSaverLevel(value: unknown): SubscriptionTokenSaverLevel {
  if (value === "off" || value === "low" || value === "medium" || value === "high" || value === "max") {
    return value;
  }

  if (value === "maximum") {
    return "max";
  }

  return defaultProviderSettings.subscriptionOptimization.tokenSaverLevel;
}

function normalizeWorkspaceDependencySettings(value: unknown) {
  const storedSettings = typeof value === "object" && value ? (value as Partial<ProviderSettings["workspaceDependencies"]>) : {};

  return {
    enabled: typeof storedSettings.enabled === "boolean" ? storedSettings.enabled : defaultProviderSettings.workspaceDependencies.enabled,
  };
}

function normalizeAppGeneralSettings(value: unknown): AppGeneralSettings {
  const storedSettings = typeof value === "object" && value ? (value as Partial<AppGeneralSettings>) : {};
  const storedDictation =
    typeof storedSettings.dictation === "object" && storedSettings.dictation
      ? (storedSettings.dictation as Partial<AppGeneralSettings["dictation"]>)
      : {};
  const storedNotifications =
    typeof storedSettings.notifications === "object" && storedSettings.notifications
      ? (storedSettings.notifications as Partial<AppGeneralSettings["notifications"]>)
      : {};

  return {
    agentEnvironment: normalizeAppAgentEnvironment(storedSettings.agentEnvironment),
    codeReviewBehavior: normalizeAppCodeReviewBehavior(storedSettings.codeReviewBehavior),
    defaultOpenTarget: normalizeProjectOpenTargetId(storedSettings.defaultOpenTarget),
    defaultProjectlessChat:
      typeof storedSettings.defaultProjectlessChat === "boolean"
        ? storedSettings.defaultProjectlessChat
        : defaultAppGeneralSettings.defaultProjectlessChat,
    dictation: {
      dictionary: normalizeBoundedText(storedDictation.dictionary, defaultAppGeneralSettings.dictation.dictionary, 4000),
      holdHotkey: normalizeBoundedText(storedDictation.holdHotkey, defaultAppGeneralSettings.dictation.holdHotkey, 80),
      toggleHotkey: normalizeBoundedText(storedDictation.toggleHotkey, defaultAppGeneralSettings.dictation.toggleHotkey, 80),
    },
    followUpBehavior: normalizeAppFollowUpBehavior(storedSettings.followUpBehavior),
    inferenceSpeed: normalizeAppInferenceSpeed(storedSettings.inferenceSpeed),
    language: normalizeAppLanguageMode(storedSettings.language),
    notifications: {
      permissionNotifications:
        typeof storedNotifications.permissionNotifications === "boolean"
          ? storedNotifications.permissionNotifications
          : defaultAppGeneralSettings.notifications.permissionNotifications,
      questionNotifications:
        typeof storedNotifications.questionNotifications === "boolean"
          ? storedNotifications.questionNotifications
          : defaultAppGeneralSettings.notifications.questionNotifications,
      turnCompletion: normalizeAppTurnCompletionNotificationMode(storedNotifications.turnCompletion),
    },
    popoutWindowHotkey: normalizeBoundedText(storedSettings.popoutWindowHotkey, defaultAppGeneralSettings.popoutWindowHotkey, 80),
    requireCtrlEnterForLongPrompts:
      typeof storedSettings.requireCtrlEnterForLongPrompts === "boolean"
        ? storedSettings.requireCtrlEnterForLongPrompts
        : defaultAppGeneralSettings.requireCtrlEnterForLongPrompts,
    terminalShell: isTerminalShellId(storedSettings.terminalShell) ? storedSettings.terminalShell : defaultAppGeneralSettings.terminalShell,
  };
}

function normalizeAppWorkMode(value: unknown): AppWorkMode {
  return value === "everyday" ? "everyday" : "coding";
}

function normalizeAppAgentEnvironment(value: unknown): AppAgentEnvironment {
  if (value === "windows-native" || value === "wsl" || value === "auto") {
    return value;
  }

  return defaultAppGeneralSettings.agentEnvironment;
}

function normalizeAppLanguageMode(value: unknown): AppLanguageMode {
  return value === "auto" ? "auto" : defaultAppGeneralSettings.language;
}

function normalizeAppInferenceSpeed(value: unknown): AppInferenceSpeed {
  return value === "fast" ? "fast" : defaultAppGeneralSettings.inferenceSpeed;
}

function normalizeAppFollowUpBehavior(value: unknown): AppFollowUpBehavior {
  return value === "steer" ? "steer" : defaultAppGeneralSettings.followUpBehavior;
}

function normalizeAppCodeReviewBehavior(value: unknown): AppCodeReviewBehavior {
  return value === "detached" ? "detached" : defaultAppGeneralSettings.codeReviewBehavior;
}

function normalizeAppTurnCompletionNotificationMode(value: unknown): AppTurnCompletionNotificationMode {
  if (value === "off" || value === "unfocused") {
    return value;
  }

  if (value === "always") {
    return "unfocused";
  }

  return defaultAppGeneralSettings.notifications.turnCompletion;
}

function normalizeProjectOpenTargetId(value: unknown): ProjectOpenTargetId {
  return PROJECT_OPEN_TARGETS.some((target) => target.id === value) ? (value as ProjectOpenTargetId) : defaultAppGeneralSettings.defaultOpenTarget;
}

function normalizeBoundedText(value: unknown, fallback: string, maxLength: number) {
  if (typeof value !== "string") {
    return fallback;
  }

  return value.slice(0, maxLength);
}

function normalizeAppPersonalizationSettings(value: unknown): AppPersonalizationSettings {
  const storedSettings = typeof value === "object" && value ? (value as Partial<AppPersonalizationSettings>) : {};

  return {
    locationServicesEnabled:
      typeof storedSettings.locationServicesEnabled === "boolean"
        ? storedSettings.locationServicesEnabled
        : defaultAppPersonalizationSettings.locationServicesEnabled,
  };
}

function normalizeReasoningEffort(value: unknown): ReasoningEffort {
  if (value === "minimal") {
    return "low";
  }

  if (value === "xhigh") {
    return "high";
  }

  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }

  return defaultProviderSettings.thinking.effort;
}

function normalizeLocalWorkspaceSettings(value: unknown): LocalWorkspaceSettings {
  const storedSettings = typeof value === "object" && value ? (value as Partial<LocalWorkspaceSettings>) : {};
  const roots = Array.isArray(storedSettings.roots)
    ? storedSettings.roots.filter((root): root is string => typeof root === "string" && Boolean(root.trim()))
    : [];

  return {
    enabled: typeof storedSettings.enabled === "boolean" ? storedSettings.enabled : false,
    indexReason: typeof storedSettings.indexReason === "string" ? storedSettings.indexReason : undefined,
    indexSummary: storedSettings.indexSummary,
    indexStatus: normalizeLocalWorkspaceIndexStatus(storedSettings.indexStatus),
    indexUpdatedAt: typeof storedSettings.indexUpdatedAt === "string" ? storedSettings.indexUpdatedAt : undefined,
    lastError: typeof storedSettings.lastError === "string" ? storedSettings.lastError : undefined,
    permissionMode: normalizeLocalPermissionMode(storedSettings.permissionMode),
    roots,
    scope: normalizeLocalWorkspaceScope(storedSettings.scope),
  };
}

function normalizeLocalWorkspaceIndexStatus(value: unknown): LocalWorkspaceIndexStatus {
  return value === "error" ? "error" : "idle";
}

function normalizeLocalPermissionMode(value: unknown): LocalPermissionMode {
  return normalizeToolBridgePermissionMode(value);
}

function normalizeLocalWorkspaceScope(value: unknown): LocalWorkspaceScope {
  if (value === "current-folder" || value === "selected-folder" || value === "full-computer") {
    return value;
  }

  return "current-folder";
}
