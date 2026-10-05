# Production Adapter v2

This module is a production-safe adapter between the authoritative runtime selection boundary and the V2 bootstrap/application stack. It does not activate V2 traffic in production. It only decides whether an already-authoritative assignment should be handled by the legacy runtime or by the V2 runtime composition.

## Responsibility

- accept a `RuntimeAssignment` produced by the runtime integration boundary;
- keep the runtime authority fixed to the match;
- start a V2 instance only when `runtime === "V2"`;
- reuse an existing ACTIVE instance when the same match is requested again;
- never reuse a CLOSED instance;
- recover an existing instance after restart using the persisted assignment;
- close or release the instance when the match lifecycle ends;
- emit observability events without exposing secrets.

## Runtime authority

The adapter never decides the runtime by itself. The runtime assignment is treated as authoritative input.

- `LEGACY` handlers return `{ handled: false, runtime: "LEGACY" }`;
- `V2` handlers create or reuse a bootstrap instance bound to `matchId + assignmentId`;
- the adapter fails closed if an assignment or runtime is inconsistent.

## Match stickiness

A match remains bound to the same runtime and assignment for the full lifecycle.

- no LEGACY -> V2 transition;
- no V2 -> LEGACY transition;
- no second V2 instance for the same `matchId` when the authority is already assigned;
- no assignment rewrite after creation.

## Instance lifecycle: ACTIVE vs CLOSED

An instance is either `ACTIVE` or `CLOSED`. `closeInstance()` moves it to
`CLOSED`; that transition is terminal.

- `ACTIVE` may be reused for the same match. Reuse preserves `matchId`,
  `assignmentId`, `runtime`, and `policyVersion`.
- `ACTIVE` with a different assignment is rejected with `ASSIGNMENT_MISMATCH`.
- `ACTIVE` with a different runtime is rejected with `RUNTIME_MISMATCH`.
- `CLOSED` can never be reused, revived, silently replaced, re-executed, or
  moved back to `ACTIVE`.
- `startAssignedMatch()` against a `CLOSED` local instance first consults the
  persisted authority through the Runtime Integration Boundary
  (`getRuntimeAssignment`) for compatibility auditing, then fails closed with
  deterministic code `CLOSED_INSTANCE`. It never invents an `assignmentId`,
  never changes the persisted authority, never switches `LEGACY <-> V2`, and
  never creates a second authority for the same match.
- Concurrent starts for the same match cannot create two active instances;
  concurrent starts against a `CLOSED` instance both fail with
  `CLOSED_INSTANCE` without reviving it or changing the authority.

## Recovery

`recoverAssignedMatch(matchId, request)` restores the authoritative state for a known match.

- if a live ACTIVE V2 instance exists and agrees with the persisted authority, it is reused;
- if the local instance is `CLOSED`, recovery fails closed with `CLOSED_INSTANCE` without reviving it;
- recovery after restart depends on the persisted authority: if the local
  instance is absent and the persisted V2 assignment is valid and non-terminal,
  it is rebuilt only through the existing `startAssignedMatch()` path;
- if the persisted assignment is `LEGACY`, the adapter returns `handled: false` without bootstrapping a V2 instance;
- if the persisted assignment is `ABORTED`/`FINISHED`, the adapter rejects recovery without trying to rebuild state.
- if recovery maps to `ABORT_REQUIRED`, it is not repaired;
- any inconsistency between the local instance and the persisted authority
  produces `FAIL CLOSED` (`ASSIGNMENT_MISMATCH`, `RUNTIME_MISMATCH`, or
  `CLOSED_INSTANCE`) without mutating either side.

## Observability

The adapter uses an injected observability sink and emits events such as:

- `runtime.adapter.start.requested`
- `runtime.adapter.start.accepted`
- `runtime.adapter.start.reused`
- `runtime.adapter.start.rejected` (includes deterministic `CLOSED_INSTANCE`)
- `runtime.adapter.recovery` (includes `CLOSED_INSTANCE` when recovery meets a closed instance)
- `runtime.adapter.closed`

The event payload only contains metadata needed for auditability and correlation.

## Security and isolation

This module does not import or execute:

- server.js
- Express
- Socket.IO
- Firebase
- Firestore SDK
- legacy gameplay/economy code
- frontend code

It is intentionally a thin authority adapter and never calculates score, payouts, rewards, XP, or settlement results.

## Limits

This module intentionally does not:

- start HTTP endpoints;
- start Socket.IO servers;
- connect to production Identity/Firebase/Firestore;
- add business logic for gameplay, economy, settlement, or progression;
- force runtime transitions.

This module still does not activate V2 traffic in production. It only prepares the controlled boundary for a later rollout.
