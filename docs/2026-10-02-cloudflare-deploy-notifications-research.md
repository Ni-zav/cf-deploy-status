# Cloudflare deployment notifications: research and implementation plan

**Date researched:** 2026-10-02  
**Repository:** `Ni-zav/cf-deploy-status`

## 1. Executive summary

The reliable way to notify on **all relevant Cloudflare deployment paths** is not one webhook. Cloudflare currently exposes different lifecycle surfaces for Workers Builds, Pages, and direct Wrangler/API deployments.

Recommended design:

```text
                   ┌──────────────────────────────┐
                   │ Cloudflare Workers Builds   │
                   │ Event Subscriptions         │
                   └──────────────┬───────────────┘
                                  │ native events
                                  ▼
                         ┌─────────────────┐
                         │ cf-deploy-events│
                         │ Cloudflare Queue│
                         └────────┬────────┘
                                  │
 Pages Notifications ──HTTP───────┤
 Pages API poller ──────scheduled──┤
 GitHub/CI reporter ────HTTP───────┤
 Worker reconciliation ─scheduled─┤
                                  ▼
                    ┌────────────────────────┐
                    │ Normalize + deduplicate│
                    │ + enrich event         │
                    └───────────┬────────────┘
                                │
                   ┌────────────┴─────────────┐
                   ▼                          ▼
            notification adapters      state / history
     Discord / Slack / Telegram /       KV first; D1 later
          generic webhook
```

### Recommended v1

Build a small TypeScript Cloudflare Worker with:

- one Queue consumer for Workers Builds events and internally queued events,
- a scheduled Pages deployment watcher as the zero-paid-plan fallback,
- an HTTP ingest endpoint for Cloudflare Pages generic webhooks where available,
- an HTTP ingest endpoint for GitHub Actions / direct Wrangler deployments,
- optional Workers deployment-history reconciliation,
- KV-based idempotency for the first implementation,
- destination adapters instead of hard-coding Discord or Slack,
- Queue retries plus a DLQ.

This gives one normalized notification format and works even when deployments do not all originate from the same GitHub workflow.

---

## 2. What Cloudflare exposes today

### 2.1 Workers Builds: native Event Subscriptions

Cloudflare Workers Builds can publish these events to a Cloudflare Queue:

- `build.started`
- `build.succeeded`
- `build.failed`
- `build.canceled`

The event includes useful deployment context such as:

- Worker name
- build UUID
- branch
- commit hash
- commit message
- author
- repository
- build/deploy commands
- timestamps

This is the strongest source for Cloudflare-managed Workers Builds because it is event-driven and includes failures that may never become a live deployment.

Official docs:

- https://developers.cloudflare.com/workers/ci-cd/builds/event-subscriptions/
- https://developers.cloudflare.com/queues/event-subscriptions/
- https://developers.cloudflare.com/queues/event-subscriptions/events-schemas/

Cloudflare also publishes an official open-source template:

- https://github.com/cloudflare/templates/tree/main/workers-builds-notifications-template

That template is a very good base for the Workers Builds adapter. It consumes Queue Event Subscriptions, enriches success/failure events, and forwards them to a webhook.

### Important limitation

These are **Workers Builds** events. They should not be treated as a universal event stream for every possible Worker deployment mechanism.

A direct `wrangler deploy`, direct Workers API deployment, or another external pipeline may create a Worker deployment without having gone through Workers Builds. If such a command fails before a deployment is created, Cloudflare deployment history cannot represent that failed attempt.

So Event Subscriptions solve the Cloudflare Builds path, but not all possible direct-deploy failures.

---

### 2.2 Cloudflare Pages: native Project updates Notifications

Cloudflare Notifications has a Pages **Project updates** notification type.

It can filter by:

- Pages project
- Pages environment
- event:
  - deployment started
  - deployment failed
  - deployment success

The API alert type is:

```text
pages_event_alert
```

Known filter values include:

