# WIRE-1 STRUCTURE-FAMILY CENSUS + ARCHITECTURE PROPOSAL (R-079 §3)

**For ratification before any rebuild.** R-079: *"run a short EVIDENCE PASS over the ~217
structure-family occurrences' condition texts/objects: classify what the trader actually
taught… The architecture follows that census… Propose the architecture WITH the census;
I ratify before build."*

Artifact: `docs/replay-results/h1-battery/wire1-structure-census.json`

## 1. CENSUS — what the traders actually taught

**Scope honesty first:** 90 `WAIT_STRUCTURE`/`VERIFY_STRUCTURE` occurrences exist across
the spec corpora ON DISK here (16 shakedown + 3 packet2-DoD specs). The packet's "~217"
spans the broader corpus; this census covers what is materialized locally. Rules are
ANTI-FIT — the HTF/EXEC regexes derive from timeframe semantics, not from reading these
texts first.

### 1a. Timeframe the trader named

| class | n | % | names a structural EVENT |
|---|---|---|---|
| **HTF_TAUGHT** (4h/1h/daily/weekly/HTF) | **0** | **0.0%** | 0 |
| EXEC_TAUGHT (5m/1m/15m/…) | 11 | 12.2% | 0 |
| BOTH_TF_NAMED | 0 | 0.0% | 0 |
| TF_UNSPECIFIED | 79 | 87.8% | 7 |

### 1b. What the conditions are actually ABOUT (multi-label)

| concept | n | % |
|---|---|---|
| (no concept matched — largely narration) | 32 | 35.6% |
| level / zone | 25 | 27.8% |
| liquidity (raid, sweep, equal highs/lows) | 15 | 16.7% |
| FVG / imbalance | 14 | 15.6% |
| MA / indicator | 10 | 11.1% |
| **structure event (BOS/CHoCH/MSS/displacement/swing)** | **6** | **6.7%** |
| order block | 3 | 3.3% |
| PD array / premium-discount | 3 | 3.3% |

## 2. THE THREE FINDINGS THAT DECIDE THE ARCHITECTURE

**(i) NOBODY TAUGHT HTF STRUCTURE — 0 of 90.** Building "the structure detector running
over 4h bars as primary input" would implement something **no trader in this corpus
taught**. That is not a fidelity improvement; it is a fidelity REGRESSION wearing an
improvement's clothes — the engine would test something the source never said. The
inert-`htf_bars` defect was lucky: had it worked, it would have moved us further from the
teaching, and the 0.99 would have "improved" while fidelity fell.

**(ii) THE FAMILY IS A CATCH-ALL, NOT A STRUCTURE FAMILY — only 6.7% are structure
events.** The dominant contents are level/zone (27.8%), liquidity (16.7%) and
FVG/imbalance (15.6%). `WAIT_STRUCTURE` is where the classifier puts conditions it cannot
place more precisely. So "wire the structure family" was never one problem — it is at
least four, and the engine already owns detectors for several (`fvg_native`,
`sweep_native`, `mss_native`, `structural_stops`).

**(iii) ~1/3 ARE NARRATION, NOT CONDITIONS.** e.g. *"for my entry I would personally be
looking to enter the trade right here"*, *"we wait for the entry signal once we get it we
enter"*. These are executed-bindable today, so they sit in the DENOMINATOR of the
binding-approximation rate. A third of the metric may be measuring un-actionable text.
That is an extraction/classifier question, not an evaluator question — and it means the
0.99 itself is partly an artifact of what got admitted as a condition.

## 3. PROPOSED ARCHITECTURE (for ratification — NOT built)

**DROP the HTF-structure build entirely.** Finding (i) removes its justification.

1. **DECOMPOSE the family by taught concept**, routing each sub-population to the
   detector the repo already owns — FVG → `fvg_native`, liquidity/sweep → `sweep_native`,
   structure events → `mss_native`/`structure_engine` on the **exec** frame (the timeframe
   actually taught), level/zone → the retest/level machinery. Each routed sub-family earns
   `approximation=False` only with its OWN both-polarity + premise-audit proof.
2. **Quarantine the narration tier.** Conditions naming no actionable concept should be
   classified NON-EXECUTABLE rather than bound to a generic evaluator. Removing them from
   the executed-bindable denominator makes the 0.99 mean what it claims. **This is a
   metric-definition change and needs its own ruling** — I am not moving a denominator on
   my own authority.
3. **`htf_bias` (R-079 §3a) is a NARROW component, not the fix** — it repairs alignment
   semantics only, fed from the proven-causal daily path, never from the F-1-contaminated
   `four_h_trend`.
4. **Cadence is isolated from signal, permanently** (R-079 §3): any ablation varies ONE —
   cadence/window OR signal source — holding the other. Tonight's 721→631 was cadence
   masquerading as fidelity precisely because they moved together.

## 4. PREMISE-AUDIT (R-079 §4) APPLIED TO THIS PROPOSAL

Each routed sub-family's mechanism claim gets its DIRECT test at spike time before any
generalization: **vary the detector's input, hold everything else, observe the binding's
output move.** The template is tonight's sensitivity diff (two HTF frames → zero field
movement). **WIRE-2's premise — "`compute_bias` output moves the bias binding" — gets this
test before WIRE-2 generalizes**, as ordered.

## 5. WHAT I AM NOT CLAIMING

No fidelity number is proposed here. The honest floor stands (`wire1-dod-HONEST-FLOOR.json`:
0.9938 → 0.9793 weighted, bias-credit only). This census is EVIDENCE for a build decision,
not a result. The 90-vs-~217 scope gap is stated. The concept regexes are heuristic and
multi-label; the 35.6% "no concept matched" bucket mixes genuine narration with vocabulary
gaps and should be hand-audited on a sample before any denominator change.
