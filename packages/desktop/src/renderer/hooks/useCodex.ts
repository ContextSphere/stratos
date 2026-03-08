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

export function useCodex(): UseCodexReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [cliInstalled, setCliInstalled] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [planType, setPlanType] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshConnection = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    refreshConnection();
  }, [refreshConnection]);

  const connect = useCallback(async (): Promise<{
    ok: boolean;
    error?: string;
  }> => {
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
  }, [refreshConnection]);

  const disconnect = useCallback(async () => {
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
  }, []);

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
