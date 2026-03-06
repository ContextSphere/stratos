import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../common/ipc-channels'

let slashCommandsGetter: (() => { name: string; description?: string }[]) | null = null

export function setSlashCommandsGetter(getter: () => { name: string; description?: string }[]): void {
  slashCommandsGetter = getter
}

export function registerSkillsIpc(): void {
  ipcMain.handle(IPC_CHANNELS.SKILLS_LIST, () => {
    return []
  })
  ipcMain.handle(IPC_CHANNELS.SLASH_COMMANDS_GET, () => {
    return slashCommandsGetter?.() ?? []
  })
}

export function unregisterSkillsIpc(): void {
  ipcMain.removeHandler(IPC_CHANNELS.SKILLS_LIST)
  ipcMain.removeHandler(IPC_CHANNELS.SLASH_COMMANDS_GET)
}
