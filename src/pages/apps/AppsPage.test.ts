import { describe, expect, it } from "vitest";
import type { McpServerState } from "../../types/mcp";
import {
  createMcpTestRequest,
  getMcpDraftSetupSummary,
  getMcpFeaturedPresetIds,
  getMcpFeaturedPresetIdsForSearch,
  getMcpFeaturedPresetSetupRequirementNames,
  getMcpKeyValueDraftValue,
  getSavedKeyOptionsForMcpRequirement,
  parseMcpHeaderText,
  parseMcpQueryText,
  type McpServerDraft,
  upsertMcpKeyValueLine,
} from "./AppsPage";
import type { ApiKeyRecord } from "../../types/apiKeys";
import { API_KEY_PRESETS } from "../../services/apiKeyPresets";

const BASE_DRAFT: McpServerDraft = {
  argsText: "",
  authorizationToken: "",
  command: "",
  enabled: true,
  environmentText: "",
  endpoint: "",
  headersText: "",
  id: "",
  name: "Test MCP",
  queryText: "",
  transport: "http",
  workingDirectory: "",
};

function stripeDraft(environmentText = "STRIPE_SECRET_KEY="): McpServerDraft {
  return {
    ...BASE_DRAFT,
    argsText: "-y\n@stripe/mcp@latest",
    command: "npx",
    environmentText,
    name: "Stripe",
    transport: "stdio",
  };
}

function mongodbDraft(environmentText = "MDB_MCP_CONNECTION_STRING=\nMDB_MCP_API_CLIENT_ID=\nMDB_MCP_API_CLIENT_SECRET="): McpServerDraft {
  return {
    ...BASE_DRAFT,
    argsText: "-y\nmongodb-mcp-server@latest\n--readOnly",
    command: "npx",
    environmentText,
    name: "MongoDB",
    transport: "stdio",
  };
}

function braveSearchDraft(environmentText = "BRAVE_API_KEY="): McpServerDraft {
  return {
    ...BASE_DRAFT,
    argsText: "-y\n@modelcontextprotocol/server-brave-search",
    command: "npx",
    environmentText,
    name: "Brave Search",
    transport: "stdio",
  };
}

function exaDraft(environmentText = "EXA_API_KEY="): McpServerDraft {
  return {
    ...BASE_DRAFT,
    argsText: "-y\nexa-mcp-server",
    command: "npx",
    environmentText,
    name: "Exa",
    transport: "stdio",
  };
}

function firecrawlDraft(environmentText = "FIRECRAWL_API_KEY="): McpServerDraft {
  return {
    ...BASE_DRAFT,
    argsText: "-y\nfirecrawl-mcp",
    command: "npx",
    environmentText,
    name: "Firecrawl",
    transport: "stdio",
  };
}

function tavilyDraft(environmentText = "TAVILY_API_KEY="): McpServerDraft {
  return {
    ...BASE_DRAFT,
    argsText: "-y\ntavily-mcp@latest",
    command: "npx",
    environmentText,
    name: "Tavily",
    transport: "stdio",
  };
}

function apifyDraft(environmentText = "APIFY_TOKEN="): McpServerDraft {
  return {
    ...BASE_DRAFT,
    argsText: "-y\n@apify/actors-mcp-server",
    command: "npx",
    environmentText,
    name: "Apify",
    transport: "stdio",
  };
}

function slackDraft(environmentText = "SLACK_BOT_TOKEN=\nSLACK_TEAM_ID=\nSLACK_CHANNEL_IDS="): McpServerDraft {
  return {
    ...BASE_DRAFT,
    argsText: "-y\n@modelcontextprotocol/server-slack",
    command: "npx",
    environmentText,
    name: "Slack",
    transport: "stdio",
  };
}

function mcpServer(overrides: Partial<McpServerState>): McpServerState {
  return {
    args: [],
    enabled: true,
    environment: [],
    headers: [],
    hasAuthorizationToken: false,
    id: "server",
    name: "Server",
    queryParams: [],
    tools: [],
    transport: "http",
    ...overrides,
  };
}

