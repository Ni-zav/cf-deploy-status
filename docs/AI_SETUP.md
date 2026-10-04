# AI-assisted setup

Use this checklist with an assistant that can read the repository. AGENTS.md supplies repository instructions; no MCP server is shipped or needed. Browser-only assistants can guide you, but cannot claim to have changed or verified your account without authenticated tools and results.

## Installation checklist

1. Identify whether this is a fresh installation or an update. Confirm the Cloudflare account, intended Worker name, destinations, and monitored projects without requesting secret values in chat. Inspect existing resources before reusing them.
2. For a fresh install, use the README's Deploy-to-Cloudflare button, choose isolated KV and queues, and retain `npm run deploy`. For terminal installation, follow the README's manual commands. An existing user may need to copy/update the source before a newly added feature is available; installing the reporting Action alone does not upgrade the Worker.
3. Set the account ID as an ordinary Wrangler variable. Keep the runtime monitoring token separate from deployment credentials. Configure `INGEST_SHARED_SECRET` for CI/test ingestion. Start with `PROJECTS_JSON=[]` to avoid enabling unapproved project monitors.
4. Configure only approved destinations as Worker secrets. Telegram uses `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`, optionally `TELEGRAM_MESSAGE_THREAD_ID`; follow README's dedicated-bot and discovery instructions. Do not require unused Discord/Slack/generic destinations or the optional Pages webhook secret.
5. Enable the chosen sources: list Pages projects for polling, create Workers Builds Queue subscriptions, or add the root reporting Action to a deployment workflow. Only enable Worker reconciliation when requested. Native Pages webhook setup is optional and does not expose branch metadata in the observed payload.
6. Verify health/readiness, send a synthetic event using an authorized local secret, and confirm delivery to the intended destination/topic. Do not log request authorization headers. Readiness success is not live delivery proof.
7. Report the Worker endpoint privately, configured destination types, enabled sources, verification results, and any missing user/browser step. Keep account-specific setup notes out of public Git. Remove only temporary resources you created and were authorized to remove.

## Prompt to give an assistant

```text
Help me install or update cf-deploy-status from its repository.
Read AGENTS.md, README.md, SECURITY.md, and docs/AI_SETUP.md first.
Ask whether this is a fresh installation or an existing Worker, then confirm
the intended Cloudflare account, destinations, and monitored projects.
For Telegram, support bot token + chat ID and an optional forum topic ID.
Have me enter credentials through hidden prompts or service secret settings,
never into this conversation or tracked files. Keep deployment credentials
separate from the runtime read-only token. Preserve existing applications,
queues, KV, and bot integrations; use isolated resources for new installs.
Explain unavoidable browser actions step by step. Verify readiness and a real
notification, and clearly separate checks you ran from instructions I still
need to perform. Do not publish private setup data or change release tags.
```

## Completion evidence

- Health and readiness HTTP status, with configuration issues resolved.
- An accepted synthetic event and separately confirmed destination delivery.
- Telegram topic routing confirmed when a topic ID was configured.
- The expected real deployment source observed when source configuration is in scope.
- No credentials or private project details in tracked files or public logs.

The Telegram implementation has automated API-contract and retry tests. Live bot/chat delivery still requires user-supplied credentials and verification; the earlier v1.0.0 certification does not cover this later addition.
