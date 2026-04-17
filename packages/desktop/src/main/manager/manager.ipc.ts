import { ipcMain } from "electron";
import { IPC_CHANNELS } from "../../common/ipc-channels";
import type { ManagerSession } from "./manager-session";
import type { ProviderType } from "@stratosapp/core";

export function registerManagerIpc(manager: ManagerSession): void {
  ipcMain.handle(
    IPC_CHANNELS.MANAGER_SEND,
    async (
      _event,
      prompt: string,
      images?: { dataUrl: string; mimeType: string }[],
    ) => {
      manager.send(prompt, images).catch((err) => {
        console.error("[manager-ipc] send error:", err);
      });
    },
  );

  ipcMain.handle(IPC_CHANNELS.MANAGER_INTERRUPT, async () => {
    await manager.interrupt();
  });

  ipcMain.handle(IPC_CHANNELS.MANAGER_STATUS, async () => {
    return {
      isActive: manager.isActive,
      threadId: await manager.getThreadId(),
    };
  });

  ipcMain.handle(IPC_CHANNELS.MANAGER_THREAD_ID, async () => {
    return manager.getThreadId();
  });

  ipcMain.handle(
    IPC_CHANNELS.MANAGER_SWITCH_PROVIDER,
    async (_event, provider: ProviderType, model?: string) => {
      await manager.switchProvider(provider, model);
      return { status: "switched", provider };
    },
  );
}

export function unregisterManagerIpc(): void {
  ipcMain.removeHandler(IPC_CHANNELS.MANAGER_SEND);
  ipcMain.removeHandler(IPC_CHANNELS.MANAGER_INTERRUPT);
  ipcMain.removeHandler(IPC_CHANNELS.MANAGER_STATUS);
  ipcMain.removeHandler(IPC_CHANNELS.MANAGER_THREAD_ID);
  ipcMain.removeHandler(IPC_CHANNELS.MANAGER_SWITCH_PROVIDER);
}
