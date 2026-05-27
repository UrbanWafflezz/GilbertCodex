import type { MutableRefObject, SetStateAction } from "react";

import type { LocalSubagentResult, LocalSubagentTask } from "../../../localWorkspace/localToolRuntimeDisabled";
import type { ContextCompactionNotice, ContextWindowUsage, compactMessagesForContext } from "../../../lib/contextWindow";
import type { createMessage as createMessageFn } from "../../../lib/chatUtils";
import { mergeVisibleReasoningSummaries } from "../../../lib/reasoningSummary";
import type { sendProviderMessage, streamProviderMessage } from "../../../services/modelProviderClient";
import type { ChatMessage, ChatProgressItem, ChatSummary } from "../../../types/chat";
import type { ProviderSettings } from "../../../types/settings";
import type { ProviderToolBridgeOptions } from "../../../toolBridge";
import type { mergeMessageWorkTrace as mergeMessageWorkTraceFn } from "../workspaceHelpers";

type ProviderStreamUpdate = Parameters<typeof streamProviderMessage>[2];
type ProviderStreamOptions = Parameters<typeof streamProviderMessage>[3];
type ProviderMessageResult = Awaited<ReturnType<typeof streamProviderMessage>>;
type ProviderCompactionResult = ReturnType<typeof compactMessagesForContext> & { contextCompaction?: ContextCompactionNotice };

export interface ProviderStreamingDeps {
  compactProviderMessages: (messages: ChatMessage[], settingsOverride: ProviderSettings, options: { target?: number; threshold?: number; toolBridge?: ProviderToolBridgeOptions }) => ProviderCompactionResult;
  createContextCompactionProgress: (compaction: ProviderCompactionResult) => ChatProgressItem;
  createEmptyResponseRetrySettings: (settings: ProviderSettings) => ProviderSettings;
  createFinalOnlyProviderSettings: (prompt?: string, chat?: ChatSummary | null | undefined) => ProviderSettings;
  createId: (prefix: string) => string;
  createInterruptedResponseContinuationInstruction: (prompt: string, message: ChatMessage) => string;
  createMessage: typeof createMessageFn;
  createProviderPayloadGuardrailProgress: (usage: ContextWindowUsage) => ChatProgressItem | null;
  createProviderRetryInstruction: (messages: ChatMessage[], emptyResponse: boolean) => string;
  hasLocalToolEvidence: (messages: ChatMessage[]) => boolean;
  isProviderEmptyResponseError: (error: unknown) => boolean;
  isRetryableProviderMessageError: (error: unknown) => boolean;
  isToolResultFallbackAnswer: (content: string) => boolean;
  LOCAL_TOOL_FINAL_MIN_TOKENS: number;
  mergeMessageWorkTrace: typeof mergeMessageWorkTraceFn;
  MESSAGE_RETRY_TIMEOUT_MS: number;
  pendingChatsRef: MutableRefObject<ChatSummary[]>;
  preserveVisibleResponseThinking: (previousMessage: ChatMessage, nextMessage: ChatMessage) => ChatMessage;
  recordProviderActualUsage: (
    chatId: string,
    messages: ChatMessage[],
    settings: ProviderSettings,
    usage: ProviderMessageResult["usage"],
    options: { allowDecrease?: boolean; stream?: boolean; toolBridge?: ProviderToolBridgeOptions },
  ) => void;
  recordProviderContextUsage: (
    chatId: string,
    messages: ChatMessage[],
    settings: ProviderSettings,
    options: { allowDecrease?: boolean; stream?: boolean; toolBridge?: ProviderToolBridgeOptions },
  ) => ContextWindowUsage;
  resolveContextWindowForModel: (model: string, settings: ProviderSettings) => { maxOutputTokens?: number; source: "estimate" | "openrouter" | "provider"; tokens: number };
  removeSteeringProgress: (progress: ChatProgressItem[] | undefined) => ChatProgressItem[] | undefined;
  runProviderRetryWithTimeout: <T>(parentSignal: AbortSignal | undefined, run: (signal: AbortSignal) => Promise<T>) => Promise<T>;
  sendProviderMessage: typeof sendProviderMessage;
  setChats: (action: SetStateAction<ChatSummary[]>) => void;
  setChatsLive?: (action: SetStateAction<ChatSummary[]>) => void;
  sortChatsByUpdatedAt: (chats: ChatSummary[]) => ChatSummary[];
  STEERING_PROGRESS_ID: string;
  streamProviderMessage: typeof streamProviderMessage;
  updateGeneratedMessage: (chatId: string, messageId: string, updateMessage: (message: ChatMessage) => ChatMessage, sortByUpdatedAt?: boolean) => void;
  withContextCompactionMarker: (message: ChatMessage, notice: ContextCompactionNotice | undefined) => ChatMessage;
  withContextCompactionProgress: (compactionProgress: ChatProgressItem, progress: ChatProgressItem[] | undefined) => ChatProgressItem[];
  withProviderPayloadGuardrailProgress: (guardrailProgress: ChatProgressItem | null, progress: ChatProgressItem[] | undefined) => ChatProgressItem[];
}

