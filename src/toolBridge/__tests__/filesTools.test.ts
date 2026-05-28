import { describe, expect, it } from "vitest";
import type {
  ComputerDirectoryListing,
  ComputerReadFileResult,
  ComputerSearchResult,
} from "../../types/localWorkspace";
import { executeToolBridgeCalls } from "../orchestrator";
import { ToolRegistry } from "../registry";
import {
  createFilesCountLinesTool,
  createFilesListTool,
  createFilesReadManyTool,
  createFilesReadRangeTool,
  createFilesReadTool,
  createFilesSearchTool,
  createFilesStatTool,
  createFilesTreeSummaryTool,
  type FilesBackend,
} from "../tools/files";
import type { ToolExecutionContext } from "../types";

const ROOT = "/workspace/project";

function makeBackend(overrides: Partial<FilesBackend> = {}): FilesBackend {
  return {
    listDirectory: overrides.listDirectory ?? (async () => {
      throw new Error("listDirectory not implemented in this test");
    }),
    readTextFileRange: overrides.readTextFileRange,
    readTextFile: overrides.readTextFile ?? (async () => {
      throw new Error("readTextFile not implemented in this test");
    }),
    searchIndexedFiles: overrides.searchIndexedFiles,
    searchTextFiles: overrides.searchTextFiles,
  };
}

function makeContext(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    model: "test-model",
    permissionMode: "auto-review",
    provider: "openai",
    workspaceRoots: [ROOT],
    ...overrides,
  };
}

