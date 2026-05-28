import type { ModelProviderId, ProviderModelVisibilityMap, ProviderSecretMap, SubscriptionCodexContextWindow, SubscriptionOptimizationSettings } from "../types/settings";
import { getConfiguredNineRouterBaseUrl, isConfiguredNineRouterCloudEnabled, isNineRouterNativeBridgeUrl } from "../services/nineRouterCloud";

export const OPENROUTER_FREE_AUTO_MODEL = "openrouter/free";
export const OPENROUTER_AUTO_MODEL = "openrouter/auto";
export const DEFAULT_CHAT_MODEL = OPENROUTER_FREE_AUTO_MODEL;
export const DEEPSEEK_V4_FLASH_FREE_MODEL = "deepseek/deepseek-v4-flash:free";
export const GPT_OSS_120B_FREE_MODEL = "openai/gpt-oss-120b:free";
export const GPT_OSS_20B_FREE_MODEL = "openai/gpt-oss-20b:free";
export const MINIMAX_M25_FREE_MODEL = "minimax/minimax-m2.5:free";
export const QWEN3_CODER_FREE_MODEL = "qwen/qwen3-coder:free";
export const NEMOTRON_3_NANO_OMNI_MODEL = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free";
export const IMAGE_REASONING_MODEL = NEMOTRON_3_NANO_OMNI_MODEL;
export const GEMMA_4_31B_FREE_MODEL = "google/gemma-4-31b-it:free";
export const QWEN3_NEXT_80B_FREE_MODEL = "qwen/qwen3-next-80b-a3b-instruct:free";
export const LLAMA_33_70B_FREE_MODEL = "meta-llama/llama-3.3-70b-instruct:free";
export const TRINITY_LARGE_THINKING_FREE_MODEL = "arcee-ai/trinity-large-thinking:free";
export const OWL_ALPHA_MODEL = "openrouter/owl-alpha";
export const NEMOTRON_3_SUPER_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";
export const GLM_45_AIR_FREE_MODEL = "z-ai/glm-4.5-air:free";
export const LAGUNA_M1_FREE_MODEL = "poolside/laguna-m.1:free";
export const LING_26_FLASH_MODEL = "inclusionai/ling-2.6-flash";
const LEGACY_LING_26_FLASH_FREE_MODEL = "inclusionai/ling-2.6-flash:free";
export const OPENROUTER_CURATED_FREE_MODELS = [
  OPENROUTER_FREE_AUTO_MODEL,
  LAGUNA_M1_FREE_MODEL,
  OWL_ALPHA_MODEL,
  NEMOTRON_3_SUPER_MODEL,
  DEEPSEEK_V4_FLASH_FREE_MODEL,
  MINIMAX_M25_FREE_MODEL,
  GLM_45_AIR_FREE_MODEL,
  GPT_OSS_120B_FREE_MODEL,
  TRINITY_LARGE_THINKING_FREE_MODEL,
] as const;
export const OPENROUTER_SPEED_OPTIMIZED_FREE_MODELS = [
  LAGUNA_M1_FREE_MODEL,
  NEMOTRON_3_SUPER_MODEL,
  MINIMAX_M25_FREE_MODEL,
] as const;
const OPENROUTER_CURATED_FREE_MODEL_SET = new Set<string>(OPENROUTER_CURATED_FREE_MODELS);
const RETIRED_OPENROUTER_FREE_MODELS = new Set<string>([
  "baidu/cobuddy:free",
  GEMMA_4_31B_FREE_MODEL,
  GPT_OSS_20B_FREE_MODEL,
  "inclusionai/ring-2.6-1t:free",
  LLAMA_33_70B_FREE_MODEL,
  "poolside/laguna-xs.2:free",
  QWEN3_CODER_FREE_MODEL,
  QWEN3_NEXT_80B_FREE_MODEL,
]);
export const DEFAULT_PROVIDER_ID: ModelProviderId = "openrouter";
const MODEL_PROVIDER_IDS: ModelProviderId[] = ["openrouter", "9router", "anthropic", "deepseek", "google", "groq", "lmstudio", "mistral", "ollama", "openai", "vllm", "xai"];
export const NINE_ROUTER_CODEX_MODEL_IDS = [
  "cx/gpt-5.5",
  "cx/gpt-5.4",
  "cx/gpt-5.3-codex",
  "cx/gpt-5.3-codex-xhigh",
  "cx/gpt-5.3-codex-high",
  "cx/gpt-5.3-codex-low",
  "cx/gpt-5.3-codex-none",
  "cx/gpt-5.3-codex-spark",
] as const;
const NINE_ROUTER_CODEX_MODEL_ID_SET = new Set<string>(NINE_ROUTER_CODEX_MODEL_IDS);
export const NINE_ROUTER_CODEX_STANDARD_CONTEXT_TOKENS = 262_144;
export const NINE_ROUTER_CODEX_EXTENDED_CONTEXT_TOKENS = 1_000_000;
export const NINE_ROUTER_SMART_SAVER_MODEL = "gilbert-smart-saver";
export const NINE_ROUTER_ALWAYS_FREE_MODEL = "gilbert-always-free";
export const NINE_ROUTER_OPEN_CODE_FREE_MODEL_IDS = [
  "oc/deepseek-v4-flash-free",
  "oc/minimax-m2.5-free",
  "oc/qwen3.6-plus-free",
  "oc/mimo-v2.5-free",
  "oc/nemotron-3-super-free",
  "oc/big-pickle",
] as const;
export const NINE_ROUTER_GITHUB_COPILOT_MODEL_IDS = [
  "gh/gpt-5-mini",
  "gh/gpt-4.1",
  "gh/gpt-4o",
  "gh/claude-haiku-4.5",
] as const;
export const NINE_ROUTER_CLAUDE_CODE_MODEL_IDS = [
  "cc/claude-opus-4-7",
  "cc/claude-opus-4-6",
  "cc/claude-sonnet-4-6",
  "cc/claude-haiku-4-5-20251001",
] as const;
export const NINE_ROUTER_GEMINI_CLI_MODEL_IDS = [
  "gc/gemini-3-flash-preview",
  "gc/gemini-3-pro-preview",
] as const;
export const NINE_ROUTER_ANTIGRAVITY_MODEL_IDS = [
  "ag/gemini-3-flash",
  "ag/gemini-pro-agent",
  "ag/claude-sonnet-4-6",
] as const;
export const NINE_ROUTER_KIRO_MODEL_IDS = [
  "kr/claude-sonnet-4.5",
  "kr/claude-haiku-4.5",
  "kr/deepseek-3.2",
] as const;
export const NINE_ROUTER_KILO_CODE_MODEL_IDS = [
  "kc/anthropic/claude-sonnet-4-20250514",
  "kc/google/gemini-2.5-pro",
  "kc/openai/gpt-4.1",
] as const;
export const NINE_ROUTER_CLINE_MODEL_IDS = [
  "cl/anthropic/claude-opus-4.7",
  "cl/anthropic/claude-sonnet-4.6",
  "cl/openai/gpt-5.3-codex",
] as const;
export const NINE_ROUTER_QWEN_CODE_MODEL_IDS = [
  "qw/qwen3-coder-plus",
  "qw/qwen3-coder-flash",
  "qw/coder-model",
] as const;
export const NINE_ROUTER_IFLOW_MODEL_IDS = [
  "if/qwen3-coder-plus",
  "if/qwen3-max",
  "if/kimi-k2",
] as const;
export const NINE_ROUTER_KIMI_CODING_MODEL_IDS = [
  "kmc/kimi-k2.6",
  "kmc/kimi-k2.5",
  "kmc/kimi-latest",
] as const;
const NINE_ROUTER_GITHUB_COPILOT_MODEL_ID_SET = new Set<string>(NINE_ROUTER_GITHUB_COPILOT_MODEL_IDS);
export const NINE_ROUTER_GITHUB_COPILOT_FALLBACK_MODEL = "gh/gpt-5-mini";
const NINE_ROUTER_GITHUB_COPILOT_MODEL_ALIASES: Record<string, string> = {
  "gh/claude-haiku": "gh/claude-haiku-4.5",
  "gh/gpt-5": "gh/gpt-5-mini",
  "gh/gpt-5-mini-latest": "gh/gpt-5-mini",
};
const NINE_ROUTER_RETIRED_GITHUB_COPILOT_MODEL_REPLACEMENTS: Record<string, string> = {
  "gh/claude-opus-4.5": "gh/claude-haiku-4.5",
  "gh/claude-opus-4.6": "gh/claude-haiku-4.5",
  "gh/claude-opus-4.7": "gh/claude-haiku-4.5",
  "gh/claude-sonnet-4": "gh/claude-haiku-4.5",
  "gh/claude-sonnet-4.5": "gh/claude-haiku-4.5",
  "gh/claude-sonnet-4.6": "gh/claude-haiku-4.5",
  "gh/gemini-2.5-pro": NINE_ROUTER_GITHUB_COPILOT_FALLBACK_MODEL,
  "gh/gemini-3-flash": NINE_ROUTER_GITHUB_COPILOT_FALLBACK_MODEL,
  "gh/gemini-3-flash-preview": NINE_ROUTER_GITHUB_COPILOT_FALLBACK_MODEL,
  "gh/gemini-3-pro": NINE_ROUTER_GITHUB_COPILOT_FALLBACK_MODEL,
  "gh/gemini-3-pro-preview": NINE_ROUTER_GITHUB_COPILOT_FALLBACK_MODEL,
  "gh/gemini-3.1-pro-preview": NINE_ROUTER_GITHUB_COPILOT_FALLBACK_MODEL,
  "gh/gpt-3.5-turbo": NINE_ROUTER_GITHUB_COPILOT_FALLBACK_MODEL,
  "gh/gpt-4": NINE_ROUTER_GITHUB_COPILOT_FALLBACK_MODEL,
  "gh/gpt-4o-mini": NINE_ROUTER_GITHUB_COPILOT_FALLBACK_MODEL,
  "gh/gpt-5-codex": NINE_ROUTER_GITHUB_COPILOT_FALLBACK_MODEL,
  "gh/gpt-5.1": NINE_ROUTER_GITHUB_COPILOT_FALLBACK_MODEL,
  "gh/gpt-5.1-codex": NINE_ROUTER_GITHUB_COPILOT_FALLBACK_MODEL,
  "gh/gpt-5.1-codex-max": NINE_ROUTER_GITHUB_COPILOT_FALLBACK_MODEL,
  "gh/gpt-5.1-codex-mini": NINE_ROUTER_GITHUB_COPILOT_FALLBACK_MODEL,
  "gh/gpt-5.2": NINE_ROUTER_GITHUB_COPILOT_FALLBACK_MODEL,
  "gh/gpt-5.2-codex": NINE_ROUTER_GITHUB_COPILOT_FALLBACK_MODEL,
  "gh/gpt-5.3-codex": NINE_ROUTER_GITHUB_COPILOT_FALLBACK_MODEL,
  "gh/gpt-5.4": NINE_ROUTER_GITHUB_COPILOT_FALLBACK_MODEL,
  "gh/gpt-5.4-mini": NINE_ROUTER_GITHUB_COPILOT_FALLBACK_MODEL,
  "gh/gpt-5.4-nano": NINE_ROUTER_GITHUB_COPILOT_FALLBACK_MODEL,
  "gh/grok-code-fast-1": NINE_ROUTER_GITHUB_COPILOT_FALLBACK_MODEL,
  "gh/goldeneye": NINE_ROUTER_GITHUB_COPILOT_FALLBACK_MODEL,
  "gh/goldeneye-free-auto": NINE_ROUTER_GITHUB_COPILOT_FALLBACK_MODEL,
  "gh/oswe-vscode-prime": NINE_ROUTER_GITHUB_COPILOT_FALLBACK_MODEL,
  "gh/raptor-mini": NINE_ROUTER_GITHUB_COPILOT_FALLBACK_MODEL,
};
const NINE_ROUTER_GITHUB_COPILOT_MODEL_PREFIXES = [
  "gh/",
  "github/",
  "github-copilot/",
  "github_copilot/",
] as const;
const NINE_ROUTER_MODEL_PRIORITY_ORDER = [
  NINE_ROUTER_ALWAYS_FREE_MODEL,
  ...NINE_ROUTER_CODEX_MODEL_IDS,
  ...NINE_ROUTER_CLAUDE_CODE_MODEL_IDS,
  ...NINE_ROUTER_GEMINI_CLI_MODEL_IDS,
  ...NINE_ROUTER_ANTIGRAVITY_MODEL_IDS,
  ...NINE_ROUTER_GITHUB_COPILOT_MODEL_IDS,
  ...NINE_ROUTER_KIRO_MODEL_IDS,
  ...NINE_ROUTER_KILO_CODE_MODEL_IDS,
  ...NINE_ROUTER_CLINE_MODEL_IDS,
  ...NINE_ROUTER_QWEN_CODE_MODEL_IDS,
  ...NINE_ROUTER_IFLOW_MODEL_IDS,
  ...NINE_ROUTER_KIMI_CODING_MODEL_IDS,
] as const;

type ModelProviderApiStyle = "anthropic-messages" | "openai-compatible";
type ProviderReasoningMode =
  | "anthropic-thinking"
  | "deepseek-thinking"
  | "google-thinking"
  | "groq-reasoning"
  | "local-responses"
  | "mistral-reasoning"
  | "none"
  | "openrouter"
  | "reasoning-effort"
  | "xai-reasoning";

