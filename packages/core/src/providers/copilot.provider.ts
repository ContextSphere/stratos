/* eslint-disable @typescript-eslint/no-explicit-any */
import type {
  CopilotClient as CopilotClientType,
  CopilotSession as CopilotSessionType,
  SessionEvent,
  SessionConfig,
  ResumeSessionConfig,
  MessageOptions,
  PermissionRequest,
  PermissionRequestResult,
  ModelInfo as CopilotModelInfo,
  MCPServerConfig,
  CustomAgentConfig,
} from "@github/copilot-sdk";
import type {
  AgentProvider,
  AgentMessage,
  SendMessageParams,
  ProviderConfig,
  TokenUsage,
  ModelInfo,
  McpServerInfo,
  TodoItem,
  ContextUsage,
} from "./types";
import { MODE_CONFIGS } from "../types/mode";
import { truncateForTrace } from "../storage/trace.store";
import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

// ─── Native CLI binary resolution ────────────────────────────────────────────
//
// The Copilot CLI ships as both a Mach-O/ELF native binary and an ESM JS
// entrypoint that depends on `node:sqlite` (Node 22+). The SDK defaults to
// spawning the JS via the host's `node` — which is Node 20 in Stratos.
//
// We override that default by resolving a native binary in this order:
//   1. `COPILOT_CLI_PATH` env var (advanced users).
//   2. The system `copilot` on PATH (homebrew / official installer).
//   3. The platform-specific package bundled by `@github/copilot-sdk`
//      (`@github/copilot-<platform>-<arch>`), walking up from common
//      pnpm + npm hoist roots.

function platformPackageName(): string | null {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === "darwin") {
    if (arch === "arm64") return "@github/copilot-darwin-arm64";
    if (arch === "x64") return "@github/copilot-darwin-x64";
  } else if (platform === "linux") {
    if (arch === "arm64") return "@github/copilot-linux-arm64";
    if (arch === "x64") return "@github/copilot-linux-x64";
  } else if (platform === "win32") {
    if (arch === "x64") return "@github/copilot-win32-x64";
    if (arch === "arm64") return "@github/copilot-win32-arm64";
  }
  return null;
}

