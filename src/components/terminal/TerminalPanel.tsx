import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal, type ITheme } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import "../../styles/terminal.css";
import { ChevronsUpDown, FolderOpen, PanelBottomClose, Plus, RotateCw, Square, SquareTerminal, Trash2, X } from "lucide-react";
import { createTerminalSession, drainTerminalSession, killTerminalSession, resizeTerminalSession, writeTerminalSession } from "../../app/tauriClient";
import { listComputerDrives, pickComputerFolder } from "../../localWorkspace/files";
import { subscribeBackgroundTerminalSessionOutput } from "../../lib/terminalSessions";
import { getAvailableTerminalShells, getDefaultTerminalShell, getHostPlatform, terminalShellLabel } from "../../lib/terminalShells";
import type { TerminalAttachedSession, TerminalOutputChunk, TerminalShellId } from "../../types/terminal";

interface TerminalPanelProps {
  attachedSession?: TerminalAttachedSession | null;
  defaultShell?: TerminalShellId;
  desktopRuntime: boolean;
  height: number;
  open: boolean;
  onClose: () => void;
  onHeightChange: (height: number) => void;
  workingDirectory?: string;
}

type TerminalStatus = "connected" | "error" | "exited" | "running" | "starting" | "stopped" | "unavailable";
type ResolvedTerminalTheme = "dark" | "light";

interface TerminalTab {
  activeCommand: string | null;
  attached: boolean;
  id: string;
  owned: boolean;
  pendingWorkingDirectory: string | null;
  sessionId: string | null;
  shell: TerminalShellId;
  status: TerminalStatus;
  workingDirectory: string;
}

interface TerminalWorkspaceState {
  activeTabId: string;
  tabs: TerminalTab[];
}

const MIN_TERMINAL_HEIGHT = 184;
const MAX_TERMINAL_HEIGHT = 720;
const POLL_INTERVAL_MS = 90;
const IDLE_POLL_INTERVAL_MS = 240;
const DRAIN_TIMEOUT_BACKOFF_MS = 4_000;
const DRAIN_TIMEOUT_NOTICE_INTERVAL_MS = 30_000;
const RESIZE_STEP = 28;
const MAX_REPLAY_BUFFER_CHARS = 2_000_000;

let terminalTabCounter = 0;

const TERMINAL_THEME_FALLBACKS: Record<ResolvedTerminalTheme, ITheme> = {
  dark: {
    background: "#0d1117",
    black: "#141a22",
    blue: "#8fc7ff",
    brightBlack: "#6e7681",
    brightBlue: "#add7ff",
    brightCyan: "#9be7ff",
    brightGreen: "#b8e6c8",
    brightMagenta: "#d7c0ff",
    brightRed: "#ffb5ad",
    brightWhite: "#ffffff",
    brightYellow: "#ffe1a3",
    cursor: "#d7ecff",
    cursorAccent: "#0d1117",
    cyan: "#7bd8f7",
    foreground: "#e6edf3",
    green: "#91d7a7",
    magenta: "#c7a9ff",
    red: "#ff8f85",
    scrollbarSliderBackground: "rgba(255, 255, 255, 0.26)",
    scrollbarSliderHoverBackground: "rgba(255, 255, 255, 0.38)",
    selectionBackground: "#31506d",
    white: "#d9dee5",
    yellow: "#f2c978",
  },
  light: {
    background: "#fbfdff",
    black: "#1f2937",
    blue: "#0969da",
    brightBlack: "#667085",
    brightBlue: "#1f7edc",
    brightCyan: "#0a7ea4",
    brightGreen: "#1a7f37",
    brightMagenta: "#8a3ffc",
    brightRed: "#d1242f",
    brightWhite: "#ffffff",
    brightYellow: "#9a6700",
    cursor: "#175e9e",
    cursorAccent: "#ffffff",
    cyan: "#087990",
    foreground: "#17202b",
    green: "#1f883d",
    magenta: "#8250df",
    red: "#cf222e",
    scrollbarSliderBackground: "rgba(23, 32, 43, 0.2)",
    scrollbarSliderHoverBackground: "rgba(23, 32, 43, 0.34)",
    selectionBackground: "#c9ddf3",
    selectionForeground: "#0f1720",
    white: "#d0d7de",
    yellow: "#9a6700",
  },
};

