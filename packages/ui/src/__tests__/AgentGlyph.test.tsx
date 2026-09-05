import { describe, expect, it } from "vitest";
import { getAgentGlyph, isAgentGlyph } from "../components/AgentGlyph";

describe("getAgentGlyph", () => {
  it("keeps an authored short lettermark", () => {
    expect(getAgentGlyph("Friday", "fr")).toBe("FR");
  });

  it("derives a compact glyph from emoji-backed and non-Latin names", () => {
    expect(getAgentGlyph("Personal Executive", "🤖")).toBe("PE");
    expect(getAgentGlyph("山田 太郎", "🤖")).toBe("山太");
  });

  it("rejects emoji input and caps case-expanded glyphs at two characters", () => {
    expect(isAgentGlyph("🤖")).toBe(false);
    expect(getAgentGlyph("Agent", "ﬃ")).toBe("FF");
  });
});
