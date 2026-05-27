import { sanitizeLocalToolCallsForDisplay } from "../localWorkspace/localToolRuntimeDisabled";
import { mergeVisibleReasoningSummaries } from "../lib/reasoningSummary";
import { FINAL_RESPONSE_STYLE_GUIDANCE } from "../prompts/agent/finalResponseStyle";
import type { ChatMessage, ChatPlanningInputAnswer, ChatPlanningInputRequest, ChatPlanningQuestion, ChatPlanningQuestionOption, ChatProgressItem } from "../types/chat";
import type { ProviderSettings } from "../types/settings";
import { streamProviderMessage, sendProviderMessage, type ProviderUsage } from "./modelProviderClient";

const MAX_PLANNING_QUESTIONS = 3;
const MAX_PLANNING_OPTIONS = 3;
const GENERIC_CODEBASE_INVENTORY_QUESTION_PATTERNS = [
  /\b(?:what|describe|tell me).{0,48}\b(?:project|app|site).{0,32}\b(?:main purpose|core functionality|purpose|do|does)\b/i,
  /\b(?:main purpose|core functionality).{0,64}\b(?:project|app|site)\b/i,
  /\b(?:what|which).{0,48}\b(?:ui components?|pages?|screens?|views?).{0,48}\b(?:currently exist|exist|already have|are present)\b/i,
  /\b(?:what|which).{0,48}\b(?:key features?|user flows?|flows?).{0,48}\b(?:planned|intended|needed)\b/i,
  /\b(?:list|describe).{0,48}\b(?:existing|current).{0,48}\b(?:components?|pages?|screens?|views?|features?)\b/i,
];

/**
 * Floor for the plan-drafting call's output budget. The drafter has no tool
 * access (see `disablePlanningExecutionTools` below), so the model must fit the
 * entire plan into one response. Tying that budget to the chat-mode
 * `settings.maxTokens` (typically 2-4K) produced the "3K-token plan on a big
 * codebase" bug. Plan output gets its own headroom now.
 */
export const PLAN_DRAFT_MAX_TOKENS = 16000;

export type PlanningPhase = "input" | "researching" | "drafting" | "complete";

interface PlanningRunOptions {
  messages: ChatMessage[];
  onUpdate: (snapshot: PlanningSnapshot) => void;
  onProviderRequest?: (request: PlanningProviderRequest) => void;
  onProviderUsage?: (request: PlanningProviderRequest, usage: ProviderUsage | undefined) => void;
  /** Plain-text observations gathered from host-attached workspace or web context. */
  researchFindings?: string;
  signal?: AbortSignal;
  settings: ProviderSettings;
}

interface PlanningRequestOptions {
  onProviderRequest?: (request: PlanningProviderRequest) => void;
  onProviderUsage?: (request: PlanningProviderRequest, usage: ProviderUsage | undefined) => void;
  signal?: AbortSignal;
}

export interface PlanningSnapshot {
  content?: string;
  progress: ChatProgressItem[];
  reasoning?: string;
}

export interface PlanningRunResult extends PlanningSnapshot {
  content: string;
  providerRequest?: PlanningProviderRequest;
  usage?: ProviderUsage;
}

export interface PlanningProviderRequest {
  messages: ChatMessage[];
  settings: ProviderSettings;
  stream: boolean;
}

interface PlanningInputDecisionPayload {
  detail?: unknown;
  needsInput?: unknown;
  questions?: unknown;
  title?: unknown;
}

interface PlanningQuestionPayload {
  id?: unknown;
  options?: unknown;
  placeholder?: unknown;
  question?: unknown;
  required?: unknown;
}

interface PlanningQuestionOptionPayload {
  description?: unknown;
  id?: unknown;
  label?: unknown;
}

