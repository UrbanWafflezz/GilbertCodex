import { parseSkillMarkdown, upsertCustomSkill } from "../../services/skillRegistry";
import type { SkillSafetyLevel } from "../../types/skills";

const OPENAI_PLUGINS_REPOSITORY = "https://github.com/openai/plugins";
const OPENAI_PLUGINS_RAW_BASE = "https://raw.githubusercontent.com/openai/plugins/main/";
const OPENAI_PLUGINS_TREE_API = "https://api.github.com/repos/openai/plugins/git/trees/main?recursive=1";
const OPENAI_MARKETPLACE_URL = `${OPENAI_PLUGINS_RAW_BASE}.agents/plugins/marketplace.json`;
const GILBERT_MARKETPLACE_LABEL = "Gilbert Codex";

const NATIVE_PLUGIN_IDS = new Set(["github", "gmail", "google-calendar"]);

const MCP_PRESET_BY_PLUGIN_ID: Record<string, string> = {
  apify: "apify",
  "atlassian-rovo": "atlassian",
  aws: "aws",
  azure: "azure",
  "brave-search": "brave-search",
  browserbase: "browserbase",
  cloudflare: "cloudflare-api",
  context7: "context7",
  exa: "exa",
  firebase: "firebase",
  firecrawl: "firecrawl",
  figma: "figma-remote",
  "github-mcp": "github-mcp",
  gitlab: "gitlab",
  heroku: "heroku",
  jetbrains: "jetbrains",
  kubernetes: "kubernetes",
  linear: "linear",
  linkedin: "linkedin",
  memory: "memory",
  mongodb: "mongodb",
  "neon-postgres": "neon",
  netlify: "netlify",
  notion: "notion",
  playwright: "playwright",
  postgres: "postgres",
  puppeteer: "puppeteer",
  pulumi: "pulumi",
  redis: "redis",
  sentry: "sentry",
  "sequential-thinking": "sequential-thinking",
  slack: "slack",
  stripe: "stripe",
  supabase: "supabase",
  tavily: "tavily",
  vercel: "vercel",
};

const PLUGINS_WITH_BUNDLED_SKILLS = new Set([
  "atlassian-rovo",
  "box",
  "build-ios-apps",
  "build-macos-apps",
  "build-web-apps",
  "canva",
  "circleci",
  "cloudflare",
  "coderabbit",
  "codex-security",
  "expo",
  "figma",
  "game-studio",
  "github",
  "gmail",
  "google-calendar",
  "google-drive",
  "heygen",
  "hubspot",
  "hugging-face",
  "hyperframes",
  "life-science-research",
  "linear",
  "neon-postgres",
  "netlify",
  "notion",
  "openai-developers",
  "outlook-calendar",
  "outlook-email",
  "plugin-eval",
  "remotion",
  "render",
  "sentry",
  "sharepoint",
  "slack",
  "stripe",
  "supabase",
  "superpowers",
  "teams",
  "temporal",
  "test-android-apps",
  "twilio-developer-kit",
  "vercel",
  "zoom",
  "zotero",
]);

const MARKETPLACE_FALLBACKS = [
  ["apify", "Research"],
  ["aws", "Coding"],
  ["azure", "Coding"],
  ["linear", "Productivity"],
  ["browserbase", "Coding"],
  ["atlassian-rovo", "Productivity"],
  ["slack", "Productivity"],
  ["teams", "Productivity"],
  ["sharepoint", "Productivity"],
  ["outlook-email", "Productivity"],
  ["outlook-calendar", "Productivity"],
  ["figma", "Design"],
  ["hugging-face", "Coding"],
  ["netlify", "Coding"],
  ["neon-postgres", "Coding"],
  ["stripe", "Productivity"],
  ["vercel", "Coding"],
  ["firebase", "Coding"],
  ["game-studio", "Coding"],
  ["box", "Productivity"],
  ["google-drive", "Productivity"],
  ["notion", "Productivity"],
  ["cloudflare", "Coding"],
  ["context7", "Coding"],
  ["brave-search", "Research"],
  ["exa", "Research"],
  ["firecrawl", "Research"],
  ["tavily", "Research"],
  ["playwright", "Coding"],
  ["puppeteer", "Coding"],
  ["postgres", "Coding"],
  ["redis", "Coding"],
  ["mongodb", "Coding"],
  ["gitlab", "Coding"],
  ["github-mcp", "Coding"],
  ["heroku", "Coding"],
  ["jetbrains", "Coding"],
  ["kubernetes", "Coding"],
  ["linkedin", "Productivity"],
  ["memory", "Productivity"],
  ["pulumi", "Coding"],
  ["sequential-thinking", "Productivity"],
  ["sentry", "Coding"],
  ["build-ios-apps", "Coding"],
  ["build-macos-apps", "Coding"],
  ["build-web-apps", "Coding"],
  ["test-android-apps", "Coding"],
  ["supabase", "Coding"],
  ["openai-developers", "Engineering"],
] as const;

