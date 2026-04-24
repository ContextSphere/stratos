import { describe, it, expect } from "vitest";
import { MANAGER_MCP_SOURCE } from "../manager/manager-mcp-source";

/**
 * Extracts the TOOLS array from the embedded MCP source string by evaluating
 * just the relevant slice. We parse it out via a lightweight function wrapper
 * rather than exec-ing the full server script (which expects stdio/sockets).
 */
function extractTools(): Array<{
  name: string;
  inputSchema: Record<string, unknown>;
}> {
  // The TOOLS array is a plain JS literal inside the template string.
  // Extract it between "const TOOLS = [" and the closing "];" that precedes
  // "// ── MCP JSON-RPC dispatch".
  const match = MANAGER_MCP_SOURCE.match(
    /const TOOLS = (\[[\s\S]*?\]);\s*\/\/ ── MCP JSON-RPC dispatch/,
  );
  if (!match)
    throw new Error("Could not locate TOOLS array in MANAGER_MCP_SOURCE");
  // eslint-disable-next-line no-new-func
  return Function(`"use strict"; return (${match[1]});`)();
}

describe("MANAGER_MCP_SOURCE — tool schema: image support", () => {
  const tools = extractTools();

  function getTool(name: string) {
    const t = tools.find((t) => t.name === name);
    if (!t) throw new Error(`Tool '${name}' not found in TOOLS`);
    return t;
  }

  it("create_session schema includes an 'images' array property", () => {
    const schema = getTool("create_session").inputSchema as {
      properties: Record<string, unknown>;
    };
    expect(schema.properties).toHaveProperty("images");
    const imagesSchema = schema.properties.images as {
      type: string;
      items: { type: string; properties: Record<string, unknown> };
    };
    expect(imagesSchema.type).toBe("array");
    expect(imagesSchema.items.type).toBe("object");
    expect(imagesSchema.items.properties).toHaveProperty("dataUrl");
    expect(imagesSchema.items.properties).toHaveProperty("mimeType");
  });

  it("create_session 'images' is not in required fields", () => {
    const schema = getTool("create_session").inputSchema as {
      required?: string[];
    };
    expect(schema.required ?? []).not.toContain("images");
  });

  it("send_message schema includes an 'images' array property", () => {
    const schema = getTool("send_message").inputSchema as {
      properties: Record<string, unknown>;
    };
    expect(schema.properties).toHaveProperty("images");
    const imagesSchema = schema.properties.images as {
      type: string;
      items: { type: string; properties: Record<string, unknown> };
    };
    expect(imagesSchema.type).toBe("array");
    expect(imagesSchema.items.type).toBe("object");
    expect(imagesSchema.items.properties).toHaveProperty("dataUrl");
    expect(imagesSchema.items.properties).toHaveProperty("mimeType");
  });

  it("send_message 'images' is not in required fields", () => {
    const schema = getTool("send_message").inputSchema as {
      required?: string[];
    };
    expect(schema.required ?? []).not.toContain("images");
  });

  it("create_session still requires workspace and prompt", () => {
    const schema = getTool("create_session").inputSchema as {
      required: string[];
    };
    expect(schema.required).toContain("workspace");
    expect(schema.required).toContain("prompt");
  });

  it("send_message still requires threadId and prompt", () => {
    const schema = getTool("send_message").inputSchema as {
      required: string[];
    };
    expect(schema.required).toContain("threadId");
    expect(schema.required).toContain("prompt");
  });
});
