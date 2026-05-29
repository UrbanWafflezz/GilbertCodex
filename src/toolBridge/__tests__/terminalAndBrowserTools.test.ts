import { describe, expect, it, vi } from "vitest";
import { executeToolBridgeCalls, resolveToolPermission, ToolRegistry } from "../index";
import {
  createBrowserConsoleReadTool,
  createBrowserPreviewTool,
  createBrowserScreenshotCaptureTool,
  createTerminalDevServerStatusTool,
  createTerminalListSessionsTool,
  createTerminalReadSessionTool,
  createTerminalRunTool,
  createWebSearchTool,
  type BrowserPreviewBackend,
  type TerminalBackend,
  type WebSearchToolBackend,
} from "../index";
import type {
  TerminalCreateSessionRequest,
  TerminalCreateSessionResponse,
  TerminalDrainResponse,
  TerminalRunCommandRequest,
  TerminalRunCommandResponse,
  TerminalShellId,
} from "../../types/terminal";
import type { ToolExecutionContext } from "../types";

const ROOT = "/workspace/project";
const TEST_PROCESS_PLATFORM = (globalThis as { process?: { platform?: unknown } }).process?.platform;
const HOST_DEFAULT_TERMINAL_SHELL: TerminalShellId | undefined = TEST_PROCESS_PLATFORM === "win32" ? "powershell" : undefined;

function makeContext(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    model: "test-model",
    permissionMode: "default",
    provider: "openai",
    workspaceRoots: [ROOT],
    ...overrides,
  };
}

function makeTerminalBackend(overrides: Partial<TerminalBackend> = {}): TerminalBackend {
  return {
    createSession: overrides.createSession ?? (async (request: TerminalCreateSessionRequest): Promise<TerminalCreateSessionResponse> => ({
      initialOutput: [],
      sessionId: "terminal-1",
      shell: request.shell ?? "powershell",
      startedAt: 1_700_000_000_000,
      workingDirectory: request.workingDirectory ?? ROOT,
    })),
    drainSession: overrides.drainSession ?? (async (): Promise<TerminalDrainResponse> => ({
      chunks: [],
      commandRunning: false,
      lastCommandCompleted: true,
      lastCommandExitCode: 0,
      workingDirectory: ROOT,
    })),
    isAvailable: overrides.isAvailable ?? (() => true),
    listBackgroundSessions: overrides.listBackgroundSessions ?? (() => []),
    probeUrl: overrides.probeUrl,
    recordBackgroundSessionOutput: overrides.recordBackgroundSessionOutput ?? vi.fn(),
    registerBackgroundSession: overrides.registerBackgroundSession ?? vi.fn(),
    runCommand: overrides.runCommand ?? (async (request: TerminalRunCommandRequest): Promise<TerminalRunCommandResponse> => ({
      durationMs: 12,
      exitCode: 0,
      outputTruncated: false,
      shell: request.shell ?? "powershell",
      stderr: "",
      stdout: "ok\n",
      timedOut: false,
      workingDirectory: request.workingDirectory ?? ROOT,
    })),
    unregisterBackgroundSession: overrides.unregisterBackgroundSession ?? vi.fn(),
    updateBackgroundSession: overrides.updateBackgroundSession ?? vi.fn(),
    writeSession: overrides.writeSession ?? vi.fn(),
  };
}

