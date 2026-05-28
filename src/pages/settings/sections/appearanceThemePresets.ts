import { DEFAULT_APP_APPEARANCE_SETTINGS, DEFAULT_CODE_FONT, DEFAULT_UI_FONT, pickReadableHexTextColor } from "../../../lib/appearance";
import type { AppThemeComponentColors, AppThemeSettings, AppThemeVisualEffect } from "../../../types/settings";

export type ThemeKey = "dark" | "light";

export interface ThemePresetTheme extends Partial<Pick<AppThemeSettings, "codeFont" | "contrast" | "translucentSidebar" | "uiFont" | "visualEffect">> {
  accent: string;
  background: string;
  componentColors?: Partial<AppThemeComponentColors>;
  foreground: string;
}

export interface PairedThemePreset {
  dark: ThemePresetTheme;
  id: string;
  light: ThemePresetTheme;
  name: string;
}

export interface ModeThemePreset {
  id: string;
  mode: ThemeKey;
  name: string;
  theme: ThemePresetTheme;
}

interface ThemePresetInput {
  accent: string;
  active?: string;
  appsAccent?: string;
  appsAccentSoft?: string;
  appsBackground?: string;
  appsBackgroundGlow?: string;
  appsBorder?: string;
  appsControl?: string;
  appsControlHover?: string;
  appsDanger?: string;
  appsInstalled?: string;
  appsPanel?: string;
  appsPanelRaised?: string;
  appsPrimaryText?: string;
  appsSuccess?: string;
  appsWarning?: string;
  background: string;
  border: string;
  borderSoft?: string;
  codeFont?: string;
  composer?: string;
  composerAlt?: string;
  control?: string;
  controlHover?: string;
  cyan?: string;
  danger?: string;
  dim: string;
  effect?: AppThemeVisualEffect;
  field?: string;
  foreground: string;
  muted: string;
  pageAlt: string;
  panel: string;
  popover?: string;
  raised?: string;
  rose?: string;
  sidebar: string;
  sidebarWarm?: string;
  soft?: string;
  success?: string;
  surface?: string;
  terminalAccent?: string;
  terminalCommand?: string;
  terminalCursor?: string;
  terminalError?: string;
  terminalOutput?: string;
  terminalPanel?: string;
  terminalRail?: string;
  terminalSelection?: string;
  terminalText?: string;
  terminalToolbar?: string;
  translucentSidebar?: boolean;
  uiFont?: string;
  violet?: string;
  warning?: string;
  contrast?: number;
}

const MAC_POLISHED_UI = '"SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const WINDOWS_POLISHED_UI = '"Segoe UI Variable Text", "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif';
const CASCADIA_CODE = '"Cascadia Code", "SFMono-Regular", Consolas, monospace';
const JETBRAINS_MONO = '"JetBrains Mono", "Cascadia Code", "SFMono-Regular", Consolas, monospace';
const FIRA_CODE = '"Fira Code", "Cascadia Code", Consolas, monospace';
const GEIST_MONO = '"Geist Mono", "Cascadia Code", Consolas, monospace';
const IBM_PLEX_MONO = '"IBM Plex Mono", "Cascadia Code", Consolas, monospace';

function preset(input: ThemePresetInput): ThemePresetTheme {
  const raised = input.raised ?? input.panel;
  const surface = input.surface ?? input.panel;
  const soft = input.soft ?? input.pageAlt;
  const field = input.field ?? input.panel;
  const control = input.control ?? raised;
  const controlHover = input.controlHover ?? soft;
  const borderSoft = input.borderSoft ?? input.border;
  const active = input.active ?? controlHover;
  const sidebarWarm = input.sidebarWarm ?? input.sidebar;
  const terminalOutput = input.terminalOutput ?? input.field ?? input.background;
  const terminalText = input.terminalText ?? input.foreground;
  const success = input.success ?? "#2F9E68";
  const danger = input.danger ?? "#D54B4B";
  const warning = input.warning ?? "#C68124";
  const violet = input.violet ?? "#8C6FF7";

  return {
    accent: input.accent,
    background: input.background,
    codeFont: input.codeFont ?? DEFAULT_CODE_FONT,
    componentColors: {
      appBackground: input.background,
      appsAccent: input.appsAccent ?? input.accent,
      appsAccentSoft: input.appsAccentSoft ?? soft,
      appsBackground: input.appsBackground ?? input.background,
      appsBackgroundGlow: input.appsBackgroundGlow ?? warning,
      appsBorder: input.appsBorder ?? input.border,
      appsControl: input.appsControl ?? control,
      appsControlHover: input.appsControlHover ?? controlHover,
      appsDanger: input.appsDanger ?? danger,
      appsInstalled: input.appsInstalled ?? violet,
      appsPanel: input.appsPanel ?? input.panel,
      appsPanelRaised: input.appsPanelRaised ?? raised,
      appsPrimaryText: input.appsPrimaryText ?? pickReadableHexTextColor(input.accent, input.foreground, input.background),
      appsSuccess: input.appsSuccess ?? success,
      appsWarning: input.appsWarning ?? warning,
      border: input.border,
      borderSoft,
      chrome: input.background,
      chromeBorder: input.border,
      composer: input.composer ?? input.panel,
      composerAlt: input.composerAlt ?? raised,
      composerBorder: input.border,
      composerControl: control,
      composerControlHover: controlHover,
      composerFocus: input.accent,
      composerMuted: input.muted,
      cyan: input.cyan ?? "#2AA8A1",
      danger,
      field,
      fieldBorder: input.border,
      pageBackground: input.background,
      pageBackgroundAlt: input.pageAlt,
      panel: input.panel,
      popover: input.popover ?? raised,
      popoverBorder: input.border,
      rose: input.rose ?? "#D85C8A",
      sidebar: input.sidebar,
      sidebarActive: active,
      sidebarBorder: input.border,
      sidebarHover: controlHover,
      sidebarWarm,
      success,
      surface,
      surfaceRaised: raised,
      surfaceSoft: soft,
      terminalAccent: input.terminalAccent ?? input.accent,
      terminalBorder: input.border,
      terminalCommand: input.terminalCommand ?? input.cyan ?? input.accent,
      terminalControl: control,
      terminalControlHover: controlHover,
      terminalCursor: input.terminalCursor ?? input.accent,
      terminalError: input.terminalError ?? input.danger ?? "#D54B4B",
      terminalMuted: input.dim,
      terminalOutput,
      terminalPanel: input.terminalPanel ?? input.panel,
      terminalRail: input.terminalRail ?? input.sidebar,
      terminalSelection: input.terminalSelection ?? active,
      terminalText,
      terminalToolbar: input.terminalToolbar ?? raised,
      textDim: input.dim,
      textMuted: input.muted,
      violet,
      warning,
    },
    contrast: input.contrast,
    foreground: input.foreground,
    translucentSidebar: input.translucentSidebar ?? true,
    uiFont: input.uiFont ?? DEFAULT_UI_FONT,
    visualEffect: input.effect ?? "none",
  };
}

