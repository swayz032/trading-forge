# Validation Pre-Registration — success/failure criteria FROZEN before replay

> **Purpose (operator, 2026-06-28):** define what counts as success and failure for each validation gate
> BEFORE any replay runs, so results can't be rationalized after the fact. This is a pre-registration: the
> thresholds below are the contract. **Changing any threshold AFTER seeing a result requires a dated,
> justified amendment in this file — never a silent edit.** That clause is the anti-goalpost-moving guard.
>
> Status: **SIGNED OFF + FROZEN 2026-06-28** (operator). The thresholds below are now the contract. Per the
> sign-off: do not change them unless a compelling methodological reason is discovered BEFORE validation
> results are collected; any change is a dated entry in the amendment log, never a silent edit. Each gate
> fails independently and each failure localizes to a layer (extraction / grounding / semantic / execution /
> engine).

## The framing that does NOT change with results

**The protocol is frozen; the hypothesis is NOT assumed true.** Freezing the criteria makes the experiment
fair — it does not imply replay or blind validation are likely to pass. Whether they pass is exactly what the
experiment determines. A positive result is more persuasive *because* the criteria predate it; a negative
result is still informative *because* the architecture localizes where/why it failed. Both outcomes produce
knowledge.

## Reporting discipline (applies to every gate)

Every finding is reported as **observation → hypothesis → tested conclusion**, never collapsed:
- a single result is an **observation**;
- a pattern across the calibration set is a **hypothesis**;
- only a pattern that survives the **blind** set is a **conclusion**.
A surprising replay result is the start of an investigation, not the end of one.

## Report format (frozen — every results report follows this order)

1. **Observed result** — the raw measurements against the frozen criteria (counts, rates, no spin).
2. **Gate outcome** — PASS / FAIL / INDETERMINATE strictly per this pre-registration.
3. **Localization** — which layer accounts for any discrepancy (extraction / grounding / semantic / execution / engine).
4. **Interpretation** — clearly separated from 1–3; explicitly labeled as interpretation, not measurement.
5. **Next experiment** — only if warranted by the localization (never "tune until it passes").

This order keeps evidence distinguishable from explanation, and is itself fixed before results arrive.

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

## Gate 1.5 — Semantic determinism (executability)

*Question: can a DUMB ENGINE execute the extracted strategy with no human interpretation?* Gate 1 proves
parity with the golden FORMAT; it does NOT prove the IR is backtestable. Gate 1.5 closes that gap.
Validator: `scoreDeterminism(ir)` in `src/server/lib/semantic-determinism.ts`.

Each EXTRACTION-OWNED field is scored PRESENT / IMPLIED / MISSING / AMBIGUOUS:
`direction` · `setup_context` · `entry_trigger` · `session_filter` · `invalidation`.
`stop_loss` / `take_profit` / `risk_model` are **FRAMEWORK_OWNED** (overlay-authoritative per §13) — satisfied
by construction, NOT scored as extraction gaps (scoring them MISSING would be a false-fail).

