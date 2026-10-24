import { safeStorage } from "electron";

const UNAVAILABLE_MESSAGE =
  "Secure credential storage is unavailable. Restart Stratos after unlocking your system keychain.";

export function encryptSecret(value: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(UNAVAILABLE_MESSAGE);
  }
  return safeStorage.encryptString(value).toString("base64");
}

export function decryptSecret(value: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(UNAVAILABLE_MESSAGE);
  }
  try {
    return safeStorage.decryptString(Buffer.from(value, "base64"));
  } catch {
    throw new Error(
      "The saved provider credential could not be decrypted. Remove it and add the credential again.",
    );
  }
}
