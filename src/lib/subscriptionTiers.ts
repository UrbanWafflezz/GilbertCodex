import {
  getDefaultModelForProvider,
  isOpenRouterFreeModel,
  NINE_ROUTER_ALWAYS_FREE_MODEL,
  OPENROUTER_FREE_AUTO_MODEL,
  type ChatModelOption,
} from "./models";
import type { BillingPlanSettings, BillingTierId, ModelProviderId, ProviderSettings } from "../types/settings";

export const DEFAULT_BILLING_TIER: BillingTierId = "free";

export const DEFAULT_BILLING_PLAN: BillingPlanSettings = {
  source: "local-preview",
  status: "none",
  tier: DEFAULT_BILLING_TIER,
};

export type BillingUsageBucket = "chatRequests" | "imageGenerations" | "tokens" | "toolRuns" | "webSearches";

export interface BillingTierLimits {
  chatRequestsPerDay: number | null;
  chatRequestsPerMinute: number | null;
  imageGenerationsPerDay: number | null;
  maxContextTokens: number | null;
  tokensPerDay: number | null;
  tokensPerMinute: number | null;
  toolRunsPerDay: number | null;
  webSearchesPerDay: number | null;
}

export interface BillingTierConfig {
  ctaLabel: string;
  description: string;
  features: string[];
  id: BillingTierId;
  limits: BillingTierLimits;
  name: string;
  priceLabel: string;
  stripePriceLookupKey?: string;
  tagline: string;
}

export interface BillingAccessDecision {
  allowed: boolean;
  reason?: string;
}

export const BILLING_TIER_ORDER: BillingTierId[] = ["free", "plus", "pro", "teams"];

export const BILLING_TIERS: Record<BillingTierId, BillingTierConfig> = {
  free: {
    ctaLabel: "Current free tier",
    description: "Free managed routes, local models, and conservative public-provider limits.",
    features: [
      "OpenRouter free model routes",
      "Ollama, LM Studio, and vLLM local models",
      "Local workspace tools",
      "No subscription account sign-in",
    ],
    id: "free",
    limits: {
      chatRequestsPerDay: 50,
      chatRequestsPerMinute: 20,
      imageGenerationsPerDay: 0,
      maxContextTokens: 262_144,
      tokensPerDay: 150_000,
      tokensPerMinute: 40_000,
      toolRunsPerDay: 100,
      webSearchesPerDay: 25,
    },
    name: "Free",
    priceLabel: "$0",
    tagline: "Public free models plus your own local compute.",
  },
  plus: {
    ctaLabel: "Preview Plus",
    description: "Managed hosted models, account routes, images, and higher daily usage.",
    features: [
      "Managed hosted models and paid OpenRouter routes",
      "Subscription account routes through 9Router",
      "Image generation",
      "Higher chat, token, tool, and search limits",
    ],
    id: "plus",
    limits: {
      chatRequestsPerDay: 1_000,
      chatRequestsPerMinute: 60,
      imageGenerationsPerDay: 25,
      maxContextTokens: 262_144,
      tokensPerDay: 5_000_000,
      tokensPerMinute: 500_000,
      toolRunsPerDay: 1_000,
      webSearchesPerDay: 250,
    },
    name: "Plus",
    priceLabel: "$20/mo",
    stripePriceLookupKey: "gilbert_plus_monthly",
    tagline: "The everyday paid plan for serious coding work.",
  },
  pro: {
    ctaLabel: "Preview Pro",
    description: "Priority managed access, larger model budgets, and long-context work.",
    features: [
      "Everything in Plus",
      "Priority model routes and premium provider catalogs",
      "1M Codex subscription context when available",
      "Expanded images, tool runs, and token budget",
    ],
    id: "pro",
    limits: {
      chatRequestsPerDay: 5_000,
      chatRequestsPerMinute: 120,
      imageGenerationsPerDay: 100,
      maxContextTokens: 1_000_000,
      tokensPerDay: 25_000_000,
      tokensPerMinute: 2_000_000,
      toolRunsPerDay: 5_000,
      webSearchesPerDay: 1_000,
    },
    name: "Pro",
    priceLabel: "$60/mo",
    stripePriceLookupKey: "gilbert_pro_monthly",
    tagline: "For heavy agentic work, long repos, and premium routes.",
  },
  teams: {
    ctaLabel: "Coming soon",
    description: "Shared seats, workspace controls, central billing, and admin reporting.",
    features: [
      "Team seats and shared projects",
      "Admin billing and member controls",
      "Workspace model policy",
      "Priority support",
    ],
    id: "teams",
    limits: {
      chatRequestsPerDay: null,
      chatRequestsPerMinute: null,
      imageGenerationsPerDay: null,
      maxContextTokens: 1_000_000,
      tokensPerDay: null,
      tokensPerMinute: null,
      toolRunsPerDay: null,
      webSearchesPerDay: null,
    },
    name: "Teams",
    priceLabel: "Coming soon",
    tagline: "Multi-user billing and controls after individual plans are live.",
  },
};

