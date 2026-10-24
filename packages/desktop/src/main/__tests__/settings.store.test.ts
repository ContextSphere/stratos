import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "fs";

vi.mock("fs");
vi.mock("os", () => ({ homedir: () => "/mock-home" }));
vi.mock("../settings/secure-storage", () => ({
  encryptSecret: vi.fn((value: string) =>
    Buffer.from(`encrypted:${value}`).toString("base64"),
  ),
  decryptSecret: vi.fn((value: string) => {
    const decoded = Buffer.from(value, "base64").toString("utf-8");
    return decoded.replace(/^encrypted:/, "");
  }),
}));

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFileSync = vi.mocked(writeFileSync);

describe("settings.store", () => {
  afterEach(() => vi.unstubAllEnvs());

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockExistsSync.mockReturnValue(false);
  });

  it("keeps an isolated preview's reads and writes out of the global settings", async () => {
    vi.stubEnv("STRATOS_SETTINGS_DIR", "/tmp/stratos-preview-settings");
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ managerEnabled: false }));
    const { updateSettings } = await import("../settings/settings.store");
    updateSettings({ theme: "light" });
    expect(mockReadFileSync).toHaveBeenCalledWith(
      "/tmp/stratos-preview-settings/app-settings.json",
      "utf-8",
    );
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      "/tmp/stratos-preview-settings/app-settings.json",
      expect.stringContaining('"managerEnabled": false'),
      "utf-8",
    );
  });

  describe("getProviderSettings", () => {
    it("returns {} for unknown provider when no settings file exists", async () => {
      const { getProviderSettings } =
        await import("../settings/settings.store");
      expect(getProviderSettings("claude-code")).toEqual({});
    });

    it("returns saved provider settings", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          theme: "dark",
          providers: {
            "claude-code": {
              lastUsedModel: "claude-sonnet-4-6",
              lastUsedEffort: "medium",
            },
          },
        }),
      );
      const { getProviderSettings } =
        await import("../settings/settings.store");
      expect(getProviderSettings("claude-code")).toEqual({
        lastUsedModel: "claude-sonnet-4-6",
        lastUsedEffort: "medium",
      });
    });

    it("returns {} when providers key is missing", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ theme: "dark" }));
      const { getProviderSettings } =
        await import("../settings/settings.store");
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
      const { setProviderSettings } =
        await import("../settings/settings.store");
      setProviderSettings("claude-code", {
        lastUsedModel: "claude-sonnet-4-6",
      });

      const written = JSON.parse(mockWriteFileSync.mock.calls[0][1] as string);
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
      const { setProviderSettings } =
        await import("../settings/settings.store");
      setProviderSettings("claude-code", {
        lastUsedModel: "claude-sonnet-4-6",
      });

      const written = JSON.parse(mockWriteFileSync.mock.calls[0][1] as string);
      expect(written.providers["claude-code"]).toEqual({
        lastUsedModel: "claude-sonnet-4-6",
        lastUsedEffort: "high", // must be preserved
      });
    });

    it("initializes providers from scratch when key is absent (first-launch write path)", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ theme: "dark" }));
      const { setProviderSettings } =
        await import("../settings/settings.store");
      setProviderSettings("claude-code", {
        lastUsedModel: "claude-sonnet-4-6",
      });

      const written = JSON.parse(mockWriteFileSync.mock.calls[0][1] as string);
      expect(written.providers).toEqual({
        "claude-code": { lastUsedModel: "claude-sonnet-4-6" },
      });
    });

    it("round-trip: written value is readable by getProviderSettings", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ theme: "dark" }));

      const { setProviderSettings, getProviderSettings } =
        await import("../settings/settings.store");

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

  describe("opencodeEnabledModels", () => {
    it("returns default allowlist as empty-array entries when no settings file exists", async () => {
      const { getOpencodeEnabledModels } =
        await import("../settings/settings.store");
      expect(getOpencodeEnabledModels()).toEqual({
        anthropic: [],
        openai: [],
      });
    });

    it("migrates legacy opencodeModelAllowlist to enabled-models map (empty arrays)", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          opencodeModelAllowlist: ["anthropic", "groq"],
        }),
      );
      const { getOpencodeEnabledModels } =
        await import("../settings/settings.store");
      expect(getOpencodeEnabledModels()).toEqual({
        anthropic: [],
        groq: [],
      });
    });

    it("setOpencodeEnabledModels writes both enabled map and legacy allowlist mirror", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({}));
      const { setOpencodeEnabledModels } =
        await import("../settings/settings.store");
      setOpencodeEnabledModels("anthropic", [
        "anthropic/claude-opus-4",
        "anthropic/claude-sonnet-4",
      ]);
      const written = JSON.parse(mockWriteFileSync.mock.calls[0][1] as string);
      expect(written.opencodeEnabledModels).toEqual({
        anthropic: ["anthropic/claude-opus-4", "anthropic/claude-sonnet-4"],
      });
      expect(written.opencodeModelAllowlist).toEqual(["anthropic"]);
    });

    it("setOpencodeEnabledModels with empty array removes the provider", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          opencodeEnabledModels: {
            anthropic: ["anthropic/x"],
            openai: ["openai/y"],
          },
        }),
      );
      const { setOpencodeEnabledModels } =
        await import("../settings/settings.store");
      setOpencodeEnabledModels("anthropic", []);
      const written = JSON.parse(mockWriteFileSync.mock.calls[0][1] as string);
      expect(written.opencodeEnabledModels).toEqual({
        openai: ["openai/y"],
      });
    });

    it("disableOpencodeProvider archives and removes", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          opencodeEnabledModels: {
            anthropic: ["anthropic/claude-opus"],
          },
        }),
      );
      const { disableOpencodeProvider } =
        await import("../settings/settings.store");
      disableOpencodeProvider("anthropic");
      const written = JSON.parse(mockWriteFileSync.mock.calls[0][1] as string);
      expect(written.opencodeEnabledModels).toEqual({});
      expect(written.opencodeEnabledModelsArchive).toEqual({
        anthropic: ["anthropic/claude-opus"],
      });
    });

    it("clearOpencodeProvider wipes enabled and archive", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          opencodeEnabledModels: { anthropic: ["x"] },
          opencodeEnabledModelsArchive: { anthropic: ["y"] },
        }),
      );
      const { clearOpencodeProvider } =
        await import("../settings/settings.store");
      clearOpencodeProvider("anthropic");
      const written = JSON.parse(mockWriteFileSync.mock.calls[0][1] as string);
      expect(written.opencodeEnabledModels).toEqual({});
      expect(written.opencodeEnabledModelsArchive).toEqual({});
    });
  });

  describe("Opencode credential storage", () => {
    it("stores credentials encrypted and never writes the plaintext field", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({}));
      const { setOpencodeProviderKey } =
        await import("../settings/settings.store");

      setOpencodeProviderKey("openrouter", {
        apiKey: "test-openrouter-secret",
      });

      const written = JSON.parse(mockWriteFileSync.mock.calls[0][1] as string);
      expect(written.opencodeProviderKeys.openrouter).toEqual({
        encryptedApiKey: Buffer.from(
          "encrypted:test-openrouter-secret",
        ).toString("base64"),
        keyHint: "test…cret",
      });
      expect(mockWriteFileSync.mock.calls[0][1]).not.toContain(
        "test-openrouter-secret",
      );
    });

    it("migrates a legacy plaintext credential on first main-process read", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          opencodeProviderKeys: {
            openrouter: {
              apiKey: "legacy-openrouter-secret",
              baseURL: "https://router.example/v1",
            },
          },
        }),
      );
      const { getOpencodeProviderKeys } =
        await import("../settings/settings.store");

      expect(getOpencodeProviderKeys()).toEqual({
        openrouter: {
          apiKey: "legacy-openrouter-secret",
          baseURL: "https://router.example/v1",
        },
      });
      const written = JSON.parse(mockWriteFileSync.mock.calls[0][1] as string);
      expect(written.opencodeProviderKeys.openrouter.apiKey).toBeUndefined();
      expect(
        written.opencodeProviderKeys.openrouter.encryptedApiKey,
      ).toBeTruthy();
    });

    it("returns only redacted provider status to renderer callers", async () => {
      const encryptedApiKey = Buffer.from(
        "encrypted:test-openrouter-secret",
      ).toString("base64");
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          opencodeProviderKeys: {
            openrouter: {
              encryptedApiKey,
              keyHint: "test…cret",
            },
          },
        }),
      );
      const { getOpencodeProviderStatuses } =
        await import("../settings/settings.store");

      expect(getOpencodeProviderStatuses()).toEqual({
        openrouter: {
          configured: true,
          keyHint: "test…cret",
        },
      });
      expect(JSON.stringify(getOpencodeProviderStatuses())).not.toContain(
        "test-openrouter-secret",
      );
    });

    it("omits stored credentials from general renderer settings", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          theme: "dark",
          opencodeProviderKeys: {
            openrouter: { encryptedApiKey: "ciphertext" },
          },
        }),
      );
      const { getPublicSettings } = await import("../settings/settings.store");

      expect(getPublicSettings()).toEqual({
        theme: "dark",
        designVariant: "classic",
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

      const written = JSON.parse(mockWriteFileSync.mock.calls[0][1] as string);
      expect(written.providers["codex"]).toEqual({
        lastUsedModel: "gpt-5.2-codex",
      });
      expect(written.providers["claude-code"]).toEqual({
        lastUsedModel: "claude-sonnet-4-6",
      });
    });
  });
});
