# GPT EXTERNAL ADVISOR RULING — ALGO-011

**Project:** ALGO — Current MNQ v2.4 discretionary-strategy translation  
**Worker:** Claude Code / accuracy-validator  
**Advisor:** GPT-5.6 Sol  
**Ruling target:** `ALGO-010-BASELINE-REFUTED-2026-08-22.md` + strategy head `5e33fe917850eee80e715fe1a6a0ae703a3f5b52`  
**Strategy branch:** `research/current-mnq-strategy-v2-4-zone-first-candles`  
**PR:** #38 — **DRAFT / DO NOT MERGE**

## VERDICT

**ALGO-010'S CORE REFUTATION IS ACCEPTED. THE OLD 5/14 SESSION-JOINED BASELINE AND THE “NINE FALSE-POSITIVE” FAILURE SHAPE ARE WITHDRAWN AS DECISION EVIDENCE. THE KEY-LEVEL INTERACTION + CANDLE-STORY BREAKTHROUGH REMAINS AUTHORIZED, BUT ITS JUSTIFICATION IS NOW SOURCE-LEVEL WIRING DEFECTS AND FROZEN TRADER SEMANTICS — NOT THE REFUTED SCORECARD.**

Do not revert the ALGO-010 evaluator repairs. Do not resume semantic mutation until the repaired evaluator itself is independently graded and the current exact strategy head is green. After those two evaluator conditions are satisfied, proceed directly into the bounded state-machine breakthrough described below unless the fresh grader identifies another blocking measurement defect.

No clean-edge backtest is authorized yet.

---

## 1. THE BASELINE REFUTATION IS REAL

I independently inspected the old and repaired evaluation path.

### F-1 — ACCEPTED: session decision was consumed as window decision

The old regrade generated all equation-approved decisions through the replay end, then selected `decisions[0]`. There was no lower-bound filter against replay start before selecting that first decision. The repaired version now retains the session-scoped value for consumers that actually want it and separately derives `in_window = [d for d in decisions if entry_time >= replay_start]` for the fidelity scorecard.

That is the correct architectural repair: preserve the old contract, add the missing explicit window contract, and force consumers to choose.

### F-2/F-3/F-4 — ACCEPTED

The repaired scorecard now exposes:

- 14 total frozen windows;
- **6 right-censored trader labels**;
- only **8 uncensored trader decisions**;
- window-joined exact agreement currently **6/8 on the uncensored subset**;
- one true current opposite-direction decision, **2026-04-09**;
- one uncensored bot-only entry against an actual trader `NO_TRADE`, **2026-04-02**;
- the six censored cases are separated and may neither convict nor acquit the bot.

This is materially different from the refuted “nine false-positive cases / zero missed / zero opposite” story. That prior failure shape is no longer an admissible basis for ordering strategy repairs.

### F-7 — ACCEPTED

The prior force receipt was wrong. `one_minute_entry` is downstream entry/fill timing, not the semantic force proof. The candidate kernel uses `force_snapshot(...).confirmed` before a route can become actionable. The next scorecard must carry the actual force snapshot/receipt at the exact causal decision clock so the claim can independently go red.

---

## 2. F-5 IS PARTLY REFUTED BY THE REPOSITORY — DO NOT DELETE THE USER'S ONE-TRADE RULE

ALGO-010 says the “bullet mechanism does not exist.” That statement is too broad.

I verified three separate production/runtime facts at `5e33fe917850...`:

1. `current_mnq_strategy_v2_4_engine._analysis_run_day()` returns immediately after the first candidate that passes entry and target classification. Historical execution therefore emits at most one fully approved trade for the session.
2. `current_mnq_strategy_v2_4_signal.find_first_actionable_signal()` returns the first fully approved actionable signal.
3. `current_mnq_strategy_v2_4_shadow_runtime.ShadowRuntime._session_consumed()` explicitly checks prior decision events and `step()` returns `DAILY_BULLET_ALREADY_RESOLVED` once a session has been consumed.

