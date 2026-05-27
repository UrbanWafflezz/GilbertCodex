import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Code2, GitBranch, Grid2X2, Image as ImageIcon, Route, Search, type LucideIcon } from "lucide-react";
import { ChatComposer } from "../components/chat/ChatComposer";
import { ChatThread } from "../components/chat/ChatThread";
import { ConversationHeader } from "../components/chat/ConversationHeader";
import { RightRail, chatHasAutoOpenRightRailAction, chatHasPlanReviewContent, chatHasRightRailContent } from "../components/inspector/RightRail";
import type { CodingSidecarTab } from "../components/coding/CodingSidecarPanel";
import type { ContextCompactionNotice, ContextWindowUsage, ModelContextWindowMap } from "../lib/contextWindow";
import { DEFAULT_PROJECT, isNoProjectName, normalizeProjectName } from "../lib/chatUtils";
import { getModelProvider } from "../lib/models";
import { scheduleIdleTask } from "../lib/idleTask";
import { useAnimatedPresence } from "../lib/useAnimatedPresence";
import type { AppInfo } from "../types/app";
import type { AgentApprovalDecision, AgentRun } from "../types/agentRun";
import type { ChatComposerDraft, ChatMessage, ChatPlanningInputAnswer, ChatSendInput, ChatSummary } from "../types/chat";
import type { LocalWorkspaceSettings } from "../types/localWorkspace";
import { WEB_SEARCH_PROVIDER_LABELS, type AppCodeReviewBehavior, type AppFollowUpBehavior, type ProviderSettings, type ThinkingSettings, type WebSearchSettings } from "../types/settings";
import type { CreateProjectOptions, ProjectGoal, ProjectSummary } from "../types/project";
import { getProjectOpenTarget, getRecommendedProjectOpenTarget, type ProjectOpenTargetId } from "../types/projectOpen";

const loadBrowserPreviewPanel = () => import("../components/browser/BrowserPreviewPanel");
const loadCodingSidecarPanel = () => import("../components/coding/CodingSidecarPanel");
const BrowserPreviewPanel = lazy(() => loadBrowserPreviewPanel().then((module) => ({ default: module.BrowserPreviewPanel })));
const CodingSidecarPanel = lazy(() => loadCodingSidecarPanel().then((module) => ({ default: module.CodingSidecarPanel })));

interface ChatPageProps {
  active?: boolean;
  agentRuns: AgentRun[];
  appInfo: AppInfo;
  browserPreviewEnabled: boolean;
  browserPreviewRequestId?: number;
  browserPreviewUrl?: string | null;
  chat: ChatSummary;
  chatLoading?: boolean;
  chats: ChatSummary[];
  codeReviewBehavior?: AppCodeReviewBehavior;
  composerDraft?: ChatComposerDraft | null;
  composerRestoreDraft?: ChatComposerDraft | null;
  composerRestoreDraftId?: string | null;
  contextWindowSource: "estimate" | "openrouter" | "provider";
  contextWindowTokens: number;
  defaultOpenTarget?: ProjectOpenTargetId;
  dictationDictionary?: string;
  dictationHoldHotkey?: string;
  dictationToggleHotkey?: string;
  followUpBehavior?: AppFollowUpBehavior;
  hasApiKey: boolean;
  isSending: boolean;
  lastContextCompaction?: ContextCompactionNotice | null;
  localWorkspace: LocalWorkspaceSettings;
  lastProviderContextUsage?: ContextWindowUsage | null;
  model: string;
  modelContextWindows: ModelContextWindowMap;
  onComposerDraftApplied?: () => void;
  onComposerDraftChange?: (chatId: string, draft: ChatComposerDraft | null) => void;
  onCreateProject: (options?: CreateProjectOptions) => void | string | null | Promise<string | null | void>;
  onLocalWorkspaceChange: (settings: LocalWorkspaceSettings) => void;
  onModelChange: (model: string, provider: ProviderSettings["provider"]) => void;
  onDeleteQueuedMessage: (messageId: string) => void;
  onHoldQueuedMessage: (messageId: string, held: boolean) => void;
  onAddAutomation: () => void;
  onArchiveChat: () => void;
  onBrowserPreviewClose?: () => void;
  onCopyChatDeeplink: () => void;
  onCopyChatMarkdown: () => void;
  onCopySessionId: () => void;
  onCopyWorkingDirectory: () => void;
  onForkChatLocal: () => void;
  onForkChatFromMessage: (messageId: string) => void;
  onForkChatWorktree: () => void | Promise<void>;
  onMessageFeedback: (messageId: string, feedback: ChatMessage["feedback"]) => void;
  onOpenChatInNewWindow: () => void | Promise<void>;
  onOpenProjectTool: (target: ProjectOpenTargetId) => void | Promise<void>;
  onOpenProjectRun: () => void;
  onOpenSideChat: () => void;
  onProjectGoalClear: () => void;
  onProjectGoalComplete: () => void;
  onProjectGoalCreate: (objective: string, options?: { input?: ChatSendInput; start?: boolean }) => void | Promise<void>;
  onProjectGoalPause: () => void;
  onProjectGoalResume: () => void;
  onProjectGoalUpdate: (objective: string) => void;
  onRenameChat: () => void;
  onSelectProject: (project: string) => void;
  onSelectChat: (chatId: string) => void;
  onEditUserMessage: (messageId: string, content: string) => void | Promise<void>;
  onRequestPlanRevision: (messageId: string, feedback: string) => void | Promise<void>;
  onRegenerateResponse: (messageId: string) => void | Promise<void>;
  onSendMessage: (input: ChatSendInput) => void | Promise<void>;
  onSteerQueuedMessage: (messageId: string, contentOverride?: string) => void;
  onStopGeneration: (messageId?: string) => void;
  onSubmitPlanningInput: (messageId: string, answers: ChatPlanningInputAnswer[]) => void | Promise<void>;
  onResolveToolApproval?: (messageId: string, approvalId: string, decision: AgentApprovalDecision) => void | Promise<void>;
  providerSettings: ProviderSettings;
  projectGoal?: ProjectGoal;
  projects: ProjectSummary[];
  queuedMessageCount?: number;
  queuedMessageDetails?: ChatMessage[];
  heldQueuedMessageIds?: string[];
  onImageGenerationChange: (enabled: boolean) => void;
  onThinkingChange: (thinking: ThinkingSettings) => void;
  onWebSearchChange: (webSearch: WebSearchSettings) => void;
  thinking: ThinkingSettings;
  webSearch: WebSearchSettings;
  onToggleTerminal: () => void;
  terminalEnabled: boolean;
  terminalOpen: boolean;
  requireCtrlEnterForLongPrompts?: boolean;
}

