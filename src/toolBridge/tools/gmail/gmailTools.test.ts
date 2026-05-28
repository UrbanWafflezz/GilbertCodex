import { describe, expect, it, vi } from "vitest";

import { createGmailTools, type GmailToolBackend } from "./index";

function createBackend(overrides: Partial<GmailToolBackend> = {}): GmailToolBackend {
  return {
    account: async () => ({
      accounts: [
        {
          active: true,
          email: "innovexiaweb@gmail.com",
          scopes: [],
          user: {
            email: "innovexiaweb@gmail.com",
            name: "Innovexia Web",
          },
        },
      ],
      activeAccountEmail: "innovexiaweb@gmail.com",
      connected: true,
      maxAccounts: 6,
      pluginInstalled: true,
      scopes: [],
      user: {
        email: "innovexiaweb@gmail.com",
        name: "Innovexia Web",
      },
    }),
    apiRequest: async () => ({ data: {}, message: "ok", method: "GET", path: "profile" }),
    batchModifyMessages: async () => ({ message: "ok", modifiedCount: 0 }),
    createDraft: async () => ({ id: "draft-1" }),
    createLabel: async () => ({ id: "label-1", name: "Label" }),
    deleteDraft: async () => ({ message: "ok" }),
    getMessage: async () => ({
      attachments: [],
      bodyTruncated: false,
      id: "message-1",
      labelIds: [],
      links: [],
      threadId: "thread-1",
    }),
    getThread: async () => ({ id: "thread-1", messages: [] }),
    listLabels: async () => ({ labels: [] }),
    listMessages: async () => ({ messages: [] }),
    modifyMessageLabels: async () => ({ message: "ok" }),
    sendDraft: async () => ({ id: "draft-1" }),
    sendMessage: async () => ({ id: "message-1" }),
    sendSeparateMessages: async () => ({ failedCount: 0, results: [], sentCount: 0 }),
    trashMessage: async () => ({ message: "ok" }),
    untrashMessage: async () => ({ message: "ok" }),
    ...overrides,
  };
}

describe("Gmail tool safety normalization", () => {
  it("drops placeholder reply metadata and fills sender identity for new sends", async () => {
    const sendMessage = vi.fn(async () => ({ id: "message-1" }));
    const backend = createBackend({ sendMessage });
    const tool = createGmailTools(backend).find((candidate) => candidate.id === "gmail_send_message");

    expect(tool).toBeDefined();

    const preview = await tool!.execute({
      accountEmail: "innovexiaweb@gmail.com",
      body: "Hi,\n\nQuick note.\n\nBest,\n[Your Name]",
      from: "innovexiaweb@gmail.com",
      inReplyTo: "-",
      references: " ",
      subject: "About Google Codex",
      threadId: "-",
      to: ["elijahkobejoe@gmail.com"],
      dryRun: true,
    }, {} as any);

    expect(preview.content).toContain("From: Innovexia Web <innovexiaweb@gmail.com>");
    expect(preview.content).toContain("Innovexia Web");
    expect(preview.content).toContain("Body markdown:");

    await tool!.execute({
      accountEmail: "innovexiaweb@gmail.com",
      body: "Hi,\n\nQuick note.\n\nBest,\n[Your Name]",
      from: "innovexiaweb@gmail.com",
      inReplyTo: "-",
      references: " ",
      subject: "About Google Codex",
      threadId: "-",
      to: ["elijahkobejoe@gmail.com"],
    }, {} as any);

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.stringContaining("Innovexia Web"),
      contentType: "text/markdown",
      from: "Innovexia Web <innovexiaweb@gmail.com>",
      inReplyTo: undefined,
      references: undefined,
      threadId: undefined,
    }));
  });

  it("drops placeholder-like Gmail thread ids before send execution", async () => {
    const sendMessage = vi.fn(async () => ({ id: "message-1" }));
    const backend = createBackend({ sendMessage });
    const tool = createGmailTools(backend).find((candidate) => candidate.id === "gmail_send_message");

    await tool!.execute({
      accountEmail: "innovexiaweb@gmail.com",
      body: "Hi there",
      subject: "Hello",
      threadId: "thread-1",
      to: ["recipient@example.com"],
    }, {} as any);

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      threadId: undefined,
    }));
  });

  it("keeps real Gmail thread ids before send execution", async () => {
    const sendMessage = vi.fn(async () => ({ id: "message-1" }));
    const backend = createBackend({ sendMessage });
    const tool = createGmailTools(backend).find((candidate) => candidate.id === "gmail_send_message");

    await tool!.execute({
      accountEmail: "innovexiaweb@gmail.com",
      body: "Hi there",
      subject: "Hello",
      threadId: "18fabc123def456",
      to: ["recipient@example.com"],
    }, {} as any);

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      threadId: "18fabc123def456",
    }));
  });
});
