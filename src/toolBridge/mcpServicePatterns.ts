const MCP_SERVICE_PATTERN_PARTS = [
  "airtable",
  "apify",
  "asana",
  "atlassian",
  "aws",
  "azure",
  "box",
  "brave\\s+search",
  "browserbase",
  "canva",
  "chrome\\s+devtools",
  "cloudflare",
  "context7",
  "coderabbit",
  "exa",
  "figma",
  "firebase",
  "firecrawl",
  "git(?:hub|lab)",
  "gmail",
  "go\\s*daddy",
  "google\\s+(?:calendar|drive|tasks?)",
  "heroku",
  "hugging\\s*face",
  "jetbrains",
  "jira",
  "kubernetes",
  "linear",
  "mongodb",
  "neon(?:\\s+postgres)?",
  "netlify",
  "notion",
  "outlook(?:\\s+(?:calendar|email))?",
  "playwright",
  "postgres(?:ql)?",
  "pulumi",
  "puppeteer",
  "redis",
  "render",
  "sentry",
  "semgrep",
  "sequential\\s+thinking",
  "serena",
  "sharepoint",
  "slack",
  "stripe",
  "supabase",
  "tavily",
  "teams",
  "twilio",
  "vercel",
  "zotero",
  "zoom",
] as const;

const CONNECTED_TOOL_GENERIC_PATTERN_PARTS = [
  "mcp\\s+server",
  "model\\s+context\\s+protocol",
  "connected\\s+apps?",
  "connectors?",
  "plugins?",
] as const;

const DEPLOYMENT_HOSTING_PATTERN_PARTS = [
  "cloudflare",
  "deploy(?:ed|ing|ment)?",
  "firebase\\s+hosting",
  "go\\s+live",
  "heroku",
  "hosting(?:\\s+(?:site|target))?",
  "make\\s+(?:it|the\\s+(?:app|site|website))\\s+live",
  "netlify",
  "publish(?:ed|ing)?",
  "pulumi",
  "push\\s+(?:it|the\\s+(?:app|site|website))\\s+live",
  "vercel",
] as const;

export const MCP_SERVICE_PATTERN_SOURCE = MCP_SERVICE_PATTERN_PARTS.join("|");
export const CONNECTED_TOOL_SERVICE_PATTERN_SOURCE = [...MCP_SERVICE_PATTERN_PARTS, ...CONNECTED_TOOL_GENERIC_PATTERN_PARTS].join("|");
export const DEPLOYMENT_HOSTING_PATTERN_SOURCE = DEPLOYMENT_HOSTING_PATTERN_PARTS.join("|");
export const DEPLOYMENT_TOOL_EVIDENCE_PATTERN_SOURCE = `${DEPLOYMENT_HOSTING_PATTERN_SOURCE}|firebase-tools`;

export const MCP_SERVICE_PROMPT_PATTERN = new RegExp(`\\b(?:${MCP_SERVICE_PATTERN_SOURCE})\\b`, "i");
export const CONNECTED_TOOL_SERVICE_PROMPT_PATTERN = new RegExp(`\\b(?:${CONNECTED_TOOL_SERVICE_PATTERN_SOURCE})\\b`, "i");
export const DEPLOYMENT_HOSTING_PROMPT_PATTERN = new RegExp(`\\b(?:${DEPLOYMENT_HOSTING_PATTERN_SOURCE})\\b`, "i");
export const DEPLOYMENT_TOOL_EVIDENCE_PATTERN = new RegExp(`\\b(?:${DEPLOYMENT_TOOL_EVIDENCE_PATTERN_SOURCE})\\b`, "i");
