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

  getRunningThreadIds(): string[] {
    return Array.from(this.sessions.keys())
  }

  discoverSlashCommands(): string[] {
    return ['/help', '/clear', '/compact', '/cost', '/doctor', '/init', '/login', '/logout', '/memory', '/review', '/status', '/terminal-setup']
  }

  dispose(): void {
    this.sessions.clear()
  }
}