export async function createPlanningInputRequest(
  settings: ProviderSettings,
  messages: ChatMessage[],
  options: PlanningRequestOptions = {},
): Promise<ChatPlanningInputRequest | null> {
  const providerRequest = {
    messages: createPlanningInputMessages(messages),
    settings: createPlanningInputSettings(settings),
    stream: false,
  } satisfies PlanningProviderRequest;

  options.onProviderRequest?.(providerRequest);

  const response = await sendProviderMessage(providerRequest.settings, providerRequest.messages, {
    signal: options.signal,
  });
  options.onProviderUsage?.(providerRequest, response.usage);
  const payload = parsePlanningInputDecision(response.content);

  if (!payload?.needsInput || !Array.isArray(payload.questions)) {
    return null;
  }

  const questions = filterPlanningInputQuestions(
    payload.questions.flatMap((question, index) => normalizePlanningQuestion(question, index)),
  ).slice(0, MAX_PLANNING_QUESTIONS);

  if (questions.length === 0) {
    return null;
  }

  return {
    detail: normalizeShortText(payload.detail),
    id: createPlanningInputRequestId(),
    questions,
    requestedAt: new Date().toISOString(),
    title: normalizeShortText(payload.title) || "A few choices would help",
  };
}

export function filterPlanningInputQuestions(questions: ChatPlanningQuestion[]): ChatPlanningQuestion[] {
  return questions.filter((question) => !isGenericCodebaseInventoryQuestion(question.question));
}

export async function runPlanningMode({ messages, onProviderRequest, onProviderUsage, onUpdate, researchFindings, signal, settings }: PlanningRunOptions): Promise<PlanningRunResult> {
  const trimmedFindings = researchFindings?.trim() ?? "";
  const researchMessages = trimmedFindings ? [createResearchFindingsMessage(trimmedFindings)] : [];
  const planningContextMessages = [...messages, ...researchMessages];
  const providerRequest = {
    messages: createFinalAnswerMessages(planningContextMessages, trimmedFindings),
    settings: createFinalAnswerSettings(settings),
    stream: true,
  } satisfies PlanningProviderRequest;

  onUpdate({
    progress: createPlanningProgress("drafting"),
  });
  onProviderRequest?.(providerRequest);

  let finalContent = "";
  let finalReasoning = "";

  const finalResponse = await streamProviderMessage(
    providerRequest.settings,
    providerRequest.messages,
    (snapshot) => {
      finalContent = snapshot.content;
      finalReasoning = mergeVisibleReasoningSummaries(finalReasoning, snapshot.reasoningSummary);
      onUpdate({
        content: cleanFinalAnswerContent(finalContent),
        progress: createPlanningProgress("drafting"),
        reasoning: finalReasoning || undefined,
      });
    },
    {
      signal,
    },
  );
  onProviderUsage?.(providerRequest, finalResponse.usage);
  const content = cleanFinalAnswerContent(finalResponse.content || finalContent) || "I could not produce a finished plan from the model response.";

  return {
    content,
    providerRequest,
    progress: createPlanningProgress("complete"),
    reasoning: mergeVisibleReasoningSummaries(finalReasoning, finalResponse.reasoningSummary) || undefined,
    usage: finalResponse.usage,
  };
}

/**
 * Live counters from the research phase. Optional — when present, the
 * `Research codebase` progress item shows them so the user can see plan mode
 * actually doing work rather than spinning. Derived from the tool-call ledger
 * by `summarizeResearchEvidence` in `planResearchClient.ts`.
 */
export interface PlanningProgressEvidence {
  filesRead: number;
  searches: number;
}

export function createPlanningProgress(phase: PlanningPhase, evidence?: PlanningProgressEvidence): ChatProgressItem[] {
  return [
    {
      detail: "Request captured",
      id: "plan-context",
      label: "Understand request",
      status: phase === "input" ? "active" : "complete",
    },
    {
      detail: phase === "input" ? "Checking whether a decision would change the plan" : "Scope is clear",
      id: "plan-input",
      label: "Clarify scope",
      status: phase === "input" ? "active" : "complete",
    },
    {
      detail: createResearchProgressDetail(phase, evidence),
      id: "plan-research",
      label: "Research context",
      status: phase === "researching" ? "active" : phase === "drafting" || phase === "complete" ? "complete" : "pending",
    },
    {
      detail:
        phase === "drafting"
          ? "Organizing findings into a reviewable plan"
          : phase === "complete"
            ? "Plan ready"
            : "Waiting",
      id: "plan-write",
      label: "Think through plan",
      status: phase === "drafting" ? "active" : phase === "complete" ? "complete" : "pending",
    },
  ];
}

