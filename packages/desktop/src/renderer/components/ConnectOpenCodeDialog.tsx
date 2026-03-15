import { useState, useCallback } from "react";
import {
  Dialog,
  DialogBody,
  Button,
  StatusIndicator,
  Card,
} from "@stratosapp/ui";

interface Props {
  isOpen: boolean;
  isConnected: boolean;
  cliInstalled: boolean;
  version: string | null;
  serverRunning: boolean;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onConnect: () => Promise<{ ok: boolean; error?: string }>;
  onDisconnect: () => Promise<void>;
}

export function ConnectOpenCodeDialog({
  isOpen,
  isConnected,
  cliInstalled,
  version,
  serverRunning,
  loading: externalLoading,
  error: externalError,
  onClose,
  onConnect,
  onDisconnect,
}: Props): React.ReactElement | null {
  const [localLoading, setLocalLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const loading = externalLoading || localLoading;
  const error = localError ?? externalError;

  const handleConnect = useCallback(async () => {
    setLocalLoading(true);
    setLocalError(null);
    try {
      const result = await onConnect();
      if (!result.ok) {
        setLocalError(result.error ?? "Failed to connect");
      } else {
        onClose();
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setLocalLoading(false);
    }
  }, [onConnect, onClose]);

  const handleDisconnect = useCallback(async () => {
    setLocalLoading(true);
    setLocalError(null);
    await onDisconnect();
    setLocalLoading(false);
  }, [onDisconnect]);

  const icon = (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-white">
      <path
        d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="OpenCode"
      subtitle="Connection & server status"
      icon={icon}
      iconGradient="from-violet-600 to-purple-700"
      maxWidth="sm"
    >
      <DialogBody>
        {isConnected ? (
          <>
            <StatusIndicator
              status="connected"
              label="Connected"
              className="mb-4"
            />

            <Card variant="nested" className="mb-4">
              {version && (
                <>
                  <div className="text-xs text-[var(--text-muted)] mb-1">
                    Version
                  </div>
                  <div className="text-sm text-[var(--text-primary)] mb-3">
                    {version}
                  </div>
                </>
              )}
              <div className="text-xs text-[var(--text-muted)] mb-1">
                Server
              </div>
              <div className="text-sm text-[var(--text-primary)]">
                {serverRunning ? "Running" : "Stopped"}
              </div>
            </Card>

            <div className="mb-4 p-3 bg-[var(--bg-surface)] rounded-lg">
              <p className="text-xs text-[var(--text-secondary)]">
                OpenCode connects to a running server instance. Disconnecting
                will stop Stratos from communicating with the server, but the
                server will continue running.
              </p>
            </div>

            <Button
              variant="destructive"
              onClick={handleDisconnect}
              disabled={loading}
              loading={loading}
              className="w-full"
            >
              Disconnect
            </Button>
          </>
        ) : !cliInstalled ? (
          <>
            <div className="mb-4 p-3 bg-yellow-900/20 border border-yellow-500/20 rounded-lg">
              <p className="text-xs text-yellow-400 font-medium mb-1">
                OpenCode CLI not found
              </p>
              <p className="text-xs text-yellow-400/80">
                Install the <code className="text-yellow-300">opencode</code>{" "}
                CLI to get started.
              </p>
            </div>

            <div className="mb-4 p-3 bg-[var(--bg-surface)] rounded-lg">
              <p className="text-xs text-[var(--text-muted)] mb-2">
                Install via npm:
              </p>
              <code className="text-xs text-[var(--text-primary)] bg-[var(--bg-main)] px-2 py-1 rounded block">
                npm install -g opencode-ai
              </code>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-900/20 border border-red-500/20 rounded-lg">
                <p className="text-xs text-red-400">{error}</p>
              </div>
            )}
          </>
        ) : (
          <>
            <p className="text-xs text-[var(--text-secondary)] mb-3">
              OpenCode requires a running server. Start it in a terminal first:
            </p>

            <div className="mb-4 p-3 bg-[var(--bg-surface)] rounded-lg">
              <code className="text-xs text-[var(--text-primary)] bg-[var(--bg-main)] px-2 py-1 rounded block">
                opencode serve
              </code>
            </div>

            <p className="text-xs text-[var(--text-secondary)] mb-5">
              Then click Connect to verify the server is reachable.
            </p>

            {error && (
              <div className="mb-4 p-3 bg-red-900/20 border border-red-500/20 rounded-lg">
                <p className="text-xs text-red-400">{error}</p>
              </div>
            )}

            <button
              onClick={handleConnect}
              disabled={loading}
              className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 text-white text-sm font-medium hover:from-violet-500 hover:to-purple-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg
                    className="animate-spin h-4 w-4 text-white/60"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                      fill="none"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  <span className="text-white/60">Connecting...</span>
                </span>
              ) : (
                <>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 2L2 7l10 5 10-5-10-5z" />
                    <path d="M2 17l10 5 10-5" />
                    <path d="M2 12l10 5 10-5" />
                  </svg>
                  Connect to OpenCode
                </>
              )}
            </button>

            <p className="text-[10px] text-[var(--text-muted)] mt-3 text-center">
              Stratos will connect to the OpenCode server running on localhost.
            </p>
          </>
        )}
      </DialogBody>
    </Dialog>
  );
}
