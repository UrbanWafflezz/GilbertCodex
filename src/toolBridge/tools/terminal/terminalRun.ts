import type { TerminalDrainResponse, TerminalShellId } from "../../../types/terminal";
import type { BackgroundTerminalSession } from "../../../lib/terminalSessions";
import { PathResolutionError, tryResolveAllowedPath } from "../../paths";
import type { JsonValue, ToolDefinition, ToolExecutionContext, ToolExecutionResult } from "../../types";
import { defaultTerminalBackend, type TerminalBackend } from "./backend";

const DEFAULT_TERMINAL_TIMEOUT_MS = 45_000;
const MAX_TERMINAL_TIMEOUT_MS = 600_000;
const DEFAULT_BACKGROUND_WAIT_MS = 8_000;
const MAX_BACKGROUND_WAIT_MS = 30_000;
const BACKGROUND_POLL_INTERVAL_MS = 160;
const BACKGROUND_PREVIEW_PROBE_INTERVAL_MS = 500;

const TERMINAL_SHELLS: TerminalShellId[] = ["powershell", "cmd", "bash", "zsh", "sh", "wsl"];
const inFlightBackgroundCommands = new Map<string, Promise<ToolExecutionResult>>();

export function createTerminalRunTool(backend: TerminalBackend = defaultTerminalBackend): ToolDefinition {
  return {
    description:
      "Run a local shell command inside the selected workspace. Use this for tests, builds, package installs, formatters, and command evidence after file/Git tools are the better fit for source inspection or edits. " +
      "Pass the target folder as cwd/workingDirectory instead of putting a leading cd in command; leading cd wrappers are normalized before execution. " +
      "Use files_create_directory and files_list for folder work instead of terminal mkdir/ls when those tools are attached. " +
      "Use terminal copy commands for binary assets such as images when text-file editing tools are not the right fit. " +
      "The command always has an explicit cwd, captures stdout/stderr, has a bounded timeout, and follows the active permission mode for approval. " +
      "Set background true only for dev servers or watchers that should keep running and be attachable in the in-app terminal.",
    execute: async (args, context) => {
      const rawCommand = stringArg(args.command);

      if (!rawCommand) {
        return createErrorResult("terminal_run requires a non-empty command.");
      }

      const requestedShell = terminalShellArg(args.shell);
      const shell = requestedShell ?? resolveTerminalShellForCommand(rawCommand, resolveContextTerminalShell(context));
      const normalizedInvocation = normalizeTerminalInvocation(rawCommand, args, context, shell);
      if (!normalizedInvocation.ok) {
        return normalizedInvocation.result;
      }

      const { command, cwd } = normalizedInvocation;
      const timeoutMs = integerArg(args.timeoutMs, DEFAULT_TERMINAL_TIMEOUT_MS, 1_000, MAX_TERMINAL_TIMEOUT_MS);
      const background = booleanArg(args.background);
      const previewUrl = normalizePreviewUrl(stringArg(args.previewUrl));
      const dialectGuard = createShellDialectGuard(command, shell);

      if (dialectGuard) {
        return dialectGuard;
      }

      if (booleanArg(args.dryRun)) {
        return {
          content: [
            background ? "Dry run: would start a background terminal command." : "Dry run: would run a terminal command.",
            `cwd: ${cwd}`,
            `shell: ${shell ?? "default"}`,
            `timeoutMs: ${timeoutMs}`,
            `command: ${command}`,
            "Terminal commands follow the active permission mode and should be used for tests, builds, installs, clone/download workflows, binary asset copies, formatters, and command evidence.",
          ].join("\n"),
          data: {
            dryRun: true,
            terminal: {
              command,
              live: background,
              shell: shell ?? null,
              timedOut: false,
              workingDirectory: cwd,
            },
          } as JsonValue,
          ok: true,
        };
      }

      if (!backend.isAvailable()) {
        return createErrorResult("terminal_run is available only in the Tauri desktop app.");
      }

      if (context.signal?.aborted) {
        return createErrorResult("Tool bridge run was aborted before terminal_run could start.");
      }

      return background
        ? runBackgroundCommand(backend, {
            command,
            cwd,
            previewUrl,
            shell,
            waitMs: integerArg(args.backgroundWaitMs, DEFAULT_BACKGROUND_WAIT_MS, 250, MAX_BACKGROUND_WAIT_MS),
          })
        : runBufferedCommand(backend, {
            command,
            cwd,
            shell,
            timeoutMs,
          });
    },
    executorMetadata: { family: "terminal", version: 1 },
    id: "terminal_run",
    inputSchema: {
      additionalProperties: false,
      properties: {
        background: {
          description: "Set true for a dev server or watcher that should keep running in an attachable terminal session.",
          type: "boolean",
        },
        backgroundWaitMs: {
          description: "For background commands, how long to collect startup output and probe the preview URL before returning. Defaults to 8000.",
          maximum: MAX_BACKGROUND_WAIT_MS,
          minimum: 250,
          type: "integer",
        },
        command: {
          description: "Shell command to run. Do not prefix with cd; pass cwd/workingDirectory instead.",
          minLength: 1,
          type: "string",
        },
        cwd: {
          description: "Working directory inside the selected workspace. Defaults to the first workspace root.",
          minLength: 1,
          type: "string",
        },
        dryRun: {
          description: "Preview the terminal action without running it. Used for approval cards.",
          type: "boolean",
        },
        previewUrl: {
          description: "Optional localhost URL to associate with a background dev server.",
          minLength: 1,
          type: "string",
        },
        shell: {
          description: "Optional shell override. Defaults to the app's configured terminal shell, or WSL when the agent environment is WSL.",
          enum: TERMINAL_SHELLS,
          type: "string",
        },
        timeoutMs: {
          description: "Buffered command timeout in milliseconds. Defaults to 45000 and is capped at 600000.",
          maximum: MAX_TERMINAL_TIMEOUT_MS,
          minimum: 1000,
          type: "integer",
        },
        workingDirectory: {
          description: "Alias for cwd. Must resolve inside the selected workspace.",
          minLength: 1,
          type: "string",
        },
      },
      required: ["command"],
      type: "object",
    },
    permission: "terminal",
    risk: "terminal",
    title: "Run terminal command",
  };
}

