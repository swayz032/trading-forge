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