function createResearchProgressDetail(phase: PlanningPhase, evidence?: PlanningProgressEvidence): string {
  if (evidence && (evidence.filesRead > 0 || evidence.searches > 0)) {
    const parts: string[] = [];
    if (evidence.filesRead > 0) parts.push(`${evidence.filesRead} file${evidence.filesRead === 1 ? "" : "s"} read`);
    if (evidence.searches > 0) parts.push(`${evidence.searches} search${evidence.searches === 1 ? "" : "es"}`);
    return phase === "researching" ? `Inspecting code (${parts.join(", ")})` : `Inspected ${parts.join(", ")}`;
  }

  if (phase === "researching") return "Looking through the workspace";
  if (phase === "drafting" || phase === "complete") return "Context gathered";
  return "Waiting";
}

function disablePlanningExecutionTools(tools: ProviderSettings["tools"]): ProviderSettings["tools"] {
  return {
    ...tools,
    browserPreview: false,
    codeEdit: false,
    codeGeneration: false,
    codeView: false,
    desktopComputer: false,
    fileBrowser: false,
    fileCreation: false,
    fileSafety: false,
    fileSearch: false,
    imageGeneration: false,
    pdfTools: false,
    reactNativeTools: false,
    sourceControl: false,
    sqlTools: false,
    terminal: false,
    testingTools: false,
    typescriptTools: false,
    webSearch: false,
  };
}

function createPlanningInputSettings(settings: ProviderSettings): ProviderSettings {
  return {
    ...settings,
    maxTokens: 850,
    systemPrompt: createPlanningInputSystemPrompt(settings.systemPrompt),
    temperature: 0.1,
    thinking: {
      ...settings.thinking,
      enabled: settings.thinking.enabled,
    },
    tools: disablePlanningExecutionTools(settings.tools),
  };
}

function createFinalAnswerSettings(settings: ProviderSettings): ProviderSettings {
  return {
    ...settings,
    // Plan output gets its own token budget so a long, well-structured plan
    // doesn't get truncated by the user's chat-mode `maxTokens`. We pick the
    // *larger* of the user's setting and the plan-mode floor so users who
    // already configured a high ceiling keep it.
    maxTokens: Math.max(settings.maxTokens, PLAN_DRAFT_MAX_TOKENS),
    systemPrompt: createFinalAnswerSystemPrompt(settings.systemPrompt),
    temperature: Math.min(settings.temperature, 0.25),
    thinking: {
      ...settings.thinking,
      enabled: settings.thinking.enabled,
    },
    tools: disablePlanningExecutionTools(settings.tools),
  };
}

function createPlanningInputSystemPrompt(basePrompt: string) {
  return [
    basePrompt,
    "Plan mode is starting. Decide whether user input is needed before planning.",
    "Ask questions only when the answer would materially change scope, implementation order, target platform, constraints, or risk posture.",
    "Do not ask for routine preferences that can be handled by a sensible default.",
    "For local codebase/workspace requests, do not ask the user to describe the project's purpose, current UI components/pages, or planned flows. Those are discoverable from workspace context or the research phase.",
    "Generic inventory questions are invalid. If that is all you would ask, return no input and let codebase research continue.",
    "If previous clarification answers are present, do not repeat them. Ask a follow-up only if a new missing decision would materially change the plan.",
    "Return JSON only. No Markdown, no prose.",
    'Schema: {"needsInput": boolean, "title": string, "detail": string, "questions": [{"id": string, "question": string, "placeholder": string, "required": boolean, "options": [{"id": string, "label": string, "description": string}]}]}',
    "Use at most 3 questions. Each question may have 2 or 3 short options when choices are useful.",
    "If no input is needed, return exactly {\"needsInput\":false,\"questions\":[]}.",
  ].join("\n\n");
}

