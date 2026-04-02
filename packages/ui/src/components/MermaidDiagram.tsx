import { useEffect, useRef, useState, useId } from "react";
import mermaid from "mermaid";

mermaid.initialize({
  startOnLoad: false,
  theme: "dark",
  darkMode: true,
  securityLevel: "loose",
});

export function MermaidDiagram({
  chart,
}: {
  chart: string;
}): React.ReactElement {
  const id = useId().replace(/:/g, "");
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setSvg(null);

    mermaid
      .render(`mermaid-${id}`, chart)
      .then(({ svg: renderedSvg }) => {
        if (!cancelled) setSvg(renderedSvg);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [chart, id]);

  if (error) {
    return (
      <div className="my-2 rounded-md border border-red-500/40 bg-red-950/30 p-3 text-xs text-red-400">
        <p className="mb-1 font-semibold">Mermaid render error</p>
        <pre className="whitespace-pre-wrap">{error}</pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="my-2 flex items-center justify-center rounded-md bg-[var(--bg-overlay)] p-4 text-xs text-[var(--text-muted)]">
        Rendering diagram…
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="my-2 overflow-auto rounded-md bg-[var(--bg-overlay)] p-4"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid produces trusted SVG
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
