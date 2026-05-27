import type { AuthSession } from "../types/auth";
import type { ChatArtifact, ChatAttachment, ChatMessage, ChatProgressItem, ChatSource, ChatSummary } from "../types/chat";
import type { LocalPermissionMode, LocalWorkspaceScope, LocalWorkspaceSettings } from "../types/localWorkspace";
import type { AppAppearanceSettings, AppGeneralSettings, AppPersonalizationSettings, AppearanceMode, ModelProviderId, ProviderSettings, ReasoningEffort, WebSearchProvider } from "../types/settings";
import type { ProjectSummary } from "../types/project";

const SYNC_KIND = "gilbert-codex-mobile-sync";
const SYNC_VERSION = 1;
const MOBILE_NO_PROJECT_NAME = "No project";

export interface SyncTombstone {
  deletedAtMillis: number;
  id: string;
}

export interface DesktopMobileSyncInput {
  activeChatId: string;
  appearanceMode: AppearanceMode;
  appearanceSettings: AppAppearanceSettings;
  automationSkillRegistry: unknown;
  automationState: unknown;
  chats: ChatSummary[];
  deletedChatIds?: SyncTombstone[];
  deletedProjectNames?: SyncTombstone[];
  discordBridgeSettings: unknown;
  generalSettings: AppGeneralSettings;
  localWorkspace: LocalWorkspaceSettings;
  personalizationSettings: AppPersonalizationSettings;
  projects: ProjectSummary[];
  providerSettings: ProviderSettings;
  session: AuthSession;
}

export interface DesktopMobileSyncMergeInput {
  activeChatId: string;
  chats: ChatSummary[];
  generalSettings: AppGeneralSettings;
  localWorkspace: LocalWorkspaceSettings;
  projects: ProjectSummary[];
  providerSettings: ProviderSettings;
}

export interface DesktopMobileSyncMergeResult {
  activeChatId: string;
  changed: boolean;
  chats: ChatSummary[];
  generalSettings: AppGeneralSettings;
  localWorkspace: LocalWorkspaceSettings;
  projects: ProjectSummary[];
  providerSettings: ProviderSettings;
}

export function createDesktopMobileSyncPayload(input: DesktopMobileSyncInput) {
  const updatedAt = new Date().toISOString();

  return {
    kind: SYNC_KIND,
    source: "desktop",
    version: SYNC_VERSION,
    updatedAt,
    accountSession: {
      createdAt: input.session.createdAt,
      sessionToken: input.session.sessionToken,
      user: input.session.user,
    },
    workspace: {
      selectedChatId: input.activeChatId || null,
      projectNames: input.projects.map((project) => project.name),
      deletedChatIds: mergeTombstones(
        input.deletedChatIds ?? [],
        input.chats
          .filter((chat) => chat.archived)
          .map((chat) => ({ deletedAtMillis: Date.parse(chat.updatedAt) || Date.now(), id: chat.id })),
      ),
      deletedProjectNames: input.deletedProjectNames ?? [],
      chats: input.chats.filter((chat) => !chat.archived).map(desktopChatToMobileChat),
    },
    settings: {
      generalSettings: input.generalSettings,
      localWorkspace: input.localWorkspace,
      providerSettings: input.providerSettings,
      mobileSnapshot: desktopSettingsToMobileSnapshot(input.providerSettings, input.generalSettings, input.localWorkspace),
      appearanceMode: input.appearanceMode,
      appearanceSettings: input.appearanceSettings,
      personalizationSettings: input.personalizationSettings,
      discordBridgeSettings: input.discordBridgeSettings,
    },
    extras: {
      automationSkillRegistry: input.automationSkillRegistry,
      automationState: input.automationState,
      plugins: input.providerSettings.tools,
    },
  };
}