export const pairedThemePresets: PairedThemePreset[] = [
  {
    id: "codex",
    name: "Codex",
    light: {
      ...DEFAULT_APP_APPEARANCE_SETTINGS.light,
      componentColors: { ...DEFAULT_APP_APPEARANCE_SETTINGS.light.componentColors },
    },
    dark: {
      ...DEFAULT_APP_APPEARANCE_SETTINGS.dark,
      componentColors: { ...DEFAULT_APP_APPEARANCE_SETTINGS.dark.componentColors },
    },
  },
  {
    id: "vscode-dark-plus",
    name: "VS Code Dark+",
    light: preset({
      accent: "#007ACC",
      background: "#F3F3F3",
      border: "#D4D4D4",
      dim: "#6B6B6B",
      foreground: "#1F1F1F",
      muted: "#4E4E4E",
      pageAlt: "#E8E8E8",
      panel: "#FFFFFF",
      raised: "#ECECEC",
      sidebar: "#F3F3F3",
      sidebarWarm: "#ECECEC",
      codeFont: CASCADIA_CODE,
    }),
    dark: preset({
      accent: "#007ACC",
      background: "#1E1E1E",
      border: "#3C3C3C",
      dim: "#858585",
      effect: "scanlines",
      foreground: "#D4D4D4",
      muted: "#A6A6A6",
      pageAlt: "#252526",
      panel: "#252526",
      raised: "#2D2D30",
      sidebar: "#252526",
      sidebarWarm: "#2D2D30",
      codeFont: CASCADIA_CODE,
    }),
  },
  {
    id: "one-dark-pro",
    name: "One Dark Pro",
    light: preset({
      accent: "#4078F2",
      background: "#FAFAFA",
      border: "#DADDE3",
      dim: "#70747D",
      foreground: "#383A42",
      muted: "#5E6370",
      pageAlt: "#F0F2F5",
      panel: "#FFFFFF",
      raised: "#EAEAEB",
      sidebar: "#F0F0F0",
      codeFont: JETBRAINS_MONO,
      cyan: "#0184BC",
      rose: "#A626A4",
      success: "#50A14F",
      warning: "#C18401",
    }),
    dark: preset({
      accent: "#61AFEF",
      background: "#282C34",
      border: "#3E4451",
      cyan: "#56B6C2",
      danger: "#E06C75",
      dim: "#7F848E",
      foreground: "#ABB2BF",
      muted: "#9AA2AF",
      pageAlt: "#21252B",
      panel: "#2C313C",
      raised: "#353B48",
      rose: "#C678DD",
      sidebar: "#21252B",
      sidebarWarm: "#252A33",
      success: "#98C379",
      warning: "#E5C07B",
      codeFont: JETBRAINS_MONO,
    }),
  },
  {
    id: "night-owl",
    name: "Night Owl",
    light: preset({
      accent: "#4876D6",
      background: "#FBFBFB",
      border: "#D9DCE3",
      cyan: "#08916A",
      dim: "#7B7892",
      foreground: "#403F53",
      muted: "#5D5B72",
      pageAlt: "#F0F0F0",
      panel: "#FFFFFF",
      raised: "#E8EAEE",
      rose: "#C96788",
      sidebar: "#F7F7F7",
      violet: "#994CC3",
      codeFont: FIRA_CODE,
    }),
    dark: preset({
      accent: "#82AAFF",
      background: "#011627",
      border: "#1D3B53",
      cyan: "#7FDBCA",
      danger: "#EF5350",
      dim: "#637777",
      effect: "constellation",
      foreground: "#D6DEEB",
      muted: "#A4B7C5",
      pageAlt: "#061826",
      panel: "#071D33",
      raised: "#0B253A",
      rose: "#FF5874",
      sidebar: "#061826",
      sidebarWarm: "#0B253A",
      warning: "#ECC48D",
      codeFont: FIRA_CODE,
    }),
  },
  {
    id: "dracula",
    name: "Dracula",
    light: preset({
      accent: "#7C3AED",
      background: "#F8F8F2",
      border: "#DBD8CE",
      cyan: "#2AA198",
      dim: "#7D7888",
      foreground: "#282A36",
      muted: "#5E5F6F",
      pageAlt: "#EFEFE7",
      panel: "#FFFFFF",
      raised: "#EEEDE5",
      rose: "#FF79C6",
      sidebar: "#EFEFE7",
      codeFont: JETBRAINS_MONO,
    }),
    dark: preset({
      accent: "#BD93F9",
      background: "#282A36",
      border: "#44475A",
      cyan: "#8BE9FD",
      danger: "#FF5555",
      dim: "#8A8CA4",
      effect: "neon",
      foreground: "#F8F8F2",
      muted: "#C8C8D5",
      pageAlt: "#21222C",
      panel: "#343746",
      raised: "#3C4050",
      rose: "#FF79C6",
      sidebar: "#21222C",
      sidebarWarm: "#2C2E3B",
      success: "#50FA7B",
      warning: "#F1FA8C",
      codeFont: JETBRAINS_MONO,
    }),
  },
  {
    id: "catppuccin",
    name: "Catppuccin",
    light: preset({
      accent: "#1E66F5",
      background: "#EFF1F5",
      border: "#CCD0DA",
      dim: "#7C7F93",
      foreground: "#4C4F69",
      muted: "#6C6F85",
      pageAlt: "#DCE0E8",
      panel: "#E6E9EF",
      raised: "#DCE0E8",
      rose: "#D20F39",
      sidebar: "#E6E9EF",
      sidebarWarm: "#DCE0E8",
      violet: "#8839EF",
      codeFont: GEIST_MONO,
    }),
    dark: preset({
      accent: "#89B4FA",
      background: "#1E1E2E",
      border: "#45475A",
      cyan: "#94E2D5",
      dim: "#7F849C",
      effect: "aurora",
      foreground: "#CDD6F4",
      muted: "#A6ADC8",
      pageAlt: "#181825",
      panel: "#25263A",
      raised: "#313244",
      rose: "#F38BA8",
      sidebar: "#181825",
      sidebarWarm: "#1E2030",
      violet: "#CBA6F7",
      warning: "#F9E2AF",
      codeFont: GEIST_MONO,
    }),
  },
  {
    id: "solarized",
    name: "Solarized",
    light: preset({
      accent: "#268BD2",
      background: "#FDF6E3",
      border: "#D9CFB6",
      cyan: "#2AA198",
      danger: "#DC322F",
      dim: "#839496",
      foreground: "#586E75",
      muted: "#657B83",
      pageAlt: "#EEE8D5",
      panel: "#F7F0D8",
      raised: "#EEE8D5",
      sidebar: "#EEE8D5",
      sidebarWarm: "#E9E1C8",
      success: "#859900",
      warning: "#B58900",
      codeFont: IBM_PLEX_MONO,
    }),
    dark: preset({
      accent: "#268BD2",
      background: "#002B36",
      border: "#19505B",
      cyan: "#2AA198",
      danger: "#DC322F",
      dim: "#657B83",
      foreground: "#93A1A1",
      muted: "#839496",
      pageAlt: "#073642",
      panel: "#073642",
      raised: "#0A3A45",
      sidebar: "#073642",
      sidebarWarm: "#0A3A45",
      success: "#859900",
      warning: "#B58900",
      codeFont: IBM_PLEX_MONO,
    }),
  },
  {
    id: "monokai",
    name: "Monokai",
    light: preset({
      accent: "#A6E22E",
      background: "#F8F8F2",
      border: "#D9D9CC",
      danger: "#F92672",
      dim: "#74756B",
      foreground: "#272822",
      muted: "#5F6058",
      pageAlt: "#EDEDE6",
      panel: "#FFFFFF",
      raised: "#EDEDE6",
      sidebar: "#EDEDE6",
      violet: "#7C3AED",
      warning: "#D79921",
      codeFont: FIRA_CODE,
    }),
    dark: preset({
      accent: "#A6E22E",
      background: "#272822",
      border: "#49483E",
      cyan: "#66D9EF",
      danger: "#F92672",
      dim: "#8F908A",
      effect: "embers",
      foreground: "#F8F8F2",
      muted: "#CFCFC2",
      pageAlt: "#20211C",
      panel: "#30312A",
      raised: "#38392F",
      sidebar: "#20211C",
      sidebarWarm: "#28291F",
      violet: "#AE81FF",
      warning: "#E6DB74",
      codeFont: FIRA_CODE,
    }),
  },
  {
    id: "gruvbox",
    name: "Gruvbox",
    light: preset({
      accent: "#076678",
      background: "#FBF1C7",
      border: "#D5C4A1",
      danger: "#CC241D",
      dim: "#928374",
      foreground: "#3C3836",
      muted: "#665C54",
      pageAlt: "#EBDBB2",
      panel: "#F2E5BC",
      raised: "#EBDBB2",
      rose: "#B16286",
      sidebar: "#EBDBB2",
      sidebarWarm: "#E6D4A3",
      success: "#79740E",
      warning: "#B57614",
      codeFont: CASCADIA_CODE,
    }),
    dark: preset({
      accent: "#83A598",
      background: "#282828",
      border: "#504945",
      danger: "#FB4934",
      dim: "#928374",
      foreground: "#EBDBB2",
      muted: "#BDAE93",
      pageAlt: "#1D2021",
      panel: "#32302F",
      raised: "#3C3836",
      rose: "#D3869B",
      sidebar: "#1D2021",
      sidebarWarm: "#262321",
      success: "#B8BB26",
      warning: "#FABD2F",
      codeFont: CASCADIA_CODE,
    }),
  },
];

