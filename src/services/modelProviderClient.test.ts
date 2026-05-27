import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultProviderSettings } from "../lib/appStorage";
import {
  DEEPSEEK_V4_FLASH_FREE_MODEL,
  IMAGE_REASONING_MODEL,
  LAGUNA_M1_FREE_MODEL,
  MINIMAX_M25_FREE_MODEL,
  MODEL_PROVIDERS,
  NEMOTRON_3_SUPER_MODEL,
  NINE_ROUTER_ALWAYS_FREE_MODEL,
  NINE_ROUTER_CODEX_EXTENDED_CONTEXT_TOKENS,
  NINE_ROUTER_CODEX_STANDARD_CONTEXT_TOKENS,
  OPENROUTER_FREE_AUTO_MODEL,
} from "../lib/models";
import type { ChatMessage } from "../types/chat";
import type { ProviderSettings, ReasoningEffort } from "../types/settings";
import type { ToolDefinition } from "../toolBridge/types";
import { createProviderRequestBody, fetchProviderModelContextLengths, fetchProviderModels, sendProviderMessage, streamProviderMessage } from "./modelProviderClient";

const TITLE_STRUCTURED_OUTPUT = {
  description: "A concise generated title for a chat conversation.",
  name: "chat_title",
  schema: {
    additionalProperties: false,
    properties: {
      title: {
        type: "string",
      },
    },
    required: ["title"],
    type: "object",
  },
  strict: true,
};

function createSettings(): ProviderSettings {
  return {
    ...defaultProviderSettings,
    apiKeys: {
      ...defaultProviderSettings.apiKeys,
      openai: "test-key",
    },
    model: "gpt-test",
    provider: "openai",
    thinking: {
      effort: "low",
      enabled: false,
    },
  };
}

function createOpenRouterSettings(): ProviderSettings {
  return {
    ...createSettings(),
    apiKeys: {
      ...defaultProviderSettings.apiKeys,
      openrouter: "openrouter-test-key",
    },
    model: "openai/gpt-oss-120b:free",
    provider: "openrouter",
  };
}

function withThinking(settings: ProviderSettings, effort: ReasoningEffort = "medium"): ProviderSettings {
  return {
    ...settings,
    thinking: {
      effort,
      enabled: true,
    },
  };
}

function createMessage(): ChatMessage {
  return {
    content: "write a file",
    createdAt: new Date(0).toISOString(),
    id: "message-1",
    role: "user",
  };
}

function createImageMessage(): ChatMessage {
  return {
    ...createMessage(),
    attachments: [{
      createdAt: new Date(0).toISOString(),
      dataUrl: "data:image/png;base64,aW1hZ2U=",
      id: "image-1",
      kind: "image",
      mimeType: "image/png",
      name: "screenshot.png",
      size: 128,
    }],
    content: "What is in this screenshot?",
  };
}

function providerTool(id: string, family: NonNullable<ToolDefinition["executorMetadata"]>["family"] = "files"): ToolDefinition {
  return {
    description: `${id} test tool`,
    execute: () => ({ content: "ok", ok: true }),
    executorMetadata: { family, version: 1 },
    id,
    inputSchema: {
      additionalProperties: false,
      properties: {},
      type: "object",
    },
    permission: family === "terminal" ? "terminal" : "read-only",
    risk: family === "terminal" ? "terminal" : "read",
    title: id,
  };
}

function streamResponse(lines: string[]) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      lines.forEach((line) => {
        controller.enqueue(encoder.encode(`${line}\n\n`));
      });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream" },
    status: 200,
  });
}

function openAiToolCallChunk(argumentsDelta: string, options: { id?: string; name?: string } = {}) {
  return `data: ${JSON.stringify({
    choices: [{
      delta: {
        tool_calls: [{
          function: {
            arguments: argumentsDelta,
            name: options.name,
          },
          id: options.id,
          index: 0,
          type: "function",
        }],
      },
    }],
  })}`;
}

