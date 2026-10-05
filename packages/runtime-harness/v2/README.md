# Runtime Harness v2

This package is an in-memory integration harness for the WinOrbs 2.0
composition. It is a test tool, not a production runtime:

> Runtime Harness ≠ production runtime

It must not be deployed as a server and does not connect to network, cloud,
or production services.

## Composition and boundaries

The harness builds the service graph only through `createWinOrbsV2` from
Bootstrap v2. It injects an Identity adapter, a deterministic clock and random
source, a structured in-memory Persistence Ports fake, and an Observability
sink. Bootstrap composes the Coordinator, Application, Match Persistence,
Application Recovery, Economy, Settlement, and Observability services. The
harness does not construct those services itself, except for test adapters.

The fake repositories cover Match, User, Wallet, Ledger, Idempotency, Outbox,
Audit, Progression, Reward, Inventory, and Payment ports. Match writes run
through a serialized transaction queue and staged aggregate map. Financial
mutations are counted and recorded state can be inspected without creating a
second database.

## Integration flow

The scenario authenticates two distinct players, creates the match through
the Coordinator (Application v2 has no create-match operation), then uses
Application for join, readiness, command submission, countdown, start, and
finish operations. System actions use Identity-issued, operation-scoped
capabilities.

Commands, ticks, snapshots, and events are delegated to Coordinator/Game
Engine and persisted through Match Persistence. The Coordinator returns the
post-finish result snapshot in `RESULT_LOCKED`; Match Persistence records the
permitted `FINISHING` transition, then `finalizeResult` atomically persists
the final snapshot, locked result, lifecycle, and versions. Application
Recovery reads the persisted result and verifies final recovery without
replaying the Game Engine.

## Determinism and crash checks

Callers supply `controlledClock` and `controlledRandomSource`; the scenario
does not use wall-clock or ambient randomness. Match IDs, command IDs,
correlation IDs, and observation IDs are deterministic. Repeating a scenario
with the same inputs yields equivalent persisted snapshots, events, results,
and version cursors.

Crash checkpoints inspect recovery after creation, readiness, running,
event-only persistence, and result finalization. The FINISHING checkpoint
deliberately checks fail-closed recovery: the Coordinator does not expose its
transient FINISHING snapshot, so the persisted pre-final snapshot does not
match that intermediate lifecycle. Recovery must report an integrity error;
the harness does not fabricate a snapshot or repair the aggregate.

## Observability

The in-memory sink receives created, started, finished, result-locked, and
recovery events under one controlled correlation context. Tests check the
stable event envelope and absence of sensitive field names. Observability
does not drive gameplay or persistence.

## Excluded work

The harness does not start Express or Socket.IO, contact external services,
perform settlement, mutate Wallet/Ledger/Outbox, or implement XP, missions,
rewards, or gameplay rules. Economy and Settlement are only checked as
Bootstrap-composed services.

The legacy `server.js` runtime remains separate and unchanged. This harness
does not import or invoke it and must not be wired into the production runtime
as part of this step.
