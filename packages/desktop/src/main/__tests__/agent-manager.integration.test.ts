import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Electron before any imports that use it
vi.mock("electron", () => ({
  BrowserWindow: vi.fn(),
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
    removeHandler: vi.fn(),
    removeAllListeners: vi.fn(),
  },
  Notification: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    show: vi.fn(),
  })),
}));

// Mock @agentpanel/core — keep all real exports but replace ClaudeCodeProvider
vi.mock("@agentpanel/core", async (importOriginal) => {
  const original = await importOriginal<typeof import("@agentpanel/core")>();
  return {
    ...original,
    ClaudeCodeProvider: vi.fn(),
  };
});

// Mock settings store — find the correct path by reading agent-manager.ts
// The import is: import { loadSettings } from './settings/settings.store'
vi.mock("../settings/settings.store", () => ({
  loadSettings: vi.fn().mockReturnValue({}),
}));

describe("AgentManager (integration)", () => {
  let sentMessages: Array<{
    channel: string;
    data: unknown;
    threadId?: string;
  }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockWindow: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let AgentManager: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    sentMessages = [];

    mockWindow = {
      isDestroyed: vi.fn().mockReturnValue(false),
      isFocused: vi.fn().mockReturnValue(true),
      webContents: {
        isDestroyed: vi.fn().mockReturnValue(false),
        send: vi.fn((channel: string, data: unknown, threadId?: string) => {
          sentMessages.push({ channel, data, threadId });
        }),
      },
    };

    const mod = await import("../agent-manager");
    AgentManager = mod.AgentManager;
  });

  it("constructs without throwing", () => {
    expect(() => new AgentManager(mockWindow)).not.toThrow();
  });

  it("dispose resolves pending permissions with denied", () => {
    const manager = new AgentManager(mockWindow);
    const resolveMock = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (manager as any).pendingPermissions.set("test-req", {
      resolve: resolveMock,
    });
    manager.dispose();
    expect(resolveMock).toHaveBeenCalledWith({ approved: false });
  });

  it("getRunningThreadIds returns empty array initially", () => {
    const manager = new AgentManager(mockWindow);
    expect(manager.getRunningThreadIds()).toEqual([]);
    manager.dispose();
  });

  it("clearSession disposes provider", () => {
    const disposeMock = vi.fn().mockResolvedValue(undefined);
    const fakeProvider = {
      name: "claude-code",
      initialize: vi.fn().mockResolvedValue(undefined),
      sendMessage: vi.fn().mockReturnValue((async function* () {})()),
      interrupt: vi.fn().mockResolvedValue(undefined),
      canResume: vi.fn().mockReturnValue(false),
      getAvailableModels: vi.fn().mockResolvedValue([]),
      discoverSlashCommands: vi.fn().mockResolvedValue([]),
      dispose: disposeMock,
    };

    const manager = new AgentManager(mockWindow);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (manager as any).sessions.set("thread-1", { provider: fakeProvider });
    manager.clearSession("thread-1");

    expect(disposeMock).toHaveBeenCalled();
    manager.dispose();
  });

  it("getSlashCommands returns empty array initially", () => {
    const manager = new AgentManager(mockWindow);
    expect(manager.getSlashCommands()).toEqual([]);
    manager.dispose();
  });
});
