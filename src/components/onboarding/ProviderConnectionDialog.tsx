import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ExternalLink, KeyRound, RefreshCcw, Route } from "lucide-react";
import { ensureNineRouterLocal, getNineRouterLocalStatus, isTauriDesktopRuntime, type NineRouterLocalStatus } from "../../app/tauriClient";
import {
  chooseNineRouterModel,
  chooseNineRouterModelForAccount,
  choosePreferredConnection,
  connectNineRouterAccount,
  formatConnectionExpiry,
  formatConnectionIdentity,
  isConnectionActive,
  loadNineRouterConnections,
  loadNineRouterModels,
  NINE_ROUTER_ACCOUNT_PROVIDERS,
  NINE_ROUTER_DASHBOARD_FALLBACK,
  NINE_ROUTER_PROVIDER_ID,
  type NineRouterAccountProvider,
  type NineRouterConnection,
  type NineRouterStatusMessage,
} from "../../services/nineRouterClient";
import { getConfiguredNineRouterBaseUrl, getConfiguredNineRouterDashboardUrl, isConfiguredNineRouterCloudEnabled, isNineRouterCloudRequired, isNineRouterNativeBridgeUrl } from "../../services/nineRouterCloud";
import { getDefaultBaseUrlForProvider, OPENROUTER_AUTO_MODEL, OPENROUTER_FREE_AUTO_MODEL } from "../../lib/models";
import { scheduleIdleTask } from "../../lib/idleTask";
import type { ModelProviderId, ProviderSettings } from "../../types/settings";
import { DialogShell } from "../dialogs/AppDialog";

type ProviderConnectionBusy = "activate-subscriptions" | "fallback" | "refresh" | "start" | `account:${string}` | null;

interface ProviderConnectionDialogProps {
  onActivateProvider: (provider: ModelProviderId, model: string) => void;
  onClose: () => void;
  onNeverShowAgain: () => void;
  onOpenNineRouterSettings: () => void;
  onOpenProviderSettings: () => void;
  open: boolean;
  settings: ProviderSettings;
}

interface AccountRow {
  connection: NineRouterConnection | null;
  connections: NineRouterConnection[];
  provider: NineRouterAccountProvider;
}