```text
environment:
  ENVIRONMENT_PREVIEW
  ENVIRONMENT_PRODUCTION

event:
  EVENT_DEPLOYMENT_STARTED
  EVENT_DEPLOYMENT_FAILED
  EVENT_DEPLOYMENT_SUCCESS
```

Cloudflare documents the Pages project-update notification itself as available on all plans.

Sources:

- https://developers.cloudflare.com/notifications/notification-available/
- https://developers.cloudflare.com/api/resources/alerting/
- https://registry.terraform.io/providers/cloudflare/cloudflare/latest/docs/resources/notification_policy

### Delivery-method caveat

Cloudflare Notifications delivery methods are plan-dependent:

- email is available on Free,
- generic webhooks require the Cloudflare account to have at least one Pro zone or higher,
- PagerDuty requires a higher eligible plan.

So Pages has a native event source, but a **custom webhook destination is not guaranteed to be available on a Free-only account**.

Sources:

- https://developers.cloudflare.com/notifications/
- https://developers.cloudflare.com/notifications/get-started/configure-webhooks/

### Generic webhook security

Cloudflare generic webhook destinations can include a secret. Cloudflare sends the configured secret in the:

```text
cf-webhook-auth
```

header.

The receiver should reject events when that header does not match.

Generic payloads use a shape similar to:

```json
{
  "name": "...",
  "text": "...",
  "data": {},
  "ts": 0,
  "account_id": "...",
  "policy_id": "...",
  "policy_name": "...",
  "alert_type": "...",
  "alert_correlation_id": "...",
  "alert_event": "..."
}
```

Source:

- https://developers.cloudflare.com/notifications/reference/webhook-payload-schema/

---

### 2.3 Pages REST API: good fallback and reconciliation source

Cloudflare exposes Pages deployment history at:

```text
GET /accounts/{account_id}/pages/projects/{project_name}/deployments
```

A Pages deployment includes:

- deployment ID / short ID
- production or preview environment
- deployment trigger
- branch
- commit hash/message
- current stage
- all stages
- deployment URL
- modified/created timestamps
- whether it was skipped
- skip reason

Stage status values include:

- `success`
- `idle`
- `active`
- `failure`
- `canceled`
- `skipped`

This makes a scheduled Worker a practical zero-extra-service fallback for custom notifications.

Sources:

- https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/deployments/
- https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/deployments/methods/list/

### Polling behavior

For each configured Pages project:

1. fetch the newest deployments,
2. compare deployment ID + latest stage/status against stored state,
3. emit only unseen state transitions,
4. persist the new state.

A one-minute poll cadence is enough for chat notifications in most cases. Make it configurable.

Native Pages webhook events should be preferred when available; the poller can then be kept as a lower-frequency reconciliation task rather than the primary source.

---

### 2.4 Workers deployment history: useful for reconciliation, not failure detection

Workers exposes deployment history at:

```text
GET /accounts/{account_id}/workers/scripts/{script_name}/deployments
```

The first item is the latest deployment actively serving traffic. Deployment objects include:

- deployment ID
- creation time
- source
- deployed version(s)
- author email
- annotations such as `workers/message`
- `workers/triggered_by`

Sources:

- https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/
- https://developers.cloudflare.com/workers/versions-and-deployments/

This is valuable to catch a **successful** Worker deployment that arrived through a path not covered by Workers Builds or the CI reporter.

It is **not** enough for failure notifications. If a direct upload/deploy fails before a deployment is created, there is no successful deployment object to poll.

---

### 2.5 Direct GitHub Actions / Wrangler deployments

For direct CI deploys, use an explicit CI-side report in addition to Cloudflare-side observers.

Cloudflare's official action:

- https://github.com/cloudflare/wrangler-action

currently exposes useful outputs including:

- `command-output`
- `command-stderr`
- `deployment-url`
- Pages deployment ID
- Pages environment
- Pages alias URL
- Workers Preview IDs/URLs for supported Wrangler versions

