import { useState, useEffect, useCallback } from "react";
import type { GitStatus } from "@stratosapp/ui";

const EMPTY: GitStatus = { branch: null, files: {}, root: "" };

export function useGitStatus(
  cwd: string | undefined,
  refreshKey?: number,
): GitStatus {
  const [status, setStatus] = useState<GitStatus>(EMPTY);

  const refresh = useCallback(async () => {
    if (!cwd) return;
    try {
      const result = await window.api.gitStatus(cwd);
      setStatus(result as GitStatus);
    } catch {
      // ignore — not a git repo or git unavailable
    }
  }, [cwd]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh, refreshKey]);

  return status;
}
