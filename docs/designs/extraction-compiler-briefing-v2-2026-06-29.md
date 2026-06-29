# Briefing v2: the YouTube-strategy extraction compiler (for a new collaborator)

> Supersedes briefing v1 (`extraction-compiler-briefing-2026-06-29.md`). v1's open question ("how are graph
> EDGES produced?") is **answered and closed**. This document carries the new, narrower frontier. Read v1 first
> for mission + architecture; this is the delta. Defining discipline unchanged: **we move on observed evidence.**

## 0. The mission (unchanged)

Extract **100% of the trading strategy and every step a YouTube educator teaches** — faithfully and
*executably* — from the transcript, so a deterministic **Python backtest engine** tests the REAL strategy with
**no human interpretation**. It's a **compiler** for a strategy DSL hidden inside natural language. Two-stage
ownership: extraction captures the entry edge; the framework-overlay owns stop/TP/sizing (`framework_owned`).

## 1. What is now SETTLED (don't re-litigate these)

Each was *measured*, not assumed (n=4 unless noted):

1. **Recall is fine.** Omissions ~0. We do not miss decisions.
2. **The Decision Introduction Gate is stable.** DBA 100% across n=4. The is_decision boundary is reproducible.
3. **The deterministic graph compiler is correct and is the right architecture.** Edges are DERIVED STRUCTURE
   (procedural order → strategy grammar), NOT extraction outputs. `graph-compiler.ts` builds the CFG from a
   group-aware state-rank spine + AND-groups + OR-branches + exceptions. Gemma does NOT emit edges. On the
   audited psH gold it scores **TopologyFidelity 100%, Reachable YES** and correctly detected the bidirectional
   OR-branch — the compiler threads whatever atoms it's given **faithfully**.
4. **SGF is the north-star, not DRR.** Strategy Graph Fidelity = mean(NodeRecall, EdgeRecall, Reachability,
   TopologyFidelity) vs a hand-built GOLD graph. psH baseline **SGF 76%** (NR 88 / ER 17 / RG yes / TF 100).
   DRR (dependency-resolution rate) is retired as a misleading internal metric.
5. **Downstream noise-filtering is FALSIFIED as a precision fix.** This is the key new result — see §2.

## 2. The decisive new result — precision is an ABSTRACTION problem, not a classification problem

**AtomPurity (gold atoms / extracted atoms) on psH = 8/34 ≈ 24%.** ~76% of extracted atoms are non-essential.
That pollution is what caps EdgeRecall (17%): with ~26 noise atoms interleaved at the *same lifecycle ranks* as
the 8 real ones, the spine threads `real→noise` instead of `real→real-prerequisite`. The compiler is fine; the
**atoms** are polluted.

We then ran the pre-registered falsification — *does removing noise raise EdgeRecall without hurting NodeRecall?*
Two runs **bracket** the answer:

| filter | atoms | AtomPurity | NodeRecall | EdgeRecall | verdict |
|---|---|---|---|---|---|
| aggressive (multi-signal incl. connectivity) | 34→16 | 24%→50% | **88%→38%** | 17%→0% | **FAILED** (deleted real atoms) |
| fair (redundancy + generic + over-production) | 34→28 | 24%→29% | 88%→88% | **17%→17%** | **INCONCLUSIVE** (ER flat) |

Push purity hard → NodeRecall collapses. Stay safe → purity barely moves and EdgeRecall doesn't budge. **There
is no threshold that separates noise from signal**, because the noise atoms are *plausible decisions* on every
surface feature (rank, connectivity, redundancy, genericness). Formally `P(features|real) ≈ P(features|noise)`.
**Precision cannot be recovered downstream.** This eliminates a whole class of fixes: connectivity pruning,
redundancy collapse, rarity penalties, rank/centrality heuristics.

**The reframe (the important part):** the over-extraction is not "explanation mistaken for a decision" — it is
**one real decision fragmented into sub-features**. e.g. "wait for confirmation / I want strong displacement / I
want conviction / body-close strength" → 4 atoms (`WAIT_CONFIRMATION`, `WAIT_DISPLACEMENT`, `WAIT_CONVICTION`,
`WAIT_BODY_CLOSE`) for ONE gold `CONFIRMATION`. The fragments are all *valid* — just at the wrong abstraction
layer. That's exactly why filtering fails (you can't *delete* a valid sub-feature) and why **compression**
(merge/alias/preserve) is the natural operation.

**Hypothesis CONFIRMED by atom audit** (psH, the 34 extracted atoms tallied by type):
`"noise" = FalsePositive + OverFragmentation` with `OverFragmentation ≫ FalsePositive` — measured:

