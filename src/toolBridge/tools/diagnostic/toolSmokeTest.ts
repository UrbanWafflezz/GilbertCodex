import { defaultProviderSettings } from "../../../lib/appStorage";
import { annotateProviderPayloadSpike, estimateModelProviderPayloadUsage } from "../../../services/modelProviderUsage";
import type { ChatMessage, ChatToolCall } from "../../../types/chat";
import type { ComputerDirectoryEntry, ComputerDirectoryListing } from "../../../types/localWorkspace";
import { createFilesReadRangeTool, createFilesReadTool, createFilesSearchTool, createFilesTreeSummaryTool, type FilesBackend } from "../files";
import {
  createFilesApplyPatchTool,
  createFilesExactReplaceTool,
  createFilesWriteTool,
  type EditingBackend,
} from "../editing";
import { createGitTools, type GitToolBackends } from "../git";
import type { JsonValue, ToolDefinition, ToolExecutionContext, ToolExecutionResult } from "../../types";
import { executeToolBridgeCalls } from "../../orchestrator";
import { finalizeToolResult, isVisibleToolResultLeak } from "../../resultFinalizer";
import { ToolRegistry } from "../../registry";

const ROOT = "/workspace/tool-smoke";

interface ToolSmokeCheck {
  detail: string;
  id: string;
  label: string;
  ok: boolean;
}

