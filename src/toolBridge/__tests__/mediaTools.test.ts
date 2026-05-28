import { describe, expect, it, vi } from "vitest";

import { executeToolBridgeCalls, ToolRegistry } from "../index";
import { createImageGenerateTool, type NineRouterImageBackend } from "../tools/media";
import type { NineRouterLocalStatus } from "../../app/tauriClient";
import type { ToolExecutionContext } from "../types";

const context: ToolExecutionContext = {
  model: "cx/gpt-5.5",
  permissionMode: "default",
  provider: "9router",
};

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
