# Settlement Service v2

Settlement Service is a system-only orchestration layer over Economy Core v2.
It has no public transport or direct dependency on Identity, Application,
Socket.IO, the Game Engine, Coordinator, Firestore, or Firebase. The trusted
composition root injects Economy, Persistence ports, and an
`authorizeSystem(context, operation)` adapter. Calls fail closed if that
adapter does not authorize the supplied context.

`settle` accepts only `matchId`, `resultId`, `resultVersion`,
`settlementVersion`, `policyVersion`, `systemContext`, and optional
`correlationId`. Extra financial or result-authority fields are rejected.
Before asking Economy to prepare, the service loads the persisted match and
requires a Contracts-v2-valid result, `RESULT_LOCKED`, matching result/match
identities, matching result and settlement versions, and the persisted entry
policy version. Economy Core remains responsible for policy existence,
participant/stake validation, all financial calculations and writes, durable
claims, retries, and payout idempotency.

The service returns structured `{ ok, data }` / `{ ok, error }` responses.
`getSettlement` reads the durable state; `retrySettlement` calls the same
idempotent path and cannot replace result, policy, winner, or financial
inputs. An unexpired `PROCESSING` lease, `COMPLETED`, and `FAILED_FINAL` do
not transition to processing again. Expired processing and
`FAILED_RETRYABLE` are retried only through Economy Core.

Settlement state is stored by Economy Core through the injected Match
repository. This service does not maintain process-local financial state.
Audit events (`settlement.started`, `.retry`, `.completed`, `.failed`, and
`.reconciliation_detected`) are append-only records in `AuditRepository`.
Settlement-completed publication remains the Economy Core outbox's
responsibility. Audit write failures are returned explicitly; a failure to
write the post-completion audit does not undo or misreport the already
committed settlement.

`reconcileSettlement` is diagnostic only. It reports missing settlement for
a locked result, expired processing leases, retryable failures, result/policy
mismatches, and Economy Core's ledger reconciliation findings. It does not
repair wallets, ledger entries, or settlement status.
