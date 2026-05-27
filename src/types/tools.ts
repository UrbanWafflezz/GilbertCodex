/** Tool settings categories that can be enabled or disabled by the user. */
export type ToolRegistryId =
  | "browserPreview"
  | "codeEdit"
  | "codeGeneration"
  | "codeView"
  | "colorTools"
  | "desktopComputer"
  | "fileSafety"
  | "imageGeneration"
  | "fileCreation"
  | "fileBrowser"
  | "fileSearch"
  | "mcpServers"
  | "pdfTools"
  | "permissions"
  | "planning"
  | "provider"
  | "reactNativeTools"
  | "sourceControl"
  | "sqlTools"
  | "terminal"
  | "testingTools"
  | "typescriptTools"
  | "webSearch"
  | "weatherTools"
  | "workflowAutomation";

export type ToolRegistrySettings = Record<ToolRegistryId, boolean>;

/** New installs keep the core provider, planning, local workspace, image generation, MCP, web search, terminal, and preview tools enabled. */
export const DEFAULT_TOOL_REGISTRY_SETTINGS: ToolRegistrySettings = {
  browserPreview: true,
  codeEdit: true,
  codeGeneration: true,
  codeView: true,
  colorTools: false,
  desktopComputer: true,
  fileSafety: true,
  imageGeneration: true,
  fileCreation: true,
  fileBrowser: true,
  fileSearch: true,
  mcpServers: true,
  pdfTools: false,
  permissions: false,
  planning: true,
  provider: true,
  reactNativeTools: false,
  sourceControl: true,
  sqlTools: false,
  terminal: true,
  testingTools: false,
  typescriptTools: false,
  webSearch: true,
  weatherTools: false,
  workflowAutomation: false,
};

const ACTIVE_TOOL_REGISTRY_IDS = new Set<ToolRegistryId>([
  "browserPreview",
  "codeEdit",
  "codeGeneration",
  "codeView",
  "desktopComputer",
  "fileBrowser",
  "fileCreation",
  "fileSafety",
  "imageGeneration",
  "fileSearch",
  "mcpServers",
  "planning",
  "provider",
  "sourceControl",
  "terminal",
  "webSearch",
]);

const REQUIRED_LOCAL_TOOL_REGISTRY_IDS = new Set<ToolRegistryId>([
  "codeEdit",
  "codeGeneration",
  "codeView",
  "desktopComputer",
  "fileBrowser",
  "fileCreation",
  "fileSafety",
  "fileSearch",
  "sourceControl",
]);

/** Merges persisted settings while force-disabling tool groups that do not have a rebuilt bridge/runtime surface yet. */
export function normalizeToolRegistrySettings(value: unknown): ToolRegistrySettings {
  const storedSettings = typeof value === "object" && value ? (value as Partial<ToolRegistrySettings>) : {};

  return Object.fromEntries(
    (Object.keys(DEFAULT_TOOL_REGISTRY_SETTINGS) as ToolRegistryId[]).map((toolId) => [
      toolId,
      REQUIRED_LOCAL_TOOL_REGISTRY_IDS.has(toolId)
        ? true
        : ACTIVE_TOOL_REGISTRY_IDS.has(toolId)
        ? (typeof storedSettings[toolId] === "boolean" ? storedSettings[toolId] : DEFAULT_TOOL_REGISTRY_SETTINGS[toolId])
        : false,
    ]),
  ) as ToolRegistrySettings;
}