describe("files_read", () => {
  it("reads a text file inside the workspace root", async () => {
    const backend = makeBackend({
      readTextFile: async (path, maxBytes) => {
        expect(path).toBe(`${ROOT}/README.md`);
        expect(maxBytes).toBeUndefined();
        return {
          content: "# Hello",
          extension: "md",
          modifiedAt: 1700000000,
          name: "README.md",
          path,
          sha256: "deadbeef",
          size: 7,
          truncated: false,
        } satisfies ComputerReadFileResult;
      },
    });
    const tool = createFilesReadTool(backend);
    const result = await tool.execute({ path: "README.md" }, makeContext());

    expect(result.ok).toBe(true);
    expect(result.content).toBe("# Hello");
    expect(result.data).toMatchObject({ name: "README.md", size: 7, truncated: false });
  });

  it("rejects a path outside the workspace roots", async () => {
    const tool = createFilesReadTool(makeBackend());
    const result = await tool.execute({ path: "/etc/passwd" }, makeContext());

    expect(result.ok).toBe(false);
    expect(result.error).toContain("outside the configured workspace roots");
  });

  it("rejects '..' traversal that escapes the root", async () => {
    const tool = createFilesReadTool(makeBackend());
    const result = await tool.execute({ path: `${ROOT}/../escape.txt` }, makeContext());

    expect(result.ok).toBe(false);
    expect(result.error).toContain("outside the configured workspace roots");
  });

  it("passes an explicit maxBytes through without a bridge cap", async () => {
    let observed = -1;
    const backend = makeBackend({
      readTextFile: async (_path, maxBytes) => {
        observed = maxBytes ?? -1;
        return {
          content: "",
          name: "x",
          path: _path,
          size: 0,
          truncated: false,
        } satisfies ComputerReadFileResult;
      },
    });
    const tool = createFilesReadTool(backend);

    await tool.execute({ maxBytes: 999_999_999, path: "x.txt" }, makeContext());
    expect(observed).toBe(999_999_999);
  });

  it("passes an explicit byte offset through for chunked reads", async () => {
    let observedMaxBytes = -1;
    let observedOffset = -1;
    const backend = makeBackend({
      readTextFile: async (_path, maxBytes, offset) => {
        observedMaxBytes = maxBytes ?? -1;
        observedOffset = offset ?? -1;
        return {
          content: "chunk",
          name: "x",
          path: _path,
          size: 4096,
          truncated: true,
        } satisfies ComputerReadFileResult;
      },
    });
    const tool = createFilesReadTool(backend);
    const result = await tool.execute({ maxBytes: 3000, offset: 820, path: "x.txt" }, makeContext());

    expect(result.ok).toBe(true);
    expect(observedMaxBytes).toBe(3000);
    expect(observedOffset).toBe(820);
    expect(result.data).toMatchObject({ offset: 820, truncated: true });
  });

  it("accepts line range arguments on files_read for wrong-tool recovery", async () => {
    const backend = makeBackend({
      readTextFile: async (path) => ({
        content: "one\ntwo\nthree\nfour\n",
        extension: "ts",
        name: "sample.ts",
        path,
        size: 19,
        truncated: false,
      }),
    });
    const registry = new ToolRegistry([createFilesReadTool(backend)]);

    const batch = await executeToolBridgeCalls({
      calls: [
        {
          arguments: { endLine: 3, path: "src/sample.ts", startLine: 2 },
          id: "call-range",
          name: "files_read",
          provider: "openai",
        },
      ],
      context: makeContext(),
      registry,
    });

    expect(batch.toolCalls[0]?.status).toBe("complete");
    expect(batch.resultMessages[0]?.result.content).toContain(`Read \`${ROOT}/src/sample.ts\` lines 2-3 of 4.`);
    expect(batch.resultMessages[0]?.result.content).toContain("2: two\n3: three");
    expect(batch.resultMessages[0]?.result.data).toMatchObject({
      content: "2: two\n3: three",
      endLine: 3,
      path: `${ROOT}/src/sample.ts`,
      source: "line-range-via-files-read",
      startLine: 2,
    });
  });

  it("returns a clean error when the backend throws", async () => {
    const backend = makeBackend({
      readTextFile: async () => {
        throw new Error("File looks binary");
      },
    });
    const tool = createFilesReadTool(backend);
    const result = await tool.execute({ path: "image.png" }, makeContext());

    expect(result.ok).toBe(false);
    expect(result.error).toContain("File looks binary");
    expect(result.error).toContain(`${ROOT}/image.png`);
  });

  it("suggests files_search when a guessed file path is missing without a nearby match", async () => {
    const backend = makeBackend({
      listDirectory: async (path) => {
        if (path === ROOT) {
          return {
            entries: [
              { extension: "ts", kind: "file", name: "vite.config.ts", path: `${ROOT}/vite.config.ts`, size: 100 },
              { extension: "json", kind: "file", name: "package.json", path: `${ROOT}/package.json`, size: 200 },
            ],
            inaccessibleEntries: 0,
            limited: false,
            parentPath: "",
            path,
          } satisfies ComputerDirectoryListing;
        }

        throw new Error("The system cannot find the path specified. (os error 3)");
      },
      readTextFile: async () => {
        throw new Error("The system cannot find the file specified. (os error 2)");
      },
    });
    const tool = createFilesReadTool(backend);
    const result = await tool.execute({ path: "tailwind.config.ts" }, makeContext());

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Try files_search with query `tailwind.config`");
    expect(result.error).toContain("includePath=true");
    expect(result.error).toContain("includeContent=false");
  });

  it("suggests the component folder name instead of plain index for missing module entries", async () => {
    const backend = makeBackend({
      listDirectory: async (path) => {
        if (path === `${ROOT}/src/components/TypingIndicator`) {
          return {
            entries: [],
            inaccessibleEntries: 0,
            limited: false,
            parentPath: `${ROOT}/src/components`,
            path,
          } satisfies ComputerDirectoryListing;
        }

        throw new Error("The system cannot find the path specified. (os error 3)");
      },
      readTextFile: async () => {
        throw new Error("The system cannot find the file specified. (os error 2)");
      },
    });
    const tool = createFilesReadTool(backend);
    const result = await tool.execute({ path: "src/components/TypingIndicator/index.jsx" }, makeContext());

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Try files_search with query `TypingIndicator`");
    expect(result.error).not.toContain("query `index`");
  });

  it("recovers a module entry when a stale file path points at a sibling folder", async () => {
    const requestedPath = `${ROOT}/src/toolBridge/adapters.ts`;
    const recoveredPath = `${ROOT}/src/toolBridge/adapters/index.ts`;
    const backend = makeBackend({
      listDirectory: async (path) => {
        if (path === `${ROOT}/src/toolBridge/adapters`) {
          return {
            entries: [
              { extension: "ts", kind: "file", name: "index.ts", path: recoveredPath, size: 24 },
              { extension: "ts", kind: "file", name: "responses.ts", path: `${ROOT}/src/toolBridge/adapters/responses.ts`, size: 48 },
            ],
            inaccessibleEntries: 0,
            limited: false,
            parentPath: `${ROOT}/src/toolBridge`,
            path,
          } satisfies ComputerDirectoryListing;
        }

        throw new Error("not a directory");
      },
      readTextFile: async (path) => {
        if (path === recoveredPath) {
          return {
            content: "export const adapter = true;",
            extension: "ts",
            name: "index.ts",
            path,
            size: 28,
            truncated: false,
          } satisfies ComputerReadFileResult;
        }

        expect(path).toBe(requestedPath);
        throw new Error("file not found");
      },
    });
    const tool = createFilesReadTool(backend);
    const result = await tool.execute({ path: "src/toolBridge/adapters.ts" }, makeContext());

    expect(result.ok).toBe(true);
    expect(result.content).toContain(`Requested \`${requestedPath}\` could not be read`);
    expect(result.content).toContain(`Recovered module entry \`${recoveredPath}\`.`);
    expect(result.content).toContain("export const adapter = true;");
    expect(result.data).toMatchObject({
      path: recoveredPath,
      recoveredFrom: requestedPath,
      recoveryNote: expect.stringContaining("Recovered module entry"),
    });
  });

  it("recovers a sibling module entry when an index JSX path has drifted to TSX", async () => {
    const requestedPath = `${ROOT}/src/components/TypingIndicator/index.jsx`;
    const recoveredPath = `${ROOT}/src/components/TypingIndicator/index.tsx`;
    const backend = makeBackend({
      listDirectory: async (path) => {
        if (path === `${ROOT}/src/components/TypingIndicator`) {
          return {
            entries: [
              { extension: "tsx", kind: "file", name: "index.tsx", path: recoveredPath, size: 32 },
            ],
            inaccessibleEntries: 0,
            limited: false,
            parentPath: `${ROOT}/src/components`,
            path,
          } satisfies ComputerDirectoryListing;
        }

        throw new Error("not a directory");
      },
      readTextFile: async (path) => {
        if (path === recoveredPath) {
          return {
            content: "export function TypingIndicator() {}",
            extension: "tsx",
            name: "index.tsx",
            path,
            size: 36,
            truncated: false,
          } satisfies ComputerReadFileResult;
        }

        expect(path).toBe(requestedPath);
        throw new Error("file not found");
      },
    });
    const tool = createFilesReadTool(backend);
    const result = await tool.execute({ path: "src/components/TypingIndicator/index.jsx" }, makeContext());

    expect(result.ok).toBe(true);
    expect(result.content).toContain(`Recovered module entry \`${recoveredPath}\`.`);
    expect(result.content).toContain("export function TypingIndicator");
    expect(result.data).toMatchObject({
      path: recoveredPath,
      recoveredFrom: requestedPath,
      recoveryNote: expect.stringContaining("Recovered module entry"),
    });
  });

  it("flows through the orchestrator and surfaces validation errors", async () => {
    const registry = new ToolRegistry([createFilesReadTool(makeBackend())]);

    const batch = await executeToolBridgeCalls({
      calls: [{ arguments: { path: 7 as unknown as string }, id: "call-bad", name: "files_read", provider: "openai" }],
      context: makeContext(),
      registry,
    });

    expect(batch.toolCalls[0]?.status).toBe("error");
    expect(batch.resultMessages[0]?.result.error).toBeTruthy();
  });

  it("accepts common path aliases before validating read calls", async () => {
    const backend = makeBackend({
      readTextFile: async (path) => ({
        content: "alias path ok",
        name: "sample.ts",
        path,
        size: 13,
        truncated: false,
      }),
    });
    const registry = new ToolRegistry([createFilesReadTool(backend)]);

    const batch = await executeToolBridgeCalls({
      calls: [{ arguments: { filePath: "src/sample.ts" }, id: "call-alias-path", name: "files_read", provider: "openai" }],
      context: makeContext(),
      registry,
    });

    expect(batch.toolCalls[0]?.status).toBe("complete");
    expect(batch.resultMessages[0]?.result.content).toBe("alias path ok");
  });

  it("repairs pathless read calls into workspace tree discovery instead of looping on validation", async () => {
    const backend = makeBackend({
      listDirectory: async (path) => ({
        entries: [
          { kind: "directory", name: "src", path: `${path}/src` },
          { extension: "md", kind: "file", name: "README.md", path: `${path}/README.md`, size: 20 },
        ],
        inaccessibleEntries: 0,
        limited: false,
        path,
      }),
    });
    const registry = new ToolRegistry([createFilesReadTool(backend), createFilesTreeSummaryTool(backend)]);

    const batch = await executeToolBridgeCalls({
      calls: [{ arguments: {}, id: "call-missing-path", name: "files_read", provider: "openai" }],
      context: makeContext(),
      registry,
    });

    expect(batch.toolCalls[0]?.toolId).toBe("files_tree_summary");
    expect(batch.toolCalls[0]?.status).toBe("complete");
    expect(batch.resultMessages[0]?.name).toBe("files_tree_summary");
    expect(batch.resultMessages[0]?.result.content).toContain("Workspace tree summary");
  });
});

