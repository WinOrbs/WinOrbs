# Executive Summary

WinOrbs is currently a **single-process modular monolith in deployment, but not yet in its production code boundaries**. The production path is still centered on a roughly 4,019-line CommonJS [server.js](../../server.js), which creates the HTTP and Socket.IO servers, owns all rooms and simulation state, handles most realtime events, initializes Firebase Admin, and performs a significant portion of the legacy platform and financial workflows.

There is also a substantial and intentionally layered `packages/*/v2` architecture. It defines contracts, identity, application, game engine, match coordination, persistence/recovery, economy, progression, settlement, administration, observability, Socket.IO transport, runtime selection, and Firestore adapter boundaries. The v2 code is extensively documented and exercised through fakes and controlled integration, but it is **not composed by the running `server.js`**. Its bootstrap, runtime adapter, and Socket.IO adapter are reached by harnesses and tests, not by the production entry point. The one clear bridge in the live server is [apps/server/platform/progression.js](../../apps/server/platform/progression.js), which adapts a locked legacy result to v2 progression and Firestore ports.

The most important architectural conclusion is therefore not “rewrite the monolith.” It is: **preserve the running legacy behavior while bringing the production composition under the boundaries that already exist**, one responsibility and event family at a time. Keep one deployable Node process and Firebase/Firestore; do not introduce microservices or new infrastructure as a prerequisite.

Most important audit findings:

1. **Stored XSS in the administration user list:** `admin.html` inserts `u.apodo` into HTML and into an inline JavaScript handler without escaping. The Firestore rules allow apostrophes in `apodo`, so a user can supply a value that breaks out of the handler’s JavaScript string when an administrator renders the user list. This is a concrete, high-priority issue; remediate it before expanding the admin surface.
2. **Split privileged identity:** legacy Socket.IO administration uses one `ADMIN_PASSWORD` shared secret, while browser-side Firestore administration uses an email comparison in Firestore Rules. These are separate authority paths without a single per-admin principal or consistent audit identity.
3. **Unauthenticated external notification relay:** any Socket.IO client can invoke `notifyPlayerTelegram`; the per-socket five-second throttle does not establish identity or impose a global/IP budget.
4. **Runtime/process coupling:** room state, timers, socket presence, and local throttles are process-local. Restarts discard active rooms, and horizontal replicas would not share authoritative match state or room events.
5. **No production v2 cutover yet:** v2’s robust domain and persistence capabilities should be treated as a prepared target, not as existing production guarantees. Migration and production verification remain open in the repository’s readiness documentation.

This is a static audit of the **current worktree snapshot**. Existing modifications and untracked files were treated as part of that snapshot, not attributed or reviewed as a diff. No application behavior was changed and no dependencies were installed. Findings about live deployment settings, Firebase account ownership, and external provider configuration are explicitly conditional because this audit did not access production systems or credentials.

# Current Architecture

## Runtime and deployable shape

The active server is a single Node.js/CommonJS process started with `node server.js`. It uses Express to serve static files from `public/`, hosts Socket.IO on the same HTTP server, and listens on `PORT` (default 3000). The HTTP surface is deliberately small: static content, `/sw.js`, `/ping`, and `/status`. Gameplay, lobby, wallet-related requests, and administrative commands are primarily Socket.IO events rather than HTTP APIs.

The browser application is a set of static HTML pages (`index.html`, `login.html`, `perfil.html`, `tienda.html`, `wallet.html`, `admin.html`, and `game.html`) with inline/client JavaScript, shared CSS, and image assets. The frontend uses Firebase Authentication and the Firebase Web SDK directly for selected profile, payment-request, and administrative reads/writes. It uses Socket.IO for the live game and server-mediated operations, and Cloudinary for image uploads. The server-side Firebase Admin SDK is initialized in `server.js` from environment variables or service-account file locations; it is used for trusted reads and writes and bypasses Firestore Rules.

The production composition is therefore approximately:

```text
Browser pages (public/)
  ├── Firebase Auth + Firestore Web SDK ────────────────┐
  ├── Socket.IO events ───────────────────────────────┐ │
  └── Cloudinary unsigned uploads                      │ │
                                                     ▼ ▼
Node process: server.js
  ├── Express static/health routes
  ├── Socket.IO event handlers
  ├── in-memory rooms + GameRoom simulation
  ├── apps/server helpers and legacy platform logic
  └── Firebase Admin ─────────── Firestore
```

The checked-in `dist/` directory is generated by `npm run build`, which copies `public/` and `sw.js`; it is not a backend bundle. The package declares CommonJS and scripts in [package.json](../../package.json), but its metadata (`name: "ode"`, `main: "index.js"`) does not describe the actual entry point, which is explicitly `server.js`.

## Two architectural tracks

### Live legacy track

`server.js` directly imports the focused helpers under [apps/server](../../apps/server) for configuration, identity-token extraction, input validation, match lifecycle, scoring, combat, team mode, result locking, finalization, audit sanitization, solo tickets, and progression. These helpers improve local boundaries, but the monolith still owns composition and most orchestration. A few helpers (such as the simple Firestore repository, session store, and generic rate limiter) are standalone/tested utilities and are not wired into the live server.

### Prepared v2 track

The packages under [packages](../../packages) implement a coherent modular design:

- contracts and validation;
- game engine and match coordinator;
- identity and application authorization;
- match persistence and application recovery;
- persistence ports and injected Firestore implementation;
- economy, settlement, progression, and administration;
- observability, bootstrap, Socket.IO transport, runtime assignment, production adapter, and test harnesses.

The packages are CommonJS and largely dependency-injected. Their READMEs repeatedly state that they do not start services or connect to Firebase/Firestore by themselves. The bootstrap assembles them, but `server.js` does not import the bootstrap, production adapter, v2 Socket.IO transport, or v2 persistence adapter. Controlled integration and runtime harness modules are explicitly test-only.

### Client and persistence split

The browser directly accesses legacy collections including `usuarios`, `apodos`, `pagos`, `partidas`, `metricas`, `skins`, and `configuracion`, subject to [firestore.rules](../../firestore.rules). The legacy server uses Admin SDK transactions over those collections. The v2 Firestore adapter writes namespaced `v2_*` collections and exposes the new persistence ports, while the progression adapter has begun a controlled legacy-to-v2 bridge. This creates a parallel-schema period; it is not yet a single persistence model.

## Major module responsibilities

