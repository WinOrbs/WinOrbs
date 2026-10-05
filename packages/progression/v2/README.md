# Progression v2

Progression v2 is an independent, server-authoritative domain for XP, levels,
mission progress, and non-economic progression rewards. It does not expose HTTP
or Socket.IO handlers and is not connected to the production runtime.

## Authority and accepted facts

The service accepts only identifiers:

- `processGameEvent({ matchId, eventId })` loads the event from the persisted
  match aggregate and validates its contract, match association, sequence, and
  actor attribution.
- `processMatchResult({ matchId, resultId })` loads the result from the
  persisted match aggregate. It requires a locked result, a final lifecycle,
  matching result versions and identifiers, a valid MatchResult contract, and
  a valid result hash.

The caller cannot submit event/result contents, XP, a winner, rankings,
participant stats, mission progress/completion, level, or rewards. Unknown
request properties are rejected. A `PlayerKilled` event grants event XP only
to its recorded killer; environmental deaths do not grant kill XP. An
`OrbCollected` event must identify the same collector in both actor fields.

## XP and levels

The default policy is versioned as `progression-v1`, `xp-rules-v1`, and
`level-curve-v1`:

| Authoritative fact | XP |
| --- | ---: |
| `OrbCollected` | 2 to the collector |
| `PlayerKilled` with a killer | 10 to the killer |
| MatchResult participation | 25 to each participant |
| MatchResult first place | 50 bonus |
| MatchResult draw | 15 bonus to each participant |

XP is a non-negative safe integer and is added only from the configured policy.
Mission XP is added on server-calculated completion. The default level curve
uses `baseXpPerLevel: 100`; the cumulative XP threshold for level `L` is
`baseXpPerLevel * L * (L - 1) / 2`. Level 1 starts at zero XP.

Profiles record `schemaVersion`, `progressionVersion`, `xpRulesVersion`, and
`levelCurveVersion`. A profile retains its existing level-curve version when a
new policy is configured. The service requires that historical curve to remain
available; otherwise it fails with `UNSUPPORTED_PROFILE_VERSION`. XP totals
cannot decrease, and persisted level/progress invariants are checked before
updates.

## Missions and rewards

Mission definitions are injected configuration and require a mission ID,
version, title, description, category, objective, target, XP reward, reward
definition, and active flag. Objectives supported are:

- `MATCHES_PLAYED` and `MATCHES_COMPLETED`: one per participant in a valid
  MatchResult;
- `MATCHES_WON`: one for each participant in the first-place ranking;
- `ELIMINATIONS`: the participant's validated MatchResult kill statistic;
- `ORBS_COLLECTED`: one per persisted collection event.

Kill missions use the final MatchResult statistic rather than also consuming
kill events, preventing the same elimination from advancing a mission twice.
Mission progress is capped at its target, versioned independently by
`missionId@version`, and historical versions remain in the profile. Completion
is server-derived and irreversible. Completion automatically grants configured
`badge`, `cosmetic`, or `title` rewards; rewards are not money or wallet
operations. There is no public claim endpoint. A mission without a reward
definition has no claimable reward.

## Persistence, idempotency, and concurrency

The service uses the Persistence v2 `MatchRepository`,
`ProgressionRepository`, `RewardRepository`, and `IdempotencyRepository` ports
inside `runInTransaction`. Each persisted event/result has a durable
idempotency claim. Profile changes, completion XP, reward records, and the
claim are committed in the same transaction, so a retry or concurrent
duplicate does not apply the fact twice or grant a reward twice. The adapter
must provide the transaction semantics promised by Persistence v2.

Progression contains no Firestore SDK access. Tests use an in-memory fake of
the persistence ports and do not contact a live database.

## Integration boundary

Future Application integration must supply only authenticated internal
identity/context and stable persisted match/event/result identifiers. It must
not expose arbitrary user IDs as authority. Future Transport integration
should call the application boundary, not the service directly. Any future
economic effect must be handled by Economy/Settlement and their policies;
Progression has no dependency on either.

The service's `getProfile(userId)` and `getMissionReward(userId, ...)` methods
are internal read operations, not public authorization boundaries. Their
callers must authorize the user before exposing those records.

## Legacy distinction

This module does not depend on or migrate any legacy frontend, runtime,
leaderboard, inventory, store, or economy behavior. It defines only the v2
progression policy and persisted profile/reward records described above.