export function createToolSmokeTestTool(): ToolDefinition {
  return {
    description:
      "Run an in-memory smoke test across the local tool bridge: result finalization, tree summary, search, read/read-range, edit recovery, Git status/diff, and provider payload guardrail. " +
      "Use this when diagnosing tool wiring regressions; it does not touch user files.",
    execute: async (_args, context) => {
      const fixtures = createSmokeFixtures();
      const filesBackend = createSmokeFilesBackend(fixtures);
      const editingBackend = createSmokeEditingBackend(fixtures);
      const gitBackends = createSmokeGitBackends();
      const smokeContext: ToolExecutionContext = {
        ...context,
        permissionMode: "full-access",
        workspaceRoots: [ROOT],
      };
      const checks: ToolSmokeCheck[] = [];

      await runCheck(checks, "read_full_html", "Full HTML read stays out of visible chat", async () => {
        const args = { path: "site/index.html" };
        const result = await createFilesReadTool(filesBackend).execute(args, smokeContext);
        assertOkResult(result);
        assertCondition(result.content.includes("<!doctype html>"), "Full HTML read did not include the fixture content.");
        assertCondition(result.content.length > 12_000, "Full HTML fixture was too small to exercise the large-read path.");
        assertToolResultNeedsSynthesis("files_read", "Read workspace file", result, args);
        return "files_read returned the full HTML body for provider evidence, while finalizer metadata blocks the raw recap from visible chat.";
      });

      await runCheck(checks, "tree", "Tree summary skips generated folders", async () => {
        const args = { path: ROOT, maxDepth: 3 };
        const result = await createFilesTreeSummaryTool(filesBackend).execute(args, smokeContext);
        const data = result.data as { skippedDirectories?: number } | undefined;
        assertOkResult(result);
        assertCondition((data?.skippedDirectories ?? 0) >= 1, "Generated/cache directory was not reported as skipped.");
        assertCondition(result.content.includes("src/"), "Tree summary did not include source folder.");
        assertToolResultNeedsSynthesis("files_tree_summary", "Workspace tree summary", result, args);
        return "files_tree_summary scanned fixture source tree and skipped node_modules.";
      });

      await runCheck(checks, "search", "Search finds ranked content with context", async () => {
        const result = await createFilesSearchTool(filesBackend).execute({
          contextLines: 1,
          extensions: ["ts"],
          glob: "**/*.ts",
          path: ROOT,
          query: "smokeNeedle",
        }, smokeContext);
        assertOkResult(result);
        assertCondition(result.content.includes("smokeNeedle"), "Search output did not include the match.");
        assertCondition(result.content.includes("L2:"), "Search output did not include line context.");
        assertToolResultNeedsSynthesis("files_search", "Search workspace files", result, { query: "smokeNeedle" });
        return "files_search found the fixture TypeScript match with surrounding line context.";
      });

      await runCheck(checks, "search_then_read_range", "Search result can feed read range", async () => {
        const searchResult = await createFilesSearchTool(filesBackend).execute({
          contextLines: 0,
          extensions: ["ts"],
          path: ROOT,
          query: "smokeNeedle",
        }, smokeContext);
        assertOkResult(searchResult);
        assertCondition(searchResult.content.includes("src/app.ts"), "Search output did not name src/app.ts.");

        const rangeResult = await createFilesReadRangeTool(filesBackend).execute({
          endLine: 2,
          path: "src/app.ts",
          startLine: 2,
        }, smokeContext);
        assertOkResult(rangeResult);
        assertCondition(rangeResult.content.includes("2: export const smokeNeedle = true;"), "Read range did not return the searched line.");
        assertToolResultNeedsSynthesis("files_read_range", "Read workspace file range", rangeResult, { endLine: 2, path: "src/app.ts", startLine: 2 });
        return "files_search found the file, then files_read_range returned the exact matching line.";
      });

      await runCheck(checks, "read_range", "Read range returns exact lines", async () => {
        const result = await createFilesReadRangeTool(filesBackend).execute({
          endLine: 3,
          path: "src/app.ts",
          startLine: 2,
        }, smokeContext);
        assertOkResult(result);
        assertCondition(result.content.includes("2: export const smokeNeedle = true;"), "Read range did not return the expected numbered line.");
        return "files_read_range returned lines 2-3 from src/app.ts.";
      });

      await runCheck(checks, "read_max_bytes_offset", "Read accepts maxBytes and offset", async () => {
        const result = await createFilesReadTool(filesBackend).execute({
          maxBytes: 160,
          offset: 120,
          path: "site/index.html",
        }, smokeContext);
        const data = result.data as { offset?: number; truncated?: boolean } | undefined;
        assertOkResult(result);
        assertCondition(data?.offset === 120, "files_read did not report the requested byte offset.");
        assertCondition(data?.truncated === true, "files_read did not mark the offset/maxBytes read as truncated.");
        assertCondition(result.content.length < 2_000, "Offset read returned too much content.");
        return "files_read accepted integer maxBytes plus offset and returned a bounded chunk.";
      });

      await runCheck(checks, "write_dry_run", "Write dry-run does not write", async () => {
        const result = await createFilesWriteTool(editingBackend).execute({
          content: "export const created = true;\n",
          dryRun: true,
          path: "src/new.ts",
        }, smokeContext);
        assertOkResult(result);
        assertCondition(!fixtures.files.has(`${ROOT}/src/new.ts`), "files_write dry-run unexpectedly changed fixtures.");
        assertCondition(result.content.includes("Dry run"), "Write dry-run did not explain that it was a preview.");
        return "files_write dry-run produced a diff preview without mutating the fixture map.";
      });

      await runCheck(checks, "write_overwrite_dry_run", "Write dry-run previews existing-file replacement", async () => {
        const path = `${ROOT}/src/app.ts`;
        const before = fixtures.files.get(path)?.content;
        const result = await createFilesWriteTool(editingBackend).execute({
          content: "<!doctype html>\n",
          dryRun: true,
          path: "src/app.ts",
        }, smokeContext);
        assertOkResult(result);
        assertCondition(fixtures.files.get(path)?.content === before, "files_write existing-file dry-run unexpectedly changed fixtures.");
        assertCondition(result.content.includes("Previewed") && result.content.includes("+<!doctype html>"), "Existing-file write dry-run did not include a replacement preview.");
        return "files_write dry-run previews whole-file replacement for existing files without requiring overwrite true.";
      });

      await runCheck(checks, "write_large_file", "Large write completes with file-change metadata", async () => {
        const content = createLargeHtmlFixture("large-write", 420);
        const result = await createFilesWriteTool(editingBackend).execute({
          content,
          path: "site/generated-large.html",
        }, smokeContext);
        assertOkResult(result);
        assertCondition(fixtures.files.get(`${ROOT}/site/generated-large.html`)?.content === content, "files_write did not store the large fixture content.");
        assertCondition(result.data !== undefined, "files_write did not include structured result data.");
        assertToolResultNeedsSynthesis("files_write", "Write workspace file", result, { path: "site/generated-large.html" });
        return "files_write wrote a large HTML fixture and kept visible chat on the synthesized-answer path.";
      });

      await runCheck(checks, "malformed_write_recovery", "Malformed write returns recovery error without mutation", async () => {
        const before = fixtures.files.size;
        const batch = await executeToolBridgeCalls({
          calls: [{
            arguments: {},
            argumentsParseError: "Could not parse tool arguments as JSON: Unterminated string in JSON.",
            id: "smoke-malformed-write",
            name: "files_write",
            provider: "openai",
          }],
          context: smokeContext,
          registry: new ToolRegistry([createFilesWriteTool(editingBackend)]),
        });
        assertCondition(batch.handledCount === 1, "Malformed write was not counted as a handled tool call.");
        assertCondition(batch.executedCount === 0, "Malformed write should not count as executed successfully.");
        assertCondition(fixtures.files.size === before, "Malformed write changed the fixture map.");
        assertCondition(batch.steps[0]?.result.content.includes("No file was changed"), "Malformed write recovery did not state that no file changed.");
        assertToolResultNeedsSynthesis("files_write", "Write workspace file", batch.steps[0]!.result, { path: "broken.html" });
        return "Malformed files_write arguments produced a structured recovery error and no mutation.";
      });

      await runCheck(checks, "exact_replace_dry_run", "Exact replace dry-run previews diff", async () => {
        const path = `${ROOT}/src/app.ts`;
        const before = fixtures.files.get(path)?.content;
        const result = await createFilesExactReplaceTool(editingBackend).execute({
          dryRun: true,
          newText: "smokeNeedle = false",
          oldText: "smokeNeedle = true",
          path: "src/app.ts",
        }, smokeContext);
        assertOkResult(result);
        assertCondition(fixtures.files.get(path)?.content === before, "files_exact_replace dry-run unexpectedly changed fixtures.");
        assertCondition(result.content.includes("-export const smokeNeedle = true;") && result.content.includes("+export const smokeNeedle = false;"), "Exact replace dry-run did not include before/after diff lines.");
        return "files_exact_replace dry-run produced before/after diff lines and left content unchanged.";
      });

      await runCheck(checks, "exact_replace_string_booleans", "Exact replace coerces string booleans", async () => {
        const batch = await executeToolBridgeCalls({
          calls: [{
            arguments: {
              dryRun: "false",
              newText: "flag = false",
              oldText: "flag = true",
              path: "src/replace.ts",
              replaceAll: "false",
            },
            id: "smoke-exact-string-bool",
            name: "files_exact_replace",
            provider: "openai",
          }],
          context: smokeContext,
          registry: new ToolRegistry([createFilesExactReplaceTool(editingBackend)]),
        });
        assertCondition(batch.executedCount === 1, "files_exact_replace with string booleans did not execute.");
        assertCondition(fixtures.files.get(`${ROOT}/src/replace.ts`)?.content.includes("flag = false") === true, "String boolean exact replace did not update the fixture.");
        assertToolResultNeedsSynthesis("files_exact_replace", "Apply exact replace", batch.steps[0]!.result, { path: "src/replace.ts" });
        return "files_exact_replace accepted replaceAll/dryRun string booleans through bridge validation and updated one target.";
      });

      await runCheck(checks, "patch_dry_run", "Patch dry-run verifies hunks", async () => {
        const path = `${ROOT}/src/app.ts`;
        const before = fixtures.files.get(path)?.content;
        const patch = [
          "--- a/src/app.ts",
          "+++ b/src/app.ts",
          "@@ -1,4 +1,4 @@",
          " import { value } from \"./value\";",
          " export const smokeNeedle = true;",
          "-export const answer = value;",
          "+export const answer = value + 1;",
          " export const done = true;",
          "",
        ].join("\n");
        const result = await createFilesApplyPatchTool(editingBackend).execute({ dryRun: true, patch }, smokeContext);
        assertOkResult(result);
        assertCondition(fixtures.files.get(path)?.content === before, "files_apply_patch dry-run unexpectedly changed fixtures.");
        assertCondition(result.content.includes("patch can be applied"), "Patch dry-run did not verify the fixture hunk.");
        return "files_apply_patch dry-run verified the hunk and left content unchanged.";
      });

      await runCheck(checks, "git_status_diff", "Git status and diff report cleanly", async () => {
        const tools = createGitTools(gitBackends);
        const statusTool = tools.find((tool) => tool.id === "git_status");
        const diffTool = tools.find((tool) => tool.id === "git_diff");

        assertCondition(Boolean(statusTool && diffTool), "Git status/diff tools were not registered in the smoke test.");
        const statusResult = await statusTool!.execute({}, smokeContext);
        const diffResult = await diffTool!.execute({}, smokeContext);

        assertOkResult(statusResult);
        assertOkResult(diffResult);
        assertCondition(statusResult.content.includes("codex/smoke"), "git_status did not include the fixture branch.");
        assertCondition(diffResult.content.includes("diff --git"), "git_diff did not include fixture diff text.");
        assertToolResultNeedsSynthesis("git_status", "Git status", statusResult, {});
        assertToolResultNeedsSynthesis("git_diff", "Git diff", diffResult, {});
        return "git_status and git_diff returned fixture repo evidence and are marked for synthesized visible answers.";
      });

      await runCheck(checks, "git_dry_run", "Git tools dry-run without mutation", async () => {
        const tools = createGitTools(gitBackends);
        const commitTool = tools.find((tool) => tool.id === "git_commit");
        const pushTool = tools.find((tool) => tool.id === "git_push");

        assertCondition(Boolean(commitTool && pushTool), "Git tools were not registered in the smoke test.");
        const commitResult = await commitTool!.execute({ dryRun: true, message: "smoke commit" }, smokeContext);
        const pushResult = await pushTool!.execute({ dryRun: true }, smokeContext);

        assertOkResult(commitResult);
        assertOkResult(pushResult);
        assertCondition(gitBackends.localMutationCount() === 0, "Git dry-runs unexpectedly called mutating local backends.");
        assertCondition(commitResult.content.includes("Dry run") && pushResult.content.includes("Dry run"), "Git dry-runs did not produce preview text.");
        return "git_commit and git_push dry-runs produced approval previews without calling mutating backends.";
      });

      await runCheck(checks, "payload_guardrail", "Payload guardrail identifies spike cause", async () => {
        const baseUsage = estimateModelProviderPayloadUsage({
          contextWindowTokens: 262_144,
          messages: [createSmokeMessage("user", "small prompt")],
          settings: defaultProviderSettings,
          source: "estimate",
        });
        const currentUsage = annotateProviderPayloadSpike(estimateModelProviderPayloadUsage({
          contextWindowTokens: 262_144,
          messages: [
            createSmokeMessage("user", "small prompt"),
            {
              content: "",
              createdAt: new Date(0).toISOString(),
              id: "tool-output",
              role: "assistant",
              toolCalls: [{
                id: "tool-call",
                input: "{}",
                label: "Read workspace file",
                output: "large tool result\n".repeat(12_000),
                resultPolicy: {
                  mode: "synthesize",
                  resultKind: "file_content",
                  synthesizeAfterwards: true,
                },
                status: "complete",
                toolId: "files_read",
              }],
            },
          ],
          settings: defaultProviderSettings,
          source: "estimate",
        }), baseUsage);

        assertCondition(Boolean(currentUsage.payloadSpike), "Payload guardrail did not flag a large provider input spike.");
        assertCondition(currentUsage.payloadSpike?.topContributors.some((item) => item.id === "toolOutput") === true, "Payload guardrail did not identify tool output as a top contributor.");
        assertToolResultNeedsSynthesis("files_read", "Read workspace file", {
          content: "large tool result\n".repeat(500),
          ok: true,
        }, {});
        return currentUsage.payloadSpike?.summary ?? "Payload guardrail detected a spike.";
      });

      const passed = checks.filter((check) => check.ok).length;
      const failed = checks.length - passed;
      const content = [
        `Tool smoke test ${failed === 0 ? "passed" : "found issues"}: ${passed}/${checks.length} checks passed.`,
        "",
        ...checks.map((check) => `${check.ok ? "PASS" : "FAIL"} ${check.label}: ${check.detail}`),
      ].join("\n");

      return {
        content,
        data: {
          checks,
          failed,
          passed,
        } as unknown as JsonValue,
        ok: failed === 0,
      };
    },
    executorMetadata: { family: "diagnostic", version: 1 },
    id: "tool_smoke_test",
    inputSchema: {
      additionalProperties: false,
      properties: {},
      type: "object",
    },
    permission: "diagnostic",
    risk: "diagnostic",
    title: "Run tool smoke test",
  };
}

