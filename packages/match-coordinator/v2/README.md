# Match Coordinator v2

`createMatchCoordinator` is an in-process application layer around the v2
Game Engine. It coordinates temporary match membership, lifecycle transitions,
validated commands, ticks, domain-event collection, snapshots, and immutable
`MatchResult` locking.

Coordinator state, command deduplication, membership, events, and results live
only in process memory. `restoreFromPersistedState` can hydrate validated data
supplied by the recovery composition, but the Coordinator does not read durable
storage, authorize recovery, or replay events.

`restoreFromPersistedState(recovery)` is the explicit internal restoration path
for a new Coordinator. The caller must provide a validated persisted snapshot,
complete event history/cursor, lifecycle and version metadata, and a locked
result when the lifecycle requires one. The Coordinator validates the match,
schema/rules versions, roster/readiness projection, event continuity, cursor,
and result hash before installing any state. It does not create a fresh match,
replay commands, recalculate results, or emit events while restoring. `WAITING`
through `SETTLED` are retained; `SETTLING` and `SETTLED` keep the Engine's
authoritative final GameState at `RESULT_LOCKED`.

The Coordinator accepts actor IDs from its caller but does not authenticate
tokens. A future Identity/transport layer must establish that principal before
calling it. Lifecycle methods such as `startMatch` and `finishMatch` are
application-only operations and must never be exposed as client commands. It
does not publish transport events or perform persistence, settlement, or
economy operations.

Membership holds a private session binding and an independent `ready` flag for
each actor. A player may mark only their own membership ready, using the session
bound when they joined; repeating that operation is idempotent. Snapshots expose
member IDs and ready/not-ready IDs, but never expose the bound session IDs.
After restoration, those ephemeral bindings start empty. The internal
`reassociatePlayerSession(matchId, actorId, sessionId)` operation can replace a
binding only for an actor already in the restored roster. It changes no roster,
readiness, lifecycle, events, result, or persisted cursor. Repeating the same
binding is idempotent; the newest authenticated binding replaces the previous
one, and one session cannot be bound to two actors. Application v2 is the
authentication boundary that may invoke this operation.
Concurrent reassociations are applied synchronously; the last operation reaching
the Coordinator is the single effective binding.

The global lifecycle becomes `READY` only when there are at least two current
members and every current member is ready. With fewer than two members it stays
`WAITING`, even when all are individually ready. `markReady` does not start the
countdown; the trusted application operation `startCountdown` remains explicit.
Players may join or leave while the lifecycle is `WAITING` or `READY` and before
countdown. A newly joined member starts not ready, so joining while `READY`
returns the lifecycle to `WAITING`. Leaving removes only that member and
recalculates readiness; remaining members retain their own readiness. Once
countdown begins, membership and readiness changes are rejected.

The Coordinator exposes the lifecycle through `RESULT_LOCKED`; settlement
states remain outside its API.
