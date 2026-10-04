import { describe, expect, it } from "vitest";
import { handleHttp } from "../src/handlers/http";
import { createTestEnv } from "./helpers";

describe("HTTP handlers", () => {
  const pagesTestText = "Hello World! This is a test message sent from https://cloudflare.com. If you can see this, your webhook is configured correctly.";

  it("acknowledges Cloudflare destination validation without enqueuing a deployment", async () => {
    const { env, send } = createTestEnv({ PAGES_WEBHOOK_SECRET: "pages-secret" });
    for (const text of [pagesTestText, pagesTestText.replace("correctly", "properly")]) {
      const response = await handleHttp(new Request("https://example.test/v1/events/cloudflare/pages", {
        method: "POST",
        headers: { "cf-webhook-auth": "pages-secret", "content-type": "application/json" },
        body: JSON.stringify({ text }),
      }), env as never);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, test: true });
    }
    expect(send).not.toHaveBeenCalled();
  });

  it("authenticates validation requests and rejects unrelated webhook payloads", async () => {
    const { env, send } = createTestEnv({ PAGES_WEBHOOK_SECRET: "pages-secret" });
    for (const [secret, payload, status] of [
      ["wrong", { text: pagesTestText }, 401],
      ["pages-secret", { text: "unrecognized validation request" }, 400],
      ["pages-secret", { text: pagesTestText, alert_type: "unrelated_alert" }, 400],
    ] as const) {
      const response = await handleHttp(new Request("https://example.test/v1/events/cloudflare/pages", {
        method: "POST", headers: { "cf-webhook-auth": secret, "content-type": "application/json" },
        body: JSON.stringify(payload),
      }), env as never);
      expect(response.status).toBe(status);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it("continues to enqueue real authenticated Pages deployment alerts", async () => {
    const { env, send } = createTestEnv({ PAGES_WEBHOOK_SECRET: "pages-secret" });
    const response = await handleHttp(new Request("https://example.test/v1/events/cloudflare/pages", {
      method: "POST", headers: { "cf-webhook-auth": "pages-secret", "content-type": "application/json" },
      body: JSON.stringify({ alert_type: "pages_event_alert", alert_event: "deployment_success", data: {
        project_name: "site", deployment_id: "preview-id", environment: "preview", branch: "test-preview",
      } }),
    }), env as never);
    expect(response.status).toBe(202);
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0]![0] as any).event.eventId).toBe("pages:preview-id:succeeded");
  });

  it("keeps liveness independent from configuration", async () => {
    const { env } = createTestEnv();
    const response = await handleHttp(new Request("https://example.test/healthz"), env as never);
    expect(response.status).toBe(200);
    expect((await response.json()).ok).toBe(true);
  });

  it("reports missing destinations as not ready", async () => {
    const { env } = createTestEnv();
    const response = await handleHttp(new Request("https://example.test/readyz"), env as never);
    const body = await response.json() as any;
    expect(response.status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.issues).toContain("no notification destination is configured");
  });

  it("is ready with a destination when no Cloudflare API-backed monitor is enabled", async () => {
    const { env } = createTestEnv({ GENERIC_WEBHOOK_URL: "https://hooks.example.test/deploy" });
    const response = await handleHttp(new Request("https://example.test/readyz"), env as never);
    const body = await response.json() as any;
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.checks.destinations).toBe(1);
    expect(body.warnings).toContain(
      "CI ingestion and /v1/test are disabled because INGEST_SHARED_SECRET is not configured",
    );
  });

  it("fails readiness when API-backed monitoring lacks Cloudflare read credentials", async () => {
    const { env } = createTestEnv({
      GENERIC_WEBHOOK_URL: "https://hooks.example.test/deploy",
      PROJECTS_JSON: JSON.stringify([{ product: "pages", name: "site" }]),
    });
    const response = await handleHttp(new Request("https://example.test/readyz"), env as never);
    const body = await response.json() as any;
    expect(response.status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.issues).toContain(
      "CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required by the configured polling/reconciliation projects",
    );
  });

  it("describes empty monitor configuration without excluding subscribed build events", async () => {
    const { env } = createTestEnv({
      GENERIC_WEBHOOK_URL: "https://hooks.example.test/deploy",
      INGEST_SHARED_SECRET: "test-secret",
    });
    const response = await handleHttp(new Request("https://example.test/readyz"), env as never);
    const body = await response.json() as any;
    expect(response.status).toBe(200);
    expect(body.warnings).toEqual([
      "PROJECTS_JSON contains no enabled projects; polling and reconciliation are disabled, but configured direct event sources remain available",
    ]);
  });

  it("fails readiness for malformed project configuration", async () => {
    const { env } = createTestEnv({
      GENERIC_WEBHOOK_URL: "https://hooks.example.test/deploy",
      PROJECTS_JSON: "{not-json",
    });
    const response = await handleHttp(new Request("https://example.test/readyz"), env as never);
    const body = await response.json() as any;
    expect(response.status).toBe(503);
    expect(body.checks.projectsConfigValid).toBe(false);
    expect(body.issues[0]).toContain("PROJECTS_JSON");
  });

  it("authenticates and enqueues direct CI reports", async () => {
    const { env, send } = createTestEnv({ INGEST_SHARED_SECRET: "top-secret" });
    const unauthorized = await handleHttp(
      new Request("https://example.test/v1/events/ci", {
        method: "POST",
        headers: {
          authorization: "Bearer wrong",
          "content-type": "application/json",
        },
        body: JSON.stringify({ product: "workers", project: "api", status: "succeeded" }),
      }),
      env as never,
    );
    expect(unauthorized.status).toBe(401);

    const accepted = await handleHttp(
      new Request("https://example.test/v1/events/ci", {
        method: "POST",
        headers: {
          authorization: "Bearer top-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          product: "workers",
          project: "api",
          status: "failed",
          environment: "staging",
          repo: "Ni-zav/example",
          runId: "42",
          job: "deploy",
          errorSummary: "deploy failed",
        }),
      }),
      env as never,
    );
    expect(accepted.status).toBe(202);
    expect(send).toHaveBeenCalledTimes(1);
    const queued = send.mock.calls[0]![0] as any;
    expect(queued.kind).toBe("deployment-event");
    expect(queued.event.eventId).toBe("ci:Ni-zav/example:42:deploy:api:failed");
  });
});
