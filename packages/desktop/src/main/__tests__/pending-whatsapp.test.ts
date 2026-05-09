import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  enqueuePendingWhatsApp,
  drainPendingWhatsApp,
  pendingWhatsAppSize,
} from "../integrations/pending-whatsapp";

describe("pending-whatsapp queue", () => {
  let tmp: string;
  let origHome: string | undefined;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "stratos-pending-wa-"));
    origHome = process.env.HOME;
    process.env.HOME = tmp;
  });

  afterEach(() => {
    if (origHome !== undefined) process.env.HOME = origHome;
    else delete process.env.HOME;
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
  });

  it("starts empty", () => {
    expect(pendingWhatsAppSize()).toBe(0);
  });

  it("enqueues a message and persists it to disk", () => {
    enqueuePendingWhatsApp("hello");
    expect(pendingWhatsAppSize()).toBe(1);
    const path = join(tmp, ".stratos", "manager", "pending-whatsapp.json");
    expect(existsSync(path)).toBe(true);
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    expect(raw).toHaveLength(1);
    expect(raw[0].text).toBe("hello");
    expect(typeof raw[0].enqueuedAt).toBe("number");
  });

  it("preserves FIFO order across multiple enqueues", () => {
    enqueuePendingWhatsApp("first");
    enqueuePendingWhatsApp("second");
    enqueuePendingWhatsApp("third");
    expect(pendingWhatsAppSize()).toBe(3);
    const sent: string[] = [];
    return drainPendingWhatsApp(async (text) => {
      sent.push(text);
    }).then(() => {
      expect(sent).toEqual(["first", "second", "third"]);
      expect(pendingWhatsAppSize()).toBe(0);
    });
  });

  it("caps at MAX_ENTRIES (20) and drops the oldest", () => {
    for (let i = 0; i < 25; i++) {
      enqueuePendingWhatsApp(`msg-${i}`);
    }
    expect(pendingWhatsAppSize()).toBe(20);
    const sent: string[] = [];
    return drainPendingWhatsApp(async (text) => {
      sent.push(text);
    }).then(() => {
      // The 5 oldest (msg-0..msg-4) were dropped on overflow.
      expect(sent[0]).toBe("msg-5");
      expect(sent[sent.length - 1]).toBe("msg-24");
      expect(sent).toHaveLength(20);
    });
  });

  it("leaves remaining entries in the queue if send throws mid-drain", async () => {
    enqueuePendingWhatsApp("a");
    enqueuePendingWhatsApp("b");
    enqueuePendingWhatsApp("c");
    let count = 0;
    await expect(
      drainPendingWhatsApp(async (_text) => {
        count++;
        if (count === 2) throw new Error("simulated failure");
      }),
    ).rejects.toThrow("simulated failure");
    // First was sent and removed; second failed mid-flight (still in queue).
    expect(pendingWhatsAppSize()).toBe(2);
  });

  it("drain on an empty queue is a no-op", async () => {
    let calls = 0;
    await drainPendingWhatsApp(async () => {
      calls++;
    });
    expect(calls).toBe(0);
  });

  it("survives a corrupt JSON file by treating it as empty", () => {
    enqueuePendingWhatsApp("first");
    const path = join(tmp, ".stratos", "manager", "pending-whatsapp.json");
    writeFileSync(path, "{ this is not json", "utf-8");
    expect(pendingWhatsAppSize()).toBe(0);
    enqueuePendingWhatsApp("after-corruption");
    expect(pendingWhatsAppSize()).toBe(1);
  });
});
