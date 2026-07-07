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

## ★ FORWARD-WINDOW CENSUS (Defect-10 site enumeration) — BOUNDED to 2 sites 2026-07-07
Grep-level scan of all strategy/indicator/context validity code, manually confirmed. Unlike the run_class_backtest
proliferation (Defects 5-9), Defect-10 does NOT proliferate:
- **Confirmed sites (2):** `breaker.py:151` `range(max(0, broken_at-3), min(n, broken_at+4))` (±3 forward BOS-validity);
  `unicorn.py:97` `range(max(0, b_broken_at-1), min(n, b_broken_at+2))` (±1 displacement; +±5 FVG proximity).
- **NO new forward-window-validity sites** — the `min(n, X+k)` construct appears ONLY at those 2.
- **`detect_swings` (`market_structure.py:39-40`) — CLEAN, not a site.** The only centered rolling window (`center=True`)
  in the engine; it carries the compensating `(index + half_window)` shift ("eliminates lookahead bias"). Confirmed.
- **Zero negative shifts (`.shift(-N)`).** 2 direct future-index hits cleared as false positives (`sys.argv[i+1]` CLI
  parsing; `volume_profile.py:174 sorted_bins[upper_idx+1]` = a PRICE-BIN spatial index, not a future bar).
- **`mitigation.py`** 1-line `entry_bar > bos_bar` assert joins the fix batch ("likely clean" → "enforced clean").
**★ EXISTING PARTIAL GUARD + ITS GAP (where the causality-lint lands):** `src/engine/tests/test_audit_a12.py` ALREADY
audits look-ahead — it asserts NO `center=True`, entries `np.roll`-shifted, HTF `.shift(1)`. But it does NOT check
forward-window VALIDITY loops → that gap is exactly why Defect-10 escaped it. **The causality-lint = EXTEND test_audit_a12
to forbid forward-index reads in validity computation** (not net-new infra). Census-populated site list is now COMPLETE
for the Defect-10 fix batch: breaker ±3, unicorn ±1/±5, mitigation assert. Class is small + bounded — no serial-discovery
tail expected.

## ★ SEMANTICS CONFIRMATION (fix-owner first deliverable, for operator ratification) 2026-07-07
Streaming validity is DEFINITION-PRESERVING (restores intent), not definition-changing:
- **Breaker source def (docstring):** "Enter when price returns to a broken order block, VALIDATED BY BOS AT THE BREAK
  POINT" / "valid ONLY if the OB was broken through WITH a confirmed Break of Structure." → inherently "valid-upon-BOS-
  confirmation." Streaming `valid_at(t)=any BOS in [broken_at-3,min(t,broken_at+3)]` = valid the moment the confirming
  BOS is OBSERVED = faithful to the definition + to what live experiences. Batch (any BOS in full [-3,+3] regardless of
  observation time) is the IMPLEMENTATION SHORTCUT that peeks → the corruption. Streaming RESTORES the definition.
  Behavioral delta ONLY when the sole BOS lands at broken_at+j (j in 1..3) and an entry sits at broken_at+k<j: batch
  admits (peeking), streaming withholds until the BOS prints. Strictly entry-suppressing, bounded <=3.
- **Unicorn source def (docstring):** strict SEQUENCE (swing->OB->break-with-displacement->FVG-during-displacement->
  overlap->enter-on-retrace). ±1 displacement / ±5 FVG windows operationalize "the displacement + FVG that CREATED the
  breaker." Streaming = each sequence element valid upon observation as it unfolds = faithful to the ordered definition;
  batch peeks forward. Same class, bounded <=5.
- **VERDICT (recommended, operator ratifies): streaming = the FAITHFUL operationalization of both archetype definitions;
  the fix RESTORES intended "valid-upon-confirmation" semantics, does NOT change them. No reading of either definition
  intends to condition an entry on a confirmation bar in its own future.** mitigation.py's `entry_bar > bos_bar` assert
  is the same principle made explicit. AWAITING RATIFICATION before implementation (F-2 pattern).