async function runBufferedCommand(
  backend: TerminalBackend,
  request: {
    command: string;
    cwd: string;
    shell?: TerminalShellId;
    timeoutMs: number;
  },
): Promise<ToolExecutionResult> {
  try {
    const response = await backend.runCommand({
      command: request.command,
      shell: request.shell,
      timeoutMs: request.timeoutMs,
      workingDirectory: request.cwd,
    });
    const output = formatBufferedTerminalOutput(request.command, response);
    const ok = response.exitCode === 0 && !response.timedOut;

    return {
      content: output,
      data: {
        durationMs: response.durationMs,
        exitCode: response.exitCode ?? null,
        outputTruncated: response.outputTruncated,
        shell: response.shell,
        stderr: response.stderr,
        stdout: response.stdout,
        terminal: {
          command: request.command,
          exitCode: response.exitCode ?? null,
          live: false,
          outputTruncated: response.outputTruncated,
          shell: response.shell,
          timedOut: response.timedOut,
          workingDirectory: response.workingDirectory,
        },
        timedOut: response.timedOut,
        workingDirectory: response.workingDirectory,
      } as JsonValue,
      error: ok ? undefined : response.timedOut ? "Terminal command timed out." : `Terminal command exited with code ${response.exitCode ?? "unknown"}.`,
      ok,
    };
  } catch (error) {
    return createErrorResult(readErrorMessage(error, "Could not run terminal command."));
  }
}

async function runBackgroundCommand(
  backend: TerminalBackend,
  request: {
    command: string;
    cwd: string;
    previewUrl?: string;
    shell?: TerminalShellId;
    waitMs: number;
  },
): Promise<ToolExecutionResult> {
  const inFlightKey = createBackgroundCommandRequestKey(request);
  const inFlight = inFlightBackgroundCommands.get(inFlightKey);
  if (inFlight) {
    return inFlight;
  }

  const run = runBackgroundCommandOnce(backend, request).finally(() => {
    if (inFlightBackgroundCommands.get(inFlightKey) === run) {
      inFlightBackgroundCommands.delete(inFlightKey);
    }
  });
  inFlightBackgroundCommands.set(inFlightKey, run);
  return run;
}

