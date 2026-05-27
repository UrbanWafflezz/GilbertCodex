import { describe, expect, it } from "vitest";
import {
  buildDictationTextMessage,
  calculateDictationWaveLevel,
  findComposerSlashCommandTrigger,
  formatDictationElapsedTime,
  getComposerGitStageableFileCount,
  getComposerPlaceholderOptions,
  getProjectGoalSlashCommandOptions,
  isEmptyDictationTranscript,
  nativeDictationStatusMessage,
  nativeDictationVoiceState,
  normalizeDictationWaveLevel,
  pushDictationWaveLevel,
  shouldRefreshComposerGitStatus,
  shouldShowComposerGitStatusLoading,
  shouldShowComposerWorkspaceControl,
  shouldLoadLiveModelCatalogProvider,
  shouldShowMediaFallbackNotice,
  voiceUnsupportedStatusMessage,
} from "./ChatComposer";
import type { ChatAttachment } from "../../types/chat";
import type { ComputerGitStatus, LocalWorkspaceSettings } from "../../types/localWorkspace";

const workspaceOff: LocalWorkspaceSettings = {
  enabled: false,
  permissionMode: "default",
  roots: [],
  scope: "selected-folder",
};

describe("chat composer live model catalogs", () => {
  it("loads subscription models even when another provider is active", () => {
    expect(shouldLoadLiveModelCatalogProvider("9router", "openrouter")).toBe(true);
  });
});

describe("chat composer workspace control", () => {
  it("hides the project control for plain no-project chats with local access off", () => {
    expect(shouldShowComposerWorkspaceControl("No project", workspaceOff)).toBe(false);
  });

  it("keeps real project chats visible", () => {
    expect(shouldShowComposerWorkspaceControl("GilbertCodex", workspaceOff)).toBe(true);
  });

  it("hides full-computer access in regular chats", () => {
    expect(
      shouldShowComposerWorkspaceControl("No project", {
        enabled: true,
        roots: [],
        scope: "full-computer",
      }),
    ).toBe(false);
  });

  it("does not show stale selected-folder roots after returning to a no-project chat", () => {
    expect(
      shouldShowComposerWorkspaceControl("No project", {
        enabled: true,
        roots: [String.raw`C:\Users\Kobe Work\Documents\GilbertCodex`],
        scope: "selected-folder",
      }),
    ).toBe(false);
  });
});

describe("chat composer slash commands", () => {
  it("opens slash commands only from the command position", () => {
    expect(findComposerSlashCommandTrigger("/", 1)).toEqual({ query: "", rangeEnd: 1, rangeStart: 0 });
    expect(findComposerSlashCommandTrigger("/go", 3)).toEqual({ query: "go", rangeEnd: 3, rangeStart: 0 });
    expect(findComposerSlashCommandTrigger("open /go", 8)).toBeNull();
    expect(findComposerSlashCommandTrigger("/goal build", 11)).toBeNull();
  });

  it("offers Project Goal commands from the slash picker", () => {
    expect(getProjectGoalSlashCommandOptions("", { canUseProjectGoals: true, isGenerating: false }).map((option) => option.command)).toEqual(["/goal"]);

    const commands = getProjectGoalSlashCommandOptions("goal", {
      canUseProjectGoals: true,
      isGenerating: false,
      projectGoal: {
        createdAt: "2026-05-25T12:00:00.000Z",
        id: "goal-1",
        objective: "Ship Project Goals through slash commands.",
        status: "active",
        updatedAt: "2026-05-25T12:00:00.000Z",
      },
    }).map((option) => option.command);

    expect(commands).toContain("/goal");
    expect(commands).toContain("/goal continue");
    expect(commands).toContain("/goal pause");
    expect(commands).toContain("/goal complete");
    expect(commands).toContain("/goal clear");
  });
});

describe("chat composer Git status", () => {
  const unavailableStatus: ComputerGitStatus = {
    additions: 0,
    ahead: 0,
    available: false,
    behind: 0,
    changedFiles: 0,
    clean: true,
    deletions: 0,
    error: "not a git repository",
  };

  it("treats a selected workspace with no result yet as still loading", () => {
    expect(shouldShowComposerGitStatusLoading(null, false, String.raw`C:\Users\Kobe Work\Documents\GilbertCodex`)).toBe(true);
  });

  it("still refreshes Git for a project root when the workspace has full-computer permission scope", () => {
    expect(shouldRefreshComposerGitStatus(String.raw`C:\Users\Kobe Work\Documents\GilbertCodex`, "full-computer")).toBe(true);
  });

  it("does not mask completed unavailable Git statuses as loading", () => {
    expect(shouldShowComposerGitStatusLoading(unavailableStatus, false, String.raw`C:\Users\Kobe Work\Documents\GilbertCodex`)).toBe(false);
  });

  it("treats only unstaged and untracked files as stageable", () => {
    expect(
      getComposerGitStageableFileCount({
        additions: 3,
        ahead: 0,
        available: true,
        behind: 0,
        changedFiles: 3,
        clean: false,
        deletions: 0,
        stagedFiles: 1,
        unstagedFiles: 1,
        untrackedFiles: 1,
      }),
    ).toBe(2);
  });
});

