# TypeScript Migration Strategy

## Objective

Migrate the existing CommonJS JavaScript code incrementally. TypeScript is strict
for migrated source, while JavaScript remains the runtime and test environment
for modules that have not moved. Preserve runtime behavior, network and database
behavior, and public contracts at every boundary.

## Migration Rules

- Migrate one small, coherent module boundary at a time; do not mass-convert.
- Read the existing implementation and tests before changing a module. Keep
  behavior tests in place and run them against the emitted CommonJS output.
- Keep strict mode enabled. Prefer `unknown`, guards, literal unions,
  discriminated unions, interfaces, and generics. Do not add `any` without a
  documented, localized reason.
- Keep existing CommonJS paths and exports stable. Compile TypeScript to the
  corresponding JavaScript path and retain source maps for debugging.
- Do not migrate deployment scripts, generated files, tooling, or unrelated
  legacy code as part of domain work.
- Do not commit changes automatically as part of the migration workflow.

## Order and Status

1. **Contracts vocabulary**: `packages/contracts/v2/index.ts` is the first
   migrated source boundary. Its frozen constants and CommonJS exports remain
   compatible with existing JavaScript consumers. Contract validators remain
   JavaScript for now.
2. **Contract models and validation**: type `GameCommand`, `GameEvent`,
   `GameState`, `PlayerState`, `MatchResult`, principals, and validation results;
   preserve exact-key and rejection behavior in the existing contract tests.
3. **Validation package**: migrate pure input validation functions, using
   `unknown` inputs and type guards while keeping error codes and paths stable.
4. **Domain models and game**: migrate focused domain boundaries. Treat socket
   payloads as untrusted `unknown` until validated; keep transport and network
   behavior unchanged.
5. **Progression**: type `ProgressionProfile` and its domain operations after
   contract and game types are established. Preserve Firestore document shapes,
   field names, and persistence semantics.

## Initial Boundary

The first boundary is deliberately limited to the constants module at
`packages/contracts/v2/index.js`. It is imported throughout the application,
so its CommonJS resolution path, frozen export object, constant values, and
array ordering are compatibility requirements. `validation.js` and all
consumers stay unchanged in this phase. `tests/test_contracts_v2.js` is the
behavior check; the TypeScript build must run before this test so it exercises
the emitted JavaScript.

## Remaining JavaScript

The following remain JavaScript after the initial boundary and are not implied
to be migrated by the first phase:

- `packages/contracts/v2/validation.js` and contract model definitions.
- `packages/validation`, game and game-engine domain implementations.
- `packages/progression` and Firestore persistence adapters.
- Socket transport, server/runtime integration, administration, and other
  application packages.
- Deployment scripts, tools, generated output, browser code, and legacy code
  outside a selected domain boundary.

Update this document as each module is migrated, tested, and reviewed for
contract compatibility.