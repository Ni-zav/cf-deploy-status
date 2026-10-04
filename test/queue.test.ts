import { describe, expect, it, vi } from "vitest";
import { handleQueue } from "../src/handlers/queue";
import { createTestEnv, deploymentEvent } from "./helpers";

function messageFor(event: Record<string, unknown>) {
  return {
    body: { kind: "deployment-event", event },
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

describe("queue acknowledgement semantics", () => {
  it("retries instead of acknowledging when delivery cannot run", async () => {
    const { env, kv } = createTestEnv();
    const message = messageFor(deploymentEvent());

    await handleQueue({ messages: [message] } as never, env as never);

    expect(message.ack).not.toHaveBeenCalled();
    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
    expect(kv.store.has("processed:event-1")).toBe(false);
  });

  it("acknowledges an event already marked processed", async () => {
    const { env, kv } = createTestEnv();
    kv.store.set("processed:event-1", "1");
    const message = messageFor(deploymentEvent());

    await handleQueue({ messages: [message] } as never, env as never);

    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
  });

  it("marks suppressed started events processed", async () => {
    const { env, kv } = createTestEnv({ NOTIFY_STARTED: "false" });
    const message = messageFor(deploymentEvent({ eventId: "started-1", status: "started" }));

    await handleQueue({ messages: [message] } as never, env as never);

    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
    expect(kv.store.get("processed:started-1")).toBe("1");
  });
});
