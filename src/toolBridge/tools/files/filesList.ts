import type { JsonValue, ToolDefinition, ToolExecutionResult } from "../../types";
import { PathResolutionError, tryResolveAllowedPath } from "../../paths";
import { defaultFilesBackend, type FilesBackend } from "./backend";
import { DEFAULT_EXCLUDED_DIRECTORIES } from "./filesTraversal";

type ListedEntry = {
  extension?: string | null;
  kind: string;
  modifiedAt?: number | null;
  name: string;
  path: string;
  size?: number | null;
};

export function createFilesListTool(backend: FilesBackend = defaultFilesBackend): ToolDefinition {
  return {
    description:
      "List the immediate entries of a directory inside the configured workspace " +
      "roots. Returns directories before files; each entry includes name, kind, " +
      "absolute path, and (for files) size and modifiedAt. By default this returns " +
      "the first configured workspace root when path is omitted, and returns " +
      "every readable entry without a bridge-imposed cap. Set recursive=true to " +
      "walk the folder tree while skipping generated/cache directories such as " +
      "node_modules, dist, target, and .git unless includeGenerated=true. Pass " +
      "limit only when the user asks for a bounded listing.",
    execute: async (args, context) => {
      const requestedPath = typeof args.path === "string" && args.path.trim() ? args.path : context.workspaceRoots?.[0] ?? "";
      const resolution = tryResolveAllowedPath(context, requestedPath);
      if (!resolution.ok) {
        return resolutionToResult(resolution.error);
      }

      const limit = optionalPositiveInteger(args.limit);
      const recursive = args.recursive === true;
      const includeGenerated = args.includeGenerated === true;
      const excludeDirectories = new Set(toStringArray(args.excludeDirectories).map((value) => value.toLowerCase()));

      if (context.signal?.aborted) {
        return { content: "Tool bridge run aborted before files_list could call the backend.", ok: false };
      }

      try {
        const listing = recursive
          ? await listDirectoryTree(backend, resolution.path.resolved, {
              excludeDirectories,
              includeGenerated,
              limit,
              signal: context.signal,
            })
          : await listDirectory(backend, resolution.path.resolved, limit);
        return {
          content: formatListingPreview(listing.path, listing.entries, listing.limited, recursive, listing.skippedDirectories),
          data: {
            entries: listing.entries,
            includeGenerated,
            inaccessibleEntries: listing.inaccessibleEntries,
            limited: listing.limited,
            parentPath: listing.parentPath ?? null,
            path: listing.path,
            recursive,
            skippedDirectories: listing.skippedDirectories,
          } as JsonValue,
          ok: true,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not list directory.";
        return {
          content: message,
          error: message,
          ok: false,
        };
      }
    },
    executorMetadata: { family: "files", version: 1 },
    id: "files_list",
    inputSchema: {
      additionalProperties: false,
      properties: {
        excludeDirectories: {
          description: "Directory names to skip while recursive=true, in addition to default generated/cache folders.",
          items: { type: "string" },
          type: "array",
        },
        includeGenerated: {
          description: "When true, recursive listings include generated/cache directories such as node_modules, dist, target, and .git. Defaults to false.",
          type: "boolean",
        },
        limit: {
          description: "Optional maximum entries to return. Omit this to return every readable entry.",
          minimum: 1,
          type: "integer",
        },
        path: {
          description: "Absolute directory path or path relative to the first workspace root. Omit to list the first workspace root.",
          minLength: 1,
          type: "string",
        },
        recursive: {
          description: "When true, walk all descendant folders instead of listing only the immediate directory.",
          type: "boolean",
        },
      },
      type: "object",
    },
    permission: "read-only",
    risk: "read",
    title: "List workspace directory",
  };
}

async function listDirectory(backend: FilesBackend, path: string, limit: number | undefined) {
  const listing = await backend.listDirectory(path, limit);
  return {
    entries: listing.entries.map(normalizeEntry),
    inaccessibleEntries: listing.inaccessibleEntries,
    limited: listing.limited,
    parentPath: listing.parentPath,
    path: listing.path,
    skippedDirectories: 0,
  };
}

async function listDirectoryTree(
  backend: FilesBackend,
  rootPath: string,
  options: {
    excludeDirectories: Set<string>;
    includeGenerated: boolean;
    limit: number | undefined;
    signal: AbortSignal | undefined;
  },
) {
  const entries: ListedEntry[] = [];
  const queue = [rootPath];
  const excludedDirectories = new Set([
    ...(options.includeGenerated ? [] : DEFAULT_EXCLUDED_DIRECTORIES),
    ...options.excludeDirectories,
  ]);
  let inaccessibleEntries = 0;
  let limited = false;
  let skippedDirectories = 0;

  while (queue.length > 0) {
    if (options.signal?.aborted) {
      break;
    }

    const currentPath = queue.shift()!;
    let listing;

    try {
      listing = await backend.listDirectory(currentPath);
    } catch {
      inaccessibleEntries += 1;
      continue;
    }

    inaccessibleEntries += listing.inaccessibleEntries;
    limited ||= listing.limited;

    for (const entry of listing.entries) {
      if (options.limit !== undefined && entries.length >= options.limit) {
        limited = true;
        break;
      }

      if (entry.kind === "directory") {
        if (excludedDirectories.has(entry.name.toLowerCase())) {
          skippedDirectories += 1;
        } else {
          entries.push(normalizeEntry(entry));
          queue.push(entry.path);
        }
        continue;
      }

      entries.push(normalizeEntry(entry));
    }

    if (options.limit !== undefined && entries.length >= options.limit) {
      break;
    }
  }

  return {
    entries,
    inaccessibleEntries,
    limited,
    parentPath: undefined,
    path: rootPath,
    skippedDirectories,
  };
}

function normalizeEntry(entry: {
  extension?: string;
  kind: string;
  modifiedAt?: number;
  name: string;
  path: string;
  size?: number;
}): ListedEntry {
  return {
    extension: entry.extension ?? null,
    kind: entry.kind,
    modifiedAt: entry.modifiedAt ?? null,
    name: entry.name,
    path: entry.path,
    size: entry.size ?? null,
  };
}

function optionalPositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const truncated = Math.floor(value);
  return truncated > 0 ? truncated : undefined;
}

function toStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function formatListingPreview(
  path: string,
  entries: Array<{ kind: string; name: string; path?: string }>,
  limited: boolean,
  recursive: boolean,
  skippedDirectories: number,
): string {
  if (entries.length === 0) {
    return [
      `Directory \`${path}\` is empty${limited ? " (listing was limited)" : ""}.`,
      skippedDirectories > 0 ? `Skipped ${skippedDirectories} generated/cache director${skippedDirectories === 1 ? "y" : "ies"} by default. Pass includeGenerated=true only when those folders are explicitly needed.` : "",
    ].filter(Boolean).join("\n");
  }
  // Wrap paths in backticks so markdown preserves Windows backslashes verbatim.
  const previewLines = entries.map(
    (entry) => `${entry.kind === "directory" ? "[dir]" : "[file]"} \`${entry.path ?? entry.name}\``,
  );
  return [
    `${recursive ? "Recursive directory tree" : "Directory"} \`${path}\` (${entries.length} entries):`,
    ...previewLines,
    skippedDirectories > 0 ? `Skipped ${skippedDirectories} generated/cache director${skippedDirectories === 1 ? "y" : "ies"} by default. Pass includeGenerated=true only when those folders are explicitly needed.` : "",
    limited ? "Listing was limited by an explicit limit or backend interruption; omit `limit` if you need every entry." : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function resolutionToResult(error: PathResolutionError): ToolExecutionResult {
  return {
    content: error.message,
    error: error.message,
    ok: false,
  };
}
