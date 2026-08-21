# GPT EXTERNAL ADVISOR RULING — ALGO-002

**Project:** ALGO — Current MNQ v2.4 discretionary-strategy translation  
**Worker:** Claude Code  
**Advisor:** GPT  
**Ruling target:** ALGO-001 seat handover  
**Strategy branch:** `research/current-mnq-strategy-v2-4-zone-first-candles`  
**PR:** #38 — **DRAFT / DO NOT MERGE**

## VERDICT

**CHANNEL SEPARATION: APPROVED AND LOCKED.**

Use exactly:

- branch: `external-advisor/gpt-rulings-algo`
- folder: `algo-reports/`
- numbering: `ALGO-NNN`

Do **not** publish ALGO material to `external-advisor/gpt-rulings`, do **not** use `advisor-reports/`, and do **not** consume an `AR-NNNN` identifier.

The separation is not cosmetic. I independently verified `scripts/publish_algo_report.sh` enforces the separate branch/directory/numbering scheme and that the current PR head includes that mechanism. The measured collision with the main Trading Forge control-plane authority is sufficient reason to keep this a physically separate reporting lane.

**PHASE-0 CLOSEOUT: NOT YET AUTHORIZED.**

At my inspection, PR #38 is still OPEN + DRAFT at exact head:

`811894aa808a594748f830f9e9b4345ce2dda473`

Verified exact-head workflow state at ruling time:

- `Current MNQ Strategy v2.4 Zone + Candle Production Gates` — **SUCCESS**
- `Current MNQ Strategy v2.3 Production Gates` — **SUCCESS**
- `Metric Snapshot Regression` — **SUCCESS**
- `Current MNQ Strategy v2.4 Human-Bot Replay Lab` — **IN PROGRESS**
- `Current MNQ Strategy v2.4 5m Fidelity Calibration` — **IN PROGRESS**
- `Current MNQ Strategy v2.4 Development Diagnostic` — **IN PROGRESS**
- `CI` — **IN PROGRESS**

Therefore no report may yet say “all exact-head gates green.”

## 1. RULING ON THE TWO RED-GATE REPAIRS

### Gate 1 — previous-close / prior-map test retirement

**APPROVED. DO NOT REVERT.**

I independently inspected `eedebc75638066d4742c20dafe82d496083eeef5` and the retirement commit `60878ce35cc99ef41eded723a424261bdd9a55d3`.

The old test required `_range_room_authorization` to reconstruct previous-close context. That is incompatible with the current strategy boundary, which intentionally routes the v2.4 premarket prior through empty prior-day/prior-week/previous-close maps. Re-implementing the retired behavior would reintroduce a forbidden input.

The replacement test is materially better than deletion: it asserts the empty maps, asserts `prev_maps` is never called, and has a positive witness proving the premarket path actually ran. The exact-head Zone + Candle workflow is now green.

### Gate 2 — replay calibration/status rename

**TECHNICAL FIX APPROVED; CI VERDICT STILL PENDING.**

I independently inspected `e5dca546c5a9da6b0c15f81ab26b96eca8006e7e`, `fe13464f54f44906c85ad03d68f9a8c9921310bc`, the current generator constants, and `tests/test_current_mnq_strategy_v2_4_replay_lab_gate_binding.py`.

The generator now intentionally names the artifact `AUTOMATED_FIDELITY_REGRESSION_*`, which is the correct meaning after manual replay collection was closed. Reverting the generator to `TRADER_FIDELITY_CALIBRATION_*` would be semantically wrong. The workflow should follow the generator, not vice versa.

The binding test is a legitimate improvement because it removes the duplicated status literal from the generator use sites and binds the workflow expectation to module constants.

However, the Human-Bot Replay workflow was still inside the long calibration-pack generation step when I checked. **Do not promote this from “fix is correct” to “gate is green” until GitHub reports SUCCESS at the exact current head.**

## 2. RULING ON THE NEW CI-GATE CLASS GUARD

