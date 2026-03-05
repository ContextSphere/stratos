import { ipcMain, BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../common/ipc-channels'
import {
  loadSettings,
  updateSettings,
  type AppSettings
} from './settings.store'

export function registerSettingsIpc(_window: BrowserWindow): void {
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, () => {
    return loadSettings()
  })

  ipcMain.handle(
    IPC_CHANNELS.SETTINGS_UPDATE,
    (_event, updates: Partial<AppSettings>) => {
      return updateSettings(updates)
    }
  )
}

export function unregisterSettingsIpc(): void {
  ipcMain.removeHandler(IPC_CHANNELS.SETTINGS_GET)
  ipcMain.removeHandler(IPC_CHANNELS.SETTINGS_UPDATE)
}
