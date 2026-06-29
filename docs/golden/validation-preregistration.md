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

## Measured evaluation BEFORE diagnostic investigation (replay-phase bias guard)

When replay fails, there is a natural pull to open the video and immediately understand why. Preserve the
distinction — the same discipline as branch-freeze and pre-registration:
- **Measured evaluation:** the failure is COUNTED and CLASSIFIED (via `classifyReplayFailure`) **before** any
  human inspects the source. The class is recorded from the available signals (gate outcomes / evidence_mode /
  data availability), not from watching the video.
- **Diagnostic investigation:** inspecting the video to understand a failure is allowed and useful — but it
  happens AFTER the failure is counted, and it **never retroactively reclassifies** a counted failure or
  adapts the evaluation. (If inspection reveals the taxonomy itself is wrong, that is a dated amendment to THIS
  file, not a silent re-label of past results.)

**Negative evidence is a result, not a disappointment.** A failure distribution dominated by VISUAL_DEPENDENCY
+ EDUCATOR_AMBIGUITY supports the conclusion that the limit is the SOURCE MATERIAL, not the representation —
scientifically valuable even at low coverage. A distribution dominated by COMPILER_DEFECT justifies reopening
the IR under the freeze policy. Both are wins because both are attributable. Report the full distribution
(`dominantFailureClass`), never just a coverage percentage.

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

## Gate 1.75 — Extraction completeness (no missing/invented decisions)

