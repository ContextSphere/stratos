import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { MermaidDiagram } from "../components/MermaidDiagram";

// Mock the mermaid module — its SVG renderer requires a real browser DOM
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(),
  },
}));

import mermaid from "mermaid";
const mockRender = vi.mocked(mermaid.render);

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
});