export const toolSmokeTestTool = createToolSmokeTestTool();

function createSmokeGitBackends(): GitToolBackends & { localMutationCount: () => number } {
  let localMutationCount = 0;
  const status = {
    additions: 1,
    ahead: 0,
    available: true,
    behind: 0,
    branch: "codex/smoke",
    changedFiles: 1,
    clean: false,
    deletions: 0,
    files: [{ additions: 1, deletions: 0, diffTruncated: false, path: "src/app.ts", status: "M" }],
    repositoryRoot: ROOT,
  };

  return {
    github: {
      account: async () => ({ connected: false, pluginInstalled: false, scopes: [] }),
      api: async () => ({ data: {}, message: "GitHub API smoke response.", method: "GET", path: "/smoke", status: 200 }),
      commitFiles: async () => {
        throw new Error("GitHub smoke backend should not mutate.");
      },
      createBranch: async () => {
        throw new Error("GitHub smoke backend should not mutate.");
      },
      createPullRequest: async () => {
        throw new Error("GitHub smoke backend should not mutate.");
      },
      createRelease: async () => {
        throw new Error("GitHub smoke backend should not mutate.");
      },
      dispatchWorkflow: async () => {
        throw new Error("GitHub smoke backend should not mutate.");
      },
      generateReleaseNotes: async () => ({ body: "", name: "" }),
      getRepository: async () => ({ defaultBranch: "main", fullName: "owner/repo", htmlUrl: "https://github.com/owner/repo", name: "repo", ownerLogin: "owner", permissions: { admin: false, pull: true, push: false }, private: false }),
      listBranches: async () => [],
      listReleases: async () => [],
      listRepositories: async () => [],
      listTree: async () => ({ branch: "main", commitSha: "0000000", entries: [], truncated: false }),
      listWorkflowRuns: async () => ({ runs: [], totalCount: 0 }),
      listWorkflows: async () => ({ totalCount: 0, workflows: [] }),
      readFile: async () => ({ content: "", name: "README.md", path: "README.md", sha: "0000000", size: 0, truncated: false }),
      searchCode: async () => ({ incompleteResults: false, items: [], totalCount: 0 }),
      summarizeCodeSearchItems: () => "",
    },
    local: {
      branch: async () => {
        localMutationCount += 1;
        return { message: "Created branch.", status };
      },
      commit: async () => {
        localMutationCount += 1;
        return { message: "Committed.", status };
      },
      diff: async () => ({
        diff: [
          "diff --git a/src/app.ts b/src/app.ts",
          "index 0000000..1111111 100644",
          "--- a/src/app.ts",
          "+++ b/src/app.ts",
          "@@ -1,3 +1,3 @@",
          " import { value } from \"./value\";",
          "-export const smokeNeedle = false;",
          "+export const smokeNeedle = true;",
          "",
        ].join("\n"),
        path: ROOT,
        repositoryRoot: ROOT,
        status,
        truncated: false,
      }),
      init: async () => {
        localMutationCount += 1;
        return { message: "Initialized.", status };
      },
      pull: async () => {
        localMutationCount += 1;
        return { message: "Pulled.", status };
      },
      push: async () => {
        localMutationCount += 1;
        return { message: "Pushed.", status };
      },
      stage: async () => {
        localMutationCount += 1;
        return { message: "Staged.", status };
      },
      status: async () => status,
    },
    localMutationCount: () => localMutationCount,
  };
}

