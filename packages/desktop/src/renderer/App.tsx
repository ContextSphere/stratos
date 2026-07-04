import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import {
  getAgentModes,
  normalizeMode,
  type AgentMode,
  type ProviderType,
} from "./utils/modes";

const KNOWN_PROVIDERS = new Set<string>([
  "claude-code",
  "codex",
  "opencode",
  "copilot",
]);
function normalizeProvider(p: string | undefined): ProviderType {
  return (p && KNOWN_PROVIDERS.has(p) ? p : "claude-code") as ProviderType;
}
import type { ImageAttachment, FileAttachment } from "@stratosapp/ui";
import {
  Sidebar,
  ChatView,
  type ChatViewHandle,
  InputBar,
  type InputBarRef,
  type InteractiveMode,
  PermissionDialog,
  PreviewPane,
  ChatInfoBar,
  type SessionStats,
  ContextUsageIndicator,
  ToolsBadge,
  useTodoData,
  ModelSelector,
  ModeToggle,
  WorktreeToggle,
  ProviderToggle,
  ThemeContext,
  DiagnosticsProvider,
  useDiagnostics,
  DiagnosticToastContainer,
  TerminalPane,
  StratosProvider,
  useStratos,
} from "@stratosapp/ui";

import { Group, Panel, Separator } from "react-resizable-panels";
import { useChat } from "./hooks/useChat";
import { useThreads } from "./hooks/useThreads";
import { useFolders } from "./hooks/useFolders";
import { useNavHistory } from "./hooks/useNavHistory";
import type { NavEntry, NavAnchor } from "./navigation/types";
import { useGitHub } from "./hooks/useGitHub";
import { useClaude } from "./hooks/useClaude";
import { useCodex } from "./hooks/useCodex";
import { useOpencodeStatus } from "./hooks/useOpencodeStatus";
import { usePreview } from "./hooks/usePreview";
import { useSessionChanges } from "@stratosapp/ui";
import { useGitStatus } from "./hooks/useGitStatus";
import { ConnectGitHubDialog } from "./components/ConnectGitHubDialog";
import { ConnectClaudeDialog } from "./components/ConnectClaudeDialog";
import { ConnectCodexDialog } from "./components/ConnectCodexDialog";
import { OpencodeSettingsDialog } from "./components/OpencodeSettingsDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { ScheduledPromptsDialog } from "./components/ScheduledPromptsDialog";
import { NewThreadDialog } from "./components/NewThreadDialog";
import { createDesktopBridge } from "./bridge";

export default function App(): React.ReactElement {
  const bridge = useMemo(() => createDesktopBridge(), []);
  return (
    <StratosProvider value={bridge}>
      <DiagnosticsProvider>
        <AppInner />
      </DiagnosticsProvider>
    </StratosProvider>
  );
}

