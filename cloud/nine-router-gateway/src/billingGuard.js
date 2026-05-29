import { FieldValue } from "firebase-admin/firestore";

import {
  estimateImageGenerations,
  isBillableImageRequest,
  normalizeUsageAmount,
} from "./billingUsage.js";
import { getFirebaseDb } from "./firebaseAuth.js";
import {
  isAllowedFreeTierComboMutation,
  isFreeTierNineRouterModel,
  readJsonBody,
  readRequestModel,
} from "./freeAutoRouting.js";

const DEFAULT_TIER = "free";
const ENTITLED_STATUSES = new Set(["active", "trialing"]);
const ENTITLED_SOURCES = new Set(["admin", "stripe"]);
const BILLING_TIERS = {
  free: {
    chatRequestsPerDay: 50,
    chatRequestsPerMinute: 20,
    imageGenerationsPerDay: 0,
    tokensPerDay: 150_000,
    tokensPerMinute: 40_000,
  },
  plus: {
    chatRequestsPerDay: 1_000,
    chatRequestsPerMinute: 60,
    imageGenerationsPerDay: 25,
    tokensPerDay: 5_000_000,
    tokensPerMinute: 500_000,
  },
  pro: {
    chatRequestsPerDay: 5_000,
    chatRequestsPerMinute: 120,
    imageGenerationsPerDay: 100,
    tokensPerDay: 25_000_000,
    tokensPerMinute: 2_000_000,
  },
  teams: {
    chatRequestsPerDay: null,
    chatRequestsPerMinute: null,
    imageGenerationsPerDay: null,
    tokensPerDay: null,
    tokensPerMinute: null,
  },
};

export async function enforceNineRouterBilling(decodedToken, req, requestUrl, body) {
  const plan = await loadBillingPlan(decodedToken.uid);
  const tier = getEntitledTier(plan);
  const pathname = requestUrl.pathname;

  if (tier === "free" && isPaidSubscriptionAccountPath(req.method, pathname) && !isAllowedFreeTierComboMutation(req.method, pathname, body)) {
    return deny(402, "Upgrade to Plus before connecting or managing subscription accounts.");
  }

  if (!isBillableModelRequest(req.method, pathname)) {
    if (!isBillableImageRequest(req.method, pathname)) {
      return allow(plan, tier);
    }

    if (tier === "free") {
      return deny(402, "Image generation requires Plus or Pro.");
    }

    await recordUsage(decodedToken.uid, tier, {
      imageGenerations: estimateImageGenerations(body),
    });

    return allow(plan, tier);
  }

  const model = readRequestModel(body);
  if (tier === "free" && !isFreeTierNineRouterModel(model)) {
    return deny(402, "This 9Router model is outside the Free tier. Choose Free Auto or upgrade to Plus.");
  }

  const estimatedTokens = estimateRequestTokens(body);
  await recordUsage(decodedToken.uid, tier, {
    chatRequests: 1,
    tokens: estimatedTokens,
  });

  return allow(plan, tier);
}

function allow(plan, tier) {
  return {
    allowed: true,
    plan,
    tier,
  };
}

function deny(statusCode, message) {
  return {
    allowed: false,
    payload: {
      error: {
        code: "billing_required",
        message,
        type: "billing_error",
      },
    },
    statusCode,
  };
}

async function loadBillingPlan(uid) {
  const snapshot = await getFirebaseDb().doc(`users/${uid}`).get();
  const value = snapshot.exists ? snapshot.data()?.billingPlan : null;
  const plan = typeof value === "object" && value ? value : {};

  return {
    source: normalizePlanSource(plan.source),
    status: normalizePlanStatus(plan.status),
    tier: normalizeTier(plan.tier),
  };
}

function getEntitledTier(plan) {
  if (plan.tier === "free") {
    return "free";
  }

  if (!ENTITLED_SOURCES.has(plan.source) || !ENTITLED_STATUSES.has(plan.status)) {
    return DEFAULT_TIER;
  }

  return plan.tier;
}

