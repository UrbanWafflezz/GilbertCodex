import {
  createMessageContextSurface,
  estimateTextTokens,
  getContextWindowSafetyMarginTokens,
  type ContextWindowPayloadBreakdownItem,
  type ContextWindowUsage,
  DEFAULT_CONTEXT_WINDOW_TOKENS,
} from "../lib/contextWindow";
import {
  createProviderUsageRequestBody,
  estimateProviderRequestReasoningReserveTokens,
  getProviderRequestMaxOutputTokens,
  modelForMessages,
  type ProviderUsage,
} from "./modelProviderClient";
import type { ChatAttachment, ChatMessage, ChatSummary } from "../types/chat";
import type { ProviderSettings } from "../types/settings";
import type { ProviderToolBridgeOptions } from "../toolBridge/types";
import { finalizeToolResult } from "../toolBridge/resultFinalizer";
import { createProviderVisibleToolSchema, decrementRemainingChars, normalizeRemainingChars } from "../toolBridge/adapters/sharedUtils";

interface ProviderContextUsageInput {
  chat: ChatSummary;
  contextWindowTokens: number;
  draftAttachments: ChatAttachment[];
  draftContent: string;
  settings: ProviderSettings;
  source: "estimate" | "openrouter" | "provider";
}

interface ProviderPayloadContextUsageInput {
  contextWindowTokens: number;
  messages: ChatMessage[];
  settings: ProviderSettings;
  source: "estimate" | "openrouter" | "provider";
  stream?: boolean;
  toolBridge?: ProviderToolBridgeOptions;
}

export interface ContextBudgetFitReport {
  fits: boolean;
  overflowTokens: number;
  requestedTotalTokens: number;
}

export class ContextBudgetEngine {
  estimateChatDraftUsage(input: ProviderContextUsageInput): ContextWindowUsage {
    const visibleMessages = input.chat.messages.filter((message) => message.status !== "error");
    const draftMessage = createDraftUsageMessage(input.draftContent, input.draftAttachments);
    const messages = draftMessage ? [...visibleMessages, draftMessage] : visibleMessages;

    return this.estimatePayloadUsage({
      chatMessageCount: visibleMessages.length,
      contextWindowTokens: input.contextWindowTokens,
      draftCount: draftMessage ? 1 : 0,
      messages,
      settings: input.settings,
      source: input.source,
    });
  }

  estimateProviderPayload(input: ProviderPayloadContextUsageInput): ContextWindowUsage {
    return this.estimatePayloadUsage({
      chatMessageCount: input.messages.length,
      contextWindowTokens: input.contextWindowTokens,
      draftCount: 0,
      messages: input.messages,
      settings: input.settings,
      source: input.source,
      stream: input.stream,
      toolBridge: input.toolBridge,
    });
  }

  createFitReport(usage: ContextWindowUsage): ContextBudgetFitReport {
    const requestedTotalTokens = usage.requestedTotalTokens ?? usage.totalTokens;
    const overflowTokens = Math.max(requestedTotalTokens - Math.max(usage.contextWindowTokens, 1), 0);

    return {
      fits: overflowTokens === 0,
      overflowTokens,
      requestedTotalTokens,
    };
  }

  private estimatePayloadUsage({
    chatMessageCount,
    contextWindowTokens,
    draftCount,
    messages,
    settings,
    source,
    stream = true,
    toolBridge,
  }: {
    chatMessageCount: number;
    contextWindowTokens: number;
    draftCount: number;
    messages: ChatMessage[];
    settings: ProviderSettings;
    source: "estimate" | "openrouter" | "provider";
    stream?: boolean;
    toolBridge?: ProviderToolBridgeOptions;
  }): ContextWindowUsage {
    return estimateProviderUsageFromMessages({
      chatMessageCount,
      contextWindowTokens,
      draftCount,
      messages,
      settings,
      source,
      stream,
      toolBridge,
    });
  }
}

export const contextBudgetEngine = new ContextBudgetEngine();

