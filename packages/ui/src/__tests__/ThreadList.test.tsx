import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThreadList } from "../components/ThreadList";
import type { Thread, Folder } from "@stratosapp/core";

function makeThread(id: string, title: string, cwd?: string): Thread {
  return { id, title, createdAt: Date.now(), updatedAt: Date.now(), cwd };
}

function makeFolder(id: string, name: string, path: string): Folder {
  return { id, name, path, createdAt: Date.now() };
}

const baseProps = {
  onThreadClick: vi.fn(),
  onCreateThreadInFolder: vi.fn(),
  onAddFolder: vi.fn(),
  onRemoveFolder: vi.fn(),
  onToggleFolderCollapsed: vi.fn(),
  onDeleteThread: vi.fn(),
  runningThreadIds: [] as string[],
  threadNotifications: new Map<string, string>(),
};

describe("ThreadList", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows empty state when no folders", () => {
    render(
      <ThreadList
        {...baseProps}
        threads={[]}
        folders={[]}
        activeThreadId={null}
      />,
    );
    expect(screen.getByText("Add a folder")).toBeInTheDocument();
  });

  it("renders folder names", () => {
    const folders = [makeFolder("f1", "my-project", "/home/user/my-project")];
    render(
      <ThreadList
        {...baseProps}
        threads={[]}
        folders={folders}
        activeThreadId={null}
      />,
    );
    expect(screen.getByText("my-project")).toBeInTheDocument();
  });

  it("renders threads under their folder", () => {
    const folders = [makeFolder("f1", "my-project", "/home/user/my-project")];
    const threads = [makeThread("a", "Alpha", "/home/user/my-project")];
    render(
      <ThreadList
        {...baseProps}
        threads={threads}
        folders={folders}
        activeThreadId={null}
      />,
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });

  it('shows "No threads" for empty folders', () => {
    const folders = [makeFolder("f1", "my-project", "/home/user/my-project")];
    render(
      <ThreadList
        {...baseProps}
        threads={[]}
        folders={folders}
        activeThreadId={null}
      />,
    );
    expect(screen.getByText("No threads")).toBeInTheDocument();
  });

  it("highlights the active thread", () => {
    const folders = [makeFolder("f1", "proj", "/proj")];
    const threads = [
      makeThread("a", "Alpha", "/proj"),
      makeThread("b", "Beta", "/proj"),
    ];
    render(
      <ThreadList
        {...baseProps}
        threads={threads}
        folders={folders}
        activeThreadId="a"
      />,
    );
    const alphaEl = screen
      .getByText("Alpha")
      .closest('div[class*="rounded-lg"]')!;
    expect(alphaEl.className).toContain("bg-[var(--border)]");
    const betaEl = screen
      .getByText("Beta")
      .closest('div[class*="rounded-lg"]')!;
    expect(betaEl.className).not.toContain("bg-[var(--border)]");
  });

  it("calls onThreadClick with correct id", async () => {
    const user = userEvent.setup();
    const folders = [makeFolder("f1", "proj", "/proj")];
    const threads = [makeThread("a", "Alpha", "/proj")];
    render(
      <ThreadList
        {...baseProps}
        threads={threads}
        folders={folders}
        activeThreadId={null}
      />,
    );
    await user.click(screen.getByText("Alpha"));
    expect(baseProps.onThreadClick).toHaveBeenCalledWith("a");
  });

  it("calls onAddFolder when add folder button is clicked", async () => {
    const user = userEvent.setup();
    render(
      <ThreadList
        {...baseProps}
        threads={[]}
        folders={[]}
        activeThreadId={null}
      />,
    );
    await user.click(screen.getByTitle("Add folder"));
    expect(baseProps.onAddFolder).toHaveBeenCalledOnce();
  });

  it("shows the Threads header", () => {
    render(
      <ThreadList
        {...baseProps}
        threads={[]}
        folders={[]}
        activeThreadId={null}
      />,
    );
    expect(screen.getByText("Threads")).toBeInTheDocument();
  });
});
