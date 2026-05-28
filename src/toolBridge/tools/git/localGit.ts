import type { JsonValue, ToolDefinition, ToolExecutionResult } from "../../types";
import type { LocalGitBackend } from "./backend";
import {
  booleanArg,
  createDryRunData,
  createErrorResult,
  formatGitActionSummary,
  formatGitStatus,
  integerArg,
  optionalStringArg,
  readErrorMessage,
  resolveGitWorkspacePath,
  stringArg,
  stringArrayArg,
} from "./format";

export function createLocalGitTools(backend: LocalGitBackend): ToolDefinition[] {
  return [
    createGitStatusTool(backend),
    createGitDiffTool(backend),
    createGitStageTool(backend),
    createGitCommitTool(backend),
    createGitBranchTool(backend),
    createGitPushTool(backend),
    createGitPullTool(backend),
    createGitInitTool(backend),
  ];
}

function createGitStatusTool(backend: LocalGitBackend): ToolDefinition {
  return {
    description:
      "Inspect local Git status for the selected workspace. Use before committing, branching, pushing, or reviewing local changes.",
    execute: async (args, context) => {
      const path = resolveGitWorkspacePath(context, args.path);
      if (typeof path !== "string") {
        return path;
      }

      try {
        const status = await backend.status(path, {
          force: booleanArg(args.force),
          includeDiffPreview: booleanArg(args.includeDiffPreview),
        });
        const maxFiles = integerArg(args.maxFiles);

        return {
          content: formatGitStatus(status, { maxFiles }),
          data: { status } as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not read Git status."));
      }
    },
    executorMetadata: { family: "git", version: 1 },
    id: "git_status",
    inputSchema: {
      additionalProperties: false,
      properties: {
        force: { description: "Bypass the short Git status cache.", type: "boolean" },
        includeDiffPreview: { description: "Include per-file diff preview metadata in the status result.", type: "boolean" },
        maxFiles: { description: "Maximum changed files to include in the model-visible summary.", minimum: 1, type: "integer" },
        path: { description: "Repository path. Defaults to the first workspace root.", minLength: 1, type: "string" },
      },
      type: "object",
    },
    permission: "read-only",
    risk: "read",
    title: "Check Git status",
  };
}

function createGitDiffTool(backend: LocalGitBackend): ToolDefinition {
  return {
    description:
      "Read a local Git diff for the selected workspace. Supports staged-only diffs, path filters, and an optional maxBytes bound.",
    execute: async (args, context) => {
      const path = resolveGitWorkspacePath(context, args.path);
      if (typeof path !== "string") {
        return path;
      }

      try {
        const result = await backend.diff(path, {
          includeUntracked: args.includeUntracked !== false,
          maxBytes: integerArg(args.maxBytes),
          paths: stringArrayArg(args.paths),
          staged: booleanArg(args.staged),
        });
        const content = result.diff.trim()
          ? [
              `Git diff for ${result.repositoryRoot}${result.truncated ? " (truncated)" : ""}:`,
              "",
              result.diff,
            ].join("\n")
          : "No Git diff matched this request.";

        return {
          content,
          data: result as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not read Git diff."));
      }
    },
    executorMetadata: { family: "git", version: 1 },
    id: "git_diff",
    inputSchema: {
      additionalProperties: false,
      properties: {
        includeUntracked: { description: "Include untracked text files in the diff. Defaults to true.", type: "boolean" },
        maxBytes: { description: "Optional maximum bytes of diff text to return.", minimum: 1, type: "integer" },
        path: { description: "Repository path. Defaults to the first workspace root.", minLength: 1, type: "string" },
        paths: { description: "Optional path filters inside the repository.", items: { type: "string" }, type: "array" },
        staged: { description: "Return only staged changes.", type: "boolean" },
      },
      type: "object",
    },
    permission: "read-only",
    risk: "read",
    title: "Read Git diff",
  };
}

function createGitStageTool(backend: LocalGitBackend): ToolDefinition {
  return {
    description:
      "Stage local Git changes. Omit paths to stage all changes, or pass paths for a focused stage. Supports dryRun approval previews.",
    execute: async (args, context) => {
      const path = resolveGitWorkspacePath(context, args.path);
      if (typeof path !== "string") {
        return path;
      }

      const paths = stringArrayArg(args.paths);

      try {
        if (booleanArg(args.dryRun)) {
          const status = await backend.status(path, { force: true });
          return {
            content: formatGitActionSummary(paths?.length ? `Dry run: would stage ${paths.length} path${paths.length === 1 ? "" : "s"}.` : "Dry run: would stage all local changes.", status),
            data: createDryRunData({ paths: paths ?? [], status }) as JsonValue,
            ok: true,
          };
        }

        const result = await backend.stage(path, paths);
        return gitActionResult(result.message, result);
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not stage Git changes."));
      }
    },
    executorMetadata: { family: "git", version: 1 },
    id: "git_stage",
    inputSchema: {
      additionalProperties: false,
      properties: {
        dryRun: { description: "Preview the stage operation without running git add.", type: "boolean" },
        path: { description: "Repository path. Defaults to the first workspace root.", minLength: 1, type: "string" },
        paths: { description: "Optional path filters to stage.", items: { type: "string" }, type: "array" },
      },
      type: "object",
    },
    permission: "mutating",
    risk: "mutating",
    title: "Stage Git changes",
  };
}

function createGitCommitTool(backend: LocalGitBackend): ToolDefinition {
  return {
    description:
      "Create a local Git commit. Defaults to staging all local changes first. Use git_status and git_diff before committing.",
    execute: async (args, context) => {
      const path = resolveGitWorkspacePath(context, args.path);
      if (typeof path !== "string") {
        return path;
      }

      const message = stringArg(args.message);
      if (!message) {
        return createErrorResult("A commit message is required.");
      }

      const stageAll = args.stageAll !== false;

      try {
        if (booleanArg(args.dryRun)) {
          const status = await backend.status(path, { force: true });
          return {
            content: formatGitActionSummary(`Dry run: would create commit "${message}"${stageAll ? " after staging all changes" : ""}.`, status),
            data: createDryRunData({ message, stageAll, status }) as JsonValue,
            ok: true,
          };
        }

        const result = await backend.commit(path, message, stageAll);
        return gitActionResult(result.message, result);
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not create Git commit."));
      }
    },
    executorMetadata: { family: "git", version: 1 },
    id: "git_commit",
    inputSchema: {
      additionalProperties: false,
      properties: {
        dryRun: { description: "Preview the commit operation without creating a commit.", type: "boolean" },
        message: { description: "Commit message.", minLength: 1, type: "string" },
        path: { description: "Repository path. Defaults to the first workspace root.", minLength: 1, type: "string" },
        stageAll: { description: "Stage all changes before committing. Defaults to true.", type: "boolean" },
      },
      required: ["message"],
      type: "object",
    },
    permission: "mutating",
    risk: "mutating",
    title: "Commit Git changes",
  };
}

function createGitBranchTool(backend: LocalGitBackend): ToolDefinition {
  return {
    description: "Create and switch to a new local Git branch. Use the codex/ prefix unless the user asks for another name.",
    execute: async (args, context) => {
      const path = resolveGitWorkspacePath(context, args.path);
      if (typeof path !== "string") {
        return path;
      }

      const name = stringArg(args.name);
      if (!name) {
        return createErrorResult("A branch name is required.");
      }

      try {
        if (booleanArg(args.dryRun)) {
          const status = await backend.status(path, { force: true });
          return {
            content: formatGitActionSummary(`Dry run: would create and switch to branch ${name}.`, status),
            data: createDryRunData({ name, status }) as JsonValue,
            ok: true,
          };
        }

        const result = await backend.branch(path, name);
        return gitActionResult(result.message, result);
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not create Git branch."));
      }
    },
    executorMetadata: { family: "git", version: 1 },
    id: "git_branch",
    inputSchema: {
      additionalProperties: false,
      properties: {
        dryRun: { description: "Preview branch creation without running checkout.", type: "boolean" },
        name: { description: "New branch name.", minLength: 1, type: "string" },
        path: { description: "Repository path. Defaults to the first workspace root.", minLength: 1, type: "string" },
      },
      required: ["name"],
      type: "object",
    },
    permission: "mutating",
    risk: "mutating",
    title: "Create Git branch",
  };
}

function createGitPushTool(backend: LocalGitBackend): ToolDefinition {
  return {
    description: "Push the current local branch to a Git remote, setting upstream when needed. Requires publish approval.",
    execute: async (args, context) => {
      const path = resolveGitWorkspacePath(context, args.path);
      if (typeof path !== "string") {
        return path;
      }

      const remote = optionalStringArg(args.remote) ?? "origin";

      try {
        if (booleanArg(args.dryRun)) {
          const status = await backend.status(path, { force: true });
          return {
            content: formatGitActionSummary(`Dry run: would push ${status.branch || "the current branch"} to ${remote}.`, status),
            data: createDryRunData({ remote, status }) as JsonValue,
            ok: true,
          };
        }

        const result = await backend.push(path, remote);
        return gitActionResult(result.message, result);
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not push Git branch."));
      }
    },
    executorMetadata: { family: "git", version: 1 },
    id: "git_push",
    inputSchema: {
      additionalProperties: false,
      properties: {
        dryRun: { description: "Preview push target without running git push.", type: "boolean" },
        path: { description: "Repository path. Defaults to the first workspace root.", minLength: 1, type: "string" },
        remote: { description: "Remote name. Defaults to origin.", minLength: 1, type: "string" },
      },
      type: "object",
    },
    permission: "publish",
    risk: "publish",
    title: "Push Git branch",
  };
}

function createGitPullTool(backend: LocalGitBackend): ToolDefinition {
  return {
    description: "Pull the current local branch with fast-forward-only safety, or pull a specific remote branch.",
    execute: async (args, context) => {
      const path = resolveGitWorkspacePath(context, args.path);
      if (typeof path !== "string") {
        return path;
      }

      const remote = optionalStringArg(args.remote);
      const branch = optionalStringArg(args.branch);

      try {
        if (booleanArg(args.dryRun)) {
          const status = await backend.status(path, { force: true });
          return {
            content: formatGitActionSummary(`Dry run: would pull ${branch ? `${branch}${remote ? ` from ${remote}` : ""}` : "the current branch"}.`, status),
            data: createDryRunData({ branch: branch ?? null, remote: remote ?? null, status }) as JsonValue,
            ok: true,
          };
        }

        const result = await backend.pull(path, { branch, remote });
        return gitActionResult(result.message, result);
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not pull Git branch."));
      }
    },
    executorMetadata: { family: "git", version: 1 },
    id: "git_pull",
    inputSchema: {
      additionalProperties: false,
      properties: {
        branch: { description: "Optional remote branch to pull.", minLength: 1, type: "string" },
        dryRun: { description: "Preview pull target without running git pull.", type: "boolean" },
        path: { description: "Repository path. Defaults to the first workspace root.", minLength: 1, type: "string" },
        remote: { description: "Remote name. Defaults to origin when branch is provided.", minLength: 1, type: "string" },
      },
      type: "object",
    },
    permission: "mutating",
    risk: "network",
    title: "Pull Git branch",
  };
}

function createGitInitTool(backend: LocalGitBackend): ToolDefinition {
  return {
    description: "Initialize a local Git repository in the selected workspace folder.",
    execute: async (args, context) => {
      const path = resolveGitWorkspacePath(context, args.path);
      if (typeof path !== "string") {
        return path;
      }

      const initialBranch = optionalStringArg(args.initialBranch) ?? "main";

      try {
        if (booleanArg(args.dryRun)) {
          return {
            content: `Dry run: would initialize Git in ${path} with initial branch ${initialBranch}.`,
            data: createDryRunData({ initialBranch, path }) as JsonValue,
            ok: true,
          };
        }

        const result = await backend.init(path, initialBranch);
        return gitActionResult(result.message, result);
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not initialize Git repository."));
      }
    },
    executorMetadata: { family: "git", version: 1 },
    id: "git_init",
    inputSchema: {
      additionalProperties: false,
      properties: {
        dryRun: { description: "Preview Git init without changing files.", type: "boolean" },
        initialBranch: { description: "Initial branch name. Defaults to main.", minLength: 1, type: "string" },
        path: { description: "Repository path. Defaults to the first workspace root.", minLength: 1, type: "string" },
      },
      type: "object",
    },
    permission: "mutating",
    risk: "mutating",
    title: "Initialize Git repository",
  };
}

function gitActionResult(message: string, result: { output?: string; status: unknown }): ToolExecutionResult {
  return {
    content: [
      message,
      result.output ? `Git output: ${result.output}` : undefined,
      "",
      formatGitStatus(result.status as Parameters<typeof formatGitStatus>[0], { maxFiles: 24 }),
    ].filter(Boolean).join("\n"),
    data: result as unknown as JsonValue,
    ok: true,
  };
}
