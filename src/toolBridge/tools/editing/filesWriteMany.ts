import type { JsonValue, ToolDefinition, ToolExecutionResult } from "../../types";
import type { ComputerWriteFilesResult } from "../../../types/localWorkspace";
import { tryResolveAllowedPath } from "../../paths";
import { defaultEditingBackend, type EditingBackend } from "./backend";
import {
  booleanArg,
  createErrorResult,
  normalizeForceEol,
  normalizeResolvedPathKey,
  optionalStringArg,
  parseJsonArrayArg,
  readOptionalExistingFile,
  runBatchWorkers,
  stringArg,
  stringArrayArg,
  writePreparedText,
  type PreparedTextWrite,
} from "./editUtils";

const MAX_CONCURRENT_BATCH_WRITES = 8;

interface BatchWriteItem {
  allowWholeFileReplacement?: boolean;
  content: string;
  createParentDirs?: boolean;
  expectedSha256?: string;
  forceEol?: "crlf" | "lf";
  overwrite?: boolean;
  path: string;
}

interface ResolvedBatchWriteItem extends BatchWriteItem {
  index: number;
  resolvedPath: string;
}

interface BatchWriteResult {
  bytesWritten?: number;
  created?: boolean;
  error?: string;
  fileChanges?: unknown[];
  ok: boolean;
  path?: string;
  requestedPath: string;
  skipped?: boolean;
  skippedReason?: string;
}

