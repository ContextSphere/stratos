/**
 * Unix-domain-socket MCP server for the unified `stratos` server.
 *
 * Accepts newline-delimited JSON-RPC 2.0 frames over a UDS at
 * ~/.stratos/mcp-<instance-hash>.sock and dispatches them against the
 * shared HandlerDef[] built by createStratosHandlers(). Used by the
 * codex/opencode stdio proxy — Claude uses the SDK adapter instead.
 *
 * Multiple concurrent connections supported (each CLI subprocess gets its
 * own stateless connection).
 */
import { createServer, type Server, type Socket } from "net";
import { createInterface } from "readline";
import { existsSync, unlinkSync, mkdirSync, chmodSync } from "fs";
import { dirname } from "path";
import { z } from "zod";
import type { HandlerDef, ToolResult } from "./handlers/types";

const MCP_PROTOCOL_VERSION = "2024-11-05";

export interface StratosMcpSocketServer {
  socketPath: string;
  close(): Promise<void>;
}

export function startStratosMcpSocketServer(opts: {
  socketPath: string;
  serverName: string;
  serverVersion: string;
  handlers: HandlerDef[];
}): StratosMcpSocketServer {
  const { socketPath, serverName, serverVersion, handlers } = opts;

  const byName = new Map<string, HandlerDef>();
  for (const h of handlers) byName.set(h.name, h);

  const toolsList = handlers.map((d) => ({
    name: d.name,
    description: d.description,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    inputSchema: z.toJSONSchema(z.object(d.inputSchema) as any),
    ...(d.annotations ? { annotations: d.annotations } : {}),
  }));

  if (existsSync(socketPath)) {
    try {
      unlinkSync(socketPath);
    } catch {}
  }
  mkdirSync(dirname(socketPath), { recursive: true });

  const server: Server = createServer((socket) => handleConnection(socket));
  server.on("error", (err) => {
    console.error("[mcp-socket] server error:", err);
  });

  server.listen(socketPath, () => {
    try {
      chmodSync(socketPath, 0o600);
    } catch {}
    console.log(`[mcp-socket] listening on ${socketPath}`);
  });

  function respond(socket: Socket, obj: Record<string, unknown>): void {
    try {
      socket.write(JSON.stringify(obj) + "\n");
    } catch {
      // Connection may be closed
    }
  }

  function handleConnection(socket: Socket): void {
    const rl = createInterface({ input: socket, terminal: false });
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let req: {
        id?: number | string | null;
        method?: string;
        params?: Record<string, unknown>;
      };
      try {
        req = JSON.parse(trimmed);
      } catch {
        respond(socket, {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        });
        return;
      }
      handleRequest(req, socket).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        respond(socket, {
          jsonrpc: "2.0",
          id: req.id ?? null,
          error: { code: -32603, message: msg },
        });
      });
    });
    socket.on("error", () => {});
  }

  async function handleRequest(
    req: {
      id?: number | string | null;
      method?: string;
      params?: Record<string, unknown>;
    },
    socket: Socket,
  ): Promise<void> {
    const { id, method, params = {} } = req;

    switch (method) {
      case "initialize":
        respond(socket, {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: serverName, version: serverVersion },
          },
        });
        return;

      case "notifications/initialized":
        // Notification — no response required
        return;

      case "ping":
        respond(socket, { jsonrpc: "2.0", id, result: {} });
        return;

      case "tools/list":
        respond(socket, {
          jsonrpc: "2.0",
          id,
          result: { tools: toolsList },
        });
        return;

      case "tools/call": {
        const { name, arguments: rawArgs = {} } = params as {
          name?: string;
          arguments?: Record<string, unknown>;
        };
        if (!name) {
          respond(socket, {
            jsonrpc: "2.0",
            id,
            error: { code: -32602, message: "tools/call requires name" },
          });
          return;
        }
        const def = byName.get(name);
        if (!def) {
          respond(socket, {
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: `Unknown tool: ${name}` },
          });
          return;
        }

        // Validate + parse input via the handler's zod shape
        const schema = z.object(def.inputSchema);
        const parsed = schema.safeParse(rawArgs);
        if (!parsed.success) {
          respond(socket, {
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: `Invalid arguments: ${parsed.error.message}`,
                },
              ],
              isError: true,
            },
          });
          return;
        }

        let result: ToolResult;
        try {
          result = await def.handler(parsed.data);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result = {
            content: [{ type: "text", text: `Error: ${msg}` }],
            isError: true,
          };
        }
        respond(socket, { jsonrpc: "2.0", id, result });
        return;
      }

      default:
        if (id !== undefined && id !== null) {
          respond(socket, {
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: `Method not found: ${method}` },
          });
        }
    }
  }

  return {
    socketPath,
    close(): Promise<void> {
      return new Promise((resolve) => {
        server.close(() => {
          if (existsSync(socketPath)) {
            try {
              unlinkSync(socketPath);
            } catch {}
          }
          resolve();
        });
      });
    },
  };
}