export function estimateModelProviderContextWindowUsage({
  chat,
  contextWindowTokens,
  draftAttachments,
  draftContent,
  settings,
  source,
}: ProviderContextUsageInput): ContextWindowUsage {
  return contextBudgetEngine.estimateChatDraftUsage({
    chat,
    contextWindowTokens,
    draftAttachments,
    draftContent,
    settings,
    source,
  });
}

export function estimateModelProviderPayloadUsage({
  contextWindowTokens,
  messages,
  settings,
  source,
  stream = true,
  toolBridge,
}: ProviderPayloadContextUsageInput): ContextWindowUsage {
  return contextBudgetEngine.estimateProviderPayload({
    contextWindowTokens,
    messages,
    settings,
    source,
    stream,
    toolBridge,
  });
}

function estimateProviderUsageFromMessages({
  chatMessageCount,
  contextWindowTokens,
  draftCount,
  messages,
  settings,
  source,
  stream = true,
  toolBridge,
}: {
  chatMessageCount: number;
  contextWindowTokens: number;
  draftCount: number;
  messages: ChatMessage[];
  settings: ProviderSettings;
  source: "estimate" | "openrouter" | "provider";
  stream?: boolean;
  toolBridge?: ProviderToolBridgeOptions;
}): ContextWindowUsage {
  const model = modelForMessages(settings, messages);
  const body = createProviderUsageRequestBody(settings, messages, model, stream, toolBridge, contextWindowTokens);
  const requestBody = body as Record<string, unknown> & { messages?: unknown };
  const promptParts = getProviderPromptParts(requestBody, chatMessageCount, draftCount);
  const chatMessages = messages.slice(0, chatMessageCount);
  const draftMessages = draftCount > 0 ? messages.slice(chatMessageCount, chatMessageCount + draftCount) : [];
  const messageAttachmentTokens = estimateAttachmentPayloadTokens(chatMessages);
  const draftAttachmentTokens = estimateAttachmentPayloadTokens(draftMessages);
  const systemTokens = estimateSerializedPartsTokens(promptParts.system);
  const messageTokens = estimateSerializedPartsTokens(promptParts.messages) + messageAttachmentTokens;
  const draftTokens = estimateSerializedPartsTokens(promptParts.draft) + draftAttachmentTokens;
  const boundedContextWindow = Math.max(contextWindowTokens || DEFAULT_CONTEXT_WINDOW_TOKENS, 1);
  const boundedMaxOutput = getProviderRequestMaxOutputTokens(requestBody, settings.maxTokens);
  const reasoningReserveTokens = estimateProviderRequestReasoningReserveTokens(settings, requestBody);
  const additionalReasoningReserveTokens = isReasoningReserveIncludedInMaxOutput(settings, requestBody) ? 0 : reasoningReserveTokens;
  const safetyMarginTokens = getContextWindowSafetyMarginTokens(boundedContextWindow);
  const serializedBodyTokens = estimateSerializedTokens(body) + messageAttachmentTokens + draftAttachmentTokens;
  const requestOverheadTokens = Math.max(serializedBodyTokens - systemTokens - messageTokens - draftTokens, estimateProviderControlTokens(body));
  const inputTokens = systemTokens + messageTokens + draftTokens + requestOverheadTokens;
  const totalTokens = inputTokens + boundedMaxOutput + additionalReasoningReserveTokens + safetyMarginTokens;
  const payloadBreakdown = createProviderPayloadBreakdown({
    draftCount,
    draftTokens,
    contextWindowTokens,
    maxOutputTokens: boundedMaxOutput,
    messages,
    messageTokens,
    reasoningReserveTokens,
    requestOverheadTokens,
    safetyMarginTokens,
    systemTokens,
    toolBridge,
  });

  return {
    availableTokens: Math.max(boundedContextWindow - totalTokens, 0),
    contextWindowTokens: boundedContextWindow,
    draftTokens,
    fitsContextWindow: totalTokens <= boundedContextWindow,
    inputTokens,
    maxOutputTokens: boundedMaxOutput,
    maxOutputTokenSource: "request",
    messageTokens,
    model,
    overflowTokens: Math.max(totalTokens - boundedContextWindow, 0),
    payloadBreakdown,
    requestOverheadTokens,
    requestedTotalTokens: totalTokens,
    reasoningReserveTokens,
    safetyMarginTokens,
    source,
    systemTokens,
    tokenSource: "estimate",
    totalTokens,
  };
}

