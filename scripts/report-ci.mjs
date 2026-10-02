import fs from "node:fs";
const input = (name) => process.env[`INPUT_${name.toUpperCase().replace(/-/g, "_")}`] ?? "";
const required = (name) => {
  const value = input(name).trim();
  if (!value) throw new Error(`missing required input: ${name}`);
  return value;
};
const optional = (name, fallback = "") => input(name).trim() || fallback;

function sanitize(value) {
  if (!value) return undefined;
  return value
    .replace(/(authorization:\s*bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/(CLOUDFLARE_API_TOKEN\s*[=:]\s*)[^\s]+/gi, "$1[REDACTED]")
    .replace(/https:\/\/discord(?:app)?\.com\/api\/webhooks\/[^\s]+/gi, "[REDACTED_DISCORD_WEBHOOK]")
    .replace(/https:\/\/hooks\.slack\.com\/services\/[^\s]+/gi, "[REDACTED_SLACK_WEBHOOK]")
    .slice(0, 4000);
}

function setOutput(name, value) {
  const path = process.env.GITHUB_OUTPUT;
  if (!path) return;
  fs.appendFileSync(path, `${name}=${String(value).replace(/\n/g, "%0A")}\n`);
}

async function main() {
  const endpoint = required("endpoint").replace(/\/$/, "");
  const token = required("token");
  const payload = {
    product: required("product"),
    project: required("project"),
    status: required("status"),
    environment: optional("environment") || undefined,
    providerEnvironment: optional("provider-environment") || undefined,
    branch: optional("branch", process.env.GITHUB_REF_NAME ?? "") || undefined,
    deploymentId: optional("deployment-id") || undefined,
    buildId: optional("build-id") || undefined,
    deploymentUrl: optional("deployment-url") || undefined,
    commitSha: optional("commit-sha", process.env.GITHUB_SHA ?? "") || undefined,
    commitMessage: optional("commit-message") || undefined,
    actor: optional("actor", process.env.GITHUB_ACTOR ?? "") || undefined,
    source: optional("source", "github-actions"),
    errorSummary: sanitize(optional("error-summary")),
    repo: optional("repo", process.env.GITHUB_REPOSITORY ?? "") || undefined,
    runId: optional("run-id", process.env.GITHUB_RUN_ID ?? "") || undefined,
    job: optional("job", process.env.GITHUB_JOB ?? "") || undefined,
  };
  Object.keys(payload).forEach((key) => payload[key] === undefined && delete payload[key]);

  const response = await fetch(`${endpoint}/v1/events/ci`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "cf-deploy-status-action/1.0",
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`cf-deploy-status returned ${response.status}: ${text}`);
  let body = {};
  try { body = JSON.parse(text); } catch {}
  console.log(`cf-deploy-status accepted event ${body.eventId ?? ""}`.trim());
  setOutput("reported", "true");
  if (body.eventId) setOutput("event-id", body.eventId);
}

main().catch((error) => {
  console.error(`cf-deploy-status report failed: ${error.message}`);
  setOutput("reported", "false");
  if (["1", "true", "yes"].includes(optional("fail-on-error", "false").toLowerCase())) process.exitCode = 1;
});
