import { type ReactNode, useDeferredValue, useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowLeft, BadgeCheck, CalendarDays, CheckCircle2, ChevronDown, Github, Globe2, KeyRound, LogIn, LogOut, Mail, Plus, PlugZap, Puzzle, RefreshCw, Search, Server, ShieldCheck, Sparkles, TerminalSquare, Trash2, UserCheck, Wrench, X } from "lucide-react";
import {
  connectGmailOAuth,
  disconnectGmailAccount as disconnectGmailAccountByEmail,
  getDefaultGmailOAuthScope,
  getDefaultGoogleOAuthClientId,
  getDefaultGoogleOAuthClientSecret,
  getGmailState,
  gmailDesktopAvailable,
  googleCloudAvailable,
  installGmailPlugin,
  setActiveGmailAccount,
} from "../../app/gmailClient";
import {
  connectGoogleCalendarOAuth,
  disconnectGoogleCalendarAccount as disconnectGoogleCalendarAccountByEmail,
  getDefaultGoogleCalendarOAuthScope,
  getGoogleCalendarState,
  googleCalendarDesktopAvailable,
  installGoogleCalendarPlugin,
  setActiveGoogleCalendarAccount,
} from "../../app/googleCalendarClient";
import {
  getMcpState,
  listMcpServerTools,
  mcpDesktopAvailable,
  removeMcpServer,
  saveMcpServer,
  searchMcpRegistry,
  testMcpServerWithProgress,
} from "../../app/mcpClient";
import {
  getGithubState,
  githubDesktopAvailable,
  installGithubPlugin,
  listGithubRepositories,
} from "../../app/githubClient";
import { DialogShell } from "../../components/dialogs/AppDialog";
import { loadApiKeyVault } from "../../lib/appStorage";
import { GMAIL_CORE_OAUTH_SCOPES, GOOGLE_CALENDAR_CORE_OAUTH_SCOPES } from "../../lib/googleOAuthScopes";
import { SkillsManagerPanel } from "./SkillsManagerPanel";
import {
  getOpenAiPluginDescription,
  getOpenAiPluginRouteLabel,
  importOpenAiPluginSkills,
  isOpenAiNativePlugin,
  loadOpenAiCodexMarketplace,
  type OpenAiCodexPluginListing,
} from "../../features/plugins/openAiCodexMarketplace";
import { loadSkillRegistry, subscribeSkillRegistry } from "../../services/skillRegistry";
import type { GithubConnectionState, GithubRepository } from "../../types/github";
import type { ApiKeyRecord, ApiKeyVaultState } from "../../types/apiKeys";
import type { CalendarAccountState, CalendarConnectionState } from "../../types/googleCalendar";
import type { GmailAccountState, GmailConnectionState } from "../../types/gmail";
import type { McpConnectionState, McpHttpHeader, McpHttpQueryParam, McpRegistryInstallHint, McpRegistryServerSummary, McpSaveServerRequest, McpServerProgressEvent, McpServerState, McpTestServerRequest, McpTransport } from "../../types/mcp";
import type { SkillRegistryState } from "../../types/skills";
import "../../styles/apps.css";

interface AppsPageProps {
  locationServicesEnabled: boolean;
  onBackToChat: () => void;
  onOpenGithubSettings: () => void;
  onOpenGoogleSettings: () => void;
  onOpenKeysSettings: () => void;
  onOpenRadar: () => void;
}

type GmailActionState = "connect" | "disconnect" | "idle" | "install" | "refresh";
type CalendarActionState = "connect" | "disconnect" | "idle" | "install" | "refresh";
type GithubActionState = "idle" | "install" | "refresh";
type McpActionState = "idle" | "refresh" | "remove" | "save" | "test" | "test-all";
type AppsStatusMessage = { kind: "error" | "success" | "warning"; text: string };
type AppsCatalogSection = "all" | "mcp" | "plugins" | "skills";
type MarketplaceStatusKind = "connected" | "installed" | "ready" | "setup";
const GMAIL_ACCOUNT_LIMIT = 6;
const GOOGLE_CALENDAR_ACCOUNT_LIMIT = 6;
const GOOGLE_HOSTED_OAUTH_SCOPE = [...new Set([...GMAIL_CORE_OAUTH_SCOPES, ...GOOGLE_CALENDAR_CORE_OAUTH_SCOPES])].join(" ");
const MCP_SERVER_LIMIT = 50;
const MCP_PRESET_PAGE_SIZE = 6;
const MCP_REGISTRY_PAGE_SIZE = 5;
const MCP_REGISTRY_RESULT_LIMIT = 18;
const OPENAI_PLUGIN_PAGE_SIZE = 12;

const APP_ICON_URLS = {
  gmail: "https://cdn.simpleicons.org/gmail/EA4335",
  googleCalendar: "https://cdn.simpleicons.org/googlecalendar/4285F4",
  github: "https://cdn.simpleicons.org/github/FFFFFF",
  mcp: "https://modelcontextprotocol.io/favicon.ico",
} as const;

export interface McpServerDraft {
  argsText: string;
  authorizationToken: string;
  command: string;
  enabled: boolean;
  environmentText: string;
  endpoint: string;
  headersText: string;
  id: string;
  name: string;
  queryText: string;
  transport: McpTransport;
  workingDirectory: string;
}

type McpSetupLocation = "bearer" | "environment" | "header" | "query";
type McpSetupRequirementStatus = "missing" | "optional" | "ready";

interface McpSetupRequirement {
  helper: string;
  keyNames?: string[];
  label: string;
  location: McpSetupLocation;
  name: string;
  placeholder?: string;
}

interface McpSetupAlternative {
  id: string;
  label: string;
  requirements: McpSetupRequirement[];
}

interface McpSetupRequirementView {
  requirement: McpSetupRequirement;
  status: McpSetupRequirementStatus;
}

interface McpSetupAlternativeView {
  id: string;
  label: string;
  ready: boolean;
  requirements: McpSetupRequirementView[];
}

interface McpDraftSetupSummary {
  existingServer?: McpServerState;
  issues: string[];
  optionalRequirements: McpSetupRequirementView[];
  preset?: McpProviderPreset;
  requiredAlternatives: McpSetupAlternativeView[];
}

interface McpProviderPreset {
  args?: string[];
  docsUrl?: string;
  command?: string;
  description: string;
  endpoint?: string;
  environmentText?: string;
  headersText?: string;
  id: string;
  name: string;
  note: string;
  optionalSetup?: McpSetupRequirement[];
  publisher: string;
  queryText?: string;
  requiredSetup?: McpSetupAlternative[];
  setupSteps: string[];
  tags: string[];
  transport: McpTransport;
}

interface MarketplacePluginRuntimeState {
  description: string;
  mcpServer?: McpServerState;
  primaryActionLabel: string;
  primaryDisabled: boolean;
  routeLabel: string;
  secondaryActionLabel?: string;
  secondaryDisabled?: boolean;
  skillCount: number;
  statusKind: MarketplaceStatusKind;
  statusLabel: string;
  tags: string[];
}

const APP_SECTION_FILTERS: Array<{ id: AppsCatalogSection; label: string }> = [
  { id: "all", label: "All" },
  { id: "plugins", label: "Plugins" },
  { id: "skills", label: "Skills" },
  { id: "mcp", label: "MCP" },
];

const EMPTY_MCP_DRAFT: McpServerDraft = {
  argsText: "",
  authorizationToken: "",
  command: "",
  enabled: true,
  environmentText: "",
  endpoint: "",
  headersText: "",
  id: "",
  name: "",
  queryText: "",
  transport: "http",
  workingDirectory: "",
};

const EMPTY_MCP_SERVERS: McpServerState[] = [];
const EMPTY_API_KEY_VAULT: ApiKeyVaultState = { keys: [], version: 1 };

const mcpRemoteArgs = (endpoint: string) => ["-y", "mcp-remote@latest", endpoint];

const STRIPE_SECRET_KEY_REQUIREMENT: McpSetupRequirement = {
  helper: "Use a restricted payment-service key. The local payments MCP will not start without it.",
  label: "Payments secret key",
  location: "environment",
  name: "STRIPE_SECRET_KEY",
  placeholder: "sk_live_... or rk_live_...",
};

const REDIS_URL_REQUIREMENT: McpSetupRequirement = {
  helper: "Use redis://localhost:6379 for local Redis, or paste your hosted Redis URL here so credentials stay in secure storage.",
  label: "Redis URL",
  location: "environment",
  name: "REDIS_URL",
  placeholder: "redis://localhost:6379",
};

const MONGODB_CONNECTION_STRING_REQUIREMENT: McpSetupRequirement = {
  helper: "Use a MongoDB or Atlas connection string. MongoDB recommends environment variables for sensitive connection strings.",
  label: "MongoDB connection string",
  location: "environment",
  name: "MDB_MCP_CONNECTION_STRING",
  placeholder: "mongodb+srv://...",
};

const MONGODB_ATLAS_CLIENT_ID_REQUIREMENT: McpSetupRequirement = {
  helper: "Use Atlas service account credentials when you want Atlas project tools instead of a direct connection string.",
  label: "Atlas client ID",
  location: "environment",
  name: "MDB_MCP_API_CLIENT_ID",
  placeholder: "Atlas service account client ID",
};

const MONGODB_ATLAS_CLIENT_SECRET_REQUIREMENT: McpSetupRequirement = {
  helper: "Atlas client secrets are saved in secure storage and hidden after saving.",
  label: "Atlas client secret",
  location: "environment",
  name: "MDB_MCP_API_CLIENT_SECRET",
  placeholder: "Atlas service account client secret",
};

const CONTEXT7_API_KEY_REQUIREMENT: McpSetupRequirement = {
  helper: "Optional. Adds higher rate limits and private repo access for Context7.",
  label: "Context7 API key",
  location: "header",
  name: "CONTEXT7_API_KEY",
  placeholder: "Context7 API key",
};

const HTTP_BEARER_TOKEN_REQUIREMENT: McpSetupRequirement = {
  helper: "Paste a provider token for direct HTTP MCP calls. Gilbert sends it as an Authorization bearer token.",
  label: "Bearer token",
  location: "bearer",
  name: "Authorization",
  placeholder: "Provider access token",
};

const AWS_ACCESS_KEY_ID_REQUIREMENT: McpSetupRequirement = {
  helper: "Optional fallback for AWS MCP when you do not want to rely on an existing AWS CLI/profile login.",
  label: "AWS access key ID",
  location: "environment",
  name: "AWS_ACCESS_KEY_ID",
  placeholder: "AKIA...",
};

const AWS_SECRET_ACCESS_KEY_REQUIREMENT: McpSetupRequirement = {
  helper: "Optional fallback secret for AWS MCP. Prefer least-privilege IAM credentials.",
  label: "AWS secret access key",
  location: "environment",
  name: "AWS_SECRET_ACCESS_KEY",
  placeholder: "AWS secret access key",
};

const AWS_SESSION_TOKEN_REQUIREMENT: McpSetupRequirement = {
  helper: "Optional session token for temporary AWS credentials.",
  label: "AWS session token",
  location: "environment",
  name: "AWS_SESSION_TOKEN",
  placeholder: "AWS session token",
};

const BRAVE_API_KEY_REQUIREMENT: McpSetupRequirement = {
  helper: "Required by @modelcontextprotocol/server-brave-search.",
  label: "Brave Search API key",
  location: "environment",
  name: "BRAVE_API_KEY",
  placeholder: "Brave Search API key",
};

const EXA_API_KEY_REQUIREMENT: McpSetupRequirement = {
  helper: "Required by exa-mcp-server when using the local stdio package.",
  label: "Exa API key",
  location: "environment",
  name: "EXA_API_KEY",
  placeholder: "Exa API key",
};

const FIRECRAWL_API_KEY_REQUIREMENT: McpSetupRequirement = {
  helper: "Required for hosted Firecrawl API usage. Self-hosted Firecrawl can use FIRECRAWL_API_URL instead.",
  label: "Firecrawl API key",
  location: "environment",
  name: "FIRECRAWL_API_KEY",
  placeholder: "fc-...",
};

const TAVILY_API_KEY_REQUIREMENT: McpSetupRequirement = {
  helper: "Required by tavily-mcp for local stdio search, extract, map, and crawl tools.",
  label: "Tavily API key",
  location: "environment",
  name: "TAVILY_API_KEY",
  placeholder: "tvly-...",
};

const HEROKU_API_KEY_REQUIREMENT: McpSetupRequirement = {
  helper: "Optional fallback for Heroku MCP when you use the npx server path instead of an existing Heroku CLI login.",
  label: "Heroku API key",
  location: "environment",
  name: "HEROKU_API_KEY",
  placeholder: "Heroku auth token",
};

const PULUMI_ACCESS_TOKEN_REQUIREMENT: McpSetupRequirement = {
  helper: "Required for Pulumi deployment, stack output, refresh, and resource-search tools.",
  label: "Pulumi access token",
  location: "environment",
  name: "PULUMI_ACCESS_TOKEN",
  placeholder: "pul-...",
};

const NETLIFY_PERSONAL_ACCESS_TOKEN_REQUIREMENT: McpSetupRequirement = {
  helper: "Optional troubleshooting fallback for @netlify/mcp when browser or CLI auth does not complete.",
  label: "Netlify personal access token",
  location: "environment",
  name: "NETLIFY_PERSONAL_ACCESS_TOKEN",
  placeholder: "Netlify PAT",
};

const APIFY_TOKEN_REQUIREMENT: McpSetupRequirement = {
  helper: "Required by @apify/actors-mcp-server for local Actor search, runs, datasets, and Apify platform tools.",
  label: "Apify API token",
  location: "environment",
  name: "APIFY_TOKEN",
  placeholder: "apify_api_...",
};

const BROWSERBASE_HOSTED_API_KEY_REQUIREMENT: McpSetupRequirement = {
  helper: "Required by Browserbase hosted MCP as the browserbaseApiKey query parameter. Store the value in Keys as BROWSERBASE_API_KEY.",
  keyNames: ["BROWSERBASE_API_KEY"],
  label: "Browserbase API key",
  location: "query",
  name: "browserbaseApiKey",
  placeholder: "Browserbase API key",
};

const LINKEDIN_ACCESS_TOKEN_REQUIREMENT: McpSetupRequirement = {
  helper: "Optional for setup and user-supplied research tools, required for authenticated LinkedIn self-profile reads. Store the member OAuth access token in Keys.",
  label: "LinkedIn access token",
  location: "environment",
  name: "LINKEDIN_ACCESS_TOKEN",
  placeholder: "LinkedIn member OAuth access token",
};

const SLACK_BOT_TOKEN_REQUIREMENT: McpSetupRequirement = {
  helper: "Required Slack Bot User OAuth token for @modelcontextprotocol/server-slack.",
  label: "Slack bot token",
  location: "environment",
  name: "SLACK_BOT_TOKEN",
  placeholder: "xoxb-...",
};

const SLACK_TEAM_ID_REQUIREMENT: McpSetupRequirement = {
  helper: "Required Slack workspace/team ID for @modelcontextprotocol/server-slack.",
  label: "Slack team ID",
  location: "environment",
  name: "SLACK_TEAM_ID",
  placeholder: "T01234567",
};

