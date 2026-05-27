import type { ChatMessage, ChatSummary, ChatToolCall } from "../types/chat";
import type { ComputerFileIndexSummary, LocalWorkspaceSettings } from "../types/localWorkspace";
import {
  CHAT_MEMORY_STORAGE_PREFIX,
  PROJECT_MEMORY_STORAGE_PREFIX,
  type CreateDurableMemoryScopeOptions,
  type DurableChatMemoryState,
  type DurableMemoryEvent,
  type DurableMemoryEventKind,
  type DurableMemoryFromChatOptions,
  type DurableMemoryPersistResult,
  type DurableMemoryRecord,
  type DurableMemoryRecordSource,
  type DurableMemoryScope,
  type DurableMemoryUpdateOptions,
  type DurableProjectFileMap,
  type DurableProjectMemoryState,
  type MemoryStorageAdapter,
  type ProjectFileMapEntry,
} from "./types";
import { createMemoryContentHash, createMemoryEmbedding, stableHash } from "./embedding";

const MEMORY_CHUNK_SIZE = 2_200;
const MEMORY_CHUNK_OVERLAP = 180;
const MAX_SUMMARY_CHARS = 260;

interface BuiltMemoryEvent {
  content: string;
  event: DurableMemoryEvent;
  source: DurableMemoryRecordSource;
}

export function createDurableMemoryScope(options: CreateDurableMemoryScopeOptions): DurableMemoryScope {
  const projectName = normalizeMemoryName(options.projectName, "General");
  const workspaceRoots = normalizeWorkspaceRoots(options.workspaceRoots ?? []);
  const projectIdentity = workspaceRoots.length > 0
    ? `roots:${workspaceRoots.map((root) => root.toLowerCase()).join("|")}`
    : `project:${projectName.toLowerCase()}`;
  const projectKey = stableHash(projectIdentity);
  const chatTitle = options.chatTitle ? normalizeMemoryName(options.chatTitle, "New chat") : undefined;
  const label = workspaceRoots.length > 0 ? workspaceRoots.join(" | ") : projectName;

  return {
    chatId: options.chatId?.trim() || undefined,
    chatTitle,
    label,
    projectKey,
    projectName,
    workspaceRoots,
  };
}

export function createDurableMemoryScopeFromChat(chat: ChatSummary, workspaceSettings: LocalWorkspaceSettings) {
  return createDurableMemoryScope({
    chatId: chat.id,
    chatTitle: chat.title,
    projectName: chat.project,
    workspaceRoots: workspaceSettings.enabled ? workspaceSettings.roots : [],
  });
}

export function createDurableProjectMemoryScope(projectName: string, workspaceSettings: LocalWorkspaceSettings) {
  return createDurableMemoryScope({
    projectName,
    workspaceRoots: workspaceSettings.enabled ? workspaceSettings.roots : [],
  });
}

export function chatMemoryStorageKey(scope: DurableMemoryScope) {
  const chatKey = scope.chatId ? stableHash(scope.chatId) : "no-chat";
  return `${CHAT_MEMORY_STORAGE_PREFIX}${chatKey}`;
}

export function projectMemoryStorageKey(scope: DurableMemoryScope) {
  return `${PROJECT_MEMORY_STORAGE_PREFIX}${scope.projectKey}`;
}

export function loadDurableChatMemoryState(scope: DurableMemoryScope, storage: MemoryStorageAdapter): DurableChatMemoryState {
  const now = new Date().toISOString();
  const fallback = createEmptyChatMemoryState(scope, now);

  if (!scope.chatId) {
    return fallback;
  }

  const rawValue = storage.read(chatMemoryStorageKey(scope));

  if (!rawValue) {
    return fallback;
  }

  try {
    return normalizeChatMemoryState(JSON.parse(rawValue), scope, now);
  } catch {
    return fallback;
  }
}

export function saveDurableChatMemoryState(state: DurableChatMemoryState, storage: MemoryStorageAdapter) {
  const scope = createDurableMemoryScope({
    chatId: state.chatId,
    chatTitle: state.chatTitle,
    projectName: state.projectName,
    workspaceRoots: state.workspaceRoots,
  });

  storage.write(chatMemoryStorageKey(scope), JSON.stringify(normalizeChatMemoryState(state, scope)));
}

