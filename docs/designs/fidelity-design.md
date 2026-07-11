# Fidelity — DESIGN (the now-primary bottleneck)

> **Status:** DESIGN ONLY. The 6-video fidelity probe (`docs/baselines/fidelity-probe-2026-06-24.md`)
> proved: **0/6 executable strategies reproduce the educator's own demonstrated entries; dominant
> mismatch = CONFIRMATION; universal across order-block / ORB / 4h-box families.** Fidelity — not
> archetype coverage (3C.3) — is the dominant blocker between "we extracted a strategy" and "we
> extracted the *correct* strategy for backtesting." 3C.3 stays paused.

## 1. The proven root cause

`entry_condition: null` + `entry_params: {}` on all 6. The real differentiating logic lives only in
the prose `entry_sequence`; the resolved archetype executes its OWN generic defaults. So the compiled
strategy **arms on a passive level-touch instead of the educator's active CONFIRMATION event** (CISD
break-through-opening-price, 5m CHoCH gate, chain-of-state close, breaker-block rebalance, displacement).
Consequences: fires earlier/looser than the educator; in ≥1 case takes setups the educator *explicitly
rejects* (the no-trade tap) → **over-firing**, which produces backtests that look legitimate while
testing a different, looser strategy.

## 2. The architecture shift (operator-specified)

Current (fails fidelity):
```
transcript → archetype LABEL → archetype generic execution
```
Target:
```
transcript → SEMANTIC TRIGGER GRAPH → EXECUTABLE CONDITIONS → archetype as a VALIDATION layer
```
The educator's differentiating logic is in the *prose*, not the archetype name. So the prose must be
compiled into testable conditions; the archetype becomes a sanity/validation check, not the executor.

## 3. The fidelity contract (what "faithful" must mean)

A strategy is FAITHFUL only if its compiled conditions:
1. **Encode the confirmation event** the educator requires (the #1 miss). The entry must fire on the
   *active* event (break-through / CHoCH / close-through / displacement), NOT a passive level-touch.
2. **Reproduce the educator's narrated example entries** — would-fire at the demonstrated entries.
3. **Reject what the educator rejects** — the no-trade discrimination. Over-firing (taking setups the
   educator skips) is a fidelity FAILURE, not a minor issue. This is the asymmetry that makes a
   backtest lie.
4. **Direction / level / session coherent** with the source (fix the `both`-vs-`LONG_ONLY` incoherence,
   the order_block-for-ORB mislabel, the US-open-as-London session mis-parse).

## 4. The FIDELITY GATE (extends compilability: "exists" → "matches")

Today the compilability gate verifies an archetype *resolves*. Add a fidelity stage that verifies the
compiled logic *reproduces the educator's examples* before a strategy is marked backtest-ready:

- **Extract the educator's narrated example entries** from the transcript (a new extraction target —
  "here's where I entered" / walked-through trades). Many videos have them; videos with none →
  `fidelity_unverifiable` (cannot certify, do not ship as faithful).
- **Simulate-or-check** the compiled conditions against those examples (cheap path: the semantic
  grader used in the probe; full path = Layer 4: run on the dated history + compare signals).
- **Verdict gates the lifecycle:** STRONG_MATCH → backtest-ready; PARTIAL/DIVERGENCE/UNVERIFIABLE →
  quarantine with the precise mismatch reason (CONFIRMATION / LEVEL / CONTEXT / DIRECTION / TIMING).

This makes "executable" mean "reproduces the educator," restoring the trust the 0% false-compilation
gave us at the gate level.

## 5. Build phases (proposed, smallest-first)

1. **Confirmation-event compiler** — turn the prose confirmation into a testable condition (the #1
   lever; covers the dominant mismatch). Start with the most common confirmation verbs the probe
   surfaced: break/close-through a level, CHoCH/MSS, displacement, breaker-block rebalance.
2. **Example-entry extractor** — pull the educator's demonstrated entries as ground truth.
3. **Semantic fidelity gate** — grader compares compiled conditions vs examples → verdict + mismatch
   reason; wire into the lifecycle (quarantine on non-match).
4. **(Layer 4 full)** — historical replay vs the educator's dated trades for trade-level proof.

## 6. Success metric (protect the invariant)

Re-run the frozen 6-video fidelity baseline after the confirmation-compiler + gate:
- STRONG_MATCH count rises from 0,
- mismatch reasons shift from "no executable logic" to specific, debuggable causes,
- **FALSE COMPILATIONS stays exactly 0** AND **over-firing is caught** (the no-trade taps must be
  rejected). Never trade the safety property for a higher match rate.

## 7. Honest scope

This is the largest remaining build in the project — bigger than 3C.3. It changes how entries are
compiled (prose → conditions), not just which archetypes exist. But the probe has made it tractable:
the dominant failure is ONE thing (the confirmation event isn't compiled), and the fix is targeted.
Expected arc: confirmation-compiler + fidelity gate first (cheap, semantic) → then Layer 4 historical
proof. Until then, the honest project status is: **extraction + refusal solved; faithful execution
located and scoped but unbuilt.**
