# Security

## Secrets

Never commit:

- Cloudflare API tokens
- `INGEST_SHARED_SECRET`
- Discord/Slack webhook URLs
- Telegram bot tokens, private chat IDs, and topic IDs
- generic webhook credentials
- `.dev.vars`

Store production values with `wrangler secret put` or Cloudflare dashboard secrets.

Telegram embeds its bot token in API request URLs. Do not log these URLs or use token-bearing API URLs in browser screenshots. Telegram delivery errors omit request URLs and provider descriptions; captured error summaries redact recognized Telegram token assignments and Bot API URLs. Do not rely on redaction to make arbitrary logs safe.

## API token scope

Use a custom read-only Cloudflare token scoped to the account being observed. Only grant the Pages / Workers read permissions needed by the enabled features.

## Public endpoints

`POST /v1/events/ci` and `POST /v1/test` require a bearer token matching `INGEST_SHARED_SECRET`.

`POST /v1/events/cloudflare/pages` requires the `cf-webhook-auth` header to match `PAGES_WEBHOOK_SECRET`.

Request bodies are limited to 64 KiB before JSON parsing.

## Build logs

Build error excerpts are sanitized and length-limited before they are sent to notification destinations. This is defense in depth, not a guarantee that arbitrary application logs contain no sensitive values. Avoid logging secrets during builds.

## Reporting vulnerabilities

Open a private security advisory in the GitHub repository when available. Do not include live tokens, webhook URLs, or customer data in public issues.