export function loadDurableProjectMemoryState(scope: DurableMemoryScope, storage: MemoryStorageAdapter): DurableProjectMemoryState {
  const now = new Date().toISOString();
  const fallback = createEmptyProjectMemoryState(scope, now);
  const rawValue = storage.read(projectMemoryStorageKey(scope));

  if (!rawValue) {
    return fallback;
  }

  try {
    return normalizeProjectMemoryState(JSON.parse(rawValue), scope, now);
  } catch {
    return fallback;
  }
}

export function saveDurableProjectMemoryState(state: DurableProjectMemoryState, storage: MemoryStorageAdapter) {
  const scope = createDurableMemoryScope({
    projectName: state.projectName,
    workspaceRoots: state.workspaceRoots,
  });

  storage.write(projectMemoryStorageKey(scope), JSON.stringify(normalizeProjectMemoryState(state, scope)));
}

export function persistDurableMemoryFromChat(
  options: DurableMemoryFromChatOptions & { storage: MemoryStorageAdapter },
): DurableMemoryPersistResult {
  const scope = createDurableMemoryScopeFromChat(options.chat, options.workspaceSettings);
  const chatState = loadDurableChatMemoryState(scope, options.storage);
  const projectState = loadDurableProjectMemoryState(scope, options.storage);
  const nextChatState = updateDurableChatMemoryFromChat(chatState, options);
  const nextProjectState = updateDurableProjectMemoryFromChat(projectState, options);
  const chatChanged = nextChatState !== chatState;
  const projectChanged = nextProjectState !== projectState;

  if (chatChanged) {
    saveDurableChatMemoryState(nextChatState, options.storage);
  }
  if (projectChanged) {
    saveDurableProjectMemoryState(nextProjectState, options.storage);
  }

  return {
    chatChanged,
    chatState: nextChatState,
    projectChanged,
    projectState: nextProjectState,
  };
}

export function updateDurableChatMemoryFromChat(
  state: DurableChatMemoryState,
  options: DurableMemoryFromChatOptions,
): DurableChatMemoryState {
  const scope = createDurableMemoryScopeFromChat(options.chat, options.workspaceSettings);
  const builtEvents = buildMemoryEventsFromChat(options.chat, scope, options.now);
  const nextState = {
    ...state,
    chatTitle: options.chat.title || state.chatTitle || "New chat",
    projectKey: scope.projectKey,
    projectName: scope.projectName,
    workspaceRoots: scope.workspaceRoots,
  };

  return mergeBuiltMemoryEventsIntoChatState(nextState, builtEvents, options.now ?? new Date().toISOString());
}

export function updateDurableProjectMemoryFromChat(
  state: DurableProjectMemoryState,
  options: DurableMemoryFromChatOptions,
): DurableProjectMemoryState {
  const scope = createDurableMemoryScopeFromChat(options.chat, options.workspaceSettings);
  const builtEvents = buildMemoryEventsFromChat(options.chat, scope, options.now);
  const mergedState = mergeBuiltMemoryEventsIntoProjectState({
    ...state,
    projectKey: scope.projectKey,
    projectName: scope.projectName,
    workspaceRoots: scope.workspaceRoots,
  }, builtEvents, options.now ?? new Date().toISOString());

  return updateDurableProjectMemoryMap(mergedState, {
    indexSummary: options.indexSummary ?? options.workspaceSettings.indexSummary,
    now: options.now,
    workspaceSettings: options.workspaceSettings,
  }, builtEvents);
}

