# GC / OOM Debugging Learnings — Stratos

> **Last updated:** 2026-05-05  
> **Incidents:** OOM crash (heap reached 3.6 GB, then 3.4 GB) — two separate sessions

This document captures the methodology and specific findings from debugging two V8 OOM crashes in the Stratos Electron main process. Read this before starting any GC / memory investigation.

---

## 1. Diagnostic Artifacts — Where to Look First

Stratos has a crash-capture telemetry module that auto-generates all the artifacts you need.

### Heap dumps + state files

```
~/.stratos/instances/<hash>/heap-dumps/
```

Each threshold event (RSS 1/2/3 GB, heap 1/2/3 GB) writes two files:

- `<timestamp>-<trigger>-state.json` — **read this first** (tiny, instant)
- `<timestamp>-<trigger>.heapsnapshot` — V8 heap snapshot (can be gigabytes)

The state file contains:

```json
{
  "reason": "heap-3072MB",
  "rss": 8576778240,
  "heapUsed": 3423753884,
  "appState": {
    "sessions": 2,
    "activeStreams": 1,
    "previewFileWatchers": 2,
    "completionListeners": 1,
    "cachedSlashCommands": 69
  },
  "heapSpaceStats": [ ... ]
}
```

Key fields to check immediately:

- `old_space.space_used_size / old_space.space_size` — if >90%, you have a retention problem, not a spike
- `appState.previewFileWatchers` — should be ≤ number of sessions
- `appState.activeStreams` — is the crash correlated with streaming?
- `rss` vs `heapUsed` gap — a large gap (>2×) points to native allocations, IPC queue buildup, or heap fragmentation

### Memory growth log

```
~/.stratos/instances/<hash>/logs/memory.log.jsonl
~/.stratos/instances/<hash>/logs/memory.log.jsonl.1  ← rotated backup, often has the full history
```

Each line is a 30-second snapshot. Parse with:

```bash
cat memory.log.jsonl.1 | python3 -c "
import sys, json, datetime
for l in sys.stdin:
  d = json.loads(l.strip())
  ts = datetime.datetime.fromtimestamp(d['ts']/1000).strftime('%H:%M:%S')
  heap = d['heapUsed']/1024**3
  rss = d['rss']/1024**3
  streams = d['appState'].get('activeStreams','?')
  fw = d['appState'].get('previewFileWatchers','?')
  print(f'{ts} heap={heap:.3f}GB rss={rss:.2f}GB streams={streams} fw={fw}')
"
```

**What to look for in the log:**

- RSS growing while `heap` stays flat → native or IPC queue accumulation
- Heap spiking during streams but recovering → transient; OK
- Heap spiking during streams and NOT recovering → old_space retention; serious
- RSS growing between streams (no `activeStreams`) → file watcher reads, background polling

### Heap snapshot analysis

Heap snapshots over ~500 MB can't be `readFileSync`'d as a string (Node.js string limit ~512 MB). Use smaller threshold snapshots (1 GB heap/RSS) which are faster to load.

Quick analysis script:

```js
const fs = require("fs");
const snap = JSON.parse(fs.readFileSync("snapshot.heapsnapshot", "utf8"));
const nodeTypes = snap.snapshot.meta.node_types[0];
const fieldCount = snap.snapshot.meta.node_fields.length;
const { nodes, strings } = snap;
const nodeCount = snap.snapshot.node_count;

const summary = {};
for (let i = 0; i < nodeCount; i++) {
  const base = i * fieldCount;
  const t = nodeTypes[nodes[base]] || nodes[base];
  const size = nodes[base + 3];
  if (!summary[t]) summary[t] = { count: 0, totalSize: 0 };
  summary[t].count++;
  summary[t].totalSize += size;
}
Object.entries(summary)
  .sort((a, b) => b[1].totalSize - a[1].totalSize)
  .slice(0, 10)
  .forEach(([t, v]) =>
    console.log(
      `${t}: ${v.count} nodes, ${(v.totalSize / 1024 / 1024).toFixed(1)} MB`,
    ),
  );
```

**Normal baseline** (idle main process, ~40 MB heap snapshot):

- `string`: 60k–70k nodes, 15–20 MB — module source code loaded at startup
- `code`: 100k–130k nodes, 8–10 MB — JIT-compiled functions
- `array`: 30k–40k nodes, 4–6 MB

**Anomaly signals:**

