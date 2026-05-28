import {
  createTerminalSession,
  drainTerminalSession,
  isTauriDesktopRuntime,
  runTerminalCommand,
  writeTerminalSession,
} from "../../../app/tauriClient";
import {
  getBackgroundTerminalSessions,
  appendBackgroundTerminalSessionOutput,
  registerBackgroundTerminalSession,
  unregisterBackgroundTerminalSession,
  updateBackgroundTerminalSession,
  type BackgroundTerminalSession,
} from "../../../lib/terminalSessions";
import type {
  TerminalCreateSessionRequest,
  TerminalCreateSessionResponse,
  TerminalDrainResponse,
  TerminalRunCommandRequest,
  TerminalRunCommandResponse,
  TerminalShellId,
} from "../../../types/terminal";

export interface TerminalBackgroundSessionRegistration {
  browserPreviewUrl?: string;
  command: string;
  outputPreview?: string;
  sessionId: string;
  shell?: TerminalShellId;
  startedAt?: number;
  workingDirectory?: string;
}

export interface TerminalBackend {
  createSession: (request: TerminalCreateSessionRequest) => Promise<TerminalCreateSessionResponse>;
  drainSession: (sessionId: string) => Promise<TerminalDrainResponse>;
  isAvailable: () => boolean;
  listBackgroundSessions: () => BackgroundTerminalSession[];
  probeUrl?: (url: string) => Promise<TerminalUrlProbeResult>;
  recordBackgroundSessionOutput: (sessionId: string, chunks: TerminalDrainResponse["chunks"]) => void;
  registerBackgroundSession: (session: TerminalBackgroundSessionRegistration) => void;
  runCommand: (request: TerminalRunCommandRequest) => Promise<TerminalRunCommandResponse>;
  unregisterBackgroundSession: (sessionId: string) => void;
  updateBackgroundSession: (sessionId: string, patch: Partial<Omit<BackgroundTerminalSession, "sessionId" | "startedAt">>) => void;
  writeSession: (sessionId: string, input: string) => Promise<void>;
}

export interface TerminalUrlProbeResult {
  error?: string;
  ok: boolean;
  status?: number;
  url: string;
}

export const defaultTerminalBackend: TerminalBackend = {
  createSession: (request) => createTerminalSession(request),
  drainSession: (sessionId) => drainTerminalSession(sessionId),
  isAvailable: () => isTauriDesktopRuntime(),
  listBackgroundSessions: () => getBackgroundTerminalSessions(),
  probeUrl: (url) => probeLocalUrl(url),
  recordBackgroundSessionOutput: (sessionId, chunks) => appendBackgroundTerminalSessionOutput(sessionId, chunks),
  registerBackgroundSession: (session) => registerBackgroundTerminalSession(session),
  runCommand: (request) => runTerminalCommand(request),
  unregisterBackgroundSession: (sessionId) => unregisterBackgroundTerminalSession(sessionId),
  updateBackgroundSession: (sessionId, patch) => updateBackgroundTerminalSession(sessionId, patch),
  writeSession: (sessionId, input) => writeTerminalSession(sessionId, input),
};

async function probeLocalUrl(url: string): Promise<TerminalUrlProbeResult> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 1_200);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      method: "GET",
      mode: "no-cors",
      signal: controller.signal,
    });

    return {
      ok: true,
      status: response.status || undefined,
      url,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Localhost probe failed.",
      ok: false,
      url,
    };
  } finally {
    window.clearTimeout(timeoutId);
  }
}