export function updateDurableProjectMemoryMap(
  state: DurableProjectMemoryState,
  options: DurableMemoryUpdateOptions & { workspaceSettings: LocalWorkspaceSettings },
  builtEvents: BuiltMemoryEvent[] = [],
): DurableProjectMemoryState {
  const now = options.now ?? new Date().toISOString();
  const roots = options.workspaceSettings.enabled ? normalizeWorkspaceRoots(options.workspaceSettings.roots) : [];
  const knownFiles = mergeKnownFileEntries(
    state.fileMap.knownFiles,
    [
      ...roots.map((root) => ({
        firstSeenAt: now,
        kind: "directory" as const,
        lastSeenAt: now,
        path: root,
        source: "root" as const,
      })),
      ...extractProjectFileMapEntries(builtEvents, now),
    ],
  );
  const nextFileMap: DurableProjectFileMap = {
    capturedAt: options.indexSummary ? now : state.fileMap.capturedAt,
    indexSummary: normalizeIndexSummary(options.indexSummary ?? state.fileMap.indexSummary),
    knownFiles,
    roots,
    updatedAt: now,
  };

  if (
    sameStringArray(state.fileMap.roots, nextFileMap.roots) &&
    JSON.stringify(state.fileMap.indexSummary ?? null) === JSON.stringify(nextFileMap.indexSummary ?? null) &&
    JSON.stringify(state.fileMap.knownFiles) === JSON.stringify(nextFileMap.knownFiles)
  ) {
    return state;
  }

  return {
    ...state,
    fileMap: nextFileMap,
    updatedAt: now,
    workspaceRoots: roots,
  };
}

export function createChatMemoryFingerprint(chat: ChatSummary, workspaceSettings: LocalWorkspaceSettings) {
  return createMemoryContentHash(JSON.stringify({
    archived: chat.archived,
    id: chat.id,
    messages: chat.messages.map((message) => ({
      agentRunStatus: message.agentRunStatus,
      approvals: message.approvals,
      artifacts: message.artifacts,
      content: message.content,
      contextCompactions: message.contextCompactions,
      id: message.id,
      isStreaming: message.isStreaming,
      planning: message.planning,
      progress: message.progress,
      role: message.role,
      sources: message.sources,
      status: message.status,
      toolCalls: message.toolCalls,
      webSearch: message.webSearch,
      workTrace: message.workTrace,
    })),
    project: chat.project,
    roots: workspaceSettings.enabled ? workspaceSettings.roots : [],
    title: chat.title,
    updatedAt: chat.updatedAt,
  }));
}

function createEmptyChatMemoryState(scope: DurableMemoryScope, now: string): DurableChatMemoryState {
  return {
    chatId: scope.chatId ?? "unknown-chat",
    chatTitle: scope.chatTitle ?? "New chat",
    createdAt: now,
    events: [],
    projectKey: scope.projectKey,
    projectName: scope.projectName,
    records: [],
    updatedAt: now,
    version: 1,
    workspaceRoots: scope.workspaceRoots,
  };
}

function createEmptyProjectMemoryState(scope: DurableMemoryScope, now: string): DurableProjectMemoryState {
  return {
    createdAt: now,
    events: [],
    fileMap: {
      knownFiles: [],
      roots: scope.workspaceRoots,
      updatedAt: now,
    },
    projectKey: scope.projectKey,
    projectName: scope.projectName,
    records: [],
    updatedAt: now,
    version: 1,
    workspaceRoots: scope.workspaceRoots,
  };
}

function buildMemoryEventsFromChat(chat: ChatSummary, scope: DurableMemoryScope, now = new Date().toISOString()): BuiltMemoryEvent[] {
  const builtEvents: BuiltMemoryEvent[] = [];

  for (const message of chat.messages) {
    const messageEvent = buildMessageMemoryEvent(chat, message, scope, now);

    if (messageEvent) {
      builtEvents.push(messageEvent);
    }

    for (const toolCall of message.toolCalls ?? []) {
      const toolEvent = buildToolMemoryEvent(chat, message, toolCall, scope, now);

      if (toolEvent) {
        builtEvents.push(toolEvent);
      }
    }
  }

  return builtEvents;
}