describe("terminal_run", () => {
  it("runs without approval in full-access mode", () => {
    const tool = createTerminalRunTool(makeTerminalBackend());

    expect(resolveToolPermission(tool, makeContext({ permissionMode: "full-access" }))).toMatchObject({
      allowed: true,
      requiresApproval: false,
    });
  });

  it("runs a buffered command with cwd, timeout, output, and terminal metadata after approval", async () => {
    const runCommand = vi.fn(makeTerminalBackend().runCommand);
    const tool = createTerminalRunTool(makeTerminalBackend({ runCommand }));
    const registry = new ToolRegistry([tool]);

    const batch = await executeToolBridgeCalls({
      approval: async () => ({ approved: true }),
      calls: [
        {
          arguments: { command: "npm test", cwd: ".", timeoutMs: 3000 },
          id: "call-terminal",
          name: "terminal_run",
          provider: "openai",
        },
      ],
      context: makeContext(),
      registry,
    });

    expect(runCommand).toHaveBeenCalledWith({
      command: "npm test",
      shell: HOST_DEFAULT_TERMINAL_SHELL,
      timeoutMs: 3000,
      workingDirectory: ROOT,
    });
    expect(batch.toolCalls[0]).toMatchObject({
      status: "complete",
      terminal: {
        command: "npm test",
        exitCode: 0,
        live: false,
        workingDirectory: ROOT,
      },
    });
    expect(batch.resultMessages[0]?.result.content).toContain("Exit code: 0");
  });

  it("accepts provider-wrapped terminal arguments before validation", async () => {
    const runCommand = vi.fn(makeTerminalBackend().runCommand);
    const tool = createTerminalRunTool(makeTerminalBackend({ runCommand }));
    const registry = new ToolRegistry([tool]);

    const batch = await executeToolBridgeCalls({
      approval: async () => ({ approved: true }),
      calls: [
        {
          arguments: {
            arguments: {
              command_line: "npm.cmd run build",
              timeout_ms: "120000",
              working_directory: ".",
            },
          },
          id: "call-terminal-wrapped",
          name: "terminal_run",
          provider: "openai",
        },
      ],
      context: makeContext(),
      registry,
    });

    expect(runCommand).toHaveBeenCalledWith({
      command: "npm.cmd run build",
      shell: HOST_DEFAULT_TERMINAL_SHELL,
      timeoutMs: 120_000,
      workingDirectory: ROOT,
    });
    expect(batch.toolCalls[0]).toMatchObject({
      status: "complete",
      terminal: {
        command: "npm.cmd run build",
        workingDirectory: ROOT,
      },
    });
    expect(batch.resultMessages[0]?.result.error).toBeUndefined();
  });

  it("accepts terminal command strings in provider argument envelopes", async () => {
    const runCommand = vi.fn(makeTerminalBackend().runCommand);
    const tool = createTerminalRunTool(makeTerminalBackend({ runCommand }));
    const registry = new ToolRegistry([tool]);

    const batch = await executeToolBridgeCalls({
      approval: async () => ({ approved: true }),
      calls: [
        {
          arguments: {
            arguments: "npm.cmd install",
            working_directory: ".",
          },
          id: "call-terminal-string-envelope",
          name: "terminal_run",
          provider: "openai",
        },
      ],
      context: makeContext(),
      registry,
    });

    expect(runCommand).toHaveBeenCalledWith({
      command: "npm.cmd install",
      shell: HOST_DEFAULT_TERMINAL_SHELL,
      timeoutMs: 45_000,
      workingDirectory: ROOT,
    });
    expect(batch.toolCalls[0]).toMatchObject({
      status: "complete",
      terminal: {
        command: "npm.cmd install",
        workingDirectory: ROOT,
      },
    });
    expect(batch.resultMessages[0]?.result.error).toBeUndefined();
  });

  it("accepts direct string terminal arguments as the command", async () => {
    const runCommand = vi.fn(makeTerminalBackend().runCommand);
    const tool = createTerminalRunTool(makeTerminalBackend({ runCommand }));
    const registry = new ToolRegistry([tool]);

    const batch = await executeToolBridgeCalls({
      approval: async () => ({ approved: true }),
      calls: [
        {
          arguments: "npm.cmd run build",
          id: "call-terminal-direct-string",
          name: "terminal_run",
          provider: "openai",
        },
      ],
      context: makeContext(),
      registry,
    });

    expect(runCommand).toHaveBeenCalledWith({
      command: "npm.cmd run build",
      shell: HOST_DEFAULT_TERMINAL_SHELL,
      timeoutMs: 45_000,
      workingDirectory: ROOT,
    });
    expect(batch.toolCalls[0]).toMatchObject({
      status: "complete",
      terminal: {
        command: "npm.cmd run build",
        workingDirectory: ROOT,
      },
    });
    expect(batch.resultMessages[0]?.result.error).toBeUndefined();
  });

  it("accepts deeply nested terminal argument envelopes", async () => {
    const runCommand = vi.fn(makeTerminalBackend().runCommand);
    const tool = createTerminalRunTool(makeTerminalBackend({ runCommand }));
    const registry = new ToolRegistry([tool]);

    const batch = await executeToolBridgeCalls({
      approval: async () => ({ approved: true }),
      calls: [
        {
          arguments: {
            arguments: {
              input: {
                function: {
                  parameters: {
                    command_line: "npm.cmd run build",
                    timeout_ms: "120000",
                    working_directory: ".",
                  },
                },
              },
            },
          },
          id: "call-terminal-deep-envelope",
          name: "terminal_run",
          provider: "openai",
        },
      ],
      context: makeContext(),
      registry,
    });

    expect(runCommand).toHaveBeenCalledWith({
      command: "npm.cmd run build",
      shell: HOST_DEFAULT_TERMINAL_SHELL,
      timeoutMs: 120_000,
      workingDirectory: ROOT,
    });
    expect(batch.resultMessages[0]?.result.error).toBeUndefined();
  });

  it("accepts terminal program/args and commands-array shapes", async () => {
    const runCommand = vi.fn(makeTerminalBackend().runCommand);
    const tool = createTerminalRunTool(makeTerminalBackend({ runCommand }));
    const registry = new ToolRegistry([tool]);

    const batch = await executeToolBridgeCalls({
      approval: async () => ({ approved: true }),
      calls: [
        {
          arguments: { args: ["run", "build"], program: "npm.cmd", workingDir: "." },
          id: "call-terminal-program-args",
          name: "terminal_run",
          provider: "openai",
        },
        {
          arguments: { commands: ["npm.cmd install", "npm.cmd run build"], shell: "powershell", working_directory: "." },
          id: "call-terminal-commands-array",
          name: "terminal_run",
          provider: "openai",
        },
      ],
      context: makeContext(),
      registry,
    });

    expect(runCommand).toHaveBeenNthCalledWith(1, {
      command: "npm.cmd run build",
      shell: HOST_DEFAULT_TERMINAL_SHELL,
      timeoutMs: 45_000,
      workingDirectory: ROOT,
    });
    expect(runCommand).toHaveBeenNthCalledWith(2, {
      command: "npm.cmd install; npm.cmd run build",
      shell: "powershell",
      timeoutMs: 45_000,
      workingDirectory: ROOT,
    });
    expect(batch.resultMessages.every((message) => message.result.error === undefined)).toBe(true);
  });

  it("normalizes a leading cd wrapper into cwd before running the terminal command", async () => {
    const runCommand = vi.fn(makeTerminalBackend().runCommand);
    const tool = createTerminalRunTool(makeTerminalBackend({ runCommand }));
    const registry = new ToolRegistry([tool]);

    const batch = await executeToolBridgeCalls({
      approval: async () => ({ approved: true }),
      calls: [
        {
          arguments: {
            command: 'cd "/workspace/project/chatgpt-mobile-app" && npm create vite@latest . -- --template react',
            workingDirectory: ROOT,
          },
          id: "call-terminal",
          name: "terminal_run",
          provider: "openai",
        },
      ],
      context: makeContext(),
      registry,
    });

    expect(runCommand).toHaveBeenCalledWith({
      command: "npm create vite@latest . -- --template react",
      shell: HOST_DEFAULT_TERMINAL_SHELL,
      timeoutMs: 45_000,
      workingDirectory: "/workspace/project/chatgpt-mobile-app",
    });
    expect(batch.toolCalls[0]).toMatchObject({
      status: "complete",
      terminal: {
        command: "npm create vite@latest . -- --template react",
        workingDirectory: "/workspace/project/chatgpt-mobile-app",
      },
    });
  });

  it("normalizes common Unix mkdir and ls commands before sending them to PowerShell", async () => {
    const runCommand = vi.fn(makeTerminalBackend().runCommand);
    const tool = createTerminalRunTool(makeTerminalBackend({ runCommand }));
    const registry = new ToolRegistry([tool]);

    await executeToolBridgeCalls({
      approval: async () => ({ approved: true }),
      calls: [
        {
          arguments: {
            command: 'mkdir -p "/workspace/project/src"; ls -la "/workspace/project/src"',
            cwd: ".",
            shell: "powershell",
          },
          id: "call-terminal",
          name: "terminal_run",
          provider: "openai",
        },
      ],
      context: makeContext(),
      registry,
    });

    expect(runCommand).toHaveBeenCalledWith({
      command: "New-Item -ItemType Directory -Force -Path '/workspace/project/src' | Out-Null; Get-ChildItem -Force -LiteralPath '/workspace/project/src'",
      shell: "powershell",
      timeoutMs: 45_000,
      workingDirectory: ROOT,
    });
  });

  it("normalizes common Unix mkdir, ls, and wc commands before sending them to Command Prompt", async () => {
    const runCommand = vi.fn(makeTerminalBackend().runCommand);
    const tool = createTerminalRunTool(makeTerminalBackend({ runCommand }));
    const registry = new ToolRegistry([tool]);

    await executeToolBridgeCalls({
      approval: async () => ({ approved: true }),
      calls: [
        {
          arguments: {
            command: 'mkdir -p "src"; ls -la "src"; wc -l "src/index.ts"',
            cwd: ".",
            shell: "cmd",
          },
          id: "call-terminal",
          name: "terminal_run",
          provider: "openai",
        },
      ],
      context: makeContext(),
      registry,
    });

    expect(runCommand).toHaveBeenCalledWith({
      command: 'if not exist "src" mkdir "src" && dir /a "src" && find /c /v "" "src/index.ts"',
      shell: "cmd",
      timeoutMs: 45_000,
      workingDirectory: ROOT,
    });
  });

  it("uses the configured terminal shell when the model does not pass a shell override", async () => {
    const runCommand = vi.fn(makeTerminalBackend().runCommand);
    const tool = createTerminalRunTool(makeTerminalBackend({ runCommand }));

    const result = await tool.execute({
      command: "echo hello",
      cwd: ".",
    }, makeContext({ terminalDefaultShell: "cmd" }));

    expect(result.ok).toBe(true);
    expect(runCommand).toHaveBeenCalledWith(expect.objectContaining({
      shell: "cmd",
    }));
  });

  it("switches an unqualified cmd default to PowerShell when the command is PowerShell-specific", async () => {
    const runCommand = vi.fn(makeTerminalBackend().runCommand);
    const tool = createTerminalRunTool(makeTerminalBackend({ runCommand }));

    const result = await tool.execute({
      command: "$env:PORT=4000; npm run dev",
      cwd: ".",
    }, makeContext({ terminalDefaultShell: "cmd" }));

    expect(result.ok).toBe(true);
    expect(runCommand).toHaveBeenCalledWith(expect.objectContaining({
      command: "$env:PORT=4000; npm run dev",
      shell: "powershell",
    }));
  });

  it("routes terminal commands to WSL when the agent environment is WSL", async () => {
    const runCommand = vi.fn(makeTerminalBackend().runCommand);
    const tool = createTerminalRunTool(makeTerminalBackend({ runCommand }));

    const result = await tool.execute({
      command: "printf hello",
      cwd: ".",
    }, makeContext({
      agentEnvironment: "wsl",
      terminalDefaultShell: "powershell",
    }));

    expect(result.ok).toBe(true);
    expect(runCommand).toHaveBeenCalledWith(expect.objectContaining({
      shell: "wsl",
    }));
  });

  it("auto-detects WSL for WSL workspace roots", async () => {
    const runCommand = vi.fn(makeTerminalBackend().runCommand);
    const tool = createTerminalRunTool(makeTerminalBackend({ runCommand }));

    const result = await tool.execute({
      command: "printf hello",
      cwd: ".",
    }, makeContext({
      agentEnvironment: "auto",
      terminalDefaultShell: "powershell",
      workspaceRoots: [ROOT, String.raw`\\wsl$\Ubuntu\home\kobe\repo`],
    }));

    expect(result.ok).toBe(true);
    expect(runCommand).toHaveBeenCalledWith(expect.objectContaining({
      shell: "wsl",
    }));
  });

  it("blocks Unix wc line-count commands in PowerShell before running them", async () => {
    const runCommand = vi.fn(makeTerminalBackend().runCommand);
    const tool = createTerminalRunTool(makeTerminalBackend({ runCommand }));
    const result = await tool.execute({
      command: "wc -l src\\services\\database.js",
      cwd: ".",
      shell: "powershell",
    }, makeContext());

    expect(result.ok).toBe(false);
    expect(result.content).toContain("did not execute");
    expect(result.content).toContain("files_count_lines");
    expect(result.content).toContain("Measure-Object -Line");
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("allows wc when the caller explicitly selects a Unix shell", async () => {
    const runCommand = vi.fn(makeTerminalBackend().runCommand);
    const tool = createTerminalRunTool(makeTerminalBackend({ runCommand }));
    const result = await tool.execute({
      command: "wc -l src/services/database.js",
      cwd: ".",
      shell: "bash",
    }, makeContext());

    expect(result.ok).toBe(true);
    expect(runCommand).toHaveBeenCalledWith(expect.objectContaining({
      command: "wc -l src/services/database.js",
      shell: "bash",
    }));
  });

  it("creates a background terminal session and normalizes detected localhost preview URLs", async () => {
    const registerBackgroundSession = vi.fn();
    const backend = makeTerminalBackend({
      drainSession: async () => ({
        chunks: [{
          id: "chunk-1",
          stream: "stdout",
          text: "Vite ready at http://127.0.0.1:5173/\n",
          timestamp: 1,
        }],
        commandRunning: true,
        lastCommandCompleted: false,
        workingDirectory: ROOT,
      }),
      registerBackgroundSession,
    });
    const tool = createTerminalRunTool(backend);

    const result = await tool.execute({
      background: true,
      backgroundWaitMs: 250,
      command: "npm run dev",
      cwd: ".",
    }, makeContext());

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      browserPreviewUrl: "http://localhost:5173/",
      terminal: {
        command: "npm run dev",
        live: true,
        sessionId: "terminal-1",
        workingDirectory: ROOT,
      },
    });
    expect(registerBackgroundSession).toHaveBeenCalledWith(expect.objectContaining({
      browserPreviewUrl: "http://localhost:5173/",
      command: "npm run dev",
      sessionId: "terminal-1",
    }));
  });

  it("reuses an existing matching app-owned background session instead of starting a duplicate", async () => {
    const createSession = vi.fn(makeTerminalBackend().createSession);
    const recordBackgroundSessionOutput = vi.fn();
    const updateBackgroundSession = vi.fn();
    const writeSession = vi.fn();
    const backend = makeTerminalBackend({
      createSession,
      drainSession: async () => ({
        chunks: [{
          id: "chunk-2",
          stream: "stdout",
          text: "still running\n",
          timestamp: 2,
        }],
        commandRunning: true,
        lastCommandCompleted: false,
        workingDirectory: ROOT,
      }),
      listBackgroundSessions: () => [
        {
          browserPreviewUrl: "http://localhost:5173/",
          command: "npm run dev",
          lastSeenAt: 2,
          outputPreview: "Vite ready at http://localhost:5173/",
          sessionId: "terminal-existing",
          shell: "powershell",
          startedAt: 1,
          workingDirectory: ROOT,
        },
      ],
      recordBackgroundSessionOutput,
      updateBackgroundSession,
      writeSession,
    });
    const tool = createTerminalRunTool(backend);

    const result = await tool.execute({
      background: true,
      backgroundWaitMs: 250,
      command: "npm run dev",
      cwd: ".",
      previewUrl: "http://127.0.0.1:5173/",
    }, makeContext());

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Reusing app-owned background session");
    expect(result.data).toMatchObject({
      browserPreviewUrl: "http://localhost:5173/",
      terminal: {
        command: "npm run dev",
        live: true,
        sessionId: "terminal-existing",
        workingDirectory: ROOT,
      },
    });
    expect(createSession).not.toHaveBeenCalled();
    expect(writeSession).not.toHaveBeenCalled();
    expect(recordBackgroundSessionOutput).toHaveBeenCalledWith("terminal-existing", [
      expect.objectContaining({ text: "still running\n" }),
    ]);
    expect(updateBackgroundSession).toHaveBeenCalledWith("terminal-existing", expect.objectContaining({
      command: "npm run dev",
      workingDirectory: ROOT,
    }));
  });

  it("collapses simultaneous matching background starts into one native terminal session", async () => {
    let drainCount = 0;
    const createSession = vi.fn(async (request: TerminalCreateSessionRequest): Promise<TerminalCreateSessionResponse> => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return {
        initialOutput: [],
        sessionId: "terminal-in-flight",
        shell: request.shell ?? "powershell",
        startedAt: 1_700_000_000_000,
        workingDirectory: request.workingDirectory ?? ROOT,
      };
    });
    const writeSession = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const backend = makeTerminalBackend({
      createSession,
      drainSession: async () => {
        drainCount += 1;
        return {
          chunks: [],
          commandRunning: true,
          lastCommandCompleted: false,
          workingDirectory: ROOT,
        };
      },
      registerBackgroundSession: vi.fn(),
      writeSession,
    });
    const tool = createTerminalRunTool(backend);

    const [first, second] = await Promise.all([
      tool.execute({
        background: true,
        backgroundWaitMs: 250,
        command: "npm run dev",
        cwd: ".",
        previewUrl: "http://localhost:5173/",
      }, makeContext()),
      tool.execute({
        background: true,
        backgroundWaitMs: 250,
        command: "npm run dev",
        cwd: ".",
        previewUrl: "http://localhost:5173/",
      }, makeContext()),
    ]);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(writeSession).toHaveBeenCalledTimes(1);
    expect(drainCount).toBeGreaterThan(0);
    expect(first.data).toMatchObject({
      terminal: {
        sessionId: "terminal-in-flight",
      },
    });
    expect(second.data).toMatchObject({
      terminal: {
        sessionId: "terminal-in-flight",
      },
    });
  });

  it("does not advertise a configured background preview URL until it is printed or responds", async () => {
    const registerBackgroundSession = vi.fn();
    const backend = makeTerminalBackend({
      drainSession: async () => ({
        chunks: [{
          id: "chunk-1",
          stream: "stdout",
          text: "Starting dev server...\n",
          timestamp: 1,
        }],
        commandRunning: true,
        lastCommandCompleted: false,
        workingDirectory: ROOT,
      }),
      probeUrl: async (url) => ({
        ok: false,
        url,
      }),
      registerBackgroundSession,
    });
    const tool = createTerminalRunTool(backend);

    const result = await tool.execute({
      background: true,
      backgroundWaitMs: 250,
      command: "npm run dev",
      cwd: ".",
      previewUrl: "http://localhost:5173/",
    }, makeContext());

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Configured browser preview URL is not responding yet");
    expect(result.data).toMatchObject({
      browserPreviewUrl: null,
      configuredPreviewUrl: "http://localhost:5173/",
    });
    expect(registerBackgroundSession).toHaveBeenCalledWith(expect.objectContaining({
      browserPreviewUrl: undefined,
      command: "npm run dev",
    }));
  });

  it("probes quiet background startup and records reachable preview evidence", async () => {
    const registerBackgroundSession = vi.fn();
    let probeCount = 0;
    const backend = makeTerminalBackend({
      drainSession: async () => ({
        chunks: [{
          id: "chunk-quiet",
          stream: "system",
          text: "Running command: npm run dev\n",
          timestamp: 1,
        }],
        commandRunning: true,
        lastCommandCompleted: false,
        workingDirectory: ROOT,
      }),
      probeUrl: async (url) => ({
        ok: url === "http://localhost:5173/" && ++probeCount > 1,
        status: probeCount > 1 ? 200 : undefined,
        url,
      }),
      registerBackgroundSession,
    });
    const tool = createTerminalRunTool(backend);

    const result = await tool.execute({
      background: true,
      backgroundWaitMs: 250,
      command: "npm run dev",
      cwd: ".",
      previewUrl: "http://127.0.0.1:5173/",
    }, makeContext());

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Browser preview URL: http://localhost:5173/");
    expect(result.data).toMatchObject({
      browserPreviewUrl: "http://localhost:5173/",
      outputPreview: expect.stringContaining("Gilbert verified the preview is reachable at http://localhost:5173/."),
      terminal: {
        live: true,
        sessionId: "terminal-1",
      },
    });
    expect(registerBackgroundSession).toHaveBeenLastCalledWith(expect.objectContaining({
      browserPreviewUrl: "http://localhost:5173/",
      outputPreview: expect.stringContaining("The background command is still running."),
    }));
  });
});

