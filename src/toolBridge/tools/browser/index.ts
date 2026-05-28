import { getBackgroundTerminalSessions } from "../../../lib/terminalSessions";
import { getBrowserConsoleSnapshot, type BrowserConsoleFilter, type BrowserConsoleSnapshot, type BrowserConsoleSnapshotOptions } from "../../../lib/browserConsole";
import { captureBrowserPreviewScreenshot, type BrowserPreviewScreenshotOptions, type BrowserPreviewScreenshotResult } from "../../../lib/browserPreviewCapture";
import type { JsonValue, ToolDefinition, ToolExecutionResult } from "../../types";

export interface BrowserPreviewBackend {
  captureScreenshot?: (options?: BrowserPreviewScreenshotOptions) => BrowserPreviewScreenshotResult | Promise<BrowserPreviewScreenshotResult>;
  getBackgroundPreviewUrls: () => string[];
  getCurrentAppUrl: () => string | undefined;
  readConsoleSnapshot?: (options?: BrowserConsoleSnapshotOptions) => BrowserConsoleSnapshot;
  screenshotCaptureTimeoutMs?: number;
}

const BROWSER_SCREENSHOT_CAPTURE_TIMEOUT_MS = 15_000;
const BROWSER_SCREENSHOT_TOOL_TIMEOUT_MS = 18_000;

export const defaultBrowserPreviewBackend: BrowserPreviewBackend = {
  getBackgroundPreviewUrls: () =>
    getBackgroundTerminalSessions()
      .map((session) => session.browserPreviewUrl)
      .filter((url): url is string => Boolean(url)),
  captureScreenshot: captureBrowserPreviewScreenshot,
  getCurrentAppUrl: () => (typeof window === "undefined" ? undefined : window.location.href),
  readConsoleSnapshot: getBrowserConsoleSnapshot,
};

export function createBrowserPreviewTool(backend: BrowserPreviewBackend = defaultBrowserPreviewBackend): ToolDefinition {
  return {
    description:
      "Open the in-app browser preview to a local app URL or public HTTPS page. " +
      "Use this after starting a dev server or when the user asks to preview a site. " +
      "If url is omitted, the tool uses the most recent background terminal session that reported a localhost preview URL.",
    execute: (args) => {
      const requestedUrl = stringArg(args.url);
      const candidateUrl = requestedUrl ?? backend.getBackgroundPreviewUrls()[0];

      if (!candidateUrl) {
        return createErrorResult("No browser preview URL was provided and no background terminal session has a preview URL yet.");
      }

      const normalizedUrl = normalizeBrowserPreviewUrl(candidateUrl, backend.getCurrentAppUrl());
      if (!normalizedUrl.ok) {
        return createErrorResult(normalizedUrl.error);
      }

      return {
        content: [
          "Browser preview opened.",
          `Browser preview URL: ${normalizedUrl.url}`,
        ].join("\n"),
        data: {
          browserPreviewUrl: normalizedUrl.url,
          url: normalizedUrl.url,
        } as JsonValue,
        ok: true,
      };
    },
    executorMetadata: { family: "browser", version: 1 },
    id: "browser_preview_open",
    inputSchema: {
      additionalProperties: false,
      properties: {
        url: {
          description: "Optional http(s) URL. Omit to reuse the latest localhost URL from a background terminal session.",
          minLength: 1,
          type: "string",
        },
      },
      type: "object",
    },
    permission: "read-only",
    risk: "read",
    title: "Open browser preview",
  };
}

export function createBrowserTools(backend: BrowserPreviewBackend = defaultBrowserPreviewBackend): ToolDefinition[] {
  return [
    createBrowserPreviewTool(backend),
    createBrowserConsoleReadTool(backend),
    createBrowserScreenshotCaptureTool(backend),
  ];
}

export const browserTools: ToolDefinition[] = createBrowserTools();

export function createBrowserConsoleReadTool(backend: BrowserPreviewBackend = defaultBrowserPreviewBackend): ToolDefinition {
  return {
    description:
      "Read the in-app browser console captured from browser preview tabs, including console logs, warnings, errors, page errors, unhandled rejections, navigation events, localhost probe failures, and native browser view issues. " +
      "Use this when debugging a website or visual preview so the assistant can see browser-side problems before editing code.",
    execute: (args) => {
      const options: BrowserConsoleSnapshotOptions = {
        level: normalizeConsoleFilter(args.level),
        maxEntries: numberArg(args.maxEntries),
        query: stringArg(args.query),
      };
      const snapshot = (backend.readConsoleSnapshot ?? getBrowserConsoleSnapshot)(options);

      return {
        content: formatBrowserConsoleToolContent(snapshot),
        data: snapshot as unknown as JsonValue,
        ok: true,
      };
    },
    executorMetadata: { family: "browser", version: 1 },
    id: "browser_console_read",
    inputSchema: {
      additionalProperties: false,
      properties: {
        level: {
          description: "Optional console level filter.",
          enum: ["all", "debug", "info", "log", "warning", "warn", "error"],
          type: "string",
        },
        maxEntries: {
          description: "Optional maximum number of most recent retained entries to return. Omit to read the full retained console.",
          minimum: 1,
          type: "integer",
        },
        query: {
          description: "Optional case-insensitive text filter across message, source, URL, stack, and tab title.",
          minLength: 1,
          type: "string",
        },
      },
      type: "object",
    },
    permission: "read-only",
    risk: "read",
    title: "Read browser console",
  };
}