const MCP_FEATURED_PRESETS: McpProviderPreset[] = [
  {
    args: ["-y", "firebase-tools@latest", "mcp"],
    command: "npx",
    description: "Official app backend MCP for projects, auth, database rules, docs, and messaging.",
    docsUrl: "https://firebase.google.com/docs/cli/mcp-server",
    id: "firebase",
    name: "App Backend",
    note: "Gilbert auto-resolves npm/npx shims on Windows. If the MCP login link fails with a Google code-challenge error, close that tab and run the provider CLI login in a terminal, then Save and test again.",
    publisher: "Google",
    setupSteps: [
      "Uses the official app backend MCP server.",
      "Requires Google sign-in on this machine.",
      "Hosting deploy tools still need an explicit project and hosting target/site.",
    ],
    tags: ["Auth", "Database", "Hosting"],
    transport: "stdio",
  },
  {
    description: "Official GoDaddy Domains MCP for GoDaddy domain availability, public domain search, suggestions, and availability checks.",
    docsUrl: "https://developer.godaddy.com/mcp",
    endpoint: "https://api.godaddy.com/v1/domains/mcp",
    id: "godaddy",
    name: "GoDaddy Domains",
    note: "Uses GoDaddy's public read-only Domains MCP endpoint. It can search and check domain availability, but it cannot buy domains, update DNS records, or change GoDaddy account settings.",
    publisher: "GoDaddy",
    setupSteps: [
      "Public Streamable HTTP MCP endpoint; no GoDaddy token is required for domain search.",
      "Use it for domain brainstorming and availability checks before configuring custom domains.",
      "DNS changes still require GoDaddy's dashboard or a separate GoDaddy Domains API integration; do not treat this MCP as write-capable.",
    ],
    tags: ["Domains", "Availability", "Public"],
    transport: "http",
  },
  {
    args: mcpRemoteArgs("https://mcp.figma.com/mcp"),
    command: "npx",
    description: "Preferred Figma remote MCP for design context, components, variables, Make resources, and design-to-code work.",
    docsUrl: "https://help.figma.com/hc/en-us/articles/32132100833559-Guide-to-the-Dev-Mode-MCP-Server",
    id: "figma-remote",
    name: "Figma Remote",
    note: "Uses mcp-remote so Figma OAuth can open in the browser. If your org requires desktop-only access, use the Figma Desktop preset instead.",
    publisher: "Figma",
    setupSteps: [
      "Uses mcp-remote for Figma OAuth in the browser.",
      "No API key is entered in Gilbert for the hosted Figma flow.",
      "Use Figma Desktop instead if your organization requires localhost Dev Mode access.",
    ],
    tags: ["Design", "OAuth", "Dev Mode"],
    transport: "stdio",
  },
  {
    description: "Figma desktop MCP for selected design context, variables, code guidance, and design-to-code work.",
    endpoint: "http://127.0.0.1:3845/mcp",
    id: "figma-desktop",
    name: "Figma Desktop",
    note: "Open Figma Desktop, switch a file to Dev Mode, and enable the desktop MCP server before testing this localhost endpoint.",
    publisher: "Figma",
    setupSteps: [
      "Open Figma Desktop on this machine.",
      "Switch a file into Dev Mode and enable the desktop MCP server.",
      "Keep Figma running while testing this localhost endpoint.",
    ],
    tags: ["Design", "Dev Mode", "Local"],
    transport: "http",
  },
  {
    args: mcpRemoteArgs("https://mcp.supabase.com/mcp?read_only=true"),
    command: "npx",
    description: "Official Supabase MCP for database, logs, docs, Edge Functions, storage, and project management.",
    docsUrl: "https://supabase.com/docs/guides/getting-started/mcp",
    id: "supabase",
    name: "Supabase",
    note: "Starts in read-only mode and uses mcp-remote for the Supabase OAuth flow. For CI-style PAT auth, switch this draft to HTTP and paste the PAT in the bearer token field.",
    publisher: "Supabase",
    setupSteps: [
      "Uses mcp-remote with Supabase OAuth.",
      "Starts with read_only=true to reduce accidental writes.",
      "For personal access token setups, use a direct HTTP endpoint and the bearer token field.",
    ],
    tags: ["Postgres", "Auth", "Storage"],
    transport: "stdio",
  },
  {
    args: ["mcp-proxy-for-aws@latest", "https://aws-mcp.us-east-1.api.aws/mcp", "--metadata", "AWS_REGION=us-east-1"],
    command: "uvx",
    description: "AWS MCP Server through the official SigV4 proxy for current AWS docs, skills, and AWS API operations.",
    docsUrl: "https://awslabs.github.io/mcp/",
    id: "aws",
    name: "AWS MCP",
    note: "Requires uv/uvx plus valid AWS CLI credentials on the machine. Change AWS_REGION in Arguments if your default operating region differs.",
    optionalSetup: [AWS_ACCESS_KEY_ID_REQUIREMENT, AWS_SECRET_ACCESS_KEY_REQUIREMENT, AWS_SESSION_TOKEN_REQUIREMENT],
    publisher: "AWS",
    setupSteps: [
      "Requires uv/uvx installed on this machine.",
      "Uses AWS SigV4 credentials from your local AWS CLI/profile chain.",
      "If you use explicit IAM keys instead, store them in Settings > Keys and apply them as secure environment values.",
      "Change AWS_REGION in Arguments before testing if you operate outside us-east-1.",
    ],
    tags: ["IAM", "Docs", "Resources"],
    transport: "stdio",
  },
  {
    args: ["-y", "@azure/mcp@latest", "server", "start"],
    command: "npx",
    description: "Official Azure MCP Server for Azure resources, docs, Terraform guidance, CLI generation, and infrastructure operations.",
    docsUrl: "https://learn.microsoft.com/azure/developer/azure-mcp-server/",
    id: "azure",
    name: "Azure MCP",
    note: "Uses local Azure identity. Run az login or sign in through your Microsoft tooling before testing.",
    publisher: "Microsoft",
    setupSteps: [
      "Requires Node.js and npx on this machine.",
      "Uses local Azure identity through Azure CLI, Azure PowerShell, or Microsoft developer tooling.",
      "Run az login first if no Azure account is available to the process.",
    ],
    tags: ["Azure", "Resources"],
    transport: "stdio",
  },
  {
    args: mcpRemoteArgs("https://gitlab.com/api/v4/mcp"),
    command: "npx",
    description: "Official GitLab MCP for projects, issues, merge requests, repository context, and Duo workflows.",
    docsUrl: "https://docs.gitlab.com/user/project/remote_development/model_context_protocol/",
    id: "gitlab",
    name: "GitLab",
    note: "Uses mcp-remote for GitLab OAuth. For self-managed GitLab, replace gitlab.com in the argument URL with your instance host.",
    publisher: "GitLab",
    setupSteps: [
      "Uses mcp-remote for GitLab OAuth.",
      "For self-managed GitLab, replace the endpoint host in Arguments.",
      "No token is pasted into Gilbert for the default OAuth bridge path.",
    ],
    tags: ["Repos", "Issues", "OAuth"],
    transport: "stdio",
  },
  {
    description: "Official GitHub MCP for repositories, issues, pull requests, Actions, code search, and security context.",
    docsUrl: "https://docs.github.com/en/copilot/how-tos/context/model-context-protocol/using-the-github-mcp-server",
    endpoint: "https://api.githubcopilot.com/mcp/",
    id: "github-mcp",
    name: "GitHub MCP",
    note: "Paste a GitHub PAT in the HTTP bearer token field for the remote MCP server. Gilbert's native GitHub connector remains available for app-managed GitHub workflows.",
    publisher: "GitHub",
    requiredSetup: [
      {
        id: "github-bearer",
        label: "GitHub token",
        requirements: [{
          ...HTTP_BEARER_TOKEN_REQUIREMENT,
          helper: "Use a GitHub personal access token for the direct HTTP MCP endpoint.",
          placeholder: "github_pat_...",
        }],
      },
    ],
    setupSteps: [
      "Direct HTTP MCP calls require an Authorization bearer token.",
      "Use Gilbert's native GitHub connector for app-managed repository workflows when possible.",
      "Refresh tools after saving so chat can see the GitHub MCP tool list.",
    ],
    tags: ["Repos", "PRs", "Bearer"],
    transport: "http",
  },
  {
    args: ["./plugins/linkedin/scripts/linkedin-mcp-server.mjs"],
    command: "node",
    description: "Gilbert LinkedIn MCP for compliant profile setup, authenticated self-profile reads, pasted-profile research briefs, and post draft review.",
    docsUrl: "https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access",
    environmentText: "LINKEDIN_ACCESS_TOKEN=",
    id: "linkedin",
    name: "LinkedIn",
    note: "Runs Gilbert's local LinkedIn MCP server. It can guide setup and analyze user-supplied profile text without a token; authenticated self-profile reads require LINKEDIN_ACCESS_TOKEN from a LinkedIn OAuth flow. It does not scrape LinkedIn, update profiles, message people, or publish posts.",
    optionalSetup: [LINKEDIN_ACCESS_TOKEN_REQUIREMENT],
    publisher: "Gilbert Codex",
    setupSteps: [
      "Uses a local MCP server bundled in plugins/linkedin.",
      "Setup and user-supplied profile research tools work without LinkedIn credentials.",
      "For authenticated self-profile reads, create a LinkedIn developer app, complete OAuth with openid/profile/email, save LINKEDIN_ACCESS_TOKEN in Keys, and apply it as secure environment.",
      "The server intentionally avoids scraping, browser automation, profile writes, connection requests, messages, and post publishing.",
    ],
    tags: ["Profiles", "Research", "OAuth"],
    transport: "stdio",
  },
  {
    args: mcpRemoteArgs("https://mcp.linear.app/mcp"),
    command: "npx",
    description: "Official Linear MCP for issues, projects, comments, and product planning workflows.",
    docsUrl: "https://linear.app/docs/mcp",
    id: "linear",
    name: "Linear",
    note: "Uses mcp-remote for Linear OAuth. If authentication gets stuck, clear mcp-remote auth for Linear and test again.",
    publisher: "Linear",
    setupSteps: [
      "Uses mcp-remote for Linear OAuth.",
      "No API key is entered in Gilbert for the default hosted Linear flow.",
      "Clear mcp-remote auth for Linear if the OAuth flow gets stuck.",
    ],
    tags: ["Issues", "Projects", "OAuth"],
    transport: "stdio",
  },
  {
    args: ["-y", "@stripe/mcp@latest"],
    command: "npx",
    description: "Official local payments MCP for customers, payment links, billing, docs, and API-backed commerce work.",
    docsUrl: "https://docs.stripe.com/mcp",
    environmentText: "STRIPE_SECRET_KEY=",
    id: "stripe",
    name: "Payments",
    note: "Paste a restricted payment-service key into Environment. Gilbert stores stdio env values in secure storage.",
    requiredSetup: [
      {
        id: "stripe-secret",
        label: "Payments restricted key",
        requirements: [STRIPE_SECRET_KEY_REQUIREMENT],
      },
    ],
    publisher: "Payments",
    setupSteps: [
      "The local payments MCP server cannot start without its restricted API key.",
      "Use a restricted API key with only the payment permissions you want chat to have.",
      "Gilbert stores the key in the desktop secure store and hides it after saving.",
    ],
    tags: ["Payments", "Billing", "Secure env"],
    transport: "stdio",
  },
  {
    args: mcpRemoteArgs("https://mcp.atlassian.com/v1/mcp/authv2"),
    command: "npx",
    description: "Official Atlassian Rovo MCP for Jira, Confluence, Compass, and work-management context.",
    docsUrl: "https://support.atlassian.com/rovo/docs/setting-up-ides/",
    id: "atlassian",
    name: "Atlassian",
    note: "Uses Atlassian's current /mcp/authv2 endpoint through mcp-remote so OAuth can complete in the browser.",
    publisher: "Atlassian",
    setupSteps: [
      "Uses mcp-remote for Atlassian OAuth.",
      "The authv2 endpoint covers Jira, Confluence, Compass, and Rovo workflows.",
      "No token is pasted into Gilbert for the default OAuth bridge path.",
    ],
    tags: ["Jira", "Confluence", "OAuth"],
    transport: "stdio",
  },
  {
    args: mcpRemoteArgs("https://mcp.vercel.com"),
    command: "npx",
    description: "Official Vercel MCP for projects, deployments, domains, logs, teams, and platform operations.",
    docsUrl: "https://vercel.com/docs/mcp/vercel-mcp",
    id: "vercel",
    name: "Vercel",
    note: "Uses mcp-remote for Vercel OAuth. Provider sign-in opens on first test or first tool listing.",
    publisher: "Vercel",
    setupSteps: [
      "Uses mcp-remote for Vercel OAuth.",
      "Provider sign-in opens during the first connection test or tool refresh.",
      "Refresh tools after OAuth so chat can see deployment and project operations.",
    ],
    tags: ["Deployments", "Logs", "OAuth"],
    transport: "stdio",
  },
  {
    args: ["-y", "@netlify/mcp"],
    command: "npx",
    description: "Official Netlify MCP for sites, deploys, project setup, teams, forms, environment variables, and platform operations.",
    docsUrl: "https://docs.netlify.com/welcome/build-with-ai/netlify-mcp-server/",
    environmentText: "NETLIFY_PERSONAL_ACCESS_TOKEN=",
    id: "netlify",
    name: "Netlify",
    note: "Runs the official @netlify/mcp package. Most setups can authenticate normally; add NETLIFY_PERSONAL_ACCESS_TOKEN only as a fallback.",
    optionalSetup: [NETLIFY_PERSONAL_ACCESS_TOKEN_REQUIREMENT],
    publisher: "Netlify",
    setupSteps: [
      "Requires Node.js 22 or newer for the best Netlify MCP experience.",
      "Runs the official @netlify/mcp server.",
      "If auth fails, save NETLIFY_PERSONAL_ACCESS_TOKEN in Keys and apply it as secure environment.",
    ],
    tags: ["Deployments", "Sites", "CLI"],
    transport: "stdio",
  },
  {
    args: ["mcp:start"],
    command: "heroku",
    description: "Heroku Platform MCP for apps, add-ons, config vars, releases, logs, pipeline, and platform operations.",
    docsUrl: "https://github.com/heroku/heroku-mcp-server",
    environmentText: "HEROKU_API_KEY=",
    id: "heroku",
    name: "Heroku",
    note: "Preferred path uses `heroku mcp:start` so your existing Heroku CLI login is reused. Save HEROKU_API_KEY only as a fallback for direct npx setups.",
    optionalSetup: [HEROKU_API_KEY_REQUIREMENT],
    publisher: "Heroku",
    setupSteps: [
      "Install Heroku CLI 10.8.1 or newer.",
      "Run heroku login before testing, or save HEROKU_API_KEY in Settings > Keys as a fallback.",
      "Use scoped Heroku access for production app operations.",
    ],
    tags: ["Deployments", "Apps", "CLI"],
    transport: "stdio",
  },
  {
    args: ["-y", "@pulumi/mcp-server@latest", "stdio"],
    command: "npx",
    description: "Pulumi MCP for IaC registry docs, previews, deployments, stack outputs, refresh, and resource search.",
    docsUrl: "https://www.pulumi.com/docs/iac/using-pulumi/mcp-server/",
    environmentText: "PULUMI_ACCESS_TOKEN=",
    id: "pulumi",
    name: "Pulumi",
    note: "Registry/documentation tools can orient infrastructure work; Pulumi deployment tools need PULUMI_ACCESS_TOKEN plus a working Pulumi CLI/project.",
    optionalSetup: [PULUMI_ACCESS_TOKEN_REQUIREMENT],
    publisher: "Pulumi",
    setupSteps: [
      "Install the Pulumi CLI for preview/deploy tools.",
      "Save PULUMI_ACCESS_TOKEN in Settings > Keys for Pulumi deployment and resource-search operations.",
      "Mount or open the intended Pulumi project before using stack-changing tools.",
    ],
    tags: ["IaC", "Deployments"],
    transport: "stdio",
  },
  {
    args: mcpRemoteArgs("https://mcp.neon.tech/mcp"),
    command: "npx",
    description: "Official Neon MCP for serverless Postgres projects, branches, databases, roles, and SQL workflows.",
    docsUrl: "https://neon.tech/docs/ai/neon-mcp-server",
    id: "neon",
    name: "Neon",
    note: "Uses Neon's hosted MCP endpoint through mcp-remote for OAuth. Store NEON_API_KEY in Keys for custom Neon skills or HTTP bearer setups.",
    publisher: "Neon",
    setupSteps: [
      "Uses mcp-remote with Neon's hosted MCP endpoint.",
      "No API key is pasted into Gilbert for the default OAuth bridge path.",
      "For direct HTTP bearer setups, store NEON_API_KEY in Settings > Keys.",
    ],
    tags: ["Postgres", "Databases", "OAuth"],
    transport: "stdio",
  },
  {
    args: mcpRemoteArgs("https://mcp.notion.com/mcp"),
    command: "npx",
    description: "Official Notion MCP for pages, databases, workspace search, docs, tasks, and planning content.",
    docsUrl: "https://developers.notion.com/docs/mcp",
    id: "notion",
    name: "Notion",
    note: "Uses mcp-remote because Notion requires user OAuth and does not support bearer-token auth for its hosted MCP.",
    publisher: "Notion",
    setupSteps: [
      "Uses mcp-remote for Notion OAuth.",
      "No API key is entered in Gilbert for Notion's hosted MCP server.",
      "Provider sign-in opens on test or first tool listing.",
    ],
    tags: ["Docs", "Tasks", "OAuth"],
    transport: "stdio",
  },
  {
    description: "Cloudflare's API MCP exposes Cloudflare account operations with a compact code-mode tool surface.",
    docsUrl: "https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/",
    endpoint: "https://mcp.cloudflare.com/mcp",
    id: "cloudflare-api",
    name: "Cloudflare API",
    note: "Paste a Cloudflare API token in the HTTP bearer token field, or switch to mcp-remote if you want browser OAuth instead.",
    publisher: "Cloudflare",
    requiredSetup: [
      {
        id: "cloudflare-bearer",
        label: "Cloudflare token",
        requirements: [{
          ...HTTP_BEARER_TOKEN_REQUIREMENT,
          helper: "Use a Cloudflare API token for the direct HTTP MCP endpoint, or switch to mcp-remote for browser OAuth.",
          placeholder: "Cloudflare API token",
        }],
      },
    ],
    setupSteps: [
      "Direct HTTP MCP calls require a bearer token in Gilbert.",
      "For OAuth instead of a token, change this preset to the mcp-remote stdio bridge.",
      "Use a scoped Cloudflare API token with only the account permissions you need.",
    ],
    tags: ["Workers", "DNS", "Bearer"],
    transport: "http",
  },
  {
    description: "Cloudflare Docs MCP gives agents current Cloudflare reference material without account access.",
    endpoint: "https://docs.mcp.cloudflare.com/mcp",
    id: "cloudflare-docs",
    name: "Cloudflare Docs",
    note: "Public docs-focused endpoint. Save and test directly; no account token should be needed for documentation search.",
    publisher: "Cloudflare",
    setupSteps: [
      "Public Cloudflare documentation endpoint.",
      "No account token should be needed for docs search.",
      "Save and test directly.",
    ],
    tags: ["Docs", "Workers", "Public"],
    transport: "http",
  },
  {
    description: "Cloudflare Browser MCP fetches pages, converts web content to markdown, and can capture screenshots.",
    endpoint: "https://browser.mcp.cloudflare.com/mcp",
    id: "cloudflare-browser",
    name: "Cloudflare Browser",
    note: "Useful for web inspection flows. If Cloudflare asks for account auth, add a bearer token or use mcp-remote for OAuth.",
    publisher: "Cloudflare",
    setupSteps: [
      "Hosted Cloudflare browser endpoint for web inspection.",
      "If your account policy requires auth, use the bearer token field or mcp-remote OAuth.",
      "Refresh tools after saving so chat can see browser actions.",
    ],
    tags: ["Browser", "Markdown", "Screenshots"],
    transport: "http",
  },
  {
    description: "Context7 MCP pulls current library and API documentation into coding prompts.",
    docsUrl: "https://context7.com/docs/clients/cli",
    endpoint: "https://mcp.context7.com/mcp",
    headersText: "CONTEXT7_API_KEY=",
    id: "context7",
    name: "Context7",
    note: "Uses Context7's remote HTTP MCP endpoint. A Context7 API key is optional for higher limits and private repositories; enter it as CONTEXT7_API_KEY in custom headers.",
    optionalSetup: [CONTEXT7_API_KEY_REQUIREMENT],
    publisher: "Upstash",
    setupSteps: [
      "Uses Context7's remote HTTP endpoint.",
      "Basic docs lookup works without a key.",
      "Add CONTEXT7_API_KEY as a custom header for higher rate limits or private repositories.",
    ],
    tags: ["Docs", "Libraries", "Coding"],
    transport: "http",
  },
  {
    args: ["-y", "@modelcontextprotocol/server-brave-search"],
    command: "npx",
    description: "Official Brave Search MCP for web and local search with freshness and pagination controls.",
    docsUrl: "https://www.npmjs.com/package/@modelcontextprotocol/server-brave-search",
    environmentText: "BRAVE_API_KEY=",
    id: "brave-search",
    name: "Brave Search",
    note: "Requires BRAVE_API_KEY. Save it in Settings > Keys and apply it as secure environment before testing.",
    publisher: "Model Context Protocol",
    requiredSetup: [
      {
        id: "brave-api-key",
        label: "Brave API key",
        requirements: [BRAVE_API_KEY_REQUIREMENT],
      },
    ],
    setupSteps: [
      "Create a Brave Search API key in the Brave developer dashboard.",
      "Save BRAVE_API_KEY in Settings > Keys.",
      "Apply the saved key here, then test so chat can see brave_web_search and brave_local_search.",
    ],
    tags: ["Search", "Web", "Local"],
    transport: "stdio",
  },
  {
    args: ["-y", "exa-mcp-server"],
    command: "npx",
    description: "Exa MCP for web search, page fetch, code search, company research, and live crawling workflows.",
    docsUrl: "https://docs.exa.ai/reference/exa-mcp",
    environmentText: "EXA_API_KEY=",
    id: "exa",
    name: "Exa",
    note: "Uses the local npm package with EXA_API_KEY as secure environment instead of putting secrets in an MCP URL query string.",
    publisher: "Exa",
    requiredSetup: [
      {
        id: "exa-api-key",
        label: "Exa API key",
        requirements: [EXA_API_KEY_REQUIREMENT],
      },
    ],
    setupSteps: [
      "Create an Exa API key.",
      "Save EXA_API_KEY in Settings > Keys.",
      "Apply the saved key here, then test so chat can use Exa search and fetch tools.",
    ],
    tags: ["Search", "Research", "Web"],
    transport: "stdio",
  },
  {
    args: ["-y", "firecrawl-mcp"],
    command: "npx",
    description: "Firecrawl MCP for search, scrape, crawl, map, structured extraction, and agentic web research.",
    docsUrl: "https://github.com/firecrawl/firecrawl-mcp-server",
    environmentText: "FIRECRAWL_API_KEY=",
    id: "firecrawl",
    name: "Firecrawl",
    note: "Hosted Firecrawl requires FIRECRAWL_API_KEY. Gilbert stores it as secure environment; self-hosted users can add FIRECRAWL_API_URL manually.",
    publisher: "Firecrawl",
    requiredSetup: [
      {
        id: "firecrawl-api-key",
        label: "Firecrawl API key",
        requirements: [FIRECRAWL_API_KEY_REQUIREMENT],
      },
    ],
    setupSteps: [
      "Create a Firecrawl API key for the hosted API.",
      "Save FIRECRAWL_API_KEY in Settings > Keys.",
      "For self-hosted Firecrawl, also add FIRECRAWL_API_URL to Environment before testing.",
    ],
    tags: ["Scrape", "Search", "Research"],
    transport: "stdio",
  },
  {
    args: ["-y", "tavily-mcp@latest"],
    command: "npx",
    description: "Tavily MCP for real-time web search, extraction, site maps, and crawls.",
    docsUrl: "https://github.com/tavily-ai/tavily-mcp",
    environmentText: "TAVILY_API_KEY=",
    id: "tavily",
    name: "Tavily",
    note: "Uses TAVILY_API_KEY as secure environment for the local MCP server instead of embedding API keys in remote MCP URLs.",
    publisher: "Tavily",
    requiredSetup: [
      {
        id: "tavily-api-key",
        label: "Tavily API key",
        requirements: [TAVILY_API_KEY_REQUIREMENT],
      },
    ],
    setupSteps: [
      "Create a Tavily API key.",
      "Save TAVILY_API_KEY in Settings > Keys.",
      "Apply the saved key here, then test so chat can use Tavily search, extract, map, and crawl tools.",
    ],
    tags: ["Search", "Extract", "Crawl"],
    transport: "stdio",
  },
  {
    args: ["-y", "@apify/actors-mcp-server"],
    command: "npx",
    description: "Apify MCP for Actor discovery, web scraping, browser automation, datasets, and structured extraction workflows.",
    docsUrl: "https://docs.apify.com/platform/integrations/agent-onboarding",
    environmentText: "APIFY_TOKEN=",
    id: "apify",
    name: "Apify",
    note: "Uses the local stdio package with APIFY_TOKEN as secure environment. Apify also offers a hosted OAuth MCP endpoint for clients that support remote auth.",
    publisher: "Apify",
    requiredSetup: [
      {
        id: "apify-token",
        label: "Apify API token",
        requirements: [APIFY_TOKEN_REQUIREMENT],
      },
    ],
    setupSteps: [
      "Create an Apify API token from the Apify console.",
      "Save APIFY_TOKEN in Settings > Keys.",
      "Apply the saved key here, then test so chat can search Actors, run Actors, and read datasets through MCP.",
      "Use cost controls such as memory, timeout, or maxTotalChargeUsd when letting agents run Actors.",
    ],
    tags: ["Scraping", "Actors", "Datasets"],
    transport: "stdio",
  },
  {
    description: "Browserbase hosted MCP for browser automation, navigation, extraction, screenshots, and Stagehand actions.",
    docsUrl: "https://docs.browserbase.com/integrations/mcp/setup",
    endpoint: "https://mcp.browserbase.com/mcp",
    id: "browserbase",
    name: "Browserbase",
    note: "Uses Browserbase's hosted Streamable HTTP MCP endpoint. The API key is sent as a secure query parameter instead of being stored directly in the endpoint URL.",
    publisher: "Browserbase",
    queryText: "browserbaseApiKey=",
    requiredSetup: [
      {
        id: "browserbase-hosted-api-key",
        label: "Browserbase hosted API key",
        requirements: [BROWSERBASE_HOSTED_API_KEY_REQUIREMENT],
      },
    ],
    setupSteps: [
      "Create or copy a Browserbase API key from the Browserbase dashboard.",
      "Save BROWSERBASE_API_KEY in Settings > Keys.",
      "Apply the saved key as browserbaseApiKey, then test so chat can navigate pages, act on elements, extract data, and manage Browserbase sessions.",
      "Keep model provider keys on the Models page; custom Browserbase modelApiKey setups can be added manually only when needed.",
    ],
    tags: ["Browser", "Automation", "Screenshots"],
    transport: "http",
  },
  {
    args: ["-y", "@modelcontextprotocol/server-redis"],
    command: "npx",
    description: "Official Redis MCP for reading, writing, querying, and managing Redis data during development.",
    docsUrl: "https://www.npmjs.com/package/@modelcontextprotocol/server-redis",
    environmentText: "REDIS_URL=redis://localhost:6379",
    id: "redis",
    name: "Redis",
    note: "Uses the official @modelcontextprotocol/server-redis package. Keep Redis URLs in REDIS_URL so passwords are stored in secure storage instead of command arguments.",
    requiredSetup: [
      {
        id: "redis-url",
        label: "Redis URL",
        requirements: [REDIS_URL_REQUIREMENT],
      },
    ],
    publisher: "Redis",
    setupSteps: [
      "Requires a reachable Redis or hosted Redis endpoint.",
      "REDIS_URL is stored as a secure stdio environment value.",
      "Use redis://127.0.0.1:6379 if localhost resolution fails on Windows.",
    ],
    tags: ["Cache", "Data", "Secure env"],
    transport: "stdio",
  },
  {
    args: ["-y", "mongodb-mcp-server@latest", "--readOnly"],
    command: "npx",
    description: "Official MongoDB MCP for Atlas or self-hosted MongoDB schema, queries, and database management.",
    docsUrl: "https://www.npmjs.com/package/mongodb-mcp-server",
    environmentText: "MDB_MCP_CONNECTION_STRING=\nMDB_MCP_API_CLIENT_ID=\nMDB_MCP_API_CLIENT_SECRET=",
    id: "mongodb",
    name: "MongoDB",
    note: "MongoDB will not start unless configured. Add either MDB_MCP_CONNECTION_STRING or both Atlas service-account credentials; Gilbert stores them as secure env values.",
    publisher: "MongoDB",
    requiredSetup: [
      {
        id: "mongodb-connection-string",
        label: "Connection string",
        requirements: [MONGODB_CONNECTION_STRING_REQUIREMENT],
      },
      {
        id: "mongodb-atlas-credentials",
        label: "Atlas service account",
        requirements: [MONGODB_ATLAS_CLIENT_ID_REQUIREMENT, MONGODB_ATLAS_CLIENT_SECRET_REQUIREMENT],
      },
    ],
    setupSteps: [
      "Runs MongoDB MCP in read-only mode by default.",
      "Provide a connection string, or provide both Atlas service-account client ID and secret.",
      "MongoDB explicitly recommends environment variables for sensitive credentials.",
    ],
    tags: ["Atlas", "Database", "Secure env"],
    transport: "stdio",
  },
  {
    args: ["-y", "@modelcontextprotocol/server-postgres", "postgresql://localhost/mydb"],
    command: "npx",
    description: "Official read-only Postgres MCP for schema inspection and SQL query context.",
    docsUrl: "https://www.npmjs.com/package/@modelcontextprotocol/server-postgres",
    id: "postgres",
    name: "Postgres",
    note: "Replace the final argument with your read-only Postgres connection string before testing. Avoid high-privilege database users.",
    publisher: "Model Context Protocol",
    setupSteps: [
      "Replace postgresql://localhost/mydb with a reachable Postgres database URL.",
      "Use a read-only or least-privilege database user.",
      "Connection strings live in MCP arguments for this official server, so review them before sharing configs.",
    ],
    tags: ["Database", "SQL", "Read-only"],
    transport: "stdio",
  },
  {
    args: ["-y", "@modelcontextprotocol/server-slack"],
    command: "npx",
    description: "Official Slack MCP for channels, messages, threads, reactions, users, and workspace communication.",
    docsUrl: "https://www.npmjs.com/package/@modelcontextprotocol/server-slack",
    environmentText: "SLACK_BOT_TOKEN=\nSLACK_TEAM_ID=\nSLACK_CHANNEL_IDS=",
    id: "slack",
    name: "Slack",
    note: "Requires a Slack bot token and team ID. Optional SLACK_CHANNEL_IDS can limit channel access.",
    publisher: "Model Context Protocol",
    requiredSetup: [
      {
        id: "slack-bot-workspace",
        label: "Slack app credentials",
        requirements: [SLACK_BOT_TOKEN_REQUIREMENT, SLACK_TEAM_ID_REQUIREMENT],
      },
    ],
    setupSteps: [
      "Create or reuse a Slack app with the required bot scopes.",
      "Save SLACK_BOT_TOKEN and SLACK_TEAM_ID in Settings > Keys.",
      "Optionally set SLACK_CHANNEL_IDS to limit channel access before testing.",
    ],
    tags: ["Chat", "Workspace", "Secure env"],
    transport: "stdio",
  },
  {
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
    command: "npx",
    description: "Official filesystem MCP for reading and writing files inside explicit allowed directories.",
    docsUrl: "https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem",
    id: "filesystem",
    name: "Filesystem",
    note: "Review the allowed directory argument before saving. The default exposes the server process working directory only.",
    publisher: "Model Context Protocol",
    setupSteps: [
      "Replace . with the folder you want this MCP server to access.",
      "Keep allowed directories narrow.",
      "Test after saving so chat can see which filesystem tools are available.",
    ],
    tags: ["Files", "Local", "Permissions"],
    transport: "stdio",
  },
  {
    args: ["-y", "@modelcontextprotocol/server-memory"],
    command: "npx",
    description: "Official memory MCP for local knowledge graph storage and retrieval across conversations.",
    docsUrl: "https://www.npmjs.com/package/@modelcontextprotocol/server-memory",
    id: "memory",
    name: "Memory",
    note: "Runs locally without a provider API key. Review what you ask chat to store because memory tools are persistent.",
    publisher: "Model Context Protocol",
    setupSteps: [
      "Runs the official local memory server.",
      "No API key is required.",
      "Use it for explicit, user-approved durable context rather than transient chat notes.",
    ],
    tags: ["Memory", "Local", "Knowledge"],
    transport: "stdio",
  },
  {
    args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
    command: "npx",
    description: "Official Sequential Thinking MCP for stepwise reasoning, revisions, branches, and problem solving.",
    docsUrl: "https://www.npmjs.com/package/@modelcontextprotocol/server-sequential-thinking",
    id: "sequential-thinking",
    name: "Sequential Thinking",
    note: "Runs locally without an API key. Add DISABLE_THOUGHT_LOGGING=true to Environment if you want quieter server logs.",
    publisher: "Model Context Protocol",
    setupSteps: [
      "Runs the official Sequential Thinking MCP package.",
      "No API key is required.",
      "Test after saving so chat can see the sequentialthinking tool.",
    ],
    tags: ["Reasoning", "Planning", "Local"],
    transport: "stdio",
  },
  {
    args: ["-y", "@playwright/mcp@latest"],
    command: "npx",
    description: "Official Playwright MCP for browser automation, page inspection, screenshots, and web app testing.",
    docsUrl: "https://playwright.dev",
    id: "playwright",
    name: "Playwright",
    note: "Runs browser automation locally. Install browsers with Playwright if a first test reports missing browser binaries.",
    publisher: "Microsoft",
    setupSteps: [
      "Runs the official @playwright/mcp package.",
      "No API key is required.",
      "If browser binaries are missing, install Playwright browsers and test again.",
    ],
    tags: ["Browser", "Testing", "Screenshots"],
    transport: "stdio",
  },
  {
    args: ["-y", "@modelcontextprotocol/server-puppeteer"],
    command: "npx",
    description: "Official Puppeteer MCP for local browser automation, screenshots, navigation, and scripted page work.",
    docsUrl: "https://www.npmjs.com/package/@modelcontextprotocol/server-puppeteer",
    id: "puppeteer",
    name: "Puppeteer",
    note: "Runs local browser automation without a provider API key. Keep ALLOW_DANGEROUS unset unless you explicitly need broader browser permissions.",
    publisher: "Model Context Protocol",
    setupSteps: [
      "Runs the official Puppeteer MCP package.",
      "No API key is required.",
      "If Chromium launch fails, install or configure a compatible browser before testing again.",
    ],
    tags: ["Browser", "Automation", "Screenshots"],
    transport: "stdio",
  },
  {
    args: ["-y", "@jetbrains/mcp-proxy"],
    command: "npx",
    description: "JetBrains MCP proxy for IDE context from IntelliJ IDEA, WebStorm, PyCharm, and related JetBrains IDEs.",
    docsUrl: "https://github.com/JetBrains/mcp-jetbrains",
    id: "jetbrains",
    name: "JetBrains IDE",
    note: "Requires the JetBrains MCP Server plugin running inside the IDE. No API key is entered in Gilbert.",
    publisher: "JetBrains",
    setupSteps: [
      "Install and enable the JetBrains MCP Server plugin in the IDE.",
      "Keep the target project open in the IDE while testing the proxy.",
      "No API key is required; the proxy forwards MCP requests to the local IDE server.",
    ],
    tags: ["IDE", "Code", "Local"],
    transport: "stdio",
  },
  {
    args: mcpRemoteArgs("https://mcp.sentry.dev/mcp"),
    command: "npx",
    description: "Sentry MCP for issues, traces, docs, and production debugging workflows.",
    docsUrl: "https://github.com/getsentry/sentry-mcp",
    id: "sentry",
    name: "Sentry",
    note: "Uses Sentry's hosted MCP endpoint through mcp-remote so OAuth can complete in the browser.",
    publisher: "Sentry",
    setupSteps: [
      "Uses mcp-remote for Sentry OAuth.",
      "No API key is entered in Gilbert for the hosted Sentry flow.",
      "Refresh tools after authentication so chat can see issues and trace tools.",
    ],
    tags: ["Errors", "Traces", "OAuth"],
    transport: "stdio",
  },
  {
    args: ["-y", "kubernetes-mcp-server@latest"],
    command: "npx",
    description: "Kubernetes MCP for cluster inspection and kubectl-backed development workflows.",
    docsUrl: "https://www.npmjs.com/package/kubernetes-mcp-server",
    id: "kubernetes",
    name: "Kubernetes",
    note: "Requires a working kubeconfig on the machine. Keep write-capable clusters carefully permission-reviewed.",
    publisher: "Containers",
    setupSteps: [
      "Requires a working kubeconfig or kubectl context on this machine.",
      "No API key is entered in Gilbert for the default local cluster auth path.",
      "Use read-only cluster permissions when possible.",
    ],
    tags: ["K8s", "Cluster", "kubectl"],
    transport: "stdio",
  },
];