describe("files_list", () => {
  it("lists a directory inside the workspace root", async () => {
    const backend = makeBackend({
      listDirectory: async (path, limit) => {
        expect(path).toBe(`${ROOT}/src`);
        expect(limit).toBeUndefined();
        return {
          entries: [
            { kind: "directory", name: "lib", path: `${path}/lib` },
            { extension: "ts", kind: "file", modifiedAt: 1, name: "index.ts", path: `${path}/index.ts`, size: 42 },
          ],
          inaccessibleEntries: 0,
          limited: false,
          parentPath: ROOT,
          path,
        } satisfies ComputerDirectoryListing;
      },
    });
    const tool = createFilesListTool(backend);
    const result = await tool.execute({ path: "src" }, makeContext());

    expect(result.ok).toBe(true);
    const data = result.data as { entries: Array<{ name: string }>; limited: boolean };
    expect(data.entries.map((entry) => entry.name)).toEqual(["lib", "index.ts"]);
    expect(data.limited).toBe(false);
    expect(result.content).toContain("Directory");
  });

  it("defaults to the first workspace root when path is omitted", async () => {
    const backend = makeBackend({
      listDirectory: async (path) => {
        expect(path).toBe(ROOT);
        return {
          entries: [{ extension: "md", kind: "file", name: "README.md", path: `${ROOT}/README.md`, size: 42 }],
          inaccessibleEntries: 0,
          limited: false,
          path,
        } satisfies ComputerDirectoryListing;
      },
    });
    const tool = createFilesListTool(backend);
    const result = await tool.execute({}, makeContext());

    expect(result.ok).toBe(true);
    expect(result.content).toContain("README.md");
  });

  it("recursively lists a full folder tree when requested", async () => {
    const visited: string[] = [];
    const backend = makeBackend({
      listDirectory: async (path, limit) => {
        expect(limit).toBeUndefined();
        visited.push(path);

        if (path === ROOT) {
          return {
            entries: [
              { kind: "directory", name: "src", path: `${ROOT}/src` },
              { kind: "directory", name: "node_modules", path: `${ROOT}/node_modules` },
              { kind: "file", name: "README.md", path: `${ROOT}/README.md`, size: 10 },
            ],
            inaccessibleEntries: 0,
            limited: false,
            path,
          } satisfies ComputerDirectoryListing;
        }

        if (path === `${ROOT}/src`) {
          return {
            entries: [
              { extension: "ts", kind: "file", name: "index.ts", path: `${path}/index.ts`, size: 42 },
              { kind: "directory", name: "nested", path: `${path}/nested` },
            ],
            inaccessibleEntries: 0,
            limited: false,
            parentPath: ROOT,
            path,
          } satisfies ComputerDirectoryListing;
        }

        if (path === `${ROOT}/node_modules`) {
          throw new Error("generated folder should be skipped");
        }

        return {
          entries: [{ extension: "tsx", kind: "file", name: "App.tsx", path: `${path}/App.tsx`, size: 84 }],
          inaccessibleEntries: 0,
          limited: false,
          parentPath: `${ROOT}/src`,
          path,
        } satisfies ComputerDirectoryListing;
      },
    });
    const tool = createFilesListTool(backend);
    const result = await tool.execute({ path: ROOT, recursive: true }, makeContext());

    expect(result.ok).toBe(true);
    expect(visited).toEqual([ROOT, `${ROOT}/src`, `${ROOT}/src/nested`]);
    expect(result.content).toContain(`${ROOT}/src/nested/App.tsx`);
    expect(result.content).not.toContain("node_modules");
    expect(result.content).toContain("Skipped 1 generated/cache directory");
    expect(result.data).toMatchObject({
      includeGenerated: false,
      limited: false,
      recursive: true,
      skippedDirectories: 1,
    });
  });

  it("can opt into generated directories for recursive listings", async () => {
    const visited: string[] = [];
    const backend = makeBackend({
      listDirectory: async (path) => {
        visited.push(path);

        if (path === ROOT) {
          return {
            entries: [
              { kind: "directory", name: "node_modules", path: `${ROOT}/node_modules` },
              { kind: "file", name: "README.md", path: `${ROOT}/README.md`, size: 10 },
            ],
            inaccessibleEntries: 0,
            limited: false,
            path,
          } satisfies ComputerDirectoryListing;
        }

        return {
          entries: [{ extension: "js", kind: "file", name: "package.js", path: `${path}/package.js`, size: 84 }],
          inaccessibleEntries: 0,
          limited: false,
          parentPath: ROOT,
          path,
        } satisfies ComputerDirectoryListing;
      },
    });
    const tool = createFilesListTool(backend);
    const result = await tool.execute({ includeGenerated: true, path: ROOT, recursive: true }, makeContext());

    expect(result.ok).toBe(true);
    expect(visited).toEqual([ROOT, `${ROOT}/node_modules`]);
    expect(result.content).toContain(`${ROOT}/node_modules/package.js`);
    expect(result.data).toMatchObject({
      includeGenerated: true,
      recursive: true,
      skippedDirectories: 0,
    });
  });

  it("rejects an external path before calling the backend", async () => {
    let called = false;
    const backend = makeBackend({
      listDirectory: async () => {
        called = true;
        return { entries: [], inaccessibleEntries: 0, limited: false, path: "" } satisfies ComputerDirectoryListing;
      },
    });
    const tool = createFilesListTool(backend);
    const result = await tool.execute({ path: "/somewhere/else" }, makeContext());

    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });
});

