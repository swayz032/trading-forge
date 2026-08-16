# GPT EXTERNAL ADVISOR RULING — AR-1200 · 2026-08-15

## sVkm REAL-GRADE REFUSAL IS VALID. DO NOT CERTIFY. KEEP THE LITERAL VERIFIER; INVESTIGATE THE LOCATOR PROPOSAL LAYER BEFORE SPENDING THE 7 BLIND-RATER CALLS.

```
RULING ON : AR-1199 — WORKER-SVKM-REAL-GRADE-REFUSES
WORKER SHA : 712b433cff8b2afbd2bec6f3543fb739aae1af11
BASE SHA   : 5a82f6f51eeb0d6b47976f83a73cfa8446ca0013
WORKER BR  : claude/worker1-h1-20260815
GRADE      : ACCEPT WORKER REPORT / REJECT CERTIFICATION
CERT       : RED — certificate_grade=False remains authoritative
NEXT       : locator-binding diagnostic FIRST; stop-geometry context proof in parallel
```

---

## 1. INDEPENDENT GITHUB VERIFICATION

I did not grade AR-1199 from its prose. I inspected the worker commit, diff, drivers, frozen conveyor implementation, extraction artifact, phase-1 artifact, and certificate artifact in GitHub.

### 1.1 Commit scope is truthful

GitHub compare shows worker SHA `712b433c...` is exactly **one commit ahead** of base `5a82f6f5...` and changes exactly six paths:

- `scripts/svkm_grade_phase1.py` — added
- `scripts/svkm_grade_phase2_certificate.py` — added
- `docs/replay-results/svkm-extraction-certified/grade/phase1.json` — added
- `docs/replay-results/svkm-extraction-certified/grade/certificate.json` — added
- `docs/replay-results/svkm-extraction-certified/grade/phase1_preps.pkl` — added
- `docs/designs/SYSTEM-INVENTORY.md` — regenerated

**No `src/` file changed.** The report's scope statement is correct.

### 1.2 The new phase-1 driver consumes the existing instrument instead of re-authoring it

`scripts/svkm_grade_phase1.py` imports:

- `src.engine.extraction.pilot_conveyor as pc`
- existing `scripts/h1_pilot_phase1.py as p1`

and invokes the existing production path:

`pc.prepare_video(... propose_fn=p1.robust_propose)`

The driver contains hard transcript and extraction identity pins before running the grade. I found no second comparator, alternate grading rule, synthetic success flag, or `src/` rewrite in the worker commit.

### 1.3 The certificate driver also consumes the existing instrument honestly

`scripts/svkm_grade_phase2_certificate.py` calls:

`pc.finalize_certificate(prep, [], tier3_support=None)`

followed by:

`pc.diagnose_certificate(cert, prep.get("unanchored_conditions", []), [])`

The empty tier-3 list is genuinely an absence of adjudication; the worker did not manufacture blind-rater verdicts.

### 1.4 The frozen conveyor itself owns the red result

The existing `src/engine/extraction/pilot_conveyor.py` explicitly post-processes any non-empty `unanchored` set by forcing:

- `pilot_grade = False`
- `full_grade = False`
- `certificate_grade = False`

Therefore the worker did **not** invent the refusal in its driver. The frozen instrument owns it.

### 1.5 The committed artifacts match the headline numbers

`phase1.json` records:

- spine conditions: **12**
- anchored: **7**
- unanchored: **5**
- anchored fraction: **0.5833**
- tier-1 classified: **0**
- tier-1 fall-through: **7**
- fall-through pending tier-3: **4**
- fall-through dual-read disagreement: **3**
- all five unanchored reasons: `proposed_quote_not_literal_substring`

`certificate.json` independently records:

- `pilot_grade=false`
- `full_grade=false`
- `certificate_grade=false`
- `dry_run=false`
- `unanchored_condition_count=5`
- diagnosis = `5 unanchored / 7 classification_fallthrough_unresolved / 0 ok`
- `tier3_verdicts_supplied=0`
- `tier3_support_supplied=0`

This is internally consistent with the report.

### 1.6 One evidence qualification

AR-1199 reports `137 passed in 1.36s` from the local worker tree. GitHub currently exposes **no commit status checks and no workflow runs** for worker SHA `712b433c...`, so I cannot independently reproduce that exact local test count from GitHub CI.

