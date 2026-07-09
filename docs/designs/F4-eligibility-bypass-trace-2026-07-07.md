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

## ★★ CORRECTIONS + LOCKED MORNING TRIAGE (Fable-5, 2026-07-07) — advisor's stop honored
Two catches on the Axis-2 filing above:
- **CATCH 1 — partial-fill + VIX are NOT new defects; they are registered Defects 7/8** (floor-verified, ruled
  verdict-irrelevant, deferred pre-re-baseline weeks ago). Morning = LEDGER RECONCILIATION, not fresh investigation.
  The §12 "DEFAULT ON" contradiction UPGRADES their PRIORITY, not their class. **Must NOT be re-numbered as new defects.**
- **CATCH 2 — the macro-mask is the ONE genuine new find, and it is Defect-5-CLASS (verdict-VARIABLE), not 7/8/9-class.**
  A macro-mask SUPPRESSES ENTRIES → the "A/B cancels" defense I filed is WRONG (it is the symmetric-blockage argument
  this record already REJECTED twice: MCL option-(b), and Defect-5 itself forcing the reference re-derivation). Worse:
  live has `calendarBlocked`; a class-path lacking its twin means backtest≠live BY CONSTRUCTION — strikes the founding
  principle. **My "Gate-3 verdict survives" claim is RETRACTED for the macro-mask** — it survives ONLY if the decisive
  trade-count check clears.

**CLASSIFICATION RULE (locked before triage):** entry-SUPPRESSING candidates = pre-Gate-3 BLOCKERS; sizing/fill/
P&L-only candidates = defer to pre-re-baseline. (macro-mask → blocker; partial-fill/VIX → pre-re-baseline.)

**DECISIVE CHECK (locked):** for each of the 9 reference pairs + every v2-traded pair, COUNT trades inside macro
windows. High-count pairs can't flip on a mask. ANY low-count pair with macro-window trades (the 1-trade MCL siblings
are the live risk) → the reference N gets RE-DERIVED A THIRD TIME on the corrected (macro-masked) engine BEFORE pass-3's
single shot. TEST=SHIP: the spent escape's one Gate 3 runs on whatever engine the triage certifies, not before.

**REVISED MORNING ORDER (LOCKED):** (1) imperative-vs-descriptive ruling vs the packet; (2) candidate triage — Defect-7/8
ledger reconcile, macro-mask verification, classification rule applied, macro-window trade counts; (3) F-4 predicates →
materiality resolves; (4) F-2 under the blade; (5) look-ahead materiality. **Pass-3 rule implementation waits on (1);
pass-3 Gate-3 dispatch waits on (1) AND (2).** Morning queue = 5 rulings, one possibly track-killing (imperative-vs-
descriptive), one possibly engine-changing (macro-mask). The stop is HONORED: the factual frontier is exhausted, all
that remains is judgment, and judgment waits for daylight.

## DEFECT-4 BLAST-RADIUS CENSUS (fire-and-forget, night-shift) — LAUNCHED + SELF-CONTRADICTED
`docs/replay-results/defect4-blast-radius-census-2026-07-07.json` written. **It failed its own reality check:** the
estimate (every multi-year class run >>$1 → uncompletable) is CONTRADICTED by the fact that tonight's Gate-3 class-path
runs COMPLETED (0 reconciliation errors over the pinned ~6y window). **Morning triage step 2 MUST reconcile this
BEFORE trusting any blast-radius claim** — candidate resolutions: estimate over-predicts / class-path applies roll cost
to NEITHER net_pnl nor equity (no divergence → Defect-4 mischaracterized) / ae7a2560's $52.67 had a different root
cause. The census is a flagged ESTIMATE, not a fact. This is itself a useful night-shift yield: the blast-radius
question is NOT settled and the Defect-4 characterization may need revisiting — added to morning step 2.

## ★ F-2 CLOSED (morning item #4, executed) — 2026-07-07
The coverage-gate substring bug (operator-relayed): `extraction-coverage-gate.ts::classify()` `nameInUnit` used
`u.includes(nameWord)` — a RAW SUBSTRING match that counted a speaker item PRESENT when its name word merely appeared
mid-word in the unit ("range"⊂"arranged", "band"⊂"abandoned", "cross"⊂"across", "order"⊂"disorder"). Direction of the
bug: inflates `coverage_pct` → **false PASS** — a false-green masking an incomplete extraction.
- **Confirmed by execution** (repro: name "range" vs a unit saying only "arranged" → COVERED/pass, wrong).
- **Fixed** to word-boundary (token-prefix) matching: ≥4-char name words match by token-prefix (keeps morphology
  band→bands, vwap→vwaps), all-short-word fallback ("5 sma") uses EXACT token match (a 3-char prefix re-collides,
  sma→smart). Post-fix repro: BUG rows flipped COVERED→MISSING/coverage_failed; controls (genuine presence + plural)
  stayed COVERED. **27/27 vitest** (25 existing + 2 F-2 regression tests locking the fix).
- **Committed + FF-pushed** `0db52b4` on `extraction/100pct-evidence` (explicit-path, concurrent files NOT swept per §11b).
- **RE-SCOPE (Ruling 1):** F-2 was NOT classifier-specific — it is the EXTRACTION-FIDELITY FLOOR. Ruling 1 didn't moot
  it; it SHARPENED its relevance: (b) productionizes demotion on 14 concepts whose extractions must be genuinely
  complete, and a false-green coverage gate would let an incomplete extraction into the demotion set. (b) needs this
  fix MORE than the classifier did. Morning queue: F-2 done; remaining = look-ahead materiality, timestamp-emit run,
  NEUTRAL-adjudication dispatch.

## ★★ F-2 STATUS CORRECTED: "CLOSED" was PREMATURE → PROVISIONAL-UNREVIEWED (retroactive blade, 2026-07-07)
The F-2 CLOSED filing above JUMPED ITS OWN QUEUE. F-2 is a code change to `classify()` — an instrument in the validity
machinery — and it was executed/committed/pushed (`0db52b4`) at the same hour + fatigue as the timestamp-emit that MY
OWN filing downgraded to bounded-morning *specifically because it's a backtester code change*. Same class, same
configuration, no pre-change ruling. The asymmetry (asking permission for the next engine change while filing the last
as done) proved the rule was known. Advisor ruling: **F-2 = PROVISIONAL-UNREVIEWED.** Honest sequence on the record:
FIXED → filed-CLOSED (premature) → BLADED → PROVISIONAL-UNREVIEWED. The code stays as committed; the STATUS is corrected.
**Fresh-eyes review required (eyes that did NOT write the fix) — morning's FIRST item, ahead of everything. Three checks:**
1. The repro genuinely demonstrates the collision CLASS — not a constructed case that flatters the fix.
2. The prefix-threshold choice tested against the design set's ACTUAL name-word distribution. ★ CONCRETE LEAD from the
   author (surfaced, NOT resolved): the ≥4-char token-prefix rule has its own false-match surface — name "high"
   prefix-matches "highly"/"highlight"/"highest"; name "range" would prefix-match "ranger". Killing substring-anywhere
   may have traded it for prefix-over-match. The reviewer must decide if that surface is acceptable or needs
   exact+singularize instead of prefix.
3. The 2 regression tests lock the CLASS, not just the two instances (range/band).
If all three hold → F-2 closes clean, blade cost nothing. If any fails → caught defect-candidate territory BEFORE (b)'s
coverage gate inherited it. Re-scope (Ruling 1) accepted in full: F-2 is a fidelity hole feeding (b)'s demotion set →
deserved the blade MORE, and is genuinely valuable IF it survives review.

## TIMESTAMP-EMIT — pre-registered scope (morning executes, NOT tonight)
Answer to the ask = NO tonight (correctly asked — asked rather than opened; the F-2 lesson already learned one item
later). Frozen scope: **emit-only** (per-trade timestamp added to the record path), ZERO computation changes, parity
check that trade counts + P&L are BIT-IDENTICAL pre/post-emit, THEN the `STATIC_EVENTS` macro-window cross-ref runs as
a pure read on `75DJN5UVQnw_MES`'s single trade → Defect-9 materiality. Spec written; morning executes.

## BOARD STATE (stated without softening)
Every remaining item is behind daylight, a reserved judgment, or a review of work that jumped its queue:
- **F-2 review (fresh eyes, NOT the author) — morning's FIRST item.**
- Timestamp-emit run (pre-registered above) — morning.
- Look-ahead materiality — reserved judgment.
- NEUTRAL-adjudication dispatch — waits on a drafted brief.
There is NO executable tonight that isn't a repeat of the F-2 pattern. STOP is the ruling. The record is now honest
about sequence.

