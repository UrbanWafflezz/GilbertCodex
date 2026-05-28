import { describe, expect, it, vi } from "vitest";
import { executeToolBridgeCalls } from "../orchestrator";
import { ToolRegistry, createDefaultToolRegistry } from "../registry";
import {
  createEditingTools,
  createFilesAppendTool,
  createFilesApplyPatchTool,
  createFilesCopyTool,
  createFilesCreateDirectoryTool,
  createFilesEditManyTool,
  createFilesExactReplaceTool,
  createFilesInsertAtLineTool,
  createFilesMoveTool,
  createFilesReplaceRangeTool,
  createFilesReplaceSpanTool,
  createFilesWriteTool,
  createFilesWriteManyTool,
  type EditingBackend,
} from "../tools/editing";
import type { ToolExecutionContext } from "../types";
import type { ChatToolCall } from "../../types/chat";

const ROOT = "/workspace/project";

function makeContext(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    model: "test-model",
    permissionMode: "full-access",
    provider: "openai",
    workspaceRoots: [ROOT],
    ...overrides,
  };
}

function makeBackend(files: Record<string, { content: string; sha256?: string }> = {}): EditingBackend {
  const directories = new Set<string>();

  return {
    createDirectory: async (path) => {
      const created = !directories.has(path);
      directories.add(path);

      return {
        created,
        path,
      };
    },
    copyPath: async (fromPath, toPath) => {
      const file = files[fromPath];

      if (!file) {
        throw new Error("file not found");
      }

      files[toPath] = file;

      return {
        bytesCopied: file.content.length,
        copied: true,
        fromPath,
        kind: "file",
        toPath,
      };
    },
    movePath: async (fromPath, toPath) => {
      const file = files[fromPath];

      if (!file) {
        throw new Error("file not found");
      }

      delete files[fromPath];
      files[toPath] = file;

      return {
        fromPath,
        kind: "file",
        moved: true,
        toPath,
      };
    },
    readTextFile: async (path) => {
      const file = files[path];

      if (!file) {
        throw new Error("file not found");
      }

      return {
        content: file.content,
        name: path.split("/").pop() ?? "file",
        path,
        sha256: file.sha256 ?? `sha-${file.content.length}`,
        size: file.content.length,
        truncated: false,
      };
    },
    writeTextFile: async (path, content) => {
      files[path] = { content, sha256: `sha-${content.length}` };
      return {
        bytesWritten: content.length,
        created: false,
        path,
        sha256: `sha-${content.length}`,
      };
    },
  };
}