| gold decision | gold | extracted | fragments (sub-features of ONE decision) |
|---|---|---|---|
| WAIT_STRUCTURE (range + break) | 2 | **11** | candle formation×3, price action×2, price structure, price levels, "continuously re-", first-15min, 5min-close, *risk amount* |
| WAIT_CONFIRMATION (engulfing)   | 1 | **6**  | price action×2, indicator, direction, candle open, candle close-above |
| WAIT_RETEST (retest 15m high)   | 1 | **4**  | 5min retest, 5min high, 15min high, *risk reward ratio* |
| ENTER (+EXCEPTION downside)     | 2 | 3      | entry+*profit target*, downside, *profit taking level* |
| WAIT_SESSION                    | 1 | 1      | session ✓ (the one clean 1:1 match) |

GPT's exact illustration reproduced: `WAIT_CONFIRMATION` fragmented 6→1, `WAIT_STRUCTURE` 11→2. Of the ~26 noise
atoms: **~85% over-fragmentation** (sub-features of one real decision), **~12% framework leaks** (`risk amount`,
`risk reward ratio`, `profit target`, `profit taking level` — `framework_owned` that the gate should have caught),
**~3% true false-positives**. The dominant fix is a **semantic compression layer** (merge, not delete);
the secondary fix is a small gate tightening on the framework-leak vocabulary (orthogonal, cheap).

## 3. The new fork (this is the question for the collaborator)

v1's edge-production question is closed. The open question is now: **which source-level precision mechanism is
correct?** (Precision must move upstream of the compiler; surface filtering is dead.)

1. **Stronger gate** — a better per-clause `is_decision` test. *Weakness:* clause-local; cannot see that clause
   4 ("displacement") and clause 7 ("strong confirmation candle") collapse to one atom. Likely insufficient alone.
2. **Semantic compression layer (the new candidate, GPT's strongest bet)** — a phase BEFORE graph assembly that
   merges synonymous atoms and collapses sub-features into one canonical executable atom, carrying the merged
   atoms as `evidences[]` (conservation-law-preserving: nothing is deleted, many atoms → one canonical node +
   supporting spans). Pipeline becomes: `Clauses → Raw atoms → Semantic compression → Canonical atoms → Graph`.
   Asks "merge/alias/preserve?" (3-way, tractable) instead of the critic's "keep/delete?" (binary, hard).
3. **Semantic essentiality critic** — "if atom A is removed, can a deterministic trader still execute the
   strategy faithfully?" Stronger than a gate; moved earlier than originally planned. But binary keep/delete is
   harder than compression and risks the same NodeRecall damage the bracketing test exposed.

Recommended ordering to test (GPT): **compression first, essentiality critic second, gate tightening last** —
because the evidence says the dominant problem is *too many semantically-overlapping decisions*, which is a
compression problem. **Resist adding another LLM stage until the deterministic plumbing demands it**; if
compression needs a model, scope it to merge-decisions only (it's choosing equivalence classes, not generating).

## 4. The metrics to carry

- **SGF** (NR / ER / RG / TF vs gold) — the north-star. Currently only psH has a gold graph; build l-2 / h6T /
  MKsj golds to generalize beyond n=1.
- **AtomPurity** (gold / extracted) — the precision lever. Track before/after any compression change. Hypothesis:
  `EdgeRecall ∝ AtomPurity`. The milestone: AtomPurity ~24%→~50% should lift psH EdgeRecall 17%→~45–70% and SGF
  76%→~85–93% *without touching the compiler* — and **without dropping NodeRecall**. That double condition is the
  success test; NodeRecall dropping = the filter/merger is too aggressive (the bracketing failure mode).

## 5. Discipline (hold this)

Measure before tuning (n≥2 before "systematic") · classify/compress, don't prune (never destroy evidence) ·
advisory before enforcement · instrumentation (DRR, AtomPurity) ≠ science (SGF / graph preserves strategy) · no
goalpost-moving (one fair test, honest result — we did not re-tune the filter threshold to force a pass) · push
ambiguity upstream; keep later stages deterministic.

## 6. State of the code (branch `extraction/100pct-evidence`, FF-merged to `tf-deep-scan`)

`graph-compiler.ts` (Phase B, deterministic CFG) · `graph-fidelity.ts` (SGF + AtomPurity + psH GOLD) ·
`precision-feedback.ts` (multi-signal scorer — the FALSIFIED downstream approach; kept for the negative-result
record) · `decision-atom.ts` / `conservation-ledgers.ts` / `decision-graph-canonical.ts` / `clause-segmenter.ts`
(the verification spine) · `scripts/atomize-transcript.ts` (the vertical slice; runs gate → atoms → compile →
SGF → before/after feedback). gemma4:e2b local. ~30+ unit tests green; tsc 0.

**The one question to answer:** which source-level precision mechanism — stronger gate, **semantic compression
layer**, or essentiality critic — and in what order, given that (a) downstream surface filtering is falsified,
and (b) the leading hypothesis is that most "noise" is over-fragmentation (merge), not false positives (delete)?
