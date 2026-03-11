import { useState } from "react";
import {
  Button,
  ProviderToggle,
  ModelSelector,
  ModeToggle,
  WorktreeToggle,
  ToolCallCard,
  TaskCard,
} from "@stratosapp/ui";
import type { ToolCall, TaskInfo } from "@stratosapp/ui";
type AgentMode = "plan" | "default" | "acceptEdits" | "bypassPermissions";

const SAMPLE_MODELS = [
  {
    value: "claude-opus-4-6",
    displayName: "Default (recommended)",
    description: "Opus 4.6 · Most capable for complex work",
    supportsReasoning: true,
  },
  {
    value: "claude-sonnet-4-6",
    displayName: "Sonnet 4.6",
    description: "Fast and balanced",
    supportsReasoning: false,
  },
  {
    value: "claude-haiku-4-5",
    displayName: "Haiku 4.5",
    description: "Lightweight and quick",
    supportsReasoning: false,
  },
];

const SAMPLE_BASH_TOOL: ToolCall = {
  toolCallId: "tc-bash",
  toolName: "Bash",
  input: {
    command: "pnpm test --filter @stratosapp/ui",
    description: "Run UI tests",
  },
  status: "completed",
  output: "✓ 14 tests passed",
};

const SAMPLE_EDIT_TOOL: ToolCall = {
  toolCallId: "tc-edit",
  toolName: "Edit",
  input: {
    file_path: "packages/ui/src/components/shared/Dialog.tsx",
    old_string: 'className="overflow-hidden"',
    new_string: 'className="flex flex-col max-h-[90vh]"',
  },
  status: "completed",
};

const SAMPLE_READ_TOOL: ToolCall = {
  toolCallId: "tc-read",
  toolName: "Read",
  input: { file_path: "packages/ui/src/components/shared/Dialog.tsx" },
  status: "running",
};

const SAMPLE_TASK: TaskInfo = {
  taskId: "task-1",
  subagentType: "Explore",
  description: "Search for all Dialog component usages across the codebase",
  prompt:
    "Find all files that import and use the Dialog component from @stratosapp/ui",
  status: "completed",
  startTime: Date.now() - 4200,
  endTime: Date.now(),
  result: JSON.stringify([
    {
      type: "text",
      text: "Found 6 usages in: SettingsDialog.tsx, PermissionDialog.tsx, ConnectDialog.tsx, ConfirmDialog.tsx, RenameDialog.tsx, DeleteDialog.tsx",
    },
  ]),
  toolCallsExpanded: false,
};

/**
 * Live component gallery showing all real app components.
 * Automatically reflects the active theme — no props needed.
 */
