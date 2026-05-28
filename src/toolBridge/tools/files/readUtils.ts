import type { ComputerDirectoryEntry, ComputerReadFileResult } from "../../../types/localWorkspace";
import type { FilesBackend } from "./backend";

const MODULE_ENTRY_NAMES = [
  "index.tsx",
  "index.jsx",
  "index.ts",
  "index.js",
  "index.mjs",
  "index.cjs",
  "mod.rs",
  "main.ts",
  "main.tsx",
  "main.js",
];
const MODULE_ENTRY_STEMS = new Set(["index", "main", "mod"]);
const DEFAULT_MODULE_EXTENSIONS = ["tsx", "jsx", "ts", "js", "mjs", "cjs", "rs"];

export interface RecoveredReadResult {
  file: ComputerReadFileResult;
  recoveredFrom?: string;
  recoveryNote?: string;
}

export async function readTextFileWithModuleRecovery(
  backend: FilesBackend,
  path: string,
  maxBytes?: number,
  offset?: number,
): Promise<RecoveredReadResult> {
  try {
    return {
      file: await backend.readTextFile(path, maxBytes, offset),
    };
  } catch (error) {
    const readError = readErrorMessage(error, "Could not read file.");
    const recovery = await tryRecoverModuleEntryRead(backend, path, maxBytes, offset, readError);

    if (recovery) {
      return recovery;
    }

    throw new Error(await createHelpfulReadError(backend, path, readError));
  }
}

export function formatRecoveredContent(read: RecoveredReadResult) {
  if (!read.recoveredFrom || !read.recoveryNote) {
    return read.file.content;
  }

  return [
    read.recoveryNote,
    "",
    read.file.content,
  ].join("\n");
}

export function readErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  try {
    const serialized = JSON.stringify(error);
    return serialized && serialized !== "{}" ? serialized : fallback;
  } catch {
    return fallback;
  }
}

async function tryRecoverModuleEntryRead(
  backend: FilesBackend,
  requestedPath: string,
  maxBytes: number | undefined,
  offset: number | undefined,
  readError: string,
): Promise<RecoveredReadResult | null> {
  const candidates = createModuleDirectoryCandidates(requestedPath);

  for (const candidateDirectory of candidates) {
    const listing = await tryListDirectory(backend, candidateDirectory);

    if (!listing) {
      continue;
    }

    const entry = pickModuleEntry(listing.entries, requestedPath);

    if (!entry) {
      continue;
    }

    try {
      const file = await backend.readTextFile(entry.path, maxBytes, offset);
      return {
        file,
        recoveredFrom: requestedPath,
        recoveryNote: `Requested \`${requestedPath}\` could not be read (${readError}). Recovered module entry \`${file.path}\`.`,
      };
    } catch {
      continue;
    }
  }

  return null;
}

async function createHelpfulReadError(backend: FilesBackend, requestedPath: string, readError: string) {
  const suggestions = await createReadSuggestions(backend, requestedPath);
  return [
    `Could not read \`${requestedPath}\`: ${readError}`,
    suggestions,
  ].filter(Boolean).join("\n");
}

async function createReadSuggestions(backend: FilesBackend, requestedPath: string) {
  const directListing = await tryListDirectory(backend, requestedPath);

  if (directListing) {
    const entries = directListing.entries.slice(0, 8).map((entry) => `\`${entry.path}\``);
    return entries.length > 0
      ? `That path is a directory. Try files_read on one of: ${entries.join(", ")}`
      : "That path is an empty directory.";
  }

  const { extension, parent, stem } = splitPath(requestedPath);

  if (!parent) {
    return "";
  }

  const parentListing = await tryListDirectory(backend, parent);

  if (!parentListing) {
    const ancestorMatches = await createAncestorNearbyMatches(backend, requestedPath);
    if (ancestorMatches.length > 0) {
      return `Nearby paths: ${ancestorMatches.join(", ")}`;
    }

    const indexedMatches = await createIndexedNearbyMatches(backend, requestedPath);
    if (indexedMatches.length > 0) {
      return `Nearby paths: ${indexedMatches.join(", ")}`;
    }

    return createSearchSuggestion(requestedPath);
  }

  const siblingDirectory = extension
    ? parentListing.entries.find((entry) => entry.kind === "directory" && entry.name.toLowerCase() === stem.toLowerCase())
    : undefined;

  if (siblingDirectory) {
    const childListing = await tryListDirectory(backend, siblingDirectory.path);
    const childEntries = childListing?.entries.slice(0, 8).map((entry) => `\`${entry.path}\``) ?? [];

    return childEntries.length > 0
      ? `A directory named \`${siblingDirectory.name}\` exists. Try files_read on one of: ${childEntries.join(", ")}`
      : `A directory named \`${siblingDirectory.name}\` exists, but no module entry file was found.`;
  }

  const nearMatches = parentListing.entries
    .filter((entry) => entry.name.toLowerCase().includes(stem.toLowerCase()) || stem.toLowerCase().includes(entry.name.toLowerCase()))
    .slice(0, 8)
    .map((entry) => `\`${entry.path}\``);

  if (nearMatches.length > 0) {
    return `Nearby paths: ${nearMatches.join(", ")}`;
  }

  const indexedMatches = await createIndexedNearbyMatches(backend, requestedPath);
  if (indexedMatches.length > 0) {
    return `Nearby paths: ${indexedMatches.join(", ")}`;
  }

  return createSearchSuggestion(requestedPath);
}

