import type { LocalPermissionMode } from "../types/localWorkspace";
import type {
  ToolBridgePermissionRequirement,
  ToolBridgeRisk,
  ToolDefinition,
  ToolExecutionContext,
  ToolPermissionDecision,
} from "./types";

const LEGACY_PERMISSION_MODE_MAP: Record<string, LocalPermissionMode> = {
  "ask-first": "default",
  "auto-review": "auto-review",
  default: "default",
  "full-access": "full-access",
  "full-workspace": "full-access",
  "gilbert-review": "default",
  "read-only": "default",
};

const HARD_APPROVAL_PERMISSIONS: ReadonlySet<ToolBridgePermissionRequirement> = new Set([
  "credential",
  "destructive",
  "external-path",
  "publish",
]);

const HARD_APPROVAL_RISKS: ReadonlySet<ToolBridgeRisk> = new Set([
  "credential",
  "destructive",
  "publish",
]);

const CONNECTED_APP_WRITE_FAMILIES = new Set(["calendar", "github", "gmail"]);

export interface FilterToolsForPermissionOptions {
  // Includes approval-gated tools so the model can propose them and the callback can decide.
  includePendingApproval?: boolean;
}

export function normalizeToolBridgePermissionMode(value: unknown): LocalPermissionMode {
  if (typeof value !== "string") {
    return "default";
  }

  return LEGACY_PERMISSION_MODE_MAP[value] ?? "default";
}

export function resolveToolPermission(
  tool: ToolDefinition,
  context: Pick<ToolExecutionContext, "automationScope" | "permissionMode">,
): ToolPermissionDecision {
  const permissionMode = normalizeToolBridgePermissionMode(context.permissionMode);
  const isHardGated = HARD_APPROVAL_PERMISSIONS.has(tool.permission) || HARD_APPROVAL_RISKS.has(tool.risk);
  const automationDecision = resolveAutomationScopedPermission(tool, context.automationScope, isHardGated);

  if (automationDecision) {
    return automationDecision;
  }

  const isConnectedAppWrite =
    CONNECTED_APP_WRITE_FAMILIES.has(tool.executorMetadata?.family ?? "") &&
    (tool.permission === "mutating" || tool.permission === "destructive" || tool.risk === "mutating" || tool.risk === "destructive");

  if (tool.permission === "diagnostic" || tool.risk === "diagnostic") {
    return {
      allowed: true,
      requiresApproval: false,
    };
  }

  if (permissionMode === "default") {
    if ((tool.permission === "read-only" || tool.risk === "read") && !isHardGated) {
      return {
        allowed: true,
        requiresApproval: false,
      };
    }

    return {
      allowed: false,
      reason: "Default permissions require approval for mutating, terminal, external, network, credential, publish, or destructive tools.",
      requiresApproval: true,
    };
  }

  if (permissionMode === "auto-review") {
    if ((tool.permission === "read-only" || tool.risk === "read") && !isHardGated) {
      return {
        allowed: true,
        requiresApproval: false,
      };
    }

    return {
      allowed: false,
      reason: "Auto-review still requires approval for mutating, terminal, external, credential, publish, or destructive tools.",
      requiresApproval: true,
    };
  }

  if (isHardGated || isConnectedAppWrite) {
    return {
      allowed: false,
      reason: isConnectedAppWrite
        ? "Connected app write actions require confirmation unless the user allowed this action type for the current chat."
        : "Full access keeps hard circuit breakers for destructive, credential, publish, and outside-scope actions.",
      requiresApproval: true,
    };
  }

  return {
    allowed: true,
    requiresApproval: false,
  };
}

export function filterToolsForPermission(
  tools: ToolDefinition[],
  context: Pick<ToolExecutionContext, "automationScope" | "permissionMode">,
  options?: FilterToolsForPermissionOptions,
) {
  return tools.filter((tool) => {
    const decision = resolveToolPermission(tool, context);

    if (decision.allowed) {
      return true;
    }

    if (options?.includePendingApproval && decision.requiresApproval) {
      return true;
    }

    return false;
  });
}

function resolveAutomationScopedPermission(
  tool: ToolDefinition,
  scope: ToolExecutionContext["automationScope"] | undefined,
  isHardGated: boolean,
): ToolPermissionDecision | null {
  if (!scope) {
    return null;
  }

  if (tool.permission === "diagnostic" || tool.risk === "diagnostic") {
    return {
      allowed: true,
      requiresApproval: false,
    };
  }

  const family = tool.executorMetadata?.family;
  const allowedToolIds = new Set(scope.allowedToolIds ?? []);
  const allowedFamilies = new Set(scope.allowedFamilies ?? []);
  const isExplicitlyScoped = allowedToolIds.has(tool.id) || (family ? allowedFamilies.has(family) : false);
  const familyRequiresTaskScope = family === "gmail" || family === "calendar" || family === "github" || family === "web" || family === "mcp";

  if (!isExplicitlyScoped && familyRequiresTaskScope) {
    return {
      allowed: false,
      reason: `This task is not allowed to use ${family} tools unless that capability is enabled for the task.`,
      requiresApproval: true,
    };
  }

  if (!scope.autonomous) {
    return null;
  }

  if (!isExplicitlyScoped) {
    return null;
  }

  if (isHardGated) {
    return {
      allowed: false,
      reason: "This task can act autonomously only inside scoped connected-app actions. Destructive, terminal, credential, publish, and external-path tools still need approval.",
      requiresApproval: true,
    };
  }

  return {
    allowed: true,
    requiresApproval: false,
  };
}

export function toolBridgePermissionLabel(mode: LocalPermissionMode) {
  if (mode === "full-access") {
    return "Full access";
  }

  if (mode === "auto-review") {
    return "Auto-review";
  }

  return "Default permissions";
}
