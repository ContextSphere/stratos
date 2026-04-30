/**
 * Crash-capture telemetry for the main process.
 *
 * Goal: when the app exits unexpectedly (V8 OOM, jetsam SIGKILL, network
 * service crash → parent dies), have enough data on disk to:
 *   1. See the heap + RSS trajectory leading up to the crash.
 *   2. Identify which V8 class is consuming memory (when crashes are heap-related).
 *   3. Correlate with what the application was doing.
 *
 * Mechanisms (always-on; opt out via STRATOS_DISABLE_CRASH_CAPTURE=1):
 *
 *  M2. Rotating memory log: every 30 s, append rss/heapUsed/external +
 *      caller-supplied app-state to logs/memory.log.jsonl. 5 MB rotation,
 *      one backup. Survives crash because each line is appended (no buffering).
 *
 *  M3a. Heap-threshold dumps: heapUsed crosses 1024/2048/3072 MB → snapshot.
 *  M3b. RSS-threshold dumps: rss crosses 1024/2048/3072 MB → snapshot.
 *       Both fire once per threshold per process. RSS catches crashes the
 *       heap thresholds miss (e.g. native buffer / child-process pressure).
 *
 *  M4. SIGUSR2 on-demand heap dump (manual trigger by power users).
 *
 *  M5. Crash marker: rewritten every 30 s with the current pid + state.
 *      On next launch, if marker is < 24 h old AND its pid is gone → prior
 *      session likely crashed; we log a pointer to the dumps + memory log.
 *
 *  M6. App-state JSON next to every dump: caller-supplied collector
 *      gives us sessions/pending/* counts so we know what was running
 *      when memory was at each threshold.
 *
 *  M7. Child-process-gone hook: when a renderer / utility / GPU process
 *      dies, dump immediately before Electron's parent-die cascade hits.
 *      Wired in main/index.ts via crashCapture.forceSnapshot(...).
 *
 *  Removed M1 (--heapsnapshot-near-heap-limit V8 flag): Electron 40's V8
 *  build rejects the flag with "unrecognized flag" on setFlagsFromString.
 *  The flag exists in mainline V8 but is not enabled in Electron's build.
 *  M3a/M3b cover the 1/2/3 GB threshold use case adequately.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { homedir } from "os";
import * as v8 from "v8";

export interface CrashCaptureOptions {
  /** Base directory for dumps + logs. Default: ~/.stratos */
  baseDir?: string;
  /** heapUsed thresholds (MB) at which to auto-dump. Default: [1024, 2048, 3072]. */
  heapThresholdsMB?: number[];
  /** rss thresholds (MB) at which to auto-dump. Default: [1024, 2048, 3072]. */
  rssThresholdsMB?: number[];
  /** Sampling interval for threshold checks. Default: 15 000 ms. */
  pollIntervalMs?: number;
  /** Append-to-log interval. Default: 30 000 ms. */
  memLogIntervalMs?: number;
  /** Memory log rotation size. Default: 5 MB. */
  memLogMaxBytes?: number;
  /** Optional state collector. Returns a JSON-serializable object recorded
   *  in every memory log line and alongside every heap dump. */
  collectAppState?: () => Record<string, unknown>;
  /** Override start-of-run timestamp (for tests). */
  now?: () => number;
}

export interface CrashCaptureHandle {
  /** Stop all timers and flush the marker. */
  dispose(): void;
  /** Write a heap snapshot + state file with a custom reason. */
  forceSnapshot(reason: string): string | null;
  /** Returns the directory where dumps land. */
  dumpDir(): string;
  /** Returns the path to the rotating memory log. */
  memLogPath(): string;
}

const DEFAULT_THRESHOLDS_MB = [1024, 2048, 3072];

function safeMkdir(dir: string): void {
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {}
  }
}

function rotateIfLarge(path: string, maxBytes: number): void {
  try {
    if (existsSync(path) && statSync(path).size > maxBytes) {
      // single rolling backup .1
      try {
        renameSync(path, path + ".1");
      } catch {}
    }
  } catch {}
}

function fmtTs(d = new Date()): string {
  return d.toISOString().replace(/[:.]/g, "-");
}