export function createBrowserScreenshotCaptureTool(backend: BrowserPreviewBackend = defaultBrowserPreviewBackend): ToolDefinition {
  return {
    description:
      "Capture the currently visible in-app browser preview as a PNG screenshot image artifact. " +
      "Use this after browser_preview_open when debugging or verifying UI, visual layout, screenshots, localhost previews, browser rendering, or before/after fix evidence.",
    execute: async (args, context) => {
      try {
        context.reportProgress?.({
          content: "Capturing the current browser preview screenshot.",
          ok: true,
        });
        const result = await withBrowserScreenshotTimeout(
          (backend.captureScreenshot ?? captureBrowserPreviewScreenshot)({
            reason: stringArg(args.reason),
          }),
          backend.screenshotCaptureTimeoutMs ?? BROWSER_SCREENSHOT_CAPTURE_TIMEOUT_MS,
        );
        const includeConsole = booleanArg(args.includeConsole);
        const consoleSnapshot = includeConsole ? (backend.readConsoleSnapshot ?? getBrowserConsoleSnapshot)({
          maxEntries: numberArg(args.maxConsoleEntries),
        }) : undefined;

        return {
          content: formatBrowserScreenshotToolContent(result, consoleSnapshot),
          data: {
            artifacts: [result.artifact],
            browserScreenshot: {
              label: result.label,
              mode: result.mode,
              sizeBytes: result.sizeBytes,
              title: result.title,
              url: result.url,
            },
            console: consoleSnapshot,
          } as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(error instanceof Error ? error.message : "Could not capture the browser screenshot.");
      }
    },
    executorMetadata: { family: "browser", version: 1 },
    id: "browser_screenshot_capture",
    inputSchema: {
      additionalProperties: false,
      properties: {
        includeConsole: {
          description: "Also include a browser console snapshot alongside the screenshot.",
          type: "boolean",
        },
        maxConsoleEntries: {
          description: "Optional maximum number of console entries when includeConsole is true.",
          minimum: 1,
          type: "integer",
        },
        reason: {
          description: "Short reason for capturing the screenshot, used only as artifact context.",
          minLength: 1,
          type: "string",
        },
      },
      type: "object",
    },
    permission: "read-only",
    risk: "read",
    timeoutMs: BROWSER_SCREENSHOT_TOOL_TIMEOUT_MS,
    title: "Capture browser screenshot",
  };
}

function withBrowserScreenshotTimeout<T>(operation: T | Promise<T>, timeoutMs: number): Promise<T> {
  const boundedTimeoutMs = Math.max(1_000, Math.round(timeoutMs || BROWSER_SCREENSHOT_CAPTURE_TIMEOUT_MS));
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  return Promise.race([
    Promise.resolve(operation),
    new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(() => {
        const seconds = Math.max(1, Math.round(boundedTimeoutMs / 1000));
        reject(new Error(`Browser screenshot capture did not respond within ${seconds} ${seconds === 1 ? "second" : "seconds"}. Reopen the browser preview or read the browser console before trying another screenshot.`));
      }, boundedTimeoutMs);
    }),
  ]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}

function formatBrowserConsoleToolContent(snapshot: BrowserConsoleSnapshot) {
  const lines = [
    `Browser console: ${snapshot.retainedCount} retained entries (${snapshot.counts.error} errors, ${snapshot.counts.warning} warnings).`,
  ];

  if (snapshot.truncated) {
    lines.push(`Showing ${snapshot.entries.length} of ${snapshot.filteredCount} matching entries.`);
  } else if (snapshot.filteredCount !== snapshot.retainedCount) {
    lines.push(`Showing ${snapshot.filteredCount} matching entries.`);
  }

  if (snapshot.entries.length === 0) {
    lines.push("No browser console entries matched.");
    return lines.join("\n");
  }

  snapshot.entries.forEach((entry, index) => {
    lines.push(`${index + 1}. [${entry.level}] ${entry.message}`);

    const metadata = [
      entry.timestamp,
      entry.source,
      entry.tabTitle,
      entry.url,
      typeof entry.line === "number" ? `line ${entry.line}${typeof entry.column === "number" ? `:${entry.column}` : ""}` : "",
    ].filter(Boolean);

    if (metadata.length > 0) {
      lines.push(`   ${metadata.join(" | ")}`);
    }

    if (entry.stack) {
      lines.push(indentConsoleStack(entry.stack));
    }
  });

  return lines.join("\n");
}

