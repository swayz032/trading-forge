# Zone / Context-Gate Primitive — DESIGN (Phase 3A, scope-before-build)

> **Status:** DESIGN ONLY. Phase 2B proved multi-leg was real but **not the final primitive**: iU8 and
> O9cz stayed PARTIAL because their residual is a DIFFERENT category — a **where-valid context**, not a
> *when-confirm* event. The confirmation compiler answers WHEN to enter; it structurally cannot answer
> WHERE entry is allowed. Those are orthogonal dimensions. This scopes the new primitive that closes them.

## 1. The ontology (why this is a separate axis)

| dimension | question | primitive | status |
|---|---|---|---|
| **WHERE valid** | where is the setup allowed at all? | **context gates** | ← this doc (3A) |
| WHAT confirms | what event validates entry? | confirmation legs | 2B ✅ |
| WHICH fires | which leg is the trigger? | primary leg + roles | 2A/2B ✅ |
| HOW strong | is the confirmation high-quality? | quality scoring | 3B (later) |

A context gate is a **validity boundary**, not an event:
- **iU8:** the entry (`displacement → retest`) is valid **only within the 4H box's 25-50% "optimum" zone** — "the 25 to 50% is going to be optimum… we want price to retrace into" / overextended & danger zones are "a solid no-go." The zone decides *where the confirmation counts*.
- **O9cz:** the 1m MSS+displacement is valid **only near the Asia-session-low POI** — "a clear point of interest below the Asia session low." The POI is *where* the setup forms.

These never fit a confirmation leg because they describe a region/precondition, not a candle event.

## 2. The new IR (parallel to confirmation)

```
context_gates: [
  { type: "zone",    name: "4h_box_optimum", basis: "fib_retrace", bounds: { min: 0.25, max: 0.50 },
    anchor: "4h_candle_box", required: true,  evidence_quote: "..." },
  { type: "poi",     name: "asia_low",       proximity_atr: 1.0,   required: true,  evidence_quote: "..." },
  { type: "session", region: "NY",           required: true },          // reuses Layer 3A session-filter
  { type: "regime",  value: "trending",      required: false }          // preferred, not hard
]
```
- `type` ∈ {`zone` (fib/range quadrant), `poi` (named liquidity level + proximity), `session` (reuse session-filter), `regime`}.
- `required` — **hard gate** (no trade unless satisfied) vs preferred (soft, quality only). Mirrors the 2B `LegRole.hard_gate` — in fact a 2B `hard_gate` leg that is a *zone/POI* should MIGRATE here.
- `evidence_quote` — verbatim grounding (same anti-fabrication discipline).

## 3. Compile semantics (orthogonal AND)

```
TRADE VALID  IFF  (all required context_gates satisfied)
             AND  (primary confirmation leg fires)        // 2B
             AND  (per-leg enforcement: confluence/hard_gate)  // 2B
```
Context gates and confirmation legs are **independent conjuncts** — WHERE ∧ WHEN. This is exactly how a
discretionary trader reasons ("I only take this in the optimum zone, *and* I need the displacement").

## 4. Where context gates come from (extraction source)

Critically, they're **already in the data we currently DISCARD**: the compound compiler skips
`entry_sequence` steps where `hasActiveConfirmation === false` (pure-context steps like "wait for price to
retrace into the 25-50% zone"). Those skipped steps are the context-gate source. Phase 3A adds a
`scanContextGates(steps + setup text)` pass that mines them:
- fib/quadrant language ("optimum", "25-50%", "premium/discount", "equilibrium") → `zone`.
- named liquidity ("Asia low", "PDH", "POI", "order block zone") + "near/into/at" → `poi`.
- session ("NY open", "London") → `session` (delegate to session-filter; reuse the POI-vs-execution fix from 2D).
- regime ("trending", "ranging only") → `regime`.

## 5. Engine interaction (this touches more than extraction)

Unlike confirmation (event detection), a context gate needs a **WHERE evaluator** at signal time:
zone = is price within `[box_low + 0.25·range, box_low + 0.50·range]`? poi = is price within
`proximity_atr × ATR` of the named level? That's engine work (price-vs-zone math), so 3A is **extraction
(emit the gate) + engine (evaluate the gate)**. Extraction-side ships first (emit `context_gates` + grade
fidelity of representation); engine evaluation is the follow-on that makes them live in backtests.

## 6. Ownership boundary (unchanged)

Context gates are part of the **EDGE** (the educator's where-valid), NOT framework risk — the extractor
owns them, framework-overlay still owns stop/TP/sizing. A zone gate is "where the entry is allowed," not
"how to manage the trade." No conflict with the overlay.

## 7. Fail-closed + contradictions

- A `required` zone/POI gate that's named in the source but can't be represented (no anchor / unknown
  basis) → contradiction `CONTEXT_GATE_UNREPRESENTED` → quarantine (don't ship a strategy that drops the
  educator's validity boundary — that's the iU8 over-fire: firing the trigger *outside* the optimum zone).
- Never INFER a gate not stated (no fabricated zones).

## 8. Success metric

Re-grade the frozen-6: **iU8 → STRONG** (zone gate now constrains the displacement+retest to the optimum
quadrant), **O9cz → STRONG** (POI gate + the 2D anchor fix), FALSE COMPILATIONS stays 0, and no regression
on the existing 3 STRONG. Predicted post-3A (+2D): **5 STRONG / 1 PARTIAL** (2u9 awaits 3B confirmation-strength).

## 9. Build order (after this design is approved)

1. `context-gate.ts` (pure): `scanContextGates(steps, setupText, confluences)` → `ContextGate[]` + contradictions.
2. Wire into the compound result (`context_gates` alongside `legs`); migrate 2B `hard_gate` zone/POI legs here.
3. Extraction-side fidelity re-grade (representation correct?).
4. Engine WHERE-evaluator (zone/POI price math) — makes gates live in backtests (follow-on).

3A is the **highest-ROI remaining unlock** (converts the two zone-blocked PARTIALs). It is a new
representational layer, hence this contract first — same discipline as the bridge / Phase 1 / 2A.
