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

  // Folders
  FOLDERS_LIST: "chat:folders:list",
  FOLDERS_ADD: "chat:folders:add",
  FOLDERS_REMOVE: "chat:folders:remove",
  FOLDERS_UPDATE: "chat:folders:update",

  // Git detection
  CHECK_IS_GIT_REPO: "settings:check-is-git-repo",

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

  // Interactive tool events (AskUserQuestion, plan mode)
  ASK_USER_QUESTION: "chat:ask-user-question",
  ASK_USER_RESPONSE: "chat:ask-user-response",
  MODE_CHANGED: "chat:mode-changed",
  PLAN_REVIEW: "chat:plan-review",
  PLAN_REVIEW_RESPONSE: "chat:plan-review-response",

  // Preview pane
  PREVIEW_OPEN_URL: "preview:open-url",
  PREVIEW_OPEN_MARKDOWN: "preview:open-markdown",

  // File explorer
  FILES_LIST_DIR: "files:list-dir",
  FILES_READ_FILE: "files:read-file",

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

  // UI shortcuts
  OPEN_MODEL_PICKER: "ui:open-model-picker",
} as const;
