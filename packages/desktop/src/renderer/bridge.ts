import type { StratosContextValue } from "@stratosapp/ui";

/**
 * Creates a StratosContextValue backed by the Electron preload API (`window.api`).
 *
 * This is the single place where the desktop renderer binds platform-specific
 * IPC calls to the platform-agnostic bridge interfaces consumed by @stratosapp/ui.
 */
export function createDesktopBridge(): StratosContextValue {
  return {
    chat: {
      sendMessage: (threadId, prompt, images, _sessionId) =>
        window.api.sendMessage(prompt, threadId, images),
      interrupt: (threadId) => window.api.interrupt(threadId),
      respondPermission: (requestId, approved, updatedPermissions) =>
        window.api.respondToolPermission(
          requestId,
          approved,
          updatedPermissions,
        ),
      respondQuestion: (requestId, answers) =>
        window.api.respondAskUserQuestion(requestId, answers),
      respondPlanReview: (requestId, decision) =>
        window.api.respondPlanReview(requestId, decision),
      onStreamEvent: (_callback) => {
        // Stream events are handled by the useChat hook which manages its own
        // IPC listeners for messages, permissions, questions, plan reviews, etc.
        // This method exists for non-desktop platforms that need a unified stream.
        return () => {};
      },
      getSlashCommands: () => window.api.getSlashCommands(),
      getSessionTools: async (threadId) => {
        const thread = await window.api.threadsGet(threadId);
        return thread?.sessionTools ?? null;
      },
      getMcpServerStatus: (threadId) => window.api.mcpServerStatus(threadId),
      toggleMcpServer: (threadId, serverName, enabled) =>
        window.api.mcpToggleServer(threadId, serverName, enabled),
      openMcpConfig: (configPath) => window.api.mcpOpenConfig(configPath),
      reconnectMcpServer: (threadId, serverName) =>
        window.api.mcpReconnectServer(threadId, serverName),
    },

    threads: {
      list: () => window.api.threadsList(),
      create: (title, model, cwd, provider) =>
        window.api.threadsCreate(title, model, cwd, provider),
      update: (threadId, updates) =>
        window.api.threadsUpdate(threadId, updates),
      delete: (threadId) => window.api.threadsDelete(threadId),
      loadMessages: (threadId) => window.api.threadsLoadMessages(threadId),
      getActive: () => window.api.threadsGetActive(),
      setActive: (id) => window.api.threadsSetActive(id),
      onThreadActivate: (callback) => {
        window.api.onThreadActivate(callback);
        return () => window.api.removeAllListeners("chat:thread-activate");
      },
    },

    settings: {
      getHomeDirectory: () => window.api.getHomeDirectory(),
      selectDirectory: (defaultPath) => window.api.selectDirectory(defaultPath),
      checkIsGitRepo: (path) => window.api.checkIsGitRepo(path),
      getSettings: () => window.api.settings.get(),
      updateSettings: async (updates) => {
        await window.api.settings.update(updates);
      },
      getAvailableModels: (provider) => window.api.getAvailableModels(provider),
      onOpenModelPicker: (callback) => {
        window.api.onOpenModelPicker(callback);
        return () => window.api.removeAllListeners("ui:open-model-picker");
      },
      onDiagnosticError: (callback) => {
        window.api.onDiagnosticError(callback);
        return () => window.api.removeAllListeners("app:diagnostic-error");
      },
    },

    files: {
      listDirectory: (dirPath, rootPath) =>
        window.api.filesListDir(dirPath, rootPath),
      readFile: (filePath, rootPath) =>
        window.api.filesReadFile(filePath, rootPath),
      writeFile: (filePath, content, rootPath) =>
        window.api.filesWriteFile(filePath, content, rootPath),
      listAllFiles: (cwd) => window.api.filesListAll(cwd),
      watchDirectory: (cwd) => window.api.filesWatchStart(cwd),
      unwatchDirectory: () => window.api.filesWatchStop(),
      onDirectoryChanged: (callback) => window.api.filesOnDirChanged(callback),
    },
  };
}
