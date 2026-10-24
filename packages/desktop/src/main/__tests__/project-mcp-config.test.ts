import { describe, expect, it } from "vitest";
import { parseProjectMcpConfig } from "../mcp/project-config";

describe("parseProjectMcpConfig", () => {
  it("loads project MCP servers and attaches source metadata", () => {
    expect(
      parseProjectMcpConfig(
        JSON.stringify({
          mcpServers: {
            "chrome-devtools": {
              command: "bash",
              args: ["scripts/cdp-mcp.sh"],
            },
          },
        }),
        "/repo/.mcp.json",
      ),
    ).toEqual({
      "chrome-devtools": {
        command: "bash",
        args: ["scripts/cdp-mcp.sh"],
        scope: "project",
        configPath: "/repo/.mcp.json",
      },
    });
  });

  it("ignores malformed server entries", () => {
    expect(
      parseProjectMcpConfig(
        JSON.stringify({ mcpServers: { valid: { command: "node" }, bad: 1 } }),
        "/repo/.mcp.json",
      ),
    ).toEqual({
      valid: {
        command: "node",
        scope: "project",
        configPath: "/repo/.mcp.json",
      },
    });
  });

  it("returns an empty map when mcpServers is absent", () => {
    expect(parseProjectMcpConfig("{}", "/repo/.mcp.json")).toEqual({});
  });
});
