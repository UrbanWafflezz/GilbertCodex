import { describe, expect, it, vi } from "vitest";
import { resolveToolPermission } from "../permissions";
import { ToolRegistry } from "../registry";
import type { ToolExecutionContext } from "../types";
import { createGitTools, type GitToolBackends } from "../tools/git";
import { validateToolArguments } from "../validation";

const context: ToolExecutionContext = {
  model: "test-model",
  permissionMode: "full-access",
  provider: "openai",
  workspaceRoots: ["C:\\repo"],
};

function createMockBackends(): GitToolBackends {
  const status = {
    additions: 3,
    ahead: 1,
    available: true,
    behind: 0,
    branch: "codex/git-tools",
    changedFiles: 1,
    clean: false,
    deletions: 1,
    files: [{ additions: 3, deletions: 1, diffTruncated: false, path: "src/app.ts", status: "M" }],
    repositoryRoot: "C:\\repo",
    upstream: "origin/codex/git-tools",
  };

  return {
    github: {
      account: vi.fn(async () => ({ connected: true, pluginInstalled: true, scopes: ["repo"], user: { htmlUrl: "https://github.com/kobe", id: 1, login: "kobe" } })),
      api: vi.fn(async () => ({ data: {}, message: "ok", method: "GET" as const, path: "/repos/o/r/issues", status: 200 })),
      commitFiles: vi.fn(async () => ({ branch: "main", commitHtmlUrl: "https://github.com/o/r/commit/abc", commitSha: "abcdef0", filesChanged: 1, parentSha: "1234567" })),
      createBranch: vi.fn(async () => ({ commitSha: "abcdef0", name: "codex/test", protected: false })),
      createPullRequest: vi.fn(async () => ({ htmlUrl: "https://github.com/o/r/pull/1", number: 1, state: "open", title: "Test" })),
      createRelease: vi.fn(async () => ({ draft: true, htmlUrl: "https://github.com/o/r/releases/tag/v1", id: 1, prerelease: false, tagName: "v1" })),
      dispatchWorkflow: vi.fn(async () => ({ refName: "main", workflowId: "ci.yml" })),
      generateReleaseNotes: vi.fn(async () => ({ body: "Notes", name: "v1" })),
      getRepository: vi.fn(async () => ({ defaultBranch: "main", fullName: "o/r", htmlUrl: "https://github.com/o/r", name: "r", ownerLogin: "o", permissions: { admin: true, pull: true, push: true }, private: false })),
      listBranches: vi.fn(async () => [{ commitSha: "abcdef0", name: "main", protected: false }]),
      listReleases: vi.fn(async () => []),
      listRepositories: vi.fn(async () => [{ defaultBranch: "main", fullName: "o/r", htmlUrl: "https://github.com/o/r", name: "r", ownerLogin: "o", permissions: { admin: true, pull: true, push: true }, private: false }]),
      listTree: vi.fn(async () => ({ branch: "main", commitSha: "abcdef0", entries: [{ kind: "blob", path: "README.md", sha: "1" }], truncated: false })),
      listWorkflowRuns: vi.fn(async () => ({ runs: [], totalCount: 0 })),
      listWorkflows: vi.fn(async () => ({ totalCount: 0, workflows: [] })),
      readFile: vi.fn(async () => ({ content: "hello", name: "README.md", path: "README.md", sha: "abcdef0", size: 5, truncated: false })),
      searchCode: vi.fn(async () => ({ incompleteResults: false, items: [], totalCount: 0 })),
      summarizeCodeSearchItems: vi.fn(() => "summary"),
    },
    local: {
      branch: vi.fn(async () => ({ message: "Created branch codex/test.", status })),
      commit: vi.fn(async () => ({ message: "Committed changes.", status })),
      diff: vi.fn(async () => ({ diff: "diff --git a/src/app.ts b/src/app.ts", path: "C:\\repo", repositoryRoot: "C:\\repo", status, truncated: false })),
      init: vi.fn(async () => ({ message: "Initialized Git repository.", status })),
      pull: vi.fn(async () => ({ message: "Pulled current branch.", status })),
      push: vi.fn(async () => ({ message: "Pushed codex/git-tools.", status })),
      stage: vi.fn(async () => ({ message: "Staged all local changes.", status })),
      status: vi.fn(async () => status),
    },
  };
}