| Area | Current responsibility | Current boundary/status |
|---|---|---|
| Web client | Lobby, account/profile, shop, wallet, admin UI, game rendering/input, Firebase client access | Separate static pages; substantial inline JS and direct Firestore usage |
| HTTP/static | Serve `public/`, service worker, CORS, liveness and Firebase status | All in `server.js`; no general application HTTP API |
| Realtime transport | Authenticate/associate users in legacy paths, route game/lobby/admin events, emit state and results | Socket handlers and domain operations are interleaved in `server.js` |
| Game domain | Match lifecycle, movement, combat, loot, teams, bots, zone, result/ranking | Mostly one `GameRoom` class in `server.js`, with a few extracted pure helpers |
| Platform | Cosmetics, inventory, progression, rewards, solo tickets, audit and notifications | Mix of `apps/server` helpers, Firestore logic in `server.js`, and v2 domain packages |
| Economy | Paid entries, refunds, skin purchase, admin deposits/withdrawals, prize settlement and house metrics | Legacy direct Firestore transaction functions and socket handlers; separate v2 Economy/Settlement not live |
| Persistence | Active gameplay and room state in process memory; durable profiles/economy/config in Firestore | No active legacy match snapshot/event recovery; v2 match persistence is separate |
| Authentication | Firebase ID token verification for player identity; independent admin password session | Firebase Auth is client-side; token verification is ad hoc in `server.js`; admin auth is a shared secret |
| CI/build | Node 20 workflow runs security configuration, checks, tests and static build | Two GitHub Actions workflows; no deployment or live Firebase verification in CI |

# Dependency Map

## Current dependency direction

```text
public/* ── Firebase Web SDK ── Firestore Rules ── legacy Firestore collections
    │
    ├── Socket.IO client ──> server.js
    └── Cloudinary upload API

server.js
  ├── Express / HTTP / Socket.IO / Firebase Admin / dotenv / crypto
  ├── apps/server/config
  ├── apps/server/transport/command
  ├── apps/server/game/{lifecycle,orbs,score,combat,team_mode,results,finalization}
  ├── apps/server/identity
  ├── apps/server/platform/{audit,solo_tickets,progression}
  └── legacy Firestore reads/writes, room registry, game loop and event handlers

apps/server/platform/progression
  └── contracts/v2 + progression/v2 + persistence ports + Firestore v2 adapter
```

## v2 dependency direction

The package graph is substantially more disciplined and has no obvious static CommonJS circular dependency in the inspected production imports:

```text
contracts + validation
  ├── game-engine ──> match-coordinator
  ├── identity ─────> application ──> Socket.IO transport
  │                     └───────────> application-recovery
  ├── persistence ports <── Firestore infrastructure adapter
  ├── match-persistence ──> application-recovery
  ├── economy ──> settlement
  └── progression / administration / observability

bootstrap ── composes the above
runtime-integration ── persists sticky runtime authority via ports
production-adapter ── selects a bootstrap instance for an assigned V2 match
controlled-integration / runtime-harness ── exercise the graph with fakes
```

The composition root points inward; core modules do not import it. Test/integration packages depend on bootstrap and adapters, but that does not create a core-package cycle.

## Architectural coupling and seams

- `server.js` is the effective dependency container and service locator: its module globals (`io`, `rooms`, `FIREBASE_DB`, `PROGRESSION_RUNTIME`, configuration constants) are read throughout the `GameRoom` class and socket handlers.
- `GameRoom` owns both game state and transport effects: simulation methods emit Socket.IO messages directly and look up sockets through global `io`.
- Legacy domain helpers are imported directly by the composition file, but the server’s own callbacks still decide workflow sequencing and persistence.
- `apps/server/platform/progression.js` is an intentional adapter seam: it maps the locked legacy result/events into v2 contracts and persistence.
- The v2 persistence adapter has clean Firestore injection; the small legacy `apps/server/infrastructure/firestore/repository.js` is a different interface and is not a universal production persistence boundary.
- The v2 runtime selector and production adapter are not invoked by `server.js`; there is currently no production routing seam that makes a per-match LEGACY/V2 decision.
- Several `apps/server` helpers (generic rate limiting, session store, idempotency store, simple Firestore repository) are not connected to the live server. Their presence should not be mistaken for active enforcement or persistence.

# server.js Responsibility Map

The table identifies what the monolith currently does and the destination boundary it should eventually use. Locations are approximate line spans in the audited snapshot, included to make extraction work traceable.

| `server.js` location | Responsibility currently concentrated there | Eventual boundary |
|---|---|---|
| 1–135 | Load dotenv; import all local and third-party modules; create Express/HTTP/Socket.IO instances; configure CORS and proxy trust; serve static assets; implement `/sw.js`, `/ping`, `/status` | Server composition/bootstrap plus small HTTP health/static adapter; keep infrastructure startup separate from domain modules |
| 136–260 | Discover and initialize Firebase Admin credentials; choose economy-enabled/disabled mode; create Firestore DB and progression runtime; watch progression config and broadcast changes | Firebase credential/bootstrap adapter and Firestore configuration subscription adapter; explicit lifecycle and health status |
| 263–451 | Global game/economy/security constants; room and weapon tuning; basic profile/skin sanitization; bot and admin-rate state | Versioned configuration/policy; shared input/output sanitizers; tuneable gameplay rules kept close to game domain |
| 452–567 | Read equipped progression cosmetics; validate user-owned skins; read profiles/catalog; buy skins with wallet and history writes | Cosmetics/catalog application service plus injected inventory/wallet repositories |
| 568–884 | Charge/refund entries; ticket redemption/refunds; pay prizes; record house fees; reconcile pending prizes by UID/apodo; user-claim processing; Telegram notices | Economy/settlement use cases with transaction/idempotency ports; notification outbox/adapter; no Firestore transaction policy inside transport or `GameRoom` |
| 885–889 | Room ID generation and transition into `GameRoom` declaration | Small identity/ID adapter or injected ID factory |
| 890–2959 | `GameRoom` constructor and all world/match behavior: map generation, teams, player/bot state, commands, loop/timers, lifecycle, simulation, collision, combat, loot, score, result creation/locking, progression events, serialization, room summary | First extract the match aggregate/lifecycle and pure game engine; then simulation systems (movement/combat/zone/loot/bots), result/ranking policy, and snapshot projection. Keep transport emission outside the engine |
| 2960–3013 | Build/replenish 40 automatic rooms; recurring room registry timer; public-room broadcasting/throttling | Match/room registry service and lobby query projection; timer ownership in application/runtime lifecycle |
| 3014–3076 | Verify Firebase identity for a room; join/rebind UID; leave room and refund; clean practice room | Identity adapter and application join/leave use cases with explicit session principal and transaction boundary |
| 3077–3140 | Read, cache, rank and broadcast recent withdrawals from Firestore snapshots | Lobby read model/query service plus Firestore subscription adapter; bounded cache, errors and listener shutdown |
| 3141–3162 | Audit event creation/console output; expiry check for admin socket sessions; socket IP extraction from `X-Forwarded-For` | Admin authentication/session service, structured audit sink, and trusted-proxy/IP adapter |
| 3163–4012 | Register every Socket.IO listener; send bootstrap state; handle ranking, cosmetics/progression, admin auth, Telegram, prize claims, payment actions, room lifecycle, game commands, team commands, disconnect recovery, and all event responses | Thin Socket.IO transport adapter mapping legacy event names to application services; common schema validation, authentication, authorization, rate limit, and response mapping |
| 4013–4019 | Bind to `0.0.0.0`; start listener and log port | Composition root lifecycle, health/readiness, graceful shutdown and resource cleanup |

