import type { ChatToolFileChange } from "../../../types/chat";
import type { JsonValue, ToolDefinition, ToolExecutionResult } from "../../types";
import { tryResolveAllowedPath } from "../../paths";
import { defaultEditingBackend, type EditingBackend } from "./backend";
import { booleanArg, createErrorResult } from "./editUtils";

export function createFilesMoveTool(backend: EditingBackend = defaultEditingBackend): ToolDefinition {
  return {
    description:
      "Move or rename a file or folder inside the configured workspace roots. " +
      "Use dryRun first for approval previews; both source and destination must stay inside the workspace.",
    execute: async (args, context) => {
      const dryRun = booleanArg(args.dryRun);
      const createParentDirs = args.createParentDirs !== false;
      const fromResolution = tryResolveAllowedPath(context, args.fromPath);
      const toResolution = tryResolveAllowedPath(context, args.toPath);

      if (!fromResolution.ok) {
        return resolutionError(fromResolution.error.message);
      }

      if (!toResolution.ok) {
        return resolutionError(toResolution.error.message);
      }

      if (fromResolution.path.comparable === toResolution.path.comparable) {
        return createErrorResult("files_move requires different fromPath and toPath values.");
      }

      const change = createMoveChange(fromResolution.path.resolved, toResolution.path.resolved);

      if (dryRun) {
        return createMoveResult({
          content: [
            `Dry run: would move \`${fromResolution.path.resolved}\` to \`${toResolution.path.resolved}\`.`,
            "No filesystem changes were made.",
          ].join("\n"),
          dryRun,
          fileChanges: [change],
          fromPath: fromResolution.path.resolved,
          toPath: toResolution.path.resolved,
        });
      }

      if (!backend.movePath) {
        return createErrorResult("This editing backend does not support move operations.");
      }

      try {
        const result = await backend.movePath(
          fromResolution.path.resolved,
          toResolution.path.resolved,
          context.workspaceRoots ?? [],
          { createParentDirs },
        );

        return createMoveResult({
          content: `Moved \`${result.fromPath}\` to \`${result.toPath}\`.`,
          dryRun,
          fileChanges: [createMoveChange(result.fromPath, result.toPath)],
          fromPath: result.fromPath,
          moveResult: result as unknown as JsonValue,
          toPath: result.toPath,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not move workspace path.";
        return {
          content: message,
          error: message,
          ok: false,
        };
      }
    },
    executorMetadata: { family: "editing", version: 1 },
    id: "files_move",
    inputSchema: {
      additionalProperties: false,
      properties: {
        createParentDirs: {
          description: "Create missing parent directories for the destination. Defaults to true.",
          type: "boolean",
        },
        dryRun: {
          description: "Preview the move metadata without changing the filesystem. Defaults to false.",
          type: "boolean",
        },
        fromPath: {
          description: "Source file or folder path, absolute or relative to the first workspace root.",
          minLength: 1,
          type: "string",
        },
        toPath: {
          description: "Destination file or folder path, absolute or relative to the first workspace root.",
          minLength: 1,
          type: "string",
        },
      },
      required: ["fromPath", "toPath"],
      type: "object",
    },
    permission: "mutating",
    risk: "mutating",
    title: "Move workspace path",
  };
}

function createMoveChange(fromPath: string, toPath: string): ChatToolFileChange {
  return {
    additions: 0,
    deletions: 0,
    diffPreview: [
      { content: `rename from ${fromPath}`, kind: "meta" },
      { content: `rename to ${toPath}`, kind: "meta" },
    ],
    kind: "move",
    path: `${fromPath} -> ${toPath}`,
  };
}

function createMoveResult({
  content,
  dryRun,
  fileChanges,
  fromPath,
  moveResult,
  toPath,
}: {
  content: string;
  dryRun: boolean;
  fileChanges: ChatToolFileChange[];
  fromPath: string;
  moveResult?: JsonValue;
  toPath: string;
}): ToolExecutionResult {
  return {
    content,
    data: {
      dryRun,
      fileChanges,
      fromPath,
      moveResult: moveResult ?? null,
      toPath,
    } as unknown as JsonValue,
    ok: true,
  };
}

function resolutionError(message: string): ToolExecutionResult {
  return {
    content: message,
    error: message,
    ok: false,
  };
}
