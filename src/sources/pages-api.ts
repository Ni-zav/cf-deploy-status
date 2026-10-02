import { envFlag, getProjects, resolveEnvironment } from "../config";
import { getState, putState } from "../state/kv";
import type { DeploymentEvent, Env, PagesDeployment, ProjectConfig } from "../types";
import { durationMs, normalizeStatus } from "../utils";

const API = "https://api.cloudflare.com/client/v4";

export async function pollPages(env: Env): Promise<void> {
  const projects = getProjects(env).filter((project) => project.product === "pages");
  if (projects.length === 0) return;
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) {
    console.warn("Pages polling skipped: CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_API_TOKEN not configured");
    return;
  }

  for (const project of projects) {
    try {
      await pollPagesProject(env, project);
    } catch (error) {
      console.error("Pages polling failed", { project: project.name, error: String(error) });
    }
  }
}

async function pollPagesProject(env: Env, project: ProjectConfig): Promise<void> {
  const url = `${API}/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID!)}/pages/projects/${encodeURIComponent(project.name)}/deployments?per_page=10`;
  const response = await fetch(url, { headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` } });
  if (!response.ok) throw new Error(`Cloudflare Pages API ${response.status}: ${await response.text()}`);
  const body = (await response.json()) as { success?: boolean; result?: PagesDeployment[] };
  const deployments = body.result ?? [];
  if (deployments.length === 0) return;

  const bootstrapKey = `pages:bootstrap:${project.name}`;
  const bootstrapped = (await getState(env, bootstrapKey)) === "1";
  const notifyOnBootstrap = envFlag(env.NOTIFY_ON_BOOTSTRAP, false);

  if (!bootstrapped) {
    for (const deployment of deployments) {
      const id = deployment.id;
      const rawStatus = deployment.latest_stage?.status;
      if (id && rawStatus) await putState(env, `pages:status:${project.name}:${id}`, rawStatus);
    }
    await putState(env, bootstrapKey, "1");
    if (notifyOnBootstrap) {
      const event = deploymentToEvent(deployments[0]!, project);
      if (event) await env.EVENTS.send({ kind: "deployment-event", event });
    }
    return;
  }

  for (const deployment of deployments) {
    const id = deployment.id;
    const rawStatus = deployment.latest_stage?.status;
    if (!id || !rawStatus) continue;
    const key = `pages:status:${project.name}:${id}`;
    const previous = await getState(env, key);
    if (previous !== rawStatus) {
      const event = deploymentToEvent(deployment, project);
      if (event) await env.EVENTS.send({ kind: "deployment-event", event });
      await putState(env, key, rawStatus);
    }
  }
}

export function deploymentToEvent(deployment: PagesDeployment, project: ProjectConfig): DeploymentEvent | null {
  const status = normalizeStatus(deployment.latest_stage?.status);
  if (!status || !deployment.id) return null;
  const branch = deployment.deployment_trigger?.metadata?.branch;
  const providerEnvironment = deployment.environment;
  const startedAt = deployment.latest_stage?.started_on ?? deployment.created_on;
  const finishedAt = deployment.latest_stage?.ended_on ?? (status === "started" ? undefined : deployment.modified_on);

  const event: DeploymentEvent = {
    eventId: `pages:${deployment.id}:${status}`,
    provider: "cloudflare",
    product: "pages",
    project: deployment.project_name ?? project.name,
    status,
    environment: resolveEnvironment(project, branch, providerEnvironment),
    source: "pages-api",
    deploymentId: deployment.id,
    observedAt: deployment.modified_on ?? new Date().toISOString(),
  };
  if (providerEnvironment) event.providerEnvironment = providerEnvironment;
  if (branch) event.branch = branch;
  if (deployment.url) event.deploymentUrl = deployment.url;
  const commitSha = deployment.deployment_trigger?.metadata?.commit_hash;
  const commmitMessage = deployment.deployment_trigger?.metadata?.commit_message;
  if (commitSha) event.commitSha = commitSha;
  if (commitMessage) event.commitMessage = commitMessage;
  if (startedAt) event.startedAt = startedAt;
  if (finishedAt) event.finishedAt = finishedAt;
  const elapsed = durationMs(startedAt, finishedAt);
  if (elapsed !== undefined) event.durationMs = elapsed;
  if (status === "failed") event.errorSummary = `Cloudflare Pages stage ${deployment.latest_stage?.name ?? "deployment"} failed`;
  return event;
}
