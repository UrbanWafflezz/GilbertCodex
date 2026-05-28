import { describe, expect, it } from "vitest";
import {
  buildNineRouterFallbackModels,
  getNineRouterOpenCodeFreeModels,
  hasUnusableNineRouterFallbackModels,
  NINE_ROUTER_OPEN_CODE_FREE_FALLBACK_MODELS,
} from "./nineRouterFallbackRouting";

describe("9Router fallback routing", () => {
  it("uses OpenCode Free as the no-auth Free Auto default", () => {
    expect(buildNineRouterFallbackModels("always-free", "", [])).toEqual([...NINE_ROUTER_OPEN_CODE_FREE_FALLBACK_MODELS]);
  });

  it("does not place bare OpenRouter free ids into 9Router combos", () => {
    const models = buildNineRouterFallbackModels("always-free", "", [
      "openai/gpt-oss-120b:free",
      "deepseek/deepseek-v4-flash:free",
      "openrouter/openai/gpt-oss-120b:free",
    ]);

    expect(models).toContain("openrouter/openai/gpt-oss-120b:free");
    expect(models).not.toContain("openai/gpt-oss-120b:free");
    expect(models).not.toContain("deepseek/deepseek-v4-flash:free");
  });

  it("treats the legacy Auto mode as Free Auto", () => {
    expect(buildNineRouterFallbackModels("smart-saver", "cx/gpt-5.5", [
      "cx/gpt-5.5",
      "glm/glm-5.1",
      "oc/deepseek-v4-flash-free",
      "oc/qwen3.6-plus-free",
    ])).toEqual([
      ...NINE_ROUTER_OPEN_CODE_FREE_FALLBACK_MODELS,
    ]);
  });

  it("flags old credential-bound fallback models that are not in the live catalog", () => {
    expect(hasUnusableNineRouterFallbackModels(["openai/gpt-oss-120b:free"], [])).toBe(true);
    expect(hasUnusableNineRouterFallbackModels(["kr/claude-sonnet-4.5"], [])).toBe(true);
    expect(hasUnusableNineRouterFallbackModels(["kr/claude-sonnet-4.5"], ["kr/claude-sonnet-4.5"])).toBe(false);
    expect(hasUnusableNineRouterFallbackModels(["oc/gpt-5.4-mini"], [])).toBe(true);
    expect(hasUnusableNineRouterFallbackModels(["oc/gpt-5.4-mini"], ["oc/gpt-5.4-mini"])).toBe(true);
    expect(hasUnusableNineRouterFallbackModels(["oc/deepseek-v4-flash-free"], [])).toBe(false);
    expect(hasUnusableNineRouterFallbackModels(["oc/qwen3.6-plus-free"], ["oc/qwen3.6-plus-free"])).toBe(false);
  });

  it("reports OpenCode defaults even when 9Router has not listed no-auth models yet", () => {
    expect(getNineRouterOpenCodeFreeModels([])).toEqual([...NINE_ROUTER_OPEN_CODE_FREE_FALLBACK_MODELS]);
  });
});
