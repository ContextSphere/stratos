/**
 * Source for the self-contained `stratos-schedule-mcp` stdio MCP server.
 * Written to ~/.stratos/bin/stratos-schedule-mcp on app startup.
 * Injected into every agent session so any provider with MCP support can
 * create and manage Stratos scheduled prompts as first-class tools.
 *
 * Uses only Node.js built-ins — no external dependencies.
 * Protocol: newline-delimited JSON-RPC 2.0 over stdio (MCP stdio transport).
 */

export const SCHEDULE_MCP_SOURCE = `#!/usr/bin/env node
"use strict";

const { readFileSync, writeFileSync, existsSync, mkdirSync } = require("fs");
const { join } = require("path");
const { homedir } = require("os");
const readline = require("readline");

const CONFIG_DIR = join(homedir(), ".stratos");
const STORE_PATH = join(CONFIG_DIR, "scheduled-prompts.json");
const THREADS_PATH = join(CONFIG_DIR, "threads", "threads.json");

// ── storage helpers ───────────────────────────────────────────────────────────

function load() {
  if (!existsSync(STORE_PATH)) return [];
  try { return JSON.parse(readFileSync(STORE_PATH, "utf-8")); }
  catch { return []; }
}

function save(prompts) {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(STORE_PATH, JSON.stringify(prompts, null, 2), "utf-8");
}

function loadFolders() {
  if (!existsSync(THREADS_PATH)) return [];
  try {
    const data = JSON.parse(readFileSync(THREADS_PATH, "utf-8"));
    return data.folders || [];
  } catch { return []; }
}

function genId() {
  return "sched_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
}

// ── schedule config builder ───────────────────────────────────────────────────

function buildSchedule(args) {
  if (args.once) {
    return { type: "once", runAt: args.once };
  }
  const interval = args.interval || "every-day";
  const config = { type: "recurring", interval };
  if (interval === "custom") config.customCron = args.cron;
  if (args.time) config.timeOfDay = args.time;
  if (args.day !== undefined) config.dayOfWeek = parseInt(args.day, 10);
  return config;
}

// ── tool implementations ──────────────────────────────────────────────────────

function toolScheduleCreate(args) {
  const { name, prompt, provider = "claude-code", model, cwd, folder, interval, once, time, day, cron } = args;
  if (!name) return { isError: true, text: "name is required" };
  if (!prompt) return { isError: true, text: "prompt is required" };

  let folderId;
  const folders = loadFolders();
  if (cwd) {
    const f = folders.find(f => f.path === cwd);
    if (f) folderId = f.id;
    else return { isError: true, text: "No folder found with path: " + cwd };
  } else if (folder) {
    const f = folders.find(f => f.name === folder || f.name.endsWith(folder));
    if (f) folderId = f.id;
    else return { isError: true, text: "No folder found named: " + folder };
  } else {
    if (folders.length === 0) return { isError: true, text: "No folders found. Provide cwd or folder." };
    folderId = folders[0].id;
  }

  const schedule = buildSchedule({ once, interval, cron, time, day });
  const prompts = load();
  const entry = {
    id: genId(), name, prompt, provider, folderId, schedule,
    enabled: true, createdAt: Date.now(),
    ...(model ? { model } : {}),
  };
  prompts.push(entry);
  save(prompts);
  return { text: JSON.stringify(entry, null, 2) };
}

function toolScheduleList() {
  const prompts = load();
  const folders = loadFolders();
  const list = prompts.map(p => {
    const folder = folders.find(f => f.id === p.folderId);
    const sched = p.schedule.type === "once"
      ? "once at " + (p.schedule.runAt || "?")
      : (p.schedule.interval || "every-day") + (p.schedule.timeOfDay ? " at " + p.schedule.timeOfDay : "");
    return {
      id: p.id,
      name: p.name,
      enabled: p.enabled,
      schedule: sched,
      folder: folder?.name || "?",
      provider: p.provider,
      lastRunAt: p.lastRunAt || null,
      lastRunStatus: p.lastRunStatus || null,
    };
  });
  return { text: list.length ? JSON.stringify(list, null, 2) : "No scheduled prompts." };
}

function toolScheduleDelete(args) {
  const { id } = args;
  if (!id) return { isError: true, text: "id is required" };
  const prompts = load();
  const filtered = prompts.filter(p => p.id !== id);
  if (filtered.length === prompts.length) return { isError: true, text: "Not found: " + id };
  save(filtered);
  return { text: "Deleted schedule: " + id };
}

function toolScheduleEnable(args) {
  const { id } = args;
  if (!id) return { isError: true, text: "id is required" };
  const prompts = load();
  const p = prompts.find(p => p.id === id);
  if (!p) return { isError: true, text: "Not found: " + id };
  p.enabled = true;
  save(prompts);
  return { text: "Enabled schedule: " + id };
}

function toolScheduleDisable(args) {
  const { id } = args;
  if (!id) return { isError: true, text: "id is required" };
  const prompts = load();
  const p = prompts.find(p => p.id === id);
  if (!p) return { isError: true, text: "Not found: " + id };
  p.enabled = false;
  save(prompts);
  return { text: "Disabled schedule: " + id };
}

function toolScheduleFolders() {
  const folders = loadFolders().map(f => ({ id: f.id, name: f.name, path: f.path }));
  return { text: folders.length ? JSON.stringify(folders, null, 2) : "No folders found." };
}

// ── tool registry ─────────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "schedule_create",
    description: "Create a new scheduled prompt that runs automatically in Stratos. Call schedule_folders first to get a valid folder name or path.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Human-readable schedule name" },
        prompt: { type: "string", description: "Prompt text to run on each execution" },
        folder: { type: "string", description: "Folder name (use schedule_folders to list). Defaults to first folder." },
        cwd: { type: "string", description: "Folder by exact path (alternative to folder)" },
        provider: { type: "string", description: "Agent provider (default: claude-code)", enum: ["claude-code", "codex", "opencode"] },
        model: { type: "string", description: "Model override (e.g. claude-opus-4-5)" },
        interval: { type: "string", description: "Recurrence interval (default: every-day)", enum: ["every-hour", "every-6-hours", "every-12-hours", "every-day", "every-week", "custom"] },
        once: { type: "string", description: "ISO datetime for a one-shot run (e.g. 2025-01-15T14:00). Mutually exclusive with interval." },
        cron: { type: "string", description: "Custom cron expression (5-field). Only used when interval=custom." },
        time: { type: "string", description: "Time of day for daily/weekly schedules in HH:mm (default: 09:00)" },
        day: { type: "number", description: "Day of week for weekly schedules (0=Sun … 6=Sat, default: 1=Mon)" },
      },
      required: ["name", "prompt"],
    },
  },
  {
    name: "schedule_list",
    description: "List all scheduled prompts in Stratos with their status and last run info.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "schedule_delete",
    description: "Permanently delete a scheduled prompt by ID.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Schedule ID (from schedule_list)" } },
      required: ["id"],
    },
  },
  {
    name: "schedule_enable",
    description: "Re-enable a previously disabled scheduled prompt.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Schedule ID (from schedule_list)" } },
      required: ["id"],
    },
  },
  {
    name: "schedule_disable",
    description: "Temporarily disable a scheduled prompt without deleting it.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Schedule ID (from schedule_list)" } },
      required: ["id"],
    },
  },
  {
    name: "schedule_folders",
    description: "List available Stratos folders (id, name, path). Use this to resolve folder names/paths before calling schedule_create.",
    inputSchema: { type: "object", properties: {} },
  },
];

// ── MCP JSON-RPC dispatch ─────────────────────────────────────────────────────

function respond(obj) {
  process.stdout.write(JSON.stringify(obj) + "\\n");
}

function handleRequest(req) {
  const { id, method, params = {} } = req;

  switch (method) {
    case "initialize":
      respond({
        jsonrpc: "2.0", id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "stratos-scheduler", version: "1.0.0" },
        },
      });
      return;

    case "notifications/initialized":
      // Notification — no response required
      return;

    case "ping":
      respond({ jsonrpc: "2.0", id, result: {} });
      return;

    case "tools/list":
      respond({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
      return;

    case "tools/call": {
      const { name, arguments: args = {} } = params;
      let result;
      try {
        switch (name) {
          case "schedule_create":  result = toolScheduleCreate(args);  break;
          case "schedule_list":    result = toolScheduleList();         break;
          case "schedule_delete":  result = toolScheduleDelete(args);   break;
          case "schedule_enable":  result = toolScheduleEnable(args);   break;
          case "schedule_disable": result = toolScheduleDisable(args);  break;
          case "schedule_folders": result = toolScheduleFolders();      break;
          default:
            respond({ jsonrpc: "2.0", id, error: { code: -32601, message: "Unknown tool: " + name } });
            return;
        }
      } catch (err) {
        respond({
          jsonrpc: "2.0", id,
          result: { content: [{ type: "text", text: "Error: " + (err.message || String(err)) }], isError: true },
        });
        return;
      }
      respond({
        jsonrpc: "2.0", id,
        result: {
          content: [{ type: "text", text: result.text }],
          ...(result.isError ? { isError: true } : {}),
        },
      });
      return;
    }

    default:
      if (id !== undefined && id !== null) {
        respond({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found: " + method } });
      }
  }
}

// ── main ──────────────────────────────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req;
  try {
    req = JSON.parse(trimmed);
  } catch {
    respond({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }
  handleRequest(req);
});

rl.on("close", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
`;
