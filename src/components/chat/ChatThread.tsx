import { Fragment, memo, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Check, ChevronDown, ChevronRight, ExternalLink, Globe2, Hash, LoaderCircle, X } from "lucide-react";
import { AssistantWorkTrace, createAssistantActivitySnapshot } from "./AssistantActivityIndicator";
import { MarkdownMessage } from "./MarkdownMessage";
import { MessageArtifacts, MessageAttachments } from "./MessageAttachments";
import { MessageActions } from "./MessageActions";
import { MessageBlock } from "./MessageBlock";
import { PlanReviewCard } from "./PlanReviewCard";
import { isInterruptedAssistantMessage } from "../../app/chatRuntime";
import { extractInternalReasoningTags } from "../../lib/internalReasoningTags";
import { scheduleIdleTask } from "../../lib/idleTask";
import { getSavedPlanContent, isPlanExecutionContent } from "../../lib/planReview";
import { mergeVisibleReasoningSummaries } from "../../lib/reasoningSummary";
import { stripVisibleToolProtocol } from "../../lib/visibleToolProtocol";
import type { AppInfo } from "../../types/app";
import type { AgentApprovalDecision } from "../../types/agentRun";
import type { ChatContextCompaction, ChatMessage, ChatMessageSource, ChatResearchReference, ChatSource, ChatSummary } from "../../types/chat";

const INTERNAL_ASSISTANT_STATUS_MESSAGES = new Set([
  "Reading tool results...",
  "Using agent tools...",
  "Writing final answer from local tool results...",
]);

const THREAD_BOTTOM_THRESHOLD_PX = 96;
const INITIAL_THREAD_RENDER_MESSAGE_COUNT = 40;
const THREAD_HISTORY_RENDER_INCREMENT = 80;

interface ThreadScrollMetrics {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
}

interface ThreadScrollEdgeState {
  atBottom: boolean;
  atTop: boolean;
}

const INITIAL_THREAD_SCROLL_EDGE_STATE: ThreadScrollEdgeState = {
  atBottom: true,
  atTop: true,
};

interface ChatThreadProps {
  active?: boolean;
  appInfo: AppInfo;
  chat: ChatSummary;
  chats: ChatSummary[];
  hasApiKey: boolean;
  loading?: boolean;
  onForkFromMessage?: (messageId: string) => void | Promise<void>;
  onMessageFeedback?: (messageId: string, feedback: ChatMessage["feedback"]) => void;
  onOpenPlanReview?: (messageId: string) => void;
  onEditUserMessage?: (messageId: string, content: string) => void | Promise<void>;
  onRequestPlanRevision?: (messageId: string, feedback: string) => void | Promise<void>;
  onRegenerateResponse?: (messageId: string) => void | Promise<void>;
  onResolveToolApproval?: (messageId: string, approvalId: string, decision: AgentApprovalDecision) => void | Promise<void>;
  onSelectChat?: (chatId: string) => void;
}

