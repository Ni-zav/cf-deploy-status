import type { DeploymentEvent, Env, WorkersBuildEvent } from "../types";
import { sanitizeErrorSummary } from "../utils";

const API = "https://api.cloudflare.com/client/v4";
const MAX_LOG_PAGES = 10;

export async function enrichWorkersBuildEvent(raw: WorkersBuildEvent, event: DeploymentEvent, env: Env): Promise<DeploymentEvent> {
  const accountId = raw.metadata?.accountId ?? env.CLOUDFLARE_ACCOUNT_ID;
  const buildId = raw.payload?.buildUuid;
  if (accountId && buildId) {
    event.dashboardUrl = `https://dash.cloudflare.com/${accountId}/workers/services/view/${encodeURIComponent(event.project)}/production/builds/${buildId}`;
  }
  if (!accountId || !buildId || !env.CLOUDFLARE_API_TOKEN) return event;

  if (event.status === "succeeded") {
    const deploymentUrl = await fetchBuildUrl(accountId, buildId, event.project, env.CLOUDFLARE_API_TOKEN);
    if (deploymentUrl) event.deploymentUrl = deploymentUrl;
  } else if (event.status === "failed") {
    const logs = await fetchBuildLogs(accountId, buildId, env.CLOUDFLARE_API_TOKEN);
    const extracted = extractBuildError(logs);
    if (extracted) {
      const sanitized = sanitizeErrorSummary(extracted, env);
      if (sanitized) event.errorSummary = sanitized;
    }
  }
  return event;
}

async function fetchBuildUrl(accountId: string, buildId: string, workerName: string, token: string): Promise<string | undefined> {
  try {
    const buildResponse = await fetch(`${API}/accounts/${accountId}/builds/builds/${buildId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (buildResponse.ok) {
      const body = await buildResponse.json() as { result?: { preview_url?: string } };
      if (body.result?.preview_url) return body.result.preview_url;
    }

    const subdomainResponse = await fetch(`${API}/accounts/${accountId}/workers/subdomain`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (subdomainResponse.ok) {
      const body = await subdomainResponse.json() as { result?: { subdomain?: string } };
      if (body.result?.subdomain) return `https://${workerName}.${body.result.subdomain}.workers.dev`;
    }
  } catch (error) {
    console.warn("Unable to enrich Workers deployment URL", { buildId, error: String(error) });
  }
  return undefined;
}

async function fetchBuildLogs(accountId: string, buildId: string, token: string): Promise<string[]> {
  const logs: string[] = [];
  let cursor: string | undefined;
  try {
    for (let page = 0; page < MAX_LOG_PAGES; page += 1) {
      const suffix = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
      const response = await fetch(`${API}/accounts/${accountId}/builds/builds/${buildId}/logs${suffix}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!response.ok) break;
      const body = await response.json() as {
        result?: { lines?: Array<[number, string]>; truncated?: boolean; cursor?: string };
      };
      for (const line of body.result?.lines ?? []) {
        if (typeof line[1] === "string") logs.push(line[1]);
      }
      if (!body.result?.truncated || !body.result.cursor) break;
      cursor = body.result.cursor;
    }
  } catch (error) {
    console.warn("Unable to fetch Workers build logs", { buildId, error: String(error) });
  }
  return logs;
}

const IGNORE = [
  /^Total Upload:/i,
  /^Total Size:/i,
  /\/\s*gzip:/i,
  /^Uploaded/i,
  /^Published/i,
  /^Worker Startup Time:/i,
  /^🌀/,
];
const PRIMARY = [/^✘\s*\[ERROR\]/i, /^\[ERROR\]/i, /^ERROR:/i, /^Error:/, /^❌/];
const KEYWORDS = ["Module not found", "Cannot find module", "Compilation failed", "Build failed", "SyntaxError:", "TypeError:", "ReferenceError:", "failed to", "Failed to"];

export function extractBuildError(logs: string[]): string | undefined {
  for (let i = 0; i < logs.length; i += 1) {
    const line = logs[i]?.trim();
    if (!line || line.startsWith("at ") || IGNORE.some((pattern) => pattern.test(line))) continue;
    if (PRIMARY.some((pattern) => pattern.test(line))) {
      const next = logs[i + 1]?.trim();
      return next && !next.startsWith("at ") && !IGNORE.some((pattern) => pattern.test(next)) ? `${line}\n${next}` : line;
    }
  }
  for (const raw of logs) {
    const line = raw.trim();
    if (line && !IGNORE.some((pattern) => pattern.test(line)) && KEYWORDS.some((keyword) => line.includes(keyword))) return line;
  }
  for (let i = logs.length - 1; i >= 0; i -= 1) {
    const line = logs[i]?.trim();
    if (line && !IGNORE.some((pattern) => pattern.test(line))) return line;
  }
  return undefined;
}