export function applyProviderUsageToContextEstimate(estimate: ContextWindowUsage, usage: ProviderUsage | undefined): ContextWindowUsage {
  const promptTokens = normalizeUsageToken(usage?.prompt_tokens);
  const completionTokens = normalizeUsageToken(usage?.completion_tokens);
  const totalUsageTokens = normalizeUsageToken(usage?.total_tokens) ?? (promptTokens !== undefined && completionTokens !== undefined ? promptTokens + completionTokens : undefined);

  if (promptTokens === undefined) {
    return estimate;
  }

  const exactPromptTokens = Math.max(promptTokens, 0);
  const promptBreakdown = scalePromptBreakdown(estimate, exactPromptTokens);
  const effectiveOutputBudget = Math.max(estimate.maxOutputTokens, completionTokens ?? 0);
  const totalTokens = exactPromptTokens + effectiveOutputBudget + (estimate.safetyMarginTokens ?? 0);

  return {
    ...estimate,
    ...promptBreakdown,
    availableTokens: Math.max(estimate.contextWindowTokens - totalTokens, 0),
    fitsContextWindow: totalTokens <= estimate.contextWindowTokens,
    inputTokens: exactPromptTokens,
    openRouterCompletionTokens: completionTokens,
    openRouterTotalTokens: totalUsageTokens,
    overflowTokens: Math.max(totalTokens - estimate.contextWindowTokens, 0),
    requestedTotalTokens: totalTokens,
    tokenSource: "provider",
    totalTokens,
  };
}

export function projectDraftOntoProviderUsage(baseUsage: ContextWindowUsage, draftEstimate: ContextWindowUsage): ContextWindowUsage {
  const draftTokens = Math.max(Math.round(draftEstimate.draftTokens), 0);

  if (draftTokens === 0) {
    return baseUsage;
  }

  const maxOutputTokens = Math.max(Math.round(draftEstimate.maxOutputTokens), 0);
  const contextWindowTokens = Math.max(Math.round(draftEstimate.contextWindowTokens), 1);
  const inputTokens = baseUsage.inputTokens + draftTokens;
  const totalTokens = inputTokens + maxOutputTokens + (draftEstimate.safetyMarginTokens ?? baseUsage.safetyMarginTokens ?? 0);

  return {
    ...baseUsage,
    availableTokens: Math.max(contextWindowTokens - totalTokens, 0),
    contextWindowTokens,
    draftTokens,
    fitsContextWindow: totalTokens <= contextWindowTokens,
    inputTokens,
    maxOutputTokens,
    model: draftEstimate.model,
    openRouterCompletionTokens: undefined,
    openRouterTotalTokens: undefined,
    overflowTokens: Math.max(totalTokens - contextWindowTokens, 0),
    payloadBreakdown: mergeProjectedPayloadBreakdown(baseUsage.payloadBreakdown, draftEstimate.payloadBreakdown, draftTokens),
    payloadSpike: baseUsage.payloadSpike,
    requestedTotalTokens: totalTokens,
    safetyMarginTokens: draftEstimate.safetyMarginTokens ?? baseUsage.safetyMarginTokens,
    source: draftEstimate.source,
    tokenSource: "projected",
    totalTokens,
  };
}

