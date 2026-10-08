# Realtime Networking

## Network model

The production server is a single Node.js process. HTTP and Socket.IO share
the same server. Clients send frequent `playerInput` and discrete gameplay
events; the server owns authoritative simulation and room state. `GameRoom`
simulates active matches at 60 ticks/second and emits volatile `gameState`
snapshots every second tick (30 Hz). Lobby rooms emit at 1 Hz; empty rooms skip
the simulation and state broadcast. Volatile snapshots intentionally discard
stale frames rather than queueing them for a slow client.

Room creation/join/leave/admin changes also publish room-list or individual
events. The room-list broadcast is coalesced for normal membership churn.
`roomConfig` sends map geometry once on join/reset because losing the geometry
would make a snapshot unusable. Discrete combat sounds, announcements, and
lifecycle events remain event-driven.

## Baseline measurement

Measured locally before adding the instrumentation, with two connected players
in one free match on loopback:

| Measurement | Observation |
|---|---:|
| Active `gameState` snapshots | About 30 per second per player during gameplay |
| Lobby snapshots | 1 per second per player |
| Representative active snapshot | 5,526 JSON UTF-8 bytes |
| Snapshot without both players' `nick` and `skin` fields | 5,358 bytes |
| Repeated `nick` + `skin` cost in that two-player sample | 168 bytes/frame (~3%) |
| Sample window | 9 seconds, including the five-second start countdown |
| Player count | 2; not a peak-load or multi-room benchmark |
| Idle server observation after the test | ~1% CPU and ~86 MiB RSS; not an active-match CPU measurement |

The server emitted approximately 30 active frames/second per player once the
five-second countdown elapsed; the aggregate sample also included 1 Hz
countdown/lobby frames. At 5.5 KB and 30 Hz, a typical player receives about
165 KB/s of `gameState` JSON payload before transport framing/compression. Ten
players in one room would therefore be roughly 1.65 MB/s of server egress for
this representative snapshot, excluding other events and protocol overhead.
This is an estimate, not a capacity guarantee.

Measurements were a short local characterization, not a production load
test. Payload composition varies with players, bullets, dropped items,
explosions, hazards, and mutable map state. Tick cost, CPU under load, and
multi-match scaling must be read from the new runtime metrics under realistic
traffic before making further optimization decisions.

## State categories

| Category | Examples | Current delivery |
|---|---|---|
| High-frequency gameplay state | Player positions/health/shield/ammunition, projectiles, mutable dropped items, zone/hazards, countdown/game timers, mutable obstacle HP | `gameState` snapshot, 30 Hz in active gameplay; volatile |
| Low-frequency player/match metadata | Nickname, skin, team assignment, mode, room fee/capacity, cosmetic/progression display metadata | Some fields remain in snapshots because the existing client reads them from each `gameState`; `serverConfig`/room-list data is sent at connection or coalesced change |
| Event-driven state | Join/leave, static map geometry, discrete sounds, warnings, room lifecycle and result notifications | Dedicated Socket.IO events; `roomConfig` on join/reset, lifecycle changes when they occur |

Map geometry has already been separated from mutable HP via `roomConfig` and
`configVersion`; snapshots retain compact HP maps. Player snapshots already
use a client-facing whitelist, omit server-only identity/input/security
fields, round coordinates, and compact dropped-orb/kit objects to renderable
coordinates. These are effective existing optimizations and should be kept.

The short sample showed `nick` and `skin` account for only about 3% of the
two-player payload and are consumed from player state by the legacy game
client. Moving them to a new metadata event would change the client protocol
and introduce cache/reconnect ordering behavior for a small measured saving.
They remain in snapshots for now. No delta protocol or interpolation change is
justified by this measurement; correctness and the existing full-state
recovery model take priority.

## Runtime instrumentation

`apps/server/realtime/metrics.js` collects a rolling 60-second window and
`server.js` writes one `[REALTIME_METRICS]` JSON summary per minute to the
server log. It reports:

- incoming Socket.IO events/second and the top event names (including
  `playerInput`);
- gameState broadcasts/second and player-message delivery rate;
- sampled serialized gameState UTF-8 size and estimated payload bytes/messages
  per receiving socket;
- average, p95, and p99 callback tick duration;
- active matches (running or starting), connected sockets, process CPU
  percentage, and RSS memory.

Payload sizes are sampled once per room per 30 gameState broadcasts and reused
to estimate per-socket byte totals between samples. They count serialized JSON
payload bytes, not Engine.IO/Socket.IO framing, WebSocket/TCP headers,
compression, retransmission, or one-off outbound event bytes. The per-socket
breakdown stays in process memory for the current interval; logs contain only
aggregate per-player values and do not expose socket IDs. Inbound event names
are cardinality-bounded. Tick durations cover the scheduled room callback,
including update/state construction, emit dispatch, and occasional payload
sampling; they are not client RTT or end-to-end delivery latency.

There is no public metrics HTTP endpoint. The logging interval is unreferenced
so it does not prevent process shutdown. The bounded tick sample retains at
most 3,600 durations until the next report.

## Decisions and follow-up

- Preserve the 60 Hz simulation, 30 Hz active snapshots, 1 Hz lobby snapshots,
  volatile delivery, and current event names/payloads.
- Keep the prior room geometry and player-state reductions; they are backed
  by payload/use measurements and client compatibility tests.
- Do not separate `nick`/`skin`, implement deltas, or add client interpolation
  yet: the measured savings were modest, and current clients consume the fields
  directly.
- Use the new rolling tick/traffic/CPU/RSS metrics under representative
  multi-room and maximum-player loads before further changes. If p95/p99 tick
  times approach or exceed the 16.67 ms simulation budget, profile update and
  snapshot construction first.
- Compare payload sizes and per-player rates after real matches with bullets,
  dropped items, explosions, and full rosters; the two-player loopback sample
  does not characterize worst-case traffic.
