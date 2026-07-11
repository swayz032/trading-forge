# Research Record — v1 (APPEND-ONLY permanent record)

> **This file is the scientific record, NOT the engineering dashboard.** It is append-only: each replay
> campaign adds a dated entry; **no entry is ever edited or deleted** once written. Engineering improvements
> live elsewhere (tests, the failure-taxonomy counts that drive dev) and may evolve freely — they must NEVER
> retroactively rewrite a conclusion here. Created BEFORE the first campaign so the first result is an
> *append*, not a hindsight-shaped creation (same discipline as the pre-registration).
>
> Two dashboards, kept separate (GPT/operator 2026-06-28):
> - **Engineering dashboard** (mutable, drives development): live PASS/FAIL + failure-taxonomy counts.
> - **Research record** (this file, immutable): per-campaign scientific measurements + threats to validity.

## What the project is

A deterministic research platform for **measuring the reconstructability of verbally-taught discretionary
trading strategies** — NOT "an AI that extracts YouTube strategies." The compiler / IR / extraction / replay
engine / taxonomy are *instruments*; the **corpus is the object of study.** This framing accommodates positive
AND negative findings: a result that educators rely on tacit/visual knowledge is evidence about the source
material, not merely a system failure.

## Two validation loops (never conflated)

| Question | Instruments | Answered by |
|---|---|---|
| **Software validity** — does the system behave as specified? | tests, IR invariants, closure, grounding, determinism | already GREEN offline |
| **Scientific validity** — does the specification model reality? | replay, blind corpus, failure taxonomy | **this record** (not yet run) |
Software validity can converge without scientific validity. "The implementation satisfies its spec" ≠ "the
spec reconstructs educator behavior." Only replay answers the second.

## Interpretation rule — do NOT optimize replay % alone

Faithful reconstruction is the objective, not coverage. A system that scores Replay 68% with 17% UNKNOWN / 14%
VISUAL (because it REFUSED to invent decisions) is a STRONGER scientific instrument than one scoring 81% by
guessing. Per the determinism invariant (`ir-freeze-policy-v1.md`), a high replay % bought by relaxing
UNKNOWN-stops is a regression, not progress. Always read replay % alongside the UNKNOWN/VISUAL/ambiguity split.

## Campaign acceptance criteria — experiment quality, NOT replay quality (pre-committed)

A campaign is a **methodologically successful experiment** iff ALL of the following hold — *regardless of
whether replay performance is 30% or 90%.* A scientifically successful campaign can produce a low replay
number that motivates substantial engineering; that is still a success at THIS layer.
1. **Every replay run produced a reproducible artifact package** (`assembleReproducibilityPackage`,
   `reproducible=true` — dataset_hash matches the corpus; market_data_hash + decision_record_ref present).
2. **Every failure was assigned exactly ONE taxonomy class BEFORE inspection** (measured-evaluation-before-
   diagnosis; the class came from signals, not from watching the video).
3. **Every observed representation gap was tested against the IR v2.0 governance threshold** — and explicitly
   either met it (→ proposes v2.0) or failed it (→ stays v1.0). No gap is acted on informally.
4. **An independent engineer can reconstruct every reported conclusion from the stored artifacts alone** — not
   from "we think it was around when we fixed X."

If any criterion fails, the campaign's *methodology* is flawed and its numbers are not yet citable — fix the
process and re-run (a NEW run_id), do not salvage the conclusion. This is the experiment evaluating itself.

## What Campaign 1 delivers — a BASELINE, not "proof"

A measured reconstruction rate under IR v1.0 · a measured failure-mode distribution · those distributions by
educator family / market / strategy style · evidence on whether the dominant limit is extraction /
representation / implementation / source material. That baseline is the reference point for every later
campaign. Campaign 1 is not expected to "succeed at replay" — it is expected to establish where the system
actually stands so the next investment is evidence-driven.

## Per-campaign record schema (each campaign = one append-only entry)

Corpus Version · IR Version · Replay Coverage · Behavioral Reconstruction (Gate 2) · Decision Coverage ·
Failure Distribution (full `dominantFailureClass` table) · Extraction Fidelity (Gate 1.75) · Execution
Determinism (Gate 1.5) · Confidence Notes · Known Threats to Validity.

---

## Campaign log (append-only)

### (no campaign run yet)
- **State:** instruments built + frozen; **zero replay campaigns executed.** Empirical section begins at the
  first run against an official (meets_minimum) corpus.
- **Known threats to validity (recorded in advance):**
  1. Corpus is **`1.0-seed`** — 4 videos, forex/generic, `meets_minimum=false`. Not the official corpus; no
     campaign should be recorded against it. Needs ≥18 videos / ≥3 families / **≥2 instruments incl. futures**
     (engine trades MES/MNQ/MCL; seed is forex-skewed → instrument-remap risk).
  2. **Replay engine not attached** (gated on engine-attach + stable supervisor W4.2). No behavioral
     reconstruction number can exist until it is.
  3. **Production branch divergence** — the running extraction backend (`hardening/phase-0`) lacks the verified
     extraction fixes; until synced, any live-pipeline number is confounded (use the verified branch only).
  4. Evidence_mode VISUAL_REQUIRED classification is heuristic and under-reports when a visual node failed to
     compile — interpret VISUAL_DEPENDENCY counts as a floor, not an exact measure.
