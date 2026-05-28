import { invoke } from "@tauri-apps/api/core";
import { loadGoogleOAuthSettings } from "../lib/appStorage";
import { GMAIL_CORE_OAUTH_SCOPES } from "../lib/googleOAuthScopes";
import {
  cloudConnectorApi,
  disconnectCloudConnector,
  getCloudConnectorAccount,
  isCloudConnectorEnabled,
  startCloudConnectorOAuth,
  waitForCloudConnectorOAuth,
} from "../services/cloudConnectorClient";
import { isTauriDesktopRuntime, openExternalUrl } from "./tauriClient";
import type {
  GmailActionResponse,
  GmailAccountEmailRequest,
  GmailApiRequest,
  GmailApiResponse,
  GmailBatchActionResponse,
  GmailBatchModifyMessagesRequest,
  GmailConnectionState,
  GmailCreateDraftRequest,
  GmailCreateLabelRequest,
  GmailDeleteDraftRequest,
  GmailDraftResponse,
  GmailGetMessageRequest,
  GmailGetThreadRequest,
  GmailLabel,
  GmailLabelsResponse,
  GmailAttachmentSummary,
  GmailListMessagesRequest,
  GmailMessageSummary,
  GmailMessageDetail,
  GmailMessageIdRequest,
  GmailMessageListResponse,
  GmailModifyMessageLabelsRequest,
  GmailSendMessageRequest,
  GmailSendSeparateMessagesRequest,
  GmailSendSeparateMessagesResponse,
  GmailSendDraftRequest,
  GmailThreadDetail,
} from "../types/gmail";

export { GMAIL_CORE_OAUTH_SCOPES };

const DEFAULT_GMAIL_OAUTH_SCOPE = GMAIL_CORE_OAUTH_SCOPES.join(" ");

export interface GmailConnectOAuthRequest {
  clientId: string;
  clientSecret?: string;
  scope?: string;
}

export function gmailDesktopAvailable() {
  return googleCloudAvailable() || isTauriDesktopRuntime();
}

export function googleCloudAvailable() {
  return isCloudConnectorEnabled("google");
}

export function getDefaultGoogleOAuthClientId() {
  return loadGoogleOAuthSettings().clientId;
}

export function getDefaultGoogleOAuthClientSecret() {
  return loadGoogleOAuthSettings().clientSecret;
}

export function getDefaultGmailOAuthScope() {
  return DEFAULT_GMAIL_OAUTH_SCOPE;
}

export async function getGmailState(): Promise<GmailConnectionState> {
  if (googleCloudAvailable()) {
    return normalizeCloudGoogleConnection(await getCloudConnectorAccount<GmailConnectionState>("google"));
  }

  assertGmailDesktop();
  return invoke<GmailConnectionState>("gmail_get_state");
}

export async function installGmailPlugin(): Promise<GmailConnectionState> {
  if (googleCloudAvailable()) {
    const state = await getGmailState();
    return state.connected ? state : { ...state, pluginInstalled: true, pluginInstalledAt: Date.now() };
  }

  assertGmailDesktop();
  return invoke<GmailConnectionState>("gmail_install_plugin");
}

export async function connectGmailOAuth(request: GmailConnectOAuthRequest): Promise<GmailConnectionState> {
  if (googleCloudAvailable()) {
    const session = await startCloudConnectorOAuth("google", {
      scope: request.scope || DEFAULT_GMAIL_OAUTH_SCOPE,
    });
    await openExternalUrl(session.authorizationUrl);
    return normalizeCloudGoogleConnection(await waitForCloudConnectorOAuth<GmailConnectionState>("google", session));
  }

  assertGmailDesktop();
  return invoke<GmailConnectionState>("gmail_connect_oauth", {
    request: {
      clientId: request.clientId,
      clientSecret: request.clientSecret,
      scope: request.scope || DEFAULT_GMAIL_OAUTH_SCOPE,
    },
  });
}

export async function disconnectGmail(): Promise<GmailConnectionState> {
  if (googleCloudAvailable()) {
    return normalizeCloudGoogleConnection(await disconnectCloudConnector<GmailConnectionState>("google"));
  }

  assertGmailDesktop();
  return invoke<GmailConnectionState>("gmail_disconnect");
}

export async function disconnectGmailAccount(request: GmailAccountEmailRequest): Promise<GmailConnectionState> {
  if (googleCloudAvailable()) {
    return disconnectGmail();
  }

  assertGmailDesktop();
  return invoke<GmailConnectionState>("gmail_disconnect_account", {
    request,
  });
}