export function mergeMobilePayloadIntoDesktopState(input: DesktopMobileSyncMergeInput, envelope: unknown): DesktopMobileSyncMergeResult {
  const payload = unwrapMobilePayload(envelope);
  if (!payload || payload.source !== "mobile") {
    return { ...input, changed: false };
  }

  const workspace = asRecord(payload.workspace);
  const deletedChatIds = arrayOfRecords(workspace?.deletedChatIds).map(recordToTombstone).filter(Boolean) as SyncTombstone[];
  const deletedProjectNames = arrayOfRecords(workspace?.deletedProjectNames).map(recordToTombstone).filter(Boolean) as SyncTombstone[];
  const deletedChatIdSet = new Set(deletedChatIds.map((item) => item.id));
  const deletedProjectNameSet = new Set(deletedProjectNames.map((item) => item.id.toLowerCase()));
  const mobileChats = arrayOfRecords(workspace?.chats)
    .map(mobileChatToDesktopChat)
    .filter((chat): chat is ChatSummary => Boolean(chat))
    .filter((chat) => !deletedChatIdSet.has(chat.id) && !deletedProjectNameSet.has(chat.project.toLowerCase())) as ChatSummary[];
  const currentChats = deletedChatIdSet.size > 0 || deletedProjectNameSet.size > 0
    ? input.chats.filter((chat) => !deletedChatIdSet.has(chat.id) && !deletedProjectNameSet.has(chat.project.toLowerCase()))
    : input.chats;
  const nextChats = mergeChats(currentChats, mobileChats);
  const nextProjects = mergeProjects(input.projects, workspace?.projectNames, mobileChats, deletedProjectNameSet);
  const mobileSettings = payload.desktopBaselineApplied === true ? asRecord(payload.settingsSnapshot) ?? asRecord(payload.settings) : null;
  const nextProviderSettings = mergeProviderSettings(input.providerSettings, mobileSettings);
  const nextLocalWorkspace = mergeLocalWorkspace(input.localWorkspace, mobileSettings);
  const nextGeneralSettings = mergeGeneralSettings(input.generalSettings, mobileSettings);
  const selectedChatId = stringOrNull(workspace?.selectedChatId);
  const currentActiveAvailable = Boolean(input.activeChatId)
    && !deletedChatIdSet.has(input.activeChatId)
    && nextChats.some((chat) => chat.id === input.activeChatId);
  const nextActiveChatId = currentActiveAvailable
    ? input.activeChatId
    : selectedChatId && nextChats.some((chat) => chat.id === selectedChatId)
      ? selectedChatId
      : nextChats.find((chat) => !chat.archived)?.id ?? nextChats[0]?.id ?? input.activeChatId;
  const changed =
    nextChats !== input.chats ||
    nextProjects !== input.projects ||
    nextProviderSettings !== input.providerSettings ||
    nextLocalWorkspace !== input.localWorkspace ||
    nextGeneralSettings !== input.generalSettings ||
    nextActiveChatId !== input.activeChatId;

  return {
    activeChatId: nextActiveChatId,
    changed,
    chats: nextChats,
    generalSettings: nextGeneralSettings,
    localWorkspace: nextLocalWorkspace,
    projects: nextProjects,
    providerSettings: nextProviderSettings,
  };
}

function desktopChatToMobileChat(chat: ChatSummary) {
  const updatedAtMillis = Date.parse(chat.updatedAt) || Date.now();
  const createdAtMillis = chat.messages.map((message) => Date.parse(message.createdAt)).filter(Number.isFinite).sort((a, b) => a - b)[0] ?? updatedAtMillis;

  return {
    id: chat.id,
    title: chat.title,
    project: chat.project || MOBILE_NO_PROJECT_NAME,
    age: "Now",
    createdAtMillis,
    messagesClearedAtMillis: Date.parse(chat.messagesClearedAt ?? "") || 0,
    updatedAtMillis,
    pinned: Boolean(chat.pinned),
    activity: chat.messages.some((message) => message.isStreaming) ? "working" : null,
    messages: chat.messages.map(desktopMessageToMobileMessage),
  };
}

