import { BrowserWindow, ipcMain, dialog } from 'electron'
import { homedir } from 'os'
import { IPC_CHANNELS } from '../../common/ipc-channels'

export function registerDirectoryIpc(window: BrowserWindow): void {
  ipcMain.handle(IPC_CHANNELS.SELECT_DIRECTORY, async (_event, defaultPath?: string) => {
    const result = await dialog.showOpenDialog(window, {
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: defaultPath ?? homedir()
    })
    return { canceled: result.canceled, path: result.filePaths[0] ?? null }
  })

  ipcMain.handle(IPC_CHANNELS.GET_HOME_DIRECTORY, () => homedir())
}

export function unregisterDirectoryIpc(): void {
  ipcMain.removeHandler(IPC_CHANNELS.SELECT_DIRECTORY)
  ipcMain.removeHandler(IPC_CHANNELS.GET_HOME_DIRECTORY)
}
