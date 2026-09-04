import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PendingMessages } from "../components/PendingMessages";

const pending = [
  {
    id: "p1",
    prompt: "write the tests next",
    images: [{ dataUrl: "data:image/png;base64,AA", mimeType: "image/png" }],
    fellBack: false,
    force: false,
  },
];

describe("PendingMessages", () => {
  afterEach(() => cleanup());

  it("shows message state, attachments, and all actions while streaming", () => {
    render(
      <PendingMessages
        pending={pending}
        isStreaming
        onCancel={vi.fn()}
        onPromote={vi.fn()}
        onEdit={vi.fn()}
      />,
    );

    expect(screen.getByText("queued")).toBeInTheDocument();
    expect(screen.getByText("write the tests next")).toBeInTheDocument();
    expect(screen.getByText("1 image")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Steer now" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Interrupt" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cancel queued message" }),
    ).toBeInTheDocument();
  });

  it("dispatches edit, steer, break, and cancel actions", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const onPromote = vi.fn();
    const onCancel = vi.fn();
    render(
      <PendingMessages
        pending={pending}
        isStreaming
        onCancel={onCancel}
        onPromote={onPromote}
        onEdit={onEdit}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Steer now" }));
    await user.click(screen.getByRole("button", { name: "Interrupt" }));
    await user.click(
      screen.getByRole("button", { name: "Cancel queued message" }),
    );

    expect(onEdit).toHaveBeenCalledWith(pending[0]);
    expect(onPromote).toHaveBeenNthCalledWith(1, "p1", "steer");
    expect(onPromote).toHaveBeenNthCalledWith(2, "p1", "break");
    expect(onCancel).toHaveBeenCalledWith("p1");
  });

  it("shows steer fallback and does not offer steer-now", () => {
    render(
      <PendingMessages
        pending={[{ ...pending[0], fellBack: true }]}
        isStreaming
        onCancel={vi.fn()}
        onPromote={vi.fn()}
        onEdit={vi.fn()}
      />,
    );

    expect(
      screen.getByText("Couldn't steer. Queued for the next turn."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Steer now" }),
    ).not.toBeInTheDocument();
  });
});