async function runBackgroundCommandOnce(
  backend: TerminalBackend,
  request: {
    command: string;
    cwd: string;
    previewUrl?: string;
    shell?: TerminalShellId;
    waitMs: number;
  },
): Promise<ToolExecutionResult> {
  try {
    const reusableSessionResult = await reuseMatchingBackgroundCommand(backend, request);
    if (reusableSessionResult) {
      return reusableSessionResult;
    }

    const session = await backend.createSession({
      mode: "command",
      shell: request.shell,
      workingDirectory: request.cwd,
    });
    await backend.writeSession(session.sessionId, `${request.command}\r\n`);

    const initialOutput = formatTerminalChunks(session.initialOutput);
    backend.registerBackgroundSession({
      command: request.command,
      outputPreview: initialOutput,
      sessionId: session.sessionId,
      shell: session.shell,
      startedAt: session.startedAt,
      workingDirectory: session.workingDirectory,
    });

    const startedAt = Date.now();
    const chunks: string[] = [initialOutput];
    let latestDrain: TerminalDrainResponse | undefined;
    let detectedPreviewUrl: string | undefined;
    let lastPreviewProbeAt = 0;

    while (Date.now() - startedAt < request.waitMs) {
      await sleep(BACKGROUND_POLL_INTERVAL_MS);
      latestDrain = await backend.drainSession(session.sessionId);
      backend.recordBackgroundSessionOutput(session.sessionId, latestDrain.chunks);
      chunks.push(formatTerminalChunks(latestDrain.chunks));

      const outputSoFar = chunks.join("");
      detectedPreviewUrl = findLocalPreviewUrl(outputSoFar) ?? detectedPreviewUrl;
      const shouldProbePreview =
        !detectedPreviewUrl &&
        Boolean(request.previewUrl) &&
        Date.now() - lastPreviewProbeAt >= BACKGROUND_PREVIEW_PROBE_INTERVAL_MS;
      if (shouldProbePreview) {
        lastPreviewProbeAt = Date.now();
        detectedPreviewUrl = await probeReadyPreviewUrl(backend, request.previewUrl);
      }

      if (!latestDrain.commandRunning && latestDrain.lastCommandCompleted) {
        break;
      }

      if (detectedPreviewUrl) {
        break;
      }
    }

    const rawOutputPreview = chunks.join("").trim();
    detectedPreviewUrl = findLocalPreviewUrl(rawOutputPreview) ?? detectedPreviewUrl ?? await probeReadyPreviewUrl(backend, request.previewUrl);
    const outputPreview = appendPreviewReadinessLine(rawOutputPreview, detectedPreviewUrl, latestDrain);
    const exitCode = latestDrain?.lastCommandCompleted ? latestDrain.lastCommandExitCode ?? null : null;
    const live = latestDrain?.lastCommandCompleted ? false : true;
    const ok = live || exitCode === 0;

    backend.registerBackgroundSession({
      browserPreviewUrl: detectedPreviewUrl,
      command: request.command,
      outputPreview,
      sessionId: session.sessionId,
      shell: session.shell,
      startedAt: session.startedAt,
      workingDirectory: latestDrain?.workingDirectory ?? session.workingDirectory,
    });

    const content = [
      live ? "Background session: running" : `Background command exited with code ${exitCode ?? "unknown"}.`,
      `Session: ${session.sessionId}`,
      `cwd: ${latestDrain?.workingDirectory ?? session.workingDirectory}`,
      `shell: ${session.shell}`,
      `command: ${request.command}`,
      detectedPreviewUrl ? `Browser preview URL: ${detectedPreviewUrl}` : "",
      request.previewUrl && !detectedPreviewUrl ? `Configured browser preview URL is not responding yet: ${request.previewUrl}` : "",
      outputPreview ? ["", "Startup output:", outputPreview].join("\n") : "",
    ].filter(Boolean).join("\n");

    return {
      content,
      data: {
        browserPreviewUrl: detectedPreviewUrl ?? null,
        configuredPreviewUrl: request.previewUrl ?? null,
        exitCode,
        outputPreview,
        terminal: {
          command: request.command,
          exitCode,
          live,
          sessionId: session.sessionId,
          shell: session.shell,
          timedOut: false,
          workingDirectory: latestDrain?.workingDirectory ?? session.workingDirectory,
        },
      } as JsonValue,
      error: ok ? undefined : `Background command exited with code ${exitCode ?? "unknown"}.`,
      ok,
    };
  } catch (error) {
    return createErrorResult(readErrorMessage(error, "Could not start background terminal command."));
  }
}

