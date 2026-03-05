import { useState, useCallback, useEffect } from 'react'

interface ConnectionStatus {
  connected: boolean
  cliInstalled: boolean
  username: string | null
  displayName: string | null
  organizations: string[]
}

interface UseGitHubReturn {
  isConnected: boolean
  cliInstalled: boolean
  username: string | null
  displayName: string | null
  organizations: string[]
  loading: boolean
  error: string | null
  connect: () => Promise<{ ok: boolean; error?: string }>
  disconnect: () => Promise<void>
  refreshConnection: () => Promise<void>
}

export function useGitHub(): UseGitHubReturn {
  const [isConnected, setIsConnected] = useState(false)
  const [cliInstalled, setCliInstalled] = useState(false)
  const [username, setUsername] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState<string | null>(null)
  const [organizations, setOrganizations] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshConnection = useCallback(async () => {
    try {
      const status = (await window.api.githubGetConnection()) as ConnectionStatus
      setIsConnected(status.connected)
      setCliInstalled(status.cliInstalled)
      setUsername(status.username)
      setDisplayName(status.displayName)
      setOrganizations(status.organizations)
    } catch {
      setIsConnected(false)
      setCliInstalled(false)
      setUsername(null)
      setDisplayName(null)
      setOrganizations([])
    }
  }, [])

  useEffect(() => { refreshConnection() }, [refreshConnection])

  const connect = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    setLoading(true)
    setError(null)
    try {
      const result = (await window.api.githubConnect()) as
        | { ok: true; username?: string; displayName?: string; organizations?: string[] }
        | { ok: false; error: string }
      if (result.ok) { await refreshConnection(); return { ok: true } }
      const errMsg = typeof result.error === 'string' ? result.error : 'Connection failed'
      setError(errMsg)
      return { ok: false, error: errMsg }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection failed'
      setError(msg)
      return { ok: false, error: msg }
    } finally { setLoading(false) }
  }, [refreshConnection])

  const disconnect = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      await window.api.githubDisconnect()
      setIsConnected(false); setUsername(null); setDisplayName(null); setOrganizations([])
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to disconnect') }
    finally { setLoading(false) }
  }, [])

  return { isConnected, cliInstalled, username, displayName, organizations, loading, error, connect, disconnect, refreshConnection }
}
