import { createId, DEFAULT_PROJECT, isNoProjectName, normalizeProjectName } from "../../lib/chatUtils";
import type { AgentApproval, AgentRun } from "../../types/agentRun";
import type { ChatArtifact, ChatMessage, ChatProgressItem, ChatSource, ChatSummary, ChatToolCall, ChatWorkTraceItem } from "../../types/chat";
import type { ProjectSummary } from "../../types/project";
import type { DiscordStreamUpdate } from "./WorkspaceApp";

const DISCORD_STREAM_MESSAGE_LIMIT = 1_850;

export function RouteLoading() {
  return (
    <div className="route-loading" role="status" aria-live="polite">
      Loading
    </div>
  );
}

export function formatDiscordStreamMessage(update: DiscordStreamUpdate, final: boolean) {
  const sections: string[] = [];
  const visibleContent = update.content?.trim();

  if (!final) {
    sections.push(update.status || "Gilbert is working...");

    if (!visibleContent && update.progress) {
      sections.push(formatDiscordProgress(update.progress));
    }

    if (update.toolCall && update.toolCall.status !== "complete") {
      sections.push(formatDiscordToolStatus(update.toolCall));
    }
  }

  if (visibleContent) {
    sections.push(visibleContent);
  } else if (final) {
    sections.push(update.status === "Error" ? "Gilbert hit an error before producing a visible answer." : "Gilbert finished, but there was no visible response text.");
  }

  if (final && update.sources?.length) {
    sections.push(formatDiscordSources(update.sources));
  }

  return limitDiscordStreamMessage(formatMarkdownForDiscord(sections.filter(Boolean).join("\n\n")));
}

export function waitForDiscordFlushSlot() {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, 80);
  });
}

export function formatDiscordProgress(progress: ChatProgressItem) {
  return progress.detail ? `${progress.label}: ${progress.detail}` : progress.label;
}

export function formatLocalToolPreviewProgress(toolCalls: ChatToolCall[]) {
  if (toolCalls.length === 0) {
    return "Preparing tool request";
  }

  const firstDetailedTool = toolCalls.find((toolCall) => toolCall.label !== "Agent tools" || toolCall.detail);
  const targets = toolCalls
    .map((toolCall) => toolCall.detail)
    .filter((detail): detail is string => Boolean(detail?.trim()))
    .slice(0, 2);
  const targetText = targets.length > 0 ? `: ${targets.join(", ")}${toolCalls.length > targets.length ? ` and ${toolCalls.length - targets.length} more` : ""}` : "";

  if (toolCalls.length === 1) {
    return firstDetailedTool ? `Preparing ${firstDetailedTool.label.toLowerCase()}${firstDetailedTool.detail ? `: ${firstDetailedTool.detail}` : ""}` : "Preparing tool request";
  }

  return `Preparing ${toolCalls.length} tool calls${targetText}`;
}

export function formatDiscordToolStatus(toolCall: ChatToolCall) {
  const status = toolCall.status === "waiting_approval" ? "waiting for approval" : toolCall.status.replace("_", " ");
  const detail = toolCall.detail || toolCall.output;

  return [`Tool ${status}: ${toolCall.label}`, detail ? detail.slice(0, 280) : ""].filter(Boolean).join("\n");
}

export function formatDiscordSources(sources: ChatSource[]) {
  const formattedSources = sources.slice(0, 3).map((source, index) => `${index + 1}. ${source.title} - ${source.url}`);

  return ["Sources:", ...formattedSources].join("\n");
}

export function limitDiscordStreamMessage(content: string) {
  const normalized = content.trim();

  if (normalized.length <= DISCORD_STREAM_MESSAGE_LIMIT) {
    return normalized;
  }

  const suffix = "\n\n[More is available in Gilbert.]";
  const limit = DISCORD_STREAM_MESSAGE_LIMIT - suffix.length - 4;
  const trimmed = closeUnclosedDiscordCodeFence(normalized.slice(0, Math.max(0, limit)).trim());

  return `${trimmed}${suffix}`;
}

export function formatMarkdownForDiscord(content: string) {
  const segments = splitMarkdownFenceSegments(content.replace(/\r\n/g, "\n"));

  return segments
    .map((segment) => (segment.code ? segment.content : formatDiscordTextMarkdown(segment.content)))
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function splitMarkdownFenceSegments(content: string) {
  const segments: Array<{ code: boolean; content: string }> = [];
  const fencePattern = /```[\s\S]*?```/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = fencePattern.exec(content))) {
    if (match.index > cursor) {
      segments.push({ code: false, content: content.slice(cursor, match.index) });
    }

    segments.push({ code: true, content: match[0] });
    cursor = match.index + match[0].length;
  }

  if (cursor < content.length) {
    segments.push({ code: false, content: content.slice(cursor) });
  }

  return segments.length > 0 ? segments : [{ code: false, content }];
}