function buildMessageMemoryEvent(
  chat: ChatSummary,
  message: ChatMessage,
  scope: DurableMemoryScope,
  now: string,
): BuiltMemoryEvent | null {
  const content = sanitizeMemoryText([
    `${message.role.toUpperCase()} MESSAGE`,
    message.content,
    message.planning ? `Planning metadata: pass ${message.planning.passCount}/${message.planning.maxPasses}; started=${message.planning.startedAt}; completed=${message.planning.completedAt ?? "not completed"}` : "",
    formatProgress(message),
    formatSources(message),
    formatArtifacts(message),
    formatApprovals(message),
  ].filter(Boolean).join("\n"));

  if (!content.trim()) {
    return null;
  }

  const event = createMemoryEvent({
    chat,
    content,
    id: `chat:${chat.id}:message:${message.id}`,
    kind: message.role === "assistant" ? "assistant-message" : "user-message",
    message,
    now,
    scope,
    status: message.status ?? (message.isStreaming ? "streaming" : "saved"),
    summary: createSummary(content),
  });

  return {
    content,
    event,
    source: message.role === "assistant" ? "assistant" : "user",
  };
}

function buildToolMemoryEvent(
  chat: ChatSummary,
  message: ChatMessage,
  toolCall: ChatToolCall,
  scope: DurableMemoryScope,
  now: string,
): BuiltMemoryEvent | null {
  const content = sanitizeMemoryText([
    "TOOL CALL",
    `Tool: ${toolCall.toolId ?? toolCall.label}`,
    `Label: ${toolCall.label}`,
    `Status: ${toolCall.status}`,
    toolCall.detail ? `Detail: ${toolCall.detail}` : "",
    toolCall.input ? `Input: ${toolCall.input}` : "",
    toolCall.output ? `Output: ${toolCall.output}` : "",
    toolCall.terminal ? formatTerminal(toolCall) : "",
    formatFileChanges(toolCall),
    formatBatchResults(toolCall),
  ].filter(Boolean).join("\n"));

  if (!content.trim()) {
    return null;
  }

  const kind: DurableMemoryEventKind = toolCall.status === "error" || toolCall.status === "skipped" ? "tool-error" : "tool-call";
  const event = createMemoryEvent({
    chat,
    content,
    id: `chat:${chat.id}:message:${message.id}:tool:${toolCall.id}`,
    kind,
    message,
    now,
    scope,
    status: toolCall.status,
    summary: createSummary(content),
    toolCall,
  });

  return {
    content,
    event,
    source: kind === "tool-error" ? "tool-error" : "tool",
  };
}

function createMemoryEvent(options: {
  chat: ChatSummary;
  content: string;
  id: string;
  kind: DurableMemoryEventKind;
  message: ChatMessage;
  now: string;
  scope: DurableMemoryScope;
  status?: string;
  summary: string;
  toolCall?: ChatToolCall;
}): DurableMemoryEvent {
  return {
    chatId: options.chat.id,
    chatTitle: options.chat.title || "New chat",
    contentHash: createMemoryContentHash(options.content),
    createdAt: normalizeDateText(options.message.createdAt, options.now),
    id: options.id,
    kind: options.kind,
    messageId: options.message.id,
    metadata: {
      mode: options.message.mode,
      source: options.message.source?.kind,
      toolId: options.toolCall?.toolId,
      toolLabel: options.toolCall?.label,
    },
    projectKey: options.scope.projectKey,
    projectName: options.scope.projectName,
    role: options.message.role,
    status: options.status,
    summary: options.summary,
    toolCallId: options.toolCall?.id,
    updatedAt: options.chat.updatedAt || options.now,
  };
}

function mergeBuiltMemoryEventsIntoChatState(
  state: DurableChatMemoryState,
  builtEvents: BuiltMemoryEvent[],
  now: string,
): DurableChatMemoryState {
  const next = mergeBuiltEvents(state.events, state.records, builtEvents);

  if (
    next.events === state.events &&
    next.records === state.records &&
    state.updatedAt === now
  ) {
    return state;
  }

  return {
    ...state,
    events: next.events,
    records: next.records,
    updatedAt: now,
  };
}

function mergeBuiltMemoryEventsIntoProjectState(
  state: DurableProjectMemoryState,
  builtEvents: BuiltMemoryEvent[],
  now: string,
): DurableProjectMemoryState {
  const next = mergeBuiltEvents(state.events, state.records, builtEvents);

  if (
    next.events === state.events &&
    next.records === state.records &&
    state.updatedAt === now
  ) {
    return state;
  }

  return {
    ...state,
    events: next.events,
    records: next.records,
    updatedAt: now,
  };
}