export async function setActiveGmailAccount(request: GmailAccountEmailRequest): Promise<GmailConnectionState> {
  if (googleCloudAvailable()) {
    const state = await getGmailState();
    if (state.connected && state.activeAccountEmail !== request.email) {
      throw new Error("The hosted Google connector currently keeps one active Google account per Gilbert account.");
    }
    return state;
  }

  assertGmailDesktop();
  return invoke<GmailConnectionState>("gmail_set_active_account", {
    request,
  });
}

export async function listGmailMessages(request: GmailListMessagesRequest = {}): Promise<GmailMessageListResponse> {
  if (googleCloudAvailable()) {
    const response = await googleGmailApi<{ messages?: Array<{ id?: string; threadId?: string }>; nextPageToken?: string; resultSizeEstimate?: number }>({
      method: "GET",
      path: "/users/me/messages",
      query: {
        includeSpamTrash: request.includeSpamTrash,
        labelIds: request.labelIds,
        maxResults: request.maxResults,
        pageToken: request.pageToken,
        q: request.query,
      },
    });
    const messages = await Promise.all((response.data.messages ?? []).slice(0, request.maxResults ?? 10).map(async (message) => {
      if (!message.id) {
        return null;
      }
      try {
        const detail = await getGmailMessage({ accountEmail: request.accountEmail, id: message.id, includeBody: false });
        return detail;
      } catch {
        return {
          id: message.id,
          labelIds: [],
          threadId: message.threadId,
        } satisfies GmailMessageSummary;
      }
    }));
    return {
      messages: messages.filter(Boolean) as GmailMessageSummary[],
      nextPageToken: response.data.nextPageToken,
      resultSizeEstimate: response.data.resultSizeEstimate,
    };
  }

  assertGmailDesktop();
  return invoke<GmailMessageListResponse>("gmail_list_messages", {
    request: withDefaultClientId(request),
  });
}

export async function getGmailMessage(request: GmailGetMessageRequest): Promise<GmailMessageDetail> {
  if (googleCloudAvailable()) {
    const response = await googleGmailApi<Record<string, unknown>>({
      method: "GET",
      path: `/users/me/messages/${encodeURIComponent(request.id)}`,
      query: {
        format: request.includeBody === false ? "metadata" : "full",
        metadataHeaders: ["From", "To", "Cc", "Bcc", "Subject", "Date", "Message-ID", "In-Reply-To", "References"],
      },
    });
    return normalizeGmailMessageDetail(response.data, request.maxBodyChars);
  }

  assertGmailDesktop();
  return invoke<GmailMessageDetail>("gmail_get_message", {
    request: withDefaultClientId(request),
  });
}

export async function getGmailThread(request: GmailGetThreadRequest): Promise<GmailThreadDetail> {
  if (googleCloudAvailable()) {
    const response = await googleGmailApi<{ id?: string; messages?: Record<string, unknown>[] }>({
      method: "GET",
      path: `/users/me/threads/${encodeURIComponent(request.id)}`,
      query: {
        format: request.includeBody === false ? "metadata" : "full",
        metadataHeaders: ["From", "To", "Cc", "Bcc", "Subject", "Date", "Message-ID", "In-Reply-To", "References"],
      },
    });
    return {
      id: response.data.id || request.id,
      messages: (response.data.messages ?? []).map((message) => normalizeGmailMessageDetail(message, request.maxBodyChars)),
    };
  }

  assertGmailDesktop();
  return invoke<GmailThreadDetail>("gmail_get_thread", {
    request: withDefaultClientId(request),
  });
}

export async function listGmailLabels(request: { accountEmail?: string; clientId?: string } = {}): Promise<GmailLabelsResponse> {
  if (googleCloudAvailable()) {
    const response = await googleGmailApi<{ labels?: GmailLabel[] }>({ method: "GET", path: "/users/me/labels" });
    return { labels: response.data.labels ?? [] };
  }

  assertGmailDesktop();
  return invoke<GmailLabelsResponse>("gmail_list_labels", {
    request: withDefaultClientId(request),
  });
}

export async function createGmailLabel(request: GmailCreateLabelRequest): Promise<GmailLabel> {
  if (googleCloudAvailable()) {
    const response = await googleGmailApi<GmailLabel>({
      body: {
        labelListVisibility: request.labelListVisibility,
        messageListVisibility: request.messageListVisibility,
        name: request.name,
      },
      method: "POST",
      path: "/users/me/labels",
    });
    return response.data;
  }

  assertGmailDesktop();
  return invoke<GmailLabel>("gmail_create_label", {
    request: withDefaultClientId(request),
  });
}

