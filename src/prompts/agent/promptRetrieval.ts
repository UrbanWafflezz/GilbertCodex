import { estimatePromptTokens, clampPromptText } from "./promptBudget";
import { PROMPT_CATALOG, createPromptChunkSearchText, type PromptChunk } from "./promptCatalog";
import { cosineSimilarity, createPromptEmbedding, createPromptTermSet, type PromptEmbedding } from "./promptEmbedding";
import { normalizeToolRegistrySettings } from "../../types/tools";
import { getDetectedProjectTypes } from "../../localWorkspace/workspaceContext";
import type { ChatMessage } from "../../types/chat";
import type { ProviderSettings } from "../../types/settings";
import type { ProviderToolBridgeOptions, ToolDefinition } from "../../toolBridge/types";

const STANDARD_SKILL_TOKEN_BUDGET = 2200;
const MAX_RETRIEVED_CHUNKS = 2;
const MIN_RELEVANCE_SCORE = 0.055;

interface IndexedPromptChunk {
  chunk: PromptChunk;
  embedding: PromptEmbedding;
}

export interface AgentPromptRetrievalContext {
  enabledToolNames: string[];
  hasLocalComputerContext: boolean;
  hasWebContext: boolean;
  latestUserPrompt: string;
  mode: "chat" | "planning";
  query: string;
  settings: ProviderSettings;
}

export interface SelectedPromptChunk {
  chunk: PromptChunk;
  score: number;
  tokens: number;
}

const PROMPT_INDEX: IndexedPromptChunk[] = PROMPT_CATALOG.map((chunk) => ({
  chunk,
  embedding: createPromptEmbedding(createPromptChunkSearchText(chunk)),
}));

export function createAgentPromptRetrievalContext(settings: ProviderSettings, messages: ChatMessage[], toolBridge?: ProviderToolBridgeOptions): AgentPromptRetrievalContext {
  const tools = normalizeToolRegistrySettings(settings.tools);
  const enabledToolNames = getEnabledToolNames(settings, toolBridge);
  const recentMessages = messages.slice(-6);
  const latestUserPrompt = getLatestUserPrompt(messages);
  const mode = recentMessages.some((message) => message.mode === "plan" || message.planning || message.content.includes("Planning passes")) ? "planning" : "chat";
  const hasLocalComputerContext = messages.some(hasLocalComputerContextMessage) || hasLocalWorkspaceTool(getProviderVisibleTools(toolBridge));
  const hasWebContext = messages.some(hasWebContextMessage);
  const query = [
    latestUserPrompt,
    mode === "planning" ? "planning architecture tradeoffs requirements" : "chat implementation answer",
    enabledToolNames.length > 0 ? `host capabilities ${enabledToolNames.join(" ")}` : "no runtime tools",
    hasLocalComputerContext ? "host workspace context filesystem code workspace" : "",
    hasWebContext ? "web search results source citations current facts" : "",
    recentMessages.map((message) => `${message.role}: ${message.content.slice(0, 900)}`).join("\n"),
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    enabledToolNames,
    hasLocalComputerContext,
    hasWebContext,
    latestUserPrompt,
    mode,
    query,
    settings,
  };
}

export function selectPromptChunks(context: AgentPromptRetrievalContext): SelectedPromptChunk[] {
  const queryEmbedding = createPromptEmbedding(context.query);
  const queryTerms = createPromptTermSet(context.query);
  const tokenBudget = STANDARD_SKILL_TOKEN_BUDGET;
  const forcedChunkIds = getForcedChunkIds(context);
  const rankedChunks = PROMPT_INDEX.map(({ chunk, embedding }) => {
    const score = scorePromptChunk(chunk, embedding, queryEmbedding, queryTerms, context, forcedChunkIds.has(chunk.id));
    const tokens = estimatePromptTokens(clampPromptText(chunk.content, chunk.maxTokens ?? 400));

    return {
      chunk,
      score,
      tokens,
    };
  })
    .filter((entry) => {
      if (entry.chunk.alwaysInclude || forcedChunkIds.has(entry.chunk.id)) {
        return true;
      }

      if (!isChunkAllowed(entry.chunk, context)) {
        return false;
      }

      return entry.score >= MIN_RELEVANCE_SCORE;
    })
    .sort((left, right) => {
      if (left.chunk.alwaysInclude !== right.chunk.alwaysInclude) {
        return left.chunk.alwaysInclude ? -1 : 1;
      }

      if (forcedChunkIds.has(left.chunk.id) !== forcedChunkIds.has(right.chunk.id)) {
        return forcedChunkIds.has(left.chunk.id) ? -1 : 1;
      }

      return right.score - left.score || right.chunk.priority - left.chunk.priority;
    });

  const selected: SelectedPromptChunk[] = [];
  let usedTokens = 0;

  for (const entry of rankedChunks) {
    const alwaysInclude = Boolean(entry.chunk.alwaysInclude || forcedChunkIds.has(entry.chunk.id));
    const optionalCount = selected.filter((item) => !item.chunk.alwaysInclude && !forcedChunkIds.has(item.chunk.id)).length;

    if (!alwaysInclude && optionalCount >= MAX_RETRIEVED_CHUNKS) {
      continue;
    }

    if (!alwaysInclude && usedTokens + entry.tokens > tokenBudget) {
      continue;
    }

    selected.push(entry);
    usedTokens += entry.tokens;
  }

  return sortSelectedChunksForPrompt(selected, forcedChunkIds);
}

