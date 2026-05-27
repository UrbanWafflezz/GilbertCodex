import type { ModelProviderId, ProviderSettings } from "../types/settings";
import { getModelProvider, isModelProviderId, normalizeProviderModelId } from "./models";
import type {
  AutomationCapabilityDefinition,
  AutomationCapabilityId,
  AutomationMcpServerScope,
  AutomationNotificationPolicy,
  AutomationRun,
  AutomationRunLimits,
  AutomationSkillScope,
  AutomationState,
  AutomationTask,
  AutomationTaskDraft,
  AutomationTrigger,
} from "../types/automation";
import type { ChatSource, ChatToolCall } from "../types/chat";
import type { ToolAutomationScope } from "../toolBridge/types";

const MCP_BRIDGE_TOOL_IDS = ["mcp_list_servers", "mcp_list_tools", "mcp_call_tool"] as const;

export const DEFAULT_AUTOMATION_RUN_LIMITS: AutomationRunLimits = {
  maxModelLoops: 8,
  maxNotificationChars: 900,
  maxRuntimeSeconds: 180,
  maxToolCalls: 20,
};

export const DEFAULT_AUTOMATION_NOTIFICATION_POLICY: AutomationNotificationPolicy = {
  desktop: true,
  discord: false,
  maxSummaryChars: 900,
  privacy: "summary",
  tasksInbox: true,
};

export const AUTOMATION_CAPABILITIES: AutomationCapabilityDefinition[] = [
  {
    description: "Search and read Gmail metadata, threads, and full messages when the task needs it.",
    familyHints: ["gmail"],
    id: "gmail.read",
    label: "Gmail read",
    promptHint: "Gmail inbox, email search, read message, read thread.",
    risk: "medium",
    toolIds: [
      "gmail_account",
      "gmail_search_messages",
      "gmail_semantic_search",
      "gmail_get_message",
      "gmail_read_full_message",
      "gmail_get_thread",
      "gmail_read_full_thread",
      "gmail_list_labels",
      "gmail_api_read",
    ],
  },
  {
    description: "Create drafts or send Gmail messages without another confirmation when scoped to this task.",
    familyHints: ["gmail"],
    id: "gmail.send",
    label: "Gmail send",
    promptHint: "Gmail compose, draft email, send email.",
    risk: "high",
    toolIds: [
      "gmail_create_draft",
      "gmail_send_message",
      "gmail_send_separate_messages",
      "gmail_send_draft",
    ],
  },
  {
    description: "Apply Gmail labels and lightweight mailbox organization. Deletions still stay approval-gated.",
    familyHints: ["gmail"],
    id: "gmail.manage",
    label: "Gmail organize",
    promptHint: "Gmail labels, organize email, mark messages.",
    risk: "high",
    toolIds: [
      "gmail_create_label",
      "gmail_modify_message_labels",
      "gmail_batch_modify_messages",
      "gmail_untrash_message",
      "gmail_api_write",
    ],
  },
  {
    description: "Read calendars, events, availability, and Google Tasks.",
    familyHints: ["calendar"],
    id: "calendar.read",
    label: "Calendar read",
    promptHint: "Google Calendar agenda, calendar search, free busy, tasks.",
    risk: "medium",
    toolIds: [
      "calendar_account",
      "calendar_list_calendars",
      "calendar_search_events",
      "calendar_get_event",
      "calendar_free_busy",
      "calendar_api_read",
      "calendar_list_task_lists",
      "calendar_list_tasks",
      "calendar_get_task",
    ],
  },
  {
    description: "Create or update calendar events and tasks. Deletes still stay approval-gated.",
    familyHints: ["calendar"],
    id: "calendar.edit",
    label: "Calendar edit",
    promptHint: "Google Calendar create event, update meeting, create task.",
    risk: "high",
    toolIds: [
      "calendar_create_event",
      "calendar_update_event",
      "calendar_create_calendar",
      "calendar_update_calendar",
      "calendar_api_write",
      "calendar_create_task_list",
      "calendar_update_task_list",
      "calendar_create_task",
      "calendar_update_task",
      "calendar_move_task",
    ],
  },
  {
    description: "Send a concise result summary through the configured Discord notification channel.",
    familyHints: [],
    id: "discord.post",
    label: "Discord post",
    promptHint: "Discord notification summary.",
    risk: "medium",
    toolIds: [],
  },
  {
    description: "Use web search for current, source-backed facts.",
    familyHints: ["web"],
    id: "web.search",
    label: "Web search",
    promptHint: "Web search, current sources, recent information.",
    risk: "low",
    toolIds: ["web_search"],
  },
  {
    description: "Read GitHub repositories, issues, PRs, workflows, and notifications.",
    familyHints: ["github"],
    id: "github.read",
    label: "GitHub read",
    promptHint: "GitHub issues, pull requests, repository, workflow runs.",
    risk: "medium",
    toolIds: [
      "github_account",
      "github_list_repositories",
      "github_get_repository",
      "github_list_branches",
      "github_list_tags",
      "github_list_tree",
      "github_read_file",
      "github_search_code",
      "github_semantic_search",
      "github_search_issues",
      "github_list_issues",
      "github_get_issue",
      "github_list_issue_comments",
      "github_list_pull_requests",
      "github_get_pull_request",
      "github_list_pull_request_files",
      "github_list_workflow_runs",
      "github_get_workflow_run",
      "github_list_notifications",
      "github_api_read",
    ],
  },
];