async function createAncestorNearbyMatches(backend: FilesBackend, requestedPath: string) {
  const { name, parent, stem } = splitPath(requestedPath);
  const parentParts = splitPath(parent);

  if (!parentParts.parent || !parentParts.name) {
    return [];
  }

  const listing = await tryListDirectory(backend, parentParts.parent);
  if (!listing) {
    return [];
  }

  const needles = [parentParts.name, stem, name]
    .map((value) => value.toLowerCase())
    .filter(Boolean);

  return listing.entries
    .filter((entry) => {
      const entryName = entry.name.toLowerCase();
      return needles.some((needle) => entryName.includes(needle) || needle.includes(entryName));
    })
    .slice(0, 8)
    .map((entry) => `\`${entry.path}\``);
}

async function createIndexedNearbyMatches(backend: FilesBackend, requestedPath: string) {
  if (!backend.searchIndexedFiles) {
    return [];
  }

  const query = createMissingPathSearchQuery(requestedPath);
  if (!query) {
    return [];
  }

  try {
    const matches = await backend.searchIndexedFiles(query, 8);
    return matches
      .map((match) => match.path)
      .filter((path): path is string => typeof path === "string" && path.trim().length > 0)
      .slice(0, 8)
      .map((path) => `\`${path}\``);
  } catch {
    return [];
  }
}

function createSearchSuggestion(requestedPath: string) {
  const { name, parent } = splitPath(requestedPath);
  const searchQuery = createMissingPathSearchQuery(requestedPath);
  const context = parent ? ` under \`${getLastPathSegment(parent) || parent}\`` : "";

  return searchQuery
    ? `No nearby path matched \`${name}\`${context}. Try files_search with query \`${searchQuery}\`, includePath=true, includeContent=false, and maxMatches=20 before answering.`
    : "";
}

function createMissingPathSearchQuery(requestedPath: string) {
  const { name, parent, stem } = splitPath(requestedPath);
  const parentName = getLastPathSegment(parent);
  const normalizedStem = stem.toLowerCase();

  if (parentName && (MODULE_ENTRY_STEMS.has(normalizedStem) || /^index\.[a-z0-9]+$/i.test(name))) {
    return parentName;
  }

  return stem || name;
}

function createModuleDirectoryCandidates(requestedPath: string) {
  const { extension, name, parent, stem } = splitPath(requestedPath);
  const candidates = [requestedPath];

  if (extension && parent) {
    candidates.push(joinPath(parent, stem));
  }

  if (isModuleEntryName(name) && parent) {
    candidates.push(parent);
  }

  return uniqueStrings(candidates);
}

function pickModuleEntry(entries: ComputerDirectoryEntry[], requestedPath: string) {
  const preferredNames = createPreferredModuleEntryNames(requestedPath);
  const fileEntries = entries.filter((entry) => entry.kind === "file");

  for (const name of preferredNames) {
    const entry = fileEntries.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());

    if (entry) {
      return entry;
    }
  }

  return undefined;
}

function createPreferredModuleEntryNames(requestedPath: string) {
  const { extension, parent, stem } = splitPath(requestedPath);
  const containingDirectoryName = getLastPathSegment(parent);
  const moduleStems = reorderByPreference(["index", "main", "mod"], MODULE_ENTRY_STEMS.has(stem.toLowerCase()) ? stem : "index");
  const extensions = orderModuleExtensions(extension);
  const names: string[] = [];

  for (const moduleStem of moduleStems) {
    for (const entryExtension of extensions) {
      names.push(`${moduleStem}.${entryExtension}`);
    }
  }

  if (containingDirectoryName) {
    for (const entryExtension of extensions) {
      names.push(`${containingDirectoryName}.${entryExtension}`);
    }
  }

  return uniqueStrings([...names, ...MODULE_ENTRY_NAMES]);
}

async function tryListDirectory(backend: FilesBackend, path: string) {
  try {
    return await backend.listDirectory(path);
  } catch {
    return null;
  }
}

function splitPath(path: string) {
  const separatorIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const parent = separatorIndex >= 0 ? path.slice(0, separatorIndex) : "";
  const name = separatorIndex >= 0 ? path.slice(separatorIndex + 1) : path;
  const dotIndex = name.lastIndexOf(".");
  const hasExtension = dotIndex > 0 && dotIndex < name.length - 1;

  return {
    extension: hasExtension ? name.slice(dotIndex + 1) : "",
    name,
    parent,
    stem: hasExtension ? name.slice(0, dotIndex) : name,
  };
}

function joinPath(parent: string, child: string) {
  const separator = parent.includes("\\") && !parent.includes("/") ? "\\" : "/";
  return `${parent.replace(/[\\/]+$/, "")}${separator}${child.replace(/^[\\/]+/, "")}`;
}

function getLastPathSegment(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? "";
}

function isModuleEntryName(name: string) {
  const { stem } = splitPath(name);
  return MODULE_ENTRY_STEMS.has(stem.toLowerCase());
}

function orderModuleExtensions(requestedExtension: string) {
  const requested = requestedExtension.toLowerCase();
  if (!requested) {
    return DEFAULT_MODULE_EXTENSIONS;
  }

  const familyFallbacks: Record<string, string[]> = {
    js: ["jsx", "tsx", "ts"],
    jsx: ["tsx", "js", "ts"],
    ts: ["tsx", "js", "jsx"],
    tsx: ["jsx", "ts", "js"],
  };

  return uniqueStrings([
    requested,
    ...(familyFallbacks[requested] ?? []),
    ...DEFAULT_MODULE_EXTENSIONS,
  ]);
}

function reorderByPreference(values: string[], preferred: string) {
  const normalizedPreferred = preferred.toLowerCase();
  return uniqueStrings([
    ...values.filter((value) => value.toLowerCase() === normalizedPreferred),
    ...values.filter((value) => value.toLowerCase() !== normalizedPreferred),
  ]);
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = value.toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(value);
  }

  return result;
}
