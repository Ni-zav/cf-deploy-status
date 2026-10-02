import type { Env } from "../types";
import { pollPages } from "../sources/pages-api";
import { reconcileWorkers } from "../sources/workers-api";

export async function handleScheduled(env: Env): Promise<void> {
  const results = await Promise.allSettled([pollPages(env), reconcileWorkers(env)]);
  for (const result of results) {
    if (result.status === "rejected") console.error("Scheduled reconciliation task failed", result.reason);
  }
}
