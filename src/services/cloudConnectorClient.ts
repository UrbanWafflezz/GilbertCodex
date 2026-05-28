import { getGilbertFirebaseAuth } from "../firebase";

export type CloudConnectorKind = "discord" | "github" | "google";

export interface CloudOAuthStartResponse {
  authorizationUrl: string;
  expiresAt: number;
  interval: number;
  mode?: "browser" | "device";
  service: CloudConnectorKind;
  state: string;
  userCode?: string;
  verificationUri?: string;
}

export interface CloudOAuthStatusResponse<TAccount = unknown> {
  account?: TAccount;
  error?: string;
  message?: string;
  status: "authorized" | "error" | "expired" | "pending";
}

export interface CloudConnectorApiResponse<TData = unknown> {
  data: TData;
  message: string;
  method: string;
  path: string;
  service?: string;
  status: number;
}

export const CLOUD_CONNECTOR_FIREBASE_ID_TOKEN_HEADER = "X-Gilbert-Firebase-ID-Token";

const CONNECTOR_URL_ENV: Record<CloudConnectorKind, string> = {
  discord: "VITE_GILBERT_DISCORD_CONNECTOR_URL",
  github: "VITE_GILBERT_GITHUB_CONNECTOR_URL",
  google: "VITE_GILBERT_GOOGLE_CONNECTOR_URL",
};

export function getConfiguredCloudConnectorUrl(kind: CloudConnectorKind) {
  return normalizeConnectorUrl(readViteEnv(CONNECTOR_URL_ENV[kind]));
}

export function isCloudConnectorEnabled(kind: CloudConnectorKind) {
  return Boolean(getConfiguredCloudConnectorUrl(kind));
}

export async function getCloudConnectorAccount<TAccount>(kind: CloudConnectorKind): Promise<TAccount> {
  return cloudConnectorRequest<TAccount>(kind, "/account");
}

export async function disconnectCloudConnector<TAccount>(kind: CloudConnectorKind): Promise<TAccount> {
  return cloudConnectorRequest<TAccount>(kind, "/disconnect", {
    method: "POST",
  });
}

export async function startCloudConnectorOAuth(kind: CloudConnectorKind, body: Record<string, unknown> = {}) {
  return cloudConnectorRequest<CloudOAuthStartResponse>(kind, "/oauth/start", {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });
}

export async function pollCloudConnectorOAuth<TAccount>(kind: CloudConnectorKind, state: string) {
  return cloudConnectorRequest<CloudOAuthStatusResponse<TAccount>>(kind, `/oauth/status?state=${encodeURIComponent(state)}`);
}

export async function waitForCloudConnectorOAuth<TAccount>(
  kind: CloudConnectorKind,
  session: CloudOAuthStartResponse,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
) {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? 300_000;
  let intervalMs = Math.max(1, session.interval || 2) * 1000;

  while (Date.now() - startedAt < timeoutMs) {
    if (options.signal?.aborted) {
      throw new Error("Sign-in was canceled.");
    }

    const status = await pollCloudConnectorOAuth<TAccount>(kind, session.state);
    if (status.status === "authorized" && status.account) {
      return status.account;
    }

    if (status.status === "error" || status.status === "expired") {
      throw new Error(status.error || status.message || "Cloud sign-in failed.");
    }

    await delay(intervalMs, options.signal);
    intervalMs = Math.min(intervalMs + 250, 5000);
  }

  throw new Error("Cloud sign-in timed out. Start sign-in again.");
}

export async function cloudConnectorApi<TData = unknown>(
  kind: Exclude<CloudConnectorKind, "discord">,
  request: {
    body?: unknown;
    method: string;
    path: string;
    query?: Record<string, unknown>;
    service?: "calendar" | "gmail" | "tasks";
  },
) {
  return cloudConnectorRequest<CloudConnectorApiResponse<TData>>(kind, "/api", {
    body: JSON.stringify(request),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });
}

export async function cloudConnectorRequest<TResponse>(kind: CloudConnectorKind, path: string, init: RequestInit = {}): Promise<TResponse> {
  const baseUrl = getConfiguredCloudConnectorUrl(kind);
  if (!baseUrl) {
    throw new Error(`${kind} cloud connector is not configured.`);
  }

  const user = getGilbertFirebaseAuth().currentUser;
  const token = user ? await user.getIdToken().catch(() => "") : "";
  if (!token) {
    throw new Error("Sign in to Gilbert before connecting cloud apps.");
  }

  const headers = new Headers(init.headers);
  headers.set(CLOUD_CONNECTOR_FIREBASE_ID_TOKEN_HEADER, token);

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
  });
  const payload = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(readErrorMessage(payload, `${kind} cloud connector failed with HTTP ${response.status}.`));
  }

  return payload as TResponse;
}

function normalizeConnectorUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return "";
    }
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

async function readJsonResponse(response: Response) {
  const text = await response.text();
  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { text };
  }
}

function readErrorMessage(payload: unknown, fallback: string) {
  if (typeof payload === "object" && payload) {
    const record = payload as Record<string, unknown>;
    for (const key of ["error", "message", "text"]) {
      if (typeof record[key] === "string" && record[key].trim()) {
        return record[key].trim();
      }
    }
  }

  return fallback;
}

function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Sign-in was canceled."));
      return;
    }

    const timeoutId = window.setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(new Error("Sign-in was canceled."));
    };
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      signal?.removeEventListener("abort", onAbort);
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function readViteEnv(key: string) {
  return (import.meta.env as Record<string, string | undefined>)[key]?.trim() ?? "";
}
