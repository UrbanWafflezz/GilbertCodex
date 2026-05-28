import type { ToolDefinition } from "../../types";
import { createGithubTools } from "./github";
import { createLocalGitTools } from "./localGit";
import { defaultGitToolBackends, type GitToolBackends } from "./backend";

export {
  defaultGitToolBackends,
  defaultGithubBackend,
  defaultLocalGitBackend,
  type GitToolBackends,
  type GithubBackend,
  type LocalGitBackend,
} from "./backend";
export { createGithubTools } from "./github";
export { createLocalGitTools } from "./localGit";

export function createGitTools(backends: GitToolBackends = defaultGitToolBackends): ToolDefinition[] {
  return [
    ...createLocalGitTools(backends.local),
    ...createGithubTools(backends.github),
  ];
}

export const gitTools: ToolDefinition[] = createGitTools();