export function formatDiscordTextMarkdown(content: string) {
  const lines = content.split("\n");
  const output: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (isMarkdownTableStart(lines, index)) {
      const { nextIndex, rendered } = renderMarkdownTableForDiscord(lines, index);
      output.push(rendered);
      index = nextIndex - 1;
      continue;
    }

    if (isMarkdownHorizontalRule(lines[index])) {
      if (output[output.length - 1]?.trim()) {
        output.push("");
      }
      continue;
    }

    output.push(lines[index]);
  }

  return output.join("\n");
}

export function isMarkdownHorizontalRule(line: string) {
  return /^(\s*)(-{3,}|\*{3,}|_{3,})(\s*)$/.test(line);
}

export function isMarkdownTableStart(lines: string[], index: number) {
  const header = lines[index]?.trim() ?? "";
  const separator = lines[index + 1]?.trim() ?? "";

  return header.includes("|") && /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(separator);
}

export function renderMarkdownTableForDiscord(lines: string[], startIndex: number) {
  const headers = parseMarkdownTableRow(lines[startIndex]);
  const rows: string[][] = [];
  let index = startIndex + 2;

  while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
    rows.push(parseMarkdownTableRow(lines[index]));
    index += 1;
  }

  const renderedRows = rows
    .map((row) => renderMarkdownTableRowForDiscord(headers, row))
    .filter(Boolean);

  return {
    nextIndex: index,
    rendered: renderedRows.length > 0 ? renderedRows.join("\n") : lines.slice(startIndex, index).join("\n"),
  };
}
export function parseMarkdownTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim().replace(/\s+/g, " "))
    .filter(Boolean);
}

export function renderMarkdownTableRowForDiscord(headers: string[], row: string[]) {
  if (headers.length <= 2 && row.length >= 2) {
    return `- **${row[0]}:** ${row[1]}`;
  }

  const cells = row
    .map((cell, index) => {
      const header = headers[index]?.trim();
      return header ? `**${header}:** ${cell}` : cell;
    })
    .filter(Boolean);

  return cells.length > 0 ? `- ${cells.join("; ")}` : "";
}

