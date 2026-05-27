// @ts-nocheck
import type { SetStateAction } from "react";

import type { AgentRuntimeDecision } from "../../../agentRuntime/codingAgent";
import type { LocalComputerToolExecutionPolicy, LocalSubagentResult, LocalSubagentTask } from "../../../localWorkspace/localToolRuntimeDisabled";
import type { ContextCompactionNotice, ContextWindowUsage, ModelContextWindowMap, compactMessagesForContext } from "../../../lib/contextWindow";
import type { PlanningProviderRequest } from "../../../services/planningClient";
import type { ProviderToolBridgeOptions, ToolBridgeExecutionBatch, ToolCallRequest, ToolDefinition, ToolExecutionContext, ToolMemorySearchRequest, ToolResultMessage } from "../../../toolBridge";
import type { AppInfo } from "../../../types/app";
import type { AgentApproval, AgentApprovalDecision, AgentRun } from "../../../types/agentRun";
import type { AuthSession } from "../../../types/auth";
import type { ChatArtifact, ChatAttachment, ChatContextCompaction, ChatComposerDraft, ChatMessage, ChatPlanningInputAnswer, ChatProgressItem, ChatResearchReference, ChatSendInput, ChatSource, ChatSummary, ChatToolCall, ChatWebSearch, ChatWorkTraceItem } from "../../../types/chat";
import type { DiscordBridgeSettings } from "../../../types/discord";
import type { LocalWorkspaceSettings } from "../../../types/localWorkspace";
import type { PrimaryRoute } from "../../../types/navigation";
import type { CreateProjectOptions, ProjectSummary } from "../../../types/project";
import type { ProviderReasoningState } from "../../../types/reasoning";
import type { AppPersonalizationSettings, AppearanceMode, ProviderSettings, WebSearchSettings } from "../../../types/settings";
import type { ToolRegistrySettings } from "../../../types/tools";
import type { SettingsSectionId } from "../../../pages/settings/types";
import type { DiscordInteractionEvent } from "../../tauriClient";
import type { ActiveGeneration, ApprovedPlanExecutionContext, AssistantToolResponse, ComposerDraftRestoreRequest, DiscordReplyTarget, DiscordStreamUpdate, QueuedChatSend, SessionApprovalDecisionMap, SessionApprovalDecisionsByWorkspace, StartSendMessageOptions } from "../WorkspaceApp";
import type { WorkspaceRuntimeDeps } from "../runtimeTypes";

export function createToolFinalAnswerUnavailableMessage(deps: WorkspaceRuntimeDeps, toolCalls: ChatToolCall[], originalPrompt) {
  const { createGitToolFallbackAnswer, createSynthesisRecoveryFallback, summarizeCompletedToolFallback, summarizeUnsuccessfulToolSection } = deps;

    const gitFallback = createGitToolFallbackAnswer(toolCalls, originalPrompt);

    if (gitFallback) {
      return gitFallback;
    }

    const latestCompleteToolCall = [...toolCalls].reverse().find((toolCall) => toolCall.status === "complete" && (toolCall.output || toolCall.detail));
    const latestIssueToolCall = [...toolCalls].reverse().find((toolCall) => toolCall.status !== "complete" && (toolCall.output || toolCall.detail));
    const latestToolCall = latestCompleteToolCall ?? latestIssueToolCall;

    if (!latestToolCall) {
      return "I do not have a completed tool result to answer from yet.";
    }

    const rawLatestOutput = latestToolCall.output ? latestToolCall.output : latestToolCall.detail ? latestToolCall.detail : "";
    const fallbackOutput = latestToolCall.status === "complete"
      ? summarizeCompletedToolFallback(latestToolCall, rawLatestOutput)
      : summarizeUnsuccessfulToolSection(rawLatestOutput);

    if (latestToolCall.resultPolicy?.synthesizeAfterwards) {
      return createSynthesisRecoveryFallback(latestToolCall, fallbackOutput);
    }

    if (latestToolCall.status === "complete") {
      return fallbackOutput || `${latestToolCall.label} completed.`;
    }

    return [
      `${latestToolCall.label} did not complete cleanly.`,
      latestToolCall.status ? `Status: ${latestToolCall.status}` : "",
      fallbackOutput,
    ].filter(Boolean).join("\n\n");

  }

