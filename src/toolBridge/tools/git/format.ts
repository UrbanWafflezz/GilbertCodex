import type { ToolExecutionContext, ToolExecutionResult } from "../../types";
import { tryResolveAllowedPath } from "../../paths";
import type { ComputerGitStatus } from "../../../types/localWorkspace";
import type { GithubRepository } from "../../../types/github";

export function stringArg(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function optionalStringArg(value: unknown) {
  const valueString = stringArg(value);
  return valueString || undefined;
}

export function booleanArg(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

export function integerArg(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  const integer = Math.floor(value);
  return integer > 0 ? integer : undefined;
}

export function stringArrayArg(value: unknown) {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const itemString = stringArg(item);
        return itemString ? [itemString] : [];
      })
    : undefined;
}

export function createErrorResult(message: string): ToolExecutionResult {
  return {
    content: message,
    error: message,
    ok: false,
  };
}

export function readErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : typeof error === "string" && error.trim() ? error : fallback;
}

export function resolveGitWorkspacePath(context: ToolExecutionContext, pathArg: unknown): string | ToolExecutionResult {
  const requestedPath = typeof pathArg === "string" && pathArg.trim()
    ? pathArg.trim()
    : context.workspaceRoots?.[0] ?? "";

  const resolution = tryResolveAllowedPath(context, requestedPath);

  if (!resolution.ok) {
    return createErrorResult(resolution.error.message);
  }

  return resolution.path.resolved;
}

export function formatGitStatus(status: ComputerGitStatus, options: { maxFiles?: number } = {}) {
  if (!status.available) {
    return status.error ? `Git unavailable: ${status.error}` : "Git is not available for this workspace.";
  }

  const maxFiles = options.maxFiles ?? 40;
  const lines = [
    `Repository: ${status.repositoryRoot ?? "unknown"}`,
    `Branch: ${status.branch || "unknown"}`,
    status.upstream ? `Upstream: ${status.upstream}` : undefined,
    status.remoteUrl ? `Remote: ${status.remoteUrl}` : undefined,
    `Changes: ${status.changedFiles} file${status.changedFiles === 1 ? "" : "s"}, +${status.additions} -${status.deletions}`,
    typeof status.stagedFiles === "number" || typeof status.unstagedFiles === "number" || typeof status.untrackedFiles === "number"
      ? `Index: ${status.stagedFiles ?? 0} staged, ${status.unstagedFiles ?? 0} unstaged, ${status.untrackedFiles ?? 0} untracked`
      : undefined,
    status.ahead || status.behind ? `Sync: ahead ${status.ahead}, behind ${status.behind}` : undefined,
    status.clean ? "Working tree clean." : undefined,
  ].filter(Boolean) as string[];

  const files = status.files ?? [];
  if (files.length > 0) {
    lines.push("");
    lines.push("Changed files:");
    files.slice(0, maxFiles).forEach((file, index) => {
      lines.push(`${index + 1}. ${file.status} ${file.path} (+${file.additions} -${file.deletions})`);
    });
    if (files.length > maxFiles) {
      lines.push(`...${files.length - maxFiles} more changed file${files.length - maxFiles === 1 ? "" : "s"}.`);
    }
  }

  return lines.join("\n");
}

export function formatGitActionSummary(verb: string, status: ComputerGitStatus) {
  return [
    verb,
    "",
    formatGitStatus(status, { maxFiles: 24 }),
  ].join("\n");
}

export function formatGithubRepository(repo: GithubRepository) {
  const stats = [
    typeof repo.stargazersCount === "number" ? `${repo.stargazersCount} stars` : "",
    typeof repo.forksCount === "number" ? `${repo.forksCount} forks` : "",
    typeof repo.openIssuesCount === "number" ? `${repo.openIssuesCount} open issues` : "",
    repo.language,
  ].filter(Boolean).join(", ");

  return `${repo.fullName} (${repo.private ? "private" : "public"}, default ${repo.defaultBranch}${stats ? `, ${stats}` : ""}) - ${repo.htmlUrl}`;
}

export function formatRepositoryList(repos: GithubRepository[]) {
  if (repos.length === 0) {
    return "No repositories matched.";
  }

  return repos.map((repo, index) => `${index + 1}. ${formatGithubRepository(repo)}`).join("\n");
}

export function createDryRunData(extra: Record<string, unknown>) {
  return {
    dryRun: true,
    ...extra,
  };
}
