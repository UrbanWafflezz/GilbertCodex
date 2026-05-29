import { ensureNineRouterLocal, nineRouterLocalHttp, type NineRouterHttpRequest, type NineRouterHttpResponse, type NineRouterLocalStatus } from "../../../app/tauriClient";
import { joinLocalUrl, NINE_ROUTER_DASHBOARD_FALLBACK } from "../../../services/nineRouterClient";
import {
  getConfiguredNineRouterBaseUrl,
  getConfiguredNineRouterDashboardUrl,
  isConfiguredNineRouterCloudEnabled,
  isNineRouterCloudRequired,
  isNineRouterNativeBridgeUrl,
  withNineRouterCloudAuthHeaders,
} from "../../../services/nineRouterCloud";
import { recordPlanUsage } from "../../../services/planUsageLimiter";
import type { ChatArtifact } from "../../../types/chat";
import type { JsonValue, ToolDefinition, ToolExecutionContext, ToolExecutionResult } from "../../types";

export interface NineRouterImageBackend {
  ensureLocal: () => Promise<NineRouterLocalStatus>;
  http: (request: NineRouterHttpRequest) => Promise<NineRouterHttpResponse>;
}

interface NineRouterImageResponseItem {
  b64_json?: string;
  revised_prompt?: string;
  url?: string;
}

interface NineRouterImageResponse {
  created?: number;
  data?: NineRouterImageResponseItem[];
  error?: string | { message?: string };
}

