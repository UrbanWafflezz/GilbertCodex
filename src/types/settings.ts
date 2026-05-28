import type { ToolRegistrySettings } from "./tools";
import type { ProjectOpenTargetId } from "./projectOpen";
import type { TerminalShellId } from "./terminal";

export type ReasoningEffort = "low" | "medium" | "high";
export type AppearanceMode = "system" | "dark" | "light";
export type AppearanceMotionPreference = "system" | "on" | "off";
export type AppWorkMode = "coding" | "everyday";
export type AppAgentEnvironment = "auto" | "windows-native" | "wsl";
export type AppLanguageMode = "auto";
export type AppInferenceSpeed = "standard" | "fast";
export type AppFollowUpBehavior = "queue" | "steer";
export type AppCodeReviewBehavior = "inline" | "detached";
export type AppTurnCompletionNotificationMode = "off" | "unfocused";
export type AppThemeVisualEffect =
  | "none"
  | "aurora"
  | "circuit"
  | "confetti"
  | "constellation"
  | "dawn"
  | "embers"
  | "matrix"
  | "neon"
  | "ocean"
  | "prism"
  | "scanlines"
  | "spotlight";
export type ModelProviderId = "9router" | "anthropic" | "deepseek" | "google" | "groq" | "lmstudio" | "mistral" | "ollama" | "openai" | "openrouter" | "vllm" | "xai";
export type ProviderContextWindowMap = Partial<Record<ModelProviderId, number>>;
export interface ProviderModelBudgetOverride {
  contextWindowTokens?: number;
  maxOutputTokens?: number;
}
export type ProviderModelBudgetOverrideMap = Partial<Record<ModelProviderId, Record<string, ProviderModelBudgetOverride>>>;
export type ProviderModelVisibilityMap = Partial<Record<ModelProviderId, string[]>>;
export type ProviderSecretMap = Partial<Record<ModelProviderId, string>>;
export type SubscriptionCodexContextWindow = "standard" | "extended";
export type SubscriptionFallbackMode = "off" | "smart-saver" | "always-free";
export type SubscriptionTokenSaverLevel = "off" | "low" | "medium" | "high" | "max";

export interface SubscriptionOptimizationSettings {
  codexContextWindow: SubscriptionCodexContextWindow;
  fallbackMode: SubscriptionFallbackMode;
  tokenSaverLevel: SubscriptionTokenSaverLevel;
}

export interface ThinkingSettings {
  effort: ReasoningEffort;
  enabled: boolean;
}

export function formatReasoningEffort(effort: ReasoningEffort | string) {
  if (effort === "xhigh") {
    return "Heavy";
  }

  if (effort === "minimal") {
    return "Light";
  }

  if (effort === "low") {
    return "Light";
  }

  if (effort === "medium") {
    return "Standard";
  }

  if (effort === "high") {
    return "Extended";
  }

  return effort.charAt(0).toUpperCase() + effort.slice(1);
}

export type WebSearchProvider = "brave" | "duckduckgo";
export type BraveSearchSafeSearch = "moderate" | "off" | "strict";
export type BraveSearchFreshness = "any" | "custom" | "pd" | "pm" | "pw" | "py";
export type BraveSearchResultFilter = "discussions" | "faq" | "infobox" | "locations" | "news" | "query" | "summarizer" | "videos" | "web";
export type BraveSearchRequestMethod = "get" | "post";
export type BraveSearchUnits = "imperial" | "metric";
export type BraveAnswersModel = "brave" | "brave-pro";

export const WEB_SEARCH_PROVIDER_LABELS: Record<WebSearchProvider, string> = {
  brave: "Brave Search",
  duckduckgo: "DuckDuckGo",
};

export interface BraveSearchSettings {
  apiKey: string;
  apiVersion: string;
  answersMaxCompletionTokens: number;
  answersModel: BraveAnswersModel;
  cacheControlNoCache: boolean;
  country: string;
  enableAnswers: boolean;
  enableImageSearch: boolean;
  enableNewsSearch: boolean;
  enablePlaceSearch: boolean;
  enableRichCallback: boolean;
  enableSemanticRerank: boolean;
  enableVideoSearch: boolean;
  extraSnippets: boolean;
  freshness: BraveSearchFreshness;
  freshnessEndDate: string;
  freshnessStartDate: string;
  goggles: string;
  imageResultCount: number;
  includeFetchMetadata: boolean;
  locationCity: string;
  locationCountry: string;
  locationLatitude: string;
  locationLongitude: string;
  locationPostalCode: string;
  locationState: string;
  locationStateName: string;
  locationTimezone: string;
  newsResultCount: number;
  offset: number;
  operators: boolean;
  placeLocation: string;
  placeRadiusMeters: number;
  placeResultCount: number;
  requestMethod: BraveSearchRequestMethod;
  resultFilter: BraveSearchResultFilter[];
  safesearch: BraveSearchSafeSearch;
  searchLang: string;
  showImageResults: boolean;
  spellcheck: boolean;
  summary: boolean;
  textDecorations: boolean;
  uiLang: string;
  units: BraveSearchUnits;
  videoResultCount: number;
}

