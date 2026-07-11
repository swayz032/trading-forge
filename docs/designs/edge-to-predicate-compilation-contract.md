# Edge → Predicate Compilation Contract (the bridge)

> **Status:** CONTRACT (design artifact, pre-Phase-2). The 6-video fidelity matrix
> (`docs/baselines/fidelity-probe-2026-06-24.md`) located the fidelity bottleneck precisely: NOT the
> extraction schema, NOT model intelligence — the **compile bridge** from educator edge → executable
> predicate. Today that bridge performs **lossy compression** (a 3-leg specific trigger collapses to one
> generic `structure_shift@prior_swing`). This contract makes the bridge auditable: explicit IR,
> invariants, a loss metric, and rejection conditions. Converged design (TF + two external models).

## 1. The three-stage IR

```
transcript edge  →  entry_sequence IR  →  compiled executable predicate
   (gemma)            (schema, shipped)      (engine-consumable trigger)
```

- **Stage 1 — extractor** (`transcript-extractor-minimal-schema.json`, shipped): captures the speaker's
  EDGE only — `higher_timeframe`/`lower_timeframe`, `direction`, ordered `entry_sequence[]`,
  `preferred_regime`, `confluences[]`, + advisory `stop`/`targets` HINTS. GBNF-constrained, no freeform.
- **Stage 2 — entry_sequence IR**: the ordered `{step, action, rationale}` legs. This is the load-bearing
  representation the bridge must preserve.
- **Stage 3 — compiled predicate**: what the engine archetype actually fires on (`PHASE1_CONFIRMATION_TRIGGER`
  today). **This is where loss happens.**

## 2. The ownership boundary (NON-NEGOTIABLE — CLAUDE.md §2b)

| Extractor + bridge OWN (must be faithful) | framework-overlay OWNS (authoritative, replaces source) |
|---|---|
| bias / direction | stop loss (1.5×ATR structural + ceiling) |
| session (POI vs execution — distinct) | take-profit ladder (Style C 33/33/33) |
| POI / named levels | position sizing (risk-derived pyramid) |
| setup + ordered confirmation legs | exit plan / runner trail / time-stop |
| entry trigger | DLL / firm caps |

The bridge compiles **only the entry edge**. The speaker's `stop`/`targets` are captured as *advisory hints*
and then DISCARDED by the overlay. **A bridge that emits final risk config is a contract violation** — it
re-imports the YouTuber's risk style and destroys cross-strategy comparability.

## 3. The broken invariant (what Phase 2 fixes)

> **Compilation MUST preserve semantic specificity.** `compiled_specificity ≥ extraction_specificity − TOLERANCE` (TOLERANCE → 0).

Today this is violated (from the matrix):

| video | extracted edge | compiled (today) | violation |
|---|---|---|---|
| yAMaiOI9cmc | OR-low retest + FVG (named level + confluence) | `structure_shift@prior_swing` | specificity collapse → SYSTEMATIC |
| O9czLS8lv4U | Asia-low POI + 1m displacement + MSS, London session | generic MSS, session=Asia(POI mis-bound) | level + session + leg loss |
| iU8ww5MC2FQ | chain-state-close + breaker-rebalance + 25-50% zone | one generic break | 2 of 3 legs dropped |

## 4. Semantic Compression Loss (SCL) — the production metric

`SCL = specificity(extracted_edge) − specificity(compiled_predicate)`. Computed deterministically (no LLM)
so it runs on every compile as a fail-closed gate; the LLM grader becomes a periodic audit, not the daily check.