export interface ModelProviderDefinition {
  apiKeyLabel: string;
  apiKeyPlaceholder: string;
  apiStyle: ModelProviderApiStyle;
  baseUrlLabel: string;
  baseUrlPlaceholder: string;
  defaultBaseUrl: string;
  defaultModel: string;
  detail: string;
  docsUrl: string;
  label: string;
  listModelsPath: string;
  optionalApiKey?: boolean;
  reasoningMode: ProviderReasoningMode;
  requiresApiKey: boolean;
}

export interface ModelRouteSourceInfo {
  chipLabel: string;
  groupId: string;
  groupLabel: string;
  searchTags: string[];
  sourceLabel: string;
}

export type ModelCatalogCategoryId =
  | "recommended"
  | "free"
  | "structured-output"
  | "coding"
  | "reasoning"
  | "fast"
  | "long-context"
  | "multimodal"
  | "general"
  | "local";

export interface ModelCatalogCategory {
  description: string;
  id: ModelCatalogCategoryId;
  label: string;
}

export interface ModelPricing {
  cacheWriteInputPerMillionTokens?: number;
  cachedInputPerMillionTokens?: number;
  imageInputUsd?: number;
  inputPerMillionTokens?: number;
  internalReasoningPerMillionTokens?: number;
  note?: string;
  outputPerMillionTokens?: number;
  requestUsd?: number;
  source?: "local" | "openrouter" | "provider";
  sourceLabel?: string;
  sourceUrl?: string;
  updatedAt?: string;
  webSearchUsd?: number;
}

export function formatModelPricingSummary(pricing: ModelPricing | undefined) {
  if (!pricing) {
    return "Price n/a";
  }

  const input = pricing.inputPerMillionTokens;
  const output = pricing.outputPerMillionTokens;

  if (input === 0 && output === 0) {
    return "Free";
  }

  if (typeof input === "number" && typeof output === "number") {
    return `${formatModelPricingUsd(input)} in / ${formatModelPricingUsd(output)} out`;
  }

  if (pricing.note) {
    return "Variable";
  }

  if (typeof input === "number") {
    return `${formatModelPricingUsd(input)} in`;
  }

  if (typeof output === "number") {
    return `${formatModelPricingUsd(output)} out`;
  }

  return "Price n/a";
}

export function formatModelPricingTitle(pricing: ModelPricing | undefined, separator = " / ") {
  if (!pricing) {
    return "No provider pricing metadata available for this model.";
  }

  return [
    pricing.sourceLabel || (pricing.source === "openrouter" ? "OpenRouter" : "Provider"),
    typeof pricing.inputPerMillionTokens === "number" ? `input ${formatModelPricingUsd(pricing.inputPerMillionTokens)} per 1M tokens` : "",
    typeof pricing.cacheWriteInputPerMillionTokens === "number" ? `cache write ${formatModelPricingUsd(pricing.cacheWriteInputPerMillionTokens)} per 1M tokens` : "",
    typeof pricing.cachedInputPerMillionTokens === "number" ? `cached input ${formatModelPricingUsd(pricing.cachedInputPerMillionTokens)} per 1M tokens` : "",
    typeof pricing.outputPerMillionTokens === "number" ? `output ${formatModelPricingUsd(pricing.outputPerMillionTokens)} per 1M tokens` : "",
    typeof pricing.webSearchUsd === "number" ? `web search ${formatModelPricingUsd(pricing.webSearchUsd)} per operation` : "",
    pricing.note || "",
  ].filter(Boolean).join(separator);
}

export function formatModelPricingUsd(value: number) {
  const maximumFractionDigits = value < 0.01 && value > 0 ? 6 : value < 1 ? 3 : 2;

  return `$${value.toLocaleString(undefined, {
    maximumFractionDigits,
    minimumFractionDigits: value >= 1 ? 2 : 0,
  })}`;
}

export const MODEL_CATALOG_CATEGORIES: ModelCatalogCategory[] = [
  {
    description: "Curated defaults that balance reliability, capability, and cost.",
    id: "recommended",
    label: "Recommended",
  },
  {
    description: "No-cost models and routes, including OpenRouter free-tier models.",
    id: "free",
    label: "Free models",
  },
  {
    description: "Models with strong structured output, JSON, and instruction-following behavior.",
    id: "structured-output",
    label: "Structured output",
  },
  {
    description: "Best fits for code editing, repository work, and software agents.",
    id: "coding",
    label: "Coding & agents",
  },
  {
    description: "Higher-depth models for hard reasoning, planning, and research.",
    id: "reasoning",
    label: "Deep reasoning",
  },
  {
    description: "Lower-latency or lower-cost models for quick everyday work.",
    id: "fast",
    label: "Fast & low cost",
  },
  {
    description: "Large context windows for long repos, documents, and prior work traces.",
    id: "long-context",
    label: "Long context",
  },
  {
    description: "Models that accept images, files, audio, or video alongside text.",
    id: "multimodal",
    label: "Multimodal",
  },
  {
    description: "General hosted models and live catalog entries.",
    id: "general",
    label: "General",
  },
  {
    description: "Local OpenAI-compatible servers and self-hosted runtimes.",
    id: "local",
    label: "Local",
  },
];

const DEFAULT_NINE_ROUTER_BASE_URL = getConfiguredNineRouterBaseUrl("http://127.0.0.1:20128/v1");

const DEFAULT_PROVIDER_BASE_URLS: Required<Record<ModelProviderId, string>> = {
  "9router": DEFAULT_NINE_ROUTER_BASE_URL,
  anthropic: "https://api.anthropic.com/v1",
  deepseek: "https://api.deepseek.com",
  google: "https://generativelanguage.googleapis.com/v1beta/openai",
  groq: "https://api.groq.com/openai/v1",
  lmstudio: "http://localhost:1234/v1",
  mistral: "https://api.mistral.ai/v1",
  ollama: "http://localhost:11434/v1",
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  vllm: "http://localhost:8000/v1",
  xai: "https://api.x.ai/v1",
};

const DEFAULT_PROVIDER_MODELS: Required<Record<ModelProviderId, string>> = {
  "9router": "cx/gpt-5.5",
  anthropic: "claude-sonnet-4-6",
  deepseek: "deepseek-v4-pro",
  google: "gemini-2.5-pro",
  groq: "openai/gpt-oss-120b",
  lmstudio: "",
  mistral: "mistral-medium-3.5",
  ollama: "",
  openai: "gpt-5.5",
  openrouter: DEFAULT_CHAT_MODEL,
  vllm: "",
  xai: "grok-4.3",
};

const MODEL_PROVIDER_DEFINITIONS: Record<ModelProviderId, ModelProviderDefinition> = {
  "9router": {
    apiKeyLabel: "Optional local token",
    apiKeyPlaceholder: "Optional local access token",
    apiStyle: "openai-compatible",
    baseUrlLabel: "Subscriptions base URL",
    baseUrlPlaceholder: DEFAULT_PROVIDER_BASE_URLS["9router"],
    defaultBaseUrl: DEFAULT_PROVIDER_BASE_URLS["9router"],
    defaultModel: DEFAULT_PROVIDER_MODELS["9router"],
    detail: "Connected account routes for subscription-backed models.",
    docsUrl: "",
    label: "Subscriptions",
    listModelsPath: "/models",
    optionalApiKey: true,
    reasoningMode: "openrouter",
    requiresApiKey: false,
  },
  anthropic: {
    apiKeyLabel: "Anthropic API key",
    apiKeyPlaceholder: "Paste Anthropic API key",
    apiStyle: "anthropic-messages",
    baseUrlLabel: "Anthropic base URL",
    baseUrlPlaceholder: DEFAULT_PROVIDER_BASE_URLS.anthropic,
    defaultBaseUrl: DEFAULT_PROVIDER_BASE_URLS.anthropic,
    defaultModel: DEFAULT_PROVIDER_MODELS.anthropic,
    detail: "Current Claude models through the Anthropic Messages API.",
    docsUrl: "https://platform.claude.com/docs/en/about-claude/models/overview",
    label: "Anthropic",
    listModelsPath: "/models",
    reasoningMode: "anthropic-thinking",
    requiresApiKey: true,
  },
  deepseek: {
    apiKeyLabel: "DeepSeek API key",
    apiKeyPlaceholder: "Paste DeepSeek API key",
    apiStyle: "openai-compatible",
    baseUrlLabel: "DeepSeek base URL",
    baseUrlPlaceholder: DEFAULT_PROVIDER_BASE_URLS.deepseek,
    defaultBaseUrl: DEFAULT_PROVIDER_BASE_URLS.deepseek,
    defaultModel: DEFAULT_PROVIDER_MODELS.deepseek,
    detail: "DeepSeek V4 chat and reasoning models.",
    docsUrl: "https://api-docs.deepseek.com/",
    label: "DeepSeek",
    listModelsPath: "/models",
    reasoningMode: "deepseek-thinking",
    requiresApiKey: true,
  },
  google: {
    apiKeyLabel: "Google AI Studio API key",
    apiKeyPlaceholder: "Paste Google AI Studio API key",
    apiStyle: "openai-compatible",
    baseUrlLabel: "Gemini OpenAI-compatible base URL",
    baseUrlPlaceholder: DEFAULT_PROVIDER_BASE_URLS.google,
    defaultBaseUrl: DEFAULT_PROVIDER_BASE_URLS.google,
    defaultModel: DEFAULT_PROVIDER_MODELS.google,
    detail: "Gemini through Google's OpenAI-compatible API surface.",
    docsUrl: "https://ai.google.dev/gemini-api/docs/openai",
    label: "Google Gemini",
    listModelsPath: "/models",
    reasoningMode: "google-thinking",
    requiresApiKey: true,
  },
  groq: {
    apiKeyLabel: "Groq API key",
    apiKeyPlaceholder: "Paste Groq API key",
    apiStyle: "openai-compatible",
    baseUrlLabel: "Groq OpenAI-compatible base URL",
    baseUrlPlaceholder: DEFAULT_PROVIDER_BASE_URLS.groq,
    defaultBaseUrl: DEFAULT_PROVIDER_BASE_URLS.groq,
    defaultModel: DEFAULT_PROVIDER_MODELS.groq,
    detail: "Fast OpenAI-compatible Groq inference.",
    docsUrl: "https://console.groq.com/docs/models",
    label: "Groq",
    listModelsPath: "/models",
    reasoningMode: "groq-reasoning",
    requiresApiKey: true,
  },
  lmstudio: {
    apiKeyLabel: "LM Studio API key",
    apiKeyPlaceholder: "Optional if your server requires one",
    apiStyle: "openai-compatible",
    baseUrlLabel: "LM Studio server URL",
    baseUrlPlaceholder: DEFAULT_PROVIDER_BASE_URLS.lmstudio,
    defaultBaseUrl: DEFAULT_PROVIDER_BASE_URLS.lmstudio,
    defaultModel: DEFAULT_PROVIDER_MODELS.lmstudio,
    detail: "Local OpenAI-compatible server. Change host or port for another device.",
    docsUrl: "https://lmstudio.ai/docs/developer/openai-compat",
    label: "LM Studio",
    listModelsPath: "/models",
    optionalApiKey: true,
    reasoningMode: "local-responses",
    requiresApiKey: false,
  },
  mistral: {
    apiKeyLabel: "Mistral API key",
    apiKeyPlaceholder: "Mistral API key",
    apiStyle: "openai-compatible",
    baseUrlLabel: "Mistral base URL",
    baseUrlPlaceholder: DEFAULT_PROVIDER_BASE_URLS.mistral,
    defaultBaseUrl: DEFAULT_PROVIDER_BASE_URLS.mistral,
    defaultModel: DEFAULT_PROVIDER_MODELS.mistral,
    detail: "Mistral's hosted model API.",
    docsUrl: "https://docs.mistral.ai/models/overview",
    label: "Mistral",
    listModelsPath: "/models",
    reasoningMode: "mistral-reasoning",
    requiresApiKey: true,
  },
  ollama: {
    apiKeyLabel: "Ollama API key",
    apiKeyPlaceholder: "Optional; Ollama ignores placeholder keys by default",
    apiStyle: "openai-compatible",
    baseUrlLabel: "Ollama server URL",
    baseUrlPlaceholder: DEFAULT_PROVIDER_BASE_URLS.ollama,
    defaultBaseUrl: DEFAULT_PROVIDER_BASE_URLS.ollama,
    defaultModel: DEFAULT_PROVIDER_MODELS.ollama,
    detail: "Local Ollama OpenAI-compatible endpoint. Use a device IP for LAN models.",
    docsUrl: "https://docs.ollama.com/api/openai-compatibility",
    label: "Ollama",
    listModelsPath: "/models",
    optionalApiKey: true,
    reasoningMode: "local-responses",
    requiresApiKey: false,
  },
  openai: {
    apiKeyLabel: "OpenAI API key",
    apiKeyPlaceholder: "Paste OpenAI API key",
    apiStyle: "openai-compatible",
    baseUrlLabel: "OpenAI base URL",
    baseUrlPlaceholder: DEFAULT_PROVIDER_BASE_URLS.openai,
    defaultBaseUrl: DEFAULT_PROVIDER_BASE_URLS.openai,
    defaultModel: DEFAULT_PROVIDER_MODELS.openai,
    detail: "OpenAI GPT models for coding, professional work, and reasoning.",
    docsUrl: "https://developers.openai.com/api/docs/models",
    label: "OpenAI",
    listModelsPath: "/models",
    reasoningMode: "reasoning-effort",
    requiresApiKey: true,
  },
  vllm: {
    apiKeyLabel: "vLLM API key",
    apiKeyPlaceholder: "Optional if your server requires one",
    apiStyle: "openai-compatible",
    baseUrlLabel: "vLLM server URL",
    baseUrlPlaceholder: DEFAULT_PROVIDER_BASE_URLS.vllm,
    defaultBaseUrl: DEFAULT_PROVIDER_BASE_URLS.vllm,
    defaultModel: DEFAULT_PROVIDER_MODELS.vllm,
    detail: "Local vLLM OpenAI-compatible server.",
    docsUrl: "https://docs.vllm.ai/en/stable/serving/openai_compatible_server.html",
    label: "vLLM",
    listModelsPath: "/models",
    optionalApiKey: true,
    reasoningMode: "local-responses",
    requiresApiKey: false,
  },
  openrouter: {
    apiKeyLabel: "OpenRouter API key",
    apiKeyPlaceholder: "Paste OpenRouter API key",
    apiStyle: "openai-compatible",
    baseUrlLabel: "OpenRouter base URL",
    baseUrlPlaceholder: DEFAULT_PROVIDER_BASE_URLS.openrouter,
    defaultBaseUrl: DEFAULT_PROVIDER_BASE_URLS.openrouter,
    defaultModel: DEFAULT_PROVIDER_MODELS.openrouter,
    detail: "OpenRouter model routing, provider fallbacks, and BYOK-friendly routing.",
    docsUrl: "https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request",
    label: "OpenRouter",
    listModelsPath: "/models",
    reasoningMode: "openrouter",
    requiresApiKey: true,
  },
  xai: {
    apiKeyLabel: "xAI API key",
    apiKeyPlaceholder: "xai-...",
    apiStyle: "openai-compatible",
    baseUrlLabel: "xAI base URL",
    baseUrlPlaceholder: DEFAULT_PROVIDER_BASE_URLS.xai,
    defaultBaseUrl: DEFAULT_PROVIDER_BASE_URLS.xai,
    defaultModel: DEFAULT_PROVIDER_MODELS.xai,
    detail: "xAI Grok models through xAI's OpenAI-compatible chat API.",
    docsUrl: "https://docs.x.ai/developers/models",
    label: "xAI",
    listModelsPath: "/models",
    reasoningMode: "reasoning-effort",
    requiresApiKey: true,
  },
};