function createBackgroundCommandRequestKey(request: {
  command: string;
  cwd: string;
  previewUrl?: string;
  shell?: TerminalShellId;
}) {
  return [
    normalizeBackgroundPathKey(request.cwd),
    normalizeBackgroundCommandKey(request.command),
    normalizePreviewUrl(request.previewUrl) ?? "",
    request.shell ?? "",
  ].join("\n");
}

async function reuseMatchingBackgroundCommand(
  backend: TerminalBackend,
  request: {
    command: string;
    cwd: string;
    previewUrl?: string;
    shell?: TerminalShellId;
  },
): Promise<ToolExecutionResult | undefined> {
  const matchingSessions = backend
    .listBackgroundSessions()
    .filter((session) => backgroundSessionMatchesRequest(session, request));

  for (const session of matchingSessions) {
    try {
      const drain = await backend.drainSession(session.sessionId);
      const newOutput = formatTerminalChunks(drain.chunks);
      const outputPreview = combineTerminalOutputPreviews(session.outputPreview, newOutput);
      backend.recordBackgroundSessionOutput(session.sessionId, drain.chunks);

      const workingDirectory = drain.workingDirectory ?? session.workingDirectory ?? request.cwd;
      const browserPreviewUrl =
        findLocalPreviewUrl(outputPreview) ??
        normalizePreviewUrl(session.browserPreviewUrl) ??
        await probeReadyPreviewUrl(backend, request.previewUrl);

      if (drain.commandRunning || !drain.lastCommandCompleted) {
        backend.updateBackgroundSession(session.sessionId, {
          browserPreviewUrl,
          command: request.command,
          outputPreview,
          shell: session.shell ?? request.shell,
          workingDirectory,
        });

        return createReusedBackgroundSessionResult({
          browserPreviewUrl,
          outputPreview,
          request,
          session,
          workingDirectory,
        });
      }

      const reachablePreviewUrl =
        await probeReadyPreviewUrl(backend, browserPreviewUrl) ??
        await probeReadyPreviewUrl(backend, session.browserPreviewUrl) ??
        await probeReadyPreviewUrl(backend, request.previewUrl);
      backend.unregisterBackgroundSession(session.sessionId);

      if (reachablePreviewUrl) {
        return createExternalPreviewReuseResult(request, reachablePreviewUrl, outputPreview);
      }
    } catch {
      const reachablePreviewUrl =
        await probeReadyPreviewUrl(backend, session.browserPreviewUrl) ??
        await probeReadyPreviewUrl(backend, request.previewUrl);
      backend.unregisterBackgroundSession(session.sessionId);

      if (reachablePreviewUrl) {
        return createExternalPreviewReuseResult(request, reachablePreviewUrl, session.outputPreview ?? "");
      }
    }
  }

  const reachableConfiguredPreview = await probeReadyPreviewUrl(backend, request.previewUrl);
  if (reachableConfiguredPreview) {
    return createExternalPreviewReuseResult(request, reachableConfiguredPreview, "");
  }

  return undefined;
}

function createReusedBackgroundSessionResult({
  browserPreviewUrl,
  outputPreview,
  request,
  session,
  workingDirectory,
}: {
  browserPreviewUrl?: string;
  outputPreview: string;
  request: { command: string; cwd: string; previewUrl?: string; shell?: TerminalShellId };
  session: BackgroundTerminalSession;
  workingDirectory: string;
}): ToolExecutionResult {
  const shell = session.shell ?? request.shell;
  const content = [
    "Reusing app-owned background session: running",
    `Session: ${session.sessionId}`,
    `cwd: ${workingDirectory}`,
    `shell: ${shell ?? "default"}`,
    `command: ${request.command}`,
    browserPreviewUrl ? `Browser preview URL: ${browserPreviewUrl}` : "",
    request.previewUrl && !browserPreviewUrl ? `Configured browser preview URL is not responding yet: ${request.previewUrl}` : "",
    outputPreview ? ["", "Recent output:", outputPreview].join("\n") : "",
  ].filter(Boolean).join("\n");

  return {
    content,
    data: {
      browserPreviewUrl: browserPreviewUrl ?? null,
      configuredPreviewUrl: request.previewUrl ?? null,
      exitCode: null,
      outputPreview,
      terminal: {
        command: request.command,
        exitCode: null,
        live: true,
        sessionId: session.sessionId,
        shell: shell ?? null,
        timedOut: false,
        workingDirectory,
      },
    } as JsonValue,
    ok: true,
  };
}