describe("provider context surface budget", () => {
  it("adds a stable OpenAI prompt cache key that ignores changing user message text", () => {
    const firstBody = createProviderRequestBody(
      createSettings(),
      [createMessage()],
      undefined,
      false,
    ) as Record<string, unknown>;
    const secondBody = createProviderRequestBody(
      createSettings(),
      [{
        ...createMessage(),
        content: "summarize the latest test failures",
        id: "message-2",
      }],
      undefined,
      false,
    ) as Record<string, unknown>;

    expect(firstBody.prompt_cache_key).toMatch(/^gc-/);
    expect(secondBody.prompt_cache_key).toBe(firstBody.prompt_cache_key);
  });

  it("keeps OpenAI cache keys stable across turns but changes them when the visible tool manifest changes", () => {
    const terminalTool = providerTool("terminal_run", "terminal");
    const firstBody = createProviderRequestBody(
      createSettings(),
      [createMessage()],
      undefined,
      false,
      { tools: [terminalTool] },
    ) as Record<string, unknown>;
    const followupBody = createProviderRequestBody(
      createSettings(),
      [{
        ...createMessage(),
        content: "now inspect the test output",
        id: "message-2",
      }],
      undefined,
      false,
      { tools: [terminalTool] },
    ) as Record<string, unknown>;
    const changedToolsBody = createProviderRequestBody(
      createSettings(),
      [createMessage()],
      undefined,
      false,
      { tools: [terminalTool, providerTool("files_read")] },
    ) as Record<string, unknown>;

    expect(followupBody.prompt_cache_key).toBe(firstBody.prompt_cache_key);
    expect(changedToolsBody.prompt_cache_key).not.toBe(firstBody.prompt_cache_key);
  });

  it("adds a stable xAI conversation cache header for Chat Completions requests", async () => {
    let requestInit: RequestInit | undefined;

    vi.stubGlobal("fetch", async (_url: RequestInfo | URL, init?: RequestInit) => {
      requestInit = init;

      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: "cached route",
          },
        }],
        usage: {
          completion_tokens: 1,
          prompt_tokens: 10,
          prompt_tokens_details: {
            cached_tokens: 8,
          },
          total_tokens: 11,
        },
      }), { status: 200 });
    });

    try {
      const response = await sendProviderMessage({
        ...createSettings(),
        apiKeys: {
          ...defaultProviderSettings.apiKeys,
          xai: "xai-test-key",
        },
        model: "grok-4.3",
        provider: "xai",
      }, [createMessage()]);
      const headers = requestInit?.headers as Record<string, string> | undefined;

      expect(headers?.["x-grok-conv-id"]).toMatch(/^gc-/);
      expect(response.usage).toMatchObject({
        cached_input_tokens: 8,
        prompt_tokens: 10,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("uses the active context window when serializing saved tool output", () => {
    const toolMessage: ChatMessage = {
      content: "tool result",
      createdAt: new Date(0).toISOString(),
      id: "message-tool",
      role: "assistant",
      toolCalls: [{
        id: "tool-1",
        label: "Read workspace file",
        output: "x".repeat(300_000),
        status: "complete",
      }],
    };
    const smallBody = createProviderRequestBody(createOpenRouterSettings(), [toolMessage], undefined, true, undefined, 16_000) as { messages: Array<{ content: string }> };
    const largeBody = createProviderRequestBody(createOpenRouterSettings(), [toolMessage], undefined, true, undefined, 1_000_000) as { messages: Array<{ content: string }> };

    expect(smallBody.messages[1].content).toContain("Tool output replay excerpt ended");
    expect(largeBody.messages[1].content).not.toContain("Tool output replay excerpt ended");
    expect(largeBody.messages[1].content.length).toBeGreaterThan(smallBody.messages[1].content.length * 3);
  });

  it("clamps max output against the active provider context window before sending", () => {
    const body = createProviderRequestBody(
      {
        ...createSettings(),
        maxTokens: 8_192,
      },
      [createMessage()],
      undefined,
      true,
      undefined,
      6_000,
    ) as Record<string, unknown>;

    expect(body.max_completion_tokens).toBeLessThan(8_192);
    expect(body.max_completion_tokens).toBeGreaterThanOrEqual(256);
  });

  it("honors manual per-model max output overrides before provider fallbacks", () => {
    const body = createProviderRequestBody(
      {
        ...createSettings(),
        maxTokens: 8_192,
        modelBudgetOverrides: {
          openai: {
            "gpt-test": {
              maxOutputTokens: 1_024,
            },
          },
        },
      },
      [createMessage()],
      undefined,
      true,
      undefined,
      128_000,
    ) as Record<string, unknown>;

    expect(body.max_completion_tokens).toBe(1_024);
  });
});

describe("provider structured output request bodies", () => {
  it("applies JSON schema response_format for OpenAI-compatible chat requests", () => {
    const body = createProviderRequestBody(
      createSettings(),
      [createMessage()],
      undefined,
      false,
      undefined,
      undefined,
      TITLE_STRUCTURED_OUTPUT,
    ) as Record<string, unknown>;

    expect(body.response_format).toEqual({
      json_schema: {
        description: TITLE_STRUCTURED_OUTPUT.description,
        name: "chat_title",
        schema: TITLE_STRUCTURED_OUTPUT.schema,
        strict: true,
      },
      type: "json_schema",
    });
    expect(body.max_completion_tokens).toBe(createSettings().maxTokens);
    expect(body.max_tokens).toBeUndefined();
  });

  it("applies text.format for OpenAI Responses requests", () => {
    const body = createProviderRequestBody(
      withThinking(createSettings()),
      [createMessage()],
      undefined,
      false,
      undefined,
      undefined,
      TITLE_STRUCTURED_OUTPUT,
    ) as Record<string, unknown>;

    expect(body.text).toEqual({
      format: {
        description: TITLE_STRUCTURED_OUTPUT.description,
        name: "chat_title",
        schema: TITLE_STRUCTURED_OUTPUT.schema,
        strict: true,
        type: "json_schema",
      },
    });
    expect(body.response_format).toBeUndefined();
    expect(body.max_output_tokens).toBe(20_480);
  });

  it("applies output_config.format for Anthropic Messages requests", () => {
    const body = createProviderRequestBody(
      {
        ...createSettings(),
        apiKeys: {
          ...defaultProviderSettings.apiKeys,
          anthropic: "anthropic-test-key",
        },
        model: "claude-sonnet-4-6",
        provider: "anthropic",
      },
      [createMessage()],
      undefined,
      false,
      undefined,
      undefined,
      TITLE_STRUCTURED_OUTPUT,
    ) as Record<string, unknown>;

    expect(body.output_config).toEqual({
      format: {
        schema: TITLE_STRUCTURED_OUTPUT.schema,
        type: "json_schema",
      },
    });
    expect(body.response_format).toBeUndefined();
    expect(body.max_tokens).toBe(createSettings().maxTokens);
  });

  it("marks the stable Anthropic system prompt block as cacheable", () => {
    const body = createProviderRequestBody(
      {
        ...createSettings(),
        apiKeys: {
          ...defaultProviderSettings.apiKeys,
          anthropic: "anthropic-test-key",
        },
        model: "claude-sonnet-4-6",
        provider: "anthropic",
      },
      [createMessage()],
      undefined,
      false,
    ) as Record<string, unknown>;
    const system = body.system as Array<{ cache_control?: unknown; text?: string; type?: string }>;

    expect(Array.isArray(system)).toBe(true);
    expect(system[0]).toMatchObject({
      cache_control: { type: "ephemeral" },
      type: "text",
    });
    expect(system[0]?.text).toContain("# Gilbert Codex Core");
    expect(system[1]?.text).toContain("# Current Runtime Context");
  });

  it("keeps title helper request bodies valid across every configured provider", () => {
    for (const provider of MODEL_PROVIDERS) {
      const model = `${provider.id}-title-model`;
      const body = createProviderRequestBody(
        {
          ...defaultProviderSettings,
          apiKeys: {
            ...defaultProviderSettings.apiKeys,
            [provider.id]: "test-key",
          },
          maxTokens: 48,
          model,
          provider: provider.id,
          thinking: {
            effort: "low",
            enabled: false,
          },
        },
        [createMessage()],
        model,
        false,
        undefined,
        undefined,
        TITLE_STRUCTURED_OUTPUT,
      ) as Record<string, unknown>;

      expect(body.model).toBe(model);
      if (provider.apiStyle === "anthropic-messages") {
        expect(body.output_config).toBeTruthy();
        expect(body.max_tokens).toBe(48);
      } else {
        expect(body.response_format).toBeTruthy();
        if (provider.id === "openai" || provider.id === "openrouter" || provider.id === "groq") {
          expect(body.max_completion_tokens).toBe(48);
          expect(body.max_tokens).toBeUndefined();
        } else {
          expect(body.max_tokens).toBe(48);
          expect(body.max_completion_tokens).toBeUndefined();
        }
      }
    }
  });
});

describe("subscription route request errors", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function createNineRouterSettings(model: string): ProviderSettings {
    return {
      ...defaultProviderSettings,
      model,
      provider: "9router",
      thinking: {
        effort: "low",
        enabled: false,
      },
    };
  }

  it("explains provider-credential failures from subscription routing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({
        error: {
          code: "model_not_found",
          message: "No active credentials for provider: codex",
          type: "invalid_request_error",
        },
      }),
      {
        headers: { "content-type": "application/json" },
        status: 404,
      },
    )));

    await expect(sendProviderMessage(createNineRouterSettings("cx/gpt-5.5"), [createMessage()])).rejects.toThrow(
      "Subscription routing is running, but Codex is not connected for cx/gpt-5.5.",
    );
  });

  it("turns bare local fetch failures into a subscription startup hint", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));

    await expect(sendProviderMessage(createNineRouterSettings("cx/gpt-5.5"), [createMessage()])).rejects.toThrow(
      "Could not reach subscriptions. Open Subscriptions, then retry.",
    );
  });

  it("filters stale GitHub Copilot routes from the 9Router live catalog", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({
        data: [
          { id: "cx/gpt-5.5" },
          { id: "github/gpt-4o" },
          { id: "gh/gpt-4.1" },
          { id: "gh/gpt-5-mini" },
          { id: "gh/claude-haiku-4.5" },
          { id: "github/gemini-3.1-pro-preview" },
          { id: "gh/gpt-4o-mini" },
          { id: "gh/claude-sonnet-4" },
          { id: "gh/grok-code-fast-1" },
          { id: "gh/gpt-5.4" },
          { id: "gh/oswe-vscode-prime" },
        ],
      }),
      {
        headers: { "content-type": "application/json" },
        status: 200,
      },
    )));

    await expect(fetchProviderModels(createNineRouterSettings("cx/gpt-5.5"))).resolves.toEqual([
      expect.objectContaining({ id: "cx/gpt-5.5" }),
      expect.objectContaining({ id: "gh/gpt-4o" }),
      expect.objectContaining({ id: "gh/gpt-4.1" }),
      expect.objectContaining({ id: "gh/gpt-5-mini" }),
      expect.objectContaining({ id: "gh/claude-haiku-4.5" }),
    ]);
  });

  it("caps live Codex subscription context lengths unless the 1M option is enabled", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({
        data: [
          { context_length: NINE_ROUTER_CODEX_EXTENDED_CONTEXT_TOKENS, id: "cx/gpt-5.5" },
        ],
      }),
      {
        headers: { "content-type": "application/json" },
        status: 200,
      },
    )));

    await expect(fetchProviderModelContextLengths(createNineRouterSettings("cx/gpt-5.5"), ["cx/gpt-5.5"])).resolves.toEqual({
      "cx/gpt-5.5": NINE_ROUTER_CODEX_STANDARD_CONTEXT_TOKENS,
    });
    await expect(fetchProviderModelContextLengths({
      ...createNineRouterSettings("cx/gpt-5.5"),
      subscriptionOptimization: {
        ...defaultProviderSettings.subscriptionOptimization,
        codexContextWindow: "extended",
      },
    }, ["cx/gpt-5.5"])).resolves.toEqual({
      "cx/gpt-5.5": NINE_ROUTER_CODEX_EXTENDED_CONTEXT_TOKENS,
    });
  });

  it("creates the selected Free Auto route before sending through 9Router", async () => {
    const comboBodies: Array<{ kind?: string; models?: string[]; name?: string }> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = (init?.method || "GET").toUpperCase();
      const requestUrl = String(url);

      if (requestUrl.endsWith("/v1/models")) {
        return new Response(JSON.stringify({
          data: [
            { id: "cx/gpt-5.5" },
            { id: "glm/glm-5.1" },
            { id: "oc/deepseek-v4-flash-free" },
          ],
        }), {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      }

      if (requestUrl.endsWith("/api/combos") && method === "GET") {
        return new Response(JSON.stringify({ data: [] }), {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      }

      if (requestUrl.endsWith("/api/combos") && method === "POST") {
        comboBodies.push(JSON.parse(String(init?.body ?? "{}")));
        return new Response(JSON.stringify({ id: NINE_ROUTER_ALWAYS_FREE_MODEL }), {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      }

      if (requestUrl.endsWith("/v1/chat/completions") && method === "POST") {
        const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
        expect(body.model).toBe(NINE_ROUTER_ALWAYS_FREE_MODEL);

        return new Response(JSON.stringify({
          choices: [{ message: { content: "OK", role: "assistant" } }],
        }), {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      }

      throw new Error(`Unexpected request ${method} ${requestUrl}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendProviderMessage(createNineRouterSettings(NINE_ROUTER_ALWAYS_FREE_MODEL), [createMessage()])).resolves.toMatchObject({
      content: "OK",
    });

    expect(comboBodies).toEqual([{
      kind: "fallback",
      models: [
        "oc/big-pickle",
        "oc/nemotron-3-super-free",
        "oc/deepseek-v4-flash-free",
      ],
      name: NINE_ROUTER_ALWAYS_FREE_MODEL,
    }]);
  });

  it("does not block a 9Router response when Free Auto route repair needs dashboard auth", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = (init?.method || "GET").toUpperCase();
      const requestUrl = String(url);

      if (requestUrl.endsWith("/v1/models")) {
        return new Response(JSON.stringify({
          data: [{ id: "oc/deepseek-v4-flash-free" }],
        }), {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      }

      if (requestUrl.endsWith("/api/combos") && method === "GET") {
        return new Response(JSON.stringify({
          error: { message: "Unauthorized" },
        }), {
          headers: { "content-type": "application/json" },
          status: 401,
        });
      }

      if (requestUrl.endsWith("/v1/chat/completions") && method === "POST") {
        const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
        expect(body.model).toBe(NINE_ROUTER_ALWAYS_FREE_MODEL);

        return new Response(JSON.stringify({
          choices: [{ message: { content: "OK after repair miss", role: "assistant" } }],
        }), {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      }

      throw new Error(`Unexpected request ${method} ${requestUrl}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendProviderMessage(createNineRouterSettings(NINE_ROUTER_ALWAYS_FREE_MODEL), [createMessage()])).resolves.toMatchObject({
      content: "OK after repair miss",
    });
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it("normalizes unavailable GitHub Copilot integrator models before sending", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
      expect(body.model).toBe("gh/gpt-5-mini");

      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "OK", role: "assistant" } }],
        }),
        {
          headers: { "content-type": "application/json" },
          status: 200,
        },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendProviderMessage(createNineRouterSettings("gh/gpt-5.4"), [createMessage()])).resolves.toMatchObject({
      content: "OK",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("normalizes streaming unavailable GitHub Copilot integrator models before sending", async () => {
    vi.stubGlobal("window", {
      clearTimeout: globalThis.clearTimeout,
      setTimeout: globalThis.setTimeout,
    });
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
      expect(body.model).toBe("gh/gpt-5-mini");

      return streamResponse([
        `data: ${JSON.stringify({ choices: [{ delta: { content: "OK" } }] })}`,
        "data: [DONE]",
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(streamProviderMessage(createNineRouterSettings("gh/gpt-5.4"), [createMessage()], vi.fn())).resolves.toMatchObject({
      content: "OK",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("streamProviderMessage tool call parsing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves parsed streaming tool-call arguments", async () => {
    vi.stubGlobal("window", {
      clearTimeout: globalThis.clearTimeout,
      setTimeout: globalThis.setTimeout,
    });
    vi.stubGlobal("fetch", vi.fn(async () => streamResponse([
      openAiToolCallChunk("{\"path\":\"index.html\"", { id: "call-write", name: "files_write" }),
      openAiToolCallChunk(",\"content\":\"hello\"}"),
      "data: [DONE]",
    ])));

    const response = await streamProviderMessage(createSettings(), [createMessage()], vi.fn());

    expect(response.toolCalls?.[0]).toMatchObject({
      arguments: { content: "hello", path: "index.html" },
      id: "call-write",
      name: "files_write",
    });
    expect(response.toolCalls?.[0]?.argumentsParseError).toBeUndefined();
  });

  it("preserves streaming JSON parse errors instead of passing raw strings to validation", async () => {
    vi.stubGlobal("window", {
      clearTimeout: globalThis.clearTimeout,
      setTimeout: globalThis.setTimeout,
    });
    vi.stubGlobal("fetch", vi.fn(async () => streamResponse([
      openAiToolCallChunk("{\"path\":\"index.html\",\"content\":\"line 1\",", { id: "call-write", name: "files_write" }),
      "data: [DONE]",
    ])));

    const response = await streamProviderMessage(createSettings(), [createMessage()], vi.fn());

    expect(response.toolCalls?.[0]).toMatchObject({
      arguments: {},
      id: "call-write",
      name: "files_write",
    });
    expect(response.toolCalls?.[0]?.argumentsParseError).toContain("Could not parse tool arguments as JSON");
  });

  it("preserves OpenAI Responses streaming function-call argument deltas", async () => {
    vi.stubGlobal("window", {
      clearTimeout: globalThis.clearTimeout,
      setTimeout: globalThis.setTimeout,
    });
    vi.stubGlobal("fetch", vi.fn(async () => streamResponse([
      `data: ${JSON.stringify({
        item: {
          arguments: "",
          call_id: "call-write",
          id: "fc-write",
          name: "files_write",
          type: "function_call",
        },
        output_index: 0,
        type: "response.output_item.added",
      })}`,
      `data: ${JSON.stringify({
        delta: "{\"path\":\"index.html\"",
        item_id: "fc-write",
        output_index: 0,
        type: "response.function_call_arguments.delta",
      })}`,
      `data: ${JSON.stringify({
        delta: ",\"content\":\"hello\"}",
        item_id: "fc-write",
        output_index: 0,
        type: "response.function_call_arguments.delta",
      })}`,
      `data: ${JSON.stringify({
        arguments: "{\"path\":\"index.html\",\"content\":\"hello\"}",
        item_id: "fc-write",
        name: "files_write",
        output_index: 0,
        type: "response.function_call_arguments.done",
      })}`,
      "data: [DONE]",
    ])));

    const response = await streamProviderMessage(withThinking(createSettings()), [createMessage()], vi.fn());

    expect(response.toolCalls?.[0]).toMatchObject({
      arguments: { content: "hello", path: "index.html" },
      id: "call-write",
      name: "files_write",
    });
    expect(response.toolCalls?.[0]?.argumentsParseError).toBeUndefined();
  });

  it("sends stable Gilbert Codex attribution headers to OpenRouter", async () => {
    vi.stubGlobal("window", {
      clearTimeout: globalThis.clearTimeout,
      setTimeout: globalThis.setTimeout,
    });
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        "HTTP-Referer": "https://github.com/UrbanWafflezz/GilbertCodex",
        "X-OpenRouter-Categories": "programming-app,personal-agent",
        "X-OpenRouter-Title": "Gilbert Codex",
        "X-Title": "Gilbert Codex",
      });

      return streamResponse([
        `data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }] })}`,
        "data: [DONE]",
      ]);
    }));

    const response = await streamProviderMessage(createOpenRouterSettings(), [createMessage()], vi.fn());

    expect(response.content).toBe("ok");
  });

  it("records streaming latency marks through the first visible token", async () => {
    vi.stubGlobal("window", {
      clearTimeout: globalThis.clearTimeout,
      setTimeout: globalThis.setTimeout,
    });
    vi.stubGlobal("fetch", vi.fn(async () => streamResponse([
      `data: ${JSON.stringify({ choices: [{ delta: { content: "hello" } }] })}`,
      "data: [DONE]",
    ])));
    const updates: Array<Parameters<Parameters<typeof streamProviderMessage>[2]>[0]> = [];

    const response = await streamProviderMessage(createSettings(), [createMessage()], (snapshot) => {
      updates.push(snapshot);
    });

    expect(response.content).toBe("hello");
    expect(response.streamTiming?.requestStartedAt).toBeTruthy();
    expect(response.streamTiming?.timeToResponseStartMs).toBeGreaterThanOrEqual(0);
    expect(response.streamTiming?.timeToFirstByteMs).toBeGreaterThanOrEqual(0);
    expect(response.streamTiming?.timeToFirstProviderEventMs).toBeGreaterThanOrEqual(0);
    expect(response.streamTiming?.timeToFirstTokenMs).toBeGreaterThanOrEqual(0);
    expect(response.streamTiming?.totalMs).toBeGreaterThanOrEqual(0);
    expect(updates[updates.length - 1]?.streamTiming?.timeToFirstTokenMs).toBeGreaterThanOrEqual(0);
  });

  it("keeps OpenRouter reasoning details as opaque state and out of response text", async () => {
    vi.stubGlobal("window", {
      clearTimeout: globalThis.clearTimeout,
      setTimeout: globalThis.setTimeout,
    });
    vi.stubGlobal("fetch", vi.fn(async () => streamResponse([
      `data: ${JSON.stringify({
        choices: [{
          delta: {
            content: "done",
            reasoning_details: [{ data: "opaque", type: "reasoning.encrypted" }],
          },
        }],
      })}`,
      "data: [DONE]",
    ])));

    const response = await streamProviderMessage(withThinking(createOpenRouterSettings()), [createMessage()], vi.fn());

    expect(response.content).toBe("done");
    expect((response as { reasoning?: unknown }).reasoning).toBeUndefined();
    expect(response.reasoningState).toMatchObject({
      format: "openrouter-reasoning",
      provider: "openrouter",
    });
    expect(response.reasoningState?.entries[0]?.value).toEqual([{ data: "opaque", type: "reasoning.encrypted" }]);
  });

  it("keeps DeepSeek reasoning_content out of answer text and exposes it as visible reasoning", async () => {
    vi.stubGlobal("window", {
      clearTimeout: globalThis.clearTimeout,
      setTimeout: globalThis.setTimeout,
    });
    vi.stubGlobal("fetch", vi.fn(async () => streamResponse([
      `data: ${JSON.stringify({
        choices: [{
          delta: {
            content: "patched",
            reasoning_content: "private chain",
          },
        }],
      })}`,
      "data: [DONE]",
    ])));

    const response = await streamProviderMessage(withThinking({
      ...createSettings(),
      apiKeys: {
        ...defaultProviderSettings.apiKeys,
        deepseek: "deepseek-key",
      },
      model: "deepseek-v4-flash",
      provider: "deepseek",
    }), [createMessage()], vi.fn());

    expect(response.content).toBe("patched");
    expect(response.reasoningSummary).toBe("private chain");
    expect((response as { reasoning?: unknown }).reasoning).toBeUndefined();
    expect(response.reasoningState).toMatchObject({
      format: "deepseek-reasoning",
      provider: "deepseek",
    });
  });

  it("extracts visible reasoning from structured chat reasoning payloads", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: "done",
          reasoning: {
            summary: [{ text: "safe structured summary" }],
          },
        },
      }],
    }), { status: 200 })));

    const response = await sendProviderMessage(withThinking(createOpenRouterSettings()), [createMessage()]);

    expect(response.content).toBe("done");
    expect(response.reasoningSummary).toBe("safe structured summary");
  });

  it("keeps OpenAI Responses reasoning items as opaque state", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({
        output: [
          {
            encrypted_content: "opaque",
            id: "rs_1",
            summary: [{ text: "safe summary", type: "summary_text" }],
            type: "reasoning",
          },
          {
            content: [{ text: "visible answer", type: "output_text" }],
            type: "message",
          },
        ],
        usage: {
          input_tokens_details: {
            cached_tokens: 1,
          },
          input_tokens: 1,
          output_tokens: 2,
          total_tokens: 3,
        },
      }), { status: 200 })));

    const response = await sendProviderMessage(withThinking(createSettings()), [createMessage()]);

    expect(response.content).toBe("visible answer");
    expect(response.reasoningSummary).toBe("safe summary");
    expect((response as { reasoning?: unknown }).reasoning).toBeUndefined();
    expect(response.reasoningState).toMatchObject({
      entries: [{ id: "rs_1", type: "reasoning" }],
      format: "openai-responses",
      provider: "openai",
    });
    expect(response.usage).toMatchObject({
      cached_input_tokens: 1,
      prompt_tokens: 1,
      total_tokens: 3,
    });
  });

  it("streams OpenAI Responses reasoning summaries into the public summary channel", async () => {
    vi.stubGlobal("window", {
      clearTimeout: globalThis.clearTimeout,
      setTimeout: globalThis.setTimeout,
    });
    vi.stubGlobal("fetch", vi.fn(async () => streamResponse([
      `data: ${JSON.stringify({
        delta: "Compared the tool evidence before choosing the next edit.",
        type: "response.reasoning_summary_text.delta",
      })}`,
      `data: ${JSON.stringify({
        delta: "done",
        type: "response.output_text.delta",
      })}`,
      "data: [DONE]",
    ])));
    const updates: Array<Parameters<Parameters<typeof streamProviderMessage>[2]>[0]> = [];

    const response = await streamProviderMessage(withThinking({
      ...createSettings(),
      model: "gpt-5.5",
    }), [createMessage()], (snapshot) => {
      updates.push(snapshot);
    });

    expect(response.content).toBe("done");
    expect(response.reasoningSummary).toBe("Compared the tool evidence before choosing the next edit.");
    expect(updates.some((snapshot) => snapshot.reasoningSummary?.includes("Compared the tool evidence"))).toBe(true);
  });

  it("captures tagged visible reasoning from the answer stream when providers do not emit native reasoning", async () => {
    vi.stubGlobal("window", {
      clearTimeout: globalThis.clearTimeout,
      setTimeout: globalThis.setTimeout,
    });
    vi.stubGlobal("fetch", vi.fn(async () => streamResponse([
      `data: ${JSON.stringify({ choices: [{ delta: { content: "<reasoning>I am identifying the simplest explanation first.</reasoning>" } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: "A GPU runs many parallel calculations." } }] })}`,
      "data: [DONE]",
    ])));
    const updates: Array<Parameters<Parameters<typeof streamProviderMessage>[2]>[0]> = [];

    const response = await streamProviderMessage(withThinking(createOpenRouterSettings()), [createMessage()], (snapshot) => {
      updates.push(snapshot);
    });

    expect(response.content).toBe("A GPU runs many parallel calculations.");
    expect(response.reasoningSummary).toBe("I am identifying the simplest explanation first.");
    expect(updates.some((snapshot) => snapshot.reasoningSummary?.includes("simplest explanation"))).toBe(true);
  });

  it("streams Responses-style reasoning summaries from subscription routes", async () => {
    vi.stubGlobal("window", {
      clearTimeout: globalThis.clearTimeout,
      setTimeout: globalThis.setTimeout,
    });
    vi.stubGlobal("fetch", vi.fn(async () => streamResponse([
      `data: ${JSON.stringify({
        delta: "Checked the selected route before answering.",
        type: "response.reasoning_summary_text.delta",
      })}`,
      `data: ${JSON.stringify({
        delta: "subscription answer",
        type: "response.output_text.delta",
      })}`,
      "data: [DONE]",
    ])));
    const settings = withThinking({
      ...createSettings(),
      model: "cx/gpt-5.5",
      provider: "9router",
    });

    const response = await streamProviderMessage(settings, [createMessage()], vi.fn());

    expect(response.content).toBe("subscription answer");
    expect(response.reasoningSummary).toBe("Checked the selected route before answering.");
  });

  it("streams OpenRouter reasoning details into the reasoning surface", async () => {
    vi.stubGlobal("window", {
      clearTimeout: globalThis.clearTimeout,
      setTimeout: globalThis.setTimeout,
    });
    vi.stubGlobal("fetch", vi.fn(async () => streamResponse([
      `data: ${JSON.stringify({
        choices: [{
          delta: {
            reasoning_details: [{
              format: "anthropic-claude-v1",
              id: "reasoning-summary-1",
              index: 0,
              summary: "Read the workspace files first, then compare the runtime path before answering.",
              type: "reasoning.summary",
            }],
          },
        }],
      })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: "The tool path is active." } }] })}`,
      "data: [DONE]",
    ])));
    const updates: Array<Parameters<Parameters<typeof streamProviderMessage>[2]>[0]> = [];

    const response = await streamProviderMessage(withThinking(createOpenRouterSettings()), [createMessage()], (snapshot) => {
      updates.push(snapshot);
    });

    expect(response.content).toBe("The tool path is active.");
    expect(response.reasoningSummary).toBe("Read the workspace files first, then compare the runtime path before answering.");
    expect(updates.some((snapshot) => snapshot.reasoningSummary?.includes("workspace files"))).toBe(true);
  });

  it("requests visible reasoning summaries for Codex subscription routes", () => {
    const body = createProviderRequestBody(
      withThinking({
        ...createSettings(),
        model: "cx/gpt-5.5",
        provider: "9router",
      }),
      [createMessage()],
      "cx/gpt-5.5",
      true,
    ) as Record<string, unknown>;

    expect(body.reasoning).toMatchObject({
      exclude: false,
      max_tokens: 16_384,
      summary: "auto",
    });
  });

  it("adds a model-authored reasoning protocol without canned reasoning content", () => {
    const body = createProviderRequestBody(
      withThinking(createOpenRouterSettings()),
      [createMessage()],
      "openai/gpt-oss-120b:free",
      true,
    ) as Record<string, unknown>;
    const messages = body.messages as Array<{ content?: string; role?: string }>;

    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).not.toContain("<reasoning>...</reasoning>");
    expect(messages[0]?.content).not.toContain("Visible Reasoning Surface");
    expect(messages[0]?.content).toContain("begin each assistant turn with one concise model-authored reasoning summary");
    expect(messages[0]?.content).toContain("never use a fixed placeholder");
  });

  it("keeps OpenRouter free routing permissive for explicit DeepSeek free requests", () => {
    const body = createProviderRequestBody(
      {
        ...createOpenRouterSettings(),
        model: DEEPSEEK_V4_FLASH_FREE_MODEL,
      },
      [createMessage()],
      DEEPSEEK_V4_FLASH_FREE_MODEL,
      false,
    ) as Record<string, unknown>;
    const provider = body.provider as Record<string, unknown>;

    expect(body.model).toBe(DEEPSEEK_V4_FLASH_FREE_MODEL);
    expect(body.models).toBeUndefined();
    expect(provider.require_parameters).toBe(false);
    expect(provider.max_price).toEqual({
      completion: 0,
      prompt: 0,
    });
  });

  it("routes OpenRouter auto free through three stable explicit free fallbacks", () => {
    const body = createProviderRequestBody(
      {
        ...createOpenRouterSettings(),
        model: OPENROUTER_FREE_AUTO_MODEL,
      },
      [createMessage()],
      OPENROUTER_FREE_AUTO_MODEL,
      false,
    ) as Record<string, unknown>;
    const provider = body.provider as Record<string, unknown>;

    expect(body.model).toBeUndefined();
    expect(body.models).toEqual([
      LAGUNA_M1_FREE_MODEL,
      NEMOTRON_3_SUPER_MODEL,
      MINIMAX_M25_FREE_MODEL,
    ]);
    expect(body.models).not.toContain(IMAGE_REASONING_MODEL);
    expect(provider.require_parameters).toBe(false);
    expect(provider.max_price).toEqual({
      completion: 0,
      prompt: 0,
    });
  });

  it("uses the OpenRouter media model as a fallback before sending image context to a non-vision model", async () => {
    vi.stubGlobal("window", {
      clearTimeout: globalThis.clearTimeout,
      setTimeout: globalThis.setTimeout,
    });

    const requestBodies: Array<Record<string, unknown>> = [];

    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      requestBodies.push(body);

      if (body.model === IMAGE_REASONING_MODEL) {
        expect(JSON.stringify(body)).toContain("image_url");

        return new Response(JSON.stringify({
          choices: [{
            message: {
              content: "The screenshot shows a settings panel with a connected provider.",
            },
          }],
        }), {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      }

      expect(JSON.stringify(body)).not.toContain("image_url");
      expect(JSON.stringify(body)).toContain("Media analysis");
      expect(JSON.stringify(body)).not.toContain(`Media analysis from ${IMAGE_REASONING_MODEL}`);
      expect(JSON.stringify(body)).toContain("settings panel with a connected provider");

      return streamResponse([
        `data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }] })}`,
        "data: [DONE]",
      ]);
    }));

    const response = await streamProviderMessage(createOpenRouterSettings(), [createImageMessage()], vi.fn());

    expect(response.content).toBe("ok");
    expect(requestBodies).toHaveLength(2);
    expect(requestBodies[0]?.model).toBe(IMAGE_REASONING_MODEL);
    expect(requestBodies[1]?.model).toBe("openai/gpt-oss-120b:free");
  });

  it("keeps image uploads native for direct OpenAI models instead of using media fallback", async () => {
    vi.stubGlobal("window", {
      clearTimeout: globalThis.clearTimeout,
      setTimeout: globalThis.setTimeout,
    });

    const requestBodies: Array<Record<string, unknown>> = [];

    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      requestBodies.push(body);
      expect(body.model).toBe("gpt-5.5");
      expect(JSON.stringify(body)).toContain("image_url");
      expect(JSON.stringify(body)).not.toContain("Media analysis");

      return streamResponse([
        `data: ${JSON.stringify({ choices: [{ delta: { content: "native" } }] })}`,
        "data: [DONE]",
      ]);
    }));

    const response = await streamProviderMessage({
      ...createSettings(),
      model: "gpt-5.5",
    }, [createImageMessage()], vi.fn());

    expect(response.content).toBe("native");
    expect(requestBodies).toHaveLength(1);
  });

  it("keeps image uploads native for Codex subscription routes instead of using media fallback", async () => {
    vi.stubGlobal("window", {
      clearTimeout: globalThis.clearTimeout,
      setTimeout: globalThis.setTimeout,
    });

    const requestBodies: Array<Record<string, unknown>> = [];

    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      requestBodies.push(body);
      expect(body.model).toBe("cx/gpt-5.5");
      expect(JSON.stringify(body)).toContain("image_url");
      expect(JSON.stringify(body)).not.toContain("Media analysis");

      return streamResponse([
        `data: ${JSON.stringify({ choices: [{ delta: { content: "subscription native" } }] })}`,
        "data: [DONE]",
      ]);
    }));

    const response = await streamProviderMessage({
      ...defaultProviderSettings,
      model: "cx/gpt-5.5",
      provider: "9router",
      thinking: {
        effort: "low",
        enabled: false,
      },
    }, [createImageMessage()], vi.fn());

    expect(response.content).toBe("subscription native");
    expect(requestBodies).toHaveLength(1);
  });

  it("serializes native OpenAI Responses image inputs when thinking mode is enabled", () => {
    const body = createProviderRequestBody(withThinking({
      ...createSettings(),
      model: "gpt-5.5",
    }), [createImageMessage()], undefined, false) as Record<string, unknown>;
    const input = body.input as Array<{ content: unknown; role: string }>;
    const content = input[0]?.content;

    expect(body.model).toBe("gpt-5.5");
    expect(Array.isArray(content)).toBe(true);
    expect(content).toContainEqual({
      detail: "auto",
      image_url: "data:image/png;base64,aW1hZ2U=",
      type: "input_image",
    });
    expect(content).toContainEqual(expect.objectContaining({
      text: expect.stringContaining("screenshot.png"),
      type: "input_text",
    }));
  });

  it("serializes video attachments for OpenRouter video-capable models", () => {
    const body = createProviderRequestBody(
      {
        ...createOpenRouterSettings(),
        model: IMAGE_REASONING_MODEL,
      },
      [{
        ...createMessage(),
        attachments: [{
          createdAt: new Date(0).toISOString(),
          dataUrl: "data:video/mp4;base64,dmlkZW8=",
          id: "video-1",
          kind: "video",
          mimeType: "video/mp4",
          name: "demo.mp4",
          size: 256,
        }],
        content: "Describe this video.",
      }],
      IMAGE_REASONING_MODEL,
      false,
    ) as Record<string, unknown>;
    const messages = body.messages as Array<{ content: unknown; role: string }>;
    const content = messages[1]?.content;

    expect(Array.isArray(content)).toBe(true);
    expect(content).toContainEqual({
      type: "video_url",
      videoUrl: {
        url: "data:video/mp4;base64,dmlkZW8=",
      },
    });
  });
});