const CAPABILITY_MAP = new Map(AUTOMATION_CAPABILITIES.map((capability) => [capability.id, capability]));

export function createEmptyAutomationState(now = new Date().toISOString()): AutomationState {
  return {
    globalPaused: false,
    runs: [],
    tasks: [],
    updatedAt: now,
    version: 1,
  };
}

export function normalizeAutomationState(value: unknown, now = new Date().toISOString()): AutomationState {
  const raw = typeof value === "object" && value ? (value as Partial<AutomationState>) : {};
  const tasks = Array.isArray(raw.tasks) ? raw.tasks.flatMap((task) => normalizeAutomationTask(task, now)) : [];
  const runs = Array.isArray(raw.runs) ? raw.runs.flatMap((run) => normalizeAutomationRun(run, now)) : [];

  return {
    globalPaused: raw.globalPaused === true,
    runs: runs.slice(0, 500),
    tasks,
    updatedAt: typeof raw.updatedAt === "string" && raw.updatedAt ? raw.updatedAt : now,
    version: 1,
  };
}

export function normalizeAutomationTask(value: unknown, now = new Date().toISOString()): AutomationTask[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  const raw = value as Partial<AutomationTask>;
  const title = normalizeTitle(raw.title);
  const prompt = typeof raw.prompt === "string" ? raw.prompt.trim() : "";

  if (!prompt) {
    return [];
  }

  const trigger = normalizeAutomationTrigger(raw.trigger);
  const createdAt = normalizeIsoDate(raw.createdAt, now);
  const modelSelection = normalizeAutomationModelSelection(raw.provider, raw.model);
  const nextRunAt = typeof raw.nextRunAt === "string" && raw.nextRunAt
    ? normalizeIsoDate(raw.nextRunAt, raw.nextRunAt)
    : computeNextRunAt({ ...raw, trigger } as AutomationTask, now);

  return [
    {
      capabilityScope: {
        autonomyLevel: raw.capabilityScope?.autonomyLevel === "scoped" ? "scoped" : "review",
        capabilities: normalizeCapabilityIds(raw.capabilityScope?.capabilities),
        mcpServers: normalizeMcpServerScopes(raw.capabilityScope?.mcpServers),
        skills: normalizeSkillScopes(raw.capabilityScope?.skills),
      },
      chatId: normalizeOptionalString(raw.chatId),
      createdAt,
      description: normalizeOptionalString(raw.description),
      id: normalizeOptionalString(raw.id) ?? createAutomationId("task"),
      lastResult: normalizeOptionalString(raw.lastResult),
      lastRunAt: normalizeOptionalString(raw.lastRunAt),
      model: modelSelection.model,
      nextRunAt,
      notificationPolicy: normalizeNotificationPolicy(raw.notificationPolicy),
      prompt,
      projectName: normalizeOptionalString(raw.projectName),
      provider: modelSelection.provider,
      runCount: normalizeInteger(raw.runCount, 0, 0, 1_000_000),
      sourceChatId: normalizeOptionalString(raw.sourceChatId),
      status: raw.status === "paused" || raw.status === "archived" ? raw.status : "enabled",
      title,
      trigger,
      updatedAt: normalizeIsoDate(raw.updatedAt, createdAt),
      runLimits: normalizeRunLimits(raw.runLimits),
    },
  ];
}

