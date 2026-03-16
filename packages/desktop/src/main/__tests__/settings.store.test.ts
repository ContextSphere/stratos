import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "fs";

vi.mock("fs");
vi.mock("os", () => ({ homedir: () => "/mock-home" }));

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFileSync = vi.mocked(writeFileSync);

describe("settings.store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockExistsSync.mockReturnValue(false);
  });

  describe("getProviderSettings", () => {
    it("returns {} for unknown provider when no settings file exists", async () => {
      const { getProviderSettings } = await import(
        "../settings/settings.store"
      );
      expect(getProviderSettings("claude-code")).toEqual({});
    });

    it("returns saved provider settings", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          theme: "dark",
          providers: {
            "claude-code": { lastUsedModel: "claude-sonnet-4-6", lastUsedEffort: "medium" },
          },
        }),
      );
      const { getProviderSettings } = await import(
        "../settings/settings.store"
      );
      expect(getProviderSettings("claude-code")).toEqual({
        lastUsedModel: "claude-sonnet-4-6",
        lastUsedEffort: "medium",
      });
    });

    it("returns {} when providers key is missing", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ theme: "dark" }));
      const { getProviderSettings } = await import(
        "../settings/settings.store"
      );
      expect(getProviderSettings("codex")).toEqual({});
    });
  });

  describe("setProviderSettings", () => {
    it("writes provider settings without overwriting other providers", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          theme: "dark",
          providers: {
            codex: { lastUsedModel: "gpt-5.2-codex" },
          },
        }),
      );
      const { setProviderSettings } = await import(
        "../settings/settings.store"
      );
      setProviderSettings("claude-code", { lastUsedModel: "claude-sonnet-4-6" });

      const written = JSON.parse(
        (mockWriteFileSync.mock.calls[0][1] as string),
      );
      expect(written.providers["claude-code"]).toEqual({
        lastUsedModel: "claude-sonnet-4-6",
      });
      // codex must be preserved
      expect(written.providers["codex"]).toEqual({
        lastUsedModel: "gpt-5.2-codex",
      });
    });

    it("performs a partial update without overwriting sibling keys", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          providers: {
            "claude-code": {
              lastUsedModel: "claude-opus-4-6",
              lastUsedEffort: "high",
            },
          },
        }),
      );
      const { setProviderSettings } = await import(
        "../settings/settings.store"
      );
      setProviderSettings("claude-code", { lastUsedModel: "claude-sonnet-4-6" });

      const written = JSON.parse(
        (mockWriteFileSync.mock.calls[0][1] as string),
      );
      expect(written.providers["claude-code"]).toEqual({
        lastUsedModel: "claude-sonnet-4-6",
        lastUsedEffort: "high", // must be preserved
      });
    });

    it("initializes providers from scratch when key is absent (first-launch write path)", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ theme: "dark" }));
      const { setProviderSettings } = await import(
        "../settings/settings.store"
      );
      setProviderSettings("claude-code", { lastUsedModel: "claude-sonnet-4-6" });

      const written = JSON.parse(
        (mockWriteFileSync.mock.calls[0][1] as string),
      );
      expect(written.providers).toEqual({
        "claude-code": { lastUsedModel: "claude-sonnet-4-6" },
      });
    });

    it("round-trip: written value is readable by getProviderSettings", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ theme: "dark" }));

      const { setProviderSettings, getProviderSettings } = await import(
        "../settings/settings.store"
      );

      setProviderSettings("claude-code", {
        lastUsedModel: "claude-sonnet-4-6",
        lastUsedEffort: "medium",
      });

      const written = mockWriteFileSync.mock.calls[0][1] as string;
      mockReadFileSync.mockReturnValue(written);

      expect(getProviderSettings("claude-code")).toEqual({
        lastUsedModel: "claude-sonnet-4-6",
        lastUsedEffort: "medium",
      });
    });
  });

  describe("updateSettings deep merge", () => {
    it("deep-merges providers key without erasing other providers", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          theme: "dark",
          providers: {
            codex: { lastUsedModel: "gpt-5.2-codex" },
          },
        }),
      );
      const { updateSettings } = await import("../settings/settings.store");
      updateSettings({
        providers: { "claude-code": { lastUsedModel: "claude-sonnet-4-6" } },
      });

      const written = JSON.parse(
        (mockWriteFileSync.mock.calls[0][1] as string),
      );
      expect(written.providers["codex"]).toEqual({
        lastUsedModel: "gpt-5.2-codex",
      });
      expect(written.providers["claude-code"]).toEqual({
        lastUsedModel: "claude-sonnet-4-6",
      });
    });
  });
});