describe("files_read_many", () => {
  it("accepts common batch path aliases before validating read calls", async () => {
    const backend = makeBackend({
      readTextFile: async (path) => ({
        content: path.endsWith("a.ts") ? "alias a" : "alias b",
        extension: "ts",
        name: path.split("/").pop() ?? "file",
        path,
        size: path.length,
        truncated: false,
      } satisfies ComputerReadFileResult),
    });
    const registry = new ToolRegistry([createFilesReadManyTool(backend)]);

    const batch = await executeToolBridgeCalls({
      calls: [{ arguments: { filePaths: ["src/a.ts", "src/b.ts"] }, id: "call-alias-paths", name: "files_read_many", provider: "openai" }],
      context: makeContext(),
      registry,
    });

    expect(batch.toolCalls[0]?.status).toBe("complete");
    expect(batch.resultMessages[0]?.result.content).toContain("alias a");
    expect(batch.resultMessages[0]?.result.content).toContain("alias b");
  });

  it("repairs pathless batch read calls into workspace tree discovery instead of looping on validation", async () => {
    const backend = makeBackend({
      listDirectory: async (path) => ({
        entries: [
          { kind: "directory", name: "src", path: `${path}/src` },
          { extension: "json", kind: "file", name: "package.json", path: `${path}/package.json`, size: 100 },
        ],
        inaccessibleEntries: 0,
        limited: false,
        path,
      }),
    });
    const registry = new ToolRegistry([createFilesReadManyTool(backend), createFilesTreeSummaryTool(backend)]);

    const batch = await executeToolBridgeCalls({
      calls: [{ arguments: { paths: [] }, id: "call-missing-paths", name: "files_read_many", provider: "openai" }],
      context: makeContext(),
      registry,
    });

    expect(batch.toolCalls[0]?.toolId).toBe("files_tree_summary");
    expect(batch.toolCalls[0]?.status).toBe("complete");
    expect(batch.resultMessages[0]?.name).toBe("files_tree_summary");
    expect(batch.resultMessages[0]?.result.content).toContain("Workspace tree summary");
  });

  it("reads multiple files in order with full content by default", async () => {
    const observedMaxBytes: Array<number | undefined> = [];
    const backend = makeBackend({
      readTextFile: async (path, maxBytes) => {
        observedMaxBytes.push(maxBytes);
        return {
          content: path.endsWith("a.ts") ? "export const a = 1;" : "export const b = 2;",
          extension: "ts",
          name: path.split("/").pop() ?? "file",
          path,
          size: path.length,
          truncated: false,
        } satisfies ComputerReadFileResult;
      },
    });
    const tool = createFilesReadManyTool(backend);
    const result = await tool.execute({ paths: ["src/a.ts", "src/b.ts"] }, makeContext());

    expect(result.ok).toBe(true);
    expect(observedMaxBytes).toEqual([undefined, undefined]);
    expect(result.content).toContain(`${ROOT}/src/a.ts`);
    expect(result.content).toContain("export const a = 1;");
    expect(result.content).toContain(`${ROOT}/src/b.ts`);
    expect(result.content).toContain("export const b = 2;");
    expect(result.data).toMatchObject({
      failureCount: 0,
      requestedCount: 2,
      successCount: 2,
    });
  });

  it("returns structured per-file failures without aborting the whole batch", async () => {
    const backend = makeBackend({
      readTextFile: async (path) => {
        if (path.endsWith("missing.ts")) {
          throw new Error("file not found");
        }
        return {
          content: "ok",
          name: "ok.ts",
          path,
          size: 2,
          truncated: false,
        } satisfies ComputerReadFileResult;
      },
    });
    const tool = createFilesReadManyTool(backend);
    const result = await tool.execute({ paths: ["src/ok.ts", "src/missing.ts"] }, makeContext());
    const data = result.data as { files: Array<{ error?: string; ok: boolean; requestedPath: string }> };

    expect(result.ok).toBe(true);
    expect(data.files.map((file) => file.ok)).toEqual([true, false]);
    expect(data.files[1]?.error).toContain("file not found");
  });

  it("keeps per-file results when one batch read recovers a module entry", async () => {
    const requestedPath = `${ROOT}/src/toolBridge/adapters.ts`;
    const recoveredPath = `${ROOT}/src/toolBridge/adapters/index.ts`;
    const backend = makeBackend({
      listDirectory: async (path) => {
        if (path === `${ROOT}/src/toolBridge/adapters`) {
          return {
            entries: [{ extension: "ts", kind: "file", name: "index.ts", path: recoveredPath, size: 24 }],
            inaccessibleEntries: 0,
            limited: false,
            parentPath: `${ROOT}/src/toolBridge`,
            path,
          } satisfies ComputerDirectoryListing;
        }

        throw new Error("not a directory");
      },
      readTextFile: async (path) => {
        if (path === recoveredPath) {
          return {
            content: "export * from './responses';",
            extension: "ts",
            name: "index.ts",
            path,
            size: 26,
            truncated: false,
          } satisfies ComputerReadFileResult;
        }

        if (path === `${ROOT}/src/ok.ts`) {
          return {
            content: "export const ok = true;",
            extension: "ts",
            name: "ok.ts",
            path,
            size: 23,
            truncated: false,
          } satisfies ComputerReadFileResult;
        }

        expect(path).toBe(requestedPath);
        throw new Error("file not found");
      },
    });
    const tool = createFilesReadManyTool(backend);
    const result = await tool.execute({ paths: ["src/toolBridge/adapters.ts", "src/ok.ts"] }, makeContext());
    const data = result.data as { files: Array<{ ok: boolean; path?: string; recoveredFrom?: string }> };

    expect(result.ok).toBe(true);
    expect(result.content).toContain(`\`${recoveredPath}\` (recovered from \`${requestedPath}\`)`);
    expect(result.content).toContain("export * from './responses';");
    expect(data.files[0]).toMatchObject({ ok: true, path: recoveredPath, recoveredFrom: requestedPath });
    expect(data.files[1]).toMatchObject({ ok: true, path: `${ROOT}/src/ok.ts` });
  });
});

