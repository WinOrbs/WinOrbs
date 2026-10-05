# Firestore infrastructure v2

This is an injected Firestore adapter for the persistence v2 ports. It does
not initialize Firebase, load credentials, or import the Firebase SDK:
composition code supplies an initialized Admin Firestore instance using
`createFirestorePersistence({ firestore })`. No runtime integration is
performed by this package.

All collections are isolated under `v2_*`. Document IDs are deterministically
encoded; idempotency keys use a SHA-256 document key over `(scope, key)`.
Settlement claims use the deterministic composite `(matchId,
settlementVersion)` ID. Both are checked and created inside Firestore
transactions, preventing concurrent duplicate claims. A caller must perform
all transaction reads before its first write, following Firestore transaction
semantics.

Wallet updates, ledger appends, inventory/progression replacements, payment
or reward mutations, audit appends, idempotency claims, outbox enqueue and
publication changes require an injected transaction. Ledger and audit writes
use create-only operations and do not expose update/delete methods. This is
storage-level append-only behavior; production IAM and Firestore rules must
also prohibit privileged mutation paths before deployment.

`REQUIRED_COMPOSITE_INDEXES` documents the logical indexes needed for
settlement lookup, scoped idempotency keys, ledger lookup by match/user, and
audit lookup by aggregate, and pending outbox scans. Deterministic document IDs provide uniqueness where
Firestore does not support unique constraints. These definitions are
descriptive; no existing Firebase rules or deployment index configuration is
changed.

The transaction callback receives a repository set and a transaction token.
The adapter buffers write calls until the callback completes, then submits
them together to the native Firestore transaction. This preserves Firestore's
read-before-write requirement while allowing the idempotency and settlement
claims to be checked atomically with wallet and ledger changes.
Firestore may retry transaction callbacks; callback code must therefore avoid
external side effects and derive all writes from transaction reads and inputs.

The adapter implements storage primitives only. It does not implement
settlement orchestration, financial policy, retry scheduling, outbox
publishing, authorization, or legacy data migration.