function mergeBuiltEvents(
  existingEvents: DurableMemoryEvent[],
  existingRecords: DurableMemoryRecord[],
  builtEvents: BuiltMemoryEvent[],
) {
  if (builtEvents.length === 0) {
    return {
      events: existingEvents,
      records: existingRecords,
    };
  }

  const eventIds = new Set(builtEvents.map((item) => item.event.id));
  const eventMap = new Map(existingEvents.map((event) => [event.id, event]));
  let changed = false;

  for (const item of builtEvents) {
    const existing = eventMap.get(item.event.id);

    if (JSON.stringify(existing ?? null) !== JSON.stringify(item.event)) {
      eventMap.set(item.event.id, item.event);
      changed = true;
    }
  }

  const filteredRecords = existingRecords.filter((record) => !eventIds.has(record.eventId));
  const nextRecordsForEvents = builtEvents.flatMap((item) => createRecordsForEvent(item));
  const records = [...filteredRecords, ...nextRecordsForEvents].sort(compareMemoryRecords);

  if (filteredRecords.length !== existingRecords.length || nextRecordsForEvents.length > 0) {
    changed = true;
  }

  if (!changed) {
    return {
      events: existingEvents,
      records: existingRecords,
    };
  }

  return {
    events: [...eventMap.values()].sort(compareMemoryEvents),
    records,
  };
}

function createRecordsForEvent(item: BuiltMemoryEvent): DurableMemoryRecord[] {
  const chunks = chunkMemoryContent(item.content);

  return chunks.map((chunk, index) => {
    const chunkId = `${item.event.id}:chunk:${index}`;
    const contentHash = createMemoryContentHash(chunk);

    return {
      chatId: item.event.chatId,
      chatTitle: item.event.chatTitle,
      chunkId,
      content: chunk,
      contentHash,
      createdAt: item.event.createdAt,
      eventId: item.event.id,
      id: `${chunkId}:${contentHash}`,
      metadata: item.event.metadata,
      projectKey: item.event.projectKey,
      projectName: item.event.projectName,
      source: item.source,
      summary: item.event.summary,
      updatedAt: item.event.updatedAt,
      vector: createMemoryEmbedding(`${item.event.summary}\n${chunk}`),
    };
  });
}

function chunkMemoryContent(content: string) {
  const normalized = content.trim();

  if (!normalized) {
    return [];
  }

  if (normalized.length <= MEMORY_CHUNK_SIZE) {
    return [normalized];
  }

  const chunks: string[] = [];
  let offset = 0;

  while (offset < normalized.length) {
    const end = Math.min(normalized.length, offset + MEMORY_CHUNK_SIZE);
    chunks.push(normalized.slice(offset, end).trim());

    if (end >= normalized.length) {
      break;
    }

    offset = Math.max(0, end - MEMORY_CHUNK_OVERLAP);
  }

  return chunks.filter(Boolean);
}

function extractProjectFileMapEntries(builtEvents: BuiltMemoryEvent[], now: string): ProjectFileMapEntry[] {
  const entries: ProjectFileMapEntry[] = [];

  for (const item of builtEvents) {
    if (item.event.kind !== "tool-call" && item.event.kind !== "tool-error") {
      continue;
    }

    const paths = extractPathHints(item.content);

    for (const path of paths) {
      entries.push({
        firstSeenAt: now,
        kind: inferPathKind(path),
        lastSeenAt: now,
        path,
        source: "tool",
        toolIds: item.event.toolCallId ? [item.event.toolCallId] : undefined,
      });
    }
  }

  return entries;
}

function mergeKnownFileEntries(existingEntries: ProjectFileMapEntry[], nextEntries: ProjectFileMapEntry[]) {
  const map = new Map(existingEntries.map((entry) => [normalizePathKey(entry.path), entry]));

  for (const entry of nextEntries) {
    const key = normalizePathKey(entry.path);
    const existing = map.get(key);

    if (!existing) {
      map.set(key, entry);
      continue;
    }

    map.set(key, {
      ...existing,
      kind: entry.kind ?? existing.kind,
      lastSeenAt: latestDateText(existing.lastSeenAt, entry.lastSeenAt),
      modifiedAt: entry.modifiedAt ?? existing.modifiedAt,
      size: entry.size ?? existing.size,
      source: existing.source === "tool" ? existing.source : entry.source,
      toolIds: mergeStringArrays(existing.toolIds ?? [], entry.toolIds ?? []),
    });
  }

  return [...map.values()].sort((left, right) => Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt) || left.path.localeCompare(right.path));
}

