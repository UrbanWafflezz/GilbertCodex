import type { ModelProviderId } from "../../types/settings";
import type { ToolCallRequest } from "../types";
import { createToolCallRequest, parseToolCallArgumentsDetailed } from "./common";

const MAX_VISIBLE_TEXT_TOOL_CALLS = 8;
const TOOL_NAME_PATTERN = /^(?:files_|git_|terminal_|browser_|web_|github_|gmail_|calendar_|bridge_)[\w.-]+$/i;
const BRIDGE_TOOL_CALL_SENTINEL_PATTERN = /\bBRIDGE_TOOL_CALL\s*:/gi;
const DIRECT_XML_TOOL_CALL_PATTERN = /<\s*((?:files_|git_|terminal_|browser_|web_|github_|gmail_|calendar_|bridge_)[\w.-]+)\b[^>]*>([\s\S]*?)<\s*\/\s*\1\s*>/gi;
const XML_ARGUMENT_PATTERN = /<\s*([\w.$-]+)\s*>([\s\S]*?)<\s*\/\s*\1\s*>/g;
const DSML_TOOL_CALL_BLOCK_PATTERN = /<\s*\|\s*DSML\s*\|\s*tool_calls\s*>([\s\S]*?)<\s*\/\s*\|\s*DSML\s*\|\s*tool_calls\s*>/gi;
const DSML_INVOKE_PATTERN = /<\s*\|\s*DSML\s*\|\s*invoke\b([^>]*)>([\s\S]*?)<\s*\/\s*\|\s*DSML\s*\|\s*invoke\s*>/gi;
const DSML_PARAMETER_PATTERN = /<\s*\|\s*DSML\s*\|\s*parameter\b([^>]*)>([\s\S]*?)<\s*\/\s*\|\s*DSML\s*\|\s*parameter\s*>/gi;
const ATTRIBUTE_PATTERN = /([\w.$-]+)\s*=\s*"([^"]*)"/g;

export function parseVisibleTextToolCalls(content: string, provider: ModelProviderId): ToolCallRequest[] {
  const calls: ToolCallRequest[] = [];

  calls.push(...parseBridgeToolCallSentinels(content, provider));

  if (/"tool_calls"\s*:\s*\[/i.test(content)) {
    calls.push(...parseJsonToolCalls(content, provider));

    if (calls.length === 0) {
      calls.push(...parseLooseToolCalls(content, provider));
    }
  }

  calls.push(...parseDirectXmlToolCalls(content, provider));
  calls.push(...parseDsmlToolCalls(content, provider));

  return calls.slice(0, MAX_VISIBLE_TEXT_TOOL_CALLS);
}

function parseBridgeToolCallSentinels(content: string, provider: ModelProviderId) {
  const calls: ToolCallRequest[] = [];
  BRIDGE_TOOL_CALL_SENTINEL_PATTERN.lastIndex = 0;

  while (BRIDGE_TOOL_CALL_SENTINEL_PATTERN.exec(content) && calls.length < MAX_VISIBLE_TEXT_TOOL_CALLS) {
    const objectStart = findNextNonWhitespaceIndex(content, BRIDGE_TOOL_CALL_SENTINEL_PATTERN.lastIndex);
    if (objectStart < 0 || content[objectStart] !== "{") {
      continue;
    }

    const objectEnd = findBalancedObjectEnd(content, objectStart);
    if (objectEnd < 0) {
      continue;
    }

    const objectText = content.slice(objectStart, objectEnd + 1);
    const parsed = parseToolCallArgumentsDetailed(objectText);
    const record = parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value)
      ? parsed.value as Record<string, unknown>
      : null;
    const name = record?.tool ?? record?.name ?? record?.function;
    const args = record?.args ?? record?.arguments ?? record?.parameters ?? {};
    const request = createToolCallRequest(provider, record?.id ?? `visible-bridge-tool-call-${calls.length + 1}`, name, args, {
      recoveredFromVisibleText: true,
      source: "bridge-tool-call-sentinel",
      text: objectText,
    });

    if (request && isLikelyBridgeToolName(request.name)) {
      calls.push(request);
    }

    BRIDGE_TOOL_CALL_SENTINEL_PATTERN.lastIndex = objectEnd + 1;
  }

  return calls;
}