function whichCopilot(): string | null {
  try {
    const out = execFileSync("/usr/bin/which", ["copilot"], {
      encoding: "utf-8",
      timeout: 3000,
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

function searchBundledBinary(): string | null {
  const pkg = platformPackageName();
  if (!pkg) return null;
  const binaryName = process.platform === "win32" ? "copilot.exe" : "copilot";
  const relPath = join(pkg.replace("/", "+"), "node_modules", pkg, binaryName);

  // Walk up from common starting points, checking node_modules/.pnpm
  // and direct node_modules layouts.
  const resourcesPath: string | undefined = (process as any).resourcesPath;
  const startDirs = [
    ...(resourcesPath
      ? [join(resourcesPath, "app.asar.unpacked"), resourcesPath]
      : []),
    __dirname,
    process.cwd(),
  ];
  for (const startDir of startDirs) {
    let dir = startDir;
    for (let i = 0; i < 10; i++) {
      // pnpm hoist layout
      const pnpmDir = join(dir, "node_modules", ".pnpm");
      try {
        // The folder name includes a version suffix; match by prefix.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fs = require("fs") as typeof import("fs");
        if (fs.existsSync(pnpmDir)) {
          const entries = fs.readdirSync(pnpmDir);
          const prefix = pkg.replace("/", "+");
          for (const entry of entries) {
            if (entry.startsWith(prefix + "@")) {
              const candidate = join(
                pnpmDir,
                entry,
                "node_modules",
                pkg,
                binaryName,
              );
              if (fs.existsSync(candidate)) return candidate;
            }
          }
        }
      } catch {
        /* */
      }
      // Direct layout
      const direct = join(dir, "node_modules", pkg, binaryName);
      if (existsSync(direct)) return direct;
      // pnpm symlink
      const symlinked = join(dir, "node_modules", relPath);
      if (existsSync(symlinked)) return symlinked;
      const parent = join(dir, "..");
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

function resolveCopilotCliPath(override?: string): string | null {
  if (override && existsSync(override)) return override;
  if (process.env.COPILOT_CLI_PATH && existsSync(process.env.COPILOT_CLI_PATH))
    return process.env.COPILOT_CLI_PATH;
  const onPath = whichCopilot();
  if (onPath && existsSync(onPath)) return onPath;
  return searchBundledBinary();
}

// Lazily resolve the CJS shim so the core package can stay CommonJS even
// though @github/copilot-sdk's package.json sets `"type": "module"`.
let _sdkModule: typeof import("@github/copilot-sdk") | undefined;
function getSdk(): typeof import("@github/copilot-sdk") {
  if (!_sdkModule) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _sdkModule = require("@github/copilot-sdk");
  }
  return _sdkModule!;
}

// ─── Streaming caps (mirror the Claude provider's main-process safety nets) ──

const STREAM_TOOL_OUTPUT_CAP = 256_000;

function capStreamingToolOutput(output: string): string {
  if (output.length <= STREAM_TOOL_OUTPUT_CAP) return output;
  return (
    output.slice(0, STREAM_TOOL_OUTPUT_CAP) +
    `\n\n[… truncated ${output.length - STREAM_TOOL_OUTPUT_CAP} characters from streaming]`
  );
}

// ─── Tool-name normalization ────────────────────────────────────────────────
//
// Copilot's built-in tool names are lower-snake (e.g. "shell", "write",
// "str_replace_editor"); Stratos's UI components key off the Claude canonical
// names ("Bash", "Write", "Edit"). Normalise so the existing tool-card
// renderers work without provider-specific branches.

const COPILOT_TOOL_NAME_MAP: Record<string, string> = {
  // Filesystem
  read: "Read",
  view: "Read",
  open_file: "Read",
  write: "Write",
  create_file: "Write",
  edit: "Edit",
  str_replace: "Edit",
  str_replace_editor: "Edit",
  multi_edit: "Edit",
  // Search
  glob: "Glob",
  find: "Glob",
  grep: "Grep",
  ripgrep: "Grep",
  // Shell
  shell: "Bash",
  bash: "Bash",
  exec: "Bash",
  run_command: "Bash",
  terminal: "Bash",
  // Web
  fetch: "WebFetch",
  fetch_url: "WebFetch",
  web_fetch: "WebFetch",
  web_search: "WebSearch",
  search_web: "WebSearch",
  // Planning / TODO
  todo: "TodoWrite",
  update_plan: "TodoWrite",
  todo_write: "TodoWrite",
  plan: "TodoWrite",
  // Notebook
  notebook_edit: "NotebookEdit",
  // Ask
  ask_user: "AskUserQuestion",
};

export function normalizeCopilotToolName(raw: string): string {
  const key = raw.toLowerCase().replace(/[\s-]+/g, "_");
  if (COPILOT_TOOL_NAME_MAP[key]) return COPILOT_TOOL_NAME_MAP[key];
  // MCP server tools arrive as "server:tool" or already capitalized — preserve.
  return raw;
}

// ─── Mode mapping ────────────────────────────────────────────────────────────

function stratosModeToCopilotAgentMode(
  mode: string,
): "interactive" | "plan" | "autopilot" {
  switch (mode) {
    case "plan":
      return "plan";
    case "fullAccess":
    case "bypassPermissions":
      return "autopilot";
    case "acceptEdits":
    case "default":
    default:
      return "interactive";
  }
}

// ─── Reasoning effort mapping ────────────────────────────────────────────────

function stratosEffortToCopilot(
  effort?: "low" | "medium" | "high" | "max",
): "low" | "medium" | "high" | "xhigh" | undefined {
  if (!effort) return undefined;
  if (effort === "max") return "xhigh";
  return effort;
}

// ─── MCP config translation ──────────────────────────────────────────────────

function translateMcpServers(
  raw: ProviderConfig["mcpServers"] | undefined,
): Record<string, MCPServerConfig> | undefined {
  if (!raw) return undefined;
  const out: Record<string, MCPServerConfig> = {};
  for (const [name, cfg] of Object.entries(raw)) {
    const c = cfg as any;
    if (c?.type === "sdk") continue; // Claude-only in-process MCP — skip
    if (c?.type === "http" || c?.type === "sse") {
      out[name] = {
        type: c.type,
        url: c.url,
        ...(c.headers ? { headers: c.headers } : {}),
      } as MCPServerConfig;
      continue;
    }
    // Default to stdio.
    if (typeof c?.command === "string") {
      out[name] = {
        type: "stdio",
        command: c.command,
        ...(c.args ? { args: c.args } : {}),
        ...(c.env ? { env: c.env } : {}),
      } as MCPServerConfig;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

// ─── Custom-agent translation ────────────────────────────────────────────────

function translateCustomAgents(
  agents: ProviderConfig["agents"] | undefined,
): CustomAgentConfig[] | undefined {
  if (!agents || Object.keys(agents).length === 0) return undefined;
  const list: CustomAgentConfig[] = [];
  for (const [name, def] of Object.entries(agents)) {
    const d = def as any;
    if (!d) continue;
    list.push({
      name,
      displayName: d.displayName ?? name,
      description: d.description ?? "",
      prompt: typeof d.prompt === "string" ? d.prompt : "",
      ...(Array.isArray(d.tools) ? { tools: d.tools as string[] } : {}),
      ...(d.model ? { model: d.model } : {}),
    });
  }
  return list.length > 0 ? list : undefined;
}

// ─── Image attachment translation ────────────────────────────────────────────

export function imagesToAttachments(
  images: SendMessageParams["images"] | undefined,
): MessageOptions["attachments"] | undefined {
  if (!images || images.length === 0) return undefined;
  const out: NonNullable<MessageOptions["attachments"]> = [];
  for (const img of images) {
    const data = img.dataUrl.replace(/^data:[^;]+;base64,/, "");
    out.push({ type: "blob", mimeType: img.mimeType, data });
  }
  return out.length > 0 ? out : undefined;
}

// ─── Permission translation ──────────────────────────────────────────────────

function permissionRequestToInput(req: PermissionRequest): {
  toolName: string;
  input: Record<string, unknown>;
} {
  switch (req.kind) {
    case "shell":
      return {
        toolName: "Bash",
        input: {
          command: req.fullCommandText,
          description: req.intention,
        },
      };
    case "write":
      return {
        toolName: req.newFileContents != null ? "Write" : "Edit",
        input: {
          file_path: req.fileName,
          ...(req.newFileContents != null
            ? { content: req.newFileContents }
            : { old_string: "", new_string: "" }),
          diff: req.diff,
          intention: req.intention,
        },
      };
    case "read":
      return {
        toolName: "Read",
        input: { file_path: req.path, intention: req.intention },
      };
    case "mcp":
      return {
        toolName: `mcp__${req.serverName}__${req.toolName}`,
        input: req.args ?? {},
      };
    case "url":
      return {
        toolName: "WebFetch",
        input: { url: req.url, intention: req.intention },
      };
    case "memory":
      return {
        toolName: "MemoryStore",
        input: { fact: req.fact, action: req.action ?? "store" },
      };
    case "custom-tool":
      return {
        toolName: req.toolName,
        input: req.args ?? {},
      };
    case "hook":
      return {
        toolName: req.toolName,
        input: { hookMessage: req.hookMessage, toolArgs: req.toolArgs ?? {} },
      };
    case "extension-management":
      return {
        toolName: "ExtensionManagement",
        input: { extensionName: req.extensionName, operation: req.operation },
      };
    case "extension-permission-access":
      return {
        toolName: "ExtensionPermission",
        input: {
          extensionName: req.extensionName,
          capabilities: req.capabilities,
        },
      };
    default:
      return {
        toolName: (req as any).kind ?? "Permission",
        input: req as any,
      };
  }
}

// ─── Event-to-AgentMessage bridge ────────────────────────────────────────────

interface BridgeContext {
  sessionId: string | undefined;
  cachedTools: string[];
  cachedCommands: { name: string; description?: string }[];
  cachedMcpServers: McpServerInfo[];
  emittedSessionInit: boolean;
  finalText: string;
  finalUsage: { inputTokens: number; outputTokens: number } | null;
  finalModel: string | undefined;
  finalCost: number | undefined;
  contextWindow: number | null;
  // Streaming guards — when a delta stream has already delivered text/reasoning
  // for the current message, the terminal assistant.message / assistant.reasoning
  // event must NOT re-yield the same content or the renderer will concatenate it.
  textWasStreamed: boolean;
  thinkingWasStreamed: boolean;
  // Per-tool-call accounting
  pendingToolNames: Map<string, string>; // toolCallId → toolName (after normalize)
  // Sub-agent task tracking — surface via task_notification + nested tool_use parentToolUseId
  subagentTaskByCallId: Map<
    string,
    { taskId: string; toolCallId: string; name: string }
  >;
  // For sub-agent nested events: agentId → parent toolCallId
  agentIdToParentToolCallId: Map<string, string>;
  resultEmitted: boolean;
}

export function makeBridgeContext(): BridgeContext {
  return {
    sessionId: undefined,
    cachedTools: [],
    cachedCommands: [],
    cachedMcpServers: [],
    emittedSessionInit: false,
    finalText: "",
    finalUsage: null,
    finalModel: undefined,
    finalCost: undefined,
    contextWindow: null,
    textWasStreamed: false,
    thinkingWasStreamed: false,
    pendingToolNames: new Map(),
    subagentTaskByCallId: new Map(),
    agentIdToParentToolCallId: new Map(),
    resultEmitted: false,
  };
}

function mcpServersLoadedToStratos(
  servers: Array<{
    name: string;
    status: string;
    transport?: string;
    source?: string;
    error?: string;
  }>,
): McpServerInfo[] {
  return servers.map((s) => ({
    name: s.name,
    status: normalizeMcpStatus(s.status),
    ...(s.source ? { scope: s.source } : {}),
    tools: [],
    ...(s.error ? { error: s.error } : {}),
    ...(s.transport ? { configType: s.transport } : {}),
  }));
}

function normalizeMcpStatus(
  s: string,
): "connected" | "failed" | "needs-auth" | "pending" | "disabled" {
  if (
    s === "connected" ||
    s === "failed" ||
    s === "needs-auth" ||
    s === "pending" ||
    s === "disabled"
  )
    return s;
  return "pending";
}

function emitInitIfReady(ctx: BridgeContext): AgentMessage | null {
  if (ctx.emittedSessionInit) return null;
  if (!ctx.sessionId) return null;
  ctx.emittedSessionInit = true;
  return {
    type: "session_init",
    sessionId: ctx.sessionId,
    tools: ctx.cachedTools,
    slashCommands: ctx.cachedCommands,
    mcpServers: ctx.cachedMcpServers,
  };
}

export function* mapEvent(
  ev: SessionEvent,
  ctx: BridgeContext,
): Generator<AgentMessage> {
  const t = ev.type;
  switch (t) {
    case "session.start":
    case "session.resume": {
      const d: any = ev.data ?? {};
      ctx.sessionId = d.sessionId ?? ctx.sessionId;
      if (d.selectedModel) ctx.finalModel = d.selectedModel;
      const init = emitInitIfReady(ctx);
      if (init) yield init;
      return;
    }

    case "session.tools_updated": {
      // Tools availability changed for the active model. We don't have the
      // tool list inline; the runtime exposes it via capabilities. Leave
      // cachedTools as-is so previously-discovered tools persist.
      return;
    }

    case "commands.changed": {
      const d: any = ev.data ?? {};
      if (Array.isArray(d.commands)) {
        ctx.cachedCommands = d.commands.map((c: any) => ({
          name: c.name ?? c,
          description: c.description,
        }));
      }
      if (!ctx.emittedSessionInit) {
        const init = emitInitIfReady(ctx);
        if (init) yield init;
      }
      return;
    }

    case "session.mcp_servers_loaded": {
      const d: any = ev.data ?? {};
      if (Array.isArray(d.servers)) {
        ctx.cachedMcpServers = mcpServersLoadedToStratos(d.servers);
      }
      if (!ctx.emittedSessionInit) {
        const init = emitInitIfReady(ctx);
        if (init) yield init;
      }
      return;
    }

    case "session.mcp_server_status_changed": {
      const d: any = ev.data ?? {};
      const idx = ctx.cachedMcpServers.findIndex(
        (m) => m.name === d.serverName,
      );
      const next: McpServerInfo = {
        name: d.serverName,
        status: normalizeMcpStatus(d.status),
        tools: idx >= 0 ? ctx.cachedMcpServers[idx].tools : [],
        ...(d.error ? { error: d.error } : {}),
      };
      if (idx >= 0) ctx.cachedMcpServers[idx] = next;
      else ctx.cachedMcpServers.push(next);
      return;
    }

    case "assistant.message_start":
      // Reset per-message streaming guards so the next message_delta stream is
      // tracked independently from any previous one on the same session.
      ctx.textWasStreamed = false;
      ctx.thinkingWasStreamed = false;
      return;

    case "assistant.message_delta": {
      const d: any = ev.data ?? {};
      const content = typeof d.deltaContent === "string" ? d.deltaContent : "";
      if (!content) return;
      ctx.textWasStreamed = true;
      yield { type: "text", content, isStreaming: true };
      return;
    }

    case "assistant.message": {
      const d: any = ev.data ?? {};
      const content = typeof d.content === "string" ? d.content : "";
      // Track for `result` synthesis on session.idle.
      if (content) ctx.finalText = content;
      if (d.outputTokens != null) {
        ctx.finalUsage = {
          inputTokens: ctx.finalUsage?.inputTokens ?? 0,
          outputTokens: d.outputTokens,
        };
      }
      if (d.model && !ctx.finalModel) ctx.finalModel = d.model;
      // Only surface the terminal message as `text` when streaming deltas did
      // not already deliver it — otherwise the renderer concatenates the full
      // message onto the streamed content, doubling the reply.
      if (content && !ctx.textWasStreamed) {
        yield { type: "text", content, isStreaming: false };
      }
      // Inline tool_requests are also surfaced via `tool.execution_start`
      // events; we let that path emit tool_use to avoid duplicates.
      return;
    }

    case "assistant.reasoning_delta": {
      const d: any = ev.data ?? {};
      const content = typeof d.deltaContent === "string" ? d.deltaContent : "";
      if (!content) return;
      ctx.thinkingWasStreamed = true;
      yield { type: "thinking", content, isStreaming: true };
      return;
    }

    case "assistant.reasoning": {
      const d: any = ev.data ?? {};
      const content = typeof d.content === "string" ? d.content : "";
      if (!content) return;
      if (ctx.thinkingWasStreamed) return;
      yield { type: "thinking", content, isStreaming: false };
      return;
    }

    case "assistant.intent": {
      const d: any = ev.data ?? {};
      const content =
        typeof d.intent === "string"
          ? d.intent
          : typeof d.description === "string"
            ? d.description
            : "";
      if (content) {
        yield {
          type: "thinking",
          content: `[intent] ${content}`,
          isStreaming: false,
        };
      }
      return;
    }

    case "assistant.usage": {
      const d: any = ev.data ?? {};
      const input = typeof d.inputTokens === "number" ? d.inputTokens : 0;
      const output = typeof d.outputTokens === "number" ? d.outputTokens : 0;
      ctx.finalUsage = {
        inputTokens: (ctx.finalUsage?.inputTokens ?? 0) + input,
        outputTokens: (ctx.finalUsage?.outputTokens ?? 0) + output,
      };
      if (typeof d.cost === "number") {
        ctx.finalCost = (ctx.finalCost ?? 0) + d.cost;
      }
      if (d.model && !ctx.finalModel) ctx.finalModel = d.model;
      return;
    }

    case "assistant.turn_start":
    case "assistant.turn_end":
    case "assistant.streaming_delta":
      return;

    case "tool.execution_start": {
      const d: any = ev.data ?? {};
      const rawName: string = d.mcpServerName
        ? `mcp__${d.mcpServerName}__${d.mcpToolName ?? d.toolName}`
        : d.toolName;
      const toolName = normalizeCopilotToolName(rawName);
      // We may have already yielded tool_use via assistant.message.toolRequests;
      // suppress duplicates by checking pendingToolNames.
      if (ctx.pendingToolNames.has(d.toolCallId)) return;
      ctx.pendingToolNames.set(d.toolCallId, toolName);
      const parent = ev.agentId
        ? ctx.agentIdToParentToolCallId.get(ev.agentId)
        : undefined;
      yield {
        type: "tool_use",
        toolName,
        input: (d.arguments ?? {}) as Record<string, unknown>,
        toolCallId: d.toolCallId,
        ...(parent ? { parentToolUseId: parent } : {}),
      };
      // If this is an update_plan / todo tool, also surface as todo_update.
      if (toolName === "TodoWrite") {
        const todos = extractTodos((d.arguments ?? {}) as any);
        if (todos.length > 0) {
          yield { type: "todo_update", todos };
        }
      }
      return;
    }

    case "tool.execution_partial_result":
      // Default off — UI display already caps; partials would flood. Trace only.
      return;

    case "tool.execution_progress":
      return;

    case "tool.execution_complete": {
      const d: any = ev.data ?? {};
      const toolCallId: string = d.toolCallId;
      const toolName = ctx.pendingToolNames.get(toolCallId) ?? "UnknownTool";
      ctx.pendingToolNames.delete(toolCallId);
      // Compose output: prefer detailedContent for UI, fall back to content.
      let output = "";
      if (d.result?.detailedContent) output = d.result.detailedContent;
      else if (d.result?.content) output = d.result.content;
      else if (d.error?.message) output = `Error: ${d.error.message}`;
      output = capStreamingToolOutput(output);
      // If the tool was TodoWrite, the todo_update was emitted at start; the
      // tool_result is still useful to mark the call as resolved.
      yield { type: "tool_result", toolCallId, output };
      // Resolve a pending sub-agent task on its completion tool call.
      const task = ctx.subagentTaskByCallId.get(toolCallId);
      if (task) {
        ctx.subagentTaskByCallId.delete(toolCallId);
        const summary =
          d.error?.message ?? d.result?.content?.slice(0, 200) ?? "completed";
        yield {
          type: "task_notification",
          taskId: task.taskId,
          toolUseId: task.toolCallId,
          status: d.success === false ? "failed" : "completed",
          summary,
        };
      }
      // Surface a `file_changed`-style hint as text for write-class tools.
      // Stays optional and additive — no UI changes required.
      if (
        d.success &&
        (toolName === "Write" || toolName === "Edit") &&
        typeof d.result?.detailedContent === "string"
      ) {
        // No-op: the diff is already in the tool_result; renderer handles it.
      }
      return;
    }

    case "external_tool.requested": {
      const d: any = ev.data ?? {};
      const toolName = normalizeCopilotToolName(d.toolName ?? "ExternalTool");
      ctx.pendingToolNames.set(d.toolCallId, toolName);
      yield {
        type: "tool_use",
        toolName,
        input: (d.arguments ?? {}) as Record<string, unknown>,
        toolCallId: d.toolCallId,
      };
      return;
    }

    case "external_tool.completed": {
      const d: any = ev.data ?? {};
      const output =
        typeof d.result === "string" ? d.result : JSON.stringify(d);
      yield {
        type: "tool_result",
        toolCallId: d.toolCallId,
        output: capStreamingToolOutput(output),
      };
      ctx.pendingToolNames.delete(d.toolCallId);
      return;
    }

    case "permission.requested":
      // The session's permission handler fires concurrently; the agent-manager
      // already drives the permission UI via that handler. The event itself is
      // informational — no AgentMessage needed.
      return;

    case "permission.completed":
      return;

    case "subagent.started": {
      const d: any = ev.data ?? {};
      const taskId = `subagent_${d.toolCallId}`;
      const parentCallId: string | undefined = d.toolCallId;
      if (parentCallId && d.agentName) {
        ctx.subagentTaskByCallId.set(parentCallId, {
          taskId,
          toolCallId: parentCallId,
          name: d.agentName,
        });
        if (ev.agentId) {
          // Map this agentId so nested tool calls inherit parentToolUseId.
          ctx.agentIdToParentToolCallId.set(ev.agentId, parentCallId);
        }
      }
      return;
    }

    case "subagent.completed":
    case "subagent.failed": {
      const d: any = ev.data ?? {};
      const parentCallId: string | undefined = d.toolCallId;
      const task = parentCallId
        ? ctx.subagentTaskByCallId.get(parentCallId)
        : undefined;
      if (task && parentCallId) {
        ctx.subagentTaskByCallId.delete(parentCallId);
        yield {
          type: "task_notification",
          taskId: task.taskId,
          toolUseId: parentCallId,
          status:
            t === "subagent.failed"
              ? "failed"
              : ("completed" as "completed" | "failed"),
          summary:
            t === "subagent.failed"
              ? (d.error ?? "Sub-agent failed")
              : `${d.agentDisplayName ?? d.agentName ?? "Sub-agent"} finished${
                  typeof d.totalToolCalls === "number"
                    ? ` (${d.totalToolCalls} tool calls)`
                    : ""
                }`,
        };
      }
      return;
    }

    case "subagent.selected":
    case "subagent.deselected":
      return;

    case "session.plan_changed": {
      const d: any = ev.data ?? {};
      if (d.operation === "delete") {
        yield { type: "plan_update", content: "", isStreaming: false };
        return;
      }
      const content = typeof d.content === "string" ? d.content : "";
      yield {
        type: "plan_update",
        content,
        isStreaming: false,
        ...(typeof d.path === "string" ? { title: d.path } : {}),
      };
      return;
    }

    case "exit_plan_mode.requested":
      // The session's exitPlanMode handler responds; the renderer drives the
      // plan-review UI through the existing PLAN_REVIEW IPC.
      return;
    case "exit_plan_mode.completed":
      return;

    case "session.usage_info": {
      const d: any = ev.data ?? {};
      if (typeof d.maxTokens === "number") ctx.contextWindow = d.maxTokens;
      return;
    }

    case "session.error":
    case "model.call_failure": {
      const d: any = ev.data ?? {};
      const message: string =
        typeof d.message === "string"
          ? d.message
          : typeof d.errorMessage === "string"
            ? d.errorMessage
            : "Copilot session error";
      yield {
        type: "error",
        message,
        ...(typeof d.errorCode === "string"
          ? { code: d.errorCode }
          : typeof d.errorType === "string"
            ? { code: d.errorType }
            : {}),
      };
      return;
    }

    case "session.task_complete":
    case "abort":
      return;

    case "session.idle": {
      if (ctx.resultEmitted) return;
      ctx.resultEmitted = true;
      // Emit the consolidated `result` once per turn.
      yield {
        type: "result",
        content: ctx.finalText,
        ...(ctx.finalCost != null ? { cost: ctx.finalCost } : {}),
        ...(ctx.finalUsage ? { usage: ctx.finalUsage } : {}),
        ...(ctx.contextWindow != null
          ? { contextWindow: ctx.contextWindow }
          : {}),
        stop_reason: "end_turn",
      };
      // Reset per-turn state (the session lives on).
      ctx.finalText = "";
      ctx.finalUsage = null;
      ctx.finalCost = undefined;
      return;
    }

    case "session.title_changed":
    case "session.mode_changed":
    case "session.permissions_changed":
    case "session.model_change":
    case "session.context_changed":
    case "session.workspace_file_changed":
    case "session.compaction_start":
    case "session.compaction_complete":
    case "session.truncation":
    case "session.shutdown":
    case "session.handoff":
    case "session.snapshot_rewind":
    case "session.info":
    case "session.warning":
    case "session.schedule_created":
    case "session.schedule_cancelled":
    case "session.autopilot_objective_changed":
    case "session.remote_steerable_changed":
    case "session.custom_notification":
    case "session.background_tasks_changed":
    case "session.skills_loaded":
    case "session.custom_agents_updated":
    case "session.extensions_loaded":
    case "session.canvas.opened":
    case "session.canvas.registry_changed":
    case "user.message":
    case "pending_messages.modified":
    case "user_input.requested":
    case "user_input.completed":
    case "elicitation.requested":
    case "elicitation.completed":
    case "sampling.requested":
    case "sampling.completed":
    case "mcp.oauth_required":
    case "mcp.oauth_completed":
    case "command.queued":
    case "command.execute":
    case "command.completed":
    case "auto_mode_switch.requested":
    case "auto_mode_switch.completed":
    case "capabilities.changed":
    case "skill.invoked":
    case "system.message":
    case "system.notification":
    case "hook.start":
    case "hook.end":
    case "hook.progress":
    case "mcp_app.tool_call_complete":
      return;

    default:
      return;
  }
}

function extractTodos(input: Record<string, unknown>): TodoItem[] {
  const candidates: unknown[] = [];
  for (const key of ["todos", "plan", "items", "tasks"]) {
    const v = (input as any)[key];
    if (Array.isArray(v)) candidates.push(...v);
  }
  if (candidates.length === 0) return [];
  const out: TodoItem[] = [];
  for (const raw of candidates) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as any;
    const content =
      typeof r.content === "string"
        ? r.content
        : typeof r.title === "string"
          ? r.title
          : typeof r.text === "string"
            ? r.text
            : undefined;
    const status =
      r.status === "in_progress" ||
      r.status === "pending" ||
      r.status === "completed"
        ? r.status
        : r.completed
          ? "completed"
          : "pending";
    const activeForm: string =
      typeof r.activeForm === "string" ? r.activeForm : (content ?? "Working");
    if (!content) continue;
    out.push({ content, status, activeForm });
  }
  return out;
}

// ─── Event queue (push-based event handler → AsyncIterator) ──────────────────

class EventQueue<T> {
  private queue: T[] = [];
  private waiters: Array<
    (v: { value: T; done: false } | { done: true }) => void
  > = [];
  private closed = false;

  push(v: T) {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: v, done: false });
    else this.queue.push(v);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    while (this.waiters.length) {
      const w = this.waiters.shift()!;
      w({ done: true });
    }
  }

  async *drain(): AsyncGenerator<T> {
    while (true) {
      if (this.queue.length > 0) {
        yield this.queue.shift()!;
        continue;
      }
      if (this.closed) return;
      const next = await new Promise<
        { value: T; done: false } | { done: true }
      >((resolve) => {
        this.waiters.push(resolve);
      });
      if (next.done) return;
      yield next.value;
    }
  }
}

// ─── CopilotProvider ─────────────────────────────────────────────────────────

export class CopilotProvider implements AgentProvider {
  readonly name = "copilot";

  // Single CopilotClient shared across CopilotProvider instances in the same
  // process. The SDK spawns one `copilot` runtime subprocess per client.
  private static sharedClient: CopilotClientType | undefined;
  private static sharedClientCwd: string | undefined;

  private config: ProviderConfig = {};
  private sessionId?: string;
  private currentSession?: CopilotSessionType;
  private modelInfoCache?: ModelInfo[];
  private lastContextUsage: ContextUsage | null = null;
  private lastKnownMcpStatus: McpServerInfo[] = [];

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
  }

  private async getClient(cwd: string): Promise<CopilotClientType> {
    const sdk = getSdk();
    // The shared client hosts multiple concurrent sessions across threads.
    // Its constructor `workingDirectory` only sets the spawned runtime's cwd;
    // per-session working directories come from SessionConfig.workingDirectory,
    // so we must NOT tear the client down when a new thread has a different
    // cwd — that would close every active session (killing any in-flight
    // stream on other threads). Reuse the client if it already exists.
    if (CopilotProvider.sharedClient) {
      return CopilotProvider.sharedClient;
    }
    const cliPath = resolveCopilotCliPath(this.config.cliPath);
    const client = new sdk.CopilotClient({
      workingDirectory: cwd,
      mode: "copilot-cli",
      logLevel: "warning",
      ...(cliPath
        ? { connection: sdk.RuntimeConnection.forStdio({ path: cliPath }) }
        : {}),
    });
    CopilotProvider.sharedClient = client;
    CopilotProvider.sharedClientCwd = cwd;
    return client;
  }

  canResume(sessionId: string): boolean {
    // The Copilot CLI persists sessions to ~/.copilot/sessions/. We optimistically
    // return true for any non-empty id and let resumeSession() surface a real
    // failure if the session is missing — the caller catches and falls back
    // to a fresh session via the agent-manager stale-session retry path.
    return typeof sessionId === "string" && sessionId.length > 0;
  }

  async getAvailableModels(): Promise<ModelInfo[]> {
    if (this.modelInfoCache) return this.modelInfoCache;
    const cwd = this.config.cwd ?? process.env.HOME ?? process.cwd();
    const client = await this.getClient(cwd);
    let models: CopilotModelInfo[];
    try {
      // start() is idempotent — safe to call multiple times.
      await client.start();
      models = await client.listModels();
    } catch (err) {
      // Surface a single fallback so the picker isn't empty.
      const message = (err as Error)?.message ?? "Unknown error";
      console.warn(`[copilot] listModels failed: ${message}`);
      return [
        {
          value: "gpt-4.1",
          displayName: "GPT-4.1",
          description: "Default Copilot model",
        },
      ];
    }
    this.modelInfoCache = models.map((m) => ({
      value: m.id,
      displayName: m.name ?? m.id,
      description: `${m.capabilities?.limits?.max_context_window_tokens?.toLocaleString?.() ?? ""} ctx`,
      supportsEffort: !!m.capabilities?.supports?.reasoningEffort,
    }));
    return this.modelInfoCache;
  }

  async discoverSlashCommands(): Promise<
    { name: string; description?: string }[]
  > {
    // The Copilot CLI exposes commands via the running session, not the
    // client. Surface a small built-in set as a stable baseline; the live
    // session_init refreshes the list when commands.changed fires.
    return [
      { name: "help", description: "Show available commands" },
      { name: "exit", description: "End the conversation" },
      { name: "clear", description: "Clear the conversation context" },
    ];
  }

  async getMcpServerStatus(): Promise<McpServerInfo[]> {
    return this.lastKnownMcpStatus;
  }

  async toggleMcpServer(): Promise<void> {
    // Copilot CLI has no runtime toggle in beta.9. No-op; UI tooltip should
    // explain the limitation. Persistent enable/disable requires session restart.
  }

  async reconnectMcpServer(): Promise<{ authUrl?: string } | void> {
    return;
  }

  async getContextUsage(): Promise<ContextUsage | null> {
    return this.lastContextUsage;
  }

  async interrupt(): Promise<void> {
    if (this.currentSession) {
      try {
        await this.currentSession.abort();
      } catch (err) {
        console.warn(
          `[copilot] abort error: ${(err as Error)?.message ?? err}`,
        );
      }
    }
  }

  async dispose(): Promise<void> {
    if (this.currentSession) {
      try {
        await this.currentSession.disconnect();
      } catch {
        /* best-effort */
      }
      this.currentSession = undefined;
    }
  }

  async *sendMessage(params: SendMessageParams): AsyncGenerator<AgentMessage> {
    const sdk = getSdk();
    const cwd =
      params.cwd ?? this.config.cwd ?? process.env.HOME ?? process.cwd();
    const client = await this.getClient(cwd);
    const mode = params.mode ?? "default";
    const modeConfig = MODE_CONFIGS[mode] ?? MODE_CONFIGS.default;
    const dangerous = !!modeConfig.dangerous;

    // ── Permission handler — wraps the host's permissionHandler ──
    const permissionHandler = async (
      req: PermissionRequest,
    ): Promise<PermissionRequestResult> => {
      // Auto-approve in non-default modes.
      if (mode === "acceptEdits" && req.kind === "write") {
        return { kind: "approve-once" };
      }
      if (mode === "fullAccess" || dangerous) {
        return { kind: "approve-once" };
      }
      // Plan mode: deny anything that mutates state.
      if (mode === "plan") {
        if (
          req.kind === "write" ||
          req.kind === "shell" ||
          req.kind === "mcp" ||
          req.kind === "custom-tool"
        ) {
          return { kind: "reject", feedback: "Plan mode is read-only." };
        }
      }
      // Forward to host handler.
      const { toolName, input } = permissionRequestToInput(req);
      const result = await params.permissionHandler(toolName, input);
      if (result.approved) return { kind: "approve-once" };
      return {
        kind: "reject",
        ...(result.denyMessage ? { feedback: result.denyMessage } : {}),
      };
    };

    // ── exitPlanMode handler — route through host's plan-review IPC by
    //    deferring to user via the question/permission protocol the host owns.
    //    For v1, accept the recommended action so the agent can proceed.
    const exitPlanModeHandler = async (req: any) => {
      return {
        approved: true,
        selectedAction: req.recommendedAction ?? "interactive",
      };
    };

    // ── Elicitation handler ──
    const elicitationHandler = async (
      ctx: any,
    ): Promise<{
      action: "accept" | "decline" | "cancel";
      content?: Record<string, any>;
    }> => {
      if (params.onElicitation) {
        const result = await params.onElicitation({
          serverName: ctx.elicitationSource ?? "copilot",
          message: ctx.message,
          mode: ctx.mode,
          url: ctx.url,
          requestedSchema: ctx.requestedSchema,
        });
        return {
          action: result.action,
          ...(result.content ? { content: result.content } : {}),
        };
      }
      return { action: "decline" };
    };

    // ── Session config / resume ──
    const reasoningEffort = stratosEffortToCopilot(params.thinkingEffort);
    const mcpServers = translateMcpServers(this.config.mcpServers);
    const customAgents = translateCustomAgents(this.config.agents);

    const sessionConfigBase = {
      clientName: "stratos",
      ...((params.model ?? this.config.model)
        ? { model: (params.model ?? this.config.model)! }
        : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
      streaming: true,
      workingDirectory: cwd,
      onPermissionRequest: permissionHandler,
      onExitPlanModeRequest: exitPlanModeHandler,
      onElicitationRequest: elicitationHandler,
      ...(mcpServers ? { mcpServers } : {}),
      ...(customAgents ? { customAgents } : {}),
      enableConfigDiscovery: true,
      includeSubAgentStreamingEvents: true,
    };

    // ── Bridge queue ──
    const queue = new EventQueue<SessionEvent>();
    const ctx = makeBridgeContext();

    let session: CopilotSessionType;
    try {
      if (params.sessionId) {
        // Resume path
        const resumeConfig: ResumeSessionConfig = {
          ...sessionConfigBase,
          onEvent: (ev) => queue.push(ev),
        };
        session = await client.resumeSession(params.sessionId, resumeConfig);
      } else {
        const createConfig: SessionConfig = {
          ...sessionConfigBase,
          onEvent: (ev) => queue.push(ev),
        };
        session = await client.createSession(createConfig);
      }
    } catch (err) {
      const message = (err as Error)?.message ?? "Failed to start session";
      yield { type: "error", message, code: "SESSION_START_FAILED" };
      return;
    }

    this.currentSession = session;
    this.sessionId = session.sessionId;
    ctx.sessionId = session.sessionId;

    // OpenAI-family models hide reasoning unless we explicitly request a
    // reasoning summary. `setModel` is the only RPC that accepts the
    // `reasoningSummary` field; the SDK's TypeScript types don't expose
    // it yet, so cast. Best-effort — models without reasoning summary
    // support reject the call, which we ignore.
    const modelForReasoning = params.model ?? this.config.model;
    if (modelForReasoning) {
      try {
        await (
          session as unknown as {
            setModel: (
              id: string,
              opts: Record<string, unknown>,
            ) => Promise<void>;
          }
        ).setModel(modelForReasoning, {
          ...(reasoningEffort ? { reasoningEffort } : {}),
          reasoningSummary: "detailed",
        });
      } catch (err) {
        console.warn(
          `[copilot] enabling reasoning summary failed: ${(err as Error)?.message ?? err}`,
        );
      }
    }

    // Emit initial session_init synthesized from what we know now; events
    // for tools/commands/mcp will refine via the cached fields.
    const init = emitInitIfReady(ctx);
    if (init) yield init;

    // The onEvent config callback is already subscribed; do NOT also call
    // session.on() — that would double-push every event into the queue.
    const unsubscribe = () => {};

    // Drive the send (don't await; events flow asynchronously into the queue).
    const attachments = imagesToAttachments(params.images);
    const messageOptions: MessageOptions = {
      prompt: params.prompt,
      mode: "immediate",
      agentMode: stratosModeToCopilotAgentMode(mode),
      ...(attachments ? { attachments } : {}),
    };

    const sendPromise = session.send(messageOptions).catch((err) => {
      queue.push({
        type: "session.error",
        data: {
          errorType: "system",
          message: (err as Error)?.message ?? "send failed",
        },
        id: `local_${Date.now()}`,
        parentId: null,
        timestamp: new Date().toISOString(),
        ephemeral: true,
      } as any);
    });

    // Set up idle-close: when session.idle arrives, we still want to keep
    // draining events but mark turn done. We'll close the queue after a tiny
    // grace period to absorb trailing events.
    let idleSeen = false;
    let idleCloseTimer: NodeJS.Timeout | undefined;

    // Walk the queue, yielding mapped messages.
    const drainerEvents = queue.drain();
    try {
      for await (const ev of drainerEvents) {
        if (params.traceCallback) {
          try {
            params.traceCallback({
              timestamp: Date.now(),
              sessionId: this.sessionId,
              messageType: ev.type,
              data: truncateForTrace(ev),
            });
          } catch {
            /* tracing errors must not break streaming */
          }
        }
        for (const m of mapEvent(ev, ctx)) {
          yield m;
        }
        if (ev.type === "session.idle" && !idleSeen) {
          idleSeen = true;
          // Give a tiny window for any trailing usage/turn_end events.
          idleCloseTimer = setTimeout(() => queue.close(), 250);
        }
        if (ev.type === "session.shutdown") {
          queue.close();
        }
      }
    } finally {
      if (idleCloseTimer) clearTimeout(idleCloseTimer);
      try {
        unsubscribe();
      } catch {
        /* */
      }
      try {
        await sendPromise;
      } catch {
        /* already pushed as error */
      }
    }
  }
}

export type { CopilotProvider as CopilotProviderClass };