export function createAutomationTaskFromDraft(draft: AutomationTaskDraft, now = new Date().toISOString()): AutomationTask {
  const prompt = draft.prompt?.trim() || "Describe what this agent should do each time it runs.";
  const trigger = normalizeAutomationTrigger(draft.trigger);
  const modelSelection = normalizeAutomationModelSelection(draft.provider, draft.model);
  const task: AutomationTask = {
    capabilityScope: {
      autonomyLevel: draft.capabilityScope?.autonomyLevel === "scoped" ? "scoped" : "review",
      capabilities: normalizeCapabilityIds(draft.capabilityScope?.capabilities),
      mcpServers: normalizeMcpServerScopes(draft.capabilityScope?.mcpServers),
      skills: normalizeSkillScopes(draft.capabilityScope?.skills),
    },
    createdAt: now,
    description: draft.description?.trim() || undefined,
    id: createAutomationId("task"),
    model: modelSelection.model,
    nextRunAt: undefined,
    notificationPolicy: normalizeNotificationPolicy(draft.notificationPolicy),
    prompt,
    projectName: draft.projectName?.trim() || undefined,
    provider: modelSelection.provider,
    runCount: 0,
    sourceChatId: draft.sourceChatId?.trim() || undefined,
    status: draft.status === "paused" || draft.status === "archived" ? draft.status : "paused",
    title: normalizeTitle(draft.title || createTitleFromPrompt(prompt)),
    trigger,
    updatedAt: now,
    runLimits: normalizeRunLimits(draft.runLimits),
  };

  return {
    ...task,
    nextRunAt: computeNextRunAt(task, now),
  };
}

export function normalizeAutomationRun(value: unknown, now = new Date().toISOString()): AutomationRun[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  const raw = value as Partial<AutomationRun>;
  const taskId = normalizeOptionalString(raw.taskId);
  const id = normalizeOptionalString(raw.id);
  const startedAt = normalizeIsoDate(raw.startedAt, now);

  if (!taskId || !id) {
    return [];
  }

  return [
    {
      acknowledgedAt: normalizeOptionalString(raw.acknowledgedAt),
      agentRunId: normalizeOptionalString(raw.agentRunId),
      approvalCount: normalizeInteger(raw.approvalCount, 0, 0, 1_000_000),
      chatId: normalizeOptionalString(raw.chatId),
      completedAt: normalizeOptionalString(raw.completedAt),
      dryRun: raw.dryRun === true,
      error: normalizeOptionalString(raw.error),
      finalSummary: normalizeOptionalString(raw.finalSummary),
      id,
      messageId: normalizeOptionalString(raw.messageId),
      model: normalizeOptionalString(raw.model),
      notificationAttempts: Array.isArray(raw.notificationAttempts) ? raw.notificationAttempts.filter(isNotificationAttempt) : [],
      provider: raw.provider,
      reason: raw.reason === "scheduled" || raw.reason === "app_start" || raw.reason === "simulated" ? raw.reason : "manual",
      snoozedUntil: normalizeOptionalString(raw.snoozedUntil),
      sources: Array.isArray(raw.sources) ? raw.sources : undefined,
      startedAt,
      status: normalizeRunStatus(raw.status),
      taskId,
      toolCallCount: normalizeInteger(raw.toolCallCount, 0, 0, 1_000_000),
      toolCalls: Array.isArray(raw.toolCalls) ? raw.toolCalls : undefined,
      updatedAt: normalizeIsoDate(raw.updatedAt, startedAt),
    },
  ];
}