export function createSynthesisRecoveryFallback(deps: WorkspaceRuntimeDeps, toolCall: ChatToolCall, fallbackOutput: string) {
  const { createNeutralToolSynthesisFailureMessage, extractMissingReadPath, extractSuggestedFileReadCandidates, extractToolInputPath, getLastPathSegment, isFileReadSynthesisToolCall, isMissingFileReadError, isRecoverableBridgeArgumentError, isToolResultFallbackAnswer, looksLikeInternalToolRecoveryAnswer, summarizeUserFacingFailure } = deps;

    const suggestedPaths = extractSuggestedFileReadCandidates(fallbackOutput);

    if (suggestedPaths.length > 0) {
      return [
        "I could not read the requested file path.",
        `Closest suggested path: ${suggestedPaths[0]}`,
      ].join("\n");
    }

    if (isMissingFileReadError(fallbackOutput)) {
      const requestedPath = extractMissingReadPath(fallbackOutput) || extractToolInputPath(toolCall.input);
      const fileName = requestedPath ? getLastPathSegment(requestedPath) : "";
      return fileName
        ? `I could not find \`${fileName}\` in the selected workspace.`
        : "I could not find that file in the selected workspace.";
    }

    if (isRecoverableBridgeArgumentError(fallbackOutput)) {
      const inputPath = extractToolInputPath(toolCall.input);
      return inputPath
        ? `I could not inspect \`${inputPath}\` because the tool arguments were malformed.`
        : "I could not inspect the requested file because the tool arguments were malformed.";
    }

    if (toolCall.status === "complete" && isFileReadSynthesisToolCall(toolCall)) {
      return createNeutralToolSynthesisFailureMessage();
    }

    if (toolCall.status !== "complete" && fallbackOutput) {
      return [
        `${toolCall.label} did not complete cleanly.`,
        summarizeUserFacingFailure(fallbackOutput),
      ].filter(Boolean).join("\n");
    }

    if (fallbackOutput && (looksLikeInternalToolRecoveryAnswer(fallbackOutput) || isToolResultFallbackAnswer(fallbackOutput))) {
      return createNeutralToolSynthesisFailureMessage();
    }

    return fallbackOutput || createNeutralToolSynthesisFailureMessage();
  }

export function summarizeUserFacingFailure(deps: WorkspaceRuntimeDeps, output: string) {
  const { extractMissingReadPath, getLastPathSegment, isMissingFileReadError, isRecoverableBridgeArgumentError } = deps;

    const trimmed = output.replace(/\s+/g, " ").trim();

    if (!trimmed) {
      return "";
    }

    if (isMissingFileReadError(trimmed)) {
      const requestedPath = extractMissingReadPath(trimmed);
      const fileName = requestedPath ? getLastPathSegment(requestedPath) : "";
      return fileName
        ? `I could not find \`${fileName}\` in the selected workspace.`
        : "I could not find that file in the selected workspace.";
    }

    if (isRecoverableBridgeArgumentError(trimmed)) {
      return "";
    }

    return trimmed.length > 260 ? `${trimmed.slice(0, 257)}...` : trimmed;
  }

