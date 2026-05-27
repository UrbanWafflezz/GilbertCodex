import type { LocalWorkspaceSettings } from "./localWorkspace";
import type { ProjectRunConfig } from "./projectRun";

export type ProjectGoalStatus = "active" | "complete" | "paused";

export interface ProjectGoal {
  completedAt?: string;
  createdAt: string;
  id: string;
  objective: string;
  status: ProjectGoalStatus;
  updatedAt: string;
}

export interface ProjectSummary {
  createdAt: string;
  id: string;
  localWorkspace?: LocalWorkspaceSettings;
  name: string;
  projectGoal?: ProjectGoal;
  runConfig?: ProjectRunConfig;
  updatedAt: string;
}

export interface CreateProjectOptions {
  bindToActiveChat?: boolean;
}
