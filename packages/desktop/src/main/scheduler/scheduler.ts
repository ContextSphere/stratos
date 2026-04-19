import cron, { type ScheduledTask } from "node-cron";
import { Notification, BrowserWindow } from "electron";
import { writeFileSync, existsSync, mkdirSync, watch, chmodSync } from "fs";
import type { FSWatcher } from "fs";
import { join } from "path";
import { homedir } from "os";
import { IPC_CHANNELS } from "../../common/ipc-channels";
import type { AgentManager } from "../agent-manager";
import type { ScheduledPrompt } from "@stratosapp/core";
import {
  loadScheduledPrompts,
  updateScheduledPrompt,
  FileStorageAdapter,
  scheduleToCron,
} from "@stratosapp/core";
import { SCHEDULE_MCP_SOURCE } from "./schedule-mcp-source";

/** Path to the installed MCP server script. */
export function getScheduleMcpPath(): string {
  return join(homedir(), ".stratos", "bin", "stratos-schedule-mcp");
}

export class SchedulerManager {
  private tasks = new Map<string, ScheduledTask>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private agentManager: AgentManager;
  private storage: FileStorageAdapter;
  private window: BrowserWindow;
  private fileWatcher: FSWatcher | null = null;

  constructor(
    agentManager: AgentManager,
    storage: FileStorageAdapter,
    window: BrowserWindow,
  ) {
    this.agentManager = agentManager;
    this.storage = storage;
    this.window = window;
  }

  /** Load all enabled schedules from disk, install CLI, and start file watcher. */
  initialize(): void {
    this.installMcpServer();

    const prompts = loadScheduledPrompts();

    // Recovery: mark any stale "running" entries as "error"
    for (const p of prompts) {
      if (p.lastRunStatus === "running") {
        updateScheduledPrompt(p.id, {
          lastRunStatus: "error",
        });
      }
    }

    for (const p of prompts) {
      if (p.enabled) {
        this.schedulePrompt(p);
      }
    }

    this.watchStoreFile();
  }

  /** Register a cron task or setTimeout for a prompt. */
  schedulePrompt(prompt: ScheduledPrompt): void {
    // Clean up any existing task for this prompt
    this.unschedulePrompt(prompt.id);

    if (!prompt.enabled) return;

    if (prompt.schedule.type === "once") {
      this.scheduleOnce(prompt);
    } else {
      this.scheduleRecurring(prompt);
    }
  }

  /** Unschedule a prompt (stop its cron task or clear its timeout). */
  unschedulePrompt(id: string): void {
    const task = this.tasks.get(id);
    if (task) {
      task.stop();
      this.tasks.delete(id);
    }
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }

  /** Execute a prompt immediately (for "Run Now" or scheduled tick). */
  async executePrompt(prompt: ScheduledPrompt): Promise<string | null> {
    // Resolve folder to get cwd
    const folders = this.storage.listFolders();
    const folder = folders.find((f) => f.id === prompt.folderId);
    if (!folder) {
      updateScheduledPrompt(prompt.id, {
        lastRunStatus: "error",
        lastRunAt: Date.now(),
      });
      this.notifyChanged();
      console.error(
        `[scheduler] Folder ${prompt.folderId} not found for scheduled prompt ${prompt.id}`,
      );
      return null;
    }

    // Create thread
    const now = new Date();
    const dateStr = now.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const title = `${prompt.name} — ${dateStr}`;
    const thread = this.storage.createThread(
      title,
      prompt.model,
      folder.path,
      prompt.provider,
    );

    // Set scheduledPromptId and mode on the thread
    this.storage.updateThread(thread.id, {
      scheduledPromptId: prompt.id,
      mode: "bypassPermissions",
    });

    // Update run status
    updateScheduledPrompt(prompt.id, {
      lastRunAt: Date.now(),
      lastRunThreadId: thread.id,
      lastRunStatus: "running",
    });
    this.notifyChanged();

    // Execute in background
    this.agentManager
      .runScheduledPrompt(thread.id, prompt.prompt)
      .then(() => {
        updateScheduledPrompt(prompt.id, { lastRunStatus: "completed" });
        this.notifyChanged();

        // Desktop notification on completion
        if (!this.window.isDestroyed() && !this.window.isFocused()) {
          const notification = new Notification({
            title: "Scheduled Prompt Completed",
            body: `"${prompt.name}" finished running.`,
          });
          notification.on("click", () => {
            this.window.show();
            this.window.focus();
          });
          notification.show();
        }
      })
      .catch((err) => {
        updateScheduledPrompt(prompt.id, {
          lastRunStatus: "error",
        });
        this.notifyChanged();
        console.error(
          `[scheduler] Error executing scheduled prompt ${prompt.id}:`,
          err,
        );
      });

    // For one-time schedules, auto-disable after execution
    if (prompt.schedule.type === "once") {
      updateScheduledPrompt(prompt.id, { enabled: false });
      this.unschedulePrompt(prompt.id);
      this.notifyChanged();
    }

    return thread.id;
  }

