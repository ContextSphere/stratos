import { ipcMain, BrowserWindow } from "electron";
import { IPC_CHANNELS } from "../../common/ipc-channels";
import type { AgentDefinition } from "@stratosapp/core";
import { loadAgents, getAgent, saveAgent, deleteAgent } from "@stratosapp/core";
import { invalidateAgentCache } from "./resolve";

function broadcastAgentsChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.AGENTS_CHANGED);
    }
  }
}

export function registerAgentsIpc(): void {
  ipcMain.handle(IPC_CHANNELS.AGENTS_LIST, async () => {
    return loadAgents();
  });

  ipcMain.handle(IPC_CHANNELS.AGENTS_GET, async (_event, id: string) => {
    return getAgent(id);
  });

  ipcMain.handle(
    IPC_CHANNELS.AGENTS_SAVE,
    async (_event, def: AgentDefinition) => {
      const saved = saveAgent(def);
      invalidateAgentCache(saved.id);
      broadcastAgentsChanged();
      return saved;
    },
  );

  ipcMain.handle(IPC_CHANNELS.AGENTS_DELETE, async (_event, id: string) => {
    const deleted = deleteAgent(id);
    invalidateAgentCache(id);
    broadcastAgentsChanged();
    return deleted;
  });
}

export function unregisterAgentsIpc(): void {
  ipcMain.removeHandler(IPC_CHANNELS.AGENTS_LIST);
  ipcMain.removeHandler(IPC_CHANNELS.AGENTS_GET);
  ipcMain.removeHandler(IPC_CHANNELS.AGENTS_SAVE);
  ipcMain.removeHandler(IPC_CHANNELS.AGENTS_DELETE);
}