describe("Anthropic thinking budget mapping", () => {
  function anthropicSettings(effort: ReasoningEffort, enabled = true, model = "claude-sonnet-4-6"): ProviderSettings {
    return {
      ...defaultProviderSettings,
      apiKeys: {
        ...defaultProviderSettings.apiKeys,
        anthropic: "test-key",
      },
      model,
      provider: "anthropic",
      thinking: {
        effort,
        enabled,
      },
    };
  }

  function userMessage(): ChatMessage {
    return {
      content: "hello",
      createdAt: new Date(0).toISOString(),
      id: "m1",
      role: "user",
    };
  }

  it("uses adaptive thinking and output_config effort for current Claude adaptive models", () => {
    const opusBody = createProviderRequestBody(anthropicSettings("high", true, "claude-opus-4-7"), [userMessage()]) as Record<string, unknown>;
    const sonnetBody = createProviderRequestBody(anthropicSettings("medium", true, "claude-sonnet-4-6"), [userMessage()]) as Record<string, unknown>;

    expect(opusBody.thinking).toEqual({ type: "adaptive", display: "summarized" });
    expect(opusBody.output_config).toEqual({ effort: "high" });
    expect(sonnetBody.thinking).toEqual({ type: "adaptive", display: "summarized" });
    expect(sonnetBody.output_config).toEqual({ effort: "medium" });
  });

  it("keeps Anthropic structured output format when adaptive effort also uses output_config", () => {
    const body = createProviderRequestBody(
      anthropicSettings("low", true, "claude-opus-4-7"),
      [userMessage()],
      undefined,
      false,
      undefined,
      undefined,
      TITLE_STRUCTURED_OUTPUT,
    ) as Record<string, unknown>;

    expect(body.thinking).toEqual({ type: "adaptive", display: "summarized" });
    expect(body.output_config).toEqual({
      effort: "low",
      format: {
        schema: TITLE_STRUCTURED_OUTPUT.schema,
        type: "json_schema",
      },
    });
  });

  it("maps Low/Medium/High effort to distinct, increasing budget_tokens for manual-thinking Claude models", () => {
    const lowBody = createProviderRequestBody(anthropicSettings("low", true, "claude-haiku-4-5-20251001"), [userMessage()]) as Record<string, unknown>;
    const medBody = createProviderRequestBody(anthropicSettings("medium", true, "claude-haiku-4-5-20251001"), [userMessage()]) as Record<string, unknown>;
    const highBody = createProviderRequestBody(anthropicSettings("high", true, "claude-haiku-4-5-20251001"), [userMessage()]) as Record<string, unknown>;

    const low = (lowBody.thinking as { budget_tokens: number }).budget_tokens;
    const med = (medBody.thinking as { budget_tokens: number }).budget_tokens;
    const high = (highBody.thinking as { budget_tokens: number }).budget_tokens;

    // Distinct, strictly increasing, Anthropic minimum honored.
    expect(low).toBe(4_096);
    expect(med).toBe(16_384);
    expect(high).toBe(35_000);
  });

  it("omits the thinking parameter entirely when thinking is disabled", () => {
    const body = createProviderRequestBody(anthropicSettings("medium", false), [userMessage()]) as Record<string, unknown>;

    expect(body.thinking).toBeUndefined();
  });

  it("guarantees max_tokens leaves answer room above the thinking budget", () => {
    const body = createProviderRequestBody(anthropicSettings("high", true, "claude-haiku-4-5-20251001"), [userMessage()]) as Record<string, unknown>;
    const budget = (body.thinking as { budget_tokens: number }).budget_tokens;
    const maxTokens = body.max_tokens as number;

    expect(maxTokens).toBeGreaterThanOrEqual(budget + 4_096);
  });

  it("keeps Anthropic thinking blocks as opaque reasoning state without exposing private placeholders", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({
        content: [
          {
            signature: "sig",
            thinking: "private",
            type: "thinking",
          },
          {
            text: "visible",
            type: "text",
          },
        ],
        usage: {
          cache_creation_input_tokens: 50,
          cache_read_input_tokens: 100,
          input_tokens: 1,
          output_tokens: 2,
        },
      }), { status: 200 })));

    const response = await sendProviderMessage(anthropicSettings("medium"), [userMessage()]);

    expect(response.content).toBe("visible");
    expect(response.reasoningSummary).toBeUndefined();
    expect((response as { reasoning?: unknown }).reasoning).toBeUndefined();
    expect(response.reasoningState).toMatchObject({
      format: "anthropic-thinking",
      provider: "anthropic",
    });
    expect(response.usage).toMatchObject({
      cache_creation_input_tokens: 50,
      cached_input_tokens: 100,
      prompt_tokens: 151,
      total_tokens: 153,
    });
  });

  it("carries Anthropic visible thinking blocks as provider reasoning summaries", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({
        content: [
          {
            signature: "sig",
            thinking: "I compared the tool evidence and narrowed the edit surface before answering.",
            type: "thinking",
          },
          {
            text: "visible",
            type: "text",
          },
        ],
      }), { status: 200 })));

    const response = await sendProviderMessage(anthropicSettings("medium"), [userMessage()]);

    expect(response.content).toBe("visible");
    expect(response.reasoningSummary).toBe("I compared the tool evidence and narrowed the edit surface before answering.");
  });
});

