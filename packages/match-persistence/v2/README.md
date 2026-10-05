# Match Persistence / Recovery v2

This isolated adapter stores match metadata, lifecycle/version cursors,
authoritative snapshots, validated events, and MatchResult through the
injected Persistence Ports v2 `MatchRepository`. It imports only those ports
and Contracts v2 validators. It does not run gameplay, replay events, compute
score or money, or call Economy, Settlement, transport, Firebase, or the
legacy runtime.

## Persisted record

The aggregate tracks `schemaVersion`, monotonically increasing `stateVersion`,
`eventSequence`, `resultVersion`, `rulesVersion`, lifecycle, snapshot cursor,
events, transitions, and recovery diagnostics. The service uses transactional
read/compare/write against `expectedStateVersion`; stale writers fail with
`STALE_VERSION`. Lifecycle transitions are explicit and recorded with their
new state version. `FINISHING -> RESULT_LOCKED` is performed atomically by
`finalizeResult` (or `lockResult` when supplied the final snapshot), which
persists the final snapshot, validated MatchResult, result lock, and lifecycle
transition in one transaction on the Match aggregate. A result cannot be
locked without its final `RESULT_LOCKED` snapshot.

Snapshots must contain the Coordinator-shaped match snapshot and a valid
Contracts-v2 GameState. Snapshot cursor/version are supplied separately,
timestamps are generated from the injected server clock, and older snapshot
versions are rejected. Snapshot reads return only that authorized snapshot
and lifecycle/version metadata; `loadMatch` returns a filtered match view.
Financial, credential, identity-claim, and administrative fields are rejected
from snapshot and metadata data.

Events must conform to Contracts v2. The adapter assigns their timestamp and
schema version, requires contiguous increasing sequence numbers starting at
one, rejects repeated event IDs, and persists the event history and cursor in
the same transactional match write. `loadEvents(matchId, fromSequence)` uses
an inclusive starting sequence.

## Results and recovery

Candidate MatchResults are validated with Contracts v2 and their canonical
SHA-256 hash is recomputed using the Game Engine v2 canonical JSON convention.
Results can only be saved while `FINISHING`. `finalizeResult` validates the
snapshot cursor against the persisted event sequence, requires a newer
snapshot version, and then writes the result and snapshot together with the
`RESULT_LOCKED` lifecycle and state version. The stored result is an envelope
with `locked: true` and the unchanged, validated MatchResult in `value`;
`loadMatch`, `loadResult`, and recovery reads expose that MatchResult without
the storage envelope. Identical finalization retries are idempotent, while a
different snapshot or result after lock is rejected. A locked result cannot be
replaced; attempted mismatches are recorded as diagnostics. Lifecycle moves
from `RESULT_LOCKED -> SETTLING -> SETTLED` require the expected state
version, and `SETTLED` also requires a settlement version reference. This
layer records that reference only; it does not attest to or execute financial
settlement.

`recoverMatch` validates stored metadata, snapshot, event continuity, result
hash/version, lock marker, and lifecycle. For `RESULT_LOCKED`, `SETTLING`, or
`SETTLED`, the final snapshot remains at `RESULT_LOCKED` and must match the
event cursor. A lifecycle/snapshot mismatch is reported as an integrity
diagnostic and is never repaired. Recovery returns `NOT_FOUND`, `RECOVERABLE`,
`RESULT_LOCKED`, `SETTLING`, `SETTLED`, or a structured
`RECOVERY_INCONSISTENT_STATE` diagnostic. When events are newer than the
snapshot it returns `replayRequired` and an action for a trusted caller to
replay through the authoritative engine. It never replays or invents state.
Invalid/gapped event history, snapshots ahead of the event cursor, invalid
result hashes, and lifecycle inconsistencies require explicit investigation
or abort handling.

The Persistence v2 ports have no dedicated snapshot/event repository or
conditional-update method. This implementation therefore embeds the event log
and snapshot in the match aggregate and relies on Firestore transaction
conflict detection from the adapter for competing writers. Event retention,
aggregate size limits, replay execution, abort policy, and a durable recovery
queue remain composition-level decisions and are not implemented here.
