# WinOrbs 2.0 — Platform Migration Boundary

## Completed in this phase

The platform layer now has explicit boundaries for:
- Identity
- Inventory
- Cosmetics
- Progression
- Rewards
- Audit
- Rate limiting
- Request idempotency
- Firestore persistence

## Authority model

Client requests are untrusted input.
- Authentication comes from verified Firebase identity tokens.
- Inventory ownership is server-side.
- Cosmetic equip requires owned inventory.
- XP and level are server-side state.
- Rewards use one-time claim semantics.
- Administrative sessions expire.
- Administrative actions are audit logged.
- Firestore client rules do not permit fabrication of matches, paid entries, prizes, inventory or progression.

## Economy boundary

Real-money state remains outside the game engine.

Game → Platform → Economy Adapter → Financial Provider

The game engine never receives authority to create deposits, withdrawals or prize balances.

## Persistence rule

Gameplay state remains in memory during a match. Firestore is persistence/infrastructure, not the real-time movement/combat authority.

## Migration rule

New platform features must enter through the corresponding module boundary and tests. Direct cross-module writes from transport handlers are treated as technical debt and should be removed during the final cleanup phase.