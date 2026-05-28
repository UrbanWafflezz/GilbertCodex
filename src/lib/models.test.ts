import { describe, expect, it } from "vitest";
import {
  DEEPSEEK_V4_FLASH_FREE_MODEL,
  DEFAULT_CHAT_MODEL,
  GEMMA_4_31B_FREE_MODEL,
  GLM_45_AIR_FREE_MODEL,
  GPT_OSS_20B_FREE_MODEL,
  GPT_OSS_120B_FREE_MODEL,
  IMAGE_REASONING_MODEL,
  LAGUNA_M1_FREE_MODEL,
  LLAMA_33_70B_FREE_MODEL,
  LING_26_FLASH_MODEL,
  MINIMAX_M25_FREE_MODEL,
  NEMOTRON_3_NANO_OMNI_MODEL,
  NEMOTRON_3_SUPER_MODEL,
  NINE_ROUTER_ALWAYS_FREE_MODEL,
  NINE_ROUTER_ANTIGRAVITY_MODEL_IDS,
  NINE_ROUTER_CLAUDE_CODE_MODEL_IDS,
  NINE_ROUTER_CLINE_MODEL_IDS,
  NINE_ROUTER_CODEX_EXTENDED_CONTEXT_TOKENS,
  NINE_ROUTER_CODEX_MODEL_IDS,
  NINE_ROUTER_CODEX_STANDARD_CONTEXT_TOKENS,
  NINE_ROUTER_GEMINI_CLI_MODEL_IDS,
  NINE_ROUTER_GITHUB_COPILOT_MODEL_IDS,
  NINE_ROUTER_IFLOW_MODEL_IDS,
  NINE_ROUTER_KILO_CODE_MODEL_IDS,
  NINE_ROUTER_KIMI_CODING_MODEL_IDS,
  NINE_ROUTER_KIRO_MODEL_IDS,
  NINE_ROUTER_OPEN_CODE_FREE_MODEL_IDS,
  NINE_ROUTER_QWEN_CODE_MODEL_IDS,
  NINE_ROUTER_SMART_SAVER_MODEL,
  OPENROUTER_AUTO_MODEL,
  OPENROUTER_CURATED_FREE_MODELS,
  OPENROUTER_FREE_AUTO_MODEL,
  OPENROUTER_SPEED_OPTIMIZED_FREE_MODELS,
  OWL_ALPHA_MODEL,
  QWEN3_CODER_FREE_MODEL,
  QWEN3_NEXT_80B_FREE_MODEL,
  TRINITY_LARGE_THINKING_FREE_MODEL,
  buildProviderModelOptions,
  getEffectiveProviderModelContextWindowTokens,
  getChatModelOption,
  getDefaultModelForProvider,
  isNineRouterGithubCopilotModelId,
  isOpenRouterFreeModel,
  normalizeNineRouterDiscoveredModelId,
  normalizeProviderModelId,
  supportsModelInputModality,
} from "./models";