**ACCEPT FOR CURRENT COVERAGE; DO NOT OVERCLAIM IT AS A COMPLETE PARSER.**

`tests/test_current_mnq_strategy_v2_4_ci_gate_spec_binding.py` is useful and correctly catches the currently observed `==` string-literal and `in` membership drift classes. It includes non-vacuity and a planted mismatch control.

But it is still regex-based and only recognizes specific embedded-Python assertion shapes. A future assertion using double quotes, another comparison form, or a different expression shape can sit outside its parser.

So:

- keep it;
- call it a guard for the **currently enumerated gate assertion syntaxes**, not “all possible gate literals”;
- before `FIDELITY -> FREEZE`, either extract the inline gate contract into importable Python/shared data or replace the regex claim with an AST/structured parser that fails closed on unsupported assertion syntax.

This is **not** a reason to delay the first fidelity regrade.

## 3. PRIORITY ORDER — EVIDENCE CUSTODY FIRST, THEN THE 14-CASE BASELINE

ALGO-001 proposed running the 14-case regrade first. I am changing the order slightly.

### NEXT PACKET: close the cheap custody gaps first

Do these as one bounded evidence-closure packet **before publishing a new canonical fidelity score**:

1. **Re-seal the frozen 14-case labels to the surviving local bytes.**
   - Preserve `11d8dec0...` as the historical dead-sandbox identity; do not silently overwrite history.
   - Add the surviving local SHA (`1b20b0a8...` as measured by the worker) with an explicit provenance bridge.
   - Prove the same 14 manifest case IDs and the expected action census are present.
   - No new trader labeling.

2. **Register the 13 new 2026-08-21 screenshots.**
   - Per-file name + SHA256 + custody path/source.
   - Bind only roles actually supported by the operator's stated context or visible evidence.
   - Do not invent unique semantics for every frame merely because a screenshot exists.

3. **Commit the 74-row trade-ledger reconciliation receipt.**
   - Bind CSV SHA256, row count, date range, symbol, side counts, and the eight screenshot-ledger reconciliation.
   - Prove MNQ point-value arithmetic independently.
   - Separate target-side exits, exact 17.25-point stops, scratches/other exits honestly.
   - The ledger remains a **TP/exit fidelity diagnostic only**; it may never select a strategy rule or threshold.

4. **Fingerprint the evidence-closure artifacts.**
   - Unified registry/build contract must include the new authoritative receipts/manifests.
   - Add a regression proving the referenced evidence identities are the identities the scorecard consumes.

Reason for this order: the next 14-case score is supposed to replace the dead-session/RELAYED baseline with reproducible truth. The oracle identity must therefore be reproducible **before** that score is promoted to canonical evidence.

## 4. IMMEDIATELY AFTER CUSTODY: RE-ESTABLISH THE 14-CASE FIDELITY BASELINE

After the custody packet is green, run the frozen 14 cases on the exact strategy head **before another strategy-semantic repair**.

Commit a per-case scorecard containing at minimum:

- trader state: WAIT / LONG / SHORT / NO_TRADE;
- bot state;
- exact causal decision clock;
- direction;
- selected S/R or FVG interaction geometry;
- story/entry-family receipt;
- force receipt;
- first meaningful TP destination and reason;
- whether a prior bot signal consumed the one-session bullet;
- mismatch class.

No realized PnL, winner/loser outcome, or later-session information may participate in the decision comparison.

The previously relayed `6/14`, `0 opposite-direction`, `0 in-window bot-only`, and `~24 blockers` are **not current truth until reproduced on the present head**.

## 5. DEFECT ORDER AFTER THE NEW BASELINE

Unless the new scorecard disproves the dependency, use this order:

### A. Decision-time target map

First repair candidate because it is a shared causal mechanism already implicated in Mar 30, Mar 31, and Apr 6.

The target map must answer: **what meaningful reaction structure existed at the actual decision clock?** It may not freeze the destination map at session open if later causal structure changes which reaction is first.

Red-proof against stale-open-map behavior and future-parent leakage. Preserve replay/live parity and benchmark latency.

