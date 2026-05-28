import type { ProviderToolBridgeOptions, ToolDefinition, ToolResultMessage } from "../types";
import type { ProviderReasoningState } from "../../types/reasoning";
import { finalizeToolResult } from "../resultFinalizer";
import { appendInlineUserToolResultMessages, createProviderVisibleToolSchema, decrementRemainingChars, normalizeRemainingChars } from "./sharedUtils";

export function applyOpenAiCompatibleToolBridge(body: Record<string, unknown>, options: ProviderToolBridgeOptions) {
  const tools = options.toolChoice === "none" ? [] : options.tools ?? [];

  if (tools.length > 0) {
    body.tools = tools.map(createOpenAiCompatibleToolSchema);
    body.tool_choice = options.toolChoice ?? "auto";
    if (typeof options.parallelToolCalls === "boolean") {
      body.parallel_tool_calls = options.parallelToolCalls;
    }
  } else if (options.toolChoice === "none" && options.toolResultDelivery !== "inline-user-message") {
    // Propagate explicit disable so callers can suppress additional tool calls mid-conversation.
    body.tool_choice = "none";
    delete body.tools;
  } else if (options.toolResultDelivery === "inline-user-message") {
    delete body.tool_choice;
    delete body.tools;
  }

  if (options.toolResultMessages?.length) {
    body.messages = options.toolResultDelivery === "inline-user-message"
      ? appendInlineUserToolResultMessages(body.messages, options.toolResultMessages, {
          maxToolResultContentChars: options.maxToolResultContentChars,
        })
      : appendOpenAiCompatibleToolResultMessages(body.messages, options.toolResultMessages, {
          maxToolResultContentChars: options.maxToolResultContentChars,
          reasoningState: options.reasoningState,
          skipAssistantTurn: Boolean(options.resultsHistoryAlreadyContainsAssistantTurns),
        });
  }

  return body;
}

export function createOpenAiCompatibleToolSchema(tool: ToolDefinition) {
  const schema = createProviderVisibleToolSchema(tool);

  return {
    function: {
      description: schema.description,
      name: schema.name,
      parameters: schema.inputSchema,
    },
    type: "function",
  };
}

function appendOpenAiCompatibleToolResultMessages(
  currentMessages: unknown,
  results: ToolResultMessage[],
  options: { maxToolResultContentChars?: number | null; reasoningState?: ProviderReasoningState; skipAssistantTurn: boolean },
) {
  const messages = Array.isArray(currentMessages) ? [...currentMessages] : [];
  let remainingToolResultChars = normalizeRemainingChars(options.maxToolResultContentChars);

  for (const result of results) {
    if (!options.skipAssistantTurn) {
      messages.push({
        content: null,
        ...createOpenAiCompatibleReasoningFields(options.reasoningState),
        role: "assistant",
        tool_calls: [
          {
            function: {
              arguments: JSON.stringify(result.arguments ?? {}),
              name: result.name,
            },
            id: result.callId,
            type: "function",
          },
        ],
      });
    }
    const finalization = finalizeToolResult({
      arguments: result.arguments,
      maxProviderChars: remainingToolResultChars,
      result: result.result,
      toolId: result.name,
    });
    const content = finalization.providerContent;
    remainingToolResultChars = decrementRemainingChars(remainingToolResultChars, finalization.providerRawCharCount);

    messages.push({
      content,
      role: "tool",
      tool_call_id: result.callId,
    });
  }

  return messages;
}

function createOpenAiCompatibleReasoningFields(reasoningState: ProviderReasoningState | undefined) {
  if (!reasoningState?.entries.length) {
    return {};
  }

  if (reasoningState.format === "openrouter-reasoning") {
    const reasoningDetails = reasoningState.entries
      .filter((entry) => entry.type === "reasoning_details")
      .flatMap((entry) => Array.isArray(entry.value) ? entry.value : [entry.value]);

    return reasoningDetails.length > 0 ? { reasoning_details: reasoningDetails } : {};
  }

  if (reasoningState.format === "deepseek-reasoning") {
    const reasoningContent = reasoningState.entries
      .filter((entry) => entry.type === "reasoning_content")
      .map((entry) => entry.value)
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .join("");

    return reasoningContent ? { reasoning_content: reasoningContent } : {};
  }

  const reasoning = reasoningState.entries
    .filter((entry) => entry.type === "reasoning" || entry.type === "thinking")
    .map((entry) => entry.value)
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join("");

  return reasoning ? { reasoning } : {};
}
