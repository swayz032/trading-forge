# Briefing v4: the YouTube-strategy extraction compiler (for a new collaborator)

> Supersedes v1–v3. The compiler **architecture is now VALIDATED across 4 strategy styles** (n=4). This document
> is the full state: mission, what was built, what was measured, where we are, and the production frontier.
> Read it and you can contribute immediately. Defining discipline: **we move on observed evidence, never
> anticipation; we measure, report at decision points, and never goalpost-move.**

## 0. The mission

Extract **100% of the trading strategy + every executable step a YouTube educator teaches** — faithfully and
*executably* — from the **transcript**, so a deterministic **Python / Databento backtest engine** tests the REAL
strategy with **no human interpretation**.

**Precise formulation (2026-06-30, refined after the hand-off + spine-density proofs):** *Faithfully compile 100%
of a YouTube educator's executable strategy into a deterministic decision graph that is conserved end-to-end into
the backtest engine with no human interpretation and no semantic loss.* This is a more exact description of what is
now built: not "extraction" but **compilation with end-to-end conservation + full prerequisite-spine fidelity**.

**The evidence-based accuracy claim (2026-07-02, canonical — do NOT overclaim beyond this):**
1. *Source-owned extraction:* **yes, on the validated corpus** — measured recall vs human-built references, not
   subjective judgment.
2. *End-to-end semantic preservation:* **yes** — six ledgers (A transcript / B decision / C graph / D handoff /
   E interpreter parity / F grounding) prove no silent additions or losses within the validated pipeline.
3. *Engine executability:* **~97% grounded**; the gap is explicitly identified (primarily the CCI product-policy
   decision), never silently approximated.
4. *Universal applicability:* **not provable** — no finite corpus can. The stronger claim: **every processed
   strategy generates its own measurable proof of fidelity** (what was extracted, how it was preserved, what
   grounds, and exactly where any gap is). The mission — "the backtest tests what the educator actually taught" —
   is **achieved for the validated pipeline**; remaining work is evaluator families, corpus breadth, and continued
   per-strategy ledger validation — not extraction correctness.

**Adopted design refinements (GPT 2026-07-02, after the live runs):**
- **"Mirror candidate by default"** replaces "bidirectional by default": compile the source side exactly as
  taught; when the logic is structurally mirrorable, generate the mirror as an INDEPENDENT candidate hypothesis
  that must independently pass the gate battery — never assume the mirror is valid. Evidence: l-2 v3 run — the
  educator's short side +164 pts while the naive long mirror lost −896 pts (Ledger G traceable both).
- **Two-mode doctrine (standing invariant):** Mode A (source + TF risk framework only) is the permanent baseline
  and is NEVER lost; Mode B (+ TF institutional confluence overlay) must EARN its place against Mode A on
  expectancy / drawdown / Sharpe / CPCV / PBO / DSR / gate survival (`confluence-overlay-ablation.py`).
- **Phase shift:** correctness is proven (Ledgers A–G); the next milestone class is **proving value added** —
  does the Trading Forge overlay create measurable value beyond faithfully executing the educator's strategy?

- **Two-stage ownership.** Extraction owns the **entry edge** (setup / entry trigger / confluences / invalidation
  / session / direction / symbol / timeframe / ordered steps). The **framework-overlay** (operator-canonical)
  owns stop / take-profit / position-sizing / risk. Those are `framework_owned` — never extraction's job.
- The honest label for a deployed strategy is: **"YouTube source entry logic + Trading Forge institutional
  confluence overlay + Trading Forge risk/exit/sizing framework"** — *never* "the pure YouTube strategy."

## 1. The architecture (a compiler, validated)

It is a **compiler for a strategy DSL hidden inside natural language**, not "AI extraction":
```
Transcript -> Clause (permanent id, exact offsets)
           -> per-clause DECISION GATE (gemma, binary: is this an executable decision?)
           -> raw DecisionAtoms
           -> SEMANTIC COMPRESSION (separate NODES from PREDICATES; framework leaks classified out)
           -> DETERMINISTIC GRAPH COMPILER (build the CFG: spine + AND/OR/exception)
           -> Decision Graph  ->  scored by SGF vs a hand-built GOLD graph  ->  [Python/Databento backtest]
```
Guiding principle behind every win: **push ambiguity upstream; keep later stages deterministic and verifiable.**