const DEFAULT_IMAGE_MODEL = "cx/gpt-5.5-image";
const DEFAULT_IMAGE_SIZE = "1024x1024";
const DEFAULT_IMAGE_QUALITY = "auto";
const DEFAULT_IMAGE_OUTPUT_FORMAT = "png";
const DEFAULT_IMAGE_COUNT = 1;
const MAX_IMAGE_COUNT = 4;
const IMAGE_SIZE_VALUES = ["auto", "1024x1024", "1024x1536", "1536x1024"] as const;
const IMAGE_QUALITY_VALUES = ["auto", "low", "medium", "high"] as const;
const IMAGE_OUTPUT_FORMAT_VALUES = ["png", "jpeg", "webp"] as const;
const OPENAI_NATIVE_IMAGE_MODEL_PATTERN = /^(?:gpt-image|dall-e|chatgpt-image)(?:[-\w.]*)$/i;
const SUBSCRIPTION_IMAGE_MODEL_PATTERN = /^cx\/[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/i;

type ImageSize = (typeof IMAGE_SIZE_VALUES)[number];
type ImageQuality = (typeof IMAGE_QUALITY_VALUES)[number];
type ImageOutputFormat = (typeof IMAGE_OUTPUT_FORMAT_VALUES)[number];

export const defaultNineRouterImageBackend: NineRouterImageBackend = {
  ensureLocal: ensureNineRouterImageBackendReady,
  http: nineRouterImageHttp,
};

export function createImageGenerateTool(backend: NineRouterImageBackend = defaultNineRouterImageBackend): ToolDefinition {
  return {
    description:
      "Generate an image through the 9Router subscription router. " +
      "Use this when the user asks to create, generate, draw, render, or produce a visual image, picture, photo, logo, icon, avatar, poster, or illustration. " +
      "Write a specific visual prompt with the subject, style or medium, composition, colors, lighting, text requirements, and constraints. " +
      "Use n/count for up to 4 variations when the user asks for multiple options. The generated images are returned as chat artifacts; do not paste base64 into the visible answer.",
    execute: async (args, context) => executeImageGenerateTool(args, context, backend),
    executorMetadata: { family: "media", version: 1 },
    id: "image_generate",
    inputSchema: {
      additionalProperties: false,
      properties: {
        model: {
          description:
            "Optional 9Router subscription image model. Prefer omitting this field; cx/* chat models are automatically mapped to their -image route. Do not pass OpenAI native image ids such as gpt-image-1.",
          maxLength: 120,
          minLength: 1,
          type: "string",
        },
        count: {
          description: "Number of images to generate, from 1 to 4. Alias for n.",
          maximum: MAX_IMAGE_COUNT,
          minimum: 1,
          type: "integer",
        },
        imageCount: {
          description: "Number of images to generate, from 1 to 4. Alias for n.",
          maximum: MAX_IMAGE_COUNT,
          minimum: 1,
          type: "integer",
        },
        n: {
          description: "Number of images to generate, from 1 to 4.",
          maximum: MAX_IMAGE_COUNT,
          minimum: 1,
          type: "integer",
        },
        outputFormat: {
          description: "Generated image file format.",
          enum: IMAGE_OUTPUT_FORMAT_VALUES,
          type: "string",
        },
        output_format: {
          description: "Alias for outputFormat.",
          enum: IMAGE_OUTPUT_FORMAT_VALUES,
          type: "string",
        },
        prompt: {
          description: "Detailed visual prompt. Preserve the user's intent and include subject, style or medium, composition/framing, colors, lighting, text requirements, and constraints. For batches, ask for distinct variations.",
          maxLength: 4000,
          minLength: 1,
          type: "string",
        },
        quality: {
          description: "Image quality preference. Use low for quick tests, high only when the user asks for high quality.",
          enum: IMAGE_QUALITY_VALUES,
          type: "string",
        },
        size: {
          description: "Image dimensions.",
          enum: IMAGE_SIZE_VALUES,
          type: "string",
        },
      },
      required: ["prompt"],
      type: "object",
    },
    permission: "read-only",
    risk: "network",
    title: "Generate image",
  };
}

export function createMediaTools(backend: NineRouterImageBackend = defaultNineRouterImageBackend): ToolDefinition[] {
  return [
    createImageGenerateTool(backend),
  ];
}

export const mediaTools: ToolDefinition[] = createMediaTools();

async function ensureNineRouterImageBackendReady(): Promise<NineRouterLocalStatus> {
  if (!isNineRouterImageCloudMode()) {
    return ensureNineRouterLocal();
  }

  const baseUrl = getConfiguredNineRouterBaseUrl("");
  if (!baseUrl || isNineRouterNativeBridgeUrl(baseUrl)) {
    throw new Error("Cloud Subscriptions image routing is enabled, but the 9Router cloud URL is not configured.");
  }

  return createCloudNineRouterImageStatus(baseUrl);
}

async function nineRouterImageHttp(request: NineRouterHttpRequest): Promise<NineRouterHttpResponse> {
  if (isNineRouterNativeBridgeUrl(request.url)) {
    return nineRouterLocalHttp(request);
  }

  const controller = new AbortController();
  const timeoutMs = request.timeoutMs ?? 180_000;
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const init = await withNineRouterCloudAuthHeaders(request.url, {
      body: request.body,
      headers: request.headers,
      method: request.method,
    });
    const response = await fetch(request.url, {
      ...init,
      signal: controller.signal,
    });

    return {
      body: await response.text(),
      headers: Object.fromEntries(response.headers.entries()),
      status: response.status,
    };
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(`9Router image generation timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
    }

    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

function isNineRouterImageCloudMode() {
  return isConfiguredNineRouterCloudEnabled() || isNineRouterCloudRequired();
}

function createCloudNineRouterImageStatus(baseUrl: string): NineRouterLocalStatus {
  const dashboardUrl = getConfiguredNineRouterDashboardUrl(stripNineRouterV1Path(baseUrl)) || stripNineRouterV1Path(baseUrl) || baseUrl;

  return {
    autoStartEnabled: true,
    baseUrl,
    built: true,
    dashboardUrl,
    dataDir: null,
    dockerVersion: null,
    gitVersion: null,
    installDir: null,
    installed: true,
    launchSupported: true,
    launched: false,
    message: "Cloud Subscriptions image routing is configured.",
    nodeVersion: null,
    npmVersion: null,
    pid: null,
    running: true,
  };
}

function stripNineRouterV1Path(baseUrl: string) {
  return baseUrl.replace(/\/v1\/?$/i, "");
}

async function executeImageGenerateTool(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
  backend: NineRouterImageBackend,
): Promise<ToolExecutionResult> {
  const prompt = stringArg(args.prompt);

  if (!prompt) {
    return createErrorResult("image_generate requires a non-empty prompt.");
  }

  const model = normalizeImageModel(stringArg(args.model), context);
  const imageCount = integerArg(args.n ?? args.count ?? args.imageCount, DEFAULT_IMAGE_COUNT, MAX_IMAGE_COUNT, DEFAULT_IMAGE_COUNT);
  const size = enumArg<ImageSize>(args.size, IMAGE_SIZE_VALUES, DEFAULT_IMAGE_SIZE);
  const quality = enumArg<ImageQuality>(args.quality, IMAGE_QUALITY_VALUES, DEFAULT_IMAGE_QUALITY);
  const outputFormat = enumArg<ImageOutputFormat>(args.outputFormat ?? args.output_format, IMAGE_OUTPUT_FORMAT_VALUES, DEFAULT_IMAGE_OUTPUT_FORMAT);

  if (args.dryRun === true) {
    return {
      content: `Will generate ${formatImageCount(imageCount)}.`,
      data: createImageToolData({
        artifacts: [],
        imageCount: 0,
        model,
        outputFormat,
        prompt,
        quality,
        requestedImageCount: imageCount,
        size,
        status: "dry-run",
      }),
      ok: true,
    };
  }

  try {
    recordPlanUsage(context.billingPlan, "imageGenerations", imageCount, context.provider);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Image generation is not available on this plan.";
    return {
      content: message,
      data: createImageToolData({
        artifacts: [],
        imageCount: 0,
        model,
        outputFormat,
        prompt,
        quality,
        requestedImageCount: imageCount,
        size,
        status: "error",
      }),
      error: message,
      ok: false,
    };
  }

  try {
    context.reportProgress?.({
      content: `Starting image generation for ${formatImageCount(imageCount)}.`,
      data: createImageToolData({
        artifacts: [],
        imageCount: 0,
        model,
        outputFormat,
        prompt,
        quality,
        requestedImageCount: imageCount,
        size,
        status: "starting",
      }),
      ok: true,
    });

    const localStatus = await backend.ensureLocal();
    const baseUrl = normalizeNineRouterImageBaseUrl(localStatus);
    const response = await backend.http({
      body: JSON.stringify(createImageRequestBody({ imageCount, model, outputFormat, prompt, quality, size })),
      headers: createImageRequestHeaders(context),
      method: "POST",
      timeoutMs: 180_000,
      url: joinLocalUrl(baseUrl, "/images/generations"),
    });
    const payload = parseJsonResponse<NineRouterImageResponse>(response.body);

    if (response.status < 200 || response.status >= 300) {
      const message = formatNineRouterImageError(payload, response.status);
      return {
        content: message,
        data: createImageToolData({
          artifacts: [],
          imageCount: 0,
          model,
          outputFormat,
          prompt,
          quality,
          requestedImageCount: imageCount,
          size,
          status: "error",
        }),
        error: message,
        ok: false,
      };
    }

    const artifacts = createImageArtifacts(payload?.data, {
      model,
      outputFormat,
      prompt,
      quality,
      size,
    });

    if (artifacts.length === 0) {
      const message = "9Router answered but did not return an image payload.";
      return {
        content: message,
        data: createImageToolData({
          artifacts: [],
          imageCount: 0,
          model,
          outputFormat,
          prompt,
          quality,
          requestedImageCount: imageCount,
          size,
          status: "empty",
        }),
        error: message,
        ok: false,
      };
    }

    return {
      content: `Generated ${formatImageCount(artifacts.length)}. ${artifacts.length === 1 ? "It is" : "They are"} attached as image artifact${artifacts.length === 1 ? "" : "s"}.`,
      data: createImageToolData({
        artifacts,
        imageCount: artifacts.length,
        model,
        outputFormat,
        prompt,
        quality,
        requestedImageCount: imageCount,
        size,
        status: "complete",
      }),
      ok: true,
    };
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    const message = formatUnknownImageError(error);
    return {
      content: message,
      data: createImageToolData({
        artifacts: [],
        imageCount: 0,
        model,
        outputFormat,
        prompt,
        quality,
        requestedImageCount: imageCount,
        size,
        status: "error",
      }),
      error: message,
      ok: false,
    };
  }
}

function createImageRequestBody({
  imageCount,
  model,
  outputFormat,
  prompt,
  quality,
  size,
}: {
  imageCount: number;
  model: string;
  outputFormat: ImageOutputFormat;
  prompt: string;
  quality: ImageQuality;
  size: ImageSize;
}): Record<string, JsonValue> {
  const body: Record<string, JsonValue> = {
    model,
    n: imageCount,
    output_format: outputFormat,
    prompt,
    response_format: "b64_json",
    size,
  };

  if (quality !== "auto") {
    body.quality = quality;
  }

  return body;
}

function createImageRequestHeaders(context: ToolExecutionContext) {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  const apiKey = context.provider === "9router" ? context.providerApiKey?.trim() : "";

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  return headers;
}

function createImageArtifacts(
  data: NineRouterImageResponseItem[] | undefined,
  options: {
    model: string;
    outputFormat: ImageOutputFormat;
    prompt: string;
    quality: ImageQuality;
    size: ImageSize;
  },
) {
  if (!Array.isArray(data)) {
    return [];
  }

  return data.flatMap((item, index): ChatArtifact[] => {
    const b64 = typeof item.b64_json === "string" ? item.b64_json.trim() : "";
    const remoteUrl = typeof item.url === "string" ? item.url.trim() : "";

    if (!b64 && !remoteUrl) {
      return [];
    }

    const mimeType = mimeTypeForImageFormat(options.outputFormat);
    const title = createArtifactTitle(options.prompt, index, options.outputFormat);
    const dimensions = imageDimensionsForSize(options.size);

    return [{
      detail: "Generated image",
      height: dimensions?.height,
      id: `9router-image-${Date.now()}-${index + 1}`,
      kind: "image",
      mimeType,
      sizeBytes: b64 ? estimateBase64Bytes(b64) : undefined,
      title,
      url: b64 ? `data:${mimeType};base64,${b64}` : remoteUrl,
      width: dimensions?.width,
    }];
  });
}

function createImageToolData({
  artifacts,
  imageCount,
  model,
  outputFormat,
  prompt,
  quality,
  requestedImageCount,
  size,
  status,
}: {
  artifacts: ChatArtifact[];
  imageCount: number;
  model: string;
  outputFormat: ImageOutputFormat;
  prompt: string;
  quality: ImageQuality;
  requestedImageCount: number;
  size: ImageSize;
  status: string;
}): JsonValue {
  return {
    artifacts: artifacts.map((artifact) => ({
      detail: artifact.detail ?? null,
      id: artifact.id ?? null,
      kind: artifact.kind ?? null,
      height: typeof artifact.height === "number" ? artifact.height : null,
      mimeType: artifact.mimeType ?? null,
      sizeBytes: typeof artifact.sizeBytes === "number" ? artifact.sizeBytes : null,
      sourceFormat: artifact.sourceFormat ?? null,
      sourceText: artifact.sourceText ?? null,
      title: artifact.title,
      url: artifact.url ?? null,
      width: typeof artifact.width === "number" ? artifact.width : null,
    })),
    imageCount,
    model,
    outputFormat,
    prompt,
    provider: "9router",
    quality,
    requestedImageCount,
    size,
    status,
  };
}

function normalizeImageModel(rawModel: string | undefined, context: ToolExecutionContext) {
  const contextModel = context.provider === "9router" ? context.model.trim() : "";
  const requestedModel = rawModel?.trim() ?? "";
  const candidate = isSubscriptionImageModelCandidate(requestedModel)
    ? requestedModel
    : isSubscriptionImageModelCandidate(contextModel)
      ? contextModel
      : DEFAULT_IMAGE_MODEL;

  return candidate.endsWith("-image") ? candidate : `${candidate}-image`;
}

function isSubscriptionImageModelCandidate(model: string) {
  return SUBSCRIPTION_IMAGE_MODEL_PATTERN.test(model) && !OPENAI_NATIVE_IMAGE_MODEL_PATTERN.test(model);
}

function normalizeNineRouterImageBaseUrl(status: NineRouterLocalStatus) {
  const baseUrl = status.baseUrl?.trim() || joinLocalUrl(status.dashboardUrl?.trim() || NINE_ROUTER_DASHBOARD_FALLBACK, "/v1");

  return /\/v1\/?$/i.test(baseUrl) ? baseUrl : joinLocalUrl(baseUrl, "/v1");
}

function parseJsonResponse<T>(body: string): T | null {
  if (!body.trim()) {
    return null;
  }

  try {
    return JSON.parse(body) as T;
  } catch {
    return null;
  }
}

function formatNineRouterImageError(payload: NineRouterImageResponse | null, status: number) {
  const error = payload?.error;
  const detail = typeof error === "string" ? error : error?.message;

  return detail?.trim()
    ? `9Router image generation failed: ${detail.trim()}`
    : `9Router image generation failed with HTTP ${status}.`;
}

function formatUnknownImageError(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  return `9Router image generation failed: ${detail}`;
}

function stringArg(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function integerArg(value: unknown, minimum: number, maximum: number, fallback: number) {
  const parsed = typeof value === "number" && Number.isInteger(value)
    ? value
    : typeof value === "string" && /^[-+]?\d+$/.test(value.trim())
      ? Number(value.trim())
      : fallback;

  return Math.max(minimum, Math.min(maximum, parsed));
}

function enumArg<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : fallback;
}

function imageDimensionsForSize(size: ImageSize) {
  if (size === "auto") {
    return undefined;
  }

  const match = size.match(/^(\d+)x(\d+)$/);
  if (!match) {
    return undefined;
  }

  return {
    height: Number(match[2]),
    width: Number(match[1]),
  };
}

function formatImageCount(count: number) {
  return `${count} image${count === 1 ? "" : "s"}`;
}

function mimeTypeForImageFormat(format: ImageOutputFormat) {
  return format === "jpeg" ? "image/jpeg" : `image/${format}`;
}

function extensionForImageFormat(format: ImageOutputFormat) {
  return format === "jpeg" ? "jpg" : format;
}

function createArtifactTitle(prompt: string, index: number, outputFormat: ImageOutputFormat) {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "generated-image";
  const suffix = index > 0 ? `-${index + 1}` : "";

  return `${slug}${suffix}.${extensionForImageFormat(outputFormat)}`;
}

function estimateBase64Bytes(value: string) {
  const normalized = value.replace(/\s/g, "");
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;

  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function createErrorResult(message: string): ToolExecutionResult {
  return {
    content: message,
    error: message,
    ok: false,
  };
}
