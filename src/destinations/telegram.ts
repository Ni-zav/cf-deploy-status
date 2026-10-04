import type { DeploymentEvent, Env } from "../types";
import { formatPlainText } from "./format";

export function telegramConfigurationIssues(env: Env): string[] {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  const chat = env.TELEGRAM_CHAT_ID?.trim();
  const topic = env.TELEGRAM_MESSAGE_THREAD_ID?.trim();
  if (!token && !chat && !topic) return [];
  const issues: string[] = [];
  if (!token || !chat) issues.push("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be configured together");
  if (chat && !/^(?:-?[1-9]\d*|@[A-Za-z0-9_]+)$/.test(chat)) {
    issues.push("TELEGRAM_CHAT_ID must be a nonzero numeric chat ID or @username");
  }
  if (topic && (!/^[1-9]\d*$/.test(topic) || !Number.isSafeInteger(Number(topic)))) {
    issues.push("TELEGRAM_MESSAGE_THREAD_ID must be a positive safe integer");
  }
  return issues;
}

export async function sendTelegram(env: Env, event: DeploymentEvent): Promise<void> {
  const text = formatPlainText(event);
  const truncated = text.length > 4096 ? `${text.slice(0, 4095).replace(/[\uD800-\uDBFF]$/, "")}…` : text;
  const body: { chat_id: string; text: string; message_thread_id?: number } = {
    chat_id: env.TELEGRAM_CHAT_ID!.trim(),
    text: truncated,
  };
  const topic = env.TELEGRAM_MESSAGE_THREAD_ID?.trim();
  if (topic) body.message_thread_id = Number(topic);
  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN!.trim()}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error("Telegram sendMessage request failed");
  }
  const result = await response.json().catch(() => null) as { ok?: boolean; error_code?: number } | null;
  if (!response.ok || result?.ok !== true) {
    const code = Number.isSafeInteger(result?.error_code) ? `, API code ${result!.error_code}` : "";
    throw new Error(`Telegram sendMessage failed (HTTP ${response.status}${code})`);
  }
}
