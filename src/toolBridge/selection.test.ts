import { describe, expect, it } from "vitest";

import { selectAdvertisedBridgeTools } from "./selection";
import type { ToolDefinition } from "./types";

function tool(id: string, family: NonNullable<ToolDefinition["executorMetadata"]>["family"]): ToolDefinition {
  return {
    description: `${id} test tool`,
    execute: () => ({ content: "ok", ok: true }),
    executorMetadata: { family, version: 1 },
    id,
    inputSchema: { type: "object" },
    permission: "read-only",
    risk: "read",
    title: id,
  };
}

const MCP_TOOLS = [
  tool("mcp_list_servers", "mcp"),
  tool("mcp_list_tools", "mcp"),
  tool("mcp_call_tool", "mcp"),
];

describe("selectAdvertisedBridgeTools", () => {
  it("attaches MCP tools for expanded service names without requiring the user to say MCP", () => {
    const prompts = [
      "Use Exa to research the current docs",
      "Use Apify to run a web scraping Actor",
      "Use Browserbase to navigate this page and extract the heading",
      "Search with Firecrawl and summarize the results",
      "Use Tavily to extract this page",
      "Deploy this app to Heroku",
      "Preview the Pulumi stack before deploying",
      "Inspect the current JetBrains IDE context",
      "Automate this page with Puppeteer",
      "Run Sequential Thinking on this plan",
      "Use Brave Search for fresh results",
      "Check the Neon database",
    ];

    for (const prompt of prompts) {
      const selected = selectAdvertisedBridgeTools(MCP_TOOLS, {
        mcpServersEnabled: false,
        prompt,
      }).map((selectedTool) => selectedTool.id);

      expect(selected, prompt).toEqual(expect.arrayContaining(["mcp_list_servers", "mcp_list_tools", "mcp_call_tool"]));
    }
  });
});
