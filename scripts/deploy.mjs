import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { readWranglerConfig } from "./read-config.mjs";

export function prepareDeploymentConfig(base) {
  const config = structuredClone(base);
  const queue = config.queues?.producers?.find((producer) => producer.binding === "EVENTS")?.queue;
  if (queue && queue !== "cf-deploy-events") {
    for (const consumer of config.queues?.consumers || []) {
      if (consumer.queue === queue && consumer.dead_letter_queue === "cf-deploy-events-dlq") {
        consumer.dead_letter_queue = `${queue}-dlq`;
      }
    }
  }
  return config;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = prepareDeploymentConfig(readWranglerConfig());
  fs.writeFileSync("wrangler.deploy.json", JSON.stringify(config, null, 2) + "\n");
  const result = spawnSync("npx", ["wrangler", "deploy", "--config", "wrangler.deploy.json", ...process.argv.slice(2)], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) console.error(result.error.message);
  process.exit(result.status ?? 1);
}
