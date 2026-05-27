const MIN_CONTAINED_SUMMARY_LENGTH = 16;

export function mergeVisibleReasoningSummaries(...values: Array<string | null | undefined>) {
  let merged = "";

  for (const value of values) {
    merged = mergeReasoningPair(merged, value);
  }

  return merged.trim();
}

function mergeReasoningPair(existingValue: string | null | undefined, incomingValue: string | null | undefined) {
  const existing = cleanReasoningValue(existingValue);
  const incoming = cleanReasoningValue(incomingValue);

  if (!existing) {
    return incoming;
  }

  if (!incoming) {
    return existing;
  }

  const existingNormalized = normalizeReasoning(existing);
  const incomingNormalized = normalizeReasoning(incoming);

  if (containsReasoning(existingNormalized, incomingNormalized)) {
    return existing;
  }

  if (containsReasoning(incomingNormalized, existingNormalized)) {
    return incoming;
  }

  const sections = splitReasoningSections(existing);

  for (const incomingSection of splitReasoningSections(incoming)) {
    const incomingSectionNormalized = normalizeReasoning(incomingSection);

    if (sections.some((section) => containsReasoning(normalizeReasoning(section), incomingSectionNormalized))) {
      continue;
    }

    const replaceIndex = sections.findIndex((section) => containsReasoning(incomingSectionNormalized, normalizeReasoning(section)));

    if (replaceIndex >= 0) {
      sections[replaceIndex] = incomingSection;
      continue;
    }

    sections.push(incomingSection);
  }

  return sections.join("\n\n");
}

function cleanReasoningValue(value: string | null | undefined) {
  return (value ?? "").replace(/\r\n/g, "\n").trim();
}

function splitReasoningSections(value: string) {
  return value
    .split(/\n{2,}/)
    .map((section) => section.trim())
    .filter(Boolean);
}

function normalizeReasoning(value: string) {
  return value
    .replace(/[.,;:!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function containsReasoning(haystack: string, needle: string) {
  return haystack === needle || (needle.length >= MIN_CONTAINED_SUMMARY_LENGTH && haystack.includes(needle));
}