export function createFilesWriteManyTool(backend: EditingBackend = defaultEditingBackend): ToolDefinition {
  return {
    description:
      "Create or overwrite many text files inside workspace roots in one reviewed batch. " +
      "Use this instead of many separate files_write calls when creating several files or intentionally replacing several full files. " +
      "For existing-file edits, prefer files_edit_many so small changes stay precise. " +
      "Each file is handled independently, duplicate identical targets are skipped, and dryRun previews all diffs for approval.",
    execute: async (args, context) => {
      const dryRun = booleanArg(args.dryRun);
      const defaults = {
        allowWholeFileReplacement: booleanArg(args.allowWholeFileReplacement),
        createParentDirs: (args.createParentDirs ?? args.createParentDirectories ?? args.create_parent_dirs) !== false,
        forceEol: normalizeForceEol(args.forceEol ?? args.lineEnding ?? args.line_ending),
        overwrite: typeof args.overwrite === "boolean"
          ? args.overwrite
          : typeof args.allowOverwrite === "boolean"
            ? args.allowOverwrite
            : args.overwrite !== false,
      };
      const parsed = parseBatchWriteItems(args);

      if (!("items" in parsed)) {
        return parsed;
      }

      const results = new Array<BatchWriteResult>(parsed.items.length);
      const jobs: ResolvedBatchWriteItem[] = [];
      const firstByResolvedPath = new Map<string, ResolvedBatchWriteItem>();
      const reportProgress = () => emitBatchWriteProgress(context, results, parsed.items.length, dryRun);

      parsed.items.forEach((item, index) => {
        const resolution = tryResolveAllowedPath(context, item.path);

        if (!resolution.ok) {
          results[index] = {
            error: resolution.error.message,
            ok: false,
            requestedPath: item.path,
          };
          reportProgress();
          return;
        }

        const resolvedItem: ResolvedBatchWriteItem = {
          ...item,
          allowWholeFileReplacement: item.allowWholeFileReplacement ?? defaults.allowWholeFileReplacement,
          createParentDirs: item.createParentDirs ?? defaults.createParentDirs,
          forceEol: item.forceEol ?? defaults.forceEol,
          index,
          overwrite: item.overwrite ?? defaults.overwrite,
          resolvedPath: resolution.path.resolved,
        };
        const duplicate = firstByResolvedPath.get(normalizeResolvedPathKey(resolvedItem.resolvedPath));

        if (duplicate) {
          if (duplicate.content === resolvedItem.content) {
            results[index] = {
              ok: true,
              path: duplicate.resolvedPath,
              requestedPath: item.path,
              skipped: true,
              skippedReason: `Duplicate target \`${duplicate.resolvedPath}\` already appears earlier in this batch with the same content.`,
            };
          } else {
            results[index] = {
              error: `Duplicate target \`${duplicate.resolvedPath}\` has different content in the same batch. Keep one final write for that path or use files_edit_many for ordered edits.`,
              ok: false,
              path: duplicate.resolvedPath,
              requestedPath: item.path,
            };
          }
          reportProgress();
          return;
        }

        firstByResolvedPath.set(normalizeResolvedPathKey(resolvedItem.resolvedPath), resolvedItem);
        jobs.push(resolvedItem);
      });

      if (!dryRun && backend.writeTextFiles && jobs.length > 1) {
        await executeFastBatchWriteItems(backend, context, jobs, results, reportProgress);
      } else {
        await runBatchWorkers(jobs, MAX_CONCURRENT_BATCH_WRITES, async (job) => {
          results[job.index] = await executeBatchWriteItem(backend, context, job, dryRun);
          reportProgress();
        });
      }

      return createBatchWriteResult(results, dryRun);
    },
    executorMetadata: { family: "editing", version: 1 },
    id: "files_write_many",
    inputSchema: {
      additionalProperties: false,
      properties: {
        allowWholeFileReplacement: {
          description: "Default escape hatch for intentional full-file replacements of existing large files. Do not set for normal small edits.",
          type: "boolean",
        },
        createParentDirs: {
          description: "Default parent-directory creation behavior for files that do not override it. Defaults to true.",
          type: "boolean",
        },
        dryRun: {
          description: "Preview every file change and diff metadata without writing. Defaults to false.",
          type: "boolean",
        },
        files: {
          description: "Files to create or overwrite.",
          items: {
            additionalProperties: false,
            properties: {
              allowWholeFileReplacement: {
                description: "Allow an intentional full-file replacement of this existing large file. Do not set for normal small edits.",
                type: "boolean",
              },
              content: {
                description: "Full text content to write.",
                type: "string",
              },
              createParentDirs: {
                description: "Create missing parent directories for this file. Defaults to the batch value.",
                type: "boolean",
              },
              expectedSha256: {
                description: "Optional SHA-256 from the last read. The write is refused if the existing file changed.",
                minLength: 1,
                type: "string",
              },
              forceEol: {
                description: "Optional line ending family to force for this file.",
                enum: ["crlf", "lf"],
                type: "string",
              },
              overwrite: {
                description: "Allow replacing an existing file. Defaults to the batch value.",
                type: "boolean",
              },
              path: {
                description: "Absolute path or path relative to the first workspace root.",
                minLength: 1,
                type: "string",
              },
            },
            required: ["path", "content"],
            type: "object",
          },
          minItems: 1,
          type: "array",
        },
        filesJson: {
          description: "JSON array fallback for files. Prefer files when using native tool calls.",
          minLength: 1,
          type: "string",
        },
        files_json: {
          description: "Snake-case JSON array fallback for files.",
          minLength: 1,
          type: "string",
        },
        content: {
          description: "Broadcast content for paths shorthand. Prefer files.",
          type: "string",
        },
        contents: {
          description: "Text contents matching paths when paths is used.",
          items: { type: "string" },
          type: "array",
        },
        forceEol: {
          description: "Default line ending family to force for files that do not override it.",
          enum: ["crlf", "lf"],
          type: "string",
        },
        overwrite: {
          description: "Default overwrite behavior. Defaults to true. Set false for create-only batches.",
          type: "boolean",
        },
        paths: {
          description: "Legacy shorthand paths for write batches. Prefer files.",
          items: {
            minLength: 1,
            type: "string",
          },
          minItems: 1,
          type: "array",
        },
      },
      type: "object",
    },
    permission: "mutating",
    risk: "mutating",
    title: "Write many workspace files",
  };
}

async function executeFastBatchWriteItems(
  backend: EditingBackend,
  context: Parameters<ToolDefinition["execute"]>[1],
  jobs: ResolvedBatchWriteItem[],
  results: BatchWriteResult[],
  reportProgress: () => void,
) {
  const nativeJobs = jobs.filter(canUseNativeBatchWriteItem);
  const createFirstJobs = jobs.filter((job) => !canUseNativeBatchWriteItem(job));

  if (nativeJobs.length > 0) {
    await executeNativeBatchWriteItems(backend, context, nativeJobs, results, reportProgress);
  }

  if (createFirstJobs.length === 0) {
    return;
  }

  await executeNativeCreateFirstWriteItems(backend, context, createFirstJobs, results, reportProgress);
}