export function computeNextRunAt(task: Pick<AutomationTask, "lastRunAt" | "trigger">, from = new Date().toISOString()): string | undefined {
  const fromDate = new Date(from);
  const fromMs = Number.isFinite(fromDate.getTime()) ? fromDate.getTime() : Date.now();
  const anchorMs = Math.max(fromMs, Date.parse(task.lastRunAt || "") || 0);

  if (task.trigger.kind === "manual") {
    return undefined;
  }

  if (task.trigger.kind === "app_start") {
    return new Date(fromMs).toISOString();
  }

  if (task.trigger.kind === "interval") {
    const intervalMs = Math.max(1, task.trigger.everyMinutes) * 60_000;
    return new Date(anchorMs + intervalMs).toISOString();
  }

  const [hour, minute] = task.trigger.time.split(":").map((part) => Number.parseInt(part, 10));
  const next = new Date(fromMs);
  next.setHours(Number.isFinite(hour) ? hour : 9, Number.isFinite(minute) ? minute : 0, 0, 0);

  if (next.getTime() <= fromMs) {
    next.setDate(next.getDate() + 1);
  }

  return next.toISOString();
}

export function isAutomationTaskDue(task: AutomationTask, now = new Date().toISOString()) {
  if (task.status !== "enabled" || task.trigger.kind === "manual") {
    return false;
  }

  if (!task.nextRunAt) {
    return true;
  }

  const dueMs = Date.parse(task.nextRunAt);
  const nowMs = Date.parse(now);

  return Number.isFinite(dueMs) && Number.isFinite(nowMs) && dueMs <= nowMs;
}

export function computeAutomationSchedulerDelayMs(
  state: Pick<AutomationState, "globalPaused" | "tasks">,
  nowMs = Date.now(),
  maxDelayMs = 30_000,
) {
  if (state.globalPaused) {
    return maxDelayMs;
  }

  let nextDueMs = Number.POSITIVE_INFINITY;

  for (const task of state.tasks) {
    if (task.status !== "enabled" || task.trigger.kind === "manual" || task.trigger.kind === "app_start") {
      continue;
    }

    if (!task.nextRunAt) {
      return 1_000;
    }

    const dueMs = Date.parse(task.nextRunAt);

    if (!Number.isFinite(dueMs)) {
      return 1_000;
    }

    if (dueMs <= nowMs) {
      return 1_000;
    }

    nextDueMs = Math.min(nextDueMs, dueMs);
  }

  if (!Number.isFinite(nextDueMs)) {
    return maxDelayMs;
  }

  return Math.max(1_000, Math.min(maxDelayMs, nextDueMs - nowMs));
}

export function createAutomationRunPrompt(task: AutomationTask, options: { dryRun?: boolean; reason?: string } = {}) {
  const capabilityHints = [
    ...task.capabilityScope.capabilities
      .map((capabilityId) => CAPABILITY_MAP.get(capabilityId)?.promptHint)
      .filter(Boolean),
    ...formatMcpCapabilityHints(task.capabilityScope.mcpServers),
    ...formatSkillCapabilityHints(task.capabilityScope.skills),
  ];
  const autonomy = task.capabilityScope.autonomyLevel === "scoped"
    ? "Act autonomously only for the enabled capabilities listed below. Anything outside scope must pause for approval."
    : "Do not take mutating connected-app actions without an approval card.";

  return [
    "LOCAL SCHEDULED TASK RUN",
    `Task: ${task.title}`,
    task.description ? `Description: ${task.description}` : "",
    task.projectName ? `Project: ${task.projectName}` : "",
    `Run reason: ${options.reason ?? "manual"}`,
    options.dryRun ? "Simulation mode: do not call tools, send messages, or change external state. Explain what tools would be used." : "",
    "",
    "Goal:",
    task.prompt,
    "",
    "Model:",
    task.provider && task.model
      ? `${getModelProvider(task.provider).label} / ${task.model}`
      : "Use the user's current default chat model at run time.",
    "",
    "Enabled capabilities:",
    capabilityHints.length > 0 ? `- ${capabilityHints.join("\n- ")}` : "- No connected app tools are enabled. Use plain reasoning only.",
    "",
    "Autonomy and privacy:",
    autonomy,
    `Notification privacy: ${task.notificationPolicy.privacy}. Keep notifications under ${task.notificationPolicy.maxSummaryChars} characters.`,
    "Always write the real result for the Tasks inbox first. Desktop or Discord notifications are summaries only.",
    "",
    "Hard limits:",
    `- Max tool calls: ${task.runLimits.maxToolCalls}`,
    `- Max runtime seconds: ${task.runLimits.maxRuntimeSeconds}`,
    `- Max model loops: ${task.runLimits.maxModelLoops}`,
    "",
    "Final answer:",
    "Write only the user-facing result for the task goal. Do not restate this run prompt, limits, model, capabilities, tool policy, or hidden process. Do not include a Sources section because the app renders sources separately. Do not include empty sections such as blocked approvals when nothing was blocked. Include concise evidence only when it helps the user trust the result.",
  ].filter(Boolean).join("\n");
}

