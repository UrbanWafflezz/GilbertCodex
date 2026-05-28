import type { BackgroundTerminalSession } from "../../../lib/terminalSessions";
import type { TerminalDrainResponse } from "../../../types/terminal";
import { PathResolutionError, tryResolveAllowedPath } from "../../paths";
import type { JsonValue, ToolDefinition, ToolExecutionContext, ToolExecutionResult } from "../../types";
import { defaultTerminalBackend, type TerminalBackend } from "./backend";

const COMMON_LOCALHOST_PORTS = [1420, 3000, 4173, 5173, 5174, 5000, 8000, 8080, 8787, 9000];
const MAX_READ_CHARS = 24_000;

export function createTerminalListSessionsTool(backend: TerminalBackend = defaultTerminalBackend): ToolDefinition {
  return {
    description:
      "List app-owned background terminal sessions Gilbert can reuse or inspect. Use this before starting dev servers to avoid duplicates.",
    execute: async () => {
      const sessions = backend.listBackgroundSessions();

      return {
        content: formatSessionList(sessions),
        data: {
          sessions: sessions.map(serializeSession),
        } as JsonValue,
        ok: true,
      };
    },
    executorMetadata: { family: "terminal", version: 1 },
    id: "terminal_list_sessions",
    inputSchema: {
      additionalProperties: false,
      properties: {},
      type: "object",
    },
    permission: "read-only",
    risk: "read",
    title: "List terminal sessions",
  };
}