function AppInner(): React.ReactElement {
  const {
    settings: settingsBridge,
    threads: threadsBridge,
    chat: chatBridge,
    files: filesBridge,
  } = useStratos();
  const { report, toasts, dismiss } = useDiagnostics();
  const {
    threads,
    activeThreadId,
    activeThread,
    setActiveThreadId,
    createThread,
    deleteThread,
    refreshThreads,
  } = useThreads();

  const { folders, addFolder, removeFolder, updateFolder } = useFolders();

  // Manager thread ID — only fetched when the Manager Agent setting is on. When
  // off (the default), the manager thread stays hidden from the sidebar and
  // `isManagerActive` stays false, so the app behaves as if there is no Manager.
  const [managerThreadId, setManagerThreadId] = useState<string | null>(null);
  // `null` = still loading; important so we don't flash-hide the Manager row
  // while the IPC call is in-flight for users who have Manager enabled.
  const [managerEnabled, setManagerEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    window.api
      .managerIsEnabled()
      .then((enabled) => {
        setManagerEnabled(enabled);
        if (!enabled) return;
        return window.api.managerGetThreadId().then(setManagerThreadId);
      })
      .catch(() => setManagerEnabled(false));
  }, []);

  // When Manager is off, filter any stale `isManagerThread` records out of the
  // sidebar. The records stay in storage — flipping the setting on brings the
  // Manager thread (and its transcript) back.
  const visibleThreads = useMemo(
    () =>
      managerEnabled === false
        ? threads.filter((t) => !t.isManagerThread)
        : threads,
    [threads, managerEnabled],
  );

  const isManagerActive =
    activeThreadId != null && activeThreadId === managerThreadId;

  // Reset activeThreadId if it points to a thread not visible in any folder
  // (but never reset if it's the manager thread)
  useEffect(() => {
    if (activeThreadId && activeThread && !activeThread.isManagerThread) {
      const folderPaths = new Set(folders.map((f) => f.path));
      const threadFolder =
        activeThread.worktree?.sourceRepoPath ?? activeThread.cwd;
      if (!threadFolder || !folderPaths.has(threadFolder)) {
        setActiveThreadId(null);
      }
    }
  }, [activeThreadId, activeThread, folders, setActiveThreadId]);

  const {
    messages,
    isStreaming,
    permissionRequest,
    sessionStats,
    interactiveMode,
    sendMessage,
    interrupt,
    respondPermission,
    respondQuestion,
    respondPlanReview,
    handleInteractiveResponse,
    updateTaskExpanded,
    slashCommands,
    runningThreadIds,
    threadNotifications,
    pendingPermissionThreadIds,
    sessionTools,
    mcpServers,
    fetchMcpStatus,
    contextUsage,
    refreshContextUsage,
  } = useChat(activeThreadId, { onThreadUpdated: refreshThreads });

  const [enabledProviders, setEnabledProviders] = useState<
    ProviderType[] | null
  >(null);
  useEffect(() => {
    window.api.getAppInfo().then((info) => {
      if (Array.isArray(info.enabledProviders)) {
        setEnabledProviders(info.enabledProviders as ProviderType[]);
      } else {
        setEnabledProviders(["claude-code", "codex", "opencode", "copilot"]);
      }
    });
  }, []);
  const codexEnabled = enabledProviders?.includes("codex") ?? false;

  const github = useGitHub();
  const claude = useClaude();
  const codex = useCodex(codexEnabled);
  const opencode = useOpencodeStatus();
  const {
    preview,
    openUrl,
    openMarkdown,
    openArtifactEditor,
    openFileExplorer,
    openFileChanges,
    close: closePreview,
  } = usePreview(activeThreadId);
  const sessionChanges = useSessionChanges(messages);
  const gitStatus = useGitStatus(activeThread?.cwd, isStreaming);
  const { latestTodoData, showTaskPanel, setShowTaskPanel } = useTodoData(
    messages,
    activeThreadId,
  );

  const [showClaudeDialog, setShowClaudeDialog] = useState(false);
  const [showGitHubDialog, setShowGitHubDialog] = useState(false);
  const [showCodexDialog, setShowCodexDialog] = useState(false);
  const [showOpencodeDialog, setShowOpencodeDialog] = useState(false);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [showSchedulesDialog, setShowSchedulesDialog] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [pendingMode, setPendingMode] = useState<AgentMode>();
  const [pendingProvider, setPendingProvider] =
    useState<ProviderType>("claude-code");
  const [homeDir, setHomeDir] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showBottomTerminal, setShowBottomTerminal] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(280);
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const terminalDragRef = useRef<{
    startY: number;
    startHeight: number;
  } | null>(null);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [showNewThreadDialog, setShowNewThreadDialog] = useState(false);
  const inputRef = useRef<InputBarRef | null>(null);
  const draftsRef = useRef<
    Map<
      string,
      {
        text: string;
        images: ImageAttachment[];
        fileAttachments?: FileAttachment[];
      }
    >
  >(new Map());
  const prevActiveThreadIdRef = useRef<string | null>(null);
  const [draftThreadIds, setDraftThreadIds] = useState<Set<string>>(new Set());

  // Navigation history refs
  const chatViewRef = useRef<ChatViewHandle | null>(null);
  /** Mirror of activeThreadId for use in callbacks without stale closures */
  const activeThreadIdRef = useRef<string | null>(null);
  /** Current scroll anchor in the active thread */
  const currentAnchorRef = useRef<NavAnchor>({ type: "latest" });
  /** True while a programmatic back/forward navigation is in flight */
  const isNavigatingRef = useRef(false);
  /** Pending cross-thread scroll to apply once messages load */
  const pendingNavRef = useRef<{
    targetThreadId: string;
    anchor: NavAnchor;
  } | null>(null);
  /** Tracks the last activeThreadId seen by the pending-nav effect, so we skip
   *  the first fire (where messages are still from the old thread) */
  const lastEffectThreadRef = useRef<string | null>(null);

  // Fetch home directory
  useEffect(() => {
    settingsBridge.getHomeDirectory().then(setHomeDir);
  }, [settingsBridge]);

  // Load persisted theme on startup
  useEffect(() => {
    settingsBridge.getSettings?.().then((s) => {
      if (!s) return;
      const t = (s.theme as "dark" | "light") ?? "dark";
      setTheme(t);
      document.documentElement.setAttribute("data-theme", t);
    });
  }, [settingsBridge]);

  const handleThemeChange = useCallback(
    async (t: "dark" | "light") => {
      setTheme(t);
      document.documentElement.setAttribute("data-theme", t);
      await settingsBridge.updateSettings?.({ theme: t });
    },
    [settingsBridge],
  );

  // Helper: save the current InputBar draft for a given threadId
  const saveDraft = useCallback((threadId: string) => {
    const text = inputRef.current?.getText() ?? "";
    const images = inputRef.current?.getImages() ?? [];
    const fileAttachments = inputRef.current?.getFileAttachments() ?? [];
    if (text || images.length > 0 || fileAttachments.length > 0) {
      draftsRef.current.set(threadId, { text, images, fileAttachments });
      setDraftThreadIds((prev) => new Set([...prev, threadId]));
    } else {
      draftsRef.current.delete(threadId);
      setDraftThreadIds((prev) => {
        const next = new Set(prev);
        next.delete(threadId);
        return next;
      });
    }
  }, []);

  // Restore draft when activeThreadId changes
  useEffect(() => {
    prevActiveThreadIdRef.current = activeThreadId;
    activeThreadIdRef.current = activeThreadId;
    // Reset anchor to "latest" when thread changes (unless navigation is setting it)
    if (!isNavigatingRef.current) {
      currentAnchorRef.current = { type: "latest" };
    }
    if (activeThreadId) {
      const draft = draftsRef.current.get(activeThreadId);
      inputRef.current?.prefillDraft(
        draft?.text ?? "",
        draft?.images ?? [],
        draft?.fileAttachments,
      );
    }
  }, [activeThreadId]);

  // Apply pending cross-thread scroll once the new thread's messages have loaded.
  // We skip the first effect fire after a thread switch because messages may still
  // be from the previous thread (useChat loads asynchronously).
  useEffect(() => {
    const nav = pendingNavRef.current;
    if (!nav || !chatViewRef.current) return;
    if (nav.targetThreadId !== activeThreadId) return;

    // Skip first fire after the thread changed — messages might be stale
    if (lastEffectThreadRef.current !== activeThreadId) {
      lastEffectThreadRef.current = activeThreadId;
      return;
    }

    // Messages have now loaded for this thread — apply the scroll
    pendingNavRef.current = null;
    isNavigatingRef.current = false;
    if (nav.anchor.type === "latest") {
      chatViewRef.current.scrollToBottom();
    } else {
      chatViewRef.current.scrollToMessage(nav.anchor.messageId);
    }
  }, [messages, activeThreadId]);

  /** Called by useNavHistory when the user presses back/forward */
  const handleNavigation = useCallback(
    (entry: NavEntry) => {
      isNavigatingRef.current = true;
      currentAnchorRef.current = entry.anchor;

      if (entry.threadId !== activeThreadIdRef.current) {
        // Cross-thread navigation — store pending scroll and switch thread
        pendingNavRef.current = {
          targetThreadId: entry.threadId,
          anchor: entry.anchor,
        };
        const fromThreadId = prevActiveThreadIdRef.current;
        if (fromThreadId) saveDraft(fromThreadId);
        closePreview();
        setActiveThreadId(entry.threadId).catch(() => {
          isNavigatingRef.current = false;
          pendingNavRef.current = null;
        });
      } else {
        // Same thread — scroll directly, no thread switch needed
        requestAnimationFrame(() => {
          if (entry.anchor.type === "latest") {
            chatViewRef.current?.scrollToBottom();
          } else {
            chatViewRef.current?.scrollToMessage(entry.anchor.messageId);
          }
          isNavigatingRef.current = false;
        });
      }
    },
    [saveDraft, closePreview, setActiveThreadId],
  );

  const navHistory = useNavHistory(handleNavigation);

  /** Called by ChatView when the user's scroll position settles */
  const handleAnchorChange = useCallback(
    (anchor: NavAnchor) => {
      currentAnchorRef.current = anchor;
      if (activeThreadIdRef.current) {
        navHistory.updateCurrentAnchor({
          threadId: activeThreadIdRef.current,
          anchor,
        });
      }
    },
    [navHistory],
  );

  const handleThreadClick = useCallback(
    async (threadId: string) => {
      // Ignore clicks triggered by programmatic back/forward navigation
      if (isNavigatingRef.current) return;

      const fromId = prevActiveThreadIdRef.current;
      // Save current draft BEFORE switching (inputRef still points to the current InputBar)
      if (fromId && fromId !== threadId) {
        saveDraft(fromId);
        // Record where we are in the departing thread
        navHistory.push({ threadId: fromId, anchor: currentAnchorRef.current });
      }
      closePreview();
      currentAnchorRef.current = { type: "latest" };
      await setActiveThreadId(threadId);
      // Record the landing location in the new thread
      navHistory.push({ threadId, anchor: { type: "latest" } });
    },
    [setActiveThreadId, closePreview, saveDraft, navHistory],
  );

  const handleAddFolder = useCallback(async () => {
    const result = await settingsBridge.selectDirectory();
    if (result.canceled || !result.path) return;
    const folder = await addFolder(result.path);
    // Detect git repo
    const isGit = await settingsBridge.checkIsGitRepo?.(result.path);
    if (isGit) {
      await updateFolder(folder.id, { isGitRepo: true });
    }
  }, [addFolder, updateFolder, settingsBridge]);

  const handleToggleFolderCollapsed = useCallback(
    (folderId: string, collapsed: boolean) =>
      updateFolder(folderId, { collapsed }),
    [updateFolder],
  );

  const handleCreateThreadInFolder = useCallback(
    async (folderId: string) => {
      const folder = folders.find((f) => f.id === folderId);
      if (!folder) return;
      const thread = await createThread(
        "New chat",
        undefined,
        folder.path,
        pendingProvider,
      );
      // Use folder's git repo info
      if (folder.isGitRepo) {
        await threadsBridge.update(thread.id, {
          isGitRepo: true,
          worktreeMode: "local",
        });
        await refreshThreads();
      }
      await setActiveThreadId(thread.id);
      inputRef.current?.focus();
    },
    [
      folders,
      createThread,
      setActiveThreadId,
      refreshThreads,
      pendingProvider,
      threadsBridge,
    ],
  );

  const handleNewThreadFromFolder = useCallback(
    async (folder: (typeof folders)[0]) => {
      setShowNewThreadDialog(false);
      const thread = await createThread(
        "New chat",
        undefined,
        folder.path,
        pendingProvider,
      );
      if (folder.isGitRepo) {
        await threadsBridge.update(thread.id, {
          isGitRepo: true,
          worktreeMode: "local",
        });
        await refreshThreads();
      }
      await setActiveThreadId(thread.id);
      inputRef.current?.focus();
    },
    [
      createThread,
      setActiveThreadId,
      refreshThreads,
      pendingProvider,
      threadsBridge,
    ],
  );

  const handleNewThreadBrowse = useCallback(async () => {
    setShowNewThreadDialog(false);
    const result = await settingsBridge.selectDirectory();
    if (result.canceled || !result.path) return;
    let folder = folders.find((f) => f.path === result.path);
    if (!folder) {
      folder = await addFolder(result.path);
      const isGit = await settingsBridge.checkIsGitRepo?.(result.path);
      if (isGit) {
        await updateFolder(folder.id, { isGitRepo: true });
        folder = { ...folder, isGitRepo: true };
      }
    }
    await handleNewThreadFromFolder(folder);
  }, [
    folders,
    addFolder,
    updateFolder,
    handleNewThreadFromFolder,
    settingsBridge,
  ]);

  const handleDeleteThread = useCallback(
    async (id: string) => {
      // Prevent deletion of the Manager thread
      if (id === managerThreadId) return;
      draftsRef.current.delete(id);
      setDraftThreadIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      await deleteThread(id);
    },
    [deleteThread, managerThreadId],
  );

  const handleSend = useCallback(
    async (
      prompt: string,
      images?: ImageAttachment[],
      fileAttachments?: FileAttachment[],
    ) => {
      let threadId = activeThreadId;

      // Route to Manager Agent if active thread is the manager
      if (threadId && threadId === managerThreadId) {
        const managerId = threadId;
        const ipcImages = images?.map((img) => ({
          dataUrl: img.dataUrl,
          mimeType: img.mimeType,
        }));
        await window.api.managerSend(prompt, ipcImages);
        draftsRef.current.delete(managerId);
        setDraftThreadIds((prev) => {
          const next = new Set(prev);
          next.delete(managerId);
          return next;
        });
        return;
      }

      if (!threadId) {
        // Open folder picker
        const result = await settingsBridge.selectDirectory();
        if (result.canceled || !result.path) return;

        // Add folder if not already registered
        let folder = folders.find((f) => f.path === result.path);
        if (!folder) {
          folder = await addFolder(result.path);
          const isGit = await settingsBridge.checkIsGitRepo?.(result.path);
          if (isGit) {
            await updateFolder(folder.id, { isGitRepo: true });
          }
        }

        // Create thread in that folder
        const thread = await createThread(
          "New chat",
          undefined,
          folder.path,
          pendingProvider,
        );
        if (folder.isGitRepo) {
          await threadsBridge.update(thread.id, {
            isGitRepo: true,
            worktreeMode: "local",
          });
          await refreshThreads();
        }
        await setActiveThreadId(thread.id);
        threadId = thread.id;

        if (pendingMode) {
          await threadsBridge.update(threadId, { mode: pendingMode });
          await refreshThreads();
        }
      }

      await sendMessage(prompt, threadId, images, fileAttachments);
      // Clear draft for this thread since it was sent
      draftsRef.current.delete(threadId);
      setDraftThreadIds((prev) => {
        const next = new Set(prev);
        next.delete(threadId);
        return next;
      });
    },
    [
      activeThreadId,
      managerThreadId,
      sendMessage,
      folders,
      addFolder,
      updateFolder,
      createThread,
      setActiveThreadId,
      refreshThreads,
      pendingProvider,
      pendingMode,
      settingsBridge,
      threadsBridge,
    ],
  );

  // Wrap interrupt to route manager thread through manager IPC
  const handleInterrupt = useCallback(async () => {
    if (isManagerActive) {
      await window.api.managerInterrupt();
    } else {
      await interrupt();
    }
  }, [isManagerActive, interrupt]);

  const handleModelChange = useCallback(
    async (model: string) => {
      if (!activeThreadId) return;
      await threadsBridge.update(activeThreadId, { model });
      await refreshThreads();
      const provider = activeThread?.provider ?? "claude-code";
      await settingsBridge.updateSettings?.({
        providers: { [provider]: { lastUsedModel: model } },
      });
    },
    [
      activeThreadId,
      activeThread,
      refreshThreads,
      threadsBridge,
      settingsBridge,
    ],
  );

  const handleThinkingEffortChange = useCallback(
    async (effort: string) => {
      if (!activeThreadId) return;
      await threadsBridge.update(activeThreadId, {
        thinkingEffort: effort as "low" | "medium" | "high" | "max",
      });
      await refreshThreads();
      const provider = activeThread?.provider ?? "claude-code";
      await settingsBridge.updateSettings?.({
        providers: { [provider]: { lastUsedEffort: effort } },
      });
    },
    [
      activeThreadId,
      activeThread,
      refreshThreads,
      threadsBridge,
      settingsBridge,
    ],
  );

  const handleModeChange = useCallback(
    async (mode: AgentMode) => {
      if (isManagerActive) return;
      if (!activeThreadId) {
        setPendingMode(mode);
        return;
      }
      await threadsBridge.update(activeThreadId, { mode });
      await refreshThreads();
    },
    [activeThreadId, isManagerActive, refreshThreads, threadsBridge],
  );

  const handleProviderChange = useCallback(
    async (provider: ProviderType) => {
      if (!activeThreadId) {
        setPendingProvider(provider);
        setPendingMode((prev) => (prev ? normalizeMode(prev, provider) : prev));
        return;
      }
      // Each provider has its own model namespace (e.g. claude-code's
      // `opus[1m]` is meaningless to opencode). Carry over the user's
      // last-used model for the destination provider so the picker reflects
      // the new scope immediately. Falls back to undefined → ModelSelector
      // picks the first available entry from the refetched list.
      const settings = await settingsBridge.getSettings?.();
      const providersMap = (settings?.providers ?? {}) as Record<
        string,
        { lastUsedModel?: string }
      >;
      const nextModel = providersMap[provider]?.lastUsedModel;

      // The Manager thread needs a full session reset on provider switch:
      // each provider has its own conversation-persistence scheme, so
      // carrying state across a switch leaves the transcript broken. The
      // manager-side handler (managerSwitchProvider) disposes the provider,
      // clears the stored sessionId + disk messages, and broadcasts a
      // refresh. Regular threads keep the simpler behaviour below.
      if (activeThreadId === managerThreadId) {
        await window.api.managerSwitchProvider(provider, nextModel);
        await refreshThreads();
        return;
      }
      await threadsBridge.update(activeThreadId, {
        provider,
        model: nextModel,
        mode: normalizeMode(activeThread?.mode, provider),
      });
      await refreshThreads();
    },
    [
      activeThread?.mode,
      activeThreadId,
      managerThreadId,
      refreshThreads,
      settingsBridge,
      threadsBridge,
    ],
  );

  const handleWorktreeModeChange = useCallback(
    async (mode: "local" | "worktree") => {
      if (!activeThreadId) return;
      await threadsBridge.update(activeThreadId, { worktreeMode: mode });
      await refreshThreads();
    },
    [activeThreadId, refreshThreads, threadsBridge],
  );

  const handleToggleFileExplorer = useCallback(() => {
    if (preview.isOpen && preview.type === "file-explorer") {
      closePreview();
    } else if (activeThread?.cwd) {
      openFileExplorer(activeThread.cwd);
    }
  }, [preview, closePreview, openFileExplorer, activeThread]);

  const handleToggleTerminal = useCallback(() => {
    if (!activeThread?.cwd) return;
    setShowBottomTerminal((prev) => !prev);
  }, [activeThread]);

  const handleTerminalResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      terminalDragRef.current = {
        startY: e.clientY,
        startHeight: terminalHeight,
      };
      const onMouseMove = (ev: MouseEvent) => {
        if (!terminalDragRef.current) return;
        const delta = terminalDragRef.current.startY - ev.clientY;
        const newHeight = Math.max(
          80,
          Math.min(800, terminalDragRef.current.startHeight + delta),
        );
        // Update DOM directly — no React re-render during drag
        if (terminalContainerRef.current) {
          terminalContainerRef.current.style.height = `${newHeight}px`;
        }
        terminalDragRef.current.startHeight = newHeight;
        terminalDragRef.current.startY = ev.clientY;
      };
      const onMouseUp = () => {
        if (terminalContainerRef.current) {
          const h = parseInt(terminalContainerRef.current.style.height, 10);
          if (!isNaN(h)) setTerminalHeight(h);
        }
        terminalDragRef.current = null;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [terminalHeight],
  );

  const handleLinkClick = useCallback(
    (href: string) => {
      const value = href.trim();
      if (!value) return;

      // Web and mailto links open in the system's default browser/handler.
      if (/^(https?|mailto):/i.test(value)) {
        window.api.openExternal(value);
        return;
      }
      // Other protocol-style URLs (e.g. file://, ftp://) fall back to preview.
      if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(value)) {
        openUrl(value);
        return;
      }

      const hashLineMatch = value.match(/#L(\d+)(?:C(\d+))?$/i);
      const colonLineMatch = value.match(/:(\d+)(?::(\d+))?$/);
      const line =
        hashLineMatch && hashLineMatch[1]
          ? Number(hashLineMatch[1])
          : colonLineMatch && colonLineMatch[1]
            ? Number(colonLineMatch[1])
            : undefined;
      const lineNumber =
        line && Number.isFinite(line) && line > 0 ? line : undefined;

      // Remove optional line/column suffixes from file references.
      const withoutFragment = value.replace(/#L\d+(?:C\d+)?$/i, "");
      const withoutLine = withoutFragment.replace(/:\d+(?::\d+)?$/, "");

      // Absolute local file path (macOS/Linux) -> open file explorer.
      if (withoutLine.startsWith("/")) {
        if (
          activeThread?.cwd &&
          withoutLine.startsWith(activeThread.cwd + "/")
        ) {
          openFileExplorer(activeThread.cwd, withoutLine, lineNumber);
          return;
        }
        const lastSlash = withoutLine.lastIndexOf("/");
        const dir =
          lastSlash > 0 ? withoutLine.slice(0, lastSlash) : withoutLine;
        openFileExplorer(dir, withoutLine, lineNumber);
        return;
      }

      // Relative repo path reference -> open current thread's explorer root at exact file.
      if (activeThread?.cwd && /^[\w./-]+$/.test(withoutLine)) {
        const relativePath = withoutLine.replace(/^\.?\//, "");
        const root = activeThread.cwd.replace(/\/+$/, "");
        const targetPath = `${root}/${relativePath}`;
        openFileExplorer(activeThread.cwd, targetPath, lineNumber);
        return;
      }

      openUrl(value);
    },
    [activeThread?.cwd, openFileExplorer, openUrl],
  );

  const handleViewFile = useCallback(
    (filePath: string) => {
      const lastSlash = filePath.lastIndexOf("/");
      const dir = lastSlash > 0 ? filePath.slice(0, lastSlash) : filePath;
      openFileExplorer(dir, filePath);
    },
    [openFileExplorer],
  );

  // Shift+Tab to cycle modes
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.shiftKey && !e.ctrlKey && e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        if (isStreaming) return;
        if (isManagerActive) return;
        const currentProvider =
          normalizeProvider(activeThread?.provider) ?? pendingProvider;
        const currentMode = activeThread?.mode
          ? normalizeMode(activeThread.mode, currentProvider)
          : (pendingMode ?? "default");
        const modes = getAgentModes(currentProvider);
        const currentIndex = modes.indexOf(currentMode);
        const nextIndex = (currentIndex + 1) % modes.length;
        handleModeChange(modes[nextIndex]);
      }
    };
    document.addEventListener("keydown", handler, { capture: true });
    return () =>
      document.removeEventListener("keydown", handler, { capture: true });
  }, [
    activeThread,
    pendingMode,
    pendingProvider,
    isStreaming,
    isManagerActive,
    handleModeChange,
  ]);

  // Ctrl+Tab / Ctrl+Shift+Tab to cycle threads
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        if (threads.length <= 1) return;
        const currentIndex = threads.findIndex((t) => t.id === activeThreadId);
        const direction = e.shiftKey ? -1 : 1;
        const nextIndex =
          (currentIndex + direction + threads.length) % threads.length;
        setActiveThreadId(threads[nextIndex].id);
      }
    };
    document.addEventListener("keydown", handler, { capture: true });
    return () =>
      document.removeEventListener("keydown", handler, { capture: true });
  }, [threads, activeThreadId, setActiveThreadId]);

  // Handle notification click -> activate thread
  useEffect(() => {
    return threadsBridge.onThreadActivate?.(({ threadId }) => {
      handleThreadClick(threadId);
    });
  }, [handleThreadClick, threadsBridge]);

  // Cmd+B to toggle file explorer
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "b") {
        e.preventDefault();
        handleToggleFileExplorer();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [handleToggleFileExplorer]);

  // Cmd+Shift+B to toggle sidebar
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "b"
      ) {
        e.preventDefault();
        setSidebarCollapsed((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // Cmd+N to open new thread dialog
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        setShowNewThreadDialog(true);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // Cmd+J to toggle bottom terminal
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "j") {
        e.preventDefault();
        handleToggleTerminal();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [handleToggleTerminal]);

  // Navigate back/forward (VSCode-style)
  // macOS: Ctrl+- (back) / Ctrl+Shift+- (forward)
  // Win/Linux: Alt+ArrowLeft (back) / Alt+ArrowRight (forward)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().includes("MAC");
      const isBack = isMac
        ? e.ctrlKey && !e.shiftKey && e.code === "Minus"
        : e.altKey && e.key === "ArrowLeft";
      const isForward = isMac
        ? e.ctrlKey && e.shiftKey && e.code === "Minus"
        : e.altKey && e.key === "ArrowRight";

      if (isBack) {
        e.preventDefault();
        e.stopPropagation();
        navHistory.back();
      } else if (isForward) {
        e.preventDefault();
        e.stopPropagation();
        navHistory.forward();
      }
    };
    document.addEventListener("keydown", handler, { capture: true });
    return () =>
      document.removeEventListener("keydown", handler, { capture: true });
  }, [navHistory]);

  // Cmd+P to open model picker (via main process menu)
  useEffect(() => {
    return settingsBridge.onOpenModelPicker?.(() =>
      setModelPickerOpen((v) => !v),
    );
  }, [settingsBridge]);

  // Auto-open Claude auth dialog on auth failure
  useEffect(() => {
    const handler = () => setShowClaudeDialog(true);
    window.addEventListener("claude:auth-failed", handler);
    return () => window.removeEventListener("claude:auth-failed", handler);
  }, []);

  // Listen for diagnostic errors from main process
  useEffect(() => {
    return settingsBridge.onDiagnosticError?.((data) => {
      report(data);
    });
  }, [report, settingsBridge]);

  const toggleSidebar = useCallback(
    () => setSidebarCollapsed((prev) => !prev),
    [],
  );

  return (
    <ThemeContext.Provider value={theme}>
      <div className="flex h-screen">
        <div
          className="overflow-hidden transition-[width] duration-200 ease-in-out flex-shrink-0"
          style={{ width: sidebarCollapsed ? 0 : 232 }}
        >
          <Sidebar
            threads={visibleThreads}
            folders={folders}
            activeThreadId={activeThreadId}
            onThreadClick={handleThreadClick}
            onCreateThreadInFolder={handleCreateThreadInFolder}
            onAddFolder={handleAddFolder}
            onRemoveFolder={async (folderId: string) => {
              await removeFolder(folderId);
              await refreshThreads();
            }}
            onToggleFolderCollapsed={handleToggleFolderCollapsed}
            onDeleteThread={handleDeleteThread}
            onToggleSidebar={toggleSidebar}
            onSettingsClick={() => setShowSettingsDialog(true)}
            onSchedulesClick={() => setShowSchedulesDialog(true)}
            runningThreadIds={runningThreadIds}
            threadNotifications={threadNotifications}
            pendingPermissionThreadIds={pendingPermissionThreadIds}
            draftThreadIds={draftThreadIds}
          />
        </div>

        <Group orientation="horizontal" className="flex-1 min-h-0">
          <Panel defaultSize={preview.isOpen ? 70 : 100} minSize={30}>
            <div className="flex flex-col h-full overflow-hidden">
              <div className="flex-1 min-h-0">
                <div className="flex flex-col h-full bg-[var(--bg-main)] rounded-l-xl overflow-hidden">
                  {sidebarCollapsed && (
                    <div className="drag-region h-7 flex-shrink-0" />
                  )}

                  {/* Top bar */}
                  <div
                    className={`drag-region flex-shrink-0 flex items-end justify-between px-4 pb-1.5 ${sidebarCollapsed ? "" : "h-11"}`}
                  >
                    <div className="flex items-center">
                      {sidebarCollapsed && (
                        <button
                          onClick={toggleSidebar}
                          className="no-drag p-1 rounded-md text-[var(--text-control)] hover:text-[var(--text-primary)] hover:bg-[var(--border)] transition-colors"
                          title="Expand sidebar"
                        >
                          <svg
                            className="w-4 h-4"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2}
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M13 5l7 7-7 7M5 5l7 7-7 7"
                            />
                          </svg>
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setShowClaudeDialog(true)}
                        className="no-drag flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs transition-colors hover:bg-[var(--border)]"
                        title={
                          claude.isConnected
                            ? "Claude connected"
                            : "Connect Claude"
                        }
                      >
                        <div
                          className={`w-1.5 h-1.5 rounded-full ${claude.isConnected ? "bg-green-500" : "bg-gray-600"}`}
                        />
                        <span
                          className={
                            claude.isConnected
                              ? "text-[var(--text-control)]"
                              : "text-[var(--text-muted)]"
                          }
                        >
                          Claude
                        </span>
                      </button>
                      {codexEnabled && (
                        <button
                          onClick={() => setShowCodexDialog(true)}
                          className="no-drag flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs transition-colors hover:bg-[var(--border)]"
                          title={
                            codex.isConnected
                              ? "Codex connected"
                              : "Connect Codex"
                          }
                        >
                          <div
                            className={`w-1.5 h-1.5 rounded-full ${codex.isConnected ? "bg-green-500" : "bg-gray-600"}`}
                          />
                          <span
                            className={
                              codex.isConnected
                                ? "text-[var(--text-control)]"
                                : "text-[var(--text-muted)]"
                            }
                          >
                            Codex
                          </span>
                        </button>
                      )}
                      <button
                        onClick={() => setShowOpencodeDialog(true)}
                        className="no-drag flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs transition-colors hover:bg-[var(--border)]"
                        title={
                          opencode.configured
                            ? `Opencode — ${opencode.providerLabels.join(", ")}`
                            : "Opencode — no providers configured. Click to add."
                        }
                      >
                        <div
                          className={`w-1.5 h-1.5 rounded-full ${
                            opencode.configured ? "bg-green-500" : "bg-gray-600"
                          }`}
                        />
                        <span
                          className={
                            opencode.configured
                              ? "text-[var(--text-control)]"
                              : "text-[var(--text-muted)]"
                          }
                        >
                          Opencode
                        </span>
                      </button>
                      <button
                        onClick={() => setShowGitHubDialog(true)}
                        className="no-drag flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs transition-colors hover:bg-[var(--border)]"
                        title={
                          github.isConnected
                            ? "GitHub connected"
                            : "Connect GitHub"
                        }
                      >
                        <div
                          className={`w-1.5 h-1.5 rounded-full ${github.isConnected ? "bg-green-500" : "bg-gray-600"}`}
                        />
                        <span
                          className={
                            github.isConnected
                              ? "text-[var(--text-control)]"
                              : "text-[var(--text-muted)]"
                          }
                        >
                          GitHub
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Chat info bar */}
                  <ChatInfoBar
                    primaryCwd={activeThread?.cwd}
                    sessionStats={sessionStats}
                    homeDir={homeDir}
                    sessionTools={sessionTools ?? undefined}
                    todoData={latestTodoData}
                    showTaskPanel={showTaskPanel}
                    onToggleTaskPanel={() => setShowTaskPanel((s) => !s)}
                    worktreeMode={activeThread?.worktreeMode}
                    isGitRepo={activeThread?.isGitRepo}
                    hasMessages={messages.length > 0}
                    onWorktreeModeChange={handleWorktreeModeChange}
                    onToggleFileExplorer={handleToggleFileExplorer}
                    onToggleTerminal={handleToggleTerminal}
                    mcpServers={mcpServers ?? undefined}
                    onToggleMcpServer={
                      activeThreadId
                        ? async (serverName: string, enabled: boolean) => {
                            try {
                              await chatBridge.toggleMcpServer?.(
                                activeThreadId,
                                serverName,
                                enabled,
                              );
                            } catch (err) {
                              console.error("[MCP] toggle failed:", err);
                            }
                          }
                        : undefined
                    }
                    onOpenMcpConfig={(configPath: string) =>
                      chatBridge.openMcpConfig?.(configPath)
                    }
                    onReconnectMcpServer={
                      activeThreadId
                        ? (serverName: string) => {
                            chatBridge
                              .reconnectMcpServer?.(activeThreadId, serverName)
                              ?.catch((err: unknown) =>
                                console.error("[MCP] reconnect failed:", err),
                              );
                          }
                        : undefined
                    }
                    sessionChanges={sessionChanges}
                    onOpenSessionChanges={openFileChanges}
                  />

                  {/* Chat messages */}
                  <ChatView
                    key={activeThreadId ?? "new"}
                    ref={chatViewRef}
                    provider={
                      normalizeProvider(activeThread?.provider) ??
                      pendingProvider
                    }
                    messages={messages}
                    isStreaming={isStreaming}
                    onLinkClick={handleLinkClick}
                    onSendMessage={(prompt) => handleSend(prompt)}
                    onQuestionAnswer={respondQuestion}
                    onPlanReviewDecision={respondPlanReview}
                    onViewPlan={openMarkdown}
                    onUpdateTaskExpanded={updateTaskExpanded}
                    onViewFile={handleViewFile}
                    onAnchorChange={handleAnchorChange}
                    emptyState={
                      isManagerActive ? (
                        <div className="text-center px-6 max-w-sm">
                          <h1 className="text-2xl font-semibold text-gray-300 mb-3">
                            Manager
                          </h1>
                          <p className="text-sm text-gray-400 leading-relaxed">
                            Orchestrates your agent sessions. Dispatch tasks,
                            check progress, and relay messages to agents running
                            in any workspace.
                          </p>
                        </div>
                      ) : undefined
                    }
                    completionStatus={
                      !isStreaming &&
                      activeThread?.spawnedBy === "manager" &&
                      activeThread?.lastCompletionStatus
                        ? activeThread.lastCompletionStatus
                        : undefined
                    }
                    completionError={activeThread?.lastCompletionError}
                  />

                  {/* Input */}
                  <InputBar
                    ref={inputRef}
                    onSend={handleSend}
                    onInterrupt={handleInterrupt}
                    isStreaming={isStreaming}
                    interactiveMode={interactiveMode}
                    onInteractiveResponse={handleInteractiveResponse}
                    slashCommands={slashCommands}
                    cwd={activeThread?.cwd}
                    filesBridge={filesBridge}
                  />

                  {/* Toolbar: provider + model + mode */}
                  <div className="flex-shrink-0 bg-[var(--bg-main)] px-4 pb-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <ProviderToggle
                          provider={
                            normalizeProvider(activeThread?.provider) ??
                            pendingProvider
                          }
                          onProviderChange={handleProviderChange}
                          enabledProviders={enabledProviders ?? undefined}
                          disabled={
                            isStreaming ||
                            // Lock the provider once a regular thread has
                            // messages (switching mid-conversation breaks
                            // the transcript). The Manager thread is the
                            // exception: switching resets it cleanly, so
                            // users can toggle freely.
                            (activeThreadId !== managerThreadId &&
                              messages.length > 0)
                          }
                        />
                        <span className="text-xs text-[var(--text-muted)]">
                          |
                        </span>
                        <ModelSelector
                          selectedModel={activeThread?.model}
                          onModelChange={handleModelChange}
                          thinkingEffort={activeThread?.thinkingEffort}
                          onThinkingEffortChange={handleThinkingEffortChange}
                          fetchScope={
                            normalizeProvider(activeThread?.provider) ??
                            pendingProvider
                          }
                          onFetchModels={() =>
                            settingsBridge.getAvailableModels?.(
                              normalizeProvider(activeThread?.provider) ??
                                pendingProvider,
                            ) ?? Promise.resolve([])
                          }
                          isOpen={modelPickerOpen}
                          onOpenChange={setModelPickerOpen}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        {contextUsage && (
                          <ContextUsageIndicator
                            usage={contextUsage}
                            onRefresh={refreshContextUsage}
                          />
                        )}
                        {!isManagerActive && (
                          <ModeToggle
                            provider={
                              normalizeProvider(activeThread?.provider) ??
                              pendingProvider
                            }
                            mode={
                              activeThread?.mode
                                ? normalizeMode(
                                    activeThread.mode,
                                    normalizeProvider(activeThread?.provider) ??
                                      pendingProvider,
                                  )
                                : pendingMode
                            }
                            onModeChange={handleModeChange}
                            disabled={isStreaming}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {showBottomTerminal && activeThread?.cwd && (
                <>
                  <div
                    onMouseDown={handleTerminalResizeMouseDown}
                    className="h-1.5 flex-shrink-0 bg-[var(--bg-surface)] hover:bg-blue-600 transition-colors cursor-row-resize"
                  />
                  <div
                    ref={terminalContainerRef}
                    className="flex flex-col flex-shrink-0"
                    style={{ height: terminalHeight }}
                  >
                    <div className="flex items-center justify-between px-3 py-1 bg-[var(--bg-surface)] border-t border-[var(--border)] flex-shrink-0">
                      <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
                        Terminal
                      </span>
                      <button
                        onClick={handleToggleTerminal}
                        className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                        title="Close terminal (⌘J)"
                      >
                        <svg
                          className="w-3.5 h-3.5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M6 18L18 6M6 6l12 12"
                          />
                        </svg>
                      </button>
                    </div>
                    <TerminalPane cwd={activeThread.cwd} />
                  </div>
                </>
              )}
            </div>
          </Panel>

          {preview.isOpen && (
            <>
              <Separator className="w-1.5 bg-[var(--bg-surface)] hover:bg-blue-600 transition-colors cursor-col-resize" />
              <Panel
                defaultSize={preview.type === "file-changes" ? 40 : 30}
                minSize={preview.type === "file-changes" ? 32 : 20}
              >
                <PreviewPane
                  preview={preview}
                  onClose={closePreview}
                  filesBridge={filesBridge}
                  sessionChanges={sessionChanges}
                  gitStatus={gitStatus}
                  onOpenArtifact={openArtifactEditor}
                />
              </Panel>
            </>
          )}
        </Group>

        {/* Permission dialog */}
        {permissionRequest && (
          <PermissionDialog
            request={permissionRequest}
            onRespond={respondPermission}
          />
        )}

        {/* Claude connect dialog */}
        <ConnectClaudeDialog
          isOpen={showClaudeDialog}
          isConnected={claude.isConnected}
          cliInstalled={claude.cliInstalled}
          email={claude.email}
          subscriptionType={claude.subscriptionType}
          loading={claude.loading}
          error={claude.error}
          onClose={() => setShowClaudeDialog(false)}
          onConnect={claude.connect}
          onDisconnect={claude.disconnect}
        />

        {/* Codex connect dialog */}
        <ConnectCodexDialog
          isOpen={codexEnabled && showCodexDialog}
          isConnected={codex.isConnected}
          cliInstalled={codex.cliInstalled}
          email={codex.email}
          planType={codex.planType}
          authMode={codex.authMode}
          loading={codex.loading}
          error={codex.error}
          onClose={() => setShowCodexDialog(false)}
          onConnect={codex.connect}
          onDisconnect={codex.disconnect}
        />

        {/* Opencode settings dialog (also hosts Ollama) */}
        <OpencodeSettingsDialog
          isOpen={showOpencodeDialog}
          onClose={() => {
            setShowOpencodeDialog(false);
            opencode.refresh();
          }}
        />

        {/* GitHub connect dialog */}
        <ConnectGitHubDialog
          isOpen={showGitHubDialog}
          isConnected={github.isConnected}
          cliInstalled={github.cliInstalled}
          username={github.username}
          displayName={github.displayName}
          organizations={github.organizations}
          loading={github.loading}
          error={github.error}
          onClose={() => setShowGitHubDialog(false)}
          onConnect={github.connect}
          onDisconnect={github.disconnect}
        />

        {/* New thread dialog */}
        <NewThreadDialog
          isOpen={showNewThreadDialog}
          onClose={() => setShowNewThreadDialog(false)}
          folders={folders}
          onSelectFolder={handleNewThreadFromFolder}
          onBrowse={handleNewThreadBrowse}
        />

        {/* Scheduled prompts dialog */}
        <ScheduledPromptsDialog
          isOpen={showSchedulesDialog}
          onClose={() => setShowSchedulesDialog(false)}
          folders={folders}
        />

        {/* Settings dialog */}
        <SettingsDialog
          isOpen={showSettingsDialog}
          onClose={() => setShowSettingsDialog(false)}
          theme={theme}
          onThemeChange={handleThemeChange}
        />

        {/* Diagnostic toasts */}
        <DiagnosticToastContainer toasts={toasts} onDismiss={dismiss} />
      </div>
    </ThemeContext.Provider>
  );
}
