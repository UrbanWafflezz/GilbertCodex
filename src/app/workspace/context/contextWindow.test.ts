import { describe, expect, it } from "vitest";

import { createPromptAwareThinkingSettings, createRuntimeApprovalDecisions, rememberSessionApprovalDecision } from "./contextWindow";
import type { AgentApproval } from "../../../types/agentRun";
import type { LocalWorkspaceSettings } from "../../../types/localWorkspace";

const workspace: LocalWorkspaceSettings = {
  enabled: true,
  permissionMode: "full-access",
  roots: ["C:\\Users\\Example User\\Documents\\GilbertCodex"],
  scope: "selected-folder",
};

function createWorkspaceKey(settings: LocalWorkspaceSettings) {
  return JSON.stringify({
    enabled: settings.enabled,
    roots: settings.roots,
    scope: settings.scope,
  });
}

function createDeps(chatId: string, sessionApprovalDecisionsRef: { current: Record<string, Record<string, unknown>> }) {
  return {
    activeChat: { id: chatId },
    createApprovalSessionDecisionKey: (approval: AgentApproval) => `${approval.tool}:${approval.risk}:${approval.title}`,
    createApprovalWorkspaceSessionKey: createWorkspaceKey,
    sessionApprovalDecisionsRef,
  };
}

const gmailSendApproval: AgentApproval = {
  createdAt: "2026-05-20T14:00:00.000Z",
  id: "approval-1",
  kind: "write",
  risk: "medium",
  status: "pending",
  title: "Send Gmail message",
  tool: "gmail_send_message",
};

describe("chat-scoped approval sessions", () => {
  it("reuses a Gmail approval only inside the chat that requested always allow", () => {
    const sessionApprovalDecisionsRef = { current: {} };
    const chatADeps = createDeps("chat-a", sessionApprovalDecisionsRef);
    const chatBDeps = createDeps("chat-b", sessionApprovalDecisionsRef);
    const reusableKey = chatADeps.createApprovalSessionDecisionKey(gmailSendApproval);

    rememberSessionApprovalDecision(
      chatADeps as any,
      gmailSendApproval,
      { scope: "session", status: "approved" },
      workspace,
      "chat-a",
    );

    expect(createRuntimeApprovalDecisions(chatADeps as any, workspace, {}, "chat-a")?.[reusableKey]).toMatchObject({
      scope: "session",
      status: "approved",
    });
    expect(createRuntimeApprovalDecisions(chatBDeps as any, workspace, {}, "chat-b")?.[reusableKey]).toBeUndefined();
  });
});

describe("prompt-aware reasoning settings", () => {
  it("keeps the saved runtime reasoning setting", () => {
    const deps = {};

    expect(createPromptAwareThinkingSettings(deps as any, { enabled: true, effort: "high" }, "summarize this")).toEqual({
      enabled: true,
      effort: "high",
    });
    expect(createPromptAwareThinkingSettings(deps as any, { enabled: true, effort: "medium" }, "quick update")).toEqual({
      enabled: true,
      effort: "medium",
    });
    expect(createPromptAwareThinkingSettings(deps as any, { enabled: true, effort: "low" }, "quick update")).toEqual({
      enabled: true,
      effort: "low",
    });
  });
});
