import { useEffect, useRef, useState, useId, useCallback } from "react";
import mermaid from "mermaid";

mermaid.initialize({
  startOnLoad: false,
  theme: "dark",
  darkMode: true,
  securityLevel: "loose",
});

type Transform = { x: number; y: number; scale: number };

function getSvgNaturalSize(svgEl: SVGSVGElement): { w: number; h: number } {
  // Mermaid sets inline max-width which caps rendered size; use intrinsic attrs instead
  const vb = svgEl.viewBox.baseVal;
  if (vb && vb.width && vb.height) return { w: vb.width, h: vb.height };
  // Fall back to width/height attributes (may be in px, %, or unitless)
  const attrW = parseFloat(svgEl.getAttribute("width") ?? "0");
  const attrH = parseFloat(svgEl.getAttribute("height") ?? "0");
  if (attrW && attrH) return { w: attrW, h: attrH };
  // Last resort: temporarily remove max-width constraint and measure
  const prevStyle = svgEl.style.cssText;
  svgEl.style.cssText = "max-width: none; width: auto; height: auto;";
  const bbox = svgEl.getBBox();
  svgEl.style.cssText = prevStyle;
  return { w: bbox.width || 400, h: bbox.height || 300 };
}

function fitTransform(
  svgEl: SVGSVGElement,
  container: HTMLDivElement,
): Transform {
  const { w: svgW, h: svgH } = getSvgNaturalSize(svgEl);
  const cW = container.clientWidth;
  const cH = container.clientHeight;
  if (!svgW || !svgH || !cW || !cH) return { x: 0, y: 0, scale: 1 };
  const padding = 16;
  const scale = Math.min((cW - padding * 2) / svgW, (cH - padding * 2) / svgH);
  const x = (cW - svgW * scale) / 2;
  const y = (cH - svgH * scale) / 2;
  return { x, y, scale };
}

export function MermaidDiagram({
  chart,
}: {
  chart: string;
}): React.ReactElement {
  const id = useId().replace(/:/g, "");
  const containerRef = useRef<HTMLDivElement>(null);
  const svgWrapRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [transform, setTransform] = useState<Transform>({
    x: 0,
    y: 0,
    scale: 1,
  });
  const dragRef = useRef<{
    startX: number;
    startY: number;
    tx: number;
    ty: number;
  } | null>(null);

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

  // Auto-fit once SVG is rendered
  useEffect(() => {
    if (!svg || !containerRef.current || !svgWrapRef.current) return;
    const svgEl = svgWrapRef.current.querySelector("svg");
    if (!svgEl) return;
    // Allow layout to settle
    requestAnimationFrame(() => {
      if (!containerRef.current) return;
      const t = fitTransform(svgEl as SVGSVGElement, containerRef.current);
      setTransform(t);
    });
  }, [svg]);

  const handleFit = useCallback(() => {
    if (!containerRef.current || !svgWrapRef.current) return;
    const svgEl = svgWrapRef.current.querySelector("svg");
    if (!svgEl) return;
    setTransform(fitTransform(svgEl as SVGSVGElement, containerRef.current));
  }, []);

  const handleZoom = useCallback((delta: number) => {
    setTransform((t) => {
      const newScale = Math.min(Math.max(t.scale * delta, 0.1), 10);
      // Zoom toward center of container
      if (!containerRef.current) return { ...t, scale: newScale };
      const cW = containerRef.current.clientWidth;
      const cH = containerRef.current.clientHeight;
      const cx = cW / 2;
      const cy = cH / 2;
      const x = cx - (cx - t.x) * (newScale / t.scale);
      const y = cy - (cy - t.y) * (newScale / t.scale);
      return { x, y, scale: newScale };
    });
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        tx: transform.x,
        ty: transform.y,
      };
      const onMove = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        setTransform((t) => ({
          ...t,
          x: dragRef.current!.tx + ev.clientX - dragRef.current!.startX,
          y: dragRef.current!.ty + ev.clientY - dragRef.current!.startY,
        }));
      };
      const onUp = () => {
        dragRef.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [transform.x, transform.y],
  );

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 1.1 : 0.9;
    setTransform((t) => {
      const newScale = Math.min(Math.max(t.scale * delta, 0.1), 10);
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return { ...t, scale: newScale };
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const x = cx - (cx - t.x) * (newScale / t.scale);
      const y = cy - (cy - t.y) * (newScale / t.scale);
      return { x, y, scale: newScale };
    });
  }, []);

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
      className="relative my-2 overflow-hidden rounded-md bg-[var(--bg-overlay)]"
      style={{ height: "480px", cursor: "grab" }}
      onMouseDown={handleMouseDown}
      onWheel={handleWheel}
    >
      {/* Controls */}
      <div
        className="absolute right-2 top-2 z-10 flex items-center gap-1"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => handleZoom(1.2)}
          className="flex h-6 w-6 items-center justify-center rounded bg-[var(--bg-surface)] text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)]"
          title="Zoom in"
        >
          +
        </button>
        <button
          onClick={() => handleZoom(1 / 1.2)}
          className="flex h-6 w-6 items-center justify-center rounded bg-[var(--bg-surface)] text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)]"
          title="Zoom out"
        >
          −
        </button>
        <button
          onClick={handleFit}
          className="flex h-6 items-center justify-center rounded bg-[var(--bg-surface)] px-2 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)]"
          title="Fit to window"
        >
          Reset
        </button>
      </div>

      {/* SVG canvas */}
      <div
        ref={svgWrapRef}
        style={{
          position: "absolute",
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          transformOrigin: "0 0",
          userSelect: "none",
        }}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid produces trusted SVG
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
}