export const lightThemePresets: ModeThemePreset[] = [
  {
    id: "paper-lantern",
    mode: "light",
    name: "Paper Lantern",
    theme: preset({ accent: "#E8590C", background: "#FFF9F0", border: "#E7D8C5", dim: "#8A7868", foreground: "#2F2721", muted: "#6F5D4E", pageAlt: "#F7EDDF", panel: "#FFFDF8", raised: "#F2E4D2", rose: "#D9486E", sidebar: "#F8EDDF", sidebarWarm: "#F3E0C8", warning: "#C27803", effect: "dawn", codeFont: CASCADIA_CODE, uiFont: WINDOWS_POLISHED_UI }),
  },
  {
    id: "latte-debugger",
    mode: "light",
    name: "Latte Debugger",
    theme: preset({ accent: "#8F5E2E", background: "#FAF7F1", border: "#D8CFC0", dim: "#7E7569", foreground: "#2A2621", muted: "#615A51", pageAlt: "#EFE8DD", panel: "#FFFDF8", raised: "#E8DED0", cyan: "#218A84", sidebar: "#F1E9DD", sidebarWarm: "#E8D9C8", success: "#4F8A3F", warning: "#B67816", codeFont: IBM_PLEX_MONO }),
  },
  {
    id: "cloud-notebook",
    mode: "light",
    name: "Notebook Blue",
    theme: preset({ accent: "#2D7FF9", background: "#F7FBFF", border: "#CFDAE8", dim: "#718094", foreground: "#1E2A37", muted: "#56677C", pageAlt: "#ECF4FD", panel: "#FFFFFF", raised: "#E4EEF9", cyan: "#15AABF", rose: "#D6336C", sidebar: "#EFF6FF", sidebarWarm: "#E7F0FB", effect: "spotlight", codeFont: GEIST_MONO, uiFont: MAC_POLISHED_UI }),
  },
  {
    id: "mint-terminal",
    mode: "light",
    name: "Mint Terminal",
    theme: preset({ accent: "#087F5B", background: "#F3FFF9", border: "#C9E4D8", cyan: "#0B7285", dim: "#66877A", foreground: "#18352B", muted: "#446B5D", pageAlt: "#E3F6EE", panel: "#FBFFFD", raised: "#D7EFE5", sidebar: "#E8F8F1", sidebarWarm: "#DDF2EA", success: "#2B8A3E", effect: "circuit", codeFont: FIRA_CODE }),
  },
  {
    id: "sakura-compile",
    mode: "light",
    name: "Sakura Compile",
    theme: preset({ accent: "#D6336C", background: "#FFF7FA", border: "#E8CDD8", cyan: "#0CA678", dim: "#8A7080", foreground: "#382631", muted: "#705566", pageAlt: "#F9EAF0", panel: "#FFFFFF", raised: "#F2DEE8", rose: "#C2255C", sidebar: "#FBEAF1", sidebarWarm: "#F3DFE8", violet: "#7950F2", effect: "prism", codeFont: JETBRAINS_MONO }),
  },
  {
    id: "studio-daylight",
    mode: "light",
    name: "Studio Daylight",
    theme: preset({ accent: "#2563EB", background: "#FAFAF8", border: "#D6D8DE", dim: "#747986", foreground: "#22252A", muted: "#5F6672", pageAlt: "#F0F1F3", panel: "#FFFFFF", raised: "#E8EAEE", sidebar: "#F3F4F6", sidebarWarm: "#ECEFF4", warning: "#B7791F", codeFont: CASCADIA_CODE, uiFont: WINDOWS_POLISHED_UI }),
  },
  {
    id: "aqua-blueprint",
    mode: "light",
    name: "Aqua Blueprint",
    theme: preset({ accent: "#0B7285", background: "#F1FDFF", border: "#BFDCE4", cyan: "#1098AD", dim: "#627D85", foreground: "#17333A", muted: "#44666F", pageAlt: "#DDF4F8", panel: "#FBFEFF", raised: "#D2EDF3", sidebar: "#E5F8FB", sidebarWarm: "#D6F0F6", violet: "#5F3DC4", effect: "circuit", codeFont: GEIST_MONO }),
  },
  {
    id: "honey-syntax",
    mode: "light",
    name: "Honey Syntax",
    theme: preset({ accent: "#D9480F", background: "#FFFBEF", border: "#E5D8AF", cyan: "#0C8599", dim: "#82754D", foreground: "#302A18", muted: "#6C5F38", pageAlt: "#F7EEC9", panel: "#FFFDF4", raised: "#EFE1B2", rose: "#C2255C", sidebar: "#F8EFC9", sidebarWarm: "#F2E3AF", success: "#5C940D", warning: "#E67700", effect: "embers", codeFont: FIRA_CODE }),
  },
  {
    id: "lavender-desk",
    mode: "light",
    name: "Lavender Desk",
    theme: preset({ accent: "#7048E8", background: "#FBF8FF", border: "#D9D0EE", cyan: "#0CA678", dim: "#797089", foreground: "#2F293A", muted: "#62576F", pageAlt: "#F0EAFB", panel: "#FFFFFF", raised: "#E8DEF8", rose: "#D6336C", sidebar: "#F2ECFB", sidebarWarm: "#E9DFF7", violet: "#6741D9", effect: "aurora", codeFont: JETBRAINS_MONO }),
  },
  {
    id: "high-noon",
    mode: "light",
    name: "High Noon",
    theme: preset({ accent: "#F08C00", background: "#FFFDF5", border: "#E7D8B3", cyan: "#0B7285", dim: "#81724E", foreground: "#2B2616", muted: "#665935", pageAlt: "#F8EBC2", panel: "#FFFFFF", raised: "#F0DFA7", rose: "#E64980", sidebar: "#F9EDC6", sidebarWarm: "#F4E0A8", warning: "#D9480F", effect: "dawn", codeFont: CASCADIA_CODE }),
  },
  {
    id: "pearl-circuit",
    mode: "light",
    name: "Pearl Circuit",
    theme: preset({ accent: "#0F62FE", background: "#F8FAFC", border: "#CCD6E0", cyan: "#008B8B", dim: "#69788A", foreground: "#172331", muted: "#536579", pageAlt: "#EDF2F7", panel: "#FFFFFF", raised: "#E4ECF4", sidebar: "#F1F5F9", sidebarWarm: "#E6EEF8", violet: "#6D5DFC", effect: "circuit", codeFont: GEIST_MONO, uiFont: MAC_POLISHED_UI }),
  },
  {
    id: "meadow-diff",
    mode: "light",
    name: "Meadow Diff",
    theme: preset({ accent: "#2B8A3E", background: "#F8FFF4", border: "#CBDEBF", cyan: "#0B7285", dim: "#6D8064", foreground: "#1D321D", muted: "#50684C", pageAlt: "#EAF6E3", panel: "#FDFFFB", raised: "#DEEDD3", rose: "#C2255C", sidebar: "#EEF8E7", sidebarWarm: "#E4F1D8", success: "#2F9E44", codeFont: FIRA_CODE }),
  },
  {
    id: "arctic-review",
    mode: "light",
    name: "Arctic Review",
    theme: preset({ accent: "#3B82F6", background: "#F6FBFF", border: "#C9D8E8", cyan: "#06B6D4", dim: "#708293", foreground: "#1A2A38", muted: "#53697E", pageAlt: "#E7F1FA", panel: "#FFFFFF", raised: "#DDEAF6", sidebar: "#EDF6FD", sidebarWarm: "#E1EEF8", violet: "#7C3AED", effect: "spotlight", codeFont: CASCADIA_CODE }),
  },
  {
    id: "coral-commit",
    mode: "light",
    name: "Coral Commit",
    theme: preset({ accent: "#E03131", background: "#FFF8F6", border: "#E8CFCB", cyan: "#0C8599", danger: "#C92A2A", dim: "#89716C", foreground: "#3A2522", muted: "#6F5751", pageAlt: "#F9E8E4", panel: "#FFFFFF", raised: "#F1DCD7", rose: "#D6336C", sidebar: "#FBEAE6", sidebarWarm: "#F4DCD6", warning: "#F08C00", effect: "confetti", codeFont: JETBRAINS_MONO }),
  },
  {
    id: "citrus-trace",
    mode: "light",
    name: "Citrus Trace",
    theme: preset({ accent: "#74B816", background: "#FDFFF3", border: "#D5E4A8", cyan: "#0B7285", dim: "#77805B", foreground: "#273115", muted: "#5F683E", pageAlt: "#F1F8D7", panel: "#FFFFFA", raised: "#E7F0BC", rose: "#D6336C", sidebar: "#F3F9DD", sidebarWarm: "#E9F2C3", success: "#5C940D", warning: "#E67700", effect: "prism", codeFont: GEIST_MONO }),
  },
  {
    id: "notebook-ink",
    mode: "light",
    name: "Notebook Ink",
    theme: preset({ accent: "#364FC7", background: "#F9FAFD", border: "#D3D7E5", cyan: "#0C8599", dim: "#757B8F", foreground: "#202437", muted: "#596075", pageAlt: "#EEF1F8", panel: "#FFFFFF", raised: "#E5E9F2", sidebar: "#F1F3F9", sidebarWarm: "#E8EDF7", violet: "#7048E8", codeFont: IBM_PLEX_MONO }),
  },
  {
    id: "prism-draft",
    mode: "light",
    name: "Prism Draft",
    theme: preset({ accent: "#845EF7", background: "#FBFAFF", border: "#D8D1EA", cyan: "#15AABF", dim: "#78738A", foreground: "#292438", muted: "#5F586F", pageAlt: "#F0ECFA", panel: "#FFFFFF", raised: "#E8DFF8", rose: "#F06595", sidebar: "#F3EEFC", sidebarWarm: "#E8DFF8", violet: "#6741D9", effect: "prism", codeFont: FIRA_CODE }),
  },
  {
    id: "morning-console",
    mode: "light",
    name: "Morning Console",
    theme: preset({ accent: "#1971C2", background: "#FDFBF7", border: "#DCD5CA", cyan: "#0B7285", dim: "#7F776B", foreground: "#25221D", muted: "#635D52", pageAlt: "#F2EEE7", panel: "#FFFFFF", raised: "#E9E1D6", sidebar: "#F4EFE8", sidebarWarm: "#ECE4D9", warning: "#B7791F", codeFont: CASCADIA_CODE }),
  },
  {
    id: "seafoam-chat",
    mode: "light",
    name: "Seafoam Chat",
    theme: preset({ accent: "#099268", background: "#F2FFFC", border: "#C4E4DC", cyan: "#0B7285", dim: "#66857E", foreground: "#15342F", muted: "#486C64", pageAlt: "#E1F6F0", panel: "#FCFFFE", raised: "#D4EFE8", rose: "#D6336C", sidebar: "#E7F8F3", sidebarWarm: "#D8F1EB", success: "#2B8A3E", effect: "ocean", codeFont: GEIST_MONO }),
  },
  {
    id: "rosewater-lab",
    mode: "light",
    name: "Rosewater Lab",
    theme: preset({ accent: "#C2255C", background: "#FFF8FB", border: "#E5CDD7", cyan: "#0CA678", dim: "#87717D", foreground: "#342631", muted: "#6D5664", pageAlt: "#F8E9F0", panel: "#FFFFFF", raised: "#F1DDE7", rose: "#E64980", sidebar: "#FAEAF1", sidebarWarm: "#F2DFE8", violet: "#7950F2", effect: "spotlight", codeFont: JETBRAINS_MONO }),
  },
  {
    id: "sandstone-ide",
    mode: "light",
    name: "Sandstone IDE",
    theme: preset({ accent: "#A16207", background: "#FCF8EF", border: "#D9CBB4", cyan: "#0B7285", dim: "#7B705F", foreground: "#2C261E", muted: "#625747", pageAlt: "#EFE6D4", panel: "#FFFDF7", raised: "#E7DAC3", sidebar: "#F2E8D6", sidebarWarm: "#E8DAC4", warning: "#B7791F", codeFont: IBM_PLEX_MONO }),
  },
  {
    id: "electric-day",
    mode: "light",
    name: "Electric Day",
    theme: preset({ accent: "#006CFF", background: "#F7FAFF", border: "#C8D6F0", cyan: "#00A3B8", dim: "#6D7A8E", effect: "neon", foreground: "#172033", muted: "#4E5F7A", pageAlt: "#E8F0FF", panel: "#FFFFFF", raised: "#DDE8FB", rose: "#D63384", sidebar: "#EDF4FF", sidebarWarm: "#E1ECFC", violet: "#6D5DFE", codeFont: FIRA_CODE }),
  },
  {
    id: "soft-graphite-light",
    mode: "light",
    name: "Soft Graphite",
    theme: preset({ accent: "#495057", background: "#FAFAFA", border: "#D7D7D7", cyan: "#0B7285", dim: "#7A7D80", foreground: "#202225", muted: "#5D6267", pageAlt: "#F0F1F2", panel: "#FFFFFF", raised: "#E7E9EB", rose: "#C2255C", sidebar: "#F3F4F5", sidebarWarm: "#ECEFF2", codeFont: CASCADIA_CODE }),
  },
  {
    id: "cloudburst-light",
    mode: "light",
    name: "Blueburst",
    theme: preset({ accent: "#1C7ED6", background: "#F4F9FF", border: "#C5D6E8", cyan: "#1098AD", dim: "#698197", foreground: "#152B3E", muted: "#4A6680", pageAlt: "#E1EEF9", panel: "#FBFDFF", raised: "#D7E6F4", rose: "#D6336C", sidebar: "#E9F4FD", sidebarWarm: "#DCECF8", effect: "ocean", codeFont: GEIST_MONO }),
  },
  {
    id: "champagne-merge",
    mode: "light",
    name: "Champagne Merge",
    theme: preset({ accent: "#B7791F", background: "#FFFDF7", border: "#E3D5B7", cyan: "#0C8599", dim: "#81755E", foreground: "#2D281D", muted: "#665B43", pageAlt: "#F7EFD9", panel: "#FFFFFF", raised: "#EEE3C8", rose: "#D6336C", sidebar: "#F8F0DC", sidebarWarm: "#EFE0C2", warning: "#D9480F", effect: "dawn", codeFont: IBM_PLEX_MONO }),
  },
];

