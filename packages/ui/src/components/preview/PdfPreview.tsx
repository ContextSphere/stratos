import React, { useEffect, useRef, useState } from "react";

interface Props {
  pages: string[];
  sourceFilePath?: string;
}

export function PdfPreview({ pages }: Props): React.ReactElement {
  const [index, setIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const thumbRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const total = pages.length;
  const safeIndex = Math.min(index, Math.max(0, total - 1));

  useEffect(() => {
    setIndex(0);
  }, [pages]);

  useEffect(() => {
    const el = thumbRefs.current[safeIndex];
    if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [safeIndex]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "PageUp") {
        e.preventDefault();
        setIndex((i) => Math.max(0, i - 1));
      } else if (
        e.key === "ArrowRight" ||
        e.key === "ArrowDown" ||
        e.key === "PageDown" ||
        e.key === " "
      ) {
        e.preventDefault();
        setIndex((i) => Math.min(total - 1, i + 1));
      } else if (e.key === "Home") {
        e.preventDefault();
        setIndex(0);
      } else if (e.key === "End") {
        e.preventDefault();
        setIndex(total - 1);
      }
    };
    node.addEventListener("keydown", onKey);
    node.focus();
    return () => node.removeEventListener("keydown", onKey);
  }, [total]);

  if (total === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-gray-500">
        No pages to display.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className="h-full w-full min-h-0 flex bg-[var(--bg-main)] outline-none"
    >
      {/* Thumbnail rail */}
      <div className="w-24 flex-shrink-0 overflow-y-auto border-r border-[var(--border)] bg-[var(--bg-secondary,#0d1117)] py-2">
        {pages.map((src, i) => (
          <button
            key={i}
            ref={(el) => {
              thumbRefs.current[i] = el;
            }}
            onClick={() => setIndex(i)}
            className={`block w-full px-2 py-1 ${
              i === safeIndex
                ? "bg-[var(--border)]"
                : "hover:bg-[var(--border)]"
            }`}
            title={`Page ${i + 1}`}
          >
            <img
              src={src}
              alt={`Page ${i + 1}`}
              className={`w-full border ${
                i === safeIndex ? "border-amber-400" : "border-[var(--border)]"
              }`}
              loading="lazy"
            />
            <div className="mt-0.5 text-[10px] text-gray-400 text-center">
              {i + 1}
            </div>
          </button>
        ))}
      </div>

      {/* Main page */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex-1 min-h-0 overflow-auto flex items-center justify-center p-4">
          <img
            src={pages[safeIndex]}
            alt={`Page ${safeIndex + 1} of ${total}`}
            className="max-w-full max-h-full object-contain shadow-lg"
          />
        </div>
        {/* Footer toolbar */}
        <div className="flex-shrink-0 flex items-center justify-center gap-3 border-t border-[var(--border)] px-3 py-1.5 text-xs text-gray-400">
          <button
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            disabled={safeIndex === 0}
            className="px-2 py-0.5 rounded hover:bg-[var(--border)] disabled:opacity-30 disabled:cursor-not-allowed"
            title="Previous page (←)"
          >
            ‹
          </button>
          <span className="tabular-nums">
            {safeIndex + 1} / {total}
          </span>
          <button
            onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}
            disabled={safeIndex === total - 1}
            className="px-2 py-0.5 rounded hover:bg-[var(--border)] disabled:opacity-30 disabled:cursor-not-allowed"
            title="Next page (→)"
          >
            ›
          </button>
        </div>
      </div>
    </div>
  );
}