function createSmokeFixtures() {
  const files = new Map<string, { content: string; extension?: string; name: string; sha256?: string }>([
    [`${ROOT}/site/index.html`, {
      content: createLargeHtmlFixture("full-read", 460),
      extension: "html",
      name: "index.html",
      sha256: "sha-html",
    }],
    [`${ROOT}/src/app.ts`, {
      content: [
        "import { value } from \"./value\";",
        "export const smokeNeedle = true;",
        "export const answer = value;",
        "export const done = true;",
        "",
      ].join("\n"),
      extension: "ts",
      name: "app.ts",
      sha256: "sha-app",
    }],
    [`${ROOT}/src/replace.ts`, {
      content: "export const flag = true;\n",
      extension: "ts",
      name: "replace.ts",
      sha256: "sha-replace",
    }],
    [`${ROOT}/src/value.ts`, {
      content: "export const value = 41;\n",
      extension: "ts",
      name: "value.ts",
      sha256: "sha-value",
    }],
    [`${ROOT}/README.md`, {
      content: "# Smoke\n",
      extension: "md",
      name: "README.md",
      sha256: "sha-readme",
    }],
    [`${ROOT}/node_modules/generated.js`, {
      content: "export const generated = true;\n",
      extension: "js",
      name: "generated.js",
      sha256: "sha-generated",
    }],
  ]);

  return { files };
}

