/**
 * Exercises the Unix-socket MCP server with a raw net.Socket client.
 * Validates the full MCP JSON-RPC surface: initialize / tools/list /
 * tools/call happy path + error paths.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createConnection, type Socket } from "net";
import { createInterface } from "readline";
import { z } from "zod";

import { startStratosMcpSocketServer } from "../mcp/socket-mcp-server";
import type { StratosMcpSocketServer } from "../mcp/socket-mcp-server";
import { defineHandler, textResult } from "../mcp/handlers/types";

vi.mock("electron", () => ({ BrowserWindow: vi.fn() }));

class Rpc {
  private rl;
  private nextId = 1;
  private pending = new Map<
    number,
    {
      resolve: (v: Record<string, unknown>) => void;
      reject: (err: Error) => void;
    }
  >();

  constructor(private sock: Socket) {
    this.rl = createInterface({ input: sock, terminal: false });
    this.rl.on("line", (line) => {
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const { resolve } = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          resolve(msg);
        }
      } catch {}
    });
  }

  call(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.sock.write(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
      );
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`timeout ${method}`));
        }
      }, 2000);
    });
  }

  close() {
    this.sock.end();
  }
}

async function withServer(
  handlers: ReturnType<typeof defineHandler>[],
  fn: (rpc: Rpc) => Promise<void>,
) {
  const dir = mkdtempSync(join(tmpdir(), "stratos-socket-test-"));
  const socketPath = join(dir, "mcp.sock");
  let server: StratosMcpSocketServer | undefined;
  let rpc: Rpc | undefined;
  try {
    server = startStratosMcpSocketServer({
      socketPath,
      serverName: "stratos",
      serverVersion: "1.0.0",
      handlers,
    });
    // Poll-retry connect (server listens async)
    const sock = await new Promise<Socket>((resolve, reject) => {
      const start = Date.now();
      const tryConnect = () => {
        const s = createConnection({ path: socketPath });
        s.once("connect", () => resolve(s));
        s.once("error", (err) => {
          if (Date.now() - start > 2000) reject(err);
          else setTimeout(tryConnect, 30);
        });
      };
      tryConnect();
    });
    rpc = new Rpc(sock);
    await fn(rpc);
  } finally {
    rpc?.close();
    if (server) await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("socket MCP server", () => {
  it("responds to initialize with serverInfo + capabilities", async () => {
    await withServer([], async (rpc) => {
      const res = (await rpc.call("initialize", {})) as {
        result: {
          serverInfo: { name: string; version: string };
          capabilities: unknown;
        };
      };
      expect(res.result.serverInfo).toEqual({
        name: "stratos",
        version: "1.0.0",
      });
      expect(res.result.capabilities).toHaveProperty("tools");
    });
  });

  it("responds to tools/list with all registered handlers", async () => {
    const handlers = [
      defineHandler({
        name: "echo",
        description: "echoes",
        inputSchema: { msg: z.string() },
        handler: async ({ msg }) => textResult(`got ${msg}`),
      }),
      defineHandler({
        name: "ping",
        description: "pings",
        inputSchema: {},
        handler: async () => textResult("pong"),
      }),
    ];
    await withServer(handlers, async (rpc) => {
      const res = (await rpc.call("tools/list", {})) as {
        result: {
          tools: { name: string; inputSchema: Record<string, unknown> }[];
        };
      };
      expect(res.result.tools.map((t) => t.name).sort()).toEqual([
        "echo",
        "ping",
      ]);
      const echo = res.result.tools.find((t) => t.name === "echo")!;
      expect(echo.inputSchema).toMatchObject({
        type: "object",
        properties: { msg: expect.any(Object) },
      });
    });
  });

  it("tools/call invokes the handler and returns its ToolResult", async () => {
    const handlers = [
      defineHandler({
        name: "echo",
        description: "",
        inputSchema: { msg: z.string() },
        handler: async ({ msg }) => textResult(`got ${msg}`),
      }),
    ];
    await withServer(handlers, async (rpc) => {
      const res = (await rpc.call("tools/call", {
        name: "echo",
        arguments: { msg: "hello" },
      })) as {
        result: { content: { text: string }[]; isError?: boolean };
      };
      expect(res.result.isError).toBeFalsy();
      expect(res.result.content[0].text).toBe("got hello");
    });
  });

  it("tools/call returns isError:true on zod validation failure", async () => {
    const handlers = [
      defineHandler({
        name: "needsNumber",
        description: "",
        inputSchema: { n: z.number() },
        handler: async ({ n }) => textResult(`n=${n}`),
      }),
    ];
    await withServer(handlers, async (rpc) => {
      const res = (await rpc.call("tools/call", {
        name: "needsNumber",
        arguments: { n: "not-a-number" },
      })) as { result: { content: { text: string }[]; isError?: boolean } };
      expect(res.result.isError).toBe(true);
      expect(res.result.content[0].text).toMatch(/Invalid arguments/);
    });
  });

  it("returns -32601 for unknown tool", async () => {
    await withServer([], async (rpc) => {
      const res = (await rpc.call("tools/call", {
        name: "nope",
        arguments: {},
      })) as { error?: { code: number; message: string } };
      expect(res.error?.code).toBe(-32601);
      expect(res.error?.message).toMatch(/Unknown tool/);
    });
  });

  it("responds to ping with empty result", async () => {
    await withServer([], async (rpc) => {
      const res = (await rpc.call("ping", {})) as { result: unknown };
      expect(res.result).toEqual({});
    });
  });

  it("handler exceptions surface as isError ToolResult (no crash)", async () => {
    const handlers = [
      defineHandler({
        name: "boom",
        description: "",
        inputSchema: {},
        handler: async () => {
          throw new Error("kaboom");
        },
      }),
    ];
    await withServer(handlers, async (rpc) => {
      const res = (await rpc.call("tools/call", {
        name: "boom",
        arguments: {},
      })) as { result: { content: { text: string }[]; isError?: boolean } };
      expect(res.result.isError).toBe(true);
      expect(res.result.content[0].text).toContain("kaboom");
    });
  });
});
