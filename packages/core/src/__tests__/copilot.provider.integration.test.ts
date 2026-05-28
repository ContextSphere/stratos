import { describe, it, expect } from "vitest";
import { createProvider } from "../providers";
import type { AgentProvider } from "../providers/types";

const RUN = process.env.RUN_COPILOT_INTEGRATION === "1";
const describeIfReal = RUN ? describe : describe.skip;

// Live tests that hit the actual Copilot CLI. Gated behind
// RUN_COPILOT_INTEGRATION=1 so CI without auth doesn't fail.

async function disposeAfter<T>(
  p: AgentProvider,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } finally {
    try {
      await p.dispose();
    } catch {
      /* */
    }
  }
}

describeIfReal("CopilotProvider integration", () => {
  it("getAvailableModels returns the live model list", async () => {
    const p = createProvider("copilot");
    await p.initialize({ cwd: "/tmp" });
    await disposeAfter(p, async () => {
      const models = await p.getAvailableModels();
      expect(models.length).toBeGreaterThan(1);
      expect(models[0].value).toBeTypeOf("string");
      expect(models[0].displayName).toBeTypeOf("string");
    });
  }, 60_000);

  it("streams text + result for a tiny prompt", async () => {
    const p = createProvider("copilot");
    await p.initialize({ cwd: "/tmp" });
    await disposeAfter(
      p,
      async () => {
        const seen: string[] = [];
        let finalText = "";
        let result: any = null;
        for await (const m of p.sendMessage({
          prompt: "Just say HELLO. No tools.",
          mode: "default",
          permissionHandler: async () => ({ approved: true }),
          onElicitation: async () => ({ action: "decline" }),
        })) {
          seen.push(m.type);
          if (m.type === "text" && !m.isStreaming) finalText = m.content;
          if (m.type === "result") result = m;
        }
        expect(seen).toContain("session_init");
        expect(seen).toContain("text");
        expect(seen).toContain("result");
        expect(seen.filter((t) => t === "result").length).toBe(1);
        expect(finalText.toUpperCase()).toContain("HELLO");
        expect(result.usage.inputTokens).toBeGreaterThan(0);
      },
      60_000,
    );
  }, 60_000);

  it("plan mode rejects write tool calls", async () => {
    const p = createProvider("copilot");
    await p.initialize({ cwd: "/tmp" });
    await disposeAfter(
      p,
      async () => {
        const toolNames: string[] = [];
        const errors: string[] = [];
        for await (const m of p.sendMessage({
          prompt: "Append 'plan-test' to /tmp/_copilot_plan_test.txt.",
          mode: "plan",
          permissionHandler: async () => ({ approved: true }),
          onElicitation: async () => ({ action: "decline" }),
        })) {
          if (m.type === "tool_use") toolNames.push(m.toolName);
          if (m.type === "tool_result") {
            if (
              m.output.toLowerCase().includes("plan mode is read-only") ||
              m.output.toLowerCase().includes("rejected") ||
              m.output.toLowerCase().includes("read-only")
            ) {
              errors.push(m.output);
            }
          }
        }
        // The model attempts a tool; the provider rejects writes.
        expect(toolNames.length).toBeGreaterThan(0);
        expect(errors.length).toBeGreaterThan(0);
      },
      60_000,
    );
  }, 60_000);
});
