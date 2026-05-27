import { describe, expect, it } from "vitest";
import { separateDisplayThinking } from "./ChatThread";

describe("separateDisplayThinking", () => {
  it("returns internal reasoning text instead of dropping it", () => {
    const display = separateDisplayThinking("<think>I compared the request.</think>Visible answer.", false);

    expect(display.content).toBe("Visible answer.");
    expect(display.reasoning).toBe("I compared the request.");
  });
});
