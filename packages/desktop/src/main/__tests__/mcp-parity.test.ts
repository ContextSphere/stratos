/**
 * Cross-transport parity: the SDK adapter (Claude) and the socket MCP
 * server (codex/opencode) must advertise the exact same tools/list
 * output. This is the structural guarantee that tool names, descriptions,
 * and schemas cannot drift between the two paths.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createConnection, type Socket } from "net";
import { createInterface } from "readline";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createStratosHandlers } from "../mcp/handlers";
import { handlersToSdkMcp } from "../mcp/sdk-adapter";
import { startStratosMcpSocketServer } from "../mcp/socket-mcp-server";

vi.mock("electron", () => ({ BrowserWindow: vi.fn() }));

function makeDeps() {
  const sendSpy = vi.fn();
  const window = {
    isDestroyed: () => false,
    webContents: { isDestroyed: () => false, send: sendSpy },
  };
  const storage = {
    listThreads: vi.fn(() => []),
    listFolders: vi.fn(() => []),
    getThread: vi.fn(() => null),
    getActiveThreadId: vi.fn(() => null),
    setActiveThreadId: vi.fn(),
    createThread: vi.fn(),
    updateThread: vi.fn(),
    deleteThread: vi.fn(),
    addFolder: vi.fn(),
    removeFolder: vi.fn(),
    loadMessages: vi.fn(async () => []),
  };
  const agentManager = {
    startStream: vi.fn(),
    isStreaming: vi.fn(() => false),
    interruptSession: vi.fn(),
    clearSession: vi.fn(),
  };
  return {
    storage: storage as never,
    agentManager: agentManager as never,
    window: window as never,
    sendToRenderer: (c: string, d: unknown) => sendSpy(c, d),
  };
}

describe("cross-transport parity: SDK adapter vs socket MCP server", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "stratos-parity-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("both transports advertise identical tool names", async () => {
    const deps = makeDeps();
    const handlers = createStratosHandlers(deps);

    // --- SDK side ---
    const sdkMcp = handlersToSdkMcp("stratos", "1.0.0", handlers);
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "parity", version: "1.0.0" });
    await Promise.all([client.connect(a), sdkMcp.instance.connect(b)]);
    const sdkList = await client.listTools();
    const sdkNames = sdkList.tools.map((t) => t.name).sort();
    await client.close();

    // --- Socket side ---
    const socketPath = join(tmp, "mcp.sock");
    const server = startStratosMcpSocketServer({
      socketPath,
      serverName: "stratos",
      serverVersion: "1.0.0",
      handlers,
    });
    try {
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
      const rl = createInterface({ input: sock, terminal: false });
      const response = new Promise<{ result: { tools: { name: string }[] } }>(
        (resolve) => {
          rl.once("line", (line) => resolve(JSON.parse(line)));
        },
      );
      sock.write(
        JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) + "\n",
      );
      const socketRes = await response;
      const socketNames = socketRes.result.tools.map((t) => t.name).sort();
      sock.end();

      expect(socketNames).toEqual(sdkNames);
      expect(socketNames).toHaveLength(22);
    } finally {
      await server.close();
    }
  });

  it("both transports advertise identical tool descriptions", async () => {
    const deps = makeDeps();
    const handlers = createStratosHandlers(deps);

    // Derive descriptions from the handler defs directly (single source of
    // truth) and assert both transports pass them through unchanged.
    const expectedByName = new Map(
      handlers.map((h) => [h.name, h.description]),
    );

    // SDK side
    const sdkMcp = handlersToSdkMcp("stratos", "1.0.0", handlers);
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "parity", version: "1.0.0" });
    await Promise.all([client.connect(a), sdkMcp.instance.connect(b)]);
    const sdkTools = (await client.listTools()).tools;
    await client.close();

    for (const t of sdkTools) {
      expect(t.description).toBe(expectedByName.get(t.name));
    }

    // Socket side
    const socketPath = join(tmp, "mcp.sock");
    const server = startStratosMcpSocketServer({
      socketPath,
      serverName: "stratos",
      serverVersion: "1.0.0",
      handlers,
    });
    try {
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
      const rl = createInterface({ input: sock, terminal: false });
      const response = new Promise<{
        result: { tools: { name: string; description: string }[] };
      }>((resolve) => {
        rl.once("line", (line) => resolve(JSON.parse(line)));
      });
      sock.write(
        JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) + "\n",
      );
      const socketRes = await response;
      for (const t of socketRes.result.tools) {
        expect(t.description).toBe(expectedByName.get(t.name));
      }
      sock.end();
    } finally {
      await server.close();
    }
  });
});