describe("editing bridge tools", () => {
  it("creates a workspace folder through a dedicated tool", async () => {
    const path = `${ROOT}/src/features/chat`;
    const backend = makeBackend();
    const tool = createFilesCreateDirectoryTool(backend);
    const result = await tool.execute({ path: "src/features/chat" }, makeContext());
    const data = result.data as { created: boolean; fileChanges: Array<{ kind: string; path: string }> };

    expect(result.ok).toBe(true);
    expect(result.content).toContain(`Created folder \`${path}\`.`);
    expect(data.created).toBe(true);
    expect(data.fileChanges[0]).toMatchObject({ kind: "create", path });
  });

  it("previews folder creation without mutating", async () => {
    const path = `${ROOT}/src/features/chat`;
    let createCalled = false;
    const backend = makeBackend();
    backend.createDirectory = async () => {
      createCalled = true;
      throw new Error("should not create on dryRun");
    };
    const tool = createFilesCreateDirectoryTool(backend);
    const result = await tool.execute({ dryRun: true, path: "src/features/chat" }, makeContext());

    expect(result.ok).toBe(true);
    expect(result.content).toContain(`would create folder \`${path}\``);
    expect(createCalled).toBe(false);
  });

  it("copies files for local asset reuse without requiring text reads", async () => {
    const fromPath = `${ROOT}/assets/logo.png`;
    const toPath = `${ROOT}/public/logo.png`;
    const backend = makeBackend({ [fromPath]: { content: "png-bytes" } });
    const tool = createFilesCopyTool(backend);
    const result = await tool.execute({ fromPath: "assets/logo.png", toPath: "public/logo.png" }, makeContext());
    const data = result.data as { fileChanges: Array<{ kind: string; path: string }>; toPath: string };

    expect(result.ok).toBe(true);
    expect(result.content).toContain(`Copied \`${fromPath}\` to \`${toPath}\`.`);
    expect(data.toPath).toBe(toPath);
    expect(data.fileChanges[0]).toMatchObject({ kind: "create", path: toPath });
    await expect(backend.readTextFile(toPath)).resolves.toMatchObject({ content: "png-bytes" });
  });

  it("applies an exact replacement and returns file-change metadata", async () => {
    const path = `${ROOT}/src/app.ts`;
    const backend = makeBackend({ [path]: { content: "const value = 1;\n" } });
    const tool = createFilesExactReplaceTool(backend);
    const result = await tool.execute({ newText: "value = 2", oldText: "value = 1", path: "src/app.ts" }, makeContext());
    const data = result.data as { fileChanges: Array<{ additions: number; deletions: number; path: string }> };

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Applied exact replacement");
    expect(data.fileChanges[0]).toMatchObject({ additions: 1, deletions: 1, path });
    await expect(backend.readTextFile(path)).resolves.toMatchObject({ content: "const value = 2;\n" });
  });

  it("supports dry-run exact replacement without writing", async () => {
    const path = `${ROOT}/src/app.ts`;
    const backend = makeBackend({ [path]: { content: "alpha\nbeta\n" } });
    const tool = createFilesExactReplaceTool(backend);
    const result = await tool.execute({ dryRun: true, newText: "gamma", oldText: "beta", path }, makeContext());

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Dry run");
    await expect(backend.readTextFile(path)).resolves.toMatchObject({ content: "alpha\nbeta\n" });
  });

  it("creates a file through files_write and overwrites existing files by default", async () => {
    const path = `${ROOT}/src/new.ts`;
    const backend = makeBackend({ [path]: { content: "old" } });
    const tool = createFilesWriteTool(backend);
    const overwritten = await tool.execute({ content: "export const x = 1;\n", path }, makeContext());
    const blocked = await tool.execute({ content: "blocked", overwrite: false, path }, makeContext());

    expect(overwritten.ok).toBe(true);
    await expect(backend.readTextFile(path)).resolves.toMatchObject({ content: "export const x = 1;\n" });
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toContain("overwrite is false");
  });

  it("refuses broad files_write replacements when a large existing file only needs a precise edit", async () => {
    const path = `${ROOT}/src/large.ts`;
    const lines = Array.from({ length: 220 }, (_, index) => `export const value${index} = "${"x".repeat(64)}";`);
    const before = `${lines.join("\n")}\n`;
    const after = before.replace("value120", "updated120");
    const backend = makeBackend({ [path]: { content: before } });
    const tool = createFilesWriteTool(backend);
    const result = await tool.execute({ content: after, path }, makeContext());

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Refusing broad write");
    expect(result.error).toContain("files_exact_replace");
    await expect(backend.readTextFile(path)).resolves.toMatchObject({ content: before });
  });

  it("refuses localized files_write_many updates to existing files unless a full rewrite is explicit", async () => {
    const path = `${ROOT}/src/small.ts`;
    const lines = Array.from({ length: 12 }, (_, index) => `export const value${index} = ${index};`);
    const before = `${lines.join("\n")}\n`;
    const after = before.replace("value6 = 6", "value6 = 42");
    const backend = makeBackend({ [path]: { content: before } });
    const tool = createFilesWriteManyTool(backend);
    const result = await tool.execute({
      files: [
        { content: after, path: "src/small.ts" },
      ],
    }, makeContext());

    expect(result.ok).toBe(false);
    expect(result.content).toContain("Refusing broad write");
    expect(result.content).toContain("files_edit_many");
    await expect(backend.readTextFile(path)).resolves.toMatchObject({ content: before });
  });

  it("allows precise range edits in large files without triggering the broad-write guard", async () => {
    const path = `${ROOT}/src/large.ts`;
    const lines = Array.from({ length: 220 }, (_, index) => `export const value${index} = "${"x".repeat(64)}";`);
    const before = `${lines.join("\n")}\n`;
    const backend = makeBackend({ [path]: { content: before } });
    const tool = createFilesReplaceRangeTool(backend);
    const result = await tool.execute({ content: "export const updated120 = 28;", endLine: 121, path, startLine: 121 }, makeContext());

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Replaced lines 121-121");
    await expect(backend.readTextFile(path)).resolves.toMatchObject({
      content: before.replace(lines[120]!, "export const updated120 = 28;"),
    });
  });

  it("allows broad files_write replacement when explicitly marked as an intentional full-file rewrite", async () => {
    const path = `${ROOT}/src/large.ts`;
    const lines = Array.from({ length: 220 }, (_, index) => `export const value${index} = "${"x".repeat(64)}";`);
    const before = `${lines.join("\n")}\n`;
    const after = before.replace("value120", "updated120");
    const backend = makeBackend({ [path]: { content: before } });
    const tool = createFilesWriteTool(backend);
    const result = await tool.execute({ allowWholeFileReplacement: true, content: after, path }, makeContext());

    expect(result.ok).toBe(true);
    await expect(backend.readTextFile(path)).resolves.toMatchObject({ content: after });
  });

  it("treats string path-not-found inspect errors as a creatable new file", async () => {
    const path = `${ROOT}/new-folder/index.html`;
    const files: Record<string, string> = {};
    const backend: EditingBackend = {
      readTextFile: async () => {
        throw "Could not read /workspace/project/new-folder/index.html: The system cannot find the path specified. (os error 3)";
      },
      writeTextFile: async (writePath, content) => {
        files[writePath] = content;
        return {
          bytesWritten: content.length,
          created: true,
          path: writePath,
          sha256: "sha-created",
        };
      },
    };
    const tool = createFilesWriteTool(backend);
    const result = await tool.execute({ content: "<!doctype html>", path }, makeContext());

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Created");
    expect(files[path]).toBe("<!doctype html>");
  });

  it("writes many files in one batch and reports combined file-change metadata", async () => {
    const firstPath = `${ROOT}/src/a.ts`;
    const secondPath = `${ROOT}/src/b.ts`;
    const backend = makeBackend();
    const tool = createFilesWriteManyTool(backend);
    const result = await tool.execute({
      overwrite: false,
      files: [
        { content: "export const a = 1;\n", path: "src/a.ts" },
        { content: "export const b = 2;\n", path: "src/b.ts" },
      ],
    }, makeContext());
    const data = result.data as { fileChanges: Array<{ path: string }>; requestedCount: number; successCount: number };

    expect(result.ok).toBe(true);
    expect(data).toMatchObject({ requestedCount: 2, successCount: 2 });
    expect(data.fileChanges.map((change) => change.path)).toEqual([firstPath, secondPath]);
    await expect(backend.readTextFile(firstPath)).resolves.toMatchObject({ content: "export const a = 1;\n" });
    await expect(backend.readTextFile(secondPath)).resolves.toMatchObject({ content: "export const b = 2;\n" });
  });

  it("honors compact write schema aliases from provider-visible tool calls", async () => {
    const path = `${ROOT}/src/existing.ts`;
    const backend = makeBackend({ [path]: { content: "old\n" } });
    const tool = createFilesWriteManyTool(backend);
    const result = await tool.execute({
      files: [
        { allowOverwrite: false, content: "new\n", path: "src/existing.ts" },
      ],
    }, makeContext());

    expect(result.ok).toBe(false);
    expect(result.content).toContain("overwrite is false");
    await expect(backend.readTextFile(path)).resolves.toMatchObject({ content: "old\n" });
  });

  it("uses the backend batch writer for non-dry-run write batches", async () => {
    const calls = { batchWrites: 0, reads: 0, singleWrites: 0 };
    const backend: EditingBackend = {
      readTextFile: async () => {
        calls.reads += 1;
        throw new Error("file not found");
      },
      writeTextFile: async (path, content) => {
        calls.singleWrites += 1;
        return {
          bytesWritten: content.length,
          created: true,
          path,
          sha256: `sha-${content.length}`,
        };
      },
      writeTextFiles: async (files) => {
        calls.batchWrites += 1;
        return {
          files: files.map((file) => ({
            ok: true,
            requestedPath: file.path,
            result: {
              bytesWritten: file.content.length,
              created: true,
              path: file.path,
              sha256: `sha-${file.content.length}`,
            },
          })),
        };
      },
    };
    const tool = createFilesWriteManyTool(backend);
    const result = await tool.execute({
      overwrite: false,
      files: [
        { content: "export const a = 1;\n", path: "src/a.ts" },
        { content: "export const b = 2;\n", path: "src/b.ts" },
      ],
    }, makeContext());
    const data = result.data as { fileChanges: Array<{ additions: number; kind: string; path: string }>; successCount: number };

    expect(result.ok).toBe(true);
    expect(calls).toEqual({ batchWrites: 1, reads: 0, singleWrites: 0 });
    expect(data.successCount).toBe(2);
    expect(data.fileChanges.map((change) => ({ additions: change.additions, kind: change.kind }))).toEqual([
      { additions: 1, kind: "create" },
      { additions: 1, kind: "create" },
    ]);
  });

  it("uses the native create-first batch path when overwrite is omitted", async () => {
    const calls = { batchWrites: 0, reads: 0, singleWrites: 0 };
    const backend: EditingBackend = {
      readTextFile: async () => {
        calls.reads += 1;
        throw new Error("file not found");
      },
      writeTextFile: async (path, content) => {
        calls.singleWrites += 1;
        return {
          bytesWritten: content.length,
          created: true,
          path,
          sha256: `sha-${content.length}`,
        };
      },
      writeTextFiles: async (files) => {
        calls.batchWrites += 1;
        return {
          files: files.map((file) => ({
            ok: true,
            requestedPath: file.path,
            result: {
              bytesWritten: file.content.length,
              created: true,
              path: file.path,
              sha256: `sha-${file.content.length}`,
            },
          })),
        };
      },
    };
    const tool = createFilesWriteManyTool(backend);
    const result = await tool.execute({
      files: [
        { content: "export const a = 1;\n", path: "src/a.ts" },
        { content: "export const b = 2;\n", path: "src/b.ts" },
      ],
    }, makeContext());
    const data = result.data as { successCount: number };

    expect(result.ok).toBe(true);
    expect(calls).toEqual({ batchWrites: 1, reads: 0, singleWrites: 0 });
    expect(data.successCount).toBe(2);
  });

  it("falls back to guarded writes for existing files after the create-first batch path", async () => {
    const existingPath = `${ROOT}/src/existing.ts`;
    const newPath = `${ROOT}/src/new.ts`;
    const files: Record<string, string> = {
      [existingPath]: "export const value = 1;\n",
    };
    const calls = { batchWrites: 0, reads: 0, singleWrites: 0 };
    const backend: EditingBackend = {
      readTextFile: async (path) => {
        calls.reads += 1;
        const content = files[path];

        if (content === undefined) {
          throw new Error("file not found");
        }

        return {
          content,
          name: path.split("/").pop() ?? "file",
          path,
          sha256: `sha-${content.length}`,
          size: content.length,
          truncated: false,
        };
      },
      writeTextFile: async (path, content) => {
        calls.singleWrites += 1;
        files[path] = content;
        return {
          bytesWritten: content.length,
          created: false,
          path,
          sha256: `sha-${content.length}`,
        };
      },
      writeTextFiles: async (batchFiles) => {
        calls.batchWrites += 1;
        return {
          files: batchFiles.map((file) => {
            if (file.path === existingPath) {
              return {
                error: "That file already exists and overwrite is disabled.",
                ok: false,
                requestedPath: file.path,
              };
            }

            files[file.path] = file.content;
            return {
              ok: true,
              requestedPath: file.path,
              result: {
                bytesWritten: file.content.length,
                created: true,
                path: file.path,
                sha256: `sha-${file.content.length}`,
              },
            };
          }),
        };
      },
    };
    const tool = createFilesWriteManyTool(backend);
    const result = await tool.execute({
      files: [
        { content: "export const next = true;\n", path: "src/new.ts" },
        { content: "export const value = 2;\n", path: "src/existing.ts" },
      ],
    }, makeContext());
    const data = result.data as { successCount: number };

    expect(result.ok).toBe(true);
    expect(calls).toEqual({ batchWrites: 1, reads: 1, singleWrites: 1 });
    expect(data.successCount).toBe(2);
    expect(files[newPath]).toBe("export const next = true;\n");
    expect(files[existingPath]).toBe("export const value = 2;\n");
  });

  it("keeps dry-run write batches on the inspecting preview path", async () => {
    const calls = { batchWrites: 0, reads: 0 };
    const backend: EditingBackend = {
      readTextFile: async () => {
        calls.reads += 1;
        throw new Error("file not found");
      },
      writeTextFile: async (path, content) => ({
        bytesWritten: content.length,
        created: true,
        path,
        sha256: `sha-${content.length}`,
      }),
      writeTextFiles: async () => {
        calls.batchWrites += 1;
        return { files: [] };
      },
    };
    const tool = createFilesWriteManyTool(backend);
    const result = await tool.execute({
      dryRun: true,
      files: [
        { content: "export const a = 1;\n", path: "src/a.ts" },
        { content: "export const b = 2;\n", path: "src/b.ts" },
      ],
    }, makeContext());

    expect(result.ok).toBe(true);
    expect(calls.batchWrites).toBe(0);
    expect(calls.reads).toBe(2);
  });

  it("skips duplicate identical batch writes without failing the batch", async () => {
    const path = `${ROOT}/src/a.ts`;
    const backend = makeBackend();
    const tool = createFilesWriteManyTool(backend);
    const result = await tool.execute({
      files: [
        { content: "export const a = 1;\n", path: "src/a.ts" },
        { content: "export const a = 1;\n", path: "src/a.ts" },
      ],
    }, makeContext());
    const data = result.data as { skippedCount: number; successCount: number };

    expect(result.ok).toBe(true);
    expect(data).toMatchObject({ skippedCount: 1, successCount: 1 });
    expect(result.content).toContain("[SKIPPED]");
    await expect(backend.readTextFile(path)).resolves.toMatchObject({ content: "export const a = 1;\n" });
  });

  it("attaches batch file result metadata to bridge batch write calls", async () => {
    const firstPath = `${ROOT}/src/a.ts`;
    const secondPath = `${ROOT}/src/b.ts`;
    const backend = makeBackend();
    const registry = new ToolRegistry([createFilesWriteManyTool(backend)]);
    const batch = await executeToolBridgeCalls({
      calls: [{
        arguments: {
          files: [
            { content: "export const a = 1;\n", path: "src/a.ts" },
            { content: "export const b = 2;\n", path: "src/b.ts" },
          ],
        },
        id: "call-batch-write",
        name: "files_write_many",
        provider: "openai",
      }],
      context: makeContext(),
      registry,
    });

    expect(batch.toolCalls[0]?.batchSummary).toMatchObject({
      fileCount: 2,
      operation: "write",
      successCount: 2,
    });
    expect(batch.toolCalls[0]?.batchFileResults?.map((item) => item.path)).toEqual([firstPath, secondPath]);
    expect(batch.toolCalls[0]?.batchFileResults?.every((item) => item.status === "ok")).toBe(true);
  });

  it("streams per-file progress for bridge batch edits", async () => {
    const firstPath = `${ROOT}/src/a.ts`;
    const secondPath = `${ROOT}/src/b.ts`;
    const backend = makeBackend({
      [firstPath]: { content: "export const a = 1;\n" },
      [secondPath]: { content: "export const b = 2;\n" },
    });
    const registry = new ToolRegistry([createFilesEditManyTool(backend)]);
    const updates: ChatToolCall[] = [];

    const batch = await executeToolBridgeCalls({
      calls: [{
        arguments: {
          edits: [
            { newText: "export const a = 10;\n", oldText: "export const a = 1;\n", operation: "exact_replace", path: "src/a.ts" },
            { newText: "export const b = 20;\n", oldText: "export const b = 2;\n", operation: "exact_replace", path: "src/b.ts" },
          ],
        },
        id: "call-batch-edit",
        name: "files_edit_many",
        provider: "openai",
      }],
      context: makeContext(),
      onToolCallUpdate: (toolCall) => updates.push(toolCall),
      registry,
    });

    const activeBatchUpdates = updates.filter((toolCall) => toolCall.status === "active" && (toolCall.batchFileResults?.length ?? 0) > 0);
    const streamedPaths = new Set(activeBatchUpdates.flatMap((toolCall) => toolCall.batchFileResults?.map((result) => result.path) ?? []));

    expect(activeBatchUpdates.length).toBeGreaterThan(0);
    expect(streamedPaths).toEqual(new Set([firstPath, secondPath]));
    expect(activeBatchUpdates[activeBatchUpdates.length - 1]?.batchSummary).toMatchObject({
      fileCount: 2,
      operation: "edit",
      successCount: 2,
    });
    expect(batch.toolCalls[0]?.batchSummary).toMatchObject({
      fileCount: 2,
      operation: "edit",
      successCount: 2,
    });
  });

  it("applies ordered batch edits to one file with a single final write", async () => {
    const path = `${ROOT}/src/app.ts`;
    const backend = makeBackend({ [path]: { content: "one\ntwo\nthree\n" } });
    const tool = createFilesEditManyTool(backend);
    const result = await tool.execute({
      edits: [
        { newText: "ONE", oldText: "one", operation: "exact_replace", path: "src/app.ts" },
        { content: "inserted", line: 3, operation: "insert_at_line", path: "src/app.ts" },
        { content: "tail\n", operation: "append", path: "src/app.ts" },
      ],
    }, makeContext());
    const data = result.data as { fileChanges: Array<{ path: string }>; requestedCount: number; successCount: number };

    expect(result.ok).toBe(true);
    expect(data).toMatchObject({ requestedCount: 3, successCount: 3 });
    expect(data.fileChanges).toHaveLength(1);
    expect(data.fileChanges[0]?.path).toBe(path);
    await expect(backend.readTextFile(path)).resolves.toMatchObject({ content: "ONE\ntwo\ninserted\nthree\ntail\n" });
  });

  it("refuses broad batch exact replacements that effectively rewrite a whole file", async () => {
    const path = `${ROOT}/src/style.css`;
    const lines = Array.from({ length: 260 }, (_, index) => `.panel-${index} { color: red; }`);
    const before = `${lines.join("\n")}\n`;
    const after = before.replace(".panel-120 { color: red; }", ".panel-120 { color: blue; }");
    const backend = makeBackend({ [path]: { content: before } });
    const tool = createFilesEditManyTool(backend);
    const result = await tool.execute({
      edits: [
        { newText: after, oldText: before, operation: "exact_replace", path: "src/style.css" },
      ],
    }, makeContext());

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Refusing broad edit");
    expect(result.error).toContain("files_edit_many");
    expect(result.error).toContain("allowWholeFileReplacement:true");
    await expect(backend.readTextFile(path)).resolves.toMatchObject({ content: before });
  });

  it("accepts single-edit shorthand when a model calls files_edit_many for one file", async () => {
    const path = `${ROOT}/src/app.ts`;
    const backend = makeBackend({ [path]: { content: "one\ntwo\nthree\n" } });
    const tool = createFilesEditManyTool(backend);
    const result = await tool.execute({
      newText: "TWO",
      oldText: "two",
      path: "src/app.ts",
    }, makeContext());
    const data = result.data as { requestedCount: number; successCount: number };

    expect(result.ok).toBe(true);
    expect(data).toMatchObject({ requestedCount: 1, successCount: 1 });
    await expect(backend.readTextFile(path)).resolves.toMatchObject({ content: "one\nTWO\nthree\n" });
  });

  it("accepts single-edit line-range shorthand when a model calls files_edit_many", async () => {
    const path = `${ROOT}/src/app.ts`;
    const backend = makeBackend({ [path]: { content: "one\ntwo\nthree\n" } });
    const tool = createFilesEditManyTool(backend);
    const result = await tool.execute({
      content: "TWO",
      endLine: 2,
      path: "src/app.ts",
      startLine: 2,
    }, makeContext());

    expect(result.ok).toBe(true);
    await expect(backend.readTextFile(path)).resolves.toMatchObject({ content: "one\nTWO\nthree\n" });
  });

  it("treats out-of-range batch line edits as stale ranges with retry guidance", async () => {
    const path = `${ROOT}/src/app.ts`;
    const backend = makeBackend({ [path]: { content: "one\ntwo\nthree\n" } });
    const tool = createFilesEditManyTool(backend);
    const result = await tool.execute({
      edits: [
        { content: "TWO", endLine: 8, operation: "replace_range", path: "src/app.ts", startLine: 7 },
      ],
    }, makeContext());

    expect(result.ok).toBe(false);
    expect(result.error).toContain("files_edit_many edits[0] cannot replace lines 7-8");
    expect(result.error).toContain("line range is stale");
    expect(result.error).toContain("Re-read the current target");
    await expect(backend.readTextFile(path)).resolves.toMatchObject({ content: "one\ntwo\nthree\n" });
  });

  it("continues independent batch edit files when one file group fails", async () => {
    const okPath = `${ROOT}/src/ok.ts`;
    const failPath = `${ROOT}/src/fail.ts`;
    const backend = makeBackend({
      [failPath]: { content: "alpha\n" },
      [okPath]: { content: "one\n" },
    });
    const tool = createFilesEditManyTool(backend);
    const result = await tool.execute({
      edits: [
        { newText: "ONE", oldText: "one", operation: "exact_replace", path: "src/ok.ts" },
        { newText: "missing", oldText: "not-present", operation: "exact_replace", path: "src/fail.ts" },
      ],
    }, makeContext());
    const data = result.data as { failureCount: number; successCount: number };

    expect(result.ok).toBe(true);
    expect(data).toMatchObject({ failureCount: 1, successCount: 1 });
    await expect(backend.readTextFile(okPath)).resolves.toMatchObject({ content: "ONE\n" });
    await expect(backend.readTextFile(failPath)).resolves.toMatchObject({ content: "alpha\n" });
  });

  it("applies a verified unified diff patch", async () => {
    const path = `${ROOT}/src/app.ts`;
    const backend = makeBackend({ [path]: { content: "one\ntwo\nthree\n" } });
    const tool = createFilesApplyPatchTool(backend);
    const patch = [
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1,3 +1,3 @@",
      " one",
      "-two",
      "+TWO",
      " three",
      "",
    ].join("\n");
    const result = await tool.execute({ patch }, makeContext());

    expect(result.ok).toBe(true);
    await expect(backend.readTextFile(path)).resolves.toMatchObject({ content: "one\nTWO\nthree\n" });
  });

  it("explains Codex-style patches instead of reporting missing hunks", async () => {
    const path = `${ROOT}/src/app.ts`;
    const backend = makeBackend({ [path]: { content: "one\n" } });
    const tool = createFilesApplyPatchTool(backend);
    const result = await tool.execute({
      patch: "*** Begin Patch\n*** Delete File: src/app.ts\n*** End Patch",
    }, makeContext());

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Codex-style *** Begin Patch syntax is not supported");
    await expect(backend.readTextFile(path)).resolves.toMatchObject({ content: "one\n" });
  });

  it("matches exact replacements across CRLF and LF line endings", async () => {
    const path = `${ROOT}/src/app.ts`;
    const backend = makeBackend({ [path]: { content: "one\r\ntwo\r\nthree\r\n" } });
    const tool = createFilesExactReplaceTool(backend);
    const result = await tool.execute({ newText: "two\nTWO", oldText: "two\nthree", path: "src/app.ts" }, makeContext());

    expect(result.ok).toBe(true);
    await expect(backend.readTextFile(path)).resolves.toMatchObject({ content: "one\r\ntwo\r\nTWO\r\n" });
  });

  it("inserts text at a precise 1-based line", async () => {
    const path = `${ROOT}/src/app.ts`;
    const backend = makeBackend({ [path]: { content: "one\ntwo\nthree\n" } });
    const tool = createFilesInsertAtLineTool(backend);
    const result = await tool.execute({ content: "inserted", line: 2, path: "src/app.ts" }, makeContext());

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Inserted text at line 2");
    await expect(backend.readTextFile(path)).resolves.toMatchObject({ content: "one\ninserted\ntwo\nthree\n" });
  });

  it("replaces an inclusive line range and allows empty replacement", async () => {
    const path = `${ROOT}/src/app.ts`;
    const backend = makeBackend({ [path]: { content: "one\ntwo\nthree\nfour\n" } });
    const tool = createFilesReplaceRangeTool(backend);
    const result = await tool.execute({ content: "TWO\nTHREE", endLine: 3, path: "src/app.ts", startLine: 2 }, makeContext());
    const deleteResult = await tool.execute({ content: "", endLine: 3, path: "src/app.ts", startLine: 3 }, makeContext());

    expect(result.ok).toBe(true);
    expect(deleteResult.ok).toBe(true);
    await expect(backend.readTextFile(path)).resolves.toMatchObject({ content: "one\nTWO\nfour\n" });
  });

  it("appends text without merging onto the last line", async () => {
    const path = `${ROOT}/src/app.ts`;
    const backend = makeBackend({ [path]: { content: "export const one = 1;" } });
    const tool = createFilesAppendTool(backend);
    const result = await tool.execute({ content: "export const two = 2;\n", path: "src/app.ts" }, makeContext());

    expect(result.ok).toBe(true);
    await expect(backend.readTextFile(path)).resolves.toMatchObject({ content: "export const one = 1;\nexport const two = 2;\n" });
  });

  it("rebases append-only edits onto the latest file when expectedSha256 is stale", async () => {
    const path = `${ROOT}/src/app.ts`;
    const backend = makeBackend({ [path]: { content: "export const one = 1;\n", sha256: "current-sha" } });
    const tool = createFilesAppendTool(backend);
    const result = await tool.execute({
      content: "export const two = 2;\n",
      expectedSha256: "stale-sha",
      path: "src/app.ts",
    }, makeContext());

    expect(result.ok).toBe(true);
    await expect(backend.readTextFile(path)).resolves.toMatchObject({ content: "export const one = 1;\nexport const two = 2;\n" });
  });

  it("replaces a single character by line and column span", async () => {
    const path = `${ROOT}/src/app.ts`;
    const backend = makeBackend({ [path]: { content: "const enabled = trve;\n" } });
    const tool = createFilesReplaceSpanTool(backend);
    const result = await tool.execute({
      content: "u",
      endColumn: 20,
      path: "src/app.ts",
      startColumn: 19,
      startLine: 1,
    }, makeContext());

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Replaced span 1:19-1:20");
    await expect(backend.readTextFile(path)).resolves.toMatchObject({ content: "const enabled = true;\n" });
  });

  it("normalizes snake-case span arguments before executing bridge tool calls", async () => {
    const path = `${ROOT}/src/app.ts`;
    const backend = makeBackend({ [path]: { content: "const enabled = trve;\n" } });
    const registry = new ToolRegistry([createFilesReplaceSpanTool(backend)]);
    const batch = await executeToolBridgeCalls({
      calls: [{
        arguments: {
          content: "u",
          end_column: "20",
          path: "src/app.ts",
          start_column: "19",
          start_line: "1",
        },
        id: "call-span",
        name: "replace_span",
        provider: "openai",
      }],
      context: makeContext(),
      registry,
    });

    expect(batch.toolCalls[0]?.status).toBe("complete");
    await expect(backend.readTextFile(path)).resolves.toMatchObject({ content: "const enabled = true;\n" });
  });

  it("applies replace_span inside ordered batch edits and writes one file once", async () => {
    const path = `${ROOT}/src/app.ts`;
    let writes = 0;
    const backend = makeBackend({ [path]: { content: "const enabled = trve;\nexport const oldName = enabled;\n" } });
    const originalWrite = backend.writeTextFile;
    backend.writeTextFile = async (...args) => {
      writes += 1;
      return originalWrite(...args);
    };
    const tool = createFilesEditManyTool(backend);
    const result = await tool.execute({
      edits: [
        { content: "u", endColumn: 20, operation: "replace_span", path: "src/app.ts", startColumn: 19, startLine: 1 },
        { newText: "newName", oldText: "oldName", operation: "exact_replace", path: "src/app.ts" },
      ],
    }, makeContext());

    expect(result.ok).toBe(true);
    expect(writes).toBe(1);
    await expect(backend.readTextFile(path)).resolves.toMatchObject({ content: "const enabled = true;\nexport const newName = enabled;\n" });
  });

  it("treats out-of-range batch column edits as stale spans with retry guidance", async () => {
    const path = `${ROOT}/src/app.ts`;
    const backend = makeBackend({ [path]: { content: "short\n" } });
    const tool = createFilesEditManyTool(backend);
    const result = await tool.execute({
      edits: [
        { content: "x", endColumn: 12, operation: "replace_span", path: "src/app.ts", startColumn: 11, startLine: 1 },
      ],
    }, makeContext());

    expect(result.ok).toBe(false);
    expect(result.error).toContain("startColumn 11 is outside line 1");
    expect(result.error).toContain("column range is stale");
    await expect(backend.readTextFile(path)).resolves.toMatchObject({ content: "short\n" });
  });

  it("moves a workspace path and reports move metadata", async () => {
    const fromPath = `${ROOT}/src/app.ts`;
    const toPath = `${ROOT}/src/main.ts`;
    const backend = makeBackend({ [fromPath]: { content: "one\n" } });
    const tool = createFilesMoveTool(backend);
    const result = await tool.execute({ fromPath: "src/app.ts", toPath: "src/main.ts" }, makeContext());
    const data = result.data as { fileChanges: Array<{ kind: string; path: string }> };

    expect(result.ok).toBe(true);
    expect(data.fileChanges[0]).toMatchObject({ kind: "move", path: `${fromPath} -> ${toPath}` });
    await expect(backend.readTextFile(toPath)).resolves.toMatchObject({ content: "one\n" });
    await expect(backend.readTextFile(fromPath)).rejects.toThrow("file not found");
  });

  it("routes mutating tools through bridge approval in default mode", async () => {
    const path = `${ROOT}/src/app.ts`;
    const backend = makeBackend({ [path]: { content: "one\n" } });
    const registry = new ToolRegistry(createEditingTools(backend));
    const approval = vi.fn(async () => ({ approved: true }));
    const batch = await executeToolBridgeCalls({
      approval,
      calls: [{
        arguments: { newText: "two", oldText: "one", path: "src/app.ts" },
        id: "call-edit",
        name: "files_exact_replace",
        provider: "openai",
      }],
      context: makeContext({ permissionMode: "default" }),
      registry,
    });

    expect(approval).toHaveBeenCalledOnce();
    expect(batch.toolCalls[0]).toMatchObject({ label: "Edit file by exact replace", status: "complete" });
    expect(batch.toolCalls[0]?.fileChanges?.[0]).toMatchObject({ additions: 1, deletions: 1, path });
  });

  it("registers edit aliases without advertising duplicate tool ids", () => {
    const registry = createDefaultToolRegistry();
    const advertised = registry.listForContext(makeContext({ permissionMode: "full-access" })).map((tool) => tool.id);

    expect(registry.get("edit_file")?.id).toBe("files_exact_replace");
    expect(registry.get("insert_at_line")?.id).toBe("files_insert_at_line");
    expect(registry.get("replace_range")?.id).toBe("files_replace_range");
    expect(registry.get("replace_span")?.id).toBe("files_replace_span");
    expect(registry.get("append_file")?.id).toBe("files_append");
    expect(registry.get("write_file")?.id).toBe("files_write");
    expect(registry.get("write_files")?.id).toBe("files_write_many");
    expect(registry.get("create_files")?.id).toBe("files_write_many");
    expect(registry.get("edit_files")?.id).toBe("files_edit_many");
    expect(registry.get("apply_patch")?.id).toBe("files_apply_patch");
    expect(registry.get("move_file")?.id).toBe("files_move");
    expect(advertised).toContain("files_exact_replace");
    expect(advertised).toContain("files_insert_at_line");
    expect(advertised).toContain("files_replace_range");
    expect(advertised).toContain("files_replace_span");
    expect(advertised).toContain("files_append");
    expect(advertised).toContain("files_write");
    expect(advertised).toContain("files_write_many");
    expect(advertised).toContain("files_edit_many");
    expect(advertised).toContain("files_apply_patch");
    expect(advertised).toContain("files_move");
    expect(advertised).not.toContain("edit_file");
  });
});
