import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { clearAuthDir } from "./client";

describe("clearAuthDir", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "stratos-gateway-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("wipes every file in the directory", () => {
    writeFileSync(join(dir, "creds.json"), "{}");
    writeFileSync(join(dir, "lid-mapping-15551234567.json"), "{}");
    writeFileSync(join(dir, "session-1.json"), "{}");
    expect(readdirSync(dir)).toHaveLength(3);

    clearAuthDir(dir);

    expect(readdirSync(dir)).toHaveLength(0);
    expect(existsSync(dir)).toBe(true);
  });

  it("is a no-op when the directory does not exist", () => {
    const missing = join(dir, "does-not-exist");
    expect(() => clearAuthDir(missing)).not.toThrow();
  });

  it("handles an empty directory", () => {
    clearAuthDir(dir);
    expect(readdirSync(dir)).toHaveLength(0);
  });

  it("only touches the given directory, not subdirectories", () => {
    const sub = join(dir, "nested");
    mkdirSync(sub);
    writeFileSync(join(sub, "keep.json"), "{}");
    writeFileSync(join(dir, "wipe.json"), "{}");

    clearAuthDir(dir);

    expect(readdirSync(dir)).toEqual(["nested"]);
    expect(readdirSync(sub)).toEqual(["keep.json"]);
  });
});
