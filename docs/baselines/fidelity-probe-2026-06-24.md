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

## Method note (for re-running)

Probe = blind grader: `scratchpad/fidelity/<id>.compiled.json` (compiled logic) + `tmp/generalization/<id>.transcript.txt` (ground truth) → grader classifies per-example fire/no-fire + mismatch taxonomy {TIMING, CONFIRMATION, CONTEXT, DIRECTION, LEVEL, NO_MISMATCH}. Cheap (no historical data / replay). A full Layer 4 would add: extract educator's dated example trades → run compiled strategy on that history → compare actual signals.