## GameRoom sub-responsibility map

`GameRoom` is more than a large file section: it is a multi-domain aggregate and runtime host. Its methods split naturally as follows:

- **World construction and static map:** constructor, `generateSpeedPads`, `generateObstacles`, `generateWalls`, `spawnPoint`, `configEstatica`, `emitirConfig`.
- **Room membership and teams:** `addPlayer`, `addBotPlayer`, `removePlayer`, `selectTeam`, `updateTeamProfile`, `teamState`.
- **Command handling:** `handleInput`, `handleShoot`, `handleDash`, `handleReload`, `handleSwitchWeapon`, `handleBomb`, `handleBuyItem`, `handleRespawn`.
- **Simulation:** `startLoop`, `update`, `updateBots`, `updateZone`, projectile/bomb/loot/hazard processing, collision and damage.
- **Match lifecycle:** `startLobby`, `startGame`, `endGame`, `resetForLobby`, `stopLoop`.
- **Scoring/results/platform side effects:** banking and death loss, progression event capture, solo-ticket recording, Firestore prize payment, result lock and finalization coordination.
- **Transport and projections:** direct `io.to(...).emit(...)`, `getState`, map state serialization, team/room summaries and leaderboard.

The extraction boundary should preserve `GameRoom` as a compatibility facade during early phases. First isolate behavior with characterization tests; do not split or rewrite every method in one pass.

## Socket.IO responsibility groups

| Event group | Current examples | Concern |
|---|---|---|
| Connection setup/recovery | `connection`, `serverConfig`, initial `roomsList`, `disconnect` | Socket identity, room recovery, game state and transport concerns are intermixed |
| Lobby/public data | `pedirRetiros`, `latProbe`, `pedirRankingGlobal`, `roomsList` | Read model access and per-socket rate policy are inconsistent |
| Account cosmetics/progression | `equipProgressionReward`, `tiendaSkins`, `comprarSkin`, `reclamarPremios`, `setUid` | Token verification repeated inside individual handlers |
| Administration | `adminAuth`, `adminProcesarPago`, `adminAjustarSaldo`, `adminVincularPremio`, `adminConciliarPremios`, `adminCreateRoom`, `adminDestroyRoom`, `startGame` | Shared-secret session and privileged domain mutations reside in transport |
| External notification | `notifyTelegram`, `notifyPlayerTelegram` | External provider side effects initiated directly by socket events |
| Room lifecycle | `createPracticeRoom`, `joinRoom`, `leaveRoom`, `startGame` | Seat ownership, payment, identity, room selection and socket membership need an application service |
| Game input | `playerInput`, `playerShoot`, `playerDash`, `playerBomb`, `switchWeapon`, `playerReload`, `buyShopItem`, `requestRespawn` | Validation exists for several inputs, but command flow and domain mutation are coupled |
| Teams | `selectTeam`, `updateTeamProfile` | A useful extracted domain helper exists; server still handles membership, response and broadcasts |

# Domain Boundaries

## Boundaries that already exist and should be reused

- **Contracts and validation v2:** explicit schema versions, command/event/lifecycle enumerations, strict payload validation and canonical result validation.
- **Game mechanics helpers:** [apps/server/game](../../apps/server/game) contains focused lifecycle, combat, orb loss, score, team, result-lock and finalization helpers. These are small and well-scoped, though `GameRoom` still orchestrates them.
- **Team domain:** `team_mode.js` centralizes team assignment, eligibility, profile updates, ranking, damage rules and prize splitting.
- **Identity v2 and Application v2:** separate credential verification, principal construction, permission checks, actor derivation and session binding.
- **Economy and Settlement v2:** use integer minor units, derive payouts from locked results, use idempotent transaction claims and keep settlement separate from gameplay.
- **Progression v2:** makes XP, mission progress and rewards server-derived from persisted validated events/results, and has a legacy adapter.
- **Persistence ports and Firestore v2:** define repositories, transactional mutations, deterministic settlement/idempotency claims, append-only ledger/audit operations and an outbox.
- **Administration v2:** has an operation allowlist, explicit role/permission policy, step-up auth levels, opaque identity resolution and audit operations.
- **Socket.IO transport v2:** is documented as transport-only, binds identity to a private principal map and rejects client-supplied identity/authorization claims.
- **Room map network optimization:** `ROOMCONFIG_V2` sends immutable geometry once and dynamic health separately; preserve this payload optimization and its fallback.

## Boundaries that exist only partially

- **Game lifecycle:** `apps/server/game/lifecycle.js` supplies lifecycle constants/transitions, but `GameRoom` is still the authoritative state machine and drives timers/end transitions.
- **Results:** result locking and finalization have helper boundaries, but `GameRoom.endGame()` decides outcomes, creates IDs and orchestrates progression, payment, result broadcast and reset.
- **Progression:** logic resides in v2, and `apps/server/platform/progression.js` is a focused adapter, but legacy server owns event creation, result acceptance and orchestration. It is not a full v2 production composition.
- **Firestore:** new v2 modules depend on ports; legacy game/economy/admin/socket code makes direct Admin SDK calls. Client SDK reads/writes are a separate access path governed by Rules.
- **Administration:** an isolated v2 service exists, but legacy socket and browser admin flows remain independent authorization systems.

## Boundaries that should be introduced

