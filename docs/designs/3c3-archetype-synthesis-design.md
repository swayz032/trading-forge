# 3C.3 — Archetype Synthesis: DESIGN (scope-before-build)

> **Status:** DESIGN ONLY — not implemented. Scoped before building because 3C.3 is the first
> component that *expands the engine's executable surface*. Stage 2 validated **refusal** behavior
> (0 false compilations / 23 unseen). 3C.3 creates new executable interpretations, which flips the
> risk: the danger is not "fails to add yield" — it's "adds yield by silently re-introducing false
> compilations." **Protecting the 0% false-compilation invariant outranks maximizing coverage.**

## 1. What the uncatalogued videos actually are (grounding, not assumption)

Pulled the real extractions for the 7 uncatalogued unseen + SY2/W7nln. The operator's suspicion
(2-3 families, not 9 archetypes) is confirmed — **and** ~half are not real strategies at all:

| video | concept | reality | 3C.3 disposition |
|---|---|---|---|
| I29peidTQxU | 15minute_candle | 15m range → drop to 5m → break+close outside range | **ARCHETYPE: range_break_retest (ORB)** |
| jlShztsY3oA | hoogtepunt | mark first-15m-candle high/low → break above=long / below=short | **ARCHETYPE: range_break_retest (ORB)** — same family |
| W7nlnHTUZQU | overnight_high_low_retest | overnight H/L → break → retest → confirmation candle | **ARCHETYPE: level_break_retest** |
| SY2jXlW9bt4 | impulse_range_sweep_4h_5m | impulse candle → 4H box zones → retrace into optimum → enter | **ARCHETYPE: zone_retracement** |
| e-QmGJU1XYc | uptrend_downtrend_validation_3step | HH/HL trend + supply/demand zones | maps to EXISTING `order_block` / `bounce_off_level` (no new archetype) |
| CmoPttNyky0 | legacy_funded_futures_execution | "place support/resistance lines", vague trigger | **QUARANTINE** (no deterministic trigger) |
| 969YdxbzoAw | support_resistance_entry_futures | "buy a contract, wait for it to go up, sell" | **QUARANTINE** (no strategy) |
| l6CaHkTARx4 | s_p_500_or_es | ES/NQ correlation + contract rollover mechanics | **QUARANTINE** (not an entry strategy) |
| SgcEYNm-OO4 | leading_percentage_gainers_example | "focus on leading % gainers" (stock screener) | **QUARANTINE** (wrong domain / no setup) |

**Key finding:** 3C.3 is NOT "build 9 archetypes." It is **(a)** add ~3 archetype families
(range_break_retest, level_break_retest, zone_retracement) that cover the genuine ones, and **(b)**
ensure the 4 vague/junk videos STAY quarantined. Today they sit in `uncatalogued` (coverage passed —
coverage measures named-item presence, not strategy validity — but the compilability gate correctly
quarantined them). 3C.3's failure mode is flipping those 4 from correctly-quarantined to wrongly-executable.

## 2. Semantic graph schema (the executable interpretation)

An uncatalogued mechanic compiles to an archetype ONLY via a fully-specified 5-node trigger graph:

```
SemanticTriggerGraph = {
  context:       { htf_anchor, timeframe, session? }     // where/when we look
  event:         { kind: "sweep"|"break"|"tap"|"impulse"|"range_form", level_ref }  // what must occur
  confirmation?: { kind: "close"|"rejection_candle"|"retest"|"displacement", tf }   // OPTIONAL
  trigger:       { kind, price_ref, direction_rule }     // the exact fire — MANDATORY
  invalidation:  { anchor }                              // where it's wrong — MANDATORY
}
```

Each node must be backed by ≥1 verbatim transcript quote (anti-fabrication, same discipline as the
coverage repair loop). A node with no quote is INFERRED and counts against the evidence threshold.

## 3. Archetype families (3 — cover the genuine uncatalogued)

| family | matches | engine analog / build |
|---|---|---|
| `range_break_retest` | I29peidTQxU, jlShztsY3oA (+ many ORB unseen) | form range on HTF candle → break+close on LTF → (optional retest). Likely extends existing `session_open_breakout`. |
| `level_break_retest` | W7nln (overnight), some S/R | mark level (overnight H/L, PDH/PDL) → break → retest as S/R → confirmation candle → enter. |
| `zone_retracement` | SY2 (Gann/impulse box) | impulse defines box → fib zones → retrace into optimum zone → enter. (= the deferred `gann_box_4h_continuation` lineage.) |