- `string` count > 500k during a stream → streaming events are creating strings faster than GC can collect
- `sliced string` count > 100k → heavy substring operations; look for split/slice in hot paths
- `old_space` >90% full in heapSpaceStats → objects promoted before GC could reclaim them

---

## 2. Common Root Causes Found in This Codebase

### A. `execFileSync` in an IPC handler (CRITICAL — confirmed crash cause)

**What happens:** Any `execFileSync` / `spawnSync` in an `ipcMain.handle()` callback blocks the Node.js event loop for the entire duration of the child process. While blocked:

- The Claude subprocess keeps writing streaming events to stdout
- Events queue up in the Node.js pipe buffer
- When unblocked, all queued events burst-process simultaneously, creating large temporary string allocations in new_space
- New_space fills → objects promoted to old_space → old_space fills → GC fails → OOM

**How to spot it:** In the memory log, look for `heap` rising in discrete jumps (not smooth growth) correlated with `activeStreams=1`.

**Where it was:** `thread.ipc.ts` — `GIT_STATUS` handler ran `execFileSync("git", ...)` three times.

**Fix:** Replace with `promisify(execFile)` and `await`. Run `git branch` and `git status` in parallel with `Promise.all`.

```ts
// BAD
const out = execFileSync("git", ["status", "--porcelain=v1"], {
  encoding: "utf-8",
});

// GOOD
const execFileAsync = promisify(execFile);
const { stdout } = await execFileAsync("git", ["status", "--porcelain=v1"], {
  encoding: "utf-8",
});
```

**Rule for future code:** Never call `*Sync` filesystem or child-process APIs inside an `ipcMain.handle` or `ipcMain.on` handler. Always use the async variant.

---

### B. React `useEffect` dependency on `messages.length` during streaming (HIGH — confirmed crash cause)

**What happens:** When a `useEffect` that fires an IPC call depends on `messages.length`, and `messages.length` changes frequently during streaming (every 50ms with the debounce), the effect fires ~20×/second. Combined with an `execFileSync` handler (see A), this causes continuous main-process blocking. Even with an async handler, 20 IPC round-trips/second for a slow operation saturates the IPC channel.

An additional subtle bug: when the effect also sets an `setInterval` timer, the interval is always cancelled and reset before it can fire — so the "poll every N seconds" fallback never actually works.

**Where it was:** `App.tsx` — `useGitStatus(cwd, messages.length)`. The hook re-ran the git status IPC call AND reset the 5-second interval on every message batch.

**Fix:** Use a semantically meaningful refresh key. For git status, the right triggers are:

1. `cwd` changes (switch thread)
2. Stream ends (post-stream refresh to reflect commits/staging the agent did)
3. A stable polling interval (5s)

Not: the raw count of streaming messages.

```tsx
// BAD
const gitStatus = useGitStatus(activeThread?.cwd, messages.length);

// GOOD — refresh once when streaming stops, plus 5s poll
const gitStatus = useGitStatus(activeThread?.cwd, isStreaming);
```

**Rule for future code:** Do not pass `messages.length` (or any rapidly-changing streaming counter) as a `useEffect` dependency that triggers IPC calls. Use `isStreaming` as a boolean and trigger one post-stream refresh via a `wasStreaming` ref.

---

### C. Large JSONL transcript loading (CRITICAL — fixed in commit 331052a)

**What happens:** `getSessionMessages(sessionId)` from the Claude SDK deserializes the entire `.jsonl` session file before slicing to the last 2000 messages. For a 7+ MB JSONL file with large tool results (file reads, writes), this could allocate 1–2 GB in a single `loadMessages` call.

**Fix:** `readLastNJsonlMessages` — scans the raw `Buffer` backwards counting newlines, then `toString`s only the tail. Reads the full file into a `Buffer` (native heap, not V8 heap) but only parses the last N lines.

**Residual risk:** The `readFile(filePath)` call still reads the entire file into a Node.js `Buffer`. For very large JSONL files (>50 MB), even this is significant. Monitor JSONL file growth.

---

### D. `previewFileWatcher` reading unbounded file content (MEDIUM)

**What happens:** When the agent uses the `Write` tool, `openPreviewFile` creates an `fs.watch` watcher on the written file. On every subsequent modification to that file (by any process), the watcher reads the full file content and sends it via IPC to the renderer. For large files or frequently-modified files, this adds sustained heap pressure.

