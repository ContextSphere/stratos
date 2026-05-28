import type { AgentProvider } from "./types";
import { ClaudeCodeProvider } from "./claude-code.provider";
import { CodexProvider } from "./codex.provider";
import { OpencodeProvider } from "./opencode.provider";
import { CopilotProvider } from "./copilot.provider";

export type {
  AgentProvider,
  AgentMessage,
  ProviderConfig,
  SendMessageParams,
  AgentDefinition,
  McpServerInfo,
} from "./types";

type ProviderConstructor = new () => AgentProvider;

const registry: Record<string, ProviderConstructor> = {
  "claude-code": ClaudeCodeProvider,
  codex: CodexProvider,
  opencode: OpencodeProvider,
  copilot: CopilotProvider,
};

export function createProvider(name: string): AgentProvider {
  const Constructor = registry[name];
  if (!Constructor) {
    throw new Error(
      `Unknown provider: "${name}". Available: ${Object.keys(registry).join(", ")}`,
    );
  }
  return new Constructor();
}

export function getAvailableProviders(): string[] {
  return Object.keys(registry);
}
