import { describe, expect, it } from "vitest";
import { mergeVisibleReasoningSummaries } from "./reasoningSummary";

describe("mergeVisibleReasoningSummaries", () => {
  it("appends distinct reasoning summaries instead of replacing the earlier one", () => {
    expect(
      mergeVisibleReasoningSummaries(
        "I inspected the project tree and metadata files.",
        "I synthesized the run commands and near-term risks from that evidence.",
      ),
    ).toBe("I inspected the project tree and metadata files.\n\nI synthesized the run commands and near-term risks from that evidence.");
  });

  it("keeps cumulative stream updates from duplicating the same reasoning", () => {
    expect(
      mergeVisibleReasoningSummaries(
        "I inspected the project tree and metadata files.",
        "I inspected the project tree and metadata files, then mapped the runtime flow.",
      ),
    ).toBe("I inspected the project tree and metadata files, then mapped the runtime flow.");
  });

  it("deduplicates repeated sections while preserving new sections", () => {
    expect(
      mergeVisibleReasoningSummaries(
        "I inspected the project tree and metadata files.\n\nI mapped the current thinking UI.",
        "I mapped the current thinking UI.\n\nI found the latest-wins reasoning assignment.",
      ),
    ).toBe(
      "I inspected the project tree and metadata files.\n\nI mapped the current thinking UI.\n\nI found the latest-wins reasoning assignment.",
    );
  });
});
