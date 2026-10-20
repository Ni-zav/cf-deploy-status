# Reliability case study: delivery receipts and failure isolation

This is a technical evidence companion to [the service README](../README.md).
It describes what the implementation does and which properties are established
by deterministic tests, without claiming exactly-once delivery.

## The failure the system has to survive

One deployment event can have several notification destinations. Suppose
Discord succeeds but Slack temporarily fails. Retrying the entire event from
the beginning would send Discord a duplicate. A Queue retry must instead
remember that Discord succeeded and send only to the unfinished destination.

```text
incoming event
  -> already processed? yes: ACK
  -> each destination:
       receipt exists? skip
       send; successful response -> store destination receipt
  -> all destinations finished -> mark whole event processed -> ACK
  -> any step fails -> retry, no whole-event processed marker
```

Two KV key families encode those states:

- `delivered:<eventId>:<destination>` records successful destination delivery.
- `processed:<eventId>` records successful completion across all destinations.

The per-destination marker is written **after** the send returns successfully.
That ordering cannot eliminate duplicates if delivery succeeds but KV storage
fails, so these are **best-effort idempotency** semantics, not exactly once.
Workers KV is eventually consistent; simultaneous deliveries can still race.

## Reproducible failure scenarios

The offline test `test/queue-failure-matrix.test.ts` exercises:

| Scenario | Assertion |
|---|---|
| Discord succeeds, Slack returns 503 | Queue retries, Discord receipt persists, whole event remains unprocessed |
| Slack succeeds on retry | Discord is skipped, event is marked processed and acknowledged |
| First event fails in a batch | Later event is still processed and acknowledged |
| KV read fails | No outbound send occurs; event retries |
| Malformed incoming queue message | It is acknowledged without logging its raw, potentially sensitive payload |

Run `npm ci --legacy-peer-deps && npm run check` locally. CI also checks the
suite. These tests use mocks; they are not a substitute for live Cloudflare
Queues, DLQ, provider outage, multi-region consistency, or rate-limit testing.
For real integration evidence, see [release workflow](RELEASE.md).

## Tradeoff and next step

For low-volume deployment notifications, eventual-consistency KV receipts are
a practical low-operational-cost default. If strict atomic coordination becomes
a requirement, put deduplication and delivery state in a transactional service
(such as a Durable Object) and design around the remaining unavoidable
external-send versus state-commit ambiguity.

Even that architecture does not magically make third-party webhooks exactly
once: downstream consumers should accept stable event IDs and deduplicate.
