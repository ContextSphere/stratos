// @vitest-environment happy-dom
import React, { forwardRef, useImperativeHandle } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setActiveThreadId: vi.fn(async () => {}),
  createThread: vi.fn(async () => ({ id: "new-thread" })),
  createAgent: vi.fn(async () => ({
    id: "new-bot",
    name: "New bot",
    description: "Checks arithmetic",
    prompt: "Check arithmetic carefully.",
    icon: "🤖",
    accent: "blue",
    builtIn: false,
    provider: "codex",
    model: "gpt-5.6-sol",
    mode: "default",
    cwd: "/bot-workspace",
  })),
  updateFolder: vi.fn(async () => {}),
  updateThread: vi.fn(async () => {}),
  refreshThreads: vi.fn(async () => {}),
  inputFocus: vi.fn(),
  inputPrefillDraft: vi.fn(),
  inputText: "draft in progress",
  settings: { theme: "dark", designVariant: undefined as string | undefined },
  updateSettings: vi.fn(async (_patch: unknown) => {}),
}));

vi.mock("../bridge", () => ({ createDesktopBridge: () => ({}) }));

vi.mock("../hooks/useThreads", () => ({
  useThreads: () => ({
    threads: [
      {
        id: "existing-thread",
        title: "Existing thread",
        cwd: "/repo",
        provider: "claude-code",
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "second-thread",
        title: "Second thread",
        cwd: "/repo",
        provider: "claude-code",
        createdAt: 1,
        updatedAt: 2,
      },
    ],
    activeThreadId: "existing-thread",
    activeThread: {
      id: "existing-thread",
      title: "Existing thread",
      cwd: "/repo",
      provider: "claude-code",
      createdAt: 1,
      updatedAt: 1,
    },
    setActiveThreadId: mocks.setActiveThreadId,
    createThread: mocks.createThread,
    deleteThread: vi.fn(),
    refreshThreads: mocks.refreshThreads,
  }),
}));

vi.mock("../hooks/useFolders", () => ({
  useFolders: () => ({
    folders: [
      {
        id: "folder-1",
        name: "repo",
        path: "/repo",
        collapsed: true,
        isGitRepo: false,
      },
    ],
    addFolder: vi.fn(),
    removeFolder: vi.fn(),
    updateFolder: mocks.updateFolder,
  }),
}));

