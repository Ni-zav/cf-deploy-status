# cf-deploy-status

Centralized Cloudflare deployment status notifications for **Workers + Pages**, across production/main, staging, previews, and direct CI deployments.

## Goal

Notify on deployment lifecycle events such as:

- started
- succeeded
- failed
- cancelled / skipped

with enough context to act immediately: project, Cloudflare product, environment, branch, commit, deployment URL, source, duration, and a short error excerpt when available.

## Recommended architecture

This repository should use a **hybrid collector** rather than relying on one webhook source:

1. **Workers Builds** — Cloudflare **Queue Event Subscriptions** for native real-time build events.
2. **Pages** — Cloudflare **Pages Project Updates** notifications when a webhook destination is available, with a Pages API watcher as a portable/free fallback.
3. **Direct `wrangler deploy` / GitHub Actions** — an explicit reporter to this service so failures that happen before a Cloudflare deployment object exists are still reported.
4. Normalize all sources into one internal event model and send them through pluggable notification adapters (Discord, Slack, Telegram, generic webhook, etc.).
5. Keep idempotency/state in KV initially, or D1 when deployment history/status UI is wanted.

The intent is to cover Cloudflare-side deployments rather than only deployments initiated from one CI workflow.

## Why not only use GitHub Actions?

A CI-only notifier is simple, but it misses deployments triggered from other paths (Cloudflare Git integration, dashboard/manual actions, deploy hooks, another CI system, or local Wrangler). It also cannot observe Cloudflare-native build state unless it polls or waits for it.

Likewise, polling Worker deployment history alone cannot report a failed `wrangler deploy` that fails before a deployment is created.

## Current Cloudflare capabilities

As researched on **2026-10-02**:

- Workers Builds publishes `build.started`, `build.succeeded`, `build.failed`, and `build.canceled` through Event Subscriptions into Cloudflare Queues.
- Cloudflare Pages has a **Project updates** Notification type with filters for project, environment, and deployment started/failed/success.
- Cloudflare Notifications email delivery is available on Free; generic webhook destinations require the account to have at least one Pro zone or higher.
- Pages REST API exposes deployment history and stage status (`success`, `active`, `failure`, `canceled`, `skipped`), so polling is a workable fallback.
- Workers REST API exposes successful deployment history, useful for reconciliation, but failed CLI upload/deploy attempts need CI-side instrumentation.

## Research + implementation plan

See:

- [Cloudflare deployment notifications research and implementation plan](docs/2026-10-02-cloudflare-deploy-notifications-research.md)

## Candidate open-source building blocks

The detailed comparison is in the research document. The strongest references are:

- Cloudflare official `workers-builds-notifications-template`
- `sunpech/cloudflare-pages-discord-notifier`
- `WalshyDev/cf-pages-await`
- `dfface/cloudflare-pages-notification`
- Cloudflare official `wrangler-action`

The recommendation is **not** to adopt one of them unchanged. Reuse the official Workers event-subscription pattern, the Pages polling pattern, and Wrangler Action outputs, then normalize everything in this repository.