## ★ TIMESTAMP-EMIT CLOSED (Defect-10 sequence step 1) + doer≠grader dividend 2026-07-07
Emit (additive per-trade `entry_idx`+`entry_timestamp`, run_backtest + run_class_backtest) — independent parity review
(fresh context) verdict **CONFORMANT + GREEN**: conformance PASS (22/0 additive, zero computation change), scope-lock
PASS (only backtester.py, concurrent dirty files grep-confirmed unrelated), **PARITY bit-identical to the cent on BOTH
paths** — run_class_backtest 6-trade 15265¢==15265¢ (equity 50152.65==50152.65); run_backtest the reviewer BUILT a real
20-trade DSL fixture (−7025¢==−7025¢, full-float match) → the implementer's trivial 0/0 caveat **RESOLVED, not waved**.
Committed. Per-trade timestamps now available for the impact-report reads.
## ★ NEW FINDING (doer≠grader dividend from the emit review) — event-mask polarity inversion, run_backtest default fallback
While forcing the DSL path to trade, the reviewer found a REAL bug OUT-OF-SCOPE of the emit (untouched): `run_backtest`'s
DEFAULT-FALLBACK event-blackout-mask builder (`backtester.py` ~3870-3945) constructs `True=allow`, but
`generate_signals()` (`signals.py:285-287`) consumes masks as `True=block` (matching `economic_calendar.py::
generate_event_mask`'s documented contract). **Default path (no explicit `event_calendar` supplied) silently BLOCKS
~all entries.** REGISTER for triage (do NOT fix — engine change, needs the pre-change ruling): (1) does PRODUCTION always
supply an event_calendar (→ default path never hit → latent), or can prod hit the default (→ live-impacting)? (2) if
production hits it, this is entry-suppressing (safe-direction) but corrupts backtest edge measurement. Candidate finding,
mechanism-confirmed by the reviewer, production-reachability TRIAGE PARKED.

## ★★ RATIFICATION FOUR-FACT PACKET (launch gate) 2026-07-07
Form-level streaming-validity fix RATIFIED (Fable-5); launch gated on these four facts:
- **FACT 1 — polarity: ALL POSITIVE-EXISTENTIAL, no vetoes.** Breaker (`bos_found=True` iff matching BOS), unicorn ±1
  (`has_displacement=True` iff matching displacement), unicorn ±5 (FVG must-exist-within filter) — all validity-ENABLING.
  → the ⊆ + safe-direction properties HOLD; monotone false→true; veto-inversion risk does NOT materialize. **Load-bearing,
  CLEAN.**
- **FACT 2 — provenance: TWO AXES confirmed (your suspicion right).** `broken_at` (order_flow.py:110/221) = break-EVENT
  bar; `bos` (market_structure.py:86 `detect_bos(df, swings)`) = derived from the confirmation-time-shifted SWING layer.
  The ±3 spans break-event-time vs confirmation-derived-BOS-time. **Fix consequence:** apply streaming on the axis where
  `bos_list[j]` is OBSERVABLE; re-derive the window arithmetic there, NOT naively on `broken_at`. Exact `bos_list[j]`
  observability (already-confirmation-shifted → knowable at j, or needs data past j?) = the fix owner's FIRST-LINE
  derivation, ratified before code.
- **FACT 3 — decision-timing:** backtester.py:72-93 next-bar-fill (signal from bar N data, np.roll +1 → fill N+1).
  Decision uses data THROUGH t (close). → pins `min(t, broken_at+3)`, NOT `min(t-1, +3)`.
- **FACT 4 — source:** windows are IMPLEMENTATION SLACK around definitional "at the break" (breaker docstring "validated
  by BOS at the break point") / "during the displacement" (unicorn ordered sequence), uncited to ICT. → streaming
  PRESERVES the definition (removes the forward peek the slack allowed), does NOT redefine.
**NET: facts 1/3/4 clean; fact 2 shapes the fix spec (observability-axis application + re-derived arithmetic = fix
owner's first line). Ratification packet complete.** Plus the form-level ratified elements: streaming class (monotone,
inherits engine bar-close convention), mitigation `entry_bar > bos_bar` strict assert, causality-lint (whitelist the
centered-window-then-shift construction — target is forward reads in validity, NOT correctly-reindexed centered windows),
and the new acceptance INVARIANT: run both engines, assert per-pair streaming-trade-set ⊆ batch-trade-set (verified, not
claimed). Tripwire armed (any N=9 or v2-traded pair zero/nonzero flip → STOP + re-derive).

## ★★ DEFECT-10 FIX BATCH — RATIFIED + LAUNCHED (2026-07-07)
Two batch-spec additions (Fable-5, both closing holes the packet opened):
1. **Axis derivation needs an EMPIRICAL leg (truncated-replay receipt), not just a code-read.** "Is `bos_list[j]`
   knowable at bar j?" → for a sample of BOS events, recompute detection using ONLY data through bar j (truncated-history
   replay) and check the BOS list is IDENTICAL to the full-history computation at index j. Identical → confirmation-
   shifted as designed, streaming applies at j directly. Any BOS at j only-with-future-data → observability lag is real,
   window arithmetic must carry it. **Step-1 deliverable = derivation + truncated-replay verification → operator ratify
   → then code.** (Same move as F-2's flip-enumeration: the derivation ships with its own receipt.)
2. **⊆ invariant read pre-registered (two failure flavors, separately labeled):** per-pair `streaming_trades ⊆
   batch_trades`. (a) a trade in streaming ABSENT from batch = fix-logic BUG (monotone validity can't admit what batch
   rejected — Fact 1 guarantees) → FAILS the batch. (b) identical trade sets with DIFFERENT entry bars = expected/fine
   for entries at +4 onward, SUSPECT for entries formerly inside the window. Re-review checks BOTH, separately labeled —
   without the split, "⊆ holds" could read green while entry-timing drift hides inside it.
**Batch sequence (launched):** axis-derivation + truncated-replay receipt → OPERATOR RATIFY → streaming implementation
(breaker + unicorn on the ratified axis) + mitigation `entry_bar > bos_bar` strict assert + `test_audit_a12` causality-
lint extension (whitelist centered-window-then-shift) → re-review (split ⊆ invariant verified per-pair) → paired
batch-vs-streaming impact reads vs `c948bcd` timestamps (fraction + win-rate-delta on +1..+3 = Defect-10 materiality
RECEIPT, documentation not precondition). Tripwire ARMED (any N=9 or v2-traded zero/nonzero flip → STOP + reopen
reference under contradicting-evidence protocol).

## STANDING LAUNCH PROTOCOL (register — held 3× running) 2026-07-07
The F-2 line — **staged, not started; ratification NEVER inferred from the packet landing** — has held three times
(F-2 remediation, timestamp-emit, Defect-10). No longer a lesson; it is the PROGRAM'S STANDING LAUNCH PROTOCOL: any
instrument-touching change stages its full spec, produces its ratification packet, and waits for EXPLICIT ratification
before code — the packet landing is never the authorization. Write into the discipline docs when next touched. → also memory.

## ★ AXIS-DERIVATION RECEIPT (Defect-10 fix batch step 1, for ratification) — L=0 CONFIRMED 2026-07-07
**VERDICT: confirmation-shifted — `bos_list[j]` knowable at bar j; streaming applies at j directly. Observability lag
L = 0.** Fact 2's two-axis subtlety resolves favorably: no window-arithmetic lag term needed.
- **Leg 1 (code-read):** `detect_swings` centered window + `+half_window` shift; `detect_bos` advances swing pointers
  with STRICT `<` (swing at shifted index s active only for bars i>s). So `bos_list[j]` = f(close[j], swing confirmed
  at ≤ j-1) — all inputs in [0,j]. HIGH confidence.
- **Leg 2 (empirical truncated-replay RECEIPT):** each BOS recomputed on `df[:j+1]` vs full history — **78 BOS events /
  6 datasets, 78 IDENTICAL, 0 lagged** (production lookback=5 + test 2/3/4). Receipt scripts in scratchpad
  (`bos_observability_receipt.py`, `bos_receipt_adversarial.py`, reproducible, lightweight polars only, no backtester).
- **Fix implication (facts):** `valid_at(t)` indexes `bos_list` directly by bar → NO `+L` offset; `min(t, broken_at+3)`
  stands (Fact 3 pin holds); **do NOT add another `half_window`** (shift already paid — double-count would push validity
  later than the code observes). `broken_at` is the same exec-bar axis.
- **Boundary caveat (ratification):** L=0 holds for `detect_swings`/`detect_bos` AS breaker/unicorn call them today
  (`bos = detect_bos(df, detect_swings(df, swing_lookback))`); a future refactor to a non-centered/differently-shifted
  swing basis needs re-measurement. AWAITING RATIFICATION → then streaming implementation.

## ★★ DEFECT-10 BATCH — RATIFIED, FINAL SCOPE, IMPLEMENTING (2026-07-07)
Axis receipt ratified (L=0, both legs agree; truncated-replay killed the hidden-lag counter-case on data). Second-order
dividend noted: `detect_bos`'s strict `<` pointer advance makes the swing layer conservative by one bar at the
CONSUMPTION boundary too — the exoneration deepens.
**Boundary caveat → CONTRACT ASSERTION (teeth, not footnote):** "L=0 holds for the contract as called today" is the kind
of true-now statement that rots silently — a future non-centered swing refactor would reintroduce the look-ahead
INVISIBLY, downstream, passing all its own tests. So L=0 becomes a CHECKED INVARIANT: a miniature truncated-replay
fixture (handful of BOS recomputed on truncated history, asserted identical) in CI PERMANENTLY; if the swing basis
changes it fails with "re-derive the observability axis before trusting streaming validity." Documenting-an-assumption →
enforcing-one (this program's whole defect history is documented-but-unenforced assumptions).
**FINAL BATCH SCOPE (implementing):** (1) breaker streaming `valid_at(t)=any matching BOS in [broken_at-3,min(t,broken_at
+3)]` (direct bar-index, no lag term) + unicorn analogous ±1/±5; (2) mitigation.py strict `entry_bar > bos_bar` assert;
(3) test_audit_a12 lint extension (forbid forward-index reads in validity; WHITELIST centered-window-then-shift);
(4) **L=0 contract fixture** (truncated-replay CI test, the caveat's permanent form). Then fresh-context re-review:
⊆ invariant BOTH flavors (streaming-absent-from-batch = set-membership BUG → fail outright; same-set-different-entry-bar
= fine at +4, labeled-suspect in-window). Then paired impact reads vs `c948bcd` timestamps; tripwire ARMED.
**IMPACT-REPORT PRE-READ (locked before numbers):** the WIN-RATE DELTA on the +1..+3 (peeked) entries is the
retro-scoping number. Higher-win-rate peeked → historical equity inherits another "optimistic" annotation (alongside
Defect 4); flat delta → look-ahead real but NON-EXPLOITATIVE, annotation says so. **Both readings pre-registered
acceptable; neither reopens certified TRADE-COUNT findings absent the tripwire firing. The receipt SCOPES, does not
re-litigate.**

## ★★ DEFECT-10 IMPLEMENTATION — doer≠grader FINDING revises the ratified ⊆ invariant (2026-07-07)
Batch implemented (breaker+unicorn streaming valid_from threaded via `compute_breaker_signals` `if i<valid_from:continue`;
mitigation strict `i<=bos_bar` gate; test_audit_a12 lint whitelisting centered-shift by construction; L=0 truncated-replay
contract fixture). 203 engine tests pass; NOT committed. Implementer flagged (grading-integrity, not blanket-PASS):
**THE RATIFIED ⊆ INVARIANT IS LEVEL-DEPENDENT:**
- **Raw candidate level (per-bar/per-zone): streaming ⊆ batch HOLDS, provably monotone** (only change = `if i<valid_from:
  continue`, never False→True; verified `{39,43,44}⊇{43,44}`).
- **Realized-trade level: ⊆ FAILS, 1/40 (breaker seed=32)** — a streaming-ONLY trade at bar 43 absent from batch.
- **Root cause (diagnosed):** batch admits an illegitimate look-ahead-tainted trade at bar 39 (BOS confirms at 41, inside
  window — THE Defect-10 bug), which OCCUPIES the single-position state machine and BLOCKS bar 43's LEGITIMATE non-look-
  ahead retest. Streaming suppresses the bug-trade at 39, stays flat, legitimately takes 43. So the ⊆ violation is
  **the fix WORKING** (freed a legitimate trade the bug's occupancy suppressed), NOT admitting-what-batch-rejected.
**IMPLICATION — revises the ratified acceptance invariant.** Flavor-(a) as ratified ("streaming-absent-from-batch = bug →
fail outright") would FAIL a CORRECT fix. Trade-level ⊆ is the WRONG level: monotonicity lives at the RAW-CANDIDATE level;
a strictly-narrower gate on a single-open-position sequential machine can RELOCATE/FREE trades, not only remove them.
**OPERATOR RULING NEEDED (revised invariant):** correctness check = RAW-CANDIDATE-level ⊆ (monotone, holds); realized-
trade-level differences DIAGNOSED per-case (occupancy-freed-legitimate = OK; genuine admit-what-batch-rejected = bug).
Unicorn 40/40 clean (its valid_from rarely exceeded formed_at in the fixtures; isolated deterministic proof confirmed the
gate suppresses correctly when it binds). HOLDING for the ruling before re-review + accept — the re-review's acceptance
criterion is exactly what's in question. (Finding is a CLAIM — independent re-review still verifies seed=32 + raw-⊆ + impact.)