| | criterion |
|---|---|
| **PASS** | **0 MISSING and 0 AMBIGUOUS** on extraction-owned fields (operator's rule — a dumb engine can run it) |
| **FAIL → localizes to** | `entry_trigger` MISSING → confirmation never compiled (e.g. `confirmation_no_level` / `confirmation_would_overfire`) and not zero-wait → not backtestable · `setup_context` AMBIGUOUS → zone named without a resolvable ref · OR-alternatives unresolved → engine can't pick a branch |
| **faithfulness debt (reported, NOT gated)** | count of IMPLIED fields — executable defaults/inferences the engine CAN run but that were NOT taught ("Implied ≠ what-was-taught"). Surfaced so executability and faithfulness stay separate. |

*Why this gate exists:* "Gemma matches golden 100%" can mean "reproduces my format," not "the engine can run
it." Gate 1.5 is the difference between *parity* and *backtestability*.

## Gate 2 — Replay parity (execution fidelity)

*Question: does the compiled IR reproduce the educator's DEMONSTRATED entries on real OHLC?*

**A demonstrated entry is "reproduced" iff:** same direction AND entry bar within **±3 bars** of the
demonstrated entry AND entry inside the demonstrated level/zone OR within **0.5×ATR** of the demonstrated price.
**Replay is computed identically for every educator** — ONE preregistered replay definition (same fill model,
same ATR window, same bar tolerance), no per-educator tuning. The metric must be reproducible by re-running,
not reconstructed per video.

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

**GENERALIZES requires ALL THREE, each an INDEPENDENT hard requirement (operator sign-off — do not collapse
into one):**
1. **Blind replay ≥70%** (absolute floor — the blind set must itself be acceptable, regardless of the gap)
2. **Calibration − blind gap ≤15 pp** (no severe degradation from the tuned set)
3. **Edge NOT attributable solely to `STRUCTURAL_SIGNAL_SUSPECT` or `INFERENCE_NOISE`** (`verdict-harness.ts`)

*Why independent (operator's example): calibration=72%, blind=58% → gap=14% passes criterion 2, but blind=58%
fails criterion 1. Both must hold, so this case is correctly a FAIL, not a pass.*

| verdict | criterion |
|---|---|
| **GENERALIZES** | all three above hold |
| **OVERFIT** | criterion 1 or 2 fails because calibration is high but blind drops (gap >15 pp) |
| **LIMITED GENERALITY** | blind_rate <70% on its own (criterion 1 fails) — worst case blind <50% |

**Closure (`runVerdict({stratifyBy:"regime"})`):** STRUCTURAL_LAW (signal layer stable across regimes →
universal in this stratification) vs CORPUS_CONDITIONAL (varies → real but scoped). Both are valid results;
only STRUCTURAL_LAW supports a universality claim.

---

## Stopping rule (operator sign-off)

**The first failing gate determines the overall validation status.** If Gate 1 fails, the verdict is FAIL —
Gates 2/3 may still be run for DIAGNOSTIC purposes, but a green Gate 2 or 3 does NOT overturn a failed Gate 1.
Same downward: a passing Gate 3 never rescues a failed Gate 2. A failed prerequisite must be corrected and
**re-run** before the overall verdict can change. This prevents a successful later analysis from being
mistaken for overriding an earlier failed prerequisite (the gates are a chain, not a vote).

## Explicitly NOT pre-registered (kept simple by design — operator sign-off)

At this dataset scale, NO confidence intervals, p-values, Bayesian factors, or similar statistical machinery
on the validation gates. Transparent, reproducible metrics (counts, rates, layer attribution) are more
informative here than sophisticated statistics that the sample size cannot honestly support. (This is scoped
to the EXTRACTION-validation gates; the backtest/MC promotion stack — PBO/DSR/B14 CI — is a separate,
larger-n surface and keeps its statistics.) Add such machinery only if the corpus later grows enough to
genuinely support it — and only as a dated amendment.

## What survives / fails the central hypothesis

The central hypothesis — *"the compiler faithfully reconstructs educator strategies, and the edge is
attributable to grounded/perceptual layers, under replay on unseen data"* — is **SUPPORTED** only if Gate 1 ✓
AND Gate 1.5 ✓ (the strategy is actually executable) AND Gate 2 PASS AND Gate 3 GENERALIZES. Any other outcome leaves it a hypothesis, with the failing gate
naming exactly which sub-claim didn't survive. A negative result is still a result: it localizes the boundary
of what the system can faithfully compile, which is itself worth knowing.

## Amendments (append-only — the anti-goalpost log)

- **2026-06-28 — ADD Gate 1.5 (Semantic Determinism), before any validation results collected.** Rationale
  (operator): Gate 1 proves extraction-parity with the golden FORMAT, not that the IR is executable by a dumb
  engine — "matches golden 100%" can mean "reproduces my format," not "backtestable." Gate 1.5 (0 MISSING +
  0 AMBIGUOUS on extraction-owned fields; stop/tp/risk FRAMEWORK_OWNED) closes that gap and is inserted
  between Gate 1 and Gate 2 in the sequence. **Legitimate under the freeze:** added BEFORE results exist, so
  it cannot be goalpost-moving — it raises the bar, it doesn't relax one. No existing threshold changed.
  (Diagnostic baseline on the 4 frozen IRs at add-time: psH + h6T FAIL [entry_trigger MISSING — confirmation
  quarantine], l-2 + MKsjbL PASS — recorded as diagnostic, NOT a validation result.)
