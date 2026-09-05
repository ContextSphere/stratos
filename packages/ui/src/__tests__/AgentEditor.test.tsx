import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentEditor } from "../components/AgentEditor";
import type { AgentDefinition } from "@stratosapp/core";
import { DesignProvider } from "../context/DesignContext";

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
    expect(screen.getByLabelText("Name")).toHaveAttribute("id", "agent-name");
    expect(screen.getByLabelText("Provider")).toBeInTheDocument();
  });

  it("prefills fields when editing an existing agent", () => {
    render(
      <AgentEditor agent={makeAgent()} onSave={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByDisplayValue("Researcher")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Digs through docs")).toBeInTheDocument();
  });

  it("uses provider-specific permission labels", () => {
    render(
      <AgentEditor
        agent={makeAgent({ provider: "codex", mode: "default" })}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByDisplayValue("Default permissions")).toBeInTheDocument();
  });

  it("blocks saving an unsupported glyph and explains the compact format", async () => {
    const user = userEvent.setup();
    render(
      <AgentEditor agent={makeAgent()} onSave={vi.fn()} onCancel={vi.fn()} />,
    );

    const glyph = screen.getByLabelText("Glyph");
    await user.clear(glyph);
    await user.type(glyph, "🤖");

    expect(screen.getByText("1–2 letters or numbers")).toBeInTheDocument();
    expect(screen.getByText("Use 1–2 letters or numbers.")).toBeInTheDocument();
    expect(screen.getByText("Save")).toBeDisabled();
  });

  it("preserves emoji icons in the classic editor", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <DesignProvider variant="classic">
        <AgentEditor
          agent={makeAgent({ icon: "🤖" })}
          onSave={onSave}
          onCancel={vi.fn()}
        />
      </DesignProvider>,
    );

    expect(screen.getByDisplayValue("🤖")).toBeInTheDocument();
    await user.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ icon: "🤖" }),
    );
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
      screen.getByText(
        "This built-in agent is read-only. Its settings are shown here for reference.",
      ),
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
    await user.click(screen.getByText("Delete agent"));
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
    await user.click(screen.getByText("Add MCP server"));
    await user.type(screen.getByPlaceholderText("name"), "stratos");
    await user.type(
      screen.getByPlaceholderText("https://example.com/mcp"),
      "http://localhost",
    );

    expect(
      screen.getByText('"stratos" is reserved by Stratos'),
    ).toBeInTheDocument();

    const saveButton = screen.getByText("Save");
    expect(saveButton).toBeDisabled();
    await user.click(saveButton);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("preserves MCP command options and optional agent settings on save", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <AgentEditor
        agent={makeAgent({
          mcpServers: {
            local: {
              type: "stdio",
              command: "npx server",
              args: ["", "--verbose"],
              env: { EMPTY: "", API_KEY: "kept" },
            },
          },
          telegram: { enabled: true, trustedChatId: "42" },
        })}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByText("Save"));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        telegram: { enabled: true, trustedChatId: "42" },
        mcpServers: {
          local: expect.objectContaining({
            args: ["", "--verbose"],
            env: { EMPTY: "", API_KEY: "kept" },
          }),
        },
      }),
    );
  });

  it("keeps malformed environment rows visible and blocks saving until fixed", async () => {
    const user = userEvent.setup();
    render(<AgentEditor onSave={vi.fn()} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText("Name"), "Reviewer");
    await user.click(screen.getByText("Add MCP server"));
    await user.type(screen.getByLabelText("Server name"), "local");
    await user.type(screen.getByLabelText("URL"), "http://localhost/mcp");
    await user.click(screen.getByText("Command arguments and environment"));
    await user.type(
      screen.getByLabelText("Environment, KEY=value per line"),
      "MALFORMED",
    );

    expect(
      screen.getByText("local: each environment line must use KEY=value."),
    ).toBeInTheDocument();
    expect(screen.getByText("Save")).toBeDisabled();
  });
});
