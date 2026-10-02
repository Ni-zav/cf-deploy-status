# cf-deploy-status

Self-hosted Cloudflare deployment notifications for **Workers and Pages**.

It runs as a Cloudflare Worker and combines native Workers Builds events, Pages deployment polling, optional Cloudflare Pages webhooks, direct CI/Wrangler reports, and optional Worker deployment reconciliation into one normalized event stream.

## What it gives you

- Workers Builds: started / succeeded / failed / canceled
- Pages: started / succeeded / failed / canceled / skipped
- production, staging, preview, or custom branch-to-environment mapping
- direct GitHub Actions / Wrangler reporting, including failures that occur before Cloudflare creates a deployment
- Discord, Slack, and generic JSON webhook destinations
- KV idempotency and per-destination delivery receipts
- Queue retries and a dead-letter queue
- failed Workers Build log extraction
- successful Workers Build preview/live URL enrichment
- protected test and CI-ingest endpoints
- first-party reusable GitHub composite action in this repository

## Architecture

```text
Workers Builds Event Subscription ───────┐
                                         │
Pages API poller (cron) ─────────────────┤
                                         ▼
Pages Project Updates webhook ───► cf-deploy-events Queue
                                         │
GitHub Actions / Wrangler ────────►       │
                                         ▼
                                  cf-deploy-status Worker
                                         │
                          ┌──────────────┬─┴──────────────┐
                          ▼              ▼                ▼
                         KV          Discord/Slack   generic webhook
                   dedupe + state
```

Workers deployment-history reconciliation is available as an optional safety net for successful direct/manual Worker deployments.

## Deploy

Requirements: Node.js 22+, a Cloudflare account, and Wrangler authentication.

```bash
git clone https://github.com/Ni-zav/cf-deploy-status.git
cd cf-deploy-status
npm install
npx wrangler login
```

Edit `PROJECTS_JSON` in `wrangler.jsonc`. Example:

```json
[
  {
    "product": "pages",
    "name": "sveindonesia",
    "branchEnvironmentMap": {
      "main": "production",
      "staging": "staging"
    },
    "defaultPreviewEnvironment": "preview"
  },
  {
    "product": "workers",
    "name": "neos-api",
    "branchEnvironmentMap": {
      "main": "production",
      "staging": "staging"
    },
    "reconcile": false
  }
]
```

See `examples/projects.example.json` for a complete example.

Set the account ID in `wrangler.jsonc` or as an environment-specific variable:

```jsonc
"vars": {
  "CLOUDFLARE_ACCOUNT_ID": "<ACCOUNT_ID>",
  "PROJECTS_JSON": "[...]",
  "NOTIFY_STARTED": "true",
  "NOTIFY_ON_BOOTSTRAP": "false"
}
```

Then add secrets. Only add destinations you use:

```bash
npx wrangler secret put CLOUDFLARE_API_TOKEN
npx wrangler secret put INGEST_SHARED_SECRET

# one or more destinations
npx wrangler secret put DISCORD_WEBHOOK_URL
npx wrangler secret put SLACK_WEBHOOK_URL
npx wrangler secret put GENERIC_WEBHOOK_URL
npx wrangler secret put GENERIC_WEBHOOK_SECRET

# only if using Cloudflare Pages generic webhook Notifications
npx wrangler secret put PAGES_WEBHOOK_SECRET
```

Deploy:

```bash
npm run deploy
```

The Wrangler config intentionally omits the KV namespace ID. Current Wrangler supports automatic provisioning for KV and Queues when deployable resources are declared without pre-existing IDs. The config also defines the main queue, its consumer, retries, and the DLQ.

## Workers Builds event subscriptions

After the Worker/Queue exists, subscribe each Workers Builds project you want to observe:

```bash
npm run subscribe:workers -- neos-api another-worker
```

Equivalent Wrangler command:

```bash
npx wrangler queues subscription create cf-deploy-events \
  --source workersBuilds.worker \
  --events build.started,build.succeeded,build.failed,build.canceled \
  --worker-name neos-api \
  --name cf-deploy-status-neos-api
```

Native Workers Builds events are enriched with build URLs or a short failure excerpt when the API token has the required read permissions.

## Pages monitoring

Pages projects listed in `PROJECTS_JSON` are checked every minute through the Pages Deployments API.

On the first run, existing deployments are seeded into KV and **not** sent as old notifications. Set `NOTIFY_ON_BOOTSTRAP=true` only if you deliberately want the latest state emitted after a fresh deployment of this service.

A branch such as `staging` can still be a Cloudflare Pages `preview` deployment. The service keeps both concepts:

```json
{
  "environment": "staging",
  "providerEnvironment": "preview",
  "branch": "staging"
}
```

### Optional native Pages webhook

If your Cloudflare account supports generic webhook notification destinations, point the Pages Project Updates notification to:

```text
POST https://<cf-deploy-status-worker>/v1/events/cloudflare/pages
```