function createSmokeFilesBackend(fixtures: ReturnType<typeof createSmokeFixtures>): FilesBackend {
  return {
    listDirectory: async (path) => createDirectoryListing(path, fixtures.files),
    readTextFile: async (path, maxBytes, offset) => readFixtureFile(path, fixtures.files, maxBytes, offset),
  };
}

function createSmokeEditingBackend(fixtures: ReturnType<typeof createSmokeFixtures>): EditingBackend {
  return {
    movePath: async (fromPath, toPath) => {
      const file = fixtures.files.get(fromPath);

      if (!file) {
        throw new Error("file not found");
      }

      fixtures.files.delete(fromPath);
      fixtures.files.set(toPath, {
        ...file,
        name: toPath.split("/").pop() ?? file.name,
      });

      return {
        fromPath,
        kind: "file",
        moved: true,
        toPath,
      };
    },
    readTextFile: async (path, maxBytes) => readFixtureFile(path, fixtures.files, maxBytes),
    writeTextFile: async (path, content) => {
      const created = !fixtures.files.has(path);
      fixtures.files.set(path, {
        content,
        extension: path.includes(".") ? path.split(".").pop() : "",
        name: path.split("/").pop() ?? path,
        sha256: `sha-${content.length}`,
      });

      return {
        bytesWritten: content.length,
        created,
        path,
        sha256: `sha-${content.length}`,
      };
    },
  };
}

