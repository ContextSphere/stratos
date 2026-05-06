import { useState, useEffect, useCallback, useRef } from "react";
import type { GitStatus } from "@stratosapp/ui";

const EMPTY: GitStatus = { branch: null, files: {}, root: "" };
const POLL_INTERVAL_MS = 5000;

export function useGitStatus(
  cwd: string | undefined,
  isStreaming?: boolean,
): GitStatus {
  const [status, setStatus] = useState<GitStatus>(EMPTY);
  const wasStreamingRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!cwd) return;
    try {
      const result = await window.api.gitStatus(cwd);
      setStatus(result as GitStatus);
    } catch {
      // ignore — not a git repo or git unavailable
    }
  }, [cwd]);

  // 5-second poll — always runs (cwd-scoped)
  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  // After a stream ends, do one immediate refresh so badges reflect the final state.
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) {
      refresh();
    }
    wasStreamingRef.current = !!isStreaming;
  }, [isStreaming, refresh]);

  return status;
}