This does **not** overturn the artifact/implementation ruling above; it means the `137 passed` line is accepted only as disclosed local evidence, not as independently observed CI evidence.

---

## 2. PRIMARY RULING: THE RED CERTIFICATE STANDS

**DO NOT CERTIFY THIS EXTRACTION.**

Do not write `EXTRACTION_CERTIFIED`.
Do not compile it into a trading spec.
Do not backtest it.
Do not paper-trade it.
Do not route it toward Topstep/live execution.
Do not hand-edit the extraction or certificate to make the numbers green.

AR-1199 stopped at the correct safety boundary.

The worker gets credit for stopping instead of laundering a failed grade into a pass.

---

## 3. RULING ON AR-1199 FORK (B): KEEP THE LITERAL-SUBSTRING VERIFIER

AR-1199 asks whether the anchor-locator's literal-substring contract is the wrong gate.

### Answer: **NO — the literal verifier is not the defect and must not be weakened.**

`anchor_locator.py` has the right safety architecture:

1. Gemma proposes a quote.
2. Mechanics verify that the proposed quote resolves to real transcript bytes under whitespace normalization only.
3. Only the literal transcript slice becomes the certificate anchor.

That is exactly the anti-hallucination fence we want. **No fuzzy quote may become a certified anchor. No paraphrase may be accepted as if it were source text.**

However, AR-1199 exposed a different problem:

> a non-literal Gemma proposal is currently counted as an `unanchored` extraction condition even when a real supporting literal span may exist in the transcript.

That means the current measurement can conflate two different failure classes:

- **SOURCE / EXTRACTION FAILURE:** no adequate grounding span exists; versus
- **LOCATOR BINDING FAILURE:** adequate source text exists, but the proposal model failed to return it verbatim.

Those are not the same engineering failure and must not be silently attributed to the same layer.

### Therefore

**KEEP the mechanical literal gate. INVESTIGATE the proposal/binding layer. Do not loosen verification.**

The correct question is not "should fuzzy text count as an anchor?" It must not.

The correct question is "did the locator fail to bind an existing literal span?"

---

## 4. WHY THIS IS A REAL MEASUREMENT-CONTRACT CONCERN

The pinned extraction artifact itself already shows a dangerous shape:

- some extracted fields carry source `transcript_quote` text;
- some higher-level condition/rationale text is paraphrased;
- the locator is therefore responsible for recovering the correct source span;
- the locator prompt explicitly commands Gemma to copy verbatim;
- nevertheless all five failures are `proposed_quote_not_literal_substring`, while `propose_abstain_by_parse_failure=0`.

So these were not transport/JSON failures. They were proposal outputs that reached the mechanical verifier and failed the literal contract.

AR-1199 additionally reports mechanically located candidate source spans for several load-bearing facts, including the first-five-minute range and the explicit **close outside the 5m range** language. That is enough to justify a binding-layer diagnostic, but **not enough to retroactively green this certificate.**

Also accepted as an upward correction: the `speaker_concepts[].verbatim_description` stored in the pinned extraction contains the relayed wording `That now gives me a range...`, while AR-1199 reports the pinned transcript bytes contain `And what that now gives me is a range... Right? So ...`. The current GitHub artifact does not itself contain the full pinned transcript, so the exact transcript character-position claim remains worker-measured evidence rather than independently reconstructable GitHub evidence. It does not affect today's red-certificate ruling.

---

## 5. NEXT WORK ORDER — FASTEST ROBUST PATH

### LANE A — PRIMARY: PROVE OR REFUTE LOCATOR-BINDING FAILURE

**Read-only/diagnostic first. Do not edit `anchor_locator.py`, `pilot_conveyor.py`, the extraction, or the certificate.**

Use the exact pinned transcript and the five AR-1199 unanchored conditions only.

For each of the five:

1. Record `condition_ref` and condition text.
2. Record the exact candidate literal span(s) the worker believes support it, with char span and transcript SHA.
3. Feed each candidate through the **existing** mechanical verifier/locator seam as a diagnostic injected proposal. The candidate must still pass the current literal/coverage machinery; no fuzzy acceptance.
4. Record PASS/FAIL mechanically.
5. Do **not** let the worker decide semantic support. For any mechanically valid candidate, prepare the narrow existing blind support judgment needed to answer whether that exact quote actually expresses the extracted condition.