export function clampSelectedChunkContent(chunk: PromptChunk) {
  return clampPromptText(chunk.content, chunk.maxTokens ?? 400);
}

function scorePromptChunk(
  chunk: PromptChunk,
  chunkEmbedding: PromptEmbedding,
  queryEmbedding: PromptEmbedding,
  queryTerms: Set<string>,
  context: AgentPromptRetrievalContext,
  forced: boolean,
) {
  if (chunk.alwaysInclude) {
    return 1;
  }

  const semanticScore = cosineSimilarity(chunkEmbedding.vector, queryEmbedding.vector);
  const keywordScore = scoreKeywordOverlap(chunk, queryTerms);
  const priorityScore = chunk.priority / 1000;
  const modeBoost = chunk.id === "mode.planning" && context.mode === "planning" ? 0.24 : 0;
  const researchBoost = chunk.id === "skill.research-current-facts" && isResearchLike(context.latestUserPrompt, context.settings) ? 0.22 : 0;
  const codingBoost = chunk.id === "skill.coding-agent-workflow" && isCodingLike(context.latestUserPrompt) ? 0.2 : 0;
  const reviewBoost = chunk.id === "skill.code-review" && /\b(review|audit|production-ready|risk|bug hunt|findings)\b/i.test(context.latestUserPrompt) ? 0.18 : 0;
  const frontendBoost = chunk.id === "skill.frontend-product-quality" && /\b(ui|ux|frontend|screen|css|layout|responsive|visual|preview)\b/i.test(context.latestUserPrompt) ? 0.18 : 0;
  const forcedBoost = forced ? 0.35 : 0;

  return semanticScore * 0.58 + keywordScore * 0.28 + priorityScore + modeBoost + researchBoost + codingBoost + reviewBoost + frontendBoost + forcedBoost;
}

function scoreKeywordOverlap(chunk: PromptChunk, queryTerms: Set<string>) {
  const matchingKeywords = chunk.keywords.filter((keyword) => {
    const keywordTerms = createPromptTermSet(keyword);

    return [...keywordTerms].some((term) => queryTerms.has(term)) || queryTerms.has(keyword.toLowerCase());
  });

  return Math.min(matchingKeywords.length / Math.max(chunk.keywords.length, 1), 1);
}

function getForcedChunkIds(context: AgentPromptRetrievalContext) {
  const forced = new Set<string>();
  const promptText = context.latestUserPrompt;
  const codingLike = isCodingLike(promptText);
  const planningLike = context.mode === "planning" || isPlanningLike(promptText);
  const reviewLike = isReviewLike(promptText);
  const frontendLike = isFrontendLike(promptText);
  const researchLike = isResearchLike(promptText, context.settings);

  if (planningLike) {
    forced.add("mode.planning");
  }

  if (researchLike) {
    forced.add("skill.research-current-facts");
  }

  if (codingLike) {
    forced.add("skill.coding-agent-workflow");
  }

  if (reviewLike) {
    forced.add("skill.code-review");
  }

  if (frontendLike) {
    forced.add("skill.frontend-product-quality");
  }

  const detectedTypes = getDetectedProjectTypes();

  if (isNodeLike(promptText) || (codingLike && (detectedTypes.has("node") || detectedTypes.has("tauri")))) {
    forced.add("skill.language-node");
  }

  if (isPythonLike(promptText) || (codingLike && detectedTypes.has("python"))) {
    forced.add("skill.language-python");
  }

  return forced;
}

function isNodeLike(prompt: string) {
  return /\b(node|nodejs|node\.js|npm|pnpm|yarn|bun|package\.json|express|next\.?js|vite|react|tauri|expo|react native|typescript|tsx|jsx|monorepo)\b/i.test(prompt);
}

function isPythonLike(prompt: string) {
  return /\b(python|py|pip|pipenv|poetry|uv|venv|virtualenv|pyproject|requirements\.txt|django|flask|fastapi|pytest|mypy|ruff|conda)\b/i.test(prompt);
}