function parseJsonToolCalls(content: string, provider: ModelProviderId) {
  const objectText = extractFirstJsonObject(content);
  if (!objectText) {
    return [];
  }

  try {
    const parsed = JSON.parse(objectText) as { tool_calls?: unknown };
    if (!Array.isArray(parsed.tool_calls)) {
      return [];
    }

    return parsed.tool_calls.flatMap((call, index) => {
      if (!call || typeof call !== "object" || Array.isArray(call)) {
        return [];
      }

      const record = call as Record<string, unknown>;
      const fn = record.function;
      const name = typeof fn === "string"
        ? fn
        : fn && typeof fn === "object" && !Array.isArray(fn)
          ? (fn as { name?: unknown }).name
          : undefined;
      const args = typeof fn === "object" && fn !== null && !Array.isArray(fn) && "arguments" in fn
        ? (fn as { arguments?: unknown }).arguments
        : record.parameters ?? record.arguments ?? {};
      const request = createToolCallRequest(provider, record.id ?? `visible-tool-call-${index + 1}`, name, args, call);

      return request && isLikelyBridgeToolName(request.name) ? [request] : [];
    }).slice(0, MAX_VISIBLE_TEXT_TOOL_CALLS);
  } catch {
    return [];
  }
}

function parseLooseToolCalls(content: string, provider: ModelProviderId) {
  const calls: ToolCallRequest[] = [];
  const functionPattern = /"function"\s*:\s*(?:"([^"]+)"|\{[\s\S]{0,700}?"name"\s*:\s*"([^"]+)")/gi;
  let match: RegExpExecArray | null;

  while ((match = functionPattern.exec(content)) && calls.length < MAX_VISIBLE_TEXT_TOOL_CALLS) {
    const name = match[1] ?? match[2] ?? "";
    if (!isLikelyBridgeToolName(name)) {
      continue;
    }

    const afterFunction = content.slice(functionPattern.lastIndex);
    const id = findNearestCallId(content.slice(Math.max(0, match.index - 400), match.index));
    const args = extractLooseArguments(afterFunction);
    const request = createToolCallRequest(provider, id ?? `visible-tool-call-${calls.length + 1}`, name, args, {
      recoveredFromVisibleText: true,
    });

    if (request) {
      calls.push(request);
    }
  }

  return calls;
}

function parseDirectXmlToolCalls(content: string, provider: ModelProviderId) {
  const calls: ToolCallRequest[] = [];
  DIRECT_XML_TOOL_CALL_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = DIRECT_XML_TOOL_CALL_PATTERN.exec(content)) && calls.length < MAX_VISIBLE_TEXT_TOOL_CALLS) {
    const name = match[1] ?? "";
    if (!isLikelyBridgeToolName(name)) {
      continue;
    }

    const request = createToolCallRequest(
      provider,
      `visible-xml-tool-call-${calls.length + 1}`,
      name,
      parseXmlToolArguments(match[2] ?? ""),
      {
        recoveredFromVisibleText: true,
        source: "direct-xml-tool-tag",
      },
    );

    if (request) {
      calls.push(request);
    }
  }

  return calls;
}

function parseDsmlToolCalls(content: string, provider: ModelProviderId) {
  const calls: ToolCallRequest[] = [];
  const blocks = extractDsmlToolCallBlocks(content);

  for (const block of blocks) {
    DSML_INVOKE_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = DSML_INVOKE_PATTERN.exec(block)) && calls.length < MAX_VISIBLE_TEXT_TOOL_CALLS) {
      const attributes = parseAttributes(match[1] ?? "");
      const name = attributes.name ?? "";
      if (!isLikelyBridgeToolName(name)) {
        continue;
      }

      const request = createToolCallRequest(
        provider,
        `visible-dsml-tool-call-${calls.length + 1}`,
        name,
        parseDsmlToolArguments(match[2] ?? ""),
        {
          recoveredFromVisibleText: true,
          source: "dsml-tool-call",
        },
      );

      if (request) {
        calls.push(request);
      }
    }
  }

  return calls;
}

function extractDsmlToolCallBlocks(content: string) {
  const blocks: string[] = [];
  DSML_TOOL_CALL_BLOCK_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = DSML_TOOL_CALL_BLOCK_PATTERN.exec(content))) {
    blocks.push(match[1] ?? "");
  }

  return blocks.length > 0 ? blocks : [content];
}

function parseDsmlToolArguments(innerText: string) {
  const result: Record<string, unknown> = {};
  DSML_PARAMETER_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = DSML_PARAMETER_PATTERN.exec(innerText))) {
    const attributes = parseAttributes(match[1] ?? "");
    const name = attributes.name;
    if (!name) {
      continue;
    }

    const rawValue = decodeXmlEntities(match[2] ?? "").trim();
    result[normalizeXmlArgumentKey(name)] = attributes.string === "true" ? rawValue : coerceXmlArgumentValue(rawValue);
  }

  return result;
}

