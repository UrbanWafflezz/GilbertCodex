import {
  getBillingBucketLimit,
  getBillingPlanTier,
  shouldApplyManagedUsageLimits,
  type BillingUsageBucket,
} from "../lib/subscriptionTiers";
import { loadPersistentString, savePersistentString } from "../lib/appStorage";
import type { BillingPlanSettings, ModelProviderId, ProviderSettings } from "../types/settings";
import { ProviderRequestError } from "./providerErrors";

const USAGE_STORAGE_KEY = "gilbert-codex.billing-usage.v1";

type UsageWindow = "day" | "minute";

interface UsageCounter {
  count: number;
  key: string;
}

type UsageState = Partial<Record<BillingUsageBucket, Partial<Record<UsageWindow, UsageCounter>>>>;

export function recordManagedPlanUsage(settings: ProviderSettings, bucket: BillingUsageBucket, amount = 1) {
  if (!shouldApplyManagedUsageLimits(settings.provider)) {
    return;
  }

  recordPlanUsage(settings.billingPlan, bucket, amount, settings.provider);
}

export function recordPlanUsage(plan: BillingPlanSettings | undefined, bucket: BillingUsageBucket, amount = 1, provider?: ModelProviderId) {
  if (!plan || amount <= 0) {
    return;
  }

  const tier = getBillingPlanTier(plan);
  const state = readUsageState();
  const dayLimit = getBillingBucketLimit(tier, bucket, "day");
  const minuteLimit = getBillingBucketLimit(tier, bucket, "minute");
  const nextState = { ...state };

  incrementBucket(nextState, bucket, "day", amount);
  incrementBucket(nextState, bucket, "minute", amount);

  const dayCount = nextState[bucket]?.day?.count ?? 0;
  const minuteCount = nextState[bucket]?.minute?.count ?? 0;

  if (dayLimit !== null && dayCount > dayLimit) {
    throw createLimitError(bucket, dayLimit, "day", provider);
  }

  if (minuteLimit !== null && minuteCount > minuteLimit) {
    throw createLimitError(bucket, minuteLimit, "minute", provider);
  }

  writeUsageState(nextState);
}

function incrementBucket(state: UsageState, bucket: BillingUsageBucket, window: UsageWindow, amount: number) {
  const key = createWindowKey(window);
  const bucketState = state[bucket] ?? {};
  const current = bucketState[window]?.key === key ? bucketState[window]?.count ?? 0 : 0;

  state[bucket] = {
    ...bucketState,
    [window]: {
      count: current + amount,
      key,
    },
  };
}

function formatLimitError(bucket: BillingUsageBucket, limit: number, window: UsageWindow, provider?: ModelProviderId) {
  const label = bucket === "chatRequests"
    ? "managed chat requests"
    : bucket === "imageGenerations"
      ? "image generations"
      : bucket === "tokens"
        ? "managed tokens"
        : bucket === "toolRuns"
          ? "managed tool runs"
          : "web searches";
  const providerText = provider ? ` for ${provider}` : "";

  return `Plan limit reached for ${label}${providerText}: ${limit.toLocaleString()} per ${window}. Try again ${window === "minute" ? "in a minute" : "tomorrow"}, switch to a local model, or choose a higher plan.`;
}

function createLimitError(bucket: BillingUsageBucket, limit: number, window: UsageWindow, provider?: ModelProviderId) {
  return new ProviderRequestError(formatLimitError(bucket, limit, window, provider), {
    kind: "usage_limit",
    providerLabel: provider,
    retryable: window === "minute",
  });
}

function createWindowKey(window: UsageWindow) {
  const now = new Date();

  if (window === "minute") {
    return now.toISOString().slice(0, 16);
  }

  return now.toISOString().slice(0, 10);
}

function readUsageState(): UsageState {
  try {
    const value = loadPersistentString(USAGE_STORAGE_KEY);
    return value ? JSON.parse(value) as UsageState : {};
  } catch {
    return {};
  }
}

function writeUsageState(state: UsageState) {
  try {
    savePersistentString(USAGE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage failures so a transient cloud write issue does not break local inference.
  }
}
