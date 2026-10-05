# Persistence ports v2

This package defines repository contracts only. It has no database or SDK
dependency and is not wired into Application, Coordinator, Engine, Identity,
Transport, or the legacy runtime.

`assertRepositories` checks the required methods for:

- User, Wallet, Ledger, Match, Inventory, Progression, Reward, Payment,
  Audit, Idempotency, and Outbox repositories.
- A persistence-level `runInTransaction(work)` boundary.

Wallet updates, immutable ledger appends, settlement claims, idempotency
claims, payment writes, and outbox state changes are expected to be performed
inside the injected transaction. The Firestore adapter enforces transactions
for these operations. Ledger and audit entries are append-only. A settlement
is uniquely claimed by `(matchId, settlementVersion)`; an idempotency claim is
uniquely scoped by `(scope, key)`.

These ports provide persistence primitives only. They do not implement
settlement, economy rules, rewards policy, migrations, or authorization.
