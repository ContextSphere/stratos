import { useState, useEffect, useCallback } from "react";
import type { AgentDefinition, CreateAgentInput } from "@stratosapp/core";

interface UseAgentsReturn {
  agents: AgentDefinition[];
  refresh: () => Promise<void>;
  create: (input: CreateAgentInput) => Promise<AgentDefinition>;
  save: (def: AgentDefinition) => Promise<AgentDefinition | null>;
  remove: (id: string) => Promise<boolean>;
  get: (id: string) => Promise<AgentDefinition | null>;
}

/**
 * Loads agent definitions and keeps them in sync with the main process.
 *
 * The `agentsList`/`agentsGet`/`agentsCreate`/`agentsSave`/`agentsDelete`/`onAgentsChanged`
 * preload methods are owned by a parallel workstream and called defensively
 * (`?.()`) with a `[]` fallback so the app still runs if they land after
 * this hook does.
 */
export function useAgents(): UseAgentsReturn {
  const [agents, setAgents] = useState<AgentDefinition[]>([]);

  const refresh = useCallback(async () => {
    const list = (await window.api.agentsList?.()) ?? [];
    setAgents(list);
  }, []);

  useEffect(() => {
    refresh();
    const cleanup = window.api.onAgentsChanged?.(() => {
      refresh();
    });
    return cleanup;
  }, [refresh]);

  const create = useCallback(
    async (input: CreateAgentInput) => {
      if (!window.api.agentsCreate) {
        throw new Error("Bot creation is unavailable. Please restart Stratos.");
      }
      const created = await window.api.agentsCreate(input);
      await refresh();
      return created;
    },
    [refresh],
  );

  const save = useCallback(
    async (def: AgentDefinition) => {
      const result = (await window.api.agentsSave?.(def)) ?? null;
      await refresh();
      return result;
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      const result = (await window.api.agentsDelete?.(id)) ?? false;
      await refresh();
      return result;
    },
    [refresh],
  );

  const get = useCallback(async (id: string) => {
    return (await window.api.agentsGet?.(id)) ?? null;
  }, []);

  return { agents, refresh, create, save, remove, get };
}
