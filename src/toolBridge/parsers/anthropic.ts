import type { ModelProviderId } from "../../types/settings";
import type { ToolCallRequest } from "../types";
import { createToolCallRequest } from "./common";

interface AnthropicContentBlock {
  id?: string;
  input?: unknown;
  name?: string;
  type?: string;
}

export interface AnthropicToolCallDelta {
  argumentsDelta?: string;
  argumentsSnapshot?: unknown;
  id?: string;
  index: number;
  name?: string;
  raw?: unknown;
}

export function parseAnthropicToolCalls(payload: unknown, provider: ModelProviderId): ToolCallRequest[] {
  const blocks = Array.isArray((payload as { content?: unknown })?.content) ? ((payload as { content: AnthropicContentBlock[] }).content) : [];

  return blocks.flatMap((block, index) => {
    if (block.type !== "tool_use") {
      return [];
    }

    const parsed = createToolCallRequest(provider, block.id, block.name, block.input ?? {}, block);
    return parsed ? [{ ...parsed, id: parsed.id || `tool-use-${index + 1}` }] : [];
  });
}

export function parseAnthropicStreamToolCallDelta(event: unknown): AnthropicToolCallDelta | null {
  const payload = event as {
    content_block?: AnthropicContentBlock;
    delta?: {
      partial_json?: string;
      type?: string;
    };
    index?: number;
    type?: string;
  };
  const index = typeof payload.index === "number" ? payload.index : 0;

  if (payload.content_block?.type === "tool_use") {
    return {
      argumentsSnapshot: payload.content_block.input ?? {},
      id: payload.content_block.id,
      index,
      name: payload.content_block.name,
      raw: payload,
    };
  }

  if (payload.delta?.type === "input_json_delta" || typeof payload.delta?.partial_json === "string") {
    return {
      argumentsDelta: payload.delta.partial_json ?? "",
      index,
      raw: payload,
    };
  }

  return null;
}
