import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const appUrl = process.env.GILBERT_CODEX_CAPTURE_URL ?? "http://localhost:1420";
const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const assetDir = path.join(repoRoot, "docs", "assets", "readme");
const now = Date.now();
const isoNow = new Date(now).toISOString();
const userId = "user-readme-demo";
const storageSuffix = `user.${userId}`;
const demoWorkspacePath =
  process.env.GILBERT_CODEX_DEMO_WORKSPACE ?? (process.platform === "win32" ? "C:\\Projects\\GilbertCodex" : "/home/demo/projects/GilbertCodex");
const demoWebSearchMaxResults = normalizeDemoWebSearchMaxResults(process.env.GILBERT_CODEX_DEMO_WEB_RESULTS);
const demoSubscriptionModels = [
  "cx/gpt-5.5",
  "cx/gpt-5.4",
  "cx/gpt-5.3-codex",
  "cx/gpt-5.3-codex-xhigh",
  "claude/sonnet-4.5",
  "gemini/gemini-3.1-pro-preview",
  "gh/gpt-5-mini",
  "gh/claude-haiku-4.5",
  "free-combo",
];

const browserCandidates = [
  process.env.CHROMIUM_EXECUTABLE_PATH,
  chromium.executablePath(),
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);

const executablePath = browserCandidates.find((candidate) => existsSync(candidate));

if (!executablePath) {
  throw new Error("Could not find a Chromium-based browser. Set CHROMIUM_EXECUTABLE_PATH before running this script.");
}

function storageKey(key) {
  return `${key}.${storageSuffix}`;
}

function createMessage(id, role, content, offsetMinutes, extras = {}) {
  return {
    id,
    role,
    content,
    createdAt: new Date(now - offsetMinutes * 60_000).toISOString(),
    ...extras,
  };
}

