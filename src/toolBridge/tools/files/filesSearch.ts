import type { JsonValue, ToolDefinition, ToolExecutionResult } from "../../types";
import type { ComputerSearchResult } from "../../../types/localWorkspace";
import { PathResolutionError, tryResolveAllowedPath } from "../../paths";
import { defaultFilesBackend, type FilesBackend } from "./backend";
import {
  DEFAULT_TEXT_SEARCH_EXTENSIONS,
  normalizeExtension,
  toStringArray,
  walkWorkspaceFiles,
  type TraversedFile,
} from "./filesTraversal";

const MAX_CONCURRENT_READS = 8;
const DEFAULT_MAX_MATCHING_FILES = 120;
const MAX_MAX_MATCHING_FILES = 500;
const DEFAULT_MAX_MATCHES_PER_FILE = 20;
const MAX_MAX_MATCHES_PER_FILE = 100;
const FALLBACK_SCAN_TIME_BUDGET_MS = 10_000;
const MAX_FALLBACK_CANDIDATE_FILES = 6_000;
const MAX_FALLBACK_TEXT_SEARCH_FILE_BYTES = 2 * 1024 * 1024;
type SearchMode = "auto" | "index" | "scan";

interface FileSearchMatch {
  after?: Array<{ line: number; preview: string }>;
  before?: Array<{ line: number; preview: string }>;
  line: number;
  preview: string;
}

interface FileSearchResult {
  contentMatches: FileSearchMatch[];
  extension: string | null;
  name: string;
  path: string;
  pathMatched: boolean;
  size?: number | null;
}

interface SearchOptions {
  caseSensitive: boolean;
  contextLines: number;
  excludeDirectories: Set<string>;
  extensions?: Set<string>;
  globs: string[];
  includeContent: boolean;
  includeGenerated: boolean;
  includePath: boolean;
  maxMatches?: number;
  maxMatchesPerFile?: number;
  path: string;
  query: string;
  regex: boolean;
  searchMode: SearchMode;
}

