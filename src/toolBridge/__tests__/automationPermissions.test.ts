import { describe, expect, it } from "vitest";
import { resolveToolPermission } from "../permissions";
import type { ToolDefinition } from "../types";

function createTool(overrides: Partial<ToolDefinition>): ToolDefinition {
  return {
    description: "Test tool",
    execute: () => ({ content: "ok", ok: true }),
    id: "test_tool",
    inputSchema: { type: "object" },
    permission: "read-only",
    risk: "read",
    title: "Test tool",
    ...overrides,
  };
}

describe("automation tool permissions", () => {
  it("allows scoped Gmail send actions when explicitly enabled", () => {
    const tool = createTool({
      executorMetadata: { family: "gmail", version: 1 },
      id: "gmail_send_message",
      permission: "mutating",
      risk: "mutating",
    });

    const decision = resolveToolPermission(tool, {
      automationScope: {
        allowedToolIds: ["gmail_send_message"],
        autonomous: true,
        taskId: "task-1",
      },
      permissionMode: "default",
    });

    expect(decision.allowed).toBe(true);
    expect(decision.requiresApproval).toBe(false);
  });

  it("pauses out-of-scope Calendar writes for approval", () => {
    const tool = createTool({
      executorMetadata: { family: "calendar", version: 1 },
      id: "calendar_create_event",
      permission: "mutating",
      risk: "mutating",
    });

    const decision = resolveToolPermission(tool, {
      automationScope: {
        allowedToolIds: ["gmail_search_messages"],
        autonomous: true,
        taskId: "task-1",
      },
      permissionMode: "full-access",
    });

    expect(decision.allowed).toBe(false);
    expect(decision.requiresApproval).toBe(true);
    expect(decision.reason).toContain("calendar");
  });

  it("keeps destructive tools approval-gated even when the family is scoped", () => {
    const tool = createTool({
      executorMetadata: { family: "gmail", version: 1 },
      id: "gmail_trash_message",
      permission: "destructive",
      risk: "destructive",
    });

    const decision = resolveToolPermission(tool, {
      automationScope: {
        allowedFamilies: ["gmail"],
        autonomous: true,
        taskId: "task-1",
      },
      permissionMode: "full-access",
    });

    expect(decision.allowed).toBe(false);
    expect(decision.requiresApproval).toBe(true);
  });

  it("pauses MCP tools unless the task explicitly enabled MCP scope", () => {
    const tool = createTool({
      executorMetadata: { family: "mcp", version: 1 },
      id: "mcp_list_servers",
      permission: "read-only",
      risk: "read",
    });

    const decision = resolveToolPermission(tool, {
      automationScope: {
        allowedToolIds: ["gmail_search_messages"],
        autonomous: true,
        taskId: "task-1",
      },
      permissionMode: "full-access",
    });

    expect(decision.allowed).toBe(false);
    expect(decision.requiresApproval).toBe(true);
    expect(decision.reason).toContain("mcp");
  });

  it("allows selected MCP bridge tools for scoped tasks", () => {
    const tool = createTool({
      executorMetadata: { family: "mcp", version: 1 },
      id: "mcp_call_tool",
      permission: "network",
      risk: "network",
    });

    const decision = resolveToolPermission(tool, {
      automationScope: {
        allowedFamilies: ["mcp"],
        allowedMcpServers: [{ serverId: "firebase", toolNames: ["firebase_deploy_status"] }],
        allowedToolIds: ["mcp_call_tool"],
        autonomous: true,
        taskId: "task-1",
      },
      permissionMode: "default",
    });

    expect(decision.allowed).toBe(true);
    expect(decision.requiresApproval).toBe(false);
  });
});
