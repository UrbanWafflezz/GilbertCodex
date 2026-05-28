import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Coins,
  Database,
  Layers3,
  Lightbulb,
  RefreshCw,
  Route,
  ServerCog,
  TrendingUp,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ensureNineRouterLocal, getNineRouterLocalStatus } from "../../../app/tauriClient";
import { ConfirmDialog } from "../../../components/dialogs/AppDialog";
import {
  clearUsageHistory,
  loadUsageHistory,
} from "../../../lib/appStorage";
import { getDefaultBaseUrlForProvider, getModelProvider, NINE_ROUTER_ALWAYS_FREE_MODEL } from "../../../lib/models";
import {
  chooseNineRouterModel,
  joinLocalUrl,
  loadNineRouterModels,
  loadNineRouterUsageSnapshot,
  NINE_ROUTER_DASHBOARD_FALLBACK,
  NINE_ROUTER_PROVIDER_ID,
  patchNineRouterJson,
  type NineRouterUsageBucket,
  type NineRouterUsagePeriod,
  type NineRouterUsageRequest,
  type NineRouterUsageSnapshot,
  type NineRouterUsageStats,
} from "../../../services/nineRouterClient";
import {
  buildNineRouterFallbackModels,
  findNineRouterCombo,
  getNineRouterComboModels,
  getNineRouterOpenCodeFreeModels,
  hasUnusableNineRouterFallbackModels,
  isOpenCodeFreeModel,
  loadNineRouterCombos,
  NINE_ROUTER_ALWAYS_FREE_COMBO_NAME,
  NINE_ROUTER_OPEN_CODE_FREE_FALLBACK_MODELS,
  type NineRouterCombo,
  upsertNineRouterCombo,
} from "../../../services/nineRouterFallbackRouting";
import {
  getConfiguredNineRouterBaseUrl,
  getConfiguredNineRouterDashboardUrl,
  isConfiguredNineRouterCloudEnabled,
  isNineRouterCloudRequired,
  isNineRouterNativeBridgeUrl,
  normalizeNineRouterDashboardUrl,
} from "../../../services/nineRouterCloud";
import type { ModelProviderId, ProviderSettings, SubscriptionCodexContextWindow, SubscriptionFallbackMode, SubscriptionTokenSaverLevel } from "../../../types/settings";
import type { ProviderUsageRecord } from "../../../types/usage";
import { SettingsSectionHeading } from "../components/SettingsSectionHeading";
import type { SettingsStatusMessage } from "../types";

type UsagePeriod = "day" | "month" | "week";

interface UsageSettingsPageProps {
  onSettingsChange: (settings: ProviderSettings) => void;
  settings: ProviderSettings;
}

interface UsageAggregateRow {
  cachedInputTokens: number;
  costUsd: number;
  inputTokens: number;
  key: string;
  label: string;
  lastUsed?: string;
  outputTokens: number;
  provider?: string;
  requests: number;
  totalTokens: number;
}

interface UsageTimelineRow {
  costUsd: number;
  key: string;
  label: string;
  requests: number;
  totalTokens: number;
}

interface UsageTrendSummary {
  detail: string;
  tone: "down" | "flat" | "up";
  value: string;
}

interface UsageRecommendation {
  detail: string;
  title: string;
  tone?: "good" | "warning";
}

interface UsageQualityMetric {
  detail: string;
  label: string;
  tone?: "good" | "neutral" | "warning";
  value: string;
}

interface UsageWatchItem {
  detail: string;
  title: string;
  tone?: "good" | "warning";
}

interface UsageQualitySummary {
  metrics: UsageQualityMetric[];
  watchlist: UsageWatchItem[];
}

interface TokenSaverHelperState {
  message: string;
  rtkEnabled?: boolean;
  status: "idle" | "loading" | "ready" | "error";
}

interface NineRouterSettingsPayload {
  error?: { message?: string } | string;
  rtkEnabled?: boolean;
}

type UsageOptimizerBusyState = "fallback" | "refresh" | null;

const PERIODS: Array<{ id: UsagePeriod; label: string }> = [
  { id: "day", label: "Daily" },
  { id: "week", label: "Weekly" },
  { id: "month", label: "Monthly" },
];

const FALLBACK_MODE_OPTIONS: Array<{ detail: string; label: string; mode: SubscriptionFallbackMode }> = [
  { detail: "Choose models manually from the picker.", label: "Manual", mode: "off" },
  { detail: "Stay on docs-backed OpenCode Free routes when the local catalog has them.", label: "Free Auto", mode: "always-free" },
];
const TOKEN_SAVER_LEVEL_OPTIONS: Array<{ detail: string; label: string; level: SubscriptionTokenSaverLevel }> = [
  { detail: "RTK helper off. Gilbert keeps the normal tool-result budget.", label: "Off", level: "off" },
  { detail: "RTK on with the normal Gilbert tool-result budget.", label: "Low", level: "low" },
  { detail: "Trims large tool results earlier while keeping broad evidence.", label: "Medium", level: "medium" },
  { detail: "Keeps only tighter tool evidence for cheaper long tool runs.", label: "High", level: "high" },
  { detail: "Most aggressive compression for max token savings.", label: "Max", level: "max" },
];
const SUBSCRIPTION_OPTIMIZATION_DEFAULT: ProviderSettings["subscriptionOptimization"] = {
  codexContextWindow: "standard",
  fallbackMode: "off",
  tokenSaverLevel: "low",
};
const CODEX_CONTEXT_WINDOW_OPTIONS: Array<{ detail: string; label: string; mode: SubscriptionCodexContextWindow }> = [
  { detail: "Keep Codex subscription prompts inside the 262k cost-saving budget.", label: "262k", mode: "standard" },
  { detail: "Allow 1M context for higher-cost long repository or document runs.", label: "1M", mode: "extended" },
];