describe("terminal diagnostics", () => {
  it("lists app-owned background sessions without approval", async () => {
    const tool = createTerminalListSessionsTool(makeTerminalBackend({
      listBackgroundSessions: () => [
        {
          browserPreviewUrl: "http://localhost:5173/",
          command: "npm run dev",
          lastSeenAt: 2,
          outputPreview: "ready",
          sessionId: "terminal-1",
          shell: "powershell",
          startedAt: 1,
          workingDirectory: ROOT,
        },
      ],
    }));

    const result = await tool.execute({}, makeContext());

    expect(result.ok).toBe(true);
    expect(result.content).toContain("App-owned terminal sessions: 1");
    expect(result.data).toMatchObject({
      sessions: [
        expect.objectContaining({
          command: "npm run dev",
          sessionId: "terminal-1",
        }),
      ],
    });
  });

  it("reads app-owned terminal session output and updates the background session cache", async () => {
    const recordBackgroundSessionOutput = vi.fn();
    const updateBackgroundSession = vi.fn();
    const tool = createTerminalReadSessionTool(makeTerminalBackend({
      drainSession: async () => ({
        chunks: [
          {
            id: "chunk-1",
            stream: "stderr",
            text: "Module not found\n",
            timestamp: 3,
          },
        ],
        commandRunning: true,
        lastCommandCompleted: false,
        workingDirectory: ROOT,
      }),
      recordBackgroundSessionOutput,
      updateBackgroundSession,
    }));

    const result = await tool.execute({ sessionId: "terminal-1" }, makeContext());

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Module not found");
    expect(recordBackgroundSessionOutput).toHaveBeenCalledWith("terminal-1", [
      expect.objectContaining({ text: "Module not found\n" }),
    ]);
    expect(updateBackgroundSession).toHaveBeenCalledWith("terminal-1", expect.objectContaining({
      workingDirectory: ROOT,
    }));
  });

  it("recommends reusing a reachable external localhost server instead of starting a duplicate", async () => {
    const tool = createTerminalDevServerStatusTool(makeTerminalBackend({
      probeUrl: async (url) => ({
        ok: url === "http://localhost:5173/",
        status: url === "http://localhost:5173/" ? 200 : undefined,
        url,
      }),
    }));

    const result = await tool.execute({
      command: "npm run dev -- --port 5173",
      cwd: ".",
      previewUrl: "http://127.0.0.1:5173/",
    }, makeContext());

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Reuse recommended: yes");
    expect(result.content).toContain("Matching external localhost server detected");
    expect(result.data).toMatchObject({
      externalServers: [
        expect.objectContaining({
          ok: true,
          url: "http://localhost:5173/",
        }),
      ],
      reuseRecommended: true,
      selectedPreviewUrl: "http://localhost:5173/",
    });
  });

  it("does not reuse or open an unrelated reachable common localhost port when a target preview URL is requested", async () => {
    const tool = createTerminalDevServerStatusTool(makeTerminalBackend({
      probeUrl: async (url) => ({
        ok: url === "http://localhost:8787/",
        status: url === "http://localhost:8787/" ? 200 : undefined,
        url,
      }),
    }));

    const result = await tool.execute({
      command: "npm run dev",
      cwd: ".",
      previewUrl: "http://localhost:5173/",
    }, makeContext());

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Reuse recommended: no");
    expect(result.content).toContain("Other reachable localhost servers were found but are not reusable");
    expect(result.data).toMatchObject({
      externalServers: [],
      matchingExternalServers: [],
      reuseRecommended: false,
      selectedPreviewUrl: "http://localhost:5173/",
      targetUrls: ["http://localhost:5173/"],
      unrelatedReachableLocalhost: [
        expect.objectContaining({
          ok: true,
          url: "http://localhost:8787/",
        }),
      ],
    });
  });
});

