/**
 * Verifies Stratos's MCP config gets forwarded into each provider's own MCP
 * config surface:
 *   - Codex: `-c mcp_servers.<name>.{command,args,env}` overrides on the
 *     `codex app-server` argv.
 *   - Opencode: an `mcp` block in the JSON written to `OPENCODE_CONFIG_CONTENT`.
 *
 * SDK-type entries (claude-code-only, `type: "sdk"`) must be skipped by both.
 */
import { describe, it, expect } from "vitest";
import { buildCodexMcpArgs } from "../providers/codex.provider";
import { buildOpencodeMcpConfig } from "../providers/opencode.provider";

describe("buildCodexMcpArgs", () => {
  it("returns [] for empty input", () => {
    expect(buildCodexMcpArgs({})).toEqual([]);
  });

  it("skips SDK-type entries", () => {
    const out = buildCodexMcpArgs({
      "stratos-scheduler": { type: "sdk", name: "stratos-scheduler" },
    });
    expect(out).toEqual([]);
  });

  it("emits command, args, and env overrides for a stdio entry", () => {
    const out = buildCodexMcpArgs({
      "stratos-preview": {
        command: "node",
        args: ["/bin/preview-mcp"],
        env: { STRATOS_PREVIEW_SOCKET: "/tmp/p.sock" },
      },
    });
    // The order inside `out` is the reverse of what ends up on argv (caller
    // unshifts), so the last pushed pair is the first pushed key — which is
    // the command. Walk through and verify shape:
    expect(out).toContain(`mcp_servers.stratos-preview.command="node"`);
    expect(out).toContain(
      `mcp_servers.stratos-preview.args=["/bin/preview-mcp"]`,
    );
    expect(out).toContain(
      `mcp_servers.stratos-preview.env.STRATOS_PREVIEW_SOCKET="/tmp/p.sock"`,
    );
    // Every key should be preceded by a "-c" in the output.
    const cFlagCount = out.filter((x) => x === "-c").length;
    const keyCount = out.filter((x) => x.startsWith("mcp_servers.")).length;
    expect(cFlagCount).toBe(keyCount);
  });

  it("escapes quotes and backslashes in TOML string values", () => {
    const out = buildCodexMcpArgs({
      weird: { command: `a"b\\c` },
    });
    // Double quote should be escaped, backslash should be doubled
    const cmd = out.find((x) => x.startsWith("mcp_servers.weird.command="));
    expect(cmd).toBe(`mcp_servers.weird.command="a\\"b\\\\c"`);
  });

  it("skips entries without a command", () => {
    expect(
      buildCodexMcpArgs({ broken: { args: ["/x"] } as unknown as object }),
    ).toEqual([]);
  });

  it("combines multiple stdio entries", () => {
    const out = buildCodexMcpArgs({
      "stratos-scheduler": {
        command: "node",
        args: ["/bin/sched"],
      },
      "stratos-preview": {
        command: "node",
        args: ["/bin/preview"],
      },
    });
    expect(
      out.find((x) => x.startsWith("mcp_servers.stratos-scheduler.command=")),
    ).toBeDefined();
    expect(
      out.find((x) => x.startsWith("mcp_servers.stratos-preview.command=")),
    ).toBeDefined();
  });
});

describe("buildOpencodeMcpConfig", () => {
  it("returns {} for empty input", () => {
    expect(buildOpencodeMcpConfig({})).toEqual({});
  });

  it("skips SDK-type entries", () => {
    expect(
      buildOpencodeMcpConfig({
        "stratos-scheduler": { type: "sdk", name: "stratos-scheduler" },
      }),
    ).toEqual({});
  });

  it("emits a local MCP server spec with command + env", () => {
    const config = buildOpencodeMcpConfig({
      "stratos-preview": {
        command: "node",
        args: ["/bin/preview-mcp"],
        env: { STRATOS_PREVIEW_SOCKET: "/tmp/p.sock" },
      },
    });
    expect(config["stratos-preview"]).toEqual({
      type: "local",
      command: ["node", "/bin/preview-mcp"],
      enabled: true,
      environment: { STRATOS_PREVIEW_SOCKET: "/tmp/p.sock" },
    });
  });

  it("omits environment when env is missing", () => {
    const config = buildOpencodeMcpConfig({
      "stratos-scheduler": {
        command: "node",
        args: ["/bin/sched-mcp"],
      },
    });
    expect(config["stratos-scheduler"]).toEqual({
      type: "local",
      command: ["node", "/bin/sched-mcp"],
      enabled: true,
    });
  });

  it("skips entries without a command", () => {
    expect(
      buildOpencodeMcpConfig({
        broken: { args: ["/x"] } as unknown as object,
      }),
    ).toEqual({});
  });
});