function ChatPageComponent({
  active = true,
  agentRuns = [],
  appInfo,
  browserPreviewEnabled,
  browserPreviewRequestId = 0,
  browserPreviewUrl,
  chat,
  chatLoading = false,
  chats,
  codeReviewBehavior = "inline",
  composerDraft,
  composerRestoreDraft,
  composerRestoreDraftId,
  contextWindowSource,
  contextWindowTokens,
  defaultOpenTarget,
  dictationDictionary = "",
  dictationHoldHotkey = "",
  dictationToggleHotkey = "",
  followUpBehavior = "queue",
  hasApiKey,
  isSending,
  lastContextCompaction,
  localWorkspace,
  lastProviderContextUsage,
  model,
  modelContextWindows,
  onComposerDraftApplied,
  onComposerDraftChange,
  onCreateProject,
  onLocalWorkspaceChange,
  onModelChange,
  onDeleteQueuedMessage,
  onHoldQueuedMessage,
  onAddAutomation,
  onArchiveChat,
  onBrowserPreviewClose,
  onCopyChatDeeplink,
  onCopyChatMarkdown,
  onCopySessionId,
  onCopyWorkingDirectory,
  onForkChatLocal,
  onForkChatFromMessage,
  onForkChatWorktree,
  onMessageFeedback,
  onOpenChatInNewWindow,
  onOpenProjectTool,
  onOpenProjectRun,
  onOpenSideChat,
  onProjectGoalClear,
  onProjectGoalComplete,
  onProjectGoalCreate,
  onProjectGoalPause,
  onProjectGoalResume,
  onProjectGoalUpdate,
  onRenameChat,
  onSelectChat,
  onSelectProject,
  onEditUserMessage,
  onRequestPlanRevision,
  onRegenerateResponse,
  onSendMessage,
  onSteerQueuedMessage,
  onStopGeneration,
  onSubmitPlanningInput,
  onResolveToolApproval,
  providerSettings,
  projectGoal,
  projects,
  queuedMessageCount = 0,
  queuedMessageDetails = [],
  heldQueuedMessageIds = [],
  onImageGenerationChange,
  onThinkingChange,
  onWebSearchChange,
  thinking,
  webSearch,
  onToggleTerminal,
  terminalEnabled,
  terminalOpen,
  requireCtrlEnterForLongPrompts = false,
}: ChatPageProps) {
  const conversationBodyRef = useRef<HTMLDivElement>(null);
  const rightRailAutoOpenedRef = useRef(false);
  const [composerHeight, setComposerHeight] = useState(152);
  const [rightRailOpen, setRightRailOpen] = useState(false);
  const [activePlanReviewMessageId, setActivePlanReviewMessageId] = useState<string | null>(null);
  const [planReviewExpanded, setPlanReviewExpanded] = useState(false);
  const [browserPreviewOpen, setBrowserPreviewOpen] = useState(false);
  const [browserPreviewExpanded, setBrowserPreviewExpanded] = useState(false);
  const [browserPreviewInitialUrl, setBrowserPreviewInitialUrl] = useState<string | null>(null);
  const [browserPreviewResizing, setBrowserPreviewResizing] = useState(false);
  const [browserPreviewWidth, setBrowserPreviewWidth] = useState(DEFAULT_BROWSER_PREVIEW_WIDTH);
  const [codingSidecarOpen, setCodingSidecarOpen] = useState(false);
  const [codingSidecarExpanded, setCodingSidecarExpanded] = useState(false);
  const [codingSidecarResizing, setCodingSidecarResizing] = useState(false);
  const [codingSidecarWidth, setCodingSidecarWidth] = useState(DEFAULT_CODING_SIDECAR_WIDTH);
  const [codingSidecarTab, setCodingSidecarTab] = useState<CodingSidecarTab>("codebase");
  const rightRailNeedsAction = useMemo(() => chatHasAutoOpenRightRailAction(chat), [chat]);
  const rightRailHasContent = useMemo(
    () => chatHasRightRailContent(chat) || chatHasPlanReviewContent(chat, activePlanReviewMessageId),
    [activePlanReviewMessageId, chat],
  );
  const queuedMessages = useMemo(() => mergeQueuedMessages(getQueuedMessages(chat.messages), queuedMessageDetails), [chat.messages, queuedMessageDetails]);
  const emptyChat = !chatLoading && chat.messages.length === 0;
  const projectOpenVisible = !isNoProjectName(chat.project);
  const projectOpenEnabled = projectOpenVisible && Boolean(localWorkspace.enabled && localWorkspace.roots[0]);
  const recommendedProjectOpenTarget = useMemo(
    () =>
      defaultOpenTarget
        ? getProjectOpenTarget(defaultOpenTarget, appInfo.platform)
        : getRecommendedProjectOpenTarget({
            platform: appInfo.platform,
            projectName: chat.project,
            projectRoot: localWorkspace.roots[0],
          }),
    [appInfo.platform, chat.project, defaultOpenTarget, localWorkspace.roots],
  );
  const conversationMainStyle = useMemo(
    () =>
      ({
        "--composer-clearance": `${Math.max(composerHeight + 64, 208)}px`,
      }) as CSSProperties,
    [composerHeight],
  );
  const showCodingSidecar = active && projectOpenVisible && codingSidecarOpen;
  const showRightRail = active && !showCodingSidecar && rightRailOpen && rightRailHasContent;
  const showBrowserPreview = active && !showCodingSidecar && browserPreviewOpen;
  const codingSidecarPresence = useAnimatedPresence(showCodingSidecar, 160);
  const rightRailPresence = useAnimatedPresence(showRightRail, 160);
  const browserPreviewPresence = useAnimatedPresence(showBrowserPreview, 160);
  const renderCodingSidecar = codingSidecarPresence.mounted;
  const renderRightRail = !renderCodingSidecar && rightRailPresence.mounted;
  const renderBrowserPreview = !renderCodingSidecar && browserPreviewPresence.mounted;
  const sideLayout = renderCodingSidecar
    ? codingSidecarPresence.exiting
      ? "coding-sidecar-closing"
      : "coding-sidecar"
    : renderRightRail && renderBrowserPreview
      ? browserPreviewPresence.exiting
        ? "split-preview-closing"
        : rightRailPresence.exiting
          ? "split-rail-closing"
          : "split"
      : renderBrowserPreview
        ? browserPreviewPresence.exiting
          ? "preview-closing"
          : "preview"
        : renderRightRail
          ? rightRailPresence.exiting
            ? "rail-closing"
            : "rail"
          : "none";
  const planReviewActive = Boolean(activePlanReviewMessageId && renderRightRail);
  const conversationBodyStyle = useMemo(
    () =>
      ({
        "--browser-preview-width": `${browserPreviewWidth}px`,
        "--coding-sidecar-width": `${codingSidecarWidth}px`,
      }) as CSSProperties,
    [browserPreviewWidth, codingSidecarWidth],
  );

  useEffect(() => {
    if (!codingSidecarPresence.mounted && codingSidecarExpanded) {
      setCodingSidecarExpanded(false);
    }
  }, [codingSidecarExpanded, codingSidecarPresence.mounted]);

  useEffect(() => {
    if (!active) {
      return undefined;
    }

    return scheduleIdleTask(() => {
      void loadBrowserPreviewPanel();
      void loadCodingSidecarPanel();
    }, 250);
  }, [active]);

  useEffect(() => {
    if (!browserPreviewPresence.mounted && browserPreviewExpanded) {
      setBrowserPreviewExpanded(false);
    }
  }, [browserPreviewExpanded, browserPreviewPresence.mounted]);

  useEffect(() => {
    if (!projectOpenVisible && codingSidecarOpen) {
      setCodingSidecarExpanded(false);
      setCodingSidecarOpen(false);
    }
  }, [codingSidecarOpen, projectOpenVisible]);

  const handleComposerHeightChange = useCallback((height: number) => {
    const nextHeight = Math.max(Math.round(height), 0);
    setComposerHeight((currentHeight) => (currentHeight === nextHeight ? currentHeight : nextHeight));
  }, []);

  const clampBrowserPreviewWidth = useCallback(
    (width: number) => {
      const containerWidth = conversationBodyRef.current?.getBoundingClientRect().width ?? window.innerWidth;
      const { maxWidth, minWidth } = getBrowserPreviewResizeBounds(sideLayout, containerWidth);

      return clamp(Math.round(width), minWidth, maxWidth);
    },
    [sideLayout],
  );

  const clampCodingSidecarWidth = useCallback(
    (width: number) => {
      const containerWidth = conversationBodyRef.current?.getBoundingClientRect().width ?? window.innerWidth;
      const { maxWidth, minWidth } = getCodingSidecarResizeBounds(containerWidth);

      return clamp(Math.round(width), minWidth, maxWidth);
    },
    [],
  );

  const handleToggleBrowserPreview = useCallback(() => {
    if (!browserPreviewEnabled) {
      return;
    }

    if (browserPreviewOpen) {
      setBrowserPreviewExpanded(false);
      setBrowserPreviewInitialUrl(null);
      setBrowserPreviewOpen(false);
      onBrowserPreviewClose?.();
      return;
    }

    setCodingSidecarOpen(false);
    setCodingSidecarExpanded(false);
    setBrowserPreviewExpanded(false);
    setBrowserPreviewInitialUrl(null);
    setBrowserPreviewOpen(true);
  }, [browserPreviewEnabled, browserPreviewOpen, onBrowserPreviewClose]);

  const handleCloseBrowserPreview = useCallback(() => {
    setBrowserPreviewExpanded(false);
    setBrowserPreviewOpen(false);
    setBrowserPreviewInitialUrl(null);
    onBrowserPreviewClose?.();
  }, [onBrowserPreviewClose]);

  const handleOpenCodeReview = useCallback(() => {
    if (!projectOpenVisible) {
      return;
    }

    if (codeReviewBehavior === "detached") {
      onOpenSideChat();
      return;
    }

    setCodingSidecarTab("review");
    setBrowserPreviewExpanded(false);
    setBrowserPreviewOpen(false);
    setBrowserPreviewInitialUrl(null);
    onBrowserPreviewClose?.();
    rightRailAutoOpenedRef.current = false;
    setRightRailOpen(false);
    setActivePlanReviewMessageId(null);
    setPlanReviewExpanded(false);
    setCodingSidecarExpanded(false);
    setCodingSidecarOpen(true);
  }, [codeReviewBehavior, onBrowserPreviewClose, onOpenSideChat, projectOpenVisible]);

  const handleToggleCodingSidecar = useCallback(() => {
    if (!projectOpenVisible) {
      return;
    }

    setCodingSidecarTab("codebase");
    setBrowserPreviewExpanded(false);
    setBrowserPreviewOpen(false);
    setBrowserPreviewInitialUrl(null);
    onBrowserPreviewClose?.();
    rightRailAutoOpenedRef.current = false;
    setRightRailOpen(false);
    setActivePlanReviewMessageId(null);
    setPlanReviewExpanded(false);
    setCodingSidecarOpen((open) => {
      if (!open) setCodingSidecarExpanded(false);
      return !open;
    });
  }, [onBrowserPreviewClose, projectOpenVisible]);

  const handleCloseCodingSidecar = useCallback(() => {
    setCodingSidecarOpen(false);
  }, []);

  const handleCloseRightRail = useCallback(() => {
    rightRailAutoOpenedRef.current = false;
    setRightRailOpen(false);
    setActivePlanReviewMessageId(null);
    setPlanReviewExpanded(false);
  }, []);

  const handleOpenPlanReview = useCallback((messageId: string) => {
    rightRailAutoOpenedRef.current = false;
    setCodingSidecarOpen(false);
    setCodingSidecarExpanded(false);
    setPlanReviewExpanded(false);
    setActivePlanReviewMessageId(messageId);
    setRightRailOpen(true);
  }, []);

  const handleTogglePlanReviewExpanded = useCallback(() => {
    setBrowserPreviewExpanded(false);
    setPlanReviewExpanded((expanded) => !expanded);
  }, []);

  const handleSubmitCodeReview = useCallback(
    (prompt: string) =>
      onSendMessage({
        attachments: [],
        content: prompt,
        localWorkspace,
        mode: "chat",
        webSearch: {
          enabled: false,
          maxResults: webSearch.maxResults,
          provider: webSearch.provider,
        },
      }),
    [localWorkspace, onSendMessage, webSearch.maxResults, webSearch.provider],
  );

  const handleCodingSidecarResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (codingSidecarExpanded || !showCodingSidecar) {
        return;
      }

      const container = conversationBodyRef.current;

      if (!container) {
        return;
      }

      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setCodingSidecarResizing(true);

      let resizeFrame: number | null = null;
      let pendingClientX = event.clientX;

      const commitWidth = () => {
        const containerRect = container.getBoundingClientRect();
        setCodingSidecarWidth(clampCodingSidecarWidth(containerRect.right - pendingClientX));
      };
      const updateWidth = (clientX: number) => {
        pendingClientX = clientX;

        if (resizeFrame !== null) {
          return;
        }

        resizeFrame = window.requestAnimationFrame(() => {
          resizeFrame = null;
          commitWidth();
        });
      };
      const handlePointerMove = (moveEvent: PointerEvent) => updateWidth(moveEvent.clientX);
      const stopResize = () => {
        if (resizeFrame !== null) {
          window.cancelAnimationFrame(resizeFrame);
          resizeFrame = null;
          commitWidth();
        }

        setCodingSidecarResizing(false);
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", stopResize);
        window.removeEventListener("pointercancel", stopResize);
      };

      updateWidth(event.clientX);
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", stopResize, { once: true });
      window.addEventListener("pointercancel", stopResize, { once: true });
    },
    [clampCodingSidecarWidth, codingSidecarExpanded, showCodingSidecar],
  );

  const handleCodingSidecarResizeKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (codingSidecarExpanded) {
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setCodingSidecarWidth((width) => clampCodingSidecarWidth(width + CODING_SIDECAR_RESIZE_STEP));
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        setCodingSidecarWidth((width) => clampCodingSidecarWidth(width - CODING_SIDECAR_RESIZE_STEP));
      }

      if (event.key === "Home") {
        event.preventDefault();
        setCodingSidecarWidth((width) => {
          const containerWidth = conversationBodyRef.current?.getBoundingClientRect().width ?? window.innerWidth;
          return getCodingSidecarResizeBounds(containerWidth).minWidth || width;
        });
      }

      if (event.key === "End") {
        event.preventDefault();
        setCodingSidecarWidth((width) => {
          const containerWidth = conversationBodyRef.current?.getBoundingClientRect().width ?? window.innerWidth;
          return getCodingSidecarResizeBounds(containerWidth).maxWidth || width;
        });
      }
    },
    [clampCodingSidecarWidth, codingSidecarExpanded],
  );

  const handleBrowserPreviewResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (browserPreviewExpanded || !showBrowserPreview) {
        return;
      }

      const container = conversationBodyRef.current;

      if (!container) {
        return;
      }

      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setBrowserPreviewResizing(true);

      let resizeFrame: number | null = null;
      let pendingClientX = event.clientX;

      const commitWidth = () => {
        const containerRect = container.getBoundingClientRect();
        setBrowserPreviewWidth(clampBrowserPreviewWidth(containerRect.right - pendingClientX));
      };
      const updateWidth = (clientX: number) => {
        pendingClientX = clientX;

        if (resizeFrame !== null) {
          return;
        }

        resizeFrame = window.requestAnimationFrame(() => {
          resizeFrame = null;
          commitWidth();
        });
      };
      const handlePointerMove = (moveEvent: PointerEvent) => updateWidth(moveEvent.clientX);
      const stopResize = () => {
        if (resizeFrame !== null) {
          window.cancelAnimationFrame(resizeFrame);
          resizeFrame = null;
          commitWidth();
        }

        setBrowserPreviewResizing(false);
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", stopResize);
        window.removeEventListener("pointercancel", stopResize);
      };

      updateWidth(event.clientX);
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", stopResize, { once: true });
      window.addEventListener("pointercancel", stopResize, { once: true });
    },
    [browserPreviewExpanded, clampBrowserPreviewWidth, showBrowserPreview],
  );

  const handleBrowserPreviewResizeKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (browserPreviewExpanded) {
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setBrowserPreviewWidth((width) => clampBrowserPreviewWidth(width + BROWSER_PREVIEW_RESIZE_STEP));
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        setBrowserPreviewWidth((width) => clampBrowserPreviewWidth(width - BROWSER_PREVIEW_RESIZE_STEP));
      }

      if (event.key === "Home") {
        event.preventDefault();
        setBrowserPreviewWidth((width) => {
          const containerWidth = conversationBodyRef.current?.getBoundingClientRect().width ?? window.innerWidth;
          return getBrowserPreviewResizeBounds(sideLayout, containerWidth).minWidth || width;
        });
      }

      if (event.key === "End") {
        event.preventDefault();
        setBrowserPreviewWidth((width) => {
          const containerWidth = conversationBodyRef.current?.getBoundingClientRect().width ?? window.innerWidth;
          return getBrowserPreviewResizeBounds(sideLayout, containerWidth).maxWidth || width;
        });
      }
    },
    [browserPreviewExpanded, clampBrowserPreviewWidth, sideLayout],
  );

  useEffect(() => {
    if (!active) {
      return;
    }

    setCodingSidecarOpen(false);
    setCodingSidecarExpanded(false);
    rightRailAutoOpenedRef.current = false;
    setActivePlanReviewMessageId(null);
    setPlanReviewExpanded(false);
  }, [active, chat.id]);

  useEffect(() => {
    if (!activePlanReviewMessageId) {
      return;
    }

    if (!chatHasPlanReviewContent(chat, activePlanReviewMessageId)) {
      setActivePlanReviewMessageId(null);
      setPlanReviewExpanded(false);
    }
  }, [activePlanReviewMessageId, chat]);

  useEffect(() => {
    if (!active) {
      return;
    }

    if (!rightRailHasContent) {
      rightRailAutoOpenedRef.current = false;
      setRightRailOpen(false);
      setActivePlanReviewMessageId(null);
      setPlanReviewExpanded(false);
      return;
    }

    if (rightRailNeedsAction) {
      rightRailAutoOpenedRef.current = true;
      setRightRailOpen(true);
      return;
    }

    if (rightRailAutoOpenedRef.current) {
      rightRailAutoOpenedRef.current = false;
      setRightRailOpen(false);
      setActivePlanReviewMessageId(null);
      setPlanReviewExpanded(false);
    }
  }, [active, chat.id, rightRailHasContent, rightRailNeedsAction]);

  useEffect(() => {
    if (!showBrowserPreview || browserPreviewExpanded) {
      return;
    }

    const handleResize = () => setBrowserPreviewWidth((width) => clampBrowserPreviewWidth(width));
    handleResize();
    window.addEventListener("resize", handleResize);

    return () => window.removeEventListener("resize", handleResize);
  }, [browserPreviewExpanded, clampBrowserPreviewWidth, showBrowserPreview]);

  useEffect(() => {
    if (!showCodingSidecar || codingSidecarExpanded) {
      return;
    }

    const handleResize = () => setCodingSidecarWidth((width) => clampCodingSidecarWidth(width));
    handleResize();
    window.addEventListener("resize", handleResize);

    return () => window.removeEventListener("resize", handleResize);
  }, [clampCodingSidecarWidth, codingSidecarExpanded, showCodingSidecar]);

  useEffect(() => {
    if (!browserPreviewEnabled && browserPreviewOpen) {
      setBrowserPreviewExpanded(false);
      setBrowserPreviewInitialUrl(null);
      setBrowserPreviewOpen(false);
    }
  }, [browserPreviewEnabled, browserPreviewOpen]);

  useEffect(() => {
    if (!active || !browserPreviewEnabled || !browserPreviewUrl) {
      return;
    }

    setBrowserPreviewExpanded(false);
    setBrowserPreviewInitialUrl(browserPreviewUrl);
    setBrowserPreviewOpen(true);
    rightRailAutoOpenedRef.current = false;
    setCodingSidecarOpen(false);
    setCodingSidecarExpanded(false);
  }, [active, browserPreviewEnabled, browserPreviewRequestId, browserPreviewUrl]);

  const composer = (
    <ChatComposer
      chat={chat}
      chats={chats}
      active={active}
      contextWindowSource={contextWindowSource}
      contextWindowTokens={contextWindowTokens}
      dictationDictionary={dictationDictionary}
      dictationHoldHotkey={dictationHoldHotkey}
      dictationToggleHotkey={dictationToggleHotkey}
      draft={composerDraft}
      disabled={chatLoading}
      restoreDraft={composerRestoreDraft}
      restoreDraftId={composerRestoreDraftId}
      isGenerating={isSending}
      followUpBehavior={followUpBehavior}
      lastContextCompaction={lastContextCompaction}
      layout={emptyChat ? "center" : "dock"}
      localWorkspace={localWorkspace}
      lastProviderContextUsage={lastProviderContextUsage}
      model={model}
      modelContextWindows={modelContextWindows}
      onCreateProject={onCreateProject}
      onDraftApplied={onComposerDraftApplied}
      onDraftChange={(draft) => onComposerDraftChange?.(chat.id, draft)}
      onDeleteQueuedMessage={onDeleteQueuedMessage}
      onHoldQueuedMessage={onHoldQueuedMessage}
      onHeightChange={handleComposerHeightChange}
      onLocalWorkspaceChange={onLocalWorkspaceChange}
      onModelChange={onModelChange}
      onForkWorktree={onForkChatWorktree}
      onReviewChanges={handleOpenCodeReview}
      onSelectProject={onSelectProject}
      onStopGeneration={onStopGeneration}
      onSteerQueuedMessage={onSteerQueuedMessage}
      onSubmit={onSendMessage}
      onProjectGoalClear={onProjectGoalClear}
      onProjectGoalComplete={onProjectGoalComplete}
      onProjectGoalCreate={onProjectGoalCreate}
      onProjectGoalPause={onProjectGoalPause}
      onProjectGoalResume={onProjectGoalResume}
      onProjectGoalUpdate={onProjectGoalUpdate}
      projectGoal={projectGoal}
      projects={projects}
      providerSettings={providerSettings}
      queuedMessageCount={Math.max(queuedMessageCount, queuedMessages.length)}
      queuedMessages={queuedMessages}
      requireCtrlEnterForLongPrompts={requireCtrlEnterForLongPrompts}
      heldQueuedMessageIds={heldQueuedMessageIds}
      onImageGenerationChange={onImageGenerationChange}
      onThinkingChange={onThinkingChange}
      onWebSearchChange={onWebSearchChange}
      thinking={thinking}
      webSearch={webSearch}
    />
  );

  return (
    <div className="conversation-frame">
      <ConversationHeader
        active={active}
        browserPreviewEnabled={browserPreviewEnabled}
        browserPreviewOpen={showBrowserPreview}
        codingSidecarOpen={showCodingSidecar}
        projectOpenEnabled={projectOpenEnabled}
        projectOpenVisible={projectOpenVisible}
        recommendedProjectOpenTarget={recommendedProjectOpenTarget}
        title={chat.title}
        onAddAutomation={onAddAutomation}
        onArchive={onArchiveChat}
        onCopyDeeplink={onCopyChatDeeplink}
        onCopyMarkdown={onCopyChatMarkdown}
        onCopySessionId={onCopySessionId}
        onCopyWorkingDirectory={onCopyWorkingDirectory}
        onForkLocal={onForkChatLocal}
        onForkWorktree={() => void onForkChatWorktree()}
        onOpenNewWindow={() => void onOpenChatInNewWindow()}
        onOpenProjectTool={onOpenProjectTool}
        onOpenProjectRun={onOpenProjectRun}
        onToggleCodingSidecar={handleToggleCodingSidecar}
        onToggleBrowserPreview={handleToggleBrowserPreview}
        onOpenSideChat={onOpenSideChat}
        onRename={onRenameChat}
        onToggleTerminal={onToggleTerminal}
        terminalEnabled={terminalEnabled}
        terminalOpen={terminalOpen}
      />
      <div
        className="conversation-body"
        data-browser-expanded={renderBrowserPreview && browserPreviewExpanded}
        data-browser-resizing={browserPreviewResizing}
        data-coding-sidecar-expanded={renderCodingSidecar && codingSidecarExpanded}
        data-coding-sidecar-open={renderCodingSidecar}
        data-coding-sidecar-resizing={codingSidecarResizing}
        data-plan-review-expanded={planReviewActive && planReviewExpanded}
        data-plan-review-open={planReviewActive}
        data-right-rail-open={renderRightRail}
        data-side-layout={sideLayout}
        ref={conversationBodyRef}
        style={conversationBodyStyle}
      >
        <section className="conversation-main" aria-label="Chat thread" data-empty={emptyChat} style={conversationMainStyle}>
          {emptyChat ? (
            <EmptyChatStart
              chat={chat}
              hasApiKey={hasApiKey}
              localWorkspace={localWorkspace}
              model={model}
              projects={projects}
              providerSettings={providerSettings}
              webSearch={webSearch}
              onSelectSuggestion={(suggestion) =>
                onSendMessage({
                  attachments: [],
                  content: suggestion.prompt,
                  localWorkspace,
                  webSearch: suggestion.useWebSearch && webSearch.enabled
                    ? {
                        enabled: true,
                        maxResults: webSearch.maxResults,
                        provider: webSearch.provider,
                      }
                    : undefined,
                })
              }
            >
              {composer}
            </EmptyChatStart>
          ) : (
            <>
              <ChatThread
                appInfo={appInfo}
                chat={chat}
                chats={chats}
                active={active}
                hasApiKey={hasApiKey}
                loading={chatLoading}
                onEditUserMessage={onEditUserMessage}
                onForkFromMessage={onForkChatFromMessage}
                onMessageFeedback={onMessageFeedback}
                onOpenPlanReview={handleOpenPlanReview}
                onRequestPlanRevision={onRequestPlanRevision}
                onRegenerateResponse={onRegenerateResponse}
                onResolveToolApproval={onResolveToolApproval}
                onSelectChat={onSelectChat}
              />
              {composer}
            </>
          )}
        </section>
        {renderRightRail ? (
          <div className="side-panel-presence" data-panel="right-rail" data-presence={rightRailPresence.exiting ? "exit" : "enter"}>
            <RightRail
              activePlanReviewMessageId={activePlanReviewMessageId}
              chat={chat}
              planReviewExpanded={planReviewExpanded}
              onClose={handleCloseRightRail}
              onRequestPlanRevision={onRequestPlanRevision}
              onResolveToolApproval={onResolveToolApproval}
              onSubmitPlanningInput={onSubmitPlanningInput}
              onTogglePlanReviewExpanded={handleTogglePlanReviewExpanded}
            />
          </div>
        ) : null}
        {renderCodingSidecar ? (
          <div className="side-panel-presence" data-panel="coding-sidecar" data-presence={codingSidecarPresence.exiting ? "exit" : "enter"}>
            <Suspense fallback={null}>
              <CodingSidecarPanel
                agentRuns={agentRuns}
                chat={chat}
                expanded={codingSidecarExpanded}
                initialTab={codingSidecarTab}
                localWorkspace={localWorkspace}
                previewWidth={codingSidecarWidth}
                resizeMaxWidth={CODING_SIDECAR_MAX_WIDTH}
                resizeMinWidth={CODING_SIDECAR_MIN_WIDTH}
                root={localWorkspace.roots[0] ?? ""}
                onClose={handleCloseCodingSidecar}
                onResizeKeyDown={handleCodingSidecarResizeKeyDown}
                onResizeStart={handleCodingSidecarResizeStart}
                onSubmitPrompt={handleSubmitCodeReview}
                onToggleExpanded={() => setCodingSidecarExpanded((expanded) => !expanded)}
              />
            </Suspense>
          </div>
        ) : null}
        {renderBrowserPreview ? (
          <div className="side-panel-presence" data-presence={browserPreviewPresence.exiting ? "exit" : "enter"}>
            <Suspense fallback={null}>
              <BrowserPreviewPanel
                closing={browserPreviewPresence.exiting}
                expanded={browserPreviewExpanded}
                initialUrl={browserPreviewInitialUrl ?? undefined}
                previewWidth={browserPreviewWidth}
                resizeMaxWidth={BROWSER_PREVIEW_MAX_WIDTH}
                resizeMinWidth={BROWSER_PREVIEW_MIN_WIDTH}
                onClose={handleCloseBrowserPreview}
                onResizeKeyDown={handleBrowserPreviewResizeKeyDown}
                onResizeStart={handleBrowserPreviewResizeStart}
                onToggleExpanded={() => setBrowserPreviewExpanded((expanded) => !expanded)}
              />
            </Suspense>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export const ChatPage = memo(ChatPageComponent, areChatPagePropsEqual);

function areChatPagePropsEqual(previous: ChatPageProps, next: ChatPageProps) {
  return (
    previous.active === next.active &&
    previous.agentRuns === next.agentRuns &&
    previous.appInfo === next.appInfo &&
    previous.browserPreviewEnabled === next.browserPreviewEnabled &&
    previous.browserPreviewRequestId === next.browserPreviewRequestId &&
    previous.browserPreviewUrl === next.browserPreviewUrl &&
    previous.chat === next.chat &&
    previous.chatLoading === next.chatLoading &&
    previous.chats === next.chats &&
    previous.codeReviewBehavior === next.codeReviewBehavior &&
    previous.composerDraft === next.composerDraft &&
    previous.composerRestoreDraft === next.composerRestoreDraft &&
    previous.composerRestoreDraftId === next.composerRestoreDraftId &&
    previous.contextWindowSource === next.contextWindowSource &&
    previous.contextWindowTokens === next.contextWindowTokens &&
    previous.defaultOpenTarget === next.defaultOpenTarget &&
    previous.dictationDictionary === next.dictationDictionary &&
    previous.dictationHoldHotkey === next.dictationHoldHotkey &&
    previous.dictationToggleHotkey === next.dictationToggleHotkey &&
    previous.followUpBehavior === next.followUpBehavior &&
    previous.hasApiKey === next.hasApiKey &&
    previous.isSending === next.isSending &&
    previous.lastContextCompaction === next.lastContextCompaction &&
    previous.localWorkspace === next.localWorkspace &&
    previous.lastProviderContextUsage === next.lastProviderContextUsage &&
    previous.model === next.model &&
    previous.modelContextWindows === next.modelContextWindows &&
    previous.providerSettings === next.providerSettings &&
    previous.projectGoal === next.projectGoal &&
    previous.projects === next.projects &&
    previous.queuedMessageCount === next.queuedMessageCount &&
    previous.queuedMessageDetails === next.queuedMessageDetails &&
    previous.requireCtrlEnterForLongPrompts === next.requireCtrlEnterForLongPrompts &&
    previous.heldQueuedMessageIds === next.heldQueuedMessageIds &&
    previous.thinking === next.thinking &&
    previous.webSearch === next.webSearch &&
    previous.terminalEnabled === next.terminalEnabled &&
    previous.terminalOpen === next.terminalOpen
  );
}

const BROWSER_PREVIEW_MIN_WIDTH = 320;
const BROWSER_PREVIEW_MAX_WIDTH = 1120;
const DEFAULT_BROWSER_PREVIEW_WIDTH = 560;
const BROWSER_PREVIEW_RESIZE_STEP = 40;
const CODING_SIDECAR_MIN_WIDTH = 460;
const CODING_SIDECAR_MAX_WIDTH = 1280;
const DEFAULT_CODING_SIDECAR_WIDTH = 760;
const CODING_SIDECAR_RESIZE_STEP = 48;
const PREVIEW_ONLY_RESERVED_WIDTH = 320;
const SPLIT_LAYOUT_RESERVED_WIDTH = 560;
const CODING_SIDECAR_RESERVED_WIDTH = 360;

type EmptyChatTone = "access" | "creative" | "project" | "route" | "tools";

interface EmptyChatSuggestion {
  detail: string;
  icon: LucideIcon;
  label: string;
  prompt: string;
  tone: EmptyChatTone;
  useWebSearch?: boolean;
}

interface EmptyChatContext {
  canGenerateImages: boolean;
  hasProject: boolean;
  imageStatus: string;
  modelLabel: string;
  projectLabel: string;
  promptProjectName: string;
  providerLabel: string;
  routeStatus: string;
  webSearchDetail: string;
  webSearchEnabled: boolean;
}

interface EmptyChatStartProps {
  chat: ChatSummary;
  children: ReactNode;
  hasApiKey: boolean;
  localWorkspace: LocalWorkspaceSettings;
  model: string;
  onSelectSuggestion: (suggestion: EmptyChatSuggestion) => void;
  projects: ProjectSummary[];
  providerSettings: ProviderSettings;
  webSearch: WebSearchSettings;
}

function EmptyChatStart({ chat, children, hasApiKey, localWorkspace, model, onSelectSuggestion, projects, providerSettings, webSearch }: EmptyChatStartProps) {
  const context = createEmptyChatContext({
    chat,
    hasApiKey,
    localWorkspace,
    model,
    projects,
    providerSettings,
    webSearch,
  });
  const suggestions = createEmptyChatSuggestions(context);

  return (
    <div className="empty-chat-start">
      <section className="empty-chat-hero" aria-label="Current chat setup">
        <h2>Start with the right context.</h2>
      </section>
      <div className="empty-chat-suggestions" aria-label="Starter prompts">
        {suggestions.map((suggestion) => {
          const SuggestionIcon = suggestion.icon;

          return (
            <button aria-label={`${suggestion.label}: ${suggestion.detail}`} data-tone={suggestion.tone} key={suggestion.label} title={suggestion.detail} type="button" onClick={() => onSelectSuggestion(suggestion)}>
              <span className="empty-chat-suggestion-icon" aria-hidden="true">
                <SuggestionIcon size={14} />
              </span>
              <span className="empty-chat-suggestion-copy">
                <strong>{suggestion.label}</strong>
                <small>{suggestion.detail}</small>
              </span>
            </button>
          );
        })}
      </div>
      {children}
    </div>
  );
}

function createEmptyChatContext({
  chat,
  hasApiKey,
  localWorkspace,
  model,
  projects,
  providerSettings,
  webSearch,
}: Omit<EmptyChatStartProps, "children" | "onSelectSuggestion">): EmptyChatContext {
  const projectName = normalizeProjectName(chat.project);
  const activeProject = projects.find((project) => normalizeProjectName(project.name).toLowerCase() === projectName.toLowerCase());
  const workspaceRoot = localWorkspace.roots[0] || activeProject?.localWorkspace?.roots[0] || "";
  const workspaceName = getPathBasename(workspaceRoot);
  const hasProject = !isNoProjectName(projectName);
  const projectLabel = hasProject ? projectName : workspaceName ? `${workspaceName} workspace` : DEFAULT_PROJECT;
  const promptProjectName = hasProject ? projectName : workspaceRoot ? "the open workspace" : "this chat";
  const providerDefinition = getModelProvider(providerSettings.provider);
  const providerKey = providerSettings.apiKeys[providerSettings.provider]?.trim();
  const legacyOpenRouterKey = providerSettings.provider === "openrouter" ? providerSettings.openRouterApiKey.trim() : "";
  const providerHasKey = Boolean(providerKey || legacyOpenRouterKey || hasApiKey);
  const routeStatus =
    providerSettings.provider === "9router"
      ? "Subscription route"
      : isLocalProvider(providerSettings.provider)
      ? "Local route"
      : providerDefinition.requiresApiKey && !providerHasKey
      ? "Needs API key"
      : providerDefinition.requiresApiKey
      ? "API key ready"
      : "Ready";
  const selectedModel = model.trim() || providerSettings.providerModels[providerSettings.provider]?.trim() || providerSettings.model.trim() || providerDefinition.defaultModel;
  const modelLabel = formatModelName(selectedModel);
  const webSearchProviderLabel = WEB_SEARCH_PROVIDER_LABELS[webSearch.provider] ?? "Web search";
  const webSearchEnabled = Boolean(webSearch.enabled && providerSettings.tools.webSearch);
  const canGenerateImages = Boolean(providerSettings.tools.imageGeneration);

  return {
    canGenerateImages,
    hasProject,
    imageStatus: canGenerateImages ? "Images on" : "Images off",
    modelLabel,
    projectLabel,
    promptProjectName,
    providerLabel: providerDefinition.label,
    routeStatus,
    webSearchDetail: webSearchEnabled ? `${webSearchProviderLabel} on` : "Web off",
    webSearchEnabled,
  };
}

function createEmptyChatSuggestions(context: EmptyChatContext): EmptyChatSuggestion[] {
  const subject = context.promptProjectName;
  const routeSummary = `${context.providerLabel} / ${context.routeStatus}`;

  return [
    {
      detail: "Architecture, run path, important files",
      icon: Code2,
      label: "Explain this project",
      prompt: `Use the active project context for ${subject}. Explain the architecture, where the important files live, how to run it, and the first risks or opportunities you see.`,
      tone: "project",
    },
    {
      detail: "Inspect, implement, verify",
      icon: GitBranch,
      label: "Pick a real starter task",
      prompt: `Look through ${subject} with the available local context. Pick one high-impact starter task, make the change, run the most relevant check, and explain exactly what changed.`,
      tone: "access",
    },
    {
      detail: routeSummary,
      icon: Route,
      label: "Check my AI setup",
      prompt: `Review the active AI setup for this chat: provider ${context.providerLabel}, model ${context.modelLabel}, subscription or API key readiness, enabled tools, local access, and project context. Tell me what is ready, what is missing, and what you would adjust before work starts.`,
      tone: "route",
    },
    {
      detail: context.webSearchDetail,
      icon: Search,
      label: context.webSearchEnabled ? "Research before coding" : "Plan from local context",
      prompt: context.webSearchEnabled
        ? `Use web search only where current docs matter, then inspect ${subject} and propose the safest next implementation step. Include sources when web results affect the answer.`
        : `Use the current local project context only and propose the safest next implementation step for ${subject}.`,
      tone: "tools",
      useWebSearch: context.webSearchEnabled,
    },
    {
      detail: context.imageStatus,
      icon: ImageIcon,
      label: context.canGenerateImages ? "Generate a project icon" : "Draft an icon brief",
      prompt: context.canGenerateImages
        ? `Generate a clean app icon concept for ${subject}. Use the image tool, then explain the direction and where it would fit in the app.`
        : `Create a concise visual brief for a clean app icon for ${subject}, and tell me what to enable if I want Gilbert to generate the image artifact.`,
      tone: "creative",
    },
    {
      detail: "Useful apps and project tools",
      icon: Grid2X2,
      label: "Connect useful tools",
      prompt: `Look at what ${subject} needs and recommend the most useful app, connector, or local tool connections for this chat. Prioritize connections that would actually help the current project workflow.`,
      tone: "tools",
    },
  ];
}

function isLocalProvider(provider: ProviderSettings["provider"]) {
  return provider === "lmstudio" || provider === "ollama" || provider === "vllm";
}

function formatModelName(model: string) {
  const trimmed = model.trim();

  if (!trimmed) {
    return "Default model";
  }

  const parts = trimmed.split("/").filter(Boolean);
  const leaf = parts.length > 0 ? parts[parts.length - 1] : trimmed;
  const readable = leaf.replace(/[-_]+/g, " ");

  return readable.length > 34 ? `${readable.slice(0, 31).trim()}...` : readable;
}

function getPathBasename(path: string) {
  const normalized = path.trim().replace(/[\\/]+$/, "");

  if (!normalized) {
    return "";
  }

  const parts = normalized.split(/[\\/]+/).filter(Boolean);

  return parts.length > 0 ? parts[parts.length - 1] : "";
}

function getBrowserPreviewResizeBounds(sideLayout: string, containerWidth: number) {
  const reservedWidth = sideLayout === "split" ? SPLIT_LAYOUT_RESERVED_WIDTH : PREVIEW_ONLY_RESERVED_WIDTH;
  const availableWidth = Math.max(BROWSER_PREVIEW_MIN_WIDTH, containerWidth - reservedWidth);
  const maxWidth = Math.min(BROWSER_PREVIEW_MAX_WIDTH, availableWidth);

  return {
    maxWidth,
    minWidth: Math.min(BROWSER_PREVIEW_MIN_WIDTH, maxWidth),
  };
}

function getCodingSidecarResizeBounds(containerWidth: number) {
  const availableWidth = Math.max(CODING_SIDECAR_MIN_WIDTH, containerWidth - CODING_SIDECAR_RESERVED_WIDTH);
  const maxWidth = Math.min(CODING_SIDECAR_MAX_WIDTH, availableWidth);

  return {
    maxWidth,
    minWidth: Math.min(CODING_SIDECAR_MIN_WIDTH, maxWidth),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getQueuedMessages(messages: ChatMessage[]) {
  return messages.filter((message) => message.role === "user" && message.status === "queued");
}

function mergeQueuedMessages(chatQueuedMessages: ChatMessage[], queueDetails: ChatMessage[]) {
  if (queueDetails.length === 0) {
    return chatQueuedMessages;
  }

  const chatMessageById = new Map(chatQueuedMessages.map((message) => [message.id, message]));

  return queueDetails.map((message) => chatMessageById.get(message.id) ?? message);
}