export function annotateProviderPayloadSpike(
  usage: ContextWindowUsage,
  previousUsage: ContextWindowUsage | null | undefined,
): ContextWindowUsage {
  if (!previousUsage || previousUsage.inputTokens <= 0) {
    return usage;
  }

  const deltaTokens = Math.round(usage.inputTokens - previousUsage.inputTokens);
  const percentOfWindow = usage.inputTokens / Math.max(usage.contextWindowTokens, 1);
  const previousPercentOfWindow = previousUsage.inputTokens / Math.max(previousUsage.contextWindowTokens, 1);
  const jumpedByRatio = usage.inputTokens >= previousUsage.inputTokens * 1.35 && deltaTokens >= 8_000;
  const crossedHighWater = percentOfWindow >= 0.7 && previousPercentOfWindow < 0.6 && deltaTokens >= 8_000;

  if (!jumpedByRatio && !crossedHighWater) {
    return usage;
  }

  const topContributors = [...(usage.payloadBreakdown ?? [])]
    .filter((item) => item.tokens > 0 && item.id !== "maxOutput" && item.id !== "reasoningReserve" && item.id !== "safetyMargin")
    .sort((left, right) => right.tokens - left.tokens)
    .slice(0, 3);
  const summary = [
    `Payload estimate jumped by ${formatTokenDelta(deltaTokens)} to ${formatTokenCountForDetail(usage.inputTokens)}.`,
    topContributors.length > 0
      ? `Largest parts: ${topContributors.map((item) => `${item.label} ${formatTokenCountForDetail(item.tokens)}`).join("; ")}.`
      : "",
  ].filter(Boolean).join(" ");

  return {
    ...usage,
    payloadSpike: {
      currentInputTokens: usage.inputTokens,
      deltaTokens,
      percentOfWindow,
      previousInputTokens: previousUsage.inputTokens,
      summary,
      topContributors,
    },
  };
}

/**
 * Counts how many auto-compaction markers are present in a message list.
 *
 * Used to decide whether the displayed context counter may decrease on the
 * next provider call. A presence-only check ("does ANY message look like a
 * compaction marker?") is wrong here because compaction markers persist in
 * the chat history forever — once any past compaction has happened, a
 * presence check would silently disable the high-water-mark protection
 * for every subsequent helper / sub-agent / streaming update, letting the
 * displayed counter collapse to whatever the latest helper payload measures.
 *
 * Counting the markers and only allowing a decrease when the count has
 * grown since the last recorded usage means we treat compactions as
 * one-shot events, not as a permanent "from now on you can shrink" flag.
 */
export function countAutoCompactedProviderMessages(messages: ChatMessage[]): number {
  let count = 0;
  for (const message of messages) {
    if (message.id.startsWith("context-compaction-") || message.content.startsWith("AUTO COMPACTED CONTEXT")) {
      count += 1;
    }
  }
  return count;
}

export function preserveContextUsageHighWaterMark(
  usage: ContextWindowUsage,
  previousUsage: ContextWindowUsage | null | undefined,
  options: { allowDecrease?: boolean } = {},
): ContextWindowUsage {
  const previousOverBudget = previousUsage ? isUsageOverRequestBudget(previousUsage) : false;
  const usageOverBudget = isUsageOverRequestBudget(usage);

  if (
    !previousUsage ||
    options.allowDecrease ||
    usage.inputTokens >= previousUsage.inputTokens ||
    (previousOverBudget && !usageOverBudget)
  ) {
    return usage;
  }

  const preservedInputTokens = Math.max(Math.round(previousUsage.inputTokens), 0);
  const inputDelta = preservedInputTokens - Math.max(Math.round(usage.inputTokens), 0);
  const nonInputTokens = Math.max(
    Math.round((usage.requestedTotalTokens ?? usage.totalTokens) - usage.inputTokens),
    0,
  );
  const totalTokens = preservedInputTokens + nonInputTokens;

  return {
    ...usage,
    availableTokens: Math.max(usage.contextWindowTokens - totalTokens, 0),
    fitsContextWindow: totalTokens <= usage.contextWindowTokens,
    inputTokens: preservedInputTokens,
    messageTokens: usage.messageTokens + inputDelta,
    openRouterCompletionTokens: undefined,
    openRouterTotalTokens: undefined,
    overflowTokens: Math.max(totalTokens - usage.contextWindowTokens, 0),
    payloadBreakdown: preservePayloadBreakdownInputFloor(usage.payloadBreakdown, inputDelta),
    requestedTotalTokens: totalTokens,
    tokenSource: "projected",
    totalTokens,
  };
}

