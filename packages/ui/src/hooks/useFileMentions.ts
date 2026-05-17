import { useState, useEffect, useRef } from "react";

export interface FileMentionsBridge {
  listAllFiles?: (cwd: string) => Promise<string[]>;
  watchDirectory?: (cwd: string) => Promise<void>;
  unwatchDirectory?: () => Promise<void>;
  onDirectoryChanged?: (callback: (dirPath: string) => void) => () => void;
}

// Debounce window for the post-change re-walk. The walk is O(workspace
// size) in both main-process readdir() calls AND IPC payload (one string
// per file). Heap-snapshot analysis of the May 16 OOM found 37,738
// retained Development/Aura paths in main old_space — the signature of
// concurrent re-walks of a 37K-file workspace firing on every edit while
// the agent did rapid file changes. The autocomplete list only matters
// when the user is about to type "@", so it's fine if it lags edits by
// a few seconds.
const REWALK_DEBOUNCE_MS = 5_000;

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

    // In-flight guard + debounce timer. Prevents a burst of file edits
    // from kicking off N concurrent recursive walks, each allocating a
    // full set of path strings in main old_space.
    let rewalkTimer: ReturnType<typeof setTimeout> | null = null;
    let rewalkInFlight = false;

    const doRewalk = () => {
      rewalkTimer = null;
      const currentCwd = cwdRef.current;
      const currentBridge = bridgeRef.current;
      if (!currentCwd || !currentBridge?.listAllFiles) return;
      if (rewalkInFlight) {
        // A walk is already running — let it finish; if more changes
        // arrived during, the next-edit debounce schedule will catch them.
        return;
      }
      rewalkInFlight = true;
      void currentBridge
        .listAllFiles(currentCwd)
        .then(setFiles)
        .catch(() => setFiles([]))
        .finally(() => {
          rewalkInFlight = false;
        });
    };

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
      // Coalesce all directory-change events within the debounce window
      // into a single re-walk. Without this, a rapid sequence of file
      // edits (the agent doing parallel Write/Edit calls) triggered N
      // simultaneous full-workspace walks and OOM'd main.
      if (rewalkTimer !== null) clearTimeout(rewalkTimer);
      rewalkTimer = setTimeout(doRewalk, REWALK_DEBOUNCE_MS);
    });

    return () => {
      if (rewalkTimer !== null) clearTimeout(rewalkTimer);
      unsubscribe?.();
      void bridgeRef.current?.unwatchDirectory?.();
    };
  }, [cwd]); // bridge accessed entirely via bridgeRef — no eslint-disable needed

  return { files, loading };
}
