# Ledger-E parity repair — PER-SPEC MATERIALITY RECEIPT

> **GENERATED FILE — do not hand-edit.** Emitter: `scripts/materiality-receipt-ledger-e.ts`.
> `BEFORE` = TS lane at `926fe9a1~1:src/server/lib/spec-family-bindings.ts` (pre-refusal, self-contained, 0 `refusedSessionZone`).
> `AFTER` = TS lane at this commit. **Python lane not measured — it already carried the refusal**
> **before this branch existed, so a before/after there compares a file to itself.**

## Per-spec movement (12 declared corpus members)

| spec | movement |
|---|---|
| `00-control-shipped.spec.json` | **— no movement** |
| `10-lunch-orphan.spec.json` | `spineBound` 2→1 · 1 row bindable flip(s) · 1 row(s) gained a refusal reason |
| `11-premarket-orphan.spec.json` | `spineBound` 2→1 · 1 row bindable flip(s) · 1 row(s) gained a refusal reason |
| `20-nyam-evaluable.spec.json` | **— no movement** |
| `21-fivemin-chart.spec.json` | **— no movement** |
| `22-nypm-evaluable.spec.json` | **— no movement** |
| `23-silverbullet-evaluable.spec.json` | **— no movement** |
| `24-macrowindow-evaluable.spec.json` | **— no movement** |
| `30-compiled-flip.spec.json` | `spineBound` 2→1 · `compiled` true→false · 1 row bindable flip(s) · 1 row(s) gained a refusal reason |
| `31-flip-neg-control.spec.json` | **— no movement** |
| `40-overrefusal-boundary.spec.json` | `spineBound` 2→1 · 1 row bindable flip(s) · 1 row(s) gained a refusal reason |
| `50-family-axis-invalidations.spec.json` | **— no movement** |

## The failure signal — AND ITS REACH, WHICH IS THE PART THAT MATTERS

**Aggregate `compiled`: BEFORE 12/12 → AFTER 11/12. `false→true` transitions: 0.**

The frozen criterion is *"A HIGHER `compiled` COUNT IS A FAILURE SIGNAL"* — a repair that makes MORE specs compile has loosened something. **No spec gained `compiled`, and the aggregate went 12 → 11, i.e. DOWN or level.**

### ⚠️ DO NOT READ THAT AS A PASS WITHOUT READING THIS

**EMITTER SELF-CONTROL:** fed a synthetic `[false,true] → [true,true]` pair, the signal logic reports **1** transition(s) — **it CAN fire**.

⚠️★★★★★ **CORPUS REACH: ZERO. ALL 12/12 SPECS ALREADY COMPILE IN `BEFORE`, SO A `false→true` TRANSITION IS ARITHMETICALLY UNREACHABLE ON THIS CORPUS AND THE COUNT ABOVE COULD ONLY EVER HAVE BEEN `0`.** This was found by RED-PROOFING the receipt — loosening the AFTER lane (`MIN_SPINE_BOUND_RATIO` 0.5→0.0) failed to move the number. **The emitter works; the corpus cannot feed it.** A corpus member that FAILS to compile pre-repair is required before this signal certifies anything, and until one exists the line above is a DECLARED GAP, not a pass. `A GREEN CHECK WITH NO PATH TO RED IS NOT A CHECK.`

**Specs with any movement: 4 of 12. Rows that gained a refusal reason: 4.**

★★★ The movement is in the REFUSAL direction only — rows losing bindability and gaining an attributed reason. That is the shape the repair was authorised to produce: the TS lane previously bound orphan-zone conditions that the Python lane already refused.

## Materiality control (outside the efficacy population)

| control spec | BEFORE `compiled` | AFTER `compiled` | verdict |
|---|---|---|---|
| `00-compiled-false-baseline.spec.json` | false | false | ok |

**1 control(s) hold their `false → false` baseline.** ★★★ This is what makes the efficacy verdict above falsifiable: a `false→true` transition IS producible here, and this run did not produce one. The emitter exits NON-ZERO if it ever does.
