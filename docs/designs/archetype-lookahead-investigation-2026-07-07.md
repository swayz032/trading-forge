# Archetype Look-Ahead — independent doer≠grader trace (2026-07-07)

**Trigger:** Fable-5's deep engine-coverage grader claimed F-1/F-2/F-3 = CRITICAL look-ahead in
breaker.py / mitigation.py / unicorn.py — "zone validity computed from a window extending past the
earliest entry bar → backtest admits trades using future bars (inflated edge)." Independently traced
(read-only; NOT accepted at face value — grader claims are claims until the code is checked).

## FACTS (checkable code trace — breaker.py path)
1. **Swing layer is CLEAN — contradicts the grader's "swing window" framing.** `detect_swings`
   (`market_structure.py:22`) uses a CENTERED `rolling_max/min(window=2*lookback+1, center=True)` BUT then
   shifts every swing index forward by `half_window`: `(pl.col("index") + half_window)` with the explicit
   comment "so the swing is only visible after the confirmation window completes (**eliminates lookahead
   bias**)" + line 321 "these functions never read ahead." So a centered swing at bar i is re-indexed to
   i+lookback (its confirmation bar). NO look-ahead in swing detection.
2. **OB anchors at the swing bar (shift removed):** `detect_bullish/bearish_ob` (`order_flow.py:129/162`)
   does `raw_indices = np.maximum(raw_indices - lookback, 0)` — anchors the OB zone at the swing candle
   (correct — that's where the OB is drawn). The zone ANCHOR is correct; usability-before-confirmation would
   only leak if a consumer uses the OB before swing_bar+lookback (NOT yet traced end-to-end).
3. **THE REAL CANDIDATE — breaker.py:141 BOS-near-break validation searches a FORWARD window:**
   `for check_bar in range(max(0, broken_at - 3), min(n, broken_at + 4))` — checks BOS in [broken_at-3,
   broken_at+3], i.e. 3 bars PAST the break point. The breaker is marked valid if ANY BOS is in that window;
   that validity gates ALL retest entries on the zone. IF a retest entry occurs within [broken_at, broken_at+3],
   its admission used BOS bars from its own future.

## VERDICT (partial — doer≠grader)
- The grader's SPECIFIC mechanism ("swing window extends past entry bar") is **NOT what the code does** —
  the swing layer is shifted/clean. To that extent the F-1/2/3 framing is a **likely false positive**.
- BUT a NARROWER real candidate exists: the ±3-bar FORWARD BOS-near-break validation window. NOT dismissed.
- **PARKED (materiality judgment — fresh eyes / backtest-core, the fix owner):** is the ±3-forward window a
  MATERIAL look-ahead? Needs: (a) confirm retest entries are reachable within [broken_at, broken_at+3]; (b)
  whether the forward BOS actually flips validity vs a trailing-only [broken_at-3, broken_at] window; (c)
  magnitude on real data (A/B the window bound). ±3 bars is small — could be immaterial or a rounding artifact.
- **mitigation.py / unicorn.py NOT yet traced** — they share the clean shifted-swing layer (so the grader's
  swing framing is likely a false positive there too), but each has its own validation loop to trace the same way.

## Standing-order note
Facts recorded (checkable). Materiality = judgment = parked (not resolved tired). Do NOT fix tired: a
look-ahead "fix" that tightens the window without confirming materiality could silently change every archetype
backtest — same class as the H5 structural-stop-parity flag (default OFF until A/B'd). This is pre-live must-fix
TRIAGE data, not a fix.

## COMPLETION — mitigation.py + unicorn.py traced (2026-07-07)
- **mitigation.py — likely CLEANEST.** `_identify_mitigation_blocks` documents `bos_bar` = "bar index where
  BOS confirmed the MB (**entry only valid after this**)". The design GATES entry to after the confirmation bar —
  the look-ahead guard is explicit. (Design intent verified via the contract comment; line-level enforcement of
  "entry index > bos_bar" NOT yet asserted — a 1-test check for the fix owner.)
- **unicorn.py — same narrow forward-window candidate as breaker.** Displacement validation
  `range(max(0, b_broken_at-1), min(n, b_broken_at+2))` (±1 forward) + FVG proximity `abs(f_bar - b_broken_at) > 5`
  (±5, includes forward). Both reach PAST the break point; unicorn is anchored `formed_at = b_broken_at`.

## FINAL VERDICT (all 3 traced, doer≠grader)
- **Grader's "swing window extends past the entry bar" = FALSE POSITIVE across all 3** — the shared swing layer is
  shifted/clean ("eliminates lookahead bias"); mitigation additionally gates entry-after-BOS explicitly.
- **Real (narrow) candidates, materiality PARKED:** breaker ±3-forward BOS-near-break window; unicorn ±1 displacement
  + ±5 FVG forward windows. These are SMALL (1–5 bars) — plausibly immaterial or rounding-tolerant, plausibly a real
  edge-inflator if entries land in-window. The fix owner (backtest-core) resolves materiality: (a) assert entry index
  > confirmation bar in each; (b) A/B the window bound (forward vs trailing-only) on real data before any change.
- **Grade correction:** "F-1/F-2/F-3 = 3 CRITICAL look-aheads" is OVERSTATED as written. Corrected: 0 confirmed
  CRITICALs; 2 narrow forward-window CANDIDATES (breaker, unicorn) pending materiality; mitigation likely clean. This
  is the doer≠grader value — a claimed CRITICAL is claims until the code is checked, and here the code mostly checks out.

## F-4 (eligibility fail-OPEN for unregistered archetypes) — CORROBORATION of a known open item
- **Not a new finding — it is my logged deep-scan-#21 carry-forward:** "eligibility unregistered-strategy parity
  gap (Band B2, open)." The grader RE-FOUND it independently → doer≠grader corroboration (two paths, same gap →
  raises confidence it is real, and that it is genuinely a live-safety concern, not noise).
- **Quick trace tonight (not a full confirmation):** the eligibility references in `paper-signal-service.ts` are the
  CONSISTENCY / payout-eligibility gate, which is fail-OPEN BY DESIGN ("payout-eligibility gate, NOT a loss gate" —
  documented, consistent with the daily-trade-cap precedent). The grader's specific "unregistered archetype → returns
  TAKE before the 9 hard-SKIP checks (stop-ceiling/kill-zone/sweep/R:R/bias-confidence/max-trades)" mechanism at :5554
  did NOT surface in a quick grep (line numbers shifted; the bypass likely lives in the ARCHETYPE-dispatch vs
  DSL-dispatch divergence, where archetype signals route around the gate DSL strategies pass through).
- **PARKED (careful-not-tired, backtest-core/paper-parity):** a live-safety CRITICAL deserves the same careful trace
  the look-ahead got — find the exact archetype-dispatch path, confirm which of the 9 hard-SKIP checks an unregistered
  archetype bypasses, and assert the fix (register all 22 hand-coded archetypes OR route archetype signals through the
  same eligibility gate). ZERO current exposure (nothing live), so no urgency — but a HARD must-fix before the first
  live archetype trade. Status: corroborated + open, mechanism-trace parked.

## GRADER-FINDINGS TRIAGE — COMPLETE (all 4, doer≠grader)
F-1/F-2/F-3 (look-ahead): grader's "swing window" mechanism = FALSE POSITIVE (swing layer shifted/clean, mitigation
gates entry-after-BOS); grade corrected 3-CRITICAL → 0-confirmed + 2 narrow forward-window candidates (breaker ±3,
unicorn ±1/±5), materiality parked. F-4 (eligibility): corroborates known deep-scan-#21 carry-forward, mechanism-trace
parked, zero current exposure. Net: the grader surfaced real triage value, but its CRITICAL grades were overstated as
written — exactly why claims get checked against code before they are believed.

