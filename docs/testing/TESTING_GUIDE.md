# Testing Guide

## Overview

WinOrbs keeps its existing CommonJS test scripts and Node `assert`-based conventions. Most tests are standalone programs, many already use focused fakes or executable characterization of legacy code. The project has no shared test-framework lifecycle, and converting these scripts to Jest, Vitest, or `node:test` would add churn without materially improving the current tests. No framework or package migration is part of this phase.

Tests remain in `tests/` rather than being moved into category directories. Several characterize specific source ranges in `server.js` or browser HTML and use paths relative to the current location; preserving their paths avoids unrelated import/source-slicing changes. `tests/run_suite.js` maps the existing scripts into logical suites and launches each in a fresh Node process.

## Test hierarchy

| Category | What belongs here | Representative coverage |
|---|---|---|
| Unit / characterization | Pure domain rules, small helpers, deterministic UI behavior, source-level compatibility checks | Game lifecycle, combat, scoring, team mode, player-state projection, lobby rendering |
| Integration | Several modules composed with in-memory fakes or injected adapters; in-process HTTP/Socket.IO boundary checks | Firebase initialization, status/CORS/Socket.IO, bootstrap, production adapter |
| Security | Authorization, identity binding, administrative sessions, Firestore Rules, rate limits, secret/CORS policy | Admin operations, verified principals, production configuration |
| Contracts | Accepted/rejected command, event, state, result, and transport shapes | v2 contracts, transport validation, shared vocabulary/types |
| Persistence | Repository/transaction semantics, recovery, idempotency, settlement durability | Firestore repository, match snapshots, ledger/economy, recovery |
| Progression | XP, levels, missions, rewards, and legacy-to-v2 adapter behavior | Progression rules and runtime integration |
| Runtime | Composition, lifecycle, controlled rollout, deterministic execution/recovery | Runtime harness, coordinator, controlled integration |
| E2E / live | Separate client processes communicating with a started server over HTTP/Socket.IO | Authentication/admin room operations, multiplayer, match start |

The same script may be useful to more than one focused command. `npm test` de-duplicates the mapped scripts and runs the complete **offline/deterministic** suite; it deliberately excludes live-server and external-service tests. `npm run check` remains available as the existing repository check command.

## Commands

Run the complete deterministic suite:

```sh
npm test
npm run check
```

Run a focused suite:

```sh
npm run test:unit
npm run test:integration
npm run test:security
npm run test:contracts
npm run test:persistence
npm run test:progression
npm run test:runtime
```

`npm run test:game` is retained as a legacy convenience command for game, security, persistence, and progression tests. `npm run test:config` runs configuration-specific validation.

Run the live server/client suite separately:

```sh
ADMIN_PASSWORD='a disposable local test password' npm run test:e2e
```

`test:e2e` and its `test:live` alias start `server.js` with `NODE_ENV=test`, run the existing live scripts, and stop the child server. They require an explicitly configured `ADMIN_PASSWORD`; there is no test-only hard-coded admin fallback. The current clients use port 3000. Firebase-backed paid/economy behavior remains disabled without valid Firebase Admin credentials; do not point destructive/manual E2E checks at production. The live runner now returns a failing exit status when a child test fails, reports failed assertions, or times out.

`test_apodos.js` requires a live server and can access Firestore when local service-account credentials exist. `test_zona_loot_recarga.js` requires a live server and explicit admin credentials. `test_latencia.js` is an operational diagnostic (it may contact the configured remote endpoint); it is not a deterministic CI test. Run these manually only in an appropriate non-production environment.

## Mocking strategy

- Prefer pure inputs/outputs for game-domain and contract tests.
- Use in-memory fakes for Firestore, Socket.IO emitters, clocks, and server adapters. Assert both state changes and emitted/recorded effects.
- Inject clocks/dependencies where the production module already supports it; avoid global monkey-patching where possible.
- Keep Firebase Admin out of ordinary unit/integration runs. Test credential selection with fake Admin SDK and filesystem implementations, as `test_firebase_init.js` does.
- Use real HTTP and Socket.IO listeners only in focused in-process integration tests or explicit E2E runs; avoid external Firebase/network dependencies in the default suite.
- Do not silently skip assertions when an external dependency is unavailable. Keep service-dependent tests separate and report the missing prerequisite.

## Integration requirements

Integration tests should name the boundary being exercised, construct real in-process adapters when practical, and use fakes at external service boundaries. Cover success and failure responses, middleware/policy behavior, and cleanup (close servers, sockets, and timers). A Firestore emulator or disposable project should be required only for tests specifically designated as Firebase-backed; never use real paid workflows as test fixtures.

Live tests must use a test server and disposable identities/rooms, require explicit credentials, apply timeouts, and clean up resources they create. The legacy live scripts have timing-sensitive behavior and some depend on production-like configuration; their outcomes are reported separately from the deterministic CI baseline.

## Deterministic testing strategy

- Supply explicit environments, fake Firestore snapshots, IDs, and payloads rather than reading mutable global state.
- Avoid wall-clock sleeps in new unit tests; inject a clock or assert state synchronously. Existing E2E timing waits are isolated to the live suite.
- Assert stable contracts and measurable rules (transition legality, cent-exact settlement, cooldowns, rate limits, retry/idempotency, and serialization privacy).
- Test recovery and duplicate/replay paths alongside happy paths for persistence/progression work.
- Do not target an arbitrary coverage percentage. Coverage instrumentation is deferred because the suite contains standalone scripts, source-sliced legacy tests, and subprocess-driven E2E checks; a useful report requires a deliberate common instrumentation/test lifecycle rather than adding a nominal percentage gate.

## Current architecture observations

The tests use Node's built-in `assert` API but do not use the `node:test` runner. `tests/run_live.js` is a custom E2E orchestrator. The new suite runner preserves these choices, gives each script an isolated process, provides targeted commands, and makes script exit failures visible. It does not relocate tests or change their assertions.
