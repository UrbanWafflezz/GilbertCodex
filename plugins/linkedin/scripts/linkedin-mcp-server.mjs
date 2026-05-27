#!/usr/bin/env node
import readline from "node:readline";

const PROTOCOL_VERSION = "2025-03-26";
const SERVER_INFO = { name: "Gilbert LinkedIn MCP", version: "0.1.0" };
const DEFAULT_LINKEDIN_VERSION = "202510";
const OFFICIAL_DOCS = {
  access: "https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access",
  oidc: "https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2",
  profileDetails: "https://learn.microsoft.com/en-us/linkedin/consumer/integrations/verified-on-linkedin/api-reference/identity-me",
  share: "https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin",
  terms: "https://www.linkedin.com/legal/l/api-terms-of-use",
};

const TOOLS = [
  {
    name: "linkedin_setup_checklist",
    description: "Explain the compliant LinkedIn setup path, scopes, token environment, and API boundaries for Gilbert.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        includePosting: {
          type: "boolean",
          description: "Include optional Share on LinkedIn setup notes for w_member_social.",
        },
        intendedUse: {
          type: "string",
          description: "Short description of what the user wants to do with LinkedIn.",
        },
      },
    },
  },
  {
    name: "linkedin_get_authenticated_profile",
    description: "Fetch the authenticated member's own LinkedIn profile through official APIs when LINKEDIN_ACCESS_TOKEN is configured.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        linkedinVersion: {
          type: "string",
          description: "LinkedIn REST API version for identityMe, formatted as YYYYMM. Defaults to LINKEDIN_API_VERSION or 202510.",
        },
        source: {
          type: "string",
          enum: ["userinfo", "identityMe"],
          description: "userinfo uses OIDC profile/email. identityMe uses the Verified on LinkedIn profile details endpoint.",
        },
      },
    },
  },
  {
    name: "linkedin_profile_setup_plan",
    description: "Create a LinkedIn profile setup and optimization plan from user-provided goals, experience, strengths, and keywords.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        achievements: {
          type: "array",
          items: { type: "string" },
          description: "Measurable wins or proof points the profile should highlight.",
        },
        currentHeadline: {
          type: "string",
          description: "Current LinkedIn headline, if available.",
        },
        experienceSummary: {
          type: "string",
          description: "Short summary of work history or current role.",
        },
        fullName: {
          type: "string",
          description: "Profile owner name.",
        },
        keywords: {
          type: "array",
          items: { type: "string" },
          description: "Industry, role, or skill keywords the user wants represented.",
        },
        strengths: {
          type: "array",
          items: { type: "string" },
          description: "Core strengths, tools, domains, or differentiators.",
        },
        targetAudience: {
          type: "string",
          description: "Who should understand the profile, such as recruiters, customers, founders, or collaborators.",
        },
        targetRole: {
          type: "string",
          description: "Target role, niche, or professional direction.",
        },
        tone: {
          type: "string",
          enum: ["direct", "executive", "technical", "warm"],
          description: "Preferred profile voice.",
        },
      },
    },
  },
  {
    name: "linkedin_profile_research_brief",
    description: "Turn user-provided LinkedIn profile text or notes into a research brief without scraping LinkedIn.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        profileText: {
          type: "string",
          description: "Profile text, resume notes, public bio, or copied profile details supplied by the user.",
        },
        researchGoal: {
          type: "string",
          enum: ["fit", "outreach", "profile_optimization", "summary"],
          description: "How the brief should be framed.",
        },
        targetContext: {
          type: "string",
          description: "Role, market, account, or reason for researching this profile.",
        },
        userSuppliedSources: {
          type: "array",
          items: { type: "string" },
          description: "Optional source labels or URLs that the user supplied. The tool does not fetch them.",
        },
      },
      required: ["profileText"],
    },
  },
  {
    name: "linkedin_post_draft_review",
    description: "Review a user-written LinkedIn post draft for clarity, audience fit, and safety without publishing it.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        audience: {
          type: "string",
          description: "Intended readers for the post.",
        },
        draft: {
          type: "string",
          description: "LinkedIn post draft to review.",
        },
        goal: {
          type: "string",
          description: "Desired outcome, such as hiring, credibility, announcement, or conversation.",
        },
        tone: {
          type: "string",
          enum: ["direct", "executive", "technical", "warm"],
          description: "Preferred post voice.",
        },
      },
      required: ["draft"],
    },
  },
];

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on("line", (line) => {
  const trimmed = line.trim();

  if (!trimmed) {
    return;
  }

  void handleLine(trimmed);
});