function canUseNativeBatchWriteItem(job: ResolvedBatchWriteItem) {
  return job.overwrite === false || job.allowWholeFileReplacement === true;
}

async function executeNativeCreateFirstWriteItems(
  backend: EditingBackend,
  context: Parameters<ToolDefinition["execute"]>[1],
  jobs: ResolvedBatchWriteItem[],
  results: BatchWriteResult[],
  reportProgress: () => void,
) {
  const fallbackJobs: ResolvedBatchWriteItem[] = [];

  try {
    const batch = await backend.writeTextFiles!(
      jobs.map((job) => ({
        content: job.content,
        createParentDirs: job.createParentDirs,
        expectedSha256: job.expectedSha256,
        forceEol: job.forceEol,
        overwrite: false,
        path: job.resolvedPath,
      })),
      context.workspaceRoots ?? [],
    );

    jobs.forEach((job, index) => {
      const nativeResult = batch.files[index];

      if (!nativeResult?.ok || !nativeResult.result) {
        fallbackJobs.push(job);
        return;
      }

      results[job.index] = {
        bytesWritten: nativeResult.result.bytesWritten,
        created: nativeResult.result.created,
        fileChanges: [createFastWriteFileChange(nativeResult.result.path, job.content, nativeResult.result.created)],
        ok: true,
        path: nativeResult.result.path,
        requestedPath: job.path,
      };
      reportProgress();
    });
  } catch {
    fallbackJobs.push(...jobs);
  }

  if (fallbackJobs.length === 0) {
    return;
  }

  await runBatchWorkers(fallbackJobs, MAX_CONCURRENT_BATCH_WRITES, async (job) => {
    results[job.index] = await executeBatchWriteItem(backend, context, job, false);
    reportProgress();
  });
}

async function executeNativeBatchWriteItems(
  backend: EditingBackend,
  context: Parameters<ToolDefinition["execute"]>[1],
  jobs: ResolvedBatchWriteItem[],
  results: BatchWriteResult[],
  reportProgress: () => void,
) {
  try {
    const batch = await backend.writeTextFiles!(
      jobs.map((job) => ({
        content: job.content,
        createParentDirs: job.createParentDirs,
        expectedSha256: job.expectedSha256,
        forceEol: job.forceEol,
        overwrite: job.overwrite,
        path: job.resolvedPath,
      })),
      context.workspaceRoots ?? [],
    );

    applyNativeBatchWriteResults(batch, jobs, results, reportProgress);
  } catch (error) {
    const message = error instanceof Error ? error.message : typeof error === "string" ? error : "Could not write files.";

    for (const job of jobs) {
      results[job.index] = {
        error: message,
        ok: false,
        path: job.resolvedPath,
        requestedPath: job.path,
      };
      reportProgress();
    }
  }
}

function applyNativeBatchWriteResults(
  batch: ComputerWriteFilesResult,
  jobs: ResolvedBatchWriteItem[],
  results: BatchWriteResult[],
  reportProgress: () => void,
) {
  jobs.forEach((job, index) => {
    const nativeResult = batch.files[index];

    if (!nativeResult?.ok || !nativeResult.result) {
      results[job.index] = {
        error: nativeResult?.error ?? "Could not write file.",
        ok: false,
        path: nativeResult?.result?.path ?? job.resolvedPath,
        requestedPath: job.path,
      };
      reportProgress();
      return;
    }

    results[job.index] = {
      bytesWritten: nativeResult.result.bytesWritten,
      created: nativeResult.result.created,
      fileChanges: [createFastWriteFileChange(nativeResult.result.path, job.content, nativeResult.result.created)],
      ok: true,
      path: nativeResult.result.path,
      requestedPath: job.path,
    };
    reportProgress();
  });
}

