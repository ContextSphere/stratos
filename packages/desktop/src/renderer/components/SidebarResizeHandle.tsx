import React, { useEffect, useRef } from "react";

interface Props {
  width: number;
  minWidth: number;
  maxWidth: number;
  onResizeStart: () => void;
  onResize: (width: number) => void;
  onResizeEnd: (width: number) => void;
  onReset: () => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function SidebarResizeHandle({
  width,
  minWidth,
  maxWidth,
  onResizeStart,
  onResize,
  onResizeEnd,
  onReset,
}: Props): React.ReactElement {
  const dragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => dragCleanupRef.current?.(), []);

  const commitKeyboardResize = (nextWidth: number): void => {
    const clampedWidth = clamp(nextWidth, minWidth, maxWidth);
    onResize(clampedWidth);
    onResizeEnd(clampedWidth);
  };

  const handlePointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
  ): void => {
    if (event.button !== 0) return;

    event.preventDefault();
    onResizeStart();
    const startX = event.clientX;
    const startWidth = width;
    let latestWidth = width;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handlePointerMove = (pointerEvent: PointerEvent): void => {
      latestWidth = clamp(
        startWidth + pointerEvent.clientX - startX,
        minWidth,
        maxWidth,
      );
      onResize(latestWidth);
    };

    const cleanup = (): void => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      dragCleanupRef.current = null;
    };

    const handlePointerUp = (): void => {
      cleanup();
      onResizeEnd(latestWidth);
    };

    dragCleanupRef.current?.();
    dragCleanupRef.current = cleanup;
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  };

  return (
    <div
      role="separator"
      aria-label="Resize sidebar"
      aria-orientation="vertical"
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onDoubleClick={onReset}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          commitKeyboardResize(width - 16);
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          commitKeyboardResize(width + 16);
        } else if (event.key === "Home") {
          event.preventDefault();
          commitKeyboardResize(minWidth);
        } else if (event.key === "End") {
          event.preventDefault();
          commitKeyboardResize(maxWidth);
        }
      }}
      title="Drag to resize sidebar · Double-click to reset"
      className="group no-drag absolute inset-y-0 -right-1 z-30 w-2 cursor-col-resize touch-none focus-visible:outline-none"
    >
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[var(--border)] transition-all group-hover:w-0.5 group-hover:bg-blue-500 group-focus-visible:w-0.5 group-focus-visible:bg-blue-500" />
    </div>
  );
}
