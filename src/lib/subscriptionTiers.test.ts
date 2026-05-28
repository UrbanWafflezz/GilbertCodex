import { describe, expect, it } from "vitest";
import {
  BILLING_TIERS,
  createLocalBillingPlanPreview,
  filterModelOptionsForBillingTier,
  getBillingPlanAccessDecision,
  getBillingPlanTier,
  normalizeBillingPlanSettings,
} from "./subscriptionTiers";
import {
  DEEPSEEK_V4_FLASH_FREE_MODEL,
  OPENROUTER_FREE_AUTO_MODEL,
  type ChatModelOption,
} from "./models";

describe("subscription tiers", () => {
  it("keeps Free limited to free hosted routes and local inference", () => {
    expect(getBillingPlanAccessDecision("free", "openrouter", OPENROUTER_FREE_AUTO_MODEL).allowed).toBe(true);
    expect(getBillingPlanAccessDecision("free", "openrouter", DEEPSEEK_V4_FLASH_FREE_MODEL).allowed).toBe(true);
    expect(getBillingPlanAccessDecision("free", "ollama", "llama3.3").allowed).toBe(true);
    expect(getBillingPlanAccessDecision("free", "openai", "gpt-5.5").allowed).toBe(false);
    expect(getBillingPlanAccessDecision("free", "openrouter", "~openai/gpt-latest").allowed).toBe(false);
  });

  it("unlocks hosted provider and paid model routes for paid tiers", () => {
    expect(getBillingPlanAccessDecision("plus", "openai", "gpt-5.5").allowed).toBe(true);
    expect(getBillingPlanAccessDecision("pro", "openrouter", "~anthropic/claude-sonnet-latest").allowed).toBe(true);
  });

  it("advertises the Plus free trial without changing Pro pricing", () => {
    expect(BILLING_TIERS.plus.trialLabel).toBe("1 month free");
    expect(BILLING_TIERS.plus.ctaLabel).toBe("Start Plus trial");
    expect(BILLING_TIERS.plus.features).toContain("1 month free, then $20/mo");
    expect(BILLING_TIERS.pro.trialLabel).toBeUndefined();
  });

  it("filters model picker options for the active tier", () => {
    const options: ChatModelOption[] = [
      {
        detail: "Free route",
        id: "free",
        label: "Free",
        provider: "openrouter",
        value: DEEPSEEK_V4_FLASH_FREE_MODEL,
      },
      {
        detail: "Paid route",
        id: "paid",
        label: "Paid",
        provider: "openrouter",
        value: "~openai/gpt-latest",
      },
    ];

    expect(filterModelOptionsForBillingTier("free", options).map((option) => option.id)).toEqual(["free"]);
    expect(filterModelOptionsForBillingTier("plus", options).map((option) => option.id)).toEqual(["free", "paid"]);
  });

  it("normalizes local preview plan state for storage", () => {
    const plan = normalizeBillingPlanSettings({
      checkoutUrls: {
        plus: "https://checkout.stripe.com/plus",
        pro: "http://example.test/not-allowed",
      },
      source: "stripe",
      status: "active",
      tier: "pro",
    });

    expect(plan).toMatchObject({
      checkoutUrls: {
        plus: "https://checkout.stripe.com/plus",
        pro: undefined,
      },
      source: "stripe",
      status: "active",
      tier: "pro",
    });

    expect(createLocalBillingPlanPreview("plus")).toMatchObject({
      source: "local-preview",
      status: "active",
      tier: "plus",
    });
  });

  it("only treats active Stripe or admin paid plans as paid entitlements", () => {
    expect(getBillingPlanTier({ source: "stripe", status: "active", tier: "plus" })).toBe("plus");
    expect(getBillingPlanTier({ source: "stripe", status: "trialing", tier: "pro" })).toBe("pro");
    expect(getBillingPlanTier({ source: "admin", status: "active", tier: "plus" })).toBe("plus");
    expect(getBillingPlanTier({ source: "stripe", status: "past_due", tier: "plus" })).toBe("free");
    expect(getBillingPlanTier({ source: "local-preview", status: "active", tier: "pro" })).toBe("free");
  });
});