export function createFilesSearchTool(backend: FilesBackend = defaultFilesBackend): ToolDefinition {
  return {
    description:
      "Search file paths and/or full text content inside the configured workspace roots. " +
      "Use this before reading files when you need to find relevant code quickly. " +
      "By default it searches paths and content across text-like files, skips generated/cache folders, " +
      `and returns up to ${DEFAULT_MAX_MATCHING_FILES} matching files unless maxMatches is provided.`,
    execute: async (args, context) => {
      const options = normalizeOptions(args, context.workspaceRoots?.[0] ?? "");
      if (!options.query) {
        return {
          content: "files_search requires a non-empty query.",
          error: "files_search requires a non-empty query.",
          ok: false,
        };
      }

      const resolution = tryResolveAllowedPath(context, options.path);
      if (!resolution.ok) {
        return resolutionToResult(resolution.error);
      }

      const matcher = createMatcher(options);
      if (!matcher.ok) {
        return {
          content: matcher.error,
          error: matcher.error,
          ok: false,
        };
      }
      const activeMatcher = matcher;

      if (context.signal?.aborted) {
        return { content: "Tool bridge run aborted before files_search could scan the workspace.", ok: false };
      }

      const indexedResult = await trySearchIndexedFiles(backend, context, options, resolution.path.resolved, activeMatcher);

      if (indexedResult) {
        return indexedResult;
      }

      const nativeScanResult = await trySearchNativeTextFiles(backend, context, options, resolution.path.resolved);

      if (nativeScanResult) {
        return nativeScanResult;
      }

      context.reportProgress?.({
        content: `Scanning workspace files for "${options.query}".`,
        data: {
          maxMatches: options.maxMatches,
          query: options.query,
          source: "workspace-scan",
        } as unknown as JsonValue,
        ok: true,
      });

      const scanDeadlineMs = Date.now() + FALLBACK_SCAN_TIME_BUDGET_MS;
      const traversal = await walkWorkspaceFiles(backend, resolution.path.resolved, {
        deadlineMs: scanDeadlineMs,
        excludeDirectories: options.excludeDirectories,
        includeGenerated: options.includeGenerated,
        limit: MAX_FALLBACK_CANDIDATE_FILES,
        signal: context.signal,
      });
      const searchableExtensions = options.extensions ?? new Set(DEFAULT_TEXT_SEARCH_EXTENSIONS);
      const candidateFiles = traversal.files.filter((file) => matchesGlobs(file, options.globs));
      const results: FileSearchResult[] = [];
      const maxMatches = effectiveMaxMatches(options);
      const maxMatchesPerFile = effectiveMaxMatchesPerFile(options);
      let filesRead = 0;
      let limitedByBudget = traversal.limited;
      let skippedLargeFiles = 0;
      let unreadableFiles = 0;
      let totalContentMatches = 0;

      let nextIndex = 0;
      const workerCount = Math.max(1, Math.min(MAX_CONCURRENT_READS, candidateFiles.length));

      async function worker() {
        while (!context.signal?.aborted) {
          if (Date.now() >= scanDeadlineMs) {
            limitedByBudget = true;
            return;
          }

          const currentIndex = nextIndex;
          if (currentIndex >= candidateFiles.length) {
            return;
          }

          if (isMatchLimitReached(results.length, maxMatches)) {
            limitedByBudget = true;
            return;
          }

          nextIndex += 1;
          const file = candidateFiles[currentIndex]!;
          const pathMatched = options.includePath && activeMatcher.test(file.path);
          const shouldReadContent = options.includeContent && searchableExtensions.has(file.extension);
          let contentMatches: FileSearchMatch[] = [];

          if (shouldReadContent) {
            if (typeof file.size === "number" && file.size > MAX_FALLBACK_TEXT_SEARCH_FILE_BYTES) {
              skippedLargeFiles += 1;
            } else {
              try {
                const read = await backend.readTextFile(file.path, MAX_FALLBACK_TEXT_SEARCH_FILE_BYTES + 1);
                filesRead += 1;
                contentMatches = findContentMatches(read.content, activeMatcher, maxMatchesPerFile, options.contextLines);
                totalContentMatches += contentMatches.length;
              } catch {
                unreadableFiles += 1;
              }
            }
          }

          if (pathMatched || contentMatches.length > 0) {
            results.push({
              contentMatches,
              extension: file.extension || null,
              name: file.name,
              path: file.path,
              pathMatched,
              size: file.size,
            });
          }
        }
      }

      await Promise.all(Array.from({ length: workerCount }, () => worker()));

      if (context.signal?.aborted) {
        return { content: "Tool bridge run aborted before files_search finished scanning the workspace.", ok: false };
      }

      const orderedResults = sortResults(results, options.query);
      const limitedResults = orderedResults.slice(0, maxMatches);

      return {
        content: formatSearchContent(options, limitedResults, {
          filteredByGlob: traversal.files.length - candidateFiles.length,
          filesRead,
          filesScanned: candidateFiles.length,
          inaccessibleEntries: traversal.inaccessibleEntries,
          limited: limitedByBudget || orderedResults.length > maxMatches,
          scannedDirectories: traversal.scannedDirectories,
          skippedLargeFiles,
          skippedDirectories: traversal.skippedDirectories,
          skippedFiles: traversal.skippedFiles,
          source: "scan",
          totalContentMatches,
          unreadableFiles,
        }),
        data: {
          filesRead,
          filesScanned: candidateFiles.length,
          filteredByGlob: traversal.files.length - candidateFiles.length,
          inaccessibleEntries: traversal.inaccessibleEntries,
          limited: limitedByBudget || orderedResults.length > maxMatches,
          matches: limitedResults,
          query: options.query,
          scannedDirectories: traversal.scannedDirectories,
          searchMode: "scan",
          skippedLargeFiles,
          skippedDirectories: traversal.skippedDirectories,
          skippedFiles: traversal.skippedFiles,
          source: "workspace-scan",
          totalContentMatches,
          unreadableFiles,
        } as unknown as JsonValue,
        ok: true,
      };
    },
    executorMetadata: { family: "files", version: 1 },
    id: "files_search",
    inputSchema: {
      additionalProperties: false,
      properties: {
        caseSensitive: {
          description: "When true, match case exactly. Defaults to false.",
          type: "boolean",
        },
        contextLines: {
          description: "Optional number of surrounding lines to include before and after each content match. Defaults to 0.",
          minimum: 0,
          type: "integer",
        },
        excludeDirectories: {
          description: "Directory names to skip in addition to default generated/cache folders.",
          items: { type: "string" },
          type: "array",
        },
        extensions: {
          description: "Optional file extensions to search for content, without dots. Omit to search common text/code files.",
          items: { type: "string" },
          type: "array",
        },
        glob: {
          description: "Optional wildcard path filter such as src/**/*.ts or **/*.tsx.",
          minLength: 1,
          type: "string",
        },
        globs: {
          description: "Optional wildcard path filters. A file matches if any glob matches its path or filename.",
          items: { type: "string" },
          type: "array",
        },
        includeContent: {
          description: "Whether to search file contents. Defaults to true.",
          type: "boolean",
        },
        includeGenerated: {
          description: "When true, do not apply default generated/cache directory exclusions.",
          type: "boolean",
        },
        includePath: {
          description: "Whether to search file paths and names. Defaults to true.",
          type: "boolean",
        },
        maxMatches: {
          description: `Maximum matching files to return. Defaults to ${DEFAULT_MAX_MATCHING_FILES} and is capped at ${MAX_MAX_MATCHING_FILES}.`,
          minimum: 1,
          type: "integer",
        },
        maxMatchesPerFile: {
          description: `Maximum matching lines to return per file. Defaults to ${DEFAULT_MAX_MATCHES_PER_FILE} and is capped at ${MAX_MAX_MATCHES_PER_FILE}.`,
          minimum: 1,
          type: "integer",
        },
        path: {
          description: "Directory path to search. Defaults to the first configured workspace root.",
          minLength: 1,
          type: "string",
        },
        query: {
          description: "Literal text or regular expression to search for.",
          minLength: 1,
          type: "string",
        },
        regex: {
          description: "When true, treat query as a JavaScript regular expression.",
          type: "boolean",
        },
        searchMode: {
          description: "Search strategy. auto uses the semantic file index for simple searches and falls back to exact scanning when strict filters are requested.",
          enum: ["auto", "index", "scan"],
          type: "string",
        },
      },
      required: ["query"],
      type: "object",
    },
    permission: "read-only",
    risk: "read",
    title: "Search workspace files",
  };
}