describe("files_read_range", () => {
  it("treats a path-only call as a full-file read instead of failing validation", async () => {
    const backend = makeBackend({
      readTextFile: async (path) => ({
        content: "one\ntwo\nthree\n",
        extension: "ts",
        name: "sample.ts",
        path,
        size: 14,
        truncated: false,
      }),
    });
    const tool = createFilesReadRangeTool(backend);
    const result = await tool.execute({ path: "src/sample.ts" }, makeContext());

    expect(result.ok).toBe(true);
    expect(result.content).toContain(`Read \`${ROOT}/src/sample.ts\` lines 1-3 of 3.`);
    expect(result.content).toContain("1: one\n2: two\n3: three");
    expect(result.data).toMatchObject({
      endLine: 3,
      requestedEndLine: null,
      requestedStartLine: null,
      startLine: 1,
      totalLines: 3,
    });
  });

  it("accepts snake_case line aliases from weaker tool callers", async () => {
    const backend = makeBackend({
      readTextFile: async (path) => ({
        content: "one\ntwo\nthree\nfour\n",
        extension: "ts",
        name: "sample.ts",
        path,
        size: 19,
        truncated: false,
      }),
    });
    const tool = createFilesReadRangeTool(backend);
    const result = await tool.execute({ end_line: 3, path: "src/sample.ts", start_line: 2 }, makeContext());

    expect(result.ok).toBe(true);
    expect(result.content).toContain("2: two\n3: three");
    expect(result.data).toMatchObject({
      endLine: 3,
      requestedEndLine: 3,
      requestedStartLine: 2,
      startLine: 2,
    });
  });

  it("reads an exact 1-based line range with line numbers by default", async () => {
    const backend = makeBackend({
      readTextFile: async (path) => ({
        content: "one\ntwo\nthree\nfour\n",
        extension: "ts",
        name: "sample.ts",
        path,
        size: 19,
        truncated: false,
      }),
    });
    const tool = createFilesReadRangeTool(backend);
    const result = await tool.execute({ endLine: 3, path: "src/sample.ts", startLine: 2 }, makeContext());

    expect(result.ok).toBe(true);
    expect(result.content).toContain(`Read \`${ROOT}/src/sample.ts\` lines 2-3 of 4.`);
    expect(result.content).toContain("2: two\n3: three");
    expect(result.data).toMatchObject({
      endLine: 3,
      includeLineNumbers: true,
      lineCount: 2,
      path: `${ROOT}/src/sample.ts`,
      startLine: 2,
      totalLines: 4,
    });
  });

  it("uses the native line-range backend without reading the whole file when available", async () => {
    let fullReadCalled = false;
    const backend = makeBackend({
      readTextFile: async () => {
        fullReadCalled = true;
        throw new Error("full read should not be used");
      },
      readTextFileRange: async (path, startLine, endLine) => ({
        content: "two\nthree",
        endLine,
        extension: "ts",
        lineCount: 2,
        name: "sample.ts",
        path,
        requestedEndLine: endLine,
        requestedStartLine: startLine,
        size: 19,
        startLine,
        totalLines: 4,
        truncated: true,
      }),
    });
    const tool = createFilesReadRangeTool(backend);
    const result = await tool.execute({ endLine: 3, path: "src/sample.ts", startLine: 2 }, makeContext());

    expect(result.ok).toBe(true);
    expect(fullReadCalled).toBe(false);
    expect(result.content).toContain("2: two\n3: three");
    expect(result.data).toMatchObject({
      source: "native-line-range",
      totalLines: 4,
    });
  });

  it("returns a clean error when the requested range starts past EOF", async () => {
    const backend = makeBackend({
      readTextFile: async (path) => ({
        content: "one\n",
        name: "sample.ts",
        path,
        size: 4,
        truncated: false,
      }),
    });
    const tool = createFilesReadRangeTool(backend);
    const result = await tool.execute({ endLine: 12, path: "src/sample.ts", startLine: 10 }, makeContext());

    expect(result.ok).toBe(false);
    expect(result.error).toContain("beyond the end");
  });

  it("recovers module entries before slicing an exact line range", async () => {
    const requestedPath = `${ROOT}/src/toolBridge/adapters.ts`;
    const recoveredPath = `${ROOT}/src/toolBridge/adapters/index.ts`;
    const backend = makeBackend({
      listDirectory: async (path) => {
        if (path === `${ROOT}/src/toolBridge/adapters`) {
          return {
            entries: [{ extension: "ts", kind: "file", name: "index.ts", path: recoveredPath, size: 64 }],
            inaccessibleEntries: 0,
            limited: false,
            parentPath: `${ROOT}/src/toolBridge`,
            path,
          } satisfies ComputerDirectoryListing;
        }

        throw new Error("not a directory");
      },
      readTextFile: async (path) => {
        if (path === recoveredPath) {
          return {
            content: "export { anthropicAdapter } from './anthropic';\nexport { responsesAdapter } from './responses';\n",
            extension: "ts",
            name: "index.ts",
            path,
            size: 88,
            truncated: false,
          } satisfies ComputerReadFileResult;
        }

        expect(path).toBe(requestedPath);
        throw new Error("file not found");
      },
    });
    const tool = createFilesReadRangeTool(backend);
    const result = await tool.execute({ endLine: 2, path: "src/toolBridge/adapters.ts", startLine: 2 }, makeContext());

    expect(result.ok).toBe(true);
    expect(result.content).toContain(`Recovered module entry \`${recoveredPath}\`.`);
    expect(result.content).toContain(`Read \`${recoveredPath}\` lines 2-2 of 2.`);
    expect(result.content).toContain("2: export { responsesAdapter } from './responses';");
    expect(result.data).toMatchObject({
      path: recoveredPath,
      recoveredFrom: requestedPath,
      startLine: 2,
    });
  });
});