export function createRecoverableBridgeToolRetryInstruction(deps: WorkspaceRuntimeDeps, toolCalls: ChatToolCall[], originalPrompt: string) {
  const { createMissingReadSearchQuery, extractMissingReadPath, extractNearbyPathCandidates, extractSuggestedFileReadCandidates, extractSuggestedFileSearchQuery, extractToolInputPath, getToolCallRawOutput, isMissingFileReadToolCall, isRecoverableBridgeArgumentError } = deps;

    const latestRecoverableToolCall = [...toolCalls].reverse().find((toolCall) => {
      if (toolCall.status !== "error" && toolCall.status !== "skipped") {
        return false;
      }

      const rawOutput = getToolCallRawOutput(toolCall);
      return extractSuggestedFileReadCandidates(rawOutput).length > 0 ||
        extractNearbyPathCandidates(rawOutput).length > 0 ||
        isRecoverableBridgeArgumentError(rawOutput) ||
        /\bchanged since it was last read\b/i.test(rawOutput) ||
        isMissingFileReadToolCall(toolCall, rawOutput);
    });

    if (!latestRecoverableToolCall) {
      return "";
    }

    const rawOutput = getToolCallRawOutput(latestRecoverableToolCall);
    const suggestedPaths = [
      ...extractSuggestedFileReadCandidates(rawOutput),
      ...extractNearbyPathCandidates(rawOutput),
    ];
    const missingReadPath = extractMissingReadPath(rawOutput) || extractToolInputPath(latestRecoverableToolCall.input);
    const missingReadQuery = extractSuggestedFileSearchQuery(rawOutput) ||
      (missingReadPath ? createMissingReadSearchQuery(missingReadPath) : "");
    const staleEditPath = /\bchanged since it was last read\b/i.test(rawOutput)
      ? extractToolInputPath(latestRecoverableToolCall.input)
      : "";
    const emptyEditContent = looksLikeEmptyEditContentError(rawOutput);
    const ambiguousExactReplace = looksLikeAmbiguousExactReplaceError(rawOutput);
    const broadBatchEdit = looksLikeBroadBatchEditError(rawOutput);

    const missingPathRead =
      /\barguments\.paths?\s+is\s+required\b/i.test(rawOutput) &&
      (latestRecoverableToolCall.toolId === "files_read" ||
        latestRecoverableToolCall.toolId === "files_read_many" ||
        latestRecoverableToolCall.toolId === "files_read_range" ||
        /read.*(?:workspace\s+)?files?/i.test(latestRecoverableToolCall.label));

    return [
      "RECOVERABLE TOOL ERROR",
      `Original user request: ${originalPrompt}`,
      `The previous ${latestRecoverableToolCall.label} call failed in a way that can be corrected.`,
      staleEditPath
        ? [
            "The target file changed after the prior read, so the old expectedSha256 is stale.",
            `Re-read the current target now with files_read_range or files_read for ${staleEditPath}.`,
            "Then retry the same edit against the latest content. For append or exact_replace, omit expectedSha256 on retry; for line or column edits, use fresh coordinates from the new read.",
          ].join("\n")
        : emptyEditContent
        ? [
            "The edit call was malformed because one operation had empty insertion/append content.",
            "Do not retry the same empty-content edit. Re-read the target section if needed, then retry with files_edit_many using non-empty content, exact_replace, replace_range, or files_apply_patch anchored to current text.",
            "If the intended change is a CSS selector tweak, patch the existing selector block instead of inserting an empty line.",
          ].join("\n")
        : ambiguousExactReplace
        ? [
            "The exact replacement matched more than one location, so no file change was applied.",
            "Do not set replaceAll unless the user truly wants every matching occurrence changed.",
            "Re-read the relevant section if needed, then retry with a more specific oldText that includes surrounding unique context, replace_span/replace_range from fresh coordinates, or files_apply_patch anchored to the intended block.",
          ].join("\n")
        : broadBatchEdit
        ? [
            "The edit call was too broad and was refused before writing.",
            "Do not retry by replacing most or all of the file through files_edit_many.",
            "Re-read the intended section, then retry with a smaller unique oldText, replace_span, replace_range from fresh coordinates, or files_apply_patch anchored to the target block.",
          ].join("\n")
        : suggestedPaths.length > 0
        ? [
            "Retry the same intent now by calling files_read or files_read_range with the closest matching suggested path.",
            `Suggested paths: ${suggestedPaths.join("; ")}`,
          ].join("\n")
        : missingReadQuery
          ? [
              "The requested file path was not found. Search the workspace by file name before giving up.",
              `Call files_search now with query "${missingReadQuery}", includePath true, includeContent false, and maxMatches 20.`,
              "If that search finds a likely file, read it next. If it finds no matches, answer that the file is not present.",
            ].join("\n")
          : missingPathRead
          ? [
              "The read call had no file path.",
              "Call files_tree_summary or files_list with path \".\" if you need to discover the project structure.",
              "If you need a specific file, call files_search with a focused filename, symbol, or phrase from the user request, then read the matched path.",
            ].join("\n")
          : "Retry the same intent now with valid JSON argument types and only schema-supported keys.",
      "Do not write a final answer until the corrected tool call has either succeeded or there is no safe correction.",
    ].join("\n\n");
  }

