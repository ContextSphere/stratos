import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentGroupList } from "../components/AgentGroupList";
import type { Thread } from "@stratosapp/core";
import type { AgentDefinition } from "@stratosapp/core";

function makeThread(id: string, title: string, agentId?: string): Thread {
  return {
    id,
    title,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    cwd: "/proj",
    agentId,
  };
}

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

const baseProps = {
  activeThreadId: null,
  activeAgentId: null,
  collapsedAgentIds: new Set<string>(),
  onToggleAgent: vi.fn(),
  onAgentClick: vi.fn(),
  onThreadClick: vi.fn(),
  onCreateThreadForAgent: vi.fn(),
  onCreateAgent: vi.fn(),
  onDeleteAgent: vi.fn(),
  onDeleteThread: vi.fn(),
  onRenameThread: vi.fn(),
  runningThreadIds: [] as string[],
  threadNotifications: new Map<string, string>(),
};

describe("AgentGroupList", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders a single Bots section, with no Built-in group", () => {
    render(<AgentGroupList {...baseProps} agents={[]} threads={[]} />);
    expect(screen.getByText("Bots")).toBeInTheDocument();
    expect(screen.queryByText("Built-in")).not.toBeInTheDocument();
    expect(screen.queryByText("Yours")).not.toBeInTheDocument();
  });

  it("does not list the built-in Default agent", () => {
    // Default is a runtime fallback for agentless threads, not a browsable
    // agent. Listing it would duplicate the Folders view verbatim.
    render(<AgentGroupList {...baseProps} agents={[]} threads={[]} />);
    expect(screen.queryByText("Default")).not.toBeInTheDocument();
  });

  it("groups a custom agent under Yours", () => {
    const agents = [makeAgent()];
    render(<AgentGroupList {...baseProps} agents={agents} threads={[]} />);
    expect(screen.getByText("Researcher")).toBeInTheDocument();
  });

  it("nests threads under the agent that owns them", () => {
    const agents = [makeAgent()];
    const threads = [makeThread("t1", "Dig into logs", "researcher")];
    render(<AgentGroupList {...baseProps} agents={agents} threads={threads} />);
    expect(screen.getByText("Dig into logs")).toBeInTheDocument();
  });

  it("omits agentless threads entirely — they belong to the Folders view", () => {
    const agents = [makeAgent()];
    const threads = [makeThread("t1", "Unassigned thread")];
    render(<AgentGroupList {...baseProps} agents={agents} threads={threads} />);

    // Nothing owns this thread, so it must not appear here at all — showing it
    // under a Default group would reproduce the Folders view verbatim.
    expect(screen.queryByText("Unassigned thread")).not.toBeInTheDocument();

    // ...and it must not be miscounted against a real agent.
    const researcherRow = screen
      .getByText("Researcher")
      .closest("div")!.parentElement!;
    expect(within(researcherRow).getByText("0")).toBeInTheDocument();
  });

  it("calls onAgentClick when an agent row is clicked", async () => {
    const user = userEvent.setup();
    const agents = [makeAgent()];
    render(<AgentGroupList {...baseProps} agents={agents} threads={[]} />);
    await user.click(screen.getByText("Researcher"));
    expect(baseProps.onAgentClick).toHaveBeenCalledWith("researcher");
  });

  it("calls onThreadClick when a nested thread is clicked", async () => {
    const user = userEvent.setup();
    const agents = [makeAgent()];
    const threads = [makeThread("t1", "Dig into logs", "researcher")];
    render(<AgentGroupList {...baseProps} agents={agents} threads={threads} />);
    await user.click(screen.getByText("Dig into logs"));
    expect(baseProps.onThreadClick).toHaveBeenCalledWith("t1");
  });

  it("calls onCreateThreadForAgent when the per-agent + is clicked", async () => {
    const user = userEvent.setup();
    const agents = [makeAgent()];
    render(<AgentGroupList {...baseProps} agents={agents} threads={[]} />);
    await user.click(screen.getByTitle("New thread with Researcher"));
    expect(baseProps.onCreateThreadForAgent).toHaveBeenCalledWith("researcher");
  });

  it("calls onCreateAgent when the Yours section + is clicked", async () => {
    const user = userEvent.setup();
    render(<AgentGroupList {...baseProps} agents={[]} threads={[]} />);
    await user.click(screen.getByTitle("New bot"));
    expect(baseProps.onCreateAgent).toHaveBeenCalledOnce();
  });

  it("does not show an agent-options menu button for built-in agents", () => {
    render(<AgentGroupList {...baseProps} agents={[]} threads={[]} />);
    expect(screen.queryByTitle("Bot options")).not.toBeInTheDocument();
  });
});
