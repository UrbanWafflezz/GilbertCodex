export type ProviderRequestErrorKind =
  | "authentication"
  | "capacity"
  | "context_length"
  | "invalid_request"
  | "model_unavailable"
  | "network"
  | "permission"
  | "provider"
  | "quota"
  | "rate_limit"
  | "server"
  | "timeout"
  | "usage_limit";

export interface ProviderRequestErrorOptions {
  code?: string;
  kind: ProviderRequestErrorKind;
  model?: string;
  providerLabel?: string;
  rawMessage?: string;
  retryable?: boolean;
  retryAfterSeconds?: number;
  status?: number;
  type?: string;
}

export interface ProviderErrorInput {
  code?: string;
  kind?: ProviderRequestErrorKind;
  message?: string;
  model?: string;
  providerLabel?: string;
  retryAfterSeconds?: number;
  status?: number;
  type?: string;
}

export class ProviderRequestError extends Error {
  readonly code?: string;
  readonly kind: ProviderRequestErrorKind;
  readonly model?: string;
  readonly providerLabel?: string;
  readonly rawMessage?: string;
  readonly retryable: boolean;
  readonly retryAfterSeconds?: number;
  readonly status?: number;
  readonly type?: string;

  constructor(message: string, options: ProviderRequestErrorOptions) {
    super(message);
    this.name = "ProviderRequestError";
    this.code = options.code;
    this.kind = options.kind;
    this.model = options.model;
    this.providerLabel = options.providerLabel;
    this.rawMessage = options.rawMessage;
    this.retryable = options.retryable ?? isRetryableProviderErrorKind(options.kind, options.status);
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.status = options.status;
    this.type = options.type;
  }
}

export function createProviderRequestError(input: ProviderErrorInput) {
  const kind = input.kind ?? inferProviderErrorKind(input);
  const retryable = isRetryableProviderErrorKind(kind, input.status);

  return new ProviderRequestError(formatProviderRequestError({
    ...input,
    kind,
    retryable,
  }), {
    code: normalizeOptionalText(input.code),
    kind,
    model: normalizeOptionalText(input.model),
    providerLabel: normalizeOptionalText(input.providerLabel),
    rawMessage: normalizeOptionalText(input.message),
    retryable,
    retryAfterSeconds: normalizeRetryAfterSeconds(input.retryAfterSeconds),
    status: normalizeStatus(input.status),
    type: normalizeOptionalText(input.type),
  });
}

export function formatProviderErrorForUser(error: unknown, fallback = "The provider request failed.") {
  if (error instanceof ProviderRequestError) {
    return error.message || fallback;
  }

  if (error instanceof Error) {
    const message = error.message.trim();

    if (!message) {
      return fallback;
    }

    const inferred = inferProviderErrorKind({ message });
    if (inferred !== "provider") {
      return createProviderRequestError({ kind: inferred, message }).message;
    }

    return message;
  }

  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  return fallback;
}

