export const INTERNAL_REASONING_TAG_NAMES = ["think", "thinking", "thought", "reasoning", "analysis", "scratchpad"] as const;

const TAG_GROUP = INTERNAL_REASONING_TAG_NAMES.join("|");
const INTERNAL_REASONING_BLOCK_PATTERN = new RegExp(`<(${TAG_GROUP})\\b[^>]*>([\\s\\S]*?)<\\/\\1>`, "gi");
const INTERNAL_REASONING_OPEN_PATTERN = new RegExp(`<(${TAG_GROUP})\\b[^>]*>`, "i");
const INTERNAL_REASONING_CLOSE_PATTERN = new RegExp(`<\\/(${TAG_GROUP})>`, "gi");

const TAG_NAME_PREFIXES = (() => {
  const prefixes = new Set<string>();
  for (const tag of INTERNAL_REASONING_TAG_NAMES) {
    for (let length = 1; length <= tag.length; length += 1) {
      prefixes.add(tag.slice(0, length).toLowerCase());
    }
  }
  return prefixes;
})();

export interface InternalReasoningTagExtraction {
  content: string;
  pendingPrefix: string;
  reasoning: string;
}

export function extractInternalReasoningTags(raw: string, options: { final?: boolean } = {}): InternalReasoningTagExtraction {
  if (!raw) {
    return { content: "", pendingPrefix: "", reasoning: "" };
  }

  if (!raw.includes("<")) {
    return { content: raw, pendingPrefix: "", reasoning: "" };
  }

  const reasoningParts: string[] = [];
  let visibleContent = raw.replace(INTERNAL_REASONING_BLOCK_PATTERN, (_match, _tag: string, hiddenText: string) => {
    reasoningParts.push(hiddenText);
    return "";
  });

  const openMatch = INTERNAL_REASONING_OPEN_PATTERN.exec(visibleContent);

  if (openMatch && typeof openMatch.index === "number") {
    const beforeOpen = visibleContent.slice(0, openMatch.index);
    const afterOpen = visibleContent.slice(openMatch.index + openMatch[0].length);

    reasoningParts.push(afterOpen.replace(INTERNAL_REASONING_CLOSE_PATTERN, ""));
    visibleContent = beforeOpen;
  }

  visibleContent = visibleContent.replace(INTERNAL_REASONING_CLOSE_PATTERN, "");

  let pendingPrefix = "";

  if (!options.final) {
    const tailMatch = /<([A-Za-z]*)$/.exec(visibleContent);
    if (tailMatch) {
      const partial = tailMatch[1].toLowerCase();
      if (partial.length === 0 || TAG_NAME_PREFIXES.has(partial)) {
        pendingPrefix = visibleContent.slice(tailMatch.index);
        visibleContent = visibleContent.slice(0, tailMatch.index);
      }
    }
  }

  return {
    content: visibleContent,
    pendingPrefix,
    reasoning: reasoningParts.join("").trim(),
  };
}
