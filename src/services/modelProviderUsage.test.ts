import { describe, expect, it } from "vitest";
import { annotateProviderPayloadSpike, countAutoCompactedProviderMessages, estimateModelProviderPayloadUsage, preserveContextUsageHighWaterMark } from "./modelProviderUsage";
import type { ChatMessage } from "../types/chat";
import { DEFAULT_BILLING_PLAN } from "../lib/subscriptionTiers";
import { DEFAULT_BRAVE_SEARCH_SETTINGS } from "../types/settings";
import type { ProviderSettings } from "../types/settings";
import { DEFAULT_TOOL_REGISTRY_SETTINGS } from "../types/tools";

const settings: ProviderSettings = {
  apiKeys: {},
  baseUrls: {},
  billingPlan: DEFAULT_BILLING_PLAN,
  contextWindowTokens: {},
  disabledModels: {},
  maxTokens: 4096,
  model: "test-model",
  openRouterApiKey: "",
  provider: "openrouter",
  providerModels: {},
  subscriptionOptimization: {
    codexContextWindow: "standard",
    fallbackMode: "off",
    tokenSaverLevel: "low",
  },
  systemPrompt: "",
  temperature: 0.2,
  thinking: {
    enabled: false,
    effort: "medium",
  },
  tools: DEFAULT_TOOL_REGISTRY_SETTINGS,
  topK: 0,
  topP: 1,
  userInstructions: "",
  webSearch: {
    brave: DEFAULT_BRAVE_SEARCH_SETTINGS,
    enabled: false,
    maxResults: 6,
    provider: "duckduckgo",
  },
  workspaceDependencies: {
    enabled: false,
  },
};

function message(content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return {
    content,
    createdAt: "2026-05-14T00:00:00.000Z",
    id: `message-${content.length}`,
    role: "user",
    ...extra,
  };
}