function ChatThreadComponent({
  active = true,
  appInfo,
  chat,
  chats,
  hasApiKey,
  loading = false,
  onEditUserMessage,
  onForkFromMessage,
  onMessageFeedback,
  onOpenPlanReview,
  onRequestPlanRevision,
  onRegenerateResponse,
  onResolveToolApproval,
  onSelectChat,
}: ChatThreadProps) {
  const threadRef = useRef<HTMLDivElement>(null);
  const threadContentRef = useRef<HTMLDivElement>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const scrollFollowupFrameRef = useRef<number | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const lastThreadScrollTopRef = useRef(0);
  const latestUserMessageKeyRef = useRef<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [historyRenderCounts, setHistoryRenderCounts] = useState<ReadonlyMap<string, number>>(
    () => new Map([[chat.id, getInitialHistoryRenderCount(chat.messages.length)]]),
  );
  const [threadScrollEdges, setThreadScrollEdges] = useState<ThreadScrollEdgeState>(INITIAL_THREAD_SCROLL_EDGE_STATE);
  const latestUserMessageKey = getLatestUserMessageKey(chat);
  const scrollAnchorMessage = getScrollAnchorMessage(chat);
  const renderedMessageCount = Math.min(
    chat.messages.length,
    historyRenderCounts.get(chat.id) ?? getInitialHistoryRenderCount(chat.messages.length),
  );
  const historyHydrated = renderedMessageCount >= chat.messages.length;
  const visibleMessageOffset = Math.max(0, chat.messages.length - renderedMessageCount);
  const visibleMessages = useMemo(
    () => visibleMessageOffset === 0 ? chat.messages : chat.messages.slice(visibleMessageOffset),
    [chat.messages, visibleMessageOffset],
  );
  const regenerableMessageIds = useMemo(() => getRegenerableMessageIds(chat.messages), [chat.messages]);
  const streamMarker = scrollAnchorMessage
    ? `${chat.messages.length}:${scrollAnchorMessage.id}:${scrollAnchorMessage.content.length}:${createMessageActivityMarker(scrollAnchorMessage)}:${scrollAnchorMessage.isStreaming ? "1" : "0"}`
    : `empty:${chat.messages.length}`;

  useEffect(() => {
    return () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }

      if (scrollFollowupFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFollowupFrameRef.current);
      }

    };
  }, []);

  useEffect(() => {
    if (!active) {
      return;
    }

    const content = threadContentRef.current;

    if (!content || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      if (!shouldStickToBottomRef.current) {
        updateThreadBottomState();
        return;
      }

      scrollToThreadBottom();
    });

    observer.observe(content);

    return () => observer.disconnect();
  }, [active, chat.id, historyHydrated]);

  useEffect(() => {
    if (!active) {
      return;
    }

    latestUserMessageKeyRef.current = null;
    lastThreadScrollTopRef.current = 0;
    setThreadScrollEdges(INITIAL_THREAD_SCROLL_EDGE_STATE);
    setThreadBottomState(true);
    scrollToThreadBottom();
  }, [active, chat.id]);

  useEffect(() => {
    if (!active) {
      return;
    }

    ensureHistoryRenderCount(chat.id, getInitialHistoryRenderCount(chat.messages.length));
  }, [active, chat.id, chat.messages.length]);

  useEffect(() => {
    if (!active || historyHydrated) {
      return;
    }

    return scheduleIdleTask(() => {
      increaseRenderedHistory(chat.id, THREAD_HISTORY_RENDER_INCREMENT);
    }, 1_800);
  }, [active, chat.id, historyHydrated, renderedMessageCount]);

  useEffect(() => {
    if (!active) {
      return;
    }

    updateThreadScrollEdges();
  }, [active, chat.id, historyHydrated, renderedMessageCount]);

  useEffect(() => {
    if (!active || !shouldStickToBottomRef.current) {
      return;
    }

    scrollToThreadBottom();
  }, [active, chat.id, renderedMessageCount]);

  useEffect(() => {
    if (!active) {
      return;
    }

    if (latestUserMessageKey === latestUserMessageKeyRef.current) {
      return;
    }

    latestUserMessageKeyRef.current = latestUserMessageKey;

    if (!latestUserMessageKey) {
      return;
    }

    shouldStickToBottomRef.current = true;
    setThreadBottomState(true);
    scrollToThreadBottom();
  }, [active, latestUserMessageKey]);

  useEffect(() => {
    if (!active) {
      return;
    }

    if (!shouldStickToBottomRef.current) {
      return;
    }

    scrollToThreadBottom();
  }, [active, streamMarker]);

  useEffect(() => {
    if (!editingMessageId) {
      return;
    }

    const editableMessageStillExists = chat.messages.some((message) => message.id === editingMessageId && message.role === "user" && message.status !== "queued");

    if (!editableMessageStillExists) {
      setEditingMessageId(null);
      setEditingContent("");
    }
  }, [chat.id, chat.messages, editingMessageId]);

  function scrollToThreadBottom() {
    if (scrollFrameRef.current !== null) {
      return;
    }

    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;

      if (!shouldStickToBottomRef.current) {
        return;
      }

      flushScrollToThreadBottom();
      scheduleThreadBottomFollowup();
    });
  }

  function scheduleThreadBottomFollowup() {
    if (scrollFollowupFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFollowupFrameRef.current);
    }

    scrollFollowupFrameRef.current = window.requestAnimationFrame(() => {
      scrollFollowupFrameRef.current = null;

      if (shouldStickToBottomRef.current) {
        flushScrollToThreadBottom();
      }
    });
  }

  function flushScrollToThreadBottom() {
    const thread = threadRef.current;

    if (!thread) {
      return;
    }

    const nextScrollTop = Math.max(0, thread.scrollHeight - thread.clientHeight);

    if (Math.abs(thread.scrollTop - nextScrollTop) > 1) {
      thread.scrollTop = nextScrollTop;
    }

    lastThreadScrollTopRef.current = nextScrollTop;
    updateThreadBottomState(thread);
  }

  function handleThreadScroll() {
    if (!active) {
      return;
    }

    const thread = threadRef.current;

    if (!thread) {
      return;
    }

    const currentScrollTop = thread.scrollTop;
    const scrollingUp = currentScrollTop < lastThreadScrollTopRef.current - 1;
    if (scrollingUp && !historyHydrated && currentScrollTop < 260) {
      increaseRenderedHistory(chat.id, THREAD_HISTORY_RENDER_INCREMENT * 2);
    }
    const atBottom = isThreadNearBottom(thread);
    lastThreadScrollTopRef.current = currentScrollTop;
    shouldStickToBottomRef.current = atBottom;
    updateThreadScrollEdges(thread);

    if (!atBottom) {
      cancelPendingThreadBottomScroll();
    }
  }

  function setThreadBottomState(atBottom: boolean) {
    shouldStickToBottomRef.current = atBottom;
  }

  function updateThreadBottomState(currentThread = threadRef.current) {
    const thread = currentThread;

    if (!thread) {
      return;
    }

    lastThreadScrollTopRef.current = thread.scrollTop;
    setThreadBottomState(isThreadNearBottom(thread));
    updateThreadScrollEdges(thread);
  }

  function updateThreadScrollEdges(currentThread = threadRef.current) {
    const thread = currentThread;

    if (!thread) {
      return;
    }

    const nextEdges = getThreadScrollEdgeState(thread, historyHydrated);
    setThreadScrollEdges((currentEdges) =>
      currentEdges.atTop === nextEdges.atTop && currentEdges.atBottom === nextEdges.atBottom ? currentEdges : nextEdges,
    );
  }

  function cancelPendingThreadBottomScroll() {
    if (scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = null;
    }

    if (scrollFollowupFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFollowupFrameRef.current);
      scrollFollowupFrameRef.current = null;
    }
  }

  function ensureHistoryRenderCount(chatId: string, minimumCount: number) {
    setHistoryRenderCounts((currentCounts) => {
      if ((currentCounts.get(chatId) ?? 0) >= minimumCount) {
        return currentCounts;
      }

      const nextCounts = new Map(currentCounts);
      nextCounts.set(chatId, minimumCount);
      return nextCounts;
    });
  }

  function increaseRenderedHistory(chatId: string, increment: number) {
    setHistoryRenderCounts((currentCounts) => {
      const currentCount = currentCounts.get(chatId) ?? getInitialHistoryRenderCount(chat.messages.length);
      const nextCount = Math.min(chat.messages.length, currentCount + increment);

      if (nextCount <= currentCount) {
        return currentCounts;
      }

      const nextCounts = new Map(currentCounts);
      nextCounts.set(chatId, nextCount);
      return nextCounts;
    });
  }

  function handleStartEditMessage(messageId: string) {
    const message = chat.messages.find((candidate) => candidate.id === messageId && candidate.role === "user" && candidate.status !== "queued");

    if (!message || !onEditUserMessage) {
      return;
    }

    setEditingMessageId(message.id);
    setEditingContent(message.content);
  }

  function handleCancelEditMessage() {
    setEditingMessageId(null);
    setEditingContent("");
  }

  function handleSubmitEditMessage(message: ChatMessage) {
    if (!onEditUserMessage || message.role !== "user") {
      return;
    }

    const hasAttachments = Boolean(message.attachments?.length);

    if (!editingContent.trim() && !hasAttachments) {
      return;
    }

    const nextContent = editingContent;
    setEditingMessageId(null);
    setEditingContent("");
    void onEditUserMessage(message.id, nextContent);
  }

  if (loading || chat.messagesLoaded === false) {
    return (
      <div className="chat-thread-shell" data-scroll-bottom="true" data-scroll-top="true">
        <div ref={threadRef} className="chat-thread" onScroll={handleThreadScroll}>
          <div ref={threadContentRef} className="chat-thread-content">
            <div className="chat-loading-state" role="status" aria-live="polite">
              <LoaderCircle size={34} aria-hidden="true" />
              <span className="sr-only">Loading chat</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (chat.messages.length === 0) {
    return (
      <div className="chat-thread-shell" data-scroll-bottom="true" data-scroll-top="true">
        <div ref={threadRef} className="chat-thread" onScroll={handleThreadScroll}>
          <div ref={threadContentRef} className="chat-thread-content">
            <MessageBlock role="assistant">
              <MarkdownMessage content={hasApiKey ? `${appInfo.name} is ready.` : "Add a provider API key in Settings, then send a message to start testing."} />
            </MessageBlock>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-thread-shell" data-scroll-bottom={threadScrollEdges.atBottom ? "true" : "false"} data-scroll-top={threadScrollEdges.atTop ? "true" : "false"}>
      <div ref={threadRef} className="chat-thread" onScroll={handleThreadScroll}>
        <div ref={threadContentRef} className="chat-thread-content">
          {visibleMessages.map((message, visibleMessageIndex) => {
            if (message.status === "queued") {
              return null;
            }

            const messageIndex = visibleMessageOffset + visibleMessageIndex;

            return (
              <ChatMessageRow
                key={message.id}
                canRegenerate={regenerableMessageIds.has(message.id)}
                chats={chats}
                editingContent={editingContent}
                editingMessageId={editingMessageId}
                message={message}
                messageIndex={messageIndex}
                onCancelEditMessage={handleCancelEditMessage}
                onEditContentChange={setEditingContent}
                onEditUserMessage={onEditUserMessage}
                onForkFromMessage={onForkFromMessage}
                onMessageFeedback={onMessageFeedback}
                onOpenPlanReview={onOpenPlanReview}
                onRegenerateResponse={onRegenerateResponse}
                onRequestPlanRevision={onRequestPlanRevision}
                onResolveToolApproval={onResolveToolApproval}
                onSelectChat={onSelectChat}
                onStartEditMessage={handleStartEditMessage}
                onSubmitEditMessage={handleSubmitEditMessage}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

export const ChatThread = memo(ChatThreadComponent, areChatThreadPropsEqual);

function areChatThreadPropsEqual(previous: ChatThreadProps, next: ChatThreadProps) {
  return (
    previous.active === next.active &&
    previous.appInfo.name === next.appInfo.name &&
    previous.chat === next.chat &&
    previous.chats === next.chats &&
    previous.hasApiKey === next.hasApiKey &&
    previous.loading === next.loading
  );
}

interface ChatMessageRowProps {
  canRegenerate: boolean;
  chats: ChatSummary[];
  editingContent: string;
  editingMessageId: string | null;
  message: ChatMessage;
  messageIndex: number;
  onCancelEditMessage: () => void;
  onEditContentChange: (value: string) => void;
  onEditUserMessage?: (messageId: string, content: string) => void | Promise<void>;
  onForkFromMessage?: (messageId: string) => void | Promise<void>;
  onMessageFeedback?: (messageId: string, feedback: ChatMessage["feedback"]) => void;
  onOpenPlanReview?: (messageId: string) => void;
  onRegenerateResponse?: (messageId: string) => void | Promise<void>;
  onRequestPlanRevision?: (messageId: string, feedback: string) => void | Promise<void>;
  onResolveToolApproval?: (messageId: string, approvalId: string, decision: AgentApprovalDecision) => void | Promise<void>;
  onSelectChat?: (chatId: string) => void;
  onStartEditMessage: (messageId: string) => void;
  onSubmitEditMessage: (message: ChatMessage) => void;
}

const ChatMessageRow = memo(function ChatMessageRow({
  canRegenerate,
  chats,
  editingContent,
  editingMessageId,
  message,
  onCancelEditMessage,
  onEditContentChange,
  onEditUserMessage,
  onForkFromMessage,
  onMessageFeedback,
  onOpenPlanReview,
  onRegenerateResponse,
  onRequestPlanRevision,
  onResolveToolApproval,
  onSelectChat,
  onStartEditMessage,
  onSubmitEditMessage,
}: ChatMessageRowProps) {
  const displayMessage = message.role === "assistant" ? separateDisplayThinking(message.content, Boolean(message.isStreaming)) : { content: message.content, reasoning: "" };
  const hasVisibleContent = displayMessage.content.trim().length > 0;
  const messageSources = message.role === "assistant" ? getMessageSources(message, displayMessage.content) : [];
  const showMessageSources = message.role === "assistant" && !message.isStreaming && hasVisibleContent && messageSources.length > 0;
  const hasVisibleAttachment = Boolean(message.attachments?.length);
  const hasVisibleArtifact = Boolean(message.artifacts?.length);
  const showPlanReview = shouldShowPlanReviewCard(message);
  const savedPlanContent = message.role === "assistant" ? getSavedPlanContent(message) : "";
  const showPlanExecutionContent = message.role === "assistant" && showPlanReview && isPlanExecutionContent(message, displayMessage.content);
  const showResponseRecoveryActions = message.role === "assistant" && !message.isStreaming && isInterruptedAssistantMessage(message) && canRegenerate;
  const isEditingUserMessage = message.role === "user" && editingMessageId === message.id;
  const activitySnapshot = useMemo(
    () => message.role === "assistant"
      ? createAssistantActivitySnapshot(message, { responseStarted: hasVisibleContent })
      : null,
    [
      hasVisibleContent,
      message.artifacts,
      message.isStreaming,
      message.planning,
      message.progress,
      message.reasoning,
      message.role,
      message.status,
      message.toolCalls,
      message.webSearch,
    ],
  );
  const hasRunActivity = message.role === "assistant" && hasAssistantRunActivity(message);
  const displayReasoning = message.role === "assistant" ? mergeDisplayReasoning(message.reasoning, displayMessage.reasoning) : "";
  const activityMessage = displayReasoning && message.role === "assistant" && displayReasoning !== message.reasoning
    ? { ...message, reasoning: displayReasoning }
    : message;
  const hasVisibleReasoning = message.role === "assistant" && Boolean(displayReasoning);
  const showAssistantWorkTrace = message.role === "assistant" && (activitySnapshot || hasRunActivity || hasVisibleReasoning || Boolean(message.isStreaming && !hasVisibleContent));
  const visibleContextCompactions = message.role === "assistant" ? getVisibleContextCompactions(message.contextCompactions) : [];
  const showMessageBlock = message.role !== "assistant" || hasVisibleContent || hasVisibleAttachment || hasVisibleArtifact || showPlanReview || showAssistantWorkTrace;

  if (message.role === "assistant" && !showMessageBlock && visibleContextCompactions.length === 0) {
    return null;
  }

  const actionMessage = message.role === "assistant" ? { ...message, content: displayMessage.content } : message;

  return (
    <Fragment>
      {visibleContextCompactions.map((compaction) => (
        <ContextCompactionDivider key={`${message.id}-${compaction.compactedAt}`} compaction={compaction} />
      ))}
      {showMessageBlock ? (
        <MessageBlock role={message.role} status={message.status} isStreaming={message.isStreaming}>
          <MessageAttachments attachments={message.attachments} />
          <MessageArtifacts artifacts={message.artifacts} />
          {message.role === "user" && message.source?.kind === "discord" ? <DiscordMessageSource source={message.source} /> : null}
          {message.role === "user" ? <MessageResearchReferences references={message.researchReferences} chats={chats} onSelectChat={onSelectChat} /> : null}
          {showAssistantWorkTrace ? (
            <AssistantWorkTrace
              activitySnapshot={activitySnapshot}
              createdAt={message.createdAt}
              message={activityMessage}
              onResolveToolApproval={onResolveToolApproval}
              responseStarted={hasVisibleContent}
            />
          ) : null}
          {isEditingUserMessage ? (
            <MessageEditForm
              hasAttachments={hasVisibleAttachment}
              value={editingContent}
              onCancel={onCancelEditMessage}
              onChange={onEditContentChange}
              onSubmit={() => onSubmitEditMessage(message)}
            />
          ) : showPlanReview ? (
            <>
              <PlanReviewCard
                content={savedPlanContent || displayMessage.content}
                isStreaming={message.isStreaming}
                message={actionMessage}
                onOpenFullPlan={onOpenPlanReview}
                onRequestRevision={onRequestPlanRevision}
                onResolvePlanApproval={onResolveToolApproval}
              />
              {showPlanExecutionContent ? (
                <div className="plan-execution-response">
                  <MarkdownMessage content={displayMessage.content} isStreaming={message.isStreaming} />
                </div>
              ) : null}
            </>
          ) : displayMessage.content.trim() ? (
            <MarkdownMessage content={displayMessage.content} isStreaming={message.isStreaming} />
          ) : null}
          {showMessageSources ? <MessageSourcesRow sources={messageSources} /> : null}
          {isEditingUserMessage || message.isStreaming ? null : (
            <MessageActions
              message={actionMessage}
              onEditMessage={onEditUserMessage ? onStartEditMessage : undefined}
              onForkFromMessage={onForkFromMessage}
              onMessageFeedback={onMessageFeedback}
              onRegenerateResponse={!showResponseRecoveryActions && canRegenerate ? onRegenerateResponse : undefined}
            />
          )}
          {showResponseRecoveryActions ? <ResponseRecoveryActions messageId={message.id} onRegenerateResponse={onRegenerateResponse} /> : null}
        </MessageBlock>
      ) : null}
    </Fragment>
  );
}, areChatMessageRowPropsEqual);

function areChatMessageRowPropsEqual(previous: ChatMessageRowProps, next: ChatMessageRowProps) {
  const wasEditing = previous.editingMessageId === previous.message.id;
  const isEditing = next.editingMessageId === next.message.id;
  const needsChatReferences = Boolean(previous.message.role === "user" && previous.message.researchReferences?.length);

  return (
    previous.canRegenerate === next.canRegenerate &&
    previous.message === next.message &&
    previous.messageIndex === next.messageIndex &&
    (!needsChatReferences || previous.chats === next.chats) &&
    Boolean(previous.onEditUserMessage) === Boolean(next.onEditUserMessage) &&
    Boolean(previous.onForkFromMessage) === Boolean(next.onForkFromMessage) &&
    Boolean(previous.onMessageFeedback) === Boolean(next.onMessageFeedback) &&
    Boolean(previous.onOpenPlanReview) === Boolean(next.onOpenPlanReview) &&
    Boolean(previous.onRegenerateResponse) === Boolean(next.onRegenerateResponse) &&
    Boolean(previous.onRequestPlanRevision) === Boolean(next.onRequestPlanRevision) &&
    Boolean(previous.onResolveToolApproval) === Boolean(next.onResolveToolApproval) &&
    Boolean(previous.onSelectChat) === Boolean(next.onSelectChat) &&
    wasEditing === isEditing &&
    (!isEditing || previous.editingContent === next.editingContent)
  );
}

function MessageEditForm({
  hasAttachments,
  onCancel,
  onChange,
  onSubmit,
  value,
}: {
  hasAttachments: boolean;
  onCancel: () => void;
  onChange: (value: string) => void;
  onSubmit: () => void;
  value: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const canSubmit = value.trim().length > 0 || hasAttachments;

  useEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, []);

  useEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 92), 260)}px`;
  }, [value]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (canSubmit) {
      onSubmit();
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }

    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();

      if (canSubmit) {
        onSubmit();
      }
    }
  }

  return (
    <form className="message-edit-form" onSubmit={handleSubmit}>
      <textarea
        ref={textareaRef}
        className="message-edit-textarea"
        value={value}
        rows={3}
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={handleKeyDown}
      />
      <div className="message-edit-actions">
        <button className="message-edit-cancel" type="button" onClick={onCancel}>
          <X size={14} aria-hidden="true" />
          <span>Cancel</span>
        </button>
        <button className="message-edit-submit" type="submit" disabled={!canSubmit}>
          <Check size={14} aria-hidden="true" />
          <span>Send</span>
        </button>
      </div>
    </form>
  );
}

function MessageSourcesRow({ sources }: { sources: ChatSource[] }) {
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const visibleSources = getUniqueMessageSources(sources);
  const hasSources = visibleSources.length > 0;
  const inlineSources = visibleSources.slice(0, 4);
  const remainingSourceCount = visibleSources.length - inlineSources.length;

  if (!hasSources) {
    return null;
  }

  return (
    <section className="response-meta response-sources" data-has-sources={hasSources} aria-label="Sources cited in this response">
      <div className="response-sources-line">
        <span className="message-sources-title" aria-label={`${visibleSources.length} sources`}>
          <Globe2 size={13} aria-hidden="true" />
          <span>Sources</span>
        </span>
        <div className="message-sources-preview">
          {inlineSources.map((source) => (
            <a className="message-source-chip" href={source.url} key={source.id ?? source.url} rel="noreferrer" target="_blank" title={cleanSourceTitle(source.title, source.url)}>
              <span>{formatMessageSourceHost(source.url)}</span>
            </a>
          ))}
          <button className="message-sources-toggle" type="button" aria-expanded={sourcesExpanded} onClick={() => setSourcesExpanded((current) => !current)}>
            <span>{sourcesExpanded ? "Hide" : remainingSourceCount > 0 ? `+${remainingSourceCount}` : "Details"}</span>
            {sourcesExpanded ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
          </button>
        </div>
      </div>
      {sourcesExpanded ? (
        <div className="message-sources-list">
          {visibleSources.map((source, index) => (
            <a className="message-source-link" href={source.url} key={source.id ?? source.url} rel="noreferrer" target="_blank">
              <span className="message-source-index" aria-hidden="true">{index + 1}</span>
              <span>
                <strong>{cleanSourceTitle(source.title, source.url)}</strong>
                <small>{formatMessageSourceDetail(source)}</small>
              </span>
              <ExternalLink size={13} aria-hidden="true" />
            </a>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function MessageResearchReferences({
  chats,
  onSelectChat,
  references,
}: {
  chats: ChatSummary[];
  onSelectChat?: (chatId: string) => void;
  references?: ChatResearchReference[];
}) {
  if (!references?.length) {
    return null;
  }

  const visibleReferences = references.map((reference) => {
    const liveChat = chats.find((chat) => chat.id === reference.chatId && !chat.archived);

    return {
      ...reference,
      missing: !liveChat,
      project: liveChat?.project ?? reference.project,
      title: liveChat?.title ?? reference.title,
    };
  });

  return (
    <div className="message-research-references" aria-label="Attached chat notes">
      <span className="message-research-label">
        <Hash size={13} aria-hidden="true" />
        Notes
      </span>
      {visibleReferences.map((reference) => {
        const label = `${reference.title}${reference.missing ? " unavailable" : ""}`;
        const content = (
          <>
            <strong>{reference.title}</strong>
            <small>{reference.missing ? "Deleted chat" : reference.project}</small>
          </>
        );

        return onSelectChat && !reference.missing ? (
          <button key={reference.chatId} type="button" className="message-research-chip" aria-label={`Open referenced chat ${label}`} onClick={() => onSelectChat(reference.chatId)}>
            {content}
          </button>
        ) : (
          <span key={reference.chatId} className="message-research-chip" data-missing={reference.missing}>
            {content}
          </span>
        );
      })}
    </div>
  );
}

function getMessageSources(message: ChatMessage, visibleContent: string) {
  return getUniqueMessageSources([...(message.sources ?? []), ...extractMessageSources(visibleContent)]);
}

function getUniqueMessageSources(sources: ChatSource[]) {
  const seenUrls = new Set<string>();
  const uniqueSources: ChatSource[] = [];

  for (const source of sources) {
    const normalizedUrl = normalizeMessageSourceUrl(source.url);

    if (!normalizedUrl || seenUrls.has(normalizedUrl)) {
      continue;
    }

    seenUrls.add(normalizedUrl);
    uniqueSources.push({ ...source, url: normalizedUrl });
  }

  return uniqueSources;
}

function extractMessageSources(content: string): ChatSource[] {
  const sources = new Map<string, ChatSource>();
  const body = stripCodeForSourceScan(content);
  const markdownLinkPattern = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi;
  const bareUrlPattern = /(^|[\s(])(https?:\/\/[^\s<>)]+)/gi;

  for (const match of body.matchAll(markdownLinkPattern)) {
    addMessageSource(sources, match[2], match[1]);
  }

  for (const match of body.matchAll(bareUrlPattern)) {
    addMessageSource(sources, match[2]);
  }

  return [...sources.values()];
}

function addMessageSource(sources: Map<string, ChatSource>, rawUrl: string, title?: string) {
  const url = normalizeMessageSourceUrl(rawUrl);

  if (!url || !isExternalMessageSourceUrl(url) || sources.has(url)) {
    return;
  }

  sources.set(url, {
    sourceType: "web",
    title: cleanSourceTitle(title, url),
    url,
  });
}

function normalizeMessageSourceUrl(rawUrl: string) {
  const trimmedUrl = rawUrl.trim().replace(/[.,;:!?]+$/g, "");

  try {
    return new URL(trimmedUrl).href;
  } catch {
    return "";
  }
}

function isExternalMessageSourceUrl(url: string) {
  try {
    const { hostname, protocol } = new URL(url);
    const host = hostname.toLowerCase();

    return (
      (protocol === "http:" || protocol === "https:") &&
      host !== "localhost" &&
      host !== "0.0.0.0" &&
      host !== "127.0.0.1" &&
      host !== "::1" &&
      !host.endsWith(".localhost")
    );
  } catch {
    return false;
  }
}

function formatMessageSourceDetail(source: ChatSource) {
  const host = formatMessageSourceHost(source.url);
  const detail = source.detail?.trim();

  if (!detail || detail === source.url || detail === host) {
    return host;
  }

  return `${host} - ${detail}`;
}

function formatMessageSourceHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Web source";
  }
}

function cleanSourceTitle(title: string | undefined, url: string) {
  const cleanedTitle = (title ?? "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return cleanedTitle || formatMessageSourceHost(url);
}

function stripCodeForSourceScan(value: string) {
  return value.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");
}

function ResponseRecoveryActions({
  messageId,
  onRegenerateResponse,
}: {
  messageId: string;
  onRegenerateResponse?: (messageId: string) => void | Promise<void>;
}) {
  return (
    <div className="response-recovery-actions">
      <button type="button" onClick={() => void onRegenerateResponse?.(messageId)}>
        Continue response
      </button>
    </div>
  );
}

function DiscordMessageSource({ source }: { source: ChatMessageSource }) {
  const title = [source.guildId ? `Guild ${source.guildId}` : "", source.channelId ? `Channel ${source.channelId}` : "", source.userId ? `User ${source.userId}` : ""].filter(Boolean).join(" | ");
  const command = source.commandName ? `/${source.commandName}` : "slash command";

  return (
    <div className="message-source-strip" title={title || "Discord"}>
      <span className="message-source-dot" aria-hidden="true" />
      <strong>Discord</strong>
      <small>
        {command}
        {source.username ? ` from ${source.username}` : ""}
      </small>
    </div>
  );
}

function shouldShowPlanReviewCard(message: ChatSummary["messages"][number]) {
  if (message.role !== "assistant" || !(message.mode === "plan" || message.planning)) {
    return false;
  }

  return Boolean(getSavedPlanContent(message) || message.approvals?.some((approval) => approval.tool === "planning_handoff"));
}

function hasAssistantRunActivity(message: ChatMessage) {
  return Boolean(
    message.agentRunId ||
      message.agentRunStatus ||
      message.toolCalls?.length ||
      message.approvals?.length ||
      message.progress?.length ||
      message.webSearch?.searchedAt ||
      message.webSearch?.status ||
      typeof message.webSearch?.resultCount === "number",
  );
}

function ContextCompactionDivider({ compaction }: { compaction: ChatContextCompaction }) {
  const detail = `${formatCompactTokenCount(compaction.beforeTokens)} -> ${formatCompactTokenCount(compaction.afterTokens)}`;
  const compactedCount = `${compaction.compactedMessageCount} older message${compaction.compactedMessageCount === 1 ? "" : "s"}`;
  const activeRequest = compaction.contextWindowTokens
    ? `${formatCompactTokenCount(compaction.afterTokens)} / ${formatCompactTokenCount(compaction.contextWindowTokens)}`
    : formatCompactTokenCount(compaction.afterTokens);

  return (
    <div className="context-compaction-divider" title={`${detail}, ${compactedCount} compacted`}>
      <span className="context-compaction-divider-content">
        <strong>Context compacted</strong>
        <small>{compactedCount}. Active request {activeRequest}.</small>
      </span>
    </div>
  );
}

function getVisibleContextCompactions(compactions: ChatContextCompaction[] | undefined) {
  if (!compactions?.length) {
    return [];
  }

  const latestByStrategy = new Map<string, ChatContextCompaction>();

  for (const compaction of compactions) {
    latestByStrategy.set(getContextCompactionStrategyKey(compaction), compaction);
  }

  return Array.from(latestByStrategy.values());
}

function getContextCompactionStrategyKey(compaction: ChatContextCompaction) {
  return `${compaction.strategy ?? "context-compaction"}:${compaction.summaryVersion ?? "unknown"}`;
}

function formatCompactTokenCount(tokens: number) {
  if (tokens >= 1000) {
    return `${Number((tokens / 1000).toFixed(tokens >= 100000 ? 0 : 1))}k`;
  }

  return String(tokens);
}

export function separateDisplayThinking(content: string, isStreaming = false) {
  // Streaming messages still get the tail-prefix guard so a half-typed `<thi`
  // never flashes into the public area. Hidden content is intentionally not
  // returned to the UI.
  const { content: visibleContent, reasoning } = extractInternalReasoningTags(content, {
    final: !isStreaming,
  });

  return {
    content: removeInternalAssistantStatusMessage(stripVisibleToolProtocol(visibleContent).trimStart()),
    reasoning,
  };
}

function removeInternalAssistantStatusMessage(content: string) {
  return INTERNAL_ASSISTANT_STATUS_MESSAGES.has(content.trim()) ? "" : content;
}

function mergeDisplayReasoning(storedReasoning: string | undefined, extractedReasoning: string | undefined) {
  return mergeVisibleReasoningSummaries(storedReasoning, extractedReasoning);
}

function getScrollAnchorMessage(chat: ChatSummary) {
  for (let index = chat.messages.length - 1; index >= 0; index -= 1) {
    const message = chat.messages[index];

    if (message?.isStreaming) {
      return message;
    }
  }

  return chat.messages[chat.messages.length - 1];
}

function getLatestUserMessageKey(chat: ChatSummary) {
  for (let index = chat.messages.length - 1; index >= 0; index -= 1) {
    const message = chat.messages[index];

    if (message?.role === "user") {
      return `${chat.id}:${message.id}`;
    }
  }

  return null;
}

export function getThreadScrollEdgeState(thread: ThreadScrollMetrics, historyHydrated: boolean): ThreadScrollEdgeState {
  return {
    atBottom: isThreadNearBottom(thread),
    atTop: historyHydrated && thread.scrollTop <= 2,
  };
}

function isThreadNearBottom(thread: ThreadScrollMetrics) {
  const distanceFromBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight;
  return distanceFromBottom <= THREAD_BOTTOM_THRESHOLD_PX;
}

function getInitialHistoryRenderCount(messageCount: number) {
  return Math.min(messageCount, INITIAL_THREAD_RENDER_MESSAGE_COUNT);
}

function createMessageActivityMarker(message: ChatMessage) {
  const workTraceMarker = (message.workTrace ?? [])
    .map((item) => {
      if (item.kind === "tool") {
        return `${item.id}:${item.kind}:${item.toolCall.status}:${item.toolCall.output?.length ?? 0}`;
      }

      return `${item.id}:${item.kind}:${item.progress.status}:${item.progress.detail?.length ?? 0}`;
    })
    .join("|");
  const progressMarker = (message.progress ?? [])
    .map((item) => `${item.id ?? item.label}:${item.status}:${item.detail?.length ?? 0}`)
    .join("|");
  const toolMarker = (message.toolCalls ?? [])
    .map((toolCall) => {
      const fileMarker = (toolCall.fileChanges ?? [])
        .map((change) => `${change.path}:${change.kind ?? "update"}:${change.additions}:${change.deletions}:${change.diffPreview?.length ?? 0}`)
        .join(",");

      return `${toolCall.id}:${toolCall.status}:${toolCall.input?.length ?? 0}:${toolCall.output?.length ?? 0}:${fileMarker}`;
    })
    .join("|");
  return `${workTraceMarker}:${progressMarker}:${toolMarker}:${message.webSearch?.status ?? ""}:${message.streamTiming?.completedAt ?? ""}`;
}

function getRegenerableMessageIds(messages: ChatMessage[]) {
  const regenerableMessageIds = new Set<string>();
  let hasPriorUserMessage = false;

  for (const message of messages) {
    if (message.role === "assistant" && !message.isStreaming && hasPriorUserMessage) {
      const pendingPlanningInput = message.planning?.inputRequest && !message.planning.inputRequest.answeredAt;

      if (!pendingPlanningInput) {
        regenerableMessageIds.add(message.id);
      }
    }

    if (message.role === "user") {
      hasPriorUserMessage = true;
    }
  }

  return regenerableMessageIds;
}
