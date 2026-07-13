# Parallel lanes — end-of-session status (2026-07-13)

## Lane 1 — gpt-5.4 whole-job design-pool (the make-or-break measurement)
- **6 of 16 videos extracted today** (-igp, 0xygpCMwxbQ, 2DXQqwKSwJE, 4cT8, CLDEIsNpVRc, DLwVqcLRcfw): free partition + the $2 burst.
- **Burst AUTO-STOPPED at the token cap: $1.66 spent** (248,520 paid tokens < the 250K/$2 ceiling), then reverted to free → paused. Bounded exactly as proven.
- **10 videos remain** → the armed cron (`TF-Frontier-DesignPool-Resume`, every 4h) resumes over the free days (~200K/day → ~3 videos/day → ~3-4 days), governor-walled, lock-protected, cache-resumed.
- After all 16 extract → Python locator-support measurement (the ≤8% bar) → clear → freeze SHA → terminal read (fence witness probe + A-packet topology + frozen shape, read once).

## Lane 2 — mini Phase-B copy tryout (role-split qualifier)
- **All 6 birth videos copied** on the mini's free pool (scoped by gpt-5.4's certified enumerations; mini 309K/1M).
- Mechanical judge RUNNING (local gemma locator anchor-rate, free): ≥92% anchored → mini qualifies for the Phase-B copy seat (role-split licensable, own design-pool measurement next → ~10+ videos/day at production scale); <92% → default stays gpt-5.4 whole-job.

## Governor / money (all proven, card sealed)
- Empirical: cached tokens count FULL-WEIGHT vs the free cap (cache discounts bill-price only). Conservative ledger was right.
- Persistent daily ledger enforces the true cross-run wall (UTC-keyed). Burst ticket hard-bounded on BOTH tokens (250K) and dollars ($2), auto-expires at consumption/midnight, wall reverts to free-only. 28/28 governor trip checks.
- **Total cash this session: ~$1.66 + the $0.08 pre-ledger leak = ~$1.74** (operator authorized $2). Sealed 12 protocol-locked, unbuyable at any price.

## Cron
`TF-Frontier-DesignPool-Resume` armed (every 4h, next 08:05 local, Status Ready) — race-safe lock, idempotent, governor-walled.