export type OpenAiPluginInstallRoute = "app-connector" | "mcp-preset" | "mcp-search" | "native" | "skill-import";

export interface OpenAiCodexPluginListing {
  authPolicy: string;
  category: string;
  displayName: string;
  hasBundledSkills: boolean;
  id: string;
  installRoute: OpenAiPluginInstallRoute;
  marketplace: string;
  mcpPresetId?: string;
  sourcePath: string;
  sourceUrl: string;
}

interface MarketplaceFile {
  interface?: {
    displayName?: string;
  };
  name?: string;
  plugins?: MarketplacePluginEntry[];
}

interface MarketplacePluginEntry {
  category?: string;
  name?: string;
  policy?: {
    authentication?: string;
  };
  source?: {
    path?: string;
  } | string;
}

interface GitHubTreeResponse {
  tree?: GitHubTreeItem[];
}

interface GitHubTreeItem {
  path?: string;
  type?: string;
}

const GILBERT_LOCAL_MARKETPLACE_PLUGINS: MarketplacePluginEntry[] = [
  {
    category: "Productivity",
    name: "linkedin",
    policy: { authentication: "ON_INSTALL" },
    source: { path: "./plugins/linkedin" },
  },
];

let cachedOpenAiTree: GitHubTreeItem[] | null = null;

export async function loadOpenAiCodexMarketplace(): Promise<OpenAiCodexPluginListing[]> {
  try {
    const marketplace = await fetchJson<MarketplaceFile>(OPENAI_MARKETPLACE_URL);
    return normalizeMarketplacePlugins([...GILBERT_LOCAL_MARKETPLACE_PLUGINS, ...(marketplace.plugins ?? [])], GILBERT_MARKETPLACE_LABEL);
  } catch {
    return normalizeMarketplacePlugins(
      [
        ...GILBERT_LOCAL_MARKETPLACE_PLUGINS,
        ...MARKETPLACE_FALLBACKS.map(([name, category]) => ({
          category,
          name,
          policy: { authentication: "ON_INSTALL" },
          source: { path: `./plugins/${name}` },
        })),
      ],
      `${GILBERT_MARKETPLACE_LABEL} fallback`,
    );
  }
}

export async function importOpenAiPluginSkills(plugin: OpenAiCodexPluginListing) {
  const tree = await getOpenAiPluginTree();
  const skillPaths = tree
    .map((item) => item.path ?? "")
    .filter((path) => path.startsWith(`plugins/${plugin.id}/skills/`) && path.endsWith("/SKILL.md"));

  if (skillPaths.length === 0) {
    return { importedCount: 0, skillNames: [] as string[] };
  }

  const importedNames: string[] = [];

  for (const skillPath of skillPaths) {
    const markdown = await fetchText(`${OPENAI_PLUGINS_RAW_BASE}${skillPath}`);
    const parsed = parseSkillMarkdown(markdown);
    const skillFolder = skillPath.split("/").slice(-2, -1)[0] || parsed.name;
    const skillName = parsed.name.toLowerCase().includes(plugin.displayName.toLowerCase())
      ? parsed.name
      : `${plugin.displayName}: ${parsed.name}`;

    const skill = upsertCustomSkill({
      category: plugin.category,
      description: parsed.description,
      enabled: true,
      id: `${plugin.id}-${skillFolder}`,
      instructions: markdown,
      name: skillName,
      path: `${OPENAI_PLUGINS_REPOSITORY}/blob/main/${skillPath}`,
      safetyLevel: skillSafetyLevelForPlugin(plugin),
      source: "imported",
      tags: Array.from(new Set([plugin.id, plugin.category, ...parsed.tags])).slice(0, 8),
      trigger: `$${plugin.id}-${skillFolder}`,
    });

    importedNames.push(skill.name);
  }

  return {
    importedCount: importedNames.length,
    skillNames: importedNames,
  };
}

