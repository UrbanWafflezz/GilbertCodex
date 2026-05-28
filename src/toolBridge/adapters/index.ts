import type { ToolBridgeProviderFormat, ProviderToolBridgeOptions } from "../types";
import { isToolCompatibleWithProvider } from "../registry";
import { applyAnthropicToolBridge } from "./anthropic";
import { applyOpenAiCompatibleToolBridge } from "./openAiCompatible";
import { applyResponsesToolBridge } from "./responses";

// Applies advertised tools and prior tool results to the provider request body.
export function applyToolBridgeToProviderRequest(
  body: Record<string, unknown>,
  providerFormat: ToolBridgeProviderFormat,
  options: ProviderToolBridgeOptions | undefined,
) {
  if (
    !options ||
    ((!options.tools || options.tools.length === 0) &&
      (!options.toolResultMessages || options.toolResultMessages.length === 0) &&
      options.toolChoice !== "none")
  ) {
    return body;
  }

  const providerVisibleTools = (options.tools ?? []).filter((tool) => isToolCompatibleWithProvider(tool, providerFormat));
  const providerVisibleToolIds = providerVisibleTools.map((tool) => tool.id);
  const bridgeOptions: ProviderToolBridgeOptions = {
    ...options,
    capabilityPlan: options.capabilityPlan
      ? {
          ...options.capabilityPlan,
          providerFormat,
          providerVisibleToolIds,
        }
      : undefined,
    providerVisibleToolIds,
    tools: providerVisibleTools,
  };

  if (providerFormat === "anthropic-messages") {
    return applyAnthropicToolBridge(body, bridgeOptions);
  }

  if (providerFormat === "openai-responses") {
    return applyResponsesToolBridge(body, bridgeOptions);
  }

  return applyOpenAiCompatibleToolBridge(body, bridgeOptions);
}
