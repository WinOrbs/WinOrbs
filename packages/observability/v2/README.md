# Observability & Audit v2

This package provides a dependency-injected, structured event boundary for
operational diagnostics and audit evidence. It contains no business logic and
does not initialize logging or storage services. A caller supplies a sink as a
function or an object with `write(event)`, plus an optional clock.

## Event model

Every emitted event has `eventId`, `eventType`, controlled `category`,
layer-generated ISO-8601 `timestamp`, `schemaVersion: 1`, `operation`,
controlled `outcome`, and sanitized `metadata`. Optional correlation/request,
actor, session, and match identifiers are included only when supplied and
validated. Event IDs must be unique for the lifetime of a service instance;
the sink should enforce any cross-process uniqueness or durable deduplication
requirements.

Categories are `SYSTEM`, `SECURITY`, `ADMIN`, `MATCH`, `RECOVERY`, `ECONOMY`,
`SETTLEMENT`, `AUTH`, and `ERROR`. Outcomes are `SUCCESS`, `FAILURE`, `DENIED`,
`REJECTED`, `RETRY`, `STARTED`, and `COMPLETED`. The specialized methods set
their category and do not allow caller override:
`logSecurityEvent`, `logAdminAction`, `logMatchEvent`, `logRecoveryEvent`,
and `logEconomyEvent`. `logEvent` accepts any controlled category.

## Observability and audit

Operational events describe technical conditions and outcomes for diagnostics.
Audit events capture who performed an operation, on which resource, and with
what outcome; callers can use the same event structure and injected sink while
keeping those semantics distinct through the `ADMIN`, `SECURITY`, and other
controlled categories. This package does not define RBAC, MFA, or business
policy.

## Sanitization and correlation

Sensitive metadata keys are removed recursively, including names containing
password, token, secret, credential, private key, service account,
authorization, or cookie indicators. Non-JSON values, cycles, excessive
nested structures, and oversized values are rejected. Callers must not put
secrets inside innocuously named free-form values; sensitive values cannot be
reliably inferred from arbitrary text.

`createCorrelationContext` validates supplied correlation, request, actor,
session, and match IDs, and creates an opaque correlation ID when omitted.
Identity and trust remain the responsibility of the caller's authenticated
boundary; this service is not an authentication system.

## Failure and boundaries

Sink failures return `SINK_FAILURE`; the service does not claim success, retry,
or block business operations with hidden retry logic. Emitted events are
deeply frozen before reaching the sink. This layer does not execute Economy or
Settlement, calculate or write money, modify a ledger, create settlements,
control match lifecycle, or connect to the legacy runtime. Firebase,
Firestore, Express, Socket.IO, and other external services are not imported or
initialized.