1. A **composition root** that owns dependency construction, configuration, adapters, HTTP/Socket.IO startup, timers and shutdown, without embedding domain policy.
2. A **transport-neutral application service** for join/leave, matchmaking, gameplay command submission, lobby reads, account actions and administration.
3. A **server-authoritative match aggregate** with explicit lifecycle and immutable locked result, separate from socket IDs and Socket.IO.
4. **Game engine services** that consume validated commands/ticks and produce deterministic state/events without importing transport, Firestore or external services.
5. A **persistence adapter boundary** for room/match snapshots, event history, user/profile, inventory, wallet, ledger, payments, idempotency, audit and outbox; migrate each existing collection intentionally.
6. **Identity and authorization context** shared by HTTP and Socket.IO; distinguish player identity from administrator authority and system operations.
7. Separate **progression**, **economy**, **settlement**, **administration**, **cosmetics**, and **notification** application use cases. Game scoring/charge is not a wallet balance.
8. A bounded **lobby/query projection** for rooms, ranking and recent payout/withdrawal activity rather than embedding Firestore listeners and scans in the server entry point.

# Infrastructure Boundaries

## HTTP responsibilities

The HTTP server provides CORS handling, static pages, `sw.js`, `/ping`, `/health`, `/ready`, and `/status`. There are no general JSON routes for authentication, game commands, economy, or administration. Keep HTTP as the same-process delivery/health adapter; do not introduce a new API design unless it solves a concrete client requirement. `/health` is process-only; `/ready` represents completed HTTP/Socket.IO/Firebase-runtime bootstrap and intentionally does not require Firestore because economy is optional; `/status` retains its public response shape and project ID, but bounds its Firestore probe and reports only a stable error code.

## Socket.IO responsibilities

Socket.IO is both the public realtime transport and, effectively, the legacy application API. It authenticates some account operations by checking Firebase ID tokens inside handlers, routes all gameplay commands, manages socket-to-room membership, directly emits domain feedback, serves lobby data, and exposes administrative workflows. The v2 transport README already describes a cleaner target, but it expects Identity and Application instances that production does not currently provide.

## Game simulation responsibilities

`GameRoom` owns in-memory match state and a server-authoritative 60 Hz simulation. It processes movement, bullets, explosions, collision, zone damage, loot, bots, respawns, team rules, scoring and result conditions, then emits `gameState` at 30 Hz during play and once per second in the lobby. The client renders this state and sends player intent; it is not the authority for combat or paid results. Simulation, lifecycle policy, transport delivery and settlement orchestration must eventually be separated without changing mechanics unintentionally.

## Persistence responsibilities

- **Active legacy match state:** `rooms`, players, projectiles, teams, timers, progression events and result snapshots exist in process memory. There is no durable recovery of those legacy rooms after process restart.
- **Legacy durable data:** Firestore stores user profiles, balances, payment requests, purchases, scores/results and configuration. The legacy server invokes Admin SDK methods directly and the browser also accesses selected collections directly.
- **V2 durable data:** `MatchRepository` stores v2 metadata/snapshot/events/results in an aggregate, while Wallet/Ledger/Inventory/Progression/Reward/Payment/Audit/Idempotency/Outbox use explicit ports. The injected Firestore adapter does not itself initialize Firebase or connect the production runtime.
- **Idempotency/session helpers:** legacy in-memory stores in `apps/server` are not automatically durable or wired into handlers. V2 transactional idempotency exists in its persistence path.

The v2 Match Persistence README explicitly notes there is no dedicated event/snapshot repository and that events and snapshots are embedded in a match aggregate. This is an acceptable initial modular-monolith choice, but event retention and Firestore document growth need explicit limits before high-volume/long-lived matches.

## Firebase responsibilities

Firebase is several distinct things in this repository:

1. **Authentication provider:** browser pages sign users in and obtain ID tokens; server verifies tokens for legacy player binding. The submitted UID itself is not authoritative.
2. **Client database:** browser pages use Firestore Web SDK for user-owned profile reads/writes and payment requests, and the admin UI for admin-authorized catalog/config/user operations.
3. **Server database:** Firebase Admin initializes from application default credentials, JSON/Base64 environment values, local key file or Render secret paths, and bypasses rules for server-side transactions.
4. **Progression:** v2 Firestore collections are written via injected persistence; legacy progression is imported/read by the progression adapter. A Firestore listener broadcasts progression config updates.
5. **Rules:** [firestore.rules](../../firestore.rules) is the client authorization boundary. [storage.rules](../../storage.rules) is explicitly marked obsolete; image upload moved to Cloudinary in [media-config.js](../../public/js/media-config.js).

Admin SDK use must be treated as a privileged infrastructure boundary: it bypasses Rules, so every Admin SDK operation must be authorized and validated before reaching its repository method. Browser Firebase configuration (including the API key) is public client configuration, not a secret; security depends on Rules and server authority, not hiding that key.

## Authentication and sessions

Player identity in the legacy server comes from `firebaseAdmin.auth().verifyIdToken()`. `verificarUidEnSala()` ignores client-supplied UID values, associates a verified UID with the socket/player, and classifies non-anonymous Firebase accounts for solo progression. Guests remain possible on free play, while paid-room access requires verified identity and server-side economy availability. Token-verification failures fall back to guest behavior; identity-sensitive operations then require a verified UID.

Legacy admin sessions are separate: the `adminAuth` event compares a submitted password with `ADMIN_PASSWORD`, stores `isAdmin` and `adminAuthenticatedAt` on the socket, and expires that socket authorization after 30 minutes. It does not bind an administrator identity to a Firebase principal. The v2 Identity service has stronger injected principal/session semantics but is not the live player/admin authentication path.

## Administration and economy

Admin surfaces currently include:

- Firebase-authenticated admin UI with Firestore Rules-based access to payments, users, metrics, skins and configuration;
- Socket.IO admin password session for payment processing, balance adjustment, room creation/destruction, prize reconciliation, game start and Telegram operations;
- a separately implemented v2 Administration service that is not wired into either production surface.

Legacy financial mutations are primarily Firestore transactions: paid entry/refund, skin purchase, deposits/withdrawals, prize settlement and manual/automatic prize reconciliation. This server-side authority is a strong existing control. However, the business operations and provider/admin interaction remain split across `server.js`, browser Firestore and rules. The v2 Economy/Settlement model is safer and clearer but has no production payment-provider integration or production cutover.

# Security Review

This section is a static source review, not a penetration test. Deployment settings, Firebase account ownership, provider configuration and active production rules were not verified.

## Existing controls worth preserving

