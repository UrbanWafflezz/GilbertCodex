import { BadgeDollarSign, Check, Eye, EyeOff, LockKeyhole, ServerCog, SlidersHorizontal } from "lucide-react";
import { DEFAULT_LOCAL_CONTEXT_WINDOW_TOKENS, getAutomaticHostedMaxOutputTokens, isLocalModelProvider } from "../../../lib/generationSettings";
import { formatTokenCount } from "../../../lib/contextWindow";
import { MODEL_PROVIDERS, formatModelCapabilitySummary, formatModelPricingSummary, formatModelPricingTitle, getEffectiveProviderModelContextWindowTokens, getModelRouteSourceInfo, isNineRouterCodexModelId, type ChatModelOption, type ModelProviderCatalogItem } from "../../../lib/models";
import { getBillingPlanAccessDecision, getBillingPlanTier, getBillingTierConfig } from "../../../lib/subscriptionTiers";
import type { ModelProviderId, ProviderSettings, SubscriptionCodexContextWindow } from "../../../types/settings";
import type { LiveModelCatalogStatus } from "../types";
import { SettingsSectionHeading } from "../components/SettingsSectionHeading";

interface ModelSettingsPageProps {
  activeProvider: ModelProviderCatalogItem;
  activeProviderAllModels: ChatModelOption[];
  activeProviderDisabledModels: string[];
  activeProviderModels: ChatModelOption[];
  activeProviderPrefersLiveCatalog: boolean;
  activeProviderUsesLiveCatalog: boolean;
  liveProviderModelStatus: LiveModelCatalogStatus;
  liveProviderModelStatusText: string;
  onSelectProvider: (provider: ModelProviderId) => void;
  onSettingsPatch: (settings: Partial<ProviderSettings>) => void;
  onToggleActiveProviderModel: (model: string, enabled: boolean) => void;
  onUpdateActiveProviderModel: (model: string) => void;
  settings: ProviderSettings;
  showHeading?: boolean;
}

