import {
  batchModifyGmailMessages,
  createGmailDraft,
  createGmailLabel,
  deleteGmailDraft,
  getGmailMessage,
  getGmailState,
  getGmailThread,
  listGmailLabels,
  listGmailMessages,
  modifyGmailMessageLabels,
  requestGmailApi,
  sendGmailDraft,
  sendGmailMessage,
  sendSeparateGmailMessages,
  trashGmailMessage,
  untrashGmailMessage,
} from "../../../app/gmailClient";
import type {
  GmailAccountState,
  GmailActionResponse,
  GmailApiRequest,
  GmailApiResponse,
  GmailBatchActionResponse,
  GmailConnectionState,
  GmailCreateDraftRequest,
  GmailCreateLabelRequest,
  GmailDraftResponse,
  GmailLabel,
  GmailLabelsResponse,
  GmailListMessagesRequest,
  GmailMessageDetail,
  GmailMessageListResponse,
  GmailMessageSummary,
  GmailSendMessageRequest,
  GmailSendSeparateMessagesRequest,
  GmailSendSeparateMessagesResponse,
  GmailThreadDetail,
} from "../../../types/gmail";
import type { JsonValue, ToolDefinition, ToolExecutionResult } from "../../types";

export interface GmailToolBackend {
  account: () => Promise<GmailConnectionState>;
  apiRequest: (request: GmailApiRequest) => Promise<GmailApiResponse>;
  batchModifyMessages: (request: { accountEmail?: string; addLabelIds?: string[]; ids: string[]; removeLabelIds?: string[] }) => Promise<GmailBatchActionResponse>;
  createDraft: (request: GmailCreateDraftRequest) => Promise<GmailDraftResponse>;
  createLabel: (request: GmailCreateLabelRequest) => Promise<GmailLabel>;
  deleteDraft: (draftId: string, accountEmail?: string) => Promise<GmailActionResponse>;
  getMessage: (id: string, maxBodyChars?: number, accountEmail?: string, includeBody?: boolean) => Promise<GmailMessageDetail>;
  getThread: (id: string, maxBodyChars?: number, accountEmail?: string, includeBody?: boolean) => Promise<GmailThreadDetail>;
  listLabels: (accountEmail?: string) => Promise<GmailLabelsResponse>;
  listMessages: (request: GmailListMessagesRequest) => Promise<GmailMessageListResponse>;
  modifyMessageLabels: (request: { accountEmail?: string; addLabelIds?: string[]; id: string; removeLabelIds?: string[] }) => Promise<GmailActionResponse>;
  sendDraft: (draftId: string, accountEmail?: string) => Promise<GmailDraftResponse>;
  sendMessage: (request: GmailSendMessageRequest) => Promise<GmailDraftResponse>;
  sendSeparateMessages: (request: GmailSendSeparateMessagesRequest) => Promise<GmailSendSeparateMessagesResponse>;
  trashMessage: (id: string, accountEmail?: string) => Promise<GmailActionResponse>;
  untrashMessage: (id: string, accountEmail?: string) => Promise<GmailActionResponse>;
}

export const defaultGmailToolBackend: GmailToolBackend = {
  account: () => getGmailState(),
  apiRequest: (request) => requestGmailApi(request),
  batchModifyMessages: (request) => batchModifyGmailMessages(request),
  createDraft: (request) => createGmailDraft(request),
  createLabel: (request) => createGmailLabel(request),
  deleteDraft: (draftId, accountEmail) => deleteGmailDraft({ accountEmail, draftId }),
  getMessage: (id, maxBodyChars, accountEmail, includeBody) => getGmailMessage({ accountEmail, id, includeBody, maxBodyChars }),
  getThread: (id, maxBodyChars, accountEmail, includeBody) => getGmailThread({ accountEmail, id, includeBody, maxBodyChars }),
  listLabels: (accountEmail) => listGmailLabels({ accountEmail }),
  listMessages: (request) => listGmailMessages(request),
  modifyMessageLabels: (request) => modifyGmailMessageLabels(request),
  sendDraft: (draftId, accountEmail) => sendGmailDraft({ accountEmail, draftId }),
  sendMessage: (request) => sendGmailMessage(request),
  sendSeparateMessages: (request) => sendSeparateGmailMessages(request),
  trashMessage: (id, accountEmail) => trashGmailMessage({ accountEmail, id }),
  untrashMessage: (id, accountEmail) => untrashGmailMessage({ accountEmail, id }),
};

export function createGmailTools(backend: GmailToolBackend = defaultGmailToolBackend): ToolDefinition[] {
  return [
    createGmailAccountTool(backend),
    createGmailSearchMessagesTool(backend),
    createGmailSemanticSearchTool(backend),
    createGmailGetMessageTool(backend),
    createGmailReadFullMessageTool(backend),
    createGmailGetThreadTool(backend),
    createGmailReadFullThreadTool(backend),
    createGmailListLabelsTool(backend),
    createGmailCreateDraftTool(backend),
    createGmailSendMessageTool(backend),
    createGmailSendSeparateMessagesTool(backend),
    createGmailSendDraftTool(backend),
    createGmailDeleteDraftTool(backend),
    createGmailModifyMessageLabelsTool(backend),
    createGmailBatchModifyMessagesTool(backend),
    createGmailTrashMessageTool(backend),
    createGmailUntrashMessageTool(backend),
    createGmailCreateLabelTool(backend),
    createGmailApiReadTool(backend),
    createGmailApiWriteTool(backend),
    createGmailApiDeleteTool(backend),
  ];
}

export const gmailTools: ToolDefinition[] = createGmailTools();