describe("browser_preview_open", () => {
  it("opens the latest background terminal preview URL when no URL is supplied", async () => {
    const backend: BrowserPreviewBackend = {
      getBackgroundPreviewUrls: () => ["http://127.0.0.1:5173/"],
      getCurrentAppUrl: () => "tauri://localhost/",
    };
    const tool = createBrowserPreviewTool(backend);
    const result = await tool.execute({}, makeContext());

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      browserPreviewUrl: "http://localhost:5173/",
    });
  });

  it("blocks private network and current-app preview targets", async () => {
    const tool = createBrowserPreviewTool({
      getBackgroundPreviewUrls: () => [],
      getCurrentAppUrl: () => "http://localhost:1420/",
    });

    await expect(await tool.execute({ url: "http://localhost:1420/" }, makeContext())).toMatchObject({
      ok: false,
    });
    await expect(await tool.execute({ url: "https://192.168.1.12/" }, makeContext())).toMatchObject({
      ok: false,
    });
  });
});

describe("browser_console_read", () => {
  it("returns retained console entries with counts and filtering", async () => {
    const tool = createBrowserConsoleReadTool({
      getBackgroundPreviewUrls: () => [],
      getCurrentAppUrl: () => "tauri://localhost/",
      readConsoleSnapshot: () => ({
        counts: {
          debug: 0,
          error: 1,
          info: 0,
          log: 1,
          total: 2,
          warning: 0,
        },
        entries: [
          {
            id: "console-1",
            kind: "pageerror",
            level: "error",
            message: "ReferenceError: missingWidget is not defined",
            source: "Preview page",
            timestamp: "2026-05-16T12:00:00.000Z",
            url: "http://localhost:5173/",
          },
        ],
        filteredCount: 1,
        retainedCount: 2,
        truncated: false,
      }),
    });

    const result = await tool.execute({ level: "error" }, makeContext());

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Browser console: 2 retained entries");
    expect(result.content).toContain("ReferenceError");
    expect(result.data).toMatchObject({
      counts: {
        error: 1,
        total: 2,
      },
      entries: [
        expect.objectContaining({
          level: "error",
          url: "http://localhost:5173/",
        }),
      ],
    });
  });
});