export interface ChatModelOption {
  capabilities?: string[];
  category?: ModelCatalogCategoryId;
  contextWindowTokens?: number;
  detail: string;
  id: string;
  label: string;
  maxOutputTokens?: number;
  pricing?: ModelPricing;
  provider: ModelProviderId;
  useCase?: string;
  value: string;
}

export interface ProviderModelMetadata {
  capabilities?: string[];
  category?: ModelCatalogCategoryId;
  contextWindowTokens?: number;
  detail?: string;
  id: string;
  inputModalities?: string[];
  label?: string;
  maxOutputTokens?: number;
  outputModalities?: string[];
  pricing?: ModelPricing;
  supportedParameters?: string[];
  useCase?: string;
}

type ChatModelOptionExtras = Pick<ChatModelOption, "capabilities" | "category" | "maxOutputTokens" | "pricing" | "useCase">;

function modelOption(
  provider: ModelProviderId,
  id: string,
  label: string,
  value: string,
  detail: string,
  contextWindowTokens?: number,
  extras: ChatModelOptionExtras = {},
): ChatModelOption {
  return {
    contextWindowTokens,
    detail,
    id,
    label,
    ...extras,
    provider,
    value,
  };
}

const MODEL_PRICE_VERIFIED_AT = "2026-05-18";

const PROVIDER_PRICE_SOURCE_URLS: Partial<Record<ModelProviderId, string>> = {
  anthropic: "https://platform.claude.com/docs/en/about-claude/pricing",
  deepseek: "https://api-docs.deepseek.com/quick_start/pricing/",
  google: "https://ai.google.dev/gemini-api/docs/pricing",
  groq: "https://console.groq.com/docs/models",
  mistral: "https://docs.mistral.ai/models",
  openai: "https://developers.openai.com/api/docs/pricing",
  openrouter: "https://openrouter.ai/docs/guides/overview/models",
  xai: "https://docs.x.ai/developers/pricing",
};

function providerPricing(provider: ModelProviderId, pricing: Omit<ModelPricing, "source" | "sourceLabel" | "sourceUrl" | "updatedAt">): ModelPricing {
  return {
    ...pricing,
    source: provider === "openrouter" ? "openrouter" : "provider",
    sourceLabel: getModelProviderLabel(provider),
    sourceUrl: PROVIDER_PRICE_SOURCE_URLS[provider],
    updatedAt: MODEL_PRICE_VERIFIED_AT,
  };
}

function freeOpenRouterPricing(note = "Free OpenRouter route. Free-tier rate limits and provider availability can still apply."): ModelPricing {
  return providerPricing("openrouter", {
    inputPerMillionTokens: 0,
    note,
    outputPerMillionTokens: 0,
  });
}

function routedPricing(note: string, provider: ModelProviderId = "openrouter"): ModelPricing {
  return providerPricing(provider, { note });
}

function getModelProviderLabel(provider: ModelProviderId) {
  return MODEL_PROVIDER_DEFINITIONS[provider].label;
}

