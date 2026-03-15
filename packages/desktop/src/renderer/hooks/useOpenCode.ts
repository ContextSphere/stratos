import { useState, useCallback, useEffect } from "react";

interface ConnectionStatus {
  connected: boolean;
  cliInstalled: boolean;
  version: string | null;
  serverRunning: boolean;
}

interface UseOpenCodeReturn {
  isConnected: boolean;
  cliInstalled: boolean;
  version: string | null;
  serverRunning: boolean;
  loading: boolean;
  error: string | null;
  connect: () => Promise<{ ok: boolean; error?: string }>;
  disconnect: () => Promise<void>;
  refreshConnection: () => Promise<void>;
}

export function useOpenCode(): UseOpenCodeReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [cliInstalled, setCliInstalled] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const [serverRunning, setServerRunning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshConnection = useCallback(async () => {
    try {
      const status =
        (await window.api.opencodeGetConnection()) as ConnectionStatus;
      setIsConnected(status.connected);
      setCliInstalled(status.cliInstalled);
      setVersion(status.version);
      setServerRunning(status.serverRunning);
    } catch {
      setIsConnected(false);
      setCliInstalled(false);
      setVersion(null);
      setServerRunning(false);
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
      const result = (await window.api.opencodeConnect()) as
        | { ok: true; version?: string; serverRunning?: boolean }
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
      await window.api.opencodeDisconnect();
      setIsConnected(false);
      setServerRunning(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect");
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    isConnected,
    cliInstalled,
    version,
    serverRunning,
    loading,
    error,
    connect,
    disconnect,
    refreshConnection,
  };
}
