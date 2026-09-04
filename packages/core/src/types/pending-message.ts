/**
 * A message the user typed while a turn was already running.
 *
 * Three delivery intents exist, and they differ in what happens to the turn
 * that is currently in flight:
 *
 *  - `queue` — the running turn finishes untouched; the message becomes the
 *    next turn. Expresses a new task ("next, write the tests").
 *  - `steer` — the running turn keeps going and the message is injected into
 *    it at the provider's next safe boundary. Expresses a correction to the
 *    work in progress ("actually use the v2 API").
 *  - `break` — the running turn is interrupted and the message is sent
 *    immediately as a fresh turn. Expresses "stop, wrong direction."
 *
 * Only `queue` and `break` produce a PendingMessage that lives long enough to
 * be shown in the UI: a successful `steer` is delivered straight into the live
 * turn and never enters the queue. A `steer` that could not be honoured (no
 * live turn, or a provider without mid-turn support) degrades to `queue` with
 * `fellBack` set, so the UI can say so rather than silently changing meaning.
 */
export type PendingDelivery = "queue" | "steer" | "break";

export interface PendingMessage {
  id: string;
  threadId: string;
  prompt: string;
  images?: { dataUrl: string; mimeType: string }[];
  /** What the user asked for. */
  requested: PendingDelivery;
  /** True when a `steer` intent had to be queued instead. */
  fellBack: boolean;
  /**
   * Deliver this even if the turn ended via user interrupt. Set for `break`,
   * where interrupting is the point; a plain queued message is intentionally
   * dropped on interrupt so Stop means stop.
   */
  force: boolean;
  createdAt: number;
}

/** Outcome of asking the manager to deliver a message mid-turn. */
export interface EnqueueResult {
  /**
   * - `sent` — no turn was running, so it started one immediately.
   * - `steered` — injected into the live turn.
   * - `queued` — parked for delivery at the next turn boundary.
   */
  status: "sent" | "steered" | "queued";
  /** Present when status is `queued`; identifies the pending entry. */
  id?: string;
  /** True when a steer intent degraded to a queue. */
  fellBack: boolean;
}

/** Hard cap on queued messages per thread, mirroring ManagerSession's policy. */
export const MAX_PENDING_PER_THREAD = 10;