function parseAttributes(text: string) {
  const attributes: Record<string, string> = {};
  ATTRIBUTE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = ATTRIBUTE_PATTERN.exec(text))) {
    const key = match[1]?.trim();
    if (key) {
      attributes[key] = decodeXmlEntities(match[2] ?? "");
    }
  }

  return attributes;
}

function parseXmlToolArguments(innerText: string) {
  const trimmed = innerText.trim();

  if (!trimmed) {
    return {};
  }

  if (trimmed.startsWith("{")) {
    return parseLooseObject(trimmed);
  }

  const result: Record<string, unknown> = {};
  XML_ARGUMENT_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = XML_ARGUMENT_PATTERN.exec(innerText))) {
    const rawKey = match[1] ?? "";
    if (!rawKey || isLikelyBridgeToolName(rawKey)) {
      continue;
    }

    result[normalizeXmlArgumentKey(rawKey)] = coerceXmlArgumentValue(decodeXmlEntities(match[2] ?? "").trim());
  }

  return result;
}

function normalizeXmlArgumentKey(key: string) {
  return key.replace(/[-_]+([a-zA-Z0-9])/g, (_match, char: string) => char.toUpperCase());
}

function coerceXmlArgumentValue(value: string) {
  if (/^-?\d+$/.test(value)) {
    return Number(value);
  }

  if (/^-?\d+\.\d+$/.test(value)) {
    return Number(value);
  }

  if (/^(?:true|false)$/i.test(value)) {
    return value.toLowerCase() === "true";
  }

  if (/^null$/i.test(value)) {
    return null;
  }

  return value;
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function extractFirstJsonObject(content: string) {
  const start = content.indexOf("{");
  if (start < 0) {
    return null;
  }

  const end = findBalancedObjectEnd(content, start);
  return end > start ? content.slice(start, end + 1) : null;
}

function extractLooseArguments(contentAfterFunction: string) {
  const parametersMatch = /"(?:parameters|arguments)"\s*:/i.exec(contentAfterFunction);
  if (!parametersMatch) {
    return {};
  }

  const valueStart = parametersMatch.index + parametersMatch[0].length;
  const rest = contentAfterFunction.slice(valueStart).trimStart();

  if (rest.startsWith("{")) {
    const end = findBalancedObjectEnd(rest, 0);
    const objectText = end >= 0 ? rest.slice(0, end + 1) : "";
    return parseLooseObject(objectText);
  }

  const quoted = /^"((?:\\.|[^"\\])*)"/.exec(rest);
  if (!quoted) {
    return {};
  }

  const argumentText = quoted[1]?.replace(/\\"/g, "\"").replace(/\\\\/g, "\\") ?? "";
  try {
    return JSON.parse(argumentText);
  } catch {
    return parseLooseObject(argumentText);
  }
}

function parseLooseObject(objectText: string) {
  try {
    return JSON.parse(objectText);
  } catch {
    const result: Record<string, unknown> = {};
    const stringPattern = /"([\w.$-]+)"\s*:\s*"([^"]*)"/g;
    const scalarPattern = /"([\w.$-]+)"\s*:\s*(-?\d+(?:\.\d+)?|true|false|null)\b/g;
    let match: RegExpExecArray | null;

    while ((match = stringPattern.exec(objectText))) {
      result[match[1] ?? ""] = match[2] ?? "";
    }

    while ((match = scalarPattern.exec(objectText))) {
      const key = match[1] ?? "";
      const value = match[2] ?? "";
      result[key] = value === "true" ? true : value === "false" ? false : value === "null" ? null : Number(value);
    }

    return result;
  }
}

function findBalancedObjectEnd(content: string, start: number) {
  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let index = start; index < content.length; index += 1) {
    const char = content[index];

    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (char === "\\") {
        escaping = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function findNextNonWhitespaceIndex(value: string, startIndex: number) {
  for (let index = startIndex; index < value.length; index += 1) {
    if (!/\s/.test(value[index] ?? "")) {
      return index;
    }
  }

  return -1;
}

function findNearestCallId(prefix: string) {
  const matches = [...prefix.matchAll(/"id"\s*:\s*"([^"]+)"/gi)];
  return matches[matches.length - 1]?.[1];
}

function isLikelyBridgeToolName(name: unknown): name is string {
  return typeof name === "string" && TOOL_NAME_PATTERN.test(name.trim());
}
