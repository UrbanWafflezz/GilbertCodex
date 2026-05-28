export function sendJson(res, statusCode, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "content-length": Buffer.byteLength(body),
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
  res.end(body);
}

export function sendHtml(res, statusCode, html) {
  res.writeHead(statusCode, {
    "content-length": Buffer.byteLength(html),
    "content-type": "text/html; charset=utf-8",
  });
  res.end(html);
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

export async function readRequestBody(req, maxBytes = 1024 * 1024) {
  if (req.method === "GET" || req.method === "HEAD") {
    return Buffer.alloc(0);
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

  return chunks.length > 0 ? Buffer.concat(chunks) : Buffer.alloc(0);
}

export async function readJsonBody(req, maxBytes) {
  const rawBody = await readRequestBody(req, maxBytes);

  if (rawBody.length === 0) {
    return {};
  }

  try {
    return JSON.parse(rawBody.toString("utf8"));
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.statusCode = 400;
    throw error;
  }
}

export function readHeader(req, name) {
  const value = req.headers[name.toLowerCase()];

  if (Array.isArray(value)) {
    return value[0]?.trim() || "";
  }

  return typeof value === "string" ? value.trim() : "";
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
