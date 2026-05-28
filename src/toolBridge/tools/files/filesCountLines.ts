import type { JsonValue, ToolDefinition } from "../../types";
import { PathResolutionError, tryResolveAllowedPath } from "../../paths";
import { defaultFilesBackend, type FilesBackend } from "./backend";

const DEFAULT_SOURCE_EXTENSIONS = [
  "astro",
  "c",
  "cpp",
  "cs",
  "css",
  "dart",
  "go",
  "graphql",
  "h",
  "html",
  "java",
  "js",
  "jsx",
  "kt",
  "kts",
  "lua",
  "php",
  "py",
  "rb",
  "rs",
  "scss",
  "sh",
  "sql",
  "svelte",
  "swift",
  "toml",
  "ts",
  "tsx",
  "vue",
  "xml",
  "yaml",
  "yml",
];
const DEFAULT_EXCLUDED_DIRECTORIES = [
  ".cache",
  ".dart_tool",
  ".expo",
  ".git",
  ".gradle",
  ".hg",
  ".idea",
  ".next",
  ".nuxt",
  ".parcel-cache",
  ".pytest_cache",
  ".svn",
  ".tools",
  ".turbo",
  ".venv",
  ".vite",
  ".vscode",
  "__pycache__",
  "build",
  "coverage",
  "deriveddata",
  "dist",
  "env",
  "logs",
  "node_modules",
  "pods",
  "target",
  "temp",
  "tmp",
  "venv",
];
const DEFAULT_EXCLUDED_FILES = new Set(["package-lock.json", "pnpm-lock.yaml", "yarn.lock"]);
const MAX_CONCURRENT_READS = 8;

interface CountedFile {
  blankLines: number;
  extension: string;
  lines: number;
  path: string;
  size: number;
}

type CandidateFile = Pick<CountedFile, "extension" | "path" | "size">;

interface CountSourceLinesOptions {
  extensions: Set<string>;
  excludeDirectories: Set<string>;
  includeBlankLines: boolean;
  includeGenerated: boolean;
}

