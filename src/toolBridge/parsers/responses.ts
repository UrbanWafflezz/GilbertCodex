import type { ModelProviderId } from "../../types/settings";
import type { ToolCallRequest } from "../types";
import { createToolCallRequest } from "./common";

interface ResponsesFunctionCall {
  arguments?: string;
  call_id?: string;
  id?: string;
  name?: string;
  type?: string;
}

export interface ResponsesToolCallStreamDelta {
  argumentsDelta?: string;
  argumentsSnapshot?: unknown;
  id?: string;
  index: number;
  name?: string;
  raw?: unknown;
}

export function parseResponsesToolCalls(payload: unknown, provider: ModelProviderId): ToolCallRequest[] {
  const output = Array.isArray((payload as { output?: unknown })?.output) ? ((payload as { output: ResponsesFunctionCall[] }).output) : [];

  return output.flatMap((item, index) => {
    if (item.type !== "function_call") {
      return [];
    }

    const parsed = createToolCallRequest(provider, item.call_id ?? item.id, item.name, item.arguments, item);
    return parsed ? [{ ...parsed, id: parsed.id || `function-call-${index + 1}` }] : [];
  });
}

export function parseResponsesStreamToolCalls(event: unknown, provider: ModelProviderId): ToolCallRequest[] {
  const payload = event as {
    item?: ResponsesFunctionCall;
    response?: unknown;
    type?: string;
  };

  if (payload.response) {
    return parseResponsesToolCalls(payload.response, provider);
  }

  if (payload.item?.type === "function_call") {
    const parsed = createToolCallRequest(provider, payload.item.call_id ?? payload.item.id, payload.item.name, payload.item.arguments, payload.item);
    return parsed ? [parsed] : [];
  }

  return [];
}

export function parseResponsesStreamToolCallDeltas(event: unknown): ResponsesToolCallStreamDelta[] {
  const payload = event as {
    arguments?: string;
    delta?: string;
    item?: ResponsesFunctionCall;
    name?: string;
    output_index?: number;
    type?: string;
  };
  const type = payload.type ?? "";
  const index = typeof payload.output_index === "number" ? payload.output_index : 0;

  if (payload.item?.type === "function_call") {
    return [{
      argumentsDelta: payload.item.arguments ?? "",
      id: payload.item.call_id ?? payload.item.id,
      index,
      name: payload.item.name,
      raw: payload,
    }];
  }

  if (type.includes("function_call_arguments.delta")) {
    return [{
      argumentsDelta: payload.delta ?? "",
      index,
      raw: payload,
    }];
  }

  if (type.includes("function_call_arguments.done")) {
    return [{
      argumentsSnapshot: payload.arguments ?? "",
      index,
      name: payload.name ?? payload.item?.name,
      raw: payload,
    }];
  }

  return [];
}