That makes it straightforward to post a normalized event to `cf-deploy-status` after a deployment attempt.

Use:

```yaml
if: always()
```

for the reporting step so a failed deploy is still reported.

This path is especially important for:

- `wrangler deploy`
- `wrangler deploy --env staging`
- `wrangler pages deploy`
- custom CI/CD using Wrangler
- direct-upload jobs

The reporter should include the GitHub job status plus Wrangler stdout/stderr, but only send a short sanitized error excerpt in the user-facing notification.

---

## 3. Coverage matrix

| Deployment path | Started | Success | Failure | Recommended source |
|---|---:|---:|---:|---|
| Workers Build connected to Cloudflare Git/Builds | yes | yes | yes | Workers Builds Event Subscription |
| Pages Git integration | yes | yes | yes | Pages Project updates webhook if eligible; API poller fallback |
| Pages Deploy Hook | yes | yes | yes | Pages Project updates / API poller |
| Direct `wrangler pages deploy` in GitHub Actions | optional CI event | yes | yes | CI reporter + Pages reconciliation |
| Direct `wrangler deploy` in GitHub Actions | optional CI event | yes | yes | CI reporter + Workers reconciliation |
| Local `wrangler deploy` | only if wrapper used | yes via reconciliation | only if wrapper used | CLI wrapper + Worker reconciliation |
| Workers API direct deployment | no generic attempt event | yes | caller knows failure | caller reporter + Worker reconciliation |
| Cloudflare dashboard/manual successful Worker deploy | not guaranteed | yes | not all attempt failures observable | Worker reconciliation |

### Meaning of "all deployments"

There is an unavoidable distinction between:

1. **Cloudflare deployment/build lifecycle events**, and
2. **a client command that attempted to deploy but failed before Cloudflare created a deployment**.

The first can often be observed from Cloudflare. The second requires instrumentation at the caller.

Therefore the practical definition for this project should be:

> Observe every Cloudflare lifecycle event available from the platform, reconcile deployment history for missed successes, and instrument our controlled CI/Wrangler paths so pre-deployment failures are also reported.

---

## 4. Main/staging/preview environment model

Cloudflare products do not expose environments in exactly the same way.

### Pages

Pages natively labels a deployment as:

- `production`
- `preview`

A branch named `staging` is still generally a Pages preview environment unless it is the production branch of a separate Pages project.

The normalized event should therefore retain **both**:

```json
{
  "environment": "staging",
  "providerEnvironment": "preview",
  "branch": "staging"
}
```

Project configuration can map:

```json
{
  "branchEnvironmentMap": {
    "main": "production",
    "staging": "staging",
    "develop": "development"
  },
  "defaultPreviewEnvironment": "preview"
}
```

### Workers

Workers may use:

- separate Worker names,
- Wrangler environments such as `--env staging`,
- branches in Workers Builds.

Normalize from the strongest available signal:

1. explicit CI `environment`,
2. configured Worker-name map,
3. branch map,
4. fallback `production` / `preview` / `unknown`.

Do not discard Cloudflare's raw value. Keep both normalized and provider-specific fields.

---

## 5. Proposed normalized event schema

All sources should become one internal object before destinations see them.

```ts
type DeploymentStatus =
  | "started"
  | "succeeded"
  | "failed"
  | "canceled"
  | "skipped";

type DeploymentEvent = {
  eventId: string;
  provider: "cloudflare";
  product: "workers" | "pages";
  project: string;

  status: DeploymentStatus;

  environment: string;
  providerEnvironment?: string;
  branch?: string;

  deploymentId?: string;
  buildId?: string;
  deploymentUrl?: string;

  commitSha?: string;
  commitMessage?: string;
  actor?: string;

  source:
    | "workers-builds"
    | "pages-notification"
    | "pages-api"
    | "workers-api"
    | "github-actions"
    | "wrangler-wrapper";

  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;

  errorSummary?: string;

  rawRef?: {
    type?: string;
    correlationId?: string;
  };

  observedAt: string;
};
```

