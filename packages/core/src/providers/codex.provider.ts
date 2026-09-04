import type {
  AgentProvider,
  AgentMessage,
  SendMessageParams,
  ProviderConfig,
  ModelInfo,
  McpServerInfo,
} from "./types";

import { execSync, spawn, type ChildProcess } from "child_process";
import * as readline from "readline";
import * as path from "path";
import * as fs from "fs";
import { truncateForTrace } from "../storage/trace.store";

/**
 * Translate Stratos's `mcpServers` config into Codex `-c` arg pairs (each
 * MCP config key becomes one `-c key=value` pair, prepended in reverse
 * order so the final argv reads left-to-right).
 *
 * Returns an array that, when `unshift`-ed one at a time onto an argv, yields:
 *   [-c, mcp_servers.name.command="cmd", -c, mcp_servers.name.args=[...], ...]
 */
export function buildCodexMcpArgs(
  mcpServers: Record<string, unknown>,
): string[] {
  const toml = (v: string): string =>
    `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  const out: string[] = [];
  for (const [name, raw] of Object.entries(mcpServers)) {
    const config = raw as {
      type?: string;
      command?: string;
      args?: string[];
      env?: Record<string, string>;
    };
    if (config.type === "sdk" || !config.command) continue;
    out.push(`mcp_servers.${name}.command=${toml(config.command)}`);
    out.push("-c");
    if (config.args?.length) {
      out.push(`mcp_servers.${name}.args=[${config.args.map(toml).join(",")}]`);
      out.push("-c");
    }
    if (config.env) {
      for (const [k, v] of Object.entries(config.env)) {
        out.push(`mcp_servers.${name}.env.${k}=${toml(v)}`);
        out.push("-c");
      }
    }
  }
  return out;
}

type CodexReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

type CodexCollaborationMode = {
  mode: "plan" | "default";
  settings: {
    model: string;
    reasoning_effort: CodexReasoningEffort | null;
    developer_instructions: string | null;
  };
};

/**
 * Find the Codex CLI binary shipped with @openai/codex via @openai/codex-sdk.
 * This mirrors the findCodexPath() logic in the SDK itself.
 */
export function findCodexBinary(): string {
  const { platform, arch } = process;
  let targetTriple: string | null = null;
  switch (platform) {
    case "linux":
    case "android":
      targetTriple =
        arch === "x64"
          ? "x86_64-unknown-linux-musl"
          : arch === "arm64"
            ? "aarch64-unknown-linux-musl"
            : null;
      break;
    case "darwin":
      targetTriple =
        arch === "x64"
          ? "x86_64-apple-darwin"
          : arch === "arm64"
            ? "aarch64-apple-darwin"
            : null;
      break;
    case "win32":
      targetTriple =
        arch === "x64"
          ? "x86_64-pc-windows-msvc"
          : arch === "arm64"
            ? "aarch64-pc-windows-msvc"
            : null;
      break;
  }
  if (!targetTriple) {
    throw new Error(`Unsupported platform: ${platform} (${arch})`);
  }

  const binaryName = process.platform === "win32" ? "codex.exe" : "codex";
  const explicitCodexPath = process.env.STRATOS_CODEX_PATH;
  if (explicitCodexPath && fs.existsSync(explicitCodexPath)) {
    return explicitCodexPath;
  }
  // Codex CLI >=0.15x moved the binary from vendor/<triple>/codex/<name> to
  // vendor/<triple>/bin/<name>. Try both layouts, newest first.
  const binaryRelPaths = [
    path.join("vendor", targetTriple, "bin", binaryName),
    path.join("vendor", targetTriple, "codex", binaryName),
  ];

  // The native binary lives in the platform-specific optional package,
  // e.g. @openai/codex-darwin-arm64, not in @openai/codex itself.
  const platformPackageMap: Record<string, string> = {
    "x86_64-unknown-linux-musl": "@openai/codex-linux-x64",
    "aarch64-unknown-linux-musl": "@openai/codex-linux-arm64",
    "x86_64-apple-darwin": "@openai/codex-darwin-x64",
    "aarch64-apple-darwin": "@openai/codex-darwin-arm64",
    "x86_64-pc-windows-msvc": "@openai/codex-win32-x64",
    "aarch64-pc-windows-msvc": "@openai/codex-win32-arm64",
  };
  const platformPackage = platformPackageMap[targetTriple];

  // Walk up from multiple starting points looking for the codex binary.
  // app.asar.unpacked must come before __dirname: in a packaged app __dirname
  // is inside app.asar, and Electron's fs intercept makes existsSync return
  // true for asar-relative paths, but spawn() goes to the OS and fails with
  // ENOTDIR because app.asar is a file, not a directory.
  const resourcesPath: string | undefined = (process as any).resourcesPath;
  const startDirs = [
    ...(resourcesPath
      ? [path.join(resourcesPath, "app.asar.unpacked"), resourcesPath]
      : []),
    __dirname,
    process.cwd(),
  ].filter(Boolean);

  for (const startDir of startDirs) {
    let dir = startDir;
    for (let i = 0; i < 10; i++) {
      for (const binaryRelPath of binaryRelPaths) {
        // Check platform-specific package (primary location)
        if (platformPackage) {
          const platformCandidate = path.join(
            dir,
            "node_modules",
            platformPackage,
            binaryRelPath,
          );
          if (fs.existsSync(platformCandidate)) return platformCandidate;
        }

        // Check pnpm hoisted layout: node_modules/.pnpm/@openai+codex@*-<platform>-<arch>/...
        const pnpmDir = path.join(dir, "node_modules", ".pnpm");
        try {
          const entries = fs.readdirSync(pnpmDir);
          for (const entry of entries) {
            if (
              entry.startsWith("@openai+codex@") &&
              entry.includes(`-${process.platform}-`)
            ) {
              const candidate = path.join(
                pnpmDir,
                entry,
                "node_modules",
                "@openai",
                "codex",
                binaryRelPath,
              );
              if (fs.existsSync(candidate)) return candidate;

              // Also check platform package inside pnpm entry
              if (platformPackage) {
                const [, pkgName] = platformPackage.split("/");
                const pnpmPlatformCandidate = path.join(
                  pnpmDir,
                  entry,
                  "node_modules",
                  "@openai",
                  pkgName,
                  binaryRelPath,
                );
                if (fs.existsSync(pnpmPlatformCandidate))
                  return pnpmPlatformCandidate;
              }
            }
          }
        } catch {
          // Directory doesn't exist
        }

        // Check direct node_modules layout (npm/yarn)
        const directCandidate = path.join(
          dir,
          "node_modules",
          "@openai",
          "codex",
          binaryRelPath,
        );
        if (fs.existsSync(directCandidate)) return directCandidate;

        // Also check via @openai/codex-sdk symlink chain
        const sdkCodexDir = path.join(
          dir,
          "node_modules",
          "@openai",
          "codex-sdk",
          "node_modules",
          "@openai",
          "codex",
        );
        const sdkCandidate = path.join(sdkCodexDir, binaryRelPath);
        if (fs.existsSync(sdkCandidate)) return sdkCandidate;
      }

      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  // The Codex desktop app and standalone CLI are valid app-server hosts too.
  // This fallback is especially useful when a package manager or host security
  // policy strips the large optional native binary from node_modules.
  const fallbackCandidates = [
    ...(process.platform === "darwin"
      ? ["/Applications/Codex.app/Contents/Resources/codex"]
      : []),
    ...(process.env.PATH ?? "")
      .split(path.delimiter)
      .filter(Boolean)
      .map((dir) => path.join(dir, binaryName)),
  ];
  for (const candidate of fallbackCandidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }

  throw new Error(
    "Unable to locate Codex CLI binary. Install Codex or set STRATOS_CODEX_PATH.",
  );
}

/**
 * Resolve the canonical repository root for Codex trust settings.
 * In git worktrees, Codex expects trust on the shared repo root.
 */
function resolveCodexTrustProjectPath(cwd?: string): string | undefined {
  if (!cwd) return undefined;
  try {
    const commonGitDir = execSync(
      "git rev-parse --path-format=absolute --git-common-dir",
      {
        cwd,
        encoding: "utf-8",
        timeout: 3000,
        stdio: ["pipe", "pipe", "pipe"],
      },
    ).trim();
    if (!commonGitDir) return undefined;
    return path.dirname(commonGitDir);
  } catch {
    return undefined;
  }
}

/**
 * Map Stratos thinking effort to Codex reasoning effort.
 *
 * Stratos: 'low' | 'medium' | 'high' | 'max'
 * Codex:      'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
 */
function mapThinkingEffort(effort?: string): string | undefined {
  switch (effort) {
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
      return "high";
    case "max":
      return "xhigh";
    default:
      return undefined;
  }
}

/**
 * Map Stratos mode to Codex approval policy and sandbox mode.
 *
 * Stratos Codex modes → Codex equivalents:
 *
 * plan              → read-only sandbox, never ask (sandbox enforces read-only)
 * default           → workspace-write, on-request (Codex "Default permissions")
 * fullAccess        → danger-full-access, never (Codex "Full access")
 *
 * Codex approval policy semantics:
 *   untrusted  — always ask for approval (more restrictive than Codex default)
 *   on-request — ask when the model explicitly requests it (matches Codex default)
 *   on-failure — ask only when something fails
 *   never      — never ask, auto-approve everything (matches Codex full access)
 */
function mapModeToPolicy(
  mode?: string,
  configSandbox?: string,
): {
  approvalPolicy: string;
  sandbox: string;
} {
  switch (mode) {
    case "plan":
      // Use workspace-write for the thread sandbox even in plan mode.
      // Plan-mode read-only behavior is enforced by collaborationMode in turn/start.
      // This allows switching to an implementation turn on the same thread.
      return {
        approvalPolicy: "never",
        sandbox: configSandbox ?? "workspace-write",
      };
    case "default":
      return {
        approvalPolicy: "on-request",
        sandbox: configSandbox ?? "workspace-write",
      };
    case "acceptEdits":
      return {
        approvalPolicy: "on-request",
        sandbox: configSandbox ?? "workspace-write",
      };
    case "fullAccess":
    case "bypassPermissions":
      return { approvalPolicy: "never", sandbox: "danger-full-access" };
    default:
      return {
        approvalPolicy: "on-request",
        sandbox: configSandbox ?? "workspace-write",
      };
  }
}

/**
 * OpenAI Codex provider implementation.
 *
 * Uses the Codex **app-server** protocol (JSON-RPC 2.0 over stdio) which supports
 * true token-by-token text streaming via `item/agentMessage/delta` notifications.
 *
 * Protocol flow:
 *   initialize → initialized (notification) → thread/start → turn/start → listen for notifications
 *
 * Features implemented:
 * - Text streaming via `item/agentMessage/delta`
 * - Reasoning streaming via `item/reasoning/summaryTextDelta` and `item/reasoning/textDelta`
 * - Command execution with output streaming via `item/commandExecution/outputDelta`
 * - File change streaming via `item/fileChange/outputDelta`
 * - Plan streaming via `item/plan/delta`
 * - Approval handling via `item/commandExecution/requestApproval` and `item/fileChange/requestApproval`
 * - Dynamic model discovery via `model/list` RPC
 * - Thread resume via `thread/resume`
 * - Image input support via `localImage` UserInput type
 * - Thinking effort mapping
 * - Mode support (plan/default/acceptEdits/bypassPermissions)
 * - System prompt passthrough via `baseInstructions`/`developerInstructions`
 * - Token usage and context window tracking
 * - Turn status handling (completed/interrupted/failed)
 * - Skills discovery via `skills/list`
 */
export class CodexProvider implements AgentProvider {
  readonly name = "codex";
  readonly midTurnSteering = "interrupt-and-restart" as const;
  private config: ProviderConfig = {};
  private threadId?: string;
  private turnId?: string;
  private appServer?: ChildProcess;
  private rl?: readline.Interface;
  private rpcId = 0;
  private initialized = false;
  private sessionInitSent = false;
  /** Pending RPC responses keyed by request ID */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pendingRpc = new Map<
    number,
    { resolve: (v: any) => void; reject: (e: Error) => void }
  >();
  /** Notification queue for streaming events during a turn */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private notificationQueue: Array<{
    method: string;
    params: any;
    id?: number;
  }> = [];
  /** Resolves when a new notification arrives */
  private notificationResolve?: () => void;
  /** Cached dynamic model list */
  private cachedModels?: ModelInfo[];
  /** Track command output streaming per item */
  private commandOutputBuffers = new Map<string, string>();
  /** Track file change output streaming per item */
  private fileChangeOutputBuffers = new Map<string, string>();
  /** Track file change metadata for approval payload enrichment */
  private fileChangeMetadataBuffers = new Map<
    string,
    Array<{ file_path: string; kind: string; diff?: string }>
  >();
  /** Track reasoning streaming per item */
  private reasoningBuffers = new Map<
    string,
    { summary: string; content: string }
  >();
  /** Best-effort plan collaboration mode discovered from app-server */
  private planCollaborationMode?: CodexCollaborationMode;
  /** Tracks whether the previous turn used plan mode (to explicitly clear it) */
  private lastTurnWasPlan = false;
  /** Guard to avoid calling collaborationMode/list repeatedly */
  private collaborationModesLoaded = false;

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapMcpServerStatus(
    authStatus: any,
    tools: any,
  ): McpServerInfo["status"] {
    if (authStatus === "oAuth" || authStatus === "bearerToken") {
      return "connected";
    }
    if (authStatus === "notLoggedIn") {
      return "needs-auth";
    }
    if (authStatus === "unsupported") {
      return tools && Object.keys(tools).length > 0 ? "connected" : "failed";
    }
    return "failed";
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private normalizeFileChangeKind(kind: any): string {
    if (typeof kind === "string" && kind) return kind;
    if (kind && typeof kind.type === "string" && kind.type) return kind.type;
    return "update";
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private captureFileChangeMetadata(item: any): void {
    const itemId = typeof item?.id === "string" ? item.id : "";
    const rawChanges = Array.isArray(item?.changes) ? item.changes : [];
    if (!itemId || rawChanges.length === 0) return;

    const changes = rawChanges.map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (change: any) => {
        const out: { file_path: string; kind: string; diff?: string } = {
          file_path:
            typeof change?.path === "string" && change.path
              ? change.path
              : "Unknown file",
          kind: this.normalizeFileChangeKind(change?.kind),
        };
        if (typeof change?.diff === "string" && change.diff) {
          out.diff = change.diff;
        }
        return out;
      },
    );

    this.fileChangeMetadataBuffers.set(itemId, changes);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private buildFileChangeApprovalInput(
    p: any,
    requestId: number,
  ): Record<string, unknown> {
    const reason = p.reason ?? undefined;
    const grantRoot = p.grantRoot ?? undefined;
    const itemId =
      typeof p.itemId === "string" && p.itemId.length > 0
        ? p.itemId
        : undefined;
    const changes = itemId
      ? (this.fileChangeMetadataBuffers.get(itemId) ?? [])
      : [];

    const input: Record<string, unknown> = {
      ...(itemId ? { itemId } : {}),
      ...(changes.length > 0 ? { changes } : {}),
      ...(reason ? { reason } : {}),
      ...(grantRoot ? { grantRoot } : {}),
    };

    if (changes.length === 1) {
      const change = changes[0];
      input.file_path = change.file_path;
      input.kind = change.kind;
      if (change.diff) {
        input.diff = change.diff;
      }
    }

    if (Object.keys(input).length === 0) {
      input.requestId = requestId;
    }

    return input;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private isCodexReasoningEffort(value: any): value is CodexReasoningEffort {
    return (
      value === "none" ||
      value === "minimal" ||
      value === "low" ||
      value === "medium" ||
      value === "high" ||
      value === "xhigh"
    );
  }

  /**
   * Extract plan collaboration mode metadata from collaborationMode/list.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractPlanCollaborationMode(result: any): {
    mode: "plan";
    model?: string;
    reasoning_effort?: CodexReasoningEffort | null;
  } {
    // App-server shapes have evolved; accept several likely containers.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const modes: any[] = Array.isArray(result?.data)
      ? result.data
      : Array.isArray(result?.modes)
        ? result.modes
        : Array.isArray(result?.collaborationModes)
          ? result.collaborationModes
          : [];

    type Candidate = {
      score: number;
      model?: string;
      reasoning_effort?: CodexReasoningEffort | null;
    };
    const candidates: Candidate[] = [];

    for (const m of modes) {
      const terms = [
        String(m?.mode ?? ""),
        String(m?.name ?? ""),
        String(m?.slug ?? ""),
        String(m?.title ?? ""),
        String(m?.displayName ?? ""),
      ]
        .join(" ")
        .toLowerCase();

      if (!terms) continue;
      let score = 0;
      if (terms === "plan") score = 100;
      else if (terms.includes(" plan ")) score = 90;
      else if (terms.includes("plan")) score = 80;
      else if (terms.includes("planner")) score = 70;
      else continue;

      const model =
        typeof m?.model === "string" && m.model.trim().length > 0
          ? m.model.trim()
          : undefined;
      const reasoning_effort = this.isCodexReasoningEffort(m?.reasoning_effort)
        ? m.reasoning_effort
        : m?.reasoning_effort === null
          ? null
          : undefined;

      candidates.push({ score, model, reasoning_effort });
    }

    candidates.sort((a, b) => b.score - a.score);
    return {
      mode: "plan",
      ...(candidates[0]?.model ? { model: candidates[0].model } : {}),
      ...(candidates[0]?.reasoning_effort !== undefined
        ? { reasoning_effort: candidates[0].reasoning_effort }
        : {}),
    };
  }

  /**
   * Discover collaboration modes (experimental API) and cache plan mode ID.
   * If unsupported, we silently fall back to read-only plan behavior.
   */
  private async ensureCollaborationModesDiscovered(): Promise<void> {
    if (this.collaborationModesLoaded) return;
    this.collaborationModesLoaded = true;
    try {
      const result = await this.sendRpc("collaborationMode/list", {});
      const extracted = this.extractPlanCollaborationMode(result);
      this.planCollaborationMode = {
        mode: "plan",
        settings: {
          model: extracted.model ?? "",
          reasoning_effort:
            extracted.reasoning_effort === undefined
              ? null
              : extracted.reasoning_effort,
          developer_instructions: null,
        },
      };
    } catch {
      this.planCollaborationMode = undefined;
    }
  }

  /**
   * Extract text payload from turn/plan/updated notifications.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractPlanText(p: any): string {
    const direct = p?.text;
    if (typeof direct === "string") return direct;

    const plan = p?.plan;
    if (typeof plan === "string") return plan;
    if (typeof plan?.text === "string") return plan.text;

    const turnPlan = p?.turn?.plan;
    if (typeof turnPlan === "string") return turnPlan;
    if (typeof turnPlan?.text === "string") return turnPlan.text;

    return "";
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractPlanUpdate(p: any): {
    text: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    steps?: any[];
    explanation?: string;
  } {
    const text = this.extractPlanText(p);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const planObj: any =
      p?.plan && typeof p.plan === "object"
        ? p.plan
        : p?.turn?.plan && typeof p.turn.plan === "object"
          ? p.turn.plan
          : undefined;
    const steps = Array.isArray(planObj?.steps)
      ? planObj.steps
      : Array.isArray(p?.plan)
        ? p.plan
        : Array.isArray(p?.steps)
          ? p.steps
          : undefined;
    const explanation =
      typeof planObj?.explanation === "string"
        ? planObj.explanation
        : typeof p?.explanation === "string"
          ? p.explanation
          : undefined;
    return { text, steps, explanation };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private formatPlanMarkdown(plan: {
    steps?: any[];
    explanation?: string;
  }): string {
    const lines: string[] = [];
    if (plan.explanation) lines.push(plan.explanation.trim());
    const steps = Array.isArray(plan.steps) ? plan.steps : [];
    if (steps.length > 0) {
      if (lines.length > 0) lines.push("");
      lines.push("## Plan");
      for (const step of steps) {
        const text =
          typeof step?.step === "string"
            ? step.step
            : typeof step?.content === "string"
              ? step.content
              : "";
        if (!text) continue;
        const status =
          typeof step?.status === "string" && step.status
            ? ` (${step.status})`
            : "";
        lines.push(`- ${text}${status}`);
      }
    }
    return lines.join("\n").trim();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private normalizeRequestUserInputPayload(p: any): Record<string, unknown> {
    const rawQuestions = Array.isArray(p?.questions) ? p.questions : [];
    if (rawQuestions.length === 0) return p ?? {};

    return {
      questions: rawQuestions.map((q: any) => ({
        ...(typeof q?.id === "string" ? { id: q.id } : {}),
        question:
          typeof q?.question === "string"
            ? q.question
            : typeof q?.prompt === "string"
              ? q.prompt
              : "",
        ...(typeof q?.header === "string" ? { header: q.header } : {}),
        options: Array.isArray(q?.options)
          ? q.options.map((o: any) => ({
              label:
                typeof o?.label === "string"
                  ? o.label
                  : typeof o?.title === "string"
                    ? o.title
                    : String(o ?? ""),
              ...(typeof o?.description === "string"
                ? { description: o.description }
                : {}),
            }))
          : [],
        multiSelect: Boolean(q?.multiSelect),
      })),
    };
  }

  /**
   * Send a JSON-RPC request and wait for the response.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sendRpc(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<any> {
    if (!this.appServer?.stdin) {
      return Promise.reject(new Error("App server not running"));
    }
    const id = ++this.rpcId;
    const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    this.appServer.stdin.write(msg + "\n");

    return new Promise((resolve, reject) => {
      this.pendingRpc.set(id, { resolve, reject });
    });
  }

  /**
   * Send a JSON-RPC notification (no id, no response expected).
   */
  private sendNotification(
    method: string,
    params: Record<string, unknown> = {},
  ): void {
    if (!this.appServer?.stdin) return;
    const msg = JSON.stringify({ jsonrpc: "2.0", method, params });
    this.appServer.stdin.write(msg + "\n");
  }

  /**
   * Send a JSON-RPC response to a server request (approval callbacks, etc.).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sendResponse(id: number, result: any): void {
    if (!this.appServer?.stdin) return;
    const msg = JSON.stringify({ jsonrpc: "2.0", id, result });
    this.appServer.stdin.write(msg + "\n");
  }

  /**
   * Start the app-server process if not already running.
   */
  private async ensureAppServer(): Promise<void> {
    if (this.appServer && !this.appServer.killed) return;

    const codexPath = findCodexBinary();
    const appServerArgs = ["app-server"];
    // Enable AskUserQuestion-style tool requests in default mode at process level.
    // App-server reads this from Codex config overrides (`-c key=value`).
    appServerArgs.unshift("features.default_mode_request_user_input=true");
    appServerArgs.unshift("-c");
    const trustProjectPath = resolveCodexTrustProjectPath(this.config.cwd);
    if (trustProjectPath) {
      appServerArgs.unshift(
        `projects.${trustProjectPath}.trust_level="trusted"`,
      );
      appServerArgs.unshift("-c");
    }

    // Inject Stratos-provided MCP servers (stratos-scheduler / stratos-preview /
    // stratos-manager) as Codex TOML config overrides. Only stdio-style entries
    // (with `command` + `args`) are forwarded — SDK entries are claude-code-only.
    const mcpArgs = buildCodexMcpArgs(this.config.mcpServers ?? {});
    for (const a of mcpArgs) appServerArgs.unshift(a);

    this.appServer = spawn(codexPath, appServerArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      ...(this.config.cwd ? { cwd: this.config.cwd } : {}),
      env: { ...process.env },
    });

    this.appServer.on("exit", () => {
      this.appServer = undefined;
      this.initialized = false;
      this.threadId = undefined;
      this.turnId = undefined;
      this.planCollaborationMode = undefined;
      this.collaborationModesLoaded = false;
      this.fileChangeMetadataBuffers.clear();
    });

    // Ignore stderr (logging noise)
    this.appServer.stderr?.resume();

    // Set up line reader for JSONL output
    this.rl = readline.createInterface({
      input: this.appServer.stdout!,
      crlfDelay: Infinity,
    });

    this.rl.on("line", (line: string) => {
      try {
        const msg = JSON.parse(line);

        // JSON-RPC response (has id, no method)
        if (msg.id !== undefined && !msg.method) {
          const pending = this.pendingRpc.get(msg.id);
          if (pending) {
            this.pendingRpc.delete(msg.id);
            if (msg.error) {
              pending.reject(
                new Error(msg.error.message ?? JSON.stringify(msg.error)),
              );
            } else {
              pending.resolve(msg.result);
            }
          }
          return;
        }

        // JSON-RPC server request (has both id and method) — e.g., approval requests
        // or JSON-RPC notification (has method, no id)
        if (msg.method) {
          this.notificationQueue.push({
            method: msg.method,
            params: msg.params ?? {},
            id: msg.id, // present for server requests, undefined for notifications
          });
          if (this.notificationResolve) {
            this.notificationResolve();
            this.notificationResolve = undefined;
          }
        }
      } catch {
        // Ignore unparseable lines
      }
    });

    // Unblock any pending waitForNotification when the server exits
    this.rl.on("close", () => {
      if (this.notificationResolve) {
        this.notificationResolve();
        this.notificationResolve = undefined;
      }
    });

    // Initialize the app-server
    if (!this.initialized) {
      await this.sendRpc("initialize", {
        clientInfo: {
          name: "stratos",
          title: "Stratos",
          version: "0.1.0",
        },
        capabilities: { experimentalApi: true },
      });
      // Send the `initialized` notification as required by the protocol handshake
      this.sendNotification("initialized");
      this.initialized = true;
      await this.ensureCollaborationModesDiscovered();
    }
  }

  /**
   * Wait for the next notification, or return immediately if one is queued.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async waitForNotification(): Promise<{
    method: string;
    params: any;
    id?: number;
  } | null> {
    if (this.notificationQueue.length > 0) {
      return this.notificationQueue.shift()!;
    }
    return new Promise((resolve) => {
      this.notificationResolve = () => {
        if (this.notificationQueue.length > 0) {
          resolve(this.notificationQueue.shift()!);
        } else {
          resolve(null);
        }
      };
    });
  }

  /**
   * Build the UserInput array for a turn/start request.
   * Supports text and images (via localImage type).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private buildUserInput(params: {
    prompt?: string;
    images?: { dataUrl: string; mimeType: string }[];
  }): any[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inputs: any[] = [];

    // Text input
    if (params.prompt) {
      inputs.push({ type: "text", text: params.prompt, text_elements: [] });
    }

    // Image inputs — use localImage for file paths, image for data URLs
    if (params.images && params.images.length > 0) {
      for (const img of params.images) {
        if (img.dataUrl.startsWith("data:")) {
          // Data URL — use the URL directly as image type
          inputs.push({ type: "image", url: img.dataUrl });
        } else {
          // File path
          inputs.push({ type: "localImage", path: img.dataUrl });
        }
      }
    }

    return inputs;
  }

  async *sendMessage(params: SendMessageParams): AsyncGenerator<AgentMessage> {
    // Start app-server if needed
    try {
      await this.ensureAppServer();
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      yield {
        type: "error",
        message: `Failed to start Codex: ${errMsg}`,
        code: "CODEX_START_ERROR",
      };
      return;
    }

    const model = params.model ?? this.config.model;
    const mode = params.mode ?? "default";
    const { approvalPolicy, sandbox } = mapModeToPolicy(
      mode,
      this.config.sandboxPolicy,
    );
    const effort = mapThinkingEffort(params.thinkingEffort);

    // Determine if we should resume or start a new thread
    const shouldResume =
      params.sessionId && this.threadId && params.sessionId === this.threadId;

    if (!this.threadId) {
      // Start a new thread
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const threadStartParams: Record<string, any> = {
          approvalPolicy,
          sandbox,
          experimentalRawEvents: false,
          persistExtendedHistory: false,
        };
        if (model) threadStartParams.model = model;
        if (params.cwd ?? this.config.cwd) {
          threadStartParams.cwd = params.cwd ?? this.config.cwd;
        }
        // Pass system prompt as base/developer instructions
        if (this.config.systemPrompt) {
          if (typeof this.config.systemPrompt === "string") {
            threadStartParams.developerInstructions = this.config.systemPrompt;
          } else if (
            this.config.systemPrompt.type === "preset" &&
            this.config.systemPrompt.append
          ) {
            threadStartParams.developerInstructions =
              this.config.systemPrompt.append;
          }
        }

        const result = await this.sendRpc("thread/start", threadStartParams);
        this.threadId = result?.thread?.id;

        // Drain any notifications emitted during thread start
        while (this.notificationQueue.length > 0) {
          const notif = this.notificationQueue.shift()!;
          if (notif.method === "thread/started" && notif.params?.thread?.id) {
            this.threadId = notif.params.thread.id;
          }
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        yield {
          type: "error",
          message: `Failed to start thread: ${errMsg}`,
          code: "CODEX_THREAD_ERROR",
        };
        return;
      }
    } else if (shouldResume) {
      // Thread already exists and matches sessionId — we can send another turn.
      // The thread is already started, so we just start a new turn below.
    }

    if (!this.threadId) {
      yield {
        type: "error",
        message: "No thread ID after thread/start",
        code: "CODEX_THREAD_ERROR",
      };
      return;
    }

    // Emit session_init on first message
    if (!this.sessionInitSent) {
      this.sessionInitSent = true;
      const mcpServers = await this.getMcpServerStatus();
      yield {
        type: "session_init",
        sessionId: this.threadId,
        tools: [],
        slashCommands: [],
        mcpServers,
      };
    }

    // Clear notification queue and streaming buffers before starting turn
    this.notificationQueue = [];
    this.commandOutputBuffers.clear();
    this.fileChangeOutputBuffers.clear();
    this.fileChangeMetadataBuffers.clear();
    this.reasoningBuffers.clear();

    // Build turn parameters
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const turnParams: Record<string, any> = {
      threadId: this.threadId,
      input: this.buildUserInput(params),
      // Apply mode policy on every turn so mode switches mid-session take effect.
      approvalPolicy,
      sandbox,
    };
    if (model) turnParams.model = model;
    if (effort) turnParams.effort = effort;
    if (params.cwd) turnParams.cwd = params.cwd;
    if (mode === "plan") {
      this.lastTurnWasPlan = true;
      const collaborationMode =
        this.planCollaborationMode ??
        ({
          mode: "plan",
          settings: {
            model: "",
            reasoning_effort: null,
            developer_instructions: null,
          },
        } as const);
      // Ensure we have a model for plan mode — fetch from server if needed.
      if (!this.cachedModels) {
        try {
          await this.getAvailableModels();
        } catch {
          // Best-effort; fallback chain below will handle it.
        }
      }
      const modelForPlanMode =
        collaborationMode.settings.model ||
        model ||
        this.config.model ||
        this.cachedModels?.[0]?.value;
      if (modelForPlanMode) {
        turnParams.collaborationMode = {
          mode: "plan",
          settings: {
            model: modelForPlanMode,
            reasoning_effort:
              collaborationMode.settings.reasoning_effort ?? effort ?? null,
            developer_instructions: null,
          },
        };
      }
    } else if (this.lastTurnWasPlan) {
      // Explicitly switch to default collaboration mode so the server exits plan mode.
      // Sending null or omitting collaborationMode may not clear sticky plan state.
      this.lastTurnWasPlan = false;
      const defaultModel =
        model || this.config.model || this.cachedModels?.[0]?.value || "";
      turnParams.collaborationMode = {
        mode: "default",
        settings: {
          model: defaultModel,
          reasoning_effort: effort ?? null,
          developer_instructions: null,
        },
      };
    }

    // Start a turn
    try {
      const turnResult = await this.sendRpc("turn/start", turnParams);
      this.turnId = turnResult?.turn?.id;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      yield {
        type: "error",
        message: `Failed to start turn: ${errMsg}`,
        code: "CODEX_TURN_ERROR",
      };
      return;
    }

    // Listen for notifications until turn completes
    yield* this.processTurnNotifications(params);
  }

  /**
   * Process all notifications for the current turn until completion.
   */
  private async *processTurnNotifications(
    params: SendMessageParams,
  ): AsyncGenerator<AgentMessage> {
    let turnComplete = false;
    let streamingText = "";
    let streamingReasoning = "";
    let streamingPlan = "";
    let latestPlanSnapshot = "";

    while (!turnComplete) {
      const notif = await this.waitForNotification();
      if (!notif) continue;

      const { method, params: p, id: requestId } = notif;

      if (params.traceCallback) {
        params.traceCallback({
          timestamp: Date.now(),
          sessionId: this.threadId,
          messageType: method,
          data: truncateForTrace(p),
        });
      }

      switch (method) {
        // =====================
        // TEXT STREAMING
        // =====================
        case "item/agentMessage/delta": {
          const delta = p.delta ?? "";
          if (delta) {
            streamingText += delta;
            yield { type: "text", content: delta, isStreaming: true };
          }
          break;
        }

        // =====================
        // REASONING STREAMING
        // =====================
        case "item/reasoning/summaryTextDelta": {
          const delta = p.delta ?? "";
          const itemId = p.itemId ?? "";
          if (delta) {
            const buf = this.reasoningBuffers.get(itemId) ?? {
              summary: "",
              content: "",
            };
            buf.summary += delta;
            this.reasoningBuffers.set(itemId, buf);
            yield { type: "thinking", content: delta, isStreaming: true };
            streamingReasoning += delta;
          }
          break;
        }

        case "item/reasoning/textDelta": {
          const delta = p.delta ?? "";
          const itemId = p.itemId ?? "";
          if (delta) {
            const buf = this.reasoningBuffers.get(itemId) ?? {
              summary: "",
              content: "",
            };
            buf.content += delta;
            this.reasoningBuffers.set(itemId, buf);
            // Stream raw reasoning as thinking too
            yield { type: "thinking", content: delta, isStreaming: true };
            streamingReasoning += delta;
          }
          break;
        }

        // =====================
        // PLAN STREAMING
        // =====================
        case "item/plan/delta": {
          const delta = p.delta ?? "";
          if (delta) {
            // Stream plan text to dedicated plan UI lane.
            yield { type: "plan_update", content: delta, isStreaming: true };
            streamingPlan += delta;
            latestPlanSnapshot += delta;
          }
          break;
        }

        // =====================
        // COMMAND EXECUTION OUTPUT STREAMING
        // =====================
        case "item/commandExecution/outputDelta": {
          const delta = p.delta ?? "";
          const itemId = p.itemId ?? "";
          if (delta) {
            const current = this.commandOutputBuffers.get(itemId) ?? "";
            this.commandOutputBuffers.set(itemId, current + delta);
          }
          break;
        }

        // =====================
        // FILE CHANGE OUTPUT STREAMING
        // =====================
        case "item/fileChange/outputDelta": {
          const delta = p.delta ?? "";
          const itemId = p.itemId ?? "";
          if (delta) {
            const current = this.fileChangeOutputBuffers.get(itemId) ?? "";
            this.fileChangeOutputBuffers.set(itemId, current + delta);
          }
          break;
        }

        // =====================
        // ITEM LIFECYCLE
        // =====================
        case "item/started": {
          const item = p.item ?? p;
          const itemType = item?.type;

          if (itemType === "agentMessage") {
            streamingText = "";
          }
          if (itemType === "reasoning") {
            streamingReasoning = "";
          }
          if (itemType === "plan") {
            streamingPlan = "";
            latestPlanSnapshot = "";
          }
          if (itemType === "commandExecution") {
            // Emit tool_use at start so user sees the command being run
            const toolCallId = item.id ?? `cmd_${Date.now()}`;
            yield {
              type: "tool_use",
              toolName: "Bash",
              input: {
                command: item.command ?? "",
                ...(item.cwd ? { cwd: item.cwd } : {}),
              },
              toolCallId,
            };
          }
          if (itemType === "fileChange") {
            this.captureFileChangeMetadata(item);
          }
          break;
        }

        case "item/completed": {
          const item = p.item ?? p;
          yield* this.handleItemCompleted(
            item,
            streamingText,
            streamingReasoning,
            streamingPlan,
          );

          // Reset streaming state
          if (item?.type === "agentMessage") {
            streamingText = "";
          }
          if (item?.type === "reasoning") {
            streamingReasoning = "";
          }
          if (item?.type === "plan") {
            streamingPlan = "";
            latestPlanSnapshot = "";
          }
          break;
        }

        // =====================
        // APPROVAL REQUESTS (server requests with id)
        // =====================
        case "item/commandExecution/requestApproval": {
          if (requestId !== undefined) {
            yield* this.handleCommandApproval(p, requestId, params);
          }
          break;
        }

        case "item/fileChange/requestApproval": {
          if (requestId !== undefined) {
            yield* this.handleFileChangeApproval(p, requestId, params);
          }
          break;
        }
        case "item/tool/requestUserInput": {
          if (requestId !== undefined) {
            yield* this.handleRequestUserInput(p, requestId, params);
          }
          break;
        }

        // =====================
        // TURN LIFECYCLE
        // =====================
        case "turn/started": {
          const turn = p.turn ?? p;
          if (turn?.id) {
            this.turnId = turn.id;
          }
          break;
        }

        case "turn/completed": {
          turnComplete = true;
          const turn = p.turn ?? p;
          const status = turn?.status ?? "completed";
          this.turnId = undefined;

          // Extract token usage
          const usage = p.tokenUsage ?? turn?.tokenUsage;
          const tokenUsage = usage?.total
            ? {
                inputTokens: usage.total.inputTokens ?? 0,
                outputTokens: usage.total.outputTokens ?? 0,
              }
            : undefined;

          if (status === "failed") {
            const errorMsg = turn?.error?.message ?? "Turn failed";
            const isAuthError =
              errorMsg.toLowerCase().includes("access token") ||
              errorMsg.toLowerCase().includes("refresh token") ||
              errorMsg.toLowerCase().includes("sign in") ||
              errorMsg.toLowerCase().includes("log out");
            yield {
              type: "error",
              message: isAuthError
                ? `Codex authentication expired. Please reconnect in Settings → Codex. (${errorMsg})`
                : errorMsg,
              code: isAuthError ? "CODEX_AUTH_EXPIRED" : "CODEX_TURN_FAILED",
            };
          }

          yield {
            type: "result",
            content: "",
            ...(tokenUsage ? { usage: tokenUsage } : {}),
            stop_reason:
              status === "completed"
                ? "end_turn"
                : status === "interrupted"
                  ? "stop_sequence"
                  : status === "failed"
                    ? "end_turn"
                    : "end_turn",
          };
          break;
        }

        // =====================
        // TOKEN USAGE UPDATES
        // =====================
        case "thread/tokenUsage/updated": {
          // We extract usage at turn/completed — nothing to emit here
          break;
        }

        // =====================
        // THREAD NAME UPDATES
        // =====================
        case "thread/name/updated": {
          // Could be used to update the chat title; nothing to emit for now
          break;
        }

        // =====================
        // CONTEXT COMPACTION
        // =====================
        case "thread/compacted": {
          // Agent compacted its context window — informational
          break;
        }

        // =====================
        // MODEL REROUTED
        // =====================
        case "model/rerouted": {
          // Server rerouted to a different model — informational
          break;
        }

        // =====================
        // ERRORS
        // =====================
        case "error": {
          yield {
            type: "error",
            message: p.message ?? "Unknown error",
            code: "CODEX_ERROR",
          };
          turnComplete = true;
          break;
        }

        // =====================
        // LIFECYCLE / INFORMATIONAL — ignored
        // =====================
        case "thread/started":
        case "thread/status/changed":
        case "thread/closed":
        case "thread/archived":
        case "thread/unarchived":
        case "skills/changed":
        case "serverRequest/resolved":
        case "item/mcpToolCall/progress":
        case "item/commandExecution/terminalInteraction":
        case "item/reasoning/summaryPartAdded":
          break;
        case "turn/plan/updated": {
          const planUpdate = this.extractPlanUpdate(p);
          const planText =
            this.formatPlanMarkdown(planUpdate) || planUpdate.text || "";
          if (!planText) break;

          // Prefer delta-style updates when possible to avoid duplicate rendering.
          if (!latestPlanSnapshot) {
            latestPlanSnapshot = planText;
            yield { type: "plan_update", content: planText, isStreaming: true };
            break;
          }

          if (planText.startsWith(latestPlanSnapshot)) {
            const delta = planText.slice(latestPlanSnapshot.length);
            latestPlanSnapshot = planText;
            if (delta) {
              yield { type: "plan_update", content: delta, isStreaming: true };
            }
            break;
          }

          // Non-monotonic update: emit final snapshot to keep UI in sync.
          latestPlanSnapshot = planText;
          yield {
            type: "plan_update",
            content: `\n${planText}`,
            isStreaming: false,
          };
          break;
        }
        case "turn/diff/updated":
        case "rawResponseItem/completed":
        case "configWarning":
        case "deprecationNotice":
        case "account/updated":
        case "account/rateLimits/updated":
          break;

        default:
          // Ignore other notifications (codex/event/*, mcp/*, etc.)
          break;
      }
    }
  }

  /**
   * Handle a completed item notification.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private *handleItemCompleted(
    item: any,
    streamingText: string,
    streamingReasoning: string,
    streamingPlan: string,
  ): Generator<AgentMessage> {
    const itemType = item?.type;

    switch (itemType) {
      case "agentMessage": {
        if (streamingText) {
          // Deltas were streamed; UI already has the text. Just finalize.
          yield { type: "text", content: "", isStreaming: false };
        } else {
          // No deltas were received — emit full text (fallback)
          const finalText = item.text ?? "";
          if (finalText) {
            yield { type: "text", content: finalText, isStreaming: false };
          }
        }
        break;
      }

      case "reasoning": {
        if (streamingReasoning) {
          // Already streamed via deltas — finalize
          yield { type: "thinking", content: "", isStreaming: false };
        } else {
          // Fallback: emit summary or content
          const summaries = item.summary ?? [];
          const contents = item.content ?? [];
          const text = summaries.join("\n") || contents.join("\n") || "";
          if (text) {
            yield { type: "thinking", content: text, isStreaming: false };
          }
        }
        // Clean up buffer
        if (item.id) this.reasoningBuffers.delete(item.id);
        break;
      }

      case "plan": {
        // Final plan item is authoritative; if we streamed deltas, just finalize.
        const text = item.text ?? "";
        if (streamingPlan) {
          yield { type: "plan_update", content: "", isStreaming: false };
        } else if (text) {
          // Fallback when no plan deltas were emitted.
          yield { type: "plan_update", content: text, isStreaming: false };
        }
        break;
      }

      case "commandExecution": {
        const toolCallId = item.id ?? `cmd_${Date.now()}`;
        // Use streamed output if available, otherwise fall back to aggregatedOutput
        const streamedOutput = this.commandOutputBuffers.get(toolCallId);
        const output = streamedOutput ?? item.aggregatedOutput ?? "";
        const outputParts: string[] = [];
        if (output) outputParts.push(output);
        if (
          item.exitCode !== undefined &&
          item.exitCode !== null &&
          item.exitCode !== 0
        ) {
          outputParts.push(`\nExit code: ${item.exitCode}`);
        }
        if (item.durationMs !== undefined && item.durationMs !== null) {
          outputParts.push(`\nDuration: ${item.durationMs}ms`);
        }

        // If the tool_use was already emitted at item/started, just emit tool_result
        yield {
          type: "tool_result",
          toolCallId,
          output:
            outputParts.join("") ||
            (item.status === "completed" ? "(completed)" : `(${item.status})`),
        };

        // Clean up buffer
        this.commandOutputBuffers.delete(toolCallId);
        break;
      }

      case "fileChange": {
        const changes = item.changes ?? [];
        const itemId = item.id;
        const streamedDiff = itemId
          ? this.fileChangeOutputBuffers.get(itemId)
          : undefined;

        for (const change of changes) {
          const toolCallId = `file_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          const toolName =
            change.kind === "add"
              ? "Write"
              : change.kind === "delete"
                ? "Delete"
                : "Edit";
          yield {
            type: "tool_use",
            toolName,
            input: {
              file_path: change.path ?? "",
              kind: change.kind ?? "update",
              diff: streamedDiff ?? (change as any).diff ?? "",
            },
            toolCallId,
          };
          yield {
            type: "tool_result",
            toolCallId,
            output: streamedDiff
              ? `${change.kind ?? "update"}: ${change.path ?? ""}\n${streamedDiff}`
              : `${change.kind ?? "update"}: ${change.path ?? ""}`,
          };
        }

        // Clean up buffer
        if (itemId) {
          this.fileChangeOutputBuffers.delete(itemId);
          this.fileChangeMetadataBuffers.delete(itemId);
        }
        break;
      }

      case "mcpToolCall": {
        const toolCallId = item.id ?? `mcp_${Date.now()}`;
        yield {
          type: "tool_use",
          toolName: `mcp__${item.server}__${item.tool}`,
          input: item.arguments ?? {},
          toolCallId,
        };
        let output = "";
        if (item.error) {
          output = item.error.message ?? "MCP tool call failed";
        } else if (item.result) {
          if (item.result.content && Array.isArray(item.result.content)) {
            output = item.result.content
              .map((b: { text?: string }) => b.text ?? "")
              .join("\n");
          } else {
            output = JSON.stringify(item.result);
          }
        }
        const durationSuffix = item.durationMs ? ` (${item.durationMs}ms)` : "";
        yield {
          type: "tool_result",
          toolCallId,
          output: (output || `(${item.status})`) + durationSuffix,
        };
        break;
      }

      case "dynamicToolCall": {
        const toolCallId = item.id ?? `dyn_${Date.now()}`;
        yield {
          type: "tool_use",
          toolName: item.tool ?? "DynamicTool",
          input: item.arguments ?? {},
          toolCallId,
        };
        let output = "";
        if (item.contentItems && Array.isArray(item.contentItems)) {
          output = item.contentItems
            .map((ci: { text?: string }) => ci.text ?? "")
            .filter(Boolean)
            .join("\n");
        }
        const success =
          item.success === true
            ? "(success)"
            : item.success === false
              ? "(failed)"
              : `(${item.status})`;
        yield { type: "tool_result", toolCallId, output: output || success };
        break;
      }

      case "webSearch": {
        const toolCallId = item.id ?? `search_${Date.now()}`;
        yield {
          type: "tool_use",
          toolName: "WebSearch",
          input: { query: item.query ?? "" },
          toolCallId,
        };
        yield { type: "tool_result", toolCallId, output: "Search completed" };
        break;
      }

      case "imageView": {
        const toolCallId = item.id ?? `imgview_${Date.now()}`;
        yield {
          type: "tool_use",
          toolName: "Read",
          input: { file_path: item.path ?? "" },
          toolCallId,
        };
        yield {
          type: "tool_result",
          toolCallId,
          output: `Viewed image: ${item.path ?? ""}`,
        };
        break;
      }

      case "imageGeneration": {
        const toolCallId = item.id ?? `imggen_${Date.now()}`;
        yield {
          type: "tool_use",
          toolName: "ImageGeneration",
          input: { prompt: item.revisedPrompt ?? "" },
          toolCallId,
        };
        yield {
          type: "tool_result",
          toolCallId,
          output: item.result ?? `(${item.status})`,
        };
        break;
      }

      case "contextCompaction": {
        // Informational — the agent compacted its context
        yield {
          type: "text",
          content: "\n*[Context compacted]*\n",
          isStreaming: false,
        };
        break;
      }

      case "error": {
        yield {
          type: "error",
          message: item.message ?? "Unknown item error",
          code: "CODEX_ITEM_ERROR",
        };
        break;
      }

      default: {
        // Unknown item types
        const text = item?.text ?? item?.content ?? item?.message;
        if (typeof text === "string" && text) {
          yield { type: "text", content: text, isStreaming: false };
        }
        break;
      }
    }
  }

  /**
   * Handle command execution approval request.
   * Maps to the permissionHandler in SendMessageParams.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async *handleCommandApproval(
    p: any,
    requestId: number,
    params: SendMessageParams,
  ): AsyncGenerator<AgentMessage> {
    const command = p.command ?? "";
    const cwd = p.cwd ?? "";
    const reason = p.reason ?? undefined;

    // Emit a permission_request so the UI can show an approval dialog
    const permRequestId = `cmd_approval_${requestId}`;
    yield {
      type: "permission_request",
      toolName: "Bash",
      input: {
        command,
        cwd,
        ...(reason ? { reason } : {}),
      },
      requestId: permRequestId,
    };

    // Ask the permission handler
    try {
      const result = await params.permissionHandler("Bash", {
        command,
        cwd,
        ...(reason ? { reason } : {}),
      });

      if (result.approved) {
        this.sendResponse(requestId, { decision: "accept" });
      } else {
        this.sendResponse(requestId, { decision: "decline" });
      }
    } catch {
      // On error, decline
      this.sendResponse(requestId, { decision: "decline" });
    }
  }

  /**
   * Handle file change approval request.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async *handleFileChangeApproval(
    p: any,
    requestId: number,
    params: SendMessageParams,
  ): AsyncGenerator<AgentMessage> {
    const input = this.buildFileChangeApprovalInput(p, requestId);

    // Emit a permission_request so the UI can show an approval dialog
    const permRequestId = `file_approval_${requestId}`;
    yield {
      type: "permission_request",
      toolName: "Edit",
      input,
      requestId: permRequestId,
    };

    // Ask the permission handler
    try {
      const result = await params.permissionHandler("Edit", input);

      if (result.approved) {
        this.sendResponse(requestId, { decision: "accept" });
      } else {
        this.sendResponse(requestId, { decision: "decline" });
      }
    } catch {
      this.sendResponse(requestId, { decision: "decline" });
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async *handleRequestUserInput(
    p: any,
    requestId: number,
    params: SendMessageParams,
  ): AsyncGenerator<AgentMessage> {
    const normalizedInput = this.normalizeRequestUserInputPayload(p);
    yield {
      type: "permission_request",
      toolName: "AskUserQuestion",
      input: normalizedInput,
      requestId: `user_input_${requestId}`,
    };

    const rawQuestions = Array.isArray(p?.questions) ? p.questions : [];
    const questionMappings = rawQuestions
      .map((q: any, index: number) => {
        const id =
          typeof q?.id === "string" && q.id.trim().length > 0
            ? q.id.trim()
            : `q_${index + 1}`;
        const text =
          typeof q?.question === "string"
            ? q.question
            : typeof q?.prompt === "string"
              ? q.prompt
              : undefined;
        const multiSelect = Boolean(q?.multiSelect);
        return { id, text, multiSelect };
      })
      .filter((q: { id: string; text?: string; multiSelect: boolean }) =>
        Boolean(q.id),
      );

    const fallbackIdsByQuestionText = new Map<string, string>();
    for (const q of questionMappings) {
      if (q.text) fallbackIdsByQuestionText.set(q.text, q.id);
    }

    try {
      const result = await params.permissionHandler(
        "AskUserQuestion",
        normalizedInput,
      );
      if (!result.approved) {
        this.sendResponse(requestId, { answers: {} });
        return;
      }

      const responsePayload =
        (result.modifiedInput as
          | {
              answers?: Record<string, string>;
            }
          | undefined) ?? {};
      const rawAnswers = responsePayload.answers ?? {};

      const answers: Record<string, { answers: string[] }> = {};
      for (const [key, value] of Object.entries(rawAnswers)) {
        const mappedId = fallbackIdsByQuestionText.get(key) ?? key;
        if (!mappedId) continue;

        const mapping =
          questionMappings.find(
            (q: { id: string; text?: string; multiSelect: boolean }) =>
              q.id === mappedId,
          ) ??
          questionMappings.find(
            (q: { id: string; text?: string; multiSelect: boolean }) =>
              q.text === key,
          );

        const normalized =
          typeof value === "string"
            ? mapping?.multiSelect
              ? value
                  .split(",")
                  .map((v) => v.trim())
                  .filter(Boolean)
              : value.trim()
                ? [value.trim()]
                : []
            : Array.isArray((value as { answers?: unknown[] })?.answers)
              ? (value as { answers: unknown[] }).answers
                  .map((v) => String(v ?? "").trim())
                  .filter(Boolean)
              : [];
        answers[mappedId] = { answers: normalized };
      }
      this.sendResponse(requestId, { answers });
    } catch {
      this.sendResponse(requestId, { answers: {} });
    }
  }

  async interrupt(): Promise<void> {
    if (this.threadId && this.appServer) {
      const interruptParams: { threadId: string; turnId?: string } = {
        threadId: this.threadId,
      };
      if (this.turnId) {
        interruptParams.turnId = this.turnId;
      }

      try {
        await this.sendRpc("turn/interrupt", interruptParams);
      } catch (err) {
        // Compatibility fallback for servers that may reject turnId.
        if (interruptParams.turnId) {
          try {
            await this.sendRpc("turn/interrupt", { threadId: this.threadId });
            return;
          } catch {
            // Fall through to warning below
          }
        }
        // Surface interrupt failures for diagnostics instead of swallowing.
        console.warn(
          "[codex.provider] interrupt failed:",
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  canResume(sessionId: string): boolean {
    return this.threadId === sessionId;
  }

  /**
   * Get available models via `model/list` RPC.
   * Falls back to static list if app-server isn't available.
   */
  async getAvailableModels(): Promise<ModelInfo[]> {
    if (this.cachedModels) return this.cachedModels;

    try {
      await this.ensureAppServer();
      const result = await this.sendRpc("model/list", { includeHidden: false });
      const models: ModelInfo[] = (result?.data ?? []).map(
        (m: {
          id: string;
          model: string;
          displayName: string;
          description: string;
          isDefault?: boolean;
          hidden?: boolean;
        }) => ({
          value: m.model ?? m.id,
          displayName: m.displayName ?? m.model ?? m.id,
          description: m.description ?? "",
          supportsReasoning: true,
        }),
      );

      if (models.length > 0) {
        this.cachedModels = models;
        return models;
      }
    } catch {
      // Fall through to static list
    }

    // Fallback static list. Keep this conservative: it is only shown when the
    // app-server cannot provide its authoritative model catalog.
    return [
      {
        value: "gpt-5.6-sol",
        displayName: "GPT-5.6-Sol",
        description: "Reliable agentic workhorse for everyday tasks.",
        supportsReasoning: true,
      },
      {
        value: "gpt-5.6-terra",
        displayName: "GPT-5.6-Terra",
        description: "Balanced agentic coding model for everyday work.",
        supportsReasoning: true,
      },
      {
        value: "gpt-5.6-luna",
        displayName: "GPT-5.6-Luna",
        description: "Fast and affordable agentic coding model.",
        supportsReasoning: true,
      },
      {
        value: "gpt-5.5",
        displayName: "GPT-5.5",
        description:
          "Proven previous-generation model for coding and general work.",
        supportsReasoning: true,
      },
      {
        value: "gpt-5.4",
        displayName: "GPT-5.4",
        description: "Strong model for everyday coding.",
        supportsReasoning: true,
      },
      {
        value: "gpt-5.4-mini",
        displayName: "GPT-5.4-Mini",
        description:
          "Small, fast, and cost-efficient model for simpler coding tasks.",
        supportsReasoning: true,
      },
    ];
  }

  /**
   * Discover available skills via `skills/list` RPC.
   */
  async discoverSlashCommands(): Promise<
    { name: string; description?: string }[]
  > {
    try {
      await this.ensureAppServer();
      const result = await this.sendRpc("skills/list", {
        cwds: this.config.cwd ? [this.config.cwd] : [],
      });

      // Result contains skills; map to slash command format
      const skills = result?.skills ?? result?.data ?? [];
      if (Array.isArray(skills)) {
        return skills.map((skill: { name?: string; description?: string }) => ({
          name: skill.name
            ? skill.name.startsWith("/")
              ? skill.name
              : `/${skill.name}`
            : "/unknown",
          description: skill.description,
        }));
      }
    } catch {
      // Skills discovery is optional
    }
    return [];
  }

  async getMcpServerStatus(): Promise<McpServerInfo[]> {
    if (!this.appServer) return [];

    try {
      const result = await this.sendRpc("mcpServerStatus/list", {});
      const servers = Array.isArray(result?.data) ? result.data : [];
      return servers.map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (s: any): McpServerInfo => ({
          name: s.name,
          status: this.mapMcpServerStatus(s.authStatus, s.tools),
          tools: s.tools ? Object.keys(s.tools) : [],
          scope: s.scope,
          error: s.error,
          configType: s.config?.type,
          configId: s.config?.id,
        }),
      );
    } catch {
      return [];
    }
  }

  async reconnectMcpServer(
    _serverName: string,
  ): Promise<{ authUrl?: string } | void> {
    try {
      await this.sendRpc("config/mcpServer/reload", {});
    } catch {
      // Ignore unsupported reload failures.
    }
  }

  async dispose(): Promise<void> {
    if (this.rl) {
      this.rl.close();
      this.rl = undefined;
    }
    if (this.appServer && !this.appServer.killed) {
      this.appServer.kill();
      this.appServer = undefined;
    }
    this.threadId = undefined;
    this.turnId = undefined;
    this.sessionInitSent = false;
    this.initialized = false;
    this.pendingRpc.clear();
    this.notificationQueue = [];
    this.cachedModels = undefined;
    this.commandOutputBuffers.clear();
    this.fileChangeOutputBuffers.clear();
    this.fileChangeMetadataBuffers.clear();
    this.reasoningBuffers.clear();
  }
}
