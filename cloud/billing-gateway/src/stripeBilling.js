import Stripe from "stripe";
import { FieldValue } from "firebase-admin/firestore";

import { getFirebaseDb } from "./firebase.js";
import { createSubscriptionData, getTrialDaysForTier } from "./subscriptionPlan.js";

const API_VERSION = "2026-02-25.clover";
const STRIPE_API_BASE = "https://api.stripe.com/v1";
const MISSING_STRIPE_CONTEXT_MESSAGE = "Stripe billing is waiting for the live Stripe account ID. Set STRIPE_CONTEXT to the live acct_... account that matches this organization key, then redeploy billing.";
const TIER_BY_LOOKUP_KEY = new Map([
  ["gilbert_plus_monthly", "plus"],
  ["gilbert_pro_monthly", "pro"],
]);
const LOOKUP_KEY_BY_TIER = {
  plus: "gilbert_plus_monthly",
  pro: "gilbert_pro_monthly",
};
const PLAN_STATUSES = new Set(["active", "canceled", "incomplete", "none", "past_due", "trialing"]);

let stripeClient = null;

export function getStripe() {
  if (!stripeClient) {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw createHttpError(500, "Stripe is not configured.");
    }

    stripeClient = new Stripe(secretKey, {
      apiVersion: API_VERSION,
    });
  }

  return stripeClient;
}

export async function getBillingStatus(decodedToken) {
  const uid = decodedToken.uid;
  const db = getFirebaseDb();
  const [userSnapshot, customerSnapshot] = await Promise.all([
    db.doc(`users/${uid}`).get(),
    db.doc(`billingCustomers/${uid}`).get(),
  ]);
  const billingPlan = normalizeBillingPlan(userSnapshot.exists ? userSnapshot.data()?.billingPlan : null);

  return {
    billingPlan,
    billingCustomer: customerSnapshot.exists ? sanitizeBillingCustomer(customerSnapshot.data()) : null,
    prices: {
      plus: LOOKUP_KEY_BY_TIER.plus,
      pro: LOOKUP_KEY_BY_TIER.pro,
    },
  };
}

export async function createCheckoutSession(decodedToken, body) {
  const tier = normalizePaidTier(body?.tier);
  const customer = await ensureStripeCustomer(decodedToken);
  const price = await getPriceForTier(tier);
  const session = await stripeRequest("POST", "/checkout/sessions", {
    allow_promotion_codes: true,
    billing_address_collection: "auto",
    client_reference_id: decodedToken.uid,
    customer: customer.id,
    customer_update: {
      address: "auto",
      name: "auto",
    },
    line_items: [
      {
        price: price.id,
        quantity: 1,
      },
    ],
    metadata: {
      firebaseUid: decodedToken.uid,
      tier,
    },
    mode: "subscription",
    subscription_data: createSubscriptionData(decodedToken.uid, tier),
    success_url: createReturnUrl("success"),
    cancel_url: createReturnUrl("cancel"),
  });

  return {
    id: session.id,
    trialDays: getTrialDaysForTier(tier),
    url: session.url,
  };
}

export async function createPortalSession(decodedToken) {
  const customer = await ensureStripeCustomer(decodedToken);
  const configuration = normalizeOptionalText(process.env.STRIPE_PORTAL_CONFIGURATION_ID);
  const session = await stripeRequest("POST", "/billing_portal/sessions", {
    configuration: configuration || undefined,
    customer: customer.id,
    return_url: createReturnUrl("portal-return"),
  });

  return {
    id: session.id,
    url: session.url,
  };
}

export async function handleStripeWebhook(rawBody, signature) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw createHttpError(500, "Stripe webhook signing secret is not configured.");
  }

  let event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (cause) {
    const error = createHttpError(400, "Invalid Stripe webhook signature.");
    error.cause = cause;
    throw error;
  }

  switch (event.type) {
    case "checkout.session.completed":
      await syncCheckoutSession(event.data.object);
      break;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await syncSubscription(event.data.object);
      break;
    case "invoice.payment_failed":
    case "invoice.paid":
      await syncInvoice(event.data.object);
      break;
    default:
      break;
  }

  return { received: true, type: event.type };
}