### Event ID / dedupe key

Use a deterministic idempotency key.

Examples:

```text
workers-builds:{buildUuid}:{status}
pages:{deploymentId}:{status}
workers-deployment:{deploymentId}:succeeded
ci:{repo}:{runId}:{job}:{status}
```

Store it with a TTL in KV. If the same event is redelivered, do not send a second chat notification.

---

## 6. Proposed repository structure

```text
cf-deploy-status/
├── README.md
├── docs/
│   └── 2026-10-02-cloudflare-deploy-notifications-research.md
├── src/
│   ├── index.ts
│   ├── config.ts
│   ├── types.ts
│   ├── normalize.ts
│   ├── handlers/
│   │   ├── queue.ts
│   │   ├── scheduled.ts
│   │   └── http.ts
│   ├── sources/
│   │   ├── workers-builds.ts
│   │   ├── pages-notification.ts
│   │   ├── pages-api.ts
│   │   ├── workers-api.ts
│   │   └── ci.ts
│   ├── destinations/
│   │   ├── discord.ts
│   │   ├── slack.ts
│   │   ├── telegram.ts
│   │   └── generic-webhook.ts
│   └── state/
│       └── kv.ts
├── test/
│   ├── fixtures/
│   └── ...
├── wrangler.jsonc
├── package.json
└── tsconfig.json
```

Do not start with a frontend. The first useful product is the notifier + event ledger.

---

## 7. Queue topology

### Recommended simple topology

Use one main queue:

```text
cf-deploy-events
```

Inputs:

- Cloudflare Workers Builds Event Subscription publishes directly to it.
- HTTP ingress handlers normalize/authenticate input and enqueue it.
- scheduled Pages/Workers reconciliation enqueues discovered transitions.

Consumer:

- normalizes raw Workers Build events if needed,
- deduplicates,
- enriches,
- dispatches to enabled destinations,
- records final state.

Add:

```text
cf-deploy-events-dlq
```

as a dead-letter queue.

Cloudflare Queues supports consumer retries and DLQs. A message that exceeds `max_retries` can be routed to the configured DLQ instead of being discarded.

Docs:

- https://developers.cloudflare.com/queues/configuration/dead-letter-queues/
- https://developers.cloudflare.com/queues/configuration/batching-retries/

### Suggested consumer behavior

- HTTP 2xx from destination -> ack.
- HTTP 429 / 5xx / network error -> retry with delay.
- bad normalized payload -> log + ack, because retry will not fix it.
- invalid secret/signature at ingress -> HTTP 401/403; never enqueue.
- unknown source payload version -> log structured error and optionally send to DLQ/manual review.

### Difference from the Cloudflare official template

The official Workers Builds template is a good reference, but its current consumer acknowledges processing errors in several cases. For this project, use Queue retries deliberately so a transient Discord/Slack/webhook outage does not silently lose the deployment alert.

---

## 8. State choice: KV first, D1 when history matters

### KV is enough for v1 notification dedupe

Use keys such as:

```text
seen:{eventId}
pages:last:{project}
workers:last:{script}
```

Benefits:

- very small implementation,
- no migrations,
- enough to prevent duplicates,
- perfect for a notifier-only first release.

### D1 is better for a later deployment-history UI

If this repo becomes a real deployment-status service, move/extend into D1 with tables similar to:

```sql
deployments(
  event_id TEXT PRIMARY KEY,
  product TEXT NOT NULL,
  project TEXT NOT NULL,
  environment TEXT,
  branch TEXT,
  status TEXT NOT NULL,
  deployment_id TEXT,
  build_id TEXT,
  deployment_url TEXT,
  commit_sha TEXT,
  source TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  observed_at TEXT NOT NULL
)
```

Then a later status page can answer:

- last deployment per project/environment,
- failure rate,
- current in-progress builds,
- deployment duration,
- history by branch,
- link to commit/deployment.