- Client-submitted UID is not used as verified identity; Firebase ID tokens are verified server-side for account-bound operations.
- Paid rooms are unavailable if server-side Firebase economy credentials are missing; the code does not intentionally fall back to trusting the browser balance.
- Firestore Rules restrict client balance/inventory/progression/match writes, with server Admin SDK handling authoritative operations.
- Entry and payment mutations use Firestore transactions; prize records use a deterministic match document to guard duplicate payout.
- Many gameplay payloads are validated in `apps/server/transport/command.js`; the game also applies cooldowns and state checks.
- V2 contracts, transport and domain modules reject client authority claims and return structured errors; Firestore v2 uses transactional claims and append-only ledger/audit ports.
- Nicknames, skins, external link fields and various HTML-rendered client values have sanitization/escaping helpers. Keep these protections and add tests for every rendering context.

## Findings and risks

| Severity | Finding | Evidence and impact | Recommended control |
|---|---|---|---|
| **HIGH** | Stored JavaScript injection in admin user list | [admin.html](../../public/admin.html) renders `u.apodo` raw into the user table and interpolates it into an inline `onclick` handler (around lines 1402–1412). The owner-update rules in [firestore.rules](../../firestore.rules) allow a user to change `apodo` when they own its reservation; the reservation checks reject `<`, `>`, `&`, and `"`, but do not reject `'` (around lines 30–66). An attacker can place a single quote in an otherwise valid nickname, break the JavaScript string in the handler, and execute script when an admin opens the user list. An authenticated Firebase admin session can make this an admin-context compromise. Confidence: **high**. | Render user data with `textContent`; remove inline handlers and bind listeners using element data/closures. Treat all Firestore data as untrusted. Add a regression test that includes quotes and markup-like content; do not rely only on Firestore validation. |
| **MEDIUM–HIGH** | Legacy admin authority is a shared socket password | `adminAuth` in [server.js](../../server.js) grants `socket.isAdmin` solely from equality with the shared `ADMIN_PASSWORD`; admin events do not require a verified Firebase principal. Anyone who obtains the password can call privileged Socket.IO operations directly, bypassing the browser UI’s Firebase login. Sessions last 30 minutes and the audit actor is the socket ID, not an attributable administrator identity. Confidence: **high**. | Move both browser and socket admin operations behind the v2 Administration boundary and verified per-admin principal; use explicit permission checks and step-up/MFA for money/user mutations. Until then, use a unique high-entropy secret, rotate it, protect the transport with TLS and monitor every privileged operation. |
| **MEDIUM** | Unauthenticated Telegram relay can be abused | `notifyPlayerTelegram` in [server.js](../../server.js) accepts arbitrary non-admin Socket.IO clients, limits text to 400 characters, and throttles only one message per socket every five seconds. It does not require a verified user or apply a global/IP budget. An attacker can create multiple connections and send spam through the server’s bot credentials. Confidence: **high**. | Require an authenticated, authorized application operation; add global and per-account/IP limits, message templates, and an outbox/provider adapter. |
| **MEDIUM (conditional)** | Firestore Rules identify administrators by email string | `isAdmin()` in [firestore.rules](../../firestore.rules) grants broad administrative access when the Firebase token email equals `winorbs@admins.com`; it does not check an administrator custom claim or `email_verified`. This makes control of that email identity and Firebase account lifecycle part of the security boundary. The exploitable path depends on whether the address is already securely claimed and how Firebase sign-in providers are configured. Confidence: **medium-high**. | Use Firebase custom claims or a server-managed admin role document with tightly controlled provisioning; require verified identities and test Rules against non-admin, unverified, and compromised-account cases. |
| **MEDIUM (deployment-dependent)** | IP-based throttling trusts forwarded client input and is process-local | `ipDeSocket()` in [server.js](../../server.js) takes the first `X-Forwarded-For` value without validating the proxy chain, while Express sets `trust proxy` to one hop. The admin lockout map is a process-local object with no expiry cleanup, and paid-room IP limits do not cap all connections. If the backend can be reached around the trusted proxy, or the proxy does not overwrite/sanitize forwarded headers, clients may evade IP controls. The map can also grow with distinct IP keys. Confidence: **medium**. | Define and enforce the actual trusted-proxy topology at the edge and backend; derive a canonical client IP once; use bounded, expiring/distributed throttles where multi-instance support is needed, and add connection/payload limits. |
| **LOW–MEDIUM** | Privileged Firestore client path and server Admin SDK are separate authority planes | Browser admin UI performs direct writes under Firestore Rules while Socket.IO handles other privileged writes. The server uses Admin SDK, which bypasses Rules. A future Rules change can therefore break one path but not the other; socket and Firebase audit identities may not correlate. Confidence: **high**. | Consolidate high-impact admin mutations behind one application service; retain direct client access only for intentionally safe read/write cases and test deployed Rules independently. |
| **LOW–MEDIUM** | Legacy handler validation and error handling are inconsistent | Several handlers validate only selected fields, and some broad `catch` blocks return fallback values or generic guest behavior. Other transaction errors return clipped provider messages to clients. This makes denial, infrastructure failure and invalid input difficult to distinguish and increases the chance that new sensitive events omit a guard. Confidence: **high**. | Centralize event schemas, authz and response mapping at transport/application boundaries; keep safe user-facing errors while recording structured, sanitized server-side causes. |
| **LOW** | `/status` exposes operational detail | The public status route reports economy mode and Firebase project ID. The project ID is operational metadata, not a credential; Firestore error messages are no longer returned, and its read probe has a one-second response deadline. Confidence: **high**. | Keep public status fields non-sensitive; use `/health` for liveness and `/ready` for baseline bootstrap readiness. |

`storage.rules` must remain clearly labeled obsolete and must not be published as active rules unless the Cloud Storage migration is deliberately reversed and reviewed. The readiness checklist in [WinOrbs-2-release-readiness.md](../WinOrbs-2-release-readiness.md) still lists production legal/compliance approval, payment configuration, staging smoke tests and rule publication as incomplete; real-money production readiness should not be inferred from passing local tests.

# Testing Review

## Test architecture

The repository contains 63 JavaScript files under `tests/` in this snapshot. Tests are mostly standalone Node scripts using the built-in `assert` module rather than a single test framework. There are:

- focused unit tests for legacy game/platform helpers and validation;
- v2 unit tests for contracts, identity, game engine, coordinator, application, persistence, economy, settlement, recovery, progression, administration, transport and observability;
- controlled integration tests using injected/in-memory adapters and deterministic clocks;
- a small set of server-backed legacy smoke/regression tests orchestrated by `tests/run_live.js`;
- static checks for browser scripts, HTML script parsing, deployment configuration, rules and source-level server guards.

