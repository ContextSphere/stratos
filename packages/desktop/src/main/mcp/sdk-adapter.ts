/**
 * Wraps a HandlerDef[] into a Claude Agent SDK in-process MCP server.
 *
 * Used for the claude-code provider path, where handlers run in Electron
 * main and the SDK routes them via its bidirectional control protocol —
 * no subprocess, no socket, no HTTP, and (critically) no LinkedIn
 * enterprise allowlist check (which applies only to stdio/URL entries).
 */
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import type { HandlerDef } from "./handlers/types";

export function handlersToSdkMcp(
  name: string,
  version: string,
  defs: HandlerDef[],
): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name,
    version,
    tools: defs.map((d) =>
      tool(
        d.name,
        d.description,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        d.inputSchema as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        d.handler as any,
        d.annotations ? { annotations: d.annotations } : undefined,
      ),
    ),
  });
}
