import { configuredDestinations } from "./destinations";
import { parseProjectsJson } from "./config";
import type { Env } from "./types";

export type ReadinessReport = {
  ok: boolean;
  checks: {
    stateBinding: boolean;
    queueBinding: boolean;
    destinations: number;
    projectsConfigValid: boolean;
    cloudflareApiConfigured: boolean;
  };
  issues: string[];
  warnings: string[];
};

export function getReadiness(env: Env): ReadinessReport {
  const issues: string[] = [];
  const warnings: string[] = [];
  const parsed = parseProjectsJson(env.PROJECTS_JSON);
  const projects = parsed.projects;
  const destinations = configuredDestinations(env);

  if (!env.STATE) issues.push("STATE KV binding is unavailable");
  if (!env.EVENTS) issues.push("EVENTS Queue binding is unavailable");
  if (destinations.length === 0) issues.push("no notification destination is configured");
  if (parsed.error) issues.push(parsed.error);

  const needsCloudflareApi = projects.some(
    (project) => project.product === "pages" || (project.product === "workers" && project.reconcile === true),
  );
  const cloudflareApiConfigured = Boolean(env.CLOUDFLARE_ACCOUNT_ID?.trim() && env.CLOUDFLARE_API_TOKEN?.trim());
  if (needsCloudflareApi && !cloudflareApiConfigured) {
    issues.push("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required by the configured polling/reconciliation projects");
  }

  if (!env.INGEST_SHARED_SECRET?.trim()) {
    warnings.push("CI ingestion and /v1/test are disabled because INGEST_SHARED_SECRET is not configured");
  }
  if (projects.length === 0) {
    warnings.push("PROJECTS_JSON contains no enabled projects; only direct CI ingestion can emit deployment events");
  }

  return {
    ok: issues.length === 0,
    checks: {
      stateBinding: Boolean(env.STATE),
      queueBinding: Boolean(env.EVENTS),
      destinations: destinations.length,
      projectsConfigValid: !parsed.error,
      cloudflareApiConfigured,
    },
    issues,
    warnings,
  };
}

