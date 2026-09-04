import { describe, it, expect } from "vitest";
import { SteerQueue } from "../utils/steer-queue";

/** Collect from an async generator without blocking the test forever. */
function collect<T>(gen: AsyncGenerator<T>, sink: T[]): Promise<void> {
  return (async () => {
    for await (const item of gen) sink.push(item);
  })();
}

/** Let pending microtasks/timers settle. */
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("SteerQueue", () => {
  it("yields items pushed after draining has started", async () => {
    const q = new SteerQueue<string>();
    const seen: string[] = [];
    const done = collect(q.drain(), seen);

    q.push("first");
    await tick();
    expect(seen).toEqual(["first"]);

    q.push("second");
    await tick();
    expect(seen).toEqual(["first", "second"]);

    q.close();
    await done;
  });

  it("preserves FIFO order across a burst", async () => {
    const q = new SteerQueue<number>();
    const seen: number[] = [];
    const done = collect(q.drain(), seen);

    for (const n of [1, 2, 3, 4, 5]) q.push(n);
    q.close();
    await done;

    expect(seen).toEqual([1, 2, 3, 4, 5]);
  });

  it("does NOT complete while the queue is open and empty", async () => {
    // This is the stdin-EOF guarantee: if drain() returned here, the SDK would
    // close the CLI's stdin mid-turn and every later can_use_tool would fail
    // with "Stream closed".
    const q = new SteerQueue<string>();
    let finished = false;
    const done = collect(q.drain(), []).then(() => {
      finished = true;
    });

    await tick();
    await tick();
    expect(finished).toBe(false);

    q.close();
    await done;
    expect(finished).toBe(true);
  });

  it("drains items pushed in the same tick as close()", async () => {
    const q = new SteerQueue<string>();
    const seen: string[] = [];
    const done = collect(q.drain(), seen);
    await tick();

    q.push("late");
    q.close();
    await done;

    expect(seen).toEqual(["late"]);
  });

  it("rejects pushes after close and reports isOpen", () => {
    const q = new SteerQueue<string>();
    expect(q.isOpen).toBe(true);
    expect(q.push("ok")).toBe(true);
    expect(q.pending).toBe(1);

    q.close();
    expect(q.isOpen).toBe(false);
    expect(q.push("too late")).toBe(false);
    expect(q.pending).toBe(1);
  });

  it("is idempotent on repeated close()", async () => {
    const q = new SteerQueue<string>();
    const done = collect(q.drain(), []);
    q.close();
    q.close();
    await expect(done).resolves.toBeUndefined();
  });
});
