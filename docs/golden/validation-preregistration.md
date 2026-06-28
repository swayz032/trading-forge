# Validation Pre-Registration — success/failure criteria FROZEN before replay

> **Purpose (operator, 2026-06-28):** define what counts as success and failure for each validation gate
> BEFORE any replay runs, so results can't be rationalized after the fact. This is a pre-registration: the
> thresholds below are the contract. **Changing any threshold AFTER seeing a result requires a dated,
> justified amendment in this file — never a silent edit.** That clause is the anti-goalpost-moving guard.
>
> Status: DRAFT for operator sign-off. Once signed, the numbers freeze. Each gate fails independently and
> each failure localizes to a layer (extraction / grounding / semantic / execution / engine).

## Reporting discipline (applies to every gate)

Every finding is reported as **observation → hypothesis → tested conclusion**, never collapsed:
- a single result is an **observation**;
- a pattern across the calibration set is a **hypothesis**;
- only a pattern that survives the **blind** set is a **conclusion**.
A surprising replay result is the start of an investigation, not the end of one.

---

## Gate 1 — Golden extraction verification (synchronization)

*Question: does the synced production path reproduce the verified branch on KNOWN inputs?*
Harness: `scripts/verify-extraction-golden.ts` vs `docs/golden/extraction-golden-2026-06-28.json`.

| | criterion |
|---|---|
| **SUCCESS** | all 4 golden videos: non-zero speaker-items; count within ±40% of golden; coverage verdict == golden; ideas count == golden; `validateGrounding` 100% (0 violations); existing extraction vitest suites green |
| **FAILURE → localizes to** | any video 0 speaker-items → `schemaOverride` not ported (sync incomplete) · grounding <100% → paraphrase leak (extraction regression) · coverage verdict flip → comparator/enumerator regression |
| **gate is cheap** | run this BEFORE spending any replay compute |

---

## Gate 2 — Replay parity (execution fidelity)

*Question: does the compiled IR reproduce the educator's DEMONSTRATED entries on real OHLC?*

**A demonstrated entry is "reproduced" iff:** same direction AND entry bar within **±3 bars** of the
demonstrated entry AND entry inside the demonstrated level/zone OR within **0.5×ATR** of the demonstrated price.

**Sample floor:** ≥2 demonstrated trades per video AND ≥10 demonstrated trades total — below this the gate is
**INDETERMINATE** (undersampled), never a pass or fail.

| verdict | criterion |
|---|---|
| **PASS** | ≥**70%** of demonstrated entries reproduced |
| **PARTIAL** | 50–70% reproduced → investigate localization; not a clean pass |
| **FAIL** | <50% reproduced |

**FAILURE → localizes to:** grounded-node miss → extraction gap · inferred-node miss → the inference was
wrong · fires-but-wrong-bar → execution/timing · never-fires → compilation/quarantine (e.g. the deferred
`confirmation_no_level` / `confirmation_would_overfire`) · engine signal absent → engine-attach.

**Explicitly EXCLUDED from parity:** EXITS. `framework-overlay` deliberately replaces educator exits with
Style C / adaptive — testing exit-parity against the educator is a category error. Replay parity tests the
ENTRY EDGE (what extraction owns), not the exit (what the framework owns).

---

## Gate 3 — Blind generalization

*Question: does the behavior hold on educators/styles the compiler never saw?*

**Corpus (predefined):** ≥3 educators, ≥2 strategy families, ≥2 instruments (per `minimum-validation-run.md`)
— diversity is required so "universal compiler vs fitted interpreter" is even computable.

| verdict | criterion |
|---|---|
| **GENERALIZES** | blind-set entry-reproduction ≥**70%** AND (calibration_rate − blind_rate) ≤ **15 pp** AND segregated edge is NOT `STRUCTURAL_SIGNAL_SUSPECT` and NOT `INFERENCE_NOISE` (`verdict-harness.ts`) |
| **OVERFIT** | calibration high but blind_rate drops >15 pp below it |
| **LIMITED GENERALITY** | blind_rate <50% across the board |

**Closure (`runVerdict({stratifyBy:"regime"})`):** STRUCTURAL_LAW (signal layer stable across regimes →
universal in this stratification) vs CORPUS_CONDITIONAL (varies → real but scoped). Both are valid results;
only STRUCTURAL_LAW supports a universality claim.

---

## What survives / fails the central hypothesis

The central hypothesis — *"the compiler faithfully reconstructs educator strategies, and the edge is
attributable to grounded/perceptual layers, under replay on unseen data"* — is **SUPPORTED** only if Gate 1 ✓
AND Gate 2 PASS AND Gate 3 GENERALIZES. Any other outcome leaves it a hypothesis, with the failing gate
naming exactly which sub-claim didn't survive. A negative result is still a result: it localizes the boundary
of what the system can faithfully compile, which is itself worth knowing.

## Amendments (append-only — the anti-goalpost log)

*(none yet — thresholds frozen at first commit; record any post-result change here with date + rationale)*