export function UsageSettingsPage({ onSettingsChange, settings }: UsageSettingsPageProps) {
  const [history, setHistory] = useState(() => loadUsageHistory());
  const [period, setPeriod] = useState<UsagePeriod>("day");
  const [providerFilter, setProviderFilter] = useState<ModelProviderId | "all">("all");
  const [nineRouterSnapshot, setNineRouterSnapshot] = useState<NineRouterUsageSnapshot | null>(null);
  const [status, setStatus] = useState<SettingsStatusMessage | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [optimizerBusy, setOptimizerBusy] = useState<UsageOptimizerBusyState>(null);
  const [optimizerModels, setOptimizerModels] = useState<string[]>([]);
  const [optimizerCombos, setOptimizerCombos] = useState<NineRouterCombo[]>([]);
  const [optimizerStatus, setOptimizerStatus] = useState<SettingsStatusMessage | null>(null);
  const [tokenSaverBusy, setTokenSaverBusy] = useState(false);
  const [tokenSaverStatus, setTokenSaverStatus] = useState<SettingsStatusMessage | null>(null);
  const [tokenSaverHelper, setTokenSaverHelper] = useState<TokenSaverHelperState>({
    message: "Waiting for local runtime",
    status: "idle",
  });

  useEffect(() => {
    refreshLocalHistory();
    void syncNineRouterUsage({ quiet: true });
    void refreshFallbackOptimizer({ quiet: true });
  }, []);

  const providerOptions = useMemo(() => {
    const providers = new Set<ModelProviderId>();
    history.records.forEach((record) => providers.add(record.provider));

    return [...providers].sort((left, right) => getModelProvider(left).label.localeCompare(getModelProvider(right).label));
  }, [history.records]);

  const filteredRecords = useMemo(
    () => history.records.filter((record) => providerFilter === "all" || record.provider === providerFilter),
    [history.records, providerFilter],
  );
  const summary = useMemo(() => summarizeUsageRecords(filteredRecords, period), [filteredRecords, period]);
  const maxTimelineTokens = Math.max(...summary.timeline.map((item) => item.totalTokens), 1);
  const maxProviderTokens = Math.max(...summary.byProvider.map((item) => item.totalTokens), 1);
  const nineRouterStats = nineRouterSnapshot?.stats;
  const nineRouterTotalTokens = (nineRouterStats?.totalPromptTokens ?? 0) + (nineRouterStats?.totalCompletionTokens ?? 0);
  const liveProviderRows = useMemo(() => toAggregateRows(nineRouterStats?.byProvider ?? {}), [nineRouterStats?.byProvider]);
  const liveModelRows = useMemo(() => toAggregateRows(nineRouterStats?.byModel ?? {}), [nineRouterStats?.byModel]);
  const liveTrendRows = useMemo(() => nineRouterSnapshot?.chart.slice(-8) ?? [], [nineRouterSnapshot]);
  const localTrend = useMemo(() => summarizeRecentTrend(filteredRecords), [filteredRecords]);
  const liveTrend = useMemo(() => summarizeLiveTrend(nineRouterSnapshot), [nineRouterSnapshot]);
  const topModel = summary.byModel[0] ?? liveModelRows[0];
  const topCostDriver = getTopCostDriver(summary.byProvider, liveProviderRows);
  const liveRequestsPerHour = countRecentLiveRequests(nineRouterStats?.recentRequests ?? []);
  const maxLiveChartTokens = Math.max(...liveTrendRows.map((item) => item.tokens ?? 0), 1);
  const recommendations = useMemo(
    () =>
      buildUsageRecommendations({
        liveModelRows,
        liveProviderRows,
        liveRequestsPerHour,
        liveStats: nineRouterStats,
        localRecords: filteredRecords.length,
        localTrend,
        summary,
        topCostDriver,
        topModel,
      }),
    [filteredRecords.length, liveModelRows, liveProviderRows, liveRequestsPerHour, localTrend, nineRouterStats, summary, topCostDriver, topModel],
  );
  const livePeriod = toNineRouterPeriod(period);
  const subscriptionOptimization = settings.subscriptionOptimization ?? SUBSCRIPTION_OPTIMIZATION_DEFAULT;
  const fallbackMode = subscriptionOptimization.fallbackMode;
  const effectiveFallbackMode: SubscriptionFallbackMode = fallbackMode === "smart-saver" ? "always-free" : fallbackMode;
  const tokenSaverLevel = subscriptionOptimization.tokenSaverLevel;
  const codexContextWindow = subscriptionOptimization.codexContextWindow;
  const tokenSaverEnabled = tokenSaverLevel !== "off";
  const configuredCloudSubscriptions = isConfiguredNineRouterCloudEnabled();
  const cloudSubscriptionsRequired = isNineRouterCloudRequired();
  const cloudSubscriptionsEnabled = configuredCloudSubscriptions || (!cloudSubscriptionsRequired && !isNineRouterNativeBridgeUrl(getNineRouterBaseUrl(settings)));
  const cloudSubscriptionsUnavailable = cloudSubscriptionsRequired && !configuredCloudSubscriptions;
  const tokenSaverDetail = TOKEN_SAVER_LEVEL_OPTIONS.find((option) => option.level === tokenSaverLevel)?.detail ?? TOKEN_SAVER_LEVEL_OPTIONS[1].detail;
  const tokenSaverHelperLabel = tokenSaverHelper.status === "ready" ? tokenSaverHelper.rtkEnabled === false ? "Off" : "On" : tokenSaverEnabled ? "On after setup" : "Off";
  const tokenSaverPill = tokenSaverBusy ? "Syncing" : tokenSaverEnabled ? "Saving" : "Manual";
  const savedSubscriptionModel = settings.providerModels[NINE_ROUTER_PROVIDER_ID]?.trim() || "";
  const selectedSubscriptionModel = useMemo(() => chooseNineRouterModel(savedSubscriptionModel, optimizerModels), [optimizerModels, savedSubscriptionModel]);
  const alwaysFreeModels = useMemo(
    () => buildNineRouterFallbackModels("always-free", selectedSubscriptionModel, optimizerModels),
    [optimizerModels, selectedSubscriptionModel],
  );
  const activeFallbackModels = effectiveFallbackMode === "always-free" ? alwaysFreeModels : [];
  const activeFallbackComboName = effectiveFallbackMode === "always-free" ? NINE_ROUTER_ALWAYS_FREE_COMBO_NAME : "";
  const activeFallbackCombo = activeFallbackComboName ? findNineRouterCombo(optimizerCombos, activeFallbackComboName) : null;
  const activeInstalledFallbackModels = useMemo(() => getNineRouterComboModels(activeFallbackCombo), [activeFallbackCombo]);
  const displayedFallbackModels = activeInstalledFallbackModels.length > 0 ? activeInstalledFallbackModels : activeFallbackModels;
  const activeFallbackModel = effectiveFallbackMode === "always-free" ? NINE_ROUTER_ALWAYS_FREE_MODEL : "";
  const activeFallbackLabel = effectiveFallbackMode === "always-free" ? "Free Auto" : "Manual";
  const liveOpenCodeFreeModels = useMemo(() => optimizerModels.filter(isOpenCodeFreeModel), [optimizerModels]);
  const openCodeFreeModels = useMemo(() => getNineRouterOpenCodeFreeModels(optimizerModels), [optimizerModels]);
  const optimizerReady = optimizerCombos.length > 0 || optimizerModels.length > 0;
  const usageQuality = useMemo(
    () =>
      summarizeUsageQuality({
        displayedFallbackModels,
        fallbackMode: effectiveFallbackMode,
        liveProviderRows,
        liveStats: nineRouterStats,
        records: filteredRecords,
        summary,
        tokenSaverLevel,
      }),
    [displayedFallbackModels, effectiveFallbackMode, filteredRecords, liveProviderRows, nineRouterStats, summary, tokenSaverLevel],
  );

  useEffect(() => {
    void syncTokenSaverToHelper(tokenSaverLevel, { quiet: true });
  }, [tokenSaverLevel]);

  function refreshLocalHistory() {
    setHistory(loadUsageHistory());
  }

  async function syncNineRouterUsage(options: { quiet?: boolean } = {}) {
    const dashboardUrl = getNineRouterDashboardUrl(settings);
    setSyncing(true);
    if (!options.quiet) {
      setStatus(null);
    }

    try {
      const snapshot = await loadNineRouterUsageSnapshot(dashboardUrl, livePeriod);
      setNineRouterSnapshot(snapshot);
      setStatus({ kind: "success", text: `Subscriptions usage synced for ${formatNineRouterPeriod(livePeriod)}.` });
    } catch (error) {
      if (!options.quiet) {
        setStatus({ kind: "warning", text: readErrorMessage(error, "Subscriptions usage is not available right now.") });
      }
    } finally {
      setSyncing(false);
    }
  }

  function handleClearUsageHistory() {
    clearUsageHistory();
    setClearConfirmOpen(false);
    refreshLocalHistory();
    setStatus({ kind: "success", text: "Local usage history cleared." });
  }

  async function refreshFallbackOptimizer(options: { quiet?: boolean } = {}) {
    if (!options.quiet) {
      setOptimizerBusy("refresh");
      setOptimizerStatus(null);
    }

    const dashboardUrl = getNineRouterDashboardUrl(settings);
    const baseUrl = getNineRouterBaseUrl(settings);

    try {
      const [models, combos] = await Promise.all([
        loadNineRouterModels(baseUrl),
        loadNineRouterCombos(dashboardUrl),
      ]);
      const repairedCombos = await repairActiveFallbackRouteIfNeeded(combos, models, dashboardUrl);
      setOptimizerModels(models);
      setOptimizerCombos(repairedCombos);

      if (!options.quiet) {
        setOptimizerStatus({ kind: "success", text: "Savings routing is up to date." });
      }
    } catch (error) {
      const message = formatSubscriptionHelperText(readErrorMessage(error, "Could not refresh savings routing."));
      setOptimizerStatus({ kind: options.quiet ? "warning" : "error", text: message });
      if (!options.quiet) {
        setOptimizerCombos([]);
      }
    } finally {
      if (!options.quiet) {
        setOptimizerBusy((current) => (current === "refresh" ? null : current));
      }
    }
  }

  async function repairActiveFallbackRouteIfNeeded(combos: NineRouterCombo[], liveModels: string[], dashboardUrl: string) {
    if (effectiveFallbackMode === "off") {
      return combos;
    }

    const comboName = NINE_ROUTER_ALWAYS_FREE_COMBO_NAME;
    const combo = findNineRouterCombo(combos, comboName);
    const installedModels = getNineRouterComboModels(combo);
    const selectedModel = chooseNineRouterModel(savedSubscriptionModel, liveModels);
    const needsRepair =
      !combo ||
      installedModels.length === 0 ||
      hasUnusableNineRouterFallbackModels(installedModels, liveModels) ||
      !installedModels.some(isOpenCodeFreeModel);

    if (!needsRepair) {
      return combos;
    }

    const models = buildNineRouterFallbackModels(effectiveFallbackMode, selectedModel, liveModels);
    if (models.length === 0) {
      return combos;
    }

    await upsertNineRouterCombo(dashboardUrl, comboName, models, "fallback");
    return loadNineRouterCombos(dashboardUrl);
  }

  async function activateFallbackMode(mode: SubscriptionFallbackMode) {
    const effectiveMode: SubscriptionFallbackMode = mode === "smart-saver" ? "always-free" : mode;
    updateSubscriptionOptimization({ fallbackMode: effectiveMode });

    if (effectiveMode === "off") {
      setOptimizerStatus({ kind: "success", text: "Savings routing is set to manual model selection." });
      return;
    }

    setOptimizerBusy("fallback");
    setOptimizerStatus(null);

    try {
      if (cloudSubscriptionsUnavailable) {
        setOptimizerStatus({ kind: "warning", text: `${formatFallbackModeLabel(effectiveMode)} is queued. Cloud subscription routing is required, but this build does not have a cloud router URL configured.` });
        return;
      }

      let baseUrl = getNineRouterBaseUrl(settings);
      let dashboardUrl = getNineRouterDashboardUrl(settings);
      if (!cloudSubscriptionsEnabled) {
        const localStatus = await getNineRouterLocalStatus().catch(() => null);
        if (localStatus && !localStatus.installed) {
          setOptimizerStatus({ kind: "warning", text: `${formatFallbackModeLabel(effectiveMode)} is queued. Open Subscriptions once to install account routing, then refresh Usage.` });
          return;
        }

        const readyStatus = localStatus?.running ? localStatus : await ensureNineRouterLocal();
        if (!readyStatus.running) {
          throw new Error(readyStatus.message || "Open Subscriptions before creating savings routes.");
        }

        baseUrl = settings.baseUrls[NINE_ROUTER_PROVIDER_ID]?.trim() || readyStatus.baseUrl || getDefaultBaseUrlForProvider(NINE_ROUTER_PROVIDER_ID);
        dashboardUrl = readyStatus.dashboardUrl || dashboardUrl;
      }
      const liveModels = await loadNineRouterModels(baseUrl);
      const selectedModel = chooseNineRouterModel(savedSubscriptionModel, liveModels);
      const models = buildNineRouterFallbackModels(effectiveMode, selectedModel, liveModels);
      if (models.length === 0) {
        throw new Error("No OpenCode Free routes were reported yet. Refresh the live catalog and try again.");
      }

      const comboName = NINE_ROUTER_ALWAYS_FREE_COMBO_NAME;
      await upsertNineRouterCombo(dashboardUrl, comboName, models, "fallback");
      const combos = await loadNineRouterCombos(dashboardUrl);
      setOptimizerModels(liveModels);
      setOptimizerCombos(combos);
      useSubscriptionProvider(NINE_ROUTER_ALWAYS_FREE_MODEL, effectiveMode);
      setOptimizerStatus({ kind: "success", text: `${formatFallbackModeLabel(effectiveMode)} is active with ${models.length} fallback ${models.length === 1 ? "route" : "routes"}.` });
    } catch (error) {
      const message = formatSubscriptionHelperText(readErrorMessage(error, "Could not create savings route."));
      setOptimizerStatus({ kind: "error", text: message });
      updateSubscriptionOptimization({ fallbackMode: settings.subscriptionOptimization?.fallbackMode ?? "off" });
    } finally {
      setOptimizerBusy((current) => (current === "fallback" ? null : current));
    }
  }

  function updateSubscriptionOptimization(partial: Partial<ProviderSettings["subscriptionOptimization"]>) {
    const current: ProviderSettings["subscriptionOptimization"] = settings.subscriptionOptimization ?? SUBSCRIPTION_OPTIMIZATION_DEFAULT;
    onSettingsChange({
      ...settings,
      subscriptionOptimization: {
        ...current,
        ...partial,
      },
    });
  }

  async function setTokenSaverLevel(level: SubscriptionTokenSaverLevel) {
    updateSubscriptionOptimization({ tokenSaverLevel: level });
    await syncTokenSaverToHelper(level);
  }

  async function syncTokenSaverToHelper(level: SubscriptionTokenSaverLevel, options: { quiet?: boolean } = {}) {
    if (!options.quiet) {
      setTokenSaverBusy(true);
      setTokenSaverStatus(null);
    }

    try {
      if (cloudSubscriptionsUnavailable) {
        setTokenSaverHelper({
          message: level === "off" ? "Off" : "On after cloud setup",
          rtkEnabled: level !== "off",
          status: "idle",
        });
        if (!options.quiet) {
          setTokenSaverStatus({
            kind: level === "off" ? "success" : "warning",
            text: level === "off" ? "Token saver is off." : "Token saver is queued until cloud subscription routing is configured.",
          });
        }
        return;
      }

      const localStatus = cloudSubscriptionsEnabled ? null : await getNineRouterLocalStatus().catch(() => null);
      if (!cloudSubscriptionsEnabled && !localStatus?.running) {
        setTokenSaverHelper({
          message: level === "off" ? "Off" : "On after setup",
          rtkEnabled: level !== "off",
          status: "idle",
        });
        if (!options.quiet) {
          setTokenSaverStatus({
            kind: level === "off" ? "success" : "warning",
            text: level === "off" ? "Token saver is off." : "Token saver is queued and will sync after subscription routing starts.",
          });
        }
        return;
      }

      setTokenSaverHelper((current) => ({
        ...current,
        message: "Syncing",
        status: "loading",
      }));
      const dashboardUrl = cloudSubscriptionsEnabled ? getNineRouterDashboardUrl(settings) : localStatus?.dashboardUrl || getNineRouterDashboardUrl(settings);
      const payload = await patchNineRouterJson<NineRouterSettingsPayload>(joinLocalUrl(dashboardUrl, "/api/settings"), {
        rtkEnabled: level !== "off",
      });
      const rtkEnabled = payload.rtkEnabled ?? level !== "off";
      setTokenSaverHelper({
        message: `RTK ${rtkEnabled ? "enabled" : "disabled"}`,
        rtkEnabled,
        status: "ready",
      });

      if (!options.quiet) {
        setTokenSaverStatus({
          kind: "success",
          text: level === "off" ? "Token saver is off." : `Token saver is set to ${formatTokenSaverLevel(level)}.`,
        });
      }
    } catch (error) {
      const message = formatSubscriptionHelperText(readErrorMessage(error, "Could not sync Token saver."));
      setTokenSaverHelper({
        message,
        status: "error",
      });
      if (!options.quiet) {
        setTokenSaverStatus({ kind: "error", text: message });
      }
    } finally {
      if (!options.quiet) {
        setTokenSaverBusy(false);
      }
    }
  }

  function useSubscriptionProvider(modelOverride: string, mode: SubscriptionFallbackMode) {
    const currentOptimization: ProviderSettings["subscriptionOptimization"] = settings.subscriptionOptimization ?? SUBSCRIPTION_OPTIMIZATION_DEFAULT;
    onSettingsChange({
      ...settings,
      baseUrls: {
        ...settings.baseUrls,
        [NINE_ROUTER_PROVIDER_ID]: getDefaultBaseUrlForProvider(NINE_ROUTER_PROVIDER_ID),
      },
      model: modelOverride,
      provider: NINE_ROUTER_PROVIDER_ID,
      providerModels: {
        ...settings.providerModels,
        [settings.provider]: settings.model,
        [NINE_ROUTER_PROVIDER_ID]: modelOverride,
      },
      subscriptionOptimization: {
        ...currentOptimization,
        fallbackMode: mode,
      },
    });
  }

  return (
    <>
      <SettingsSectionHeading detail="Daily, weekly, and monthly token, request, and cost history across provider routes." icon={BarChart3} title="Usage & Costs" />
      <div className="settings-section-grid usage-settings-grid">
        {status ? (
          <div className="settings-status-banner settings-card-wide" data-kind={status.kind}>
            {status.text}
          </div>
        ) : null}

        <nav className="usage-page-nav settings-card-wide" aria-label="Usage sections">
          <a href="#usage-overview">Overview</a>
          <a href="#usage-optimize">Optimize</a>
          <a href="#usage-risk">Risk</a>
          <a href="#usage-history">History</a>
          <a href="#usage-live">Live</a>
          <a href="#usage-local-controls">Controls</a>
        </nav>

        <article className="settings-card settings-card-wide usage-hero-card" id="usage-overview">
          <div className="settings-card-heading">
            <Activity size={19} aria-hidden="true" />
            <div>
              <h2>Provider usage</h2>
              <p>{formatNumber(history.records.length)} saved request{history.records.length === 1 ? "" : "s"} in local history.</p>
            </div>
          </div>
          <div className="usage-controls">
            <div className="usage-segmented" role="tablist" aria-label="Usage period">
              {PERIODS.map((item) => (
                <button
                  aria-selected={period === item.id}
                  className="icon-button"
                  data-active={period === item.id}
                  key={item.id}
                  type="button"
                  onClick={() => setPeriod(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <label className="usage-provider-filter">
              <span>Provider</span>
              <select value={providerFilter} onChange={(event) => setProviderFilter(event.target.value as ModelProviderId | "all")}>
                <option value="all">All providers</option>
                {providerOptions.map((provider) => (
                  <option key={provider} value={provider}>
                    {getModelProvider(provider).label}
                  </option>
                ))}
              </select>
            </label>
            <button className="icon-button" type="button" disabled={syncing} onClick={() => syncNineRouterUsage()}>
              <RefreshCw size={16} aria-hidden="true" />
              {syncing ? "Syncing" : "Sync"}
            </button>
          </div>
          <div className="usage-metric-grid">
            <UsageMetric icon={Route} label="Requests" value={formatNumber(summary.totals.requests)} detail={`${formatNumber(summary.totals.providerCount)} provider${summary.totals.providerCount === 1 ? "" : "s"}`} />
            <UsageMetric icon={Layers3} label="Tokens" value={formatCompactTokens(summary.totals.totalTokens)} detail={formatTokenDetail(summary.totals.inputTokens, summary.totals.outputTokens, summary.totals.cachedInputTokens)} />
            <UsageMetric icon={Coins} label="Estimated cost" value={formatUsd(summary.totals.costUsd)} detail={formatCostDetail(summary.totals.catalogCostRecords, summary.totals.unknownCostRecords, summary.totals.cacheSavingsUsd)} />
            <UsageMetric icon={Database} label="Database" value="Firebase" detail="Firestore-backed cloud usage and billing counters" />
          </div>
        </article>

        <article className="settings-card settings-card-wide usage-insights-card">
          <div className="settings-card-heading">
            <Lightbulb size={19} aria-hidden="true" />
            <div>
              <h2>Insights & recommendations</h2>
              <p>Live trend, busiest model, cost drivers, and routing ideas from local history plus Subscriptions telemetry.</p>
            </div>
          </div>
          <div className="usage-insight-grid">
            <UsageInsightCard icon={TrendingUp} label="Local trend" value={localTrend.value} detail={localTrend.detail} tone={localTrend.tone} />
            <UsageInsightCard icon={Activity} label="Real-time pace" value={`${formatNumber(liveRequestsPerHour)}/hr`} detail={liveTrend.detail} tone={liveTrend.tone} />
            <UsageInsightCard
              icon={Layers3}
              label="Most used model"
              value={topModel?.label ?? "Waiting"}
              detail={topModel ? `${formatCompactTokens(topModel.totalTokens)} tokens across ${formatNumber(topModel.requests)} request${topModel.requests === 1 ? "" : "s"}` : "Sync or send requests to rank models."}
            />
            <UsageInsightCard
              icon={Coins}
              label="Cost driver"
              value={topCostDriver?.label ?? "No spend yet"}
              detail={topCostDriver ? `${formatUsd(topCostDriver.costUsd)} on ${formatCompactTokens(topCostDriver.totalTokens)} tokens` : "Free or unpriced routes are leading this view."}
            />
          </div>
          <div className="usage-recommendation-list">
            {recommendations.map((item) => (
              <div className="usage-recommendation" data-tone={item.tone ?? "neutral"} key={item.title}>
                {item.tone === "warning" ? <AlertTriangle size={16} aria-hidden="true" /> : <Lightbulb size={16} aria-hidden="true" />}
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.detail}</span>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="settings-card usage-token-saver-card" id="usage-optimize">
          <div className="settings-card-heading">
            <ServerCog size={19} aria-hidden="true" />
            <div>
              <h2>Token saver</h2>
              <p>RTK helper compression plus Gilbert's local tool-result budget for long tool runs.</p>
            </div>
          </div>
          {tokenSaverStatus ? (
            <div className="settings-status-banner usage-routing-status" data-kind={tokenSaverStatus.kind}>
              {tokenSaverStatus.text}
            </div>
          ) : null}
          <div className="usage-token-saver-summary">
            <div>
              <span>RTK helper</span>
              <strong>{tokenSaverHelperLabel}</strong>
              <em>{tokenSaverHelper.status === "error" ? formatSubscriptionHelperText(tokenSaverHelper.message) : tokenSaverEnabled ? "Local helper" : "No compression"}</em>
            </div>
            <div>
              <span>Level</span>
              <strong>{formatTokenSaverLevel(tokenSaverLevel)}</strong>
              <em>{tokenSaverPill}</em>
            </div>
          </div>
          <div className="usage-token-saver-row">
            <span>RTK helper</span>
            <button
              className="settings-switch"
              type="button"
              role="switch"
              aria-checked={tokenSaverEnabled}
              data-on={tokenSaverEnabled}
              disabled={tokenSaverBusy}
              onClick={() => void setTokenSaverLevel(tokenSaverEnabled ? "off" : "low")}
            >
              <span />
            </button>
          </div>
          <div className="settings-segmented-control settings-segmented-control-compact usage-token-saver-levels" aria-label="Token saver level">
            {TOKEN_SAVER_LEVEL_OPTIONS.map((option) => (
              <button
                type="button"
                key={option.level}
                data-selected={tokenSaverLevel === option.level}
                aria-pressed={tokenSaverLevel === option.level}
                disabled={tokenSaverBusy}
                title={option.detail}
                onClick={() => void setTokenSaverLevel(option.level)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <span className="settings-status">{tokenSaverDetail}</span>
        </article>

        <article className="settings-card usage-token-saver-card">
          <div className="settings-card-heading">
            <Layers3 size={19} aria-hidden="true" />
            <div>
              <h2>Codex context</h2>
              <p>Default limit for OpenAI Codex subscription routes before compaction and tool-result budgeting.</p>
            </div>
          </div>
          <div className="usage-token-saver-summary">
            <div>
              <span>Window</span>
              <strong>{codexContextWindow === "extended" ? "1M" : "262k"}</strong>
              <em>{codexContextWindow === "extended" ? "Higher cost" : "Cost saver"}</em>
            </div>
            <div>
              <span>Applies to</span>
              <strong>cx/*</strong>
              <em>Codex subscription</em>
            </div>
          </div>
          <div className="settings-segmented-control settings-segmented-control-compact usage-token-saver-levels" aria-label="Codex subscription context window">
            {CODEX_CONTEXT_WINDOW_OPTIONS.map((option) => (
              <button
                type="button"
                key={option.mode}
                data-selected={codexContextWindow === option.mode}
                aria-pressed={codexContextWindow === option.mode}
                title={option.detail}
                onClick={() => updateSubscriptionOptimization({ codexContextWindow: option.mode })}
              >
                {option.label}
              </button>
            ))}
          </div>
          <span className="settings-status">{CODEX_CONTEXT_WINDOW_OPTIONS.find((option) => option.mode === codexContextWindow)?.detail}</span>
        </article>

        <article className="settings-card usage-routing-card">
          <div className="settings-card-heading">
            <Route size={19} aria-hidden="true" />
            <div>
              <h2>Savings routing</h2>
              <p>Choose manual, subscription-first, or free-only routing from the same place as spend and usage.</p>
            </div>
          </div>
          {optimizerStatus ? (
            <div className="settings-status-banner usage-routing-status" data-kind={optimizerStatus.kind}>
              {optimizerStatus.text}
            </div>
          ) : null}
          <div className="usage-routing-content">
            <div className="settings-segmented-control settings-segmented-control-compact usage-routing-modes" aria-label="Fallback routing mode">
              {FALLBACK_MODE_OPTIONS.map((option) => (
                <button
                  type="button"
                  key={option.mode}
                  data-selected={effectiveFallbackMode === option.mode}
                  aria-pressed={effectiveFallbackMode === option.mode}
                  disabled={optimizerBusy !== null}
                  title={option.detail}
                  onClick={() => void activateFallbackMode(option.mode)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="usage-routing-summary">
              <div>
                <span>Mode</span>
                <strong>{activeFallbackLabel}</strong>
                <em>{effectiveFallbackMode === "off" ? "Manual picker" : activeFallbackCombo ? "Ready" : "Queued"}</em>
              </div>
              <div>
                <span>Free routes</span>
                <strong>{liveOpenCodeFreeModels.length > 0 ? `${liveOpenCodeFreeModels.length} live` : `${openCodeFreeModels.length || NINE_ROUTER_OPEN_CODE_FREE_FALLBACK_MODELS.length} default`}</strong>
                <em>{liveOpenCodeFreeModels.length > 0 ? "Reported now" : "No-auth fallback"}</em>
              </div>
              <div>
                <span>Route set</span>
                <strong>{activeFallbackCombo ? `${activeFallbackCombo.name ?? activeFallbackCombo.id} ready` : effectiveFallbackMode === "off" ? "None" : "Needs refresh"}</strong>
                <em>{optimizerReady ? "Catalog loaded" : "Catalog waiting"}</em>
              </div>
            </div>
          </div>
          <div className="usage-route-strip" aria-label={`${activeFallbackLabel} route order`}>
            {displayedFallbackModels.length > 0 ? displayedFallbackModels.slice(0, 6).map((model, index) => (
              <span className="settings-route-chip" key={`${model}-${index}`}>{index + 1}. {model}</span>
            )) : <span className="usage-route-empty">Pick Free Auto to build a route.</span>}
          </div>
          <div className="usage-routing-actions">
            {effectiveFallbackMode !== "off" && activeFallbackModel ? (
              <button className="settings-primary-button" type="button" disabled={optimizerBusy !== null} onClick={() => void activateFallbackMode(effectiveFallbackMode)}>
                <CheckCircle2 size={16} aria-hidden="true" />
                {optimizerBusy === "fallback" ? "Building" : `Use ${activeFallbackLabel}`}
              </button>
            ) : null}
            <button className="settings-ghost-button" type="button" disabled={optimizerBusy !== null} onClick={() => refreshFallbackOptimizer()}>
              <RefreshCw size={16} aria-hidden="true" />
              {optimizerBusy === "refresh" ? "Refreshing" : "Refresh"}
            </button>
          </div>
        </article>

        <article className="settings-card settings-card-wide usage-quality-card" id="usage-risk">
          <div className="settings-card-heading">
            <AlertTriangle size={19} aria-hidden="true" />
            <div>
              <h2>Coverage & risk</h2>
              <p>Edge-case checks for estimates, unpriced records, token spikes, model concentration, and local history gaps.</p>
            </div>
          </div>
          <div className="usage-quality-grid">
            {usageQuality.metrics.map((metric) => (
              <div className="usage-quality-metric" data-tone={metric.tone ?? "neutral"} key={metric.label}>
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
                <em>{metric.detail}</em>
              </div>
            ))}
          </div>
          <div className="usage-watch-list">
            {usageQuality.watchlist.map((item) => (
              <div className="usage-watch-item" data-tone={item.tone ?? "neutral"} key={item.title}>
                {item.tone === "warning" ? <AlertTriangle size={15} aria-hidden="true" /> : <CheckCircle2 size={15} aria-hidden="true" />}
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.detail}</span>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="settings-card settings-card-wide" id="usage-history">
          <div className="settings-card-heading">
            <BarChart3 size={19} aria-hidden="true" />
            <div>
              <h2>{PERIODS.find((item) => item.id === period)?.label} history</h2>
              <p>{summary.timeline.length > 0 ? `${summary.timeline.length} tracked period${summary.timeline.length === 1 ? "" : "s"}` : "No tracked requests for this filter."}</p>
            </div>
          </div>
          <div className="usage-timeline">
            {summary.timeline.length > 0 ? (
              summary.timeline.map((item) => (
                <div className="usage-timeline-row" key={item.key}>
                  <div>
                    <strong>{item.label}</strong>
                    <span>{formatNumber(item.requests)} request{item.requests === 1 ? "" : "s"}</span>
                  </div>
                  <div className="usage-bar" aria-hidden="true">
                    <span style={{ width: `${Math.max(3, (item.totalTokens / maxTimelineTokens) * 100)}%` }} />
                  </div>
                  <div>
                    <strong>{formatCompactTokens(item.totalTokens)}</strong>
                    <span>{formatUsd(item.costUsd)}</span>
                  </div>
                </div>
              ))
            ) : (
              <div className="database-empty-state">No local usage has been recorded yet.</div>
            )}
          </div>
        </article>

        <article className="settings-card">
          <div className="settings-card-heading">
            <Route size={19} aria-hidden="true" />
            <div>
              <h2>Providers</h2>
              <p>Separate totals for each provider route.</p>
            </div>
          </div>
          <div className="usage-breakdown-list">
            {summary.byProvider.length > 0 ? summary.byProvider.map((item) => (
              <UsageBreakdownRow item={item} maxTokens={maxProviderTokens} key={item.key} />
            )) : <div className="database-empty-state">No provider totals yet.</div>}
          </div>
        </article>

        <article className="settings-card">
          <div className="settings-card-heading">
            <Layers3 size={19} aria-hidden="true" />
            <div>
              <h2>Models</h2>
              <p>Top model usage for this view.</p>
            </div>
          </div>
          <div className="usage-model-list">
            {summary.byModel.length > 0 ? summary.byModel.slice(0, 8).map((item) => (
              <div className="usage-model-row" key={item.key}>
                <div>
                  <strong>{item.label}</strong>
                  <span>{item.provider || "Provider"} - {formatRelativeTime(item.lastUsed)}</span>
                </div>
                <div>
                  <strong>{formatCompactTokens(item.totalTokens)}</strong>
                  <span>{formatUsd(item.costUsd)}</span>
                </div>
              </div>
            )) : <div className="database-empty-state">No model totals yet.</div>}
          </div>
        </article>

        <article className="settings-card settings-card-wide">
          <div className="settings-card-heading">
            <Activity size={19} aria-hidden="true" />
            <div>
              <h2>Recent requests</h2>
              <p>Latest provider-visible token records saved by Gilbert.</p>
            </div>
          </div>
          <div className="usage-request-table">
            <div className="usage-request-row usage-request-head">
              <span>Time</span>
              <span>Provider</span>
              <span>Model</span>
              <span>Tokens</span>
              <span>Cost</span>
              <span>Source</span>
            </div>
            {summary.recent.length > 0 ? summary.recent.slice(0, 12).map((record) => (
              <div className="usage-request-row" key={record.id}>
                <span>{formatTimestamp(record.createdAt)}</span>
                <span>{record.providerLabel}</span>
                <span>{record.model}</span>
                <span>{formatCompactTokens(record.totalTokens)}</span>
                <span>{formatUsd(record.totalCostUsd)}</span>
                <span>{formatSource(record)}</span>
              </div>
            )) : <div className="database-empty-state">No requests saved yet.</div>}
          </div>
        </article>

        <article className="settings-card settings-card-wide usage-live-card" id="usage-live">
          <div className="settings-card-heading">
            <Route size={19} aria-hidden="true" />
            <div>
              <h2>Subscriptions live usage</h2>
              <p>{nineRouterSnapshot ? "Live subscription totals are synced for this view." : "Waiting for live subscription totals."}</p>
            </div>
          </div>
          <div className="usage-metric-grid">
            <UsageMetric icon={Route} label="Subscription requests" value={formatNumber(nineRouterStats?.totalRequests ?? 0)} detail={formatNineRouterPeriod(livePeriod)} />
            <UsageMetric icon={Layers3} label="Subscription tokens" value={formatCompactTokens(nineRouterTotalTokens)} detail={`${formatCompactTokens(nineRouterStats?.totalPromptTokens ?? 0)} in / ${formatCompactTokens(nineRouterStats?.totalCompletionTokens ?? 0)} out`} />
            <UsageMetric icon={Coins} label="Estimated subscription cost" value={formatUsd(nineRouterStats?.totalCost ?? 0)} detail="Routing estimate, not a bill" />
            <UsageMetric icon={Activity} label="Active" value={formatNumber(nineRouterStats?.activeRequests?.length ?? 0)} detail={nineRouterStats?.errorProvider ? `Recent error: ${nineRouterStats.errorProvider}` : "No live errors"} />
          </div>
          <div className="usage-cost-disclaimer">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>Subscriptions cost is a routing estimate for comparison only. It is not the user's real provider bill; provider dashboards remain the source of truth for actual charges.</span>
          </div>
          <div className="usage-live-grid">
            <div className="usage-live-panel">
              <div className="usage-panel-heading">
                <strong>Provider mix</strong>
                <span>{formatNumber(liveProviderRows.length)} live route{liveProviderRows.length === 1 ? "" : "s"}</span>
              </div>
              <div className="usage-breakdown-list">
                {liveProviderRows.slice(0, 6).map((item) => (
                  <UsageBreakdownRow item={item} maxTokens={Math.max(nineRouterTotalTokens, 1)} key={item.key} />
                ))}
                {!nineRouterStats || liveProviderRows.length === 0 ? <div className="database-empty-state">No live Subscriptions totals yet.</div> : null}
              </div>
            </div>
            <div className="usage-live-panel">
              <div className="usage-panel-heading">
                <strong>Top live models</strong>
                <span>{topModel ? `${formatCompactTokens(topModel.totalTokens)} leader` : "Waiting for data"}</span>
              </div>
              <div className="usage-model-list">
                {liveModelRows.slice(0, 6).map((item) => (
                  <div className="usage-model-row" key={item.key}>
                    <div>
                      <strong>{item.label}</strong>
                      <span>{item.provider || "Subscriptions"} - {formatRelativeTime(item.lastUsed)}</span>
                    </div>
                    <div>
                      <strong>{formatCompactTokens(item.totalTokens)}</strong>
                      <span>{formatNumber(item.requests)} request{item.requests === 1 ? "" : "s"}</span>
                    </div>
                  </div>
                ))}
                {nineRouterStats && liveModelRows.length === 0 ? <div className="database-empty-state">No live model totals yet.</div> : null}
              </div>
            </div>
            <div className="usage-live-panel">
              <div className="usage-panel-heading">
                <strong>Real-time trend</strong>
                <span>{liveTrend.value}</span>
              </div>
              {liveTrendRows.length > 0 ? (
                <div className="usage-mini-chart" aria-label="Subscriptions token trend">
                  {liveTrendRows.map((item, index) => (
                    <div className="usage-mini-bar" key={`${item.label ?? "bucket"}-${index}`}>
                      <div className="usage-mini-bar-track" title={`${item.label ?? "Bucket"}: ${formatCompactTokens(item.tokens ?? 0)} tokens, ${formatUsd(item.cost ?? 0)}`}>
                        <span style={{ height: `${Math.max(6, ((item.tokens ?? 0) / maxLiveChartTokens) * 100)}%` }} />
                      </div>
                      <em>{item.label ?? `${index + 1}`}</em>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="database-empty-state">No live trend buckets yet.</div>
              )}
            </div>
            <div className="usage-live-panel">
              <div className="usage-panel-heading">
                <strong>Recent live requests</strong>
                <span>{formatNumber(nineRouterStats?.recentRequests?.length ?? 0)} captured</span>
              </div>
              <div className="usage-model-list">
                {(nineRouterStats?.recentRequests ?? []).slice(0, 6).map((request, index) => (
                  <div className="usage-model-row" key={`${request.timestamp ?? index}-${request.model ?? "model"}`}>
                    <div>
                      <strong>{request.model || "Unknown model"}</strong>
                      <span>{request.provider || "Subscriptions"} - {request.status || "ok"}</span>
                    </div>
                    <div>
                      <strong>{formatCompactTokens((request.promptTokens ?? 0) + (request.completionTokens ?? 0))}</strong>
                      <span>{formatTimestamp(request.timestamp)}</span>
                    </div>
                  </div>
                ))}
                {nineRouterStats && (nineRouterStats.recentRequests ?? []).length === 0 ? <div className="database-empty-state">No recent Subscriptions requests.</div> : null}
              </div>
            </div>
          </div>
        </article>

        <article className="settings-card settings-card-wide settings-danger-card" id="usage-local-controls">
          <div className="settings-card-heading">
            <Trash2 size={19} aria-hidden="true" />
            <div>
              <h2>Local history controls</h2>
              <p>Clears Gilbert's local usage rollup without touching provider accounts.</p>
            </div>
          </div>
          <button className="settings-danger-button usage-clear-button" type="button" onClick={() => setClearConfirmOpen(true)} disabled={history.records.length === 0}>
            <Trash2 size={16} aria-hidden="true" />
            Clear usage history
          </button>
        </article>
      </div>

      <ConfirmDialog
        confirmLabel="Clear history"
        description="This removes Gilbert's saved local token and cost records from this device. Provider account history is not changed."
        icon={Trash2}
        open={clearConfirmOpen}
        title="Clear usage history?"
        tone="danger"
        onClose={() => setClearConfirmOpen(false)}
        onConfirm={handleClearUsageHistory}
      />
    </>
  );
}

function summarizeUsageRecords(records: ProviderUsageRecord[], period: UsagePeriod) {
  const timelineMap = new Map<string, UsageTimelineRow>();
  const providerMap = new Map<string, UsageAggregateRow>();
  const modelMap = new Map<string, UsageAggregateRow>();
  let catalogCostRecords = 0;
  let unknownCostRecords = 0;
  const providerIds = new Set<ModelProviderId>();
  const totals = {
    cachedInputTokens: 0,
    cacheSavingsUsd: 0,
    catalogCostRecords: 0,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    providerCount: 0,
    requests: 0,
    totalTokens: 0,
    unknownCostRecords: 0,
  };

  for (const record of records) {
    const periodKey = getPeriodKey(record, period);
    const periodLabel = formatPeriodLabel(periodKey, period);
    const providerLabel = record.providerLabel || getModelProvider(record.provider).label;
    const modelKey = `${record.provider}:${record.model}`;
    const costKnown = record.costSource === "catalog" || record.costSource === "free";

    totals.requests += record.requestCount;
    totals.inputTokens += record.inputTokens;
    totals.cachedInputTokens += record.cachedInputTokens ?? 0;
    totals.cacheSavingsUsd += record.cacheSavingsUsd ?? 0;
    totals.outputTokens += record.outputTokens;
    totals.totalTokens += record.totalTokens;
    totals.costUsd += record.totalCostUsd;
    providerIds.add(record.provider);

    if (costKnown) {
      catalogCostRecords += 1;
    } else {
      unknownCostRecords += 1;
    }

    addTimelineRow(timelineMap, periodKey, periodLabel, record);
    addAggregateRow(providerMap, record.provider, providerLabel, record);
    addAggregateRow(modelMap, modelKey, record.model, record, providerLabel);
  }

  totals.catalogCostRecords = catalogCostRecords;
  totals.unknownCostRecords = unknownCostRecords;
  totals.providerCount = providerIds.size;

  return {
    byModel: sortAggregateRows([...modelMap.values()]),
    byProvider: sortAggregateRows([...providerMap.values()]),
    recent: records.slice().sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()),
    timeline: [...timelineMap.values()].sort((left, right) => left.key.localeCompare(right.key)),
    totals,
  };
}

function addTimelineRow(target: Map<string, UsageTimelineRow>, key: string, label: string, record: ProviderUsageRecord) {
  const current = target.get(key) ?? {
    costUsd: 0,
    key,
    label,
    requests: 0,
    totalTokens: 0,
  };

  current.costUsd += record.totalCostUsd;
  current.requests += record.requestCount;
  current.totalTokens += record.totalTokens;
  target.set(key, current);
}

function addAggregateRow(target: Map<string, UsageAggregateRow>, key: string, label: string, record: ProviderUsageRecord, provider?: string) {
  const current = target.get(key) ?? {
    cachedInputTokens: 0,
    costUsd: 0,
    inputTokens: 0,
    key,
    label,
    outputTokens: 0,
    provider,
    requests: 0,
    totalTokens: 0,
  };

  current.costUsd += record.totalCostUsd;
  current.cachedInputTokens += record.cachedInputTokens ?? 0;
  current.inputTokens += record.inputTokens;
  current.outputTokens += record.outputTokens;
  current.requests += record.requestCount;
  current.totalTokens += record.totalTokens;
  current.lastUsed = !current.lastUsed || new Date(record.createdAt) > new Date(current.lastUsed) ? record.createdAt : current.lastUsed;
  target.set(key, current);
}

function sortAggregateRows(rows: UsageAggregateRow[]) {
  return rows.sort((left, right) => right.totalTokens - left.totalTokens || right.requests - left.requests || left.label.localeCompare(right.label));
}

function toAggregateRows(buckets: Record<string, NineRouterUsageBucket>): UsageAggregateRow[] {
  return Object.entries(buckets)
    .map(([key, value]) => {
      const inputTokens = value.promptTokens ?? 0;
      const outputTokens = value.completionTokens ?? 0;

      return {
        costUsd: value.cost ?? 0,
        cachedInputTokens: 0,
        inputTokens,
        key,
        label: value.rawModel || key,
        lastUsed: value.lastUsed,
        outputTokens,
        provider: value.provider,
        requests: value.requests ?? 0,
        totalTokens: inputTokens + outputTokens,
      };
    })
    .sort((left, right) => right.totalTokens - left.totalTokens);
}

function summarizeRecentTrend(records: ProviderUsageRecord[]): UsageTrendSummary {
  const now = Date.now();
  const currentStart = now - 24 * 60 * 60 * 1000;
  const previousStart = now - 48 * 60 * 60 * 1000;
  let currentTokens = 0;
  let currentRequests = 0;
  let previousTokens = 0;

  records.forEach((record) => {
    const timestamp = new Date(record.createdAt).getTime();
    if (!Number.isFinite(timestamp)) {
      return;
    }

    if (timestamp >= currentStart) {
      currentTokens += record.totalTokens;
      currentRequests += record.requestCount;
    } else if (timestamp >= previousStart && timestamp < currentStart) {
      previousTokens += record.totalTokens;
    }
  });

  if (currentTokens === 0 && previousTokens === 0) {
    return {
      detail: "Local history needs two 24-hour windows for a real trend.",
      tone: "flat",
      value: "No trend",
    };
  }

  if (previousTokens === 0) {
    return {
      detail: `${formatCompactTokens(currentTokens)} tokens from ${formatNumber(currentRequests)} request${currentRequests === 1 ? "" : "s"} in the last 24h.`,
      tone: "up",
      value: "New activity",
    };
  }

  const delta = (currentTokens - previousTokens) / previousTokens;
  return {
    detail: `${formatCompactTokens(currentTokens)} tokens now vs ${formatCompactTokens(previousTokens)} in the prior 24h.`,
    tone: delta > 0.1 ? "up" : delta < -0.1 ? "down" : "flat",
    value: formatSignedPercent(delta),
  };
}

function summarizeLiveTrend(snapshot: NineRouterUsageSnapshot | null): UsageTrendSummary {
  const chartRows = snapshot?.chart.filter((item) => (item.tokens ?? 0) > 0 || (item.cost ?? 0) > 0) ?? [];
  if (chartRows.length < 2) {
    const liveRequests = snapshot?.stats.totalRequests ?? 0;
    return {
      detail: liveRequests > 0 ? `${formatNumber(liveRequests)} synced request${liveRequests === 1 ? "" : "s"}; chart buckets are still warming up.` : "No active Subscriptions traffic in the current window.",
      tone: "flat",
      value: liveRequests > 0 ? "Live" : "Idle",
    };
  }

  const current = chartRows[chartRows.length - 1]?.tokens ?? 0;
  const previous = chartRows[chartRows.length - 2]?.tokens ?? 0;
  if (previous === 0) {
    return {
      detail: `${formatCompactTokens(current)} tokens in the latest live bucket.`,
      tone: current > 0 ? "up" : "flat",
      value: current > 0 ? "New spike" : "Flat",
    };
  }

  const delta = (current - previous) / previous;
  return {
    detail: `${formatCompactTokens(current)} tokens in the latest bucket vs ${formatCompactTokens(previous)} before it.`,
    tone: delta > 0.1 ? "up" : delta < -0.1 ? "down" : "flat",
    value: formatSignedPercent(delta),
  };
}

function countRecentLiveRequests(requests: NineRouterUsageRequest[]) {
  const cutoff = Date.now() - 60 * 60 * 1000;
  return requests.filter((request) => {
    const timestamp = new Date(request.timestamp ?? "").getTime();
    return Number.isFinite(timestamp) && timestamp >= cutoff;
  }).length;
}

function getTopCostDriver(localRows: UsageAggregateRow[], liveRows: UsageAggregateRow[]) {
  const rows = [...localRows, ...liveRows].filter((item) => item.totalTokens > 0 || item.costUsd > 0);
  return rows.sort((left, right) => right.costUsd - left.costUsd || right.totalTokens - left.totalTokens)[0];
}

function summarizeUsageQuality({
  displayedFallbackModels,
  fallbackMode,
  liveProviderRows,
  liveStats,
  records,
  summary,
  tokenSaverLevel,
}: {
  displayedFallbackModels: string[];
  fallbackMode: SubscriptionFallbackMode;
  liveProviderRows: UsageAggregateRow[];
  liveStats?: NineRouterUsageStats;
  records: ProviderUsageRecord[];
  summary: ReturnType<typeof summarizeUsageRecords>;
  tokenSaverLevel: string;
}): UsageQualitySummary {
  const totalRecords = records.length;
  const totalTokens = summary.totals.totalTokens;
  const actualRecords = records.filter((record) => record.source === "provider").length;
  const estimatedRecords = records.filter((record) => record.source === "estimated").length;
  const subscriptionRecords = records.filter((record) => record.source === "9router" || record.costSource === "subscription").length;
  const pricedRecords = records.filter((record) => record.costSource === "catalog" || record.costSource === "free").length;
  const unknownCostRecords = records.filter((record) => record.costSource === "unknown").length;
  const reasoningTokens = records.reduce((total, record) => total + record.reasoningTokens, 0);
  const chatCount = new Set(records.flatMap((record) => record.chatId ? [record.chatId] : [])).size;
  const endpointCount = new Set(records.flatMap((record) => record.endpoint ? [record.endpoint] : [])).size;
  const modelCount = summary.byModel.length;
  const latestRecord = records
    .slice()
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0];
  const biggestRecord = records
    .slice()
    .sort((left, right) => right.totalTokens - left.totalTokens)[0];
  const dayCutoff = Date.now() - 24 * 60 * 60 * 1000;
  const lastDayRecords = records.filter((record) => new Date(record.createdAt).getTime() >= dayCutoff);
  const lastDayCost = lastDayRecords.reduce((total, record) => total + record.totalCostUsd, 0);
  const lastDayTokens = lastDayRecords.reduce((total, record) => total + record.totalTokens, 0);
  const projectedMonthlyCost = lastDayCost * 30;
  const projectedMonthlyTokens = lastDayTokens * 30;
  const outputShare = totalTokens > 0 ? summary.totals.outputTokens / totalTokens : 0;
  const inputShare = totalTokens > 0 ? summary.totals.inputTokens / totalTokens : 0;
  const topProvider = summary.byProvider[0];
  const topProviderShare = topProvider && totalTokens > 0 ? topProvider.totalTokens / totalTokens : 0;
  const liveRequestCount = liveStats?.totalRequests ?? 0;
  const liveProviderCount = liveProviderRows.length;
  const costConfidence = totalRecords > 0 ? pricedRecords / totalRecords : 0;
  const actualConfidence = totalRecords > 0 ? actualRecords / totalRecords : 0;

  const metrics: UsageQualityMetric[] = [
    {
      detail: totalRecords > 0 ? `${formatNumber(pricedRecords)} priced/free, ${formatNumber(subscriptionRecords + unknownCostRecords)} plan or unknown.` : liveRequestCount > 0 ? "Live totals are present; local history has not filled in yet." : "Send requests to build confidence scoring.",
      label: "Cost confidence",
      tone: totalRecords === 0 ? "neutral" : unknownCostRecords > 0 ? "warning" : "good",
      value: totalRecords > 0 ? formatPercent(costConfidence) : "Waiting",
    },
    {
      detail: totalRecords > 0 ? `${formatNumber(actualRecords)} actual, ${formatNumber(estimatedRecords)} estimated, ${formatNumber(subscriptionRecords)} subscription-plan records.` : "No local provider-visible records yet.",
      label: "Source quality",
      tone: totalRecords === 0 ? "neutral" : estimatedRecords > 0 ? "warning" : "good",
      value: totalRecords > 0 ? formatPercent(actualConfidence) : "No local",
    },
    {
      detail: lastDayRecords.length > 0 ? `${formatCompactTokens(projectedMonthlyTokens)} tokens if the last 24h repeats.` : "Needs at least one request in the last 24h.",
      label: "Monthly pace",
      tone: projectedMonthlyCost > 25 ? "warning" : "neutral",
      value: lastDayRecords.length > 0 ? formatUsd(projectedMonthlyCost) : "No pace",
    },
    {
      detail: totalTokens > 0 ? `${formatCompactTokens(summary.totals.inputTokens)} in / ${formatCompactTokens(summary.totals.outputTokens)} out / ${formatCompactTokens(reasoningTokens)} reasoning.` : "No token shape yet.",
      label: "Token shape",
      tone: outputShare > 0.6 || inputShare > 0.9 ? "warning" : "neutral",
      value: totalTokens > 0 ? `${formatPercent(outputShare)} out` : "Waiting",
    },
    {
      detail: biggestRecord ? `${biggestRecord.model} - ${formatRelativeTime(biggestRecord.createdAt)}` : liveRequestCount > 0 ? "Live requests are tracked; local largest request is not available yet." : "No request spikes yet.",
      label: "Largest request",
      tone: biggestRecord && biggestRecord.totalTokens > 100_000 ? "warning" : "neutral",
      value: biggestRecord ? formatCompactTokens(biggestRecord.totalTokens) : "None",
    },
    {
      detail: `${formatNumber(chatCount)} chats, ${formatNumber(endpointCount)} endpoints, ${formatNumber(liveProviderCount)} live subscription providers.`,
      label: "Coverage",
      tone: totalRecords > 0 && (chatCount === 0 || endpointCount === 0) ? "warning" : "neutral",
      value: `${formatNumber(summary.totals.providerCount)} providers / ${formatNumber(modelCount)} models`,
    },
  ];

  const watchlist: UsageWatchItem[] = [];

  if (unknownCostRecords > 0) {
    watchlist.push({
      detail: `${formatNumber(unknownCostRecords)} record${unknownCostRecords === 1 ? "" : "s"} could not be priced. Add catalog pricing or treat totals as partial.`,
      title: "Unpriced local records",
      tone: "warning",
    });
  }

  if (estimatedRecords > 0) {
    watchlist.push({
      detail: `${formatNumber(estimatedRecords)} request${estimatedRecords === 1 ? "" : "s"} used Gilbert estimates instead of provider-returned usage.`,
      title: "Estimate-only token data",
      tone: "warning",
    });
  }

  if (subscriptionRecords > 0 || liveRequestCount > 0) {
    watchlist.push({
      detail: "Subscription costs are comparison estimates and can differ from provider account dashboards, plan limits, or included quota.",
      title: "Subscription cost disclaimer",
    });
  }

  if (topProvider && topProviderShare >= 0.8 && summary.byProvider.length > 1) {
    watchlist.push({
      detail: `${topProvider.label} owns ${formatPercent(topProviderShare)} of tracked tokens. Check whether fallback routing is actually spreading load.`,
      title: "Provider concentration",
      tone: "warning",
    });
  }

  if (biggestRecord && biggestRecord.totalTokens > 100_000) {
    watchlist.push({
      detail: `${biggestRecord.model} produced a ${formatCompactTokens(biggestRecord.totalTokens)} token request. This is where compaction and Token Saver matter most.`,
      title: "Large request spike",
      tone: "warning",
    });
  }

  if (outputShare > 0.6) {
    watchlist.push({
      detail: "Output tokens are dominating this view. Lower max output or use cheaper/free routes for long drafting tasks.",
      title: "Output-heavy usage",
    });
  } else if (inputShare > 0.9 && tokenSaverLevel === "off") {
    watchlist.push({
      detail: "Input tokens dominate while Token Saver is off. Turn it on for tool-heavy or file-heavy chats.",
      title: "Input-heavy usage",
    });
  }

  if (reasoningTokens > 0) {
    watchlist.push({
      detail: `${formatCompactTokens(reasoningTokens)} reasoning tokens are tracked. Reasoning-capable models can change cost even when visible output is small.`,
      title: "Reasoning token visibility",
    });
  }

  if (liveStats?.errorProvider) {
    watchlist.push({
      detail: `${liveStats.errorProvider} reported a live error. Keep a free fallback route ready before long runs.`,
      title: "Live provider health",
      tone: "warning",
    });
  }

  if (fallbackMode === "off") {
    watchlist.push({
      detail: "Manual mode leaves model choice to the user. Free Auto keeps the route on docs-backed no-cost OpenCode models.",
      title: "Savings route is manual",
    });
  } else if (displayedFallbackModels.length === 0) {
    watchlist.push({
      detail: `${formatFallbackModeLabel(fallbackMode)} is selected but no route order is visible yet. Refresh after Subscriptions starts.`,
      title: "Fallback route not built",
      tone: "warning",
    });
  }

  if (totalRecords === 0 && liveRequestCount > 0) {
    watchlist.push({
      detail: "Live subscription usage is visible, but local history is empty. Keep traffic inside Gilbert so long-term history and per-model rollups fill in.",
      title: "Live-only tracking gap",
      tone: "warning",
    });
  }

  if (latestRecord && Date.now() - new Date(latestRecord.createdAt).getTime() > 7 * 24 * 60 * 60 * 1000) {
    watchlist.push({
      detail: `Last local record was ${formatRelativeTime(latestRecord.createdAt)}. Sync or send a fresh request before trusting trends.`,
      title: "Stale local history",
      tone: "warning",
    });
  }

  if (watchlist.length === 0) {
    watchlist.push({
      detail: "No pricing, source-quality, provider-health, or fallback-routing issues stand out in this view.",
      title: "No major usage risks",
      tone: "good",
    });
  }

  return {
    metrics,
    watchlist: watchlist.slice(0, 7),
  };
}

function buildUsageRecommendations({
  liveModelRows,
  liveProviderRows,
  liveRequestsPerHour,
  liveStats,
  localRecords,
  localTrend,
  summary,
  topCostDriver,
  topModel,
}: {
  liveModelRows: UsageAggregateRow[];
  liveProviderRows: UsageAggregateRow[];
  liveRequestsPerHour: number;
  liveStats?: NineRouterUsageStats;
  localRecords: number;
  localTrend: UsageTrendSummary;
  summary: ReturnType<typeof summarizeUsageRecords>;
  topCostDriver?: UsageAggregateRow;
  topModel?: UsageAggregateRow;
}): UsageRecommendation[] {
  const recommendations: UsageRecommendation[] = [];
  const liveCost = liveStats?.totalCost ?? 0;
  const liveTokens = liveModelRows.reduce((total, item) => total + item.totalTokens, 0);
  const totalTokens = Math.max(summary.totals.totalTokens, liveTokens, 1);
  const topModelShare = topModel ? topModel.totalTokens / totalTokens : 0;

  if (liveStats?.errorProvider) {
    recommendations.push({
      detail: `${liveStats.errorProvider} reported a live error. Check the subscription connection or keep free fallback enabled for continuity.`,
      title: "Repair the failing live provider",
      tone: "warning",
    });
  }

  if (liveRequestsPerHour >= 12) {
    recommendations.push({
      detail: `${formatNumber(liveRequestsPerHour)} live requests landed in the last hour. Route routine work through cheaper or free models and keep premium models for hard prompts.`,
      title: "High live request pace",
      tone: "warning",
    });
  }

  if ((summary.totals.costUsd > 0 || liveCost > 0) && topCostDriver) {
    recommendations.push({
      detail: `${topCostDriver.label} is the current estimated spend leader at ${formatUsd(topCostDriver.costUsd)}. Use Token Saver for tool-heavy chats and fallback free routes for low-risk work.`,
      title: "Lower the biggest cost driver",
    });
  }

  if (topModel && topModelShare >= 0.7) {
    recommendations.push({
      detail: `${topModel.label} owns ${formatPercent(topModelShare)} of visible tokens. Consider a second cheaper model for drafts, summaries, and background tool calls.`,
      title: "Diversify the busiest model",
    });
  }

  if (localTrend.tone === "up") {
    recommendations.push({
      detail: "Usage is climbing against the previous 24-hour window. Watch cost after long tool runs and switch Token Saver higher when tool output gets large.",
      title: "Trend is moving up",
    });
  }

  if (localRecords === 0 && (liveStats?.totalRequests ?? 0) > 0) {
    recommendations.push({
      detail: "Subscriptions has live data, but local SQLite history is empty. Keep sending through Gilbert routes so daily, weekly, and monthly rollups fill in.",
      title: "Build the local history baseline",
    });
  }

  if (recommendations.length === 0 && liveProviderRows.length > 0) {
    recommendations.push({
      detail: "Live usage is available and no provider is dominating cost. Keep this mix and check weekly totals before changing defaults.",
      title: "Routing mix looks healthy",
      tone: "good",
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      detail: "Sync Subscriptions or send a few requests to unlock model share, trend, and cost recommendations.",
      title: "Collect a little more signal",
    });
  }

  return recommendations.slice(0, 4);
}

function UsageMetric({ detail, icon: Icon, label, value }: { detail: string; icon: typeof Activity; label: string; value: string }) {
  return (
    <div className="usage-metric">
      <Icon size={18} aria-hidden="true" />
      <span>{label}</span>
      <strong>{value}</strong>
      <em>{detail}</em>
    </div>
  );
}

function UsageInsightCard({ detail, icon: Icon, label, tone = "neutral", value }: { detail: string; icon: typeof Activity; label: string; tone?: "down" | "flat" | "neutral" | "up"; value: string }) {
  return (
    <div className="usage-insight-card" data-tone={tone}>
      <Icon size={18} aria-hidden="true" />
      <span>{label}</span>
      <strong>{value}</strong>
      <em>{detail}</em>
    </div>
  );
}

function UsageBreakdownRow({ item, maxTokens }: { item: UsageAggregateRow; maxTokens: number }) {
  return (
    <div className="usage-breakdown-row">
      <div>
        <strong>{item.label}</strong>
        <span>{formatNumber(item.requests)} request{item.requests === 1 ? "" : "s"} - {formatCompactTokens(item.inputTokens)} in / {formatCompactTokens(item.outputTokens)} out</span>
      </div>
      <div className="usage-bar" aria-hidden="true">
        <span style={{ width: `${Math.max(3, (item.totalTokens / Math.max(maxTokens, 1)) * 100)}%` }} />
      </div>
      <div>
        <strong>{formatCompactTokens(item.totalTokens)}</strong>
        <span>{formatUsd(item.costUsd)}</span>
      </div>
    </div>
  );
}

function getPeriodKey(record: ProviderUsageRecord, period: UsagePeriod) {
  if (period === "week") {
    return record.weekKey;
  }

  if (period === "month") {
    return record.monthKey;
  }

  return record.dayKey || record.dateKey;
}

function formatPeriodLabel(key: string, period: UsagePeriod) {
  if (period === "month") {
    const [year, month] = key.split("-").map(Number);
    const date = new Date(year, Math.max(month - 1, 0), 1);
    return Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, { month: "short", year: "numeric" }) : key;
  }

  if (period === "week") {
    return key.replace("-W", " week ");
  }

  const parsed = new Date(`${key}T00:00:00`);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : key;
}

function toNineRouterPeriod(period: UsagePeriod): NineRouterUsagePeriod {
  if (period === "day") {
    return "today";
  }

  if (period === "week") {
    return "7d";
  }

  return "30d";
}

function formatNineRouterPeriod(period: NineRouterUsagePeriod) {
  if (period === "today") {
    return "today";
  }

  if (period === "24h") {
    return "last 24 hours";
  }

  if (period === "all") {
    return "all time";
  }

  return `last ${period}`;
}

function getNineRouterDashboardUrl(settings: ProviderSettings) {
  const savedBaseUrl = settings.baseUrls["9router"]?.trim();
  return isConfiguredNineRouterCloudEnabled()
    ? getConfiguredNineRouterDashboardUrl(savedBaseUrl || NINE_ROUTER_DASHBOARD_FALLBACK)
    : normalizeNineRouterDashboardUrl(savedBaseUrl || NINE_ROUTER_DASHBOARD_FALLBACK, NINE_ROUTER_DASHBOARD_FALLBACK);
}

function getNineRouterBaseUrl(settings: ProviderSettings) {
  const savedBaseUrl = settings.baseUrls[NINE_ROUTER_PROVIDER_ID]?.trim();
  return isConfiguredNineRouterCloudEnabled()
    ? getConfiguredNineRouterBaseUrl(savedBaseUrl || getDefaultBaseUrlForProvider(NINE_ROUTER_PROVIDER_ID))
    : savedBaseUrl || getDefaultBaseUrlForProvider(NINE_ROUTER_PROVIDER_ID);
}

function formatFallbackModeLabel(mode: SubscriptionFallbackMode) {
  if (mode === "always-free") {
    return "Free Auto";
  }

  if (mode === "smart-saver") {
    return "Free Auto";
  }

  return "Manual";
}

function formatTokenSaverLevel(level: SubscriptionTokenSaverLevel) {
  return TOKEN_SAVER_LEVEL_OPTIONS.find((option) => option.level === level)?.label ?? "Low";
}

function formatSubscriptionHelperText(text: string) {
  return text
    .replace(/\b[9]Router Local started and is ready\./g, "Subscriptions are ready.")
    .replace(/\b[9]Router Local is already running\./g, "Subscriptions are ready.")
    .replace(/\b[9]Router Local is installed\./g, "Subscriptions are installed.")
    .replace(/\b[9]Router Local was started, but the API is not ready yet\./g, "Subscriptions are still starting. Try again in a moment.")
    .replace(/\b[9]Router Local\b/g, "subscriptions")
    .replace(/\b[9]Router\b/g, "subscriptions")
    .replace(/\s+at\s+https?:\/\/(?:127\.0\.0\.1|localhost):20128(?:\/[^\s.]*)?/gi, "")
    .replace(/\bhttps?:\/\/(?:127\.0\.0\.1|localhost):20128(?:\/[^\s.]*)?/gi, "Subscriptions")
    .replace(/\b(from|in) subscriptions settings\b/gi, "$1 Subscriptions settings")
    .replace(/\bStart subscriptions, then retry\b/g, "Open Subscriptions, then retry")
    .replace(/\bsubscription helper\b/gi, "subscriptions");
}

function formatCostDetail(known: number, unknown: number, cacheSavingsUsd = 0) {
  if (cacheSavingsUsd > 0) {
    return `${formatUsd(cacheSavingsUsd)} cache savings`;
  }

  if (unknown === 0) {
    return `${formatNumber(known)} priced record${known === 1 ? "" : "s"}`;
  }

  return `${formatNumber(known)} priced / ${formatNumber(unknown)} plan or variable`;
}

function formatTokenDetail(inputTokens: number, outputTokens: number, cachedInputTokens: number) {
  const base = `${formatCompactTokens(inputTokens)} in / ${formatCompactTokens(outputTokens)} out`;

  if (cachedInputTokens <= 0) {
    return base;
  }

  return `${base} / ${formatCompactTokens(cachedInputTokens)} cached`;
}

function formatSource(record: ProviderUsageRecord) {
  if (record.costSource === "subscription") {
    return "Plan";
  }

  if (record.source === "provider") {
    return "Actual";
  }

  if (record.source === "9router") {
    return "Subscriptions";
  }

  return "Estimate";
}

function formatNumber(value: number) {
  return Math.max(Math.round(value || 0), 0).toLocaleString();
}

function formatCompactTokens(value: number) {
  const tokens = Math.max(Math.round(value || 0), 0);

  if (tokens >= 1_000_000) {
    return `${trimNumber(tokens / 1_000_000)}M`;
  }

  if (tokens >= 1_000) {
    return `${trimNumber(tokens / 1_000)}k`;
  }

  return tokens.toLocaleString();
}

function trimNumber(value: number) {
  return value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1).replace(/\.0$/, "") : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function formatUsd(value: number) {
  const normalized = Math.max(value || 0, 0);

  if (normalized === 0) {
    return "$0";
  }

  return `$${normalized.toLocaleString(undefined, {
    maximumFractionDigits: normalized < 0.01 ? 6 : normalized < 1 ? 4 : 2,
    minimumFractionDigits: normalized >= 1 ? 2 : 0,
  })}`;
}

function formatSignedPercent(value: number) {
  const percent = Math.round(value * 100);
  if (percent === 0) {
    return "Flat";
  }

  return `${percent > 0 ? "+" : ""}${percent}%`;
}

function formatPercent(value: number) {
  return `${Math.round(Math.max(value, 0) * 100)}%`;
}

function formatTimestamp(value: string | undefined) {
  if (!value) {
    return "Never";
  }

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return value;
  }

  return date.toLocaleString(undefined, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  });
}

function formatRelativeTime(value: string | undefined) {
  if (!value) {
    return "Never";
  }

  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    return value;
  }

  const diffMs = Date.now() - timestamp;
  const minutes = Math.max(Math.round(diffMs / 60_000), 0);
  if (minutes < 1) {
    return "Just now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 48) {
    return `${hours}h ago`;
  }
  return `${Math.round(hours / 24)}d ago`;
}

function readErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
