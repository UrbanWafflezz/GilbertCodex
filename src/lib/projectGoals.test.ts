import { describe, expect, it } from "vitest";

import {
  createProjectGoal,
  createProjectGoalContextContent,
  createProjectGoalContinuePrompt,
  getActiveProjectGoal,
  normalizeProjectGoal,
  parseProjectGoalCommandAction,
  parseProjectGoalCommand,
} from "./projectGoals";
import type { ProjectSummary } from "../types/project";

describe("project goals", () => {
  it("parses /goal commands and preserves multi-line criteria", () => {
    expect(parseProjectGoalCommand("/goal Ship the project goals feature")).toBe("Ship the project goals feature");
    expect(parseProjectGoalCommand(" /goal Build it\nVerify with typecheck ")).toBe("Build it\nVerify with typecheck");
    expect(parseProjectGoalCommand("/plan Ship the project goals feature")).toBeNull();
  });

  it("parses project goal slash command actions", () => {
    expect(parseProjectGoalCommandAction("/goal")).toEqual({ kind: "empty" });
    expect(parseProjectGoalCommandAction("/goal continue")).toEqual({ kind: "continue" });
    expect(parseProjectGoalCommandAction("/goal pause")).toEqual({ kind: "pause" });
    expect(parseProjectGoalCommandAction("/goal Ship the project goals feature")).toEqual({
      kind: "set",
      objective: "Ship the project goals feature",
    });
  });

  it("normalizes persisted project goals", () => {
    expect(normalizeProjectGoal({ objective: "  Keep working  ", status: "paused" })).toMatchObject({
      objective: "Keep working",
      status: "paused",
    });
    expect(normalizeProjectGoal({ objective: "" })).toBeUndefined();
  });

  it("finds only active goals for model context", () => {
    const activeGoal = createProjectGoal({
      id: "goal-1",
      now: "2026-05-25T12:00:00.000Z",
      objective: "Finish the settings redesign.",
    });
    const projects: ProjectSummary[] = [
      {
        createdAt: "2026-05-25T12:00:00.000Z",
        id: "project-1",
        name: "GilbertCodex",
        projectGoal: activeGoal,
        updatedAt: "2026-05-25T12:00:00.000Z",
      },
    ];

    expect(getActiveProjectGoal(projects, "gilbertcodex")).toBe(activeGoal);
    expect(getActiveProjectGoal([{ ...projects[0]!, projectGoal: { ...activeGoal, status: "paused" } }], "GilbertCodex")).toBeUndefined();
  });

  it("formats active goal context and continue prompts", () => {
    const goal = createProjectGoal({
      id: "goal-1",
      now: "2026-05-25T12:00:00.000Z",
      objective: "Build Project Goals end to end.",
    });

    expect(createProjectGoalContextContent("GilbertCodex", goal)).toContain("PROJECT GOAL");
    expect(createProjectGoalContextContent("GilbertCodex", goal)).toContain("Build Project Goals end to end.");
    expect(createProjectGoalContinuePrompt(goal)).toContain("Continue working on the active Project Goal");
  });
});
