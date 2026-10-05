# Composition Root v2

This package creates a dependency-injected composition root for the WinOrbs v2
architecture. It is intentionally isolated from the legacy runtime and never
starts Express, Socket.IO, Firebase, Firestore, workers, or timers.

## Purpose

The root assembles existing v2 modules without modifying closed contracts or
infrastructure. It wires together:

- Identity
- Match Coordinator
- Application boundary
- Match Persistence/Recovery
- Application Recovery boundary
- Observability
- Economy
- Settlement
- optional transport adapter

The direction of dependencies is always from the composition root toward the
implemented layers. Existing modules do not import bootstrap.

## What it creates

`createWinOrbsV2(options)` accepts injected adapters and builds a coherent
composition object:

- `contracts`
- `gameEngine`
- `matchCoordinator`
- `identity`
- `application`
- `matchPersistence`
- `applicationRecovery`
- `observability`
- `economy`
- `settlement`
- `transport` (optional)

## Fresh match vs recovery

A fresh root is created without `restoreState`; the trusted caller may then
call `matchCoordinator.createMatch()` once. Recovery is explicit: pass the
validated recovery envelope as `restoreState`. Bootstrap calls
`matchCoordinator.restoreFromPersistedState()` before constructing Application
and fails closed if validation fails. It never creates a fresh match and then
overwrites it. Restored members have no active session binding until an
authenticated player is reassociated through Application v2.

## What it does not do

- start a server
- start Socket.IO
- run settlement or payouts
- run recovery
- connect to Firebase/Firestore
- touch the legacy runtime
- create secret-bearing defaults

## Dependencies and injection

Concrete adapters are passed through `options`.

Required examples include:

- `clock`
- `identity`
- `persistence`
- `observabilitySink`
- `authorizeSystem`

Optional factories may also be supplied for each layer, but the root enforces
structural contracts before returning the composition.

## Testing without production

The bootstrap is tested with in-memory fakes and injected adapters only. No
production Firestore, Firebase Admin, service-account credentials, or real
Socket.IO server are initialized.
