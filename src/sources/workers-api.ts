import { envFlag, getProjects, resolveEnvironment } from "../config";
import { getState, putState } from "../state/kv";
import type { DeploymentEvent, Env, ProjectConfig, WorkersDeployment } from "../types";

const API = "https://api.cloudflare.com/client/v4";

export async function reconcileWorkers(env: Env): Promise<void> {
  const projects = getProjects(env).filter((project) => project.product === "workers" && project.reconcile === true);
  if (projects.length === 0) return;
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) {
    console.warn("Workers reconciliation skipped: CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_API_TOKEN not configured");
    return;
  }

  for (const project of projects) {
    try {
      await reconcileWorker(env, project);
    } catch (error) {
      console.error("Workers reconciliation failed", { project: project.name, error: String(error) });
    }
  }
}

async function reconcileWorker(env: Env, project: ProjectConfig): Promise<void> {
  const url = `${API}/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID!)}/workers/scripts/${encodeURIComponent(project.name)}/deployments`;
  const response = await fetch(url, { headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` } });
  if (!response.ok) throw new Error(`Cloudflare Workers API ${response.status}: ${await response.text()}`);
  const body = (await response.json()) as { result?: { deployments?: WorkersDeployment[] } };
  const latest = body.result?.deployments?.[0];
  if (!latest?.id) return;

  const key = `workers:last:${project.name}`;
  const previous = await getState(env, key);
  if (!previous) {
    await putState(env, key, latest.id);
    if (envFlag(env.NOTIFY_ON_BOOTSTRAP, false)) await env.EVENTS.send({ kind: "deployment-event", event: workerDeploymentToEvent(latest, project) });
    return;
  }
  if (previous === latest.id) return;
  await env.EVENTS.send({ kind: "deployment-event", event: workerDeploymentToEvent(latest, project) });
  await putState(env, key, latest.id);
}

export function workerDeploymentToEvent(deployment: WorkersDeployment, project: ProjectConfig): DeploymentEvent {
  const annotations = deployment.annotations ?? {};
  const event: DeploymentEvent = {
    eventId: `workers-deployment:${deployment.id}:succeeded`,
    provider: "cloudflare",
    product: "workers",
    project: project.name,
    status: "succeeded",
    environment: resolveEnvironment(project, undefined, undefined),
    source: "workers-api",
    deploymentId: deployment.id!,
    observedAt: deployment.created_on ?? new Date().toISOString(),
  };
  if (deployment.author_email) event.actor = deployment.author_email;
  if (deployment.created_on) event.finishedAt = deployment.created_on;
  const message = annotations["workers/message"];
  if (message) event.commitMessage = message;
  return event;
}