function isUsageOverRequestBudget(usage: ContextWindowUsage) {
  return usage.fitsContextWindow === false ||
    (usage.overflowTokens ?? 0) > 0 ||
    (usage.requestedTotalTokens ?? usage.totalTokens) > Math.max(usage.contextWindowTokens, 1);
}

function createDraftUsageMessage(content: string, attachments: ChatAttachment[]): ChatMessage | null {
  if (!content.trim() && attachments.length === 0) {
    return null;
  }

  return {
    attachments,
    content,
    createdAt: new Date().toISOString(),
    id: "draft-context-preview",
    role: "user",
  };
}

function isReasoningReserveIncludedInMaxOutput(settings: ProviderSettings, body: Record<string, unknown>) {
  if (!settings.thinking.enabled) {
    return true;
  }

  if (settings.provider === "openai" && "max_output_tokens" in body) {
    return true;
  }

  return false;
}

function createProviderPayloadBreakdown({
  draftCount,
  draftTokens,
  contextWindowTokens,
  maxOutputTokens,
  messages,
  messageTokens,
  reasoningReserveTokens,
  requestOverheadTokens,
  safetyMarginTokens,
  systemTokens,
  toolBridge,
}: {
  draftCount: number;
  draftTokens: number;
  contextWindowTokens: number;
  maxOutputTokens: number;
  messages: ChatMessage[];
  messageTokens: number;
  reasoningReserveTokens: number;
  requestOverheadTokens: number;
  safetyMarginTokens: number;
  systemTokens: number;
  toolBridge?: ProviderToolBridgeOptions;
}): ContextWindowPayloadBreakdownItem[] {
  const attachmentTokens = estimateAttachmentPayloadTokens(messages);
  const draftMessages = draftCount > 0 ? messages.slice(Math.max(messages.length - draftCount, 0)) : [];
  const draftAttachmentTokens = estimateAttachmentPayloadTokens(draftMessages);
  const chatAttachmentTokens = Math.max(attachmentTokens - draftAttachmentTokens, 0);
  const persistedToolOutputTokens = estimatePersistedToolOutputTokens(messages, contextWindowTokens);
  const bridgeToolOutputTokens = estimateBridgeToolResultTokenParts(toolBridge);
  const toolSchemaTokens = estimateToolSchemaTokens(toolBridge);
  const toolOutputTokens = persistedToolOutputTokens + bridgeToolOutputTokens.other;
  const chatHistoryTokens = Math.max(messageTokens - chatAttachmentTokens - persistedToolOutputTokens, 0);
  const providerEnvelopeTokens = Math.max(requestOverheadTokens - bridgeToolOutputTokens.total - toolSchemaTokens, 0);
  const toolOutputCount = countToolOutputs(messages, toolBridge);
  const attachmentCount = countAttachments(messages);
  const toolSchemaCount = getProviderVisibleBridgeTools(toolBridge).length;
  const items: ContextWindowPayloadBreakdownItem[] = [
    {
      detail: `${Math.max(messages.length - draftCount, 0)} chat message${messages.length - draftCount === 1 ? "" : "s"}`,
      id: "chatHistory",
      label: "Chat history",
      tokens: chatHistoryTokens,
    },
    {
      detail: `${toolOutputCount} tool output surface${toolOutputCount === 1 ? "" : "s"}`,
      id: "toolOutput",
      label: "Tool output",
      tokens: toolOutputTokens,
    },
    {
      detail: "Provider-visible memory_search output attached to this request.",
      id: "memory",
      label: "Memory",
      tokens: bridgeToolOutputTokens.memory,
    },
    {
      detail: "Provider-visible web_search output attached to this request.",
      id: "web",
      label: "Web",
      tokens: bridgeToolOutputTokens.web,
    },
    {
      detail: `${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"}`,
      id: "attachments",
      label: "Attachments",
      tokens: attachmentTokens,
    },
    {
      id: "draft",
      label: "Draft",
      tokens: draftTokens,
    },
    {
      id: "system",
      label: "System/runtime",
      tokens: systemTokens,
    },
    {
      detail: `${toolSchemaCount} advertised tool schema${toolSchemaCount === 1 ? "" : "s"}`,
      id: "toolSchemas",
      label: "Tool schemas",
      tokens: toolSchemaTokens,
    },
    {
      id: "providerEnvelope",
      label: "Provider envelope",
      tokens: providerEnvelopeTokens,
    },
    {
      detail: "Reserved by the outgoing provider request for visible output.",
      id: "maxOutput",
      label: "Max output",
      tokens: maxOutputTokens,
    },
    {
      detail: "Thinking/reasoning budget tracked separately from visible chat input.",
      id: "reasoningReserve",
      label: "Reasoning reserve",
      tokens: reasoningReserveTokens,
    },
    {
      detail: "Safety margin for tokenizer/provider-envelope drift.",
      id: "safetyMargin",
      label: "Safety margin",
      tokens: safetyMarginTokens,
    },
  ];

  return items.filter((item) => item.tokens > 0 || item.id === "chatHistory");
}