function createGmailAccountTool(backend: GmailToolBackend): ToolDefinition {
  return gmailReadTool({
    description: "Inspect whether Gmail is installed and connected without exposing tokens.",
    execute: async () => {
      try {
        const state = await backend.account();
        return {
          content: formatGmailAccountState(state),
          data: state as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not read Gmail account state."));
      }
    },
    id: "gmail_account",
    inputSchema: { additionalProperties: false, properties: {}, type: "object" },
    title: "Check Gmail account",
  });
}

function createGmailSearchMessagesTool(backend: GmailToolBackend): ToolDefinition {
  return gmailReadTool({
    description:
      "Search or list Gmail messages for the connected account. Use Gmail search syntax in query when the user asks about inbox, email, mail, senders, subjects, labels, or recent messages.",
    execute: async (args) => {
      try {
        const response = await backend.listMessages({
          accountEmail: optionalStringArg(args.accountEmail),
          includeSpamTrash: booleanArg(args.includeSpamTrash),
          labelIds: stringArrayArg(args.labelIds),
          maxResults: integerArg(args.maxResults, 10, 1, 25),
          pageToken: optionalStringArg(args.pageToken),
          query: optionalStringArg(args.query),
        });

        return {
          content: formatMessageList(response, optionalStringArg(args.query)),
          data: response as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not search Gmail messages."));
      }
    },
    id: "gmail_search_messages",
    inputSchema: {
      additionalProperties: false,
      properties: {
        accountEmail: gmailAccountEmailSchema(),
        includeSpamTrash: { description: "Include Spam and Trash in the search.", type: "boolean" },
        labelIds: { description: "Gmail label ids such as INBOX, SENT, UNREAD, STARRED, or user label ids.", items: { type: "string" }, type: "array" },
        maxResults: { maximum: 25, minimum: 1, type: "integer" },
        pageToken: { minLength: 1, type: "string" },
        query: { description: "Gmail search query, for example from:person@example.com newer_than:30d or subject:(invoice).", minLength: 1, type: "string" },
      },
      type: "object",
    },
    title: "Search Gmail",
  });
}

function createGmailSemanticSearchTool(backend: GmailToolBackend): ToolDefinition {
  return gmailReadTool({
    description:
      "Search Gmail with local vector ranking over message metadata and snippets. Use when the user describes a concept, topic, intent, or fuzzy memory instead of exact Gmail search syntax.",
    execute: async (args) => {
      const query = stringArg(args.query);
      if (!query) {
        return createErrorResult("gmail_semantic_search requires a query.");
      }

      try {
        const response = await backend.listMessages({
          accountEmail: optionalStringArg(args.accountEmail),
          includeSpamTrash: booleanArg(args.includeSpamTrash),
          labelIds: stringArrayArg(args.labelIds),
          maxResults: integerArg(args.candidateCount, 25, 1, 25),
          query: optionalStringArg(args.gmailQuery),
        });
        const rankedMessages = rankMessagesByLocalEmbedding(response.messages, query)
          .slice(0, integerArg(args.maxResults, 8, 1, 25));

        return {
          content: formatSemanticMessageList(rankedMessages, query, optionalStringArg(args.gmailQuery)),
          data: { ...response, messages: rankedMessages } as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not run Gmail semantic search."));
      }
    },
    id: "gmail_semantic_search",
    inputSchema: {
      additionalProperties: false,
      properties: {
        accountEmail: gmailAccountEmailSchema(),
        candidateCount: { description: "How many Gmail candidates to pull before local vector ranking.", maximum: 25, minimum: 1, type: "integer" },
        gmailQuery: { description: "Optional Gmail search syntax filter before vector ranking.", minLength: 1, type: "string" },
        includeSpamTrash: { description: "Include Spam and Trash in the candidate search.", type: "boolean" },
        labelIds: { description: "Optional Gmail label ids to constrain candidates.", items: { type: "string" }, type: "array" },
        maxResults: { maximum: 25, minimum: 1, type: "integer" },
        query: { description: "Conceptual or natural-language search text for local vector ranking.", minLength: 1, type: "string" },
      },
      required: ["query"],
      type: "object",
    },
    title: "Semantic Gmail search",
  });
}

function createGmailGetMessageTool(backend: GmailToolBackend): ToolDefinition {
  return gmailReadTool({
    description: "Read one Gmail message's safe metadata by message id: headers, labels, snippet, and identifiers. Use gmail_read_full_message only after the user approves reading the full email body.",
    execute: async (args) => {
      const id = stringArg(args.id);
      if (!id) {
        return createErrorResult("gmail_get_message requires a message id.");
      }

      try {
        const message = await backend.getMessage(id, 1, optionalStringArg(args.accountEmail), false);
        return {
          content: formatMessageMetadata(message),
          data: message as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not read Gmail message."));
      }
    },
    id: "gmail_get_message",
    inputSchema: {
      additionalProperties: false,
      properties: {
        accountEmail: gmailAccountEmailSchema(),
        id: { minLength: 1, type: "string" },
        maxBodyChars: { maximum: 60_000, minimum: 1, type: "integer" },
      },
      required: ["id"],
      type: "object",
    },
    title: "Read Gmail message",
  });
}

function createGmailReadFullMessageTool(backend: GmailToolBackend): ToolDefinition {
  return gmailPrivateReadTool({
    description:
      "Read the full body of one specific Gmail message, plus detected links and attachment metadata. Use when exact email content is needed; never open detected links.",
    execute: async (args) => {
      const id = stringArg(args.id);
      if (!id) {
        return createErrorResult("gmail_read_full_message requires a message id.");
      }

      if (isDryRun(args)) {
        return createApprovalPreview([
          "Read full Gmail message body",
          `Message id: ${id}`,
          optionalStringArg(args.accountEmail) ? `Account: ${optionalStringArg(args.accountEmail)}` : undefined,
          "This will fetch the body text for this specific email and list detected links without opening them.",
        ]);
      }

      try {
        const message = await backend.getMessage(
          id,
          integerArg(args.maxBodyChars, 24_000, 1, 60_000),
          optionalStringArg(args.accountEmail),
          true,
        );
        return {
          content: formatMessageDetail(message),
          data: message as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not read full Gmail message."));
      }
    },
    id: "gmail_read_full_message",
    inputSchema: {
      additionalProperties: false,
      properties: {
        accountEmail: gmailAccountEmailSchema(),
        id: { minLength: 1, type: "string" },
        maxBodyChars: { maximum: 60_000, minimum: 1, type: "integer" },
      },
      required: ["id"],
      type: "object",
    },
    scheduler: { mode: "exclusive" },
    title: "Read full Gmail message",
  });
}

function createGmailGetThreadTool(backend: GmailToolBackend): ToolDefinition {
  return gmailReadTool({
    description: "Read safe metadata for all Gmail messages in a thread by thread id. Use gmail_read_full_thread only after user approval to read full email bodies.",
    execute: async (args) => {
      const id = stringArg(args.id);
      if (!id) {
        return createErrorResult("gmail_get_thread requires a thread id.");
      }

      try {
        const thread = await backend.getThread(id, 1, optionalStringArg(args.accountEmail), false);
        return {
          content: formatThreadDetail(thread, false),
          data: thread as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not read Gmail thread."));
      }
    },
    id: "gmail_get_thread",
    inputSchema: {
      additionalProperties: false,
      properties: {
        accountEmail: gmailAccountEmailSchema(),
        id: { minLength: 1, type: "string" },
        maxBodyChars: { maximum: 60_000, minimum: 1, type: "integer" },
      },
      required: ["id"],
      type: "object",
    },
    title: "Read Gmail thread",
  });
}

function createGmailReadFullThreadTool(backend: GmailToolBackend): ToolDefinition {
  return gmailPrivateReadTool({
    description:
      "Read full bodies for all messages in a specific Gmail thread, including detected links and attachment metadata. Use when exact thread content is needed; never open links.",
    execute: async (args) => {
      const id = stringArg(args.id);
      if (!id) {
        return createErrorResult("gmail_read_full_thread requires a thread id.");
      }

      if (isDryRun(args)) {
        return createApprovalPreview([
          "Read full Gmail thread",
          `Thread id: ${id}`,
          optionalStringArg(args.accountEmail) ? `Account: ${optionalStringArg(args.accountEmail)}` : undefined,
          "This will fetch body text for messages in this thread and list detected links without opening them.",
        ]);
      }

      try {
        const thread = await backend.getThread(
          id,
          integerArg(args.maxBodyChars, 16_000, 1, 60_000),
          optionalStringArg(args.accountEmail),
          true,
        );
        return {
          content: formatThreadDetail(thread, true),
          data: thread as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not read full Gmail thread."));
      }
    },
    id: "gmail_read_full_thread",
    inputSchema: {
      additionalProperties: false,
      properties: {
        accountEmail: gmailAccountEmailSchema(),
        id: { minLength: 1, type: "string" },
        maxBodyChars: { maximum: 60_000, minimum: 1, type: "integer" },
      },
      required: ["id"],
      type: "object",
    },
    scheduler: { mode: "exclusive" },
    title: "Read full Gmail thread",
  });
}

function createGmailListLabelsTool(backend: GmailToolBackend): ToolDefinition {
  return gmailReadTool({
    description: "List Gmail labels and folders for the connected account.",
    execute: async (args) => {
      try {
        const response = await backend.listLabels(optionalStringArg(args.accountEmail));
        return {
          content: formatLabels(response.labels),
          data: response as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not list Gmail labels."));
      }
    },
    id: "gmail_list_labels",
    inputSchema: {
      additionalProperties: false,
      properties: {
        accountEmail: gmailAccountEmailSchema(),
      },
      type: "object",
    },
    title: "List Gmail labels",
  });
}

function createGmailCreateDraftTool(backend: GmailToolBackend): ToolDefinition {
  return gmailMutatingTool({
    description:
      "Create a Gmail draft for review. Use this for requested drafts or replies, then summarize what was drafted; do not send it unless the user explicitly confirms sending.",
    execute: async (args) => {
      const to = stringArrayArg(args.to);
      const subject = stringArg(args.subject);
      const body = stringArg(args.body);
      if (to.length === 0 || !subject || !body) {
        return createErrorResult("gmail_create_draft requires to, subject, and body.");
      }
      const prepared = await prepareOutgoingGmailMessage(backend, args, { body, subject, to });

      if (isDryRun(args)) {
        return createApprovalPreview([
          "Create Gmail draft",
          `To: ${prepared.to.join(", ")}`,
          `Subject: ${prepared.subject}`,
          prepared.from ? `From: ${prepared.from}` : undefined,
          prepared.accountEmail ? `Account: ${prepared.accountEmail}` : undefined,
          previewBody(prepared.body, prepared.contentType),
        ]);
      }

      try {
        const response = await backend.createDraft({
          ...prepared,
        });
        return {
          content: formatDraftResponse("Created Gmail draft", response),
          data: response as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not create Gmail draft."));
      }
    },
    id: "gmail_create_draft",
    inputSchema: draftSchema(),
    title: "Create Gmail draft",
  });
}

function createGmailSendMessageTool(backend: GmailToolBackend): ToolDefinition {
  return gmailDestructiveTool({
    description:
      "Send a new Gmail message directly to the listed recipients. This must only run after visible user confirmation; prefer draft creation unless the user explicitly asks to send now.",
    execute: async (args) => {
      const to = stringArrayArg(args.to);
      const subject = stringArg(args.subject);
      const body = stringArg(args.body);
      if (to.length === 0 || !subject || !body) {
        return createErrorResult("gmail_send_message requires to, subject, and body.");
      }
      const prepared = await prepareOutgoingGmailMessage(backend, args, { body, subject, to });

      if (isDryRun(args)) {
        return createApprovalPreview([
          "Send Gmail message",
          `To: ${prepared.to.join(", ")}`,
          `Subject: ${prepared.subject}`,
          prepared.from ? `From: ${prepared.from}` : undefined,
          prepared.accountEmail ? `Account: ${prepared.accountEmail}` : undefined,
          previewBody(prepared.body, prepared.contentType),
        ]);
      }

      try {
        const response = await backend.sendMessage({
          ...prepared,
        });
        return {
          content: formatDraftResponse("Sent Gmail message", response),
          data: response as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not send Gmail message."));
      }
    },
    id: "gmail_send_message",
    inputSchema: draftSchema(),
    scheduler: { mode: "exclusive" },
    title: "Send Gmail message",
  });
}

function createGmailSendSeparateMessagesTool(backend: GmailToolBackend): ToolDefinition {
  return gmailDestructiveTool({
    description:
      "Send the same Gmail message separately to each recipient, creating one email per address instead of exposing recipients to each other. Requires visible confirmation.",
    execute: async (args) => {
      const to = stringArrayArg(args.to);
      const subject = stringArg(args.subject);
      const body = stringArg(args.body);
      if (to.length < 2 || !subject || !body) {
        return createErrorResult("gmail_send_separate_messages requires at least two recipients plus subject and body.");
      }
      const prepared = await prepareOutgoingGmailMessage(backend, args, { body, subject, to });

      if (isDryRun(args)) {
        return createApprovalPreview([
          "Send separate Gmail messages",
          `Recipients: ${prepared.to.length}`,
          `To: ${prepared.to.join(", ")}`,
          `Subject: ${prepared.subject}`,
          prepared.from ? `From: ${prepared.from}` : undefined,
          prepared.accountEmail ? `Account: ${prepared.accountEmail}` : undefined,
          "Each recipient gets their own separate message.",
          previewBody(prepared.body, prepared.contentType),
        ]);
      }

      try {
        const response = await backend.sendSeparateMessages({
          accountEmail: prepared.accountEmail,
          body: prepared.body,
          contentType: prepared.contentType,
          from: prepared.from,
          subject: prepared.subject,
          to: prepared.to,
        });
        return {
          content: formatSeparateSendResponse(response),
          data: response as unknown as JsonValue,
          ok: response.failedCount === 0,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not send separate Gmail messages."));
      }
    },
    id: "gmail_send_separate_messages",
    inputSchema: {
      additionalProperties: false,
      properties: {
        accountEmail: gmailAccountEmailSchema(),
        body: { minLength: 1, type: "string" },
        contentType: { enum: ["text/markdown", "text/plain", "text/html"], type: "string" },
        from: { description: "Optional sender header. Omit for the active account's default sender name/address; do not use placeholders.", minLength: 1, type: "string" },
        subject: { minLength: 1, type: "string" },
        to: { items: { type: "string" }, maxItems: 50, minItems: 2, type: "array" },
      },
      required: ["to", "subject", "body"],
      type: "object",
    },
    scheduler: { mode: "exclusive" },
    title: "Send separate Gmail messages",
  });
}

function createGmailSendDraftTool(backend: GmailToolBackend): ToolDefinition {
  return gmailDestructiveTool({
    description: "Send an existing Gmail draft. This must only run after visible user confirmation.",
    execute: async (args) => {
      const draftId = stringArg(args.draftId);
      if (!draftId) {
        return createErrorResult("gmail_send_draft requires a draftId.");
      }

      if (isDryRun(args)) {
        return createApprovalPreview([
          "Send Gmail draft",
          `Draft id: ${draftId}`,
          optionalStringArg(args.accountEmail) ? `Account: ${optionalStringArg(args.accountEmail)}` : undefined,
        ]);
      }

      try {
        const response = await backend.sendDraft(draftId, optionalStringArg(args.accountEmail));
        return {
          content: formatDraftResponse("Sent Gmail draft", response),
          data: response as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not send Gmail draft."));
      }
    },
    id: "gmail_send_draft",
    inputSchema: idSchema("draftId"),
    scheduler: { mode: "exclusive" },
    title: "Send Gmail draft",
  });
}

function createGmailDeleteDraftTool(backend: GmailToolBackend): ToolDefinition {
  return gmailDestructiveTool({
    description: "Permanently delete an existing Gmail draft. This must only run after visible user confirmation.",
    execute: async (args) => {
      const draftId = stringArg(args.draftId);
      if (!draftId) {
        return createErrorResult("gmail_delete_draft requires a draftId.");
      }

      if (isDryRun(args)) {
        return createApprovalPreview([
          "Delete Gmail draft",
          `Draft id: ${draftId}`,
          optionalStringArg(args.accountEmail) ? `Account: ${optionalStringArg(args.accountEmail)}` : undefined,
          "This permanently deletes the draft, not a sent message.",
        ]);
      }

      try {
        const response = await backend.deleteDraft(draftId, optionalStringArg(args.accountEmail));
        return {
          content: response.message,
          data: response as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not delete Gmail draft."));
      }
    },
    id: "gmail_delete_draft",
    inputSchema: idSchema("draftId"),
    scheduler: { mode: "exclusive" },
    title: "Delete Gmail draft",
  });
}

function createGmailModifyMessageLabelsTool(backend: GmailToolBackend): ToolDefinition {
  return gmailMutatingTool({
    description:
      "Add or remove Gmail labels from a message. Use for archive, mark read/unread, star/unstar, and label cleanup only after the requested target is clear.",
    execute: async (args) => {
      const id = stringArg(args.id);
      const addLabelIds = stringArrayArg(args.addLabelIds);
      const removeLabelIds = stringArrayArg(args.removeLabelIds);
      if (!id || (addLabelIds.length === 0 && removeLabelIds.length === 0)) {
        return createErrorResult("gmail_modify_message_labels requires id plus addLabelIds or removeLabelIds.");
      }

      if (isDryRun(args)) {
        return createApprovalPreview([
          "Modify Gmail message labels",
          `Message id: ${id}`,
          addLabelIds.length ? `Add labels: ${addLabelIds.join(", ")}` : undefined,
          removeLabelIds.length ? `Remove labels: ${removeLabelIds.join(", ")}` : undefined,
          optionalStringArg(args.accountEmail) ? `Account: ${optionalStringArg(args.accountEmail)}` : undefined,
        ]);
      }

      try {
        const response = await backend.modifyMessageLabels({
          accountEmail: optionalStringArg(args.accountEmail),
          addLabelIds,
          id,
          removeLabelIds,
        });
        return {
          content: formatActionResponse(response),
          data: response as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not modify Gmail labels."));
      }
    },
    id: "gmail_modify_message_labels",
    inputSchema: {
      additionalProperties: false,
      properties: {
        accountEmail: gmailAccountEmailSchema(),
        addLabelIds: { items: { type: "string" }, type: "array" },
        id: { minLength: 1, type: "string" },
        removeLabelIds: { items: { type: "string" }, type: "array" },
      },
      required: ["id"],
      type: "object",
    },
    scheduler: { mode: "exclusive" },
    title: "Modify Gmail labels",
  });
}

function createGmailBatchModifyMessagesTool(backend: GmailToolBackend): ToolDefinition {
  return gmailMutatingTool({
    description:
      "Batch add or remove Gmail labels for many message ids in one approved operation. Use for archive/read/unread/star/label cleanup when the affected message ids are explicit.",
    execute: async (args) => {
      const ids = stringArrayArg(args.ids);
      const addLabelIds = stringArrayArg(args.addLabelIds);
      const removeLabelIds = stringArrayArg(args.removeLabelIds);
      if (ids.length === 0 || (addLabelIds.length === 0 && removeLabelIds.length === 0)) {
        return createErrorResult("gmail_batch_modify_messages requires ids plus addLabelIds or removeLabelIds.");
      }

      if (isDryRun(args)) {
        return createApprovalPreview([
          "Batch modify Gmail labels",
          `Messages: ${ids.length}`,
          `Message ids: ${ids.slice(0, 12).join(", ")}${ids.length > 12 ? ` and ${ids.length - 12} more` : ""}`,
          addLabelIds.length ? `Add labels: ${addLabelIds.join(", ")}` : undefined,
          removeLabelIds.length ? `Remove labels: ${removeLabelIds.join(", ")}` : undefined,
          optionalStringArg(args.accountEmail) ? `Account: ${optionalStringArg(args.accountEmail)}` : undefined,
        ]);
      }

      try {
        const response = await backend.batchModifyMessages({
          accountEmail: optionalStringArg(args.accountEmail),
          addLabelIds,
          ids,
          removeLabelIds,
        });
        return {
          content: formatBatchActionResponse(response),
          data: response as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not batch modify Gmail messages."));
      }
    },
    id: "gmail_batch_modify_messages",
    inputSchema: {
      additionalProperties: false,
      properties: {
        accountEmail: gmailAccountEmailSchema(),
        addLabelIds: { items: { type: "string" }, type: "array" },
        ids: { items: { type: "string" }, maxItems: 1000, minItems: 1, type: "array" },
        removeLabelIds: { items: { type: "string" }, type: "array" },
      },
      required: ["ids"],
      type: "object",
    },
    scheduler: { mode: "exclusive" },
    title: "Batch modify Gmail labels",
  });
}

function createGmailTrashMessageTool(backend: GmailToolBackend): ToolDefinition {
  return gmailDestructiveTool({
    description: "Move a Gmail message to Trash. This is reversible but must only run after visible user confirmation.",
    execute: async (args) => {
      const id = stringArg(args.id);
      if (!id) {
        return createErrorResult("gmail_trash_message requires a message id.");
      }

      if (isDryRun(args)) {
        return createApprovalPreview([
          "Move Gmail message to Trash",
          `Message id: ${id}`,
          optionalStringArg(args.accountEmail) ? `Account: ${optionalStringArg(args.accountEmail)}` : undefined,
          "This is reversible from Gmail Trash.",
        ]);
      }

      try {
        const response = await backend.trashMessage(id, optionalStringArg(args.accountEmail));
        return {
          content: formatActionResponse(response),
          data: response as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not move Gmail message to Trash."));
      }
    },
    id: "gmail_trash_message",
    inputSchema: idSchema("id"),
    scheduler: { mode: "exclusive" },
    title: "Trash Gmail message",
  });
}

function createGmailUntrashMessageTool(backend: GmailToolBackend): ToolDefinition {
  return gmailMutatingTool({
    description: "Restore a Gmail message from Trash after the user asks to recover it.",
    execute: async (args) => {
      const id = stringArg(args.id);
      if (!id) {
        return createErrorResult("gmail_untrash_message requires a message id.");
      }

      if (isDryRun(args)) {
        return createApprovalPreview([
          "Restore Gmail message from Trash",
          `Message id: ${id}`,
          optionalStringArg(args.accountEmail) ? `Account: ${optionalStringArg(args.accountEmail)}` : undefined,
        ]);
      }

      try {
        const response = await backend.untrashMessage(id, optionalStringArg(args.accountEmail));
        return {
          content: formatActionResponse(response),
          data: response as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not restore Gmail message from Trash."));
      }
    },
    id: "gmail_untrash_message",
    inputSchema: idSchema("id"),
    scheduler: { mode: "exclusive" },
    title: "Untrash Gmail message",
  });
}

function createGmailCreateLabelTool(backend: GmailToolBackend): ToolDefinition {
  return gmailMutatingTool({
    description: "Create a Gmail label for organizing mail after the user asks for a new label or folder.",
    execute: async (args) => {
      const name = stringArg(args.name);
      if (!name) {
        return createErrorResult("gmail_create_label requires a label name.");
      }

      if (isDryRun(args)) {
        return createApprovalPreview([
          "Create Gmail label",
          `Label name: ${name}`,
          optionalStringArg(args.accountEmail) ? `Account: ${optionalStringArg(args.accountEmail)}` : undefined,
        ]);
      }

      try {
        const response = await backend.createLabel({
          accountEmail: optionalStringArg(args.accountEmail),
          labelListVisibility: optionalStringArg(args.labelListVisibility) as GmailCreateLabelRequest["labelListVisibility"],
          messageListVisibility: optionalStringArg(args.messageListVisibility) as GmailCreateLabelRequest["messageListVisibility"],
          name,
        });
        return {
          content: `Created Gmail label ${response.name} (${response.id}).`,
          data: response as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not create Gmail label."));
      }
    },
    id: "gmail_create_label",
    inputSchema: {
      additionalProperties: false,
      properties: {
        accountEmail: gmailAccountEmailSchema(),
        labelListVisibility: { enum: ["labelShow", "labelShowIfUnread", "labelHide"], type: "string" },
        messageListVisibility: { enum: ["show", "hide"], type: "string" },
        name: { minLength: 1, type: "string" },
      },
      required: ["name"],
      type: "object",
    },
    scheduler: { mode: "exclusive" },
    title: "Create Gmail label",
  });
}

function createGmailApiReadTool(backend: GmailToolBackend): ToolDefinition {
  return gmailReadTool({
    description:
      "Call any Gmail API GET endpoint not covered by a higher-level tool, including drafts, attachments, labels, history, settings, filters, forwarding, send-as, and threads. Use a relative path such as drafts, labels/LABEL_ID, messages/ID/attachments/ATTACHMENT_ID, settings/filters, or users/me/profile.",
    execute: async (args) => {
      const path = stringArg(args.path);
      if (!path) {
        return createErrorResult("gmail_api_read requires path.");
      }

      return executeApiTool(
        () => backend.apiRequest({
          accountEmail: optionalStringArg(args.accountEmail),
          method: "GET",
          path,
          query: objectArg(args.query),
        }),
        "Could not read Gmail API.",
      );
    },
    id: "gmail_api_read",
    inputSchema: gmailApiSchema(["GET"]),
    title: "Read Gmail API",
  });
}

function createGmailApiWriteTool(backend: GmailToolBackend): ToolDefinition {
  return gmailMutatingTool({
    description:
      "Call any Gmail API POST, PATCH, or PUT endpoint not covered by a higher-level tool, including drafts update, labels update, message import/insert, filters, forwarding, settings, send-as, and thread/message batch operations.",
    execute: async (args) => {
      const path = stringArg(args.path);
      const method = gmailApiWriteMethodArg(args.method);
      if (!path || !method) {
        return createErrorResult("gmail_api_write requires method and path.");
      }

      if (isDryRun(args)) {
        return createApprovalPreview([
          "Call Gmail write API",
          `Method: ${method}`,
          `Path: ${path}`,
          objectArg(args.body) ? "Body: provided" : undefined,
          optionalStringArg(args.accountEmail) ? `Account: ${optionalStringArg(args.accountEmail)}` : undefined,
        ]);
      }

      return executeApiTool(
        () => backend.apiRequest({
          accountEmail: optionalStringArg(args.accountEmail),
          body: args.body,
          method,
          path,
          query: objectArg(args.query),
        }),
        "Could not write Gmail API.",
      );
    },
    id: "gmail_api_write",
    inputSchema: gmailApiSchema(["POST", "PATCH", "PUT"]),
    scheduler: { mode: "exclusive" },
    title: "Write Gmail API",
  });
}

function createGmailApiDeleteTool(backend: GmailToolBackend): ToolDefinition {
  return gmailDestructiveTool({
    description:
      "Call any Gmail API DELETE endpoint not covered by a higher-level tool, including permanent message/thread deletion, draft deletion, label deletion, filter deletion, forwarding deletion, and send-as resource deletion.",
    execute: async (args) => {
      const path = stringArg(args.path);
      if (!path) {
        return createErrorResult("gmail_api_delete requires path.");
      }

      if (isDryRun(args)) {
        return createApprovalPreview([
          "Delete through Gmail API",
          `Path: ${path}`,
          optionalStringArg(args.accountEmail) ? `Account: ${optionalStringArg(args.accountEmail)}` : undefined,
        ]);
      }

      return executeApiTool(
        () => backend.apiRequest({
          accountEmail: optionalStringArg(args.accountEmail),
          method: "DELETE",
          path,
          query: objectArg(args.query),
        }),
        "Could not delete through Gmail API.",
      );
    },
    id: "gmail_api_delete",
    inputSchema: gmailApiSchema(["DELETE"]),
    scheduler: { mode: "exclusive" },
    title: "Delete via Gmail API",
  });
}

function gmailReadTool(tool: Omit<ToolDefinition, "executorMetadata" | "permission" | "risk">): ToolDefinition {
  return {
    ...tool,
    executorMetadata: { family: "gmail", version: 1 },
    permission: "read-only",
    risk: "read",
  };
}

function gmailMutatingTool(tool: Omit<ToolDefinition, "executorMetadata" | "permission" | "risk">): ToolDefinition {
  return {
    ...tool,
    executorMetadata: { family: "gmail", version: 1 },
    permission: "mutating",
    risk: "mutating",
  };
}

function gmailDestructiveTool(tool: Omit<ToolDefinition, "executorMetadata" | "permission" | "risk">): ToolDefinition {
  return {
    ...tool,
    executorMetadata: { family: "gmail", version: 1 },
    permission: "destructive",
    risk: "destructive",
  };
}

function gmailPrivateReadTool(tool: Omit<ToolDefinition, "executorMetadata" | "permission" | "risk">): ToolDefinition {
  return {
    ...tool,
    executorMetadata: { family: "gmail", version: 1 },
    permission: "read-only",
    risk: "read",
  };
}

function formatGmailAccountState(state: GmailConnectionState) {
  const accounts = state.accounts ?? [];

  if (accounts.length > 0) {
    const activeAccount = getActiveGmailAccount(state, state.activeAccountEmail);
    const senderName = getGmailSenderName(activeAccount);

    return [
      `Gmail connected accounts: ${accounts.length}/${state.maxAccounts || 6}.`,
      state.activeAccountEmail ? `Active account: ${state.activeAccountEmail}` : undefined,
      activeAccount?.user.name ? `Active account name: ${activeAccount.user.name}` : undefined,
      senderName ? `Default sender name for new mail: ${senderName}` : undefined,
      "",
      accounts
        .map((account, index) => {
          const scopes = account.scopes.length ? account.scopes.join(", ") : "none reported";
          const name = getGmailSenderName(account);
          return `${index + 1}. ${account.email}${account.active ? " (active)" : ""}${name ? ` | Name: ${name}` : ""} | Scopes: ${scopes}`;
        })
        .join("\n"),
      "",
      "Use accountEmail in Gmail tool calls to target a specific connected account; omit it to use the active account. Use the sender name for email closings instead of placeholders like [Your Name]. Omit threadId, inReplyTo, and references for brand-new messages.",
    ].filter(Boolean).join("\n");
  }

  return state.pluginInstalled
    ? "Gmail plugin is installed, but Google account access is not connected."
    : "Gmail plugin is not installed.";
}

function formatMessageList(response: GmailMessageListResponse, query?: string) {
  if (response.messages.length === 0) {
    return query ? `No Gmail messages matched query: ${query}` : "No Gmail messages returned.";
  }

  return [
    query ? `Gmail search results for: ${query}` : "Gmail messages:",
    `Returned ${response.messages.length}${response.resultSizeEstimate !== undefined ? ` of about ${response.resultSizeEstimate}` : ""}.`,
    "",
    response.messages.map((message, index) => formatMessageSummary(message, index + 1)).join("\n\n"),
    response.nextPageToken ? `\nNext page token: ${response.nextPageToken}` : "",
  ].filter(Boolean).join("\n");
}

function formatSemanticMessageList(messages: GmailMessageSummary[], query: string, gmailQuery?: string) {
  if (messages.length === 0) {
    return gmailQuery
      ? `No Gmail messages matched Gmail filter "${gmailQuery}" for semantic query: ${query}`
      : `No Gmail messages returned for semantic query: ${query}`;
  }

  return [
    `Semantic Gmail results for: ${query}`,
    gmailQuery ? `Gmail filter: ${gmailQuery}` : undefined,
    `Local vector-ranked results: ${messages.length}.`,
    "",
    messages.map((message, index) => formatMessageSummary(message, index + 1)).join("\n\n"),
  ].filter(Boolean).join("\n");
}

function formatMessageSummary(message: GmailMessageSummary, index?: number) {
  const title = `${index ? `${index}. ` : ""}${message.subject || "(no subject)"}`;
  return [
    title,
    message.accountEmail ? `Account: ${message.accountEmail}` : undefined,
    `Message: ${message.id}${message.threadId ? ` | Thread: ${message.threadId}` : ""}`,
    message.from ? `From: ${message.from}` : undefined,
    message.to ? `To: ${message.to}` : undefined,
    message.date ? `Date: ${message.date}` : undefined,
    message.labelIds.length ? `Labels: ${message.labelIds.join(", ")}` : undefined,
    message.snippet ? `Snippet: ${message.snippet}` : undefined,
  ].filter(Boolean).join("\n");
}

function formatMessageMetadata(message: GmailMessageDetail) {
  return [
    formatMessageSummary(message),
    message.cc ? `Cc: ${message.cc}` : undefined,
    message.bcc ? `Bcc: ${message.bcc}` : undefined,
    message.messageId ? `Message-ID: ${message.messageId}` : undefined,
    message.inReplyTo ? `In-Reply-To: ${message.inReplyTo}` : undefined,
    message.references ? `References: ${message.references}` : undefined,
    "Body: not read. Use gmail_read_full_message for this specific message id when the user needs the full email content.",
  ].filter(Boolean).join("\n");
}

function formatMessageDetail(message: GmailMessageDetail) {
  return [
    formatMessageSummary(message),
    message.cc ? `Cc: ${message.cc}` : undefined,
    message.inReplyTo ? `In-Reply-To: ${message.inReplyTo}` : undefined,
    message.references ? `References: ${message.references}` : undefined,
    message.attachments.length
      ? `Attachments: ${message.attachments.map(formatAttachment).join(", ")}`
      : undefined,
    message.links.length ? `Detected links (not opened):\n${message.links.map((link) => `- ${link}`).join("\n")}` : undefined,
    "",
    "Body:",
    message.body || "(No readable text body returned.)",
    message.bodyTruncated ? "\nBody was truncated for tool-result size." : undefined,
  ].filter(Boolean).join("\n");
}

function formatThreadDetail(thread: GmailThreadDetail, includeBodies: boolean) {
  if (thread.messages.length === 0) {
    return `Gmail thread ${thread.id} returned no messages.`;
  }

  return [
    `Gmail thread ${thread.id}: ${thread.messages.length} message${thread.messages.length === 1 ? "" : "s"}`,
    "",
    thread.messages
      .map((message, index) => [`--- Message ${index + 1} ---`, includeBodies ? formatMessageDetail(message) : formatMessageMetadata(message)].join("\n"))
      .join("\n\n"),
  ].join("\n");
}

function formatAttachment(attachment: GmailMessageDetail["attachments"][number]) {
  return [
    attachment.isImage ? "image" : "file",
    attachment.filename || attachment.attachmentId || "attachment",
    attachment.mimeType,
    attachment.size ? `${attachment.size} bytes` : undefined,
    attachment.contentId ? `cid ${attachment.contentId}` : undefined,
  ].filter(Boolean).join(" | ");
}

function formatLabels(labels: GmailLabel[]) {
  if (labels.length === 0) {
    return "No Gmail labels returned.";
  }

  return labels
    .map((label, index) => [
      `${index + 1}. ${label.name} (${label.id})`,
      label.labelType ? `Type: ${label.labelType}` : undefined,
      label.messagesUnread !== undefined ? `Unread: ${label.messagesUnread}` : undefined,
      label.messagesTotal !== undefined ? `Messages: ${label.messagesTotal}` : undefined,
    ].filter(Boolean).join(" | "))
    .join("\n");
}

function formatDraftResponse(prefix: string, response: GmailDraftResponse) {
  return [
    `${prefix}: ${response.id || "draft id unavailable"}.`,
    response.message ? formatMessageSummary(response.message) : undefined,
  ].filter(Boolean).join("\n");
}

function formatActionResponse(response: GmailActionResponse) {
  return [
    response.message,
    response.accountEmail ? `Account: ${response.accountEmail}` : undefined,
    response.messageDetail ? formatMessageSummary(response.messageDetail) : undefined,
  ].filter(Boolean).join("\n");
}

function formatBatchActionResponse(response: GmailBatchActionResponse) {
  return [
    response.message,
    response.accountEmail ? `Account: ${response.accountEmail}` : undefined,
    `Modified: ${response.modifiedCount}`,
  ].filter(Boolean).join("\n");
}

function formatSeparateSendResponse(response: GmailSendSeparateMessagesResponse) {
  return [
    `Sent separate Gmail messages: ${response.sentCount} sent, ${response.failedCount} failed.`,
    response.accountEmail ? `Account: ${response.accountEmail}` : undefined,
    "",
    response.results
      .map((result, index) => [
        `${index + 1}. ${result.to}: ${result.ok ? "sent" : "failed"}`,
        result.message ? `Message: ${result.message.id}` : undefined,
        result.error ? `Error: ${result.error}` : undefined,
      ].filter(Boolean).join(" | "))
      .join("\n"),
  ].filter(Boolean).join("\n");
}

function createApprovalPreview(lines: Array<string | undefined>): ToolExecutionResult {
  return {
    content: lines.filter(Boolean).join("\n"),
    ok: true,
  };
}

async function prepareOutgoingGmailMessage(
  backend: GmailToolBackend,
  args: Record<string, unknown>,
  required: { body: string; subject: string; to: string[] },
) {
  const accountEmail = optionalStringArg(args.accountEmail);
  const identity = await resolveGmailSenderIdentity(backend, accountEmail);
  const senderName = identity.name;

  return {
    accountEmail,
    bcc: stringArrayArg(args.bcc),
    body: applySenderNameToEmailBody(required.body, senderName),
    cc: stringArrayArg(args.cc),
    contentType: contentTypeArg(args.contentType),
    from: resolveFromHeader(optionalStringArg(args.from), identity),
    inReplyTo: optionalEmailMetadataArg(args.inReplyTo),
    references: optionalEmailMetadataArg(args.references),
    subject: required.subject,
    threadId: optionalGmailThreadIdArg(args.threadId),
    to: required.to,
  };
}

async function resolveGmailSenderIdentity(backend: GmailToolBackend, accountEmail?: string) {
  try {
    const state = await backend.account();
    const account = getActiveGmailAccount(state, accountEmail);
    const email = account?.email || accountEmail;
    const name = getGmailSenderName(account) || deriveSenderNameFromEmail(email);

    return {
      email,
      from: email ? formatFromHeader(name, email) : undefined,
      name,
    };
  } catch {
    const name = deriveSenderNameFromEmail(accountEmail);

    return {
      email: accountEmail,
      from: accountEmail ? formatFromHeader(name, accountEmail) : undefined,
      name,
    };
  }
}

function getActiveGmailAccount(state: GmailConnectionState, accountEmail?: string) {
  const accounts = state.accounts ?? [];
  const requestedEmail = accountEmail?.trim().toLowerCase();

  if (requestedEmail) {
    return accounts.find((account) => account.email.toLowerCase() === requestedEmail);
  }

  if (state.activeAccountEmail) {
    const activeEmail = state.activeAccountEmail.toLowerCase();
    const activeAccount = accounts.find((account) => account.email.toLowerCase() === activeEmail);
    if (activeAccount) {
      return activeAccount;
    }
  }

  return accounts.find((account) => account.active) ?? accounts[0];
}

function getGmailSenderName(account?: GmailAccountState) {
  return normalizeDisplayName(account?.user?.name) || deriveSenderNameFromEmail(account?.email);
}

function normalizeDisplayName(value?: string) {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized || undefined;
}

function deriveSenderNameFromEmail(email?: string) {
  const localPart = email?.split("@")[0]?.trim();
  if (!localPart) {
    return undefined;
  }

  const words = localPart
    .replace(/[._-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);

  if (words.length === 0) {
    return undefined;
  }

  return words.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join(" ");
}

function resolveFromHeader(explicitFrom: string | undefined, identity: { email?: string; from?: string; name?: string }) {
  if (!explicitFrom) {
    return identity.from;
  }

  if (explicitFrom.includes("<") || !identity.name) {
    return explicitFrom;
  }

  const email = extractEmailAddress(explicitFrom) || identity.email;
  return email ? formatFromHeader(identity.name, email) : explicitFrom;
}

function extractEmailAddress(value?: string) {
  const match = value?.match(/<([^<>@\s]+@[^<>@\s]+)>|([^<>\s]+@[^<>\s]+)/);
  return match?.[1] || match?.[2];
}

function formatFromHeader(name: string | undefined, email: string) {
  return name ? `${formatDisplayNameForHeader(name)} <${email}>` : email;
}

function formatDisplayNameForHeader(name: string) {
  return /^[A-Za-z0-9 ._'-]+$/.test(name)
    ? name
    : `"${name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function applySenderNameToEmailBody(body: string, senderName?: string) {
  if (!senderName) {
    return body;
  }

  return body
    .replace(/\[(?:your\s+name|name)\]/gi, senderName)
    .replace(/\{\{?\s*(?:your\s+name|name)\s*\}?\}/gi, senderName);
}

async function executeApiTool(
  action: () => Promise<GmailApiResponse>,
  fallback: string,
): Promise<ToolExecutionResult> {
  try {
    const response = await action();
    return {
      content: formatGmailApiResponse(response),
      data: response as unknown as JsonValue,
      ok: true,
    };
  } catch (error) {
    return createErrorResult(readErrorMessage(error, fallback));
  }
}

function formatGmailApiResponse(response: GmailApiResponse) {
  return [
    response.message,
    response.accountEmail ? `Account: ${response.accountEmail}` : undefined,
    `${response.method} ${response.path}`,
    formatApiDataPreview(response.data),
  ].filter(Boolean).join("\n");
}

function formatApiDataPreview(data: unknown) {
  if (data === null || data === undefined) {
    return "No response body.";
  }

  const text = JSON.stringify(data, null, 2);
  return text.length > 4_000 ? `${text.slice(0, 4_000)}\n...truncated` : text;
}

function previewBody(body: string, contentType: GmailCreateDraftRequest["contentType"]) {
  const label = contentType === "text/html" ? "Body HTML" : contentType === "text/plain" ? "Body preview" : "Body markdown";
  const normalized = contentType === "text/markdown" ? body.trim() : body.replace(/\s+/g, " ").trim();
  const preview = normalized.length > 900 ? `${normalized.slice(0, 900)}...` : normalized;

  return label === "Body markdown" ? `${label}:\n${preview}` : `${label}: ${preview}`;
}

function isDryRun(args: Record<string, unknown>) {
  return args.dryRun === true;
}

function rankMessagesByLocalEmbedding(messages: GmailMessageSummary[], query: string): GmailMessageSummary[] {
  const queryEmbedding = createLocalTextEmbedding(query);

  return [...messages]
    .map((message) => ({
      message,
      score: cosineSimilarity(queryEmbedding, createLocalTextEmbedding(createMessageSearchText(message))) + keywordScore(message, query),
    }))
    .sort((left, right) => right.score - left.score)
    .map(({ message }) => message);
}

function createMessageSearchText(message: GmailMessageSummary) {
  return [
    message.subject,
    message.from,
    message.to,
    message.date,
    message.snippet,
    message.labelIds.join(" "),
  ].filter(Boolean).join("\n");
}

function keywordScore(message: GmailMessageSummary, query: string) {
  const text = createMessageSearchText(message).toLowerCase();
  const terms = tokenizeText(query);

  if (terms.length === 0) {
    return 0;
  }

  const matches = terms.filter((term) => text.includes(term)).length;
  return matches / terms.length;
}

function createLocalTextEmbedding(text: string) {
  const vector = Array.from({ length: 96 }, () => 0);
  const tokens = tokenizeText(text);

  for (let index = 0; index < tokens.length; index += 1) {
    pushEmbeddingToken(vector, tokens[index], 1);
    if (index + 1 < tokens.length) {
      pushEmbeddingToken(vector, `${tokens[index]} ${tokens[index + 1]}`, 1.2);
    }
  }

  normalizeVector(vector);
  return vector;
}

function tokenizeText(text: string) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9@._+-]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

function pushEmbeddingToken(vector: number[], token: string, weight: number) {
  vector[hashText(token) % vector.length] += weight * (token.includes("@") ? 1.3 : Math.min(1.35, 0.85 + token.length / 18));
}

function hashText(text: string) {
  let hash = 2166136261;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function cosineSimilarity(left: readonly number[], right: readonly number[]) {
  let dot = 0;

  for (let index = 0; index < left.length && index < right.length; index += 1) {
    dot += left[index] * right[index];
  }

  return dot;
}

function normalizeVector(vector: number[]) {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));

  if (!magnitude) {
    return;
  }

  for (let index = 0; index < vector.length; index += 1) {
    vector[index] /= magnitude;
  }
}

function gmailAccountEmailSchema() {
  return {
    description: "Connected Gmail address to use. Omit this to use the active Gmail account.",
    minLength: 3,
    type: "string",
  };
}

function gmailApiSchema(methods: string[]) {
  return {
    additionalProperties: false,
    properties: {
      accountEmail: gmailAccountEmailSchema(),
      body: {
        additionalProperties: true,
        description: "JSON request body for Gmail write methods.",
        type: "object",
      },
      dryRun: { type: "boolean" },
      method: { enum: methods, type: "string" },
      path: {
        description: "Relative Gmail API path. You may omit users/me/ for current-account endpoints.",
        minLength: 1,
        type: "string",
      },
      query: {
        additionalProperties: true,
        description: "Query parameters. Arrays repeat the same query key.",
        type: "object",
      },
    },
    required: methods.length === 1 && methods[0] === "GET" ? ["path"] : ["method", "path"],
    type: "object",
  };
}

function draftSchema() {
  return {
    additionalProperties: false,
    properties: {
      accountEmail: gmailAccountEmailSchema(),
      bcc: { items: { type: "string" }, type: "array" },
      body: { minLength: 1, type: "string" },
      cc: { items: { type: "string" }, type: "array" },
      contentType: { enum: ["text/markdown", "text/plain", "text/html"], type: "string" },
      from: { description: "Optional sender header. Omit for the active account's default sender name/address; do not use placeholders.", minLength: 1, type: "string" },
      inReplyTo: { description: "Only for real replies. Omit for new messages; never use placeholders such as '-' or blank strings.", minLength: 1, type: "string" },
      references: { description: "Only for real replies. Omit for new messages; never use placeholders such as '-' or blank strings.", minLength: 1, type: "string" },
      subject: { minLength: 1, type: "string" },
      threadId: { description: "Only for an existing Gmail thread id. Omit for new messages; never use placeholders such as '-' or blank strings.", minLength: 1, type: "string" },
      to: { items: { type: "string" }, minItems: 1, type: "array" },
    },
    required: ["to", "subject", "body"],
    type: "object",
  };
}

function idSchema(name: "draftId" | "id") {
  return {
    additionalProperties: false,
    properties: {
      accountEmail: gmailAccountEmailSchema(),
      [name]: { minLength: 1, type: "string" },
    },
    required: [name],
    type: "object",
  };
}

function stringArg(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalStringArg(value: unknown) {
  const valueString = stringArg(value);
  return valueString && !isOptionalPlaceholder(valueString) ? valueString : undefined;
}

function optionalEmailMetadataArg(value: unknown) {
  return optionalStringArg(value);
}

function optionalGmailThreadIdArg(value: unknown) {
  const valueString = optionalStringArg(value);
  return valueString && isPlausibleGmailThreadId(valueString) ? valueString : undefined;
}

function isOptionalPlaceholder(value: string) {
  const normalized = value.trim().toLowerCase();
  return /^[-\u2014]+$/.test(normalized) ||
    normalized === "—" ||
    normalized === "n/a" ||
    normalized === "na" ||
    normalized === "none" ||
    normalized === "null" ||
    normalized === "undefined" ||
    normalized === "(none)" ||
    normalized === "[none]";
}

function isPlausibleGmailThreadId(value: string) {
  return /^[a-f0-9]{8,}$/i.test(value.trim());
}

function stringArrayArg(value: unknown) {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const itemString = stringArg(item);
      return itemString ? [itemString] : [];
    });
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function booleanArg(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function objectArg(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function gmailApiWriteMethodArg(value: unknown): "POST" | "PATCH" | "PUT" | undefined {
  return value === "PATCH" || value === "PUT" ? value : value === "POST" || value === undefined ? "POST" : undefined;
}

function integerArg(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.floor(value)));
}

function contentTypeArg(value: unknown): GmailCreateDraftRequest["contentType"] {
  return value === "text/html" || value === "text/plain" ? value : "text/markdown";
}

function createErrorResult(message: string): ToolExecutionResult {
  return {
    content: message,
    error: message,
    ok: false,
  };
}

function readErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : typeof error === "string" && error.trim() ? error : fallback;
}
