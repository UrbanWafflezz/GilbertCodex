import { BadgeDollarSign, Check, Crown, ExternalLink, LockKeyhole, RefreshCcw, Sparkles, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { openExternalUrl } from "../../../app/tauriClient";
import {
  BILLING_TIER_ORDER,
  BILLING_TIERS,
  formatBillingLimit,
  getBillingPlanTier,
  normalizeBillingPlanSettings,
} from "../../../lib/subscriptionTiers";
import {
  createBillingCheckoutSession,
  createBillingPortalSession,
  getBillingStatus,
  isBillingGatewayConfigured,
} from "../../../services/billingClient";
import type { BillingTierId, ProviderSettings } from "../../../types/settings";
import { SettingsSectionHeading } from "../components/SettingsSectionHeading";

interface BillingPlansSettingsPageProps {
  onSettingsPatch: (settings: Partial<ProviderSettings>) => void;
  settings: ProviderSettings;
}

export function BillingPlansSettingsPage({ onSettingsPatch, settings }: BillingPlansSettingsPageProps) {
  const [busyAction, setBusyAction] = useState<BillingTierId | "portal" | "refresh" | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ kind: "error" | "success" | "warning"; text: string } | null>(null);
  const currentTier = getBillingPlanTier(settings.billingPlan);
  const currentPlan = BILLING_TIERS[currentTier];
  const billingGatewayConfigured = useMemo(() => isBillingGatewayConfigured(), []);

  useEffect(() => {
    if (!billingGatewayConfigured) {
      setStatusMessage({ kind: "warning", text: "Billing is not available in this build." });
      return;
    }

    void refreshBillingStatus({ silent: true });
  }, [billingGatewayConfigured]);

  async function refreshBillingStatus(options: { silent?: boolean } = {}) {
    if (!billingGatewayConfigured) {
      setStatusMessage({ kind: "warning", text: "Billing is not available in this build." });
      return;
    }

    if (!options.silent) {
      setBusyAction("refresh");
    }

    try {
      const status = await getBillingStatus();
      onSettingsPatch({
        billingPlan: normalizeBillingPlanSettings(status.billingPlan),
      });
      if (!options.silent) {
        setStatusMessage({ kind: "success", text: "Billing status refreshed." });
      }
    } catch (error) {
      setStatusMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not refresh billing status." });
    } finally {
      if (!options.silent) {
        setBusyAction(null);
      }
    }
  }

  async function openCheckout(tier: BillingTierId) {
    if (tier !== "plus" && tier !== "pro") {
      return;
    }

    setBusyAction(tier);
    setStatusMessage(null);
    try {
      const session = await createBillingCheckoutSession(tier);
      await openExternalUrl(session.url);
      setStatusMessage({ kind: "success", text: session.trialDays ? `Checkout opened with a ${session.trialDays}-day trial.` : "Checkout opened." });
    } catch (error) {
      setStatusMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not start checkout." });
    } finally {
      setBusyAction(null);
    }
  }

  async function openPortal() {
    setBusyAction("portal");
    setStatusMessage(null);
    try {
      const session = await createBillingPortalSession();
      await openExternalUrl(session.url);
      setStatusMessage({ kind: "success", text: "Subscription management opened." });
    } catch (error) {
      setStatusMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not open billing management." });
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <>
      <SettingsSectionHeading detail="Plan access, usage quotas, billing, and paid-model access." icon={BadgeDollarSign} title="Plans" />
      <div className="settings-section-grid billing-plan-overview">
        <article className="settings-card settings-card-wide billing-current-card">
          <div className="settings-card-heading">
            <Crown size={19} aria-hidden="true" />
            <div>
              <h2>{currentPlan.name}</h2>
              <p>{formatBillingPlanSource(settings.billingPlan.source, settings.billingPlan.status)}</p>
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
            const paidTier = tierId === "plus" || tierId === "pro";
            const disabled = tierId === "teams" || (paidTier && !billingGatewayConfigured) || busyAction !== null;
            const buttonLabel = selected ? (tierId === "free" ? "Current plan" : "Manage plan") : busyAction === tierId ? "Opening..." : tier.ctaLabel;

            return (
              <article className="settings-card billing-plan-card" data-selected={selected} data-disabled={disabled} key={tier.id}>
                <div className="billing-plan-card-top">
                  <div>
                    <h2>{tier.name}</h2>
                    <p>{tier.tagline}</p>
                  </div>
                  {tier.id === "teams" ? <Users size={19} aria-hidden="true" /> : tier.id === "free" ? <Sparkles size={19} aria-hidden="true" /> : <Crown size={19} aria-hidden="true" />}
                </div>
                <strong className="billing-plan-price">{tier.trialLabel ? `${tier.trialLabel}, then ${tier.priceLabel}` : tier.priceLabel}</strong>
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
                  onClick={() => selected && tier.id !== "free" ? void openPortal() : void openCheckout(tier.id)}
                >
                  {selected && tier.id !== "free" ? <ExternalLink size={16} aria-hidden="true" /> : disabled ? <LockKeyhole size={16} aria-hidden="true" /> : <BadgeDollarSign size={16} aria-hidden="true" />}
                  {buttonLabel}
                </button>
              </article>
            );
          })}
        </div>

        <article className="settings-card settings-card-wide billing-stripe-card">
          <div className="settings-card-heading">
            <BadgeDollarSign size={19} aria-hidden="true" />
            <div>
              <h2>Subscription billing</h2>
              <p>Manage your subscription or refresh your current plan.</p>
            </div>
          </div>
          <div className="settings-actions-row">
            <button type="button" disabled={!billingGatewayConfigured || busyAction !== null} onClick={() => void openPortal()}>
              <ExternalLink size={16} aria-hidden="true" />
              {busyAction === "portal" ? "Opening subscription" : "Manage subscription"}
            </button>
            <button type="button" disabled={!billingGatewayConfigured || busyAction !== null} onClick={() => void refreshBillingStatus()}>
              <RefreshCcw size={16} aria-hidden="true" />
              {busyAction === "refresh" ? "Refreshing" : "Refresh status"}
            </button>
            {statusMessage ? <span className="settings-status" data-kind={statusMessage.kind}>{statusMessage.text}</span> : null}
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

function formatBillingPlanSource(source: ProviderSettings["billingPlan"]["source"], status: ProviderSettings["billingPlan"]["status"]) {
  if (source === "stripe") {
    return status === "active" || status === "trialing" ? "Subscription synced" : `Subscription status: ${status}`;
  }

  if (source === "admin") {
    return "Admin granted subscription";
  }

  return "Free account baseline";
}