describe("git bridge tools", () => {
  it("registers local Git and GitHub tools", () => {
    const registry = new ToolRegistry(createGitTools(createMockBackends()));

    expect(registry.get("git.status")?.id).toBe("git_status");
    expect(registry.get("git.diff")?.id).toBe("git_diff");
    expect(registry.get("github.read_file")?.id).toBe("github_read_file");
    expect(registry.get("github.create_pr")?.id).toBe("github_create_pull_request");
    expect(registry.get("github.issues")?.id).toBe("github_list_issues");
    expect(registry.get("github.completed_issues")?.id).toBe("github_list_completed_issues");
    expect(registry.get("github.issue_complete")?.id).toBe("github_close_issue");
    expect(registry.get("github.reopen_issue")?.id).toBe("github_reopen_issue");
    expect(registry.get("github.api_read")?.id).toBe("github_api_read");
  });

  it("uses the first workspace root for local Git status by default", async () => {
    const backends = createMockBackends();
    const tool = new ToolRegistry(createGitTools(backends)).get("git_status");

    const result = await tool!.execute({}, context);

    expect(result.ok).toBe(true);
    expect(result.content).toContain("codex/git-tools");
    expect(backends.local.status).toHaveBeenCalledWith("C:\\repo", { force: false, includeDiffPreview: false });
  });

  it("dry-runs local commits without calling commit", async () => {
    const backends = createMockBackends();
    const tool = new ToolRegistry(createGitTools(backends)).get("git_commit");

    const result = await tool!.execute({ dryRun: true, message: "test" }, context);

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Dry run");
    expect(backends.local.commit).not.toHaveBeenCalled();
    expect(backends.local.status).toHaveBeenCalled();
  });

  it("hard-gates publish tools even in full access", () => {
    const registry = new ToolRegistry(createGitTools(createMockBackends()));
    const pushTool = registry.get("git_push")!;
    const releaseTool = registry.get("github_create_release")!;
    const closeIssueTool = registry.get("github_close_issue")!;

    expect(resolveToolPermission(pushTool, { permissionMode: "full-access" })).toMatchObject({ allowed: false, requiresApproval: true });
    expect(resolveToolPermission(releaseTool, { permissionMode: "full-access" })).toMatchObject({ allowed: false, requiresApproval: true });
    expect(resolveToolPermission(closeIssueTool, { permissionMode: "full-access" })).toMatchObject({ allowed: false, requiresApproval: true });
  });

  it("normalizes and closes GitHub issues as completed", async () => {
    const backends = createMockBackends();
    backends.github.api = vi.fn(async () => ({
      data: { html_url: "https://github.com/o/r/issues/7", number: 7, title: "Fix bug" },
      message: "ok",
      method: "PATCH" as const,
      path: "/repos/o/r/issues/7",
      status: 200,
    }));
    const tool = new ToolRegistry(createGitTools(backends)).get("github_close_issue")!;
    const validation = validateToolArguments(tool, {
      issue_number: 7,
      owner: "o",
      repo: "r",
      state_reason: "completed",
    });

    expect(validation.ok).toBe(true);

    const result = await tool.execute(validation.args!, context);

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Closed issue #7 as completed");
    expect(backends.github.api).toHaveBeenCalledWith({
      body: { state: "closed", state_reason: "completed" },
      method: "PATCH",
      path: "/repos/o/r/issues/7",
    });
  });

  it("lists completed GitHub issues with the close-reason search qualifier", async () => {
    const backends = createMockBackends();
    backends.github.api = vi.fn(async () => ({
      data: {
        incomplete_results: false,
        items: [
          {
            closed_at: "2026-05-20T20:00:00Z",
            html_url: "https://github.com/o/r/issues/25",
            number: 25,
            state: "closed",
            state_reason: "completed",
            title: "Ship GitHub tool",
            user: { login: "kobe" },
          },
        ],
        total_count: 1,
      },
      message: "ok",
      method: "GET" as const,
      path: "/search/issues",
      status: 200,
    }));
    const tool = new ToolRegistry(createGitTools(backends)).get("github_list_completed_issues")!;

    const result = await tool.execute({ owner: "o", repo: "r" }, context);

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Completed GitHub issues for o/r: 1 of 1 returned");
    expect(result.content).toContain("reason: completed");
    expect(backends.github.api).toHaveBeenCalledWith({
      method: "GET",
      path: "/search/issues",
      query: {
        page: 1,
        per_page: 100,
        q: "repo:o/r is:issue is:closed reason:completed",
      },
    });
  });

  it("routes list issues with stateReason through GitHub issue search", async () => {
    const backends = createMockBackends();
    backends.github.api = vi.fn(async () => ({
      data: { incomplete_results: false, items: [], total_count: 0 },
      message: "ok",
      method: "GET" as const,
      path: "/search/issues",
      status: 200,
    }));
    const tool = new ToolRegistry(createGitTools(backends)).get("github_list_issues")!;
    const validation = validateToolArguments(tool, { owner: "o", repo: "r", state: "closed", state_reason: "completed" });

    expect(validation.ok).toBe(true);

    const result = await tool.execute(validation.args!, context);

    expect(result.ok).toBe(true);
    expect(result.content).toContain("No GitHub issues matched o/r with close reason completed");
    expect(backends.github.api).toHaveBeenCalledWith({
      method: "GET",
      path: "/search/issues",
      query: {
        page: 1,
        per_page: 100,
        q: "repo:o/r is:issue is:closed reason:completed",
      },
    });
  });

  it("dry-runs GitHub file commits without calling GitHub", async () => {
    const backends = createMockBackends();
    const tool = new ToolRegistry(createGitTools(backends)).get("github_commit_files");

    const result = await tool!.execute({
      dryRun: true,
      files: [{ content: "hello", path: "README.md" }],
      message: "Update README",
      owner: "o",
      repo: "r",
    }, context);

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Dry run");
    expect(backends.github.commitFiles).not.toHaveBeenCalled();
  });
});
