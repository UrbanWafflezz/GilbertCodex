import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AssistantWorkTrace, createAssistantActivitySnapshot } from "./AssistantActivityIndicator";
import type { ChatMessage } from "../../types/chat";

function assistantMessage(patch: Partial<ChatMessage> = {}): ChatMessage {
  return {
    content: "",
    createdAt: "2026-05-27T12:00:00.000Z",
    id: "message-1",
    role: "assistant",
    ...patch,
  };
}

describe("AssistantWorkTrace", () => {
  it("renders the live work timer while a response is streaming", () => {
    const message = assistantMessage({
      isStreaming: true,
      streamTiming: {
        requestStartedAt: "2026-05-27T12:00:00.000Z",
      },
    });
    const html = renderToStaticMarkup(createElement(AssistantWorkTrace, {
      activitySnapshot: createAssistantActivitySnapshot(message),
      createdAt: message.createdAt,
      message,
    }));

    expect(html).toContain("Working for");
    expect(html).toContain("assistant-work-timer");
    expect(html).toContain("disabled=\"\"");
    expect(html).not.toContain("Thinking...");
  });

  it("renders completed elapsed work without timer-row tool chips", () => {
    const message = assistantMessage({
      isStreaming: false,
      streamTiming: {
        completedAt: "2026-05-27T12:00:04.000Z",
        requestStartedAt: "2026-05-27T12:00:00.000Z",
      },
      toolCalls: [{ id: "tool-1", label: "Read file", status: "complete" }],
    });
    const html = renderToStaticMarkup(createElement(AssistantWorkTrace, {
      activitySnapshot: createAssistantActivitySnapshot(message),
      createdAt: message.createdAt,
      message,
    }));

    expect(html).toContain("Worked for 4s");
    expect(html).not.toContain("Read 1 file");
    expect(html).toContain("aria-expanded=\"false\"");
    expect(html).not.toContain("disabled=\"\"");
  });

  it("stops the timer and spinner when a completed message still has stale active progress", () => {
    const message = assistantMessage({
      isStreaming: false,
      progress: [{ id: "stale-progress", label: "Reading files", status: "active" }],
      streamTiming: {
        completedAt: "2026-05-27T12:00:05.000Z",
        requestStartedAt: "2026-05-27T12:00:00.000Z",
      },
      toolCalls: [{ id: "tool-1", label: "Read file", status: "active" }],
    });
    const html = renderToStaticMarkup(createElement(AssistantWorkTrace, {
      activitySnapshot: createAssistantActivitySnapshot(message),
      createdAt: message.createdAt,
      message,
    }));

    expect(html).toContain("Worked for 5s");
    expect(html).toContain("lucide-circle-check");
    expect(html).toContain("aria-expanded=\"false\"");
    expect(html).not.toContain("disabled=\"\"");
    expect(html).not.toContain("lucide-loader-circle");
    expect(html).not.toContain("data-live=\"true\"");
  });

  it("expands live tool activity with file and command details", () => {
    const message = assistantMessage({
      isStreaming: true,
      streamTiming: {
        requestStartedAt: "2026-05-27T12:00:00.000Z",
      },
      toolCalls: [
        {
          fileChanges: [{ additions: 12, deletions: 1, kind: "update", path: "src/app.ts" }],
          id: "tool-1",
          label: "Edit file",
          status: "complete",
        },
        {
          id: "tool-2",
          label: "Run command",
          status: "active",
          terminal: {
            command: "npm.cmd run dev",
            workingDirectory: "C:\\Users\\Kobe Work\\Documents\\GilbertCodex",
          },
        },
      ],
    });
    const html = renderToStaticMarkup(createElement(AssistantWorkTrace, {
      activitySnapshot: createAssistantActivitySnapshot(message),
      createdAt: message.createdAt,
      message,
      responseStarted: false,
    }));

    expect(html).toContain("Edited 1 file");
    expect(html).toContain("Running command");
    expect(html).toContain("npm.cmd run dev");
    expect(html).toContain("src/app.ts");
    expect(html).toContain("aria-expanded=\"true\"");
  });

  it("collapses work details as soon as the public response starts", () => {
    const message = assistantMessage({
      content: "Here is the public response.",
      isStreaming: true,
      reasoning: "I checked the files and found the answer.",
      streamTiming: {
        requestStartedAt: "2026-05-27T12:00:00.000Z",
      },
      toolCalls: [
        {
          fileChanges: [{ additions: 8, deletions: 2, kind: "update", path: "src/app.ts" }],
          id: "tool-1",
          label: "Edit file",
          status: "complete",
        },
      ],
    });
    const html = renderToStaticMarkup(createElement(AssistantWorkTrace, {
      activitySnapshot: createAssistantActivitySnapshot(message),
      createdAt: message.createdAt,
      message,
      responseStarted: true,
    }));

    expect(html).toContain("Working for");
    expect(html).toContain("aria-expanded=\"false\"");
    expect(html).not.toContain("I checked the files");
    expect(html).not.toContain("src/app.ts");
  });

  it("shows file creation deltas and MCP calls in the expanded work ledger", () => {
    const message = assistantMessage({
      isStreaming: true,
      reasoning: "I am creating the site files and calling the connected deployment server.",
      streamTiming: {
        requestStartedAt: "2026-05-27T12:00:00.000Z",
      },
      toolCalls: [
        {
          fileChanges: [{ additions: 146, deletions: 0, kind: "create", path: "src/App.jsx" }],
          id: "tool-file",
          label: "Write file",
          status: "complete",
          toolId: "files_write",
        },
        {
          id: "tool-mcp",
          input: JSON.stringify({ server: "firebase", tool: "firebase_deploy" }),
          label: "MCP firebase_deploy",
          status: "complete",
          toolId: "mcp_firebase_deploy",
        },
      ],
    });
    const html = renderToStaticMarkup(createElement(AssistantWorkTrace, {
      activitySnapshot: createAssistantActivitySnapshot(message),
      createdAt: message.createdAt,
      message,
      responseStarted: false,
    }));

    expect(html).toContain("Created");
    expect(html).toContain("App.jsx");
    expect(html).toContain("+146");
    expect(html).toContain("-0");
    expect(html).toContain("Called MCP");
    expect(html).toContain("firebase_deploy");
    expect(html).toContain("firebase");
  });

  it("renders visible provider reasoning separately from the final answer", () => {
    const message = assistantMessage({
      content: "Hello!",
      reasoning: "I checked the greeting and can answer directly.",
      streamTiming: {
        completedAt: "2026-05-27T12:00:03.000Z",
        requestStartedAt: "2026-05-27T12:00:00.000Z",
      },
    });
    const html = renderToStaticMarkup(createElement(AssistantWorkTrace, {
      activitySnapshot: createAssistantActivitySnapshot(message),
      createdAt: message.createdAt,
      message,
    }));

    expect(html).toContain("I checked the greeting");
    expect(html).toContain("Worked for 3s");
    expect(html).toContain("aria-expanded=\"true\"");
    expect(html).not.toContain("Hello!");
  });
});
