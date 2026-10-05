import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import { MermaidDiagram, pinIntrinsicSize } from "../components/MermaidDiagram";
import { ThemeContext } from "../context/ThemeContext";

// Mock the mermaid module — its SVG renderer requires a real browser DOM
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(),
  },
}));

import mermaid from "mermaid";
const mockRender = vi.mocked(mermaid.render);
const mockInitialize = vi.mocked(mermaid.initialize);

describe("MermaidDiagram", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => cleanup());

  it("shows loading state while diagram is rendering", () => {
    // Never resolve so we stay in the loading state
    mockRender.mockReturnValue(new Promise(() => {}));

    render(<MermaidDiagram chart="flowchart TB\n  A --> B" />);

    expect(screen.getByText("Rendering diagram…")).toBeInTheDocument();
  });

  it("renders the SVG after mermaid.render resolves", async () => {
    mockRender.mockResolvedValue({
      svg: "<svg><text>My Chart</text></svg>",
      bindFunctions: undefined,
    });

    render(<MermaidDiagram chart="flowchart TB\n  A --> B" />);

    await waitFor(() => {
      expect(screen.getByText("My Chart")).toBeInTheDocument();
    });
  });

  it("shows an error message when mermaid.render rejects with an Error", async () => {
    mockRender.mockRejectedValue(new Error("Parse error on line 1"));

    render(<MermaidDiagram chart="invalid %%% chart" />);

    await waitFor(() => {
      expect(screen.getByText("Mermaid render error")).toBeInTheDocument();
      expect(screen.getByText("Parse error on line 1")).toBeInTheDocument();
    });
  });

  it("shows an error message when mermaid.render rejects with a non-Error value", async () => {
    mockRender.mockRejectedValue("unexpected string error");

    render(<MermaidDiagram chart="invalid" />);

    await waitFor(() => {
      expect(screen.getByText("Mermaid render error")).toBeInTheDocument();
      expect(screen.getByText("unexpected string error")).toBeInTheDocument();
    });
  });

  it("renders zoom controls after SVG resolves", async () => {
    mockRender.mockResolvedValue({
      svg: "<svg><text>My Chart</text></svg>",
      bindFunctions: undefined,
    });

    render(<MermaidDiagram chart="flowchart TB\n  A --> B" />);

    await waitFor(() => {
      expect(screen.getByTitle("Zoom in")).toBeInTheDocument();
      expect(screen.getByTitle("Zoom out")).toBeInTheDocument();
      expect(screen.getByTitle("Fit to window")).toBeInTheDocument();
    });
  });

  it("does not render zoom controls during loading state", () => {
    mockRender.mockReturnValue(new Promise(() => {}));

    render(<MermaidDiagram chart="flowchart TB\n  A --> B" />);

    expect(screen.queryByTitle("Zoom in")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Zoom out")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Fit to window")).not.toBeInTheDocument();
  });

  it("does not render zoom controls on error", async () => {
    mockRender.mockRejectedValue(new Error("Parse error"));

    render(<MermaidDiagram chart="invalid" />);

    await waitFor(() => {
      expect(screen.getByText("Mermaid render error")).toBeInTheDocument();
    });

    expect(screen.queryByTitle("Zoom in")).not.toBeInTheDocument();
  });

  it("zoom in and zoom out buttons are clickable without throwing", async () => {
    mockRender.mockResolvedValue({
      svg: "<svg><text>My Chart</text></svg>",
      bindFunctions: undefined,
    });

    render(<MermaidDiagram chart="flowchart TB\n  A --> B" />);

    await waitFor(() => {
      expect(screen.getByTitle("Zoom in")).toBeInTheDocument();
    });

    expect(() => fireEvent.click(screen.getByTitle("Zoom in"))).not.toThrow();
    expect(() => fireEvent.click(screen.getByTitle("Zoom out"))).not.toThrow();
    expect(() =>
      fireEvent.click(screen.getByTitle("Fit to window")),
    ).not.toThrow();
  });

  it("re-renders when the chart prop changes", async () => {
    mockRender
      .mockResolvedValueOnce({
        svg: "<svg><text>First</text></svg>",
        bindFunctions: undefined,
      })
      .mockResolvedValueOnce({
        svg: "<svg><text>Second</text></svg>",
        bindFunctions: undefined,
      });

    const { rerender } = render(
      <MermaidDiagram chart="flowchart TB\n  A --> B" />,
    );

    await waitFor(() => {
      expect(screen.getByText("First")).toBeInTheDocument();
    });

    rerender(<MermaidDiagram chart="flowchart TB\n  C --> D" />);

    await waitFor(() => {
      expect(screen.getByText("Second")).toBeInTheDocument();
    });

    expect(mockRender).toHaveBeenCalledTimes(2);
  });

  it("uses mermaid's dark theme by default", async () => {
    mockRender.mockResolvedValue({
      svg: "<svg><text>Dark</text></svg>",
      bindFunctions: undefined,
    });

    render(<MermaidDiagram chart="flowchart TB\n  A --> B" />);

    await waitFor(() => expect(mockRender).toHaveBeenCalled());
    expect(mockInitialize).toHaveBeenLastCalledWith(
      expect.objectContaining({ theme: "dark", darkMode: true }),
    );
  });

  it("uses mermaid's default (light) theme and re-renders when the app theme changes", async () => {
    mockRender.mockResolvedValue({
      svg: "<svg><text>Themed</text></svg>",
      bindFunctions: undefined,
    });

    const { rerender } = render(
      <ThemeContext.Provider value="light">
        <MermaidDiagram chart="flowchart TB\n  A --> B" />
      </ThemeContext.Provider>,
    );

    await waitFor(() => expect(mockRender).toHaveBeenCalledTimes(1));
    expect(mockInitialize).toHaveBeenLastCalledWith(
      expect.objectContaining({ theme: "default", darkMode: false }),
    );

    rerender(
      <ThemeContext.Provider value="dark">
        <MermaidDiagram chart="flowchart TB\n  A --> B" />
      </ThemeContext.Provider>,
    );

    await waitFor(() => expect(mockRender).toHaveBeenCalledTimes(2));
    expect(mockInitialize).toHaveBeenLastCalledWith(
      expect.objectContaining({ theme: "dark", darkMode: true }),
    );
  });
});

describe("pinIntrinsicSize", () => {
  it("replaces responsive width with the viewBox size", () => {
    const out = pinIntrinsicSize(
      '<svg viewBox="0 0 1305.5 564" width="100%" style="max-width: 1305.5px;"><g></g></svg>',
    );
    const svg = new DOMParser()
      .parseFromString(out, "text/html")
      .querySelector("svg")!;

    expect(svg.getAttribute("width")).toBe("1305.5");
    expect(svg.getAttribute("height")).toBe("564");
    expect(svg.style.maxWidth).toBe("none");
  });

  it("leaves SVGs without a usable viewBox unchanged", () => {
    const input = '<svg width="100%"><g></g></svg>';
    expect(pinIntrinsicSize(input)).toBe(input);
    expect(pinIntrinsicSize("not svg")).toBe("not svg");
  });
});
