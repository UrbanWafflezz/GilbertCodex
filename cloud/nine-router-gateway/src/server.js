import http from "node:http";

import { enforceNineRouterBilling } from "./billingGuard.js";
import { verifyFirebaseRequest } from "./firebaseAuth.js";
import { ensureManagedFreeAutoRoute, shouldEnsureManagedFreeAutoRoute } from "./freeAutoRouting.js";
import { pipeFetchResponse, readRequestBody, sendCorsPreflight, sendJson, writeCorsHeaders } from "./http.js";
import { NINE_ROUTER_CLI_TOKEN_HEADER, TenantRouterManager } from "./tenantRouter.js";

const manager = new TenantRouterManager();
const port = Number(process.env.PORT || 8080);

const server = http.createServer(async (req, res) => {
  try {
    writeCorsHeaders(req, res);

    if (req.method === "OPTIONS") {
      sendCorsPreflight(req, res);
      return;
    }

    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (requestUrl.pathname === "/healthz" || requestUrl.pathname === "/__gilbert/health") {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (requestUrl.pathname === "/__gilbert/status") {
      const decodedToken = await verifyFirebaseRequest(req);
      sendJson(res, 200, {
        ok: true,
        uid: decodedToken.uid,
        ...manager.getStatus(),
      });
      return;
    }

    if (isOAuthCallbackPath(requestUrl.pathname)) {
      await handleOAuthCallback(req, res, requestUrl);
      return;
    }

    if (!isAllowedProxyPath(requestUrl.pathname, manager.allowUnsupportedDashboard)) {
      sendJson(res, 404, { error: "Not found." });
      return;
    }

    const decodedToken = await verifyFirebaseRequest(req);
    const body = await readRequestBody(req, manager.requestBodyLimitBytes);
    const billingDecision = await enforceNineRouterBilling(decodedToken, req, requestUrl, body);
    if (!billingDecision.allowed) {
      sendJson(res, billingDecision.statusCode, billingDecision.payload);
      return;
    }

    const runtime = await manager.getRuntime(decodedToken.uid);
    if (shouldEnsureManagedFreeAutoRoute(billingDecision.tier, req.method, requestUrl.pathname, body)) {
      await ensureManagedFreeAutoRoute(runtime);
    }

    if (isOAuthStartProxyPath(requestUrl.pathname)) {
      manager.registerOAuthState(decodedToken.uid, readOAuthProvider(requestUrl.pathname), requestUrl);
    }

    await proxyToRuntime(req, res, runtime.baseUrl, requestUrl, runtime, body);
  } catch (error) {
    handleError(res, error);
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Gilbert 9Router gateway listening on ${port}`);
});

async function handleOAuthCallback(req, res, requestUrl) {
  const callback = await manager.getRuntimeForCallback(requestUrl);

  if (!callback) {
    sendJson(res, 404, { error: "OAuth session was not found or expired." });
    return;
  }

  await proxyToRuntime(req, res, `http://127.0.0.1:${callback.callbackPort}`, requestUrl, callback.runtime);
}

async function proxyToRuntime(req, res, runtimeBaseUrl, requestUrl, runtime, body) {
  const targetUrl = new URL(`${requestUrl.pathname}${requestUrl.search}`, runtimeBaseUrl);
  const headers = buildProxyHeaders(req, runtime);
  const upstreamResponse = await fetch(targetUrl, {
    body,
    headers,
    method: req.method,
    redirect: "manual",
  });
  const status = upstreamResponse.status;

  await pipeFetchResponse(req, res, upstreamResponse);

  if (shouldPersistRuntimeData(req.method, requestUrl.pathname, status)) {
    await manager.persistRuntime(runtime, `${req.method} ${requestUrl.pathname}`);
  }
}

function buildProxyHeaders(req, runtime) {
  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers)) {
    const lowerKey = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lowerKey) || lowerKey === "x-gilbert-firebase-id-token" || lowerKey === "authorization" || lowerKey === NINE_ROUTER_CLI_TOKEN_HEADER) {
      continue;
    }

    if (Array.isArray(value)) {
      value.forEach((entry) => headers.append(key, entry));
    } else if (typeof value === "string") {
      headers.set(key, value);
    }
  }

  headers.set("x-forwarded-host", req.headers.host || "");
  headers.set("x-forwarded-proto", "https");
  if (runtime?.cliToken) {
    headers.set(NINE_ROUTER_CLI_TOKEN_HEADER, runtime.cliToken);
  }
  return headers;
}

function isAllowedProxyPath(pathname, allowDashboard) {
  return pathname === "/v1" ||
    pathname.startsWith("/v1/") ||
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    (allowDashboard && (pathname === "/" || pathname.startsWith("/dashboard") || pathname.startsWith("/_next/") || pathname.startsWith("/providers/")));
}

function isOAuthCallbackPath(pathname) {
  return pathname === "/callback" || pathname === "/auth/callback";
}

function isOAuthStartProxyPath(pathname) {
  return /^\/api\/oauth\/(?:codex|xai)\/start-proxy$/i.test(pathname);
}

function readOAuthProvider(pathname) {
  return /^\/api\/oauth\/([^/]+)\//i.exec(pathname)?.[1]?.toLowerCase() || "";
}

function shouldPersistRuntimeData(method, pathname, status) {
  const normalizedMethod = String(method || "GET").toUpperCase();
  if (status >= 500 || ["GET", "HEAD", "OPTIONS"].includes(normalizedMethod)) {
    return false;
  }

  return pathname.startsWith("/api/") || pathname.startsWith("/v1/");
}

function handleError(res, error) {
  const statusCode = Number(error?.statusCode) || 500;
  const message = error instanceof Error ? error.message : "Gateway request failed.";
  const payload = error?.payload ?? { error: message };

  console.error(message, error?.cause || error);
  sendJson(res, statusCode, payload);
}

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
