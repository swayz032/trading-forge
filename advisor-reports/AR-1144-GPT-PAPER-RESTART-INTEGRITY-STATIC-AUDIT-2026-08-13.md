# AR-1144 — GPT STATIC AUDIT: PAPER RESTART INTEGRITY

**Date:** 2026-08-13  
**Engineering branch inspected:** `h1-wave4-sealed12-driver` at pushed head `5a82f6f51eeb0d6b47976f83a73cfa8446ca0013`  
**Scope:** PAPER qualification / restart integrity only. No live-capital mutation instructions.  
**Worker collision rule:** Claude remains mid-order on AR-1138. Do not restart or modify that unfinished compiler/grading lane.

## 1. Reusable restart foundation already exists

Repository history already contains useful restart durability work and should be reused rather than rebuilt:

- `c4a730d0fd0cadfae1dcd7f45fba62d2146cb4a7` persisted deferred paper entries in `paper_pending_entries`, added boot rehydration coverage, and replaced unseeded fill randomness with deterministic seeded behavior.
- `adfee35502b0d769dd1eeea627ef932720db7a33` later composed the real production sizing -> pending entry -> open -> close path against a real PGlite DB with a shared correlation ID.
- `04927bd3ce8ddc60f49ccf3cc1493c63f2dbf23b` repaired scheduler boot wiring that could otherwise prevent `resumeActivePaperSessions()` from running.

**Decision:** do not invent another paper-recovery system. Certify and tighten the current one.

## 2. Concrete current-branch finding — orphan session resumes fail-open

Current `src/server/db/schema.ts` defines:

```text
paper_sessions.strategy_id -> strategies.id, ON DELETE SET NULL
```

So an active paper-session row can legally remain with `strategy_id = NULL` after its strategy row disappears.

Current `src/server/scheduler.ts::resumeActivePaperSessions()` explicitly says that a NULL lifecycle state / orphaned or legacy session is treated as pre-PAPER and is safe to resume. Its authority guard only skips internal-stream resurrection when a resolved strategy is in:

```text
PAPER | DEPLOY_READY | PILOT | DEPLOYED
```

Therefore the current restart logic has this shape:

```text
active paper_sessions row
-> strategy lookup misses / strategy_id NULL
-> lifecycleState = null
-> PAPER+ skip guard does not fire
-> session is treated as pre-PAPER
-> internal simulator may be resumed
```

### Verdict

This is a **PAPER-qualification integrity fail-open**.

It is not, by itself, evidence of a funded-account order-routing defect: the path being discussed is the internal paper simulator. But an orphan simulator session can contaminate a frozen candidate's official 3-5 trading-day PAPER evidence, which is enough to make it release-blocking for the qualification window.

## 3. Qualification invariant that must hold before PAPER Day 1

A restart must never guess strategy identity.

For an official PAPER session, all of the following must be true after restart:

```text
session.strategy_id resolves to exactly one strategy
AND strategy identity matches the frozen PAPER candidate/version
AND lifecycle authority is known
AND pending entries belong to that same session/strategy
AND restored positions/governor state belong to that same session/strategy
AND no second simulator/runtime authority is started for the same candidate
```

If strategy identity is missing, deleted, contradictory, or cannot be proven, the safe qualification result is **do not count that session/day as valid PAPER evidence** until reconciled.

## 4. Restart witness to require before counting the PAPER window

Use the existing recovery machinery and produce a single end-to-end evidence witness for the frozen candidate:

1. Start an official PAPER session with a known frozen strategy ID/version.
2. Persist at least one representative state boundary: pending entry and/or open simulated position as appropriate for the test fixture.
3. Restart the application process in the PAPER environment.
4. Prove scheduler boot executes recovery.
5. Prove the same session/strategy identity returns.
6. Prove pending-entry state is not silently lost or duplicated.
7. Prove position/governor state restores conservatively.
8. Prove market-data backfill/reconnect does not replay a signal as a second trade.
9. Prove no orphan/NULL-strategy session is resumed as valid qualification evidence.
10. Stamp one correlation/restart receipt showing before/after identity and result.

This is a **qualification witness**, not a new architecture project.

## 5. PAPER-day health semantics

For the 3-5 day qualification window:

- **GREEN** — frozen candidate identity proven across the day and any restart; no duplicate/lost state.
- **YELLOW / INVESTIGATE** — degraded but evidence remains reconstructable; day should not be promoted to GREEN until reconciled.
- **RED / PAPER DAY INVALID** — orphan strategy identity, duplicate authority, duplicated/lost qualifying trade state, or unreconstructable restart state.

Do not silently count a red day toward the 3-5 required trading days.

## 6. Fastest next engineering action

Do not broadly refactor scheduler or paper trading.

The narrow next action after this audit is to inspect the current restart tests around `resumeActivePaperSessions`, `paper_pending_entries`, state restore, and stream backfill for a discriminator covering the orphan/NULL-strategy case. If no such fail-closed discriminator exists, that is the smallest measured PAPER-integrity gap to close after the compiler critical path permits it.

## 7. Current verdict

- Pending-entry restart durability: **FOUND / reusable foundation**.
- Scheduler boot resume path: **FOUND**.
- PAPER+ authority skip: **FOUND**.
- Missing-strategy/orphan handling: **FAIL-OPEN FOR QUALIFICATION IN CURRENT STATIC CODE**.
- Official restart witness for frozen 3-5 day PAPER candidate: **NOT YET CERTIFIED**.

**Advisor directive:** preserve AR-1138; carry this as a bounded P0 PAPER-readiness item so Claude does not spend fresh quota rediscovering the restart semantics.