Do not add D1 just to send the first Discord notification.

---

## 9. Notification destination design

Do not make the core depend on one chat product.

Use an adapter interface:

```ts
interface NotificationDestination {
  send(event: DeploymentEvent): Promise<void>;
}
```

Initial adapters:

1. Discord webhook
2. Slack incoming webhook
3. Telegram bot/chat
4. Generic JSON webhook

The same normalized event should produce consistent information everywhere.

### Suggested message content

Success:

```text
✅ DEPLOY SUCCEEDED
sveindonesia.com · Pages · production
branch: main
commit: 75c54fa
duration: 1m 42s
https://...
```

Failure:

```text
❌ DEPLOY FAILED
neos-api · Workers · staging
branch: staging
commit: 9b13e2a
error: npm run build exited with code 1
build/deployment link: ...
```

Started notifications should be configurable. Some teams want them for production only because start+success doubles chat volume.

Default for this project can still be **all lifecycle statuses**, matching the original goal.

---

## 10. Project configuration

Keep project/env rules in non-secret configuration.

Example concept:

```json
{
  "projects": [
    {
      "product": "pages",
      "name": "sveindonesia",
      "enabled": true,
      "branchEnvironmentMap": {
        "main": "production",
        "staging": "staging"
      }
    },
    {
      "product": "workers",
      "name": "svein-api",
      "enabled": true,
      "branchEnvironmentMap": {
        "main": "production",
        "staging": "staging"
      }
    }
  ]
}
```

For a small number of projects, a JSON Wrangler variable is fine.

If the account grows, move project configuration to KV/D1 or a checked-in config file bundled with the Worker.

---

## 11. Secrets and permissions

### Secrets

Likely secrets:

```text
CLOUDFLARE_API_TOKEN
INGEST_SHARED_SECRET
PAGES_WEBHOOK_SECRET

DISCORD_WEBHOOK_URL
SLACK_WEBHOOK_URL

TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID

GENERIC_WEBHOOK_URL
GENERIC_WEBHOOK_SECRET
```

Only configure destinations actually in use.

### Cloudflare API token

Use a scoped API token, not the Global API Key.

For the full hybrid reconciler, read permissions may include:

- Cloudflare Pages: Read
- Workers Scripts: Read
- Workers Builds Configuration: Read, where needed for build enrichment

Scope it to the specific Cloudflare account.

The official Workers Builds notification template currently documents:

- Workers Builds Configuration: Read
- Workers Scripts: Read

The Pages poller needs:

- Cloudflare Pages: Read

### Ingress authentication

For `/v1/events/ci`:

- require an Authorization bearer token or HMAC signature,
- reject missing/invalid auth,
- set a body-size limit,
- validate schema before enqueueing.

For Cloudflare generic Pages notifications:

- validate `cf-webhook-auth`.

Do not accept an anonymous public event endpoint.

### Error text

Before sending build stderr/log excerpts to a third-party chat:

- cap length,
- strip obvious tokens,
- avoid dumping full environment variables,
- avoid forwarding complete raw build logs by default.

---

## 12. Open-source / existing solutions researched

### A. Cloudflare official Workers Builds notification template

Repository:

- https://github.com/cloudflare/templates/tree/main/workers-builds-notifications-template

What it does:

- Workers Builds -> Event Subscription -> Queue -> Worker -> webhook
- success/failure/cancel notifications
- build context
- fetches deployment URL on success
- fetches useful error logs on failure

Strengths:

- official Cloudflare reference
- native event-driven Workers Builds path
- clear setup
- already solves most Workers-Build-specific parsing/enrichment

Weaknesses for this project:

- focused on Workers Builds only
- webhook formatting is centered on Slack-compatible payloads
- does not solve Pages
- does not solve direct Wrangler failures
- current template intentionally skips started/queued notifications
- should be adapted to stronger retry/idempotency behavior for a central notifier

**Use as reference/base code, not the complete product.**

---

