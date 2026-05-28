import { createChatSourcesFromWebResults, DEFAULT_WEB_SEARCH_MAX_RESULTS, formatWebSearchErrorMessage, formatWebSearchProviderLabel, MAX_WEB_SEARCH_RESULTS, searchWebWithProvider } from "../../../services/webSearchClient";
import type { ChatSource } from "../../../types/chat";
import { DEFAULT_BRAVE_SEARCH_SETTINGS, type BraveSearchFreshness, type WebSearchSettings } from "../../../types/settings";
import type { JsonValue, ToolDefinition, ToolExecutionContext, ToolExecutionResult } from "../../types";

type WebSearchToolFreshness = Exclude<BraveSearchFreshness, "custom">;

export interface WebSearchToolBackend {
  search: typeof searchWebWithProvider;
}

const DEFAULT_TOOL_WEB_SEARCH_SETTINGS: WebSearchSettings = {
  brave: DEFAULT_BRAVE_SEARCH_SETTINGS,
  enabled: true,
  maxResults: DEFAULT_WEB_SEARCH_MAX_RESULTS,
  provider: "duckduckgo",
};

export const defaultWebSearchToolBackend: WebSearchToolBackend = {
  search: searchWebWithProvider,
};

export function createWebSearchTool(backend: WebSearchToolBackend = defaultWebSearchToolBackend): ToolDefinition {
  return {
    description:
      "Search the live web when current, source-backed, official, or date-sensitive external evidence is needed. " +
      "Call this only when local workspace files and conversation context are not enough, such as latest/current facts, pricing, releases, official docs, API documentation, standards, or explicit user requests to search online. " +
      "Do not use it for ordinary project code, local app behavior, source-code lookup, or repo questions that should be answered from workspace tools.",
    execute: async (args, context) => executeWebSearchTool(args, context, backend),
    executorMetadata: { family: "web", version: 1 },
    id: "web_search",
    inputSchema: {
      additionalProperties: false,
      properties: {
        freshness: {
          description: "Optional Brave freshness filter. Use pd for last day, pw for last week, pm for last month, py for last year, or any for no freshness filter. Ignored by DuckDuckGo.",
          enum: ["any", "pd", "pw", "pm", "py"],
          type: "string",
        },
        maxResults: {
          description: "Maximum sources to return. The app hard-caps every web tool call at 6 sources.",
          maximum: MAX_WEB_SEARCH_RESULTS,
          minimum: 1,
          type: "integer",
        },
        query: {
          description: "Search query. Keep it focused on the external fact or documentation needed.",
          maxLength: 400,
          minLength: 1,
          type: "string",
        },
      },
      required: ["query"],
      type: "object",
    },
    permission: "read-only",
    risk: "network",
    title: "Search web",
  };
}

export function createWebTools(backend: WebSearchToolBackend = defaultWebSearchToolBackend): ToolDefinition[] {
  return [
    createWebSearchTool(backend),
  ];
}

export const webTools: ToolDefinition[] = createWebTools();

async function executeWebSearchTool(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
  backend: WebSearchToolBackend,
): Promise<ToolExecutionResult> {
  const query = stringArg(args.query);

  if (!query) {
    return createErrorResult("web_search requires a non-empty query.");
  }

  const maxResults = integerArg(
    args.maxResults,
    context.webSearchMaxResults ?? context.webSearchSettings?.maxResults ?? DEFAULT_WEB_SEARCH_MAX_RESULTS,
    1,
    MAX_WEB_SEARCH_RESULTS,
  );
  const settings = createRuntimeWebSearchSettings(context, maxResults, freshnessArg(args.freshness));
  const providerLabel = formatWebSearchProviderLabel(settings.provider);

  try {
    const response = await backend.search(query, settings, {
      includeVisualResults: false,
      maxResults,
      signal: context.signal,
    });
    const sources = createChatSourcesFromWebResults(response.results).slice(0, maxResults);
    const resultProviderLabel = formatWebSearchProviderLabel(response.provider);
    const fallbackNote =
      response.fallbackError && response.provider !== response.primaryProvider
        ? `${providerLabel} failed, so ${resultProviderLabel} fallback results were used: ${response.fallbackError}`
        : undefined;

    if (sources.length === 0) {
      const message = `${resultProviderLabel} returned no usable sources.`;
      return {
        content: formatWebSearchToolOutput(query, sources, resultProviderLabel, message),
        data: createWebSearchToolData(query, response.provider, response.primaryProvider, sources, fallbackNote),
        error: message,
        ok: false,
      };
    }

    return {
      content: formatWebSearchToolOutput(query, sources, resultProviderLabel, fallbackNote),
      data: createWebSearchToolData(query, response.provider, response.primaryProvider, sources, fallbackNote),
      ok: true,
    };
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    const detail = formatWebSearchErrorMessage(error, `${providerLabel} search failed.`);
    return {
      content: formatWebSearchToolOutput(query, [], providerLabel, detail),
      data: createWebSearchToolData(query, settings.provider, settings.provider, [], detail),
      error: detail,
      ok: false,
    };
  }
}

function createRuntimeWebSearchSettings(context: ToolExecutionContext, maxResults: number, freshness?: WebSearchToolFreshness): WebSearchSettings {
  const base = context.webSearchSettings ?? DEFAULT_TOOL_WEB_SEARCH_SETTINGS;

  return {
    ...DEFAULT_TOOL_WEB_SEARCH_SETTINGS,
    ...base,
    brave: {
      ...DEFAULT_BRAVE_SEARCH_SETTINGS,
      ...base.brave,
      freshness: freshness ?? base.brave.freshness,
    },
    maxResults,
  };
}

function formatWebSearchToolOutput(query: string, sources: ChatSource[], providerLabel: string, note?: string) {
  return [
    `WEB SEARCH TOOL RESULTS - ${providerLabel}`,
    `Query: ${query}`,
    `Sources: ${sources.length}`,
    sources.length > 0
      ? "Use these sources as live web evidence. Cite supported claims with Markdown links using only these URLs."
      : "No usable web sources were returned. Do not answer current factual claims from memory; say the live web search did not return usable results.",
    note ? `Search note: ${note}` : "",
    ...sources.map((source, index) => [`${index + 1}. ${source.title}`, `URL: ${source.url}`, source.detail ? `Snippet: ${source.detail}` : ""].filter(Boolean).join("\n")),
  ]
    .filter(Boolean)
    .join("\n\n");
}

function createWebSearchToolData(
  query: string,
  provider: WebSearchSettings["provider"],
  primaryProvider: WebSearchSettings["provider"],
  sources: ChatSource[],
  note?: string,
): JsonValue {
  return {
    fallbackError: note ?? null,
    primaryProvider,
    provider,
    query,
    resultCount: sources.length,
    sources: sources.map((source) => ({
      detail: source.detail ?? null,
      id: source.id ?? null,
      imageUrl: source.imageUrl ?? null,
      sourceType: source.sourceType ?? null,
      thumbnailUrl: source.thumbnailUrl ?? null,
      title: source.title,
      url: source.url,
    })),
  };
}

function stringArg(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function integerArg(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return Math.max(min, Math.min(max, Math.round(fallback)));
  }

  return Math.max(min, Math.min(max, Math.round(value)));
}

function freshnessArg(value: unknown): WebSearchToolFreshness | undefined {
  return value === "any" || value === "pd" || value === "pw" || value === "pm" || value === "py" ? value : undefined;
}

function createErrorResult(message: string): ToolExecutionResult {
  return {
    content: message,
    error: message,
    ok: false,
  };
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}