function formatBrowserScreenshotToolContent(result: BrowserPreviewScreenshotResult, consoleSnapshot?: BrowserConsoleSnapshot) {
  return [
    "Browser screenshot captured.",
    `URL: ${result.url}`,
    `View: ${result.mode}`,
    `Image artifact: ${result.title}`,
    `Size: ${result.sizeBytes.toLocaleString("en-US")} bytes`,
    result.clip ? `Clip: ${Math.round(result.clip.width)}x${Math.round(result.clip.height)} at ${Math.round(result.clip.x)},${Math.round(result.clip.y)}` : "",
    consoleSnapshot ? `Console snapshot: ${consoleSnapshot.retainedCount} retained entries (${consoleSnapshot.counts.error} errors, ${consoleSnapshot.counts.warning} warnings).` : "",
    "The PNG image artifact is saved with this tool result and should be used as visual evidence.",
  ].filter(Boolean).join("\n");
}

function indentConsoleStack(stack: string) {
  return stack
    .split(/\r?\n/)
    .slice(0, 24)
    .map((line) => `   ${line}`)
    .join("\n");
}

function normalizeConsoleFilter(value: unknown): BrowserConsoleFilter | undefined {
  if (value === "warn") {
    return "warning";
  }

  return value === "all" || value === "debug" || value === "info" || value === "log" || value === "warning" || value === "error" ? value : undefined;
}

function normalizeBrowserPreviewUrl(rawUrl: string, currentAppUrl?: string): { ok: true; url: string } | { error: string; ok: false } {
  const candidate = createDirectUrlCandidate(rawUrl.trim());

  try {
    const url = new URL(candidate);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { error: "Browser preview only accepts http(s) URLs.", ok: false };
    }

    if (url.username || url.password) {
      return { error: "Browser preview refuses URLs with embedded credentials.", ok: false };
    }

    if (isCurrentAppUrl(url, currentAppUrl)) {
      return { error: "Browser preview will not open Gilbert Codex's own app URL.", ok: false };
    }

    const host = url.hostname.toLowerCase();
    if (isLoopbackHost(host)) {
      url.hostname = "localhost";
      return { ok: true, url: url.href };
    }

    if (url.protocol !== "https:") {
      return { error: "Browser preview only allows plain HTTP for localhost/loopback URLs. Use HTTPS for public pages.", ok: false };
    }

    if (isBlockedPrivateHost(host)) {
      return { error: `Browser preview blocked a private or local network host: ${host}`, ok: false };
    }

    return { ok: true, url: url.href };
  } catch {
    return { error: "Browser preview needs a valid http(s) URL.", ok: false };
  }
}

function createDirectUrlCandidate(value: string) {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    return value;
  }

  return isLocalHostInput(value) ? `http://${value}` : `https://${value}`;
}

function isLocalHostInput(value: string) {
  const input = value.toLowerCase();

  return (
    input === "localhost" ||
    input.startsWith("localhost:") ||
    input.startsWith("localhost/") ||
    input === "127.0.0.1" ||
    input.startsWith("127.0.0.1:") ||
    input.startsWith("127.0.0.1/") ||
    input === "0.0.0.0" ||
    input.startsWith("0.0.0.0:") ||
    input.startsWith("0.0.0.0/") ||
    input === "[::1]" ||
    input.startsWith("[::1]:") ||
    input.startsWith("[::1]/")
  );
}

function isLoopbackHost(host: string) {
  return host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1" || host === "[::1]";
}

function isCurrentAppUrl(url: URL, currentAppUrl?: string) {
  if (!currentAppUrl) {
    return false;
  }

  try {
    const current = new URL(currentAppUrl);

    if (url.origin === current.origin) {
      return true;
    }

    return url.protocol === current.protocol && url.port === current.port && isLoopbackHost(url.hostname.toLowerCase()) && isLoopbackHost(current.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function isBlockedPrivateHost(host: string) {
  if (
    host.includes("@") ||
    host.endsWith(".local") ||
    host.endsWith(".lan") ||
    host.endsWith(".internal") ||
    host.endsWith(".home") ||
    host === "host.docker.internal" ||
    !host.includes(".")
  ) {
    return true;
  }

  return isPrivateIpv4(host) || isSpecialIpv6(host);
}

function isPrivateIpv4(host: string) {
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) {
    return false;
  }

  const octets = match.slice(1).map(Number);
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return true;
  }

  const [a, b, c] = octets;
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  );
}

function isSpecialIpv6(host: string) {
  const normalized = host.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();

  return (
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("2001:db8")
  );
}

function stringArg(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberArg(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(1, Math.floor(value));
}

function booleanArg(value: unknown) {
  return value === true;
}

function createErrorResult(message: string): ToolExecutionResult {
  return {
    content: message,
    error: message,
    ok: false,
  };
}
