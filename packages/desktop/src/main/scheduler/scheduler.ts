import cron, { type ScheduledTask } from "node-cron";
import { Notification, BrowserWindow } from "electron";
import { existsSync, watch } from "fs";
import type { FSWatcher } from "fs";
import { join } from "path";
import { homedir } from "os";
import { IPC_CHANNELS } from "../../common/ipc-channels";
import type { AgentManager } from "../agent-manager";
import type {
  ScheduledPrompt,
  ScheduleRunRecord,
  Folder,
} from "@stratosapp/core";
import {
  loadScheduledPrompts,
  updateScheduledPrompt,
  FileStorageAdapter,
  scheduleToCron,
} from "@stratosapp/core";
import type { ManagerSession } from "../manager/manager-session";
import { consumeReport, clearReport } from "./schedule-report-store";
import { decoratePromptWithSchedule } from "./decorate-prompt";

export class SchedulerManager {
  private tasks = new Map<string, ScheduledTask>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private agentManager: AgentManager;
  private storage: FileStorageAdapter;
  private window: BrowserWindow;
  private fileWatcher: FSWatcher | null = null;
  private managerSession: ManagerSession | null = null;

  constructor(
    agentManager: AgentManager,
    storage: FileStorageAdapter,
    window: BrowserWindow,
  ) {
    this.agentManager = agentManager;
    this.storage = storage;
    this.window = window;
  }

  /**
   * Wire the ManagerSession reference. Done after both have been constructed
   * since ManagerSession is initialized after SchedulerManager in main/index.ts.
   * Required for routeToManager schedules and for completion notifications.
   */
  setManagerSession(managerSession: ManagerSession): void {
    this.managerSession = managerSession;
  }

  /** Load all enabled schedules from disk and start the file watcher. */
  initialize(): void {
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

    if (prompt.routeToManager) {
      return this.executeViaManager(prompt, folder);
    }
    return this.executeDirect(prompt, folder);
  }

  /**
   * Default execution path: scheduler creates the thread itself and runs the
   * prompt directly via AgentManager. Manager is notified on completion via
   * a lightweight record (success) or a real LLM turn (failure).
   */
  private async executeDirect(
    prompt: ScheduledPrompt,
    folder: Folder,
  ): Promise<string | null> {
    const startedAt = Date.now();

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

    this.storage.updateThread(thread.id, {
      scheduledPromptId: prompt.id,
      mode: "bypassPermissions",
    });

    updateScheduledPrompt(prompt.id, {
      lastRunAt: startedAt,
      lastRunThreadId: thread.id,
      lastRunStatus: "running",
    });
    this.notifyChanged();

    // Make sure no stale summary from a prior run is consumed by this one.
    clearReport(prompt.id);

    const decoratedPrompt = this.decoratePromptWithContext(prompt, folder);

    this.agentManager
      .runScheduledPrompt(thread.id, decoratedPrompt)
      .then(() => {
        updateScheduledPrompt(prompt.id, { lastRunStatus: "completed" });
        this.notifyChanged();
        this.finalizeRun(prompt, folder, thread.id, startedAt, "completed");
      })
      .catch((err) => {
        updateScheduledPrompt(prompt.id, { lastRunStatus: "error" });
        this.notifyChanged();
        console.error(
          `[scheduler] Error executing scheduled prompt ${prompt.id}:`,
          err,
        );
        this.finalizeRun(
          prompt,
          folder,
          thread.id,
          startedAt,
          "error",
          err instanceof Error ? err.message : String(err),
        );
      });

    if (prompt.schedule.type === "once") {
      updateScheduledPrompt(prompt.id, { enabled: false });
      this.unschedulePrompt(prompt.id);
      this.notifyChanged();
    }

    return thread.id;
  }

