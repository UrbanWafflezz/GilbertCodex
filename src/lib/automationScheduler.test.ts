import { describe, expect, it } from "vitest";
import {
  createAutomationRuntimeToolOverrides,
  createAutomationSimulationSummary,
  createAutomationTaskFromDraft,
  createAutomationToolScope,
  createAutomationRunPrompt,
  createAutomationUserMessageContent,
  computeAutomationSchedulerDelayMs,
  filterAutomationWebSources,
  formatAutomationInboxResult,
  formatAutomationNotificationSummary,
  isAutomationTaskDue,
  normalizeAutomationState,
} from "./automationScheduler";
import type { AutomationRun } from "../types/automation";

describe("automationScheduler", () => {
  it("normalizes tasks and computes due interval schedules", () => {
    const state = normalizeAutomationState({
      tasks: [
        {
          id: "task-1",
          prompt: "Check Gmail",
          runCount: 0,
          status: "enabled",
          title: "Inbox",
          trigger: { everyMinutes: 30, kind: "interval" },
        },
      ],
    }, "2026-05-21T10:00:00.000Z");

    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0].nextRunAt).toBe("2026-05-21T10:30:00.000Z");
    expect(isAutomationTaskDue(state.tasks[0], "2026-05-21T10:29:59.000Z")).toBe(false);
    expect(isAutomationTaskDue(state.tasks[0], "2026-05-21T10:30:00.000Z")).toBe(true);
  });

  it("schedules the next runtime tick at the nearest due task", () => {
    const state = normalizeAutomationState({
      tasks: [
        {
          id: "task-1",
          prompt: "Soon",
          runCount: 0,
          status: "enabled",
          title: "Soon task",
          trigger: { everyMinutes: 10, kind: "interval" },
          nextRunAt: "2026-05-21T10:00:05.000Z",
        },
        {
          id: "task-2",
          prompt: "Later",
          runCount: 0,
          status: "enabled",
          title: "Later task",
          trigger: { everyMinutes: 10, kind: "interval" },
          nextRunAt: "2026-05-21T10:01:00.000Z",
        },
      ],
    }, "2026-05-21T10:00:00.000Z");

    expect(computeAutomationSchedulerDelayMs(state, Date.parse("2026-05-21T10:00:00.000Z"))).toBe(5_000);
    expect(computeAutomationSchedulerDelayMs(state, Date.parse("2026-05-21T10:00:06.000Z"))).toBe(1_000);
  });

  it("builds scoped tool allowlists from capabilities", () => {
    const task = createAutomationTaskFromDraft({
      capabilityScope: {
        autonomyLevel: "scoped",
        capabilities: ["gmail.read", "gmail.send", "web.search"],
      },
      prompt: "Read Gmail and send a summary if needed.",
      title: "Inbox monitor",
    }, "2026-05-21T10:00:00.000Z");
    const scope = createAutomationToolScope(task);

    expect(scope.autonomous).toBe(true);
    expect(scope.allowedToolIds).toContain("gmail_search_messages");
    expect(scope.allowedToolIds).toContain("gmail_send_message");
    expect(scope.allowedToolIds).toContain("web_search");
    expect(scope.maxToolCalls).toBe(task.runLimits.maxToolCalls);
  });

  it("keeps project, selected MCP tools, and installed skills in prompts and scoped tool access", () => {
    const task = createAutomationTaskFromDraft({
      capabilityScope: {
        autonomyLevel: "scoped",
        capabilities: [],
        mcpServers: [{
          serverId: "firebase",
          serverName: "Firebase",
          toolNames: ["firebase_deploy_status"],
        }],
        skills: [{
          id: "review",
          name: "Code Review",
          trigger: "$review",
        }],
      },
      projectName: "Website",
      prompt: "Check my deploy status.",
      title: "Deploy watcher",
    }, "2026-05-21T10:00:00.000Z");
    const scope = createAutomationToolScope(task);
    const runPrompt = createAutomationRunPrompt(task);

    expect(task.projectName).toBe("Website");
    expect(scope.allowedToolIds).toContain("mcp_call_tool");
    expect(scope.allowedFamilies).toContain("mcp");
    expect(scope.allowedMcpServers).toEqual([{ serverId: "firebase", toolNames: ["firebase_deploy_status"] }]);
    expect(createAutomationRuntimeToolOverrides(task).mcpServers).toBe(true);
    expect(runPrompt).toContain("Project: Website");
    expect(runPrompt).toContain("serverId: firebase");
    expect(runPrompt).toContain("firebase_deploy_status");
    expect(runPrompt).toContain("Installed skill Code Review ($review)");
  });

  it("keeps a task-specific provider and model on the normalized task", () => {
    const task = createAutomationTaskFromDraft({
      model: "gpt-5.5",
      prompt: "Run with the paid model.",
      provider: "openai",
      title: "Model override",
    }, "2026-05-21T10:00:00.000Z");

    expect(task.provider).toBe("openai");
    expect(task.model).toBe("gpt-5.5");
  });

  it("enables runtime web search only when requested by task scope", () => {
    const task = createAutomationTaskFromDraft({
      capabilityScope: {
        autonomyLevel: "scoped",
        capabilities: ["web.search"],
      },
      prompt: "Search current sources.",
      title: "Scout",
    });

    expect(createAutomationRuntimeToolOverrides(task).webSearch).toBe(true);
  });

  it("formats a short user-facing task call separately from the internal run prompt", () => {
    const task = createAutomationTaskFromDraft({
      capabilityScope: {
        autonomyLevel: "scoped",
        capabilities: ["gmail.read"],
      },
      prompt: "Give me last 2 recent emails",
      title: "Email",
    });

    const visibleMessage = createAutomationUserMessageContent(task);
    const runPrompt = createAutomationRunPrompt(task, { reason: "manual" });

    expect(visibleMessage).toBe("Task call: Email\n\nGive me last 2 recent emails");
    expect(visibleMessage).not.toContain("Enabled capabilities");
    expect(visibleMessage).not.toContain("Max tool calls");
    expect(runPrompt).toContain("LOCAL SCHEDULED TASK RUN");
    expect(runPrompt).toContain("Write only the user-facing result");
  });

  it("formats private notifications without leaking the summary", () => {
    const task = createAutomationTaskFromDraft({
      notificationPolicy: {
        privacy: "private",
      },
      prompt: "Check sensitive inbox details.",
      title: "Private inbox",
    });
    const run: AutomationRun = {
      finalSummary: "A very sensitive message from someone important needs a reply.",
      id: "run-1",
      notificationAttempts: [],
      reason: "manual",
      startedAt: "2026-05-21T10:00:00.000Z",
      status: "completed",
      taskId: task.id,
      updatedAt: "2026-05-21T10:01:00.000Z",
    };

    expect(formatAutomationNotificationSummary(task, run)).toBe("Private inbox: run ready in Tasks.");
  });

  it("removes empty automation result scaffolding before saving inbox results", () => {
    const result = formatAutomationInboxResult([
      "Tasks inbox result: Checked GitHub issues and completed issue activity for UrbanWafflezz/GilbertCodex.",
      "",
      "Action needed:",
      "",
      "No open issues are currently assigned to UrbanWafflezz.",
      "No open pull requests were found.",
      "Completed issues watched:",
      "",
      "18 completed issues found.",
      "Most recent completed issue: #26 [Bug]: Subscription request failed with HTTP 401.",
      "Closed as completed: 2026-05-22T04:58:44Z",
      "Author: oleteacher",
      "https://github.com/UrbanWafflezz/GilbertCodex/issues/26",
      "Evidence:",
      "",
      "GitHub is connected as UrbanWafflezz.",
      "Repository checked: UrbanWafflezz/GilbertCodex.",
      "Blocked approvals:",
      "",
      "None.",
      "Sources",
      "1",
      "1",
      "github.com",
      "Details",
    ].join("\n"));

    expect(result).toContain("Checked GitHub issues");
    expect(result).toContain("No open pull requests were found.");
    expect(result).toContain("Repository checked: UrbanWafflezz/GilbertCodex.");
    expect(result).not.toContain("Tasks inbox result");
    expect(result).not.toContain("Action needed");
    expect(result).not.toContain("Blocked approvals");
    expect(result).not.toContain("Sources");
  });

  it("only keeps task sources when a real web search tool ran", () => {
    const sources = [{ title: "GitHub", url: "https://github.com/UrbanWafflezz/GilbertCodex" }];

    expect(filterAutomationWebSources(sources, [{ id: "tool-1", label: "Get issue", status: "complete", toolId: "github_get_issue" }])).toBeUndefined();
    expect(filterAutomationWebSources(sources, [{ id: "tool-2", label: "Search web", status: "complete", toolId: "web_search" }])).toEqual(sources);
  });

  it("simulates without claiming tools ran", () => {
    const task = createAutomationTaskFromDraft({
      capabilityScope: {
        autonomyLevel: "review",
        capabilities: ["calendar.read"],
      },
      prompt: "Prep my calendar.",
      title: "Calendar prep",
    });

    expect(createAutomationSimulationSummary(task)).toContain("No tools ran");
    expect(createAutomationSimulationSummary(task)).toContain("Calendar read");
  });
});