### B. `sunpech/cloudflare-pages-discord-notifier`

Repository:

- https://github.com/sunpech/cloudflare-pages-discord-notifier

What it does:

- scheduled Cloudflare Worker
- polls Pages deployments
- tracks state in KV
- supports multiple Pages projects
- sends Discord notifications for start, success, failure, skipped

Strengths:

- directly validates the Pages-polling fallback design
- compact
- easy to understand
- works without Cloudflare generic-webhook eligibility

Weaknesses:

- Discord-specific
- Pages only
- polling rather than native notification events
- no Workers/direct-CI coverage
- state/history is intentionally minimal

**Good reference for the Pages watcher.**

---

### C. `WalshyDev/cf-pages-await`

Repository / Marketplace:

- https://github.com/WalshyDev/cf-pages-await
- https://github.com/marketplace/actions/cloudflare-pages-await

What it does:

- waits in GitHub Actions for a Pages build to complete
- exposes deployment status/URL/environment
- can integrate with GitHub Deployments

Strengths:

- established GitHub Actions pattern
- useful if deployment flow is entirely GitHub-controlled

Weaknesses:

- CI-centric
- does not create an account-wide Cloudflare observer
- can miss deployments initiated outside that workflow

**Useful building block, not a universal notifier.**

---

### D. `dfface/cloudflare-pages-notification`

Repository:

- https://github.com/dfface/cloudflare-pages-notification

What it does:

- builds on the Pages-await pattern
- Slack / Feishu / custom webhook notifications
- can include failed-deployment logs

Strengths:

- already demonstrates custom webhook templating
- convenient for GitHub Actions users

Weaknesses:

- Pages only
- CI-centric
- no Workers Build Event Subscription
- no account-wide reconciliation

**Useful reference for GitHub Actions notification behavior.**

---

### E. Cloudflare official `wrangler-action`

Repository:

- https://github.com/cloudflare/wrangler-action

What it does:

- officially runs Wrangler from GitHub Actions
- exposes stdout/stderr and deployment outputs

Strengths:

- official
- works for Workers and Pages commands
- gives this notifier enough CI context to report direct-deploy success/failure

Weaknesses:

- it deploys; it is not an account-wide notification service

**Use it as the preferred GitHub CI deployment primitive, then report the result to this service.**

---

## 13. Options considered

### Option 1 — Cloudflare built-in notifications only

Pages:
- built-in Project updates notification.

Workers:
- official Workers Builds Event Subscription template.

Pros:

- low custom code,
- Cloudflare-native.

Cons:

- split systems,
- webhook delivery for Cloudflare Notifications is plan-dependent,
- no unified message/config/history,
- direct Wrangler failure coverage is incomplete.

Best when:

- you only need simple email/Slack notifications and do not care about one centralized system.

---

### Option 2 — GitHub Actions only

Every deployment workflow sends a success/failure notification.

Pros:

- simplest when every deploy is GitHub-controlled,
- catches command failures.

Cons:

- misses Cloudflare-native/manual/deploy-hook paths,
- duplicates logic across repositories unless converted into a reusable workflow,
- no independent reconciliation.

Best when:

- an organization guarantees all deploys go through one GitHub workflow.

Not recommended as the sole design for `cf-deploy-status`.

---

### Option 3 — Poll everything

Cron Worker polls Pages and Workers APIs.

Pros:

- easy conceptual model,
- works across many successful deployment sources.

Cons:

- delayed,
- extra API calls,
- Workers deployment history cannot reveal failed attempts that never became deployments,
- weaker than native Workers build events.

Useful as reconciliation, not as the only source.

---

### Option 4 — Hybrid event + reconciliation + CI reporter

Pros:

- strongest coverage,
- mostly real-time,
- catches Cloudflare-native events,
- catches controlled CI failures,
- reconciliation repairs missed success events,
- supports main/staging/preview consistently,
- creates a clean foundation for a future status UI.

Cons:

- more code than a single webhook,
- needs careful dedupe.

