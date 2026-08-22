# GPT EXTERNAL ADVISOR RULING — ALGO-009

**Project:** ALGO — Current MNQ v2.4 discretionary-strategy translation  
**Worker:** Claude Code / accuracy-validator  
**Advisor:** GPT-5.6 Sol  
**Ruling target:** canonical 14-case rerun at strategy SHA `9e6d37b3ea8832823da16372b2be5e3c9c12f962` + direct trader clarification received 2026-08-21  
**Strategy branch:** `research/current-mnq-strategy-v2-4-zone-first-candles`  
**PR:** #38 — **DRAFT / DO NOT MERGE**

## VERDICT

**FIDELITY BREAKTHROUGH MODE IS AUTHORIZED. THE PRIMARY DEFECT QUEUE IS REORDERED FROM TARGET/LIFECYCLE FIRST TO ENTRY-AUTHORIZATION INTELLIGENCE FIRST.**

The fresh 14-case rerun is not a broad “bot cannot find the trader” failure. It is a **one-sided false-positive authorization failure**:

- exact action agreement: **5/14**;
- entered-vs-not agreement: **7/14**;
- missed trader entries: **0**;
- opposite direction at the trader decision: **0**;
- mismatch census: **5 BOT_ONLY_ENTRY_BEFORE_WINDOW + 2 BOT_ONLY_ENTRY_IN_WINDOW + 2 EARLIER_OPPOSITE_ENTRY_CONSUMED_BULLET**;
- the nine mismatches are **6 REV/rejection-family entries and 3 BRK5 pre-break repeat-test entries**.

The trader has now directly clarified the governing law again:

> **Normal entry authority comes only after price either genuinely REJECTS the authorized key level or genuinely BREAKS the authorized key level. If entry occurs before the normal completed-break path, there are ONLY TWO exceptions: (1) a genuine strong displacement drive toward the key level, or (2) a real reject/test → reset → retest/return → breakout attack at the key level.**

Candlestick knowledge and trader-taught candle sequences are not decorative metadata. They are part of the entry-permission proof.

This ruling therefore authorizes a **shared Key-Level Interaction + Candle-Story state-machine breakthrough**, not nine case patches and not a threshold search.

ALGO-008 remains reserved for the currently running independent grader report. Do not interrupt or mutate its baseline inputs. Once the grader lands, integrate its findings into this packet. If it materially refutes the measured failure shape or finds a blocking instrumentation defect, report that before semantic mutation. Otherwise proceed directly; no additional advisor round-trip is required merely to begin the breakthrough implementation.

---

## 1. VERIFIED CURRENT STATE

PR #38 remains OPEN, DRAFT, unmerged, head:

`9e6d37b3ea8832823da16372b2be5e3c9c12f962`

All seven currently returned exact-head PR workflows are **SUCCESS**:

- CI;
- v2.3 Production Gates;
- v2.4 Zone + Candle Production Gates;
- v2.4 Human-Bot Replay Lab;
- v2.4 5m Fidelity Calibration;
- v2.4 Development Diagnostic;
- Metric Snapshot Regression.

The rerun commit added only the canonical scorecard and runner; it did not mutate strategy semantics.

The canonical scorecard itself reports `cases_affected_by_earlier_same_session_bullet = 7`. The rerun commit prose says “9 of 14.” **The artifact/per-case rows support 7, not 9.** Repair the prose/instrumentation inconsistency; do not let the incorrect 9/14 bullet count steer architecture.

The runner also introduced `EARLY_ENTRY_SECONDS = 15 * 60` to classify an opposite-side bot event as an earlier bullet event rather than an opposite decision. That may remain a **diagnostic grouping rule only**. It is not a trader strategy threshold and may not enter production signal semantics.

---

## 2. WHY THE CURRENT ARCHITECTURE IS TOO PERMISSIVE

### 2.1 The candlestick brain exists

`current_mnq_strategy_v2_4_candles.py` already contains substantial deterministic candle knowledge, including:

- doji / long-legged doji / dragonfly / gravestone;
- spinning top;
- hammer / bullish pin rejection / shooting-star / bearish pin rejection;
- engulfing;
- inside bar / inside body / harami;
- outside bar;
- piercing line / dark cloud;
- tweezers;
- morning/evening star families;
- three-white-soldiers / three-black-crows;
- three-inside / three-outside families;
- compression / expansion;
- explicit zone-interaction states including `TOUCH`, `SWEEP_RECLAIM_UP`, `SWEEP_RECLAIM_DOWN`, `BREAK_CLOSE_UP`, `BREAK_CLOSE_DOWN`;
- `evaluate_at_zone()` designed to interpret candle evidence only after a zone interaction.

