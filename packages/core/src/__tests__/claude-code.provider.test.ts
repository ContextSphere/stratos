import { describe, it, expect } from "vitest";
import {
  ClaudeCodeProvider,
  stripOversizedImageData,
} from "../providers/claude-code.provider";

describe("ClaudeCodeProvider", () => {
  it("instantiates with correct name", () => {
    const provider = new ClaudeCodeProvider();
    expect(provider.name).toBe("claude-code");
  });

  it("initialize does not throw", async () => {
    const provider = new ClaudeCodeProvider();
    await expect(provider.initialize({})).resolves.toBeUndefined();
  });

  it("canResume returns false when no session exists", () => {
    const provider = new ClaudeCodeProvider();
    expect(provider.canResume("some-session")).toBe(false);
  });

  it("dispose does not throw", async () => {
    const provider = new ClaudeCodeProvider();
    await expect(provider.dispose()).resolves.toBeUndefined();
  });
});

describe("stripOversizedImageData", () => {
  it("passes through non-array content unchanged", () => {
    expect(stripOversizedImageData(undefined)).toBeUndefined();
    expect(stripOversizedImageData(null)).toBeNull();
    expect(stripOversizedImageData("some string")).toBe("some string");
  });

  it("preserves small image base64 data intact", () => {
    const data = "A".repeat(100_000); // 100KB — under the streaming cap
    const content = [
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data },
      },
    ];
    const stripped = stripOversizedImageData(content);
    expect(stripped).toEqual(content);
  });

  it("strips oversized image base64 data but keeps structure", () => {
    const data = "A".repeat(2_000_000); // 2MB — over the streaming cap
    const content = [
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data },
      },
    ];
    const stripped = stripOversizedImageData(content) as Array<{
      type: string;
      source: { type: string; media_type: string; data: string };
    }>;
    expect(stripped[0].type).toBe("image");
    expect(stripped[0].source.media_type).toBe("image/png");
    expect(stripped[0].source.data).toBe("");
  });

  it("leaves non-image blocks alone in a mixed array", () => {
    const data = "A".repeat(2_000_000);
    const content = [
      { type: "text", text: "hello" },
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data },
      },
      { type: "text", text: "world" },
    ];
    const stripped = stripOversizedImageData(content) as Array<
      Record<string, unknown>
    >;
    expect(stripped[0]).toEqual({ type: "text", text: "hello" });
    expect(stripped[2]).toEqual({ type: "text", text: "world" });
    expect((stripped[1] as { source: { data: string } }).source.data).toBe("");
  });
});