export function ProviderConnectionDialog({
  onActivateProvider,
  onClose,
  onNeverShowAgain,
  onOpenNineRouterSettings,
  onOpenProviderSettings,
  open,
  settings,
}: ProviderConnectionDialogProps) {
  const mountedRef = useRef(true);
  const accountConnectRunRef = useRef(0);
  const [busy, setBusy] = useState<ProviderConnectionBusy>(null);
  const [connections, setConnections] = useState<NineRouterConnection[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [runtimeStatus, setRuntimeStatus] = useState<NineRouterLocalStatus | null>(null);
  const [statusMessage, setStatusMessage] = useState<NineRouterStatusMessage | null>(null);
  const configuredCloudSubscriptions = isConfiguredNineRouterCloudEnabled();
  const cloudSubscriptionsRequired = isNineRouterCloudRequired();
  const savedNineRouterBaseUrl = settings.baseUrls[NINE_ROUTER_PROVIDER_ID]?.trim() || "";
  const nineRouterBaseUrl = configuredCloudSubscriptions
    ? getConfiguredNineRouterBaseUrl(savedNineRouterBaseUrl || runtimeStatus?.baseUrl || getDefaultBaseUrlForProvider(NINE_ROUTER_PROVIDER_ID))
    : savedNineRouterBaseUrl || runtimeStatus?.baseUrl || getDefaultBaseUrlForProvider(NINE_ROUTER_PROVIDER_ID);
  const cloudSubscriptionsEnabled = configuredCloudSubscriptions || (!cloudSubscriptionsRequired && !isNineRouterNativeBridgeUrl(nineRouterBaseUrl));
  const cloudSubscriptionsUnavailable = cloudSubscriptionsRequired && !configuredCloudSubscriptions;
  const nineRouterDashboardUrl = cloudSubscriptionsEnabled ? getConfiguredNineRouterDashboardUrl(nineRouterBaseUrl) : runtimeStatus?.dashboardUrl || NINE_ROUTER_DASHBOARD_FALLBACK;
  const savedNineRouterModel = settings.providerModels[NINE_ROUTER_PROVIDER_ID]?.trim() || "";
  const openRouterHasKey = Boolean((settings.apiKeys.openrouter || settings.openRouterApiKey || "").trim());
  const openRouterFallbackModel = openRouterHasKey ? OPENROUTER_AUTO_MODEL : OPENROUTER_FREE_AUTO_MODEL;
  const activeConnectionCount = connections.filter(isConnectionActive).length;
  const connectedAccountCount = connections.length;
  const accountRows = useMemo<AccountRow[]>(
    () => NINE_ROUTER_ACCOUNT_PROVIDERS.map((provider) => {
      const providerConnections = connections.filter((connection) => connection.provider === provider.id);

      return {
        connection: choosePreferredConnection(providerConnections),
        connections: providerConnections,
        provider,
      };
    }),
    [connections],
  );

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      accountConnectRunRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    setStatusMessage(null);
    return scheduleIdleTask(() => {
      void refreshNineRouterState({ quiet: true, start: true });
    }, 700);
  }, [open]);

  async function refreshNineRouterState(options: { quiet?: boolean; start?: boolean } = {}) {
    const runId = accountConnectRunRef.current;
    setBusy((current) => current ?? "refresh");

    try {
      if (cloudSubscriptionsUnavailable) {
        setRuntimeStatus(null);
        setConnections([]);
        setModels([]);
        if (!options.quiet) {
          setStatusMessage({ kind: "warning", text: "Cloud subscription routing is required, but this build does not have a cloud router URL configured." });
        }
        return;
      }

      const nextStatus = cloudSubscriptionsEnabled
        ? createCloudNineRouterStatus(nineRouterDashboardUrl, nineRouterBaseUrl)
        : options.start
          ? await ensureNineRouterLocal()
          : await getNineRouterLocalStatus();

      if (!mountedRef.current || accountConnectRunRef.current !== runId) {
        return;
      }

      setRuntimeStatus(nextStatus);

      if (!nextStatus.running) {
        setConnections([]);
        setModels([]);
        if (!options.quiet) {
          setStatusMessage({ kind: "warning", text: nextStatus.message });
        }
        return;
      }

      const [nextConnections, nextModels] = await Promise.all([
        loadNineRouterConnections(cloudSubscriptionsEnabled ? nineRouterDashboardUrl : nextStatus.dashboardUrl || NINE_ROUTER_DASHBOARD_FALLBACK),
        loadNineRouterModels(cloudSubscriptionsEnabled ? nineRouterBaseUrl : settings.baseUrls[NINE_ROUTER_PROVIDER_ID]?.trim() || nextStatus.baseUrl || getDefaultBaseUrlForProvider(NINE_ROUTER_PROVIDER_ID)),
      ]);

      if (!mountedRef.current || accountConnectRunRef.current !== runId) {
        return;
      }

      setConnections(nextConnections);
      setModels(nextModels);
      if (!options.quiet) {
        setStatusMessage({
          kind: nextConnections.length > 0 ? "success" : "warning",
          text: nextConnections.length > 0 ? `${nextConnections.length} subscription account${nextConnections.length === 1 ? "" : "s"} found.` : "Subscriptions are running with no connected accounts yet.",
        });
      }
    } catch (error) {
      if (mountedRef.current && accountConnectRunRef.current === runId) {
        setStatusMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not check subscriptions." });
      }
    } finally {
      if (mountedRef.current && accountConnectRunRef.current === runId) {
        setBusy((current) => (current === "refresh" ? null : current));
      }
    }
  }

  async function connectAccount(provider: NineRouterAccountProvider) {
    const runId = accountConnectRunRef.current + 1;
    accountConnectRunRef.current = runId;
    setBusy(`account:${provider.id}`);
    setStatusMessage(null);

    try {
      let nextStatus = runtimeStatus;
      if (!nextStatus?.running) {
        nextStatus = cloudSubscriptionsEnabled ? createCloudNineRouterStatus(nineRouterDashboardUrl, nineRouterBaseUrl) : await ensureNineRouterLocal();
        if (!mountedRef.current || accountConnectRunRef.current !== runId) {
          return;
        }
        setRuntimeStatus(nextStatus);
      }

      if (!nextStatus.running) {
        throw new Error(nextStatus.message || `Set up subscriptions before connecting ${provider.name}.`);
      }

      await connectNineRouterAccount(provider, cloudSubscriptionsEnabled ? nineRouterDashboardUrl : nextStatus.dashboardUrl || NINE_ROUTER_DASHBOARD_FALLBACK, {
        isActive: () => mountedRef.current && accountConnectRunRef.current === runId,
        onStatus: setStatusMessage,
      });

      if (!mountedRef.current || accountConnectRunRef.current !== runId) {
        return;
      }

      const [nextConnections, nextModels] = await Promise.all([
        loadNineRouterConnections(cloudSubscriptionsEnabled ? nineRouterDashboardUrl : nextStatus.dashboardUrl || NINE_ROUTER_DASHBOARD_FALLBACK),
        loadNineRouterModels(cloudSubscriptionsEnabled ? nineRouterBaseUrl : settings.baseUrls[NINE_ROUTER_PROVIDER_ID]?.trim() || nextStatus.baseUrl || getDefaultBaseUrlForProvider(NINE_ROUTER_PROVIDER_ID)),
      ]);
      const preferredConnection = choosePreferredConnection(nextConnections.filter((connection) => connection.provider === provider.id));
      const nextModel = chooseNineRouterModelForAccount(provider.id, savedNineRouterModel, nextModels);

      if (!mountedRef.current || accountConnectRunRef.current !== runId) {
        return;
      }

      setConnections(nextConnections);
      setModels(nextModels);

      if (nextModels.length > 0 || provider.id === "codex") {
        onActivateProvider(NINE_ROUTER_PROVIDER_ID, nextModel);
        setStatusMessage({
          kind: "success",
          text: `${formatConnectionIdentity(preferredConnection) || provider.name} is connected. Gilbert is using ${nextModel} through your subscriptions.`,
        });
        onClose();
        return;
      }

      setStatusMessage({
        kind: "warning",
        text: `${provider.name} connected, but no live model route was reported yet. Open Subscriptions settings to refresh the catalog.`,
      });
    } catch (error) {
      if (mountedRef.current && accountConnectRunRef.current === runId) {
        setStatusMessage({ kind: "error", text: readProviderConnectError(error, `Could not connect ${provider.name}.`) });
      }
    } finally {
      if (mountedRef.current && accountConnectRunRef.current === runId) {
        setBusy((current) => (current === `account:${provider.id}` ? null : current));
      }
    }
  }

  async function activateNineRouter() {
    setBusy("activate-subscriptions");
    setStatusMessage(null);

    try {
      let nextModels = models;
      let nextStatus = runtimeStatus;

      if (!nextStatus?.running) {
        nextStatus = cloudSubscriptionsEnabled ? createCloudNineRouterStatus(nineRouterDashboardUrl, nineRouterBaseUrl) : await ensureNineRouterLocal();
        if (!mountedRef.current) {
          return;
        }
        setRuntimeStatus(nextStatus);
      }

      if (!nextStatus.running) {
        throw new Error(nextStatus.message || "Set up subscriptions before switching to them.");
      }

      if (nextModels.length === 0) {
        nextModels = await loadNineRouterModels(nineRouterBaseUrl);
        if (!mountedRef.current) {
          return;
        }
        setModels(nextModels);
      }

      const nextModel = chooseNineRouterModel(savedNineRouterModel, nextModels);
      onActivateProvider(NINE_ROUTER_PROVIDER_ID, nextModel);
      setStatusMessage({ kind: "success", text: `Gilbert is using ${nextModel} through your subscriptions.` });
      onClose();
    } catch (error) {
      if (mountedRef.current) {
        setStatusMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not activate subscription routing." });
      }
    } finally {
      if (mountedRef.current) {
        setBusy((current) => (current === "activate-subscriptions" ? null : current));
      }
    }
  }

  function useOpenRouterFallback() {
    setBusy("fallback");
    onActivateProvider("openrouter", openRouterFallbackModel);
    setStatusMessage({
      kind: "success",
      text: openRouterHasKey ? "Gilbert is using OpenRouter Auto with the saved OpenRouter key." : "Gilbert is using the OpenRouter free fallback route.",
    });
    setBusy(null);
    onClose();
  }

  const runtimeReady = cloudSubscriptionsEnabled || Boolean(runtimeStatus?.running);
  const runtimeInstalled = cloudSubscriptionsEnabled || Boolean(runtimeStatus?.installed);
  const desktopRuntime = isTauriDesktopRuntime();
  const runtimeChecking = !cloudSubscriptionsEnabled && !cloudSubscriptionsUnavailable && desktopRuntime && !runtimeStatus;
  const subscriptionSetupNeeded = !cloudSubscriptionsEnabled && !cloudSubscriptionsUnavailable && isTauriDesktopRuntime() && Boolean(runtimeStatus) && !runtimeInstalled;
  const showAccountPanel = runtimeReady || connectedAccountCount > 0;
  const useSubscriptionsAsPrimaryAction = runtimeReady && (activeConnectionCount > 0 || models.length > 0);
  const primaryActionLabel = subscriptionSetupNeeded || cloudSubscriptionsUnavailable ? "Set up subscriptions" : useSubscriptionsAsPrimaryAction ? "Use subscriptions" : openRouterHasKey ? "Use OpenRouter Auto" : "Use Free Fallback";
  const primaryBusyLabel = busy === "activate-subscriptions" ? "Using subscriptions" : busy === "fallback" ? "Switching" : busy === "refresh" ? "Checking" : primaryActionLabel;
  const dialogTitle = subscriptionSetupNeeded || cloudSubscriptionsUnavailable ? "Choose how Gilbert connects" : "Connect an AI provider";
  const dialogDescription = cloudSubscriptionsUnavailable
    ? "Cloud subscriptions are required for this build, but the cloud router URL is not configured yet. Provider keys and OpenRouter fallback remain available."
    : subscriptionSetupNeeded
      ? "Subscriptions need one setup step before account sign-in. You can set them up now, use provider keys, or keep going with OpenRouter."
    : "Use subscriptions first, fall back cleanly. Sign in with the provider accounts you already pay for; Gilbert keeps OpenRouter ready when nothing is connected.";
  const displayStatusMessage = statusMessage
    ? {
        ...statusMessage,
        text: formatSubscriptionHelperText(statusMessage.text),
      }
    : null;

  function handlePrimaryAction() {
    if (subscriptionSetupNeeded || cloudSubscriptionsUnavailable) {
      onOpenNineRouterSettings();
      return;
    }

    if (useSubscriptionsAsPrimaryAction) {
      void activateNineRouter();
      return;
    }

    useOpenRouterFallback();
  }

  return (
    <DialogShell
      description={dialogDescription}
      icon={Route}
      onClose={onClose}
      open={open}
      title={dialogTitle}
      actions={
        <>
          <button className="dialog-button provider-connection-secondary-action" type="button" onClick={onOpenNineRouterSettings}>
            <Route size={15} aria-hidden="true" />
            Subscriptions
          </button>
          <button className="dialog-button provider-connection-secondary-action" type="button" onClick={onOpenProviderSettings}>
            <KeyRound size={15} aria-hidden="true" />
            Provider Keys
          </button>
          <button className="dialog-button" type="button" onClick={onClose}>
            Later
          </button>
          <button className="dialog-button provider-connection-secondary-action" type="button" onClick={onNeverShowAgain}>
            Do not show again
          </button>
          <button className="dialog-button dialog-button-primary provider-connection-primary-action" type="button" disabled={busy !== null} onClick={handlePrimaryAction}>
            {primaryBusyLabel}
            <ArrowRight size={15} aria-hidden="true" />
          </button>
        </>
      }
    >
      <div className="provider-connection-dialog-content">
        {displayStatusMessage ? (
          <div className="provider-connection-status" data-kind={displayStatusMessage.kind} role="status" aria-live="polite">
            {displayStatusMessage.text}
          </div>
        ) : null}

        {showAccountPanel ? (
          <section className="provider-account-panel" aria-label="Subscription account providers">
            <div className="provider-account-panel-heading" aria-label="Subscription account summary">
              <div>
                <h4>Subscription accounts</h4>
                <span>{runtimeReady ? "Ready for provider sign-in." : desktopRuntime ? runtimeInstalled ? "Starting subscriptions automatically." : "Install subscriptions once, then sign in." : "Open the desktop app to connect subscription accounts."}</span>
              </div>
              <div className="provider-account-counts" aria-label="Saved subscription accounts">
                <strong>{activeConnectionCount}/{NINE_ROUTER_ACCOUNT_PROVIDERS.length}</strong>
                <span>{connectedAccountCount > 0 ? `${connectedAccountCount} saved` : "none saved"}</span>
              </div>
            </div>

            <div className="provider-account-grid">
              {accountRows.map(({ connection, connections: providerConnections, provider }) => {
                const providerBusy = busy === `account:${provider.id}`;
                const connected = Boolean(connection);

                return (
                  <section className="provider-account-card" data-connected={connected} key={provider.id}>
                    <div className="provider-account-card-heading">
                      <div>
                        <strong>{provider.name}</strong>
                        <span>{provider.description}</span>
                      </div>
                      <em>{connected ? "Connected" : provider.flow === "device_code" ? "Device" : "OAuth"}</em>
                    </div>
                    <dl>
                      <div>
                        <dt>Account</dt>
                        <dd>{formatConnectionIdentity(connection) || "Not connected"}</dd>
                      </div>
                      <div>
                        <dt>Token</dt>
                        <dd>{formatConnectionExpiry(connection)}</dd>
                      </div>
                      {providerConnections.length > 1 ? (
                        <div>
                          <dt>Saved</dt>
                          <dd>{providerConnections.length}</dd>
                        </div>
                      ) : null}
                    </dl>
                    {connection?.lastError ? <p className="provider-account-error">{connection.lastError}</p> : null}
                    <button type="button" disabled={busy !== null || !runtimeReady} onClick={() => connectAccount(provider)}>
                      {provider.flow === "device_code" ? <ExternalLink size={15} aria-hidden="true" /> : <KeyRound size={15} aria-hidden="true" />}
                      {providerBusy ? "Waiting" : connected ? "Reconnect" : "Sign in"}
                    </button>
                  </section>
                );
              })}
            </div>
          </section>
        ) : (
          <SubscriptionSetupPanel
            busy={busy}
            cloudSubscriptionsUnavailable={cloudSubscriptionsUnavailable}
            connectedAccountCount={connectedAccountCount}
            onCheckAgain={() => refreshNineRouterState({ start: true })}
            onOpenNineRouterSettings={onOpenNineRouterSettings}
            onUseFallback={useOpenRouterFallback}
            openRouterFallbackLabel={openRouterHasKey ? "Use OpenRouter Auto" : "Use Free Fallback"}
            runtimeChecking={runtimeChecking}
            runtimeInstalled={runtimeInstalled}
            subscriptionSetupNeeded={subscriptionSetupNeeded}
          />
        )}

      </div>
    </DialogShell>
  );
}

