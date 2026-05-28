import type { JsonValue, ToolDefinition, ToolExecutionResult } from "../../types";
import { PathResolutionError, tryResolveAllowedPath } from "../../paths";
import { defaultFilesBackend, type FilesBackend } from "./backend";
import {
  DEFAULT_EXCLUDED_DIRECTORIES,
  extensionFromName,
  normalizeExtension,
  toStringArray,
} from "./filesTraversal";

const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_MAX_CHILDREN_PER_DIRECTORY = 24;

interface TreeNode {
  depth: number;
  fileCount: number;
  name: string;
  omittedChildren: number;
  path: string;
}

export function createFilesTreeSummaryTool(backend: FilesBackend = defaultFilesBackend): ToolDefinition {
  return {
    description:
      "Summarize a workspace folder tree without dumping every file. Skips generated/cache directories " +
      "such as node_modules, dist, target, and .git by default. Use this before files_search/files_read_range " +
      "when the user asks to explore project structure.",
    execute: async (args, context) => {
      const path = typeof args.path === "string" && args.path.trim() ? args.path : context.workspaceRoots?.[0] ?? "";
      const resolution = tryResolveAllowedPath(context, path);
      if (!resolution.ok) {
        return resolutionToResult(resolution.error);
      }

      const includeGenerated = args.includeGenerated === true;
      const maxDepth = positiveInteger(args.maxDepth) ?? DEFAULT_MAX_DEPTH;
      const maxChildrenPerDirectory = positiveInteger(args.maxChildrenPerDirectory) ?? DEFAULT_MAX_CHILDREN_PER_DIRECTORY;
      const excludeDirectories = new Set(toStringArray(args.excludeDirectories).map((value) => value.toLowerCase()));

      if (context.signal?.aborted) {
        return { content: "Tool bridge run aborted before files_tree_summary could scan the workspace.", ok: false };
      }

      try {
        const summary = await buildTreeSummary(backend, resolution.path.resolved, {
          excludeDirectories,
          includeGenerated,
          maxChildrenPerDirectory,
          maxDepth,
          signal: context.signal,
        });

        return {
          content: formatTreeSummary(summary),
          data: summary as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not summarize workspace tree.";
        return {
          content: message,
          error: message,
          ok: false,
        };
      }
    },
    executorMetadata: { family: "files", version: 1 },
    id: "files_tree_summary",
    inputSchema: {
      additionalProperties: false,
      properties: {
        excludeDirectories: {
          description: "Directory names to skip in addition to default generated/cache folders.",
          items: { type: "string" },
          type: "array",
        },
        includeGenerated: {
          description: "When true, include generated/cache directories such as node_modules, dist, target, and .git. Defaults to false.",
          type: "boolean",
        },
        maxChildrenPerDirectory: {
          description: `Maximum child directory names to show under each scanned directory. Defaults to ${DEFAULT_MAX_CHILDREN_PER_DIRECTORY}.`,
          minimum: 1,
          type: "integer",
        },
        maxDepth: {
          description: `Maximum directory depth to summarize from the root. Defaults to ${DEFAULT_MAX_DEPTH}.`,
          minimum: 1,
          type: "integer",
        },
        path: {
          description: "Directory path to summarize. Defaults to the first configured workspace root.",
          minLength: 1,
          type: "string",
        },
      },
      type: "object",
    },
    permission: "read-only",
    risk: "read",
    title: "Summarize workspace tree",
  };
}

async function buildTreeSummary(
  backend: FilesBackend,
  rootPath: string,
  options: {
    excludeDirectories: Set<string>;
    includeGenerated: boolean;
    maxChildrenPerDirectory: number;
    maxDepth: number;
    signal: AbortSignal | undefined;
  },
) {
  const excludedDirectories = new Set([
    ...(options.includeGenerated ? [] : DEFAULT_EXCLUDED_DIRECTORIES),
    ...options.excludeDirectories,
  ]);
  const queue: Array<{ depth: number; name: string; path: string }> = [{ depth: 0, name: rootPath.split(/[\\/]+/).filter(Boolean).pop() ?? rootPath, path: rootPath }];
  const nodes: TreeNode[] = [];
  const extensionCounts = new Map<string, number>();
  let directoryCount = 0;
  let fileCount = 0;
  let inaccessibleEntries = 0;
  let skippedDirectories = 0;
  let omittedChildDirectories = 0;
  let limited = false;

  while (queue.length > 0) {
    if (options.signal?.aborted) {
      break;
    }

    const current = queue.shift()!;
    let listing;

    try {
      listing = await backend.listDirectory(current.path);
    } catch {
      inaccessibleEntries += 1;
      continue;
    }

    directoryCount += 1;
    inaccessibleEntries += listing.inaccessibleEntries;
    limited ||= listing.limited;

    const childDirectories = listing.entries.filter((entry) => entry.kind === "directory");
    const files = listing.entries.filter((entry) => entry.kind === "file");
    fileCount += files.length;

    for (const file of files) {
      const extension = normalizeExtension(file.extension ?? extensionFromName(file.name)) || "(no extension)";
      extensionCounts.set(extension, (extensionCounts.get(extension) ?? 0) + 1);
    }

    const includedChildDirectories = childDirectories.filter((entry) => !excludedDirectories.has(entry.name.toLowerCase()));
    const skippedHere = childDirectories.length - includedChildDirectories.length;
    skippedDirectories += skippedHere;

    const displayedChildren = includedChildDirectories.slice(0, options.maxChildrenPerDirectory);
    const omittedHere = Math.max(includedChildDirectories.length - displayedChildren.length, 0);
    omittedChildDirectories += omittedHere;

    nodes.push({
      depth: current.depth,
      fileCount: files.length,
      name: current.name,
      omittedChildren: omittedHere,
      path: current.path,
    });

    if (current.depth + 1 < options.maxDepth) {
      for (const child of displayedChildren) {
        queue.push({
          depth: current.depth + 1,
          name: child.name,
          path: child.path,
        });
      }
    } else if (displayedChildren.length > 0) {
      // Count only directories that maxDepth would have recursed into.
      omittedChildDirectories += displayedChildren.length;
    }
  }

  const topFileTypes = [...extensionCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 12)
    .map(([extension, count]) => ({ count, extension }));

  return {
    directoryCount,
    fileCount,
    includeGenerated: options.includeGenerated,
    inaccessibleEntries,
    limited,
    maxChildrenPerDirectory: options.maxChildrenPerDirectory,
    maxDepth: options.maxDepth,
    nodes,
    omittedChildDirectories,
    path: rootPath,
    skippedDirectories,
    topFileTypes,
  };
}

function formatTreeSummary(summary: Awaited<ReturnType<typeof buildTreeSummary>>) {
  const lines = [
    // Wrap the path in backticks so markdown preserves Windows backslashes.
    `Workspace tree summary for \`${summary.path}\``,
    `Scanned ${formatNumber(summary.directoryCount)} director${summary.directoryCount === 1 ? "y" : "ies"} and ${formatNumber(summary.fileCount)} file${summary.fileCount === 1 ? "" : "s"} to depth ${summary.maxDepth}.`,
    summary.skippedDirectories > 0 ? `Skipped ${formatNumber(summary.skippedDirectories)} generated/cache director${summary.skippedDirectories === 1 ? "y" : "ies"} by default.` : "",
    summary.omittedChildDirectories > 0 ? `Omitted ${formatNumber(summary.omittedChildDirectories)} child director${summary.omittedChildDirectories === 1 ? "y" : "ies"} from the displayed tree summary; narrow path or raise maxDepth/maxChildrenPerDirectory for more.` : "",
    summary.topFileTypes.length > 0 ? `Top file types: ${summary.topFileTypes.map((item) => `${item.extension} ${formatNumber(item.count)}`).join("; ")}.` : "",
    "",
    ...summary.nodes.map((node) => {
      const indent = "  ".repeat(node.depth);
      const omitted = node.omittedChildren > 0 ? `, ${node.omittedChildren} more dirs omitted` : "";
      return `${indent}${node.depth === 0 ? "" : "- "}${node.name}/ (${node.fileCount} files${omitted})`;
    }),
  ].filter(Boolean);

  return lines.join("\n");
}

function positiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const truncated = Math.floor(value);
  return truncated > 0 ? truncated : undefined;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function resolutionToResult(error: PathResolutionError): ToolExecutionResult {
  return {
    content: error.message,
    error: error.message,
    ok: false,
  };
}