export const CHAT_MODEL_OPTIONS: ChatModelOption[] = [
  modelOption("9router", "9router-codex-gpt-55", "Codex GPT-5.5", "cx/gpt-5.5", "Codex subscription route.", NINE_ROUTER_CODEX_STANDARD_CONTEXT_TOKENS, {
    capabilities: ["Local gateway", "Subscription", "Reasoning", "Multimodal"],
    category: "reasoning",
    pricing: routedPricing("Usage comes from the user's connected Codex subscription and plan limits.", "9router"),
    useCase: "Use when the user wants Gilbert to use their Codex subscription route.",
  }),
  modelOption("9router", "9router-codex-gpt-54", "Codex GPT-5.4", "cx/gpt-5.4", "Balanced subscription-backed coding and chat route.", NINE_ROUTER_CODEX_STANDARD_CONTEXT_TOKENS, {
    capabilities: ["Local gateway", "Subscription", "Coding", "Multimodal"],
    category: "coding",
    pricing: routedPricing("Usage comes from the user's connected Codex subscription and plan limits.", "9router"),
    useCase: "Use as the balanced Codex route when the user wants strong coding without jumping to GPT-5.5.",
  }),
  modelOption("9router", "9router-codex-gpt-53-codex", "Codex GPT-5.3 Codex", "cx/gpt-5.3-codex", "Codex-tuned coding route for connected subscription accounts.", NINE_ROUTER_CODEX_STANDARD_CONTEXT_TOKENS, {
    capabilities: ["Local gateway", "Subscription", "Coding", "Multimodal"],
    category: "coding",
    pricing: routedPricing("Usage comes from the user's connected Codex subscription and plan limits.", "9router"),
    useCase: "Use when the user wants the Codex-tuned model through their connected Codex account.",
  }),
  modelOption("9router", "9router-codex-gpt-53-codex-xhigh", "Codex GPT-5.3 Codex xHigh", "cx/gpt-5.3-codex-xhigh", "Codex coding route with xHigh reasoning through the connected account.", NINE_ROUTER_CODEX_STANDARD_CONTEXT_TOKENS, {
    capabilities: ["Local gateway", "Subscription", "Coding", "High reasoning", "Multimodal"],
    category: "reasoning",
    pricing: routedPricing("Usage comes from the user's connected Codex subscription and plan limits.", "9router"),
    useCase: "Use for harder coding turns where the Codex xHigh route is available through the subscription account.",
  }),
  modelOption("9router", "9router-codex-gpt-53-codex-high", "Codex GPT-5.3 Codex High", "cx/gpt-5.3-codex-high", "Codex coding route with high reasoning through the connected account.", NINE_ROUTER_CODEX_STANDARD_CONTEXT_TOKENS, {
    capabilities: ["Local gateway", "Subscription", "Coding", "High reasoning", "Multimodal"],
    category: "reasoning",
    pricing: routedPricing("Usage comes from the user's connected Codex subscription and plan limits.", "9router"),
    useCase: "Use for hard coding turns where high reasoning is enough and xHigh is not needed.",
  }),
  modelOption("9router", "9router-codex-gpt-53-codex-low", "Codex GPT-5.3 Codex Low", "cx/gpt-5.3-codex-low", "Codex coding route with lower reasoning through the connected account.", NINE_ROUTER_CODEX_STANDARD_CONTEXT_TOKENS, {
    capabilities: ["Local gateway", "Subscription", "Coding", "Multimodal"],
    category: "coding",
    pricing: routedPricing("Usage comes from the user's connected Codex subscription and plan limits.", "9router"),
    useCase: "Use for routine coding turns where lower reasoning keeps subscription usage lighter.",
  }),
  modelOption("9router", "9router-codex-gpt-53-codex-none", "Codex GPT-5.3 Codex None", "cx/gpt-5.3-codex-none", "Codex coding route without extra reasoning through the connected account.", NINE_ROUTER_CODEX_STANDARD_CONTEXT_TOKENS, {
    capabilities: ["Local gateway", "Subscription", "Coding", "Fast", "Multimodal"],
    category: "fast",
    pricing: routedPricing("Usage comes from the user's connected Codex subscription and plan limits.", "9router"),
    useCase: "Use for fast edits and direct coding turns through the connected Codex account.",
  }),
  modelOption("9router", "9router-codex-gpt-53-codex-spark", "Codex GPT-5.3 Spark", "cx/gpt-5.3-codex-spark", "Codex Spark route with separate short-window and weekly quota buckets.", NINE_ROUTER_CODEX_STANDARD_CONTEXT_TOKENS, {
    capabilities: ["Local gateway", "Subscription", "Coding", "Fast", "Multimodal"],
    category: "fast",
    pricing: routedPricing("Usage comes from the user's connected Codex subscription. GPT-5.3 Spark has its own 5-hour and weekly rate-limit windows when reported by Codex.", "9router"),
    useCase: "Use for faster Codex work while keeping Spark usage visible as a separate subscription bucket.",
  }),
  modelOption("9router", "9router-always-free", "Free Auto", NINE_ROUTER_ALWAYS_FREE_MODEL, "Automatic free route for the current OpenCode Free routes.", undefined, {
    capabilities: ["Local gateway", "Auto", "Free", "Fallback"],
    category: "free",
    pricing: routedPricing("Gilbert creates this free local route from OpenCode Free models. External free-tier limits can still apply.", "9router"),
    useCase: "Use when Gilbert should stay on free OpenCode routes and rotate through the docs-backed free models automatically.",
  }),
  modelOption("9router", "9router-github-gpt-5-mini", "GitHub Copilot GPT-5 Mini", "gh/gpt-5-mini", "Subscription route for connected GitHub Copilot accounts.", undefined, {
    capabilities: ["Local gateway", "Subscription", "Coding"],
    category: "coding",
    pricing: routedPricing("Usage comes from the user's connected GitHub Copilot account and plan limits.", "9router"),
    useCase: "Use when the user has connected GitHub Copilot and wants Gilbert to route through that subscription.",
  }),
  modelOption("9router", "9router-github-gpt-41", "GitHub Copilot GPT-4.1", "gh/gpt-4.1", "Subscription-backed GPT-4.1 route for connected GitHub Copilot accounts.", undefined, {
    capabilities: ["Local gateway", "Subscription", "Coding"],
    category: "coding",
    pricing: routedPricing("Usage comes from the user's connected GitHub Copilot account and plan limits.", "9router"),
    useCase: "Use for reliable coding and general chat through a connected GitHub Copilot subscription.",
  }),
  modelOption("9router", "9router-github-gpt-4o", "GitHub Copilot GPT-4o", "gh/gpt-4o", "Subscription-backed GPT-4o route for connected GitHub Copilot accounts.", undefined, {
    capabilities: ["Local gateway", "Subscription", "Multimodal"],
    category: "multimodal",
    pricing: routedPricing("Usage comes from the user's connected GitHub Copilot account and plan limits.", "9router"),
    useCase: "Use for broad chat and multimodal tasks through a connected GitHub Copilot subscription.",
  }),
  modelOption("9router", "9router-github-claude-haiku-45", "GitHub Copilot Claude Haiku 4.5", "gh/claude-haiku-4.5", "Subscription-backed Claude Haiku route for connected GitHub Copilot accounts.", undefined, {
    capabilities: ["Local gateway", "Subscription", "Fast"],
    category: "fast",
    pricing: routedPricing("Usage comes from the user's connected GitHub Copilot account and plan limits.", "9router"),
    useCase: "Use for quick edits and fast chat through a connected GitHub Copilot subscription.",
  }),
  modelOption("9router", "9router-claude-opus-47", "Claude Code Opus 4.7", "cc/claude-opus-4-7", "Claude Code subscription route for complex coding tasks.", undefined, {
    capabilities: ["Local gateway", "Subscription", "Coding", "Reasoning"],
    category: "reasoning",
    pricing: routedPricing("Usage comes from the user's connected Claude Code subscription and shared plan limits.", "9router"),
    useCase: "Use for complex coding, architecture, and review through a connected Claude Code account.",
  }),
  modelOption("9router", "9router-claude-opus-46", "Claude Code Opus 4.6", "cc/claude-opus-4-6", "Claude Code subscription route for high-quality coding tasks.", undefined, {
    capabilities: ["Local gateway", "Subscription", "Coding", "Reasoning"],
    category: "reasoning",
    pricing: routedPricing("Usage comes from the user's connected Claude Code subscription and shared plan limits.", "9router"),
    useCase: "Use for high-quality coding and codebase reasoning through Claude Code.",
  }),
  modelOption("9router", "9router-claude-sonnet-46", "Claude Code Sonnet 4.6", "cc/claude-sonnet-4-6", "Claude Code subscription route for balanced coding work.", undefined, {
    capabilities: ["Local gateway", "Subscription", "Coding"],
    category: "coding",
    pricing: routedPricing("Usage comes from the user's connected Claude Code subscription and shared plan limits.", "9router"),
    useCase: "Use for balanced Claude Code editing, chat, and review.",
  }),
  modelOption("9router", "9router-claude-haiku-45", "Claude Code Haiku 4.5", "cc/claude-haiku-4-5-20251001", "Claude Code subscription route for fast coding work.", undefined, {
    capabilities: ["Local gateway", "Subscription", "Fast"],
    category: "fast",
    pricing: routedPricing("Usage comes from the user's connected Claude Code subscription and shared plan limits.", "9router"),
    useCase: "Use for quick Claude Code responses through a connected subscription.",
  }),
  modelOption("9router", "9router-gemini-cli-flash", "Gemini CLI Flash", "gc/gemini-3-flash-preview", "Gemini CLI subscription route for fast Google-backed coding work.", undefined, {
    capabilities: ["Local gateway", "Subscription", "Fast", "Multimodal"],
    category: "fast",
    pricing: routedPricing("Usage comes from the user's connected Gemini CLI or Cloud Code quota.", "9router"),
    useCase: "Use for fast Gemini CLI turns through a connected Google account.",
  }),
  modelOption("9router", "9router-gemini-cli-pro", "Gemini CLI Pro", "gc/gemini-3-pro-preview", "Gemini CLI subscription route for complex Google-backed coding work.", undefined, {
    capabilities: ["Local gateway", "Subscription", "Coding", "Multimodal"],
    category: "coding",
    pricing: routedPricing("Usage comes from the user's connected Gemini CLI or Cloud Code quota.", "9router"),
    useCase: "Use for harder Gemini CLI coding and analysis turns through a connected Google account.",
  }),
  modelOption("9router", "9router-antigravity-gemini-flash", "Antigravity Gemini Flash", "ag/gemini-3-flash", "Antigravity subscription route for fast Google-backed coding work.", undefined, {
    capabilities: ["Local gateway", "Subscription", "Fast", "Multimodal"],
    category: "fast",
    pricing: routedPricing("Usage comes from the user's connected Antigravity account and quota.", "9router"),
    useCase: "Use for fast Antigravity turns through a connected Google account.",
  }),
  modelOption("9router", "9router-antigravity-gemini-pro", "Antigravity Gemini Pro", "ag/gemini-pro-agent", "Antigravity subscription route for stronger agentic coding work.", undefined, {
    capabilities: ["Local gateway", "Subscription", "Coding", "Multimodal"],
    category: "coding",
    pricing: routedPricing("Usage comes from the user's connected Antigravity account and quota.", "9router"),
    useCase: "Use for stronger Antigravity coding and agent work.",
  }),
  modelOption("9router", "9router-antigravity-claude-sonnet", "Antigravity Claude Sonnet", "ag/claude-sonnet-4-6", "Antigravity subscription route for Claude-backed coding work.", undefined, {
    capabilities: ["Local gateway", "Subscription", "Coding", "Reasoning"],
    category: "coding",
    pricing: routedPricing("Usage comes from the user's connected Antigravity account and quota.", "9router"),
    useCase: "Use for Claude-backed Antigravity coding turns.",
  }),
  modelOption("9router", "9router-kiro-sonnet", "Kiro Claude Sonnet", "kr/claude-sonnet-4.5", "Kiro subscription route for Claude-backed coding work.", undefined, {
    capabilities: ["Local gateway", "Subscription", "Coding"],
    category: "coding",
    pricing: routedPricing("Usage comes from the user's connected Kiro account and quota.", "9router"),
    useCase: "Use for Kiro coding turns through a connected account.",
  }),
  modelOption("9router", "9router-kiro-haiku", "Kiro Claude Haiku", "kr/claude-haiku-4.5", "Kiro subscription route for fast coding work.", undefined, {
    capabilities: ["Local gateway", "Subscription", "Fast"],
    category: "fast",
    pricing: routedPricing("Usage comes from the user's connected Kiro account and quota.", "9router"),
    useCase: "Use for fast Kiro turns through a connected account.",
  }),
  modelOption("9router", "9router-kiro-deepseek", "Kiro DeepSeek 3.2", "kr/deepseek-3.2", "Kiro subscription route for DeepSeek-backed coding work.", undefined, {
    capabilities: ["Local gateway", "Subscription", "Coding"],
    category: "coding",
    pricing: routedPricing("Usage comes from the user's connected Kiro account and quota.", "9router"),
    useCase: "Use for Kiro coding turns on DeepSeek.",
  }),
  modelOption("9router", "9router-kilo-claude-sonnet", "Kilo Code Claude Sonnet", "kc/anthropic/claude-sonnet-4-20250514", "Kilo Code subscription route for Claude-backed coding work.", undefined, {
    capabilities: ["Local gateway", "Subscription", "Coding"],
    category: "coding",
    pricing: routedPricing("Usage comes from the user's connected Kilo Code account and quota.", "9router"),
    useCase: "Use for Kilo Code editing through a connected account.",
  }),
  modelOption("9router", "9router-kilo-gemini-pro", "Kilo Code Gemini Pro", "kc/google/gemini-2.5-pro", "Kilo Code subscription route for Gemini-backed coding work.", undefined, {
    capabilities: ["Local gateway", "Subscription", "Coding", "Multimodal"],
    category: "coding",
    pricing: routedPricing("Usage comes from the user's connected Kilo Code account and quota.", "9router"),
    useCase: "Use for Kilo Code analysis and coding through Gemini.",
  }),
  modelOption("9router", "9router-kilo-gpt-41", "Kilo Code GPT-4.1", "kc/openai/gpt-4.1", "Kilo Code subscription route for OpenAI-backed coding work.", undefined, {
    capabilities: ["Local gateway", "Subscription", "Coding"],
    category: "coding",
    pricing: routedPricing("Usage comes from the user's connected Kilo Code account and quota.", "9router"),
    useCase: "Use for Kilo Code editing through GPT-4.1.",
  }),
  modelOption("9router", "9router-cline-claude-opus", "Cline Claude Opus", "cl/anthropic/claude-opus-4.7", "Cline subscription route for high-quality Claude-backed coding work.", undefined, {
    capabilities: ["Local gateway", "Subscription", "Coding", "Reasoning"],
    category: "reasoning",
    pricing: routedPricing("Usage comes from the user's connected Cline account and quota.", "9router"),
    useCase: "Use for complex Cline coding turns through Claude Opus.",
  }),
  modelOption("9router", "9router-cline-claude-sonnet", "Cline Claude Sonnet", "cl/anthropic/claude-sonnet-4.6", "Cline subscription route for balanced Claude-backed coding work.", undefined, {
    capabilities: ["Local gateway", "Subscription", "Coding"],
    category: "coding",
    pricing: routedPricing("Usage comes from the user's connected Cline account and quota.", "9router"),
    useCase: "Use for balanced Cline coding and review.",
  }),
  modelOption("9router", "9router-cline-gpt-53-codex", "Cline GPT-5.3 Codex", "cl/openai/gpt-5.3-codex", "Cline subscription route for OpenAI-backed coding work.", undefined, {
    capabilities: ["Local gateway", "Subscription", "Coding"],
    category: "coding",
    pricing: routedPricing("Usage comes from the user's connected Cline account and quota.", "9router"),
    useCase: "Use for Cline coding turns through GPT-5.3 Codex.",
  }),
  modelOption("9router", "9router-qwen-plus", "Qwen Code Plus", "qw/qwen3-coder-plus", "Qwen Code subscription route for coding work.", undefined, {
    capabilities: ["Local gateway", "Subscription", "Coding"],
    category: "coding",
    pricing: routedPricing("Usage comes from the user's connected Qwen Code account and quota.", "9router"),
    useCase: "Use for Qwen Code editing and generation.",
  }),
  modelOption("9router", "9router-qwen-flash", "Qwen Code Flash", "qw/qwen3-coder-flash", "Qwen Code subscription route for fast coding work.", undefined, {
    capabilities: ["Local gateway", "Subscription", "Fast"],
    category: "fast",
    pricing: routedPricing("Usage comes from the user's connected Qwen Code account and quota.", "9router"),
    useCase: "Use for quick Qwen Code turns.",
  }),
  modelOption("9router", "9router-qwen-coder-model", "Qwen Code Coder", "qw/coder-model", "Qwen Code subscription route for current coder-model traffic.", undefined, {
    capabilities: ["Local gateway", "Subscription", "Coding"],
    category: "coding",
    pricing: routedPricing("Usage comes from the user's connected Qwen Code account and quota.", "9router"),
    useCase: "Use for the current Qwen coder-model route.",
  }),
  modelOption("9router", "9router-iflow-qwen-plus", "iFlow Qwen Coder Plus", "if/qwen3-coder-plus", "iFlow subscription route for Qwen-backed coding work.", undefined, {
    capabilities: ["Local gateway", "Subscription", "Coding"],
    category: "coding",
    pricing: routedPricing("Usage comes from the user's connected iFlow account and quota.", "9router"),
    useCase: "Use for iFlow coding turns backed by Qwen.",
  }),
  modelOption("9router", "9router-iflow-qwen-max", "iFlow Qwen Max", "if/qwen3-max", "iFlow subscription route for stronger Qwen-backed work.", undefined, {
    capabilities: ["Local gateway", "Subscription", "Reasoning"],
    category: "reasoning",
    pricing: routedPricing("Usage comes from the user's connected iFlow account and quota.", "9router"),
    useCase: "Use for stronger iFlow reasoning and coding turns.",
  }),
  modelOption("9router", "9router-iflow-kimi", "iFlow Kimi K2", "if/kimi-k2", "iFlow subscription route for Kimi-backed coding work.", undefined, {
    capabilities: ["Local gateway", "Subscription", "Coding"],
    category: "coding",
    pricing: routedPricing("Usage comes from the user's connected iFlow account and quota.", "9router"),
    useCase: "Use for iFlow coding turns backed by Kimi.",
  }),
  modelOption("9router", "9router-kimi-coding-k26", "Kimi Coding K2.6", "kmc/kimi-k2.6", "Kimi Coding subscription route for Kimi-backed coding work.", undefined, {
    capabilities: ["Local gateway", "Subscription", "Coding"],
    category: "coding",
    pricing: routedPricing("Usage comes from the user's connected Kimi Coding account and quota.", "9router"),
    useCase: "Use for Kimi Coding turns through a connected account.",
  }),
  modelOption("9router", "9router-kimi-coding-k25", "Kimi Coding K2.5", "kmc/kimi-k2.5", "Kimi Coding subscription route for stable Kimi-backed coding work.", undefined, {
    capabilities: ["Local gateway", "Subscription", "Coding"],
    category: "coding",
    pricing: routedPricing("Usage comes from the user's connected Kimi Coding account and quota.", "9router"),
    useCase: "Use for stable Kimi Coding turns.",
  }),
  modelOption("9router", "9router-kimi-coding-latest", "Kimi Coding Latest", "kmc/kimi-latest", "Kimi Coding subscription route for the account's latest Kimi model.", undefined, {
    capabilities: ["Local gateway", "Subscription", "Coding"],
    category: "coding",
    pricing: routedPricing("Usage comes from the user's connected Kimi Coding account and quota.", "9router"),
    useCase: "Use for Kimi Coding latest-model routing.",
  }),
  modelOption("openrouter", "openrouter-free-auto", "Auto Route Free", DEFAULT_CHAT_MODEL, "Speed-biased free routing across reliable OpenRouter free coding and reasoning models.", 262_144, {
    capabilities: ["Free", "Structured", "Reasoning"],
    category: "recommended",
    pricing: freeOpenRouterPricing(),
    useCase: "Default cost-free path for everyday coding, chat, and local-agent loops.",
  }),
  modelOption("openrouter", "openrouter-auto", "OpenRouter Auto", OPENROUTER_AUTO_MODEL, "OpenRouter Auto Router selects the best model for each prompt from a curated high-quality pool.", 2_000_000, {
    capabilities: ["Auto routing", "Structured", "Variable price"],
    category: "recommended",
    pricing: routedPricing("No Auto Router surcharge. You pay the standard rate for whichever model OpenRouter selects."),
    useCase: "Use when the prompt mix is unpredictable and the router should trade off quality, task type, and cost.",
  }),
  modelOption("openrouter", "deepseek-v4-flash-free", "DeepSeek V4 Flash Free", DEEPSEEK_V4_FLASH_FREE_MODEL, "Free DeepSeek V4 Flash route on OpenRouter with long context, reasoning, and tool support.", 1_048_576, {
    capabilities: ["Free", "Coding", "Reasoning"],
    category: "coding",
    pricing: freeOpenRouterPricing(),
    useCase: "Default direct free model for coding, long-context review, and everyday agent turns.",
  }),
  modelOption("openrouter", "gpt-oss-120b-free", "GPT-OSS 120B Free", GPT_OSS_120B_FREE_MODEL, "Free OpenAI GPT-OSS 120B route on OpenRouter with broad provider coverage.", 131_072, {
    capabilities: ["Free", "Reasoning", "Tools"],
    category: "reasoning",
    pricing: freeOpenRouterPricing(),
    useCase: "High-coverage free reasoning, coding, and structured agent work.",
  }),
  modelOption("openrouter", "laguna-m1-free", "Laguna M.1 Free", LAGUNA_M1_FREE_MODEL, "Free Poolside Laguna M.1 coding-agent route on OpenRouter with tool calling and reasoning support.", 131_072, {
    capabilities: ["Free", "Coding", "Tools", "Reasoning"],
    category: "coding",
    pricing: freeOpenRouterPricing(),
    useCase: "Agentic software engineering, code edits, and coding workflows on a free Poolside route.",
  }),
  modelOption("openrouter", "ling-26-flash", "Ling 2.6 Flash", LING_26_FLASH_MODEL, "Paid inclusionAI Ling 2.6 Flash route on OpenRouter for fast, token-efficient agent workflows.", 262_144, {
    capabilities: ["Fast", "Coding", "Tools"],
    category: "fast",
    pricing: providerPricing("openrouter", { inputPerMillionTokens: 0.01, outputPerMillionTokens: 0.03 }),
    useCase: "Fast agent chat, code triage, document processing, and lightweight execution loops.",
  }),
  modelOption("openrouter", "minimax-m25-free", "MiniMax M2.5 Free", MINIMAX_M25_FREE_MODEL, "Free MiniMax M2.5 route on OpenRouter with reasoning, structured output, and many endpoints.", 204_800, {
    capabilities: ["Free", "Reasoning", "Structured"],
    category: "reasoning",
    pricing: freeOpenRouterPricing(),
    useCase: "Resilient no-cost planning, drafting, and fallback work.",
  }),
  modelOption("openrouter", "owl-alpha", "Owl Alpha", OWL_ALPHA_MODEL, "Free OpenRouter alpha foundation model for planning, coding, and long-context tasks.", 1_048_576, {
    capabilities: ["Free", "Agentic", "Long context"],
    category: "long-context",
    pricing: freeOpenRouterPricing(),
    useCase: "Experimental long-context agent work where free routing is acceptable.",
  }),
  modelOption("openrouter", "nemotron-3-super", "Nemotron 3 Super", NEMOTRON_3_SUPER_MODEL, "Free NVIDIA 120B reasoning route on OpenRouter.", 1_048_576, {
    capabilities: ["Free", "Reasoning", "Structured"],
    category: "reasoning",
    pricing: freeOpenRouterPricing(),
    useCase: "Free reasoning, analysis, and large-model drafting.",
  }),
  modelOption("openrouter", "trinity-large-thinking-free", "Trinity Large Thinking", TRINITY_LARGE_THINKING_FREE_MODEL, "Free Arcee Trinity Large Thinking route on OpenRouter for agentic reasoning and tool-heavy coding tasks.", 262_144, {
    capabilities: ["Free", "Reasoning", "Tools"],
    category: "reasoning",
    pricing: freeOpenRouterPricing(),
    useCase: "Tool-aware reasoning, planning, and no-cost coding-agent fallback work.",
  }),
  modelOption("openrouter", "glm-45-air-free", "GLM 4.5 Air Free", GLM_45_AIR_FREE_MODEL, "Free Z.ai GLM 4.5 Air route with reasoning and tool support.", 131_072, {
    capabilities: ["Free", "Fast", "Reasoning"],
    category: "fast",
    pricing: freeOpenRouterPricing(),
    useCase: "Fast no-cost chat, short coding tasks, and inexpensive reasoning turns.",
  }),
  modelOption("openrouter", "openrouter-gpt-latest", "OpenAI GPT Latest", "~openai/gpt-latest", "OpenRouter router that always redirects to the latest OpenAI GPT family model.", 1_050_000, {
    capabilities: ["Latest", "Reasoning", "Structured"],
    category: "reasoning",
    pricing: providerPricing("openrouter", { cachedInputPerMillionTokens: 0.5, inputPerMillionTokens: 5, outputPerMillionTokens: 30 }),
    useCase: "Premium OpenAI-family reasoning, coding, and professional work through OpenRouter.",
  }),
  modelOption("openrouter", "openrouter-claude-sonnet-latest", "Claude Sonnet Latest", "~anthropic/claude-sonnet-latest", "OpenRouter router that always redirects to the latest Claude Sonnet family model.", 1_000_000, {
    capabilities: ["Latest", "Coding", "Vision"],
    category: "coding",
    pricing: providerPricing("openrouter", { cachedInputPerMillionTokens: 0.3, inputPerMillionTokens: 3, outputPerMillionTokens: 15 }),
    useCase: "Balanced coding, agents, writing, and long-context review through OpenRouter.",
  }),
  modelOption("openrouter", "openrouter-gemini-pro-latest", "Gemini Pro Latest", "~google/gemini-pro-latest", "OpenRouter router that always redirects to the latest Gemini Pro family model.", 1_048_576, {
    capabilities: ["Latest", "Long context", "Multimodal"],
    category: "long-context",
    pricing: providerPricing("openrouter", { cachedInputPerMillionTokens: 0.2, inputPerMillionTokens: 2, outputPerMillionTokens: 12 }),
    useCase: "Large multimodal context, document analysis, and long repo review through OpenRouter.",
  }),
  modelOption("openrouter", "openrouter-grok-43", "Grok 4.3", "x-ai/grok-4.3", "xAI Grok 4.3 reasoning model via OpenRouter with text and image input.", 1_000_000, {
    capabilities: ["Reasoning", "Structured", "Vision"],
    category: "reasoning",
    pricing: providerPricing("openrouter", { cachedInputPerMillionTokens: 0.2, inputPerMillionTokens: 1.25, outputPerMillionTokens: 2.5 }),
    useCase: "Guided workflows, instruction following, and factual long-context work through OpenRouter.",
  }),
  modelOption("openrouter", "openrouter-deepseek-v4-pro", "DeepSeek V4 Pro", "deepseek/deepseek-v4-pro", "DeepSeek V4 Pro through OpenRouter.", 1_000_000, {
    capabilities: ["Coding", "Reasoning", "Structured"],
    category: "coding",
    pricing: providerPricing("openrouter", { cachedInputPerMillionTokens: 0.003625, inputPerMillionTokens: 0.435, note: "Current DeepSeek promotional rate through 2026-05-31; OpenRouter live metadata may override this.", outputPerMillionTokens: 0.87 }),
    useCase: "High-value coding, long-context analysis, and guided workflows at aggressive token pricing.",
  }),
  modelOption("openai", "openai-gpt-55", "GPT-5.5", "gpt-5.5", "OpenAI flagship model for complex reasoning, coding, and professional work.", 1_050_000, {
    capabilities: ["Reasoning", "Coding", "Structured", "Multimodal"],
    category: "recommended",
    maxOutputTokens: 128_000,
    pricing: providerPricing("openai", { cachedInputPerMillionTokens: 0.5, inputPerMillionTokens: 5, note: "Standard short-context rate. OpenAI lists higher long-context rates for GPT-5.5.", outputPerMillionTokens: 30 }),
    useCase: "Best direct OpenAI default for hard coding, agent work, and complex professional reasoning.",
  }),
  modelOption("openai", "openai-gpt-55-pro", "GPT-5.5 Pro", "gpt-5.5-pro", "Smarter, more precise GPT-5.5 variant for the highest-value direct OpenAI work.", 1_050_000, {
    capabilities: ["Reasoning", "Coding", "Structured", "Precision", "Multimodal"],
    category: "reasoning",
    maxOutputTokens: 128_000,
    pricing: providerPricing("openai", { inputPerMillionTokens: 30, note: "Standard short-context rate. OpenAI lists higher long-context rates for GPT-5.5 Pro and no cached-input rate.", outputPerMillionTokens: 180 }),
    useCase: "Use when answer precision matters more than latency or cost.",
  }),
  modelOption("openai", "openai-gpt-54", "GPT-5.4", "gpt-5.4", "More affordable OpenAI model for coding and professional work.", 1_050_000, {
    capabilities: ["Coding", "Reasoning", "Structured", "Multimodal"],
    category: "coding",
    maxOutputTokens: 128_000,
    pricing: providerPricing("openai", { cachedInputPerMillionTokens: 0.25, inputPerMillionTokens: 2.5, note: "Standard short-context rate. OpenAI lists higher long-context rates for GPT-5.4.", outputPerMillionTokens: 15 }),
    useCase: "Lower-cost direct OpenAI choice for coding, structured output, and reliable professional work.",
  }),
  modelOption("openai", "openai-gpt-54-mini", "GPT-5.4 Mini", "gpt-5.4-mini", "OpenAI mini model for coding, computer use, and subagents.", 400_000, {
    capabilities: ["Fast", "Coding", "Structured", "Multimodal"],
    category: "fast",
    maxOutputTokens: 128_000,
    pricing: providerPricing("openai", { cachedInputPerMillionTokens: 0.075, inputPerMillionTokens: 0.75, outputPerMillionTokens: 4.5 }),
    useCase: "Subagents, focused implementation work, and lower-cost coding passes.",
  }),
  modelOption("openai", "openai-gpt-54-nano", "GPT-5.4 Nano", "gpt-5.4-nano", "OpenAI's smallest current GPT-5.4 model for high-volume background tasks.", 400_000, {
    capabilities: ["Fast", "Low cost", "Multimodal"],
    category: "fast",
    maxOutputTokens: 128_000,
    pricing: providerPricing("openai", { cachedInputPerMillionTokens: 0.02, inputPerMillionTokens: 0.2, outputPerMillionTokens: 1.25 }),
    useCase: "Classification, summarization, extraction, and inexpensive background work.",
  }),
  modelOption("openai", "openai-gpt-54-pro", "GPT-5.4 Pro", "gpt-5.4-pro", "More precise GPT-5.4 variant for difficult professional tasks.", 1_050_000, {
    capabilities: ["Reasoning", "Coding", "Structured", "Precision", "Multimodal"],
    category: "reasoning",
    maxOutputTokens: 128_000,
    pricing: providerPricing("openai", { inputPerMillionTokens: 30, note: "Standard short-context rate. OpenAI lists higher long-context rates for GPT-5.4 Pro and no cached-input rate.", outputPerMillionTokens: 180 }),
    useCase: "High-precision coding, analysis, and professional work where Pro cost is acceptable.",
  }),
  modelOption("openai", "openai-gpt-53-codex", "GPT-5.3 Codex", "gpt-5.3-codex", "OpenAI's specialized agentic coding model for Codex-like coding environments.", 400_000, {
    capabilities: ["Coding", "Agents", "Reasoning", "Structured", "Multimodal"],
    category: "coding",
    maxOutputTokens: 128_000,
    pricing: providerPricing("openai", { cachedInputPerMillionTokens: 0.175, inputPerMillionTokens: 1.75, outputPerMillionTokens: 14 }),
    useCase: "Agentic repository work, multi-file implementation, tool calling, and codebase navigation.",
  }),
  modelOption("anthropic", "anthropic-opus-47", "Claude Opus 4.7", "claude-opus-4-7", "Anthropic's most capable generally available model for complex reasoning and agentic coding.", 1_000_000, {
    capabilities: ["Reasoning", "Coding", "Vision"],
    category: "reasoning",
    maxOutputTokens: 128_000,
    pricing: providerPricing("anthropic", { cacheWriteInputPerMillionTokens: 6.25, cachedInputPerMillionTokens: 0.5, inputPerMillionTokens: 5, outputPerMillionTokens: 25 }),
    useCase: "Most complex agentic coding, planning, and reasoning tasks on Claude.",
  }),
  modelOption("anthropic", "anthropic-opus-46", "Claude Opus 4.6", "claude-opus-4-6", "Highly intelligent broadly available Claude model with exceptional coding and reasoning performance.", 1_000_000, {
    capabilities: ["Reasoning", "Coding", "Vision"],
    category: "reasoning",
    maxOutputTokens: 128_000,
    pricing: providerPricing("anthropic", { cacheWriteInputPerMillionTokens: 6.25, cachedInputPerMillionTokens: 0.5, inputPerMillionTokens: 5, outputPerMillionTokens: 25 }),
    useCase: "Complex coding and reasoning when Opus depth is preferred.",
  }),
  modelOption("anthropic", "anthropic-sonnet-46", "Claude Sonnet 4.6", "claude-sonnet-4-6", "Claude model with the best combination of speed and intelligence.", 1_000_000, {
    capabilities: ["Coding", "Vision", "Balanced"],
    category: "recommended",
    maxOutputTokens: 64_000,
    pricing: providerPricing("anthropic", { cacheWriteInputPerMillionTokens: 3.75, cachedInputPerMillionTokens: 0.3, inputPerMillionTokens: 3, outputPerMillionTokens: 15 }),
    useCase: "Daily coding, agent runs, long-context review, and strong general reasoning.",
  }),
  modelOption("anthropic", "anthropic-haiku-45", "Claude Haiku 4.5", "claude-haiku-4-5-20251001", "Fast Claude model with near-frontier intelligence.", 200_000, {
    capabilities: ["Fast", "Vision"],
    category: "fast",
    maxOutputTokens: 64_000,
    pricing: providerPricing("anthropic", { cacheWriteInputPerMillionTokens: 1.25, cachedInputPerMillionTokens: 0.1, inputPerMillionTokens: 1, outputPerMillionTokens: 5 }),
    useCase: "Responsive Claude-backed drafting, small edits, triage, and lighter coding tasks.",
  }),
  modelOption("google", "google-gemini-25-pro", "Gemini 2.5 Pro", "gemini-2.5-pro", "Google's state-of-the-art multipurpose model for coding and complex reasoning.", 1_048_576, {
    capabilities: ["Long context", "Reasoning", "Multimodal"],
    category: "long-context",
    pricing: providerPricing("google", { cachedInputPerMillionTokens: 0.125, inputPerMillionTokens: 1.25, note: "Listed rate applies up to 200K prompt tokens; Google lists higher rates above 200K.", outputPerMillionTokens: 10 }),
    useCase: "Deep reasoning, long documents, multimodal analysis, and code understanding.",
  }),
  modelOption("google", "google-gemini-25-flash", "Gemini 2.5 Flash", "gemini-2.5-flash", "Hybrid reasoning Gemini model for low-latency, high-volume multimodal tasks.", 1_048_576, {
    capabilities: ["Fast", "Long context", "Multimodal"],
    category: "fast",
    pricing: providerPricing("google", { cachedInputPerMillionTokens: 0.03, inputPerMillionTokens: 0.3, outputPerMillionTokens: 2.5 }),
    useCase: "Fast multimodal agents, chat, extraction, and high-throughput app features.",
  }),
  modelOption("google", "google-gemini-25-flash-lite", "Gemini 2.5 Flash-Lite", "gemini-2.5-flash-lite", "Google's smallest and most cost-effective Gemini 2.5 model for scale.", 1_048_576, {
    capabilities: ["Low cost", "Long context", "Multimodal"],
    category: "fast",
    pricing: providerPricing("google", { cachedInputPerMillionTokens: 0.01, inputPerMillionTokens: 0.1, outputPerMillionTokens: 0.4 }),
    useCase: "High-volume summarization, classification, extraction, and fast user-facing help.",
  }),
  modelOption("xai", "xai-grok-43", "Grok 4.3", "grok-4.3", "xAI reasoning model for agentic workflows and instruction-following tasks.", 1_000_000, {
    capabilities: ["Reasoning", "Structured", "Vision"],
    category: "recommended",
    pricing: providerPricing("xai", { cachedInputPerMillionTokens: 0.2, inputPerMillionTokens: 1.25, outputPerMillionTokens: 2.5 }),
    useCase: "Guided workflows, structured output, factual analysis, and long-context chat.",
  }),
  modelOption("xai", "xai-grok-41-fast-reasoning", "Grok 4.1 Fast Reasoning", "grok-4-1-fast-reasoning", "xAI cost-efficient long-context reasoning model.", 2_000_000, {
    capabilities: ["Fast", "Reasoning", "Long context"],
    category: "fast",
    pricing: providerPricing("xai", { cachedInputPerMillionTokens: 0.05, inputPerMillionTokens: 0.2, outputPerMillionTokens: 0.5 }),
    useCase: "Long-context reasoning with lower latency and lower cost than flagship Grok.",
  }),
  modelOption("xai", "xai-grok-41-fast", "Grok 4.1 Fast", "grok-4-1-fast-non-reasoning", "xAI cost-efficient long-context Grok model without reasoning overhead.", 2_000_000, {
    capabilities: ["Fast", "Long context", "Structured"],
    category: "fast",
    pricing: providerPricing("xai", { cachedInputPerMillionTokens: 0.05, inputPerMillionTokens: 0.2, outputPerMillionTokens: 0.5 }),
    useCase: "Fast long-context chat, extraction, and high-throughput non-reasoning work.",
  }),
  modelOption("groq", "groq-gpt-oss-120b", "GPT-OSS 120B", "openai/gpt-oss-120b", "Groq-hosted GPT-OSS 120B for high-capability reasoning, browser search, code understanding, and structured output.", 131_072, {
    capabilities: ["Fast", "Reasoning", "Structured"],
    category: "coding",
    pricing: providerPricing("groq", { cachedInputPerMillionTokens: 0.075, inputPerMillionTokens: 0.15, outputPerMillionTokens: 0.6 }),
    useCase: "Very fast coding, research workflows, math, and structured tasks.",
  }),
  modelOption("groq", "groq-gpt-oss-20b", "GPT-OSS 20B", "openai/gpt-oss-20b", "Smaller Groq-hosted GPT-OSS route for very fast reasoning-capable work.", 131_072, {
    capabilities: ["Very fast", "Reasoning"],
    category: "fast",
    pricing: providerPricing("groq", { inputPerMillionTokens: 0.075, outputPerMillionTokens: 0.3 }),
    useCase: "Fast drafts, classification, short coding tasks, and inexpensive reasoning turns.",
  }),
  modelOption("groq", "groq-compound", "Groq Compound", "groq/compound", "Groq system with provider-managed web search, code execution, site visits, and Wolfram Alpha.", 131_072, {
    capabilities: ["Provider-managed", "Web", "Code execution"],
    category: "coding",
    pricing: routedPricing("Final price depends on underlying model usage plus provider-managed action charges.", "groq"),
    useCase: "Queries that need Groq-managed web, code, and provider-side orchestration.",
  }),
  modelOption("groq", "groq-llama-33-70b", "Llama 3.3 70B", "llama-3.3-70b-versatile", "Groq-hosted Meta Llama 3.3 70B for multilingual NLP, code generation, and math.", 131_072, {
    capabilities: ["Fast", "Structured", "JSON"],
    category: "general",
    pricing: providerPricing("groq", { inputPerMillionTokens: 0.59, outputPerMillionTokens: 0.79 }),
    useCase: "Real-time general chat, support bots, multilingual work, coding, and math.",
  }),
  modelOption("mistral", "mistral-medium-35", "Mistral Medium 3.5", "mistral-medium-3.5", "Mistral frontier-class multimodal model optimized for agentic and coding use cases.", 256_000, {
    capabilities: ["Coding", "Agents", "Vision"],
    category: "coding",
    pricing: providerPricing("mistral", { inputPerMillionTokens: 1.5, outputPerMillionTokens: 7.5 }),
    useCase: "Agentic coding, structured outputs, document Q&A, and complex instruction following.",
  }),
  modelOption("mistral", "mistral-large-3", "Mistral Large 3", "mistral-large-2512", "Mistral state-of-the-art open-weight general-purpose multimodal model.", 256_000, {
    capabilities: ["Open weight", "Vision", "Structured"],
    category: "general",
    pricing: providerPricing("mistral", { inputPerMillionTokens: 0.5, outputPerMillionTokens: 1.5 }),
    useCase: "General multimodal work, structured outputs, and open-weight deployments.",
  }),
  modelOption("mistral", "mistral-devstral-2", "Devstral 2", "devstral-2512", "Mistral frontier code-agent model for software engineering tasks.", 256_000, {
    capabilities: ["Coding", "Agents", "Structured"],
    category: "coding",
    pricing: providerPricing("mistral", { inputPerMillionTokens: 0.4, outputPerMillionTokens: 2 }),
    useCase: "Codebase exploration, multi-file editing, and software-engineering agents.",
  }),
  modelOption("deepseek", "deepseek-v4-pro", "DeepSeek V4 Pro", "deepseek-v4-pro", "DeepSeek's strongest V4 model with thinking and non-thinking modes plus JSON output.", 1_000_000, {
    capabilities: ["Coding", "Reasoning", "Structured"],
    category: "coding",
    maxOutputTokens: 384_000,
    pricing: providerPricing("deepseek", { cachedInputPerMillionTokens: 0.003625, inputPerMillionTokens: 0.435, note: "Current DeepSeek promotional rate through 2026-05-31; regular listed input/output rates are higher.", outputPerMillionTokens: 0.87 }),
    useCase: "Hard coding, long-context analysis, guided workflows, and high-value reasoning.",
  }),
  modelOption("deepseek", "deepseek-v4-flash", "DeepSeek V4 Flash", "deepseek-v4-flash", "DeepSeek fast V4 model with thinking and non-thinking modes plus JSON output.", 1_000_000, {
    capabilities: ["Fast", "Coding", "Structured"],
    category: "fast",
    maxOutputTokens: 384_000,
    pricing: providerPricing("deepseek", { cachedInputPerMillionTokens: 0.0028, inputPerMillionTokens: 0.14, outputPerMillionTokens: 0.28 }),
    useCase: "Low-cost chat, routine coding, summarization, extraction, and high-volume agent work.",
  }),
];

