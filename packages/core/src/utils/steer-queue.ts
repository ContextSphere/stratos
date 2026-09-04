/**
 * An async queue that feeds a streaming-input prompt generator.
 *
 * The Claude Agent SDK's streaming-input mode consumes an AsyncIterable of
 * user messages. Two properties matter and they pull in opposite directions:
 *
 *  1. Additional user messages can be pushed into a turn that is already
 *     running (mid-turn steering) — the CLI picks them up at its next
 *     inference step.
 *  2. The generator must NOT complete while the turn is live. The SDK's
 *     transport calls `stdin.end()` on the CLI subprocess as soon as the
 *     prompt generator is exhausted; the CLI then sets `inputClosed=true` and
 *     every subsequent control_request (notably `can_use_tool`) fails with
 *     "Tool permission request failed: Error: Stream closed".
 *
 * `drain()` satisfies both: it yields queued items as they arrive and parks on
 * a promise when empty, only returning once `close()` is called explicitly at
 * end-of-turn.
 */
export class SteerQueue<T> {
  private items: T[] = [];
  private wake?: () => void;
  private closed = false;

  /** True until close() is called. Used to reject pushes onto a dead turn. */
  get isOpen(): boolean {
    return !this.closed;
  }

  /** Number of items pushed but not yet yielded by drain(). */
  get pending(): number {
    return this.items.length;
  }

  /**
   * Queue an item for delivery into the running turn.
   * Returns false if the queue is already closed (turn is over).
   */
  push(item: T): boolean {
    if (this.closed) return false;
    this.items.push(item);
    this.wake?.();
    this.wake = undefined;
    return true;
  }

  /**
   * Allow drain() to finish. Must be called exactly once per turn, from the
   * consuming loop's `finally`, so the SDK tears the transport down cleanly.
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.wake?.();
    this.wake = undefined;
  }

  /**
   * Yield items as they are pushed. Parks while empty; returns only after
   * close(). Any items pushed before close() are drained first, so a message
   * queued in the same tick as completion is never silently dropped.
   */
  async *drain(): AsyncGenerator<T> {
    for (;;) {
      while (this.items.length > 0) {
        yield this.items.shift()!;
      }
      if (this.closed) return;
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
    }
  }
}
