import { CloudSun, Database, RotateCcw, ServerCog, Settings2, Trash2 } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "../../components/dialogs/AppDialog";
import "../../styles/settings.css";
import {
  beginGithubDeviceLogin,
  disconnectGithub,
  getDefaultGithubOAuthClientId,
  getDefaultGithubOAuthScope,
  getGithubState,
  getMissingRequiredGithubOAuthScopes,
  getRequiredGithubOAuthScopes,
  githubDesktopAvailable,
  listGithubRepositories,
  openGithubDeviceLogin,
  pollGithubDeviceLogin,
} from "../../app/githubClient";
import {
  diagnoseWorkspaceDependencies,
  getUserConfigInfo,
  openUserConfig,
  reinstallWorkspaceDependencies,
  type UserConfigInfo,
  type WorkspaceDependencyDiagnostic,
} from "../../app/tauriClient";
import { defaultProviderSettings, loadGithubOAuthClientId, saveGithubOAuthClientId } from "../../lib/appStorage";
import {
  buildProviderModelOptions,
  filterEnabledProviderModelOptions,
  getDefaultModelForProvider,
  getModelProvider,
  getProviderApiKey,
  getProviderBaseUrl,
  prefersLiveModelCatalog,
  usesLiveModelCatalog,
  type ProviderModelMetadata,
} from "../../lib/models";
import {
  filterModelOptionsForBillingTier,
  getBillingPlanAccessDecision,
  getBillingPlanTier,
  getDefaultAllowedModelForProvider,
  getDefaultProviderForBillingTier,
  isProviderAvailableForBillingTier,
} from "../../lib/subscriptionTiers";
import { fetchProviderModels, validateProviderSettings } from "../../services/modelProviderClient";
import type { GithubConnectionState, GithubDeviceLoginSession, GithubRepository } from "../../types/github";
import type { LocalPermissionMode, LocalWorkspaceScope, LocalWorkspaceSettings } from "../../types/localWorkspace";
import type { ModelProviderId, ProviderSettings } from "../../types/settings";
import { BrowserSettingsPage } from "./browser/BrowserSettingsPage";
import { BraveSearchSettingsPage } from "./brave-search/BraveSearchSettingsPage";
import { SettingsSectionHeading } from "./components/SettingsSectionHeading";
import { MapboxSettingsPage } from "./mapbox/MapboxSettingsPage";
import { MobilePairingSettingsPage } from "./mobile/MobilePairingSettingsPage";
import { NineRouterSettingsPage } from "./nine-router/NineRouterSettingsPage";
import { AppearanceSettingsPage } from "./sections/AppearanceSettingsPage";
import { BillingPlansSettingsPage } from "./sections/BillingPlansSettingsPage";
import { ConfigurationSettingsPage } from "./sections/ConfigurationSettingsPage";
import { DatabaseSettingsPage } from "./sections/DatabaseSettingsPage";
import { DiscordSettingsPage } from "./sections/DiscordSettingsPage";
import { GeneralSettingsPage } from "./sections/GeneralSettingsPage";
import { GithubSettingsPage } from "./sections/GithubSettingsPage";
import { GoogleSettingsPage } from "./sections/GoogleSettingsPage";
import { KeysSettingsPage } from "./sections/KeysSettingsPage";
import { ModelSettingsPage } from "./sections/ModelSettingsPage";
import { PdfSettingsPage } from "./sections/PdfSettingsPage";
import { PersonalizationSettingsPage } from "./sections/PersonalizationSettingsPage";
import { ProvidersSettingsPage } from "./sections/ProvidersSettingsPage";
import { UsageSettingsPage } from "./sections/UsageSettingsPage";
import { resolveSettingsNavSection } from "./settingsNavigation";
import type { LiveModelCatalogStatus, SettingsPageProps, SettingsSectionId, SettingsStatusMessage } from "./types";
import { WeatherSourcesSettingsPage } from "./weather-sources/WeatherSourcesSettingsPage";

const GITHUB_FULL_ACCESS_SCOPES = getRequiredGithubOAuthScopes();
type GithubActionState = "disconnect" | "idle" | "login" | "refresh";
const GITHUB_DEVICE_LOGIN_START_TIMEOUT_MS = 18_000;
const EMPTY_DISABLED_MODELS: string[] = [];

export function preloadSettingsSection(section: SettingsSectionId) {
  resolveSettingsNavSection(section);
  return Promise.resolve();
}

function isOfflineCatalogError(error: string | null | undefined) {
  const normalizedError = error?.toLowerCase().trim();

  if (!normalizedError) {
    return true;
  }

  return ["failed to fetch", "fetch failed", "networkerror", "load failed", "connection refused", "err_connection", "err_network"].some((offlineSignal) =>
    normalizedError.includes(offlineSignal),
  );
}

function formatOfflineCatalogStatus(providerLabel: string, baseUrl: string) {
  return `Offline. Start ${providerLabel} and check ${baseUrl.replace(/\/+$/, "")}.`;
}

