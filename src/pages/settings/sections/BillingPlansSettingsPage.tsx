import { BadgeDollarSign, Check, Crown, ExternalLink, LockKeyhole, Sparkles, Users } from "lucide-react";
import { openExternalUrl } from "../../../app/tauriClient";
import {
  BILLING_TIER_ORDER,
  BILLING_TIERS,
  createLocalBillingPlanPreview,
  formatBillingLimit,
  getBillingPlanTier,
} from "../../../lib/subscriptionTiers";
import type { BillingTierId, ProviderSettings } from "../../../types/settings";
import { SettingsSectionHeading } from "../components/SettingsSectionHeading";

interface BillingPlansSettingsPageProps {
  onSettingsPatch: (settings: Partial<ProviderSettings>) => void;
  settings: ProviderSettings;
}

export function BillingPlansSettingsPage({ onSettingsPatch, settings }: BillingPlansSettingsPageProps) {
  const currentTier = getBillingPlanTier(settings.billingPlan);
  const currentPlan = BILLING_TIERS[currentTier];
  const checkoutUrls = settings.billingPlan.checkoutUrls ?? {};
  const customerPortalUrl = settings.billingPlan.customerPortalUrl;

  function previewTier(tier: BillingTierId) {
    if (tier === "teams") {
      return;
    }

    onSettingsPatch({
      billingPlan: {
        ...createLocalBillingPlanPreview(tier),
        checkoutUrls,
        customerPortalUrl,
        stripeCustomerId: settings.billingPlan.stripeCustomerId,
        stripeSubscriptionId: settings.billingPlan.stripeSubscriptionId,
      },
    });
  }

  function openCheckout(tier: BillingTierId) {
    const checkoutUrl = tier === "plus" || tier === "pro" ? checkoutUrls[tier] : undefined;

    if (checkoutUrl) {
      void openExternalUrl(checkoutUrl);
      return;
    }

    previewTier(tier);
  }

  return (
    <>
      <SettingsSectionHeading detail="Plan access, usage quotas, Stripe readiness, and paid-model gates." icon={BadgeDollarSign} title="Plans" />
      <div className="settings-section-grid billing-plan-overview">
        <article className="settings-card settings-card-wide billing-current-card">
          <div className="settings-card-heading">
            <Crown size={19} aria-hidden="true" />
            <div>
              <h2>{currentPlan.name}</h2>
              <p>{settings.billingPlan.source === "stripe" ? "Stripe synced subscription" : "Local plan preview"}</p>
            </div>
          </div>
          <div className="billing-current-metrics">
            <BillingMetric label="Managed chat" value={formatBillingLimit(currentPlan.limits.chatRequestsPerDay, "requests/day")} />
            <BillingMetric label="Tokens" value={formatBillingLimit(currentPlan.limits.tokensPerDay, "tokens/day")} />
            <BillingMetric label="Images" value={formatBillingLimit(currentPlan.limits.imageGenerationsPerDay, "images/day")} />
            <BillingMetric label="Context" value={currentPlan.limits.maxContextTokens ? `${currentPlan.limits.maxContextTokens.toLocaleString()} tokens` : "Unlimited context"} />
          </div>
        </article>

        <div className="billing-plan-grid settings-card-wide">
          {BILLING_TIER_ORDER.map((tierId) => {
            const tier = BILLING_TIERS[tierId];
            const selected = tierId === currentTier;
            const checkoutUrl = tierId === "plus" || tierId === "pro" ? checkoutUrls[tierId] : undefined;
            const disabled = tierId === "teams";

            return (
              <article className="settings-card billing-plan-card" data-selected={selected} data-disabled={disabled} key={tier.id}>
                <div className="billing-plan-card-top">
                  <div>
                    <h2>{tier.name}</h2>
                    <p>{tier.tagline}</p>
                  </div>
                  {tier.id === "teams" ? <Users size={19} aria-hidden="true" /> : tier.id === "free" ? <Sparkles size={19} aria-hidden="true" /> : <Crown size={19} aria-hidden="true" />}
                </div>
                <strong className="billing-plan-price">{tier.priceLabel}</strong>
                <p className="billing-plan-description">{tier.description}</p>
                <ul className="billing-feature-list">
                  {tier.features.map((feature) => (
                    <li key={feature}>
                      <Check size={14} aria-hidden="true" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                <div className="billing-plan-limits">
                  <span>{formatBillingLimit(tier.limits.chatRequestsPerMinute, "RPM")}</span>
                  <span>{formatBillingLimit(tier.limits.tokensPerMinute, "TPM")}</span>
                  <span>{formatBillingLimit(tier.limits.toolRunsPerDay, "tool runs/day")}</span>
                </div>
                <button
                  className={selected ? "settings-secondary-button" : "settings-primary-button"}
                  disabled={disabled}
                  type="button"
                  onClick={() => openCheckout(tier.id)}
                >
                  {checkoutUrl ? <ExternalLink size={16} aria-hidden="true" /> : disabled ? <LockKeyhole size={16} aria-hidden="true" /> : <BadgeDollarSign size={16} aria-hidden="true" />}
                  {selected ? "Current plan" : tier.ctaLabel}
                </button>
              </article>
            );
          })}
        </div>

        <article className="settings-card settings-card-wide billing-stripe-card">
          <div className="settings-card-heading">
            <BadgeDollarSign size={19} aria-hidden="true" />
            <div>
              <h2>Stripe handoff</h2>
              <p>Checkout URLs and Customer Portal stay disabled until your Stripe backend is connected.</p>
            </div>
          </div>
          <div className="billing-stripe-grid">
            <BillingMetric label="Plus lookup key" value={BILLING_TIERS.plus.stripePriceLookupKey ?? "Not set"} />
            <BillingMetric label="Pro lookup key" value={BILLING_TIERS.pro.stripePriceLookupKey ?? "Not set"} />
            <BillingMetric label="Status source" value={settings.billingPlan.source} />
          </div>
          <div className="settings-actions-row">
            <button type="button" disabled={!customerPortalUrl} onClick={() => customerPortalUrl ? void openExternalUrl(customerPortalUrl) : undefined}>
              <ExternalLink size={16} aria-hidden="true" />
              Manage billing
            </button>
            <span className="settings-status" data-kind="warning">
              Firebase/auth sync is intentionally not active yet.
            </span>
          </div>
        </article>
      </div>
    </>
  );
}

function BillingMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="billing-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