export async function runParallelSubagents(deps: ProviderStreamingDeps, tasks: LocalSubagentTask[], baseMessages: ChatMessage[], prompt: string, signal: AbortSignal, chat: ChatSummary | null | undefined): Promise<LocalSubagentResult[]> {
  const { createFinalOnlyProviderSettings, createMessage, resolveContextWindowForModel, sendProviderMessage } = deps;

    const baseSubagentSettings = createFinalOnlyProviderSettings(undefined, chat);
    const subagentSettings: ProviderSettings = {
      ...baseSubagentSettings,
      maxTokens: Math.max(baseSubagentSettings.maxTokens, 2048),
      temperature: Math.min(baseSubagentSettings.temperature ?? 0.7, 0.3),
    };

    return Promise.all(
      tasks.map(async (task, index) => {
        const title = task.title || `Sub-agent ${index + 1}`;

        try {
          const response = await sendProviderMessage(
            subagentSettings,
            [
              ...baseMessages,
              createMessage(
                "user",
                [
                  "PARALLEL SUB-AGENT TASK",
                  `Main user request: ${prompt}`,
                  `Sub-agent title: ${title}`,
                  task.prompt,
                  "Return concise findings with evidence from the provided chat/tool context. Do not claim to edit files or run tools.",
                ].join("\n\n"),
              ),
            ],
            {
              contextWindowTokens: resolveContextWindowForModel(subagentSettings.model, subagentSettings).tokens,
              signal,
            },
          );

          return {
            content: response.content,
            id: task.id || `subagent-${index + 1}`,
            title,
          };
        } catch (error) {
          return {
            content: "",
            error: error instanceof Error ? error.message : "Sub-agent failed.",
            id: task.id || `subagent-${index + 1}`,
            title,
          };
        }
      }),
    );
  }

export async function streamProviderMessageWithRetry(deps: ProviderStreamingDeps, chatId: string, settings: ProviderSettings, messages: ChatMessage[], onUpdate: ProviderStreamUpdate, options: ProviderStreamOptions = {}, messageId?: string) {
  const { compactProviderMessages, createContextCompactionProgress, createEmptyResponseRetrySettings, createMessage, createProviderPayloadGuardrailProgress, createProviderRetryInstruction, isProviderEmptyResponseError, isRetryableProviderMessageError, recordProviderActualUsage, recordProviderContextUsage, runProviderRetryWithTimeout, streamProviderMessage, updateGeneratedMessage, withContextCompactionMarker, withContextCompactionProgress, withProviderPayloadGuardrailProgress } = deps;

    const initialUsage = recordProviderContextUsage(chatId, messages, settings, { toolBridge: options.toolBridge });
    const initialPayloadGuardrailProgress = createProviderPayloadGuardrailProgress(initialUsage);

    if (messageId && initialPayloadGuardrailProgress) {
      updateGeneratedMessage(chatId, messageId, (message) => ({
        ...message,
        progress: withProviderPayloadGuardrailProgress(initialPayloadGuardrailProgress, message.progress),
      }));
    }

    try {
      const response = await streamProviderMessage(settings, messages, onUpdate, {
        ...options,
        contextWindowTokens: initialUsage.contextWindowTokens,
      });
      recordProviderActualUsage(chatId, messages, settings, response.usage, { toolBridge: options.toolBridge });
      return response;
    } catch (error) {
      if (options.signal?.aborted || !isRetryableProviderMessageError(error)) {
        throw error;
      }

      const retrySettings = createEmptyResponseRetrySettings(settings);
      const retryCompaction = compactProviderMessages(messages, retrySettings, {
        toolBridge: options.toolBridge,
      });
      const compactedMessages = retryCompaction.messages;

      if (messageId && retryCompaction.contextCompaction) {
        const compactionProgress = createContextCompactionProgress(retryCompaction);

        updateGeneratedMessage(chatId, messageId, (message) => ({
          ...withContextCompactionMarker(message, retryCompaction.contextCompaction),
          progress: withContextCompactionProgress(compactionProgress, message.progress),
        }));
      }

      const retryInstruction = createMessage(
        "user",
        createProviderRetryInstruction(messages, isProviderEmptyResponseError(error)),
      );
      const retryMessages = [...compactedMessages, retryInstruction];

      const retryUsage = recordProviderContextUsage(chatId, retryMessages, retrySettings, { toolBridge: options.toolBridge });
      const retryPayloadGuardrailProgress = createProviderPayloadGuardrailProgress(retryUsage);

      if (messageId && retryPayloadGuardrailProgress) {
        updateGeneratedMessage(chatId, messageId, (message) => ({
          ...message,
          progress: withProviderPayloadGuardrailProgress(retryPayloadGuardrailProgress, message.progress),
        }));
      }

      const response = await runProviderRetryWithTimeout(options.signal, (signal) =>
        streamProviderMessage(retrySettings, retryMessages, onUpdate, {
          ...options,
          contextWindowTokens: retryUsage.contextWindowTokens,
          signal,
        }),
      );
      recordProviderActualUsage(chatId, retryMessages, retrySettings, response.usage, { toolBridge: options.toolBridge });
      return response;
    }
  }

