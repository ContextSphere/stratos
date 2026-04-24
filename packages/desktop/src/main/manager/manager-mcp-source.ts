/**
 * Source for the self-contained `stratos-manager-mcp` stdio MCP server.
 * Written to ~/.stratos/bin/stratos-manager-mcp on app startup.
 * Injected into the Manager Agent session so it can manage other Stratos
 * agent sessions via first-class MCP tools.
 *
 * Read-only operations (list_sessions, get_session, get_dashboard) read
 * directly from the threads JSON file. Write operations (create_session,
 * send_message, stop_session, delete_session) send JSON-RPC requests over
 * a Unix domain socket to the main Electron process.
 *
 * Uses only Node.js built-ins — no external dependencies.
 * Protocol: newline-delimited JSON-RPC 2.0 over stdio (MCP stdio transport).
 */

export const MANAGER_MCP_SOURCE = `#!/usr/bin/env node
"use strict";

const { readFileSync, existsSync } = require("fs");
const { join } = require("path");
const { homedir } = require("os");
const net = require("net");
const readline = require("readline");

const CONFIG_DIR = join(homedir(), ".stratos");
const THREADS_PATH = join(CONFIG_DIR, "threads", "threads.json");
const SOCK_PATH = process.env.STRATOS_MANAGER_SOCK;

// ── storage helpers ───────────────────────────────────────────────────────────

function loadThreadsFile() {
  if (!existsSync(THREADS_PATH)) return { threads: [], folders: [], activeThreadId: null };
  try { return JSON.parse(readFileSync(THREADS_PATH, "utf-8")); }
  catch { return { threads: [], folders: [], activeThreadId: null }; }
}

function loadMessages(threadId) {
  const msgPath = join(CONFIG_DIR, "threads", "messages", threadId + ".json");
  if (!existsSync(msgPath)) return [];
  try { return JSON.parse(readFileSync(msgPath, "utf-8")); }
  catch { return []; }
}

// ── UDS bridge ────────────────────────────────────────────────────────────────

let rpcIdCounter = 1;
const pendingRpc = new Map(); // id -> { resolve, reject }

let sockConn = null;
let sockBuffer = "";

function connectSock() {
  return new Promise((resolve, reject) => {
    if (!SOCK_PATH) { reject(new Error("STRATOS_MANAGER_SOCK not set")); return; }
    const conn = net.createConnection({ path: SOCK_PATH }, () => {
      sockConn = conn;
      resolve();
    });
    conn.on("error", reject);
    conn.on("data", (chunk) => {
      sockBuffer += chunk.toString();
      let nl;
      while ((nl = sockBuffer.indexOf("\\n")) !== -1) {
        const line = sockBuffer.slice(0, nl);
        sockBuffer = sockBuffer.slice(nl + 1);
        try {
          const msg = JSON.parse(line);
          const pending = pendingRpc.get(msg.id);
          if (pending) {
            pendingRpc.delete(msg.id);
            if (msg.error) pending.reject(new Error(msg.error.message || "RPC error"));
            else pending.resolve(msg.result);
          }
        } catch {}
      }
    });
    conn.on("close", () => { sockConn = null; });
  });
}

function rpcCall(method, params) {
  return new Promise(async (resolve, reject) => {
    if (!sockConn) {
      try { await connectSock(); }
      catch (e) { reject(e); return; }
    }
    const id = rpcIdCounter++;
    pendingRpc.set(id, { resolve, reject });
    sockConn.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\\n");
    // Timeout after 30s
    setTimeout(() => {
      if (pendingRpc.has(id)) {
        pendingRpc.delete(id);
        reject(new Error("RPC timeout"));
      }
    }, 30000);
  });
}

// ── tool implementations ──────────────────────────────────────────────────────

function deriveSummary(thread, messages) {
  const lastResult = [...messages].reverse().find(m => m.role === "assistant" && m.content);
  if (lastResult) return lastResult.content.slice(0, 200);
  const firstUser = messages.find(m => m.role === "user" && m.content);
  if (firstUser) return "Working on: " + firstUser.content.slice(0, 150);
  return thread.title;
}

async function toolCreateSession(args) {
  const { workspace, prompt, provider, model, mode, title, worktreeMode, images } = args;
  if (!workspace) return { isError: true, text: "workspace (path) is required" };
  if (!prompt) return { isError: true, text: "prompt is required" };
  try {
    const result = await rpcCall("create_session", { workspace, prompt, provider, model, mode, title, worktreeMode, images });
    return { text: JSON.stringify(result, null, 2) };
  } catch (e) {
    return { isError: true, text: "Error: " + e.message };
  }
}

async function toolSendMessage(args) {
  const { threadId, prompt, images } = args;
  if (!threadId) return { isError: true, text: "threadId is required" };
  if (!prompt) return { isError: true, text: "prompt is required" };
  try {
    const result = await rpcCall("send_message", { threadId, prompt, images });
    return { text: JSON.stringify(result, null, 2) };
  } catch (e) {
    return { isError: true, text: "Error: " + e.message };
  }
}

async function toolStopSession(args) {
  const { threadId } = args;
  if (!threadId) return { isError: true, text: "threadId is required" };
  try {
    const result = await rpcCall("stop_session", { threadId });
    return { text: JSON.stringify(result, null, 2) };
  } catch (e) {
    return { isError: true, text: "Error: " + e.message };
  }
}

async function toolDeleteSession(args) {
  const { threadId } = args;
  if (!threadId) return { isError: true, text: "threadId is required" };
  try {
    const result = await rpcCall("delete_session", { threadId });
    return { text: JSON.stringify(result, null, 2) };
  } catch (e) {
    return { isError: true, text: "Error: " + e.message };
  }
}

function toolListSessions(args) {
  const { filter, limit = 20, cursor, sortBy = "lastActivity" } = args || {};
  const data = loadThreadsFile();
  let threads = (data.threads || []).filter(t => !t.isManagerThread);

  // Apply filters
  if (filter) {
    if (filter.workspace) threads = threads.filter(t => t.cwd === filter.workspace);
    if (filter.provider) threads = threads.filter(t => (t.provider || "claude-code") === filter.provider);
    // Note: status filtering requires running thread info from main process
    // We'll skip it for now as it requires UDS call
  }

  // Sort
  if (sortBy === "createdAt") threads.sort((a, b) => b.createdAt - a.createdAt);
  else if (sortBy === "title") threads.sort((a, b) => a.title.localeCompare(b.title));
  else threads.sort((a, b) => b.updatedAt - a.updatedAt); // lastActivity

  const totalCount = threads.length;

  // Apply cursor (decode: "idx:N")
  let startIdx = 0;
  if (cursor) {
    const match = cursor.match(/^idx:(\\d+)$/);
    if (match) startIdx = parseInt(match[1], 10);
  }

  const pageSize = Math.min(Math.max(limit, 1), 50);
  const page = threads.slice(startIdx, startIdx + pageSize);
  const hasMore = startIdx + pageSize < totalCount;
  const nextCursor = hasMore ? "idx:" + (startIdx + pageSize) : undefined;

  const sessions = page.map(t => {
    const messages = loadMessages(t.id);
    return {
      threadId: t.id,
      title: t.title,
      summary: deriveSummary(t, messages),
      workspace: t.cwd || "",
      provider: t.provider || "claude-code",
      model: t.model || undefined,
      status: "idle", // Accurate status requires main process info
      lastActivity: new Date(t.updatedAt).toISOString(),
      messageCount: messages.length,
    };
  });

  return { text: JSON.stringify({ sessions, totalCount, nextCursor, hasMore }, null, 2) };
}

async function toolGetSession(args) {
  const { threadId, includeTranscript, transcriptLimit = 20 } = args || {};
  if (!threadId) return { isError: true, text: "threadId is required" };

  const data = loadThreadsFile();
  const thread = (data.threads || []).find(t => t.id === threadId);
  if (!thread) return { isError: true, text: "Thread not found: " + threadId };

  let messages = [];
  if (includeTranscript) {
    // Route through main process so claude-code SDK transcripts work
    // (the JSONL lives under ~/.claude/projects/ and is not accessible
    // from this subprocess).
    try {
      const rpcRes = await rpcCall("get_messages", { threadId, limit: transcriptLimit });
      messages = (rpcRes && rpcRes.messages) || [];
    } catch (e) {
      // Fall back to disk (works for codex/opencode, empty for claude-code)
      messages = loadMessages(threadId).slice(-transcriptLimit);
    }
  }

  const summary = deriveSummary(thread, messages);

  const result = {
    thread,
    summary,
    status: "idle",
    ...(includeTranscript ? { recentMessages: messages } : {}),
    tools: thread.sessionTools || [],
  };

  return { text: JSON.stringify(result, null, 2) };
}

function toolGetDashboard() {
  const data = loadThreadsFile();
  const threads = (data.threads || []).filter(t => !t.isManagerThread);
  const folders = data.folders || [];

  const byProvider = {};
  for (const t of threads) {
    const p = t.provider || "claude-code";
    byProvider[p] = (byProvider[p] || 0) + 1;
  }

  return {
    text: JSON.stringify({
      totalSessions: threads.length,
      running: 0, // Would need main process info
      idle: threads.length,
      errored: 0,
      workspaces: folders.length,
      byProvider,
    }, null, 2),
  };
}

function toolListWorkspaces() {
  const data = loadThreadsFile();
  const folders = data.folders || [];
  const threads = (data.threads || []).filter(t => !t.isManagerThread);
  const workspaces = folders.map(f => ({
    folderId: f.id,
    name: f.name,
    path: f.path,
    sessionCount: threads.filter(t => t.cwd === f.path).length,
  }));
  return { text: JSON.stringify({ workspaces }, null, 2) };
}

async function toolCreateWorkspace(args) {
  const { path, name } = args;
  if (!path) return { isError: true, text: "path is required" };
  try {
    const result = await rpcCall("create_workspace", { path, name });
    return { text: JSON.stringify(result, null, 2) };
  } catch (e) {
    return { isError: true, text: "Error: " + e.message };
  }
}

async function toolRemoveWorkspace(args) {
  const { folderId } = args;
  if (!folderId) return { isError: true, text: "folderId is required" };
  try {
    const result = await rpcCall("remove_workspace", { folderId });
    return { text: JSON.stringify(result, null, 2) };
  } catch (e) {
    return { isError: true, text: "Error: " + e.message };
  }
}

function toolSearchSessions(args) {
  const { query, workspace, limit = 10, cursor } = args || {};
  if (!query) return { isError: true, text: "query is required" };

  const data = loadThreadsFile();
  let threads = (data.threads || []).filter(t => !t.isManagerThread);
  if (workspace) threads = threads.filter(t => t.cwd === workspace);

  const lowerQuery = query.toLowerCase();
  const results = [];
  for (const t of threads) {
    const messages = loadMessages(t.id);
    const titleMatch = t.title.toLowerCase().includes(lowerQuery);
    let matchContext = "";
    let score = 0;
    if (titleMatch) { matchContext = t.title; score = 2; }
    for (const m of messages) {
      if (m.content && m.content.toLowerCase().includes(lowerQuery)) {
        const idx = m.content.toLowerCase().indexOf(lowerQuery);
        matchContext = m.content.slice(Math.max(0, idx - 50), idx + query.length + 50);
        score = Math.max(score, 1);
        break;
      }
    }
    if (score > 0) {
      results.push({
        threadId: t.id,
        title: t.title,
        summary: deriveSummary(t, messages),
        matchContext,
        relevanceScore: score,
      });
    }
  }

  results.sort((a, b) => b.relevanceScore - a.relevanceScore);

  const totalCount = results.length;
  let startIdx = 0;
  if (cursor) {
    const match = cursor.match(/^idx:(\\d+)$/);
    if (match) startIdx = parseInt(match[1], 10);
  }
  const pageSize = Math.min(Math.max(limit, 1), 30);
  const page = results.slice(startIdx, startIdx + pageSize);
  const hasMore = startIdx + pageSize < totalCount;
  const nextCursor = hasMore ? "idx:" + (startIdx + pageSize) : undefined;

  return { text: JSON.stringify({ results: page, totalCount, nextCursor, hasMore }, null, 2) };
}

// ── tool registry ─────────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "create_session",
    description: "Start a new agent session in a workspace. Returns the thread ID immediately (non-blocking). Use get_session later to check status.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string", description: "Absolute path to the working directory" },
        prompt: { type: "string", description: "Initial prompt to send to the agent" },
        provider: { type: "string", description: "Agent provider (default: claude-code)", enum: ["claude-code", "codex", "opencode"] },
        model: { type: "string", description: "Model override (e.g. claude-sonnet-4-5-20250514)" },
        mode: { type: "string", description: "Permission mode", enum: ["plan", "default", "acceptEdits", "bypassPermissions"] },
        title: { type: "string", description: "Thread title (auto-generated if omitted)" },
        worktreeMode: { type: "string", description: "Git worktree isolation", enum: ["local", "worktree"] },
        images: {
          type: "array",
          description: "Image attachments to forward to the spawned agent session",
          items: {
            type: "object",
            properties: {
              dataUrl: { type: "string", description: "Base64 data URL (data:<mimeType>;base64,...)" },
              mimeType: { type: "string", description: "MIME type (e.g. image/png, image/jpeg)" },
            },
            required: ["dataUrl", "mimeType"],
          },
        },
      },
      required: ["workspace", "prompt"],
    },
  },
  {
    name: "send_message",
    description: "Send a follow-up message to an existing agent session (non-blocking). Returns immediately. Use get_session to check what happened.",
    inputSchema: {
      type: "object",
      properties: {
        threadId: { type: "string", description: "Thread ID of the target session" },
        prompt: { type: "string", description: "Message to send to the agent" },
        images: {
          type: "array",
          description: "Image attachments to forward to the agent session",
          items: {
            type: "object",
            properties: {
              dataUrl: { type: "string", description: "Base64 data URL (data:<mimeType>;base64,...)" },
              mimeType: { type: "string", description: "MIME type (e.g. image/png, image/jpeg)" },
            },
            required: ["dataUrl", "mimeType"],
          },
        },
      },
      required: ["threadId", "prompt"],
    },
  },
  {
    name: "stop_session",
    description: "Gracefully stop a running agent session.",
    inputSchema: {
      type: "object",
      properties: { threadId: { type: "string", description: "Thread ID to stop" } },
      required: ["threadId"],
    },
  },
  {
    name: "delete_session",
    description: "Delete an agent session and its data. Cannot be undone.",
    inputSchema: {
      type: "object",
      properties: { threadId: { type: "string", description: "Thread ID to delete" } },
      required: ["threadId"],
    },
  },
  {
    name: "list_sessions",
    description: "List all agent sessions with status and summary. Paginated — use cursor for next page.",
    inputSchema: {
      type: "object",
      properties: {
        filter: {
          type: "object",
          properties: {
            workspace: { type: "string", description: "Filter by working directory path" },
            provider: { type: "string", description: "Filter by provider", enum: ["claude-code", "codex", "opencode"] },
          },
        },
        limit: { type: "number", description: "Max results per page (default: 20, max: 50)" },
        cursor: { type: "string", description: "Cursor from previous response for pagination" },
        sortBy: { type: "string", description: "Sort order", enum: ["lastActivity", "createdAt", "title"] },
      },
    },
  },
  {
    name: "get_session",
    description: "Get detailed status of a specific session, including summary and optionally recent messages.",
    inputSchema: {
      type: "object",
      properties: {
        threadId: { type: "string", description: "Thread ID to inspect" },
        includeTranscript: { type: "boolean", description: "Include recent messages (default: false)" },
        transcriptLimit: { type: "number", description: "Max messages to include (default: 20)" },
      },
      required: ["threadId"],
    },
  },
  {
    name: "search_sessions",
    description: "Search sessions by content or title. Returns paginated results with match context.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (matches against titles and message content)" },
        workspace: { type: "string", description: "Scope search to this workspace path" },
        limit: { type: "number", description: "Max results per page (default: 10, max: 30)" },
        cursor: { type: "string", description: "Cursor from previous response" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_dashboard",
    description: "Get an overview of all sessions — total counts, status breakdown, and per-provider stats.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_workspaces",
    description: "List all registered workspaces (folders) with session counts.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "create_workspace",
    description: "Register a new workspace (folder) in Stratos. Does not create the directory — it must already exist.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path to the directory" },
        name: { type: "string", description: "Display name (defaults to directory basename)" },
      },
      required: ["path"],
    },
  },
  {
    name: "remove_workspace",
    description: "Unregister a workspace from Stratos. Does not delete the directory or its sessions.",
    inputSchema: {
      type: "object",
      properties: { folderId: { type: "string", description: "Folder ID (from list_workspaces)" } },
      required: ["folderId"],
    },
  },
];

// ── MCP JSON-RPC dispatch ─────────────────────────────────────────────────────

function respond(obj) {
  process.stdout.write(JSON.stringify(obj) + "\\n");
}

async function handleRequest(req) {
  const { id, method, params = {} } = req;

  switch (method) {
    case "initialize":
      respond({
        jsonrpc: "2.0", id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "stratos-manager", version: "1.0.0" },
        },
      });
      return;

    case "notifications/initialized":
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
          case "create_session":    result = await toolCreateSession(args);  break;
          case "send_message":      result = await toolSendMessage(args);    break;
          case "stop_session":      result = await toolStopSession(args);    break;
          case "delete_session":    result = await toolDeleteSession(args);  break;
          case "list_sessions":     result = toolListSessions(args);         break;
          case "get_session":       result = await toolGetSession(args);     break;
          case "search_sessions":   result = toolSearchSessions(args);       break;
          case "get_dashboard":     result = toolGetDashboard();             break;
          case "list_workspaces":   result = toolListWorkspaces();           break;
          case "create_workspace":  result = await toolCreateWorkspace(args);break;
          case "remove_workspace":  result = await toolRemoveWorkspace(args);break;
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
