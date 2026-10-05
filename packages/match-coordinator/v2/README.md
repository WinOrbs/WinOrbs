# Match Coordinator v2

`createMatchCoordinator` is an in-process application layer around the v2
Game Engine. It coordinates temporary match membership, lifecycle transitions,
validated commands, ticks, domain-event collection, snapshots, and immutable
`MatchResult` locking.

Coordinator state, command deduplication, membership, events, and results live
only in process memory. A process restart loses them; this module does not claim
durability or implement crash recovery.

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