export async function runProviderRetryWithTimeout<T>(deps: ProviderStreamingDeps, parentSignal: AbortSignal | undefined, run: (signal: AbortSignal) => Promise<T>) {
  const { MESSAGE_RETRY_TIMEOUT_MS } = deps;

    const retryController = new AbortController();
    const abortRetry = () => retryController.abort();
    const timeoutId = window.setTimeout(abortRetry, MESSAGE_RETRY_TIMEOUT_MS);

    if (parentSignal?.aborted) {
      window.clearTimeout(timeoutId);
      throw new DOMException("The operation was aborted.", "AbortError");
    }

    parentSignal?.addEventListener("abort", abortRetry, { once: true });

    try {
      return await run(retryController.signal);
    } catch (error) {
      if (retryController.signal.aborted && !parentSignal?.aborted) {
        throw new Error("The response retry did not finish within 10 seconds.");
      }

      throw error;
    } finally {
      window.clearTimeout(timeoutId);
      parentSignal?.removeEventListener("abort", abortRetry);
    }
  }

export function createProviderRetryInstruction(deps: ProviderStreamingDeps, messages: ChatMessage[], emptyResponse: boolean) {
  const { hasLocalToolEvidence } = deps;

    return [
      emptyResponse ? "RETRY AFTER EMPTY PROVIDER RESPONSE" : "RETRY AFTER TRANSIENT PROVIDER FAILURE",
      emptyResponse ? "The previous stream produced no visible final answer." : "The previous provider request failed before a complete visible answer was produced.",
      hasLocalToolEvidence(messages)
        ? "Previously gathered observations are already present above. Use them silently: emit the next needed tool_call only if work is unfinished, or write the direct final answer if it is done."
        : "Answer the latest real user request above now.",
      "Produce visible answer text. Do not leave the visible answer blank.",
      "Do not mention provider behavior, app recovery, saved evidence, tool loops, continuation, fallback text, or retry attempts.",
    ].join("\n\n");
  }

export function isRetryableProviderMessageError(deps: ProviderStreamingDeps, error: unknown) {
  const { isProviderEmptyResponseError } = deps;

    if (isProviderEmptyResponseError(error)) {
      return true;
    }

    if (!(error instanceof Error)) {
      return false;
    }

    const message = error.message.toLowerCase();

    return (
      /\bhttp\s+(?:408|409|425|429|500|502|503|504|520|521|522|523|524)\b/.test(message) ||
      /\b(max(?:imum)? context length|context length|context window|too many tokens|requested about \d+ tokens|reduce the length)\b/.test(message) ||
      /\b(fetch failed|failed to fetch|network|timeout|timed out|temporarily unavailable|connection reset|connection refused|econnreset|etimedout)\b/.test(message)
    );
  }

export function hasLocalToolEvidence(_deps: ProviderStreamingDeps, messages: ChatMessage[]) {

    return messages.some(
      (message) =>
        message.content.includes("AGENT TOOL RESULTS") ||
        message.content.includes("LOCAL COMPUTER TOOL RESULTS") ||
        message.toolCalls?.some((toolCall) => toolCall.status === "complete" || toolCall.status === "error" || toolCall.status === "skipped"),
    );
  }

