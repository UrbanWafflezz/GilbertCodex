import { describe, expect, it } from "vitest";
import type { ChatToolCall } from "../../types/chat";
import {
  createEmptyProjectToolMemoryState,
  createProjectToolMemoryContext,
  createProjectToolMemoryScope,
  learnProjectToolMemoryFromChatToolCalls,
  loadProjectToolMemoryState,
  projectToolMemoryStorageKey,
  saveProjectToolMemoryState,
} from "../memory";

describe("project tool memory", () => {
  it("uses a stable project scope for equivalent Windows workspace roots", () => {
    const first = createProjectToolMemoryScope({
      projectName: "Gilbert Codex",
      workspaceRoots: ["C:\\Users\\Kobe Work\\Documents\\GilbertCodex\\"],
    });
    const second = createProjectToolMemoryScope({
      projectName: "Different visible name",
      workspaceRoots: [String.raw`c:\Users\Kobe Work\Documents\GilbertCodex`],
    });

    expect(first.key).toBe(second.key);
    expect(first.workspaceRoots[0]).toBe(String.raw`C:\Users\Kobe Work\Documents\GilbertCodex`);
  });

  it("learns a project-specific path recovery from a failed tool followed by a successful one", () => {
    const scope = createProjectToolMemoryScope({
      projectName: "Gilbert Codex",
      workspaceRoots: [String.raw`C:\repo`],
    });
    const failedRead: ChatToolCall = {
      id: "tool-1",
      input: JSON.stringify({ path: "src/toolBridge/adapters.ts" }),
      label: "Read workspace file",
      output: String.raw`Could not read C:\repo\src\toolBridge\adapters.ts. A directory named adapters exists. Try files_read on one of: C:\repo\src\toolBridge\adapters\index.ts`,
      status: "error",
      toolId: "files_read",
    };
    const successfulRead: ChatToolCall = {
      id: "tool-2",
      input: JSON.stringify({ path: "src/toolBridge/adapters/index.ts" }),
      label: "Read workspace file",
      output: "export const ok = true;",
      status: "complete",
      toolId: "files_read",
    };

    let state = createEmptyProjectToolMemoryState(scope, "2026-05-15T12:00:00.000Z");
    state = learnProjectToolMemoryFromChatToolCalls(state, [failedRead], {
      now: "2026-05-15T12:01:00.000Z",
      prompt: "read the adapter file",
    });

    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]).toMatchObject({
      failureKind: "path",
      status: "open",
      toolId: "files_read",
    });
    expect(state.entries[0]?.retryHint).toContain("Do not repeat the stale path");

    state = learnProjectToolMemoryFromChatToolCalls(state, [successfulRead], {
      now: "2026-05-15T12:02:00.000Z",
      prompt: "read the adapter file",
    });

    expect(state.entries[0]).toMatchObject({
      status: "resolved",
      successCount: 1,
    });
    expect(state.entries[0]?.lesson).toContain("pivot to the discovered path");

    const context = createProjectToolMemoryContext(state, { prompt: "read toolBridge adapters" });
    expect(context).toContain("PROJECT TOOL MEMORY");
    expect(context).toContain("files_read");
    expect(context).toContain("src/toolBridge/adapters/index.ts");
  });

  it("keeps stored lessons project-scoped and sanitizes sensitive text", () => {
    const scope = createProjectToolMemoryScope({
      projectName: "Secret Project",
      workspaceRoots: [String.raw`C:\secret-project`],
    });
    const storage = new Map<string, string>();
    const adapter = {
      read: (key: string) => storage.get(key),
      write: (key: string, value: string) => storage.set(key, value),
    };
    const failedTerminal: ChatToolCall = {
      id: "tool-1",
      input: JSON.stringify({
        command: "npm run deploy -- --token sk-abcdefghijklmnopqrstuvwxyz123456",
        cwd: String.raw`C:\secret-project`,
      }),
      label: "Run terminal command",
      output: "Command timed out while using sk-abcdefghijklmnopqrstuvwxyz123456 for person@example.com",
      status: "error",
      toolId: "terminal_run",
    };
    const state = learnProjectToolMemoryFromChatToolCalls(createEmptyProjectToolMemoryState(scope), [failedTerminal], {
      now: "2026-05-15T12:01:00.000Z",
    });

    saveProjectToolMemoryState(state, adapter);
    const loaded = loadProjectToolMemoryState(scope, adapter);
    const raw = storage.get(projectToolMemoryStorageKey(scope)) ?? "";
    const context = createProjectToolMemoryContext(loaded, { prompt: "deploy" });

    expect(raw).not.toContain("sk-abcdefghijklmnopqrstuvwxyz123456");
    expect(context).not.toContain("person@example.com");
    expect(context).toContain("<secret>");
    expect(context).toContain("terminal_run");
  });
});