function mergeProjectedPayloadBreakdown(
  baseBreakdown: ContextWindowPayloadBreakdownItem[] | undefined,
  draftBreakdown: ContextWindowPayloadBreakdownItem[] | undefined,
  draftTokens: number,
) {
  const items = [...(baseBreakdown ?? [])];
  const draftItem = draftBreakdown?.find((item) => item.id === "draft");
  const existingDraftIndex = items.findIndex((item) => item.id === "draft");
  const projectedDraft: ContextWindowPayloadBreakdownItem = {
    detail: draftItem?.detail ?? (draftTokens > 0 ? "Current composer draft" : undefined),
    id: "draft",
    label: "Draft",
    tokens: draftTokens,
  };

  if (existingDraftIndex >= 0) {
    items[existingDraftIndex] = projectedDraft;
  } else if (draftTokens > 0) {
    items.push(projectedDraft);
  }

  return items.length > 0 ? items : undefined;
}

function estimateSerializedTokens(value: unknown): number {
  const sanitizedValue = sanitizeEmbeddedDataUrlsForTokenEstimate(value);
  const serialized = typeof sanitizedValue === "string" ? sanitizedValue : JSON.stringify(sanitizedValue);
  return estimateTextTokens(serialized || "");
}

function estimateSerializedPartsTokens(parts: unknown[]): number {
  return parts.reduce<number>((total, part) => total + estimateSerializedTokens(part), 0);
}

function estimateAttachmentPayloadTokens(messages: ChatMessage[]) {
  return messages.reduce(
    (total, message) => total + (message.attachments ?? []).reduce((attachmentTotal, attachment) => attachmentTotal + estimateAttachmentPayloadToken(attachment), 0),
    0,
  );
}

function estimateAttachmentPayloadToken(attachment: ChatAttachment) {
  const metadataTokens = estimateTextTokens(`${attachment.kind} ${attachment.name} ${attachment.mimeType} ${attachment.size} bytes`);

  if (attachment.kind === "image") {
    return metadataTokens + 1200;
  }

  if (attachment.kind === "video") {
    return metadataTokens + Math.max(2400, Math.ceil(attachment.size / 32));
  }

  return Math.max(80, metadataTokens + estimateTextTokens(attachment.text ?? ""));
}

function estimatePersistedToolOutputTokens(messages: ChatMessage[], contextWindowTokens: number) {
  return estimateTextTokens(
    messages
      .map((message) => createMessageContextSurface(message, { contextWindowTokens }))
      .filter(Boolean)
      .join("\n\n"),
  );
}

