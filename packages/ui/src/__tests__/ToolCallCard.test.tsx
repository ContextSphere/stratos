import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToolCallCard } from "../components/ToolCallCard";

describe("ToolCallCard generic activity", () => {
  afterEach(cleanup);

  it("collapses completed activity while keeping exact details accessible", async () => {
    const user = userEvent.setup();
    render(
      <ToolCallCard
        toolCall={{
          toolCallId: "1",
          toolName: "WebSearch",
          input: { query: "agent interface patterns" },
          output: "three results",
          status: "completed",
        }}
      />,
    );
    const disclosure = screen.getByRole("button", { name: /WebSearch.*Done/ });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Arguments")).not.toBeInTheDocument();
    await user.click(disclosure);
    expect(
      screen.getByText("query: agent interface patterns"),
    ).toBeInTheDocument();
    expect(screen.getByText("three results")).toBeInTheDocument();
  });

  it("keeps running and denied activity expanded and prominent", () => {
    const { rerender } = render(
      <ToolCallCard
        toolCall={{
          toolCallId: "2",
          toolName: "Shell",
          input: { command: "pnpm test" },
          status: "running",
        }}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Shell.*Running/ }),
    ).toHaveAttribute("aria-expanded", "true");

    rerender(
      <ToolCallCard
        toolCall={{
          toolCallId: "3",
          toolName: "Shell",
          input: { command: "deploy" },
          output: "Permission denied",
          status: "denied",
        }}
      />,
    );
    expect(screen.getByText("Denied")).toHaveClass("text-[var(--text-danger)]");
    expect(screen.getByText("Permission denied")).toBeInTheDocument();
  });

  it("does not treat incidental error words in successful output as failure", () => {
    render(
      <ToolCallCard
        toolCall={{
          toolCallId: "4",
          toolName: "Shell",
          input: { command: "pnpm test" },
          output: "0 errors, 42 tests passed",
          status: "completed",
        }}
      />,
    );
    expect(screen.getByText("Done")).not.toHaveClass(
      "text-[var(--text-danger)]",
    );
  });

  it("labels an explicit error output as an error even when transport status completed", () => {
    render(
      <ToolCallCard
        toolCall={{
          toolCallId: "explicit-error",
          toolName: "Shell",
          input: { command: "build" },
          output: "Error: compiler crashed",
          status: "completed",
        }}
      />,
    );
    expect(screen.getByText("Error")).toHaveClass("text-[var(--text-danger)]");
    expect(screen.queryByText("Done")).not.toBeInTheDocument();
    expect(screen.getByText("Error: compiler crashed")).toBeInTheDocument();
  });

  it("collapses automatically when running activity completes", async () => {
    const { rerender } = render(
      <ToolCallCard
        toolCall={{
          toolCallId: "5",
          toolName: "Shell",
          input: { command: "pnpm build" },
          status: "running",
        }}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Shell.*Running/ }),
    ).toHaveAttribute("aria-expanded", "true");
    rerender(
      <ToolCallCard
        toolCall={{
          toolCallId: "5",
          toolName: "Shell",
          input: { command: "pnpm build" },
          output: "Build complete",
          status: "completed",
        }}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Shell.*Done/ }),
      ).toHaveAttribute("aria-expanded", "false"),
    );
  });
});
