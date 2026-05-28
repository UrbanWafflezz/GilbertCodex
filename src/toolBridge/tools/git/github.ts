import type { JsonValue, ToolDefinition, ToolExecutionResult } from "../../types";
import { createMemoryEmbedding, scoreMemoryVectors } from "../../../memory/embedding";
import type { GithubBackend } from "./backend";
import {
  booleanArg,
  createDryRunData,
  createErrorResult,
  formatGithubRepository,
  formatRepositoryList,
  integerArg,
  optionalStringArg,
  readErrorMessage,
  stringArrayArg,
  stringArg,
} from "./format";

export function createGithubTools(backend: GithubBackend): ToolDefinition[] {
  return [
    createGithubAccountTool(backend),
    createGithubListRepositoriesTool(backend),
    createGithubGetRepositoryTool(backend),
    createGithubListBranchesTool(backend),
    createGithubListTreeTool(backend),
    createGithubReadFileTool(backend),
    createGithubSearchCodeTool(backend),
    createGithubSemanticSearchTool(backend),
    createGithubCreateBranchTool(backend),
    createGithubCommitFilesTool(backend),
    createGithubCreatePullRequestTool(backend),
    createGithubListTagsTool(backend),
    createGithubSearchIssuesTool(backend),
    createGithubListIssuesTool(backend),
    createGithubListCompletedIssuesTool(backend),
    createGithubGetIssueTool(backend),
    createGithubListIssueCommentsTool(backend),
    createGithubCreateIssueTool(backend),
    createGithubUpdateIssueTool(backend),
    createGithubCloseIssueTool(backend),
    createGithubReopenIssueTool(backend),
    createGithubMarkIssueDuplicateTool(backend),
    createGithubCommentIssueTool(backend),
    createGithubUpdateIssueCommentTool(backend),
    createGithubDeleteIssueCommentTool(backend),
    createGithubSetIssueLabelsTool(backend),
    createGithubAddIssueLabelsTool(backend),
    createGithubRemoveIssueLabelTool(backend),
    createGithubClearIssueLabelsTool(backend),
    createGithubAssignIssueTool(backend),
    createGithubUnassignIssueTool(backend),
    createGithubLockIssueTool(backend),
    createGithubUnlockIssueTool(backend),
    createGithubPinIssueTool(backend),
    createGithubUnpinIssueTool(backend),
    createGithubTransferIssueTool(backend),
    createGithubListMilestonesTool(backend),
    createGithubCreateMilestoneTool(backend),
    createGithubUpdateMilestoneTool(backend),
    createGithubDeleteMilestoneTool(backend),
    createGithubListPullRequestsTool(backend),
    createGithubGetPullRequestTool(backend),
    createGithubListPullRequestFilesTool(backend),
    createGithubListPullRequestCommitsTool(backend),
    createGithubListPullRequestReviewsTool(backend),
    createGithubCreatePullRequestReviewTool(backend),
    createGithubRequestPullRequestReviewersTool(backend),
    createGithubRemovePullRequestReviewersTool(backend),
    createGithubUpdatePullRequestBranchTool(backend),
    createGithubCheckPullRequestMergedTool(backend),
    createGithubUpdatePullRequestTool(backend),
    createGithubMergePullRequestTool(backend),
    createGithubSearchRepositoriesTool(backend),
    createGithubSearchUsersTool(backend),
    createGithubListCommitsTool(backend),
    createGithubGetCommitTool(backend),
    createGithubCompareRefsTool(backend),
    createGithubListContributorsTool(backend),
    createGithubListStargazersTool(backend),
    createGithubListForksTool(backend),
    createGithubCreateForkTool(backend),
    createGithubStarRepositoryTool(backend),
    createGithubUnstarRepositoryTool(backend),
    createGithubWatchRepositoryTool(backend),
    createGithubUnwatchRepositoryTool(backend),
    createGithubGenerateReleaseNotesTool(backend),
    createGithubListReleasesTool(backend),
    createGithubCreateReleaseTool(backend),
    createGithubListWorkflowsTool(backend),
    createGithubListWorkflowRunsTool(backend),
    createGithubDispatchWorkflowTool(backend),
    createGithubGetWorkflowRunTool(backend),
    createGithubListWorkflowRunJobsTool(backend),
    createGithubListWorkflowRunArtifactsTool(backend),
    createGithubApproveWorkflowRunTool(backend),
    createGithubRerunWorkflowRunTool(backend),
    createGithubCancelWorkflowRunTool(backend),
    createGithubForceCancelWorkflowRunTool(backend),
    createGithubGetPendingDeploymentsTool(backend),
    createGithubReviewPendingDeploymentsTool(backend),
    createGithubListCodeScanningAlertsTool(backend),
    createGithubListSecretScanningAlertsTool(backend),
    createGithubListDependabotAlertsTool(backend),
    createGithubListNotificationsTool(backend),
    createGithubMarkNotificationThreadReadTool(backend),
    createGithubMarkAllNotificationsReadTool(backend),
    createGithubApiReadTool(backend),
    createGithubApiWriteTool(backend),
    createGithubApiDeleteTool(backend),
  ];
}