function createSeedState() {
  const workspace = {
    enabled: true,
    indexReason: "README capture demo",
    indexStatus: "idle",
    indexSummary: {
      builtAt: now - 32_000,
      entryCount: 426,
      roots: [demoWorkspacePath],
      scannedDirectories: 74,
      skippedEntries: 9,
      truncated: false,
    },
    indexUpdatedAt: isoNow,
    permissionMode: "gilbert-review",
    roots: [demoWorkspacePath],
    scope: "current-folder",
  };

  const activeChat = {
    id: "chat-readme-active",
    messages: [
      createMessage("msg-1", "user", "Audit the README and make the repo feel ready for outside contributors.", 18),
      createMessage(
        "msg-2",
        "assistant",
        "I checked the docs, release notes, and workspace structure. Next I would tighten the visual README section, keep release downloads focused on installers, and make the contribution path obvious.",
        17,
        {
          artifacts: [
            {
              detail: "Contributor-facing project overview",
              id: "artifact-readme",
              kind: "document",
              title: "README.md",
              url: "README.md",
            },
            {
              detail: "Release checklist for public alpha",
              id: "artifact-release",
              kind: "file",
              title: "docs/releases/v0.5.5.md",
              url: "docs/releases/v0.5.5.md",
            },
          ],
          sources: [
            {
              detail: "GitHub release management docs",
              id: "source-release-docs",
              title: "Managing releases in a repository",
              url: "https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository",
            },
            {
              detail: "GitHub Markdown image guidance",
              id: "source-markdown-docs",
              title: "Writing and formatting on GitHub",
              url: "https://docs.github.com/en/get-started/writing-on-github",
            },
          ],
          thinking: {
            effort: "high",
            startedAt: new Date(now - 16 * 60_000).toISOString(),
            completedAt: new Date(now - 15 * 60_000).toISOString(),
          },
          toolCalls: [],
          webSearch: {
            enabled: true,
            maxResults: demoWebSearchMaxResults,
            provider: "duckduckgo",
            query: "GitHub README video autoplay best practice",
            resultCount: 4,
            searchedAt: new Date(now - 17 * 60_000).toISOString(),
            status: "complete",
          },
        },
      ),
      createMessage("msg-3", "user", "Now show live progress and keep the release checklist visible.", 3),
      createMessage(
        "msg-4",
        "assistant",
        "Working through the local project and updating the contributor docs now.",
        2,
        {
          isStreaming: true,
          progress: [
            { id: "progress-plan", label: "Plan README media section", status: "complete" },
            { id: "progress-capture", label: "Capture app screenshots", status: "active", detail: "Overview, release notes, and settings" },
            { id: "progress-write", label: "Write README copy", status: "pending" },
          ],
          reasoning:
            "Use README-safe media: an auto-playing GIF for motion, useful still screenshots for scanning, and release assets only for installable builds. Keep the visual section close to the top so contributors can understand the project before setup details.",
          thinking: {
            effort: "xhigh",
            startedAt: new Date(now - 95_000).toISOString(),
          },
          toolCalls: [],
          webSearch: {
            enabled: true,
            maxResults: demoWebSearchMaxResults,
            provider: "duckduckgo",
            query: "GitHub README animated GIF autoplay",
            status: "active",
          },
          approvals: [
            {
              command: "npm.cmd run check",
              createdAt: new Date(now - 55_000).toISOString(),
              detail: "Run the local validation suite before publishing the release notes.",
              id: "approval-readme-check",
              kind: "terminal",
              preview: "npm.cmd run check\nnpm.cmd run rust:check\ngit diff --check",
              risk: "medium",
              status: "pending",
              title: "Run validation commands",
              tool: "validation",
              toolCallId: "validation-check",
            },
          ],
        },
      ),
    ],
    pinned: true,
    project: "GilbertCodex",
    title: "Open-source README polish",
    updatedAt: isoNow,
  };

  const providerSettings = {
    apiKeys: {},
    baseUrls: {
      "9router": "http://127.0.0.1:20128/v1",
    },
    model: "cx/gpt-5.5",
    provider: "9router",
    providerModels: {
      "9router": "cx/gpt-5.5",
    },
    thinking: {
      effort: "medium",
      enabled: true,
    },
    tools: {
      imageGeneration: true,
    },
    webSearch: {
      enabled: true,
      maxResults: demoWebSearchMaxResults,
      provider: "duckduckgo",
    },
  };

  const emptyChat = {
    id: "chat-readme-empty",
    messages: [],
    pinned: false,
    project: "GilbertCodex",
    title: "New chat",
    updatedAt: new Date(now - 55_000).toISOString(),
  };

  return {
    activeChat,
    emptyChat,
    providerSettings,
    workspace,
    projects: [
      {
        createdAt: new Date(now - 86400_000).toISOString(),
        id: "project-gilbert-codex",
        localWorkspace: workspace,
        name: "GilbertCodex",
        updatedAt: isoNow,
      },
      {
        createdAt: new Date(now - 172800_000).toISOString(),
        id: "project-gilbert-weather",
        name: "GilbertWeather",
        updatedAt: new Date(now - 7200_000).toISOString(),
      },
    ],
  };
}

async function waitForStableUi(page) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);
}

async function capture(page, name) {
  await page.screenshot({
    animations: "disabled",
    fullPage: false,
    path: path.join(assetDir, name),
  });
}

