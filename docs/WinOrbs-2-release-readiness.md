# WinOrbs 2.0 — Release Readiness Checklist

## Architecture
- [x] Game lifecycle has explicit states and transitions.
- [x] Game state is server authoritative.
- [x] MatchOrbs, Score, XP and persistent economy are separated.
- [x] Platform modules have explicit boundaries.
- [x] Firestore access has a repository boundary for new platform code.

## Security
- [x] No fallback administrator password in source.
- [x] Client UID is not accepted as verified identity.
- [x] Sensitive admin socket sessions expire.
- [x] Administrative actions are audit logged.
- [x] Inventory/progression/reward writes are server/admin controlled.
- [x] Firebase rules prevent client fabrication of matches, paid entries and prizes.
- [x] Storage rules contain no hardcoded administrator UID.
- [x] Request-ID and idempotency primitives exist for sensitive workflows.
- [x] Input validation and rate limiting boundaries exist.

## Economy
- [x] Real-money operations remain outside game-domain authority.
- [x] Missing Firebase Admin credentials disable server economy instead of trusting the client.
- [x] Entry collection and prize settlement use server transactions.
- [x] Duplicate settlement is guarded by deterministic transaction records.
- [ ] Production legal/compliance approval for real-money entry, prizes, withdrawals and USDT.
- [ ] Production payment provider configuration and operational verification.

## Verification
- [x] Domain and security tests are registered in `npm run check`.
- [x] GitHub Actions green on the final migration head (CI run #145, commit `8b6f6aafad1fe23b7b33364c4e82c8e424a1c793`).
- [ ] Production smoke test with Firebase staging credentials.
- [ ] Client/server end-to-end match test.

## Deployment
- [ ] Review migration branch.
- [ ] Configure production secrets outside Git.
- [ ] Publish reviewed Firestore/Storage rules.
- [ ] Run database/backfill migrations if required.
- [ ] Create PR to main only after CI and staging verification.

## Important
This checklist does not authorize real-money gaming deployment. Legal/compliance, payment-provider and jurisdiction/age eligibility decisions remain founder/operator decisions.