export async function createGmailDraft(request: GmailCreateDraftRequest): Promise<GmailDraftResponse> {
  if (googleCloudAvailable()) {
    const response = await googleGmailApi<Record<string, any>>({
      body: {
        message: {
          raw: createGmailRawMessage(request),
          threadId: request.threadId,
        },
      },
      method: "POST",
      path: "/users/me/drafts",
    });
    return {
      id: String(response.data.id || ""),
      message: response.data.message ? normalizeGmailMessageSummary(response.data.message) : undefined,
    };
  }

  assertGmailDesktop();
  return invoke<GmailDraftResponse>("gmail_create_draft", {
    request: withDefaultClientId(request),
  });
}

export async function sendGmailMessage(request: GmailSendMessageRequest): Promise<GmailDraftResponse> {
  if (googleCloudAvailable()) {
    const response = await googleGmailApi<Record<string, unknown>>({
      body: {
        raw: createGmailRawMessage(request),
        threadId: request.threadId,
      },
      method: "POST",
      path: "/users/me/messages/send",
    });
    return {
      id: String(response.data.id || ""),
      message: normalizeGmailMessageSummary(response.data),
    };
  }

  assertGmailDesktop();
  return invoke<GmailDraftResponse>("gmail_send_message", {
    request: withDefaultClientId(request),
  });
}

export async function sendSeparateGmailMessages(request: GmailSendSeparateMessagesRequest): Promise<GmailSendSeparateMessagesResponse> {
  if (googleCloudAvailable()) {
    const results = [];
    for (const to of request.to) {
      try {
        const sent = await sendGmailMessage({
          ...request,
          to: [to],
        });
        results.push({ message: sent.message, ok: true, to });
      } catch (error) {
        results.push({ error: error instanceof Error ? error.message : "Could not send Gmail message.", ok: false, to });
      }
    }
    return {
      failedCount: results.filter((result) => !result.ok).length,
      results,
      sentCount: results.filter((result) => result.ok).length,
    };
  }

  assertGmailDesktop();
  return invoke<GmailSendSeparateMessagesResponse>("gmail_send_separate_messages", {
    request: withDefaultClientId(request),
  });
}

export async function sendGmailDraft(request: GmailSendDraftRequest): Promise<GmailDraftResponse> {
  if (googleCloudAvailable()) {
    const response = await googleGmailApi<Record<string, unknown>>({
      body: {
        id: request.draftId,
      },
      method: "POST",
      path: "/users/me/drafts/send",
    });
    return {
      id: String(response.data.id || request.draftId),
      message: normalizeGmailMessageSummary(response.data),
    };
  }

  assertGmailDesktop();
  return invoke<GmailDraftResponse>("gmail_send_draft", {
    request: withDefaultClientId(request),
  });
}

export async function deleteGmailDraft(request: GmailDeleteDraftRequest): Promise<GmailActionResponse> {
  if (googleCloudAvailable()) {
    await googleGmailApi<unknown>({
      method: "DELETE",
      path: `/users/me/drafts/${encodeURIComponent(request.draftId)}`,
    });
    return { message: "Gmail draft deleted." };
  }

  assertGmailDesktop();
  return invoke<GmailActionResponse>("gmail_delete_draft", {
    request: withDefaultClientId(request),
  });
}

export async function modifyGmailMessageLabels(request: GmailModifyMessageLabelsRequest): Promise<GmailActionResponse> {
  if (googleCloudAvailable()) {
    const response = await googleGmailApi<Record<string, unknown>>({
      body: {
        addLabelIds: request.addLabelIds ?? [],
        removeLabelIds: request.removeLabelIds ?? [],
      },
      method: "POST",
      path: `/users/me/messages/${encodeURIComponent(request.id)}/modify`,
    });
    return {
      message: "Gmail labels updated.",
      messageDetail: normalizeGmailMessageSummary(response.data),
    };
  }

  assertGmailDesktop();
  return invoke<GmailActionResponse>("gmail_modify_message_labels", {
    request: withDefaultClientId(request),
  });
}

export async function batchModifyGmailMessages(request: GmailBatchModifyMessagesRequest): Promise<GmailBatchActionResponse> {
  if (googleCloudAvailable()) {
    await googleGmailApi<unknown>({
      body: {
        addLabelIds: request.addLabelIds ?? [],
        ids: request.ids,
        removeLabelIds: request.removeLabelIds ?? [],
      },
      method: "POST",
      path: "/users/me/messages/batchModify",
    });
    return {
      message: "Gmail labels updated.",
      modifiedCount: request.ids.length,
    };
  }

  assertGmailDesktop();
  return invoke<GmailBatchActionResponse>("gmail_batch_modify_messages", {
    request: withDefaultClientId(request),
  });
}