function desktopMessageToMobileMessage(message: ChatMessage) {
  return {
    id: message.id,
    role: message.role === "assistant" ? "Assistant" : "User",
    content: message.content,
    createdAt: message.createdAt,
    status: message.status ?? null,
    workedFor: formatWorkedFor(message),
    workTrace: (message.progress ?? []).map(progressToMobileWorkTrace),
    isStreaming: Boolean(message.isStreaming),
    feedback: message.feedback === "liked" ? "Liked" : message.feedback === "disliked" ? "Disliked" : null,
    attachments: (message.attachments ?? []).map(attachmentToMobileAttachment),
    artifacts: message.artifacts ?? [],
    reasoning: message.reasoning ?? null,
    sources: message.sources ?? [],
  };
}

function mobileChatToDesktopChat(chat: Record<string, unknown>): ChatSummary | null {
  const id = stringOrNull(chat.id);
  if (!id) {
    return null;
  }

  const updatedAt = millisToIso(numberOrNull(chat.updatedAtMillis)) ?? new Date().toISOString();
  return {
    id,
    messages: arrayOfRecords(chat.messages).map(mobileMessageToDesktopMessage).filter(Boolean) as ChatMessage[],
    messagesClearedAt: millisToIso(numberOrNull(chat.messagesClearedAtMillis)) ?? undefined,
    messagesLoaded: true,
    pinned: Boolean(chat.pinned),
    project: stringOrNull(chat.project) || MOBILE_NO_PROJECT_NAME,
    title: stringOrNull(chat.title) || "New chat",
    updatedAt,
  };
}

function mobileMessageToDesktopMessage(message: Record<string, unknown>): ChatMessage | null {
  const id = stringOrNull(message.id);
  if (!id) {
    return null;
  }

  return {
    id,
    role: message.role === "Assistant" ? "assistant" : "user",
    content: stringOrNull(message.content) ?? "",
    createdAt: stringOrNull(message.createdAt) ?? new Date().toISOString(),
    status: message.status === "error" || message.status === "queued" ? message.status : undefined,
    feedback: message.feedback === "Liked" ? "liked" : message.feedback === "Disliked" ? "disliked" : undefined,
    isStreaming: false,
    attachments: arrayOfRecords(message.attachments).map(mobileAttachmentToDesktopAttachment),
    artifacts: arrayOfRecords(message.artifacts).map(mobileArtifactToDesktopArtifact),
    reasoning: stringOrNull(message.reasoning) ?? undefined,
    sources: arrayOfRecords(message.sources).map(mobileSourceToDesktopSource),
  };
}

function mergeChats(current: ChatSummary[], incoming: ChatSummary[]) {
  if (incoming.length === 0) {
    return current;
  }

  let changed = false;
  const byId = new Map(current.map((chat) => [chat.id, chat]));
  for (const mobileChat of incoming) {
    const existing = byId.get(mobileChat.id);
    if (!existing) {
      byId.set(mobileChat.id, mobileChat);
      changed = true;
      continue;
    }

    const mergedChat = mergeChat(existing, mobileChat);
    if (JSON.stringify(existing) !== JSON.stringify(mergedChat)) {
      byId.set(mobileChat.id, mergedChat);
      changed = true;
    }
  }

  if (!changed) {
    return current;
  }

  return [...byId.values()].sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
}

function mergeChat(existing: ChatSummary, incoming: ChatSummary): ChatSummary {
  const incomingTime = Date.parse(incoming.updatedAt) || 0;
  const existingTime = Date.parse(existing.updatedAt) || 0;
  const incomingIsNewer = incomingTime >= existingTime;
  const messagesClearedAt = latestIso(existing.messagesClearedAt, incoming.messagesClearedAt);
  const messagesClearedAtMillis = Date.parse(messagesClearedAt ?? "") || 0;
  const messages = mergeMessages(
    filterMessagesAfterClear(existing.messages, messagesClearedAtMillis),
    filterMessagesAfterClear(incoming.messages, messagesClearedAtMillis),
  );

  return {
    ...existing,
    ...(incomingIsNewer ? incoming : {}),
    archived: existing.archived,
    composerDraft: existing.composerDraft,
    messages,
    messagesClearedAt,
    messagesLoaded: existing.messagesLoaded !== false || incoming.messagesLoaded !== false,
    model: existing.model,
    pinned: Boolean(existing.pinned || incoming.pinned),
    provider: existing.provider,
    toolRuntimeVersion: existing.toolRuntimeVersion,
    updatedAt: new Date(Math.max(existingTime, incomingTime, messagesClearedAtMillis, latestMessageMillis(messages))).toISOString(),
  };
}