export function createEmptyResponseRetrySettings(deps: ProviderStreamingDeps, settings: ProviderSettings): ProviderSettings {
  const { LOCAL_TOOL_FINAL_MIN_TOKENS } = deps;

    const retrySettings: ProviderSettings = {
      ...settings,
      maxTokens: Math.max(settings.maxTokens, LOCAL_TOOL_FINAL_MIN_TOKENS),
      temperature: Math.min(settings.temperature, 0.25),
    };

    if (!settings.thinking.enabled) {
      return retrySettings;
    }

    return {
      ...retrySettings,
      thinking: {
        ...settings.thinking,
        enabled: false,
      },
    };
  }

export function updateGeneratedMessage(deps: ProviderStreamingDeps, chatId: string, messageId: string, updateMessage: (message: ChatMessage) => ChatMessage, sortByUpdatedAt = false) {
  const { pendingChatsRef, preserveVisibleResponseThinking, setChats, setChatsLive, sortChatsByUpdatedAt } = deps;

    let changed = false;
    let targetMessageStillStreaming = false;
    const currentChats = pendingChatsRef.current;
    const updatedAt = sortByUpdatedAt ? new Date().toISOString() : "";
    const nextChats = currentChats.map((chat) => {
      if (chat.id !== chatId) {
        return chat;
      }

      let chatChanged = false;
      const nextMessages = chat.messages.map((message) => {
        if (message.id !== messageId) {
          return message;
        }

        const nextMessage = preserveVisibleResponseThinking(message, updateMessage(message));

        if (nextMessage === message) {
          return message;
        }

        changed = true;
        chatChanged = true;
        targetMessageStillStreaming = nextMessage.isStreaming !== false;
        return nextMessage;
      });

      if (!chatChanged) {
        return chat;
      }

      return {
        ...chat,
        messages: nextMessages,
        updatedAt: sortByUpdatedAt ? updatedAt : chat.updatedAt,
      };
    });

    if (!changed) {
      return;
    }

    const committedChats = sortByUpdatedAt ? sortChatsByUpdatedAt(nextChats) : nextChats;
    const applyChats = !sortByUpdatedAt && targetMessageStillStreaming && setChatsLive ? setChatsLive : setChats;
    applyChats(committedChats);
  }

export function preserveVisibleResponseThinking(deps: ProviderStreamingDeps, previousMessage: ChatMessage, nextMessage: ChatMessage): ChatMessage {
  const { mergeMessageWorkTrace } = deps;

    if (previousMessage.role !== "assistant" || nextMessage.role !== "assistant") {
      return nextMessage;
    }

    return {
      ...nextMessage,
      reasoning: mergeVisibleReasoningSummaries(previousMessage.reasoning, nextMessage.reasoning) || undefined,
      workTrace: mergeMessageWorkTrace(previousMessage, nextMessage),
    };
  }

export function createInterruptedResponseContextMessages(deps: ProviderStreamingDeps, message: ChatMessage, prompt: string) {
  const { createId, createInterruptedResponseContinuationInstruction, createMessage, isToolResultFallbackAnswer } = deps;

    const content = message.content.includes("I reached the agent tool budget for this run") || isToolResultFallbackAnswer(message.content) ? "" : message.content;
    const assistantContext: ChatMessage = {
      ...message,
      agentRunStatus: undefined,
      content,
      id: createId("interrupted-response-context"),
      isStreaming: false,
      status: undefined,
    };

    return [assistantContext, createMessage("user", createInterruptedResponseContinuationInstruction(prompt, message))];
  }

export function createSteeringInstruction(_deps: ProviderStreamingDeps, steerContent: string, originalPrompt: string) {

    return [
      "USER STEERING MESSAGE",
      originalPrompt ? `Original user request: ${originalPrompt}` : "",
      "The user sent this while your response was in progress. Use it to steer the same response, not as a separate follow-up turn.",
      "Adjust course immediately and continue with one coherent answer.",
      steerContent,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

export function withSteeringProgress(deps: ProviderStreamingDeps, progress: ChatProgressItem[] | undefined) {
  const { removeSteeringProgress, STEERING_PROGRESS_ID } = deps;

    const progressWithoutSteering = removeSteeringProgress(progress) ?? [];

    return [
      {
        detail: "Applying queued steering message to this response",
        id: STEERING_PROGRESS_ID,
        label: "Steer response",
        status: "active",
      } satisfies ChatProgressItem,
      ...progressWithoutSteering,
    ];
  }

export function removeSteeringProgress(deps: ProviderStreamingDeps, progress: ChatProgressItem[] | undefined) {
  const { STEERING_PROGRESS_ID } = deps;

    const nextProgress = (progress ?? []).filter((item) => item.id !== STEERING_PROGRESS_ID);

    return nextProgress.length > 0 ? nextProgress : undefined;
  }
