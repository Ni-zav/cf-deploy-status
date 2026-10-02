import { spawnSync } from "node:child_process";

const workers = process.argv.slice(2);
if (workers.length === 0) {
  console.error("Usage: npm run subscribe:workers -- worker-a worker-b");
  process.exit(2);
}
for (const worker of workers) {
  const args = [
    "wrangler", "queues", "subscription", "create", "cf-deploy-events",
    "--source", "workersBuilds.worker",
    "--events", "build.started,build.succeeded,build.failed,build.canceled",
    "--worker-name", worker,
    "--name", `cf-deploy-status-${worker}`,
  ];
  const result = spawnSync("npx", args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