function normalizeOptions(args: Record<string, unknown>, fallbackPath: string): SearchOptions {
  const explicitExtensions = toStringArray(args.extensions).map(normalizeExtension).filter(Boolean);
  const glob = typeof args.glob === "string" && args.glob.trim() ? [args.glob.trim()] : [];
  const globs = [...glob, ...toStringArray(args.globs).map((value) => value.trim()).filter(Boolean)];

  return {
    caseSensitive: args.caseSensitive === true,
    contextLines: optionalNonNegativeInteger(args.contextLines) ?? 0,
    excludeDirectories: new Set(toStringArray(args.excludeDirectories).map((directory) => directory.toLowerCase())),
    extensions: explicitExtensions.length > 0 ? new Set(explicitExtensions) : undefined,
    globs,
    includeContent: args.includeContent !== false,
    includeGenerated: args.includeGenerated === true,
    includePath: args.includePath !== false,
    maxMatches: boundedPositiveInteger(args.maxMatches, MAX_MAX_MATCHING_FILES),
    maxMatchesPerFile: boundedPositiveInteger(args.maxMatchesPerFile, MAX_MAX_MATCHES_PER_FILE),
    path: typeof args.path === "string" && args.path.trim() ? args.path : fallbackPath,
    query: typeof args.query === "string" ? args.query.trim() : "",
    regex: args.regex === true,
    searchMode: normalizeSearchMode(args.searchMode),
  };
}

function normalizeSearchMode(value: unknown): SearchMode {
  return value === "index" || value === "scan" ? value : "auto";
}