export function createAutomationUserMessageContent(task: AutomationTask, options: { dryRun?: boolean } = {}) {
  const label = options.dryRun ? "Task simulation" : "Task call";
  return [
    `${label}: ${task.title}`,
    task.prompt,
  ].filter((part) => part.trim().length > 0).join("\n\n");
}

export function createAutomationToolSelectionPrompt(task: AutomationTask) {
  const capabilityHints = [
    ...task.capabilityScope.capabilities
      .map((capabilityId) => CAPABILITY_MAP.get(capabilityId)?.promptHint)
      .filter(Boolean),
    ...formatMcpCapabilityHints(task.capabilityScope.mcpServers),
    ...formatSkillCapabilityHints(task.capabilityScope.skills),
  ];

  return [
    task.prompt,
    task.projectName ? `Project scope: ${task.projectName}` : "",
    capabilityHints.join("\n"),
    "Use only the enabled task capabilities. If a needed tool is outside the task scope, request approval instead of silently skipping it.",
  ].filter(Boolean).join("\n");
}

export function createAutomationToolScope(task: AutomationTask): ToolAutomationScope {
  const definitions = task.capabilityScope.capabilities.flatMap((capabilityId) => {
    const definition = CAPABILITY_MAP.get(capabilityId);
    return definition ? [definition] : [];
  });
  const mcpServers = task.capabilityScope.mcpServers.filter((server) => server.toolNames.length > 0);
  const allowedToolIds = [...new Set([
    ...definitions.flatMap((definition) => definition.toolIds),
    ...(mcpServers.length > 0 ? MCP_BRIDGE_TOOL_IDS : []),
  ])];
  const allowedFamilies = [...new Set([
    ...definitions.flatMap((definition) => definition.familyHints),
    ...(mcpServers.length > 0 ? ["mcp" as const] : []),
  ])];

  return {
    allowedFamilies,
    allowedMcpServers: mcpServers.map((server) => ({
      serverId: server.serverId,
      toolNames: [...server.toolNames],
    })),
    allowedToolIds,
    autonomous: task.capabilityScope.autonomyLevel === "scoped",
    maxModelLoops: task.runLimits.maxModelLoops,
    maxRuntimeSeconds: task.runLimits.maxRuntimeSeconds,
    maxToolCalls: task.runLimits.maxToolCalls,
    taskId: task.id,
    taskTitle: task.title,
  };
}

export function createAutomationRuntimeToolOverrides(task: AutomationTask): Partial<ProviderSettings["tools"]> {
  const capabilities = new Set(task.capabilityScope.capabilities);
  const overrides: Partial<ProviderSettings["tools"]> = {};

  if (task.capabilityScope.mcpServers.some((server) => server.toolNames.length > 0)) {
    overrides.mcpServers = true;
  }

  if (capabilities.has("github.read")) {
    overrides.sourceControl = true;
  }

  if (capabilities.has("web.search")) {
    overrides.webSearch = true;
  }

  return overrides;
}