function formatLiveCatalogStatus(providerLabel: string, baseUrl: string, status: LiveModelCatalogStatus, error: string | null, modelCount: number) {
  const modelsUrl = `${baseUrl.replace(/\/+$/, "")}/models`;

  if (status === "loading") {
    return `Loading real models from ${modelsUrl}`;
  }

  if (status === "ready") {
    return modelCount > 0 ? `${modelCount} model${modelCount === 1 ? "" : "s"} loaded from ${modelsUrl}` : `${providerLabel} is reachable but returned no loaded models.`;
  }

  if (status === "error") {
    return isOfflineCatalogError(error) ? formatOfflineCatalogStatus(providerLabel, baseUrl) : error || `No model list from ${modelsUrl}. Start ${providerLabel} or check the host and port.`;
  }

  return `Start ${providerLabel} to load its real model list.`;
}

function SettingsPageComponent({
  activeSection,
  appearanceMode,
  appearanceSettings,
  appInfo,
  discordBridge,
  generalSettings,
  localWorkspace,
  onActiveSectionChange,
  onActivateProvider,
  onAppearanceModeChange,
  onAppearanceSettingsChange,
  onDiscordBridgeChange,
  onGeneralSettingsChange,
  onLocalWorkspaceChange,
  onPersonalizationChange,
  onSettingsChange,
  onSubscriptionSandboxUninstalled,
  personalization,
  projects,
  settings,
}: SettingsPageProps) {
  const mountedRef = useRef(true);
  const githubDeviceRunRef = useRef(0);
  const githubDeviceTimerRef = useRef<number | null>(null);
  const modelCatalogRunRef = useRef(0);
  const validationRunRef = useRef(0);
  const [showKey, setShowKey] = useState(false);
  const [clearKeyConfirmOpen, setClearKeyConfirmOpen] = useState(false);
  const [githubDisconnectConfirmOpen, setGithubDisconnectConfirmOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [githubActionState, setGithubActionState] = useState<GithubActionState>("idle");
  const [githubConnection, setGithubConnection] = useState<GithubConnectionState>({ connected: false, pluginInstalled: false, scopes: [] });
  const [githubDeviceLogin, setGithubDeviceLogin] = useState<GithubDeviceLoginSession | null>(null);
  const [githubDevicePolling, setGithubDevicePolling] = useState(false);
  const [githubOauthClientId, setGithubOauthClientId] = useState(() => loadGithubOAuthClientId(getDefaultGithubOAuthClientId()));
  const [githubRepos, setGithubRepos] = useState<GithubRepository[]>([]);
  const [githubStatus, setGithubStatus] = useState<SettingsStatusMessage | null>(null);
  const [liveProviderModels, setLiveProviderModels] = useState<ProviderModelMetadata[] | undefined>();
  const [liveProviderModelError, setLiveProviderModelError] = useState<string | null>(null);
  const [liveProviderModelStatus, setLiveProviderModelStatus] = useState<LiveModelCatalogStatus>("idle");
  const [configInfo, setConfigInfo] = useState<UserConfigInfo | null>(null);
  const [configStatus, setConfigStatus] = useState<SettingsStatusMessage | null>(null);
  const [dependencyDiagnostic, setDependencyDiagnostic] = useState<WorkspaceDependencyDiagnostic | null>(null);
  const [dependencyBusy, setDependencyBusy] = useState<"diagnose" | "reinstall" | null>(null);
  const [dependencyStatus, setDependencyStatus] = useState<SettingsStatusMessage | null>(null);
  const [testStatus, setTestStatus] = useState<SettingsStatusMessage | null>(null);
  const [testing, setTesting] = useState(false);
  const activeProvider = useMemo(() => getModelProvider(settings.provider), [settings.provider]);
  const activeProviderApiKey = getProviderApiKey(settings);
  const activeProviderBaseUrl = getProviderBaseUrl(settings);
  const activeProviderUsesLiveCatalog = usesLiveModelCatalog(settings.provider);
  const activeProviderPrefersLiveCatalog = prefersLiveModelCatalog(settings.provider);
  const billingTier = getBillingPlanTier(settings.billingPlan);
  const activeProviderAllModelsRaw = useMemo(
    () => buildProviderModelOptions(settings.provider, activeProviderUsesLiveCatalog ? liveProviderModels : undefined, settings.model),
    [activeProviderUsesLiveCatalog, liveProviderModels, settings.model, settings.provider],
  );
  const activeProviderAllModels = useMemo(
    () => filterModelOptionsForBillingTier(billingTier, activeProviderAllModelsRaw),
    [activeProviderAllModelsRaw, billingTier],
  );
  const activeProviderDisabledModels = settings.disabledModels[settings.provider] ?? EMPTY_DISABLED_MODELS;
  const activeProviderModels = useMemo(
    () => filterEnabledProviderModelOptions(activeProviderAllModels, activeProviderDisabledModels),
    [activeProviderAllModels, activeProviderDisabledModels],
  );
  const liveProviderModelCount = settings.provider === "openrouter" ? activeProviderAllModels.length : (liveProviderModels?.length ?? 0);
  const githubRequestedScope = getDefaultGithubOAuthScope();
  const missingGithubScopes = useMemo(() => getMissingGithubFullAccessScopes(githubConnection), [githubConnection]);
  const hasFullGithubAccess = githubConnection.connected && missingGithubScopes.length === 0;
  const displaySection = resolveSettingsNavSection(activeSection);
  const githubStartingLogin = githubActionState === "login";
  const githubCheckingAccess = githubActionState === "refresh";
  const githubDisconnecting = githubActionState === "disconnect";
  const liveProviderModelStatusText = useMemo(
    () => formatLiveCatalogStatus(activeProvider.label, activeProviderBaseUrl, liveProviderModelStatus, liveProviderModelError, liveProviderModelCount),
    [activeProvider.label, activeProviderBaseUrl, liveProviderModelError, liveProviderModelCount, liveProviderModelStatus],
  );
  const githubAccountDetail = githubConnection.connected ? formatGithubAccountDetail(githubConnection) : "";

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      githubDeviceRunRef.current += 1;
      clearGithubDeviceTimer();
      modelCatalogRunRef.current += 1;
      validationRunRef.current += 1;
    };
  }, []);

  useEffect(() => {
    const decision = getBillingPlanAccessDecision(billingTier, settings.provider, settings.model);

    if (decision.allowed) {
      return;
    }

    const fallbackProvider = getDefaultProviderForBillingTier(billingTier);
    const fallbackModel = getDefaultAllowedModelForProvider(billingTier, fallbackProvider) ?? getDefaultModelForProvider(fallbackProvider);

    onSettingsChange({
      ...settings,
      disabledModels: {
        ...settings.disabledModels,
        [fallbackProvider]: (settings.disabledModels[fallbackProvider] ?? []).filter((model) => model !== fallbackModel),
      },
      model: fallbackModel,
      provider: fallbackProvider,
      providerModels: {
        ...settings.providerModels,
        [settings.provider]: settings.model,
        [fallbackProvider]: fallbackModel,
      },
    });
  }, [billingTier, onSettingsChange, settings]);

  useEffect(() => {
    let disposed = false;

    void getUserConfigInfo()
      .then((info) => {
        if (disposed) {
          return;
        }

        setConfigInfo(info);
        if (info.hasDeprecatedHooksFlag) {
          setConfigStatus({ kind: "warning", text: info.message });
        }
      })
      .catch((error) => {
        if (!disposed) {
          setConfigStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not load config.toml status." });
        }
      });

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!githubDesktopAvailable()) {
      setGithubStatus({ kind: "error", text: "Open the desktop app to connect GitHub." });
      return;
    }

    void refreshGithubConnection({ quiet: true });
  }, []);

  useEffect(() => {
    if (!activeProviderUsesLiveCatalog) {
      setLiveProviderModels(undefined);
      setLiveProviderModelError(null);
      setLiveProviderModelStatus("idle");
      return;
    }

    const controller = new AbortController();
    const modelCatalogRun = modelCatalogRunRef.current + 1;
    const settingsSnapshot = settings;

    modelCatalogRunRef.current = modelCatalogRun;
    setLiveProviderModelError(null);
    setLiveProviderModelStatus("loading");

    void fetchProviderModels(settingsSnapshot, { signal: controller.signal })
      .then((models) => {
        if (!mountedRef.current || controller.signal.aborted || modelCatalogRunRef.current !== modelCatalogRun) {
          return;
        }

        setLiveProviderModels(models);
        setLiveProviderModelStatus("ready");
      })
      .catch((error) => {
        if (!mountedRef.current || controller.signal.aborted || modelCatalogRunRef.current !== modelCatalogRun) {
          return;
        }

        setLiveProviderModelError(error instanceof Error ? error.message : `Could not load ${activeProvider.label} models.`);
        setLiveProviderModelStatus("error");
      });

    return () => controller.abort();
  }, [activeProvider.label, activeProviderBaseUrl, activeProviderApiKey, activeProviderUsesLiveCatalog, settings.provider]);

  function updateSettings(nextSettings: Partial<ProviderSettings>) {
    validationRunRef.current += 1;
    setTesting(false);
    setTestStatus(null);
    onSettingsChange({
      ...settings,
      ...nextSettings,
    });
  }

  function clearGithubDeviceTimer() {
    if (githubDeviceTimerRef.current !== null) {
      window.clearTimeout(githubDeviceTimerRef.current);
      githubDeviceTimerRef.current = null;
    }
  }

  function updateGithubOauthClientId(clientId: string) {
    setGithubOauthClientId(clientId);
    saveGithubOAuthClientId(clientId);
    setGithubStatus(null);
  }

  function scheduleGithubDevicePoll(session: GithubDeviceLoginSession, clientId: string, runId: number, intervalSeconds: number) {
    clearGithubDeviceTimer();
    githubDeviceTimerRef.current = window.setTimeout(() => {
      void pollGithubDeviceLoginSession(session, clientId, runId, intervalSeconds);
    }, Math.max(intervalSeconds, 1) * 1000);
  }

  async function pollGithubDeviceLoginSession(session: GithubDeviceLoginSession, clientId: string, runId: number, intervalSeconds: number) {
    if (!mountedRef.current || githubDeviceRunRef.current !== runId) {
      return;
    }

    try {
      const result = await pollGithubDeviceLogin({
        clientId,
        deviceCode: session.deviceCode,
      });

      if (!mountedRef.current || githubDeviceRunRef.current !== runId) {
        return;
      }

      if (result.status === "authorized" && result.connection) {
        clearGithubDeviceTimer();
        setGithubConnection(result.connection);
        setGithubDeviceLogin(null);
        setGithubDevicePolling(false);

        try {
          const repositories = await listGithubRepositories({ perPage: 6, sort: "updated" });

          if (!mountedRef.current || githubDeviceRunRef.current !== runId) {
            return;
          }

          setGithubRepos(repositories);
          setGithubStatus({ kind: "success", text: `Connected as ${result.connection.user?.login ?? "GitHub"}.` });
        } catch (error) {
          if (mountedRef.current && githubDeviceRunRef.current === runId) {
            setGithubRepos([]);
            setGithubStatus({
              kind: "success",
              text: `Connected as ${result.connection.user?.login ?? "GitHub"}. Repository preview could not load yet.`,
            });
          }
        }

        return;
      }

      if (result.status === "pending" || result.status === "slowDown") {
        const nextInterval = result.interval ?? (result.status === "slowDown" ? intervalSeconds + 5 : intervalSeconds);
        setGithubStatus({
          kind: "success",
          text: result.status === "slowDown" ? "GitHub asked us to slow down. Keep the browser sign-in open." : `Waiting for GitHub authorization for code ${session.userCode}.`,
        });
        scheduleGithubDevicePoll(session, clientId, runId, nextInterval);
        return;
      }

      clearGithubDeviceTimer();
      setGithubDeviceLogin(null);
      setGithubDevicePolling(false);
      setGithubStatus({
        kind: "error",
        text: result.error || result.message || "GitHub browser login failed.",
      });
    } catch (error) {
      if (mountedRef.current && githubDeviceRunRef.current === runId) {
        clearGithubDeviceTimer();
        setGithubDeviceLogin(null);
        setGithubDevicePolling(false);
        setGithubStatus({ kind: "error", text: error instanceof Error ? error.message : "GitHub browser login failed." });
      }
    }
  }

  async function startGithubBrowserLogin() {
    if (!githubDesktopAvailable()) {
      setGithubStatus({ kind: "error", text: "GitHub browser login is available in the desktop app." });
      return;
    }

    const clientId = githubOauthClientId.trim();

    if (!clientId) {
      setGithubStatus({ kind: "error", text: "Paste a GitHub OAuth App Client ID first, or use Create OAuth App in the OAuth card." });
      return;
    }

    saveGithubOAuthClientId(clientId);
    githubDeviceRunRef.current += 1;
    const runId = githubDeviceRunRef.current;

    clearGithubDeviceTimer();
    setGithubActionState("login");
    setGithubDeviceLogin(null);
    setGithubDevicePolling(false);
    setGithubStatus({ kind: "warning", text: "Contacting GitHub to start browser sign-in..." });

    try {
      const session = await withTimeout(
        beginGithubDeviceLogin({ clientId }),
        GITHUB_DEVICE_LOGIN_START_TIMEOUT_MS,
        "GitHub browser login did not start in time. Check your internet connection, confirm Device Flow is enabled on the OAuth App, then try again.",
      );

      if (!mountedRef.current || githubDeviceRunRef.current !== runId) {
        return;
      }

      setGithubDeviceLogin(session);
      setGithubDevicePolling(true);
      setGithubStatus({ kind: "success", text: `Your GitHub code is ${session.userCode}. Enter it in the browser to finish signing in.` });
      scheduleGithubDevicePoll(session, clientId, runId, session.interval);

      if (navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(session.userCode).then(() => {
          if (mountedRef.current && githubDeviceRunRef.current === runId) {
            setGithubStatus({ kind: "success", text: `Your GitHub code is ${session.userCode}. It was copied for the browser.` });
          }
        }).catch(() => {});
      }

      try {
        await openGithubDeviceLogin(session.verificationUri);
      } catch {
        if (mountedRef.current && githubDeviceRunRef.current === runId) {
          setGithubStatus({
            kind: "success",
            text: `Your GitHub code is ${session.userCode}. Open ${session.verificationUri} and enter it to finish signing in.`,
          });
        }
      }
    } catch (error) {
      if (mountedRef.current && githubDeviceRunRef.current === runId) {
        setGithubDevicePolling(false);
        setGithubStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not start GitHub browser login." });
      }
    } finally {
      if (mountedRef.current && githubDeviceRunRef.current === runId) {
        setGithubActionState((current) => (current === "login" ? "idle" : current));
      }
    }
  }

  function cancelGithubBrowserLogin() {
    githubDeviceRunRef.current += 1;
    clearGithubDeviceTimer();
    setGithubDeviceLogin(null);
    setGithubDevicePolling(false);
    setGithubStatus({ kind: "error", text: "GitHub browser login canceled." });
  }

  async function copyGithubUserCode() {
    if (!githubDeviceLogin) {
      return;
    }

    try {
      await navigator.clipboard.writeText(githubDeviceLogin.userCode);
      setGithubStatus({ kind: "success", text: `GitHub code ${githubDeviceLogin.userCode} copied.` });
    } catch {
      setGithubStatus({ kind: "error", text: `Could not copy the GitHub code. Enter ${githubDeviceLogin.userCode} manually.` });
    }
  }

  async function refreshGithubConnection(options: { quiet?: boolean } = {}) {
    if (!githubDesktopAvailable()) {
      setGithubStatus({ kind: "error", text: "GitHub is available in the desktop app." });
      return;
    }

    setGithubActionState("refresh");

    try {
      const connection = await getGithubState();

      if (!mountedRef.current) {
        return;
      }

      setGithubConnection(connection);

      if (connection.connected) {
        try {
          const repositories = await listGithubRepositories({ perPage: 6, sort: "updated" });

          if (!mountedRef.current) {
            return;
          }

          setGithubRepos(repositories);
          setGithubStatus(options.quiet ? null : { kind: "success", text: `Connected as ${connection.user?.login ?? "GitHub"}. Repository access works.` });
        } catch (error) {
          if (!mountedRef.current) {
            return;
          }

          setGithubRepos([]);
          setGithubStatus({
            kind: "error",
            text: `Signed in as ${connection.user?.login ?? "GitHub"}, but repository access failed: ${error instanceof Error ? error.message : "unknown GitHub error"}`,
          });
        }
      } else {
        setGithubRepos([]);
        setGithubStatus(options.quiet ? null : { kind: "error", text: "GitHub is not connected." });
      }
    } catch (error) {
      if (mountedRef.current) {
        setGithubRepos([]);
        setGithubStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not load GitHub connection." });
      }
    } finally {
      if (mountedRef.current) {
        setGithubActionState((current) => (current === "refresh" ? "idle" : current));
      }
    }
  }

  function selectProvider(provider: ModelProviderId) {
    if (!isProviderAvailableForBillingTier(billingTier, provider)) {
      setTestStatus({ kind: "warning", text: "Upgrade to Plus to use hosted API provider routes." });
      return;
    }

    const rememberedModel = settings.providerModels[provider]?.trim();
    const providerDisabledModels = new Set(settings.disabledModels[provider] ?? []);
    const allowedRememberedModel =
      rememberedModel && !providerDisabledModels.has(rememberedModel) && getBillingPlanAccessDecision(billingTier, provider, rememberedModel).allowed
        ? rememberedModel
        : "";
    const nextModel = allowedRememberedModel || getDefaultAllowedModelForProvider(billingTier, provider) || getDefaultModelForProvider(provider);
    providerDisabledModels.delete(nextModel);
    const nextDisabledModels = {
      ...settings.disabledModels,
      [provider]: [...providerDisabledModels],
    };

    if (providerDisabledModels.size === 0) {
      delete nextDisabledModels[provider];
    }

    updateSettings({
      disabledModels: nextDisabledModels,
      model: nextModel,
      provider,
      providerModels: {
        ...settings.providerModels,
        [settings.provider]: settings.model,
        [provider]: nextModel,
      },
    });
    setShowKey(false);
  }

  function updateActiveProviderApiKey(apiKey: string) {
    updateSettings({
      apiKeys: {
        ...settings.apiKeys,
        [settings.provider]: apiKey,
      },
      openRouterApiKey: settings.provider === "openrouter" ? apiKey : settings.openRouterApiKey,
    });
  }

  function updateActiveProviderBaseUrl(baseUrl: string) {
    updateSettings({
      baseUrls: {
        ...settings.baseUrls,
        [settings.provider]: baseUrl,
      },
    });
  }

  function updateActiveProviderModel(model: string) {
    const normalizedModel = model.trim();
    const accessDecision = getBillingPlanAccessDecision(billingTier, settings.provider, normalizedModel);

    if (!accessDecision.allowed) {
      setTestStatus({ kind: "warning", text: accessDecision.reason || "Your current plan does not include this model route." });
      return;
    }

    const disabledValues = (settings.disabledModels[settings.provider] ?? []).filter((value) => value !== normalizedModel);
    const disabledModels = {
      ...settings.disabledModels,
      [settings.provider]: disabledValues,
    };

    if (disabledValues.length === 0) {
      delete disabledModels[settings.provider];
    }

    updateSettings({
      disabledModels,
      model,
      providerModels: {
        ...settings.providerModels,
        [settings.provider]: model,
      },
    });
  }

  function toggleActiveProviderModel(model: string, enabled: boolean) {
    const normalizedModel = model.trim();

    if (!normalizedModel) {
      return;
    }

    const disabledValues = new Set(activeProviderDisabledModels);

    if (enabled) {
      disabledValues.delete(normalizedModel);
    } else {
      disabledValues.add(normalizedModel);
    }

    const nextDisabledValues = [...disabledValues];
    const nextDisabledModels = {
      ...settings.disabledModels,
      [settings.provider]: nextDisabledValues,
    };

    if (nextDisabledValues.length === 0) {
      delete nextDisabledModels[settings.provider];
    }

    const enabledOptions = filterEnabledProviderModelOptions(activeProviderAllModels, nextDisabledValues);
    const nextModel = enabledOptions.some((option) => option.value === settings.model) ? settings.model : enabledOptions[0]?.value || getDefaultModelForProvider(settings.provider);

    updateSettings({
      disabledModels: nextDisabledModels,
      model: nextModel,
      providerModels: {
        ...settings.providerModels,
        [settings.provider]: nextModel,
      },
    });
  }

  function updateLocalWorkspace(patch: Partial<LocalWorkspaceSettings>) {
    onLocalWorkspaceChange({
      ...localWorkspace,
      lastError: undefined,
      ...patch,
    });
  }

  function selectApprovalPolicy(policy: "never" | "on-request" | "untrusted") {
    const permissionMode: LocalPermissionMode = policy === "never" ? "full-access" : policy === "untrusted" ? "default" : "auto-review";
    updateLocalWorkspace({
      enabled: true,
      permissionMode,
      scope: localWorkspace.scope || "current-folder",
    });
  }

  function selectSandboxMode(mode: "danger-full-access" | "read-only" | "workspace-write") {
    const nextScope: LocalWorkspaceScope = mode === "danger-full-access" ? "full-computer" : localWorkspace.scope === "full-computer" ? "current-folder" : localWorkspace.scope;
    const nextPermissionMode: LocalPermissionMode = mode === "read-only" ? "default" : localWorkspace.permissionMode;
    updateLocalWorkspace({
      enabled: true,
      permissionMode: nextPermissionMode,
      scope: nextScope,
    });
  }

  async function handleOpenConfig() {
    setConfigStatus(null);

    try {
      const info = await openUserConfig();
      setConfigInfo(info);
      setConfigStatus({ kind: info.hasDeprecatedHooksFlag ? "warning" : "success", text: info.message });
    } catch (error) {
      setConfigStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not open config.toml." });
    }
  }

  async function handleDiagnoseDependencies() {
    setDependencyBusy("diagnose");
    setDependencyStatus(null);

    try {
      const diagnostic = await diagnoseWorkspaceDependencies();
      setDependencyDiagnostic(diagnostic);
      setDependencyStatus({ kind: diagnostic.status === "success" ? "success" : "error", text: diagnostic.message });
    } catch (error) {
      setDependencyStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not diagnose workspace dependencies." });
    } finally {
      setDependencyBusy(null);
    }
  }

  async function handleReinstallDependencies() {
    setDependencyBusy("reinstall");
    setDependencyStatus(null);

    try {
      const diagnostic = await reinstallWorkspaceDependencies();
      setDependencyDiagnostic(diagnostic);
      setDependencyStatus({
        kind: diagnostic.status === "success" ? "success" : "warning",
        text: diagnostic.message,
      });
    } catch (error) {
      setDependencyStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not reset workspace dependencies." });
    } finally {
      setDependencyBusy(null);
    }
  }

  async function testConnection() {
    const accessDecision = getBillingPlanAccessDecision(billingTier, settings.provider, settings.model);

    if (!accessDecision.allowed) {
      setTestStatus({ kind: "warning", text: accessDecision.reason || "Your current plan does not include this model route." });
      return;
    }

    const validationRun = validationRunRef.current + 1;
    const settingsSnapshot = settings;

    validationRunRef.current = validationRun;
    setTesting(true);
    setTestStatus(null);

    try {
      const message = await validateProviderSettings(settingsSnapshot);

      if (mountedRef.current && validationRunRef.current === validationRun) {
        setTestStatus({ kind: "success", text: message });
      }
    } catch (error) {
      if (mountedRef.current && validationRunRef.current === validationRun) {
        setTestStatus({ kind: "error", text: error instanceof Error ? error.message : `${activeProvider.label} validation failed.` });
      }
    } finally {
      if (mountedRef.current && validationRunRef.current === validationRun) {
        setTesting(false);
      }
    }
  }

  function confirmResetSettings() {
    setTesting(false);
    setTestStatus(null);
    setResetConfirmOpen(false);
    onSettingsChange(defaultProviderSettings);
  }

  function confirmClearApiKey() {
    updateSettings({
      apiKeys: {
        ...settings.apiKeys,
        [settings.provider]: "",
      },
      openRouterApiKey: settings.provider === "openrouter" ? "" : settings.openRouterApiKey,
    });
    setShowKey(false);
    setClearKeyConfirmOpen(false);
  }

  async function confirmDisconnectGithub() {
    githubDeviceRunRef.current += 1;
    clearGithubDeviceTimer();
    setGithubActionState("disconnect");
    setGithubDeviceLogin(null);
    setGithubDevicePolling(false);
    setGithubStatus(null);

    try {
      const connection = await disconnectGithub();

      if (!mountedRef.current) {
        return;
      }

      setGithubConnection(connection);
      setGithubRepos([]);
      setGithubDisconnectConfirmOpen(false);
      setGithubStatus({ kind: "success", text: "GitHub disconnected." });
    } catch (error) {
      if (mountedRef.current) {
        setGithubStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not disconnect GitHub." });
      }
    } finally {
      if (mountedRef.current) {
        setGithubActionState((current) => (current === "disconnect" ? "idle" : current));
      }
    }
  }

  function renderActiveSection() {
    if (displaySection === "general") {
      return (
        <>
          <SettingsSectionHeading detail="Work mode, permissions, app behavior, dictation, notifications, and runtime defaults." icon={Settings2} title="General" />
          <GeneralSettingsPage
            activeProviderLabel={activeProvider.label}
            appInfo={appInfo}
            generalSettings={generalSettings}
            localWorkspace={localWorkspace}
            settings={settings}
            showHeading={false}
            onGeneralSettingsChange={onGeneralSettingsChange}
            onOpenLibraryData={() => onActiveSectionChange("database")}
            onResetSettings={() => setResetConfirmOpen(true)}
            onSelectApprovalPolicy={selectApprovalPolicy}
            onSelectSandboxMode={selectSandboxMode}
            onSettingsPatch={updateSettings}
          />
          <PersonalizationSettingsPage settings={settings} showHeading={false} onSettingsPatch={updateSettings} />
        </>
      );
    }

    if (displaySection === "appearance") {
      return (
        <AppearanceSettingsPage
          appearanceMode={appearanceMode}
          appearanceSettings={appearanceSettings}
          onAppearanceModeChange={onAppearanceModeChange}
          onAppearanceSettingsChange={onAppearanceSettingsChange}
        />
      );
    }

    if (displaySection === "billing") {
      return <BillingPlansSettingsPage settings={settings} onSettingsPatch={updateSettings} />;
    }

    if (displaySection === "configuration") {
      return (
        <ConfigurationSettingsPage
          configInfo={configInfo}
          configStatus={configStatus}
          dependencyBusy={dependencyBusy}
          dependencyDiagnostic={dependencyDiagnostic}
          dependencyStatus={dependencyStatus}
          settings={settings}
          onDiagnoseDependencies={handleDiagnoseDependencies}
          onOpenConfig={handleOpenConfig}
          onReinstallDependencies={handleReinstallDependencies}
          onSettingsPatch={updateSettings}
        />
      );
    }

    if (displaySection === "braveSearch") {
      return <BraveSearchSettingsPage locationServicesEnabled={personalization.locationServicesEnabled} settings={settings} onSettingsPatch={updateSettings} />;
    }

    if (displaySection === "browser") {
      return <BrowserSettingsPage settings={settings} onSettingsPatch={updateSettings} />;
    }

    if (displaySection === "mobile") {
      return <MobilePairingSettingsPage />;
    }

    if (displaySection === "database") {
      return (
        <>
          <SettingsSectionHeading detail="PDF library, local storage, backups, and device data controls." icon={Database} title="Library & Data" />
          <PdfSettingsPage projects={projects} showHeading={false} />
          <DatabaseSettingsPage showHeading={false} />
        </>
      );
    }

    if (displaySection === "github") {
      return (
        <GithubSettingsPage
          accountDetail={githubAccountDetail}
          fullAccessScopes={GITHUB_FULL_ACCESS_SCOPES}
          githubCheckingAccess={githubCheckingAccess}
          githubConnection={githubConnection}
          githubDisconnecting={githubDisconnecting}
          githubDeviceLogin={githubDeviceLogin}
          githubDevicePolling={githubDevicePolling}
          githubOauthClientId={githubOauthClientId}
          githubRepos={githubRepos}
          githubRequestedScope={githubRequestedScope}
          githubStartingLogin={githubStartingLogin}
          githubStatus={githubStatus}
          hasFullGithubAccess={hasFullGithubAccess}
          missingGithubScopes={missingGithubScopes}
          onCancelBrowserLogin={cancelGithubBrowserLogin}
          onCheckAccess={() => refreshGithubConnection()}
          onCopyUserCode={copyGithubUserCode}
          onDisconnect={() => setGithubDisconnectConfirmOpen(true)}
          onStartBrowserLogin={startGithubBrowserLogin}
          onUpdateGithubOauthClientId={updateGithubOauthClientId}
        />
      );
    }

    if (displaySection === "discord") {
      return <DiscordSettingsPage settings={discordBridge} onSettingsChange={onDiscordBridgeChange} />;
    }

    if (displaySection === "google") {
      return <GoogleSettingsPage />;
    }

    if (displaySection === "keys") {
      return <KeysSettingsPage settings={settings} onSettingsChange={onSettingsChange} />;
    }

    if (displaySection === "nineRouter") {
      return <NineRouterSettingsPage settings={settings} onActivateProvider={onActivateProvider} onSettingsChange={onSettingsChange} onSubscriptionSandboxUninstalled={onSubscriptionSandboxUninstalled} />;
    }

    if (displaySection === "usage") {
      return <UsageSettingsPage settings={settings} onSettingsChange={onSettingsChange} />;
    }

    if (displaySection === "model") {
      return (
        <>
          <SettingsSectionHeading detail="Provider credentials, model catalog, system prompt, generation, and reasoning controls." icon={ServerCog} title="AI & Providers" />
          <ProvidersSettingsPage
            activeProvider={activeProvider}
            activeProviderApiKey={activeProviderApiKey}
            activeProviderBaseUrl={activeProviderBaseUrl}
            settings={settings}
            showHeading={false}
            showKey={showKey}
            testing={testing}
            testStatus={testStatus}
            onClearApiKey={() => setClearKeyConfirmOpen(true)}
            onSelectProvider={selectProvider}
            onTestConnection={testConnection}
            onToggleShowKey={() => setShowKey((visible) => !visible)}
            onUpdateActiveProviderApiKey={updateActiveProviderApiKey}
            onUpdateActiveProviderBaseUrl={updateActiveProviderBaseUrl}
          />
          <ModelSettingsPage
            activeProvider={activeProvider}
            activeProviderAllModels={activeProviderAllModels}
            activeProviderDisabledModels={activeProviderDisabledModels}
            activeProviderModels={activeProviderModels}
            activeProviderPrefersLiveCatalog={activeProviderPrefersLiveCatalog}
            activeProviderUsesLiveCatalog={activeProviderUsesLiveCatalog}
            liveProviderModelStatus={liveProviderModelStatus}
            liveProviderModelStatusText={liveProviderModelStatusText}
            settings={settings}
            showHeading={false}
            onSelectProvider={selectProvider}
            onSettingsPatch={updateSettings}
            onToggleActiveProviderModel={toggleActiveProviderModel}
            onUpdateActiveProviderModel={updateActiveProviderModel}
          />
        </>
      );
    }

    if (displaySection === "weatherSources") {
      return (
        <>
          <SettingsSectionHeading detail="Weather source routing, location access, units, radar, and Mapbox rendering." icon={CloudSun} title="Weather & Maps" />
          <WeatherSourcesSettingsPage personalization={personalization} showHeading={false} onPersonalizationChange={onPersonalizationChange} />
          {personalization.locationServicesEnabled ? <MapboxSettingsPage showHeading={false} /> : null}
        </>
      );
    }

    return null;
  }

  return (
    <div className="settings-page">
      <section className="settings-shell" aria-labelledby="settings-section-title" data-section={displaySection}>
        <div className="settings-section-panel" key={displaySection}>
          {renderActiveSection()}
        </div>
      </section>

      <ConfirmDialog
        confirmLabel="Reset settings"
        description="This restores provider, model, generation, and reasoning settings to the defaults."
        icon={RotateCcw}
        open={resetConfirmOpen}
        title="Reset settings?"
        tone="danger"
        onClose={() => setResetConfirmOpen(false)}
        onConfirm={confirmResetSettings}
      />

      <ConfirmDialog
        confirmLabel="Clear key"
        description={`This removes the locally stored ${activeProvider.label} API key from this device.`}
        icon={Trash2}
        open={clearKeyConfirmOpen}
        title="Clear API key?"
        tone="danger"
        onClose={() => setClearKeyConfirmOpen(false)}
        onConfirm={confirmClearApiKey}
      />

      <ConfirmDialog
        confirmLabel="Disconnect"
        description="This removes the stored GitHub token from this device."
        icon={Trash2}
        open={githubDisconnectConfirmOpen}
        title="Disconnect GitHub?"
        tone="danger"
        onClose={() => setGithubDisconnectConfirmOpen(false)}
        onConfirm={confirmDisconnectGithub}
      />
    </div>
  );
}

