import { createPlanningAnswersMessage } from "../services/planningClient";
import { FINAL_RESPONSE_COMPLETION_GUIDANCE } from "../prompts/agent/finalResponseStyle";
import { formatWebSearchProviderLabel } from "../services/webSearchClient";
import { createVisibleFallbackFromToolCall, shouldToolCallForceSynthesis } from "../toolBridge";
import {
  CONNECTED_TOOL_SERVICE_PATTERN_SOURCE,
  CONNECTED_TOOL_SERVICE_PROMPT_PATTERN,
  DEPLOYMENT_HOSTING_PROMPT_PATTERN,
  DEPLOYMENT_TOOL_EVIDENCE_PATTERN,
} from "../lib/mcpServicePatterns";
import { createLocalComputerToolCallPreviews, createLocalComputerToolRequestContent, hasLocalComputerToolCalls } from "../localWorkspace/localToolRuntimeDisabled";
import type { LocalComputerToolExecutionPolicy } from "../localWorkspace/localToolRuntimeDisabled";
import type {
  ChatMessage,
  ChatPlanning,
  ChatPlanningInputAnswer,
  ChatPlanningInputRequest,
  ChatProgressItem,
  ChatSource,
  ChatToolCall,
  ChatWebSearch,
} from "../types/chat";
export function isRecoverableLocalEditFailure(..._args: unknown[]) {
  return false;
}

export function createRecoverableLocalEditRetryInstruction(prompt: string, ..._args: unknown[]) {
  return [
    "LOCAL TOOLS DISABLED",
    `Original user request: ${prompt}`,
    "The previous edit attempt did not produce a real app tool-call record. Continue with a normal answer from the available conversation, workspace, and web context without emitting visible tool-call syntax.",
  ].join("\n\n");
}

/** Browser/provider abort detection shared by streaming, planning, and tool loops. */
export function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

/** Normalizes legacy single-request planning state and newer multi-request state. */
export function getPlanningInputRequests(planning?: ChatPlanning) {
  if (planning?.inputRequests?.length) {
    return planning.inputRequests;
  }

  return planning?.inputRequest ? [planning.inputRequest] : [];
}

export function getPendingPlanningInputRequest(planning?: ChatPlanning) {
  return getPlanningInputRequests(planning).find((request) => !request.answeredAt);
}

export function markPlanningInputAnswered(requests: ChatPlanningInputRequest[], requestId: string, answers: ChatPlanningInputAnswer[], answeredAt: string) {
  return requests.map((request) =>
    request.id === requestId
      ? {
          ...request,
          answeredAt,
          answers,
        }
      : request,
  );
}

export function createPlanningAnswerMessages(requests: ChatPlanningInputRequest[]) {
  return requests.filter((request) => request.answeredAt && request.answers?.length).map((request) => createPlanningAnswersMessage(request, request.answers ?? []));
}

