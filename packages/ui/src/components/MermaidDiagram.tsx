import {
  useEffect,
  useRef,
  useState,
  useId,
  useCallback,
  useMemo,
} from "react";
import mermaid from "mermaid";
import DOMPurify from "dompurify";
import { useTheme, type AppTheme } from "../context/ThemeContext";

function triggerDownload(href: string, filename: string): void {
  const a = document.createElement("a");
  a.download = filename;
  a.href = href;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function downloadSvgAsPng(svgHtml: string): Promise<void> {
  // Parse the SVG to extract width/height for the canvas
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgHtml, "image/svg+xml");
  const svgEl = doc.querySelector("svg");
  if (!svgEl) return;

  // Ensure SVG has explicit dimensions so the canvas sizes correctly
  let w = svgEl.width?.baseVal?.value ?? 0;
  let h = svgEl.height?.baseVal?.value ?? 0;
  if (!w || !h) {
    const vb = svgEl.viewBox?.baseVal;
    if (vb && vb.width && vb.height) {
      w = vb.width;
      h = vb.height;
    }
  }
  if (!w || !h) {
    w = 800;
    h = 600;
  }
  svgEl.setAttribute("width", String(w));
  svgEl.setAttribute("height", String(h));

  const serialized = new XMLSerializer().serializeToString(svgEl);

  // Use a data: URL rather than blob: to avoid the null-origin taint issue
  // that occurs when Electron loads pages from file:// in production.
  // blob:null/... URLs are treated as cross-origin by Chromium, causing
  // canvas.toDataURL() to throw SecurityError.
  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;

  await new Promise<void>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const scale = window.devicePixelRatio || 1;
      canvas.width = w * scale;
      canvas.height = h * scale;
      const ctx = canvas.getContext("2d")!;
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, w, h);

      try {
        triggerDownload(canvas.toDataURL("image/png"), "diagram.png");
      } catch {
        // Canvas tainted (SVG has external resources) — fall back to SVG download
        triggerDownload(dataUrl, "diagram.svg");
      }
      resolve();
    };
    img.onerror = () => resolve();
    img.src = dataUrl;
  });
}

function mermaidConfig(theme: AppTheme) {
  return {
    startOnLoad: false,
    theme: theme === "light" ? "default" : "dark",
    darkMode: theme !== "light",
    securityLevel: "antiscript",
    // HTML labels live in <foreignObject>, which the SVG-only DOMPurify pass
    // below strips (leaving empty boxes). Native SVG <text> labels survive
    // sanitization and keep PNG export canvas-safe.
    htmlLabels: false,
  } as const;
}

mermaid.initialize(mermaidConfig("dark"));

/**
 * Mermaid emits `width="100%"` + an inline max-width, so the SVG's laid-out
 * size depends on its wrapper (Chromium falls back to 300px inside a
 * shrink-wrapped box). Pin it to the viewBox size; zoom/fit is done via CSS
 * transform, and PNG export gets real dimensions.
 */
