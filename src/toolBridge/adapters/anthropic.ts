import type { ProviderToolBridgeOptions, ToolDefinition, ToolResultMessage } from "../types";
import type { ProviderReasoningState } from "../../types/reasoning";
import { finalizeToolResult } from "../resultFinalizer";
import { appendInlineUserToolResultMessages, createProviderVisibleToolSchema, decrementRemainingChars, normalizeRemainingChars } from "./sharedUtils";

export function applyAnthropicToolBridge(body: Record<string, unknown>, options: ProviderToolBridgeOptions) {
  const tools = options.toolChoice === "none" ? [] : options.tools ?? [];

  if (tools.length > 0) {
    body.tools = addAnthropicToolCacheControl(tools.map(createAnthropicToolSchema));

    if (options.toolChoice === "required") {
      body.tool_choice = { type: "any" };
    } else if (options.toolChoice === "auto") {
      body.tool_choice = { type: "auto" };
    }
  } else if (options.toolChoice === "none") {
    // Anthropic treats absent tools as the disable signal when no tools are attached.
    delete body.tools;
    delete body.tool_choice;
  }

  if (options.toolResultMessages?.length) {
    body.messages = options.toolResultDelivery === "inline-user-message"
      ? appendInlineUserToolResultMessages(body.messages, options.toolResultMessages, {
          maxToolResultContentChars: options.maxToolResultContentChars,
        })
      : appendAnthropicToolResultMessages(body.messages, options.toolResultMessages, {
          maxToolResultContentChars: options.maxToolResultContentChars,
          reasoningState: options.reasoningState,
          skipAssistantTurn: Boolean(options.resultsHistoryAlreadyContainsAssistantTurns),
        });
  }

  return body;
}

function addAnthropicToolCacheControl<T extends Record<string, unknown>>(tools: T[]) {
  if (tools.length === 0) {
    return tools;
  }

  return tools.map((tool, index) => index === tools.length - 1
    ? { ...tool, cache_control: { type: "ephemeral" } }
    : tool);
}

export function createAnthropicToolSchema(tool: ToolDefinition) {
  const schema = createProviderVisibleToolSchema(tool);
  const inputExamples = createAnthropicInputExamples(tool.id);

  return {
    description: schema.description,
    input_schema: schema.inputSchema,
    ...(inputExamples.length > 0 ? { input_examples: inputExamples } : {}),
    name: schema.name,
  };
}

function createAnthropicInputExamples(toolId: string): Array<Record<string, unknown>> {
  if (toolId === "files_edit_many") {
    return [
      {
        edits: [
          {
            newText: "const enabled = true;",
            oldText: "const enabled = false;",
            operation: "exact_replace",
            path: "src/App.tsx",
          },
        ],
      },
      {
        edits: [
          {
            content: "false",
            endColumn: 26,
            endLine: 18,
            operation: "replace_span",
            path: "src/App.tsx",
            startColumn: 21,
            startLine: 18,
          },
        ],
      },
      {
        edits: [
          {
            content: "return <main className=\"app-shell\">{children}</main>;",
            endLine: 42,
            operation: "replace_range",
            path: "src/App.tsx",
            startLine: 40,
          },
          {
            content: "export const appReady = true;",
            operation: "append",
            path: "src/App.tsx",
          },
        ],
      },
    ];
  }

  if (toolId === "files_write_many") {
    return [
      {
        files: [
          {
            content: "export const created = true;\n",
            path: "src/newFeature.ts",
          },
        ],
        overwrite: false,
      },
      {
        files: [
          {
            allowWholeFileReplacement: true,
            content: "export const intentionallyRewritten = true;\n",
            path: "src/generatedConfig.ts",
          },
        ],
        overwrite: true,
      },
    ];
  }

  return [];
}

function appendAnthropicToolResultMessages(
  currentMessages: unknown,
  results: ToolResultMessage[],
  options: { maxToolResultContentChars?: number | null; reasoningState?: ProviderReasoningState; skipAssistantTurn: boolean },
) {
  const messages = Array.isArray(currentMessages) ? [...currentMessages] : [];
  let remainingToolResultChars = normalizeRemainingChars(options.maxToolResultContentChars);

  for (const result of results) {
    if (!options.skipAssistantTurn) {
      messages.push({
        content: [
          ...createAnthropicReasoningBlocks(options.reasoningState),
          {
            id: result.callId,
            input: result.arguments ?? {},
            name: result.name,
            type: "tool_use",
          },
        ],
        role: "assistant",
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
      content: [
        {
          content,
          is_error: !result.result.ok,
          tool_use_id: result.callId,
          type: "tool_result",
        },
      ],
      role: "user",
    });
  }

  return messages;
}

function createAnthropicReasoningBlocks(reasoningState: ProviderReasoningState | undefined) {
  if (reasoningState?.format !== "anthropic-thinking") {
    return [];
  }

  return reasoningState.entries
    .filter((entry) => entry.type === "thinking" || entry.type === "redacted_thinking")
    .map((entry) => entry.value)
    .filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value)));
}