describe("files_search", () => {
  it("uses the semantic file index for simple searches without walking and reading files", async () => {
    let listed = false;
    let read = false;
    let observedRoots: string[] | undefined;
    const indexedResult: ComputerSearchResult = {
      extension: "ts",
      kind: "file",
      line: 3,
      matchKind: "semantic",
      name: "registry.ts",
      path: `${ROOT}/src/toolBridge/registry.ts`,
      preview: "export function createToolRegistry() {}",
      score: 1.5,
      size: 120,
    };
    const backend = makeBackend({
      listDirectory: async () => {
        listed = true;
        throw new Error("files_search should not walk for indexed searches");
      },
      readTextFile: async () => {
        read = true;
        throw new Error("files_search should not read for indexed searches");
      },
      searchIndexedFiles: async (query, limit, roots) => {
        expect(query).toBe("tool registry");
        expect(limit).toBe(5);
        observedRoots = roots;
        return [indexedResult];
      },
    });
    const tool = createFilesSearchTool(backend);
    const result = await tool.execute({ maxMatches: 5, path: ROOT, query: "tool registry" }, makeContext());

    expect(result.ok).toBe(true);
    expect(listed).toBe(false);
    expect(read).toBe(false);
    expect(observedRoots).toEqual([ROOT]);
    expect(result.content).toContain("Searched semantic file index");
    expect(result.content).toContain(`${ROOT}/src/toolBridge/registry.ts`);
    expect(result.content).toContain("L3: export function createToolRegistry() {}");
    expect(result.data).toMatchObject({
      filesRead: 0,
      searchMode: "index",
      source: "semantic-index",
    });
  });

  it("bypasses the semantic index when searchMode is scan", async () => {
    let indexed = false;
    const backend = makeBackend({
      listDirectory: async (path) => ({
        entries: [{ extension: "ts", kind: "file", name: "scan.ts", path: `${path}/scan.ts`, size: 40 }],
        inaccessibleEntries: 0,
        limited: false,
        path,
      }),
      readTextFile: async (path) => ({
        content: "const needle = true;\n",
        extension: "ts",
        name: "scan.ts",
        path,
        size: 21,
        truncated: false,
      }),
      searchIndexedFiles: async () => {
        indexed = true;
        return [];
      },
    });
    const tool = createFilesSearchTool(backend);
    const result = await tool.execute({ path: ROOT, query: "needle", searchMode: "scan" }, makeContext());

    expect(result.ok).toBe(true);
    expect(indexed).toBe(false);
    expect(result.content).toContain("Scanned 1 file");
    expect(result.data).toMatchObject({
      filesRead: 1,
      searchMode: "scan",
      source: "workspace-scan",
    });
  });

  it("uses native exact text scan when the semantic index is bypassed", async () => {
    let listed = false;
    let read = false;
    let nativeCalled = false;
    const backend = makeBackend({
      listDirectory: async () => {
        listed = true;
        throw new Error("native scan should not walk through TypeScript");
      },
      readTextFile: async () => {
        read = true;
        throw new Error("native scan should not read through TypeScript");
      },
      searchTextFiles: async (request) => {
        nativeCalled = true;
        expect(request).toMatchObject({
          contextLines: 1,
          path: ROOT,
          query: "needle",
        });
        return {
          filesRead: 1,
          filesScanned: 1,
          filteredByGlob: 0,
          inaccessibleEntries: 0,
          limited: false,
          matches: [{
            contentMatches: [{
              after: [{ line: 3, preview: "after" }],
              before: [{ line: 1, preview: "before" }],
              line: 2,
              preview: "const needle = true;",
            }],
            extension: "ts",
            name: "scan.ts",
            path: `${ROOT}/scan.ts`,
            pathMatched: false,
            size: 64,
          }],
          scannedDirectories: 1,
          skippedDirectories: 0,
          skippedFiles: 0,
          totalContentMatches: 1,
          unreadableFiles: 0,
        };
      },
    });
    const tool = createFilesSearchTool(backend);
    const result = await tool.execute({ contextLines: 1, path: ROOT, query: "needle", searchMode: "scan" }, makeContext());

    expect(result.ok).toBe(true);
    expect(nativeCalled).toBe(true);
    expect(listed).toBe(false);
    expect(read).toBe(false);
    expect(result.content).toContain(`${ROOT}/scan.ts`);
    expect(result.content).toContain("L2: const needle = true;");
    expect(result.data).toMatchObject({
      source: "native-text-scan",
    });
  });

  it("keeps regex searches on the native scanner when available", async () => {
    let nativeCalled = false;
    const backend = makeBackend({
      listDirectory: async () => {
        throw new Error("regex search should not fall back to TypeScript walking");
      },
      readTextFile: async () => {
        throw new Error("regex search should not fall back to TypeScript reads");
      },
      searchTextFiles: async (request) => {
        nativeCalled = true;
        expect(request).toMatchObject({
          maxMatches: 120,
          maxMatchesPerFile: 20,
          path: ROOT,
          query: "Command::new|fs::remove",
          regex: true,
        });
        return {
          filesRead: 1,
          filesScanned: 1,
          filteredByGlob: 0,
          inaccessibleEntries: 0,
          limited: false,
          matches: [{
            contentMatches: [
              { line: 1, preview: "Command::new(\"git\");" },
              { line: 2, preview: "fs::remove_file(path)?;" },
            ],
            extension: "rs",
            name: "danger.rs",
            path: `${ROOT}/src/danger.rs`,
            pathMatched: false,
            size: 80,
          }],
          scannedDirectories: 2,
          skippedDirectories: 0,
          skippedFiles: 0,
          totalContentMatches: 2,
          unreadableFiles: 0,
        };
      },
    });
    const tool = createFilesSearchTool(backend);
    const result = await tool.execute({ path: ROOT, query: "Command::new|fs::remove", regex: true, searchMode: "scan" }, makeContext());

    expect(result.ok).toBe(true);
    expect(nativeCalled).toBe(true);
    expect(result.content).toContain(`${ROOT}/src/danger.rs`);
    expect(result.content).toContain("L1: Command::new");
  });

  it("returns a clear error when forced indexed search cannot honor exact scan options", async () => {
    const tool = createFilesSearchTool(makeBackend({
      searchIndexedFiles: async () => {
        throw new Error("should not call incompatible index search");
      },
    }));
    const result = await tool.execute({ path: ROOT, query: "needle", regex: true, searchMode: "index" }, makeContext());

    expect(result.ok).toBe(false);
    expect(result.error).toContain("regex");
    expect(result.error).toContain('searchMode "scan"');
  });

  it("finds content matches across text files and skips generated folders by default", async () => {
    const visited: string[] = [];
    const backend = makeBackend({
      listDirectory: async (path) => {
        visited.push(path);
        if (path === ROOT) {
          return {
            entries: [
              { kind: "directory", name: "src", path: `${ROOT}/src` },
              { kind: "directory", name: "node_modules", path: `${ROOT}/node_modules` },
              { extension: "md", kind: "file", name: "README.md", path: `${ROOT}/README.md`, size: 30 },
            ],
            inaccessibleEntries: 0,
            limited: false,
            path,
          } satisfies ComputerDirectoryListing;
        }

        if (path === `${ROOT}/src`) {
          return {
            entries: [
              { extension: "ts", kind: "file", name: "tools.ts", path: `${path}/tools.ts`, size: 100 },
              { extension: "png", kind: "file", name: "logo.png", path: `${path}/logo.png`, size: 1000 },
            ],
            inaccessibleEntries: 0,
            limited: false,
            parentPath: ROOT,
            path,
          } satisfies ComputerDirectoryListing;
        }

        throw new Error("generated folder should be skipped");
      },
      readTextFile: async (path) => ({
        content: path.endsWith("tools.ts")
          ? "export function createToolRegistry() {}\nconst needle = true;\n"
          : "# Project\nNo match here\n",
        extension: path.endsWith(".ts") ? "ts" : "md",
        name: path.split("/").pop() ?? "file",
        path,
        size: 20,
        truncated: false,
      }),
    });
    const tool = createFilesSearchTool(backend);
    const result = await tool.execute({ path: ROOT, query: "needle" }, makeContext());

    expect(result.ok).toBe(true);
    expect(visited).toEqual([ROOT, `${ROOT}/src`]);
    expect(result.content).toContain(`${ROOT}/src/tools.ts`);
    expect(result.content).toContain("L2: const needle = true;");
    expect(result.data).toMatchObject({
      filesRead: 2,
      filesScanned: 3,
      skippedDirectories: 1,
    });
  });

  it("finds path matches without reading file contents when includeContent is false", async () => {
    let readCalled = false;
    const backend = makeBackend({
      listDirectory: async (path) => ({
        entries: [
          { extension: "ts", kind: "file", name: "permissions.ts", path: `${path}/permissions.ts`, size: 10 },
          { extension: "ts", kind: "file", name: "registry.ts", path: `${path}/registry.ts`, size: 10 },
        ],
        inaccessibleEntries: 0,
        limited: false,
        path,
      }),
      readTextFile: async (path) => {
        readCalled = true;
        return {
          content: "",
          name: "unexpected",
          path,
          size: 0,
          truncated: false,
        } satisfies ComputerReadFileResult;
      },
    });
    const tool = createFilesSearchTool(backend);
    const result = await tool.execute({ includeContent: false, path: ROOT, query: "permissions" }, makeContext());

    expect(result.ok).toBe(true);
    expect(readCalled).toBe(false);
    expect(result.content).toContain(`\`${ROOT}/permissions.ts\` (path match)`);
    expect(result.content).not.toContain(`${ROOT}/registry.ts`);
  });

  it("includes requested context lines around content matches", async () => {
    const backend = makeBackend({
      listDirectory: async (path) => ({
        entries: [{ extension: "ts", kind: "file", name: "context.ts", path: `${path}/context.ts`, size: 80 }],
        inaccessibleEntries: 0,
        limited: false,
        path,
      }),
      readTextFile: async (path) => ({
        content: "alpha\nbefore\nconst needle = true;\nafter\nomega\n",
        extension: "ts",
        name: "context.ts",
        path,
        size: 46,
        truncated: false,
      }),
    });
    const tool = createFilesSearchTool(backend);
    const result = await tool.execute({ contextLines: 1, path: ROOT, query: "needle" }, makeContext());

    expect(result.ok).toBe(true);
    expect(result.content).toContain("L2: before");
    expect(result.content).toContain("L3: const needle = true;");
    expect(result.content).toContain("L4: after");
    expect(result.data).toMatchObject({
      filesRead: 1,
      filesScanned: 1,
      totalContentMatches: 1,
    });
  });

  it("filters candidate files by glob before reading content", async () => {
    const readPaths: string[] = [];
    const backend = makeBackend({
      listDirectory: async (path) => ({
        entries: [
          { extension: "tsx", kind: "file", name: "App.tsx", path: `${path}/App.tsx`, size: 80 },
          { extension: "ts", kind: "file", name: "index.ts", path: `${path}/index.ts`, size: 80 },
        ],
        inaccessibleEntries: 0,
        limited: false,
        path,
      }),
      readTextFile: async (path) => {
        readPaths.push(path);
        return {
          content: "needle\n",
          extension: path.endsWith(".tsx") ? "tsx" : "ts",
          name: path.split("/").pop() ?? "file",
          path,
          size: 7,
          truncated: false,
        };
      },
    });
    const tool = createFilesSearchTool(backend);
    const result = await tool.execute({ glob: "**/*.tsx", path: ROOT, query: "needle" }, makeContext());

    expect(result.ok).toBe(true);
    expect(readPaths).toEqual([`${ROOT}/App.tsx`]);
    expect(result.content).toContain("Filtered 1 file by glob.");
    expect(result.content).toContain(`${ROOT}/App.tsx`);
    expect(result.content).not.toContain(`${ROOT}/index.ts`);
    expect(result.data).toMatchObject({
      filteredByGlob: 1,
      filesScanned: 1,
    });
  });

  it("ranks path and name matches before lower-signal content-only matches", async () => {
    const backend = makeBackend({
      listDirectory: async (path) => ({
        entries: [
          { extension: "ts", kind: "file", name: "permissions.ts", path: `${path}/src/toolBridge/permissions.ts`, size: 80 },
          { extension: "md", kind: "file", name: "notes.md", path: `${path}/docs/notes.md`, size: 80 },
        ],
        inaccessibleEntries: 0,
        limited: false,
        path,
      }),
      readTextFile: async (path) => ({
        content: path.endsWith("notes.md")
          ? "permissions permissions permissions permissions permissions\n"
          : "export const allowed = true;\n",
        extension: path.endsWith(".ts") ? "ts" : "md",
        name: path.split("/").pop() ?? "file",
        path,
        size: 40,
        truncated: false,
      }),
    });
    const tool = createFilesSearchTool(backend);
    const result = await tool.execute({ path: ROOT, query: "permissions" }, makeContext());
    const data = result.data as { matches: Array<{ path: string }> };

    expect(result.ok).toBe(true);
    expect(data.matches.map((match) => match.path)).toEqual([
      `${ROOT}/src/toolBridge/permissions.ts`,
      `${ROOT}/docs/notes.md`,
    ]);
  });
});