/** Detects filler text that should not become the assistant's final visible answer. */
export function looksLikeOnlyToolPrelude(content: string) {
  const normalized = content.trim().toLowerCase();
  const toolPreludePattern =
    /\b(let me|let's|we need to|we should|we'll|we will|i need to|i'll|i will|now i need to)\b[\s\S]{0,220}\b(read|pull|inspect|check|look|analyze|analyse|explore|trace|review|search|grep|find|scan|load|use|try|retry|switch|create|scaffold|generate|edit|patch|write|fix|apply|open|launch|navigate|preview)\b/;

  return (
    (normalized.length < 1200 && toolPreludePattern.test(normalized) && !looksLikeSubstantiveAnswer(normalized)) ||
    looksLikeUnexecutedToolActionPromise(content)
  );
}

/** Holds provider/tool scratchpad text out of the public bubble during streaming. */
export function shouldHoldStreamingContentForToolCalls(content: string, hasActiveToolCalls: boolean) {
  return hasActiveToolCalls && content.trim().length > 0;
}

/**
 * Detects transient "I looked at the tool results; next I will edit/run/read..."
 * prose. It can be useful thinking context, but it is not a user-facing answer.
 */
export function looksLikeInFlightToolPlanning(content: string) {
  const trimmed = content.trim();

  if (!trimmed || trimmed.length > 4_000) {
    return false;
  }

  const normalized = trimmed.toLowerCase();
  const tail = normalized.slice(-900);
  const hasToolResultFrame =
    /\b(?:looking at|looking through|based on|from|after reviewing)\b[\s\S]{0,140}\b(?:tool results?|results?|current state|code)\b/i.test(trimmed) ||
    /\b(?:now\s+)?i can see\b[\s\S]{0,180}\b(?:current\s+(?:css|code|file|component|state)|composer|input box|tool results?|results?)\b/i.test(trimmed) ||
    /(?:^|\n)\s*(?:inspecting|checking|reading|opening)\s+`?[\w./\\ -]+`?\.?\s*$/i.test(trimmed);
  const hasFindingList =
    /(?:^|\n)\s*(?:#{1,4}\s*)?(?:issues? found|findings?|remaining issues|problems? found)\b/i.test(trimmed) ||
    /(?:^|\n)\s*\d+\.\s+(?:\[[ x]\]|\*\*|`|[A-Z][\w -]{2,})/i.test(trimmed);
  const hasPendingActionTail =
    /\b(?:let me|i(?:'ll| will)|we(?:'ll| will)|now i(?:'ll| will| need to)|next(?:,|:)?|so(?:,)?(?:\s+i)?)\b[\s\S]{0,280}\b(?:add|apply|change|check|compact|create|edit|fix|inspect|make|open|patch|read|reduce|refine|replace|resize|run|scan|search|shrink|tighten|update|write)\b/i.test(tail) ||
    /(?:^|\n)\s*next:\s+[\s\S]{0,280}\b(?:add|apply|change|check|compact|create|edit|fix|inspect|make|open|patch|read|reduce|refine|replace|resize|run|scan|search|shrink|tighten|update|write)\b/i.test(trimmed);
  const hasToolPlanningFrame =
    looksLikeUnexecutedToolActionPromise(trimmed) ||
    (
      referencesAppToolName(trimmed) &&
      /\b(?:available tools?|call|execute|try|use|using|with|without|attached|don't have|do not have|refused|exact old and new text)\b/i.test(trimmed)
    ) ||
    (
      hasPendingActionTail &&
      FILE_LINE_EDIT_FRAME_PATTERN.test(trimmed) &&
      /\b(?:apply|edit|make|one precise change|replace lines?|shrink|tighten|change|patch)\b/i.test(trimmed)
    );

  return hasToolPlanningFrame || (hasPendingActionTail && (hasToolResultFrame || hasFindingList || looksLikeOnlyToolPrelude(content)));
}

/** Detects explicit private scratchpad markers before the tool parser has caught up. */
export function looksLikePrivateThinkingNarration(content: string) {
  const trimmed = content.trim();

  if (!trimmed || trimmed.length > 6_000) {
    return false;
  }

  if (/^\s*(?:#{1,6}\s*)?(?:\*\*)?(?:analysis|reasoning|thinking|thought|scratchpad|internal(?:\s+monologue)?|private\s+notes?)(?:\*\*)?\s*[:.-]/i.test(trimmed)) {
    return true;
  }

  if (/^\s*<\s*(?:analysis|reasoning|thinking|thought|scratchpad)\b/i.test(trimmed)) {
    return true;
  }

  return false;
}

export function looksLikeSubstantiveVisibleAnswer(content: string) {
  return looksLikeSubstantiveAnswer(content.trim().toLowerCase());
}

export function stripLeadingToolPreludeForDisplay(content: string) {
  const leadingWhitespace = content.match(/^\s*/)?.[0] ?? "";
  const trimmedStart = content.slice(leadingWhitespace.length);
  const firstBreak = trimmedStart.search(/\n\s*\n/);
  const firstBlock = firstBreak >= 0 ? trimmedStart.slice(0, firstBreak) : trimmedStart;

  if (firstBlock.length > 700 || !firstBlock.trim()) {
    return content;
  }

  const rest = firstBreak >= 0 ? trimmedStart.slice(firstBreak).trimStart() : "";

  if (!rest || (!looksLikeSubstantiveVisibleAnswer(rest) && !looksLikeAnswerSection(rest))) {
    return content;
  }

  if (looksLikeOnlyToolPrelude(firstBlock) || looksLikeUnexecutedToolActionPromise(firstBlock) || looksLikeInFlightToolPlanning(firstBlock)) {
    return rest;
  }

  return content;
}

function looksLikeSubstantiveAnswer(normalized: string) {
  return (
    /\b(?:i found|the issue is|root cause|fixed|changed|updated|implemented|verified|tests? passed|build passed|what changed|summary|findings?|next step)\b/.test(normalized) ||
    /(?:^|\n)\s*(?:[-*]|\d+\.)\s+\S/.test(normalized)
  );
}

function looksLikeAnswerSection(content: string) {
  return /(?:^|\n)\s*#{1,4}\s+\S[\s\S]{40,}/.test(content);
}

/** Detects prose promises that should have been real tool calls. */
export function looksLikeUnexecutedToolActionPromise(content: string) {
  const trimmed = content.trim();

  if (!trimmed || trimmed.length > 6_000) {
    return false;
  }

  const hasActionPromise = TOOL_ACTION_PROMISE_PATTERN.test(trimmed);
  const referencesTool = referencesAppToolName(trimmed);
  const mentionsToolInventory = TOOL_INVENTORY_NARRATION_PATTERN.test(trimmed);
  const hasLineEditFrame = FILE_LINE_EDIT_FRAME_PATTERN.test(trimmed);
  const hasEditableFileMention = EDITABLE_FILE_MENTION_PATTERN.test(trimmed);
  const hasEditInstructionFrame = EDIT_INSTRUCTION_FRAME_PATTERN.test(trimmed);
  const hasStandaloneCodingActionPromise = STANDALONE_CODING_ACTION_PROMISE_PATTERN.test(trimmed);
  const hasToolUseFrame =
    referencesTool &&
    /\b(?:using|use|with|call|try|available|attached|don't have|do not have|refused|exact old and new text|old and new text)\b/i.test(trimmed);

  return (
    (hasActionPromise && (referencesTool || mentionsToolInventory || hasLineEditFrame || hasEditableFileMention || hasEditInstructionFrame)) ||
    hasStandaloneCodingActionPromise ||
    (mentionsToolInventory && (referencesTool || hasActionPromise)) ||
    (hasToolUseFrame && (hasActionPromise || hasLineEditFrame || hasEditInstructionFrame)) ||
    (hasLineEditFrame && hasEditInstructionFrame && /\b(?:let me|i(?:'ll| will)|one precise change|replace lines?)\b/i.test(trimmed))
  );
}

/** Detects "updated file" code dumps when no mutating file tool actually ran. */
export function looksLikeUnappliedFileEditAnswer(content: string, toolCalls: ChatToolCall[] = []) {
  const trimmed = content.trim();

  if (!trimmed || trimmed.length > 30_000 || hasSuccessfulMutatingFileToolCall(toolCalls)) {
    return false;
  }

  const claimsFileChange =
    /\b(?:updated|modified|changed|implemented|integrated|added|wired|created|replaced|refactored)\b[\s\S]{0,220}\b(?:file|app|component|page|css|jsx|tsx|js|ts|code)\b/i.test(trimmed) ||
    /(?:\u66f4\u65b0\u540e\u7684|\u4fee\u6539\u540e\u7684|\u6539\u52a8\u8bf4\u660e|\u6211\u53ea\u4fee\u6539|\u5df2\u7ecf\u521b\u5efa|\u5df2\u7ecf\u5305\u542b|\u76f4\u63a5\u3001\u5b89\u5168\u5730.*\u6574\u5408|\u5df2.*(?:\u4fee\u6539|\u6574\u5408|\u66f4\u65b0|\u521b\u5efa))/iu.test(trimmed);
  const namesEditableFile =
    /(?:^|\n|`|\s)[\w./\\ -]+\.(?:astro|c|cpp|cs|css|dart|go|html|java|js|jsx|json|kt|kts|md|mdx|php|py|rb|rs|scss|sh|sql|svelte|swift|toml|ts|tsx|txt|vue|xml|ya?ml)\b/i.test(trimmed);
  const hasUpdatedFileHeader =
    /(?:^|\n)\s*(?:#{1,4}\s*)?(?:updated|new|final|complete)\s+(?:version\s+of\s+)?`?[\w./\\ -]+\.(?:css|jsx?|tsx?|html|json|md)`?\b/i.test(trimmed) ||
    /(?:^|\n)\s*(?:#{1,4}\s*)?(?:\u66f4\u65b0\u540e\u7684|\u4fee\u6539\u540e\u7684|\u65b0\u7684|\u6700\u7ec8\u7684)\s*`?[\w./\\ -]+\.(?:css|jsx?|tsx?|html|json|md)`?\b/iu.test(trimmed);
  const hasChangedFilesImplementationSummary =
    /(?:^|\n)\s*(?:#{1,4}\s*)?(?:changed files?|files changed|modified files?)\s*:?\s*(?:\n|$)/i.test(trimmed) &&
    /\b(?:implemented|improved|expanded|hardened|wired|added|updated|changed|fixed|created|refactored|removed|replaced)\b/i.test(trimmed) &&
    !/\b(?:no|not|without)\s+(?:file\s+)?(?:changes?|edits?|writes?|modifications?)\s+(?:were\s+)?(?:made|applied|recorded)\b/i.test(trimmed);
  const hasReplacementInstructionHeader =
    /(?:^|\n)\s*(?:#{1,4}\s*)?(?:replace|overwrite|put\s+this\s+in|use\s+this\s+for|change)\s+`?[\w./\\ -]+\.(?:css|jsx?|tsx?|html|json|md)`?\s+(?:with|to|as)\s+(?:this|the\s+following)\b/i.test(trimmed) ||
    /(?:^|\n)\s*(?:#{1,4}\s*)?(?:what\s+to\s+change|exact\s+replacement|ready[-\s]?to[-\s]?paste|copy\s+this|paste\s+this)\b/i.test(trimmed);
  const hasCodeDump =
    /```(?:[a-z0-9_-]+)?\s*[\s\S]{80,}?```/i.test(trimmed) ||
    /\bimport\s+[\s\S]{0,800}\b(?:function|const)\s+[A-Z]\w*[\s\S]{0,2000}\bexport\s+default\b/.test(trimmed) ||
    /(?:^|\n)\s*[.#][\w-]+\s*\{[\s\S]{80,}?\}/.test(trimmed);

  return namesEditableFile && (
    hasChangedFilesImplementationSummary ||
    toolCalls.some((toolCall) => toolCall.status === "complete" || toolCall.status === "error" || toolCall.status === "skipped") && (
      claimsFileChange && (hasUpdatedFileHeader || hasCodeDump) ||
      hasReplacementInstructionHeader && hasCodeDump
    )
  );
}

/** Detects routine local execution requests that were turned into unnecessary confirmation questions. */
export function looksLikeUnnecessaryLocalActionConfirmation(content: string, toolCalls: ChatToolCall[] = []) {
  const trimmed = content.trim();

  if (!trimmed || trimmed.length > 8_000 || hasSuccessfulMutatingFileToolCall(toolCalls)) {
    return false;
  }

  const asksForPermission =
    /\b(?:before\s+i\s+(?:apply|edit|install|run|make|change|update)|please\s+confirm|confirm\s+(?:first|before)|do\s+you\s+want\s+me\s+to|would\s+you\s+like\s+me\s+to|should\s+i|say\s+yes|with\s+your\s+confirmation)\b/i.test(trimmed);
  const promisesLocalAction =
    /\b(?:i(?:['\u2019]ll| will| can)|i(?:['\u2019]m| am)\s+going\s+to|let\s+me)\b[\s\S]{0,520}\b(?:add|apply|change|connect|create|edit|implement|install|modify|patch|replace|route|run|update|wire|write)\b/i.test(trimmed) ||
    /\b(?:apply|install|edit|update|connect|wire|add|create)\s+(?:this|the)\s+(?:change|dependency|edit|file|route|router|ui|page|component)\b/i.test(trimmed);
  const namesLocalTarget =
    /(?:^|\n|`|\s)[\w./\\ -]+\.(?:astro|c|cpp|cs|css|dart|go|html|java|js|jsx|json|kt|kts|md|mdx|php|py|rb|rs|scss|sh|sql|svelte|swift|toml|ts|tsx|txt|vue|xml|ya?ml)\b/i.test(trimmed) ||
    /\b(?:npm|pnpm|yarn|bun|react-router-dom|router|route|chatpage|localhost|src\/|src\\)\b/i.test(trimmed);

  return asksForPermission && promisesLocalAction && namesLocalTarget;
}

const APP_TOOL_NAME_PATTERN =
  /\b(?:files[._](?:append|apply_patch|copy|count_lines|edit_many|exact_replace|insert_at_line|list|move|read|read_many|read_range|replace_range|replace_span|search|stat|tree_summary|write|write_many)|terminal_run|browser_[\w.-]+|git_[\w.-]+|github_[\w.-]+|gmail_[\w.-]+|calendar_[\w.-]+|mcp_[\w.-]+|web_search|bridge_(?:echo|sum)|tool_smoke_test)\b/i;
const FILE_LINE_EDIT_FRAME_PATTERN =
  /\b(?:current\s+)?`?[\w./\\ -]+\.(?:astro|c|cpp|cs|css|dart|go|html|java|js|jsx|json|kt|kts|md|mdx|php|py|rb|rs|scss|sh|sql|svelte|swift|toml|ts|tsx|txt|vue|xml|ya?ml)`?\s+lines?\s+\d+(?:\s*-\s*\d+)?\b/i;
const EDITABLE_FILE_MENTION_PATTERN =
  /(?:^|\n|`|\s)[\w./\\ -]+\.(?:astro|c|cpp|cs|css|dart|go|html|java|js|jsx|json|kt|kts|md|mdx|php|py|rb|rs|scss|sh|sql|svelte|swift|toml|ts|tsx|txt|vue|xml|ya?ml)\b/i;
const EDIT_INSTRUCTION_FRAME_PATTERN =
  /(?:^|\n)\s*(?:one precise change|replace lines?\s+\d+(?:\s*-\s*\d+)?|old text|new text|with:|replace(?:\s+the)?\s+following)\b/i;
const TOOL_ACTION_PROMISE_PATTERN =
  /\b(?:let me|i(?:['\u2019]ll| will)|i am going to|i(?:['\u2019]m) going to|we(?:['\u2019]ll| will)|now\s+i(?:['\u2019]ll| will| need to)|next(?:,|:)?|wait\s*[-:])\b[\s\S]{0,320}\b(?:add|apply|call|change|check|compact|create|delete|do|edit|examine|execute|fix|implement|inspect|look|make|modify|patch|perform|reduce|refine|remove|replace|resize|retry|run|shrink|tighten|try|update|use|write)\b/i;
const STANDALONE_CODING_ACTION_PROMISE_PATTERN =
  /\b(?:now\s+)?i\s+need\s+to\s+(?:add|change|create|delete|edit|fix|implement|modify|patch|remove|replace|update|write)\b[\s\S]{0,360}\b(?:api|app|code|component|css|database|file|function|handler|hook|jsx|logic|module|route|screen|service|state|support|tsx|ui)\b[\s:;.,-]*$/i;
const TOOL_INVENTORY_NARRATION_PATTERN =
  /\b(?:available tools?|tools?\s+i\s+(?:do\s+)?have|tools?\s+available|what tools?\s+i\s+(?:do\s+)?have|i\s+(?:do\s+not|don't)\s+have\s+[\w.:-]+\s+available|tools?\s+attached|attached tools?)\b/i;
const CAPABILITY_INVENTORY_QUESTION_PATTERN =
  /\b(?:what|which|list|show|tell(?:\s+me)?|explain|describe)\b[\s\S]{0,180}\b(?:tools?|plugins?|apps?|skills?|capabilities?|connectors?)\b|\b(?:tools?|plugins?|apps?|skills?|capabilities?|connectors?)\b[\s\S]{0,180}\b(?:available|enabled|installed|connected|do\s+you\s+have|can\s+you\s+(?:access|call|use|do))\b/i;
const LOCAL_TOOLING_IMPLEMENTATION_QUESTION_PATTERN =
  /\b(?:our|this|the)\s+(?:app|code|codebase|project|repo|repository|workspace)\b[\s\S]{0,220}\b(?:tools?|plugins?|apps?|skills?|capabilities?|connectors?|prompt|prompts?)\b|\b(?:tools?|plugins?|apps?|skills?|capabilities?|connectors?|prompt|prompts?)\b[\s\S]{0,220}\b(?:code|codebase|implementation|registry|runtime|selector|source|workspace|actual\s+files?|how\s+(?:it|they)\s+work)\b/i;
const LOCAL_DEPLOYMENT_TOOL_ERROR_REPORT_PATTERN =
  /\b(?:fix|debug|issue|bug|error|not\s+working|instead\s+of|response\s+summary|summary|ai\s+is\s+done|tool\s+calls?|edits?|writes?|finishing\s+correctly)\b[\s\S]{0,1400}\b(?:I could not complete the requested deployment cleanly|No successful MCP or terminal deploy\/publish tool result was recorded|requested deployment cleanly)\b|\b(?:I could not complete the requested deployment cleanly|No successful MCP or terminal deploy\/publish tool result was recorded|requested deployment cleanly)\b[\s\S]{0,1400}\b(?:fix|debug|issue|bug|error|not\s+working|instead\s+of|response\s+summary|summary|ai\s+is\s+done|tool\s+calls?|edits?|writes?|finishing\s+correctly)\b/i;
const LOCAL_CONNECTED_TOOL_ERROR_REPORT_PATTERN =
  /\b(?:fix|debug|issue|bug|error|not\s+working|instead\s+of|response\s+summary|summary|ai\s+is\s+done|thinking\s+mode|system\s+prompt)\b[\s\S]{0,1400}\b(?:I could not complete the requested connected-tool action cleanly|No MCP, native app, or connector tool result was recorded|connected-tool action cleanly)\b|\b(?:I could not complete the requested connected-tool action cleanly|No MCP, native app, or connector tool result was recorded|connected-tool action cleanly)\b[\s\S]{0,1400}\b(?:fix|debug|issue|bug|error|not\s+working|instead\s+of|response\s+summary|summary|ai\s+is\s+done|thinking\s+mode|system\s+prompt)\b/i;
const CONVERSATION_ONLY_PROMPT_PATTERN =
  /^\s*(?:thanks?|thank you|ok(?:ay)?|cool|nice|got it|sounds good|perfect|great|continue|go on|tell me more|explain that|summarize(?: this)?(?: conversation| chat| thread)?)\s*[.!?]*\s*$/i;
const LOCAL_FACT_QUESTION_PATTERN =
  /\b(?:what|which|where|who|when|why|how|does|do|is|are|can|could|list|show|tell|explain|summari[sz]e|works?\s+with|supports?|available|configured|enabled)\b/i;
const LOCAL_WORKSPACE_REFERENCE_PATTERN =
  /\b(?:our|this|the)\s+(?:app|code|codebase|game|project|repo|repository|workspace)\b|\b(?:codebase|project|repo|repository|workspace|source\s+code)\b/i;
const LOCAL_CODE_ENTITY_PATTERN =
  /\b(?:adapter|api|avatar|backend|bridge|camera|canvas|component|config(?:uration)?|controls?|crafting|database|frontend|gameplay|garden|hud|input|integration|inventory|levels?|map|model|physics|player|plugins?|prompt|prompts?|providers?|registry|render(?:er|ing)?|resources?|route|runtime|scene|selector|service|settings?|simulation|tools?|tauri|three(?:\.js|js)?|typescript|vite|voxel|weather|webgl|world|openrouter|anthropic|openai|gemini|ollama|mapbox)\b/i;
const LOCAL_INTERACTIVE_PROJECT_TARGET_PATTERN =
  /\b(?:this|that|our|the|selected|local)\s+(?:game|gameplay|hud|canvas|scene|world|player|avatar|inventory|crafting|level|map|renderer|simulation|webgl|three(?:\.js|js)?|voxel)\b/i;
const LOCAL_EVIDENCE_VERIFICATION_PATTERN =
  /\b(?:check|confirm|inspect|look(?:\s+at)?|read|search|verify)\b[\s\S]{0,180}\b(?:code|codebase|files?|project|repo|repository|source|workspace|config(?:uration)?|provider|settings?|tool|runtime)\b/i;
const LOCAL_GIT_CHANGE_REVIEW_PATTERN =
  /\b(?:what(?:'s| is| all)?|which|show|list|summari[sz]e|explain|review|audit|check|tell(?: me)?)\b[\s\S]{0,180}\b(?:changed|changes|modified|uncommitted|dirty\s+tree|working[-\s]?tree|worktree|diff|status|done\s+so\s+far|files?\s+changed)\b/i;
const DEPLOYMENT_ACTION_PROMPT_PATTERN = DEPLOYMENT_HOSTING_PROMPT_PATTERN;
const DEPLOYMENT_ACTION_NEGATION_PATTERN =
  /\b(?:do\s+not|don't|dont|without|no)\s+(?:actually\s+)?(?:deploy(?:ing)?|publish(?:ing)?|push(?:ing)?\s+live|make\s+it\s+live|go\s+live)\b|\b(?:deploy(?:ing)?|publish(?:ing)?|push(?:ing)?\s+live|make\s+it\s+live|go\s+live)\b[\s\S]{0,40}\b(?:not\s+needed|isn't\s+needed|is\s+not\s+needed)\b/i;
const DEPLOYMENT_SUCCESS_CLAIM_PATTERN =
  /\b(?:deploy(?:ed|ment)\s+(?:completed|succeeded|successful|finished)|deployed\s+(?:successfully|to|on)|hosting\s+(?:updated|deployed)|published\s+(?:successfully|to|on)|site\s+(?:is\s+)?live|went\s+live)\b/i;
const DEPLOYMENT_NO_TOOL_BLOCKER_PATTERN =
  /\b(?:can(?:not|'t)|could\s+not|don't\s+have|do\s+not\s+have|no)\b[\s\S]{0,180}\b(?:deploy(?:ment)?\s+tools?|firebase\s+mcp|mcp\s+tools?|terminal(?:\s+tools?)?|tools?\s+(?:available|exposed|attached))\b|\b(?:from\s+your\s+terminal|run\s+(?:this|the)\s+command\s+(?:yourself|manually)|you\s+can\s+(?:deploy|run)|to\s+deploy\s+it\s+manually)\b/i;

function looksLikeInteractiveProjectChangePrompt(prompt: string) {
  return (
    /\b(?:add|build|change|create|develop|edit|enhance|expand|fix|implement|improve|make|patch|polish|redesign|refactor|remove|replace|revamp|style|tweak|update|upgrade|write)\b[\s\S]{0,180}\b(?:game|gameplay|hud|canvas|scene|world|player|avatar|inventory|crafting|level|map|renderer|simulation|webgl|three(?:\.js|js)?|voxel)\b/i.test(prompt) ||
    /\b(?:game|gameplay|hud|canvas|scene|world|player|avatar|inventory|crafting|level|map|renderer|simulation|webgl|three(?:\.js|js)?|voxel)\b[\s\S]{0,180}\b(?:better|cleaner|clearer|fixed|fun|improved?|more|playable|polished|reliable|smooth(?:er)?|updated?|work(?:ing)?)\b/i.test(prompt)
  );
}
const CONNECTED_TOOL_ACTION_PROMPT_PATTERN =
  /\b(?:archive|book|call|cancel|check|close|comment|configure|connect|create|deploy|draft|fetch|find|get|inspect|install|label|list|manage|merge|modify|open|post|publish|read|refresh|reply|reschedule|run|schedule|search|send|sync|test|triage|update|use|verify)\b/i;
const CONNECTED_TOOL_READ_TARGET_PATTERN_SOURCE = `mcp|server|tool|plugin|connector|app|${CONNECTED_TOOL_SERVICE_PATTERN_SOURCE}`;
const CONNECTED_TOOL_MUTATION_TARGET_PATTERN_SOURCE = `mcp|server|tool|plugin|connector|app|email|calendar|event|issue|pull\\s+request|pr|message|customer|payment|hosting|${CONNECTED_TOOL_SERVICE_PATTERN_SOURCE}`;
const CONNECTED_TOOL_READ_SUCCESS_CLAIM_PATTERN = new RegExp(
  `\\b(?:checked|fetched|found|got|inspected|listed|looked\\s+up|read|refreshed|searched|verified)\\b[\\s\\S]{0,180}\\b(?:${CONNECTED_TOOL_READ_TARGET_PATTERN_SOURCE})\\b`,
  "i",
);
const CONNECTED_TOOL_MUTATION_SUCCESS_CLAIM_PATTERN = new RegExp(
  `\\b(?:archived|booked|cancelled|canceled|closed|commented|configured|connected|created|deployed|drafted|installed|labeled|merged|modified|posted|published|replied|rescheduled|scheduled|sent|synced|updated)\\b[\\s\\S]{0,220}\\b(?:${CONNECTED_TOOL_MUTATION_TARGET_PATTERN_SOURCE})\\b`,
  "i",
);
const CONNECTED_TOOL_NO_TOOL_BLOCKER_PATTERN = new RegExp(
  `\\b(?:can(?:not|'t)|could\\s+not|don't\\s+have|do\\s+not\\s+have|no)\\b[\\s\\S]{0,180}\\b(?:mcp|server|tool|plugin|connector|connected\\s+app|${CONNECTED_TOOL_SERVICE_PATTERN_SOURCE})(?:\\s+tools?)?\\b|\\b(?:from\\s+your\\s+(?:browser|dashboard|terminal)|run\\s+(?:this|the)\\s+command\\s+(?:yourself|manually)|you\\s+can\\s+(?:connect|configure|deploy|send|run|install|update)|to\\s+(?:connect|configure|deploy|send|install|update)\\s+it\\s+manually)\\b`,
  "i",
);

function referencesAppToolName(content: string) {
  return APP_TOOL_NAME_PATTERN.test(content);
}

export function looksLikeCapabilityInventoryQuestion(prompt: string) {
  const trimmed = prompt.trim();

  if (!trimmed) {
    return false;
  }

  return CAPABILITY_INVENTORY_QUESTION_PATTERN.test(trimmed);
}

export function promptRequestsDeploymentAction(prompt: string) {
  const trimmed = prompt.trim();

  return Boolean(
    trimmed &&
    DEPLOYMENT_ACTION_PROMPT_PATTERN.test(trimmed) &&
    !DEPLOYMENT_ACTION_NEGATION_PATTERN.test(trimmed) &&
    !looksLikeLocalDeploymentToolErrorReport(trimmed)
  );
}

export function promptRequestsConnectedToolAction(prompt: string) {
  const trimmed = prompt.trim();

  if (!trimmed || trimmed.length > 4_000 || CONVERSATION_ONLY_PROMPT_PATTERN.test(trimmed)) {
    return false;
  }

  if (looksLikeLocalConnectedToolErrorReport(trimmed)) {
    return false;
  }

  if (looksLikeCapabilityInventoryQuestion(trimmed) && !looksLikeLocalToolingImplementationQuestion(trimmed)) {
    return false;
  }

  return CONNECTED_TOOL_SERVICE_PROMPT_PATTERN.test(trimmed) && CONNECTED_TOOL_ACTION_PROMPT_PATTERN.test(trimmed);
}

export function hasSuccessfulDeploymentToolCall(toolCalls: ChatToolCall[] = []) {
  return toolCalls.some((toolCall) => {
    if (!isDeploymentToolAttempt(toolCall) || toolCall.status !== "complete") {
      return false;
    }

    const toolId = toolCall.toolId ?? "";
    const text = deploymentToolCallText(toolCall);

    if (toolId === "terminal_run") {
      return isSuccessfulTerminalToolCall(toolCall);
    }

    if (toolId === "mcp_call_tool") {
      return !/\bstatus:\s*(?:tool\s+reported\s+error|error)|\b(?:failed|failure|errored)\b/i.test(text);
    }

    return false;
  });
}

export function hasDeploymentToolAttempt(toolCalls: ChatToolCall[] = []) {
  return toolCalls.some(isDeploymentToolAttempt);
}

export function looksLikeUnsupportedDeploymentAnswer(content: string, toolCalls: ChatToolCall[] = []) {
  const trimmed = content.trim();

  if (!trimmed || hasSuccessfulDeploymentToolCall(toolCalls)) {
    return false;
  }

  return DEPLOYMENT_SUCCESS_CLAIM_PATTERN.test(trimmed) || DEPLOYMENT_NO_TOOL_BLOCKER_PATTERN.test(trimmed);
}

export function hasConnectedToolEvidence(toolCalls: ChatToolCall[] = []) {
  return toolCalls.some((toolCall) =>
    isConnectedToolCall(toolCall) &&
    (toolCall.status === "complete" || toolCall.status === "error" || toolCall.status === "skipped")
  );
}

export function hasSuccessfulConnectedToolMutation(toolCalls: ChatToolCall[] = []) {
  return toolCalls.some((toolCall) =>
    isConnectedToolMutationCall(toolCall) &&
    toolCall.status === "complete" &&
    !/\bstatus:\s*(?:tool\s+reported\s+error|error)|\b(?:failed|failure|errored)\b/i.test(connectedToolCallText(toolCall))
  );
}

export function looksLikeUnsupportedConnectedToolActionAnswer(content: string, toolCalls: ChatToolCall[] = []) {
  const trimmed = content.trim();

  if (!trimmed) {
    return false;
  }

  const hasEvidence = hasConnectedToolEvidence(toolCalls);
  const hasMutation = hasSuccessfulConnectedToolMutation(toolCalls);

  return (
    (!hasEvidence && (CONNECTED_TOOL_NO_TOOL_BLOCKER_PATTERN.test(trimmed) || CONNECTED_TOOL_READ_SUCCESS_CLAIM_PATTERN.test(trimmed))) ||
    (!hasMutation && CONNECTED_TOOL_MUTATION_SUCCESS_CLAIM_PATTERN.test(trimmed))
  );
}

export function createDeploymentEvidenceRecoveryInstruction(prompt: string, unsupportedAnswer: string, options: { canUseProviderTools?: boolean } = {}) {
  const excerpt = unsupportedAnswer.replace(/\s+/g, " ").trim().slice(0, 700);
  const canUseProviderTools = options.canUseProviderTools !== false;

  return [
    "DEPLOYMENT EVIDENCE REQUIRED",
    `Original user request: ${prompt}`,
    "The previous response handled the request without a successful deploy/publish tool result.",
    canUseProviderTools
      ? "Use the real provider tool-call channel now. If MCP tools are attached, call mcp_list_servers first, then mcp_list_tools for the matching server, then mcp_call_tool with the exact deploy/hosting tool and required target/site arguments. If terminal_run is attached and MCP cannot complete the deploy, run the build/deploy command from the correct project directory and report the real result."
      : "No provider deployment tools are attached for this retry. Do not claim a deploy ran; state the exact deployment-tool blocker plainly.",
    "Do not tell the user to run the deploy manually while an attached MCP or terminal tool can do it. Do not claim deployed, published, live, or verified until a current tool result proves it.",
    excerpt ? `Rejected deployment answer excerpt: ${excerpt}` : "",
  ].filter(Boolean).join("\n\n");
}

export function createConnectedToolEvidenceRecoveryInstruction(prompt: string, unsupportedAnswer: string, options: { canUseProviderTools?: boolean } = {}) {
  const excerpt = unsupportedAnswer.replace(/\s+/g, " ").trim().slice(0, 700);
  const canUseProviderTools = options.canUseProviderTools !== false;

  return [
    "CONNECTED TOOL EVIDENCE REQUIRED",
    `Original user request: ${prompt}`,
    "The previous response handled a connected app, plugin, connector, or MCP request without a matching current tool result.",
    canUseProviderTools
      ? "Use the real provider tool-call channel now. For MCP-backed services, call mcp_list_servers, then mcp_list_tools for the matching server, then mcp_call_tool only with the exact serverId, toolName, and JSON arguments. For native app tools such as Gmail, Google Calendar, or GitHub, call the account/list/search/read tool before answering, and call the mutating tool only when the user requested an action."
      : "No matching provider connected-app or MCP tools are attached for this retry. Do not claim the external action ran; state the exact setup or tool-availability blocker plainly.",
    "Do not claim a message, calendar event, issue, pull request, payment object, deployment, MCP action, or connector update happened until a current tool result proves it. If only catalog metadata is available, call it catalog/setup information.",
    excerpt ? `Rejected connected-tool answer excerpt: ${excerpt}` : "",
  ].filter(Boolean).join("\n\n");
}

function isDeploymentToolAttempt(toolCall: ChatToolCall) {
  const toolId = toolCall.toolId ?? "";

  if (toolId !== "terminal_run" && toolId !== "mcp_call_tool") {
    return false;
  }

  return DEPLOYMENT_TOOL_EVIDENCE_PATTERN.test(deploymentToolCallText(toolCall));
}

function deploymentToolCallText(toolCall: ChatToolCall) {
  return [
    toolCall.toolId ?? "",
    toolCall.label,
    toolCall.detail ?? "",
    toolCall.input ?? "",
    toolCall.output ?? "",
    toolCall.terminal?.command ?? "",
    toolCall.terminal?.workingDirectory ?? "",
  ].join("\n");
}

function isConnectedToolCall(toolCall: ChatToolCall) {
  const toolId = toolCall.toolId ?? "";
  const label = toolCall.label ?? "";

  if (/^(?:mcp|github|gmail|calendar)_/i.test(toolId)) {
    return true;
  }

  if (/(?:^|[._:-])(?:mcp|github|gmail|calendar)(?:$|[._:-])/i.test(toolId)) {
    return true;
  }

  if (/^(?:files|git|terminal|browser|web|bridge)_/i.test(toolId)) {
    return false;
  }

  return /\b(?:mcp|github|gmail|google\s+calendar|calendar)\b/i.test(label);
}

function isConnectedToolMutationCall(toolCall: ChatToolCall) {
  const toolId = toolCall.toolId ?? "";
  const label = toolCall.label ?? "";

  if (
    toolId === "mcp_call_tool" ||
    /^(?:gmail_(?:api_write|api_delete|batch_modify_messages|create_draft|create_label|delete_draft|modify_message_labels|send_|trash_message|untrash_message)|calendar_(?:api_write|api_delete|clear_completed_tasks|create_|delete_|move_task|update_)|github_(?:api_write|api_delete|add_issue_labels|approve_workflow_run|assign_issue|cancel_workflow_run|clear_issue_labels|close_issue|comment_issue|commit_files|create_|delete_|dispatch_workflow|force_cancel_workflow_run|lock_issue|mark_|merge_pull_request|pin_issue|remove_|reopen_issue|request_pull_request_reviewers|rerun_workflow_run|review_pending_deployments|set_issue_labels|star_repository|transfer_issue|unassign_issue|unlock_issue|unpin_issue|unstar_repository|unwatch_repository|update_|watch_repository))/i.test(toolId)
  ) {
    return true;
  }

  if (!isConnectedToolCall(toolCall) || /^(?:files|git|terminal|browser|web|bridge)_/i.test(toolId)) {
    return false;
  }

  return /\b(?:archive|book|cancel|close|comment|configure|connect|create|delete|draft|install|label|manage|merge|modify|post|publish|reply|reschedule|schedule|send|sync|triage|update)\b[\s\S]{0,160}\b(?:mcp|github|gmail|google\s+calendar|calendar|email|event|issue|pull\s+request|pr|message)\b/i.test(`${toolId}\n${label}`);
}

function connectedToolCallText(toolCall: ChatToolCall) {
  return [
    toolCall.toolId ?? "",
    toolCall.label,
    toolCall.detail ?? "",
    toolCall.input ?? "",
    toolCall.output ?? "",
  ].join("\n");
}

function looksLikeLocalToolingImplementationQuestion(prompt: string) {
  return LOCAL_TOOLING_IMPLEMENTATION_QUESTION_PATTERN.test(prompt.trim());
}

function looksLikeLocalDeploymentToolErrorReport(prompt: string) {
  return LOCAL_DEPLOYMENT_TOOL_ERROR_REPORT_PATTERN.test(prompt.trim());
}

function looksLikeLocalConnectedToolErrorReport(prompt: string) {
  return LOCAL_CONNECTED_TOOL_ERROR_REPORT_PATTERN.test(prompt.trim());
}

export function hasSuccessfulMutatingFileToolCall(toolCalls: ChatToolCall[]) {
  return toolCalls.some((toolCall) => {
    if (toolCall.status !== "complete") {
      return false;
    }

    const toolId = toolCall.toolId ?? "";
    return (
      /^files_(?:append|apply_patch|copy|create_directory|edit_many|exact_replace|insert_at_line|move|replace_range|replace_span|write|write_many)\b/i.test(toolId) ||
      (toolCall.fileChanges?.length ?? 0) > 0 ||
      toolCall.batchSummary?.operation === "edit" ||
      toolCall.batchSummary?.operation === "write" ||
      toolCall.batchFileResults?.some((result) => result.status === "ok")
    );
  });
}

/** Detects visible explanations of the hidden action protocol instead of real runtime evidence. */
export function looksLikeToolProtocolNarration(content: string) {
  const trimmed = content.trim();

  if (!trimmed) {
    return false;
  }

  return (
    /<<<\s*(?:END_)?TOOL_CALL\s*>>>/i.test(trimmed) ||
    /<\s*\|\s*DSML\s*\|\s*(?:tool_calls|invoke|parameter)\b/i.test(trimmed) ||
    /\bBRIDGE_TOOL_CALL\s*:\s*{/i.test(trimmed) ||
    /<\s*\/?\s*tool_call\b/i.test(trimmed) ||
    /<\s*\/?\s*(?:files_|git_|terminal_|browser_|web_|github_|gmail_|calendar_|bridge_)[\w.-]+\b/i.test(trimmed) ||
    /<\s*\/?\s*arg_(?:key|value)\b/i.test(trimmed) ||
    /\barg_(?:key|value)\b[\s\S]{0,120}\b(?:path|command|cwd|old_text|new_text|files_read|edit_file|run_terminal)\b/i.test(trimmed) ||
    looksLikeProviderToolCallJson(trimmed) ||
    /\b(?:xml-style|xml style|compact)\s+tool_call\b/i.test(trimmed)
  );
}

function looksLikeProviderToolCallJson(trimmed: string) {
  if (!/"tool_calls"\s*:\s*\[/i.test(trimmed)) {
    return false;
  }

  return (
    /"function"\s*:\s*"(?:files_|git_|terminal_|browser_|web_|github_|gmail_|calendar_|bridge_)[\w.-]+"/i.test(trimmed) ||
    /"function"\s*:\s*\{[\s\S]{0,700}"name"\s*:\s*"(?:files_|git_|terminal_|browser_|web_|github_|gmail_|calendar_|bridge_)[\w.-]+"/i.test(trimmed) ||
    /"parameters"\s*:\s*\{[\s\S]{0,700}"(?:path|cwd|command|query|url|oldText|newText)"\s*:/i.test(trimmed)
  );
}

export function isToolResultFallbackAnswer(content: string) {
  const trimmed = content.trim();
  const normalized = content.toLowerCase();
  const looksLikeRawBridgeError =
    trimmed.length <= 1_000 &&
    (
      /^arguments\.[\w.]+\s+(?:must be\s+[a-z]+(?:\s+[a-z]+){0,4}|is not allowed|required|invalid)\.?$/i.test(trimmed) ||
      /^no bridge tool is registered as\s+[\w.-]+\.?$/i.test(trimmed) ||
      /^tool\s+[\w.-]+\s+received\s+(?:invalid json arguments|arguments that could not be parsed as json)\b/i.test(trimmed)
    );
  const looksLikeRawReadFailure =
    /^i could not complete that action:\s+could not read\b/i.test(trimmed) ||
    /^could not read\b[\s\S]{0,500}\b(?:cannot find the file specified|cannot find the path specified|no such file or directory|os error [23])\b/i.test(trimmed);
  const looksLikeToolFailureFallback =
    /^read workspace file did not complete cleanly\b/i.test(trimmed) ||
    /^[\w\s]+did not complete cleanly\.\s*(?:status:\s*)?(?:error|skipped)?[\s\S]{0,500}\b(?:invalid argument shape|arguments\.[\w.]+\s+(?:must be|is not allowed|required|invalid)|tool call used an invalid)\b/i.test(trimmed);
  const looksLikeReadSuccessFallback =
    normalized.includes("the full file body was kept out of the visible chat") ||
    /^i read\b[\s\S]{0,300}\bsuccessfully\.[\s\S]{0,160}\bit is [\d,]+ characters across [\d,]+ lines?\./i.test(trimmed);

  return (
    looksLikeRawBridgeError ||
    looksLikeRawReadFailure ||
    looksLikeToolFailureFallback ||
    looksLikeReadSuccessFallback ||
    content.includes("## Answer From Completed Tool Results") ||
    content.includes("## Tool Run Needs Continuation") ||
    normalized.includes("final write-up did not come back cleanly") ||
    normalized.includes("could not produce a clean final answer") ||
    normalized.includes("could not complete that action cleanly") ||
    normalized.includes("model finished without producing a final answer") ||
    normalized.includes("finished the background work for this request") ||
    normalized.includes("use continue response") ||
    normalized.includes("use the saved tool result to answer the request") ||
    normalized.includes("use the saved result to answer the request") ||
    normalized.includes("use the saved git result to answer") ||
    normalized.includes("use the matching paths and line references from the saved result") ||
    normalized.includes("i hit a recoverable tool error before the final answer finished") ||
    normalized.includes("i gathered the tool result, but the final answer did not finish cleanly") ||
    normalized.includes("the tool result included suggested file paths") ||
    normalized.includes("the next pass should continue from the attached tool result") ||
    content.includes("RECOVERABLE TOOL ERROR") ||
    normalized.includes("not a final chat answer") ||
    normalized.includes("tool evidence for the next synthesis pass") ||
    content.includes("TOOL RESULT EVIDENCE") ||
    /\btool:\s*files_[\w-]+\b[\s\S]{0,160}\bcall id:\s*/i.test(content) ||
    normalized.includes("i kept the full file body out of this message") ||
    normalized.includes("the completed read is available to the current run") ||
    normalized.includes("the full listing was kept with the tool result") ||
    normalized.includes("full file content is saved") ||
    normalized.includes("full listing is saved") ||
    normalized.includes("full result is saved") ||
    normalized.includes("full file content was kept with the tool result") ||
    normalized.includes("full listing was kept with the tool result") ||
    normalized.includes("full result is kept with the tool record") ||
    normalized.includes("provider-visible tool output excerpt ended") ||
    normalized.includes("provider-visible tool output excerpt omitted") ||
    normalized.includes("replay excerpt ended for provider context recovery") ||
    normalized.includes("do not claim the tool or file read itself was truncated") ||
    normalized.includes("workspace tree summary for") ||
    /\bscanned\s+[\d,]+\s+director(?:y|ies)\s+and\s+[\d,]+\s+files?\s+to\s+depth\b/i.test(content) ||
    content.includes("Latest completed result:") ||
    content.includes("The run stopped on this ") ||
    content.includes("I completed the tool work. Here are the saved results:") ||
    content.includes("provider still did not return separate visible answer text")
  );
}

/** Detects internal recovery prose that should be retried, not shown as an answer. */
export function looksLikeInternalToolRecoveryAnswer(content: string) {
  const normalized = content.trim().toLowerCase();

  return (
    looksLikeOnlyToolPrelude(content) ||
    looksLikeToolProtocolNarration(content) ||
    isToolResultFallbackAnswer(content) ||
    normalized.includes("use continue response to keep this same run moving") ||
    normalized.includes("instead of leaving the chat blank") ||
    normalized.includes("that tool action was skipped or blocked") ||
    normalized.includes("check the tool result") ||
    normalized.includes("adaptation recommendation") ||
    /\btool\s+\d+\s+\[(?:error|failed|skipped|waiting[_ -]?approval)\]:/i.test(normalized) ||
    /(?:^|\n)\s*(?:#{1,3}\s*)?(?:original request|what ran|evidence)\b[\s\S]{0,240}\b(executed|completed|tool call)\b/.test(normalized)
  );
}

/** Detects model-written imitations of app tool records. Real work must live on message.toolCalls. */
export function looksLikeFabricatedToolProgress(content: string, toolCalls: ChatToolCall[] = []) {
  const trimmed = content.trim();

  if (!trimmed) {
    return false;
  }

  if (/\[CONVERSATION CONTEXT SURFACE\]/i.test(trimmed)) {
    return true;
  }

  if (toolCalls.length > 0) {
    return false;
  }

  const status = String.raw`\[(?:active|complete|completed|error|failed|skipped|waiting[_ -]?approval|pending)\]`;
  const fakeToolLine = new RegExp(String.raw`\b(?:edit file|inline edit|write file|read file|apply search\/replace|run terminal command|terminal command|web search|browser automation)\s*${status}\s+(?:detail|input|output|old|new|line|command|cwd)\s*:`, "i");
  const fakeProgressLine = new RegExp(String.raw`\bagent tools\s*${status}\s*-\s*\d+\s+(?:deep research\s+)?tools?\s+ran\b`, "i");
  const unsupportedCompletionClaim =
    /\b(?:i|i've|i have|we|the app)\s+(?:edited|updated|patched|changed|applied|ran|executed)\b/i.test(trimmed) &&
    /\b(?:line\s+\d+|\.tsx?|\.jsx?|\.css|\.json|npx|npm|pnpm|yarn|tsc|typecheck|terminal|dev server|hot[- ]?reload|tool calls?)\b/i.test(trimmed);

  return (
    /\b(?:TOOL|TOL)\s+CALLS?\b/i.test(trimmed) && /\b(?:detail|input|output|old|new|line_start|line_end|command|cwd)\s*:/i.test(trimmed) ||
    fakeToolLine.test(trimmed) ||
    fakeProgressLine.test(trimmed) ||
    unsupportedCompletionClaim ||
    /\bCommand:\s*[^\n]+\nShell:\s*[^\n]+\nWorking directory:\s*[^\n]+\nExit code:\s*(?:-?\d+|none)\b/i.test(trimmed)
  );
}

export function createFabricatedToolProgressRecoveryInstruction(prompt: string, fabricatedContent: string, toolCalls: ChatToolCall[] = []) {
  const hasRealToolRecords = toolCalls.length > 0;
  const excerpt = fabricatedContent.replace(/\s+/g, " ").trim().slice(0, 700);

  return [
    "TOOL RECORD INTEGRITY CHECK",
    `Original user request: ${prompt}`,
    hasRealToolRecords
      ? "The previous visible answer exposed internal tool-progress text instead of answering from the app's real tool-call records."
      : "The previous visible answer claimed tool calls, file edits, terminal output, or progress records, but the app has no real tool-call records for that claim.",
    "Do not repeat or summarize fake tool progress. Never paste [CONVERSATION CONTEXT SURFACE], TOOL CALLS, PROGRESS, command output, or edit/run status lines as if they were real work.",
    "Do not claim any local tool ran unless a real app tool-call record is already present.",
    excerpt ? `Rejected fake tool-progress excerpt: ${excerpt}` : "",
  ].filter(Boolean).join("\n\n");
}

/** Creates a retry turn when the assistant promised a tool action but emitted no tool call. */
export function createToolActionPromiseRecoveryInstruction(prompt: string, promisedContent: string) {
  const excerpt = promisedContent.replace(/\s+/g, " ").trim().slice(0, 700);

  return [
    "LOCAL TOOL PROMISE REJECTED",
    `Original user request: ${prompt}`,
    "The previous visible answer promised a local tool action without a real app tool-call record.",
    "Do not repeat the promise or emit text-only tool syntax. If the same local action is still needed and an app tool is attached to the request, use the real provider tool-call channel now. If no tool is needed, answer normally in user-facing Markdown.",
    excerpt ? `Rejected promise excerpt: ${excerpt}` : "",
  ].filter(Boolean).join("\n\n");
}

/** Creates a retry turn when the model pasted "updated" files instead of applying edits. */
export function createUnappliedFileEditRecoveryInstruction(prompt: string, unappliedContent: string) {
  const excerpt = unappliedContent.replace(/\s+/g, " ").trim().slice(0, 700);

  return [
    "UNAPPLIED FILE EDIT ANSWER REJECTED",
    `Original user request: ${prompt}`,
    "The previous visible answer described updated file contents or claimed code changes, but no successful mutating file/edit/write tool-call record exists for those changes.",
    "Do not paste proposed replacement files as the final answer. Use the attached real edit/write tool now, preferably files_edit_many for precise same-pass edits or files_write_many for deliberate new/full-file writes.",
    "After the real edit tool succeeds, summarize what changed in the same language as the user.",
    excerpt ? `Rejected unapplied edit excerpt: ${excerpt}` : "",
  ].filter(Boolean).join("\n\n");
}

/** Creates a retry turn when the model asks for confirmation instead of doing an ordinary attached-tool action. */
export function createUnnecessaryLocalActionConfirmationRecoveryInstruction(prompt: string, confirmationContent: string) {
  const excerpt = confirmationContent.replace(/\s+/g, " ").trim().slice(0, 700);

  return [
    "UNNECESSARY LOCAL ACTION CONFIRMATION REJECTED",
    `Original user request: ${prompt}`,
    "The previous visible answer asked for confirmation before doing an ordinary local edit/install/run action that the user had already requested.",
    "Do not ask the user to confirm routine local workspace work. Use the attached real provider tool-call channel now. The app's approval UI will handle actions that need approval.",
    "If the action is truly destructive, credential-sensitive, or impossible without user input, ask one concise blocker question; otherwise execute.",
    excerpt ? `Rejected confirmation excerpt: ${excerpt}` : "",
  ].filter(Boolean).join("\n\n");
}

/** Creates a retry turn when the assistant exposed how to call tools instead of using them. */
export function createToolProtocolNarrationRecoveryInstruction(prompt: string, narratedContent: string) {
  const excerpt = narratedContent.replace(/\s+/g, " ").trim().slice(0, 700);

  return [
    "TOOL PROTOCOL NARRATION REJECTED",
    `Original user request: ${prompt}`,
    "The previous visible response exposed hidden tool-call protocol or provider-native tool JSON instead of doing useful work.",
    "Do not explain hidden tool protocol, batching mechanics, cwd choices, shell choices, timeout choices, provider-native JSON, or step-by-step tool formatting.",
    "Do not emit visible tool-call syntax, JSON envelopes, provider tool_calls, or a whole-response code fence unless the original user explicitly requested JSON or code-only output.",
    "If the same action is still needed and the app exposes that tool, request it through the real provider tool-call channel now. If no tool is needed, answer normally in user-facing Markdown.",
    excerpt ? `Rejected protocol narration excerpt: ${excerpt}` : "",
  ].filter(Boolean).join("\n\n");
}

export function createCompletedToolFallbackSummary(toolCall: ChatToolCall, output: string) {
  if (toolCall.resultPolicy && toolCall.resultPolicy.mode !== "allow_raw" && !toolCall.resultPolicy.synthesizeAfterwards) {
    return createVisibleFallbackFromToolCall({
      ...toolCall,
      output,
    });
  }

  if (isFileReadSynthesisToolCall(toolCall)) {
    return null;
  }

  const label = toolCall.label.toLowerCase();

  if (/list.*(?:directory|workspace)|(?:directory|workspace).*list/i.test(label)) {
    return createDirectoryListingFallbackSummary(output, toolCall.input);
  }

  if (/read.*(?:file|workspace)|(?:file|workspace).*read/i.test(label)) {
    return createReadFileFallbackSummary(output, toolCall.input);
  }

  return null;
}

export function isFileReadSynthesisToolCall(toolCall: Pick<ChatToolCall, "label" | "resultPolicy" | "toolId">) {
  if (toolCall.resultPolicy?.synthesizeAfterwards !== true) {
    return false;
  }

  const toolId = toolCall.toolId ?? "";
  const label = toolCall.label.toLowerCase();

  return (
    toolId === "files_read" ||
    toolId === "files_read_many" ||
    toolId === "files_read_range" ||
    (toolCall.resultPolicy.resultKind === "file_content" && /read.*(?:workspace\s+)?file|(?:workspace\s+)?file.*read/i.test(label))
  );
}

export function createNeutralToolSynthesisFailureMessage() {
  return "I couldn't finish a clean answer for that request. Please retry it.";
}

function createDirectoryListingFallbackSummary(output: string, input?: string) {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const header = lines[0] ?? "";
  const headerMatch = header.match(/^(?:Recursive directory tree|Directory)\s+(.+?)\s+\(([\d,]+)\s+entries\):$/i);
  const rootPath = headerMatch?.[1] ?? parseToolInputPath(input);
  const declaredEntries = headerMatch?.[2] ? Number.parseInt(headerMatch[2].replace(/,/g, ""), 10) : undefined;
  const entryLines = lines.filter((line) => /^\[(?:dir|file)\]\s+/.test(line));

  if (entryLines.length === 0 && !declaredEntries) {
    return null;
  }

  let directoryCount = 0;
  let fileCount = 0;
  const extensionCounts = new Map<string, number>();
  const topLevelDirectories = new Set<string>();

  for (const line of entryLines) {
    const isDirectory = line.startsWith("[dir]");
    const entryPath = line.replace(/^\[(?:dir|file)\]\s+/, "");

    if (isDirectory) {
      directoryCount += 1;
      const topDirectory = getTopLevelEntryName(entryPath, rootPath);
      if (topDirectory) {
        topLevelDirectories.add(topDirectory);
      }
      continue;
    }

    fileCount += 1;
    const extension = getFileExtension(entryPath);
    extensionCounts.set(extension, (extensionCounts.get(extension) ?? 0) + 1);
  }

  const entryCount = declaredEntries ?? entryLines.length;
  const extensionSummary = [...extensionCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 10)
    .map(([extension, count]) => `${extension} ${formatFallbackNumber(count)}`)
    .join("; ");
  const directorySummary = [...topLevelDirectories].slice(0, 12).join(", ");

  return [
    `Listed ${formatFallbackNumber(entryCount)} director${entryCount === 1 ? "y entry" : "y entries"}${rootPath ? ` in ${rootPath}` : ""}.`,
    `Directories: ${formatFallbackNumber(directoryCount)}. Files: ${formatFallbackNumber(fileCount)}.`,
    extensionSummary ? `Top file types: ${extensionSummary}.` : "",
    directorySummary ? `Top-level folders seen: ${directorySummary}.` : "",
    /limited/i.test(output) ? "The listing was limited by the tool result." : "",
    "The full listing was kept with the tool result and was not pasted into chat.",
  ].filter(Boolean).join("\n");
}

function createReadFileFallbackSummary(output: string, input?: string) {
  const path = parseToolInputPath(input);
  const lineCount = countFallbackLines(output);

  return [
    `I read ${path ? `\`${path}\`` : "the requested file"} successfully.`,
    `It is ${formatFallbackNumber(output.length)} characters across ${formatFallbackNumber(lineCount)} line${lineCount === 1 ? "" : "s"}.`,
    "The full file body was kept out of the visible chat so the response stays readable.",
  ].join("\n");
}

function parseToolInputPath(input?: string) {
  if (!input) {
    return "";
  }

  try {
    const parsed = JSON.parse(input) as { path?: unknown };
    return typeof parsed.path === "string" ? parsed.path : "";
  } catch {
    return "";
  }
}

function getTopLevelEntryName(path: string, rootPath: string) {
  const relativePath = rootPath && normalizePathForCompare(path).startsWith(normalizePathForCompare(rootPath))
    ? path.slice(rootPath.length).replace(/^[\\/]+/, "")
    : path;
  return relativePath.split(/[\\/]+/).filter(Boolean)[0] ?? "";
}

function normalizePathForCompare(path: string) {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function getFileExtension(path: string) {
  const name = path.split(/[\\/]+/).pop() ?? "";
  const index = name.lastIndexOf(".");
  return index >= 0 && index < name.length - 1 ? `.${name.slice(index + 1).toLowerCase()}` : "(no extension)";
}

function countFallbackLines(content: string) {
  if (!content) {
    return 0;
  }

  const newlineCount = content.match(/\n/g)?.length ?? 0;
  return content.endsWith("\n") ? newlineCount : newlineCount + 1;
}

function formatFallbackNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

/** Detects local build/edit/project requests that should not be answered without fresh tools. */
export function needsFreshLocalToolEvidence(prompt: string, hasWorkspaceRoots: boolean) {
  if (!hasWorkspaceRoots) {
    return false;
  }

  const trimmed = prompt.trim();

  if (!trimmed || trimmed.length > 3_000 || CONVERSATION_ONLY_PROMPT_PATTERN.test(trimmed)) {
    return false;
  }

  if (looksLikeCapabilityInventoryQuestion(trimmed) && !looksLikeLocalToolingImplementationQuestion(trimmed)) {
    return false;
  }

  const asksForFacts = LOCAL_FACT_QUESTION_PATTERN.test(trimmed);
  const referencesWorkspace = LOCAL_WORKSPACE_REFERENCE_PATTERN.test(trimmed);
  const referencesCodeEntity = LOCAL_CODE_ENTITY_PATTERN.test(trimmed) || LOCAL_INTERACTIVE_PROJECT_TARGET_PATTERN.test(trimmed);
  const requestsVerification = LOCAL_EVIDENCE_VERIFICATION_PATTERN.test(trimmed);
  const requestsGitChangeReview = LOCAL_GIT_CHANGE_REVIEW_PATTERN.test(trimmed);

  return requestsVerification || requestsGitChangeReview || (asksForFacts && (referencesWorkspace || referencesCodeEntity));
}

/** Detects prompts where answering without a real workspace tool call is worse than waiting. */
export function requiresWorkspaceToolCallForPrompt(prompt: string, hasWorkspaceRoots: boolean) {
  if (!hasWorkspaceRoots) {
    return false;
  }

  const trimmed = prompt.trim();

  if (!trimmed || trimmed.length > 4_000 || CONVERSATION_ONLY_PROMPT_PATTERN.test(trimmed)) {
    return false;
  }

  if (looksLikeCapabilityInventoryQuestion(trimmed) && !looksLikeLocalToolingImplementationQuestion(trimmed)) {
    return false;
  }

  const asksToContinueWork = /\b(?:do\s+(?:it|the\s+job)|continue|finish(?:\s+it)?|go\s+ahead|make\s+it\s+happen|apply\s+(?:it|that|the\s+change))\b/i.test(trimmed);
  const asksForInteractiveProjectChange = looksLikeInteractiveProjectChangePrompt(trimmed);
  const asksForEdit =
    /\b(?:add|append|change|create|delete|edit|fix|implement|improve|insert|make\s+(?:it|this|that)?\s*(?:look\s+|feel\s+|more\s+)?(?:better|cleaner|clearer|polished|readable)|modi(?:fy|fy|y)|patch|polish|refactor|remove|replace|restyle|revamp|style|tweak|update|upgrade|write)\b/i.test(trimmed);
  const asksForAppBehaviorChange =
    /\b(?:when|if|after|on)\b[\s\S]{0,220}\b(?:should|shouldn['’]?t|should\s+not|needs?\s+to|must|has\s+to|have\s+to)\b[\s\S]{0,220}\b(?:go\s+to|navigate|route|open|show|display|render|switch|send|land|take|work|create|start)\b|\b(?:should|shouldn['’]?t|should\s+not|needs?\s+to|must|has\s+to|have\s+to)\b[\s\S]{0,220}\b(?:go\s+to|navigate|route|open|show|display|render|switch|send|land|take|work|create|start)\b/i.test(trimmed) &&
    (/\b(?:app|chat|component|flow|game|gameplay|ghome|home|hud|ide|layout|level|navigation|page|player|route|screen|scene|ui|user|world|workspace|workplace)\b/i.test(trimmed) || LOCAL_INTERACTIVE_PROJECT_TARGET_PATTERN.test(trimmed));
  const asksForInteractiveProjectBehaviorChange =
    /\b(?:when|if|after|on)\b[\s\S]{0,220}\b(?:should|should\s+not|needs?\s+to|must|has\s+to|have\s+to)\b[\s\S]{0,220}\b(?:pause|resume|lock|unlock|play|stop|open|show|display|render|switch|work|start)\b/i.test(trimmed) &&
    /\b(?:canvas|game|gameplay|hud|inventory|player|scene|world)\b/i.test(trimmed);
  const asksForInspection =
    /\b(?:check|inspect|look(?:\s+at)?|read|review|search|verify)\b[\s\S]{0,180}\b(?:app|code|codebase|files?|project|repo|repository|source|workspace)\b/i.test(trimmed);
  const asksForTerminalExecution =
    /\b(?:run|execute|start|serve|build|compile|test|launch|deploy|publish)\b[\s\S]{0,180}\b(?:app|project|dev server|server|tests?|build|command|terminal|npm|pnpm|yarn|vite|cargo|website|site|hosting|firebase|vercel|netlify)\b/i.test(trimmed) ||
    /\b(?:deploy|publish|go\s+live|push\s+live|make\s+it\s+live)\b[\s\S]{0,180}\b(?:app|project|website|site|hosting|firebase|vercel|netlify)\b/i.test(trimmed) ||
    /\b(?:terminal|dev server|localhost)\b[\s\S]{0,140}\b(?:run|start|read|inspect|check|debug|verify|status)\b/i.test(trimmed);
  const asksForBrowserEvidence =
    /\b(?:open|preview|capture|take|read|inspect|debug|verify|check|look(?:\s+at)?|use)\b[\s\S]{0,180}\b(?:browser|preview|screenshot|console|devtools|localhost|local site|webview|website|visual|ui)\b/i.test(trimmed) ||
    /\b(?:browser|preview|screenshot|console|devtools|localhost|local site|webview|website|visual|ui)\b[\s\S]{0,180}\b(?:open|capture|take|read|inspect|debug|verify|check|fix|use)\b/i.test(trimmed);
  const asksForGitChangeReview = LOCAL_GIT_CHANGE_REVIEW_PATTERN.test(trimmed);
  const referencesLocalTarget =
    LOCAL_WORKSPACE_REFERENCE_PATTERN.test(trimmed) ||
    LOCAL_CODE_ENTITY_PATTERN.test(trimmed) ||
    LOCAL_INTERACTIVE_PROJECT_TARGET_PATTERN.test(trimmed) ||
    asksForInteractiveProjectChange ||
    asksForInteractiveProjectBehaviorChange ||
    /(?:^|\n|`|\s)[\w./\\ -]+\.(?:astro|c|cpp|cs|css|dart|go|html|java|js|jsx|json|kt|kts|md|mdx|php|py|rb|rs|scss|sh|sql|svelte|swift|toml|ts|tsx|txt|vue|xml|ya?ml)\b/i.test(trimmed) ||
    /\b(?:component|css|design|layout|page|screen|theme|ui|visual|website|src[\\/]|hello\s*world|helloworld)\b/i.test(trimmed);

  return asksForGitChangeReview || asksForTerminalExecution || asksForBrowserEvidence || ((asksForEdit || asksForAppBehaviorChange || asksForInteractiveProjectBehaviorChange || asksForInspection || asksToContinueWork || asksForInteractiveProjectChange) && referencesLocalTarget);
}

/** Detects local requests where a read-only answer or pasted replacement code is not enough. */
export function requiresWorkspaceMutationForPrompt(prompt: string, hasWorkspaceRoots: boolean) {
  if (!hasWorkspaceRoots) {
    return false;
  }

  const trimmed = prompt.trim();

  if (!trimmed || trimmed.length > 4_000 || CONVERSATION_ONLY_PROMPT_PATTERN.test(trimmed)) {
    return false;
  }

  if (/\b(?:analysis\s+only|do\s+not\s+(?:change|edit|modify|write)|don't\s+(?:change|edit|modify|write)|no\s+(?:code\s+)?changes?|plan\s+only|read[-\s]?only)\b/i.test(trimmed)) {
    return false;
  }

  if (/\b(?:show|give|provide|write)\s+me\b[\s\S]{0,120}\b(?:example|snippet|template|sample)\b/i.test(trimmed) && !/\b(?:in|inside|to|for)\s+(?:this|the|our|selected)\s+(?:app|codebase|project|repo|repository|workspace)\b/i.test(trimmed)) {
    return false;
  }

  const asksToContinueWork = /\b(?:do\s+(?:it|the\s+job|this)|continue|finish(?:\s+it)?|go\s+ahead|make\s+it\s+happen|apply\s+(?:it|that|the\s+change)|fix\s+(?:it|this|that)|implement\s+(?:it|this|that))\b/i.test(trimmed);
  const asksForInteractiveProjectChange = looksLikeInteractiveProjectChangePrompt(trimmed);
  const asksForMutation =
    /\b(?:add|append|apply|change|create|delete|edit|fix|implement|improve|insert|make\s+(?:it|this|that)?\s*(?:look\s+|feel\s+|more\s+)?(?:better|cleaner|clearer|polished|readable)|modi(?:fy|fy|y)|patch|polish|re\s*design|redesign|refactor|remove|replace|restyle|revamp|style|tweak|update|upgrade|write)\b/i.test(trimmed);
  const asksForAppBehaviorChange =
    /\b(?:when|if|after|on)\b[\s\S]{0,220}\b(?:should|shouldn['â€™]?t|should\s+not|needs?\s+to|must|has\s+to|have\s+to)\b[\s\S]{0,220}\b(?:go\s+to|navigate|route|open|show|display|render|switch|send|land|take|work|create|start)\b|\b(?:should|shouldn['â€™]?t|should\s+not|needs?\s+to|must|has\s+to|have\s+to)\b[\s\S]{0,220}\b(?:go\s+to|navigate|route|open|show|display|render|switch|send|land|take|work|create|start)\b/i.test(trimmed) &&
    (/\b(?:app|chat|component|flow|game|gameplay|home|hud|ide|layout|level|navigation|page|player|route|screen|scene|ui|user|website|world|workspace|workplace)\b/i.test(trimmed) || LOCAL_INTERACTIVE_PROJECT_TARGET_PATTERN.test(trimmed));
  const asksForInteractiveProjectBehaviorChange =
    /\b(?:when|if|after|on)\b[\s\S]{0,220}\b(?:should|should\s+not|needs?\s+to|must|has\s+to|have\s+to)\b[\s\S]{0,220}\b(?:pause|resume|lock|unlock|play|stop|open|show|display|render|switch|work|start)\b/i.test(trimmed) &&
    /\b(?:canvas|game|gameplay|hud|inventory|player|scene|world)\b/i.test(trimmed);
  const referencesLocalTarget =
    LOCAL_WORKSPACE_REFERENCE_PATTERN.test(trimmed) ||
    LOCAL_CODE_ENTITY_PATTERN.test(trimmed) ||
    LOCAL_INTERACTIVE_PROJECT_TARGET_PATTERN.test(trimmed) ||
    asksForInteractiveProjectChange ||
    asksForInteractiveProjectBehaviorChange ||
    /(?:^|\n|`|\s)[\w./\\ -]+\.(?:astro|c|cpp|cs|css|dart|go|html|java|js|jsx|json|kt|kts|md|mdx|php|py|rb|rs|scss|sh|sql|svelte|swift|toml|ts|tsx|txt|vue|xml|ya?ml)\b/i.test(trimmed) ||
    /\b(?:app|component|css|design|layout|page|screen|theme|ui|visual|website|src[\\/]|local-code conversation context|selected workspace)\b/i.test(trimmed);

  return referencesLocalTarget && (asksForMutation || asksForAppBehaviorChange || asksForInteractiveProjectBehaviorChange || asksToContinueWork || asksForInteractiveProjectChange);
}

export function createFreshLocalToolEvidenceInstruction(prompt: string, unsupportedAnswer: string, options: { blockedReasons?: string[]; canUseProviderTools?: boolean } = {}) {
  const excerpt = unsupportedAnswer.replace(/\s+/g, " ").trim().slice(0, 700);
  const canUseProviderTools = options.canUseProviderTools !== false;

  return [
    "FRESH LOCAL WORKSPACE EVIDENCE REQUIRED",
    `Original user request: ${prompt}`,
    "The previous visible response answered from chat context or promised inspection without a real current workspace tool-call record for this request.",
    canUseProviderTools
      ? "Use the real provider tool-call channel now before writing the final answer. For Git/change-review requests, call git_status and git_diff when attached. Otherwise search and read the selected workspace with files_search, files_read_many, files_tree_summary, or files_read as appropriate."
      : "No provider workspace tools are attached for this retry. Do not claim a fresh workspace read, edit, Git command, terminal command, browser action, or web search ran; state the tool-availability blocker plainly.",
    !canUseProviderTools && options.blockedReasons?.length ? `Blocked gates: ${options.blockedReasons.slice(0, 4).join(" | ")}` : "",
    "Do not answer from memory, prior chat context, project summaries, or visible tool-call syntax alone. After at least one real current workspace tool succeeds, answer from that evidence.",
    excerpt ? `Rejected unsupported answer excerpt: ${excerpt}` : "",
  ].filter(Boolean).join("\n\n");
}

export interface SimpleLocalTaskCompletion {
  buildCommand?: string;
  installCommand?: string;
  previewUrl?: string;
  projectPath?: string;
  runCommand?: string;
}

export function isSimpleLocalScaffoldRequest(_prompt: string) {
  return false;
}

export function detectSimpleLocalTaskCompletion(prompt: string, toolCalls: ChatToolCall[] = []): SimpleLocalTaskCompletion | null {
  if (!isSimpleLocalScaffoldRequest(prompt)) {
    return null;
  }

  const completedCalls = toolCalls.filter((toolCall) => toolCall.status === "complete");
  const scaffoldCall = completedCalls.find((toolCall) => /(?:create|scaffold).*(?:vite|react)|vite.*project/i.test(toolCall.label) || /Vite React project scaffolded/i.test(toolCallText(toolCall)));
  const installCall = completedCalls.find((toolCall) => isSuccessfulTerminalToolCall(toolCall) && isPackageInstallCommand(toolCall));
  const buildCall = completedCalls.find((toolCall) => isSuccessfulTerminalToolCall(toolCall) && isViteBuildCommand(toolCall));
  const runCall = completedCalls.find((toolCall) => isDevServerStartedToolCall(toolCall));

  if (!scaffoldCall || !installCall || !buildCall || !runCall) {
    return null;
  }

  return {
    buildCommand: buildCall.terminal?.command,
    installCommand: installCall.terminal?.command,
    previewUrl: findLocalPreviewUrl(toolCallText(runCall)) ?? findLocalPreviewUrl(completedCalls.map(toolCallText).join("\n")),
    projectPath: findProjectPath(toolCallText(scaffoldCall)) ?? buildCall.terminal?.workingDirectory ?? installCall.terminal?.workingDirectory,
    runCommand: runCall.terminal?.command,
  };
}

export function isEmptySelectedScaffoldProbe(prompt: string, contextMessage: string, toolCalls: ChatToolCall[] = []) {
  if (!isSimpleLocalScaffoldRequest(prompt)) {
    return false;
  }

  if (toolCalls.some((toolCall) => /create.*vite|vite.*project/i.test(toolCall.label) && toolCall.status === "complete")) {
    return false;
  }

  const context = contextMessage.toLowerCase();
  const listedEmptyRoot =
    /\btool\s+\d+\s+\[ok\]:\s*list_directory\b[\s\S]{0,700}\bentries returned:\s*0\b/i.test(contextMessage) ||
    toolCalls.some((toolCall) => toolCall.status === "complete" && /list directory/i.test(toolCall.label) && /\bentries returned:\s*0\b/i.test(toolCall.output ?? ""));
  const probedMissingStarter =
    /\b(?:app\.jsx|app\.tsx|main\.jsx|main\.tsx|package\.json|vite\.config\.[jt]s|index\.html)\b/i.test(contextMessage) &&
    /\b(?:file not found|outside the workspace|entries returned:\s*0|skipped)\b/i.test(contextMessage);
  const parentProbeBlocked = context.includes("outside the workspace") && context.includes("workspace roots:");

  return listedEmptyRoot && (probedMissingStarter || parentProbeBlocked);
}

export function createSimpleLocalTaskCompletionAnswer(completion: SimpleLocalTaskCompletion) {
  return [
    "Done. The Vite React starter app was scaffolded, dependencies installed, the production build passed, and the dev server is running.",
    completion.projectPath ? `Project: ${completion.projectPath}` : "",
    completion.previewUrl ? `Preview: ${completion.previewUrl}` : "",
  ].filter(Boolean).join("\n\n");
}

function toolCallText(toolCall: ChatToolCall) {
  return [
    toolCall.label,
    toolCall.detail,
    toolCall.input,
    toolCall.output,
    toolCall.terminal?.command,
    toolCall.terminal?.workingDirectory,
  ].filter(Boolean).join("\n");
}

function isSuccessfulTerminalToolCall(toolCall: ChatToolCall) {
  const text = toolCallText(toolCall);

  return Boolean(toolCall.terminal) && (toolCall.terminal?.exitCode === 0 || /\bExit code:\s*0\b/i.test(text)) && !/\b(?:failed|error|errored)\b/i.test(text);
}

function isPackageInstallCommand(toolCall: ChatToolCall) {
  const command = `${toolCall.terminal?.command ?? ""}\n${toolCallText(toolCall)}`;

  return /\b(?:npm(?:\.cmd)?\s+(?:install|i)|pnpm\s+install|yarn\s+(?:install|add)|bun\s+install)\b/i.test(command);
}

function isViteBuildCommand(toolCall: ChatToolCall) {
  const command = `${toolCall.terminal?.command ?? ""}\n${toolCallText(toolCall)}`;

  return /\b(?:npm(?:\.cmd)?\s+run\s+build|pnpm\s+(?:run\s+)?build|yarn\s+build|bun\s+run\s+build|vite\s+build)\b/i.test(command);
}

function isDevServerStartedToolCall(toolCall: ChatToolCall) {
  const text = toolCallText(toolCall);
  const command = `${toolCall.terminal?.command ?? ""}\n${text}`;
  const isDevCommand = /\b(?:npm(?:\.cmd)?\s+run\s+(?:dev|start|serve)|pnpm\s+(?:run\s+)?(?:dev|start|serve)|yarn\s+(?:dev|start|serve)|bun\s+run\s+(?:dev|start|serve)|npx\s+vite|vite)\b/i.test(command);
  const hasReadySignal =
    Boolean(toolCall.terminal?.sessionId) ||
    /\b(?:Background session:\s*running|Detected local dev server|Browser preview URL:|Local:\s*https?:\/\/|https?:\/\/(?:localhost|127\.0\.0\.1):\d+)/i.test(text);

  return toolCall.status === "complete" && Boolean(toolCall.terminal) && isDevCommand && hasReadySignal;
}

function findLocalPreviewUrl(text: string) {
  return text.match(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/[^\s"'<>)]*)?/i)?.[0];
}

function findProjectPath(text: string) {
  return text.match(/^Project path:\s*(.+)$/im)?.[1]?.trim();
}

/** Creates a recovery turn that forces the model to answer from completed tool evidence. */
export function createLocalToolFinalInstruction(prompt: string) {
  return [
    "FINAL ANSWER REQUIRED FROM LOCAL TOOL RESULTS",
    `Original user request: ${prompt}`,
    "Use the conversation, attached workspace context, and web context already provided as the evidence for your answer.",
    "The original user request is the success condition. Address it directly from the available evidence; do not substitute a recap, plan, or adjacent task.",
    "Do not reply with a promise to read, inspect, check, analyze, or explore more files.",
    "If more evidence is truly required, ask for it. Otherwise write the final answer now.",
    "Claim completed work only when current tool results prove it. If something is unverified or blocked, say that plainly.",
    FINAL_RESPONSE_COMPLETION_GUIDANCE,
    "Do not describe the tool loop, provider behavior, saved evidence, continuation state, recovery state, or why an answer was missing.",
    "Do not use headings such as Answer From Completed Tool Results, Tool Run Needs Continuation, Original Request, What Ran, or Evidence.",
    "Format the visible answer as valid GitHub-flavored Markdown prose with headings, bullets, and links when helpful. Start with the direct answer. Do not wrap the whole answer in a fenced code block. Use fenced code blocks only for actual code, diffs, terminal output, or logs, and always close every fence. If you use a pipe table, include a complete GFM delimiter row for every column, or use bullets instead.",
    "Cite web sources with Markdown links when the tool results include URLs.",
    "Do not output hidden tool protocol text as prose. Do not output JSON envelopes, provider tool_calls, or a whole-response code fence unless the original user explicitly requested JSON or code-only output.",
  ].join("\n\n");
}

/** Creates a final-answer instruction when a run reaches its configured tool budget. */
export function createLocalToolBudgetFinalInstruction(prompt: string, detail: string) {
  return [
    "FINAL ANSWER REQUIRED FROM CURRENT TOOL RESULTS",
    `Original user request: ${prompt}`,
    detail,
    "Use the evidence already provided and write the best final answer now.",
    "The original user request is the success condition. Address it directly and do not substitute a plan, recap, or adjacent task.",
    "Start with the answer to the user's request. Do not explain that tools were completed, that a provider failed, that saved evidence exists, or that the response needs continuation.",
    "Claim completed work only when current tool results prove it. If something is unverified or blocked, say that plainly.",
    FINAL_RESPONSE_COMPLETION_GUIDANCE,
    "Do not use headings such as Answer From Completed Tool Results, Tool Run Needs Continuation, Original Request, What Ran, or Evidence.",
    "Format the visible answer as valid GitHub-flavored Markdown prose with headings, bullets, and links when helpful. Do not wrap the whole answer in a fenced code block. Use fenced code blocks only for actual code, diffs, terminal output, or logs, and always close every fence. If you use a pipe table, include a complete GFM delimiter row for every column, or use bullets instead.",
    "Do not emit hidden tool protocol text, JSON envelopes, provider tool_calls, or a whole-response code fence unless the original user explicitly requested JSON or code-only output. Do not promise to keep inspecting unless the next step is impossible without user input.",
  ].join("\n\n");
}

/** Creates a final-answer retry when the model exposed app recovery text. */
export function createFinalAnswerRecoveryInstruction(prompt: string, detail: string) {
  return [
    "FINAL ANSWER REQUIRED",
    `Original user request: ${prompt}`,
    detail,
    "Use the conversation context, web context, and local workspace context already provided above.",
    "Write only the user-facing answer now.",
    "The original user request is the success condition. Address it directly, and claim completed work only when current evidence proves it.",
    FINAL_RESPONSE_COMPLETION_GUIDANCE,
    "Do not mention background work, Continue response, provider behavior, saved evidence, recovery, retry attempts, tool loops, or missing final write-ups.",
    "Do not paste raw TOOL blocks or adaptation recommendations.",
    "Do not use headings such as Answer From Completed Tool Results, Tool Run Needs Continuation, Original Request, What Ran, or Evidence.",
    "Use valid GitHub-flavored Markdown. Keep lists, links, tables, and fenced code blocks structurally complete; always close every fence.",
    "Do not output JSON envelopes, provider tool_calls, or a whole-response code fence unless the original user explicitly requested JSON or code-only output.",
    "If the available context is insufficient, say exactly what is missing in one short sentence, then give the best answer possible from the available evidence.",
  ].join("\n\n");
}

/** Creates a continuation instruction after malformed tool-call markup. */
export function createMalformedToolCallRecoveryInstruction(prompt: string) {
  return [
    "CONTINUE AFTER UNREADABLE TOOL REQUEST",
    `Original user request: ${prompt}`,
    "The previous assistant response looked like text-only tool syntax rather than an app-exposed tool call.",
    "Continue the same response now with a normal final answer from the existing evidence.",
    "Do not leave the visible answer blank.",
  ].join("\n\n");
}

/** Preserves completed tool records and visible text when the user steers an in-flight answer. */
export function createInterruptedResponseContinuationInstruction(prompt: string, message: ChatMessage) {
  const toolCallCount = message.toolCalls?.length ?? 0;
  const visibleContent = message.content.trim();

  return [
    "CONTINUE INTERRUPTED RESPONSE",
    `Original user request: ${prompt}`,
    "Continue from the exact saved state above instead of restarting the task.",
    visibleContent ? "The previous partial visible response is included as assistant context. Do not repeat it unless needed for coherence." : "The previous response was interrupted before visible answer text was saved.",
    toolCallCount > 0 ? `Saved tool results available: ${toolCallCount}. Treat them as already completed evidence.` : "",
    message.webSearch?.enabled ? "Saved web-search state is included above. If it failed, say that briefly and continue with non-current claims only when appropriate." : "",
    FINAL_RESPONSE_COMPLETION_GUIDANCE,
    "If the next step requires unavailable local tools, say that plainly. Otherwise finish the answer now.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Returns true when a saved assistant message should be continued instead of restarted. */
export function isInterruptedAssistantMessage(message: ChatMessage) {
  if (message.role !== "assistant" || message.isStreaming) {
    return false;
  }

  if (isToolResultFallbackAnswer(message.content)) {
    return true;
  }

  if (looksLikeOnlyToolPrelude(message.content)) {
    return true;
  }

  if (looksLikeToolProtocolNarration(message.content)) {
    return true;
  }

  if (message.status === "error" || message.agentRunStatus === "failed" || message.agentRunStatus === "running" || message.agentRunStatus === "queued") {
    return true;
  }

  return message.content.includes("I reached the agent tool budget for this run");
}

/** Detects the "tools completed, provider gave no visible answer" case. */
export function shouldSynthesizeEmptyFinalFromToolResults(content: string, toolCalls: ChatToolCall[] = []) {
  return !content.trim() && toolCalls.some((toolCall) => {
    if (toolCall.status !== "complete" && toolCall.status !== "error" && toolCall.status !== "skipped") {
      return false;
    }

    if (toolCall.resultPolicy) {
      return shouldToolCallForceSynthesis(toolCall);
    }

    return true;
  });
}

/** Stamps stable display IDs onto tool records generated during one execution pass. */
export function stampLocalToolCallIds(toolCalls: ChatToolCall[], passIndex: number) {
  return toolCalls.map((toolCall, index) => ({
    ...toolCall,
    id: `local-tool-${passIndex + 1}-${toolCall.id || index + 1}`,
  }));
}

/** Creates optimistic tool-call records from tool markup before execution completes. */
export function createActiveLocalToolCalls(content: string, passIndex: number, executionPolicy?: LocalComputerToolExecutionPolicy): ChatToolCall[] {
  if (!hasLocalComputerToolCalls(content, executionPolicy)) {
    return [];
  }

  const previews = createLocalComputerToolCallPreviews(content, executionPolicy);

  if (previews.length > 0) {
    return previews.map((toolCall, index) => ({
      ...toolCall,
      id: `local-tool-${passIndex + 1}-local-tool-${index + 1}`,
    }));
  }

  return [
    {
      detail: "Running requested agent tools",
      id: `local-tool-${passIndex + 1}-active`,
      label: "Agent tools",
      status: "active",
    },
  ];
}

/** Tool requests must come from visible provider content, never hidden provider reasoning. */
export function createAssistantToolRequestContent(content: string, reasoning?: string, executionPolicy?: LocalComputerToolExecutionPolicy) {
  void reasoning;
  return createLocalComputerToolRequestContent(content, undefined, executionPolicy);
}

/** Merges source lists while preserving first-seen order and avoiding duplicate URLs. */
export function mergeChatSources(existingSources: ChatSource[] | undefined, nextSources: ChatSource[]) {
  const seenUrls = new Set<string>();
  const merged: ChatSource[] = [];

  for (const source of [...(existingSources ?? []), ...nextSources]) {
    if (seenUrls.has(source.url)) {
      continue;
    }

    seenUrls.add(source.url);
    merged.push(source);
  }

  return merged;
}

/** Replaces any stale web-search progress row with the current search state. */
export function withWebSearchProgress(webSearch: ChatWebSearch | undefined, progress: ChatProgressItem[] | undefined) {
  const progressWithoutWeb = (progress ?? []).filter((item) => item.id !== "web-search");
  const webProgress = createWebSearchProgress(webSearch);
  const nextProgress = webProgress ? [webProgress, ...progressWithoutWeb] : progressWithoutWeb;

  return nextProgress.length > 0 ? nextProgress : undefined;
}

/** Replaces any stale local-tool progress row with the current local-tool state. */
export function withLocalComputerProgress(localProgress: ChatProgressItem | undefined, progress: ChatProgressItem[] | undefined) {
  const progressWithoutLocal = (progress ?? []).filter((item) => item.id !== "local-computer-tools" && item.id !== "local-tools-disabled");
  const nextProgress = localProgress ? [...progressWithoutLocal, localProgress] : progressWithoutLocal;

  return nextProgress.length > 0 ? nextProgress : undefined;
}

/** Converts a persisted web-search state object into a chat progress row. */
export function createWebSearchProgress(webSearch: ChatWebSearch | undefined): ChatProgressItem | null {
  if (!webSearch?.enabled) {
    return null;
  }

  const providerLabel = formatWebSearchProviderLabel(webSearch.provider);
  const resultProviderLabel = webSearch.resultProvider ? formatWebSearchProviderLabel(webSearch.resultProvider) : providerLabel;
  const isError = webSearch.status === "error";
  const isComplete = webSearch.status === "complete" || isError;
  const sourceLabel = webSearch.resultCount === 1 ? "1 source" : `${webSearch.resultCount ?? 0} sources`;
  const usedFallback = Boolean(webSearch.resultProvider);
  const detail = isError
    ? "Search failed; continuing with a note"
    : isComplete
      ? (usedFallback ? `${providerLabel} failed; ${sourceLabel} from ${resultProviderLabel}` : sourceLabel)
      : "Searching the web";

  return {
    detail,
    id: "web-search",
    label: usedFallback ? `Search ${resultProviderLabel} fallback` : `Search ${providerLabel}`,
    status: isComplete ? "complete" : "active",
  };
}

/** Returns the latest non-empty user prompt for recovery, tools, and web-search context. */
export function getLatestUserPrompt(messages: ChatMessage[]) {
  return [...messages].reverse().find((message) => message.role === "user" && message.content.trim())?.content.trim() ?? "";
}
