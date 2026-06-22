import { attachmentSummary, isImageAttachment, isMediaAttachment, isVideoAttachment } from "../lib/chatAttachments";
import {
  createMessageContextSurface,
  estimateTextTokens,
  getContextWindowSafetyMarginTokens,
  getFallbackMaxOutputTokens,
  type ContextSurfaceOptions,
} from "../lib/contextWindow";
import { applyLocalSamplingParameters } from "../lib/generationSettings";
import { extractInlineThinking } from "../lib/inlineThinkingExtractor";
import {
  getDefaultModelForProvider,
  getEffectiveProviderModelContextWindowTokens,
  getModelProvider,
  getProviderApiKey,
  getProviderBaseUrl,
  IMAGE_REASONING_MODEL,
  isOpenRouterRouterModel,
  NINE_ROUTER_ALWAYS_FREE_MODEL,
  NINE_ROUTER_GITHUB_COPILOT_FALLBACK_MODEL,
  NINE_ROUTER_SMART_SAVER_MODEL,
  normalizeNineRouterDiscoveredModelId,
  normalizeProviderModelId,
  supportsModelInputModality,
  supportsProviderThinking,
} from "../lib/models";
import type { ModelPricing, ProviderModelMetadata } from "../lib/models";
import { buildAgentSystemPromptWithMetadata, type AgentSystemPromptBuild } from "../prompts/agent";
import { ensureNineRouterLocal, isTauriDesktopRuntime, nineRouterLocalHttp, nineRouterLocalStream } from "../app/tauriClient";
import type { NineRouterHttpStreamEvent } from "../app/tauriClient";
import type { ChatAttachment, ChatMessage, ChatStreamTiming } from "../types/chat";
import { createProviderReasoningState, type ProviderReasoningEntry, type ProviderReasoningState } from "../types/reasoning";
import type { ModelProviderId, ProviderSettings, ReasoningEffort } from "../types/settings";
import { DEFAULT_TOOL_REGISTRY_SETTINGS, type ToolRegistryId, type ToolRegistrySettings } from "../types/tools";
import { applyToolBridgeToProviderRequest } from "../toolBridge/adapters";
import {
  parseAnthropicStreamToolCallDelta,
  parseAnthropicToolCalls,
  parseOpenAiCompatibleStreamToolCallDeltas,
  parseResponsesStreamToolCallDeltas,
  parseOpenAiCompatibleToolCalls,
  parseResponsesStreamToolCalls,
  parseResponsesToolCalls,
  createToolCallRequest,
} from "../toolBridge/parsers";
import type { ProviderToolBridgeOptions, ToolCallRequest } from "../toolBridge/types";
import { applyOpenRouterFreeModelRouting } from "./openRouterRouting";
import { headersToRecord, normalizeNativeRequestBody, normalizeNativeRequestMethod } from "./nativeHttp";
import {
  buildNineRouterFallbackModels,
  findNineRouterCombo,
  getNineRouterComboModels,
  hasUnusableNineRouterFallbackModels,
  isOpenCodeFreeModel,
  loadNineRouterCombos,
  NINE_ROUTER_ALWAYS_FREE_COMBO_NAME,
  upsertNineRouterCombo,
} from "./nineRouterFallbackRouting";
import { loadNineRouterModels, NINE_ROUTER_DASHBOARD_FALLBACK } from "./nineRouterClient";

const STREAM_FLUSH_MS = 140;
const MAX_STREAM_REASONING_CHARS = 500_000;
const PROVIDER_RESPONSE_START_TIMEOUT_MS = 120_000;
const PROVIDER_STREAM_READ_TIMEOUT_MS = 90_000;
const PROVIDER_STREAM_PROGRESS_TIMEOUT_MS = 120_000;
const OPENROUTER_APP_REFERER = "https://github.com/UrbanWafflezz/GilbertCodex";
const OPENROUTER_APP_TITLE = "Gilbert Codex";
const OPENROUTER_APP_CATEGORIES = "programming-app,personal-agent";
const STREAM_OPTIONS_PROVIDER_IDS = new Set<ModelProviderId>(["deepseek", "groq", "openai", "openrouter", "xai"]);
const MEDIA_FALLBACK_CONTEXT_LABEL = "Media analysis";
const mediaFallbackCache = new Map<string, string>();
const DISABLED_MEDIA_FALLBACK_TOOLS = Object.fromEntries(
  (Object.keys(DEFAULT_TOOL_REGISTRY_SETTINGS) as ToolRegistryId[]).map((toolId) => [toolId, false]),
) as ToolRegistrySettings;
// Inline <think>-style tag extraction lives in src/lib/inlineThinkingExtractor.ts
// (shared with src/components/chat/ChatThread.tsx). See `extractInlineThinking`
// for the tail-prefix guard that prevents partial tags from leaking into the
// visible response area while streaming.

interface ProviderChatResponse {
  choices?: Array<{
    message?: {
      content?: ProviderContentOutput;
      reasoning?: string;
      reasoning_content?: string;
      reasoning_details?: ProviderReasoningDetail[];
      thinking?: string;
      tool_calls?: unknown[];
    };
  }>;
  error?: {
    message?: string;
  };
  usage?: ProviderUsage;
}

interface ProviderReasoningDetail {
  data?: string;
  summary?: string;
  text?: string;
  type?: string;
}

interface ProviderStreamChunk {
  choices?: Array<{
    delta?: {
      content?: ProviderContentOutput;
      reasoning?: string;
      reasoning_content?: string;
      reasoning_details?: ProviderReasoningDetail[];
      thinking?: string;
      tool_calls?: unknown[];
    };
    message?: {
      content?: ProviderContentOutput;
      reasoning?: string;
      reasoning_content?: string;
      reasoning_details?: ProviderReasoningDetail[];
      thinking?: string;
      tool_calls?: unknown[];
    };
  }>;
  error?: {
    message?: string;
  };
  usage?: ProviderUsage | null;
}

interface AnthropicMessageResponse {
  content?: Array<{
    id?: string;
    input?: unknown;
    name?: string;
    signature?: string;
    text?: string;
    thinking?: string;
    type?: string;
  }>;
  error?: {
    message?: string;
  };
  usage?: {
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
  };
}

interface ProviderContentChunk {
  content?: string;
  text?: string;
  thinking?: string | Array<{ text?: string; type?: string }>;
  type?: string;
}

type ProviderContentOutput = string | ProviderContentChunk[];

interface ResponsesApiResponse {
  error?: {
    message?: string;
  };
  output?: Array<{
    arguments?: string;
    call_id?: string;
    encrypted_content?: string;
    id?: string;
    name?: string;
    content?: Array<{
      text?: string;
      type?: string;
    }>;
    summary?: Array<{
      text?: string;
      type?: string;
    }>;
    type?: string;
  }>;
  output_text?: string;
  usage?: {
    input_tokens_details?: {
      cache_write_tokens?: number;
      cached_tokens?: number;
    };
    input_tokens?: number;
    output_tokens?: number;
    output_tokens_details?: {
      reasoning_tokens?: number;
    };
    total_tokens?: number;
  };
}

interface ResponsesStreamEvent {
  delta?: string;
  error?: {
    message?: string;
  };
  item?: {
    arguments?: string;
    call_id?: string;
    content?: Array<{
      text?: string;
      type?: string;
    }>;
    id?: string;
    name?: string;
    summary?: Array<{
      text?: string;
      type?: string;
    }>;
    type?: string;
  };
  response?: ResponsesApiResponse;
  text?: string;
  type?: string;
  usage?: ResponsesApiResponse["usage"];
}

interface AnthropicStreamChunk {
  content_block?: {
    id?: string;
    input?: unknown;
    name?: string;
    text?: string;
    type?: string;
  };
  delta?: {
    partial_json?: string;
    signature?: string;
    text?: string;
    thinking?: string;
    type?: string;
  };
  error?: {
    message?: string;
  };
  index?: number;
  message?: {
    usage?: {
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
      input_tokens?: number;
      output_tokens?: number;
    };
  };
  type?: string;
  usage?: {
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
  };
}

interface ProviderModelsResponse {
  data?: Array<{
    architecture?: {
      input_modalities?: string[];
      modality?: string;
      output_modalities?: string[];
    };
    canonical_slug?: string;
    context_length?: number;
    description?: string;
    display_name?: string;
    expiration_date?: string | null;
    id?: string;
    max_context_length?: number;
    max_input_tokens?: number;
    name?: string;
    owned_by?: string;
    pricing?: {
      audio?: string;
      completion?: string;
      image?: string;
      input_cache_read?: string;
      input_cache_write?: string;
      internal_reasoning?: string;
      prompt?: string;
      request?: string;
      web_search?: string;
    };
    supported_parameters?: string[];
    top_provider?: {
      context_length?: number;
      max_completion_tokens?: number;
    };
  }>;
  error?: {
    code?: string;
    message?: string;
    type?: string;
  };
}

interface ProviderErrorPayload {
  error?: {
    code?: string;
    message?: string;
    type?: string;
  };
}

interface StreamSnapshot {
  content: string;
  reasoningState?: ProviderReasoningState;
  streamTiming?: ChatStreamTiming;
  toolCalls?: ToolCallRequest[];
  usage?: ProviderUsage;
}

interface ProviderStreamDelta {
  contentDelta: string;
  contentSnapshot?: string;
  reasoningDelta: string;
  reasoningSnapshot?: string;
  reasoningState?: ProviderReasoningState;
  reasoningStateEntries?: ProviderReasoningEntry[];
  toolCallDeltas?: ProviderToolCallStreamDelta[];
  toolCallsSnapshot?: ToolCallRequest[];
  usage?: ProviderUsage;
}

type AnthropicSystemTextBlock = {
  cache_control?: {
    type: "ephemeral";
  };
  text: string;
  type: "text";
};

export interface ProviderUsage {
  cache_creation_input_tokens?: number;
  cached_input_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: {
    cache_write_tokens?: number;
    cached_tokens?: number;
  };
  reasoning_tokens?: number;
  prompt_tokens?: number;
  total_tokens?: number;
}

export interface ProviderStructuredOutputOptions {
  description?: string;
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
}

interface ProviderRequestOptions {
  allowMediaFallback?: boolean;
  contextWindowTokens?: number;
  retriedNineRouterGithubFallback?: boolean;
  signal?: AbortSignal;
  structuredOutput?: ProviderStructuredOutputOptions;
  toolBridge?: ProviderToolBridgeOptions;
}

interface ProviderMessageResult {
  content: string;
  reasoningState?: ProviderReasoningState;
  streamTiming?: ChatStreamTiming;
  toolCalls?: ToolCallRequest[];
  usage?: ProviderUsage;
}

interface ProviderToolCallStreamDelta {
  argumentsDelta?: string;
  argumentsParseError?: string;
  argumentsSnapshot?: unknown;
  id?: string;
  index: number;
  name?: string;
  raw?: unknown;
}

interface StreamToolCallAccumulatorEntry {
  argumentsParseError?: string;
  argumentsSnapshot?: unknown;
  argumentsText: string;
  id?: string;
  name?: string;
  raw?: unknown;
}

type ProviderMessageContent =
  | string
  | Array<
      | {
          text: string;
          type: "text";
        }
      | {
          image_url: {
            url: string;
          };
          type: "image_url";
        }
      | {
          type: "video_url";
          videoUrl: {
            url: string;
          };
        }
    >;

type ResponsesMessageContent =
  | string
  | Array<
      | {
          text: string;
          type: "input_text";
        }
      | {
          detail: "auto";
          image_url: string;
          type: "input_image";
        }
    >;

export class ProviderEmptyResponseError extends Error {
  constructor(message = "The selected provider returned an empty response.") {
    super(message);
    this.name = "ProviderEmptyResponseError";
  }
}

class ProviderTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderTimeoutError";
  }
}

export function isProviderEmptyResponseError(error: unknown) {
  return error instanceof ProviderEmptyResponseError;
}

function createProviderTimeout(parentSignal: AbortSignal | undefined, timeoutMs: number, message: string) {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  const timeoutId = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort(new ProviderTimeoutError(message));
  }, timeoutMs);

  if (parentSignal?.aborted) {
    abortFromParent();
  } else {
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  }

  return {
    clear: () => {
      globalThis.clearTimeout(timeoutId);
      parentSignal?.removeEventListener("abort", abortFromParent);
    },
    signal: controller.signal,
    throwIfTimedOut: () => {
      if (timedOut) {
        throw new ProviderTimeoutError(message);
      }
    },
  };
}

function readProviderStreamChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  message: string,
) {
  return new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
    let settled = false;
    let timeoutId: number | null = null;
    const cleanup = () => {
      if (timeoutId !== null) {
        globalThis.clearTimeout(timeoutId);
        timeoutId = null;
      }
      signal?.removeEventListener("abort", abortFromSignal);
    };
    const settle = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      callback();
    };
    const cancelReader = (reason?: unknown) => {
      void reader.cancel(reason).catch(() => undefined);
    };
    const abortFromSignal = () => {
      const abortError = new DOMException("The operation was aborted.", "AbortError");
      cancelReader(signal?.reason ?? abortError);
      settle(() => reject(abortError));
    };

    if (signal?.aborted) {
      abortFromSignal();
      return;
    }

    timeoutId = globalThis.setTimeout(() => {
      const timeoutError = new ProviderTimeoutError(message);
      cancelReader(timeoutError);
      settle(() => reject(timeoutError));
    }, timeoutMs);

    signal?.addEventListener("abort", abortFromSignal, { once: true });
    reader.read().then(
      (chunk) => settle(() => resolve(chunk)),
      (error) => settle(() => reject(error)),
    );
  });
}

async function fetchProviderJson<T>(
  providerId: ModelProviderId,
  providerLabel: string,
  url: string,
  init: RequestInit,
  parentSignal: AbortSignal | undefined,
): Promise<{ payload: T; response: Response }> {
  const requestTimeout = createProviderTimeout(
    parentSignal,
    PROVIDER_RESPONSE_START_TIMEOUT_MS,
    `${providerLabel} timed out before returning a response within ${formatTimeoutSeconds(PROVIDER_RESPONSE_START_TIMEOUT_MS)} seconds.`,
  );

  try {
    const response = await fetchProviderResponse(providerId, url, init, requestTimeout.signal, PROVIDER_RESPONSE_START_TIMEOUT_MS);
    const payload = (await readJson(response)) as T;
    requestTimeout.throwIfTimedOut();
    return { payload, response };
  } catch (error) {
    requestTimeout.throwIfTimedOut();
    throw createProviderFetchError(providerId, providerLabel, url, error);
  } finally {
    requestTimeout.clear();
  }
}

async function fetchProviderResponse(
  providerId: ModelProviderId,
  url: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  options: { stream?: boolean } = {},
) {
  if (providerId === "9router" && isTauriDesktopRuntime()) {
    if (options.stream) {
      return fetchNineRouterNativeStreamResponse(url, init, signal, timeoutMs);
    }

    return fetchNineRouterNativeResponse(url, init, signal, timeoutMs);
  }

  return fetch(url, {
    ...init,
    signal,
  });
}

async function fetchNineRouterNativeResponse(url: string, init: RequestInit, signal: AbortSignal | undefined, timeoutMs: number) {
  throwIfSignalAborted(signal);

  const nativeResponse = await nineRouterLocalHttp({
    body: normalizeNativeRequestBody(init.body, "Subscriptions native bridge"),
    headers: headersToRecord(init.headers),
    method: normalizeNativeRequestMethod(init.method, "Subscriptions native bridge"),
    timeoutMs,
    url,
  });

  throwIfSignalAborted(signal);

  return new Response(nativeResponse.body, {
    headers: nativeResponse.headers,
    status: nativeResponse.status,
  });
}

