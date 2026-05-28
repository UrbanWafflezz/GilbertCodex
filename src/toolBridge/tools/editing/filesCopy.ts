import type { ChatToolFileChange } from "../../../types/chat";
import type { JsonValue, ToolDefinition, ToolExecutionResult } from "../../types";
import { tryResolveAllowedPath } from "../../paths";
import { defaultEditingBackend, type EditingBackend } from "./backend";
import { booleanArg, createErrorResult } from "./editUtils";

export function createFilesCopyTool(backend: EditingBackend = defaultEditingBackend): ToolDefinition {
  return {
    description:
      "Copy a file or folder inside the configured workspace roots, including binary assets such as images. " +
      "Use this when bringing assets from another local project into the current project. Both source and destination must stay inside the active workspace/full-computer roots.",
    execute: async (args, context) => {
      const dryRun = booleanArg(args.dryRun);
      const createParentDirs = args.createParentDirs !== false;
      const overwrite = booleanArg(args.overwrite);
      const fromResolution = tryResolveAllowedPath(context, args.fromPath);
      const toResolution = tryResolveAllowedPath(context, args.toPath);

      if (!fromResolution.ok) {
        return resolutionError(fromResolution.error.message);
      }

      if (!toResolution.ok) {
        return resolutionError(toResolution.error.message);
      }

      if (fromResolution.path.comparable === toResolution.path.comparable) {
        return createErrorResult("files_copy requires different fromPath and toPath values.");
      }

      const change = createCopyChange(fromResolution.path.resolved, toResolution.path.resolved);

      if (dryRun) {
        return createCopyResult({
          content: [
            `Dry run: would copy \`${fromResolution.path.resolved}\` to \`${toResolution.path.resolved}\`.`,
            overwrite ? "Existing destination paths would be overwritten." : "Existing destination paths would be preserved.",
            "No filesystem changes were made.",
          ].join("\n"),
          dryRun,
          fileChanges: [change],
          fromPath: fromResolution.path.resolved,
          toPath: toResolution.path.resolved,
        });
      }

      if (!backend.copyPath) {
        return createErrorResult("This editing backend does not support copy operations.");
      }

      try {
        const result = await backend.copyPath(
          fromResolution.path.resolved,
          toResolution.path.resolved,
          context.workspaceRoots ?? [],
          { createParentDirs, overwrite },
        );

        return createCopyResult({
          content: `Copied \`${result.fromPath}\` to \`${result.toPath}\`.`,
          copyResult: result as unknown as JsonValue,
          dryRun,
          fileChanges: [createCopyChange(result.fromPath, result.toPath)],
          fromPath: result.fromPath,
          toPath: result.toPath,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not copy workspace path.";
        return {
          content: message,
          error: message,
          ok: false,
        };
      }
    },
    executorMetadata: { family: "editing", version: 1 },
    id: "files_copy",
    inputSchema: {
      additionalProperties: false,
      properties: {
        createParentDirs: {
          description: "Create missing parent directories for the destination. Defaults to true.",
          type: "boolean",
        },
        dryRun: {
          description: "Preview the copy metadata without changing the filesystem. Defaults to false.",
          type: "boolean",
        },
        fromPath: {
          description: "Source file or folder path, absolute or relative to the first workspace root.",
          minLength: 1,
          type: "string",
        },
        overwrite: {
          description: "Overwrite the destination path if it already exists. Defaults to false.",
          type: "boolean",
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
    title: "Copy workspace path",
  };
}

function createCopyChange(fromPath: string, toPath: string): ChatToolFileChange {
  return {
    additions: 0,
    deletions: 0,
    diffPreview: [
      { content: `copy from ${fromPath}`, kind: "meta" },
      { content: `copy to ${toPath}`, kind: "meta" },
    ],
    kind: "create",
    path: toPath,
  };
}

function createCopyResult({
  content,
  copyResult,
  dryRun,
  fileChanges,
  fromPath,
  toPath,
}: {
  content: string;
  copyResult?: JsonValue;
  dryRun: boolean;
  fileChanges: ChatToolFileChange[];
  fromPath: string;
  toPath: string;
}): ToolExecutionResult {
  return {
    content,
    data: {
      copyResult: copyResult ?? null,
      dryRun,
      fileChanges,
      fromPath,
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
