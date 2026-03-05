import { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../common/ipc-channels'

export class AgentManager {
  private window: BrowserWindow
  private sessions = new Map<string, unknown>()

  constructor(window: BrowserWindow) {
    this.window = window
  }

  clearSession(threadId: string): void {
    this.sessions.delete(threadId)
  }

  discoverSlashCommands(): void {
    // TODO: Discover slash commands from claude CLI
  }

  dispose(): void {
    this.sessions.clear()
  }
}