  /** Reschedule all prompts (call after CRUD changes). */
  refreshAll(): void {
    // Stop everything
    for (const [id] of this.tasks) {
      this.unschedulePrompt(id);
    }
    for (const [id] of this.timers) {
      this.unschedulePrompt(id);
    }

    // Reload and re-register
    const prompts = loadScheduledPrompts();
    for (const p of prompts) {
      if (p.enabled) {
        this.schedulePrompt(p);
      }
    }
  }

  /** Clean up all tasks on app exit. */
  dispose(): void {
    this.fileWatcher?.close();
    this.fileWatcher = null;
    for (const [, task] of this.tasks) {
      task.stop();
    }
    this.tasks.clear();
    for (const [, timer] of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  /** Install the stratos-schedule-mcp server to ~/.stratos/bin/ */
  private installMcpServer(): void {
    try {
      const binDir = join(homedir(), ".stratos", "bin");
      if (!existsSync(binDir)) mkdirSync(binDir, { recursive: true });
      const mcpPath = getScheduleMcpPath();
      writeFileSync(mcpPath, SCHEDULE_MCP_SOURCE, "utf-8");
      chmodSync(mcpPath, 0o755);
    } catch (err) {
      console.error("[scheduler] Failed to install MCP server:", err);
    }
  }

  /** Watch scheduled-prompts.json for external changes (e.g. from CLI). */
  private watchStoreFile(): void {
    const storePath = join(homedir(), ".stratos", "scheduled-prompts.json");
    // Ensure the file exists so we can watch it
    if (!existsSync(storePath)) return;

    let debounce: ReturnType<typeof setTimeout> | null = null;
    try {
      this.fileWatcher = watch(storePath, () => {
        // Debounce: multiple events fire per write
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => {
          this.refreshAll();
          this.notifyChanged();
        }, 500);
      });
    } catch {
      // Watching may fail on some platforms; non-critical
    }
  }

  private scheduleOnce(prompt: ScheduledPrompt): void {
    if (!prompt.schedule.runAt) return;
    const runAt = new Date(prompt.schedule.runAt);
    const delay = runAt.getTime() - Date.now();
    if (delay <= 0) {
      // Already past — skip (was either already run or missed)
      return;
    }
    const timer = setTimeout(() => {
      this.timers.delete(prompt.id);
      this.executePrompt(prompt);
    }, delay);
    this.timers.set(prompt.id, timer);
  }

  private scheduleRecurring(prompt: ScheduledPrompt): void {
    try {
      const cronExpr = scheduleToCron(prompt.schedule);
      const task = cron.schedule(cronExpr, () => {
        // Re-read from disk in case it was disabled between ticks
        const current = loadScheduledPrompts().find((p) => p.id === prompt.id);
        if (current?.enabled) {
          this.executePrompt(current);
        }
      });
      this.tasks.set(prompt.id, task);
    } catch (err) {
      console.error(
        `[scheduler] Failed to schedule recurring prompt ${prompt.id}:`,
        err,
      );
    }
  }

  private notifyChanged(): void {
    if (this.window.isDestroyed() || this.window.webContents.isDestroyed()) {
      return;
    }
    this.window.webContents.send(IPC_CHANNELS.SCHEDULED_CHANGED);
  }
}
