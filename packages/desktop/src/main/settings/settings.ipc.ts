import { ipcMain, BrowserWindow } from "electron";
import { IPC_CHANNELS } from "../../common/ipc-channels";
import {
  getPublicSettings,
  updatePublicSettings,
  type AppSettings,
} from "./settings.store";

export function registerSettingsIpc(_window: BrowserWindow): void {
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, () => {
    return getPublicSettings();
  });

  ipcMain.handle(
    IPC_CHANNELS.SETTINGS_UPDATE,
    (_event, updates: Partial<AppSettings>) => {
      return updatePublicSettings(updates);
    },
  );
}

export function unregisterSettingsIpc(): void {
  ipcMain.removeHandler(IPC_CHANNELS.SETTINGS_GET);
  ipcMain.removeHandler(IPC_CHANNELS.SETTINGS_UPDATE);
}
