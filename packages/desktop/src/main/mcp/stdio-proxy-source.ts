/**
 * Source for the self-contained `stratos-mcp` stdio-to-UDS proxy.
 * Written to ~/.stratos/bin/stratos-mcp on app startup.
 *
 * The proxy is schema-free, logic-free, and stateless. It reads newline-
 * delimited MCP JSON-RPC from stdin, forwards each frame verbatim to the
 * Stratos main process over a Unix domain socket (path from
 * STRATOS_MCP_SOCK env var), and writes responses back to stdout.
 *
 * Retries the initial connect for up to 3s in case the CLI spawns it a
 * fraction of a second before AgentManager finishes starting the socket
 * server.
 */
export const STDIO_PROXY_SOURCE = `#!/usr/bin/env node
"use strict";

const net = require("net");
const readline = require("readline");

const SOCK = process.env.STRATOS_MCP_SOCK;
if (!SOCK) {
  process.stderr.write("[stratos-mcp] STRATOS_MCP_SOCK not set\\n");
  process.exit(2);
}

function connectWithRetry(path, deadlineMs) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const attempt = () => {
      const conn = net.createConnection({ path });
      conn.once("connect", () => resolve(conn));
      conn.once("error", (err) => {
        if (Date.now() - start >= deadlineMs) { reject(err); return; }
        setTimeout(attempt, 50);
      });
    };
    attempt();
  });
}

(async () => {
  let conn;
  try {
    conn = await connectWithRetry(SOCK, 3000);
  } catch (err) {
    process.stderr.write("[stratos-mcp] cannot connect to " + SOCK + ": " + err.message + "\\n");
    process.exit(3);
  }

  // stdin -> socket
  const stdinRL = readline.createInterface({ input: process.stdin, terminal: false });
  stdinRL.on("line", (line) => {
    if (!line.trim()) return;
    try { conn.write(line + "\\n"); } catch (err) {
      process.stderr.write("[stratos-mcp] write failed: " + err.message + "\\n");
    }
  });
  stdinRL.on("close", () => {
    try { conn.end(); } catch {}
    process.exit(0);
  });

  // socket -> stdout
  const sockRL = readline.createInterface({ input: conn, terminal: false });
  sockRL.on("line", (line) => {
    if (!line.trim()) return;
    try { process.stdout.write(line + "\\n"); } catch {}
  });
  conn.on("close", () => {
    process.exit(0);
  });
  conn.on("error", (err) => {
    process.stderr.write("[stratos-mcp] socket error: " + err.message + "\\n");
    process.exit(4);
  });
})().catch((err) => {
  process.stderr.write("[stratos-mcp] fatal: " + (err && err.message || err) + "\\n");
  process.exit(1);
});
`;
