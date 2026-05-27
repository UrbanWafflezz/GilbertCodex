import { describe, expect, it } from "vitest";
import { defaultProviderSettings } from "../../lib/appStorage";
import {
  NINE_ROUTER_ALWAYS_FREE_MODEL,
  NINE_ROUTER_ANTIGRAVITY_MODEL_IDS,
  NINE_ROUTER_CLAUDE_CODE_MODEL_IDS,
  NINE_ROUTER_CLINE_MODEL_IDS,
  NINE_ROUTER_CODEX_MODEL_IDS,
  NINE_ROUTER_GEMINI_CLI_MODEL_IDS,
  NINE_ROUTER_GITHUB_COPILOT_MODEL_IDS,
  NINE_ROUTER_IFLOW_MODEL_IDS,
  NINE_ROUTER_KILO_CODE_MODEL_IDS,
  NINE_ROUTER_KIMI_CODING_MODEL_IDS,
  NINE_ROUTER_KIRO_MODEL_IDS,
  NINE_ROUTER_QWEN_CODE_MODEL_IDS,
  OPENROUTER_FREE_AUTO_MODEL,
  getModelRouteSourceInfo,
} from "../../lib/models";
import type { ProviderSettings } from "../../types/settings";
import { buildSelectorEntries, createModelSelectorGroups, type LiveModelCatalogStatus } from "./ModelSelectorPopover";

function createProviderSettings(overrides: Partial<ProviderSettings> = {}): ProviderSettings {
  return {
    ...defaultProviderSettings,
    ...overrides,
    apiKeys: {
      ...defaultProviderSettings.apiKeys,
      ...overrides.apiKeys,
    },
    baseUrls: {
      ...defaultProviderSettings.baseUrls,
      ...overrides.baseUrls,
    },
    disabledModels: {
      ...defaultProviderSettings.disabledModels,
      ...overrides.disabledModels,
    },
    providerModels: {
      ...defaultProviderSettings.providerModels,
      ...overrides.providerModels,
    },
  };
}

function getSubscriptionModelValues(
  settings: ProviderSettings,
  status: LiveModelCatalogStatus | undefined,
  liveModels: ReadonlyArray<{ id: string }> | undefined,
) {
  return buildSelectorEntries(
    settings,
    settings.model,
    liveModels ? { "9router": [...liveModels] } : {},
    status ? { "9router": status } : {},
    {},
  )
    .filter((entry) => entry.provider.id === "9router")
    .map((entry) => entry.option.value);
}

describe("model selector subscription models", () => {
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

  it("keeps Free Auto and subscription routes selectable while the live catalog is unavailable", () => {
    const settings = createProviderSettings({
      model: "cx/gpt-5.5",
      provider: "9router",
    });

    for (const [status, liveModels] of [
      ["loading", undefined],
      ["error", undefined],
      [undefined, undefined],
    ] as const) {
      expect(getSubscriptionModelValues(settings, status, liveModels)).toEqual(subscriptionDefaults);
    }
  });

  it("keeps subscription defaults selectable once the live catalog is ready", () => {
    const settings = createProviderSettings({
      model: "cx/gpt-5.5",
      provider: "9router",
    });

    expect(getSubscriptionModelValues(settings, "ready", [])).toEqual(subscriptionDefaults);
  });

  it("merges ready live subscription models with the static defaults", () => {
    const settings = createProviderSettings({
      model: "cx/gpt-5.5",
      provider: "9router",
    });

    const modelValues = getSubscriptionModelValues(settings, "ready", [
      { id: "cx/gpt-5.3-codex-high" },
      { id: "github/gpt-4o" },
      { id: "gh/gpt-5.4" },
      { id: "oc/deepseek-v4-flash-free" },
    ]);

    expect(modelValues).toEqual(expect.arrayContaining(subscriptionDefaults));
    expect(modelValues).toContain("cx/gpt-5.3-codex-high");
    expect(modelValues).toContain("gh/gpt-4o");
    expect(modelValues).not.toContain("gh/gpt-5.4");
    expect(modelValues).not.toContain("oc/deepseek-v4-flash-free");
  });

  it("hides OpenRouter models until an OpenRouter key is configured", () => {
    const withoutKey = createProviderSettings({
      model: defaultProviderSettings.providerModels.openrouter,
      provider: "openrouter",
    });
    const withKey = createProviderSettings({
      apiKeys: {
        openrouter: "sk-or-test",
      },
      model: defaultProviderSettings.providerModels.openrouter,
      provider: "openrouter",
    });

    expect(buildSelectorEntries(withoutKey, withoutKey.model, {}, {}, {}).some((entry) => entry.provider.id === "openrouter")).toBe(false);
    expect(buildSelectorEntries(withKey, withKey.model, {}, {}, {}).map((entry) => entry.option.value)).toContain(OPENROUTER_FREE_AUTO_MODEL);
  });

  it("labels direct API, OpenRouter, and subscription routes without mixing them together", () => {
    expect(getModelRouteSourceInfo("openai", "gpt-5.5").sourceLabel).toBe("OpenAI API");
    expect(getModelRouteSourceInfo("openrouter", "~openai/gpt-latest").sourceLabel).toBe("OpenRouter: OpenAI");
    expect(getModelRouteSourceInfo("9router", "cx/gpt-5.5").sourceLabel).toBe("Codex subscription");
    expect(getModelRouteSourceInfo("9router", "gh/gpt-5-mini").sourceLabel).toBe("GitHub Copilot subscription");
  });

  it("splits subscription selector groups by the connected account route family", () => {
    const settings = createProviderSettings({
      model: "cx/gpt-5.5",
      provider: "9router",
    });
    const entries = buildSelectorEntries(
      settings,
      settings.model,
      {
        "9router": [
          { id: "claude/sonnet-4.5" },
          { id: "gemini-cli/gemini-2.5-pro" },
        ],
      },
      { "9router": "ready" },
      {},
    );
    const subscriptionGroupLabels = createModelSelectorGroups(entries)
      .filter((group) => group.id.startsWith("9router-"))
      .map((group) => group.label);

    expect(subscriptionGroupLabels).toEqual(
      expect.arrayContaining([
        "Free Auto",
        "Codex subscription",
        "GitHub Copilot subscription",
        "Claude Code subscription",
        "Gemini subscription",
      ]),
    );
  });
});