async function handleLine(line) {
  let message;

  try {
    message = JSON.parse(line);
  } catch (error) {
    sendError(null, -32700, `Invalid JSON: ${error.message}`);
    return;
  }

  try {
    await handleMessage(message);
  } catch (error) {
    sendToolError(message.id ?? null, error instanceof Error ? error.message : String(error));
  }
}

async function handleMessage(message) {
  if (message.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      },
    });
    return;
  }

  if (message.method === "notifications/initialized") {
    return;
  }

  if (message.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: { tools: TOOLS },
    });
    return;
  }

  if (message.method === "tools/call") {
    const toolName = stringValue(message.params?.name);
    const args = objectValue(message.params?.arguments);
    const result = await callTool(toolName, args);
    send({ jsonrpc: "2.0", id: message.id, result });
    return;
  }

  sendError(message.id ?? null, -32601, "Method not found");
}

async function callTool(toolName, args) {
  switch (toolName) {
    case "linkedin_setup_checklist":
      return setupChecklist(args);
    case "linkedin_get_authenticated_profile":
      return getAuthenticatedProfile(args);
    case "linkedin_profile_setup_plan":
      return profileSetupPlan(args);
    case "linkedin_profile_research_brief":
      return profileResearchBrief(args);
    case "linkedin_post_draft_review":
      return postDraftReview(args);
    default:
      return {
        content: [{ type: "text", text: `Unknown LinkedIn MCP tool: ${toolName}` }],
        isError: true,
        structuredContent: { toolName },
      };
  }
}

function setupChecklist(args) {
  const intendedUse = cleanText(args.intendedUse) || "LinkedIn profile setup and research";
  const includePosting = Boolean(args.includePosting);
  const scopes = ["openid", "profile", "email"];

  if (includePosting) {
    scopes.push("w_member_social");
  }

  const boundaries = [
    "Use official OAuth/member-consented APIs for authenticated-user data.",
    "Do not scrape, crawl, or automate LinkedIn pages outside LinkedIn APIs.",
    "This server does not update profile fields because LinkedIn does not expose a self-serve profile-write API.",
    "For other people's profiles, use user-supplied text or separately authorized public sources instead of automated LinkedIn scraping.",
  ];
  const steps = [
    "Create or reuse a LinkedIn Developer app.",
    `Enable Sign in with LinkedIn using OpenID Connect and request scopes: ${scopes.join(", ")}.`,
    "Complete OAuth outside this MCP server and save the resulting member access token in Gilbert Keys as LINKEDIN_ACCESS_TOKEN.",
    "Configure the LinkedIn MCP preset, apply LINKEDIN_ACCESS_TOKEN as secure environment, then Save and test.",
    "Use linkedin_get_authenticated_profile for the signed-in member, and use the profile planning tools for copy, positioning, and research briefs.",
  ];

  if (includePosting) {
    steps.push("Only add posting after a separate review flow; this MCP server reviews drafts but intentionally does not publish posts.");
  }

  return textResult(
    [
      `LinkedIn setup for: ${intendedUse}`,
      "",
      "Setup steps:",
      ...steps.map((step, index) => `${index + 1}. ${step}`),
      "",
      "Boundaries:",
      ...boundaries.map((boundary) => `- ${boundary}`),
      "",
      "Official references:",
      `- Getting access: ${OFFICIAL_DOCS.access}`,
      `- OIDC sign-in: ${OFFICIAL_DOCS.oidc}`,
      `- API terms: ${OFFICIAL_DOCS.terms}`,
    ].join("\n"),
    {
      boundaries,
      docs: OFFICIAL_DOCS,
      environment: {
        LINKEDIN_ACCESS_TOKEN: "Required for official authenticated profile calls.",
        LINKEDIN_API_VERSION: `Optional. Defaults to ${DEFAULT_LINKEDIN_VERSION} for identityMe.`,
      },
      intendedUse,
      scopes,
      steps,
    },
  );
}