function createMatcher(options: SearchOptions): { ok: true; test: (value: string) => boolean } | { error: string; ok: false } {
  if (options.regex) {
    try {
      const expression = new RegExp(options.query, options.caseSensitive ? "" : "i");
      return {
        ok: true,
        test: (value) => {
          expression.lastIndex = 0;
          return expression.test(value);
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid regular expression.";
      return {
        error: `Invalid files_search regex: ${message}`,
        ok: false,
      };
    }
  }

  const needle = options.caseSensitive ? options.query : options.query.toLowerCase();
  return {
    ok: true,
    test: (value) => (options.caseSensitive ? value : value.toLowerCase()).includes(needle),
  };
}

async function trySearchIndexedFiles(
  backend: FilesBackend,
  context: Parameters<ToolDefinition["execute"]>[1],
  options: SearchOptions,
  rootPath: string,
  matcher: { test: (value: string) => boolean },
): Promise<ToolExecutionResult | null> {
  if (options.searchMode === "scan" || !backend.searchIndexedFiles) {
    return null;
  }

  const incompatibility = getIndexedSearchIncompatibility(options);

  if (incompatibility) {
    if (options.searchMode === "index") {
      return {
        content: `Indexed semantic files_search cannot honor ${incompatibility}. Use searchMode "scan" for that query.`,
        error: `Indexed semantic files_search cannot honor ${incompatibility}. Use searchMode "scan" for that query.`,
        ok: false,
      };
    }

    return null;
  }

  try {
    const maxMatches = effectiveMaxMatches(options);
    const indexedMatches = await backend.searchIndexedFiles(options.query, maxMatches, [rootPath]);

    if (context.signal?.aborted) {
      return { content: "Tool bridge run aborted before files_search finished searching the file index.", ok: false };
    }

    const results = indexedResultsToFileSearchResults(indexedMatches, options, matcher);

    if (options.searchMode === "auto" && results.length === 0) {
      return null;
    }

    return {
      content: formatSearchContent(options, results, {
        filteredByGlob: 0,
        filesRead: 0,
        filesScanned: indexedMatches.length,
        inaccessibleEntries: 0,
        indexedMatches: indexedMatches.length,
        limited: indexedMatches.length >= maxMatches,
        scannedDirectories: 0,
        skippedLargeFiles: 0,
        skippedDirectories: 0,
        skippedFiles: indexedMatches.filter((match) => match.kind !== "file").length,
        source: "index",
        totalContentMatches: results.reduce((total, result) => total + result.contentMatches.length, 0),
        unreadableFiles: 0,
      }),
      data: {
        filesRead: 0,
        filesScanned: indexedMatches.length,
        filteredByGlob: 0,
        inaccessibleEntries: 0,
        indexedMatches: indexedMatches.length,
        limited: indexedMatches.length >= maxMatches,
        matches: results,
        query: options.query,
        scannedDirectories: 0,
        searchMode: "index",
        skippedLargeFiles: 0,
        skippedDirectories: 0,
        skippedFiles: indexedMatches.filter((match) => match.kind !== "file").length,
        source: "semantic-index",
        totalContentMatches: results.reduce((total, result) => total + result.contentMatches.length, 0),
        unreadableFiles: 0,
      } as unknown as JsonValue,
      ok: true,
    };
  } catch (error) {
    if (options.searchMode === "index") {
      const message = error instanceof Error ? error.message : "Indexed semantic files_search failed.";
      return {
        content: message,
        error: message,
        ok: false,
      };
    }

    return null;
  }
}

async function trySearchNativeTextFiles(
  backend: FilesBackend,
  context: Parameters<ToolDefinition["execute"]>[1],
  options: SearchOptions,
  rootPath: string,
): Promise<ToolExecutionResult | null> {
  if (!backend.searchTextFiles) {
    return null;
  }

  try {
    context.reportProgress?.({
      content: `Running native workspace text search for "${options.query}".`,
      data: {
        maxMatches: effectiveMaxMatches(options),
        query: options.query,
        regex: options.regex,
        source: "native-text-scan",
      } as unknown as JsonValue,
      ok: true,
    });
    const native = await backend.searchTextFiles({
      caseSensitive: options.caseSensitive,
      contextLines: options.contextLines,
      excludeDirectories: Array.from(options.excludeDirectories),
      extensions: options.extensions ? Array.from(options.extensions) : undefined,
      globs: options.globs,
      includeContent: options.includeContent,
      includeGenerated: options.includeGenerated,
      includePath: options.includePath,
      maxMatches: effectiveMaxMatches(options),
      maxMatchesPerFile: effectiveMaxMatchesPerFile(options),
      path: rootPath,
      query: options.query,
      regex: options.regex,
    });

    if (context.signal?.aborted) {
      return { content: "Tool bridge run aborted before files_search finished native scanning.", ok: false };
    }

    const results = sortResults(native.matches, options.query);

    return {
      content: formatSearchContent(options, results, {
        filteredByGlob: native.filteredByGlob,
        filesRead: native.filesRead,
        filesScanned: native.filesScanned,
        inaccessibleEntries: native.inaccessibleEntries,
        limited: native.limited,
        scannedDirectories: native.scannedDirectories,
        skippedLargeFiles: native.skippedLargeFiles ?? 0,
        skippedDirectories: native.skippedDirectories,
        skippedFiles: native.skippedFiles,
        source: "scan",
        totalContentMatches: native.totalContentMatches,
        unreadableFiles: native.unreadableFiles,
      }),
      data: {
        filesRead: native.filesRead,
        filesScanned: native.filesScanned,
        filteredByGlob: native.filteredByGlob,
        inaccessibleEntries: native.inaccessibleEntries,
        limited: native.limited,
        matches: results,
        query: options.query,
        scannedDirectories: native.scannedDirectories,
        searchMode: "scan",
        skippedLargeFiles: native.skippedLargeFiles ?? 0,
        skippedDirectories: native.skippedDirectories,
        skippedFiles: native.skippedFiles,
        source: "native-text-scan",
        totalContentMatches: native.totalContentMatches,
        unreadableFiles: native.unreadableFiles,
      } as unknown as JsonValue,
      ok: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (isNativeTextSearchUnavailable(message) || isNativeRegexUnsupported(message)) {
      return null;
    }

    return {
      content: `Native files_search scan failed before the app could safely finish: ${message}`,
      error: message,
      ok: false,
    };
  }
}

function getIndexedSearchIncompatibility(options: SearchOptions) {
  const reasons: string[] = [];

  if (options.regex) {
    reasons.push("regex");
  }

  if (options.caseSensitive) {
    reasons.push("caseSensitive");
  }

  if (options.contextLines > 0) {
    reasons.push("contextLines");
  }

  if (options.excludeDirectories.size > 0) {
    reasons.push("excludeDirectories");
  }

  if (options.extensions) {
    reasons.push("extensions");
  }

  if (options.globs.length > 0) {
    reasons.push("glob/globs");
  }

  if (options.includeGenerated) {
    reasons.push("includeGenerated");
  }

  if (options.maxMatchesPerFile !== undefined) {
    reasons.push("maxMatchesPerFile");
  }

  return reasons.length > 0 ? reasons.join(", ") : undefined;
}

function indexedResultsToFileSearchResults(
  indexedMatches: ComputerSearchResult[],
  options: SearchOptions,
  matcher: { test: (value: string) => boolean },
): FileSearchResult[] {
  return indexedMatches.flatMap((result) => {
    if (result.kind !== "file") {
      return [];
    }

    const matchKind = result.matchKind;
    const pathMatched = options.includePath && (
      matchKind === "name" ||
      matchKind === "path" ||
      matcher.test(result.name) ||
      matcher.test(result.path)
    );
    const contentMatched = options.includeContent && (
      matchKind === "content" ||
      matchKind === "memory" ||
      matchKind === "semantic" ||
      (typeof result.preview === "string" && matcher.test(result.preview))
    );

    if (!pathMatched && !contentMatched) {
      return [];
    }

    return [{
      contentMatches: contentMatched && result.line && result.preview
        ? [{
            line: result.line,
            preview: result.preview.trim(),
          }]
        : [],
      extension: result.extension ?? extensionFromPath(result.path),
      name: result.name || fileNameFromPath(result.path),
      path: result.path,
      pathMatched,
      size: result.size ?? null,
    }];
  });
}

function findContentMatches(
  content: string,
  matcher: { test: (value: string) => boolean },
  maxMatchesPerFile: number | undefined,
  contextLines: number,
): FileSearchMatch[] {
  const matches: FileSearchMatch[] = [];
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    if (maxMatchesPerFile !== undefined && matches.length >= maxMatchesPerFile) {
      break;
    }

    const line = lines[index]!;
    if (matcher.test(line)) {
      const beforeStart = Math.max(0, index - contextLines);
      const afterEnd = Math.min(lines.length - 1, index + contextLines);
      matches.push({
        after: contextLines > 0
          ? lines.slice(index + 1, afterEnd + 1).map((preview, offset) => ({
              line: index + offset + 2,
              preview: preview.trim(),
            }))
          : undefined,
        before: contextLines > 0
          ? lines.slice(beforeStart, index).map((preview, offset) => ({
              line: beforeStart + offset + 1,
              preview: preview.trim(),
            }))
          : undefined,
        line: index + 1,
        preview: line.trim(),
      });
    }
  }

  return matches;
}

function sortResults(results: FileSearchResult[], query: string) {
  const lowerQuery = query.toLowerCase();
  return [...results].sort((left, right) => {
    const leftScore = scoreSearchResult(left, lowerQuery);
    const rightScore = scoreSearchResult(right, lowerQuery);

    if (leftScore !== rightScore) {
      return rightScore - leftScore;
    }

    return left.path.localeCompare(right.path);
  });
}

function scoreSearchResult(result: FileSearchResult, lowerQuery: string) {
  const lowerName = result.name.toLowerCase();
  const lowerPath = result.path.toLowerCase();
  let score = 0;

  if (lowerName === lowerQuery) {
    score += 1000;
  } else if (lowerName.includes(lowerQuery)) {
    score += 500;
  }

  if (result.pathMatched) {
    score += 120;
  }

  if (lowerPath.includes(`/src/`) || lowerPath.includes(`\\src\\`)) {
    score += 80;
  }

  score += Math.min(result.contentMatches.length, 20) * 20;
  score -= Math.min(lowerPath.split(/[\\/]+/).length, 30);
  return score;
}

function formatSearchContent(
  options: SearchOptions,
  results: FileSearchResult[],
  stats: {
    filteredByGlob: number;
    filesRead: number;
    filesScanned: number;
    inaccessibleEntries: number;
    indexedMatches?: number;
    limited: boolean;
    scannedDirectories: number;
    skippedLargeFiles: number;
    skippedDirectories: number;
    skippedFiles: number;
    source?: "index" | "scan";
    totalContentMatches: number;
    unreadableFiles: number;
  },
) {
  const lines = [
    `Found ${formatNumber(results.length)} matching file${results.length === 1 ? "" : "s"} for "${options.query}".`,
    stats.source === "index"
      ? `Searched semantic file index; returned ${formatNumber(stats.indexedMatches ?? stats.filesScanned)} indexed file result${(stats.indexedMatches ?? stats.filesScanned) === 1 ? "" : "s"}; read 0 text files.`
      : `Scanned ${formatNumber(stats.filesScanned)} file${stats.filesScanned === 1 ? "" : "s"} across ${formatNumber(stats.scannedDirectories)} director${stats.scannedDirectories === 1 ? "y" : "ies"}; read ${formatNumber(stats.filesRead)} text file${stats.filesRead === 1 ? "" : "s"}.`,
    stats.filteredByGlob > 0 ? `Filtered ${formatNumber(stats.filteredByGlob)} file${stats.filteredByGlob === 1 ? "" : "s"} by glob.` : "",
    stats.totalContentMatches > 0 ? `Content matches: ${formatNumber(stats.totalContentMatches)} line${stats.totalContentMatches === 1 ? "" : "s"}.` : "",
    stats.skippedDirectories > 0 ? `Skipped ${formatNumber(stats.skippedDirectories)} generated/cache director${stats.skippedDirectories === 1 ? "y" : "ies"}.` : "",
    stats.skippedLargeFiles > 0 ? `Skipped ${formatNumber(stats.skippedLargeFiles)} oversized text file${stats.skippedLargeFiles === 1 ? "" : "s"}.` : "",
    stats.skippedFiles > 0 ? `Skipped ${formatNumber(stats.skippedFiles)} non-file or extension-filtered item${stats.skippedFiles === 1 ? "" : "s"}.` : "",
    stats.unreadableFiles > 0 || stats.inaccessibleEntries > 0 ? `${formatNumber(stats.unreadableFiles + stats.inaccessibleEntries)} item${stats.unreadableFiles + stats.inaccessibleEntries === 1 ? "" : "s"} could not be read.` : "",
    stats.limited ? "Search results were limited; narrow the query or raise maxMatches/maxMatchesPerFile if more evidence is needed." : "",
    "",
    ...results.flatMap(formatSearchResultLines),
  ].filter((line, index, array) => line || array[index - 1]);

  return lines.join("\n");
}

function formatSearchResultLines(result: FileSearchResult) {
  // Wrap paths in backticks so markdown preserves Windows backslashes.
  const header = `\`${result.path}\`${result.pathMatched ? " (path match)" : ""}`;
  const matchLines = result.contentMatches.flatMap((match) => [
    ...(match.before ?? []).map((line) => `  L${line.line}: ${line.preview}`),
    `  L${match.line}: ${match.preview}`,
    ...(match.after ?? []).map((line) => `  L${line.line}: ${line.preview}`),
  ]);
  return matchLines.length > 0 ? [header, ...matchLines] : [header];
}

function isMatchLimitReached(currentMatches: number, maxMatches: number | undefined) {
  return maxMatches !== undefined && currentMatches >= maxMatches;
}

function effectiveMaxMatches(options: SearchOptions) {
  return options.maxMatches ?? DEFAULT_MAX_MATCHING_FILES;
}

function effectiveMaxMatchesPerFile(options: SearchOptions) {
  return options.maxMatchesPerFile ?? DEFAULT_MAX_MATCHES_PER_FILE;
}

function optionalPositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const truncated = Math.floor(value);
  return truncated > 0 ? truncated : undefined;
}

function boundedPositiveInteger(value: unknown, max: number): number | undefined {
  const positive = optionalPositiveInteger(value);
  return positive === undefined ? undefined : Math.min(positive, max);
}

function optionalNonNegativeInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const truncated = Math.floor(value);
  return truncated >= 0 ? truncated : undefined;
}