## LOOK-AHEAD REACHABILITY TRACE (breaker) — the ±3 candidate is REACHABLE (fact, 2026-07-07)
- `compute_breaker_signals` (`order_flow.py:224`, numba) fires retest entries within `zone_age_limit` (default 30)
  bars of `broken_at` — so entries ARE reachable at broken_at+1, +2, +3.
- The BOS-near-break validity (`breaker.py:141`) used BOS in [broken_at-3, broken_at+3]; that per-breaker validity
  boolean gates ALL retest entries on the zone.
- **Therefore an early-retest entry at broken_at+k (k∈{1,2,3}) was admitted using a validity flag that read
  bos_list[up to broken_at+3] — bars ≥ the entry bar → a REACHABLE forward look-ahead of ≤3 bars.** Entries at
  broken_at+4..+30 use validity fully in their past (no leak).
- **UPGRADE: the ±3 forward-window candidate is CONFIRMED REACHABLE, not immaterial-by-construction.** Bounded: ≤3
  bars, only the first ~3 of a 30-bar retest window (retest entries often cluster early, so the affected fraction is
  NOT negligible-by-inspection — that's the measurement).
- **MATERIALITY still PARKED (judgment):** magnitude of edge inflation (A/B the validity window forward-vs-trailing on
  real corpus data; measure the fraction of entries in broken_at+1..+3 and their win-rate delta). unicorn ±1/±5 is
  structurally analogous (FVG retest later; ±1 displacement + ±5 FVG forward windows) — same reachability class,
  not separately traced.
- **Net correction to grader:** the "swing window" mechanism is a false positive, BUT a REAL (small, ≤3-bar) reachable
  look-ahead exists in breaker's ±3 forward BOS-validation window (and analogously unicorn). The grader was
  directionally right that a look-ahead exists, wrong on the mechanism (validation window, not swing window) and
  silent on magnitude (bounded ≤3 bars). NOT dismissed; NOT confirmed-CRITICAL; magnitude is the parked ruling.

## COMPLETENESS TRACES — mitigation enforcement + unicorn reachability (2026-07-07)
- **mitigation.py — design-clean, enforcement UNVERIFIED (honest, not upgraded).** `_identify_mitigation_blocks`
  tracks `bos_bar` (bar where BOS confirmed the MB) and documents "entry only valid after this" (lines 221, 274-325).
  BUT the trace shows only zone CREATION with bos_bar, NOT the entry-loop gate (`entry_bar > bos_bar`). Design intent
  is right; the enforcing line was not located → stays "likely clean, 1-line assert for the fix owner." NOT claimed
  confirmed-clean.
- **unicorn.py — REACHABLE, analogous to breaker (fact).** `max_zone_age=20`; entries fire on retest from formed_at+1
  (loop `for i in range(n)`, `bars_held = i - long_entry_bar`), INSIDE the ±1 displacement window [b_broken_at-1,+1]
  and ±5 FVG proximity (abs(f_bar - b_broken_at) ≤ 5). Same reachable forward look-ahead class as breaker, bounded ≤5
  bars, magnitude parked.

## GRADER-FINDINGS TRIAGE — FULL-DEPTH COMPLETE (2026-07-07)
Final state of all 4, code-anchored, verdicts parked:
- **F-1/F-2/F-3 (look-ahead):** swing-window mechanism = FALSE POSITIVE (shifted/clean). REAL bounded reachable
  look-aheads exist: breaker ±3 (≤3 bars, entries broken_at+1..3 of a 30-bar window, REACHABLE-confirmed), unicorn
  ±1/±5 (≤5 bars, REACHABLE-confirmed). mitigation design-clean/enforcement-unverified. Magnitude = parked ruling.
  Grade: "3 CRITICAL" → 2 reachable-small-look-aheads + 1 design-clean; directionally-right-wrong-mechanism.
- **F-4 (eligibility):** intentional parity bypass; skip-vs-clamp ceiling divergence for unregistered (Check-0 SKIP
  bypassed, execution-cap applies); 0 live exposure; pass-3 impact NIL (A/B cancels). 3 rulings parked (see F4 doc).
**Net:** the grader surfaced genuine issues but every CRITICAL grade was overstated as written; the corrected,
code-anchored picture is 2 small-bounded reachable look-aheads + 1 latent-zero-exposure parity divergence — all with
materiality parked for dawn, none with pass-3-pending-run consequences. Doer≠grader did its job: claims → checked facts.

## ★★ RESERVED RULING → DEFECT 10 (forward-window validity look-ahead) — class-mandated fix 2026-07-07
**REFRAME (Fable-5): materiality was the wrong gate.** A look-ahead in entry-validity is the cardinal instrument sin —
it makes the backtest measure a strategy live cannot execute, breaking test=ship BY CONSTRUCTION; its materiality is
corpus-and-snapshot-dependent (immaterial on today's 117 says nothing about the next video). **Fix is MANDATED BY
DEFECT CLASS; materiality only governs RETROACTIVE SCOPING.** The A/B ships WITH the fix as its impact report — Defect-4
pattern (fix mandated by class, measurement scopes historical damage).
**DEFECT 10 REGISTERED — class "forward-window validity look-ahead".** Sites: breaker ±3 (`breaker.py:141`), unicorn
±1/±5 (`unicorn.py:97`) from the trace + mitigation.py one-line assert ("likely clean"→"enforced clean") + **census-
populated (do NOT enumerate serially by discovery — the run_class_backtest lesson: 2 sites from 1 trace = the Defects
5-9 signature).**
**THE FIX = STREAMING VALIDITY, not trailing-only.** `valid_at(t) = any BOS in [broken_at−3, min(t, broken_at+3)]` —
flag becomes true the moment a BOS is observed, exactly as live experiences it. Strictly ENTRY-SUPPRESSING
(streaming ⊆ batch at every t), impact bounded to the ≤3/≤5-bar windows, safe-direction. Same construction unicorn ±1/±5.
**Trailing-only REJECTED** (changes archetype semantics; blast radius UNBOUNDED — zone with only-BOS-at-+1..+3 flips
invalid → loses its ENTIRE 30-bar entry window, not just 3 bars). Experiment respecs **batch-vs-streaming**, NOT
forward-vs-trailing.
**FIX OWNER'S FIRST DELIVERABLE = semantics confirmation vs the archetype SOURCE DEFINITIONS; operator RATIFIES before
any implementation (F-2 remediation pattern).**
**RETROACTIVE-MATERIALITY RULING: no certified claim reopens.** Revivals are trade-count findings at 1,000-2,400 trades —
a bounded-window entry-suppressing fix CANNOT zero them; Gate-3 FAIL was arm-symmetric on the same engine (24f57ee
argument stands); null-cal 0/100 is CONSERVATIVE under a performance-inflating defect (if anything strengthened). Standing
pre-re-baseline caveat ("historical equity metrics likely optimistic") EXTENDS to cover Defect 10.
**★ PRE-REGISTERED TRIPWIRE (LOCKED):** if ANY N=9 reference pair OR v2-traded pair changes ZERO/NONZERO status under
the streaming fix → STOP, contradicting-evidence protocol, reference re-derivation question REOPENS. High prior it never
fires (crossover/discount/ORB don't smell like breaker/unicorn consumers) — but whether they route through shared zone
machinery is the CENSUS's fact to state, not assumed.
**SEQUENCING (one synergy): timestamp-emit FIRST + SEPARATE** (never batch a must-be-bit-identical change with a
will-change-outcomes fix — parity check dies). The emit's per-trade timestamps ARE the impact-report instrumentation
(which entries fell in +1..+3 = a read, not a reconstruction). **emit (parity-checked) → forward-window census →
semantics ratification → Defect-10 fix batch via agent-loop → paired impact report (reads pre-registered).** All lands
pre-re-baseline alongside Defects 7/8/9 (which (b)'s sequencing already requires → surviving track inherits the fix).
**CAUSALITY LINT (hardening track, permanent guard):** CI check — no forward index reads in validity computation.
null-cal did NOT catch this and STRUCTURALLY COULDN'T (it guards the pipeline's general self-deception surface, not
archetype-internal causality). This lint is Defect-10's class's permanent guard.
