import { envFlag } from "../config";
import { dispatchEvent } from "../destinations";
import { isWorkersBuildEvent, normalizeWorkersBuildEvent } from "../sources/workers-builds";
import { enrichWorkersBuildEvent } from "../sources/workers-enrichment";
import { isProcessed, markProcessed } from "../state/kv";
import type { DeploymentEvent, Env, NormalizedQueueMessage } from "../types";

function isNormalizedMessage(value: unknown): value is NormalizedQueueMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<NormalizedQueueMessage>;
  return candidate.kind === "deployment-event" && !!candidate.event && typeof candidate.event === "object";
}

async function eventFromMessage(value: unknown, env: Env): Promise<DeploymentEvent | null> {
  if (isNormalizedMessage(value)) return value.event;
  if (isWorkersBuildEvent(value)) {
    const event = normalizeWorkersBuildEvent(value, env);
    return event ? enrichWorkersBuildEvent(value, event, env) : null;
  }
  return null;
}

export async function handleQueue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    try {
      const event = await eventFromMessage(message.body, env);
      if (!event) {
        console.error("Dropping unknown queue message", message.body);
        message.ack();
        continue;
      }
      if (event.status === "started" && !envFlag(env.NOTIFY_STARTED, true)) {
        await markProcessed(env, event.eventId);
        message.ack();
        continue;
      }
      if (await isProcessed(env, event.eventId)) {
        message.ack();
        continue;
      }

      await dispatchEvent(env, event);
      await markProcessed(env, event.eventId);
      console.log("Deployment event delivered", {
        eventId: event.eventId,
        project: event.project,
        product: event.product,
        environment: event.environment,
        status: event.status,
        source: event.source,
      });
      message.ack();
    } catch (error) {
      console.error("Queue delivery failed; scheduling retry", error);
      message.retry({ delaySeconds: 30 });
    }
  }
}
