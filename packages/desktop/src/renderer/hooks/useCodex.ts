import { useState, useCallback, useEffect } from "react";

interface ConnectionStatus {
  connected: boolean;
  cliInstalled: boolean;
  email: string | null;
  planType: string | null;
  authMode: string | null;
}

interface UseCodexReturn {
  isConnected: boolean;
  cliInstalled: boolean;
  email: string | null;
  planType: string | null;
  authMode: string | null;
  loading: boolean;
  error: string | null;
  connect: () => Promise<{ ok: boolean; error?: string }>;
  disconnect: () => Promise<void>;
  refreshConnection: () => Promise<void>;
}

export function useCodex(enabled = true): UseCodexReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [cliInstalled, setCliInstalled] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [planType, setPlanType] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshConnection = useCallback(async () => {
    if (!enabled) return;
    try {
      const status =
        (await window.api.codexGetConnection()) as ConnectionStatus;
      setIsConnected(status.connected);
      setCliInstalled(status.cliInstalled);
      setEmail(status.email);
      setPlanType(status.planType);
      setAuthMode(status.authMode);
    } catch {
      setIsConnected(false);
      setCliInstalled(false);
      setEmail(null);
      setPlanType(null);
      setAuthMode(null);
    }
  }, [enabled]);

  useEffect(() => {
    refreshConnection();
  }, [refreshConnection]);

  const connect = useCallback(async (): Promise<{
    ok: boolean;
    error?: string;
  }> => {
    if (!enabled) return { ok: false, error: "Codex provider is disabled" };
    setLoading(true);
    setError(null);
    try {
      const result = (await window.api.codexConnect()) as
        | { ok: true; email?: string; planType?: string; authMode?: string }
        | { ok: false; error: string };
      if (result.ok) {
        await refreshConnection();
        return { ok: true };
      }
      const errMsg =
        typeof result.error === "string" ? result.error : "Connection failed";
      setError(errMsg);
      return { ok: false, error: errMsg };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Connection failed";
      setError(msg);
      return { ok: false, error: msg };
    } finally {
      setLoading(false);
    }
  }, [enabled, refreshConnection]);

  const disconnect = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      await window.api.codexDisconnect();
      setIsConnected(false);
      setEmail(null);
      setPlanType(null);
      setAuthMode(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect");
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  return {
    isConnected,
    cliInstalled,
    email,
    planType,
    authMode,
    loading,
    error,
    connect,
    disconnect,
    refreshConnection,
  };
}
