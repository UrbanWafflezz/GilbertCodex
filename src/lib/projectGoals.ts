import type { ProjectGoal, ProjectGoalStatus, ProjectSummary } from "../types/project";

export const PROJECT_GOAL_COMMAND = "/goal";

const PROJECT_GOAL_COMMAND_PATTERN = /^\s*\/goal(?:\s+([\s\S]*))?$/i;
const PROJECT_GOAL_OBJECTIVE_MAX_LENGTH = 8000;

export type ProjectGoalCommandAction =
  | { kind: "clear" }
  | { kind: "complete" }
  | { kind: "continue" }
  | { kind: "empty" }
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "set"; objective: string };

export function parseProjectGoalCommand(content: string): string | null {
  const match = content.match(PROJECT_GOAL_COMMAND_PATTERN);

  if (!match) {
    return null;
  }

  return normalizeProjectGoalObjective(match[1] ?? "");
}

export function parseProjectGoalCommandAction(content: string): ProjectGoalCommandAction | null {
  const match = content.match(PROJECT_GOAL_COMMAND_PATTERN);

  if (!match) {
    return null;
  }

  const argument = normalizeProjectGoalObjective(match[1] ?? "");

  if (!argument) {
    return { kind: "empty" };
  }

  switch (argument.toLowerCase()) {
    case "clear":
    case "delete":
    case "remove":
    case "reset":
      return { kind: "clear" };
    case "complete":
    case "done":
    case "finish":
      return { kind: "complete" };
    case "continue":
    case "next":
      return { kind: "continue" };
    case "pause":
    case "paused":
      return { kind: "pause" };
    case "resume":
    case "restart":
      return { kind: "resume" };
    default:
      return { kind: "set", objective: argument };
  }
}

export function createProjectGoal({
  id,
  now = new Date().toISOString(),
  objective,
  status = "active",
}: {
  id: string;
  now?: string;
  objective: string;
  status?: ProjectGoalStatus;
}): ProjectGoal {
  const normalizedObjective = normalizeProjectGoalObjective(objective);

  return {
    completedAt: status === "complete" ? now : undefined,
    createdAt: now,
    id,
    objective: normalizedObjective,
    status,
    updatedAt: now,
  };
}

export function normalizeProjectGoal(value: unknown): ProjectGoal | undefined {
  if (typeof value !== "object" || !value) {
    return undefined;
  }

  const candidate = value as Partial<ProjectGoal>;
  const objective = normalizeProjectGoalObjective(candidate.objective ?? "");

  if (!objective) {
    return undefined;
  }

  const now = new Date().toISOString();
  const status = normalizeProjectGoalStatus(candidate.status);
  const completedAt = status === "complete" ? normalizeIsoText(candidate.completedAt) ?? normalizeIsoText(candidate.updatedAt) ?? now : undefined;

  return {
    completedAt,
    createdAt: normalizeIsoText(candidate.createdAt) ?? now,
    id: typeof candidate.id === "string" && candidate.id.trim() ? candidate.id : `project-goal-${Date.now()}`,
    objective,
    status,
    updatedAt: normalizeIsoText(candidate.updatedAt) ?? normalizeIsoText(candidate.createdAt) ?? now,
  };
}

export function getProjectGoalForProject(projects: ProjectSummary[], projectName: string): ProjectGoal | undefined {
  const normalizedName = normalizeProjectGoalKey(projectName);

  if (!normalizedName) {
    return undefined;
  }

  return projects.find((project) => normalizeProjectGoalKey(project.name) === normalizedName)?.projectGoal;
}

export function getActiveProjectGoal(projects: ProjectSummary[], projectName: string): ProjectGoal | undefined {
  const goal = getProjectGoalForProject(projects, projectName);

  return goal?.status === "active" ? goal : undefined;
}

export function createProjectGoalContextContent(projectName: string, goal: ProjectGoal): string {
  return [
    "PROJECT GOAL",
    `Project: ${projectName}`,
    "Project Goals is active for this project.",
    "Objective and completion criteria:",
    goal.objective,
    "Use this objective as persistent context for the current project. Keep checking whether the work is complete, and when it is complete, clearly say the Project Goal is complete and summarize the verification.",
  ].join("\n");
}

export function createProjectGoalContinuePrompt(goal: ProjectGoal): string {
  return `Continue working on the active Project Goal:\n\n${goal.objective}\n\nInspect the current state, take the next useful step, verify what you can, and report progress against the goal.`;
}

export function formatProjectGoalStatus(status: ProjectGoalStatus) {
  if (status === "active") {
    return "Active";
  }

  if (status === "paused") {
    return "Paused";
  }

  return "Complete";
}

export function normalizeProjectGoalObjective(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\t/g, " ")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim()
    .slice(0, PROJECT_GOAL_OBJECTIVE_MAX_LENGTH);
}

function normalizeProjectGoalStatus(status: unknown): ProjectGoalStatus {
  if (status === "paused" || status === "complete") {
    return status;
  }

  return "active";
}

function normalizeIsoText(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function normalizeProjectGoalKey(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}