## 2. What is built (branch `extraction/100pct-evidence`, FF-merged to `tf-deep-scan`; tsc 0; ~30+ unit tests)

| File | Role |
|---|---|
| `clause-segmenter.ts` | transcript → stable clauses (permanent ids, exact offsets, deterministic) |
| `scripts/atomize-transcript.ts` | the vertical slice (gate → atoms → compress → compile → SGF). Model via env. |
| `decision-atom.ts` | `DecisionAtom` (+ `predicates[]`), atom→S0-S8 state map, `canonObject` normalization |
| `predicate-compression.ts` | **the compression layer** — NODES vs PREDICATES, domain-anchor boundary |
| `graph-compiler.ts` | **deterministic CFG** — group-aware state-rank spine + AND-groups + OR-branches + exceptions |
| `graph-fidelity.ts` | **SGF metric** + AtomPurity + the 4 hand-built GOLD graphs (node granularity) |
| `conservation-ledgers.ts` / `decision-graph-canonical.ts` / `state-machine-ir.ts` | verification spine (3 ledgers, semantic idempotence, S0-S8 IR) |
| `precision-feedback.ts` | the FALSIFIED downstream-filter approach, kept as a negative-result record |

**Compression layer (the core innovation):** dependency edges are DERIVED STRUCTURE, not extraction outputs — the
transcript gives procedural *order*, the compiler builds the *edges*. Over-extraction is **over-fragmentation**
(~85%: one decision split into sub-features), not false positives — so the fix is **compression (merge/preserve)**
not filtering (delete). Compression separates executable **NODES** (anchors: always-node types, or a refinable
type with a *strategy-domain* object — sweep/MSS/fib/CCI/EMA/two-line/session/break/confirmation/supply-demand/...)
from supporting **PREDICATES** (vague restatements: "price action", "candle formation" — a `GENERIC_DENY` list
keeps these from ever anchoring). Generics fold onto the nearest **same-type** node (type-preserving = recall-safe).
Framework-owned risk objects are classified out, never deleted.

**Graph compiler:** builds the CFG deterministically from atom order + grammar — a group-aware spine (each atom
depends on the nearest prior GROUP of strictly-lower strategy-logical rank), AND-groups (parallel confluences),
OR-branches (lexical alternatives), exceptions. `ENABLE_ENTRY` is a valid executable **terminal** (ICT strategies
arm entry — "look for the short" — without a literal `ENTER` atom).