function estimateBridgeToolResultTokenParts(toolBridge: ProviderToolBridgeOptions | undefined) {
  if (!toolBridge?.toolResultMessages?.length) {
    return {
      memory: 0,
      other: 0,
      total: 0,
      web: 0,
    };
  }

  let remainingToolResultChars = normalizeRemainingChars(toolBridge.maxToolResultContentChars);
  const parts = {
    memory: 0,
    other: 0,
    total: 0,
    web: 0,
  };

  for (const message of toolBridge.toolResultMessages) {
    const finalization = finalizeToolResult({
        arguments: message.arguments,
        maxProviderChars: remainingToolResultChars,
        result: message.result,
        toolId: message.name,
    });
    remainingToolResultChars = decrementRemainingChars(remainingToolResultChars, finalization.providerRawCharCount);
    const tokens = estimateTextTokens(finalization.providerContent);

    if (message.name === "memory_search") {
      parts.memory += tokens;
    } else if (message.name === "web_search") {
      parts.web += tokens;
    } else {
      parts.other += tokens;
    }
  }

  parts.total = parts.memory + parts.web + parts.other;
  return parts;
}

function estimateToolSchemaTokens(toolBridge: ProviderToolBridgeOptions | undefined) {
  return estimateSerializedTokens(getProviderVisibleBridgeTools(toolBridge).map(createProviderVisibleToolSchema));
}

function getProviderVisibleBridgeTools(toolBridge: ProviderToolBridgeOptions | undefined) {
  const tools = toolBridge?.tools ?? [];
  const providerVisibleToolIds = toolBridge?.providerVisibleToolIds ?? toolBridge?.capabilityPlan?.providerVisibleToolIds;

  return providerVisibleToolIds ? tools.filter((tool) => providerVisibleToolIds.includes(tool.id)) : tools;
}

function countToolOutputs(messages: ChatMessage[], toolBridge: ProviderToolBridgeOptions | undefined) {
  return messages.reduce((count, message) => count + (message.toolCalls?.length ?? 0), 0) + (toolBridge?.toolResultMessages?.length ?? 0);
}

function countAttachments(messages: ChatMessage[]) {
  return messages.reduce((count, message) => count + (message.attachments?.length ?? 0), 0);
}

function sanitizeEmbeddedDataUrlsForTokenEstimate(value: unknown): unknown {
  if (typeof value === "string") {
    return sanitizeEmbeddedDataUrlStringForTokenEstimate(value);
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeEmbeddedDataUrlsForTokenEstimate);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, sanitizeEmbeddedDataUrlsForTokenEstimate(item)]),
  );
}

function sanitizeEmbeddedDataUrlStringForTokenEstimate(value: string) {
  if (/^data:/i.test(value)) {
    return formatEmbeddedDataUrlTokenPlaceholder(value);
  }

  return value.replace(/data:([^;,]+);base64,[A-Za-z0-9+/=]+/g, (dataUrl) => formatEmbeddedDataUrlTokenPlaceholder(dataUrl));
}

function formatEmbeddedDataUrlTokenPlaceholder(dataUrl: string) {
  const mimeType = dataUrl.match(/^data:([^;,]+)[;,]/i)?.[1] ?? "media";
  return `[embedded ${mimeType}, ${formatByteCount(estimateDataUrlBytes(dataUrl))}; data URL omitted from token estimate]`;
}

function estimateDataUrlBytes(dataUrl: string) {
  const base64 = dataUrl.includes(",") ? dataUrl.split(",").pop() ?? "" : dataUrl;
  return Math.max(0, Math.floor((base64.length * 3) / 4));
}

