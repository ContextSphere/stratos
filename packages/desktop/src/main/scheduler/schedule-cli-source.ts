/**
 * Source for the self-contained `stratos-schedule` CLI script.
 * This is written to ~/.stratos/bin/stratos-schedule on app startup.
 * Agents can invoke it via Bash to manage scheduled prompts.
 *
 * The script reads/writes ~/.stratos/scheduled-prompts.json and
 * ~/.stratos/threads/threads.json (for folder resolution) directly.
 */

export const SCHEDULE_CLI_SOURCE = `#!/usr/bin/env node
"use strict";

const { readFileSync, writeFileSync, existsSync, mkdirSync } = require("fs");
const { join } = require("path");
const { homedir } = require("os");

const CONFIG_DIR = join(homedir(), ".stratos");
const STORE_PATH = join(CONFIG_DIR, "scheduled-prompts.json");
const THREADS_PATH = join(CONFIG_DIR, "threads", "threads.json");

// ── helpers ──────────────────────────────────────────────

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

// ── schedule config builders ─────────────────────────────

function buildSchedule(args) {
  if (args["--once"]) {
    return { type: "once", runAt: args["--once"] };
  }
  const interval = args["--every-hour"] ? "every-hour"
    : args["--every-6-hours"] ? "every-6-hours"
    : args["--every-12-hours"] ? "every-12-hours"
    : args["--every-day"] ? "every-day"
    : args["--every-week"] ? "every-week"
    : args["--cron"] ? "custom"
    : "every-day";

  const config = { type: "recurring", interval };
  if (interval === "custom") config.customCron = args["--cron"];
  if (args["--time"]) config.timeOfDay = args["--time"];
  if (args["--day"] !== undefined) config.dayOfWeek = parseInt(args["--day"], 10);
  return config;
}

// ── commands ─────────────────────────────────────────────

function cmdCreate(args) {
  const name = args["--name"];
  const prompt = args["--prompt"];
  const provider = args["--provider"] || "claude-code";
  const model = args["--model"] || undefined;
  const cwd = args["--cwd"];
  const folderName = args["--folder"];

  if (!name) { console.error("Error: --name is required"); process.exit(1); }
  if (!prompt) { console.error("Error: --prompt is required"); process.exit(1); }

  // Resolve folder
  let folderId;
  const folders = loadFolders();
  if (cwd) {
    const f = folders.find(f => f.path === cwd);
    if (f) folderId = f.id;
    else { console.error("Error: no folder found with path " + cwd); process.exit(1); }
  } else if (folderName) {
    const f = folders.find(f => f.name === folderName || f.name.endsWith(folderName));
    if (f) folderId = f.id;
    else { console.error("Error: no folder found named " + folderName); process.exit(1); }
  } else {
    if (folders.length === 0) { console.error("Error: no folders. Provide --cwd or --folder"); process.exit(1); }
    folderId = folders[0].id;
  }

  const schedule = buildSchedule(args);
  const prompts = load();
  const entry = {
    id: genId(), name, prompt, provider, folderId, schedule,
    enabled: true, createdAt: Date.now(),
    ...(model ? { model } : {}),
  };
  prompts.push(entry);
  save(prompts);
  console.log(JSON.stringify(entry, null, 2));
}

function cmdList() {
  const prompts = load();
  if (prompts.length === 0) { console.log("No scheduled prompts."); return; }
  const folders = loadFolders();
  for (const p of prompts) {
    const folder = folders.find(f => f.id === p.folderId);
    const status = p.enabled ? "enabled" : "disabled";
    const sched = p.schedule.type === "once"
      ? "once at " + (p.schedule.runAt || "?")
      : p.schedule.interval + (p.schedule.timeOfDay ? " at " + p.schedule.timeOfDay : "");
    console.log(p.id + "  " + status.padEnd(9) + " " + sched.padEnd(25) + " " + (folder?.name || "?").padEnd(15) + " " + p.name);
  }
}

function cmdDelete(args) {
  const id = args._positional[0];
  if (!id) { console.error("Error: provide schedule ID"); process.exit(1); }
  const prompts = load();
  const filtered = prompts.filter(p => p.id !== id);
  if (filtered.length === prompts.length) { console.error("Not found: " + id); process.exit(1); }
  save(filtered);
  console.log("Deleted " + id);
}

function cmdEnable(args) {
  const id = args._positional[0];
  if (!id) { console.error("Error: provide schedule ID"); process.exit(1); }
  const prompts = load();
  const p = prompts.find(p => p.id === id);
  if (!p) { console.error("Not found: " + id); process.exit(1); }
  p.enabled = true;
  save(prompts);
  console.log("Enabled " + id);
}

function cmdDisable(args) {
  const id = args._positional[0];
  if (!id) { console.error("Error: provide schedule ID"); process.exit(1); }
  const prompts = load();
  const p = prompts.find(p => p.id === id);
  if (!p) { console.error("Not found: " + id); process.exit(1); }
  p.enabled = false;
  save(prompts);
  console.log("Disabled " + id);
}

function cmdFolders() {
  const folders = loadFolders();
  if (folders.length === 0) { console.log("No folders."); return; }
  for (const f of folders) {
    console.log(f.id + "  " + f.path + "  " + f.name);
  }
}

// ── arg parser ───────────────────────────────────────────

function parseArgs(argv) {
  const args = { _positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      if (a.includes("=")) {
        const [k, ...v] = a.split("=");
        args[k] = v.join("=");
      } else if (["--every-hour","--every-6-hours","--every-12-hours","--every-day","--every-week"].includes(a)) {
        args[a] = true;
      } else if (i + 1 < argv.length && !argv[i+1].startsWith("--")) {
        args[a] = argv[++i];
      } else {
        args[a] = true;
      }
    } else {
      args._positional.push(a);
    }
  }
  return args;
}

// ── main ─────────────────────────────────────────────────

const USAGE = \`Usage: stratos-schedule <command> [options]

Commands:
  create    Create a new scheduled prompt
  list      List all scheduled prompts
  delete    Delete a scheduled prompt by ID
  enable    Enable a scheduled prompt by ID
  disable   Disable a scheduled prompt by ID
  folders   List available folders

Create options:
  --name <name>           Schedule name (required)
  --prompt <text>         Prompt text (required)
  --folder <name>         Folder name (default: first folder)
  --cwd <path>            Folder by path (alternative to --folder)
  --provider <provider>   Provider: claude-code, codex, opencode (default: claude-code)
  --model <model>         Model override

Schedule (pick one):
  --every-hour            Run every hour
  --every-6-hours         Run every 6 hours
  --every-12-hours        Run every 12 hours
  --every-day             Run every day (default)
  --every-week            Run every week
  --once <datetime>       Run once at YYYY-MM-DDTHH:mm (local time)
  --cron <expr>           Custom cron expression

Schedule modifiers:
  --time <HH:mm>          Time of day for --every-day/--every-week (default: 09:00)
  --day <0-6>             Day of week for --every-week (0=Sun, 1=Mon, default: 1)
\`;

const command = process.argv[2];
const args = parseArgs(process.argv.slice(3));

switch (command) {
  case "create": cmdCreate(args); break;
  case "list": cmdList(); break;
  case "delete": cmdDelete(args); break;
  case "enable": cmdEnable(args); break;
  case "disable": cmdDisable(args); break;
  case "folders": cmdFolders(); break;
  default:
    console.log(USAGE);
    if (command && command !== "help" && command !== "--help") process.exit(1);
}
`;
