# Application Recovery Boundary v2

This application boundary exposes authenticated, read-only access to the
Match Persistence/Recovery v2 service. It receives `IdentityService` and
`recoveryService` through dependency injection and has no knowledge of
Firestore or any storage SDK.

## Authorization flow

Every operation first calls `IdentityService.requirePermission` with the
existing `match.view` permission, or `match.result.read` for result access.
Identity v2 validates that the principal was minted by that service and that
its session is still valid. The effective user ID always comes from the
returned principal. The boundary then loads the persisted match and checks
membership only against the stored authoritative snapshot roster. Missing
membership evidence fails closed, including when a locked result exists.
Roles and permissions in caller payloads are never accepted.

## Operations

- `recoverMatch(principal, matchId)` returns the recovery state and
  replay/action-required indicators determined by Match Persistence. It
  propagates `ABORT_REQUIRED` explicitly.
- `getMatchMetadata` returns a safe metadata projection, lifecycle, schema,
  state/event/result versions, rules version, timestamps, and recovery state.
- `getMatchSnapshot` returns only the persisted authoritative snapshot.
- `getMatchEvents` returns persisted events from an optional inclusive
  `fromSequence` cursor. It cannot append, reorder, or change their sequence.
- `getMatchResult` requires a persisted, validated, locked result and the
  existing `match.result.read` permission.

Outputs are cloned and frozen; reads do not mutate the loaded aggregate.
Inputs are restricted to IDs and the read cursor. Financial values, caller
winner/payout/amount/balance/fee, settlement data, credentials, roles, and
permissions are rejected or never accepted.

## Recovery boundary and safety

Recovery statuses retain Match Persistence semantics:
`NOT_FOUND`, `RECOVERABLE`, `RESULT_LOCKED`, `SETTLING`, `SETTLED`, and
`ABORT_REQUIRED`. Integrity errors are converted to safe, deterministic
application errors without stack traces or storage details.

This boundary never runs the Game Engine or replays events. A replay-required
condition is reported to an authorized higher-level orchestrator; no state is
invented, repaired, or silently rewritten. It does not invoke Economy or
Settlement and cannot modify wallets, ledgers, results, snapshots, events,
or lifecycle.

The only dependency after authorization is the injected
Match Persistence/Recovery interface. No HTTP endpoint or Socket.IO handler
is implemented. The legacy runtime remains disconnected and unchanged.
