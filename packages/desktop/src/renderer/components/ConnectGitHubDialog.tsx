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
  username: string | null;
  displayName: string | null;
  organizations: string[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onConnect: () => Promise<{ ok: boolean; error?: string }>;
  onDisconnect: () => Promise<void>;
}

export function ConnectGitHubDialog({
  isOpen,
  isConnected,
  cliInstalled,
  username,
  displayName,
  organizations,
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
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="GitHub"
      subtitle="Repos, PRs, issues & more"
      icon={icon}
      iconGradient="from-gray-700 to-gray-900"
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
              {username && (
                <>
                  <div className="text-xs text-[var(--text-muted)] mb-1">
                    Account
                  </div>
                  <div className="text-sm text-[var(--text-primary)] mb-3">
                    @{username}
                    {displayName && (
                      <span className="text-[var(--text-muted)] ml-1">
                        ({displayName})
                      </span>
                    )}
                  </div>
                </>
              )}
              {organizations.length > 0 && (
                <>
                  <div className="text-xs text-[var(--text-muted)] mb-1">
                    Organizations
                  </div>
                  <div className="text-sm text-[var(--text-primary)]">
                    {organizations.join(", ")}
                  </div>
                </>
              )}
            </Card>

            <div className="mb-4 p-3 bg-[var(--bg-surface)] rounded-lg">
              <p className="text-xs text-[var(--text-secondary)]">
                The AI assistant can use{" "}
                <code className="text-[var(--text-primary)]">gh</code> to manage
                repos, pull requests, issues, releases, Actions runs, and call
                the GitHub API directly.
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
                GitHub CLI not found
              </p>
              <p className="text-xs text-yellow-400/80">
                Install the <code className="text-yellow-300">gh</code> CLI to
                connect your GitHub account.
              </p>
            </div>

            <div className="mb-4 p-3 bg-[var(--bg-surface)] rounded-lg">
              <p className="text-xs text-[var(--text-muted)] mb-2">
                Install via Homebrew:
              </p>
              <code className="text-xs text-[var(--text-primary)] bg-[var(--bg-main)] px-2 py-1 rounded block">
                brew install gh
              </code>
              <p className="text-xs text-[var(--text-muted)] mt-3">
                Or download from{" "}
                <a
                  href="https://cli.github.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:underline"
                >
                  cli.github.com
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
              Authenticate with GitHub to let the AI assistant manage
              repositories, pull requests, issues, and more using the{" "}
              <code className="text-[var(--text-primary)]">gh</code> CLI.
            </p>

            {error && (
              <div className="mb-4 p-3 bg-red-900/20 border border-red-500/20 rounded-lg">
                <p className="text-xs text-red-400">{error}</p>
              </div>
            )}

            <button
              onClick={handleConnect}
              disabled={loading}
              className="w-full py-3 px-4 rounded-xl bg-[#24292e] text-white text-sm font-medium hover:bg-[#2f363d] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg
                    className="animate-spin h-4 w-4 text-gray-400"
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
                  <span className="text-gray-400">Waiting for sign-in...</span>
                </span>
              ) : (
                <>
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                  </svg>
                  Sign in with GitHub
                </>
              )}
            </button>

            <p className="text-[10px] text-[var(--text-muted)] mt-3 text-center">
              A one-time code will appear in your terminal. Open the link in
              your browser to complete authentication.
            </p>
          </>
        )}
      </DialogBody>
    </Dialog>
  );
}
