import { describe, expect, it } from "vitest";

import {
  ProviderRequestError,
  createProviderRequestError,
  formatProviderErrorForUser,
  isRetryableProviderError,
  type ProviderRequestErrorKind,
} from "./providerErrors";

describe("provider error normalization", () => {
  it.each([
    {
      contains: "Capacity for this mode is exhausted right now.",
      kind: "capacity",
      message: "You have exhausted your capacity on this mode",
      retryable: true,
      status: 429,
    },
    {
      contains: "OpenRouter (deepseek/deepseek-v4:free) is rate limiting requests right now.",
      kind: "rate_limit",
      message: "Rate limit exceeded for requests per minute",
      model: "deepseek/deepseek-v4:free",
      providerLabel: "OpenRouter",
      retryable: true,
      status: 429,
    },
    {
      contains: "account quota, credits, or billing limit is exhausted",
      kind: "quota",
      message: "insufficient_quota: credits exhausted",
      providerLabel: "OpenAI",
      retryable: false,
      status: 402,
    },
    {
      contains: "OpenAI rejected the API key or sign-in.",
      kind: "authentication",
      message: "Invalid API key provided",
      providerLabel: "OpenAI",
      retryable: false,
      status: 401,
    },
    {
      contains: "is not allowed for this account",
      kind: "permission",
      message: "This account does not have access to the requested model",
      model: "claude-opus",
      providerLabel: "Anthropic",
      retryable: false,
      status: 403,
    },
    {
      contains: "gpt-missing is not available on OpenAI right now.",
      kind: "model_unavailable",
      message: "model_not_found",
      model: "gpt-missing",
      providerLabel: "OpenAI",
      retryable: false,
      status: 404,
    },
    {
      contains: "This request is too large for claude-sonnet.",
      kind: "context_length",
      message: "maximum context length exceeded",
      model: "claude-sonnet",
      providerLabel: "Anthropic",
      retryable: true,
      status: 400,
    },
    {
      contains: "rejected the request format",
      kind: "invalid_request",
      message: "unsupported parameter: response_format",
      providerLabel: "Groq",
      retryable: false,
      status: 422,
    },
    {
      contains: "could not be reached",
      kind: "network",
      message: "Failed to fetch",
      providerLabel: "LM Studio",
      retryable: true,
    },
    {
      contains: "temporary service issue",
      kind: "server",
      message: "internal server error",
      providerLabel: "OpenRouter",
      retryable: true,
      status: 503,
    },
  ] satisfies Array<{
    contains: string;
    kind: ProviderRequestErrorKind;
    message: string;
    model?: string;
    providerLabel?: string;
    retryable: boolean;
    status?: number;
  }>)("classifies $kind errors", ({ contains, kind, message, model, providerLabel, retryable, status }) => {
    const error = createProviderRequestError({
      message,
      model,
      providerLabel,
      status,
    });

    expect(error).toBeInstanceOf(ProviderRequestError);
    expect(error.kind).toBe(kind);
    expect(error.retryable).toBe(retryable);
    expect(error.message).toContain(contains);
    expect(isRetryableProviderError(error)).toBe(retryable);
  });

  it("keeps provider details and retry-after timing visible without making raw JSON the main message", () => {
    const error = createProviderRequestError({
      code: "rate_limit_exceeded",
      message: "Rate limit exceeded for tokens per minute",
      model: "openai/gpt-oss-120b:free",
      providerLabel: "OpenRouter",
      retryAfterSeconds: 90,
      status: 429,
      type: "rate_limit_error",
    });

    expect(error.message).toContain("Retry after about 2 minutes.");
    expect(error.message).toContain("Provider details (HTTP 429, code: rate_limit_exceeded, type: rate_limit_error)");
  });

  it("formats raw capacity errors from non-provider boundaries for chat display", () => {
    expect(formatProviderErrorForUser(new Error("You have exhausted your capacity on this mode"))).toContain(
      "Capacity for this mode is exhausted right now.",
    );
  });
});