async function ensureStripeCustomer(decodedToken) {
  const uid = decodedToken.uid;
  const db = getFirebaseDb();
  const customerRef = db.doc(`billingCustomers/${uid}`);
  const existingSnapshot = await customerRef.get();
  const existingCustomerId = existingSnapshot.exists ? normalizeOptionalText(existingSnapshot.data()?.stripeCustomerId) : "";

  if (existingCustomerId) {
    try {
      const existingCustomer = await stripeRequest("GET", `/customers/${existingCustomerId}`);
      if (!existingCustomer.deleted) {
        return existingCustomer;
      }
    } catch {
      // Fall through and create a replacement customer if Stripe no longer has it.
    }
  }

  const userSnapshot = await db.doc(`users/${uid}`).get();
  const user = userSnapshot.exists ? userSnapshot.data() : {};
  const email = normalizeOptionalText(decodedToken.email) || normalizeOptionalText(user.email);
  const name = normalizeOptionalText(decodedToken.name) || normalizeOptionalText(user.displayName) || normalizeOptionalText(user.username);
  const customer = await stripeRequest("POST", "/customers", {
    email: email || undefined,
    metadata: {
      firebaseUid: uid,
    },
    name: name || undefined,
  });

  await customerRef.set({
    createdAt: FieldValue.serverTimestamp(),
    email: email || null,
    firebaseUid: uid,
    stripeCustomerId: customer.id,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return customer;
}

async function getPriceForTier(tier) {
  const lookupKey = LOOKUP_KEY_BY_TIER[tier];
  const prices = await stripeRequest("GET", "/prices", {
    active: true,
    limit: 1,
    lookup_keys: [lookupKey],
  });
  const price = prices.data[0];

  if (!price) {
    throw createHttpError(500, `Stripe price ${lookupKey} was not found.`);
  }

  return price;
}

async function syncCheckoutSession(session) {
  const uid = normalizeOptionalText(session.client_reference_id) || normalizeOptionalText(session.metadata?.firebaseUid);
  const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;

  if (!uid || !subscriptionId) {
    return;
  }

  const subscription = await stripeRequest("GET", `/subscriptions/${subscriptionId}`, {
    expand: ["items.data.price"],
  });
  await syncSubscription(subscription, uid);
}

async function syncInvoice(invoice) {
  const subscriptionId = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;
  if (!subscriptionId) {
    return;
  }

  const subscription = await stripeRequest("GET", `/subscriptions/${subscriptionId}`, {
    expand: ["items.data.price"],
  });
  await syncSubscription(subscription);
}

async function syncSubscription(subscription, uidOverride) {
  const uid = normalizeOptionalText(uidOverride) || normalizeOptionalText(subscription.metadata?.firebaseUid) || await findUidForCustomer(subscription.customer);
  if (!uid) {
    return;
  }

  const item = subscription.items?.data?.[0];
  const price = item?.price;
  const tier = normalizeTierFromPrice(price) || normalizePaidTier(subscription.metadata?.tier, "plus");
  const status = normalizeStripeSubscriptionStatus(subscription.status);
  const currentPeriodEnd = typeof subscription.current_period_end === "number"
    ? new Date(subscription.current_period_end * 1000).toISOString()
    : undefined;
  const plan = {
    currentPeriodEnd,
    source: "stripe",
    status,
    stripeCustomerId: typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id,
    stripeSubscriptionId: subscription.id,
    tier,
    updatedAt: new Date().toISOString(),
  };
  const db = getFirebaseDb();

  await Promise.all([
    db.doc(`users/${uid}`).set({
      billingPlan: plan,
      serverUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }),
    db.doc(`billingCustomers/${uid}`).set({
      firebaseUid: uid,
      latestSubscription: {
        cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
        currentPeriodEnd,
        priceId: price?.id ?? null,
        priceLookupKey: price?.lookup_key ?? null,
        status,
        subscriptionId: subscription.id,
        tier,
      },
      stripeCustomerId: plan.stripeCustomerId ?? null,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }),
  ]);
}

async function findUidForCustomer(customer) {
  const customerId = typeof customer === "string" ? customer : customer?.id;
  if (!customerId) {
    return "";
  }

  const snapshot = await getFirebaseDb()
    .collection("billingCustomers")
    .where("stripeCustomerId", "==", customerId)
    .limit(1)
    .get();

  return snapshot.docs[0]?.id || "";
}

function normalizeBillingPlan(value) {
  const record = typeof value === "object" && value ? value : {};

  return {
    currentPeriodEnd: normalizeOptionalText(record.currentPeriodEnd),
    source: ["admin", "firebase", "local-preview", "stripe"].includes(record.source) ? record.source : "firebase",
    status: PLAN_STATUSES.has(record.status) ? record.status : "none",
    stripeCustomerId: normalizeOptionalText(record.stripeCustomerId),
    stripeSubscriptionId: normalizeOptionalText(record.stripeSubscriptionId),
    tier: ["free", "plus", "pro", "teams"].includes(record.tier) ? record.tier : "free",
    updatedAt: normalizeOptionalText(record.updatedAt),
  };
}

function sanitizeBillingCustomer(value) {
  return {
    latestSubscription: value?.latestSubscription ?? null,
    stripeCustomerId: normalizeOptionalText(value?.stripeCustomerId),
  };
}

function normalizePaidTier(value, fallback) {
  if (value === "plus" || value === "pro") {
    return value;
  }

  if (fallback) {
    return fallback;
  }

  throw createHttpError(400, "Choose Plus or Pro.");
}

function normalizeTierFromPrice(price) {
  const lookupKey = normalizeOptionalText(price?.lookup_key);
  if (lookupKey && TIER_BY_LOOKUP_KEY.has(lookupKey)) {
    return TIER_BY_LOOKUP_KEY.get(lookupKey);
  }

  return normalizeOptionalText(price?.metadata?.gilbertTier);
}

function normalizeStripeSubscriptionStatus(value) {
  if (value === "active" || value === "trialing" || value === "past_due" || value === "canceled" || value === "incomplete") {
    return value;
  }

  return "incomplete";
}

function createReturnUrl(result) {
  const baseUrl = normalizeOptionalText(process.env.GILBERT_BILLING_RETURN_URL) || "https://gilbertcodex.com/billing";
  const url = new URL(baseUrl);
  url.searchParams.set("billing", result);
  return url.toString();
}

async function stripeRequest(method, path, params = {}) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw createHttpError(500, "Stripe is not configured.");
  }

  const stripeContext = normalizeOptionalText(process.env.STRIPE_CONTEXT || process.env.STRIPE_ACCOUNT_ID);
  if (secretKey.startsWith("sk_org_") && !stripeContext) {
    throw createHttpError(500, MISSING_STRIPE_CONTEXT_MESSAGE);
  }

  const url = new URL(`${STRIPE_API_BASE}${path}`);
  const headers = {
    Authorization: `Bearer ${secretKey}`,
    "Stripe-Version": API_VERSION,
  };
  if (stripeContext) {
    headers["Stripe-Context"] = stripeContext;
  }

  const init = {
    headers,
    method,
  };

  if (method === "GET") {
    appendStripeParams(url.searchParams, "", params);
  } else {
    const body = new URLSearchParams();
    appendStripeParams(body, "", params);
    init.body = body;
    init.headers["Content-Type"] = "application/x-www-form-urlencoded";
  }

  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = payload.error?.message || `Stripe API request failed with HTTP ${response.status}.`;
    const error = createHttpError(response.status >= 400 && response.status < 500 ? 502 : 500, message);
    error.cause = payload;
    throw error;
  }

  return payload;
}

function appendStripeParams(target, prefix, value) {
  if (value === undefined || value === null) {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      const key = entry && typeof entry === "object" && !Array.isArray(entry)
        ? `${prefix}[${index}]`
        : `${prefix}[]`;
      appendStripeParams(target, key, entry);
    });
    return;
  }

  if (typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      appendStripeParams(target, prefix ? `${prefix}[${key}]` : key, entry);
    }
    return;
  }

  if (prefix) {
    target.append(prefix, String(value));
  }
}

function normalizeOptionalText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
