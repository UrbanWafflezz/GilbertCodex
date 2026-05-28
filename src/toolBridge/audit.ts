import { createProviderVisibleToolSchema } from "./adapters/sharedUtils";
import { createDefaultToolRegistry, ToolRegistry } from "./registry";
import { createToolExecutionSegments } from "./scheduler";
import { selectAdvertisedBridgeTools, type SelectAdvertisedBridgeToolsOptions } from "./selection";
import type {
  ToolBridgeProviderFormat,
  ToolBridgeToolFamily,
  ToolBridgeSchedulerMode,
  ToolCallRequest,
  ToolDefinition,
  ToolExecutionContext,
} from "./types";

export interface ToolHealthAuditScenario {
  id: string;
  options?: Partial<Omit<SelectAdvertisedBridgeToolsOptions, "prompt">>;
  prompt: string;
}

export interface ToolHealthAuditRuntimeBudget {
  maxExecutions?: number;
  maxPasses?: number;
  maxToolResultContentChars?: number | null;
}

export interface ToolHealthAuditScenarioReport {
  familyCounts: Record<string, number>;
  id: string;
  providerFormat: ToolBridgeProviderFormat;
  prompt: string;
  schedulerSegments: Array<{
    mode: ToolBridgeSchedulerMode;
    toolIds: string[];
  }>;
  schemaTokenEstimate: number;
  selectedToolCount: number;
  selectedToolIds: string[];
}

export interface ToolHealthAuditReport {
  registryToolCount: number;
  runtimeBudget: ToolHealthAuditRuntimeBudget;
  scenarios: ToolHealthAuditScenarioReport[];
}

export const DEFAULT_TOOL_HEALTH_AUDIT_SCENARIOS: ToolHealthAuditScenario[] = [
  { id: "code_edit", prompt: "fix src/App.jsx and run the tests" },
  { id: "local_review", prompt: "review the current working tree changes" },
  { id: "web_docs", options: { webSearchEnabled: true }, prompt: "check the latest official API docs online" },
  { id: "gmail_send", prompt: "send an email to teammate@example.com with a professional update" },
  { id: "calendar_agenda", prompt: "show today's Google Calendar agenda and free time" },
  { id: "calendar_write", prompt: "create a Google Calendar event for tomorrow at 2pm" },
  { id: "github_review", prompt: "use GitHub to check stars forks tags branches issues PRs and actions for this repo" },
  { id: "github_lifecycle", prompt: "complete them and close the issues in GitHub" },
  { id: "mcp", options: { mcpServersEnabled: true }, prompt: "list MCP servers, list tools, then call the selected MCP tool" },
  { id: "browser", prompt: "open a localhost browser preview and read the console" },
  { id: "terminal", prompt: "run npm test in the terminal" },
  { id: "image", prompt: "generate an image of a clean app icon" },
  { id: "memory", prompt: "remember the previous tool bridge decision" },
];

export function createToolBridgeHealthAudit(options: {
  context?: Partial<ToolExecutionContext>;
  providerFormat?: ToolBridgeProviderFormat;
  registry?: ToolRegistry;
  runtimeBudget?: ToolHealthAuditRuntimeBudget;
  scenarios?: ToolHealthAuditScenario[];
  selectionDefaults?: Partial<Omit<SelectAdvertisedBridgeToolsOptions, "prompt">>;
} = {}): ToolHealthAuditReport {
  const registry = options.registry ?? createDefaultToolRegistry();
  const providerFormat = options.providerFormat ?? "openai-compatible";
  const context: ToolExecutionContext = {
    model: options.context?.model ?? "audit-model",
    permissionMode: options.context?.permissionMode ?? "auto-review",
    provider: options.context?.provider ?? "openai",
    ...options.context,
  };
  const availableTools = registry.listForContext(context, providerFormat, { includePendingApproval: true });
  const selectionDefaults = {
    browserPreviewEnabled: true,
    editingEnabled: true,
    fileToolsEnabled: true,
    gitEnabled: true,
    imageGenerationEnabled: true,
    mcpServersEnabled: true,
    memoryEnabled: true,
    terminalEnabled: true,
    webSearchEnabled: false,
    ...options.selectionDefaults,
  };

  return {
    registryToolCount: registry.list().length,
    runtimeBudget: options.runtimeBudget ?? {
      maxExecutions: 48,
      maxPasses: 12,
      maxToolResultContentChars: null,
    },
    scenarios: (options.scenarios ?? DEFAULT_TOOL_HEALTH_AUDIT_SCENARIOS).map((scenario) => {
      const selectedTools = selectAdvertisedBridgeTools(availableTools, {
        ...selectionDefaults,
        ...scenario.options,
        prompt: scenario.prompt,
      });

      return createScenarioReport({
        provider: context.provider,
        providerFormat,
        prompt: scenario.prompt,
        registry,
        scenarioId: scenario.id,
        selectedTools,
      });
    }),
  };
}

function createScenarioReport(options: {
  provider: ToolExecutionContext["provider"];
  providerFormat: ToolBridgeProviderFormat;
  prompt: string;
  registry: ToolRegistry;
  scenarioId: string;
  selectedTools: ToolDefinition[];
}): ToolHealthAuditScenarioReport {
  const syntheticCalls = options.selectedTools.map((tool, index): ToolCallRequest => ({
    arguments: {},
    id: `audit-${options.scenarioId}-${index}`,
    name: tool.id,
    provider: options.provider,
  }));
  const schedulerSegments = createToolExecutionSegments(syntheticCalls, options.registry)
    .map((segment) => ({
      mode: segment.mode,
      toolIds: segment.calls.map((call) => call.name),
    }));

  return {
    familyCounts: countToolFamilies(options.selectedTools),
    id: options.scenarioId,
    prompt: options.prompt,
    providerFormat: options.providerFormat,
    schedulerSegments,
    schemaTokenEstimate: estimateProviderSchemaTokens(options.selectedTools),
    selectedToolCount: options.selectedTools.length,
    selectedToolIds: options.selectedTools.map((tool) => tool.id),
  };
}

function estimateProviderSchemaTokens(tools: ToolDefinition[]) {
  return Math.ceil(JSON.stringify(tools.map(createProviderVisibleToolSchema)).length / 4);
}

function countToolFamilies(tools: ToolDefinition[]) {
  const counts: Record<string, number> = {};

  for (const tool of tools) {
    const family: ToolBridgeToolFamily | "unknown" = tool.executorMetadata?.family ?? "unknown";
    counts[family] = (counts[family] ?? 0) + 1;
  }

  return counts;
}
