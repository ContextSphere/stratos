/**
 * Spawns the stratos-mcp stdio proxy as a real subprocess against a real
 * socket MCP server and asserts MCP JSON-RPC round-trips correctly.
 * This is the integration test that proves the codex/opencode wire works
 * end-to-end.
 */
import { describe, it, expect, vi } from "vitest";
import { spawn } from "child_process";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createInterface } from "readline";
import { z } from "zod";

import { startStratosMcpSocketServer } from "../mcp/socket-mcp-server";
import { defineHandler, textResult } from "../mcp/handlers/types";
import { installStratosMcpProxy, getStratosMcpPath } from "../mcp/stdio-proxy";

vi.mock("electron", () => ({ BrowserWindow: vi.fn() }));

describe("stdio proxy integration", () => {
  it("bridges MCP JSON-RPC between stdin/stdout and the Unix socket", async () => {
    // Install the proxy script to ~/.stratos/bin/stratos-mcp
    installStratosMcpProxy();
    const proxyPath = getStratosMcpPath();
    expect(existsSync(proxyPath)).toBe(true);

    // Start socket server
    const dir = mkdtempSync(join(tmpdir(), "stratos-proxy-test-"));
    const socketPath = join(dir, "mcp.sock");
    const handlers = [
      defineHandler({
        name: "echo",
        description: "",
        inputSchema: { msg: z.string() },
        handler: async ({ msg }) => textResult(`got ${msg}`),
      }),
    ];
    const server = startStratosMcpSocketServer({
      socketPath,
      serverName: "stratos",
      serverVersion: "1.0.0",
      handlers,
    });

    try {
      // Spawn the proxy
      const proxy = spawn("node", [proxyPath], {
        env: { ...process.env, STRATOS_MCP_SOCK: socketPath },
        stdio: ["pipe", "pipe", "pipe"],
      });

      const stdout = createInterface({ input: proxy.stdout!, terminal: false });
      const lines: string[] = [];
      stdout.on("line", (l) => lines.push(l));

      const send = (obj: Record<string, unknown>) =>
        proxy.stdin!.write(JSON.stringify(obj) + "\n");

      // Give the proxy a moment to connect
      await new Promise((r) => setTimeout(r, 200));

      send({ jsonrpc: "2.0", id: 1, method: "initialize" });
      send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
      send({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "echo", arguments: { msg: "hi" } },
      });

      // Wait for 3 responses
      const deadline = Date.now() + 3000;
      while (lines.length < 3 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
      }

      expect(lines.length).toBeGreaterThanOrEqual(3);
      const init = JSON.parse(lines[0]);
      expect(init.result.serverInfo.name).toBe("stratos");

      const list = JSON.parse(lines[1]);
      expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual([
        "echo",
      ]);

      const call = JSON.parse(lines[2]);
      expect(call.result.isError).toBeFalsy();
      expect(call.result.content[0].text).toBe("got hi");

      proxy.stdin!.end();
      await new Promise((r) => proxy.once("exit", r));
    } finally {
      await server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 10000);
});
