// @vitest-environment happy-dom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SidebarResizeHandle } from "../SidebarResizeHandle";

describe("SidebarResizeHandle", () => {
  afterEach(() => cleanup());

  it("resizes from pointer movement and commits the final width", () => {
    const onResize = vi.fn();
    const onResizeEnd = vi.fn();
    render(
      <SidebarResizeHandle
        width={240}
        minWidth={180}
        maxWidth={480}
        onResizeStart={vi.fn()}
        onResize={onResize}
        onResizeEnd={onResizeEnd}
        onReset={vi.fn()}
      />,
    );

    const handle = screen.getByRole("separator", { name: "Resize sidebar" });
    fireEvent.pointerDown(handle, { button: 0, clientX: 240 });
    fireEvent.pointerMove(window, { clientX: 340 });
    fireEvent.pointerUp(window);

    expect(onResize).toHaveBeenLastCalledWith(340);
    expect(onResizeEnd).toHaveBeenCalledWith(340);
  });

  it("clamps pointer resizing to the allowed range", () => {
    const onResize = vi.fn();
    render(
      <SidebarResizeHandle
        width={240}
        minWidth={180}
        maxWidth={480}
        onResizeStart={vi.fn()}
        onResize={onResize}
        onResizeEnd={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    const handle = screen.getByRole("separator", { name: "Resize sidebar" });
    fireEvent.pointerDown(handle, { button: 0, clientX: 240 });
    fireEvent.pointerMove(window, { clientX: 900 });

    expect(onResize).toHaveBeenLastCalledWith(480);
  });

  it("supports keyboard resizing and double-click reset", () => {
    const onResize = vi.fn();
    const onResizeEnd = vi.fn();
    const onReset = vi.fn();
    render(
      <SidebarResizeHandle
        width={240}
        minWidth={180}
        maxWidth={480}
        onResizeStart={vi.fn()}
        onResize={onResize}
        onResizeEnd={onResizeEnd}
        onReset={onReset}
      />,
    );

    const handle = screen.getByRole("separator", { name: "Resize sidebar" });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    fireEvent.doubleClick(handle);

    expect(onResize).toHaveBeenCalledWith(256);
    expect(onResizeEnd).toHaveBeenCalledWith(256);
    expect(onReset).toHaveBeenCalledOnce();
  });
});
