import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";

import { persistTenantData, restoreTenantData } from "./tenantStorage.js";

const DEFAULT_RUNTIME_START_TIMEOUT_MS = 90_000;
const DEFAULT_TENANT_IDLE_MS = 45 * 60_000;
const DEFAULT_REQUEST_BODY_LIMIT_BYTES = 20 * 1024 * 1024;
const CODEX_CALLBACK_PORT = 1455;
const XAI_CALLBACK_PORT = 56121;
const CLI_TOKEN_SALT = "9r-cli-auth";
export const NINE_ROUTER_CLI_TOKEN_HEADER = "x-9r-cli-token";

export class TenantRouterManager {
  constructor(options = {}) {
    this.runtimes = new Map();
    this.oauthStateToTenant = new Map();
    this.dataRoot = options.dataRoot || process.env.GILBERT_NINE_ROUTER_TENANT_DATA_ROOT || "/data/tenants";
    this.command = options.command || process.env.GILBERT_NINE_ROUTER_COMMAND || "npm";
    this.args = parseArgs(options.args || process.env.GILBERT_NINE_ROUTER_ARGS || "run,start");
    this.cwd = options.cwd || process.env.GILBERT_NINE_ROUTER_CWD || "/opt/9router";
    this.publicBaseUrl = normalizePublicBaseUrl(options.publicBaseUrl || process.env.GILBERT_PUBLIC_BASE_URL || "");
    this.idleMs = parsePositiveInteger(process.env.GILBERT_NINE_ROUTER_TENANT_IDLE_MS, DEFAULT_TENANT_IDLE_MS);
    this.startTimeoutMs = parsePositiveInteger(process.env.GILBERT_NINE_ROUTER_START_TIMEOUT_MS, DEFAULT_RUNTIME_START_TIMEOUT_MS);
    this.requestBodyLimitBytes = parsePositiveInteger(process.env.GILBERT_NINE_ROUTER_REQUEST_BODY_LIMIT_BYTES, DEFAULT_REQUEST_BODY_LIMIT_BYTES);
    this.allowUnsupportedDashboard = process.env.GILBERT_NINE_ROUTER_ALLOW_DASHBOARD === "true";
    this.persistenceEnabled = process.env.GILBERT_NINE_ROUTER_PERSISTENCE !== "false";

    setInterval(() => this.stopIdleRuntimes(), Math.min(this.idleMs, 5 * 60_000)).unref();
  }

  async getRuntime(uid) {
    const tenantId = createTenantId(uid);
    const existing = this.runtimes.get(tenantId);

    if (existing?.ready && existing.process.exitCode === null && !existing.process.killed) {
      existing.lastUsedAt = Date.now();
      return existing;
    }

    if (existing?.starting) {
      return existing.starting;
    }

    const starting = this.startRuntime(uid, tenantId).catch((error) => {
      const current = this.runtimes.get(tenantId);
      if (current?.starting === starting) {
        this.runtimes.delete(tenantId);
      }
      throw error;
    });
    this.runtimes.set(tenantId, { starting });
    return starting;
  }