The v2 harness coverage is a strong existing asset. It verifies transactional ports, identity boundaries, idempotency, recovery and result-lock behavior without production credentials. Its README explicitly says the harness is not a production runtime and does not exercise `server.js`.

## Test execution and gaps

- `npm run check` is a long, manually enumerated chain of Node scripts covering many v2 and domain checks.
- `npm test` runs a smaller set of legacy/configuration/browser/deployment tests.
- `npm run test:game` runs additional game/security/repository tests, but the checked-in migration workflow does not call this script directly.
- `npm run test:live` launches `server.js` and runs selected Socket.IO integration scripts with timeouts; it is not part of the GitHub Actions workflow and does not prove Firebase-backed workflows.
- `npm run test:security` is a configuration test, not a complete security suite or penetration test.
- Several test files are not referenced by the default CI script chain; the explicit lists can drift as modules are added.
- There is no Firebase Emulator Suite setup visible in the repository, no live staging credentials in CI, and no evidence of a production Firestore Rules test run.
- The current CI workflow uses Node 20, runs security config, repository checks, legacy regression tests and static build. It does not run the live server test runner or validate a deployed backend.
- No configured lint, formatter, coverage threshold or TypeScript type-check script is present.

## Recommended test evolution

1. Keep existing focused tests and require characterization coverage before extracting legacy behavior.
2. Make a single CI entry point include every required test, including currently opt-in `test:game` and Socket.IO adapter coverage.
3. Add Firebase Emulator tests for Rules and the critical user/admin/economy workflows; reserve production credentials for manual/staging validation.
4. Add protocol-level Socket.IO tests for legacy events and their new application adapters; preserve event names and response shapes during migration.
5. Add negative tests for admin XSS payloads, missing identity, unauthorized operations, rate-limit boundaries, retry/idempotency and recovery.
6. Add performance/load baselines for active room count, game-state payload size, tick latency and Firestore query volume before tuning.

# Performance Review

## Existing optimizations to preserve

- Simulation is designed for 60 Hz while room state is emitted at 30 Hz, using Socket.IO `volatile` delivery so slow clients do not accumulate obsolete snapshots.
- `ROOMCONFIG_V2` sends static map geometry once and sends dynamic obstacle/wall health separately, with a fallback that sends full arrays.
- Game ticks return early when a room has no players.
- Lobby room-list broadcasts are coalesced with a 250 ms throttle.
- Recent withdrawal reads use a shared in-flight request and a bounded top-10 cache; Firestore listener updates are debounced.
- Progression/skin payloads and uploaded images are size-limited in several paths.

## Hot paths and likely bottlenecks

- **One event loop:** all room simulations, serialization, Firestore callbacks, Socket.IO work and HTTP requests share one Node process and event loop. A slow transaction callback or CPU-heavy tick can affect all matches.
- **Idle timer count:** `SALAS_AUTO` defines four tiers with five rooms each, and `ensureRooms()` creates both FFA and TEAM variants (40 automatic `GameRoom` instances). Each constructor starts a 60 Hz interval plus three 1 Hz intervals even while empty. The main tick returns early for empty rooms, but the scheduler still invokes those callbacks. This is avoidable baseline timer work.
- **Active tick cost:** `GameRoom.update()` walks players and repeatedly scans walls, obstacles, pickups, projectiles, and other players for collision/interaction; there is no visible spatial broad-phase index. Cost grows with active players and world entities.
- **Snapshot cost/bandwidth:** `getState()` rebuilds player/map projections and sends mutable arrays such as bullets, bombs, drops and effects to every room member up to 30 times/second. Static geometry optimization helps, but remaining deltas/interest filtering have not been measured.
- **Process-local matchmaking:** room registry, room state, throttles and connection recovery are local. A second server instance would not have a shared room authority or shared Socket.IO room adapter in the repository.
- **Firestore subscriptions and history:** the server listens to the full `pagos` collection and re-queries up to 150 recent documents on changes. Transactional audit/payment/result data and unbounded historical collections can create read costs and admin query latency.
- **V2 aggregate growth:** Match Persistence stores event history and snapshots within a match document because the ports have no dedicated event/snapshot repository. Firestore’s document size and transaction limits require an event-retention/segmentation policy before long or high-volume matches.
- **No measured budget:** tools include width/tick/latency measurement scripts, but there is no checked-in benchmark report, load profile, or performance regression threshold.

The realistic initial scale model is one authoritative game process with Firestore for durable state. Before adding replicas, externalize authoritative runtime assignment and shared match state/recovery; do not simply run multiple independent copies of `server.js`.

# Observability Review

Legacy domain operational evidence remains primarily `console.log`, `console.warn` and `console.error`. `registrarAuditoria()` sanitizes and constructs an audit event but prints it locally; it does not persist a durable audit record. A focused JSON operational logger now records HTTP 5xx, throttled Socket.IO handshake rejections, Firebase lifecycle failures, startup and aggregate realtime metrics. These records intentionally do not include request correlation IDs or player/socket identifiers. The public `/health` is process-only, `/ready` covers baseline bootstrap, and `/status` keeps the existing Firestore diagnostic with a bounded wait and stable error code. Graceful shutdown and complete migration of legacy domain logs are still pending.

The v2 [observability package](../../packages/observability/v2/README.md) provides structured events, correlation IDs, sanitization and explicit sink failures. Administration, settlement, runtime assignment and recovery can emit domain-appropriate events. This is a good boundary, but it is injected and not wired to a production sink by `server.js`; structured observability must not be treated as active production coverage.

Recommendations:

- Propagate structured, sanitized context through remaining domain, persistence, and provider error paths without logging credentials or unnecessary identity data.
- Persist security and financial audit events to an append-only repository and send external notifications through an outbox.
- Expose low-cardinality metrics for tick duration/lag, active rooms/players, emitted bytes, socket disconnects, Firestore latency/failures, transaction retries, settlement status and listener health.
- Make degraded economy/progression behavior explicit and visible through readiness/alerts rather than only startup messages.
- Add graceful shutdown to stop accepting sockets, finish/abort rooms by policy, unsubscribe Firestore listeners, stop timers and flush logs.

# Technical Debt

