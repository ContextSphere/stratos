import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AgentDefinition } from "@stratosapp/core";
import { AgentEditor } from "../components/AgentEditor";
import { DesignProvider } from "../context/DesignContext";

function makeAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: "researcher",
    name: "Researcher",
    description: "Digs through docs",
    icon: "R",
    accent: "violet",
    builtIn: false,
    prompt: "Find primary sources and report the evidence.",
    ...overrides,
  };
}

describe("AgentEditor", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("keeps a fresh bot form focused and quiet", () => {
    render(<AgentEditor onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText("Create a bot")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("");
    expect(
      screen.getByLabelText("Operational instructions"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Provider")).toBeInTheDocument();
    expect(screen.getByLabelText("Model")).toBeInTheDocument();
    expect(screen.getByLabelText("Description")).not.toBeVisible();
    expect(screen.queryByText("name is required")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Operational instructions are required."),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Advanced configuration" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
  });

  it("shows required feedback only after the related field is blurred", async () => {
    const user = userEvent.setup();
    render(<AgentEditor onSave={vi.fn()} onCancel={vi.fn()} />);
    await user.click(screen.getByLabelText("Name"));
    await user.tab();
    expect(screen.getByText("name is required")).toBeInTheDocument();
    expect(
      screen.queryByText("Operational instructions are required."),
    ).not.toBeInTheDocument();
    await user.click(screen.getByLabelText("Operational instructions"));
    await user.tab();
    expect(
      screen.getByText("Operational instructions are required."),
    ).toBeInTheDocument();
  });

  it("creates a bot and can start its first chat", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<AgentEditor onSave={onSave} onCancel={vi.fn()} />);
    await user.type(screen.getByLabelText("Name"), "Reviewer");
    await user.type(
      screen.getByLabelText("Operational instructions"),
      "Review pull requests.",
    );
    await user.click(
      screen.getByRole("button", { name: "Create and start chat" }),
    );
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "reviewer",
        name: "Reviewer",
        prompt: "Review pull requests.",
      }),
      { startChat: true },
    );
  });

  it("keeps advanced configuration disclosed only on demand", async () => {
    const user = userEvent.setup();
    render(<AgentEditor onSave={vi.fn()} onCancel={vi.fn()} />);
    await user.click(
      screen.getByRole("button", { name: "Advanced configuration" }),
    );
    expect(screen.getByLabelText("Description")).toBeInTheDocument();
    expect(screen.getByLabelText("Permissions")).toBeInTheDocument();
    expect(screen.getByText("Tools")).toBeInTheDocument();
  });

  it("retains the entered draft after an async save error", async () => {
    const user = userEvent.setup();
    const onSave = vi
      .fn()
      .mockRejectedValue(new Error("A bot named Reviewer already exists"));
    render(<AgentEditor onSave={onSave} onCancel={vi.fn()} />);
    await user.type(screen.getByLabelText("Name"), "Reviewer");
    await user.type(
      screen.getByLabelText("Operational instructions"),
      "Review changes.",
    );
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A bot named Reviewer already exists",
    );
    expect(screen.getByLabelText("Name")).toHaveValue("Reviewer");
    expect(screen.getByLabelText("Operational instructions")).toHaveValue(
      "Review changes.",
    );
  });

  it("preserves MCP args, env, and agent metadata while editing", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const agent = makeAgent({
      mcpServers: {
        docs: {
          type: "stdio",
          command: "docs-mcp",
          args: ["--readonly"],
          env: { DOCS_TOKEN: "reference" },
        },
      },
      telegram: { enabled: true, trustedChatId: "42" },
    });
    render(<AgentEditor agent={agent} onSave={onSave} onCancel={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        mcpServers: agent.mcpServers,
        telegram: agent.telegram,
      }),
      { startChat: false },
    );
  });

  it("keeps provider-specific permission labels in the refined editor", () => {
    render(
      <AgentEditor
        agent={makeAgent({ provider: "codex", mode: "default" })}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue("Default permissions")).toBeInTheDocument();
  });

  it("uses the same low-friction flow in the classic variant", () => {
    render(
      <DesignProvider variant="classic">
        <AgentEditor onSave={vi.fn()} onCancel={vi.fn()} />
      </DesignProvider>,
    );
    expect(screen.getByText("Create a bot")).toBeInTheDocument();
    expect(screen.getByLabelText("Provider")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Operational instructions"),
    ).toBeInTheDocument();
  });

  it("disables mutation controls for built-in agents", () => {
    render(
      <AgentEditor
        agent={makeAgent({ builtIn: true })}
        onSave={vi.fn()}
        onCancel={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Save changes" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Delete bot" }),
    ).not.toBeInTheDocument();
  });
});