export function pinIntrinsicSize(svgHtml: string): string {
  const tpl = document.createElement("template");
  tpl.innerHTML = svgHtml;
  const svgEl = tpl.content.querySelector("svg");
  if (!svgEl) return svgHtml;
  const [, , w, h] = (svgEl.getAttribute("viewBox") ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (!(w > 0) || !(h > 0)) return svgHtml;
  svgEl.setAttribute("width", String(w));
  svgEl.setAttribute("height", String(h));
  svgEl.style.maxWidth = "none";
  return tpl.innerHTML;
}

const MIN_SCALE = 0.25;
const MAX_SCALE = 5;
const ZOOM_SENSITIVITY = 0.001;
const CANVAS_PADDING = 16;
const MAX_CANVAS_HEIGHT = 400;
const MIN_CANVAS_HEIGHT = 120;

export function MermaidDiagram({
  chart,
}: {
  chart: string;
}): React.ReactElement {
  const id = useId().replace(/:/g, "");
  const theme = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [canvasHeight, setCanvasHeight] = useState(MAX_CANVAS_HEIGHT);

  const copyCode = useCallback(() => {
    const markCopied = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    };
    const execFallback = () => {
      const ta = document.createElement("textarea");
      ta.value = chart;
      ta.style.cssText = "position:fixed;opacity:0;pointer-events:none";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      markCopied();
    };
    if (navigator.clipboard) {
      navigator.clipboard.writeText(chart).then(markCopied).catch(execFallback);
    } else {
      execFallback();
    }
  }, [chart]);

  const downloadPng = useCallback(() => {
    if (svg) downloadSvgAsPng(svg);
  }, [svg]);

  // Stable identity: React 19 re-applies innerHTML whenever this object
  // changes, which would wipe the rendered SVG on every state update.
  const svgMarkup = useMemo(() => ({ __html: svg ?? "" }), [svg]);

  // Pan/zoom state stored in refs to avoid re-renders during drag
  const scale = useRef(1);
  const offset = useRef({ x: 0, y: 0 });
  const dragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const innerRef = useRef<HTMLDivElement>(null);
  // Set once the user zooms/pans so container resizes don't clobber their view
  const userAdjusted = useRef(false);

  const applyTransform = useCallback(() => {
    if (innerRef.current) {
      innerRef.current.style.transform = `translate(${offset.current.x}px, ${offset.current.y}px) scale(${scale.current})`;
    }
  }, []);

  const fitToContainer = useCallback(() => {
    const container = containerRef.current;
    const inner = innerRef.current;
    if (!container || !inner) return;

    inner.style.transform = "none";
    const svgEl = inner.querySelector("svg");
    if (!svgEl) return;

    // Prefer the viewBox (intrinsic size) over width/height, which may be
    // percentages that resolve against the wrapper rather than the diagram.
    let iw = 0;
    let ih = 0;
    const vb = svgEl.viewBox?.baseVal;
    if (vb && vb.width && vb.height) {
      iw = vb.width;
      ih = vb.height;
    } else {
      iw = svgEl.width?.baseVal?.value ?? 0;
      ih = svgEl.height?.baseVal?.value ?? 0;
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

    // Fit to the available width (capped at the max canvas height), then
    // shrink the canvas to the fitted diagram so wide charts don't leave a
    // tall empty box.
    const cw = container.clientWidth;
    const s = Math.min(
      1,
      (cw - CANVAS_PADDING * 2) / iw,
      (MAX_CANVAS_HEIGHT - CANVAS_PADDING * 2) / ih,
    );
    const h = Math.max(
      MIN_CANVAS_HEIGHT,
      Math.ceil(ih * s + CANVAS_PADDING * 2),
    );
    scale.current = s;
    offset.current = {
      x: (cw - iw * s) / 2,
      y: (h - ih * s) / 2,
    };
    userAdjusted.current = false;
    setCanvasHeight(h);
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
      userAdjusted.current = true;
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
      userAdjusted.current = true;
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

  // Refit when the available width changes (e.g. the preview pane is resized),
  // unless the user has zoomed/panned.
  useEffect(() => {
    const container = containerRef.current;
    if (!svg || !container || typeof ResizeObserver === "undefined") return;
    let lastWidth = container.clientWidth;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      const w = container.clientWidth;
      if (w === lastWidth) return;
      lastWidth = w;
      if (userAdjusted.current) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(fitToContainer);
    });
    ro.observe(container);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [svg, fitToContainer]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setSvg(null);
    scale.current = 1;
    offset.current = { x: 0, y: 0 };

    // Mermaid config is global; all diagrams share the app theme, so
    // re-applying it right before render keeps them in sync.
    mermaid.initialize(mermaidConfig(theme));
    mermaid
      .render(`mermaid-${id}`, chart)
      .then(({ svg: renderedSvg }) => {
        if (!cancelled)
          setSvg(
            pinIntrinsicSize(
              DOMPurify.sanitize(renderedSvg, {
                USE_PROFILES: { svg: true, svgFilters: true },
              }),
            ),
          );
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [chart, id, theme]);

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
          onClick={copyCode}
          className="rounded px-1.5 py-0.5 text-xs text-[var(--text-muted)] hover:bg-white/10"
          title="Copy diagram source"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
        <button
          type="button"
          onClick={downloadPng}
          className="rounded px-1.5 py-0.5 text-xs text-[var(--text-muted)] hover:bg-white/10"
          title="Download as PNG"
        >
          PNG
        </button>
        <div className="h-3 w-px bg-white/20 mx-0.5" />
        <button
          type="button"
          onClick={() => {
            scale.current = Math.min(MAX_SCALE, scale.current * 1.25);
            userAdjusted.current = true;
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
            userAdjusted.current = true;
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

      {/* Diagram canvas. The inner layer is absolutely positioned so the
          intrinsically-sized SVG never contributes to layout width. */}
      <div
        ref={containerRef}
        className="relative overflow-hidden rounded-b-md"
        style={{ cursor: "grab", height: canvasHeight }}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={stopDrag}
        onMouseLeave={stopDrag}
      >
        <div
          ref={innerRef}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            transformOrigin: "0 0",
            display: "inline-block",
          }}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: svg is DOMPurify-sanitized before storage
          dangerouslySetInnerHTML={svgMarkup}
        />
      </div>
    </div>
  );
}
