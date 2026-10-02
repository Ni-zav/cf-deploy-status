import type { DeploymentEvent } from "../types";
import { shortSha } from "../utils";

const statusEmoji: Record<DeploymentEvent["status"], string> = {
  started: "🚧",
  succeeded: "✅",
  failed: "❌",
  canceled: "⚠️",
  skipped: "⏭️",
};

export function formatPlainText(event: DeploymentEvent): string {
  const lines = [
    `${statusEmoji[event.status]} DEPLOY ${event.status.toUpperCase()}`,
    `${event.project} · ${event.product === "workers" ? "Workers" : "Pages"} · ${event.environment}`,
  ];
  if (event.branch) lines.push(`branch: ${event.branch}`);
  if (event.commitSha) lines.push(`commit: ${shortSha(event.commitSha)}`);
  if (event.actor) lines.push(`actor: ${event.actor}`);
  if (event.durationMs !== undefined) lines.push(`duration: ${formatDuration(event.durationMs)}`);
  if (event.errorSummary) lines.push(`error: ${escapeInlineCode(event.errorSummary)}`);
  if (event.deploymentUrl) lines.push(event.deploymentUrl);
  else if (event.dashboardUrl) lines.push(event.dashboardUrl);
  lines.push(`source: ${event.source}`);
  return lines.join("\n");
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export function statusColor(status: DeploymentEvent["status"]): number {
  switch (status) {
    case "succeeded": return 0x2ea043;
    case "failed": return 0xda3633;
    case "started": return 0xd29922;
    case "canceled": return 0x8b949e;
    case "skipped": return 0x6e7681;
  }
}

function escapeInlineCode(value: string): string {
  return value.replace(/`/g, "'").trim();
}
