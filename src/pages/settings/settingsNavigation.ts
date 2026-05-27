import {
  BadgeDollarSign,
  CloudSun,
  BarChart3,
  Compass,
  Database,
  FileCog,
  Github,
  KeyRound,
  MessageCircle,
  Smartphone,
  Palette,
  Route,
  Search,
  ServerCog,
  Settings2,
} from "lucide-react";
import type { SettingsNavItem, SettingsSectionId } from "./types";

export const SETTINGS_NAV_ITEMS: SettingsNavItem[] = [
  { icon: Settings2, id: "general", label: "General", meta: "Profile" },
  { icon: Palette, id: "appearance", label: "Appearance", meta: "Theme" },
  { icon: BadgeDollarSign, id: "billing", label: "Plans", meta: "Billing" },
  { icon: ServerCog, id: "model", label: "AI & Providers", meta: "Models" },
  { icon: KeyRound, id: "keys", label: "Keys", meta: "Vault" },
  { icon: Route, id: "nineRouter", label: "Subscriptions", meta: "Accounts" },
  { icon: BarChart3, id: "usage", label: "Usage", meta: "Costs" },
  { icon: Compass, id: "browser", label: "Browser", meta: "Privacy" },
  { icon: Search, id: "braveSearch", label: "Web Search", meta: "Sources" },
  { icon: Smartphone, id: "mobile", label: "Mobile", meta: "Pairing" },
  { icon: CloudSun, id: "weatherSources", label: "Weather & Maps", meta: "Geo" },
  { icon: FileCog, id: "configuration", label: "Workspace", meta: "Runtime" },
  { icon: Database, id: "database", label: "Library & Data", meta: "Local" },
  { icon: Github, id: "github", label: "GitHub", meta: "Code" },
  { icon: KeyRound, id: "google", label: "Google", meta: "OAuth" },
  { icon: MessageCircle, id: "discord", label: "Discord", meta: "Chat" },
];

export function resolveSettingsNavSection(section: SettingsSectionId): SettingsSectionId {
  if (section === "personalization") {
    return "general";
  }

  if (section === "providers") {
    return "model";
  }

  if (section === "mapbox") {
    return "weatherSources";
  }

  if (section === "pdf") {
    return "database";
  }

  return section;
}
