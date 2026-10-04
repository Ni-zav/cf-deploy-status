# cf-deploy-status

Self-hosted Cloudflare deployment notifications for **Workers and Pages**.

[![CI](https://github.com/Ni-zav/cf-deploy-status/actions/workflows/ci.yml/badge.svg)](https://github.com/Ni-zav/cf-deploy-status/actions/workflows/ci.yml)
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Ni-zav/cf-deploy-status)

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

### One-click deployment

Use the **Deploy to Cloudflare** button above. Cloudflare clones the repository into your account, provisions the declared KV namespace and Queues, configures Workers Builds, and deploys the Worker.

1. Choose a new Worker name and new resources for a separate installation.
2. Enter `CLOUDFLARE_ACCOUNT_ID` once as an ordinary variable. Leave `PROJECTS_JSON` as `[]` until you configure monitored projects.
3. Enter the read-only monitoring token as `CLOUDFLARE_API_TOKEN` and a random bearer token as `INGEST_SHARED_SECRET`. The build/deployment token is separate from this runtime read-only token.
4. Deploy, then open the new Worker in the Cloudflare dashboard. Under **Settings > Variables and Secrets**, add a secret for at least one destination: `DISCORD_WEBHOOK_URL`, `SLACK_WEBHOOK_URL`, or `GENERIC_WEBHOOK_URL`. Save and deploy the secret change.
5. Add `PAGES_WEBHOOK_SECRET` only if configuring native Pages webhooks, and `GENERIC_WEBHOOK_SECRET` only if your generic destination requires a bearer token. Leave unused destination secrets unset.

Cloudflare discovers setup secrets from active entries in `.dev.vars.example`. Optional entries are commented out so the form does not require every destination. Ordinary variables are declared only in `wrangler.jsonc` to avoid duplicate masked fields.

Keep the deploy command as `npm run deploy`. If the installer renames the main Queue, this command also isolates the template's default DLQ as `<selected-queue>-dlq`. It preserves any DLQ name you explicitly configure. Running `wrangler deploy` directly skips this installation adjustment.

After configuring a destination, check:

```text
GET https://<worker>/readyz
```

A healthy installation returns HTTP 200. Before adding a destination, HTTP 503 with a missing-destination issue is expected. Configure destinations before sending events; delivery without a destination retries and can reach the DLQ.

### Manual deployment

Requirements: Node.js 22+, a Cloudflare account, and Wrangler authentication.

```bash
git clone https://github.com/Ni-zav/cf-deploy-status.git
cd cf-deploy-status
npm ci --legacy-peer-deps
npx wrangler login
```

Edit `PROJECTS_JSON` in `wrangler.jsonc`. Example:

```json
[
  {
    "product": "pages",
    "name": "example-site",
    "branchEnvironmentMap": {
      "main": "production",
      "staging": "staging"
    },
    "defaultPreviewEnvironment": "preview"
  },
  {
    "product": "workers",
    "name": "example-api",
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
npm run subscribe:workers -- example-api another-worker
```

Equivalent Wrangler command:

```bash
npx wrangler queues subscription create cf-deploy-events \
  --source workersBuilds.worker \
  --events build.started,build.succeeded,build.failed,build.canceled \
  --worker-name example-api \
  --name cf-deploy-status-example-api
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

Cloudflare's destination-validation test is acknowledged without sending a deployment notification. Native Pages alerts provide a deployment URL and provider environment, but the observed payload does not include a branch name. Use Pages API polling when branch-to-environment mapping is required.

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
  uses: Ni-zav/cf-deploy-status@v1
  with:
    endpoint: ${{ secrets.CF_DEPLOY_STATUS_URL }}
    token: ${{ secrets.CF_DEPLOY_STATUS_TOKEN }}
    product: workers
    project: example-api
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
| `GET /` | none | service metadata |
| `GET /healthz` | none | liveness check; independent of configuration |
| `GET /readyz` | none | readiness check; 503 when required bindings/config/destinations are unusable |
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

Transient delivery errors are retried by the Queue. Messages that exhaust the configured retries are routed to `cf-deploy-events-dlq`. An installation with zero configured destinations is treated as a delivery failure, so the Queue retries and eventually sends the event to the DLQ instead of acknowledging it as processed.

### Delivery semantics

Cloudflare Queues provides **at-least-once** delivery, so a message can occasionally be delivered more than once. The deterministic event IDs and KV receipt keys make duplicate notifications unlikely in normal operation, but this is **best-effort idempotency**, not an exactly-once guarantee.

Workers KV is eventually consistent across locations. A recently written receipt can therefore be temporarily invisible elsewhere. If your generic webhook performs non-idempotent side effects, use `event.eventId` as an idempotency key at the receiver as well. For workloads that require strict atomic deduplication, use a stronger consistency primitive such as Durable Objects rather than relying on KV alone.

References: [Queues delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/) and [Workers KV consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/).

## API token permissions

Use a custom, account-scoped, read-only API token. Enable only what you use:

- Cloudflare Pages: Read — Pages polling
- Workers Scripts: Read — Worker reconciliation and workers.dev URL enrichment
- Workers Builds Configuration: Read (legacy Workers CI Read): optional Workers Builds metadata/log access

For optional Workers Builds REST enrichment, create a **user-owned** token under [My Profile → API Tokens](https://dash.cloudflare.com/profile/api-tokens), restricted to the intended account and read permissions. Account-owned tokens can monitor Pages and Workers but are not supported by the Builds API, even when their Workers permissions are sufficient. See the [Builds API authentication requirements](https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/). Queue subscriptions still deliver lifecycle events without Builds REST access; error summaries then use event metadata rather than fetched build logs.

Do not use the Global API Key.

Deployment uses a separate token from the runtime read-only monitoring token. Creating a new Worker requires Workers product-level Admin; deploying an existing Worker requires Editor access to that Worker. Keep KV Storage and Queues provisioning permissions on the deployment token when deployment creates those resources. See [Cloudflare's Workers roles and permissions](https://developers.cloudflare.com/workers/authorization/workers/).

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
npm ci --legacy-peer-deps
npm run typecheck
npm test
npm run dev
```

CI uses the committed lockfile, runs TypeScript + Vitest, validates the Wrangler deployment bundle with `wrangler deploy --dry-run`, and audits runtime dependencies.

## Repository layout

```text
src/
  handlers/       HTTP, Queue, scheduled handlers
  sources/        Workers Builds, Pages API/webhook, Workers API, CI
  destinations/   Discord, Slack, generic webhook
  state/          KV idempotency/state
scripts/          setup + CI reporting helpers
examples/         project config + GitHub Actions example
test/             normalization, HTTP, Queue, delivery, and reconciliation tests
docs/             architecture, operations, release, and research notes
action.yml        reusable GitHub reporting action
wrangler.jsonc    deployable Cloudflare infrastructure/runtime config
```

## Research

The design rationale, Cloudflare capability matrix, limitations, and open-source comparison are documented in:

`docs/2026-10-02-cloudflare-deploy-notifications-research.md`

## Releases and GitHub Action versioning

Stable action consumers should use the moving major tag:

```yaml
uses: Ni-zav/cf-deploy-status@v1
```

Release tags use semantic versions such as `v1.0.0`. The release workflow validates the tagged commit, creates the GitHub Release, then advances the compatible `v1` and `v1.0` tags. See `docs/RELEASE.md` for the release gate and dogfood checklist.

## Security

See `SECURITY.md`. In particular, keep webhook URLs/API tokens in Worker secrets and avoid forwarding full untrusted build logs to chat destinations.

## License

MIT.
