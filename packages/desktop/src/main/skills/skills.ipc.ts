import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../common/ipc-channels'

export function registerSkillsIpc(): void {
  ipcMain.handle(IPC_CHANNELS.SKILLS_LIST, () => {
    return []
  })
  ipcMain.handle(IPC_CHANNELS.SLASH_COMMANDS_GET, () => {
    return []
  })
}

export function unregisterSkillsIpc(): void {
  ipcMain.removeHandler(IPC_CHANNELS.SKILLS_LIST)
  ipcMain.removeHandler(IPC_CHANNELS.SLASH_COMMANDS_GET)
}
