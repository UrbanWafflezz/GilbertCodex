import { BookOpen, Bot, Copy, ExternalLink, Eye, EyeOff, MessageCircle, Network, Play, RefreshCw, Send, ShieldCheck, Square, Webhook } from "lucide-react";
import { useEffect, useState } from "react";
import {
  getDiscordBridgeStatus,
  isTauriDesktopRuntime,
  listenForDiscordBridgeStatus,
  openExternalUrl,
  registerDiscordSlashCommand,
  sendDiscordWebhookMessage,
  startDiscordBridge,
  stopDiscordBridge,
  type DiscordBridgeStatus,
} from "../../../app/tauriClient";
import { createDiscordBridgeConfigKey } from "../../../app/discordBridgeAutoStart";
import {
  DISCORD_BRIDGE_MODE_LABELS,
  DISCORD_BRIDGE_RESPONSE_STYLE_LABELS,
  DISCORD_TUNNEL_PROVIDER_LABELS,
  type DiscordBridgeMode,
  type DiscordBridgeResponseStyle,
  type DiscordBridgeSettings,
  type DiscordTunnelProvider,
} from "../../../types/discord";
import { getConfiguredCloudConnectorUrl, isCloudConnectorEnabled, startCloudConnectorOAuth, waitForCloudConnectorOAuth } from "../../../services/cloudConnectorClient";
import { SettingsSectionHeading } from "../components/SettingsSectionHeading";
import type { SettingsStatusMessage } from "../types";

const DISCORD_CHAT_COMMANDS = ["gilbert", "gilbertnewchat"] as const;
const DISCORD_BROWSER_OPEN_TIMEOUT_MS = 4_000;

const DISCORD_DOC_LINKS = [
  { href: "https://discord.com/developers/applications", label: "Developer Portal" },
  { href: "https://docs.discord.com/developers/interactions", label: "Interactions overview" },
  { href: "https://docs.discord.com/developers/interactions/receiving-and-responding", label: "Receiving interactions" },
  { href: "https://docs.discord.com/developers/interactions/application-commands", label: "Application commands" },
  { href: "https://docs.discord.com/developers/resources/application", label: "Install links" },
  { href: "https://docs.discord.com/developers/events/gateway", label: "Gateway intents" },
  { href: "https://docs.discord.com/developers/resources/webhook", label: "Incoming webhooks" },
  { href: "https://ngrok.com/docs/getting-started", label: "ngrok quickstart" },
  { href: "https://gilbertcodex.com/help", label: "Setup guide" },
] as const;

interface DiscordSettingsPageProps {
  settings: DiscordBridgeSettings;
  onSettingsChange: (settings: DiscordBridgeSettings) => void;
}

