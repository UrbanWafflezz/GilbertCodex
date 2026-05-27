import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NINE_ROUTER_ALWAYS_FREE_MODEL } from "../lib/models";
import {
  chooseNineRouterConnectedAccountProvider,
  chooseNineRouterModelForAccount,
  chooseNineRouterModelForConnectedAccounts,
  getNineRouterAccountProviderForModel,
  loadNineRouterCoreSettings,
  loadNineRouterTunnelStatus,
  setNineRouterTunnelEnabled,
  shouldShowNineRouterCodexContextSettings,
  updateNineRouterCoreSettings,
} from "./nineRouterClient";

const fetchMock = vi.fn();

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("nineRouterClient model selection", () => {
  it("prefers Codex subscription models after Codex sign-in instead of free routing", () => {
    expect(chooseNineRouterModelForAccount("codex", "", [
      NINE_ROUTER_ALWAYS_FREE_MODEL,
      "gh/gpt-5-mini",
      "cx/gpt-5.5",
      "cx/gpt-5.4",
    ])).toBe("cx/gpt-5.5");
  });

  it("keeps a saved model only when it belongs to the connected subscription provider", () => {
    expect(chooseNineRouterModelForAccount("codex", NINE_ROUTER_ALWAYS_FREE_MODEL, [
      NINE_ROUTER_ALWAYS_FREE_MODEL,
      "cx/gpt-5.4",
    ])).toBe("cx/gpt-5.4");
    expect(chooseNineRouterModelForAccount("github", "gh/gpt-4o", [
      "gh/gpt-5-mini",
      "gh/gpt-4o",
    ])).toBe("gh/gpt-4o");
  });

  it("falls back to the connected provider's own default instead of a saved model from another subscription", () => {
    expect(chooseNineRouterModelForAccount("claude", "cx/gpt-5.5", [])).toBe("cc/claude-opus-4-7");
    expect(chooseNineRouterModelForAccount("gemini-cli", "cx/gpt-5.5", [])).toBe("gc/gemini-3-flash-preview");
    expect(chooseNineRouterModelForAccount("antigravity", "cx/gpt-5.5", [])).toBe("ag/gemini-3-flash");
    expect(chooseNineRouterModelForAccount("kiro", "cx/gpt-5.5", [])).toBe("kr/claude-sonnet-4.5");
    expect(chooseNineRouterModelForAccount("kilocode", "cx/gpt-5.5", [])).toBe("kc/anthropic/claude-sonnet-4-20250514");
    expect(chooseNineRouterModelForAccount("cline", "cx/gpt-5.5", [])).toBe("cl/anthropic/claude-opus-4.7");
    expect(chooseNineRouterModelForAccount("qwen", "cx/gpt-5.5", [])).toBe("qw/qwen3-coder-plus");
    expect(chooseNineRouterModelForAccount("iflow", "cx/gpt-5.5", [])).toBe("if/qwen3-coder-plus");
    expect(chooseNineRouterModelForAccount("kimi-coding", "cx/gpt-5.5", [])).toBe("kmc/kimi-k2.6");
  });

  it("does not invent a cross-provider model for providers that only expose live catalog routes", () => {
    expect(chooseNineRouterModelForAccount("qoder", "cx/gpt-5.5", [])).toBe("");
    expect(chooseNineRouterModelForAccount("codebuddy", "cx/gpt-5.5", [])).toBe("");
    expect(chooseNineRouterModelForAccount("qoder", "cx/gpt-5.5", ["qoder/default"])).toBe("qoder/default");
  });

  it("chooses another signed-in subscription provider after sign-out", () => {
    expect(chooseNineRouterConnectedAccountProvider([
      { id: "codex-1", provider: "codex", testStatus: "active" },
      { id: "github-1", provider: "github", testStatus: "active" },
    ], "codex")?.id).toBe("github");
    expect(chooseNineRouterConnectedAccountProvider([
      { id: "codex-1", provider: "codex", testStatus: "active" },
    ], "codex")).toBeNull();
  });

  it("chooses subscription routes from connected accounts only", () => {
    expect(getNineRouterAccountProviderForModel("cc/claude-opus-4-7")).toBe("claude");
    expect(getNineRouterAccountProviderForModel("gc/gemini-3-pro-preview")).toBe("gemini-cli");
    expect(getNineRouterAccountProviderForModel("kr/claude-sonnet-4.5")).toBe("kiro");
    expect(getNineRouterAccountProviderForModel("kc/openai/gpt-4.1")).toBe("kilocode");
    expect(getNineRouterAccountProviderForModel("cl/anthropic/claude-opus-4.7")).toBe("cline");
    expect(getNineRouterAccountProviderForModel("qw/qwen3-coder-plus")).toBe("qwen");
    expect(getNineRouterAccountProviderForModel("if/qwen3-max")).toBe("iflow");
    expect(getNineRouterAccountProviderForModel("kmc/kimi-k2.6")).toBe("kimi-coding");
    expect(chooseNineRouterModelForConnectedAccounts("cc/claude-opus-4-7", [
      "cc/claude-opus-4-7",
      "cx/gpt-5.5",
    ], [
      { id: "codex-1", provider: "codex", testStatus: "active" },
    ])).toBe("cx/gpt-5.5");
    expect(chooseNineRouterModelForConnectedAccounts("cc/claude-opus-4-7", [
      "cc/claude-opus-4-7",
    ], [])).toBe("");
  });

  it("shows Codex context controls only for connected Codex routes", () => {
    expect(shouldShowNineRouterCodexContextSettings([
      { id: "claude-1", provider: "claude", testStatus: "active" },
    ], "cc/claude-opus-4-7")).toBe(false);
    expect(shouldShowNineRouterCodexContextSettings([
      { id: "codex-1", provider: "codex", testStatus: "active" },
    ], "cc/claude-opus-4-7")).toBe(false);
    expect(shouldShowNineRouterCodexContextSettings([], "cx/gpt-5.5")).toBe(false);
    expect(shouldShowNineRouterCodexContextSettings([
      { id: "codex-1", provider: "codex", testStatus: "active" },
    ], "cx/gpt-5.5")).toBe(true);
  });
});

