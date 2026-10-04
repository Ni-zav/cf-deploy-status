# Release process

This repository ships two things from one versioned source tree:

1. the self-hosted `cf-deploy-status` Cloudflare Worker; and
2. the composite GitHub Action in `action.yml`.

The Worker is distributed through **Deploy to Cloudflare** / Wrangler. It is intentionally not published as an npm runtime package. The GitHub Action is consumed through semantic Git tags such as `@v1`.

## Current v1 evidence

The sanitized release-candidate evidence for the current v1 effort is tracked in `docs/releases/v1.0.0-rc-evidence.md`. Keep account-specific URLs, tokens, and raw screenshots local.

## v1 release gate

A v1 release is ready only when all of the following are true:

- [ ] `main` CI is green with `npm ci --legacy-peer-deps`.
- [ ] TypeScript and the full Vitest suite pass.
- [ ] `wrangler deploy --dry-run` passes.
- [ ] Runtime dependency audit passes.
- [ ] `GET /healthz` returns 200 independently of configuration.
- [ ] `GET /readyz` returns 200 for the intended production configuration.
- [ ] `GET /readyz` returns 503 with useful errors when destinations or required Cloudflare API credentials are missing.
- [ ] A real Workers Builds project emits started/succeeded/failed/canceled events into the Queue.
- [ ] A real Pages project is observed through polling and, when configured, the native Pages webhook.
- [ ] The direct GitHub Action / CI ingest path reports a real deployment.
- [ ] Synthetic succeeded/failed/canceled events reach every configured destination.
- [ ] A destination failure retries without redelivering to destinations that already succeeded.
- [ ] A permanently failing message reaches `cf-deploy-events-dlq`.
- [ ] No historical Pages/Workers deployment is replayed on bootstrap unless `NOTIFY_ON_BOOTSTRAP=true`.
- [ ] The README Deploy-to-Cloudflare path produces a working installation.
- [ ] `CHANGELOG.md`, `SECURITY.md`, examples, and version references are current.

Unit/integration tests cover the deterministic parts of this matrix. The real Cloudflare event rows are intentionally release evidence, not mocked substitutes.

## Dogfood workflow

Run **Actions → Dogfood Cloudflare deployment → Run workflow**.

The workflow:

1. installs exactly from `package-lock.json`;
2. builds a temporary dogfood Wrangler configuration;
3. deploys the Worker using `cloudflare/wrangler-action@v4`;
4. configures runtime secrets without committing them;
5. optionally creates missing Workers Builds subscriptions;
6. requires `/readyz` to pass;
7. sends synthetic succeeded, failed, and canceled events; and
8. reports the real dogfood deployment back through this repository's own composite Action.

### Required repository secrets

| Secret | Purpose |
|---|---|
| `CLOUDFLARE_API_TOKEN` | deployment credential used only by CI |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account containing the dogfood Worker |
| `CF_DEPLOY_STATUS_TOKEN` | `INGEST_SHARED_SECRET` for the deployed notifier |
| one of `CF_DEPLOY_STATUS_DISCORD_WEBHOOK_URL`, `CF_DEPLOY_STATUS_SLACK_WEBHOOK_URL`, `CF_DEPLOY_STATUS_GENERIC_WEBHOOK_URL` | notification destination |

For Pages polling, Workers reconciliation, or Workers Builds enrichment, also configure `CF_DEPLOY_STATUS_READ_TOKEN` as a **separate account-scoped read-only token**.

Optional destination secrets:

- `CF_DEPLOY_STATUS_GENERIC_WEBHOOK_SECRET`
- `CF_DEPLOY_STATUS_PAGES_WEBHOOK_SECRET`

Do not reuse a broad deployment token as the Worker's runtime read token.

### Repository variables

`CF_DEPLOY_STATUS_PROJECTS_JSON`

A JSON array used only by the dogfood deployment. For the complete v1 gate, include at least one real Pages project and one real Workers project.

Example:

```json
[
  {
    "product": "pages",
    "name": "example-site",
    "branchEnvironmentMap": {
      "main": "production",
      "staging": "staging"
    }
  },
  {
    "product": "workers",
    "name": "example-api",
    "branchEnvironmentMap": {
      "main": "production",
      "staging": "staging"
    },
    "reconcile": true
  }
]
```

`CF_DEPLOY_STATUS_WORKERS_BUILD_PROJECTS`

Optional comma- or space-separated Worker names. The dogfood workflow creates any missing Workers Builds event subscriptions idempotently.

`CF_DEPLOY_STATUS_WORKER_NAME`

Optional Worker name for the dogfood notifier. Defaults to `cf-deploy-status`.

## Real-event evidence

After the dogfood workflow is green, trigger deployments in the configured real projects:

| Path | Evidence expected |
|---|---|
| Workers Builds success | started + succeeded notification, branch/commit and deployment URL when available |
| Workers Builds failure | failed notification with sanitized short error context |
| Workers Builds cancel | canceled notification |
| Pages production | state transition from the Pages API; webhook too if enabled |
| Pages staging/preview | Cloudflare provider environment remains `preview`, normalized environment follows branch mapping |
| GitHub Action | real deployment result accepted by `POST /v1/events/ci` |
| destination partial failure | already successful destinations are skipped on Queue retry |
| poison message | message eventually visible in `cf-deploy-events-dlq` |

Record the workflow run and representative destination messages in the release PR.

## Delivery guarantee

Cloudflare Queues is at-least-once. KV receipts provide best-effort deduplication, but Workers KV is eventually consistent and is not an exactly-once transaction store.

For generic webhook receivers, use `event.eventId` as an idempotency key. If a future use case requires strict atomic deduplication, move receipt coordination to a stronger primitive such as Durable Objects rather than claiming stronger semantics from KV.

## Publishing v1

1. Merge the hardened release PR into `main`.
2. Confirm the merge commit's normal CI run is green.
3. Complete the real-event dogfood matrix above.
4. Create and push the immutable release tag from the verified `main` commit:

   ```bash
   git checkout main
   git pull --ff-only
   git tag v1.0.0
   git push origin v1.0.0
   ```

5. `.github/workflows/release.yml` re-validates the tagged commit, creates the GitHub Release, and advances the moving `v1` and `v1.0` Action tags.
6. For the first Marketplace publication, use the GitHub release UI to accept the Marketplace agreement if required and select **Publish this Action to the GitHub Marketplace**. That account-level agreement/checkbox cannot be safely automated from this repository.

Stable consumers should use:

```yaml
uses: Ni-zav/cf-deploy-status@v1
```

Security-sensitive consumers may pin the full release tag or commit SHA.

## Semver policy

- patch: fixes with no input/event contract break;
- minor: backwards-compatible sources, destinations, metadata, or Action inputs;
- major: breaking Action inputs, event schema, authentication contract, or deployment/configuration model.

The moving `v1` and `v1.x` tags are updated only after the immutable `v1.x.y` release tag passes the release workflow.
