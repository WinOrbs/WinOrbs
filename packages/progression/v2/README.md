# Progression v2

Progression v2 is the single server-authoritative domain for XP, levels,
mission progress, idempotency, and non-economic mission rewards. It exposes no
HTTP or Socket.IO handlers; the server runtime enters through the platform
adapter and supplies only a persisted, validated match result or event ID.

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

Mission definitions are versioned configuration and require a mission ID,
version, title, description, category, objective, target, XP reward, reward
definition, and active flag. Objectives supported are:

- `MATCHES_PLAYED` and `MATCHES_COMPLETED`: one per participant in a valid
  MatchResult;
- `MATCHES_WON`: one for each participant in the first-place ranking;
- `ELIMINATIONS`: the participant's validated MatchResult kill statistic;
- `ORBS_COLLECTED`: one per persisted collection event.

Kill missions use the final MatchResult statistic rather than also consuming
kill events, preventing the same elimination from advancing a mission twice.
The default v1 mission set is `elimination-one`, `collect-orbs`, `play-one`,
and `win-one`; existing definitions remain keyed by `missionId@version`.
Mission progress is capped at its target, versioned independently by
`missionId@version`, and historical versions remain in the profile. Completion
is server-derived and irreversible. Completion automatically grants configured
`badge`, `cosmetic`, or `title` rewards; rewards are not money or wallet
operations. There is no public claim endpoint. A mission without a reward
definition has no claimable reward.

Configured level cosmetics are also recorded in `RewardRepository` once their
server-derived level threshold is reached. Their deterministic IDs make a
retry safe, and reward creation commits with that event/result's profile update.

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

The legacy gameplay runtime locks and validates the result, writes a v2 match
aggregate through `MatchRepository`, then calls `processGameEvent` for its
server-generated events and `processMatchResult` for the stable result ID.
Only server-derived UIDs and match facts enter that adapter; clients cannot
submit progression fields. Firestore persistence is provided by the injected
v2 repositories. Any economic effect remains the responsibility of
Economy/Settlement; Progression has no dependency on either.

The service's `getProfile(userId)` and `getMissionReward(userId, ...)` methods
are internal read operations, not public authorization boundaries. Their
callers must authorize the user before exposing those records.

Existing XP totals are imported once by the platform persistence adapter when
a v2 profile is first needed. After that import, v2 profiles and repositories
are authoritative; the legacy profile document is not updated.
