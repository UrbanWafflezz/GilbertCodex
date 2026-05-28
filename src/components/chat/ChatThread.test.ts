import { describe, expect, it } from "vitest";
import { getThreadScrollEdgeState, separateDisplayThinking } from "./ChatThread";

describe("separateDisplayThinking", () => {
  it("returns internal reasoning text instead of dropping it", () => {
    const display = separateDisplayThinking("<think>I compared the request.</think>Visible answer.", false);

    expect(display.content).toBe("Visible answer.");
    expect(display.reasoning).toBe("I compared the request.");
  });
});

describe("getThreadScrollEdgeState", () => {
  it("marks the top edge active when there is visible or unloaded history above the viewport", () => {
    expect(getThreadScrollEdgeState({ clientHeight: 500, scrollHeight: 1200, scrollTop: 0 }, true)).toEqual({
      atBottom: false,
      atTop: true,
    });
    expect(getThreadScrollEdgeState({ clientHeight: 500, scrollHeight: 1200, scrollTop: 0 }, false)).toEqual({
      atBottom: false,
      atTop: false,
    });
    expect(getThreadScrollEdgeState({ clientHeight: 500, scrollHeight: 1200, scrollTop: 180 }, true)).toEqual({
      atBottom: false,
      atTop: false,
    });
  });

  it("uses the existing bottom threshold so the composer edge stays quiet near the latest message", () => {
    expect(getThreadScrollEdgeState({ clientHeight: 500, scrollHeight: 1200, scrollTop: 604 }, true).atBottom).toBe(true);
    expect(getThreadScrollEdgeState({ clientHeight: 500, scrollHeight: 1200, scrollTop: 590 }, true).atBottom).toBe(false);
  });
});