  async startRuntime(uid, tenantId) {
    const port = await allocatePort();
    const dataDir = `${this.dataRoot}/${tenantId}`;
    await mkdir(dataDir, { recursive: true });

    if (this.persistenceEnabled) {
      const restored = await restoreTenantData(tenantId, dataDir);
      if (restored.fileCount > 0) {
        console.log(`[tenant:${tenantId}] restored ${restored.fileCount} persisted 9Router file(s)`);
      }
    }

    const cliToken = await ensureTenantCliToken(dataDir);

    const env = {
      ...process.env,
      BASE_URL: this.publicBaseUrl || `http://127.0.0.1:${port}`,
      DATA_DIR: dataDir,
      HOSTNAME: "127.0.0.1",
      NEXT_PUBLIC_BASE_URL: this.publicBaseUrl || `http://127.0.0.1:${port}`,
      NINE_ROUTER_ALLOW_PRIVATE_LAN_API: "true",
      NODE_ENV: "production",
      PORT: String(port),
    };
    const child = spawn(this.command, this.args, {
      cwd: this.cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const runtime = {
      baseUrl: `http://127.0.0.1:${port}`,
      dataDir,
      lastUsedAt: Date.now(),
      logs: [],
      port,
      process: child,
      ready: false,
      tenantId,
      cliToken,
      persisting: Promise.resolve(),
      uid,
    };

    attachLogs(runtime, "stdout", child.stdout);
    attachLogs(runtime, "stderr", child.stderr);
    child.on("exit", (code, signal) => {
      runtime.ready = false;
      runtime.logs.push(`[exit] code=${code ?? ""} signal=${signal ?? ""}`.trim());
    });

    try {
      await waitForRuntimeReady(runtime, this.startTimeoutMs);
      runtime.ready = true;
      this.runtimes.set(tenantId, runtime);
      return runtime;
    } catch (error) {
      child.kill("SIGTERM");
      throw error;
    }
  }

  async persistRuntime(runtime, reason = "request") {
    if (!this.persistenceEnabled || !runtime?.tenantId || !runtime?.dataDir) {
      return;
    }

    runtime.persisting = runtime.persisting
      .catch(() => undefined)
      .then(async () => {
        const persisted = await persistTenantData(runtime.tenantId, runtime.dataDir);
        console.log(`[tenant:${runtime.tenantId}] persisted ${persisted.fileCount} 9Router file(s) after ${reason}`);
      })
      .catch((error) => {
        console.error(`[tenant:${runtime.tenantId}] could not persist 9Router data`, error);
      });

    await runtime.persisting;
  }

  registerOAuthState(uid, provider, requestUrl) {
    const state = requestUrl.searchParams.get("state");
    if (!state || !["codex", "xai"].includes(provider)) {
      return;
    }

    this.oauthStateToTenant.set(state, {
      expiresAt: Date.now() + 10 * 60_000,
      provider,
      uid,
    });
  }

  async getRuntimeForCallback(callbackUrl) {
    const state = callbackUrl.searchParams.get("state");
    const entry = state ? this.oauthStateToTenant.get(state) : null;

    if (!entry || entry.expiresAt < Date.now()) {
      if (state) {
        this.oauthStateToTenant.delete(state);
      }
      return null;
    }

    return {
      callbackPort: entry.provider === "xai" ? XAI_CALLBACK_PORT : CODEX_CALLBACK_PORT,
      runtime: await this.getRuntime(entry.uid),
    };
  }

  stopIdleRuntimes() {
    const now = Date.now();

    for (const [tenantId, runtime] of this.runtimes.entries()) {
      if (!runtime.ready || now - runtime.lastUsedAt < this.idleMs) {
        continue;
      }

      runtime.process.kill("SIGTERM");
      this.runtimes.delete(tenantId);
    }

    for (const [state, entry] of this.oauthStateToTenant.entries()) {
      if (entry.expiresAt < now) {
        this.oauthStateToTenant.delete(state);
      }
    }
  }

  getStatus() {
    return {
      allowDashboard: this.allowUnsupportedDashboard,
      dataRoot: this.dataRoot,
      publicBaseUrl: this.publicBaseUrl,
      persistence: this.persistenceEnabled ? "firebase-storage" : "disabled",
      runtimeCount: [...this.runtimes.values()].filter((runtime) => runtime.ready).length,
      runtimes: [...this.runtimes.values()].flatMap((runtime) => runtime.ready ? [{
        dataDir: runtime.dataDir,
        lastUsedAt: new Date(runtime.lastUsedAt).toISOString(),
        port: runtime.port,
        tenantId: runtime.tenantId,
      }] : []),
    };
  }
}

export function createTenantId(uid) {
  return createHash("sha256").update(String(uid)).digest("hex").slice(0, 32);
}

async function ensureTenantCliToken(dataDir) {
  const authDir = `${dataDir}/auth`;
  await mkdir(authDir, { recursive: true });

  const machineId = await readOrCreateSecret(`${dataDir}/machine-id`, () => randomUUID());
  const cliSecret = await readOrCreateSecret(`${authDir}/cli-secret`, () => randomBytes(32).toString("hex"));

  return createHash("sha256")
    .update(`${machineId}${CLI_TOKEN_SALT}${cliSecret}`)
    .digest("hex")
    .slice(0, 16);
}

async function readOrCreateSecret(path, createValue) {
  try {
    const existing = (await readFile(path, "utf8")).trim();
    if (existing) {
      return existing;
    }
  } catch {}

  const value = createValue();
  await writeFile(path, value, { mode: 0o600 });
  return value;
}

function attachLogs(runtime, streamName, stream) {
  stream?.on("data", (chunk) => {
    const text = String(chunk).trim();
    if (!text) {
      return;
    }

    runtime.logs.push(`[${streamName}] ${text}`);
    runtime.logs.splice(0, Math.max(0, runtime.logs.length - 120));
    process.stdout.write(`[9router:${runtime.tenantId}:${streamName}] ${text}\n`);
  });
}

async function waitForRuntimeReady(runtime, timeoutMs) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    if (runtime.process.exitCode !== null || runtime.process.killed) {
      throw new Error(`9Router exited before it was ready. ${runtime.logs.slice(-5).join("\n")}`);
    }

    try {
      const response = await fetch(`${runtime.baseUrl}/v1/models`, { method: "GET" });
      if (response.status < 500) {
        const settingsResponse = await fetch(`${runtime.baseUrl}/api/settings`, {
          headers: {
            [NINE_ROUTER_CLI_TOKEN_HEADER]: runtime.cliToken,
          },
          method: "GET",
        });
        if (settingsResponse.status < 500) {
          return;
        }
        lastError = new Error(`HTTP ${settingsResponse.status}`);
      }
      lastError ??= new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await delay(1_000);
  }

  const message = lastError instanceof Error ? lastError.message : "unknown startup error";
  throw new Error(`9Router did not become ready within ${Math.round(timeoutMs / 1000)} seconds: ${message}`);
}

async function allocatePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

function parseArgs(value) {
  if (Array.isArray(value)) {
    return value;
  }

  return String(value)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

function normalizePublicBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
