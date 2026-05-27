import { describe, expect, it } from "vitest";
import { getMcpFeaturedPresetIds } from "../../pages/apps/AppsPage";
import { getOpenAiCodexMcpPresetMappings } from "./openAiCodexMarketplace";

describe("OpenAI Codex marketplace MCP routing", () => {
  it("routes major cloud, database, browser, and workspace plugins to curated MCP presets", () => {
    const mappings = getOpenAiCodexMcpPresetMappings();

    expect(mappings).toMatchObject({
      apify: "apify",
      aws: "aws",
      azure: "azure",
      "brave-search": "brave-search",
      browserbase: "browserbase",
      context7: "context7",
      exa: "exa",
      firebase: "firebase",
      firecrawl: "firecrawl",
      gitlab: "gitlab",
      heroku: "heroku",
      jetbrains: "jetbrains",
      kubernetes: "kubernetes",
      linkedin: "linkedin",
      mongodb: "mongodb",
      "neon-postgres": "neon",
      netlify: "netlify",
      playwright: "playwright",
      postgres: "postgres",
      puppeteer: "puppeteer",
      pulumi: "pulumi",
      redis: "redis",
      "sequential-thinking": "sequential-thinking",
      slack: "slack",
      tavily: "tavily",
    });
  });

  it("does not point marketplace plugins at missing MCP presets", () => {
    const presetIds = new Set(getMcpFeaturedPresetIds());
    const missing = Object.values(getOpenAiCodexMcpPresetMappings()).filter((presetId) => !presetIds.has(presetId));

    expect(missing).toEqual([]);
  });
});
