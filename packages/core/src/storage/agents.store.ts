import { join } from "path";
import { homedir } from "os";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
} from "fs";
import type { AgentDefinition } from "../types/agent";
import {
  DEFAULT_AGENT,
  DEFAULT_AGENT_ID,
  validateAgentDefinition,
} from "../types/agent";
import { AGENT_SEEDS } from "./agent-seeds";

export function getAgentsDir(): string {
  return join(homedir(), ".stratos", "agents");
}

function getAgentPath(id: string): string {
  return join(getAgentsDir(), `${id}.json`);
}

/**
 * Load every agent, `DEFAULT_AGENT` first, then user agents sorted by name.
 * A file that fails to parse is skipped (with a console warning) rather than
 * failing the whole load.
 */
export function loadAgents(): AgentDefinition[] {
  const dir = getAgentsDir();
  const userAgents: AgentDefinition[] = [];

  if (existsSync(dir)) {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      const path = join(dir, file);
      try {
        const raw = readFileSync(path, "utf-8");
        userAgents.push(JSON.parse(raw) as AgentDefinition);
      } catch (err) {
        console.warn(
          `[agents.store] skipping invalid agent file "${path}":`,
          err,
        );
      }
    }
  }

  userAgents.sort((a, b) => a.name.localeCompare(b.name));
  return [DEFAULT_AGENT, ...userAgents];
}

/** Get a single agent by id, or null if it doesn't exist / fails to parse. */
export function getAgent(id: string): AgentDefinition | null {
  if (id === DEFAULT_AGENT_ID) return DEFAULT_AGENT;
  const path = getAgentPath(id);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as AgentDefinition;
  } catch (err) {
    console.warn(`[agents.store] failed to read agent "${id}":`, err);
    return null;
  }
}

/**
 * Validate and persist an agent definition to its own file. Throws if the
 * definition is invalid, or if it would overwrite a built-in agent.
 * Stamps `createdAt` (preserved across updates) and `updatedAt`.
 */
export function saveAgent(def: AgentDefinition): AgentDefinition {
  const errors = validateAgentDefinition(def);
  if (errors.length > 0) {
    throw new Error(
      `Invalid agent definition: ${errors
        .map((e) => `${e.field}: ${e.message}`)
        .join("; ")}`,
    );
  }

  const existing = getAgent(def.id);
  if (existing?.builtIn) {
    throw new Error(`Cannot overwrite built-in agent "${def.id}"`);
  }

  const dir = getAgentsDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const now = Date.now();
  const toSave: AgentDefinition = {
    ...def,
    createdAt: existing?.createdAt ?? def.createdAt ?? now,
    updatedAt: now,
  };

  writeFileSync(getAgentPath(def.id), JSON.stringify(toSave, null, 2), "utf-8");
  return toSave;
}

/**
 * Delete a user agent. Returns false if it doesn't exist. Throws if the
 * agent is built in (built-ins have no file to delete in the first place).
 */
export function deleteAgent(id: string): boolean {
  const existing = getAgent(id);
  if (!existing) return false;
  if (existing.builtIn) {
    throw new Error(`Cannot delete built-in agent "${id}"`);
  }

  const path = getAgentPath(id);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

/**
 * Idempotently seed the shipped personas (Droid, Penny, Friday, Mimir) on
 * first run. No-ops if the agents dir already has any `*.json` file in it —
 * so a user who deleted every seed agent doesn't get them back.
 */
export function seedDefaultAgents(): void {
  const dir = getAgentsDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const hasAny = readdirSync(dir).some((f) => f.endsWith(".json"));
  if (hasAny) return;

  const now = Date.now();
  for (const seed of AGENT_SEEDS) {
    // Seeded prompts are stored inline in the definition, not as sidecar
    // prompt.md files: an agent's persona should be editable inside the
    // product rather than requiring the user to go find a file on disk.
    // `prompt` still accepts a path list for people who prefer to keep
    // prompts in git — that's just not the default.
    const def: AgentDefinition = {
      ...seed.definition,
      createdAt: now,
      updatedAt: now,
    };
    writeFileSync(
      join(dir, `${def.id}.json`),
      JSON.stringify(def, null, 2),
      "utf-8",
    );
  }
}
