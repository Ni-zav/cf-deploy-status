import fs from "node:fs";
import { describe, expect, it } from "vitest";

const example = fs.readFileSync(new URL("../.dev.vars.example", import.meta.url), "utf8");
const config = JSON.parse(fs.readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
const secretInputs = [...example.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*=/gm)].map((match) => match[1]);

describe("Deploy-to-Cloudflare setup declarations", () => {
  it("declares only the core setup secrets as active dotenv entries", () => {
    expect(secretInputs).toEqual(["CLOUDFLARE_API_TOKEN", "INGEST_SHARED_SECRET"]);
  });

  it("does not duplicate ordinary Wrangler variables as setup secrets", () => {
    expect(secretInputs.filter((name) => name in config.vars)).toEqual([]);
  });

  it("keeps optional secret examples commented out for local configuration", () => {
    for (const name of ["DISCORD_WEBHOOK_URL", "SLACK_WEBHOOK_URL", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "TELEGRAM_MESSAGE_THREAD_ID", "GENERIC_WEBHOOK_URL", "GENERIC_WEBHOOK_SECRET", "PAGES_WEBHOOK_SECRET"]) {
      expect(example).toMatch(new RegExp(`^# ${name}=`, "m"));
      expect(secretInputs).not.toContain(name);
    }
  });
});
