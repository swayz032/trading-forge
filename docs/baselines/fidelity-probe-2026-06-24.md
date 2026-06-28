# Fidelity Probe — 2026-06-24 (the decisive negative result)

> Cheap semantic fidelity test (no backtest infra): for 3 EXECUTABLE strategies, would the COMPILED
> logic fire the trades the educator NARRATES in their own video? Graders compared compiled logic vs
> the educator's walked-through example entries, classifying mismatches. **Result: 3/3 SYSTEMATIC_DIVERGENCE.**
> Per the operator decision tree → **fidelity is now the highest-priority problem; 3C.3 is PAUSED.**

## Result

| strategy | video type | compiled `entry_condition`/`entry_params` | verdict | dominant mismatch |
|---|---|---|---|---|
| O9czLS8lv4U | ICT order-block (EURUSD London) | null / {} | SYSTEMATIC_DIVERGENCE | CONTEXT/DIRECTION + TIMING/CONFIRMATION + LEVEL |
| yAMaiOI9cmc | ORB-retest w/ FVG (named "order_block") | null / {} | SYSTEMATIC_DIVERGENCE | LEVEL (wrong archetype) + CONFIRMATION |
| sv-ixHXUTSQ | ORB + 9/20 EMA (US open) | null / {period:20} | SYSTEMATIC_DIVERGENCE | CONTEXT + CONFIRMATION + LEVEL |

**0/3 would reproduce the educator's own demonstrated entries.**

## The common root cause (structural, not bad luck — all 3 share it)

**"Compilable" only verifies that the `entry_indicator` resolves to *some* archetype (or has params/condition). It does NOT verify the archetype actually implements the mechanic the educator taught.** Three layers of the gap:

1. **Entry logic is never compiled.** All 3 have `entry_condition: null` and empty/near-empty `entry_params`. The real nuance lives only in the prose `entry_sequence` checklist — which the engine does NOT execute. The resolved archetype runs its OWN generic logic, ignoring the prose.
2. **The resolved archetype is generic or WRONG.**
   - yAMaiOI9cmc: video teaches **opening-range-retest + FVG**, but extraction named it `order_block` → the order_block detector keys on a structurally different level than the OR-low the educator retests → would never fire at the educator's entry.
   - O9czLS8lv4U: the load-bearing mechanics (bias derived from BOS→CHoCH, **Asia-session-low POI**, **1-minute MSS displacement confirmation**) are absent; the generic archetype would fire on the 5m OB the educator explicitly says NOT to take ("don't just take a risk entry").
3. **A real session bug:** sv-ixHXUTSQ compiled `session = LONDON_KILLZONE 02:00–05:00 ET`, but the educator's two examples are both the **US open (~09:30 ET)** → even a correct trigger would be filtered out of the exact bars demonstrated. (Layer 3A session mis-fire — investigate.)

## What this means

- The **0% false-compilation** result (Stage 2) stands and is real — no NULL-trigger strategy ships. BUT "compilable" ≠ "faithful." A strategy can resolve to a real archetype that is generic/wrong and still not trade like the video.
- The **43% compilable / 52% placeable** Stage-2 numbers **overstate backtest-readiness.** Fidelity-adjusted, the genuinely-faithful rate on this probe is **0/3.**
- The honest answer to "how far from 100% honest YouTube extraction for backtesting" is **further than the executability numbers implied** — the gap is at the EXECUTION-FIDELITY layer, which is now located precisely.

## Decision (per operator's tree)

- **3C.3 PAUSED.** Building more archetypes would mass-produce more executable-but-unfaithful strategies. The probe did its job: found the real bottleneck before the investment.
- **Fidelity is the highest-priority problem.** The fix is not "more archetypes" — it's closing the gap between "routed to an archetype" and "the archetype reproduces the taught mechanic." Candidate directions (to scope next):
  1. **Fidelity gate** — quarantine when the compiled archetype's behavior diverges from the educator's narrated examples (extend the compilability gate from "archetype exists" to "archetype matches").
  2. **Compile the entry_sequence prose into real conditions** (so the engine executes the taught nuance, not a generic archetype default).
  3. **Archetype-match check** — reject `order_block` for an ORB video (the named indicator must match the taught mechanic).