function createFinalAnswerSystemPrompt(basePrompt: string) {
  return [
    basePrompt,
    "Plan mode is active. You are the DRAFTER. The research phase that ran before you produced a tool-call ledger and a findings digest; build the plan from those.",
    "Before writing the visible Markdown, think through the user's goal, constraints, evidence, ordering, risks, and verification. Do not expose hidden chain-of-thought; only surface the resulting plan and concise rationale.",
    "TOOL CALLS ARE DISABLED for this turn. Do NOT emit native tool calls, strict tool envelopes, or raw protocol JSON. Any tool-call markup is malformed.",
    "Reference only files, symbols, functions, snippets, and sources that appear in the research evidence. Do not invent files or functions that were not provided.",
    "Length: write enough plan for the user to act, but keep it scannable. For a bug fix in one file, keep it short. For a multi-file refactor, name each relevant file and the important change, but consolidate repetitive details. Go exhaustive only when the user explicitly asks for a full report or complete detail.",
    FINAL_RESPONSE_STYLE_GUIDANCE,
    "If the user is asking for a bug fix, name each bug, the file and approximate line, and the exact change. If the user is asking for a feature, name the files to create or edit and the structure.",
    "Format workspace/code plans as Markdown with these sections, in order:",
    "## Goal\nOne or two sentences naming the outcome.\n## Files to change\nA bullet list of specific paths from research findings with a short reason each. Cite line numbers when known.\n## Step-by-step plan\nNumbered list of concrete implementation steps in the safest order. Each step names the file and the change. Group related steps under sub-headings if the plan is long.\n## Risks and edge cases\nBullet list. Be specific about which risk applies to which file/step.\n## Verification\nHow to confirm it works (tests to run, manual checks, commands).\n## Suggested PR breakdown\nOnly include this section if the plan spans more than one logical chunk. Otherwise omit.",
    "For general research or non-code requests with no workspace files, do not write a fake `Files to change: None` section. Use `## Sources to gather` or `## Information to verify` in that slot, then keep the same Step-by-step plan, Risks and edge cases, and Verification sections.",
    "Do not wrap the plan in a fenced code block. The headings and lists must be rendered as visible Markdown, not shown as literal text inside a code fence.",
    "Be concrete. No generic advice like 'review the codebase' or 'investigate further' — the research is already done. If the evidence doesn't cover something, name it as an open question in Risks rather than guessing.",
    "If web sources were provided, use Markdown links for claims that rely on them.",
  ].join("\n\n");
}

function createPlanningInputMessages(messages: ChatMessage[]): ChatMessage[] {
  return [
    ...messages,
    createSyntheticMessage(
      "user",
      [
        "Before planning, decide whether to ask me for clarifying input.",
        "If needed, ask focused questions that will influence the plan.",
        "Do not ask broad project-inventory questions such as what the app does, which pages/components exist, or what user flows are planned; the codebase research phase must inspect that.",
        "If not needed, continue without asking.",
      ].join("\n"),
    ),
  ];
}

function createFinalAnswerMessages(messages: ChatMessage[], researchFindings: string): ChatMessage[] {
  return [
    ...messages,
    createSyntheticMessage(
      "user",
      [
        "Write a complete but concise plan now in a single Markdown response.",
        researchFindings
          ? "Use the RESEARCH FINDINGS above as the attached context for the plan."
          : "No host-provided research findings were available. Build the best plan you can from the conversation and workspace context already in the messages.",
        "For workspace/code tasks, use: ## Goal, ## Files to change, ## Step-by-step plan, ## Risks and edge cases, ## Verification.",
        "For general research or non-code tasks with no files to change, replace ## Files to change with ## Sources to gather or ## Information to verify.",
      ].join("\n\n"),
    ),
  ];
}