**Where it is:** `agent-manager.ts` — `watchPreviewFile`.

**Fix:** Add a file-size check before reading:

```ts
const stat = await fsPromises.stat(filePath);
if (stat.size > 2 * 1024 * 1024) return; // skip files > 2 MB
```

**Additional risk:** Watchers are per-thread and keyed to the last `Write`-tool file. They survive stream completion and persist until `clearSession`. With `MAX_IDLE_SESSIONS = 2`, up to 2 watchers can be alive simultaneously watching stale files. Check `appState.previewFileWatchers` in state files — it should equal `appState.sessions`.

---

### E. Idle subprocess accumulation (FIXED in commit 331052a)

**What happens:** The `MAX_IDLE_SESSIONS` cap controls how many Claude subprocesses can be idle (not streaming) before eviction. The original value was 10. Each idle session holds a live Claude subprocess with its own V8 heap (150–400 MB).

**Fix:** Reduced to 2 + 5-minute idle timer on control query.

**Residual risk:** The manager thread is exempt from eviction (it's persistent). Monitor for cases where the manager's subprocess accumulates large state.

---

## 3. Investigation Checklist for Future OOM Crashes

When an OOM occurs, follow this order:

1. **Read the state JSON** from the highest-threshold dump. Note `appState` counters — any unexpectedly high values are a signal.

2. **Parse the memory log** (check the `.1` backup — it may have the full history). Plot `heap` and `rss` over time. Identify:
   - When growth started (correlate with `activeStreams` transitions)
   - Whether growth is during streaming or between streams
   - Whether heap recovers after stream ends or keeps growing

3. **Check the heap snapshot** from the FIRST threshold (smallest file). Look at the string type distribution. If string count > 1M during a stream, there's a burst-processing problem.

4. **Search for `*Sync` calls in IPC handlers:**

   ```bash
   grep -rn "execFileSync\|spawnSync\|readFileSync\|writeFileSync" \
     packages/desktop/src/main/ --include="*.ts" | grep -v test
   ```

   Any hit inside an `ipcMain.handle` or `ipcMain.on` callback is a critical bug.

5. **Search for rapidly-firing `useEffect` IPC calls in the renderer:**
   Look for `useEffect` hooks that depend on `messages`, `messages.length`, or any per-streaming-event value, and that call `window.api.*` inside.

6. **Check JSONL file sizes** for all active sessions:

   ```bash
   find ~/.claude/projects -name "*.jsonl" -size +5M | xargs ls -lah | sort -k5 -hr
   ```

   Files >10 MB are expensive to load even with the backward scan.

7. **Check `previewFileWatchers` count** in the state. Should equal `sessions`. If higher, check `clearSession` cleanup paths.

---

## 4. Key Invariants to Maintain

| Invariant                                                  | Why                                                              |
| ---------------------------------------------------------- | ---------------------------------------------------------------- |
| No `*Sync` calls inside `ipcMain.handle/on`                | Blocks event loop; streaming events queue up and burst-process   |
| `useEffect` IPC calls must not depend on `messages.length` | Fires 20×/s during streaming; overwhelms the IPC channel         |
| `previewFileWatcher` skips files > 2 MB                    | Prevents large IPC messages and heap pressure from watcher reads |
| `MAX_IDLE_SESSIONS ≤ 3`                                    | Each idle subprocess holds 150–400 MB native heap                |
| JSONL files should be monitored for size                   | Backward scan still reads full file into native Buffer           |
| Manager thread is exempt from eviction                     | Must explicitly bound manager JSONL growth                       |

---

## 5. Commits That Fixed Past Issues

| Commit          | What was fixed                                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `6f5cf3f`       | Round-1 main-process leaks: Notification listeners, webContents retention, pendingPermissions                                                                            |
| `ee27faa`       | Round-2 leaks: terminal PTY reap on reload, scheduler notification listeners, debounceTimers, notificationQueue cap; added crash-capture telemetry                       |
| `331052a`       | Round-3 leaks: JSONL backward scan, manager loadMessages skip, MAX_IDLE_SESSIONS, plan markdown cap, modelsCache cap, streaming debounce in useChat, pending IPC timeout |
| `babd17e`       | **Introduced** the `execFileSync`/`messages.length` bug (git status panel)                                                                                               |
| _(this branch)_ | Fixed `execFileSync` → async, `messages.length` → `isStreaming`, `previewFileWatcher` 2 MB cap                                                                           |
