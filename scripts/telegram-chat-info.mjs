import { pathToFileURL } from "node:url";

export function chatTargets(updates) {
  const targets = new Map();
  for (const update of updates) {
    const message = update.message ?? update.edited_message ?? update.channel_post ?? update.edited_channel_post;
    if (!message?.chat?.id) continue;
    const target = { chatId: String(message.chat.id), type: message.chat.type };
    if (message.message_thread_id !== undefined) target.topicId = message.message_thread_id;
    targets.set(`${target.chatId}:${target.topicId ?? ""}`, target);
  }
  return [...targets.values()];
}

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) throw new Error("Set TELEGRAM_BOT_TOKEN in your shell environment; do not pass it as a command argument.");
  let response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, { signal: AbortSignal.timeout(15000) });
  } catch {
    throw new Error("Telegram getUpdates request failed; check connectivity and bot credentials.");
  }
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.ok !== true || !Array.isArray(body.result)) {
    if (response.status === 409 || body?.error_code === 409) {
      throw new Error("Telegram getUpdates is unavailable while a webhook or another poller is active. Use a dedicated notification bot; this helper will not remove existing webhooks.");
    }
    throw new Error(`Telegram getUpdates failed (HTTP ${response.status}).`);
  }
  const targets = chatTargets(body.result);
  if (!targets.length) throw new Error("No chat found. Start a private chat with the bot, or send /setup@YourBotUsername in the target group/topic, then retry.");
  console.log(JSON.stringify(targets, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