  /**
   * routeToManager execution path: scheduler hands the prompt off to the
   * Manager, which decides how to dispatch (typically by calling create_session
   * with the schedule context). When the Manager-spawned child completes,
   * ManagerSession invokes the callback registered here so we can update
   * bookkeeping. We do NOT create the thread ourselves — Manager owns that.
   */
  private async executeViaManager(
    prompt: ScheduledPrompt,
    folder: Folder,
  ): Promise<string | null> {
    if (!this.managerSession) {
      console.error(
        `[scheduler] routeToManager schedule ${prompt.id} fired before ManagerSession was wired; falling back to direct execution`,
      );
      return this.executeDirect(prompt, folder);
    }

    const startedAt = Date.now();

    updateScheduledPrompt(prompt.id, {
      lastRunAt: startedAt,
      lastRunStatus: "running",
    });
    this.notifyChanged();

    clearReport(prompt.id);

    this.managerSession.sendFromScheduler(
      prompt,
      folder.path,
      (status, errorMessage) => {
        updateScheduledPrompt(prompt.id, { lastRunStatus: status });
        this.notifyChanged();
        // We don't know the threadId — Manager spawned it. Look it up from
        // storage by scheduledPromptId. Best-effort; fall back to "" if not
        // found (record still useful with workspace + summary).
        const threads = this.storage.listThreads();
        const childThread = [...threads]
          .reverse()
          .find(
            (t) =>
              t.scheduledPromptId === prompt.id && t.spawnedBy === "manager",
          );
        const threadId = childThread?.id ?? "";
        if (threadId) {
          updateScheduledPrompt(prompt.id, { lastRunThreadId: threadId });
        }
        this.finalizeRun(
          prompt,
          folder,
          threadId,
          startedAt,
          status,
          errorMessage,
        );
      },
    );

    if (prompt.schedule.type === "once") {
      updateScheduledPrompt(prompt.id, { enabled: false });
      this.unschedulePrompt(prompt.id);
      this.notifyChanged();
    }

    // No threadId yet — Manager hasn't spawned it.
    return null;
  }

  /**
   * Append the [SCHEDULED TASK] context block to the prompt so the agent has
   * the scheduleId it needs for schedule_report and knows it's running in
   * scheduled mode. Delegates to the shared builder so the routed path
   * (create_session MCP tool) can produce the same postscript.
   */
  private decoratePromptWithContext(
    prompt: ScheduledPrompt,
    folder: Folder,
  ): string {
    return decoratePromptWithSchedule({
      promptText: prompt.prompt,
      prompt,
      workspace: folder.path,
    });
  }

  /**
   * Always called when a scheduled run finishes (either path). Builds a
   * ScheduleRunRecord with any agent-deposited summary and routes it to the
   * Manager — lightweight record for success, real LLM turn for failure.
   */
  private finalizeRun(
    prompt: ScheduledPrompt,
    folder: Folder,
    threadId: string,
    startedAt: number,
    status: "completed" | "error",
    errorMessage?: string,
  ): void {
    const completedAt = Date.now();
    const pending = consumeReport(prompt.id);
    const record: ScheduleRunRecord = {
      scheduleId: prompt.id,
      scheduleName: prompt.name,
      threadId,
      workspace: folder.path,
      provider: prompt.provider,
      status,
      ...(pending?.summary ? { summary: pending.summary } : {}),
      durationMs: completedAt - startedAt,
      ...(errorMessage ? { errorMessage } : {}),
      startedAt,
      completedAt,
    };

    if (this.managerSession) {
      this.managerSession.recordScheduleRun(record);
      if (status === "error") {
        this.managerSession.reportScheduleFailure(record);
      }
    }

    this.notifyRunFinished(prompt, threadId, status, errorMessage);
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

  /**
   * Fire both a desktop notification (always — even if focused) and an in-app
   * toast when a scheduled run finishes. Clicking the desktop notification
   * activates the thread.
   */
  private notifyRunFinished(
    prompt: ScheduledPrompt,
    threadId: string,
    status: "completed" | "error",
    errorMessage?: string,
  ): void {
    if (this.window.isDestroyed()) return;

    const isError = status === "error";
    const title = isError
      ? "Scheduled Prompt Failed"
      : "Scheduled Prompt Completed";
    const body = isError
      ? `"${prompt.name}" failed${errorMessage ? `: ${errorMessage}` : "."}`
      : `"${prompt.name}" finished running.`;

    const notification = new Notification({ title, body });
    notification.on("click", () => {
      if (this.window.isDestroyed()) return;
      this.window.show();
      this.window.focus();
      if (!this.window.webContents.isDestroyed()) {
        this.window.webContents.send(IPC_CHANNELS.THREAD_ACTIVATE, {
          threadId,
        });
      }
    });
    notification.show();

    if (!this.window.webContents.isDestroyed()) {
      this.window.webContents.send(IPC_CHANNELS.DIAGNOSTIC_ERROR, {
        title,
        message: body,
        severity: isError ? "error" : "info",
        context: { threadId, promptId: prompt.id },
      });
    }
  }
}