export function TerminalPanel({ attachedSession, defaultShell, desktopRuntime, height, open, onClose, onHeightChange, workingDirectory }: TerminalPanelProps) {
  const fallbackShell = defaultShell ?? getDefaultTerminalShell();
  const [workspace, setWorkspaceState] = useState<TerminalWorkspaceState>(() => createInitialWorkspace(workingDirectory, fallbackShell));
  const [cwdMenuOpen, setCwdMenuOpen] = useState(false);
  const [cwdDraft, setCwdDraft] = useState("");
  const [cwdMenuError, setCwdMenuError] = useState<string | null>(null);
  const [directoryShortcuts, setDirectoryShortcuts] = useState<string[]>([]);
  const [resolvedTerminalTheme, setResolvedTerminalTheme] = useState<ResolvedTerminalTheme>(() => readResolvedTerminalTheme());
  const shellOptions = useMemo(() => getAvailableTerminalShells(), []);
  const activeTab = workspace.tabs.find((tab) => tab.id === workspace.activeTabId) ?? workspace.tabs[0];
  const activeStatusLabel = useMemo(() => getStatusLabel(activeTab?.status ?? (desktopRuntime ? "stopped" : "unavailable"), desktopRuntime), [activeTab?.status, desktopRuntime]);

  const activeProjectKeyRef = useRef(createProjectKey(workingDirectory));
  const activeTabIdRef = useRef(workspace.activeTabId);
  const cwdMenuRef = useRef<HTMLDivElement>(null);
  const drainBackoffUntilRef = useRef<Record<string, number>>({});
  const drainTimeoutNoticeAtRef = useRef<Record<string, number>>({});
  const fitAddonRef = useRef<FitAddon | null>(null);
  const ownedSessionIdsRef = useRef(new Set<string>());
  const replayedAttachedSessionRef = useRef(new Set<string>());
  const startingTabIdsRef = useRef(new Set<string>());
  const tabOutputRef = useRef<Record<string, string>>(
    Object.fromEntries(workspace.tabs.map((tab) => [tab.id, ""])),
  );
  const tabsRef = useRef(workspace.tabs);
  const workspaceCacheRef = useRef<Record<string, TerminalWorkspaceState>>({
    [activeProjectKeyRef.current]: workspace,
  });
  const terminalHostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const pendingTerminalWritesRef = useRef<Record<string, string>>({});
  const terminalWriteFrameRef = useRef<number | null>(null);

  useEffect(() => {
    tabsRef.current = workspace.tabs;
  }, [workspace.tabs]);

  useEffect(() => {
    activeTabIdRef.current = workspace.activeTabId;
  }, [workspace.activeTabId]);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.theme = readTerminalCssTheme();
    }
  }, [resolvedTerminalTheme]);

  useEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined") {
      return;
    }

    const syncResolvedTheme = () => {
      const nextTheme = readResolvedTerminalTheme();
      setResolvedTerminalTheme(nextTheme);

      if (terminalRef.current) {
        terminalRef.current.options.theme = readTerminalCssTheme();
      }
    };
    const observer = new MutationObserver(syncResolvedTheme);
    const mediaQuery = window.matchMedia("(prefers-color-scheme: light)");

    syncResolvedTheme();
    observer.observe(document.documentElement, { attributeFilter: ["data-theme", "style"], attributes: true });
    mediaQuery.addEventListener("change", syncResolvedTheme);

    return () => {
      observer.disconnect();
      mediaQuery.removeEventListener("change", syncResolvedTheme);
    };
  }, []);

  useEffect(() => {
    return () => {
      for (const sessionId of ownedSessionIdsRef.current) {
        void killTerminalSession(sessionId).catch(() => undefined);
      }

      ownedSessionIdsRef.current.clear();
    };
  }, []);

  const setWorkspace = useCallback((updater: TerminalWorkspaceState | ((current: TerminalWorkspaceState) => TerminalWorkspaceState)) => {
    setWorkspaceState((current) => {
      const nextWorkspace = typeof updater === "function" ? updater(current) : updater;
      workspaceCacheRef.current[activeProjectKeyRef.current] = nextWorkspace;
      tabsRef.current = nextWorkspace.tabs;
      activeTabIdRef.current = nextWorkspace.activeTabId;
      return nextWorkspace;
    });
  }, []);

  const findCachedTab = useCallback((tabId: string) => {
    for (const projectWorkspace of Object.values(workspaceCacheRef.current)) {
      const tab = projectWorkspace.tabs.find((candidate) => candidate.id === tabId);

      if (tab) {
        return tab;
      }
    }

    return undefined;
  }, []);

  const updateTab = useCallback(
    (tabId: string, patch: Partial<TerminalTab> | ((tab: TerminalTab) => Partial<TerminalTab>)) => {
      const activeProjectKey = activeProjectKeyRef.current;
      const nextCache: Record<string, TerminalWorkspaceState> = { ...workspaceCacheRef.current };
      let nextActiveWorkspace: TerminalWorkspaceState | null = null;

      for (const [projectKey, projectWorkspace] of Object.entries(workspaceCacheRef.current)) {
        let changed = false;
        const nextTabs = projectWorkspace.tabs.map((tab) => {
          if (tab.id !== tabId) {
            return tab;
          }

          const nextPatch = typeof patch === "function" ? patch(tab) : patch;
          changed = true;
          return { ...tab, ...nextPatch };
        });

        if (changed) {
          const nextProjectWorkspace = { ...projectWorkspace, tabs: nextTabs };
          nextCache[projectKey] = nextProjectWorkspace;

          if (projectKey === activeProjectKey) {
            nextActiveWorkspace = nextProjectWorkspace;
          }
        }
      }

      workspaceCacheRef.current = nextCache;

      if (nextActiveWorkspace) {
        tabsRef.current = nextActiveWorkspace.tabs;
        setWorkspaceState(nextActiveWorkspace);
      }
    },
    [],
  );

  const fitTerminal = useCallback(() => {
    try {
      fitAddonRef.current?.fit();
    } catch {
      // The fit addon can throw while the panel is being mounted or detached.
    }
  }, []);

  const flushPendingTerminalWrites = useCallback(() => {
    terminalWriteFrameRef.current = null;
    const activeTabId = activeTabIdRef.current;
    const text = pendingTerminalWritesRef.current[activeTabId];
    pendingTerminalWritesRef.current = {};

    if (text) {
      terminalRef.current?.write(text);
    }
  }, []);

  const scheduleTerminalWrite = useCallback(
    (tabId: string, text: string) => {
      pendingTerminalWritesRef.current[tabId] = `${pendingTerminalWritesRef.current[tabId] ?? ""}${text}`;

      if (terminalWriteFrameRef.current !== null) {
        return;
      }

      terminalWriteFrameRef.current = window.requestAnimationFrame(flushPendingTerminalWrites);
    },
    [flushPendingTerminalWrites],
  );

  const replayTabOutput = useCallback(
    (tabId: string) => {
      const terminal = terminalRef.current;

      if (!terminal) {
        return;
      }

      delete pendingTerminalWritesRef.current[tabId];
      terminal.reset();
      terminal.clear();

      const output = tabOutputRef.current[tabId];
      if (output) {
        terminal.write(output);
      }

      window.requestAnimationFrame(() => {
        fitTerminal();
        terminal.focus();
      });
    },
    [fitTerminal],
  );

  const appendTabText = useCallback(
    (tabId: string, text: string) => {
      if (!text) {
        return;
      }

      const previous = tabOutputRef.current[tabId] ?? "";
      const next = trimReplayBuffer(`${previous}${text}`);
      tabOutputRef.current[tabId] = next;

      const tab = findCachedTab(tabId);
      const inferredWorkingDirectory = tab ? inferWorkingDirectoryFromTerminalOutput(next, tab.shell) : null;

      if (tab && inferredWorkingDirectory && inferredWorkingDirectory !== tab.workingDirectory) {
        updateTab(tabId, {
          pendingWorkingDirectory: null,
          workingDirectory: inferredWorkingDirectory,
        });
      }

      if (tabId === activeTabIdRef.current) {
        scheduleTerminalWrite(tabId, text);
      }
    },
    [findCachedTab, scheduleTerminalWrite, updateTab],
  );

  const appendTabChunks = useCallback(
    (tabId: string, chunks: TerminalOutputChunk[]) => {
      appendTabText(tabId, chunks.map((chunk) => chunk.text).join(""));
    },
    [appendTabText],
  );

  const writeSystemMessage = useCallback(
    (tabId: string, message: string) => {
      appendTabText(tabId, `\r\n${message.trimEnd()}\r\n`);
    },
    [appendTabText],
  );

  const selectTab = useCallback(
    (tabId: string) => {
      if (!tabsRef.current.some((tab) => tab.id === tabId)) {
        return;
      }

      activeTabIdRef.current = tabId;
      setWorkspace((current) => ({ ...current, activeTabId: tabId }));
      replayTabOutput(tabId);
    },
    [replayTabOutput],
  );

  const startSession = useCallback(
    async (tabId: string, replace = false, workingDirectoryOverride?: string) => {
      const currentTab = tabsRef.current.find((tab) => tab.id === tabId);

      if (!currentTab || startingTabIdsRef.current.has(tabId)) {
        return;
      }

      if (!desktopRuntime) {
        updateTab(tabId, { status: "unavailable" });
        writeSystemMessage(tabId, "Open the desktop app to run terminal sessions.");
        return;
      }

      startingTabIdsRef.current.add(tabId);
      updateTab(tabId, { status: "starting" });

      const previousSessionId = replace ? currentTab.sessionId : null;
      const nextWorkingDirectory = (workingDirectoryOverride ?? currentTab.pendingWorkingDirectory ?? currentTab.workingDirectory).trim();

      if (previousSessionId) {
        try {
          await killTerminalSession(previousSessionId);
        } catch {
          // A dead session should not block replacing the tab.
        }

        ownedSessionIdsRef.current.delete(previousSessionId);
        updateTab(tabId, {
          activeCommand: null,
          sessionId: null,
        });
      }

      tabOutputRef.current[tabId] = "";
      if (tabId === activeTabIdRef.current) {
        terminalRef.current?.reset();
        terminalRef.current?.clear();
      }

      try {
        const response = await createTerminalSession({
          mode: "interactive",
          shell: currentTab.shell,
          workingDirectory: nextWorkingDirectory || undefined,
        });

        if (!tabsRef.current.some((tab) => tab.id === tabId)) {
          await killTerminalSession(response.sessionId).catch(() => undefined);
          return;
        }

        ownedSessionIdsRef.current.add(response.sessionId);
        updateTab(tabId, {
          activeCommand: null,
          attached: false,
          owned: true,
          pendingWorkingDirectory: null,
          sessionId: response.sessionId,
          shell: response.shell,
          status: "connected",
          workingDirectory: response.workingDirectory,
        });
        appendTabChunks(tabId, response.initialOutput);
        window.requestAnimationFrame(fitTerminal);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        updateTab(tabId, { status: "error" });
        writeSystemMessage(tabId, `Could not start terminal: ${detail}`);
      } finally {
        startingTabIdsRef.current.delete(tabId);
      }
    },
    [appendTabChunks, desktopRuntime, fitTerminal, updateTab, writeSystemMessage],
  );

  useEffect(() => {
    if (!open || !desktopRuntime || !terminalHostRef.current) {
      return;
    }

    const terminal = new Terminal({
      allowProposedApi: false,
      allowTransparency: true,
      convertEol: true,
      cursorBlink: true,
      cursorStyle: "block",
      disableStdin: false,
      drawBoldTextInBrightColors: true,
      fontFamily: '"Cascadia Code", "SFMono-Regular", "JetBrains Mono", Consolas, monospace',
      fontSize: 12.5,
      fontWeight: 450,
      fontWeightBold: 720,
      ignoreBracketedPasteMode: false,
      letterSpacing: 0,
      lineHeight: 1.2,
      rightClickSelectsWord: true,
      scrollback: 12_000,
      scrollOnUserInput: true,
      theme: readTerminalCssTheme(),
      windowsPty: getHostPlatform() === "windows" ? { backend: "conpty" } : undefined,
    });
    const fitAddon = new FitAddon();
    const host = terminalHostRef.current;

    terminal.loadAddon(fitAddon);
    terminal.open(host);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const dataDisposable = terminal.onData((data) => {
      const activeTab = tabsRef.current.find((tab) => tab.id === activeTabIdRef.current);

      if (!activeTab?.sessionId || activeTab.status === "exited" || activeTab.status === "stopped") {
        return;
      }

      void writeTerminalSession(activeTab.sessionId, data).catch((error) => {
        const detail = error instanceof Error ? error.message : String(error);
        updateTab(activeTab.id, { status: "error" });
        writeSystemMessage(activeTab.id, `Terminal input failed: ${detail}`);
      });
    });
    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      const activeTab = tabsRef.current.find((tab) => tab.id === activeTabIdRef.current);

      if (!activeTab?.sessionId) {
        return;
      }

      void resizeTerminalSession(activeTab.sessionId, cols, rows).catch(() => undefined);
    });
    const animationFrame = window.requestAnimationFrame(() => {
      fitTerminal();
      replayTabOutput(activeTabIdRef.current);
      terminal.focus();
    });

    return () => {
      window.cancelAnimationFrame(animationFrame);
      if (terminalWriteFrameRef.current !== null) {
        window.cancelAnimationFrame(terminalWriteFrameRef.current);
        terminalWriteFrameRef.current = null;
      }
      pendingTerminalWritesRef.current = {};
      dataDisposable.dispose();
      resizeDisposable.dispose();
      fitAddonRef.current = null;
      terminalRef.current = null;
      terminal.dispose();
    };
  }, [desktopRuntime, fitTerminal, open, replayTabOutput, updateTab, writeSystemMessage]);

  useEffect(() => {
    if (!open || !desktopRuntime || !terminalHostRef.current) {
      return;
    }

    const observer = new ResizeObserver(() => fitTerminal());
    observer.observe(terminalHostRef.current);
    window.addEventListener("resize", fitTerminal);
    const animationFrame = window.requestAnimationFrame(fitTerminal);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
      window.removeEventListener("resize", fitTerminal);
    };
  }, [desktopRuntime, fitTerminal, height, open]);

  useEffect(() => {
    if (!open || !desktopRuntime || !activeTab || activeTab.sessionId || activeTab.status === "starting" || activeTab.attached) {
      return;
    }

    void startSession(activeTab.id, false);
  }, [activeTab, desktopRuntime, open, startSession]);

  useEffect(() => {
    if (!desktopRuntime) {
      return;
    }

    let canceled = false;
    let timeoutId: number | undefined;

    async function drain() {
      const sessions = Object.values(workspaceCacheRef.current)
        .flatMap((projectWorkspace) => projectWorkspace.tabs)
        .filter((tab) => tab.sessionId);

      await Promise.allSettled(
        sessions.map(async (tab) => {
          const sessionId = tab.sessionId;

          if (!sessionId) {
            return;
          }

          const backoffUntil = drainBackoffUntilRef.current[sessionId] ?? 0;
          if (backoffUntil > Date.now()) {
            return;
          }

          try {
            const response = await drainTerminalSession(sessionId);

            if (canceled) {
              return;
            }

            delete drainBackoffUntilRef.current[sessionId];
            delete drainTimeoutNoticeAtRef.current[sessionId];
            appendTabChunks(tab.id, response.chunks);

            updateTab(tab.id, (current) => {
              const nextStatus: TerminalStatus = response.commandRunning ? "running" : response.exitCode !== null && response.exitCode !== undefined ? "exited" : "connected";
              const patch: Partial<TerminalTab> = {
                activeCommand: response.activeCommand ?? null,
                status: nextStatus,
              };

              if (current.attached && response.workingDirectory) {
                patch.workingDirectory = response.workingDirectory;
              }

              return patch;
            });
          } catch (error) {
            if (canceled || !findCachedTab(tab.id)) {
              return;
            }

            const detail = error instanceof Error ? error.message : String(error);
            if (isTerminalDrainTimeout(detail)) {
              const now = Date.now();
              drainBackoffUntilRef.current[sessionId] = now + DRAIN_TIMEOUT_BACKOFF_MS;

              if ((drainTimeoutNoticeAtRef.current[sessionId] ?? 0) + DRAIN_TIMEOUT_NOTICE_INTERVAL_MS < now) {
                drainTimeoutNoticeAtRef.current[sessionId] = now;
                writeSystemMessage(tab.id, "Terminal output is still starting or busy; retrying...");
              }

              updateTab(tab.id, (current) => ({
                status: current.status === "error" ? "running" : current.status,
              }));
              return;
            }

            updateTab(tab.id, { status: "error" });
            writeSystemMessage(tab.id, `Terminal disconnected: ${detail}`);
          }
        }),
      );

      if (!canceled) {
        const active = tabsRef.current.find((tab) => tab.id === activeTabIdRef.current);
        timeoutId = window.setTimeout(drain, active?.status === "running" ? POLL_INTERVAL_MS : IDLE_POLL_INTERVAL_MS);
      }
    }

    void drain();

    return () => {
      canceled = true;
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [appendTabChunks, desktopRuntime, findCachedTab, updateTab, writeSystemMessage]);

  useEffect(() => {
    if (!attachedSession?.sessionId || !desktopRuntime) {
      return;
    }

    const existingAttachedTab = Object.values(workspaceCacheRef.current)
      .flatMap((projectWorkspace) => projectWorkspace.tabs)
      .find((tab) => tab.sessionId === attachedSession.sessionId)
      ?? Object.values(workspaceCacheRef.current)
        .flatMap((projectWorkspace) => projectWorkspace.tabs)
        .find((tab) => attachedTerminalTabMatchesSession(tab, attachedSession));
    const attachedTab =
      existingAttachedTab ??
      createTerminalTab(attachedSession.workingDirectory ?? workingDirectory ?? "", attachedSession.shell ?? fallbackShell, {
        activeCommand: attachedSession.command ?? null,
        attached: true,
        owned: false,
        sessionId: attachedSession.sessionId,
        status: "running",
      });

    if (!existingAttachedTab) {
      tabOutputRef.current[attachedTab.id] = "";
      setWorkspace((current) => ({
        activeTabId: attachedTab.id,
        tabs: [...current.tabs, attachedTab],
      }));
    } else {
      updateTab(attachedTab.id, {
        activeCommand: attachedSession.command ?? null,
        attached: true,
        owned: false,
        shell: attachedSession.shell ?? attachedTab.shell,
        status: "running",
        workingDirectory: attachedSession.workingDirectory ?? attachedTab.workingDirectory,
      });
      selectTab(attachedTab.id);
    }

    activeTabIdRef.current = attachedTab.id;

    const replayKey = createAttachedSessionReplayKey(attachedSession);
    if (!replayedAttachedSessionRef.current.has(replayKey)) {
      replayedAttachedSessionRef.current.add(replayKey);
      const intro = `\r\nAttached to background command: ${attachedSession.command ?? attachedSession.sessionId}\r\n`;
      const recentOutput = attachedSession.initialOutput?.trim()
        ? `Recent output captured before attach:\r\n${attachedSession.initialOutput.endsWith("\n") ? attachedSession.initialOutput : `${attachedSession.initialOutput}\r\n`}`
        : "";
      tabOutputRef.current[attachedTab.id] = trimReplayBuffer(`${tabOutputRef.current[attachedTab.id] ?? ""}${intro}${recentOutput}`);
    }

    window.requestAnimationFrame(() => replayTabOutput(attachedTab.id));
  }, [attachedSession, desktopRuntime, replayTabOutput, selectTab, updateTab, workingDirectory]);

  useEffect(() => {
    const attachedTabs = Object.values(workspaceCacheRef.current)
      .flatMap((projectWorkspace) => projectWorkspace.tabs)
      .filter((tab) => tab.attached && tab.sessionId);

    if (attachedTabs.length === 0) {
      return;
    }

    const unsubscribe = attachedTabs.map((tab) =>
      subscribeBackgroundTerminalSessionOutput(tab.sessionId!, (chunks) => {
        appendTabChunks(tab.id, chunks);
      }),
    );

    return () => {
      for (const stop of unsubscribe) {
        stop();
      }
    };
  }, [appendTabChunks, workspace]);

  useEffect(() => {
    workspaceCacheRef.current[activeProjectKeyRef.current] = workspace;
  }, [workspace]);

  useEffect(() => {
    const nextWorkingDirectory = workingDirectory?.trim() ?? "";
    const nextProjectKey = createProjectKey(workingDirectory);

    if (nextProjectKey === activeProjectKeyRef.current) {
      return;
    }

    const nextWorkspace = workspaceCacheRef.current[nextProjectKey] ?? createInitialWorkspace(nextWorkingDirectory, fallbackShell);
    workspaceCacheRef.current[nextProjectKey] = nextWorkspace;
    activeProjectKeyRef.current = nextProjectKey;
    activeTabIdRef.current = nextWorkspace.activeTabId;
    tabsRef.current = nextWorkspace.tabs;
    setCwdMenuOpen(false);
    setCwdMenuError(null);
    setWorkspaceState(nextWorkspace);
    window.requestAnimationFrame(() => replayTabOutput(nextWorkspace.activeTabId));
  }, [replayTabOutput, workingDirectory]);

  useEffect(() => {
    if (!cwdMenuOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (cwdMenuRef.current?.contains(event.target as Node)) {
        return;
      }

      setCwdMenuOpen(false);
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setCwdMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [cwdMenuOpen]);

  useEffect(() => {
    if (!cwdMenuOpen || !desktopRuntime) {
      return;
    }

    let canceled = false;

    async function loadShortcuts() {
      const shortcuts = new Map<string, string>();
      addShortcut(shortcuts, activeTab?.workingDirectory);
      addShortcut(shortcuts, activeTab?.pendingWorkingDirectory);
      addShortcut(shortcuts, workingDirectory);

      try {
        const drives = await listComputerDrives();

        for (const drive of drives) {
          if (drive.available) {
            addShortcut(shortcuts, drive.path);
          }
        }
      } catch {
        // The native picker remains the primary browsing path if drive listing fails.
      }

      if (!canceled) {
        setDirectoryShortcuts(Array.from(shortcuts.values()).slice(0, 7));
      }
    }

    void loadShortcuts();

    return () => {
      canceled = true;
    };
  }, [activeTab?.pendingWorkingDirectory, activeTab?.workingDirectory, cwdMenuOpen, desktopRuntime, workingDirectory]);

  async function stopActiveSession() {
    if (!activeTab?.sessionId) {
      return;
    }

    const sessionId = activeTab.sessionId;

    try {
      await killTerminalSession(sessionId);
    } catch {
      // Closing a dead session should still leave the UI in a clean stopped state.
    }

    ownedSessionIdsRef.current.delete(sessionId);
    updateTab(activeTab.id, {
      activeCommand: null,
      owned: false,
      sessionId: null,
      status: "stopped",
    });
    writeSystemMessage(activeTab.id, "Terminal session stopped.");
  }

  function clearActiveTerminal() {
    if (!activeTab) {
      return;
    }

    tabOutputRef.current[activeTab.id] = "";
    terminalRef.current?.clear();
  }

  function createNewTab(startDirectory = activeTab?.workingDirectory ?? workingDirectory ?? "", shell = activeTab?.shell ?? fallbackShell) {
    const tab = createTerminalTab(startDirectory, shell);
    tabOutputRef.current[tab.id] = "";
    activeTabIdRef.current = tab.id;
    setWorkspace((current) => ({
      activeTabId: tab.id,
      tabs: [...current.tabs, tab],
    }));
    replayTabOutput(tab.id);
  }

  async function closeTab(tabId: string) {
    const tab = tabsRef.current.find((candidate) => candidate.id === tabId);

    if (!tab) {
      return;
    }

    if (tab.sessionId) {
      try {
        await killTerminalSession(tab.sessionId);
      } catch {
        // Removing the tab is still the expected UI result.
      }

      ownedSessionIdsRef.current.delete(tab.sessionId);
    }

    delete tabOutputRef.current[tabId];
    startingTabIdsRef.current.delete(tabId);

    setWorkspace((current) => {
      const index = current.tabs.findIndex((candidate) => candidate.id === tabId);
      const nextTabs = current.tabs.filter((candidate) => candidate.id !== tabId);

      if (nextTabs.length === 0) {
        const replacement = createTerminalTab(workingDirectory ?? "", fallbackShell);
        tabOutputRef.current[replacement.id] = "";
        activeTabIdRef.current = replacement.id;
        return { activeTabId: replacement.id, tabs: [replacement] };
      }

      const activeTabId = current.activeTabId === tabId ? nextTabs[Math.max(0, index - 1)]?.id ?? nextTabs[0].id : current.activeTabId;
      activeTabIdRef.current = activeTabId;
      window.requestAnimationFrame(() => replayTabOutput(activeTabId));
      return { activeTabId, tabs: nextTabs };
    });
  }

  function handleResizeStart(event: ReactPointerEvent<HTMLElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    const startY = event.clientY;
    const startHeight = height;
    let resizeFrame: number | null = null;
    let pendingClientY = event.clientY;

    function commitHeight() {
      const viewportMax = Math.max(MIN_TERMINAL_HEIGHT, Math.min(MAX_TERMINAL_HEIGHT, window.innerHeight - 156));
      onHeightChange(clamp(startHeight + startY - pendingClientY, MIN_TERMINAL_HEIGHT, viewportMax));
    }

    function updateHeight(clientY: number) {
      pendingClientY = clientY;

      if (resizeFrame !== null) {
        return;
      }

      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = null;
        commitHeight();
        fitTerminal();
      });
    }

    function handlePointerMove(moveEvent: PointerEvent) {
      updateHeight(moveEvent.clientY);
    }

    function stopResize() {
      if (resizeFrame !== null) {
        window.cancelAnimationFrame(resizeFrame);
        resizeFrame = null;
        commitHeight();
        fitTerminal();
      }

      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize, { once: true });
    window.addEventListener("pointercancel", stopResize, { once: true });
  }

  function handleResizeKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      onHeightChange(clamp(height + RESIZE_STEP, MIN_TERMINAL_HEIGHT, MAX_TERMINAL_HEIGHT));
      window.requestAnimationFrame(fitTerminal);
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      onHeightChange(clamp(height - RESIZE_STEP, MIN_TERMINAL_HEIGHT, MAX_TERMINAL_HEIGHT));
      window.requestAnimationFrame(fitTerminal);
    }
  }

  function openCwdMenu() {
    if (!activeTab) {
      return;
    }

    setCwdDraft(activeTab.pendingWorkingDirectory ?? activeTab.workingDirectory);
    setCwdMenuError(null);
    setCwdMenuOpen((value) => !value);
  }

  async function browseForWorkingDirectory() {
    if (!activeTab) {
      return;
    }

    try {
      const picked = await pickComputerFolder(cwdDraft || activeTab.workingDirectory);

      if (!picked) {
        return;
      }

      setCwdDraft(picked);
      await applyWorkingDirectory(picked, "active");
    } catch (error) {
      setCwdMenuError(error instanceof Error ? error.message : String(error));
    }
  }

  async function applyWorkingDirectory(path: string, mode: "active" | "new") {
    const trimmedPath = path.trim();

    if (!trimmedPath || !activeTab) {
      setCwdMenuError("Choose a folder first.");
      return;
    }

    if (mode === "new") {
      setCwdMenuOpen(false);
      createNewTab(trimmedPath, activeTab.shell);
      return;
    }

    if (activeTab.attached && activeTab.status === "running") {
      setCwdMenuError("Open a new terminal for another folder while this command is attached.");
      return;
    }

    updateTab(activeTab.id, {
      pendingWorkingDirectory: null,
      workingDirectory: trimmedPath,
    });
    setCwdMenuOpen(false);

    if (!activeTab.sessionId || activeTab.status === "exited" || activeTab.status === "stopped") {
      await startSession(activeTab.id, Boolean(activeTab.sessionId), trimmedPath);
      return;
    }

    try {
      await writeTerminalSession(activeTab.sessionId, `${createChangeDirectoryCommand(activeTab.shell, trimmedPath)}\r`);
      terminalRef.current?.focus();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      updateTab(activeTab.id, { status: "error" });
      writeSystemMessage(activeTab.id, `Could not change directory: ${detail}`);
    }
  }

  if (!open) {
    return null;
  }

  return (
    <section className="terminal-panel" data-terminal-theme={resolvedTerminalTheme} aria-label="Terminal">
      <div
        className="terminal-resize-handle"
        role="separator"
        aria-label="Resize terminal"
        aria-orientation="horizontal"
        tabIndex={0}
        onKeyDown={handleResizeKeyDown}
        onPointerDown={handleResizeStart}
      />
      <div className="terminal-workspace">
        <aside className="terminal-session-rail" aria-label="Terminal sessions">
          <div className="terminal-session-rail-header">
            <span>Sessions</span>
            <button type="button" aria-label="New terminal session" title="New terminal session" onClick={() => createNewTab()}>
              <Plus size={15} aria-hidden="true" />
            </button>
          </div>
          <div className="terminal-session-list">
            {workspace.tabs.map((tab, index) => (
              <div className="terminal-session-row" data-active={tab.id === workspace.activeTabId} key={tab.id}>
                <button type="button" className="terminal-session-tab" aria-current={tab.id === workspace.activeTabId ? "true" : undefined} onClick={() => selectTab(tab.id)}>
                  <span className="terminal-session-status" data-status={tab.status} />
                  <span className="terminal-session-copy">
                    <strong>{formatSessionTitle(tab, index)}</strong>
                    <small title={tab.workingDirectory}>{formatDirectoryShortName(tab.workingDirectory)}</small>
                  </span>
                </button>
                <button type="button" className="terminal-session-close" aria-label={`Close ${formatSessionTitle(tab, index)}`} title="Close session" onClick={() => void closeTab(tab.id)}>
                  <X size={13} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        </aside>
        <div className="terminal-main">
          <header className="terminal-toolbar">
            <div className="terminal-title">
              <SquareTerminal size={18} aria-hidden="true" />
              <strong>{activeTab ? terminalShellLabel(activeTab.shell) : "Terminal"}</strong>
              <span data-status={activeTab?.status ?? "stopped"}>{activeStatusLabel}</span>
              {activeTab?.activeCommand ? <em title={activeTab.activeCommand}>{activeTab.activeCommand}</em> : null}
            </div>
            <div className="terminal-location" ref={cwdMenuRef}>
              <button type="button" className="terminal-cwd-button" aria-expanded={cwdMenuOpen} aria-haspopup="dialog" title={activeTab?.workingDirectory || "Choose folder"} onClick={openCwdMenu}>
                <span>cwd</span>
                <code>{activeTab?.pendingWorkingDirectory ?? activeTab?.workingDirectory ?? "Choose folder"}</code>
                <ChevronsUpDown size={14} aria-hidden="true" />
              </button>
              {cwdMenuOpen ? (
                <div className="terminal-cwd-popover" role="dialog" aria-label="Terminal working directory">
                  <label>
                    <span>Folder</span>
                    <input value={cwdDraft} spellCheck={false} onChange={(event) => setCwdDraft(event.target.value)} onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void applyWorkingDirectory(cwdDraft, "active");
                      }
                    }} />
                  </label>
                  <div className="terminal-cwd-popover-actions">
                    <button type="button" onClick={() => void browseForWorkingDirectory()}>
                      <FolderOpen size={15} aria-hidden="true" />
                      Browse
                    </button>
                    <button type="button" onClick={() => void applyWorkingDirectory(cwdDraft, "active")}>Open</button>
                    <button type="button" onClick={() => void applyWorkingDirectory(cwdDraft, "new")}>New session</button>
                  </div>
                  {directoryShortcuts.length > 0 ? (
                    <div className="terminal-cwd-shortcuts" aria-label="Folder shortcuts">
                      {directoryShortcuts.map((path) => (
                        <button type="button" title={path} key={path} onClick={() => void applyWorkingDirectory(path, "active")}>
                          {formatDirectoryShortName(path)}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {cwdMenuError ? <p>{cwdMenuError}</p> : null}
                </div>
              ) : null}
            </div>
            <label className="terminal-shell-select">
              <span className="sr-only">Shell</span>
              <select
                value={activeTab?.shell ?? fallbackShell}
                onChange={(event) => {
                  if (activeTab) {
                    updateTab(activeTab.id, { shell: event.target.value as TerminalShellId });
                  }
                }}
                disabled={Boolean(activeTab?.sessionId)}
              >
                {shellOptions.map((option) => (
                  <option value={option} key={option}>
                    {terminalShellLabel(option)}
                  </option>
                ))}
              </select>
            </label>
            <div className="terminal-actions">
              <button type="button" aria-label="Restart terminal session" title="Restart terminal session" disabled={!activeTab || Boolean(activeTab.attached && activeTab.sessionId === attachedSession?.sessionId)} onClick={() => activeTab && void startSession(activeTab.id, true, activeTab.pendingWorkingDirectory ?? undefined)}>
                <RotateCw size={16} aria-hidden="true" />
              </button>
              <button type="button" aria-label="Stop terminal session" title="Stop terminal session" disabled={!activeTab?.sessionId} onClick={() => void stopActiveSession()}>
                <Square size={15} aria-hidden="true" />
              </button>
              <button type="button" aria-label="Clear terminal output" title="Clear terminal output" disabled={!activeTab} onClick={clearActiveTerminal}>
                <Trash2 size={16} aria-hidden="true" />
              </button>
              <button type="button" aria-label="Hide terminal" title="Hide terminal" onClick={onClose}>
                <PanelBottomClose size={17} aria-hidden="true" />
              </button>
            </div>
          </header>
          <div className="terminal-output" ref={terminalHostRef} onClick={() => terminalRef.current?.focus()}>
            {!desktopRuntime ? <div className="terminal-unavailable">Open the desktop app to run terminal sessions.</div> : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function createInitialWorkspace(workingDirectory?: string, shell: TerminalShellId = getDefaultTerminalShell()): TerminalWorkspaceState {
  const tab = createTerminalTab(workingDirectory ?? "", shell);

  return {
    activeTabId: tab.id,
    tabs: [tab],
  };
}

function createProjectKey(workingDirectory?: string | null) {
  const normalized = (workingDirectory ?? "").trim().replace(/[\\/]+$/, "");
  return normalized ? normalized.toLowerCase() : "__gilbert-no-project__";
}

function createTerminalTab(workingDirectory: string, shell: TerminalShellId = getDefaultTerminalShell(), patch: Partial<TerminalTab> = {}): TerminalTab {
  terminalTabCounter += 1;

  return {
    activeCommand: null,
    attached: false,
    id: `terminal-tab-${Date.now()}-${terminalTabCounter}`,
    owned: false,
    pendingWorkingDirectory: null,
    sessionId: null,
    shell,
    status: "stopped",
    workingDirectory,
    ...patch,
  };
}

function addShortcut(shortcuts: Map<string, string>, path?: string | null) {
  const normalized = path?.trim();

  if (normalized) {
    shortcuts.set(normalized.toLowerCase(), normalized);
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function createChangeDirectoryCommand(shell: TerminalShellId, path: string) {
  if (shell === "powershell") {
    return `Set-Location -LiteralPath ${quotePowerShellString(path)}`;
  }

  if (shell === "cmd") {
    return `cd /d ${quoteCmdString(path)}`;
  }

  return `cd ${quotePosixString(path)}`;
}

function quotePowerShellString(value: string) {
  return `'${value.split("'").join("''")}'`;
}

function quoteCmdString(value: string) {
  return `"${value.split('"').join('""')}"`;
}

function quotePosixString(value: string) {
  return `'${value.split("'").join("'\\''")}'`;
}

function formatDirectoryShortName(path: string) {
  const trimmed = path.trim();

  if (!trimmed) {
    return "No folder";
  }

  const withoutTrailingSlash = trimmed.replace(/[\\/]+$/, "");
  const parts = withoutTrailingSlash.split(/[\\/]+/);
  return parts[parts.length - 1] || withoutTrailingSlash || trimmed;
}

function formatSessionTitle(tab: TerminalTab, index: number) {
  if (tab.attached && tab.activeCommand) {
    return "Attached";
  }

  return `${terminalShellLabel(tab.shell)} ${index + 1}`;
}

function attachedTerminalTabMatchesSession(tab: TerminalTab, session: TerminalAttachedSession) {
  if (!tab.attached || !tab.activeCommand || !session.command) {
    return false;
  }

  return normalizeAttachedCommandKey(tab.activeCommand) === normalizeAttachedCommandKey(session.command)
    && normalizeAttachedPathKey(tab.workingDirectory) === normalizeAttachedPathKey(session.workingDirectory);
}

function createAttachedSessionReplayKey(session: TerminalAttachedSession) {
  const commandKey = normalizeAttachedCommandKey(session.command);
  const pathKey = normalizeAttachedPathKey(session.workingDirectory);

  return commandKey && pathKey
    ? `command:${commandKey}\ncwd:${pathKey}`
    : `session:${session.sessionId}`;
}

function normalizeAttachedCommandKey(value: string | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeAttachedPathKey(value: string | undefined) {
  return (value ?? "").trim().replace(/[\\/]+$/, "").toLowerCase();
}

function isTerminalDrainTimeout(detail: string) {
  return /terminal output drain did not respond|terminal output drain timed out|timed out/i.test(detail);
}

function getStatusLabel(status: TerminalStatus, desktopRuntime: boolean) {
  if (!desktopRuntime) {
    return "Desktop required";
  }

  if (status === "starting") {
    return "Starting";
  }

  if (status === "connected") {
    return "Ready";
  }

  if (status === "running") {
    return "Running";
  }

  if (status === "exited") {
    return "Exited";
  }

  if (status === "error") {
    return "Needs attention";
  }

  if (status === "unavailable") {
    return "Unavailable";
  }

  return "Stopped";
}

function inferWorkingDirectoryFromTerminalOutput(output: string, shell: TerminalShellId) {
  const tail = output.slice(-4096).replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");

  if (shell === "powershell") {
    const matches = Array.from(tail.matchAll(/(?:^|[\r\n])PS ([A-Za-z]:\\[^\r\n>]*|\\\\[^\r\n>]+)> ?/g));
    return matches[matches.length - 1]?.[1]?.trim() ?? null;
  }

  if (shell === "cmd") {
    const matches = Array.from(tail.matchAll(/(?:^|[\r\n])([A-Za-z]:\\[^\r\n>]*|\\\\[^\r\n>]+)> ?/g));
    return matches[matches.length - 1]?.[1]?.trim() ?? null;
  }

  return null;
}

function readResolvedTerminalTheme(): ResolvedTerminalTheme {
  if (typeof document !== "undefined") {
    const theme = document.documentElement.dataset.theme;

    if (theme === "light" || theme === "dark") {
      return theme;
    }
  }

  if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: light)").matches) {
    return "light";
  }

  return "dark";
}

function readTerminalCssTheme(): ITheme {
  const resolvedTheme = readResolvedTerminalTheme();
  const fallback = TERMINAL_THEME_FALLBACKS[resolvedTheme];

  if (typeof document === "undefined" || typeof window === "undefined") {
    return { ...fallback };
  }

  const styles = window.getComputedStyle(document.documentElement);
  const readColor = (name: string, fallbackColor: string | undefined) => styles.getPropertyValue(name).trim() || fallbackColor || "";
  const background = readColor("--terminal-output-bg", fallback.background);
  const foreground = readColor("--terminal-text", fallback.foreground);
  const muted = readColor("--terminal-muted", fallback.brightBlack);
  const accent = readColor("--terminal-accent", fallback.blue);
  const command = readColor("--terminal-command", fallback.cyan);
  const success = readColor("--terminal-success", fallback.green);
  const warning = readColor("--terminal-warning", fallback.yellow);
  const danger = readColor("--terminal-error", fallback.red);
  const violet = readColor("--violet", fallback.magenta);
  const scrollbar = readColor("--terminal-scrollbar-thumb", fallback.scrollbarSliderBackground);

  return {
    ...fallback,
    background,
    black: readColor("--terminal-panel-bg", fallback.black),
    blue: accent,
    brightBlack: muted,
    brightBlue: accent,
    brightCyan: command,
    brightGreen: success,
    brightMagenta: violet,
    brightRed: danger,
    brightWhite: foreground,
    brightYellow: warning,
    cursor: readColor("--terminal-cursor", fallback.cursor),
    cursorAccent: readColor("--terminal-cursor-accent", background),
    cyan: command,
    foreground,
    green: success,
    magenta: violet,
    red: danger,
    scrollbarSliderBackground: scrollbar,
    scrollbarSliderHoverBackground: scrollbar,
    selectionBackground: readColor("--terminal-selection-bg", fallback.selectionBackground),
    selectionForeground: readColor("--terminal-selection-fg", fallback.selectionForeground),
    white: foreground,
    yellow: warning,
  };
}

function trimReplayBuffer(value: string) {
  if (value.length <= MAX_REPLAY_BUFFER_CHARS) {
    return value;
  }

  return value.slice(value.length - MAX_REPLAY_BUFFER_CHARS);
}