function isChunkAllowed(chunk: PromptChunk, context: AgentPromptRetrievalContext) {
  if (chunk.id === "skill.language-node") {
    return isNodeLike(context.latestUserPrompt);
  }

  if (chunk.id === "skill.language-python") {
    return isPythonLike(context.latestUserPrompt);
  }

  if (chunk.id === "skill.research-current-facts") {
    return context.hasWebContext || isResearchLike(context.latestUserPrompt, context.settings);
  }

  if (chunk.id === "skill.code-review") {
    return isReviewLike(context.latestUserPrompt);
  }

  if (chunk.id === "skill.frontend-product-quality") {
    return isFrontendLike(context.latestUserPrompt);
  }

  return true;
}

function sortSelectedChunksForPrompt(chunks: SelectedPromptChunk[], forcedChunkIds: Set<string>) {
  const kindOrder: Record<PromptChunk["kind"], number> = {
    core: 0,
    mode: 1,
    skill: 2,
    tool: 3,
  };

  return [...chunks].sort((left, right) => {
    if (kindOrder[left.chunk.kind] !== kindOrder[right.chunk.kind]) {
      return kindOrder[left.chunk.kind] - kindOrder[right.chunk.kind];
    }

    if (left.chunk.alwaysInclude !== right.chunk.alwaysInclude) {
      return left.chunk.alwaysInclude ? -1 : 1;
    }

    if (forcedChunkIds.has(left.chunk.id) !== forcedChunkIds.has(right.chunk.id)) {
      return forcedChunkIds.has(left.chunk.id) ? -1 : 1;
    }

    return right.chunk.priority - left.chunk.priority || right.score - left.score;
  });
}

function getLatestUserPrompt(messages: ChatMessage[]) {
  return [...messages].reverse().find((message) => message.role === "user" && message.content.trim())?.content.trim() ?? "";
}

function getEnabledToolNames(settings: ProviderSettings, toolBridge?: ProviderToolBridgeOptions) {
  if (toolBridge?.tools) {
    return getProviderVisibleTools(toolBridge).map((tool) => tool.id);
  }

  const tools = normalizeToolRegistrySettings(settings.tools);

  return [
    tools.browserPreview ? "browser_preview_open" : "",
    tools.terminal ? "terminal_run" : "",
    tools.webSearch ? "web_search" : "",
    tools.imageGeneration ? "image_generate" : "",
  ].filter(Boolean);
}

function getProviderVisibleTools(toolBridge?: ProviderToolBridgeOptions) {
  if (!toolBridge?.tools) {
    return [];
  }

  const providerVisibleToolIds = toolBridge.providerVisibleToolIds ?? toolBridge.capabilityPlan?.providerVisibleToolIds;
  if (!providerVisibleToolIds) {
    return toolBridge.tools;
  }

  return toolBridge.tools.filter((tool) => providerVisibleToolIds.includes(tool.id));
}

function isResearchLike(prompt: string, _settings: ProviderSettings) {
  return /\b(deep research|research|latest|current|today|docs?|official|verify|look up|source|cite|api|changelog|standard)\b/i.test(prompt);
}

function isCodingLike(prompt: string) {
  return /\b(code|coding|implement|fix|debug|refactor|repo|repository|folder|file|build|test|senior dev|senior engineer|typescript|react|tauri|rust|app)\b/i.test(prompt);
}

function isPlanningLike(prompt: string) {
  return /\b(plan|planning|brainstorm|architecture|design|trade-?off|requirements|approach|proposal)\b/i.test(prompt);
}

function isReviewLike(prompt: string) {
  if (isPromptAuditLike(prompt)) {
    return false;
  }

  return /\b(review|audit|production-ready|risk|bug hunt|findings|security|regression)\b/i.test(prompt);
}

function isPromptAuditLike(prompt: string) {
  return /\b(?:system\s+prompt|prompt\s+(?:for|tokens?|budget|optimization)|tools?\s+(?:prompt|tokens?|budget)|token\s+(?:budget|usage|uses?))\b/i.test(prompt);
}

function isFrontendLike(prompt: string) {
  return /\b(ui|ux|frontend|screen|component|css|layout|responsive|visual|preview|browser|website|page)\b/i.test(prompt);
}

function hasLocalWorkspaceTool(tools: ToolDefinition[] | undefined) {
  return (tools ?? []).some((tool) => {
    const family = tool.executorMetadata?.family;
    return family === "files" || family === "editing" || family === "terminal" || family === "git" || family === "browser";
  });
}

function hasLocalComputerContextMessage(message: ChatMessage) {
  return message.content.includes("LOCAL WORKSPACE CONTEXT") || message.content.includes("HOST WORKSPACE CONTEXT");
}

function hasWebContextMessage(message: ChatMessage) {
  return message.id.startsWith("web-context") || message.content.includes("WEB SEARCH CONTEXT - ") || message.content.includes("WEB SEARCH TOOL RESULTS");
}
