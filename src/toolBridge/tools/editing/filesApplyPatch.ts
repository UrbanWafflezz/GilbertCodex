import type { ToolDefinition, ToolExecutionResult } from "../../types";
import { tryResolveAllowedPath } from "../../paths";
import { defaultEditingBackend, type EditingBackend } from "./backend";
import {
  booleanArg,
  createErrorResult,
  optionalStringArg,
  writePreparedText,
  type PreparedTextWrite,
} from "./editUtils";

interface PatchFile {
  hunks: PatchHunk[];
  newPath: string;
  oldPath: string;
}

interface PatchHunk {
  lines: Array<{ kind: "add" | "context" | "remove"; text: string }>;
  newCount: number;
  newStart: number;
  oldCount: number;
  oldStart: number;
}

export function createFilesApplyPatchTool(backend: EditingBackend = defaultEditingBackend): ToolDefinition {
  return {
    description:
      "Apply a unified diff patch to one or more text files inside the workspace. " +
      "Hunks are verified against current file content before writing. Supports dryRun for approval previews.",
    execute: async (args, context) => {
      const patch = typeof args.patch === "string" ? args.patch : "";
      const dryRun = booleanArg(args.dryRun);
      const expectedSha256 = optionalStringArg(args.expectedSha256);

      if (!patch.trim()) {
        return createErrorResult("files_apply_patch requires a non-empty unified diff patch.");
      }

      const parsed = parseUnifiedPatch(patch);

      if (!("files" in parsed)) {
        return parsed;
      }

      const preparedWrites: PreparedTextWrite[] = [];

      for (const filePatch of parsed.files) {
        if (filePatch.newPath === "/dev/null") {
          return createErrorResult("files_apply_patch does not delete files. Use a dedicated delete tool when destructive edits are available.");
        }

        const pathForResolution = filePatch.newPath || filePatch.oldPath;
        const resolution = tryResolveAllowedPath(context, pathForResolution);

        if (!resolution.ok) {
          return {
            content: resolution.error.message,
            error: resolution.error.message,
            ok: false,
          };
        }

        const existing = await readPatchTarget(backend, resolution.path.resolved, filePatch.oldPath === "/dev/null");

        if (!existing.ok) {
          return existing;
        }

        if (expectedSha256 && existing.sha256 && expectedSha256.toLowerCase() !== existing.sha256.toLowerCase()) {
          return createErrorResult(`Refusing to patch because ${existing.path} changed since it was last read. Re-read the current file section, then retry with a patch anchored to current text.`);
        }

        const applied = applyHunks(existing.content, filePatch.hunks, existing.path);

        if (!applied.ok) {
          return applied;
        }

        preparedWrites.push({
          after: applied.content,
          before: existing.content,
          created: existing.created,
          expectedSha256: existing.sha256,
          path: existing.path,
        });
      }

      const results: ToolExecutionResult[] = [];

      for (const prepared of preparedWrites) {
        const result = await writePreparedText(backend, context, prepared, {
          dryRun,
          kind: prepared.created ? "create" : "update",
          overwrite: true,
          summary: `${dryRun ? "Previewed" : "Applied"} patch for \`${prepared.path}\`.`,
        });

        if (!result.ok) {
          return result;
        }

        results.push(result);
      }

      const fileChanges = results.flatMap((result) => {
        const data = result.data as { fileChanges?: unknown } | undefined;
        return Array.isArray(data?.fileChanges) ? data.fileChanges : [];
      });

      return {
        content: [
          `${dryRun ? "Dry run: patch can be applied" : "Patch applied"} to ${preparedWrites.length} file${preparedWrites.length === 1 ? "" : "s"}.`,
          ...results.map((result) => result.content),
        ].join("\n\n"),
        data: {
          dryRun,
          fileChanges,
          files: preparedWrites.map((write) => write.path),
        } as never,
        ok: true,
      };
    },
    executorMetadata: { family: "editing", version: 1 },
    id: "files_apply_patch",
    inputSchema: {
      additionalProperties: false,
      properties: {
        dryRun: {
          description: "Preview the patch and diff metadata without writing. Defaults to false.",
          type: "boolean",
        },
        expectedSha256: {
          description: "Optional SHA-256 for single-file patches. Refuses the patch if that file changed.",
          minLength: 1,
          type: "string",
        },
        patch: {
          description: "Unified diff text.",
          minLength: 1,
          type: "string",
        },
      },
      required: ["patch"],
      type: "object",
    },
    permission: "mutating",
    risk: "mutating",
    title: "Apply workspace patch",
  };
}

