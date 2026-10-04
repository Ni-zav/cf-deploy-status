import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { createDogfoodConfig } from "../scripts/dogfood-config.mjs";

const base = JSON.parse(fs.readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));

describe("dogfood deployment isolation", () => {
  it("preserves the existing notifier resource names for its default deployment", () => {
    const config = createDogfoodConfig(base, { CLOUDFLARE_ACCOUNT_ID: "test-account" });
    expect(config.queues).toEqual(base.queues);
    expect(config.vars.PROJECTS_JSON).toBe("[]");
  });

  it("isolates producer, consumer, and DLQ when a temporary Worker name is selected", () => {
    const config = createDogfoodConfig(base, { DOGFOOD_WORKER_NAME: "cert-notifier", CLOUDFLARE_ACCOUNT_ID: "test-account" });
    expect(config.queues.producers[0].queue).toBe("cert-notifier-events");
    expect(config.queues.consumers[0].queue).toBe("cert-notifier-events");
    expect(config.queues.consumers[0].dead_letter_queue).toBe("cert-notifier-events-dlq");
    expect(base.queues.consumers[0].queue).toBe("cf-deploy-events");
  });
});