describe("provider payload usage guardrail", () => {
  it("breaks provider-visible payload estimates into obvious causes", () => {
    const usage = estimateModelProviderPayloadUsage({
      contextWindowTokens: 128_000,
      messages: [
        message("hello", {
          attachments: [{
            createdAt: "2026-05-14T00:00:00.000Z",
            id: "attachment",
            kind: "file",
            mimeType: "text/plain",
            name: "notes.txt",
            size: 2048,
            text: "attached text",
          }],
        }),
        message("tool result", {
          role: "assistant",
          toolCalls: [{
            id: "tool-1",
            label: "Read workspace file",
            output: "x".repeat(20_000),
            status: "complete",
          }],
        }),
      ],
      settings,
      source: "estimate",
    });

    expect(usage.payloadBreakdown?.map((item) => item.id)).toContain("toolOutput");
    expect(usage.payloadBreakdown?.map((item) => item.id)).toContain("attachments");
    expect(usage.payloadBreakdown?.map((item) => item.id)).toContain("maxOutput");
    expect(usage.payloadBreakdown?.map((item) => item.id)).toContain("safetyMargin");
    expect(usage.payloadBreakdown?.find((item) => item.id === "toolOutput")?.tokens).toBeGreaterThan(4_000);
  });

  it("does not estimate image attachment data URLs as text tokens", () => {
    const usage = estimateModelProviderPayloadUsage({
      contextWindowTokens: 128_000,
      messages: [
        message("browser screenshot evidence", {
          attachments: [
            {
              createdAt: "2026-05-14T00:00:00.000Z",
              dataUrl: `data:image/png;base64,${"A".repeat(400_000)}`,
              height: 720,
              id: "screenshot",
              kind: "image",
              mimeType: "image/png",
              name: "Browser screenshot",
              size: 300_000,
              width: 1280,
            },
          ],
        }),
      ],
      settings,
      source: "estimate",
    });

    const attachmentTokens = usage.payloadBreakdown?.find((item) => item.id === "attachments")?.tokens ?? 0;

    expect(attachmentTokens).toBeGreaterThanOrEqual(1200);
    expect(attachmentTokens).toBeLessThan(2_000);
    expect(usage.inputTokens).toBeLessThan(8_000);
  });

  it("uses the exact request body after provider preflight clamps output", () => {
    const usage = estimateModelProviderPayloadUsage({
      contextWindowTokens: 6_000,
      messages: [message("small prompt")],
      settings: {
        ...settings,
        maxTokens: 8_192,
      },
      source: "estimate",
    });

    expect(usage.maxOutputTokens).toBeLessThan(8_192);
    expect(usage.fitsContextWindow).toBe(true);
    expect(usage.overflowTokens).toBe(0);
  });

  it("annotates large jumps with top contributors", () => {
    const previous = estimateModelProviderPayloadUsage({
      contextWindowTokens: 128_000,
      messages: [message("small")],
      settings,
      source: "estimate",
    });
    const current = estimateModelProviderPayloadUsage({
      contextWindowTokens: 128_000,
      messages: [
        message("small"),
        message("tool result", {
          role: "assistant",
          toolCalls: [{
            id: "tool-1",
            label: "Read workspace file",
            output: "x".repeat(220_000),
            status: "complete",
          }],
        }),
      ],
      settings,
      source: "estimate",
    });
    const annotated = annotateProviderPayloadSpike(current, previous);

    expect(annotated.payloadSpike?.summary).toContain("Payload estimate jumped");
    expect(annotated.payloadSpike?.topContributors[0]?.id).toBe("toolOutput");
  });

  it("only treats compaction as a one-shot event, not a permanent allow-decrease flag", () => {
    // Regression: a presence-only check ("does ANY message look like a
    // compaction marker?") permanently unlocked the high-water-mark guard
    // once a single auto-compaction had happened, causing later helper /
    // sub-agent / streaming updates to visibly collapse the displayed
    // counter from e.g. 20k down to 5k mid-conversation.
    const baseMessages: ChatMessage[] = [
      message("kept user turn"),
      message("AUTO COMPACTED CONTEXT\n\nOlder turns summarized.", {
        id: "context-compaction-abc",
      }),
      message("recent assistant reply", { role: "assistant" }),
    ];

    const previousCompactedCount = countAutoCompactedProviderMessages(baseMessages);
    expect(previousCompactedCount).toBe(1);

    // A later turn that adds a normal user message — no NEW compaction.
    const laterMessages = [...baseMessages, message("follow-up user turn")];
    const laterCompactedCount = countAutoCompactedProviderMessages(laterMessages);
    expect(laterCompactedCount).toBe(previousCompactedCount);

    // A later turn that triggers a SECOND compaction.
    const secondCompactionMessages = [
      ...laterMessages,
      message("AUTO COMPACTED CONTEXT\n\nMore older turns summarized.", {
        id: "context-compaction-def",
      }),
    ];
    expect(countAutoCompactedProviderMessages(secondCompactionMessages)).toBeGreaterThan(previousCompactedCount);
  });

  it("keeps displayed context non-decreasing until compaction is explicit", () => {
    const previous = estimateModelProviderPayloadUsage({
      contextWindowTokens: 128_000,
      messages: [
        message("small"),
        message("tool result", {
          role: "assistant",
          toolCalls: [{
            id: "tool-1",
            label: "Read workspace file",
            output: "x".repeat(120_000),
            status: "complete",
          }],
        }),
      ],
      settings,
      source: "estimate",
    });
    const smallerInternalRequest = estimateModelProviderPayloadUsage({
      contextWindowTokens: 128_000,
      messages: [message("smaller helper request")],
      settings,
      source: "estimate",
    });

    const displayed = preserveContextUsageHighWaterMark(smallerInternalRequest, previous);
    const compacted = preserveContextUsageHighWaterMark(smallerInternalRequest, previous, { allowDecrease: true });

    expect(displayed.inputTokens).toBe(previous.inputTokens);
    expect(displayed.tokenSource).toBe("projected");
    expect(compacted.inputTokens).toBe(smallerInternalRequest.inputTokens);
  });

  it("does not preserve an impossible over-budget high-water mark once the next request fits", () => {
    const previous = estimateModelProviderPayloadUsage({
      contextWindowTokens: 10_000,
      messages: [
        message("tool result", {
          role: "assistant",
          toolCalls: [{
            id: "tool-1",
            label: "Read workspace file",
            output: "x".repeat(80_000),
            status: "complete",
          }],
        }),
      ],
      settings: {
        ...settings,
        maxTokens: 6_000,
      },
      source: "estimate",
    });
    const compactedRequest = estimateModelProviderPayloadUsage({
      contextWindowTokens: 10_000,
      messages: [message("AUTO COMPACTED CONTEXT\n\nOlder turns summarized.", { id: "context-compaction-abc" })],
      settings: {
        ...settings,
        maxTokens: 1_024,
      },
      source: "estimate",
    });

    expect(previous.overflowTokens).toBeGreaterThan(0);
    expect(compactedRequest.fitsContextWindow).toBe(true);

    const displayed = preserveContextUsageHighWaterMark(compactedRequest, previous);

    expect(displayed.inputTokens).toBe(compactedRequest.inputTokens);
    expect(displayed.overflowTokens).toBe(0);
  });
});
