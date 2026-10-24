import { beforeEach, describe, expect, it, vi } from "vitest";

const { safeStorage } = vi.hoisted(() => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(),
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  },
}));

vi.mock("electron", () => ({ safeStorage }));

describe("secure-storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    safeStorage.isEncryptionAvailable.mockReturnValue(true);
  });

  it("round-trips values as base64-encoded encrypted bytes", async () => {
    safeStorage.encryptString.mockReturnValue(Buffer.from("ciphertext"));
    safeStorage.decryptString.mockReturnValue("secret");
    const { decryptSecret, encryptSecret } =
      await import("../settings/secure-storage");

    const encrypted = encryptSecret("secret");
    expect(encrypted).toBe(Buffer.from("ciphertext").toString("base64"));
    expect(decryptSecret(encrypted)).toBe("secret");
    expect(safeStorage.encryptString).toHaveBeenCalledWith("secret");
  });

  it("fails explicitly when system encryption is unavailable", async () => {
    safeStorage.isEncryptionAvailable.mockReturnValue(false);
    const { encryptSecret } = await import("../settings/secure-storage");

    expect(() => encryptSecret("secret")).toThrow(
      "Secure credential storage is unavailable",
    );
  });

  it("returns an actionable error for undecryptable values", async () => {
    safeStorage.decryptString.mockImplementation(() => {
      throw new Error("keychain failure");
    });
    const { decryptSecret } = await import("../settings/secure-storage");

    expect(() => decryptSecret("invalid")).toThrow("could not be decrypted");
  });
});