So the user's **one A+ trade / one daily bullet** rule is real in execution behavior. The actual defect is narrower and more important:

> **the one-trade/session invariant is not represented as one shared explicit semantic primitive across kernel, replay evaluator, historical engine, signal path, and shadow runtime.**

The diagnostic X-ray is allowed to enumerate later hypothetical candidates after the production budget would be consumed; that is its job. But no diagnostic may use that enumeration to claim that production “takes both directions” or that the one-trade rule is absent.

### Required repair

Centralize or formally bind a shared session-budget contract so tests can prove:

`MAX_FULLY_APPROVED_EXECUTED_TRADES_PER_SESSION = 1`

across historical, replay, signal, shadow, and eventual live execution.

Keep an explicit diagnostic override such as `enumerate_all_candidates=True` for X-ray/research only. The override must never alter production behavior and must be visibly tagged `DIAGNOSTIC_ONLY`.

Do not add a new trading rule here. This is parity hardening of an already-existing trader rule.

---

## 3. THE CENSORED-WAIT RULING

The six `TRADER_ENDED_PRESENTED_REPLAY_STILL_WAITING` cases are **right-censored**. They are not `NO_TRADE`, not confirmed `WAIT` through the session, and not evidence that a bot entry was wrong.

Ruling:

- keep all six frozen exactly as they are;
- request **no new manual replay**;
- do not relabel them;
- do not use them in the numerator or denominator of action-agreement promotion metrics;
- do preserve the bot's observed in-window behavior as diagnostic information;
- do not select a rule because it suppresses or creates entries on those six cases.

The canonical fidelity score must therefore report two surfaces separately:

**DECIDED ORACLE:** the 8 uncensored cases, where agreement/disagreement is scoreable.  
**CENSORED OBSERVATION:** the 6 cases, descriptive only.

A combined `6/14` may remain for historical continuity only if clearly labeled non-promotional because six denominators do not contain a final trader decision.

---

## 4. APRIL 9 IS NOW STOP-THE-LINE FIDELITY EVIDENCE

The repaired window join exposes a real same-window conflict on 2026-04-09:

- trader: `ENTER_LONG` at 11:35;
- bot: `ENTER_SHORT` first in-window at 11:27, with another short also in-window.

This is no longer allowed to hide behind a much earlier session candidate.

Treat April 9 as the highest-severity currently scoreable fidelity defect because it is an actual opposite-direction decision on an uncensored trader-entry case.

However, **do not patch April 9 directly.** The state-machine work below must explain why the bot's short route was legally granted and kill it only if the frozen semantics say that route was incomplete/invalid. The repair must survive every other frozen case and mutation tests.

---

## 5. THE BREAKTHROUGH STILL STANDS — BUT FOR A BETTER REASON

ALGO-009's original queue reorder relied too heavily on the now-refuted nine-mismatch shape. That justification is withdrawn.

The breakthrough itself remains warranted because the repository contains independently verifiable architectural fidelity defects that exist regardless of any score:

### A. The candlestick brain is richer than the production entry wiring

`current_mnq_strategy_v2_4_candles.py` contains a structured zone/candle decision model with interaction states including:

- `NONE`
- `TOUCH`
- `SWEEP_RECLAIM_UP`
- `SWEEP_RECLAIM_DOWN`
- `BREAK_CLOSE_UP`
- `BREAK_CLOSE_DOWN`

It also recognizes the trader's candlestick/control families and exposes `ZoneCandleDecision` / `evaluate_at_zone()`.

But the reachable v2.4 production entry module imports only `classify_patterns`; the shared candidate kernel calls the hand-built `reversal_story_v24`, breakout functions, and force functions. The richer zone-interaction decision limb is not the load-bearing entry authority.

This is a wiring defect relative to the trader's explicit rule:

> **price must genuinely reject or genuinely break the authorized key level before normal entry authority exists; candle sequence then tells the story; sustained force pulls the trigger.**

### B. Rejection authorization is too self-attested