export function ComponentGallery(): React.ReactElement {
  const [provider, setProvider] = useState<"claude-code" | "codex">(
    "claude-code",
  );
  const [model, setModel] = useState("claude-opus-4-6");
  const [effort, setEffort] = useState("high");
  const [mode, setMode] = useState<AgentMode>("default");
  const [worktreeMode, setWorktreeMode] = useState<"local" | "worktree">(
    "worktree",
  );

  return (
    <div
      className="rounded-xl p-4 space-y-6 text-sm"
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        color: "var(--text-primary)",
      }}
    >
      {/* Colors */}
      <GallerySection label="Colors">
        <div className="flex flex-wrap gap-2">
          {[
            { label: "bg-root", var: "--bg-root" },
            { label: "bg-main", var: "--bg-main" },
            { label: "bg-surface", var: "--bg-surface" },
            { label: "bg-overlay", var: "--bg-overlay" },
            { label: "border", var: "--border" },
            { label: "border-mid", var: "--border-mid" },
          ].map((swatch) => (
            <div key={swatch.var} className="flex flex-col items-center gap-1">
              <div
                className="w-10 h-10 rounded-lg"
                style={{
                  background: `var(${swatch.var})`,
                  border: "1px solid var(--border-mid)",
                }}
              />
              <span
                className="text-[10px] text-center leading-tight"
                style={{ color: "var(--text-muted)" }}
              >
                {swatch.label}
              </span>
            </div>
          ))}
        </div>
      </GallerySection>

      {/* Typography */}
      <GallerySection label="Typography">
        <div className="space-y-1">
          <p style={{ color: "var(--text-primary)" }}>
            Primary text — the quick brown fox
          </p>
          <p style={{ color: "var(--text-secondary)" }}>
            Secondary text — the quick brown fox
          </p>
          <p style={{ color: "var(--text-muted)" }}>
            Muted text — the quick brown fox
          </p>
          <p style={{ color: "var(--text-faint)" }}>
            Faint text — the quick brown fox
          </p>
          <code
            className="text-xs px-1.5 py-0.5 rounded"
            style={{
              background: "var(--bg-overlay)",
              border: "1px solid var(--border)",
              color: "var(--text-secondary)",
              fontFamily: "var(--font-mono)",
            }}
          >
            monospace code sample
          </code>
        </div>
      </GallerySection>

      {/* Buttons */}
      <GallerySection label="Buttons">
        <div className="flex flex-wrap gap-2">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="secondary">Ghost</Button>
        </div>
      </GallerySection>

      {/* Provider Toggle */}
      <GallerySection label="Provider Toggle">
        <ProviderToggle provider={provider} onProviderChange={setProvider} />
      </GallerySection>

      {/* Model Selector */}
      <GallerySection label="Model Selector">
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-lg"
          style={{
            background: "var(--bg-overlay)",
            border: "1px solid var(--border)",
          }}
        >
          <ModelSelector
            selectedModel={model}
            onModelChange={setModel}
            thinkingEffort={effort}
            onThinkingEffortChange={setEffort}
            models={SAMPLE_MODELS}
          />
        </div>
      </GallerySection>

      {/* Mode Toggle */}
      <GallerySection label="Mode Toggle">
        <ModeToggle provider={provider} mode={mode} onModeChange={setMode} />
      </GallerySection>

      {/* Worktree Toggle */}
      <GallerySection label="Worktree Toggle">
        <WorktreeToggle
          worktreeMode={worktreeMode}
          isGitRepo={true}
          disabled={false}
          onWorktreeModeChange={setWorktreeMode}
        />
      </GallerySection>

      {/* Tool Cards */}
      <GallerySection label="Tool Cards">
        <div className="space-y-2">
          <ToolCallCard toolCall={SAMPLE_BASH_TOOL} />
          <ToolCallCard toolCall={SAMPLE_READ_TOOL} />
          <ToolCallCard toolCall={SAMPLE_EDIT_TOOL} />
        </div>
      </GallerySection>

      {/* Task / Agent Card */}
      <GallerySection label="Agent Task Card">
        <TaskCard
          taskInfo={SAMPLE_TASK}
          childToolCalls={[SAMPLE_BASH_TOOL, SAMPLE_READ_TOOL]}
          onToggleToolCalls={() => {}}
        />
      </GallerySection>

      {/* Badges */}
      <GallerySection label="Badges">
        <div className="flex flex-wrap gap-2">
          {[
            {
              label: "Default",
              color: "var(--text-secondary)",
              bg: "var(--bg-overlay)",
            },
            { label: "Blue", color: "#60a5fa", bg: "rgba(59,130,246,0.15)" },
            { label: "Green", color: "#4ade80", bg: "rgba(34,197,94,0.15)" },
            { label: "Amber", color: "#fbbf24", bg: "rgba(251,191,36,0.15)" },
            { label: "Red", color: "#f87171", bg: "rgba(239,68,68,0.15)" },
          ].map((badge) => (
            <span
              key={badge.label}
              className="px-2 py-0.5 rounded-full text-xs font-medium"
              style={{
                background: badge.bg,
                color: badge.color,
                border: "1px solid var(--border)",
              }}
            >
              {badge.label}
            </span>
          ))}
        </div>
      </GallerySection>

      {/* Card Surface */}
      <GallerySection label="Card Surface">
        <div
          className="rounded-lg p-3 space-y-1"
          style={{
            background: "var(--bg-overlay)",
            border: "1px solid var(--border)",
          }}
        >
          <p
            className="text-xs font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            Card title
          </p>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Supporting description text inside a surface card.
          </p>
        </div>
      </GallerySection>
    </div>
  );
}

function GallerySection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div>
      <p
        className="text-[10px] font-semibold uppercase tracking-wider mb-2"
        style={{ color: "var(--text-faint)" }}
      >
        {label}
      </p>
      {children}
    </div>
  );
}