export function startCrashCapture(
  opts: CrashCaptureOptions = {},
): CrashCaptureHandle {
  if (process.env.STRATOS_DISABLE_CRASH_CAPTURE === "1") {
    return {
      dispose() {},
      forceSnapshot() {
        return null;
      },
      dumpDir() {
        return "";
      },
      memLogPath() {
        return "";
      },
    };
  }

  const baseDir = opts.baseDir ?? join(homedir(), ".stratos");
  const logsDir = join(baseDir, "logs");
  const dumpsDir = join(baseDir, "heap-dumps");
  safeMkdir(logsDir);
  safeMkdir(dumpsDir);

  const heapThresholdsMB = (opts.heapThresholdsMB ?? DEFAULT_THRESHOLDS_MB)
    .slice()
    .sort((a, b) => a - b);
  const rssThresholdsMB = (opts.rssThresholdsMB ?? DEFAULT_THRESHOLDS_MB)
    .slice()
    .sort((a, b) => a - b);
  const pollIntervalMs = opts.pollIntervalMs ?? 15_000;
  const memLogIntervalMs = opts.memLogIntervalMs ?? 30_000;
  const memLogMaxBytes = opts.memLogMaxBytes ?? 5 * 1024 * 1024;
  const memLogPath = join(logsDir, "memory.log.jsonl");
  const crashMarkerPath = join(logsDir, "crash-marker.json");
  const now = opts.now ?? Date.now;

  // ── Detect prior crash ─────────────────────────────────────────────────
  try {
    if (existsSync(crashMarkerPath)) {
      const raw = readFileSync(crashMarkerPath, "utf-8");
      const prior = JSON.parse(raw) as {
        pid?: number;
        ts?: number;
        rssMB?: number;
        heapUsedMB?: number;
      };
      const ageSec = prior.ts ? Math.round((now() - prior.ts) / 1000) : -1;
      // Heuristic: if marker is < 24h old and the pid no longer exists,
      // the prior session probably exited unexpectedly.
      console.log(
        `[crash-capture] prior marker pid=${prior.pid} ts=${prior.ts} ageSec=${ageSec} rss=${prior.rssMB}MB heap=${prior.heapUsedMB}MB`,
      );
      if (
        prior.pid &&
        prior.ts &&
        ageSec >= 0 &&
        ageSec < 24 * 3600 &&
        !pidIsAlive(prior.pid)
      ) {
        console.warn(
          `[crash-capture] prior session pid=${prior.pid} appears to have exited unexpectedly; check ${dumpsDir} and ${memLogPath}`,
        );
      }
    }
  } catch {
    // Non-fatal — first run, or marker corrupted
  }

  // ── M5: crash marker ───────────────────────────────────────────────────
  function writeCrashMarker(): void {
    try {
      const m = process.memoryUsage();
      const payload = {
        pid: process.pid,
        ts: now(),
        rssMB: Math.round(m.rss / 1024 / 1024),
        heapUsedMB: Math.round(m.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(m.heapTotal / 1024 / 1024),
        externalMB: Math.round(m.external / 1024 / 1024),
        appState: opts.collectAppState?.() ?? null,
      };
      writeFileSync(crashMarkerPath, JSON.stringify(payload));
    } catch {
      // best-effort
    }
  }

  // ── M2: rotating memory log ────────────────────────────────────────────
  function writeMemLogLine(): void {
    try {
      rotateIfLarge(memLogPath, memLogMaxBytes);
      const m = process.memoryUsage();
      const line =
        JSON.stringify({
          ts: now(),
          pid: process.pid,
          rss: m.rss,
          heapUsed: m.heapUsed,
          heapTotal: m.heapTotal,
          external: m.external,
          arrayBuffers: m.arrayBuffers,
          appState: opts.collectAppState?.() ?? null,
        }) + "\n";
      appendFileSync(memLogPath, line);
    } catch {
      // best-effort
    }
  }

  // ── M3 + M6: threshold dumps ───────────────────────────────────────────
  const firedHeapThresholds = new Set<number>();
  const firedRssThresholds = new Set<number>();
  function checkThresholds(): void {
    const m = process.memoryUsage();
    const heapMB = m.heapUsed / 1024 / 1024;
    const rssMB = m.rss / 1024 / 1024;
    for (const t of heapThresholdsMB) {
      if (heapMB >= t && !firedHeapThresholds.has(t)) {
        firedHeapThresholds.add(t);
        writeSnapshotAndState(`heap-${t}MB`);
      }
    }
    for (const t of rssThresholdsMB) {
      if (rssMB >= t && !firedRssThresholds.has(t)) {
        firedRssThresholds.add(t);
        writeSnapshotAndState(`rss-${t}MB`);
      }
    }
  }

  function writeSnapshotAndState(reason: string): string | null {
    const stamp = fmtTs();
    const safeReason = reason.replace(/[^a-z0-9_-]/gi, "_");
    const snapName = `${stamp}-${safeReason}.heapsnapshot`;
    const stateName = `${stamp}-${safeReason}-state.json`;
    const snapPath = join(dumpsDir, snapName);
    const statePath = join(dumpsDir, stateName);
    let success = false;
    try {
      v8.writeHeapSnapshot(snapPath);
      success = true;
      console.log(`[crash-capture] wrote ${snapPath}`);
    } catch (e) {
      console.error(`[crash-capture] writeHeapSnapshot failed:`, e);
    }
    try {
      const m = process.memoryUsage();
      writeFileSync(
        statePath,
        JSON.stringify(
          {
            reason,
            ts: now(),
            pid: process.pid,
            rss: m.rss,
            heapUsed: m.heapUsed,
            heapTotal: m.heapTotal,
            external: m.external,
            arrayBuffers: m.arrayBuffers,
            appState: opts.collectAppState?.() ?? null,
            heapStats: v8.getHeapStatistics(),
            heapSpaceStats: v8.getHeapSpaceStatistics(),
          },
          null,
          2,
        ),
      );
    } catch (e) {
      console.error(`[crash-capture] write state failed:`, e);
    }
    return success ? snapPath : null;
  }

  // ── M4: SIGUSR2 manual trigger ─────────────────────────────────────────
  process.on("SIGUSR2", () => {
    writeSnapshotAndState("sigusr2-manual");
  });

  // Periodic timers
  const memLogTimer = setInterval(() => {
    writeMemLogLine();
    writeCrashMarker();
  }, memLogIntervalMs);
  memLogTimer.unref?.();

  const pollTimer = setInterval(() => {
    checkThresholds();
  }, pollIntervalMs);
  pollTimer.unref?.();

  // Initial entries
  writeMemLogLine();
  writeCrashMarker();

  console.log(
    `[crash-capture] enabled: dumps=${dumpsDir} log=${memLogPath} heapThresholds=${heapThresholdsMB.join(",")}MB rssThresholds=${rssThresholdsMB.join(",")}MB pid=${process.pid}`,
  );

  return {
    dispose() {
      clearInterval(memLogTimer);
      clearInterval(pollTimer);
      writeCrashMarker();
    },
    forceSnapshot(reason: string) {
      return writeSnapshotAndState(reason);
    },
    dumpDir() {
      return dumpsDir;
    },
    memLogPath() {
      return memLogPath;
    },
  };
}

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