At the current head, `_valid_rejection_side()` accepts a candle after it reaches the zone if its close is merely on an acceptable side of one zone boundary. Then `reversal_story_v24()` can construct the story and returns `approach=True` and `takeover=True` as constants rather than independently proven states.

Those states must become evidence-derived. A raw touch cannot be silently promoted to “rejection.”

### C. Repeat-test exception remains under-specified

The user's frozen rule allows only two pre-break exceptions:

1. genuine displacement drive toward the key level, third-candle sustained force;
2. genuine prior reject/test → reset away → return/retest → breakout attack → sustained force.

The current repeat-test path proves a previous hit and a later non-hit before a new momentum attack, but does not yet prove a semantically meaningful reject/reset/retest lifecycle at the level.

This is sufficient source-level evidence to justify the state-machine repair without using PnL or gaming the 8 scoreable labels.

---

## 6. REQUIRED STATE-MACHINE BREAKTHROUGH

Implement one causal **Key-Level Interaction + Candle-Story state machine** shared by historical/replay/signal/shadow formation.

The only legal entry routes are:

### ROUTE A — NORMAL REJECTION

`AUTHORIZED_LOCATION -> REAL_LEVEL_INTERACTION -> GENUINE_REJECTION/CONTROL_STORY -> SUSTAINED_FORCE -> ENTRY`

A mere zone touch is insufficient. The evidence packet must identify what made the response a rejection/control-transfer story: sweep/reclaim, wick rejection, doji/inside/compression followed by control, shrinking approach then reverse control, two-momentum control sequence, or another already-frozen trader family.

### ROUTE B — NORMAL BREAKOUT

`AUTHORIZED_LOCATION -> COMPLETED_FIRST_BREAK_PRINT -> NEXT_FORMING_5M_EXTENDS_BREAKOUT_EXTREME -> SUSTAINED_FORCE -> ENTRY`

First break print remains setup only.

### ROUTE C — PRE-BREAK EXCEPTION 1: DISPLACEMENT

`AUTHORIZED_LOCATION -> GENUINE_DISPLACEMENT_DRIVE_TOWARD_LEVEL -> THIRD_CANDLE_LIVE_FORCE -> ENTRY`

Ordinary strong/momentum candle is not automatically displacement.

### ROUTE D — PRE-BREAK EXCEPTION 2: REJECT/RETEST BREAKOUT ATTACK

`AUTHORIZED_LOCATION -> REAL_PRIOR_TEST/REJECTION -> RESET_AWAY -> RETURN/RETEST -> BREAKOUT_ATTACK -> SUSTAINED_FORCE -> ENTRY`

No arbitrary first approach, no `touch -> one non-touch -> return` shortcut.

**THERE IS NO FIFTH PRE-BREAK ROUTE.**

Force is terminal confirmation. Force may never rescue an invalid location, raw touch, incomplete candle story, or illegal pre-break route.

---

## 7. DO NOT BLINDLY MAKE `evaluate_at_zone()` THE NEW ORACLE

The current `evaluate_at_zone()` is useful infrastructure, but its existing semantics are not automatically trader-certified merely because the function exists.

For example, it can treat `TOUCH` plus a bullish/bearish control classification as a confirmed reversal. That may still be too permissive for the trader's meaning of a genuine rejection.

Therefore:

- reuse its geometry, interaction taxonomy, and candlestick evidence where correct;
- extend/refactor it into the shared interaction state machine;
- do **not** simply replace `reversal_story_v24()` with `evaluate_at_zone()` and declare fidelity solved;
- every load-bearing transition must map to frozen trader evidence and get a convicting positive + negative test.

This is an integration/reasoning job, not a function-call wiring patch.

---

## 8. X-RAY IS APPROVED AS A DIAGNOSTIC, BUT ITS “315” MUST BE DE-DUPED BEFORE INTERPRETATION

The X-ray correctly records every route/location at every 1m decision clock and deliberately ignores the execution budget so later candidates remain visible.

Its current census reports **315 `SURVIVED_TO_RANKING` observations** across the 14 sessions. Do not call those 315 unique trade opportunities or compare them directly to 7 trader trades.

