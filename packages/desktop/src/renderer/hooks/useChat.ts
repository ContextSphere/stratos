import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type {
  ChatMessage,
  ToolCall,
  TaskInfo,
  PermissionRequest,
  AskUserQuestionRequest,
  PlanReviewRequest,
  ImageAttachment,
  FileAttachment,
  TodoData,
  WorktreeProgressData,
  McpServerInfo,
} from "@stratosapp/ui";
import type {
  SessionCompleteNotification,
  StoredMessage,
  AgentMode,
  ContextUsage,
} from "@stratosapp/core";

/**
 * Parse a `[stratos-notification]` directive injected by the Manager Agent
 * when a spawned child session finishes. Inlined here because the renderer
 * can't runtime-import from the CJS-only `@stratosapp/core` package.
 * Keep in sync with packages/core/src/storage/sdk-transcript.ts.
 */
function parseSessionCompleteNotification(
  text: string,
): SessionCompleteNotification | null {
  const firstLine = text.split("\n", 1)[0];
  if (!firstLine.startsWith("[stratos-notification]")) return null;
  const read = (key: string): string | undefined => {
    const m = firstLine.match(new RegExp(`${key}="([^"]*)"`));
    return m ? m[1] : undefined;
  };
  const threadId = read("session");
  const title = read("title");
  const provider = read("provider");
  const rawStatus = read("status");
  if (!threadId || !rawStatus) return null;
  const status: SessionCompleteNotification["status"] =
    rawStatus === "error" || rawStatus === "interrupted"
      ? rawStatus
      : "completed";
  return {
    threadId,
    title: title ?? threadId,
    provider: provider ?? "claude-code",
    status,
  };
}

interface UseChatOptions {
  onThreadUpdated?: () => void;
}

export interface SessionStats {
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  contextWindow: number | null;
}

export type InteractiveMode =
  | { type: "none" }
  | { type: "plan-review"; requestId: string; data: PlanReviewRequest }
  | { type: "question"; requestId: string; data: AskUserQuestionRequest };

interface UseChatReturn {
  messages: ChatMessage[];
  isStreaming: boolean;
  permissionRequest: PermissionRequest | null;
  sessionStats: SessionStats;
  interactiveMode: InteractiveMode;
  sendMessage: (
    prompt: string,
    threadId?: string,
    images?: ImageAttachment[],
    fileAttachments?: FileAttachment[],
  ) => Promise<void>;
  interrupt: (threadId?: string) => Promise<void>;
  respondPermission: (
    requestId: string,
    approved: boolean,
    updatedPermissions?: unknown[],
  ) => void;
  respondQuestion: (requestId: string, answers: Record<string, string>) => void;
  respondPlanReview: (
    requestId: string,
    decision: { type: string; feedback?: string },
  ) => void;
  handleInteractiveResponse: (text: string) => void;
  updateTaskExpanded: (messageId: string, expanded: boolean) => void;
  slashCommands: { name: string; description?: string }[];
  sessionTools: string[] | null;
  mcpServers: McpServerInfo[] | null;
  fetchMcpStatus: (threadId: string) => Promise<void>;
  contextUsage: ContextUsage | null;
  refreshContextUsage: () => Promise<void>;
  runningThreadIds: string[];
  threadNotifications: Map<string, string>;
  pendingPermissionThreadIds: Set<string>;
}

let messageIdCounter = 0;
function nextMessageId(): string {
  return `msg_${++messageIdCounter}_${Date.now()}`;
}

const TOOL_OUTPUT_DISPLAY_LIMIT = 50_000; // 50KB — full output is in SDK session store
function truncateToolOutput(output: string | undefined): string | undefined {
  if (!output || output.length <= TOOL_OUTPUT_DISPLAY_LIMIT) return output;
  return (
    output.slice(0, TOOL_OUTPUT_DISPLAY_LIMIT) +
    `\n\n[… truncated ${output.length - TOOL_OUTPUT_DISPLAY_LIMIT} characters]`
  );
}

function toStoredMessage(m: ChatMessage): StoredMessage {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    timestamp: m.timestamp,
    ...(m.toolCalls && { toolCalls: m.toolCalls }),
    ...(m.taskInfo && { taskInfo: m.taskInfo }),
    ...(m.taskNotification && { taskNotification: m.taskNotification }),
    ...(m.sessionCompleteNotification && {
      sessionCompleteNotification: m.sessionCompleteNotification,
    }),
    ...(m.cost != null && { cost: m.cost }),
    ...(m.usage && { usage: m.usage }),
    ...(m.contextWindow != null && { contextWindow: m.contextWindow }),
    ...(m.thinking && { thinking: m.thinking }),
    ...(m.modeChange && { modeChange: m.modeChange }),
    ...(m.questionData && { questionData: m.questionData }),
    ...(m.questionAnswered && { questionAnswered: m.questionAnswered }),
    ...(m.planReviewData && { planReviewData: m.planReviewData }),
    ...(m.todoData && { todoData: m.todoData }),
    ...(m.worktreeProgress && { worktreeProgress: m.worktreeProgress }),
    ...(m.images && m.images.length > 0 && { images: m.images }),
    ...(m.fileAttachments &&
      m.fileAttachments.length > 0 && { fileAttachments: m.fileAttachments }),
  };
}

function sanitizeTodoData(raw: unknown): TodoData | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  // Shape: { todos: [...] }
  if (Array.isArray(obj.todos))
    return { todos: obj.todos as TodoData["todos"] };
  // Shape: raw array stored directly (legacy bug)
  if (Array.isArray(raw)) return { todos: raw as TodoData["todos"] };
  return undefined;
}