describe("files_tree_summary", () => {
  it("summarizes a source tree while skipping generated folders by default", async () => {
    const visited: string[] = [];
    const backend = makeBackend({
      listDirectory: async (path) => {
        visited.push(path);

        if (path === ROOT) {
          return {
            entries: [
              { kind: "directory", name: "src", path: `${ROOT}/src` },
              { kind: "directory", name: "node_modules", path: `${ROOT}/node_modules` },
              { extension: "md", kind: "file", name: "README.md", path: `${ROOT}/README.md`, size: 20 },
            ],
            inaccessibleEntries: 0,
            limited: false,
            path,
          } satisfies ComputerDirectoryListing;
        }

        if (path === `${ROOT}/src`) {
          return {
            entries: [
              { kind: "directory", name: "components", path: `${path}/components` },
              { extension: "ts", kind: "file", name: "index.ts", path: `${path}/index.ts`, size: 20 },
            ],
            inaccessibleEntries: 0,
            limited: false,
            parentPath: ROOT,
            path,
          } satisfies ComputerDirectoryListing;
        }

        if (path === `${ROOT}/src/components`) {
          return {
            entries: [{ extension: "tsx", kind: "file", name: "Button.tsx", path: `${path}/Button.tsx`, size: 20 }],
            inaccessibleEntries: 0,
            limited: false,
            parentPath: `${ROOT}/src`,
            path,
          } satisfies ComputerDirectoryListing;
        }

        throw new Error("generated folder should be skipped");
      },
    });
    const tool = createFilesTreeSummaryTool(backend);
    const result = await tool.execute({ path: ROOT }, makeContext());

    expect(result.ok).toBe(true);
    expect(visited).toEqual([ROOT, `${ROOT}/src`, `${ROOT}/src/components`]);
    expect(result.content).toContain("Workspace tree summary");
    expect(result.content).toContain("Skipped 1 generated/cache directory");
    expect(result.content).toContain("Top file types: md 1; ts 1; tsx 1.");
    expect(result.content).toContain("src/");
    expect(result.content).toContain("components/");
    expect(result.content).not.toContain("node_modules/");
    expect(result.data).toMatchObject({
      directoryCount: 3,
      fileCount: 3,
      includeGenerated: false,
      skippedDirectories: 1,
    });
  });

  it("can opt into generated folders when explicitly requested", async () => {
    const visited: string[] = [];
    const backend = makeBackend({
      listDirectory: async (path) => {
        visited.push(path);

        if (path === ROOT) {
          return {
            entries: [
              { kind: "directory", name: "node_modules", path: `${ROOT}/node_modules` },
              { extension: "md", kind: "file", name: "README.md", path: `${ROOT}/README.md`, size: 20 },
            ],
            inaccessibleEntries: 0,
            limited: false,
            path,
          } satisfies ComputerDirectoryListing;
        }

        return {
          entries: [{ extension: "js", kind: "file", name: "package.js", path: `${path}/package.js`, size: 20 }],
          inaccessibleEntries: 0,
          limited: false,
          parentPath: ROOT,
          path,
        } satisfies ComputerDirectoryListing;
      },
    });
    const tool = createFilesTreeSummaryTool(backend);
    const result = await tool.execute({ includeGenerated: true, path: ROOT }, makeContext());

    expect(result.ok).toBe(true);
    expect(visited).toEqual([ROOT, `${ROOT}/node_modules`]);
    expect(result.content).toContain("node_modules/");
    expect(result.data).toMatchObject({
      directoryCount: 2,
      includeGenerated: true,
      skippedDirectories: 0,
    });
  });
});

