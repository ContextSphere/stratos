import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Sidebar } from "../components/Sidebar";
import type { Thread, Folder } from "@stratosapp/core";

function makeThread(id: string, title: string, cwd?: string): Thread {
  return { id, title, createdAt: Date.now(), updatedAt: Date.now(), cwd };
}

function makeFolder(id: string, name: string, path: string): Folder {
  return { id, name, path, createdAt: Date.now() };
}

describe("Sidebar", () => {
  const defaultProps = {
    threads: [
      makeThread("t1", "Thread One", "/proj"),
      makeThread("t2", "Thread Two", "/proj"),
    ],
    folders: [makeFolder("f1", "proj", "/proj")],
    activeThreadId: "t1",
    onThreadClick: vi.fn(),
    onCreateThreadInFolder: vi.fn(),
    onAddFolder: vi.fn(),
    onRemoveFolder: vi.fn(),
    onToggleFolderCollapsed: vi.fn(),
    onDeleteThread: vi.fn(),
    onToggleSidebar: vi.fn(),
    onSettingsClick: vi.fn(),
    runningThreadIds: [] as string[],
    threadNotifications: new Map<string, string>(),
  };

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the Stratos branding", () => {
    render(<Sidebar {...defaultProps} />);
    expect(screen.getByText("Stratos")).toBeInTheDocument();
  });

  it("renders thread titles under folder", () => {
    render(<Sidebar {...defaultProps} />);
    expect(screen.getByText("Thread One")).toBeInTheDocument();
    expect(screen.getByText("Thread Two")).toBeInTheDocument();
  });

  it("calls onSettingsClick when settings button is clicked", async () => {
    const user = userEvent.setup();
    render(<Sidebar {...defaultProps} />);
    await user.click(screen.getByTitle("Settings"));
    expect(defaultProps.onSettingsClick).toHaveBeenCalledOnce();
  });

  it("calls onToggleSidebar when collapse button is clicked", async () => {
    const user = userEvent.setup();
    render(<Sidebar {...defaultProps} />);
    await user.click(screen.getByTitle("Collapse sidebar"));
    expect(defaultProps.onToggleSidebar).toHaveBeenCalledOnce();
  });

  it("calls onAddFolder when add folder button is clicked", async () => {
    const user = userEvent.setup();
    render(<Sidebar {...defaultProps} />);
    await user.click(screen.getByTitle("Add folder"));
    expect(defaultProps.onAddFolder).toHaveBeenCalledOnce();
  });

  it("calls onThreadClick when a thread is clicked", async () => {
    const user = userEvent.setup();
    render(<Sidebar {...defaultProps} />);
    await user.click(screen.getByText("Thread Two"));
    expect(defaultProps.onThreadClick).toHaveBeenCalledWith("t2");
  });
});