export function getToolCallRawOutput(deps: WorkspaceRuntimeDeps, toolCall: ChatToolCall) {

    return [toolCall.output, toolCall.detail].filter(Boolean).join("\n");
  }

export function extractSuggestedFileReadCandidates(deps: WorkspaceRuntimeDeps, output: string) {

    const match = output.match(/try\s+files_read\s+on\s+one\s+of:\s*([^\n]+)/i);

    if (!match?.[1]) {
      return [];
    }

    return match[1]
      .split(/\s*,\s*/)
      .map((path) => path.trim().replace(/^`|`$/g, ""))
      .filter(Boolean)
      .slice(0, 6);
  }

export function extractNearbyPathCandidates(deps: WorkspaceRuntimeDeps, output: string) {

    const match = output.match(/nearby paths:\s*([^\n]+)/i);

    if (!match?.[1]) {
      return [];
    }

    return match[1]
      .split(/\s*,\s*/)
      .map((path) => path.trim().replace(/^`|`$/g, ""))
      .filter(Boolean)
      .slice(0, 6);
  }

export function extractSuggestedFileSearchQuery(deps: WorkspaceRuntimeDeps, output: string) {

    const match = output.match(/try\s+files_search\s+with\s+query\s+(?:`([^`]+)`|"([^"]+)"|'([^']+)')/i);
    return (match?.[1] || match?.[2] || match?.[3] || "").trim();
  }

export function isMissingFileReadToolCall(deps: WorkspaceRuntimeDeps, toolCall: ChatToolCall, output: string) {
  const { isMissingFileReadError } = deps;

    const isReadTool = toolCall.toolId === "files_read" ||
      toolCall.toolId === "files_read_many" ||
      toolCall.toolId === "files_read_range" ||
      /read.*(?:workspace\s+)?files?/i.test(toolCall.label);

    return isReadTool && isMissingFileReadError(output);
  }

export function isMissingFileReadError(deps: WorkspaceRuntimeDeps, output: string) {

    return /could not read\b/i.test(output) &&
      /\b(?:cannot find the file specified|cannot find the path specified|no such file or directory|not found|os error [23])\b/i.test(output);
  }

export function extractMissingReadPath(deps: WorkspaceRuntimeDeps, output: string) {

    const backtickMatch = output.match(/could not read\s+`([^`]+)`/i);
    if (backtickMatch?.[1]) {
      return backtickMatch[1].trim();
    }

    const plainMatch = output.match(/could not read\s+(.+?)(?::\s+could not read|:\s+the system|:\s+no such|\r?\n|$)/i);
    return plainMatch?.[1]?.trim() ?? "";
  }

export function extractToolInputPath(deps: WorkspaceRuntimeDeps, input: string | undefined) {

    if (!input) {
      return "";
    }

    try {
      const parsed = JSON.parse(input) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        const path = record.path;
        if (typeof path === "string") {
          return path;
        }

        const paths = record.paths;
        if (Array.isArray(paths)) {
          const firstPath = paths.find((item): item is string => typeof item === "string" && item.trim().length > 0);
          if (firstPath) {
            return firstPath;
          }
        }

        const edits = record.edits;
        if (Array.isArray(edits)) {
          const editPath = edits.find((item) => item && typeof item === "object" && typeof (item as Record<string, unknown>).path === "string");
          if (editPath && typeof (editPath as Record<string, unknown>).path === "string") {
            return String((editPath as Record<string, unknown>).path);
          }
        }

        const files = record.files;
        if (Array.isArray(files)) {
          const filePath = files.find((item) => item && typeof item === "object" && typeof (item as Record<string, unknown>).path === "string");
          if (filePath && typeof (filePath as Record<string, unknown>).path === "string") {
            return String((filePath as Record<string, unknown>).path);
          }
        }
      }
    } catch {
      return "";
    }

    return "";
  }

