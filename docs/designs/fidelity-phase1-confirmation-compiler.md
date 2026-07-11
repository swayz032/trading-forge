# Fidelity Phase 1 — Confirmation-Event Compiler (DESIGN, scope-before-build)

> **Status:** DESIGN ONLY. Targets the dominant fidelity failure proven by the 6-video probe:
> **CONFIRMATION on all 6** — the educator's entry-validating event lives in prose, the engine runs a
> generic archetype, so entries arm on a passive level-TOUCH instead of the educator's active
> confirmation → fires earlier/looser and accepts no-trade setups (over-firing). Phase 1 compiles that
> confirmation event into a testable predicate. The non-negotiable: **false compilations stay exactly 0,
> and uncertainty resolves to quarantine, never to a looser trigger.**

## 1. Confirmation-event families observed across the 6 failed probes

| family | what the educator requires | probe quotes |
|---|---|---|
| **CLOSE-THROUGH** (most common) | a candle **CLOSES beyond** a reference level — not a touch | "body close outside of the range" (sv-ix); "opening price traded **through**… change in state of delivery" (TMVHO); "close above this period high point" (iU8) |
| **STRUCTURE-SHIFT** (CHoCH/MSS/BOS) | price breaks the swing that defines structure, confirming direction | "market structure shift **above this high displacing** this high" (O9cz); "change of character… breaks above the swing highs" (2u9 — gates trade vs no-trade) |
| **RETEST-THEN-TRIGGER** | return to a level **+ confluence** then a rejection/next candle | "retest of the opening range low combined with the fair value gap confluence" (yAMaiOI); "breaker block… break and rebalance… enter on next bullish candle" (iU8) |
| **DISPLACEMENT** | an impulsive expansion leg confirms the move | "sweep… then a brand new impulse" (iU8 IRS); displacement leg (O9cz) |

These collapse to **one load-bearing distinction** + 3 primitives. The load-bearing distinction (the
actual cause of over-firing): **TOUCH/return-to (passive) vs BREAK/close-through (active).** Compiling
that one distinction correctly is ~80% of the fidelity fix.

## 2. Semantic representation (compile prose → testable predicate)

Add a `confirmation` node to the entry compile output, one of:

```
ConfirmationPredicate =
  | { kind: "close_through", level_ref, direction }      // bar.close beyond level (NOT high/low touch)
  | { kind: "structure_shift", swing_ref, direction }    // breaks prior swing (CHoCH/MSS/BOS)
  | { kind: "retest_reject", level_ref, confluence?, direction } // return to level + rejection candle [+ confluence]
  | { kind: "displacement", level_ref?, min_expansion }  // impulse leg beyond threshold
```

`level_ref` ∈ {opening_range_edge, opening_price, prior_swing_high/low, order_block_edge, breaker,
overnight_high/low, session_level}. The entry fires ONLY when the confirmation predicate is true —
the archetype becomes the *validation/zone* layer, the confirmation predicate is the *trigger*.

The critical compile rule: **`close_through`/`structure_shift` must use `close`/swing-break semantics,
never `high>=level`/`low<=level` touch semantics.** That is the single fix for the over-firing failure.

## 3. Evidence required before compilation (anti-fabrication; protects the invariant)

A confirmation predicate is emitted ONLY if:
1. **A verbatim quote names the confirmation event** — "close above/through", "break of structure /
   change of character / MSS", "retest", "displacement". No quote → NOT compiled (see §4). Never infer
   a confirmation that the educator didn't state.
2. **The `level_ref` is identifiable** from the extraction (the level the confirmation acts on). A
   confirmation with no anchor level is not executable → quarantine.
3. **Direction is coherent** with the confirmation + the strategy's directionality (reuse Layer 3B).
4. **No passive-touch fallback.** If the educator required a close-through but only a touch can be
   compiled, that is a FAILURE, not a degraded success — quarantine. (This is the rule that keeps
   over-firing at 0.)

## 4. Failure-to-compile behavior (explicit, fail-closed)

| situation | disposition | reason code |
|---|---|---|
| Confirmation event quoted + mappable + level present | COMPILE the predicate | — |
| Confirmation quoted but not mappable to a primitive | QUARANTINE | `confirmation_unmapped` |
| Confirmation quoted but no anchor level | QUARANTINE | `confirmation_no_level` |
| No confirmation event found in source | QUARANTINE | `no_confirmation_event` |
| Would require softening close-through → touch | QUARANTINE (never soften) | `confirmation_would_overfire` |

No "partial/best-effort" executable path. Partial = quarantine. This is the inversion of the current
behavior (which best-effort-routes to a generic archetype and over-fires).

## 5. Invariant preservation + success metric

- **FALSE COMPILATIONS stay exactly 0** — Phase 1 only ever makes the trigger STRICTER (touch → close-
  through) or quarantines; it can never make a trigger looser, so it cannot introduce a false/over-firing
  compilation.
- **Success = re-run the frozen 6-video fidelity baseline** (`docs/baselines/fidelity-probe-2026-06-24.md`):
  - STRONG_MATCH rises from 0,
  - the CONFIRMATION mismatch reason drops,
  - **over-firing is caught** (2u9's no-trade tap is now rejected — the must-reject test),
  - FALSE COMPILATIONS == 0.
- **Regression guard:** the §6 fidelity-design adversarial set + a new test that asserts a "touch"
  never compiles when the educator said "close through."

## 6. Build order (after this design is approved)

1. `confirmation-compiler.ts` (pure): extraction + transcript → ConfirmationPredicate | quarantine-reason,
   with verbatim-quote grounding + the close-through-vs-touch distinction + the §4 fail-closed table.
2. Engine: confirmation predicates evaluated as the entry trigger (archetype demoted to zone/validation).
3. Wire into the fidelity gate (`docs/designs/fidelity-design.md` §4) — quarantine on non-match.
4. Re-run the frozen 6 + the touch-vs-close-through regression test.

## 7. Honest scope

Phase 1 is the highest-leverage slice of the fidelity fix (the dominant mismatch on all 6), and it is
targeted — it adds one node (`confirmation`) + one hard distinction (close-through vs touch) + fail-
closed quarantine. It does NOT yet do full Layer 4 (historical replay vs dated trades) — that remains
the trade-level proof on top. But Phase 1 is what turns "executable" from "routed to an archetype" into
"fires on the event the educator actually required," which is the property the 6-probe baseline shows is
currently missing.
