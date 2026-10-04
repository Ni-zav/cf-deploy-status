import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { readWranglerConfig } from "./read-config.mjs";

export function createDogfoodConfig(base, env) {
  const config = structuredClone(base);
  const name = env.DOGFOOD_WORKER_NAME || base.name;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error("Invalid dogfood Worker name");
  config.name = name;
  config.vars.CLOUDFLARE_ACCOUNT_ID = env.CLOUDFLARE_ACCOUNT_ID;
  config.vars.PROJECTS_JSON = env.DOGFOOD_PROJECTS_JSON || "[]";
  JSON.parse(config.vars.PROJECTS_JSON);
  if (name !== base.name) {
    const originalQueue = base.queues.producers.find((producer) => producer.binding === "EVENTS").queue;
    const queue = `${name}-events`;
    for (const producer of config.queues.producers) {
      if (producer.queue === originalQueue) producer.queue = queue;
    }
    for (const consumer of config.queues.consumers) {
      if (consumer.queue === originalQueue) {
        consumer.queue = queue;
        consumer.dead_letter_queue = `${queue}-dlq`;
      }
    }
  }
  return config;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = createDogfoodConfig(readWranglerConfig(), process.env);
  fs.writeFileSync("wrangler.dogfood.json", JSON.stringify(config, null, 2) + "\n");
}
