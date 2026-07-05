# Residual Probe — Why 2 Concepts Stay Dead Under Full Demotion (PRE-REGISTERED, 2026-07-05)

**Status:** pre-registered (operator + GPT, 2026-07-05). Diagnostic only — NO extractor changes, NO engine
changes. Run while the system is FROZEN (post-milestone `1ab7321`) so the baseline stays clean — this is the
last uncontaminated look before the extractor fix.

## Target (Problem B — the entire remaining unexplained set)
6 strategy instances / 2 concepts that stay ZERO-TRADE even under `TF_ROLE_DEMOTION_MODE=struct_all`
(−47% conjunction depth, which revived 9 of the other 15 dead strategies):
- `5m_minute_support_level_{mes,mnq,mcl}_5m`
- `hammer_candle_long_side_{mes,mnq,mcl}_5m`

Search space reduced from 117 strategies / competing hypotheses / engine-vs-extractor ambiguity → 2 concepts /
one unresolved mechanism. Highest signal-to-noise remaining experiment.

## Method — structured, minimal-guessing (run in order, stop when a stage explains it)
For each of the 6 instances, under `struct_all` demotion (the maximal-honoring state):
1. **Extraction audit** — are the remaining `JUSTIFIED_MANDATORY` spine conditions actually transcript-supported? Any residual inflation the DRI audit missed?
2. **Execution trace** — instrument per-condition satisfaction over the full backtest. Which condition is the FIRST/binding blocker of entry? Is it the SAME condition across all 6, or different per instance?
3. **Temporal audit** — are the conditions individually satisfiable (each True at some bar) but NEVER simultaneously True on the same bar? (co-satisfaction rate = 0 despite individual rates > 0.)
4. **Concept audit** — does the concept require state/history (a prior swept level, a multi-bar pattern memory, a session-relative anchor) that the current instantaneous-AND representation cannot express?

## PRE-REGISTERED outcome table (fixed before looking; classify once)
| Outcome (from the trace) | Interpretation | Next step |
|---|---|---|
| **Same condition blocks all six** | Concept-specific extraction issue | Fix the extraction pattern for those concepts (folds into Track #24) |
| **Different conditions block each** | Residual extraction inflation the DRI taxonomy missed | Extend the DRI taxonomy |
| **Conditions individually True but never simultaneous** | Temporal / interaction semantics (GPT Layer-2) | Begin sequencing/state work — a NEW phase |
| **Engine state/history cannot express the concept** | Representation limitation | Extend the execution model |

Any outcome is actionable and strengthens the extractor-fix design. If two stages both fire (e.g. a binding
condition that is ALSO a representation gap), report the earliest in the 1→4 order as primary + note the second.

## Output
`docs/replay-results/residual-probe-2026-07-05.json` — per-instance: remaining spine conditions + per-condition
individual satisfaction rate + pairwise/joint co-satisfaction + the binding blocker + the classified outcome +
a corpus verdict (which of the 4 rows). Plus a short summary. Do NOT commit engine/extractor changes.

## Discipline
Frozen system, no writes to extractor/engine. Evidence = per-condition satisfaction traces (reproducible), not
interpretation. This closes the causal model BEFORE the extractor changes contaminate the baseline.