async function fetchNineRouterNativeStreamResponse(url: string, init: RequestInit, signal: AbortSignal | undefined, timeoutMs: number) {
  throwIfSignalAborted(signal);

  let responseStarted = false;
  let streamClosed = false;
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
  let resolveResponse: ((response: Response) => void) | null = null;
  let rejectResponse: ((error: unknown) => void) | null = null;
  const responseReady = new Promise<Response>((resolve, reject) => {
    resolveResponse = resolve;
    rejectResponse = reject;
  });

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
    },
    cancel() {
      streamClosed = true;
      streamController = null;
    },
  });

  const fail = (error: unknown) => {
    if (!responseStarted) {
      rejectResponse?.(error);
      return;
    }

    if (!streamClosed) {
      streamClosed = true;
      streamController?.error(error);
    }
  };

  const handleEvent = (event: NineRouterHttpStreamEvent) => {
    if (signal?.aborted) {
      fail(signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted.", "AbortError"));
      return;
    }

    if (event.event === "started") {
      responseStarted = true;
      resolveResponse?.(new Response(stream, {
        headers: event.data.headers,
        status: event.data.status,
      }));
      return;
    }

    if (event.event === "chunk") {
      if (!streamController || streamClosed) {
        return;
      }

      try {
        streamController.enqueue(base64ToBytes(event.data.bytesBase64));
      } catch (error) {
        fail(error);
      }
      return;
    }

    if (!streamClosed) {
      streamClosed = true;
      streamController?.close();
    }
  };

  const abortFromSignal = () => {
    fail(signal?.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted.", "AbortError"));
  };
  signal?.addEventListener("abort", abortFromSignal, { once: true });

  void nineRouterLocalStream({
    body: normalizeNativeRequestBody(init.body, "Subscriptions native bridge"),
    headers: headersToRecord(init.headers),
    method: normalizeNativeRequestMethod(init.method, "Subscriptions native bridge"),
    timeoutMs,
    url,
  }, handleEvent).then(
    () => {
      signal?.removeEventListener("abort", abortFromSignal);
      if (!responseStarted) {
        rejectResponse?.(new Error("Subscription stream ended before returning headers."));
        return;
      }

      if (!streamClosed) {
        streamClosed = true;
        streamController?.close();
      }
    },
    (error) => {
      signal?.removeEventListener("abort", abortFromSignal);
      fail(error);
    },
  );

  return responseReady;
}

function base64ToBytes(value: string) {
  const binary = globalThis.atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function throwIfSignalAborted(signal: AbortSignal | undefined) {
  if (!signal?.aborted) {
    return;
  }

  throw signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted.", "AbortError");
}

function createProviderFetchError(providerId: ModelProviderId, _providerLabel: string, _url: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  if (providerId === "9router" && /failed to fetch|load failed|networkerror|request failed|connection refused|could not connect/i.test(message)) {
    return new Error("Could not reach subscriptions. Open Subscriptions, then retry.");
  }

  return error;
}

type NineRouterRuntimeStatus = Awaited<ReturnType<typeof ensureNineRouterLocal>>;
let nineRouterRuntimeReadyPromise: Promise<NineRouterRuntimeStatus> | null = null;

async function ensureProviderRuntimeReady(settings: ProviderSettings, signal: AbortSignal | undefined): Promise<NineRouterRuntimeStatus | undefined> {
  if (settings.provider !== "9router" || !isTauriDesktopRuntime()) {
    return undefined;
  }

  throwIfSignalAborted(signal);
  nineRouterRuntimeReadyPromise ??= ensureNineRouterLocal().finally(() => {
    nineRouterRuntimeReadyPromise = null;
  });
  const status = await nineRouterRuntimeReadyPromise;
  throwIfSignalAborted(signal);

  if (!status.running) {
    throw new Error(status.message || "Subscriptions are not ready. Open Subscriptions, then retry.");
  }

  return status;
}

async function ensureNineRouterSelectedAutoRoute(settings: ProviderSettings, model: string, runtimeStatus: NineRouterRuntimeStatus | undefined, signal: AbortSignal | undefined) {
  if (settings.provider !== "9router") {
    return;
  }

  const mode = getNineRouterAutoRouteMode(model);
  if (!mode) {
    return;
  }

  throwIfSignalAborted(signal);
  const baseUrl = settings.baseUrls["9router"]?.trim() || runtimeStatus?.baseUrl || getProviderBaseUrl(settings);
  const dashboardUrl = runtimeStatus?.dashboardUrl || NINE_ROUTER_DASHBOARD_FALLBACK;

  try {
    const [liveModels, combos] = await Promise.all([
      loadNineRouterModels(baseUrl),
      loadNineRouterCombos(dashboardUrl),
    ]);
    throwIfSignalAborted(signal);

    const comboName = NINE_ROUTER_ALWAYS_FREE_COMBO_NAME;
    const combo = findNineRouterCombo(combos, comboName);
    const installedModels = getNineRouterComboModels(combo);
    const needsRepair =
      !combo ||
      installedModels.length === 0 ||
      hasUnusableNineRouterFallbackModels(installedModels, liveModels) ||
      !installedModels.some(isOpenCodeFreeModel);

    if (!needsRepair) {
      return;
    }

    const fallbackModels = buildNineRouterFallbackModels(mode, model, liveModels);
    if (fallbackModels.length === 0) {
      return;
    }

    await upsertNineRouterCombo(dashboardUrl, comboName, fallbackModels, "fallback");
    throwIfSignalAborted(signal);
  } catch (error) {
    throwIfSignalAborted(signal);
    console.warn("Could not refresh 9Router Free Auto route before sending; continuing with the selected route.", error);
  }
}

function getNineRouterAutoRouteMode(model: string) {
  const normalizedModel = model.trim();

  if (normalizedModel === NINE_ROUTER_ALWAYS_FREE_MODEL) {
    return "always-free" as const;
  }

  if (normalizedModel === NINE_ROUTER_SMART_SAVER_MODEL) {
    return "always-free" as const;
  }

  return null;
}

function createProviderHttpError(settings: ProviderSettings, providerLabel: string, model: string, payload: ProviderErrorPayload, response: Response) {
  const providerMessage = payload.error?.message?.trim();
  const nineRouterMessage = settings.provider === "9router" ? formatNineRouterRequestError(model, providerMessage, response.status) : "";

  return new Error(nineRouterMessage || providerMessage || `${providerLabel} request failed with HTTP ${response.status}.`);
}

function shouldRetryNineRouterGithubFallback(settings: ProviderSettings, model: string, payload: ProviderErrorPayload, response: Response, options: ProviderRequestOptions) {
  if (options.retriedNineRouterGithubFallback || settings.provider !== "9router" || model === NINE_ROUTER_GITHUB_COPILOT_FALLBACK_MODEL || !model.trim().toLowerCase().startsWith("gh/")) {
    return false;
  }

  const errorMessage = [payload.error?.code, payload.error?.type, payload.error?.message].filter(Boolean).join(" ").toLowerCase();

  return response.status === 400 && /model_not_supported|not available for integrator|requested model is not (?:available|supported)|integrator\s+"vscode-chat"/i.test(errorMessage);
}

function createNineRouterGithubFallbackSettings(settings: ProviderSettings): ProviderSettings {
  return {
    ...settings,
    model: NINE_ROUTER_GITHUB_COPILOT_FALLBACK_MODEL,
    providerModels: {
      ...settings.providerModels,
      "9router": NINE_ROUTER_GITHUB_COPILOT_FALLBACK_MODEL,
    },
  };
}

function createNineRouterGithubFallbackOptions(options: ProviderRequestOptions): ProviderRequestOptions {
  return {
    ...options,
    retriedNineRouterGithubFallback: true,
  };
}

function formatNineRouterRequestError(model: string, providerMessage: string | undefined, status: number) {
  const credentialMatch = providerMessage?.match(/No active credentials for provider:\s*([a-z0-9_-]+)/i);

  if (credentialMatch) {
    const providerId = credentialMatch[1];
    const providerName = formatNineRouterProviderName(providerId);

    if (model === "free-combo" || model === NINE_ROUTER_SMART_SAVER_MODEL || model === NINE_ROUTER_ALWAYS_FREE_MODEL) {
      return `9Router is running, but the selected Free Auto route fell through to ${providerName} with no active credentials. Open Usage, refresh Free Auto routing, then retry.`;
    }

    return `Subscription routing is running, but ${providerName} is not connected for ${model}. Open Subscriptions, connect ${providerName}, then retry or choose a connected subscription model.`;
  }

  if (status === 404 && (model === "free-combo" || model === NINE_ROUTER_SMART_SAVER_MODEL || model === NINE_ROUTER_ALWAYS_FREE_MODEL)) {
    return "9Router is running, but the selected Free Auto route is not available in the local catalog. Open Usage, refresh Free Auto routing, then retry.";
  }

  return "";
}

function formatNineRouterProviderName(providerId: string) {
  const labels: Record<string, string> = {
    bazaarlink: "BazaarLink",
    claude: "Claude Code",
    codex: "Codex",
    freetheai: "FreeTheAI",
    github: "GitHub Copilot",
    kiro: "Kiro",
    openai: "OpenAI",
    opencode: "OpenCode Free",
    vertex: "Vertex AI",
  };

  return labels[providerId.toLowerCase()] ?? providerId;
}

async function prepareMessagesForMediaFallback(settings: ProviderSettings, messages: ChatMessage[], options: ProviderRequestOptions): Promise<ChatMessage[]> {
  if (options.allowMediaFallback === false) {
    return messages;
  }

  const model = modelForMessages(settings, messages);
  const fallbackEntries = messages
    .map((message) => ({
      attachments: (message.attachments ?? []).filter((attachment) => shouldUseMediaFallback(settings, model, attachment)),
      message,
    }))
    .filter((entry) => entry.attachments.length > 0);

  if (fallbackEntries.length === 0) {
    return messages;
  }

  const fallbackSettings = createMediaFallbackProviderSettings(settings);
  assertUsableSettings("openrouter", getProviderApiKey(fallbackSettings), IMAGE_REASONING_MODEL);

  const contexts: Array<{ attachmentIds: Set<string>; content: string; messageId: string }> = await Promise.all(
    fallbackEntries.map(async (entry) => ({
      attachmentIds: new Set(entry.attachments.map((attachment) => attachment.id)),
      content: await createMediaFallbackContext(fallbackSettings, entry.message, entry.attachments, options.signal),
      messageId: entry.message.id,
    })),
  );
  const contextsByMessageId = new Map(contexts.map((context) => [context.messageId, context]));

  return messages.map((message) => {
    const context = contextsByMessageId.get(message.id);

    if (!context) {
      return message;
    }

    const remainingAttachments = (message.attachments ?? []).filter((attachment) => !context.attachmentIds.has(attachment.id));

    return {
      ...message,
      attachments: remainingAttachments.length > 0 ? remainingAttachments : undefined,
      content: appendMediaFallbackContext(message.content, context.content),
    };
  });
}

function shouldUseMediaFallback(settings: ProviderSettings, model: string, attachment: ChatAttachment) {
  if (!isMediaAttachment(attachment)) {
    return false;
  }

  return !supportsModelInputModality(settings.provider, model, isVideoAttachment(attachment) ? "video" : "image");
}

function createMediaFallbackProviderSettings(settings: ProviderSettings): ProviderSettings {
  return {
    ...settings,
    maxTokens: Math.max(settings.maxTokens, 2048),
    model: IMAGE_REASONING_MODEL,
    provider: "openrouter",
    systemPrompt: [
      "You analyze attached images and videos for a downstream AI model that cannot inspect media directly.",
      "Return concise, factual media notes only. Include visible text, objects, UI layout, scene details, actions, and anything needed to answer the user's request.",
      "Do not answer the user's request except where needed to explain what is visible in the media.",
    ].join(" "),
    temperature: Math.min(settings.temperature, 0.2),
    thinking: {
      enabled: false,
      effort: "low",
    },
    tools: { ...DISABLED_MEDIA_FALLBACK_TOOLS },
    userInstructions: "",
    webSearch: {
      ...settings.webSearch,
      enabled: false,
    },
    workspaceDependencies: {
      enabled: false,
    },
  };
}

async function createMediaFallbackContext(settings: ProviderSettings, message: ChatMessage, attachments: ChatAttachment[], signal: AbortSignal | undefined): Promise<string> {
  const cacheKey = createMediaFallbackCacheKey(message, attachments);
  const cached = mediaFallbackCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const response = await sendProviderMessage(settings, [createMediaFallbackMessage(message, attachments)], {
    allowMediaFallback: false,
    signal,
  });
  const content = response.content.trim();
  const context = [
    attachmentSummary(attachments),
    content || "No media details were returned.",
  ].filter(Boolean).join("\n\n");

  mediaFallbackCache.set(cacheKey, context);
  return context;
}

function createMediaFallbackMessage(message: ChatMessage, attachments: ChatAttachment[]): ChatMessage {
  const prompt = [
    "Analyze the attached media for another AI model that will receive only your text notes.",
    "",
    "User message:",
    message.content.trim() || "(no text)",
    "",
    "Attached media:",
    attachmentSummary(attachments),
  ].join("\n");

  return {
    ...message,
    attachments,
    content: prompt,
    role: "user",
  };
}

function createMediaFallbackCacheKey(message: ChatMessage, attachments: ChatAttachment[]) {
  return [
    "media-fallback-v1",
    IMAGE_REASONING_MODEL,
    message.id,
    message.content,
    ...attachments.map((attachment) => [attachment.id, attachment.name, attachment.mimeType, attachment.size].join(":")),
  ].join("|");
}

function appendMediaFallbackContext(content: string, context: string) {
  const body = content.trim();
  const mediaContext = `[${MEDIA_FALLBACK_CONTEXT_LABEL}]\n${context}`;

  return body ? `${body}\n\n${mediaContext}` : mediaContext;
}

export async function sendProviderMessage(settings: ProviderSettings, messages: ChatMessage[], options: ProviderRequestOptions = {}): Promise<ProviderMessageResult> {
  const provider = getModelProvider(settings.provider);
  const apiKey = getProviderApiKey(settings);
  const preparedMessages = await prepareMessagesForMediaFallback(settings, messages, options);
  const model = modelForMessages(settings, preparedMessages);
  const conversationCacheKey = createProviderConversationCacheKey(settings, preparedMessages, model);

  assertUsableSettings(settings.provider, apiKey, model);
  const nineRouterRuntimeStatus = await ensureProviderRuntimeReady(settings, options.signal);
  await ensureNineRouterSelectedAutoRoute(settings, model, nineRouterRuntimeStatus, options.signal);

  if (provider.apiStyle === "anthropic-messages") {
    const { payload, response } = await fetchProviderJson<AnthropicMessageResponse>(
      settings.provider,
      provider.label,
      joinUrl(getProviderBaseUrl(settings), "/messages"),
      {
        body: JSON.stringify(createProviderRequestBody(settings, preparedMessages, model, false, options.toolBridge, options.contextWindowTokens, options.structuredOutput)),
        headers: createProviderHeaders(settings.provider, apiKey, { conversationCacheKey }),
        method: "POST",
      },
      options.signal,
    );

    if (!response.ok) {
      throw createProviderHttpError(settings, provider.label, model, payload, response);
    }

    const content = extractAnthropicText(payload).trim();
    const toolCalls = parseAnthropicToolCalls(payload, settings.provider);

    if (!content && toolCalls.length === 0) {
      throw new ProviderEmptyResponseError(`${provider.label} returned no final answer.`);
    }

    return {
      content,
      reasoningState: settings.thinking.enabled ? extractAnthropicReasoningState(payload, settings.provider) : undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: normalizeAnthropicUsage(payload.usage),
    };
  }

  if (usesResponsesApi(settings, model)) {
    const { payload, response } = await fetchProviderJson<ResponsesApiResponse>(
      settings.provider,
      provider.label,
      joinUrl(getProviderBaseUrl(settings), "/responses"),
      {
        body: JSON.stringify(createProviderRequestBody(settings, preparedMessages, model, false, options.toolBridge, options.contextWindowTokens, options.structuredOutput)),
        headers: createProviderHeaders(settings.provider, apiKey, { conversationCacheKey }),
        method: "POST",
      },
      options.signal,
    );

    if (!response.ok) {
      throw createProviderHttpError(settings, provider.label, model, payload, response);
    }

    const { content } = extractResponsesOutput(payload);
    const toolCalls = parseResponsesToolCalls(payload, settings.provider);

    if (!content.trim() && toolCalls.length === 0) {
      throw new ProviderEmptyResponseError(`${provider.label} returned no final answer.`);
    }

    return {
      content: content.trim(),
      reasoningState: settings.thinking.enabled ? extractResponsesReasoningState(payload, settings.provider) : undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: normalizeResponsesUsage(payload.usage),
    };
  }

  const { payload, response } = await fetchProviderJson<ProviderChatResponse>(
    settings.provider,
    provider.label,
    joinUrl(getProviderBaseUrl(settings), "/chat/completions"),
    {
      body: JSON.stringify(createProviderRequestBody(settings, preparedMessages, model, false, options.toolBridge, options.contextWindowTokens, options.structuredOutput)),
      headers: createProviderHeaders(settings.provider, apiKey, { conversationCacheKey }),
      method: "POST",
    },
    options.signal,
  );

  if (!response.ok) {
    if (shouldRetryNineRouterGithubFallback(settings, model, payload, response, options)) {
      return sendProviderMessage(createNineRouterGithubFallbackSettings(settings), messages, createNineRouterGithubFallbackOptions(options));
    }

    throw createProviderHttpError(settings, provider.label, model, payload, response);
  }

  const message = payload.choices?.[0]?.message;
  const extractedMessage = extractProviderMessageOutput(message);
  const content = extractedMessage.content.trim();
  const toolCalls = parseOpenAiCompatibleToolCalls(message, settings.provider);

  if (!content && toolCalls.length === 0) {
    throw new ProviderEmptyResponseError(`${provider.label} returned no final answer.`);
  }

  return {
    content,
    reasoningState: settings.thinking.enabled ? extractProviderMessageReasoningState(message, settings.provider, extractedMessage.reasoning) : undefined,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    usage: normalizeProviderUsage(payload.usage),
  };
}

export async function streamProviderMessage(
  settings: ProviderSettings,
  messages: ChatMessage[],
  onUpdate: (snapshot: StreamSnapshot) => void,
  options: ProviderRequestOptions = {},
): Promise<ProviderMessageResult> {
  const provider = getModelProvider(settings.provider);
  const apiKey = getProviderApiKey(settings);
  const preparedMessages = await prepareMessagesForMediaFallback(settings, messages, options);
  const model = modelForMessages(settings, preparedMessages);
  const conversationCacheKey = createProviderConversationCacheKey(settings, preparedMessages, model);
  const useResponsesApi = usesResponsesApi(settings, model);
  const requestStartedAt = new Date().toISOString();
  const requestStartedMs = nowHighResolutionMs();
  const timingMarks: Partial<ChatStreamTiming> = {
    requestStartedAt,
  };

  assertUsableSettings(settings.provider, apiKey, model);
  const nineRouterRuntimeStatus = await ensureProviderRuntimeReady(settings, options.signal);
  await ensureNineRouterSelectedAutoRoute(settings, model, nineRouterRuntimeStatus, options.signal);

  const requestTimeout = createProviderTimeout(
    options.signal,
    PROVIDER_RESPONSE_START_TIMEOUT_MS,
    `${provider.label} timed out before starting a streaming response within ${formatTimeoutSeconds(PROVIDER_RESPONSE_START_TIMEOUT_MS)} seconds.`,
  );
  let response: Response;

  const requestUrl = joinUrl(getProviderBaseUrl(settings), provider.apiStyle === "anthropic-messages" ? "/messages" : useResponsesApi ? "/responses" : "/chat/completions");

  try {
    response = await fetchProviderResponse(
      settings.provider,
      requestUrl,
      {
        body: JSON.stringify(createProviderRequestBody(settings, preparedMessages, model, true, options.toolBridge, options.contextWindowTokens, options.structuredOutput)),
        headers: createProviderHeaders(settings.provider, apiKey, { conversationCacheKey }),
        method: "POST",
      },
      requestTimeout.signal,
      PROVIDER_RESPONSE_START_TIMEOUT_MS,
      { stream: true },
    );
    markStreamTiming(timingMarks, requestStartedMs, "responseStarted");
  } catch (error) {
    requestTimeout.throwIfTimedOut();
    throw createProviderFetchError(settings.provider, provider.label, requestUrl, error);
  } finally {
    requestTimeout.clear();
  }

  if (!response.ok) {
    const payload = (await readJson(response)) as ProviderChatResponse | AnthropicMessageResponse;
    if (shouldRetryNineRouterGithubFallback(settings, model, payload, response, options)) {
      return streamProviderMessage(createNineRouterGithubFallbackSettings(settings), messages, onUpdate, createNineRouterGithubFallbackOptions(options));
    }

    throw createProviderHttpError(settings, provider.label, model, payload, response);
  }

  if (!response.body) {
    throw new Error(`${provider.label} did not return a streaming response body.`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let reasoning = "";
  let reasoningStateEntries: ProviderReasoningEntry[] = [];
  let snapshotReasoningState: ProviderReasoningState | undefined;
  let reasoningTrimmed = false;
  let usage: ProviderUsage | undefined;
  let flushTimer: number | null = null;
  let lastFlushedContent = "";
  let lastFlushedReasoning = "";
  let lastFlushedToolCallRevision = -1;
  let toolCallRevision = 0;
  let lastFlushedToolCallsSnapshot: ToolCallRequest[] = [];
  let lastMeaningfulStreamEventAt = Date.now();
  const toolCallAccumulator = new Map<number, StreamToolCallAccumulatorEntry>();

  function flushSnapshot(force = false) {
    if (flushTimer) {
      window.clearTimeout(flushTimer);
      flushTimer = null;
    }

    const separatedContent = separateInlineThinking(content);
    const nextContent = separatedContent.content;
    const nextReasoningState = settings.thinking.enabled
      ? snapshotReasoningState ?? createStreamProviderReasoningState(settings.provider, [reasoning, separatedContent.reasoning].filter(Boolean).join(""), reasoningStateEntries)
      : undefined;
    const nextReasoningKey = createReasoningFlushKey(nextReasoningState, reasoning, separatedContent.reasoning);
    const toolCallsChanged = force || toolCallRevision !== lastFlushedToolCallRevision;
    const nextToolCalls = toolCallsChanged ? finalizeStreamToolCalls(settings.provider, toolCallAccumulator) : lastFlushedToolCallsSnapshot;

    if (!force && nextContent === lastFlushedContent && nextReasoningKey === lastFlushedReasoning && !toolCallsChanged) {
      return;
    }

    lastFlushedContent = nextContent;
    lastFlushedReasoning = nextReasoningKey;
    lastFlushedToolCallRevision = toolCallRevision;
    lastFlushedToolCallsSnapshot = nextToolCalls;
    onUpdate({
      content: nextContent,
      reasoningState: nextReasoningState,
      streamTiming: createStreamTimingSnapshot(timingMarks),
      toolCalls: nextToolCalls.length > 0 ? nextToolCalls : undefined,
      usage,
    });
  }

  function scheduleSnapshot() {
    if (flushTimer) {
      return;
    }

    flushTimer = window.setTimeout(() => {
      flushTimer = null;
      flushSnapshot();
    }, STREAM_FLUSH_MS);
  }

  function applyStreamDelta(delta: ProviderStreamDelta | null) {
    if (!delta) {
      return false;
    }

    const toolCallsChanged = applyStreamToolCallDelta(toolCallAccumulator, delta);
    const reasoningDelta = settings.thinking.enabled ? delta.reasoningDelta : "";
    const appendedContent = appendStreamText(content, delta.contentDelta);
    const nextContent = shouldUseStreamSnapshot(appendedContent, delta.contentSnapshot) ? delta.contentSnapshot! : appendedContent;
    const appendedReasoning = appendStreamText(reasoning, reasoningDelta);
    const snapshotReasoning = settings.thinking.enabled ? delta.reasoningSnapshot : undefined;
    const rawNextReasoning = shouldUseStreamSnapshot(appendedReasoning, snapshotReasoning) ? snapshotReasoning! : appendedReasoning;
    const nextReasoning = limitReasoningText(rawNextReasoning);
    const previousReasoningEntryCount = reasoningStateEntries.length;

    if (settings.thinking.enabled) {
      reasoningStateEntries = mergeReasoningStateEntries(reasoningStateEntries, delta.reasoningStateEntries);
      snapshotReasoningState = delta.reasoningState ?? snapshotReasoningState;
    }

    usage = delta.usage ?? usage;
    reasoningTrimmed = reasoningTrimmed || rawNextReasoning.length > MAX_STREAM_REASONING_CHARS;

    if (nextContent !== content || nextReasoning !== reasoning || toolCallsChanged || reasoningStateEntries.length !== previousReasoningEntryCount || delta.reasoningState) {
      markStreamTiming(timingMarks, requestStartedMs, "firstProviderEvent");
      if (toolCallsChanged) {
        toolCallRevision += 1;
      }

      if (!timingMarks.firstTokenAt && separateInlineThinking(nextContent).content.trim()) {
        markStreamTiming(timingMarks, requestStartedMs, "firstToken");
      }

      content = nextContent;
      reasoning = nextReasoning;
      scheduleSnapshot();
      return true;
    }

    return false;
  }

  try {
    while (true) {
      const { done, value } = await readProviderStreamChunk(
        reader,
        options.signal,
        PROVIDER_STREAM_READ_TIMEOUT_MS,
        `${provider.label} timed out after sending no stream data for ${formatTimeoutSeconds(PROVIDER_STREAM_READ_TIMEOUT_MS)} seconds.`,
      );

      if (done) {
        break;
      }

      markStreamTiming(timingMarks, requestStartedMs, "firstByte");
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (applyStreamDelta(parseProviderStreamLine(settings.provider, line, useResponsesApi))) {
          lastMeaningfulStreamEventAt = Date.now();
        }
      }

      if (Date.now() - lastMeaningfulStreamEventAt > PROVIDER_STREAM_PROGRESS_TIMEOUT_MS) {
        throw new ProviderTimeoutError(`${provider.label} timed out after keeping the stream open without answer text, tool calls, or provider activity for ${formatTimeoutSeconds(PROVIDER_STREAM_PROGRESS_TIMEOUT_MS)} seconds.`);
      }
    }

    applyStreamDelta(parseProviderStreamLine(settings.provider, buffer, useResponsesApi));
    markStreamTiming(timingMarks, requestStartedMs, "completed");
    flushSnapshot(true);
  } finally {
    if (flushTimer) {
      window.clearTimeout(flushTimer);
    }

    try {
      reader.releaseLock();
    } catch {
      // The stream can already be released after an AbortController cancellation.
    }
  }

  const separatedFinalContent = separateInlineThinking(content, { final: true });
  const finalContent = separatedFinalContent.content.trim();
  const finalReasoning = [reasoning, separatedFinalContent.reasoning].filter(Boolean).join("");
  const finalToolCalls = finalizeStreamToolCalls(settings.provider, toolCallAccumulator);

  if (!finalContent && finalToolCalls.length === 0) {
    throw new ProviderEmptyResponseError(`${provider.label} returned no final answer.`);
  }

  return {
    content: finalContent,
    reasoningState: settings.thinking.enabled
      ? snapshotReasoningState ?? createStreamProviderReasoningState(settings.provider, finalReasoning, reasoningStateEntries, reasoningTrimmed)
      : undefined,
    streamTiming: createStreamTimingSnapshot(timingMarks, true),
    toolCalls: finalToolCalls.length > 0 ? finalToolCalls : undefined,
    usage,
  };
}

export async function validateProviderSettings(settings: ProviderSettings) {
  const provider = getModelProvider(settings.provider);
  const apiKey = getProviderApiKey(settings);
  const model = settings.model.trim();

  assertUsableSettings(settings.provider, apiKey, model);

  const { payload, response } = await fetchProviderJson<ProviderModelsResponse>(
    settings.provider,
    provider.label,
    joinUrl(getProviderBaseUrl(settings), provider.listModelsPath),
    {
      headers: createProviderHeaders(settings.provider, apiKey),
      method: "GET",
    },
    undefined,
  );

  if (!response.ok) {
    throw new Error(payload.error?.message || `${provider.label} models check failed with HTTP ${response.status}.`);
  }

  const modelExists = settings.provider === "openrouter" && isOpenRouterRouterModel(model) ? true : Boolean(model && payload.data?.some((entry) => entry.id === model));

  return modelExists
    ? `Connected. ${model} is available on ${provider.label}.`
    : settings.provider === "9router"
      ? `Connected to ${provider.label}. This model was not listed.`
      : `Connected to ${provider.label}. The key works, but this model was not listed.`;
}

export async function fetchProviderModels(settings: ProviderSettings, options: ProviderRequestOptions = {}): Promise<ProviderModelMetadata[]> {
  const provider = getModelProvider(settings.provider);
  const apiKey = getProviderApiKey(settings);

  if (settings.provider !== "openrouter") {
    assertProviderApiKey(settings.provider, apiKey);
  }

  const { payload, response } = await fetchProviderJson<ProviderModelsResponse>(
    settings.provider,
    provider.label,
    joinUrl(getProviderBaseUrl(settings), provider.listModelsPath),
    {
      headers: createProviderHeaders(settings.provider, apiKey),
      method: "GET",
    },
    options.signal,
  );

  if (!response.ok) {
    throw new Error(payload.error?.message || `${provider.label} models check failed with HTTP ${response.status}.`);
  }

  return normalizeProviderModels(payload, settings.provider);
}

export async function fetchProviderModelContextLengths(settings: ProviderSettings, models: string[], options: ProviderRequestOptions = {}) {
  const requestedModels = new Set(models.map((model) => model.trim()).filter(Boolean));

  if (requestedModels.size === 0) {
    return {};
  }

  const providerModels = await fetchProviderModels(settings, options);

  return providerModels.reduce<Record<string, number>>((contextLengths, model) => {
    if (requestedModels.has(model.id) && typeof model.contextWindowTokens === "number" && Number.isFinite(model.contextWindowTokens) && model.contextWindowTokens > 0) {
      const effectiveTokens = getEffectiveProviderModelContextWindowTokens(
        settings.provider,
        model.id,
        model.contextWindowTokens,
        settings.subscriptionOptimization,
      );
      if (effectiveTokens) {
        contextLengths[model.id] = effectiveTokens;
      }
    }

    return contextLengths;
  }, {});
}

export function createProviderChatRequestBody(
  settings: ProviderSettings,
  messages: ChatMessage[],
  model = modelForMessages(settings, messages),
  toolBridge?: ProviderToolBridgeOptions,
  contextWindowTokens?: number,
  structuredOutput?: ProviderStructuredOutputOptions,
) {
  const systemPrompt = createProviderSystemPromptBuild(settings, messages, toolBridge);
  const body: Record<string, unknown> = {
    messages: [
      { role: "system", content: systemPrompt.prompt },
      ...messages.map((message) => ({
        role: message.role,
        content: createProviderMessageContent(message, { contextWindowTokens }),
      })),
    ],
    model,
  };

  applyChatMaxTokens(settings, body);
  applyLocalSamplingParameters(settings, body);
  applyChatStructuredOutput(body, structuredOutput);

  if (settings.provider === "openrouter") {
    applyOpenRouterFreeModelRouting(body, model, messages);
  }

  applyReasoningToRequestBody(settings, body);
  const bridgedBody = applyToolBridgeToProviderRequest(body, "openai-compatible", toolBridge);
  applyPromptCacheMetadata(settings, bridgedBody, systemPrompt);
  return bridgedBody;
}

export function createProviderStreamRequestBody(
  settings: ProviderSettings,
  messages: ChatMessage[],
  model = modelForMessages(settings, messages),
  toolBridge?: ProviderToolBridgeOptions,
  contextWindowTokens?: number,
  structuredOutput?: ProviderStructuredOutputOptions,
) {
  const body: Record<string, unknown> = {
    ...createProviderChatRequestBody(settings, messages, model, toolBridge, contextWindowTokens, structuredOutput),
    stream: true,
  };

  if (STREAM_OPTIONS_PROVIDER_IDS.has(settings.provider)) {
    body.stream_options = {
      include_usage: true,
    };
  }

  return body;
}

export function modelForMessages(settings: ProviderSettings, _messages: ChatMessage[]) {
  return normalizeProviderModelId(settings.provider, settings.model.trim() || getDefaultModelForProvider(settings.provider));
}

export function createResponsesRequestBody(
  settings: ProviderSettings,
  messages: ChatMessage[],
  model = modelForMessages(settings, messages),
  stream = false,
  toolBridge?: ProviderToolBridgeOptions,
  contextWindowTokens?: number,
  structuredOutput?: ProviderStructuredOutputOptions,
) {
  const systemPrompt = createProviderSystemPromptBuild(settings, messages, toolBridge);
  const body: Record<string, unknown> = {
    input: messages.map((message) => ({
      content: createResponsesMessageContent(message, { contextWindowTokens }),
      role: message.role,
    })),
    instructions: systemPrompt.prompt,
    max_output_tokens: settings.maxTokens,
    model,
    stream,
  };

  applyLocalSamplingParameters(settings, body);
  applyResponsesReasoningToRequestBody(settings, body);
  applyResponsesStructuredOutput(body, structuredOutput);

  const bridgedBody = applyToolBridgeToProviderRequest(body, "openai-responses", toolBridge);
  applyPromptCacheMetadata(settings, bridgedBody, systemPrompt);
  return bridgedBody;
}

export function createProviderRequestBody(
  settings: ProviderSettings,
  messages: ChatMessage[],
  model = modelForMessages(settings, messages),
  stream = true,
  toolBridge?: ProviderToolBridgeOptions,
  contextWindowTokens?: number,
  structuredOutput?: ProviderStructuredOutputOptions,
) {
  const provider = getModelProvider(settings.provider);
  let body: Record<string, unknown>;

  if (provider.apiStyle === "anthropic-messages") {
    body = createAnthropicRequestBody(settings, messages, model, stream, toolBridge, contextWindowTokens, structuredOutput);
    return applyContextWindowPreflightToBody(settings, body, contextWindowTokens);
  }

  if (usesResponsesApi(settings, model)) {
    body = createResponsesRequestBody(settings, messages, model, stream, toolBridge, contextWindowTokens, structuredOutput);
    return applyContextWindowPreflightToBody(settings, body, contextWindowTokens);
  }

  body = stream
    ? createProviderStreamRequestBody(settings, messages, model, toolBridge, contextWindowTokens, structuredOutput)
    : createProviderChatRequestBody(settings, messages, model, toolBridge, contextWindowTokens, structuredOutput);
  return applyContextWindowPreflightToBody(settings, body, contextWindowTokens);
}

export function createProviderUsageRequestBody(
  settings: ProviderSettings,
  messages: ChatMessage[],
  model = modelForMessages(settings, messages),
  stream = true,
  toolBridge?: ProviderToolBridgeOptions,
  contextWindowTokens?: number,
  structuredOutput?: ProviderStructuredOutputOptions,
) {
  return createProviderRequestBody(settings, messages, model, stream, toolBridge, contextWindowTokens, structuredOutput);
}

export function getProviderRequestMaxOutputTokens(body: Record<string, unknown>, fallback = 0) {
  const value = body.max_output_tokens ?? body.max_completion_tokens ?? body.max_tokens;
  return normalizePositiveRequestInteger(value, fallback);
}

export function estimateProviderRequestReasoningReserveTokens(settings: ProviderSettings, body: Record<string, unknown>) {
  if (!settings.thinking.enabled) {
    return 0;
  }

  const thinkingBudget = readNestedNumber(body.thinking, "budget_tokens");
  if (thinkingBudget) {
    // Anthropic's thinking budget is part of max_tokens, so it is tracked as a
    // lane but not added again to the request total.
    return thinkingBudget;
  }

  const googleThinkingBudget = readGoogleThinkingBudget(body.extra_body);
  if (googleThinkingBudget) {
    return googleThinkingBudget;
  }

  if (body.reasoning || body.reasoning_effort || body.include_reasoning || body.thinking) {
    return estimateReasoningReserveFromEffort(settings.thinking.effort);
  }

  return 0;
}

function applyContextWindowPreflightToBody(settings: ProviderSettings, body: Record<string, unknown>, contextWindowTokens?: number) {
  const boundedContextWindow = Math.max(Math.round(contextWindowTokens || 0), 0);

  if (!boundedContextWindow) {
    return body;
  }

  const maxOutputField = getProviderMaxOutputField(body);
  if (!maxOutputField) {
    return body;
  }

  const model = typeof body.model === "string" ? body.model : settings.model;
  const requestedMaxOutput = getProviderRequestMaxOutputTokens(body, settings.maxTokens);
  const manualMaxOutput = getManualMaxOutputOverride(settings, model);
  const metadataMaxOutput = manualMaxOutput ?? getFallbackMaxOutputTokens(model, settings.provider, boundedContextWindow);
  const thinkingBudget = readNestedNumber(body.thinking, "budget_tokens");
  const minimumAcceptedOutput = settings.provider === "anthropic" && thinkingBudget
    ? thinkingBudget + 1024
    : 256;
  const safetyMarginTokens = getContextWindowSafetyMarginTokens(boundedContextWindow);
  const outputCappedByMetadata = Math.max(
    minimumAcceptedOutput,
    Math.min(requestedMaxOutput, metadataMaxOutput, Math.max(boundedContextWindow - safetyMarginTokens, minimumAcceptedOutput)),
  );
  body[maxOutputField] = outputCappedByMetadata;

  const inputTokens = estimateProviderRequestInputTokens(body);
  const reasoningReserveTokens = estimateAdditionalProviderReasoningReserveTokens(settings, body);
  const availableOutputTokens = Math.floor(boundedContextWindow - inputTokens - reasoningReserveTokens - safetyMarginTokens);

  if (availableOutputTokens >= minimumAcceptedOutput && outputCappedByMetadata > availableOutputTokens) {
    body[maxOutputField] = Math.max(minimumAcceptedOutput, Math.min(outputCappedByMetadata, availableOutputTokens));
  }

  return body;
}

function getManualMaxOutputOverride(settings: ProviderSettings, model: string) {
  const override = settings.modelBudgetOverrides?.[settings.provider]?.[model]?.maxOutputTokens;
  return typeof override === "number" && Number.isFinite(override) && override > 0 ? Math.round(override) : undefined;
}

function getProviderMaxOutputField(body: Record<string, unknown>) {
  if ("max_output_tokens" in body) return "max_output_tokens";
  if ("max_completion_tokens" in body) return "max_completion_tokens";
  if ("max_tokens" in body) return "max_tokens";
  return "";
}

function estimateProviderRequestInputTokens(body: Record<string, unknown>) {
  const inputOnlyBody = { ...body };
  delete inputOnlyBody.max_completion_tokens;
  delete inputOnlyBody.max_output_tokens;
  delete inputOnlyBody.max_tokens;
  return estimateTextTokens(JSON.stringify(inputOnlyBody));
}

function estimateAdditionalProviderReasoningReserveTokens(settings: ProviderSettings, body: Record<string, unknown>) {
  const thinkingBudget = readNestedNumber(body.thinking, "budget_tokens");
  if (thinkingBudget) {
    return 0;
  }

  if (settings.provider === "openai" && "max_output_tokens" in body) {
    return 0;
  }

  return estimateProviderRequestReasoningReserveTokens(settings, body);
}

function estimateReasoningReserveFromEffort(effort: ReasoningEffort) {
  const effortReserve: Record<ReasoningEffort, number> = {
    low: 1024,
    medium: 4096,
    high: 16_384,
  };

  return effortReserve[effort] ?? effortReserve.medium;
}

function readGoogleThinkingBudget(value: unknown) {
  if (!value || typeof value !== "object") {
    return 0;
  }

  const google = (value as { google?: unknown }).google;
  if (!google || typeof google !== "object") {
    return 0;
  }

  const config = (google as { thinking_config?: unknown }).thinking_config;
  return readNestedNumber(config, "thinking_budget");
}

function readNestedNumber(value: unknown, key: string) {
  if (!value || typeof value !== "object") {
    return 0;
  }

  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0 ? Math.round(candidate) : 0;
}

function normalizePositiveRequestInteger(value: unknown, fallback: number) {
  const numberValue = typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
  return Math.max(Math.round(numberValue || 0), 0);
}

export function createProviderMessageContent(message: ChatMessage, contextOptions: ContextSurfaceOptions = {}): ProviderMessageContent {
  const imageAttachments = message.attachments?.filter(isImageAttachment) ?? [];
  const videoAttachments = message.attachments?.filter(isVideoAttachment) ?? [];
  const text = createMessageTextForProvider(message, contextOptions);

  if (imageAttachments.length === 0 && videoAttachments.length === 0) {
    return text;
  }

  return [
    {
      text: text || "User attached media.",
      type: "text",
    },
    ...imageAttachments.map((attachment) => ({
      image_url: {
        url: attachment.dataUrl,
      },
      type: "image_url" as const,
    })),
    ...videoAttachments.map((attachment) => ({
      type: "video_url" as const,
      videoUrl: {
        url: attachment.dataUrl,
      },
    })),
  ];
}

function createResponsesMessageContent(message: ChatMessage, contextOptions: ContextSurfaceOptions = {}): ResponsesMessageContent {
  const imageAttachments = message.attachments?.filter(isImageAttachment) ?? [];
  const text = createMessageTextForProvider(message, contextOptions);

  if (imageAttachments.length === 0) {
    return text || message.content || " ";
  }

  return [
    {
      text: text || "User attached image.",
      type: "input_text",
    },
    ...imageAttachments.map((attachment) => ({
      detail: "auto" as const,
      image_url: attachment.dataUrl,
      type: "input_image" as const,
    })),
  ];
}

export function createMessageTextForProvider(message: ChatMessage, contextOptions: ContextSurfaceOptions = {}) {
  const content = message.content.trim();
  const attachments = message.attachments ?? [];
  const contextSurface = createMessageContextSurface(message, contextOptions);
  const body = contextSurface ? [content, contextSurface].filter(Boolean).join("\n\n") : content;

  if (attachments.length === 0) {
    return body || message.content;
  }

  const summary = attachmentSummary(attachments);

  if (!summary) {
    return body;
  }

  return body ? `${body}\n\nAttachments:\n${summary}` : `Attachments:\n${summary}`;
}

function createAnthropicRequestBody(
  settings: ProviderSettings,
  messages: ChatMessage[],
  model: string,
  stream: boolean,
  toolBridge?: ProviderToolBridgeOptions,
  contextWindowTokens?: number,
  structuredOutput?: ProviderStructuredOutputOptions,
) {
  const thinkingConfig = createAnthropicThinkingConfig(settings, model);
  const body: Record<string, unknown> = {
    max_tokens: thinkingConfig.maxTokens,
    messages: messages.map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: createAnthropicMessageContent(message, { contextWindowTokens }),
    })),
    model,
    stream,
    system: createAnthropicSystemPromptContent(settings, messages, toolBridge),
  };

  if (thinkingConfig.thinking) {
    body.thinking = thinkingConfig.thinking;
  }

  if (thinkingConfig.outputConfig) {
    body.output_config = thinkingConfig.outputConfig;
  }

  applyAnthropicStructuredOutput(body, structuredOutput);

  return applyToolBridgeToProviderRequest(body, "anthropic-messages", toolBridge);
}