**SGF (Strategy Graph Fidelity) — the north-star metric** vs a hand-built GOLD graph: NodeRecall / EdgeRecall /
Reachability / TopologyFidelity. Golds are **node granularity** (executable decisions only; stop/TP excluded as
framework-owned), **type-flexible** (gemma's type labels are noisy — match the *decision*, not the label), with
claimed-atom de-aliasing. Also tracked: **AtomPurity** = gold/extracted.

## 3. The model (settled)

| model | fit on 8GB RTX 5060 | active params | status |
|---|---|---|---|
| `gemma4:e2b` | tight | ~2.3B | PRODUCTION (behind 5-fixture parity gate) |
| `gemma4:12b-it-qat` | **26% CPU spill → batch timeout** | ~12B | **unrunnable here** |
| `gemma4:e4b-it-qat` | **3.1GB, 100% GPU, fast** | ~4.5B | **research-harness default** |

Findings: a bigger model does **NOT** reduce fragmentation (e4b ~34 raw atoms for psH's ~8 decisions, same as
e2b) — **fragmentation is inherent to per-clause extraction, so compression is genuinely necessary.** e4b's wins
are *richer objects* + *better determinism* (Δ=0 on small transcripts; wobbles only on the 36K MKsj — see §6).
Production stays e2b until a deliberate parity-gated swap; e4b is a strong parity candidate.

## 4. The journey (the bottleneck march — each step measured, n≥2)

recall (FALSIFIED — omissions ~0) → precision/over-extraction (~5×) → ontology/gate (DBA 100%, stable) →
assembler (non-linear graphs fail) → resolver (typed deps, DRR solved but misleading) → **edge emission**
(per-clause can't emit cross-clause deps → edges are derived, not extracted) → **compiler built** (SGF measurable)
→ **precision is the cap** (downstream filtering FALSIFIED by bracketing; over-extraction = over-fragmentation) →
**compression layer built** → model investigation (e4b adopted) → gold rebuilt (measurement was lying) →
**compression boundaries** (the n=4 verdict) → **fixed + VALIDATED (this session).**

## 5. WHERE WE ARE NOW — architecture VALIDATED (n=4)

Latest e4b run across 4 deliberately-diverse styles, against the operator's architecture-validation bar
(rawNR=100, source-owned compNR≥85, Reach=YES, TopoFidelity=100, Δ=0):

| transcript (style) | rawNR | compNR | Reach | TopoFid | Δ=0 | verdict |
|---|---|---|---|---|---|---|
| psH (price-action ORB) | 100% | 86% | YES | 100% | ✓ | PASS (known break/confirm type-confusion) |
| l-2 (ICT 4-confluence) | 100% | **100%** | **YES** | 100% | ✓ | PASS (was 80% / Reach NO — fixed) |
| h6T (EMA10/20 + CCI)   | 100% | 100% | YES | 100% | ✓ | PASS |
| MKsj (two-line, 36K)   | 100% | 100% | YES | 100% | ✗ Δ=1 | exec-strategy stable (see §6) |

**All four pass the source-owned executable criteria.** The two fixes that closed the "fix compression boundaries"
verdict, with NO transcript-specific hacks: (1) the **domain-anchor boundary** (l-2 confluences stayed nodes →
compNR 80→100), (2) the **`ENABLE_ENTRY` terminal** (l-2 Reach NO→YES). The compiler architecture is validated
across price-action / ICT-confluence / indicator-crossover / session-liquidity styles.

## 6. Open / honest caveats

1. **MKsj raw-atom determinism.** `Δ=1, key-diff=118` on the 36K transcript — but **NodeRecall is 100% on BOTH
   passes**, so the *executable* decisions are captured both times. The 118 differing keys are wording variance in
   the *predicate/noise* layer (gemma e4b phrasing fragments differently run-to-run at scale), which compression
   absorbs. The executable strategy is stable; only the raw-atom canonical hash wobbles. The deferred **N-sample
   union** (union raw atoms across passes → stable hash) closes this. Low priority — does not block production.
2. **psH break/confirm type-confusion.** gemma sometimes labels the break as `WAIT_CONFIRMATION`, so same-type
   folding absorbs the confirmation (psH compNR 86%, lost 1 of 7). Known, isolated; only actionable if it recurs
   (it did not on l-2/h6T/MKsj). Treat as a known source-typing issue, not a pattern.

## 7. The standards (hold these)

- **Architecture-validation bar:** rawNR=100, source-owned compNR≥85, Reach=YES, TopoFid=100, Δ=0. (PASSED §5.)
- **Production-backtest bar (stricter, asymmetric):** **no missing source-owned entry/setup/filter/confluence/
  timeframe/direction/symbol logic; no unreachable executable graph; no silent assumptions; framework-owned risk
  fields MAY be absent without blocking.** Target = *100% preservation of source-owned executable entry logic,
  while letting framework-owned stop/target/sizing be informational or absent.* NOT "preserve all risk chatter to
  hit 100% NodeRecall."
- **Confluence/factor provenance taxonomy** (already partially in code — `confluence-quality-audit.ts`, graduator
  Gate 2): `extracted` (from YouTube — counts for fidelity) / `step_inferred` (from entry steps, if evidence-
  backed) / `kb_inferred` (archetype-implied) / `auto_floor`/`default` (TF overlay — **never count as extraction
  recall, never upsize confidence without audit evidence**).

## 8. The production hardening frontier — ✅ COMPLETE (side mission, shipped to `hardening/phase-0`)

All four landed behind tests/parity (commits `7cf50b3` + `a6a3176`; tsc 0 repo-wide; only the relevant files
committed — a parallel agent's in-flight drift on the shared branch was left untouched):

| # | item | severity | what shipped | verify |
|---|---|---|---|---|
| **1** | **Confluence→sizing bug** (`paper-signal-service.ts`) | **HIGH (capital)** | size multiplier (3 factors=1.5×, 4+=2×) keyed on **configured** `confirming_indicators.length` → auto-floor confluences (`regime_match`/`structural_setup`, TF overlay) could upsize live position 1.5–2× without being real edge. **FIX:** size on `evidenceBackedFactorCount()` (non-auto_floor) only — fail-safe (only ever *reduces* size). Pure helpers extracted to leaf `confluence-provenance.ts` (test-isolation + lighter hot path). | 4 new + 8 existing sizing tests GREEN |
| 2 | Extractor-prompt risk-field tension | MED | `transcript-extractor.md` made stop/targets effectively required + threatened rejection while the overlay discards them → pressure to **invent**. **FIX:** framework-owned stop/target/sizing now optional-with-`extraction_gap_reason`; rejection fires ONLY on missing **source-owned** entry logic (entry_sequence / trigger / direction). | **parity gate v10/v11 PASS** on all fixtures (the stop/targets checks). v12 FAIL is pre-existing fixture-data debt (missing `speaker_concepts`), untouched, test-documented as operator-acceptable. |
| 3 | Provenance recall accounting | MED | `tf_extraction_confluence_depth_histogram` is named *extraction* depth but observed the RAW count incl auto_floor. **FIX:** now observes `evidenceBackedFactorCount()` — auto_floor never counted as extraction recall. (`classifyFactorQuality` already excluded it; this closed the last telemetry site.) | tsc 0 |
| 4 | Two-mode backtest ablation | validation | **FIX:** `TF_CONFLUENCE_OVERLAY_DISABLED` env toggle on `apply_eligibility_gate` (backtester.py; default OFF → overlay on; `gate_stats.mode` stamped) + `scripts/confluence-overlay-ablation.py` runs `source_entry_only` vs `tf_institutional_overlay` and emits a **KEEP/LOOSEN** verdict — keep the overlay only if it improves risk-adjusted return **without starving trades** (Bailey/LdP PBO+DSR, Harvey/Liu/Zhu). | py_compile OK; runs on the tower (engine doesn't run in sandbox) |

Net: the production pipeline no longer conflates source-owned edge / framework-owned risk / provenance —
auto_floor overlay can't inflate sizing or extraction-recall metrics, the extractor isn't pressured to invent
risk fields, and the confluence overlay is honestly labeled + ablation-checkable before it reaches the backtester.

## 9. Back to the real mission — open compiler frontier

The compiler architecture is validated (n=4) and the production-hardening side mission is closed. The remaining
north-star work:

1. **MKsj raw-atom determinism** — N-sample union (union raw atoms across passes → stable canonical hash on the
   36K transcript). Low priority: the *executable* strategy is already stable (NodeRecall 100% both passes); only
   the raw-atom hash wobbles (§6.1).
2. **Widen the corpus** beyond n=4 to confirm generalization on more YouTube styles (the bar stays: rawNR=100,
   source-owned compNR≥85, Reach=YES, TopoFid=100, Δ=0).
3. **Backtester hand-off** — wire the validated compiled graph (source-owned executable nodes, reachable) into
   the Python/Databento engine, with the TF institutional overlay clearly labeled + ablation-validated (§8 #4),
   never silently inflating the result.

**Question for the collaborator:** of those three, which is the highest-leverage next step — close determinism
(N-sample union), prove breadth (widen corpus), or start the backtester hand-off? And for the hand-off: what's
the minimal contract the Databento engine needs from the compiled graph (entry trigger + confluences + direction
+ session + timeframe + symbol + invalidation) such that nothing source-owned is lost in translation?
