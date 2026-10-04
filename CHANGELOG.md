# Changelog

All notable changes to this project are documented here.

The project follows Semantic Versioning for both the deployed Worker contract and the root composite GitHub Action.

## [Unreleased]

### Added

- Separate `/healthz` liveness and `/readyz` configuration readiness endpoints.
- One-click Deploy-to-Cloudflare packaging and binding descriptions.
- Manual production dogfood workflow with real self-deployment, readiness verification, synthetic lifecycle events, optional Workers Builds subscriptions, and self-reporting through the composite Action.
- Semver release workflow that validates immutable `vX.Y.Z` tags and advances compatible `vX` / `vX.Y` Action tags.
- Integration coverage for HTTP ingestion, readiness, Queue acknowledgement/retry behavior, per-destination receipts, Pages polling, and Workers reconciliation.
- Reproducible npm lockfile and locked CI installs.
- v1 release/dogfood checklist.

### Changed

- Public GitHub Action examples now target `Ni-zav/cf-deploy-status@v1` rather than the mutable default branch.
- Wrangler is pinned to `4.146.0`.
- Vitest is upgraded from vulnerable `4.0.0` to patched `4.1.11`.
- Workers Builds subscription setup is idempotent when rerun.

### Fixed

- Empty-project readiness warnings now distinguish disabled polling from direct event sources, including subscribed Workers Builds.
- Deployment and dogfood configuration preparation now accept JSONC comments and trailing commas while rejecting malformed input before deployment.
- The installation deploy command now derives an isolated DLQ when the Deploy-to-Cloudflare form renames the main Queue but retains the template's default DLQ name.
- Deploy-to-Cloudflare setup no longer declares optional destinations as mandatory secrets or duplicates ordinary Wrangler variables as masked inputs. Destination secrets are configured after deployment.
- Dogfood deployments with a custom Worker name now isolate their event Queue and DLQ instead of sharing the production notifier's consumer.
- Generic webhook destinations hosted by another Worker on the same zone now use public fetch routing instead of failing with Cloudflare error 1042.
- Fixed Workers deployment-history reconciliation to parse Cloudflare's live `result.deployments` response shape; the mismatch was discovered during authenticated dogfood deployment and is covered by a regression test.

- Events are no longer acknowledged as processed when zero notification destinations are configured; they retry and can reach the DLQ instead.
- Invalid `PROJECTS_JSON` is surfaced by readiness checks rather than looking like an empty valid configuration.

### Reliability notes

- Queue delivery is explicitly documented as at-least-once.
- KV-backed deduplication is explicitly documented as best-effort because Workers KV is eventually consistent.
- Generic webhook consumers are encouraged to use `event.eventId` as their own idempotency key.

## [1.0.0]

Reserved for the first release that completes the real Cloudflare dogfood matrix in `docs/RELEASE.md`.
