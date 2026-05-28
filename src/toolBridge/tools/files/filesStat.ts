import type { JsonValue, ToolDefinition, ToolExecutionResult } from "../../types";
import { PathResolutionError, tryResolveAllowedPath } from "../../paths";
import { defaultFilesBackend, type FilesBackend } from "./backend";

export function createFilesStatTool(backend: FilesBackend = defaultFilesBackend): ToolDefinition {
  return {
    description:
      "Return lightweight metadata for a path inside the workspace: kind " +
      "(directory | file | missing), size in bytes, last modified time, and the " +
      "canonical path the workspace backend resolved to. Prefer this over " +
      "files_read when you only need to confirm a file exists or check its size.",
    execute: async (args, context) => {
      const resolution = tryResolveAllowedPath(context, args.path);
      if (!resolution.ok) {
        return resolutionToResult(resolution.error);
      }

      if (context.signal?.aborted) {
        return { content: "Tool bridge run aborted before files_stat could call the backend.", ok: false };
      }

      // Try listing first because successful directory reads avoid an ambiguous file probe.
      try {
        const listing = await backend.listDirectory(resolution.path.resolved, 1);
        return {
          content: `Directory \`${listing.path}\``,
          data: {
            kind: "directory",
            modifiedAt: null,
            name: lastSegment(listing.path),
            parentPath: listing.parentPath ?? null,
            path: listing.path,
            size: null,
          } as JsonValue,
          ok: true,
        };
      } catch (listingError) {
        // Preserve the listing error in case the file probe also fails.
        try {
          const file = await backend.readTextFile(resolution.path.resolved, 1);
          return {
            content: `File \`${file.path}\` (${file.size} bytes)`,
            data: {
              extension: file.extension ?? null,
              kind: "file",
              modifiedAt: file.modifiedAt ?? null,
              name: file.name,
              path: file.path,
              size: file.size,
            } as JsonValue,
            ok: true,
          };
        } catch (fileError) {
          const message =
            "Path not found, inaccessible, or not a text file. " +
            describeStatError("Listing", listingError) +
            "; " +
            describeStatError("Read", fileError);
          return {
            content: message,
            data: {
              kind: "missing",
              path: resolution.path.resolved,
            } as JsonValue,
            error: message,
            ok: false,
          };
        }
      }
    },
    executorMetadata: { family: "files", version: 1 },
    id: "files_stat",
    inputSchema: {
      additionalProperties: false,
      properties: {
        path: {
          description: "Absolute path or path relative to the first workspace root.",
          minLength: 1,
          type: "string",
        },
      },
      required: ["path"],
      type: "object",
    },
    permission: "read-only",
    risk: "read",
    title: "Stat workspace path",
  };
}

function describeStatError(label: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "unknown error");
  return `${label} attempt: ${message}`;
}

function lastSegment(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const lastSlash = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  return lastSlash >= 0 ? trimmed.slice(lastSlash + 1) : trimmed;
}

function resolutionToResult(error: PathResolutionError): ToolExecutionResult {
  return {
    content: error.message,
    error: error.message,
    ok: false,
  };
}
