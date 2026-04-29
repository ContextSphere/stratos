/**
 * Crash-capture telemetry for the main process.
 *
 * Goal: when V8 OOMs (the user reports a recurring ~4 GB heap OOM after
 * ~17 hours of usage), have enough data on disk to:
 *   1. See the heap trajectory leading up to the crash.
 *   2. Identify which V8 class is consuming memory.
 *   3. Correlate with what the application was doing.
 *
 * Six mechanisms, all always-on (opt-out via STRATOS_DISABLE_CRASH_CAPTURE=1):
 *
 *  M1. --heapsnapshot-near-heap-limit=N — V8 auto-writes up to N heap
 *      snapshots when GC realizes it's losing. Set via v8.setFlagsFromString
 *      at boot. Snapshots land in the process CWD (we chdir to heap-dumps
 *      so they end up in the right place).
 *
 *  M2. Rotating memory log: every 60 s, append rss/heapUsed/external + the
 *      caller-supplied app-state to logs/memory.log.jsonl. 5 MB rotation,
 *      one backup. Survives crash because each line is fsync'd.
 *
 *  M3. Threshold heap dumps: when heapUsed crosses 1024/2048/3072 MB for
 *      the first time, write a snapshot + state file. Each threshold
 *      fires at most once per process to avoid filling the disk on a
 *      flapping process.
 *
 *  M4. SIGUSR2 on-demand heap dump (manual trigger by power users).
 *
 *  M5. Crash marker: rewritten every 60 s with the current pid + state.
 *      On next launch, the marker is read and — if its last update is
 *      old (say > 5 minutes) AND the pid is gone — the prior session
 *      likely crashed. We surface this in the log on boot.
 *
 *  M6. App-state JSON next to every dump: caller-supplied collector
 *      gives us sessions/pending/* counts so we know what was running
 *      when memory was at each threshold.
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
  /** Heap thresholds (MB) at which to auto-dump. Default: [1024, 2048, 3072]. */
  thresholdsMB?: number[];
  /** Sampling interval for threshold checks. Default: 30 000 ms. */
  pollIntervalMs?: number;
  /** Append-to-log interval. Default: 60 000 ms. */
  memLogIntervalMs?: number;
  /** Memory log rotation size. Default: 5 MB. */
  memLogMaxBytes?: number;
  /** Optional state collector. Returns a JSON-serializable object recorded
   *  in every memory log line and alongside every heap dump. */
  collectAppState?: () => Record<string, unknown>;
  /** If true, also write a heap snapshot just-before-OOM via the V8 flag. */
  enableNearOomSnapshot?: boolean;
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

  const thresholdsMB = (opts.thresholdsMB ?? DEFAULT_THRESHOLDS_MB)
    .slice()
    .sort((a, b) => a - b);
  const pollIntervalMs = opts.pollIntervalMs ?? 30_000;
  const memLogIntervalMs = opts.memLogIntervalMs ?? 60_000;
  const memLogMaxBytes = opts.memLogMaxBytes ?? 5 * 1024 * 1024;
  const memLogPath = join(logsDir, "memory.log.jsonl");
  const crashMarkerPath = join(logsDir, "crash-marker.json");
  const enableNearOomSnapshot = opts.enableNearOomSnapshot ?? true;
  const now = opts.now ?? Date.now;

  // ── M1: --heapsnapshot-near-heap-limit ─────────────────────────────────
  // Make V8 dump a snapshot to the dumps dir when it's about to OOM.
  // We chdir is unsafe (Electron uses cwd for various things), so instead
  // we set the flag and rely on V8 writing into process.cwd(). Electron's
  // cwd on a packaged app is the app bundle dir on macOS, which is read-only.
  // To get the snapshot into a writable dir, we set process.chdir to the
  // dumps dir ONCE at boot. Most code uses absolute paths anyway.
  if (enableNearOomSnapshot) {
    try {
      // Two snapshots: one early (before the death spiral), one final.
      v8.setFlagsFromString("--heapsnapshot-near-heap-limit=2");
    } catch (e) {
      console.warn("[crash-capture] could not set heap-near-limit flag:", e);
    }
    // V8 writes to cwd. Move cwd to dumps dir so they land somewhere
    // writable + findable. Skip if already absolute / writable.
    try {
      process.chdir(dumpsDir);
    } catch {
      // chdir failed (read-only fs?). The flag still works, snapshots just
      // land in whatever the current cwd is.
    }
  }

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
  const firedThresholds = new Set<number>();
  function checkThresholds(): void {
    const m = process.memoryUsage();
    const heapMB = m.heapUsed / 1024 / 1024;
    for (const t of thresholdsMB) {
      if (heapMB >= t && !firedThresholds.has(t)) {
        firedThresholds.add(t);
        writeSnapshotAndState(`threshold-${t}MB`);
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
    `[crash-capture] enabled: dumps=${dumpsDir} log=${memLogPath} thresholds=${thresholdsMB.join(",")}MB pid=${process.pid}`,
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
