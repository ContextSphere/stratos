/**
 * Transient in-memory store for agent-authored summaries deposited via the
 * `schedule_report` MCP tool. The scheduler reads from this when a run
 * completes and includes the summary in the Manager notification.
 *
 * Entries are keyed by scheduleId. The scheduler clears the entry after
 * consuming it, so a stale summary from a prior run cannot leak into a
 * later run of the same schedule.
 */

interface PendingReport {
  summary: string;
  depositedAt: number;
}

const pending = new Map<string, PendingReport>();

export function depositReport(scheduleId: string, summary: string): void {
  pending.set(scheduleId, { summary, depositedAt: Date.now() });
}

/** Read and remove the pending summary for a schedule. */
export function consumeReport(scheduleId: string): PendingReport | undefined {
  const entry = pending.get(scheduleId);
  if (entry) pending.delete(scheduleId);
  return entry;
}

/** Discard any pending summary without consuming. Used when a run is cancelled. */
export function clearReport(scheduleId: string): void {
  pending.delete(scheduleId);
}