const FREE_LOCAL_PROVIDER_IDS = new Set<ModelProviderId>(["lmstudio", "ollama", "vllm"]);
const FREE_PROVIDER_IDS = new Set<ModelProviderId>(["9router", "lmstudio", "ollama", "openrouter", "vllm"]);

export function isBillingTierId(value: unknown): value is BillingTierId {
  return typeof value === "string" && BILLING_TIER_ORDER.includes(value as BillingTierId);
}

export function normalizeBillingTierId(value: unknown): BillingTierId {
  return isBillingTierId(value) ? value : DEFAULT_BILLING_TIER;
}

export function normalizeBillingPlanSettings(value: unknown): BillingPlanSettings {
  const record = typeof value === "object" && value ? value as Partial<BillingPlanSettings> : {};
  const checkoutUrls = normalizeCheckoutUrls(record.checkoutUrls);

  return {
    checkoutUrls,
    currentPeriodEnd: normalizeOptionalText(record.currentPeriodEnd),
    customerPortalUrl: normalizeOptionalUrl(record.customerPortalUrl),
    source: record.source === "admin" || record.source === "stripe" || record.source === "local-preview" ? record.source : DEFAULT_BILLING_PLAN.source,
    status: isBillingPlanStatus(record.status) ? record.status : DEFAULT_BILLING_PLAN.status,
    stripeCustomerId: normalizeOptionalText(record.stripeCustomerId),
    stripeSubscriptionId: normalizeOptionalText(record.stripeSubscriptionId),
    tier: normalizeBillingTierId(record.tier),
    updatedAt: normalizeOptionalText(record.updatedAt),
  };
}

export function getBillingPlanTier(plan: BillingPlanSettings | undefined): BillingTierId {
  return normalizeBillingTierId(plan?.tier);
}

export function getBillingTierConfig(tier: BillingTierId | undefined): BillingTierConfig {
  return BILLING_TIERS[normalizeBillingTierId(tier)];
}

export function createLocalBillingPlanPreview(tier: BillingTierId): BillingPlanSettings {
  return {
    ...DEFAULT_BILLING_PLAN,
    source: "local-preview",
    status: tier === "free" ? "none" : "active",
    tier,
    updatedAt: new Date().toISOString(),
  };
}

export function isLocalInferenceProvider(provider: ModelProviderId) {
  return FREE_LOCAL_PROVIDER_IDS.has(provider);
}

export function isProviderAvailableForBillingTier(tier: BillingTierId | undefined, provider: ModelProviderId) {
  if (normalizeBillingTierId(tier) === "free") {
    return FREE_PROVIDER_IDS.has(provider);
  }

  return true;
}

export function getDefaultProviderForBillingTier(tier: BillingTierId | undefined): ModelProviderId {
  return normalizeBillingTierId(tier) === "free" ? "openrouter" : "openrouter";
}

export function getDefaultAllowedModelForProvider(tier: BillingTierId | undefined, provider: ModelProviderId) {
  const normalizedTier = normalizeBillingTierId(tier);

  if (normalizedTier !== "free") {
    return getDefaultModelForProvider(provider);
  }

  if (provider === "openrouter") {
    return OPENROUTER_FREE_AUTO_MODEL;
  }

  if (provider === "9router") {
    return NINE_ROUTER_ALWAYS_FREE_MODEL;
  }

  if (isLocalInferenceProvider(provider)) {
    return getDefaultModelForProvider(provider);
  }

  return undefined;
}