describe("MCP app setup validation", () => {
  it("blocks local Stripe MCP tests until STRIPE_SECRET_KEY is filled or already saved", () => {
    const missing = createMcpTestRequest(stripeDraft());

    expect(missing.ok).toBe(false);
    expect(missing.ok ? "" : missing.error).toContain("STRIPE_SECRET_KEY");

    const withKey = createMcpTestRequest(stripeDraft("STRIPE_SECRET_KEY=rk_test_123"));

    expect(withKey.ok).toBe(true);
    expect(withKey.ok ? withKey.value.environment : []).toEqual([{ name: "STRIPE_SECRET_KEY", value: "rk_test_123" }]);

    const savedSecretDraft = { ...stripeDraft(), id: "stripe" };
    const savedStripe = mcpServer({
      args: ["-y", "@stripe/mcp@latest"],
      command: "npx",
      environment: [{ hasValue: true, name: "STRIPE_SECRET_KEY" }],
      id: "stripe",
      name: "Stripe",
      transport: "stdio",
    });

    expect(createMcpTestRequest(savedSecretDraft, [savedStripe]).ok).toBe(true);
  });

  it("allows MongoDB with either a connection string or both Atlas service account fields", () => {
    expect(createMcpTestRequest(mongodbDraft()).ok).toBe(false);

    const connectionString = createMcpTestRequest(mongodbDraft("MDB_MCP_CONNECTION_STRING=mongodb://localhost:27017"));
    expect(connectionString.ok).toBe(true);

    const atlasPair = createMcpTestRequest(mongodbDraft("MDB_MCP_API_CLIENT_ID=client\nMDB_MCP_API_CLIENT_SECRET=secret"));
    expect(atlasPair.ok).toBe(true);

    const halfAtlas = createMcpTestRequest(mongodbDraft("MDB_MCP_API_CLIENT_ID=client\nMDB_MCP_API_CLIENT_SECRET="));
    expect(halfAtlas.ok).toBe(false);
  });

  it("blocks Brave Search MCP until BRAVE_API_KEY is filled or already saved", () => {
    const missing = createMcpTestRequest(braveSearchDraft());

    expect(missing.ok).toBe(false);
    expect(missing.ok ? "" : missing.error).toContain("BRAVE_API_KEY");

    const withKey = createMcpTestRequest(braveSearchDraft("BRAVE_API_KEY=brave_123"));

    expect(withKey.ok).toBe(true);
    expect(withKey.ok ? withKey.value.environment : []).toEqual([{ name: "BRAVE_API_KEY", value: "brave_123" }]);
  });

  it("blocks research MCPs until their non-model API keys are filled", () => {
    const apifyMissing = createMcpTestRequest(apifyDraft());
    const exaMissing = createMcpTestRequest(exaDraft());
    const firecrawlMissing = createMcpTestRequest(firecrawlDraft());
    const tavilyMissing = createMcpTestRequest(tavilyDraft());

    expect(apifyMissing.ok ? "" : apifyMissing.error).toContain("APIFY_TOKEN");
    expect(exaMissing.ok ? "" : exaMissing.error).toContain("EXA_API_KEY");
    expect(firecrawlMissing.ok ? "" : firecrawlMissing.error).toContain("FIRECRAWL_API_KEY");
    expect(tavilyMissing.ok ? "" : tavilyMissing.error).toContain("TAVILY_API_KEY");

    const apifyWithKey = createMcpTestRequest(apifyDraft("APIFY_TOKEN=apify_123"));
    const exaWithKey = createMcpTestRequest(exaDraft("EXA_API_KEY=exa_123"));
    const firecrawlWithKey = createMcpTestRequest(firecrawlDraft("FIRECRAWL_API_KEY=fc_123"));
    const tavilyWithKey = createMcpTestRequest(tavilyDraft("TAVILY_API_KEY=tvly_123"));

    expect(apifyWithKey.ok).toBe(true);
    expect(exaWithKey.ok).toBe(true);
    expect(firecrawlWithKey.ok).toBe(true);
    expect(tavilyWithKey.ok).toBe(true);
  });

  it("blocks Slack MCP until the bot token and team ID are filled", () => {
    expect(createMcpTestRequest(slackDraft()).ok).toBe(false);
    expect(createMcpTestRequest(slackDraft("SLACK_BOT_TOKEN=xoxb-123\nSLACK_TEAM_ID=")).ok).toBe(false);

    const withRequiredValues = createMcpTestRequest(slackDraft("SLACK_BOT_TOKEN=xoxb-123\nSLACK_TEAM_ID=T123"));

    expect(withRequiredValues.ok).toBe(true);
  });

  it("sends custom HTTP header secrets for providers such as Context7", () => {
    const context7Draft: McpServerDraft = {
      ...BASE_DRAFT,
      endpoint: "https://mcp.context7.com/mcp",
      headersText: "CONTEXT7_API_KEY=ctx_123",
      name: "Context7",
      transport: "http",
    };
    const request = createMcpTestRequest(context7Draft);

    expect(request.ok).toBe(true);
    expect(request.ok ? request.value.headers : []).toEqual([{ name: "CONTEXT7_API_KEY", value: "ctx_123" }]);
  });

  it("sends hosted HTTP query secrets for providers such as Browserbase", () => {
    const browserbaseDraft: McpServerDraft = {
      ...BASE_DRAFT,
      endpoint: "https://mcp.browserbase.com/mcp",
      name: "Browserbase",
      queryText: "browserbaseApiKey=bb_123",
      transport: "http",
    };
    const request = createMcpTestRequest(browserbaseDraft);

    expect(request.ok).toBe(true);
    expect(request.ok ? request.value.queryParams : []).toEqual([{ name: "browserbaseApiKey", value: "bb_123" }]);
  });

  it("keeps Authorization in the bearer field instead of custom headers", () => {
    expect(parseMcpHeaderText("Authorization=secret").ok).toBe(false);
  });

  it("validates secret query params before they are saved", () => {
    expect(parseMcpQueryText("browserbaseApiKey=secret").ok).toBe(true);
    expect(parseMcpQueryText("bad&name=secret").ok).toBe(false);
  });

  it("updates structured secret lines without dropping other env or header values", () => {
    const updated = upsertMcpKeyValueLine("MODEL=local\nSTRIPE_SECRET_KEY=", "STRIPE_SECRET_KEY", "rk_live_123");

    expect(getMcpKeyValueDraftValue(updated, "MODEL")).toBe("local");
    expect(getMcpKeyValueDraftValue(updated, "STRIPE_SECRET_KEY")).toBe("rk_live_123");
  });

  it("surfaces setup state for the matching featured preset", () => {
    const summary = getMcpDraftSetupSummary(stripeDraft());

    expect(summary.preset?.id).toBe("stripe");
    expect(summary.requiredAlternatives[0]?.ready).toBe(false);
    expect(summary.issues[0]).toContain("STRIPE_SECRET_KEY");
  });

  it("ranks saved Keys vault entries for the matching MCP setup requirement", () => {
    const keys: ApiKeyRecord[] = [
      {
        createdAt: "2026-05-25T00:00:00.000Z",
        id: "github",
        keyName: "Authorization",
        kind: "mcp",
        label: "GitHub token",
        service: "github",
        updatedAt: "2026-05-25T00:00:00.000Z",
        value: "github_pat_123",
      },
      {
        createdAt: "2026-05-25T00:00:00.000Z",
        id: "stripe",
        keyName: "STRIPE_SECRET_KEY",
        kind: "mcp",
        label: "Stripe restricted key",
        service: "stripe",
        updatedAt: "2026-05-25T00:00:00.000Z",
        value: "rk_test_123",
      },
    ];
    const summary = getMcpDraftSetupSummary(stripeDraft());
    const requirement = {
      helper: "",
      label: "Stripe secret key",
      location: "environment",
      name: "STRIPE_SECRET_KEY",
    } as const;

    expect(getSavedKeyOptionsForMcpRequirement(keys, requirement, summary.preset).map((key) => key.id)[0]).toBe("stripe");
  });

  it("keeps the expanded curated MCP preset list available to marketplace routes", () => {
    expect(getMcpFeaturedPresetIds()).toEqual(expect.arrayContaining([
      "apify",
      "aws",
      "azure",
      "brave-search",
      "browserbase",
      "exa",
      "filesystem",
      "firecrawl",
      "godaddy",
      "heroku",
      "jetbrains",
      "linkedin",
      "memory",
      "netlify",
      "neon",
      "playwright",
      "postgres",
      "puppeteer",
      "pulumi",
      "sequential-thinking",
      "slack",
      "tavily",
    ]));
  });

  it("filters featured MCP presets by provider, key name, and tool purpose", () => {
    expect(getMcpFeaturedPresetIdsForSearch("APIFY_TOKEN")).toEqual(["apify"]);
    expect(getMcpFeaturedPresetIdsForSearch("BRAVE_API_KEY")).toEqual(["brave-search"]);
    expect(getMcpFeaturedPresetIdsForSearch("BROWSERBASE_API_KEY")).toEqual(["browserbase"]);
    expect(getMcpFeaturedPresetIdsForSearch("EXA_API_KEY")).toEqual(["exa"]);
    expect(getMcpFeaturedPresetIdsForSearch("FIRECRAWL_API_KEY")).toEqual(["firecrawl"]);
    expect(getMcpFeaturedPresetIdsForSearch("GoDaddy domain availability")).toEqual(["godaddy"]);
    expect(getMcpFeaturedPresetIdsForSearch("HEROKU_API_KEY")).toEqual(["heroku"]);
    expect(getMcpFeaturedPresetIdsForSearch("JetBrains IDE")).toEqual(["jetbrains"]);
    expect(getMcpFeaturedPresetIdsForSearch("LINKEDIN_ACCESS_TOKEN")).toEqual(["linkedin"]);
    expect(getMcpFeaturedPresetIdsForSearch("profile setup")).toEqual(["linkedin"]);
    expect(getMcpFeaturedPresetIdsForSearch("page inspection")).toEqual(["playwright"]);
    expect(getMcpFeaturedPresetIdsForSearch("PULUMI_ACCESS_TOKEN")).toEqual(["pulumi"]);
    expect(getMcpFeaturedPresetIdsForSearch("Sequential Thinking")).toEqual(["sequential-thinking"]);
    expect(getMcpFeaturedPresetIdsForSearch("SLACK_TEAM_ID")).toEqual(["slack"]);
    expect(getMcpFeaturedPresetIdsForSearch("TAVILY_API_KEY")).toEqual(["tavily"]);
  });

  it("has a non-model Keys preset for every curated MCP setup requirement", () => {
    const presetKeyNames = new Set(API_KEY_PRESETS.map((preset) => preset.keyName));

    expect(getMcpFeaturedPresetSetupRequirementNames()).toEqual(expect.arrayContaining([
      "Authorization",
      "APIFY_TOKEN",
      "BRAVE_API_KEY",
      "BROWSERBASE_API_KEY",
      "CONTEXT7_API_KEY",
      "EXA_API_KEY",
      "FIRECRAWL_API_KEY",
      "HEROKU_API_KEY",
      "LINKEDIN_ACCESS_TOKEN",
      "NETLIFY_PERSONAL_ACCESS_TOKEN",
      "PULUMI_ACCESS_TOKEN",
      "SLACK_BOT_TOKEN",
      "SLACK_TEAM_ID",
      "TAVILY_API_KEY",
    ]));

    for (const requirementName of getMcpFeaturedPresetSetupRequirementNames()) {
      expect(presetKeyNames.has(requirementName), requirementName).toBe(true);
    }
  });
});