The proof target is binary:

- If an exact candidate passes the existing mechanical verifier and blind support says `confirmed`, then the prior unanchored result is proven to be a **locator proposal/binding false negative**, not source absence.
- If no mechanically valid + support-confirmed candidate exists, keep that condition genuinely ungrounded/unresolved.

### IMPORTANT

This diagnostic does **not** modify AR-1199's certificate. AR-1199 remains red forever as the historical result of that frozen run.

If the binding defect is proven, the next ruling will version a generic locator reliability repair and birth-gate it before any re-grade. **No sVkm-specific hardcoded quote or test-specific exception is authorized.**

### Do not run the seven tier-3 target adjudications yet

The certificate is already mathematically forced red by five unanchored conditions. Spending the seven blind-rater calls now cannot make this run pass.

For speed, **resolve the binding layer first**. If Lane A clears the five anchor failures under a legitimately versioned repair later, then run the seven fall-through adjudications once, on the proper candidate.

---

## 6. LANE B — PARALLEL, READ-ONLY: STOP-GEOMETRY CONTEXT PROOF

AR-1199 correctly refused to choose between:

- `bottom of the fair value candle` / include its wick; and
- `low of the fair value gap ... including the wick`.

I am **not authorizing a geometry guess** from two isolated phrases.

In parallel with Lane A, produce a tiny source-context artifact containing:

- at least ±300 characters around the span near `13800`;
- at least ±300 characters around the span near `18714`;
- the immediately preceding trade direction/example context for each;
- whether both statements refer to the same example, opposite-direction examples, or different teaching passes;
- no semantic rewrite and no code change.

The pinned extraction currently says `anchor: "fvg_low"` while its own `transcript_quote` says the stop is at the bottom of the **fair value candle**, including the wick. That mismatch is load-bearing. Until context resolves it:

**`fvg_low` MUST NOT silently compile as generic `fvg` geometry. Short-side symmetry MUST remain fail-closed.**

---

## 7. WHAT IS APPROVED / NOT APPROVED

### APPROVED NOW

- AR-1199 report as an honest and substantially verified worker result.
- Preserve worker SHA `712b433c...` as evidence.
- Lane A locator-binding diagnostic.
- Lane B stop-geometry context extraction.
- Parallel execution of A and B because they are read-only and independent.

### NOT APPROVED NOW

- certification;
- manual anchor replacement;
- fuzzy anchor acceptance;
- weakening literal-substring verification;
- changing the frozen instrument in place;
- sVkm-specific hardcoded repair;
- seven tier-3 adjudications before Lane A resolves the five forced-red anchors;
- compile/spec generation;
- backtest;
- paper/live execution;
- resolving stop geometry by intuition.

---

## 8. ENGINEERING GRADE

**Worker execution: PASS. Candidate certification: FAIL. Measurement attribution: OPEN.**

The worker did the important thing correctly: it ran the real gate, got a red answer, disclosed its own mistakes, preserved the evidence, and stopped.

The fastest robust engineering move now is **not** to push harder downstream. It is to separate `source unsupported` from `locator failed to bind source that exists` with one narrow proof, while simultaneously resolving the stop-geometry context.

That gives us the shortest path to a trustworthy re-grade without contaminating the instrument or wasting blind-rater work.

---

## 9. RETURN RECEIPT REQUIRED

Next worker report must return:

### Lane A
- exact 5-condition table;
- candidate literal span(s) per condition;
- current mechanical verifier result per candidate;
- blind support disposition only where mechanically valid;
- explicit classification per condition: `SOURCE_UNGROUNDED_OR_UNRESOLVED` vs `LOCATOR_BINDING_FALSE_NEGATIVE_PROVEN`;
- zero edits to frozen grading source during this diagnostic.

### Lane B
- both stop-geometry context windows;
- example/direction mapping;
- whether the two statements are actually contradictory after context;
- zero geometry implementation edits.

### Global
- exact commit SHA(s);
- changed-file list;
- tests/controls actually run;
- any evidence not independently reproducible in GitHub clearly labeled as local-only.

**STOP after reporting A+B. Do not self-authorize the re-grade or downstream compiler work.**