async function getAuthenticatedProfile(args) {
  const token = process.env.LINKEDIN_ACCESS_TOKEN?.trim();

  if (!token) {
    return {
      content: [{
        type: "text",
        text: "LINKEDIN_ACCESS_TOKEN is not configured. Run linkedin_setup_checklist, complete LinkedIn OAuth, save the token in Gilbert Keys, and apply it as secure environment before calling this tool.",
      }],
      isError: true,
      structuredContent: {
        missing: "LINKEDIN_ACCESS_TOKEN",
        setupTool: "linkedin_setup_checklist",
      },
    };
  }

  const source = args.source === "identityMe" ? "identityMe" : "userinfo";
  const linkedinVersion = cleanText(args.linkedinVersion) || process.env.LINKEDIN_API_VERSION?.trim() || DEFAULT_LINKEDIN_VERSION;
  const endpoint = source === "identityMe"
    ? "https://api.linkedin.com/rest/identityMe"
    : "https://api.linkedin.com/v2/userinfo";
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
  };

  if (source === "identityMe") {
    headers["Linkedin-Version"] = linkedinVersion;
    headers["X-Restli-Protocol-Version"] = "2.0.0";
  }

  const response = await fetchWithTimeout(endpoint, { headers }, 20_000);
  const payload = await readResponsePayload(response);

  if (!response.ok) {
    return {
      content: [{
        type: "text",
        text: [
          `LinkedIn ${source} request failed with HTTP ${response.status}.`,
          "Check that the token is valid, member-consented, and approved for the requested LinkedIn product/scopes.",
          truncateForText(formatPayload(payload), 1_500),
        ].filter(Boolean).join("\n"),
      }],
      isError: true,
      structuredContent: {
        docs: source === "identityMe" ? OFFICIAL_DOCS.profileDetails : OFFICIAL_DOCS.oidc,
        source,
        status: response.status,
      },
    };
  }

  const profile = objectValue(payload);
  const summary = summarizeProfile(profile, source);

  return textResult(summary, {
    profile,
    source,
  });
}

function profileSetupPlan(args) {
  const targetRole = cleanText(args.targetRole) || "the next professional opportunity";
  const targetAudience = cleanText(args.targetAudience) || "recruiters, collaborators, and relevant professional readers";
  const tone = cleanText(args.tone) || "direct";
  const strengths = asStringArray(args.strengths).slice(0, 8);
  const achievements = asStringArray(args.achievements).slice(0, 8);
  const keywords = asStringArray(args.keywords).slice(0, 12);
  const currentHeadline = cleanText(args.currentHeadline);
  const experienceSummary = cleanText(args.experienceSummary);
  const proof = achievements[0] || strengths[0] || "clear outcomes";
  const strengthPhrase = strengths.slice(0, 2).join(" + ") || "practical execution";
  const keywordPhrase = keywords.slice(0, 3).join(" | ") || targetRole;

  const headlineDrafts = [
    `${titleCase(targetRole)} | ${strengthPhrase} | ${proof}`,
    `${titleCase(targetRole)} helping ${targetAudience} with ${keywordPhrase}`,
    `${titleCase(targetRole)} focused on ${strengthPhrase}`,
  ].map((value) => compactSentence(value));
  const aboutOutline = [
    `Lead with the target: "I help ${targetAudience} understand ${targetRole} work through ${strengthPhrase}."`,
    experienceSummary
      ? `Connect the story to experience: ${truncateForText(experienceSummary, 220)}`
      : "Add a two-sentence career story that connects past work to the target role.",
    achievements.length > 0
      ? `Use proof points: ${achievements.slice(0, 3).join("; ")}.`
      : "Add two measurable achievements with numbers, scope, or shipped outcomes.",
    keywords.length > 0
      ? `Naturally include keywords: ${keywords.slice(0, 8).join(", ")}.`
      : "Add role-specific keywords a recruiter or buyer would search for.",
    "Close with what the reader should do next: message, view portfolio, book a call, or review featured work.",
  ];
  const checklist = [
    "Headline states role, audience, and proof.",
    "About section has a clear first-person positioning paragraph.",
    "Experience bullets use action, scope, metric, and outcome.",
    "Featured section shows the best proof: portfolio, case study, product, demo, article, or GitHub/relevant link.",
    "Skills list reflects the target role and repeats the highest-value keywords.",
    "Contact and location details are complete enough for the user's goal.",
  ];

  if (currentHeadline) {
    checklist.unshift(`Compare the new headline against the current one: "${truncateForText(currentHeadline, 140)}".`);
  }

  return textResult(
    [
      `LinkedIn profile setup plan for ${targetRole}`,
      "",
      "Headline drafts:",
      ...headlineDrafts.map((draft) => `- ${draft}`),
      "",
      "About outline:",
      ...aboutOutline.map((item) => `- ${item}`),
      "",
      "Experience bullet template:",
      "- Built/led/improved [thing] for [audience/system], using [skills], resulting in [measurable outcome].",
      "",
      "Checklist:",
      ...checklist.map((item) => `- ${item}`),
      "",
      "Note: LinkedIn does not expose a self-serve API for this MCP server to write profile edits. Use this as copy guidance for the user to review and paste.",
    ].join("\n"),
    {
      aboutOutline,
      boundaries: ["No profile writes are attempted."],
      checklist,
      headlineDrafts,
      targetAudience,
      targetRole,
      tone,
    },
  );
}

