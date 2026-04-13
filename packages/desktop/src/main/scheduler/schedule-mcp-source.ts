/**
 * Self-contained MCP server source for schedule management.
 *
 * Written to ~/.stratos/bin/schedule-mcp-server.js at startup and spawned
 * by the SDK as a stdio MCP server. Exposes schedule CRUD and folder listing
 * as native MCP tools — no CLI or system-prompt documentation needed.
 */
export const SCHEDULE_MCP_SOURCE = `#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const readline = require("readline");

// ── Paths ──────────────────────────────────────────────────────────────────
const STRATOS_DIR = path.join(os.homedir(), ".stratos");
const PROMPTS_PATH = path.join(STRATOS_DIR, "scheduled-prompts.json");
const THREADS_PATH = path.join(STRATOS_DIR, "threads", "threads.json");

// ── Storage helpers ────────────────────────────────────────────────────────
function loadPrompts() {
  if (!fs.existsSync(PROMPTS_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(PROMPTS_PATH, "utf-8")); }
  catch { return []; }
}

function savePrompts(prompts) {
  if (!fs.existsSync(STRATOS_DIR)) fs.mkdirSync(STRATOS_DIR, { recursive: true });
  fs.writeFileSync(PROMPTS_PATH, JSON.stringify(prompts, null, 2), "utf-8");
}

function loadFolders() {
  if (!fs.existsSync(THREADS_PATH)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(THREADS_PATH, "utf-8"));
    return (data.folders || []).map(f => ({ id: f.id, name: f.name, path: f.path }));
  } catch { return []; }
}

function genId() {
  return "sched_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
}

// ── Tool definitions ───────────────────────────────────────────────────────
const TOOLS = [
  {
    name: "schedule_create",
    description: "Create a new scheduled prompt in Stratos. The prompt will run automatically on the specified schedule.",
    inputSchema: {
      type: "object",
      properties: {
        name:       { type: "string", description: "Human-readable name for this schedule" },
        prompt:     { type: "string", description: "The prompt text to execute" },
        provider:   { type: "string", enum: ["claude-code", "codex", "opencode"], description: "AI provider (default: claude-code)" },
        model:      { type: "string", description: "Optional model override" },
        folder_id:  { type: "string", description: "Folder ID to run in (use list_folders to find IDs)" },
        schedule_type: { type: "string", enum: ["once", "recurring"], description: "One-time or recurring" },
        interval:   { type: "string", enum: ["every-hour", "every-6-hours", "every-12-hours", "every-day", "every-week", "custom"], description: "Recurring interval (required if schedule_type is recurring)" },
        run_at:     { type: "string", description: "ISO datetime for one-time schedules (e.g. 2026-04-13T09:00)" },
        cron:       { type: "string", description: "Custom cron expression (when interval is custom)" },
        time_of_day: { type: "string", description: "HH:mm time for daily/weekly schedules (default: 09:00)" },
        day_of_week: { type: "number", description: "0-6 (Sun-Sat) for weekly schedules (default: 1 = Monday)" },
      },
      required: ["name", "prompt", "folder_id", "schedule_type"],
    },
  },
  {
    name: "schedule_list",
    description: "List all scheduled prompts in Stratos with their status, schedule, and last run info.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "schedule_delete",
    description: "Delete a scheduled prompt by ID.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Schedule ID to delete" } },
      required: ["id"],
    },
  },
  {
    name: "schedule_enable",
    description: "Enable a disabled scheduled prompt.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Schedule ID to enable" } },
      required: ["id"],
    },
  },
  {
    name: "schedule_disable",
    description: "Disable a scheduled prompt (stops it from running).",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Schedule ID to disable" } },
      required: ["id"],
    },
  },
  {
    name: "list_folders",
    description: "List available Stratos folders. Use the returned folder IDs when creating schedules.",
    inputSchema: { type: "object", properties: {} },
  },
];

// ── Tool handlers ──────────────────────────────────────────────────────────
function handleToolCall(name, args) {
  switch (name) {
    case "schedule_create": {
      const schedule = { type: args.schedule_type };
      if (args.schedule_type === "once") {
        if (!args.run_at) return { isError: true, content: [{ type: "text", text: "run_at is required for one-time schedules" }] };
        schedule.runAt = args.run_at;
      } else {
        if (!args.interval) return { isError: true, content: [{ type: "text", text: "interval is required for recurring schedules" }] };
        schedule.interval = args.interval;
        if (args.interval === "custom") {
          if (!args.cron) return { isError: true, content: [{ type: "text", text: "cron is required when interval is custom" }] };
          schedule.customCron = args.cron;
        }
        if (args.time_of_day) schedule.timeOfDay = args.time_of_day;
        if (args.day_of_week !== undefined) schedule.dayOfWeek = args.day_of_week;
      }

      const prompts = loadPrompts();
      const entry = {
        id: genId(),
        name: args.name,
        prompt: args.prompt,
        provider: args.provider || "claude-code",
        ...(args.model ? { model: args.model } : {}),
        folderId: args.folder_id,
        schedule,
        enabled: true,
        createdAt: Date.now(),
      };
      prompts.push(entry);
      savePrompts(prompts);
      return { content: [{ type: "text", text: "Created schedule: " + entry.id + " (" + entry.name + ")" }] };
    }

    case "schedule_list": {
      const prompts = loadPrompts();
      if (prompts.length === 0) return { content: [{ type: "text", text: "No scheduled prompts." }] };
      const lines = prompts.map(p => {
        const status = p.enabled ? "enabled" : "disabled";
        const sched = p.schedule.type === "once"
          ? "once at " + (p.schedule.runAt || "?")
          : (p.schedule.interval || "custom") + (p.schedule.timeOfDay ? " at " + p.schedule.timeOfDay : "");
        const lastRun = p.lastRunAt ? new Date(p.lastRunAt).toLocaleString() + " (" + (p.lastRunStatus || "?") + ")" : "never";
        return p.id + " | " + p.name + " | " + status + " | " + sched + " | last: " + lastRun;
      });
      return { content: [{ type: "text", text: lines.join("\\n") }] };
    }

    case "schedule_delete": {
      const prompts = loadPrompts();
      const filtered = prompts.filter(p => p.id !== args.id);
      if (filtered.length === prompts.length) return { isError: true, content: [{ type: "text", text: "Schedule not found: " + args.id }] };
      savePrompts(filtered);
      return { content: [{ type: "text", text: "Deleted schedule: " + args.id }] };
    }

    case "schedule_enable": {
      const prompts = loadPrompts();
      const p = prompts.find(p => p.id === args.id);
      if (!p) return { isError: true, content: [{ type: "text", text: "Schedule not found: " + args.id }] };
      p.enabled = true;
      savePrompts(prompts);
      return { content: [{ type: "text", text: "Enabled schedule: " + args.id }] };
    }

    case "schedule_disable": {
      const prompts = loadPrompts();
      const p = prompts.find(p => p.id === args.id);
      if (!p) return { isError: true, content: [{ type: "text", text: "Schedule not found: " + args.id }] };
      p.enabled = false;
      savePrompts(prompts);
      return { content: [{ type: "text", text: "Disabled schedule: " + args.id }] };
    }

    case "list_folders": {
      const folders = loadFolders();
      if (folders.length === 0) return { content: [{ type: "text", text: "No folders configured." }] };
      const lines = folders.map(f => f.id + " | " + f.name + " | " + f.path);
      return { content: [{ type: "text", text: lines.join("\\n") }] };
    }

    default:
      return { isError: true, content: [{ type: "text", text: "Unknown tool: " + name }] };
  }
}

// ── MCP JSON-RPC stdio transport ───────────────────────────────────────────
function send(msg) {
  const json = JSON.stringify(msg);
  process.stdout.write("Content-Length: " + Buffer.byteLength(json) + "\\r\\n\\r\\n" + json);
}

function handleMessage(msg) {
  const { id, method, params } = msg;

  switch (method) {
    case "initialize":
      send({
        jsonrpc: "2.0", id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "stratos-schedule", version: "1.0.0" },
        },
      });
      break;

    case "notifications/initialized":
      // No response needed for notifications
      break;

    case "tools/list":
      send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
      break;

    case "tools/call":
      try {
        const result = handleToolCall(params.name, params.arguments || {});
        send({ jsonrpc: "2.0", id, result });
      } catch (err) {
        send({ jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: "Error: " + err.message }] } });
      }
      break;

    case "ping":
      send({ jsonrpc: "2.0", id, result: {} });
      break;

    default:
      if (id !== undefined) {
        send({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found: " + method } });
      }
      break;
  }
}

// ── Message framing (Content-Length headers) ────────────────────────────────
let buffer = "";

process.stdin.setEncoding("utf-8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;

  while (true) {
    const headerEnd = buffer.indexOf("\\r\\n\\r\\n");
    if (headerEnd === -1) break;

    const header = buffer.slice(0, headerEnd);
    const match = header.match(/Content-Length:\\s*(\\d+)/i);
    if (!match) {
      buffer = buffer.slice(headerEnd + 4);
      continue;
    }

    const contentLength = parseInt(match[1], 10);
    const bodyStart = headerEnd + 4;
    if (buffer.length < bodyStart + contentLength) break;

    const body = buffer.slice(bodyStart, bodyStart + contentLength);
    buffer = buffer.slice(bodyStart + contentLength);

    try {
      handleMessage(JSON.parse(body));
    } catch (err) {
      process.stderr.write("[stratos-schedule-mcp] Parse error: " + err.message + "\\n");
    }
  }
});

process.stdin.on("end", () => process.exit(0));
`;