function extractPathHints(text: string) {
  const paths = new Set<string>();
  const absoluteWindowsPath = /\b[A-Za-z]:[\\/][^\s"'<>|]+/g;
  const relativeProjectPath = /\b(?:src|docs|app|components|pages|lib|tests|scripts|public|src-tauri|\.gilbert)[\\/][A-Za-z0-9._@()/\\-]+/g;

  for (const pattern of [absoluteWindowsPath, relativeProjectPath]) {
    for (const match of text.matchAll(pattern)) {
      const value = normalizePathHint(match[0]);

      if (value) {
        paths.add(value);
      }
    }
  }

  return [...paths];
}

function normalizePathHint(value: string) {
  return value
    .replace(/[),.;:]+$/g, "")
    .replace(/[\\/]+$/g, "")
    .trim();
}

function inferPathKind(path: string) {
  return /\.[A-Za-z0-9]{1,12}$/.test(path) ? "file" as const : "directory" as const;
}

function normalizeChatMemoryState(value: unknown, scope: DurableMemoryScope, now = new Date().toISOString()): DurableChatMemoryState {
  const record = isRecord(value) ? value as Partial<DurableChatMemoryState> : {};

  return {
    chatId: scope.chatId ?? normalizeText(record.chatId, "unknown-chat"),
    chatTitle: scope.chatTitle ?? normalizeText(record.chatTitle, "New chat"),
    createdAt: normalizeDateText(record.createdAt, now),
    events: normalizeMemoryEvents(record.events, scope),
    projectKey: scope.projectKey,
    projectName: scope.projectName,
    records: normalizeMemoryRecords(record.records, scope),
    updatedAt: normalizeDateText(record.updatedAt, now),
    version: 1,
    workspaceRoots: scope.workspaceRoots,
  };
}

function normalizeProjectMemoryState(value: unknown, scope: DurableMemoryScope, now = new Date().toISOString()): DurableProjectMemoryState {
  const record = isRecord(value) ? value as Partial<DurableProjectMemoryState> : {};

  return {
    createdAt: normalizeDateText(record.createdAt, now),
    events: normalizeMemoryEvents(record.events, scope),
    fileMap: normalizeProjectFileMap(record.fileMap, scope, now),
    projectKey: scope.projectKey,
    projectName: scope.projectName,
    records: normalizeMemoryRecords(record.records, scope),
    updatedAt: normalizeDateText(record.updatedAt, now),
    version: 1,
    workspaceRoots: scope.workspaceRoots,
  };
}

function normalizeMemoryEvents(value: unknown, scope: DurableMemoryScope) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    const id = normalizeText(item.id, "");
    const kind = normalizeEventKind(item.kind);
    const contentHash = normalizeText(item.contentHash, "");
    const summary = normalizeText(item.summary, "");
    const now = new Date().toISOString();

    if (!id || !kind || !contentHash || !summary) {
      return [];
    }

    return [{
      chatId: normalizeOptionalText(item.chatId),
      chatTitle: normalizeOptionalText(item.chatTitle),
      contentHash,
      createdAt: normalizeDateText(item.createdAt, now),
      id,
      kind,
      messageId: normalizeOptionalText(item.messageId),
      metadata: isRecord(item.metadata) ? item.metadata : undefined,
      projectKey: scope.projectKey,
      projectName: scope.projectName,
      role: item.role === "assistant" || item.role === "user" ? item.role : undefined,
      status: normalizeOptionalText(item.status),
      summary,
      toolCallId: normalizeOptionalText(item.toolCallId),
      updatedAt: normalizeDateText(item.updatedAt, now),
    } satisfies DurableMemoryEvent];
  }).sort(compareMemoryEvents);
}