### B. Mar 31 reclaim lifecycle

Then test the known reclaim failure: one close-through must not blindly retire an otherwise valid immediate reclaim setup if the trader's existing evidence says the level is still the active interaction.

Do **not** create a third pre-break exception. Express the reclaim through the existing location lifecycle / approved entry families.

### C. Six pre-window signals / one-bullet hazards

Do not delete or suppress them to improve the score.

Classify each from existing evidence using the operator's known WAIT predicates and current rules. A pre-window entry is a real defect only when the bot's earlier setup violates the strategy evidence; the fact that it consumed the bullet before a labeled case is not, by itself, proof that it was wrong.

No new manual replay collection.

## 6. THE 3H53M48S VIDEO

**DO NOT BLOCK THE FIRST 14-CASE BASELINE ON IT. DO NOT ALLOW FIDELITY TO FREEZE WITH IT UNRESOLVED.**

I independently verified the registry currently marks `Desktop 2026.08.15 - 17.13.57.01.mp4` as:

- 14,027.6 seconds;
- ~841,700 frames estimated;
- only 9 frames read;
- ~0.001% frame coverage;
- `UNENUMERATED`;
- not citable for a specific rule.

That is honest, but it leaves the largest video surface outside the semantic audit.

Run it as a **separate evidence packet**, preferably after/parallel with the first baseline so it does not stop the main diagnostic loop. The goal is not 841k-frame brute force. Use a bounded temporal census: stratified time sampling + scene/layout transitions + timeframe changes + order/position/PnL state changes + every candidate trade segment, with explicit coverage accounting and counter-sampling. Gradual price evolution must not be treated as covered merely because scene-change detection found no cut.

Before `FIDELITY -> FREEZE`, one of two states is required:

1. `ENUMERATED_WITH_BOUNDED_METHOD` and any discovered rule evidence is reconciled against the existing contract; or
2. `CUSTODY_ONLY_UNENUMERATED_NO_SEMANTIC_AUTHORITY`, explicitly excluded from rule derivation.

Given the operator's instruction that all supplied screenshots/videos/replays come together, **preferred outcome is (1)**.

## 7. THREE 2026-08-20 SEALED VIDEO ROLES WITHOUT RECORDED METHOD

ALGO-001 is correct to flag this.

Before FREEZE, each load-bearing role must either:

- point to an already-existing trader clarification/gold fixture that supplies its provenance; or
- receive a bounded re-derivation record; or
- be downgraded so the unproven role itself is not load-bearing.

Do not reopen manual replay collection and do not ask the trader to repeat explanations already captured elsewhere.

## 8. HARD PROHIBITIONS REMAIN

- No clean-data PnL peeking during fidelity repair.
- No threshold/parameter rescue chosen from the 14 labels' profitability.
- No Monte Carlo/robustness work before FIDELITY -> FREEZE -> CLEAN_EDGE.
- No use of PDH/PDL/PWH/PWL as strategy inputs.
- No final 5m OHLC used to backdate an earlier forming-candle entry.
- No new manual replay-label collection.
- PR #38 remains DRAFT / DO NOT MERGE.

## 9. DEFINITION OF THE NEXT REPORT

The next worker report is **ALGO-003**.

It should report, from repository evidence rather than prose memory:

1. exact current strategy SHA;
2. exact-head workflow conclusions;
3. evidence-custody closure results and hashes;
4. whether the 14-case baseline was rerun;
5. if rerun, the full per-case mismatch census and aggregate action score;
6. any evidence that changes the ordered defect queue;
7. latency/runtime for the regrade;
8. explicit statement that no PnL/outcome information selected a fidelity repair.

**RULING: APPROVE THE ALGO CHANNEL. CLOSE CUSTODY. RE-ESTABLISH THE FROZEN BASELINE. THEN REPAIR SHARED SEMANTIC CAUSES ONE AT A TIME. DO NOT SKIP DIRECTLY TO ROBUSTNESS OR EDGE.**
