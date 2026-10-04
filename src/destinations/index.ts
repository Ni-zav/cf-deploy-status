import type { DeploymentEvent, Env } from "../types";
import { isDelivered, markDelivered } from "../state/kv";
import { formatPlainText, statusColor } from "./format";
import { sendTelegram, telegramConfigurationIssues } from "./telegram";

export type Destination = {
  id: string;
  send(event: DeploymentEvent): Promise<void>;
};

export function configuredDestinations(env: Env): Destination[] {
  const destinations: Destination[] = [];

  if (env.DISCORD_WEBHOOK_URL) {
    destinations.push({
      id: "discord",
      send: async (event) => {
        const fields = [
          { name: "Project", value: event.project, inline: true },
          { name: "Product", value: event.product, inline: true },
          { name: "Environment", value: event.environment, inline: true },
        ];
        if (event.branch) fields.push({ name: "Branch", value: event.branch, inline: true });
        if (event.commitSha) fields.push({ name: "Commit", value: event.commitSha.slice(0, 8), inline: true });
        if (event.source) fields.push({ name: "Source", value: event.source, inline: true });
        const body = {
          embeds: [{
            title: `Deploy ${event.status}`,
            description: event.errorSummary ? `\`${escapeInlineCode(event.errorSummary)}\`` : undefined,
            url: event.deploymentUrl ?? event.dashboardUrl,
            color: statusColor(event.status),
            fields,
            timestamp: event.observedAt,
          }],
        };
        await postJson(env.DISCORD_WEBHOOK_URL!, body);
      },
    });
  }

  if (env.SLACK_WEBHOOK_URL) {
    destinations.push({
      id: "slack",
      send: async (event) => postJson(env.SLACK_WEBHOOK_URL!, { text: formatPlainText(event) }),
    });
  }

  if (env.TELEGRAM_BOT_TOKEN?.trim() && env.TELEGRAM_CHAT_ID?.trim() && telegramConfigurationIssues(env).length === 0) {
    destinations.push({ id: "telegram", send: async (event) => sendTelegram(env, event) });
  }

  if (env.GENERIC_WEBHOOK_URL) {
    destinations.push({
      id: "generic",
      send: async (event) => {
        const headers: Record<string, string> = { "content-type": "application/json" };
        if (env.GENERIC_WEBHOOK_SECRET) headers.authorization = `Bearer ${env.GENERIC_WEBHOOK_SECRET}`;
        const response = await fetch(env.GENERIC_WEBHOOK_URL!, {
          method: "POST",
          headers,
          body: JSON.stringify({ type: "cf-deploy-status.deployment", event }),
        });
        if (!response.ok) throw new Error(`generic webhook returned ${response.status}: ${await response.text()}`);
      },
    });
  }

  return destinations;
}

export async function dispatchEvent(env: Env, event: DeploymentEvent): Promise<void> {
  const telegramIssues = telegramConfigurationIssues(env);
  if (telegramIssues.length > 0) throw new Error(telegramIssues.join("; "));
  const destinations = configuredDestinations(env);
  if (destinations.length === 0) {
    throw new Error("no notification destinations configured");
  }

  for (const destination of destinations) {
    if (await isDelivered(env, event.eventId, destination.id)) continue;
    await destination.send(event);
    await markDelivered(env, event.eventId, destination.id);
  }
}

async function postJson(url: string, body: unknown): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`webhook returned ${response.status}: ${await response.text()}`);
}

function escapeInlineCode(value: string): string {
  return value.replace(/`/g, "'").slice(0, 1200);
}