export function ModelSettingsPage({
  activeProvider,
  activeProviderAllModels,
  activeProviderDisabledModels,
  activeProviderModels,
  activeProviderPrefersLiveCatalog,
  activeProviderUsesLiveCatalog,
  liveProviderModelStatus,
  liveProviderModelStatusText,
  onSelectProvider,
  onSettingsPatch,
  onToggleActiveProviderModel,
  onUpdateActiveProviderModel,
  settings,
  showHeading = true,
}: ModelSettingsPageProps) {
  const billingTier = getBillingPlanTier(settings.billingPlan);
  const billingTierConfig = getBillingTierConfig(billingTier);
  const localGenerationControls = isLocalModelProvider(settings.provider);
  const disabledModelSet = new Set(activeProviderDisabledModels);
  const activeModelOption = activeProviderAllModels.find((option) => option.value === settings.model);
  const activeModelAccess = getBillingPlanAccessDecision(billingTier, settings.provider, settings.model);
  const activeModelContextTokens = getSettingsAwareModelContextTokens(settings, activeModelOption);
  const automaticHostedMaxTokens = getAutomaticHostedMaxOutputTokens(settings, activeModelContextTokens);
  const enabledModelCount = activeProviderAllModels.filter((option) => !disabledModelSet.has(option.value)).length;
  const localContextWindowTokens = settings.contextWindowTokens?.[settings.provider] ?? DEFAULT_LOCAL_CONTEXT_WINDOW_TOKENS;
  const activeModelBudgetOverride = settings.modelBudgetOverrides?.[settings.provider]?.[settings.model] ?? {};
  const activeRouteSource = getModelRouteSourceInfo(settings.provider, settings.model);
  const activeProviderPresetLabel = "Default model";
  const activeCodexSubscriptionModel = settings.provider === "9router" && isNineRouterCodexModelId(settings.model);
  const codexContextWindowMode = settings.subscriptionOptimization?.codexContextWindow ?? "standard";

  function patchActiveModelBudgetOverride(patch: { contextWindowTokens?: number; maxOutputTokens?: number }) {
    const model = settings.model.trim();
    if (!model) {
      return;
    }

    const providerOverrides = settings.modelBudgetOverrides?.[settings.provider] ?? {};
    const nextOverride = {
      ...providerOverrides[model],
      ...patch,
    };
    const cleanedOverride = {
      contextWindowTokens: nextOverride.contextWindowTokens && nextOverride.contextWindowTokens > 0 ? nextOverride.contextWindowTokens : undefined,
      maxOutputTokens: nextOverride.maxOutputTokens && nextOverride.maxOutputTokens > 0 ? nextOverride.maxOutputTokens : undefined,
    };
    const nextProviderOverrides = { ...providerOverrides };

    if (cleanedOverride.contextWindowTokens || cleanedOverride.maxOutputTokens) {
      nextProviderOverrides[model] = cleanedOverride;
    } else {
      delete nextProviderOverrides[model];
    }

    onSettingsPatch({
      modelBudgetOverrides: {
        ...(settings.modelBudgetOverrides ?? {}),
        [settings.provider]: nextProviderOverrides,
      },
    });
  }

  function updateCodexContextWindow(mode: SubscriptionCodexContextWindow) {
    onSettingsPatch({
      subscriptionOptimization: {
        ...settings.subscriptionOptimization,
        codexContextWindow: mode,
      },
    });
  }

  return (
    <>
      {showHeading ? <SettingsSectionHeading detail="Model identity, system prompt, and generation controls." icon={ServerCog} title="Model" /> : null}
      <div className="settings-section-grid">
        <article className="settings-card settings-card-wide model-settings-card">
          <div className="settings-card-heading">
            <ServerCog size={19} aria-hidden="true" />
            <div>
              <h2>Default model</h2>
              <p>{activeRouteSource.sourceLabel} - {enabledModelCount} of {activeProviderAllModels.length} enabled - {billingTierConfig.name}</p>
            </div>
          </div>
          {!activeModelAccess.allowed ? (
            <div className="settings-status" data-kind="warning">
              <LockKeyhole size={15} aria-hidden="true" />
              {activeModelAccess.reason}
            </div>
          ) : null}
          <div className="settings-model-summary">
            <div>
              <strong>{activeModelOption?.label ?? (settings.model || "Choose model")}</strong>
              <span>{settings.model ? `${activeRouteSource.sourceLabel} - ${settings.model}` : "No model selected"}</span>
            </div>
            <div className="settings-model-summary-metrics">
              <span title={formatPricingTitle(activeModelOption?.pricing)}>
                <BadgeDollarSign size={14} aria-hidden="true" />
                {formatPricingSummary(activeModelOption?.pricing)}
              </span>
              <span>{formatModelContextTokens(activeModelContextTokens)}</span>
            </div>
          </div>
          <div className="settings-model-control-grid">
            <label className="settings-field">
              <span>Default provider</span>
              <select value={settings.provider} onChange={(event) => onSelectProvider(event.target.value as ModelProviderId)}>
                {MODEL_PROVIDERS.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="settings-field">
              <span>{activeProviderPresetLabel}</span>
              <select value={settings.model} onChange={(event) => onUpdateActiveProviderModel(event.target.value)}>
                {activeProviderModels.length === 0 ? (
                  <option value="">{activeProviderPrefersLiveCatalog ? "No loaded models found" : "Choose a model"}</option>
                ) : !settings.model.trim() ? (
                  <option value="">{activeProviderPrefersLiveCatalog ? "Choose a loaded model" : "Choose a model"}</option>
                ) : null}
                {activeProviderModels.map((option) => (
                  <option key={option.id} value={option.value}>
                    {option.label} - {getModelRouteSourceInfo(option.provider, option.value).sourceLabel} - {formatModelCapabilitySummary(option)}
                  </option>
                ))}
              </select>
              {activeProviderUsesLiveCatalog ? (
                <small className="settings-field-note" data-kind={liveProviderModelStatus}>
                  {liveProviderModelStatusText}
                </small>
              ) : null}
            </label>
          </div>
          <label className="settings-field">
            <span>Model ID</span>
            <input value={settings.model} onChange={(event) => onUpdateActiveProviderModel(event.target.value)} />
          </label>
          <div className="settings-model-library" aria-label={`${activeProvider.label} model visibility`}>
            {activeProviderAllModels.length === 0 ? (
              <div className="settings-model-empty">{activeProviderPrefersLiveCatalog ? "No loaded models found" : "No models found"}</div>
            ) : (
              activeProviderAllModels.map((option) => {
                const disabled = disabledModelSet.has(option.value);
                const selected = option.value === settings.model;
                const cannotDisable = !disabled && enabledModelCount <= 1;

                return (
                  <div className="settings-model-row" data-disabled={disabled} data-selected={selected} key={`${option.provider}:${option.id}`}>
                    <label className="settings-model-toggle" title={disabled ? "Enable model" : "Disable model"}>
                      <input
                        type="checkbox"
                        checked={!disabled}
                        disabled={cannotDisable}
                        onChange={(event) => onToggleActiveProviderModel(option.value, event.target.checked)}
                      />
                      <span aria-hidden="true">{disabled ? <EyeOff size={14} /> : <Eye size={14} />}</span>
                    </label>
                    <div className="settings-model-row-main">
                      <strong>
                        {option.label}
                        {selected ? <Check size={14} aria-hidden="true" /> : null}
                      </strong>
                      <small>{getModelRouteSourceInfo(option.provider, option.value).sourceLabel} - {formatModelCapabilitySummary(option)}</small>
                      <code>{option.value}</code>
                    </div>
                    <div className="settings-model-row-metrics">
                      <span title={formatPricingTitle(option.pricing)}>{formatPricingSummary(option.pricing)}</span>
                      <span>{formatModelContextTokens(getSettingsAwareModelContextTokens(settings, option))}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <label className="settings-field settings-field-tall">
            <span>System prompt</span>
            <textarea rows={6} value={settings.systemPrompt} onChange={(event) => onSettingsPatch({ systemPrompt: event.target.value })} />
          </label>
        </article>

        <article className="settings-card">
          <div className="settings-card-heading">
            <SlidersHorizontal size={19} aria-hidden="true" />
            <div>
              <h2>Generation</h2>
              <p>{localGenerationControls ? "Applied to local provider calls." : "Automatic for hosted providers."}</p>
            </div>
          </div>
          {localGenerationControls ? (
            <>
              {activeCodexSubscriptionModel ? null : (
                <label className="settings-field">
                  <span>Context window</span>
                  <input
                    min="4096"
                    step="1024"
                    type="number"
                    value={localContextWindowTokens}
                    onChange={(event) =>
                      onSettingsPatch({
                        contextWindowTokens: {
                          ...settings.contextWindowTokens,
                          [settings.provider]: Number(event.target.value),
                        },
                      })
                    }
                  />
                </label>
              )}
              <label className="settings-field">
                <span>Temperature</span>
                <input
                  max="2"
                  min="0"
                  step="0.05"
                  type="number"
                  value={settings.temperature}
                  onChange={(event) => onSettingsPatch({ temperature: Number(event.target.value) })}
                />
              </label>
              <label className="settings-field">
                <span>Top P</span>
                <input
                  max="1"
                  min="0"
                  step="0.01"
                  type="number"
                  value={settings.topP}
                  onChange={(event) => onSettingsPatch({ topP: Number(event.target.value) })}
                />
              </label>
              <label className="settings-field">
                <span>Top K</span>
                <input
                  min="1"
                  step="1"
                  type="number"
                  value={settings.topK}
                  onChange={(event) => onSettingsPatch({ topK: Number(event.target.value) })}
                />
              </label>
              <label className="settings-field">
                <span>Max tokens</span>
                <input
                  min="256"
                  step="256"
                  type="number"
                  value={settings.maxTokens}
                  onChange={(event) => onSettingsPatch({ maxTokens: Number(event.target.value) })}
                />
              </label>
            </>
          ) : (
            <div className="settings-stack">
              <strong className="settings-large-value">Automatic</strong>
              <span className="settings-subtle-text">Sampling follows provider defaults. Hosted responses cap automatically at {formatTokenCount(automaticHostedMaxTokens)}.</span>
            </div>
          )}
          {activeCodexSubscriptionModel ? (
            <div className="settings-stack">
              <strong>Codex subscription context</strong>
              <span className="settings-subtle-text">Default 262k context keeps normal Codex subscription usage lower. 1M is for long repo or document runs and may cost more.</span>
              <div className="settings-segmented-control settings-segmented-control-compact" aria-label="Codex subscription context window">
                {CODEX_CONTEXT_WINDOW_OPTIONS.map((option) => (
                  <button
                    aria-pressed={codexContextWindowMode === option.mode}
                    data-selected={codexContextWindowMode === option.mode}
                    key={option.mode}
                    title={option.detail}
                    type="button"
                    onClick={() => updateCodexContextWindow(option.mode)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="settings-stack">
            <strong>Manual model budget override</strong>
            <span className="settings-subtle-text">Use only when a provider catalog is stale or a local runtime is configured below the model default.</span>
            {activeCodexSubscriptionModel ? (
              <span className="settings-subtle-text">Codex subscription context uses the 262k or 1M setting above.</span>
            ) : (
              <label className="settings-field">
                <span>Context window override</span>
                <input
                  min="4096"
                  placeholder={activeModelContextTokens ? String(activeModelContextTokens) : "Auto"}
                  step="1024"
                  type="number"
                  value={activeModelBudgetOverride.contextWindowTokens ?? ""}
                  onChange={(event) => patchActiveModelBudgetOverride({ contextWindowTokens: event.target.value ? Number(event.target.value) : undefined })}
                />
              </label>
            )}
            <label className="settings-field">
              <span>Max output override</span>
              <input
                min="256"
                placeholder={String(automaticHostedMaxTokens)}
                step="256"
                type="number"
                value={activeModelBudgetOverride.maxOutputTokens ?? ""}
                onChange={(event) => patchActiveModelBudgetOverride({ maxOutputTokens: event.target.value ? Number(event.target.value) : undefined })}
              />
            </label>
          </div>
        </article>
      </div>
    </>
  );
}

function formatModelContextTokens(tokens: number | undefined) {
  return typeof tokens === "number" && Number.isFinite(tokens) && tokens > 0 ? `${formatTokenCount(tokens)} ctx` : "Context n/a";
}

const CODEX_CONTEXT_WINDOW_OPTIONS: Array<{ detail: string; label: string; mode: SubscriptionCodexContextWindow }> = [
  { detail: "Use the default 262k Codex subscription budget.", label: "262k", mode: "standard" },
  { detail: "Allow the 1M Codex subscription budget for higher-cost long-context runs.", label: "1M", mode: "extended" },
];

function getSettingsAwareModelContextTokens(settings: ProviderSettings, option: ChatModelOption | undefined) {
  if (!option?.contextWindowTokens) {
    return option?.contextWindowTokens;
  }

  return getEffectiveProviderModelContextWindowTokens(
    option.provider,
    option.value,
    option.contextWindowTokens,
    settings.subscriptionOptimization,
  );
}

const formatPricingSummary = formatModelPricingSummary;
const formatPricingTitle = (pricing: Parameters<typeof formatModelPricingTitle>[0]) => formatModelPricingTitle(pricing, " - ");
