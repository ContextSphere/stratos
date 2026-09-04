import { describe, it, expect, vi, afterEach } from "vitest";
import { ClaudeCodeProvider } from "../providers/claude-code.provider";
import { CodexProvider } from "../providers/codex.provider";
import { CopilotProvider } from "../providers/copilot.provider";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("provider steering strategies", () => {
  it("declares transport behavior without desktop provider-name checks", () => {
    expect(new ClaudeCodeProvider().midTurnSteering).toBe(
      "interrupt-and-restart",
    );
    expect(new CodexProvider().midTurnSteering).toBe("interrupt-and-restart");
    expect(new CopilotProvider().midTurnSteering).toBe("live");
  });
});

describe("CopilotProvider.pushMessage", () => {
  it("sends with mode 'immediate' while a turn is active", async () => {
    const provider = new CopilotProvider() as any;
    const send = vi.fn().mockResolvedValue("msg_1");
    provider.currentSession = { send };
    provider.turnActive = true;

    await expect(
      provider.pushMessage("actually, skip the refactor"),
    ).resolves.toBe(true);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "actually, skip the refactor",
        mode: "immediate",
      }),
    );
  });

  it("returns false when no turn is active", async () => {
    const provider = new CopilotProvider() as any;
    const send = vi.fn();
    provider.currentSession = { send };
    provider.turnActive = false;

    await expect(provider.pushMessage("hello")).resolves.toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("returns false when the SDK send rejects", async () => {
    const provider = new CopilotProvider() as any;
    provider.currentSession = {
      send: vi.fn().mockRejectedValue(new Error("closed")),
    };
    provider.turnActive = true;
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(provider.pushMessage("hi")).resolves.toBe(false);
  });
});
