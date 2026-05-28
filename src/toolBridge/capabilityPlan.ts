import { getModelProvider } from "../lib/models";
import type { ProviderSettings } from "../types/settings";
import { isToolCompatibleWithProvider } from "./registry";
import { selectAdvertisedBridgeTools, type SelectAdvertisedBridgeToolsOptions } from "./selection";
import type {
  ToolBridgeProviderFormat,
  ToolBridgeToolChoice,
  ToolBridgeToolFamily,
  ToolCapabilityBlockedReason,
  ToolCapabilityPlan,
  ToolDefinition,
  ToolIntent,
} from "./types";

export interface SelectToolCapabilityPlanOptions extends SelectAdvertisedBridgeToolsOptions {
  availableTools: ToolDefinition[];
  blockedReasons?: ToolCapabilityBlockedReason[];
  mustUseTools?: boolean;
  providerFormat?: ToolBridgeProviderFormat;
  requiredFamilies?: ToolBridgeToolFamily[];
  requestedToolChoice?: ToolBridgeToolChoice;
  toolBudgetReached?: boolean;
  toolIntent?: ToolIntent[];
}

export function selectToolCapabilityPlan(options: SelectToolCapabilityPlanOptions): ToolCapabilityPlan {
  const selectedTools = options.toolBudgetReached
    ? []
    : selectAdvertisedBridgeTools(options.availableTools, options);

  return createToolCapabilityPlan({
    blockedReasons: options.blockedReasons,
    mustUseTools: options.mustUseTools,
    prompt: options.prompt,
    providerFormat: options.providerFormat,
    requestedToolChoice: options.requestedToolChoice,
    requiredFamilies: options.requiredFamilies,
    selectedTools,
    toolBudgetReached: options.toolBudgetReached,
    toolIntent: options.toolIntent,
  });
}

export function createToolCapabilityPlan(options: {
  blockedReasons?: ToolCapabilityBlockedReason[];
  mustUseTools?: boolean;
  prompt: string;
  providerFormat?: ToolBridgeProviderFormat;
  requestedToolChoice?: ToolBridgeToolChoice;
  requiredFamilies?: ToolBridgeToolFamily[];
  selectedTools: ToolDefinition[];
  toolBudgetReached?: boolean;
  toolIntent?: ToolIntent[];
}): ToolCapabilityPlan {
  const selectedTools = options.toolBudgetReached ? [] : options.selectedTools;
  const providerVisibleTools = options.providerFormat
    ? selectedTools.filter((tool) => isToolCompatibleWithProvider(tool, options.providerFormat))
    : selectedTools;
  const providerVisibleToolIds = providerVisibleTools.map((tool) => tool.id);
  const selectedToolIds = selectedTools.map((tool) => tool.id);
  const requiredFamilies = [...new Set(options.requiredFamilies ?? [])];
  const blockedReasons: ToolCapabilityBlockedReason[] = [...(options.blockedReasons ?? [])];
  const mustUseTools = Boolean(options.mustUseTools);
  const visibleFamilies = new Set(providerVisibleTools.map((tool) => tool.executorMetadata?.family).filter(Boolean) as ToolBridgeToolFamily[]);
  const workspaceMutationRequiresEditing = mustUseTools && (options.toolIntent ?? []).includes("workspace_mutation");

  if (options.toolBudgetReached) {
    blockedReasons.push({
      code: "tool_budget_reached",
      detail: "The configured tool budget has been reached for this request.",
    });
  }

  if (mustUseTools && selectedTools.length === 0 && !options.toolBudgetReached) {
    blockedReasons.push({
      code: "no_selected_tools",
      detail: "The request requires tools, but prompt selection did not produce any callable tools.",
    });
  }

  if (mustUseTools && selectedTools.length > 0 && providerVisibleToolIds.length === 0) {
    blockedReasons.push({
      code: "no_provider_visible_tools",
      detail: "The request requires tools, but all selected tools were filtered out before the provider call.",
    });
  }

  const requiredFamilyUnavailable = mustUseTools && requiredFamilies.length > 0 && !requiredFamilies.some((family) => visibleFamilies.has(family));

  if (requiredFamilyUnavailable) {
    blockedReasons.push({
      code: "required_family_unavailable",
      detail: `None of the required tool families are provider-visible for this pass: ${requiredFamilies.join(", ")}.`,
    });
  }

  if (workspaceMutationRequiresEditing && !visibleFamilies.has("editing")) {
    blockedReasons.push({
      code: "required_family_unavailable",
      detail: "The request requires a real workspace file mutation, but no editing tools are provider-visible for this pass.",
      family: "editing",
    });
  }

  const canCallProvider = !mustUseTools || (providerVisibleToolIds.length > 0 && !requiredFamilyUnavailable && (!workspaceMutationRequiresEditing || visibleFamilies.has("editing")) && !options.toolBudgetReached);
  const toolChoice = resolveToolChoice({
    canCallProvider,
    mustUseTools,
    providerVisibleToolIds,
    requestedToolChoice: options.requestedToolChoice,
    toolBudgetReached: options.toolBudgetReached,
  });

  return {
    blockedReasons: dedupeBlockedReasons(blockedReasons),
    canCallProvider,
    intent: options.toolIntent?.length ? [...new Set(options.toolIntent)] : ["none"],
    mustUseTools,
    prompt: options.prompt,
    providerFormat: options.providerFormat,
    providerVisibleToolIds,
    requiredFamilies,
    selectedToolIds,
    selectedTools,
    toolChoice,
  };
}

export function inferProviderToolBridgeFormat(settings: ProviderSettings): ToolBridgeProviderFormat {
  const provider = getModelProvider(settings.provider);

  if (provider.apiStyle === "anthropic-messages") {
    return "anthropic-messages";
  }

  if ((settings.provider === "openai" || provider.reasoningMode === "local-responses") && settings.thinking.enabled) {
    return "openai-responses";
  }

  return "openai-compatible";
}

function resolveToolChoice(options: {
  canCallProvider: boolean;
  mustUseTools: boolean;
  providerVisibleToolIds: string[];
  requestedToolChoice?: ToolBridgeToolChoice;
  toolBudgetReached?: boolean;
}): ToolBridgeToolChoice {
  if (options.toolBudgetReached || !options.canCallProvider || options.providerVisibleToolIds.length === 0) {
    return "none";
  }

  if (options.requestedToolChoice) {
    return options.requestedToolChoice;
  }

  return options.mustUseTools ? "required" : "auto";
}

function dedupeBlockedReasons(reasons: ToolCapabilityBlockedReason[]) {
  const seen = new Set<string>();

  return reasons.filter((reason) => {
    const key = `${reason.code}:${reason.family ?? ""}:${reason.toolId ?? ""}:${reason.detail}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}