- **Confirm systematic** — 3/3 with a shared root cause is strong, but run the probe on 2-3 more executables to be certain it's structural (expected: yes).

## CONFIRMATION ROUND (expanded to 6 — frozen second baseline)

3 more executables across families to test whether the pattern is structural or a failure family:

| strategy | family | `entry_condition`/`params` | verdict | mismatch |
|---|---|---|---|---|
| TMVHO4sgo70 | ICT order-block (bullish) | null / {} | PARTIAL_MATCH | CONFIRMATION (return-TO vs trade-THROUGH opening price / missing CISD) + direction metadata incoherence (`both` vs `LONG_ONLY`) |
| 2u9oYfx5xdY | order-block (HTF→5m CHoCH) | null / {} | UNVERIFIABLE | CONFIRMATION — the 5m CHoCH gate that separates the educator's explicit NO-TRADE tap from his TRADE tap is not encoded → can't discriminate → would OVER-fire |
| iU8ww5MC2FQ | 4h-candle-box (different family) | null / {} | SYSTEMATIC_DIVERGENCE | CONFIRMATION + LEVEL — 50-step transcript dump, no box/zone/trigger compiled |

**6-VIDEO TALLY: 0 STRONG_MATCH · 4 SYSTEMATIC_DIVERGENCE · 1 PARTIAL · 1 UNVERIFIABLE. Dominant mismatch on ALL 6 = CONFIRMATION.** Pattern is UNIVERSAL across order-block / ORB / 4h-box families → fidelity is unquestionably the primary bottleneck (operator's "5-6/6" threshold met).

**The proven root cause (one sentence):** the entry trigger is never compiled — `entry_condition: null` + `entry_params: {}` on all 6; the educator's differentiating CONFIRMATION event (CISD break-through-opening-price, 5m CHoCH, chain-of-state close, breaker-block rebalance, displacement) lives only in the prose `entry_sequence`, so the resolved archetype runs its own generic logic and **arms on a passive level-touch instead of the active confirmation** → fires earlier/looser than the educator and, in at least one case, takes setups the educator explicitly rejects (over-firing).

**Sub-findings to fix:** wrong-archetype assignment (order_block named for an ORB video), session mis-parse (US-open compiled as London), direction metadata incoherence (`both` vs `LONG_ONLY`), and `entry_sequence` being a transcript dump (27-50 steps) rather than a strategy spec.

→ See the fidelity fix design: `docs/designs/fidelity-design.md`.

## PHASE 1 RE-GRADE (confirmation-event compiler) — diagnosis VALIDATED

After building `confirmation-compiler.ts` (Fidelity Phase 1), re-graded 3 of the 6 (spanning the
baseline's PARTIAL / UNVERIFIABLE / SYSTEMATIC) with the confirmation predicate made the explicit entry
trigger:

| strategy | baseline | after Phase 1 | delta |
|---|---|---|---|
| TMVHO4sgo70 | PARTIAL_MATCH | **STRONG_MATCH** | `close_through`@opening_price = the CISD; passive-return over-fire removed |
| 2u9oYfx5xdY | UNVERIFIABLE | **PARTIAL_MATCH** | `structure_shift` now fires the TRADE tap AND rejects the NO-TRADE tap (over-fire closed) |
| sv-ixHXUTSQ | SYSTEMATIC_DIVERGENCE | **PARTIAL_MATCH** | `close_through`@opening_range = the ORB break; over-fire removed |

**3/3 improved · STRONG_MATCH 0→1 · UNVERIFIABLE 1→0 · over-firing fixed in both cases that had it · FALSE COMPILATIONS still 0** (the compiler only ever makes triggers stricter). **Diagnosis CONFIRMED: the missing confirmation event was the dominant source of fidelity divergence** (operator's falsification test passed — the frozen set improved materially).

**Residuals are now specific + debuggable** (shifted from "no executable logic"):
- 2u9 → directional-mapping in `structure_shift` (swing-HIGH break for longs / swing-LOW for shorts must be explicit, not one quote).
- sv-ix → the SESSION bug (London vs US-open) — a SEPARATE Layer 3A mis-parse, NOT a confirmation issue; next fix.
- Known limit: punctuation-less transcripts yield imprecise evidence QUOTES (kind+level still detect correctly).

**Next:** (a) directional-mapping refinement in structure_shift, (b) fix the Layer 3A session mis-parse (US-open→London), (c) re-grade the full 6 + wire the confirmation predicate into the fidelity gate. 3C.3 stays paused.

## PHASE 1 RESIDUAL FIXES (structure_shift directional mapping + session frequency-vote + windowing)

Fixed the 2 named residuals from the first re-grade + their shared root cause (punctuation-less
transcripts → `text-windows.ts`). Re-graded the 2 affected:

| strategy | original | Phase 1 v1 | after residual fixes |
|---|---|---|---|
| sv-ixHXUTSQ | SYSTEMATIC | PARTIAL | **STRONG_MATCH** — session fixed (London→NY 09:30 ORB via keyword-frequency vote); both demonstrated entries now fire on close_through@range |
| 2u9oYfx5xdY | UNVERIFIABLE | PARTIAL | **PARTIAL** — directional_rule now correct (long=break-above / short=break-below); correctly rejects the no-trade BECAUSE of the direction fix |

**Cumulative: STRONG_MATCH 0 → 2 (TMVHO, sv-ix); 1 PARTIAL (2u9); FALSE COMPILATIONS still 0.**

**2u9's deeper residual (the named next problems):** (1) PROVENANCE — `evidence_quote` + entry_sequence steps still cite the educator's own INVERTED recap line ("breaks below a swing low for long entry") that contradicts the now-correct directional_rule (the transcript contains both the correct live phrasing and the sloppy recap). (2) CONFIRMATION STRENGTH — the educator's no-trade was a WEAK/unclear CHoCH ("slight reaction… not the confirmation we wanted"); the compiler models confirmation DIRECTION but not QUALITY, so it would not reject a clean-but-low-quality same-direction CHoCH. Confirmation-strength is a genuinely deeper fidelity dimension (Phase 2 candidate), not a regex fix.

**Next per operator sequence:** re-run the FULL 6 fidelity set (not just the 3 touched) → then a small UNSEEN fidelity set (the "locally vs generally correct" test). Phase 1 verdict: the confirmation lever is proven causal — 2 STRONG recovered, safety invariant held.

## CLOSED-WORLD FINAL MATRIX (all 6 re-graded under current logic, 5-axis)

The full frozen-6 re-graded on the operator's 5 fidelity axes (PASS / PARTIAL / FAIL):

| video | direction | session | conf-EXISTS | conf-STRENGTH | provenance | OVERALL |
|---|---|---|---|---|---|---|
| TMVHO4sgo70 | PASS | PASS | PASS | PASS (CISD) | PASS | **STRONG** |
| sv-ixHXUTSQ | PASS | PASS (NY 9:30) | PASS | PARTIAL (full-body vs close) | PASS | **STRONG** |
| 2u9oYfx5xdY | PASS | PASS | PASS | FAIL (no-trade quality) | FAIL (inverted quote) | **PARTIAL** |
| O9czLS8lv4U | PASS | FAIL (Asia POI hardcoded as traded session; educator trades London) | PASS | PARTIAL (drops displacement + 1m refinement) | FAIL (quote = the sweep, not the MSS) | **PARTIAL** |
| iU8ww5MC2FQ | PASS | PARTIAL | PASS | FAIL (generic break loses box/zone/breaker legs) | PARTIAL | **PARTIAL** |
| yAMaiOI9cmc | PASS | PASS | PASS | FAIL (WRONG level: structure_shift@prior_swing vs the OR-low retest + FVG) | FAIL (quote = a failed-setup counter-example) | **SYSTEMATIC** |

**Overall tally: 2 STRONG · 3 PARTIAL · 1 SYSTEMATIC · 0 UNVERIFIABLE** (baseline was 0 / 1 / 4 / 1).

### Axis aggregate — WHERE the system is correct vs failing (the diagnostic)

| axis | result | status |
|---|---|---|
| DIRECTION | 6/6 PASS | ✅ **SOLVED** (directional_rule fix generalizes) |
| CONFIRMATION EXISTENCE | 6/6 PASS | ✅ **SOLVED** (confirmation is always compiled now — the Phase 1 core win) |
| SESSION | 4 PASS / 1 PARTIAL / 1 FAIL | mostly solved; 1 NEW bug (O9cz: a POI level hardcoded as the traded session_window) |
| **CONFIRMATION STRENGTH** | 2 ok / 1 PARTIAL / 3 FAIL | ❌ **dominant remaining failure axis** |
| PROVENANCE | 2 PASS / 2 PARTIAL / 2 FAIL | ❌ secondary failure (evidence_quote ≠ compiled trigger) |

### Answer to "is confirmation strength the final primitive, or another surface symptom?"

**It is a surface label for a deeper layer — it decomposes into THREE distinct sub-problems, not one primitive:**

1. **Confirmation SELECTION (the biggest)** — the compiler grabs the highest-priority GENERIC confirmation (`structure_shift@prior_swing`) even when the educator's actual trigger is a *specific* event+level (yAMaiOI: a retest of the **opening-range-low + FVG**, not a swing break; O9cz: the **Asia-low POI + 1m displacement**, not a generic MSS). Right *kind* ≠ right *trigger*. This is a level/event-selection problem, and it's why yAMaiOI stayed SYSTEMATIC.
2. **Multi-leg confirmation** — the educator's A+ entry is a 2-3 step sequence (iU8: chain-state-close **+** breaker-rebalance **+** 25-50% optimum zone; 2u9: CHoCH **+** "clear/not-weak" quality). The compiler emits ONE leg and drops the rest.
3. **PROVENANCE / quote selection (confounder)** — the evidence_quote often doesn't match the compiled rule (2u9 cites the educator's *inverted* recap; yAMaiOI cites a *failed-setup counter-example*; O9cz cites the passive sweep, not the MSS). A correct trigger with a bad quote grades worse than it is — so fixing quote-selection is cheap and would clarify the true strength picture.

Plus 1 new SESSION bug (O9cz: POI-level vs traded-session conflation).

**Phase 2 targets, in priority order:** (a) confirmation SELECTION — when a higher-specificity event+level (retest@named-level + confluence) is present in the source, prefer it over the generic structure_shift; (b) PROVENANCE — quote-selection must pick the window matching the compiled rule's direction/event (exclude counter-examples / failed-setup sentences); (c) multi-leg confirmation sequences; (d) the O9cz POI-vs-session fix. The two SOLVED axes (direction, confirmation-existence) need no further work.

## PHASE 2A RE-GRADE (specificity-ranked selection + SCL telemetry) — last SYSTEMATIC eliminated

Built `specificity-score.ts` (trigger specificity + SCL) + rewrote compiler selection: emit every
matching kind per window as COMPETING candidates, rank by INTRINSIC specificity (resolved level + own
confluence + kind rarity, not ambient run-on text). SCL shipped as telemetry; hard gate default-OFF
(`SCL_GATE_ENABLED`) until calibrated.

| video | before 2A | after 2A | note |
|---|---|---|---|
| yAMaiOI9cmc | SYSTEMATIC | **STRONG_MATCH** | now compiles `retest_reject@opening_range_edge + fair_value_gap` = the educator's exact OR-low-retest+FVG entry (was generic structure_shift@prior_swing) |
| O9czLS8lv4U | PARTIAL | PARTIAL (no regression) | `displacement` = the more faithful of its 2 legs; residual = conjoined MSS+displacement (2B) + level anchor (2D) |
| TMVHO / sv-ix | STRONG | STRONG | unchanged (close_through, SCL 0) |
| 2u9 / iU8 | PARTIAL | PARTIAL | unchanged; residual = multi-leg (2B) |

**FULL-6 AFTER 2A: 3 STRONG · 3 PARTIAL · 0 SYSTEMATIC · 0 UNVERIFIABLE** (was 2/3/1/0). Acceptance met:
STRONG 2→3, **FALSE COMPILATIONS stayed 0** (gate off; nothing quarantined). **The last SYSTEMATIC case is gone.**

**Key convergence:** all 3 remaining PARTIALs share ONE residual — **multi-leg** (the educator's trigger
is 2-3 conjoined legs; the compiler captures one). That is exactly **Phase 2B** (multi-leg preservation +
contradiction detector). 2A cleanly teed up 2B. Phase 2D (O9cz session/level anchor) + 2C (provenance) remain.

## PHASE 2B (compound multi-leg) — representation shipped + a key trap avoided; NEW residual class found

Built the compound IR (`compileConfirmationCompound`): one leg per confirmation-bearing entry_sequence
step → ordered `CompoundConfirmation {predicate_type, operator SEQUENCE|AND, legs[], enforcement, primary_order}`
+ contradiction detector (MISSING_LEG / LEVEL_LOSS). Frozen-6 multi-leg: yAMaiOI `close_through@OR →
retest@OR`; iU8 `displacement → retest@order_block`; O9cz 3 legs incl MSS+displacement; TMVHO/sv-ix/2u9 single.

**The trap (caught by re-grade):** a naive MANDATORY ordered sequence REGRESSED yAMaiOI STRONG→PARTIAL —
the educator demonstrated TWO shorts; only one had a close-through breakdown before the retest. Hard-
requiring every leg drops the other demonstrated winner. **Educators STATE a canonical sequence but
DEMONSTRATE variants** → hard-gating all legs blocks winners (the §13 expensive error).

**Fix:** `enforcement` field, default **`primary_plus_confluence`** — the PRIMARY (highest-specificity
entry) leg is the firing condition; preceding legs are recorded confluence/context, NOT hard gates.
`all_required` only when the educator uses explicit gating language (only/must/no-trade-unless). Re-grade
confirmed: yAMaiOI **restored to STRONG** (primary retest fires both shorts; close-through = confluence).

**Matrix after 2B: 3 STRONG · 3 PARTIAL · 0 SYSTEMATIC** (same count as 2A but RICHER representation + no
regression). The predicted 5-STRONG did NOT materialize — because the remaining PARTILs are blocked by a
**DIFFERENT primitive than multi-leg:**
- iU8, O9cz → **zone/context gates** (iU8's 4h-box 25-50% optimum zone; O9cz's Asia-low POI). The
  educator's entry is valid only WITHIN a zone — that's a *where-valid context*, NOT a confirmation event,
  so the confirmation compiler structurally can't represent it. **NEW residual class (a future phase).**
- 2u9 → confirmation STRENGTH (clean vs weak CHoCH), not multi-leg — stayed single-leg.
- O9cz → also level anchor (Phase 2D).

**2B verdict:** multi-leg was necessary, shipped, and avoided a regression — but NOT sufficient for the
remaining PARTILs, which need a **zone/context-gate primitive** (the next real bottleneck) + confirmation-
strength + the 2D anchor. The compound IR + the primary_plus_confluence enforcement principle are the
durable wins.

## PHASE 3A (zone/context-gate primitive) — iU8 PARTIAL→STRONG; the WHERE axis works

Built `context-gate.ts` (`scanContextGates` + representability T1/T2/T3 + gate specificity + the T1/T2
`evaluateContextGate` WHERE-evaluator) and wired `context_gates[]` into the compound result with the
fail-closed T3-required quarantine. Frozen-6 recovery (no false quarantines after precision-hardening):
iU8 `zone:optimum_zone(T1, 0.25-0.50, req)`; O9cz `poi:asia_low(T2, req)` + LONDON; sv-ix/2u9/yAMaiOI light gates.

| video | before 3A | after 3A | |
|---|---|---|---|
| iU8ww5MC2FQ | PARTIAL | **STRONG_MATCH** | optimum_zone gate fixes the over-fire; WHERE(25-50% box) ∧ WHEN(displacement→retest@OB) match the educator |
| O9czLS8lv4U | PARTIAL | PARTIAL (improved) | Asia-low POI + LONDON recovered (WHERE closed); remaining residual = **Phase-2D level anchor** (grader-confirmed): displacement.level_ref=null not positionally coupled to the POI; ASIA-formation vs LONDON-execution session conflation; asia_high mis-typed as gate (it's the TP target) |

**MATRIX AFTER 3A: 4 STRONG · 2 PARTIAL · 0 SYSTEMATIC · 0 UNVERIFIABLE** (was 3/3). Acceptance met:
context steps recovered, T1/T2 evaluator built, T3-required quarantines, **FALSE COMPILATIONS 0** (zero
false quarantines — precision-hardened: zones need real bounds/quadrant, named-levels only, strong-gating `required`).

**New minor findings for 2D/gate-precision (under-fire, not over-fire — non-blocking):** iU8 `regime:ranging`
is arguably wrong-signed (educator wants strong-impulse); strict 0.25-0.50 excludes the educator's
premature-zone second-entry; O9cz `asia_high` mis-typed as a required gate when it's the TP target.

**Trajectory on the operator's forecast:** 3A → iU8 STRONG. **2D** (level anchor + POI/session role + target-vs-gate)
→ O9cz STRONG = **5 STRONG / 1 PARTIAL**. **3B** (confirmation-strength) → 2u9 STRONG = 6 STRONG. On track.

## PHASE 2D (level anchor + session split + level-role typing) — O9cz PARTIAL→STRONG; 5 STRONG / 1 PARTIAL

Three deterministic structural fixes closed O9cz's three residuals (grader-confirmed all three):
- **2D-A anchor binding** — `ConfirmationLeg.anchor_ref` couples spatial legs to a WHERE anchor; O9cz
  displacement + structure_shift now bound to `asia_low` (was level_ref=null, uncoupled). PRIMARY spatial
  leg with no anchorable level → hard-fail `leg_anchor_missing`.
- **2D-B session role split** — `SessionRole formation|execution`; O9cz = ASIA:formation (POI forms) +
  LONDON:execution (trade), no longer conflated.
- **2D-C level-role typing** — `LevelRole {entry_anchor|gate|target|stop_anchor}`; O9cz `asia_high` is now
  role=target (the TP), not a required validity gate (fixed the self-contradictory both-ends-required encoding).

**MATRIX AFTER 2D: 5 STRONG · 1 PARTIAL · 0 SYSTEMATIC · 0 UNVERIFIABLE** (was 4/2). O9cz→STRONG; the 4
prior STRONG unchanged (no regression); 0 false quarantines. Acceptance met (anchor binding / session
semantics / level roles / zero degradation). Only remaining PARTIAL = **2u9**, blocked solely by
confirmation-STRENGTH (clean vs weak CHoCH) = **Phase 3B (the HOW axis)** — the last ontology dimension.

### Fidelity journey (frozen-6, end to end)
baseline 0 STRONG / 1 PARTIAL / 4 SYSTEMATIC / 1 UNVERIFIABLE → Phase 1 (confirmation compiler) → 2A
(specificity selection: SYSTEMATIC→0) → 2B (multi-leg + enforcement) → 3A (zone/context gates: iU8→STRONG)
→ 2D (anchor/session/role: O9cz→STRONG) = **5 STRONG / 1 PARTIAL / 0 SYSTEMATIC / 0 UNVERIFIABLE**, FALSE
COMPILATIONS held at 0 the entire way. Ontology: WHICH(2A) · WHAT(2B) · WHERE(3A) · anchoring(2D) shipped;
HOW(3B) is the last piece for 2u9.

## PHASE 3B (confirmation-strength scorer — the HOW axis) — 2u9 PARTIAL→STRONG; FROZEN-6 = 6 STRONG

Built `confirmation-strength.ts` (Layer A features → Layer B weighted score → Layer C weak/medium/strong)
+ `detectStrengthRequirement` (educator demands clean/decisive, or rejects weak "slight reaction… not the
confirmation we wanted" = the no-trade tap) + `meetsStrengthRequirement` (signal-time). The primary leg now
carries `strength_requirement`; a weak CHoCH (the no-trade tap) fails it, a clean one fires — representing
2u9's trade-vs-no-trade discrimination the compiler previously couldn't (it captured CHoCH direction, not quality).

2u9 PARTIAL→**STRONG** (grader): the discrimination is faithfully represented; the 5 prior STRONG carry
additive strength metadata with NO regression (0 quarantines). Continuous scorer, interpretable (NOT ML —
one residual isn't enough to learn). Caveat (grader): the "strong" THRESHOLD is system-chosen and the scorer's
calibration on the actual demonstrated candles is unverifiable from static extraction — it needs real bar
features at signal-time (the SAME engine-wiring gap as context gates → folds into Part 2 replay validation).

**FROZEN-6 FINAL: 6 STRONG · 0 PARTIAL · 0 SYSTEMATIC · 0 UNVERIFIABLE.** FALSE COMPILATIONS = 0 throughout.

### The complete fidelity arc + ontology
```
baseline: 0 STRONG · 1 PARTIAL · 4 SYSTEMATIC · 1 UNVERIFIABLE   ("compilable" ≠ "faithful")
 Phase 1  confirmation compiler ............ the trigger is finally compiled
 2A  specificity selection ................. SYSTEMATIC 4→0   (WHICH fires)
 2B  multi-leg + primary-plus-confluence .... compound IR     (WHAT confirms)
 3A  zone/context gates + integration ....... iU8 → STRONG    (WHERE valid)
 2D  anchor + session-split + level-roles ... O9cz → STRONG   (anchoring)
 3B  confirmation-strength scorer ........... 2u9 → STRONG    (HOW strong)
NOW: 6 STRONG · 0 PARTIAL · 0 SYSTEMATIC · 0 UNVERIFIABLE
```
Ontology COMPLETE: WHICH(2A) · WHAT(2B) · WHERE(3A) · anchoring(2D) · HOW(3B). The extraction compiler is
no longer the bottleneck — every frozen-6 educator strategy now compiles to a faithful, executable representation.

### Remaining (NOT frozen-6 fidelity — live-proof + generalization)
1. **Engine attach Part 2** — context gates + strength scorer → live signal path + Python mirror + parity +
   **backtest-replay** (proves gates/scorer actually fire correctly on real bars; closes the grader's 2u9
   calibration caveat). The compiler is standalone extraction-side today.
2. **Generalization** — the frozen-6 is now effectively the CALIBRATION set; re-run on a fresh UNSEEN set to
   prove the 6 primitives generalize (don't overfit to 6 examples). This is the highest-value next epistemic check.
3. SCL hard-gate calibration.

## ★ BLIND GENERALIZATION (unseen set) — FALSIFIED: frozen-6 did NOT generalize

Ran the full compiler (selection + multi-leg + gates + anchor + strength) on 32 UNSEEN videos (primitives
tuned ONLY on the frozen-6). Deterministic: 14 compiled / 18 quarantined; NO new quarantine reasons, no
crashes (vocabulary covered every case); primitives activate broadly (gates 11/14, strength 10/14, multileg
6/14, anchor 6/14). Then BLIND-graded a sample (grader given no expected result / no frozen-6 history / no
primitive names):

- **Compiled (8 graded): 0 STRONG · 2 PARTIAL · 6 SYSTEMATIC.**
- **Quarantined (3 sampled): 3 of 3 = FALSE_QUARANTINE** (real executable strategies wrongly rejected).

Against the operator's bar (≥85% STRONG · 0 SYSTEMATIC · 0 false-comps) this FAILS on every axis. The
frozen-6 "6 STRONG" was a CALIBRATION-set result; the architecture is NOT general.

**The failures collapse into ONE dominant missing primitive (Case C — new primitive), not chaos:**

> **ZONE-RETURN ENTRY.** The educator's entry is a RETURN to a zone/level (retest / tap-back / reclaim)
> AFTER a structural event (break / sweep / displacement / impulse). The compiler captures the structural
> EVENT as the trigger and misses the "wait for price to come back to the zone" entry. The context-gate
> machinery treats a zone as a WHERE-valid filter, never as THE ENTRY TRIGGER.

Evidence (compiled-fired-on-event): s7v/f18 (tap into OB after BOS → fired the displacement/break);
W7nln/I29 (retest of broken level + confirmation → fired the breakout close); SY2/Gann (retrace to
prior-candle-close + LTF sweep → fired the impulse candle); z3Qn (reclaim/fade after fakeout → fired generic
swing-edge breakout); NGM5 (one-tick sweep-below-high into FVG → fired close-above-OB). Evidence
(false-quarantine, same root): bc6 (OB-before-FVG zone + pin-bar = `confirmation_no_level`), e-Qm (S/D zone
retest = `leg_anchor_missing`, took step-1 BOS bias not the zone), 75DJ (zone + active rejection =
`confirmation_would_overfire`) — all three teach a concrete zone-return entry the compiler refused because it
hunted a confirmation EVENT and found a ZONE.

Secondary recurring shapes (Case B composition): OR-alternatives flattened to AND (E9Mz: breakout OR retest
OR sweep); direction inversion on reclaim/fade (E9Mz liquidity sweep, z3Qn POC fade).

**Conclusion:** ontology incomplete by ~1 major primitive (zone-return entry) + OR-operator / reclaim-direction
composition fixes. The 5 frozen-6 axes are necessary but the frozen-6 was NOT a representative sample — most
educators teach zone-return, which the frozen-6 under-represented. NEXT (operator decision): scope the
zone-return-entry primitive; then re-run THIS blind suite as the acceptance test (frozen-6 retired as a
unit-fixture set, NOT the generalization bar).

## ★★ ENTRY-TIMING TAXONOMY (n=38 blind) — 92% require a WAIT-STATE → the diagnosis is EVENT-vs-STATE, not a missing primitive

Operator reframe: "zone-return entry" is likely NOT a new atomic primitive — it's the symptom of an
EVENT-CENTRIC compiler (`event → trade`) meeting a STATE-MACHINE reality (`bias → event → execution zone →
WAIT → confirmation-in-zone → entry`). The trigger doesn't go missing; it ALREADY happened — the transcript
is describing the wait + confirmation. Measure before redesigning. Blind entry-TIMING classification of all
38 available transcripts (5 parallel classifiers, neutral 5-category taxonomy, no mention of our compiler):

| category | count | % of 36 concrete | wait-state |
|---|---|---|---|
| zone_return | 18 | 50% | yes |
| multi_stage | 10 | 28% | yes |
| delayed_confirmation | 5 | 14% | yes |
| immediate | 3 | 8% | no |
| continuous_condition | 0 | 0% | no |
| (none — vague/promo: SgcEY, l6Ca) | 2 | — | — |

**REQUIRES A WAIT-STATE: 33/36 = 92%.** Event-coincident (the model the compiler assumes): 3/36 = 8%
(Cmo break-and-go, iLmF resting-stop-on-breakout, rf_ MACD-cross). The operator's bar ("≥70-80% delayed →
go state-oriented") is cleared at 92%. **CONCLUSION: the 0%-STRONG generalization failure is ONE architectural
mismatch — event-centric IR vs state-machine reality — not six missing primitives.** It also explains the
false quarantines: compiler looked for a trigger that had already fired, found the wait/confirmation, refused.
The 5 shipped axes (selection/multi-leg/WHERE-gate/anchor/strength) are all COMPONENTS OF THE CONFIRMATION
STEP — correct, but hung off an event spine; the redesign re-roots them in a state model.

**RECOMMENDED REDESIGN (operator's, pending greenlight):** (1) state-machine IR (`bias → event → zone →
wait_until → confirmation → entry`; immediate/continuous = the zero-wait degenerate case, subsuming all 3
wait-families). (2) 4 independently-testable pipeline stages — Semantic extraction → IR → Compilation →
Replay parity — so a failure localizes to ONE stage. (3) Gemma multi-pass with BIDIRECTIONAL TRACEABILITY
(P1 verbatim rules → P2 normalize → P3 compile IR → P4 validate every IR node ↔ ≥1 transcript span, no rule
dropped). Then re-run the blind suite as the acceptance bar. Honest n caveat: 38 not the operator's ~100, but
the 92/8 split is lopsided enough that more samples won't move the architectural verdict (expand later to confirm proportions).

## Method note (for re-running)

Probe = blind grader: `scratchpad/fidelity/<id>.compiled.json` (compiled logic) + `tmp/generalization/<id>.transcript.txt` (ground truth) → grader classifies per-example fire/no-fire + mismatch taxonomy {TIMING, CONFIRMATION, CONTEXT, DIRECTION, LEVEL, NO_MISMATCH}. Cheap (no historical data / replay). A full Layer 4 would add: extract educator's dated example trades → run compiled strategy on that history → compare actual signals.