**Recommended.**

---

## 14. Implementation phases

### Phase 1 — Core notifier

Implement:

- TypeScript Worker
- normalized event type
- Queue consumer
- KV dedupe
- Discord or chosen first destination
- generic webhook destination
- structured logs
- tests for normalization and dedupe

Acceptance:

- manually enqueue success/failure fixtures and receive exactly one notification per unique event.

---

### Phase 2 — Workers Builds native events

Implement:

- create `cf-deploy-events` Queue
- configure Event Subscription source `workersBuilds.worker`
- subscribe to:
  - `build.started`
  - `build.succeeded`
  - `build.failed`
  - `build.canceled`
- parse official event schema
- enrich failure/success where useful

Reference command pattern:

```bash
wrangler queues subscription create cf-deploy-events \
  --source workersBuilds.worker \
  --events build.started,build.succeeded,build.failed,build.canceled \
  --worker-name <consumer-worker-name>
```

Acceptance:

- intentionally successful Workers Build -> started + success notifications.
- intentionally broken Workers Build -> started + failure notification.

---

### Phase 3 — Pages

Implement both ingestion modes behind one normalized adapter.

#### Preferred when generic webhook is available

Create Cloudflare Pages Notification policy:

- alert type: `pages_event_alert`
- events:
  - deployment started
  - deployment failed
  - deployment success
- selected projects/environments
- generic webhook destination:
  - `https://<worker>/v1/events/cloudflare/pages`

Authenticate using `cf-webhook-auth`.

#### Fallback / reconciliation

Scheduled handler:

```text
*/1 * * * *
```

or configurable cadence.

For each Pages project:

- fetch latest deployments,
- detect unseen deployment/status combinations,
- enqueue normalized events.

Acceptance:

- main production deploy,
- staging branch deploy,
- failed preview build,
- skipped deployment,
- no duplicate alert on the next cron.

---

### Phase 4 — Direct Wrangler / GitHub Actions reporter

Add:

```text
POST /v1/events/ci
```

Create a reusable snippet/workflow for deployment repositories.

Concept:

```yaml
- name: Deploy
  id: deploy
  uses: cloudflare/wrangler-action@v4
  continue-on-error: true
  with:
    apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    command: deploy --env staging

- name: Report deployment status
  if: always()
  # POST normalized status plus relevant Wrangler outputs to cf-deploy-status

- name: Preserve deploy failure
  if: steps.deploy.outcome == 'failure'
  run: exit 1
```

The exact reusable workflow/action should be created during implementation so consuming repositories only need a few lines.

Acceptance:

- successful direct Worker deploy reported.
- intentionally invalid deploy reported as failed.
- GitHub job still fails when deployment fails.
- notification failure must not hide the actual deployment result.

---

### Phase 5 — Workers reconciliation

On a slower cron, for configured Workers:

- query latest Worker deployments,
- detect unseen successful deployment IDs,
- emit recovered success events.

This catches successful direct/manual deployments that bypassed the CI reporter.

Do not pretend this catches direct-deploy failures.

---

### Phase 6 — Optional D1 + status page

Only after notifications are stable:

- D1 deployment ledger,
- `GET /api/deployments`,
- tiny status/history UI,
- filters by project/environment/status,
- latest main/staging state,
- failure timeline.

This should not block the notifier MVP.

---

## 15. Testing plan

### Unit tests

Fixtures:

- Workers `build.started`
- Workers `build.succeeded`
- Workers `build.failed`
- Workers `build.canceled`
- Pages webhook success/failure
- Pages API active -> success transition
- Pages API active -> failure transition
- duplicate event
- malformed payload
- CI success
- CI failure

Verify:

- normalization,
- environment mapping,
- idempotency key,
- error truncation/redaction,
- destination payload formatting.

### Integration tests

Use mocked Cloudflare API + webhook destination.

Test:

- Pages poller emits once.
- destination 500 -> Queue retry.
- destination 429 -> delayed retry.
- poison event -> eventually DLQ.
- duplicate native + reconciliation event -> only one final user notification when they represent the same deployment state.

### Live smoke tests

Create test projects/environments and intentionally trigger:

1. Workers success
2. Workers build failure
3. Pages production success
4. Pages preview success
5. Pages build failure
6. direct Wrangler success
7. direct Wrangler failure

---

## 16. Operational rules

- Never log webhook URLs or API tokens.
- Use structured logs with `eventId`, project, source, and status.
- Preserve raw payloads only when needed for debugging; do not persist secrets/log dumps.
- Cap chat error excerpts.
- Use Queue retry for transient destination failures.
- Add a DLQ.
- Expose `GET /healthz`.
- Consider a protected `POST /v1/test` endpoint that sends a synthetic notification.
- Do not let notification delivery failure change whether a deployment itself is considered successful.
- Reconciliation jobs should be idempotent.
- Keep Cloudflare API permissions read-only for the observer whenever possible.

---

## 17. Suggested first milestone

The smallest version that is already useful:

```text
Workers Builds Event Subscription
        │
        ▼
cf-deploy-events Queue
        │
        ▼
cf-deploy-status Worker
        │
        ├── KV dedupe
        └── Discord/generic webhook

Pages cron watcher ────────────────┘
```

Then add CI reporting.

This yields high value without requiring a dashboard or database.

---

## 18. Recommended decision

Build this repository rather than adopting one third-party project unchanged.

Reuse ideas/code patterns from:

- Cloudflare official Workers Builds template for native build-event processing,
- `sunpech/cloudflare-pages-discord-notifier` for Pages polling/state transitions,
- Cloudflare `wrangler-action` for direct CI deploy outputs,
- `cf-pages-await` / `cloudflare-pages-notification` for Pages CI behavior.

The repo should own:

- source normalization,
- main/staging mapping,
- dedupe,
- retries,
- destination adapters,
- reconciliation,
- security model.

That is the part none of the researched projects provides as one coherent system.

---

## 19. Source list

### Official Cloudflare

- Workers Builds Event Subscriptions  
  https://developers.cloudflare.com/workers/ci-cd/builds/event-subscriptions/
- Event Subscriptions overview  
  https://developers.cloudflare.com/queues/event-subscriptions/
- Event schemas  
  https://developers.cloudflare.com/queues/event-subscriptions/events-schemas/
- Manage Event Subscriptions  
  https://developers.cloudflare.com/queues/event-subscriptions/manage-event-subscriptions/
- Cloudflare Notifications  
  https://developers.cloudflare.com/notifications/
- Available Notifications / Pages Project updates  
  https://developers.cloudflare.com/notifications/notification-available/
- Configure generic webhooks  
  https://developers.cloudflare.com/notifications/get-started/configure-webhooks/
- Webhook payload schema  
  https://developers.cloudflare.com/notifications/reference/webhook-payload-schema/
- Alerting API  
  https://developers.cloudflare.com/api/resources/alerting/
- Pages Deployments API  
  https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/deployments/
- Workers Deployments API  
  https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/
- Workers Versions & Deployments  
  https://developers.cloudflare.com/workers/versions-and-deployments/
- Queue retries / batching  
  https://developers.cloudflare.com/queues/configuration/batching-retries/
- Dead Letter Queues  
  https://developers.cloudflare.com/queues/configuration/dead-letter-queues/

### Open source / implementation references

- Cloudflare Workers Builds notifications template  
  https://github.com/cloudflare/templates/tree/main/workers-builds-notifications-template
- Cloudflare Wrangler Action  
  https://github.com/cloudflare/wrangler-action
- Cloudflare Pages Discord Notifier  
  https://github.com/sunpech/cloudflare-pages-discord-notifier
- CF Pages Await  
  https://github.com/WalshyDev/cf-pages-await
- Cloudflare Pages Notification  
  https://github.com/dfface/cloudflare-pages-notification
