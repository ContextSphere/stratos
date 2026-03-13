import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { FileStorageAdapter } from "../storage/file-adapter";
import type { StoredMessage } from "../types/thread";

describe("FileStorageAdapter", () => {
  let tmpDir: string;
  let adapter: FileStorageAdapter;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "stratos-test-"));
    adapter = new FileStorageAdapter(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("createThread", () => {
    it("creates a thread with default title", () => {
      const thread = adapter.createThread();
      expect(thread.id).toMatch(/^[a-z]+-[a-z]+$/);
      expect(thread.title).toBe("New chat");
      expect(thread.createdAt).toBeTypeOf("number");
      expect(thread.updatedAt).toBeTypeOf("number");
    });

    it("creates a thread with custom title, model, cwd", () => {
      const thread = adapter.createThread("My Title", "claude-3", "/tmp");
      expect(thread.title).toBe("My Title");
      expect(thread.model).toBe("claude-3");
      expect(thread.cwd).toBe("/tmp");
    });

    it("sets newly created thread as active", () => {
      const thread = adapter.createThread();
      expect(adapter.getActiveThreadId()).toBe(thread.id);
    });
  });

  describe("listThreads", () => {
    it("returns empty array when no threads exist", () => {
      expect(adapter.listThreads()).toEqual([]);
    });

    it("returns threads sorted by createdAt descending", () => {
      const t1 = adapter.createThread("First");
      adapter.updateThread(t1.id, { createdAt: 1000 });
      const t2 = adapter.createThread("Second");
      adapter.updateThread(t2.id, { createdAt: 2000 });
      const list = adapter.listThreads();
      expect(list[0].title).toBe("Second");
      expect(list[1].title).toBe("First");
    });
  });

  describe("getThread", () => {
    it("returns null for non-existent thread", () => {
      expect(adapter.getThread("nope")).toBeNull();
    });

    it("returns the thread by id", () => {
      const created = adapter.createThread("Test");
      const found = adapter.getThread(created.id);
      expect(found).not.toBeNull();
      expect(found!.title).toBe("Test");
    });
  });

  describe("updateThread", () => {
    it("returns null for non-existent thread", () => {
      expect(adapter.updateThread("nope", { title: "x" })).toBeNull();
    });

    it("updates thread fields and bumps updatedAt", () => {
      const thread = adapter.createThread("Old");
      const updated = adapter.updateThread(thread.id, { title: "New" });
      expect(updated!.title).toBe("New");
      expect(updated!.updatedAt).toBeGreaterThanOrEqual(thread.updatedAt);
    });
  });

  describe("deleteThread", () => {
    it("returns false for non-existent thread", () => {
      expect(adapter.deleteThread("nope")).toBe(false);
    });

    it("removes the thread", () => {
      const thread = adapter.createThread();
      expect(adapter.deleteThread(thread.id)).toBe(true);
      expect(adapter.getThread(thread.id)).toBeNull();
    });

    it("resets activeThreadId when deleting active thread", () => {
      const t1 = adapter.createThread("A");
      const t2 = adapter.createThread("B");
      // t2 is active
      adapter.deleteThread(t2.id);
      expect(adapter.getActiveThreadId()).toBe(t1.id);
    });

    it("sets activeThreadId to null when deleting the last thread", () => {
      const t = adapter.createThread();
      adapter.deleteThread(t.id);
      expect(adapter.getActiveThreadId()).toBeNull();
    });
  });

  describe("getActiveThreadId / setActiveThreadId", () => {
    it("returns null initially", () => {
      expect(adapter.getActiveThreadId()).toBeNull();
    });

    it("persists the active thread id", () => {
      adapter.createThread();
      const t2 = adapter.createThread();
      adapter.setActiveThreadId(t2.id);
      expect(adapter.getActiveThreadId()).toBe(t2.id);
    });

    it("can be set to null", () => {
      adapter.createThread();
      adapter.setActiveThreadId(null);
      expect(adapter.getActiveThreadId()).toBeNull();
    });
  });

  describe("saveMessages / loadMessages", () => {
    it("saveMessages is a no-op", () => {
      const thread = adapter.createThread();
      const msgs: StoredMessage[] = [
        { id: "m1", role: "user", content: "Hello", timestamp: Date.now() },
      ];
      // Should not throw and return undefined
      expect(adapter.saveMessages(thread.id, msgs)).toBeUndefined();
    });

    it("loadMessages returns empty array for thread with no sessionId", async () => {
      const thread = adapter.createThread();
      expect(await adapter.loadMessages(thread.id)).toEqual([]);
    });

    it("loadMessages returns empty array for unknown threadId", async () => {
      expect(await adapter.loadMessages("nonexistent")).toEqual([]);
    });
  });

  describe("clearPersistedSessionId", () => {
    it("removes sessionId from the thread", () => {
      const thread = adapter.createThread();
      adapter.updateThread(thread.id, { sessionId: "sess_abc" });
      const withSession = adapter.getThread(thread.id);
      expect(withSession!.sessionId).toBe("sess_abc");

      adapter.clearPersistedSessionId(thread.id);
      const cleared = adapter.getThread(thread.id);
      expect(cleared!.sessionId).toBeUndefined();
    });

    it("is a no-op for a non-existent thread", () => {
      expect(() =>
        adapter.clearPersistedSessionId("does-not-exist"),
      ).not.toThrow();
    });

    it("bumps updatedAt when clearing sessionId", () => {
      const thread = adapter.createThread();
      adapter.updateThread(thread.id, { sessionId: "sess_xyz" });
      const before = adapter.getThread(thread.id)!.updatedAt;

      adapter.clearPersistedSessionId(thread.id);
      const after = adapter.getThread(thread.id)!.updatedAt;
      expect(after).toBeGreaterThanOrEqual(before);
    });
  });
});