function createExternalPreviewReuseResult(
  request: { command: string; cwd: string; previewUrl?: string; shell?: TerminalShellId },
  browserPreviewUrl: string,
  outputPreview: string,
): ToolExecutionResult {
  const content = [
    "Reusing reachable localhost preview URL.",
    `cwd: ${request.cwd}`,
    `shell: ${request.shell ?? "default"}`,
    `command: ${request.command}`,
    `Browser preview URL: ${browserPreviewUrl}`,
    "No app-owned terminal session was attached because the existing server is already responding. External terminal scrollback is unavailable unless the command is run inside Gilbert's integrated terminal.",
    outputPreview ? ["", "Previous app-owned output:", outputPreview].join("\n") : "",
  ].filter(Boolean).join("\n");

  return {
    content,
    data: {
      browserPreviewUrl,
      configuredPreviewUrl: request.previewUrl ?? null,
      exitCode: null,
      outputPreview,
      terminal: {
        command: request.command,
        exitCode: null,
        live: false,
        sessionId: null,
        shell: request.shell ?? null,
        timedOut: false,
        workingDirectory: request.cwd,
      },
    } as JsonValue,
    ok: true,
  };
}

function backgroundSessionMatchesRequest(
  session: BackgroundTerminalSession,
  request: { command: string; cwd: string; previewUrl?: string },
) {
  const cwdMatches = normalizeBackgroundPathKey(session.workingDirectory) === normalizeBackgroundPathKey(request.cwd);
  const commandMatches = normalizeBackgroundCommandKey(session.command) === normalizeBackgroundCommandKey(request.command);
  const previewMatches = Boolean(
    request.previewUrl &&
    normalizePreviewUrl(session.browserPreviewUrl) === normalizePreviewUrl(request.previewUrl),
  );

  return cwdMatches && (commandMatches || previewMatches);
}