function profileResearchBrief(args) {
  const profileText = cleanText(args.profileText);

  if (!profileText) {
    return {
      content: [{ type: "text", text: "profileText is required. Paste user-provided LinkedIn profile text, resume notes, or public bio content." }],
      isError: true,
      structuredContent: { missing: "profileText" },
    };
  }

  const researchGoal = cleanText(args.researchGoal) || "summary";
  const targetContext = cleanText(args.targetContext);
  const sourceLabels = asStringArray(args.userSuppliedSources).slice(0, 8);
  const lines = profileText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const keywords = extractKeywords(profileText).slice(0, 18);
  const likelyRoles = lines.filter((line) => /(\bat\b|\||founder|engineer|designer|manager|director|consultant|developer|operator|student|analyst|lead)/i.test(line)).slice(0, 6);
  const proofSignals = lines.filter((line) => /(\d+%|\$\d+|\d+\+|\bgrew\b|\bbuilt\b|\bled\b|\bshipped\b|\blaunched\b|\bmanaged\b|\bimproved\b|\bscaled\b)/i.test(line)).slice(0, 8);
  const questions = [
    "What outcome does this person appear most proud of?",
    "What audience or buyer would immediately understand the profile?",
    "Which claims need more proof, numbers, or source context?",
    "What is the most natural next question or outreach angle?",
  ];

  const text = [
    `LinkedIn research brief (${researchGoal})`,
    targetContext ? `Context: ${targetContext}` : "",
    "",
    "Scope:",
    "- This brief uses only text supplied in the tool input.",
    "- It does not fetch, scrape, crawl, or automate LinkedIn.",
    sourceLabels.length > 0 ? `- User-supplied sources: ${sourceLabels.join(", ")}` : "",
    "",
    "Visible signals:",
    ...likelyRoles.map((line) => `- ${truncateForText(line, 180)}`),
    likelyRoles.length === 0 ? "- No clear role/headline line was detected. Add headline, current role, company, and location notes for a stronger brief." : "",
    "",
    "Proof signals:",
    ...proofSignals.map((line) => `- ${truncateForText(line, 180)}`),
    proofSignals.length === 0 ? "- No numeric or outcome-oriented proof signals were detected." : "",
    "",
    "Keywords:",
    keywords.length > 0 ? keywords.join(", ") : "No strong repeated keywords detected.",
    "",
    "Follow-up questions:",
    ...questions.map((question) => `- ${question}`),
  ].filter(Boolean).join("\n");

  return textResult(text, {
    boundaries: ["No LinkedIn scraping or external fetch was performed."],
    keywords,
    likelyRoles,
    proofSignals,
    researchGoal,
    sourceLabels,
    targetContext,
  });
}