function fromStoredMessage(m: StoredMessage): ChatMessage {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    timestamp: m.timestamp,
    ...(m.toolCalls && {
      toolCalls: m.toolCalls.filter((tc) => tc.toolName !== "TodoWrite"),
    }),
    ...(m.taskInfo ? { taskInfo: m.taskInfo as TaskInfo } : {}),
    ...(m.taskNotification ? { taskNotification: m.taskNotification } : {}),
    ...(m.sessionCompleteNotification
      ? { sessionCompleteNotification: m.sessionCompleteNotification }
      : {}),
    ...(m.cost != null && { cost: m.cost }),
    ...(m.usage && { usage: m.usage }),
    ...(m.contextWindow != null && { contextWindow: m.contextWindow }),
    ...(m.thinking && { thinking: m.thinking }),
    ...(m.modeChange ? { modeChange: m.modeChange as AgentMode } : {}),
    ...(m.questionData
      ? { questionData: m.questionData as AskUserQuestionRequest }
      : {}),
    ...(m.questionAnswered && { questionAnswered: m.questionAnswered }),
    ...(m.planReviewData
      ? { planReviewData: m.planReviewData as PlanReviewRequest }
      : {}),
    ...(sanitizeTodoData(m.todoData)
      ? { todoData: sanitizeTodoData(m.todoData)! }
      : {}),
    ...(m.worktreeProgress
      ? { worktreeProgress: m.worktreeProgress as WorktreeProgressData }
      : {}),
    ...(m.images && m.images.length > 0 && { images: m.images }),
    ...(m.fileAttachments &&
      m.fileAttachments.length > 0 && { fileAttachments: m.fileAttachments }),
  };
}

interface ThreadStreamState {
  messages: ChatMessage[];
  assistantId: string | null;
  activeTaskId: string | null;
  interrupted?: boolean;
}