async function executeBatchWriteItem(
  backend: EditingBackend,
  context: Parameters<ToolDefinition["execute"]>[1],
  item: ResolvedBatchWriteItem,
  dryRun: boolean,
): Promise<BatchWriteResult> {
  const existing = await readOptionalExistingFile(backend, item.resolvedPath);

  if (!existing.ok && existing.error) {
    return {
      error: existing.error,
      ok: false,
      path: item.resolvedPath,
      requestedPath: item.path,
    };
  }

  const existingFile = existing.ok && "path" in existing ? existing : null;

  if (existingFile && item.overwrite === false) {
    return {
      error: "File already exists and overwrite is false.",
      ok: false,
      path: existingFile.path,
      requestedPath: item.path,
    };
  }

  if (item.expectedSha256 && existingFile?.sha256 && item.expectedSha256.toLowerCase() !== existingFile.sha256.toLowerCase()) {
    return {
      error: `Refusing to write because \`${existingFile.path}\` changed since it was last read.`,
      ok: false,
      path: existingFile.path,
      requestedPath: item.path,
    };
  }

  if (!existingFile && item.expectedSha256) {
    return {
      error: "expectedSha256 was provided, but the target file does not exist.",
      ok: false,
      path: item.resolvedPath,
      requestedPath: item.path,
    };
  }

  const prepared: PreparedTextWrite = {
    after: item.content,
    before: existingFile ? existingFile.content : "",
    created: !existingFile,
    expectedSha256: existingFile?.sha256,
    path: existingFile?.path ?? item.resolvedPath,
  };
  const result = await writePreparedText(backend, context, prepared, {
    allowWholeFileReplacement: item.allowWholeFileReplacement,
    broadWriteGuard: true,
    createParentDirs: item.createParentDirs,
    dryRun,
    forceEol: item.forceEol,
    kind: prepared.created ? "create" : "update",
    overwrite: true,
    summary: `${dryRun ? "Previewed" : prepared.created ? "Created" : "Overwrote"} \`${prepared.path}\`.`,
  });

  return toolResultToBatchWriteResult(result, item.path, prepared.path);
}

function createBatchWriteResult(results: BatchWriteResult[], dryRun: boolean): ToolExecutionResult {
  const successCount = results.filter((result) => result.ok && !result.skipped).length;
  const skippedCount = results.filter((result) => result.skipped).length;
  const failureCount = results.filter((result) => !result.ok).length;
  const fileChanges = results.flatMap((result) => result.fileChanges ?? []);
  const lines = [
    `${dryRun ? "Dry run: previewed" : "Wrote"} ${successCount} of ${results.length} requested file${results.length === 1 ? "" : "s"}${failureCount > 0 ? ` (${failureCount} failed)` : ""}${skippedCount > 0 ? ` (${skippedCount} skipped)` : ""}.`,
  ];

  for (const result of results) {
    const label = result.path ?? result.requestedPath;
    if (result.skipped) {
      lines.push(`--- \`${label}\`\n[SKIPPED] ${result.skippedReason ?? "Skipped."}`);
    } else if (!result.ok) {
      lines.push(`--- \`${label}\`\n[ERROR] ${result.error ?? "Could not write file."}`);
    } else {
      lines.push(`--- \`${label}\`\n[OK] ${dryRun ? "Previewed" : result.created ? "Created" : "Updated"}.`);
    }
  }

  return {
    content: lines.join("\n\n"),
    data: {
      dryRun,
      failureCount,
      fileChanges,
      files: results,
      batchSummary: {
        failureCount,
        fileCount: results.length,
        operation: "write",
        requestedCount: results.length,
        skippedCount,
        successCount,
      },
      requestedCount: results.length,
      skippedCount,
      successCount,
    } as unknown as JsonValue,
    ok: successCount > 0 || (results.length > 0 && failureCount === 0),
  };
}

function emitBatchWriteProgress(
  context: Parameters<ToolDefinition["execute"]>[1],
  results: BatchWriteResult[],
  requestedCount: number,
  dryRun: boolean,
) {
  if (!context.reportProgress) {
    return;
  }

  const completedResults = results.filter((result): result is BatchWriteResult => Boolean(result));
  if (completedResults.length === 0) {
    return;
  }

  const successCount = completedResults.filter((result) => result.ok && !result.skipped).length;
  const skippedCount = completedResults.filter((result) => result.skipped).length;
  const failureCount = completedResults.filter((result) => !result.ok).length;
  const fileChanges = completedResults.flatMap((result) => result.fileChanges ?? []);
  const processedCount = successCount + skippedCount + failureCount;

  try {
    context.reportProgress({
      content: `${dryRun ? "Previewed" : "Processed"} ${processedCount} of ${requestedCount} requested file${requestedCount === 1 ? "" : "s"}.`,
      data: {
        dryRun,
        failureCount,
        fileChanges,
        files: completedResults,
        batchSummary: {
          failureCount,
          fileCount: requestedCount,
          operation: "write",
          requestedCount,
          skippedCount,
          successCount,
        },
        requestedCount,
        skippedCount,
        successCount,
      } as unknown as JsonValue,
      ok: successCount > 0 || failureCount === 0,
    });
  } catch {
    // Progress observers are best-effort; the write itself should keep going.
  }
}

