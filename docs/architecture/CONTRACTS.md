# Contracts and Schema Boundaries

## Purpose

WinOrbs has distinct representations for in-memory game state, client/server
transport, and Firestore persistence. They may contain related data, but they
are not interchangeable schemas:

| Boundary | Representation | Validation owner |
|---|---|---|
| Domain | `GameState`, `GameEvent`, `MatchResult`, match lifecycle and progression profile values | Game Engine, Match Coordinator, Progression service |
| Transport | Versioned `GameCommand` and the Socket.IO request/response envelope | Socket.IO transport and Application service |
| Persistence | Match metadata, versioned snapshot wrapper, event history, locked result wrapper, progression profile and repository records | Match Persistence and Progression services; generic Firestore adapter is model-agnostic |

The browser-facing legacy Socket.IO protocol in `server.js` is a separate,
unversioned compatibility surface. It uses event names and payloads such as
`playerInput`, `playerShoot`, and `joinRoom`; it is not the `packages/*/v2`
protocol. The HTTP server currently exposes static assets, `/ping`, and
`/status`; it does not accept application JSON commands or results. Do not
implicitly route legacy payloads through v2 validators or change legacy wire
shapes as part of unrelated domain work.

## Versioning

`packages/contracts/v2` identifies the contract-family implementation; its
current serialized `schemaVersion` is **1**. The package directory version and
the document schema version are different concepts. Version 1 validators
strictly reject unrecognized schema versions and unknown fields. Optional
fields such as `GameCommand.clientTimestamp` and `MatchResult.policyReference`
are additive within version 1 and retain their existing meaning.

Do not change `schemaVersion` in place. When a breaking shape is needed, add a
new contract family/version with its own validators and entry point while
retaining this v1 validator for in-flight matches, stored snapshots, events,
and results. The application/transport adapter should select the validator
using an explicit version boundary. Remove the older validator only after
legacy traffic and persisted data have been migrated or expired. No implicit
coercion from unknown versions is supported.

Legacy production messages are not retroactively labeled v1: preserve their
compatibility behavior until a separately tested adapter migration is planned.

## Domain contracts

### Game commands

A `GameCommand` has `schemaVersion`, `commandId`, `sessionId`, `matchId`,
`actorId`, monotonic per-session `sequence`, `type`, and `payload`. Payloads
are exact per command type. Client timestamps are optional advisory data only;
the engine uses the injected server clock for cooldowns, respawns, events, and
results.

The Socket.IO v2 adapter validates the full command before forwarding it. It
also compares command actor/session IDs with the authenticated principal.
Application v2 validates again and reconstructs authoritative actor/session/
match identifiers from its authenticated context before execution. Transport
identity claims and client-authored health, damage, score, economy, or
administrative fields are rejected rather than trusted.

### Game events

Domain events have a common envelope:

```text
schemaVersion, eventId, matchId, sequence, timestamp, type, payload
```

Newly generated/persisted v1 events require `actorId` for actor-attributed
events (movement, attacks, damage, kills/deaths, dropped/collected orbs, loot
collection, respawn, and score). It is omitted for system/world events where
there is no player actor, such as zone updates, loot spawns, match start, and
match completion. For event types whose payload also names the acting actor,
the envelope and payload IDs must agree. `PlayerKilled.actorId` identifies the
killer, or the victim when there is no killer; `DamageApplied.actorId`
identifies the source (falling back to the target for environmental damage).

The read-compatible `validateGameEvent` retains the original v1 allowance for
an absent or nonmatching actor envelope when validating historical records.
New event producers and append writes use `validateNewGameEvent` for stricter
attribution. This avoids retroactively invalidating persisted v1 history while
ensuring new writes are consistent. A future schema version can make this
stricter rule universal after migration.

Event IDs and sequences are match-scoped, monotonically generated, and
validated before persistence or progression consumes them. The persistence
service assigns the server timestamp when accepting append requests, rather
than trusting a caller-supplied timestamp.

### Match results and progression

`MatchResult` is an immutable, money-free domain record with its own
`resultHash`; settlement/economy values are deliberately not part of it.
Progression profiles are separate persisted aggregates with both
`schemaVersion` and explicit progression, XP-rule, and level-curve versions.
Progression consumes validated authoritative game events and locked results,
not client-submitted score or XP.

## Persistence models

The Firestore v2 adapter maps repository operations to `v2_*` collections and
provides transactions, not universal model validation. This is intentional:
repository interfaces are model-agnostic. Typed application services validate
at the model boundary:

- Match Persistence validates match metadata, GameState snapshots, appended
  events, result hashes, lifecycle/version transitions, and recovered history.
- Progression validates persisted profile shape/version, authoritative stored
  events, and locked MatchResults before mutation or use.
- Economy and settlement validate their own request, ledger, idempotency, and
  settlement records independently of game contracts.

Persisted snapshots are not bare `GameState`s: they carry a state version,
event cursor, save timestamp, and value envelope. Match metadata has its own
`matchPersistence.schemaVersion`; embedded state/events/results preserve their
own contract `schemaVersion`. Readers fail closed on unsupported or
inconsistent versions instead of silently coercing records. Legacy `usuarios`,
`partidas`, and other browser/server collections remain a distinct persistence
model governed by their current adapters and Firestore Rules.

## Request/response boundaries

Socket.IO v2 requests use an exact envelope. Client events receive an
acknowledgement (or `transport:response` fallback) shaped as `{ ok, data }` on
success and `{ ok: false, error: { code, message } }` on failure. System
lifecycle operations are not client events. Authentication claims are sourced
from Identity, not event payloads.

The current Express surface has no JSON application request bodies. `/ping`
returns `{ ok: true, ts }`; `/status` is an operational health shape describing
Firebase/Firestore availability, not a game-domain contract. Static responses
and those diagnostics must not be mistaken for persisted or game schemas.

## Compatibility and tests

Contract tests cover required and optional fields, exact-key rejection,
invalid types and payloads, unsupported schema versions, actor consistency,
and supported additive v1 fields. Transport tests verify malformed nested
commands are rejected before the application handler runs. Persistence and
progression tests exercise validation on both incoming writes and stored
records/recovery. New schema versions should add parallel validators and
fixtures while keeping these v1 fixtures intact until migration is explicitly
complete.
