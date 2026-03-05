import { useState, useCallback, useEffect } from 'react'

interface ConnectionStatus {
  connected: boolean
  cliInstalled: boolean
  email: string | null
  subscriptionType: string | null
}

interface UseClaudeReturn {
  isConnected: boolean
  cliInstalled: boolean
  email: string | null
  subscriptionType: string | null
  loading: boolean
  error: string | null
  connect: () => Promise<{ ok: boolean; error?: string }>
  disconnect: () => Promise<void>
  refreshConnection: () => Promise<void>
}

export function useClaude(): UseClaudeReturn {
  const [isConnected, setIsConnected] = useState(false)
  const [cliInstalled, setCliInstalled] = useState(false)
  const [email, setEmail] = useState<string | null>(null)
  const [subscriptionType, setSubscriptionType] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshConnection = useCallback(async () => {
    try {
      const status = (await window.api.claudeGetConnection()) as ConnectionStatus
      setIsConnected(status.connected)
      setCliInstalled(status.cliInstalled)
      setEmail(status.email)
      setSubscriptionType(status.subscriptionType)
    } catch {
      setIsConnected(false); setCliInstalled(false); setEmail(null); setSubscriptionType(null)
    }
  }, [])

  useEffect(() => { refreshConnection() }, [refreshConnection])

  const connect = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    setLoading(true)
    setError(null)
    try {
      const result = (await window.api.claudeConnect()) as
        | { ok: true; email?: string; subscriptionType?: string }
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
      await window.api.claudeDisconnect()
      setIsConnected(false); setEmail(null); setSubscriptionType(null)
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to disconnect') }
    finally { setLoading(false) }
  }, [])

  return { isConnected, cliInstalled, email, subscriptionType, loading, error, connect, disconnect, refreshConnection }
}