export function createFilesCountLinesTool(backend: FilesBackend = defaultFilesBackend): ToolDefinition {
  return {
    description:
      "Count lines across source-like text files inside a workspace path without returning file contents. " +
      "Use this for requests such as total lines of code, source tree line counts, or line counts by extension. " +
      "Generated folders such as node_modules, dist, build, target, and .git are skipped by default unless includeGenerated=true.",
    execute: async (args, context) => {
      const requestedPath = typeof args.path === "string" && args.path.trim() ? args.path : context.workspaceRoots?.[0] ?? "";
      const resolution = tryResolveAllowedPath(context, requestedPath);

      if (!resolution.ok) {
        return resolutionToResult(resolution.error);
      }

      if (context.signal?.aborted) {
        return { content: "Tool bridge run aborted before files_count_lines could scan the workspace.", ok: false };
      }

      const options = normalizeOptions(args);
      const candidateFiles: CandidateFile[] = [];
      let inaccessibleEntries = 0;
      let skippedFiles = 0;
      let skippedDirectories = 0;

      async function visitDirectory(path: string): Promise<void> {
        if (context.signal?.aborted) {
          return;
        }

        let listing;
        try {
          listing = await backend.listDirectory(path);
        } catch {
          inaccessibleEntries += 1;
          return;
        }

        inaccessibleEntries += listing.inaccessibleEntries;

        for (const entry of listing.entries) {
          if (context.signal?.aborted) {
            return;
          }

          if (entry.kind === "directory") {
            if (options.excludeDirectories.has(entry.name.toLowerCase())) {
              skippedDirectories += 1;
              continue;
            }

            await visitDirectory(entry.path);
            continue;
          }

          if (entry.kind !== "file") {
            skippedFiles += 1;
            continue;
          }

          const extension = (entry.extension ?? extensionFromName(entry.name)).toLowerCase();
          if (!extension || !options.extensions.has(extension) || DEFAULT_EXCLUDED_FILES.has(entry.name.toLowerCase())) {
            skippedFiles += 1;
            continue;
          }

          candidateFiles.push({ extension, path: entry.path, size: entry.size ?? 0 });
        }
      }

      await visitDirectory(resolution.path.resolved);
      const files = await countFilesWithConcurrency(candidateFiles, backend, context.signal);

      if (context.signal?.aborted) {
        return { content: "Tool bridge run aborted before files_count_lines finished scanning the workspace.", ok: false };
      }

      const readableFiles = files.filter((file) => file.lines >= 0);
      const failedFiles = files.length - readableFiles.length;
      const summary = summarizeLineCounts(readableFiles, {
        inaccessibleEntries,
        includeBlankLines: options.includeBlankLines,
        includeGenerated: options.includeGenerated,
        path: resolution.path.resolved,
        skippedDirectories,
        skippedFiles,
        unreadableFiles: failedFiles,
      });

      return {
        content: summary.content,
        data: summary.data as JsonValue,
        ok: true,
      };
    },
    executorMetadata: { family: "files", version: 1 },
    id: "files_count_lines",
    inputSchema: {
      additionalProperties: false,
      properties: {
        excludeDirectories: {
          description: "Directory names to skip in addition to the default generated/cache folders.",
          items: { type: "string" },
          type: "array",
        },
        extensions: {
          description: "File extensions to include, without dots. Defaults to common source-code extensions.",
          items: { type: "string" },
          type: "array",
        },
        includeBlankLines: {
          description: "Whether blank lines should be counted in the total. Defaults to true.",
          type: "boolean",
        },
        includeGenerated: {
          description: "When true, do not apply the default generated/cache directory exclusions.",
          type: "boolean",
        },
        path: {
          description: "Directory path to scan. Defaults to the first configured workspace root.",
          minLength: 1,
          type: "string",
        },
      },
      type: "object",
    },
    permission: "read-only",
    risk: "read",
    title: "Count source lines",
  };
}

