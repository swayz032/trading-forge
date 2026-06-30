# Briefing v3: the YouTube-strategy extraction compiler (for a new collaborator)

> Supersedes v2. v2's mechanism question ("gate vs compression vs critic") is **answered** — compression was
> built. This carries the new frontier: the compression result, the model upgrade, the measurement rebuild, and
> the one remaining residual. Read v1/v2 for full history; this is the delta + current state. Discipline
> unchanged: **we move on observed evidence, and NodeRecall is the tripwire that catches over-merge.**

## 0. The mission (unchanged)

Extract **100% of the trading strategy + every step a YouTube educator teaches** — faithfully and *executably* —
from the transcript, so a deterministic **Python backtest engine** tests the REAL strategy with **no human
interpretation**. It's a **compiler for a strategy DSL hidden inside natural language.** Two-stage ownership:
extraction captures the entry edge; the framework-overlay owns stop/TP/sizing (`framework_owned`).

## 1. Settled (do not re-litigate)

1. **Recall is fine** (omissions ~0). 2. **The Decision Introduction Gate is stable** (DBA 100%). 3. **The
deterministic graph compiler is correct** — edges are *derived structure*, not extracted; `graph-compiler.ts`
builds the CFG (group-aware state-rank spine + AND/OR/exception). TopologyFidelity 100%, Reachable YES on gold.
4. **SGF is the north-star** (NodeRecall / EdgeRecall / Reachability / TopologyFidelity vs a hand-built GOLD
graph). DRR retired. 5. **Downstream noise-filtering is FALSIFIED** (v2 bracketing) — precision must come from
the source. 6. **Over-extraction is OVER-FRAGMENTATION**, not false positives (~85%): one decision split into
sub-features ("confirmation = displacement + body-close + follow-through" → 4 atoms for 1 gold node).

## 2. What was built since v2 — the semantic compression layer

The mechanism GPT chose. `DecisionAtom` gained `predicates[]`; `predicate-compression.ts` separates executable
decision **NODES** from supporting **PREDICATES** *before* graph assembly:
- **Anchors** (always-node types, OR a refinable type with a SPECIFIC discriminating object — timeframe / named
  level / named pattern / indicator) stay nodes.
- **Generics** ("price action", "candle formation") fold onto the nearest **same-TYPE** node within a window
  (type-preserving = NodeRecall-safe); anchorless same-type generics collapse to one node.
- **Framework leaks** (pure stop/TP/sizing vocab) classified out, never deleted (conservation law).
- Conservative on anchors by design (the main risk is over-merging OR-branches / distinct same-type decisions).

## 3. The model investigation (operator-driven) — three real findings

We tested whether a bigger source model helps, since fragmentation + variance are classic small-model weaknesses.

| model | disk | runtime fit (8GB RTX 5060) | active params | viable? |
|---|---|---|---|---|
| `gemma4:e2b` (was production) | 7.2GB | tight | ~2.3B | yes (baseline) |
| `gemma4:12b-it-qat` | 7.2GB | **8.5GB, 26% CPU spill → batch timeout** | ~12B | **NO — unrunnable here** |
| `gemma4:e4b-it-qat` | 6.1GB | **3.1GB, 100% GPU, fast** | ~4.5B | **YES — adopted** |

1. **A bigger model does NOT reduce fragmentation.** e4b still emits ~34 raw atoms for psH's ~8 decisions —
   *same* as e2b. **Fragmentation is inherent to per-clause extraction, not model capacity.** This independently
   re-validates that the compression layer is necessary, not a crutch.