export function formatAutomationNotificationSummary(task: AutomationTask, run: AutomationRun) {
  const raw = run.finalSummary?.trim() || run.error?.trim() || "Task run finished.";
  const prefix = task.notificationPolicy.privacy === "private" ? `${task.title}: run ready in Tasks.` : `${task.title}: ${raw}`;
  const maxChars = Math.max(120, Math.min(task.notificationPolicy.maxSummaryChars || 900, task.runLimits.maxNotificationChars || 900));

  return prefix.length > maxChars ? `${prefix.slice(0, maxChars - 3).trim()}...` : prefix;
}

export function filterAutomationWebSources(sources: ChatSource[] | undefined, toolCalls: ChatToolCall[] | undefined) {
  const hasWebSearch = toolCalls?.some((toolCall) => toolCall.toolId === "web_search") === true;
  return hasWebSearch && sources && sources.length > 0 ? sources : undefined;
}

export function formatAutomationInboxResult(content: string, fallback = "Task run finished.") {
  const normalized = content.replace(/\r\n?/g, "\n").trim();

  if (!normalized) {
    return fallback;
  }

  const lines = normalized.split("\n");
  const cleaned: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      pushCleanLine(cleaned, "");
      continue;
    }

    const leadingInboxResult = trimmed.match(/^tasks?\s+inbox\s+result\s*:\s*(.*)$/i);
    if (leadingInboxResult) {
      if (leadingInboxResult[1]?.trim()) {
        pushCleanLine(cleaned, leadingInboxResult[1].trim());
      }
      continue;
    }

    if (/^sources?\s*:?\s*$/i.test(trimmed) && isPlainSourceList(lines.slice(index + 1))) {
      break;
    }

    if (/^blocked approvals?\s*:?\s*$/i.test(trimmed) && isEmptySection(lines.slice(index + 1))) {
      break;
    }

    if (/^blocked approvals?\s*:\s*(?:none|no(?:ne)?\.?|nothing|not applicable|n\/a)\s*\.?$/i.test(trimmed)) {
      continue;
    }

    if (/^(?:action needed|evidence|details|summary|result)\s*:?\s*$/i.test(trimmed)) {
      continue;
    }

    pushCleanLine(cleaned, line);
  }

  const result = cleaned.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return result || fallback;
}

export function createAutomationSimulationSummary(task: AutomationTask) {
  const capabilities = task.capabilityScope.capabilities
    .map((capabilityId) => CAPABILITY_MAP.get(capabilityId)?.label ?? capabilityId)
    .join(", ");
  const mcpCapabilities = formatMcpCapabilitySummary(task.capabilityScope.mcpServers);
  const skillCapabilities = formatSkillCapabilitySummary(task.capabilityScope.skills);
  const nextRun = computeNextRunAt(task, new Date().toISOString());

  return [
    "Simulation only. No tools ran and no notifications were sent.",
    `Would run prompt: ${task.prompt}`,
    task.projectName ? `Project: ${task.projectName}.` : "",
    `Model: ${task.provider && task.model ? `${getModelProvider(task.provider).label} / ${task.model}` : "current default"}.`,
    `Enabled capabilities: ${capabilities || "none"}.`,
    mcpCapabilities ? `Installed MCP tools: ${mcpCapabilities}.` : "",
    skillCapabilities ? `Installed skills: ${skillCapabilities}.` : "",
    `Autonomy: ${task.capabilityScope.autonomyLevel}.`,
    nextRun ? `Next due time from now: ${nextRun}.` : "This task only runs manually.",
  ].filter(Boolean).join("\n");
}

export function getAutomationCapabilityDefinition(id: AutomationCapabilityId) {
  return CAPABILITY_MAP.get(id);
}

function pushCleanLine(lines: string[], line: string) {
  if (!line.trim() && (lines.length === 0 || !lines[lines.length - 1]?.trim())) {
    return;
  }

  lines.push(line);
}

