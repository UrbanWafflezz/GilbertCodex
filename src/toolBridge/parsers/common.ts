import type { ModelProviderId } from "../../types/settings";
import type { ToolCallRequest } from "../types";

let toolCallIdCounter = 0;

export interface ParseToolArgumentsResult {
  error?: string;
  value: unknown;
}

// Back-compat parser that returns raw input on JSON failure; bridge code should use the detailed variant.
export function parseToolCallArguments(value: unknown) {
  const result = parseToolCallArgumentsDetailed(value);
  return result.value;
}

export function parseToolCallArgumentsDetailed(value: unknown): ParseToolArgumentsResult {
  if (typeof value !== "string") {
    return { value: value ?? {} };
  }

  if (!value.trim()) {
    return { value: {} };
  }

  try {
    return { value: JSON.parse(value) };
  } catch (error) {
    const repaired = repairLikelyJsonString(value);
    if (repaired && repaired !== value) {
      try {
        return { value: JSON.parse(repaired) };
      } catch {
        // Fall through to the original parser error so the model sees the real failure.
      }
    }

    const message = error instanceof Error ? error.message : "Tool arguments are not valid JSON.";
    return {
      error: `Could not parse tool arguments as JSON: ${message}`,
      value,
    };
  }
}

export function createToolCallRequest(
  provider: ModelProviderId,
  id: unknown,
  name: unknown,
  args: unknown,
  raw?: unknown,
): ToolCallRequest | null {
  if (typeof name !== "string" || !name.trim()) {
    return null;
  }

  const trimmedName = name.trim();
  const parsed = parseToolCallArgumentsDetailed(args);
  const allowPlainStringArguments = parsed.error && typeof parsed.value === "string" && isPlainStringArgumentTool(trimmedName);
  // Trim provider IDs so dedupe, telemetry, and result-message correlation ignore surrounding whitespace.
  const trimmedId = typeof id === "string" ? id.trim() : "";
  const resolvedId = trimmedId ? trimmedId : nextFallbackToolCallId(trimmedName);

  const request: ToolCallRequest = {
    arguments: parsed.error && !allowPlainStringArguments ? {} : parsed.value,
    id: resolvedId,
    name: trimmedName,
    provider,
    raw,
  };

  if (parsed.error && !allowPlainStringArguments) {
    request.argumentsParseError = parsed.error;
  }

  return request;
}

// Monotonic fallback ID for provider tool calls that arrive without IDs.
function nextFallbackToolCallId(name: string): string {
  toolCallIdCounter += 1;
  return `${name}-fallback-${toolCallIdCounter}`;
}

export function __resetToolCallIdCounterForTests() {
  toolCallIdCounter = 0;
}

function isPlainStringArgumentTool(name: string) {
  return /^(?:terminal_run|terminal|terminal_command|terminal_exec|terminal\.run|terminal\.run_command|terminal_run_command|run_command|run_terminal|shell_command)$/i.test(name.trim());
}

