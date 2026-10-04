import { spawnSync } from "node:child_process";

const workers = process.argv.slice(2).map((value) => value.trim()).filter(Boolean);
const queue = process.env.CF_DEPLOY_QUEUE || "cf-deploy-events";
const config = process.env.WRANGLER_CONFIG;

if (workers.length === 0) {
  console.error("Usage: npm run subscribe:workers -- worker-a worker-b");
  process.exit(2);
}

function wranglerArgs(args) {
  const result = ["wrangler", ...args];
  if (config) result.push("--config", config);
  return result;
}

function run(args, options = {}) {
  return spawnSync("npx", wranglerArgs(args), {
    encoding: options.capture ? "utf8" : undefined,
    stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit",
    shell: process.platform === "win32",
  });
}

const listed = run(["queues", "subscription", "list", queue, "--json", "--per-page", "100"], { capture: true });
if (listed.status !== 0) process.exit(listed.status ?? 1);

let payload;
try {
  payload = JSON.parse(listed.stdout || "[]");
} catch (error) {
  console.error("Unable to parse Wrangler subscription list JSON", error);
  process.exit(1);
}

const subscriptions = Array.isArray(payload)
  ? payload
  : Array.isArray(payload?.result)
    ? payload.result
    : Array.isArray(payload?.subscriptions)
      ? payload.subscriptions
      : [];

const existingNames = new Set(
  subscriptions
    .map((subscription) => subscription?.name)
    .filter((name) => typeof name === "string"),
);

for (const worker of workers) {
  const name = `cf-deploy-status-${worker}`;
  if (existingNames.has(name)) {
    console.log(`Workers Builds subscription already exists: ${name}`);
    continue;
  }

  const result = run([
    "queues", "subscription", "create", queue,
    "--source", "workersBuilds.worker",
    "--events", "build.started,build.succeeded,build.failed,build.canceled",
    "--worker-name", worker,
    "--name", name,
  ]);
  if (result.status !== 0) process.exit(result.status ?? 1);
  existingNames.add(name);
}
