import { CheckCircle2, Eye, EyeOff, KeyRound, Trash2 } from "lucide-react";
import { MODEL_PROVIDERS, getDefaultBaseUrlForProvider, type ModelProviderCatalogItem } from "../../../lib/models";
import { getBillingPlanAccessDecision, getBillingPlanTier, isProviderAvailableForBillingTier } from "../../../lib/subscriptionTiers";
import type { ModelProviderId, ProviderSettings } from "../../../types/settings";
import type { SettingsStatusMessage } from "../types";
import { SettingsSectionHeading } from "../components/SettingsSectionHeading";

interface ProvidersSettingsPageProps {
  activeProvider: ModelProviderCatalogItem;
  activeProviderApiKey: string;
  activeProviderBaseUrl: string;
  onClearApiKey: () => void;
  onSelectProvider: (provider: ModelProviderId) => void;
  onTestConnection: () => void;
  onToggleShowKey: () => void;
  onUpdateActiveProviderApiKey: (apiKey: string) => void;
  onUpdateActiveProviderBaseUrl: (baseUrl: string) => void;
  settings: ProviderSettings;
  showKey: boolean;
  showHeading?: boolean;
  testing: boolean;
  testStatus: SettingsStatusMessage | null;
}

export function ProvidersSettingsPage({
  activeProvider,
  activeProviderApiKey,
  activeProviderBaseUrl,
  onClearApiKey,
  onSelectProvider,
  onTestConnection,
  onToggleShowKey,
  onUpdateActiveProviderApiKey,
  onUpdateActiveProviderBaseUrl,
  settings,
  showKey,
  showHeading = true,
  testing,
  testStatus,
}: ProvidersSettingsPageProps) {
  const billingTier = getBillingPlanTier(settings.billingPlan);
  const isSubscriptionsProvider = settings.provider === "9router";
  const activeProviderAvailable = isProviderAvailableForBillingTier(billingTier, settings.provider);
  const activeModelAccess = getBillingPlanAccessDecision(billingTier, settings.provider, settings.model);
  const providerDetail = isSubscriptionsProvider
    ? "Subscription account routes. No API key is used for these models."
    : activeProvider.requiresApiKey
      ? `${activeProvider.label} API key route.`
      : activeProvider.optionalApiKey
        ? `${activeProvider.label} local route. API key optional.`
        : activeProvider.detail;

  return (
    <>
      {showHeading ? <SettingsSectionHeading detail="Choose the default provider and keep API-key routes separate from subscriptions." icon={KeyRound} title="Providers" /> : null}
      <div className="settings-section-grid">
        <article className="settings-card settings-card-wide">
          <div className="settings-card-heading">
            <KeyRound size={19} aria-hidden="true" />
            <div>
              <h2>Default provider</h2>
              <p>{providerDetail}</p>
            </div>
          </div>

          <div className="provider-picker-grid" role="radiogroup" aria-label="Default model provider">
            {MODEL_PROVIDERS.map((provider) => {
              const providerAvailable = isProviderAvailableForBillingTier(billingTier, provider.id);

              return (
                <button
                  key={provider.id}
                  type="button"
                  role="radio"
                  aria-checked={settings.provider === provider.id}
                  data-locked={!providerAvailable}
                  data-selected={settings.provider === provider.id}
                  disabled={!providerAvailable}
                  title={providerAvailable ? provider.detail : "Upgrade to Plus to use hosted API provider routes."}
                  onClick={() => onSelectProvider(provider.id)}
                >
                  <strong>{provider.label}</strong>
                  <small>{formatProviderCredentialHint(provider, billingTier)}</small>
                </button>
              );
            })}
          </div>

          {!isSubscriptionsProvider ? (
            <label className="settings-field">
              <span>{activeProvider.apiKeyLabel}</span>
              <div className="settings-secret-row">
                <input
                  autoComplete="off"
                  placeholder={activeProvider.apiKeyPlaceholder}
                  type={showKey ? "text" : "password"}
                  value={activeProviderApiKey}
                  onChange={(event) => onUpdateActiveProviderApiKey(event.target.value)}
                />
                <button type="button" aria-label={showKey ? "Hide API key" : "Show API key"} onClick={onToggleShowKey}>
                  {showKey ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
                </button>
                <button type="button" aria-label="Clear API key" disabled={!activeProviderApiKey.trim()} onClick={onClearApiKey}>
                  <Trash2 size={17} aria-hidden="true" />
                </button>
              </div>
            </label>
          ) : null}

          {!isSubscriptionsProvider ? (
            <label className="settings-field">
              <span>{activeProvider.baseUrlLabel}</span>
              <div className="settings-url-row">
                <input
                  autoComplete="off"
                  placeholder={activeProvider.baseUrlPlaceholder}
                  value={activeProviderBaseUrl}
                  onChange={(event) => onUpdateActiveProviderBaseUrl(event.target.value)}
                />
                <button type="button" onClick={() => onUpdateActiveProviderBaseUrl(getDefaultBaseUrlForProvider(settings.provider))}>
                  Default
                </button>
              </div>
            </label>
          ) : null}

          <div className="settings-actions-row">
            <button className="settings-primary-button" type="button" disabled={testing || !activeProviderAvailable || !activeModelAccess.allowed} onClick={onTestConnection}>
              <CheckCircle2 size={16} aria-hidden="true" />
              {testing ? "Checking" : isSubscriptionsProvider ? "Test subscriptions" : "Test provider"}
            </button>
            {testStatus ? (
              <span className="settings-status" data-kind={testStatus.kind}>
                {testStatus.text}
              </span>
            ) : null}
          </div>
        </article>
      </div>
    </>
  );
}

function formatProviderCredentialHint(provider: ModelProviderCatalogItem, billingTier: string) {
  if (billingTier === "free" && (provider.id === "anthropic" || provider.id === "deepseek" || provider.id === "google" || provider.id === "groq" || provider.id === "mistral" || provider.id === "openai" || provider.id === "xai")) {
    return "Plus route";
  }

  if (provider.id === "9router") {
    return billingTier === "free" ? "Free route only" : "Subscription accounts";
  }

  if (provider.requiresApiKey) {
    return "API key route";
  }

  return provider.optionalApiKey ? "Optional key" : "Local";
}