vi.mock("../hooks/useAgents", () => ({
  useAgents: () => ({
    agents: [
      {
        id: "penny",
        name: "Penny",
        provider: "claude-code",
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    save: vi.fn(),
    create: mocks.createAgent,
    remove: vi.fn(),
  }),
}));

vi.mock("../hooks/useChat", () => ({
  useChat: () => ({
    messages: [],
    isStreaming: false,
    permissionRequest: null,
    sessionStats: null,
    interactiveMode: { type: "none" },
    sendMessage: vi.fn(),
    interrupt: vi.fn(),
    respondPermission: vi.fn(),
    respondQuestion: vi.fn(),
    respondPlanReview: vi.fn(),
    handleInteractiveResponse: vi.fn(),
    updateTaskExpanded: vi.fn(),
    slashCommands: [],
    runningThreadIds: [],
    threadNotifications: new Map(),
    pendingPermissionThreadIds: new Set(),
    sessionTools: [],
    mcpServers: [],
    fetchMcpStatus: vi.fn(),
    contextUsage: null,
    refreshContextUsage: vi.fn(),
    pendingMessages: [],
    cancelPending: vi.fn(),
    promotePending: vi.fn(),
  }),
}));

vi.mock("../hooks/useNavHistory", () => ({
  useNavHistory: () => ({
    push: vi.fn(),
    updateCurrentAnchor: vi.fn(),
    goBack: vi.fn(),
    goForward: vi.fn(),
  }),
}));

vi.mock("../hooks/useGitHub", () => ({
  useGitHub: () => ({ isConnected: false, loading: false }),
}));
vi.mock("../hooks/useClaude", () => ({
  useClaude: () => ({ isConnected: false, loading: false }),
}));
vi.mock("../hooks/useCodex", () => ({
  useCodex: () => ({ isConnected: false, loading: false }),
}));
vi.mock("../hooks/useOpencodeStatus", () => ({
  useOpencodeStatus: () => ({
    configured: false,
    providerLabels: [],
    refresh: vi.fn(),
  }),
}));
vi.mock("../hooks/usePreview", () => ({
  usePreview: () => ({
    preview: { isOpen: false },
    openUrl: vi.fn(),
    openMarkdown: vi.fn(),
    openArtifactEditor: vi.fn(),
    openFileExplorer: vi.fn(),
    openFileChanges: vi.fn(),
    close: vi.fn(),
  }),
}));
vi.mock("../hooks/useSessionChanges", () => ({
  useSessionChanges: () => [],
}));
vi.mock("../hooks/useGitStatus", () => ({ useGitStatus: () => null }));

vi.mock("react-resizable-panels", () => ({
  Group: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Panel: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Separator: () => null,
}));

vi.mock("@stratosapp/ui", () => {
  const settingsBridge = {
    getHomeDirectory: async () => "/home",
    getSettings: async () => mocks.settings,
    updateSettings: mocks.updateSettings,
    checkIsGitRepo: async () => false,
  };
  const InputBar = forwardRef(function MockInputBar(_props, ref) {
    useImperativeHandle(ref, () => ({
      focus: mocks.inputFocus,
      prefill: vi.fn(),
      getText: () => mocks.inputText,
      getImages: () => [],
      getFileAttachments: () => [],
      prefillDraft: mocks.inputPrefillDraft,
    }));
    return <div data-testid="composer" />;
  });

  return {
    Sidebar: (props: {
      onAgentClick: (id: string) => void;
      onThreadClick: (id: string) => void;
      onCreateThreadInFolder: (id: string) => void;
      onToggleSidebar: () => void;
      onCreateAgent: () => void;
    }) => (
      <nav>
        <button onClick={() => props.onAgentClick("penny")}>View Penny</button>
        <button onClick={() => props.onThreadClick("existing-thread")}>
          Existing thread
        </button>
        <button onClick={() => props.onCreateThreadInFolder("folder-1")}>
          Folder plus
        </button>
        <button onClick={props.onToggleSidebar}>Collapse sidebar</button>
        <button onClick={props.onCreateAgent}>New bot</button>
      </nav>
    ),
    AgentOverview: () => <div>Penny overview</div>,
    AgentEditor: (props: {
      onSave: (
        definition: unknown,
        options: { startChat: boolean },
      ) => Promise<void>;
    }) => (
      <button
        onClick={() =>
          props.onSave(
            {
              id: "draft",
              name: "New bot",
              description: "Checks arithmetic",
              prompt: "Check arithmetic carefully.",
            },
            { startChat: true },
          )
        }
      >
        Create and start chat
      </button>
    ),
    ChatView: forwardRef(function MockChatView() {
      return <div>Chat view</div>;
    }),
    InputBar,
    ChatInfoBar: () => null,
    PermissionDialog: () => null,
    PreviewPane: () => null,
    ContextUsageIndicator: () => null,
    ToolsBadge: () => null,
    ProviderToggle: () => null,
    ModelSelector: () => null,
    ModeToggle: () => null,
    WorktreeToggle: () => null,
    TerminalPane: () => null,
    DiagnosticToastContainer: () => null,
    ThemeContext: React.createContext("dark"),
    DesignProvider: ({
      children,
      variant,
    }: {
      children: React.ReactNode;
      variant: string;
    }) => (
      <div data-testid="design-provider" data-variant={variant}>
        {children}
      </div>
    ),
    DiagnosticsProvider: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
    useDiagnostics: () => ({
      report: vi.fn(),
      toasts: [],
      dismiss: vi.fn(),
    }),
    StratosProvider: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
    useStratos: () => ({
      settings: settingsBridge,
      threads: {
        update: mocks.updateThread,
      },
      chat: {},
      files: {},
    }),
    useTodoData: () => ({
      latestTodoData: null,
      showTaskPanel: false,
      setShowTaskPanel: vi.fn(),
    }),
    useSessionChanges: () => [],
    DEFAULT_AGENT_ID: "default",
    DEFAULT_AGENT: { id: "default", name: "Default" },
  };
});

vi.mock("../components/ConnectGitHubDialog", () => ({
  ConnectGitHubDialog: () => null,
}));
vi.mock("../components/ConnectClaudeDialog", () => ({
  ConnectClaudeDialog: () => null,
}));
vi.mock("../components/ConnectCodexDialog", () => ({
  ConnectCodexDialog: () => null,
}));
vi.mock("../components/OpencodeSettingsDialog", () => ({
  OpencodeSettingsDialog: () => null,
}));
vi.mock("../components/SettingsDialog", () => ({
  SettingsDialog: (props: {
    onDesignChange: (variant: string) => void;
    designError?: string;
    designSaving: boolean;
  }) => (
    <>
      <button
        disabled={props.designSaving}
        onClick={() => props.onDesignChange("refined")}
      >
        Use refined design
      </button>
      <button
        disabled={props.designSaving}
        onClick={() => props.onDesignChange("classic")}
      >
        Use classic design
      </button>
      {props.designError && <p role="alert">{props.designError}</p>}
    </>
  ),
}));
vi.mock("../components/ScheduledPromptsDialog", () => ({
  ScheduledPromptsDialog: () => null,
}));
vi.mock("../components/NewThreadDialog", () => ({
  NewThreadDialog: (props: {
    isOpen: boolean;
    folders: Array<{ id: string }>;
    onSelectFolder: (folder: { id: string }) => void;
  }) =>
    props.isOpen ? (
      <button onClick={() => props.onSelectFolder(props.folders[0])}>
        Choose dialog folder
      </button>
    ) : null,
}));

import App from "../App";

describe("App navigation from agent screens", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.inputText = "draft in progress";
    mocks.settings = { theme: "dark", designVariant: undefined };
    mocks.updateSettings.mockResolvedValue(undefined);
    Object.defineProperty(window, "api", {
      configurable: true,
      value: {
        managerIsEnabled: async () => false,
        getAppInfo: async () => ({ enabledProviders: ["claude-code"] }),
      },
    });
  });

  it("defaults to Classic and switches design without replacing the composer or changing color mode", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.documentElement.dataset.design).toBe("classic"),
    );
    const composer = screen.getByTestId("composer");
    fireEvent.click(screen.getByRole("button", { name: "Use refined design" }));
    await waitFor(() =>
      expect(screen.getByTestId("design-provider").dataset.variant).toBe(
        "refined",
      ),
    );
    expect(mocks.updateSettings).toHaveBeenCalledWith({
      designVariant: "refined",
    });
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(screen.getByTestId("composer")).toBe(composer);
    expect(mocks.createThread).not.toHaveBeenCalled();
  });

  it("creates and opens a bot using the saved defaults before the roster refreshes", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "New bot" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Create and start chat" }),
    );

    await waitFor(() => {
      expect(mocks.createAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "New bot",
          prompt: "Check arithmetic carefully.",
        }),
      );
      expect(mocks.createThread).toHaveBeenCalledWith(
        "New chat",
        undefined,
        "/bot-workspace",
        "codex",
      );
      expect(mocks.updateThread).toHaveBeenCalledWith(
        "new-thread",
        expect.objectContaining({
          agentId: "new-bot",
          model: "gpt-5.6-sol",
          mode: "default",
        }),
      );
      expect(mocks.setActiveThreadId).toHaveBeenCalledWith("new-thread");
      expect(
        screen.queryByRole("button", { name: "Create and start chat" }),
      ).toBeNull();
    });
  });

  it("loads a saved design and keeps it when saving another design fails", async () => {
    mocks.settings.designVariant = "refined";
    mocks.updateSettings.mockRejectedValueOnce(new Error("Disk unavailable"));
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId("design-provider").dataset.variant).toBe(
        "refined",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Use classic design" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Couldn’t save"),
    );
    expect(document.documentElement.dataset.design).toBe("refined");
  });

  it("opens a folder-created thread from an agent overview and expands its folder", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "View Penny" }));
    expect(screen.getByText("Penny overview")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Folder plus" }));

    await waitFor(() => {
      expect(screen.queryByText("Penny overview")).toBeNull();
      expect(screen.getByTestId("composer")).not.toBeNull();
      expect(mocks.updateFolder).toHaveBeenCalledWith("folder-1", {
        collapsed: false,
      });
      expect(mocks.setActiveThreadId).toHaveBeenCalledWith("new-thread");
    });
    await act(async () => new Promise(requestAnimationFrame));
    expect(mocks.inputFocus).toHaveBeenCalled();
  });

  it("keeps an expand affordance available on a collapsed agent overview", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "View Penny" }));
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));

    expect(
      screen.getByRole("button", { name: "Expand sidebar" }),
    ).not.toBeNull();
    expect(screen.getByText("Penny overview")).not.toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Collapse sidebar", hidden: true })
        .closest("div[style]")
        ?.hasAttribute("inert"),
    ).toBe(true);
  });

  it("preserves the current draft while visiting an agent overview", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "View Penny" }));
    mocks.inputPrefillDraft.mockClear();

    fireEvent.click(
      screen.getByRole("button", { name: "Existing thread", hidden: true }),
    );

    await act(async () => new Promise(requestAnimationFrame));
    expect(mocks.inputPrefillDraft).toHaveBeenLastCalledWith(
      "draft in progress",
      [],
      [],
    );
  });

  it("leaves an agent overview when Ctrl+Tab selects another thread", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "View Penny" }));

    fireEvent.keyDown(document, { key: "Tab", ctrlKey: true });

    expect(screen.queryByText("Penny overview")).toBeNull();
    expect(mocks.setActiveThreadId).toHaveBeenCalledWith("second-thread");
  });

  it("opens a thread selected from the new-thread dialog while viewing an agent", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "View Penny" }));
    fireEvent.keyDown(document, { key: "n", metaKey: true });
    fireEvent.click(
      screen.getByRole("button", { name: "Choose dialog folder" }),
    );

    await waitFor(() => {
      expect(screen.queryByText("Penny overview")).toBeNull();
      expect(mocks.updateFolder).toHaveBeenCalledWith("folder-1", {
        collapsed: false,
      });
      expect(mocks.setActiveThreadId).toHaveBeenCalledWith("new-thread");
    });
  });
});
