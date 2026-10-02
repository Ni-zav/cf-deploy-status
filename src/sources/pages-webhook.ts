import { findProject, resolveEnvironment } from "../config";
import type { DeploymentEvent, Env, PagesWebhookPayload } from "../types";
import { normalizeStatus } from "../utils";

function stringValue(data: Record<string, unknown> | undefined, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = data?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function webhookStatus(payload: PagesWebhookPayload): ReturnType<typeof normalizeStatus> {
  const candidates = [payload.alert_event, stringValue(payload.data, "event", "status", "deployment_status"), payload.text, payload.name];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const lower = candidate.toLowerCase();
    if (lower.includes("fail")) return "failed";
    if (lower.includes("success")) return "succeeded";
    if (lower.includes("start")) return "started";
    if (lower.includes("cancel")) return "canceled";
    if (lower.includes("skip")) return "skipped";
    const normalized = normalizeStatus(candidate);
    if (normalized) return normalized;
  }
  return null;
}

export function normalizePagesWebhook(payload: PagesWebhookPayload, env: Env): DeploymentEvent {
  if (payload.alert_type && payload.alert_type !== "pages_event_alert") {
    throw new Error(`unexpected alert_type: ${payload.alert_type}`);
  }
  const status = webhookStatus(payload);
  if (!status) throw new Error("unable to determine Pages deployment status from webhook");

  const data = payload.data;
  const projectName = stringValue(data, "project_name", "projectName", "project") ?? payload.policy_name ?? "cloudflare-pages";
  const providerEnvironment = stringValue(data, "environment", "provider_environment");
  const branch = stringValue(data, "branch", "deployment_branch");
  const deploymentId = stringValue(data, "deployment_id", "deploymentId", "id");
  const correlationId = payload.alert_correlation_id ?? payload.policy_id ?? `${payload.ts ?? Date.now()}`;
  const project = findProject(env, "pages", projectName);

  const event: DeploymentEvent = {
    eventId: deploymentId ? `pages:${deploymentId}:${status}` : `pages-webhook:${correlationId}:${status}`,
    provider: "cloudflare",
    product: "pages",
    project: projectName,
    status,
    environment: resolveEnvironment(project, branch, providerEnvironment),
    source: "pages-notification",
    observedAt: payload.ts ? new Date(payload.ts * 1000).toISOString() : new Date().toISOString(),
  };
  const rawRef: { type?: string; correlationId?: string } = {};
  if (payload.alert_type) rawRef.type = payload.alert_type;
  if (payload.alert_correlation_id) rawRef.correlationId = payload.alert_correlation_id;
  if (Object.keys(rawRef).length > 0) event.rawRef = rawRef;

  if (providerEnvironment) event.providerEnvironment = providerEnvironment;
  if (branch) event.branch = branch;
  if (deploymentId) event.deploymentId = deploymentId;
  const deploymentUrl = stringValue(data, "deployment_url", "deploymentUrl", "url");
  const commitSha = stringValue(data, "commit_hash", "commitHash", "commit_sha");
  const commitMessage = stringValue(data, "commit_message", "commitMessage");
  if (deploymentUrl) event.deploymentUrl = deploymentUrl;
  if (commitSha) event.commitSha = commitSha;
  if (commitMessage) event.commitMessage = commitMessage;
  if (status === "failed" && payload.text) event.errorSummary = payload.text.slice(0, 1200);
  return event;
}