function isEmptySection(lines: string[]) {
  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    if (/^(?:sources?|action needed|evidence|details|summary|result)\s*:?\s*$/i.test(trimmed)) {
      return true;
    }

    return /^(?:none|no(?:ne)?\.?|nothing|not applicable|n\/a)\s*\.?$/i.test(trimmed);
  }

  return true;
}

function isPlainSourceList(lines: string[]) {
  const entries = lines.map((line) => line.trim()).filter(Boolean);

  if (entries.length === 0) {
    return true;
  }

  return entries.every((entry) =>
    /^\d+$/.test(entry) ||
    /^details$/i.test(entry) ||
    /^https?:\/\/\S+$/i.test(entry) ||
    /^(?:www\.)?[\w-]+(?:\.[\w-]+)+(?:\/\S*)?$/i.test(entry),
  );
}

function normalizeAutomationTrigger(value: unknown): AutomationTrigger {
  const raw = typeof value === "object" && value ? (value as Partial<AutomationTrigger>) : {};

  if (raw.kind === "interval") {
    return {
      everyMinutes: normalizeInteger((raw as { everyMinutes?: unknown }).everyMinutes, 60, 5, 24 * 60),
      kind: "interval",
    };
  }

  if (raw.kind === "daily") {
    const rawTime = typeof (raw as { time?: unknown }).time === "string" ? (raw as { time: string }).time : "09:00";
    return {
      kind: "daily",
      time: /^\d{2}:\d{2}$/.test(rawTime) ? rawTime : "09:00",
    };
  }

  if (raw.kind === "app_start") {
    return { kind: "app_start" };
  }

  return { kind: "manual" };
}

function normalizeAutomationModelSelection(provider: unknown, model: unknown): { model?: string; provider?: ModelProviderId } {
  if (!isModelProviderId(provider)) {
    return {};
  }

  const normalizedModel = normalizeOptionalString(model);

  return {
    model: normalizeProviderModelId(provider, normalizedModel),
    provider,
  };
}

function normalizeNotificationPolicy(value: unknown): AutomationNotificationPolicy {
  const raw = typeof value === "object" && value ? (value as Partial<AutomationNotificationPolicy>) : {};

  return {
    desktop: typeof raw.desktop === "boolean" ? raw.desktop : DEFAULT_AUTOMATION_NOTIFICATION_POLICY.desktop,
    discord: typeof raw.discord === "boolean" ? raw.discord : DEFAULT_AUTOMATION_NOTIFICATION_POLICY.discord,
    maxSummaryChars: normalizeInteger(raw.maxSummaryChars, DEFAULT_AUTOMATION_NOTIFICATION_POLICY.maxSummaryChars, 120, 4_000),
    privacy: raw.privacy === "private" ? "private" : "summary",
    tasksInbox: true,
  };
}

function normalizeRunLimits(value: unknown): AutomationRunLimits {
  const raw = typeof value === "object" && value ? (value as Partial<AutomationRunLimits>) : {};

  return {
    maxModelLoops: normalizeInteger(raw.maxModelLoops, DEFAULT_AUTOMATION_RUN_LIMITS.maxModelLoops, 1, 20),
    maxNotificationChars: normalizeInteger(raw.maxNotificationChars, DEFAULT_AUTOMATION_RUN_LIMITS.maxNotificationChars, 120, 4_000),
    maxRuntimeSeconds: normalizeInteger(raw.maxRuntimeSeconds, DEFAULT_AUTOMATION_RUN_LIMITS.maxRuntimeSeconds, 30, 60 * 60),
    maxToolCalls: normalizeInteger(raw.maxToolCalls, DEFAULT_AUTOMATION_RUN_LIMITS.maxToolCalls, 0, 100),
  };
}

function normalizeCapabilityIds(value: unknown): AutomationCapabilityId[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.filter((candidate): candidate is AutomationCapabilityId => CAPABILITY_MAP.has(candidate as AutomationCapabilityId)))];
}

