import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchEvent } from "../src/destinations";
import { createTestEnv, deploymentEvent } from "./helpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("destination delivery", () => {
  it("rejects delivery when no destination is configured", async () => {
    const { env } = createTestEnv();
    await expect(dispatchEvent(env as never, deploymentEvent() as never))
      .rejects.toThrow("no notification destinations configured");
  });

  it("persists successful per-destination receipts across a partial retry", async () => {
    const { env, kv } = createTestEnv({
      DISCORD_WEBHOOK_URL: "https://discord.example.test/webhook",
      SLACK_WEBHOOK_URL: "https://slack.example.test/webhook",
    });

    const firstFetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response("temporary failure", { status: 500 }));
    vi.stubGlobal("fetch", firstFetch);

    await expect(dispatchEvent(env as never, deploymentEvent() as never)).rejects.toThrow("webhook returned 500");
    expect(firstFetch).toHaveBeenCalledTimes(2);
    expect(kv.store.get("delivered:event-1:discord")).toBe("1");
    expect(kv.store.has("delivered:event-1:slack")).toBe(false);

    const retryFetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", retryFetch);

    await expect(dispatchEvent(env as never, deploymentEvent() as never)).resolves.toBeUndefined();
    expect(retryFetch).toHaveBeenCalledTimes(1);
    expect(retryFetch.mock.calls[0]![0]).toBe("https://slack.example.test/webhook");
    expect(kv.store.get("delivered:event-1:slack")).toBe("1");
  });
});
