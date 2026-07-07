# F-4 Eligibility Unregistered-Bypass — FROZEN diagnostic artifact (2026-07-07)

**Charter (Fable-5, pre-registered): FACTS ONLY. No fix, no "while I'm in here" hardening. Materiality PARKED as a
judgment item. A 7th-defect-with-live-pass-3-consequences smell = stop-and-park, not stop-and-fix.**

## DISPATCH PATH (code-anchored)
- Gate: `src/engine/context/eligibility_gate.py::evaluate_signal()` (the TAKE/REDUCE/SKIP decision). Wrapper
  `apply_eligibility_gate()` (same file, ~:245) computes playbook/location/structural-stop then calls evaluate_signal.
- Backtest path: `backtester.py` calls `apply_eligibility_gate` (E.3/E.4/E.5 guards; the run_class_backtest sibling
  carries it too per the Defect-5 audit).
- Live path: `paper-signal-service.ts` (grader cited :5554; line shifted). TS mirror of the registry normalization
  lives in `src/server/lib/eligibility-registration.ts` + `playbook-registration.ts`.

## BYPASS POINT (code-anchored)
- `eligibility_gate.py:84-109` — the `ds21` (deep-scan #21) unregistered-strategy branch. If `strategy_name`
  normalized (`.lower().replace("_","")`) is NOT in `playbook_router.ALL_STRATS`, it **returns `action="TAKE"` at
  line 109**, BEFORE the Hard-SKIP checks that begin at line 113.
- **INTENTIONAL, not accidental fail-OPEN:** the comment states it MIRRORS `backtester.py::passthrough_strategy_
  unregistered` for paper/backtest PARITY — if backtest bypasses unregistered, live must too, else live SKIPs every
  signal for names not in the 174-entry ALL_STRATS. (Corrects grader framing "fails OPEN".)

## SKIPPED-CHECK ENUMERATION (what the early TAKE at :109 evades)
The overlay Hard-SKIP checks (lines 58-73, 113+), all AFTER the bypass return, are skipped:
- **Check 0 (line 115, deep-scan #8): structural-stop exceeds per-symbol ceiling** — "Fires BEFORE all other gate
  checks", but it is line 115, AFTER the :109 bypass return → **SKIPPED by the bypass.**
- Kill-zone gate (#4, line 165). Liquidity-sweep gate (#5). 3R / confluence≥4 / bias-confidence (the A+ overlay).
- **What the code comment (line 95-96) CLAIMS still applies via SEPARATE framework/risk gates:** structural-stop
  ceiling, DLL, daily-trade-cap, lunch/PM taper, macro blackout, Stage-2 A+ confluence.

## ★ FLAGGED DISCREPANCY (fact, not verdict)
The comment claims **structural-stop ceiling still applies** (separate framework gate), YET **Check 0 (the in-gate
ceiling check) IS skipped** by the :109 bypass. These are consistent ONLY IF a SEPARATE downstream structural-stop-
ceiling gate exists AND fires for unregistered strategies. **Existence/firing of that separate gate NOT verified
tonight.** If it does not fire, an unregistered strategy skips the ceiling entirely — a real (currently-latent) gap.

## EXPOSURE (measured 2026-07-05, read-only live DB — recorded in the code comment)
- 0 of 120 current strategies are unregistered (ALL_STRATS expanded to 174 entries covering the graduated library).
- 0 are in PAPER+ (all CANDIDATE). → **LATENT safety-net, ZERO active live exposure today.** (Corrects grader's
  "7 archetypes bypass at full size in live paper" — stale/false for current state.)

## PASS-3 PENDING-RUNS IMPACT (fact) — NOT a 7th-defect-with-pass-3-consequences
The bypass is in the Gate-3 backtest path, but Gate 3 is a WITHIN-concept A/B (v2-baseline vs v3-shadow, SAME
strategy_name, SAME registration status) → any shared eligibility treatment (bypass or not) applies IDENTICALLY to
both arms and CANCELS in the revival delta. So it does NOT change the certified 9/9 revival or the 2 regressions.
Per the charter, this is NOT a stop-and-park for pass-3 (no verdict-altering consequence). Recorded, not acted on.

## MATERIALITY — PARKED (judgment, dawn)
(a) Does a separate downstream structural-stop-ceiling gate actually fire for unregistered strategies, or is Check 0
the only ceiling enforcement (making the bypass a real ceiling-skip)? (b) Are the 14 corpus concepts in ALL_STRATS
(did Gate-3 runs route through the bypass — irrelevant to the verdict per above, but relevant to characterizing the
runs)? (c) is the parity rationale sound, or should the FIX be "register all hand-coded archetypes + route archetype
signals through the gate" rather than "bypass to match backtest"? All three are rulings, not facts → dawn.

## GRADER CORRECTION (doer≠grader)
F-4 as written ("unregistered bypass returns TAKE before all 9 hard-SKIP checks; 7 archetypes at full size in live")
is CORRECTED: intentional parity bypass (not fail-OPEN); overlay-only (framework gates claimed-separate, ceiling
discrepancy flagged); 0 current exposure (not 7-at-full-size). BUT the grader corroborates the ds21 carry-forward AND
its re-look surfaced the Check-0-ceiling-vs-comment discrepancy — genuine triage value even where the grade was overstated.

## DISCREPANCY RESOLVED (fact) — the ceiling has TWO enforcement points that DIVERGE for unregistered
Bounded grep of backtester.py + structural_stops.py:
- **Point A — Check 0 (eligibility_gate.py:115): SKIP the trade if structural stop > per-symbol ceiling.** This is
  the §4 semantics ("If structural distance > ceiling → SKIP TRADE, never clamp down"). **BYPASSED for unregistered**
  (the :109 early TAKE returns before it).
- **Point B — backtester.py:430-443 / 984-993 / 1091 / 1380-1385: `max_stop_points=_get_stop_ceiling_for_symbol(sym)`
  + `min(_stop_ceiling, atr×mult)` — caps the EXECUTION stop at the ceiling.** STILL APPLIES regardless of registration.
- **So the code comment ("ceiling still applies") is TRUE for the EXECUTION CAP (Point B); the SKIP-eligibility
  semantics (Point A / Check 0) IS bypassed for unregistered.** Net divergence for an unregistered strategy whose
  structure requires a wider-than-ceiling stop: instead of being SKIPPED (§4), the trade is TAKEN with a ceiling-capped
  stop. NOT "no ceiling at all"; a skip-vs-clamp-and-take behavioral divergence.
- **Interacts with the H5 structural-stop-parity topic** (flag-gated `BACKTEST_STRUCTURAL_STOP_PARITY_ENABLED`,
  default OFF) — clamp-vs-skip is the same axis; not resolved here.
- **MATERIALITY of the skip-vs-clamp divergence = PARKED** (does taking-with-clamped-stop vs skipping change edge/
  survival for unregistered strategies? + is the parity rationale correct or should the fix register-all-archetypes?).
- **Exposure unchanged: 0/120 unregistered, 0 PAPER+ → latent. Pass-3 impact NIL (within-concept A/B cancels).**
**F-4 trace COMPLETE at the fact/judgment boundary. Facts frozen; three rulings queued for dawn.**

## PRECISE SKIP-ENUMERATION (fact) — in-gate BYPASSED vs separate STILL-APPLY (2026-07-07)
Traced the comment's other "still apply" claims (DLL, daily-trade-cap, lunch/PM, macro) the same way as the ceiling:
- **BYPASSED (inside `evaluate_signal`, AFTER the :109 early TAKE):** A+ overlay (kill-zone / liquidity-sweep / 3R /
  confluence≥4 / bias-confidence), **Check 0 structural-stop-ceiling SKIP (:115)**, **in-gate `max_trades_hit` (:204)**,
  **in-gate `daily_loss_used_pct > 0.6` REDUCE (:278)**.
- **STILL APPLY (SEPARATE gates in `paper-signal-service.ts`, not inside evaluate_signal → fire regardless of
  registration):** `evaluateDailyTradeCap` (:42), `evaluateCrossSymbolDll` (:76), `evaluateLunchBlackoutGate` (:43),
  `calendarBlocked` macro-blackout (:2300+), + backtester execution-cap ceiling (Point B).
- **So the comment "DLL / daily-trade-cap / lunch / macro still apply" is TRUE for the separate live-pipeline gates,
  but the IN-GATE DLL-reduce + max-trades checks ARE bypassed (imprecise-but-directionally-correct comment).**
- **NET for a LIVE unregistered strategy:** loses the A+ quality overlay + ceiling-SKIP semantics + in-gate DLL-reduce/
  max-trades; KEEPS daily-trade-cap, cross-symbol-DLL, lunch, macro-blackout, execution-cap ceiling. **Partial
  filtering loss (quality/A+ + ceiling-skip), NOT "zero eligibility filtering."** (Corrects grader's "zero eligibility
  filtering at full size" — the separate loss/compliance gates remain.)
- **Backtest-side separate gates (does the backtester run its own DLL/max-trades outside apply_eligibility_gate) NOT
  traced — a factual follow-up.** Exposure still 0/120 unregistered, 0 PAPER+. Pass-3 impact still NIL (A/B cancels).
**F-4 skip-enumeration now PRECISE. The grader's "all 9 / zero filtering" is corrected to a specific partial-loss set.**

## BACKTEST-SIDE SEPARATE GATES CONFIRMED — F-4 net severity collapses (fact, 2026-07-07)
Backtester has its OWN separate enforcement outside `apply_eligibility_gate`: `_apply_max_trades_per_day`
(backtester.py:2751) + `apply_dll_halt` (DLL circuit breaker at the entry-signal layer, per :952-953). So the
comment's "DLL / max-trades still run in BOTH backtest + live" is CONFIRMED on both sides.
- **KEY CONSEQUENCE:** the in-gate `max_trades_hit`(:204) + `daily_loss-reduce`(:278) that the bypass skips are
  DUPLICATES of the separate gates that still fire. So max-trades and DLL are **NOT actually lost** for unregistered —
  the separate gates catch them. Only the redundant in-gate copy is skipped.
- **DEFINITIVE NET — what an unregistered strategy GENUINELY loses (no separate gate covers it):**
  1. The **A+ quality overlay** (kill-zone / liquidity-sweep / 3R / confluence≥4 / bias-confidence) — the eligibility
     gate's UNIQUE function; no separate gate → GENUINELY LOST.
  2. The **structural-stop-ceiling SKIP semantics** (Check 0) — execution-cap ceiling still bounds the stop, but the
     §4 "skip the trade if structure needs a wider-than-ceiling stop" behavior is lost (taken-with-clamped-stop instead).
  Everything else (max-trades, DLL, lunch, macro-blackout, execution-cap) STILL APPLIES via separate gates.
- **F-4 CRITICAL → precisely characterized:** NOT "zero eligibility filtering / bypasses all 9 checks." It is a
  NARROW, LATENT (0/120 unregistered, 0 PAPER+), 0-exposure loss of {A+ quality overlay + ceiling-SKIP semantics} for
  any future unregistered strategy — with all loss/compliance gates intact. Pass-3 impact NIL (A/B cancels). Materiality
  of the two genuine losses = PARKED. This is the doer≠grader endpoint: a claimed CRITICAL, traced to a narrow latent gap.

## F-4 THREE PREDICATES — RUN + CONDITIONAL RULING RESOLVED (2026-07-07)
- **(i) registry coverage — PASS.** Measured 0/120 unregistered, all in the 174-entry ALL_STRATS (code-comment,
  2026-07-05 read-only live DB).
- **(ii) separate REDUCE twin — PASS (Catch 1 = FALSE ALARM, caught by verifying).** `evaluateCrossSymbolDll`
  (cross-symbol-pnl.ts:328-357) emits `action="reduce_size"` at the 60% band via the escalation ladder
  `force_close(95%) > halt(67%) > reduce_size(60%) > none` + `reduceSizeFactor` (default 0.50). The glide-path de-risk
  IS separately enforced → an unregistered strategy does NOT lose it. NOTE: an initial empty-grep nearly mis-concluded
  "no twin"; the definitive read (return-type + ladder) settled it. Verify-don't-conclude-from-empty-grep held.
- **(iii) ceiling equivalence — PARTIAL FAIL (Catch 2 SUBSTANTIATED).** Ceiling VALUES equivalent (structural_stops.py
  INSTRUMENT_STOP_CONFIG 14/62/1.0 == backtester `_get_stop_ceiling_for_symbol` 14/62/1.0). But ACTIONS DIVERGE: bypassed
  Check-0 = SKIP ("SKIP TRADE, never clamp", structural_stops.py:108); retained backtester = CLAMP (max_stop_points).
  The bypassed SKIP is STRICTER → the retained clamp is NOT a substitute. Skip-semantics is genuinely lost for
  unregistered (risk bounded by clamp, but wide-structure trades TAKEN not SKIPPED — an edge-quality gap, risk-bounded).

## CONDITIONAL RULING RESOLUTION
Per the pre-issued ruling ("any predicate fails → ruling voids, F-4 promotes"): (i)+(ii) PASS; (iii) does NOT cleanly
confirm. So the clean LOW/latent ruling does NOT finalize tonight — F-4's skip-semantics loss (bounded, risk-clamped,
0 current exposure) is a CONFIRMED gap flagged for the morning F-4 materiality finalization. **The can-still-fail leg
HOLDS** (per the licensor's intent) — F-4 is not rubber-stamped LOW; it carries one substantiated open item (iii).

## DUPLICATE-ENFORCEMENT — upgraded to NAMED ARCHITECTURAL LIABILITY (the night's real finding)
The predicate run confirms the pattern at FOUR in-gate/separate-path twin sites, not two:
1. max-trades: in-gate `:204` ↔ separate `_apply_max_trades_per_day` (backtester) / `evaluateDailyTradeCap` (live).
2. DLL: in-gate `:278` (reduce) ↔ separate `evaluateCrossSymbolDll` / `apply_dll_halt`.
3. REDUCE glide: in-gate `:278` ↔ separate `evaluateCrossSymbolDll` reduce_size(60%).
4. structural-stop ceiling: in-gate Check-0 SKIP ↔ separate backtester clamp (VALUE-same, ACTION-divergent — the ONE
   that is NOT a faithful twin).
**One instance is a bug; four is a house style** — the same in-gate-copy-shadowing-separate-service architecture that
grew the six run_backtest/run_class_backtest defects. FREEZE as: "duplicate-enforcement is a named architectural
liability (≥4 confirmed sites); cure class known (single-source enforcement + parity guards); register next to the
sibling run_class_backtest refactor on the POST-CERT track." Site 4 (ceiling skip-vs-clamp) is where the divergence
already bites — the canary for the class.

## ITEM 4 — DUPLICATE-ENFORCEMENT PATTERN SURVEY (census, feeds post-cert refactor track — 2026-07-07)
Two axes of the duplicate-enforcement / duplicate-logic house style:

### Axis 1 — eligibility_gate in-gate check ↔ separate-path gate
- **CONFIRMED twins (3 distinct):** max-trades (in-gate `:204` ↔ separate `evaluateDailyTradeCap`(live) +
  `_apply_max_trades_per_day`(backtest)); DLL/reduce (in-gate `:278` ↔ separate `evaluateCrossSymbolDll`
  reduce_size/halt/force + `apply_dll_halt`); structural-stop ceiling (in-gate Check-0 SKIP ↔ separate backtester
  clamp — the ACTION-DIVERGENT one, the canary).
- **POSSIBLE twins (related-not-identical — verify during refactor):** confluence (in-gate A+ overlay `≥4` ↔ separate
  `evaluateWeightedConfluence` 11-factor Path C — two different confluence models gating the same signal); kill-zone
  (in-gate Check-4 ↔ `killzone.ts` `killzone_active` weighted factor); liquidity-sweep (in-gate Check-5 ↔ delta/
  structural weighted factors).
- **SINGLE-SOURCE (clean):** macro-blackout (`calendarBlocked`), lunch/PM (`evaluateLunchBlackoutGate`) — separate-only,
  NO in-gate copy; `checkRiskGate` / `evaluateContextGate` / `checkAntiSetupGate` / consistency-gate — no in-gate twin.

### Axis 2 — run_backtest ↔ run_class_backtest (the six-defect sibling)
The SAME duplicate-logic liability, already the documented source of Defects 1/4/5/6 (the class-path sibling missing
guards/roll-cost/precision the run_backtest path had). Not re-surveyed (known); named here so both axes sit under ONE
architectural liability.

### CENSUS VERDICT (fact, no fix)
Duplicate-enforcement is a confirmed pervasive HOUSE STYLE: Axis 1 = 3 confirmed + 3 possible in-gate/separate twins;
Axis 2 = the run_backtest/run_class_backtest fork (≥6 historical defects). Cure class known (single-source enforcement
+ parity guards). **Registered as a named architectural liability on the POST-CERT refactor track** alongside the
run_class_backtest sibling refactor. Ceiling skip-vs-clamp (Axis-1) is the one that already bites; it is the canary.
Materiality/prioritization = parked (judgment). Facts only per charter.

## ★★ AXIS-2 SURVEY — CANDIDATE 7TH/8TH DEFECTS (STOP-AND-PARK fired, 2026-07-07)
Proactive `run_backtest` vs `run_class_backtest` enforcement-parity survey (the corpus uses run_class_backtest).
Method: function-level string census + shared `_apply_backtest_parity_gates` coverage check + direct body grep of the
run_class_backtest span (L6509-7500). Findings (CANDIDATES — coarse census + body grep, NOT full-call-graph-confirmed):
- **partial-fill (`apply_fill_model` / `apply_volume_partial_fills`) — CANDIDATE FULL GAP.** Present in run_backtest,
  absent from run_class body + shared helper + NOT in the eligibility overlay → corpus backtests likely use IDEALIZED
  fills (optimistic edge). Directly contradicts §12 "Backtest partial fill model DEFAULT ON."
- **VIX-margin (`apply_vix_margin_expansion` / `margin_expansion`) — CANDIDATE FULL GAP.** Same absence pattern →
  corpus backtests likely DON'T reduce sizing on high-VIX days (over-sizing). Contradicts §12 "VIX margin expansion ON."
- **macro-blackout (`apply_blackout_mask_to_entries`) — CANDIDATE PARTIAL GAP.** Macro IS in the shared
  `apply_eligibility_gate` overlay (registered strategies covered), but the SEPARATE belt-and-suspenders mask that
  run_backtest has is absent → matters for unregistered / defense-in-depth (interacts with F-4's overlay-bypass:
  an unregistered strategy loses BOTH the overlay macro AND has no separate mask → trades through FOMC/CPI/NFP).
- **cross-symbol-DLL (`apply_cross_symbol_dll_to_entries`) — CANDIDATE.** `_apply_dll_halt_to_entries` is shared (DLL
  covered), but the CROSS-symbol aggregation specifically may differ — verify.
- SHARED (both apply, confirmed present): eligibility, dll_halt, max_trades, dsl_stop/time-stop, trade_management,
  stop_ceiling, RollSpreadCost(string — but Defect-4 showed the equity-loop USAGE still diverges; census is coarse).

**These JOIN the 6 known class-path defects (1/4/5/6) → run_class_backtest systematically under-mirrors run_backtest;
the duplicate-logic liability (Axis-2) is broader than the fixed 6.** Consequence: corpus RE-BASELINE equity metrics
(Mode A/B: Sharpe/DSR/WFE/B14) are likely OPTIMISTIC (idealized fills, no VIX taper). Gate-3 revival/regression verdict
is A/B-cancelled (both arms use run_class_backtest), so tonight's certified 9/9 + FAIL are NOT invalidated.
**STOP-AND-PARK per charter (7th-defect-smell, careful-not-tired verification, pass-3-downstream consequences):**
morning = full-call-graph confirm each candidate (are they applied upstream of run_class_backtest?), then materiality/
fix on the post-cert backtest-core parity refactor track. NOT fixed, NOT tired-verified tonight.
