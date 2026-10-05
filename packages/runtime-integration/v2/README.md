# Runtime Integration Boundary v2

This module is a backend-only boundary for selecting and persisting the runtime
authority of a match. It prepares gradual migration but does not route
production traffic or start either runtime.

## Authority and persistence

`resolveRuntimeAssignment(context)` accepts a match ID and optional
authenticated user/session context, correlation ID, requested-mode assertion,
and idempotency key. It does not accept a caller-selected runtime. The server's
injected routing policy selects only `LEGACY` or `V2`.

The assignment is stored as the single `runtimeAssignment` field on the
existing match aggregate through `MatchRepository`, inside
`runInTransaction`. The same transaction claims `IdempotencyRepository`.
Concurrent requests read/write the same match document and durable idempotency
records, so the transaction adapter serializes/retries conflicts and observes
the winning assignment. Malformed or duplicate-assignment records fail closed.
There is no in-memory authority store and no new Persistence implementation.

This relies on the Persistence v2 adapter's documented transactional
read/write behavior and on use of the same aggregate match ID by future
match-creation integration. It does not create matches itself. If an adapter
cannot provide transactional conflict detection for `MatchRepository` and
`IdempotencyRepository`, it must not be used for routing.

`activateMatch`, `finishMatch`, and `abortMatch` persist lifecycle changes in
the same match aggregate. Legal transitions are `ASSIGNED` to `ACTIVE` or
`ABORTED`, and `ACTIVE` to `FINISHED` or `ABORTED`. Terminal states cannot
change. Runtime, assignment ID, policy version, and assignment time are
immutable. Repeated assignment resolution returns the persisted assignment,
including its current lifecycle status; a request for a different mode is
rejected.

## Routing policy and rollout

The default policy is intentionally inactive:

```js
{
  enabled: false,
  rolloutPercentage: 0,
  allowlist: [],
  denylist: [],
  testUsers: [],
  testMatches: [],
  killSwitch: true,
  policyVersion: 'runtime-routing-v1'
}
```

The policy is validated at construction and is immutable for the service
instance. Denylist takes precedence. When enabled and the kill switch is off,
an allowlisted match/user or test match/user receives V2; otherwise a stable
SHA-256 bucket derived from policy version and match ID is compared with the
configured percentage. Zero percent blocks V2; 100 percent selects V2 for
eligible, non-denied matches.

The kill switch only affects matches with no persisted assignment. Existing
V2 assignments remain V2, even when ACTIVE and even after a process restart.
If a caller supplies `requestedMode`, it is an assertion that must equal the
server policy decision (or the existing sticky assignment); it never overrides
the decision.

## Idempotency, concurrency, and recovery

Each match uses a stable default idempotency key, or a caller-supplied
idempotency key scoped to that match. The request fingerprint binds the key to
match, authenticated user/session context, and requested-mode assertion. A
reused key with an incompatible fingerprint is rejected. Durable assignment
and idempotency writes occur in one persistence transaction.

After a crash/restart, the boundary reads the assignment from the persisted
match aggregate and returns it; it does not rerun rollout selection or
silently repair state. `ASSIGNED`, `ACTIVE`, `FINISHED`, and `ABORTED` are all
preserved. A malformed, mismatched, or duplicate assignment representation is
reported as `AUTHORITY_CONFLICT`.

## Observability

Decisions are sent through the injected Observability v2 `logEvent` port, not
console output. Events cover creation, reuse, rejection, V2 being blocked,
kill-switch decisions, and authority conflicts. They carry correlation ID,
match ID, assignment ID/runtime when available, policy version, status, and
outcome. No credentials or secrets are passed to the sink. An observability
failure is surfaced as `OBSERVABILITY_ERROR`; persistence may already have
committed, so a retry recovers the same sticky assignment and can emit a new
decision event.

## Runtime boundaries

`LEGACY` is only an authority label; this package never imports, invokes, or
duplicates the legacy server. `V2` is likewise only an assignment. Future
integration may resolve it to Bootstrap v2, which composes Application,
Coordinator, and Engine. This package does not start Bootstrap or create a
second Application API.

There are no HTTP endpoints, Socket.IO events, workers, timers, background
processes, external feature-flag clients, Firebase SDK access, or direct
Firestore access. It has no gameplay, economy, settlement, progression, or
administration mutation logic. An Administration override is not provided.

Future production cutover should add a narrow selection call at the point a
new match is created, using authenticated server context and the same durable
match ID. Existing matches must continue through their persisted authority;
the legacy runtime remains unchanged until a separately reviewed integration
enables routing.