1. **Production composition debt:** `server.js` is both the entry point and the implicit composition root. Domain logic, transport and adapters reference its mutable globals.
2. **Parallel architectures:** legacy modules and v2 modules coexist with different interfaces and persistence schemas; architectural documentation can overstate what is active if readers do not distinguish “implemented” from “wired.”
3. **Game aggregate overload:** one class controls lifecycle, game simulation, bots, projections, Socket.IO broadcasts and financial/progression side effects.
4. **Mixed authority paths:** direct Firestore client operations, legacy Socket.IO admin operations, server Admin SDK and isolated v2 Administration/Economy services represent multiple authorization and mutation routes.
5. **In-memory reliability limits:** active matches and idempotency/session/rate-limit state in legacy paths are process-local; restart recovery is only built for the disconnected v2 model.
6. **Inconsistent conventions:** Spanish/English names, legacy event names, multiple state representations and varying error conventions make migration mapping harder.
7. **Manual test registration:** `package.json` contains long command chains; some suites are not part of the workflow’s default commands, so coverage can silently become incomplete.
8. **Build/package metadata drift:** `package.json` identifies `index.js` as `main`, but there is no root `index.js`; backend startup is `server.js`. Build only copies frontend static files.
9. **Deployment/documentation drift:** migration/readiness documents describe completed architectural properties and old CI evidence alongside explicitly incomplete live/production checks. Label the active runtime and verification scope wherever these docs are used as release gates.
10. **Special-purpose automation:** `repair-server-syntax.yml` has `contents: write` and can alter/push `server.js` directly to `main` when a text marker is found. Even though it is narrowly scoped and labeled one-off, it should not be a permanent substitute for normal review/CI.
11. **Legacy compatibility surfaces:** `storage.rules` is obsolete, old profile/economy collections remain active, browser session/local storage retains legacy keys, and tools/scripts preserve old operational workflows. Remove only after usages and migration paths are measured.
12. **No explicit event/history retention:** match event aggregation and Firestore collections need documented growth and archival policies before usage scales.

# Recommended Target Architecture

Use a **modular monolith with one authoritative server process per assigned match runtime**, retaining Firebase/Firestore and the current web application. The project already contains most of the logical layers; the primary task is to compose them in production and bridge them compatibly.

```text
apps/server (composition root)
  ├── configuration + secret loading
  ├── HTTP/static/health adapter
  ├── Socket.IO transport adapter
  ├── Firebase Auth verifier + Firestore Admin adapter
  ├── logging/metrics/audit sink + notification outbox publisher
  └── runtime assignment / lifecycle wiring
        │
        ├── Identity ── Application ── Match Coordinator
        │                                └── Game Engine
        ├── Match Persistence / Recovery
        ├── Economy ── Settlement
        ├── Progression
        ├── Administration
        └── Contracts + Validation
              │
              └── Persistence ports ── Firestore adapter
```

## Layer ownership

| Layer | Owns | Must not own |
|---|---|---|
| `apps/server` composition | Load/validate environment, initialize server and adapters, compose dependencies, start/stop timers/listeners, choose active runtime | Game rules, payout math, command authority or ad hoc database mutations |
| Transport adapters | Parse/validate wire payloads, authenticate/resolve principal, map event/HTTP request to application call, map safe response | Mutating game/economy state directly or trusting caller identity/role fields |
| Identity/Application | Verified user/admin principals, permissions, session checks, actor derivation, operation authorization, use-case orchestration | Firestore SDK calls or client-provided authority |
| Game Engine/Coordinator | Deterministic simulation, lifecycle, membership, command sequence, result locking | Socket.IO, Firebase, payment provider, external logging |
| Domain services | Economy/settlement, progression, administration, cosmetics and rewards policy | Direct transport or infrastructure initialization |
| Persistence ports/adapters | Transactional CRUD, conditional claims, append-only records, snapshots/events/outbox | Business policy or authorization |
| Observability/provider adapters | Structured events/metrics and external notification/payment integrations | Deciding game outcomes or financial authority |
| Browser | Presentation, Firebase Auth UI, client intent, permitted self-service Firestore operations | Authoritative balance, winner, result, XP or admin role decisions |

The existing v2 package graph is the natural target foundation. It does **not** yet include every production edge: Firebase Auth verifier and service startup must be supplied; a production observability sink and outbox publisher are still composition choices; payment-provider integration and legal/compliance rules are not implemented; and v2 runtime traffic is deliberately inactive. Implement those as injected adapters only when the corresponding migration phase is ready.

# Migration Strategy

Use a strangler-style migration in the existing Node process. Keep old Socket.IO event names and static pages during initial cutover. Make the legacy runtime the default until the new boundary proves equivalence. Persist the runtime assignment for each match and never switch the same match between implementations mid-lifecycle.

1. **Characterize and secure:** capture legacy wire behavior, output snapshots, lifecycle, money/idempotency and restart limitations in tests. Prioritize stored XSS, admin identity and unauthenticated provider relay risks before exposing more admin features. Establish a verified Firebase Rules test path.
2. **Create the real composition root:** move only construction/startup/configuration/health/shutdown out of `server.js`; keep existing handlers and `GameRoom` behavior intact. Inject `io`, Firestore, clock and ID sources into extracted components.
3. **Extract transport/application seams:** register legacy Socket.IO names in a thin adapter; route event work into application/use-case functions. Establish one shared identity context and validation/error mapping before migrating domain policies.
4. **Extract lobby and membership:** move room registry, seat admission/leave, reconnection grace, practice-room limits and room-list projection behind application services. Keep room data in memory initially and prove regression parity.
5. **Extract the game aggregate:** split lifecycle/result, commands, simulation systems and snapshots into testable modules. Preserve current physics, RNG/timers, event ordering, event names, scoring and `ROOMCONFIG_V2` behavior; avoid gameplay rebalance during architectural extraction.
6. **Introduce persistence ports incrementally:** begin with durable match metadata/snapshot/event lifecycle and recovery, then migrate user/inventory/progression. Add an explicit legacy collection adapter or migration plan; do not silently switch schema or read/write authority mid-operation.
7. **Unify economy and settlement:** map legacy paid-entry receipts, refunds, wallet movements, house fees, pending prizes and solo tickets to a single policy and idempotency model. Preserve monetary minor-unit semantics and reconcile old records before enabling v2 settlement. Obtain production legal/compliance/provider signoff separately.
8. **Unify administration and observability:** use verified per-admin identity, operation permissions, durable audit and safe step-up authorization; migrate direct browser mutations only after the server path and Rules are ready. Add structured sink, metrics and provider outbox.
9. **Controlled per-match rollout:** integrate Runtime Integration and Production Adapter at match creation, with LEGACY default, allowlist/test match, explicit kill switch and sticky persisted assignments. Compare invariants/results and monitor before raising rollout percentage.
10. **Retire legacy branches only on evidence:** verify no matches, clients or operational tools still rely on an old event/schema; preserve rollback/compatibility window and archive migration evidence before removing old code or rules.