export function createMissingReadSearchQuery(deps: WorkspaceRuntimeDeps, path: string) {
  const { getLastPathSegment } = deps;

    const fileName = getLastPathSegment(path);
    const dotIndex = fileName.lastIndexOf(".");
    const stem = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;

    if (/^(index|main|mod)$/i.test(stem)) {
      const segments = path.split(/[\\/]/).filter(Boolean);
      const parentSegment = segments.length >= 2 ? segments[segments.length - 2] : "";

      if (parentSegment) {
        return parentSegment;
      }
    }

    return stem;
  }

export function getLastPathSegment(deps: WorkspaceRuntimeDeps, path: string) {

    return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  }

export function isRecoverableBridgeArgumentError(deps: WorkspaceRuntimeDeps, output: string) {

    return /\b(arguments?|maxBytes|offset|replaceAll)\b[\s\S]{0,120}\b(?:must be|is not allowed|invalid|required)\b/i.test(output) ||
      looksLikeAmbiguousExactReplaceError(output) ||
      looksLikeBroadBatchEditError(output) ||
      looksLikeEmptyEditContentError(output) ||
      /\btool\s+[\w.-]+\s+received\s+(?:invalid json arguments|arguments that could not be parsed as json)\b/i.test(output);
  }

function looksLikeAmbiguousExactReplaceError(output: string) {
  return /\bExact text matched\s+\d+\s+times(?:\s+after\s+normalizing\s+line\s+endings)?\.\s+Set replaceAll true or make oldText more specific\b/i.test(output);
}

function looksLikeBroadBatchEditError(output: string) {
  return /\bRefusing broad edit\b[\s\S]{0,240}\bfiles[_\s-]*edit[_\s-]*many\b/i.test(output);
}

function looksLikeEmptyEditContentError(output: string) {
  return /\bfiles[_\s-]*edit[_\s-]*many\b[\s\S]{0,120}\b(?:insert[_\s-]*at[_\s-]*line|append)\b[\s\S]{0,120}\brequires\s+non-empty\s+content\b/i.test(output) ||
    /\bfiles[_\s-]*insert[_\s-]*at[_\s-]*line\b[\s\S]{0,120}\brequires\s+non-empty\s+content\b/i.test(output);
}

export function summarizeCompletedToolFallback(deps: WorkspaceRuntimeDeps, toolCall: ChatToolCall, output: string) {
  const { createCompletedToolFallbackSummary, createNeutralToolSynthesisFailureMessage, isFileReadSynthesisToolCall, limitFallbackToolOutput, shouldKeepToolOutputOutOfChat } = deps;

    const trimmed = output.trim();

    if (!trimmed) {
      return `${toolCall.label} completed.`;
    }

    if (shouldKeepToolOutputOutOfChat(toolCall, trimmed)) {
      if (isFileReadSynthesisToolCall(toolCall)) {
        return createNeutralToolSynthesisFailureMessage();
      }

      const structuredSummary = createCompletedToolFallbackSummary(toolCall, trimmed);

      if (structuredSummary) {
        return structuredSummary;
      }

      return [
        `${toolCall.label} completed.`,
        `I kept the raw ${toolCall.label.toLowerCase()} output out of the chat because it is too large or file-content-like.`,
      ].join("\n");
    }

    return limitFallbackToolOutput(trimmed);
  }

export function shouldKeepToolOutputOutOfChat(deps: WorkspaceRuntimeDeps, toolCall: ChatToolCall, output: string) {
  const { countTextLines } = deps;

    if (/read (workspace )?file/i.test(toolCall.label)) {
      return true;
    }

    return output.length > 4_000 || countTextLines(output) > 120;
  }

export function countTextLines(deps: WorkspaceRuntimeDeps, value: string) {

    if (!value) {
      return 0;
    }

    const newlineCount = value.match(/\n/g)?.length ?? 0;
    return value.endsWith("\n") ? newlineCount : newlineCount + 1;
  }

export function limitFallbackToolOutput(deps: WorkspaceRuntimeDeps, output: string) {
  const { contextWindowRef, getModelVisibleToolResultCharBudget } = deps;

    const trimmed = output.trim();
    const maxChars = Math.min(getModelVisibleToolResultCharBudget(contextWindowRef.current.tokens), 4_000);

    if (trimmed.length <= maxChars) {
      return trimmed;
    }

    return `${trimmed.slice(0, maxChars)}\n\n[Fallback output truncated for chat readability.]`;
  }

