import type { ChatToolFileChange } from "../../../types/chat";
import type { JsonValue, ToolDefinition, ToolExecutionResult } from "../../types";
import { tryResolveAllowedPath } from "../../paths";
import { defaultEditingBackend, type EditingBackend } from "./backend";
import { booleanArg, createErrorResult } from "./editUtils";

export function createFilesCreateDirectoryTool(backend: EditingBackend = defaultEditingBackend): ToolDefinition {
  return {
    description:
      "Create a folder inside the configured workspace roots. Use this for mkdir/folder creation instead of terminal commands. " +
      "Defaults to recursive parent creation and supports dryRun for approval previews.",
    execute: async (args, context) => {
      const resolution = tryResolveAllowedPath(context, args.path);
      const dryRun = booleanArg(args.dryRun);
      const recursive = args.recursive !== false;

      if (!resolution.ok) {
        return {
          content: resolution.error.message,
          error: resolution.error.message,
          ok: false,
        };
      }

      const change = createDirectoryChange(resolution.path.resolved, dryRun);

      if (dryRun) {
        return createDirectoryResult({
          content: [
            `Dry run: would create folder \`${resolution.path.resolved}\`${recursive ? " with missing parents" : ""}.`,
            "No filesystem changes were made.",
          ].join("\n"),
          created: false,
          dryRun,
          fileChanges: [change],
          path: resolution.path.resolved,
          recursive,
        });
      }

      if (!backend.createDirectory) {
        return createErrorResult("This editing backend does not support folder creation.");
      }

      try {
        const result = await backend.createDirectory(
          resolution.path.resolved,
          context.workspaceRoots ?? [],
          { recursive },
        );

        return createDirectoryResult({
          content: result.created
            ? `Created folder \`${result.path}\`.`
            : `Folder already exists: \`${result.path}\`.`,
          created: result.created,
          directoryResult: result as unknown as JsonValue,
          dryRun,
          fileChanges: [createDirectoryChange(result.path, false)],
          path: result.path,
          recursive,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not create workspace folder.";
        return {
          content: message,
          error: message,
          ok: false,
        };
      }
    },
    executorMetadata: { family: "editing", version: 1 },
    id: "files_create_directory",
    inputSchema: {
      additionalProperties: false,
      properties: {
        dryRun: {
          description: "Preview folder creation metadata without changing the filesystem. Defaults to false.",
          type: "boolean",
        },
        path: {
          description: "Folder path to create, absolute or relative to the first workspace root.",
          minLength: 1,
          type: "string",
        },
        recursive: {
          description: "Create missing parent folders. Defaults to true.",
          type: "boolean",
        },
      },
      required: ["path"],
      type: "object",
    },
    permission: "mutating",
    risk: "mutating",
    title: "Create workspace folder",
  };
}

function createDirectoryChange(path: string, dryRun: boolean): ChatToolFileChange {
  return {
    additions: 0,
    deletions: 0,
    diffPreview: [
      { content: `${dryRun ? "would create directory" : "create directory"} ${path}`, kind: "meta" },
    ],
    kind: "create",
    path,
  };
}

function createDirectoryResult({
  content,
  created,
  directoryResult,
  dryRun,
  fileChanges,
  path,
  recursive,
}: {
  content: string;
  created: boolean;
  directoryResult?: JsonValue;
  dryRun: boolean;
  fileChanges: ChatToolFileChange[];
  path: string;
  recursive: boolean;
}): ToolExecutionResult {
  return {
    content,
    data: {
      created,
      directoryResult: directoryResult ?? null,
      dryRun,
      fileChanges,
      path,
      recursive,
    } as unknown as JsonValue,
    ok: true,
  };
}
