import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS } from "../common/ipc-channels";
import type { AgentMode, Folder } from "@stratosapp/core";

export type ElectronAPI = typeof api;

const api = {
  sendMessage: (
    prompt: string,
    threadId?: string,
    images?: { dataUrl: string; mimeType: string }[],
  ): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.SEND_MESSAGE, prompt, threadId, images),

  interrupt: (threadId?: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.INTERRUPT, threadId),

  getAvailableModels: (provider?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_AVAILABLE_MODELS, provider),

  selectDirectory: (defaultPath?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SELECT_DIRECTORY, defaultPath),

  getHomeDirectory: (): Promise<string> =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_HOME_DIRECTORY),

  checkIsGitRepo: (dirPath: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.CHECK_IS_GIT_REPO, dirPath),

  onStreamMessage: (
    callback: (data: unknown, threadId: string | null) => void,
  ): void => {
    ipcRenderer.on(IPC_CHANNELS.STREAM_MESSAGE, (_event, data, threadId) =>
      callback(data, threadId ?? null),
    );
  },

  onToolPermission: (
    callback: (data: unknown, threadId: string | null) => void,
  ): void => {
    ipcRenderer.on(IPC_CHANNELS.TOOL_PERMISSION, (_event, data, threadId) =>
      callback(data, threadId ?? null),
    );
  },

  respondToolPermission: (
    requestId: string,
    approved: boolean,
    updatedPermissions?: unknown[],
  ): void => {
    ipcRenderer.send(IPC_CHANNELS.TOOL_RESPONSE, {
      requestId,
      approved,
      updatedPermissions,
    });
  },

  onSessionReady: (
    callback: (data: unknown, threadId: string | null) => void,
  ): void => {
    ipcRenderer.on(IPC_CHANNELS.SESSION_READY, (_event, data, threadId) =>
      callback(data, threadId ?? null),
    );
  },

  onAskUserQuestion: (
    callback: (data: unknown, threadId: string | null) => void,
  ): void => {
    ipcRenderer.on(IPC_CHANNELS.ASK_USER_QUESTION, (_event, data, threadId) =>
      callback(data, threadId ?? null),
    );
  },

  respondAskUserQuestion: (
    requestId: string,
    answers: Record<string, string>,
  ): void => {
    ipcRenderer.send(IPC_CHANNELS.ASK_USER_RESPONSE, { requestId, answers });
  },

  onPlanReview: (
    callback: (data: unknown, threadId: string | null) => void,
  ): void => {
    ipcRenderer.on(IPC_CHANNELS.PLAN_REVIEW, (_event, data, threadId) =>
      callback(data, threadId ?? null),
    );
  },

  respondPlanReview: (
    requestId: string,
    decision: { type: string; feedback?: string },
  ): void => {
    ipcRenderer.send(IPC_CHANNELS.PLAN_REVIEW_RESPONSE, {
      requestId,
      decision,
    });
  },

  onModeChanged: (
    callback: (data: { mode: string }, threadId: string | null) => void,
  ): void => {
    ipcRenderer.on(IPC_CHANNELS.MODE_CHANGED, (_event, data, threadId) =>
      callback(data, threadId ?? null),
    );
  },

  onSlashCommands: (
    callback: (data: { name: string; description?: string }[]) => void,
  ): void => {
    ipcRenderer.on(IPC_CHANNELS.SLASH_COMMANDS_LIST, (_event, data) =>
      callback(data),
    );
  },

  getSlashCommands: (): Promise<{ name: string; description?: string }[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.SLASH_COMMANDS_GET),

  onOpenModelPicker: (callback: () => void): void => {
    ipcRenderer.on(IPC_CHANNELS.OPEN_MODEL_PICKER, () => callback());
  },

  removeAllListeners: (channel: string): void => {
    ipcRenderer.removeAllListeners(channel);
  },

  // Parallel thread execution
  onThreadStreamState: (
    callback: (data: { threadId: string; isRunning: boolean }) => void,
  ): void => {
    ipcRenderer.on(IPC_CHANNELS.THREAD_STREAM_STATE, (_event, data) =>
      callback(data),
    );
  },

  getRunningThreads: (): Promise<string[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.THREADS_RUNNING),

  onThreadActivate: (callback: (data: { threadId: string }) => void): void => {
    ipcRenderer.on(IPC_CHANNELS.THREAD_ACTIVATE, (_event, data) =>
      callback(data),
    );
  },

  // Orphaned thread recovery
  onThreadsOrphaned: (callback: (threadIds: string[]) => void): void => {
    ipcRenderer.on(IPC_CHANNELS.THREADS_ORPHANED, (_event, threadIds) =>
      callback(threadIds),
    );
  },

  recoverOrphanedThread: (threadId: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.THREADS_RECOVER_ORPHANED, threadId),

  // App info
  getAppInfo: (): Promise<{
    isWorktree: boolean;
    worktreeName: string | null;
    cdpPort: number | null;
  }> => ipcRenderer.invoke(IPC_CHANNELS.APP_INFO),

  // App settings
  settings: {
    get: (): Promise<Record<string, unknown>> =>
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET),
    update: (
      updates: Record<string, unknown>,
    ): Promise<Record<string, unknown>> =>
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_UPDATE, updates),
  },

  // GitHub — connection management (gh CLI)
  githubCheckCli: (): Promise<unknown> =>
    ipcRenderer.invoke(IPC_CHANNELS.GITHUB_CHECK_CLI),
  githubConnect: (): Promise<unknown> =>
    ipcRenderer.invoke(IPC_CHANNELS.GITHUB_CONNECT),
  githubDisconnect: (): Promise<unknown> =>
    ipcRenderer.invoke(IPC_CHANNELS.GITHUB_DISCONNECT),
  githubGetConnection: (): Promise<unknown> =>
    ipcRenderer.invoke(IPC_CHANNELS.GITHUB_GET_CONNECTION),
  githubListRepos: (
    owner: string,
  ): Promise<{
    ok: boolean;
    repos?: {
      name: string;
      description: string | null;
      isPrivate: boolean;
      url: string;
    }[];
    error?: string;
  }> => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_LIST_REPOS, owner),

  // Claude — connection management (claude CLI)
  claudeCheckCli: (): Promise<unknown> =>
    ipcRenderer.invoke(IPC_CHANNELS.CLAUDE_CHECK_CLI),
  claudeConnect: (): Promise<unknown> =>
    ipcRenderer.invoke(IPC_CHANNELS.CLAUDE_CONNECT),
  claudeDisconnect: (): Promise<unknown> =>
    ipcRenderer.invoke(IPC_CHANNELS.CLAUDE_DISCONNECT),
  claudeGetConnection: (): Promise<unknown> =>
    ipcRenderer.invoke(IPC_CHANNELS.CLAUDE_GET_CONNECTION),

  // Codex — connection management (codex app-server)
  codexCheckCli: (): Promise<unknown> =>
    ipcRenderer.invoke(IPC_CHANNELS.CODEX_CHECK_CLI),
  codexConnect: (): Promise<unknown> =>
    ipcRenderer.invoke(IPC_CHANNELS.CODEX_CONNECT),
  codexDisconnect: (): Promise<unknown> =>
    ipcRenderer.invoke(IPC_CHANNELS.CODEX_DISCONNECT),
  codexGetConnection: (): Promise<unknown> =>
    ipcRenderer.invoke(IPC_CHANNELS.CODEX_GET_CONNECTION),

  // Opencode — provider key management
  opencodeGetProviderKeys: (): Promise<
    Record<string, { apiKey: string; baseURL?: string }>
  > => ipcRenderer.invoke(IPC_CHANNELS.OPENCODE_GET_PROVIDER_KEYS),
  opencodeSetProviderKey: (
    providerId: string,
    apiKey: string,
    baseURL?: string,
  ): Promise<void> =>
    ipcRenderer.invoke(
      IPC_CHANNELS.OPENCODE_SET_PROVIDER_KEY,
      providerId,
      apiKey,
      baseURL,
    ),
  opencodeDeleteProviderKey: (providerId: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.OPENCODE_DELETE_PROVIDER_KEY, providerId),

  // Opencode model allowlist
  opencodeGetModelAllowlist: (): Promise<string[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.OPENCODE_GET_MODEL_ALLOWLIST),
  opencodeSetModelAllowlist: (allowlist: string[]): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.OPENCODE_SET_MODEL_ALLOWLIST, allowlist),

  // Ollama — local model server
  ollamaGetConfig: (): Promise<unknown> =>
    ipcRenderer.invoke(IPC_CHANNELS.OLLAMA_GET_CONFIG),
  ollamaSetConfig: (config: unknown): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.OLLAMA_SET_CONFIG, config),
  ollamaClearConfig: (): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.OLLAMA_CLEAR_CONFIG),
  ollamaDiscoverModels: (baseURL: string): Promise<unknown[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.OLLAMA_DISCOVER_MODELS, baseURL),

  // Folders
  foldersList: (): Promise<Folder[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.FOLDERS_LIST),
  foldersAdd: (path: string, name?: string): Promise<Folder> =>
    ipcRenderer.invoke(IPC_CHANNELS.FOLDERS_ADD, path, name),
  foldersRemove: (folderId: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.FOLDERS_REMOVE, folderId),
  foldersUpdate: (
    folderId: string,
    updates: Partial<Folder>,
  ): Promise<Folder | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.FOLDERS_UPDATE, folderId, updates),

  // Threads / sessions
  threadsList: () => ipcRenderer.invoke(IPC_CHANNELS.THREADS_LIST),
  threadsGetActive: () => ipcRenderer.invoke(IPC_CHANNELS.THREADS_GET_ACTIVE),
  threadsSetActive: (threadId: string | null) =>
    ipcRenderer.invoke(IPC_CHANNELS.THREADS_SET_ACTIVE, threadId),
  threadsCreate: (
    title?: string,
    model?: string,
    cwd?: string,
    provider?: string,
  ) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.THREADS_CREATE,
      title,
      model,
      cwd,
      provider,
    ),
  threadsGet: (threadId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.THREADS_GET, threadId),
  threadsUpdate: (
    threadId: string,
    updates: {
      title?: string;
      model?: string;
      cwd?: string;
      thinkingEffort?: "low" | "medium" | "high" | "max";
      mode?: AgentMode;
      additionalCwds?: string[];
      isGitRepo?: boolean;
      worktreeMode?: "local" | "worktree";
      provider?: string;
    },
  ) => ipcRenderer.invoke(IPC_CHANNELS.THREADS_UPDATE, threadId, updates),
  threadsDelete: (threadId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.THREADS_DELETE, threadId),
  threadsCreateWorktree: (params: {
    threadId: string;
    sourceRepoPath: string;
  }) => ipcRenderer.invoke(IPC_CHANNELS.THREADS_CREATE_WORKTREE, params),
  threadsCleanupWorktree: (threadId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.THREADS_CLEANUP_WORKTREE, threadId),
  threadsLoadMessages: (threadId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.THREADS_LOAD_MESSAGES, threadId),
  threadsSaveMessages: (threadId: string, messages: unknown[]) =>
    ipcRenderer.invoke(IPC_CHANNELS.THREADS_SAVE_MESSAGES, threadId, messages),

  // Preview pane
  onPreviewOpenUrl: (callback: (url: string) => void): void => {
    ipcRenderer.on(IPC_CHANNELS.PREVIEW_OPEN_URL, (_event, url: string) =>
      callback(url),
    );
  },

  onPreviewOpenMarkdown: (
    callback: (data: {
      content: string;
      title: string;
      filePath: string;
      threadId?: string;
    }) => void,
  ): void => {
    ipcRenderer.on(
      IPC_CHANNELS.PREVIEW_OPEN_MARKDOWN,
      (
        _event,
        data: { content: string; title: string; filePath: string },
        threadId?: string,
      ) => callback({ ...data, threadId }),
    );
  },

  // File explorer
  filesListDir: (
    dirPath: string,
    rootPath: string,
  ): Promise<{ name: string; type: "file" | "directory"; size: number }[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.FILES_LIST_DIR, dirPath, rootPath),

  filesReadFile: (
    filePath: string,
    rootPath: string,
  ): Promise<{ content: string; isBinary: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.FILES_READ_FILE, filePath, rootPath),

  filesWriteFile: (
    filePath: string,
    content: string,
    rootPath: string,
  ): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.FILES_WRITE_FILE, {
      filePath,
      content,
      rootPath,
    }),

  filesListAll: (cwd: string): Promise<string[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.FILES_LIST_ALL, cwd),

  filesWatchStart: (cwd: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.FILES_WATCH_START, cwd),

  filesWatchStop: (): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.FILES_WATCH_STOP),

  filesOnDirChanged: (callback: (dirPath: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, dirPath: string) =>
      callback(dirPath);
    ipcRenderer.on(IPC_CHANNELS.FILES_DIR_CHANGED, listener);
    return () =>
      ipcRenderer.removeListener(IPC_CHANNELS.FILES_DIR_CHANGED, listener);
  },

  // MCP servers
  mcpServerStatus: (threadId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.MCP_SERVER_STATUS, threadId),
  mcpToggleServer: (threadId: string, serverName: string, enabled: boolean) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.MCP_TOGGLE_SERVER,
      threadId,
      serverName,
      enabled,
    ),
  mcpOpenConfig: (configPath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.MCP_OPEN_CONFIG, configPath),
  mcpReconnectServer: (threadId: string, serverName: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.MCP_RECONNECT_SERVER, threadId, serverName),
  onMcpElicitation: (
    callback: (data: unknown, threadId: string | null) => void,
  ): void => {
    ipcRenderer.on(IPC_CHANNELS.MCP_ELICITATION, (_event, data, threadId) =>
      callback(data, threadId ?? null),
    );
  },
  onMcpStatusChanged: (
    callback: (data: { threadId: string; servers: unknown[] }) => void,
  ): void => {
    ipcRenderer.on(IPC_CHANNELS.MCP_STATUS_CHANGED, (_event, data) =>
      callback(data),
    );
  },
  respondMcpElicitation: (
    requestId: string,
    action: "accept" | "decline" | "cancel",
    content?: Record<string, unknown>,
  ): void => {
    ipcRenderer.send(IPC_CHANNELS.MCP_ELICITATION_RESPONSE, {
      requestId,
      action,
      content,
    });
  },

  // Terminal
  terminalCreate: (cwd: string): Promise<string> =>
    ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_CREATE, cwd),

  terminalWrite: (id: string, data: string): void => {
    ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_WRITE, id, data);
  },

  terminalResize: (id: string, cols: number, rows: number): void => {
    ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_RESIZE, id, cols, rows);
  },

  terminalDestroy: (id: string): void => {
    ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_DESTROY, id);
  },

  onTerminalData: (
    callback: (id: string, data: string) => void,
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: { id: string; data: string },
    ) => callback(payload.id, payload.data);
    ipcRenderer.on(IPC_CHANNELS.TERMINAL_DATA, listener);
    return () =>
      ipcRenderer.removeListener(IPC_CHANNELS.TERMINAL_DATA, listener);
  },

  // Diagnostics
  onDiagnosticError: (
    callback: (data: {
      title: string;
      message: string;
      context?: Record<string, unknown>;
      stack?: string;
      severity?: "error" | "warning" | "info";
    }) => void,
  ): void => {
    ipcRenderer.on(IPC_CHANNELS.DIAGNOSTIC_ERROR, (_event, data) =>
      callback(data),
    );
  },

  // Scheduled prompts
  scheduledList: (): Promise<unknown[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.SCHEDULED_LIST),

  scheduledCreate: (data: {
    name: string;
    prompt: string;
    provider: string;
    model?: string;
    folderId: string;
    schedule: unknown;
  }): Promise<unknown> =>
    ipcRenderer.invoke(IPC_CHANNELS.SCHEDULED_CREATE, data),

  scheduledUpdate: (
    id: string,
    updates: Record<string, unknown>,
  ): Promise<unknown> =>
    ipcRenderer.invoke(IPC_CHANNELS.SCHEDULED_UPDATE, id, updates),

  scheduledDelete: (id: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.SCHEDULED_DELETE, id),

  scheduledRunNow: (id: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.SCHEDULED_RUN_NOW, id),

  onScheduledChanged: (callback: () => void): (() => void) => {
    const listener = () => callback();
    ipcRenderer.on(IPC_CHANNELS.SCHEDULED_CHANGED, listener);
    return () =>
      ipcRenderer.removeListener(IPC_CHANNELS.SCHEDULED_CHANGED, listener);
  },

  // Skills
  skills: {
    list: (): Promise<
      {
        name: string;
        description: string;
        category: string;
        commands: string[];
      }[]
    > => ipcRenderer.invoke(IPC_CHANNELS.SKILLS_LIST),
  },
};

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld("api", api);
} else {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).api = api;
}