function normalizeBackgroundCommandKey(value: string | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeBackgroundPathKey(value: string | undefined) {
  return (value ?? "").trim().replace(/[\\/]+$/, "").toLowerCase();
}

function combineTerminalOutputPreviews(previous: string | undefined, next: string) {
  return [previous?.trim(), next.trim()].filter(Boolean).join("\n").trim();
}

function appendPreviewReadinessLine(outputPreview: string, previewUrl: string | undefined, latestDrain: TerminalDrainResponse | undefined) {
  if (!previewUrl || latestDrain?.lastCommandCompleted) {
    return outputPreview;
  }

  const line = `Gilbert verified the preview is reachable at ${previewUrl}. The background command is still running.`;
  if (outputPreview.includes(line)) {
    return outputPreview;
  }

  return [outputPreview, line].filter(Boolean).join("\n").trim();
}

function normalizeTerminalInvocation(
  rawCommand: string,
  args: Record<string, unknown>,
  context: Pick<ToolExecutionContext, "workspaceRoots">,
  shell: TerminalShellId | undefined,
): { command: string; cwd: string; ok: true } | { ok: false; result: ToolExecutionResult } {
  const leadingCd = extractLeadingDirectoryChange(rawCommand);
  const requested = leadingCd?.cwd ?? stringArg(args.cwd) ?? stringArg(args.workingDirectory) ?? ".";
  const cwd = resolveTerminalCwd(requested, context);
  if (typeof cwd !== "string") {
    return { ok: false, result: cwd };
  }

  return {
    command: normalizeCommonWindowsDialectCommand(leadingCd?.command ?? rawCommand, shell),
    cwd,
    ok: true,
  };
}

function resolveTerminalCwd(requested: string, context: Pick<ToolExecutionContext, "workspaceRoots">) {
  const resolution = tryResolveAllowedPath(context, requested);

  if (!resolution.ok) {
    return resolutionToResult(resolution.error);
  }

  return resolution.path.resolved;
}

function extractLeadingDirectoryChange(command: string): { command: string; cwd: string } | undefined {
  const trimmed = command.trim();
  const prefix = trimmed.match(/^(?:cd|chdir)(?:\s+\/d)?\s+/i);

  if (!prefix) {
    return undefined;
  }

  const rest = trimmed.slice(prefix[0].length).trimStart();
  const split = splitOnFirstCommandSeparator(rest);
  if (!split) {
    return undefined;
  }

  const cwd = stripShellQuotes(split.left.trim());
  const nextCommand = split.right.trim();
  if (!cwd || !nextCommand) {
    return undefined;
  }

  return { command: nextCommand, cwd };
}

function splitOnFirstCommandSeparator(value: string): { left: string; right: string } | undefined {
  let quote: "\"" | "'" | undefined;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (quote) {
      if (char === quote) {
        quote = undefined;
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }

    if (char === ";") {
      return {
        left: value.slice(0, index),
        right: value.slice(index + 1),
      };
    }

    if (char === "&" && value[index + 1] === "&") {
      return {
        left: value.slice(0, index),
        right: value.slice(index + 2),
      };
    }
  }

  return undefined;
}

function normalizeCommonWindowsDialectCommand(command: string, shell: TerminalShellId | undefined) {
  if (invokesExplicitUnixShell(command)) {
    return command;
  }

  if (isWindowsCmdTerminal(shell)) {
    return normalizeCommonCmdDialectCommand(command);
  }

  if (!isPowerShellTerminal(shell)) {
    return command;
  }

  const segments = splitCommandSegments(command);
  if (segments.length === 0) {
    return command;
  }

  const normalizedSegments = segments.map((segment) => normalizePowerShellDialectSegment(segment));
  if (normalizedSegments.every((segment) => segment === undefined)) {
    return command;
  }

  return normalizedSegments.map((segment, index) => segment ?? segments[index]!.text).join("; ");
}

function normalizeCommonCmdDialectCommand(command: string) {
  const segments = splitCommandSegments(command);
  if (segments.length === 0) {
    return command;
  }

  const normalizedSegments = segments.map((segment) => normalizeCmdDialectSegment(segment));
  if (normalizedSegments.every((segment) => segment === undefined)) {
    return command;
  }

  return normalizedSegments.map((segment, index) => segment ?? segments[index]!.text).join(" && ");
}

function splitCommandSegments(command: string) {
  const segments: Array<{ separator?: "&&" | ";"; text: string }> = [];
  let quote: "\"" | "'" | undefined;
  let start = 0;
  let nextSeparator: "&&" | ";" | undefined;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];

    if (quote) {
      if (char === quote) {
        quote = undefined;
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }

    if (char === ";" || (char === "&" && command[index + 1] === "&")) {
      const text = command.slice(start, index).trim();
      if (text) {
        segments.push({ separator: nextSeparator, text });
      }
      nextSeparator = char === ";" ? ";" : "&&";
      if (char === "&") {
        index += 1;
      }
      start = index + 1;
    }
  }

  const finalText = command.slice(start).trim();
  if (finalText) {
    segments.push({ separator: nextSeparator, text: finalText });
  }

  return segments;
}

function normalizePowerShellDialectSegment(segment: { separator?: "&&" | ";"; text: string }) {
  const parsed = parseShellWords(segment.text);
  if (parsed.length === 0) {
    return undefined;
  }

  const command = parsed[0]!.toLowerCase();
  if (command === "mkdir" && parsed[1] === "-p" && parsed.length >= 3) {
    const paths = parsed.slice(2);
    return paths
      .map((path) => `New-Item -ItemType Directory -Force -Path ${quotePowerShellLiteral(path)} | Out-Null`)
      .join("; ");
  }

  if (command !== "ls") {
    return undefined;
  }

  const options = parsed.filter((word, index) => index > 0 && /^-[a-z]+$/i.test(word));
  const hasUnixLongOption = options.some((option) => /l/i.test(option));
  const hasAllOption = options.some((option) => /a/i.test(option));
  if (!hasUnixLongOption && !hasAllOption) {
    return undefined;
  }

  const paths = parsed.slice(1).filter((word) => !/^-[a-z]+$/i.test(word));
  const target = paths[0];
  return target
    ? `Get-ChildItem -Force -LiteralPath ${quotePowerShellLiteral(target)}`
    : "Get-ChildItem -Force";
}

