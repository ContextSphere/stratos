import { join } from 'path'
import { homedir } from 'os'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'

export interface AppSettings {
  [key: string]: unknown
}

const STORE_FILE = 'app-settings.json'

const GLOBAL_CONFIG_DIR = join(homedir(), '.agentpanel')

function getStorePath(): string {
  return join(GLOBAL_CONFIG_DIR, STORE_FILE)
}

function getDefaults(): AppSettings {
  return {}
}

export function loadSettings(): AppSettings {
  const path = getStorePath()
  if (!existsSync(path)) {
    return getDefaults()
  }
  try {
    const raw = readFileSync(path, 'utf-8')
    const data = JSON.parse(raw) as Partial<AppSettings>
    return {
      ...getDefaults(),
      ...data
    }
  } catch {
    return getDefaults()
  }
}

export function saveSettings(settings: AppSettings): void {
  if (!existsSync(GLOBAL_CONFIG_DIR)) {
    mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true })
  }
  writeFileSync(getStorePath(), JSON.stringify(settings, null, 2), 'utf-8')
}

export function updateSettings(updates: Partial<AppSettings>): AppSettings {
  const updated = { ...loadSettings(), ...updates }
  saveSettings(updated)
  return updated
}
