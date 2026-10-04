import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchEvent } from "../src/destinations";
import { handleQueue } from "../src/handlers/queue";
import { getReadiness } from "../src/readiness";
import { sanitizeErrorSummary } from "../src/utils";
import { createTestEnv, deploymentEvent } from "./helpers";

const settings = { TELEGRAM_BOT_TOKEN: "123456:test-token", TELEGRAM_CHAT_ID: "-1001234567890" };
afterEach(() => vi.unstubAllGlobals());

describe("Telegram destination", () => {
  it.each(["started", "succeeded", "failed", "canceled", "skipped"])("sends %s as plain text and records a receipt", async (status) => {
    const { env, kv } = createTestEnv(settings);
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true, result: { message_id: 1 } }));
    vi.stubGlobal("fetch", fetch);
    await dispatchEvent(env as never, deploymentEvent({ status, branch: "main", commitSha: "abcdef123456", deploymentUrl: "https://deploy.example.test" }) as never);
    expect(fetch.mock.calls[0]![0]).toBe("https://api.telegram.org/bot123456:test-token/sendMessage");
    const body = JSON.parse(fetch.mock.calls[0]![1].body);
    expect(body.chat_id).toBe(settings.TELEGRAM_CHAT_ID);
    expect(body.text).toContain(`DEPLOY ${status.toUpperCase()}`);
    expect(body.text).toContain("branch: main");
    expect(body.text).toContain("commit: abcdef12");
    expect(body.text).toContain("https://deploy.example.test");
    expect(body.parse_mode).toBeUndefined();
    expect(body.message_thread_id).toBeUndefined();
    expect(kv.store.get("delivered:event-1:telegram")).toBe("1");
  });

  it("supports an optional topic and a channel username", async () => {
    const { env } = createTestEnv({ ...settings, TELEGRAM_CHAT_ID: "@example_channel", TELEGRAM_MESSAGE_THREAD_ID: "42" });
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetch);
    await dispatchEvent(env as never, deploymentEvent() as never);
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toMatchObject({ chat_id: "@example_channel", message_thread_id: 42 });
  });

  it("bounds long messages without splitting a surrogate pair", async () => {
    const { env } = createTestEnv(settings);
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetch);
    await dispatchEvent(env as never, deploymentEvent({ project: "🙂".repeat(3000) }) as never);
    const text = JSON.parse(fetch.mock.calls[0]![1].body).text;
    expect(text.length).toBeLessThanOrEqual(4096);
    expect(text.endsWith("…")).toBe(true);
    expect(text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it.each([
    { TELEGRAM_BOT_TOKEN: "token" },
    { TELEGRAM_CHAT_ID: "123" },
    { TELEGRAM_MESSAGE_THREAD_ID: "42" },
    { ...settings, TELEGRAM_CHAT_ID: "not-a-chat" },
    { ...settings, TELEGRAM_MESSAGE_THREAD_ID: "0" },
    { ...settings, TELEGRAM_MESSAGE_THREAD_ID: "-1" },
    { ...settings, TELEGRAM_MESSAGE_THREAD_ID: "1.5" },
    { ...settings, TELEGRAM_MESSAGE_THREAD_ID: "9007199254740992" },
  ])("reports incomplete/invalid Telegram configuration without silently ignoring it: %j", async (config) => {
    const { env } = createTestEnv({ ...config, DISCORD_WEBHOOK_URL: "https://discord.example.test" });
    expect(getReadiness(env as never).ok).toBe(false);
    expect(getReadiness(env as never).issues.join(" ")).toContain("TELEGRAM_");
    await expect(dispatchEvent(env as never, deploymentEvent() as never)).rejects.toThrow("TELEGRAM_");
  });

  it("is ready with Telegram as the only destination", () => {
    const { env } = createTestEnv(settings);
    expect(getReadiness(env as never)).toMatchObject({ ok: true, checks: { destinations: 1 } });
  });

  it.each([400, 429, 500])("retries HTTP %s without storing a Telegram receipt", async (status) => {
    const { env, kv } = createTestEnv(settings);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ok: false, error_code: status }, { status })));
    const message = { body: { kind: "deployment-event", event: deploymentEvent() }, ack: vi.fn(), retry: vi.fn() };
    await handleQueue({ messages: [message] } as never, env as never);
    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
    expect(message.ack).not.toHaveBeenCalled();
    expect(kv.store.has("delivered:event-1:telegram")).toBe(false);
    expect(kv.store.has("processed:event-1")).toBe(false);
  });

  it("rejects API-level failures even with HTTP 200 and hides provider error text", async () => {
    const { env } = createTestEnv(settings);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ok: false, error_code: 400, description: settings.TELEGRAM_BOT_TOKEN })));
    await expect(dispatchEvent(env as never, deploymentEvent() as never)).rejects.toThrow("Telegram sendMessage failed (HTTP 200, API code 400)");
  });

  it("rejects malformed responses and hides token-bearing transport errors", async () => {
    const { env } = createTestEnv(settings);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not JSON")));
    await expect(dispatchEvent(env as never, deploymentEvent() as never)).rejects.toThrow("Telegram sendMessage failed");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error(`failed URL with ${settings.TELEGRAM_BOT_TOKEN}`)));
    await expect(dispatchEvent(env as never, deploymentEvent() as never)).rejects.toThrow(/^Telegram sendMessage request failed$/);
  });

  it("does not redeliver Discord when Telegram fails and retries", async () => {
    const { env, kv } = createTestEnv({ ...settings, DISCORD_WEBHOOK_URL: "https://discord.example.test" });
    const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json({ ok: false }, { status: 429 }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetch);
    await expect(dispatchEvent(env as never, deploymentEvent() as never)).rejects.toThrow("Telegram");
    expect(kv.store.get("delivered:event-1:discord")).toBe("1");
    await dispatchEvent(env as never, deploymentEvent() as never);
    await dispatchEvent(env as never, deploymentEvent() as never);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(kv.store.get("delivered:event-1:telegram")).toBe("1");
  });

  it("redacts Telegram tokens in captured error summaries", () => {
    const { env } = createTestEnv(settings);
    const result = sanitizeErrorSummary(`TELEGRAM_BOT_TOKEN=${settings.TELEGRAM_BOT_TOKEN} https://api.telegram.org/bot${settings.TELEGRAM_BOT_TOKEN}/sendMessage`, env as never);
    expect(result).not.toContain(settings.TELEGRAM_BOT_TOKEN);
    expect(result).toContain("[REDACTED]");
  });
});
