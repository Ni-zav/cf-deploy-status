import { describe, expect, it } from "vitest";
import { handleHttp } from "../src/handlers/http";
import { createTestEnv } from "./helpers";

describe("HTTP handlers", () => {
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
