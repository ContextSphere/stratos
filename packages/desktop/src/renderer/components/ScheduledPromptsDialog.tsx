import { useState, useEffect, useCallback } from "react";
import { DEFAULT_PROVIDER } from "../utils/modes";
import type {
  ScheduledPrompt,
  ScheduleConfig,
  RecurringInterval,
  ProviderType,
  ScheduleNotifyMode,
  Folder,
} from "@stratosapp/core";

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** Human-readable description of a schedule config. */
function scheduleToHuman(config: ScheduleConfig): string {
  if (config.type === "once") {
    if (!config.runAt) return "Once (no date set)";
    const d = new Date(config.runAt);
    return `Once on ${d.toLocaleDateString()} at ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }
  const time = config.timeOfDay ?? "09:00";
  switch (config.interval) {
    case "every-hour":
      return "Every hour";
    case "every-6-hours":
      return "Every 6 hours";
    case "every-12-hours":
      return "Every 12 hours";
    case "every-day":
      return `Every day at ${time}`;
    case "every-week":
      return `Every ${DAYS[config.dayOfWeek ?? 1]} at ${time}`;
    case "custom":
      return `Custom: ${config.customCron ?? ""}`;
    default:
      return "Unknown schedule";
  }
}
import {
  Dialog,
  DialogBody,
  Button,
  Input,
  DropdownPicker,
  type DropdownItem,
} from "@stratosapp/ui";
import { useScheduledPrompts } from "../hooks/useScheduledPrompts";

const INTERVAL_OPTIONS: DropdownItem[] = [
  { value: "every-hour", label: "Every hour" },
  { value: "every-6-hours", label: "Every 6 hours" },
  { value: "every-12-hours", label: "Every 12 hours" },
  { value: "every-day", label: "Every day" },
  { value: "every-week", label: "Every week" },
  { value: "custom", label: "Custom cron" },
];

const DAY_OPTIONS: DropdownItem[] = [
  { value: "0", label: "Sunday" },
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
];

const PROVIDER_OPTIONS: DropdownItem[] = [
  { value: "copilot", label: "Copilot" },
  { value: "claude-code", label: "Claude Code" },
  { value: "codex", label: "Codex" },
  { value: "opencode", label: "Opencode" },
];

const NOTIFY_OPTIONS: DropdownItem[] = [
  { value: "default", label: "Use global default" },
  {
    value: "always",
    label: "Always (Manager pings me on every run)",
  },
  {
    value: "errors-only",
    label: "Errors only (only ping on failures)",
  },
  { value: "never", label: "Never (silent run)" },
];

interface Props {
  isOpen: boolean;
  onClose: () => void;
  folders: Folder[];
}

type FormMode = "list" | "create" | "edit";

interface FormState {
  name: string;
  prompt: string;
  provider: ProviderType;
  model: string;
  folderId: string;
  scheduleType: "once" | "recurring";
  runAt: string;
  interval: RecurringInterval;
  customCron: string;
  timeOfDay: string;
  dayOfWeek: number;
  /** "default" maps to undefined on save (use global default). */
  notify: "default" | ScheduleNotifyMode;
}

function defaultForm(folders: Folder[]): FormState {
  return {
    name: "",
    prompt: "",
    provider: DEFAULT_PROVIDER,
    model: "",
    folderId: folders[0]?.id ?? "",
    scheduleType: "recurring",
    runAt: "",
    interval: "every-day",
    customCron: "",
    timeOfDay: "09:00",
    dayOfWeek: 1,
    notify: "default",
  };
}

function formToScheduleConfig(form: FormState): ScheduleConfig {
  if (form.scheduleType === "once") {
    return { type: "once", runAt: form.runAt };
  }
  return {
    type: "recurring",
    interval: form.interval,
    ...(form.interval === "custom" ? { customCron: form.customCron } : {}),
    ...(form.interval === "every-day" || form.interval === "every-week"
      ? { timeOfDay: form.timeOfDay }
      : {}),
    ...(form.interval === "every-week" ? { dayOfWeek: form.dayOfWeek } : {}),
  };
}

function promptToForm(p: ScheduledPrompt): FormState {
  const s = p.schedule;
  return {
    name: p.name,
    prompt: p.prompt,
    provider: p.provider,
    model: p.model ?? "",
    folderId: p.folderId,
    scheduleType: s.type,
    runAt: s.runAt ?? "",
    interval: s.interval ?? "every-day",
    customCron: s.customCron ?? "",
    timeOfDay: s.timeOfDay ?? "09:00",
    dayOfWeek: s.dayOfWeek ?? 1,
    notify: p.notify ?? "default",
  };
}

export function ScheduledPromptsDialog({
  isOpen,
  onClose,
  folders,
}: Props): React.ReactElement | null {
  const { prompts, create, update, remove, toggle, runNow } =
    useScheduledPrompts();
  const [mode, setMode] = useState<FormMode>("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(defaultForm(folders));
  const [models, setModels] = useState<DropdownItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Reset to list view when dialog opens
  useEffect(() => {
    if (isOpen) {
      setMode("list");
      setEditingId(null);
      setError(null);
    }
  }, [isOpen]);

  // Fetch models when provider changes
  useEffect(() => {
    if (mode === "list") return;
    window.api
      .getAvailableModels(form.provider)
      .then(
        (
          result: {
            value: string;
            displayName: string;
            description?: string;
          }[],
        ) => {
          setModels(
            result.map((m) => ({
              value: m.value,
              label: m.displayName,
              description: m.description,
            })),
          );
        },
      )
      .catch(() => setModels([]));
  }, [form.provider, mode]);

  const folderItems: DropdownItem[] = folders.map((f) => ({
    value: f.id,
    label: f.name,
  }));

  const handleCreate = useCallback(() => {
    setForm(defaultForm(folders));
    setMode("create");
    setError(null);
  }, [folders]);

  const handleEdit = useCallback((p: ScheduledPrompt) => {
    setForm(promptToForm(p));
    setEditingId(p.id);
    setMode("edit");
    setError(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!form.name.trim()) {
      setError("Name is required");
      return;
    }
    if (!form.prompt.trim()) {
      setError("Prompt is required");
      return;
    }
    if (!form.folderId) {
      setError("Please select a folder");
      return;
    }
    if (form.scheduleType === "once" && !form.runAt) {
      setError("Please set a date and time");
      return;
    }
    if (
      form.scheduleType === "recurring" &&
      form.interval === "custom" &&
      !form.customCron.trim()
    ) {
      setError("Please enter a cron expression");
      return;
    }

    try {
      const data = {
        name: form.name.trim(),
        prompt: form.prompt.trim(),
        provider: form.provider,
        model: form.model || undefined,
        folderId: form.folderId,
        schedule: formToScheduleConfig(form),
        ...(form.notify !== "default" ? { notify: form.notify } : {}),
      };
      if (mode === "edit" && editingId) {
        // For edits, explicitly set notify to undefined when "default" so the
        // user can clear a previous override. The non-edit branch just omits
        // the field when "default".
        await update(editingId, {
          ...data,
          notify: form.notify === "default" ? undefined : form.notify,
        });
      } else {
        await create(data);
      }
      setMode("list");
      setEditingId(null);
    } catch (err: any) {
      setError(err?.message ?? "Failed to save schedule");
    }
  }, [form, mode, editingId, create, update]);

  const handleDelete = useCallback(
    async (id: string) => {
      await remove(id);
    },
    [remove],
  );

  const updateForm = useCallback((patch: Partial<FormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setError(null);
  }, []);

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Scheduled Prompts"
      subtitle={
        mode === "list"
          ? "Automate recurring prompts"
          : mode === "create"
            ? "Create a new schedule"
            : "Edit schedule"
      }
      icon={
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="w-4 h-4 text-white"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z"
          />
        </svg>
      }
      iconGradient="from-violet-500 to-blue-600"
      maxWidth="md"
    >
      <DialogBody>
        {mode === "list" ? (
          <ScheduleList
            prompts={prompts}
            onNew={handleCreate}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onToggle={toggle}
            onRunNow={runNow}
          />
        ) : (
          <ScheduleForm
            form={form}
            onChange={updateForm}
            onSave={handleSave}
            onCancel={() => {
              setMode("list");
              setEditingId(null);
            }}
            folderItems={folderItems}
            modelItems={models}
            error={error}
            isEdit={mode === "edit"}
          />
        )}
      </DialogBody>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────
// List view
// ──────────────────────────────────────────────────────────

function ScheduleList({
  prompts,
  onNew,
  onEdit,
  onDelete,
  onToggle,
  onRunNow,
}: {
  prompts: ScheduledPrompt[];
  onNew: () => void;
  onEdit: (p: ScheduledPrompt) => void;
  onDelete: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onRunNow: (id: string) => void;
}) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  return (
    <div>
      {prompts.length === 0 ? (
        <div className="py-5">
          <p className="text-sm font-medium text-[var(--text-primary)]">
            No scheduled prompts yet
          </p>
          <p className="mt-1 max-w-xs text-xs leading-5 text-[var(--text-muted)]">
            Run a prompt once, or set it to repeat.
          </p>
        </div>
      ) : (
        <div className="space-y-2 mb-4 max-h-[400px] overflow-y-auto">
          {prompts.map((p) => (
            <div
              key={p.id}
              className="flex items-start gap-3 p-3 rounded-lg border border-[var(--border)] bg-[var(--bg-overlay)] hover:bg-[var(--bg-root)] transition-colors"
            >
              {/* Toggle */}
              <button
                onClick={() => onToggle(p.id, !p.enabled)}
                className={`mt-0.5 w-8 h-[18px] rounded-full flex-shrink-0 transition-colors relative ${
                  p.enabled
                    ? "bg-[var(--text-primary)]"
                    : "bg-[var(--border-mid)]"
                }`}
                title={p.enabled ? "Disable" : "Enable"}
              >
                <div
                  className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-[var(--bg-main)] transition-transform ${
                    p.enabled ? "left-[16px]" : "left-[2px]"
                  }`}
                />
              </button>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-sm font-medium truncate ${p.enabled ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]"}`}
                  >
                    {p.name}
                  </span>
                  {p.lastRunStatus && (
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                        p.lastRunStatus === "running"
                          ? "bg-violet-500/20 text-violet-400"
                          : p.lastRunStatus === "completed"
                            ? "bg-emerald-500/20 text-emerald-400"
                            : "bg-red-500/20 text-red-400"
                      }`}
                    >
                      {p.lastRunStatus === "running"
                        ? "Running"
                        : p.lastRunStatus === "completed"
                          ? "Done"
                          : "Error"}
                    </span>
                  )}
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate">
                  {scheduleToHuman(p.schedule)} &middot; {p.provider}
                </p>
                <p className="text-xs text-[var(--text-faint)] mt-0.5 truncate">
                  {p.prompt}
                </p>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => onRunNow(p.id)}
                  className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                  title="Run now"
                >
                  <svg
                    className="w-3.5 h-3.5"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </button>
                <button
                  onClick={() => onEdit(p)}
                  className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                  title="Edit"
                >
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15.232 5.232l3.536 3.536M9 13l6.5-6.5a2 2 0 012.828 2.828L11.828 15.828a2 2 0 01-1.414.586H8v-2.414a2 2 0 01.586-1.414z"
                    />
                  </svg>
                </button>
                {confirmDeleteId === p.id ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        onDelete(p.id);
                        setConfirmDeleteId(null);
                      }}
                      className="text-[10px] text-red-400 hover:text-red-300 px-1"
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] px-1"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteId(p.id)}
                    className="p-1 rounded text-[var(--text-muted)] hover:text-red-400 transition-colors"
                    title="Delete"
                  >
                    <svg
                      className="w-3.5 h-3.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="flex justify-end border-t border-[var(--border)] pt-4">
        <Button variant="primary" size="sm" onClick={onNew}>
          New Schedule
        </Button>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Form view
// ──────────────────────────────────────────────────────────

function ScheduleForm({
  form,
  onChange,
  onSave,
  onCancel,
  folderItems,
  modelItems,
  error,
  isEdit,
}: {
  form: FormState;
  onChange: (patch: Partial<FormState>) => void;
  onSave: () => void;
  onCancel: () => void;
  folderItems: DropdownItem[];
  modelItems: DropdownItem[];
  error: string | null;
  isEdit: boolean;
}) {
  return (
    <div className="schedule-form grid grid-cols-1 gap-3 sm:grid-cols-2">
      {/* Name */}
      <div className="sm:col-span-2">
        <Input
          label="Name"
          value={form.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="e.g. Daily code review"
        />
      </div>

      {/* Prompt */}
      <div className="sm:col-span-2">
        <label className="block text-xs text-[var(--text-muted)] mb-1.5">
          Prompt
        </label>
        <textarea
          value={form.prompt}
          onChange={(e) => onChange({ prompt: e.target.value })}
          placeholder="What should the agent do?"
          rows={3}
          className="w-full bg-[var(--bg-overlay)] border border-[var(--border-mid)] rounded-lg px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--text-muted)] transition-colors resize-y"
        />
      </div>

      {/* Schedule type toggle */}
      <div className="sm:col-span-2">
        <label className="block text-xs text-[var(--text-muted)] mb-1.5">
          Run
        </label>
        <div className="flex rounded-lg border border-[var(--border-mid)] overflow-hidden">
          <button
            onClick={() => onChange({ scheduleType: "recurring" })}
            className={`flex-1 px-3 py-2 text-sm transition-colors ${
              form.scheduleType === "recurring"
                ? "bg-[var(--bg-hover)] text-[var(--text-primary)] font-medium"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            Recurring
          </button>
          <button
            onClick={() => onChange({ scheduleType: "once" })}
            className={`flex-1 px-3 py-2 text-sm transition-colors border-l border-[var(--border-mid)] ${
              form.scheduleType === "once"
                ? "bg-[var(--bg-hover)] text-[var(--text-primary)] font-medium"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            Once
          </button>
        </div>
      </div>

      {/* Schedule details */}
      {form.scheduleType === "once" ? (
        <div className="flex gap-3 sm:col-span-2">
          <div className="flex-1">
            <Input
              label="Date"
              type="date"
              value={form.runAt ? form.runAt.split("T")[0] : ""}
              onChange={(e) => {
                const time = form.runAt
                  ? form.runAt.split("T")[1] || "09:00"
                  : "09:00";
                onChange({ runAt: `${e.target.value}T${time}` });
              }}
            />
          </div>
          <div className="flex-1">
            <Input
              label="Time"
              type="time"
              value={form.runAt ? form.runAt.split("T")[1] || "09:00" : "09:00"}
              onChange={(e) => {
                const date = form.runAt
                  ? form.runAt.split("T")[0]
                  : new Date().toISOString().split("T")[0];
                onChange({ runAt: `${date}T${e.target.value}` });
              }}
            />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:col-span-2">
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1.5">
              Frequency
            </label>
            <DropdownPicker
              items={INTERVAL_OPTIONS}
              selectedValue={form.interval}
              onSelect={(val) =>
                onChange({ interval: val as RecurringInterval })
              }
            />
          </div>
          {(form.interval === "every-day" ||
            form.interval === "every-week") && (
            <div
              className={`flex gap-3 ${form.interval === "every-week" ? "col-span-2" : ""}`}
            >
              {form.interval === "every-week" && (
                <div className="flex-1">
                  <label className="block text-xs text-[var(--text-muted)] mb-1.5">
                    Day
                  </label>
                  <DropdownPicker
                    items={DAY_OPTIONS}
                    selectedValue={String(form.dayOfWeek)}
                    onSelect={(val) =>
                      onChange({ dayOfWeek: parseInt(val, 10) })
                    }
                  />
                </div>
              )}
              <div className="flex-1">
                <Input
                  label="Time"
                  type="time"
                  value={form.timeOfDay}
                  onChange={(e) => onChange({ timeOfDay: e.target.value })}
                />
              </div>
            </div>
          )}
          {form.interval === "custom" && (
            <Input
              label="Cron expression"
              value={form.customCron}
              onChange={(e) => onChange({ customCron: e.target.value })}
              placeholder="e.g. 0 */6 * * *"
            />
          )}
        </div>
      )}

      {/* Folder */}
      <div className="sm:col-span-2">
        <label className="block text-xs text-[var(--text-muted)] mb-1.5">
          Folder
        </label>
        {folderItems.length > 0 ? (
          <DropdownPicker
            items={folderItems}
            selectedValue={form.folderId}
            onSelect={(val) => onChange({ folderId: val })}
          />
        ) : (
          <p className="text-xs text-[var(--text-faint)]">
            No folders available. Add a folder first.
          </p>
        )}
      </div>

      <details className="sm:col-span-2 border-t border-[var(--border)] pt-3">
        <summary className="cursor-pointer text-xs text-[var(--text-secondary)]">
          Agent &amp; notifications
        </summary>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {/* Provider */}
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1.5">
              Provider
            </label>
            <DropdownPicker
              items={PROVIDER_OPTIONS}
              selectedValue={form.provider}
              onSelect={(val) =>
                onChange({ provider: val as ProviderType, model: "" })
              }
            />
          </div>

          {/* Model */}
          {modelItems.length > 0 && (
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1.5">
                Model
              </label>
              <DropdownPicker
                items={[{ value: "", label: "Default" }, ...modelItems]}
                selectedValue={form.model}
                onSelect={(val) => onChange({ model: val })}
              />
            </div>
          )}

          {/* Notify */}
          <div className="sm:col-span-2">
            <label className="block text-xs text-[var(--text-muted)] mb-1.5">
              Notify on completion
            </label>
            <DropdownPicker
              items={NOTIFY_OPTIONS}
              selectedValue={form.notify}
              onSelect={(val) =>
                onChange({ notify: val as FormState["notify"] })
              }
            />
            <p className="text-[11px] text-[var(--text-faint)] mt-1.5">
              When set, the Manager wakes up after the run and pings you on
              WhatsApp. Reply on WhatsApp to ask follow-ups.
            </p>
          </div>
        </div>
      </details>

      {/* Error */}
      {error && <p className="sm:col-span-2 text-xs text-red-400">{error}</p>}

      {/* Actions */}
      <div className="sm:col-span-2 mt-1 flex flex-row-reverse gap-2 border-t border-[var(--border)] pt-4">
        <Button variant="primary" size="sm" onClick={onSave}>
          {isEdit ? "Save Changes" : "Create Schedule"}
        </Button>
        <Button variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
