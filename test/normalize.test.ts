import { describe, expect, it } from "vitest";
import { resolveEnvironment } from "../src/config";
import { normalizeCiPayload } from "../src/sources/ci";
import { deploymentToEvent } from "../src/sources/pages-api";
import { normalizeWorkersBuildEvent } from "../src/sources/workers-builds";
import { normalizeStatus, timingSafeEqual } from "../src/utils";
import type { Env, ProjectConfig } from "../src/types";

const env = (overrides: Partial<Env> = {}): Env => ({
  STATE: {} as KVNamespace,
  EVENTS: {} as Queue<unknown>,
  PROJECTS_JSON: JSON.stringify([
    { product: "workers", name: "api", branchEnvironmentMap: { main: "production", staging: "staging" } },
    { product: "pages", name: "site", branchEnvironmentMap: { main: "production", staging: "staging" } }
  ]),
  ...overrides,
});

describe("normalization", () => {
  it("maps provider statuses", () => {
    expect(normalizeStatus("active")).toBe("started");
    expect(normalizeStatus("success")).toBe("succeeded");
    expect(normalizeStatus("failure")).toBe("failed");
    expect(normalizeStatus("cancelled")).toBe("canceled");
    expect(normalizeStatus("skipped")).toBe("skipped");
  });

  it("maps preview staging branch to staging", () => {
    const project: ProjectConfig = {
      product: "pages",
      name: "site",
      branchEnvironmentMap: { main: "production", staging: "staging" },
      defaultPreviewEnvironment: "preview",
    };
    expect(resolveEnvironment(project, "staging", "preview")).toBe("staging");
  });

  it("normalizes Workers Builds success", () => {
    const event = normalizeWorkersBuildEvent({
      type: "cf.workersBuilds.worker.build.succeeded",
      source: { type: "workersBuilds.worker", workerName: "api" },
      payload: {
        buildUuid: "build-1",
        buildOutcome: "success",
        runningAt: "2026-10-02T00:00:01Z",
        stoppedAt: "2026-10-02T00:00:11Z",
        buildTriggerMetadata: { branch: "staging", commitHash: "abcdef123456" },
      },
    }, env());
    expect(event?.status).toBe("succeeded");
    expect(event?.environment).toBe("staging");
    expect(event?.durationMs).toBe(10_000);
    expect(event?.eventId).toBe("workers-build:build-1:succeeded");
  });

  it.each(["canceled", "cancelled"])("preserves %s outcomes on Workers Builds failure events", (buildOutcome) => {
    const event = normalizeWorkersBuildEvent({
      type: "cf.workersBuilds.worker.build.failed",
      source: { type: "workersBuilds.worker", workerName: "api" },
      payload: { buildUuid: "build-cancel", buildOutcome },
    }, env());
    expect(event?.status).toBe("canceled");
    expect(event?.eventId).toBe("workers-build:build-cancel:canceled");
    expect(event?.errorSummary).toBeUndefined();
  });

  it("normalizes Pages deployment", () => {
    const project: ProjectConfig = {
      product: "pages",
      name: "site",
      branchEnvironmentMap: { staging: "staging" },
    };
    const event = deploymentToEvent({
      id: "dep-1",
      project_name: "site",
      environment: "preview",
      latest_stage: { status: "success", started_on: "2026-10-02T01:00:00Z", ended_on: "2026-10-02T01:00:30Z" },
      deployment_trigger: { metadata: { branch: "staging", commit_hash: "12345678" } },
    }, project);
    expect(event?.status).toBe("succeeded");
    expect(event?.providerEnvironment).toBe("preview");
    expect(event?.environment).toBe("staging");
  });

  it("creates deterministic CI event id", () => {
    const event = normalizeCiPayload({
      product: "workers",
      project: "api",
      status: "failed",
      branch: "staging",
      repo: "Ni-zav/example",
      runId: "42",
      job: "deploy",
    }, env());
    expect(event.eventId).toBe("ci:Ni-zav/example:42:deploy:api:failed");
    expect(event.environment).toBe("staging");
  });

  it("compares secrets", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcx")).toBe(false);
  });
});
