import { findProject, resolveEnvironment } from "../config";
import type { DeploymentEvent, Env, WorkersBuildEvent } from "../types";
import { durationMs, normalizeStatus, sanitizeErrorSummary } from "../utils";

export function isWorkersBuildEvent(value: unknown): value is WorkersBuildEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as WorkersBuildEvent;
  return event.source?.type === "workersBuilds.worker" || event.type?.includes("workersBuilds.worker") === true;
}

export function normalizeWorkersBuildEvent(raw: WorkersBuildEvent, env: Env): DeploymentEvent | null {
  const workerName = raw.source?.workerName;
  const buildId = raw.payload?.buildUuid;
  if (!workerName || !buildId) return null;

  let status = normalizeStatus(raw.payload?.buildOutcome ?? raw.payload?.status ?? undefined);
  const type = raw.type?.toLowerCase() ?? "";
  if (type.endsWith(".build.started")) status = "started";
  else if (type.endsWith(".build.succeeded")) status = "succeeded";
  else if (type.endsWith(".build.failed")) status = raw.payload?.buildOutcome === "canceled" ? "canceled" : "failed";
  else if (type.endsWith(".build.canceled") || type.endsWith(".build.cancelled")) status = "canceled";
  if (!status) return null;

  const meta = raw.payload?.buildTriggerMetadata;
  const project = findProject(env, "workers", workerName);
  const observedAt = raw.metadata?.eventTimestamp ?? new Date().toISOString();
  const startedAt = raw.payload?.runningAt ?? raw.payload?.initializingAt ?? raw.payload?.createdAt;
  const finishedAt = raw.payload?.stoppedAt ?? undefined;

  const event: DeploymentEvent = {
    eventId: `workers-build:${buildId}:${status}`,
    provider: "cloudflare",
    product: "workers",
    project: workerName,
    status,
    environment: resolveEnvironment(project, meta?.branch, undefined),
    source: "workers-builds",
    buildId,
    observedAt,
  };

  if (meta?.branch) event.branch = meta.branch;
  if (meta?.commitHash) event.commitSha = meta.commitHash;
  if (meta?.commitMessage) event.commitMessage = meta.commitMessage;
  if (meta?.author) event.actor = meta.author;
  if (meta?.repoName) event.repo = meta.repoName;
  if (startedAt) event.startedAt = startedAt;
  if (finishedAt) event.finishedAt = finishedAt;
  const elapsed = durationMs(startedAt, finishedAt);
  if (elapsed !== undefined) event.durationMs = elapsed;
  if (status === "failed") {
    const errorSummary = sanitizeErrorSummary(
      `Workers Build failed${meta?.buildCommand ? ` while running: ${meta.buildCommand}` : ""}`,
      env,
    );
    if (errorSummary) event.errorSummary = errorSummary;
  }
  return event;
}
