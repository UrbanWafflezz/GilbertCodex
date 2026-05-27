import { describe, expect, it } from "vitest";
import { extractInternalReasoningTags } from "./internalReasoningTags";

describe("extractInternalReasoningTags", () => {
  it("keeps public text and removes internal tag blocks", () => {
    const result = extractInternalReasoningTags("Hello <think>secret plan</think> world.", { final: true });

    expect(result.content).toBe("Hello  world.");
    expect(result.reasoning).toBe("secret plan");
  });

  it("buffers a streaming tag prefix", () => {
    const result = extractInternalReasoningTags("Answering...<thi");

    expect(result.content).toBe("Answering...");
    expect(result.pendingPrefix).toBe("<thi");
  });
});