export function isRetryableProviderError(error: unknown) {
  if (error instanceof ProviderRequestError) {
    return error.retryable;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const inferred = inferProviderErrorKind({ message: error.message });
  return isRetryableProviderErrorKind(inferred);
}

function inferProviderErrorKind(input: ProviderErrorInput): ProviderRequestErrorKind {
  const status = normalizeStatus(input.status);
  const text = [input.code, input.type, input.message].filter(Boolean).join(" ").toLowerCase();

  if (/\b(max(?:imum)? context length|context length|context window|too many tokens|token limit|requested about \d+ tokens|reduce the length|prompt is too long)\b/.test(text) || status === 413) {
    return "context_length";
  }

  if (/\b(exhausted your capacity|capacity.*(?:mode|route|model)|(?:mode|route|model).*capacity|temporarily at capacity|no capacity)\b/.test(text)) {
    return "capacity";
  }

  if (/\b(insufficient_quota|quota|credit|credits|billing|payment required|balance|spend limit|hard limit|monthly limit|exhausted)\b/.test(text) || status === 402) {
    return "quota";
  }

  if (/\b(rate.?limit|too many requests|requests per|tokens per|tpm|rpm|overloaded|throttl(?:e|ed|ing))\b/.test(text) || status === 429) {
    return "rate_limit";
  }

  if (/\b(invalid api key|incorrect api key|missing api key|unauthorized|authentication|auth token|api key)\b/.test(text) || status === 401) {
    return "authentication";
  }

  if (/\b(forbidden|permission|not allowed|not authorized|does not have access|access denied|policy|region)\b/.test(text) || status === 403) {
    return "permission";
  }

  if (/\b(model_not_found|model not found|model .*not found|model .*not available|model .*unavailable|does not exist|not listed|unsupported model|unknown model)\b/.test(text) || status === 404) {
    return "model_unavailable";
  }

  if (/\b(timeout|timed out|etimedout)\b/.test(text) || status === 408 || status === 504) {
    return "timeout";
  }

  if (/\b(fetch failed|failed to fetch|network|connection reset|connection refused|econnreset|could not connect|load failed|request failed)\b/.test(text)) {
    return "network";
  }

  if (status && isServerStatus(status)) {
    return "server";
  }

  if (/\b(invalid_request|bad request|malformed|schema|unsupported parameter|unsupported value|invalid request|invalid json|tool_choice|response_format)\b/.test(text) || status === 400 || status === 422) {
    return "invalid_request";
  }

  return "provider";
}

function formatProviderRequestError(input: ProviderErrorInput & { kind: ProviderRequestErrorKind; retryable: boolean }) {
  const provider = normalizeOptionalText(input.providerLabel) || "The selected provider";
  const model = normalizeOptionalText(input.model);
  const route = model ? `${provider} (${model})` : provider;
  const retryDelay = formatRetryDelay(input.retryAfterSeconds);
  const retryHint = retryDelay ? ` Retry after about ${retryDelay}.` : "";

  let summary: string;
  let action: string;

  switch (input.kind) {
    case "capacity":
      summary = "Capacity for this mode is exhausted right now.";
      action = "Try another mode or model, lower reasoning effort, or retry in a few minutes.";
      break;
    case "rate_limit":
      summary = `${route} is rate limiting requests right now.`;
      action = `Wait a moment before retrying, or switch to another available model or route.${retryHint}`;
      break;
    case "quota":
      summary = `${route} says the account quota, credits, or billing limit is exhausted.`;
      action = "Check billing or credits for that provider, or choose another connected route.";
      break;
    case "usage_limit":
      summary = "This plan limit has been reached.";
      action = "Wait for the usage window to reset, switch to a local model, or choose a higher plan.";
      break;
    case "authentication":
      summary = `${provider} rejected the API key or sign-in.`;
      action = "Reconnect it in Settings, then retry.";
      break;
    case "permission":
      summary = `${route} is not allowed for this account.`;
      action = "Choose a model this account can access, or check provider permissions and region access.";
      break;
    case "model_unavailable":
      summary = `${model || "The selected model"} is not available on ${provider} right now.`;
      action = "Refresh the model list or choose another model.";
      break;
    case "context_length":
      summary = `This request is too large for ${model || "the selected model"}.`;
      action = "Start a new chat, attach less context, run compaction, or choose a larger-context model.";
      break;
    case "invalid_request":
      summary = `${provider} rejected the request format for ${model || "this model"}.`;
      action = "Try turning off tools, media, structured output, or thinking for this model, then retry.";
      break;
    case "timeout":
      summary = `${route} took too long to respond.`;
      action = "Retry, or switch to a faster route if this keeps happening.";
      break;
    case "network":
      summary = `${provider} could not be reached.`;
      action = "Check the connection or local provider runtime, then retry.";
      break;
    case "server":
      summary = `${provider} is having a temporary service issue.`;
      action = `Retry shortly, or switch routes if the provider remains unavailable.${retryHint}`;
      break;
    default:
      summary = `${route} returned an error.`;
      action = "Review the provider details below, then retry or choose another route.";
      break;
  }

  return appendProviderDetails(`${summary}\n\n${action}`, input);
}

function appendProviderDetails(message: string, input: ProviderErrorInput) {
  const detail = sanitizeProviderDetail(input.message);

  if (!detail || message.toLowerCase().includes(detail.toLowerCase())) {
    return message;
  }

  const status = normalizeStatus(input.status);
  const code = normalizeOptionalText(input.code);
  const type = normalizeOptionalText(input.type);
  const metadata = [
    status ? `HTTP ${status}` : "",
    code ? `code: ${code}` : "",
    type ? `type: ${type}` : "",
  ].filter(Boolean).join(", ");

  return `${message}\n\nProvider details${metadata ? ` (${metadata})` : ""}: ${detail}`;
}

function isRetryableProviderErrorKind(kind: ProviderRequestErrorKind, status?: number) {
  if (kind === "capacity" || kind === "context_length" || kind === "rate_limit" || kind === "server" || kind === "timeout" || kind === "network") {
    return true;
  }

  return Boolean(status && (status === 408 || status === 409 || status === 425 || status === 429 || isServerStatus(status)));
}

function isServerStatus(status: number) {
  return (status >= 500 && status <= 599) || (status >= 520 && status <= 524);
}

function formatRetryDelay(seconds: unknown) {
  const value = normalizeRetryAfterSeconds(seconds);

  if (!value) {
    return "";
  }

  if (value < 60) {
    return `${value} second${value === 1 ? "" : "s"}`;
  }

  const minutes = Math.ceil(value / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

function normalizeRetryAfterSeconds(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : NaN;

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return Math.max(1, Math.round(parsed));
}

function normalizeStatus(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : undefined;
}

function normalizeOptionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sanitizeProviderDetail(value: unknown) {
  const text = normalizeOptionalText(value);

  if (!text) {
    return "";
  }

  const singleLine = text.replace(/\s+/g, " ").trim();
  return singleLine.length > 320 ? `${singleLine.slice(0, 317).trim()}...` : singleLine;
}
