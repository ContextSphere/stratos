import { useState, useEffect, useCallback } from "react";
import type {
  ScheduledPrompt,
  ScheduleConfig,
  ProviderType,
} from "@stratosapp/core";

export interface CreateScheduledPromptInput {
  name: string;
  prompt: string;
  provider: ProviderType;
  model?: string;
  folderId: string;
  schedule: ScheduleConfig;
}

interface UseScheduledPromptsReturn {
  prompts: ScheduledPrompt[];
  create: (data: CreateScheduledPromptInput) => Promise<ScheduledPrompt>;
  update: (
    id: string,
    updates: Partial<ScheduledPrompt>,
  ) => Promise<ScheduledPrompt | null>;
  remove: (id: string) => Promise<boolean>;
  toggle: (id: string, enabled: boolean) => Promise<void>;
  runNow: (id: string) => Promise<string | null>;
  refresh: () => Promise<void>;
}

export function useScheduledPrompts(): UseScheduledPromptsReturn {
  const [prompts, setPrompts] = useState<ScheduledPrompt[]>([]);

  const refresh = useCallback(async () => {
    const list = (await window.api.scheduledList()) as ScheduledPrompt[];
    setPrompts(list);
  }, []);

  useEffect(() => {
    refresh();
    const cleanup = window.api.onScheduledChanged(() => {
      refresh();
    });
    return cleanup;
  }, [refresh]);

  const create = useCallback(
    async (data: CreateScheduledPromptInput) => {
      const result = (await window.api.scheduledCreate(
        data as Parameters<typeof window.api.scheduledCreate>[0],
      )) as ScheduledPrompt;
      await refresh();
      return result;
    },
    [refresh],
  );

  const update = useCallback(
    async (id: string, updates: Partial<ScheduledPrompt>) => {
      const result = (await window.api.scheduledUpdate(
        id,
        updates as Record<string, unknown>,
      )) as ScheduledPrompt | null;
      await refresh();
      return result;
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      const result = await window.api.scheduledDelete(id);
      await refresh();
      return result;
    },
    [refresh],
  );

  const toggle = useCallback(
    async (id: string, enabled: boolean) => {
      await window.api.scheduledUpdate(id, { enabled });
      await refresh();
    },
    [refresh],
  );

  const runNow = useCallback(
    async (id: string) => {
      const threadId = await window.api.scheduledRunNow(id);
      await refresh();
      return threadId;
    },
    [refresh],
  );

  return { prompts, create, update, remove, toggle, runNow, refresh };
}