export function useChat(
  activeThreadId: string | null,
  options?: UseChatOptions,
): UseChatReturn {
  const onThreadUpdated = options?.onThreadUpdated;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [runningThreadIds, setRunningThreadIds] = useState<string[]>([]);
  const [permissionRequests, setPermissionRequests] = useState<
    PermissionRequest[]
  >([]);
  const [pendingQuestionThreadIds, setPendingQuestionThreadIds] = useState<
    Set<string>
  >(new Set());
  // Maps requestId → threadId for AskUserQuestion and plan review, so we can
  // clear pendingQuestionThreadIds when the user responds.
  const questionRequestThreadRef = useRef<Map<string, string>>(new Map());
  const [threadNotifications, setThreadNotifications] = useState<
    Map<string, string>
  >(new Map());
  const [interactiveMode, setInteractiveMode] = useState<InteractiveMode>({
    type: "none",
  });
  const [sessionStats, setSessionStats] = useState<SessionStats>({
    totalCost: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    contextWindow: null,
  });
  const [slashCommands, setSlashCommands] = useState<
    { name: string; description?: string }[]
  >([]);
  const [sessionTools, setSessionTools] = useState<string[] | null>(null);
  const [mcpServers, setMcpServers] = useState<McpServerInfo[] | null>(null);
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null);

  // Derived isStreaming — true only when the active thread is running
  const isStreaming = activeThreadId
    ? runningThreadIds.includes(activeThreadId)
    : false;

  // Only show permission requests for the active thread
  const permissionRequest =
    permissionRequests.find(
      (r) => !r.threadId || r.threadId === activeThreadId,
    ) ?? null;

  const pendingPermissionThreadIds = useMemo(
    () =>
      new Set([
        ...permissionRequests
          .map((r) => r.threadId)
          .filter((id): id is string => !!id),
        ...pendingQuestionThreadIds,
      ]),
    [permissionRequests, pendingQuestionThreadIds],
  );

  const prevThreadIdRef = useRef<string | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamingThreadsRef = useRef<Map<string, ThreadStreamState>>(new Map());
  // Tracks the active streamId per thread so late events from an interrupted
  // stream can be discarded before they corrupt the new stream's messages.
  const activeStreamIdRef = useRef<Map<string, string>>(new Map());
  // Maps Monitor task-id → toolCallId so Monitor events can be attached to
  // the originating tool call instead of rendering as standalone pills.
  const monitorTaskIdsRef = useRef<Map<string, string>>(new Map());
  const activeThreadIdRef = useRef<string | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const loadingThreadIdRef = useRef<string | null>(null);
  // Per-thread pending-flush timer for batching streaming React re-renders.
  // Text/thinking events fire dozens of times per second; batching reduces
  // redundant renders without adding perceptible latency (50 ms window).
  const pendingSetRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  activeThreadIdRef.current = activeThreadId;
  messagesRef.current = messages;

  const computeSessionStats = useCallback(
    (msgs: ChatMessage[]): SessionStats => {
      let totalCost = 0;
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let contextWindow: number | null = null;
      for (const m of msgs) {
        if (m.cost != null) totalCost += m.cost;
        if (m.usage) {
          totalInputTokens += m.usage.inputTokens;
          totalOutputTokens += m.usage.outputTokens;
        }
        if (m.contextWindow != null) contextWindow = m.contextWindow;
      }
      return { totalCost, totalInputTokens, totalOutputTokens, contextWindow };
    },
    [],
  );

  const saveMessages = useCallback((threadId: string, msgs: ChatMessage[]) => {
    if (msgs.length === 0) return;
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    window.api.threadsSaveMessages(threadId, msgs.map(toStoredMessage));
  }, []);

  // Clear notification when user switches to a thread
  useEffect(() => {
    if (activeThreadId) {
      setThreadNotifications((prev) => {
        if (!prev.has(activeThreadId)) return prev;
        const next = new Map(prev);
        next.delete(activeThreadId);
        return next;
      });
    }
  }, [activeThreadId]);

  useEffect(() => {
    const prevId = prevThreadIdRef.current;
    if (prevId && prevId !== activeThreadId) {
      const streamState = streamingThreadsRef.current.get(prevId);
      const toSave = streamState ? streamState.messages : messages;
      if (toSave.length > 0) saveMessages(prevId, toSave);
    }
    prevThreadIdRef.current = activeThreadId;
    // Clear interactive mode when switching threads
    setInteractiveMode({ type: "none" });

    // Evict streaming state for idle threads (not actively streaming) to free memory.
    // Keep: the new active thread + any threads that are currently running.
    for (const [tid] of streamingThreadsRef.current) {
      if (tid !== activeThreadId && !runningThreadIds.includes(tid)) {
        const timer = pendingSetRef.current.get(tid);
        if (timer) {
          clearTimeout(timer);
          pendingSetRef.current.delete(tid);
        }
        streamingThreadsRef.current.delete(tid);
        activeStreamIdRef.current.delete(tid);
      }
    }

    if (activeThreadId) {
      // Context usage is thread-scoped; clear it on switch so the indicator
      // doesn't briefly show the previous thread's data while we refetch.
      setContextUsage(null);
      const streamState = streamingThreadsRef.current.get(activeThreadId);
      if (streamState) {
        // Thread is currently streaming — show its live messages
        loadingThreadIdRef.current = null;
        setMessages(streamState.messages);
        setSessionStats(computeSessionStats(streamState.messages));
      } else {
        loadingThreadIdRef.current = activeThreadId;

        // Load both messages and thread metadata (including sessionTools)
        Promise.all([
          window.api.threadsLoadMessages(activeThreadId),
          window.api.threadsGet(activeThreadId),
        ]).then(([stored, thread]) => {
          if (loadingThreadIdRef.current !== activeThreadId) return;
          loadingThreadIdRef.current = null;
          const loaded = stored.length > 0 ? stored.map(fromStoredMessage) : [];
          setMessages(loaded);
          setSessionStats(computeSessionStats(loaded));

          // Restore sessionTools from thread metadata
          if (thread?.sessionTools) {
            setSessionTools(thread.sessionTools);
          } else {
            setSessionTools(null);
          }

          // Fetch initial context usage so the indicator appears immediately
          // on thread load (otherwise it would only show after the next turn).
          window.api
            .getContextUsage(activeThreadId)
            .then((usage) => {
              if (activeThreadIdRef.current === activeThreadId) {
                setContextUsage(usage);
              }
            })
            .catch(() => {});
        });
      }
    } else {
      loadingThreadIdRef.current = null;
      setMessages([]);
      setSessionStats({
        totalCost: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        contextWindow: null,
      });
      setSessionTools(null);
      setMcpServers(null);
      setContextUsage(null);
    }
  }, [activeThreadId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!activeThreadId || messages.length === 0 || loadingThreadIdRef.current)
      return;

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      saveMessages(activeThreadId, messages);
      saveTimeoutRef.current = null;
    }, 500);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [activeThreadId, messages, saveMessages]);

  useEffect(() => {
    const { api } = window;

    api.onStreamMessage((data: unknown, threadId: string | null) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = data as any;
      if (!msg || !msg.type) return;
      if (!threadId) return;

      // Extract the stream ID injected by the main process
      const msgStreamId: string | undefined = msg._streamId;

      let state = streamingThreadsRef.current.get(threadId);
      if (!state) {
        // Auto-initialize streaming state for main-process-triggered turns
        // (e.g. auto-implement after plan approval). The user_message event
        // arrives before other stream events and bootstraps the state.
        if (msg.type === "user_message") {
          const currentMessages =
            activeThreadIdRef.current === threadId ? messagesRef.current : [];
          state = {
            messages: [...currentMessages],
            assistantId: null,
            activeTaskId: null,
          };
          streamingThreadsRef.current.set(threadId, state);
          // Register this as the active stream for the thread
          if (msgStreamId) activeStreamIdRef.current.set(threadId, msgStreamId);
        } else {
          // No streaming state means the stream was already finalized (by result/error)
          // or cleaned up (by interrupt timeout). Ignore late arrivals.
          return;
        }
      } else if (msg.type === "user_message" && msgStreamId) {
        // A new stream started — update the active stream ID.
        // This happens when the renderer pre-creates state before the first IPC event.
        activeStreamIdRef.current.set(threadId, msgStreamId);
      }

      // Discard events from a stale (interrupted/replaced) stream
      const currentStreamId = activeStreamIdRef.current.get(threadId);
      if (msgStreamId && currentStreamId && msgStreamId !== currentStreamId) {
        return;
      }

      const apply = (updater: (msgs: ChatMessage[]) => ChatMessage[]) => {
        const next = updater(state!.messages);
        state!.messages = next;
        if (activeThreadIdRef.current === threadId) {
          // Batch React re-renders: replace the pending flush timer instead of
          // calling setMessages on every streaming event.
          const existing = pendingSetRef.current.get(threadId);
          if (existing) clearTimeout(existing);
          pendingSetRef.current.set(
            threadId,
            setTimeout(() => {
              pendingSetRef.current.delete(threadId);
              const s = streamingThreadsRef.current.get(threadId);
              if (s && activeThreadIdRef.current === threadId) {
                setMessages(s.messages);
              }
            }, 50),
          );
        }
      };

      // Flush any pending batched state update immediately, then cancel the timer.
      const flushPending = () => {
        const timer = pendingSetRef.current.get(threadId);
        if (timer) {
          clearTimeout(timer);
          pendingSetRef.current.delete(threadId);
        }
        if (activeThreadIdRef.current === threadId) {
          setMessages(state!.messages);
        }
      };

      switch (msg.type) {
        case "user_message": {
          // Synthetic user message injected by main process (e.g. auto-implement
          // after plan approval, or Manager Agent child-completion notifications).
          const rawContent = msg.content ?? "";
          const sessionNotif = parseSessionCompleteNotification(rawContent);
          const userMsg: ChatMessage = sessionNotif
            ? {
                id: nextMessageId(),
                role: "user",
                content: "",
                timestamp: Date.now(),
                sessionCompleteNotification: sessionNotif,
              }
            : {
                id: nextMessageId(),
                role: "user",
                content: rawContent,
                timestamp: Date.now(),
              };
          apply((prev) => [...prev, userMsg]);
          break;
        }
        case "text": {
          // Remove any worktree progress messages before adding new content
          if (!state.assistantId) {
            apply((prev) => prev.filter((m) => !m.worktreeProgress));
          }

          if (state.assistantId) {
            const assistantId = state.assistantId;
            apply((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: m.content + msg.content }
                  : m,
              ),
            );
          } else {
            const id = nextMessageId();
            state.assistantId = id;
            apply((prev) => [
              ...prev,
              {
                id,
                role: "assistant" as const,
                content: msg.content,
                timestamp: Date.now(),
              },
            ]);
          }
          break;
        }

        case "task_notification": {
          // Monitor intermediate event — attach to originating tool call
          if (msg.status === "event") {
            const toolCallId = monitorTaskIdsRef.current.get(msg.taskId);
            if (toolCallId) {
              const eventLine = msg.event ?? msg.summary;
              apply((prev) =>
                prev.map((m) => ({
                  ...m,
                  toolCalls: m.toolCalls?.map((tc) =>
                    tc.toolCallId === toolCallId
                      ? {
                          ...tc,
                          monitorEvents: [
                            ...(tc.monitorEvents ?? []),
                            eventLine,
                          ],
                        }
                      : tc,
                  ),
                })),
              );
              break;
            }
            // Orphaned event (no known monitor): fall through to pill
          }

          // Monitor final status — update the tool call status and clean up
          if (
            msg.status !== "event" &&
            monitorTaskIdsRef.current.has(msg.taskId)
          ) {
            const toolCallId = monitorTaskIdsRef.current.get(msg.taskId)!;
            monitorTaskIdsRef.current.delete(msg.taskId);
            apply((prev) =>
              prev.map((m) => ({
                ...m,
                toolCalls: m.toolCalls?.map((tc) =>
                  tc.toolCallId === toolCallId
                    ? { ...tc, status: "completed" as const }
                    : tc,
                ),
              })),
            );
            break;
          }

          // Default: standalone pill for Task tool completions and orphaned notifications
          state.assistantId = null;
          const id = nextMessageId();
          apply((prev) => [
            ...prev,
            {
              id,
              role: "user" as const,
              content: "",
              timestamp: Date.now(),
              taskNotification: {
                taskId: msg.taskId,
                toolUseId: msg.toolUseId,
                status: msg.status,
                summary: msg.summary,
                outputFile: msg.outputFile,
              },
            },
          ]);
          break;
        }

        case "thinking": {
          if (state.assistantId) {
            const assistantId = state.assistantId;
            apply((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, thinking: (m.thinking ?? "") + msg.content }
                  : m,
              ),
            );
          } else {
            const id = nextMessageId();
            state.assistantId = id;
            apply((prev) => [
              ...prev,
              {
                id,
                role: "assistant" as const,
                content: "",
                thinking: msg.content,
                timestamp: Date.now(),
              },
            ]);
          }
          break;
        }

        case "plan_update": {
          // Plan updates are rendered via the dedicated plan review flow
          // and artifact viewer, not as raw assistant chat text.
          break;
        }

        case "tool_use": {
          // Skip interactive tools — they are handled via dedicated IPC channels
          const INTERACTIVE_TOOLS = new Set([
            "AskUserQuestion",
            "EnterPlanMode",
            "ExitPlanMode",
            "TodoWrite",
          ]);
          if (INTERACTIVE_TOOLS.has(msg.toolName)) break;
          if (msg.toolName === "Skill") {
            const wrapped = (msg.input?.skill ?? msg.input?.name) as string;
            if (wrapped && INTERACTIVE_TOOLS.has(wrapped)) break;
          }

          // Remove any worktree progress messages when agent starts working
          apply((prev) => prev.filter((m) => !m.worktreeProgress));

          const toolCall: ToolCall = {
            toolCallId: msg.toolCallId,
            toolName: msg.toolName,
            input: msg.input,
            status: "running",
          };

          if (msg.toolName === "Task" || msg.toolName === "Agent") {
            // Task tool call - create TaskInfo and track it
            const taskInfo: TaskInfo = {
              taskId: msg.toolCallId,
              subagentType:
                (msg.input.subagent_type as string) ?? "general-purpose",
              description: (msg.input.description as string) ?? "Task",
              prompt: (msg.input.prompt as string) ?? "",
              status: "running",
              childToolCalls: [],
              startTime: Date.now(),
              toolCallsExpanded: true,
            };

            state.assistantId = null;
            state.activeTaskId = msg.toolCallId;
            const id = nextMessageId();
            apply((prev) => [
              ...prev,
              {
                id,
                role: "assistant" as const,
                content: "",
                timestamp: Date.now(),
                taskInfo,
                toolCalls: [toolCall],
              },
            ]);
          } else if (msg.parentToolUseId || state.activeTaskId) {
            // Child tool call - associate with parent task by direct reference or active task
            const parentTaskId = msg.parentToolUseId ?? state.activeTaskId;
            apply((prev) =>
              prev.map((m) => {
                if (m.taskInfo?.taskId === parentTaskId && m.taskInfo) {
                  return {
                    ...m,
                    taskInfo: {
                      ...m.taskInfo,
                      childToolCalls: [
                        ...m.taskInfo.childToolCalls,
                        msg.toolCallId,
                      ],
                    } as ChatMessage["taskInfo"],
                    toolCalls: [...(m.toolCalls ?? []), toolCall],
                  } as ChatMessage;
                }
                return m;
              }),
            );
          } else {
            // Regular tool call (not part of a task)
            state.assistantId = null;
            const id = nextMessageId();
            apply((prev) => [
              ...prev,
              {
                id,
                role: "assistant" as const,
                content: "",
                timestamp: Date.now(),
                toolCalls: [toolCall],
              },
            ]);
          }
          break;
        }

        case "tool_result": {
          // Truncate at storage level to prevent unbounded memory growth
          const truncatedOutput = truncateToolOutput(msg.output);

          // For Monitor tools: extract the task-id from the result output so
          // future Monitor events can be associated with this tool call.
          let monitorTaskIdExtracted: string | undefined;
          if (truncatedOutput) {
            for (const m of state.messages) {
              const tc = m.toolCalls?.find(
                (tc) =>
                  tc.toolCallId === msg.toolCallId && tc.toolName === "Monitor",
              );
              if (tc) {
                const match = truncatedOutput.match(
                  /\(task ([a-zA-Z0-9_-]+)[,)]/,
                );
                if (match) {
                  monitorTaskIdExtracted = match[1];
                  monitorTaskIdsRef.current.set(match[1], tc.toolCallId);
                }
                break;
              }
            }
          }

          if (msg.toolCallId === state.activeTaskId) {
            // Task completed - update taskInfo and auto-collapse
            apply((prev) =>
              prev.map((m) => {
                if (m.taskInfo?.taskId === msg.toolCallId) {
                  return {
                    ...m,
                    taskInfo: {
                      ...m.taskInfo,
                      status: "completed",
                      endTime: Date.now(),
                      result: truncatedOutput,
                      toolCallsExpanded: false,
                    } as ChatMessage["taskInfo"],
                    toolCalls: m.toolCalls?.map((tc) =>
                      tc.toolCallId === msg.toolCallId
                        ? {
                            ...tc,
                            output: truncatedOutput || tc.output,
                            status: "completed" as const,
                          }
                        : tc,
                    ),
                  } as ChatMessage;
                }
                return m;
              }),
            );
            state.activeTaskId = null;
          } else {
            // Regular tool result or child tool result
            apply((prev) =>
              prev.map((m) => ({
                ...m,
                toolCalls: m.toolCalls?.map((tc) => {
                  if (tc.toolCallId !== msg.toolCallId) return tc;
                  return {
                    ...tc,
                    output: truncatedOutput || tc.output,
                    status: "completed" as const,
                    ...(monitorTaskIdExtracted && {
                      monitorTaskId: monitorTaskIdExtracted,
                    }),
                  };
                }),
              })),
            );
          }
          break;
        }

        case "todo_update": {
          // Check if last message is a TODO message - if so, update it (for real-time updates)
          const lastMsg = state.messages[state.messages.length - 1];

          if (
            lastMsg &&
            lastMsg.role === "assistant" &&
            lastMsg.todoData &&
            !lastMsg.content
          ) {
            // Update existing TODO message
            state.assistantId = null;
            apply((prev) => {
              const updated = [...prev];
              updated[updated.length - 1] = {
                ...updated[updated.length - 1],
                todoData: { todos: msg.todos },
              };
              return updated;
            });
          } else {
            // Create new TODO message bubble
            state.assistantId = null;
            const id = nextMessageId();
            apply((prev) => [
              ...prev,
              {
                id,
                role: "assistant" as const,
                content: "",
                timestamp: Date.now(),
                todoData: { todos: msg.todos },
              },
            ]);
          }
          break;
        }

        case "worktree_progress": {
          // Check if last message is a worktree progress message
          const lastMsg = state.messages[state.messages.length - 1];

          if (
            lastMsg &&
            lastMsg.role === "assistant" &&
            lastMsg.worktreeProgress &&
            !lastMsg.content
          ) {
            // Update existing progress message
            state.assistantId = null;
            apply((prev) => {
              const updated = [...prev];
              const steps = lastMsg.worktreeProgress?.steps ?? [];
              const stepIndex = steps.findIndex((s) => s.step === msg.step);

              if (stepIndex >= 0) {
                // Update existing step status
                steps[stepIndex] = { step: msg.step, status: msg.status };
              } else {
                // Add new step
                steps.push({ step: msg.step, status: msg.status });
              }

              updated[updated.length - 1] = {
                ...updated[updated.length - 1],
                worktreeProgress: { steps },
              };
              return updated;
            });
          } else {
            // Create new progress message
            state.assistantId = null;
            const id = nextMessageId();
            apply((prev) => [
              ...prev,
              {
                id,
                role: "assistant" as const,
                content: "",
                timestamp: Date.now(),
                worktreeProgress: {
                  steps: [{ step: msg.step, status: msg.status }],
                },
              },
            ]);
          }
          // Refresh thread data so activeThread.cwd reflects the worktree path
          if (msg.status === "completed") {
            onThreadUpdated?.();
          }
          break;
        }

        case "result": {
          // Attach cost + contextWindow + stop_reason to the last assistant message
          apply((prev) => {
            for (let i = prev.length - 1; i >= 0; i--) {
              if (prev[i].role === "assistant") {
                const updated = [...prev];
                updated[i] = {
                  ...updated[i],
                  cost: msg.cost,
                  usage: msg.usage,
                  ...(msg.contextWindow != null && {
                    contextWindow: msg.contextWindow,
                  }),
                };
                return updated;
              }
            }
            return prev;
          });

          // Update session stats only if this is the active thread
          if (activeThreadIdRef.current === threadId) {
            setSessionStats((prev) => ({
              totalCost: prev.totalCost + (msg.cost ?? 0),
              totalInputTokens:
                prev.totalInputTokens + (msg.usage?.inputTokens ?? 0),
              totalOutputTokens:
                prev.totalOutputTokens + (msg.usage?.outputTokens ?? 0),
              contextWindow: msg.contextWindow ?? prev.contextWindow,
            }));
          }

          // Generate a better title after the first response if still "New chat"
          window.api
            .threadsGet(threadId)
            .then((thread) => {
              if (thread && thread.title === "New chat") {
                // Find first user message
                const firstUserMsg = state.messages.find(
                  (m) => m.role === "user",
                );
                if (firstUserMsg?.content) {
                  const trimmed = firstUserMsg.content.trim();
                  const title = trimmed
                    ? trimmed.length > 50
                      ? trimmed.slice(0, 50) + "..."
                      : trimmed
                    : "New chat";
                  window.api
                    .threadsUpdate(threadId, { title })
                    .then(() => onThreadUpdated?.())
                    .catch(() => {});
                }
              }
            })
            .catch(() => {});

          // Flush any pending batched render so the final cost/usage is visible.
          flushPending();
          state.assistantId = null;
          if (state.messages.length > 0) {
            saveMessages(threadId, state.messages);
          }
          streamingThreadsRef.current.delete(threadId);
          activeStreamIdRef.current.delete(threadId);

          // Reload from the SDK when this is the active thread. The SDK's
          // getSessionMessages filters superseded intermediate turns (e.g. when
          // a skill produces an early response that is later replaced by the
          // main agent's authoritative response). Without this reload, the React
          // state retains both turns and the user sees garbled interleaved content.
          if (threadId === activeThreadIdRef.current) {
            window.api
              .threadsLoadMessages(threadId)
              .then((stored) => {
                if (activeThreadIdRef.current !== threadId) return;
                const loaded =
                  stored.length > 0 ? stored.map(fromStoredMessage) : [];
                if (loaded.length > 0) {
                  setMessages(loaded);
                  setSessionStats(computeSessionStats(loaded));
                }
              })
              .catch(() => {});

            // Refresh context-window usage breakdown. The SDK only reports
            // the new state after the turn fully commits, so query it here.
            window.api
              .getContextUsage(threadId)
              .then((usage) => {
                if (activeThreadIdRef.current === threadId) {
                  setContextUsage(usage);
                }
              })
              .catch(() => {});
          }

          // Clear running state immediately — result means the turn is complete.
          // The main process also sends THREAD_STREAM_STATE, but the SDK generator
          // may not close promptly, so we clear here as defense-in-depth.
          if (threadId !== activeThreadIdRef.current) {
            setThreadNotifications((n) => {
              if (n.has(threadId)) return n;
              return new Map(n).set(threadId, "done");
            });
          }
          setRunningThreadIds((prev) => prev.filter((id) => id !== threadId));
          break;
        }

        case "error": {
          // Auto-open Claude auth dialog on authentication failures
          if (msg.code === "authentication_failed") {
            window.dispatchEvent(new CustomEvent("claude:auth-failed"));
          }

          // Suppress error messages for intentional interrupts — the user
          // clicked stop, so showing "stream interrupted" is not useful.
          if (state.interrupted) {
            // Cancel any pending batch flush — no new messages to show.
            const timer = pendingSetRef.current.get(threadId);
            if (timer) {
              clearTimeout(timer);
              pendingSetRef.current.delete(threadId);
            }
            state.assistantId = null;
            if (state.messages.length > 0) {
              saveMessages(threadId, state.messages);
            }
            streamingThreadsRef.current.delete(threadId);
            activeStreamIdRef.current.delete(threadId);
            setRunningThreadIds((prev) => prev.filter((id) => id !== threadId));
            break;
          }

          const id = nextMessageId();
          apply((prev) => [
            ...prev,
            {
              id,
              role: "assistant" as const,
              content: `Error: ${msg.message}`,
              timestamp: Date.now(),
            },
          ]);
          flushPending();
          state.assistantId = null;
          if (state.messages.length > 0) {
            saveMessages(threadId, state.messages);
          }
          streamingThreadsRef.current.delete(threadId);
          activeStreamIdRef.current.delete(threadId);
          setRunningThreadIds((prev) => prev.filter((id) => id !== threadId));
          break;
        }

        case "session_init":
          if (msg.slashCommands) {
            setSlashCommands(msg.slashCommands);
          }
          if (msg.tools && Array.isArray(msg.tools)) {
            setSessionTools(msg.tools);
          }
          if (msg.mcpServers) {
            setMcpServers(msg.mcpServers);
          }
          // Auto-fetch full MCP status (with scope info) after init
          if (threadId) {
            window.api
              .mcpServerStatus(threadId)
              .then((statuses: McpServerInfo[]) => {
                if (statuses.length > 0) setMcpServers(statuses);
              })
              .catch(() => {});
          }
          break;
      }
    });

    api.onToolPermission((data: unknown, threadId: string | null) => {
      const req = data as PermissionRequest;
      // Tag permission request with threadId so we can filter by active thread
      const tagged = { ...req, threadId };
      setPermissionRequests((prev) => [...prev, tagged]);

      // Set notification for background threads
      if (threadId && threadId !== activeThreadIdRef.current) {
        setThreadNotifications((prev) =>
          new Map(prev).set(threadId, "permission"),
        );
      }
    });

    api.onAskUserQuestion((rawData: unknown, threadId: string | null) => {
      const data = rawData as AskUserQuestionRequest;
      if (!threadId) return;
      const state = streamingThreadsRef.current.get(threadId);
      if (!state) return;

      // Track this thread as awaiting user input so the sidebar shows "Awaiting"
      questionRequestThreadRef.current.set(data.requestId, threadId);
      setPendingQuestionThreadIds((prev) => new Set([...prev, threadId]));

      // Close current text bubble, create a separate question message
      state.assistantId = null;
      const id = nextMessageId();
      const next = [
        ...state.messages,
        {
          id,
          role: "assistant" as const,
          content: "",
          timestamp: Date.now(),
          questionData: data,
        },
      ];
      state.messages = next;
      if (activeThreadIdRef.current === threadId) {
        setMessages(next);
      }

      // Set interactive mode for question (only for active thread)
      if (threadId === activeThreadIdRef.current) {
        setInteractiveMode({
          type: "question",
          requestId: data.requestId,
          data,
        });
      }

      // Set notification for background threads
      if (threadId !== activeThreadIdRef.current) {
        setThreadNotifications((prev) =>
          new Map(prev).set(threadId, "question"),
        );
      }
    });

    api.onPlanReview((rawData: unknown, threadId: string | null) => {
      const data = rawData as PlanReviewRequest;
      if (!threadId) return;
      const state = streamingThreadsRef.current.get(threadId);

      // Track this thread as awaiting user input so the sidebar shows "Awaiting"
      questionRequestThreadRef.current.set(data.requestId, threadId);
      setPendingQuestionThreadIds((prev) => new Set([...prev, threadId]));

      // Close current text bubble, create a separate plan review message
      const id = nextMessageId();
      const planReviewMessage: ChatMessage = {
        id,
        role: "assistant" as const,
        content: "",
        timestamp: Date.now(),
        planReviewData: data,
      };
      if (state) {
        state.assistantId = null;
        const next = [...state.messages, planReviewMessage];
        state.messages = next;
        if (activeThreadIdRef.current === threadId) {
          setMessages(next);
        }
      } else if (threadId === activeThreadIdRef.current) {
        const next = [...messagesRef.current, planReviewMessage];
        setMessages(next);
        saveMessages(threadId, next);
      }

      // Set interactive mode for plan review (only for active thread)
      if (threadId === activeThreadIdRef.current) {
        setInteractiveMode({
          type: "plan-review",
          requestId: data.requestId,
          data,
        });
      }

      // Set notification for background threads
      if (threadId !== activeThreadIdRef.current) {
        setThreadNotifications((prev) =>
          new Map(prev).set(threadId, "plan_review"),
        );
      }
    });

    // Listen for thread stream state changes from main process
    api.onThreadStreamState(({ threadId, isRunning }) => {
      setRunningThreadIds((prev) => {
        // When a thread stops running and it's not the active thread,
        // set a "done" notification so the sidebar shows a Done pill.
        if (
          !isRunning &&
          prev.includes(threadId) &&
          threadId !== activeThreadIdRef.current
        ) {
          setThreadNotifications((n) => {
            // Don't overwrite a more important notification (permission/question)
            if (n.has(threadId)) return n;
            return new Map(n).set(threadId, "done");
          });
        }
        if (isRunning)
          return prev.includes(threadId) ? prev : [...prev, threadId];
        return prev.filter((id) => id !== threadId);
      });
      // NOTE: Do NOT delete streamingThreadsRef here. This event arrives on a
      // different IPC channel than STREAM_MESSAGE, so ordering is not guaranteed.
      // If we delete the streaming state before the final stream events arrive,
      // late non-terminal events (text, tool_result) create a new empty state
      // with messages: [], which clobbers accumulated messages via setMessages().
      // The result/error handlers in onStreamMessage already handle cleanup
      // after saving messages. For the edge case where no terminal event arrives,
      // interrupt() sets a 5s timeout to force-clear the state.
    });

    // Pull any already-cached commands (handles reload via cmd+r)
    api.getSlashCommands().then((commands) => {
      if (commands.length > 0) setSlashCommands(commands);
    });

    // Sync running threads on mount (handles reload)
    api.getRunningThreads().then((ids) => {
      if (ids.length > 0) setRunningThreadIds(ids);
    });

    api.onSlashCommands(
      (commands: { name: string; description?: string }[]) => {
        setSlashCommands(commands);
      },
    );

    api.onMcpStatusChanged(
      ({ servers }: { threadId: string; servers: unknown[] }) => {
        setMcpServers(servers.length > 0 ? (servers as McpServerInfo[]) : null);
      },
    );

    // External transcript reset (e.g. Manager provider switch wiped the
    // session + disk messages). If the affected thread is active, drop
    // in-memory state and re-load — since storage is now empty, this
    // clears the chat view.
    api.onThreadMessagesReload(({ threadId }: { threadId: string }) => {
      if (threadId !== activeThreadIdRef.current) return;
      streamingThreadsRef.current.delete(threadId);
      activeStreamIdRef.current.delete(threadId);
      setMessages([]);
      setSessionStats({
        totalCost: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        contextWindow: null,
      });
      setSessionTools(null);
      setMcpServers(null);
    });

    api.onModeChanged((data: { mode: string }, threadId: string | null) => {
      if (!threadId) return;

      // Always refresh thread list so the bottom bar reflects the new mode
      onThreadUpdated?.();

      const state = streamingThreadsRef.current.get(threadId);
      if (!state) return;

      // Insert a synthetic assistant message with modeChange field
      const modeMsg: ChatMessage = {
        id: nextMessageId(),
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        modeChange: data.mode as AgentMode,
      };
      const next = [...state.messages, modeMsg];
      state.messages = next;
      if (activeThreadIdRef.current === threadId) {
        setMessages(next);
      }
    });

    return (): void => {
      api.removeAllListeners("chat:stream-message");
      api.removeAllListeners("chat:tool-permission");
      api.removeAllListeners("chat:session-ready");
      api.removeAllListeners("chat:ask-user-question");
      api.removeAllListeners("chat:plan-review");
      api.removeAllListeners("chat:mode-changed");
      api.removeAllListeners("chat:thread-stream-state");
      api.removeAllListeners("chat:thread-activate");
      api.removeAllListeners("mcp:status-changed");
      api.removeAllListeners("skills:slash-commands");
      streamingThreadsRef.current.clear();
      activeStreamIdRef.current.clear();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sendMessage = useCallback(
    async (
      prompt: string,
      threadId?: string,
      images?: ImageAttachment[],
      fileAttachments?: FileAttachment[],
    ) => {
      const targetThreadId = threadId ?? activeThreadId;
      if (!targetThreadId) return;

      // Per-thread guard: don't send to a thread that's already streaming
      if (runningThreadIds.includes(targetThreadId)) return;

      const currentMessages = messagesRef.current;
      if (currentMessages.length === 0) {
        // Use first message as title, ensuring it's not empty
        const trimmed = prompt.trim();
        const title = trimmed
          ? trimmed.length > 50
            ? trimmed.slice(0, 50) + "..."
            : trimmed
          : fileAttachments && fileAttachments.length > 0
            ? fileAttachments[0].name
            : "New chat";
        await window.api.threadsUpdate(targetThreadId, { title });
        onThreadUpdated?.();
      }

      const userMsg: ChatMessage = {
        id: nextMessageId(),
        role: "user",
        content: prompt,
        timestamp: Date.now(),
        ...(images && images.length > 0 && { images }),
        ...(fileAttachments &&
          fileAttachments.length > 0 && { fileAttachments }),
      };
      const newMessages = [...currentMessages, userMsg];

      // Initialize per-thread streaming state
      streamingThreadsRef.current.set(targetThreadId, {
        messages: newMessages,
        assistantId: null,
        activeTaskId: null,
      });
      setMessages(newMessages);

      // Pass images separately so the main process can build proper API content blocks
      const ipcImages = images?.map((img) => ({
        dataUrl: img.dataUrl,
        mimeType: img.mimeType,
      }));

      // Append file paths to the prompt so the agent can read them
      let promptToSend = prompt;
      if (fileAttachments && fileAttachments.length > 0) {
        const filePaths = fileAttachments.map((f) => `- ${f.path}`).join("\n");
        promptToSend = prompt
          ? `${prompt}\n\nAttached files:\n${filePaths}`
          : `Attached files:\n${filePaths}`;
      }

      // Fire and forget — sendMessage now returns immediately from main process
      window.api
        .sendMessage(promptToSend, targetThreadId, ipcImages)
        .catch((err) => {
          const errorId = nextMessageId();
          const errorMsg: ChatMessage = {
            id: errorId,
            role: "assistant",
            content: `Error: ${err instanceof Error ? err.message : "Failed to send message"}`,
            timestamp: Date.now(),
          };
          const state = streamingThreadsRef.current.get(targetThreadId);
          if (state) {
            state.messages = [...state.messages, errorMsg];
            saveMessages(targetThreadId, state.messages);
            streamingThreadsRef.current.delete(targetThreadId);
          }
          if (activeThreadIdRef.current === targetThreadId) {
            setMessages((prev) => [...prev, errorMsg]);
          }
        });
    },
    [runningThreadIds, activeThreadId, onThreadUpdated, saveMessages],
  );

  const interrupt = useCallback(
    async (threadId?: string) => {
      const tid =
        (typeof threadId === "string" ? threadId : undefined) ??
        activeThreadIdRef.current;
      if (!tid) return;

      // Mark as interrupted before the async call so any error events that
      // arrive (even if the interrupt IPC call fails) are suppressed in the UI.
      const state = streamingThreadsRef.current.get(tid);
      if (state) {
        state.interrupted = true;
        if (state.messages.length > 0) {
          saveMessages(tid, state.messages);
        }
      }

      try {
        await window.api.interrupt(tid);
      } catch {
        // Interrupt failed (e.g. session already dead). The cleanup timeout
        // below will force-clear the running indicator so the UI isn't stuck.
      }

      // Don't delete streaming state here — let the stream's result/error
      // event handle cleanup. Eagerly deleting causes late-arriving events
      // to create a new empty state, which clobbers messages via setMessages([]).
      //
      // However, if the stream doesn't end within 5s (e.g. the SDK generator
      // hangs or the session is dead), force-clear the running indicator.
      const capturedTid = tid;
      setTimeout(() => {
        if (streamingThreadsRef.current.has(capturedTid)) {
          streamingThreadsRef.current.delete(capturedTid);
          setRunningThreadIds((prev) =>
            prev.filter((id) => id !== capturedTid),
          );
        }
      }, 5000);
    },
    [saveMessages],
  );

  const respondPermission = useCallback(
    (requestId: string, approved: boolean, updatedPermissions?: unknown[]) => {
      window.api.respondToolPermission(requestId, approved, updatedPermissions);
      setPermissionRequests((prev) =>
        prev.filter((r) => r.requestId !== requestId),
      );

      if (!approved) {
        // Mark running tool calls as denied in the active thread's streaming state
        const activeId = activeThreadIdRef.current;
        if (activeId) {
          const state = streamingThreadsRef.current.get(activeId);
          if (state) {
            state.messages = state.messages.map((m) => ({
              ...m,
              toolCalls: m.toolCalls?.map((tc) =>
                tc.status === "running"
                  ? { ...tc, status: "denied" as const }
                  : tc,
              ),
            }));
          }
        }
        setMessages((prev) =>
          prev.map((m) => ({
            ...m,
            toolCalls: m.toolCalls?.map((tc) =>
              tc.status === "running"
                ? { ...tc, status: "denied" as const }
                : tc,
            ),
          })),
        );
      }
    },
    [],
  );

  const respondQuestion = useCallback(
    (requestId: string, answers: Record<string, string>) => {
      window.api.respondAskUserQuestion(requestId, answers);
      // Clear the "Awaiting" status for this thread
      const tid = questionRequestThreadRef.current.get(requestId);
      questionRequestThreadRef.current.delete(requestId);
      if (tid) {
        setPendingQuestionThreadIds((prev) => {
          const next = new Set(prev);
          next.delete(tid);
          return next;
        });
      }
      // Mark question as answered (preserves history for reload)
      const markAnswered = (msgs: ChatMessage[]): ChatMessage[] =>
        msgs.map((m) =>
          m.questionData?.requestId === requestId
            ? { ...m, questionAnswered: true }
            : m,
        );
      setMessages(markAnswered);
      // Update the streaming state for the active thread
      const activeId = activeThreadIdRef.current;
      if (activeId) {
        const state = streamingThreadsRef.current.get(activeId);
        if (state) {
          state.messages = markAnswered(state.messages);
        }
      }
      // Clear interactive mode when question is answered (via buttons or InputBar)
      setInteractiveMode({ type: "none" });
    },
    [],
  );

  const respondPlanReview = useCallback(
    (requestId: string, decision: { type: string; feedback?: string }) => {
      window.api.respondPlanReview(requestId, decision);
      // Clear the "Awaiting" status for this thread
      const tid = questionRequestThreadRef.current.get(requestId);
      questionRequestThreadRef.current.delete(requestId);
      if (tid) {
        setPendingQuestionThreadIds((prev) => {
          const next = new Set(prev);
          next.delete(tid);
          return next;
        });
      }
      // Clear interactive mode when plan review is decided (via buttons or InputBar)
      setInteractiveMode({ type: "none" });
    },
    [],
  );

  const handleInteractiveResponse = useCallback(
    (text: string) => {
      if (interactiveMode.type === "plan-review") {
        // Add user feedback as a visible message bubble
        const threadId = activeThreadIdRef.current;
        if (threadId) {
          const state = streamingThreadsRef.current.get(threadId);
          if (state) {
            // Mark the plan review message as responded so buttons get disabled
            state.messages = state.messages.map((m) =>
              m.planReviewData?.requestId === interactiveMode.requestId
                ? {
                    ...m,
                    planReviewData: { ...m.planReviewData, responded: true },
                  }
                : m,
            );
            // Add user feedback message
            const userMsg: ChatMessage = {
              id: nextMessageId(),
              role: "user" as const,
              content: text,
              timestamp: Date.now(),
            };
            state.messages = [...state.messages, userMsg];
            setMessages([...state.messages]);
          }
        }
        // Send feedback through plan review callback
        respondPlanReview(interactiveMode.requestId, {
          type: "deny",
          feedback: text,
        });
        // Clear interactive mode
        setInteractiveMode({ type: "none" });
      } else if (interactiveMode.type === "question") {
        // Send answer through question callback
        respondQuestion(interactiveMode.requestId, { answer: text });
        // Clear interactive mode
        setInteractiveMode({ type: "none" });
      }
    },
    [interactiveMode, respondPlanReview, respondQuestion],
  );

  const fetchMcpStatus = useCallback(async (threadId: string) => {
    try {
      const statuses = await window.api.mcpServerStatus(threadId);
      if (statuses.length > 0) setMcpServers(statuses);
    } catch {}
  }, []);

  const refreshContextUsage = useCallback(async () => {
    const tid = activeThreadIdRef.current;
    if (!tid) {
      setContextUsage(null);
      return;
    }
    try {
      const usage = await window.api.getContextUsage(tid);
      if (activeThreadIdRef.current === tid) {
        setContextUsage(usage);
      }
    } catch {
      // Control request unavailable (e.g. session not yet initialized) —
      // leave the previous reading in place so the UI doesn't flicker.
    }
  }, []);

  const updateTaskExpanded = useCallback(
    (messageId: string, expanded: boolean) => {
      const activeId = activeThreadIdRef.current;
      if (!activeId) return;

      const state = streamingThreadsRef.current.get(activeId);
      if (state) {
        state.messages = state.messages.map((m) => {
          if (m.id === messageId && m.taskInfo) {
            return {
              ...m,
              taskInfo: { ...m.taskInfo, toolCallsExpanded: expanded },
            };
          }
          return m;
        });
      }

      setMessages((prev) =>
        prev.map((m) => {
          if (m.id === messageId && m.taskInfo) {
            return {
              ...m,
              taskInfo: { ...m.taskInfo, toolCallsExpanded: expanded },
            };
          }
          return m;
        }),
      );
    },
    [],
  );

  return {
    messages,
    isStreaming,
    permissionRequest,
    sessionStats,
    interactiveMode,
    sendMessage,
    interrupt,
    respondPermission,
    respondQuestion,
    respondPlanReview,
    handleInteractiveResponse,
    updateTaskExpanded,
    slashCommands,
    sessionTools,
    mcpServers,
    fetchMcpStatus,
    contextUsage,
    refreshContextUsage,
    runningThreadIds,
    threadNotifications,
    pendingPermissionThreadIds,
  };
}