export function createTerminalReadSessionTool(backend: TerminalBackend = defaultTerminalBackend): ToolDefinition {
  return {
    description:
      "Read new output and status from an app-owned terminal session. This only works for sessions Gilbert owns; it cannot read another Windows Terminal or PowerShell scrollback.",
    execute: async (args) => {
      const sessionId = stringArg(args.sessionId);

      if (!sessionId) {
        return createErrorResult("terminal_read_session requires a sessionId from terminal_list_sessions or terminal_run.");
      }

      if (!backend.isAvailable()) {
        return createErrorResult("terminal_read_session is available only in the Tauri desktop app.");
      }

      try {
        const drain = await backend.drainSession(sessionId);
        const output = formatTerminalChunks(drain.chunks);
        const outputPreview = limitText(output, integerArg(args.maxChars, 12_000, 1_000, MAX_READ_CHARS));
        backend.recordBackgroundSessionOutput(sessionId, drain.chunks);
        backend.updateBackgroundSession(sessionId, {
          workingDirectory: drain.workingDirectory,
        });

        return {
          content: formatSessionRead(sessionId, drain, outputPreview),
          data: {
            activeCommand: drain.activeCommand ?? null,
            chunks: drain.chunks,
            commandRunning: drain.commandRunning ?? false,
            exitCode: drain.exitCode ?? null,
            lastCommandCompleted: drain.lastCommandCompleted ?? false,
            lastCommandExitCode: drain.lastCommandExitCode ?? null,
            output: outputPreview,
            sessionId,
            workingDirectory: drain.workingDirectory ?? null,
          } as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not read that terminal session."));
      }
    },
    executorMetadata: { family: "terminal", version: 1 },
    id: "terminal_read_session",
    inputSchema: {
      additionalProperties: false,
      properties: {
        maxChars: {
          description: "Maximum output characters to return. Defaults to 12000.",
          maximum: MAX_READ_CHARS,
          minimum: 1000,
          type: "integer",
        },
        sessionId: {
          description: "An app-owned terminal session id from terminal_run or terminal_list_sessions.",
          minLength: 1,
          type: "string",
        },
      },
      required: ["sessionId"],
      type: "object",
    },
    permission: "read-only",
    risk: "read",
    title: "Read terminal session",
  };
}

export function createTerminalDevServerStatusTool(backend: TerminalBackend = defaultTerminalBackend): ToolDefinition {
  return {
    description:
      "Check whether a dev server already appears to be running for this project. It scans app-owned terminal sessions plus the configured/inferred localhost target so Gilbert can reuse exact matches instead of starting duplicates. Common localhost ports are reported only as non-blocking diagnostics. It does not read external terminal scrollback.",
    execute: async (args, context) => {
      const cwd = resolveOptionalCwd(args.cwd ?? args.workingDirectory, context);
      if (cwd && typeof cwd !== "string") {
        return cwd;
      }

      const command = stringArg(args.command);
      const previewUrl = normalizeLocalPreviewUrl(stringArg(args.previewUrl));
      const ports = portListArg(args.ports);
      const sessions = backend.listBackgroundSessions();
      const matchingSessions = sessions.filter((session) => sessionMatchesRequest(session, { command, cwd, previewUrl }));
      const targetUrls = collectTargetUrls({ command, ports, previewUrl });
      const candidateUrls = collectCandidateUrls({
        command,
        ports,
        previewUrl,
        sessions,
      });
      const probes = await probeCandidateUrls(backend, candidateUrls);
      const targetUrlSet = new Set(targetUrls);
      const appOwnedUrls = new Set(sessions.flatMap((session) => session.browserPreviewUrl ? [normalizeLocalPreviewUrl(session.browserPreviewUrl)] : []).filter(Boolean) as string[]);
      const targetProbes = probes.filter((probe) => targetUrlSet.has(probe.url));
      const matchingExternalServers = targetProbes.filter((probe) => probe.ok && !appOwnedUrls.has(probe.url));
      const unrelatedReachableLocalhost = probes.filter((probe) => probe.ok && !targetUrlSet.has(probe.url) && !appOwnedUrls.has(probe.url));
      const selectedPreviewUrl = matchingSessions.find((session) => session.browserPreviewUrl)?.browserPreviewUrl ?? matchingExternalServers[0]?.url ?? previewUrl;
      const reuseRecommended = matchingSessions.length > 0 || matchingExternalServers.length > 0;

      return {
        content: formatDevServerStatus({
          matchingExternalServers,
          matchingSessions,
          probes,
          reuseRecommended,
          selectedPreviewUrl,
          targetUrls,
          unrelatedReachableLocalhost,
        }),
        data: {
          appOwnedSessions: matchingSessions.map(serializeSession),
          externalServers: matchingExternalServers,
          matchingExternalServers,
          probes,
          reuseRecommended,
          selectedPreviewUrl: selectedPreviewUrl ?? null,
          targetUrls,
          unrelatedReachableLocalhost,
          warning: "External terminal scrollback is not readable unless the process is app-owned or writes logs to an accessible file.",
        } as JsonValue,
        ok: true,
      };
    },
    executorMetadata: { family: "terminal", version: 1 },
    id: "terminal_dev_server_status",
    inputSchema: {
      additionalProperties: false,
      properties: {
        command: {
          description: "The command Gilbert is considering, used to match app-owned sessions and infer ports.",
          minLength: 1,
          type: "string",
        },
        cwd: {
          description: "Working directory inside the selected workspace.",
          minLength: 1,
          type: "string",
        },
        ports: {
          description: "Optional localhost ports to probe.",
          items: {
            maximum: 65535,
            minimum: 1,
            type: "integer",
          },
          maxItems: 16,
          type: "array",
        },
        previewUrl: {
          description: "Configured or detected localhost preview URL to probe.",
          minLength: 1,
          type: "string",
        },
        workingDirectory: {
          description: "Alias for cwd.",
          minLength: 1,
          type: "string",
        },
      },
      type: "object",
    },
    permission: "read-only",
    risk: "read",
    title: "Check dev server status",
  };
}

function formatSessionList(sessions: BackgroundTerminalSession[]) {
  if (sessions.length === 0) {
    return [
      "No app-owned background terminal sessions are currently registered.",
      "External terminal scrollback cannot be read by Gilbert. Use terminal_dev_server_status to probe localhost before starting a duplicate dev server.",
    ].join("\n");
  }

  return [
    `App-owned terminal sessions: ${sessions.length}`,
    ...sessions.map((session) => {
      const parts = [
        `session=${session.sessionId}`,
        session.workingDirectory ? `cwd=${session.workingDirectory}` : "",
        session.shell ? `shell=${session.shell}` : "",
        session.browserPreviewUrl ? `url=${session.browserPreviewUrl}` : "",
      ].filter(Boolean);

      return `- ${session.command} (${parts.join(", ")})`;
    }),
  ].join("\n");
}

function formatSessionRead(sessionId: string, drain: TerminalDrainResponse, output: string) {
  return [
    `Terminal session: ${sessionId}`,
    `cwd: ${drain.workingDirectory ?? "unknown"}`,
    `running: ${drain.commandRunning ? "yes" : "no"}`,
    drain.activeCommand ? `active command: ${drain.activeCommand}` : "",
    drain.lastCommandCompleted ? `last exit code: ${drain.lastCommandExitCode ?? "unknown"}` : "",
    output ? ["", "New output:", output].join("\n") : "No new output was available.",
  ].filter(Boolean).join("\n");
}

function formatDevServerStatus({
  matchingExternalServers,
  matchingSessions,
  probes,
  reuseRecommended,
  selectedPreviewUrl,
  targetUrls,
  unrelatedReachableLocalhost,
}: {
  matchingExternalServers: Array<{ ok: boolean; status?: number; url: string }>;
  matchingSessions: BackgroundTerminalSession[];
  probes: Array<{ error?: string; ok: boolean; status?: number; url: string }>;
  reuseRecommended: boolean;
  selectedPreviewUrl?: string;
  targetUrls: string[];
  unrelatedReachableLocalhost: Array<{ ok: boolean; status?: number; url: string }>;
}) {
  const lines = [
    "Dev server status",
    `Reuse recommended: ${reuseRecommended ? "yes" : "no"}`,
    selectedPreviewUrl ? `Preview URL: ${selectedPreviewUrl}` : "",
    `App-owned matching sessions: ${matchingSessions.length}`,
    targetUrls.length > 0 ? `Target URLs: ${targetUrls.join(", ")}` : "Target URLs: none",
  ].filter(Boolean);

  for (const session of matchingSessions.slice(0, 6)) {
    lines.push(`- ${session.sessionId}: ${session.command}${session.browserPreviewUrl ? ` (${session.browserPreviewUrl})` : ""}`);
  }

  if (probes.length > 0) {
    lines.push("Localhost probes:");
    for (const probe of probes) {
      lines.push(`- ${probe.url}: ${probe.ok ? `reachable${probe.status ? ` (${probe.status})` : ""}` : `not reachable${probe.error ? ` (${probe.error})` : ""}`}`);
    }
  }

  if (matchingExternalServers.length > 0) {
    lines.push("Matching external localhost server detected. Reuse and diagnose it, but do not claim to read its terminal scrollback.");
  } else {
    lines.push("No matching external localhost server was detected for the requested target.");
  }

  if (unrelatedReachableLocalhost.length > 0) {
    lines.push("Other reachable localhost servers were found but are not reusable for this run because they do not match the requested target:");
    for (const probe of unrelatedReachableLocalhost) {
      lines.push(`- ${probe.url}`);
    }
  }

  return lines.join("\n");
}

function serializeSession(session: BackgroundTerminalSession) {
  return {
    browserPreviewUrl: session.browserPreviewUrl ?? null,
    command: session.command,
    lastSeenAt: session.lastSeenAt,
    outputPreview: session.outputPreview ?? null,
    sessionId: session.sessionId,
    shell: session.shell ?? null,
    startedAt: session.startedAt,
    workingDirectory: session.workingDirectory ?? null,
  };
}

function sessionMatchesRequest(
  session: BackgroundTerminalSession,
  request: { command?: string; cwd?: string; previewUrl?: string },
) {
  const cwdMatches = !request.cwd || normalizePathKey(session.workingDirectory) === normalizePathKey(request.cwd);
  const commandMatches = !request.command || normalizeCommandKey(session.command) === normalizeCommandKey(request.command);
  const urlMatches = !request.previewUrl || normalizeLocalPreviewUrl(session.browserPreviewUrl) === request.previewUrl;

  return cwdMatches && (commandMatches || urlMatches || (!request.command && !request.previewUrl));
}

function collectCandidateUrls({
  command,
  ports,
  previewUrl,
  sessions,
}: {
  command?: string;
  ports: number[];
  previewUrl?: string;
  sessions: BackgroundTerminalSession[];
}) {
  const urls = new Set<string>();
  const addUrl = (url: string | undefined) => {
    const normalized = normalizeLocalPreviewUrl(url);
    if (normalized) {
      urls.add(normalized);
    }
  };

  addUrl(previewUrl);
  for (const session of sessions) {
    addUrl(session.browserPreviewUrl);
  }

  for (const port of [...ports, ...extractPortsFromCommand(command), ...COMMON_LOCALHOST_PORTS]) {
    addUrl(`http://localhost:${port}/`);
  }

  return [...urls].slice(0, 24);
}

function collectTargetUrls({
  command,
  ports,
  previewUrl,
}: {
  command?: string;
  ports: number[];
  previewUrl?: string;
}) {
  const urls = new Set<string>();
  const addUrl = (url: string | undefined) => {
    const normalized = normalizeLocalPreviewUrl(url);
    if (normalized) {
      urls.add(normalized);
    }
  };

  addUrl(previewUrl);
  for (const port of [...ports, ...extractPortsFromCommand(command)]) {
    addUrl(`http://localhost:${port}/`);
  }

  return [...urls];
}

async function probeCandidateUrls(backend: TerminalBackend, urls: string[]) {
  const probeUrl: NonNullable<TerminalBackend["probeUrl"]> = backend.probeUrl ?? (async (url: string) => ({
    error: "No localhost probe backend is available.",
    ok: false,
    url,
  }));
  const probes = await Promise.all(urls.map((url) => probeUrl(url)));

  return probes.map((probe) => ({
    error: probe.error,
    ok: probe.ok,
    status: probe.status,
    url: normalizeLocalPreviewUrl(probe.url) ?? probe.url,
  }));
}

function resolveOptionalCwd(value: unknown, context: Pick<ToolExecutionContext, "workspaceRoots">): string | ToolExecutionResult | undefined {
  const requested = stringArg(value);

  if (!requested) {
    return undefined;
  }

  const resolution = tryResolveAllowedPath(context, requested);

  if (!resolution.ok) {
    return resolutionToResult(resolution.error);
  }

  return resolution.path.resolved;
}

function portListArg(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((port): port is number => typeof port === "number" && Number.isFinite(port))
    .map((port) => Math.floor(port))
    .filter((port) => port > 0 && port <= 65535)
    .slice(0, 16);
}

function extractPortsFromCommand(command: string | undefined) {
  if (!command) {
    return [];
  }

  const ports = new Set<number>();
  const patterns = [
    /(?:--port(?:=|\s+)|\bPORT=|\bPORT\s*=\s*)(\d{2,5})/gi,
    /localhost:(\d{2,5})/gi,
    /127\.0\.0\.1:(\d{2,5})/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(command)) !== null) {
      const port = Number(match[1]);
      if (Number.isFinite(port) && port > 0 && port <= 65535) {
        ports.add(port);
      }
    }
  }

  return [...ports];
}

function normalizeLocalPreviewUrl(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }
    if (!isLoopbackHostname(url.hostname)) {
      return undefined;
    }
    if (url.hostname !== "localhost") {
      url.hostname = "localhost";
    }
    if (!url.pathname) {
      url.pathname = "/";
    }
    return url.href;
  } catch {
    return undefined;
  }
}

function isLoopbackHostname(hostname: string) {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1" || host === "[::1]";
}

function normalizeCommandKey(value: string | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizePathKey(value: string | undefined) {
  return (value ?? "").trim().replace(/[\\/]+$/, "").toLowerCase();
}

function formatTerminalChunks(chunks: TerminalDrainResponse["chunks"]) {
  return chunks.map((chunk) => chunk.text).join("");
}

function stringArg(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function integerArg(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.floor(value)));
}

function limitText(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars)}\n[output truncated]`;
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