export const DEFAULT_BRAVE_SEARCH_SETTINGS: BraveSearchSettings = {
  apiKey: "",
  apiVersion: "",
  answersMaxCompletionTokens: 700,
  answersModel: "brave",
  cacheControlNoCache: false,
  country: "US",
  enableAnswers: false,
  enableImageSearch: false,
  enableNewsSearch: false,
  enablePlaceSearch: false,
  enableRichCallback: false,
  enableSemanticRerank: true,
  enableVideoSearch: false,
  extraSnippets: true,
  freshness: "any",
  freshnessEndDate: "",
  freshnessStartDate: "",
  goggles: "",
  imageResultCount: 6,
  includeFetchMetadata: false,
  locationCity: "",
  locationCountry: "",
  locationLatitude: "",
  locationLongitude: "",
  locationPostalCode: "",
  locationState: "",
  locationStateName: "",
  locationTimezone: "",
  newsResultCount: 6,
  offset: 0,
  operators: true,
  placeLocation: "",
  placeRadiusMeters: 2500,
  placeResultCount: 6,
  requestMethod: "get",
  resultFilter: [],
  safesearch: "moderate",
  searchLang: "en",
  showImageResults: true,
  spellcheck: true,
  summary: false,
  textDecorations: false,
  uiLang: "en-US",
  units: "imperial",
  videoResultCount: 4,
};

export interface WebSearchSettings {
  brave: BraveSearchSettings;
  enabled: boolean;
  maxResults: number;
  provider: WebSearchProvider;
}

export interface AppPersonalizationSettings {
  locationServicesEnabled: boolean;
}

export interface AppDictationSettings {
  dictionary: string;
  holdHotkey: string;
  toggleHotkey: string;
}

export interface AppNotificationSettings {
  permissionNotifications: boolean;
  questionNotifications: boolean;
  turnCompletion: AppTurnCompletionNotificationMode;
}

export interface AppGeneralSettings {
  agentEnvironment: AppAgentEnvironment;
  codeReviewBehavior: AppCodeReviewBehavior;
  defaultOpenTarget: ProjectOpenTargetId;
  defaultProjectlessChat: boolean;
  dictation: AppDictationSettings;
  followUpBehavior: AppFollowUpBehavior;
  inferenceSpeed: AppInferenceSpeed;
  language: AppLanguageMode;
  popoutWindowHotkey: string;
  requireCtrlEnterForLongPrompts: boolean;
  terminalShell: TerminalShellId;
  notifications: AppNotificationSettings;
}

export interface AppThemeComponentColors {
  appBackground: string;
  appsAccent: string;
  appsAccentSoft: string;
  appsBackground: string;
  appsBackgroundGlow: string;
  appsBorder: string;
  appsControl: string;
  appsControlHover: string;
  appsDanger: string;
  appsInstalled: string;
  appsPanel: string;
  appsPanelRaised: string;
  appsPrimaryText: string;
  appsSuccess: string;
  appsWarning: string;
  border: string;
  borderSoft: string;
  chrome: string;
  chromeBorder: string;
  composer: string;
  composerAlt: string;
  composerBorder: string;
  composerControl: string;
  composerControlHover: string;
  composerFocus: string;
  composerMuted: string;
  cyan: string;
  danger: string;
  field: string;
  fieldBorder: string;
  pageBackground: string;
  pageBackgroundAlt: string;
  panel: string;
  popover: string;
  popoverBorder: string;
  rose: string;
  sidebar: string;
  sidebarActive: string;
  sidebarBorder: string;
  sidebarHover: string;
  sidebarWarm: string;
  success: string;
  surface: string;
  surfaceRaised: string;
  surfaceSoft: string;
  terminalAccent: string;
  terminalBorder: string;
  terminalCommand: string;
  terminalControl: string;
  terminalControlHover: string;
  terminalCursor: string;
  terminalError: string;
  terminalMuted: string;
  terminalOutput: string;
  terminalPanel: string;
  terminalRail: string;
  terminalSelection: string;
  terminalText: string;
  terminalToolbar: string;
  textDim: string;
  textMuted: string;
  violet: string;
  warning: string;
}

export interface AppThemeSettings {
  accent: string;
  background: string;
  codeFont: string;
  componentColors: AppThemeComponentColors;
  contrast: number;
  foreground: string;
  translucentSidebar: boolean;
  uiFont: string;
  visualEffect: AppThemeVisualEffect;
}

export interface AppAppearanceSettings {
  chatResponseWidth: number;
  composerWidth: number;
  codeFontSize: number;
  dark: AppThemeSettings;
  light: AppThemeSettings;
  reduceMotion: AppearanceMotionPreference;
  userMessageWidth: number;
  uiFontSize: number;
  usePointerCursor: boolean;
}

export interface ProviderSettings {
  apiKeys: ProviderSecretMap;
  baseUrls: ProviderSecretMap;
  billingPlan: BillingPlanSettings;
  contextWindowTokens: ProviderContextWindowMap;
  disabledModels: ProviderModelVisibilityMap;
  maxTokens: number;
  model: string;
  modelBudgetOverrides?: ProviderModelBudgetOverrideMap;
  openRouterApiKey: string;
  provider: ModelProviderId;
  providerModels: ProviderSecretMap;
  subscriptionOptimization: SubscriptionOptimizationSettings;
  systemPrompt: string;
  thinking: ThinkingSettings;
  temperature: number;
  topK: number;
  topP: number;
  tools: ToolRegistrySettings;
  userInstructions: string;
  webSearch: WebSearchSettings;
  agentEnvironment?: AppAgentEnvironment;
  workMode?: AppWorkMode;
  workspaceDependencies: WorkspaceDependencySettings;
}

export type BillingTierId = "free" | "plus" | "pro" | "teams";
export type BillingPlanStatus = "active" | "canceled" | "incomplete" | "none" | "past_due" | "trialing";
export type BillingPlanSource = "admin" | "firebase" | "local-preview" | "stripe";

export interface BillingPlanSettings {
  checkoutUrls?: Partial<Record<Exclude<BillingTierId, "free" | "teams">, string>>;
  currentPeriodEnd?: string;
  customerPortalUrl?: string;
  source: BillingPlanSource;
  status: BillingPlanStatus;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  tier: BillingTierId;
  updatedAt?: string;
}

export interface WorkspaceDependencySettings {
  enabled: boolean;
}
