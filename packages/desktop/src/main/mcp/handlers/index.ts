/**
 * Single source of truth for the Stratos MCP tool surface.
 *
 * All 19 tools from the scheduler / preview / manager domains live in one
 * flat namespace under the server name "stratos". Both the SDK adapter
 * (claude-code) and the stdio socket server (codex / opencode) consume the
 * same HandlerDef[] emitted here — so the tool contract cannot drift.
 */
import type { BrowserWindow } from "electron";
import type { AgentManager } from "../../agent-manager";
import type { FileStorageAdapter } from "@stratosapp/core";
import { createSchedulerHandlers } from "./scheduler";
import { createPreviewHandlers } from "./preview";
import { createManagerHandlers } from "./manager";
import type { HandlerDef } from "./types";

export interface StratosHandlerDeps {
  storage: FileStorageAdapter;
  agentManager: AgentManager;
  window: BrowserWindow;
  sendToRenderer: (channel: string, data: unknown) => void;
}

export function createStratosHandlers(deps: StratosHandlerDeps): HandlerDef[] {
  return [
    ...createSchedulerHandlers({ storage: deps.storage }),
    ...createPreviewHandlers({ sendToRenderer: deps.sendToRenderer }),
    ...createManagerHandlers({
      agentManager: deps.agentManager,
      storage: deps.storage,
      window: deps.window,
    }),
  ];
}

export { createSchedulerHandlers } from "./scheduler";
export { createPreviewHandlers } from "./preview";
export { createManagerHandlers } from "./manager";
export type { HandlerDef, ToolResult } from "./types";