function formatByteCount(sizeBytes: number) {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return "0 bytes";
  }

  if (sizeBytes < 1024) {
    return `${Math.round(sizeBytes)} bytes`;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${Math.ceil(sizeBytes / 1024)} KB`;
  }

  return `${(sizeBytes / 1024 / 1024).toFixed(sizeBytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function formatTokenDelta(tokens: number) {
  const prefix = tokens >= 0 ? "+" : "-";
  return `${prefix}${formatTokenCountForDetail(Math.abs(tokens))}`;
}

function formatTokenCountForDetail(tokens: number) {
  const rounded = Math.max(Math.round(tokens), 0);

  if (rounded >= 1_000_000) {
    return `${trimTokenNumber(rounded / 1_000_000)}M tokens`;
  }

  if (rounded >= 1_000) {
    return `${trimTokenNumber(rounded / 1_000)}k tokens`;
  }

  return `${rounded} tokens`;
}

function trimTokenNumber(value: number) {
  return value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1).replace(/\.0$/, "") : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function estimateProviderControlTokens(body: ReturnType<typeof createProviderUsageRequestBody>): number {
  const {
    input: _input,
    instructions: _instructions,
    messages: _messages,
    system: _system,
    ...controlBody
  } = body as Record<string, unknown> & {
    input?: unknown;
    instructions?: unknown;
    messages?: unknown;
    system?: unknown;
  };

  return estimateSerializedTokens(controlBody);
}

function getProviderPromptParts(
  requestBody: Record<string, unknown>,
  chatMessageCount: number,
  draftCount: number,
): {
  draft: unknown[];
  messages: unknown[];
  system: unknown[];
} {
  if (Array.isArray(requestBody.input)) {
    const inputMessages = requestBody.input;

    return {
      draft: draftCount > 0 ? inputMessages.slice(chatMessageCount, chatMessageCount + draftCount) : [],
      messages: inputMessages.slice(0, chatMessageCount),
      system: requestBody.instructions === undefined ? [] : [requestBody.instructions],
    };
  }

  const bodyMessages = Array.isArray(requestBody.messages) ? requestBody.messages : [];

  if (requestBody.system !== undefined) {
    return {
      draft: draftCount > 0 ? bodyMessages.slice(chatMessageCount, chatMessageCount + draftCount) : [],
      messages: bodyMessages.slice(0, chatMessageCount),
      system: Array.isArray(requestBody.system) ? requestBody.system : [requestBody.system],
    };
  }

  const hasSystemMessage = isProviderSystemMessage(bodyMessages[0]);
  const firstChatMessageIndex = hasSystemMessage ? 1 : 0;

  return {
    draft: draftCount > 0 ? bodyMessages.slice(firstChatMessageIndex + chatMessageCount, firstChatMessageIndex + chatMessageCount + draftCount) : [],
    messages: bodyMessages.slice(firstChatMessageIndex, firstChatMessageIndex + chatMessageCount),
    system: hasSystemMessage ? [bodyMessages[0]] : [],
  };
}

function isProviderSystemMessage(value: unknown) {
  return Boolean(value && typeof value === "object" && "role" in value && (value as { role?: unknown }).role === "system");
}

function scalePromptBreakdown(estimate: ContextWindowUsage, exactPromptTokens: number) {
  const estimatedPromptTokens = Math.max(estimate.systemTokens + estimate.messageTokens + estimate.draftTokens + estimate.requestOverheadTokens, 1);
  const systemTokens = Math.round((estimate.systemTokens / estimatedPromptTokens) * exactPromptTokens);
  const messageTokens = Math.round((estimate.messageTokens / estimatedPromptTokens) * exactPromptTokens);
  const draftTokens = Math.round((estimate.draftTokens / estimatedPromptTokens) * exactPromptTokens);
  const requestOverheadTokens = Math.max(exactPromptTokens - systemTokens - messageTokens - draftTokens, 0);

  return {
    draftTokens,
    messageTokens,
    requestOverheadTokens,
    systemTokens,
  };
}

function preservePayloadBreakdownInputFloor(breakdown: ContextWindowUsage["payloadBreakdown"], inputDelta: number) {
  if (!breakdown?.length || inputDelta <= 0) {
    return breakdown;
  }

  let applied = false;
  const preserved = breakdown.map((item) => {
    if (item.id !== "chatHistory") {
      return item;
    }

    applied = true;
    return {
      ...item,
      tokens: item.tokens + inputDelta,
    };
  });

  if (applied) {
    return preserved;
  }

  return [
    ...preserved,
    {
      id: "chatHistory",
      label: "Chat, tools, sources",
      tokens: inputDelta,
    },
  ] satisfies ContextWindowUsage["payloadBreakdown"];
}

function normalizeUsageToken(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
}