export interface ModelProviderCatalogItem extends ModelProviderDefinition {
  apiKeyLabel: string;
  apiKeyPlaceholder: string;
  baseUrlLabel: string;
  baseUrlPlaceholder: string;
  defaultBaseUrl: string;
  id: ModelProviderId;
  models: ChatModelOption[];
  optionalApiKey: boolean;
}

export const MODEL_PROVIDERS: ModelProviderCatalogItem[] = MODEL_PROVIDER_IDS.map((providerId) => ({
  ...MODEL_PROVIDER_DEFINITIONS[providerId],
  id: providerId,
  models: CHAT_MODEL_OPTIONS.filter((option) => option.provider === providerId),
  optionalApiKey: MODEL_PROVIDER_DEFINITIONS[providerId].optionalApiKey ?? !MODEL_PROVIDER_DEFINITIONS[providerId].requiresApiKey,
}));

export function isModelProviderId(value: unknown): value is ModelProviderId {
  return typeof value === "string" && MODEL_PROVIDER_IDS.includes(value as ModelProviderId);
}

export function getDefaultBaseUrlForProvider(provider: ModelProviderId) {
  return DEFAULT_PROVIDER_BASE_URLS[provider];
}

export function normalizeProviderBaseUrl(provider: ModelProviderId, baseUrl: string | undefined) {
  const fallbackUrl = getDefaultBaseUrlForProvider(provider);
  const rawBaseUrl = baseUrl?.trim() || "";
  if (provider === "9router" && isConfiguredNineRouterCloudEnabled() && (!rawBaseUrl || isNineRouterNativeBridgeUrl(rawBaseUrl))) {
    return getConfiguredNineRouterBaseUrl(fallbackUrl);
  }

  const normalizedUrl = (baseUrl?.trim() || fallbackUrl).replace(/\/+$/, "");

  if (provider === "google" && normalizedUrl === "https://generativelanguage.googleapis.com/v1beta") {
    return DEFAULT_PROVIDER_BASE_URLS.google;
  }

  return normalizedUrl;
}

