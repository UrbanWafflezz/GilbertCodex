import type { JsonValue, ToolDefinition, ToolExecutionResult } from "../../types";
import { PathResolutionError, tryResolveAllowedPath } from "../../paths";
import { defaultFilesBackend, type FilesBackend } from "./backend";
import { readErrorMessage, readTextFileWithModuleRecovery } from "./readUtils";

export function createFilesReadRangeTool(backend: FilesBackend = defaultFilesBackend): ToolDefinition {
  return {
    description:
      "Read a UTF-8 text file or precise 1-based line range inside the configured workspace roots. " +
      "Use this for large files after files_search finds relevant lines, so the model sees the exact code " +
      "needed without loading the whole file into provider context. If startLine/endLine are omitted, " +
      "the tool reads the full file instead of failing.",
    execute: async (args, context) => {
      const resolution = tryResolveAllowedPath(context, args.path);
      if (!resolution.ok) {
        return resolutionToResult(resolution.error);
      }

      const requestedStartLine = positiveInteger(args.startLine ?? args.start_line);
      const requestedEndLine = positiveInteger(args.endLine ?? args.end_line);
      const startLine = requestedStartLine ?? 1;
      const includeLineNumbers = args.includeLineNumbers !== false;

      if (requestedEndLine !== undefined && requestedEndLine < startLine) {
        return {
          content: "files_read_range endLine must be greater than or equal to startLine.",
          error: "files_read_range endLine must be greater than or equal to startLine.",
          ok: false,
        };
      }

      if (context.signal?.aborted) {
        return { content: "Tool bridge run aborted before files_read_range could call the backend.", ok: false };
      }

      try {
        if (backend.readTextFileRange && requestedEndLine !== undefined) {
          try {
            const range = await backend.readTextFileRange(resolution.path.resolved, startLine, requestedEndLine);
            const content = formatRangeContent(range.content, range.startLine, includeLineNumbers);

            return {
              content: [
                `Read \`${range.path}\` lines ${range.startLine}-${range.endLine} of ${range.totalLines}.`,
                content,
              ].join("\n"),
              data: {
                content,
                endLine: range.endLine,
                extension: range.extension ?? null,
                includeLineNumbers,
                lineCount: range.lineCount,
                name: range.name,
                path: range.path,
                recoveredFrom: null,
                recoveryNote: null,
                requestedEndLine: range.requestedEndLine,
                requestedStartLine: range.requestedStartLine,
                sha256: null,
                size: range.size,
                source: "native-line-range",
                startLine: range.startLine,
                totalLines: range.totalLines,
                truncated: range.truncated,
              } as unknown as JsonValue,
              ok: true,
            };
          } catch {
            // Fall through to the legacy read path, which can recover from common module-path misses.
          }
        }

        const read = await readTextFileWithModuleRecovery(backend, resolution.path.resolved);
        const file = read.file;
        const lines = splitLines(file.content);
        const totalLines = lines.length;

        if (startLine > totalLines) {
          const message = `Requested startLine ${startLine} is beyond the end of \`${file.path}\` (${totalLines} line${totalLines === 1 ? "" : "s"}).`;
          return {
            content: message,
            error: message,
            ok: false,
          };
        }

        const actualEndLine = Math.min(requestedEndLine ?? totalLines, totalLines);
        const selectedLines = lines.slice(startLine - 1, actualEndLine);
        const content = includeLineNumbers
          ? selectedLines.map((line, index) => `${startLine + index}: ${line}`).join("\n")
          : selectedLines.join("\n");

        return {
          content: [
            read.recoveryNote,
            `Read \`${file.path}\` lines ${startLine}-${actualEndLine} of ${totalLines}.`,
            content,
          ].filter(Boolean).join("\n"),
          data: {
            content,
            endLine: actualEndLine,
            extension: file.extension ?? null,
            includeLineNumbers,
            lineCount: selectedLines.length,
            name: file.name,
            path: file.path,
            recoveredFrom: read.recoveredFrom ?? null,
            recoveryNote: read.recoveryNote ?? null,
            requestedEndLine: requestedEndLine ?? null,
            requestedStartLine: requestedStartLine ?? null,
            sha256: file.sha256 ?? null,
            size: file.size,
            source: "full-file-fallback",
            startLine,
            totalLines,
            truncated: file.truncated,
          } as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        const message = readErrorMessage(error, "Could not read file range.");
        return {
          content: message,
          error: message,
          ok: false,
        };
      }
    },
    executorMetadata: { family: "files", version: 1 },
    id: "files_read_range",
    inputSchema: {
      additionalProperties: false,
      properties: {
        endLine: {
          description: "Optional 1-based ending line number, inclusive. Omit this to read through the end of the file.",
          minimum: 1,
          type: "integer",
        },
        end_line: {
          description: "Alias for endLine.",
          minimum: 1,
          type: "integer",
        },
        includeLineNumbers: {
          description: "When true, prefix each returned line with its original 1-based line number. Defaults to true.",
          type: "boolean",
        },
        path: {
          description: "Absolute path or path relative to the first workspace root.",
          minLength: 1,
          type: "string",
        },
        startLine: {
          description: "Optional 1-based starting line number, inclusive. Omit this to start at line 1.",
          minimum: 1,
          type: "integer",
        },
        start_line: {
          description: "Alias for startLine.",
          minimum: 1,
          type: "integer",
        },
      },
      required: ["path"],
      type: "object",
    },
    permission: "read-only",
    risk: "read",
    title: "Read workspace file range",
  };
}

function formatRangeContent(content: string, startLine: number, includeLineNumbers: boolean) {
  if (!includeLineNumbers) {
    return content;
  }

  const lines = content ? content.split("\n") : [""];
  return lines.map((line, index) => `${startLine + index}: ${line}`).join("\n");
}

function splitLines(content: string) {
  if (!content) {
    return [""];
  }

  const lines = content.split(/\r?\n/);
  return content.endsWith("\n") || content.endsWith("\r\n") ? lines.slice(0, -1) : lines;
}

function positiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const truncated = Math.floor(value);
  return truncated > 0 ? truncated : undefined;
}

function resolutionToResult(error: PathResolutionError): ToolExecutionResult {
  return {
    content: error.message,
    error: error.message,
    ok: false,
  };
}