function normalizeMemoryRecords(value: unknown, scope: DurableMemoryScope) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    const id = normalizeText(item.id, "");
    const chunkId = normalizeText(item.chunkId, "");
    const eventId = normalizeText(item.eventId, "");
    const content = normalizeText(item.content, "");
    const contentHash = normalizeText(item.contentHash, "");
    const summary = normalizeText(item.summary, "");
    const source = normalizeRecordSource(item.source);
    const now = new Date().toISOString();

    if (!id || !chunkId || !eventId || !content || !contentHash || !summary || !source) {
      return [];
    }

    return [{
      chatId: normalizeOptionalText(item.chatId),
      chatTitle: normalizeOptionalText(item.chatTitle),
      chunkId,
      content,
      contentHash,
      createdAt: normalizeDateText(item.createdAt, now),
      eventId,
      id,
      metadata: isRecord(item.metadata) ? item.metadata : undefined,
      projectKey: scope.projectKey,
      projectName: scope.projectName,
      source,
      summary,
      updatedAt: normalizeDateText(item.updatedAt, now),
      vector: createMemoryEmbedding(`${summary}\n${content}`),
    } satisfies DurableMemoryRecord];
  }).sort(compareMemoryRecords);
}

function normalizeProjectFileMap(value: unknown, scope: DurableMemoryScope, now: string): DurableProjectFileMap {
  const record = isRecord(value) ? value as Partial<DurableProjectFileMap> : {};

  return {
    capturedAt: normalizeOptionalText(record.capturedAt),
    indexSummary: normalizeIndexSummary(record.indexSummary),
    knownFiles: normalizeFileMapEntries(record.knownFiles),
    roots: scope.workspaceRoots,
    updatedAt: normalizeDateText(record.updatedAt, now),
  };
}

function normalizeFileMapEntries(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    const path = normalizeText(item.path, "");
    const now = new Date().toISOString();

    if (!path) {
      return [];
    }

    return [{
      firstSeenAt: normalizeDateText(item.firstSeenAt, now),
      kind: item.kind === "directory" || item.kind === "file" || item.kind === "other" || item.kind === "symlink" ? item.kind : undefined,
      lastSeenAt: normalizeDateText(item.lastSeenAt, now),
      modifiedAt: normalizeNumber(item.modifiedAt),
      path,
      size: normalizeNumber(item.size),
      source: item.source === "index" || item.source === "root" || item.source === "tool" ? item.source : "tool",
      toolIds: Array.isArray(item.toolIds) ? item.toolIds.filter((id): id is string => typeof id === "string" && Boolean(id.trim())) : undefined,
    } satisfies ProjectFileMapEntry];
  }).sort((left, right) => Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt) || left.path.localeCompare(right.path));
}

function normalizeIndexSummary(value: unknown): ComputerFileIndexSummary | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    builtAt: normalizeNumber(value.builtAt),
    entryCount: normalizeInteger(value.entryCount, 0),
    ignoredEntries: normalizeInteger(value.ignoredEntries, 0),
    roots: Array.isArray(value.roots) ? value.roots.filter((root): root is string => typeof root === "string" && Boolean(root.trim())) : [],
    scannedDirectories: normalizeInteger(value.scannedDirectories, 0),
    skippedEntries: normalizeInteger(value.skippedEntries, 0),
    truncated: Boolean(value.truncated),
  };
}

function normalizeEventKind(value: unknown): DurableMemoryEventKind | undefined {
  return value === "assistant-message" ||
    value === "project-map" ||
    value === "tool-call" ||
    value === "tool-error" ||
    value === "user-message"
    ? value
    : undefined;
}

function normalizeRecordSource(value: unknown): DurableMemoryRecordSource | undefined {
  return value === "assistant" ||
    value === "project-map" ||
    value === "tool" ||
    value === "tool-error" ||
    value === "user"
    ? value
    : undefined;
}

function formatProgress(message: ChatMessage) {
  const progressItems = (message.progress ?? []).filter((item) => item.id !== "context-compaction");

  return progressItems.length
    ? `Progress: ${progressItems.map((item) => `${item.status} ${item.label}${item.detail ? ` - ${item.detail}` : ""}`).join("; ")}`
    : "";
}