export function getDefaultProviderBaseUrls(): ProviderSecretMap {
  return { ...DEFAULT_PROVIDER_BASE_URLS };
}

export function getDefaultProviderModels(): ProviderSecretMap {
  return { ...DEFAULT_PROVIDER_MODELS };
}

export function getDefaultModelForProvider(provider: ModelProviderId) {
  return DEFAULT_PROVIDER_MODELS[provider];
}

export function normalizeProviderModelId(provider: ModelProviderId, model: string | undefined) {
  const normalizedModel = model?.trim() || getDefaultModelForProvider(provider);

  if (provider === "9router") {
    return normalizeNineRouterModelId(normalizedModel);
  }

  if (provider === "google" && (normalizedModel === "gemini-3-pro-preview" || normalizedModel === "gemini-3.1-pro-preview")) {
    return DEFAULT_PROVIDER_MODELS.google;
  }

  if (provider === "openai" && normalizedModel === "gpt-5-nano") {
    return "gpt-5.4-nano";
  }

  if (provider === "openai" && (normalizedModel === "gpt-5.2" || normalizedModel === "gpt-5.1" || normalizedModel === "gpt-5")) {
    return DEFAULT_PROVIDER_MODELS.openai;
  }

  if (provider === "anthropic" && (normalizedModel === "claude-opus-4-1-20250805" || normalizedModel === "claude-opus-4-20250514" || normalizedModel === "claude-sonnet-4-20250514")) {
    return DEFAULT_PROVIDER_MODELS.anthropic;
  }

  if (provider === "deepseek" && (normalizedModel === "deepseek-chat" || normalizedModel === "deepseek-reasoner")) {
    return "deepseek-v4-flash";
  }

  if (provider === "xai" && (normalizedModel.startsWith("grok-4.20") || normalizedModel === "grok-4-fast-reasoning" || normalizedModel === "grok-4-fast-non-reasoning")) {
    return DEFAULT_PROVIDER_MODELS.xai;
  }

  if (provider === "openrouter" && RETIRED_OPENROUTER_FREE_MODELS.has(normalizedModel)) {
    return DEFAULT_PROVIDER_MODELS.openrouter;
  }

  if (provider === "openrouter" && normalizedModel === LEGACY_LING_26_FLASH_FREE_MODEL) {
    return LING_26_FLASH_MODEL;
  }

  return normalizedModel;
}