function createFastWriteFileChange(path: string, content: string, created: boolean) {
  return {
    additions: created ? countTextLines(content) : 0,
    deletions: 0,
    kind: created ? "create" : "update",
    path,
  };
}

function countTextLines(content: string) {
  if (!content) {
    return 0;
  }

  let lineCount = 1;
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) {
      lineCount += 1;
    }
  }

  return content.endsWith("\n") || content.endsWith("\r\n") ? Math.max(0, lineCount - 1) : lineCount;
}

function toolResultToBatchWriteResult(result: ToolExecutionResult, requestedPath: string, fallbackPath: string): BatchWriteResult {
  const data = result.data as {
    fileChanges?: unknown[];
    writeResult?: {
      bytesWritten?: number;
      created?: boolean;
      path?: string;
    } | null;
  } | undefined;

  if (!result.ok) {
    return {
      error: result.error ?? result.content,
      ok: false,
      path: data?.writeResult?.path ?? fallbackPath,
      requestedPath,
    };
  }

  return {
    bytesWritten: data?.writeResult?.bytesWritten,
    created: data?.writeResult?.created,
    fileChanges: Array.isArray(data?.fileChanges) ? data.fileChanges : [],
    ok: true,
    path: data?.writeResult?.path ?? fallbackPath,
    requestedPath,
  };
}

function parseBatchWriteItems(args: Record<string, unknown>): { items: BatchWriteItem[]; ok: true } | ToolExecutionResult {
  const rawItems = Array.isArray(args.files)
    ? args.files
    : parseJsonArrayArg(args.filesJson ?? args.files_json, "files") ?? readLegacyPathContentItems(args);

  if (!Array.isArray(rawItems)) {
    return createErrorResult("files_write_many requires files or filesJson with at least one file item.");
  }

  if (rawItems.length === 0) {
    return createErrorResult("files_write_many requires at least one file item.");
  }

  const items: BatchWriteItem[] = [];

  for (const [index, rawItem] of rawItems.entries()) {
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
      return createErrorResult(`files_write_many files[${index}] must be an object.`);
    }

    const record = rawItem as Record<string, unknown>;
    const path = stringArg(record.path);

    if (!path) {
      return createErrorResult(`files_write_many files[${index}] requires path.`);
    }

    if (typeof record.content !== "string") {
      return createErrorResult(`files_write_many files[${index}] requires string content.`);
    }

    items.push({
      allowWholeFileReplacement: typeof record.allowWholeFileReplacement === "boolean"
        ? record.allowWholeFileReplacement
        : typeof record.allow_whole_file_replacement === "boolean"
          ? record.allow_whole_file_replacement
          : undefined,
      content: record.content,
      createParentDirs: typeof record.createParentDirs === "boolean"
        ? record.createParentDirs
        : typeof record.createParentDirectories === "boolean"
          ? record.createParentDirectories
          : typeof record.create_parent_dirs === "boolean"
            ? record.create_parent_dirs
            : undefined,
      expectedSha256: optionalStringArg(record.expectedSha256 ?? record.expected_sha256),
      forceEol: normalizeForceEol(record.forceEol ?? record.lineEnding ?? record.line_ending),
      overwrite: typeof record.overwrite === "boolean"
        ? record.overwrite
        : typeof record.allowOverwrite === "boolean"
          ? record.allowOverwrite
          : undefined,
      path,
    });
  }

  return { items, ok: true };
}

function readLegacyPathContentItems(args: Record<string, unknown>) {
  const paths = stringArrayArg(args.paths);

  if (paths.length === 0) {
    return undefined;
  }

  const contents = stringArrayArg(args.contents);
  const broadcastContent = typeof args.content === "string" ? args.content : undefined;

  return paths.map((path, index) => ({
    content: contents[index] ?? broadcastContent,
    path,
  }));
}
