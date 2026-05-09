import { describe, it, expect } from "vitest";
import { phoneToJid } from "../integrations/jid";

describe("phoneToJid", () => {
  it("strips leading + and appends @s.whatsapp.net", () => {
    expect(phoneToJid("+15551234567")).toBe("15551234567@s.whatsapp.net");
  });

  it("strips formatting characters (dashes, spaces, parens)", () => {
    expect(phoneToJid("+1 (555) 123-4567")).toBe("15551234567@s.whatsapp.net");
    expect(phoneToJid("+1-555-123-4567")).toBe("15551234567@s.whatsapp.net");
    expect(phoneToJid("+1 555 123 4567")).toBe("15551234567@s.whatsapp.net");
  });

  it("works without a leading +", () => {
    expect(phoneToJid("15551234567")).toBe("15551234567@s.whatsapp.net");
  });

  it("returns null for empty/null/undefined", () => {
    expect(phoneToJid("")).toBeNull();
    expect(phoneToJid(null)).toBeNull();
    expect(phoneToJid(undefined)).toBeNull();
    expect(phoneToJid("   ")).toBeNull();
  });

  it("returns null for too-short numbers", () => {
    // E.164 minimum is ~8 digits; shorter is malformed.
    expect(phoneToJid("+1234")).toBeNull();
    expect(phoneToJid("123")).toBeNull();
  });

  it("preserves long international numbers", () => {
    // 14-digit max under E.164 spec
    expect(phoneToJid("+442012345678")).toBe("442012345678@s.whatsapp.net");
    expect(phoneToJid("+919876543210")).toBe("919876543210@s.whatsapp.net");
  });
});