async function countFilesWithConcurrency(candidates: CandidateFile[], backend: FilesBackend, signal: AbortSignal | undefined) {
  const results: CountedFile[] = [];
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(MAX_CONCURRENT_READS, candidates.length));

  async function worker() {
    while (!signal?.aborted) {
      const currentIndex = nextIndex;
      if (currentIndex >= candidates.length) {
        return;
      }

      nextIndex += 1;
      const candidate = candidates[currentIndex]!;
      results[currentIndex] = await countFile(candidate.path, candidate.extension, candidate.size, backend);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results.filter((result): result is CountedFile => Boolean(result));
}

async function countFile(path: string, extension: string, size: number, backend: FilesBackend): Promise<CountedFile> {
  try {
    const file = await backend.readTextFile(path);
    return {
      blankLines: countBlankLines(file.content),
      extension,
      lines: countLines(file.content),
      path: file.path,
      size: file.size,
    };
  } catch {
    return {
      blankLines: 0,
      extension,
      lines: -1,
      path,
      size,
    };
  }
}

function normalizeOptions(args: Record<string, unknown>): CountSourceLinesOptions {
  const explicitExtensions = toStringArray(args.extensions).map((extension) => extension.replace(/^\./, "").toLowerCase()).filter(Boolean);
  const explicitExcludedDirectories = toStringArray(args.excludeDirectories).map((directory) => directory.toLowerCase()).filter(Boolean);
  const includeGenerated = args.includeGenerated === true;

  return {
    excludeDirectories: new Set([...(includeGenerated ? [] : DEFAULT_EXCLUDED_DIRECTORIES), ...explicitExcludedDirectories]),
    extensions: new Set(explicitExtensions.length > 0 ? explicitExtensions : DEFAULT_SOURCE_EXTENSIONS),
    includeBlankLines: args.includeBlankLines !== false,
    includeGenerated,
  };
}

function toStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function summarizeLineCounts(
  files: CountedFile[],
  options: {
    inaccessibleEntries: number;
    includeBlankLines: boolean;
    includeGenerated: boolean;
    path: string;
    skippedDirectories: number;
    skippedFiles: number;
    unreadableFiles: number;
  },
) {
  const byExtension = new Map<string, { files: number; lines: number }>();
  const totalLines = files.reduce((total, file) => total + (options.includeBlankLines ? file.lines : file.lines - file.blankLines), 0);
  const totalBlankLines = files.reduce((total, file) => total + file.blankLines, 0);

  for (const file of files) {
    const current = byExtension.get(file.extension) ?? { files: 0, lines: 0 };
    current.files += 1;
    current.lines += options.includeBlankLines ? file.lines : file.lines - file.blankLines;
    byExtension.set(file.extension, current);
  }

  const extensionRows = [...byExtension.entries()]
    .sort((left, right) => right[1].lines - left[1].lines || left[0].localeCompare(right[0]))
    .map(([extension, counts]) => ({ extension, ...counts }));
  const largestFiles = [...files]
    .sort((left, right) => right.lines - left.lines)
    .slice(0, 10)
    .map((file) => ({
      extension: file.extension,
      lines: options.includeBlankLines ? file.lines : file.lines - file.blankLines,
      path: file.path,
      size: file.size,
    }));
  const content = [
    `Counted ${formatNumber(totalLines)} line${totalLines === 1 ? "" : "s"} across ${formatNumber(files.length)} source file${files.length === 1 ? "" : "s"} in \`${options.path}\`.`,
    options.includeBlankLines ? `Blank lines included (${formatNumber(totalBlankLines)} blank).` : `Blank lines excluded (${formatNumber(totalBlankLines)} blank omitted).`,
    extensionRows.length > 0
      ? `By extension: ${extensionRows.map((row) => `.${row.extension} ${formatNumber(row.lines)} in ${formatNumber(row.files)} file${row.files === 1 ? "" : "s"}`).join("; ")}.`
      : "",
    options.skippedDirectories > 0 ? `Skipped ${formatNumber(options.skippedDirectories)} generated/cache director${options.skippedDirectories === 1 ? "y" : "ies"}.` : "",
    options.skippedFiles > 0 ? `Skipped ${formatNumber(options.skippedFiles)} non-source or excluded file${options.skippedFiles === 1 ? "" : "s"}.` : "",
    options.unreadableFiles > 0 || options.inaccessibleEntries > 0
      ? `${formatNumber(options.unreadableFiles + options.inaccessibleEntries)} item${options.unreadableFiles + options.inaccessibleEntries === 1 ? "" : "s"} could not be read.`
      : "",
  ].filter(Boolean).join("\n");

  return {
    content,
    data: {
      blankLines: totalBlankLines,
      byExtension: extensionRows,
      files: files.length,
      inaccessibleEntries: options.inaccessibleEntries,
      includeBlankLines: options.includeBlankLines,
      includeGenerated: options.includeGenerated,
      largestFiles,
      lines: totalLines,
      path: options.path,
      skippedDirectories: options.skippedDirectories,
      skippedFiles: options.skippedFiles,
      unreadableFiles: options.unreadableFiles,
    },
  };
}

function countLines(content: string) {
  if (!content) {
    return 0;
  }

  const newlineCount = content.match(/\n/g)?.length ?? 0;
  return content.endsWith("\n") ? newlineCount : newlineCount + 1;
}

function countBlankLines(content: string) {
  if (!content) {
    return 0;
  }

  return content.split(/\r?\n/).filter((line, index, lines) => {
    if (index === lines.length - 1 && line === "" && content.endsWith("\n")) {
      return false;
    }
    return line.trim().length === 0;
  }).length;
}

function extensionFromName(name: string) {
  const index = name.lastIndexOf(".");
  return index >= 0 && index < name.length - 1 ? name.slice(index + 1) : "";
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function resolutionToResult(error: PathResolutionError) {
  return {
    content: error.message,
    error: error.message,
    ok: false,
  };
}
