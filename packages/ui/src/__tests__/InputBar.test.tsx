import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InputBar } from "../components/InputBar";

function makeProps(
  overrides: Partial<React.ComponentProps<typeof InputBar>> = {},
) {
  return {
    onSend: vi.fn().mockResolvedValue(undefined),
    onInterrupt: vi.fn().mockResolvedValue(undefined),
    isStreaming: false,
    ...overrides,
  };
}

/**
 * Helper to set text on a contentEditable div and fire the input event
 * so React state updates are triggered (same technique as CLAUDE.md CDP section).
 */
function setContentEditable(el: HTMLElement, text: string) {
  el.textContent = text;
  fireEvent.input(el);
}

describe("InputBar", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // ---------- basic rendering ----------

  it("renders without crashing", () => {
    render(<InputBar {...makeProps()} />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("shows default placeholder text when empty", () => {
    render(<InputBar {...makeProps()} />);
    const textbox = screen.getByRole("textbox");
    expect(textbox).toHaveAttribute("data-placeholder", "Type a message...");
  });

  it("shows plan-review placeholder when interactiveMode is plan-review", () => {
    render(
      <InputBar
        {...makeProps({
          interactiveMode: { type: "plan-review", requestId: "r1", data: {} },
        })}
      />,
    );
    expect(screen.getByRole("textbox")).toHaveAttribute(
      "data-placeholder",
      "Provide feedback to revise the plan...",
    );
  });

  it("shows question placeholder when interactiveMode is question", () => {
    render(
      <InputBar
        {...makeProps({
          interactiveMode: { type: "question", requestId: "r1", data: {} },
        })}
      />,
    );
    expect(screen.getByRole("textbox")).toHaveAttribute(
      "data-placeholder",
      "Type your answer...",
    );
  });

  // ---------- send button state ----------

  it("send button is disabled when input is empty", () => {
    render(<InputBar {...makeProps()} />);
    expect(screen.getByTitle("Send")).toBeDisabled();
  });

  it("send button becomes enabled after typing content", () => {
    render(<InputBar {...makeProps()} />);
    const textbox = screen.getByRole("textbox");
    setContentEditable(textbox, "hello");
    expect(screen.getByTitle("Send")).not.toBeDisabled();
  });

  it("send button is disabled again after content is cleared", () => {
    render(<InputBar {...makeProps()} />);
    const textbox = screen.getByRole("textbox");
    setContentEditable(textbox, "hello");
    expect(screen.getByTitle("Send")).not.toBeDisabled();
    setContentEditable(textbox, "");
    expect(screen.getByTitle("Send")).toBeDisabled();
  });

  it("send button is disabled when content is only whitespace", () => {
    render(<InputBar {...makeProps()} />);
    const textbox = screen.getByRole("textbox");
    setContentEditable(textbox, "   ");
    expect(screen.getByTitle("Send")).toBeDisabled();
  });

  // ---------- streaming state ----------

  it("shows Stop button instead of Send when isStreaming is true", () => {
    render(<InputBar {...makeProps({ isStreaming: true })} />);
    expect(screen.getByTitle("Stop")).toBeInTheDocument();
    expect(screen.queryByTitle("Send")).not.toBeInTheDocument();
  });

  it("calls onInterrupt when Stop button is clicked", async () => {
    const user = userEvent.setup();
    const props = makeProps({ isStreaming: true });
    render(<InputBar {...props} />);
    await user.click(screen.getByTitle("Stop"));
    expect(props.onInterrupt).toHaveBeenCalledOnce();
  });

  // ---------- submit behavior ----------

  it("calls onSend with trimmed text when send button is clicked", async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<InputBar {...props} />);
    const textbox = screen.getByRole("textbox");
    setContentEditable(textbox, "  hello world  ");
    await user.click(screen.getByTitle("Send"));
    expect(props.onSend).toHaveBeenCalledOnce();
    expect(props.onSend).toHaveBeenCalledWith("hello world", undefined);
  });

  it("does NOT call onSend when content is empty and send button is clicked (disabled)", async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<InputBar {...props} />);
    // button is disabled so click is a no-op, but verify onSend is not called
    await user.click(screen.getByTitle("Send"));
    expect(props.onSend).not.toHaveBeenCalled();
  });

  it("clears the textbox after successful send", async () => {
    const user = userEvent.setup();
    render(<InputBar {...makeProps()} />);
    const textbox = screen.getByRole("textbox");
    setContentEditable(textbox, "hello");
    await user.click(screen.getByTitle("Send"));
    // after send the editable should be empty (innerHTML cleared)
    expect(textbox.textContent).toBe("");
  });

  // ---------- Enter key ----------

  it("calls onSend when Enter is pressed with text", async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<InputBar {...props} />);
    const textbox = screen.getByRole("textbox");
    setContentEditable(textbox, "press enter");
    await user.type(textbox, "{Enter}");
    expect(props.onSend).toHaveBeenCalledWith("press enter", undefined);
  });

  it("does NOT call onSend when Shift+Enter is pressed", async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<InputBar {...props} />);
    const textbox = screen.getByRole("textbox");
    setContentEditable(textbox, "multiline");
    await user.type(textbox, "{Shift>}{Enter}{/Shift}");
    expect(props.onSend).not.toHaveBeenCalled();
  });

  it("does NOT call onSend when content is empty and Enter is pressed", async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<InputBar {...props} />);
    const textbox = screen.getByRole("textbox");
    // textbox is empty — pressing Enter should not trigger a send
    await user.type(textbox, "{Enter}");
    expect(props.onSend).not.toHaveBeenCalled();
  });

  // ---------- interactive mode ----------

  it("calls onInteractiveResponse instead of onSend in plan-review mode", async () => {
    const user = userEvent.setup();
    const onInteractiveResponse = vi.fn();
    render(
      <InputBar
        {...makeProps({
          interactiveMode: { type: "plan-review", requestId: "r1", data: {} },
          onInteractiveResponse,
        })}
      />,
    );
    const textbox = screen.getByRole("textbox");
    setContentEditable(textbox, "looks good");
    await user.click(screen.getByTitle("Send"));
    expect(onInteractiveResponse).toHaveBeenCalledWith("looks good");
  });

  it("shows Send button (not Stop) in interactive mode even when isStreaming", () => {
    render(
      <InputBar
        {...makeProps({
          isStreaming: true,
          interactiveMode: { type: "question", requestId: "r2", data: {} },
        })}
      />,
    );
    expect(screen.getByTitle("Send")).toBeInTheDocument();
    expect(screen.queryByTitle("Stop")).not.toBeInTheDocument();
  });

  // ---------- attach image button ----------

  it("renders the attach image button", () => {
    render(<InputBar {...makeProps()} />);
    expect(screen.getByTitle("Attach image")).toBeInTheDocument();
  });
});
