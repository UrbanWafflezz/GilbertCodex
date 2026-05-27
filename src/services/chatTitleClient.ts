import { attachmentSummary } from "../lib/chatAttachments";
import { createMessage, titleFromMessage } from "../lib/chatUtils";
import type { ChatAttachment } from "../types/chat";
import type { ProviderSettings } from "../types/settings";
import { DEFAULT_TOOL_REGISTRY_SETTINGS, type ToolRegistryId, type ToolRegistrySettings } from "../types/tools";
import { sendProviderMessage, type ProviderStructuredOutputOptions } from "./modelProviderClient";

const MAX_CHAT_TITLE_CHARS = 54;
const CHAT_TITLE_MAX_TOKENS = 48;
const TITLE_PREFIX_PATTERN = /^(chat\s*)?title\s*[:\-]\s*/i;
const GENERIC_TITLE_PATTERN = /^(?:new\s+chat|chat|title|untitled(?:\s+chat)?|conversation|general\s+chat)$/i;
const FALLBACK_BOUNDARY_WORDS = new Set(["because", "but", "similar", "that", "which", "where", "while", "with"]);
const FALLBACK_LEADING_WORDS = /^(?:a|an|our|the|this|that)\s+/i;
const TITLE_SMALL_WORDS = new Set(["a", "an", "and", "at", "by", "de", "for", "from", "in", "of", "on", "or", "the", "to", "with"]);
const CHAT_TITLE_STRUCTURED_OUTPUT: ProviderStructuredOutputOptions = {
  description: "A concise generated title for a chat conversation.",
  name: "chat_title",
  schema: {
    additionalProperties: false,
    properties: {
      title: {
        description: "A 2 to 6 word conversation title under 54 characters.",
        type: "string",
      },
    },
    required: ["title"],
    type: "object",
  },
  strict: true,
};

const DISABLED_TITLE_TOOLS = Object.fromEntries(
  (Object.keys(DEFAULT_TOOL_REGISTRY_SETTINGS) as ToolRegistryId[]).map((toolId) => [toolId, false]),
) as ToolRegistrySettings;

export interface GenerateChatTitleInput {
  attachments: ChatAttachment[];
  content: string;
}

export async function generateChatTitle(settings: ProviderSettings, input: GenerateChatTitleInput, options: { signal?: AbortSignal } = {}) {
  const fallbackTitle = createFallbackChatTitle(input);
  const titleSettings = createTitleProviderSettings(settings);
  const titleMessage = createMessage("user", createChatTitlePrompt(input));
  let response;

  try {
    response = await sendProviderMessage(titleSettings, [titleMessage], {
      signal: options.signal,
      structuredOutput: CHAT_TITLE_STRUCTURED_OUTPUT,
    });
  } catch (error) {
    if (options.signal?.aborted) {
      throw error;
    }

    try {
      response = await sendProviderMessage(titleSettings, [titleMessage], {
        signal: options.signal,
      });
    } catch (fallbackError) {
      if (options.signal?.aborted) {
        throw fallbackError;
      }

      return fallbackTitle;
    }
  }

  return normalizeGeneratedChatTitle(response.content, fallbackTitle);
}

export function normalizeGeneratedChatTitle(value: string, fallbackTitle = "New chat") {
  if (/<tool_call>|<\/tool_call>/i.test(value)) {
    return fallbackTitle;
  }

  const candidate = extractStructuredTitle(value) ?? extractPlainTitle(value);
  const normalized = cleanTitle(candidate ?? "");

  if (!normalized || isGenericTitle(normalized)) {
    return fallbackTitle;
  }

  return normalized.length > MAX_CHAT_TITLE_CHARS ? `${normalized.slice(0, MAX_CHAT_TITLE_CHARS - 3).trim()}...` : normalized;
}

export function createFallbackChatTitle(input: GenerateChatTitleInput) {
  const fallbackFromText = createTextFallbackTitle(input.content);

  if (fallbackFromText) {
    return fallbackFromText;
  }

  const fallbackFromAttachment = createAttachmentFallbackTitle(input.attachments);

  if (fallbackFromAttachment) {
    return fallbackFromAttachment;
  }

  return titleFromMessage(input.content, input.attachments);
}

function createTitleProviderSettings(settings: ProviderSettings): ProviderSettings {
  return {
    ...settings,
    maxTokens: CHAT_TITLE_MAX_TOKENS,
    systemPrompt: [
      "You create concise conversation titles for Gilbert Codex.",
      "Return JSON only in the exact shape {\"title\":\"...\"}.",
      "Summarize the user's intent instead of copying the first sentence verbatim.",
      "Never call the title Chat, New chat, Title, Untitled, or Conversation.",
    ].join(" "),
    temperature: Math.min(settings.temperature, 0.2),
    thinking: {
      ...settings.thinking,
      enabled: false,
    },
    tools: { ...DISABLED_TITLE_TOOLS },
    userInstructions: "",
    webSearch: {
      ...settings.webSearch,
      enabled: false,
    },
    workspaceDependencies: {
      enabled: false,
    },
  };
}