export function DiscordSettingsPage({ settings, onSettingsChange }: DiscordSettingsPageProps) {
  const [bridgeBusy, setBridgeBusy] = useState(false);
  const [bridgeStatus, setBridgeStatus] = useState<DiscordBridgeStatus | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<SettingsStatusMessage | null>(null);
  const [discordAuthUrl, setDiscordAuthUrl] = useState("");
  const [showSecrets, setShowSecrets] = useState(false);
  const [copyStatus, setCopyStatus] = useState<SettingsStatusMessage | null>(null);
  const desktopBridgeAvailable = isTauriDesktopRuntime();
  const discordCloudAvailable = isCloudConnectorEnabled("discord");
  const bridgeRuntimeAvailable = desktopBridgeAvailable || discordCloudAvailable;
  const hostedInteractionsEndpointUrl = discordCloudAvailable ? `${getConfiguredCloudConnectorUrl("discord")}/discord/interactions` : "";
  const hostedDiscordAccountConnected = bridgeStatus?.accountConnected === true;
  const readiness = discordCloudAvailable
    ? [{ detail: "Discord sign-in and bot command handling are ready for this build.", label: "Discord sign-in", mode: "interactions" as DiscordBridgeMode, ready: true }]
    : createReadiness(settings);
  const activeModeReady = readiness.find((item) => item.mode === settings.mode)?.ready ?? false;
  const liveInteractionsEndpointUrl = discordCloudAvailable ? bridgeStatus?.publicUrl || hostedInteractionsEndpointUrl : bridgeStatus?.publicUrl || settings.publicInteractionsUrl || settings.interactionsEndpointUrl;

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void getDiscordBridgeStatus()
      .then((status) => {
        if (!disposed) {
          setBridgeStatus(status);
        }
      })
      .catch(() => undefined);

    void listenForDiscordBridgeStatus((status) => {
      if (!disposed) {
        setBridgeStatus(status);
      }
    }).then((nextUnlisten) => {
      if (disposed) {
        nextUnlisten();
        return;
      }

      unlisten = nextUnlisten;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  function patchSettings(patch: Partial<DiscordBridgeSettings>) {
    setCopyStatus(null);
    setRuntimeStatus(null);
    onSettingsChange({
      ...settings,
      ...patch,
    });
  }

  async function copyText(text: string, successText: string) {
    if (!text.trim()) {
      setCopyStatus({ kind: "error", text: "Nothing to copy yet." });
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus({ kind: "success", text: successText });
    } catch {
      setCopyStatus({ kind: "error", text: "Clipboard access failed." });
    }
  }

  async function refreshBridgeStatus() {
    setBridgeBusy(true);
    setCopyStatus(null);
    setRuntimeStatus({ kind: "warning", text: "Checking Discord bridge status..." });

    try {
      const status = await getDiscordBridgeStatus();
      setBridgeStatus(status);
      setRuntimeStatus({ kind: status.running ? "success" : "warning", text: status.message });
    } catch (error) {
      setRuntimeStatus({ kind: "error", text: readErrorMessage(error, "Could not read Discord bridge status.") });
    } finally {
      setBridgeBusy(false);
    }
  }

  async function startBridgeRuntime() {
    setCopyStatus(null);

    if (discordCloudAvailable) {
      await startHostedDiscordSignIn();
      return;
    }

    setRuntimeStatus({ kind: "warning", text: "Starting the local Discord receiver and tunnel..." });

    if (!discordCloudAvailable && (!settings.applicationId.trim() || !settings.publicKey.trim())) {
      setRuntimeStatus({ kind: "error", text: "Add the Discord Application ID and Public Key first." });
      return;
    }

    setBridgeBusy(true);

    try {
      const status = await startDiscordBridge({
        allowedChannelIds: settings.allowedChannelIds,
        allowedGuildIds: settings.allowedGuildIds,
        applicationId: settings.applicationId,
        configKey: createDiscordBridgeConfigKey(settings),
        localPort: settings.bridgePort,
        ngrokAuthToken: settings.ngrokAuthToken,
        ngrokPath: settings.ngrokPath,
        publicKey: settings.publicKey,
        responseStyle: settings.responseStyle,
        tunnelProvider: settings.tunnelProvider,
      });
      const nextEndpoint = status.publicUrl || settings.interactionsEndpointUrl;

      setBridgeStatus(status);
      onSettingsChange({
        ...settings,
        autoStartBridge: true,
        enabled: true,
        interactionsEndpointUrl: nextEndpoint,
        mode: "interactions",
        publicInteractionsUrl: status.publicUrl || settings.publicInteractionsUrl,
      });
      setCopyStatus({
        kind: status.publicUrl ? "success" : "warning",
        text: status.publicUrl ? "Bridge started and Interactions endpoint URL was filled in." : status.message,
      });
      setRuntimeStatus({
        kind: status.publicUrl ? "success" : "warning",
        text: status.publicUrl ? `${discordCloudAvailable ? "Discord connection ready at" : "Bridge running at"} ${status.publicUrl}` : status.message,
      });
    } catch (error) {
      setRuntimeStatus({ kind: "error", text: readErrorMessage(error, "Could not start the Discord bridge.") });
    } finally {
      setBridgeBusy(false);
    }
  }

  async function startHostedDiscordSignIn() {
    setRuntimeStatus({ kind: "warning", text: "Starting Discord sign-in..." });
    setDiscordAuthUrl("");
    setBridgeBusy(true);

    try {
      const session = await startCloudConnectorOAuth("discord");
      setDiscordAuthUrl(session.authorizationUrl);
      setRuntimeStatus({ kind: "success", text: "Discord sign-in is ready. If the browser does not open, press Open Discord." });

      void withTimeout(
        openExternalUrl(session.authorizationUrl),
        DISCORD_BROWSER_OPEN_TIMEOUT_MS,
        "Discord sign-in is ready. Use Open Discord to continue.",
      ).catch(() => {
        setRuntimeStatus({ kind: "warning", text: "The browser did not open automatically. Press Open Discord to finish signing in." });
      });

      await waitForCloudConnectorOAuth("discord", session);
      const status = await getDiscordBridgeStatus();
      setBridgeStatus(status);
      setDiscordAuthUrl("");
      onSettingsChange({
        ...settings,
        autoStartBridge: true,
        enabled: true,
        interactionsEndpointUrl: status.publicUrl || hostedInteractionsEndpointUrl,
        mode: "interactions",
        publicInteractionsUrl: status.publicUrl || hostedInteractionsEndpointUrl,
      });
      setRuntimeStatus({ kind: "success", text: status.message });
    } catch (error) {
      setRuntimeStatus({ kind: "error", text: readDiscordCloudError(error) });
    } finally {
      setBridgeBusy(false);
    }
  }

  async function stopBridgeRuntime() {
    setBridgeBusy(true);
    setCopyStatus(null);
    setRuntimeStatus({ kind: "warning", text: "Stopping the Discord bridge..." });

    try {
      const status = await stopDiscordBridge();
      setBridgeStatus(status);
      setDiscordAuthUrl("");
      setRuntimeStatus({ kind: "warning", text: status.message });
    } catch (error) {
      setRuntimeStatus({ kind: "error", text: readErrorMessage(error, "Could not stop the Discord bridge.") });
    } finally {
      setBridgeBusy(false);
    }
  }

  async function registerGilbertCommand() {
    setCopyStatus(null);
    setRuntimeStatus({ kind: "warning", text: "Registering Discord chat commands..." });

    if (!discordCloudAvailable && (!settings.applicationId.trim() || !settings.botToken.trim())) {
      setRuntimeStatus({ kind: "error", text: "Add the Discord Application ID and Bot token before registering Discord chat commands." });
      return;
    }

    setBridgeBusy(true);

    try {
      const guildId = firstDiscordId(settings.allowedGuildIds);
      const responses = [];

      for (const commandName of DISCORD_CHAT_COMMANDS) {
        responses.push(
          await registerDiscordSlashCommand({
            applicationId: settings.applicationId,
            botToken: settings.botToken,
            commandName,
            guildId,
          }),
        );
      }

      const registeredScope = responses[0];
      const scope = registeredScope?.scope === "guild" && registeredScope.guildId ? `server ${registeredScope.guildId}` : "globally";
      setRuntimeStatus({ kind: "success", text: `Registered /gilbert and /gilbertnewchat ${scope}.` });
    } catch (error) {
      setRuntimeStatus({ kind: "error", text: readErrorMessage(error, "Could not register Discord chat commands.") });
    } finally {
      setBridgeBusy(false);
    }
  }

  async function sendWebhookTest() {
    const webhookUrl = settings.incomingWebhookUrl.trim();

    setCopyStatus(null);

    if (!webhookUrl) {
      setRuntimeStatus({ kind: "error", text: "Add the Discord incoming webhook URL before sending a test." });
      return;
    }

    if (!desktopBridgeAvailable) {
      setRuntimeStatus({ kind: "error", text: "Discord webhook tests are only available in the desktop app." });
      return;
    }

    setBridgeBusy(true);
    setRuntimeStatus({ kind: "warning", text: "Sending Discord webhook test..." });

    try {
      await sendDiscordWebhookMessage({
        content: `Gilbert Discord webhook test sent at ${new Date().toLocaleString()}.`,
        webhookUrl,
      });
      setRuntimeStatus({ kind: "success", text: "Discord webhook test sent. Check the selected channel." });
    } catch (error) {
      setRuntimeStatus({ kind: "error", text: readErrorMessage(error, "Could not send the Discord webhook test.") });
    } finally {
      setBridgeBusy(false);
    }
  }

  return (
    <>
      <SettingsSectionHeading detail={discordCloudAvailable ? "Connect Discord slash commands and channel posting." : "Connect Discord directly to Gilbert chat with slash commands, gateway chat, or channel posting."} icon={MessageCircle} title="Discord" />

      <div className="discord-settings-layout">
        <article className="settings-card settings-card-wide discord-bridge-card" data-enabled={settings.enabled}>
          <div className="settings-card-heading">
            <Network size={19} aria-hidden="true" />
            <div>
              <h2>Bridge mode</h2>
              <p>{discordCloudAvailable ? "Sign in with Discord without installing ngrok or running a local receiver." : "Choose how Discord connects to Gilbert before wiring the receiver."}</p>
            </div>
          </div>

          <div className="settings-row-list">
            <div className="settings-row">
              <span>Discord bridge</span>
              <strong>{settings.enabled ? (activeModeReady ? "Ready for runtime wiring" : "Needs setup values") : "Disabled"}</strong>
              <button
                className="settings-switch"
                type="button"
                role="switch"
                aria-checked={settings.enabled}
                data-on={settings.enabled}
                onClick={() => patchSettings({ enabled: !settings.enabled })}
              >
                <span />
              </button>
            </div>
          </div>

          <div className="settings-segmented-control discord-mode-control" role="radiogroup" aria-label="Discord bridge mode">
            {(["interactions", "bot-gateway", "webhook-relay"] as DiscordBridgeMode[]).map((mode) => (
              <button key={mode} type="button" role="radio" aria-checked={settings.mode === mode} data-selected={settings.mode === mode} onClick={() => patchSettings({ mode })}>
                {DISCORD_BRIDGE_MODE_LABELS[mode]}
              </button>
            ))}
          </div>

          <ul className="discord-readiness-list" aria-label="Discord bridge readiness">
            {readiness.map((item) => (
              <li key={item.label} data-ready={item.ready}>
                <span aria-hidden="true" />
                <div>
                  <strong>{item.label}</strong>
                  <small>{item.detail}</small>
                </div>
              </li>
            ))}
          </ul>
        </article>

        <article className="settings-card settings-card-wide discord-runtime-card">
          <div className="settings-card-heading">
            <Network size={19} aria-hidden="true" />
            <div>
              <h2>{discordCloudAvailable ? "Discord account" : "Local receiver"}</h2>
              <p>{discordCloudAvailable ? "Connect your account and register slash commands for this workspace." : "Runs the signed Discord Interactions receiver and starts the tunnel for this machine."}</p>
            </div>
          </div>

          {!discordCloudAvailable ? <div className="settings-row-list">
            <div className="settings-row">
              <span>Auto-start bridge</span>
              <strong>{bridgeStatus?.running ? "Running now" : settings.autoStartBridge ? "On" : "Off"}</strong>
              <button
                className="settings-switch"
                type="button"
                role="switch"
                aria-checked={settings.autoStartBridge}
                data-on={settings.autoStartBridge}
                onClick={() => patchSettings({ autoStartBridge: !settings.autoStartBridge })}
              >
                <span />
              </button>
            </div>
          </div> : null}

          {!discordCloudAvailable ? <div className="discord-runtime-grid">
            <label className="settings-field">
              <span>Local port</span>
              <input
                inputMode="numeric"
                min={1024}
                max={65535}
                type="number"
                value={settings.bridgePort}
                onChange={(event) => patchSettings({ bridgePort: normalizeBridgePortInput(event.target.value) })}
              />
            </label>

            <label className="settings-field">
              <span>Tunnel provider</span>
              <select value={settings.tunnelProvider} onChange={(event) => patchSettings({ tunnelProvider: event.target.value as DiscordTunnelProvider })}>
                {(["ngrok", "local"] as DiscordTunnelProvider[]).map((provider) => (
                  <option key={provider} value={provider}>
                    {DISCORD_TUNNEL_PROVIDER_LABELS[provider]}
                  </option>
                ))}
              </select>
            </label>

            <label className="settings-field">
              <span>ngrok executable</span>
              <input autoComplete="off" placeholder="ngrok" value={settings.ngrokPath} onChange={(event) => patchSettings({ ngrokPath: event.target.value })} />
              <small className="settings-field-note">
                Gilbert checks PATH, Homebrew/macOS bin folders, common Windows installs, and local `.tools/ngrok`; paste a full path if needed.
              </small>
            </label>

            <label className="settings-field">
              <span>ngrok auth token</span>
              <div className="settings-secret-row">
                <input
                  autoComplete="off"
                  placeholder="Paste once; Gilbert configures ngrok on start"
                  type={showSecrets ? "text" : "password"}
                  value={settings.ngrokAuthToken}
                  onChange={(event) => patchSettings({ ngrokAuthToken: event.target.value })}
                />
                <button type="button" aria-label={showSecrets ? "Hide ngrok auth token" : "Show ngrok auth token"} onClick={() => setShowSecrets((visible) => !visible)}>
                  {showSecrets ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                </button>
              </div>
              <small className="settings-field-note">Stored locally; on startup Gilbert passes it directly to ngrok before starting the tunnel.</small>
            </label>
          </div> : null}

          <label className="settings-field">
            <span>Public Interactions URL</span>
            <div className="settings-url-row">
              <input readOnly value={liveInteractionsEndpointUrl} placeholder={discordCloudAvailable ? "Sign in with Discord to fill this automatically" : "Start the bridge to fill this automatically"} />
              <button type="button" onClick={() => copyText(liveInteractionsEndpointUrl, "Interactions endpoint URL copied.")}>
                <Copy size={16} aria-hidden="true" />
                Copy
              </button>
            </div>
          </label>

          <div className="settings-actions-row discord-action-row">
            <button className="settings-primary-button" type="button" disabled={!bridgeRuntimeAvailable || bridgeBusy} onClick={startBridgeRuntime}>
              <Play size={16} aria-hidden="true" />
              {discordCloudAvailable ? hostedDiscordAccountConnected ? "Reconnect Discord" : "Sign in with Discord" : "Start bridge"}
            </button>
            {(discordCloudAvailable ? hostedDiscordAccountConnected : true) ? <button className="settings-ghost-button" type="button" disabled={!bridgeRuntimeAvailable || bridgeBusy || !bridgeStatus?.running} onClick={stopBridgeRuntime}>
              <Square size={15} aria-hidden="true" />
              {discordCloudAvailable ? "Disconnect account" : "Stop"}
            </button> : null}
            <button className="settings-ghost-button" type="button" disabled={bridgeBusy} onClick={refreshBridgeStatus}>
              <RefreshCw size={15} aria-hidden="true" />
              Status
            </button>
            <button className="settings-ghost-button" type="button" disabled={!bridgeRuntimeAvailable || bridgeBusy} onClick={registerGilbertCommand}>
              <Bot size={15} aria-hidden="true" />
              Register commands
            </button>
          </div>

          {discordAuthUrl ? (
            <div className="settings-actions-row discord-action-row">
              <a className="settings-ghost-button discord-doc-link" href={discordAuthUrl} rel="noreferrer" target="_blank">
                <ExternalLink size={16} aria-hidden="true" />
                Open Discord
              </a>
            </div>
          ) : null}

          {runtimeStatus ? (
            <div className="settings-status-banner" data-kind={runtimeStatus.kind}>
              {runtimeStatus.text}
            </div>
          ) : null}

          <p className="settings-field-note" data-kind={bridgeStatus?.running ? "ready" : undefined}>
            {discordCloudAvailable
              ? bridgeStatus?.message || "Discord sign-in is ready for account sign-in and slash commands."
              : desktopBridgeAvailable
                ? bridgeStatus?.message || "Auto-start uses this receiver when the Discord bridge is enabled."
                : "Open the desktop app to run the local Discord receiver."}
          </p>
        </article>

        {!discordCloudAvailable ? <article className="settings-card">
          <div className="settings-card-heading">
            <Bot size={19} aria-hidden="true" />
            <div>
              <h2>Discord chat</h2>
              <p>Slash commands are the cleanest path; gateway mode is for DM, mention, or approved message-content flows.</p>
            </div>
          </div>

          <label className="settings-field">
            <span>Application ID</span>
            <input autoComplete="off" placeholder="Discord application ID" value={settings.applicationId} onChange={(event) => patchSettings({ applicationId: event.target.value })} />
          </label>

          <label className="settings-field">
            <span>Application public key</span>
            <input autoComplete="off" placeholder="Ed25519 public key" value={settings.publicKey} onChange={(event) => patchSettings({ publicKey: event.target.value })} />
          </label>

          <label className="settings-field">
            <span>Interactions endpoint URL</span>
            <input
              autoComplete="off"
              placeholder="https://your-bridge.example.com/discord/interactions"
              value={settings.interactionsEndpointUrl}
              onChange={(event) => patchSettings({ interactionsEndpointUrl: event.target.value })}
            />
          </label>

          <label className="settings-field">
            <span>Bot token</span>
            <div className="settings-secret-row">
              <input
                autoComplete="off"
                placeholder="Only needed for gateway mode"
                type={showSecrets ? "text" : "password"}
                value={settings.botToken}
                onChange={(event) => patchSettings({ botToken: event.target.value })}
              />
              <button type="button" aria-label={showSecrets ? "Hide Discord secrets" : "Show Discord secrets"} onClick={() => setShowSecrets((visible) => !visible)}>
                {showSecrets ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
              </button>
            </div>
          </label>
        </article> : <article className="settings-card">
          <div className="settings-card-heading">
            <Bot size={19} aria-hidden="true" />
            <div>
              <h2>Discord chat</h2>
              <p>Users sign in with Discord here; application credentials stay on the managed service.</p>
            </div>
          </div>

          <div className="settings-row-list">
            <div className="settings-row">
              <span>User account</span>
              <strong>{hostedDiscordAccountConnected ? "Connected" : "Not connected"}</strong>
            </div>
            <div className="settings-row">
              <span>Receiver</span>
              <strong>Signed interactions</strong>
            </div>
            <div className="settings-row">
              <span>Command install</span>
              <strong>Register commands</strong>
            </div>
          </div>
        </article>}

        <article className="settings-card">
          <div className="settings-card-heading">
            <Webhook size={19} aria-hidden="true" />
            <div>
              <h2>Channel posting</h2>
              <p>Incoming webhooks let Gilbert post app updates and chat follow-ups into one Discord channel.</p>
            </div>
          </div>

          <label className="settings-field">
            <span>Discord incoming webhook URL</span>
            <div className="settings-secret-row">
              <input
                autoComplete="off"
                placeholder="https://discord.com/api/webhooks/..."
                type={showSecrets ? "text" : "password"}
                value={settings.incomingWebhookUrl}
                onChange={(event) => patchSettings({ incomingWebhookUrl: event.target.value })}
              />
              <button type="button" aria-label={showSecrets ? "Hide Discord secrets" : "Show Discord secrets"} onClick={() => setShowSecrets((visible) => !visible)}>
                {showSecrets ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
              </button>
            </div>
          </label>

          <div className="settings-actions-row discord-action-row">
            <button className="settings-primary-button" type="button" disabled={!desktopBridgeAvailable || bridgeBusy || !settings.incomingWebhookUrl.trim()} onClick={sendWebhookTest}>
              <Send size={16} aria-hidden="true" />
              Send test
            </button>
            <a className="settings-ghost-button discord-doc-link" href="https://docs.discord.com/developers/resources/webhook" rel="noreferrer" target="_blank">
              <ExternalLink size={16} aria-hidden="true" />
              Incoming webhooks
            </a>
          </div>

          <label className="settings-field">
            <span>Response style</span>
            <select value={settings.responseStyle} onChange={(event) => patchSettings({ responseStyle: event.target.value as DiscordBridgeResponseStyle })}>
              {(["thread", "channel", "ephemeral"] as DiscordBridgeResponseStyle[]).map((style) => (
                <option key={style} value={style}>
                  {DISCORD_BRIDGE_RESPONSE_STYLE_LABELS[style]}
                </option>
              ))}
            </select>
          </label>

          <label className="settings-field">
            <span>Allowed guild IDs</span>
            <input autoComplete="off" placeholder="Comma-separated server IDs" value={settings.allowedGuildIds} onChange={(event) => patchSettings({ allowedGuildIds: event.target.value })} />
          </label>

          <label className="settings-field">
            <span>Allowed channel IDs</span>
            <input autoComplete="off" placeholder="Comma-separated channel IDs" value={settings.allowedChannelIds} onChange={(event) => patchSettings({ allowedChannelIds: event.target.value })} />
          </label>
        </article>

        <article className="settings-card settings-card-wide">
          <div className="settings-card-heading">
            <ShieldCheck size={19} aria-hidden="true" />
            <div>
              <h2>Setup handoff</h2>
              <p>{discordCloudAvailable ? "Copy the Discord setup notes for the Developer Portal." : "Copy the local configuration notes for the bridge and Discord Developer Portal."}</p>
            </div>
          </div>

          <div className="settings-actions-row discord-action-row">
            <button className="settings-primary-button" type="button" onClick={() => copyText(createDiscordSetupSummary(settings, discordCloudAvailable, liveInteractionsEndpointUrl), "Discord setup checklist copied.")}>
              <Copy size={16} aria-hidden="true" />
              Copy setup checklist
            </button>
            <a className="settings-ghost-button discord-doc-link" href="https://docs.discord.com/developers/interactions/overview" rel="noreferrer" target="_blank">
              <ExternalLink size={16} aria-hidden="true" />
              Discord interactions
            </a>
          </div>

          {copyStatus ? (
            <div className="settings-status-banner" data-kind={copyStatus.kind}>
              {copyStatus.text}
            </div>
          ) : null}
        </article>

        <article className="settings-card settings-card-wide integration-docs-card discord-docs-card">
          <div className="settings-card-heading">
            <BookOpen size={19} aria-hidden="true" />
            <div>
              <h2>Docs</h2>
              <p>Updated May 25, 2026 from the Discord developer docs and the repo setup guide.</p>
            </div>
          </div>

          <div className="integration-docs-body">
            <section className="integration-doc-section" aria-labelledby="discord-docs-setup-title">
              <h3 id="discord-docs-setup-title">Setup steps</h3>
              {discordCloudAvailable ? (
                <ol className="integration-doc-steps">
                  <li>Press <code>Sign in with Discord</code> so Gilbert can link this user's Discord account or install target.</li>
                  <li>Copy the Public Interactions URL from Discord account.</li>
                  <li>Paste it into the Discord app's Interactions Endpoint URL field and save it so Discord validates the receiver.</li>
                  <li>Enter a server ID under Allowed guild IDs when you want commands to appear immediately in one server.</li>
                  <li>Click Register commands to publish <code>/gilbert</code> and <code>/gilbertnewchat</code>.</li>
                  <li>Install the Discord app into the target server with the <code>applications.commands</code> scope, then test the slash commands.</li>
                </ol>
              ) : (
                <ol className="integration-doc-steps">
                  <li>Open the Discord Developer Portal, create an application, then copy its Application ID and Public Key into this page.</li>
                  <li>Keep Slash chat selected for the normal Gilbert flow. Use Bot gateway only for DMs, mentions, or approved message-content flows.</li>
                  <li>Install and authenticate ngrok, or set Tunnel provider to Local only when you are using your own public HTTPS tunnel.</li>
                  <li>On macOS, Homebrew installs under <code>/opt/homebrew/bin</code> or <code>/usr/local/bin</code>; Gilbert checks those even when launched from Finder.</li>
                  <li>Click Start bridge. Gilbert starts the local receiver, opens the tunnel, and fills the public Interactions URL.</li>
                  <li>Paste that URL into the Discord app's Interactions Endpoint URL field and save it so Discord can validate the receiver.</li>
                  <li>Paste a bot token only when registering slash commands or testing gateway mode, then click Register commands.</li>
                  <li>Install the app into the target server with the applications.commands scope, then test <code>/gilbert</code> and <code>/gilbertnewchat</code>.</li>
                  <li>Use an incoming webhook only for one-way channel posts from Gilbert. It cannot read Discord messages.</li>
                  <li>After pasting a webhook URL, click Send test to confirm Discord accepted and saved the message.</li>
                  <li>Use a normal text channel webhook for task notifications. Forum and media channels need thread targeting that Tasks v1 does not configure yet.</li>
                </ol>
              )}
            </section>

            <section className="integration-doc-section" aria-labelledby="discord-docs-links-title">
              <h3 id="discord-docs-links-title">Official links</h3>
              <ul className="integration-doc-link-list">
                {DISCORD_DOC_LINKS.map((link) => (
                  <li key={link.href}>
                    <a href={link.href} rel="noreferrer" target="_blank">
                      <span>{link.label}</span>
                      <ExternalLink size={14} aria-hidden="true" />
                    </a>
                  </li>
                ))}
              </ul>
              <p className="integration-doc-note">
                Discord requires an initial interaction response within 3 seconds; Gilbert defers and edits the original response while the app works.
              </p>
            </section>
          </div>
        </article>
      </div>
    </>
  );
}

interface ReadinessItem {
  detail: string;
  label: string;
  mode?: DiscordBridgeMode;
  ready: boolean;
}

function createReadiness(settings: DiscordBridgeSettings): ReadinessItem[] {
  const hasInteractionSettings = Boolean(settings.applicationId && settings.publicKey && (settings.interactionsEndpointUrl || settings.publicInteractionsUrl));
  const hasGatewaySettings = Boolean(settings.botToken && (settings.allowedChannelIds || settings.allowedGuildIds));
  const hasWebhookSettings = Boolean(settings.incomingWebhookUrl);

  return [
    {
      detail: "Needs application ID, public key, and a bridge URL.",
      label: "Slash-command chat",
      mode: "interactions",
      ready: hasInteractionSettings,
    },
    {
      detail: "Needs bot token plus a guild or channel allowlist.",
      label: "Gateway chat",
      mode: "bot-gateway",
      ready: hasGatewaySettings,
    },
    {
      detail: "Needs an incoming webhook URL; this only posts into Discord.",
      label: "Channel notifications",
      mode: "webhook-relay",
      ready: hasWebhookSettings,
    },
  ];
}

function createDiscordSetupSummary(settings: DiscordBridgeSettings, hosted: boolean, hostedInteractionsEndpointUrl: string) {
  if (hosted) {
    return [
      "Gilbert Discord setup",
      "Mode: Slash chat",
      `Interactions endpoint: ${hostedInteractionsEndpointUrl || "(not loaded)"}`,
      "Connection: Managed Discord service",
      "Commands: /gilbert continues, /gilbertnewchat starts fresh",
      `Allowed guild IDs: ${settings.allowedGuildIds || "(not set)"}`,
      `Allowed channel IDs: ${settings.allowedChannelIds || "(not set)"}`,
      "",
      "Discord Developer Portal",
      "Paste the interactions endpoint into the app's Interactions Endpoint URL field.",
      "Install the app with the applications.commands scope.",
      "Use Register commands in Gilbert after adding a guild ID for immediate server command updates.",
    ].join("\n");
  }

  return [
    "Gilbert Discord bridge setup",
    `Enabled: ${settings.enabled ? "yes" : "no"}`,
    `Mode: ${DISCORD_BRIDGE_MODE_LABELS[settings.mode]}`,
    `Response style: ${DISCORD_BRIDGE_RESPONSE_STYLE_LABELS[settings.responseStyle]}`,
    "",
    "Discord application",
    `Application ID: ${settings.applicationId || "(not set)"}`,
    `Public key: ${settings.publicKey || "(not set)"}`,
    `Interactions endpoint: ${settings.interactionsEndpointUrl || "(not set)"}`,
    `Auto-start bridge: ${settings.autoStartBridge ? "yes" : "no"}`,
    `Local port: ${settings.bridgePort}`,
    `Tunnel provider: ${DISCORD_TUNNEL_PROVIDER_LABELS[settings.tunnelProvider]}`,
    `ngrok executable: ${settings.ngrokPath || "ngrok"}`,
    `ngrok auth token: ${settings.ngrokAuthToken ? "(saved locally)" : "(not set)"}`,
    "Commands: /gilbert continues, /gilbertnewchat starts fresh",
    `Allowed guild IDs: ${settings.allowedGuildIds || "(not set)"}`,
    `Allowed channel IDs: ${settings.allowedChannelIds || "(not set)"}`,
    "",
    "Posting",
    `Incoming webhook URL: ${settings.incomingWebhookUrl ? "(saved locally)" : "(not set)"}`,
    "After adding a webhook, use Send test before enabling task Discord notifications.",
  ].join("\n");
}

function normalizeBridgePortInput(value: string) {
  const parsed = Number.parseInt(value, 10);

  if (Number.isInteger(parsed) && parsed >= 1024 && parsed <= 65535) {
    return parsed;
  }

  return 8787;
}

function firstDiscordId(value: string) {
  return value
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .find(Boolean);
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

function readDiscordCloudError(error: unknown) {
  const message = readErrorMessage(error, "Could not connect Discord.");
  if (/missing.*oauth.*client.*secret|missing.*client id.*client secret|client id or client secret/i.test(message)) {
    return "Discord login needs server-side OAuth setup. Contact support, then try again.";
  }
  return message;
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