function latestIso(left: string | undefined, right: string | undefined) {
  const leftTime = Date.parse(left ?? "") || 0;
  const rightTime = Date.parse(right ?? "") || 0;
  const latest = Math.max(leftTime, rightTime);
  return latest > 0 ? new Date(latest).toISOString() : undefined;
}

function filterMessagesAfterClear(messages: ChatMessage[], messagesClearedAtMillis: number) {
  if (messagesClearedAtMillis <= 0) {
    return messages;
  }

  return messages.filter((message) => (Date.parse(message.createdAt) || 0) > messagesClearedAtMillis);
}

function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]) {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) {
    const existing = byId.get(message.id);
    byId.set(message.id, existing ? chooseMessageVersion(existing, message) : message);
  }

  return [...byId.values()].sort((left, right) => (Date.parse(left.createdAt) || 0) - (Date.parse(right.createdAt) || 0));
}

function chooseMessageVersion(existing: ChatMessage, incoming: ChatMessage) {
  if (JSON.stringify(existing) === JSON.stringify(incoming)) {
    return existing;
  }

  if (existing.isStreaming && !incoming.isStreaming && incoming.content.trim()) {
    return { ...existing, ...incoming };
  }

  if (incoming.isStreaming && !existing.isStreaming && existing.content.trim() && existing.content.length >= incoming.content.length) {
    return existing;
  }

  const existingScore = messageCompletenessScore(existing);
  const incomingScore = messageCompletenessScore(incoming);
  return incomingScore >= existingScore ? { ...existing, ...incoming } : existing;
}

function messageCompletenessScore(message: ChatMessage) {
  return (
    message.content.length +
    (message.reasoning?.length ?? 0) +
    (message.artifacts?.length ?? 0) * 400 +
    (message.sources?.length ?? 0) * 100 +
    (message.attachments?.length ?? 0) * 100 +
    (message.feedback ? 20 : 0) +
    (message.isStreaming ? 1 : 40)
  );
}

function latestMessageMillis(messages: ChatMessage[]) {
  return messages.reduce((latest, message) => Math.max(latest, Date.parse(message.createdAt) || 0), 0);
}

