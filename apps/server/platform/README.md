# Platform adapters

`progression.js` is a compatibility/runtime adapter, not a progression
implementation. It creates the `packages/progression/v2` service using the
Firestore v2 persistence ports and maps the legacy game server's locked result
into a validated v2 match aggregate. Match events, progression profiles,
mission rewards, and idempotency claims are persisted through the v2
repositories.

The legacy `progresion/{uid}` document is read only for one-time XP/equipped
reward migration. Runtime writes use `v2_progression`, `v2_rewards`, and
`v2_idempotency`; clients cannot write these collections. The current server
still owns gameplay, result locking, and settlement. Progression runs only
after the server has produced a valid locked result and never modifies wallet,
ledger, or settlement state.

`DEFAULT_MISSIONS`, XP policy, mission completion, reward grants, and the level
curve are owned by `packages/progression/v2`. The adapter's remaining visual
reward helpers only validate appearance configuration and delegate level
calculation to that domain. Level cosmetic entitlements are persisted through
the same atomic v2 reward port as mission rewards.
