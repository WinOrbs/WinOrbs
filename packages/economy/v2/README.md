# Economy Core v2

Economy v2 is an isolated service over Persistence Ports v2. It imports the
existing `MatchResult` validator from Contracts v2, but has no dependency on
the runtime, transport, Identity, Application, Game Engine, Coordinator,
Firestore, or Firebase SDK. Persistence repositories are injected; this
module neither initializes storage nor performs migrations.

## PAID policy and exact amounts

The initial policy mode is `PAID`. A versioned policy specifies a three-letter
currency, positive `stakeMinor`, `houseFeeBps` (0–10000), house and escrow
wallet account IDs, whether negative balances are explicitly allowed, and a
processing lease. All money is represented as safe integer minor units; fee
calculation uses integer `BigInt` arithmetic and rounds down. For a tied
first-place ranking, the prize pool is split equally in minor units and any
remainder is assigned one unit at a time in lexicographic actor-ID order.
Future FREE and SPONSORED modes are not accepted as active policies yet.

`openPaidMatch` persists the policy-bound entry record. `registerStake` does
not accept a client amount: it reads the configured stake, debits the
participant wallet, credits the escrow wallet, appends both ledger movements,
and records the participant in one transaction. The caller must provision
participant, escrow, and house wallets with the policy currency first.
Idempotency keys make repeated entry requests return their original response;
a participant cannot pay a second entry under a different key.

## Results and settlement

`prepareSettlement` and `settleMatch` accept only `matchId`,
`settlementVersion`, and `policyVersion`; they never accept a winner, result,
score, wallet balance, amount, payout, or fee from the caller. The service
loads the persisted match record and requires:

- `status: "RESULT_LOCKED"`;
- a Contracts-v2-valid `result` whose `matchId` matches;
- `resultVersion` equal to the requested `settlementVersion`;
- the same policy version used to open entries;
- an exact set match between paid entries and result participants.

The winner(s) are derived only from the lowest rank in the validated result.
Only those actors receive prize credits. Losers receive no payout. The pot is
the sum of valid paid entries; the configured fee is credited to the house
wallet, and the remaining pool is credited to first-place participants.
Escrow is debited exactly once for the pot.

Settlement states are `PENDING`, `PROCESSING`, `COMPLETED`,
`FAILED_RETRYABLE`, and `FAILED_FINAL`. Durable preparation claims
`(matchId, settlementVersion)` using both the idempotency and settlement
repository ports. A live `PROCESSING` lease returns
`SETTLEMENT_IN_PROGRESS`; an expired lease or `FAILED_RETRYABLE` may be
retried. A retryable failure rolls back ledger and wallet writes, then records
the retry state in a separate transaction. If storage is unavailable even for
that state update, the service returns `PERSISTENCE_ERROR` rather than
claiming a durable failure.

Ledger entries, wallet changes, settlement completion evidence, and an
outbox event are committed together. `COMPLETED` is never persisted before
the required financial writes. Repeating a completed settlement returns its
stored result without re-crediting wallets or appending ledger entries.
Ledger append is create-only through the repository port; this service
exposes no ledger update/delete operation.

`reconcileSettlement` checks locked-result validity, expected versus actual
ledger movements, duplicate ledger/idempotency keys, duplicate payouts,
duplicate escrow debits, house fee/pool consistency, and result identity.
It is a read-only diagnostic and does not repair financial records.

This package provides no payment-provider integration, economy API transport,
administrative UI, settlement policy beyond the initial configurable PAID
policy, or legacy runtime integration.
