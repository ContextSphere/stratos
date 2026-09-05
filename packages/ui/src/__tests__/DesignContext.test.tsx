import { act, cleanup, render, screen } from "@testing-library/react";
import { createRef } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignProvider, useDesignVariant } from "../context/DesignContext";
import { AgentGlyph } from "../components/AgentGlyph";
import ModeToggle from "../components/ModeToggle";
import { InputBar } from "../components/InputBar";
import type { InputBarRef } from "../components/InputBar";

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
        <ModeToggle
          provider="codex"
          mode="default"
          onModeChange={onModeChange}
        />
      </DesignProvider>,
    );
    await user.click(
      screen.getByRole("button", { name: "Permissions: Default permissions" }),
    );
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

  it("keeps draft attachments when switching both ways", () => {
    const inputRef = createRef<InputBarRef>();
    const image = {
      id: "image-1",
      name: "reference.png",
      dataUrl: "data:image/png;base64,c2FtcGxl",
      mimeType: "image/png",
    };
    const file = {
      id: "file-1",
      name: "notes.md",
      path: "/tmp/notes.md",
    };
    const composer = (
      <InputBar
        ref={inputRef}
        onSend={async () => {}}
        onInterrupt={async () => {}}
        isStreaming={false}
      />
    );
    const { rerender } = render(
      <DesignProvider variant="classic">{composer}</DesignProvider>,
    );

    act(() => inputRef.current?.prefillDraft("Review these", [image], [file]));
    rerender(<DesignProvider variant="refined">{composer}</DesignProvider>);
    expect(inputRef.current?.getText()).toBe("Review these");
    expect(inputRef.current?.getImages()).toEqual([image]);
    expect(inputRef.current?.getFileAttachments()).toEqual([file]);

    rerender(<DesignProvider variant="classic">{composer}</DesignProvider>);
    expect(inputRef.current?.getText()).toBe("Review these");
    expect(inputRef.current?.getImages()).toEqual([image]);
    expect(inputRef.current?.getFileAttachments()).toEqual([file]);
  });

  it("keeps inserted slash commands when switching designs", async () => {
    const user = userEvent.setup();
    const composer = (
      <InputBar
        onSend={async () => {}}
        onInterrupt={async () => {}}
        isStreaming={false}
        slashCommands={[{ name: "/review", description: "Review changes" }]}
      />
    );
    const { rerender } = render(
      <DesignProvider variant="classic">{composer}</DesignProvider>,
    );

    await user.type(screen.getByRole("textbox"), "/rev");
    await user.click(screen.getByRole("button", { name: /\/review/ }));
    expect(screen.getByRole("textbox")).toHaveTextContent("/review");

    rerender(<DesignProvider variant="refined">{composer}</DesignProvider>);
    expect(screen.getByRole("textbox")).toHaveTextContent("/review");
  });
});