export function getOpenAiPluginRouteLabel(plugin: OpenAiCodexPluginListing) {
  switch (plugin.installRoute) {
    case "native":
      return "Native";
    case "mcp-preset":
      return "MCP ready";
    case "skill-import":
      return "Skills";
    case "mcp-search":
      return "MCP search";
    default:
      return "Connector";
  }
}

export function getOpenAiPluginPrimaryActionLabel(plugin: OpenAiCodexPluginListing) {
  switch (plugin.installRoute) {
    case "native":
      return "Install";
    case "mcp-preset":
      return "Configure MCP";
    case "skill-import":
      return "Install skills";
    case "mcp-search":
      return "Find MCP";
    default:
      return "Check options";
  }
}

export function getOpenAiPluginDescription(plugin: OpenAiCodexPluginListing) {
  if (plugin.installRoute === "native") {
    return "Built into Gilbert with app-owned auth, local state, and approval-gated tools.";
  }

  if (plugin.installRoute === "mcp-preset") {
    return "Maps to a curated MCP setup that Gilbert can save, test, and expose to chat.";
  }

  if (plugin.installRoute === "skill-import") {
    return "Imports the plugin's bundled Codex skills into Gilbert's local skill registry.";
  }

  if (plugin.installRoute === "mcp-search") {
    return "Searches the public MCP Registry for a runnable server or hosted replacement.";
  }

  return "Hosted app connector metadata is visible, but Gilbert needs native or MCP access to call tools.";
}

export function isOpenAiNativePlugin(pluginId: string) {
  return NATIVE_PLUGIN_IDS.has(pluginId);
}

export function getOpenAiCodexMcpPresetMappings() {
  return { ...MCP_PRESET_BY_PLUGIN_ID };
}

function normalizeMarketplacePlugins(entries: MarketplacePluginEntry[], marketplaceName: string): OpenAiCodexPluginListing[] {
  const plugins = entries
    .flatMap((entry): OpenAiCodexPluginListing[] => {
      const id = normalizePluginId(entry.name);

      if (!id) {
        return [];
      }

      const sourcePath = normalizeSourcePath(entry.source, id);
      const mcpPresetId = MCP_PRESET_BY_PLUGIN_ID[id];
      const hasBundledSkills = PLUGINS_WITH_BUNDLED_SKILLS.has(id);

      return [{
        authPolicy: entry.policy?.authentication || "ON_USE",
        category: entry.category || "Productivity",
        displayName: formatPluginDisplayName(id),
        hasBundledSkills,
        id,
        installRoute: routeForPlugin(id, Boolean(mcpPresetId), hasBundledSkills),
        marketplace: marketplaceName,
        mcpPresetId,
        sourcePath,
        sourceUrl: `${OPENAI_PLUGINS_REPOSITORY}/tree/main/${sourcePath.replace(/^\.\//, "")}`,
      }];
    });
  const seen = new Set<string>();
  const uniquePlugins = plugins.filter((plugin) => {
    if (seen.has(plugin.id)) {
      return false;
    }

    seen.add(plugin.id);
    return true;
  });

  return uniquePlugins.sort((left, right) => {
    const routeRank = routeSortRank(left.installRoute) - routeSortRank(right.installRoute);
    return routeRank || left.category.localeCompare(right.category) || left.displayName.localeCompare(right.displayName);
  });
}

