import type { ModelProviderId } from "../../types/settings";
import type { ToolCallRequest } from "../types";
import { createToolCallRequest } from "./common";

interface OpenAiCompatibleToolCall {
  function?: {
    arguments?: unknown;
    args?: unknown;
    input?: unknown;
    name?: string;
    parameters?: unknown;
  };
  id?: string;
  index?: number;
  type?: string;
}

export interface OpenAiCompatibleToolCallDelta {
  argumentsDelta?: string;
  id?: string;
  index: number;
  name?: string;
  raw?: unknown;
}

export function parseOpenAiCompatibleToolCalls(message: unknown, provider: ModelProviderId): ToolCallRequest[] {
  const toolCalls = Array.isArray((message as { tool_calls?: unknown })?.tool_calls) ? ((message as { tool_calls: OpenAiCompatibleToolCall[] }).tool_calls) : [];

  return toolCalls.flatMap((call, index) => {
    const parsed = createToolCallRequest(provider, call.id, call.function?.name, getFunctionToolArguments(call.function), call);
    return parsed ? [{ ...parsed, id: parsed.id || `tool-call-${index + 1}` }] : [];
  });
}

export function parseOpenAiCompatibleStreamToolCallDeltas(chunk: unknown): OpenAiCompatibleToolCallDelta[] {
  const choice = Array.isArray((chunk as { choices?: unknown })?.choices) ? (chunk as { choices: Array<{ delta?: { tool_calls?: OpenAiCompatibleToolCall[] } }> }).choices[0] : undefined;
  const toolCalls = choice?.delta?.tool_calls ?? [];

  return toolCalls.map((call, fallbackIndex) => ({
    argumentsDelta: typeof call.function?.arguments === "string" ? call.function.arguments : undefined,
    id: call.id,
    index: typeof call.index === "number" ? call.index : fallbackIndex,
    name: call.function?.name,
    raw: call,
  }));
}

function getFunctionToolArguments(fn: OpenAiCompatibleToolCall["function"]) {
  if (!fn || typeof fn !== "object") {
    return undefined;
  }

  return fn.arguments ?? fn.parameters ?? fn.args ?? fn.input;
}
