import { ipcMain } from "electron";
import { IPC_CHANNELS } from "../../common/ipc-channels";
import type { AgentDefinition, CreateAgentInput } from "@stratosapp/core";
import { agentService } from "./service";

export function registerAgentsIpc(): void {
  ipcMain.handle(IPC_CHANNELS.AGENTS_LIST, async () => {
    return agentService.list();
  });

  ipcMain.handle(IPC_CHANNELS.AGENTS_GET, async (_event, id: string) => {
    return agentService.get(id);
  });

  ipcMain.handle(
    IPC_CHANNELS.AGENTS_CREATE,
    async (_event, input: CreateAgentInput) => agentService.create(input),
  );

  ipcMain.handle(
    IPC_CHANNELS.AGENTS_SAVE,
    async (_event, def: AgentDefinition) => {
      return agentService.save(def);
    },
  );

  ipcMain.handle(IPC_CHANNELS.AGENTS_DELETE, async (_event, id: string) => {
    return agentService.delete(id);
  });
}

export function unregisterAgentsIpc(): void {
  ipcMain.removeHandler(IPC_CHANNELS.AGENTS_LIST);
  ipcMain.removeHandler(IPC_CHANNELS.AGENTS_GET);
  ipcMain.removeHandler(IPC_CHANNELS.AGENTS_CREATE);
  ipcMain.removeHandler(IPC_CHANNELS.AGENTS_SAVE);
  ipcMain.removeHandler(IPC_CHANNELS.AGENTS_DELETE);
}