function createAnthropicMessageContent(message: ChatMessage, contextOptions: ContextSurfaceOptions = {}) {
  const imageAttachments = message.attachments?.filter(isImageAttachment) ?? [];
  const text = createMessageTextForProvider(message, contextOptions);

  if (imageAttachments.length === 0) {
    return text || message.content || " ";
  }

  return [
    {
      text: text || "User attached image.",
      type: "text",
    },
    ...imageAttachments.flatMap((attachment) => {
      const parsed = parseDataUrl(attachment.dataUrl);

      if (!parsed) {
        return [];
      }

      return [
        {
          source: {
            data: parsed.data,
            media_type: parsed.mediaType,
            type: "base64",
          },
          type: "image",
        },
      ];
    }),
  ];
}

function createProviderSystemPromptBuild(settings: ProviderSettings, messages: ChatMessage[], toolBridge?: ProviderToolBridgeOptions) {
  return buildAgentSystemPromptWithMetadata({ messages, settings, toolBridge });
}

function createAnthropicSystemPromptContent(settings: ProviderSettings, messages: ChatMessage[], toolBridge?: ProviderToolBridgeOptions) {
  const systemPrompt = createProviderSystemPromptBuild(settings, messages, toolBridge);
  const blocks = [
    createAnthropicSystemTextBlock(systemPrompt.cacheablePrompt, true),
    createAnthropicSystemTextBlock(systemPrompt.dynamicPrompt, false),
  ].filter((block): block is AnthropicSystemTextBlock => Boolean(block));

  return blocks.length > 0 ? blocks : systemPrompt.prompt;
}