function routeForPlugin(id: string, hasMcpPreset: boolean, hasBundledSkills: boolean): OpenAiPluginInstallRoute {
  if (NATIVE_PLUGIN_IDS.has(id)) {
    return "native";
  }

  if (hasMcpPreset) {
    return "mcp-preset";
  }

  if (hasBundledSkills) {
    return "skill-import";
  }

  return "mcp-search";
}

function routeSortRank(route: OpenAiPluginInstallRoute) {
  switch (route) {
    case "native":
      return 0;
    case "mcp-preset":
      return 1;
    case "skill-import":
      return 2;
    case "mcp-search":
      return 3;
    default:
      return 4;
  }
}

async function getOpenAiPluginTree() {
  if (cachedOpenAiTree) {
    return cachedOpenAiTree;
  }

  const payload = await fetchJson<GitHubTreeResponse>(OPENAI_PLUGINS_TREE_API);
  cachedOpenAiTree = payload.tree ?? [];
  return cachedOpenAiTree;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Could not load ${url}: HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      Accept: "text/plain",
    },
  });

  if (!response.ok) {
    throw new Error(`Could not load ${url}: HTTP ${response.status}`);
  }

  return response.text();
}

function normalizePluginId(value: unknown) {
  return typeof value === "string"
    ? value.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-")
    : "";
}

function normalizeSourcePath(source: MarketplacePluginEntry["source"], id: string) {
  if (typeof source === "string") {
    return source.trim() || `./plugins/${id}`;
  }

  return source?.path?.trim() || `./plugins/${id}`;
}

function formatPluginDisplayName(id: string) {
  const specialCases: Record<string, string> = {
    "atlassian-rovo": "Atlassian",
    aws: "AWS",
    azure: "Azure",
    "brave-search": "Brave Search",
    "build-ios-apps": "Build iOS Apps",
    "build-macos-apps": "Build macOS Apps",
    "build-web-apps": "Build Web Apps",
    "carta-crm": "Carta CRM",
    "cb-insights": "CB Insights",
    "codex-security": "Codex Security",
    "coupler-io": "Coupler.io",
    "dow-jones-factiva": "Dow Jones Factiva",
    exa: "Exa",
    firecrawl: "Firecrawl",
    "google-calendar": "Google Calendar",
    "google-drive": "Google Drive",
    "github-mcp": "GitHub MCP",
    heroku: "Heroku",
    "hugging-face": "Hugging Face",
    jetbrains: "JetBrains IDE",
    "life-science-research": "Life Science Research",
    linkedin: "LinkedIn",
    "monday-com": "Monday.com",
    "mt-newswires": "MT Newswires",
    mongodb: "MongoDB",
    "myregistry-com": "MyRegistry.com",
    "neon-postgres": "Neon Postgres",
    "network-solutions": "Network Solutions",
    "omni-analytics": "Omni Analytics",
    "openai-developers": "Developer Docs",
    "otter-ai": "Otter.ai",
    "outlook-calendar": "Outlook Calendar",
    "outlook-email": "Outlook Email",
    "particl-market-research": "Particl Market Research",
    pulumi: "Pulumi",
    "ranked-ai": "Ranked AI",
    "read-ai": "Read AI",
    "sequential-thinking": "Sequential Thinking",
    "setu-bharat-connect-billpay": "Setu Bharat Connect BillPay",
    tavily: "Tavily",
    "teamwork-com": "Teamwork.com",
    "third-bridge": "Third Bridge",
    "tinman-ai": "Tinman AI",
    "twilio-developer-kit": "Twilio Developer Kit",
    "united-rentals": "United Rentals",
    "windsor-ai": "Windsor.ai",
  };

  return specialCases[id] ?? id
    .split("-")
    .map((part) => part ? part[0].toUpperCase() + part.slice(1) : part)
    .join(" ");
}

function skillSafetyLevelForPlugin(plugin: OpenAiCodexPluginListing): SkillSafetyLevel {
  return plugin.installRoute === "mcp-preset" || plugin.authPolicy === "ON_INSTALL" ? "medium" : "low";
}
