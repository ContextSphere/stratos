/**
 * Messages the user typed while a turn was still running, shown between the
 * transcript and the composer.
 *
 * A message that disappears into a buffer with no visual confirmation is worse
 * than an input that refused it outright, so every queued entry is visible and
 * carries its own escape hatches: cancel it, steer it into the running turn, or
 * break — interrupt the turn and send it now.
 */
export interface PendingMessageView {
  id: string;
  prompt: string;
  images?: { dataUrl: string; mimeType: string }[];
  /** True when a steer intent had to be queued instead (provider can't steer). */
  fellBack: boolean;
  /** True for `break` entries, which survive an interrupt. */
  force: boolean;
}

interface Props {
  pending: PendingMessageView[];
  /** Whether a turn is currently running — steer/break only make sense then. */
  isStreaming: boolean;
  onCancel: (id: string) => void;
  onPromote: (id: string, to: "steer" | "break") => void;
  onEdit: (message: PendingMessageView) => void;
}

export function PendingMessages({
  pending,
  isStreaming,
  onCancel,
  onPromote,
  onEdit,
}: Props) {
  if (pending.length === 0) return null;

  return (
    <div
      className="flex flex-col gap-1.5 pt-1"
      data-testid="pending-messages"
      aria-label="Pending messages"
    >
      {pending.map((msg) => (
        <div
          key={msg.id}
          data-testid="pending-message"
          className="flex items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-xs"
        >
          <span
            className={`mt-[3px] flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
              msg.force
                ? "bg-red-950/60 text-red-300"
                : "bg-[var(--bg-surface)] text-[var(--text-muted)]"
            }`}
          >
            {msg.force ? "interrupt" : "queued"}
          </span>

          <div className="min-w-0 flex-1">
            <p className="truncate text-[var(--text-secondary)]">
              {msg.prompt}
            </p>
            {(msg.images?.length ?? 0) > 0 && (
              <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                {msg.images!.length} image{msg.images!.length === 1 ? "" : "s"}
              </p>
            )}
            {msg.fellBack && (
              <p className="mt-0.5 text-[11px] text-yellow-500/80">
                Couldn&apos;t steer. Queued for the next turn.
              </p>
            )}
          </div>

          <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-1">
            <button
              onClick={() => onEdit(msg)}
              className="rounded px-1.5 py-0.5 text-[11px] text-[var(--text-muted)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500"
              title="Edit this queued message"
            >
              Edit
            </button>
            {isStreaming && !msg.fellBack && (
              <button
                onClick={() => onPromote(msg.id, "steer")}
                className="rounded px-1.5 py-0.5 text-[11px] text-[var(--text-muted)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500"
                title="Send into the running turn now"
              >
                Steer now
              </button>
            )}
            {isStreaming && (
              <button
                onClick={() => onPromote(msg.id, "break")}
                className="rounded px-1.5 py-0.5 text-[11px] text-[var(--text-muted)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500"
                title="Interrupt the current turn and send this now"
              >
                Interrupt
              </button>
            )}
            <button
              onClick={() => onCancel(msg.id)}
              className="rounded px-1.5 py-0.5 text-[11px] text-[var(--text-muted)] hover:bg-[var(--bg-surface)] hover:text-red-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500"
              title="Remove from queue"
              aria-label="Cancel queued message"
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
