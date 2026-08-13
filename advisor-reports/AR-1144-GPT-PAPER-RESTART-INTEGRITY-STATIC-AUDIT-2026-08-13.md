# AR-1144 — GPT STATIC AUDIT: PRE-PAPER RESTART INTEGRITY — CORRECTED

**Date:** 2026-08-13  
**Engineering branch inspected:** `h1-wave4-sealed12-driver` at pushed head `5a82f6f51eeb0d6b47976f83a73cfa8446ca0013`  
**Status:** CORRECTED after deeper route inspection.  
**Worker collision rule:** Claude remains mid-order on AR-1138. Do not restart or modify that unfinished compiler/grading lane.

## 0. Correction to the first AR-1144 wording

The first version overstated the orphan-session restart issue as an official 3-5 day PAPER qualification blocker.

Deeper inspection of current `src/server/routes/paper.ts` proves the internal Massive-WebSocket simulator is **pre-PAPER only**. The route explicitly refuses to start it when the strategy lifecycle is in:

```text
PAPER | DEPLOY_READY | PILOT | DEPLOYED
```

and states that PAPER+ strategies use **TradersPost as the canonical journal**.

Therefore:

- the orphan/NULL-strategy restart behavior below is a real **pre-PAPER simulator integrity** issue;
- it is **not automatically the authority for the official 3-5 day PAPER window**;
- it becomes an official qualification problem only if pre-PAPER simulator evidence is mistakenly counted as PAPER evidence or if the separate TradersPost/PAPER authority has an analogous identity gap.

This correction supersedes any earlier AR-1144 sentence calling the internal orphan session itself a proven official PAPER blocker.

## 1. Reusable pre-PAPER restart foundation exists

Repository history already contains useful restart durability work:

- `c4a730d0fd0cadfae1dcd7f45fba62d2146cb4a7` persisted deferred internal-paper entries in `paper_pending_entries`, added boot rehydration coverage, and replaced unseeded fill randomness with deterministic seeded behavior.
- `adfee35502b0d769dd1eeea627ef932720db7a33` later composed the real sizing -> pending entry -> open -> close path against a real PGlite DB with a shared correlation ID.
- `04927bd3ce8ddc60f49ccf3cc1493c63f2dbf23b` repaired scheduler boot wiring that could otherwise prevent `resumeActivePaperSessions()` from running.

**Decision:** reuse this machinery for pre-PAPER screening; do not rebuild it.

## 2. Concrete current-branch pre-PAPER finding — orphan session resumes fail-open

Current `src/server/db/schema.ts` defines:

```text
paper_sessions.strategy_id -> strategies.id, ON DELETE SET NULL
```

So an active internal simulator session can remain with `strategy_id = NULL` after its strategy row disappears.

Current `src/server/scheduler.ts::resumeActivePaperSessions()` explicitly treats a NULL lifecycle state / orphaned or legacy session as pre-PAPER and eligible to resume. A resolved strategy in PAPER+ is skipped, but a missing strategy does not trigger that skip.

Current shape:

```text
active internal paper_sessions row
-> strategy lookup misses / strategy_id NULL
-> lifecycleState = null
-> PAPER+ skip guard does not fire
-> session is treated as pre-PAPER
-> internal simulator may be resumed
```

### Corrected verdict

This is a **pre-PAPER simulator integrity fail-open**.

It should not be silently treated as valid screening evidence for a known strategy because restart is guessing that a missing strategy is safe pre-PAPER state.

## 3. Official PAPER authority is separate

Current `POST /api/paper/start` explicitly refuses PAPER+ strategies and returns:

```text
paper_start_refused_paper_state
```

with the reason that PAPER+ strategies use TradersPost as the canonical paper journal and the internal simulator is pre-PAPER only.

That separation is good and materially reduces the blast radius of the orphan restart finding.

### New audit target

The real official-PAPER question is now:

```text
Does the TradersPost/PAPER journal bind every qualifying day/trade to the exact frozen strategy identity/version, and does that identity survive restart/reconnect without ambiguity?
```

That must be audited separately; this file does not claim the answer.

## 4. Pre-PAPER restart invariant

For internal screening, restart must never guess strategy identity.

A resumed internal simulator session should have reconstructable proof of:

```text
session.strategy_id resolves
AND resolved strategy is still eligible for internal pre-PAPER simulation
AND pending entries/positions belong to that same session/strategy
AND restart does not duplicate signals/trades
```

A missing/deleted strategy should be treated as degraded/invalid screening evidence rather than silently assumed safe.

## 5. Pre-PAPER restart witness

Before relying on internal screening results at scale, use the existing recovery machinery to prove:

1. known strategy/session identity before restart;
2. pending-entry persistence where applicable;
3. conservative position/governor restoration;
4. backfill/reconnect does not replay a signal as a second trade;
5. orphan/NULL-strategy session does not masquerade as valid named-strategy evidence;
6. correlation/restart receipt identifies before/after state.

## 6. Official 3-5 day PAPER work moves to a different audit lane

Do **not** use the internal simulator restart witness as the sole official PAPER certification.

For the 3-5 trading-day window, audit the actual PAPER+ authority:

```text
frozen strategy identity/version
-> TradersPost canonical journal
-> execution/trade evidence
-> nightly 3AM advisory receipt
-> no mutation of frozen candidate
-> restart/reconnect identity continuity
```

AR-1145 already covers the nightly 3AM evidence half. A separate immutability/journal audit should cover the frozen strategy binding.

## 7. Corrected verdict

- Internal pending-entry restart durability: **FOUND / reusable foundation**.
- Internal scheduler boot resume path: **FOUND**.
- PAPER+ internal-simulator refusal: **FOUND and GOOD**.
- Orphan/NULL-strategy internal resume: **FAIL-OPEN FOR PRE-PAPER SCREENING IDENTITY**.
- Proven impact on official TradersPost PAPER journal: **NOT ESTABLISHED**.
- Official 3-5 day PAPER restart/immutability witness: **STILL NOT YET CERTIFIED, BUT MUST BE AUDITED ON THE TRADERPOST/PAPER+ PATH, NOT INFERRED FROM THIS INTERNAL SIMULATOR FINDING**.

**Advisor directive:** preserve AR-1138. Carry the orphan handling as a bounded pre-PAPER integrity item and move official PAPER immutability review to the TradersPost/PAPER+ authority.