function postDraftReview(args) {
  const draft = cleanText(args.draft);

  if (!draft) {
    return {
      content: [{ type: "text", text: "draft is required." }],
      isError: true,
      structuredContent: { missing: "draft" },
    };
  }

  const audience = cleanText(args.audience) || "professional readers";
  const goal = cleanText(args.goal) || "start a useful conversation";
  const tone = cleanText(args.tone) || "direct";
  const wordCount = draft.split(/\s+/).filter(Boolean).length;
  const checks = [
    draft.length > 280 ? "Consider tightening the opening so the first two lines carry the point." : "Opening length is compact.",
    /\bI\b|\bwe\b/i.test(draft) ? "The draft has a personal voice." : "Add a concrete first-person perspective or owner for the claim.",
    /\?/.test(draft) ? "The draft already includes a question." : "Consider ending with one specific question for the audience.",
    /https?:\/\//i.test(draft) ? "A link is present; make sure the post still stands alone without the link preview." : "No link detected; add one only if it helps the goal.",
  ];
  const rewriteFrame = [
    `Audience: ${audience}`,
    `Goal: ${goal}`,
    `Tone: ${tone}`,
    "Suggested structure:",
    "1. One-line hook with the concrete point.",
    "2. Two to four lines of context or proof.",
    "3. Practical takeaway for the reader.",
    "4. Clear question or next step.",
  ];

  return textResult(
    [
      `LinkedIn post draft review (${wordCount} words)`,
      "",
      "Checks:",
      ...checks.map((check) => `- ${check}`),
      "",
      ...rewriteFrame,
      "",
      "Note: This MCP server reviews drafts only. It does not publish LinkedIn posts.",
    ].join("\n"),
    {
      audience,
      checks,
      goal,
      tone,
      wordCount,
    },
  );
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readResponsePayload(response) {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function summarizeProfile(profile, source) {
  const displayName = firstString(profile.name, [profile.localizedFirstName, profile.given_name, profile.firstName?.localized && Object.values(profile.firstName.localized)[0]].filter(Boolean).join(" "));
  const headline = firstString(profile.headline, profile.localizedHeadline, profile.primaryPosition?.title, profile.primaryCurrentProfessionalExperience?.title);
  const email = firstString(profile.email, profile.emailAddress);
  const profileUrl = firstString(profile.vanityName ? `https://www.linkedin.com/in/${profile.vanityName}` : "", profile.profileUrl, profile.localizedProfileUrl);
  const parts = [
    `LinkedIn ${source} profile loaded.`,
    displayName ? `Name: ${displayName}` : "",
    headline ? `Headline/current role: ${headline}` : "",
    email ? `Email: ${email}` : "",
    profileUrl ? `Profile URL: ${profileUrl}` : "",
    "",
    "Use linkedin_profile_setup_plan to turn this authenticated profile context into a reviewed setup plan.",
  ].filter(Boolean);

  return parts.join("\n");
}

function extractKeywords(text) {
  const stopWords = new Set([
    "about",
    "after",
    "also",
    "and",
    "from",
    "have",
    "into",
    "linkedin",
    "more",
    "that",
    "their",
    "this",
    "with",
    "work",
    "your",
  ]);
  const counts = new Map();
  const words = text.toLowerCase().match(/[a-z][a-z0-9+.#-]{3,}/g) ?? [];

  for (const word of words) {
    if (stopWords.has(word)) {
      continue;
    }

    counts.set(word, (counts.get(word) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([word]) => word);
}

function asStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(cleanText).filter(Boolean);
}

function cleanText(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function compactSentence(value) {
  return value.replace(/\s+/g, " ").replace(/\s+\|/g, " |").replace(/\|\s+/g, "| ").trim();
}

function formatPayload(payload) {
  return typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
}

function firstString(...values) {
  return values.map(cleanText).find(Boolean) || "";
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stringValue(value) {
  return typeof value === "string" ? value : "";
}

function textResult(text, structuredContent) {
  return {
    content: [{ type: "text", text }],
    isError: false,
    structuredContent,
  };
}

function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function sendError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function sendToolError(id, message) {
  send({
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text", text: message }],
      isError: true,
      structuredContent: { message },
    },
  });
}

function titleCase(value) {
  return value.replace(/\w\S*/g, (word) => /^[A-Z0-9+#.]+$/.test(word)
    ? word
    : word[0].toUpperCase() + word.slice(1).toLowerCase());
}

function truncateForText(value, max) {
  const text = cleanText(value);

  if (text.length <= max) {
    return text;
  }

  return `${text.slice(0, max - 3)}...`;
}