function createAnthropicSystemTextBlock(text: string, cacheable: boolean): AnthropicSystemTextBlock | null {
  const trimmed = text.trim();

  if (!trimmed) {
    return null;
  }

  return {
    ...(cacheable ? { cache_control: { type: "ephemeral" } } : {}),
    text: trimmed,
    type: "text",
  };
}

function applyPromptCacheMetadata(settings: ProviderSettings, body: Record<string, unknown>, systemPrompt: AgentSystemPromptBuild) {
  if (settings.provider !== "openai") {
    return;
  }

  const cacheKey = createProviderPromptCacheKey(settings, body, systemPrompt);

  if (cacheKey) {
    body.prompt_cache_key = cacheKey;
  }
}

function createProviderPromptCacheKey(settings: ProviderSettings, body: Record<string, unknown>, systemPrompt: AgentSystemPromptBuild) {
  const model = typeof body.model === "string" ? body.model : settings.model;
  const toolNames = readProviderToolNames(body.tools).join(",");
  const stablePrefix = systemPrompt.cacheablePrompt || systemPrompt.prompt.slice(0, 4096);
  const hash = hashStableText(`${settings.provider}|${model}|${toolNames}|${stablePrefix}`);

  return hash ? `gc-${hash}` : "";
}

function createProviderConversationCacheKey(settings: ProviderSettings, messages: ChatMessage[], model: string) {
  if (settings.provider !== "xai") {
    return undefined;
  }

  const anchorMessage = messages.find((message) => message.role === "user") ?? messages[0];
  const anchor = [
    anchorMessage?.id,
    anchorMessage?.createdAt,
    anchorMessage?.role,
  ].filter(Boolean).join("|") || anchorMessage?.content.slice(0, 256) || model;
  const hash = hashStableText(`${settings.provider}|${model}|${anchor}`);

  return hash ? `gc-${hash}` : undefined;
}

function readProviderToolNames(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((tool) => {
      if (!tool || typeof tool !== "object") {
        return "";
      }

      const record = tool as Record<string, unknown>;
      const functionValue = record.function;

      if (functionValue && typeof functionValue === "object") {
        const functionName = (functionValue as Record<string, unknown>).name;
        return typeof functionName === "string" ? functionName : "";
      }

      const name = record.name;
      return typeof name === "string" ? name : "";
    })
    .filter(Boolean)
    .sort();
}

function hashStableText(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash.toString(36);
}

function applyChatMaxTokens(settings: ProviderSettings, body: Record<string, unknown>) {
  if (usesMaxCompletionTokens(settings.provider)) {
    body.max_completion_tokens = settings.maxTokens;
    return;
  }

  body.max_tokens = settings.maxTokens;
}

function usesMaxCompletionTokens(provider: ModelProviderId) {
  return provider === "openai" || provider === "openrouter" || provider === "groq";
}

function applyChatStructuredOutput(body: Record<string, unknown>, structuredOutput: ProviderStructuredOutputOptions | undefined) {
  if (!structuredOutput) {
    return;
  }

  body.response_format = {
    json_schema: createOpenAiJsonSchemaFormat(structuredOutput),
    type: "json_schema",
  };
}

function applyResponsesStructuredOutput(body: Record<string, unknown>, structuredOutput: ProviderStructuredOutputOptions | undefined) {
  if (!structuredOutput) {
    return;
  }

  body.text = {
    format: {
      ...createOpenAiJsonSchemaFormat(structuredOutput),
      type: "json_schema",
    },
  };
}

function applyAnthropicStructuredOutput(body: Record<string, unknown>, structuredOutput: ProviderStructuredOutputOptions | undefined) {
  if (!structuredOutput) {
    return;
  }

  const existingOutputConfig = typeof body.output_config === "object" && body.output_config
    ? body.output_config as Record<string, unknown>
    : {};

  body.output_config = {
    ...existingOutputConfig,
    format: {
      schema: structuredOutput.schema,
      type: "json_schema",
    },
  };
}