function createDirectoryListing(path: string, files: Map<string, { content: string; extension?: string; name: string }>): ComputerDirectoryListing {
  const normalizedPath = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const childNames = new Map<string, ComputerDirectoryEntry>();

  for (const [filePath, file] of files) {
    const normalizedFilePath = filePath.replace(/\\/g, "/");

    if (!normalizedFilePath.startsWith(`${normalizedPath}/`)) {
      continue;
    }

    const relative = normalizedFilePath.slice(normalizedPath.length + 1);
    const [firstSegment, ...rest] = relative.split("/");

    if (!firstSegment) {
      continue;
    }

    if (rest.length > 0) {
      childNames.set(firstSegment, {
        kind: "directory",
        name: firstSegment,
        path: `${normalizedPath}/${firstSegment}`,
      });
    } else {
      childNames.set(firstSegment, {
        extension: file.extension,
        kind: "file",
        name: file.name,
        path: normalizedFilePath,
        size: file.content.length,
      });
    }
  }

  if (childNames.size === 0 && normalizedPath !== ROOT) {
    throw new Error("directory not found");
  }

  return {
    entries: [...childNames.values()].sort((left, right) => left.name.localeCompare(right.name)),
    inaccessibleEntries: 0,
    limited: false,
    path: normalizedPath,
  };
}

