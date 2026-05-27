import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AgentRun } from "../../types/agentRun";
import type { ChatSummary } from "../../types/chat";
import type { LocalWorkspaceSettings } from "../../types/localWorkspace";
import { CodingSidecarPanel } from "./CodingSidecarPanel";

const chat: ChatSummary = {
  id: "chat-1",
  messages: [],
  project: "No project",
  title: "New chat",
  updatedAt: "2026-05-19T12:00:00.000Z",
};

const workspace: LocalWorkspaceSettings = {
  enabled: false,
  permissionMode: "default",
  roots: [],
  scope: "current-folder",
};

const baseProps = {
  agentRuns: [] as AgentRun[],
  chat,
  expanded: false,
  localWorkspace: workspace,
  onClose: () => undefined,
  onResizeKeyDown: () => undefined,
  onResizeStart: () => undefined,
  onSubmitPrompt: () => undefined,
  onToggleExpanded: () => undefined,
  previewWidth: 560,
  resizeMaxWidth: 900,
  resizeMinWidth: 420,
  root: "",
};

describe("CodingSidecarPanel", () => {
  it("opens to the codebase browser from the header flow", () => {
    const html = renderToStaticMarkup(createElement(CodingSidecarPanel, {
      ...baseProps,
      initialTab: "codebase",
    }));

    expect(html).toContain("Bridge-first coding");
    expect(html).toContain("Codebase");
    expect(html).toContain("Choose a local project folder");
    expect(html).not.toContain("Evidence");
    expect(html).not.toContain("Project map");
    expect(html).not.toContain("Tool health");
  });

  it("keeps the review empty state available for composer review flow", () => {
    const html = renderToStaticMarkup(createElement(CodingSidecarPanel, {
      ...baseProps,
      initialTab: "review",
    }));

    expect(html).toContain("No workspace selected");
    expect(html).toContain("Choose a local project folder");
  });

  it("keeps changed-file summaries out of the codebase browser", () => {
    const html = renderToStaticMarkup(createElement(CodingSidecarPanel, {
      ...baseProps,
      agentRuns: [{
        approvals: [],
        artifacts: [],
        chatId: "chat-1",
        coding: {
          events: [],
          review: {
            changedFiles: [{
              additions: 42,
              deletions: 8,
              path: "src/components/coding/CodingSidecarPanel.tsx",
              purpose: "User-facing React component",
              riskLevel: "low",
              status: "modified",
              tags: ["ui"],
            }],
            generatedAt: "2026-05-19T12:00:00.000Z",
            riskLevel: "low",
            sensitiveAreas: [],
            suggestedCommitMessage: "feat: revamp coding sidecar",
            suggestedPrSummary: "Revamps the coding sidecar.",
            testsRun: [],
            unverifiedAssumptions: [],
            version: 1,
          },
          request: {
            chatId: "chat-1",
            prompt: "inspect",
            workspaceRoots: ["C:/repo"],
          },
          startedAt: "2026-05-19T12:00:00.000Z",
          toolHealth: [],
          version: 1,
        },
        createdAt: "2026-05-19T12:00:00.000Z",
        events: [],
        id: "run-1",
        mode: "chat",
        prompt: "inspect",
        sources: [],
        status: "completed",
        steps: [],
        title: "Legacy run",
        toolCalls: [],
        updatedAt: "2026-05-19T12:00:00.000Z",
      }],
      initialTab: "codebase",
      localWorkspace: {
        ...workspace,
        enabled: true,
        roots: ["C:/repo"],
      },
      root: "C:/repo",
    }));

    expect(html).toContain("Codebase");
    expect(html).toContain("Files");
    expect(html).not.toContain("1 file worked on");
    expect(html).not.toContain("Changed</strong>");
    expect(html).not.toContain("src/components/coding/CodingSidecarPanel.tsx");
  });

  it("shows tool activity and hidden-tool coverage in the review tab", () => {
    const html = renderToStaticMarkup(createElement(CodingSidecarPanel, {
      ...baseProps,
      agentRuns: [{
        approvals: [],
        artifacts: [],
        chatId: "chat-1",
        coding: {
          events: [],
          request: {
            chatId: "chat-1",
            prompt: "inspect tools",
            workspaceRoots: ["C:/repo"],
          },
          startedAt: "2026-05-19T12:00:00.000Z",
          toolHealth: [{
            advertisedTools: [],
            availableToolCount: 5,
            createdAt: "2026-05-19T12:00:00.000Z",
            hiddenTools: [{
              id: "browser_console_read",
              reason: "Tool setting or request context hid this tool before prompt selection.",
              title: "Read browser console",
            }],
            id: "tool-health-pass-1",
            model: "gpt-test",
            passIndex: 1,
            permissionMode: "default",
            prompt: "inspect tools",
            provider: "openai",
            registryToolCount: 12,
            selectedTools: [
              { id: "files_search", title: "Search workspace files" },
              { id: "files_read", title: "Read workspace file" },
            ],
            workspaceRoots: ["C:/repo"],
          }],
          version: 1,
        },
        createdAt: "2026-05-19T12:00:00.000Z",
        events: [],
        id: "run-1",
        mode: "chat",
        prompt: "inspect tools",
        sources: [],
        status: "completed",
        steps: [],
        title: "Tool display run",
        toolCalls: [
          { id: "tool-search", label: "Search workspace files", status: "complete", toolId: "files_search" },
          { id: "tool-read", label: "Read workspace file", status: "complete", toolId: "files_read" },
          {
            batchFileResults: [{ additions: 2, deletions: 1, kind: "update", path: "src/lib/workTimer.ts", status: "ok" }],
            id: "tool-edit",
            label: "Edit many workspace files",
            status: "complete",
            toolId: "files_edit_many",
          },
          { id: "tool-test", label: "Run terminal command", status: "complete", terminal: { command: "npm test", exitCode: 0, shell: "powershell" }, toolId: "terminal_run" },
        ],
        updatedAt: "2026-05-19T12:00:00.000Z",
      }],
      initialTab: "review",
      localWorkspace: {
        ...workspace,
        enabled: true,
        roots: ["C:/repo"],
      },
      root: "C:/repo",
    }));

    expect(html).toContain("Tool activity");
    expect(html).toContain("4 calls captured");
    expect(html).toContain("Search");
    expect(html).toContain("Read");
    expect(html).toContain("Edit");
    expect(html).toContain("Terminal");
    expect(html).toContain("2 selected / 5 available / 12 registered");
    expect(html).toContain("Tool setting or request context hid this tool");
  });
});
