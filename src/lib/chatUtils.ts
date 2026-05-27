import type { ChatAttachment, ChatComposerDraft, ChatMessage, ChatSummary } from "../types/chat";

export const DEFAULT_PROJECT = "No project";

export function isNoProjectName(project?: string | null) {
  const normalized = project?.trim().toLowerCase();

  return !normalized || normalized === DEFAULT_PROJECT.toLowerCase();
}

export function normalizeProjectName(project?: string | null) {
  const trimmed = project?.trim();

  return isNoProjectName(trimmed) ? DEFAULT_PROJECT : trimmed || DEFAULT_PROJECT;
}

export function createId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 100000)}`;
}

export function createEmptyChat(project = DEFAULT_PROJECT): ChatSummary {
  const now = new Date().toISOString();

  return {
    id: createId("chat"),
    isDraft: true,
    messages: [],
    project: normalizeProjectName(project),
    title: "New chat",
    updatedAt: now,
  };
}

export function isEmptyChat(chat: Pick<ChatSummary, "messages"> & Pick<Partial<ChatSummary>, "messagesLoaded">) {
  if (chat.messagesLoaded === false) {
    return false;
  }

  return chat.messages.length === 0;
}

export function hasComposerDraftContent(draft?: ChatComposerDraft | null): draft is ChatComposerDraft {
  return Boolean(draft && (draft.content.trim() || draft.attachments.length > 0));
}

export function isDiscardableEmptyChat(chat: Pick<ChatSummary, "composerDraft" | "messages"> & Pick<Partial<ChatSummary>, "messagesClearedAt" | "messagesLoaded">) {
  return isEmptyChat(chat) && !hasComposerDraftContent(chat.composerDraft) && !chat.messagesClearedAt;
}

export function isPlainResearchChat(chat: Pick<ChatSummary, "archived" | "id" | "messages" | "project">, activeChatId?: string) {
  return chat.id !== activeChatId && isNoProjectName(chat.project) && !chat.archived && !isEmptyChat(chat);
}

export function createMessage(
  role: ChatMessage["role"],
  content: string,
  status?: ChatMessage["status"],
  reasoning?: string,
  attachments?: ChatAttachment[],
): ChatMessage {
  return {
    attachments: attachments && attachments.length > 0 ? attachments : undefined,
    content,
    createdAt: new Date().toISOString(),
    id: createId("message"),
    reasoning: reasoning?.trim() || undefined,
    role,
    status,
  };
}

export function titleFromMessage(content: string, attachments: ChatAttachment[] = []) {
  const normalized = content
    .replace(/```[\s\S]*?```/g, " code ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    const firstAttachment = attachments[0];

    if (firstAttachment?.kind === "image") {
      return firstAttachment.name ? `Image: ${firstAttachment.name}` : "Image upload";
    }

    if (firstAttachment?.kind === "video") {
      return firstAttachment.name ? `Video: ${firstAttachment.name}` : "Video upload";
    }

    if (firstAttachment) {
      return firstAttachment.name ? `File: ${firstAttachment.name}` : "File upload";
    }

    return "New chat";
  }

  return normalized.length > 54 ? `${normalized.slice(0, 51).trim()}...` : normalized;
}

export function sortChatsByUpdatedAt(chats: ChatSummary[]) {
  return [...chats].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

export function formatChatAge(updatedAt: string) {
  const timestamp = Date.parse(updatedAt);

  if (Number.isNaN(timestamp)) {
    return "";
  }

  const diffMs = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(diffMs / 60000);

  if (minutes < 1) {
    return "now";
  }

  if (minutes < 60) {
    return `${minutes} ${minutes === 1 ? "min" : "mins"} ago`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours} ${hours === 1 ? "hr" : "hrs"} ago`;
  }

  const days = Math.floor(hours / 24);

  if (days < 7) {
    return `${days} ${days === 1 ? "day" : "days"} ago`;
  }

  const weeks = Math.floor(days / 7);

  if (weeks < 5) {
    return `${weeks} ${weeks === 1 ? "week" : "weeks"} ago`;
  }

  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(timestamp));
}
