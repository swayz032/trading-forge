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

## Method note (for re-running)

Probe = blind grader: `scratchpad/fidelity/<id>.compiled.json` (compiled logic) + `tmp/generalization/<id>.transcript.txt` (ground truth) → grader classifies per-example fire/no-fire + mismatch taxonomy {TIMING, CONFIRMATION, CONTEXT, DIRECTION, LEVEL, NO_MISMATCH}. Cheap (no historical data / replay). A full Layer 4 would add: extract educator's dated example trades → run compiled strategy on that history → compare actual signals.
