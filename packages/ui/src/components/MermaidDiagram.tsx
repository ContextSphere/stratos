import { useEffect, useRef, useState, useId, useCallback } from "react";
import mermaid from "mermaid";

mermaid.initialize({
  startOnLoad: false,
  theme: "dark",
  darkMode: true,
  securityLevel: "loose",
});

const MIN_SCALE = 0.25;
const MAX_SCALE = 5;
const ZOOM_SENSITIVITY = 0.001;

export function MermaidDiagram({
  chart,
}: {
  chart: string;
}): React.ReactElement {
  const id = useId().replace(/:/g, "");
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [svg, setSvg] = useState<string | null>(null);

  // Pan/zoom state stored in refs to avoid re-renders during drag
  const scale = useRef(1);
  const offset = useRef({ x: 0, y: 0 });
  const dragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const innerRef = useRef<HTMLDivElement>(null);

  const applyTransform = useCallback(() => {
    if (innerRef.current) {
      innerRef.current.style.transform = `translate(${offset.current.x}px, ${offset.current.y}px) scale(${scale.current})`;
    }
  }, []);

  const fitToContainer = useCallback(() => {
    const container = containerRef.current;
    const inner = innerRef.current;
    if (!container || !inner) return;

    // Read intrinsic SVG dimensions from attributes/viewBox (unaffected by clipping)
    inner.style.transform = "none";
    const svgEl = inner.querySelector("svg");
    if (!svgEl) return;

    // Prefer explicit width/height attrs; fall back to viewBox
    let iw = svgEl.width?.baseVal?.value ?? 0;
    let ih = svgEl.height?.baseVal?.value ?? 0;
    if (!iw || !ih) {
      const vb = svgEl.viewBox?.baseVal;
      if (vb && vb.width && vb.height) {
        iw = vb.width;
        ih = vb.height;
      }
    }
    // Last resort: temporarily make it visible and measure
    if (!iw || !ih) {
      svgEl.style.position = "absolute";
      svgEl.style.visibility = "hidden";
      document.body.appendChild(svgEl.cloneNode(true));
      const clone = document.body.lastElementChild as SVGSVGElement;
      iw = clone.getBoundingClientRect().width;
      ih = clone.getBoundingClientRect().height;
      document.body.removeChild(clone);
      svgEl.style.position = "";
      svgEl.style.visibility = "";
    }
    if (iw === 0 || ih === 0) return;

    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const padding = 16;
    const s = Math.min(1, (cw - padding * 2) / iw, (ch - padding * 2) / ih);
    scale.current = s;
    offset.current = {
      x: (cw - iw * s) / 2,
      y: (ch - ih * s) / 2,
    };
    applyTransform();
  }, [applyTransform]);

  const resetView = useCallback(() => {
    fitToContainer();
  }, [fitToContainer]);

  // Wheel → zoom centred on cursor
  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      e.preventDefault();
      const rect = containerRef.current!.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const delta = -e.deltaY * ZOOM_SENSITIVITY;
      const newScale = Math.min(
        MAX_SCALE,
        Math.max(MIN_SCALE, scale.current * (1 + delta)),
      );
      const ratio = newScale / scale.current;

      offset.current = {
        x: mouseX - ratio * (mouseX - offset.current.x),
        y: mouseY - ratio * (mouseY - offset.current.y),
      };
      scale.current = newScale;
      applyTransform();
    },
    [applyTransform],
  );

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    dragging.current = true;
    dragStart.current = {
      x: e.clientX - offset.current.x,
      y: e.clientY - offset.current.y,
    };
    if (containerRef.current) containerRef.current.style.cursor = "grabbing";
  }, []);

  const onMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!dragging.current) return;
      offset.current = {
        x: e.clientX - dragStart.current.x,
        y: e.clientY - dragStart.current.y,
      };
      applyTransform();
    },
    [applyTransform],
  );

  const stopDrag = useCallback(() => {
    dragging.current = false;
    if (containerRef.current) containerRef.current.style.cursor = "grab";
  }, []);

  // Fit to container after SVG renders
  useEffect(() => {
    if (svg) {
      // rAF ensures the SVG has been painted and has measurable dimensions
      const raf = requestAnimationFrame(fitToContainer);
      return () => cancelAnimationFrame(raf);
    }
  }, [svg, fitToContainer]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setSvg(null);
    scale.current = 1;
    offset.current = { x: 0, y: 0 };

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
    <div className="my-2 rounded-md bg-[var(--bg-overlay)]">
      {/* Toolbar */}
      <div className="flex items-center justify-end gap-1 px-2 pt-1.5 pb-0">
        <button
          type="button"
          onClick={() => {
            scale.current = Math.min(MAX_SCALE, scale.current * 1.25);
            applyTransform();
          }}
          className="rounded px-1.5 py-0.5 text-xs text-[var(--text-muted)] hover:bg-white/10"
          title="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => {
            scale.current = Math.max(MIN_SCALE, scale.current / 1.25);
            applyTransform();
          }}
          className="rounded px-1.5 py-0.5 text-xs text-[var(--text-muted)] hover:bg-white/10"
          title="Zoom out"
        >
          −
        </button>
        <button
          type="button"
          onClick={resetView}
          className="rounded px-1.5 py-0.5 text-xs text-[var(--text-muted)] hover:bg-white/10"
          title="Fit to window"
        >
          Reset
        </button>
      </div>

      {/* Diagram canvas */}
      <div
        ref={containerRef}
        className="overflow-hidden rounded-b-md p-4"
        style={{ cursor: "grab", height: 400 }}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={stopDrag}
        onMouseLeave={stopDrag}
      >
        <div
          ref={innerRef}
          style={{ transformOrigin: "0 0", display: "inline-block" }}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid produces trusted SVG
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    </div>
  );
}