function createChatTitlePrompt(input: GenerateChatTitleInput) {
  const sections = [
    "Name this chat.",
    "",
    "Return JSON only:",
    "{\"title\":\"Short Intent Title\"}",
    "",
    "Rules:",
    "- Return only one title in the title field.",
    "- Use 2 to 6 words.",
    "- Preserve the user's primary language unless they explicitly requested another language.",
    `- Keep it under ${MAX_CHAT_TITLE_CHARS} characters.`,
    "- Prefer Title Case.",
    "- Do not use quotes, markdown, ending punctuation, or generic labels like Chat, New chat, Title, Untitled, or Conversation.",
    "- Name the user's intent, task, bug, topic, or object; do not copy the whole first sentence.",
    "- Use attachment names only when they are specific and helpful.",
    "",
    "Examples:",
    "User message: can you fix the terminal reconnect issue after sleep",
    "{\"title\":\"Fix Terminal Reconnect\"}",
    "User message: look into our chat naming system which ai named the chats",
    "{\"title\":\"Improve Chat Naming\"}",
    "User message: revisa este error de inicio de sesion",
    "{\"title\":\"Error de Inicio de Sesion\"}",
    "",
    "User message:",
    input.content.trim() || "(no text)",
  ];
  const attachments = attachmentSummary(input.attachments);

  if (attachments) {
    sections.push("", "Attachments:", attachments);
  }

  return sections.join("\n");
}

function cleanTitle(value: string) {
  return value
    .replace(TITLE_PREFIX_PATTERN, "")
    .replace(/^["'`*_>\-\s]+/, "")
    .replace(/["'`*_\s]+$/, "")
    .replace(/[.!?]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractStructuredTitle(value: string) {
  const candidates = [
    value.trim(),
    stripWrappingCodeFence(value.trim()),
    extractJsonObjectText(value),
  ].filter((candidate): candidate is string => Boolean(candidate?.trim()));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const title = typeof parsed === "object" && parsed ? (parsed as { title?: unknown }).title : undefined;

      if (typeof title === "string" && title.trim()) {
        return title;
      }
    } catch {
      // Plain text providers still pass through the text path below.
    }
  }

  return undefined;
}

function extractPlainTitle(value: string) {
  const firstLine = stripWrappingCodeFence(value)
    .replace(/```[\s\S]*?```/g, " ")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  return firstLine ?? value;
}

function stripWrappingCodeFence(value: string) {
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(value.trim());
  return match ? match[1].trim() : value;
}

function extractJsonObjectText(value: string) {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");

  return start >= 0 && end > start ? value.slice(start, end + 1) : undefined;
}

function createTextFallbackTitle(content: string) {
  const normalized = stripLeadingIntentPhrases(
    content
      .replace(/```[\s\S]*?```/g, " code ")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/https?:\/\/\S+/gi, " ")
      .replace(/[*_>#]/g, "")
      .replace(/[()[\]{}]/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  ).replace(FALLBACK_LEADING_WORDS, "");

  if (!normalized) {
    return "";
  }

  const words = normalized.split(/\s+/).filter(Boolean);
  const boundaryIndex = words.findIndex((word, index) => index >= 2 && FALLBACK_BOUNDARY_WORDS.has(word.toLowerCase().replace(/[^a-z]/g, "")));
  const selectedWords = (boundaryIndex > 0 ? words.slice(0, boundaryIndex) : words).slice(0, 6);
  const selected = cleanTitle(selectedWords.join(" ").replace(/[,;:]+$/g, ""));

  return selected ? limitChatTitle(toReadableTitleCase(selected)) : "";
}

function stripLeadingIntentPhrases(value: string) {
  let next = value.trim();
  let previous = "";

  while (next && next !== previous) {
    previous = next;
    next = next
      .replace(/^(?:please\s+)?(?:can|could|would|will)\s+you\s+/i, "")
      .replace(/^(?:please\s+)?(?:look\s+into|check\s+out|take\s+a\s+look\s+at|help\s+(?:me\s+)?(?:with|fix|build|make|create)|make\s+sure|i\s+need\s+(?:you\s+to\s+)?|i\s+want\s+(?:you\s+to\s+)?|let'?s)\s+/i, "")
      .replace(/^(?:please|kindly)\s+/i, "")
      .trim();
  }

  return next;
}

function createAttachmentFallbackTitle(attachments: ChatAttachment[]) {
  const attachment = attachments[0];

  if (!attachment) {
    return "";
  }

  const name = attachment.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  const genericName = /^(?:image|video|file|screenshot|screen\s*shot|untitled|attachment)(?:\s+\d+)?$/i.test(name);

  if (name && !genericName) {
    return limitChatTitle(toReadableTitleCase(name));
  }

  if (attachment.kind === "image") {
    return "Image Upload";
  }

  if (attachment.kind === "video") {
    return "Video Upload";
  }

  return "File Upload";
}

function toReadableTitleCase(value: string) {
  if (!/^[\x00-\x7F]+$/.test(value) || !/[a-z]/i.test(value)) {
    return value;
  }

  return value
    .split(/\s+/)
    .map((word, index) => {
      if (/^[A-Z0-9]{2,}$/.test(word)) {
        return word;
      }

      const lower = word.toLowerCase();
      if (index > 0 && TITLE_SMALL_WORDS.has(lower)) {
        return lower;
      }

      return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
    })
    .join(" ");
}

function limitChatTitle(value: string) {
  return value.length > MAX_CHAT_TITLE_CHARS ? `${value.slice(0, MAX_CHAT_TITLE_CHARS - 3).trim()}...` : value;
}

function isGenericTitle(value: string) {
  return GENERIC_TITLE_PATTERN.test(value.trim());
}
