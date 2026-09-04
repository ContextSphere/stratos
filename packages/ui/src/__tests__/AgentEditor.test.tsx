import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentEditor } from "../components/AgentEditor";
import type { AgentDefinition } from "@stratosapp/core";

function makeAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: "researcher",
    name: "Researcher",
    description: "Digs through docs",
    icon: "🔎",
    accent: "violet",
    builtIn: false,
    ...overrides,
  };
}

describe("AgentEditor", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders empty fields for a new agent", () => {
    render(<AgentEditor onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText("New agent")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("e.g. Release Manager")).toHaveValue("");
  });

  it("prefills fields when editing an existing agent", () => {
    render(
      <AgentEditor agent={makeAgent()} onSave={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByDisplayValue("Researcher")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Digs through docs")).toBeInTheDocument();
  });

  it("disables Save and shows a note for a built-in agent, and hides Delete", () => {
    render(
      <AgentEditor
        agent={makeAgent({ builtIn: true })}
        onSave={vi.fn()}
        onCancel={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(
      screen.getByText("This is a built-in agent and can't be edited."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Save")).not.toBeInTheDocument();
    expect(screen.queryByText("Delete")).not.toBeInTheDocument();
  });

  it("calls onSave with the assembled definition when Save is clicked", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<AgentEditor onSave={onSave} onCancel={vi.fn()} />);

    await user.type(
      screen.getByPlaceholderText("e.g. Release Manager"),
      "Reviewer",
    );
    await user.click(screen.getByText("Save"));

    expect(onSave).toHaveBeenCalledOnce();
    const saved = onSave.mock.calls[0][0] as AgentDefinition;
    expect(saved.name).toBe("Reviewer");
    expect(saved.id).toBe("reviewer");
  });

  it("calls onCancel when Cancel is clicked", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<AgentEditor onSave={vi.fn()} onCancel={onCancel} />);
    await user.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("calls onDelete with the agent id when Delete is clicked", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(
      <AgentEditor
        agent={makeAgent()}
        onSave={vi.fn()}
        onCancel={vi.fn()}
        onDelete={onDelete}
      />,
    );
    await user.click(screen.getByText("Delete"));
    expect(onDelete).toHaveBeenCalledWith("researcher");
  });

  it("blocks Save and surfaces the error when an MCP server is named 'stratos'", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<AgentEditor onSave={onSave} onCancel={vi.fn()} />);

    await user.type(
      screen.getByPlaceholderText("e.g. Release Manager"),
      "Reviewer",
    );
    await user.click(screen.getByText("+ Add MCP server"));
    await user.type(screen.getByPlaceholderText("name"), "stratos");
    await user.type(screen.getByPlaceholderText("url"), "http://localhost");

    expect(
      screen.getByText('"stratos" is reserved by Stratos'),
    ).toBeInTheDocument();

    const saveButton = screen.getByText("Save");
    expect(saveButton).toBeDisabled();
    await user.click(saveButton);
    expect(onSave).not.toHaveBeenCalled();
  });
});
