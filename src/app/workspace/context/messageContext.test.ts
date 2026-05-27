import { describe, expect, it } from "vitest";

import { createActiveProjectBoundaryMessage, createChatToolSelectionPrompt, createMessagesForProvider, resolveEnabledWorkspaceRoots } from "./messageContext";
import type { ChatMessage } from "../../../types/chat";
import type { LocalWorkspaceSettings } from "../../../types/localWorkspace";
import type { ProviderSettings } from "../../../types/settings";

const deps = {
  referencesSelectedWorkspaceForToolSelection: () => false,
  shouldAttachWebSearch: () => false,
};

const workspaceDisabled: LocalWorkspaceSettings = {
  enabled: false,
  permissionMode: "default",
  roots: [],
  scope: "current-folder",
};

function message(role: ChatMessage["role"], content: string): ChatMessage {
  return {
    content,
    createdAt: "2026-05-20T13:31:00.000Z",
    id: `${role}-${content.slice(0, 12)}`,
    role,
  };
}

describe("createChatToolSelectionPrompt", () => {
  it("carries recent Google Calendar context into terse re-check follow-ups", () => {
    const prompt = createChatToolSelectionPrompt(
      deps as any,
      "check 1 more time",
      [
        message("user", "check google calendar"),
        message("assistant", "Your Google Calendar is connected for calendar-user@example.com. For today, Wednesday, May 20, 2026, I found no events on your primary calendar."),
      ],
      workspaceDisabled,
    );

    expect(prompt).toContain("check 1 more time");
    expect(prompt).toContain("Recent app/tool conversation context for tool selection only:");
    expect(prompt).toContain("Google Calendar");
    expect(prompt).toContain("primary calendar");
  });

  it("does not add app tool context for plain acknowledgements", () => {
    const prompt = createChatToolSelectionPrompt(
      deps as any,
      "thanks",
      [
        message("user", "check google calendar"),
        message("assistant", "Your Google Calendar shows one all-day event today."),
      ],
      workspaceDisabled,
    );

    expect(prompt).toBe("thanks");
  });

  it("carries an active Project Goal into terse continuation turns", () => {
    const prompt = createChatToolSelectionPrompt(
      {
        activeChat: {
          id: "chat-1",
          messages: [],
          project: "GilbertCodex",
          title: "Goal chat",
          updatedAt: "2026-05-25T12:00:00.000Z",
        },
        normalizeProjectName: (name: string) => name,
        projects: [
          {
            createdAt: "2026-05-25T12:00:00.000Z",
            id: "project-1",
            name: "GilbertCodex",
            projectGoal: {
              createdAt: "2026-05-25T12:00:00.000Z",
              id: "goal-1",
              objective: "Finish Project Goals end to end.",
              status: "active",
              updatedAt: "2026-05-25T12:00:00.000Z",
            },
            updatedAt: "2026-05-25T12:00:00.000Z",
          },
        ],
        referencesSelectedWorkspaceForToolSelection: () => false,
        shouldAttachWebSearch: () => false,
      } as any,
      "continue",
      [],
      workspaceDisabled,
    );

    expect(prompt).toContain("Active Project Goal for tool selection only:");
    expect(prompt).toContain("Finish Project Goals end to end.");
  });
});

describe("createMessagesForProvider", () => {
  it("injects the active Project Goal as provider context", async () => {
    const userMessage = message("user", "continue");
    const messages: ChatMessage[] = await createMessagesForProvider(
      {
        compactProviderMessages: (inputMessages: ChatMessage[]) => ({ messages: inputMessages }),
        createActiveProjectBoundaryMessage: (projectName: string, workspace: LocalWorkspaceSettings) =>
          createActiveProjectBoundaryMessage(
            {
              createMessage: (role: ChatMessage["role"], content: string) => message(role, content),
              normalizeProjectName: (name: string) => name,
            } as any,
            projectName,
            workspace,
          ),
        createChatResearchContextMessages: () => [],
        createLocalWorkspaceContextMessages: async () => [],
        createMessage: (role: ChatMessage["role"], content: string) => message(role, content),
        createPdfLibraryContextMessages: () => [],
        createSourceControlContextMessages: async () => [],
        normalizeProjectName: (name: string) => name,
        projects: [
          {
            createdAt: "2026-05-25T12:00:00.000Z",
            id: "project-1",
            name: "GilbertCodex",
            projectGoal: {
              createdAt: "2026-05-25T12:00:00.000Z",
              id: "goal-1",
              objective: "Finish Project Goals end to end.",
              status: "active",
              updatedAt: "2026-05-25T12:00:00.000Z",
            },
            updatedAt: "2026-05-25T12:00:00.000Z",
          },
        ],
        shouldSkipLocalContextForGithub: () => false,
      } as any,
      [],
      userMessage,
      "GilbertCodex",
      workspaceDisabled,
      "continue",
      [],
      { thinking: { enabled: true, effort: "medium" } } as ProviderSettings,
      () => undefined,
    );

    expect(messages.map((candidate) => candidate.content).join("\n\n")).toContain("PROJECT GOAL");
    expect(messages.map((candidate) => candidate.content).join("\n\n")).toContain("Finish Project Goals end to end.");
  });
});

describe("full computer workspace roots", () => {
  it("resolves host roots for tool execution instead of only returning the focused project root", async () => {
    const workspace: LocalWorkspaceSettings = {
      enabled: true,
      permissionMode: "full-access",
      roots: ["C:\\Users\\Kobe Work\\Documents\\GilbertCodexWebsite"],
      scope: "full-computer",
    };
    const roots = await resolveEnabledWorkspaceRoots(
      {
        resolveLocalWorkspaceRoots: async () => [
          "C:\\Users\\Kobe Work\\Documents\\GilbertCodexWebsite",
          "C:\\",
        ],
      } as any,
      workspace,
    );

    expect(roots).toEqual([
      "C:\\Users\\Kobe Work\\Documents\\GilbertCodexWebsite",
      "C:\\",
    ]);
  });

  it("does not tell full-computer chats to refuse sibling local projects", () => {
    const workspace: LocalWorkspaceSettings = {
      enabled: true,
      permissionMode: "full-access",
      roots: ["C:\\Users\\Kobe Work\\Documents\\GilbertCodexWebsite"],
      scope: "full-computer",
    };
    const boundary = createActiveProjectBoundaryMessage(
      {
        createMessage: (role: ChatMessage["role"], content: string) => message(role, content),
        normalizeProjectName: (name: string) => name,
      } as any,
      "GilbertCodexWebsite",
      workspace,
    );

    expect(boundary.content).toContain("Full computer mode is enabled");
    expect(boundary.content).toContain("sibling projects");
    expect(boundary.content).not.toContain("Use only this active chat, these workspace roots");
  });
});
