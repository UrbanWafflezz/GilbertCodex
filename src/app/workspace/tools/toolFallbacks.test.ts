import { describe, expect, it } from "vitest";
import type { ChatToolCall } from "../../../types/chat";
import {
  createRecoverableBridgeToolRetryInstruction,
  isRecoverableBridgeArgumentError,
} from "./toolFallbacks";

describe("tool fallback recovery", () => {
  it("treats empty files_edit_many insert content as recoverable", () => {
    const output = "C:\\Users\\Kobe Work\\Documents\\MindSpace\\src\\style.css: files_edit_many insert_at_line requires non-empty content.";

    expect(isRecoverableBridgeArgumentError({} as never, output)).toBe(true);
  });

  it("tells the model to retry empty-content batch edits with a real anchored edit", () => {
    const failedCall: ChatToolCall = {
      id: "edit-style",
      input: JSON.stringify({
        edits: [
          {
            content: "",
            line: 420,
            operation: "insert_at_line",
            path: "src/style.css",
          },
        ],
      }),
      label: "Edit many workspace files",
      output: "C:\\Users\\Kobe Work\\Documents\\MindSpace\\src\\style.css: files_edit_many insert_at_line requires non-empty content.",
      status: "error",
      toolId: "files_edit_many",
    };
    const deps = {
      createMissingReadSearchQuery: () => "",
      extractMissingReadPath: () => "",
      extractNearbyPathCandidates: () => [],
      extractSuggestedFileReadCandidates: () => [],
      extractSuggestedFileSearchQuery: () => "",
      extractToolInputPath: () => "src/style.css",
      getToolCallRawOutput: (toolCall: ChatToolCall) => [toolCall.output, toolCall.detail].filter(Boolean).join("\n"),
      isMissingFileReadToolCall: () => false,
      isRecoverableBridgeArgumentError: (output: string) => isRecoverableBridgeArgumentError({} as never, output),
    };

    const instruction = createRecoverableBridgeToolRetryInstruction(deps as never, [failedCall], "fix the HUD UI bugs");

    expect(instruction).toContain("RECOVERABLE TOOL ERROR");
    expect(instruction).toContain("empty insertion/append content");
    expect(instruction).toContain("files_edit_many");
    expect(instruction).toContain("files_apply_patch");
    expect(instruction).toContain("Do not write a final answer");
  });

  it("treats ambiguous exact replacements as recoverable", () => {
    const output = "C:\\Users\\Kobe Work\\Documents\\MindSpace\\src\\style.css: Exact text matched 11 times. Set replaceAll true or make oldText more specific.";

    expect(isRecoverableBridgeArgumentError({} as never, output)).toBe(true);
  });

  it("treats broad batch edit refusals as recoverable", () => {
    const output = "Refusing broad edit in `src/style.css` edits[0]: exact_replace would replace 819 of 819 lines. files_edit_many is for narrow anchored edits, not near whole-file rewrites.";

    expect(isRecoverableBridgeArgumentError({} as never, output)).toBe(true);
  });

  it("tells the model to narrow ambiguous exact replacements instead of using replaceAll blindly", () => {
    const failedCall: ChatToolCall = {
      id: "edit-style-broad",
      input: JSON.stringify({
        edits: [
          {
            newText: ".hud.playing .world-panel:not(.hidden)",
            oldText: ".hud.playing .world-panel",
            operation: "exact_replace",
            path: "src/style.css",
          },
        ],
      }),
      label: "Edit many workspace files",
      output: "C:\\Users\\Kobe Work\\Documents\\MindSpace\\src\\style.css: Exact text matched 11 times. Set replaceAll true or make oldText more specific.",
      status: "error",
      toolId: "files_edit_many",
    };
    const deps = {
      createMissingReadSearchQuery: () => "",
      extractMissingReadPath: () => "",
      extractNearbyPathCandidates: () => [],
      extractSuggestedFileReadCandidates: () => [],
      extractSuggestedFileSearchQuery: () => "",
      extractToolInputPath: () => "src/style.css",
      getToolCallRawOutput: (toolCall: ChatToolCall) => [toolCall.output, toolCall.detail].filter(Boolean).join("\n"),
      isMissingFileReadToolCall: () => false,
      isRecoverableBridgeArgumentError: (output: string) => isRecoverableBridgeArgumentError({} as never, output),
    };

    const instruction = createRecoverableBridgeToolRetryInstruction(deps as never, [failedCall], "fix the HUD UI bugs");

    expect(instruction).toContain("RECOVERABLE TOOL ERROR");
    expect(instruction).toContain("matched more than one location");
    expect(instruction).toContain("Do not set replaceAll unless");
    expect(instruction).toContain("more specific oldText");
    expect(instruction).toContain("files_apply_patch");
  });

  it("tells the model to recover broad batch edit refusals with a smaller anchor", () => {
    const failedCall: ChatToolCall = {
      id: "edit-style-broad-rewrite",
      input: JSON.stringify({
        edits: [
          {
            newText: "/* nearly the whole CSS file */",
            oldText: "/* current whole CSS file */",
            operation: "exact_replace",
            path: "src/style.css",
          },
        ],
      }),
      label: "Edit many workspace files",
      output: "Refusing broad edit in `src/style.css` edits[0]: exact_replace would replace 819 of 819 lines. files_edit_many is for narrow anchored edits, not near whole-file rewrites.",
      status: "error",
      toolId: "files_edit_many",
    };
    const deps = {
      createMissingReadSearchQuery: () => "",
      extractMissingReadPath: () => "",
      extractNearbyPathCandidates: () => [],
      extractSuggestedFileReadCandidates: () => [],
      extractSuggestedFileSearchQuery: () => "",
      extractToolInputPath: () => "src/style.css",
      getToolCallRawOutput: (toolCall: ChatToolCall) => [toolCall.output, toolCall.detail].filter(Boolean).join("\n"),
      isMissingFileReadToolCall: () => false,
      isRecoverableBridgeArgumentError: (output: string) => isRecoverableBridgeArgumentError({} as never, output),
    };

    const instruction = createRecoverableBridgeToolRetryInstruction(deps as never, [failedCall], "fix two UI bugs");

    expect(instruction).toContain("RECOVERABLE TOOL ERROR");
    expect(instruction).toContain("too broad");
    expect(instruction).toContain("Do not retry by replacing most or all of the file");
    expect(instruction).toContain("smaller unique oldText");
    expect(instruction).toContain("files_apply_patch");
  });
});