function readProviderConnectError(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  return fallback;
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
    message: "Cloud subscription routing is ready.",
    running: true,
  };
}

function SubscriptionSetupPanel({
  busy,
  cloudSubscriptionsUnavailable,
  connectedAccountCount,
  onCheckAgain,
  onOpenNineRouterSettings,
  onUseFallback,
  openRouterFallbackLabel,
  runtimeChecking,
  runtimeInstalled,
  subscriptionSetupNeeded,
}: {
  busy: ProviderConnectionBusy;
  cloudSubscriptionsUnavailable: boolean;
  connectedAccountCount: number;
  onCheckAgain: () => void;
  onOpenNineRouterSettings: () => void;
  onUseFallback: () => void;
  openRouterFallbackLabel: string;
  runtimeChecking: boolean;
  runtimeInstalled: boolean;
  subscriptionSetupNeeded: boolean;
}) {
  const headline = cloudSubscriptionsUnavailable
    ? "Cloud subscriptions need configuration"
    : runtimeChecking
    ? "Checking subscription setup"
    : subscriptionSetupNeeded
      ? "Install subscriptions before account sign-in"
      : runtimeInstalled
        ? "Subscriptions are starting"
        : "Subscriptions need the desktop app";
  const detail = cloudSubscriptionsUnavailable
    ? "This official build uses cloud subscription routing. Add the Cloud Run router URL to the build before account sign-in."
    : runtimeChecking
    ? "Gilbert is checking this device before showing subscription sign-in options."
    : subscriptionSetupNeeded
      ? "After setup, this dialog will show Codex, Copilot, Claude, Gemini, and other subscription accounts you can connect."
      : runtimeInstalled
        ? "The local subscription runtime is installed and should be ready in a moment."
        : "Subscription account sign-in is available after local setup. API-key and OpenRouter routes are still available.";
  const installStepState = cloudSubscriptionsUnavailable ? "active" : runtimeInstalled ? "done" : runtimeChecking ? "active" : "next";
  const signInStepState = runtimeInstalled ? "next" : "locked";

  return (
    <section className="provider-subscription-setup-panel" aria-label="Subscription setup">
      <div className="provider-subscription-setup-heading">
        <div>
          <h4>{headline}</h4>
          <span>{detail}</span>
        </div>
        <em>{cloudSubscriptionsUnavailable ? "Cloud URL needed" : runtimeChecking ? "Checking" : runtimeInstalled ? "Installed" : connectedAccountCount > 0 ? `${connectedAccountCount} saved` : "Not installed"}</em>
      </div>

      <div className="provider-subscription-step-grid" aria-label="Subscription setup steps">
        <div className="provider-subscription-step" data-state={installStepState}>
          <strong>1. Cloud router</strong>
          <span>{cloudSubscriptionsUnavailable ? "Configure the Cloud Run subscription router URL." : "Add subscription routing once."}</span>
        </div>
        <div className="provider-subscription-step" data-state={signInStepState}>
          <strong>2. Sign in</strong>
          <span>Connect the paid accounts you use.</span>
        </div>
        <div className="provider-subscription-step" data-state="locked">
          <strong>3. Pick model</strong>
          <span>The model picker labels the source.</span>
        </div>
      </div>

      <div className="provider-subscription-setup-actions">
        <button type="button" disabled={busy !== null} onClick={onOpenNineRouterSettings}>
          <Route size={15} aria-hidden="true" />
          Set up subscriptions
        </button>
        <button type="button" disabled={busy !== null} onClick={onUseFallback}>
          <ArrowRight size={15} aria-hidden="true" />
          {openRouterFallbackLabel}
        </button>
        <button type="button" disabled={busy !== null} onClick={onCheckAgain}>
          <RefreshCcw size={15} aria-hidden="true" />
          {busy === "refresh" ? "Checking" : "Check again"}
        </button>
      </div>
    </section>
  );
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
