import { MarkdownContent } from "./MarkdownContent";

export function InsightCard({
  content,
  onLinkClick,
}: {
  content: string;
  onLinkClick?: (url: string) => void;
}): React.ReactElement {
  return (
    <div className="my-3 rounded-lg border border-amber-700/40 bg-amber-950/20 overflow-hidden">
      <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-1.5 border-b border-amber-700/20">
        <span className="text-amber-400 text-xs leading-none">★</span>
        <span className="text-[10px] font-semibold tracking-widest text-amber-400/70 uppercase">
          Insight
        </span>
      </div>
      <div className="px-3 py-2.5 text-sm leading-relaxed prose prose-sm max-w-none text-[var(--text-primary)]">
        <MarkdownContent content={content} onLinkClick={onLinkClick} />
      </div>
    </div>
  );
}
