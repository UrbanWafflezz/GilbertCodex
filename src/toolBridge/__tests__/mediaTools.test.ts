import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { executeToolBridgeCalls, ToolRegistry } from "../index";
import { createImageGenerateTool, type NineRouterImageBackend } from "../tools/media";
import type { NineRouterLocalStatus } from "../../app/tauriClient";
import { NINE_ROUTER_FIREBASE_ID_TOKEN_HEADER } from "../../services/nineRouterCloud";
import type { ToolExecutionContext } from "../types";

vi.mock("../../firebase", () => ({
  getGilbertFirebaseAuth: () => ({
    currentUser: {
      getIdToken: vi.fn(async () => "firebase-id-token"),
    },
  }),
}));

const context: ToolExecutionContext = {
  model: "cx/gpt-5.5",
  permissionMode: "default",
  provider: "9router",
};

beforeEach(() => {
  vi.stubEnv("VITE_GILBERT_NINE_ROUTER_BASE_URL", "");
  vi.stubEnv("VITE_GILBERT_NINE_ROUTER_DASHBOARD_URL", "");
  vi.stubEnv("VITE_GILBERT_NINE_ROUTER_MODE", "");
  vi.stubEnv("VITE_GILBERT_REQUIRE_CLOUD_SUBSCRIPTIONS", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function makeStatus(overrides: Partial<NineRouterLocalStatus> = {}): NineRouterLocalStatus {
  return {
    autoStartEnabled: true,
    baseUrl: "http://127.0.0.1:20128/v1",
    built: true,
    dashboardUrl: "http://127.0.0.1:20128",
    dataDir: null,
    dockerVersion: null,
    gitVersion: null,
    installDir: null,
    installed: true,
    launchSupported: true,
    launched: false,
    message: "Running",
    nodeVersion: null,
    npmVersion: null,
    pid: 1234,
    running: true,
    ...overrides,
  };
}

describe("image_generate", () => {
  it("posts to the 9Router image route and returns image artifacts without leaking base64 in content", async () => {
    const backend: NineRouterImageBackend = {
      ensureLocal: vi.fn(async () => makeStatus()),
      http: vi.fn(async () => ({
        body: JSON.stringify({
          data: [
            {
              b64_json: "iVBORw0KGgo=",
              revised_prompt: "tiny blue square",
            },
          ],
        }),
        headers: {},
        status: 200,
      })),
    };
    const registry = new ToolRegistry([createImageGenerateTool(backend)]);

    const batch = await executeToolBridgeCalls({
      calls: [
        {
          arguments: {
            outputFormat: "png",
            prompt: "A tiny blue square icon on a white background",
            quality: "low",
            size: "1024x1024",
          },
          id: "call-image",
          name: "image_generate",
          provider: "openai",
        },
      ],
      context,
      registry,
    });

    expect(backend.ensureLocal).toHaveBeenCalledOnce();
    expect(backend.http).toHaveBeenCalledOnce();

    const request = vi.mocked(backend.http).mock.calls[0]?.[0];
    expect(request?.url).toBe("http://127.0.0.1:20128/v1/images/generations");
    expect(request?.method).toBe("POST");
    expect(request?.timeoutMs).toBe(180_000);

    const body = JSON.parse(request?.body ?? "{}") as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "cx/gpt-5.5-image",
      n: 1,
      output_format: "png",
      prompt: "A tiny blue square icon on a white background",
      quality: "low",
      response_format: "b64_json",
      size: "1024x1024",
    });

    expect(batch.toolCalls[0]).toMatchObject({ status: "complete", toolId: "image_generate" });
    expect(batch.resultMessages[0]?.result.content).toContain("Generated 1 image");
    expect(batch.resultMessages[0]?.result.content).not.toContain("iVBORw0KGgo=");

    const data = batch.resultMessages[0]?.result.data as { artifacts?: Array<{ kind?: string; mimeType?: string; title?: string; url?: string }> };
    expect(data.artifacts).toHaveLength(1);
    expect(data.artifacts?.[0]).toMatchObject({
      height: 1024,
      kind: "image",
      mimeType: "image/png",
      url: "data:image/png;base64,iVBORw0KGgo=",
      width: 1024,
    });
    expect(data.artifacts?.[0]?.title).toMatch(/\.png$/);
  });

  it("uses authenticated cloud 9Router image routing when cloud subscriptions are configured", async () => {
    vi.stubEnv("VITE_GILBERT_NINE_ROUTER_BASE_URL", "https://router.example.com/subscriptions/v1");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const requestUrl = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      const headers = new Headers(init?.headers);
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;

      expect(requestUrl).toBe("https://router.example.com/subscriptions/v1/images/generations");
      expect(init?.method).toBe("POST");
      expect(headers.get("Content-Type")).toBe("application/json");
      expect(headers.get(NINE_ROUTER_FIREBASE_ID_TOKEN_HEADER)).toBe("firebase-id-token");
      expect(body).toMatchObject({
        model: "cx/gpt-5.5-image",
        n: 1,
        prompt: "A soft watercolor cow standing in a sunny green pasture",
        response_format: "b64_json",
      });

      return new Response(JSON.stringify({ data: [{ b64_json: "iVBORw0KGgo=" }] }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const registry = new ToolRegistry([createImageGenerateTool()]);

    const batch = await executeToolBridgeCalls({
      calls: [
        {
          arguments: {
            prompt: "A soft watercolor cow standing in a sunny green pasture",
          },
          id: "call-image-cloud",
          name: "image_generate",
          provider: "openai",
        },
      ],
      context,
      registry,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(batch.toolCalls[0]).toMatchObject({ status: "complete", toolId: "image_generate" });
    expect(batch.resultMessages[0]?.result.ok).toBe(true);
  });

  it("reports 9Router API errors as failed tool results", async () => {
    const backend: NineRouterImageBackend = {
      ensureLocal: vi.fn(async () => makeStatus()),
      http: vi.fn(async () => ({
        body: JSON.stringify({ error: { message: "image quota exhausted" } }),
        headers: {},
        status: 429,
      })),
    };
    const registry = new ToolRegistry([createImageGenerateTool(backend)]);

    const batch = await executeToolBridgeCalls({
      calls: [
        {
          arguments: { prompt: "A small test image" },
          id: "call-image-fail",
          name: "image_generate",
          provider: "openai",
        },
      ],
      context,
      registry,
    });

    expect(batch.toolCalls[0]).toMatchObject({ status: "error", toolId: "image_generate" });
    expect(batch.resultMessages[0]?.result.ok).toBe(false);
    expect(batch.resultMessages[0]?.result.error).toContain("image quota exhausted");
  });

  it("maps native OpenAI image model ids back onto the current 9Router subscription route", async () => {
    const backend: NineRouterImageBackend = {
      ensureLocal: vi.fn(async () => makeStatus()),
      http: vi.fn(async () => ({
        body: JSON.stringify({ data: [{ b64_json: "iVBORw0KGgo=" }] }),
        headers: {},
        status: 200,
      })),
    };
    const registry = new ToolRegistry([createImageGenerateTool(backend)]);

    await executeToolBridgeCalls({
      calls: [
        {
          arguments: {
            model: "gpt-image-1",
            prompt: "A small test image",
          },
          id: "call-image-native-model",
          name: "image_generate",
          provider: "openai",
        },
      ],
      context: {
        ...context,
        model: "cx/gpt-5.4",
        providerApiKey: "local-9router-key",
      },
      registry,
    });

    const request = vi.mocked(backend.http).mock.calls[0]?.[0];
    const body = JSON.parse(request?.body ?? "{}") as Record<string, unknown>;

    expect(body.model).toBe("cx/gpt-5.4-image");
    expect(request?.headers).toMatchObject({
      Authorization: "Bearer local-9router-key",
    });
  });

  it("ignores partial cx model routes instead of sending codex slash image", async () => {
    const backend: NineRouterImageBackend = {
      ensureLocal: vi.fn(async () => makeStatus()),
      http: vi.fn(async () => ({
        body: JSON.stringify({ data: [{ b64_json: "iVBORw0KGgo=" }] }),
        headers: {},
        status: 200,
      })),
    };
    const registry = new ToolRegistry([createImageGenerateTool(backend)]);

    await executeToolBridgeCalls({
      calls: [
        {
          arguments: {
            model: "cx/",
            prompt: "A small test image",
          },
          id: "call-image-partial-model",
          name: "image_generate",
          provider: "openai",
        },
      ],
      context: {
        ...context,
        model: "cx/gpt-5.5",
      },
      registry,
    });

    const request = vi.mocked(backend.http).mock.calls[0]?.[0];
    const body = JSON.parse(request?.body ?? "{}") as Record<string, unknown>;

    expect(body.model).toBe("cx/gpt-5.5-image");
    expect(body.model).not.toBe("cx/-image");
  });

  it("generates up to four images in one request", async () => {
    const backend: NineRouterImageBackend = {
      ensureLocal: vi.fn(async () => makeStatus()),
      http: vi.fn(async () => ({
        body: JSON.stringify({
          data: [
            { b64_json: "iVBORw0KGgo=" },
            { b64_json: "iVBORw0KGgo=" },
            { b64_json: "iVBORw0KGgo=" },
            { b64_json: "iVBORw0KGgo=" },
          ],
        }),
        headers: {},
        status: 200,
      })),
    };
    const registry = new ToolRegistry([createImageGenerateTool(backend)]);

    const batch = await executeToolBridgeCalls({
      calls: [
        {
          arguments: {
            count: 4,
            prompt: "Four distinct app icon options",
            size: "1536x1024",
          },
          id: "call-image-batch",
          name: "image_generate",
          provider: "openai",
        },
      ],
      context,
      registry,
    });

    const request = vi.mocked(backend.http).mock.calls[0]?.[0];
    const body = JSON.parse(request?.body ?? "{}") as Record<string, unknown>;
    const data = batch.resultMessages[0]?.result.data as { artifacts?: Array<{ height?: number; kind?: string; width?: number }>; imageCount?: number; requestedImageCount?: number };

    expect(body.n).toBe(4);
    expect(data.imageCount).toBe(4);
    expect(data.requestedImageCount).toBe(4);
    expect(data.artifacts).toHaveLength(4);
    expect(data.artifacts?.[0]).toMatchObject({
      height: 1024,
      kind: "image",
      width: 1536,
    });
  });
});
