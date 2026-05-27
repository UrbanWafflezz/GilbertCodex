import type { LucideIcon } from "lucide-react";
import type { AppInfo } from "../../types/app";
import type { DiscordBridgeSettings } from "../../types/discord";
import type { LocalWorkspaceSettings } from "../../types/localWorkspace";
import type { ProjectSummary } from "../../types/project";
import type { AppAppearanceSettings, AppGeneralSettings, AppPersonalizationSettings, AppearanceMode, ProviderSettings } from "../../types/settings";

export type SettingsSectionId =
  | "appearance"
  | "billing"
  | "browser"
  | "braveSearch"
  | "configuration"
  | "database"
  | "discord"
  | "general"
  | "github"
  | "google"
  | "mapbox"
  | "mobile"
  | "keys"
  | "model"
  | "nineRouter"
  | "pdf"
  | "personalization"
  | "providers"
  | "usage"
  | "weatherSources";

export interface SettingsNavItem {
  icon: LucideIcon;
  id: SettingsSectionId;
  label: string;
  meta?: string;
}

export interface SettingsPageProps {
  activeSection: SettingsSectionId;
  appearanceMode: AppearanceMode;
  appInfo: AppInfo;
  discordBridge: DiscordBridgeSettings;
  generalSettings: AppGeneralSettings;
  localWorkspace: LocalWorkspaceSettings;
  onAppearanceModeChange: (mode: AppearanceMode) => void;
  onAppearanceSettingsChange: (settings: AppAppearanceSettings) => void;
  onActiveSectionChange: (section: SettingsSectionId) => void;
  onDiscordBridgeChange: (settings: DiscordBridgeSettings) => void;
  onGeneralSettingsChange: (settings: AppGeneralSettings) => void;
  onLocalWorkspaceChange: (settings: LocalWorkspaceSettings) => void;
  onPersonalizationChange: (settings: AppPersonalizationSettings) => void;
  onActivateProvider?: (provider: ProviderSettings["provider"], model: string) => void;
  onSettingsChange: (settings: ProviderSettings) => void;
  onSubscriptionSandboxUninstalled?: (settings: ProviderSettings) => void;
  personalization: AppPersonalizationSettings;
  appearanceSettings: AppAppearanceSettings;
  projects: ProjectSummary[];
  settings: ProviderSettings;
}

export type LiveModelCatalogStatus = "error" | "idle" | "loading" | "ready";
export type SettingsStatusKind = "error" | "success" | "warning";

export interface SettingsStatusMessage {
  kind: SettingsStatusKind;
  text: string;
}
