const API_VERSION = "2026-02-25.clover";
const STRIPE_API_BASE = "https://api.stripe.com/v1";

const secretKey = process.env.STRIPE_SECRET_KEY;
const stripeContext = process.env.STRIPE_CONTEXT || process.env.STRIPE_ACCOUNT_ID || "";
if (!secretKey) {
  console.error("Set STRIPE_SECRET_KEY before running this script.");
  process.exit(1);
}
if (secretKey.startsWith("sk_org_") && !stripeContext) {
  console.error("Set STRIPE_CONTEXT to the live acct_... account that matches this Stripe organization key.");
  process.exit(1);
}

const tiers = [
  {
    amount: 2000,
    description: "Managed hosted models, subscription account routes, images, and higher daily usage.",
    lookupKey: "gilbert_plus_monthly",
    name: "Gilbert Codex Plus",
    tier: "plus",
  },
  {
    amount: 6000,
    description: "Priority managed access, premium routes, expanded limits, and long-context work.",
    lookupKey: "gilbert_pro_monthly",
    name: "Gilbert Codex Pro",
    tier: "pro",
  },
];

const results = [];

for (const tier of tiers) {
  const product = await upsertProduct(tier);
  const price = await upsertMonthlyPrice(product.id, tier);
  results.push({
    lookupKey: tier.lookupKey,
    priceId: price.id,
    productId: product.id,
    tier: tier.tier,
  });
}

const portal = await ensurePortalConfiguration(results);
console.log(JSON.stringify({ portalConfigurationId: portal.id, prices: results }, null, 2));

async function upsertProduct(tier) {
  const products = await stripeRequest("GET", "/products", {
    active: true,
    limit: 100,
  });
  const existing = products.data.find((product) => product.name === tier.name || product.metadata?.gilbertTier === tier.tier);
  const payload = {
    "metadata[app]": "gilbert-codex",
    "metadata[gilbertTier]": tier.tier,
    description: tier.description,
    name: tier.name,
  };

  if (existing) {
    return stripeRequest("POST", `/products/${existing.id}`, payload);
  }

  return stripeRequest("POST", "/products", payload);
}

async function upsertMonthlyPrice(productId, tier) {
  const prices = await stripeRequest("GET", "/prices", {
    active: true,
    "lookup_keys[]": tier.lookupKey,
    limit: 1,
  });
  const existing = prices.data[0];

  if (existing) {
    return existing;
  }

  return stripeRequest("POST", "/prices", {
    currency: "usd",
    lookup_key: tier.lookupKey,
    "metadata[app]": "gilbert-codex",
    "metadata[gilbertTier]": tier.tier,
    product: productId,
    "recurring[interval]": "month",
    unit_amount: tier.amount,
  });
}

async function ensurePortalConfiguration(prices) {
  const configurations = await stripeRequest("GET", "/billing_portal/configurations", {
    active: true,
    limit: 100,
  });
  const existing = configurations.data.find((configuration) => configuration.metadata?.app === "gilbert-codex");
  const payload = {
    "business_profile[headline]": "Manage your Gilbert Codex subscription.",
    "features[customer_update][allowed_updates][]": ["email", "address", "tax_id"],
    "features[customer_update][enabled]": true,
    "features[invoice_history][enabled]": true,
    "features[payment_method_update][enabled]": true,
    "features[subscription_cancel][enabled]": true,
    "features[subscription_cancel][mode]": "at_period_end",
    "features[subscription_update][default_allowed_updates][]": "price",
    "features[subscription_update][enabled]": true,
    "features[subscription_update][proration_behavior]": "create_prorations",
    "metadata[app]": "gilbert-codex",
  };

  prices.forEach((entry, index) => {
    payload[`features[subscription_update][products][${index}][product]`] = entry.productId;
    payload[`features[subscription_update][products][${index}][prices][]`] = entry.priceId;
  });

  if (existing) {
    return stripeRequest("POST", `/billing_portal/configurations/${existing.id}`, payload);
  }

  return stripeRequest("POST", "/billing_portal/configurations", payload);
}

async function stripeRequest(method, path, params = {}) {
  const url = new URL(`${STRIPE_API_BASE}${path}`);
  const init = {
    headers: {
      Authorization: `Bearer ${secretKey}`,
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
    init.headers["Content-Type"] = "application/x-www-form-urlencoded";
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
      continue;
    }

    if (value !== undefined && value !== null) {
      target.append(key, String(value));
    }
  }
}
