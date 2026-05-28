import type { ProviderToolBridgeOptions, ToolDefinition, ToolResultMessage } from "../types";
import type { ProviderReasoningState } from "../../types/reasoning";
import { finalizeToolResult } from "../resultFinalizer";
import { createInlineToolResultMessage, createProviderVisibleToolSchema, decrementRemainingChars, normalizeRemainingChars } from "./sharedUtils";

export function applyResponsesToolBridge(body: Record<string, unknown>, options: ProviderToolBridgeOptions) {
  const tools = options.toolChoice === "none" ? [] : options.tools ?? [];

  if (tools.length > 0) {
    body.tools = tools.map(createResponsesToolSchema);
    body.tool_choice = options.toolChoice ?? "auto";
    if (typeof options.parallelToolCalls === "boolean") {
      body.parallel_tool_calls = options.parallelToolCalls;
    }
  } else if (options.toolChoice === "none" && options.toolResultDelivery !== "inline-user-message") {
    body.tool_choice = "none";
    delete body.tools;
  } else if (options.toolResultDelivery === "inline-user-message") {
    delete body.tool_choice;
    delete body.tools;
  }

  if (options.toolResultMessages?.length) {
    body.input = options.toolResultDelivery === "inline-user-message"
      ? appendInlineUserToolResultItems(body.input, options.toolResultMessages, {
          maxToolResultContentChars: options.maxToolResultContentChars,
        })
      : appendResponsesToolResultItems(body.input, options.toolResultMessages, {
          maxToolResultContentChars: options.maxToolResultContentChars,
          reasoningState: options.reasoningState,
          skipAssistantTurn: Boolean(options.resultsHistoryAlreadyContainsAssistantTurns),
        });
  }

  return body;
}

export function createResponsesToolSchema(tool: ToolDefinition) {
  const schema = createProviderVisibleToolSchema(tool);

  return {
    description: schema.description,
    name: schema.name,
    parameters: schema.inputSchema,
    // The Responses API normalizes omitted strictness toward strict schemas.
    // Gilbert's local tools intentionally have optional arguments, so keep
    // those schemas best-effort unless an individual tool opts into strictness.
    strict: false,
    type: "function",
  };
}

function appendResponsesToolResultItems(
  currentInput: unknown,
  results: ToolResultMessage[],
  options: { maxToolResultContentChars?: number | null; reasoningState?: ProviderReasoningState; skipAssistantTurn: boolean },
) {
  const input = Array.isArray(currentInput) ? [...currentInput] : [];
  let remainingToolResultChars = normalizeRemainingChars(options.maxToolResultContentChars);

  for (const result of results) {
    if (!options.skipAssistantTurn) {
      input.push(...createResponsesReasoningItems(options.reasoningState));
      input.push({
        arguments: JSON.stringify(result.arguments ?? {}),
        call_id: result.callId,
        name: result.name,
        type: "function_call",
      });
    }
    const finalization = finalizeToolResult({
      arguments: result.arguments,
      maxProviderChars: remainingToolResultChars,
      result: result.result,
      toolId: result.name,
    });
    const output = finalization.providerContent;
    remainingToolResultChars = decrementRemainingChars(remainingToolResultChars, finalization.providerRawCharCount);

    input.push({
      call_id: result.callId,
      output,
      type: "function_call_output",
    });
  }

  return input;
}

function createResponsesReasoningItems(reasoningState: ProviderReasoningState | undefined) {
  if (reasoningState?.format !== "openai-responses") {
    return [];
  }

  return reasoningState.entries
    .filter((entry) => entry.type === "reasoning")
    .map((entry) => entry.value)
    .filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value)));
}

function appendInlineUserToolResultItems(
  currentInput: unknown,
  results: ToolResultMessage[],
  options: { maxToolResultContentChars?: number | null },
) {
  const input = Array.isArray(currentInput) ? [...currentInput] : [];
  let remainingToolResultChars = normalizeRemainingChars(options.maxToolResultContentChars);

  for (const result of results) {
    const inlineResult = createInlineToolResultMessage(result, remainingToolResultChars);
    remainingToolResultChars = decrementRemainingChars(remainingToolResultChars, inlineResult.providerRawCharCount);
    input.push({
      content: inlineResult.content,
      role: "user",
    });
  }

  return input;
}
