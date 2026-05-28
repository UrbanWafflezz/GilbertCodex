import type { JsonValue, ToolDefinition, ToolExecutionContext } from "../../types";
import { PathResolutionError, tryResolveAllowedPath } from "../../paths";
import { defaultFilesBackend, type FilesBackend } from "./backend";
import { readErrorMessage, readTextFileWithModuleRecovery } from "./readUtils";

const MAX_CONCURRENT_READS = 8;

interface BatchReadResult {
  content?: string;
  error?: string;
  extension?: string | null;
  modifiedAt?: number | null;
  name?: string;
  ok: boolean;
  path?: string;
  recoveredFrom?: string;
  recoveryNote?: string;
  requestedPath: string;
  sha256?: string | null;
  size?: number;
  truncated?: boolean;
}

export function createFilesReadManyTool(backend: FilesBackend = defaultFilesBackend): ToolDefinition {
  return {
    description:
      "Read many UTF-8 text files from inside the configured workspace roots in one call. " +
      "Use this after files_search or files_list when several files are needed for one answer. " +
      "By default it reads each full text file without a bridge-imposed size cap. Pass maxBytes " +
      "only when the user asks for bounded previews or chunks.",
    execute: async (args, context) => {
      const paths = toPathArray(args.paths);

      if (paths.length === 0) {
        return {
          content: "files_read_many requires at least one path.",
          error: "files_read_many requires at least one path.",
          ok: false,
        };
      }

      const maxBytes = optionalPositiveInteger(args.maxBytes);
      const results = new Array<BatchReadResult>(paths.length);
      let nextIndex = 0;
      const workerCount = Math.max(1, Math.min(MAX_CONCURRENT_READS, paths.length));

      async function worker() {
        while (!context.signal?.aborted) {
          const currentIndex = nextIndex;
          if (currentIndex >= paths.length) {
            return;
          }

          nextIndex += 1;
          const requestedPath = paths[currentIndex]!;
          results[currentIndex] = await readOneFile(backend, requestedPath, maxBytes, context);
        }
      }

      await Promise.all(Array.from({ length: workerCount }, () => worker()));

      if (context.signal?.aborted) {
        return { content: "Tool bridge run aborted before files_read_many finished reading files.", ok: false };
      }

      const orderedResults = results.filter((result): result is BatchReadResult => Boolean(result));
      const successCount = orderedResults.filter((result) => result.ok).length;
      const failureCount = orderedResults.length - successCount;

      return {
        content: formatBatchReadContent(orderedResults),
        data: {
          failureCount,
          files: orderedResults,
          requestedCount: paths.length,
          successCount,
        } as unknown as JsonValue,
        ok: successCount > 0,
      };
    },
    executorMetadata: { family: "files", version: 1 },
    id: "files_read_many",
    inputSchema: {
      additionalProperties: false,
      properties: {
        maxBytes: {
          description: "Optional maximum bytes to read from each file. Omit this to read every full text file.",
          minimum: 1,
          type: "integer",
        },
        paths: {
          description: "Text file paths to read. Paths may be absolute or relative to the first workspace root.",
          items: {
            minLength: 1,
            type: "string",
          },
          minItems: 1,
          type: "array",
        },
      },
      required: ["paths"],
      type: "object",
    },
    permission: "read-only",
    risk: "read",
    title: "Read many workspace files",
  };
}

async function readOneFile(
  backend: FilesBackend,
  requestedPath: string,
  maxBytes: number | undefined,
  context: ToolExecutionContext,
): Promise<BatchReadResult> {
  const resolution = tryResolveAllowedPath(context, requestedPath);

  if (!resolution.ok) {
    return resolutionToBatchResult(requestedPath, resolution.error);
  }

  try {
    const read = await readTextFileWithModuleRecovery(backend, resolution.path.resolved, maxBytes);
    const file = read.file;
    return {
      content: file.content,
      extension: file.extension ?? null,
      modifiedAt: file.modifiedAt ?? null,
      name: file.name,
      ok: true,
      path: file.path,
      recoveredFrom: read.recoveredFrom,
      recoveryNote: read.recoveryNote,
      requestedPath,
      sha256: file.sha256 ?? null,
      size: file.size,
      truncated: file.truncated,
    };
  } catch (error) {
    const message = readErrorMessage(error, "Could not read file.");
    return {
      error: message,
      ok: false,
      requestedPath,
    };
  }
}

function formatBatchReadContent(results: BatchReadResult[]) {
  const successCount = results.filter((result) => result.ok).length;
  const failureCount = results.length - successCount;
  const sections = [
    `Read ${successCount} of ${results.length} requested file${results.length === 1 ? "" : "s"}${failureCount > 0 ? ` (${failureCount} failed)` : ""}.`,
  ];

  for (const result of results) {
    if (!result.ok) {
      sections.push([
        `--- \`${result.requestedPath}\``,
        `[ERROR] ${result.error ?? "Could not read file."}`,
      ].join("\n"));
      continue;
    }

    sections.push([
      `--- \`${result.path ?? result.requestedPath}\`${result.recoveredFrom ? ` (recovered from \`${result.recoveredFrom}\`)` : ""}`,
      result.recoveryNote,
      result.truncated ? `[Requested maxBytes/offset chunk only]\n${result.content ?? ""}` : result.content ?? "",
    ].filter((line): line is string => typeof line === "string" && line.length > 0).join("\n"));
  }

  return sections.join("\n\n");
}

function toPathArray(value: unknown) {
  return Array.isArray(value) ? value.filter((path): path is string => typeof path === "string" && path.trim().length > 0) : [];
}

function optionalPositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const truncated = Math.floor(value);
  return truncated > 0 ? truncated : undefined;
}

function resolutionToBatchResult(requestedPath: string, error: PathResolutionError): BatchReadResult {
  return {
    error: error.message,
    ok: false,
    requestedPath,
  };
}