describe("provider reasoning request parameters", () => {
  it("preserves selected Low, Medium, and High thinking effort in provider request bodies", () => {
    const efforts: ReasoningEffort[] = ["low", "medium", "high"];
    const openAiBody = createProviderRequestBody(withThinking({
      ...createSettings(),
      model: "gpt-5.5",
    }), [createMessage()], undefined, false) as Record<string, unknown>;
    const openAiEfforts = efforts.map((effort) => {
      const body = createProviderRequestBody(withThinking({
        ...createSettings(),
        model: "gpt-5.5",
      }, effort), [createMessage()], undefined, false) as Record<string, unknown>;

      return (body.reasoning as { effort?: string } | undefined)?.effort;
    });
    const openRouterBudgets = efforts.map((effort) => {
      const body = createProviderRequestBody(withThinking(createOpenRouterSettings(), effort), [createMessage()], undefined, false) as Record<string, unknown>;

      return (body.reasoning as { max_tokens?: number } | undefined)?.max_tokens;
    });
    const googleBudgets = efforts.map((effort) => {
      const body = createProviderRequestBody(withThinking({
        ...createSettings(),
        apiKeys: { ...defaultProviderSettings.apiKeys, google: "google-key" },
        model: "gemini-2.5-pro",
        provider: "google",
      }, effort), [createMessage()], undefined, false) as Record<string, unknown>;
      const extraBody = body.extra_body as { google?: { thinking_config?: { thinking_budget?: number } } } | undefined;

      return extraBody?.google?.thinking_config?.thinking_budget ?? 0;
    });
    const groqEfforts = efforts.map((effort) => {
      const body = createProviderRequestBody(withThinking({
        ...createSettings(),
        apiKeys: { ...defaultProviderSettings.apiKeys, groq: "groq-key" },
        model: "openai/gpt-oss-120b",
        provider: "groq",
      }, effort), [createMessage()], undefined, false) as Record<string, unknown>;

      return body.reasoning_effort;
    });
    const mistralEfforts = efforts.map((effort) => {
      const body = createProviderRequestBody(withThinking({
        ...createSettings(),
        apiKeys: { ...defaultProviderSettings.apiKeys, mistral: "mistral-key" },
        model: "mistral-medium-3.5",
        provider: "mistral",
      }, effort), [createMessage()], undefined, false) as Record<string, unknown>;

      return body.reasoning_effort;
    });
    const deepSeekEfforts = efforts.map((effort) => {
      const body = createProviderRequestBody(withThinking({
        ...createSettings(),
        apiKeys: { ...defaultProviderSettings.apiKeys, deepseek: "deepseek-key" },
        model: "deepseek-v4-pro",
        provider: "deepseek",
      }, effort), [createMessage()], undefined, false) as Record<string, unknown>;

      return body.reasoning_effort;
    });

    expect(openAiBody.reasoning).toMatchObject({
      effort: "medium",
      summary: "auto",
    });
    expect((createProviderRequestBody(withThinking(createOpenRouterSettings()), [createMessage()], undefined, false) as Record<string, unknown>).reasoning).toMatchObject({
      enabled: true,
      exclude: false,
      max_tokens: 16_384,
    });
    expect(openAiEfforts).toEqual(efforts);
    expect(openRouterBudgets).toEqual([4_096, 16_384, 35_000]);
    expect(groqEfforts).toEqual(efforts);
    expect(mistralEfforts).toEqual(efforts);
    expect(deepSeekEfforts).toEqual(efforts);
    expect(googleBudgets[0]).toBeGreaterThan(0);
    expect(googleBudgets[1]).toBeGreaterThan(googleBudgets[0] ?? 0);
    expect(googleBudgets[2]).toBeGreaterThan(googleBudgets[1] ?? 0);
  });

  it("raises total output caps enough for high thinking plus a visible answer", () => {
    const openAiBody = createProviderRequestBody(withThinking({
      ...createSettings(),
      model: "gpt-5.5",
    }, "high"), [createMessage()], undefined, false) as Record<string, unknown>;
    const openRouterBody = createProviderRequestBody(withThinking(createOpenRouterSettings(), "high"), [createMessage()], undefined, false) as Record<string, unknown>;
    const googleBody = createProviderRequestBody(withThinking({
      ...createSettings(),
      apiKeys: { ...defaultProviderSettings.apiKeys, google: "google-key" },
      model: "gemini-2.5-pro",
      provider: "google",
    }, "high"), [createMessage()], undefined, false) as Record<string, unknown>;

    expect(openAiBody.max_output_tokens).toBe(39_096);
    expect(openRouterBody.max_completion_tokens).toBe(39_096);
    expect(googleBody.max_tokens).toBe(36_864);
  });

  it("uses provider-specific documented thinking controls without exposing UI reasoning text", () => {
    const googleBody = createProviderRequestBody(withThinking({
      ...createSettings(),
      apiKeys: { ...defaultProviderSettings.apiKeys, google: "google-key" },
      model: "gemini-2.5-pro",
      provider: "google",
    }), [createMessage()]) as Record<string, unknown>;
    const groqBody = createProviderRequestBody(withThinking({
      ...createSettings(),
      apiKeys: { ...defaultProviderSettings.apiKeys, groq: "groq-key" },
      model: "openai/gpt-oss-120b",
      provider: "groq",
    }), [createMessage()]) as Record<string, unknown>;
    const mistralBody = createProviderRequestBody(withThinking({
      ...createSettings(),
      apiKeys: { ...defaultProviderSettings.apiKeys, mistral: "mistral-key" },
      model: "mistral-medium-3.5",
      provider: "mistral",
    }), [createMessage()]) as Record<string, unknown>;
    const xaiBody = createProviderRequestBody(withThinking({
      ...createSettings(),
      apiKeys: { ...defaultProviderSettings.apiKeys, xai: "xai-key" },
      model: "grok-4.3",
      provider: "xai",
    }), [createMessage()]) as Record<string, unknown>;
    const deepSeekBody = createProviderRequestBody(withThinking({
      ...createSettings(),
      apiKeys: { ...defaultProviderSettings.apiKeys, deepseek: "deepseek-key" },
      model: "deepseek-v4-pro",
      provider: "deepseek",
    }), [createMessage()]) as Record<string, unknown>;
    const disabledDeepSeekBody = createProviderRequestBody({
      ...createSettings(),
      apiKeys: { ...defaultProviderSettings.apiKeys, deepseek: "deepseek-key" },
      model: "deepseek-v4-pro",
      provider: "deepseek",
      thinking: {
        effort: "medium",
        enabled: false,
      },
    }, [createMessage()]) as Record<string, unknown>;

    expect(googleBody.extra_body).toMatchObject({
      google: {
        thinking_config: {
          include_thoughts: true,
        },
      },
    });
    expect(groqBody).toMatchObject({
      include_reasoning: true,
      reasoning_effort: "medium",
    });
    expect(mistralBody).toMatchObject({
      reasoning_effort: "medium",
    });
    expect(xaiBody).toMatchObject({
      reasoning_effort: "medium",
    });
    expect(deepSeekBody).toMatchObject({
      reasoning_effort: "medium",
      thinking: {
        type: "enabled",
      },
    });
    expect(disabledDeepSeekBody).toMatchObject({
      thinking: {
        type: "disabled",
      },
    });
  });
});
