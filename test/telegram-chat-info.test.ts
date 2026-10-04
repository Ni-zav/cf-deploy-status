import { describe, expect, it } from "vitest";
import { chatTargets } from "../scripts/telegram-chat-info.mjs";

describe("Telegram chat discovery", () => {
  it("extracts private, group-topic and channel IDs without exposing message content", () => {
    expect(chatTargets([
      { message: { chat: { id: 123, type: "private" }, text: "private text" } },
      { message: { chat: { id: -100123, type: "supergroup" }, message_thread_id: 42, text: "topic text" } },
      { channel_post: { chat: { id: -100456, type: "channel" }, text: "channel text" } },
      { callback_query: {} },
    ])).toEqual([
      { chatId: "123", type: "private" },
      { chatId: "-100123", type: "supergroup", topicId: 42 },
      { chatId: "-100456", type: "channel" },
    ]);
  });

  it("deduplicates targets but preserves separate topics", () => {
    const message = { chat: { id: -100123, type: "supergroup" }, message_thread_id: 42 };
    expect(chatTargets([{ message }, { edited_message: message }, { message: { ...message, message_thread_id: 43 } }])).toHaveLength(2);
    expect(chatTargets([])).toEqual([]);
  });
});