export const darkThemePresets: ModeThemePreset[] = [
  {
    id: "midnight-compiler",
    mode: "dark",
    name: "Midnight Compiler",
    theme: preset({ accent: "#5C9DFF", background: "#101722", border: "#283447", cyan: "#38D9C7", dim: "#728096", foreground: "#E7EEF9", muted: "#A9B5C7", pageAlt: "#131D2B", panel: "#172234", raised: "#1E2B40", rose: "#FF7AA2", sidebar: "#0E1520", sidebarWarm: "#121C2A", violet: "#9B8CFF", effect: "constellation", codeFont: JETBRAINS_MONO, uiFont: MAC_POLISHED_UI }),
  },
  {
    id: "neon-synth",
    mode: "dark",
    name: "Neon Synth",
    theme: preset({ accent: "#FF4FD8", background: "#130817", border: "#3A2542", cyan: "#00E5FF", dim: "#8C7793", effect: "neon", foreground: "#FFEAFB", muted: "#D5B8DC", pageAlt: "#1B0D23", panel: "#21102B", raised: "#2B1538", rose: "#FF4FD8", sidebar: "#16091D", sidebarWarm: "#21102B", violet: "#9B5CFF", warning: "#FFD166", codeFont: FIRA_CODE }),
  },
  {
    id: "matrix-grove",
    mode: "dark",
    name: "Matrix Grove",
    theme: preset({ accent: "#4DFF88", background: "#07110B", border: "#1D3928", cyan: "#26E6A6", dim: "#63806D", effect: "matrix", foreground: "#D8FFE1", muted: "#9DDBAE", pageAlt: "#0B1A11", panel: "#102417", raised: "#16331F", rose: "#FF6B9A", sidebar: "#08140C", sidebarWarm: "#0D1F14", success: "#51CF66", warning: "#D6FF5C", codeFont: FIRA_CODE }),
  },
  {
    id: "cyber-grape",
    mode: "dark",
    name: "Cyber Grape",
    theme: preset({ accent: "#8B5CF6", background: "#15111F", border: "#342A4B", cyan: "#22D3EE", dim: "#827995", effect: "prism", foreground: "#EEE8FF", muted: "#C4B8DB", pageAlt: "#1B1628", panel: "#231B33", raised: "#2B2240", rose: "#F472B6", sidebar: "#130F1C", sidebarWarm: "#1B1628", violet: "#A78BFA", codeFont: JETBRAINS_MONO }),
  },
  {
    id: "inferno-stack",
    mode: "dark",
    name: "Inferno Stack",
    theme: preset({ accent: "#FF6B35", background: "#1B0D08", border: "#4A2A1E", cyan: "#2DD4BF", danger: "#FF4D4F", dim: "#9A7668", effect: "embers", foreground: "#FFF0E8", muted: "#DDB9A8", pageAlt: "#241109", panel: "#2A140C", raised: "#361C10", rose: "#FF4D8D", sidebar: "#190B06", sidebarWarm: "#241109", warning: "#FFD166", codeFont: CASCADIA_CODE }),
  },
  {
    id: "ocean-debug",
    mode: "dark",
    name: "Ocean Debug",
    theme: preset({ accent: "#2DD4BF", background: "#071B24", border: "#1F4652", cyan: "#67E8F9", dim: "#6E8E98", effect: "ocean", foreground: "#E3FBFF", muted: "#A8D7DF", pageAlt: "#0B2430", panel: "#102F3B", raised: "#163D4B", rose: "#FB7185", sidebar: "#061821", sidebarWarm: "#0B2430", violet: "#7DD3FC", codeFont: GEIST_MONO }),
  },
  {
    id: "cosmic-console",
    mode: "dark",
    name: "Cosmic Console",
    theme: preset({ accent: "#A78BFA", background: "#0B1020", border: "#26314D", cyan: "#38BDF8", dim: "#74819B", effect: "constellation", foreground: "#E9EDFF", muted: "#B5C0D8", pageAlt: "#11172A", panel: "#151D33", raised: "#1C2640", rose: "#F472B6", sidebar: "#090E1A", sidebarWarm: "#11172A", warning: "#FBBF24", codeFont: IBM_PLEX_MONO }),
  },
  {
    id: "carbon-aurora",
    mode: "dark",
    name: "Carbon Aurora",
    theme: preset({ accent: "#00B4D8", background: "#111315", border: "#30363D", cyan: "#64E9D3", dim: "#7C858E", effect: "aurora", foreground: "#E6EDF3", muted: "#B7C1CC", pageAlt: "#171B1F", panel: "#1C2126", raised: "#252B31", rose: "#FF7AA2", sidebar: "#0F1215", sidebarWarm: "#151B20", success: "#8CE99A", codeFont: CASCADIA_CODE, uiFont: WINDOWS_POLISHED_UI }),
  },
  {
    id: "blue-steel",
    mode: "dark",
    name: "Blue Steel",
    theme: preset({ accent: "#5EA1FF", background: "#121820", border: "#2B3747", cyan: "#4DD0E1", dim: "#788594", foreground: "#E8F1FA", muted: "#B4C0CC", pageAlt: "#18212B", panel: "#1D2733", raised: "#263442", rose: "#F06292", sidebar: "#10161D", sidebarWarm: "#17202A", codeFont: GEIST_MONO }),
  },
  {
    id: "retro-terminal",
    mode: "dark",
    name: "Retro Terminal",
    theme: preset({ accent: "#FFD43B", background: "#17180F", border: "#3B3D25", cyan: "#38D9C7", dim: "#8D8D72", effect: "scanlines", foreground: "#F8F2C4", muted: "#CFC88A", pageAlt: "#1E2013", panel: "#242617", raised: "#30321D", rose: "#FF6B9A", sidebar: "#14150D", sidebarWarm: "#1D1F12", success: "#A9E34B", warning: "#FFD43B", codeFont: IBM_PLEX_MONO }),
  },
  {
    id: "party-runtime",
    mode: "dark",
    name: "Party Runtime",
    theme: preset({ accent: "#FF2E63", background: "#120B18", border: "#3B2548", cyan: "#08D9D6", dim: "#8A7993", effect: "confetti", foreground: "#FFF1FF", muted: "#D8BFE1", pageAlt: "#1A1023", panel: "#21142D", raised: "#2B1A3A", rose: "#FF2E63", sidebar: "#140B1B", sidebarWarm: "#20102A", violet: "#A855F7", warning: "#FDE047", codeFont: FIRA_CODE }),
  },
  {
    id: "velvet-void",
    mode: "dark",
    name: "Velvet Void",
    theme: preset({ accent: "#C084FC", background: "#120D16", border: "#33263B", cyan: "#5EEAD4", dim: "#89768F", foreground: "#F4EAFE", muted: "#D3BFE0", pageAlt: "#1A121F", panel: "#22172A", raised: "#2B1E36", rose: "#F472B6", sidebar: "#100B14", sidebarWarm: "#1A121F", effect: "spotlight", codeFont: JETBRAINS_MONO }),
  },
  {
    id: "obsidian-rose",
    mode: "dark",
    name: "Obsidian Rose",
    theme: preset({ accent: "#FB7185", background: "#121012", border: "#37272E", cyan: "#2DD4BF", danger: "#F43F5E", dim: "#8A7880", foreground: "#FFF1F4", muted: "#D5BAC3", pageAlt: "#1B1518", panel: "#241A1F", raised: "#2E2228", rose: "#FB7185", sidebar: "#100D10", sidebarWarm: "#1B1518", warning: "#FBBF24", codeFont: CASCADIA_CODE }),
  },
  {
    id: "plasma-lab",
    mode: "dark",
    name: "Plasma Lab",
    theme: preset({ accent: "#E879F9", background: "#111025", border: "#312C58", cyan: "#22D3EE", dim: "#7B7BA0", effect: "prism", foreground: "#F0F0FF", muted: "#C2C2E5", pageAlt: "#17163A", panel: "#1E1B4B", raised: "#282163", rose: "#F472B6", sidebar: "#0F0D20", sidebarWarm: "#17163A", violet: "#A78BFA", codeFont: GEIST_MONO }),
  },
  {
    id: "focus-noir",
    mode: "dark",
    name: "Focus Noir",
    theme: preset({ accent: "#E5E7EB", background: "#0E0F11", border: "#2B2E34", cyan: "#67E8F9", dim: "#7B7E85", foreground: "#F3F4F6", muted: "#B8BDC7", pageAlt: "#14161A", panel: "#1A1D22", raised: "#23272E", rose: "#F472B6", sidebar: "#0C0D0F", sidebarWarm: "#14161A", codeFont: CASCADIA_CODE, translucentSidebar: false }),
  },
  {
    id: "forest-night",
    mode: "dark",
    name: "Forest Night",
    theme: preset({ accent: "#74C69D", background: "#0C1710", border: "#254332", cyan: "#52B6A4", dim: "#728B7B", foreground: "#E8F6ED", muted: "#B4D0BF", pageAlt: "#101F16", panel: "#16281D", raised: "#1E3527", rose: "#E76F91", sidebar: "#0A130D", sidebarWarm: "#102016", success: "#95D5B2", warning: "#DDA15E", effect: "embers", codeFont: IBM_PLEX_MONO }),
  },
  {
    id: "electric-indigo",
    mode: "dark",
    name: "Electric Indigo",
    theme: preset({ accent: "#4F46E5", background: "#0F1022", border: "#2A2E58", cyan: "#06B6D4", dim: "#737AA4", effect: "neon", foreground: "#EBECFF", muted: "#B9BFE5", pageAlt: "#14173A", panel: "#1A1D4B", raised: "#222763", rose: "#FB7185", sidebar: "#0D0E1D", sidebarWarm: "#14173A", violet: "#818CF8", codeFont: FIRA_CODE }),
  },
  {
    id: "rusted-console",
    mode: "dark",
    name: "Rusted Console",
    theme: preset({ accent: "#F97316", background: "#17110D", border: "#3C2A20", cyan: "#14B8A6", dim: "#8B776B", foreground: "#F8EEE7", muted: "#CFB7A8", pageAlt: "#21170F", panel: "#291D14", raised: "#35271C", rose: "#F43F5E", sidebar: "#140E0A", sidebarWarm: "#21170F", warning: "#FBBF24", effect: "embers", codeFont: CASCADIA_CODE }),
  },
  {
    id: "deep-space",
    mode: "dark",
    name: "Deep Space",
    theme: preset({ accent: "#7DD3FC", background: "#050816", border: "#1D2A4A", cyan: "#22D3EE", dim: "#65708F", effect: "constellation", foreground: "#E5F0FF", muted: "#A8B6D8", pageAlt: "#0B1024", panel: "#111832", raised: "#182240", rose: "#F472B6", sidebar: "#050713", sidebarWarm: "#0B1024", violet: "#A78BFA", codeFont: GEIST_MONO }),
  },
  {
    id: "hacker-lime",
    mode: "dark",
    name: "Hacker Lime",
    theme: preset({ accent: "#B6F542", background: "#0D1208", border: "#2F3D1E", cyan: "#39FFB6", dim: "#7F8D6A", effect: "matrix", foreground: "#F0FFD2", muted: "#CBE68F", pageAlt: "#121A0B", panel: "#182411", raised: "#223017", rose: "#FF5C8A", sidebar: "#0A0F06", sidebarWarm: "#121A0B", success: "#A9E34B", warning: "#F8E16C", codeFont: FIRA_CODE }),
  },
  {
    id: "ember-night",
    mode: "dark",
    name: "Ember Night",
    theme: preset({ accent: "#FF922B", background: "#140E0B", border: "#42271B", cyan: "#2DD4BF", dim: "#907365", effect: "embers", foreground: "#FFF0E6", muted: "#D8B3A0", pageAlt: "#1D120C", panel: "#26170F", raised: "#321F14", rose: "#FF6B9A", sidebar: "#120B08", sidebarWarm: "#1D120C", warning: "#FFD166", codeFont: IBM_PLEX_MONO }),
  },
  {
    id: "ultraviolet",
    mode: "dark",
    name: "Ultraviolet",
    theme: preset({ accent: "#D946EF", background: "#10051A", border: "#34204A", cyan: "#22D3EE", dim: "#826E92", effect: "aurora", foreground: "#F9E8FF", muted: "#D2B8E0", pageAlt: "#170A24", panel: "#1F1030", raised: "#2A1740", rose: "#FB7185", sidebar: "#0E0416", sidebarWarm: "#170A24", violet: "#C084FC", codeFont: JETBRAINS_MONO }),
  },
  {
    id: "moonlit-mint",
    mode: "dark",
    name: "Moonlit Mint",
    theme: preset({ accent: "#5EEAD4", background: "#071413", border: "#1E3E3A", cyan: "#67E8F9", dim: "#6E8885", effect: "ocean", foreground: "#E5FFFB", muted: "#AEE0D9", pageAlt: "#0C1D1B", panel: "#112926", raised: "#183631", rose: "#FB7185", sidebar: "#061110", sidebarWarm: "#0C1D1B", success: "#86EFAC", codeFont: GEIST_MONO }),
  },
  {
    id: "noir-blueprint",
    mode: "dark",
    name: "Noir Blueprint",
    theme: preset({ accent: "#38BDF8", background: "#08111C", border: "#1D3A55", cyan: "#22D3EE", dim: "#698499", effect: "circuit", foreground: "#E6F6FF", muted: "#A5CEE3", pageAlt: "#0D1B2A", panel: "#12243A", raised: "#18324C", rose: "#F472B6", sidebar: "#070E17", sidebarWarm: "#0D1B2A", violet: "#818CF8", codeFont: CASCADIA_CODE }),
  },
  {
    id: "acid-pop",
    mode: "dark",
    name: "Acid Pop",
    theme: preset({ accent: "#D9F99D", background: "#130817", border: "#3A2B45", cyan: "#67E8F9", dim: "#8D7A96", effect: "confetti", foreground: "#FFF7FF", muted: "#D6C0DE", pageAlt: "#1C0F23", panel: "#25142E", raised: "#301B3B", rose: "#FF4FD8", sidebar: "#120717", sidebarWarm: "#1C0F23", violet: "#A855F7", warning: "#FDE047", codeFont: FIRA_CODE }),
  },
];
