import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PanelCard } from "./shared/PanelCard";
import type { ContextUsage } from "../bridges/types";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  usage: ContextUsage | null;
  /**
   * Bounding rect of the trigger button. When provided, the popover positions
   * itself relative to the trigger (above it, right-aligned). Falls back to a
   * fixed top-right position when null.
   */
  anchorRect?: DOMRect | null;
}

function fmt(tokens: number): string {
  if (tokens >= 1_000_000)
    return `${(tokens / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
  if (tokens >= 1_000)
    return `${(tokens / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return tokens.toLocaleString();
}

function pctOf(part: number, total: number): number {
  if (total <= 0) return 0;
  return (part / total) * 100;
}

interface Row {
  name: string;
  tokens: number;
  color: string;
  isDeferred?: boolean;
}

/**
 * The SDK reports semantic color tokens from Claude Code's TUI theme
 * (e.g. "claude", "warning", "promptBorder"). Map them to concrete CSS
 * colors that read well in both light and dark Stratos themes.
 */
const SDK_COLOR_MAP: Record<string, string> = {
  claude: "#d97757",
  warning: "#f59e0b",
  permission: "#3b82f6",
  inactive: "#6b7280",
  promptBorder: "var(--border)",
  purple_FOR_SUBAGENTS_ONLY: "#a855f7",
  success: "#10b981",
  error: "#ef4444",
};

function resolveColor(name: string, raw: string): string {
  if (name === "Free space") return "transparent";
  return SDK_COLOR_MAP[raw] ?? raw;
}

const POPOVER_GAP = 8;

export function ContextUsagePopover({
  isOpen,
  onClose,
  usage,
  anchorRect,
}: Props): React.ReactElement | null {
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClickOutside, true);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside, true);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, onClose]);

  const rows: Row[] = useMemo(() => {
    if (!usage) return [];
    // The SDK already includes a "Free space" category that fills the
    // unoccupied tail, so don't synthesize one. Just filter deferred entries
    // and zero-token rows, then sort largest-first while keeping Free space
    // at the end so the legend mirrors the stacked bar order.
    const visible = usage.categories.filter(
      (c) => c.tokens > 0 && !c.isDeferred,
    );
    const free = visible.find((c) => c.name === "Free space");
    const rest = visible
      .filter((c) => c.name !== "Free space")
      .sort((a, b) => b.tokens - a.tokens);
    return free ? [...rest, free] : rest;
  }, [usage]);

  // MCP tools come from the SDK as a flat list. Group by server so the user
  // sees which integration each tool belongs to.
  const mcpByServer = useMemo(() => {
    if (!usage?.mcpTools?.length) return [];
    const grouped = new Map<string, typeof usage.mcpTools>();
    for (const t of usage.mcpTools) {
      const list = grouped.get(t.serverName) ?? [];
      list.push(t);
      grouped.set(t.serverName, list);
    }
    return [...grouped.entries()]
      .map(([server, tools]) => ({
        server,
        tools: [...tools].sort((a, b) => b.tokens - a.tokens),
        totalTokens: tools.reduce((s, t) => s + t.tokens, 0),
      }))
      .sort((a, b) => b.totalTokens - a.totalTokens);
  }, [usage]);

  const mcpTotalTokens = useMemo(
    () => (usage?.mcpTools ?? []).reduce((s, t) => s + t.tokens, 0),
    [usage],
  );

  const [skillsOpen, setSkillsOpen] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);

  if (!isOpen || !usage) return null;

  const pct = Math.round(usage.percentage);
  const closeButton = (
    <button
      onClick={onClose}
      className="p-1 rounded hover:bg-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
      title="Close"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  );

  // autoCompactThreshold is reported in absolute tokens (e.g. 967_000 of a
  // 1M-token window), not as a 0–1 fraction. Convert to % of maxTokens.
  const thresholdPct =
    usage.autoCompactThreshold && usage.maxTokens > 0
      ? (usage.autoCompactThreshold / usage.maxTokens) * 100
      : null;

  // Position above the trigger button (popping up), right-aligned to it.
  // Clamps to the viewport so it never overflows. Falls back to top-right if
  // no anchor rect is supplied (older callers / SSR).
  const positionStyle = anchorRect
    ? (() => {
        const right = Math.max(
          POPOVER_GAP,
          window.innerWidth - anchorRect.right,
        );
        const bottom = Math.max(
          POPOVER_GAP,
          window.innerHeight - anchorRect.top + POPOVER_GAP,
        );
        return { right, bottom } as const;
      })()
    : { top: 80, right: 32 };

  return createPortal(
    <div
      ref={popoverRef}
      style={positionStyle}
      className="fixed z-30 w-[420px] max-w-[calc(100vw-2rem)] hidden md:block"
      data-testid="context-usage-popover"
    >
      <PanelCard
        title="Context Window"
        headerAction={closeButton}
        footer={
          <div className="flex items-center justify-between gap-2">
            <span>
              {fmt(usage.totalTokens)} / {fmt(usage.maxTokens)} tokens
            </span>
            <span className="text-[var(--text-faint)]">
              {usage.model || "—"}
            </span>
          </div>
        }
      >
        <div className="p-4 space-y-4">
          {/* Headline */}
          <div className="flex items-baseline justify-between">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold text-[var(--text-primary)] tabular-nums">
                {pct}%
              </span>
              <span className="text-xs text-[var(--text-muted)]">used</span>
            </div>
            {thresholdPct != null && usage.isAutoCompactEnabled && (
              <span
                className="text-[11px] text-[var(--text-muted)]"
                title={`Auto-compaction fires at ${thresholdPct.toFixed(0)}% of usable context`}
              >
                auto-compact @ {thresholdPct.toFixed(0)}%
              </span>
            )}
          </div>

          {/* Stacked bar */}
          <div className="relative">
            <div className="h-2.5 w-full rounded-full bg-[var(--border)] overflow-hidden flex">
              {rows.map((r, i) =>
                r.tokens > 0 ? (
                  <div
                    key={`${r.name}-${i}`}
                    className="h-full"
                    style={{
                      width: `${pctOf(r.tokens, usage.maxTokens)}%`,
                      backgroundColor: resolveColor(r.name, r.color),
                    }}
                  />
                ) : null,
              )}
            </div>
            {thresholdPct != null && usage.isAutoCompactEnabled && (
              <div
                className="absolute top-0 h-2.5 border-l border-[var(--text-faint)]"
                style={{ left: `${thresholdPct}%` }}
                title={`Auto-compact at ${thresholdPct.toFixed(0)}%`}
              />
            )}
          </div>

          {/* Category list */}
          <ul className="space-y-1.5 text-xs">
            {rows.map((r, i) => (
              <li
                key={`${r.name}-${i}-row`}
                className="flex items-center justify-between gap-2"
              >
                <span className="flex items-center gap-2 min-w-0 flex-1">
                  <span
                    className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                    style={{
                      backgroundColor: resolveColor(r.name, r.color),
                      border:
                        r.name === "Free space"
                          ? "1px dashed var(--border)"
                          : undefined,
                    }}
                  />
                  <span className="truncate text-[var(--text-primary)]">
                    {r.name}
                  </span>
                </span>
                <span className="flex items-center gap-2 flex-shrink-0 tabular-nums">
                  <span className="text-[var(--text-muted)]">
                    {fmt(r.tokens)}
                  </span>
                  <span className="text-[var(--text-faint)] w-10 text-right">
                    {pctOf(r.tokens, usage.maxTokens).toFixed(1)}%
                  </span>
                </span>
              </li>
            ))}
          </ul>

          {/* Last API call breakdown. These numbers are deltas for the most
              recent turn, not cumulative — `New input` only counts tokens
              that were not served from the prompt cache, which is why it is
              usually tiny on long, cached conversations. */}
          {usage.apiUsage && (
            <div className="pt-3 border-t border-[var(--border)]">
              <div
                className="flex items-center justify-between text-[10px] uppercase tracking-wider text-[var(--text-faint)] mb-1.5"
                title="Token deltas from the most recent Anthropic API request, not running totals."
              >
                <span>Last API call</span>
                <span className="normal-case tracking-normal">
                  total in:{" "}
                  {fmt(
                    usage.apiUsage.inputTokens +
                      usage.apiUsage.cacheReadInputTokens +
                      usage.apiUsage.cacheCreationInputTokens,
                  )}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-y-1 gap-x-3 text-[11px]">
                <span
                  className="text-[var(--text-muted)]"
                  title="Input tokens for this turn that were NOT served from the prompt cache. Stays tiny on cached conversations."
                >
                  New input
                </span>
                <span className="text-right tabular-nums text-[var(--text-primary)]">
                  {fmt(usage.apiUsage.inputTokens)}
                </span>
                <span
                  className="text-[var(--text-muted)]"
                  title="Tokens reused from the prompt cache. Carries the bulk of context for repeated turns."
                >
                  Cache read
                </span>
                <span className="text-right tabular-nums text-[var(--text-primary)]">
                  {fmt(usage.apiUsage.cacheReadInputTokens)}
                </span>
                <span
                  className="text-[var(--text-muted)]"
                  title="New tokens written into the prompt cache this turn."
                >
                  Cache written
                </span>
                <span className="text-right tabular-nums text-[var(--text-primary)]">
                  {fmt(usage.apiUsage.cacheCreationInputTokens)}
                </span>
                <span
                  className="text-[var(--text-muted)]"
                  title="Tokens generated by the model in this turn."
                >
                  Output
                </span>
                <span className="text-right tabular-nums text-[var(--text-primary)]">
                  {fmt(usage.apiUsage.outputTokens)}
                </span>
              </div>
            </div>
          )}

          {/* Per-extension breakdown: skills + MCP tools (expandable to per-item
              token cost), plus a flat slash-command summary. We deliberately
              omit System tools and other built-ins — the user can't influence
              what the SDK loads there. */}
          {(usage.skills || mcpByServer.length > 0 || usage.slashCommands) && (
            <div
              className="pt-3 border-t border-[var(--border)] space-y-1 text-[11px] text-[var(--text-muted)]"
              data-testid="context-usage-extensions"
            >
              {usage.skills && (
                <div>
                  <button
                    type="button"
                    onClick={() => setSkillsOpen((v) => !v)}
                    className="w-full flex items-center justify-between gap-2 px-1 py-0.5 rounded hover:bg-[var(--bg-surface)] transition-colors"
                    aria-expanded={skillsOpen}
                    data-testid="context-usage-skills-toggle"
                  >
                    <span className="flex items-center gap-1.5">
                      <Chevron open={skillsOpen} />
                      <span>
                        Skills ({usage.skills.includedSkills}/
                        {usage.skills.totalSkills})
                      </span>
                    </span>
                    <span className="tabular-nums">
                      {fmt(usage.skills.tokens)}
                    </span>
                  </button>
                  {skillsOpen && (
                    <ul
                      className="mt-1 pl-5 pr-1 space-y-0.5 max-h-48 overflow-y-auto"
                      data-testid="context-usage-skills-list"
                    >
                      {[...(usage.skills.skillFrontmatter ?? [])]
                        .sort((a, b) => b.tokens - a.tokens)
                        .map((s) => (
                          <li
                            key={s.name}
                            className="flex items-center justify-between gap-2 text-[10.5px]"
                          >
                            <span className="truncate text-[var(--text-primary)]">
                              {s.name}
                            </span>
                            <span className="flex items-center gap-2 flex-shrink-0">
                              <span className="text-[var(--text-faint)] uppercase tracking-wider">
                                {s.source}
                              </span>
                              <span className="tabular-nums w-10 text-right text-[var(--text-muted)]">
                                {fmt(s.tokens)}
                              </span>
                            </span>
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
              )}

              {mcpByServer.length > 0 && (
                <div>
                  <button
                    type="button"
                    onClick={() => setMcpOpen((v) => !v)}
                    className="w-full flex items-center justify-between gap-2 px-1 py-0.5 rounded hover:bg-[var(--bg-surface)] transition-colors"
                    aria-expanded={mcpOpen}
                    data-testid="context-usage-mcp-toggle"
                  >
                    <span className="flex items-center gap-1.5">
                      <Chevron open={mcpOpen} />
                      <span>MCP tools ({usage.mcpTools.length})</span>
                    </span>
                    <span className="tabular-nums">{fmt(mcpTotalTokens)}</span>
                  </button>
                  {mcpOpen && (
                    <div
                      className="mt-1 pl-5 pr-1 space-y-1.5 max-h-48 overflow-y-auto"
                      data-testid="context-usage-mcp-list"
                    >
                      {mcpByServer.map(({ server, tools, totalTokens }) => (
                        <div key={server}>
                          <div className="flex items-center justify-between gap-2 text-[10.5px] text-[var(--text-primary)] font-medium">
                            <span className="truncate">{server}</span>
                            <span className="tabular-nums text-[var(--text-muted)]">
                              {fmt(totalTokens)}
                            </span>
                          </div>
                          <ul className="pl-3 space-y-0.5">
                            {tools.map((t) => (
                              <li
                                key={`${server}.${t.name}`}
                                className="flex items-center justify-between gap-2 text-[10.5px]"
                                title={
                                  t.isLoaded === false
                                    ? "Not currently loaded in context"
                                    : undefined
                                }
                              >
                                <span
                                  className={`truncate ${t.isLoaded === false ? "text-[var(--text-faint)] italic" : "text-[var(--text-control)]"}`}
                                >
                                  {t.name}
                                </span>
                                <span className="tabular-nums w-10 text-right text-[var(--text-muted)]">
                                  {fmt(t.tokens)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {usage.slashCommands && (
                <div
                  className="flex items-center justify-between px-1 py-0.5"
                  title="The SDK does not break out per-command tokens — only this summary is available."
                >
                  <span>
                    Slash commands ({usage.slashCommands.includedCommands}/
                    {usage.slashCommands.totalCommands})
                  </span>
                  <span className="tabular-nums">
                    {fmt(usage.slashCommands.tokens)}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </PanelCard>
    </div>,
    document.body,
  );
}

function Chevron({ open }: { open: boolean }): React.ReactElement {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`flex-shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
      aria-hidden="true"
    >
      <path d="M4 3l4 3-4 3" />
    </svg>
  );
}