2. **e4b is a genuine upgrade for two OTHER reasons:** it runs **deterministic across passes** (Δ=0, DBA 100% —
   killing the run-to-run variance that plagued e2b, and likely making the deferred N-sample union unnecessary),
   and its **objects are far richer** ("break above 15m high with strong candle" vs e2b's "price action").
3. **GPT's VRAM claim for the 12B was wrong** ("5.8-6.2GB, breathing room") — measured 26% CPU offload + a hard
   request timeout. The 12B is off the table on this hardware. e4b ("fits perfectly") was correct.

The research harness now defaults to **e4b** (`TRANSCRIPT_EXTRACTOR_LOCAL_MODEL`); production stays `gemma4:e2b`
behind the 5-fixture parity gate until a deliberate swap. e4b is now a strong parity-test candidate.

## 4. The measurement rebuild — the gold was lying to us

The SGF NodeRecall had been **mismeasured** (75-88%) because the hand-built gold demanded exact granularity +
exact type labels. Fixes: the gold is re-cut to **node/predicate granularity** (7 real psH decisions; VERIFY
folds in as a *predicate*); matching is now **type-FLEXIBLE** (gemma's type labels are noisy — a "break" is
tagged STRUCTURE or CONFIRMATION across runs, so NodeRecall must measure DECISION capture, not label precision);
plus claimed-atom de-aliasing (one atom can't satisfy two gold nodes) and edge-role-agnostic EdgeRecall.

## 5. WHERE WE ARE RIGHT NOW (psH, e4b, rebuilt gold)

```
raw atoms 34  ->  compression  ->  15 nodes (+18 predicates, 0 framework leaks)
NodeRecall:  100%  ->  86%        (BASELINE now a true 100% — all 7 decisions captured; lost 1 in compression)
AtomPurity:   21%  ->  47%        (nearly doubled)
EdgeRecall:   33%  ->  17%        (coupled to the lost node)
Reachable: YES; TopologyFidelity 100%; STABLE (Δ=0)
VERDICT: FAILED — only because the guardrail demands NodeRecall hold ~100%; we lost exactly 1 of 7.
```

This is the best state of the investigation: deterministic model, a true 100% baseline, purity nearly doubled.

## 6. The ONE residual — precisely diagnosed (it's the source, not the compressor)

The lost node is **`confirm`** (the engulfing/buyer confirmation). Cause: **gemma labeled the BREAK as
`WAIT_CONFIRMATION`** ("break above 15m high with strong candle"). So the break and the real confirmation share a
type, and same-type folding absorbed the confirmation (the `[+12]`). There is no surface token to separate "break
above the high" from "buyers closed the candle" — both contain "candle." This is **source type-confusion**, not a
compression bug — the recurring lesson (surface heuristics can't perfectly recover inconsistent model labels),
now at the type layer. EdgeRecall dropped *because* this node was lost (confirm→retest, enter→confirm can't form).

## 7. The open DECISION (for the collaborator)

We're at diminishing returns on psH's last 14% (chasing it = fighting gemma's type noise with ever-finer
heuristics = the thrash the discipline forbids). Two paths:

1. **Generalize across the corpus (recommended).** The high-value question is no longer "psH → 100%?" but
   **"does e4b's 100% baseline + the compression layer hold across strategy families?"** Build node-granularity
   golds for the other 3 transcripts (l-2 ICT-confluence, h6T EMA/CCI, MKsj two-line) and run the full n=4
   head-to-head (e2b vs e4b). If e4b reliably captures all decisions and compression ~halves the atoms at
   NodeRecall ≥85% across all four, **the architecture is validated at scale** — far more meaningful than one
   transcript at 100%.
2. **Attempt the source type-confusion fix** — keep break/confirmation type-distinct at extraction. Means
   touching the research prompt; the "candle" aliasing makes a downstream fix unreliable. Lower confidence.

## 8. Discipline (hold it)

Measure before tuning (n≥2 before "systematic"); **NodeRecall is the over-merge tripwire**; classify/compress,
never prune; instrumentation ≠ science (SGF, not DRR/AtomPurity-in-isolation); no goalpost-moving (we did NOT
re-tune thresholds to force a pass — we report FAILED honestly when the guardrail trips); push ambiguity upstream,
keep later stages deterministic; production model untouched behind the parity gate.

## 9. Code state (branch `extraction/100pct-evidence`, FF-merged to `tf-deep-scan`)

`predicate-compression.ts` (the compression layer) · `graph-compiler.ts` (deterministic CFG) ·
`graph-fidelity.ts` (SGF + AtomPurity + the rebuilt node-granularity psH GOLD + type-flexible matching) ·
`decision-atom.ts` (+ `Predicate`) · `precision-feedback.ts` (the FALSIFIED downstream filter, kept as the
negative-result record) · conservation-ledgers / decision-graph-canonical / clause-segmenter ·
`scripts/atomize-transcript.ts` (vertical slice: extract → compress → compile → SGF). Model default = e4b.
tsc 0; ~30+ unit tests green.

**The one question:** generalize the compression layer + e4b across the n=4 corpus to validate at scale (build 3
more node-granularity golds), or first attempt to fix gemma's break/confirmation type-confusion at the source?
Given downstream filtering is falsified, fragmentation is inherent (compression is right), and the model is now
deterministic, the remaining risk is *generalization*, not psH's last node.
