import { describe, it, expect } from "vitest";
import { shouldNotifyManager } from "../scheduler/notify-policy";
import type { ScheduleNotifyMode } from "@stratosapp/core";

describe("shouldNotifyManager", () => {
  describe("uses per-schedule notify when set", () => {
    it("'always' fires for both completed and error", () => {
      expect(shouldNotifyManager("always", "errors-only", "completed")).toBe(
        true,
      );
      expect(shouldNotifyManager("always", "errors-only", "error")).toBe(true);
    });

    it("'errors-only' fires only on error", () => {
      expect(shouldNotifyManager("errors-only", "always", "completed")).toBe(
        false,
      );
      expect(shouldNotifyManager("errors-only", "always", "error")).toBe(true);
    });

    it("'never' suppresses both", () => {
      expect(shouldNotifyManager("never", "always", "completed")).toBe(false);
      expect(shouldNotifyManager("never", "always", "error")).toBe(false);
    });

    it("per-schedule overrides the global default in both directions", () => {
      // Quiet schedule against a chatty global
      expect(shouldNotifyManager("never", "always", "error")).toBe(false);
      // Chatty schedule against a quiet global
      expect(shouldNotifyManager("always", "never", "completed")).toBe(true);
    });
  });

  describe("falls back to the global default when notify is undefined", () => {
    it("uses 'always' default", () => {
      expect(shouldNotifyManager(undefined, "always", "completed")).toBe(true);
      expect(shouldNotifyManager(undefined, "always", "error")).toBe(true);
    });

    it("uses 'errors-only' default", () => {
      expect(shouldNotifyManager(undefined, "errors-only", "completed")).toBe(
        false,
      );
      expect(shouldNotifyManager(undefined, "errors-only", "error")).toBe(true);
    });

    it("uses 'never' default", () => {
      expect(shouldNotifyManager(undefined, "never", "completed")).toBe(false);
      expect(shouldNotifyManager(undefined, "never", "error")).toBe(false);
    });
  });

  it("matrix sweep: every (notify × global × status) combination", () => {
    const modes: (ScheduleNotifyMode | undefined)[] = [
      "always",
      "errors-only",
      "never",
      undefined,
    ];
    const globals: ScheduleNotifyMode[] = ["always", "errors-only", "never"];
    const statuses: Array<"completed" | "error"> = ["completed", "error"];

    for (const notify of modes) {
      for (const global of globals) {
        for (const status of statuses) {
          const effective = notify ?? global;
          const expected =
            effective === "never"
              ? false
              : effective === "errors-only"
                ? status === "error"
                : true;
          expect(shouldNotifyManager(notify, global, status)).toBe(expected);
        }
      }
    }
  });
});