The X-ray code evaluates the same route/location repeatedly at successive decision clocks, so one persistent setup can create multiple surviving observations.

Add an **episode-level de-duplication layer** for diagnostics only. Group a candidate episode by at least:

`session + direction + legal_route + location_id + continuous interaction/story episode`

and record:

- episode start/end;
- first causal permission clock;
- last permission clock;
- number of repeated decision-clock observations;
- whether it would be executable under first-valid-one-trade semantics;
- earliest gate that killed it if never permitted.

Report both raw observation density and deduplicated opportunity/episode density. Only the latter can support a statement such as “the authorization layer is too permissive.”

Do not tune semantics to reduce a raw observation count.

---

## 9. EVALUATOR CLOSURE BEFORE SEMANTIC MUTATION

Before changing strategy semantics, close this evaluator packet:

1. Let all exact-head workflows at `5e33fe917850...` finish. At my latest read, Zone+Candle Production Gates, v2.3 Production Gates, and Metric Snapshot are SUCCESS; CI, Replay Lab, 5m Fidelity Calibration, and Development Diagnostic are still IN PROGRESS. Do not call this exact head green yet.
2. Dispatch an independent DISPROVE grade against the **repaired** scorecard/runner, not the refuted `9e6d37b...` artifact.
3. Add actual `force_snapshot` receipts at the exact decision clocks and red-proof them.
4. Correct F-5 documentation/tests so they say the execution budget is **distributed/implicit and must be unified**, not nonexistent.
5. Keep the repaired session-vs-window dual contract and censoring tests load-bearing.

If the fresh grader finds another blocking evaluator defect, stop and report it before semantics. If it does not, proceed directly to §10 without another GPT round-trip.

---

## 10. BREAKTHROUGH EXECUTION METHOD — A/B THE SEMANTIC MODEL, NOT THE SCORE

Once §9 closes, implement the state machine through bounded competing hypotheses.

For each source-level weakness, create minimal candidate interpretations from frozen evidence. Examples:

- raw touch vs sweep/reclaim vs explicit control-transfer requirement for rejection;
- reset-away represented by proven departure from the interaction band vs mere non-touch;
- candlestick family contributes as context/control evidence vs automatically authorizing the route;
- approach/takeover derived from sequence state rather than constants.

Evaluate each interpretation against:

- immutable trader gold fixtures;
- the 8 uncensored frozen cases;
- the 6 censored cases descriptively only;
- mutation/negative tests;
- causal/no-lookahead invariants;
- historical/live/shadow parity.

**Selection criterion is semantic fidelity and contradiction minimization, never PnL.**

Do not search arbitrary thresholds until the frozen semantics require a quantity. If a magnitude is genuinely required but not identified by frozen evidence, fail closed or use an already-frozen geometry primitive; do not sweep parameters to maximize 6/8 or any PnL statistic.

---

## 11. REQUIRED REGRESSIONS / MUTATION KILLS

The repaired architecture must go red if any of these defects are planted:

- pattern away from authorized level creates entry authority;
- raw touch is relabeled as genuine rejection without required response/control proof;
- `approach=True` or `takeover=True` is hard-coded instead of derived;
- force alone converts incomplete story into entry;
- first breakout candle auto-enters;
- post-break continuation fails to extend the first breakout candle's directional extreme;
- arbitrary first-approach pre-break momentum enters;
- retest exception omits real prior test/rejection;
- retest exception omits reset away;
- retest exception omits return breakout attack;
- ordinary momentum is accepted as genuine displacement;
- third displacement candle loses control but entry remains authorized;
- final 5m OHLC backdates an earlier decision;
- second production trade is emitted in one session;
- diagnostic X-ray enumeration changes production first-trade behavior;
- censored WAIT is scored as `NO_TRADE`/decline;
- session-first decision is consumed as replay-window decision;
- force receipt can remain green after `force.confirmed` is falsified.

Keep mutation tests concept-focused. Do not encode the 14 case IDs as special behavior.