export function createGitToolFallbackAnswer(deps: WorkspaceRuntimeDeps, toolCalls: ChatToolCall[], originalPrompt: string) {
  const { formatGitStatSuffix, formatGitStatusFallbackGroup, groupGitStatusFallbackFiles, parseGitDiffStatFallbackFiles, parseGitStatusFallbackFiles } = deps;

    const gitStatusOutputs = toolCalls
      .filter((toolCall) => /^git status$/i.test(toolCall.label) && toolCall.output)
      .map((toolCall) => toolCall.output ?? "");
    const gitDiffOutputs = toolCalls
      .filter((toolCall) => /^git diff$/i.test(toolCall.label) && toolCall.output)
      .map((toolCall) => toolCall.output ?? "");

    if (gitStatusOutputs.length === 0 && gitDiffOutputs.length === 0) {
      return "";
    }

    const statusFiles = parseGitStatusFallbackFiles(gitStatusOutputs.join("\n"));
    const diffStats = parseGitDiffStatFallbackFiles(gitDiffOutputs.join("\n"));
    const changedPathCount = statusFiles.length || diffStats.length;
    const grouped = groupGitStatusFallbackFiles(statusFiles);
    const diffOnly = diffStats.filter((stat) => !statusFiles.some((file) => file.path === stat.path));
    const wantsAll = /\b(all|every|everything|single|period|not miss|missing nothing|full|complete|deep)\b/i.test(originalPrompt);

    return [
      changedPathCount > 0
        ? `Here is a Git overview built from the tool output (${changedPathCount} changed path${changedPathCount === 1 ? "" : "s"}).`
        : "Git ran, but no changed paths could be parsed from the tool output.",
      wantsAll ? "Every parsed path is listed below." : "",
      formatGitStatusFallbackGroup("Modified", grouped.modified),
      formatGitStatusFallbackGroup("Added / untracked", grouped.added),
      formatGitStatusFallbackGroup("Deleted", grouped.deleted),
      formatGitStatusFallbackGroup("Renamed / copied", grouped.renamed),
      formatGitStatusFallbackGroup("Other changed", grouped.other),
      diffOnly.length > 0 ? ["Diff-stat-only paths:", ...diffOnly.map((file) => `- ${file.path}${formatGitStatSuffix(file)}`)].join("\n") : "",
      gitDiffOutputs.some((output) => /Output truncated:\s*yes/i.test(output))
        ? "Git output reported truncation. The next review pass should split by explicit file paths until every path is covered."
        : "",
    ].filter(Boolean).join("\n\n");
  }

export function parseGitStatusFallbackFiles(deps: WorkspaceRuntimeDeps, output: string) {
  const { cleanGitFallbackPath, dedupeGitFallbackFiles, extractToolStdout } = deps;

    const stdout = extractToolStdout(output);
    const files: Array<{ path: string; status: string }> = [];

    for (const rawLine of stdout.split(/\r?\n/)) {
      const line = rawLine.trimEnd();

      if (!line || line.startsWith("##") || line.startsWith("warning:")) {
        continue;
      }

      const match = line.match(/^(.{1,2})\s+(.+)$/);

      if (!match) {
        continue;
      }

      const status = match[1].trim();
      const path = cleanGitFallbackPath(match[2]);

      if (status && path) {
        files.push({ path, status });
      }
    }

    return dedupeGitFallbackFiles(files);
  }

export function parseGitDiffStatFallbackFiles(deps: WorkspaceRuntimeDeps, output: string) {
  const { cleanGitFallbackPath, extractToolStdout } = deps;

    const stdout = extractToolStdout(output);
    const files: Array<{ additions: number; deletions: number; path: string }> = [];

    for (const rawLine of stdout.split(/\r?\n/)) {
      const line = rawLine.trimEnd();

      if (!line || line.startsWith("diff --git ") || line.startsWith("UNTRACKED FILES") || line.startsWith("=====")) {
        continue;
      }

      const match = line.match(/^\s*(.+?)\s+\|\s+(\d+)(?:\s+([+\-]+))?\s*$/);

      if (!match) {
        continue;
      }

      const path = cleanGitFallbackPath(match[1]);
      const markers = match[3] ?? "";

      if (path) {
        files.push({
          additions: Array.from(markers).filter((char) => char === "+").length,
          deletions: Array.from(markers).filter((char) => char === "-").length,
          path,
        });
      }
    }

    return files;
  }