### 2.2 But the live entry gate uses only a thin slice

The production/shared kernel currently calls `reversal_story_v24()` for REV entries. That function imports `classify_patterns()` but implements its own looser interaction/rejection approximation rather than making the full zone-interaction/candle decision state the load-bearing entry gate.

Specific risk points verified in code:

- `_valid_rejection_side()` can qualify an event because price reaches the zone and closes on an acceptable side; that is not by itself proof of the trader’s visible “reject/push away/control transfer” semantics;
- `reversal_story_v24()` later emits `approach=True` and `takeover=True` rather than independently proving those states from the sequence;
- a later momentum/force candle can therefore convert a weak interaction into a REV candidate too easily.

This is consistent with the rerun’s **six false REV-family entries**.

### 2.3 The repeat-test pre-break exception is also under-specified

`repeat_test_momentum_prebreak()` currently proves roughly:

`earlier reach/test + at least one later non-hit/reset bar + current momentum return that reaches the zone`.

That is insufficient as a faithful representation of the trader’s clarified exception. The legal exception is not “touch → leave → come back strong.” It must represent a **real first reject/test, meaningful reset, retest/return, then breakout attack with sustained force**.

This is consistent with the rerun’s **three false BRK5 `PREBREAK_REPEAT_TEST_INTRA5_FORCE` entries**.

---

## 3. NEW LOAD-BEARING ENTRY ARCHITECTURE

Build one shared causal state machine for historical, replay, shadow, and eventual live execution:

`AUTHORIZED_LOCATION → APPROACH → KEY_LEVEL_INTERACTION → PRICE_RESPONSE/STORY → FORCE → ENTRY`

There are only **four legal terminal entry routes**.

### ROUTE A — NORMAL REJECTION

`AUTHORIZED SR/FVG → REAL INTERACTION → GENUINE REJECTION/CONTROL STORY → DIRECTIONAL 5M MOMENTUM → SUSTAINED CAUSAL FORCE → ENTER`

A touch alone is never rejection authority.

The state must distinguish at minimum:

- touch only;
- sweep/reclaim;
- wick rejection;
- doji/indecision at the level;
- pin/rejection candle;
- inside/compression sequence;
- shrinking approach into level;
- failed push/reclaim;
- two-momentum-candle control sequence;
- directional control transfer;
- invalid/no-response interaction.

Pattern names are evidence, not automatic triggers. The sequence must prove the trader’s story.

### ROUTE B — NORMAL BREAKOUT

`AUTHORIZED SR/FVG → ACTUAL FIRST BREAK PRINT/CLOSE → SETUP ONLY → NEXT FORMING 5M EXTENDS THE FIRST BREAK CANDLE DIRECTIONAL EXTREME → SUSTAINED FORCE → ENTER`

Preserve the already-taught safety rule:

- LONG: second forming 5m must trade above first breakout candle HIGH;
- SHORT: second forming 5m must trade below first breakout candle LOW.

If the first break is weak, the already-authorized 15m three-bar continuation family remains separate.

### ROUTE C — PRE-BREAK EXCEPTION #1: TRUE DISPLACEMENT DRIVE

Only:

`GENUINE DISPLACEMENT DRIVE TOWARD AUTHORIZED KEY LEVEL → THIRD CANDLE IS TIMING CANDLE → SUSTAINED LIVE FORCE → ENTER BEFORE NORMAL BREAK CONFIRMATION`

Do not collapse ordinary strong/momentum candles into displacement. At least one load-bearing displacement proof must remain range-expanding under the frozen semantic definition. If the third candle loses control, no entry.

### ROUTE D — PRE-BREAK EXCEPTION #2: REJECT/TEST → RESET → RETEST → BREAKOUT ATTACK

Only:

`REAL INITIAL KEY-LEVEL TEST/REJECTION → MEANINGFUL RESET AWAY → RETURN/RETEST → BREAKOUT ATTACK DEVELOPS → SUSTAINED LIVE FORCE → EARLY ENTRY AUTHORITY`

This route must not be satisfied by arbitrary first approach, adjacent candles sitting on the level, or “one bar no longer touched it.” Prove the actual lifecycle/sequence from causal price action.

**NO FIFTH ROUTE.**

If a candidate cannot identify one of these four paths with a complete receipt, result = `WAIT`.

---

## 4. X-RAY MODE — REQUIRED BEFORE THRESHOLD OR SEMANTIC TUNING

Implement a diagnostic-only **candidate X-ray mode** that records every potential candidate through the session before the one-trade bullet hides later reasoning.

This does **not** change production’s one-trade/session rule. It is an observability layer only.

For every candidate decision clock, emit a structured transcript at minimum:

- session / causal timestamp;
- authorized location ID/source/side;
- location active state;
- approach evidence;
- exact zone interaction type;
- candle patterns detected;
- sequence role/state;
- rejection evidence and why it passed/failed;
- break evidence and why it passed/failed;
- displacement-exception evidence and why it passed/failed;
- reject/retest-breakout-exception evidence and why it passed/failed;
- force snapshot and completed-1m observations used;
- target/room gate only after entry authority exists;
- final state: `ENTER_LONG`, `ENTER_SHORT`, or `WAIT`;
- earliest semantic gate that killed a rejected candidate.

Use this to compare the nine false-positive cases against the five current AGREE cases and all seven trader-entry cases.

The purpose is to answer:

> **What shared permission is the machine granting that the trader’s brain does not grant?**

Do not use the X-ray to invent case IDs, date-specific if-statements, or hidden suppression lists.

---

## 5. HYPOTHESIS / COUNTERFACTUAL PROGRAM

Before editing production semantics, create a bounded fidelity hypothesis table. Each hypothesis must be derived from existing trader evidence/direct clarification, not from PnL.

Test shared hypotheses such as:

- H1: mere reach/acceptable-side close is being misclassified as rejection;
- H2: approach/takeover are self-attested rather than measured;
- H3: candle classifier knowledge is not wired into the load-bearing interaction gate;
- H4: repeat-test reset is too weak and does not prove a real lifecycle reset;
- H5: repeat return is not proving breakout-attack behavior;
- H6: force is being allowed to upgrade an invalid story instead of merely triggering a valid story;
- H7: location authorization is stale/overbroad for a subset of false candidates;
- H8: candidate ranking is choosing an invalid higher-ranked route when a valid state should remain WAIT.

Run each candidate semantic interpretation across **all 14 cases**, not only the case that motivated it.

Selection criteria are fidelity-only:

- preserve all trader entry opportunities;
- remove false positives for the correct semantic reason;
- preserve direction;
- preserve causal timing behavior;
- avoid new misses;
- no new case-specific exception;
- no PnL/result selection.

A hypothesis that improves `14-case score` only by hiding earlier candidates without explaining why they are invalid is rejected.

---

## 6. CANDLE KNOWLEDGE MUST BECOME LOAD-BEARING, NOT DECORATIVE

Do not solve this by requiring one named candlestick pattern everywhere. The trader explicitly trades **stories/sequences**, not textbook names alone.

Refactor so the candlestick subsystem contributes structured evidence to the state machine:

`interaction_type + pattern_evidence + sequence_evidence + control_state + compression/shrinking_state + momentum_state + breakout_state`

The state machine decides whether the evidence is sufficient for one of the four legal routes.

Examples that must remain expressible:

- two momentum candles after a key-level rejection/control transition;
- doji → momentum;
- pinbar/rejection → momentum;
- inside bar → momentum;
- shrinking candles into the level → rejection → reverse momentum;
- normal first break → next-candle continuation/extreme extension;
- weak break → 15m three-bar continuation;
- the two and only two pre-break exceptions.

Do not let `momentum=True` or `force=True` rescue a missing key-level interaction/story.

---

## 7. MUTATION / RED-PROOF CAMPAIGN

The breakthrough is not accepted until planted defects are killed. At minimum, tests must go red if we:

1. turn a plain touch into a valid rejection;
2. hard-code `approach=True` without measured approach evidence;
3. hard-code `takeover=True` without control-transfer evidence;
4. allow force alone to authorize a trade;
5. allow a named candle pattern away from the key level to authorize a trade;
6. allow the first completed breakout candle to enter automatically;
7. remove second-5m extreme extension from normal breakout;
8. allow ordinary momentum to satisfy displacement exception #1;
9. allow displacement third candle after it loses directional control;
10. satisfy exception #2 without a real prior test/rejection;
11. satisfy exception #2 without a meaningful reset;
12. satisfy exception #2 without a true retest/return breakout attack;
13. create a third pre-break exception;
14. use final parent-5m OHLC to backdate an earlier entry;
15. consume the daily bullet on a candidate that the state machine classifies WAIT.

After each mutation campaign, restore bytes exactly and prove pristine tests green.

---

## 8. DEFECT QUEUE IS REORDERED

ALGO-007’s inherited post-baseline order is superseded by the new measurement and direct trader clarification.

New order:

**A. ENTRY-AUTHORIZATION BREAKTHROUGH**  
Key-level interaction + candle story + only-two-prebreak-exceptions state machine. This is the primary cluster because all nine current mismatches are false/early entries and zero trader entries were missed.

**B. EARLIER-SESSION ONE-BULLET HAZARDS**  
Regrade after A. Many may disappear naturally when invalid early candidates become WAIT. Do not separately suppress them before A proves why they were invalid.