function createOpenAiJsonSchemaFormat(structuredOutput: ProviderStructuredOutputOptions) {
  return {
    ...(structuredOutput.description ? { description: structuredOutput.description } : {}),
    name: structuredOutput.name,
    schema: structuredOutput.schema,
    strict: structuredOutput.strict ?? true,
  };
}

function usesResponsesApi(settings: ProviderSettings, model: string) {
  const provider = getModelProvider(settings.provider);

  return (settings.provider === "openai" || provider.reasoningMode === "local-responses") && settings.thinking.enabled && supportsProviderThinking(settings.provider, settings.thinking.effort, model);
}

function createAnthropicThinkingConfig(settings: ProviderSettings, model: string) {
  if (!settings.thinking.enabled || !supportsProviderThinking(settings.provider, settings.thinking.effort, model)) {
    return { maxTokens: settings.maxTokens };
  }

  if (usesAnthropicAdaptiveThinking(model)) {
    return {
      maxTokens: settings.maxTokens,
      outputConfig: {
        effort: mapAnthropicEffort(settings.thinking.effort),
      },
      thinking: {
        type: "adaptive",
      },
    };
  }

  const budgetTokens = createAnthropicThinkingBudget(settings, model);

  return {
    maxTokens: budgetTokens ? Math.max(settings.maxTokens, budgetTokens + 1024) : settings.maxTokens,
    thinking: budgetTokens
      ? {
          type: "enabled",
          budget_tokens: budgetTokens,
        }
      : undefined,
  };
}

function usesAnthropicAdaptiveThinking(model: string) {
  return /claude-(opus-4-[67]|sonnet-4-6)/.test(model.toLowerCase());
}

function mapAnthropicEffort(effort: ReasoningEffort) {
  return effort;
}

function createAnthropicThinkingBudget(settings: ProviderSettings, model: string) {
  if (!settings.thinking.enabled || !supportsProviderThinking(settings.provider, settings.thinking.effort, model)) {
    return 0;
  }

  // Anthropic requires `budget_tokens` >= 1024. The Low/Medium/High labels in the
  // UI need a meaningful gradation, so spread the budget non-linearly:
  //   Low    1k  — quick, single-pass reasoning
  //   Medium 4k  — balanced (default)
  //   High   16k — deep reasoning, multi-step planning
  const effortBudget: Record<ReasoningEffort, number> = {
    low: 1024,
    medium: 4096,
    high: 16384,
  };

  return effortBudget[settings.thinking.effort] ?? effortBudget.medium;
}

function applyReasoningToRequestBody(settings: ProviderSettings, body: Record<string, unknown>) {
  const provider = getModelProvider(settings.provider);
  const model = typeof body.model === "string" ? body.model : settings.model;

  if (!settings.thinking.enabled || !supportsProviderThinking(settings.provider, settings.thinking.effort, model)) {
    // Hidden helper calls should not force-disable reasoning on models where the endpoint requires it.
    if (provider.reasoningMode === "openrouter") {
      body.reasoning = {
        exclude: true,
      };
    }

    if (provider.reasoningMode === "groq-reasoning" && model.toLowerCase().includes("gpt-oss")) {
      body.include_reasoning = false;
    }

    if (provider.reasoningMode === "deepseek-thinking") {
      body.thinking = {
        type: "disabled",
      };
    }

    return;
  }

  if (provider.reasoningMode === "anthropic-thinking" || provider.reasoningMode === "local-responses") {
    return;
  }

  if (provider.reasoningMode === "openrouter") {
    body.reasoning = {
      effort: mapReasoningEffort(settings.provider, settings.thinking.effort),
      exclude: false,
    };
    return;
  }

  if (provider.reasoningMode === "google-thinking") {
    body.extra_body = {
      google: {
        thinking_config: createGoogleThinkingConfig(settings.thinking.effort, model),
      },
    };
    return;
  }

  if (provider.reasoningMode === "groq-reasoning") {
    body.reasoning_effort = mapReasoningEffort(settings.provider, settings.thinking.effort);
    body.include_reasoning = true;
    if (model.toLowerCase().includes("qwen3")) {
      body.reasoning_format = "parsed";
    }
    return;
  }

  if (provider.reasoningMode === "mistral-reasoning") {
    body.reasoning_effort = mapReasoningEffort(settings.provider, settings.thinking.effort);
    return;
  }

  if (provider.reasoningMode === "xai-reasoning") {
    if (model.toLowerCase().includes("multi-agent")) {
      body.reasoning = {
        effort: mapReasoningEffort(settings.provider, settings.thinking.effort),
      };
    } else if (model.toLowerCase().includes("grok-4.3")) {
      body.reasoning_effort = mapReasoningEffort(settings.provider, settings.thinking.effort);
    }
    return;
  }

  if (provider.reasoningMode === "reasoning-effort") {
    body.reasoning_effort = mapReasoningEffort(settings.provider, settings.thinking.effort);
    return;
  }

  if (provider.reasoningMode === "deepseek-thinking") {
    body.reasoning_effort = mapReasoningEffort(settings.provider, settings.thinking.effort);
    body.thinking = { type: "enabled" };
  }
}

function applyResponsesReasoningToRequestBody(settings: ProviderSettings, body: Record<string, unknown>) {
  const model = typeof body.model === "string" ? body.model : settings.model;

  if (!settings.thinking.enabled || !supportsProviderThinking(settings.provider, settings.thinking.effort, model)) {
    return;
  }

  body.reasoning = {
    effort: mapReasoningEffort(settings.provider, settings.thinking.effort),
  };
}

function createGoogleThinkingConfig(effort: ReasoningEffort, model: string) {
  const normalizedModel = model.toLowerCase();
  const includeThoughts = true;

  if (normalizedModel.startsWith("gemini-2.5")) {
    const thinkingBudgets: Record<ReasoningEffort, number> = {
      low: 1024,
      medium: 8192,
      high: 24576,
    };

    return {
      include_thoughts: includeThoughts,
      thinking_budget: thinkingBudgets[effort] ?? thinkingBudgets.medium,
    };
  }

  return {
    include_thoughts: includeThoughts,
    thinking_level: mapGoogleThinkingLevel(effort, normalizedModel),
  };
}

function mapGoogleThinkingLevel(effort: ReasoningEffort, _normalizedModel: string) {
  return effort;
}

function mapReasoningEffort(providerId: ModelProviderId, effort: ReasoningEffort) {
  if (providerId === "deepseek") {
    return effort;
  }

  if (providerId === "mistral") {
    return "high";
  }

  return effort;
}

function createProviderHeaders(providerId: ModelProviderId, apiKey: string, options: { conversationCacheKey?: string } = {}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (providerId === "anthropic") {
    if (apiKey) {
      headers["x-api-key"] = apiKey;
    }
    headers["anthropic-version"] = "2023-06-01";
    headers["anthropic-dangerous-direct-browser-access"] = "true";
    return headers;
  }

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  if (providerId === "openrouter") {
    headers["HTTP-Referer"] = OPENROUTER_APP_REFERER;
    headers["X-OpenRouter-Title"] = OPENROUTER_APP_TITLE;
    headers["X-OpenRouter-Categories"] = OPENROUTER_APP_CATEGORIES;
    headers["X-Title"] = OPENROUTER_APP_TITLE;
  }

  if (providerId === "xai" && options.conversationCacheKey) {
    headers["x-grok-conv-id"] = options.conversationCacheKey;
  }

  return headers;
}

function assertUsableSettings(providerId: ModelProviderId, apiKey: string, model: string) {
  assertProviderApiKey(providerId, apiKey);

  if (!model) {
    throw new Error(`Choose a ${getModelProvider(providerId).label} model before sending a message.`);
  }
}

function assertProviderApiKey(providerId: ModelProviderId, apiKey: string) {
  const provider = getModelProvider(providerId);

  if (provider.requiresApiKey && !apiKey) {
    throw new Error(`Add a ${provider.label} API key in Settings before sending a message.`);
  }
}

function parseProviderStreamLine(providerId: ModelProviderId, line: string, useResponsesApi = false): ProviderStreamDelta | null {
  const trimmedLine = line.trim();

  if (!trimmedLine || trimmedLine.startsWith(":") || !trimmedLine.startsWith("data:")) {
    return null;
  }

  const data = trimmedLine.replace(/^data:\s*/, "");

  if (data === "[DONE]") {
    return null;
  }

  if (useResponsesApi) {
    return parseResponsesStreamData(data, providerId);
  }

  if (providerId === "anthropic") {
    return parseAnthropicStreamData(data);
  }

  return parseOpenAiCompatibleStreamData(data);
}

function parseOpenAiCompatibleStreamData(data: string): ProviderStreamDelta {
  let payload: ProviderStreamChunk;

  try {
    payload = JSON.parse(data) as ProviderStreamChunk;
  } catch {
    throw new Error("The selected provider returned a malformed streaming response.");
  }

  if (payload.error?.message) {
    throw new Error(payload.error.message);
  }

  const choice = payload.choices?.[0];
  const delta = choice?.delta ?? choice?.message;
  const extracted = extractProviderMessageOutput(delta);

  return {
    contentDelta: extracted.content,
    reasoningDelta: mergeReasoningTextParts(extractReasoningText(delta), extracted.reasoning),
    reasoningStateEntries: extractProviderReasoningEntries(delta),
    toolCallDeltas: parseOpenAiCompatibleStreamToolCallDeltas(payload),
    usage: normalizeProviderUsage(payload.usage),
  };
}

function parseResponsesStreamData(data: string, providerId: ModelProviderId): ProviderStreamDelta {
  let payload: ResponsesStreamEvent;

  try {
    payload = JSON.parse(data) as ResponsesStreamEvent;
  } catch {
    throw new Error("The selected provider returned a malformed Responses stream.");
  }

  if (payload.error?.message) {
    throw new Error(payload.error.message);
  }

  const type = payload.type ?? "";
  const isTextDelta = type.includes("output_text.delta") || type.includes("text.delta");
  const isReasoningDelta = type.includes("reasoning") && type.includes("delta");
  const responseSnapshot = payload.response ? extractResponsesOutput(payload.response) : undefined;
  const responseReasoningState = payload.response ? extractResponsesReasoningState(payload.response, providerId) : undefined;
  const toolCallsSnapshot = payload.response ? parseResponsesStreamToolCalls(payload, providerId) : undefined;
  const toolCallDeltas = parseResponsesStreamToolCallDeltas(payload);

  return {
    contentDelta: isTextDelta ? payload.delta ?? payload.text ?? "" : "",
    contentSnapshot: responseSnapshot?.content || undefined,
    reasoningDelta: isReasoningDelta ? payload.delta ?? payload.text ?? "" : "",
    reasoningSnapshot: responseSnapshot?.reasoning || undefined,
    reasoningState: responseReasoningState,
    toolCallDeltas: toolCallDeltas.length > 0 ? toolCallDeltas : undefined,
    toolCallsSnapshot,
    usage: normalizeResponsesUsage(payload.usage ?? payload.response?.usage),
  };
}

function parseAnthropicStreamData(data: string): ProviderStreamDelta {
  let payload: AnthropicStreamChunk;

  try {
    payload = JSON.parse(data) as AnthropicStreamChunk;
  } catch {
    throw new Error("Anthropic returned a malformed streaming response.");
  }

  if (payload.error?.message) {
    throw new Error(payload.error.message);
  }

  const delta = payload.delta;
  const contentDelta = delta?.type === "text_delta" ? delta.text ?? "" : "";
  const reasoningDelta = delta?.type === "thinking_delta" ? delta.thinking ?? "" : "";
  const toolCallDelta = parseAnthropicStreamToolCallDelta(payload);
  const reasoningStateEntries = createAnthropicStreamReasoningEntries(payload);

  return {
    contentDelta,
    reasoningDelta,
    reasoningStateEntries,
    toolCallDeltas: toolCallDelta ? [toolCallDelta] : undefined,
    usage: normalizeAnthropicUsage(payload.usage ?? payload.message?.usage),
  };
}

function shouldUseStreamSnapshot(currentText: string, snapshot: string | undefined) {
  if (!snapshot) {
    return false;
  }

  if (!currentText.trim()) {
    return true;
  }

  return snapshot.length > currentText.length && snapshot.startsWith(currentText);
}

function appendStreamText(currentText: string, nextChunk: string) {
  if (!nextChunk) {
    return currentText;
  }

  if (nextChunk === currentText || currentText.endsWith(nextChunk)) {
    return currentText;
  }

  if (nextChunk.startsWith(currentText)) {
    return nextChunk;
  }

  const maxOverlap = Math.min(currentText.length, nextChunk.length);

  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (currentText.endsWith(nextChunk.slice(0, overlap))) {
      return currentText + nextChunk.slice(overlap);
    }
  }

  return currentText + nextChunk;
}

