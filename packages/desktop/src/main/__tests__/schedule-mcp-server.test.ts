import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import { spawn } from "child_process";
import type { ChildProcess } from "child_process";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { SCHEDULE_MCP_SOURCE } from "../scheduler/schedule-mcp-source";

// ── Helpers ────────────────────────────────────────────────────────────────

/** Send a JSON-RPC message to the MCP server and read the response. */
function sendMessage(
  proc: ChildProcess,
  msg: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const json = JSON.stringify(msg);
    const frame = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`;

    let buf = "";
    const onData = (chunk: Buffer) => {
      buf += chunk.toString();
      const headerEnd = buf.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = buf.slice(0, headerEnd);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) return;
      const contentLength = parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;
      if (buf.length < bodyStart + contentLength) return;
      const body = buf.slice(bodyStart, bodyStart + contentLength);
      buf = buf.slice(bodyStart + contentLength);
      proc.stdout!.off("data", onData);
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error(`Failed to parse response: ${body}`));
      }
    };
    proc.stdout!.on("data", onData);
    proc.stdin!.write(frame);

    setTimeout(() => {
      proc.stdout!.off("data", onData);
      reject(new Error("Timeout waiting for MCP response"));
    }, 5000);
  });
}

// ── Test suite ─────────────────────────────────────────────────────────────

describe("schedule MCP server", () => {
  let tmpHome: string;
  let serverPath: string;
  let proc: ChildProcess;

  beforeAll(() => {
    // Write the MCP server script to a temp location
    tmpHome = mkdtempSync(join(tmpdir(), "stratos-mcp-test-home-"));
    const binDir = join(tmpHome, ".stratos", "bin");
    mkdirSync(binDir, { recursive: true });
    serverPath = join(binDir, "schedule-mcp-server.js");
    writeFileSync(serverPath, SCHEDULE_MCP_SOURCE, "utf-8");
  });

  beforeEach(() => {
    // Clean store files before each test
    const stratosDir = join(tmpHome, ".stratos");
    mkdirSync(stratosDir, { recursive: true });
    writeFileSync(join(stratosDir, "scheduled-prompts.json"), "[]", "utf-8");

    // Spawn the server with HOME overridden
    proc = spawn("node", [serverPath], {
      env: { ...process.env, HOME: tmpHome },
      stdio: ["pipe", "pipe", "pipe"],
    });
  });

  afterEach(() => {
    proc?.kill();
  });

  afterEach(() => {
    // Clean up store files
    const promptsPath = join(tmpHome, ".stratos", "scheduled-prompts.json");
    try {
      writeFileSync(promptsPath, "[]", "utf-8");
    } catch {}
  });

  // Cleanup temp home after all tests
  afterEach(() => {}); // keep proc cleanup separate
  // Final cleanup in a process exit handler would be ideal but afterAll suffices
  // since vitest runs tests sequentially within a file

  it("responds to initialize", async () => {
    const resp = await sendMessage(proc, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0" },
      },
    });
    expect(resp).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "stratos-schedule", version: "1.0.0" },
      },
    });
  });

  it("lists tools", async () => {
    // Must initialize first
    await sendMessage(proc, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    });

    const resp = await sendMessage(proc, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    const result = resp.result as { tools: { name: string }[] };
    const toolNames = result.tools.map((t) => t.name);
    expect(toolNames).toContain("schedule_create");
    expect(toolNames).toContain("schedule_list");
    expect(toolNames).toContain("schedule_delete");
    expect(toolNames).toContain("schedule_enable");
    expect(toolNames).toContain("schedule_disable");
    expect(toolNames).toContain("list_folders");
  });

  it("creates and lists a schedule", async () => {
    await sendMessage(proc, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    });

    // Create
    const createResp = await sendMessage(proc, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "schedule_create",
        arguments: {
          name: "Daily review",
          prompt: "Review recent changes",
          folder_id: "folder-1",
          schedule_type: "recurring",
          interval: "every-day",
          time_of_day: "09:00",
        },
      },
    });
    const createResult = createResp.result as {
      content: { type: string; text: string }[];
    };
    expect(createResult.content[0].text).toContain("Created schedule:");

    // List
    const listResp = await sendMessage(proc, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "schedule_list", arguments: {} },
    });
    const listResult = listResp.result as {
      content: { type: string; text: string }[];
    };
    expect(listResult.content[0].text).toContain("Daily review");
    expect(listResult.content[0].text).toContain("enabled");
  });

  it("creates and deletes a schedule", async () => {
    await sendMessage(proc, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    });

    // Create
    const createResp = await sendMessage(proc, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "schedule_create",
        arguments: {
          name: "To delete",
          prompt: "Will be removed",
          folder_id: "folder-1",
          schedule_type: "recurring",
          interval: "every-hour",
        },
      },
    });
    const createText = (createResp.result as { content: { text: string }[] })
      .content[0].text;
    const id = createText.match(/sched_\w+/)?.[0];
    expect(id).toBeTruthy();

    // Delete
    const delResp = await sendMessage(proc, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "schedule_delete", arguments: { id } },
    });
    const delResult = delResp.result as {
      content: { type: string; text: string }[];
    };
    expect(delResult.content[0].text).toContain("Deleted");

    // Verify empty
    const listResp = await sendMessage(proc, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "schedule_list", arguments: {} },
    });
    const listResult = listResp.result as {
      content: { type: string; text: string }[];
    };
    expect(listResult.content[0].text).toBe("No scheduled prompts.");
  });

  it("enables and disables a schedule", async () => {
    await sendMessage(proc, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    });

    // Create
    const createResp = await sendMessage(proc, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "schedule_create",
        arguments: {
          name: "Toggle me",
          prompt: "test",
          folder_id: "folder-1",
          schedule_type: "recurring",
          interval: "every-hour",
        },
      },
    });
    const id = (
      createResp.result as { content: { text: string }[] }
    ).content[0].text.match(/sched_\w+/)?.[0];

    // Disable
    const disResp = await sendMessage(proc, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "schedule_disable", arguments: { id } },
    });
    expect(
      (disResp.result as { content: { text: string }[] }).content[0].text,
    ).toContain("Disabled");

    // Verify disabled in store
    const prompts = JSON.parse(
      readFileSync(
        join(tmpHome, ".stratos", "scheduled-prompts.json"),
        "utf-8",
      ),
    );
    expect(prompts[0].enabled).toBe(false);

    // Enable
    const enResp = await sendMessage(proc, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "schedule_enable", arguments: { id } },
    });
    expect(
      (enResp.result as { content: { text: string }[] }).content[0].text,
    ).toContain("Enabled");
  });

  it("lists folders from threads.json", async () => {
    await sendMessage(proc, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    });

    // Write a threads.json with folders
    const threadsDir = join(tmpHome, ".stratos", "threads");
    mkdirSync(threadsDir, { recursive: true });
    writeFileSync(
      join(threadsDir, "threads.json"),
      JSON.stringify({
        threads: [],
        activeThreadId: null,
        folders: [
          {
            id: "folder_1",
            name: "My Project",
            path: "/home/user/project",
            createdAt: 1000,
          },
        ],
      }),
      "utf-8",
    );

    const resp = await sendMessage(proc, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "list_folders", arguments: {} },
    });
    const result = resp.result as { content: { text: string }[] };
    expect(result.content[0].text).toContain("folder_1");
    expect(result.content[0].text).toContain("My Project");
    expect(result.content[0].text).toContain("/home/user/project");
  });

  it("validates one-time schedule requires run_at", async () => {
    await sendMessage(proc, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    });

    const resp = await sendMessage(proc, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "schedule_create",
        arguments: {
          name: "Bad once",
          prompt: "test",
          folder_id: "folder-1",
          schedule_type: "once",
        },
      },
    });
    const result = resp.result as {
      isError: boolean;
      content: { text: string }[];
    };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("run_at is required");
  });

  it("validates recurring schedule requires interval", async () => {
    await sendMessage(proc, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    });

    const resp = await sendMessage(proc, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "schedule_create",
        arguments: {
          name: "Bad recurring",
          prompt: "test",
          folder_id: "folder-1",
          schedule_type: "recurring",
        },
      },
    });
    const result = resp.result as {
      isError: boolean;
      content: { text: string }[];
    };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("interval is required");
  });

  it("returns error for non-existent schedule operations", async () => {
    await sendMessage(proc, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    });

    const delResp = await sendMessage(proc, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "schedule_delete", arguments: { id: "nonexistent" } },
    });
    expect((delResp.result as { isError: boolean }).isError).toBe(true);

    const enResp = await sendMessage(proc, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "schedule_enable", arguments: { id: "nonexistent" } },
    });
    expect((enResp.result as { isError: boolean }).isError).toBe(true);
  });
});
