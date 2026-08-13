# GPT ADVISOR REPORT — AR-1141 — NO-CLAUDE STRATEGY ROTATION + 200-VIDEO LIBRARY PLAN

**Seat:** GPT external advisor  
**Date:** 2026-08-13  
**Purpose:** preserve the operator's post-Claude autonomy goal without redirecting the worker's active AR-1138 compiler/grading lane.

## 1. CURRENT LIBRARY COUNT — USE UNIQUE VIDEOS AS THE SOURCE DENOMINATOR

The current historical library is **40 unique YouTube videos/transcripts**, not 120 independent source ideas.

Merged PR #23 records the production proof:

- 40/40 transcripts stored;
- 120/120 strategy rows linked;
- the rows are the market-materialized library surface.

The Evidence Vault also has MES/MNQ/MCL filtering while preserving one canonical library (PR #21).

Therefore, planning and research reports should distinguish:

- **source breadth:** unique YouTube videos;
- **market candidates:** per-market MES/MNQ/MCL rows or compiled variants.

The operator's target is **200 unique YouTube videos before Claude Code access expires**. If the same three-market materialization remains applicable, that can produce up to roughly **600 market-specific candidate rows**, but 600 rows must never be reported as 600 independent source strategies. Some videos may refuse, produce fewer/more strategies, or be inapplicable to one or more markets.

## 2. SPEED RULE FOR THE 200-VIDEO EXPANSION

Do **not** make full processing of all 200 videos a blocker for the first qualified TopstepX candidate.

Fast path:

1. archive/source-pin as many of the additional 160 unique videos as practical;
2. preserve immutable transcript/evidence provenance;
3. current AR-1138 compiler breakthrough stays P0;
4. once the compiler vertical is real, feed the enlarged library through the batch conveyor;
5. faithful compile or exact refusal per candidate;
6. start edge qualification on usable candidates immediately instead of waiting for every source to be repaired.

This separates **banking future research inventory** from **blocking the current money path**.

## 3. VERIFIED AUTONOMY PIECES THAT ALREADY EXIST

Do not rebuild these from scratch:

- **Night Agent / Learning Loop:** merged PR #28 hardens the Night Agent, binds nightly critique creation to the Learning Loop, preserves immutable night receipts, and routes nightly analysis through GPT infrastructure.
- **Decay plumbing:** prior production hardening repaired `/api/decay/*` and the nightly decay step; later hardening feeds real per-strategy paper P&L/trade history and `promoted_at` into decay analytics rather than hollow empty inputs.
- **Paper isolation:** merged PR #19 uses `paper_sim` so paper accounts are structurally unroutable to funded broker dispatch.
- **Broker-egress chokepoint:** merged PR #22 narrows broker network egress and adds a bypass guard.
- **Candidate/lifecycle machinery:** repository tests and lifecycle work include a candidate backtest conveyor, SHADOW→PAPER, PAPER→DEPLOY_READY, backtest-staleness gates, and promotion controls.
- **Regime-drift demotion:** repository test history includes deployed-strategy regime-drift detection where a strategy is demoted after the specified consecutive drift condition while non-drifted deployed strategies remain untouched.

These are foundations. They are not by themselves proof that the complete no-Claude rotation loop is production-ready today.

## 4. IMPORTANT GAP — DECAY/DEMOTION IS NOT YET PROOF OF AUTOMATIC REPLACEMENT

The operator correctly expects strategies to be monitored for decay. Evidence exists for decay analytics and demotion behavior.

However, this advisor has **not yet verified a complete production path** that guarantees:

`ACTIVE STRATEGY DECAYS -> SAFE DEMOTION -> BEST PRE-QUALIFIED RESERVE SELECTED -> ACCOUNT ASSIGNMENT CHANGED ATOMICALLY -> OLD STRATEGY CANNOT KEEP FIRING -> NEW STRATEGY STARTS ONLY AFTER ALL REQUIRED GATES -> AUDIT/ROLLBACK/ALERT`

Do not tell the operator "strategy swapping is already solved" until that one-piece path is proven.

This becomes a **P0 NO-CLAUDE AUTONOMY acceptance item**.

## 5. STRATEGY ROTATION CONTRACT — WHAT MUST EXIST BEFORE CLAUDE GOES AWAY

Name the final capability `NO_CLAUDE_STRATEGY_ROTATION` (working contract name; implementation may use existing services).

Required behavior:

1. **Observe:** active strategy health is measured from real posted paper/live evidence, regime behavior, decay metrics, and operational truth.
2. **Do not panic-swap:** warning/review states do not automatically eject a strategy unless the frozen demotion policy says so.
3. **Demote safely:** a confirmed decay/drift failure disables the affected strategy before any replacement can become active.
4. **Reserve pool only:** replacement candidates must already be source-faithful and have passed the required research/robustness/PAPER or approved lifecycle gates. The system must not invent a new live strategy at 3AM.
5. **Rank under current constraints:** reserve selection must respect symbol, regime/context evidence, account/prop rules, risk, freshness, and capacity.
6. **Atomic assignment:** old and new assignments may not overlap in a way that can duplicate orders. A crash/restart during rotation must resolve to one authoritative assignment.
7. **Fail closed:** if no qualified reserve exists, run fewer/no strategies and alert the operator. Never force a weak replacement merely to keep something trading.
8. **Evidence:** every demotion, selection, assignment, refusal, and rollback has a correlation/audit trail.
9. **No Claude dependency:** the entire normal rotation path runs with Claude Code unavailable.

## 6. SAFE ROLE OF THE 3AM LEARNING LOOP AFTER CLAUDE EXPIRES

Use two concepts separately:

### Nightly observation

The 3AM loop can:

- inspect regime;
- inspect leaks/anomalies;
- inspect decay;
- rank health;
- write the nightly report;
- flag a strategy for review/demotion according to frozen policy.

### Strategy evolution

Any autonomous learning/evolution must create a **challenger candidate**, not mutate the live strategy in place.

Safe flow:

`3AM FINDING -> CHALLENGER -> BACKTEST/ROBUSTNESS -> REQUIRED LIFECYCLE GATES -> PAPER/SHADOW IF REQUIRED -> QUALIFIED RESERVE -> ELIGIBLE FOR FUTURE ROTATION`

A nightly agent must never rewrite the strategy that is currently holding the live assignment and silently call it the same version.

## 7. SIMPLE POST-CLAUDE OPERATING MODEL

The desired machine is:

`200 UNIQUE VIDEOS`  
`-> archived evidence`  
`-> compiler`  
`-> automatic candidate backtests`  
`-> reject weak/refused candidates`  
`-> Context Edge + robustness on survivors`  
`-> qualified reserve bench`  
`-> active deployed strategy set`  
`-> daily/nightly decay + regime monitoring`  
`-> keep healthy strategies`  
`-> safely demote confirmed failures`  
`-> rotate only to a pre-qualified reserve`  
`-> continue without Claude Code`

Claude Code is a **builder/repair tool**, not part of this runtime loop.

## 8. WHAT THE NEXT CHATGPT ADVISOR SHOULD DO

The ChatGPT advisor should continue to publish reports/rulings on `external-advisor/gpt-rulings` and independently inspect GitHub evidence before making claims.

While Claude is quota-paused, the GPT advisor should work ahead read-only on:

1. locate the exact current decay evaluator/service and demotion entrypoint;
2. locate strategy assignment authority and determine whether an automatic reserve-selection path already exists;
3. trace candidate-backtest scheduling from a newly ingested library source;
4. trace lifecycle gates from candidate -> qualified reserve;
5. identify the smallest missing join for `NO_CLAUDE_STRATEGY_ROTATION`;
6. do not modify Claude's active AR-1138 extraction/grading files while its local uncommitted state is unknown.

## 9. DEADLINE VERDICT

- Expand source inventory toward 200 unique videos: **YES, in parallel where cheap.**
- Report market-materialized rows separately from unique-video count: **MANDATORY.**
- Make 200/200 fully processed a prerequisite for first money-path candidate: **NO.**
- Keep automatic backtest/lifecycle machinery after Claude expires: **TARGET / MUST BE AUTONOMY-CERTIFIED.**
- Decay monitoring after Claude expires: **SUPPORTED FOUNDATION EXISTS; LIVE EVIDENCE STILL REQUIRED.**
- Automatic safe replacement of a decayed strategy: **P0 GAP UNTIL END-TO-END PROVEN.**
- If no qualified replacement exists: **FAIL CLOSED / ALERT; DO NOT FORCE A SWAP.**
- Claude Code as runtime dependency after subscription expiration: **FORBIDDEN.**

## 10. NEXT ADVISOR WORK

Continue shadow pre-audit now. Specifically map the exact repo path for:

`decay/demotion -> assignment authority -> reserve selection -> atomic swap -> restart reconciliation`

and produce the smallest engineering work order needed to close any missing join, without redirecting AR-1138.