For every phase: add focused contract/characterization tests, run the same core legacy suite, test failure/retry cases, document data ownership, and avoid combining architecture work with gameplay/economy policy changes.

# Risk Assessment

| Risk | Likelihood | Impact | Confidence | Mitigation/order |
|---|---|---|---|---|
| Stored XSS reaches an admin session through unescaped Firestore nickname data | Plausible from current code/rules | High: admin-context script execution and possible privileged Firestore actions | High | Fix first; add rendering and Rules regression tests |
| Shared `ADMIN_PASSWORD` compromise or brute-force exposure | Unknown secret strength; exposed transport endpoint | High: administrative socket actions | High for design weakness; likelihood deployment-dependent | Replace with per-admin authenticated principal and permission checks; rate limit globally |
| Unauthenticated Telegram notification abuse | Plausible for any reachable socket client | Medium: spam, provider reputation/limits and operational cost | High | Require identity/authorization, global quotas, outbox |
| Process restart drops live matches and timers | Normal operational possibility | High for match continuity; may impact paid entries if not reconciled | High | Durable snapshots/recovery and explicit abort/settlement recovery policy |
| Future horizontal scaling creates split room authority | High if replicas introduced without shared state | High: duplicate/lost match events, inconsistent balances or results | High | Keep single-process authority until match assignment, persistence and Socket.IO adapter are integrated |
| Legacy/v2 schema split causes duplicate/missing records during migration | Medium during gradual cutover | High for money/progression correctness | High | Per-match sticky runtime, migration ledger/reconciliation, no dual-write without idempotency |
| Firestore match aggregate grows beyond transaction/document limits | Low at current tested volume; increases with long/event-heavy matches | High: persistence/recovery unavailable | Medium-high | Define event retention, segmenting/archive strategy and load limits before rollout |
| Admin email claim misconfiguration or account takeover | Depends on Firebase account/provider setup | High: Rules-authorized global admin | Medium-high | Verified custom claims, rule tests, controlled provisioning |
| CI misses tests or auto-repair workflow pushes unintended change | Plausible process/configuration risk | Medium-high: regression or unreviewed main mutation | High | Single test command, remove/disable one-off write workflow after its need ends, protect main |
| Behavioral regressions during extraction | Medium-high given tightly coupled handlers and simulation | High for user experience, fairness and money | High | Characterize, preserve wire API, phase by responsibility, do not refactor gameplay policy concurrently |

No conclusion here establishes whether a particular vulnerability is currently exploited or whether the production Firebase setup has been compromised. The highest-priority items are source-level findings with concrete paths; operational risk levels depend on deployment controls.

# Recommended Phase Order

1. **Admin security and production verification gates:** fix the stored XSS; close or authorize the Telegram relay; verify/administer shared-secret exposure; exercise Firestore Rules in an emulator; confirm active production rules/provider setup. Keep this phase behavior-focused and narrowly scoped.
2. **Baseline and wiring visibility:** make CI run all required suites; document what is live vs prepared; add deployment/readiness checks and current behavior tests.
3. **Composition/lifecycle extraction:** create an `apps/server` composition root and explicit dependency injection while the monolith still owns logic.
4. **Transport/application separation:** legacy Socket.IO event compatibility layer, shared identity/authz, validation and error response policy.
5. **Room registry and match membership:** room lifecycle, seat/reconnect logic and lobby projections.
6. **Game lifecycle/result boundary:** lifecycle transitions, deterministic result locking and finalization; then simulation systems and snapshot projection.
7. **Persistence/recovery:** match snapshots/events, versioning and restart behavior; define aggregate retention/Firestore limits.
8. **Progression and non-financial platform data:** use the existing adapter and v2 policy without moving wallet authority at the same time.
9. **Economy/settlement and administration:** only after data reconciliation, idempotency, audit, provider/compliance gates and Rules parity are proven.
10. **Controlled runtime rollout and legacy retirement:** sticky assignment, allowlist, kill switch, measure/compare, then remove dead legacy paths gradually.

This order deliberately resolves concrete admin security concerns before widening the new runtime, separates low-risk composition work from game-rule changes, and postpones money migration until durable state, idempotency, audit and operational approval are in place.

## Do Not Change Yet

- **Do not replace or rewrite `server.js` wholesale.** Keep it as the compatibility runtime while boundaries are extracted and parity is demonstrated.
- **Do not change game mechanics/tuning** (tick rate, movement, damage, cooldowns, team eligibility, zone timing, bot policy, loot, win conditions or score rules) during structural extraction. Treat the existing behavior and tests as the baseline.
- **Do not change result identity/hash, progression XP policies, mission IDs/versions, level curves or existing user progression data** without an explicit migration and duplicate/replay proof.
- **Do not change monetary units, entry/payout/fee policy, receipt identity, payment state transitions or legacy wallet collections** before reconciliation and settlement migration tests. Production legal/compliance and payment-provider approval remain separate release gates.
- **Do not publish `storage.rules` as active policy** while the project uses Cloudinary for uploads; it is labeled obsolete and contains historical rules.
- **Do not remove, rename or alter existing Socket.IO event names or browser storage keys** until the compatibility layer and deployed-client usage are measured.
- **Do not discard the `ROOMCONFIG_V2` geometry/state split, volatile 30 Hz broadcast, public room-list throttle, solo-ticket transaction helpers, or server-side paid-economy fail-closed behavior.** They address real compatibility, bandwidth, or authority requirements.
- **Do not rewrite the already well-bounded v2 contract, Identity, Application, Coordinator, Economy, Settlement, Progression, Administration, Observability, Persistence or Firestore adapter modules merely to make them look different.** First wire them behind production adapters and identify concrete gaps.
- **Do not treat the v2 test harness, production adapter, runtime assignment or v2 Firestore collections as live production behavior** until the composition root and rollout are integrated and verified.
- **Do not remove browser direct Firestore paths or tighten Rules blindly.** Pair each client/server migration with emulator tests and a deployment plan to avoid breaking login, profile, wallet requests or existing admin operations.
- **Do not introduce microservices, Kubernetes, queues as external infrastructure, or a new database solely to address current coupling.** The existing modular monolith, Firestore ports and outbox abstractions are a sufficient near-term target.
