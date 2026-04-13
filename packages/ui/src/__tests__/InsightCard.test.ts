import { describe, it, expect } from "vitest";
import { parseContentSegments } from "../components/MessageBubble";

const DASHES = "─".repeat(20);

describe("parseContentSegments", () => {
  it("returns a single text segment when no insight present", () => {
    const segments = parseContentSegments("Hello world");
    expect(segments).toEqual([{ type: "text", content: "Hello world" }]);
  });

  it("parses a plain insight block", () => {
    const content = `Before\n★ Insight ${DASHES} This is the insight. ${DASHES}\nAfter`;
    const segments = parseContentSegments(content);
    expect(segments).toHaveLength(3);
    expect(segments[0]).toEqual({ type: "text", content: "Before" });
    expect(segments[1]).toEqual({
      type: "insight",
      content: "This is the insight.",
    });
    expect(segments[2]).toEqual({ type: "text", content: "After" });
  });

  it("strips surrounding backticks from insight block", () => {
    const content = `\`★ Insight ${DASHES} Insight text here. ${DASHES}\``;
    const segments = parseContentSegments(content);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({
      type: "insight",
      content: "Insight text here.",
    });
  });

  it("handles insight with no surrounding text", () => {
    const content = `★ Insight ${DASHES} Solo insight. ${DASHES}`;
    const segments = parseContentSegments(content);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({ type: "insight", content: "Solo insight." });
  });

  it("handles multiple insights in one message", () => {
    const content = [
      "Intro text",
      `★ Insight ${DASHES} First insight. ${DASHES}`,
      "Middle text",
      `★ Insight ${DASHES} Second insight. ${DASHES}`,
      "Outro text",
    ].join("\n");

    const segments = parseContentSegments(content);
    expect(segments).toHaveLength(5);
    expect(segments[0].type).toBe("text");
    expect(segments[1]).toEqual({ type: "insight", content: "First insight." });
    expect(segments[2].type).toBe("text");
    expect(segments[3]).toEqual({
      type: "insight",
      content: "Second insight.",
    });
    expect(segments[4].type).toBe("text");
  });

  it("handles insight-only content with no surrounding text", () => {
    const content = `★ Insight ${DASHES} Only insight. ${DASHES}`;
    const segments = parseContentSegments(content);
    expect(segments).toEqual([{ type: "insight", content: "Only insight." }]);
  });

  it("returns single text segment for empty string", () => {
    const segments = parseContentSegments("");
    expect(segments).toEqual([{ type: "text", content: "" }]);
  });

  it("preserves insight content with inline formatting characters", () => {
    const content = `★ Insight ${DASHES} Use \`cb spaces use\` for context. ${DASHES}`;
    const segments = parseContentSegments(content);
    expect(segments[0].type).toBe("insight");
    expect(segments[0].content).toContain("`cb spaces use`");
  });
});
