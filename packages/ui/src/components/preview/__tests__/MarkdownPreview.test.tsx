import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MarkdownPreview } from "../MarkdownPreview";

vi.mock("../../MermaidDiagram", () => ({
  MermaidDiagram: ({ chart }: { chart: string }) => (
    <div data-testid="mermaid-diagram">{chart}</div>
  ),
}));

describe("MarkdownPreview", () => {
  afterEach(() => cleanup());

  it("renders ```mermaid fenced blocks as diagrams", () => {
    const md = [
      "# Layers",
      "",
      "```mermaid",
      "flowchart BT",
      "  a --> b",
      "```",
    ].join("\n");

    render(<MarkdownPreview content={md} />);

    const diagram = screen.getByTestId("mermaid-diagram");
    expect(diagram.textContent).toBe("flowchart BT\n  a --> b");
  });

  it("does not remount diagrams when re-rendered with the same content", () => {
    const md = ["```mermaid", "flowchart TB", "  a --> b", "```"].join("\n");

    const { rerender } = render(<MarkdownPreview content={md} />);
    const before = screen.getByTestId("mermaid-diagram");
    rerender(<MarkdownPreview content={`${md}\n\nmore text`} />);

    expect(screen.getByTestId("mermaid-diagram")).toBe(before);
  });

  it("keeps non-mermaid code blocks as highlighted code", () => {
    const md = ["```ts", "const x = 1;", "```"].join("\n");

    render(<MarkdownPreview content={md} />);

    expect(screen.queryByTestId("mermaid-diagram")).not.toBeInTheDocument();
    expect(screen.getByText("const")).toBeInTheDocument();
  });
});
