# Game Domain

## Scope

The transport-independent public entry point is `packages/game`. It composes
the existing in-memory Match Coordinator and Game Engine; it does not copy or
rewrite their gameplay rules. `createGame(options)` initializes a fresh match
or restores a validated recovery record and returns a domain API for roster
changes, readiness, input, ticks, finalization, state, events, results, and
session reassociation.

This boundary is callable without starting the HTTP server, Express, Socket.IO,
or Firebase. It does not import application configuration, environment
variables, logging, or networking modules.

## Responsibilities

- **Match Coordinator** (`packages/match-coordinator/v2`): in-memory match
  lifecycle, player membership/readiness, session binding, command admission
  and ordering, event collection, snapshots, and result locking.
- **Game Engine** (`packages/game-engine/v2`): authoritative match state,
  movement, projectiles, damage, elimination, match resources, zone/timer
  progression, domain event generation, and deterministic result construction.
- **Legacy domain helpers** (`apps/server/game`): extracted pure rules for the
  existing live runtime, including lifecycle, combat, score, team-mode,
  MatchOrbs, result, and finalization helpers. They remain in use where wired
  by `server.js`; this phase does not replace the legacy `GameRoom`.

## API

```js
const { createGame } = require('../packages/game');

const game = createGame({
    matchId: 'match-123',
    clock: () => currentTime,
    rules: { matchDurationMs: null }
});

game.joinPlayer(actorId, sessionId);
game.markReady(actorId, sessionId);
game.startCountdown();
game.start();
const accepted = game.handleInput(validatedCommand);
const frame = game.tick();
const snapshot = game.getState();
const history = game.getEvents();
const result = game.finish('ABANDONED');
```

Every operation returns the existing coordinator/engine result shape, including
`ok`, error codes on rejection, snapshots, and newly generated events where
applicable. `getState()` returns `{ ok, snapshot }`; the snapshot contains the
match lifecycle, membership/readiness projection, and authoritative
`gameState`. `getEvents()` returns the immutable accumulated domain-event
history, and `getResult()` returns the locked result when one exists.

Commands retain the versioned contract: caller-supplied `schemaVersion`,
`commandId`, `matchId`, `actorId`, `sessionId`, per-session `sequence`, `type`,
and `payload`. The domain validates this input and enforces roster/session
binding, ordering, duplicate handling, and game rules. Authentication and
authorization of the identity represented by those IDs remain the caller's
responsibility.

## State and events

Match state is in-memory and match-scoped. The engine returns detached,
immutable snapshots and validated, sequenced domain events such as
`PlayerMoved`, `DamageApplied`, `PlayerDied`, `PlayerKilled`, `ScoreUpdated`,
and `MatchFinished`. Events are returned to the caller; the domain does not
emit Socket.IO messages, log, or persist them. The accumulated history is
available for deterministic assertions or for an application-layer persistence
port.

## Dependencies and determinism

```text
transport / application adapter
  └── packages/game
       └── packages/match-coordinator/v2
            ├── packages/game-engine/v2
            └── packages/contracts/v2
```

`clock` is a required injected function at the public boundary and is used for
timestamps, cooldowns, respawn timing, and result times. Game simulation
currently has no random decisions, so no RNG is injected; introducing one
would add needless indirection until a domain rule actually needs randomness.
The coordinator accepts validated recovery data as input and can reassociate an
already-present player with a newly authenticated session. It has no database
client or persistence side effect; durable loading/writing belongs to the
application adapter.

## Transport boundary and migration status

The live root `server.js` still owns its legacy `GameRoom`, its timers, and
Socket.IO event handlers. Its gameplay rules and the prepared v2 engine are not
assumed interchangeable. This phase exposes and tests the already-existing v2
domain behind a small API but deliberately does not switch the live server to
it, alter wire payloads, or change gameplay. Future adapter work must first
characterize and reconcile rule/state differences before routing production
traffic through this API.
