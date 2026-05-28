import { Readable } from "node:stream";

export function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "content-length": Buffer.byteLength(body),
    "content-type": "application/json; charset=utf-8",
  });
  res.end(body);
}

export function sendCorsPreflight(req, res) {
  writeCorsHeaders(req, res);
  res.writeHead(204, {
    "access-control-max-age": "86400",
  });
  res.end();
}

export function writeCorsHeaders(req, res) {
  const origin = req.headers.origin;
  const allowedOrigin = getAllowedOrigin(origin);

  if (allowedOrigin) {
    res.setHeader("access-control-allow-origin", allowedOrigin);
    res.setHeader("vary", "Origin");
  }

  res.setHeader("access-control-allow-credentials", "true");
  res.setHeader("access-control-allow-headers", "authorization, content-type, x-gilbert-firebase-id-token");
  res.setHeader("access-control-allow-methods", "DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT");
}

export async function readRequestBody(req, maxBytes = 20 * 1024 * 1024) {
  if (req.method === "GET" || req.method === "HEAD") {
    return undefined;
  }

  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    totalBytes += chunk.byteLength;

    if (totalBytes > maxBytes) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      throw error;
    }

    chunks.push(chunk);
  }

  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

export function copyResponseHeaders(source, res) {
  source.headers.forEach((value, key) => {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      return;
    }

    res.setHeader(key, value);
  });
}

export async function pipeFetchResponse(req, res, upstreamResponse) {
  writeCorsHeaders(req, res);
  copyResponseHeaders(upstreamResponse, res);
  res.writeHead(upstreamResponse.status);

  if (!upstreamResponse.body || req.method === "HEAD") {
    res.end();
    return;
  }

  Readable.fromWeb(upstreamResponse.body).pipe(res);
}

function getAllowedOrigin(origin) {
  if (!origin || typeof origin !== "string") {
    return "";
  }

  const configured = (process.env.GILBERT_ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (configured.length === 0 || configured.includes("*") || configured.includes(origin)) {
    return origin;
  }

  return "";
}

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