export const SettingsPage = memo(SettingsPageComponent, areSettingsPagePropsEqual);

function areSettingsPagePropsEqual(previous: SettingsPageProps, next: SettingsPageProps) {
  return (
    previous.activeSection === next.activeSection &&
    previous.appearanceMode === next.appearanceMode &&
    previous.appearanceSettings === next.appearanceSettings &&
    previous.appInfo.name === next.appInfo.name &&
    previous.appInfo.version === next.appInfo.version &&
    previous.appInfo.phase === next.appInfo.phase &&
    previous.appInfo.runtime === next.appInfo.runtime &&
    previous.appInfo.platform === next.appInfo.platform &&
    previous.appInfo.arch === next.appInfo.arch &&
    previous.discordBridge === next.discordBridge &&
    previous.generalSettings === next.generalSettings &&
    previous.localWorkspace === next.localWorkspace &&
    Boolean(previous.onActivateProvider) === Boolean(next.onActivateProvider) &&
    previous.personalization === next.personalization &&
    previous.projects === next.projects &&
    previous.settings === next.settings
  );
}

function formatGithubAccountDetail(connection: GithubConnectionState) {
  const connected = connection.connectedAt ? new Date(connection.connectedAt).toLocaleDateString() : "connected";
  const missingScopes = getMissingGithubFullAccessScopes(connection);
  const scopes = connection.scopes.length > 0 ? connection.scopes.join(", ") : "token permissions";
  const access = missingScopes.length === 0 ? "full GitHub access" : `limited token - ${scopes}`;

  return `${connected} - ${access}`;
}

function getMissingGithubFullAccessScopes(connection: GithubConnectionState) {
  if (!connection.connected) {
    return [];
  }

  return getMissingRequiredGithubOAuthScopes(connection.scopes);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);

    promise
      .then(resolve)
      .catch(reject)
      .finally(() => window.clearTimeout(timeoutId));
  });
}
