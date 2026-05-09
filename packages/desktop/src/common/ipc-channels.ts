export const IPC_CHANNELS = {
  SEND_MESSAGE: "chat:send-message",
  STREAM_MESSAGE: "chat:stream-message",
  TOOL_PERMISSION: "chat:tool-permission",
  TOOL_RESPONSE: "chat:tool-response",
  INTERRUPT: "chat:interrupt",
  SESSION_READY: "chat:session-ready",
  GET_AVAILABLE_MODELS: "provider:get-available-models",
  SELECT_DIRECTORY: "settings:select-directory",
  GET_HOME_DIRECTORY: "settings:get-home-directory",
  SETTINGS_GET: "settings:get",
  SETTINGS_UPDATE: "settings:update",

  // Threads / sessions
  THREADS_LIST: "chat:threads:list",
  THREADS_GET_ACTIVE: "chat:threads:get-active",
  THREADS_SET_ACTIVE: "chat:threads:set-active",
  THREADS_CREATE: "chat:threads:create",
  THREADS_GET: "chat:threads:get",
  THREADS_UPDATE: "chat:threads:update",
  THREADS_DELETE: "chat:threads:delete",
  THREADS_LOAD_MESSAGES: "chat:threads:load-messages",
  THREADS_SAVE_MESSAGES: "chat:threads:save-messages",
  THREADS_READ_TRACE: "chat:threads:read-trace",
  THREADS_CLEAR_TRACE: "chat:threads:clear-trace",

  // Thread worktrees
  THREADS_CREATE_WORKTREE: "chat:threads:create-worktree",
  THREADS_CLEANUP_WORKTREE: "chat:threads:cleanup-worktree",

  // Storage-change broadcasts (fired when mutations happen outside the
  // renderer's own create/delete helpers — e.g. from the Manager Agent).
  // Subscribers re-fetch the full list rather than applying a delta.
  THREADS_CHANGED: "chat:threads:changed",
  FOLDERS_CHANGED: "chat:folders:changed",

  // Fired when a thread's messages have been reset externally — e.g. the
  // Manager Agent's provider switch wipes the transcript. useChat re-loads
  // if the reset thread is currently active.
  THREAD_MESSAGES_RELOAD: "chat:thread:messages-reload",

  // Folders
  FOLDERS_LIST: "chat:folders:list",
  FOLDERS_ADD: "chat:folders:add",
  FOLDERS_REMOVE: "chat:folders:remove",
  FOLDERS_UPDATE: "chat:folders:update",

  // Git detection + status
  CHECK_IS_GIT_REPO: "settings:check-is-git-repo",
  GIT_STATUS: "git:status",

  // GitHub — connection management (gh CLI)
  GITHUB_CHECK_CLI: "integration:github:check-cli",
  GITHUB_CONNECT: "integration:github:connect",
  GITHUB_DISCONNECT: "integration:github:disconnect",
  GITHUB_GET_CONNECTION: "integration:github:get-connection",
  GITHUB_LIST_REPOS: "integration:github:list-repos",

  // Claude — connection management (claude CLI)
  CLAUDE_CHECK_CLI: "integration:claude:check-cli",
  CLAUDE_CONNECT: "integration:claude:connect",
  CLAUDE_DISCONNECT: "integration:claude:disconnect",
  CLAUDE_GET_CONNECTION: "integration:claude:get-connection",

  // Codex — connection management (codex app-server)
  CODEX_CHECK_CLI: "integration:codex:check-cli",
  CODEX_CONNECT: "integration:codex:connect",
  CODEX_DISCONNECT: "integration:codex:disconnect",
  CODEX_GET_CONNECTION: "integration:codex:get-connection",

  // Opencode — provider key management
  OPENCODE_GET_PROVIDER_KEYS: "integration:opencode:get-provider-keys",
  OPENCODE_SET_PROVIDER_KEY: "integration:opencode:set-provider-key",
  OPENCODE_DELETE_PROVIDER_KEY: "integration:opencode:delete-provider-key",

  // Opencode — model allowlist (deprecated — kept for one release)
  OPENCODE_GET_MODEL_ALLOWLIST: "integration:opencode:get-model-allowlist",
  OPENCODE_SET_MODEL_ALLOWLIST: "integration:opencode:set-model-allowlist",

  // Opencode — per-provider enabled models + raw model discovery
  OPENCODE_LIST_PROVIDER_MODELS: "integration:opencode:list-provider-models",
  OPENCODE_GET_ENABLED_MODELS: "integration:opencode:get-enabled-models",
  OPENCODE_SET_ENABLED_MODELS: "integration:opencode:set-enabled-models",
  OPENCODE_DISABLE_PROVIDER: "integration:opencode:disable-provider",
  OPENCODE_CLEAR_PROVIDER: "integration:opencode:clear-provider",
  OPENCODE_RESTORE_PROVIDER: "integration:opencode:restore-provider",

  // Ollama — local model server
  OLLAMA_GET_CONFIG: "integration:ollama:get-config",
  OLLAMA_SET_CONFIG: "integration:ollama:set-config",
  OLLAMA_CLEAR_CONFIG: "integration:ollama:clear-config",
  OLLAMA_DISCOVER_MODELS: "integration:ollama:discover-models",

  // Interactive tool events (AskUserQuestion, plan mode)
  ASK_USER_QUESTION: "chat:ask-user-question",
  ASK_USER_RESPONSE: "chat:ask-user-response",
  MODE_CHANGED: "chat:mode-changed",
  PLAN_REVIEW: "chat:plan-review",
  PLAN_REVIEW_RESPONSE: "chat:plan-review-response",

  // Preview pane
  PREVIEW_OPEN_URL: "preview:open-url",
  PREVIEW_OPEN_MARKDOWN: "preview:open-markdown",
  PREVIEW_CLOSE: "preview:close",

  // File explorer
  FILES_LIST_DIR: "files:list-dir",
  FILES_READ_FILE: "files:read-file",
  FILES_WRITE_FILE: "files:write-file",
  FILES_WATCH_START: "files:watch-start",
  FILES_WATCH_STOP: "files:watch-stop",
  FILES_DIR_CHANGED: "files:dir-changed",
  FILES_FILE_WATCH_START: "files:file-watch-start",
  FILES_FILE_WATCH_STOP: "files:file-watch-stop",
  FILES_FILE_CHANGED: "files:file-changed",
  FILES_LIST_ALL: "files:list-all",
  FILES_GET_EXTERNAL_EDITORS: "files:get-external-editors",
  FILES_OPEN_IN_EXTERNAL_EDITOR: "files:open-in-external-editor",

  // Skills
  SKILLS_LIST: "skills:list",
  SLASH_COMMANDS_LIST: "skills:slash-commands",
  SLASH_COMMANDS_GET: "skills:slash-commands-get",

  // Parallel thread execution
  THREAD_STREAM_STATE: "chat:thread-stream-state",
  THREADS_RUNNING: "chat:threads-running",
  THREAD_ACTIVATE: "chat:thread-activate",

  // Orphaned thread recovery
  THREADS_ORPHANED: "chat:threads-orphaned",
  THREADS_RECOVER_ORPHANED: "chat:threads:recover-orphaned",

  // App info
  APP_INFO: "app:info",

  // Shell
  SHELL_OPEN_EXTERNAL: "shell:open-external",

  // MCP servers
  MCP_SERVER_STATUS: "mcp:server-status",
  MCP_TOGGLE_SERVER: "mcp:toggle-server",
  MCP_OPEN_CONFIG: "mcp:open-config",
  MCP_ELICITATION: "mcp:elicitation",
  MCP_ELICITATION_RESPONSE: "mcp:elicitation-response",
  MCP_RECONNECT_SERVER: "mcp:reconnect-server",
  MCP_STATUS_CHANGED: "mcp:status-changed",

  // UI shortcuts
  OPEN_MODEL_PICKER: "ui:open-model-picker",

  // Diagnostics
  DIAGNOSTIC_ERROR: "app:diagnostic-error",

  // Scheduled prompts
  SCHEDULED_LIST: "schedule:list",
  SCHEDULED_CREATE: "schedule:create",
  SCHEDULED_UPDATE: "schedule:update",
  SCHEDULED_DELETE: "schedule:delete",
  SCHEDULED_RUN_NOW: "schedule:run-now",
  SCHEDULED_CHANGED: "schedule:changed",

  // Manager Agent
  MANAGER_SEND: "manager:send",
  MANAGER_STREAM: "manager:stream",
  MANAGER_STATUS: "manager:status",
  MANAGER_INTERRUPT: "manager:interrupt",
  MANAGER_THREAD_ID: "manager:thread-id",
  MANAGER_SWITCH_PROVIDER: "manager:switch-provider",
  MANAGER_SCHEDULE_RUN_RECORDED: "manager:schedule-run-recorded",
  MANAGER_SCHEDULE_RUNS: "manager:schedule-runs",

  // WhatsApp gateway
  WHATSAPP_GET_STATE: "whatsapp:get-state",
  WHATSAPP_CONNECT: "whatsapp:connect",
  WHATSAPP_DISCONNECT: "whatsapp:disconnect",
  WHATSAPP_SAVE_SETTINGS: "whatsapp:save-settings",
  WHATSAPP_STATUS: "whatsapp:status", // event → "connected" | "disconnected" | "qr"
  WHATSAPP_QR: "whatsapp:qr", // event → qr string
  WHATSAPP_LOG: "whatsapp:log", // event → log line string
  WHATSAPP_IS_ENABLED: "whatsapp:is-enabled",

  // Telegram gateway
  TELEGRAM_GET_STATE: "telegram:get-state",
  TELEGRAM_CONNECT: "telegram:connect",
  TELEGRAM_DISCONNECT: "telegram:disconnect",
  TELEGRAM_SAVE_SETTINGS: "telegram:save-settings",
  TELEGRAM_STATUS: "telegram:status", // event → "connected" | "disconnected" | "connecting" | "error"
  TELEGRAM_LOG: "telegram:log", // event → log line string
  TELEGRAM_IS_ENABLED: "telegram:is-enabled",

  // Terminal
  TERMINAL_CREATE: "terminal:create",
  TERMINAL_WRITE: "terminal:write",
  TERMINAL_RESIZE: "terminal:resize",
  TERMINAL_DESTROY: "terminal:destroy",
  TERMINAL_DATA: "terminal:data",
} as const;