function repairLikelyJsonString(value: string) {
  const trimmed = value.trim();
  if (!trimmed || !/^[{\[]/.test(trimmed)) {
    return "";
  }

  let output = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;

    if (!inString) {
      output += char;
      if (char === "\"") {
        inString = true;
        escaped = false;
      }
      continue;
    }

    if (escaped) {
      output += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      const nextChar = value[index + 1];
      if (nextChar === "\"" && looksLikeRawWindowsPathBackslashBeforeQuote(value, index)) {
        output += "\\\\";
        continue;
      }
      if (nextChar && /["\\/bfnrtu]/.test(nextChar)) {
        output += char;
        escaped = true;
      } else {
        output += "\\\\";
      }
      continue;
    }

    if (char === "\"") {
      if (looksLikeJsonStringTerminator(value, index)) {
        output += char;
        inString = false;
      } else {
        output += "\\\"";
      }
      continue;
    }

    if (char === "\n") {
      output += "\\n";
      continue;
    }

    if (char === "\r") {
      output += "\\r";
      continue;
    }

    if (char === "\t") {
      output += "\\t";
      continue;
    }

    output += char;
  }

  return stripTrailingJsonCommas(output);
}

function looksLikeJsonStringTerminator(value: string, quoteIndex: number) {
  const nextIndex = findNextNonWhitespaceIndex(value, quoteIndex + 1);
  if (nextIndex < 0) {
    return true;
  }

  const next = value[nextIndex];
  if (next === ":") {
    return true;
  }

  if (next === "}" || next === "]") {
    const afterClosersIndex = findNextNonWhitespaceAfterClosingRunIndex(value, nextIndex);
    if (afterClosersIndex < 0) {
      return true;
    }

    if (value[afterClosersIndex] !== ",") {
      return false;
    }

    return looksLikeJsonDelimiterComma(value, afterClosersIndex);
  }

  if (next !== ",") {
    return false;
  }

  return looksLikeJsonDelimiterComma(value, nextIndex);
}

function looksLikeRawWindowsPathBackslashBeforeQuote(value: string, slashIndex: number) {
  const prefix = value.slice(Math.max(0, slashIndex - 240), slashIndex);

  return /(?:^|["'\s(=,:])(?:[A-Za-z]:\\|\\\\)[^"\r\n]*$/.test(prefix);
}

function looksLikeJsonDelimiterComma(value: string, commaIndex: number) {
  const afterCommaIndex = findNextNonWhitespaceIndex(value, commaIndex + 1);
  if (afterCommaIndex < 0) {
    return true;
  }

  const afterComma = value[afterCommaIndex];
  if (afterComma === "}" || afterComma === "]") {
    return true;
  }

  if (afterComma === "{") {
    return looksLikeJsonObjectStart(value, afterCommaIndex);
  }

  if (afterComma !== "\"") {
    return false;
  }

  const nextQuoteIndex = findNextUnescapedQuoteIndex(value, afterCommaIndex + 1);
  if (nextQuoteIndex < 0) {
    return false;
  }

  const afterNextQuoteIndex = findNextNonWhitespaceIndex(value, nextQuoteIndex + 1);
  return afterNextQuoteIndex >= 0 && value[afterNextQuoteIndex] === ":";
}

function findNextNonWhitespaceAfterClosingRunIndex(value: string, startIndex: number) {
  let index = startIndex;

  while (index < value.length) {
    const char = value[index]!;
    if (char === "}" || char === "]" || /\s/.test(char)) {
      index += 1;
      continue;
    }

    return index;
  }

  return -1;
}

function looksLikeJsonObjectStart(value: string, objectStartIndex: number) {
  const keyStartIndex = findNextNonWhitespaceIndex(value, objectStartIndex + 1);
  if (keyStartIndex < 0 || value[keyStartIndex] !== "\"") {
    return false;
  }

  const keyEndIndex = findNextUnescapedQuoteIndex(value, keyStartIndex + 1);
  if (keyEndIndex < 0) {
    return false;
  }

  const afterKeyIndex = findNextNonWhitespaceIndex(value, keyEndIndex + 1);
  if (afterKeyIndex < 0 || value[afterKeyIndex] !== ":") {
    return false;
  }

  const key = value.slice(keyStartIndex + 1, keyEndIndex);
  return /^(path|content|files|edits|replacements|oldText|newText|range|start|end|overwrite|dryRun|expectedSha256|createParentDirs|allowWholeFileReplacement|forceEol)$/i.test(key);
}

function findNextNonWhitespaceIndex(value: string, startIndex: number) {
  for (let index = startIndex; index < value.length; index += 1) {
    if (!/\s/.test(value[index]!)) {
      return index;
    }
  }

  return -1;
}

function findNextUnescapedQuoteIndex(value: string, startIndex: number) {
  let escaped = false;

  for (let index = startIndex; index < value.length; index += 1) {
    const char = value[index]!;

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === "\"") {
      return index;
    }
  }

  return -1;
}

function stripTrailingJsonCommas(value: string) {
  return value.replace(/,\s*([}\]])/g, "$1");
}
