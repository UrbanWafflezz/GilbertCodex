import type { ToolExecutionContext } from "./types";

// Browser File System Access fallback prefix. Keep in sync with localWorkspace/files.ts.
const BROWSER_WORKSPACE_PREFIX = "browser-folder://";

export type PathResolutionErrorKind =
  | "external-path"
  | "invalid"
  | "no-workspace";

// Thrown when a requested path cannot resolve safely inside the workspace roots in scope.
export class PathResolutionError extends Error {
  readonly kind: PathResolutionErrorKind;

  constructor(kind: PathResolutionErrorKind, message: string) {
    super(message);
    this.name = "PathResolutionError";
    this.kind = kind;
  }
}

export interface ResolvedPath {
  // Normalized, case-folded form used for membership comparison.
  comparable: string;
  // The path to hand back to filesystem APIs. Original separator family preserved.
  resolved: string;
  // The workspace root that contains `resolved`.
  root: string;
}

// Resolves a model path against workspace roots and rejects paths outside those roots before tool execution.
export function resolveAllowedPath(
  context: Pick<ToolExecutionContext, "workspaceRoots">,
  requestedPath: unknown,
): ResolvedPath {
  if (typeof requestedPath !== "string" || !requestedPath.trim()) {
    throw new PathResolutionError("invalid", "A non-empty path is required.");
  }

  const roots = (context.workspaceRoots ?? []).filter((root) => typeof root === "string" && root.trim());
  if (roots.length === 0) {
    throw new PathResolutionError(
      "no-workspace",
      "No workspace roots are configured for the tool bridge; open or drop a folder first.",
    );
  }

  const trimmed = requestedPath.trim();
  const isAbsolute = isAbsoluteLikePath(trimmed);
  const baseRoot = roots[0]!;
  const absolutePath = isAbsolute ? trimmed : joinPath(baseRoot, trimmed);
  const normalized = normalizePathSegments(absolutePath);
  const comparable = toComparable(normalized);

  for (const root of roots) {
    const comparableRoot = toComparable(root);
    if (!comparableRoot) {
      continue;
    }
    if (comparable === comparableRoot || comparable.startsWith(`${comparableRoot}/`)) {
      return {
        comparable,
        resolved: normalized,
        root,
      };
    }
  }

  throw new PathResolutionError(
    "external-path",
    `Path "${requestedPath}" resolves outside the configured workspace roots.`,
  );
}

// Non-throwing resolver for tools that convert path failures into ToolExecutionResult values.
export function tryResolveAllowedPath(
  context: Pick<ToolExecutionContext, "workspaceRoots">,
  requestedPath: unknown,
):
  | { ok: true; path: ResolvedPath }
  | { error: PathResolutionError; ok: false } {
  try {
    return { ok: true, path: resolveAllowedPath(context, requestedPath) };
  } catch (error) {
    if (error instanceof PathResolutionError) {
      return { error, ok: false };
    }
    throw error;
  }
}

function isAbsoluteLikePath(path: string): boolean {
  if (path.startsWith(BROWSER_WORKSPACE_PREFIX)) {
    return true;
  }
  if (path.startsWith("/")) {
    return true;
  }
  // UNC path: \\server\share\...
  if (path.startsWith("\\\\")) {
    return true;
  }
  // Windows drive letter followed by a separator.
  if (/^[a-zA-Z]:[\\/]/.test(path)) {
    return true;
  }
  return false;
}

function joinPath(base: string, child: string): string {
  const separator = base.includes("\\") ? "\\" : "/";
  const trimmedBase = base.replace(/[\\/]+$/, "");
  const trimmedChild = child.replace(/^[\\/]+/, "");
  return `${trimmedBase}${separator}${trimmedChild}`;
}

function normalizePathSegments(input: string): string {
  if (input.startsWith(BROWSER_WORKSPACE_PREFIX)) {
    const body = input.slice(BROWSER_WORKSPACE_PREFIX.length).replace(/\\/g, "/");
    const collapsed = collapseSegments(body, "/");
    return `${BROWSER_WORKSPACE_PREFIX}${collapsed}`;
  }

  const usesBackslash = input.includes("\\") && !input.includes("/");
  const separator = usesBackslash || /^[a-zA-Z]:/.test(input) || input.startsWith("\\\\") ? "\\" : "/";

  let prefix = "";
  let body = input;

  if (input.startsWith("\\\\")) {
    // UNC: \\server\share\path; keep the leading "\\server\share" intact.
    const rest = input.slice(2);
    const firstSlash = rest.search(/[\\/]/);
    const secondSlash = firstSlash >= 0 ? rest.slice(firstSlash + 1).search(/[\\/]/) : -1;
    if (firstSlash >= 0 && secondSlash >= 0) {
      const cut = firstSlash + 1 + secondSlash;
      prefix = `\\\\${rest.slice(0, cut)}`;
      body = rest.slice(cut);
    } else {
      prefix = input;
      body = "";
    }
  } else if (/^[a-zA-Z]:/.test(input)) {
    prefix = input.slice(0, 2);
    body = input.slice(2);
  } else if (input.startsWith("/")) {
    prefix = "/";
    body = input.slice(1);
  }

  const collapsed = collapseSegments(body, separator);
  if (prefix && collapsed) {
    const joiner = prefix.endsWith(separator) || prefix.endsWith("\\") || prefix.endsWith("/") ? "" : separator;
    return `${prefix}${joiner}${collapsed}`;
  }
  return prefix || collapsed;
}

function collapseSegments(body: string, separator: string): string {
  const segments = body.split(/[\\/]+/).filter(Boolean);
  const stack: string[] = [];
  for (const segment of segments) {
    if (segment === ".") {
      continue;
    }
    if (segment === "..") {
      // Going above the prefix is a no-op; workspace membership still rejects escaped paths.
      if (stack.length > 0) {
        stack.pop();
      }
      continue;
    }
    stack.push(segment);
  }
  return stack.join(separator);
}

function toComparable(path: string): string {
  const trimmed = path.trim();
  // Browser folder URLs are case-sensitive, so normalize separators without case-folding.
  if (trimmed.startsWith(BROWSER_WORKSPACE_PREFIX)) {
    return trimmed.replace(/\\/g, "/").replace(/\/+$/, "");
  }
  return trimmed.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}