**Specificity score (information units — refined with GPT's sequence_depth + rare_pattern_bonus):**
```
specificity =
    named_level      * 5   // asia_low, OR-low, PDH, opening_price, overnight_high — not "a level"
  + session_bound    * 4   // execution session present + coherent (NOT the POI session)
  + timeframe_specific * 4 // explicit refinement TF (e.g. drop to 1m) present
  + confluence_count * 3   // FVG, OB, displacement, SMT … each counts
  + sequence_depth   * 5   // number of ORDERED mandatory legs (sweep→displacement→retest = 3)
  + rare_pattern_bonus * 2 // named non-generic mechanic (CISD, breaker-rebalance, SFP)
```
Worked example (the litmus): `structure_shift@prior_swing` ≈ **2**; `asia-low sweep + 1m displacement + FVG retest (NY)` ≈ **17** → **SCL = 15**. High SCL ⇒ likely fidelity failure ⇒ quarantine.

**Gate:** `SCL > SCL_MAX` (default near-0, env `SCL_MAX_TOLERANCE`) → compile is rejected → strategy
QUARANTINES with reason `semantic_compression_loss`. Never ship a high-SCL compile to backtest.

## 5. Compiler responsibilities (5 hard rules)

1. **Preserve all mandatory legs.** Never collapse `A + B + C` → `A` unless provably equivalent. Dropped
   leg → `contradiction:missing_leg` → quarantine.
2. **Preserve ordering.** Legs are non-commutative (`sweep → displacement → retest` ≠ retest-first).
   Reordering → `contradiction:order_violation`.
3. **Preserve specificity** (§3 invariant) — enforced by the SCL gate (§4). Prefer the highest-specificity
   trigger present in the source, NOT a fixed kind-rank. (Today's fixed `structure_shift > close_through`
   rank IS the selection bug.)
4. **Bind evidence.** Every predicate component maps to a transcript chunk (`evidence_quote_id` / span).
   Orphan predicate (no evidence, or evidence from a counter-example/failed-setup chunk) → reject.
5. **Detect contradiction** (production pass, not just test harness): extracted N legs but compiled 1;
   session lost; named level lost; generic replacement of a specific trigger; direction inverted vs the
   directional_rule. Any true → fail compile / quarantine.

## 6. Rejection conditions (fail-closed; quarantine reasons)

`semantic_compression_loss` · `contradiction:missing_leg` · `contradiction:order_violation` ·
`contradiction:session_lost` · `contradiction:named_level_lost` · `contradiction:generic_replacement` ·
`evidence_orphan` · `evidence_from_counter_example`. All preserve the 0-false-compilation invariant —
the bridge only ever rejects/quarantines or compiles faithfully; it never ships a lossy predicate.

## 7. Phase 2 plan (GPT-reordered by failure severity)

- **2A — Specificity-ranked selection.** Replace the compiler's fixed kind-rank with the §4 specificity
  score; prefer the most specific trigger present. Biggest ROI — converts the SYSTEMATIC case. + SCL gate.
- **2B — Multi-leg preservation + contradiction detector.** Compile ALL ordered legs (not just the top
  one); production contradiction pass (§5.5). **Ordered before provenance** because leg-collapse *silently
  corrupts backtests* (you test a looser strategy and never know) — higher severity than provenance.
- **2C — Provenance binding.** Evidence-id per predicate component; exclude counter-example / failed-setup
  / inverted-recap chunks (needs the L1 counter-example chunk type). Mostly observability + de-confounds
  the strength read.
- **2D — Session POI-vs-execution fix.** Isolated (O9cz): distinguish the POI session (where the setup
  forms) from the execution session (where entry fires); don't bind the POI session as `session_window`.

Acceptance for each: re-run the frozen-6 → SCL drops, STRONG count rises, **FALSE COMPILATIONS stays
exactly 0**, and the matrix axes move (SELECTION/STRENGTH FAILs → PASS). Then the small UNSEEN fidelity
set (locally-correct → generally-correct).

## 8. What this buys

Once the bridge has explicit invariants + the SCL gate, the two halves become narrow and auditable:
- **Gemma's job** shrinks to: extract the exact edge with evidence (already largely solved per the matrix).
- **The compiler's job** becomes provable: *no semantic loss during compilation* (SCL ≈ 0), enforced
  deterministically on every run.

That is the concrete path to the 100%-faithful-extraction target — fidelity stops being an LLM-graded
opinion and becomes a measured, fail-closed property of the compile step.