function normalizeMcpServerScopes(value: unknown): AutomationMcpServerScope[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const scopes: AutomationMcpServerScope[] = [];
  const seenServers = new Set<string>();

  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const raw = item as Partial<AutomationMcpServerScope>;
    const serverId = normalizeOptionalString(raw.serverId);

    if (!serverId || seenServers.has(serverId)) {
      continue;
    }

    const toolNames = normalizeStringList(raw.toolNames, 100);

    if (toolNames.length === 0) {
      continue;
    }

    seenServers.add(serverId);
    scopes.push({
      serverId,
      serverName: normalizeOptionalString(raw.serverName) ?? serverId,
      toolNames,
    });
  }

  return scopes.slice(0, 40);
}

function normalizeSkillScopes(value: unknown): AutomationSkillScope[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const scopes: AutomationSkillScope[] = [];
  const seenSkills = new Set<string>();

  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const raw = item as Partial<AutomationSkillScope>;
    const id = normalizeOptionalString(raw.id);

    if (!id || seenSkills.has(id)) {
      continue;
    }

    const name = normalizeOptionalString(raw.name) ?? id;
    const trigger = normalizeSkillTrigger(raw.trigger) ?? `$${id}`;

    seenSkills.add(id);
    scopes.push({ id, name, trigger });
  }

  return scopes.slice(0, 80);
}

function normalizeStringList(value: unknown, maxItems: number) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const strings: string[] = [];

  for (const item of value) {
    const normalized = normalizeOptionalString(item);

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    strings.push(normalized);

    if (strings.length >= maxItems) {
      break;
    }
  }

  return strings;
}

function formatMcpCapabilityHints(scopes: AutomationMcpServerScope[]) {
  return scopes
    .filter((scope) => scope.toolNames.length > 0)
    .map((scope) => {
      const tools = scope.toolNames.join(", ");
      return `MCP server ${scope.serverName} (serverId: ${scope.serverId}); allowed tool names: ${tools}. Use MCP tools only for these exact server/tool names.`;
    });
}

function formatMcpCapabilitySummary(scopes: AutomationMcpServerScope[]) {
  return scopes
    .filter((scope) => scope.toolNames.length > 0)
    .map((scope) => `${scope.serverName}: ${scope.toolNames.join(", ")}`)
    .join("; ");
}

function formatSkillCapabilityHints(scopes: AutomationSkillScope[]) {
  return scopes.map((scope) =>
    `Installed skill ${scope.name} (${scope.trigger}). Treat this selected skill as applicable task context and load/follow its instructions when relevant.`,
  );
}

function formatSkillCapabilitySummary(scopes: AutomationSkillScope[]) {
  return scopes
    .map((scope) => `${scope.trigger} ${scope.name}`)
    .join(", ");
}

function normalizeRunStatus(value: unknown): AutomationRun["status"] {
  if (value === "queued" || value === "running" || value === "failed" || value === "waiting_for_approval" || value === "cancelled") {
    return value;
  }

  return "completed";
}

function normalizeTitle(value: unknown) {
  const title = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return title || "Custom agent";
}

function createTitleFromPrompt(prompt: string) {
  const title = prompt.replace(/\s+/g, " ").trim();
  return title.length > 54 ? `${title.slice(0, 51).trim()}...` : title || "Custom agent";
}

function normalizeOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeSkillTrigger(value: unknown) {
  const normalized = normalizeOptionalString(value);

  if (!normalized) {
    return undefined;
  }

  return normalized.startsWith("$") ? normalized : `$${normalized.replace(/^@+/, "")}`;
}

function normalizeIsoDate(value: unknown, fallback: string) {
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) {
    return new Date(Date.parse(value)).toISOString();
  }

  return fallback;
}

function normalizeInteger(value: unknown, fallback: number, min: number, max: number) {
  const number = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.round(number)));
}

function createAutomationId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 100000)}`;
}

function isNotificationAttempt(value: unknown): value is AutomationRun["notificationAttempts"][number] {
  if (!value || typeof value !== "object") {
    return false;
  }

  const attempt = value as AutomationRun["notificationAttempts"][number];
  return typeof attempt.at === "string" && (attempt.channel === "desktop" || attempt.channel === "discord" || attempt.channel === "tasks_inbox") && typeof attempt.ok === "boolean";
}
