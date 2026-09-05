import { BrowserWindow } from "electron";
import { AgentService } from "@stratosapp/core";
import { IPC_CHANNELS } from "../../common/ipc-channels";
import { invalidateAgentCache } from "./resolve";

function notifyChanged(agentId: string): void {
  invalidateAgentCache(agentId);
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.AGENTS_CHANGED);
    }
  }
}

/** Persist editor changes, invalidate prompts, and refresh the agent roster. */
export const agentService = new AgentService({ onChanged: notifyChanged });