---

## 12. REGRADE / PROMOTION CONTRACT AFTER BREAKTHROUGH

After the semantic repair reaches an exact green head:

Run the frozen corpus again with the corrected evaluator and publish:

### A. 8 UN-CENSORED CASES — PROMOTIONAL FIDELITY

Per case:

- trader action;
- bot action;
- direction;
- exact causal decision clock;
- legal route A/B/C/D;
- interaction state and evidence;
- candlestick sequence evidence;
- force snapshot/receipt;
- location;
- TP destination/room result;
- mismatch class.

Headline at minimum:

- exact action agreement `/8`;
- entered-vs-not `/8`;
- opposite-direction count;
- missed trader entries;
- bot-only entries against actual declines;
- timing deltas.

### B. 6 CENSORED CASES — NON-PROMOTIONAL DIAGNOSTIC

Report bot behavior and route receipts only. No agreement score and no inferred trader decline.

### C. SESSION EXECUTION PARITY

Prove the one-trade-per-session invariant across historical, replay-production mode, signal, shadow, and eventual live paths. X-ray may enumerate all candidate episodes only under its explicit diagnostic mode.

Then dispatch an independent DISPROVE grader again.

Do not move to FREEZE merely because the numerical score improves. The grader must verify the shared causal architecture and evidence receipts.

---

## 13. WHAT IS NOT AUTHORIZED

Still prohibited:

- clean 2019–2021 PnL peek;
- PnL-selected thresholds;
- winner/loser-selected entry semantics;
- Monte Carlo / walk-forward / robustness before fidelity freeze and clean-edge result;
- adding PDH/PDL/PWH/PWL;
- adding a third pre-break exception;
- weakening the frozen 17.25-point stop;
- asking the trader for new manual replay;
- relabeling the six censored cases;
- case-ID patches;
- suppressing valid earlier candidates only because they hurt a score;
- calling current CI green while workflows remain in progress;
- merging PR #38.

---

## 14. NEXT WORKER REPORT

Next worker report should be **ALGO-012** and must include:

- exact strategy SHA;
- exact-head workflow conclusions;
- fresh independent grade of the repaired evaluator;
- whether any additional evaluator defect was found;
- explicit force-receipt implementation/proof;
- shared one-trade/session parity audit and any centralization change;
- state-machine transition matrix with routes A/B/C/D and no fifth route;
- proof that candlestick/zone interaction knowledge is now load-bearing rather than decorative;
- before/after X-ray **raw observations and deduplicated candidate episodes**;
- April 9 root-cause/resolution without a case-specific patch;
- `/8` uncensored fidelity score plus separate six-case censored diagnostic;
- mutation kill results;
- runtime/latency;
- explicit no-PnL/no-clean-data statement;
- confirmation PR #38 remains DRAFT / DO NOT MERGE.

If the repaired-evaluator independent grader fails before semantic work begins, publish that failure instead of hiding it and do not mutate semantics until it is understood.

---

## FINAL RULING

**ALGO-010 did its job: it stopped us from engineering against a broken measuring instrument. Accept that stop. The old 5/14 narrative is dead.**

But the grader does **not** erase the fidelity breakthrough. The repo independently proves the more important problem: the trader's rich zone/candlestick knowledge is not yet the single load-bearing entry authority, rejection contains self-attested states, and the second pre-break exception is not yet modeled with the full reject/reset/retest/breakout lifecycle.

Therefore the path is:

`REPAIR/REGRADE THE MEASURING INSTRUMENT -> PROVE SHARED ONE-TRADE + FORCE RECEIPTS -> BUILD THE FOUR-ROUTE KEY-LEVEL/CANDLE STATE MACHINE -> RE-RUN 8 DECIDED + OBSERVE 6 CENSORED -> INDEPENDENT DISPROVE GRADE -> FIDELITY FREEZE IF EVIDENCE EARNS IT`

**PR #38 REMAINS DRAFT / DO NOT MERGE. NO CLEAN BACKTEST YET.**
