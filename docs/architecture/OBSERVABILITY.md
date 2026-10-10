# Runtime Observability

## Health endpoints

The HTTP adapter exposes separate checks with intentionally different scope:

| Route | Meaning | Dependency behavior |
|---|---|---|
| `GET /health` | Process liveness. Returns `200 { "ok": true }` when the HTTP handler can run. | Does not call Firebase, Firestore, Socket.IO, or another remote service. |
| `GET /ready` | Baseline application bootstrap readiness. Returns `200 { "ready": true }` after the root server has created Socket.IO and the Firebase runtime container; otherwise it returns `503 { "ready": false }`. | Firestore is optional for free-room and static/realtime service. Missing or unavailable Firestore disables paid economy behavior and does not make the whole process unready. |
| `GET /status` | Existing public operational diagnostic. Keeps its existing JSON fields (`firebase`, `modo`, `proyecto`, `firestore`) for compatibility. | Performs a Firestore read with a one-second deadline. A failed/slow probe reports `firestore.ok: false` and a bounded error code; it does not affect liveness or readiness. Project ID remains operational metadata, not a credential. |
| `GET /ping` | Legacy compatibility probe returning `{ ok: true, ts }`. | Process-only, unchanged. |

Do not use `/status` as a liveness probe: Firestore is an optional capability and
may be temporarily slow. The underlying Firestore SDK read is not cancellable by
the current API; the HTTP response is bounded, but the SDK operation can finish
later.

## Structured operational logs

`apps/server/observability/logger.js` writes one JSON object per log call with
`timestamp`, `level`, and `event`. Context uses a fixed allowlist of scalar
operational fields; arbitrary messages, request paths, origins, identifiers,
credentials, cookies, and error messages are not accepted as context.

The logger is used for HTTP 5xx handler failures, Socket.IO handshake rejections
(at most one warning per minute per server instance), Firebase initialization
and listener state, process startup, and the periodic realtime metrics summary.
Sink failures are isolated so logging cannot change application outcomes.
Existing domain/audit `console` calls are not all migrated in this phase; the
`[AUDIT]` event format remains a separate legacy audit stream.

## Metrics

The server emits one aggregate `realtime.metrics` JSON log every 60 seconds.
It includes active rooms, matches and sockets, inbound/broadcast rates, sampled
state size, tick average/p95/p99, CPU and RSS memory. The operational projection
omits socket IDs, per-player counters, room IDs and client-controlled event
names. No public metrics endpoint or monitoring dependency is added.

The lower-level realtime metrics service still keeps its bounded per-socket
window internally for the existing bandwidth calculations. Do not expose that
raw snapshot over an unauthenticated endpoint.