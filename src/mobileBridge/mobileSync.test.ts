import { describe, expect, it } from "vitest";
import { defaultAppGeneralSettings, defaultProviderSettings } from "../lib/appStorage";
import type { ChatSummary } from "../types/chat";
import type { LocalWorkspaceSettings } from "../types/localWorkspace";
import type { ProjectSummary } from "../types/project";
import { createDesktopMobileSyncPayload, mergeMobilePayloadIntoDesktopState } from "./mobileSync";

const localWorkspace: LocalWorkspaceSettings = {
  enabled: true,
  permissionMode: "auto-review",
  roots: ["C:\\Users\\Kobe Work\\Documents\\GilbertCodex"],
  scope: "current-folder",
};

const chat: ChatSummary = {
  id: "chat-1",
  messages: [
    {
      content: "Hello from desktop",
      createdAt: "2026-05-26T12:00:00.000Z",
      id: "message-1",
      role: "user",
    },
  ],
  pinned: true,
  project: "GilbertCodex",
  title: "Desktop chat",
  updatedAt: "2026-05-26T12:00:00.000Z",
};

const project: ProjectSummary = {
  createdAt: "2026-05-26T11:00:00.000Z",
  id: "project-1",
  name: "GilbertCodex",
  updatedAt: "2026-05-26T12:00:00.000Z",
};