export function getBillingPlanAccessDecision(tier: BillingTierId | undefined, provider: ModelProviderId, model: string): BillingAccessDecision {
  const normalizedTier = normalizeBillingTierId(tier);
  const normalizedModel = model.trim();

  if (normalizedTier !== "free") {
    return { allowed: true };
  }

  if (isLocalInferenceProvider(provider)) {
    return { allowed: true };
  }

  if (provider === "openrouter" && isOpenRouterFreeModel(normalizedModel)) {
    return { allowed: true };
  }

  if (provider === "9router" && isFreeNineRouterModel(normalizedModel)) {
    return { allowed: true };
  }

  if (!FREE_PROVIDER_IDS.has(provider)) {
    return {
      allowed: false,
      reason: "Free can use OpenRouter free models or local Ollama, LM Studio, and vLLM routes. Upgrade to Plus for hosted provider API routes.",
    };
  }

  return {
    allowed: false,
    reason: "This model is outside the Free tier. Choose a free model route or upgrade to Plus.",
  };
}

export function assertBillingPlanAllowsModel(settings: ProviderSettings, model: string) {
  const decision = getBillingPlanAccessDecision(settings.billingPlan?.tier, settings.provider, model);

  if (!decision.allowed) {
    throw new Error(decision.reason || "Your current plan does not include this model route.");
  }
}

export function filterModelOptionsForBillingTier(tier: BillingTierId | undefined, options: ChatModelOption[]) {
  return options.filter((option) => getBillingPlanAccessDecision(tier, option.provider, option.value).allowed);
}

export function shouldApplyManagedUsageLimits(provider: ModelProviderId) {
  return !isLocalInferenceProvider(provider);
}

export function getBillingBucketLimit(tier: BillingTierId | undefined, bucket: BillingUsageBucket, window: "day" | "minute") {
  const limits = getBillingTierConfig(tier).limits;

  if (bucket === "chatRequests") {
    return window === "day" ? limits.chatRequestsPerDay : limits.chatRequestsPerMinute;
  }

  if (bucket === "imageGenerations") {
    return window === "day" ? limits.imageGenerationsPerDay : null;
  }

  if (bucket === "tokens") {
    return window === "day" ? limits.tokensPerDay : limits.tokensPerMinute;
  }

  if (bucket === "toolRuns") {
    return window === "day" ? limits.toolRunsPerDay : null;
  }

  return window === "day" ? limits.webSearchesPerDay : null;
}

export function formatBillingLimit(limit: number | null, unit: string) {
  if (limit === null) {
    return `Unlimited ${unit}`;
  }

  return `${limit.toLocaleString()} ${unit}`;
}

function isFreeNineRouterModel(model: string) {
  const normalizedModel = model.trim().toLowerCase();

  return (
    normalizedModel === NINE_ROUTER_ALWAYS_FREE_MODEL ||
    normalizedModel.startsWith("oc/") ||
    normalizedModel.startsWith("free/") ||
    normalizedModel.startsWith("freetheai/") ||
    (normalizedModel.startsWith("openrouter/") && normalizedModel.endsWith(":free"))
  );
}

function isBillingPlanStatus(value: unknown): value is BillingPlanSettings["status"] {
  return value === "active" || value === "canceled" || value === "incomplete" || value === "none" || value === "past_due" || value === "trialing";
}

function normalizeCheckoutUrls(value: unknown): BillingPlanSettings["checkoutUrls"] {
  if (typeof value !== "object" || !value) {
    return {};
  }

  const record = value as Record<string, unknown>;
  return {
    plus: normalizeOptionalUrl(record.plus),
    pro: normalizeOptionalUrl(record.pro),
  };
}

function normalizeOptionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeOptionalUrl(value: unknown) {
  const text = normalizeOptionalText(value);

  if (!text) {
    return undefined;
  }

  try {
    const url = new URL(text);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}