function applyStreamToolCallDelta(accumulator: Map<number, StreamToolCallAccumulatorEntry>, delta: ProviderStreamDelta) {
  let changed = false;

  for (const snapshotCall of delta.toolCallsSnapshot ?? []) {
    const key = findStreamToolCallAccumulatorKey(accumulator, snapshotCall) ?? accumulator.size;
    const existing = accumulator.get(key);
    accumulator.set(key, {
      argumentsParseError: snapshotCall.argumentsParseError,
      argumentsSnapshot: snapshotCall.arguments,
      argumentsText: typeof snapshotCall.arguments === "string" ? snapshotCall.arguments : JSON.stringify(snapshotCall.arguments ?? {}),
      id: snapshotCall.id ?? existing?.id,
      name: snapshotCall.name ?? existing?.name,
      raw: snapshotCall.raw ?? existing?.raw,
    });
    changed = true;
  }

  for (const toolDelta of delta.toolCallDeltas ?? []) {
    const existing = accumulator.get(toolDelta.index) ?? {
      argumentsText: "",
    };
    accumulator.set(toolDelta.index, {
      argumentsParseError: toolDelta.argumentsParseError ?? existing.argumentsParseError,
      argumentsSnapshot: toolDelta.argumentsSnapshot ?? existing.argumentsSnapshot,
      argumentsText: `${existing.argumentsText}${toolDelta.argumentsDelta ?? ""}`,
      id: toolDelta.id ?? existing.id,
      name: toolDelta.name ?? existing.name,
      raw: mergeStreamToolCallRaw(existing.raw, toolDelta.raw),
    });
    changed = true;
  }

  return changed;
}

function mergeStreamToolCallRaw(existing: unknown, next: unknown, path: string[] = []): unknown {
  if (next === undefined) {
    return existing;
  }
  if (existing === undefined) {
    return next;
  }
  if (
    typeof existing === "string"
    && typeof next === "string"
    && path[path.length - 1] === "arguments"
  ) {
    return `${existing}${next}`;
  }
  if (
    existing === null
    || next === null
    || Array.isArray(existing)
    || Array.isArray(next)
    || typeof existing !== "object"
    || typeof next !== "object"
  ) {
    return next;
  }

  const merged: Record<string, unknown> = { ...(existing as Record<string, unknown>) };
  for (const [key, value] of Object.entries(next as Record<string, unknown>)) {
    merged[key] = mergeStreamToolCallRaw(merged[key], value, [...path, key]);
  }
  return merged;
}

function findStreamToolCallAccumulatorKey(
  accumulator: Map<number, StreamToolCallAccumulatorEntry>,
  call: Pick<ToolCallRequest, "id" | "name">,
) {
  for (const [key, entry] of accumulator.entries()) {
    if (call.id && entry.id === call.id) {
      return key;
    }

    if (!call.id && call.name && entry.name === call.name) {
      return key;
    }
  }

  return undefined;
}

function finalizeStreamToolCalls(provider: ModelProviderId, accumulator: Map<number, StreamToolCallAccumulatorEntry>): ToolCallRequest[] {
  return [...accumulator.entries()].flatMap(([index, entry]) => {
    if (!entry.name) {
      return [];
    }

    const request = createToolCallRequest(
      provider,
      entry.id || `${entry.name}-${index + 1}`,
      entry.name,
      entry.argumentsSnapshot !== undefined ? entry.argumentsSnapshot : entry.argumentsText,
      entry.raw,
    );

    if (!request) {
      return [];
    }

    if (entry.argumentsParseError && !request.argumentsParseError) {
      request.argumentsParseError = entry.argumentsParseError;
    }

    return [request];
  });
}

function formatTimeoutSeconds(timeoutMs: number) {
  return Math.round(timeoutMs / 1000);
}

function nowHighResolutionMs() {
  return typeof globalThis.performance?.now === "function" ? globalThis.performance.now() : Date.now();
}

function elapsedTimingMs(requestStartedMs: number) {
  return Math.max(0, Math.round(nowHighResolutionMs() - requestStartedMs));
}

function markStreamTiming(
  timing: Partial<ChatStreamTiming>,
  requestStartedMs: number,
  mark: "completed" | "firstByte" | "firstProviderEvent" | "firstToken" | "responseStarted",
) {
  const at = new Date().toISOString();
  const elapsedMs = elapsedTimingMs(requestStartedMs);

  switch (mark) {
    case "completed":
      if (!timing.completedAt) {
        timing.completedAt = at;
        timing.totalMs = elapsedMs;
      }
      break;
    case "firstByte":
      if (!timing.firstByteAt) {
        timing.firstByteAt = at;
        timing.timeToFirstByteMs = elapsedMs;
      }
      break;
    case "firstProviderEvent":
      if (!timing.firstProviderEventAt) {
        timing.firstProviderEventAt = at;
        timing.timeToFirstProviderEventMs = elapsedMs;
      }
      break;
    case "firstToken":
      if (!timing.firstTokenAt) {
        timing.firstTokenAt = at;
        timing.timeToFirstTokenMs = elapsedMs;
      }
      break;
    case "responseStarted":
      if (!timing.responseStartedAt) {
        timing.responseStartedAt = at;
        timing.timeToResponseStartMs = elapsedMs;
      }
      break;
  }
}

function createStreamTimingSnapshot(timing: Partial<ChatStreamTiming>, final = false): ChatStreamTiming {
  return {
    completedAt: final ? timing.completedAt : undefined,
    firstByteAt: timing.firstByteAt,
    firstProviderEventAt: timing.firstProviderEventAt,
    firstTokenAt: timing.firstTokenAt,
    firstVisibleTokenAt: timing.firstVisibleTokenAt,
    requestStartedAt: timing.requestStartedAt ?? new Date().toISOString(),
    responseStartedAt: timing.responseStartedAt,
    timeToFirstByteMs: timing.timeToFirstByteMs,
    timeToFirstProviderEventMs: timing.timeToFirstProviderEventMs,
    timeToFirstTokenMs: timing.timeToFirstTokenMs,
    timeToFirstVisibleTokenMs: timing.timeToFirstVisibleTokenMs,
    timeToResponseStartMs: timing.timeToResponseStartMs,
    totalMs: final ? timing.totalMs : undefined,
  };
}

function createReasoningFlushKey(
  reasoningState: ProviderReasoningState | undefined,
  reasoning: string,
  inlineReasoning: string,
) {
  if (!reasoningState) {
    return "";
  }

  return [
    getReasoningStateKey(reasoningState),
    createStreamTextFingerprint(reasoning),
    createStreamTextFingerprint(inlineReasoning),
  ].join(":");
}

function createStreamTextFingerprint(value: string) {
  return `${value.length}:${value.slice(-64)}`;
}

function limitReasoningText(reasoning: string) {
  return reasoning.length > MAX_STREAM_REASONING_CHARS ? reasoning.slice(-MAX_STREAM_REASONING_CHARS) : reasoning;
}

function mergeReasoningStateEntries(existing: ProviderReasoningEntry[], next: ProviderReasoningEntry[] | undefined) {
  if (!next?.length) {
    return existing;
  }

  return [...existing, ...next];
}

function getReasoningStateKey(reasoningState: ProviderReasoningState | undefined) {
  return reasoningState ? `${reasoningState.provider}:${reasoningState.format}:${reasoningState.entries.length}` : "";
}

function createStreamProviderReasoningState(
  provider: ModelProviderId,
  reasoning: string,
  entries: ProviderReasoningEntry[],
  trimmed = false,
) {
  if (provider === "anthropic") {
    const redactedThinkingBlocks = entries
      .filter((entry) => entry.type === "redacted_thinking")
      .map((entry) => entry.value);
    const streamedThinking = entries
      .filter((entry) => entry.type === "thinking_delta")
      .map((entry) => entry.value)
      .filter((value): value is string => typeof value === "string")
      .join("");
    const thinking = streamedThinking || reasoning;
    const signature = entries
      .filter((entry) => entry.type === "signature_delta")
      .map((entry) => entry.value)
      .filter((value): value is string => typeof value === "string")
      .join("");

    const thinkingBlock = thinking || signature
      ? [{
          type: "thinking",
          value: {
            signature: signature || undefined,
            thinking,
            type: "thinking",
          },
        }]
      : [];

    return createProviderReasoningState(provider, "anthropic-thinking", [
      ...redactedThinkingBlocks.map((value) => ({
        type: "redacted_thinking",
        value,
      })),
      ...thinkingBlock,
    ]);
  }

  if (provider === "openrouter") {
    return createProviderReasoningState(provider, "openrouter-reasoning", entries.length > 0 ? entries : [{
      type: "reasoning",
      value: reasoning,
    }]);
  }

  if (provider === "deepseek") {
    return createProviderReasoningState(provider, "deepseek-reasoning", [{
      type: "reasoning_content",
      value: reasoning,
    }]);
  }

  const format = provider === "google" ? "google-thinking" : "provider-effort";
  return createProviderReasoningState(provider, format, [
    ...entries,
    {
      type: trimmed ? "reasoning_trimmed" : "reasoning",
      value: reasoning,
    },
  ]);
}

function normalizeProviderUsage(usage: ProviderUsage | null | undefined): ProviderUsage | undefined {
  if (!usage) {
    return undefined;
  }

  const cacheCreationInputTokens = extractProviderCacheCreationInputTokens(usage);
  const cachedInputTokens = extractProviderCachedInputTokens(usage);
  const promptTokens = normalizeUsageToken(usage.prompt_tokens);
  const completionTokens = normalizeUsageToken(usage.completion_tokens);
  const reasoningTokens = normalizeUsageToken(usage.reasoning_tokens);
  const totalTokens = normalizeUsageToken(usage.total_tokens);

  if (
    cacheCreationInputTokens === undefined &&
    cachedInputTokens === undefined &&
    promptTokens === undefined &&
    completionTokens === undefined &&
    reasoningTokens === undefined &&
    totalTokens === undefined
  ) {
    return undefined;
  }

  return {
    cache_creation_input_tokens: cacheCreationInputTokens,
    cached_input_tokens: cachedInputTokens,
    completion_tokens: completionTokens,
    reasoning_tokens: reasoningTokens,
    prompt_tokens: promptTokens,
    total_tokens: totalTokens,
  };
}

function normalizeResponsesUsage(usage: ResponsesApiResponse["usage"] | undefined): ProviderUsage | undefined {
  const cacheCreationInputTokens = normalizeUsageToken(usage?.input_tokens_details?.cache_write_tokens);
  const cachedInputTokens = normalizeUsageToken(usage?.input_tokens_details?.cached_tokens);
  const promptTokens = normalizeUsageToken(usage?.input_tokens);
  const completionTokens = normalizeUsageToken(usage?.output_tokens);
  const reasoningTokens = normalizeUsageToken(usage?.output_tokens_details?.reasoning_tokens);
  const totalTokens = normalizeUsageToken(usage?.total_tokens) ?? (promptTokens !== undefined && completionTokens !== undefined ? promptTokens + completionTokens : undefined);

  if (
    cacheCreationInputTokens === undefined &&
    cachedInputTokens === undefined &&
    promptTokens === undefined &&
    completionTokens === undefined &&
    reasoningTokens === undefined &&
    totalTokens === undefined
  ) {
    return undefined;
  }

  return {
    cache_creation_input_tokens: cacheCreationInputTokens,
    cached_input_tokens: cachedInputTokens,
    completion_tokens: completionTokens,
    reasoning_tokens: reasoningTokens,
    prompt_tokens: promptTokens,
    total_tokens: totalTokens,
  };
}

function normalizeAnthropicUsage(usage: AnthropicMessageResponse["usage"] | AnthropicStreamChunk["usage"] | undefined): ProviderUsage | undefined {
  const cacheCreationInputTokens = normalizeUsageToken(usage?.cache_creation_input_tokens);
  const cachedInputTokens = normalizeUsageToken(usage?.cache_read_input_tokens);
  const uncachedInputTokens = normalizeUsageToken(usage?.input_tokens);
  const promptTokens = sumUsageTokens(uncachedInputTokens, cacheCreationInputTokens, cachedInputTokens);
  const completionTokens = normalizeUsageToken(usage?.output_tokens);
  const totalTokens = sumUsageTokens(promptTokens, completionTokens);

  if (promptTokens === undefined && completionTokens === undefined && cacheCreationInputTokens === undefined && cachedInputTokens === undefined) {
    return undefined;
  }

  return {
    cache_creation_input_tokens: cacheCreationInputTokens,
    cached_input_tokens: cachedInputTokens,
    completion_tokens: completionTokens,
    prompt_tokens: promptTokens,
    total_tokens: totalTokens,
  };
}

function normalizeUsageToken(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
}

function extractProviderCachedInputTokens(usage: ProviderUsage) {
  return normalizeUsageToken(usage.cached_input_tokens ?? usage.prompt_tokens_details?.cached_tokens);
}

function extractProviderCacheCreationInputTokens(usage: ProviderUsage) {
  return normalizeUsageToken(usage.cache_creation_input_tokens ?? usage.prompt_tokens_details?.cache_write_tokens);
}

