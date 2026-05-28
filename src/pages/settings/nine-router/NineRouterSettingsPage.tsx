import { CheckCircle2, Download, ExternalLink, Gauge, KeyRound, LockKeyhole, LogOut, Play, RefreshCcw, Route, ServerCog, ShieldCheck, SlidersHorizontal, Trash2, UserCheck, Wifi } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ensureNineRouterLocal,
  finishNineRouterOAuthCallback,
  getNineRouterLocalStatus,
  installNineRouterLocal,
  isTauriDesktopRuntime,
  nineRouterLocalHttp,
  openExternalUrl,
  setNineRouterLocalAutoStart,
  startNineRouterOAuthCallback,
  uninstallNineRouterLocal,
  type NineRouterInstallEvent,
  type NineRouterLocalStatus,
} from "../../../app/tauriClient";
import { formatModelCapabilitySummary, getChatModelOption, getDefaultBaseUrlForProvider, getDefaultModelForProvider, getModelRouteSourceInfo, NINE_ROUTER_ALWAYS_FREE_MODEL, NINE_ROUTER_SMART_SAVER_MODEL } from "../../../lib/models";
import { scheduleIdleTask } from "../../../lib/idleTask";
import { getBillingPlanTier } from "../../../lib/subscriptionTiers";
import { headersToRecord, normalizeNativeRequestBody, normalizeNativeRequestMethod } from "../../../services/nativeHttp";
import {
  buildNineRouterFallbackModels,
  dedupeNineRouterFallbackModels,
  hasUnusableNineRouterFallbackModels,
  isOpenCodeFreeModel,
} from "../../../services/nineRouterFallbackRouting";
import {
  chooseNineRouterConnectedAccountProvider,
  chooseNineRouterModelForAccount,
  chooseNineRouterModelForConnectedAccounts,
  getNineRouterAccountProviderForModel,
  getNineRouterCodexRedirectUri,
  hasNineRouterAccountConnection,
  choosePreferredConnection,
  formatConnectionExpiry,
  formatConnectionIdentity,
  loadNineRouterCoreSettings,
  loadNineRouterTunnelStatus,
  isConnectionActive,
  NINE_ROUTER_ACCOUNT_PROVIDERS,
  NINE_ROUTER_CODEX_MAX_POLL_ATTEMPTS,
  NINE_ROUTER_CODEX_POLL_INTERVAL_MS,
  NINE_ROUTER_CODEX_PROXY_APP_PORT,
  NINE_ROUTER_DASHBOARD_FALLBACK,
  NINE_ROUTER_DEVICE_POLL_MAX_ATTEMPTS,
  NINE_ROUTER_PROVIDER_ID,
  setNineRouterTunnelEnabled,
  shouldShowNineRouterCodexContextSettings,
  updateNineRouterCoreSettings,
  type NineRouterAccountProvider,
  type NineRouterAuthorizeResponse,
  type NineRouterCodexPollResponse,
  type NineRouterCodexProxyResponse,
  type NineRouterConnection,
  type NineRouterComboStrategy,
  type NineRouterCoreSettings,
  type NineRouterDeviceCodeResponse,
  type NineRouterExchangeResponse,
  type NineRouterOAuthPollResponse,
  type NineRouterTunnelStatus,
} from "../../../services/nineRouterClient";
import {
  getConfiguredNineRouterBaseUrl,
  getConfiguredNineRouterDashboardUrl,
  isConfiguredNineRouterCloudEnabled,
  isNineRouterCloudRequired,
  isNineRouterNativeBridgeUrl,
  withNineRouterCloudAuthHeaders,
} from "../../../services/nineRouterCloud";
import type { ProviderSettings, SubscriptionCodexContextWindow, SubscriptionFallbackMode, SubscriptionTokenSaverLevel } from "../../../types/settings";
import { ConfirmDialog } from "../../../components/dialogs/AppDialog";
import { SettingsSectionHeading } from "../components/SettingsSectionHeading";
import type { SettingsStatusMessage } from "../types";

interface NineRouterSettingsPageProps {
  onActivateProvider?: (provider: ProviderSettings["provider"], model: string) => void;
  onSettingsChange: (settings: ProviderSettings) => void;
  onSubscriptionSandboxUninstalled?: (settings: ProviderSettings) => void;
  settings: ProviderSettings;
}

type NineRouterBusyState = `account:${string}` | `disconnect:${string}` | "advanced" | "comboStrategy" | "fallback" | "install" | "settings" | "start" | "status" | "tokenSaver" | "tunnel" | "uninstall" | null;
type NineRouterModelCatalogState = {
  message: string;
  models: string[];
  status: "idle" | "loading" | "ready" | "error";
};
type NineRouterConnectionCatalogState = {
  connections: NineRouterConnection[];
  message: string;
  status: "idle" | "loading" | "ready" | "error";
};
type NineRouterComboCatalogState = {
  combos: NineRouterCombo[];
  message: string;
  status: "idle" | "loading" | "ready" | "error";
};
type NineRouterAdvancedSettingsState = {
  message: string;
  settings?: NineRouterCoreSettings;
  status: "idle" | "loading" | "ready" | "error";
  tunnel?: NineRouterTunnelStatus;
};

interface NineRouterCombo {
  id?: string;
  kind?: string | null;
  modelIds?: string[];
  models?: string[];
  name?: string;
}

interface NineRouterUsageQuota {
  displayName?: string | null;
  remaining?: number | null;
  remainingPercentage?: number | null;
  resetAt?: string | null;
  total?: number | null;
  unlimited?: boolean | null;
  used?: number | null;
}

interface NineRouterUsagePayload {
  error?: { message?: string } | string;
  extraUsage?: unknown;
  limitReached?: boolean;
  message?: string;
  plan?: string;
  quotas?: Record<string, NineRouterUsageQuota>;
  reviewLimitReached?: boolean;
}

type NineRouterUsageState = {
  message: string;
  status: "idle" | "loading" | "ready" | "error";
  usage?: NineRouterUsagePayload;
};
type NineRouterInstallProgressState = {
  detail: string;
  label: string;
  percent: number;
  status: "error" | "idle" | "running" | "success";
};
type NineRouterDisconnectTarget = {
  connections: NineRouterConnection[];
  provider: NineRouterAccountProvider;
};

