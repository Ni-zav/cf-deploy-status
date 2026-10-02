import { findProject, resolveEnvironment } from "../config";
import type { CiPayload, DeploymentEvent, Env } from "../types";
import { normalizeStatus, sanitizeErrorSummary } from "../utils";

export function normalizeCiPayload(payload: CiPayload, env: Env): DeploymentEvent {
  if (payload.product !== "workers" && payload.product !== "pages") throw new Error("product must be workers or pages");
  if (!payload.project?.trim()) throw new Error("project is required");
  const status = normalizeStatus(payload.status);
  if (!status) throw new Error("status is invalid");

  const projectName = payload.project.trim();
  const project = findProject(env, payload.product, projectName);
  const source = payload.source === "wrangler-wrapper" ? "wrangler-wrapper" : "github-actions";
  const stableIdentity =
    payload.eventId?.trim() ||
    [payload.repo || "unknown-repo", payload.runId || "unknown-run", payload.job || "unknown-job", projectName, status].join(":");

  const event: DeploymentEvent = {
    eventId: payload.eventId?.trim() || `ci:${stableIdentity}`,
    provider: "cloudflare",
    product: payload.product,
    project: projectName,
    status,
    environment: resolveEnvironment(project, payload.branch, payload.providerEnvironment, payload.environment),
    source,
    observedAt: new Date().toISOString(),
  };

  if (payload.providerEnvironment) event.providerEnvironment = payload.providerEnvironment;
  if (payload.branch) event.branch = payload.branch;
  if (payload.deploymentId) event.deploymentId = payload.deploymentId;
  if (payload.buildId) event.buildId = payload.buildId;
  if (payload.deploymentUrl) event.deploymentUrl = payload.deploymentUrl;
  if (payload.commitSha) event.commitSha = payload.commitSha;
  if (payload.commitMessage) event.commitMessage = payload.commitMessage;
  if (payload.actor) event.actor = payload.actor;
  if (payload.startedAt) event.startedAt = payload.startedAt;
  if (payload.finishedAt) event.finishedAt = payload.finishedAt;
  if (payload.durationMs !== undefined) event.durationMs = payload.durationMs;
  if (payload.errorSummary) {
    const errorSummary = sanitizeErrorSummary(payload.errorSummary, env);
    if (errorSummary) event.errorSummary = errorSummary;
  }
  if (payload.repo) event.repo = payload.repo;
  if (payload.runId) event.runId = payload.runId;
  if (payload.job) event.job = payload.job;
  return event;
}
