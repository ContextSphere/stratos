import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignProvider, useDesignVariant } from "../context/DesignContext";
import { AgentGlyph } from "../components/AgentGlyph";
import ModeToggle from "../components/ModeToggle";
import { InputBar } from "../components/InputBar";

function VariantProbe(): React.ReactElement {
  return <span>{useDesignVariant()}</span>;
}

describe("DesignProvider", () => {
  afterEach(cleanup);
  it("defaults unwrapped consumers to refined", () => {
    render(<VariantProbe />);
    expect(screen.getByText("refined")).toBeInTheDocument();
  });

  it("uses the original segmented permission control in classic", async () => {
      const user = userEvent.setup();
      const onModeChange = vi.fn();
      render(
        <DesignProvider variant="classic">
          <AgentGlyph name="Reviewer" icon="🤖" accent="blue" />
          <ModeToggle
            provider="codex"
            mode="default"
            onModeChange={onModeChange}
          />
        </DesignProvider>,
      );

      await user.click(screen.getByRole("button", { name: "Plan" }));
      expect(onModeChange).toHaveBeenCalledWith("plan");
  });

  it("uses the compact permission menu in refined", async () => {
    const user = userEvent.setup();
    const onModeChange = vi.fn();
    render(
      <DesignProvider variant="refined">
        <ModeToggle provider="codex" mode="default" onModeChange={onModeChange} />
      </DesignProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Permissions: Default permissions" }));
    await user.click(screen.getByRole("menuitemradio", { name: /Plan/ }));
    expect(onModeChange).toHaveBeenCalledWith("plan");
  });

  it("uses generated lettermarks in refined", () => {
    render(
      <DesignProvider variant="refined">
        <AgentGlyph name="Release Manager" icon="🤖" accent="blue" />
      </DesignProvider>,
    );
    expect(screen.getByText("RM")).toBeInTheDocument();
  });

  it("keeps an unsent draft when switching designs", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn(async (_prompt: string) => {});
    const composer = (
      <InputBar
        onSend={onSend}
        onInterrupt={async () => {}}
        isStreaming={false}
      />
    );
    const { rerender } = render(
      <DesignProvider variant="classic">{composer}</DesignProvider>,
    );
    await user.type(screen.getByRole("textbox"), "Keep this draft");
    rerender(<DesignProvider variant="refined">{composer}</DesignProvider>);
    expect(screen.getByRole("textbox")).toHaveTextContent("Keep this draft");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend.mock.calls[0][0]).toBe("Keep this draft");
  });
});
