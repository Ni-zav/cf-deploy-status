import { afterEach, describe, expect, it, vi } from "vitest";
import { pollPages } from "../src/sources/pages-api";
import { reconcileWorkers } from "../src/sources/workers-api";
import { createTestEnv } from "./helpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Cloudflare API reconciliation", () => {
  it("seeds Pages state without replaying old deployments, then emits a state change", async () => {
    const { env, send, kv } = createTestEnv({
      CLOUDFLARE_ACCOUNT_ID: "account-1",
      CLOUDFLARE_API_TOKEN: "token-1",
      PROJECTS_JSON: JSON.stringify([{ product: "pages", name: "site" }]),
    });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        result: [{
          id: "dep-1",
          project_name: "site",
          environment: "production",
          latest_stage: { status: "queued" },
          modified_on: "2026-10-04T00:00:00Z",
        }],
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        result: [{
          id: "dep-1",
          project_name: "site",
          environment: "production",
          latest_stage: {
            status: "success",
            started_on: "2026-10-04T00:00:00Z",
            ended_on: "2026-10-04T00:00:12Z",
          },
          modified_on: "2026-10-04T00:00:12Z",
        }],
      }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await pollPages(env as never);
    expect(send).not.toHaveBeenCalled();
    expect(kv.store.get("pages:bootstrap:site")).toBe("1");
    expect(kv.store.get("pages:status:site:dep-1")).toBe("queued");

    await pollPages(env as never);
    expect(send).toHaveBeenCalledTimes(1);
    const queued = send.mock.calls[0]![0] as any;
    expect(queued.event.eventId).toBe("pages:dep-1:succeeded");
    expect(queued.event.durationMs).toBe(12_000);
  });

  it("seeds Workers deployment history then emits a newly observed deployment", async () => {
    const { env, send, kv } = createTestEnv({
      CLOUDFLARE_ACCOUNT_ID: "account-1",
      CLOUDFLARE_API_TOKEN: "token-1",
      PROJECTS_JSON: JSON.stringify([{
        product: "workers",
        name: "api",
        environment: "production",
        reconcile: true,
      }]),
    });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        result: [{ id: "deploy-1", created_on: "2026-10-04T00:00:00Z" }],
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        result: [{
          id: "deploy-2",
          created_on: "2026-10-04T00:05:00Z",
          author_email: "dev@example.test",
          annotations: { "workers/message": "release" },
        }],
      }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await reconcileWorkers(env as never);
    expect(send).not.toHaveBeenCalled();
    expect(kv.store.get("workers:last:api")).toBe("deploy-1");

    await reconcileWorkers(env as never);
    expect(send).toHaveBeenCalledTimes(1);
    const queued = send.mock.calls[0]![0] as any;
    expect(queued.event.eventId).toBe("workers-deployment:deploy-2:succeeded");
    expect(queued.event.commitMessage).toBe("release");
  });
});
