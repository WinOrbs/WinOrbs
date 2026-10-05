# Administration v2

Administration v2 is an internal backend authorization and orchestration
boundary for explicit administrative operations. It is not a public API and
does not provide a login flow, HTTP endpoint, Socket.IO handler, or admin UI.

## Trusted administrative identity

The service accepts an opaque identity context and asks the injected
`resolvePrincipal` adapter to resolve it to the trusted `AdminPrincipal` model:

- `adminId`, `sessionId`;
- `authenticatedAt`, `expiresAt`;
- assigned `roles`;
- authentication `authLevel`;
- `schemaVersion`.

Permissions in a resolver result are ignored. The service derives effective
permissions from the configured, versioned role policy. The resolver is
responsible for authenticating the context, validating the active session, and
returning canonical identity and roles; never implement it by copying
client-supplied identity claims. The service checks expiry on each request.
Firebase Authentication is not integrated.

Authentication levels are ordered: `1` means authenticated and `2` means the
MFA-ready level. This module does not perform MFA; the trusted resolver must
assert an appropriate level based on its authentication evidence.

## Roles and permissions

The default explicit policy is `admin-role-policy-v1`. It defines
`SUPER_ADMIN`, `ADMIN`, `SUPPORT`, and `AUDITOR` independently, with no
implicit inheritance. An unknown role invalidates the principal. An unknown
permission is denied. Policy changes must use a new role-policy version.

Permissions include match inspect/view/terminate, user view/suspend/unsuspend,
progression view/adjust, audit read, and system inspect. Self-service role or
permission grants are not in the operation or permission allowlists.

## Operations and risk controls

The closed operation allowlist is exported as `OPERATION_DEFINITIONS` and
includes `MATCH_INSPECT`, `MATCH_TERMINATE`, `USER_VIEW`, `USER_SUSPEND`,
`USER_UNSUSPEND`, `PROGRESSION_VIEW`, `PROGRESSION_ADJUST`, `AUDIT_READ`, and
`SYSTEM_INSPECT`. Unknown operations fail closed. Each definition specifies
permission, target type, reason requirement, MFA requirement, and idempotency
requirement.

Terminate, suspend/unsuspend, and progression adjustment require MFA-level
authentication, a non-empty reason of at most 500 characters, and an
idempotency key. Credential-like reasons are rejected so they cannot be copied
into audit metadata. Inputs have strict allowed fields. Client-provided
`adminId`, roles, permissions, and auth level are not accepted as request
fields or used as authority.

An operation executes only through an injected, allowlisted operation adapter.
No default adapter performs domain work: unsupported operations return
`OPERATION_UNAVAILABLE` rather than writing directly to persistence. Adapters
must delegate to the owning domain service (Application/Match Coordinator for
game operations, Economy/Settlement for financial operations, and
Progression/Application for progression operations). Administration has no
wallet, ledger, balance, payout, settlement, XP, MatchResult, or GameState
write path.

For idempotent adapters, Administration checks and claims the existing
Persistence v2 `IdempotencyRepository` record inside `runInTransaction`, and
passes the transaction token to the adapter. The adapter must use that same
transaction for its domain effect; otherwise atomic idempotency cannot be
guaranteed and that adapter must not be enabled. A repeat with the same key and
same operation identity returns the persisted response; a conflicting request
is rejected. This module uses no in-memory map for idempotency.

## Audit and correlation

Every executed or rejected operation attempts an event through the injected
Observability v2 `logAdminAction` port. Events carry admin/session identity
when resolved, operation, target type/ID, outcome, correlation ID, timestamp,
schema version, and a validated reason where applicable. The operation is
recorded in metadata in its canonical enum form; the observability operation
field uses a name-safe dotted form. No request body or adapter response is
copied into audit metadata. Reasons containing credential-like terms are
rejected, not logged.

An audit sink failure is surfaced as `AUDIT_WRITE_FAILED`; it is not treated
as successful audit delivery. The audit sink is separate from the Persistence
transaction, so atomicity between a domain effect and an external observability
sink is not promised by this module. Production adapters must account for the
sink's delivery guarantees.

## Integration boundaries and limits

Future Application integration should provide authenticated identity context
and call `authorize`, `execute`, `inspect`, or `getAuditContext` internally.
The returned context is not itself a public authorization boundary.
Observability is injected through its existing port. Persistence is used only
for durable idempotency; no AdminRepository or direct Firestore access is
introduced.

No domain operation adapter is connected by default. This layer does not
perform the action when its owning domain service is absent. It does not
implement Firebase Auth, MFA, role management, financial operations,
gameplay mutation, progression adjustment, endpoints, Socket.IO, or a web
panel.

## Legacy distinction

The legacy administration flow contains runtime-specific login/events and
panel behavior. Administration v2 does not reuse or migrate those mechanisms;
it defines only the internal identity, role policy, operation allowlist,
delegation, and audit boundary above.