function mergeProjects(current: ProjectSummary[], incomingNames: unknown, incomingChats: ChatSummary[], deletedProjectNameSet = new Set<string>()) {
  const names = new Set<string>();
  if (Array.isArray(incomingNames)) {
    for (const name of incomingNames) {
      const normalized = stringOrNull(name)?.trim();
      if (normalized && normalized !== MOBILE_NO_PROJECT_NAME && !deletedProjectNameSet.has(normalized.toLowerCase())) {
        names.add(normalized);
      }
    }
  }
  for (const chat of incomingChats) {
    if (chat.project && chat.project !== MOBILE_NO_PROJECT_NAME && !deletedProjectNameSet.has(chat.project.toLowerCase())) {
      names.add(chat.project);
    }
  }

  const existing = new Map(
    current
      .filter((project) => !deletedProjectNameSet.has(project.name.toLowerCase()))
      .map((project) => [project.name.toLowerCase(), project]),
  );
  let changed = false;
  if (existing.size !== current.length) {
    changed = true;
  }
  for (const name of names) {
    if (!existing.has(name.toLowerCase())) {
      const now = new Date().toISOString();
      existing.set(name.toLowerCase(), {
        createdAt: now,
        id: `mobile-${slugify(name)}-${Date.now()}`,
        name,
        updatedAt: now,
      });
      changed = true;
    }
  }

  if (!changed) {
    return current;
  }

  return [...existing.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function mergeProviderSettings(current: ProviderSettings, mobileSettings: Record<string, unknown> | null | undefined): ProviderSettings {
  if (!mobileSettings) {
    return current;
  }

  const provider = providerIdForMobileLabel(stringOrNull(mobileSettings.provider));
  const model = stringOrNull(mobileSettings.model) ?? current.model;
  const webProvider = webProviderForMobileLabel(stringOrNull(mobileSettings.searchProvider)) ?? current.webSearch.provider;
  const next: ProviderSettings = {
    ...current,
    maxTokens: sliderToMaxTokens(numberOrNull(mobileSettings.maxOutputCap), current.maxTokens),
    model,
    provider,
    providerModels: {
      ...current.providerModels,
      [provider]: model,
    },
    systemPrompt: stringOrNull(mobileSettings.systemPrompt) ?? current.systemPrompt,
    thinking: {
      enabled: true,
      effort: thinkingEffortFromSlider(numberOrNull(mobileSettings.thinkingEffort)) ?? current.thinking.effort,
    },
    webSearch: {
      ...current.webSearch,
      enabled: booleanOrNull(mobileSettings.webEnabled) ?? current.webSearch.enabled,
      maxResults: Math.max(1, Math.min(6, Math.round((numberOrNull(mobileSettings.maxSources) ?? 1) * 6))),
      provider: webProvider,
    },
  };

  return JSON.stringify(next) === JSON.stringify(current) ? current : next;
}

function mergeLocalWorkspace(current: LocalWorkspaceSettings, mobileSettings: Record<string, unknown> | null | undefined): LocalWorkspaceSettings {
  if (!mobileSettings) {
    return current;
  }

  const permissionMode = localPermissionModeForMobile(stringOrNull(mobileSettings.permissionMode)) ?? current.permissionMode;
  const scope = localWorkspaceScopeForMobile(stringOrNull(mobileSettings.workspaceScope)) ?? current.scope;
  const next: LocalWorkspaceSettings = {
    ...current,
    enabled: true,
    permissionMode,
    scope,
  };

  return JSON.stringify(next) === JSON.stringify(current) ? current : next;
}

function mergeGeneralSettings(current: AppGeneralSettings, mobileSettings: Record<string, unknown> | null | undefined): AppGeneralSettings {
  if (!mobileSettings) {
    return current;
  }

  const next: AppGeneralSettings = {
    ...current,
    defaultProjectlessChat: booleanOrNull(mobileSettings.projectlessNewChats) ?? current.defaultProjectlessChat,
    requireCtrlEnterForLongPrompts: booleanOrNull(mobileSettings.requireHoldToSendLongPrompts) ?? current.requireCtrlEnterForLongPrompts,
  };

  return JSON.stringify(next) === JSON.stringify(current) ? current : next;
}

function desktopSettingsToMobileSnapshot(providerSettings: ProviderSettings, generalSettings: AppGeneralSettings, localWorkspace: LocalWorkspaceSettings) {
  return {
    provider: mobileProviderLabel(providerSettings.provider),
    model: providerSettings.model,
    thinkingEffort: providerSettings.thinking.effort === "high" ? 1 : providerSettings.thinking.effort === "low" ? 0 : 0.5,
    maxOutputCap: providerSettings.maxTokens >= 16_384 ? 1 : providerSettings.maxTokens <= 2_048 ? 0 : 0.55,
    systemPrompt: providerSettings.systemPrompt,
    codexContext: providerSettings.subscriptionOptimization.codexContextWindow === "extended" ? "1M" : "262k",
    permissionMode: mobilePermissionMode(localWorkspace.permissionMode),
    workspaceScope: mobileWorkspaceScope(localWorkspace.scope),
    projectlessNewChats: generalSettings.defaultProjectlessChat,
    requireHoldToSendLongPrompts: generalSettings.requireCtrlEnterForLongPrompts,
    webEnabled: providerSettings.webSearch.enabled,
    searchProvider: providerSettings.webSearch.provider === "brave" ? "Brave" : "DuckDuckGo",
    maxSources: Math.max(0.17, Math.min(1, providerSettings.webSearch.maxResults / 6)),
  };
}

function progressToMobileWorkTrace(progress: ChatProgressItem) {
  return {
    id: progress.id ?? `progress-${progress.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    label: progress.label,
    detail: progress.detail ?? null,
    status: progress.status === "active" ? "Active" : "Complete",
    tone: "Evidence",
  };
}

function attachmentToMobileAttachment(attachment: ChatAttachment) {
  return {
    id: attachment.id,
    name: attachment.name,
    detail: `${Math.round(attachment.size / 1024)} KB`,
    kind: attachment.kind,
    mimeType: attachment.mimeType,
    dataUrl: attachment.dataUrl,
    sizeBytes: attachment.size,
  };
}

function mobileAttachmentToDesktopAttachment(attachment: Record<string, unknown>): ChatAttachment {
  const dataUrl = stringOrNull(attachment.dataUrl);
  const kind = stringOrNull(attachment.kind);
  const mimeType = stringOrNull(attachment.mimeType) ?? readDataUrlMimeType(dataUrl) ?? "application/octet-stream";
  const size = Math.max(0, Math.round(numberOrNull(attachment.sizeBytes) ?? numberOrNull(attachment.size) ?? estimateDataUrlBytes(dataUrl) ?? 0));
  const base = {
    createdAt: new Date().toISOString(),
    id: stringOrNull(attachment.id) ?? `attachment-${Date.now()}`,
    mimeType,
    name: stringOrNull(attachment.name) ?? "Attachment",
    size,
  };

  if ((kind === "image" || mimeType.startsWith("image/")) && dataUrl?.startsWith("data:image/")) {
    return {
      ...base,
      dataUrl,
      kind: "image",
    };
  }

  if ((kind === "video" || mimeType.startsWith("video/")) && dataUrl?.startsWith("data:video/")) {
    return {
      ...base,
      dataUrl,
      kind: "video",
    };
  }

  if (dataUrl?.startsWith("data:")) {
    return {
      ...base,
      dataUrl,
      kind: "file",
    };
  }

  return {
    ...base,
    kind: "file",
  };
}

function mobileArtifactToDesktopArtifact(artifact: Record<string, unknown>): ChatArtifact {
  return {
    detail: stringOrNull(artifact.detail) ?? undefined,
    height: numberOrNull(artifact.height) ?? undefined,
    id: stringOrNull(artifact.id) ?? undefined,
    kind: stringOrNull(artifact.kind) === "image" ? "image" : "file",
    mimeType: stringOrNull(artifact.mimeType) ?? undefined,
    sizeBytes: numberOrNull(artifact.sizeBytes) ?? undefined,
    title: stringOrNull(artifact.title) ?? "Generated image",
    url: stringOrNull(artifact.url) ?? undefined,
    width: numberOrNull(artifact.width) ?? undefined,
  };
}

function mobileSourceToDesktopSource(source: Record<string, unknown>): ChatSource {
  return {
    detail: stringOrNull(source.detail) ?? undefined,
    id: stringOrNull(source.id) ?? undefined,
    title: stringOrNull(source.title) ?? "Web source",
    url: stringOrNull(source.url) ?? "",
  };
}

function readDataUrlMimeType(dataUrl: string | null | undefined) {
  return dataUrl?.match(/^data:([^;,]+)[;,]/i)?.[1];
}

function estimateDataUrlBytes(dataUrl: string | null | undefined) {
  if (!dataUrl) {
    return null;
  }
  const base64 = dataUrl.includes(",") ? dataUrl.split(",").pop() ?? "" : dataUrl;
  return Math.max(0, Math.round((base64.length * 3) / 4));
}

function formatWorkedFor(message: ChatMessage) {
  const totalMs = message.streamTiming?.totalMs;
  if (!totalMs) {
    return undefined;
  }
  return `Worked for ${Math.max(1, Math.round(totalMs / 1000))}s`;
}

function unwrapMobilePayload(envelope: unknown) {
  const record = asRecord(envelope);
  const payload = asRecord(record?.payload);
  return asRecord(payload?.payload) ?? payload ?? record;
}

function mergeTombstones(left: SyncTombstone[], right: SyncTombstone[]) {
  const byId = new Map<string, SyncTombstone>();
  for (const item of [...left, ...right]) {
    if (!item.id) continue;
    const existing = byId.get(item.id);
    if (!existing || item.deletedAtMillis > existing.deletedAtMillis) {
      byId.set(item.id, item);
    }
  }
  return [...byId.values()];
}

function recordToTombstone(record: Record<string, unknown>): SyncTombstone | null {
  const id = stringOrNull(record.id);
  if (!id) {
    return null;
  }

  return {
    deletedAtMillis: numberOrNull(record.deletedAtMillis) ?? Date.now(),
    id,
  };
}

function arrayOfRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord).filter(Boolean) as Record<string, unknown>[] : [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function millisToIso(value: number | null) {
  return value && Number.isFinite(value) ? new Date(value).toISOString() : null;
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "project";
}

function providerIdForMobileLabel(label: string | null): ModelProviderId {
  const normalized = label?.toLowerCase() ?? "";
  if (normalized.includes("openai")) return "openai";
  if (normalized.includes("openrouter")) return "openrouter";
  if (normalized.includes("anthropic")) return "anthropic";
  if (normalized.includes("deepseek")) return "deepseek";
  if (normalized.includes("google")) return "google";
  if (normalized.includes("groq")) return "groq";
  if (normalized.includes("mistral")) return "mistral";
  if (normalized.includes("xai")) return "xai";
  return "9router";
}

function webProviderForMobileLabel(label: string | null): WebSearchProvider | null {
  const normalized = label?.toLowerCase() ?? "";
  if (normalized.includes("brave")) return "brave";
  if (normalized.includes("duck")) return "duckduckgo";
  return null;
}

function thinkingEffortFromSlider(value: number | null): ReasoningEffort | null {
  if (value === null) return null;
  if (value < 0.34) return "low";
  if (value < 0.67) return "medium";
  return "high";
}

function sliderToMaxTokens(value: number | null, fallback: number) {
  if (value === null) return fallback;
  if (value < 0.25) return 2048;
  if (value < 0.75) return 8192;
  return 16384;
}

function localPermissionModeForMobile(value: string | null): LocalPermissionMode | null {
  if (value === "FullAccess") return "full-access";
  if (value === "AutoReview") return "auto-review";
  if (value === "Default") return "default";
  return null;
}

function localWorkspaceScopeForMobile(value: string | null): LocalWorkspaceScope | null {
  if (value === "Device") return "full-computer";
  if (value === "CurrentProject") return "current-folder";
  if (value === "Workspace") return "selected-folder";
  return null;
}

function mobileProviderLabel(provider: ModelProviderId) {
  if (provider === "9router") return "Subscriptions";
  if (provider === "openai") return "OpenAI";
  if (provider === "openrouter") return "OpenRouter";
  if (provider === "anthropic") return "Anthropic";
  if (provider === "deepseek") return "DeepSeek";
  if (provider === "google") return "Google";
  if (provider === "groq") return "Groq";
  if (provider === "mistral") return "Mistral";
  if (provider === "xai") return "xAI";
  return provider;
}

function mobilePermissionMode(mode: LocalPermissionMode) {
  if (mode === "full-access") return "FullAccess";
  if (mode === "auto-review") return "AutoReview";
  return "Default";
}

function mobileWorkspaceScope(scope: LocalWorkspaceScope) {
  if (scope === "full-computer") return "Device";
  if (scope === "current-folder") return "CurrentProject";
  return "Workspace";
}