export function AppsPage({ onBackToChat, onOpenGithubSettings, onOpenGoogleSettings, onOpenKeysSettings }: AppsPageProps) {
  const [activeCatalogSection, setActiveCatalogSection] = useState<AppsCatalogSection>("all");
  const [appSearchQuery, setAppSearchQuery] = useState("");
  const [expandedAppCardIds, setExpandedAppCardIds] = useState<Set<string>>(() => new Set());
  const [gmailActionState, setGmailActionState] = useState<GmailActionState>("idle");
  const [gmailConnection, setGmailConnection] = useState<GmailConnectionState>({ accounts: [], connected: false, maxAccounts: GMAIL_ACCOUNT_LIMIT, pluginInstalled: false, scopes: [] });
  const [gmailConnectOpen, setGmailConnectOpen] = useState(false);
  const [gmailStatus, setGmailStatus] = useState<AppsStatusMessage | null>(null);
  const [calendarActionState, setCalendarActionState] = useState<CalendarActionState>("idle");
  const [calendarConnection, setCalendarConnection] = useState<CalendarConnectionState>({ accounts: [], connected: false, maxAccounts: GOOGLE_CALENDAR_ACCOUNT_LIMIT, pluginInstalled: false, scopes: [] });
  const [calendarConnectOpen, setCalendarConnectOpen] = useState(false);
  const [calendarStatus, setCalendarStatus] = useState<AppsStatusMessage | null>(null);
  const [githubActionState, setGithubActionState] = useState<GithubActionState>("idle");
  const [githubConnection, setGithubConnection] = useState<GithubConnectionState>({ connected: false, pluginInstalled: false, scopes: [] });
  const [githubRepos, setGithubRepos] = useState<GithubRepository[]>([]);
  const [githubStatus, setGithubStatus] = useState<AppsStatusMessage | null>(null);
  const [mcpActionState, setMcpActionState] = useState<McpActionState>("idle");
  const [mcpConnection, setMcpConnection] = useState<McpConnectionState>({ connected: false, enabledServerCount: 0, maxServers: MCP_SERVER_LIMIT, servers: [] });
  const [mcpDialogOpen, setMcpDialogOpen] = useState(false);
  const [mcpDraft, setMcpDraft] = useState<McpServerDraft>(EMPTY_MCP_DRAFT);
  const [apiKeyVault, setApiKeyVault] = useState<ApiKeyVaultState>(EMPTY_API_KEY_VAULT);
  const [mcpPresetPage, setMcpPresetPage] = useState(0);
  const [mcpRegistryBusy, setMcpRegistryBusy] = useState(false);
  const [mcpRegistryPage, setMcpRegistryPage] = useState(0);
  const [mcpRegistryQuery, setMcpRegistryQuery] = useState("slack");
  const [mcpRegistryResults, setMcpRegistryResults] = useState<McpRegistryServerSummary[]>([]);
  const [mcpRegistryStatus, setMcpRegistryStatus] = useState<AppsStatusMessage | null>(null);
  const [mcpProgressEvents, setMcpProgressEvents] = useState<McpServerProgressEvent[]>([]);
  const [mcpStatus, setMcpStatus] = useState<AppsStatusMessage | null>(null);
  const [openAiPlugins, setOpenAiPlugins] = useState<OpenAiCodexPluginListing[]>([]);
  const [openAiPluginActionId, setOpenAiPluginActionId] = useState<string | null>(null);
  const [openAiPluginBusy, setOpenAiPluginBusy] = useState(false);
  const [openAiPluginPage, setOpenAiPluginPage] = useState(0);
  const [openAiPluginStatus, setOpenAiPluginStatus] = useState<AppsStatusMessage | null>(null);
  const [skillRegistry, setSkillRegistry] = useState<SkillRegistryState>(() => loadSkillRegistry());
  const deferredSearchQuery = useDeferredValue(appSearchQuery);
  const googleTestingHint = import.meta.env.DEV ? " If Google shows access_denied because the app is in testing, add this Google account as a test user in Google Auth Platform > Audience." : "";
  const googleOAuthClientId = getDefaultGoogleOAuthClientId();
  const googleOAuthClientSecret = getDefaultGoogleOAuthClientSecret();
  const googleHostedAvailable = googleCloudAvailable();
  const googleClientReady = googleHostedAvailable || Boolean(googleOAuthClientId && googleOAuthClientSecret);
  const gmailAvailable = gmailDesktopAvailable();
  const gmailBusy = gmailActionState !== "idle";
  const gmailMaxAccounts = gmailConnection.maxAccounts || GMAIL_ACCOUNT_LIMIT;
  const gmailAccountRows = useMemo(() => normalizeGmailAccountRows(gmailConnection), [gmailConnection]);
  const gmailActiveAccount = gmailAccountRows.find((account) => account.active) ?? gmailAccountRows[0];
  const gmailActiveEmail = gmailConnection.activeAccountEmail ?? gmailActiveAccount?.email ?? gmailConnection.user?.email;
  const gmailConnected = gmailConnection.connected || gmailAccountRows.length > 0;
  const gmailInstalled = gmailConnection.pluginInstalled || gmailConnected;
  const gmailNeedsSetup = Boolean(gmailConnection.lastConnectionError) && !gmailConnected;
  const gmailStatusLabel = gmailConnected ? "Connected" : gmailNeedsSetup ? "Needs setup" : gmailInstalled ? "Installed" : googleClientReady && gmailAvailable ? "Ready to install" : gmailAvailable ? "Needs Google setup" : "Unavailable";
  const gmailStatusKind = gmailConnected ? "connected" : gmailNeedsSetup ? "setup" : gmailInstalled ? "installed" : googleClientReady && gmailAvailable ? "ready" : "setup";
  const gmailCanAddAccount = gmailAccountRows.length < gmailMaxAccounts;
  const gmailAccountLabel = gmailAccountRows.length > 0
    ? `${gmailAccountRows.length}/${gmailMaxAccounts} accounts connected${gmailActiveEmail ? ` | Active: ${gmailActiveEmail}` : ""}`
    : gmailInstalled
      ? googleHostedAvailable ? "Hosted connector ready. Google account not connected." : "Installed locally. Google account not connected."
      : gmailAvailable && !googleClientReady
        ? "Add Google OAuth setup first"
      : "Install to choose a Google account";
  const calendarAvailable = googleCalendarDesktopAvailable();
  const calendarBusy = calendarActionState !== "idle";
  const calendarMaxAccounts = calendarConnection.maxAccounts || GOOGLE_CALENDAR_ACCOUNT_LIMIT;
  const calendarAccountRows = useMemo(() => normalizeCalendarAccountRows(calendarConnection), [calendarConnection]);
  const calendarActiveAccount = calendarAccountRows.find((account) => account.active) ?? calendarAccountRows[0];
  const calendarActiveEmail = calendarConnection.activeAccountEmail ?? calendarActiveAccount?.email ?? calendarConnection.user?.email;
  const calendarConnected = calendarConnection.connected || calendarAccountRows.length > 0;
  const calendarInstalled = calendarConnection.pluginInstalled || calendarConnected;
  const calendarNeedsSetup = Boolean(calendarConnection.lastConnectionError) && !calendarConnected;
  const calendarStatusLabel = calendarConnected ? "Connected" : calendarNeedsSetup ? "Needs setup" : calendarInstalled ? "Installed" : googleClientReady && calendarAvailable ? "Ready to install" : calendarAvailable ? "Needs Google setup" : "Unavailable";
  const calendarStatusKind = calendarConnected ? "connected" : calendarNeedsSetup ? "setup" : calendarInstalled ? "installed" : googleClientReady && calendarAvailable ? "ready" : "setup";
  const calendarCanAddAccount = calendarAccountRows.length < calendarMaxAccounts;
  const calendarAccountLabel = calendarAccountRows.length > 0
    ? `${calendarAccountRows.length}/${calendarMaxAccounts} accounts connected${calendarActiveEmail ? ` | Active: ${calendarActiveEmail}` : ""}`
    : calendarInstalled
      ? googleHostedAvailable ? "Hosted connector ready. Google account not connected." : "Installed locally. Google account not connected."
      : calendarAvailable && !googleClientReady
        ? "Add Google OAuth setup first"
      : "Install to choose a Google account";
  const githubAvailable = githubDesktopAvailable();
  const githubBusy = githubActionState !== "idle";
  const githubConnected = githubConnection.connected;
  const githubInstalled = githubConnection.pluginInstalled || githubConnected;
  const githubStatusLabel = githubConnected ? "Connected" : githubInstalled ? "Installed" : githubAvailable ? "Ready to install" : "Unavailable";
  const githubStatusKind = githubConnected ? "connected" : githubInstalled ? "installed" : githubAvailable ? "ready" : "setup";
  const githubAccountLabel = githubConnected
    ? `${githubConnection.user?.login ?? "GitHub"} connected${githubRepos.length ? ` | ${githubRepos.length} repos previewed` : ""}`
    : githubInstalled
      ? "Installed locally. Connect GitHub in Settings."
      : "Install to use the existing GitHub setup path";
  const mcpAvailable = mcpDesktopAvailable();
  const mcpBusy = mcpActionState !== "idle";
  const mcpServers = mcpConnection.servers ?? EMPTY_MCP_SERVERS;
  const mcpSummary = useMemo(() => {
    let enabledCount = 0;
    let toolCount = 0;
    const searchParts: string[] = [];

    for (const server of mcpServers) {
      if (server.enabled) {
        enabledCount += 1;
      }

      const tools = server.tools ?? [];
      toolCount += tools.length;
      searchParts.push(server.name, server.endpoint ?? "", server.command ?? "", server.transport, server.serverName ?? "");

      for (const tool of tools) {
        searchParts.push(tool.name);
      }
    }

    return {
      enabledCount,
      searchText: searchParts.join(" "),
      toolCount,
    };
  }, [mcpServers]);
  const normalizedSearchQuery = useMemo(() => deferredSearchQuery.trim().toLowerCase(), [deferredSearchQuery]);
  const mcpPresetSearchText = useMemo(
    () => MCP_FEATURED_PRESETS.map((preset) => getMcpPresetSearchFields(preset).join(" ")).join(" "),
    [],
  );
  const mcpFilteredPresets = useMemo(
    () => MCP_FEATURED_PRESETS.filter((preset) => matchesAppsSearch(normalizedSearchQuery, getMcpPresetSearchFields(preset))),
    [normalizedSearchQuery],
  );
  const mcpPresetPageCount = Math.max(1, Math.ceil(mcpFilteredPresets.length / MCP_PRESET_PAGE_SIZE));
  const mcpPresetCurrentPage = Math.min(mcpPresetPage, mcpPresetPageCount - 1);
  const mcpPresetPageStart = mcpPresetCurrentPage * MCP_PRESET_PAGE_SIZE;
  const mcpVisiblePresets = mcpFilteredPresets.slice(mcpPresetPageStart, mcpPresetPageStart + MCP_PRESET_PAGE_SIZE);
  const mcpDraftSetup = useMemo(() => getMcpDraftSetupSummary(mcpDraft, mcpServers), [mcpDraft, mcpServers]);
  const apiKeysAvailable = apiKeyVault.keys.length > 0;
  const mcpRegistrySearchText = useMemo(
    () => mcpRegistryResults.map((server) => [
      server.name,
      server.title,
      server.description,
      server.repositoryUrl,
      server.install?.packageId,
      server.install?.endpoint,
    ].filter(Boolean).join(" ")).join(" "),
    [mcpRegistryResults],
  );
  const mcpRegistryPageCount = Math.max(1, Math.ceil(mcpRegistryResults.length / MCP_REGISTRY_PAGE_SIZE));
  const mcpRegistryCurrentPage = Math.min(mcpRegistryPage, mcpRegistryPageCount - 1);
  const mcpRegistryPageStart = mcpRegistryCurrentPage * MCP_REGISTRY_PAGE_SIZE;
  const mcpVisibleRegistryResults = mcpRegistryResults.slice(mcpRegistryPageStart, mcpRegistryPageStart + MCP_REGISTRY_PAGE_SIZE);
  const githubRepoSearchText = useMemo(
    () => githubRepos.map((repo) => [repo.fullName, repo.description, repo.defaultBranch].filter(Boolean).join(" ")).join(" "),
    [githubRepos],
  );
  const mcpEnabledCount = mcpSummary.enabledCount;
  const mcpMaxServers = mcpConnection.maxServers || MCP_SERVER_LIMIT;
  const mcpToolCount = mcpSummary.toolCount;
  const mcpConfigured = mcpServers.length > 0;
  const mcpConnected = mcpConnection.connected || mcpEnabledCount > 0;
  const mcpStatusLabel = mcpConnected ? "Connected" : mcpConfigured ? "Configured" : mcpAvailable ? "Ready" : "Desktop only";
  const mcpStatusKind = mcpConnected ? "connected" : mcpConfigured ? "installed" : mcpAvailable ? "ready" : "setup";
  const mcpAccountLabel = mcpConfigured
    ? `${mcpEnabledCount}/${mcpMaxServers} enabled servers | ${mcpToolCount} cached tools`
    : mcpAvailable
      ? "Add a Streamable HTTP or stdio MCP server"
      : "Open the desktop app to connect MCP servers";
  const openAiCatalogPlugins = useMemo(
    () => openAiPlugins.filter((plugin) => !isOpenAiNativePlugin(plugin.id)),
    [openAiPlugins],
  );
  const marketplacePluginStates = useMemo(() => {
    const states = new Map<string, MarketplacePluginRuntimeState>();

    for (const plugin of openAiCatalogPlugins) {
      states.set(plugin.id, getMarketplacePluginRuntimeState(plugin, mcpServers, skillRegistry));
    }

    return states;
  }, [mcpServers, openAiCatalogPlugins, skillRegistry]);
  const openAiFilteredPlugins = useMemo(
    () => openAiCatalogPlugins.filter((plugin) => {
      const state = marketplacePluginStates.get(plugin.id);

      return matchesAppsSearch(normalizedSearchQuery, [
        plugin.displayName,
        plugin.id,
        plugin.category,
        plugin.marketplace,
        plugin.sourcePath,
        state?.routeLabel ?? getOpenAiPluginRouteLabel(plugin),
        state?.statusLabel,
        state?.description ?? getOpenAiPluginDescription(plugin),
        ...(state?.tags ?? []),
        plugin.hasBundledSkills ? "skills SKILL.md bundled" : "",
        plugin.mcpPresetId ? "mcp preset tools" : "",
      ]);
    }),
    [normalizedSearchQuery, openAiCatalogPlugins, marketplacePluginStates],
  );
  const openAiPluginPageCount = Math.max(1, Math.ceil(openAiFilteredPlugins.length / OPENAI_PLUGIN_PAGE_SIZE));
  const openAiPluginCurrentPage = Math.min(openAiPluginPage, openAiPluginPageCount - 1);
  const openAiPluginPageStart = openAiPluginCurrentPage * OPENAI_PLUGIN_PAGE_SIZE;
  const openAiVisiblePlugins = openAiFilteredPlugins.slice(openAiPluginPageStart, openAiPluginPageStart + OPENAI_PLUGIN_PAGE_SIZE);
  const openAiPluginMatchesSearch =
    sectionMatches(activeCatalogSection, "plugins") &&
    (openAiPluginBusy || openAiFilteredPlugins.length > 0 || Boolean(openAiPluginStatus));
  const pluginCatalogCount = 3 + openAiCatalogPlugins.length;
  const gmailMatchesSearch =
    sectionMatches(activeCatalogSection, "plugins") &&
    matchesAppsSearch(normalizedSearchQuery, [
      "Gmail",
      "Google",
      "email",
      "inbox",
      "thread summaries",
      "draft replies",
      "direct send",
      "full gmail api",
      "settings",
      "plugins",
      "made by Gilbert Codex",
      gmailStatusLabel,
      gmailAccountLabel,
    ]);
  const calendarMatchesSearch =
    sectionMatches(activeCatalogSection, "plugins") &&
    matchesAppsSearch(normalizedSearchQuery, [
      "Google Calendar",
      "Calendar",
      "Google",
      "agenda",
      "schedule",
      "events",
      "meeting prep",
      "availability",
      "free busy",
      "plugins",
      "made by Gilbert Codex",
      calendarStatusLabel,
      calendarAccountLabel,
    ]);
  const githubMatchesSearch =
    sectionMatches(activeCatalogSection, "plugins") &&
    matchesAppsSearch(normalizedSearchQuery, [
      "GitHub",
      "Git",
      "repositories",
      "branches",
      "commits",
      "pull requests",
      "issues",
      "actions",
      "workflows",
      "releases",
      "tags",
      "stars",
      "forks",
      "semantic search",
      "plugins",
      "made by Gilbert Codex",
      githubStatusLabel,
      githubAccountLabel,
      githubRepoSearchText,
    ]);
  const mcpMatchesSearch =
    sectionMatches(activeCatalogSection, "mcp") &&
    matchesAppsSearch(normalizedSearchQuery, [
      "MCP",
      "Model Context Protocol",
      "tool servers",
      "remote tools",
      "connectors",
      "external tools",
      "Streamable HTTP",
      "stdio",
      "command line servers",
      "bearer token",
      "secure storage",
      "permissions",
      "registry",
      "marketplace",
      "Supabase",
      "App Backend",
      "AWS",
      "Figma",
      mcpStatusLabel,
      mcpAccountLabel,
      mcpSummary.searchText,
      mcpPresetSearchText,
      mcpRegistrySearchText,
    ]);
  const skillsMatchesSearch =
    sectionMatches(activeCatalogSection, "skills") &&
    matchesAppsSearch(normalizedSearchQuery, [
      "Skills",
      "SKILL.md",
      "installed",
      "custom",
      "premade",
      "prompt packs",
      "workflows",
      "triggers",
      "team presets",
      "reusable instructions",
      "coding",
      "review",
      "research",
      "frontend",
    ]);
  const visibleCardCount = (gmailMatchesSearch ? 1 : 0) + (calendarMatchesSearch ? 1 : 0) + (githubMatchesSearch ? 1 : 0) + (openAiPluginMatchesSearch ? 1 : 0) + (mcpMatchesSearch ? 1 : 0) + (skillsMatchesSearch ? 1 : 0);
  const readyCapabilityCount = 4 + MCP_FEATURED_PRESETS.length + openAiCatalogPlugins.length;
  const gmailExpanded = expandedAppCardIds.has("gmail");
  const calendarExpanded = expandedAppCardIds.has("google-calendar");
  const githubExpanded = expandedAppCardIds.has("github");

  useEffect(() => subscribeSkillRegistry(setSkillRegistry), []);

  useEffect(() => {
    setApiKeyVault(loadApiKeyVault());
  }, []);

  useEffect(() => {
    let disposed = false;

    setOpenAiPluginBusy(true);
    void loadOpenAiCodexMarketplace()
      .then((plugins) => {
        if (disposed) {
          return;
        }

        setOpenAiPlugins(plugins);
        setOpenAiPluginStatus(plugins[0]?.marketplace.toLowerCase().includes("fallback")
          ? { kind: "warning", text: `Loaded ${plugins.length} fallback plugin entries. The live plugin catalog could not be reached.` }
          : { kind: "success", text: `Loaded ${plugins.length} Gilbert marketplace plugins.` });
      })
      .catch((error) => {
        if (!disposed) {
          setOpenAiPluginStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not load the Gilbert plugin marketplace." });
        }
      })
      .finally(() => {
        if (!disposed) {
          setOpenAiPluginBusy(false);
        }
      });

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    setOpenAiPluginPage(0);
    setMcpPresetPage(0);
  }, [normalizedSearchQuery, activeCatalogSection]);

  useEffect(() => {
    if (!gmailAvailable) {
      setGmailStatus({ kind: "warning", text: "Open the desktop app to install Gmail. Browser preview cannot store Google account tokens." });
      return;
    }

    let disposed = false;

    setGmailActionState("refresh");
    void getGmailState()
      .then((connection) => {
        if (disposed) {
          return;
        }

        setGmailConnection(connection);
        setGmailStatus((connection.connected || (connection.accounts ?? []).length > 0)
          ? { kind: "success", text: formatConnectedGmailStatus(connection) }
          : connection.lastConnectionError
            ? { kind: "warning", text: formatGmailConnectionError(connection.lastConnectionError) }
            : connection.pluginInstalled
              ? { kind: "warning", text: "Gmail plugin is installed locally. Connect a Google account before Gmail tools can read mail." }
              : null);
      })
      .catch((error) => {
        if (!disposed) {
          setGmailStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not load Gmail connection." });
        }
      })
      .finally(() => {
        if (!disposed) {
          setGmailActionState("idle");
        }
      });

    return () => {
      disposed = true;
    };
  }, [gmailAvailable]);

  useEffect(() => {
    if (!calendarAvailable) {
      setCalendarStatus({ kind: "warning", text: "Open the desktop app to install Google Calendar. Browser preview cannot store Google account tokens." });
      return;
    }

    let disposed = false;

    setCalendarActionState("refresh");
    void getGoogleCalendarState()
      .then((connection) => {
        if (disposed) {
          return;
        }

        setCalendarConnection(connection);
        setCalendarStatus((connection.connected || (connection.accounts ?? []).length > 0)
          ? { kind: "success", text: formatConnectedCalendarStatus(connection) }
          : connection.lastConnectionError
            ? { kind: "warning", text: formatCalendarConnectionError(connection.lastConnectionError) }
            : connection.pluginInstalled
              ? { kind: "warning", text: "Google Calendar plugin is installed locally. Connect a Google account before Calendar tools can read events." }
              : null);
      })
      .catch((error) => {
        if (!disposed) {
          setCalendarStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not load Google Calendar connection." });
        }
      })
      .finally(() => {
        if (!disposed) {
          setCalendarActionState("idle");
        }
      });

    return () => {
      disposed = true;
    };
  }, [calendarAvailable]);

  useEffect(() => {
    if (!githubAvailable) {
      setGithubStatus({ kind: "warning", text: "Open the desktop app to install GitHub. Browser preview cannot store GitHub account tokens." });
      return;
    }

    let disposed = false;

    setGithubActionState("refresh");
    void getGithubState()
      .then((connection) => {
        if (disposed) {
          return;
        }

        setGithubConnection(connection);
        setGithubRepos([]);

        if (connection.connected) {
          setGithubStatus({ kind: "success", text: `GitHub connected as ${connection.user?.login ?? "your account"}.` });
          return;
        }

        setGithubStatus(connection.pluginInstalled ? { kind: "warning", text: "GitHub plugin is installed locally. Connect GitHub in Settings before GitHub tools can access repositories." } : null);
      })
      .catch((error) => {
        if (!disposed) {
          setGithubStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not load GitHub connection." });
        }
      })
      .finally(() => {
        if (!disposed) {
          setGithubActionState("idle");
        }
      });

    return () => {
      disposed = true;
    };
  }, [githubAvailable]);

  useEffect(() => {
    if (!mcpAvailable) {
      setMcpStatus({ kind: "warning", text: "Open the desktop app to connect MCP servers. Browser preview cannot store MCP bearer tokens." });
      return;
    }

    let disposed = false;

    setMcpActionState("refresh");
    void getMcpState()
      .then((connection) => {
        if (disposed) {
          return;
        }

        setMcpConnection(connection);
        setMcpStatus(formatMcpConnectionStatus(connection));
      })
      .catch((error) => {
        if (!disposed) {
          setMcpStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not load MCP server connections." });
        }
      })
      .finally(() => {
        if (!disposed) {
          setMcpActionState("idle");
        }
      });

    return () => {
      disposed = true;
    };
  }, [mcpAvailable]);

  async function startGmailConnection() {
    if (!gmailAvailable) {
      setGmailStatus({ kind: "error", text: "Gmail sign-in is available in the desktop app." });
      return;
    }

    if (!gmailCanAddAccount) {
      setGmailStatus({ kind: "warning", text: `Gmail already has ${gmailMaxAccounts}/${gmailMaxAccounts} accounts connected. Disconnect one before adding another.` });
      setGmailConnectOpen(true);
      return;
    }

    setGmailActionState("install");

    try {
      const installedConnection = await installGmailPlugin();

      setGmailConnection(installedConnection);
    } catch (error) {
      setGmailActionState("idle");
      setGmailStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not install Gmail plugin locally." });
      return;
    }

    if (!googleHostedAvailable && !googleOAuthClientId) {
      setGmailActionState("idle");
      setGmailStatus({ kind: "warning", text: "Gmail needs Google OAuth setup first. Opening Settings > Google." });
      onOpenGoogleSettings();
      return;
    }

    if (!googleHostedAvailable && !googleOAuthClientSecret) {
      setGmailActionState("idle");
      setGmailStatus({ kind: "warning", text: "Gmail needs the matching Google desktop Client secret. Opening Settings > Google." });
      onOpenGoogleSettings();
      return;
    }

    setGmailActionState("connect");
    setGmailStatus({ kind: "warning", text: `${googleHostedAvailable ? "Opening hosted Google sign-in" : "Gmail plugin is installed locally. Opening Google sign-in"} so you can choose the account to connect.${googleHostedAvailable ? "" : googleTestingHint}` });

    try {
      const connection = await connectGmailOAuth({
        clientId: googleOAuthClientId,
        clientSecret: googleOAuthClientSecret,
        scope: googleHostedAvailable ? GOOGLE_HOSTED_OAUTH_SCOPE : getDefaultGmailOAuthScope(),
      });

      setGmailConnection(connection);
      setGmailStatus({ kind: "success", text: formatConnectedGmailStatus(connection) });
    } catch (error) {
      try {
        setGmailConnection(await getGmailState());
      } catch {
        // Keep the last known install state if a refresh also fails.
      }

      setGmailStatus({ kind: "error", text: formatGmailConnectionError(error) });
    } finally {
      setGmailActionState("idle");
    }
  }

  async function activateGmailAccount(email: string) {
    setGmailActionState("refresh");
    setGmailStatus(null);

    try {
      const connection = await setActiveGmailAccount({ email });

      setGmailConnection(connection);
      setGmailStatus({ kind: "success", text: `Active Gmail account set to ${email}.` });
    } catch (error) {
      setGmailStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not switch Gmail account." });
    } finally {
      setGmailActionState("idle");
    }
  }

  async function disconnectConnectedGmailAccount(email: string) {
    setGmailActionState("disconnect");
    setGmailStatus(null);

    try {
      const connection = await disconnectGmailAccountByEmail({ email });

      setGmailConnection(connection);
      setGmailStatus({ kind: "success", text: `${email} disconnected. The Gmail plugin remains installed locally.` });
    } catch (error) {
      setGmailStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not disconnect Gmail." });
    } finally {
      setGmailActionState("idle");
    }
  }

  function handleGmailPrimaryAction() {
    if (gmailConnected) {
      setGmailConnectOpen(true);
      return;
    }

    if (!gmailAvailable) {
      setGmailStatus({ kind: "error", text: "Open the desktop app to install Gmail. Browser preview can show the setup flow but cannot store Google tokens." });
      setGmailConnectOpen(true);
      return;
    }

    if (!googleClientReady) {
      setGmailConnectOpen(false);
      setGmailStatus({ kind: "warning", text: "Gmail install needs Google OAuth setup first. Opening Settings > Google." });
      onOpenGoogleSettings();
      return;
    }

    void startGmailConnection();
  }

  async function startCalendarConnection() {
    if (!calendarAvailable) {
      setCalendarStatus({ kind: "error", text: "Google Calendar sign-in is available in the desktop app." });
      return;
    }

    if (!calendarCanAddAccount) {
      setCalendarStatus({ kind: "warning", text: `Google Calendar already has ${calendarMaxAccounts}/${calendarMaxAccounts} accounts connected. Disconnect one before adding another.` });
      setCalendarConnectOpen(true);
      return;
    }

    setCalendarActionState("install");

    try {
      const installedConnection = await installGoogleCalendarPlugin();

      setCalendarConnection(installedConnection);
    } catch (error) {
      setCalendarActionState("idle");
      setCalendarStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not install Google Calendar plugin locally." });
      return;
    }

    if (!googleHostedAvailable && !googleOAuthClientId) {
      setCalendarActionState("idle");
      setCalendarStatus({ kind: "warning", text: "Google Calendar needs Google OAuth setup first. Opening Settings > Google." });
      onOpenGoogleSettings();
      return;
    }

    if (!googleHostedAvailable && !googleOAuthClientSecret) {
      setCalendarActionState("idle");
      setCalendarStatus({ kind: "warning", text: "Google Calendar needs the matching Google desktop Client secret. Opening Settings > Google." });
      onOpenGoogleSettings();
      return;
    }

    setCalendarActionState("connect");
    setCalendarStatus({ kind: "warning", text: `${googleHostedAvailable ? "Opening hosted Google sign-in" : "Google Calendar plugin is installed locally. Opening Google sign-in"} so you can choose the account to connect.${googleHostedAvailable ? "" : googleTestingHint}` });

    try {
      const connection = await connectGoogleCalendarOAuth({
        clientId: googleOAuthClientId,
        clientSecret: googleOAuthClientSecret,
        scope: googleHostedAvailable ? GOOGLE_HOSTED_OAUTH_SCOPE : getDefaultGoogleCalendarOAuthScope(),
      });

      setCalendarConnection(connection);
      setCalendarStatus({ kind: "success", text: formatConnectedCalendarStatus(connection) });
    } catch (error) {
      try {
        setCalendarConnection(await getGoogleCalendarState());
      } catch {
        // Keep the last known install state if a refresh also fails.
      }

      setCalendarStatus({ kind: "error", text: formatCalendarConnectionError(error) });
    } finally {
      setCalendarActionState("idle");
    }
  }

  async function activateCalendarAccount(email: string) {
    setCalendarActionState("refresh");
    setCalendarStatus(null);

    try {
      const connection = await setActiveGoogleCalendarAccount({ email });

      setCalendarConnection(connection);
      setCalendarStatus({ kind: "success", text: `Active Google Calendar account set to ${email}.` });
    } catch (error) {
      setCalendarStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not switch Google Calendar account." });
    } finally {
      setCalendarActionState("idle");
    }
  }

  async function disconnectConnectedCalendarAccount(email: string) {
    setCalendarActionState("disconnect");
    setCalendarStatus(null);

    try {
      const connection = await disconnectGoogleCalendarAccountByEmail({ email });

      setCalendarConnection(connection);
      setCalendarStatus({ kind: "success", text: `${email} disconnected. The Google Calendar plugin remains installed locally.` });
    } catch (error) {
      setCalendarStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not disconnect Google Calendar." });
    } finally {
      setCalendarActionState("idle");
    }
  }

  function handleCalendarPrimaryAction() {
    if (calendarConnected) {
      setCalendarConnectOpen(true);
      return;
    }

    if (!calendarAvailable) {
      setCalendarStatus({ kind: "error", text: "Open the desktop app to install Google Calendar. Browser preview can show the setup flow but cannot store Google tokens." });
      setCalendarConnectOpen(true);
      return;
    }

    if (!googleClientReady) {
      setCalendarConnectOpen(false);
      setCalendarStatus({ kind: "warning", text: "Google Calendar install needs Google OAuth setup first. Opening Settings > Google." });
      onOpenGoogleSettings();
      return;
    }

    void startCalendarConnection();
  }

  async function refreshGithubConnection() {
    if (!githubAvailable) {
      setGithubStatus({ kind: "error", text: "GitHub is available in the desktop app." });
      return;
    }

    setGithubActionState("refresh");

    try {
      const connection = await getGithubState();

      setGithubConnection(connection);

      if (connection.connected) {
        const repositories = await listGithubRepositories({ perPage: 6, sort: "updated" });

        setGithubRepos(repositories);
        setGithubStatus({ kind: "success", text: formatConnectedGithubStatus(connection, repositories) });
      } else {
        setGithubRepos([]);
        setGithubStatus(connection.pluginInstalled
          ? { kind: "warning", text: "GitHub plugin is installed locally. Open GitHub settings to finish browser sign-in." }
          : null);
      }
    } catch (error) {
      setGithubStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not refresh GitHub." });
    } finally {
      setGithubActionState("idle");
    }
  }

  async function installOrOpenGithub() {
    if (githubConnected) {
      onOpenGithubSettings();
      return;
    }

    if (!githubAvailable) {
      setGithubStatus({ kind: "error", text: "Open the desktop app to install GitHub. Browser preview can show the setup flow but cannot store GitHub tokens." });
      return;
    }

    if (githubInstalled) {
      onOpenGithubSettings();
      return;
    }

    setGithubActionState("install");

    try {
      const connection = await installGithubPlugin();

      setGithubConnection(connection);
      if (connection.connected) {
        const repositories = await listGithubRepositories({ perPage: 6, sort: "updated" });

        setGithubRepos(repositories);
        setGithubStatus({ kind: "success", text: formatConnectedGithubStatus(connection, repositories) });
        return;
      }

      setGithubRepos([]);
      setGithubStatus({ kind: "warning", text: "GitHub plugin installed locally. Opening GitHub settings so you can finish browser sign-in." });
      onOpenGithubSettings();
    } catch (error) {
      setGithubStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not install GitHub plugin locally." });
    } finally {
      setGithubActionState("idle");
    }
  }

  function openMcpServerDialog(server?: McpServerState) {
    setApiKeyVault(loadApiKeyVault());
    setMcpDraft(server
      ? {
          argsText: (server.args ?? []).join("\n"),
          authorizationToken: "",
          command: server.command ?? "",
          enabled: server.enabled,
          environmentText: formatMcpEnvironmentDraft(server),
          endpoint: server.endpoint ?? "",
          headersText: formatMcpHeaderDraft(server),
          id: server.id,
          name: server.name,
          queryText: formatMcpQueryDraft(server),
          transport: server.transport ?? "http",
          workingDirectory: server.workingDirectory ?? "",
        }
      : EMPTY_MCP_DRAFT);
    setMcpStatus(server?.hasAuthorizationToken || (server?.environment ?? []).some((item) => item.hasValue) || (server?.headers ?? []).some((item) => item.hasValue) || (server?.queryParams ?? []).some((item) => item.hasValue)
      ? { kind: "success", text: "Saved secrets are hidden. Leave HTTP bearer token, query params, custom headers, or stdio env lines blank to keep saved values." }
      : null);
    setMcpProgressEvents([]);
    setMcpDialogOpen(true);
  }

  function configureMcpPreset(preset: McpProviderPreset, existingServer?: McpServerState) {
    setApiKeyVault(loadApiKeyVault());
    const installedServer = existingServer ?? findMcpServerForPreset(mcpServers, preset);

    if (installedServer) {
      openMcpServerDialog(installedServer);
      setMcpStatus({ kind: "success", text: `${installedServer.name} is already installed. Review it here, refresh tools, or update the saved configuration.` });
      return;
    }

    setMcpDraft({
      ...EMPTY_MCP_DRAFT,
      argsText: (preset.args ?? []).join("\n"),
      command: preset.command ?? "",
      endpoint: preset.endpoint ?? "",
      environmentText: preset.environmentText ?? "",
      headersText: preset.headersText ?? "",
      name: preset.name,
      queryText: preset.queryText ?? "",
      transport: preset.transport,
    });
    setMcpStatus({ kind: "warning", text: preset.note });
    setMcpProgressEvents([]);
    setMcpDialogOpen(true);
  }

  function configureMcpRegistryServer(server: McpRegistryServerSummary) {
    const install = server.install;

    if (!install) {
      setMcpRegistryStatus({ kind: "warning", text: `${formatMcpRegistryServerName(server)} does not publish a supported npm, PyPI, or remote install hint yet.` });
      return;
    }

    setMcpDraft(createDraftFromRegistryInstall(server, install));
    setMcpStatus({ kind: "warning", text: install.note ?? "Review this generated MCP configuration, then save and test it." });
    setMcpProgressEvents([]);
    setMcpDialogOpen(true);
  }

  function updateMcpDraftEnvironmentSecret(name: string, value: string) {
    setMcpDraft((draft) => ({ ...draft, environmentText: upsertMcpKeyValueLine(draft.environmentText, name, value) }));
  }

  function updateMcpDraftHeaderSecret(name: string, value: string) {
    setMcpDraft((draft) => ({ ...draft, headersText: upsertMcpKeyValueLine(draft.headersText, name, value) }));
  }

  function updateMcpDraftQuerySecret(name: string, value: string) {
    setMcpDraft((draft) => ({ ...draft, queryText: upsertMcpKeyValueLine(draft.queryText, name, value) }));
  }

  function applySavedMcpKey(requirement: McpSetupRequirement, keyId: string) {
    const key = apiKeyVault.keys.find((candidate) => candidate.id === keyId);

    if (!key) {
      return;
    }

    if (requirement.location === "bearer") {
      setMcpDraft((draft) => ({ ...draft, authorizationToken: key.value }));
      return;
    }

    if (requirement.location === "header") {
      updateMcpDraftHeaderSecret(requirement.name, key.value);
      return;
    }

    if (requirement.location === "query") {
      updateMcpDraftQuerySecret(requirement.name, key.value);
      return;
    }

    updateMcpDraftEnvironmentSecret(requirement.name, key.value);
  }

  async function handleOpenAiPluginPrimaryAction(plugin: OpenAiCodexPluginListing) {
    const runtimeState = marketplacePluginStates.get(plugin.id) ?? getMarketplacePluginRuntimeState(plugin, mcpServers, skillRegistry);

    setOpenAiPluginActionId(plugin.id);
    setOpenAiPluginStatus(null);

    try {
      if (plugin.installRoute === "native") {
        if (plugin.id === "gmail") {
          handleGmailPrimaryAction();
        } else if (plugin.id === "google-calendar") {
          handleCalendarPrimaryAction();
        } else if (plugin.id === "github") {
          await installOrOpenGithub();
        }
        return;
      }

      if (plugin.installRoute === "mcp-preset") {
        const preset = MCP_FEATURED_PRESETS.find((candidate) => candidate.id === plugin.mcpPresetId);

        if (!preset) {
          setOpenAiPluginStatus({ kind: "error", text: `${plugin.displayName} has no matching MCP preset in this build.` });
          return;
        }

        configureMcpPreset(preset, runtimeState.mcpServer);
        setOpenAiPluginStatus(runtimeState.mcpServer
          ? { kind: "success", text: `${plugin.displayName} is already installed as ${runtimeState.mcpServer.name}. Manage it in MCP settings.` }
          : { kind: "success", text: `${plugin.displayName} is ready to review as an MCP server. Save and test it before chat can use the tools.` });
        return;
      }

      if (plugin.installRoute === "skill-import") {
        if (runtimeState.skillCount > 0) {
          viewPluginSkills(plugin);
          return;
        }

        await installOpenAiPluginSkills(plugin);
        return;
      }

      setActiveCatalogSection("mcp");
      setMcpRegistryQuery(plugin.displayName);
      setOpenAiPluginStatus({ kind: "warning", text: `Searching the MCP Registry for a runnable ${plugin.displayName} server. Hosted connector IDs are not directly callable without a native Gilbert or MCP path.` });
      await searchMcpRegistryCatalog(plugin.displayName);
    } finally {
      setOpenAiPluginActionId(null);
    }
  }

  async function installOpenAiPluginSkills(plugin: OpenAiCodexPluginListing) {
    const runtimeState = marketplacePluginStates.get(plugin.id) ?? getMarketplacePluginRuntimeState(plugin, mcpServers, skillRegistry);

    if (runtimeState.skillCount > 0) {
      viewPluginSkills(plugin);
      return;
    }

    setOpenAiPluginActionId(plugin.id);
    setOpenAiPluginStatus(null);

    try {
      const result = await importOpenAiPluginSkills(plugin);

      if (result.importedCount === 0) {
        setOpenAiPluginStatus({ kind: "warning", text: `${plugin.displayName} does not publish bundled skills in the plugin catalog. Try MCP Registry search for a runnable tool server.` });
        return;
      }

      const preview = result.skillNames.slice(0, 3).join(", ");
      const remaining = result.importedCount > 3 ? `, +${result.importedCount - 3} more` : "";
      setOpenAiPluginStatus({ kind: "success", text: `Installed ${result.importedCount} ${plugin.displayName} skill${result.importedCount === 1 ? "" : "s"} locally${preview ? `: ${preview}${remaining}` : "."}` });
      setSkillRegistry(loadSkillRegistry());
    } catch (error) {
      setOpenAiPluginStatus({ kind: "error", text: error instanceof Error ? error.message : `Could not install ${plugin.displayName} skills.` });
    } finally {
      setOpenAiPluginActionId(null);
    }
  }

  function viewPluginSkills(plugin: OpenAiCodexPluginListing) {
    setActiveCatalogSection("skills");
    setAppSearchQuery(plugin.displayName);
    setOpenAiPluginStatus({ kind: "success", text: `${plugin.displayName} skills are already installed. Showing them in Skills.` });
  }

  async function searchMcpRegistryCatalog(query = mcpRegistryQuery) {
    if (!mcpAvailable) {
      setMcpRegistryStatus({ kind: "error", text: "MCP Registry search is available in the desktop app." });
      return;
    }

    setMcpRegistryBusy(true);
    setMcpRegistryStatus(null);

    try {
      const response = await searchMcpRegistry({ limit: MCP_REGISTRY_RESULT_LIMIT, query });

      setMcpRegistryResults(response.servers);
      setMcpRegistryPage(0);
      setMcpRegistryStatus(response.servers.length > 0
        ? { kind: "success", text: `Found ${response.servers.length} MCP server${response.servers.length === 1 ? "" : "s"}${response.count > response.servers.length ? ` from ${response.count} registry matches` : ""}.` }
        : { kind: "warning", text: "No registry servers matched that search." });
    } catch (error) {
      setMcpRegistryStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not search the MCP Registry." });
    } finally {
      setMcpRegistryBusy(false);
    }
  }

  async function refreshMcpConnections() {
    if (!mcpAvailable) {
      setMcpStatus({ kind: "error", text: "MCP server connections are available in the desktop app." });
      setMcpDialogOpen(true);
      return;
    }

    setMcpActionState("refresh");

    try {
      const connection = await getMcpState();

      setMcpConnection(connection);
      setMcpStatus(formatMcpConnectionStatus(connection));
    } catch (error) {
      setMcpStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not refresh MCP servers." });
    } finally {
      setMcpActionState("idle");
    }
  }

  function resetMcpProgress(message?: string) {
    setMcpProgressEvents(message
      ? [{ kind: "step", message }]
      : []);
  }

  function appendMcpProgressEvent(event: McpServerProgressEvent) {
    setMcpProgressEvents((events) => [...events.slice(-7), event]);
  }

  async function saveAndTestMcpServer() {
    if (!mcpAvailable) {
      setMcpStatus({ kind: "error", text: "MCP setup is available in the desktop app." });
      return;
    }

    const request = createMcpSaveRequest(mcpDraft, mcpServers);

    if (!request.ok) {
      setMcpStatus({ kind: "error", text: request.error });
      return;
    }

    setMcpActionState("save");
    setMcpStatus(null);
    resetMcpProgress("Saving MCP server configuration.");

    try {
      const saved = await saveMcpServer(request.value);

      setMcpConnection(saved.state);
      setMcpDraft((draft) => ({ ...draft, authorizationToken: "", id: saved.server.id }));
      setMcpActionState("test");
      appendMcpProgressEvent({ kind: "step", message: "Saved. Testing connection and loading tools." });

      const tested = await testMcpServerWithProgress({ id: saved.server.id }, appendMcpProgressEvent);

      if (tested.state) {
        setMcpConnection(tested.state);
      }

      setMcpStatus({
        kind: tested.ok ? "success" : "warning",
        text: tested.message,
      });
    } catch (error) {
      setMcpStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not save MCP server." });
    } finally {
      setMcpActionState("idle");
    }
  }

  async function testMcpDraftConnection() {
    if (!mcpAvailable) {
      setMcpStatus({ kind: "error", text: "MCP connection tests are available in the desktop app." });
      return;
    }

    const request = createMcpTestRequest(mcpDraft, mcpServers);

    if (!request.ok) {
      setMcpStatus({ kind: "error", text: request.error });
      return;
    }

    setMcpActionState("test");
    setMcpStatus(null);
    resetMcpProgress("Testing MCP connection.");

    try {
      const response = await testMcpServerWithProgress(mcpDraft.id
        ? { id: mcpDraft.id }
        : request.value, appendMcpProgressEvent);

      if (response.state) {
        setMcpConnection(response.state);
      }

      setMcpStatus({ kind: response.ok ? "success" : "warning", text: response.message });
    } catch (error) {
      setMcpStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not test MCP server." });
    } finally {
      setMcpActionState("idle");
    }
  }

  async function refreshMcpServerTools(serverId: string) {
    setMcpActionState("refresh");
    setMcpStatus(null);

    try {
      const response = await listMcpServerTools({ serverId });

      setMcpConnection(response.state);
      setMcpStatus({ kind: "success", text: `${response.server.name} refreshed with ${response.tools.length} tool${response.tools.length === 1 ? "" : "s"}.` });
    } catch (error) {
      setMcpStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not refresh MCP tools." });
    } finally {
      setMcpActionState("idle");
    }
  }

  async function testAllMcpServers() {
    if (!mcpAvailable) {
      setMcpStatus({ kind: "error", text: "MCP tool tests are available in the desktop app." });
      return;
    }

    const enabledServers = mcpServers.filter((server) => server.enabled);

    if (enabledServers.length === 0) {
      setMcpStatus({ kind: "warning", text: "Enable at least one MCP server before running a tool test." });
      return;
    }

    setMcpActionState("test-all");
    setMcpStatus(null);
    resetMcpProgress(`Testing ${enabledServers.length} enabled MCP server${enabledServers.length === 1 ? "" : "s"}.`);

    let passedCount = 0;
    const failures: string[] = [];

    try {
      for (const server of enabledServers) {
        appendMcpProgressEvent({ kind: "step", message: `Listing tools from ${server.name}.` });

        try {
          const response = await listMcpServerTools({ serverId: server.id });

          passedCount += 1;
          setMcpConnection(response.state);
          appendMcpProgressEvent({
            kind: "finished",
            message: `${response.server.name}: ${response.tools.length} tool${response.tools.length === 1 ? "" : "s"} ready.`,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not list tools.";
          failures.push(`${server.name}: ${message}`);
          appendMcpProgressEvent({ kind: "error", message: `${server.name}: ${message}` });
        }
      }

      if (failures.length > 0) {
        setMcpStatus({
          kind: passedCount > 0 ? "warning" : "error",
          text: `${passedCount}/${enabledServers.length} MCP server${enabledServers.length === 1 ? "" : "s"} passed tool discovery. ${failures.slice(0, 2).join(" | ")}`,
        });
      } else {
        setMcpStatus({
          kind: "success",
          text: `All ${passedCount} enabled MCP server${passedCount === 1 ? "" : "s"} listed tools successfully.`,
        });
      }
    } finally {
      setMcpActionState("idle");
    }
  }

  async function removeConfiguredMcpServer(server: McpServerState) {
    if (!window.confirm(`Remove MCP server "${server.name}" from Gilbert Codex?`)) {
      return;
    }

    setMcpActionState("remove");
    setMcpStatus(null);

    try {
      const connection = await removeMcpServer({ id: server.id });

      setMcpConnection(connection);
      setMcpStatus({ kind: "success", text: `${server.name} removed. Its saved bearer token was cleared from secure storage.` });

      if (mcpDraft.id === server.id) {
        setMcpDraft(EMPTY_MCP_DRAFT);
      }
    } catch (error) {
      setMcpStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not remove MCP server." });
    } finally {
      setMcpActionState("idle");
    }
  }

  function toggleAppCardExpanded(cardId: string) {
    setExpandedAppCardIds((currentIds) => {
      const nextIds = new Set(currentIds);

      if (nextIds.has(cardId)) {
        nextIds.delete(cardId);
      } else {
        nextIds.add(cardId);
      }

      return nextIds;
    });
  }

  return (
    <section className="apps-page">
      <header className="apps-hero">
        <div className="apps-hero-title">
          <span className="apps-hero-icon">
            <Puzzle size={22} aria-hidden="true" />
          </span>
          <span>
            <h1>Apps</h1>
            <small>Plugins, Apps, Skills, and more</small>
          </span>
        </div>
        <button className="apps-back-button" type="button" onClick={onBackToChat}>
          <ArrowLeft size={16} aria-hidden="true" />
          <span>Chat</span>
        </button>
      </header>

      <main className="apps-content" aria-labelledby="apps-library-title">
        <section className="apps-library-heading">
          <span className="apps-library-kicker">
            <PlugZap size={15} aria-hidden="true" />
            App library
          </span>
          <div>
            <h2 id="apps-library-title">Connected apps, plugins, and skills</h2>
            <p>Install trusted capability cards as they become available. Gmail, Google Calendar, GitHub, MCP servers, and Skills are available from this workspace.</p>
          </div>
        </section>

        <section className="apps-catalog-toolbar" aria-label="App catalog controls">
          <label className="apps-search">
            <Search size={17} aria-hidden="true" />
            <input value={appSearchQuery} placeholder="Search Gmail, Calendar, GitHub, Skills, MCP, plugins" onChange={(event) => setAppSearchQuery(event.target.value)} />
            {appSearchQuery ? (
              <button type="button" aria-label="Clear apps search" title="Clear search" onClick={() => setAppSearchQuery("")}>
                <X size={15} aria-hidden="true" />
              </button>
            ) : null}
          </label>

          <div className="apps-catalog-metrics" aria-label="App catalog status">
            <span>
              <strong>{gmailAccountRows.length + calendarAccountRows.length + (githubConnected ? 1 : 0) + mcpEnabledCount}</strong>
              Connected
            </span>
            <span>
              <strong>{readyCapabilityCount}</strong>
              Ready
            </span>
            <span>
              <strong>1</strong>
              Skills
            </span>
          </div>
        </section>

        <nav className="apps-section-tabs" aria-label="App catalog sections">
          {APP_SECTION_FILTERS.map((section) => {
            const SectionIcon = getAppsSectionIcon(section.id);

            return (
              <button key={section.id} type="button" data-active={activeCatalogSection === section.id} onClick={() => setActiveCatalogSection(section.id)}>
                <SectionIcon size={15} aria-hidden="true" />
                <span>{section.label}</span>
                <small>{getAppsSectionMeta(section.id, { mcpEnabledCount, pluginCatalogCount })}</small>
              </button>
            );
          })}
        </nav>

        <section className="apps-plugin-grid" aria-label="Available apps and plugins">
          {gmailMatchesSearch ? (
            <article className="apps-plugin-card apps-plugin-card-featured" data-expanded={gmailExpanded}>
              <div className="apps-plugin-card-header">
                <WebAppLogo className="apps-plugin-logo-gmail" fallback={<Mail size={20} aria-hidden="true" />} src={APP_ICON_URLS.gmail} />
                <div>
                  <div className="apps-plugin-title-row">
                    <h3>Gmail</h3>
                    <span className="apps-plugin-status" data-kind={gmailStatusKind}>
                      {gmailConnected ? <CheckCircle2 size={14} aria-hidden="true" /> : <AlertCircle size={14} aria-hidden="true" />}
                      {gmailStatusLabel}
                    </span>
                  </div>
                  <span className="apps-plugin-maker">
                    <BadgeCheck size={14} aria-hidden="true" />
                    Made by Gilbert Codex
                  </span>
                </div>
              </div>

              <p className="apps-plugin-description">Email search, thread summaries, drafts, labels, and user-approved sends.</p>

              <div className="apps-plugin-account" data-connected={gmailConnected}>
                <Mail size={15} aria-hidden="true" />
                <span>{gmailAccountLabel}</span>
              </div>

              <div className="apps-plugin-top-actions">
                <button className="apps-plugin-primary" type="button" disabled={gmailBusy} onClick={handleGmailPrimaryAction}>
                  {gmailActionState === "connect" ? "Opening Google" : gmailActionState === "install" ? "Installing" : gmailConnected ? "Manage" : gmailInstalled ? "Sign in" : "Install"}
                </button>
              </div>

              {gmailStatus && (!gmailConnected || gmailStatus.kind !== "success" || gmailExpanded) ? (
                <div className="apps-plugin-message" data-kind={gmailStatus.kind}>
                  {gmailStatus.text}
                </div>
              ) : null}

              {gmailExpanded ? (
                <div className="apps-plugin-expanded" aria-label="Gmail tools">
                  <div className="apps-plugin-expanded-head">
                    <strong>Included tools</strong>
                    <small>Mail reads, drafts, labels, and sends</small>
                  </div>

                  <div className="apps-plugin-smart-strip" aria-label="Gmail smart actions">
                    <span>Context aware</span>
                    <span>Full Gmail API</span>
                    <span>{gmailMaxAccounts} accounts</span>
                  </div>

                  <div className="apps-plugin-capabilities" aria-label="Gmail capabilities">
                    <span>Inbox search</span>
                    <span>Thread summaries</span>
                    <span>Draft replies</span>
                    <span>Direct send</span>
                    <span>Bulk labels</span>
                    <span>Settings</span>
                  </div>

                  <div className="apps-plugin-safety">
                    <ShieldCheck size={16} aria-hidden="true" />
                    <span>Full mailbox access unlocks after Google approval; destructive actions still use review cards.</span>
                  </div>
                </div>
              ) : null}

              <div className="apps-plugin-actions">
                <button className="apps-plugin-secondary apps-plugin-details-button" type="button" aria-expanded={gmailExpanded} onClick={() => toggleAppCardExpanded("gmail")}>
                  <ChevronDown size={14} aria-hidden="true" />
                  {gmailExpanded ? "Collapse" : "Expand"}
                </button>
              </div>
            </article>
          ) : null}

          {calendarMatchesSearch ? (
            <article className="apps-plugin-card apps-plugin-card-featured" data-expanded={calendarExpanded}>
              <div className="apps-plugin-card-header">
                <WebAppLogo className="apps-plugin-logo-calendar" fallback={<CalendarDays size={20} aria-hidden="true" />} src={APP_ICON_URLS.googleCalendar} />
                <div>
                  <div className="apps-plugin-title-row">
                    <h3>Google Calendar</h3>
                    <span className="apps-plugin-status" data-kind={calendarStatusKind}>
                      {calendarConnected ? <CheckCircle2 size={14} aria-hidden="true" /> : <AlertCircle size={14} aria-hidden="true" />}
                      {calendarStatusLabel}
                    </span>
                  </div>
                  <span className="apps-plugin-maker">
                    <BadgeCheck size={14} aria-hidden="true" />
                    Made by Gilbert Codex
                  </span>
                </div>
              </div>

              <p className="apps-plugin-description">Agenda review, event search, free-busy checks, and approved calendar changes.</p>

              <div className="apps-plugin-account" data-connected={calendarConnected}>
                <CalendarDays size={15} aria-hidden="true" />
                <span>{calendarAccountLabel}</span>
              </div>

              <div className="apps-plugin-top-actions">
                <button className="apps-plugin-primary" type="button" disabled={calendarBusy} onClick={handleCalendarPrimaryAction}>
                  {calendarActionState === "connect" ? "Opening Google" : calendarActionState === "install" ? "Installing" : calendarConnected ? "Manage" : calendarInstalled ? "Sign in" : "Install"}
                </button>
              </div>

              {calendarStatus && (!calendarConnected || calendarStatus.kind !== "success" || calendarExpanded) ? (
                <div className="apps-plugin-message" data-kind={calendarStatus.kind}>
                  {calendarStatus.text}
                </div>
              ) : null}

              {calendarExpanded ? (
                <div className="apps-plugin-expanded" aria-label="Google Calendar tools">
                  <div className="apps-plugin-expanded-head">
                    <strong>Included tools</strong>
                    <small>Events, calendars, tasks, and availability</small>
                  </div>

                  <div className="apps-plugin-smart-strip" aria-label="Google Calendar smart actions">
                    <span>Agenda aware</span>
                    <span>Free-busy safe</span>
                    <span>{calendarMaxAccounts} accounts</span>
                  </div>

                  <div className="apps-plugin-capabilities" aria-label="Google Calendar capabilities">
                    <span>Agenda review</span>
                    <span>Event search</span>
                    <span>Free-busy</span>
                    <span>Meeting prep</span>
                    <span>Create events</span>
                    <span>Update events</span>
                    <span>Google Tasks</span>
                  </div>

                  <div className="apps-plugin-safety">
                    <ShieldCheck size={16} aria-hidden="true" />
                    <span>Calendar writes can run with full access, but destructive actions still use approval.</span>
                  </div>
                </div>
              ) : null}

              <div className="apps-plugin-actions">
                <button className="apps-plugin-secondary apps-plugin-details-button" type="button" aria-expanded={calendarExpanded} onClick={() => toggleAppCardExpanded("google-calendar")}>
                  <ChevronDown size={14} aria-hidden="true" />
                  {calendarExpanded ? "Collapse" : "Expand"}
                </button>
              </div>
            </article>
          ) : null}

          {githubMatchesSearch ? (
            <article className="apps-plugin-card apps-plugin-card-featured" data-expanded={githubExpanded}>
              <div className="apps-plugin-card-header">
                <WebAppLogo className="apps-plugin-logo-github" fallback={<Github size={20} aria-hidden="true" />} src={APP_ICON_URLS.github} />
                <div>
                  <div className="apps-plugin-title-row">
                    <h3>GitHub</h3>
                    <span className="apps-plugin-status" data-kind={githubStatusKind}>
                      {githubConnected ? <CheckCircle2 size={14} aria-hidden="true" /> : <AlertCircle size={14} aria-hidden="true" />}
                      {githubStatusLabel}
                    </span>
                  </div>
                  <span className="apps-plugin-maker">
                    <BadgeCheck size={14} aria-hidden="true" />
                    Made by Gilbert Codex
                  </span>
                </div>
              </div>

              <p className="apps-plugin-description">Repository, issue, pull request, release, Action, and local Git tools.</p>

              <div className="apps-plugin-account" data-connected={githubConnected}>
                <Github size={15} aria-hidden="true" />
                <span>{githubAccountLabel}</span>
              </div>

              <div className="apps-plugin-top-actions">
                <button className="apps-plugin-primary" type="button" disabled={githubBusy} onClick={() => void installOrOpenGithub()}>
                  {githubActionState === "install" ? "Installing" : githubConnected ? "Manage" : githubInstalled ? "Sign in" : "Install"}
                </button>
                <button className="apps-plugin-secondary apps-plugin-icon-action" type="button" aria-label="Refresh GitHub" title="Refresh GitHub" disabled={githubBusy || !githubAvailable} onClick={() => void refreshGithubConnection()}>
                  <RefreshCw size={14} aria-hidden="true" />
                </button>
              </div>

              {githubStatus && (!githubConnected || githubStatus.kind !== "success" || githubExpanded) ? (
                <div className="apps-plugin-message" data-kind={githubStatus.kind}>
                  {githubStatus.text}
                </div>
              ) : null}

              {githubExpanded ? (
                <div className="apps-plugin-expanded" aria-label="GitHub tools">
                  <div className="apps-plugin-expanded-head">
                    <strong>Included tools</strong>
                    <small>Repos, issues, pull requests, releases, and local Git</small>
                  </div>

                  <div className="apps-plugin-smart-strip" aria-label="GitHub smart actions">
                    <span>Local Git aware</span>
                    <span>Semantic search</span>
                    <span>REST fallback</span>
                  </div>

                  <div className="apps-plugin-capabilities" aria-label="GitHub capabilities">
                    <span>Working tree</span>
                    <span>Branches</span>
                    <span>Commits</span>
                    <span>Pull requests</span>
                    <span>Issues</span>
                    <span>Actions</span>
                    <span>Releases</span>
                    <span>API tools</span>
                  </div>

                  <div className="apps-plugin-safety">
                    <ShieldCheck size={16} aria-hidden="true" />
                    <span>Reads run after connection; commits, PRs, releases, workflow actions, and API writes stay approval gated.</span>
                  </div>
                </div>
              ) : null}

              <div className="apps-plugin-actions">
                <button className="apps-plugin-secondary apps-plugin-details-button" type="button" aria-expanded={githubExpanded} onClick={() => toggleAppCardExpanded("github")}>
                  <ChevronDown size={14} aria-hidden="true" />
                  {githubExpanded ? "Collapse" : "Expand"}
                </button>
              </div>
            </article>
          ) : null}

          {openAiPluginMatchesSearch ? (
            <section className="apps-plugin-marketplace-board" aria-label="Gilbert Codex plugin marketplace">
              <div className="apps-mcp-board-head">
                <div className="apps-mcp-heading">
                  <span className="apps-plugin-logo apps-plugin-logo-marketplace">
                    <PlugZap size={20} aria-hidden="true" />
                  </span>
                  <span>
                    <strong>Gilbert Plugin Marketplace</strong>
                    <small>Curated plugin catalog mapped to Gilbert install paths</small>
                  </span>
                  <span className="apps-plugin-status" data-kind={openAiPluginBusy ? "setup" : "ready"}>
                    {openAiPluginBusy ? <RefreshCw size={14} aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />}
                    {openAiPluginBusy ? "Loading" : `${openAiCatalogPlugins.length} plugins`}
                  </span>
                </div>
              </div>

              <div className="apps-plugin-marketplace-summary" aria-label="Plugin marketplace summary">
                <span>
                  <strong>Native</strong>
                  Gmail, Calendar, GitHub
                </span>
                <span>
                  <strong>MCP</strong>
                  Save and test runnable servers
                </span>
                <span>
                  <strong>Skills</strong>
                  Import bundled workflows
                </span>
                <span>
                  <strong>Registry</strong>
                  Find public tool servers
                </span>
              </div>

              {openAiPluginStatus ? (
                <div className="apps-plugin-message" data-kind={openAiPluginStatus.kind}>
                  {openAiPluginStatus.text}
                </div>
              ) : null}

              {openAiPluginBusy ? (
                <div className="apps-plugin-marketplace-loading">
                  <RefreshCw size={16} aria-hidden="true" />
                  <span>Loading plugin metadata...</span>
                </div>
              ) : openAiVisiblePlugins.length > 0 ? (
                <div className="apps-plugin-marketplace-grid">
                  {openAiVisiblePlugins.map((plugin) => {
                    const pluginBusy = openAiPluginActionId === plugin.id;
                    const runtimeState = marketplacePluginStates.get(plugin.id) ?? getMarketplacePluginRuntimeState(plugin, mcpServers, skillRegistry);

                    return (
                      <article key={plugin.id} className="apps-plugin-marketplace-card" data-status={runtimeState.statusKind}>
                        <div className="apps-plugin-marketplace-card-top">
                          <span className="apps-mcp-card-avatar" aria-hidden="true">{getPluginInitials(plugin.displayName)}</span>
                          <span>
                            <strong>{plugin.displayName}</strong>
                            <small>{plugin.category} | {runtimeState.statusLabel}</small>
                          </span>
                          <em>{runtimeState.routeLabel}</em>
                        </div>
                        <p>{runtimeState.description}</p>
                        <div className="apps-mcp-preset-tags" aria-label={`${plugin.displayName} tags`}>
                          {runtimeState.tags.map((tag) => <em key={tag}>{tag}</em>)}
                        </div>
                        <div className="apps-plugin-marketplace-actions">
                          <button
                            className="apps-plugin-primary"
                            type="button"
                            disabled={pluginBusy || runtimeState.primaryDisabled || (plugin.installRoute === "mcp-preset" && mcpBusy)}
                            onClick={() => void handleOpenAiPluginPrimaryAction(plugin)}
                          >
                            {pluginBusy ? "Working" : runtimeState.primaryActionLabel}
                          </button>
                          {plugin.hasBundledSkills && plugin.installRoute !== "skill-import" ? (
                            <button className="apps-plugin-secondary" type="button" disabled={pluginBusy || runtimeState.secondaryDisabled} onClick={() => runtimeState.skillCount > 0 ? viewPluginSkills(plugin) : void installOpenAiPluginSkills(plugin)}>
                              {runtimeState.secondaryActionLabel ?? "Skills"}
                            </button>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="apps-empty-state">
                  <Puzzle size={20} aria-hidden="true" />
                  <span>
                    <strong>No marketplace plugins match</strong>
                    <small>Try Figma, Slack, Notion, Vercel, Payments, Supabase, or Developer Docs.</small>
                  </span>
                </div>
              )}

              {openAiFilteredPlugins.length > OPENAI_PLUGIN_PAGE_SIZE ? (
                <div className="apps-mcp-pagination" aria-label="Gilbert plugin marketplace pagination">
                  <span>{openAiPluginPageStart + 1}-{Math.min(openAiPluginPageStart + OPENAI_PLUGIN_PAGE_SIZE, openAiFilteredPlugins.length)} of {openAiFilteredPlugins.length}</span>
                  <button type="button" disabled={openAiPluginCurrentPage === 0} onClick={() => setOpenAiPluginPage((page) => Math.max(0, page - 1))}>Previous</button>
                  <button type="button" disabled={openAiPluginCurrentPage >= openAiPluginPageCount - 1} onClick={() => setOpenAiPluginPage((page) => Math.min(openAiPluginPageCount - 1, page + 1))}>Next</button>
                </div>
              ) : null}

              <div className="apps-plugin-safety">
                <ShieldCheck size={16} aria-hidden="true" />
                <span>Hosted connector IDs are not treated as live Gilbert tools. Gilbert only marks a plugin usable after native install, MCP test, or local skill import succeeds.</span>
              </div>
            </section>
          ) : null}

          {mcpMatchesSearch ? (
            <section className="apps-mcp-board" aria-label="MCP servers and catalog">
              <div className="apps-mcp-board-head">
                <div className="apps-mcp-heading">
                  <WebAppLogo className="apps-plugin-logo-mcp" fallback={<Server size={20} aria-hidden="true" />} src={APP_ICON_URLS.mcp} />
                  <span>
                    <strong>MCP Servers</strong>
                    <small>External tools, app servers, and command-line MCPs</small>
                  </span>
                  <span className="apps-plugin-status" data-kind={mcpStatusKind}>
                    {mcpConnected ? <CheckCircle2 size={14} aria-hidden="true" /> : <AlertCircle size={14} aria-hidden="true" />}
                    {mcpStatusLabel}
                  </span>
                </div>

                <div className="apps-mcp-board-actions">
                  <button className="apps-plugin-primary" type="button" disabled={mcpBusy && mcpActionState !== "refresh"} onClick={() => openMcpServerDialog()}>
                    <Plus size={15} aria-hidden="true" />
                    Add MCP
                  </button>
                  <button className="apps-plugin-secondary" type="button" disabled={mcpBusy || !mcpConfigured} onClick={() => void testAllMcpServers()}>
                    <RefreshCw size={14} aria-hidden="true" />
                    {mcpActionState === "test-all" ? "Testing" : "Test all"}
                  </button>
                  <button className="apps-plugin-secondary apps-plugin-icon-action" type="button" aria-label="Refresh MCP servers" title="Refresh MCP servers" disabled={mcpBusy || !mcpAvailable} onClick={() => void refreshMcpConnections()}>
                    <RefreshCw size={14} aria-hidden="true" />
                  </button>
                </div>
              </div>

              {mcpStatus ? (
                <div className="apps-plugin-message" data-kind={mcpStatus.kind}>
                  {mcpStatus.text}
                </div>
              ) : null}

              <div className="apps-mcp-summary-grid" aria-label="MCP status">
                <span>
                  <strong>{mcpEnabledCount}/{mcpMaxServers}</strong>
                  Enabled servers
                </span>
                <span>
                  <strong>{mcpToolCount}</strong>
                  Cached tools
                </span>
                <span>
                  <strong>HTTP</strong>
                  Streamable endpoints
                </span>
                <span>
                  <strong>stdio</strong>
                  Local commands
                </span>
              </div>

              <section className="apps-mcp-section" aria-label="Configured MCP servers">
                <div className="apps-mcp-panel-head">
                  <div className="apps-plugin-expanded-head">
                    <strong>Configured MCPs</strong>
                    <small>{mcpConfigured ? mcpAccountLabel : "Add a server card, test tools, then use it in chat."}</small>
                  </div>
                  <div className="apps-mcp-steps" aria-label="MCP setup steps">
                    <span>Add</span>
                    <span>Test</span>
                    <span>Chat</span>
                  </div>
                </div>

                <div className="apps-mcp-server-card-grid">
                  {mcpServers.map((server) => {
                    const tools = server.tools ?? [];

                    return (
                      <article key={server.id} className="apps-mcp-server-card" data-enabled={server.enabled} data-error={Boolean(server.lastError)}>
                        <div className="apps-mcp-card-top">
                          <span className="apps-mcp-card-avatar" aria-hidden="true">
                            <Server size={17} aria-hidden="true" />
                          </span>
                          <span>
                            <strong>{server.name}</strong>
                            <small>{formatMcpServerTarget(server)}</small>
                          </span>
                          <em>{server.transport === "stdio" ? "stdio" : "HTTP"}</em>
                        </div>
                        <p>{formatMcpServerDetail(server)}</p>
                        <div className="apps-mcp-tool-chip-list" aria-label={`${server.name} cached tools`}>
                          {tools.length > 0 ? tools.slice(0, 5).map((tool) => (
                            <em key={tool.name}>{tool.name}</em>
                          )) : <em>No cached tools</em>}
                          {tools.length > 5 ? <em>+{tools.length - 5}</em> : null}
                        </div>
                        <div className="apps-mcp-card-actions">
                          <button type="button" disabled={mcpBusy} onClick={() => openMcpServerDialog(server)}>
                            <Wrench size={14} aria-hidden="true" />
                            Edit
                          </button>
                          <button type="button" disabled={mcpBusy || !server.enabled} onClick={() => void refreshMcpServerTools(server.id)}>
                            <RefreshCw size={14} aria-hidden="true" />
                            Tools
                          </button>
                          <button className="mcp-server-remove-button" type="button" disabled={mcpBusy} onClick={() => void removeConfiguredMcpServer(server)}>
                            <Trash2 size={14} aria-hidden="true" />
                          </button>
                        </div>
                      </article>
                    );
                  })}

                  <button className="apps-mcp-add-server-card" type="button" disabled={mcpBusy || !mcpAvailable} onClick={() => openMcpServerDialog()}>
                    <span className="apps-mcp-card-avatar" aria-hidden="true">
                      <Plus size={18} aria-hidden="true" />
                    </span>
                    <strong>Add custom MCP</strong>
                    <small>Remote HTTPS, localhost development, or command-line stdio server.</small>
                  </button>
                </div>
              </section>

              <section className="apps-mcp-section" aria-label="Featured MCP connectors">
                <div className="apps-mcp-panel-head">
                  <div className="apps-plugin-expanded-head">
                    <strong>Featured MCPs</strong>
                    <small>{normalizedSearchQuery ? `${mcpFilteredPresets.length} of ${MCP_FEATURED_PRESETS.length} matching curated app, database, design, and docs servers` : `${MCP_FEATURED_PRESETS.length} curated app, database, design, and docs servers`}</small>
                  </div>
                  <div className="apps-mcp-pagination" aria-label="Featured MCP pagination">
                    <span>{mcpFilteredPresets.length > 0 ? `${mcpPresetPageStart + 1}-${Math.min(mcpPresetPageStart + MCP_PRESET_PAGE_SIZE, mcpFilteredPresets.length)} of ${mcpFilteredPresets.length}` : "0 of 0"}</span>
                    <button type="button" disabled={mcpPresetCurrentPage === 0} onClick={() => setMcpPresetPage((page) => Math.max(0, page - 1))}>Previous</button>
                    <button type="button" disabled={mcpPresetCurrentPage >= mcpPresetPageCount - 1} onClick={() => setMcpPresetPage((page) => Math.min(mcpPresetPageCount - 1, page + 1))}>Next</button>
                  </div>
                </div>
                <div className="apps-mcp-preset-grid">
                  {mcpVisiblePresets.map((preset) => (
                    <button key={preset.id} className="apps-mcp-preset-card" type="button" disabled={mcpBusy} onClick={() => configureMcpPreset(preset)}>
                      <span className="apps-mcp-card-top">
                        <span className="apps-mcp-card-avatar" aria-hidden="true">{getMcpPresetInitials(preset)}</span>
                        <span>
                          <strong>{preset.name}</strong>
                          <small>{preset.publisher}</small>
                        </span>
                        <em>{preset.transport === "stdio" ? "stdio" : "HTTP"}</em>
                      </span>
                      <small>{preset.description}</small>
                      <span className="apps-mcp-preset-tags">
                        {preset.tags.slice(0, 3).map((tag) => (
                          <em key={tag}>{tag}</em>
                        ))}
                      </span>
                    </button>
                  ))}
                  {mcpVisiblePresets.length === 0 ? (
                    <div className="apps-empty-state">
                      <strong>No featured MCPs match</strong>
                      <small>Try AWS, App Backend, Slack, Brave, Postgres, Netlify, or Playwright.</small>
                    </div>
                  ) : null}
                </div>
              </section>

              <section className="apps-mcp-section" aria-label="MCP Registry search">
                <div className="apps-plugin-expanded-head">
                  <strong>MCP Registry</strong>
                  <small>Search public MCP servers and generate a Gilbert configuration</small>
                </div>
                <form className="apps-mcp-registry-search" onSubmit={(event) => {
                  event.preventDefault();
                  void searchMcpRegistryCatalog();
                }}>
                  <Search size={15} aria-hidden="true" />
                  <input value={mcpRegistryQuery} placeholder="Search supabase, aws, figma..." onChange={(event) => setMcpRegistryQuery(event.target.value)} />
                  <button type="submit" disabled={mcpRegistryBusy || !mcpAvailable}>
                    {mcpRegistryBusy ? "Searching" : "Search"}
                  </button>
                </form>
                {mcpRegistryStatus ? (
                  <div className="apps-plugin-message" data-kind={mcpRegistryStatus.kind}>
                    {mcpRegistryStatus.text}
                  </div>
                ) : null}
                {mcpRegistryResults.length > 0 ? (
                  <div className="apps-mcp-registry-results" aria-label="MCP Registry results">
                    {mcpVisibleRegistryResults.map((server) => (
                      <article key={`${server.name}-${server.version ?? "latest"}`}>
                        <span>
                          <strong>{formatMcpRegistryServerName(server)}</strong>
                          <small>{formatMcpRegistryServerMeta(server)}</small>
                        </span>
                        <p>{server.description ?? "No description published for this MCP server."}</p>
                        <button type="button" disabled={!server.install || mcpBusy} onClick={() => configureMcpRegistryServer(server)}>
                          {server.install ? "Configure" : "No install hint"}
                        </button>
                      </article>
                    ))}
                  </div>
                ) : null}
                {mcpRegistryResults.length > MCP_REGISTRY_PAGE_SIZE ? (
                  <div className="apps-mcp-pagination" aria-label="MCP Registry pagination">
                    <span>{mcpRegistryPageStart + 1}-{Math.min(mcpRegistryPageStart + MCP_REGISTRY_PAGE_SIZE, mcpRegistryResults.length)} of {mcpRegistryResults.length}</span>
                    <button type="button" disabled={mcpRegistryCurrentPage === 0} onClick={() => setMcpRegistryPage((page) => Math.max(0, page - 1))}>Previous</button>
                    <button type="button" disabled={mcpRegistryCurrentPage >= mcpRegistryPageCount - 1} onClick={() => setMcpRegistryPage((page) => Math.min(mcpRegistryPageCount - 1, page + 1))}>Next</button>
                  </div>
                ) : null}
              </section>

              <div className="apps-plugin-safety">
                <ShieldCheck size={16} aria-hidden="true" />
                <span>Bearer tokens and stdio environment values stay in OS-backed secure storage; chat gets server inventory, tool discovery, and gated tool calls.</span>
              </div>
            </section>
          ) : null}

          {skillsMatchesSearch ? (
            <SkillsManagerPanel searchQuery={normalizedSearchQuery} onOpenKeysSettings={onOpenKeysSettings} />
          ) : null}

          {visibleCardCount === 0 ? (
            <div className="apps-empty-state">
              <Puzzle size={20} aria-hidden="true" />
              <span>
                <strong>No apps match</strong>
                <small>Try Gmail, Calendar, GitHub, Skills, MCP, plugins, or email.</small>
              </span>
            </div>
          ) : null}
        </section>
      </main>

      {gmailConnectOpen ? (
        <DialogShell
        description={`${gmailAccountRows.length}/${gmailMaxAccounts} connected`}
        icon={Mail}
        open={gmailConnectOpen}
        title="Gmail accounts"
        onClose={() => setGmailConnectOpen(false)}
      >
        <div className="gmail-connect-dialog">
          <section className="gmail-account-manager" aria-label="Connected Gmail accounts">
            <div className="gmail-account-manager-heading">
              <span>
                <strong>Accounts</strong>
                <small>{gmailAccountRows.length}/{gmailMaxAccounts} connected</small>
              </span>
              <button className="gmail-account-add-button" type="button" disabled={gmailBusy || !gmailCanAddAccount || !gmailAvailable} onClick={() => void startGmailConnection()}>
                <LogIn size={15} aria-hidden="true" />
                Sign in
              </button>
            </div>

            {gmailAccountRows.length > 0 ? (
              <div className="gmail-account-list">
                {gmailAccountRows.map((account) => (
                  <div key={account.email} className="gmail-account-row" data-active={account.active}>
                    <span className="gmail-account-avatar">
                      {account.user.picture ? <img src={account.user.picture} alt="" decoding="async" loading="lazy" referrerPolicy="no-referrer" /> : <Mail size={16} aria-hidden="true" />}
                    </span>
                    <span className="gmail-account-details">
                      <strong>{account.email}</strong>
                      <small>{account.active ? "Active" : "Connected"}</small>
                    </span>
                    <span className="gmail-account-actions">
                      {account.active ? (
                        <span className="gmail-account-active-badge">
                          <UserCheck size={14} aria-hidden="true" />
                          Active
                        </span>
                      ) : (
                        <button type="button" disabled={gmailBusy} onClick={() => void activateGmailAccount(account.email)}>
                          <UserCheck size={14} aria-hidden="true" />
                          Use
                        </button>
                      )}
                      <button className="gmail-account-signout-button" type="button" disabled={gmailBusy} onClick={() => void disconnectConnectedGmailAccount(account.email)}>
                        <LogOut size={14} aria-hidden="true" />
                        Sign out
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="gmail-account-empty">
                <Mail size={18} aria-hidden="true" />
                <span>
                  <strong>No Gmail account connected</strong>
                  <small>Sign in to connect an account.</small>
                </span>
              </div>
            )}
          </section>

          {gmailStatus && gmailStatus.kind !== "success" ? (
            <div className="gmail-connect-status" data-kind={gmailStatus.kind}>
              {gmailStatus.text}
            </div>
          ) : null}
        </div>
        </DialogShell>
      ) : null}

      {calendarConnectOpen ? (
        <DialogShell
        description={`${calendarAccountRows.length}/${calendarMaxAccounts} connected`}
        icon={CalendarDays}
        open={calendarConnectOpen}
        title="Google Calendar accounts"
        onClose={() => setCalendarConnectOpen(false)}
      >
        <div className="gmail-connect-dialog">
          <section className="gmail-account-manager" aria-label="Connected Google Calendar accounts">
            <div className="gmail-account-manager-heading">
              <span>
                <strong>Accounts</strong>
                <small>{calendarAccountRows.length}/{calendarMaxAccounts} connected</small>
              </span>
              <button className="gmail-account-add-button" type="button" disabled={calendarBusy || !calendarCanAddAccount || !calendarAvailable} onClick={() => void startCalendarConnection()}>
                <LogIn size={15} aria-hidden="true" />
                Sign in
              </button>
            </div>

            {calendarAccountRows.length > 0 ? (
              <div className="gmail-account-list">
                {calendarAccountRows.map((account) => (
                  <div key={account.email} className="gmail-account-row" data-active={account.active}>
                    <span className="gmail-account-avatar">
                      {account.user.picture ? <img src={account.user.picture} alt="" decoding="async" loading="lazy" referrerPolicy="no-referrer" /> : <CalendarDays size={16} aria-hidden="true" />}
                    </span>
                    <span className="gmail-account-details">
                      <strong>{account.email}</strong>
                      <small>{account.active ? "Active" : "Connected"}</small>
                    </span>
                    <span className="gmail-account-actions">
                      {account.active ? (
                        <span className="gmail-account-active-badge">
                          <UserCheck size={14} aria-hidden="true" />
                          Active
                        </span>
                      ) : (
                        <button type="button" disabled={calendarBusy} onClick={() => void activateCalendarAccount(account.email)}>
                          <UserCheck size={14} aria-hidden="true" />
                          Use
                        </button>
                      )}
                      <button className="gmail-account-signout-button" type="button" disabled={calendarBusy} onClick={() => void disconnectConnectedCalendarAccount(account.email)}>
                        <LogOut size={14} aria-hidden="true" />
                        Sign out
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="gmail-account-empty">
                <CalendarDays size={18} aria-hidden="true" />
                <span>
                  <strong>No Google Calendar account connected</strong>
                  <small>Sign in to connect an account.</small>
                </span>
              </div>
            )}
          </section>

          {calendarStatus && calendarStatus.kind !== "success" ? (
            <div className="gmail-connect-status" data-kind={calendarStatus.kind}>
              {calendarStatus.text}
            </div>
          ) : null}
        </div>
        </DialogShell>
      ) : null}

      {mcpDialogOpen ? (
        <DialogShell
        description={`Connect up to ${mcpMaxServers} Streamable HTTP or command-line stdio MCP servers. Enabled servers become available to chat as MCP tools when settings allow them.`}
        icon={Server}
        open={mcpDialogOpen}
        title="Manage MCP servers"
        onClose={() => setMcpDialogOpen(false)}
        actions={
          <>
            <button className="dialog-button" type="button" onClick={() => setMcpDialogOpen(false)}>
              Close
            </button>
            <button className="dialog-button dialog-button-primary" type="button" disabled={mcpBusy || !mcpAvailable} onClick={() => openMcpServerDialog()}>
              <Plus size={15} aria-hidden="true" />
              New server
            </button>
          </>
        }
      >
        <div className="mcp-connect-dialog">
          <section className="mcp-server-manager" aria-label="Configured MCP servers">
            <div className="gmail-account-manager-heading">
              <span>
                <strong>Servers</strong>
                <small>{mcpEnabledCount}/{mcpMaxServers} enabled | {mcpToolCount} cached tools</small>
              </span>
              <button className="gmail-account-add-button" type="button" disabled={mcpBusy || !mcpAvailable} onClick={() => void refreshMcpConnections()}>
                <RefreshCw size={15} aria-hidden="true" />
                Refresh
              </button>
            </div>

            {mcpServers.length > 0 ? (
              <div className="mcp-server-list">
                {mcpServers.map((server) => (
                  <div key={server.id} className="mcp-server-row" data-enabled={server.enabled}>
                    <span className="mcp-server-avatar">
                      <Server size={17} aria-hidden="true" />
                    </span>
                    <span className="mcp-server-details">
                      <strong>{server.name}</strong>
                      <small>{formatMcpServerTarget(server)}</small>
                      <small>{formatMcpServerDetail(server)}</small>
                    </span>
                    <span className="mcp-server-actions">
                      <button type="button" disabled={mcpBusy} onClick={() => openMcpServerDialog(server)}>
                        <Wrench size={14} aria-hidden="true" />
                        Edit
                      </button>
                      <button type="button" disabled={mcpBusy} onClick={() => void refreshMcpServerTools(server.id)}>
                        <RefreshCw size={14} aria-hidden="true" />
                        Tools
                      </button>
                      <button className="mcp-server-remove-button" type="button" disabled={mcpBusy} onClick={() => void removeConfiguredMcpServer(server)}>
                        <Trash2 size={14} aria-hidden="true" />
                        Remove
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="gmail-account-empty">
                <Server size={18} aria-hidden="true" />
                <span>
                  <strong>No MCP server connected</strong>
                  <small>Add a remote HTTPS server or a localhost development endpoint.</small>
                </span>
              </div>
            )}
          </section>

          <section className="mcp-server-form" aria-label={mcpDraft.id ? "Edit MCP server" : "Add MCP server"}>
            <div className="gmail-connect-permissions-heading">
              <Server size={16} aria-hidden="true" />
              <span>{mcpDraft.id ? "Edit server" : "Add server"}</span>
            </div>

            <div className="mcp-setup-panel" data-ready={mcpDraftSetup.issues.length === 0}>
              <div className="mcp-setup-heading">
                <KeyRound size={15} aria-hidden="true" />
                <span>
                  <strong>{mcpDraftSetup.preset ? `${mcpDraftSetup.preset.name} setup` : "Manual setup"}</strong>
                  <small>{formatMcpSetupSummaryLabel(mcpDraftSetup)}</small>
                </span>
                <button type="button" onClick={onOpenKeysSettings}>Keys</button>
                {mcpDraftSetup.preset?.docsUrl ? (
                  <a href={mcpDraftSetup.preset.docsUrl} target="_blank" rel="noreferrer">Docs</a>
                ) : null}
              </div>
              <div className="mcp-setup-checks">
                {mcpDraftSetup.requiredAlternatives.length > 0 ? (
                  mcpDraftSetup.requiredAlternatives.map((alternative) => (
                    <span key={alternative.id} data-status={alternative.ready ? "ready" : "missing"}>
                      {alternative.ready ? <CheckCircle2 size={13} aria-hidden="true" /> : <AlertCircle size={13} aria-hidden="true" />}
                      {alternative.label}: {alternative.requirements.map((item) => item.requirement.name).join(" + ")}
                    </span>
                  ))
                ) : (
                  <span data-status="ready">
                    <CheckCircle2 size={13} aria-hidden="true" />
                    No required key before testing
                  </span>
                )}
                {mcpDraftSetup.optionalRequirements.map((item) => (
                  <span key={`optional-${item.requirement.location}-${item.requirement.name}`} data-status={item.status}>
                    {item.status === "ready" ? <CheckCircle2 size={13} aria-hidden="true" /> : <KeyRound size={13} aria-hidden="true" />}
                    Optional: {item.requirement.name}
                  </span>
                ))}
              </div>
              {mcpDraftSetup.preset?.setupSteps.length ? (
                <div className="mcp-setup-steps">
                  {mcpDraftSetup.preset.setupSteps.map((step) => (
                    <span key={step}>{step}</span>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="mcp-form-grid">
              <div className="mcp-transport-tabs" role="group" aria-label="MCP transport">
                <button type="button" data-active={mcpDraft.transport === "http"} onClick={() => setMcpDraft((draft) => ({ ...draft, transport: "http" }))}>
                  <Globe2 size={14} aria-hidden="true" />
                  HTTP
                </button>
                <button type="button" data-active={mcpDraft.transport === "stdio"} onClick={() => setMcpDraft((draft) => ({ ...draft, transport: "stdio" }))}>
                  <TerminalSquare size={14} aria-hidden="true" />
                  Stdio
                </button>
              </div>
              <label className="mcp-field">
                <span>Name</span>
                <input value={mcpDraft.name} placeholder={mcpDraft.transport === "stdio" ? "Local Echo" : "Docs tools"} onChange={(event) => setMcpDraft((draft) => ({ ...draft, name: event.target.value }))} />
              </label>
              {mcpDraft.transport === "http" ? (
                <>
                  <label className="mcp-field">
                    <span>Endpoint</span>
                    <input value={mcpDraft.endpoint} placeholder="https://example.com/mcp" onChange={(event) => setMcpDraft((draft) => ({ ...draft, endpoint: event.target.value }))} />
                  </label>
                  <label className="mcp-field">
                    <span>Bearer token</span>
                    <input
                      type="password"
                      value={mcpDraft.authorizationToken}
                      placeholder={getMcpBearerPlaceholder(mcpDraftSetup)}
                      onChange={(event) => setMcpDraft((draft) => ({ ...draft, authorizationToken: event.target.value }))}
                    />
                    {getMcpBearerKeySelectorRequirements(mcpDraftSetup).map((item) => (
                      <select key={`bearer-key-${item.requirement.name}`} value="" onChange={(event) => {
                        applySavedMcpKey(item.requirement, event.target.value);
                        event.currentTarget.value = "";
                      }}>
                        <option value="">{apiKeysAvailable ? "Use saved key..." : "No saved keys yet"}</option>
                        {getSavedKeyOptionsForMcpRequirement(apiKeyVault.keys, item.requirement, mcpDraftSetup.preset).map((key) => (
                          <option key={key.id} value={key.id}>{formatSavedApiKeyOption(key)}</option>
                        ))}
                      </select>
                    ))}
                  </label>
                  {getMcpSetupRequirementsByLocation(mcpDraftSetup, "query").map((item) => (
                    <label key={`query-${item.requirement.name}`} className="mcp-field mcp-secret-field">
                      <span>{item.requirement.label}</span>
                      <select value="" onChange={(event) => {
                        applySavedMcpKey(item.requirement, event.target.value);
                        event.currentTarget.value = "";
                      }}>
                        <option value="">{apiKeysAvailable ? "Use saved key..." : "No saved keys yet"}</option>
                        {getSavedKeyOptionsForMcpRequirement(apiKeyVault.keys, item.requirement, mcpDraftSetup.preset).map((key) => (
                          <option key={key.id} value={key.id}>{formatSavedApiKeyOption(key)}</option>
                        ))}
                      </select>
                      <input
                        type="password"
                        value={getMcpKeyValueDraftValue(mcpDraft.queryText, item.requirement.name)}
                        placeholder={getMcpSecretPlaceholder(item, mcpDraftSetup)}
                        onChange={(event) => updateMcpDraftQuerySecret(item.requirement.name, event.target.value)}
                      />
                      <small>{item.requirement.helper}</small>
                    </label>
                  ))}
                  {getMcpSetupRequirementsByLocation(mcpDraftSetup, "header").map((item) => (
                    <label key={`header-${item.requirement.name}`} className="mcp-field mcp-secret-field">
                      <span>{item.requirement.label}</span>
                      <select value="" onChange={(event) => {
                        applySavedMcpKey(item.requirement, event.target.value);
                        event.currentTarget.value = "";
                      }}>
                        <option value="">{apiKeysAvailable ? "Use saved key..." : "No saved keys yet"}</option>
                        {getSavedKeyOptionsForMcpRequirement(apiKeyVault.keys, item.requirement, mcpDraftSetup.preset).map((key) => (
                          <option key={key.id} value={key.id}>{formatSavedApiKeyOption(key)}</option>
                        ))}
                      </select>
                      <input
                        type="password"
                        value={getMcpKeyValueDraftValue(mcpDraft.headersText, item.requirement.name)}
                        placeholder={getMcpSecretPlaceholder(item, mcpDraftSetup)}
                        onChange={(event) => updateMcpDraftHeaderSecret(item.requirement.name, event.target.value)}
                      />
                      <small>{item.requirement.helper}</small>
                    </label>
                  ))}
                  <label className="mcp-field mcp-field-wide">
                    <span>Secret query params</span>
                    <textarea value={mcpDraft.queryText} placeholder={"browserbaseApiKey=secret"} rows={2} onChange={(event) => setMcpDraft((draft) => ({ ...draft, queryText: event.target.value }))} />
                  </label>
                  <label className="mcp-field mcp-field-wide">
                    <span>Custom secret headers</span>
                    <textarea value={mcpDraft.headersText} placeholder={"HEADER_NAME=secret\nCONTEXT7_API_KEY=optional"} rows={3} onChange={(event) => setMcpDraft((draft) => ({ ...draft, headersText: event.target.value }))} />
                  </label>
                </>
              ) : (
                <>
                  <label className="mcp-field">
                    <span>Command</span>
                    <input value={mcpDraft.command} placeholder="node" onChange={(event) => setMcpDraft((draft) => ({ ...draft, command: event.target.value }))} />
                  </label>
                  <label className="mcp-field mcp-field-wide">
                    <span>Arguments</span>
                    <textarea value={mcpDraft.argsText} placeholder={"server.js\n--flag=value"} rows={3} onChange={(event) => setMcpDraft((draft) => ({ ...draft, argsText: event.target.value }))} />
                  </label>
                  <label className="mcp-field">
                    <span>Working directory</span>
                    <input value={mcpDraft.workingDirectory} placeholder="Optional folder path" onChange={(event) => setMcpDraft((draft) => ({ ...draft, workingDirectory: event.target.value }))} />
                  </label>
                  {getMcpSetupRequirementsByLocation(mcpDraftSetup, "environment").map((item) => (
                    <label key={`environment-${item.requirement.name}`} className="mcp-field mcp-secret-field">
                      <span>{item.requirement.label}</span>
                      <select value="" onChange={(event) => {
                        applySavedMcpKey(item.requirement, event.target.value);
                        event.currentTarget.value = "";
                      }}>
                        <option value="">{apiKeysAvailable ? "Use saved key..." : "No saved keys yet"}</option>
                        {getSavedKeyOptionsForMcpRequirement(apiKeyVault.keys, item.requirement, mcpDraftSetup.preset).map((key) => (
                          <option key={key.id} value={key.id}>{formatSavedApiKeyOption(key)}</option>
                        ))}
                      </select>
                      <input
                        type="password"
                        value={getMcpKeyValueDraftValue(mcpDraft.environmentText, item.requirement.name)}
                        placeholder={getMcpSecretPlaceholder(item, mcpDraftSetup)}
                        onChange={(event) => updateMcpDraftEnvironmentSecret(item.requirement.name, event.target.value)}
                      />
                      <small>{item.requirement.helper}</small>
                    </label>
                  ))}
                  <label className="mcp-field mcp-field-wide">
                    <span>Environment</span>
                    <textarea value={mcpDraft.environmentText} placeholder={"API_KEY=secret\nMODEL=local"} rows={3} onChange={(event) => setMcpDraft((draft) => ({ ...draft, environmentText: event.target.value }))} />
                  </label>
                </>
              )}
              <label className="mcp-toggle">
                <input type="checkbox" checked={mcpDraft.enabled} onChange={(event) => setMcpDraft((draft) => ({ ...draft, enabled: event.target.checked }))} />
                <span>Enable this server for chat tools</span>
              </label>
            </div>

            <div className="mcp-form-actions">
              <button type="button" disabled={mcpBusy || !mcpAvailable} onClick={() => void testMcpDraftConnection()}>
                <RefreshCw size={15} aria-hidden="true" />
                Test
              </button>
              <button className="mcp-form-primary" type="button" disabled={mcpBusy || !mcpAvailable} onClick={() => void saveAndTestMcpServer()}>
                <CheckCircle2 size={15} aria-hidden="true" />
                {mcpActionState === "save" ? "Saving" : mcpActionState === "test" ? "Testing" : "Save and test"}
              </button>
            </div>
          </section>

          {mcpProgressEvents.length > 0 ? (
            <div className="mcp-progress-panel" aria-live="polite" aria-label="MCP startup progress">
              <div className="mcp-progress-heading">
                <RefreshCw size={14} aria-hidden="true" />
                <span>{mcpActionState === "test" || mcpActionState === "save" ? "Starting MCP" : "Last MCP startup"}</span>
              </div>
              <div className="mcp-progress-list">
                {mcpProgressEvents.map((event, index) => (
                  <span key={`${event.kind}-${index}`} data-kind={event.kind}>
                    <strong>{formatMcpProgressKind(event.kind)}</strong>
                    <small>{event.message}</small>
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {mcpStatus ? (
            <div className="gmail-connect-status" data-kind={mcpStatus.kind}>
              {mcpStatus.text}
            </div>
          ) : null}

          <div className="gmail-connect-quick-notes" aria-label="MCP connection behavior">
            <span>
              <KeyRound size={15} aria-hidden="true" />
              HTTP bearer tokens, custom header values, and stdio environment values are stored in the desktop secure store.
            </span>
            <span>
              <ShieldCheck size={15} aria-hidden="true" />
              Chat calls use mcp_list_servers, mcp_list_tools, and approval-gated mcp_call_tool.
            </span>
          </div>
        </div>
        </DialogShell>
      ) : null}
    </section>
  );
}

function WebAppLogo({ className, fallback, src }: { className: string; fallback: ReactNode; src: string }) {
  const [failed, setFailed] = useState(false);

  return (
    <span className={`apps-plugin-logo ${className}`}>
      {failed ? fallback : <img src={src} alt="" aria-hidden="true" decoding="async" draggable={false} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />}
    </span>
  );
}

function formatConnectedGmailStatus(connection: GmailConnectionState) {
  const accounts = normalizeGmailAccountRows(connection);
  const maxAccounts = connection.maxAccounts || GMAIL_ACCOUNT_LIMIT;
  const activeEmail = connection.activeAccountEmail ?? accounts.find((account) => account.active)?.email ?? connection.user?.email;

  if (accounts.length > 0) {
    return `Gmail connected: ${accounts.length}/${maxAccounts} accounts${activeEmail ? `, active ${activeEmail}` : ""}.`;
  }

  return `Gmail connected as ${connection.user?.email ?? "your account"}.`;
}

function normalizeGmailAccountRows(connection: GmailConnectionState): GmailAccountState[] {
  if (connection.accounts?.length) {
    return connection.accounts;
  }

  if (connection.connected && connection.user?.email) {
    return [
      {
        active: true,
        connectedAt: connection.connectedAt,
        email: connection.user.email,
        expiresAt: connection.expiresAt,
        scopes: connection.scopes,
        user: connection.user,
      },
    ];
  }

  return [];
}

function formatGmailConnectionError(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "Could not connect Gmail.";
  const normalized = message.toLowerCase();

  if (normalized.includes("timed out") || normalized.includes("access_denied") || normalized.includes("did not authorize")) {
    return "Gmail plugin is installed locally, but Google did not approve this account connection. If Google says the app is in testing or only developer-approved testers can access it, add this Google account under Google Auth Platform > Audience > Test users, then try Connect Google again.";
  }

  if (normalized.includes("client_secret is missing") || normalized.includes("oauth client secret is missing")) {
    return "Gmail plugin is installed locally, but Google OAuth is missing the matching Client secret. Add it in Settings > Google, then try Connect Google again.";
  }

  return message;
}

function formatConnectedCalendarStatus(connection: CalendarConnectionState) {
  const accounts = normalizeCalendarAccountRows(connection);
  const maxAccounts = connection.maxAccounts || GOOGLE_CALENDAR_ACCOUNT_LIMIT;
  const activeEmail = connection.activeAccountEmail ?? accounts.find((account) => account.active)?.email ?? connection.user?.email;

  if (accounts.length > 0) {
    return `Google Calendar connected: ${accounts.length}/${maxAccounts} accounts${activeEmail ? `, active ${activeEmail}` : ""}.`;
  }

  return `Google Calendar connected as ${connection.user?.email ?? "your account"}.`;
}

function formatConnectedGithubStatus(connection: GithubConnectionState, repositories: GithubRepository[]) {
  const login = connection.user?.login ?? "your GitHub account";
  const repositorySummary = repositories.length > 0
    ? `${repositories.length} repository preview${repositories.length === 1 ? "" : "s"} loaded`
    : "no repository preview loaded";

  return `GitHub connected as ${login}; ${repositorySummary}.`;
}

function getMcpPresetInitials(preset: McpProviderPreset) {
  return getPluginInitials(preset.name);
}

function getMcpPresetSearchFields(preset: McpProviderPreset) {
  return [
    preset.id,
    preset.name,
    preset.publisher,
    preset.description,
    preset.note,
    preset.command,
    preset.endpoint,
    ...(preset.args ?? []),
    ...(preset.setupSteps ?? []),
    ...(preset.requiredSetup ?? []).flatMap((alternative) => [
      alternative.id,
      alternative.label,
      ...alternative.requirements.flatMap((requirement) => [requirement.label, requirement.name, requirement.helper, ...(requirement.keyNames ?? [])]),
    ]),
    ...(preset.optionalSetup ?? []).flatMap((requirement) => [requirement.label, requirement.name, requirement.helper, ...(requirement.keyNames ?? [])]),
    ...preset.tags,
  ].filter(Boolean);
}

function getPluginInitials(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function getMarketplacePluginRuntimeState(
  plugin: OpenAiCodexPluginListing,
  mcpServers: McpServerState[],
  skillRegistry: SkillRegistryState,
): MarketplacePluginRuntimeState {
  const importedSkills = getImportedSkillsForPlugin(plugin, skillRegistry);
  const skillCount = importedSkills.length;
  const enabledSkillCount = importedSkills.filter((skill) => skill.enabled).length;
  const mcpPreset = plugin.mcpPresetId
    ? MCP_FEATURED_PRESETS.find((preset) => preset.id === plugin.mcpPresetId)
    : undefined;
  const mcpServer = mcpPreset ? findMcpServerForPreset(mcpServers, mcpPreset) : undefined;
  const authTag = plugin.authPolicy === "ON_INSTALL" ? "Auth required" : "Auth on use";

  if (plugin.installRoute === "mcp-preset") {
    if (mcpServer) {
      const toolCount = mcpServer.tools?.length ?? 0;
      const connected = Boolean(mcpServer.enabled && !mcpServer.lastError && (toolCount > 0 || mcpServer.lastConnectedAt));
      const tags = [
        connected ? `${toolCount} tool${toolCount === 1 ? "" : "s"}` : mcpServer.lastError ? "Needs fix" : "Needs test",
        mcpServer.enabled ? "Enabled" : "Disabled",
        mcpServer.hasAuthorizationToken || (mcpServer.environment ?? []).some((item) => item.hasValue) || (mcpServer.headers ?? []).some((item) => item.hasValue) || (mcpServer.queryParams ?? []).some((item) => item.hasValue) ? "Auth saved" : authTag,
        skillCount > 0 ? `${skillCount} skill${skillCount === 1 ? "" : "s"} installed` : plugin.hasBundledSkills ? "Skills available" : undefined,
      ].filter(Boolean) as string[];

      return {
        description: connected
          ? "Installed MCP server with discovered tools available to chat when MCP tools are enabled."
          : "Installed as an MCP server. Test or refresh it before relying on chat tool calls.",
        mcpServer,
        primaryActionLabel: "Manage",
        primaryDisabled: false,
        routeLabel: connected ? "Connected" : "Installed",
        secondaryActionLabel: skillCount > 0 ? "Skills installed" : "Install skills",
        skillCount,
        statusKind: connected ? "connected" : "installed",
        statusLabel: connected ? "Connected" : "Installed",
        tags,
      };
    }

    return {
      description: "Maps to a curated MCP setup that Gilbert can save, test, and expose to chat.",
      primaryActionLabel: "Configure MCP",
      primaryDisabled: false,
      routeLabel: "MCP",
      secondaryActionLabel: skillCount > 0 ? "Skills installed" : "Install skills",
      skillCount,
      statusKind: "ready",
      statusLabel: "Ready",
      tags: [
        "MCP preset",
        "Needs install",
        authTag,
        skillCount > 0 ? `${skillCount} skill${skillCount === 1 ? "" : "s"} installed` : plugin.hasBundledSkills ? "Skills available" : undefined,
      ].filter(Boolean) as string[],
    };
  }

  if (plugin.installRoute === "skill-import") {
    if (skillCount > 0) {
      return {
        description: "Installed local skill workflows are enabled for prompts and skill mentions.",
        primaryActionLabel: "View skills",
        primaryDisabled: false,
        routeLabel: "Installed",
        skillCount,
        statusKind: enabledSkillCount > 0 ? "connected" : "installed",
        statusLabel: "Installed",
        tags: [
          `${skillCount} skill${skillCount === 1 ? "" : "s"} installed`,
          enabledSkillCount > 0 ? `${enabledSkillCount} enabled` : "Disabled",
          authTag,
        ],
      };
    }

    return {
      description: "Imports bundled skills into Gilbert's local skill registry.",
      primaryActionLabel: "Install skills",
      primaryDisabled: false,
      routeLabel: "Skills",
      skillCount,
      statusKind: "ready",
      statusLabel: "Ready",
      tags: ["Bundled skills", authTag],
    };
  }

  if (plugin.installRoute === "native") {
    return {
      description: "Built into Gilbert with app-owned auth, local state, and approval-gated tools.",
      primaryActionLabel: "Install",
      primaryDisabled: false,
      routeLabel: "Native",
      skillCount,
      statusKind: "ready",
      statusLabel: "Ready",
      tags: ["Native", authTag],
    };
  }

  return {
    description: "Searches the public MCP Registry for a runnable server or hosted replacement.",
    primaryActionLabel: "Find MCP",
    primaryDisabled: false,
    routeLabel: "Registry",
    skillCount,
    statusKind: "ready",
    statusLabel: "Ready",
    tags: ["Registry search", "Connector metadata", authTag],
  };
}

function getImportedSkillsForPlugin(plugin: OpenAiCodexPluginListing, skillRegistry: SkillRegistryState) {
  const idPrefix = `${plugin.id}-`;
  const displayNamePrefix = `${plugin.displayName.toLowerCase()}:`;

  return skillRegistry.skills.filter((skill) =>
    skill.installed &&
    skill.source === "imported" &&
    (
      skill.id.startsWith(idPrefix) ||
      skill.tags.includes(plugin.id) ||
      skill.name.toLowerCase().startsWith(displayNamePrefix)
    ),
  );
}

function findMcpServerForPreset(servers: McpServerState[], preset: McpProviderPreset) {
  return servers.find((server) => serverMatchesMcpPreset(server, preset));
}

function serverMatchesMcpPreset(server: McpServerState, preset: McpProviderPreset) {
  if (server.transport !== preset.transport) {
    return false;
  }

  if (preset.transport === "http") {
    return normalizeMcpEndpoint(server.endpoint) === normalizeMcpEndpoint(preset.endpoint);
  }

  return normalizeMcpCommand(server.command) === normalizeMcpCommand(preset.command) &&
    normalizeMcpArgs(server.args).join("\n") === normalizeMcpArgs(preset.args).join("\n");
}

function normalizeMcpEndpoint(value?: string) {
  return (value ?? "").trim().replace(/\/+$/g, "").toLowerCase();
}

function normalizeMcpCommand(value?: string) {
  return (value ?? "").trim().replace(/\.cmd$/i, "").toLowerCase();
}

function normalizeMcpArgs(value?: string[]) {
  return (value ?? []).map((item) => item.trim()).filter(Boolean);
}

function formatMcpProgressKind(kind: string) {
  switch (kind) {
    case "download":
      return "Download";
    case "error":
      return "Error";
    case "finished":
      return "Ready";
    case "output":
      return "Output";
    case "started":
      return "Start";
    default:
      return "Step";
  }
}

function createDraftFromRegistryInstall(server: McpRegistryServerSummary, install: McpRegistryInstallHint): McpServerDraft {
  const name = formatMcpRegistryServerName(server);

  if (install.transport === "stdio") {
    return {
      ...EMPTY_MCP_DRAFT,
      argsText: install.args.join("\n"),
      command: install.command ?? "",
      name,
      transport: "stdio",
    };
  }

  return {
    ...EMPTY_MCP_DRAFT,
    endpoint: install.endpoint ?? "",
    name,
    transport: "http",
  };
}

function formatMcpRegistryServerName(server: McpRegistryServerSummary) {
  if (server.title?.trim()) {
    return server.title.trim();
  }

  const rawName = server.name.split("/").pop() ?? server.name;

  return rawName
    .replace(/^mcp[-_]/i, "")
    .replace(/[-_]?mcp[-_]?server$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim() || server.name;
}

function formatMcpRegistryServerMeta(server: McpRegistryServerSummary) {
  const install = server.install;
  const installLabel = install
    ? install.transport === "stdio"
      ? [install.command, ...(install.args ?? [])].filter(Boolean).join(" ")
      : install.endpoint
    : "manual setup";
  const parts = [
    server.official ? "Official registry" : "Registry",
    server.status,
    server.version ? `v${server.version}` : undefined,
    installLabel,
  ].filter(Boolean);

  return parts.join(" | ");
}

function normalizeCalendarAccountRows(connection: CalendarConnectionState): CalendarAccountState[] {
  if (connection.accounts?.length) {
    return connection.accounts;
  }

  if (connection.connected && connection.user?.email) {
    return [
      {
        active: true,
        connectedAt: connection.connectedAt,
        email: connection.user.email,
        expiresAt: connection.expiresAt,
        scopes: connection.scopes,
        user: connection.user,
      },
    ];
  }

  return [];
}

function formatCalendarConnectionError(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "Could not connect Google Calendar.";
  const normalized = message.toLowerCase();

  if (normalized.includes("timed out") || normalized.includes("access_denied") || normalized.includes("did not authorize")) {
    return "Google Calendar plugin is installed locally, but Google did not approve this account connection. If Google says the app is in testing or only developer-approved testers can access it, add this Google account under Google Auth Platform > Audience, then try Connect Google again.";
  }

  if (normalized.includes("client_secret is missing") || normalized.includes("oauth client secret is missing")) {
    return "Google Calendar plugin is installed locally, but Google OAuth is missing the matching Client secret. Add it in Settings > Google, then try Connect Google again.";
  }

  return message;
}

export function createMcpSaveRequest(draft: McpServerDraft, servers: McpServerState[] = EMPTY_MCP_SERVERS): { ok: true; value: McpSaveServerRequest } | { error: string; ok: false } {
  const base = createMcpTestRequest(draft, servers);

  if (!base.ok) {
    return base;
  }

  const name = draft.name.trim();

  if (!name) {
    return { error: "Add a server name before saving.", ok: false };
  }

  return {
    ok: true,
    value: {
      ...base.value,
      enabled: draft.enabled,
      id: draft.id || undefined,
      name,
    },
  };
}

export function createMcpTestRequest(draft: McpServerDraft, servers: McpServerState[] = EMPTY_MCP_SERVERS): { ok: true; value: McpTestServerRequest } | { error: string; ok: false } {
  const setup = getMcpDraftSetupSummary(draft, servers);

  if (setup.issues.length > 0) {
    return { error: setup.issues.join(" "), ok: false };
  }

  if (draft.transport === "stdio") {
    const command = draft.command.trim();

    if (!command) {
      return { error: "Add a command before testing this stdio MCP server.", ok: false };
    }

    const parsedEnvironment = parseMcpEnvironmentText(draft.environmentText);

    if (!parsedEnvironment.ok) {
      return parsedEnvironment;
    }

    return {
      ok: true,
      value: {
        args: parseMcpLines(draft.argsText),
        command,
        environment: parsedEnvironment.value,
        transport: "stdio",
        workingDirectory: draft.workingDirectory.trim() || undefined,
      },
    };
  }

  const endpoint = draft.endpoint.trim();

  if (!endpoint) {
    return { error: "Add an MCP endpoint before testing this HTTP server.", ok: false };
  }

  const parsedHeaders = parseMcpHeaderText(draft.headersText);

  if (!parsedHeaders.ok) {
    return parsedHeaders;
  }

  const parsedQueryParams = parseMcpQueryText(draft.queryText);

  if (!parsedQueryParams.ok) {
    return parsedQueryParams;
  }

  return {
    ok: true,
    value: {
      authorizationToken: draft.authorizationToken.trim() || undefined,
      endpoint,
      headers: parsedHeaders.value,
      queryParams: parsedQueryParams.value,
      transport: "http",
    },
  };
}

function parseMcpLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function parseMcpEnvironmentText(value: string): { ok: true; value: Array<{ name: string; value: string }> } | { error: string; ok: false } {
  const environment: Array<{ name: string; value: string }> = [];

  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    const separator = line.indexOf("=");

    if (separator < 1) {
      return { error: "Environment lines must use NAME=value format.", ok: false };
    }

    const name = line.slice(0, separator).trim();

    if (!name || name.includes("=")) {
      return { error: "Environment variable names cannot be empty or contain equals signs.", ok: false };
    }

    environment.push({ name, value: line.slice(separator + 1).trim() });
  }

  return { ok: true, value: environment };
}

export function parseMcpHeaderText(value: string): { ok: true; value: McpHttpHeader[] } | { error: string; ok: false } {
  const headers: McpHttpHeader[] = [];
  const seen = new Set<string>();

  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    const separator = line.indexOf("=");

    if (separator < 1) {
      return { error: "Custom header lines must use HEADER_NAME=value format.", ok: false };
    }

    const name = line.slice(0, separator).trim();

    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)) {
      return { error: `Custom header \`${name || "blank"}\` is not a valid HTTP header name.`, ok: false };
    }

    const normalizedName = name.toLowerCase();

    if (["accept", "authorization", "content-type", "mcp-protocol-version", "mcp-session-id", "user-agent"].includes(normalizedName)) {
      return { error: `Header \`${name}\` is managed by Gilbert. Use the bearer token field for Authorization.`, ok: false };
    }

    if (!seen.has(normalizedName)) {
      seen.add(normalizedName);
      headers.push({ name, value: line.slice(separator + 1).trim() });
    }
  }

  return { ok: true, value: headers };
}

export function parseMcpQueryText(value: string): { ok: true; value: McpHttpQueryParam[] } | { error: string; ok: false } {
  const queryParams: McpHttpQueryParam[] = [];
  const seen = new Set<string>();

  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    const separator = line.indexOf("=");

    if (separator < 1) {
      return { error: "Secret query param lines must use NAME=value format.", ok: false };
    }

    const name = line.slice(0, separator).trim();

    if (!/^[A-Za-z0-9_.~-]+$/.test(name)) {
      return { error: `Query parameter \`${name || "blank"}\` can only contain letters, numbers, dot, underscore, tilde, or dash.`, ok: false };
    }

    const normalizedName = name.toLowerCase();

    if (!seen.has(normalizedName)) {
      seen.add(normalizedName);
      queryParams.push({ name, value: line.slice(separator + 1).trim() });
    }
  }

  return { ok: true, value: queryParams };
}

export function getMcpDraftSetupSummary(draft: McpServerDraft, servers: McpServerState[] = EMPTY_MCP_SERVERS): McpDraftSetupSummary {
  const existingServer = draft.id ? servers.find((server) => server.id === draft.id) : undefined;
  const preset = getMcpPresetForDraft(draft, existingServer);
  const requiredAlternatives = (preset?.requiredSetup ?? []).map((alternative) => {
    const requirements = alternative.requirements.map((requirement) => ({
      requirement,
      status: getMcpRequirementStatus(requirement, draft, existingServer),
    }));

    return {
      id: alternative.id,
      label: alternative.label,
      ready: requirements.every((item) => item.status === "ready"),
      requirements,
    };
  });
  const optionalRequirements = (preset?.optionalSetup ?? []).map((requirement) => {
    const status: McpSetupRequirementStatus = getMcpRequirementStatus(requirement, draft, existingServer) === "ready" ? "ready" : "optional";

    return { requirement, status };
  });
  const issues: string[] = [];

  if (preset && requiredAlternatives.length > 0 && !requiredAlternatives.some((alternative) => alternative.ready)) {
    const choices = requiredAlternatives
      .map((alternative) => alternative.requirements.map((item) => item.requirement.name).join(" + "))
      .join(" or ");

    issues.push(`${preset.name} needs ${choices} before testing or saving.`);
  }

  return {
    existingServer,
    issues,
    optionalRequirements,
    preset,
    requiredAlternatives,
  };
}

function getMcpPresetForDraft(draft: McpServerDraft, existingServer?: McpServerState) {
  if (existingServer) {
    const existingPreset = MCP_FEATURED_PRESETS.find((preset) => serverMatchesMcpPreset(existingServer, preset));

    if (existingPreset) {
      return existingPreset;
    }
  }

  return MCP_FEATURED_PRESETS.find((preset) => draftMatchesMcpPreset(draft, preset));
}

export function getMcpFeaturedPresetIds() {
  return MCP_FEATURED_PRESETS.map((preset) => preset.id);
}

export function getMcpFeaturedPresetSetupRequirementNames() {
  const names = new Set<string>();

  for (const preset of MCP_FEATURED_PRESETS) {
    for (const alternative of preset.requiredSetup ?? []) {
      for (const requirement of alternative.requirements) {
        const keyNames = requirement.keyNames?.length ? requirement.keyNames : [requirement.name];

        for (const keyName of keyNames) {
          names.add(keyName);
        }
      }
    }

    for (const requirement of preset.optionalSetup ?? []) {
      const keyNames = requirement.keyNames?.length ? requirement.keyNames : [requirement.name];

      for (const keyName of keyNames) {
        names.add(keyName);
      }
    }
  }

  return [...names].sort((left, right) => left.localeCompare(right));
}

export function getMcpFeaturedPresetIdsForSearch(query: string) {
  const normalizedQuery = query.trim().toLowerCase();

  return MCP_FEATURED_PRESETS
    .filter((preset) => matchesAppsSearch(normalizedQuery, getMcpPresetSearchFields(preset)))
    .map((preset) => preset.id);
}

function draftMatchesMcpPreset(draft: McpServerDraft, preset: McpProviderPreset) {
  if (draft.transport !== preset.transport) {
    return false;
  }

  if (preset.transport === "http") {
    return normalizeMcpEndpoint(draft.endpoint) === normalizeMcpEndpoint(preset.endpoint);
  }

  return normalizeMcpCommand(draft.command) === normalizeMcpCommand(preset.command) &&
    parseMcpLines(draft.argsText).join("\n") === normalizeMcpArgs(preset.args).join("\n");
}

function getMcpRequirementStatus(requirement: McpSetupRequirement, draft: McpServerDraft, existingServer?: McpServerState): McpSetupRequirementStatus {
  if (requirement.location === "bearer") {
    return draft.authorizationToken.trim() || existingServer?.hasAuthorizationToken ? "ready" : "missing";
  }

  if (requirement.location === "header") {
    const draftValue = getMcpKeyValueDraftValue(draft.headersText, requirement.name);
    const saved = existingServer?.headers?.some((item) => item.name.toLowerCase() === requirement.name.toLowerCase() && item.hasValue);

    return draftValue.trim() || saved ? "ready" : "missing";
  }

  if (requirement.location === "query") {
    const draftValue = getMcpKeyValueDraftValue(draft.queryText, requirement.name);
    const saved = existingServer?.queryParams?.some((item) => item.name.toLowerCase() === requirement.name.toLowerCase() && item.hasValue);

    return draftValue.trim() || saved ? "ready" : "missing";
  }

  const draftValue = getMcpKeyValueDraftValue(draft.environmentText, requirement.name);
  const saved = existingServer?.environment?.some((item) => item.name.toLowerCase() === requirement.name.toLowerCase() && item.hasValue);

  return draftValue.trim() || saved ? "ready" : "missing";
}

function getMcpSetupRequirementsByLocation(summary: McpDraftSetupSummary, location: McpSetupLocation) {
  const items = new Map<string, McpSetupRequirementView>();

  for (const alternative of summary.requiredAlternatives) {
    for (const item of alternative.requirements) {
      if (item.requirement.location === location) {
        items.set(`${item.requirement.location}:${item.requirement.name.toLowerCase()}`, item);
      }
    }
  }

  for (const item of summary.optionalRequirements) {
    if (item.requirement.location === location) {
      items.set(`${item.requirement.location}:${item.requirement.name.toLowerCase()}`, item);
    }
  }

  return [...items.values()];
}

function getMcpBearerKeySelectorRequirements(summary: McpDraftSetupSummary) {
  const configuredRequirements = getMcpSetupRequirementsByLocation(summary, "bearer");

  if (configuredRequirements.length > 0) {
    return configuredRequirements;
  }

  return [{
    requirement: HTTP_BEARER_TOKEN_REQUIREMENT,
    status: "optional" as McpSetupRequirementStatus,
  }];
}

export function getSavedKeyOptionsForMcpRequirement(keys: ApiKeyRecord[], requirement: McpSetupRequirement, preset?: McpProviderPreset) {
  const normalizedRequirementNames = new Set([requirement.name, ...(requirement.keyNames ?? [])].map(normalizeApiKeySearchToken).filter(Boolean));
  const normalizedRequirementName = normalizeApiKeySearchToken(requirement.name);
  const normalizedRequirementLabel = normalizeApiKeySearchToken(requirement.label);
  const presetHints = getMcpPresetKeyServiceHints(preset);
  const usableKeys = keys.filter((key) => key.kind !== "provider");
  const rankedKeys = usableKeys
    .map((key) => {
      const service = normalizeApiKeySearchToken(key.service);
      const keyName = normalizeApiKeySearchToken(key.keyName);
      const label = normalizeApiKeySearchToken(key.label);
      let score = 0;

      if (normalizedRequirementNames.has(keyName)) {
        score += 60;
      }

      if (normalizedRequirementName === "authorization" && ["authorization", "bearer-token", "access-token", "api-key"].includes(keyName)) {
        score += 34;
      }

      if (presetHints.has(service)) {
        score += 30;
      }

      if (label.includes(normalizedRequirementName) || label.includes(normalizedRequirementLabel)) {
        score += 12;
      }

      if (requirement.location === "bearer" && ["app", "mcp", "service", "skill"].includes(key.kind)) {
        score += 5;
      } else if (key.kind === "app" || key.kind === "mcp" || key.kind === "service" || key.kind === "skill") {
        score += 5;
      }

      return { key, score };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.key.label.localeCompare(right.key.label));

  if (rankedKeys.length > 0) {
    return rankedKeys.map((item) => item.key);
  }

  return [...usableKeys].sort((left, right) => left.label.localeCompare(right.label));
}

function getMcpPresetKeyServiceHints(preset?: McpProviderPreset) {
  const hints = new Set<string>();

  if (!preset) {
    return hints;
  }

  for (const value of [preset.id, preset.name, preset.publisher]) {
    const normalized = normalizeApiKeySearchToken(value);

    if (normalized) {
      hints.add(normalized);
    }
  }

  const aliases: Record<string, string[]> = {
    "aws": ["amazon-web-services"],
    "cloudflare-api": ["cloudflare"],
    "cloudflare-browser": ["cloudflare"],
    "cloudflare-docs": ["cloudflare"],
    "figma-desktop": ["figma"],
    "figma-remote": ["figma"],
    "github-mcp": ["github"],
  };

  for (const alias of aliases[preset.id] ?? []) {
    hints.add(normalizeApiKeySearchToken(alias));
  }

  return hints;
}

function normalizeApiKeySearchToken(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function formatSavedApiKeyOption(key: ApiKeyRecord) {
  return `${key.label} (${key.service}/${key.keyName})`;
}

function formatMcpSetupSummaryLabel(summary: McpDraftSetupSummary) {
  if (!summary.preset) {
    return "Custom MCP server. Add the required endpoint, command, tokens, headers, or env values for this provider.";
  }

  if (summary.issues.length > 0) {
    return summary.issues[0];
  }

  if (summary.requiredAlternatives.length > 0) {
    return "Required setup complete.";
  }

  if (summary.preset.args?.some((arg) => arg.includes("mcp-remote"))) {
    return "OAuth is handled by mcp-remote during test or tool refresh.";
  }

  return "No required API key before testing.";
}

function getMcpBearerPlaceholder(summary: McpDraftSetupSummary) {
  const bearerRequired = summary.requiredAlternatives.some((alternative) =>
    alternative.requirements.some((item) => item.requirement.location === "bearer"),
  );

  if (summary.existingServer?.hasAuthorizationToken) {
    return "Saved token; leave blank to keep";
  }

  return bearerRequired ? "Required before test" : "Optional";
}

function getMcpSecretPlaceholder(item: McpSetupRequirementView, summary: McpDraftSetupSummary) {
  if (item.status === "ready" && summary.existingServer) {
    return "Saved secret; leave blank to keep";
  }

  return item.requirement.placeholder ?? "Paste secret";
}

export function getMcpKeyValueDraftValue(text: string, name: string) {
  const normalizedName = name.trim().toLowerCase();

  for (const rawLine of text.split(/\r?\n/)) {
    const separator = rawLine.indexOf("=");

    if (separator < 1) {
      continue;
    }

    if (rawLine.slice(0, separator).trim().toLowerCase() === normalizedName) {
      return rawLine.slice(separator + 1).trim();
    }
  }

  return "";
}

export function upsertMcpKeyValueLine(text: string, name: string, value: string) {
  const normalizedName = name.trim().toLowerCase();
  const lines = text.split(/\r?\n/);
  let updated = false;
  const nextLines = lines.map((line) => {
    const separator = line.indexOf("=");

    if (separator < 1 || line.slice(0, separator).trim().toLowerCase() !== normalizedName) {
      return line;
    }

    updated = true;
    return `${name}=${value}`;
  });

  if (!updated) {
    nextLines.push(`${name}=${value}`);
  }

  return nextLines.filter((line, index) => line.trim() || index < nextLines.length - 1).join("\n");
}

function formatMcpEnvironmentDraft(server: McpServerState) {
  return (server.environment ?? []).map((item) => `${item.name}=`).join("\n");
}

function formatMcpHeaderDraft(server: McpServerState) {
  return (server.headers ?? []).map((item) => `${item.name}=`).join("\n");
}

function formatMcpQueryDraft(server: McpServerState) {
  return (server.queryParams ?? []).map((item) => `${item.name}=`).join("\n");
}

function formatMcpConnectionStatus(connection: McpConnectionState): AppsStatusMessage | null {
  const servers = connection.servers ?? [];
  const enabledCount = servers.filter((server) => server.enabled).length;

  if (enabledCount > 0) {
    const toolCount = servers.reduce((total, server) => total + (server.tools?.length ?? 0), 0);
    return { kind: "success", text: `MCP ready: ${enabledCount}/${connection.maxServers || MCP_SERVER_LIMIT} enabled servers with ${toolCount} cached tools.` };
  }

  if (servers.length > 0) {
    return { kind: "warning", text: "MCP servers are configured, but none are enabled for chat tools." };
  }

  return null;
}

function formatMcpServerTarget(server: McpServerState) {
  if (server.transport === "stdio") {
    const command = [server.command, ...(server.args ?? [])].filter(Boolean).join(" ");

    return command ? `stdio: ${command}` : "stdio server";
  }

  return server.endpoint ?? "HTTP endpoint";
}

function formatMcpServerDetail(server: McpServerState) {
  const transport = server.transport === "stdio" ? "Stdio" : "HTTP";
  const parts = [
    transport,
    server.enabled ? "Enabled" : "Disabled",
    `${server.tools?.length ?? 0} tool${(server.tools?.length ?? 0) === 1 ? "" : "s"}`,
    server.transport === "stdio"
      ? `${server.environment?.filter((item) => item.hasValue).length ?? 0} env secret${(server.environment?.filter((item) => item.hasValue).length ?? 0) === 1 ? "" : "s"}`
      : [
          server.hasAuthorizationToken ? "Bearer token saved" : "No bearer token",
          `${server.queryParams?.filter((item) => item.hasValue).length ?? 0} query secret${(server.queryParams?.filter((item) => item.hasValue).length ?? 0) === 1 ? "" : "s"}`,
          `${server.headers?.filter((item) => item.hasValue).length ?? 0} header secret${(server.headers?.filter((item) => item.hasValue).length ?? 0) === 1 ? "" : "s"}`,
        ].join(" / "),
    server.serverName ? `${server.serverName}${server.serverVersion ? ` ${server.serverVersion}` : ""}` : undefined,
    server.lastError ? `Last error: ${server.lastError}` : undefined,
  ].filter(Boolean);

  return parts.join(" | ");
}

function matchesAppsSearch(normalizedQuery: string, fields: Array<string | undefined>) {
  if (!normalizedQuery) {
    return true;
  }

  return fields
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(normalizedQuery);
}

function sectionMatches(activeSection: AppsCatalogSection, cardSection: Exclude<AppsCatalogSection, "all">) {
  return activeSection === "all" || activeSection === cardSection;
}

function getAppsSectionIcon(section: AppsCatalogSection) {
  if (section === "plugins") {
    return PlugZap;
  }

  if (section === "skills") {
    return Sparkles;
  }

  if (section === "mcp") {
    return Globe2;
  }

  return Puzzle;
}

function getAppsSectionMeta(section: AppsCatalogSection, metrics: { mcpEnabledCount: number; pluginCatalogCount: number }) {
  if (section === "plugins") {
    return String(metrics.pluginCatalogCount);
  }

  if (section === "skills") {
    return "Ready";
  }

  if (section === "mcp") {
    return metrics.mcpEnabledCount > 0 ? String(metrics.mcpEnabledCount) : "Ready";
  }

  return "5";
}