export async function trashGmailMessage(request: GmailMessageIdRequest): Promise<GmailActionResponse> {
  if (googleCloudAvailable()) {
    const response = await googleGmailApi<Record<string, unknown>>({
      method: "POST",
      path: `/users/me/messages/${encodeURIComponent(request.id)}/trash`,
    });
    return {
      message: "Gmail message moved to trash.",
      messageDetail: normalizeGmailMessageSummary(response.data),
    };
  }

  assertGmailDesktop();
  return invoke<GmailActionResponse>("gmail_trash_message", {
    request: withDefaultClientId(request),
  });
}

export async function untrashGmailMessage(request: GmailMessageIdRequest): Promise<GmailActionResponse> {
  if (googleCloudAvailable()) {
    const response = await googleGmailApi<Record<string, unknown>>({
      method: "POST",
      path: `/users/me/messages/${encodeURIComponent(request.id)}/untrash`,
    });
    return {
      message: "Gmail message restored.",
      messageDetail: normalizeGmailMessageSummary(response.data),
    };
  }

  assertGmailDesktop();
  return invoke<GmailActionResponse>("gmail_untrash_message", {
    request: withDefaultClientId(request),
  });
}

export async function requestGmailApi(request: GmailApiRequest): Promise<GmailApiResponse> {
  if (googleCloudAvailable()) {
    const response = await googleGmailApi<unknown>({
      body: request.body,
      method: request.method,
      path: request.path,
      query: request.query,
    });
    return {
      accountEmail: request.accountEmail,
      data: response.data,
      message: response.message,
      method: response.method as GmailApiRequest["method"],
      path: response.path,
    };
  }

  assertGmailDesktop();
  return invoke<GmailApiResponse>("gmail_api", {
    request: withDefaultClientId(request),
  });
}

function assertGmailDesktop() {
  if (!gmailDesktopAvailable()) {
    throw new Error("Gmail integration is available in the desktop app or the hosted Google connector.");
  }
}

function withDefaultClientId<TRequest extends { clientId?: string }>(request: TRequest): TRequest {
  return {
    ...request,
    clientId: request.clientId || getDefaultGoogleOAuthClientId() || undefined,
  };
}

async function googleGmailApi<TData>(request: {
  body?: unknown;
  method: GmailApiRequest["method"];
  path: string;
  query?: Record<string, unknown>;
}) {
  return cloudConnectorApi<TData>("google", {
    ...request,
    service: "gmail",
  });
}

function normalizeCloudGoogleConnection(account: GmailConnectionState): GmailConnectionState {
  const accounts = Array.isArray(account.accounts) ? account.accounts : [];
  return {
    accounts,
    activeAccountEmail: account.activeAccountEmail || accounts.find((entry) => entry.active)?.email || accounts[0]?.email,
    connected: account.connected === true || accounts.length > 0,
    connectedAt: normalizeNumber(account.connectedAt),
    expiresAt: normalizeNumber(account.expiresAt),
    lastConnectionError: account.lastConnectionError,
    maxAccounts: Math.max(1, Number(account.maxAccounts || 1)),
    pluginInstalled: account.pluginInstalled === true || account.connected === true || accounts.length > 0,
    pluginInstalledAt: normalizeNumber(account.pluginInstalledAt),
    scopes: Array.isArray(account.scopes) ? account.scopes : accounts[0]?.scopes ?? [],
    user: account.user ?? accounts[0]?.user,
  };
}

function normalizeGmailMessageSummary(value: unknown): GmailMessageSummary {
  const message = typeof value === "object" && value ? value as Record<string, any> : {};
  const headers = readGmailHeaders(message.payload);

  return {
    date: headers.date,
    from: headers.from,
    id: String(message.id || ""),
    internalDate: typeof message.internalDate === "string" ? message.internalDate : undefined,
    labelIds: Array.isArray(message.labelIds) ? message.labelIds.filter((label): label is string => typeof label === "string") : [],
    snippet: typeof message.snippet === "string" ? message.snippet : undefined,
    subject: headers.subject,
    threadId: typeof message.threadId === "string" ? message.threadId : undefined,
    to: headers.to,
  };
}

