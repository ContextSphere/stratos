/**
 * Source for the self-contained `stratos-preview-mcp` stdio MCP server.
 * Written to ~/.stratos/bin/stratos-preview-mcp on app startup.
 * Injected into every agent session so agents can open/close the side preview pane.
 *
 * Uses only Node.js built-ins — no external dependencies.
 * Protocol: newline-delimited JSON-RPC 2.0 over stdio (MCP stdio transport).
 * Communicates with the Electron main process via a Unix domain socket at
 * the path given by STRATOS_PREVIEW_SOCKET env var.
 */

export const PREVIEW_MCP_SOURCE = `#!/usr/bin/env node
"use strict";

const net = require("net");
const readline = require("readline");

const SOCKET_PATH = process.env.STRATOS_PREVIEW_SOCKET;

// ── socket helpers ────────────────────────────────────────────────────────────

function sendCommand(command) {
  return new Promise((resolve, reject) => {
    if (!SOCKET_PATH) {
      reject(new Error("STRATOS_PREVIEW_SOCKET not configured"));
      return;
    }
    const client = net.createConnection(SOCKET_PATH, () => {
      client.write(JSON.stringify(command) + "\\n");
    });
    let buf = "";
    client.on("data", (chunk) => {
      buf += chunk.toString();
      const nl = buf.indexOf("\\n");
      if (nl === -1) return;
      client.destroy();
      try { resolve(JSON.parse(buf.slice(0, nl))); }
      catch { resolve({ ok: true }); }
    });
    client.on("error", reject);
    client.setTimeout(5000, () => {
      client.destroy();
      reject(new Error("Preview socket timeout — is Stratos running?"));
    });
  });
}

// ── tool implementations ──────────────────────────────────────────────────────

async function toolPreviewOpenFile(args) {
  const { file_path, title } = args;
  if (!file_path) return { isError: true, text: "file_path is required" };
  try {
    const result = await sendCommand({ command: "open", path: file_path, title });
    if (!result.ok) return { isError: true, text: result.error || "Failed to open preview" };
    return { text: "Preview opened: " + file_path };
  } catch (err) {
    return { isError: true, text: "Preview error: " + (err.message || String(err)) };
  }
}

async function toolPreviewClose() {
  try {
    await sendCommand({ command: "close" });
    return { text: "Preview closed" };
  } catch (err) {
    return { isError: true, text: "Preview error: " + (err.message || String(err)) };
  }
}

// ── tool registry ─────────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "preview_open_file",
    description: "Open a file in the Stratos side preview pane. Markdown files (.md, .markdown) are rendered as formatted text; all other files open in a code editor. Always use absolute file paths.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Absolute path to the file to preview" },
        title: { type: "string", description: "Optional display title (defaults to the filename)" },
      },
      required: ["file_path"],
    },
  },
  {
    name: "preview_close",
    description: "Close the Stratos side preview pane.",
    inputSchema: { type: "object", properties: {} },
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
          serverInfo: { name: "stratos-preview", version: "1.0.0" },
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
          case "preview_open_file": result = await toolPreviewOpenFile(args); break;
          case "preview_close":     result = await toolPreviewClose();        break;
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
  handleRequest(req).catch((err) => {
    respond({ jsonrpc: "2.0", id: req?.id ?? null, error: { code: -32603, message: err.message || String(err) } });
  });
});

rl.on("close", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
`;
