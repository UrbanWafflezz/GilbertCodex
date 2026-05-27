import { DEFAULT_CONTEXT_WINDOW_TOKENS } from "./contextWindow";
import type { ModelProviderId, ProviderSettings } from "../types/settings";

export const DEFAULT_LOCAL_MAX_TOKENS = 16_384;
export const DEFAULT_LOCAL_CONTEXT_WINDOW_TOKENS = DEFAULT_CONTEXT_WINDOW_TOKENS;
export const MAX_CONFIGURED_CONTEXT_WINDOW_TOKENS = 4_194_304;
export const DEFAULT_LOCAL_TEMPERATURE = 0.7;
export const DEFAULT_LOCAL_TOP_P = 0.95;
export const DEFAULT_LOCAL_TOP_K = 40;

const LOCAL_MODEL_PROVIDERS = new Set<ModelProviderId>(["9router", "lmstudio", "ollama", "vllm"]);
const LOCAL_TOP_K_REQUEST_PROVIDERS = new Set<ModelProviderId>(["lmstudio", "vllm"]);

export function isLocalModelProvider(provider: ModelProviderId) {
  return LOCAL_MODEL_PROVIDERS.has(provider);
}

export function getEffectiveMaxOutputTokens(settings: ProviderSettings, contextWindowTokens = DEFAULT_CONTEXT_WINDOW_TOKENS) {
  if (isLocalModelProvider(settings.provider)) {
    return normalizeMaxTokens(settings.maxTokens);
  }

  return getAutomaticHostedMaxOutputTokens(settings, contextWindowTokens);
}

export function getAutomaticHostedMaxOutputTokens(settings: Pick<ProviderSettings, "model">, contextWindowTokens = DEFAULT_CONTEXT_WINDOW_TOKENS) {
  const contextBudget = getStandardOutputBudget(contextWindowTokens);
  const modelLimit = inferModelOutputLimit(settings.model);

  return Math.max(4_096, Math.min(contextBudget, modelLimit));
}

export function applyLocalSamplingParameters(settings: ProviderSettings, body: Record<string, unknown>) {
  if (!isLocalModelProvider(settings.provider)) {
    return;
  }

  body.temperature = clampNumber(settings.temperature, 0, 2, DEFAULT_LOCAL_TEMPERATURE);
  body.top_p = clampNumber(settings.topP, 0, 1, DEFAULT_LOCAL_TOP_P);

  if (LOCAL_TOP_K_REQUEST_PROVIDERS.has(settings.provider)) {
    body.top_k = clampInteger(settings.topK, 1, 500, DEFAULT_LOCAL_TOP_K);
  }
}

export function normalizeMaxTokens(value: unknown, fallback = DEFAULT_LOCAL_MAX_TOKENS) {
  return clampInteger(value, 256, 131_072, fallback);
}

export function normalizeContextWindowTokens(value: unknown, fallback = DEFAULT_LOCAL_CONTEXT_WINDOW_TOKENS) {
  return clampInteger(value, 4_096, MAX_CONFIGURED_CONTEXT_WINDOW_TOKENS, fallback);
}

export function normalizeTemperature(value: unknown, fallback = DEFAULT_LOCAL_TEMPERATURE) {
  return clampNumber(value, 0, 2, fallback);
}

export function normalizeTopP(value: unknown, fallback = DEFAULT_LOCAL_TOP_P) {
  return clampNumber(value, 0, 1, fallback);
}

export function normalizeTopK(value: unknown, fallback = DEFAULT_LOCAL_TOP_K) {
  return clampInteger(value, 1, 500, fallback);
}

function getStandardOutputBudget(contextWindowTokens: number) {
  const boundedContext = Math.max(Math.round(contextWindowTokens || DEFAULT_CONTEXT_WINDOW_TOKENS), 1);

  if (boundedContext >= 1_000_000) {
    return 16_384;
  }

  if (boundedContext >= 128_000) {
    return 12_288;
  }

  return 8_192;
}

function inferModelOutputLimit(model: string) {
  const normalizedModel = model.toLowerCase();

  if (normalizedModel.includes("gpt-5") || normalizedModel.includes("gpt-4.1")) {
    return 128_000;
  }

  if (normalizedModel.includes("gemini") || normalizedModel.includes("grok")) {
    return 65_536;
  }

  if (normalizedModel.includes("claude") || normalizedModel.includes("mistral") || normalizedModel.includes("devstral")) {
    return 32_768;
  }

  if (normalizedModel.includes("haiku") || normalizedModel.includes("mini") || normalizedModel.includes("nano")) {
    return 16_384;
  }

  return 32_768;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const numberValue = typeof value === "number" && Number.isFinite(value) ? value : fallback;

  return Math.min(Math.max(numberValue, min), max);
}

function clampInteger(value: unknown, min: number, max: number, fallback: number) {
  return Math.round(clampNumber(value, min, max, fallback));
}