export function isOpenRouterRouterModel(model: string) {
  const normalizedModel = model.trim();

  return normalizedModel === OPENROUTER_FREE_AUTO_MODEL || normalizedModel === OPENROUTER_AUTO_MODEL;
}

export function isOpenRouterFreeModel(model: string) {
  const normalizedModel = model.trim();

  return OPENROUTER_CURATED_FREE_MODEL_SET.has(normalizedModel) || normalizedModel.endsWith(":free");
}

export function isNineRouterCodexModelId(model: string) {
  const normalizedModel = model.trim().toLowerCase();

  return NINE_ROUTER_CODEX_MODEL_ID_SET.has(normalizedModel) || normalizedModel.startsWith("cx/gpt-");
}

export function getNineRouterCodexContextWindowTokens(mode?: SubscriptionCodexContextWindow) {
  return mode === "extended" ? NINE_ROUTER_CODEX_EXTENDED_CONTEXT_TOKENS : NINE_ROUTER_CODEX_STANDARD_CONTEXT_TOKENS;
}

export function getEffectiveProviderModelContextWindowTokens(
  provider: ModelProviderId,
  model: string,
  tokens: number | undefined,
  subscriptionOptimization?: Pick<SubscriptionOptimizationSettings, "codexContextWindow">,
) {
  if (provider === "9router" && isNineRouterCodexModelId(model)) {
    return getNineRouterCodexContextWindowTokens(subscriptionOptimization?.codexContextWindow);
  }

  return typeof tokens === "number" && Number.isFinite(tokens) && tokens > 0 ? Math.round(tokens) : undefined;
}

export function isNineRouterGithubCopilotModelId(model: string) {
  return NINE_ROUTER_GITHUB_COPILOT_MODEL_ID_SET.has(model.trim().toLowerCase());
}

export function normalizeNineRouterDiscoveredModelId(model: string | undefined) {
  const normalizedModel = model?.trim();

  if (!normalizedModel) {
    return undefined;
  }

  if (isNineRouterOpenCodeRoute(normalizedModel)) {
    return undefined;
  }

  if (!isNineRouterGithubCopilotRoute(normalizedModel)) {
    return normalizedModel;
  }

  return normalizeCurrentNineRouterGithubCopilotModelId(normalizedModel);
}

function normalizeNineRouterModelId(model: string) {
  const normalizedModel = model.trim();

  if (normalizedModel === NINE_ROUTER_SMART_SAVER_MODEL || isNineRouterOpenCodeRoute(normalizedModel)) {
    return NINE_ROUTER_ALWAYS_FREE_MODEL;
  }

  if (!isNineRouterGithubCopilotRoute(normalizedModel)) {
    return normalizedModel;
  }

  const currentModel = normalizeCurrentNineRouterGithubCopilotModelId(normalizedModel);

  if (currentModel) {
    return currentModel;
  }

  const normalizedGithubModel = normalizeNineRouterGithubCopilotPrefix(normalizedModel);

  return NINE_ROUTER_RETIRED_GITHUB_COPILOT_MODEL_REPLACEMENTS[normalizedGithubModel] ?? NINE_ROUTER_GITHUB_COPILOT_FALLBACK_MODEL;
}

function normalizeCurrentNineRouterGithubCopilotModelId(model: string) {
  const normalizedGithubModel = normalizeNineRouterGithubCopilotPrefix(model);
  const alias = NINE_ROUTER_GITHUB_COPILOT_MODEL_ALIASES[normalizedGithubModel] ?? normalizedGithubModel;

  return NINE_ROUTER_GITHUB_COPILOT_MODEL_ID_SET.has(alias) ? alias : undefined;
}

function normalizeNineRouterGithubCopilotPrefix(model: string) {
  const normalizedModel = model.trim().toLowerCase();
  const matchedPrefix = NINE_ROUTER_GITHUB_COPILOT_MODEL_PREFIXES.find((prefix) => normalizedModel.startsWith(prefix));

  return matchedPrefix ? `gh/${normalizedModel.slice(matchedPrefix.length)}` : normalizedModel;
}

function isNineRouterGithubCopilotRoute(model: string) {
  const normalizedModel = model.trim().toLowerCase();

  return NINE_ROUTER_GITHUB_COPILOT_MODEL_PREFIXES.some((prefix) => normalizedModel.startsWith(prefix));
}

function isNineRouterOpenCodeRoute(model: string) {
  return model.trim().toLowerCase().startsWith("oc/");
}

export function getModelProvider(provider: ModelProviderId) {
  return MODEL_PROVIDERS.find((item) => item.id === provider) ?? MODEL_PROVIDERS.find((item) => item.id === DEFAULT_PROVIDER_ID)!;
}

export function getModelRouteSourceInfo(provider: ModelProviderId, model: string): ModelRouteSourceInfo {
  if (provider === "9router") {
    return getNineRouterRouteSourceInfo(model);
  }

  if (provider === "openrouter") {
    return getOpenRouterRouteSourceInfo(model);
  }

  if (provider === "lmstudio" || provider === "ollama" || provider === "vllm") {
    const label = getModelProvider(provider).label;
    return {
      chipLabel: label,
      groupId: `${provider}-local`,
      groupLabel: `${label} local`,
      searchTags: [label, "Local", "Local model"],
      sourceLabel: `${label} local`,
    };
  }

  const providerLabel = getModelProvider(provider).label;
  const directLabel = getDirectProviderRouteLabel(provider, providerLabel);

  return {
    chipLabel: directLabel.chipLabel,
    groupId: `${provider}-api`,
    groupLabel: directLabel.groupLabel,
    searchTags: [providerLabel, directLabel.sourceLabel, "Direct API", "API key"],
    sourceLabel: directLabel.sourceLabel,
  };
}

function getDirectProviderRouteLabel(provider: ModelProviderId, providerLabel: string) {
  const directLabels: Partial<Record<ModelProviderId, { chipLabel: string; groupLabel: string; sourceLabel: string }>> = {
    anthropic: {
      chipLabel: "Anthropic API",
      groupLabel: "Anthropic API",
      sourceLabel: "Anthropic API",
    },
    deepseek: {
      chipLabel: "DeepSeek API",
      groupLabel: "DeepSeek API",
      sourceLabel: "DeepSeek API",
    },
    google: {
      chipLabel: "Gemini API",
      groupLabel: "Google Gemini API",
      sourceLabel: "Google Gemini API",
    },
    groq: {
      chipLabel: "Groq API",
      groupLabel: "Groq API",
      sourceLabel: "Groq API",
    },
    mistral: {
      chipLabel: "Mistral API",
      groupLabel: "Mistral API",
      sourceLabel: "Mistral API",
    },
    openai: {
      chipLabel: "OpenAI API",
      groupLabel: "OpenAI API",
      sourceLabel: "OpenAI API",
    },
    xai: {
      chipLabel: "xAI API",
      groupLabel: "xAI API",
      sourceLabel: "xAI API",
    },
  };

  return directLabels[provider] ?? {
    chipLabel: providerLabel,
    groupLabel: providerLabel,
    sourceLabel: providerLabel,
  };
}

function getNineRouterRouteSourceInfo(model: string): ModelRouteSourceInfo {
  const normalizedModel = model.trim().toLowerCase();

  if (normalizedModel === NINE_ROUTER_ALWAYS_FREE_MODEL || normalizedModel === NINE_ROUTER_SMART_SAVER_MODEL || normalizedModel.startsWith("oc/")) {
    return {
      chipLabel: "Free Auto",
      groupId: "9router-free-auto",
      groupLabel: "Free Auto",
      searchTags: ["Subscriptions", "Free Auto", "OpenCode Free", "Free"],
      sourceLabel: "Free Auto",
    };
  }

  const routeSources: Array<{
    chipLabel: string;
    groupId: string;
    groupLabel: string;
    prefixes: readonly string[];
    searchTags: string[];
    sourceLabel: string;
  }> = [
    {
      chipLabel: "Codex subscription",
      groupId: "9router-codex",
      groupLabel: "Codex subscription",
      prefixes: ["cx/", "codex/", "chatgpt/", "openai/"],
      searchTags: ["Subscriptions", "Codex", "ChatGPT", "OpenAI subscription"],
      sourceLabel: "Codex subscription",
    },
    {
      chipLabel: "Claude Code subscription",
      groupId: "9router-claude-code",
      groupLabel: "Claude Code subscription",
      prefixes: ["cc/", "claude/", "claude-code/", "anthropic/"],
      searchTags: ["Subscriptions", "Claude Code", "Anthropic subscription"],
      sourceLabel: "Claude Code subscription",
    },
    {
      chipLabel: "Gemini subscription",
      groupId: "9router-gemini-cli",
      groupLabel: "Gemini subscription",
      prefixes: ["gc/", "gemini-cli/", "gemini/", "google/", "cloud-code/"],
      searchTags: ["Subscriptions", "Gemini CLI", "Cloud Code", "Google subscription"],
      sourceLabel: "Gemini subscription",
    },
    {
      chipLabel: "Antigravity subscription",
      groupId: "9router-antigravity",
      groupLabel: "Antigravity subscription",
      prefixes: ["antigravity/", "ag/"],
      searchTags: ["Subscriptions", "Antigravity", "Google subscription"],
      sourceLabel: "Antigravity subscription",
    },
    {
      chipLabel: "GitHub Copilot subscription",
      groupId: "9router-github-copilot",
      groupLabel: "GitHub Copilot subscription",
      prefixes: ["gh/", "github/", "github-copilot/", "github_copilot/", "copilot/"],
      searchTags: ["Subscriptions", "GitHub Copilot", "Copilot"],
      sourceLabel: "GitHub Copilot subscription",
    },
    {
      chipLabel: "Kiro subscription",
      groupId: "9router-kiro",
      groupLabel: "Kiro subscription",
      prefixes: ["kr/", "kiro/"],
      searchTags: ["Subscriptions", "Kiro"],
      sourceLabel: "Kiro subscription",
    },
    {
      chipLabel: "Kilo Code subscription",
      groupId: "9router-kilo-code",
      groupLabel: "Kilo Code subscription",
      prefixes: ["kc/", "kilocode/", "kilo-code/", "kilo/"],
      searchTags: ["Subscriptions", "Kilo Code"],
      sourceLabel: "Kilo Code subscription",
    },
    {
      chipLabel: "Cline subscription",
      groupId: "9router-cline",
      groupLabel: "Cline subscription",
      prefixes: ["cl/", "cline/"],
      searchTags: ["Subscriptions", "Cline"],
      sourceLabel: "Cline subscription",
    },
    {
      chipLabel: "Qwen Code subscription",
      groupId: "9router-qwen-code",
      groupLabel: "Qwen Code subscription",
      prefixes: ["qw/", "qwen/", "qwen-code/"],
      searchTags: ["Subscriptions", "Qwen Code"],
      sourceLabel: "Qwen Code subscription",
    },
    {
      chipLabel: "iFlow subscription",
      groupId: "9router-iflow",
      groupLabel: "iFlow subscription",
      prefixes: ["if/", "iflow/"],
      searchTags: ["Subscriptions", "iFlow"],
      sourceLabel: "iFlow subscription",
    },
    {
      chipLabel: "Qoder subscription",
      groupId: "9router-qoder",
      groupLabel: "Qoder subscription",
      prefixes: ["qoder/"],
      searchTags: ["Subscriptions", "Qoder"],
      sourceLabel: "Qoder subscription",
    },
    {
      chipLabel: "Kimi Coding subscription",
      groupId: "9router-kimi-coding",
      groupLabel: "Kimi Coding subscription",
      prefixes: ["kmc/", "kimi/", "kimi-coding/"],
      searchTags: ["Subscriptions", "Kimi Coding"],
      sourceLabel: "Kimi Coding subscription",
    },
    {
      chipLabel: "CodeBuddy subscription",
      groupId: "9router-codebuddy",
      groupLabel: "CodeBuddy subscription",
      prefixes: ["codebuddy/"],
      searchTags: ["Subscriptions", "CodeBuddy"],
      sourceLabel: "CodeBuddy subscription",
    },
  ];
  const matchedRoute = routeSources.find((route) => route.prefixes.some((prefix) => normalizedModel.startsWith(prefix)));

  if (matchedRoute) {
    return {
      chipLabel: matchedRoute.chipLabel,
      groupId: matchedRoute.groupId,
      groupLabel: matchedRoute.groupLabel,
      searchTags: matchedRoute.searchTags,
      sourceLabel: matchedRoute.sourceLabel,
    };
  }

  return {
    chipLabel: "Subscription",
    groupId: "9router-other",
    groupLabel: "Other subscription routes",
    searchTags: ["Subscriptions", "Connected account"],
    sourceLabel: "Subscription route",
  };
}