export function extractToolStdout(deps: WorkspaceRuntimeDeps, output: string) {

    const stdoutIndex = output.indexOf("\nSTDOUT\n");

    if (stdoutIndex === -1) {
      return output;
    }

    const stderrIndex = output.indexOf("\nSTDERR", stdoutIndex + 8);
    return stderrIndex === -1 ? output.slice(stdoutIndex + 8) : output.slice(stdoutIndex + 8, stderrIndex);
  }

export function cleanGitFallbackPath(deps: WorkspaceRuntimeDeps, value: string) {

    return value.trim().replace(/^"|"$/g, "").replace(/\s+\([^)]+\)$/g, "");
  }

export function dedupeGitFallbackFiles(deps: WorkspaceRuntimeDeps, files: Array<{ path: string; status: string }>) {

    const seen = new Set<string>();
    const deduped: Array<{ path: string; status: string }> = [];

    for (const file of files) {
      if (seen.has(file.path)) {
        continue;
      }
      seen.add(file.path);
      deduped.push(file);
    }

    return deduped;
  }

export function groupGitStatusFallbackFiles(deps: WorkspaceRuntimeDeps, files: Array<{ path: string; status: string }>) {

    const grouped = {
      added: [] as Array<{ path: string; status: string }>,
      deleted: [] as Array<{ path: string; status: string }>,
      modified: [] as Array<{ path: string; status: string }>,
      other: [] as Array<{ path: string; status: string }>,
      renamed: [] as Array<{ path: string; status: string }>,
    };

    for (const file of files) {
      if (file.status === "??" || file.status.includes("A")) {
        grouped.added.push(file);
      } else if (file.status.includes("D")) {
        grouped.deleted.push(file);
      } else if (file.status.includes("R") || file.status.includes("C")) {
        grouped.renamed.push(file);
      } else if (file.status.includes("M")) {
        grouped.modified.push(file);
      } else {
        grouped.other.push(file);
      }
    }

    return grouped;
  }

export function formatGitStatusFallbackGroup(deps: WorkspaceRuntimeDeps, label: string, files: Array<{ path: string; status: string }>) {

    if (files.length === 0) {
      return "";
    }

    return [`${label} (${files.length}):`, ...files.map((file) => `- ${file.status} ${file.path}`)].join("\n");
  }

export function formatGitStatSuffix(deps: WorkspaceRuntimeDeps, file: { additions: number; deletions: number }) {

    const stats = [file.additions > 0 ? `+${file.additions}` : "", file.deletions > 0 ? `-${file.deletions}` : ""].filter(Boolean).join(" ");
    return stats ? ` (${stats})` : "";
  }

export function createNoExecutedToolFinalInstruction(deps: WorkspaceRuntimeDeps, contextMessage: string, retryBudgetExhausted) {

    const hasError = /\bTOOL\s+\d+\s+\[error\]:/i.test(contextMessage);
    const hasEditFailure = /\bedit_file\b/i.test(contextMessage);

    return [
      retryBudgetExhausted
        ? "A recoverable local edit/write failure still could not be completed within the retry budget."
        : "",
      hasError
        ? "At least one requested tool call failed before any successful tool result was produced."
        : "Every requested tool call in the last pass was skipped, blocked, or paused before any successful tool result was produced.",
      hasEditFailure
        ? "If this was a malformed or mismatched edit, state that no file was changed; do not present replacement code as if it was applied."
        : "",
      retryBudgetExhausted
        ? "Do not request more tools in this final synthesis pass because the bounded recovery loop has already been used."
        : "Do not request more tools in this final synthesis pass because the remaining blocker is not recoverable by changing tool arguments.",
      "Do not paste raw tool output, tool-progress blocks, stack traces, adaptation recommendations, or tool-loop wording.",
      "Do not claim success for an edit, command, file read, or web search unless the tool result says it completed.",
      "Explain the blocker in one concise user-facing sentence and give the best next step from the available evidence.",
    ].filter(Boolean).join(" ");
  }