export function closeUnclosedDiscordCodeFence(content: string) {
  const fenceCount = content.match(/```/g)?.length ?? 0;

  return fenceCount % 2 === 1 ? `${content}\n\`\`\`` : content;
}

export function getChatIdFromLocationHash() {
  const hash = window.location.hash.replace(/^#/, "");
  const params = new URLSearchParams(hash);
  const chatId = params.get("chat");

  return chatId?.trim() || "";
}

export function createChatDeeplink(chatId: string) {
  const url = new URL(window.location.href);
  url.hash = `chat=${encodeURIComponent(chatId)}`;
  return url.toString();
}

export function formatChatAsMarkdown(chat: ChatSummary) {
  const sections = [
    `# ${chat.title || "New chat"}`,
    "",
    `- Session: \`${chat.id}\``,
    `- Project: ${chat.project}`,
    `- Updated: ${chat.updatedAt}`,
  ];

  if (chat.messages.length === 0) {
    sections.push("", "_No messages yet._");
    return sections.join("\n");
  }

  for (const message of chat.messages) {
    const visibleBody = message.content.trim();

    sections.push("", `## ${message.role === "assistant" ? "Assistant" : "User"} - ${message.createdAt}`, "", visibleBody || "_No visible text._");

    if (message.attachments?.length) {
      sections.push("", "Attachments:", ...message.attachments.map((attachment) => `- ${attachment.name} (${attachment.mimeType}, ${attachment.size} bytes)`));
    }

    if (message.sources?.length) {
      sections.push("", "Sources:", ...message.sources.map((source) => `- [${source.title}](${source.url})${source.detail ? ` - ${source.detail}` : ""}`));
    }
  }

  return sections.join("\n");
}

export function createForkedChat(sourceChat: ChatSummary, projectName: string, title = `Fork: ${sourceChat.title || "New chat"}`, options: { throughMessageId?: string } = {}): ChatSummary {
  const now = new Date().toISOString();
  const messageEndIndex = options.throughMessageId ? sourceChat.messages.findIndex((message) => message.id === options.throughMessageId) : -1;
  const sourceMessages = messageEndIndex >= 0 ? sourceChat.messages.slice(0, messageEndIndex + 1) : sourceChat.messages;

  return {
    ...sourceChat,
    archived: false,
    id: createId("chat"),
    isDraft: undefined,
    messages: sourceMessages.map(cloneMessageForFork),
    pinned: false,
    project: normalizeProjectName(projectName),
    title,
    updatedAt: now,
  };
}

export function cloneMessageForFork(message: ChatMessage): ChatMessage {
  return {
    ...cloneJson(message),
    agentRunId: undefined,
    agentRunStatus: undefined,
    approvals: undefined,
    id: createId("message"),
    isStreaming: undefined,
    status: message.status === "queued" ? undefined : message.status,
    toolCalls: message.toolCalls?.map(cloneToolCallForFork),
  };
}

export function cloneToolCallForFork(toolCall: ChatToolCall): ChatToolCall {
  const clonedToolCall = cloneJson(toolCall);
  const active = clonedToolCall.status === "active" || clonedToolCall.status === "waiting_approval";

  return {
    ...clonedToolCall,
    detail: active ? "Snapshot from forked chat; live tool state was not carried over." : clonedToolCall.detail,
    id: createId("tool-call"),
    status: active ? "skipped" : clonedToolCall.status,
    terminal: clonedToolCall.terminal
      ? {
          ...clonedToolCall.terminal,
          live: false,
          sessionId: undefined,
        }
      : undefined,
  };
}

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createUniqueProjectName(baseName: string, projects: ProjectSummary[]) {
  const fallbackName = createProjectBaseName(baseName);
  const existingNames = new Set(projects.map((project) => project.name.toLowerCase()));

  if (!existingNames.has(fallbackName.toLowerCase())) {
    return fallbackName;
  }

  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${fallbackName} ${index}`;

    if (!existingNames.has(candidate.toLowerCase())) {
      return candidate;
    }
  }

  return `${fallbackName} ${Date.now()}`;
}

export function createProjectBaseName(baseName: string) {
  const trimmedBaseName = baseName.trim();

  if (!trimmedBaseName) {
    return "Folder project";
  }

  return isNoProjectName(trimmedBaseName) ? `${DEFAULT_PROJECT} folder` : trimmedBaseName;
}

export function projectNameFromPath(path: string) {
  const normalized = path.trim().replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]+/).filter(Boolean);

  return parts[parts.length - 1] || "";
}

export function normalizeSelectedProjectPath(path: string) {
  const trimmed = path.trim();

  if (!trimmed) {
    return "";
  }

  if (/^[a-z]:$/i.test(trimmed)) {
    return `${trimmed}\\`;
  }

  return trimmed.replace(/[\\/]+$/, "");
}

export function looksLikeContradictedSuccessfulFileMutationAnswer(content: string, toolCalls: ChatToolCall[]) {
  const trimmed = content.trim();

  if (!trimmed || !hasSuccessfulFileMutationToolCall(toolCalls)) {
    return false;
  }

  return (
    /\bonly\s+have\s+read[-\s]?only\s+evidence\b/i.test(trimmed) ||
    /\bno\s+(?:edit|write|file|mutation|tool)\s+tool\s+result\b/i.test(trimmed) ||
    /\b(?:do\s+not|don't)\s+have\s+(?:an?\s+)?(?:edit|write|file|mutation)\s+(?:tool\s+)?result\b/i.test(trimmed) ||
    /\bif\s+you\s+want[\s\S]{0,180}\b(?:apply|make|edit|write|change)\b[\s\S]{0,80}\bnext\b/i.test(trimmed)
  );
}

export function hasSuccessfulFileMutationToolCall(toolCalls: ChatToolCall[]) {
  return toolCalls.some((toolCall) => {
    if (toolCall.status !== "complete") {
      return false;
    }

    const toolId = toolCall.toolId ?? "";
    return (
      /^files_(?:append|apply_patch|copy|create_directory|edit_many|exact_replace|insert_at_line|move|replace_range|replace_span|write|write_many)\b/i.test(toolId) ||
      (toolCall.fileChanges?.length ?? 0) > 0 ||
      toolCall.batchSummary?.operation === "edit" ||
      toolCall.batchSummary?.operation === "write" ||
      toolCall.batchFileResults?.some((result) => result.status === "ok")
    );
  });
}

export function readErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : typeof error === "string" && error.trim() ? error : fallback;
}

export function upsertToolCall(toolCalls: ChatToolCall[], nextToolCall: ChatToolCall) {
  const existingIndex = toolCalls.findIndex((toolCall) => toolCallsMatchForWorkTrace(toolCall, nextToolCall));

  if (existingIndex < 0) {
    return [...toolCalls, nextToolCall];
  }

  return toolCalls.map((toolCall, index) => (index === existingIndex ? nextToolCall : toolCall));
}

export function mergeMessageWorkTrace(previousMessage: ChatMessage, nextMessage: ChatMessage): ChatWorkTraceItem[] | undefined {
  const merged: ChatWorkTraceItem[] = [];

  function upsertTraceItem(nextItem: ChatWorkTraceItem) {
    const existingIndex = merged.findIndex((item) =>
      item.kind === "tool" && nextItem.kind === "tool"
        ? toolCallsMatchForWorkTrace(item.toolCall, nextItem.toolCall)
        : item.id === nextItem.id,
    );

    if (existingIndex < 0) {
      merged.push(nextItem);
      return;
    }

    const existingItem = merged[existingIndex];

    if (!existingItem) {
      merged.push(nextItem);
      return;
    }

    merged[existingIndex] = nextItem;
  }

  for (const traceItem of previousMessage.workTrace ?? []) {
    upsertTraceItem(traceItem);
  }

  for (const traceItem of nextMessage.workTrace ?? []) {
    upsertTraceItem(traceItem);
  }

  for (const toolCall of nextMessage.toolCalls ?? []) {
    const existingIndex = merged.findIndex((item) => item.kind === "tool" && toolCallsMatchForWorkTrace(item.toolCall, toolCall));

    if (existingIndex >= 0) {
      const existingItem = merged[existingIndex];
      merged[existingIndex] = {
        id: existingItem?.id ?? `work-tool-${toolCall.id}`,
        kind: "tool",
        toolCall,
      };
      continue;
    }

    merged.push({
      id: `work-tool-${toolCall.id}`,
      kind: "tool",
      toolCall,
    });
  }

  return merged.length > 0 ? merged : undefined;
}

export function toolCallsMatchForWorkTrace(left: ChatToolCall, right: ChatToolCall) {
  if (left.id === right.id) {
    return true;
  }

  const leftIdentity = getToolCallInputIdentity(left);
  const rightIdentity = getToolCallInputIdentity(right);

  return Boolean(leftIdentity && rightIdentity && leftIdentity === rightIdentity);
}

export function getToolCallInputIdentity(toolCall: ChatToolCall) {
  const input = toolCall.input?.trim() ?? "";

  if (!input || input === "{}" || input === "[]") {
    return "";
  }

  const toolKey = `${toolCall.toolId ?? ""}|${toolCall.label}`.toLowerCase();
  return `${toolKey}|${input}`;
}

export function mergeAgentApprovals(currentApprovals: AgentApproval[], nextApprovals: AgentApproval[]) {
  if (nextApprovals.length === 0) {
    return currentApprovals;
  }

  const mergedApprovals = [...currentApprovals];

  for (const nextApproval of nextApprovals) {
    const existingIndex = mergedApprovals.findIndex((approval) => approval.id === nextApproval.id);

    if (existingIndex >= 0) {
      mergedApprovals[existingIndex] = {
        ...mergedApprovals[existingIndex],
        ...nextApproval,
      };
    } else {
      mergedApprovals.push(nextApproval);
    }
  }

  return mergedApprovals;
}

export function mergeChatArtifacts(currentArtifacts: ChatArtifact[] | undefined, nextArtifacts: ChatArtifact[] | undefined) {
  if (!nextArtifacts?.length) {
    return currentArtifacts;
  }

  const mergedArtifacts = [...(currentArtifacts ?? [])];

  for (const nextArtifact of nextArtifacts) {
    const existingIndex = mergedArtifacts.findIndex((artifact) =>
      nextArtifact.id
        ? artifact.id === nextArtifact.id
        : artifact.title === nextArtifact.title && artifact.url === nextArtifact.url,
    );

    if (existingIndex >= 0) {
      mergedArtifacts[existingIndex] = {
        ...mergedArtifacts[existingIndex],
        ...nextArtifact,
      };
    } else {
      mergedArtifacts.push(nextArtifact);
    }
  }

  return mergedArtifacts;
}

export function recoverInterruptedAgentRun(run: AgentRun, now: string): AgentRun {
  if (run.status !== "running" && run.status !== "queued") {
    return run;
  }

  return {
    ...run,
    events: [
      ...run.events,
      {
        at: now,
        detail: "The app restarted before this run finished. Pending approvals are recoverable, but in-flight model/tool work was stopped.",
        id: `agent-event-${now}`,
        label: "Recovered after restart",
        type: "recovery",
      },
    ],
    lastError: "Stopped when the app restarted.",
    status: "failed",
    steps: run.steps.map((step) =>
      step.status === "running" || step.status === "queued"
        ? {
            ...step,
            completedAt: step.completedAt ?? now,
            detail: "Stopped when the app restarted.",
            status: "failed",
          }
        : step,
    ),
    updatedAt: now,
  };
}
