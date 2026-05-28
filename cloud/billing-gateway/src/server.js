import http from "node:http";

import { verifyFirebaseRequest } from "./firebase.js";
import { readJsonBody, readRequestBody, sendCorsPreflight, sendJson, writeCorsHeaders } from "./http.js";
import { createCheckoutSession, createPortalSession, getBillingStatus, handleStripeWebhook } from "./stripeBilling.js";

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

    if (requestUrl.pathname === "/webhooks/stripe" && req.method === "POST") {
      const rawBody = await readRequestBody(req, 2 * 1024 * 1024);
      const result = await handleStripeWebhook(rawBody, readHeader(req, "stripe-signature"));
      sendJson(res, 200, result);
      return;
    }

    if (!requestUrl.pathname.startsWith("/api/billing/")) {
      sendJson(res, 404, { error: "Not found." });
      return;
    }

    const decodedToken = await verifyFirebaseRequest(req);

    if (requestUrl.pathname === "/api/billing/status" && req.method === "GET") {
      sendJson(res, 200, await getBillingStatus(decodedToken));
      return;
    }

    if (requestUrl.pathname === "/api/billing/checkout" && req.method === "POST") {
      sendJson(res, 200, await createCheckoutSession(decodedToken, await readJsonBody(req)));
      return;
    }

    if (requestUrl.pathname === "/api/billing/portal" && req.method === "POST") {
      sendJson(res, 200, await createPortalSession(decodedToken));
      return;
    }

    sendJson(res, 404, { error: "Not found." });
  } catch (error) {
    handleError(res, error);
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Gilbert billing gateway listening on ${port}`);
});

function handleError(res, error) {
  const statusCode = Number(error?.statusCode) || 500;
  const message = error instanceof Error ? error.message : "Billing request failed.";

  console.error(message, error?.cause || error);
  sendJson(res, statusCode, { error: message });
}

function readHeader(req, name) {
  const value = req.headers[name.toLowerCase()];

  if (Array.isArray(value)) {
    return value[0]?.trim() || "";
  }

  return typeof value === "string" ? value.trim() : "";
}
