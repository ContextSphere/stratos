/**
 * A pending fire-and-forget wakeup queued by the Claude Code `ScheduleWakeup`
 * tool. The tool is the built-in companion to the `/loop` skill's dynamic
 * pacing mode: the model picks how long to wait, then a saved prompt fires
 * back into the same thread at the chosen time.
 *
 * In the bundled Claude Code CLI, firing is owned by an Ink/React poller that
 * Stratos never mounts (SDK streaming mode is non-interactive). Stratos owns
 * the equivalent timer host-side so wakeups survive the subprocess lifecycle.
 */
export interface LoopWakeup {
  id: string;
  threadId: string;
  /** Prompt to resubmit when the timer fires (verbatim — sentinel resolution
   *  is the responsibility of whoever submits the prompt). */
  prompt: string;
  /** Optional one-line model-supplied reason; surfaced in logs only. */
  reason?: string;
  /** Epoch ms when the wakeup should fire. */
  fireAt: number;
  /** Epoch ms when the wakeup was registered. */
  createdAt: number;
}

/** Lower bound on delay (seconds), mirrors the Claude Code CLI's clamp. */
export const MIN_LOOP_DELAY_SECONDS = 60;
/** Upper bound on delay (seconds), mirrors the Claude Code CLI's clamp. */
export const MAX_LOOP_DELAY_SECONDS = 3600;

/** Clamp a model-supplied delay to the runtime's allowed range, matching the
 *  bundled CLI's behavior (NaN/-Infinity → min, +Infinity → max). */
export function clampLoopDelaySeconds(delaySeconds: number): {
  clamped: number;
  wasClamped: boolean;
} {
  let n: number;
  if (Number.isNaN(delaySeconds)) n = MIN_LOOP_DELAY_SECONDS;
  else if (delaySeconds === Infinity) n = MAX_LOOP_DELAY_SECONDS;
  else if (delaySeconds === -Infinity) n = MIN_LOOP_DELAY_SECONDS;
  else n = Math.round(delaySeconds);

  const clamped = Math.max(
    MIN_LOOP_DELAY_SECONDS,
    Math.min(MAX_LOOP_DELAY_SECONDS, n),
  );
  const wasClamped = !Number.isFinite(delaySeconds) || n !== clamped;
  return { clamped, wasClamped };
}
