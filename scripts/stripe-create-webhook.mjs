const API_VERSION = "2026-02-25.clover";
const STRIPE_API_BASE = "https://api.stripe.com/v1";
const secretKey = process.env.STRIPE_SECRET_KEY;
const stripeContext = process.env.STRIPE_CONTEXT || process.env.STRIPE_ACCOUNT_ID || "";
const webhookUrl = process.env.STRIPE_WEBHOOK_URL;

if (!secretKey || !webhookUrl) {
  console.error("Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_URL before running this script.");
  process.exit(1);
}
if (secretKey.startsWith("sk_org_") && !stripeContext) {
  console.error("Set STRIPE_CONTEXT to the live acct_... account that matches this Stripe organization key.");
  process.exit(1);
}

const webhookPayload = {
  "enabled_events[]": [
    "checkout.session.completed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.paid",
    "invoice.payment_failed",
  ],
  "metadata[app]": "gilbert-codex",
  url: webhookUrl,
};
const existingEndpoints = await listExistingWebhookEndpoints();
const payload = await stripeRequest("POST", "/webhook_endpoints", webhookPayload);
const disabledEndpointIds = [];

for (const endpoint of existingEndpoints) {
  if (endpoint.id !== payload.id && endpoint.url === webhookUrl && endpoint.metadata?.app === "gilbert-codex" && !endpoint.disabled) {
    await stripeRequest("POST", `/webhook_endpoints/${endpoint.id}`, {
      disabled: true,
    });
    disabledEndpointIds.push(endpoint.id);
  }
}

console.log(JSON.stringify({
  disabledEndpointIds,
  id: payload.id,
  secret: payload.secret,
  url: payload.url,
}, null, 2));

async function listExistingWebhookEndpoints() {
  const endpoints = [];
  let startingAfter = "";

  for (;;) {
    const payload = await stripeRequest("GET", "/webhook_endpoints", {
      limit: 100,
      starting_after: startingAfter || undefined,
    });
    endpoints.push(...payload.data);

    if (!payload.has_more || payload.data.length === 0) {
      return endpoints;
    }

    startingAfter = payload.data[payload.data.length - 1].id;
  }
}

async function stripeRequest(method, path, params = {}) {
  const url = new URL(`${STRIPE_API_BASE}${path}`);
  const init = {
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": API_VERSION,
    },
    method,
  };
  if (stripeContext) {
    init.headers["Stripe-Context"] = stripeContext;
  }

  if (method === "GET") {
    appendParams(url.searchParams, params);
  } else {
    const body = new URLSearchParams();
    appendParams(body, params);
    init.body = body;
  }
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error?.message || `Stripe API request failed with HTTP ${response.status}.`);
  }

  return payload;
}

function appendParams(target, params) {
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      value.forEach((entry) => target.append(key, String(entry)));
    } else if (value !== undefined && value !== null) {
      target.append(key, String(value));
    }
  }
}
