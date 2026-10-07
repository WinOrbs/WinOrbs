# Server Modules After Phase 1

## Scope

Phase 1 extracts infrastructure composition from the legacy CommonJS runtime. It does not replace the live runtime with the prepared `packages/*/v2` architecture, nor does it move gameplay, Socket.IO event handlers, identity policy, or financial workflows. The root `server.js` remains the compatibility entry point.

## Extracted modules

| Module | Responsibility | Dependencies |
|---|---|---|
| [environment.js](../../apps/server/config/environment.js) | Loads `.env` through the existing optional `dotenv` dependency before configuration is read. | `dotenv` (optional at runtime) |
| [audit.js](../../apps/server/platform/audit.js) | Formats sanitized audit events and exposes a logger factory while preserving the existing `[AUDIT]` output. | Existing audit-event sanitizer and injected/default logger |
| [http/index.js](../../apps/server/http/index.js) | Creates the Express app and HTTP server; configures proxy trust, CORS, static assets, `/sw.js`, `/ping`, and `/status`. `createStatusHandler` owns the existing Firebase/Firestore health check and response shape. | Express, Node HTTP, origin policy, Firebase runtime provider |
| [socket_server.js](../../apps/server/realtime/socket_server.js) | Creates Socket.IO on the HTTP server using the existing CORS policy and connection-state recovery settings. | Socket.IO `Server`, HTTP server, origin policy |
| [firebase.js](../../apps/server/infrastructure/firebase.js) | Resolves the existing service-account credential sources, initializes Firebase Admin/Firestore, preserves fail-closed economy behavior, creates the progression runtime, and subscribes to progression configuration changes. | Firebase Admin, filesystem, progression helpers, Socket.IO emitter, optional callbacks/logger |

The factories expose narrow seams for testing: HTTP and Socket.IO accept an origin policy; Firebase accepts injected Admin SDK, filesystem, progression dependencies, logger, environment, and reward-change callback. These seams do not change production configuration or wire protocols.

## Composition and dependency direction

```text
server.js (composition root and legacy application)
  ├── config/environment.js
  ├── apps/server/config (existing environment policy)
  ├── http/index.js ─────────────── Express + Node HTTP
  ├── realtime/socket_server.js ─── Socket.IO
  ├── infrastructure/firebase.js ─ Firebase Admin + progression helpers
  ├── platform/audit.js
  └── existing game, identity, transport, and platform helpers

HTTP /status ──> Firebase runtime provider (read-only health diagnostic)
Firebase progression listener ──> Socket.IO emitter + progression helpers
```

The dependency direction remains intentionally pragmatic: `server.js` passes concrete production dependencies into the extracted modules. The modules do not import the root server, and no new service locator or framework was introduced.

## Responsibilities remaining in `server.js`

- **Application startup/composition:** loads module references, composes configuration, HTTP, Socket.IO, Firebase, progression, and runtime callbacks.
- **Live gameplay and room lifecycle:** owns the `GameRoom` implementation, in-memory room registry, match timers, state projection, and simulation loop.
- **Socket.IO application protocol:** owns the `io.on('connection')` handler and event listeners for identity binding, lobby/match creation and joining, gameplay inputs, teams, shop, progression, admin, withdrawals, and notifications.
- **Authentication and authorization:** verifies Firebase ID tokens and binds player identity; retains admin password/session checks and event-specific authorization.
- **Economy and platform workflows:** retains paid-room admission, ticket/wallet operations, settlement and reward workflows, skins, ranking, and related Firestore transactions.
- **Runtime lifecycle:** listens on the configured port and reports startup.

These are deliberate remaining responsibilities, not claims that the root is already thin. Extracting them is deferred because handlers close over shared room state, Firebase aliases, Socket.IO, and one another; the next phase should establish characterization/contract coverage and explicit dependencies before moving event families.

## Future extraction candidates

Candidates should be moved in small event-family or lifecycle slices, preserving the current event names, payload shapes, authorization checks, transaction semantics, and emitted messages:

1. **Application bootstrap/lifecycle:** isolate the composition root and graceful server start/stop while keeping `server.js` as a compatibility entry point.
2. **Socket middleware and identity/session policy:** extract verified identity binding, admin-session validation, and rate-limit middleware with tests for reconnect and conflicting UID cases.
3. **Room registry and match application services:** isolate create/join/leave/reconnect and room projections before moving the `GameRoom` simulation.
4. **Administration handlers:** extract only after each handler's authorization and privileged transaction behavior has focused tests.
5. **Platform/progression handlers:** separate read-only/ranking and progression operations from game simulation, keeping progression policy and Firestore collection compatibility unchanged.
6. **Simulation event handlers and `GameRoom`:** last among the legacy slices; simulation timing, ordering, volatile broadcasts, and gameplay behavior are highly coupled and performance-sensitive.

The v2 packages are a prepared architecture, not automatically interchangeable production replacements. Wiring them to the live runtime remains a separately validated migration decision.

## Validation notes

Focused tests exercise Firebase initialization through its module API and HTTP endpoints and Socket.IO initialization through their public factories. The existing deployment, bandwidth, and security guard tests follow moved responsibilities into their new modules. `npm test`, `npm run check`, and `npm run test:game` pass.

The live server started successfully and `/status` returned the expected fail-closed response with no configured Firebase service account. With a test-only admin password, live admin authentication (valid and invalid), free-room creation, two-player joining, and initial/updated game-state delivery were observed. Existing `test:live` coverage is not fully green in this environment: its default run has no admin password or Firebase credentials, so admin and paid-room cases fail; with a test password, `test_auth.js` and `test_edge.js` still include timing-sensitive room-list assertions, and `test_multiplayer2.js` stalls later in its legacy sequence after the room creation/join/state checks pass. Firestore repository and v2 persistence tests pass, but real Firestore-backed persistence could not be exercised without service-account credentials.
