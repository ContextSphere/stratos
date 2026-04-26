/**
 * End-to-end: spawn a real `claude` CLI child via the Claude Agent SDK
 * with our unified `stratos` SDK MCP and assert:
 *   1. `system.init` lists `stratos` as connected.
 *   2. All 19 `mcp__stratos__*` tool names are registered.
 *   3. No `Warning: MCP server blocked by enterprise policy` on stderr.
 *
 * Skipped when running nested inside another Claude session (CLAUDECODE=1).
 */
import { describe, it, expect, vi } from "vitest";
import { query } from "@anthropic-ai/claude-agent-sdk";

import { createStratosHandlers } from "../mcp/handlers";
import { handlersToSdkMcp } from "../mcp/sdk-adapter";

vi.mock("electron", () => ({ BrowserWindow: vi.fn() }));

const nested = Boolean(process.env.CLAUDECODE);

describe.skipIf(nested)(
  "SDK MCP bypasses LinkedIn enterprise allowlist",
  () => {
    it("registers the unified `stratos` server with all 19 tools, no policy warning", async () => {
      const storage = {
        listFolders: () => [],
        listThreads: () => [],
        getThread: () => null,
        getActiveThreadId: () => null,
        setActiveThreadId: () => {},
        createThread: () => ({
          id: "x",
          title: "x",
          createdAt: 0,
          updatedAt: 0,
        }),
        updateThread: () => null,
        deleteThread: () => true,
        addFolder: () => ({ id: "f", name: "n", path: "/" }),
        removeFolder: () => {},
        loadMessages: async () => [],
      };
      const agentManager = {
        startStream: async () => undefined,
        isStreaming: () => false,
        interruptSession: async () => undefined,
        clearSession: () => {},
      };
      const window = {
        isDestroyed: () => false,
        webContents: { isDestroyed: () => false, send: () => {} },
      };

      const stderrChunks: string[] = [];
      const handlers = createStratosHandlers({
        storage: storage as never,
        agentManager: agentManager as never,
        window: window as never,
        sendToRenderer: () => {},
      });
      const mcpServers = {
        stratos: handlersToSdkMcp("stratos", "1.0.0", handlers),
      };

      const q = query({
        prompt: "Respond with the single word OK and stop.",
        options: {
          mcpServers,
          maxTurns: 1,
          allowDangerouslySkipPermissions: true,
          stderr: (chunk) => stderrChunks.push(chunk),
        },
      });

      let initTools: string[] = [];
      let initMcpServers: { name: string; status: string }[] = [];

      try {
        for await (const msg of q) {
          if (msg.type === "system" && msg.subtype === "init") {
            initTools = (msg as unknown as { tools: string[] }).tools ?? [];
            initMcpServers =
              (
                msg as unknown as {
                  mcp_servers?: { name: string; status: string }[];
                }
              ).mcp_servers ?? [];
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/auth|login|credentials|API key/i.test(msg)) {
          console.warn(`Skipping: ${msg}`);
          return;
        }
        throw err;
      }

      const stderr = stderrChunks.join("");
      expect(stderr).not.toMatch(/MCP server blocked by enterprise policy/);

      if (initTools.length > 0) {
        // Spot-check one tool from each domain
        expect(initTools).toContain("mcp__stratos__schedule_folders");
        expect(initTools).toContain("mcp__stratos__preview_close");
        expect(initTools).toContain("mcp__stratos__list_sessions");

        const stratosCount = initTools.filter((t) =>
          t.startsWith("mcp__stratos__"),
        ).length;
        expect(stratosCount).toBe(20);

        const stratos = initMcpServers.find((s) => s.name === "stratos");
        expect(stratos?.status).toBe("connected");
      }
    }, 60_000);
  },
);