function formatSources(message: ChatMessage) {
  return message.sources?.length
    ? `Sources: ${message.sources.map((source) => `${source.title} <${source.url}>`).join("; ")}`
    : "";
}

function formatArtifacts(message: ChatMessage) {
  return message.artifacts?.length
    ? `Artifacts: ${message.artifacts.map((artifact) => `${artifact.title}${artifact.url ? ` <${artifact.url}>` : ""}`).join("; ")}`
    : "";
}

function formatApprovals(message: ChatMessage) {
  return message.approvals?.length
    ? `Approvals: ${message.approvals.map((approval) => `${approval.status} ${approval.tool}`).join("; ")}`
    : "";
}

function formatTerminal(toolCall: ChatToolCall) {
  const terminal = toolCall.terminal;

  if (!terminal) {
    return "";
  }

  return [
    terminal.command ? `Command: ${terminal.command}` : "",
    terminal.workingDirectory ? `Working directory: ${terminal.workingDirectory}` : "",
    terminal.exitCode !== undefined ? `Exit code: ${terminal.exitCode}` : "",
    terminal.timedOut ? "Timed out: true" : "",
    terminal.outputTruncated ? "Output truncated: true" : "",
  ].filter(Boolean).join("\n");
}

function formatFileChanges(toolCall: ChatToolCall) {
  return toolCall.fileChanges?.length
    ? `File changes: ${toolCall.fileChanges.map((change) => `${change.kind ?? "update"} ${change.path} (+${change.additions}/-${change.deletions})`).join("; ")}`
    : "";
}

function formatBatchResults(toolCall: ChatToolCall) {
  return toolCall.batchFileResults?.length
    ? `Batch file results: ${toolCall.batchFileResults.map((result) => `${result.status} ${result.path}${result.detail ? ` - ${result.detail}` : ""}`).join("; ")}`
    : "";
}

export function sanitizeMemoryText(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "<email>")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|xox[baprs]-[A-Za-z0-9-]{16,})\b/g, "<secret>")
    .replace(/\b[A-Za-z0-9+/]{100,}={0,2}\b/g, "<long-token>")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function createSummary(content: string) {
  const cleaned = content.replace(/\s+/g, " ").trim();
  return cleaned.length > MAX_SUMMARY_CHARS ? `${cleaned.slice(0, MAX_SUMMARY_CHARS - 1).trim()}...` : cleaned;
}

function normalizeMemoryName(value: string, fallback: string) {
  return value.replace(/\s+/g, " ").trim() || fallback;
}

function normalizeWorkspaceRoots(roots: string[]) {
  const seen = new Set<string>();
  const normalizedRoots: string[] = [];

  for (const root of roots) {
    const normalized = root.trim().replace(/[\\/]+$/, "");

    if (!normalized || seen.has(normalized.toLowerCase())) {
      continue;
    }

    seen.add(normalized.toLowerCase());
    normalizedRoots.push(normalized);
  }

  return normalizedRoots.sort((left, right) => left.localeCompare(right));
}

function normalizeText(value: unknown, fallback: string) {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

function normalizeOptionalText(value: unknown) {
  const normalized = normalizeText(value, "");
  return normalized || undefined;
}

function normalizeDateText(value: unknown, fallback: string) {
  if (typeof value !== "string" || !value.trim()) {
    return fallback;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? value : fallback;
}

function normalizeInteger(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : fallback;
}

function normalizeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function compareMemoryEvents(left: DurableMemoryEvent, right: DurableMemoryEvent) {
  return Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.id.localeCompare(right.id);
}

function compareMemoryRecords(left: DurableMemoryRecord, right: DurableMemoryRecord) {
  return Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.id.localeCompare(right.id);
}

function sameStringArray(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function mergeStringArrays(left: string[], right: string[]) {
  return Array.from(new Set([...left, ...right].filter(Boolean))).sort();
}

function latestDateText(left: string, right: string) {
  return Date.parse(right) > Date.parse(left) ? right : left;
}

function normalizePathKey(path: string) {
  return path.trim().replace(/[\\/]+$/, "").toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