export function createNoExecutedToolFinalAnswer(deps: WorkspaceRuntimeDeps, contextMessage: string) {
  const { extractFirstUnsuccessfulToolSection, summarizeUnsuccessfulToolSection } = deps;

    const unsuccessfulSection = extractFirstUnsuccessfulToolSection(contextMessage);

    if (!unsuccessfulSection) {
      return "I could not complete that tool action.";
    }

    return [
      "I could not complete that tool action.",
      summarizeUnsuccessfulToolSection(unsuccessfulSection),
    ].filter(Boolean).join("\n\n");
  }

export function extractFirstUnsuccessfulToolSection(deps: WorkspaceRuntimeDeps, contextMessage: string) {

    const match = contextMessage.match(/\n?TOOL\s+\d+\s+\[(?:skipped|error|waiting_approval)\]:[^\n]*(?:\n[\s\S]*?)(?=\nTOOL\s+\d+(?:\s+\[[^\]]+\])?:|\nAUTO SYNTAX CHECK\b|$)/i);

    if (!match) {
      return "";
    }

    return match[0].trim();
  }

export function summarizeUnsuccessfulToolSection(deps: WorkspaceRuntimeDeps, section: string) {
  const { stripToolAdaptationRecommendation, stripToolSectionHeader } = deps;

    const body = stripToolSectionHeader(stripToolAdaptationRecommendation(section));
    const normalized = body.replace(/\s+/g, " ").trim();

    if (!normalized) {
      return "";
    }

    if (/edit_file needs old_text\/new_text/i.test(normalized)) {
      return "The edit request was malformed: `edit_file` needs `old_text`/`new_text`, `start_line`/`end_line`/`content`, `insert_at_line`/`content`, or `start_char`/`end_char`/`content`.";
    }

    if (/\b(?:blocked|permission|approval|workspace roots?|read-only|outside the enabled workspace)\b/i.test(normalized)) {
      return normalized.slice(0, 500);
    }

    return normalized.slice(0, 500);
  }

export function stripToolSectionHeader(deps: WorkspaceRuntimeDeps, section: string) {

    return section.replace(/^\s*TOOL\s+\d+\s+\[(?:skipped|error|waiting_approval)\]:[^\n]*\n?/i, "").trim();
  }

export function stripToolAdaptationRecommendation(deps: WorkspaceRuntimeDeps, value: string) {

    const index = value.toLowerCase().indexOf("adaptation recommendation");
    if (index === -1) {
      return value.trim();
    }

    return value.slice(0, index).replace(/[^\w`"'./\\:()[\]{}]+$/g, "").trim();
  }

export function appendAutoCompactionContinuation(deps: WorkspaceRuntimeDeps, messages: ChatMessage[], prompt: string, executedToolCalls: number) {
  const { createMessage, isAutoCompactionContinuationMessage } = deps;

    const lastMessage = messages[messages.length - 1];

    if (lastMessage && isAutoCompactionContinuationMessage(lastMessage)) {
      return [
        ...messages.slice(0, -1).filter((message) => !isAutoCompactionContinuationMessage(message)),
        lastMessage,
      ];
    }
    const messagesWithoutStaleContinuation = messages.filter((message) => !isAutoCompactionContinuationMessage(message));

    return [
      ...messagesWithoutStaleContinuation,
      createMessage(
        "user",
        [
          "AUTO COMPACTION CONTINUATION",
          `Original user request: ${prompt}`,
          executedToolCalls > 0 ? `Completed tool calls so far: ${executedToolCalls}.` : "",
          "The app compacted older context to stay inside the provider context window.",
          "Continue the same response from the newest preserved chat turn, tool result, or planning state above. Do not restart, repeat old analysis, or ask the user to resend context.",
          "If a file edit, write, or command just completed, treat it as already completed and continue from that exact state.",
        ]
          .filter(Boolean)
          .join("\n\n"),
      ),
    ];
  }

export function isAutoCompactionContinuationMessage(deps: WorkspaceRuntimeDeps, message: ChatMessage) {

    return message.role === "user" && message.content.includes("AUTO COMPACTION CONTINUATION");
  }