export function createPlanningAnswersMessage(inputRequest: ChatPlanningInputRequest, answers: ChatPlanningInputAnswer[]): ChatMessage {
  const answerLines = inputRequest.questions.map((question) => {
    const answer = answers.find((item) => item.questionId === question.id);
    const value = answer?.value.trim() || "No answer provided.";

    return `- ${question.question}\n  Answer: ${value}`;
  });

  return createSyntheticMessage(
    "user",
    [
      "User answered planning clarification questions. Use these answers as hard planning context.",
      inputRequest.detail ? `Question context: ${inputRequest.detail}` : "",
      "Answers:",
      answerLines.join("\n"),
    ]
      .filter(Boolean)
      .join("\n\n"),
  );
}

function createSyntheticMessage(role: ChatMessage["role"], content: string): ChatMessage {
  return {
    content,
    createdAt: new Date().toISOString(),
    id: `synthetic-${role}-${Date.now()}-${Math.round(Math.random() * 100000)}`,
    role,
  };
}

function createResearchFindingsMessage(findings: string): ChatMessage {
  return createSyntheticMessage(
    "user",
    [
      "RESEARCH FINDINGS",
      "Host-provided context is attached below. Build the plan from these specific paths, symbols, snippets, and sources. Do not request local tool calls; the planning turn cannot execute them.",
      findings,
    ].join("\n\n"),
  );
}

function parsePlanningInputDecision(content: string): PlanningInputDecisionPayload | null {
  const jsonText = extractJsonObject(content);

  if (!jsonText) {
    return null;
  }

  try {
    const payload = JSON.parse(jsonText) as PlanningInputDecisionPayload;
    return typeof payload === "object" && payload ? payload : null;
  } catch {
    return null;
  }
}

function extractJsonObject(content: string) {
  const strippedContent = content.replace(/```(?:json)?/gi, "```").replace(/```/g, "").trim();
  const startIndex = strippedContent.indexOf("{");
  const endIndex = strippedContent.lastIndexOf("}");

  if (startIndex < 0 || endIndex <= startIndex) {
    return "";
  }

  return strippedContent.slice(startIndex, endIndex + 1);
}

function normalizePlanningQuestion(value: unknown, index: number): ChatPlanningQuestion[] {
  if (typeof value !== "object" || !value) {
    return [];
  }

  const payload = value as PlanningQuestionPayload;
  const question = normalizeLongText(payload.question);

  if (!question) {
    return [];
  }

  return [
    {
      id: normalizeIdentifier(payload.id, `question-${index + 1}`),
      options: normalizePlanningOptions(payload.options),
      placeholder: normalizeShortText(payload.placeholder) || "Answer this so the plan can adapt.",
      question,
      required: typeof payload.required === "boolean" ? payload.required : true,
    },
  ];
}

function isGenericCodebaseInventoryQuestion(question: string) {
  const normalizedQuestion = question.replace(/\s+/g, " ").trim();

  return GENERIC_CODEBASE_INVENTORY_QUESTION_PATTERNS.some((pattern) => pattern.test(normalizedQuestion));
}

function normalizePlanningOptions(value: unknown): ChatPlanningQuestionOption[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const options = value.flatMap((option, index) => {
    if (typeof option !== "object" || !option) {
      return [];
    }

    const payload = option as PlanningQuestionOptionPayload;
    const label = normalizeShortText(payload.label);

    if (!label) {
      return [];
    }

    return [
      {
        description: normalizeShortText(payload.description),
        id: normalizeIdentifier(payload.id, `option-${index + 1}`),
        label,
      },
    ];
  });

  return options.length > 0 ? options.slice(0, MAX_PLANNING_OPTIONS) : undefined;
}

function normalizeIdentifier(value: unknown, fallback: string) {
  if (typeof value !== "string" || !value.trim()) {
    return fallback;
  }

  const identifier = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);

  return identifier || fallback;
}

function normalizeShortText(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.replace(/\s+/g, " ").trim();

  return normalized ? normalized.slice(0, 140) : undefined;
}

function normalizeLongText(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim().slice(0, 260);
}

function createPlanningInputRequestId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `planning-input-${crypto.randomUUID()}`;
  }

  return `planning-input-${Date.now()}-${Math.round(Math.random() * 100000)}`;
}

function cleanFinalAnswerContent(content: string) {
  return sanitizeLocalToolCallsForDisplay(content).trim();
}