async function readFixtureFile(
  path: string,
  files: Map<string, { content: string; extension?: string; name: string; sha256?: string }>,
  maxBytes?: number,
  offset?: number,
) {
  const normalizedPath = path.replace(/\\/g, "/");
  const file = files.get(normalizedPath);

  if (!file) {
    throw new Error("file not found");
  }

  const start = Math.max(0, Math.floor(offset ?? 0));
  const boundedMaxBytes = maxBytes === undefined ? undefined : Math.max(0, Math.floor(maxBytes));
  const end = boundedMaxBytes === undefined ? file.content.length : Math.min(file.content.length, start + boundedMaxBytes);
  const content = file.content.slice(start, end);

  return {
    content,
    extension: file.extension,
    name: file.name,
    path: normalizedPath,
    sha256: file.sha256,
    size: file.content.length,
    truncated: start > 0 || end < file.content.length,
  };
}

function createLargeHtmlFixture(name: string, repeatCount: number) {
  return [
    "<!doctype html>",
    "<html lang=\"en\">",
    "<head>",
    "  <meta charset=\"utf-8\">",
    `  <title>${name}</title>`,
    "</head>",
    "<body>",
    ...Array.from({ length: repeatCount }, (_value, index) => `  <section data-row=\"${index}\"><h2>Skyline ridge ${index}</h2><p>Smoke fixture content for full read and large write diagnostics.</p></section>`),
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

async function runCheck(
  checks: ToolSmokeCheck[],
  id: string,
  label: string,
  body: () => Promise<string> | string,
) {
  try {
    const detail = await body();
    checks.push({
      detail,
      id,
      label,
      ok: true,
    });
  } catch (error) {
    checks.push({
      detail: error instanceof Error ? error.message : String(error),
      id,
      label,
      ok: false,
    });
  }
}

function assertOkResult(result: ToolExecutionResult) {
  if (!result.ok) {
    throw new Error(result.error || result.content || "Tool result was not ok.");
  }
}

function assertCondition(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertToolResultNeedsSynthesis(
  toolId: string,
  label: string,
  result: ToolExecutionResult,
  args: Record<string, unknown>,
) {
  const finalization = finalizeToolResult({
    arguments: args,
    label,
    result,
    toolId,
  });
  const status: ChatToolCall["status"] = result.ok ? "complete" : "error";
  const toolCall: ChatToolCall = {
    id: `smoke-${toolId}`,
    input: JSON.stringify(args),
    label,
    output: finalization.toolRecordContent,
    resultPolicy: finalization.visiblePolicy,
    status,
    toolId,
  };

  assertCondition(finalization.visiblePolicy.synthesizeAfterwards === true, `${toolId} did not request post-tool synthesis.`);
  assertCondition(isVisibleToolResultLeak(finalization.toolRecordContent, [toolCall]), `${toolId} raw tool-record content was not detected as unsafe visible chat content.`);
}

function createSmokeMessage(role: ChatMessage["role"], content: string): ChatMessage {
  return {
    content,
    createdAt: new Date(0).toISOString(),
    id: `smoke-${role}`,
    role,
  };
}