await mkdir(assetDir, { recursive: true });

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--disable-background-timer-throttling"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const seed = createSeedState();

  await page.route("**/v1/models", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ data: demoSubscriptionModels.map((id) => ({ id })) }),
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      status: 200,
    });
  });

  await page.addInitScript(
    ({ activeChat, emptyChat, projects, providerSettings, storageSuffix, userId, workspace }) => {
      const authDb = {
        currentSession: {
          createdAt: Date.now(),
          sessionToken: "session-readme-demo",
          userId,
        },
        databaseGeneration: 2,
        users: [
          {
            createdAt: Date.now() - 86400_000,
            displayName: "Gilbert Demo",
            email: "demo@gilbert.local",
            id: userId,
            lastLoginAt: Date.now(),
            passwordHash: "readme-demo",
            passwordHashAlgorithm: "pbkdf2-sha256",
            passwordIterations: 210000,
            passwordSalt: "readme-demo",
            updatedAt: Date.now(),
            username: "demo",
          },
        ],
      };
      const scoped = (key) => `${key}.${storageSuffix}`;
      const toolDefaults = {
        browserPreview: true,
        codeEdit: true,
        codeGeneration: true,
        codeView: true,
        colorTools: true,
        desktopComputer: true,
        fileSafety: true,
        fileCreation: true,
        fileBrowser: true,
        fileSearch: true,
        mcpServers: true,
        pdfTools: true,
        permissions: true,
        planning: true,
        provider: true,
        reactNativeTools: true,
        sourceControl: true,
        sqlTools: true,
        terminal: true,
        thinking: true,
        testingTools: true,
        typescriptTools: true,
        webSearch: true,
        workflowAutomation: true,
      };

      window.localStorage.clear();
      window.localStorage.setItem("gilbert-codex.local-auth-db.v1", JSON.stringify(authDb));
      window.localStorage.setItem(scoped("gilbert-codex.active-chat.v1"), activeChat.id);
      window.localStorage.setItem(scoped("gilbert-codex.appearance.v1"), "dark");
      window.localStorage.setItem(scoped("gilbert-codex.chats.v1"), JSON.stringify([activeChat, emptyChat]));
      window.localStorage.setItem(scoped("gilbert-codex.local-workspace.v1"), JSON.stringify(workspace));
      window.localStorage.setItem(scoped("gilbert-codex.onboarding.never-show.v1"), "true");
      window.localStorage.setItem(scoped("gilbert-codex.personalization.v1"), JSON.stringify({ locationServicesEnabled: false }));
      window.localStorage.setItem(scoped("gilbert-codex.provider-settings.v1"), JSON.stringify(providerSettings));
      window.localStorage.setItem(scoped("gilbert-codex.projects.v1"), JSON.stringify(projects));
      window.localStorage.setItem(scoped("gilbert-codex.tool-registry.v1"), JSON.stringify(toolDefaults));
    },
    {
      activeChat: seed.activeChat,
      emptyChat: seed.emptyChat,
      projects: seed.projects,
      providerSettings: seed.providerSettings,
      storageSuffix,
      userId,
      workspace: seed.workspace,
    },
  );

  await page.goto(appUrl);
  await page.waitForSelector(".conversation-frame");
  await page.waitForSelector(".right-rail");
  await page.locator(".message-sources-toggle").first().click();
  await waitForStableUi(page);
  await capture(page, "gilbert-codex-chat-progress.png");

  await page.locator(".sidebar-action").filter({ hasText: "New chat" }).first().click();
  await page.getByRole("menuitem", { name: "Start from scratch" }).click();
  await page.waitForSelector(".empty-chat-start");
  await waitForStableUi(page);
  await capture(page, "gilbert-codex-overview.png");

  await page.getByText("Settings", { exact: true }).click();
  await page.waitForSelector(".settings-page");
  await waitForStableUi(page);
  await capture(page, "gilbert-codex-settings.png");

  await page.getByText("AI & Providers", { exact: true }).click();
  await page.waitForSelector(".settings-page");
  await waitForStableUi(page);
  await capture(page, "gilbert-codex-provider-settings.png");

  await page.getByText("Subscriptions", { exact: true }).click();
  await page.waitForSelector(".settings-page");
  await waitForStableUi(page);
  await capture(page, "gilbert-codex-subscriptions.png");
} finally {
  await browser.close();
}

console.log(`Captured README screenshots in ${path.relative(process.cwd(), assetDir)}`);

function normalizeDemoWebSearchMaxResults(value) {
  const fallback = 6;
  const parsed = Number.parseInt(value ?? "", 10);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, 1), fallback);
}
