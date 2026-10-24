import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getOpenRouterBaseURL,
  validateOpenRouterCredential,
} from "../integrations/openrouter";

describe("OpenRouter integration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the official API URL by default", () => {
    expect(getOpenRouterBaseURL()).toBe("https://openrouter.ai/api/v1");
  });

  it("validates credentials without exposing them in the URL", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));

    await validateOpenRouterCredential("test-secret");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/auth/key",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-secret",
          "X-Title": "Stratos",
        }),
      }),
    );
  });

  it("turns rejected credentials into an actionable error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("upstream details", { status: 401 }),
    );

    await expect(
      validateOpenRouterCredential("invalid-secret"),
    ).rejects.toThrow("OpenRouter rejected this API key");
  });
});
