# Controlled Integration / V2

Isolated orchestration layer that exercises the WinOrbs 2.0 V2 stack through a
full match lifecycle without deploying anything, without touching the legacy
runtime, and without modifying CLOSED layers. It is a test/integration module
only: it never routes production traffic and never exports a network server.

## What it does

`createControlledEnvironment(options)` assembles a self-contained environment
from existing V2 packages:

- Bootstrap root (`bootstrap/v2`) wired with an injected Identity service and
  observability sink.
- Runtime Integration Boundary (`runtime-integration/v2`) with a controlled
  routing policy (allowlist for the controlled match only, rollout 0,
  kill switch off by default).
- Production Adapter (`production-adapter/v2`) bootstrapping the same root for
  the assigned V2 instance.
- In-memory persistence repositories and a controlled clock from the Runtime
  Harness (`runtime-harness/v2`).
- A tx-aware Idempotency repository wrapper on top of the injected persistence.

`runControlledMatchFlow()` then performs the complete lifecycle:

1. Seeds the durable match aggregate in Match Persistence and creates the
   coordinator match.
2. Resolves the runtime assignment and asserts V2 authority.
3. Starts the V2 instance through the Production Adapter.
4. Authenticates two controlled players, joins and marks them ready.
5. Runs countdown and start transitions, persisting lifecycle status and
   authoritative snapshots at every stage
   (`WAITING → READY → COUNTDOWN → RUNNING`).
6. Executes three game commands with ticks, persisting state and events.
7. Reads snapshot and events through the Application service.
8. Finishes the match, persists `FINISHING`, locks the result and finalizes it
   (`RESULT_LOCKED`, `result-v1`).
9. Runs Application Recovery and re-reads runtime authority, asserting it is
   unchanged.

Every stage emits `controlled.integration` observability events carrying the
correlation ID and match ID; no credentials or secrets are passed to the sink.

## Options

```js
const { createControlledEnvironment } = require('./packages/controlled-integration/v2');

const env = createControlledEnvironment({
    matchId: 'controlled-v2-match',     // default
    correlationId: 'controlled-<matchId>',
    idempotencyKey: 'controlled-<matchId>',
    clock,                              // optional controlled clock
    randomSource,                       // optional deterministic source
    routingPolicy,                      // optional runtime routing policy override
    persistence                         // optional repositories (default in-memory)
});
```

## Exports

- `createControlledEnvironment(options)` — returns the frozen environment:
  `matchId`, `correlationId`, `idempotencyKey`, `root`, `persistence`,
  `integrationBoundary`, `adapter`, `emitted`, `clock`, `randomSource`,
  `getBootstrapCount()`, plus helpers (`resolveControlledAssignment`,
  `startControlledInstance`, `checkAuthority`, `authenticatePlayer`,
  `runControlledMatchFlow`, `emit`).
- `createControlledIdentity(clock)` — minimal Identity adapter kit backed by
  two controlled player credentials and one system credential.
- `SYSTEM_OPERATIONS` — `['startCountdown', 'startMatch', 'finishMatch',
  'lockResult']`, the only operations the controlled system credential can
  authorize.
- `CONTROLLED_INTEGRATION_ERRORS` — failure codes: `INVALID_REQUEST`,
  `AUTHORITY_FAILURE`, `ADAPTER_FAILURE`, `IDENTITY_FAILURE`,
  `APPLICATION_FAILURE`, `PERSISTENCE_FAILURE`, `RECOVERY_FAILURE`,
  `AUTHORITY_MISMATCH`, `OBSERVABILITY_FAILURE`.

## Behavior notes

- The flow fails closed at the first error and returns
  `{ ok: false, error: { code, ...details } }` with a `stage` marker where
  applicable.
- If the routing policy routes the match to `LEGACY` (kill switch, denylist or
  disabled routing), assignment resolution still succeeds but the flow stops
  with `AUTHORITY_FAILURE` before starting any instance: the bootstrap factory
  is never invoked and no V2 work occurs.
- `startAssignedMatch` against a `CLOSED` instance fails with the adapter's
  `CLOSED_INSTANCE`; the instance is never revived.
- Everything runs against in-memory repositories and a controlled clock, so
  repeated runs are deterministic and leave no state outside the environment.

# CONTROLLED V2 INTEGRATION CLOSED