describe("files_stat", () => {
  it("identifies a directory when listing succeeds", async () => {
    const backend = makeBackend({
      listDirectory: async (path) => ({
        entries: [],
        inaccessibleEntries: 0,
        limited: false,
        parentPath: ROOT,
        path,
      }),
    });
    const tool = createFilesStatTool(backend);
    const result = await tool.execute({ path: "src" }, makeContext());

    expect(result.ok).toBe(true);
    expect((result.data as { kind: string }).kind).toBe("directory");
  });

  it("falls back to a file probe when listing throws", async () => {
    const backend = makeBackend({
      listDirectory: async () => {
        throw new Error("not a directory");
      },
      readTextFile: async (path) => ({
        content: "h",
        extension: "ts",
        modifiedAt: 5,
        name: "foo.ts",
        path,
        size: 1024,
        truncated: true,
      }),
    });
    const tool = createFilesStatTool(backend);
    const result = await tool.execute({ path: "src/foo.ts" }, makeContext());

    expect(result.ok).toBe(true);
    const data = result.data as { kind: string; size: number };
    expect(data.kind).toBe("file");
    expect(data.size).toBe(1024);
  });

  it("reports missing when both probes fail", async () => {
    const backend = makeBackend({
      listDirectory: async () => {
        throw new Error("not a directory");
      },
      readTextFile: async () => {
        throw new Error("file not found");
      },
    });
    const tool = createFilesStatTool(backend);
    const result = await tool.execute({ path: "src/missing.txt" }, makeContext());

    expect(result.ok).toBe(false);
    expect((result.data as { kind: string }).kind).toBe("missing");
    expect(result.error).toContain("not a directory");
    expect(result.error).toContain("file not found");
  });
});

describe("files_count_lines", () => {
  it("counts source lines recursively without returning file contents", async () => {
    const backend = makeBackend({
      listDirectory: async (path) => {
        if (path === ROOT) {
          return {
            entries: [
              { kind: "directory", name: "src", path: `${ROOT}/src` },
              { kind: "directory", name: "node_modules", path: `${ROOT}/node_modules` },
              { extension: "md", kind: "file", name: "README.md", path: `${ROOT}/README.md`, size: 20 },
            ],
            inaccessibleEntries: 0,
            limited: false,
            path,
          } satisfies ComputerDirectoryListing;
        }

        if (path === `${ROOT}/src`) {
          return {
            entries: [
              { extension: "ts", kind: "file", name: "index.ts", path: `${path}/index.ts`, size: 30 },
              { extension: "tsx", kind: "file", name: "App.tsx", path: `${path}/App.tsx`, size: 20 },
            ],
            inaccessibleEntries: 0,
            limited: false,
            parentPath: ROOT,
            path,
          } satisfies ComputerDirectoryListing;
        }

        throw new Error("unexpected directory");
      },
      readTextFile: async (path) => {
        const content = path.endsWith("index.ts")
          ? "const a = 1;\n\nexport { a };\n"
          : "export function App() {\n  return null;\n}";
        return {
          content,
          extension: path.endsWith("index.ts") ? "ts" : "tsx",
          name: path.split("/").pop() ?? "file",
          path,
          size: content.length,
          truncated: false,
        } satisfies ComputerReadFileResult;
      },
    });
    const tool = createFilesCountLinesTool(backend);
    const result = await tool.execute({ path: ROOT }, makeContext());

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Counted 6 lines across 2 source files");
    expect(result.content).not.toContain("export function App");
    expect(result.data).toMatchObject({
      files: 2,
      lines: 6,
      skippedDirectories: 1,
    });
  });

  it("can exclude blank lines from the count", async () => {
    const backend = makeBackend({
      listDirectory: async (path) => ({
        entries: [{ extension: "ts", kind: "file", name: "index.ts", path: `${path}/index.ts`, size: 20 }],
        inaccessibleEntries: 0,
        limited: false,
        path,
      }),
      readTextFile: async (path) => ({
        content: "one\n\nthree\n",
        extension: "ts",
        name: "index.ts",
        path,
        size: 11,
        truncated: false,
      }),
    });
    const tool = createFilesCountLinesTool(backend);
    const result = await tool.execute({ includeBlankLines: false, path: ROOT }, makeContext());

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      blankLines: 1,
      lines: 2,
    });
  });
});

describe("files family permission gating", () => {
  it("allows read-only execution in default permission mode", async () => {
    const tool = createFilesReadTool(makeBackend({
      readTextFile: async (path) => ({
        content: "ok",
        name: "README.md",
        path,
        size: 2,
        truncated: false,
      }),
    }));
    const registry = new ToolRegistry([tool]);

    const batch = await executeToolBridgeCalls({
      calls: [{ arguments: { path: "README.md" }, id: "call", name: "files_read", provider: "openai" }],
      context: makeContext({ permissionMode: "default" }),
      registry,
    });

    expect(batch.toolCalls[0]?.status).toBe("complete");
    expect(batch.resultMessages[0]?.result.content).toBe("ok");
  });

  it("executes common read aliases through the canonical file tool", async () => {
    const tool = createFilesReadTool(makeBackend({
      readTextFile: async (path) => ({
        content: "alias ok",
        name: "PROGRESS.md",
        path,
        size: 8,
        truncated: false,
      }),
    }));
    const registry = new ToolRegistry([tool]);

    const batch = await executeToolBridgeCalls({
      calls: [{ arguments: { path: "PROGRESS.md" }, id: "call-read", name: "read", provider: "openai" }],
      context: makeContext({ permissionMode: "default" }),
      registry,
    });

    expect(batch.toolCalls[0]?.status).toBe("complete");
    expect(batch.toolCalls[0]?.label).toBe("Read workspace file");
    expect(batch.resultMessages[0]?.result.content).toBe("alias ok");
  });

  it("executes grep aliases through the canonical search tool", async () => {
    const backend = makeBackend({
      listDirectory: async (path) => ({
        entries: [{ extension: "md", kind: "file", name: "PROGRESS.md", path: `${path}/PROGRESS.md`, size: 40 }],
        inaccessibleEntries: 0,
        limited: false,
        path,
      }),
      readTextFile: async (path) => ({
        content: "Search needle\n",
        extension: "md",
        name: "PROGRESS.md",
        path,
        size: 14,
        truncated: false,
      }),
    });
    const registry = new ToolRegistry([createFilesSearchTool(backend)]);

    const batch = await executeToolBridgeCalls({
      calls: [{ arguments: { path: ROOT, query: "needle" }, id: "call-grep", name: "grep", provider: "openai" }],
      context: makeContext({ permissionMode: "default" }),
      registry,
    });

    expect(batch.toolCalls[0]?.status).toBe("complete");
    expect(batch.toolCalls[0]?.label).toBe("Search workspace files");
    expect(batch.resultMessages[0]?.result.content).toContain("Found 1 matching file");
  });

  it("auto-allows read-only execution in auto-review mode", async () => {
    const tool = createFilesReadTool(makeBackend({
      readTextFile: async (path) => ({
        content: "ok",
        name: "x",
        path,
        size: 2,
        truncated: false,
      }),
    }));
    const registry = new ToolRegistry([tool]);

    const batch = await executeToolBridgeCalls({
      calls: [{ arguments: { path: "x.txt" }, id: "call", name: "files_read", provider: "openai" }],
      context: makeContext({ permissionMode: "auto-review" }),
      registry,
    });

    expect(batch.toolCalls[0]?.status).toBe("complete");
  });
});
