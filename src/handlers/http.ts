import { getReadiness } from "../readiness";
import { normalizeCiPayload } from "../sources/ci";
import { normalizePagesWebhook } from "../sources/pages-webhook";
import type { CiPayload, Env, NormalizedQueueMessage, PagesWebhookPayload } from "../types";
import { json, parseJsonBody, readBearer, timingSafeEqual } from "../utils";

const VERSION = "1.0.0";

export async function handleHttp(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/") {
    return json({
      ok: true,
      service: "cf-deploy-status",
      version: VERSION,
      endpoints: ["/healthz", "/readyz", "/v1/events/ci", "/v1/events/cloudflare/pages", "/v1/test"],
      now: new Date().toISOString(),
    });
  }

  if (request.method === "GET" && url.pathname === "/healthz") {
    return json({ ok: true, service: "cf-deploy-status", version: VERSION, now: new Date().toISOString() });
  }

  if (request.method === "GET" && url.pathname === "/readyz") {
    const readiness = getReadiness(env);
    return json({ ...readiness, service: "cf-deploy-status", version: VERSION, now: new Date().toISOString() }, readiness.ok ? 200 : 503);
  }

  if (request.method === "POST" && url.pathname === "/v1/events/ci") {
    if (!env.INGEST_SHARED_SECRET) return json({ ok: false, error: "INGEST_SHARED_SECRET is not configured" }, 503);
    if (!timingSafeEqual(readBearer(request), env.INGEST_SHARED_SECRET)) return json({ ok: false, error: "unauthorized" }, 401);
    try {
      const payload = await parseJsonBody<CiPayload>(request);
      const event = normalizeCiPayload(payload, env);
      await enqueue(env, event);
      return json({ ok: true, eventId: event.eventId }, 202);
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
  }

  if (request.method === "POST" && url.pathname === "/v1/events/cloudflare/pages") {
    if (!env.PAGES_WEBHOOK_SECRET) return json({ ok: false, error: "PAGES_WEBHOOK_SECRET is not configured" }, 503);
    if (!timingSafeEqual(request.headers.get("cf-webhook-auth"), env.PAGES_WEBHOOK_SECRET)) return json({ ok: false, error: "unauthorized" }, 401);
    try {
      const payload = await parseJsonBody<PagesWebhookPayload>(request);
      const event = normalizePagesWebhook(payload, env);
      await enqueue(env, event);
      return json({ ok: true, eventId: event.eventId }, 202);
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
  }

  if (request.method === "POST" && url.pathname === "/v1/test") {
    if (!env.INGEST_SHARED_SECRET) return json({ ok: false, error: "INGEST_SHARED_SECRET is not configured" }, 503);
    if (!timingSafeEqual(readBearer(request), env.INGEST_SHARED_SECRET)) return json({ ok: false, error: "unauthorized" }, 401);
    const partial: Partial<CiPayload> = await parseJsonBody<Partial<CiPayload>>(request).catch(() => ({} as Partial<CiPayload>));
    const payload: CiPayload = {
      product: partial.product ?? "workers",
      project: partial.project ?? "cf-deploy-status-test",
      status: partial.status ?? "succeeded",
      environment: partial.environment ?? "test",
      branch: partial.branch ?? "main",
      commitSha: partial.commitSha ?? "0123456789abcdef",
      source: "github-actions",
      runId: `test-${Date.now()}`,
      job: "test",
    };
    if (partial.errorSummary) payload.errorSummary = partial.errorSummary;
    try {
      const event = normalizeCiPayload(payload, env);
      event.source = "test";
      event.eventId = `test:${Date.now()}`;
      await enqueue(env, event);
      return json({ ok: true, eventId: event.eventId }, 202);
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
  }

  return json({ ok: false, error: "not found" }, 404);
}

async function enqueue(env: Env, event: NormalizedQueueMessage["event"]): Promise<void> {
  await env.EVENTS.send({ kind: "deployment-event", event } satisfies NormalizedQueueMessage);
}