describe("model catalog", () => {
  it("keeps only the requested OpenRouter free models in the curated catalog", () => {
    expect(OPENROUTER_CURATED_FREE_MODELS).toEqual([
      OPENROUTER_FREE_AUTO_MODEL,
      LAGUNA_M1_FREE_MODEL,
      OWL_ALPHA_MODEL,
      NEMOTRON_3_SUPER_MODEL,
      DEEPSEEK_V4_FLASH_FREE_MODEL,
      MINIMAX_M25_FREE_MODEL,
      GLM_45_AIR_FREE_MODEL,
      GPT_OSS_120B_FREE_MODEL,
      TRINITY_LARGE_THINKING_FREE_MODEL,
    ]);
  });

  it("treats the restored free OpenRouter models as selectable free routes", () => {
    expect(normalizeProviderModelId("openrouter", LAGUNA_M1_FREE_MODEL)).toBe(LAGUNA_M1_FREE_MODEL);
    expect(isOpenRouterFreeModel(LAGUNA_M1_FREE_MODEL)).toBe(true);
    expect(normalizeProviderModelId("openrouter", TRINITY_LARGE_THINKING_FREE_MODEL)).toBe(TRINITY_LARGE_THINKING_FREE_MODEL);
    expect(isOpenRouterFreeModel(TRINITY_LARGE_THINKING_FREE_MODEL)).toBe(true);
  });

  it("uses three reliable free models for OpenRouter auto-free routing", () => {
    expect(OPENROUTER_SPEED_OPTIMIZED_FREE_MODELS).toEqual([
      LAGUNA_M1_FREE_MODEL,
      NEMOTRON_3_SUPER_MODEL,
      MINIMAX_M25_FREE_MODEL,
    ]);
  });

  it("normalizes removed OpenRouter free models back to the curated default", () => {
    for (const removedModel of [
      GEMMA_4_31B_FREE_MODEL,
      GPT_OSS_20B_FREE_MODEL,
      LLAMA_33_70B_FREE_MODEL,
      QWEN3_CODER_FREE_MODEL,
      QWEN3_NEXT_80B_FREE_MODEL,
    ]) {
      expect(normalizeProviderModelId("openrouter", removedModel)).toBe(DEFAULT_CHAT_MODEL);
      expect(OPENROUTER_CURATED_FREE_MODELS).not.toContain(removedModel);
      expect(getChatModelOption(removedModel, "openrouter")).toBeUndefined();
    }
  });

  it("keeps the internal media fallback route hidden from the visible curated list", () => {
    expect(IMAGE_REASONING_MODEL).toBe(NEMOTRON_3_NANO_OMNI_MODEL);
    expect(normalizeProviderModelId("openrouter", IMAGE_REASONING_MODEL)).toBe(IMAGE_REASONING_MODEL);
    expect(OPENROUTER_CURATED_FREE_MODELS).not.toContain(IMAGE_REASONING_MODEL);
    expect(getChatModelOption(IMAGE_REASONING_MODEL, "openrouter")).toBeUndefined();
  });

  it("keeps Ling 2.6 Flash on its paid OpenRouter route", () => {
    const option = getChatModelOption(LING_26_FLASH_MODEL, "openrouter");

    expect(normalizeProviderModelId("openrouter", `${LING_26_FLASH_MODEL}:free`)).toBe(LING_26_FLASH_MODEL);
    expect(isOpenRouterFreeModel(LING_26_FLASH_MODEL)).toBe(false);
    expect(OPENROUTER_CURATED_FREE_MODELS).not.toContain(LING_26_FLASH_MODEL);
    expect(option).toMatchObject({
      label: "Ling 2.6 Flash",
      pricing: {
        inputPerMillionTokens: 0.01,
        outputPerMillionTokens: 0.03,
      },
      value: LING_26_FLASH_MODEL,
    });
  });

  it("hides paid OpenRouter rows from the normal selector catalog", () => {
    const optionValues = buildProviderModelOptions("openrouter", undefined).map((option) => option.value);

    expect(optionValues).toEqual([...OPENROUTER_CURATED_FREE_MODELS]);
    expect(optionValues).not.toContain(OPENROUTER_AUTO_MODEL);
    expect(optionValues).not.toContain(LING_26_FLASH_MODEL);
  });

  it("keeps a previously selected paid OpenRouter model available as the selected row only", () => {
    const optionValues = buildProviderModelOptions("openrouter", undefined, LING_26_FLASH_MODEL).map((option) => option.value);

    expect(optionValues).toContain(LING_26_FLASH_MODEL);
    expect(optionValues).not.toContain(OPENROUTER_AUTO_MODEL);
  });

  it("keeps the direct OpenAI catalog on current API model IDs and prices", () => {
    const optionValues = buildProviderModelOptions("openai", undefined).map((option) => option.value);

    expect(getDefaultModelForProvider("openai")).toBe("gpt-5.5");
    expect(optionValues).toEqual([
      "gpt-5.5",
      "gpt-5.5-pro",
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.4-nano",
      "gpt-5.4-pro",
      "gpt-5.3-codex",
    ]);
    expect(optionValues).not.toContain("gpt-5-nano");
    expect(normalizeProviderModelId("openai", "gpt-5-nano")).toBe("gpt-5.4-nano");
    expect(getChatModelOption("gpt-5.5", "openai")).toMatchObject({
      capabilities: expect.arrayContaining(["Multimodal"]),
      contextWindowTokens: 1_050_000,
      maxOutputTokens: 128_000,
      pricing: {
        cachedInputPerMillionTokens: 0.5,
        inputPerMillionTokens: 5,
        outputPerMillionTokens: 30,
        updatedAt: "2026-05-18",
      },
    });
    expect(getChatModelOption("gpt-5.3-codex", "openai")).toMatchObject({
      capabilities: expect.arrayContaining(["Multimodal"]),
      contextWindowTokens: 400_000,
      maxOutputTokens: 128_000,
      pricing: {
        cachedInputPerMillionTokens: 0.175,
        inputPerMillionTokens: 1.75,
        outputPerMillionTokens: 14,
      },
    });
  });

  it("keeps subscription defaults but allows live 9Router subscription routes", () => {
    const optionValues = buildProviderModelOptions("9router", undefined).map((option) => option.value);
    const subscriptionDefaults = [
      NINE_ROUTER_ALWAYS_FREE_MODEL,
      ...NINE_ROUTER_CODEX_MODEL_IDS,
      ...NINE_ROUTER_CLAUDE_CODE_MODEL_IDS,
      ...NINE_ROUTER_GEMINI_CLI_MODEL_IDS,
      ...NINE_ROUTER_ANTIGRAVITY_MODEL_IDS,
      ...NINE_ROUTER_GITHUB_COPILOT_MODEL_IDS,
      ...NINE_ROUTER_KIRO_MODEL_IDS,
      ...NINE_ROUTER_KILO_CODE_MODEL_IDS,
      ...NINE_ROUTER_CLINE_MODEL_IDS,
      ...NINE_ROUTER_QWEN_CODE_MODEL_IDS,
      ...NINE_ROUTER_IFLOW_MODEL_IDS,
      ...NINE_ROUTER_KIMI_CODING_MODEL_IDS,
    ];

    expect(getDefaultModelForProvider("9router")).toBe("cx/gpt-5.5");
    expect(optionValues).toEqual(subscriptionDefaults);
    expect(getChatModelOption("cx/gpt-5.5", "9router")).toMatchObject({
      contextWindowTokens: NINE_ROUTER_CODEX_STANDARD_CONTEXT_TOKENS,
    });
    expect(NINE_ROUTER_CODEX_MODEL_IDS).toContain("cx/gpt-5.3-codex-spark");
    expect(getChatModelOption("cx/gpt-5.3-codex-spark", "9router")?.pricing?.note).toContain("5-hour and weekly");
    expect(getEffectiveProviderModelContextWindowTokens("9router", "cx/gpt-5.5", 1_000_000, { codexContextWindow: "standard" })).toBe(NINE_ROUTER_CODEX_STANDARD_CONTEXT_TOKENS);
    expect(getEffectiveProviderModelContextWindowTokens("9router", "cx/gpt-5.5", 262_144, { codexContextWindow: "extended" })).toBe(NINE_ROUTER_CODEX_EXTENDED_CONTEXT_TOKENS);
    expect(buildProviderModelOptions("9router", [
      { id: "custom-combo" },
      { id: "cx/gpt-5.3-codex-xhigh" },
      { id: "oc/deepseek-v4-flash-free" },
    ]).map((option) => option.value)).toEqual([...subscriptionDefaults, "custom-combo"]);
    expect(normalizeProviderModelId("9router", " free-combo ")).toBe("free-combo");
    expect(normalizeProviderModelId("9router", NINE_ROUTER_SMART_SAVER_MODEL)).toBe(NINE_ROUTER_ALWAYS_FREE_MODEL);
    expect(normalizeProviderModelId("9router", "oc/deepseek-v4-flash-free")).toBe(NINE_ROUTER_ALWAYS_FREE_MODEL);
    expect(buildProviderModelOptions("9router", undefined, "free-combo").map((option) => option.value)).toEqual([
      NINE_ROUTER_ALWAYS_FREE_MODEL,
      ...NINE_ROUTER_CODEX_MODEL_IDS,
      ...NINE_ROUTER_CLAUDE_CODE_MODEL_IDS,
      ...NINE_ROUTER_GEMINI_CLI_MODEL_IDS,
      ...NINE_ROUTER_ANTIGRAVITY_MODEL_IDS,
      ...NINE_ROUTER_GITHUB_COPILOT_MODEL_IDS,
      ...NINE_ROUTER_KIRO_MODEL_IDS,
      ...NINE_ROUTER_KILO_CODE_MODEL_IDS,
      ...NINE_ROUTER_CLINE_MODEL_IDS,
      ...NINE_ROUTER_QWEN_CODE_MODEL_IDS,
      ...NINE_ROUTER_IFLOW_MODEL_IDS,
      ...NINE_ROUTER_KIMI_CODING_MODEL_IDS,
      "free-combo",
    ]);
  });

  it("keeps OpenCode Free defaults docs-backed and hidden behind Free Auto", () => {
    expect(NINE_ROUTER_OPEN_CODE_FREE_MODEL_IDS).toEqual([
      "oc/deepseek-v4-flash-free",
      "oc/minimax-m2.5-free",
      "oc/qwen3.6-plus-free",
      "oc/mimo-v2.5-free",
      "oc/nemotron-3-super-free",
      "oc/big-pickle",
    ]);
    expect(buildProviderModelOptions("9router", [
      { id: "oc/big-pickle" },
      { id: "oc/nemotron-3-super-free" },
      { id: "oc/qwen3.6-plus-free" },
      { id: "oc/minimax-m2.5-free" },
    ]).map((option) => option.value)).not.toEqual(expect.arrayContaining([
      "oc/big-pickle",
      "oc/nemotron-3-super-free",
      "oc/qwen3.6-plus-free",
      "oc/minimax-m2.5-free",
    ]));
    expect(normalizeNineRouterDiscoveredModelId("oc/big-pickle")).toBeUndefined();
  });

  it("treats OpenAI and Codex subscription routes as native image-input models", () => {
    expect(supportsModelInputModality("openai", "gpt-5.5", "image")).toBe(true);
    expect(supportsModelInputModality("openai", "gpt-4o", "image")).toBe(true);
    expect(supportsModelInputModality("9router", "cx/gpt-5.5", "image")).toBe(true);
    expect(supportsModelInputModality("9router", "cx/gpt-5.3-codex-xhigh", "image")).toBe(true);
    expect(supportsModelInputModality("9router", "cx/gpt-5.3-codex-spark", "image")).toBe(true);
    expect(supportsModelInputModality("9router", NINE_ROUTER_ALWAYS_FREE_MODEL, "image")).toBe(true);
    expect(supportsModelInputModality("9router", "oc/deepseek-v4-flash-free", "image")).toBe(true);
    expect(supportsModelInputModality("openrouter", GPT_OSS_120B_FREE_MODEL, "image")).toBe(false);
  });

  it("keeps GitHub Copilot subscription routes on supported 9Router ids", () => {
    expect(NINE_ROUTER_GITHUB_COPILOT_MODEL_IDS).toEqual([
      "gh/gpt-5-mini",
      "gh/gpt-4.1",
      "gh/gpt-4o",
      "gh/claude-haiku-4.5",
    ]);
    expect(NINE_ROUTER_GITHUB_COPILOT_MODEL_IDS).not.toContain("github/gemini-3.1-pro-preview");
    expect(NINE_ROUTER_GITHUB_COPILOT_MODEL_IDS).not.toContain("gh/grok-code-fast-1");
    expect(isNineRouterGithubCopilotModelId("gh/gpt-5-mini")).toBe(true);
    expect(isNineRouterGithubCopilotModelId("gh/gpt-4o")).toBe(true);
    expect(isNineRouterGithubCopilotModelId("gh/gpt-5.4")).toBe(false);
    expect(normalizeProviderModelId("9router", "github/gpt-4o")).toBe("gh/gpt-4o");
    expect(normalizeProviderModelId("9router", "github/gemini-3.1-pro-preview")).toBe("gh/gpt-5-mini");
    expect(normalizeProviderModelId("9router", "gh/grok-code-fast-1")).toBe("gh/gpt-5-mini");
    expect(normalizeProviderModelId("9router", "gh/claude-sonnet-4")).toBe("gh/claude-haiku-4.5");
    expect(normalizeProviderModelId("9router", "gh/gpt-4o-mini")).toBe("gh/gpt-5-mini");
    expect(normalizeNineRouterDiscoveredModelId("github/gpt-4o")).toBe("gh/gpt-4o");
    expect(normalizeNineRouterDiscoveredModelId("github/gemini-3.1-pro-preview")).toBeUndefined();
    expect(normalizeNineRouterDiscoveredModelId("gh/grok-code-fast-1")).toBeUndefined();
    expect(normalizeNineRouterDiscoveredModelId("gh/gpt-4o-mini")).toBeUndefined();
    expect(buildProviderModelOptions("9router", [
      { id: "github/gpt-4o" },
      { id: "gh/gpt-4.1" },
      { id: "gh/gemini-3.1-pro-preview" },
    ]).map((option) => option.value)).toEqual([
      NINE_ROUTER_ALWAYS_FREE_MODEL,
      ...NINE_ROUTER_CODEX_MODEL_IDS,
      ...NINE_ROUTER_CLAUDE_CODE_MODEL_IDS,
      ...NINE_ROUTER_GEMINI_CLI_MODEL_IDS,
      ...NINE_ROUTER_ANTIGRAVITY_MODEL_IDS,
      ...NINE_ROUTER_GITHUB_COPILOT_MODEL_IDS,
      ...NINE_ROUTER_KIRO_MODEL_IDS,
      ...NINE_ROUTER_KILO_CODE_MODEL_IDS,
      ...NINE_ROUTER_CLINE_MODEL_IDS,
      ...NINE_ROUTER_QWEN_CODE_MODEL_IDS,
      ...NINE_ROUTER_IFLOW_MODEL_IDS,
      ...NINE_ROUTER_KIMI_CODING_MODEL_IDS,
    ]);
  });

  it("keeps the direct Anthropic catalog on current Claude model IDs and prices", () => {
    const optionValues = buildProviderModelOptions("anthropic", undefined).map((option) => option.value);

    expect(getDefaultModelForProvider("anthropic")).toBe("claude-sonnet-4-6");
    expect(optionValues).toEqual([
      "claude-opus-4-7",
      "claude-opus-4-6",
      "claude-sonnet-4-6",
      "claude-haiku-4-5-20251001",
    ]);
    expect(getChatModelOption("claude-opus-4-7", "anthropic")).toMatchObject({
      contextWindowTokens: 1_000_000,
      maxOutputTokens: 128_000,
      pricing: {
        cachedInputPerMillionTokens: 0.5,
        inputPerMillionTokens: 5,
        outputPerMillionTokens: 25,
      },
    });
    expect(getChatModelOption("claude-sonnet-4-6", "anthropic")).toMatchObject({
      contextWindowTokens: 1_000_000,
      maxOutputTokens: 64_000,
      pricing: {
        cachedInputPerMillionTokens: 0.3,
        inputPerMillionTokens: 3,
        outputPerMillionTokens: 15,
      },
    });
  });

  it("keeps the direct DeepSeek catalog on V4 model IDs, aliases, and pricing", () => {
    const optionValues = buildProviderModelOptions("deepseek", undefined).map((option) => option.value);

    expect(getDefaultModelForProvider("deepseek")).toBe("deepseek-v4-pro");
    expect(optionValues).toEqual(["deepseek-v4-pro", "deepseek-v4-flash"]);
    expect(normalizeProviderModelId("deepseek", "deepseek-chat")).toBe("deepseek-v4-flash");
    expect(normalizeProviderModelId("deepseek", "deepseek-reasoner")).toBe("deepseek-v4-flash");
    expect(getChatModelOption("deepseek-v4-pro", "deepseek")).toMatchObject({
      contextWindowTokens: 1_000_000,
      maxOutputTokens: 384_000,
      pricing: {
        cachedInputPerMillionTokens: 0.003625,
        inputPerMillionTokens: 0.435,
        outputPerMillionTokens: 0.87,
      },
    });
    expect(getChatModelOption("deepseek-v4-flash", "deepseek")).toMatchObject({
      maxOutputTokens: 384_000,
      pricing: {
        cachedInputPerMillionTokens: 0.0028,
        inputPerMillionTokens: 0.14,
        outputPerMillionTokens: 0.28,
      },
    });
  });
});