*Question: did we capture every DECISION the educator used — not just is it executable?* Distinct from Gate 1.5:
a strategy can be **executable but incomplete** (e.g. extracts "enter on bullish engulfing" but omits "don't
trade if the engulfing closes inside yesterday's range" → replay loses a large fraction of trades). Gate 1.5
passes (runnable); the strategy is still **wrong**.

**Rules vs explanations:** score only **executable rules** (contain an operator/condition/level/time — e.g.
"close above the EMA"). IGNORE explanations/rationale ("we want buyers to step in", "look for momentum") —
the extractor must NOT be rewarded for capturing prose, only decisions.

**Each educator decision-rule is scored:** Captured · Partially-Captured · Missed · Hallucinated.

| | criterion |
|---|---|
| **PASS** | 0 Missed AND 0 Hallucinated decision-rules (Partially-Captured is reported as completeness debt) |
| **FAIL → localizes to** | Missed → recall gap (a taught rule absent) · Hallucinated → invention (a rule not taught) · Partial → under-specified rule |

**Engine:** this is the existing coverage gate (`extraction-coverage-gate.ts` enumerator + comparator) applied
at **decision-rule granularity** with the rules-vs-explanations filter — NOT net-new architecture. The
Captured/Partial/Missed/Hallucinated taxonomy + the explanation filter are the additions; the full
decision-level scorer is built at sync time when the coverage enumerator runs live (no offline pre-build).

### Evidence-mode tag (replay-attribution, runs alongside Gate 1.75 — diagnostic, not a gate)
`classifyEvidenceMode(ir)` (`evidence-mode.ts`) labels each strategy TRANSCRIPT_ONLY / VISUAL_REQUIRED / MIXED
by how chart-referential its decisive logic is. Recorded BEFORE Gate 2 so a replay miss on a VISUAL_REQUIRED
strategy can be attributed to **visual-grounding debt** (the transcript can't carry the chart referent) rather
than a bad strategy. Heuristic, not a pass/fail.

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

## Replay failure taxonomy (pre-registered — every Gate 2/3 failure gets a class)

A failed replay is never recorded as bare "FAIL." It is classified into exactly one class, in a fixed
precedence (deeper cause never mislabeled as shallower), by `classifyReplayFailure()` — each class detected by
an instrument that already exists, and each directing the next engineering investment:

| class | detected by | directs investment to |
|---|---|---|
| DATA_REPLAY_LIMIT | demonstrated bars unavailable | data coverage (not extraction) |
| COMPILER_DEFECT | Gate 1.5 (entry_trigger MISSING) | the compiler (e.g. the P1 quarantines) |
| EXTRACTION_MISS | Gate 1.75 (Missed rule) | recall (coverage/repair loop) |
| VISUAL_DEPENDENCY | evidence_mode = VISUAL_REQUIRED | **multimodal extraction (chart context)** |
| FRAMEWORK_MISMATCH | entry reproduced, overlay diverged | framework-overlay ↔ educator reconciliation |
| EDUCATOR_AMBIGUITY | faithful extraction of a vague source | source limit — not fixable downstream |
| UNKNOWN | none of the above | manual escalation — never default-blame |

Precedence: data → compiler → extraction → visual → framework → source → unknown. The corpus-level
`dominantFailureClass()` is the payoff: if most failures are VISUAL_DEPENDENCY the next investment is
multimodal extraction; if COMPILER_DEFECT, the compiler is the bottleneck; if EDUCATOR_AMBIGUITY, the limit is
the source material itself. This converts replay from a verdict into a roadmap.

## What survives / fails the central hypothesis

The central hypothesis — *"the compiler faithfully reconstructs educator strategies, and the edge is
attributable to grounded/perceptual layers, under replay on unseen data"* — is **SUPPORTED** only if Gate 1 ✓
AND Gate 1.5 ✓ (executable) AND Gate 1.75 ✓ (complete — no missed/invented decisions) AND Gate 2 PASS AND
Gate 3 GENERALIZES.

## Execution-layer contract (pre-defined before the engine — `decision-status.ts`)

The state-machine IR already IS the decision graph (S0–S8 nodes; activation/context/trigger are 3 separate
nodes; per-node grounding). Two contracts are pre-defined for the replay engine to honor:
- **Epistemic status (extraction layer, where confidence lives):** KNOWN / **UNKNOWN** / VISUAL_ONLY /
  FRAMEWORK / IMPLIED. UNKNOWN ("educator had a decision here but never verbalized it") is DISTINCT from null
  ("no decision") — they localize differently at replay.
- **Execution resolution (execution layer — BINARY, no confidence):** every required condition resolves to
  TRUE / FALSE / UNKNOWN / UNOBSERVABLE — never "probably / 0.63." **No-guess rule:** any required condition
  that resolves UNKNOWN/UNOBSERVABLE → the strategy is NOT faithfully executable (the engine must not invent
  behavior the educator never specified). `decisionCoverage = executable / expected` decisions (not field coverage).
- **Per-trade proof tree (DEFERRED to replay-time — needs the engine):** every executed trade must be
  traceable to a complete proof tree (each node TRUE + grounded to a span); any UNKNOWN node → incomplete
  proof → not a faithful reproduction. This makes every backtested trade *auditable*. Built when replay exists.

## Decision closure (dependency proof) + the three independent proofs

**Decision Closure** (`decision-closure.ts`, `checkDecisionClosure`) — a static graph-integrity check
(compiler verification, NOT new representation): the IR's decision graph must have no IMPOSSIBLE_STATE (entry
unreachable / wait with no anchor), no DANGLING_REF (a ref no upstream node provides), no ORPHAN_NODE, no
CYCLE. Catches "a trade that can never legally be reached" statically, before replay.

**A faithful executable trade requires THREE independent proofs** (`threeProofs`) — all must hold:
1. **Evidence proof** — every condition has transcript provenance (`grounding-validator.ts`).
2. **Decision proof** — every required condition resolves TRUE/FALSE, none UNKNOWN/UNOBSERVABLE (`semantic-determinism` + `decision-status`).
3. **Dependency proof** — every required parent node exists + entry is reachable (`decision-closure.ts`).
Any one fails → no trade. (At replay, the per-trade proof tree is the runtime instantiation of these three.)

## First-class invariant — Executable Strategy IR

The IR's contract is **backtestability**, not representation: **every extraction-owned node is PRESENT or
FRAMEWORK_OWNED — never AMBIGUOUS, never MISSING.** That is exactly what `scoreDeterminism` (Gate 1.5)
measures. An IR that violates it is not a "lower-quality extraction"; it is a non-executable artifact and must
quarantine, not ship.

## Validation target (corrected — operator/GPT)

NOT "100% textual extraction." The target is **100% semantic executability for all extraction-owned rules,
every rule grounded to transcript evidence, no missing decision points, no hallucinated rules.** Rationale:
some educators are genuinely ambiguous; some omit assumed prior knowledge; ASR distorts words; two equivalent
formulations differ syntactically but have identical trading semantics. If the engine executes the strategy
exactly as taught, superficial wording differences are immaterial. Any other outcome leaves it a hypothesis, with the failing gate
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
- **2026-06-28 — ADD Gate 1.75 (Extraction Completeness) + Executable-IR invariant + evidence_mode tag +
  corrected target, before any validation results.** Rationale (GPT/operator): (a) Gate 1.5 proves executable,
  not complete — a runnable strategy that omits a taught decision-rule is still wrong (completeness ≠
  determinism); scored Captured/Partial/Missed/Hallucinated on RULES only (explanations ignored). (b) The
  IR's contract is backtestability (PRESENT or FRAMEWORK_OWNED, never AMBIGUOUS/MISSING). (c) `evidence_mode`
  segregates visual-grounding-debt from bad-strategy at replay. (d) Target corrected from "100% textual" to
  "100% semantic executability, grounded, no missing/invented decisions." All ADD bars before results — never
  relax one. Also RECLASSIFIED the confirmation-compiler quarantines from "optimization" to **Known P1
  semantic defect (quarantined by protocol)** — deterministic, same subsystem/symptom; still no fix before
  replay, but it is a known defect class, not a nice-to-have.
- **2026-06-28 — PRE-REGISTER the replay failure taxonomy, before replay exists.** 7 classes
  (DATA_REPLAY_LIMIT / COMPILER_DEFECT / EXTRACTION_MISS / VISUAL_DEPENDENCY / FRAMEWORK_MISMATCH /
  EDUCATOR_AMBIGUITY / UNKNOWN) with a fixed precedence — `classifyReplayFailure()` + `dominantFailureClass()`
  (`replay-failure-taxonomy.ts`). Defining the categories before results prevents post-hoc attribution; each
  class maps to an existing instrument (Gate 1.5 / 1.75 / evidence_mode / overlay) and directs the next
  investment. Pure addition — changes no threshold.
- **2026-06-28 — ADD Decision Closure (dependency proof) + three-proof gate + decision-status vocabulary
  (UNKNOWN/binary-execution), before results.** `decision-closure.ts` (graph integrity: no impossible-state /
  dangling-ref / orphan / cycle) + `threeProofs` (evidence ∧ decision ∧ dependency) + `decision-status.ts`
  (EpistemicStatus incl. UNKNOWN ≠ null; ExecutionResolution binary; no-guess rule; decisionCoverage). All
  static / pre-replay-appropriate; the per-trade proof tree is the replay-time runtime instantiation
  (deferred — needs the engine). Closure diagnostic on the 4 frozen IRs: psH + h6T IMPOSSIBLE_STATE (entry
  unreachable — converges with Gate 1.5), l-2 + MKsjbL closed. Pure additions — no threshold changed.
- **2026-06-28 — FREEZE the IR as a versioned spec (v1.0) + Representation Change Policy.** `IR_VERSION="1.0"`
  stamped in `state-machine-ir.ts`; full governance in `docs/golden/ir-freeze-policy-v1.md`. A representation
  change (new node type / execution semantic) is permitted ONLY with ≥3 independent replay failures across ≥2
  educators AND ≥2 families, classified as representation gaps (not extraction/visual/ambiguity), resolved
  without adding ambiguity or reducing determinism → that is IR v2.0, never a quiet v1.0 edit. The determinism
  invariant is NOT relaxed by replay (no "confidence>0.8 execute anyway"; reduced coverage from UNKNOWN-stops
  is a corpus finding, not a weakness). Governance only — changes no threshold, adds no representation.
- **2026-06-28 — ADD the measured-evaluation-before-diagnosis bias guard + negative-evidence norm, before
  replay.** A replay failure is counted + classified from available signals BEFORE any video inspection;
  diagnostic inspection happens after and never retroactively reclassifies a counted failure (a taxonomy
  change is a dated amendment, not a silent re-label). The full failure distribution is itself a result —
  report it, not just coverage %. Pre-committed now so the replay phase can't adapt the evaluation from what
  individual failures reveal. Governance only.
- **2026-06-28 — FREEZE the replay corpus + no-silent-reruns ledger + three-quantities reporting rule.**
  `replay-run-ledger.ts` + `docs/golden/replay-corpus-v1.json` (Corpus 1.0-SEED: 4 videos / 4 families / 3
  instruments, `meets_minimum=false` — needs ≥18 + futures). Corpus is hashed so coverage deltas are
  attributable; replay ledger is append-only (unique run_id + env manifest; reruns get a NEW id, never an
  overwrite; runs comparable only on matching dataset_hash). Reporting: never collapse extraction-fidelity
  (Gate 1.75) / execution-determinism (Gate 1.5) / behavioral-reconstruction (Gate 2) into one accuracy
  number. Operational governance only — no representation, no protocol threshold changed. **Fourth frozen
  layer: representation + protocol + governance + CORPUS.**
- **DEFERRED to post-replay (do NOT pre-build):** **Reconstruction Rate** = strategies that replay
  successfully / strategies that pass Gate 1.5. GPT-flagged as "after replay exists, not before" — it isolates
  the final research question (representation+extraction working vs source-unreconstructable) and is meaningless
  until replay produces real pass/fail. Recorded here so it's not forgotten, NOT built.