function parseUnifiedPatch(patch: string): { files: PatchFile[]; ok: true } | ToolExecutionResult {
  if (/^\s*\*\*\* Begin Patch/m.test(patch)) {
    return createErrorResult(
      "files_apply_patch expects unified diff text with ---, +++, and @@ hunk headers. " +
      "Codex-style *** Begin Patch syntax is not supported by this app tool; retry with files_edit_many, files_write_many, or a unified diff.",
    );
  }

  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  const files: PatchFile[] = [];
  let current: PatchFile | null = null;
  let currentHunk: PatchHunk | null = null;

  for (const rawLine of lines) {
    if (rawLine.startsWith("--- ")) {
      current = {
        hunks: [],
        newPath: "",
        oldPath: normalizePatchPath(rawLine.slice(4).trim()),
      };
      currentHunk = null;
      continue;
    }

    if (rawLine.startsWith("+++ ")) {
      if (!current) {
        return createErrorResult("Patch has a +++ file header without a matching --- header.");
      }
      current.newPath = normalizePatchPath(rawLine.slice(4).trim());
      files.push(current);
      continue;
    }

    if (rawLine.startsWith("@@ ")) {
      if (!current) {
        return createErrorResult("Patch has a hunk before a file header.");
      }
      const hunk = parseHunkHeader(rawLine);
      if (!hunk) {
        return createErrorResult(`Invalid patch hunk header: ${rawLine}`);
      }
      current.hunks.push(hunk);
      currentHunk = hunk;
      continue;
    }

    if (!currentHunk || rawLine.startsWith("diff --git ") || rawLine.startsWith("index ")) {
      continue;
    }

    if (rawLine.startsWith("\\ No newline at end of file")) {
      continue;
    }

    const marker = rawLine.slice(0, 1);
    const text = rawLine.slice(1);

    if (marker === " ") {
      currentHunk.lines.push({ kind: "context", text });
    } else if (marker === "-") {
      currentHunk.lines.push({ kind: "remove", text });
    } else if (marker === "+") {
      currentHunk.lines.push({ kind: "add", text });
    } else if (rawLine === "") {
      continue;
    } else {
      return createErrorResult(`Invalid patch line: ${rawLine}`);
    }
  }

  const usableFiles = files.filter((file) => file.newPath && file.hunks.length > 0);

  if (usableFiles.length === 0) {
    return createErrorResult("No file hunks were found in the patch.");
  }

  return { files: usableFiles, ok: true };
}

function parseHunkHeader(line: string): PatchHunk | null {
  const match = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/.exec(line);

  if (!match) {
    return null;
  }

  return {
    lines: [],
    newCount: match[4] ? Number.parseInt(match[4], 10) : 1,
    newStart: Number.parseInt(match[3], 10),
    oldCount: match[2] ? Number.parseInt(match[2], 10) : 1,
    oldStart: Number.parseInt(match[1], 10),
  };
}

async function readPatchTarget(backend: EditingBackend, path: string, created: boolean) {
  if (created) {
    return {
      content: "",
      created: true,
      ok: true as const,
      path,
      sha256: undefined,
    };
  }

  try {
    const file = await backend.readTextFile(path);
    return {
      content: file.content,
      created: false,
      ok: true as const,
      path: file.path,
      sha256: file.sha256,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read patch target.";
    return {
      content: message,
      error: message,
      ok: false as const,
    };
  }
}

function applyHunks(content: string, hunks: PatchHunk[], path: string): { content: string; ok: true } | ToolExecutionResult {
  const hadTrailingNewline = content.endsWith("\n") || content.endsWith("\r\n");
  const lines = splitPatchLines(content);
  let offset = 0;

  for (const hunk of hunks) {
    let cursor = Math.max(hunk.oldStart - 1 + offset, 0);

    for (const line of hunk.lines) {
      if (line.kind === "add") {
        lines.splice(cursor, 0, line.text);
        cursor += 1;
        offset += 1;
        continue;
      }

      const current = lines[cursor];

      if (current !== line.text) {
        return createErrorResult(`Patch does not apply to ${path} near original line ${cursor + 1}. Re-read the file and regenerate the patch.`);
      }

      if (line.kind === "remove") {
        lines.splice(cursor, 1);
        offset -= 1;
      } else {
        cursor += 1;
      }
    }
  }

  return {
    content: `${lines.join("\n")}${hadTrailingNewline ? "\n" : ""}`,
    ok: true,
  };
}

function splitPatchLines(content: string) {
  if (!content) {
    return [];
  }
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  return content.endsWith("\n") || content.endsWith("\r\n") ? lines.slice(0, -1) : lines;
}

function normalizePatchPath(path: string) {
  const cleanPath = path.split(/\t/)[0].trim();

  if (cleanPath === "/dev/null") {
    return cleanPath;
  }

  return cleanPath.replace(/^(?:a|b)\//, "");
}
