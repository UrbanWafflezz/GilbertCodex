import { describe, expect, it, vi } from "vitest";

import type { ToolExecutionResult } from "../../types";
import { createMcpTools, type McpToolBackend } from ".";

describe("MCP tool bridge", () => {
  it("forwards MCP call progress through the tool progress reporter", async () => {
    const progress: ToolExecutionResult[] = [];
    const backend: McpToolBackend = {
      callTool: vi.fn(async () => {
        throw new Error("fallback should not be used when progress streaming is available");
      }),
      callToolWithProgress: vi.fn(async (request, onEvent) => {
        onEvent({ kind: "started", message: `Calling ${request.toolName}.` });
        onEvent({ kind: "output", message: "Deploying hosting assets.", stream: "stderr" });

        return {
          content: "Deploy started.",
          isError: false,
          ok: true,
          rawResult: { content: [{ text: "Deploy started.", type: "text" }] },
          server: {
            args: [],
            enabled: true,
            environment: [],
            hasAuthorizationToken: false,
            headers: [],
            id: "firebase",
            name: "Firebase",
            tools: [],
            transport: "stdio" as const,
          },
          toolName: request.toolName,
        };
      }),
      getState: vi.fn(),
      listTools: vi.fn(),
    };
    const tool = createMcpTools(backend).find((candidate) => candidate.id === "mcp_call_tool");

    expect(tool).toBeTruthy();

    const result = await tool!.execute(
      {
        arguments: { project: "demo" },
        serverId: "firebase",
        toolName: "firebase_deploy",
      },
      {
        model: "test-model",
        permissionMode: "default",
        provider: "openrouter",
        reportProgress: (nextProgress) => progress.push(nextProgress),
      },
    );

    expect(result.ok).toBe(true);
    expect(backend.callTool).not.toHaveBeenCalled();
    expect(backend.callToolWithProgress).toHaveBeenCalledOnce();
    expect(progress.map((item) => item.content)).toEqual([
      "MCP started: Calling firebase_deploy.",
      "MCP stderr: Deploying hosting assets.",
    ]);
  });

  it("samples noisy MCP output progress and flushes a summary on completion", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-26T12:00:00Z"));

    try {
      const progress: ToolExecutionResult[] = [];
      const backend: McpToolBackend = {
        callTool: vi.fn(async () => {
          throw new Error("fallback should not be used when progress streaming is available");
        }),
        callToolWithProgress: vi.fn(async (request, onEvent) => {
          onEvent({ kind: "started", message: `Calling ${request.toolName}.` });
          onEvent({ kind: "output", message: "line 1", stream: "stderr" });
          onEvent({ kind: "output", message: "line 2", stream: "stderr" });
          onEvent({ kind: "output", message: "line 3", stream: "stderr" });
          onEvent({ kind: "finished", message: `Finished ${request.toolName}.` });

          return {
            content: "Deploy finished.",
            isError: false,
            ok: true,
            rawResult: { content: [{ text: "Deploy finished.", type: "text" }] },
            server: {
              args: [],
              enabled: true,
              environment: [],
              hasAuthorizationToken: false,
              headers: [],
              id: "firebase",
              name: "Firebase",
              tools: [],
              transport: "stdio" as const,
            },
            toolName: request.toolName,
          };
        }),
        getState: vi.fn(),
        listTools: vi.fn(),
      };
      const tool = createMcpTools(backend).find((candidate) => candidate.id === "mcp_call_tool");

      await tool!.execute(
        {
          arguments: {},
          serverId: "firebase",
          toolName: "firebase_deploy",
        },
        {
          model: "test-model",
          permissionMode: "default",
          provider: "openrouter",
          reportProgress: (nextProgress) => progress.push(nextProgress),
        },
      );

      expect(progress.map((item) => item.content)).toEqual([
        "MCP started: Calling firebase_deploy.",
        "MCP stderr: line 1",
        "MCP stderr: 2 additional MCP output updates suppressed for UI performance. Latest: line 3",
        "MCP finished: Finished firebase_deploy.",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
