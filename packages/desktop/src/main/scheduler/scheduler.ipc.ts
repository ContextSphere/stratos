import { ipcMain } from "electron";
import { IPC_CHANNELS } from "../../common/ipc-channels";
import type { SchedulerManager } from "./scheduler";
import type {
  ScheduledPrompt,
  ScheduleConfig,
  ProviderType,
} from "@stratosapp/core";
import {
  loadScheduledPrompts,
  addScheduledPrompt,
  updateScheduledPrompt,
  deleteScheduledPrompt,
} from "@stratosapp/core";

export function registerSchedulerIpc(scheduler: SchedulerManager): void {
  ipcMain.handle(IPC_CHANNELS.SCHEDULED_LIST, async () => {
    return loadScheduledPrompts();
  });

  ipcMain.handle(
    IPC_CHANNELS.SCHEDULED_CREATE,
    async (
      _event,
      data: {
        name: string;
        prompt: string;
        provider: ProviderType;
        model?: string;
        folderId: string;
        schedule: ScheduleConfig;
      },
    ) => {
      const prompt = addScheduledPrompt({ ...data, enabled: true });
      scheduler.schedulePrompt(prompt);
      return prompt;
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.SCHEDULED_UPDATE,
    async (_event, id: string, updates: Partial<ScheduledPrompt>) => {
      const updated = updateScheduledPrompt(id, updates);
      if (updated) {
        scheduler.schedulePrompt(updated);
      }
      return updated;
    },
  );

  ipcMain.handle(IPC_CHANNELS.SCHEDULED_DELETE, async (_event, id: string) => {
    scheduler.unschedulePrompt(id);
    return deleteScheduledPrompt(id);
  });

  ipcMain.handle(IPC_CHANNELS.SCHEDULED_RUN_NOW, async (_event, id: string) => {
    const prompts = loadScheduledPrompts();
    const prompt = prompts.find((p) => p.id === id);
    if (!prompt) return null;
    return scheduler.executePrompt(prompt);
  });
}

export function unregisterSchedulerIpc(): void {
  ipcMain.removeHandler(IPC_CHANNELS.SCHEDULED_LIST);
  ipcMain.removeHandler(IPC_CHANNELS.SCHEDULED_CREATE);
  ipcMain.removeHandler(IPC_CHANNELS.SCHEDULED_UPDATE);
  ipcMain.removeHandler(IPC_CHANNELS.SCHEDULED_DELETE);
  ipcMain.removeHandler(IPC_CHANNELS.SCHEDULED_RUN_NOW);
}