describe("nineRouterClient runtime settings", () => {
  it("loads upstream runtime settings from the dashboard API", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      comboStrategy: "round-robin",
      comboStickyRoundRobinLimit: 3,
      rtkEnabled: true,
    }));

    await expect(loadNineRouterCoreSettings("http://127.0.0.1:20128/")).resolves.toMatchObject({
      comboStrategy: "round-robin",
      comboStickyRoundRobinLimit: 3,
      rtkEnabled: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:20128/api/settings",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("patches optimizer and combo settings through the dashboard API", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      comboStrategy: "fallback",
      rtkEnabled: false,
    }));

    await updateNineRouterCoreSettings("http://127.0.0.1:20128", {
      comboStrategy: "fallback",
      rtkEnabled: false,
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:20128/api/settings");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({
      comboStrategy: "fallback",
      rtkEnabled: false,
    });
  });

  it("loads and toggles the upstream tunnel endpoints", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ enabled: false }))
      .mockResolvedValueOnce(jsonResponse({ publicUrl: "https://example.trycloudflare.com", running: true }));

    await expect(loadNineRouterTunnelStatus("http://127.0.0.1:20128")).resolves.toMatchObject({ enabled: false });
    await expect(setNineRouterTunnelEnabled("http://127.0.0.1:20128", true)).resolves.toMatchObject({
      publicUrl: "https://example.trycloudflare.com",
      running: true,
    });
    expect(fetchMock.mock.calls[1][0]).toBe("http://127.0.0.1:20128/api/tunnel/enable");
    expect((fetchMock.mock.calls[1][1] as RequestInit).method).toBe("POST");
  });
});
