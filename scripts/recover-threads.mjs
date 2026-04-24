#!/usr/bin/env node
/**
 * Recover orphaned threads back into ~/.stratos/threads/threads.json by
 * mining metadata out of the per-thread trace files under
 * ~/.stratos/threads/traces/*.jsonl.
 *
 * Safe to run while the app is NOT running. Merges only — never drops
 * threads that are already in threads.json. Writes atomically via
 * tempfile + rename and leaves a timestamped backup of the current file.
 *
 * Usage:
 *   node scripts/recover-threads.mjs [--dry-run]
 */
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  renameSync,
  copyFileSync,
  existsSync,
  createReadStream,
} from "fs";
import { createInterface } from "readline";
import { homedir } from "os";
import { join, basename } from "path";

const DRY_RUN = process.argv.includes("--dry-run");
const STRATOS = join(homedir(), ".stratos");
const THREADS_DIR = join(STRATOS, "threads");
const THREADS_FILE = join(THREADS_DIR, "threads.json");
const TRACES_DIR = join(THREADS_DIR, "traces");
const MESSAGES_DIR = join(THREADS_DIR, "messages");

async function scanTrace(filePath) {
  const stream = createReadStream(filePath, { encoding: "utf-8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let firstTs = null;
  let lastTs = null;
  let cwd = null;
  let sessionId = null;
  let model = null;
  let permissionMode = null;
  let firstUserText = null;
  let lineCount = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;
    lineCount++;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = e.timestamp;
    if (typeof ts === "number") {
      if (firstTs === null) firstTs = ts;
      lastTs = ts;
    }
    const d = e.data || {};
    if (!sessionId && d.session_id) sessionId = d.session_id;
    if (!cwd && d.cwd) cwd = d.cwd;
    if (!model && d.model) model = d.model;
    if (!permissionMode && d.permissionMode) permissionMode = d.permissionMode;

    if (!firstUserText && e.messageType === "user") {
      const msg = d.message;
      if (msg) {
        const content = msg.content;
        if (typeof content === "string") {
          firstUserText = content;
        } else if (Array.isArray(content)) {
          for (const c of content) {
            if (c && typeof c === "object" && c.type === "text" && c.text) {
              firstUserText = c.text;
              break;
            }
          }
        }
      }
    }
  }

  return {
    firstTs,
    lastTs,
    cwd,
    sessionId,
    model,
    permissionMode,
    firstUserText,
    lineCount,
  };
}

function deriveTitle(trace, fallbackId) {
  if (trace.firstUserText) {
    const first = trace.firstUserText.trim().split(/\r?\n/)[0] ?? "";
    const t = first.slice(0, 70).trim();
    if (t) return t;
  }
  return fallbackId.replace(/-/g, " ");
}

function normalizeMode(m) {
  if (!m) return undefined;
  if (
    ["plan", "default", "acceptEdits", "bypassPermissions", "fullAccess"].includes(
      m,
    )
  ) {
    return m;
  }
  return undefined;
}

function mtimeMs(p) {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return null;
  }
}

async function main() {
  if (!existsSync(THREADS_FILE)) {
    console.error(`No threads.json at ${THREADS_FILE}`);
    process.exit(1);
  }
  if (!existsSync(TRACES_DIR)) {
    console.error(`No traces dir at ${TRACES_DIR}`);
    process.exit(1);
  }

  const raw = readFileSync(THREADS_FILE, "utf-8");
  const data = JSON.parse(raw);
  data.threads = Array.isArray(data.threads) ? data.threads : [];
  data.folders = Array.isArray(data.folders) ? data.folders : [];

  const existingIds = new Set(data.threads.map((t) => t.id));
  const existingFolderPaths = new Set(data.folders.map((f) => f.path));

  const traceFiles = readdirSync(TRACES_DIR).filter((f) => f.endsWith(".jsonl"));

  const recovered = [];
  const discoveredCwds = new Set();
  for (const file of traceFiles) {
    const id = basename(file, ".jsonl");
    if (existingIds.has(id)) continue;

    const fullPath = join(TRACES_DIR, file);
    const trace = await scanTrace(fullPath);
    const fileMtime = mtimeMs(fullPath);
    const msgPath = join(MESSAGES_DIR, `${id}.json`);
    const msgMtime = mtimeMs(msgPath);

    const createdAt =
      trace.firstTs ?? fileMtime ?? msgMtime ?? Date.now();
    const updatedAt =
      trace.lastTs ?? fileMtime ?? msgMtime ?? createdAt;

    const thread = {
      id,
      title: deriveTitle(trace, id),
      createdAt,
      updatedAt,
      provider: "claude-code",
    };
    if (trace.model) thread.model = trace.model;
    if (trace.cwd) thread.cwd = trace.cwd;
    if (trace.sessionId) thread.sessionId = trace.sessionId;
    const mode = normalizeMode(trace.permissionMode);
    if (mode) thread.mode = mode;

    if (trace.cwd) discoveredCwds.add(trace.cwd);
    recovered.push(thread);
  }

  // Sort recovered by createdAt descending so they appear above the current
  // auto-generated ones — oldest-to-newest, newest first overall.
  recovered.sort((a, b) => b.createdAt - a.createdAt);

  // Preserve existing folders; add new ones for any recovered thread whose
  // cwd has no folder yet, so the sidebar actually shows them grouped.
  const newFolders = [];
  for (const cwd of discoveredCwds) {
    if (!cwd) continue;
    if (existingFolderPaths.has(cwd)) continue;
    // Skip synthetic paths that aren't real folders
    if (cwd.startsWith(join(STRATOS, "manager"))) continue;
    newFolders.push({
      id: `folder_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      name: basename(cwd),
      path: cwd,
      createdAt: Date.now(),
    });
    existingFolderPaths.add(cwd);
  }

  data.threads = [...data.threads, ...recovered];
  data.folders = [...data.folders, ...newFolders];

  console.log(`Recovered ${recovered.length} thread(s)`);
  for (const t of recovered) {
    console.log(`  + ${t.id}  cwd=${t.cwd ?? "-"}  title=${JSON.stringify(t.title)}`);
  }
  if (newFolders.length) {
    console.log(`Added ${newFolders.length} folder(s):`);
    for (const f of newFolders) console.log(`  + ${f.path}`);
  }

  if (DRY_RUN) {
    console.log("\n--dry-run: not writing");
    return;
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = `${THREADS_FILE}.${ts}.bak`;
  copyFileSync(THREADS_FILE, backup);
  console.log(`Backup: ${backup}`);

  const tmp = `${THREADS_FILE}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  renameSync(tmp, THREADS_FILE);
  console.log(`Wrote ${THREADS_FILE}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