describe("mobile desktop sync", () => {
  it("publishes desktop chats, settings, permissions, and account session in the mobile payload", () => {
    const payload = createDesktopMobileSyncPayload({
      activeChatId: chat.id,
      appearanceMode: "system",
      appearanceSettings: {} as never,
      automationSkillRegistry: { skills: [] },
      automationState: { tasks: [{ id: "task-1", title: "Check CI", status: "ACTIVE" }] },
      chats: [chat],
      discordBridgeSettings: {},
      generalSettings: defaultAppGeneralSettings,
      localWorkspace,
      personalizationSettings: { locationServicesEnabled: false },
      projects: [project],
      providerSettings: defaultProviderSettings,
      session: {
        createdAt: 1,
        sessionToken: "desktop-session",
        user: {
          createdAt: 1,
          displayName: "Kobe",
          email: "kobe@example.com",
          id: "user-1",
          updatedAt: 1,
          username: "kobe",
        },
      },
    });

    expect(payload.kind).toBe("gilbert-codex-mobile-sync");
    expect(payload.accountSession.sessionToken).toBe("desktop-session");
    expect(payload.workspace.selectedChatId).toBe("chat-1");
    expect(payload.workspace.chats[0]?.pinned).toBe(true);
    expect(payload.workspace.deletedChatIds).toEqual([]);
    expect(payload.workspace.deletedProjectNames).toEqual([]);
    expect(payload.settings.mobileSnapshot.permissionMode).toBe("AutoReview");
    expect(payload.settings.mobileSnapshot.workspaceScope).toBe("CurrentProject");
    expect(payload.extras.automationState).toEqual({ tasks: [{ id: "task-1", title: "Check CI", status: "ACTIVE" }] });
  });

  it("merges mobile chats on first pairing without letting default mobile settings overwrite desktop settings", () => {
    const currentProvider = {
      ...defaultProviderSettings,
      model: "desktop-model",
      provider: "openai" as const,
      providerModels: {
        ...defaultProviderSettings.providerModels,
        openai: "desktop-model",
      },
    };
    const mobilePayload = {
      kind: "gilbert-codex-mobile-sync",
      source: "mobile",
      desktopBaselineApplied: false,
      workspace: {
        selectedChatId: "mobile-chat",
        projectNames: ["Mobile Project"],
        chats: [
          {
            id: "mobile-chat",
            title: "Mobile chat",
            project: "Mobile Project",
            updatedAtMillis: Date.parse("2026-05-26T13:00:00.000Z"),
            messages: [{ id: "mobile-message", role: "User", content: "Run tests", createdAt: "2026-05-26T13:00:00.000Z" }],
          },
        ],
      },
      settingsSnapshot: {
        model: "mobile-default-model",
        permissionMode: "FullAccess",
        provider: "Subscriptions",
        workspaceScope: "Device",
      },
    };

    const merged = mergeMobilePayloadIntoDesktopState(
      {
        activeChatId: chat.id,
        chats: [chat],
        generalSettings: defaultAppGeneralSettings,
        localWorkspace,
        projects: [project],
        providerSettings: currentProvider,
      },
      { payload: mobilePayload },
    );

    expect(merged.changed).toBe(true);
    expect(merged.chats.some((candidate) => candidate.id === "mobile-chat")).toBe(true);
    expect(merged.projects.some((candidate) => candidate.name === "Mobile Project")).toBe(true);
    expect(merged.providerSettings.model).toBe("desktop-model");
    expect(merged.localWorkspace.permissionMode).toBe("auto-review");
  });

  it("accepts mobile settings only after the desktop baseline has been applied", () => {
    const mobilePayload = {
      kind: "gilbert-codex-mobile-sync",
      source: "mobile",
      desktopBaselineApplied: true,
      workspace: {
        selectedChatId: chat.id,
        projectNames: [],
        chats: [],
      },
      settingsSnapshot: {
        maxOutputCap: 1,
        model: "cx/mobile-model",
        permissionMode: "FullAccess",
        projectlessNewChats: true,
        provider: "Subscriptions",
        requireHoldToSendLongPrompts: false,
        searchProvider: "Brave",
        webEnabled: true,
        workspaceScope: "Device",
      },
    };

    const merged = mergeMobilePayloadIntoDesktopState(
      {
        activeChatId: chat.id,
        chats: [chat],
        generalSettings: defaultAppGeneralSettings,
        localWorkspace,
        projects: [project],
        providerSettings: defaultProviderSettings,
      },
      { payload: mobilePayload },
    );

    expect(merged.providerSettings.provider).toBe("9router");
    expect(merged.providerSettings.model).toBe("cx/mobile-model");
    expect(merged.providerSettings.webSearch.enabled).toBe(true);
    expect(merged.providerSettings.webSearch.provider).toBe("brave");
    expect(merged.localWorkspace.permissionMode).toBe("full-access");
    expect(merged.localWorkspace.scope).toBe("full-computer");
    expect(merged.generalSettings.defaultProjectlessChat).toBe(true);
    expect(merged.generalSettings.requireCtrlEnterForLongPrompts).toBe(false);
  });

  it("merges same-thread messages instead of replacing the whole chat", () => {
    const mobilePayload = {
      kind: "gilbert-codex-mobile-sync",
      source: "mobile",
      desktopBaselineApplied: true,
      workspace: {
        selectedChatId: chat.id,
        projectNames: ["GilbertCodex"],
        chats: [
          {
            id: chat.id,
            title: "Desktop chat",
            project: "GilbertCodex",
            updatedAtMillis: Date.parse("2026-05-26T12:01:00.000Z"),
            messages: [
              { id: "mobile-message", role: "User", content: "Hello from mobile", createdAt: "2026-05-26T12:00:30.000Z" },
            ],
          },
        ],
      },
    };

    const merged = mergeMobilePayloadIntoDesktopState(
      {
        activeChatId: chat.id,
        chats: [chat],
        generalSettings: defaultAppGeneralSettings,
        localWorkspace,
        projects: [project],
        providerSettings: defaultProviderSettings,
      },
      { payload: mobilePayload },
    );

    expect(merged.chats.find((candidate) => candidate.id === chat.id)?.messages.map((message) => message.id)).toEqual(["message-1", "mobile-message"]);
  });

  it("keeps desktop active chat local while syncing mobile chat selection", () => {
    const secondDesktopChat: ChatSummary = {
      ...chat,
      id: "chat-2",
      title: "Desktop active",
      updatedAt: "2026-05-26T12:10:00.000Z",
    };
    const mobilePayload = {
      kind: "gilbert-codex-mobile-sync",
      source: "mobile",
      desktopBaselineApplied: true,
      workspace: {
        selectedChatId: chat.id,
        projectNames: ["GilbertCodex"],
        chats: [
          {
            id: chat.id,
            title: "Desktop chat",
            project: "GilbertCodex",
            updatedAtMillis: Date.parse("2026-05-26T12:01:00.000Z"),
            messages: [
              { id: "mobile-message", role: "User", content: "Hello from mobile", createdAt: "2026-05-26T12:00:30.000Z" },
            ],
          },
        ],
      },
    };

    const merged = mergeMobilePayloadIntoDesktopState(
      {
        activeChatId: secondDesktopChat.id,
        chats: [chat, secondDesktopChat],
        generalSettings: defaultAppGeneralSettings,
        localWorkspace,
        projects: [project],
        providerSettings: defaultProviderSettings,
      },
      { payload: mobilePayload },
    );

    expect(merged.activeChatId).toBe(secondDesktopChat.id);
    expect(merged.chats.find((candidate) => candidate.id === chat.id)?.messages.map((message) => message.id)).toEqual(["message-1", "mobile-message"]);
  });

  it("keeps desktop streaming messages visible while merging same-thread mobile messages", () => {
    const desktopStreamingChat: ChatSummary = {
      ...chat,
      messages: [
        ...chat.messages,
        {
          content: "Desktop answer is streaming",
          createdAt: "2026-05-26T12:00:45.000Z",
          id: "assistant-streaming",
          isStreaming: true,
          role: "assistant",
        },
      ],
      updatedAt: "2026-05-26T12:00:45.000Z",
    };
    const mobilePayload = {
      kind: "gilbert-codex-mobile-sync",
      source: "mobile",
      desktopBaselineApplied: true,
      workspace: {
        selectedChatId: chat.id,
        projectNames: ["GilbertCodex"],
        chats: [
          {
            id: chat.id,
            title: "Desktop chat",
            project: "GilbertCodex",
            updatedAtMillis: Date.parse("2026-05-26T12:00:50.000Z"),
            messages: [
              { id: "mobile-follow-up", role: "User", content: "Mobile follow-up", createdAt: "2026-05-26T12:00:50.000Z" },
            ],
          },
        ],
      },
    };

    const merged = mergeMobilePayloadIntoDesktopState(
      {
        activeChatId: chat.id,
        chats: [desktopStreamingChat],
        generalSettings: defaultAppGeneralSettings,
        localWorkspace,
        projects: [project],
        providerSettings: defaultProviderSettings,
      },
      { payload: mobilePayload },
    );

    const messages = merged.chats.find((candidate) => candidate.id === chat.id)?.messages ?? [];
    expect(messages.map((message) => message.id)).toEqual(["message-1", "assistant-streaming", "mobile-follow-up"]);
    expect(messages.find((message) => message.id === "assistant-streaming")?.isStreaming).toBe(true);
  });

  it("syncs mobile clear-all-messages without resurrecting desktop history", () => {
    const desktopChat: ChatSummary = {
      ...chat,
      messages: [
        ...chat.messages,
        {
          content: "Desktop answer",
          createdAt: "2026-05-26T12:01:00.000Z",
          id: "assistant-old",
          role: "assistant",
        },
      ],
      updatedAt: "2026-05-26T12:01:00.000Z",
    };
    const mobilePayload = {
      kind: "gilbert-codex-mobile-sync",
      source: "mobile",
      desktopBaselineApplied: true,
      workspace: {
        selectedChatId: chat.id,
        projectNames: ["GilbertCodex"],
        chats: [
          {
            id: chat.id,
            title: "Desktop chat",
            project: "GilbertCodex",
            messagesClearedAtMillis: Date.parse("2026-05-26T12:02:00.000Z"),
            updatedAtMillis: Date.parse("2026-05-26T12:02:00.000Z"),
            messages: [],
          },
        ],
      },
    };

    const merged = mergeMobilePayloadIntoDesktopState(
      {
        activeChatId: chat.id,
        chats: [desktopChat],
        generalSettings: defaultAppGeneralSettings,
        localWorkspace,
        projects: [project],
        providerSettings: defaultProviderSettings,
      },
      { payload: mobilePayload },
    );

    const clearedChat = merged.chats.find((candidate) => candidate.id === chat.id);
    expect(clearedChat?.messages).toEqual([]);
    expect(clearedChat?.messagesClearedAt).toBe("2026-05-26T12:02:00.000Z");
    expect(merged.changed).toBe(true);
  });

  it("keeps messages created after a clear marker while dropping stale ones", () => {
    const mobilePayload = {
      kind: "gilbert-codex-mobile-sync",
      source: "mobile",
      desktopBaselineApplied: true,
      workspace: {
        selectedChatId: chat.id,
        projectNames: ["GilbertCodex"],
        chats: [
          {
            id: chat.id,
            title: "Desktop chat",
            project: "GilbertCodex",
            messagesClearedAtMillis: Date.parse("2026-05-26T12:02:00.000Z"),
            updatedAtMillis: Date.parse("2026-05-26T12:03:00.000Z"),
            messages: [
              { id: "mobile-after-clear", role: "User", content: "After clear", createdAt: "2026-05-26T12:03:00.000Z" },
            ],
          },
        ],
      },
    };

    const merged = mergeMobilePayloadIntoDesktopState(
      {
        activeChatId: chat.id,
        chats: [chat],
        generalSettings: defaultAppGeneralSettings,
        localWorkspace,
        projects: [project],
        providerSettings: defaultProviderSettings,
      },
      { payload: mobilePayload },
    );

    expect(merged.chats.find((candidate) => candidate.id === chat.id)?.messages.map((message) => message.id)).toEqual(["mobile-after-clear"]);
  });

  it("syncs mobile image attachments into desktop chats and publishes desktop image attachments to mobile", () => {
    const imageDataUrl = "data:image/png;base64,aW1hZ2U=";
    const mobilePayload = {
      kind: "gilbert-codex-mobile-sync",
      source: "mobile",
      desktopBaselineApplied: true,
      workspace: {
        selectedChatId: "mobile-image-chat",
        projectNames: ["Mobile Project"],
        chats: [
          {
            id: "mobile-image-chat",
            title: "Image edit",
            project: "Mobile Project",
            updatedAtMillis: Date.parse("2026-05-26T13:00:00.000Z"),
            messages: [
              {
                id: "mobile-image-message",
                role: "User",
                content: "Make the jacket red",
                createdAt: "2026-05-26T13:00:00.000Z",
                attachments: [
                  {
                    id: "mobile-image-1",
                    name: "reference.png",
                    kind: "image",
                    mimeType: "image/png",
                    dataUrl: imageDataUrl,
                    sizeBytes: 5,
                  },
                ],
              },
            ],
          },
        ],
      },
    };

    const merged = mergeMobilePayloadIntoDesktopState(
      {
        activeChatId: chat.id,
        chats: [chat],
        generalSettings: defaultAppGeneralSettings,
        localWorkspace,
        projects: [project],
        providerSettings: defaultProviderSettings,
      },
      { payload: mobilePayload },
    );
    const desktopAttachment = merged.chats.find((candidate) => candidate.id === "mobile-image-chat")?.messages[0]?.attachments?.[0];

    expect(desktopAttachment).toMatchObject({
      dataUrl: imageDataUrl,
      kind: "image",
      mimeType: "image/png",
      name: "reference.png",
      size: 5,
    });

    const payload = createDesktopMobileSyncPayload({
      activeChatId: chat.id,
      appearanceMode: "system",
      appearanceSettings: {} as never,
      automationSkillRegistry: { skills: [] },
      automationState: { tasks: [] },
      chats: [
        {
          ...chat,
          messages: [
            {
              ...chat.messages[0],
              attachments: [
                {
                  createdAt: "2026-05-26T13:00:00.000Z",
                  dataUrl: imageDataUrl,
                  id: "desktop-image-1",
                  kind: "image",
                  mimeType: "image/png",
                  name: "desktop-reference.png",
                  size: 5,
                },
              ],
            },
          ],
        },
      ],
      discordBridgeSettings: {},
      generalSettings: defaultAppGeneralSettings,
      localWorkspace,
      personalizationSettings: { locationServicesEnabled: false },
      projects: [project],
      providerSettings: defaultProviderSettings,
      session: {
        createdAt: 1,
        sessionToken: "desktop-session",
        user: {
          createdAt: 1,
          displayName: "Kobe",
          email: "kobe@example.com",
          id: "user-1",
          updatedAt: 1,
          username: "kobe",
        },
      },
    });
    const mobileAttachment = payload.workspace.chats[0]?.messages[0]?.attachments[0];

    expect(mobileAttachment).toMatchObject({
      dataUrl: imageDataUrl,
      kind: "image",
      mimeType: "image/png",
      name: "desktop-reference.png",
      sizeBytes: 5,
    });
  });

  it("applies mobile delete tombstones to chats and projects", () => {
    const mobilePayload = {
      kind: "gilbert-codex-mobile-sync",
      source: "mobile",
      desktopBaselineApplied: true,
      workspace: {
        selectedChatId: null,
        projectNames: [],
        deletedChatIds: [{ id: chat.id, deletedAtMillis: Date.parse("2026-05-26T13:00:00.000Z") }],
        deletedProjectNames: [{ id: project.name, deletedAtMillis: Date.parse("2026-05-26T13:00:00.000Z") }],
        chats: [chat],
      },
    };

    const merged = mergeMobilePayloadIntoDesktopState(
      {
        activeChatId: chat.id,
        chats: [chat],
        generalSettings: defaultAppGeneralSettings,
        localWorkspace,
        projects: [project],
        providerSettings: defaultProviderSettings,
      },
      { payload: mobilePayload },
    );

    expect(merged.chats.some((candidate) => candidate.id === chat.id)).toBe(false);
    expect(merged.projects.some((candidate) => candidate.name === project.name)).toBe(false);
    expect(merged.changed).toBe(true);
  });

  it("prevents stale mobile snapshots from resurrecting deleted projects after reconnect", () => {
    const keptChat: ChatSummary = {
      ...chat,
      id: "chat-keep",
      project: "Keep",
      title: "Keep this",
    };
    const deletedProject: ProjectSummary = {
      ...project,
      id: "project-delete",
      name: "Deleted Project",
    };
    const staleChat: ChatSummary = {
      ...chat,
      id: "chat-delete",
      project: "Deleted Project",
      title: "Stale chat",
    };
    const mobilePayload = {
      kind: "gilbert-codex-mobile-sync",
      source: "mobile",
      desktopBaselineApplied: true,
      workspace: {
        selectedChatId: "chat-delete",
        projectNames: ["Deleted Project", "Keep"],
        deletedChatIds: [{ id: "chat-delete", deletedAtMillis: Date.parse("2026-05-26T13:00:00.000Z") }],
        deletedProjectNames: [{ id: "Deleted Project", deletedAtMillis: Date.parse("2026-05-26T13:00:00.000Z") }],
        chats: [
          {
            id: "chat-delete",
            title: "Stale chat",
            project: "Deleted Project",
            updatedAtMillis: Date.parse("2026-05-26T13:01:00.000Z"),
            messages: [{ id: "stale-message", role: "User", content: "stale", createdAt: "2026-05-26T13:01:00.000Z" }],
          },
        ],
      },
    };

    const merged = mergeMobilePayloadIntoDesktopState(
      {
        activeChatId: "chat-delete",
        chats: [staleChat, keptChat],
        generalSettings: defaultAppGeneralSettings,
        localWorkspace,
        projects: [deletedProject, { ...project, id: "project-keep", name: "Keep" }],
        providerSettings: defaultProviderSettings,
      },
      { payload: mobilePayload },
    );

    expect(merged.chats.map((candidate) => candidate.id)).toEqual(["chat-keep"]);
    expect(merged.projects.map((candidate) => candidate.name)).toEqual(["Keep"]);
    expect(merged.activeChatId).toBe("chat-keep");
  });

  it("publishes archived desktop chats as delete tombstones for reconnecting mobile devices", () => {
    const archivedChat: ChatSummary = {
      ...chat,
      archived: true,
      id: "chat-archived",
      updatedAt: "2026-05-26T13:00:00.000Z",
    };

    const payload = createDesktopMobileSyncPayload({
      activeChatId: chat.id,
      appearanceMode: "system",
      appearanceSettings: {} as never,
      automationSkillRegistry: { skills: [] },
      automationState: { tasks: [] },
      chats: [chat, archivedChat],
      discordBridgeSettings: {},
      generalSettings: defaultAppGeneralSettings,
      localWorkspace,
      personalizationSettings: { locationServicesEnabled: false },
      projects: [project],
      providerSettings: defaultProviderSettings,
      session: {
        createdAt: 1,
        sessionToken: "desktop-session",
        user: {
          createdAt: 1,
          displayName: "Kobe",
          email: "kobe@example.com",
          id: "user-1",
          updatedAt: 1,
          username: "kobe",
        },
      },
    });

    expect(payload.workspace.chats.some((candidate) => candidate.id === "chat-archived")).toBe(false);
    expect(payload.workspace.deletedChatIds).toEqual([
      { deletedAtMillis: Date.parse("2026-05-26T13:00:00.000Z"), id: "chat-archived" },
    ]);
  });

  it("publishes desktop message clear markers for mobile reconnect", () => {
    const payload = createDesktopMobileSyncPayload({
      activeChatId: chat.id,
      appearanceMode: "system",
      appearanceSettings: {} as never,
      automationSkillRegistry: { skills: [] },
      automationState: { tasks: [] },
      chats: [{ ...chat, messages: [], messagesClearedAt: "2026-05-26T12:02:00.000Z", updatedAt: "2026-05-26T12:02:00.000Z" }],
      discordBridgeSettings: {},
      generalSettings: defaultAppGeneralSettings,
      localWorkspace,
      personalizationSettings: { locationServicesEnabled: false },
      projects: [project],
      providerSettings: defaultProviderSettings,
      session: {
        createdAt: 1,
        sessionToken: "desktop-session",
        user: {
          createdAt: 1,
          displayName: "Kobe",
          email: "kobe@example.com",
          id: "user-1",
          updatedAt: 1,
          username: "kobe",
        },
      },
    });

    expect(payload.workspace.chats[0]?.messages).toEqual([]);
    expect(payload.workspace.chats[0]?.messagesClearedAtMillis).toBe(Date.parse("2026-05-26T12:02:00.000Z"));
  });
});