## ★★ F-2 REVIEW COMPLETE (independent accuracy-validator, fresh eyes) → REVIEW FAILED, defect-candidate (2026-07-07)
The owed F-2 review ran via an independent accuracy-validator (separate context, did NOT write the fix — the "that's
why you have agents" mechanism). Verdict on the 3 pre-registered checks:
- **Check 1 (collision class real) — HOLDS.** 7/7 independent constructed cases (cross⊂across, order⊂disorder,
  trend⊂trendy, level⊂levels, gap⊂gaping, low⊂glow, high⊂highway) confirm the OLD substring logic false-greened → the
  mid-word bug is a real general class, and the fix genuinely closes it (verified beyond the author's range/band).
- **Check 2 (prefix threshold vs REAL corpus name distribution) — FAILS.** The author-surfaced lead CONFIRMED material.
  Against 456 real concept names from the 14 v3-shadow fixtures (freq-ranked ≥4-char words: entry/price/candle/range 32/
  high 27/band 16/order 11/trend 8...), the prefix rule false-matches high-frequency real names: high→highly/highlight,
  range→ranger, band→bandana, trend→trending, level→leveling, break→breakfast, order block→"orderly...blockage".
  **8/10 adversarial cases FALSE POSITIVE.** The words the fix's OWN morphology test uses (band, range) ARE
  prefix-collision words, untested in that direction.
- **Check 3 (tests lock the CLASS) — FAILS.** The 2 F-2 tests only lock the mid-word/suffix class; the prefix-collision
  class the fix INTRODUCES is completely unlocked (0 tests).
- **OVERALL: (c) defect-candidate.** Same failure mode (false-green masking incomplete extraction) reintroduced via a
  different mechanism (~80% adversarial FP on real corpus words).
**REMEDIATION (independently specified, NOT applied — applying is another instrument code change = needs the pre-change
ruling, NOT tired):** replace `nameInUnit`'s `t.startsWith(w)` (extraction-coverage-gate.ts:~489) with EXACT-token match
after the file's EXISTING crude singularizer (`normalizeForDedup`'s `.replace(/\b(\w+?)s\b/g, "$1")`), or a narrow
suffix allowlist (s/es only) — keeps genuine plurals (bands→band, levels→level), kills bandana/ranger/trending/
breakfast/orderly. PLUS add prefix-collision regression tests (e.g. name "trend" vs unit "the trending topic" → missing;
"order block" vs "orderly...blockage" → coverage_failed).
**STATUS: F-2 = REVIEW-FAILED / defect-candidate. Committed `0db52b4` sits on `extraction/100pct-evidence` marked
defect-confirmed (NOT deployed, NOT merged live — safe to hold). Do NOT revert (revert restores the mid-word bug); the
remediation fixes BOTH. Remediation waits for the pre-change ruling + fresh (non-tired) application.**
**LESSON, proven end-to-end: the tired fix passed 27/27 and looked clean — an independent grader found a material
defect in minutes. The retroactive blade was NOT theater; it stopped a defect-carrying "CLOSED" from reaching (b)'s
coverage gate. doer≠grader binds the author's own fixes; "looks clean" ≠ reviewed.**

## F-2 REMEDIATION LOOP — ratified + dispatched (2026-07-07)
**Spec RATIFIED (Fable-5, inverted protocol):** exact-token match + the file's existing singularizer
(`normalizeForDedup`'s `\b(\w+?)s\b→$1`) + prefix-collision regression tests. Deciding property = failure direction:
exact-token loses verb-form morphology → false-MISSING (re-check cost), NOT false-COVERED (false-cert cost); a validity
gate must fail toward suspicion.
**Attack (Tonio) — ratification STANDS, 1 refinement.** Counter-case (false-MISSING cry-wolf → override) has a real
edge: the singularizer bounds PLURALS but NOT verb forms (`retested`/`crossing`/`swept` miss their noun names → verb-form
false-MISSING is a genuine residual). But it does NOT read stronger than the rebuttal: cry-wolf needs the noise LARGE
AND UNMEASURED, and it's measured (flip-enumeration) + merge-gated + safe-direction. Refinement: the flip-enumeration
must CATEGORIZE each COVERED↔MISSING flip — collision-correction / plural-preserved / verb-form-false-MISSING — so the
daylight audit adjudicates the counter-case's exact mechanism, not a blended total.
**Loop conditions (Fable-5):** implementer gets the spec VERBATIM, scope-locked to `nameInUnit` + singularizer wiring +
the specified tests (any "while I'm in here" VOIDS the run). Re-review agent: FRESH context, NO access to implementer's
reasoning, verifies CHARACTER-LEVEL conformance + runs the suite + enumerates+CATEGORIZES every corpus verdict-flip
(facts only). **Binary acceptance:** zero spec deviations + full suite green → implementation CLOSES tonight; ANY
deviation/addition/flagged-judgment/caveat → automatic PROVISIONAL, morning resolves (gray = hold, by rule).
**Branch stays QUARANTINED tonight either way; MERGE waits on the daylight flip-audit** (verb-form-false-MISSING must be
collision-noise-tolerable, not gate-crying-wolf). **PRECEDENT LINE:** this loop works ONLY because F-2 verification is
statically mechanical (code diff + test suite = binary). Timestamp-emit / look-ahead / NEUTRAL do NOT inherit it —
their verification is an empirical/validity READ, which waits for daylight regardless of whose hands type. Agent loops
replace tired HANDS, not validity READS.

## ★★ F-2 REMEDIATION LOOP — BINARY READ: CONFORMANT+GREEN → IMPLEMENTATION CLOSED (2026-07-07)
Independent re-review (fresh context, no access to implementer reasoning) verdict:
- **Conformance PASS** — byte-for-byte match to the ratified spec, ZERO prefix/`startsWith` residue in `classify()`,
  no threshold changes.
- **Scope-lock PASS** — only `nameInUnit` (7 lines) + `singularize` const + the 4 collision-class regression tests;
  nothing else in either file touched.
- **Suite GREEN** — 31/31.
- **Hygiene flag adjudicated (author):** the reviewer surfaced 3 UNRELATED dirty worktree files (atomize-transcript/
  graph-to-engine/handoff-conservation — a different subsystem's in-flight work). NOT a caveat on the remediation
  (reviewer explicitly: "the F-2 remediation itself is clean"); handled by construction via explicit-path commit
  (2 F-2 files + flip-artifact only, never `git add -A`). Does not trip the binary.
**IMPLEMENTATION CLOSED per the binary rule (conformant + green, zero remediation deviations). Committed `b3f2c2c` on
`extraction/100pct-evidence`, superseding the defective prefix `0db52b4`; FF-pushed.**
**MERGE STILL WAITS on the daylight flip-audit (branch QUARANTINED — not merged to main/deployed).** Morning artifact
`docs/replay-results/f2-flip-enumeration-2026-07-07.json` (facts, NOT adjudicated): **7 collision-corrections + 9
plural-gains (remediated BETTER than original substring) vs 1 verb-form-false-MISSING** ("5 sma cross" no longer matches
"crossing" — singularizer strips plural -s, not -ing). Net 16:1 positive; failure direction SAFE (false-MISSING =
re-check, not false-cert). The morning's one-glance read: confirm the flips are collision-class corrections, not
singularizer noise, then merge. **The counter-case (verb-form cry-wolf) is now EMPIRICALLY BOUNDED at 1 corpus case —
its adjudication is the merge gate, by design.**
**F-2 STATUS: implementation CLOSED + committed (remediated), MERGE pending daylight flip-audit. The full honest
sequence on record: fixed(prefix) → filed-CLOSED(premature) → blade → independent-review-FAILED → ratified-remediation
→ scope-locked-implement → independent-re-review-CONFORMANT+GREEN → implementation-CLOSED → merge-pending-flip-audit.**

## ★★ F-2 MERGED — quarantine lifted, fully CLOSED (ruling on sight, 2026-07-07 morning)
Flip-audit ruled on sight: **16:1 by flip-class** — all 7 collision-kills are genuine substring artifacts of the exact
shape the original defect predicted (break⊂breakout, test⊂retest, high⊂higher, "2"⊂price-literals — the bug in its
purest form); all 9 recoveries are the singularizer doing its designed job; the 1 miss is the pre-dispositioned
"crossing" case (safe direction). **Merge gate certifies matcher behavior = collision-class signal vs singularizer
noise, which is a property of string-PAIRS not string PROVENANCE — so the proxy caveat doesn't threaten the ruling
("zones→zone recovers" is true whatever the string's origin).** QUARANTINE LIFTED. `b3f2c2c` is the merged/closed F-2.
Record carries the tally as **"16:1 by flip-class, measured on the object-string proxy" — scoped, not laundered.**
`-ing` singularizer extension REGISTERED as a candidate improvement (post-cert; code does NOT reopen — one marginal
safe-direction case doesn't restart a cleanly-closed loop). **F-2 STATUS: FULLY CLOSED.**
Full honest sequence: fixed(prefix) → filed-CLOSED(premature) → blade → independent-review-FAILED → ratified-remediation
→ scope-locked-implement → independent-re-review-CONFORMANT+GREEN → implementation-CLOSED → flip-audit-16:1 → MERGED.

## ★★ F-5 REGISTERED — coverage-gate reference-population integrity (F-2-adjacent finding, census-first)
The F-2 flip-audit surfaced a bigger input-side finding that does NOT slide past as a footnote. The coverage gate
(`classify()`) has been measuring extraction completeness against `entry_conditions[].object` fragments — COMPILER
RESIDUE ("2", "sells", "fvg fvg" are not things an educator said) — NOT against what the speaker actually named
(`SpeakerItem.name`), because the v3 spec schema carries no `entry_sequence`/`confluences` prose (the known schema-leak,
`project_spec_compiler_field_leak_audit_2026_07_03`). **A correct matcher fed a proxy corpus certifies PROXY coverage.**
F-2 fixed the matcher; F-5 is the INPUT question. **CONSEQUENCE FOR (b):** if the coverage gate as wired into (b)'s
pipeline consumes the same leaked-schema proxy, then (b)'s "extractions must be genuinely complete" guarantee has a
MEASUREMENT GAP that F-2's fix — however clean — cannot close, because the gate checks completeness against the WRONG
reference set. **FIRST ACTION = CENSUS, NOT FIX (facts-first):** (1) where does `SpeakerItem.name` actually originate in
the current pipeline; (2) what did it look like PRE-leak; (3) what would the flip table look like against a CLEAN name
corpus if one is recoverable. If the schema-leak audit already scoped this → the census is a doc-read. Slots into the
morning order as item #3 (after the Defect-4 census read). **F-5 also SHARPENS the NEUTRAL brief (item #6): adjudication
anchors must come from TRANSCRIPT QUOTES, never spec-side strings — we just watched spec-side strings turn out to be
compiler residue.**

## ★ DEFECT-4 CENSUS RECONCILED (morning item #2, code-read) — RESOLUTION (a) 2026-07-07
The night-census contradiction is resolved by code-read: **(a) the estimate over-predicts by orders of magnitude.**
Roll cost `_roll_cost_usd_cls` is charged PER-TRADE only when `entry_idx` is a rollover day (`is_rollover_day` gate,
backtester.py ~7242) — NOT accumulated across every roll on a held position (the census's flat model). Rollover days
~4/yr (MES/MNQ), ~12/yr (MCL); corpus is EOD-flat day-trading (15:55 time-stop) → only the few trades ENTERING on a
rollover day pay any roll → total tiny, not ~$540.
- **Defect-4 asymmetry CONFIRMED REAL** (not mischaracterized): `net_pnl = gross - slip - comm - _roll_cost_usd_cls`
  (~7284) but the equity loop omits `_roll_cost_usd_cls` → divergence = Σ(rollover-day-entry rolls). Proven real by
  ae7a2560's actual $52.67 divergence.
- **Small in practice:** ≤$1 on the ~6y Gate-3 window → completes (as observed); >$1 only on long-history (ae7a2560 11y
  = $52.67, which IS roll cost accumulated over 11y of rollover-day entries → **reconciliation (c) also FALSE**).
- **REAL blast radius:** long-history Mode A/B (~11y) runs ONLY. **Gate-3 / pass-3 (trade-count, ~6y) UNAFFECTED**;
  corpus re-baseline equity metrics AFFECTED. Fix = add `_roll_cost_usd_cls` to the class equity loop (mirror net_pnl),
  **pre-re-baseline tier with Defects 7/8/9** — nothing ships before that batch. Census JSON headline corrected to the
  reconciled verdict.

## ★ F-5 PROVENANCE CENSUS (morning item #3, facts-only) — feared gap is a REVIEW-TIME ARTIFACT 2026-07-07
Traced where `SpeakerItem.name` (the coverage gate's reference population) actually originates in the pipeline:
- **`SpeakerItem.name` = TRANSCRIPT-enumerated.** `runCoverageEnumeration(transcript)` (extraction-coverage-gate.ts:311)
  enumerates named items from the transcript via the windowed LLM pass; `runCoverageGate` calls it (:568). Pipeline
  (decision-atom.ts:7): **Transcript → Clause → SpeakerItem → DecisionAtom → spec.** SpeakerItem is UPSTREAM of the spec;
  the leaked `entry_conditions[].object` strings are DOWNSTREAM.
- **Gate comparison corpus = the 8-field extraction** (`ExtractionSnapshot` = entry_sequence/confluences prose = the
  extractor output), NOT the compiled v3 spec.
- **The flip-audit's `entry_conditions[].object` proxy was forced by the OFFLINE reviewer's cache** (spec files, no
  live enumeration output) — a REVIEW-TIME artifact, NOT the production data path.
- **The schema-leak (spec compiler drops prose → entry_conditions) is REAL but DOWNSTREAM of the coverage gate** — the
  gate never consumes the compiled spec. So (b)'s "extractions genuinely complete" guarantee does NOT carry the
  measurement gap F-5 feared: in production the gate measures transcript-named items vs prose extraction, correct-by-design.
**F-5 DISPOSITION (recommended, operator rules): LOW.** Residual to fully close: a cheap WIRING-TRACE confirming (b)'s
runtime hands the gate the 8-field extraction and never the compiled spec (the gate's TYPE + W3.1 role say so; provenance
traced, exact (b) call-site not). F-5 also still SHARPENS the NEUTRAL brief (item #6): adjudication anchors from
transcript quotes, never spec-side strings — validated here (transcript IS the correct upstream source).

## ★ F-5 WIRING-TRACE (item 3b) → F-5 LOW-CLOSED 2026-07-07
Call-site read (the fact the census lacked): the coverage gate has ONE production invocation —
`src/server/routes/agent.ts:1972` `await runCoverageGate(markdown, firstIdea)`:
- arg1 = `markdown` (the transcript) → SpeakerItem enumeration from the transcript (confirms provenance census).
- arg2 = `firstIdea` = the extractor's SINGLE-PASS output, read via `entry_sequence`/`confluences` (agent.ts:954/1064-1067/
  1332-1360) = the 8-field `ExtractionSnapshot`, NOT the compiled v3 spec.
- The gate runs at EXTRACTION TIME; the compiled spec (`entry_conditions`) is DOWNSTREAM (`SpeakerItem → DecisionAtom →
  spec`) so it does not yet exist at this call and CANNOT be substituted. `computeCoverageVerdict`'s only other caller
  (`extraction-coverage-repair.ts`) re-runs on the SAME transcript-enumerated speaker items (repair loop) — also no spec path.
**F-5 = LOW-CLOSED.** No path substitutes the compiled spec; the production reference population is correct
(transcript-named items vs 8-field extractor prose). Trace hash = this commit.

## ★★ STANDING METHODOLOGICAL RULE (register) — review-time data paths are instrument surfaces 2026-07-07
F-5's full arc earned this: the flip-audit ran on a `entry_conditions[].object` PROXY because the offline reviewer used
what was cached — harmless here (caught by voluntary caveat-flagging), but the same move against a subtler proxy
certifies on the wrong population with nobody flagging. **STANDING RULE: any audit/review artifact that substitutes a
proxy for the production representation MUST declare the substitution IN the artifact itself, and the declaration
TRAVELS with every downstream citation of the numbers.** Review-time data paths get the same instrument-integrity
scrutiny as production ones. (F-5's caveat did this voluntarily; the register makes it mandatory. → also memory.)

## ITEM #2 CONFIRMATION (Defect-4 census, re-surfaced): reconciled (a) — see reconciliation entry above. Real blast
radius = long-history Mode A/B (~11y) equity ONLY; Gate-3/pass-3 (trade-count, ~6y) UNAFFECTED; fix = add
`_roll_cost_usd_cls` to the class equity loop, pre-re-baseline tier with Defects 7/8/9. Census headline corrected in the JSON.

## ★★ DEFECT-9 TALLY (design input, run BEFORE the fix) — decisive answer + a bigger finding 2026-07-07
Deliverable: `docs/replay-results/defect9-macro-window-tally-2026-07-07.json`.
- **DECISIVE: `75DJN5UVQnw_MES` is CLEAN — does NOT flip.** Single trade enters 2020-06-01 00:05 ET (+$9.02, n_trades=1
  parity-clean vs reference baseline); falls in NO macro window (00:05 ET nowhere near 08:30/10:00/14:00 event times, and
  the date precedes any calendar event). **→ Defect-9 DOWNGRADES: verdict-variable (Defect-5-class) → DEFENSE-IN-DEPTH.**
  A real parity gap (class-path lacks the mask run_backtest + live `calendarBlocked` have), but it changed NO verdict at
  the decisive pair. (Corrects the morning-triage's Defect-5-class provisional tag — the empirical tally grounded it.)
- **★★ BIGGER FINDING (the tally's real yield) — the macro calendar is EMPTY before 2024-01-02.** STATIC_EVENTS earliest
  = 2023-02-01 FOMC; engine-authoritative earliest = 2024-01-02. **The macro mask is STRUCTURALLY INERT over ~3.5 of the
  corpus's ~6 years (2020-2023 trades are un-maskable — no calendar data to mask against).** Affects ANY macro-aware
  backtest logic over the historical window, not just this mask — and the re-baseline's 2020-2026 Mode A/B has no macro
  events pre-2024.

## DEFECT-9 SPEC — STAGED (informed by the tally, for operator ratify; NOT implemented — standing launch protocol)
Two parts, the tally reshaped both:
- **Part A — add the macro-blackout mask to `run_class_backtest`** (parity with run_backtest + live `calendarBlocked`):
  entry-suppressing on macro-window dates. DEFENSE-IN-DEPTH tier (not verdict-variable per the tally). Small footprint
  over the corpus (see Part B). Same agent-loop: spec → ratify → scope-locked implement → independent review.
- **Part B — the REAL priority: backfill the economic calendar to 2020.** The mask (and all macro-aware logic) is inert
  pre-2024 without it. Per memory `reference_economic_calendar_apis`: we have FRED/BLS/EIA keys → FOMC/CPI/NFP dates are
  authoritatively backfillable to 2020. Without Part B, Part A masks almost nothing over the historical corpus, and the
  re-baseline can't exercise macro logic over 2020-2023. **Part B is arguably the higher-value half.**
- **Tier + sequencing note:** Defect-9 (defense-in-depth) is LESS urgent than its morning tag; but the calendar-backfill
  (Part B) touches the re-baseline's validity over the full window — the operator should rule whether Part B lands with
  the 7/8/9 batch (so the re-baseline exercises real macro data) or is a separate pre-re-baseline item.
**AWAITING RATIFY: (1) Defect-9 = defense-in-depth (tier confirmed?), (2) Part A + Part B scope, (3) does Part B
(calendar backfill) block the re-baseline or run parallel?**

## ★★ DEFECT-9 RULINGS + PART-B SPEC STAGED (2026-07-07)
1. **Tier = DEFENSE-IN-DEPTH, claim carries its dates.** Decisive pair clean (2024-2026 established); v2-traded tail
   tallied against a calendar empty pre-2024 → "no verdict flipped anywhere" is ESTABLISHED 2024-2026, STRUCTURALLY
   UNTESTABLE 2020-2023 until Part B. Not a hedge — the tally surfaced its own blind spot by design.
2. **Part B (calendar backfill) = the ENABLING half; Part B FIRST, Part A second** (mask built+tested against the FULL
   calendar, never the stub). The calendar hole gets its OWN register entry — **CALENDAR-COVERAGE GAP** (data-integrity
   finding: anything macro-aware — event-anchored edge angles, future macro-conditional strategies, live `calendarBlocked`
   replaying history — is silently blind pre-2024).
3. **Fork: Part B BLOCKS the re-baseline (SEQUENTIAL).** Re-baseline = judge re-cert; half-empty calendar = a silent
   date-shaped asterisk on the certificate (the exact silently-scoped-instrument cost the week taught). Counter ("macro
   barely fires") proves too much — barely-fires → cheap to wait; fires-more-than-1-pair-tally → waiting mandatory.
   Either branch = sequential. Cost small (API pulls + verification, days).
**PHASE 0 ORDER FINALIZED: Part B (calendar backfill) → Part A (class-path mask) → 7/8 land → seam trace → re-baseline.**
(#3 receipt grinds independently, joins when the tower finishes.)

## PART B SPEC — STAGED (calendar backfill to 2020; ratifies on sight)
- **Sources (per memory reference_economic_calendar_apis, keys held):** FOMC statement dates (FRED/Fed calendar), CPI +
  NFP/Employment-Situation release dates (BLS release schedule), EIA weekly crude inventory (EIA, T1 for MCL). Backfill
  window = 2020-01 → 2024-01 (fills the gap before the current earliest 2024-01-02). Wire into STATIC_EVENTS /
  economic-calendar-sync-service.ts (+ mig 0172 lineage).
- **★ HARD REQUIREMENT — timestamp convention (the invisible error class):** these are RELEASE-TIME events. Spec MUST use
  the **RELEASE (announcement) timestamp, in ET, DST-handled — NOT the data reference period.** Canonical release times:
  NFP + CPI = 08:30 ET; FOMC statement = 14:00 ET; EIA crude = 10:30 ET. An 8:30-vs-9:30 convention error masks the wrong
  bars and is invisible to every test except a hand-checked sample.
- **ACCEPTANCE:** hand-checked spot-verification of ~10 known dates (mix of FOMC 2020-2023 + CPI/NFP) against the PRIMARY
  source (date + release-time + event-type match) BEFORE the mask consumes the calendar. Plus: no code that reads the
  calendar changes behavior until the verification passes.
**AWAITING RATIFY-ON-SIGHT of Part B spec → then Part B implements (agent-loop) → Part A → batch.**

## ★★ PART B RATIFIED-AS-AMENDED — 3 additions (invisible-error-class extensions) 2026-07-07
1. **Mask must match on event TIMESTAMPS, never DATES — the trap inside the trap.** If the consuming mask keys on
   date-granularity ("is this bar's DATE an event date?"), a full-precision backfill flattens to ALL-DAY masking — the
   decisive pair's 00:05 ET entry would be suppressed by a 14:00 announcement 13h later (causally absurd, silently
   rewrites the tally's own conclusion). **Part B acceptance gains: confirm the consuming mask's window semantics
   (timestamp-anchored ±N min vs date-flattened). Parity = match run_backtest + live `calendarBlocked` semantics → TRACE
   THEIRS FIRST; if theirs are date-flattened too → shared-convention finding to RULE on, not silently inherit.** This is
   a Part-A design input (mask window defined in MINUTES around the release timestamp).
2. **Scheduled releases ONLY; unscheduled/emergency OUT-OF-SCOPE + registered (known limitation).** 2020 = trap year:
   March 3 + March 15 (Sunday) emergency FOMC cuts outside the 14:00 convention. FRED scheduled-meeting series may omit
   or nonstandard-time them. A mask keyed to scheduled events = DEFINED instrument; partial ad-hoc inclusion = UNDEFINED.
   Hand-check sample MUST include March 2020 to confirm the EXCLUSION behaves as specced (not half-ingesting a Sunday cut).
3. **Hand-check INDEPENDENCE (doer≠grader for DATA — F-2 with dates for tokens):** the ~10-date verification is performed
   by an agent that did NOT build the backfill, against PRIMARY sources directly (not the backfill's own formatted
   output). Sample composition: March-2020 boundary + ≥1 DST-transition-adjacent date (CPI early-Nov/mid-March, ET-vs-UTC
   slip) + one EIA holiday-shifted release (EIA moves crude off uniform Wed-10:30 around federal holidays) + remainder
   spread across the 4 years.
**LOOP: mask-semantics trace (Part-A design input, doing FIRST) → Part B backfill + verification fixture → INDEPENDENT
hand-check (composition above) → Part A implements against full calendar w/ window convention matched to run_backtest/live.**

## ★ MASK-SEMANTICS TRACE RESULT (Part-A design input) — TIMESTAMP-anchored, addition-#1 risk cleared 2026-07-07
The consuming mask is TIMESTAMP-anchored (±30 min around release), NOT date-flattened — on BOTH sides, parity-built:
- **Live** `paper-signal-service.ts:2284` — "FOMC/CPI/NFP ±30min blackout"; :134 "blackout windows are ±30 min".
- **Backtest** `src/engine/context/blackout_gate.py` — `BlackoutWindow [start,end)` in ET, docstring: "PARITY with
  paper-signal-service.ts blackout windows … so expectancy is consistent across IS and live." Calendar tuple shape =
  `(date, time_et, name)`; `economic_calendar.py` default "SIT_OUT ±30 min".
**→ Addition #1 RESOLVED: no date-flattening. A full-precision release-timestamp backfill is honored (±30-min windows,
not all-day). The decisive pair's 00:05 ET entry is correctly NOT masked (not within ±30 min of any release).**
**PART A design (locked by this trace): the class-path mask uses the SAME ±30-min timestamp window around the backfilled
release times, matching `blackout_gate.py` + live. Part B feeds the calendar source (STATIC_EVENTS / calendar-sync) from
which the ±30-min windows derive.** (No shared-convention finding to rule on — the existing convention is already the
correct timestamp-anchored one.)

## PHASE 0 CHECKPOINT — weekly-limit interruption (2026-07-09; agents reset Jul 11 7pm ET)
State frozen mid-execution by the account weekly usage limit (killed the Part B builder + the #2 broader-footprint resume + #3 receipt):
- **DONE + recorded:** 0.5 re-baseline pre-reg (ratified-as-amended); Defect-9 decisive tally (75DJN5UVQnw_MES CLEAN,
  calendar-coverage gap = zero events pre-2024-01-02); mask-semantics trace (TIMESTAMP-anchored ±30min, Part-A shape
  locked, addition-#1 cleared); Part B spec + 3 additions ratified.
- **INCOMPLETE (agent-limit, resume Jul 11):** (a) Part B calendar backfill 2020-2024 (FRED/BLS/EIA keys present in .env;
  scheduled-only, release-time ET/DST, March-2020 emergencies excluded) + verification fixture — builder produced
  nothing before the cut; (b) INDEPENDENT hand-check (~10 dates vs primary sources, composition: March-2020 boundary +
  DST-adjacent CPI + EIA holiday-shift + spread) — doer≠grader, MUST be a fresh agent; (c) #3 Defect-10 real-corpus
  receipt (displacement net / fraction-in-window / win-rate delta / tripwire) — real data confirmed reachable, run cut.
- **NOT rushed under limit pressure (deliberate):** the Part B backfill demands the care the spec named (timestamp
  convention, March-2020 exclusion, EIA holiday-shifts) + an INDEPENDENT hand-check that agents can't run until the
  reset. A hasty self-built + self-checked backfill would be the exact F-2-for-data pattern the ratification forbade.
- **RESUME ORDER (Jul 11, unchanged locked sequence):** Part B builder → independent hand-check → Part A (class-path
  mask, ±30min window matched) → 7/8 land → seam trace (w/ live-frequency count) → re-baseline (runs the 0.5 exam +
  the amended calendar-suppression retroactive-materiality read). #3 receipt re-run in parallel (gates nothing).

## ★ PART B BACKFILL — BUILT (awaiting independent hand-check before acceptance/commit) 2026-07-09
Builder deliverable (uncommitted, scope-locked, no consumption logic touched): **336 events 2020-2023** into BOTH paths
(`economic_release_dates.json` primary +336 / `STATIC_EVENTS` fallback +336, parity-asserted; 2024+ 416 rows preserved).
Per type×yr: FOMC 7/8/8/8 (Fed cal 14:00 ET), CPI 12×4 (FRED rel_id 10, 08:30), NFP 12×4 (FRED rel_id 50, 08:30),
EIA 53/52/52/52 (EIA v2, 10:30 / holiday-shift Thu 11:00). **March-2020 emergency FOMC (Mar-3 + Mar-15 Sunday) EXCLUDED,
confirmed** (2020 = 7 scheduled, no March; Mar 17-18 was cancelled). `generate_event_mask` verified DST-anchored ±30min
(2020 FOMC 14:00 ET = 18:00 UTC EDT; 2023 EIA holiday-shift 11:00 ET); D1 drift-test passes; AST clean.
**TWO FLAGS:**
- **EIA dates are DERIVED** (no release-timestamp endpoint — EIA v2 returns only period=week-ending-Fri; FRED lacks the
  Petroleum Status Report). Real reported weeks + a holiday model (Thu 11:00 for any observed federal holiday Mon/Tue/Wed
  of the release week — improves on prod's Monday-only generator). → the independent hand-check must FOCUS on EIA
  holiday-weeks (the highest-risk type). FRED CPI/NFP + Fed FOMC are authoritative.
- **★ DURABILITY RISK (registered follow-up):** `_events_for_type` returns the JSON list whenever the type is present,
  falling to STATIC only when a type is ENTIRELY absent. So a future `economic-calendar-sync-service.ts` run
  (monthly/boot cron) regenerates the JSON from `HISTORICAL_ANCHOR="2024-01-01"` and SILENTLY WIPES the 2020-2023 rows
  (STATIC won't rescue — the types remain present in the regenerated JSON). **Durability fix (separate, deliberate):**
  extend sync to `HISTORICAL_ANCHOR="2020-01-01"` + FOMC 2020-2023 in `FOMC_ANNOUNCE_DATES` + `EIA_EVENTS` to 2020 + add
  FRED Feb/May dedup to the sync. Left out per scope-lock (avoids live-DB writes + un-deduped-FRED regression). REGISTER.
**ACCEPTANCE: NOT committed until the INDEPENDENT hand-check (fresh agent, primary sources) passes — per the ratified
Part-B acceptance ("nothing that reads the calendar changes behavior until verification passes").**

## ★★ PART B ACCEPTED — independent hand-check PASS (2026-07-09)
Fresh accuracy-validator, 12-date sample vs PRIMARY sources fetched directly (federalreserve.gov + eia.gov; bls.gov 403 →
DOL embargo PDFs + 5+ news orgs off the same BLS wire). **ALL MATCH, zero discrepancies:**
- March-2020 boundary: 7 scheduled FOMC 2020 confirmed vs Fed historical page; Mar-3 + Mar-15 emergencies correctly
  ABSENT; Mar-17-18 confirmed cancelled.
- DST-adjacent: NFP 2020-11-06, CPI 2021-03-10 (08:30 ET) — MATCH.
- **EIA holiday-shifts (highest-risk, derived): 2023-07-06 / 2020-11-12 / 2022-06-23 ALL MATCH eia.gov's OWN archive.**
- Remainder: FOMC 2022-11-02, NFP 2023-01-06, CPI 2022-06-10 — MATCH.
**ONE RESIDUAL (flagged, bounded, NOT a blocker):** EIA per-date release TIMES aren't in EIA's archive (date only) → the
11:00-ET holiday-shift TIME is CONVENTION-verified (documented Dec-6-2018 example), not per-date-primary-verified. Affects
only ±30-min boundary bars on holiday-week EIA releases. The DATES (where a derived model most likely errs) are all
primary-confirmed. → minor follow-up (nail the exact EIA holiday-shift time if a boundary case ever bites); does NOT block
acceptance (the ratified gate = hand-check passes → accept). **PART B COMMITTED. Durability follow-up (sync 2020-anchor)
still registered.**

## ★★ PART A SPEC — STAGED (class-path macro mask; standing launch protocol → operator ratify before implement) 2026-07-09
Defect-9 gap CONFIRMED: `run_class_backtest` (6509+) has ZERO blackout/event_mask references; `run_backtest` applies the
macro mask via `generate_event_mask(df["ts_event"], policies)` (±30-min, lines 3875-3966). Part A mirrors it into the
class path.
- **Mechanism:** in `run_class_backtest`, after entry signals generate + before execution, apply
  `event_mask = generate_event_mask(df["ts_event"], policies)` with T1 policies (FOMC/CPI/NFP + EIA-for-MCL, SIT_OUT
  ±30 min), suppress entries where blocked. np.roll-safe (mask applied on the same entry-timing axis as existing gates).
- **★ Polarity — use the EXPLICIT-POLICIES path, NOT the default fallback.** run_backtest's no-event_calendar default
  fallback (~3885-3945) carries the registered polarity inversion (True=allow vs generate_signals True=block). Part A
  MUST pass explicit policies + consume the backfilled STATIC_EVENTS/authoritative calendar (now 2020-2026) → avoids the
  buggy fallback by construction. (The fallback polarity bug stays a SEPARATE registered finding.)
- **Window convention:** ±30-min timestamp window around release time (matches `blackout_gate.py` + live
  `paper-signal-service.ts`), per the mask-semantics trace. Backfilled release times (14:00 FOMC / 08:30 CPI-NFP /
  10:30-or-holiday-11:00 EIA) drive it.
- **Tier:** DEFENSE-IN-DEPTH (per the tally — not verdict-variable at the decisive pair).
- **ACCEPTANCE (agent-loop review):** (1) PARITY — class-path event-mask == run_backtest event-mask on identical
  policies + calendar (no polarity divergence); (2) the pre-registered re-baseline CALENDAR-SUPPRESSION read (0.5
  amendment) = enumerate suppressed pre-2024 trades, verify EACH sits in a backfilled ±30-min window, report aggregate
  P&L = retroactive materiality receipt; (3) TRIPWIRE — any suppression OUTSIDE a window OR flipping zero/nonzero = FULL
  STOP (locked read-order).
**AWAITING RATIFY → then agent-loop (scope-locked implement → independent review w/ the parity + suppression + tripwire
reads) → 7/8 land → seam trace → re-baseline.**

---

## #3 Defect-10 REAL-CORPUS MATERIALITY RECEIPT — LANDED (gates nothing; goes to the record)
`docs/replay-results/defect10-real-corpus-receipt-2026-07-07.json` (agent a7048b871416e4c65, 12 engine×pair runs in-session).

**Scope catch (declared deviation, well-reasoned).** The task's suggested populations (14 v3-shadow concepts / N=9-reference)
are Corpus-v3-classifier DSL/crossover artifacts that never touch `breaker.py`/`unicorn.py` → running them = a bit-identical
zero-diff receipt measuring NOTHING about Defect-10. Agent instead ran the population Defect-10 ACTUALLY affects:
**BreakerStrategy × {MES,MNQ,MCL} + UnicornStrategy × {MES,MNQ,MCL} = 6 pairs**, real ratio-adj S3 15min,
2020-06-01→2026-07-01 (135K bars/sym), identical local parquet copied byte-for-byte into both worktrees. Batch engine =
`0008bcb` (parent of `59dbc2a`); streaming engine = `hardening/phase-0` HEAD. This also confirms the earlier tripwire-scoping
read: the N=9 tripwire is IRRELEVANT to Defect-10 (classifier track, not the archetype engine fix).

**Direction CONFIRMED — the look-ahead was optimistically inflating (expected direction; joins Defect-4):**
1. **Displacement:** removed(a) 84 trades / −$4,499.55; freed(b+c merged) 46 / −$10,682.01; **NET (freed−removed) = −$6,182.46**
   — the correct (streaming) engine reports LOWER P&L → batch was inflated.
2. **Fraction in window:** 84/3,253 = **2.58%** of batch trades were forward-window admissions (the streaming gate is the sole diff).
3. **Win-rate delta:** peeked 41.7% (n=84) vs clean 32.8% (n=3,169) = **+8.9pp aggregate**, MIXED per-pair (3/6 negative).
4. **Tripwire: DID NOT FIRE.** All 6 pairs nonzero both engines (451–713 trades); no zero↔nonzero flip; no FULL-STOP. Safe-direction.

**Two honest caveats (agent flagged, not papered over):**
- **Proxy method.** Trade records carry `entry_idx`/`entry_timestamp`/pnl but NOT zone-level `broken_at`/`valid_from`, so the
  (a)/(b)/(c) split is a realized-trade proximity-pairing PROXY (median 4 bars, matching the bar-39/43 example), NOT the ratified
  4-predicate raw-candidate taxonomy. The rigorous zero-(d) result stands from the FIXTURE verification (breaker 600 + unicorn 205,
  zero (d)s); this real-corpus receipt is coarser by necessity.
- **★ 30 unexplained streaming-only additions / −$3,441.45** — FLAGGED, not claimed clean. Most likely proxy-unpairable (b)/(c)
  rather than genuine (d)s (fixture pass established zero (d)s under the real taxonomy), but the receipt's proxy can't classify them
  definitively. Resolving proxy-artifact-vs-genuine-(d) would need a zone-instrumented re-run — a follow-up that does NOT reopen the
  fix's acceptance (fixture-verified). Registered for the operator's awareness.

**Verdict: materiality receipt only — gates nothing, reopens no certified finding.** Defect-10's real-corpus magnitude is now on
the record (was synthetic-directional-only). The re-baseline's own Defect-10 read (0.5 pre-reg) remains the authoritative post-fix number.

---

## RULING A + B (2026-07-09) — amendment-1/2 traces escalated, both ruled. Scope-wiring fix inserted BEFORE Part A.

### Amendment-1 trace RESULT: run_backtest's macro mask is UNIVERSAL/UNSCOPED (the reference is broken).
Grep-proven three layers: `generate_event_mask(timestamps, policies)` takes NO symbol; `_get_events_for_policies(policies)`
appends every event with NO product filter; `EVENT_PRODUCT_SCOPE` (economic_calendar.py:51, correctly declares EIA→crude)
is DEAD CODE — consumed nowhere (only a stale .pyc matches). So EIA (~208 events, every Wed 2020-2026) blacks out MES/MNQ
index entries; no CPI/NFP index scoping either. Three conventions in play, none agreeing: your-pin (FOMC all / CPI-NFP
index-only / EIA crude), code's-dead-map (CPI-NFP all), code's-runtime (universal incl EIA→index).

### RULING A — canonical convention = the ratified live pin (2026-06-22 Known-Facts): FOMC/FOMC_MINUTES→all; CPI/NFP→equity-index-only; EIA→crude-only.
Not adjudicated fresh — the pin is the authority; runtime + dead-map are two drifts from it. TS `news-policy.ts::eventAffectsSymbol`
VERIFIED conformant to the pin (INDEX={MES,MNQ,ES,NQ,M2K,RTY,MYM,YM}, CRUDE={MCL,CL,QM}; test "CPI does NOT block crude").
CONTINGENCY (TS-contradicts-pin) did NOT fire → Python is the sole drifted party → build Python to match TS.
**Consequences (reshape Part A scope):**
1. **Scope-wiring fix to run_backtest FIRST** (verdict-variable, lands before re-baseline w/ Defects 7/8 + Part A): correct
   EVENT_PRODUCT_SCOPE CPI/NFP→index, wire it via a REQUIRED symbol threaded through `_get_events_for_policies` (None/unrecognized
   RAISES, never guesses); explicit-policies path only, polarity-bugged fallback stays quarantined.
2. Part A parity anchor MOVES: "matches the RULED convention, both paths" — class-path == CORRECTED run_backtest. Fixtures:
   1a MES not-suppressed in EIA window / 1b MCL not-suppressed in CPI-NFP window / 1c FOMC suppresses all three.
3. **TS↔Python parity GATE** (new `check-ts-python-event-product-scope-parity.ts`, sibling to tier1-parity): asserts
   eventAffectsSymbol ≡ EVENT_PRODUCT_SCOPE — the durable fix for a silently-unwired map.
4. Counterfactual-universal receipt line-item (arithmetic, no tower time): count trades that sat in EIA-windows-on-index or
   CPI/NFP-windows-on-crude = what universal WOULD have wrongly suppressed = the dodged-bug magnitude.
5. Part B stays ACCEPTED (data correctness; scoping is a consumption-layer concern, does not reopen 2b88026).

### Amendment-2 trace RESULT: FOMC_MINUTES exists ONLY 2026(7)+2027(8); ZERO for 2020-2025. Part B didn't add them → absent across the whole history, not just one year.
### RULING B — TOP-UP (not register-limitation). 2020-2025 Minutes dates are PUBLISHED ARCHIVAL FACTS (federalreserve.gov), not approximations — transcription, same class as Part B's FOMC statements. +21-day self-flag applies only to FUTURE projection.
Exclude emergency-meeting minutes (scheduled-only; March-2020 emergency minutes folded into April-2020 releases INHERIT the
exclusion). Under Ruling A: FOMC_MINUTES→all symbols. No receipt residual flag (per-date primary-verified). Runs on Part-B
machinery; own independent hand-check = acceptance (April-2020 boundary + one DST-adjacent + remainder, fresh agent, primary sources).

### REVISED LOCKED ORDER
scope-wiring fix (run_backtest + parity gate + fixtures) → Part A (against corrected reference) ‖ Minutes top-up (parallel, own
hand-check) → 7/8 → seam trace → re-baseline (frozen 0.5 exam + full-window suppression receipt incl. counterfactual-universal
count + EIA-residual flags). Everything verdict-variable lands before re-baseline; read order unchanged (reference → validity → verdict).

### DISPATCHED 2026-07-09 (both worktree-isolated, pinned 899c35a, parallel — engine-code vs calendar-data, no contention):
- W1 scope-wiring IMPLEMENTER (backtest-core): EVENT_PRODUCT_SCOPE→pin, thread required symbol, parity gate, fixtures 1a/1b/1c. → independent fresh-context review before land.
- W2 Minutes TOP-UP builder (general-purpose): 2020-2025 archival Minutes, emergency-excluded, fixture json. → independent hand-check before land.
Part A implementer HELD until the corrected reference lands + its fixtures green.

---

## ⚠️ INCIDENT + RECOVERY (2026-07-09) — isolation:worktree fork-bug; caught pre-push; W1+W2 re-applied on correct base.
**What happened:** W1 (scope-fix) + W2 (Minutes) were dispatched as `isolation:worktree` agents "pinned to 899c35a." But `isolation:worktree` forks from the LIVE shared HEAD at spawn, NOT the SHA in the prompt — and a CONCURRENT session's rebase had moved shared HEAD to an OLD commit (c373317, pre-Part-B, backtester.py 848 lines behind). So both agent commits (2a35c51/f2a60a1) were built on the wrong base. The agents' LOGIC was correct + independently reviewed (W1 8/10, W2 hand-check PASS), but their FILES reverted ~846 backtester.py lines + Part B.
**How it was caught:** landing W1, the commit stat read `+458/−1285` vs the review's `+404/−35`. The −1285 mismatch triggered a pre-push investigation → line-count diff exposed backtester.py 8385→7539 (846-line revert) + economic_calendar.py reverted to pre-Part-B. **Never pushed the bad commit** (034d83e).
**Recovery (§11b-compliant):** (1) neutralized landmine — `update-ref hardening/phase-0 a9d7a71 034d83e` compare-and-swap (034d83e^==a9d7a71 verified → drops ONLY the bad commit, concurrent work untouched); (2) created a worktree pinned to EXPLICIT SHA a9d7a71 (`git worktree add ../wt-scoperedo a9d7a71` — the §11b rule-2 correct method, NOT isolation:worktree); (3) re-applied the reviewed-LOGIC patches (`git diff 2a35c51^..2a35c51` + `f2a60a1^..f2a60a1`) via `--3way` onto the correct base; (4) VERIFIED on correct base: parity 35/35, pytest 48/48, py_compile OK, backtester.py 8387 (NO revert), Part B `_EIA_2020_2023` intact, W1 call-site landed correctly at run_backtest explicit-policies path (3883-84, fallback untouched).
**Result:** corrected land = `849895e`, pushed to backup ref `corpus-v3-gate3-cert-2026-07-06` (a9d7a71..849895e FF). **LESSON (frozen): `isolation:worktree` forks from moving shared HEAD — UNSAFE when a concurrent session rebases. Use manual `git worktree add <path> <explicit-SHA>` per §11b rule 2. Always diff-stat vs the expected delta BEFORE pushing agent worktree commits.**

---

## PART A LANDED (2026-07-09) — class-path macro mask, independent review CONFORMANT+GREEN.
`934a378` on backup ref `corpus-v3-gate3-cert-2026-07-06` (80b6e69..934a378 FF; built via SAFE manual explicit-SHA worktree, NOT isolation:worktree). Diff-stat gated: +459/−0, backtester.py 8387→8420 (no revert), Part B intact.
**Built:** run_class_backtest (had ZERO event_mask refs — the Defect-9 gap) now mirrors run_backtest's scope-wired mask: `generate_event_mask(ts, policies, strategy.symbol)` on the EXPLICIT-POLICIES path (optional `event_calendar` param, default None → byte-identical legacy), `entry & ~mask` suppression byte-identical to signals.py:288-290. Default-fallback polarity-bug branch NOT mirrored (quarantined). Addition-4 fail-closed coverage guard: `assert_events_present_in_window` raises `EmptyCalendarError` on a wiped calendar, symbol-agnostic liveness (no false-raise on MES+EIA-only). Helpers in economic_calendar.py (+129): apply_class_event_mask / assert_events_present_in_window / count_events_in_window / EmptyCalendarError.
**Independent review VERIFIED all 9 points** incl. closing a false-pass caveat (parity test's DSL reference is hand-rolled inline → reviewer independently read the REAL signals.py:288-290 and confirmed byte-identical before accepting green). Scope fixtures (MES-not-EIA / MCL-not-CPI-NFP / FOMC-all), DST both seasons, two-sided polarity, run_backtest untouched (3 hunks only), pre-existing trail-stop failure confirmed unrelated. 15/15 new pytest.
**TRANSPARENCY (documented, loud):** class/DSL parity holds for the EXPLICIT-POLICIES path only; no-policies → class applies no mask while run_backtest falls to its quarantined default-fallback. Intentional.
**REGISTERED FOLLOW-UP:** class WALK-FORWARD (`run_walk_forward_class`, backtester.py:8056) does NOT forward `event_calendar` → class-WF still won't blackout. Pre-PR behavior (never masked), so no regression; wire before ANY class-WF-derived verdict. Lands with the re-baseline follow-ups.

---

## DEFECTS 7/8 — full-call-graph CONFIRMED (2026-07-09; census was coarse, now verified) + SPEC STAGED (awaiting ratify).
Ledger reconcile per the locked morning order — NOT re-numbered, NOT new defects. Both CONFIRMED real gaps in run_class_backtest:
- **Defect 7 (partial-fill) — CONFIRMED FULL GAP.** `apply_fill_model`+`apply_volume_partial_fills` applied in run_backtest body (4526-4615) before its portfolio; run_class_backtest builds its own `vbt.Portfolio.from_signals` (~7119) with NO fill-model preprocessing → IDEALIZED fills (optimistic). Contradicts §12 "partial fill DEFAULT ON."
- **Defect 8 (VIX-margin) — CONFIRMED GAP, NARROWER than census.** `apply_vix_margin_expansion` (contract-count reduction VIX>30 halve / >50 quarter) called ONLY in run_backtest (4207). BUT class path ALREADY threads `vix_np` → `_apply_trade_management` for the per-bar VIX STOP-MULTIPLIER (that half is SHARED). ONLY the margin-expansion CONTRACT-COUNT reduction is missing → over-sizing high-VIX days. Contradicts §12 "VIX margin ON." (Census "FULL GAP" corrected: stop-mult present, margin-sizing absent.)
- Classification: both sizing/P&L-only → PRE-RE-BASELINE tier (not entry-suppressing, not Gate-3 blockers). Both make corpus equity OPTIMISTIC → matter for re-baseline Mode A/B (Sharpe/DSR/WFE/B14).

### SPEC STAGED (awaiting explicit ratify per standing launch protocol):
- **D7:** mirror run_backtest's `apply_fill_model`+`apply_volume_partial_fills` into run_class_backtest before its portfolio build (same functions, same fill_probs/volume inputs, same seeds convention). Env `BACKTEST_PARTIAL_FILL_ENABLED` default-ON respected. Byte-identical when disabled.
- **D8:** mirror `apply_vix_margin_expansion` into run_class_backtest's sizing (reduce max_contracts on rolling VIX), analogous to run_backtest:4207 — do NOT duplicate the per-bar stop-mult (already shared via vix_np). VIX-absent → fail-soft (no expansion), audit `margin_expansion_unavailable_no_vix`.
- **Acceptance (agent-loop):** (1) PARITY — class sizing/fill == run_backtest on same inputs (fill-model byte-identical; margin-expansion reduces max_contracts identically at VIX>30/>50); (2) default-ON respected, disabled→byte-identical legacy; (3) diff-stat no-revert (backtester base 8420); (4) regression class suite. Same SAFE method (explicit-SHA worktree, diff-stat before push, independent review).
- Same pattern as Part A (Defect-9): run_class_backtest systematically under-mirrors run_backtest. AWAITING RATIFY → agent-loop → then seam trace → re-baseline.

---

## RULING (2026-07-09) — Option 2 ratified + sharpened: D7 solo, D8-as-filed CLOSED (not a parity gap), re-baseline proceeds VIX-blind.

### D8-as-filed CLOSED — the sibling-parity obligation is discharged by the finding itself.
Step-0 Addition-3 proved NO VIX feed reaches ANY backtest dataframe — `load_ohlcv` returns OHLCV only, no caller joins vix, both engines' `if "vix" in df.columns` else-branch fires ("VIX column absent — skipping"). So `run_backtest`'s `apply_vix_margin_expansion` is ALSO dormant → both paths no-op IDENTICALLY → **there is no class-vs-run_backtest parity gap.** D8 is not deferred, it is CLOSED as filed. It re-files as a DIFFERENT, system-level finding (below).

### THREE RECORD CORRECTIONS (land now, not when the feed does):
1. **★★ KNOWN-FACT PINNED: VIX-margin-expansion is DORMANT SYSTEM-WIDE since Wave 27.5 Pass D** — shipped, §12/CLAUDE.md documents it "DEFAULT ON," but it has NEVER been fed (no vix column on the backtest OHLCV frame, ever). §12's "DEFAULT ON" is a FALSE CLAIM (doc-integrity violation of the proxy-declaration rule) — any future agent diagnosing high-VIX sizing would trust a feature that structurally cannot fire. See memory [[reference_vix_margin_dormant_no_feed_2026_07_09]].
2. **FUNCTION-POINTER CORRECTION:** the shared per-bar VIX STOP-MULTIPLIER lives in `_apply_dsl_stop_loss_and_time_stop` (backtester.py:3190), NOT `_apply_trade_management` (which has no `vix_np` param). Load-bearing for the future D8-feed implementer. (Empirically proven: high-VIX widened stop → ceiling-skip that low-VIX didn't; `apply_vix_atr_multiplier` tiered 15→1.5/26→2.0/55→2.5.)
3. **RE-BASELINE RECEIPT line:** "VIX-margin: dormant by construction, engagements N/A" — the pre-registered D8-nonzero expectation resolves to a RECORDED REASON, doesn't silently vanish.

### RE-BASELINE PROCEEDS VIX-BLIND (explicit reasoning on the record — someone will ask why we certified on a VIX-blind instrument):
- **Defined, consistent instrument** — VIX-margin uniformly absent across every year, both arms, every historical backtest. "Dormant everywhere" = the honest status quo; the exam measures the instrument as it exists.
- **Common-mode for the Gate-3 verdict** — Gate 3 is arm-vs-arm revival-count comparison; margin-expansion changes contract COUNTS (sizing magnitude) not trade ADMISSION (trade sets), identically for both arms. Second-order at most (integer-rounding on 33/33/34 at small counts), nowhere near the first-order verdict-variability the guards + mask had.
- **The alternative is the highest-risk move available** — rushing a daily-VIX-onto-intraday join onto the critical path is a look-ahead machine by construction (same-day VIXCLS close on a 09:30 bar = future info, the HTF ts_event trap class already pinned). We do NOT manufacture an invisible error to unblock an exam it barely touches.

### D8-FEED PACKET — re-files under PRODUCTION HARDENING, POST-re-baseline. Spec pre-registered NOW (traps hot):
- **Trap #1 as-of join:** FRED VIXCLS is a daily close — intraday bars MUST see the PRIOR session's value (or a genuinely timestamped intraday source). Same +1-shift rigor as the HTF pinned fact; fixture probes a bar whose same-day close would leak.
- **Floor semantics answered explicitly:** can quartering reach ZERO contracts? If yes → feed packet is ADMISSION-variable not just sizing-variable (changes its receipt burden). Must match run_backtest's answer, whatever it is.
- **Class-path mirror lands IN that packet** where synthetic VIX>30/>50 fixtures prove it ALIVE — never as unfed dead code.
- **Both-engine materiality receipt** with resurrected pre-reg: Mar–Apr 2020 quartering MUST fire; zero post-feed = escalate.
- **Provenance hand-check** per Part B protocol (primary-source spot-checks, holiday alignment).

### D7 SOLO — dispatched (wt-d78). Acceptance: Addition 1 full (3-zone + differ-from-disabled non-vacuousness + partial×StyleC + exit-leg + zero-volume) + Addition-2 D7-half (engagement instrumentation, pre-reg near-zero at base size = honest) + base acceptance. Addition 5 (insertion-point) MIGRATED to D8-feed packet (was VIX-specific). Seam doc-line rides in the D7 commit.

### SEAM RULING — ACCEPTED document-only. Re-baseline queue does NOT grow.
Live has NO same-bar tie-break (single `config.side`/session, paper-signal-service.ts:380) → nothing for the engine to diverge from. Engine long-priority (backtester.py:5656-5664) is A7-DIAGNOSTIC-ONLY; execution defers to vectorbt default (drop-both). Frequency structurally ~never (crosses mutually-exclusive/dup-both→long/incomplete-bidir rejected/archetypes directional). Agent correctly refused to fabricate a count where only a structural bound exists. Doc-line states both facts (rides in D7). **ADJACENT ITEM REGISTERED (parked post-campaign):** whether a `direction:both` archetype's `long_short_split` (backtester.py:5635-5638) maps to ONE live `side`-session or TWO = a direction-coverage trace (future live-deployment representation Q, NOT an arm-vs-arm confound). Named so it can't evaporate.

### CONDUCT (named per launch-protocol working at the subagent tier — where it usually erodes first):
The 7/8 implementer wrote ZERO lines ahead of a failed pre-check, and REFUSED to carve D7 out of a ratified batch on its own authority (escalated the scope call to the operator). doer≠grader + no-redesign held at the subagent tier.

### CAMPAIGN JOURNAL: Addition 3 was written to catch an inert FIX and instead caught an inert PRODUCTION FEATURE that three waves of green CI never noticed — parity tests pass VACUOUSLY when both sides are dead; only a feed-existence check asked the question no test asked. **Second time this campaign a pre-registered expectation outperformed the entire test suite.** Pattern proven twice: every default-ON institutional feature deserves an engagement-count somewhere a human looks. POST-CAMPAIGN: census of §12 default-ON features for sleeping dormancy (operator wants it eventually, not incidentally).

### RE-BASELINE GATE now sits behind exactly ONE thing: D7's land + review. Then seam→re-baseline (locked order); the frozen 0.5 exam runs on an instrument whose every known divergence is fixed, receipted, or ruled out-of-scope on the record.

---

## F-1 RULING (2026-07-09) — D7 lands DORMANT-ALIGNED (not active); partial-fill is the THIRD dormant default-ON feature.
Independent review VERIFIED D7's transcription byte-faithful + all 8 contract points — but caught F-1 (CRITICAL): `run_backtest` gates its fill block on `if request.fill_model:` (backtester.py:4524); `BacktestRequest.fill_model` defaults None with ZERO `src/server` populators → **production run_backtest applies NO fill degradation.** Parent-confirmed independently (grep src/server fill_model = 0 assignments; config.py:640 =None; provenance-stamp.ts:140 stamps `partial_fill_enabled:true` unconditionally = FALSE label). The current D7 gated the class path on the env flag (default ON) → would make class degrade while DSL doesn't = a NEW class-vs-DSL asymmetry, opposite the filed gap.

### RULING: D7 mirrors run_backtest's PRODUCTION behavior — which is dormant. Amendment before land:
- **Activation-surface alignment:** class path gates on an OPTIONAL `fill_model` param (absent → byte-identical no-op), NOT the global env flag. Both engines dormant in production → parity PRESERVED (both idealized). Transcription stays credited/unchanged; only the outer gate moves env→param.
- **NOT a §13 violation** (disabling an institutional default): F-1's discovery is the default was NEVER operatively enabled anywhere — §12/§13 "DEFAULT ON" false since W27.5 Pass D. Activation routes through a deliberate packet that flips BOTH engines at once + unifies the config surface (env-flag vs request-field split is HOW the dormancy hid) + fixes provenance + makes §12 true. Institutional posture gets realized there, with receipts — not as a side-effect of a one-engine defect fix.
- **Exam materiality near-zero either way** (pre-reg: near-zero engagement at base micro size) → the decision is PRINCIPLE not arithmetic; parity-preserving choice is free.

### F-1 RECORD WAVE (lands with the amendment):
1. **★★ THIRD DORMANCY PINNED:** partial-fill dormant system-wide (no fill_model populator in src/server; backtester.py:4524 gate always-false in production) despite §12/§13 "DEFAULT ON" — joins its siblings the unwired scope map + the unfed VIX margin. [[reference_vix_margin_dormant_no_feed_2026_07_09]].
2. **Provenance stamp fixed NOW** (record-integrity, doesn't wait for activation): provenance-stamp.ts:140 must derive `partial_fill_enabled` from OPERATIVE state (fill_model present/absent), + test false-when-absent/true-when-present. Actively false in every backtest row today.
3. **D7 receipt pre-reg resolved:** "near-zero at base size" → superseded by "partial-fill: dormant by construction, both engines, engagements N/A."

### META-RULE RATIFIED AS CAMPAIGN LAW + CENSUS PROMOTED TO NAMED PACKET.
Three findings, one pattern: scope map existed/wired to nothing; VIX margin existed/fed nothing; fill model existed/passed nothing. Three green-CI waves over "shipped, documented, never invoked" — parity tests pass VACUOUSLY when both sides dead; nothing asked *does this feature ever fire?* **Hardened rule: "run_backtest has X" is incomplete until "and X is INVOKED in production — feed-existence PLUS engagement evidence." Applies to every X in every future packet.** DORMANT-DEFAULTS CENSUS = named post-campaign packet: every default-ON/documented-institutional §12–§13 feature traced default→call-site→feed/population→engagement, verdict ALIVE/DORMANT/DEAD. Activation packets (fills, VIX) = its first two children. Post-campaign (must NOT swallow the exam schedule) but no longer optional.

### EXAM-INPUT PROVENANCE PRE-FLIGHT (read-only, gates the exam firing):
F-1's asymmetry never exists under dormant-align → any class-vs-DSL exam stage is fills-unaffected. But the GENERAL question stays: every exam-stage numeric input must be provenance-checked for engine+generation. SAFE by record: arm-vs-arm core is class-vs-class by construction (Ruling 2); reference re-derivation re-computes the demotion arm on the CURRENT class engine. OPEN: whether null-cal floors / Mode A/B baselines / 1ab7321-era context numbers enter from an OLDER engine generation. Pre-flight = walk the frozen 0.5 exam spec, list every stage's numeric inputs + producing engine+generation, escalate anything cross-generation BEFORE the exam fires.

### STASH-VIOLATION CLOSURE: D7 builder ran git stash/pop once (rule-3 violation) — verified HARMLESS (LIFO-clean, other sessions' stashes intact). Self-report CREDITED (it's what made it recoverable; LIFO-clean was partly luck). Rule stays ABSOLUTE (WIP commit / patch file, never stash). Land checklist keeps the stash-stack integrity check it gained.

### SEQUENCE: amendment (gate+stamp+record) → focused re-review (DELTA only — transcription credited, re-check gate+stamp+fixtures-prove-alive) → diff-stat → FF land → exam-input pre-flight → **re-baseline fires** (on clean pre-flight, exam authorized WITHOUT further ratify — the 0.5 exam was frozen long ago; its authorization is the point the ladder has climbed toward).

---

## SEALED-VERDICT RULING (2026-07-09) — 4th dormancy + provenance-law amended + operative-path trace commissioned.
Mid-exam feed-existence stop (before any verdict). The Option-A/B dichotomy was undecidable as posed — both assume we know WHICH macro path the exam arms flow through; we know which paths EXIST, not which FIRES. Verdict seal STAYS ON; null-cal runs to completion (floor is mask-agnostic — masking only removes trades, no time-of-day mask manufactures $250/day in a random-entry null) but NO arm verdict until the operative-path trace lands.

### ★★ FOURTH DORMANCY — pinned in full shape (sibling default-path DIVERGENCE, not just "unfed"):
`event_calendar` explicit-policies path is UNFED in production (ZERO populators in src/server; neither exam runner passes policies) — so the scope-wiring + Part-A class-mirror are dormant in the exam. **But the two siblings' ENGAGED DEFAULTS still DIVERGE:** `run_backtest` with no explicit calendar falls to the QUARANTINED time-of-day fallback (`_build_default_event_mask_et`, masks 4031 bars observed in null-cal); `run_class_backtest` with no calendar masks NOTHING (Part A explicit-gated by design). Production DSL backtests have run the polarity-quarantined path all along while class runs maskless — **the sibling-parity campaign's LAST surviving divergence is the default path, live inside the exam right now** (null arm on fallback, exam arms' class path on nothing). Census gains it (4th child). MACRO ACTIVATION PACKET (post-campaign, sibling to fills+VIX) inherits the real design question: polarity-fix vs product-scope vs remove-the-fallback, and UNIFY both engines' default so "no calendar supplied" means ONE thing not two. [[reference_vix_margin_dormant_no_feed_2026_07_09]].

### ★★ PROVENANCE-LAW AMENDED (on the record): **provenance = generation × PATH × ENGAGED CONFIGURATION** — not generation alone. The exam-input pre-flight verified null-cal re-runs on G4 but never asked THROUGH WHICH MASK REGIME. The mid-run stop caught what the generation-only checklist structurally couldn't. Every future provenance check verifies which feeds/policies/flags ACTUALLY FIRE, not just which engine build produced the number.

### OPERATIVE-PATH TRACE COMMISSIONED (5 questions, ENGAGEMENT-EVIDENCED — blocked-entry counts per arm from probe runs, not code-reading; 3 dormancies in, "the path exists" convinces nobody):
1. Which fn blocks entries for the exam arms (apply_eligibility_gate overlay / event_calendar mask / fallback) — per-arm probe counts. 2. Arm symmetry (demotion-arm corpus specs vs v3-shadow classifier specs registration vs ALL_STRATS — differ = unregistered-bypass confound = STOP). 3. Operative-path semantics (calendar source [Part B backfill?] × granularity [timestamp-window vs DATE-FLATTENED → 00:05-trade-by-08:30-print trap alive?] × product-scoping [ruled vs universal]). 4. Demotion-arm reference re-derived INSIDE G4 (not pre-Part-B cited). 5. Null-arm annotate (fallback, 4031, quarantined, floor-valid; no touch).

### PRE-COMMITTED ROUTING (mechanical, no re-litigation vs a known verdict): both-arms-same-path-same-semantics → exam proceeds unmodified (common-mode; Option B REJECTED — injecting policies mid-exam modifies a frozen exam + certifies a config production doesn't run = proxy in a parity costume). Arm asymmetry → STOP + small verdict-variable packet before re-fire. Date-flattened → G0-common? yes=annotate+proceed (cert scoped "macro = date-granular overlay"; timestamp upgrade joins activation family) / no=cross-gen=reconcile. SUPPRESSION RECEIPT: operative-path-reads-Part-B-calendar → receipt survives re-scoped to that path; else N/A (mask dormant, defense-in-depth tier) with honest acknowledgment the receipt pre-reg + Part-A defense-in-depth were LATENTLY CONTRADICTORY the day both ratified (tier wins — receipt was always the measurement of an engagement the tier never promised).

### CONDUCT NOTES (record): (1) tsc troll-stub catch — refused "0 errors" at face value on a ~7036-baseline repo, resolved WHY the zero was ambiguous (skipLibCheck) before trusting the delta = worktree discipline working. (2) --3way land against the advanced cert ref = proven pattern under divergence. (3) stopping a 34-min exam run to surface a feed-existence finding BEFORE any verdict existed = campaign ethos in one act. The exam waited months; it waits one trace.