function getOpenRouterRouteSourceInfo(model: string): ModelRouteSourceInfo {
  const sourceLabel = getOpenRouterSourceLabel(model);
  const detailedSourceLabel = sourceLabel === "OpenRouter" ? "OpenRouter route" : `OpenRouter: ${sourceLabel}`;

  return {
    chipLabel: "OpenRouter",
    groupId: "openrouter",
    groupLabel: "OpenRouter",
    searchTags: ["OpenRouter", detailedSourceLabel, sourceLabel],
    sourceLabel: detailedSourceLabel,
  };
}

function getOpenRouterSourceLabel(model: string) {
  const normalizedModel = model.trim();

  if (normalizedModel === OPENROUTER_FREE_AUTO_MODEL) {
    return "Free router";
  }

  if (normalizedModel === OPENROUTER_AUTO_MODEL) {
    return "Auto router";
  }

  const owner = normalizedModel.replace(/^~/, "").split("/")[0]?.toLowerCase() ?? "";
  const sourceLabels: Record<string, string> = {
    "arcee-ai": "Arcee AI",
    anthropic: "Anthropic",
    deepseek: "DeepSeek",
    google: "Google Gemini",
    inclusionai: "inclusionAI",
    minimax: "MiniMax",
    nvidia: "NVIDIA",
    openai: "OpenAI",
    openrouter: "OpenRouter",
    poolside: "Poolside",
    "x-ai": "xAI",
    "z-ai": "Z.ai",
  };

  return sourceLabels[owner] ?? (owner || "OpenRouter");
}

export function prefersLiveModelCatalog(provider: ModelProviderId) {
  return provider === "lmstudio" || provider === "ollama" || provider === "vllm";
}

export function usesLiveModelCatalog(provider: ModelProviderId) {
  return provider === "9router" || provider === "openrouter" || prefersLiveModelCatalog(provider);
}

export function buildProviderModelOptions(provider: ModelProviderId, discoveredModels: ProviderModelMetadata[] | undefined, currentModel?: string) {
  const normalizedCurrentModel = currentModel?.trim() ? normalizeProviderModelId(provider, currentModel) : "";
  const discoveredOptions = createDiscoveredModelOptions(provider, discoveredModels);
  const baseOptions = prefersLiveModelCatalog(provider)
    ? discoveredOptions
    : [
        ...getModelProvider(provider).models,
        ...discoveredOptions,
      ];
  const dedupedOptions = filterVisibleProviderModelOptions(provider, dedupeModelOptions(baseOptions), normalizedCurrentModel);
  const shouldKeepCustomModel = normalizedCurrentModel;

  if (shouldKeepCustomModel && !dedupedOptions.some((option) => option.value === normalizedCurrentModel)) {
    dedupedOptions.unshift({
      id: `${provider}-custom-${hashModelId(normalizedCurrentModel)}`,
      label: normalizedCurrentModel,
      detail: "Custom selected model.",
      provider,
      value: normalizedCurrentModel,
    });
  }

  return prioritizeProviderModelOptions(provider, dedupedOptions);
}

function filterVisibleProviderModelOptions(provider: ModelProviderId, options: ChatModelOption[], currentModel: string) {
  if (provider !== "openrouter") {
    return options;
  }

  return options.filter((option) => option.value === currentModel || OPENROUTER_CURATED_FREE_MODEL_SET.has(option.value));
}

export function filterEnabledProviderModelOptions(options: ChatModelOption[], disabledModelValues: string[] | undefined) {
  const disabledValues = createDisabledModelValueSet(disabledModelValues);

  if (disabledValues.size === 0) {
    return options;
  }

  return options.filter((option) => !disabledValues.has(option.value.trim()));
}

export function isProviderModelDisabled(disabledModels: ProviderModelVisibilityMap | undefined, provider: ModelProviderId, model: string) {
  const disabledValues = createDisabledModelValueSet(disabledModels?.[provider]);

  return disabledValues.has(model.trim());
}

export function getChatModelOption(model: string, provider?: ModelProviderId) {
  const normalizedModel = model.trim();

  return (
    CHAT_MODEL_OPTIONS.find((option) => option.value === normalizedModel && (!provider || option.provider === provider)) ??
    CHAT_MODEL_OPTIONS.find((option) => option.value === normalizedModel)
  );
}

export function formatModelCapabilitySummary(option: Pick<ChatModelOption, "capabilities" | "category"> | undefined, maxItems = 3) {
  const seen = new Set<string>();
  const ignoredCapabilities = new Set(["local gateway", "provider-managed", "subscription"]);
  const labels = (option?.capabilities ?? []).flatMap((capability) => {
    const normalized = capability.trim();
    const key = normalized.toLowerCase();

    if (!normalized || ignoredCapabilities.has(key) || seen.has(key)) {
      return [];
    }

    seen.add(key);
    return [normalized];
  });

  if (labels.length > 0) {
    return labels.slice(0, maxItems).join(", ");
  }

  const fallbackLabels: Partial<Record<ModelCatalogCategoryId, string>> = {
    coding: "Coding",
    fast: "Fast",
    free: "Free",
    general: "General chat",
    "long-context": "Long context",
    local: "Local",
    multimodal: "Multimodal",
    reasoning: "Reasoning",
    recommended: "Recommended",
    "structured-output": "Structured",
  };

  return fallbackLabels[option?.category ?? "general"] ?? "General chat";
}

export type ModelInputModality = "image" | "video";

export function supportsModelInputModality(provider: ModelProviderId, model: string | undefined, modality: ModelInputModality) {
  const normalizedModel = model?.trim().toLowerCase() ?? "";
  const option = normalizedModel ? getChatModelOption(model ?? "", provider) : undefined;
  const capabilities = new Set((option?.capabilities ?? []).map((capability) => capability.toLowerCase()));

  if (modality === "image" && (capabilities.has("vision") || capabilities.has("multimodal") || capabilities.has("image"))) {
    return true;
  }

  if (modality === "video" && capabilities.has("video")) {
    return true;
  }

  if (normalizedModel === IMAGE_REASONING_MODEL) {
    return true;
  }

  if (modality === "image") {
    if (provider === "openai" && supportsOpenAiNativeImageInput(normalizedModel)) {
      return true;
    }

    if (provider === "9router" && supportsNineRouterNativeImageInput(normalizedModel)) {
      return true;
    }

    if (provider === "anthropic") {
      return !normalizedModel || /claude-(opus|sonnet|haiku|3-7)/.test(normalizedModel);
    }

    if (provider === "google") {
      return !normalizedModel || normalizedModel.startsWith("gemini-");
    }

    if (provider === "mistral") {
      return normalizedModel.includes("mistral-medium-3.5") || normalizedModel.includes("mistral-large");
    }

    if (provider === "xai") {
      return normalizedModel.includes("grok-4.3") || normalizedModel.includes("vision");
    }
  }

  return false;
}

function supportsOpenAiNativeImageInput(normalizedModel: string) {
  return !normalizedModel || /^(?:gpt-|chatgpt-|o[1-9])/.test(normalizedModel);
}

function supportsNineRouterNativeImageInput(normalizedModel: string) {
  if (normalizedModel === NINE_ROUTER_ALWAYS_FREE_MODEL || normalizedModel === NINE_ROUTER_SMART_SAVER_MODEL || normalizedModel.startsWith("oc/")) {
    return true;
  }

  return normalizedModel.startsWith("cx/") && supportsOpenAiNativeImageInput(normalizedModel.slice(3));
}

export function getProviderApiKeyForProvider(settings: { apiKeys?: ProviderSecretMap; openRouterApiKey?: string }, provider: ModelProviderId) {
  const providerApiKey = settings.apiKeys?.[provider] ?? "";

  if (provider === "openrouter") {
    return providerApiKey || settings.openRouterApiKey || "";
  }

  return providerApiKey;
}

export function getProviderApiKey(settings: { apiKeys?: ProviderSecretMap; openRouterApiKey?: string; provider: ModelProviderId }) {
  return getProviderApiKeyForProvider(settings, settings.provider);
}

export function isModelProviderAvailableForSelection(
  settings: { apiKeys?: ProviderSecretMap; openRouterApiKey?: string },
  provider: ModelProviderId,
  discoveredModels: ProviderModelMetadata[] | undefined,
  catalogStatus: "error" | "idle" | "loading" | "ready" | undefined,
) {
  if (provider === "9router") {
    return true;
  }

  if (prefersLiveModelCatalog(provider)) {
    return catalogStatus === "ready" && Boolean(discoveredModels?.length);
  }

  const definition = getModelProvider(provider);
  if (definition.requiresApiKey) {
    return Boolean(getProviderApiKeyForProvider(settings, provider).trim());
  }

  return true;
}

export function getProviderBaseUrl(settings: { baseUrls?: ProviderSecretMap; provider: ModelProviderId }) {
  return normalizeProviderBaseUrl(settings.provider, settings.baseUrls?.[settings.provider]);
}

export function supportsProviderThinking(provider: ModelProviderId, _effort: string, model?: string) {
  const normalizedModel = model?.trim().toLowerCase() ?? "";

  if (provider === "anthropic") {
    return !normalizedModel || /claude-(opus|sonnet|haiku|3-7)/.test(normalizedModel);
  }

  if (provider === "google") {
    return !normalizedModel || normalizedModel.startsWith("gemini-2.5") || normalizedModel.startsWith("gemini-3");
  }

  if (provider === "groq") {
    return normalizedModel.includes("gpt-oss") || normalizedModel.includes("qwen3");
  }

  if (provider === "mistral") {
    return normalizedModel.includes("mistral-medium-3.5") || normalizedModel.includes("mistral-small") || normalizedModel.includes("magistral");
  }

  if (provider === "xai") {
    return !normalizedModel || (normalizedModel.includes("grok-4.3") || normalizedModel.includes("grok-code-fast") || normalizedModel.includes("reasoning")) && !normalizedModel.includes("non-reasoning");
  }

  return getModelProvider(provider).reasoningMode !== "none";
}

function createDiscoveredModelOption(provider: ModelProviderId, model: ProviderModelMetadata): ChatModelOption {
  const modelId = model.id.trim();

  return {
    capabilities: model.capabilities,
    category: model.category,
    contextWindowTokens: model.contextWindowTokens,
    detail: model.detail || `Discovered from ${getModelProvider(provider).label} /models.`,
    id: `${provider}-live-${hashModelId(modelId)}`,
    label: model.label?.trim() || modelId,
    pricing: model.pricing,
    provider,
    useCase: model.useCase,
    value: modelId,
  };
}

function createDiscoveredModelOptions(provider: ModelProviderId, discoveredModels: ProviderModelMetadata[] | undefined) {
  const curatedOpenRouterValues = provider === "openrouter" ? createCuratedOpenRouterModelValueSet() : undefined;

  return (discoveredModels ?? [])
    .flatMap((model) => {
      const rawModelId = model.id.trim();
      const modelId = provider === "9router" ? normalizeNineRouterDiscoveredModelId(rawModelId) : rawModelId;

      if (!modelId || (curatedOpenRouterValues && !curatedOpenRouterValues.has(modelId))) {
        return [];
      }

      return [createDiscoveredModelOption(provider, { ...model, id: modelId })];
    });
}

function createCuratedOpenRouterModelValueSet() {
  return new Set(CHAT_MODEL_OPTIONS.filter((option) => option.provider === "openrouter").map((option) => option.value));
}

function createDisabledModelValueSet(disabledModelValues: string[] | undefined) {
  return new Set((disabledModelValues ?? []).map((value) => value.trim()).filter(Boolean));
}

function dedupeModelOptions(options: ChatModelOption[]) {
  const seen = new Set<string>();

  return options.filter((option) => {
    const key = `${option.provider}:${option.value}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function prioritizeProviderModelOptions(provider: ModelProviderId, options: ChatModelOption[]) {
  if (provider === "9router") {
    return [...options].sort((left, right) => {
      const leftOrder = NINE_ROUTER_MODEL_PRIORITY_ORDER.indexOf(left.value as (typeof NINE_ROUTER_MODEL_PRIORITY_ORDER)[number]);
      const rightOrder = NINE_ROUTER_MODEL_PRIORITY_ORDER.indexOf(right.value as (typeof NINE_ROUTER_MODEL_PRIORITY_ORDER)[number]);
      const normalizedLeftOrder = leftOrder === -1 ? Number.MAX_SAFE_INTEGER : leftOrder;
      const normalizedRightOrder = rightOrder === -1 ? Number.MAX_SAFE_INTEGER : rightOrder;

      return normalizedLeftOrder - normalizedRightOrder;
    });
  }

  if (provider !== "openrouter") {
    return options;
  }

  return [...options].sort((left, right) => {
    const leftOrder = OPENROUTER_CURATED_FREE_MODELS.indexOf(left.value as (typeof OPENROUTER_CURATED_FREE_MODELS)[number]);
    const rightOrder = OPENROUTER_CURATED_FREE_MODELS.indexOf(right.value as (typeof OPENROUTER_CURATED_FREE_MODELS)[number]);
    const normalizedLeftOrder = leftOrder === -1 ? Number.MAX_SAFE_INTEGER : leftOrder;
    const normalizedRightOrder = rightOrder === -1 ? Number.MAX_SAFE_INTEGER : rightOrder;

    return normalizedLeftOrder - normalizedRightOrder;
  });
}

function hashModelId(modelId: string) {
  let hash = 0;

  for (let index = 0; index < modelId.length; index += 1) {
    hash = (hash * 31 + modelId.charCodeAt(index)) >>> 0;
  }

  return hash.toString(36);
}