describe("chat composer media fallback notice", () => {
  const imageAttachment: ChatAttachment = {
    createdAt: new Date(0).toISOString(),
    dataUrl: "data:image/png;base64,aW1hZ2U=",
    id: "image-1",
    kind: "image",
    mimeType: "image/png",
    name: "screenshot.png",
    size: 128,
  };

  it("stays hidden for native OpenAI and Codex subscription image routes", () => {
    expect(shouldShowMediaFallbackNotice([imageAttachment], "openai", "gpt-5.5")).toBe(false);
    expect(shouldShowMediaFallbackNotice([imageAttachment], "9router", "cx/gpt-5.5")).toBe(false);
  });

  it("shows only when the selected model needs media fallback", () => {
    expect(shouldShowMediaFallbackNotice([imageAttachment], "openrouter", "openai/gpt-oss-120b:free")).toBe(true);
  });
});

describe("chat composer dictation helpers", () => {
  it("formats native dictation text and applies the dictionary", () => {
    expect(buildDictationTextMessage("Ask ", "gilbertcodex to summarize this", "GilbertCodex")).toBe("Ask GilbertCodex to summarize this");
  });

  it("keeps the existing composer text when dictation is empty", () => {
    expect(buildDictationTextMessage("Already here", "   ", "GilbertCodex")).toBe("Already here");
  });

  it("drops blank-audio whisper markers instead of pasting them", () => {
    expect(isEmptyDictationTranscript("[BLANK_AUDIO]")).toBe(true);
    expect(buildDictationTextMessage("Already here", "blank audio", "GilbertCodex")).toBe("Already here");
    expect(buildDictationTextMessage("", "(no speech detected)", "GilbertCodex")).toBe("");
  });

  it("switches placeholder prompts after the first chat message", () => {
    expect(getComposerPlaceholderOptions({ hasConversationMessages: false, isGenerating: false, planModeEnabled: false })[0]).toBe(
      "Ask Gilbert Codex to build, inspect, or change this project",
    );
    expect(getComposerPlaceholderOptions({ hasConversationMessages: true, isGenerating: false, planModeEnabled: false })[0]).toBe(
      "Ask for follow-up changes",
    );
  });

  it("uses planning-specific placeholder prompts while a plan is being prepared", () => {
    expect(
      getComposerPlaceholderOptions({
        hasConversationMessages: true,
        isGenerating: true,
        isPlanningGeneration: true,
        planModeEnabled: false,
      })[0],
    ).toBe("Add context for the plan");
  });

  it("formats the live dictation timer", () => {
    expect(formatDictationElapsedTime(0)).toBe("0:00");
    expect(formatDictationElapsedTime(9_999)).toBe("0:09");
    expect(formatDictationElapsedTime(65_000)).toBe("1:05");
    expect(formatDictationElapsedTime(3_665_000)).toBe("1:01:05");
  });

  it("turns real mic samples into a rolling waveform level", () => {
    const silence = new Uint8Array(128).fill(128);
    const loud = new Uint8Array(128);
    loud.forEach((_sample, index) => {
      loud[index] = index % 2 === 0 ? 0 : 255;
    });

    expect(calculateDictationWaveLevel(silence)).toBe(normalizeDictationWaveLevel(0));
    expect(calculateDictationWaveLevel(loud)).toBeGreaterThan(calculateDictationWaveLevel(silence));
    expect(pushDictationWaveLevel([...Array.from({ length: 126 }, () => 0.2), 0.62, 0.63], 0.9).slice(-3)).toEqual([
      0.62,
      0.63,
      normalizeDictationWaveLevel(0.9),
    ]);
  });

  it("maps native dictation states to composer voice states", () => {
    expect(nativeDictationVoiceState({ state: "warming" })).toBe("requesting");
    expect(nativeDictationVoiceState({ state: "recording" })).toBe("listening");
    expect(nativeDictationVoiceState({ state: "transcribing" })).toBe("transcribing");
    expect(nativeDictationVoiceState({ state: "missingModel" })).toBe("unsupported");
  });

  it("makes desktop native dictation failures explicit instead of hiding fallback", () => {
    expect(nativeDictationStatusMessage({ message: "Offline dictation model is missing.", state: "missingModel" })).toContain(
      "will not use browser speech fallback",
    );
  });

  it("shows the native unsupported reason when offline dictation cannot start", () => {
    expect(voiceUnsupportedStatusMessage("Offline dictation was not compiled into this build.")).toBe(
      "Offline dictation was not compiled into this build.",
    );
    expect(voiceUnsupportedStatusMessage(null)).toBe("Mic is not available in this preview");
  });
});