Set the same secret in Cloudflare's generic webhook configuration and `PAGES_WEBHOOK_SECRET`. The Worker validates Cloudflare's `cf-webhook-auth` header.

The API poller can remain enabled as reconciliation; matching deployment/status IDs deduplicate naturally.

## Direct Wrangler / GitHub Actions

Cloudflare cannot produce a deployment-history record for every command that failed *before* a deployment was created. For controlled CI paths, report the result explicitly.

This repo is itself a composite GitHub Action:

```yaml
- name: Deploy
  id: deploy
  continue-on-error: true
  uses: cloudflare/wrangler-action@v4
  with:
    apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    command: deploy --env staging

- name: Report Cloudflare deploy
  if: always()
  uses: Ni-zav/cf-deploy-status@main
  with:
    endpoint: ${{ secrets.CF_DEPLOY_STATUS_URL }}
    token: ${{ secrets.CF_DEPLOY_STATUS_TOKEN }}
    product: workers
    project: neos-api
    environment: staging
    status: ${{ steps.deploy.outcome == 'success' && 'succeeded' || 'failed' }}
    deployment-url: ${{ steps.deploy.outputs.deployment-url }}
    error-summary: ${{ steps.deploy.outputs.command-stderr }}

- name: Preserve deployment failure
  if: steps.deploy.outcome == 'failure'
  run: exit 1
```

A complete example is in `examples/github-actions.yml`.

The reporting action defaults to **not** failing the job if notification reporting itself is unavailable, so an observability outage does not mask the real deployment result.

## Worker reconciliation

For a Worker deployed outside Workers Builds and outside your instrumented CI, set:

```json
{
  "product": "workers",
  "name": "manual-worker",
  "environment": "production",
  "reconcile": true
}
```

The scheduled job checks Workers deployment history and emits unseen successful deployments.

This is deliberately opt-in. It cannot detect a failed local/API upload that never created a deployment; use the CI reporter or wrapper for those attempts.

## Endpoints

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /` | none | service metadata / health |
| `GET /healthz` | none | health check |
| `POST /v1/events/ci` | Bearer `INGEST_SHARED_SECRET` | CI/Wrangler result ingestion |
| `POST /v1/events/cloudflare/pages` | `cf-webhook-auth` | Pages Project Updates webhook |
| `POST /v1/test` | Bearer `INGEST_SHARED_SECRET` | enqueue a synthetic test event |

Example smoke test:

```bash
curl -X POST "https://<worker>/v1/test" \
  -H "Authorization: Bearer $INGEST_SHARED_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"product":"workers","project":"smoke-test","status":"succeeded","environment":"test"}'
```

## Notification reliability

Queue processing uses deterministic event IDs plus two layers of KV state:

- `processed:<eventId>` prevents a completed event from being processed twice.
- `delivered:<eventId>:<destination>` prevents a successful Discord/Slack/generic delivery from being repeated when another destination fails and the Queue retries the message.

Transient delivery errors are retried by the Queue. Messages that exhaust the configured retries are routed to `cf-deploy-events-dlq`.

## API token permissions

Use a custom, account-scoped, read-only API token. Enable only what you use:

- Cloudflare Pages: Read — Pages polling
- Workers Scripts: Read — Worker reconciliation and workers.dev URL enrichment
- Workers Builds Configuration: Read — Workers Builds enrichment where required

Do not use the Global API Key.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PROJECTS_JSON` | `[]` | monitored Pages/Workers |
| `CLOUDFLARE_ACCOUNT_ID` | empty | account used for REST polling |
| `NOTIFY_STARTED` | `true` | send started events |
| `NOTIFY_ON_BOOTSTRAP` | `false` | notify latest state on first poll |
| `ERROR_SUMMARY_MAX_CHARS` | `1200` | max error excerpt |
| `STATE_TTL_SECONDS` | `2592000` | KV idempotency/state TTL |

Local secret/value examples are in `.dev.vars.example`.

## Development

```bash
npm install
npm run typecheck
npm test
npm run dev
```

CI runs type checking and Vitest on pushes to `main` and pull requests.

## Repository layout

```text
src/
  handlers/       HTTP, Queue, scheduled handlers
  sources/        Workers Builds, Pages API/webhook, Workers API, CI
  destinations/   Discord, Slack, generic webhook
  state/          KV idempotency/state
scripts/          setup + CI reporting helpers
examples/         project config + GitHub Actions example
test/             normalization and formatting tests
docs/             architecture/research notes
action.yml        reusable GitHub reporting action
wrangler.jsonc    deployable Cloudflare infrastructure/runtime config
```

## Research

The design rationale, Cloudflare capability matrix, limitations, and open-source comparison are documented in:

`docs/2026-10-02-cloudflare-deploy-notifications-research.md`

## Security

See `SECURITY.md`. In particular, keep webhook URLs/API tokens in Worker secrets and avoid forwarding full untrusted build logs to chat destinations.

## License

MIT.