function normalizeCmdDialectSegment(segment: { separator?: "&&" | ";"; text: string }) {
  const parsed = parseShellWords(segment.text);
  if (parsed.length === 0) {
    return undefined;
  }

  const command = parsed[0]!.toLowerCase();
  if (command === "mkdir" && parsed[1] === "-p" && parsed.length >= 3) {
    return parsed.slice(2)
      .map((path) => `if not exist ${quoteCmdArgument(path)} mkdir ${quoteCmdArgument(path)}`)
      .join(" && ");
  }

  if (command === "wc" && parsed[1] === "-l" && parsed[2]) {
    return `find /c /v "" ${quoteCmdArgument(parsed[2])}`;
  }

  if (command !== "ls") {
    return undefined;
  }

  const options = parsed.filter((word, index) => index > 0 && /^-[a-z]+$/i.test(word));
  const hasUnixLongOption = options.some((option) => /l/i.test(option));
  const hasAllOption = options.some((option) => /a/i.test(option));
  if (!hasUnixLongOption && !hasAllOption) {
    return undefined;
  }

  const paths = parsed.slice(1).filter((word) => !/^-[a-z]+$/i.test(word));
  const target = paths[0];
  return target
    ? `dir /a ${quoteCmdArgument(target)}`
    : "dir /a";
}

function parseShellWords(value: string) {
  const words: string[] = [];
  let quote: "\"" | "'" | undefined;
  let current = "";

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;

    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        words.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) {
    words.push(current);
  }

  return words;
}

function formatBufferedTerminalOutput(command: string, response: Awaited<ReturnType<TerminalBackend["runCommand"]>>) {
  return [
    `Terminal command: ${command}`,
    `cwd: ${response.workingDirectory}`,
    `shell: ${response.shell}`,
    `Exit code: ${response.exitCode ?? "unknown"}`,
    `Duration: ${response.durationMs} ms${response.timedOut ? " (timed out)" : ""}${response.outputTruncated ? " (output truncated)" : ""}`,
    response.stdout.trim() ? ["", "stdout:", response.stdout.trim()].join("\n") : "",
    response.stderr.trim() ? ["", "stderr:", response.stderr.trim()].join("\n") : "",
  ].filter(Boolean).join("\n");
}

function formatTerminalChunks(chunks: TerminalDrainResponse["chunks"]) {
  return chunks.map((chunk) => chunk.text).join("");
}