function sumUsageTokens(...values: Array<number | undefined>) {
  const normalized = values.filter((value): value is number => value !== undefined);

  if (normalized.length === 0) {
    return undefined;
  }

  return normalized.reduce((total, value) => total + value, 0);
}

function extractProviderMessageOutput(
  message:
    | {
        content?: ProviderContentOutput;
      }
    | undefined,
) {
  const content = message?.content;

  if (typeof content === "string") {
    return separateInlineThinking(content, { final: true });
  }

  if (!Array.isArray(content)) {
    return {
      content: "",
      reasoning: "",
    };
  }

  const textParts: string[] = [];
  const reasoningParts: string[] = [];

  for (const chunk of content) {
    if (chunk.type === "thinking" || chunk.type === "reasoning") {
      reasoningParts.push(extractThinkingChunkText(chunk));
      continue;
    }

    if (chunk.type === "text" || chunk.type === "output_text" || !chunk.type) {
      textParts.push(chunk.text ?? chunk.content ?? "");
    }
  }

  const separatedText = separateInlineThinking(textParts.join(""), { final: true });

  return {
    content: separatedText.content,
    reasoning: [reasoningParts.join(""), separatedText.reasoning].filter(Boolean).join(""),
  };
}

function extractResponsesOutput(payload: ResponsesApiResponse) {
  const textParts: string[] = [];
  const reasoningParts: string[] = [];

  if (payload.output_text) {
    textParts.push(payload.output_text);
  }

  for (const item of payload.output ?? []) {
    if (item.type === "reasoning") {
      reasoningParts.push(...(item.summary ?? []).map((summary) => summary.text ?? ""));
      continue;
    }

    if (item.type === "message" || !item.type) {
      textParts.push(...(item.content ?? []).filter((chunk) => chunk.type === "output_text" || chunk.type === "text" || !chunk.type).map((chunk) => chunk.text ?? ""));
    }
  }

  const separatedText = separateInlineThinking(textParts.join(""), { final: true });

  return {
    content: separatedText.content,
    reasoning: [reasoningParts.join(""), separatedText.reasoning].filter(Boolean).join(""),
  };
}

/**
 * Streaming-aware wrapper around `extractInlineThinking`. Pass `final=true`
 * for completed payloads (non-streaming responses) so any trailing tag-prefix
 * is released rather than buffered.
 */
function separateInlineThinking(value: string, options: { final?: boolean } = {}) {
  const { content, reasoning, pendingPrefix } = extractInlineThinking(value, { final: options.final });
  return { content, reasoning, pendingPrefix };
}

function extractThinkingChunkText(chunk: ProviderContentChunk) {
  if (typeof chunk.thinking === "string") {
    return chunk.thinking;
  }

  if (Array.isArray(chunk.thinking)) {
    return chunk.thinking.map((item) => item.text ?? "").join("");
  }

  return chunk.text ?? chunk.content ?? "";
}

function normalizeProviderModels(payload: ProviderModelsResponse, providerId: ModelProviderId): ProviderModelMetadata[] {
  const seen = new Set<string>();

  return (payload.data ?? []).flatMap((entry) => {
    const rawModelId = normalizeModelId(entry.id ?? entry.name);
    const modelId = providerId === "9router" ? normalizeNineRouterDiscoveredModelId(rawModelId) : rawModelId;

    if (!modelId || seen.has(modelId) || isExpiredModel(entry.expiration_date)) {
      return [];
    }

    seen.add(modelId);

    return [
      {
        capabilities: formatProviderModelCapabilities(entry),
        contextWindowTokens: normalizeModelContextLength(entry.context_length ?? entry.top_provider?.context_length ?? entry.max_context_length ?? entry.max_input_tokens),
        detail: formatProviderModelDetail(entry),
        id: modelId,
        inputModalities: normalizeStringList(entry.architecture?.input_modalities),
        label: normalizeModelId(entry.display_name ?? entry.name),
        maxOutputTokens: normalizeModelContextLength(entry.top_provider?.max_completion_tokens),
        outputModalities: normalizeStringList(entry.architecture?.output_modalities),
        pricing: normalizeProviderModelPricing(entry.pricing, providerId),
        supportedParameters: normalizeStringList(entry.supported_parameters),
        useCase: entry.description ? cleanInlineText(entry.description) : undefined,
      },
    ];
  });
}

function normalizeModelId(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeStringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : undefined;
}

function normalizeProviderModelPricing(pricing: NonNullable<NonNullable<ProviderModelsResponse["data"]>[number]["pricing"]> | undefined, providerId: ModelProviderId): ModelPricing | undefined {
  if (!pricing) {
    return undefined;
  }

  const normalizedPricing: ModelPricing = {
    cacheWriteInputPerMillionTokens: parsePerTokenPrice(pricing.input_cache_write),
    cachedInputPerMillionTokens: parsePerTokenPrice(pricing.input_cache_read),
    imageInputUsd: parseUnitPrice(pricing.image),
    inputPerMillionTokens: parsePerTokenPrice(pricing.prompt),
    internalReasoningPerMillionTokens: parsePerTokenPrice(pricing.internal_reasoning),
    outputPerMillionTokens: parsePerTokenPrice(pricing.completion),
    requestUsd: parseUnitPrice(pricing.request),
    source: providerId === "openrouter" ? "openrouter" : "provider",
    sourceLabel: providerId === "openrouter" ? "OpenRouter live catalog" : `${getModelProvider(providerId).label} live catalog`,
    sourceUrl: providerId === "openrouter" ? "https://openrouter.ai/docs/guides/overview/models" : getModelProvider(providerId).docsUrl,
    updatedAt: "live",
    webSearchUsd: parseUnitPrice(pricing.web_search),
  };

  return Object.values(normalizedPricing).some((value) => typeof value === "number") ? normalizedPricing : undefined;
}

function parsePerTokenPrice(value: string | undefined) {
  const parsed = parseUnitPrice(value);
  return typeof parsed === "number" ? parsed * 1_000_000 : undefined;
}

function parseUnitPrice(value: string | undefined) {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function formatProviderModelCapabilities(entry: NonNullable<ProviderModelsResponse["data"]>[number]) {
  const capabilities = new Set<string>();
  const inputModalities = normalizeStringList(entry.architecture?.input_modalities) ?? [];
  const supportedParameters = normalizeStringList(entry.supported_parameters) ?? [];

  if (inputModalities.some((modality) => modality !== "text")) {
    capabilities.add("Multimodal");
  }

  if (supportedParameters.includes("reasoning") || supportedParameters.includes("include_reasoning")) {
    capabilities.add("Reasoning");
  }

  if (supportedParameters.includes("structured_outputs") || supportedParameters.includes("response_format")) {
    capabilities.add("Structured");
  }

  if (entry.pricing?.prompt === "0" && entry.pricing?.completion === "0") {
    capabilities.add("Free");
  }

  return capabilities.size > 0 ? [...capabilities] : undefined;
}

function formatProviderModelDetail(entry: NonNullable<ProviderModelsResponse["data"]>[number]) {
  const detailParts = [
    entry.owned_by ? `Owned by ${entry.owned_by}.` : "",
    entry.supported_parameters?.includes("reasoning") || entry.supported_parameters?.includes("include_reasoning") ? "Supports reasoning." : "",
    entry.description ? cleanInlineText(entry.description) : "",
  ].filter(Boolean);

  return detailParts.length > 0 ? detailParts.join(" ") : undefined;
}

function isExpiredModel(expirationDate: string | null | undefined) {
  if (!expirationDate) {
    return false;
  }

  const parsed = Date.parse(expirationDate);
  return Number.isFinite(parsed) && parsed < Date.now();
}

function cleanInlineText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeModelContextLength(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : undefined;
}

function extractReasoningText(
  delta:
    | {
        reasoning?: string;
        reasoning_content?: string;
        reasoning_details?: ProviderReasoningDetail[];
        thinking?: string;
      }
    | undefined,
) {
  if (!delta) {
    return "";
  }

  return firstReasoningText(delta.reasoning, delta.reasoning_content, delta.thinking, extractReasoningDetailsText(delta.reasoning_details));
}

function extractProviderMessageReasoningState(
  message:
    | {
        reasoning?: string;
        reasoning_content?: string;
        reasoning_details?: ProviderReasoningDetail[];
        thinking?: string;
      }
    | undefined,
  provider: ModelProviderId,
  inlineThinking = "",
) {
  return createProviderReasoningState(provider, getOpenAiCompatibleReasoningFormat(provider, message), [
    ...extractProviderReasoningEntries(message),
    {
      type: "inline_thinking",
      value: inlineThinking,
    },
  ]);
}

function extractProviderReasoningEntries(
  delta:
    | {
        reasoning?: string;
        reasoning_content?: string;
        reasoning_details?: ProviderReasoningDetail[];
        thinking?: string;
      }
    | undefined,
): ProviderReasoningEntry[] {
  if (!delta) {
    return [];
  }

  const entries: ProviderReasoningEntry[] = [];

  if (Array.isArray(delta.reasoning_details) && delta.reasoning_details.length > 0) {
    entries.push({
      type: "reasoning_details",
      value: delta.reasoning_details,
    });
  }

  if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
    entries.push({
      type: "reasoning_content",
      value: delta.reasoning_content,
    });
  }

  if (typeof delta.reasoning === "string" && delta.reasoning) {
    entries.push({
      type: "reasoning",
      value: delta.reasoning,
    });
  }

  if (typeof delta.thinking === "string" && delta.thinking) {
    entries.push({
      type: "thinking",
      value: delta.thinking,
    });
  }

  return entries;
}

function getOpenAiCompatibleReasoningFormat(
  provider: ModelProviderId,
  message:
    | {
        reasoning_content?: string;
        reasoning_details?: ProviderReasoningDetail[];
      }
    | undefined,
) {
  if (provider === "openrouter" || message?.reasoning_details?.length) {
    return "openrouter-reasoning" as const;
  }

  if (provider === "deepseek" || message?.reasoning_content) {
    return "deepseek-reasoning" as const;
  }

  if (provider === "google") {
    return "google-thinking" as const;
  }

  return "provider-effort" as const;
}

function extractResponsesReasoningState(payload: ResponsesApiResponse, provider: ModelProviderId) {
  const entries = (payload.output ?? []).flatMap((item): ProviderReasoningEntry[] => {
    if (item.type !== "reasoning") {
      return [];
    }

    return [{
      id: item.id,
      type: "reasoning",
      value: item,
    }];
  });

  return createProviderReasoningState(provider, "openai-responses", entries);
}

function extractAnthropicReasoningState(payload: AnthropicMessageResponse, provider: ModelProviderId) {
  const entries = (payload.content ?? []).flatMap((block): ProviderReasoningEntry[] => {
    if (block.type !== "thinking" && block.type !== "redacted_thinking") {
      return [];
    }

    return [{
      id: block.id,
      type: block.type,
      value: block,
    }];
  });

  return createProviderReasoningState(provider, "anthropic-thinking", entries);
}

function createAnthropicStreamReasoningEntries(payload: AnthropicStreamChunk): ProviderReasoningEntry[] {
  const entries: ProviderReasoningEntry[] = [];

  if (payload.content_block?.type === "thinking" || payload.content_block?.type === "redacted_thinking") {
    entries.push({
      id: payload.content_block.id,
      type: payload.content_block.type,
      value: payload.content_block,
    });
  }

  if (payload.delta?.type === "thinking_delta" && payload.delta.thinking) {
    entries.push({
      type: "thinking_delta",
      value: payload.delta.thinking,
    });
  }

  if (payload.delta?.type === "signature_delta" && payload.delta.signature) {
    entries.push({
      type: "signature_delta",
      value: payload.delta.signature,
    });
  }

  return entries;
}

function extractReasoningDetailsText(details: ProviderReasoningDetail[] | undefined) {
  if (!Array.isArray(details) || details.length === 0) {
    return "";
  }

  return details
    .map((detail) => {
      if (typeof detail.text === "string") {
        return detail.text;
      }

      if (typeof detail.summary === "string") {
        return detail.summary;
      }

      return "";
    })
    .join("");
}

function firstReasoningText(...parts: Array<string | undefined>) {
  return parts.find((part) => typeof part === "string" && part.length > 0) ?? "";
}

function mergeReasoningTextParts(...parts: string[]) {
  return parts.reduce((merged, part) => {
    if (!part) {
      return merged;
    }

    if (!merged) {
      return part;
    }

    if (merged.endsWith(part) || part === merged) {
      return merged;
    }

    if (part.startsWith(merged)) {
      return part;
    }

    return merged + part;
  }, "");
}

function extractAnthropicText(payload: AnthropicMessageResponse) {
  return (payload.content ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("");
}

function parseDataUrl(dataUrl: string) {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl);

  if (!match) {
    return null;
  }

  return {
    data: match[2],
    mediaType: match[1],
  };
}

function joinUrl(baseUrl: string, path: string) {
  const normalizedBase = baseUrl.trim().replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  return `${normalizedBase}${normalizedPath}`;
}

async function readJson(response: Response) {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}
