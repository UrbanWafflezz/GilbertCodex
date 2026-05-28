import type { DiscordBridgeSettings } from "../types/discord";
import { isCloudConnectorEnabled } from "../services/cloudConnectorClient";
import { getDiscordBridgeStatus, startDiscordBridge, type DiscordBridgeStatus } from "./tauriClient";

export interface DiscordBridgeAutoStartResult {
  configKey: string | null;
  settings: DiscordBridgeSettings;
  started: boolean;
  status: DiscordBridgeStatus | null;
}

let pendingAutoStartKey: string | null = null;
let pendingAutoStart: Promise<DiscordBridgeAutoStartResult> | null = null;

export function createDiscordBridgeConfigKey(settings: DiscordBridgeSettings) {
  return [
    settings.applicationId.trim(),
    settings.publicKey.trim(),
    settings.bridgePort,
    settings.tunnelProvider,
    settings.ngrokPath.trim(),
    settings.ngrokAuthToken.trim() ? "token" : "no-token",
    settings.responseStyle,
    settings.allowedGuildIds.trim(),
    settings.allowedChannelIds.trim(),
  ].join("|");
}

export function createDiscordBridgeAutoStartKey(settings: DiscordBridgeSettings) {
  if (!settings.enabled || !settings.autoStartBridge || settings.mode !== "interactions") {
    return null;
  }

  if (isCloudConnectorEnabled("discord")) {
    return "cloud";
  }

  if (!settings.applicationId.trim() || !settings.publicKey.trim()) {
    return null;
  }

  return createDiscordBridgeConfigKey(settings);
}

export async function ensureDiscordBridgeAutoStarted(settings: DiscordBridgeSettings): Promise<DiscordBridgeAutoStartResult> {
  const configKey = createDiscordBridgeAutoStartKey(settings);

  if (!configKey) {
    return {
      configKey,
      settings,
      started: false,
      status: null,
    };
  }

  if (pendingAutoStart && pendingAutoStartKey === configKey) {
    return pendingAutoStart;
  }

  pendingAutoStartKey = configKey;
  pendingAutoStart = runDiscordBridgeAutoStart(settings, configKey).finally(() => {
    if (pendingAutoStartKey === configKey) {
      pendingAutoStartKey = null;
      pendingAutoStart = null;
    }
  });

  return pendingAutoStart;
}

async function runDiscordBridgeAutoStart(settings: DiscordBridgeSettings, configKey: string): Promise<DiscordBridgeAutoStartResult> {
  const currentStatus = await getDiscordBridgeStatus().catch(() => null);

  if (configKey === "cloud") {
    return {
      configKey,
      settings: currentStatus ? mergeDiscordBridgeStatusSettings(settings, currentStatus) : settings,
      started: false,
      status: currentStatus,
    };
  }

  if (currentStatus && isDiscordBridgeRunningForConfig(currentStatus, configKey)) {
    return {
      configKey,
      settings: mergeDiscordBridgeStatusSettings(settings, currentStatus),
      started: false,
      status: currentStatus,
    };
  }

  const status = await startDiscordBridge({
    allowedChannelIds: settings.allowedChannelIds,
    allowedGuildIds: settings.allowedGuildIds,
    applicationId: settings.applicationId,
    configKey,
    localPort: settings.bridgePort,
    ngrokAuthToken: settings.ngrokAuthToken,
    ngrokPath: settings.ngrokPath,
    publicKey: settings.publicKey,
    responseStyle: settings.responseStyle,
    tunnelProvider: settings.tunnelProvider,
  });

  return {
    configKey,
    settings: mergeDiscordBridgeStatusSettings(settings, status),
    started: true,
    status,
  };
}

export function mergeDiscordBridgeStatusSettings(settings: DiscordBridgeSettings, status: DiscordBridgeStatus): DiscordBridgeSettings {
  if (!status.publicUrl) {
    return settings;
  }

  return {
    ...settings,
    interactionsEndpointUrl: status.publicUrl,
    publicInteractionsUrl: status.publicUrl,
  };
}

function isDiscordBridgeRunningForConfig(status: DiscordBridgeStatus, configKey: string) {
  return status.running && status.configKey === configKey;
}
