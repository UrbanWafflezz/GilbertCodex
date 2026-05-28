import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, LoaderCircle } from "lucide-react";
import { AssistantRunCard, hasAssistantRunDetails } from "./AssistantRunCard";
import { MarkdownMessage } from "./MarkdownMessage";
import type { AgentApprovalDecision } from "../../types/agentRun";
import type { ChatMessage, ChatProgressItem, ChatToolCall } from "../../types/chat";

export interface AssistantActivitySnapshot {
  live: boolean;
  progressItems: ChatProgressItem[];
  toolCalls: ChatToolCall[];
}

interface AssistantWorkTraceProps {
  activitySnapshot: AssistantActivitySnapshot | null;
  createdAt?: string;
  message?: ChatMessage;
  onResolveToolApproval?: (messageId: string, approvalId: string, decision: AgentApprovalDecision) => void | Promise<void>;
  responseStarted?: boolean;
}

export function AssistantWorkTrace({ activitySnapshot, createdAt, message, onResolveToolApproval, responseStarted = false }: AssistantWorkTraceProps) {
  const visibleReasoning = normalizeVisibleReasoning(message?.reasoning);
  const hasVisibleReasoning = Boolean(visibleReasoning);
  const live = hasLiveAssistantWork(message, activitySnapshot);
  const detailsPanelId = useId();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const hasRunDetails = Boolean(message && hasAssistantRunDetails(message, responseStarted));
  const hasWorkDetails = hasVisibleReasoning || hasRunDetails;
  const [expanded, setExpanded] = useState(() => Boolean(!responseStarted && (live || hasVisibleReasoning)));
  const hadWorkDetailsRef = useRef(hasWorkDetails);
  const responseStartedRef = useRef(responseStarted);
  const timing = useMemo(() => createAssistantWorkTiming(message, createdAt, live, nowMs), [createdAt, live, message, nowMs]);

  useEffect(() => {
    if (!live) {
      return;
    }

    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [live]);

  useEffect(() => {
    if (hasWorkDetails && !hadWorkDetailsRef.current) {
      setExpanded(!responseStarted);
    }

    hadWorkDetailsRef.current = hasWorkDetails;
  }, [hasWorkDetails, responseStarted]);

  useEffect(() => {
    const responseStartedChanged = responseStarted !== responseStartedRef.current;

    if (responseStartedChanged && responseStarted) {
      setExpanded(false);
    } else if (responseStartedChanged && !responseStarted && (live || hasVisibleReasoning)) {
      setExpanded(true);
    }

    responseStartedRef.current = responseStarted;
  }, [hasVisibleReasoning, live, responseStarted]);

  if (!timing.canRender && !hasWorkDetails) {
    return null;
  }

  const Icon = live ? LoaderCircle : CheckCircle2;
  const label = timing.canRender ? timing.label : live ? "Working" : "Worked";

  return (
    <section
      className="assistant-thinking-surface"
      data-live={live}
      data-expanded={expanded && hasWorkDetails ? "true" : undefined}
      data-has-details={hasWorkDetails}
      data-has-reasoning={hasVisibleReasoning}
      aria-label="Assistant work"
    >
      <div className="assistant-work-timer" data-live={live ? "true" : undefined}>
        <button
          className="assistant-work-timer-row"
          type="button"
          aria-controls={hasWorkDetails ? detailsPanelId : undefined}
          aria-expanded={hasWorkDetails ? expanded : undefined}
          disabled={!hasWorkDetails}
          onClick={() => {
            if (hasWorkDetails) {
              setExpanded((current) => !current);
            }
          }}
        >
          <Icon className="assistant-work-timer-icon" size={15} aria-hidden="true" />
          <span className="assistant-work-timer-label">
            <strong role="status" aria-live={live ? "polite" : "off"}>{label}</strong>
          </span>
          {hasWorkDetails ? <ChevronDown className="assistant-work-timer-chevron" size={14} aria-hidden="true" /> : null}
        </button>
      </div>
      {hasWorkDetails && expanded ? (
        <div className="assistant-thinking-panel" id={detailsPanelId} aria-label="Assistant work details">
          {hasVisibleReasoning ? (
            <div className="assistant-reasoning-block" aria-label="Provider reasoning summary">
              <MarkdownMessage content={visibleReasoning} />
            </div>
          ) : null}
          {hasRunDetails && message ? (
            <AssistantRunCard
              embedded
              message={message}
              onResolveToolApproval={onResolveToolApproval}
              responseStarted={responseStarted}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function createAssistantActivitySnapshot(message: ChatMessage, _options: { responseStarted?: boolean } = {}): AssistantActivitySnapshot | null {
  const toolCalls = message.toolCalls ?? [];
  const progressItems = message.progress ?? [];
  const live = hasLiveAssistantWork(message);
  const hasActivity = live || Boolean(
    message.agentRunId ||
      message.agentRunStatus ||
      toolCalls.length ||
      progressItems.length ||
      message.webSearch?.searchedAt ||
      message.webSearch?.status ||
      typeof message.webSearch?.resultCount === "number",
  );

  return hasActivity ? { live, progressItems, toolCalls } : null;
}

function hasLiveAssistantWork(message: ChatMessage | undefined, activitySnapshot?: AssistantActivitySnapshot | null) {
  if (!message) {
    return Boolean(activitySnapshot?.live);
  }

  if (isAssistantWorkFinished(message)) {
    return false;
  }

  return Boolean(
    activitySnapshot?.live ||
      message.isStreaming ||
      message.agentRunStatus === "running" ||
      message.toolCalls?.some((toolCall) => toolCall.status === "active") ||
      message.progress?.some((progress) => progress.status === "active" || progress.status === "pending") ||
      message.webSearch?.status === "active",
  );
}

function isAssistantWorkFinished(message: ChatMessage) {
  return Boolean(
    message.isStreaming === false ||
      message.streamTiming?.completedAt ||
      message.agentRunStatus === "completed" ||
      message.agentRunStatus === "failed" ||
      message.agentRunStatus === "cancelled",
  );
}

function createAssistantWorkTiming(message: ChatMessage | undefined, createdAt: string | undefined, live: boolean, nowMs: number) {
  const startedAt = readTimeMs(message?.streamTiming?.requestStartedAt ?? createdAt ?? message?.createdAt);
  const completedAt = live
    ? nowMs
    : readTimeMs(message?.streamTiming?.completedAt) ?? (startedAt && typeof message?.streamTiming?.totalMs === "number" ? startedAt + message.streamTiming.totalMs : undefined);

  if (!startedAt) {
    return {
      canRender: live,
      label: live ? "Working" : "Worked",
    };
  }

  if (!completedAt) {
    return {
      canRender: live,
      label: live ? "Working" : "Worked",
    };
  }

  return {
    canRender: true,
    label: `${live ? "Working for" : "Worked for"} ${formatWorkDuration(Math.max(0, completedAt - startedAt))}`,
  };
}

function readTimeMs(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const time = Date.parse(value);
  return Number.isFinite(time) ? time : undefined;
}

function formatWorkDuration(durationMs: number) {
  const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }

  return `${seconds}s`;
}

function normalizeVisibleReasoning(value: string | undefined) {
  if (!value) {
    return "";
  }

  return value.replace(/\r\n/g, "\n").trim();
}
