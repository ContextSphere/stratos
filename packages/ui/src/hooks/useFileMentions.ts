import { useState, useEffect, useRef } from "react";

export interface FileMentionsBridge {
  listAllFiles?: (cwd: string) => Promise<string[]>;
  watchDirectory?: (cwd: string) => Promise<void>;
  unwatchDirectory?: () => Promise<void>;
  onDirectoryChanged?: (callback: (dirPath: string) => void) => () => void;
}

export function useFileMentions(
  cwd: string | undefined,
  bridge: FileMentionsBridge | undefined,
): { files: string[]; loading: boolean } {
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  // Use refs so the change callback always sees the latest bridge/cwd
  // without adding them to the effect deps (avoids re-running on every render
  // when the caller passes an inline bridge object).
  const bridgeRef = useRef(bridge);
  bridgeRef.current = bridge;
  const cwdRef = useRef(cwd);
  cwdRef.current = cwd;

  useEffect(() => {
    const b = bridgeRef.current;
    if (!cwd || !b?.listAllFiles) return;

    setLoading(true);
    void b
      .listAllFiles(cwd)
      .then(setFiles)
      .catch(() => setFiles([]))
      .finally(() => setLoading(false));

    if (b.watchDirectory) {
      void b.watchDirectory(cwd);
    }

    const unsubscribe = b.onDirectoryChanged?.(() => {
      const currentCwd = cwdRef.current;
      const currentBridge = bridgeRef.current;
      if (!currentCwd || !currentBridge?.listAllFiles) return;
      void currentBridge
        .listAllFiles(currentCwd)
        .then(setFiles)
        .catch(() => setFiles([]));
    });

    return () => {
      unsubscribe?.();
      void bridgeRef.current?.unwatchDirectory?.();
    };
  }, [cwd]); // bridge accessed entirely via bridgeRef — no eslint-disable needed

  return { files, loading };
}