async function recordUsage(uid, tier, usage) {
  const limits = BILLING_TIERS[tier] ?? BILLING_TIERS.free;
  const windows = createUsageWindows();
  const counters = [
    {
      amount: normalizeUsageAmount(usage.chatRequests),
      bucket: "chatRequests",
      dayLimit: limits.chatRequestsPerDay,
      minuteLimit: limits.chatRequestsPerMinute,
    },
    {
      amount: normalizeUsageAmount(usage.tokens),
      bucket: "tokens",
      dayLimit: limits.tokensPerDay,
      minuteLimit: limits.tokensPerMinute,
    },
    {
      amount: normalizeUsageAmount(usage.imageGenerations),
      bucket: "imageGenerations",
      dayLimit: limits.imageGenerationsPerDay,
      minuteLimit: null,
    },
  ].filter((counter) => counter.amount > 0);

  if (counters.length === 0) {
    return;
  }

  const db = getFirebaseDb();
  const dayRef = db.doc(`billingCustomers/${uid}/usage/${windows.day}`);
  const minuteRef = db.doc(`billingCustomers/${uid}/usage/${windows.minute}`);

  await db.runTransaction(async (transaction) => {
    const [daySnapshot, minuteSnapshot] = await Promise.all([
      transaction.get(dayRef),
      transaction.get(minuteRef),
    ]);
    const writes = [];

    for (const counter of counters) {
      writes.push(createUsageWrite(dayRef, daySnapshot, "day", windows.day, counter, counter.dayLimit));
      writes.push(createUsageWrite(minuteRef, minuteSnapshot, "minute", windows.minute, counter, counter.minuteLimit));
    }

    for (const write of writes) {
      if (write.limit !== null && write.nextValue > write.limit) {
        throw createLimitError(write.bucket, write.limit, write.window);
      }
    }

    transaction.set(dayRef, createUsagePayload(uid, tier, "day", windows.day, writes.filter((write) => write.ref === dayRef)), { merge: true });
    transaction.set(minuteRef, createUsagePayload(uid, tier, "minute", windows.minute, writes.filter((write) => write.ref === minuteRef)), { merge: true });
  });
}

function createUsageWrite(ref, snapshot, window, key, counter, limit) {
  const data = snapshot.exists ? snapshot.data() : {};
  const currentValue = Number(data?.[counter.bucket]);
  const safeCurrentValue = Number.isFinite(currentValue) && currentValue >= 0 ? currentValue : 0;

  return {
    bucket: counter.bucket,
    key,
    limit,
    nextValue: safeCurrentValue + counter.amount,
    ref,
    window,
  };
}

function createUsagePayload(uid, tier, window, key, writes) {
  const payload = {
    key,
    tier,
    uid,
    updatedAt: FieldValue.serverTimestamp(),
    window,
  };

  for (const write of writes) {
    payload[write.bucket] = write.nextValue;
  }

  return payload;
}

function createLimitError(bucket, limit, window) {
  const label = bucket === "chatRequests"
    ? "managed chat requests"
    : bucket === "imageGenerations"
      ? "image generations"
      : "managed tokens";
  const error = new Error(`Plan limit reached for ${label}: ${limit.toLocaleString()} per ${window}.`);
  error.statusCode = 429;
  error.payload = {
    error: {
      code: "rate_limit_exceeded",
      message: error.message,
      type: "usage_limit",
    },
  };
  return error;
}

function createUsageWindows() {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const minute = now.toISOString().slice(0, 16).replace(":", "-");

  return {
    day: `day-${day}`,
    minute: `minute-${minute}`,
  };
}

function isPaidSubscriptionAccountPath(method, pathname) {
  const normalizedMethod = String(method || "GET").toUpperCase();

  if (pathname.startsWith("/api/oauth/")) {
    return true;
  }

  if (/^\/api\/providers(?:\/|$)/.test(pathname)) {
    return normalizedMethod !== "GET" || pathname !== "/api/providers";
  }

  if (/^\/api\/usage(?:\/|$)/.test(pathname)) {
    return true;
  }

  if (/^\/api\/settings(?:\/|$)/.test(pathname) || /^\/api\/combos(?:\/|$)/.test(pathname)) {
    return normalizedMethod !== "GET";
  }

  return false;
}

function isBillableModelRequest(method, pathname) {
  const normalizedMethod = String(method || "GET").toUpperCase();
  return normalizedMethod === "POST" && (
    pathname === "/v1/chat/completions" ||
    pathname === "/v1/completions" ||
    pathname === "/v1/responses"
  );
}

function estimateRequestTokens(body) {
  const payload = readJsonBody(body);
  if (!payload) {
    return 1;
  }

  const relevantPayload = {
    input: payload.input,
    messages: payload.messages,
    model: payload.model,
    prompt: payload.prompt,
    tools: payload.tools,
  };
  const text = JSON.stringify(relevantPayload);

  return Math.max(1, Math.ceil(text.length / 4));
}

function normalizeTier(value) {
  return ["free", "plus", "pro", "teams"].includes(value) ? value : DEFAULT_TIER;
}

function normalizePlanSource(value) {
  return ["admin", "firebase", "local-preview", "stripe"].includes(value) ? value : "firebase";
}

function normalizePlanStatus(value) {
  return ["active", "canceled", "incomplete", "none", "past_due", "trialing"].includes(value) ? value : "none";
}