**C. DECISION-TIME TARGET MAP**  
Only after the entry gate is correct. Target structure cannot be allowed to distract from a candidate that never deserved entry authority. Repair remaining TP/room mismatches after A/B.

**D. LOCATION / LIFECYCLE RESIDUALS**  
Mar31 is currently an AGREE case (`ENTER_LONG` vs `ENTER_LONG`, -2m), so the old Mar31 reclaim item is no longer the first breakthrough target. Reopen lifecycle only if X-ray/validator evidence shows a remaining shared defect.

**E. WAIT/NO_TRADE + LATENCY/OBSERVABILITY**  
Preserve causal distinction and optimize runtime after semantic correctness.

---

## 9. INDEPENDENT GRADER / ALGO-008

Let the currently running independent grader complete against the untouched canonical baseline.

ALGO-008 is reserved for that report.

The grader must specifically challenge:

- recompute 5/14 and mismatch census from per-case rows;
- resolve `7 earlier bullet` artifact vs `9` commit-prose contradiction;
- verify `0 missed trader entries` is real and not a mapper artifact;
- verify the two earlier opposite-side entries are causally separate earlier events;
- treat the 15-minute diagnostic grouping threshold as non-semantic;
- independently inspect whether the six REV + three pre-break BRK5 mismatch clustering is accurate;
- check whether `force_receipt` being only implied by entry existence is adequate for diagnosis or must be upgraded to an explicit force receipt before semantic repair;
- challenge any claim that the current candlestick corpus is already fully wired into production authorization.

If ALGO-008 finds a material measurement error, repair the instrument first. If it validates the failure shape, execute this breakthrough packet directly.

---

## 10. SUCCESS CONDITIONS FOR THE BREAKTHROUGH

Do **not** define success merely as “make it 14/14.”

The breakthrough is eligible for acceptance when:

1. every trader entry is represented by one of the four legal routes;
2. every removed false entry dies at a specific trader-supported semantic gate;
3. no date/case-specific branch exists;
4. no new trader-entry miss is introduced;
5. opposite-direction-at-decision remains zero unless evidence proves otherwise;
6. candlestick/interaction knowledge is actually load-bearing;
7. the two pre-break exceptions are explicit and exclusive;
8. force triggers a valid story but cannot create one;
9. historical/replay/shadow/live all call the same shared state machine;
10. mutation tests kill semantic shortcuts;
11. exact-head CI is green;
12. independent validator reruns the repaired 14-case set under a DISPROVE mandate;
13. no PnL, clean-edge result, realized outcome, or winner/loser label selected the repair.

A 14/14 result is welcome only if it emerges from those laws. A lower score may still reveal a real remaining fidelity defect; do not game it.

---

## 11. HARD RAILS — UNCHANGED

- **PR #38 remains DRAFT / DO NOT MERGE.**
- **No clean 2019–2021 edge peek.**
- **No 2015–2026 performance search to tune fidelity.**
- **No PnL-selected threshold or rescue.**
- **No Monte Carlo / robustness / prop survival before FIDELITY → FREEZE → CLEAN EDGE.**
- **No PDH/PDL/PWH/PWL strategy inputs.**
- **No final-parent OHLC backdating.**
- **No new manual replay or trader relabeling request.**
- **No third pre-break exception.**
- **Do not weaken the frozen 17.25-point stop semantics.**
- **Do not let target logic authorize an otherwise invalid entry.**

The existing video provenance / long-video bounded-census obligations still block final `FIDELITY → FREEZE` if they remain unresolved; they do not justify delaying this entry-authorization breakthrough.

---

## 12. NEXT EXECUTION REPORT

After ALGO-008 lands and this packet is executed, the next worker execution report is **ALGO-010**.

ALGO-010 must include:

- exact strategy SHA and all exact-head workflow conclusions;
- ALGO-008 grader verdict and any measurement corrections;
- X-ray candidate census across all 14 sessions;
- false-candidate cluster by legal-route failure point;
- explicit proof of the four-route state machine;
- before/after counts for REV, normal breakout, displacement exception, retest-breakout exception, WAIT;
- all counterfactual hypotheses tested and rejected/accepted with fidelity-only reasoning;
- mutation kill matrix;
- repaired 14-case scorecard plus independent-validator result;
- timing deltas and runtime;
- explicit statement that no PnL/outcome/clean-edge information selected the repair;
- remaining blockers to `FIDELITY → FREEZE`.

**Engineering objective:** do not teach the bot more ways to trade. Teach it to understand when the trader’s existing key-level/candlestick story has actually earned permission to trade — and to say WAIT everywhere else.
