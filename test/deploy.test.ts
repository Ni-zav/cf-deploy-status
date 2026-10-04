import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { prepareDeploymentConfig } from "../scripts/deploy.mjs";

const base = JSON.parse(fs.readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));

describe("installation DLQ isolation", () => {
  it("preserves the default installation configuration", () => {
    expect(prepareDeploymentConfig(base)).toEqual(base);
  });

  it("isolates the default DLQ when the installer customizes the event queue", () => {
    const customized = structuredClone(base);
    customized.queues.producers[0].queue = "test-install-events";
    customized.queues.consumers[0].queue = "test-install-events";
    const config = prepareDeploymentConfig(customized);
    expect(config.queues.consumers[0].dead_letter_queue).toBe("test-install-events-dlq");
    expect(config.queues.producers).toEqual(customized.queues.producers);
    expect(config.kv_namespaces).toEqual(customized.kv_namespaces);
    expect(customized.queues.consumers[0].dead_letter_queue).toBe("cf-deploy-events-dlq");
  });

  it("preserves an explicitly customized DLQ", () => {
    const customized = structuredClone(base);
    customized.queues.producers[0].queue = "test-install-events";
    customized.queues.consumers[0].queue = "test-install-events";
    customized.queues.consumers[0].dead_letter_queue = "chosen-failure-queue";
    expect(prepareDeploymentConfig(customized)).toEqual(customized);
  });
});