function createGithubAccountTool(backend: GithubBackend): ToolDefinition {
  return githubReadTool({
    description: "Inspect the connected GitHub account state without exposing tokens.",
    execute: async () => {
      try {
        const state = await backend.account();
        return {
          content: state.connected && state.user
            ? `GitHub connected as ${state.user.login}. Scopes: ${state.scopes.join(", ") || "none reported"}.`
            : "GitHub is not connected in Settings.",
          data: state as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not read GitHub account state."));
      }
    },
    id: "github_account",
    inputSchema: { additionalProperties: false, properties: {}, type: "object" },
    title: "Check GitHub account",
  });
}

function createGithubListRepositoriesTool(backend: GithubBackend): ToolDefinition {
  return githubReadTool({
    description: "List repositories visible to the connected GitHub account.",
    execute: async (args) => {
      try {
        const repos = await backend.listRepositories({
          affiliation: optionalStringArg(args.affiliation),
          page: integerArg(args.page),
          perPage: integerArg(args.perPage),
          query: optionalStringArg(args.query),
          sort: optionalStringArg(args.sort),
          visibility: optionalStringArg(args.visibility),
        });
        return {
          content: formatRepositoryList(repos),
          data: { repositories: repos } as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not list GitHub repositories."));
      }
    },
    id: "github_list_repositories",
    inputSchema: {
      additionalProperties: false,
      properties: {
        affiliation: { description: "owner, collaborator, organization_member, or comma-separated values.", minLength: 1, type: "string" },
        page: { minimum: 1, type: "integer" },
        perPage: { minimum: 1, type: "integer" },
        query: { description: "Optional local repository-name filter.", minLength: 1, type: "string" },
        sort: { description: "GitHub repository sort option.", minLength: 1, type: "string" },
        visibility: { description: "all, public, or private.", minLength: 1, type: "string" },
      },
      type: "object",
    },
    title: "List GitHub repositories",
  });
}

function createGithubGetRepositoryTool(backend: GithubBackend): ToolDefinition {
  return githubReadTool({
    description: "Read metadata for one GitHub repository.",
    execute: async (args) => {
      const repo = readRepositoryArgs(args);
      if ("error" in repo) {
        return repo.error;
      }

      try {
        const repository = await backend.getRepository(repo);
        return {
          content: formatGithubRepository(repository),
          data: repository as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not read GitHub repository."));
      }
    },
    id: "github_get_repository",
    inputSchema: repositorySchema(),
    title: "Get GitHub repository",
  });
}

function createGithubListBranchesTool(backend: GithubBackend): ToolDefinition {
  return githubReadTool({
    description: "List branch heads for a GitHub repository.",
    execute: async (args) => {
      const repo = readRepositoryArgs(args);
      if ("error" in repo) {
        return repo.error;
      }

      try {
        const branches = await backend.listBranches({
          ...repo,
          page: integerArg(args.page),
          perPage: integerArg(args.perPage),
        });
        return {
          content: branches.length
            ? branches.map((branch, index) => `${index + 1}. ${branch.name} (${branch.commitSha.slice(0, 7)}${branch.protected ? ", protected" : ""})`).join("\n")
            : "No branches returned.",
          data: { branches } as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not list GitHub branches."));
      }
    },
    id: "github_list_branches",
    inputSchema: repositorySchema({
      page: { minimum: 1, type: "integer" },
      perPage: { minimum: 1, type: "integer" },
    }),
    title: "List GitHub branches",
  });
}

function createGithubListTreeTool(backend: GithubBackend): ToolDefinition {
  return githubReadTool({
    description: "List a repository file tree for remote project discovery.",
    execute: async (args) => {
      const repo = readRepositoryArgs(args);
      if ("error" in repo) {
        return repo.error;
      }

      try {
        const tree = await backend.listTree({
          ...repo,
          branch: optionalStringArg(args.branch),
          limit: integerArg(args.limit),
          recursive: args.recursive !== false,
        });
        const entries = tree.entries.map((entry, index) => `${index + 1}. ${entry.kind} ${entry.path}${entry.size ? ` (${entry.size} bytes)` : ""}`);
        return {
          content: [
            `Tree for ${repo.owner}/${repo.repo}@${tree.branch} (${tree.commitSha.slice(0, 7)}):`,
            ...entries,
            tree.truncated ? "Result was truncated by the GitHub tree command." : undefined,
          ].filter(Boolean).join("\n"),
          data: tree as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not list GitHub repository tree."));
      }
    },
    id: "github_list_tree",
    inputSchema: repositorySchema({
      branch: { minLength: 1, type: "string" },
      limit: { minimum: 1, type: "integer" },
      recursive: { type: "boolean" },
    }),
    title: "List GitHub repository tree",
  });
}

function createGithubReadFileTool(backend: GithubBackend): ToolDefinition {
  return githubReadTool({
    description: "Read one text file from a GitHub repository branch.",
    execute: async (args) => {
      const repo = readRepositoryArgs(args);
      if ("error" in repo) {
        return repo.error;
      }

      const path = stringArg(args.path);
      if (!path) {
        return createErrorResult("A GitHub file path is required.");
      }

      try {
        const file = await backend.readFile({
          ...repo,
          branch: optionalStringArg(args.branch),
          maxBytes: integerArg(args.maxBytes),
          path,
        });
        return {
          content: [
            `Read ${repo.owner}/${repo.repo}:${file.path}${file.branch ? ` on ${file.branch}` : ""}${file.truncated ? " (truncated)" : ""}.`,
            "",
            file.content,
          ].join("\n"),
          data: file as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not read GitHub file."));
      }
    },
    id: "github_read_file",
    inputSchema: repositorySchema({
      branch: { minLength: 1, type: "string" },
      maxBytes: { minimum: 1, type: "integer" },
      path: { minLength: 1, type: "string" },
    }, ["owner", "repo", "path"]),
    title: "Read GitHub file",
  });
}

function createGithubSearchCodeTool(backend: GithubBackend): ToolDefinition {
  return githubReadTool({
    description: "Search code through the GitHub API. Scope with owner, repo, and branch when possible.",
    execute: async (args) => {
      const query = stringArg(args.query);
      if (!query) {
        return createErrorResult("A GitHub code search query is required.");
      }

      try {
        const response = await backend.searchCode({
          branch: optionalStringArg(args.branch),
          owner: optionalStringArg(args.owner),
          page: integerArg(args.page),
          perPage: integerArg(args.perPage),
          query,
          repo: optionalStringArg(args.repo),
        });
        return {
          content: response.items.length
            ? [
                `GitHub code search returned ${response.items.length} of ${response.totalCount} result${response.totalCount === 1 ? "" : "s"}${response.incompleteResults ? " (incomplete)" : ""}.`,
                "",
                backend.summarizeCodeSearchItems(response.items),
              ].join("\n")
            : "No GitHub code search results matched.",
          data: response as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not search GitHub code."));
      }
    },
    id: "github_search_code",
    inputSchema: {
      additionalProperties: false,
      properties: {
        branch: { minLength: 1, type: "string" },
        owner: { minLength: 1, type: "string" },
        page: { minimum: 1, type: "integer" },
        perPage: { minimum: 1, type: "integer" },
        query: { minLength: 1, type: "string" },
        repo: { minLength: 1, type: "string" },
      },
      required: ["query"],
      type: "object",
    },
    title: "Search GitHub code",
  });
}

function createGithubSemanticSearchTool(backend: GithubBackend): ToolDefinition {
  return githubReadTool({
    description: "Run local vector-ranked GitHub discovery over repository metadata and code-search results.",
    execute: async (args) => {
      const query = stringArg(args.query);
      if (!query) {
        return createErrorResult("A semantic GitHub search query is required.");
      }

      const owner = optionalStringArg(args.owner);
      const repo = optionalStringArg(args.repo);
      const limit = integerArg(args.limit) ?? 8;
      const candidates: Array<{ kind: string; text: string; value: unknown; url?: string }> = [];

      try {
        if (owner && repo) {
          const repository = await backend.getRepository({ owner, repo });
          candidates.push({
            kind: "repository",
            text: [
              repository.fullName,
              repository.description,
              repository.defaultBranch,
              repository.language,
              repository.private ? "private" : "public",
              `${repository.stargazersCount ?? 0} stars`,
              `${repository.forksCount ?? 0} forks`,
            ].filter(Boolean).join(" "),
            url: repository.htmlUrl,
            value: repository,
          });
        } else {
          const repositories = await backend.listRepositories({
            page: integerArg(args.page),
            perPage: integerArg(args.perPage) ?? 50,
            query: owner ? undefined : query,
            sort: "updated",
          });
          repositories.forEach((repository) => {
            if (!owner || repository.ownerLogin.toLowerCase() === owner.toLowerCase()) {
              candidates.push({
                kind: "repository",
                text: [
                  repository.fullName,
                  repository.description,
                  repository.defaultBranch,
                  repository.language,
                  repository.private ? "private" : "public",
                  `${repository.stargazersCount ?? 0} stars`,
                  `${repository.forksCount ?? 0} forks`,
                ].filter(Boolean).join(" "),
                url: repository.htmlUrl,
                value: repository,
              });
            }
          });
        }

        try {
          const codeResults = await backend.searchCode({
            branch: optionalStringArg(args.branch),
            owner,
            page: integerArg(args.page),
            perPage: integerArg(args.perPage) ?? 25,
            query,
            repo,
          });
          codeResults.items.forEach((item) => {
            candidates.push({
              kind: "code",
              text: `${item.repositoryFullName} ${item.path} ${item.name} ${item.sha}`,
              url: item.htmlUrl,
              value: item,
            });
          });
        } catch {
          // Repository metadata still gives useful fuzzy discovery when code search rejects a natural-language query.
        }

        const ranked = rankGithubSemanticCandidates(query, candidates).slice(0, limit);

        return {
          content: ranked.length
            ? [
                `GitHub semantic search ranked ${ranked.length} result${ranked.length === 1 ? "" : "s"} with local vector scoring.`,
                "",
                ranked.map((item, index) => `${index + 1}. ${item.kind} score ${item.score.toFixed(3)} - ${item.label}${item.url ? `\n${item.url}` : ""}`).join("\n"),
              ].join("\n")
            : "No GitHub semantic search candidates matched.",
          data: { results: ranked } as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not run GitHub semantic search."));
      }
    },
    id: "github_semantic_search",
    inputSchema: {
      additionalProperties: false,
      properties: {
        branch: { minLength: 1, type: "string" },
        limit: { minimum: 1, type: "integer" },
        owner: { minLength: 1, type: "string" },
        page: { minimum: 1, type: "integer" },
        perPage: { minimum: 1, type: "integer" },
        query: { minLength: 1, type: "string" },
        repo: { minLength: 1, type: "string" },
      },
      required: ["query"],
      type: "object",
    },
    title: "Semantic GitHub search",
  });
}

function createGithubCreateBranchTool(backend: GithubBackend): ToolDefinition {
  return githubPublishTool({
    description: "Create a branch in a GitHub repository from the default branch or a selected base branch.",
    execute: async (args) => {
      const repo = readRepositoryArgs(args);
      if ("error" in repo) {
        return repo.error;
      }
      const newBranch = stringArg(args.newBranch);
      if (!newBranch) {
        return createErrorResult("newBranch is required.");
      }
      const request = { ...repo, baseBranch: optionalStringArg(args.baseBranch), newBranch };

      try {
        if (booleanArg(args.dryRun)) {
          return dryRunResult(`Dry run: would create branch ${newBranch} in ${repo.owner}/${repo.repo}.`, request);
        }
        const branch = await backend.createBranch(request);
        return {
          content: `Created branch ${branch.name} at ${branch.commitSha.slice(0, 7)}.`,
          data: branch as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not create GitHub branch."));
      }
    },
    id: "github_create_branch",
    inputSchema: repositorySchema({
      baseBranch: { minLength: 1, type: "string" },
      dryRun: { type: "boolean" },
      newBranch: { minLength: 1, type: "string" },
    }, ["owner", "repo", "newBranch"]),
    title: "Create GitHub branch",
  });
}

function createGithubCommitFilesTool(backend: GithubBackend): ToolDefinition {
  return githubPublishTool({
    description: "Commit one or more file writes/deletes directly through the GitHub API. Supports dryRun approval previews.",
    execute: async (args) => {
      const repo = readRepositoryArgs(args);
      if ("error" in repo) {
        return repo.error;
      }
      const message = stringArg(args.message);
      const files = normalizeCommitFiles(args.files);
      if (!message) {
        return createErrorResult("A commit message is required.");
      }
      if (files.length === 0) {
        return createErrorResult("At least one file change is required.");
      }
      const request = { ...repo, branch: optionalStringArg(args.branch), files, message };

      try {
        if (booleanArg(args.dryRun)) {
          return dryRunResult(`Dry run: would commit ${files.length} file${files.length === 1 ? "" : "s"} to ${repo.owner}/${repo.repo}${request.branch ? ` on ${request.branch}` : ""}.`, {
            ...request,
            files: files.map((file) => ({ operation: file.operation ?? "write", path: file.path })),
          });
        }
        const result = await backend.commitFiles(request);
        return {
          content: `Committed ${result.filesChanged} file${result.filesChanged === 1 ? "" : "s"} to ${repo.owner}/${repo.repo}@${result.branch}: ${result.commitHtmlUrl}`,
          data: result as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not commit files to GitHub."));
      }
    },
    id: "github_commit_files",
    inputSchema: repositorySchema({
      branch: { minLength: 1, type: "string" },
      dryRun: { type: "boolean" },
      files: {
        items: {
          additionalProperties: false,
          properties: {
            content: { type: "string" },
            operation: { enum: ["delete", "remove", "upsert", "write"], type: "string" },
            path: { minLength: 1, type: "string" },
          },
          required: ["path"],
          type: "object",
        },
        minItems: 1,
        type: "array",
      },
      message: { minLength: 1, type: "string" },
    }, ["owner", "repo", "files", "message"]),
    title: "Commit GitHub files",
  });
}

function createGithubCreatePullRequestTool(backend: GithubBackend): ToolDefinition {
  return githubPublishTool({
    description: "Create a GitHub pull request, defaulting to draft when requested.",
    execute: async (args) => {
      const repo = readRepositoryArgs(args);
      if ("error" in repo) {
        return repo.error;
      }
      const base = stringArg(args.base);
      const head = stringArg(args.head);
      const title = stringArg(args.title);
      if (!base || !head || !title) {
        return createErrorResult("base, head, and title are required.");
      }
      const request = {
        ...repo,
        base,
        body: optionalStringArg(args.body),
        draft: args.draft !== false,
        head,
        title,
      };

      try {
        if (booleanArg(args.dryRun)) {
          return dryRunResult(`Dry run: would open ${request.draft ? "draft " : ""}PR ${head} -> ${base} in ${repo.owner}/${repo.repo}.`, request);
        }
        const pr = await backend.createPullRequest(request);
        return {
          content: `Created PR #${pr.number}: ${pr.title}\n${pr.htmlUrl}`,
          data: pr as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not create GitHub pull request."));
      }
    },
    id: "github_create_pull_request",
    inputSchema: repositorySchema({
      base: { minLength: 1, type: "string" },
      body: { type: "string" },
      draft: { type: "boolean" },
      dryRun: { type: "boolean" },
      head: { minLength: 1, type: "string" },
      title: { minLength: 1, type: "string" },
    }, ["owner", "repo", "base", "head", "title"]),
    title: "Create GitHub pull request",
  });
}

function createGithubListTagsTool(backend: GithubBackend): ToolDefinition {
  return githubReadTool({
    description: "List repository tags and their target commit shas.",
    execute: async (args) => {
      const repo = readRepositoryArgs(args);
      if ("error" in repo) {
        return repo.error;
      }

      try {
        const response = await backend.api({
          method: "GET",
          path: `/repos/${repo.owner}/${repo.repo}/tags`,
          query: paginationQuery(args),
        });
        const items = Array.isArray(response.data) ? (response.data as unknown[]) : [];

        return {
          content: items.length
            ? items.map((item: unknown, index: number) => `${index + 1}. ${field(item, "name") || "tag"} (${field(item, "commit.sha")?.slice(0, 7) || "unknown"})`).join("\n")
            : "No GitHub tags returned.",
          data: response as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not list GitHub tags."));
      }
    },
    id: "github_list_tags",
    inputSchema: repositorySchema({
      page: { minimum: 1, type: "integer" },
      perPage: { minimum: 1, type: "integer" },
    }),
    title: "List GitHub tags",
  });
}

function createGithubSearchIssuesTool(backend: GithubBackend): ToolDefinition {
  return githubReadTool({
    description: "Search GitHub issues and pull requests with GitHub search qualifiers.",
    execute: async (args) => {
      const query = stringArg(args.query);
      if (!query) {
        return createErrorResult("query is required.");
      }

      try {
        const response = await backend.api({
          method: "GET",
          path: "/search/issues",
          query: compactQuery({
            order: optionalStringArg(args.order),
            page: integerArg(args.page),
            per_page: integerArg(args.perPage),
            q: query,
            sort: optionalStringArg(args.sort),
          }),
        });
        const items = Array.isArray((response.data as Record<string, unknown>)?.items)
          ? (response.data as Record<string, unknown>).items as unknown[]
          : [];
        return {
          content: items.length
            ? formatIssueList(items)
            : `No GitHub issues or pull requests matched: ${query}`,
          data: response as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not search GitHub issues."));
      }
    },
    id: "github_search_issues",
    inputSchema: {
      additionalProperties: false,
      properties: {
        order: { enum: ["asc", "desc"], type: "string" },
        page: { minimum: 1, type: "integer" },
        perPage: { minimum: 1, type: "integer" },
        query: { description: "GitHub issue search query, for example repo:OWNER/REPO is:issue is:open label:bug.", minLength: 1, type: "string" },
        sort: { enum: ["comments", "created", "interactions", "reactions", "reactions-+1", "reactions--1", "reactions-heart", "reactions-smile", "reactions-thinking_face", "updated"], type: "string" },
      },
      required: ["query"],
      type: "object",
    },
    title: "Search GitHub issues",
  });
}

function createGithubListIssuesTool(backend: GithubBackend): ToolDefinition {
  return githubReadTool({
    description: "List GitHub repository issues. Use state closed for closed issues. Use stateReason completed for completed-only closed issues. GitHub's issues endpoint can include pull requests; use github_list_pull_requests for PR-only views.",
    execute: async (args) => {
      const repo = readRepositoryArgs(args);
      if ("error" in repo) {
        return repo.error;
      }

      const stateReason = normalizeIssueCloseReason(optionalStringArg(args.stateReason));
      if (stateReason) {
        return searchRepositoryIssues(backend, {
          args,
          emptyMessage: `No GitHub issues matched ${repo.owner}/${repo.repo} with close reason ${stateReason}.`,
          extraQuery: optionalStringArg(args.query),
          repo,
          state: optionalStringArg(args.state) ?? "closed",
          stateReason,
        });
      }

      try {
        const response = await backend.api({
          method: "GET",
          path: `/repos/${repo.owner}/${repo.repo}/issues`,
          query: compactQuery({
            ...paginationQuery(args),
            assignee: optionalStringArg(args.assignee),
            creator: optionalStringArg(args.creator),
            direction: optionalStringArg(args.direction),
            labels: optionalStringArg(args.labels),
            mentioned: optionalStringArg(args.mentioned),
            milestone: optionalStringArg(args.milestone),
            since: optionalStringArg(args.since),
            sort: optionalStringArg(args.sort),
            state: optionalStringArg(args.state) ?? "open",
          }),
        });
        const issues = Array.isArray(response.data) ? response.data : [];

        return {
          content: formatIssueList(issues),
          data: response as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not list GitHub issues."));
      }
    },
    id: "github_list_issues",
    inputSchema: repositorySchema({
      assignee: { minLength: 1, type: "string" },
      creator: { minLength: 1, type: "string" },
      direction: { enum: ["asc", "desc"], type: "string" },
      labels: { minLength: 1, type: "string" },
      mentioned: { minLength: 1, type: "string" },
      milestone: { minLength: 1, type: "string" },
      page: { minimum: 1, type: "integer" },
      perPage: { minimum: 1, type: "integer" },
      query: { description: "Optional extra GitHub search text or qualifiers. Used when stateReason is supplied.", minLength: 1, type: "string" },
      since: { minLength: 1, type: "string" },
      sort: { enum: ["comments", "created", "updated"], type: "string" },
      state: { enum: ["all", "closed", "open"], type: "string" },
      stateReason: { enum: ["completed", "duplicate", "not_planned"], type: "string" },
    }),
    title: "List GitHub issues",
  });
}

function createGithubListCompletedIssuesTool(backend: GithubBackend): ToolDefinition {
  return githubReadTool({
    description: "List GitHub issues in a repository that were closed as completed. Uses GitHub issue search with is:issue is:closed reason:completed so completed issues are not confused with all closed issues.",
    execute: async (args) => {
      const repo = readRepositoryArgs(args);
      if ("error" in repo) {
        return repo.error;
      }

      return searchRepositoryIssues(backend, {
        args,
        defaultFetchAll: true,
        emptyMessage: `No completed GitHub issues matched ${repo.owner}/${repo.repo}.`,
        extraQuery: optionalStringArg(args.query),
        repo,
        state: "closed",
        stateReason: "completed",
        title: "Completed GitHub issues",
      });
    },
    id: "github_list_completed_issues",
    inputSchema: repositorySchema({
      fetchAll: { description: "When true, fetch sequential result pages up to maxPages. Defaults to true.", type: "boolean" },
      maxPages: { description: "Maximum pages to fetch when fetchAll is true. GitHub search returns up to 100 results per page.", maximum: 10, minimum: 1, type: "integer" },
      order: { enum: ["asc", "desc"], type: "string" },
      page: { minimum: 1, type: "integer" },
      perPage: { maximum: 100, minimum: 1, type: "integer" },
      query: { description: "Optional extra GitHub issue search text or qualifiers to append.", minLength: 1, type: "string" },
      sort: { enum: ["comments", "created", "interactions", "reactions", "reactions-+1", "reactions--1", "reactions-heart", "reactions-smile", "reactions-thinking_face", "updated"], type: "string" },
    }),
    title: "List completed GitHub issues",
  });
}

function createGithubGetIssueTool(backend: GithubBackend): ToolDefinition {
  return githubReadTool({
    description: "Read one GitHub issue by number.",
    execute: async (args) => {
      const repo = readRepositoryArgs(args);
      const issueNumber = integerArg(args.issueNumber);
      if ("error" in repo) {
        return repo.error;
      }
      if (!issueNumber) {
        return createErrorResult("issueNumber is required.");
      }

      try {
        const response = await backend.api({ method: "GET", path: `/repos/${repo.owner}/${repo.repo}/issues/${issueNumber}` });
        return {
          content: formatIssueDetail(response.data),
          data: response as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not read GitHub issue."));
      }
    },
    id: "github_get_issue",
    inputSchema: repositorySchema({
      issueNumber: { minimum: 1, type: "integer" },
    }, ["owner", "repo", "issueNumber"]),
    title: "Get GitHub issue",
  });
}

function createGithubListIssueCommentsTool(backend: GithubBackend): ToolDefinition {
  return createGithubEndpointTool(backend, {
    description: "List comments on a GitHub issue or pull request conversation.",
    format: (data) => formatGenericList(data, "GitHub issue comments", (item, index) => {
      const user = field(item, "user.login");
      const body = field(item, "body");
      return `${index + 1}. ${user || "unknown"}: ${body.slice(0, 180)}${body.length > 180 ? "..." : ""}${field(item, "html_url") ? `\n${field(item, "html_url")}` : ""}`;
    }),
    id: "github_list_issue_comments",
    kind: "read",
    method: "GET",
    path: (repo, args) => `/repos/${repo.owner}/${repo.repo}/issues/${integerArg(args.issueNumber)}/comments`,
    properties: {
      issueNumber: { minimum: 1, type: "integer" },
      page: { minimum: 1, type: "integer" },
      perPage: { minimum: 1, type: "integer" },
      since: { minLength: 1, type: "string" },
    },
    query: (args) => compactQuery({ ...paginationQuery(args), since: optionalStringArg(args.since) }),
    required: ["issueNumber"],
    title: "List GitHub issue comments",
  });
}

function createGithubCreateIssueTool(backend: GithubBackend): ToolDefinition {
  return githubPublishTool({
    description: "Create a GitHub issue.",
    execute: async (args) => {
      const repo = readRepositoryArgs(args);
      if ("error" in repo) {
        return repo.error;
      }
      const title = stringArg(args.title);
      if (!title) {
        return createErrorResult("title is required.");
      }
      const request = {
        assignees: stringArrayArg(args.assignees),
        body: optionalStringArg(args.body),
        labels: stringArrayArg(args.labels),
        milestone: integerArg(args.milestone),
        title,
      };

      try {
        if (booleanArg(args.dryRun)) {
          return dryRunResult(`Dry run: would create issue "${title}" in ${repo.owner}/${repo.repo}.`, request);
        }
        const response = await backend.api({
          body: compactQuery(request),
          method: "POST",
          path: `/repos/${repo.owner}/${repo.repo}/issues`,
        });
        return { content: `Created issue #${field(response.data, "number")}: ${field(response.data, "title")}\n${field(response.data, "html_url")}`, data: response as unknown as JsonValue, ok: true };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not create GitHub issue."));
      }
    },
    id: "github_create_issue",
    inputSchema: repositorySchema({
      assignees: { items: { type: "string" }, type: "array" },
      body: { type: "string" },
      dryRun: { type: "boolean" },
      labels: { items: { type: "string" }, type: "array" },
      milestone: { minimum: 1, type: "integer" },
      title: { minLength: 1, type: "string" },
    }, ["owner", "repo", "title"]),
    title: "Create GitHub issue",
  });
}

function createGithubUpdateIssueTool(backend: GithubBackend): ToolDefinition {
  return githubPublishTool({
    description: "Update a GitHub issue, including state, labels, assignees, body, title, and milestone.",
    execute: async (args) => {
      const repo = readRepositoryArgs(args);
      const issueNumber = integerArg(args.issueNumber);
      if ("error" in repo) {
        return repo.error;
      }
      if (!issueNumber) {
        return createErrorResult("issueNumber is required.");
      }
      const request = compactQuery({
        assignees: stringArrayArg(args.assignees),
        body: optionalStringArg(args.body),
        issue_field_values: Array.isArray(args.issueFieldValues) ? args.issueFieldValues : undefined,
        labels: stringArrayArg(args.labels),
        milestone: Object.prototype.hasOwnProperty.call(args, "milestone") && args.milestone === null ? null : integerArg(args.milestone),
        state: optionalStringArg(args.state),
        state_reason: optionalStringArg(args.stateReason),
        title: optionalStringArg(args.title),
        type: Object.prototype.hasOwnProperty.call(args, "issueType") ? args.issueType : undefined,
      });
      if (Object.keys(request).length === 0) {
        return createErrorResult("At least one issue update field is required.");
      }

      try {
        if (booleanArg(args.dryRun)) {
          return dryRunResult(`Dry run: would update issue #${issueNumber} in ${repo.owner}/${repo.repo}.`, request);
        }
        const response = await backend.api({ body: request, method: "PATCH", path: `/repos/${repo.owner}/${repo.repo}/issues/${issueNumber}` });
        return { content: `Updated issue #${field(response.data, "number")}: ${field(response.data, "title")}\n${field(response.data, "html_url")}`, data: response as unknown as JsonValue, ok: true };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not update GitHub issue."));
      }
    },
    id: "github_update_issue",
    inputSchema: repositorySchema({
      assignees: { items: { type: "string" }, type: "array" },
      body: { type: "string" },
      dryRun: { type: "boolean" },
      issueNumber: { minimum: 1, type: "integer" },
      issueFieldValues: { items: { additionalProperties: true, type: "object" }, type: "array" },
      issueType: { type: ["string", "null"] },
      labels: { items: { type: "string" }, type: "array" },
      milestone: { minimum: 1, type: ["integer", "null"] },
      state: { enum: ["closed", "open"], type: "string" },
      stateReason: { enum: ["completed", "duplicate", "not_planned", "reopened"], type: "string" },
      title: { minLength: 1, type: "string" },
    }, ["owner", "repo", "issueNumber"]),
    title: "Update GitHub issue",
  });
}

function createGithubCloseIssueTool(backend: GithubBackend): ToolDefinition {
  return githubPublishTool({
    description: "Close or complete a GitHub issue. Use stateReason completed for fixed/done issues, not_planned for won't-fix, or duplicate for duplicate issues.",
    execute: async (args) => {
      const repo = readRepositoryArgs(args);
      const issueNumber = integerArg(args.issueNumber);
      if ("error" in repo) {
        return repo.error;
      }
      if (!issueNumber) {
        return createErrorResult("issueNumber is required.");
      }
      const request = {
        state: "closed",
        state_reason: optionalStringArg(args.stateReason) ?? "completed",
      };

      try {
        if (booleanArg(args.dryRun)) {
          return dryRunResult(`Dry run: would close issue #${issueNumber} in ${repo.owner}/${repo.repo}.`, request);
        }
        const response = await backend.api({ body: request, method: "PATCH", path: `/repos/${repo.owner}/${repo.repo}/issues/${issueNumber}` });
        return { content: `Closed issue #${field(response.data, "number")} as ${request.state_reason}.\n${field(response.data, "html_url")}`, data: response as unknown as JsonValue, ok: true };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not close GitHub issue."));
      }
    },
    id: "github_close_issue",
    inputSchema: repositorySchema({
      dryRun: { type: "boolean" },
      issueNumber: { minimum: 1, type: "integer" },
      state: { enum: ["closed"], type: "string" },
      stateReason: { enum: ["completed", "duplicate", "not_planned"], type: "string" },
    }, ["owner", "repo", "issueNumber"]),
    title: "Close GitHub issue",
  });
}

function createGithubReopenIssueTool(backend: GithubBackend): ToolDefinition {
  return createGithubEndpointTool(backend, {
    body: () => ({ state: "open", state_reason: "reopened" }),
    description: "Reopen a closed GitHub issue.",
    format: (data) => `Reopened issue #${field(data, "number")}.\n${field(data, "html_url")}`,
    id: "github_reopen_issue",
    kind: "mutating",
    method: "PATCH",
    path: (repo, args) => `/repos/${repo.owner}/${repo.repo}/issues/${integerArg(args.issueNumber)}`,
    properties: {
      issueNumber: { minimum: 1, type: "integer" },
      state: { enum: ["open"], type: "string" },
      stateReason: { enum: ["reopened"], type: "string" },
    },
    required: ["issueNumber"],
    title: "Reopen GitHub issue",
  });
}

function createGithubMarkIssueDuplicateTool(backend: GithubBackend): ToolDefinition {
  return createGithubEndpointTool(backend, {
    body: () => ({ state: "closed", state_reason: "duplicate" }),
    description: "Close a GitHub issue as a duplicate.",
    format: (data) => `Marked issue #${field(data, "number")} as duplicate.\n${field(data, "html_url")}`,
    id: "github_mark_issue_duplicate",
    kind: "mutating",
    method: "PATCH",
    path: (repo, args) => `/repos/${repo.owner}/${repo.repo}/issues/${integerArg(args.issueNumber)}`,
    properties: {
      issueNumber: { minimum: 1, type: "integer" },
      state: { enum: ["closed"], type: "string" },
      stateReason: { enum: ["duplicate"], type: "string" },
    },
    required: ["issueNumber"],
    title: "Mark GitHub issue duplicate",
  });
}

function createGithubCommentIssueTool(backend: GithubBackend): ToolDefinition {
  return githubPublishTool({
    description: "Add a comment to a GitHub issue or pull request conversation.",
    execute: async (args) => {
      const repo = readRepositoryArgs(args);
      const issueNumber = integerArg(args.issueNumber);
      const body = stringArg(args.body);
      if ("error" in repo) {
        return repo.error;
      }
      if (!issueNumber || !body) {
        return createErrorResult("issueNumber and body are required.");
      }

      try {
        if (booleanArg(args.dryRun)) {
          return dryRunResult(`Dry run: would comment on issue/PR #${issueNumber} in ${repo.owner}/${repo.repo}.`, { body, issueNumber });
        }
        const response = await backend.api({ body: { body }, method: "POST", path: `/repos/${repo.owner}/${repo.repo}/issues/${issueNumber}/comments` });
        return { content: `Commented on issue/PR #${issueNumber}.\n${field(response.data, "html_url")}`, data: response as unknown as JsonValue, ok: true };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not comment on GitHub issue."));
      }
    },
    id: "github_comment_issue",
    inputSchema: repositorySchema({
      body: { minLength: 1, type: "string" },
      dryRun: { type: "boolean" },
      issueNumber: { minimum: 1, type: "integer" },
    }, ["owner", "repo", "issueNumber", "body"]),
    title: "Comment on GitHub issue",
  });
}

function createGithubUpdateIssueCommentTool(backend: GithubBackend): ToolDefinition {
  return createGithubEndpointTool(backend, {
    body: (args) => ({ body: stringArg(args.body) }),
    description: "Update an existing GitHub issue or pull request comment.",
    format: (data) => `Updated GitHub comment ${field(data, "id")}.\n${field(data, "html_url")}`,
    id: "github_update_issue_comment",
    kind: "mutating",
    method: "PATCH",
    path: (repo, args) => `/repos/${repo.owner}/${repo.repo}/issues/comments/${integerArg(args.commentId)}`,
    properties: {
      body: { minLength: 1, type: "string" },
      commentId: { minimum: 1, type: "integer" },
    },
    required: ["commentId", "body"],
    title: "Update GitHub issue comment",
  });
}

function createGithubDeleteIssueCommentTool(backend: GithubBackend): ToolDefinition {
  return createGithubEndpointTool(backend, {
    description: "Delete a GitHub issue or pull request comment.",
    format: (_data, args) => `Deleted GitHub issue comment ${integerArg(args.commentId)}.`,
    id: "github_delete_issue_comment",
    kind: "destructive",
    method: "DELETE",
    path: (repo, args) => `/repos/${repo.owner}/${repo.repo}/issues/comments/${integerArg(args.commentId)}`,
    properties: { commentId: { minimum: 1, type: "integer" } },
    required: ["commentId"],
    title: "Delete GitHub issue comment",
  });
}

function createGithubSetIssueLabelsTool(backend: GithubBackend): ToolDefinition {
  return createGithubEndpointTool(backend, {
    body: (args) => ({ labels: stringArrayArg(args.labels) ?? [] }),
    description: "Replace all labels on a GitHub issue. Pass an empty labels array to clear labels.",
    format: (data) => formatLabelList(data, "Set GitHub issue labels."),
    id: "github_set_issue_labels",
    kind: "mutating",
    method: "PUT",
    path: (repo, args) => `/repos/${repo.owner}/${repo.repo}/issues/${integerArg(args.issueNumber)}/labels`,
    properties: {
      issueNumber: { minimum: 1, type: "integer" },
      labels: { items: { type: "string" }, type: "array" },
    },
    required: ["issueNumber", "labels"],
    title: "Set GitHub issue labels",
  });
}

function createGithubAddIssueLabelsTool(backend: GithubBackend): ToolDefinition {
  return createGithubEndpointTool(backend, {
    body: (args) => ({ labels: stringArrayArg(args.labels) ?? [] }),
    description: "Add labels to a GitHub issue without replacing existing labels.",
    format: (data) => formatLabelList(data, "Added GitHub issue labels."),
    id: "github_add_issue_labels",
    kind: "mutating",
    method: "POST",
    path: (repo, args) => `/repos/${repo.owner}/${repo.repo}/issues/${integerArg(args.issueNumber)}/labels`,
    properties: {
      issueNumber: { minimum: 1, type: "integer" },
      labels: { items: { type: "string" }, type: "array" },
    },
    required: ["issueNumber", "labels"],
    title: "Add GitHub issue labels",
  });
}

function createGithubRemoveIssueLabelTool(backend: GithubBackend): ToolDefinition {
  return createGithubEndpointTool(backend, {
    description: "Remove one label from a GitHub issue.",
    format: (_data, args) => `Removed label "${stringArg(args.label)}" from issue #${integerArg(args.issueNumber)}.`,
    id: "github_remove_issue_label",
    kind: "mutating",
    method: "DELETE",
    path: (repo, args) => `/repos/${repo.owner}/${repo.repo}/issues/${integerArg(args.issueNumber)}/labels/${encodeURIComponent(stringArg(args.label))}`,
    properties: {
      issueNumber: { minimum: 1, type: "integer" },
      label: { minLength: 1, type: "string" },
    },
    required: ["issueNumber", "label"],
    title: "Remove GitHub issue label",
  });
}

function createGithubClearIssueLabelsTool(backend: GithubBackend): ToolDefinition {
  return createGithubEndpointTool(backend, {
    description: "Remove all labels from a GitHub issue.",
    format: (_data, args) => `Cleared labels from issue #${integerArg(args.issueNumber)}.`,
    id: "github_clear_issue_labels",
    kind: "mutating",
    method: "DELETE",
    path: (repo, args) => `/repos/${repo.owner}/${repo.repo}/issues/${integerArg(args.issueNumber)}/labels`,
    properties: { issueNumber: { minimum: 1, type: "integer" } },
    required: ["issueNumber"],
    title: "Clear GitHub issue labels",
  });
}

function createGithubAssignIssueTool(backend: GithubBackend): ToolDefinition {
  return createGithubEndpointTool(backend, {
    body: (args) => ({ assignees: stringArrayArg(args.assignees) ?? [] }),
    description: "Add assignees to a GitHub issue.",
    format: (data) => `Updated GitHub issue assignees: ${formatUsers(data) || "none returned"}.`,
    id: "github_assign_issue",
    kind: "mutating",
    method: "POST",
    path: (repo, args) => `/repos/${repo.owner}/${repo.repo}/issues/${integerArg(args.issueNumber)}/assignees`,
    properties: {
      assignees: { items: { type: "string" }, type: "array" },
      issueNumber: { minimum: 1, type: "integer" },
    },
    required: ["issueNumber", "assignees"],
    title: "Assign GitHub issue",
  });
}

function createGithubUnassignIssueTool(backend: GithubBackend): ToolDefinition {
  return createGithubEndpointTool(backend, {
    body: (args) => ({ assignees: stringArrayArg(args.assignees) ?? [] }),
    description: "Remove assignees from a GitHub issue.",
    format: (data) => `Updated GitHub issue assignees: ${formatUsers(data) || "none returned"}.`,
    id: "github_unassign_issue",
    kind: "mutating",
    method: "DELETE",
    path: (repo, args) => `/repos/${repo.owner}/${repo.repo}/issues/${integerArg(args.issueNumber)}/assignees`,
    properties: {
      assignees: { items: { type: "string" }, type: "array" },
      issueNumber: { minimum: 1, type: "integer" },
    },
    required: ["issueNumber", "assignees"],
    title: "Unassign GitHub issue",
  });
}

function createGithubLockIssueTool(backend: GithubBackend): ToolDefinition {
  return createGithubEndpointTool(backend, {
    body: (args) => compactQuery({ lock_reason: optionalStringArg(args.lockReason) }),
    description: "Lock conversation on a GitHub issue or pull request.",
    format: (_data, args) => `Locked issue/PR #${integerArg(args.issueNumber)}.`,
    id: "github_lock_issue",
    kind: "mutating",
    method: "PUT",
    path: (repo, args) => `/repos/${repo.owner}/${repo.repo}/issues/${integerArg(args.issueNumber)}/lock`,
    properties: {
      issueNumber: { minimum: 1, type: "integer" },
      lockReason: { enum: ["off-topic", "resolved", "spam", "too heated"], type: "string" },
    },
    required: ["issueNumber"],
    title: "Lock GitHub issue",
  });
}

function createGithubUnlockIssueTool(backend: GithubBackend): ToolDefinition {
  return createGithubEndpointTool(backend, {
    description: "Unlock conversation on a GitHub issue or pull request.",
    format: (_data, args) => `Unlocked issue/PR #${integerArg(args.issueNumber)}.`,
    id: "github_unlock_issue",
    kind: "mutating",
    method: "DELETE",
    path: (repo, args) => `/repos/${repo.owner}/${repo.repo}/issues/${integerArg(args.issueNumber)}/lock`,
    properties: { issueNumber: { minimum: 1, type: "integer" } },
    required: ["issueNumber"],
    title: "Unlock GitHub issue",
  });
}

function createGithubPinIssueTool(backend: GithubBackend): ToolDefinition {
  return createGithubEndpointTool(backend, {
    description: "Pin a GitHub issue in a repository.",
    format: (_data, args) => `Pinned issue #${integerArg(args.issueNumber)}.`,
    id: "github_pin_issue",
    kind: "mutating",
    method: "PUT",
    path: (repo, args) => `/repos/${repo.owner}/${repo.repo}/issues/${integerArg(args.issueNumber)}/pin`,
    properties: { issueNumber: { minimum: 1, type: "integer" } },
    required: ["issueNumber"],
    title: "Pin GitHub issue",
  });
}

function createGithubUnpinIssueTool(backend: GithubBackend): ToolDefinition {
  return createGithubEndpointTool(backend, {
    description: "Unpin a GitHub issue in a repository.",
    format: (_data, args) => `Unpinned issue #${integerArg(args.issueNumber)}.`,
    id: "github_unpin_issue",
    kind: "mutating",
    method: "DELETE",
    path: (repo, args) => `/repos/${repo.owner}/${repo.repo}/issues/${integerArg(args.issueNumber)}/pin`,
    properties: { issueNumber: { minimum: 1, type: "integer" } },
    required: ["issueNumber"],
    title: "Unpin GitHub issue",
  });
}

function createGithubTransferIssueTool(backend: GithubBackend): ToolDefinition {
  return createGithubEndpointTool(backend, {
    body: (args) => ({
      new_owner: optionalStringArg(args.targetOwner),
      new_repository: stringArg(args.targetRepo),
    }),
    description: "Transfer a GitHub issue to another repository.",
    format: (data) => `Transferred issue to ${field(data, "repository_url") || "target repository"}.\n${field(data, "html_url")}`,
    id: "github_transfer_issue",
    kind: "mutating",
    method: "POST",
    path: (repo, args) => `/repos/${repo.owner}/${repo.repo}/issues/${integerArg(args.issueNumber)}/transfer`,
    properties: {
      issueNumber: { minimum: 1, type: "integer" },
      targetOwner: { minLength: 1, type: "string" },
      targetRepo: { minLength: 1, type: "string" },
    },
    required: ["issueNumber", "targetRepo"],
    title: "Transfer GitHub issue",
  });
}

function createGithubListMilestonesTool(backend: GithubBackend): ToolDefinition {
  return createGithubEndpointTool(backend, {
    description: "List GitHub issue milestones for a repository.",
    format: (data) => formatGenericList(data, "GitHub milestones", (item, index) => `${index + 1}. #${field(item, "number")} ${field(item, "title")} (${field(item, "state") || "unknown"}, open ${field(item, "open_issues") || "0"}, closed ${field(item, "closed_issues") || "0"})`),
    id: "github_list_milestones",
    kind: "read",
    method: "GET",
    path: (repo) => `/repos/${repo.owner}/${repo.repo}/milestones`,
    properties: {
      direction: { enum: ["asc", "desc"], type: "string" },
      page: { minimum: 1, type: "integer" },
      perPage: { minimum: 1, type: "integer" },
      sort: { enum: ["completeness", "due_on"], type: "string" },
      state: { enum: ["all", "closed", "open"], type: "string" },
    },
    query: (args) => compactQuery({ ...paginationQuery(args), direction: optionalStringArg(args.direction), sort: optionalStringArg(args.sort), state: optionalStringArg(args.state) }),
    title: "List GitHub milestones",
  });
}

function createGithubCreateMilestoneTool(backend: GithubBackend): ToolDefinition {
  return createGithubEndpointTool(backend, {
    body: (args) => compactQuery({ description: optionalStringArg(args.description), due_on: optionalStringArg(args.dueOn), state: optionalStringArg(args.state), title: stringArg(args.title) }),
    description: "Create a GitHub milestone.",
    format: (data) => `Created milestone #${field(data, "number")}: ${field(data, "title")}\n${field(data, "html_url")}`,
    id: "github_create_milestone",
    kind: "mutating",
    method: "POST",
    path: (repo) => `/repos/${repo.owner}/${repo.repo}/milestones`,
    properties: {
      description: { type: "string" },
      dueOn: { minLength: 1, type: "string" },
      state: { enum: ["closed", "open"], type: "string" },
      title: { minLength: 1, type: "string" },
    },
    required: ["title"],
    title: "Create GitHub milestone",
  });
}

function createGithubUpdateMilestoneTool(backend: GithubBackend): ToolDefinition {
  return createGithubEndpointTool(backend, {
    body: (args) => compactQuery({ description: optionalStringArg(args.description), due_on: optionalStringArg(args.dueOn), state: optionalStringArg(args.state), title: optionalStringArg(args.title) }),
    description: "Update or close a GitHub milestone.",
    format: (data) => `Updated milestone #${field(data, "number")}: ${field(data, "title")}\n${field(data, "html_url")}`,
    id: "github_update_milestone",
    kind: "mutating",
    method: "PATCH",
    path: (repo, args) => `/repos/${repo.owner}/${repo.repo}/milestones/${integerArg(args.milestoneNumber)}`,
    properties: {
      description: { type: "string" },
      dueOn: { minLength: 1, type: "string" },
      milestoneNumber: { minimum: 1, type: "integer" },
      state: { enum: ["closed", "open"], type: "string" },
      title: { minLength: 1, type: "string" },
    },
    required: ["milestoneNumber"],
    title: "Update GitHub milestone",
  });
}

function createGithubDeleteMilestoneTool(backend: GithubBackend): ToolDefinition {
  return createGithubEndpointTool(backend, {
    description: "Delete a GitHub milestone.",
    format: (_data, args) => `Deleted milestone #${integerArg(args.milestoneNumber)}.`,
    id: "github_delete_milestone",
    kind: "destructive",
    method: "DELETE",
    path: (repo, args) => `/repos/${repo.owner}/${repo.repo}/milestones/${integerArg(args.milestoneNumber)}`,
    properties: { milestoneNumber: { minimum: 1, type: "integer" } },
    required: ["milestoneNumber"],
    title: "Delete GitHub milestone",
  });
}

function createGithubListPullRequestsTool(backend: GithubBackend): ToolDefinition {
  return githubReadTool({
    description: "List pull requests for a GitHub repository.",
    execute: async (args) => {
      const repo = readRepositoryArgs(args);
      if ("error" in repo) {
        return repo.error;
      }

      try {
        const response = await backend.api({
          method: "GET",
          path: `/repos/${repo.owner}/${repo.repo}/pulls`,
          query: compactQuery({
            ...paginationQuery(args),
            base: optionalStringArg(args.base),
            direction: optionalStringArg(args.direction),
            head: optionalStringArg(args.head),
            sort: optionalStringArg(args.sort),
            state: optionalStringArg(args.state) ?? "open",
          }),
        });
        const pulls = Array.isArray(response.data) ? response.data : [];
        return { content: formatPullRequestList(pulls), data: response as unknown as JsonValue, ok: true };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not list GitHub pull requests."));
      }
    },
    id: "github_list_pull_requests",
    inputSchema: repositorySchema({
      base: { minLength: 1, type: "string" },
      direction: { enum: ["asc", "desc"], type: "string" },
      head: { minLength: 1, type: "string" },
      page: { minimum: 1, type: "integer" },
      perPage: { minimum: 1, type: "integer" },
      sort: { enum: ["created", "long-running", "popularity", "updated"], type: "string" },
      state: { enum: ["all", "closed", "open"], type: "string" },
    }),
    title: "List GitHub pull requests",
  });
}

function createGithubGetPullRequestTool(backend: GithubBackend): ToolDefinition {
  return githubReadTool({
    description: "Read one GitHub pull request by number.",
    execute: async (args) => {
      const repo = readRepositoryArgs(args);
      const pullNumber = integerArg(args.pullNumber);
      if ("error" in repo) {
        return repo.error;
      }
      if (!pullNumber) {
        return createErrorResult("pullNumber is required.");
      }

      try {
        const response = await backend.api({ method: "GET", path: `/repos/${repo.owner}/${repo.repo}/pulls/${pullNumber}` });
        return { content: formatPullRequestDetail(response.data), data: response as unknown as JsonValue, ok: true };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not read GitHub pull request."));
      }
    },
    id: "github_get_pull_request",
    inputSchema: repositorySchema({
      pullNumber: { minimum: 1, type: "integer" },
    }, ["owner", "repo", "pullNumber"]),
    title: "Get GitHub pull request",
  });
}

function createGithubListPullRequestFilesTool(backend: GithubBackend): ToolDefinition {
  return createGithubEndpointTool(backend, {
    description: "List files changed by a GitHub pull request.",
    format: (data) => formatGenericList(data, "GitHub pull request files", (item, index) => `${index + 1}. ${field(item, "filename")} (${field(item, "status") || "changed"}, +${field(item, "additions") || "0"} -${field(item, "deletions") || "0"})`),
    id: "github_list_pull_request_files",
    kind: "read",
    method: "GET",
    path: (repo, args) => `/repos/${repo.owner}/${repo.repo}/pulls/${integerArg(args.pullNumber)}/files`,
    properties: {
      page: { minimum: 1, type: "integer" },
      perPage: { minimum: 1, type: "integer" },
      pullNumber: { minimum: 1, type: "integer" },
    },
    query: paginationQuery,
    required: ["pullNumber"],
    title: "List GitHub pull request files",
  });
}

function createGithubListPullRequestCommitsTool(backend: GithubBackend): ToolDefinition {
  return createGithubEndpointTool(backend, {
    description: "List commits in a GitHub pull request.",
    format: (data) => formatGenericList(data, "GitHub pull request commits", (item, index) => `${index + 1}. ${field(item, "sha").slice(0, 7)} ${field(item, "commit.message").split("\n")[0]} (${field(item, "commit.author.name") || "unknown"})`),
    id: "github_list_pull_request_commits",
    kind: "read",
    method: "GET",
    path: (repo, args) => `/repos/${repo.owner}/${repo.repo}/pulls/${integerArg(args.pullNumber)}/commits`,
    properties: {
      page: { minimum: 1, type: "integer" },
      perPage: { minimum: 1, type: "integer" },
      pullNumber: { minimum: 1, type: "integer" },
    },
    query: paginationQuery,
    required: ["pullNumber"],
    title: "List GitHub pull request commits",
  });
}

function createGithubListPullRequestReviewsTool(backend: GithubBackend): ToolDefinition {
  return createGithubEndpointTool(backend, {
    description: "List reviews on a GitHub pull request.",
    format: (data) => formatGenericList(data, "GitHub pull request reviews", (item, index) => `${index + 1}. ${field(item, "user.login") || "unknown"} ${field(item, "state") || "review"}${field(item, "submitted_at") ? ` at ${field(item, "submitted_at")}` : ""}`),
    id: "github_list_pull_request_reviews",
    kind: "read",
    method: "GET",
    path: (repo, args) => `/repos/${repo.owner}/${repo.repo}/pulls/${integerArg(args.pullNumber)}/reviews`,
    properties: {
      page: { minimum: 1, type: "integer" },
      perPage: { minimum: 1, type: "integer" },
      pullNumber: { minimum: 1, type: "integer" },
    },
    query: paginationQuery,
    required: ["pullNumber"],
    title: "List GitHub pull request reviews",
  });
}

function createGithubCreatePullRequestReviewTool(backend: GithubBackend): ToolDefinition {
  return createGithubEndpointTool(backend, {
    body: (args) => compactQuery({
      body: optionalStringArg(args.body),
      comments: Array.isArray(args.comments) ? args.comments : undefined,
      commit_id: optionalStringArg(args.commitId),
      event: optionalStringArg(args.event) ?? "COMMENT",
    }),
    description: "Create a GitHub pull request review. Use event APPROVE, REQUEST_CHANGES, COMMENT, or omit event for pending review comments.",
    format: (data) => `Created PR review ${field(data, "id") || ""} with state ${field(data, "state") || "pending"}.\n${field(data, "html_url")}`,
    id: "github_create_pull_request_review",
    kind: "mutating",
    method: "POST",
    path: (repo, args) => `/repos/${repo.owner}/${repo.repo}/pulls/${integerArg(args.pullNumber)}/reviews`,
    properties: {
      body: { type: "string" },
      comments: { items: { additionalProperties: true, type: "object" }, type: "array" },
      commitId: { minLength: 1, type: "string" },
      event: { enum: ["APPROVE", "COMMENT", "REQUEST_CHANGES"], type: "string" },
      pullNumber: { minimum: 1, type: "integer" },
    },
    required: ["pullNumber"],
    title: "Create GitHub pull request review",
  });
}

function createGithubRequestPullRequestReviewersTool(backend: GithubBackend): ToolDefinition {
  return createGithubEndpointTool(backend, {
    body: (args) => compactQuery({ reviewers: stringArrayArg(args.reviewers), team_reviewers: stringArrayArg(args.teamReviewers) }),
    description: "Request users or teams to review a GitHub pull request.",
    format: (data) => `Requested reviewers for PR #${field(data, "number")}.\n${field(data, "html_url")}`,
    id: "github_request_pull_request_reviewers",
    kind: "mutating",
    method: "POST",
    path: (repo, args) => `/repos/${repo.owner}/${repo.repo}/pulls/${integerArg(args.pullNumber)}/requested_reviewers`,
    properties: {
      pullNumber: { minimum: 1, type: "integer" },
      reviewers: { items: { type: "string" }, type: "array" },
      teamReviewers: { items: { type: "string" }, type: "array" },
    },
    required: ["pullNumber"],
    title: "Request GitHub PR reviewers",
  });
}

function createGithubRemovePullRequestReviewersTool(backend: GithubBackend): ToolDefinition {
  return createGithubEndpointTool(backend, {
    body: (args) => compactQuery({ reviewers: stringArrayArg(args.reviewers), team_reviewers: stringArrayArg(args.teamReviewers) }),
    description: "Remove requested reviewers from a GitHub pull request.",
    format: (data) => `Removed requested reviewers for PR #${field(data, "number")}.\n${field(data, "html_url")}`,
    id: "github_remove_pull_request_reviewers",
    kind: "mutating",
    method: "DELETE",
    path: (repo, args) => `/repos/${repo.owner}/${repo.repo}/pulls/${integerArg(args.pullNumber)}/requested_reviewers`,
    properties: {
      pullNumber: { minimum: 1, type: "integer" },
      reviewers: { items: { type: "string" }, type: "array" },
      teamReviewers: { items: { type: "string" }, type: "array" },
    },
    required: ["pullNumber"],
    title: "Remove GitHub PR reviewers",
  });
}

function createGithubUpdatePullRequestBranchTool(backend: GithubBackend): ToolDefinition {
  return createGithubEndpointTool(backend, {
    body: (args) => compactQuery({ expected_head_sha: optionalStringArg(args.headSha) }),
    description: "Update a pull request branch with the latest upstream changes.",
    format: (_data, args) => `Requested branch update for PR #${integerArg(args.pullNumber)}.`,
    id: "github_update_pull_request_branch",
    kind: "mutating",
    method: "PUT",
    path: (repo, args) => `/repos/${repo.owner}/${repo.repo}/pulls/${integerArg(args.pullNumber)}/update-branch`,
    properties: {
      headSha: { minLength: 1, type: "string" },
      pullNumber: { minimum: 1, type: "integer" },
    },
    required: ["pullNumber"],
    title: "Update GitHub pull request branch",
  });
}

function createGithubCheckPullRequestMergedTool(backend: GithubBackend): ToolDefinition {
  return createGithubEndpointTool(backend, {
    description: "Check whether a GitHub pull request has been merged.",
    format: (_data, args, response) => `PR #${integerArg(args.pullNumber)} merge check returned HTTP ${field(response, "status") || "unknown"}. GitHub returns 204 when merged and 404 when not merged.`,
    id: "github_check_pull_request_merged",
    kind: "read",
    method: "GET",
    path: (repo, args) => `/repos/${repo.owner}/${repo.repo}/pulls/${integerArg(args.pullNumber)}/merge`,
    properties: { pullNumber: { minimum: 1, type: "integer" } },
    required: ["pullNumber"],
    title: "Check GitHub pull request merged",
  });
}

function createGithubUpdatePullRequestTool(backend: GithubBackend): ToolDefinition {
  return githubPublishTool({
    description: "Update a GitHub pull request title, body, base, state, or maintainer edit flag.",
    execute: async (args) => {
      const repo = readRepositoryArgs(args);
      const pullNumber = integerArg(args.pullNumber);
      if ("error" in repo) {
        return repo.error;
      }
      if (!pullNumber) {
        return createErrorResult("pullNumber is required.");
      }
      const request = compactQuery({
        base: optionalStringArg(args.base),
        body: optionalStringArg(args.body),
        maintainer_can_modify: typeof args.maintainerCanModify === "boolean" ? args.maintainerCanModify : undefined,
        state: optionalStringArg(args.state),
        title: optionalStringArg(args.title),
      });
      if (Object.keys(request).length === 0) {
        return createErrorResult("At least one pull request update field is required.");
      }

      try {
        if (booleanArg(args.dryRun)) {
          return dryRunResult(`Dry run: would update PR #${pullNumber} in ${repo.owner}/${repo.repo}.`, request);
        }
        const response = await backend.api({ body: request, method: "PATCH", path: `/repos/${repo.owner}/${repo.repo}/pulls/${pullNumber}` });
        return { content: `Updated PR #${field(response.data, "number")}: ${field(response.data, "title")}\n${field(response.data, "html_url")}`, data: response as unknown as JsonValue, ok: true };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not update GitHub pull request."));
      }
    },
    id: "github_update_pull_request",
    inputSchema: repositorySchema({
      base: { minLength: 1, type: "string" },
      body: { type: "string" },
      dryRun: { type: "boolean" },
      maintainerCanModify: { type: "boolean" },
      pullNumber: { minimum: 1, type: "integer" },
      state: { enum: ["closed", "open"], type: "string" },
      title: { minLength: 1, type: "string" },
    }, ["owner", "repo", "pullNumber"]),
    title: "Update GitHub pull request",
  });
}

function createGithubMergePullRequestTool(backend: GithubBackend): ToolDefinition {
  return githubPublishTool({
    description: "Merge a GitHub pull request with merge, squash, or rebase strategy.",
    execute: async (args) => {
      const repo = readRepositoryArgs(args);
      const pullNumber = integerArg(args.pullNumber);
      if ("error" in repo) {
        return repo.error;
      }
      if (!pullNumber) {
        return createErrorResult("pullNumber is required.");
      }
      const request = compactQuery({
        commit_message: optionalStringArg(args.commitMessage),
        commit_title: optionalStringArg(args.commitTitle),
        merge_method: optionalStringArg(args.mergeMethod),
        sha: optionalStringArg(args.sha),
      });

      try {
        if (booleanArg(args.dryRun)) {
          return dryRunResult(`Dry run: would merge PR #${pullNumber} in ${repo.owner}/${repo.repo}.`, request);
        }
        const response = await backend.api({ body: request, method: "PUT", path: `/repos/${repo.owner}/${repo.repo}/pulls/${pullNumber}/merge` });
        return { content: `Merged PR #${pullNumber}: ${field(response.data, "message") || "merge completed"}`, data: response as unknown as JsonValue, ok: true };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not merge GitHub pull request."));
      }
    },
    id: "github_merge_pull_request",
    inputSchema: repositorySchema({
      commitMessage: { type: "string" },
      commitTitle: { type: "string" },
      dryRun: { type: "boolean" },
      mergeMethod: { enum: ["merge", "rebase", "squash"], type: "string" },
      pullNumber: { minimum: 1, type: "integer" },
      sha: { minLength: 1, type: "string" },
    }, ["owner", "repo", "pullNumber"]),
    title: "Merge GitHub pull request",
  });
}

function createGithubSearchRepositoriesTool(backend: GithubBackend): ToolDefinition {
  return createGithubSearchTool(backend, {
    description: "Search GitHub repositories with GitHub search qualifiers.",
    format: (items) => formatGenericList(items, "GitHub repositories", (item, index) => `${index + 1}. ${field(item, "full_name")} (${field(item, "stargazers_count") || "0"} stars, ${field(item, "forks_count") || "0"} forks)\n${field(item, "html_url")}`),
    id: "github_search_repositories",
    path: "/search/repositories",
    title: "Search GitHub repositories",
  });
}

function createGithubSearchUsersTool(backend: GithubBackend): ToolDefinition {
  return createGithubSearchTool(backend, {
    description: "Search GitHub users and organizations.",
    format: (items) => formatGenericList(items, "GitHub users", (item, index) => `${index + 1}. ${field(item, "login")} (${field(item, "type") || "user"})\n${field(item, "html_url")}`),
    id: "github_search_users",
    path: "/search/users",
    title: "Search GitHub users",
  });
}

function createGithubListCommitsTool(backend: GithubBackend): ToolDefinition {
  return createGithubEndpointTool(backend, {
    description: "List commits in a GitHub repository.",
    format: (data) => formatGenericList(data, "GitHub commits", (item, index) => `${index + 1}. ${field(item, "sha").slice(0, 7)} ${field(item, "commit.message").split("\n")[0]} (${field(item, "commit.author.name") || "unknown"})`),
    id: "github_list_commits",
    kind: "read",
    method: "GET",
    path: (repo) => `/repos/${repo.owner}/${repo.repo}/commits`,
    properties: {
      author: { minLength: 1, type: "string" },
      page: { minimum: 1, type: "integer" },
      path: { minLength: 1, type: "string" },
      perPage: { minimum: 1, type: "integer" },
      sha: { minLength: 1, type: "string" },
      since: { minLength: 1, type: "string" },
      until: { minLength: 1, type: "string" },
    },
    query: (args) => compactQuery({ ...paginationQuery(args), author: optionalStringArg(args.author), path: optionalStringArg(args.path), sha: optionalStringArg(args.sha), since: optionalStringArg(args.since), until: optionalStringArg(args.until) }),
    title: "List GitHub commits",
  });
}

function createGithubGetCommitTool(backend: GithubBackend): ToolDefinition {
  return createGithubEndpointTool(backend, {
    description: "Read one GitHub commit by SHA.",
    format: (data) => [
      `${field(data, "sha").slice(0, 7)} ${field(data, "commit.message").split("\n")[0]}`,
      `Author: ${field(data, "commit.author.name") || "unknown"}`,
      field(data, "html_url"),
    ].filter(Boolean).join("\n"),
    id: "github_get_commit",
    kind: "read",
    method: "GET",
    path: (repo, args) => `/repos/${repo.owner}/${repo.repo}/commits/${encodeURIComponent(stringArg(args.sha))}`,
    properties: { sha: { minLength: 1, type: "string" } },
    required: ["sha"],
    title: "Get GitHub commit",
  });
}

function createGithubCompareRefsTool(backend: GithubBackend): ToolDefinition {
  return createGithubEndpointTool(backend, {
    description: "Compare two GitHub refs, branches, tags, or SHAs.",
    format: (data) => [
      `Comparison ${field(data, "status") || "unknown"}: ahead ${field(data, "ahead_by") || "0"}, behind ${field(data, "behind_by") || "0"}`,
      `Files changed: ${Array.isArray((data as Record<string, unknown>)?.files) ? ((data as Record<string, unknown>).files as unknown[]).length : 0}`,
      field(data, "html_url"),
    ].filter(Boolean).join("\n"),
    id: "github_compare_refs",
    kind: "read",
    method: "GET",
    path: (repo, args) => `/repos/${repo.owner}/${repo.repo}/compare/${encodeURIComponent(stringArg(args.basehead))}`,
    properties: { basehead: { description: "Comparison in base...head form, for example main...feature.", minLength: 1, type: "string" } },
    required: ["basehead"],
    title: "Compare GitHub refs",
  });
}

function createGithubListContributorsTool(backend: GithubBackend): ToolDefinition {
  return createGithubEndpointTool(backend, {
    description: "List contributors to a GitHub repository.",
    format: (data) => formatGenericList(data, "GitHub contributors", (item, index) => `${index + 1}. ${field(item, "login") || field(item, "name") || "unknown"} (${field(item, "contributions") || "0"} contributions)`),
    id: "github_list_contributors",
    kind: "read",
    method: "GET",
    path: (repo) => `/repos/${repo.owner}/${repo.repo}/contributors`,
    properties: {
      page: { minimum: 1, type: "integer" },
      perPage: { minimum: 1, type: "integer" },
    },
    query: paginationQuery,
    title: "List GitHub contributors",
  });
}

function createGithubListStargazersTool(backend: GithubBackend): ToolDefinition {
  return createGithubEndpointTool(backend, {
    description: "List users who starred a GitHub repository.",
    format: (data) => formatGenericList(data, "GitHub stargazers", (item, index) => `${index + 1}. ${field(item, "login") || "unknown"}\n${field(item, "html_url")}`),
    id: "github_list_stargazers",
    kind: "read",
    method: "GET",
    path: (repo) => `/repos/${repo.owner}/${repo.repo}/stargazers`,
    properties: {
      page: { minimum: 1, type: "integer" },
      perPage: { minimum: 1, type: "integer" },
    },
    query: paginationQuery,
    title: "List GitHub stargazers",
  });
}

function createGithubListForksTool(backend: GithubBackend): ToolDefinition {
  return createGithubEndpointTool(backend, {
    description: "List forks of a GitHub repository.",
    format: (data) => formatGenericList(data, "GitHub forks", (item, index) => `${index + 1}. ${field(item, "full_name")} (${field(item, "stargazers_count") || "0"} stars)\n${field(item, "html_url")}`),
    id: "github_list_forks",
    kind: "read",
    method: "GET",
    path: (repo) => `/repos/${repo.owner}/${repo.repo}/forks`,
    properties: {
      page: { minimum: 1, type: "integer" },
      perPage: { minimum: 1, type: "integer" },
      sort: { enum: ["newest", "oldest", "stargazers", "watchers"], type: "string" },
    },
    query: (args) => compactQuery({ ...paginationQuery(args), sort: optionalStringArg(args.sort) }),
    title: "List GitHub forks",
  });
}

function createGithubCreateForkTool(backend: GithubBackend): ToolDefinition {
  return createGithubEndpointTool(backend, {
    body: (args) => compactQuery({ default_branch_only: typeof args.defaultBranchOnly === "boolean" ? args.defaultBranchOnly : undefined, name: optionalStringArg(args.name), organization: optionalStringArg(args.organization) }),
    description: "Fork a GitHub repository into the authenticated account or an organization.",
    format: (data) => `Created fork ${field(data, "full_name")}.\n${field(data, "html_url")}`,
    id: "github_create_fork",
    kind: "mutating",
    method: "POST",
    path: (repo) => `/repos/${repo.owner}/${repo.repo}/forks`,
    properties: {
      defaultBranchOnly: { type: "boolean" },
      name: { minLength: 1, type: "string" },
      organization: { minLength: 1, type: "string" },
    },
    title: "Create GitHub fork",
  });
}

function createGithubStarRepositoryTool(backend: GithubBackend): ToolDefinition {
  return createGithubEndpointTool(backend, {
    description: "Star a GitHub repository as the connected user.",
    format: (_data, _args) => "Starred GitHub repository.",
    id: "github_star_repository",
    kind: "mutating",
    method: "PUT",
    path: (repo) => `/user/starred/${repo.owner}/${repo.repo}`,
    title: "Star GitHub repository",
  });
}

function createGithubUnstarRepositoryTool(backend: GithubBackend): ToolDefinition {
  return createGithubEndpointTool(backend, {
    description: "Remove the connected user's star from a GitHub repository.",
    format: () => "Unstarred GitHub repository.",
    id: "github_unstar_repository",
    kind: "mutating",
    method: "DELETE",
    path: (repo) => `/user/starred/${repo.owner}/${repo.repo}`,
    title: "Unstar GitHub repository",
  });
}

function createGithubWatchRepositoryTool(backend: GithubBackend): ToolDefinition {
  return createGithubEndpointTool(backend, {
    body: (args) => ({ ignored: typeof args.ignored === "boolean" ? args.ignored : false, subscribed: typeof args.subscribed === "boolean" ? args.subscribed : true }),
    description: "Watch or subscribe to a GitHub repository as the connected user.",
    format: (data) => `Updated repository subscription: subscribed=${field(data, "subscribed") || "unknown"}, ignored=${field(data, "ignored") || "unknown"}.`,
    id: "github_watch_repository",
    kind: "mutating",
    method: "PUT",
    path: (repo) => `/repos/${repo.owner}/${repo.repo}/subscription`,
    properties: {
      ignored: { type: "boolean" },
      subscribed: { type: "boolean" },
    },
    title: "Watch GitHub repository",
  });
}

function createGithubUnwatchRepositoryTool(backend: GithubBackend): ToolDefinition {
  return createGithubEndpointTool(backend, {
    description: "Stop watching a GitHub repository as the connected user.",
    format: () => "Stopped watching GitHub repository.",
    id: "github_unwatch_repository",
    kind: "mutating",
    method: "DELETE",
    path: (repo) => `/repos/${repo.owner}/${repo.repo}/subscription`,
    title: "Unwatch GitHub repository",
  });
}

function createGithubGenerateReleaseNotesTool(backend: GithubBackend): ToolDefinition {
  return githubReadTool({
    description: "Generate GitHub release notes for a tag without creating the release.",
    execute: async (args) => {
      const repo = readRepositoryArgs(args);
      if ("error" in repo) {
        return repo.error;
      }
      const tagName = stringArg(args.tagName);
      if (!tagName) {
        return createErrorResult("tagName is required.");
      }

      try {
        const notes = await backend.generateReleaseNotes({
          ...repo,
          configurationFilePath: optionalStringArg(args.configurationFilePath),
          previousTagName: optionalStringArg(args.previousTagName),
          tagName,
          targetCommitish: optionalStringArg(args.targetCommitish),
        });
        return {
          content: [`Release notes for ${tagName}:`, "", notes.body].join("\n"),
          data: notes as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not generate GitHub release notes."));
      }
    },
    id: "github_generate_release_notes",
    inputSchema: releaseNotesSchema(),
    title: "Generate GitHub release notes",
  });
}

function createGithubListReleasesTool(backend: GithubBackend): ToolDefinition {
  return githubReadTool({
    description: "List releases for a GitHub repository.",
    execute: async (args) => {
      const repo = readRepositoryArgs(args);
      if ("error" in repo) {
        return repo.error;
      }

      try {
        const releases = await backend.listReleases({
          ...repo,
          page: integerArg(args.page),
          perPage: integerArg(args.perPage),
        });
        return {
          content: releases.length
            ? releases.map((release, index) => `${index + 1}. ${release.tagName}${release.name ? ` - ${release.name}` : ""}${release.draft ? " (draft)" : ""}\n${release.htmlUrl}`).join("\n")
            : "No releases returned.",
          data: { releases } as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not list GitHub releases."));
      }
    },
    id: "github_list_releases",
    inputSchema: repositorySchema({
      page: { minimum: 1, type: "integer" },
      perPage: { minimum: 1, type: "integer" },
    }),
    title: "List GitHub releases",
  });
}

function createGithubCreateReleaseTool(backend: GithubBackend): ToolDefinition {
  return githubPublishTool({
    description: "Create a GitHub release through the connected account.",
    execute: async (args) => {
      const repo = readRepositoryArgs(args);
      if ("error" in repo) {
        return repo.error;
      }
      const tagName = stringArg(args.tagName);
      if (!tagName) {
        return createErrorResult("tagName is required.");
      }
      const request = {
        ...repo,
        body: optionalStringArg(args.body),
        draft: args.draft !== false,
        generateReleaseNotes: booleanArg(args.generateReleaseNotes),
        makeLatest: optionalStringArg(args.makeLatest),
        name: optionalStringArg(args.name),
        prerelease: booleanArg(args.prerelease),
        tagName,
        targetCommitish: optionalStringArg(args.targetCommitish),
      };

      try {
        if (booleanArg(args.dryRun)) {
          return dryRunResult(`Dry run: would create ${request.draft ? "draft " : ""}release ${tagName} in ${repo.owner}/${repo.repo}.`, request);
        }
        const release = await backend.createRelease(request);
        return {
          content: `Created release ${release.tagName}: ${release.htmlUrl}`,
          data: release as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not create GitHub release."));
      }
    },
    id: "github_create_release",
    inputSchema: repositorySchema({
      body: { type: "string" },
      draft: { type: "boolean" },
      dryRun: { type: "boolean" },
      generateReleaseNotes: { type: "boolean" },
      makeLatest: { minLength: 1, type: "string" },
      name: { minLength: 1, type: "string" },
      prerelease: { type: "boolean" },
      tagName: { minLength: 1, type: "string" },
      targetCommitish: { minLength: 1, type: "string" },
    }, ["owner", "repo", "tagName"]),
    title: "Create GitHub release",
  });
}

function createGithubListWorkflowsTool(backend: GithubBackend): ToolDefinition {
  return githubReadTool({
    description: "List GitHub Actions workflows for a repository.",
    execute: async (args) => {
      const repo = readRepositoryArgs(args);
      if ("error" in repo) {
        return repo.error;
      }

      try {
        const result = await backend.listWorkflows({
          ...repo,
          page: integerArg(args.page),
          perPage: integerArg(args.perPage),
        });
        return {
          content: result.workflows.length
            ? result.workflows.map((workflow, index) => `${index + 1}. ${workflow.name} (${workflow.state}) ${workflow.path}\n${workflow.htmlUrl}`).join("\n")
            : "No workflows returned.",
          data: result as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not list GitHub workflows."));
      }
    },
    id: "github_list_workflows",
    inputSchema: repositorySchema({
      page: { minimum: 1, type: "integer" },
      perPage: { minimum: 1, type: "integer" },
    }),
    title: "List GitHub workflows",
  });
}

function createGithubListWorkflowRunsTool(backend: GithubBackend): ToolDefinition {
  return githubReadTool({
    description: "List recent GitHub Actions workflow runs.",
    execute: async (args) => {
      const repo = readRepositoryArgs(args);
      if ("error" in repo) {
        return repo.error;
      }
      const workflowId = stringArg(args.workflowId);
      if (!workflowId) {
        return createErrorResult("workflowId is required.");
      }

      try {
        const result = await backend.listWorkflowRuns({
          ...repo,
          branch: optionalStringArg(args.branch),
          event: optionalStringArg(args.event),
          page: integerArg(args.page),
          perPage: integerArg(args.perPage),
          status: optionalStringArg(args.status),
          workflowId,
        });
        return {
          content: result.runs.length
            ? result.runs.map((run, index) => `${index + 1}. #${run.runNumber} ${run.name ?? workflowId} - ${run.status ?? "unknown"}${run.conclusion ? `/${run.conclusion}` : ""} ${run.branch ? `on ${run.branch}` : ""}\n${run.htmlUrl}`).join("\n")
            : "No workflow runs returned.",
          data: result as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not list GitHub workflow runs."));
      }
    },
    id: "github_list_workflow_runs",
    inputSchema: repositorySchema({
      branch: { minLength: 1, type: "string" },
      event: { minLength: 1, type: "string" },
      page: { minimum: 1, type: "integer" },
      perPage: { minimum: 1, type: "integer" },
      status: { minLength: 1, type: "string" },
      workflowId: { minLength: 1, type: "string" },
    }, ["owner", "repo", "workflowId"]),
    title: "List GitHub workflow runs",
  });
}

function createGithubDispatchWorkflowTool(backend: GithubBackend): ToolDefinition {
  return githubPublishTool({
    description: "Dispatch a GitHub Actions workflow_dispatch workflow for a selected ref.",
    execute: async (args) => {
      const repo = readRepositoryArgs(args);
      if ("error" in repo) {
        return repo.error;
      }
      const workflowId = stringArg(args.workflowId);
      const ref = stringArg(args.ref);
      if (!workflowId || !ref) {
        return createErrorResult("workflowId and ref are required.");
      }
      const inputs = args.inputs && typeof args.inputs === "object" && !Array.isArray(args.inputs)
        ? args.inputs as Record<string, unknown>
        : undefined;
      const request = { ...repo, inputs, ref, workflowId };

      try {
        if (booleanArg(args.dryRun)) {
          return dryRunResult(`Dry run: would dispatch workflow ${workflowId} on ${ref} in ${repo.owner}/${repo.repo}.`, request);
        }
        const result = await backend.dispatchWorkflow(request);
        return {
          content: `Dispatched workflow ${result.workflowId} on ${result.refName}.`,
          data: result as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not dispatch GitHub workflow."));
      }
    },
    id: "github_dispatch_workflow",
    inputSchema: repositorySchema({
      dryRun: { type: "boolean" },
      inputs: { additionalProperties: true, type: "object" },
      ref: { minLength: 1, type: "string" },
      workflowId: { minLength: 1, type: "string" },
    }, ["owner", "repo", "workflowId", "ref"]),
    title: "Dispatch GitHub workflow",
  });
}

function createGithubGetWorkflowRunTool(backend: GithubBackend): ToolDefinition {
  return githubReadTool({
    description: "Read one GitHub Actions workflow run by id.",
    execute: async (args) => {
      const repo = readRepositoryArgs(args);
      const runId = integerArg(args.runId);
      if ("error" in repo) {
        return repo.error;
      }
      if (!runId) {
        return createErrorResult("runId is required.");
      }

      try {
        const response = await backend.api({ method: "GET", path: `/repos/${repo.owner}/${repo.repo}/actions/runs/${runId}` });
        return {
          content: formatWorkflowRunDetail(response.data),
          data: response as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not read GitHub workflow run."));
      }
    },
    id: "github_get_workflow_run",
    inputSchema: repositorySchema({
      runId: { minimum: 1, type: "integer" },
    }, ["owner", "repo", "runId"]),
    title: "Get GitHub workflow run",
  });
}

function createGithubListWorkflowRunJobsTool(backend: GithubBackend): ToolDefinition {
  return createGithubEndpointTool(backend, {
    description: "List jobs for a GitHub Actions workflow run.",
    format: (data) => formatWorkflowJobs(data),
    id: "github_list_workflow_run_jobs",
    kind: "read",
    method: "GET",
    path: (repo, args) => `/repos/${repo.owner}/${repo.repo}/actions/runs/${integerArg(args.runId)}/jobs`,
    properties: {
      filter: { enum: ["all", "latest"], type: "string" },
      page: { minimum: 1, type: "integer" },
      perPage: { minimum: 1, type: "integer" },
      runId: { minimum: 1, type: "integer" },
    },
    query: (args) => compactQuery({ ...paginationQuery(args), filter: optionalStringArg(args.filter) }),
    required: ["runId"],
    title: "List GitHub workflow run jobs",
  });
}

function createGithubListWorkflowRunArtifactsTool(backend: GithubBackend): ToolDefinition {
  return createGithubEndpointTool(backend, {
    description: "List artifacts produced by a GitHub Actions workflow run.",
    format: (data) => {
      const artifacts = Array.isArray((data as Record<string, unknown>)?.artifacts)
        ? (data as Record<string, unknown>).artifacts as unknown[]
        : [];
      return formatGenericList(artifacts, "GitHub workflow artifacts", (item, index) => `${index + 1}. ${field(item, "name")} (${field(item, "size_in_bytes") || "0"} bytes, expired=${field(item, "expired") || "false"})`);
    },
    id: "github_list_workflow_run_artifacts",
    kind: "read",
    method: "GET",
    path: (repo, args) => `/repos/${repo.owner}/${repo.repo}/actions/runs/${integerArg(args.runId)}/artifacts`,
    properties: {
      page: { minimum: 1, type: "integer" },
      perPage: { minimum: 1, type: "integer" },
      runId: { minimum: 1, type: "integer" },
    },
    query: paginationQuery,
    required: ["runId"],
    title: "List GitHub workflow run artifacts",
  });
}

function createGithubApproveWorkflowRunTool(backend: GithubBackend): ToolDefinition {
  return createGithubEndpointTool(backend, {
    description: "Approve a GitHub Actions workflow run that is waiting for approval.",
    format: (_data, args) => `Approved GitHub Actions run ${integerArg(args.runId)}.`,
    id: "github_approve_workflow_run",
    kind: "mutating",
    method: "POST",
    path: (repo, args) => `/repos/${repo.owner}/${repo.repo}/actions/runs/${integerArg(args.runId)}/approve`,
    properties: { runId: { minimum: 1, type: "integer" } },
    required: ["runId"],
    title: "Approve GitHub workflow run",
  });
}

function createGithubRerunWorkflowRunTool(backend: GithubBackend): ToolDefinition {
  return githubPublishTool({
    description: "Rerun a GitHub Actions workflow run.",
    execute: async (args) => {
      const repo = readRepositoryArgs(args);
      const runId = integerArg(args.runId);
      if ("error" in repo) {
        return repo.error;
      }
      if (!runId) {
        return createErrorResult("runId is required.");
      }

      try {
        if (booleanArg(args.dryRun)) {
          return dryRunResult(`Dry run: would rerun workflow run ${runId} in ${repo.owner}/${repo.repo}.`, { runId });
        }
        const response = await backend.api({ method: "POST", path: `/repos/${repo.owner}/${repo.repo}/actions/runs/${runId}/rerun` });
        return { content: `Requested rerun for GitHub Actions run ${runId}.`, data: response as unknown as JsonValue, ok: true };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not rerun GitHub workflow run."));
      }
    },
    id: "github_rerun_workflow_run",
    inputSchema: repositorySchema({
      dryRun: { type: "boolean" },
      runId: { minimum: 1, type: "integer" },
    }, ["owner", "repo", "runId"]),
    title: "Rerun GitHub workflow run",
  });
}

function createGithubCancelWorkflowRunTool(backend: GithubBackend): ToolDefinition {
  return githubPublishTool({
    description: "Cancel an in-progress GitHub Actions workflow run.",
    execute: async (args) => {
      const repo = readRepositoryArgs(args);
      const runId = integerArg(args.runId);
      if ("error" in repo) {
        return repo.error;
      }
      if (!runId) {
        return createErrorResult("runId is required.");
      }

      try {
        if (booleanArg(args.dryRun)) {
          return dryRunResult(`Dry run: would cancel workflow run ${runId} in ${repo.owner}/${repo.repo}.`, { runId });
        }
        const response = await backend.api({ method: "POST", path: `/repos/${repo.owner}/${repo.repo}/actions/runs/${runId}/cancel` });
        return { content: `Requested cancellation for GitHub Actions run ${runId}.`, data: response as unknown as JsonValue, ok: true };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not cancel GitHub workflow run."));
      }
    },
    id: "github_cancel_workflow_run",
    inputSchema: repositorySchema({
      dryRun: { type: "boolean" },
      runId: { minimum: 1, type: "integer" },
    }, ["owner", "repo", "runId"]),
    title: "Cancel GitHub workflow run",
  });
}

function createGithubForceCancelWorkflowRunTool(backend: GithubBackend): ToolDefinition {
  return createGithubEndpointTool(backend, {
    description: "Force-cancel a GitHub Actions workflow run that normal cancellation could not stop.",
    format: (_data, args) => `Requested force cancellation for GitHub Actions run ${integerArg(args.runId)}.`,
    id: "github_force_cancel_workflow_run",
    kind: "mutating",
    method: "POST",
    path: (repo, args) => `/repos/${repo.owner}/${repo.repo}/actions/runs/${integerArg(args.runId)}/force-cancel`,
    properties: { runId: { minimum: 1, type: "integer" } },
    required: ["runId"],
    title: "Force-cancel GitHub workflow run",
  });
}

function createGithubGetPendingDeploymentsTool(backend: GithubBackend): ToolDefinition {
  return createGithubEndpointTool(backend, {
    description: "List pending deployments for a GitHub Actions workflow run.",
    format: (data) => formatGenericList(data, "GitHub pending deployments", (item, index) => `${index + 1}. ${field(item, "environment.name") || field(item, "environment")} (${field(item, "wait_timer") || "no wait timer"})`),
    id: "github_get_pending_deployments",
    kind: "read",
    method: "GET",
    path: (repo, args) => `/repos/${repo.owner}/${repo.repo}/actions/runs/${integerArg(args.runId)}/pending_deployments`,
    properties: { runId: { minimum: 1, type: "integer" } },
    required: ["runId"],
    title: "Get GitHub pending deployments",
  });
}

function createGithubReviewPendingDeploymentsTool(backend: GithubBackend): ToolDefinition {
  return createGithubEndpointTool(backend, {
    body: (args) => compactQuery({
      comment: optionalStringArg(args.comment) ?? "",
      environment_ids: Array.isArray(args.environmentIds) ? args.environmentIds : undefined,
      state: optionalStringArg(args.state) ?? "approved",
    }),
    description: "Approve or reject pending deployments for a GitHub Actions workflow run.",
    format: (_data, args) => `${optionalStringArg(args.state) === "rejected" ? "Rejected" : "Approved"} pending deployments for run ${integerArg(args.runId)}.`,
    id: "github_review_pending_deployments",
    kind: "mutating",
    method: "POST",
    path: (repo, args) => `/repos/${repo.owner}/${repo.repo}/actions/runs/${integerArg(args.runId)}/pending_deployments`,
    properties: {
      comment: { type: "string" },
      environmentIds: { items: { type: "integer" }, type: "array" },
      runId: { minimum: 1, type: "integer" },
      state: { enum: ["approved", "rejected"], type: "string" },
    },
    required: ["runId", "environmentIds"],
    title: "Review GitHub pending deployments",
  });
}

function createGithubListCodeScanningAlertsTool(backend: GithubBackend): ToolDefinition {
  return createGithubEndpointTool(backend, {
    description: "List GitHub code scanning alerts for a repository.",
    format: (data) => formatGenericList(data, "GitHub code scanning alerts", (item, index) => `${index + 1}. #${field(item, "number")} ${field(item, "rule.description") || field(item, "rule.id")} (${field(item, "state") || "unknown"}, ${field(item, "rule.severity") || "severity unknown"})`),
    id: "github_list_code_scanning_alerts",
    kind: "read",
    method: "GET",
    path: (repo) => `/repos/${repo.owner}/${repo.repo}/code-scanning/alerts`,
    properties: {
      direction: { enum: ["asc", "desc"], type: "string" },
      page: { minimum: 1, type: "integer" },
      perPage: { minimum: 1, type: "integer" },
      state: { enum: ["closed", "dismissed", "fixed", "open"], type: "string" },
    },
    query: (args) => compactQuery({ ...paginationQuery(args), direction: optionalStringArg(args.direction), state: optionalStringArg(args.state) }),
    title: "List GitHub code scanning alerts",
  });
}

function createGithubListSecretScanningAlertsTool(backend: GithubBackend): ToolDefinition {
  return createGithubEndpointTool(backend, {
    description: "List GitHub secret scanning alerts for a repository.",
    format: (data) => formatGenericList(data, "GitHub secret scanning alerts", (item, index) => `${index + 1}. #${field(item, "number")} ${field(item, "secret_type_display_name") || field(item, "secret_type")} (${field(item, "state") || "unknown"})`),
    id: "github_list_secret_scanning_alerts",
    kind: "read",
    method: "GET",
    path: (repo) => `/repos/${repo.owner}/${repo.repo}/secret-scanning/alerts`,
    properties: {
      page: { minimum: 1, type: "integer" },
      perPage: { minimum: 1, type: "integer" },
      state: { enum: ["open", "resolved"], type: "string" },
    },
    query: (args) => compactQuery({ ...paginationQuery(args), state: optionalStringArg(args.state) }),
    title: "List GitHub secret scanning alerts",
  });
}

function createGithubListDependabotAlertsTool(backend: GithubBackend): ToolDefinition {
  return createGithubEndpointTool(backend, {
    description: "List GitHub Dependabot alerts for a repository.",
    format: (data) => formatGenericList(data, "GitHub Dependabot alerts", (item, index) => `${index + 1}. #${field(item, "number")} ${field(item, "security_advisory.summary")} (${field(item, "state") || "unknown"}, ${field(item, "security_advisory.severity") || "severity unknown"})`),
    id: "github_list_dependabot_alerts",
    kind: "read",
    method: "GET",
    path: (repo) => `/repos/${repo.owner}/${repo.repo}/dependabot/alerts`,
    properties: {
      page: { minimum: 1, type: "integer" },
      perPage: { minimum: 1, type: "integer" },
      state: { enum: ["auto_dismissed", "dismissed", "fixed", "open"], type: "string" },
    },
    query: (args) => compactQuery({ ...paginationQuery(args), state: optionalStringArg(args.state) }),
    title: "List GitHub Dependabot alerts",
  });
}

function createGithubListNotificationsTool(backend: GithubBackend): ToolDefinition {
  return githubReadTool({
    description: "List notifications for the connected GitHub user.",
    execute: async (args) => {
      try {
        const response = await backend.api({
          method: "GET",
          path: "/notifications",
          query: compactQuery({
            all: typeof args.all === "boolean" ? args.all : undefined,
            before: optionalStringArg(args.before),
            page: integerArg(args.page),
            participating: typeof args.participating === "boolean" ? args.participating : undefined,
            per_page: integerArg(args.perPage),
            since: optionalStringArg(args.since),
          }),
        });
        return {
          content: formatGenericList(response.data, "GitHub notifications", (item, index) => `${index + 1}. ${field(item, "repository.full_name")} ${field(item, "subject.type")}: ${field(item, "subject.title")} (${field(item, "reason") || "reason unknown"})`),
          data: response as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not list GitHub notifications."));
      }
    },
    id: "github_list_notifications",
    inputSchema: {
      additionalProperties: false,
      properties: {
        all: { type: "boolean" },
        before: { minLength: 1, type: "string" },
        page: { minimum: 1, type: "integer" },
        participating: { type: "boolean" },
        perPage: { minimum: 1, type: "integer" },
        since: { minLength: 1, type: "string" },
      },
      type: "object",
    },
    title: "List GitHub notifications",
  });
}

function createGithubMarkNotificationThreadReadTool(backend: GithubBackend): ToolDefinition {
  return githubPublishTool({
    description: "Mark one GitHub notification thread as read or done.",
    execute: async (args) => {
      const threadId = stringArg(args.threadId);
      if (!threadId) {
        return createErrorResult("threadId is required.");
      }

      try {
        if (booleanArg(args.dryRun)) {
          return dryRunResult(`Dry run: would mark GitHub notification thread ${threadId} as read.`, { threadId });
        }
        const response = await backend.api({ method: "PATCH", path: `/notifications/threads/${encodeURIComponent(threadId)}` });
        return { content: `Marked GitHub notification thread ${threadId} as read.`, data: response as unknown as JsonValue, ok: true };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not mark GitHub notification thread as read."));
      }
    },
    id: "github_mark_notification_thread_read",
    inputSchema: {
      additionalProperties: false,
      properties: {
        dryRun: { type: "boolean" },
        threadId: { minLength: 1, type: "string" },
      },
      required: ["threadId"],
      type: "object",
    },
    title: "Mark GitHub notification thread read",
  });
}

function createGithubMarkAllNotificationsReadTool(backend: GithubBackend): ToolDefinition {
  return githubPublishTool({
    description: "Mark all GitHub notifications as read for the connected user.",
    execute: async (args) => {
      const body = compactQuery({ last_read_at: optionalStringArg(args.lastReadAt) });

      try {
        if (booleanArg(args.dryRun)) {
          return dryRunResult("Dry run: would mark all GitHub notifications as read.", body);
        }
        const response = await backend.api({ body, method: "PUT", path: "/notifications" });
        return { content: "Marked all GitHub notifications as read.", data: response as unknown as JsonValue, ok: true };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not mark all GitHub notifications as read."));
      }
    },
    id: "github_mark_all_notifications_read",
    inputSchema: {
      additionalProperties: false,
      properties: {
        dryRun: { type: "boolean" },
        lastReadAt: { minLength: 1, type: "string" },
      },
      type: "object",
    },
    title: "Mark all GitHub notifications read",
  });
}

function createGithubApiReadTool(backend: GithubBackend): ToolDefinition {
  return githubReadTool({
    description: "Read any GitHub REST API path through the connected account when no specific GitHub tool fits.",
    execute: async (args) => executeGithubApiTool(backend, "GET", args),
    id: "github_api_read",
    inputSchema: githubApiSchema(["path"]),
    title: "GitHub API read",
  });
}

function createGithubApiWriteTool(backend: GithubBackend): ToolDefinition {
  return githubPublishTool({
    description: "Write to any GitHub REST API path with POST, PATCH, or PUT when no specific GitHub tool fits.",
    execute: async (args) => {
      const method = optionalStringArg(args.method)?.toUpperCase() || "POST";

      if (!["PATCH", "POST", "PUT"].includes(method)) {
        return createErrorResult("github_api_write method must be POST, PATCH, or PUT.");
      }

      return executeGithubApiTool(backend, method as "PATCH" | "POST" | "PUT", args);
    },
    id: "github_api_write",
    inputSchema: githubApiSchema(["path"]),
    title: "GitHub API write",
  });
}

function createGithubApiDeleteTool(backend: GithubBackend): ToolDefinition {
  return githubDestructiveTool({
    description: "Delete a GitHub REST API resource when no specific GitHub tool fits.",
    execute: async (args) => executeGithubApiTool(backend, "DELETE", args),
    id: "github_api_delete",
    inputSchema: githubApiSchema(["path"]),
    title: "GitHub API delete",
  });
}

function githubReadTool(tool: Omit<ToolDefinition, "executorMetadata" | "permission" | "risk">): ToolDefinition {
  return {
    ...tool,
    executorMetadata: { family: "github", version: 1 },
    permission: "read-only",
    risk: "read",
  };
}

function githubPublishTool(tool: Omit<ToolDefinition, "executorMetadata" | "permission" | "risk">): ToolDefinition {
  return {
    ...tool,
    executorMetadata: { family: "github", version: 1 },
    permission: "mutating",
    risk: "mutating",
  };
}

function githubDestructiveTool(tool: Omit<ToolDefinition, "executorMetadata" | "permission" | "risk">): ToolDefinition {
  return {
    ...tool,
    executorMetadata: { family: "github", version: 1 },
    permission: "destructive",
    risk: "destructive",
  };
}

type GithubEndpointToolKind = "destructive" | "mutating" | "read";

interface GithubEndpointToolOptions {
  body?: (args: Record<string, unknown>) => unknown;
  description: string;
  format?: (data: unknown, args: Record<string, unknown>, response: unknown) => string;
  id: string;
  kind: GithubEndpointToolKind;
  method: "DELETE" | "GET" | "PATCH" | "POST" | "PUT";
  path: (repo: { owner: string; repo: string }, args: Record<string, unknown>) => string;
  properties?: Record<string, unknown>;
  query?: (args: Record<string, unknown>) => Record<string, unknown> | undefined;
  required?: string[];
  title: string;
}

function createGithubSearchTool(backend: GithubBackend, options: {
  description: string;
  format: (items: unknown[], totalCount: string) => string;
  id: string;
  path: "/search/repositories" | "/search/users";
  title: string;
}): ToolDefinition {
  return githubReadTool({
    description: options.description,
    execute: async (args) => {
      const query = stringArg(args.query);
      if (!query) {
        return createErrorResult("query is required.");
      }

      try {
        const response = await backend.api({
          method: "GET",
          path: options.path,
          query: compactQuery({
            order: optionalStringArg(args.order),
            page: integerArg(args.page),
            per_page: integerArg(args.perPage),
            q: query,
            sort: optionalStringArg(args.sort),
          }),
        });
        const data = response.data as Record<string, unknown>;
        const items = Array.isArray(data?.items) ? data.items as unknown[] : [];
        return {
          content: options.format(items, String(data?.total_count ?? items.length)),
          data: response as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, `Could not run ${options.title}.`));
      }
    },
    id: options.id,
    inputSchema: {
      additionalProperties: false,
      properties: {
        order: { enum: ["asc", "desc"], type: "string" },
        page: { minimum: 1, type: "integer" },
        perPage: { minimum: 1, type: "integer" },
        query: { minLength: 1, type: "string" },
        sort: { minLength: 1, type: "string" },
      },
      required: ["query"],
      type: "object",
    },
    title: options.title,
  });
}

function createGithubEndpointTool(backend: GithubBackend, options: GithubEndpointToolOptions): ToolDefinition {
  const wrap = options.kind === "read" ? githubReadTool : options.kind === "destructive" ? githubDestructiveTool : githubPublishTool;

  return wrap({
    description: options.description,
    execute: async (args) => {
      const repo = readRepositoryArgs(args);
      if ("error" in repo) {
        return repo.error;
      }

      const path = options.path(repo, args);
      const body = options.body?.(args);
      const request = {
        body,
        method: options.method,
        path,
        query: options.query?.(args),
      };

      try {
        if (options.kind !== "read" && booleanArg(args.dryRun)) {
          return dryRunResult(`Dry run: would call GitHub API ${options.method} ${path}.`, request);
        }

        const response = await backend.api(request);
        return {
          content: options.format?.(response.data, args, response) ?? `GitHub API ${response.method} ${response.path} returned HTTP ${response.status}.`,
          data: response as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, `GitHub API ${options.method} ${path} failed.`));
      }
    },
    id: options.id,
    inputSchema: repositorySchema({
      ...(options.kind === "read" ? {} : { dryRun: { type: "boolean" } }),
      ...(options.properties ?? {}),
    }, ["owner", "repo", ...(options.required ?? [])]),
    title: options.title,
  });
}

function readRepositoryArgs(args: Record<string, unknown>): { owner: string; repo: string } | { error: ToolExecutionResult } {
  const owner = stringArg(args.owner);
  const repo = stringArg(args.repo);

  if (!owner || !repo) {
    return { error: createErrorResult("owner and repo are required.") };
  }

  return { owner, repo };
}

function repositorySchema(extraProperties: Record<string, unknown> = {}, required: string[] = ["owner", "repo"]) {
  return {
    additionalProperties: false,
    properties: {
      owner: { description: "Repository owner or organization.", minLength: 1, type: "string" },
      repo: { description: "Repository name.", minLength: 1, type: "string" },
      ...extraProperties,
    },
    required,
    type: "object",
  };
}

function releaseNotesSchema() {
  return repositorySchema({
    configurationFilePath: { minLength: 1, type: "string" },
    previousTagName: { minLength: 1, type: "string" },
    tagName: { minLength: 1, type: "string" },
    targetCommitish: { minLength: 1, type: "string" },
  }, ["owner", "repo", "tagName"]);
}

function normalizeCommitFiles(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }

    const record = item as Record<string, unknown>;
    const path = stringArg(record.path);

    if (!path) {
      return [];
    }

    return [{
      content: typeof record.content === "string" ? record.content : undefined,
      operation: optionalStringArg(record.operation),
      path,
    }];
  });
}

function rankGithubSemanticCandidates(query: string, candidates: Array<{ kind: string; text: string; value: unknown; url?: string }>) {
  const queryEmbedding = createMemoryEmbedding(query);
  const queryTerms = new Set(query.toLowerCase().split(/\s+/).filter((term) => term.length >= 2));

  return candidates
    .map((candidate) => {
      const text = candidate.text || JSON.stringify(candidate.value);
      const vectorScore = scoreMemoryVectors(queryEmbedding, createMemoryEmbedding(text));
      const normalizedText = text.toLowerCase();
      const keywordBoost = [...queryTerms].reduce((score, term) => score + (normalizedText.includes(term) ? 0.08 : 0), 0);
      const score = vectorScore + Math.min(keywordBoost, 0.32);

      return {
        kind: candidate.kind,
        label: labelGithubCandidate(candidate.value, candidate.kind),
        score,
        url: candidate.url,
        value: candidate.value,
      };
    })
    .sort((left, right) => right.score - left.score);
}

function labelGithubCandidate(value: unknown, kind: string) {
  if (!value || typeof value !== "object") {
    return kind;
  }

  const record = value as Record<string, unknown>;
  return String(record.fullName ?? record.repositoryFullName ?? record.path ?? record.name ?? kind);
}

function paginationQuery(args: Record<string, unknown>) {
  return compactQuery({
    page: integerArg(args.page),
    per_page: integerArg(args.perPage),
  });
}

function compactQuery(record: Record<string, unknown>) {
  const next: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }

    if (Array.isArray(value) && value.length === 0) {
      continue;
    }

    next[key] = value;
  }

  return next;
}

async function searchRepositoryIssues(
  backend: GithubBackend,
  options: {
    args: Record<string, unknown>;
    defaultFetchAll?: boolean;
    emptyMessage: string;
    extraQuery?: string;
    repo: { owner: string; repo: string };
    state?: string;
    stateReason?: string;
    title?: string;
  },
): Promise<ToolExecutionResult> {
  const stateReason = normalizeIssueCloseReason(options.stateReason);
  const queryParts = [
    `repo:${options.repo.owner}/${options.repo.repo}`,
    "is:issue",
    options.state && options.state !== "all" ? `is:${options.state}` : "",
    stateReason ? `reason:${formatIssueSearchReason(stateReason)}` : "",
    options.extraQuery,
  ].filter(Boolean);
  const query = queryParts.join(" ");
  const perPage = Math.min(integerArg(options.args.perPage) ?? 100, 100);
  const startPage = integerArg(options.args.page) ?? 1;
  const fetchAll = booleanArg(options.args.fetchAll, options.defaultFetchAll ?? false);
  const maxPages = Math.min(integerArg(options.args.maxPages) ?? (fetchAll ? 10 : 1), 10);
  const pagesToFetch = fetchAll ? maxPages : 1;
  const issues: unknown[] = [];
  let totalCount = 0;
  let incompleteResults = false;
  let lastResponse: unknown;

  try {
    for (let offset = 0; offset < pagesToFetch; offset += 1) {
      const page = startPage + offset;
      const response = await backend.api({
        method: "GET",
        path: "/search/issues",
        query: compactQuery({
          order: optionalStringArg(options.args.order),
          page,
          per_page: perPage,
          q: query,
          sort: optionalStringArg(options.args.sort),
        }),
      });
      const data = response.data && typeof response.data === "object" && !Array.isArray(response.data)
        ? response.data as Record<string, unknown>
        : {};
      const pageItems = Array.isArray(data.items) ? data.items : [];
      issues.push(...pageItems);
      totalCount = typeof data.total_count === "number" ? data.total_count : issues.length;
      incompleteResults = data.incomplete_results === true || incompleteResults;
      lastResponse = response;

      if (!fetchAll || pageItems.length < perPage || issues.length >= totalCount) {
        break;
      }
    }

    if (issues.length === 0) {
      return {
        content: `${options.emptyMessage}\nQuery: ${query}`,
        data: { incompleteResults, issues, query, totalCount } as unknown as JsonValue,
        ok: true,
      };
    }

    const title = options.title ?? "GitHub issues";
    const summary = `${title} for ${options.repo.owner}/${options.repo.repo}: ${issues.length}${totalCount ? ` of ${totalCount}` : ""} returned.`;
    const more = totalCount > issues.length
      ? `Fetched ${issues.length} of ${totalCount}; ask for the next page or raise maxPages for more.`
      : "";
    const incomplete = incompleteResults ? "GitHub marked these search results as incomplete." : "";

    return {
      content: [summary, formatIssueList(issues), more, incomplete].filter(Boolean).join("\n"),
      data: { incompleteResults, issues, query, response: lastResponse, totalCount } as unknown as JsonValue,
      ok: true,
    };
  } catch (error) {
    return createErrorResult(readErrorMessage(error, "Could not search GitHub issues."));
  }
}

function normalizeIssueCloseReason(value: string | undefined) {
  const normalized = value?.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!normalized) {
    return undefined;
  }

  if (normalized === "complete" || normalized === "completed" || normalized === "done" || normalized === "fixed" || normalized === "resolved") {
    return "completed";
  }

  if (normalized === "duplicate" || normalized === "duplicated") {
    return "duplicate";
  }

  if (normalized === "not_planned" || normalized === "notplanned" || normalized === "wont_fix" || normalized === "won't_fix") {
    return "not_planned";
  }

  return undefined;
}

function formatIssueSearchReason(reason: string) {
  return reason === "not_planned" ? "\"not planned\"" : reason;
}

function field(value: unknown, path: string) {
  let current = value;

  for (const segment of path.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return "";
    }

    current = (current as Record<string, unknown>)[segment];
  }

  if (current === undefined || current === null) {
    return "";
  }

  return String(current);
}

function formatGenericList(data: unknown, label: string, formatItem: (item: unknown, index: number) => string) {
  const items = Array.isArray(data) ? data : [];
  if (items.length === 0) {
    return `No ${label} returned.`;
  }

  return items.map(formatItem).join("\n");
}

function formatLabelList(data: unknown, fallback: string) {
  const labels = Array.isArray(data)
    ? data.map((item) => field(item, "name")).filter(Boolean)
    : [];
  return labels.length ? `Labels: ${labels.join(", ")}` : fallback;
}

function formatUsers(data: unknown) {
  const users = Array.isArray(data) ? data : [];
  return users.map((item) => field(item, "login")).filter(Boolean).join(", ");
}

function formatIssueList(issues: unknown[]) {
  if (issues.length === 0) {
    return "No GitHub issues returned.";
  }

  return issues.map((issue, index) => {
    const number = field(issue, "number") || "?";
    const title = field(issue, "title") || "Untitled";
    const state = field(issue, "state") || "unknown";
    const reason = field(issue, "state_reason");
    const closedAt = field(issue, "closed_at");
    const user = field(issue, "user.login");
    const url = field(issue, "html_url");
    const pull = field(issue, "pull_request.url") ? " PR-linked" : "";
    const details = [state, reason ? `reason: ${reason}` : "", closedAt ? `closed: ${closedAt}` : "", pull.trim(), user].filter(Boolean).join(", ");

    return `${index + 1}. #${number} ${title} (${details})${url ? `\n${url}` : ""}`;
  }).join("\n");
}

function formatIssueDetail(issue: unknown) {
  const lines = [
    `Issue #${field(issue, "number") || "?"}: ${field(issue, "title") || "Untitled"}`,
    `State: ${field(issue, "state") || "unknown"}`,
    field(issue, "user.login") ? `Author: ${field(issue, "user.login")}` : "",
    field(issue, "labels") ? `Labels: ${formatLabels(issue)}` : "",
    field(issue, "html_url"),
    "",
    field(issue, "body") || "(No body)",
  ].filter(Boolean);

  return lines.join("\n");
}

function formatLabels(issue: unknown) {
  if (!issue || typeof issue !== "object" || Array.isArray(issue)) {
    return "";
  }

  const labels = (issue as Record<string, unknown>).labels;
  if (!Array.isArray(labels)) {
    return "";
  }

  return labels.map((label) => field(label, "name")).filter(Boolean).join(", ");
}

function formatPullRequestList(pulls: unknown[]) {
  if (pulls.length === 0) {
    return "No GitHub pull requests returned.";
  }

  return pulls.map((pull, index) => {
    const number = field(pull, "number") || "?";
    const title = field(pull, "title") || "Untitled";
    const state = field(pull, "state") || "unknown";
    const draft = field(pull, "draft") === "true" ? ", draft" : "";
    const head = field(pull, "head.ref");
    const base = field(pull, "base.ref");
    const url = field(pull, "html_url");

    return `${index + 1}. #${number} ${title} (${state}${draft}${head && base ? `, ${head} -> ${base}` : ""})${url ? `\n${url}` : ""}`;
  }).join("\n");
}

function formatPullRequestDetail(pull: unknown) {
  const checks = [
    field(pull, "mergeable") ? `Mergeable: ${field(pull, "mergeable")}` : "",
    field(pull, "mergeable_state") ? `Merge state: ${field(pull, "mergeable_state")}` : "",
  ].filter(Boolean).join(" | ");
  const lines = [
    `PR #${field(pull, "number") || "?"}: ${field(pull, "title") || "Untitled"}`,
    `State: ${field(pull, "state") || "unknown"}${field(pull, "draft") === "true" ? " (draft)" : ""}`,
    field(pull, "head.ref") && field(pull, "base.ref") ? `Branch: ${field(pull, "head.ref")} -> ${field(pull, "base.ref")}` : "",
    checks,
    field(pull, "html_url"),
    "",
    field(pull, "body") || "(No body)",
  ].filter(Boolean);

  return lines.join("\n");
}

function formatWorkflowRunDetail(run: unknown) {
  return [
    `Workflow run #${field(run, "run_number") || field(run, "id") || "?"}: ${field(run, "name") || "Unnamed workflow"}`,
    `Status: ${field(run, "status") || "unknown"}${field(run, "conclusion") ? `/${field(run, "conclusion")}` : ""}`,
    field(run, "head_branch") ? `Branch: ${field(run, "head_branch")}` : "",
    field(run, "head_sha") ? `Head: ${field(run, "head_sha").slice(0, 7)}` : "",
    field(run, "event") ? `Event: ${field(run, "event")}` : "",
    field(run, "html_url"),
  ].filter(Boolean).join("\n");
}

function formatWorkflowJobs(data: unknown) {
  const jobs = Array.isArray((data as Record<string, unknown>)?.jobs)
    ? (data as Record<string, unknown>).jobs as unknown[]
    : [];

  return formatGenericList(jobs, "GitHub workflow jobs", (job, index) => `${index + 1}. ${field(job, "name") || field(job, "id")} (${field(job, "status") || "unknown"}${field(job, "conclusion") ? `/${field(job, "conclusion")}` : ""})`);
}

async function executeGithubApiTool(backend: GithubBackend, method: "DELETE" | "GET" | "PATCH" | "POST" | "PUT", args: Record<string, unknown>) {
  const path = stringArg(args.path);
  if (!path) {
    return createErrorResult("GitHub API path is required.");
  }

  const query = args.query && typeof args.query === "object" && !Array.isArray(args.query)
    ? args.query as Record<string, unknown>
    : undefined;
  const body = Object.prototype.hasOwnProperty.call(args, "body") ? args.body : undefined;
  const request = { body, method, path, query };

  try {
    if (method !== "GET" && booleanArg(args.dryRun)) {
      return dryRunResult(`Dry run: would call GitHub API ${method} ${path}.`, request);
    }

    const response = await backend.api(request);
    return {
      content: `GitHub API ${response.method} ${response.path} returned HTTP ${response.status}.`,
      data: response as unknown as JsonValue,
      ok: true,
    };
  } catch (error) {
    return createErrorResult(readErrorMessage(error, "GitHub API request failed."));
  }
}

function githubApiSchema(required: string[]) {
  return {
    additionalProperties: false,
    properties: {
      body: {
        description: "JSON body for POST, PATCH, PUT, or DELETE requests.",
      },
      dryRun: { type: "boolean" },
      method: { enum: ["DELETE", "GET", "PATCH", "POST", "PUT"], type: "string" },
      path: { description: "Relative GitHub REST API path, for example /repos/OWNER/REPO/issues.", minLength: 1, type: "string" },
      query: { additionalProperties: true, type: "object" },
    },
    required,
    type: "object",
  };
}

function dryRunResult(content: string, request: Record<string, unknown>): ToolExecutionResult {
  return {
    content,
    data: createDryRunData(request) as JsonValue,
    ok: true,
  };
}