describe("browser_screenshot_capture", () => {
  it("uses a bounded timeout because native screenshot capture can get stuck in WebView2", () => {
    const tool = createBrowserScreenshotCaptureTool({
      getBackgroundPreviewUrls: () => [],
      getCurrentAppUrl: () => "tauri://localhost/",
    });

    expect(tool.timeoutMs).toBe(18_000);
  });

  it("returns a tool error when native screenshot capture does not answer quickly", async () => {
    vi.useFakeTimers();

    try {
      const tool = createBrowserScreenshotCaptureTool({
        captureScreenshot: () => new Promise(() => {}),
        getBackgroundPreviewUrls: () => [],
        getCurrentAppUrl: () => "tauri://localhost/",
        screenshotCaptureTimeoutMs: 10,
      });
      const resultPromise = tool.execute({ reason: "verify layout" }, makeContext());

      await vi.advanceTimersByTimeAsync(1_000);

      const result = await resultPromise;
      expect(result.ok).toBe(false);
      expect(result.content).toContain("Browser screenshot capture did not respond within 1 second.");
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns a screenshot artifact and optional console snapshot", async () => {
    const tool = createBrowserScreenshotCaptureTool({
      captureScreenshot: async () => ({
        artifact: {
          detail: "URL: http://localhost:5173/",
          id: "browser-screenshot-1",
          kind: "image",
          mimeType: "image/png",
          sizeBytes: 42,
          title: "Browser screenshot",
          url: "data:image/png;base64,AAAA",
        },
        dataUrl: "data:image/png;base64,AAAA",
        detail: "URL: http://localhost:5173/",
        label: "main",
        mimeType: "image/png",
        mode: "iframe",
        sizeBytes: 42,
        title: "Browser screenshot",
        url: "http://localhost:5173/",
      }),
      getBackgroundPreviewUrls: () => [],
      getCurrentAppUrl: () => "tauri://localhost/",
      readConsoleSnapshot: () => ({
        counts: {
          debug: 0,
          error: 0,
          info: 0,
          log: 1,
          total: 1,
          warning: 0,
        },
        entries: [],
        filteredCount: 1,
        retainedCount: 1,
        truncated: false,
      }),
    });

    const result = await tool.execute({ includeConsole: true, reason: "verify layout" }, makeContext());

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Browser screenshot captured.");
    expect(result.content).toContain("Console snapshot: 1 retained entries");
    expect(result.data).toMatchObject({
      artifacts: [
        expect.objectContaining({
          kind: "image",
          url: "data:image/png;base64,AAAA",
        }),
      ],
      browserScreenshot: {
        label: "main",
        mode: "iframe",
        url: "http://localhost:5173/",
      },
    });
  });
});

describe("web_search", () => {
  it("returns source cards from the configured web provider without approval", async () => {
    const search = vi.fn<WebSearchToolBackend["search"]>(async (query, settings, _options) => ({
      primaryProvider: settings.provider,
      provider: settings.provider,
      results: [
        {
          snippet: `Docs for ${query}`,
          title: "Brave Search API docs",
          url: "https://api-dashboard.search.brave.com/documentation/guides/authentication",
        },
      ],
    }));
    const tool = createWebSearchTool({ search });
    const registry = new ToolRegistry([tool]);
    const context = makeContext({
      webSearchMaxResults: 6,
      webSearchSettings: {
        brave: {
          apiKey: "test",
          apiVersion: "",
          answersMaxCompletionTokens: 700,
          answersModel: "brave",
          cacheControlNoCache: false,
          country: "US",
          enableAnswers: false,
          enableImageSearch: false,
          enableNewsSearch: false,
          enablePlaceSearch: false,
          enableRichCallback: false,
          enableSemanticRerank: true,
          enableVideoSearch: false,
          extraSnippets: true,
          freshness: "any",
          freshnessEndDate: "",
          freshnessStartDate: "",
          goggles: "",
          imageResultCount: 6,
          includeFetchMetadata: false,
          locationCity: "",
          locationCountry: "",
          locationLatitude: "",
          locationLongitude: "",
          locationPostalCode: "",
          locationState: "",
          locationStateName: "",
          locationTimezone: "",
          newsResultCount: 6,
          offset: 0,
          operators: true,
          placeLocation: "",
          placeRadiusMeters: 2500,
          placeResultCount: 6,
          requestMethod: "get",
          resultFilter: [],
          safesearch: "moderate",
          searchLang: "en",
          showImageResults: false,
          spellcheck: true,
          summary: false,
          textDecorations: false,
          uiLang: "en-US",
          units: "imperial",
          videoResultCount: 4,
        },
        enabled: true,
        maxResults: 6,
        provider: "brave",
      },
    });

    const batch = await executeToolBridgeCalls({
      calls: [{ arguments: { freshness: "pw", maxResults: 3, query: "Brave auth" }, id: "call-web", name: "web_search", provider: "openai" }],
      context,
      registry,
    });

    expect(search).toHaveBeenCalledWith("Brave auth", expect.objectContaining({
      brave: expect.objectContaining({ freshness: "pw" }),
      maxResults: 3,
      provider: "brave",
    }), expect.objectContaining({ includeVisualResults: false, maxResults: 3 }));
    expect(batch.toolCalls[0]).toMatchObject({ status: "complete", toolId: "web_search" });
    expect(batch.resultMessages[0]?.result.content).toContain("WEB SEARCH TOOL RESULTS - Brave Search");
    expect(batch.resultMessages[0]?.result.data).toMatchObject({
      provider: "brave",
      resultCount: 1,
      sources: [
        expect.objectContaining({
          title: "Brave Search API docs",
          url: "https://api-dashboard.search.brave.com/documentation/guides/authentication",
        }),
      ],
    });
  });

  it("caps web_search source data at six even if a provider returns more", async () => {
    const search = vi.fn<WebSearchToolBackend["search"]>(async (_query, settings) => ({
      primaryProvider: settings.provider,
      provider: settings.provider,
      results: Array.from({ length: 9 }, (_, index) => ({
        snippet: `Result ${index}`,
        title: `Source ${index}`,
        url: `https://example.com/${index}`,
      })),
    }));
    const tool = createWebSearchTool({ search });
    const registry = new ToolRegistry([tool]);

    const batch = await executeToolBridgeCalls({
      calls: [{ arguments: { maxResults: 6, query: "source cap" }, id: "call-web-cap", name: "web_search", provider: "openai" }],
      context: makeContext({ webSearchMaxResults: 6 }),
      registry,
    });

    expect(batch.toolCalls[0]).toMatchObject({ status: "complete", toolId: "web_search" });
    expect(batch.resultMessages[0]?.result.data).toMatchObject({
      resultCount: 6,
    });
    expect((batch.resultMessages[0]?.result.data as { sources?: unknown[] }).sources).toHaveLength(6);
  });
});