function matchesGlobs(file: TraversedFile, globs: string[]) {
  if (globs.length === 0) {
    return true;
  }

  const normalizedPath = file.path.replace(/\\/g, "/");
  return globs.some((glob) => {
    const expression = globToRegExp(glob);
    return expression.test(normalizedPath) || expression.test(file.name);
  });
}

function globToRegExp(glob: string) {
  const normalized = glob.replace(/\\/g, "/").replace(/^\.?\//, "");
  let pattern = "";

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index]!;
    const next = normalized[index + 1];

    if (char === "*" && next === "*") {
      const afterGlobstar = normalized[index + 2];
      if (afterGlobstar === "/") {
        pattern += "(?:.*/)?";
        index += 2;
      } else {
        pattern += ".*";
        index += 1;
      }
    } else if (char === "*") {
      pattern += "[^/]*";
    } else if (char === "?") {
      pattern += "[^/]";
    } else {
      pattern += escapeRegExp(char);
    }
  }

  return new RegExp(`(?:^|.*/)${pattern}$`, "i");
}

function escapeRegExp(value: string) {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function extensionFromPath(path: string) {
  const name = fileNameFromPath(path);
  const index = name.lastIndexOf(".");
  return index >= 0 && index < name.length - 1 ? name.slice(index + 1).toLowerCase() : null;
}

function fileNameFromPath(path: string) {
  return path.split(/[\\/]+/).filter(Boolean).pop() ?? path;
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

function isNativeTextSearchUnavailable(message: string) {
  return /native text search is available in the desktop app|open or drop a folder/i.test(message);
}

function isNativeRegexUnsupported(message: string) {
  return /regex parse error|unsupported regex|look-around|lookbehind|backreference/i.test(message);
}
