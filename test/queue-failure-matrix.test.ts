import { afterEach, describe, expect, it, vi } from "vitest";
import { handleQueue } from "../src/handlers/queue";
import { createTestEnv, deploymentEvent } from "./helpers";

function messageFor(body: unknown) {
  return { body, ack: vi.fn(), retry: vi.fn() };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("queue failure matrix", () => {
  it("delivers each destination at most once after a single destination fails", async () => {
    const { env, kv } = createTestEnv({
      DISCORD_WEBHOOK_URL: "https://discord.example.test/hooks/1",
      SLACK_WEBHOOK_URL: "https://slack.example.test/hooks/2",
    });
    const first = messageFor({ kind: "deployment-event", event: deploymentEvent() });
    const firstAttempt = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    vi.stubGlobal("fetch", firstAttempt);
    await handleQueue({ messages: [first] } as never, env as never);

    expect(first.ack).not.toHaveBeenCalled();
    expect(first.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
    expect(kv.store.get("delivered:event-1:discord")).toBe("1");
    expect(kv.store.has("delivered:event-1:slack")).toBe(false);
    expect(kv.store.has("processed:event-1")).toBe(false);

    const retryFetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", retryFetch);
    const redelivered = messageFor({ kind: "deployment-event", event: deploymentEvent() });
    await handleQueue({ messages: [redelivered] } as never, env as never);
    expect(redelivered.ack).toHaveBeenCalledTimes(1);
    expect(redelivered.retry).not.toHaveBeenCalled();
    expect(retryFetch).toHaveBeenCalledTimes(1);
    expect(retryFetch.mock.calls[0]?.[0]).toBe("https://slack.example.test/hooks/2");
    expect(kv.store.get("delivered:event-1:slack")).toBe("1");
    expect(kv.store.get("processed:event-1")).toBe("1");
  });

  it("a failing event does not prevent later batch messages from being delivered", async () => {
    const { env, kv } = createTestEnv({
      GENERIC_WEBHOOK_URL: "https://destination.example.test/alerts",
    });
    const first = messageFor({ kind: "deployment-event", event: deploymentEvent({ eventId: "failure" }) });
    const second = messageFor({ kind: "deployment-event", event: deploymentEvent({ eventId: "success" }) });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await handleQueue({ messages: [first, second] } as never, env as never);
    expect(first.retry).toHaveBeenCalledTimes(1);
    expect(first.ack).not.toHaveBeenCalled();
    expect(second.ack).toHaveBeenCalledTimes(1);
    expect(second.retry).not.toHaveBeenCalled();
    expect(kv.store.has("processed:failure")).toBe(false);
    expect(kv.store.get("processed:success")).toBe("1");
  });

  it("does not log raw malformed payloads containing secrets", async () => {
    const { env } = createTestEnv();
    const message = messageFor({ token: "should-never-be-logged", kind: "malformed" });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await handleQueue({ messages: [message] } as never, env as never);
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
    expect(JSON.stringify(spy.mock.calls)).not.toContain("should-never-be-logged");
  });

  it("retries when state lookup fails, without attempting an external send", async () => {
    const { env, kv } = createTestEnv({
      GENERIC_WEBHOOK_URL: "https://destination.example.test/alerts",
    });
    kv.binding.get.mockRejectedValueOnce(new Error("KV unavailable"));
    const send = vi.fn();
    vi.stubGlobal("fetch", send);
    const message = messageFor({ kind: "deployment-event", event: deploymentEvent() });
    await handleQueue({ messages: [message] } as never, env as never);
    expect(message.ack).not.toHaveBeenCalled();
    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
    expect(send).not.toHaveBeenCalled();
  });
});
