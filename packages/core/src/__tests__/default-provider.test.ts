import { describe, it, expect } from "vitest";
import { DEFAULT_PROVIDER } from "../types/thread";
import { getAvailableProviders } from "../providers";

describe("DEFAULT_PROVIDER", () => {
  it("is copilot — the standard provider for every new session", () => {
    expect(DEFAULT_PROVIDER).toBe("copilot");
  });

  it("maps to a registered provider implementation", () => {
    expect(getAvailableProviders()).toContain(DEFAULT_PROVIDER);
  });
});
