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
  email: string | null;
  subscriptionType: string | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onConnect: () => Promise<{ ok: boolean; error?: string }>;
  onDisconnect: () => Promise<void>;
}

export function ConnectClaudeDialog({
  isOpen,
  isConnected,
  cliInstalled,
  email,
  subscriptionType,
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
      <path d="M4.709 15.955l.027-.03c.79-.876 1.222-1.957 1.222-3.06 0-.373-.05-.743-.147-1.104a4.07 4.07 0 0 0-.148-.463C4.526 8.088 7.9 5.049 12 5.049c4.1 0 7.474 3.04 6.337 6.249a4.07 4.07 0 0 0-.148.463 3.973 3.973 0 0 0-.147 1.103c0 1.104.432 2.185 1.222 3.061l.027.03C20.356 17.078 16.481 19.2 12 19.2s-8.356-2.122-7.291-3.245zM12 2.4C6.035 2.4 1.2 6.876 1.2 12.4c0 2.268.808 4.367 2.18 6.063.472.583 1.466 1.272 2.404 1.764C7.296 21.01 9.536 21.6 12 21.6c2.464 0 4.704-.59 6.216-1.373.938-.492 1.932-1.181 2.404-1.764A9.917 9.917 0 0 0 22.8 12.4c0-5.524-4.835-10-10.8-10zM8.4 12a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4zm7.2 0a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4z" />
    </svg>
  );

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Claude"
      subtitle="Authentication & account"
      icon={icon}
      iconGradient="from-orange-600 to-amber-700"
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
              {email && (
                <>
                  <div className="text-xs text-[var(--text-muted)] mb-1">
                    Account
                  </div>
                  <div className="text-sm text-[var(--text-primary)] mb-3">
                    {email}
                  </div>
                </>
              )}
              {subscriptionType && (
                <>
                  <div className="text-xs text-[var(--text-muted)] mb-1">
                    Plan
                  </div>
                  <div className="text-sm text-[var(--text-primary)] capitalize">
                    {subscriptionType}
                  </div>
                </>
              )}
            </Card>

            <div className="mb-4 p-3 bg-[var(--bg-surface)] rounded-lg">
              <p className="text-xs text-[var(--text-secondary)]">
                The AI assistant uses your Claude account for authentication.
                Signing out will require re-authentication to continue using the
                app.
              </p>
            </div>

            <Button
              variant="destructive"
              onClick={handleDisconnect}
              disabled={loading}
              loading={loading}
              className="w-full"
            >
              Sign out
            </Button>
          </>
        ) : !cliInstalled ? (
          <>
            <div className="mb-4 p-3 bg-yellow-900/20 border border-yellow-500/20 rounded-lg">
              <p className="text-xs text-yellow-400 font-medium mb-1">
                Claude CLI not found
              </p>
              <p className="text-xs text-yellow-400/80">
                Install the <code className="text-yellow-300">claude</code> CLI
                to connect your account.
              </p>
            </div>

            <div className="mb-4 p-3 bg-[var(--bg-surface)] rounded-lg">
              <p className="text-xs text-[var(--text-muted)] mb-2">
                Install via npm:
              </p>
              <code className="text-xs text-[var(--text-primary)] bg-[var(--bg-main)] px-2 py-1 rounded block">
                npm install -g @anthropic-ai/claude-code
              </code>
              <p className="text-xs text-[var(--text-muted)] mt-3">
                Or visit{" "}
                <a
                  href="https://docs.anthropic.com/en/docs/claude-code"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:underline"
                >
                  docs.anthropic.com
                </a>
              </p>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-900/20 border border-red-500/20 rounded-lg">
                <p className="text-xs text-red-400">{error}</p>
              </div>
            )}
          </>
        ) : (
          <>
            <p className="text-xs text-[var(--text-secondary)] mb-5">
              Sign in with your Claude account to authenticate. This opens your
              browser to complete the OAuth flow.
            </p>

            {error && (
              <div className="mb-4 p-3 bg-red-900/20 border border-red-500/20 rounded-lg">
                <p className="text-xs text-red-400">{error}</p>
              </div>
            )}

            <button
              onClick={handleConnect}
              disabled={loading}
              className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-orange-600 to-amber-600 text-white text-sm font-medium hover:from-orange-500 hover:to-amber-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
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
                  <span className="text-white/60">Waiting for sign-in...</span>
                </span>
              ) : (
                <>
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M4.709 15.955l.027-.03c.79-.876 1.222-1.957 1.222-3.06 0-.373-.05-.743-.147-1.104a4.07 4.07 0 0 0-.148-.463C4.526 8.088 7.9 5.049 12 5.049c4.1 0 7.474 3.04 6.337 6.249a4.07 4.07 0 0 0-.148.463 3.973 3.973 0 0 0-.147 1.103c0 1.104.432 2.185 1.222 3.061l.027.03C20.356 17.078 16.481 19.2 12 19.2s-8.356-2.122-7.291-3.245zM12 2.4C6.035 2.4 1.2 6.876 1.2 12.4c0 2.268.808 4.367 2.18 6.063.472.583 1.466 1.272 2.404 1.764C7.296 21.01 9.536 21.6 12 21.6c2.464 0 4.704-.59 6.216-1.373.938-.492 1.932-1.181 2.404-1.764A9.917 9.917 0 0 0 22.8 12.4c0-5.524-4.835-10-10.8-10zM8.4 12a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4zm7.2 0a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4z" />
                  </svg>
                  Sign in with Claude
                </>
              )}
            </button>

            <p className="text-[10px] text-[var(--text-muted)] mt-3 text-center">
              Your browser will open to complete authentication.
            </p>
          </>
        )}
      </DialogBody>
    </Dialog>
  );
}