function stringArg(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function terminalShellArg(value: unknown): TerminalShellId | undefined {
  return TERMINAL_SHELLS.includes(value as TerminalShellId) ? value as TerminalShellId : undefined;
}

function resolveContextTerminalShell(context: Pick<ToolExecutionContext, "agentEnvironment" | "terminalDefaultShell" | "workspaceRoots">): TerminalShellId | undefined {
  if (context.agentEnvironment === "wsl") {
    return "wsl";
  }

  if (context.agentEnvironment === "auto" && context.workspaceRoots?.some(isWslWorkspaceRoot)) {
    return "wsl";
  }

  return context.terminalDefaultShell ?? getHostDefaultTerminalShell();
}

function getHostDefaultTerminalShell(): TerminalShellId | undefined {
  return isLikelyWindowsRuntime() ? "powershell" : undefined;
}

function resolveTerminalShellForCommand(command: string, shell: TerminalShellId | undefined): TerminalShellId | undefined {
  if (shell === "cmd" && looksLikePowerShellCommand(command)) {
    return "powershell";
  }

  return shell;
}

function isWslWorkspaceRoot(root: string) {
  return /^\\\\(?:wsl\$|wsl\.localhost)\\/i.test(root);
}

function createShellDialectGuard(command: string, shell: TerminalShellId | undefined): ToolExecutionResult | undefined {
  if ((!isPowerShellTerminal(shell) && !isWindowsCmdTerminal(shell)) || invokesExplicitUnixShell(command)) {
    return undefined;
  }

  const wcLineMatch = command.match(/^\s*wc(?:\.exe)?\s+-l(?:\s+(.+?))?\s*$/i);
  if (!wcLineMatch) {
    return undefined;
  }

  const target = wcLineMatch[1]?.trim() ?? "";
  if (isWindowsCmdTerminal(shell)) {
    const cmdEquivalent = target
      ? `find /c /v "" ${quoteCmdArgument(stripShellQuotes(target))}`
      : "find /c /v \"\" <path>";

    return createErrorResult([
      "terminal_run did not execute this command because `wc -l` is a Unix shell command and the active/default terminal shell is Command Prompt on Windows.",
      "For workspace source line counts, use the files_count_lines tool instead of terminal_run.",
      `Command Prompt equivalent: ${cmdEquivalent}`,
    ].join("\n"));
  }

  const powershellEquivalent = target
    ? `(Get-Content -LiteralPath ${quotePowerShellLiteral(stripShellQuotes(target))} | Measure-Object -Line).Lines`
    : "(Get-Content -LiteralPath '<path>' | Measure-Object -Line).Lines";

  return createErrorResult([
    "terminal_run did not execute this command because `wc -l` is a Unix shell command and the active/default terminal shell is PowerShell on Windows.",
    "For workspace source line counts, use the files_count_lines tool instead of terminal_run.",
    `PowerShell equivalent: ${powershellEquivalent}`,
  ].join("\n"));
}

function isPowerShellTerminal(shell: TerminalShellId | undefined) {
  if (shell === "powershell") {
    return true;
  }

  return !shell && isLikelyWindowsRuntime();
}

function isWindowsCmdTerminal(shell: TerminalShellId | undefined) {
  return shell === "cmd";
}

function looksLikePowerShellCommand(command: string) {
  return /(?:^|[;&|]\s*)(?:\$env:[A-Za-z_][\w]*\s*=|Get-ChildItem|Get-Content|New-Item|Set-Location|Write-Output|Select-String|Measure-Object|Out-Null|Remove-Item|Copy-Item|Move-Item|Join-Path|Test-Path|Where-Object|ForEach-Object)\b/i.test(command);
}

function invokesExplicitUnixShell(command: string) {
  return /^\s*(?:[\w .:\\/-]+[\\/])?(?:bash|sh|zsh|wsl)(?:\.exe)?\b/i.test(command);
}

function isLikelyWindowsRuntime() {
  if (typeof navigator !== "undefined") {
    return /\bwindows\b/i.test(navigator.userAgent) || /\bwin/i.test(navigator.platform);
  }

  const processPlatform = (globalThis as { process?: { platform?: unknown } }).process?.platform;
  if (typeof processPlatform === "string") {
    return processPlatform === "win32";
  }

  return true;
}

function stripShellQuotes(value: string) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function quotePowerShellLiteral(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function quoteCmdArgument(value: string) {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function booleanArg(value: unknown) {
  return value === true;
}

function integerArg(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.floor(value)));
}

function normalizePreviewUrl(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }
    if (isLoopbackHostname(url.hostname)) {
      url.hostname = "localhost";
    }
    return url.href;
  } catch {
    return undefined;
  }
}

function findLocalPreviewUrl(text: string) {
  const match = text.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/[^\s"'<>)]*)?/i)?.[0];
  return normalizePreviewUrl(match);
}

async function probeReadyPreviewUrl(backend: TerminalBackend, previewUrl: string | undefined) {
  const normalizedUrl = normalizePreviewUrl(previewUrl);

  if (!normalizedUrl || !backend.probeUrl) {
    return undefined;
  }

  const probe = await backend.probeUrl(normalizedUrl);
  return probe.ok ? normalizedUrl : undefined;
}

function isLoopbackHostname(hostname: string) {
  const host = hostname.toLowerCase();
  return host === "127.0.0.1" || host === "0.0.0.0" || host === "::1" || host === "[::1]";
}

function createErrorResult(message: string): ToolExecutionResult {
  return {
    content: message,
    error: message,
    ok: false,
  };
}

function resolutionToResult(error: PathResolutionError): ToolExecutionResult {
  return createErrorResult(error.message);
}

function readErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
