import type { JsonValue, ToolDefinition, ToolExecutionResult } from "../../types";
import { PathResolutionError, tryResolveAllowedPath } from "../../paths";
import { defaultFilesBackend, type FilesBackend } from "./backend";
import { formatRecoveredContent, readErrorMessage, readTextFileWithModuleRecovery } from "./readUtils";

export function createFilesReadTool(backend: FilesBackend = defaultFilesBackend): ToolDefinition {
  return {
    description:
      "Read a UTF-8 text file from inside the configured workspace roots. " +
      "Use this before claiming to know a file's contents; do not guess. The file " +
      "must be a text file; binary files are rejected. By default this reads the " +
      "entire file without a bridge-imposed size cap. Pass maxBytes only when the " +
      "user asks for a bounded preview or chunk. If the model accidentally sends " +
      "startLine/endLine, this tool returns that line range instead of failing; " +
      "prefer files_read_range for intentional line-based reads. Paths can be absolute or relative " +
      "to the first workspace root.",
    execute: async (args, context) => {
      const resolution = tryResolveAllowedPath(context, args.path);
      if (!resolution.ok) {
        return resolutionToResult(resolution.error);
      }

      const maxBytes = optionalPositiveInteger(args.maxBytes);
      const offset = optionalNonNegativeInteger(args.offset);
      const requestedStartLine = optionalPositiveInteger(args.startLine ?? args.start_line);
      const requestedEndLine = optionalPositiveInteger(args.endLine ?? args.end_line);
      const includeLineNumbers = args.includeLineNumbers !== false;
      const hasLineRangeArgs = requestedStartLine !== undefined || requestedEndLine !== undefined;

      if (hasLineRangeArgs && requestedEndLine !== undefined && requestedEndLine < (requestedStartLine ?? 1)) {
        return {
          content: "files_read endLine must be greater than or equal to startLine.",
          error: "files_read endLine must be greater than or equal to startLine.",
          ok: false,
        };
      }

      if (context.signal?.aborted) {
        return { content: "Tool bridge run aborted before files_read could call the backend.", ok: false };
      }

      try {
        if (hasLineRangeArgs) {
          const startLine = requestedStartLine ?? 1;

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
                  source: "native-line-range-via-files-read",
                  startLine: range.startLine,
                  totalLines: range.totalLines,
                  truncated: range.truncated,
                } as unknown as JsonValue,
                ok: true,
              };
            } catch {
              // Fall through so module-path recovery can still handle common stale imports.
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
              source: "line-range-via-files-read",
              startLine,
              totalLines,
              truncated: file.truncated,
            } as unknown as JsonValue,
            ok: true,
          };
        }

        const read = await readTextFileWithModuleRecovery(backend, resolution.path.resolved, maxBytes, offset);
        const file = read.file;
        return {
          content: formatRecoveredContent(read),
          data: {
            content: file.content,
            extension: file.extension ?? null,
            modifiedAt: file.modifiedAt ?? null,
            name: file.name,
            offset: offset ?? 0,
            path: file.path,
            recoveredFrom: read.recoveredFrom ?? null,
            recoveryNote: read.recoveryNote ?? null,
            sha256: file.sha256 ?? null,
            size: file.size,
            truncated: file.truncated,
          } as JsonValue,
          ok: true,
        };
      } catch (error) {
        const message = readErrorMessage(error, "Could not read file.");
        return {
          content: message,
          error: message,
          ok: false,
        };
      }
    },
    executorMetadata: { family: "files", version: 1 },
    id: "files_read",
    inputSchema: {
      additionalProperties: false,
      properties: {
        maxBytes: {
          description: "Optional maximum bytes to read. Omit this to read the full text file.",
          minimum: 1,
          type: "integer",
        },
        offset: {
          description: "Optional zero-based byte offset to start reading from. Use files_read_range for line-based reads.",
          minimum: 0,
          type: "integer",
        },
        endLine: {
          description: "Compatibility alias for files_read_range: optional 1-based ending line number, inclusive.",
          minimum: 1,
          type: "integer",
        },
        end_line: {
          description: "Alias for endLine.",
          minimum: 1,
          type: "integer",
        },
        includeLineNumbers: {
          description: "When startLine/endLine are used, prefix each returned line with its original 1-based line number. Defaults to true.",
          type: "boolean",
        },
        path: {
          description: "Absolute path or path relative to the first workspace root.",
          minLength: 1,
          type: "string",
        },
        startLine: {
          description: "Compatibility alias for files_read_range: optional 1-based starting line number, inclusive.",
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
    title: "Read workspace file",
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

function optionalPositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const truncated = Math.floor(value);
  return truncated > 0 ? truncated : undefined;
}

function optionalNonNegativeInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const truncated = Math.floor(value);
  return truncated >= 0 ? truncated : undefined;
}

function resolutionToResult(error: PathResolutionError): ToolExecutionResult {
  return {
    content: error.message,
    error: error.message,
    ok: false,
  };
}