function normalizeGmailMessageDetail(value: unknown, maxBodyChars = 80_000): GmailMessageDetail {
  const message = typeof value === "object" && value ? value as Record<string, any> : {};
  const summary = normalizeGmailMessageSummary(message);
  const headers = readGmailHeaders(message.payload);
  const body = readGmailBody(message.payload);
  const limitedBody = body.length > maxBodyChars ? body.slice(0, maxBodyChars) : body;

  return {
    ...summary,
    attachments: readGmailAttachments(message.payload),
    bcc: headers.bcc,
    body: limitedBody,
    bodyTruncated: body.length > limitedBody.length,
    cc: headers.cc,
    inReplyTo: headers.inReplyTo,
    links: extractLinks(limitedBody),
    messageId: headers.messageId,
    references: headers.references,
  };
}

function readGmailHeaders(payload: any) {
  const headers = Array.isArray(payload?.headers) ? payload.headers : [];
  const byName = new Map<string, string>();
  headers.forEach((header: any) => {
    if (typeof header?.name === "string" && typeof header?.value === "string") {
      byName.set(header.name.toLowerCase(), header.value);
    }
  });
  return {
    bcc: byName.get("bcc"),
    cc: byName.get("cc"),
    date: byName.get("date"),
    from: byName.get("from"),
    inReplyTo: byName.get("in-reply-to"),
    messageId: byName.get("message-id"),
    references: byName.get("references"),
    subject: byName.get("subject"),
    to: byName.get("to"),
  };
}

function readGmailBody(payload: any): string {
  const parts = flattenGmailParts(payload);
  const preferred = parts.find((part) => part.mimeType === "text/plain" && part.body?.data)
    ?? parts.find((part) => part.mimeType === "text/html" && part.body?.data)
    ?? (payload?.body?.data ? payload : null);

  return preferred?.body?.data ? decodeBase64Url(preferred.body.data) : "";
}

function readGmailAttachments(payload: any): GmailAttachmentSummary[] {
  return flattenGmailParts(payload)
    .filter((part) => part?.filename || part?.body?.attachmentId)
    .map((part) => ({
      attachmentId: typeof part.body?.attachmentId === "string" ? part.body.attachmentId : undefined,
      contentId: readGmailContentId(part),
      filename: typeof part.filename === "string" ? part.filename : "",
      isImage: typeof part.mimeType === "string" && part.mimeType.startsWith("image/"),
      mimeType: typeof part.mimeType === "string" ? part.mimeType : undefined,
      size: normalizeNumber(part.body?.size),
    }));
}

function flattenGmailParts(payload: any): any[] {
  if (!payload) {
    return [];
  }

  const parts = [payload];
  for (const part of payload.parts ?? []) {
    parts.push(...flattenGmailParts(part));
  }
  return parts;
}

function readGmailContentId(part: any) {
  const headers = Array.isArray(part?.headers) ? part.headers : [];
  const header = headers.find((entry: any) => typeof entry?.name === "string" && entry.name.toLowerCase() === "content-id");
  return typeof header?.value === "string" ? header.value : undefined;
}

function createGmailRawMessage(request: {
  bcc?: string[];
  body: string;
  cc?: string[];
  contentType?: "text/markdown" | "text/plain" | "text/html";
  from?: string;
  inReplyTo?: string;
  references?: string;
  subject: string;
  to: string[];
}) {
  const headers = [
    request.from ? `From: ${request.from}` : "",
    `To: ${request.to.join(", ")}`,
    request.cc?.length ? `Cc: ${request.cc.join(", ")}` : "",
    request.bcc?.length ? `Bcc: ${request.bcc.join(", ")}` : "",
    `Subject: ${request.subject}`,
    "MIME-Version: 1.0",
    `Content-Type: ${request.contentType === "text/html" ? "text/html" : "text/plain"}; charset=UTF-8`,
    request.inReplyTo ? `In-Reply-To: ${request.inReplyTo}` : "",
    request.references ? `References: ${request.references}` : "",
  ].filter(Boolean);
  const body = request.contentType === "text/markdown" ? request.body : request.body;
  return encodeBase64Url(`${headers.join("\r\n")}\r\n\r\n${body}`);
}

function encodeBase64Url(value: string) {
  return btoa(unescape(encodeURIComponent(value))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  try {
    return decodeURIComponent(escape(atob(padded)));
  } catch {
    return atob(padded);
  }
}

function extractLinks(value: string) {
  return [...value.matchAll(/\bhttps?:\/\/[^\s<>"')]+/gi)].map((match) => match[0]).slice(0, 30);
}

function normalizeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
