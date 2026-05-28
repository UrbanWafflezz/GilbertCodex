import type { ModelProviderId } from "../../types/settings";
import type { ToolCallRequest } from "../types";
import { createToolCallRequest } from "./common";

interface OpenAiCompatibleToolCall {
  function?: {
    arguments?: string;
    name?: string;
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
    const parsed = createToolCallRequest(provider, call.id, call.function?.name, call.function?.arguments, call);
    return parsed ? [{ ...parsed, id: parsed.id || `tool-call-${index + 1}` }] : [];
  });
}

export function parseOpenAiCompatibleStreamToolCallDeltas(chunk: unknown): OpenAiCompatibleToolCallDelta[] {
  const choice = Array.isArray((chunk as { choices?: unknown })?.choices) ? (chunk as { choices: Array<{ delta?: { tool_calls?: OpenAiCompatibleToolCall[] } }> }).choices[0] : undefined;
  const toolCalls = choice?.delta?.tool_calls ?? [];

  return toolCalls.map((call, fallbackIndex) => ({
    argumentsDelta: call.function?.arguments,
    id: call.id,
    index: typeof call.index === "number" ? call.index : fallbackIndex,
    name: call.function?.name,
    raw: call,
  }));
}