const SUBSCRIPTION_OPTIMIZATION_DEFAULT: ProviderSettings["subscriptionOptimization"] = {
  codexContextWindow: "standard",
  fallbackMode: "off",
  tokenSaverLevel: "low",
};
const CODEX_CONTEXT_WINDOW_OPTIONS: Array<{ detail: string; label: string; mode: SubscriptionCodexContextWindow }> = [
  { detail: "Default 262k context for lower normal subscription usage.", label: "262k", mode: "standard" },
  { detail: "Allow 1M context for higher-cost long-context Codex runs.", label: "1M", mode: "extended" },
];
const TOKEN_SAVER_LEVEL_OPTIONS: Array<{ detail: string; label: string; level: SubscriptionTokenSaverLevel }> = [
  { detail: "Compression off. Gilbert keeps the normal tool-result budget.", label: "Off", level: "off" },
  { detail: "Light compression with the normal Gilbert tool-result budget.", label: "Low", level: "low" },
  { detail: "Trims large tool results earlier while keeping broad evidence.", label: "Medium", level: "medium" },
  { detail: "Keeps only tighter tool evidence for cheaper long tool runs.", label: "High", level: "high" },
  { detail: "Most aggressive compression for max token savings.", label: "Max", level: "max" },
];
const FALLBACK_MODE_OPTIONS: Array<{ detail: string; label: string; mode: SubscriptionFallbackMode }> = [
  { detail: "Choose models manually from the picker.", label: "Manual", mode: "off" },
  { detail: "Stay on docs-backed OpenCode Free routes when the local catalog has them.", label: "Free Auto", mode: "always-free" },
];
const COMBO_STRATEGY_OPTIONS: Array<{ detail: string; label: string; strategy: NineRouterComboStrategy }> = [
  { detail: "Try routes in order and fall through when a route fails.", label: "Fallback", strategy: "fallback" },
  { detail: "Rotate across eligible routes for repeated requests.", label: "Round robin", strategy: "round-robin" },
];
const COMBO_STICKY_LIMIT_OPTIONS = [1, 2, 3, 5] as const;
const NINE_ROUTER_MODEL_TEST_MESSAGE = "Reply with OK only.";
const NINE_ROUTER_INSTALL_PROGRESS_IDLE: NineRouterInstallProgressState = {
  detail: "",
  label: "Ready to install",
  percent: 0,
  status: "idle",
};
const NINE_ROUTER_ALWAYS_FREE_COMBO_NAME = NINE_ROUTER_ALWAYS_FREE_MODEL;
export function NineRouterSettingsPage({ onActivateProvider, onSettingsChange, onSubscriptionSandboxUninstalled, settings }: NineRouterSettingsPageProps) {
  const [busy, setBusy] = useState<NineRouterBusyState>(null);
  const accountConnectRunRef = useRef(0);
  const uninstallInFlightRef = useRef(false);
  const [installProgress, setInstallProgress] = useState<NineRouterInstallProgressState>(NINE_ROUTER_INSTALL_PROGRESS_IDLE);
  const [uninstallProgress, setUninstallProgress] = useState<NineRouterInstallProgressState | null>(null);
  const [connectionCatalog, setConnectionCatalog] = useState<NineRouterConnectionCatalogState>({
    connections: [],
    message: "Not checked",
    status: "idle",
  });
  const [modelCatalog, setModelCatalog] = useState<NineRouterModelCatalogState>({
    message: "Not checked",
    models: [],
    status: "idle",
  });
  const [, setComboCatalog] = useState<NineRouterComboCatalogState>({
    combos: [],
    message: "Not checked",
    status: "idle",
  });
  const [advancedSettings, setAdvancedSettings] = useState<NineRouterAdvancedSettingsState>({
    message: "Not checked",
    status: "idle",
  });
  const [modelTestBusy, setModelTestBusy] = useState(false);
  const [status, setStatus] = useState<NineRouterLocalStatus | null>(null);
  const [statusMessage, setStatusMessage] = useState<SettingsStatusMessage | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<NineRouterDisconnectTarget | null>(null);
  const [uninstallConfirmOpen, setUninstallConfirmOpen] = useState(false);
  const [usageByConnectionId, setUsageByConnectionId] = useState<Record<string, NineRouterUsageState>>({});
  const isNineRouterActive = settings.provider === NINE_ROUTER_PROVIDER_ID;
  const configuredCloudSubscriptions = isConfiguredNineRouterCloudEnabled();
  const cloudSubscriptionsRequired = isNineRouterCloudRequired();
  const savedNineRouterBaseUrl = settings.baseUrls[NINE_ROUTER_PROVIDER_ID]?.trim() || "";
  const nineRouterBaseUrl = configuredCloudSubscriptions
    ? getConfiguredNineRouterBaseUrl(savedNineRouterBaseUrl || status?.baseUrl || getDefaultBaseUrlForProvider(NINE_ROUTER_PROVIDER_ID))
    : savedNineRouterBaseUrl || status?.baseUrl || getDefaultBaseUrlForProvider(NINE_ROUTER_PROVIDER_ID);
  const cloudSubscriptionsEnabled = configuredCloudSubscriptions || (!cloudSubscriptionsRequired && !isNineRouterNativeBridgeUrl(nineRouterBaseUrl));
  const cloudSubscriptionsUnavailable = cloudSubscriptionsRequired && !configuredCloudSubscriptions;
  const nineRouterDashboardUrl = cloudSubscriptionsEnabled ? getConfiguredNineRouterDashboardUrl(nineRouterBaseUrl) : status?.dashboardUrl || NINE_ROUTER_DASHBOARD_FALLBACK;
  const billingTier = getBillingPlanTier(settings.billingPlan);
  const subscriptionAccountsLocked = billingTier === "free";
  const primaryLanBaseUrl = status?.lanBaseUrls?.[0] ?? "";
  const accountRows = useMemo(
    () => NINE_ROUTER_ACCOUNT_PROVIDERS.map((provider) => {
      const connections = connectionCatalog.connections.filter((connection) => connection.provider === provider.id);
      const connection = choosePreferredConnection(connections);
      return {
        connection,
        connections,
        provider,
        usageState: connection?.id ? usageByConnectionId[connection.id] : undefined,
      };
    }),
    [connectionCatalog.connections, usageByConnectionId],
  );
  const connectedAccountCount = useMemo(
    () => accountRows.filter((row) => Boolean(row.connection)).length,
    [accountRows],
  );
  const savedNineRouterModel = settings.providerModels[NINE_ROUTER_PROVIDER_ID]?.trim() || "";
  const selectedNineRouterModel = useMemo(
    () => chooseNineRouterModelForConnectedAccounts(savedNineRouterModel, modelCatalog.models, connectionCatalog.connections) || chooseNineRouterModel(savedNineRouterModel, modelCatalog),
    [connectionCatalog.connections, modelCatalog, savedNineRouterModel],
  );
  const selectedRouteProviderId = getNineRouterAccountProviderForModel(selectedNineRouterModel);
  const selectedRouteHasConnectedAccount = selectedRouteProviderId ? hasNineRouterAccountConnection(connectionCatalog.connections, selectedRouteProviderId) : false;
  const showModelRoutingCard = connectedAccountCount > 0 && selectedRouteHasConnectedAccount;
  const subscriptionOptimization = settings.subscriptionOptimization ?? SUBSCRIPTION_OPTIMIZATION_DEFAULT;
  const tokenSaverLevel = subscriptionOptimization.tokenSaverLevel;
  const fallbackMode = subscriptionOptimization.fallbackMode;
  const effectiveFallbackMode = fallbackMode === "smart-saver" ? "always-free" : fallbackMode;
  const codexContextWindow = subscriptionOptimization.codexContextWindow;
  const showCodexContextSettings = shouldShowNineRouterCodexContextSettings(connectionCatalog.connections, selectedNineRouterModel);
  const savedModelMissingFromCatalog =
    modelCatalog.status === "ready" &&
    modelCatalog.models.length > 0 &&
    Boolean(savedNineRouterModel) &&
    !modelCatalog.models.includes(savedNineRouterModel);
  const desktopRuntime = isTauriDesktopRuntime();
  const helperReady = cloudSubscriptionsEnabled || Boolean(status?.running && status.installed);
  const helperInstalled = Boolean(status?.installed);
  const helperInstalling = busy === "install" || installProgress.status === "running";
  const helperStarting = busy === "start";
  const helperStatusLabel = getSubscriptionSetupStatusLabel(status, busy, installProgress, desktopRuntime);
  const helperStatusPill = getSubscriptionSetupStatusPill(status, busy, installProgress, desktopRuntime);
  const helperActionLabel = helperInstalled ? "Start subscriptions" : "Install subscriptions";
  const helperActionBusyLabel = helperStarting ? "Starting subscriptions" : "Installing subscriptions";
  const optimizerEnabled = tokenSaverLevel !== "off";
  const optimizerRuntimeEnabled = advancedSettings.settings?.rtkEnabled ?? optimizerEnabled;
  const comboStrategy = normalizeNineRouterComboStrategy(advancedSettings.settings?.comboStrategy);
  const comboStickyLimit = clampRoundRobinLimit(advancedSettings.settings?.comboStickyRoundRobinLimit ?? 1);
  const tunnelUrl = getNineRouterTunnelUrl(advancedSettings.tunnel);
  const tunnelEnabled = Boolean(advancedSettings.tunnel?.enabled || advancedSettings.tunnel?.running || tunnelUrl);
  const cavemanEnabled = advancedSettings.settings?.cavemanEnabled === true;
  const hasRecoverableSubscriptionFootprint = !helperInstalled && Boolean(status?.dataDir || status?.installDir);
  const showInstalledRuntimeRemoval = !cloudSubscriptionsEnabled && helperInstalled && !helperInstalling && !helperStarting;
  const showInstallProgress = busy === "install" || installProgress.status === "running" || installProgress.status === "error";
  const showUninstallProgress = busy === "uninstall" || uninstallProgress?.status === "running" || uninstallProgress?.status === "error";
  const installBlocked = useMemo(() => {
    if (!status || !desktopRuntime) {
      return "";
    }

    const missing = [
      status.gitVersion ? "" : "Git",
      getSubscriptionNodeRequirementLabel(status.nodeVersion),
      status.npmVersion ? "" : "npm",
    ].filter(Boolean);

    return missing.length > 0 ? `${missing.join(", ")} required` : "";
  }, [desktopRuntime, status]);
  const helperInstallBlocked = cloudSubscriptionsUnavailable
    ? "Subscription routing is required for this build but no routing URL is configured."
    : !status?.installed && (desktopRuntime ? installBlocked : "Open the desktop app to install subscriptions");
  const displayStatusMessage = statusMessage
    ? {
        ...statusMessage,
        text: formatSubscriptionHelperText(statusMessage.text),
      }
    : null;

  useEffect(() => {
    const cancelStartup = scheduleIdleTask(() => {
      if (cloudSubscriptionsEnabled || cloudSubscriptionsUnavailable) {
        void refreshStatus({ quiet: true });
        return;
      }

      void startNineRouter({ quiet: true });
    }, 350);

    return () => {
      cancelStartup();
      accountConnectRunRef.current += 1;
      void stopCodexOAuthProxy();
    };
  }, []);

  useEffect(() => {
    if (status?.running) {
      void refreshProviderConnections({ quiet: true });
      void refreshModelCatalog({ quiet: true });
      void refreshSubscriptionOptimizer({ quiet: true });
      void refreshAdvancedSettings({ quiet: true });
      void syncTokenSaverToHelper(tokenSaverLevel, { quiet: true });
    }
  }, [nineRouterBaseUrl, status?.running, tokenSaverLevel]);

  async function refreshStatus(options: { quiet?: boolean } = {}) {
    if (!options.quiet) {
      setBusy("status");
    }
    if (!options.quiet) {
      setStatusMessage(null);
    }

    try {
      if (cloudSubscriptionsEnabled) {
        const cloudStatus = createCloudNineRouterStatus(nineRouterDashboardUrl, nineRouterBaseUrl);
        setStatus(cloudStatus);
        if (!options.quiet) {
          setStatusMessage({ kind: "success", text: cloudStatus.message });
        }
        void refreshProviderConnections({ quiet: true });
        void refreshModelCatalog({ quiet: true });
        void refreshSubscriptionOptimizer({ quiet: true });
        void refreshAdvancedSettings({ quiet: true });
        void syncTokenSaverToHelper(tokenSaverLevel, { quiet: true });
        return;
      }

      if (cloudSubscriptionsUnavailable) {
        setStatus(null);
        if (!options.quiet) {
          setStatusMessage({ kind: "warning", text: "Subscription routing is required for this build but no routing URL is configured." });
        }
        return;
      }

      const nextStatus = await getNineRouterLocalStatus();
      setStatus(nextStatus);
      if (!options.quiet) {
        setStatusMessage({ kind: nextStatus.running ? "success" : "warning", text: nextStatus.message });
      }
      if (nextStatus.running) {
        void refreshProviderConnections({ quiet: true });
        void refreshModelCatalog({ quiet: true });
        void refreshSubscriptionOptimizer({ quiet: true });
        void refreshAdvancedSettings({ quiet: true });
        void syncTokenSaverToHelper(tokenSaverLevel, { quiet: true });
      }
    } catch (error) {
      setStatusMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not check subscriptions." });
    } finally {
      if (!options.quiet) {
        setBusy((current) => (current === "status" ? null : current));
      }
    }
  }

  async function startNineRouter(options: { quiet?: boolean } = {}) {
    if (!options.quiet) {
      setBusy("start");
      setStatusMessage(null);
    }

    try {
      if (cloudSubscriptionsEnabled) {
        await refreshStatus(options);
        return;
      }

      const nextStatus = await setNineRouterLocalAutoStart(true).catch(() => ensureNineRouterLocal());
      setStatus(nextStatus);
      if (!options.quiet) {
        setStatusMessage({ kind: nextStatus.running ? "success" : "warning", text: nextStatus.message });
      }
      if (nextStatus.running) {
        void refreshProviderConnections({ quiet: true });
        void refreshModelCatalog({ quiet: true });
        void refreshSubscriptionOptimizer({ quiet: true });
        void refreshAdvancedSettings({ quiet: true });
        void syncTokenSaverToHelper(tokenSaverLevel, { quiet: true });
      }
    } catch (error) {
      setStatusMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not start subscription routing." });
    } finally {
      if (!options.quiet) {
        setBusy((current) => (current === "start" ? null : current));
      }
    }
  }

  async function installAndStartNineRouter() {
    setBusy("install");
    setUninstallProgress(null);
    setInstallProgress({
      detail: "Checking local tools and folders.",
      label: "Preparing subscriptions",
      percent: 6,
      status: "running",
    });
    setStatusMessage(null);

    try {
      const installedStatus = await installNineRouterLocal((event) => {
        handleInstallEvent(event);
      });
      setStatus(installedStatus);
      setInstallProgress({
        detail: "Launching the local routing API.",
        label: "Starting subscriptions",
        percent: 96,
        status: "running",
      });
      const startedStatus = await setNineRouterLocalAutoStart(true).catch(() => ensureNineRouterLocal());
      setStatus(startedStatus);
      setStatusMessage({ kind: startedStatus.running ? "success" : "warning", text: startedStatus.message });
      setInstallProgress({
        detail: startedStatus.message,
        label: startedStatus.running ? "Subscriptions are ready" : "Start needs attention",
        percent: startedStatus.running ? 100 : 96,
        status: startedStatus.running ? "success" : "error",
      });
      if (startedStatus.running) {
        void refreshProviderConnections({ quiet: true });
        void refreshModelCatalog({ quiet: true });
        void refreshSubscriptionOptimizer({ quiet: true });
        void refreshAdvancedSettings({ quiet: true });
        void syncTokenSaverToHelper(tokenSaverLevel, { quiet: true });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not install subscriptions.";
      setInstallProgress((current) => ({
        ...current,
        detail: message,
        label: "Install could not finish",
        status: "error",
      }));
      setStatusMessage({ kind: "error", text: message });
    } finally {
      setBusy((current) => (current === "install" ? null : current));
    }
  }

  async function uninstallSandboxSubscriptions() {
    if (uninstallInFlightRef.current) {
      return;
    }

    uninstallInFlightRef.current = true;
    accountConnectRunRef.current += 1;
    setUninstallConfirmOpen(false);
    setBusy("uninstall");
    setStatusMessage({ kind: "warning", text: "Uninstalling subscriptions. Stopping the local setup and removing saved subscription data." });
    setUninstallProgress({
      detail: "Stopping the local routing process.",
      label: "Uninstalling subscriptions",
      percent: 20,
      status: "running",
    });

    try {
      void stopCodexOAuthProxy();
      setUninstallProgress({
        detail: "Removing local setup, saved sign-ins, and cached routing data.",
        label: "Removing subscription files",
        percent: 58,
        status: "running",
      });
      const nextStatus = await uninstallNineRouterLocal();
      setStatus(nextStatus);
      setInstallProgress(NINE_ROUTER_INSTALL_PROGRESS_IDLE);
      setUninstallProgress(nextStatus.running
        ? {
            detail: nextStatus.message,
            label: "Uninstall needs attention",
            percent: 92,
            status: "error",
          }
        : null);
      setConnectionCatalog({
        connections: [],
        message: "Subscriptions uninstalled",
        status: "idle",
      });
      setModelCatalog({
        message: "Not checked",
        models: [],
        status: "idle",
      });
      setComboCatalog({
        combos: [],
        message: "Not checked",
        status: "idle",
      });
      setUsageByConnectionId({});

      const openRouterModel = settings.providerModels.openrouter?.trim() || getDefaultModelForProvider("openrouter");
      const nextSettings = createOpenRouterFallbackSettings(settings, openRouterModel);
      if (onSubscriptionSandboxUninstalled) {
        onSubscriptionSandboxUninstalled(nextSettings);
      } else {
        onSettingsChange(nextSettings);
      }

      setUninstallConfirmOpen(false);
      setStatusMessage({
        kind: nextStatus.running ? "warning" : "success",
        text: nextStatus.running ? nextStatus.message : "Subscriptions were uninstalled. You can install them again whenever you need subscription routing.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not uninstall subscriptions.";
      setUninstallProgress((current) => ({
        detail: message,
        label: "Uninstall could not finish",
        percent: current?.percent ?? 58,
        status: "error",
      }));
      setStatusMessage({ kind: "error", text: message });
    } finally {
      uninstallInFlightRef.current = false;
      setBusy((current) => (current === "uninstall" ? null : current));
    }
  }

  function handleInstallEvent(event: NineRouterInstallEvent) {
    if (event.event === "started") {
      setInstallProgress({
        detail: "Checking local tools and folders.",
        label: "Preparing subscriptions",
        percent: 8,
        status: "running",
      });
      return;
    }

    if (event.event === "step") {
      const step = getInstallStepProgress(event.data.message);
      setInstallProgress({
        detail: step.detail,
        label: step.label,
        percent: step.startPercent,
        status: "running",
      });
      return;
    }

    if (event.event === "output") {
      const step = getInstallStepProgress(event.data.label);
      setInstallProgress({
        detail: step.doneDetail,
        label: step.doneLabel,
        percent: step.donePercent,
        status: "running",
      });
      return;
    }

    setStatus(event.data.status);
    setInstallProgress({
      detail: "Launching the local routing API.",
      label: "Subscriptions installed",
      percent: 94,
      status: "running",
    });
  }

  async function refreshProviderConnections(options: { quiet?: boolean; refreshUsage?: boolean } = {}) {
    setConnectionCatalog((current) => ({
      ...current,
      message: current.status === "ready" && current.connections.length > 0 ? current.message : "Checking accounts",
      status: "loading",
    }));

    try {
      const payload = await fetchNineRouterJson<{ connections?: NineRouterConnection[] }>(joinLocalUrl(nineRouterDashboardUrl, "/api/providers"));
      const connections = payload.connections ?? [];
      const activeCount = connections.filter((connection) => isConnectionActive(connection)).length;
      setConnectionCatalog({
        connections,
        message: connections.length > 0 ? `${activeCount}/${connections.length} active` : "No accounts connected",
        status: "ready",
      });
      if (options.refreshUsage !== false) {
        void refreshAccountUsage(connections);
      }

      if (!options.quiet) {
        setStatusMessage({ kind: connections.length > 0 ? "success" : "warning", text: connections.length > 0 ? `${connections.length} subscription account${connections.length === 1 ? "" : "s"} connected.` : "No subscription accounts are connected yet." });
      }

      return connections;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load subscription accounts.";
      setConnectionCatalog({
        connections: [],
        message,
        status: "error",
      });

      if (!options.quiet) {
        setStatusMessage({ kind: "error", text: message });
      }

      return [];
    }
  }

  async function refreshModelCatalog(options: { quiet?: boolean } = {}) {
    setModelCatalog((current) => ({
      ...current,
      message: current.status === "ready" && current.models.length > 0 ? current.message : "Checking models",
      status: "loading",
    }));

    try {
      const payload = await fetchNineRouterJson<{ data?: Array<{ id?: string }>; error?: { message?: string } }>(joinLocalUrl(nineRouterBaseUrl, "/models"));
      const models = Array.from(new Set((payload.data ?? [])
        .map((model) => model.id?.trim())
        .filter((model): model is string => typeof model === "string" && model.length > 0)));
      const message = models.length > 0 ? `${models.length} live subscription ${models.length === 1 ? "route" : "routes"}` : "No live subscription routes";
      setModelCatalog({
        message,
        models,
        status: "ready",
      });

      if (!options.quiet) {
        setStatusMessage({ kind: models.length > 0 ? "success" : "warning", text: models.length > 0 ? `${message} loaded.` : "Subscriptions are running, but no live models were reported yet." });
      }

      return models;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load subscription models.";
      setModelCatalog({
        message,
        models: [],
        status: "error",
      });

      if (!options.quiet) {
        setStatusMessage({ kind: "error", text: message });
      }

      return [];
    }
  }

  async function refreshSubscriptionOptimizer(options: { quiet?: boolean } = {}) {
    if (!options.quiet) {
      setBusy("settings");
      setStatusMessage(null);
    }
    setComboCatalog((current) => ({
      ...current,
      message: current.status === "ready" ? current.message : "Checking fallback routes",
      status: "loading",
    }));

    const combosResult = await Promise.allSettled([
      loadNineRouterCombos(nineRouterDashboardUrl),
    ]);
    const comboResult = combosResult[0];

    if (comboResult.status === "fulfilled") {
      const combos = await repairActiveFallbackRouteIfNeeded(comboResult.value);
      setComboCatalog({
        combos,
        message: combos.length > 0 ? `${combos.length} fallback ${combos.length === 1 ? "route" : "routes"}` : "No fallback routes yet",
        status: "ready",
      });
    } else {
      setComboCatalog({
        combos: [],
        message: comboResult.reason instanceof Error ? comboResult.reason.message : "Could not load fallback routes.",
        status: "error",
      });
    }

    if (!options.quiet) {
      const ok = comboResult.status === "fulfilled";
      setStatusMessage({ kind: ok ? "success" : "warning", text: ok ? "Fallback routes are up to date." : "Some fallback route details could not be refreshed." });
      setBusy((current) => (current === "settings" ? null : current));
    }
  }

  async function refreshAdvancedSettings(options: { quiet?: boolean } = {}) {
    if (!status?.running) {
      setAdvancedSettings((current) => ({
        ...current,
        message: "Start subscriptions to sync controls.",
        status: "idle",
      }));
      return;
    }

    if (!options.quiet) {
      setBusy("advanced");
      setStatusMessage(null);
    }

    setAdvancedSettings((current) => ({
      ...current,
      message: current.status === "ready" ? current.message : "Syncing controls",
      status: "loading",
    }));

    const [settingsResult, tunnelResult] = await Promise.allSettled([
      loadNineRouterCoreSettings(nineRouterDashboardUrl),
      loadNineRouterTunnelStatus(nineRouterDashboardUrl),
    ]);
    const settingsOk = settingsResult.status === "fulfilled";
    const tunnelOk = tunnelResult.status === "fulfilled";

    setAdvancedSettings((current) => ({
      message: settingsOk || tunnelOk ? "Controls synced" : readErrorMessage(settingsResult.status === "rejected" ? settingsResult.reason : tunnelResult.status === "rejected" ? tunnelResult.reason : null, "Could not sync controls."),
      settings: settingsOk ? settingsResult.value : current.settings,
      status: settingsOk || tunnelOk ? "ready" : "error",
      tunnel: tunnelOk ? tunnelResult.value : current.tunnel,
    }));

    if (!options.quiet) {
      setStatusMessage({
        kind: settingsOk || tunnelOk ? "success" : "warning",
        text: settingsOk || tunnelOk ? "Subscription controls are synced." : "Some subscription controls could not be loaded.",
      });
      setBusy((current) => (current === "advanced" ? null : current));
    }
  }

  async function patchAdvancedSettings(
    patch: Partial<NineRouterCoreSettings>,
    busyKey: Exclude<NineRouterBusyState, null>,
    successText: string,
  ) {
    if (!status?.running) {
      setStatusMessage({ kind: "warning", text: "Start subscriptions before changing controls." });
      return null;
    }

    setBusy(busyKey);
    setStatusMessage(null);

    try {
      const nextSettings = await updateNineRouterCoreSettings(nineRouterDashboardUrl, patch);
      setAdvancedSettings((current) => ({
        ...current,
        message: "Controls synced",
        settings: {
          ...current.settings,
          ...patch,
          ...nextSettings,
        },
        status: "ready",
      }));
      setStatusMessage({ kind: "success", text: successText });
      return nextSettings;
    } catch (error) {
      setStatusMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not update subscription controls." });
      return null;
    } finally {
      setBusy((current) => (current === busyKey ? null : current));
    }
  }

  async function setTokenSaverLevel(level: SubscriptionTokenSaverLevel) {
    updateSubscriptionOptimization({ tokenSaverLevel: level });
    await syncTokenSaverToHelper(level);
  }

  async function activateFallbackMode(mode: SubscriptionFallbackMode) {
    const effectiveMode: SubscriptionFallbackMode = mode === "smart-saver" ? "always-free" : mode;
    updateSubscriptionOptimization({ fallbackMode: effectiveMode });

    if (effectiveMode === "off") {
      setStatusMessage({ kind: "success", text: "Savings routing is set to manual model selection." });
      return;
    }

    if (!status?.running) {
      setStatusMessage({ kind: "warning", text: "Free Auto is queued. Start subscriptions to create the fallback route." });
      return;
    }

    setBusy("fallback");
    setStatusMessage(null);

    try {
      const liveModels = modelCatalog.status === "ready" && modelCatalog.models.length > 0 ? modelCatalog.models : await refreshModelCatalog({ quiet: true });
      const models = buildNineRouterFallbackModels(effectiveMode, selectedNineRouterModel, liveModels);
      if (models.length === 0) {
        throw new Error("No OpenCode Free routes were reported yet. Refresh the live catalog and try again.");
      }

      await upsertNineRouterCombo(nineRouterDashboardUrl, NINE_ROUTER_ALWAYS_FREE_COMBO_NAME, models, "fallback");
      const combos = await loadNineRouterCombos(nineRouterDashboardUrl);
      setComboCatalog({
        combos,
        message: `${combos.length} fallback ${combos.length === 1 ? "route" : "routes"}`,
        status: "ready",
      });
      useNineRouterProvider(NINE_ROUTER_ALWAYS_FREE_MODEL, { fallbackMode: effectiveMode }, {
        statusText: `Free Auto is active with ${models.length} fallback ${models.length === 1 ? "route" : "routes"}.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not create Free Auto fallback route.";
      setStatusMessage({ kind: "error", text: formatSubscriptionHelperText(message) });
      updateSubscriptionOptimization({ fallbackMode: settings.subscriptionOptimization?.fallbackMode ?? "off" });
    } finally {
      setBusy((current) => (current === "fallback" ? null : current));
    }
  }

  async function setComboStrategy(strategy: NineRouterComboStrategy) {
    await patchAdvancedSettings({ comboStrategy: strategy }, "comboStrategy", `Route order is now ${strategy === "round-robin" ? "rotation" : "fallback"}.`);
  }

  async function setComboStickyLimit(limit: number) {
    await patchAdvancedSettings({ comboStickyRoundRobinLimit: clampRoundRobinLimit(limit) }, "comboStrategy", "Round-robin stickiness is updated.");
  }

  async function setCavemanEnabled(enabled: boolean) {
    await patchAdvancedSettings({ cavemanEnabled: enabled, cavemanLevel: advancedSettings.settings?.cavemanLevel || "full" }, "advanced", enabled ? "Extra compression is on." : "Extra compression is off.");
  }

  async function toggleTunnel() {
    if (!status?.running) {
      setStatusMessage({ kind: "warning", text: "Start subscriptions before changing tunnel access." });
      return;
    }

    setBusy("tunnel");
    setStatusMessage(null);

    try {
      const nextTunnel = await setNineRouterTunnelEnabled(nineRouterDashboardUrl, !tunnelEnabled);
      setAdvancedSettings((current) => ({
        ...current,
        message: "Tunnel status synced",
        status: "ready",
        tunnel: nextTunnel,
      }));
      setStatusMessage({ kind: "success", text: !tunnelEnabled ? "Secure tunnel is enabled." : "Secure tunnel is disabled." });
      void refreshAdvancedSettings({ quiet: true });
    } catch (error) {
      setStatusMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not update secure tunnel." });
    } finally {
      setBusy((current) => (current === "tunnel" ? null : current));
    }
  }

  async function repairActiveFallbackRouteIfNeeded(combos: NineRouterCombo[]) {
    if (effectiveFallbackMode === "off") {
      return combos;
    }

    const comboName = NINE_ROUTER_ALWAYS_FREE_COMBO_NAME;
    const combo = findNineRouterCombo(combos, comboName);
    const installedModels = getNineRouterComboModels(combo);
    const liveModels = modelCatalog.status === "ready" ? modelCatalog.models : await refreshModelCatalog({ quiet: true });
    const needsRepair =
      !combo ||
      installedModels.length === 0 ||
      hasUnusableNineRouterFallbackModels(installedModels, liveModels) ||
      !installedModels.some(isOpenCodeFreeModel);

    if (!needsRepair) {
      return combos;
    }

    const models = buildNineRouterFallbackModels(effectiveFallbackMode, selectedNineRouterModel, liveModels);
    if (models.length === 0) {
      return combos;
    }

    await upsertNineRouterCombo(nineRouterDashboardUrl, comboName, models, "fallback");
    return loadNineRouterCombos(nineRouterDashboardUrl);
  }

  async function refreshAccountUsage(connections = connectionCatalog.connections) {
    const trackedConnections = NINE_ROUTER_ACCOUNT_PROVIDERS
      .map((provider) => choosePreferredConnection(connections.filter((connection) => connection.provider === provider.id)))
      .filter((connection): connection is NineRouterConnection => Boolean(connection?.id));

    if (trackedConnections.length === 0) {
      setUsageByConnectionId({});
      return;
    }

    setUsageByConnectionId((current) => {
      const next = { ...current };
      for (const connection of trackedConnections) {
        next[connection.id] = {
          message: current[connection.id]?.status === "ready" ? current[connection.id].message : "Checking usage",
          status: "loading",
          usage: current[connection.id]?.usage,
        };
      }
      return next;
    });

    await Promise.allSettled(
      trackedConnections.map(async (connection) => {
        try {
          const usage = await fetchNineRouterJson<NineRouterUsagePayload>(joinLocalUrl(nineRouterDashboardUrl, `/api/usage/${encodeURIComponent(connection.id)}`));
          setUsageByConnectionId((current) => ({
            ...current,
            [connection.id]: {
              message: formatUsageHeadline(usage),
              status: "ready",
              usage,
            },
          }));
        } catch (error) {
          setUsageByConnectionId((current) => ({
            ...current,
            [connection.id]: {
              message: error instanceof Error ? error.message : "Could not load usage.",
              status: "error",
            },
          }));
        }
      }),
    );
  }

  async function connectCodexAccount() {
    const runId = accountConnectRunRef.current + 1;
    accountConnectRunRef.current = runId;
    setBusy("account:codex");
    setStatusMessage(null);

    try {
      let nextStatus = status;
      if (!nextStatus?.running) {
        nextStatus = cloudSubscriptionsEnabled ? createCloudNineRouterStatus(nineRouterDashboardUrl, nineRouterBaseUrl) : await ensureNineRouterLocal();
        setStatus(nextStatus);
      }

      if (!nextStatus.running) {
        throw new Error(nextStatus.message || "Set up subscriptions before connecting Codex.");
      }

      const useDesktopCallback = !isNineRouterNativeBridgeUrl(nineRouterDashboardUrl);
      const callback = useDesktopCallback ? await startNineRouterOAuthCallback({ path: "/auth/callback", port: 1455 }) : null;
      if (!useDesktopCallback) {
        await stopCodexOAuthProxy();
      }
      const redirectUri = callback?.redirectUri || getNineRouterCodexRedirectUri(nineRouterDashboardUrl);
      const authUrl = createNineRouterUrl(nineRouterDashboardUrl, "/api/oauth/codex/authorize", {
        redirect_uri: redirectUri,
      });
      const authData = await fetchNineRouterJson<NineRouterAuthorizeResponse>(authUrl);

      if (!authData.authUrl || !authData.state || !authData.codeVerifier) {
        throw new Error("Subscriptions did not return a complete Codex sign-in request.");
      }

      if (useDesktopCallback && callback) {
        setStatusMessage({ kind: "warning", text: "Finish the OpenAI sign-in in your browser. Gilbert will pick it up automatically." });
        await openExternalUrl(authData.authUrl);
        const callbackData = await finishNineRouterOAuthCallback(callback.id, 300_000);

        if (accountConnectRunRef.current !== runId) {
          return;
        }

        if (callbackData.error) {
          throw new Error(callbackData.errorDescription || callbackData.error);
        }

        if (!callbackData.code) {
          throw new Error("OpenAI did not return an authorization code.");
        }

        if (callbackData.state && callbackData.state !== authData.state) {
          throw new Error("OpenAI sign-in returned an unexpected state. Restart Codex sign-in and try again.");
        }

        const exchange = await postNineRouterJson<NineRouterExchangeResponse>(joinLocalUrl(nineRouterDashboardUrl, "/api/oauth/codex/exchange"), {
          code: callbackData.code,
          codeVerifier: authData.codeVerifier,
          redirectUri,
          state: authData.state,
        });

        if (!exchange.success) {
          throw new Error(exchange.errorDescription || exchange.error || "Codex sign-in did not complete.");
        }
      } else {
        const proxyUrl = createNineRouterUrl(nineRouterDashboardUrl, "/api/oauth/codex/start-proxy", {
          app_port: NINE_ROUTER_CODEX_PROXY_APP_PORT,
          code_verifier: authData.codeVerifier,
          redirect_uri: redirectUri,
          state: authData.state,
        });
        const proxy = await fetchNineRouterJson<NineRouterCodexProxyResponse>(proxyUrl);

        if (!proxy.success || !proxy.serverSide) {
          throw new Error(proxy.reason === "port_busy" ? "Codex sign-in is already open. Finish or close the previous sign-in window, then retry." : "Subscriptions could not start the Codex sign-in callback.");
        }

        setStatusMessage({ kind: "warning", text: "Finish the OpenAI sign-in in your browser. Gilbert will pick it up automatically." });
        await openExternalUrl(authData.authUrl);
        await waitForCodexConnection(nineRouterDashboardUrl, authData.state, runId);
      }

      if (accountConnectRunRef.current !== runId) {
        return;
      }

      const [connections, models] = await Promise.all([
        refreshProviderConnections({ quiet: true, refreshUsage: false }),
        refreshModelCatalog({ quiet: true }),
      ]);
      void refreshAccountUsage(connections);
      const connectedCodex = choosePreferredConnection(connections.filter((connection) => connection.provider === "codex"));
      const nextModel = chooseNineRouterModelForAccount("codex", savedNineRouterModel, models);
      activateConnectedAccountModel("Codex subscription", nextModel, `${formatConnectionIdentity(connectedCodex) || "Codex"} is connected. Gilbert is using ${nextModel} through your subscriptions.`);
    } catch (error) {
      if (accountConnectRunRef.current === runId) {
        setStatusMessage({ kind: "error", text: readErrorMessage(error, "Could not connect Codex.") });
      }
    } finally {
      void stopCodexOAuthProxy();
      if (accountConnectRunRef.current === runId) {
        setBusy((current) => (current === "account:codex" ? null : current));
      }
    }
  }

  async function connectProviderAccount(provider: NineRouterAccountProvider) {
    if (provider.flow === "codex") {
      await connectCodexAccount();
      return;
    }

    const runId = accountConnectRunRef.current + 1;
    accountConnectRunRef.current = runId;
    setBusy(`account:${provider.id}`);
    setStatusMessage(null);

    try {
      let nextStatus = status;
      if (!nextStatus?.running) {
        nextStatus = cloudSubscriptionsEnabled ? createCloudNineRouterStatus(nineRouterDashboardUrl, nineRouterBaseUrl) : await ensureNineRouterLocal();
        setStatus(nextStatus);
      }

      if (!nextStatus.running) {
        throw new Error(nextStatus.message || `Set up subscriptions before connecting ${provider.name}.`);
      }

      if (provider.flow === "device_code") {
        await connectDeviceCodeProvider(provider, runId);
      } else {
        await connectAuthorizationCodeProvider(provider, runId);
      }
    } catch (error) {
      if (accountConnectRunRef.current === runId) {
        setStatusMessage({ kind: "error", text: readErrorMessage(error, `Could not connect ${provider.name}.`) });
      }
    } finally {
      if (accountConnectRunRef.current === runId) {
        setBusy((current) => (current === `account:${provider.id}` ? null : current));
      }
    }
  }

  async function disconnectProviderAccount(target = disconnectTarget) {
    if (!target || target.connections.length === 0) {
      setDisconnectTarget(null);
      return;
    }
    if (busy === `disconnect:${target.provider.id}`) {
      return;
    }

    const runId = accountConnectRunRef.current + 1;
    accountConnectRunRef.current = runId;
    setBusy(`disconnect:${target.provider.id}`);
    setStatusMessage(null);

    try {
      let nextStatus = status;
      if (!nextStatus?.running) {
        nextStatus = cloudSubscriptionsEnabled ? createCloudNineRouterStatus(nineRouterDashboardUrl, nineRouterBaseUrl) : await ensureNineRouterLocal();
        setStatus(nextStatus);
      }

      if (!nextStatus.running) {
        throw new Error(nextStatus.message || `Start subscriptions before signing out from ${target.provider.name}.`);
      }

      const results = await Promise.allSettled(
        target.connections.map((connection) => deleteNineRouterConnection(nineRouterDashboardUrl, connection.id)),
      );
      const failures = results
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason));

      if (failures.length > 0) {
        throw new Error(failures[0]);
      }

      if (accountConnectRunRef.current !== runId) {
        return;
      }

      const [connections, models] = await Promise.all([
        refreshProviderConnections({ quiet: true, refreshUsage: false }),
        refreshModelCatalog({ quiet: true }),
      ]);
      void refreshAccountUsage(connections);
      const nextProvider = chooseNineRouterConnectedAccountProvider(connections, target.provider.id);
      if (nextProvider) {
        const nextModel = chooseNineRouterModelForAccount(nextProvider.id, savedNineRouterModel, models);
        if (nextModel) {
          useNineRouterProvider(nextModel, undefined, {
            statusText: `${target.provider.name} signed out. Gilbert is using ${nextProvider.name}.`,
          });
        } else {
          const openRouterModel = settings.providerModels.openrouter?.trim() || getDefaultModelForProvider("openrouter");
          useOpenRouterProvider(openRouterModel, `${target.provider.name} signed out. ${nextProvider.name} is connected, but subscriptions have not reported a usable ${nextProvider.name} model yet. Gilbert is using OpenRouter.`);
        }
      } else {
        const openRouterModel = settings.providerModels.openrouter?.trim() || getDefaultModelForProvider("openrouter");
        useOpenRouterProvider(openRouterModel, `${target.provider.name} signed out. Gilbert is using OpenRouter.`);
      }
      setDisconnectTarget(null);
    } catch (error) {
      if (accountConnectRunRef.current === runId) {
        setStatusMessage({ kind: "error", text: error instanceof Error ? error.message : `Could not sign out from ${target.provider.name}.` });
      }
    } finally {
      if (accountConnectRunRef.current === runId) {
        setBusy((current) => (current === `disconnect:${target.provider.id}` ? null : current));
      }
    }
  }

  async function connectDeviceCodeProvider(provider: NineRouterAccountProvider, runId: number) {
    const deviceData = await fetchNineRouterJson<NineRouterDeviceCodeResponse>(joinLocalUrl(nineRouterDashboardUrl, `/api/oauth/${provider.id}/device-code`));
    const deviceCode = deviceData.device_code?.trim();
    const verifyUrl = deviceData.verification_uri_complete || deviceData.verification_uri;

    if (!deviceCode || !verifyUrl) {
      throw new Error(`Subscriptions did not return a complete ${provider.name} device sign-in request.`);
    }

    const userCode = deviceData.user_code?.trim();
    setStatusMessage({
      kind: "warning",
      text: userCode ? `Finish ${provider.name} sign-in in your browser. Code: ${userCode}` : `Finish ${provider.name} sign-in in your browser. Gilbert will pick it up automatically.`,
    });
    await openExternalUrl(verifyUrl);
    await waitForDeviceCodeConnection(provider, deviceData, runId);

    if (accountConnectRunRef.current !== runId) {
      return;
    }

    const [connections, models] = await Promise.all([
      refreshProviderConnections({ quiet: true, refreshUsage: false }),
      refreshModelCatalog({ quiet: true }),
    ]);
    void refreshAccountUsage(connections);
    const nextModel = chooseNineRouterModelForAccount(provider.id, savedNineRouterModel, models);
    activateConnectedAccountModel(provider.name, nextModel, `${provider.name} is connected. Gilbert is using ${nextModel} through your subscriptions.`);
  }

  async function connectAuthorizationCodeProvider(provider: NineRouterAccountProvider, runId: number) {
    const callback = await startNineRouterOAuthCallback();
    const authData = await fetchNineRouterJson<NineRouterAuthorizeResponse>(createNineRouterUrl(nineRouterDashboardUrl, `/api/oauth/${provider.id}/authorize`, {
      redirect_uri: callback.redirectUri,
    }));

    if (!authData.authUrl || !authData.state) {
      throw new Error(`Subscriptions did not return a complete ${provider.name} sign-in request.`);
    }

    if (provider.id !== "cline" && !authData.codeVerifier) {
      throw new Error(`Subscriptions did not return a code verifier for ${provider.name}.`);
    }

    setStatusMessage({ kind: "warning", text: `Finish ${provider.name} sign-in in your browser. Gilbert will close the loop automatically.` });
    await openExternalUrl(authData.authUrl);
    const callbackData = await finishNineRouterOAuthCallback(callback.id, 300_000);

    if (accountConnectRunRef.current !== runId) {
      return;
    }

    if (callbackData.error) {
      throw new Error(callbackData.errorDescription || callbackData.error);
    }

    if (!callbackData.code) {
      throw new Error(`${provider.name} did not return an authorization code.`);
    }

    const exchange = await postNineRouterJson<NineRouterExchangeResponse>(joinLocalUrl(nineRouterDashboardUrl, `/api/oauth/${provider.id}/exchange`), {
      code: callbackData.code,
      codeVerifier: authData.codeVerifier,
      redirectUri: callback.redirectUri,
      state: callbackData.state || authData.state,
    });

    if (!exchange.success) {
      throw new Error(exchange.errorDescription || exchange.error || `${provider.name} sign-in did not complete.`);
    }

    const [connections, models] = await Promise.all([
      refreshProviderConnections({ quiet: true, refreshUsage: false }),
      refreshModelCatalog({ quiet: true }),
    ]);
    void refreshAccountUsage(connections);
    const nextModel = chooseNineRouterModelForAccount(provider.id, savedNineRouterModel, models);
    activateConnectedAccountModel(provider.name, nextModel, `${provider.name} is connected. Gilbert is using ${nextModel} through your subscriptions.`);
  }

  async function waitForDeviceCodeConnection(provider: NineRouterAccountProvider, deviceData: NineRouterDeviceCodeResponse, runId: number) {
    let intervalSeconds = Math.max(2, Number(deviceData.interval ?? 5) || 5);
    const extraData = provider.id === "kiro"
      ? {
          _authMethod: deviceData._authMethod,
          _clientId: deviceData._clientId,
          _clientSecret: deviceData._clientSecret,
          _region: deviceData._region,
          _startUrl: deviceData._startUrl,
        }
      : null;

    for (let attempt = 0; attempt < NINE_ROUTER_DEVICE_POLL_MAX_ATTEMPTS; attempt += 1) {
      if (accountConnectRunRef.current !== runId) {
        return;
      }

      await delay(intervalSeconds * 1_000);

      const payload = await postNineRouterJson<NineRouterOAuthPollResponse>(joinLocalUrl(nineRouterDashboardUrl, `/api/oauth/${provider.id}/poll`), {
        codeVerifier: deviceData.codeVerifier,
        deviceCode: deviceData.device_code,
        extraData,
      });

      if (payload.success) {
        return payload;
      }

      if (payload.error === "slow_down") {
        intervalSeconds = Math.min(intervalSeconds + 5, 30);
        continue;
      }

      if (payload.pending || payload.error === "authorization_pending" || !payload.error) {
        continue;
      }

      throw new Error(payload.errorDescription || payload.error || `${provider.name} sign-in failed.`);
    }

    throw new Error(`${provider.name} sign-in timed out. Try again from Subscriptions settings.`);
  }

  async function testSelectedModel() {
    setModelTestBusy(true);
    setStatusMessage(null);

    try {
      const response = await fetchWithTimeout(joinLocalUrl(nineRouterBaseUrl, "/chat/completions"), {
        body: JSON.stringify({
          max_completion_tokens: 32,
          messages: [{ content: NINE_ROUTER_MODEL_TEST_MESSAGE, role: "user" }],
          model: selectedNineRouterModel,
          stream: false,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const payload = await readJsonResponse<{ error?: { message?: string } }>(response);

      if (!response.ok) {
        throw new Error(formatNineRouterUiError(selectedNineRouterModel, payload.error?.message, response.status));
      }

      setStatusMessage({ kind: "success", text: `${selectedNineRouterModel} responded through your subscription route.` });
    } catch (error) {
      setStatusMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not test the selected subscription model." });
    } finally {
      setModelTestBusy(false);
    }
  }

  async function syncTokenSaverToHelper(level: SubscriptionTokenSaverLevel, options: { quiet?: boolean } = {}) {
    if (!status?.running) {
      if (!options.quiet) {
        setStatusMessage({ kind: "warning", text: "Start subscriptions before syncing optimizer settings." });
      }
      return;
    }

    if (!options.quiet) {
      setBusy("tokenSaver");
      setStatusMessage(null);
    }

    try {
      const nextSettings = await updateNineRouterCoreSettings(nineRouterDashboardUrl, {
        rtkEnabled: level !== "off",
      });
      setAdvancedSettings((current) => ({
        ...current,
        message: "Controls synced",
        settings: {
          ...current.settings,
          rtkEnabled: level !== "off",
          ...nextSettings,
        },
        status: "ready",
      }));

      if (!options.quiet) {
        setStatusMessage({
          kind: "success",
          text: "Optimizer settings are synced.",
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not sync optimizer settings.";
      if (!options.quiet) {
        setStatusMessage({ kind: "error", text: message });
      }
    } finally {
      if (!options.quiet) {
        setBusy((current) => (current === "tokenSaver" ? null : current));
      }
    }
  }

  function useNineRouterProvider(
    modelOverride = selectedNineRouterModel,
    optimizationOverride?: Partial<ProviderSettings["subscriptionOptimization"]>,
    options: { statusText?: string } = {},
  ) {
    const currentOptimization: ProviderSettings["subscriptionOptimization"] = settings.subscriptionOptimization ?? SUBSCRIPTION_OPTIMIZATION_DEFAULT;
    const nextSettings = {
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
        ...optimizationOverride,
      },
    };
    onSettingsChange(nextSettings);
    onActivateProvider?.(NINE_ROUTER_PROVIDER_ID, modelOverride);
    setStatusMessage({ kind: "success", text: options.statusText ?? "Subscription routing is now active." });
  }

  function activateConnectedAccountModel(providerName: string, model: string, successText: string) {
    if (!model) {
      setStatusMessage({
        kind: "warning",
        text: `${providerName} is connected, but subscriptions have not reported a usable ${providerName} model yet. Refresh accounts after the model catalog syncs.`,
      });
      return false;
    }

    useNineRouterProvider(model);
    setStatusMessage({ kind: "success", text: successText });
    return true;
  }

  function useOpenRouterProvider(modelOverride: string, statusText: string) {
    const nextSettings = createOpenRouterFallbackSettings(settings, modelOverride);

    onSettingsChange(nextSettings);
    onActivateProvider?.("openrouter", modelOverride);
    setStatusMessage({ kind: "success", text: statusText });
  }

  function updateSubscriptionOptimization(partial: Partial<ProviderSettings["subscriptionOptimization"]>) {
    onSettingsChange({
      ...settings,
      subscriptionOptimization: {
        ...(settings.subscriptionOptimization ?? SUBSCRIPTION_OPTIMIZATION_DEFAULT),
        ...partial,
      },
    });
  }

  function updateCodexContextWindow(mode: SubscriptionCodexContextWindow) {
    updateSubscriptionOptimization({ codexContextWindow: mode });
  }

  function openTunnelUrl() {
    if (tunnelUrl) {
      void openExternalUrl(tunnelUrl);
    }
  }

  return (
    <>
      <SettingsSectionHeading detail="Connect the provider accounts you already pay for and keep their quota visible." icon={Route} title="Subscriptions" />
      {subscriptionAccountsLocked ? (
        <div className="settings-status-banner" data-kind="warning" role="status">
          Free uses OpenRouter free models and local Ollama, LM Studio, or vLLM. Upgrade to Plus before connecting subscription accounts.
        </div>
      ) : null}
      {displayStatusMessage ? (
        <div className="settings-status-banner" data-kind={displayStatusMessage.kind} role="status" aria-live="polite">
          {displayStatusMessage.text}
        </div>
      ) : null}
      <div className="settings-section-grid">
        {cloudSubscriptionsUnavailable ? (
          <article className="settings-card settings-card-wide">
            <div className="settings-card-heading">
              <Route size={19} aria-hidden="true" />
              <div>
                <h2>Subscription routing</h2>
                <p>This build is missing the routing URL needed for managed subscriptions.</p>
              </div>
            </div>
            <div className="settings-row-list">
              <div className="settings-row">
                <span>Routing</span>
                <strong>Routing URL missing from this build.</strong>
                <span className="settings-row-static-pill">Required</span>
              </div>
              <div className="settings-row">
                <span>Accounts</span>
                <strong>Subscription accounts stay isolated by signed-in account after routing is configured.</strong>
                <span className="settings-row-static-pill">Managed</span>
              </div>
            </div>
            <div className="settings-actions-row">
              <button className="settings-ghost-button" type="button" disabled={busy !== null} onClick={() => refreshStatus()}>
                <RefreshCcw size={16} aria-hidden="true" />
                {busy === "status" ? "Checking" : "Check again"}
              </button>
            </div>
          </article>
        ) : !helperReady ? (
          <>
            <article className="settings-card settings-card-wide" aria-busy={helperInstalling || helperStarting || !status}>
            <div className="settings-card-heading">
              <Download size={19} aria-hidden="true" />
              <div>
                <h2>Set up subscriptions</h2>
                <p>{getSubscriptionSetupDescription(status, busy, installProgress, desktopRuntime)}</p>
              </div>
            </div>
            <div className="nine-router-setup-steps" aria-label="Subscription setup steps">
              <div className="nine-router-setup-step" data-state={helperInstalled ? "done" : helperInstalling || !status ? "active" : "next"}>
                <strong>1. Install</strong>
                <span>Prepare subscriptions on this device.</span>
              </div>
              <div className="nine-router-setup-step" data-state={helperInstalled ? "next" : "locked"}>
                <strong>2. Sign in</strong>
                <span>Connect Codex, Copilot, Claude, Gemini, or another paid account.</span>
              </div>
              <div className="nine-router-setup-step" data-state="locked">
                <strong>3. Pick model</strong>
                <span>Model picker labels the provider source.</span>
              </div>
            </div>
            <div className="settings-row-list">
              <div className="settings-row">
                <span>Status</span>
                <strong>{helperStatusLabel}</strong>
                <span className="settings-row-static-pill">{helperStatusPill}</span>
              </div>
              <div className="settings-row">
                <span>Launch</span>
                <strong>Starts automatically when Subscriptions opens or when a route needs it</strong>
                <span className="settings-row-static-pill">Automatic</span>
              </div>
              {hasRecoverableSubscriptionFootprint ? (
                <div className="settings-row">
                  <span>Existing files</span>
                  <strong>Setup can reuse or repair local subscription files.</strong>
                  <span className="settings-row-static-pill">Recoverable</span>
                </div>
              ) : null}
              {helperInstallBlocked ? (
                <div className="settings-row">
                  <span>{desktopRuntime ? "Missing" : "Runtime"}</span>
                  <strong>{helperInstallBlocked}</strong>
                  <span className="settings-row-static-pill">{desktopRuntime ? "Required" : "Desktop"}</span>
                </div>
              ) : null}
            </div>
            <div className="settings-actions-row">
              <button
                className="settings-primary-button"
                type="button"
                disabled={subscriptionAccountsLocked || busy !== null || !status || Boolean(helperInstallBlocked)}
                onClick={status?.installed ? () => startNineRouter() : installAndStartNineRouter}
              >
                {subscriptionAccountsLocked ? <LockKeyhole size={16} aria-hidden="true" /> : status?.installed ? <Play size={16} aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
                {subscriptionAccountsLocked ? "Plus required" : helperInstalling || helperStarting ? helperActionBusyLabel : helperActionLabel}
              </button>
              <button className="settings-ghost-button" type="button" disabled={busy !== null} onClick={() => refreshStatus()}>
                <RefreshCcw size={16} aria-hidden="true" />
                {busy === "status" ? "Checking" : "Check again"}
              </button>
            </div>
            {showInstallProgress ? <InstallProgressMeter progress={installProgress} /> : null}
            </article>

          </>
        ) : (
          <>
            <article className="settings-card settings-card-wide">
              <div className="settings-card-heading">
                <UserCheck size={19} aria-hidden="true" />
                <div>
                  <h2>Account subscriptions</h2>
                  <p>Sign in with the provider accounts you already pay for.</p>
                </div>
              </div>
              <div className="nine-router-account-grid">
                {accountRows.map(({ connection, connections, provider, usageState }) => {
                  const providerBusy = busy === `account:${provider.id}`;
                  const providerDisconnecting = busy === `disconnect:${provider.id}`;
                  const connected = Boolean(connection);

                  return (
                    <section className="nine-router-account-row" data-connected={connected} key={provider.id}>
                      <div className="nine-router-account-row-heading">
                        <div>
                          <strong>{provider.name}</strong>
                          <span>{provider.description}</span>
                        </div>
                        <span className="settings-row-static-pill">{connected ? "Connected" : "Sign in"}</span>
                      </div>

                      <div className="settings-row-list nine-router-account-meta">
                        <div className="settings-row">
                          <span>Status</span>
                          <strong>{formatSubscriptionHelperText(formatConnectionStatus(connection, connectionCatalog))}</strong>
                          <span className="settings-row-static-pill">{connections.length > 1 ? `${connections.length} saved` : connected ? "Ready" : "Needed"}</span>
                        </div>
                        <div className="settings-row">
                          <span>Account</span>
                          <strong>{formatConnectionIdentity(connection) || "Not connected"}</strong>
                        </div>
                        <div className="settings-row">
                          <span>Plan</span>
                          <strong>{formatUsagePlan(usageState, connection)}</strong>
                        </div>
                        <div className="settings-row">
                          <span>Token</span>
                          <strong>{formatConnectionExpiry(connection)}</strong>
                        </div>
                      </div>

                      <UsageQuotaList provider={provider} usageState={usageState} />
                      {connection?.lastError ? <span className="settings-status" data-kind="error">{formatSubscriptionHelperText(connection.lastError)}</span> : null}
                      {!connected ? <span className="settings-status">{provider.usageNote}</span> : null}

                      <button
                        className={`${connected ? "settings-danger-button" : "settings-primary-button"} settings-full-width-button`}
                        type="button"
                        aria-label={connected ? `Sign out from ${provider.name}` : `Sign in with ${provider.name}`}
                        title={connected ? `Sign out from ${provider.name}` : `Sign in with ${provider.name}`}
                        disabled={subscriptionAccountsLocked || busy !== null}
                        onClick={() => {
                          if (connected) {
                            setDisconnectTarget({ connections, provider });
                            return;
                          }

                          void connectProviderAccount(provider);
                        }}
                      >
                        {subscriptionAccountsLocked ? <LockKeyhole size={16} aria-hidden="true" /> : connected ? <LogOut size={16} aria-hidden="true" /> : provider.flow === "device_code" ? <ExternalLink size={16} aria-hidden="true" /> : <KeyRound size={16} aria-hidden="true" />}
                        {subscriptionAccountsLocked ? "Plus required" : providerDisconnecting ? "Signing out" : providerBusy ? "Waiting for sign-in" : connected ? "Sign out" : `Sign in with ${provider.name}`}
                      </button>
                    </section>
                  );
                })}
              </div>
              <button className="settings-ghost-button settings-full-width-button" type="button" disabled={connectionCatalog.status === "loading"} onClick={() => refreshProviderConnections()}>
                <RefreshCcw size={16} aria-hidden="true" />
                {connectionCatalog.status === "loading" ? "Checking" : "Refresh accounts"}
              </button>
            </article>

            {primaryLanBaseUrl ? (
              <article className="settings-card nine-router-routing-card">
                <div className="settings-card-heading">
                  <Wifi size={19} aria-hidden="true" />
                  <div>
                    <h2>Wi-Fi access</h2>
                    <p>Devices on this network can use subscriptions through this desktop app.</p>
                  </div>
                </div>
                <div className="settings-row-list">
                  <div className="settings-row">
                    <span>Mobile connection URL</span>
                    <strong>{primaryLanBaseUrl}</strong>
                    <span className="settings-row-static-pill">LAN</span>
                  </div>
                </div>
              </article>
            ) : null}

            {showModelRoutingCard ? (
              <article className="settings-card nine-router-routing-card">
              <div className="settings-card-heading">
                <ServerCog size={19} aria-hidden="true" />
                <div>
                  <h2>Model routing</h2>
                  <p>{isNineRouterActive ? "Active subscription route." : "Use connected accounts from the model picker."}</p>
                </div>
              </div>

              <div className="nine-router-routing-summary" aria-label="Subscription routing summary">
                <div className="nine-router-routing-main">
                  <span>{isNineRouterActive ? "Subscriptions active" : "Subscriptions ready"}</span>
                  <strong title={formatSubscriptionRouteSummary(selectedNineRouterModel)}>{formatSubscriptionRouteSummary(selectedNineRouterModel)}</strong>
                  <small>{formatSubscriptionRouteCapabilities(selectedNineRouterModel)}</small>
                </div>
                <div className="nine-router-routing-badges">
                  <span className="settings-row-static-pill">{isNineRouterActive ? "Active" : "Ready"}</span>
                  <span className="settings-row-static-pill">{modelCatalog.status === "ready" ? `${modelCatalog.models.length} routes` : modelCatalog.status === "error" ? "Check catalog" : "Catalog"}</span>
                </div>
              </div>

              <div className="settings-row-list nine-router-routing-details">
                {showCodexContextSettings ? (
                  <div className="settings-row">
                    <span>Codex context</span>
                    <strong>{codexContextWindow === "extended" ? "1M" : "262k"}</strong>
                    <span className="settings-row-static-pill">{codexContextWindow === "extended" ? "Higher cost" : "Default"}</span>
                  </div>
                ) : null}
                <div className="settings-row">
                  <span>Image generation</span>
                  <strong>{subscriptionAccountsLocked ? "Plus required" : settings.tools.imageGeneration ? "Available in chat" : "Disabled"}</strong>
                  <button
                    className="settings-switch"
                    type="button"
                    role="switch"
                    aria-checked={settings.tools.imageGeneration}
                    data-on={settings.tools.imageGeneration}
                    disabled={subscriptionAccountsLocked}
                    onClick={() =>
                      onSettingsChange({
                        ...settings,
                        tools: {
                          ...settings.tools,
                          imageGeneration: !settings.tools.imageGeneration,
                        },
                      })
                    }
                  >
                    <span />
                  </button>
                </div>
              </div>

              {showCodexContextSettings ? (
                <div className="settings-stack">
                  <strong>Codex subscription context</strong>
                  <span className="settings-subtle-text">262k is the default cost-saving context limit. 1M is available for long-context Codex work at higher cost.</span>
                  <div className="settings-segmented-control settings-segmented-control-compact" aria-label="Codex subscription context window">
                    {CODEX_CONTEXT_WINDOW_OPTIONS.map((option) => (
                      <button
                        aria-pressed={codexContextWindow === option.mode}
                        data-selected={codexContextWindow === option.mode}
                        key={option.mode}
                        title={option.detail}
                        type="button"
                        disabled={subscriptionAccountsLocked}
                        onClick={() => updateCodexContextWindow(option.mode)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {savedModelMissingFromCatalog ? (
                <span className="settings-status" data-kind="warning">
                  Saved model {savedNineRouterModel} is not in the live catalog. Gilbert will use {selectedNineRouterModel} when you switch.
                </span>
              ) : null}
              <button className="settings-ghost-button settings-full-width-button" type="button" disabled={subscriptionAccountsLocked} onClick={() => useNineRouterProvider()}>
                {subscriptionAccountsLocked ? <LockKeyhole size={16} aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}
                {subscriptionAccountsLocked ? "Plus required" : "Use subscription routing"}
              </button>
              <button className="settings-ghost-button settings-full-width-button" type="button" disabled={subscriptionAccountsLocked || modelTestBusy} onClick={testSelectedModel}>
                {subscriptionAccountsLocked ? <LockKeyhole size={16} aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}
                {subscriptionAccountsLocked ? "Plus required" : modelTestBusy ? "Testing" : "Test selected model"}
              </button>
              </article>
            ) : null}

            <article className="settings-card settings-card-wide nine-router-advanced-card" aria-busy={busy === "advanced" || busy === "comboStrategy" || busy === "fallback" || busy === "tokenSaver" || busy === "tunnel"}>
              <div className="settings-card-heading">
                <SlidersHorizontal size={19} aria-hidden="true" />
                <div>
                  <h2>Savings controls</h2>
                  <p>Tune token savings, fallback behavior, and private device access.</p>
                </div>
              </div>

              <div className="settings-row-list">
                <div className="settings-row">
                  <span>Controls</span>
                  <strong>{advancedSettings.status === "ready" ? "Synced" : advancedSettings.status === "loading" ? "Syncing" : advancedSettings.message}</strong>
                  <span className="settings-row-static-pill">{advancedSettings.status === "error" ? "Check" : advancedSettings.status === "ready" ? "Ready" : "Local"}</span>
                </div>
                <div className="settings-row">
                  <span>Compression</span>
                  <strong>{optimizerRuntimeEnabled ? `${formatTokenSaverLevel(tokenSaverLevel)} token saver` : "Off"}</strong>
                  <span className="settings-row-static-pill">{optimizerRuntimeEnabled ? "On" : "Off"}</span>
                </div>
                <div className="settings-row">
                  <span>Fallback routing</span>
                  <strong>{effectiveFallbackMode === "off" ? "Manual model selection" : "Free Auto"}</strong>
                  <span className="settings-row-static-pill">{effectiveFallbackMode === "off" ? "Manual" : "Active"}</span>
                </div>
                <div className="settings-row">
                  <span>Secure tunnel</span>
                  <strong title={tunnelUrl || undefined}>{tunnelEnabled ? tunnelUrl || "Enabled" : "Disabled"}</strong>
                  <button
                    className="settings-switch"
                    type="button"
                    role="switch"
                    aria-checked={tunnelEnabled}
                    data-on={tunnelEnabled}
                    disabled={busy !== null}
                    onClick={() => void toggleTunnel()}
                  >
                    <span />
                  </button>
                </div>
              </div>

              <div className="nine-router-advanced-grid">
                <section className="nine-router-advanced-panel">
                  <div className="nine-router-advanced-panel-heading">
                    <Gauge size={16} aria-hidden="true" />
                    <strong>Token saver</strong>
                    <span>{optimizerRuntimeEnabled ? "On" : "Off"}</span>
                  </div>
                  <div className="settings-segmented-control settings-segmented-control-compact nine-router-token-saver-control" aria-label="Token saver level">
                    {TOKEN_SAVER_LEVEL_OPTIONS.map((option) => (
                      <button
                        type="button"
                        key={option.level}
                        data-selected={tokenSaverLevel === option.level}
                        aria-pressed={tokenSaverLevel === option.level}
                        disabled={busy !== null}
                        title={option.detail}
                        onClick={() => void setTokenSaverLevel(option.level)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </section>

                <section className="nine-router-advanced-panel">
                  <div className="nine-router-advanced-panel-heading">
                    <Route size={16} aria-hidden="true" />
                    <strong>Savings routing</strong>
                    <span>{effectiveFallbackMode === "off" ? "Manual" : "Free Auto"}</span>
                  </div>
                  <div className="settings-segmented-control settings-segmented-control-compact" aria-label="Fallback routing mode">
                    {FALLBACK_MODE_OPTIONS.map((option) => (
                      <button
                        type="button"
                        key={option.mode}
                        data-selected={effectiveFallbackMode === option.mode}
                        aria-pressed={effectiveFallbackMode === option.mode}
                        disabled={busy !== null}
                        title={option.detail}
                        onClick={() => void activateFallbackMode(option.mode)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </section>

                <section className="nine-router-advanced-panel">
                  <div className="nine-router-advanced-panel-heading">
                    <ServerCog size={16} aria-hidden="true" />
                    <strong>Route order</strong>
                    <span>{comboStrategy === "round-robin" ? "Round robin" : "Fallback"}</span>
                  </div>
                  <div className="settings-segmented-control settings-segmented-control-compact" aria-label="Route order">
                    {COMBO_STRATEGY_OPTIONS.map((option) => (
                      <button
                        type="button"
                        key={option.strategy}
                        data-selected={comboStrategy === option.strategy}
                        aria-pressed={comboStrategy === option.strategy}
                        disabled={busy !== null}
                        title={option.detail}
                        onClick={() => void setComboStrategy(option.strategy)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  {comboStrategy === "round-robin" ? (
                    <div className="settings-segmented-control settings-segmented-control-compact" aria-label="Rotation stickiness">
                      {COMBO_STICKY_LIMIT_OPTIONS.map((limit) => (
                        <button
                          type="button"
                          key={limit}
                          data-selected={comboStickyLimit === limit}
                          aria-pressed={comboStickyLimit === limit}
                          disabled={busy !== null}
                          onClick={() => void setComboStickyLimit(limit)}
                        >
                          {limit}x
                        </button>
                      ))}
                    </div>
                  ) : null}
                </section>

                <section className="nine-router-advanced-panel">
                  <div className="nine-router-advanced-panel-heading">
                    <ShieldCheck size={16} aria-hidden="true" />
                    <strong>Extra compression</strong>
                    <span>{cavemanEnabled ? "On" : "Off"}</span>
                  </div>
                  <button
                    className="settings-switch"
                    type="button"
                    role="switch"
                    aria-checked={cavemanEnabled}
                    data-on={cavemanEnabled}
                    disabled={busy !== null}
                    onClick={() => void setCavemanEnabled(!cavemanEnabled)}
                  >
                    <span />
                  </button>
                </section>

                <section className="nine-router-advanced-panel">
                  <div className="nine-router-advanced-panel-heading">
                    <Wifi size={16} aria-hidden="true" />
                    <strong>Private link</strong>
                    <span>{tunnelEnabled ? "Enabled" : "Off"}</span>
                  </div>
                  <div className="settings-actions-row">
                    <button className="settings-ghost-button" type="button" disabled={busy !== null} onClick={() => void toggleTunnel()}>
                      <Wifi size={16} aria-hidden="true" />
                      {busy === "tunnel" ? "Updating" : tunnelEnabled ? "Disable" : "Enable"}
                    </button>
                    {tunnelUrl ? (
                      <button className="settings-ghost-button" type="button" onClick={openTunnelUrl}>
                        <ExternalLink size={16} aria-hidden="true" />
                        Open
                      </button>
                    ) : null}
                  </div>
                </section>

              </div>
              <button className="settings-ghost-button settings-full-width-button" type="button" disabled={advancedSettings.status === "loading"} onClick={() => refreshAdvancedSettings()}>
                <RefreshCcw size={16} aria-hidden="true" />
                {advancedSettings.status === "loading" ? "Syncing controls" : "Refresh controls"}
              </button>
            </article>

          </>
        )}

        {showInstalledRuntimeRemoval ? (
          <article className="settings-card settings-card-wide settings-danger-card" aria-busy={busy === "uninstall"}>
            <div className="settings-card-heading">
              <Trash2 size={19} aria-hidden="true" />
              <div>
                <h2>Installed subscriptions</h2>
                <p>Remove subscription setup, saved subscription sign-ins, and cached routing data from this device.</p>
              </div>
            </div>
            <div className="settings-row-list">
              <div className="settings-row">
                <span>Subscriptions</span>
                <strong>{status?.running ? "Running" : "Installed"}</strong>
                <span className="settings-row-static-pill">{status?.running ? "Active" : "Local"}</span>
              </div>
              <div className="settings-row">
                <span>Reinstall</span>
                <strong>After uninstall, use Set up subscriptions to install a fresh copy.</strong>
              </div>
            </div>
            <button className="settings-danger-button settings-full-width-button" type="button" disabled={busy !== null || !showInstalledRuntimeRemoval} onClick={() => setUninstallConfirmOpen(true)}>
              <Trash2 size={16} aria-hidden="true" />
              {busy === "uninstall" ? "Uninstalling subscriptions" : "Uninstall subscriptions"}
            </button>
            {showUninstallProgress && uninstallProgress ? <InstallProgressMeter progress={uninstallProgress} /> : null}
          </article>
        ) : null}
      </div>
      <ConfirmDialog
        confirmLabel={disconnectTarget && busy === `disconnect:${disconnectTarget.provider.id}` ? "Signing out..." : "Sign out"}
        description={disconnectTarget ? `This removes ${disconnectTarget.connections.length} saved ${disconnectTarget.provider.name} subscription account${disconnectTarget.connections.length === 1 ? "" : "s"} from this device.` : ""}
        icon={LogOut}
        onClose={() => {
          if (!disconnectTarget || busy !== `disconnect:${disconnectTarget.provider.id}`) {
            setDisconnectTarget(null);
          }
        }}
        onConfirm={() => {
          void disconnectProviderAccount();
        }}
        open={Boolean(disconnectTarget)}
        title={disconnectTarget ? `Sign out from ${disconnectTarget.provider.name}?` : "Sign out?"}
        tone="danger"
      />
      <ConfirmDialog
        confirmLabel="Uninstall subscriptions"
        description="This removes subscription setup from this device, including saved subscription sign-ins and local routing data. You can reinstall it from Subscriptions."
        onClose={() => {
          if (busy !== "uninstall") {
            setUninstallConfirmOpen(false);
          }
        }}
        onConfirm={uninstallSandboxSubscriptions}
        open={uninstallConfirmOpen}
        title="Uninstall subscriptions?"
        tone="danger"
      />
    </>
  );
}

function normalizeNineRouterComboStrategy(value: unknown): NineRouterComboStrategy {
  return value === "round-robin" ? "round-robin" : "fallback";
}

function clampRoundRobinLimit(value: unknown) {
  const numericValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numericValue)) {
    return 1;
  }

  return Math.min(25, Math.max(1, Math.round(numericValue)));
}

function getNineRouterTunnelUrl(tunnel: NineRouterTunnelStatus | undefined) {
  return tunnel?.publicUrl || tunnel?.tunnelUrl || tunnel?.url || "";
}

function formatTokenSaverLevel(level: SubscriptionTokenSaverLevel) {
  switch (level) {
    case "max":
      return "Max";
    case "high":
      return "High";
    case "medium":
      return "Medium";
    case "low":
      return "Low";
    default:
      return "Off";
  }
}

function readErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  return fallback;
}

function getSubscriptionSetupStatusLabel(
  status: NineRouterLocalStatus | null,
  busy: NineRouterBusyState,
  installProgress: NineRouterInstallProgressState,
  desktopRuntime: boolean,
) {
  if (busy === "install" || installProgress.status === "running") {
    return installProgress.label || "Installing subscriptions";
  }

  if (busy === "start") {
    return "Starting subscriptions";
  }

  if (!status) {
    return "Checking setup";
  }

  if (status.running && status.installed) {
    return "Ready";
  }

  if (status.installed) {
    return "Installed, not running";
  }

  if (!desktopRuntime) {
    return "Desktop app required";
  }

  if (installProgress.status === "error") {
    return "Install needs attention";
  }

  return "Not installed";
}

function getSubscriptionSetupStatusPill(
  status: NineRouterLocalStatus | null,
  busy: NineRouterBusyState,
  installProgress: NineRouterInstallProgressState,
  desktopRuntime: boolean,
) {
  if (busy === "install" || busy === "start" || installProgress.status === "running") {
    return "In progress";
  }

  if (!status) {
    return "Checking";
  }

  if (status.running && status.installed) {
    return "Ready";
  }

  if (status.installed) {
    return "Installed";
  }

  if (!desktopRuntime) {
    return "Desktop";
  }

  if (installProgress.status === "error") {
    return "Retry";
  }

  return "Needed";
}

function getSubscriptionSetupDescription(
  status: NineRouterLocalStatus | null,
  busy: NineRouterBusyState,
  installProgress: NineRouterInstallProgressState,
  desktopRuntime: boolean,
) {
  if (busy === "install" || installProgress.status === "running") {
    return "Preparing subscriptions on this device. Progress updates appear below.";
  }

  if (busy === "start") {
    return "Starting subscriptions. This usually takes a moment.";
  }

  if (!status) {
    return "Checking whether subscriptions are already installed on this device.";
  }

  if (!desktopRuntime) {
    return "Subscription setup runs in the desktop app. API-key and OpenRouter routes are still available in previews.";
  }

  if (status.installed && !status.running) {
    return "Subscriptions are installed but not running yet. Start them to connect account subscriptions.";
  }

  if (installProgress.status === "error") {
    return "Setup did not finish. Review the status below and try again when ready.";
  }

  return "Prepare subscriptions once. Gilbert starts them automatically when a subscription route needs them. Requires Git, Node.js 20+, and npm.";
}

function getSubscriptionNodeRequirementLabel(version: string | null | undefined) {
  if (!version) {
    return "Node.js 20+";
  }

  const major = parseNodeMajorVersion(version);
  return major !== null && major >= 20 ? "" : "Node.js 20+";
}

function parseNodeMajorVersion(version: string) {
  const match = version.trim().match(/^v?(\d+)/);
  return match ? Number.parseInt(match[1] ?? "", 10) : null;
}

function normalizeNineRouterCombosPayload(payload: unknown) {
  if (Array.isArray(payload)) {
    return payload.filter(isNineRouterCombo);
  }

  if (typeof payload !== "object" || !payload) {
    return [];
  }

  const record = payload as { combos?: unknown; data?: unknown };
  const combos = Array.isArray(record.combos) ? record.combos : Array.isArray(record.data) ? record.data : [];

  return combos.filter(isNineRouterCombo);
}

function isNineRouterCombo(value: unknown): value is NineRouterCombo {
  if (typeof value !== "object" || !value) {
    return false;
  }

  const combo = value as Partial<NineRouterCombo>;
  return typeof combo.name === "string" || typeof combo.id === "string";
}

function findNineRouterCombo(combos: NineRouterCombo[], name: string) {
  return combos.find((combo) => combo.name === name || combo.id === name) ?? null;
}

function getNineRouterComboModels(combo: NineRouterCombo | null | undefined) {
  if (!combo) {
    return [];
  }

  const models = Array.isArray(combo.models) ? combo.models : Array.isArray(combo.modelIds) ? combo.modelIds : [];
  return dedupeNineRouterFallbackModels(models);
}

async function loadNineRouterCombos(dashboardUrl: string) {
  const payload = await fetchNineRouterJson<NineRouterCombo[] | { combos?: NineRouterCombo[]; data?: NineRouterCombo[] }>(joinLocalUrl(dashboardUrl, "/api/combos"));
  return normalizeNineRouterCombosPayload(payload);
}

async function upsertNineRouterCombo(dashboardUrl: string, name: string, models: string[], kind: string) {
  const combos = await loadNineRouterCombos(dashboardUrl);
  const existing = findNineRouterCombo(combos, name);
  const body = {
    kind,
    models,
    name,
  };

  if (existing?.id) {
    return putNineRouterJson<NineRouterCombo>(joinLocalUrl(dashboardUrl, `/api/combos/${encodeURIComponent(existing.id)}`), body);
  }

  return postNineRouterJson<NineRouterCombo>(joinLocalUrl(dashboardUrl, "/api/combos"), body);
}

function UsageQuotaList({ provider, usageState }: { provider: NineRouterAccountProvider; usageState?: NineRouterUsageState }) {
  if (!usageState || usageState.status === "idle") {
    return <span className="nine-router-usage-empty">{provider.usageNote}</span>;
  }

  if (usageState.status === "loading") {
    return <span className="nine-router-usage-empty">Checking usage limits...</span>;
  }

  if (usageState.status === "error") {
    return <span className="settings-status" data-kind="warning">{formatSubscriptionHelperText(usageState.message)}</span>;
  }

  const quotaEntries = getUsageQuotaEntries(usageState.usage);

  if (quotaEntries.length === 0) {
    return <span className="nine-router-usage-empty">{formatSubscriptionHelperText(usageState.usage?.message || usageState.message || provider.usageNote)}</span>;
  }

  return (
    <div className="nine-router-quota-list" aria-label={`${provider.name} usage limits`}>
      {quotaEntries.map(([key, quota]) => {
        const usedPercent = getQuotaUsedPercent(quota);
        return (
          <div className="nine-router-quota-row" key={key}>
            <div>
              <strong>{formatQuotaLabel(key, quota)}</strong>
              <span>{formatQuotaValue(quota)}</span>
            </div>
            <div className="nine-router-quota-meter" aria-hidden="true">
              <span style={{ width: `${usedPercent}%` }} />
            </div>
            <small>{formatQuotaReset(quota)}</small>
          </div>
        );
      })}
    </div>
  );
}

function createOpenRouterFallbackSettings(settings: ProviderSettings, openRouterModel: string): ProviderSettings {
  const fallbackModel = openRouterModel.trim() || getDefaultModelForProvider("openrouter");
  const providerModels = {
    ...settings.providerModels,
    openrouter: fallbackModel,
    [NINE_ROUTER_PROVIDER_ID]: "",
  };

  if (settings.provider !== NINE_ROUTER_PROVIDER_ID) {
    providerModels[settings.provider] = settings.model;
  }

  return {
    ...settings,
    model: fallbackModel,
    provider: "openrouter",
    providerModels,
    subscriptionOptimization: {
      ...(settings.subscriptionOptimization ?? SUBSCRIPTION_OPTIMIZATION_DEFAULT),
      fallbackMode: "off",
    },
  };
}

function InstallProgressMeter({ progress }: { progress: NineRouterInstallProgressState }) {
  const percent = clampPercent(progress.percent);

  return (
    <div className="settings-install-progress" data-status={progress.status} aria-live="polite">
      <div className="settings-install-progress-heading">
        <strong>{progress.label}</strong>
        <span>{percent}%</span>
      </div>
      <div className="settings-install-progress-track" role="progressbar" aria-label="Subscriptions install progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <span style={{ width: `${percent}%` }} />
      </div>
      {progress.detail ? <small>{formatSubscriptionHelperText(progress.detail)}</small> : null}
    </div>
  );
}

function getInstallStepProgress(rawLabel: string) {
  const label = formatSubscriptionHelperText(rawLabel);
  const normalized = rawLabel.toLowerCase();

  if (/clone|update|source/.test(normalized)) {
    return {
      detail: "Preparing the local subscription source.",
      doneDetail: "Source is ready.",
      doneLabel: "Source ready",
      donePercent: 42,
      label: /update/.test(normalized) ? "Updating subscriptions" : "Downloading subscriptions",
      startPercent: 22,
    };
  }

  if (/dependencies|npm|install/.test(normalized)) {
    return {
      detail: "Installing dependencies. This can take a few minutes.",
      doneDetail: "Dependencies are installed.",
      doneLabel: "Dependencies installed",
      donePercent: 68,
      label: "Installing dependencies",
      startPercent: 48,
    };
  }

  if (/build/.test(normalized)) {
    return {
      detail: "Building the local routing runtime.",
      doneDetail: "Build complete.",
      doneLabel: "Build complete",
      donePercent: 92,
      label: "Building subscriptions",
      startPercent: 76,
    };
  }

  return {
    detail: label,
    doneDetail: "Step complete.",
    doneLabel: "Step complete",
    donePercent: 90,
    label,
    startPercent: 16,
  };
}

function formatSubscriptionHelperText(text: string) {
  return text
    .replace(/\b[9]Router Local started and is ready\./g, "Subscriptions are ready.")
    .replace(/\b[9]Router Local is already running\./g, "Subscriptions are ready.")
    .replace(/\b[9]Router Local is installed\./g, "Subscriptions are installed.")
    .replace(/\b[9]Router Local was started, but the API is not ready yet\./g, "Subscriptions are still starting. Try again in a moment.")
    .replace(/\b[Cc]loud subscription routing is ready\./g, "Subscription routing is ready.")
    .replace(/\b[Cc]loud subscription routing is required, but this build does not have a [Cc]loud router URL configured\./g, "Subscription routing is required for this build but no routing URL is configured.")
    .replace(/\b[Cc]loud router URL\b/g, "routing URL")
    .replace(/\b[Cc]loud Run\b/g, "routing service")
    .replace(/\b[Cc]loud subscription routing\b/g, "subscription routing")
    .replace(/\b[9]Router Local\b/g, "subscriptions")
    .replace(/\b[9]Router\b/g, "subscriptions")
    .replace(/\s+at\s+https?:\/\/(?:127\.0\.0\.1|localhost):20128(?:\/[^\s.]*)?/gi, "")
    .replace(/\bhttps?:\/\/(?:127\.0\.0\.1|localhost):20128(?:\/[^\s.]*)?/gi, "Subscriptions")
    .replace(/\b(from|in) subscriptions settings\b/gi, "$1 Subscriptions settings")
    .replace(/\bStart subscriptions, then retry\b/g, "Open Subscriptions, then retry")
    .replace(/\bsubscription helper\b/gi, "subscriptions");
}

function chooseNineRouterModel(savedModel: string, catalog: NineRouterModelCatalogState) {
  const normalizedSavedModel = savedModel.trim();
  if (catalog.status === "ready" && catalog.models.length > 0) {
    return normalizedSavedModel && catalog.models.includes(normalizedSavedModel) ? normalizedSavedModel : catalog.models[0];
  }

  return normalizedSavedModel || getDefaultModelForProvider(NINE_ROUTER_PROVIDER_ID);
}

function formatSubscriptionRouteSummary(model: string) {
  const routeSource = getModelRouteSourceInfo(NINE_ROUTER_PROVIDER_ID, model);
  const option = getChatModelOption(model, NINE_ROUTER_PROVIDER_ID);
  const label = option?.label || model;

  return `${routeSource.sourceLabel} - ${label}`;
}

function formatSubscriptionRouteCapabilities(model: string) {
  return formatModelCapabilitySummary(getChatModelOption(model, NINE_ROUTER_PROVIDER_ID));
}

function formatConnectionStatus(connection: NineRouterConnection | null | undefined, catalog: NineRouterConnectionCatalogState) {
  if (catalog.status === "loading") {
    return "Checking";
  }

  if (!connection) {
    return catalog.status === "error" ? catalog.message : "Not connected";
  }

  if (isConnectionActive(connection)) {
    return "Connected";
  }

  return connection.lastError ? "Needs attention" : connection.testStatus || "Connected";
}

function formatUsagePlan(usageState: NineRouterUsageState | undefined, connection: NineRouterConnection | null | undefined) {
  if (!connection) {
    return "Sign in to view";
  }

  const plan = usageState?.usage?.plan?.trim() || connection.providerSpecificData?.chatgptPlanType?.trim();

  if (plan) {
    return titleCaseProviderText(plan);
  }

  if (usageState?.status === "loading") {
    return "Checking usage";
  }

  if (usageState?.status === "error") {
    return "Usage unavailable";
  }

  return "Connected";
}

function formatUsageHeadline(usage: NineRouterUsagePayload) {
  if (usage.message?.trim()) {
    return usage.message.trim();
  }

  if (usage.plan?.trim()) {
    return titleCaseProviderText(usage.plan);
  }

  const quotaCount = getUsageQuotaEntries(usage).length;
  if (quotaCount > 0) {
    return `${quotaCount} usage ${quotaCount === 1 ? "window" : "windows"}`;
  }

  return "Usage loaded";
}

function getUsageQuotaEntries(usage: NineRouterUsagePayload | undefined) {
  return Object.entries(usage?.quotas ?? {}).filter(([, quota]) => Boolean(quota)) as Array<[string, NineRouterUsageQuota]>;
}

function formatQuotaLabel(key: string, quota: NineRouterUsageQuota) {
  const displayName = quota.displayName?.trim();
  if (displayName) {
    return titleCaseProviderText(displayName);
  }

  const normalizedKey = key.trim().toLowerCase().replace(/[.\-\s/]+/g, "_");
  const labels: Record<string, string> = {
    codex_spark_session: "GPT-5.3 Spark 5-hour window",
    codex_spark_weekly: "GPT-5.3 Spark weekly window",
    gpt_5_3_codex_spark: "GPT-5.3 Spark",
    gpt_5_3_codex_spark_5h: "GPT-5.3 Spark 5-hour window",
    gpt_5_3_codex_spark_session: "GPT-5.3 Spark 5-hour window",
    gpt_5_3_codex_spark_week: "GPT-5.3 Spark weekly window",
    gpt_5_3_codex_spark_weekly: "GPT-5.3 Spark weekly window",
    review_session: "Review 5-hour window",
    review_weekly: "Review weekly window",
    session: "5-hour window",
    spark_5h: "GPT-5.3 Spark 5-hour window",
    spark_session: "GPT-5.3 Spark 5-hour window",
    spark_week: "GPT-5.3 Spark weekly window",
    spark_weekly: "GPT-5.3 Spark weekly window",
    weekly: "Weekly window",
  };

  return labels[normalizedKey] ?? titleCaseProviderText(key);
}

function formatQuotaValue(quota: NineRouterUsageQuota) {
  if (quota.unlimited) {
    return "Unlimited";
  }

  const used = typeof quota.used === "number" ? quota.used : null;
  const total = typeof quota.total === "number" ? quota.total : null;
  const remaining = typeof quota.remaining === "number" ? quota.remaining : null;

  if (used !== null && total !== null) {
    return `${formatQuotaNumber(used)} / ${formatQuotaNumber(total)} used`;
  }

  if (remaining !== null && total !== null) {
    return `${formatQuotaNumber(remaining)} / ${formatQuotaNumber(total)} left`;
  }

  if (typeof quota.remainingPercentage === "number") {
    return `${Math.round(quota.remainingPercentage)}% left`;
  }

  return "Usage reported";
}

function getQuotaUsedPercent(quota: NineRouterUsageQuota) {
  if (quota.unlimited) {
    return 0;
  }

  if (typeof quota.used === "number" && typeof quota.total === "number" && quota.total > 0) {
    return clampPercent((quota.used / quota.total) * 100);
  }

  if (typeof quota.remaining === "number" && typeof quota.total === "number" && quota.total > 0) {
    return clampPercent(((quota.total - quota.remaining) / quota.total) * 100);
  }

  if (typeof quota.remainingPercentage === "number") {
    return clampPercent(100 - quota.remainingPercentage);
  }

  return 0;
}

function formatQuotaReset(quota: NineRouterUsageQuota) {
  if (!quota.resetAt) {
    return quota.unlimited ? "No reset needed" : "Reset not reported";
  }

  const resetAt = new Date(quota.resetAt);
  if (Number.isNaN(resetAt.getTime())) {
    return "Reset not reported";
  }

  const diffMs = resetAt.getTime() - Date.now();
  if (diffMs <= 0) {
    return "Reset due now";
  }

  const hours = Math.floor(diffMs / 3_600_000);
  const minutes = Math.round((diffMs % 3_600_000) / 60_000);
  if (hours >= 24) {
    const days = Math.ceil(diffMs / 86_400_000);
    return `Resets in ${days}d`;
  }

  if (hours > 0) {
    return `Resets in ${hours}h ${minutes}m`;
  }

  return `Resets in ${Math.max(minutes, 1)}m`;
}

function formatQuotaNumber(value: number) {
  return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(1);
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function titleCaseProviderText(value: string) {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (["api", "gpt", "ide", "qwen"].includes(lower)) {
        return part.toUpperCase();
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function createCloudNineRouterStatus(dashboardUrl: string, baseUrl: string): NineRouterLocalStatus {
  return {
    autoStartEnabled: true,
    baseUrl,
    built: true,
    dashboardUrl,
    installed: true,
    launchSupported: false,
    launched: true,
    message: "Subscription routing is ready.",
    running: true,
  };
}

async function waitForCodexConnection(dashboardUrl: string, state: string, _runId: number) {
  for (let attempt = 0; attempt < NINE_ROUTER_CODEX_MAX_POLL_ATTEMPTS; attempt += 1) {
    const payload = await fetchNineRouterJson<NineRouterCodexPollResponse>(createNineRouterUrl(dashboardUrl, "/api/oauth/codex/poll-status", {
      state,
    }));

    if (payload.status === "done") {
      return payload;
    }

    if (payload.status === "error") {
      throw new Error(payload.error || "Codex sign-in failed.");
    }

    await delay(NINE_ROUTER_CODEX_POLL_INTERVAL_MS);
  }

  throw new Error("Codex sign-in timed out. Try again from Subscriptions settings.");
}

async function stopCodexOAuthProxy() {
  try {
    await fetchNineRouterJson<{ success?: boolean }>(createNineRouterUrl(NINE_ROUTER_DASHBOARD_FALLBACK, "/api/oauth/codex/stop-proxy"));
  } catch {
    // The proxy may not be running yet.
  }
}

function delay(ms: number) {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

async function fetchNineRouterJson<T>(url: string) {
  const response = await fetchWithTimeout(url, { method: "GET" });
  const payload = await readJsonResponse<T & { error?: { message?: string } }>(response);

  if (!response.ok) {
    throw new Error(payload.error?.message || `Subscription request failed with HTTP ${response.status}.`);
  }

  return payload;
}

async function postNineRouterJson<T>(url: string, body: unknown) {
  const response = await fetchWithTimeout(url, {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const payload = await readJsonResponse<T & { error?: { message?: string } | string }>(response);

  if (!response.ok) {
    const error = payload.error;
    throw new Error(typeof error === "string" ? error : error?.message || `Subscription request failed with HTTP ${response.status}.`);
  }

  return payload;
}

async function putNineRouterJson<T>(url: string, body: unknown) {
  const response = await fetchWithTimeout(url, {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
    },
    method: "PUT",
  });
  const payload = await readJsonResponse<T & { error?: { message?: string } | string }>(response);

  if (!response.ok) {
    const error = payload.error;
    throw new Error(typeof error === "string" ? error : error?.message || `Subscription request failed with HTTP ${response.status}.`);
  }

  return payload;
}

async function deleteNineRouterConnection(dashboardUrl: string, connectionId: string) {
  const response = await fetchWithTimeout(joinLocalUrl(dashboardUrl, `/api/providers/${encodeURIComponent(connectionId)}`), {
    method: "DELETE",
  });
  const payload = await readJsonResponse<{ error?: { message?: string } | string }>(response);

  if (response.status === 404) {
    return;
  }

  if (!response.ok) {
    const error = payload.error;
    throw new Error(typeof error === "string" ? error : error?.message || `Subscription sign-out failed with HTTP ${response.status}.`);
  }
}

async function fetchWithTimeout(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timeoutMs = isNineRouterNativeBridgeUrl(url) ? 10_000 : 60_000;
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  try {
    if (isTauriDesktopRuntime() && isNineRouterNativeBridgeUrl(url)) {
      const nativeResponse = await nineRouterLocalHttp({
        body: normalizeNativeRequestBody(init.body, "The subscriptions bridge"),
        headers: headersToRecord(init.headers),
        method: normalizeNativeRequestMethod(init.method, "The subscriptions bridge"),
        timeoutMs,
        url,
      });

      return new Response(nativeResponse.body, {
        headers: nativeResponse.headers,
        status: nativeResponse.status,
      });
    }

    const requestInit = await withNineRouterCloudAuthHeaders(url, init);
    return await fetch(url, {
      ...requestInit,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Subscriptions did not answer ${url} within ${Math.round(timeoutMs / 1000)} seconds.`);
    }

    const message = error instanceof Error ? error.message : String(error);
    if (/failed to fetch|load failed|networkerror|request failed|connection refused|could not connect/i.test(message)) {
      throw new Error(`Could not reach subscriptions at ${url}. Open Subscriptions, then retry.`);
    }

    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();

  if (!text) {
    return {} as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return {} as T;
  }
}

function joinLocalUrl(baseUrl: string, path: string) {
  const normalizedBase = baseUrl.trim().replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  return `${normalizedBase}${normalizedPath}`;
}

function createNineRouterUrl(baseUrl: string, path: string, params?: Record<string, string>) {
  const url = new URL(joinLocalUrl(baseUrl, path));

  Object.entries(params ?? {}).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  return url.toString();
}

function formatNineRouterUiError(model: string, providerMessage: string | undefined, status: number) {
  const credentialMatch = providerMessage?.match(/No active credentials for provider:\s*([a-z0-9_-]+)/i);

  if (credentialMatch) {
    const providerName = formatNineRouterProviderName(credentialMatch[1]);

    if (model === "free-combo" || model === NINE_ROUTER_SMART_SAVER_MODEL || model === NINE_ROUTER_ALWAYS_FREE_MODEL) {
      return `Free Auto routing is falling through to ${providerName}, but ${providerName} is not connected.`;
    }

    return `${providerName} is not connected for ${model}.`;
  }

  if (status === 404 && (model === "free-combo" || model === NINE_ROUTER_SMART_SAVER_MODEL || model === NINE_ROUTER_ALWAYS_FREE_MODEL)) {
    return "Free Auto routing is not available in the local subscription catalog.";
  }

  return providerMessage || `Subscription request failed with HTTP ${status}.`;
}

function formatNineRouterProviderName(providerId: string) {
  const labels: Record<string, string> = {
    bazaarlink: "BazaarLink",
    claude: "Claude Code",
    codex: "Codex",
    freetheai: "FreeTheAI",
    github: "GitHub Copilot",
    kiro: "Kiro",
    openai: "OpenAI",
    opencode: "OpenCode Free",
    vertex: "Vertex AI",
  };

  return labels[providerId.toLowerCase()] ?? providerId;
}