If a 4th genuine family appears in the wild later, add it — but the design assumes 3 covers the
current evidence. Trend+S/D (e-QmGJU) routes to EXISTING archetypes, not a new one.

## 4. Mandatory evidence + node requirements (the safety contract)

A mechanic becomes executable IFF ALL hold (else → quarantine, never "best-effort compile"):

1. **`trigger` present + deterministic** — a concrete fire event with a price reference and a
   direction rule. "watch for liquidity" / "look for a good entry" → NO trigger → quarantine.
2. **`invalidation` present** — a stated stop/where-wrong anchor. No invalidation → quarantine.
   (Framework-overlay still sets the Style C *exit/size*, but the entry-edge invalidation anchor
   must come from the source — it's what makes the trigger falsifiable.)
3. **`context` present** — htf anchor + timeframe (session optional).
4. **`event` present** — the structural precondition (sweep/break/tap/impulse/range-form).
5. **Evidence threshold** — ≥ `MIN_GRAPH_EVIDENCE` (default 3) of the 5 nodes backed by a VERBATIM
   quote (not inferred). `confirmation` may be absent; `trigger` + `invalidation` may NEVER be inferred.
6. **Maps to a registered archetype family** — if the graph doesn't match one of the 3 families,
   route to `needs_archetype_queue` (human/build review), NOT auto-execute.

**Quarantine reasons (new, precise):** `no_trigger_node`, `no_invalidation_node`,
`insufficient_graph_evidence`, `unmapped_archetype_family`.

## 5. The non-negotiable success metric

Re-run the FROZEN 25-video Stage-2 baseline (`docs/baselines/generalization-stage2-2026-06-24.md`)
after 3C.3. Accept the build ONLY if:

- **EXECUTABLE increases** (target: the ~3 genuine uncatalogued flip — I29peidTQxU, jlShztsY3oA, W7nln; SY2 too via zone_retracement),
- **UNCATALOGUED decreases** (the genuine ones leave; the 4 junk ones move to QUARANTINE, not EXECUTABLE),
- **FALSE COMPILATIONS == 0 (exactly, not approximately).**

If executable rises but false compilations go 0→anything, **reject the build** — the safety property
is worth more than the yield.

## 6. Adversarial guard set (build BEFORE 3C.3 ships)

A synthetic set of vague phrasings that MUST all quarantine (prove 3C.3 demands evidence, doesn't pattern-match keywords):

- "watch for liquidity above the highs" (no trigger, no invalidation)
- "look for an order block and get a good entry" (no deterministic fire)
- "when market structure shifts, look for continuation" (no level ref, no trigger)
- "wait for the overnight high to get swept" (event only — no trigger/confirmation/invalidation)
- "trade the breakout" (no level, no retest, no invalidation)

Each → expected `quarantine` with the precise missing-node reason. These become a permanent unit-test
fixture (`3c3-adversarial.test.ts`) so a future change can't silently loosen the evidence bar.

## 7. Build plan (after this design is approved)

1. `semantic-trigger-graph.ts` — pure: transcript + extraction → SemanticTriggerGraph | null, with
   per-node verbatim-quote grounding + the evidence threshold + the 4 quarantine reasons.
2. Family matcher → maps a complete graph to one of the 3 archetype families (or `unmapped`).
3. Engine archetype handlers for the 3 families (or extend existing where possible — range_break_retest
   likely extends `session_open_breakout`).
4. Wire into the compilability gate: uncatalogued + complete-graph + mapped-family → compilable;
   else stays quarantined with the precise reason.
5. Adversarial fixture (§6) + frozen-25 re-run (§5).

## 8. Honest expected impact

Modest on yield, high on correctness. Of the 7 uncatalogued unseen, only ~2-3 are genuine
(I29peidTQxU, jlShztsY3oA, + maybe a level/zone case) → executable yield rises ~+2-3/23 (~10pts).
The larger correctness win is reclassifying the 4 junk videos from `uncatalogued` to `quarantine`
(they were never executable). **3C.3 is as much a tightening as an expansion** — which is exactly why
it must not loosen the evidence bar to chase coverage.
```
