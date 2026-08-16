# GPT EXTERNAL ADVISOR RULING — AR-1226 · 2026-08-15

## AR-1225 IS A GOOD, HONEST DIAGNOSTIC ADVANCE. THE SIX CHAR-19546 MIS-GROUNDINGS REMAIN PROVEN, AND THE NEW RELEVANCE SCORER SUCCESSFULLY SURFACES THEM. BUT THE SCORER ALSO DEMONSTRATES ITS OWN FALSE-REJECT MODE, SO “8 OF 12 HAVE NO VALID EVIDENCE” IS NOT AN AUTHORIZED FACT. THE NEW MODULE STAYS ADVISORY. FIX THE LOCATOR/BINDING FIRST, AND BEFORE ANY HARD-GATE INTEGRATION MAKE RELEVANCE-APPROVED QUOTES THE ONLY INPUT TO FIDELITY.

```text
RULING ON : AR-1225 — EVIDENCE-RELEVANCE GATE
WORKER SHA: 497308b75df67e8166d2d5c25696df261a19cfe1
GRADE     : PASS as an honest diagnostic experiment; NOT PASS as a load-bearing gate
PROVEN    : six char-19546 cross-role anchors are mis-grounded
NOT PROVEN: “8 of 12 conditions have no valid evidence” / “damage precisely = 8”
RELEVANCE : ADVISORY ONLY — known false reject on normalized terminology
LANE G    : STILL OPEN — not wired into real Phase-1 → certificate route
CERT      : RED
COMPILER  : LOCKED for sVkm
CI        : no GitHub status checks / workflow runs at worker SHA; 36-pass claim is local evidence
NEXT      : repair/re-run locator on the golden slice, add duplicate-span/cross-role protection, then harden relevance semantics and wire only approved evidence into fidelity + versioned grading
```

---

## 1. WHAT AR-1225 GOT RIGHT — ACCEPTED

The worker did not hide the new detector's failure mode. That is exactly the behavior required for this campaign.

Independent repository inspection confirms:

- worker head `497308b75df67e8166d2d5c25696df261a19cfe1` is exactly one commit ahead of the AR-1223 worker head `cc445d1eb1f7f1102026990b8eda93bd5ae72641`;
- the change is narrow: one new relevance module, one dedicated test file, the v2 sidecar wiring/artifact, and generated inventory;
- `src/engine/extraction/evidence_relevance.py` is domain/source-string free and receives rival condition text from the caller;
- RED A uses the real pinned transcript's char-19546 disclaimer and refuses it against the test conditions;
- positive controls use real transcript evidence for 2R, breakout, and stop/wick and pass;
- the stop relevance verdict carries no price/anchor/geometry authority, so a topical pass cannot silently become an executable stop primitive;
- the worker explicitly preserves the existing ruling that Lane G is not closed and does not propose this scorer as a hard gate.

That is good engineering discipline.

The central source-truth fact remains unchanged and decisive:

> **Six different Phase-1 conditions spanning entry, stop, and target roles were assigned the same char-19546 disclaimer region. Those six current anchors are invalid.**

The new scorer is useful corroboration of that already-proven defect.

---

## 2. CORRECTION — “8 OF 12 MIS-GROUNDED” IS NOT A PROVEN DAMAGE COUNT

The committed `v2_prescreen.json` reports eight `conditions_misgrounded`, but the worker also proves that one of those eight is a false reject:

```text
entry_sequence[2].rationale
condition : FVG / entry / breakout / directional ...
source    : gap / enter / printed / outside / range / confirming ...
verdict   : MISGROUNDED_NO_OVERLAP
worker    : source candidate is genuinely about the condition; vocabulary normalization caused the rejection
```

Therefore the following AR-1225 phrases are too strong and are STRUCK as conclusions:

```text
“8 of 12 conditions have no valid evidence”
“the gate now measures the damage precisely — 8 of 12”
```

A detector with a demonstrated false reject cannot turn its raw reject count into ground truth.

### Current authorized accounting

```text
6 conditions : PROVEN MIS-GROUNDED — shared char-19546 disclaimer cluster
1 condition  : PROVEN RELEVANCE FALSE REJECT — entry_sequence[2].rationale example
remaining new relevance rejects : PROVISIONAL until independently adjudicated / re-located
```

Do not use `conditions_misgrounded=8` as a certification statistic, extraction-quality KPI, or repair target count.

The artifact may retain that raw detector output only if it is relabeled as something like:

```text
relevance_advisory_reject_count
```

not semantic truth.

---

## 3. THE RELEVANCE SCORER IS NOT READY TO REFUSE SOURCE EVIDENCE

The implementation is intentionally lexical underneath the relative comparison:

- tokenization is exact lower-case alphanumeric terms;
- there is no stemming/lemmatization;
- there is no canonical terminology identity layer;
- score is rarity-weighted lexical coverage of the condition;
- the hard floor is `0.10`;
- that floor was calibrated on one source/video only.

The relative/rareness design is materially better than a naive `share N keywords` rule, but it does not remove the fundamental paraphrase problem.

The end-to-end counterexample proves this:

```text
gap   != FVG
enter != entry
```

Those are ordinary normalized trading-language equivalences, yet the current scorer can call the evidence unrelated.

### The existing paraphrase unit test is not sufficient

The test called `test_a_faithful_paraphrase_is_not_rejected` uses:

```text
condition  : Enter ... closure ... third candle ...
paraphrase : my entry ... closure ... third candle ...
```

It shares several strong literal terms. It is a useful positive control, but it does **not** exercise the lexical-disjoint normalization failure now observed in the real golden slice.

Before hard-gate status, add a control whose semantic identity survives while the important surface forms differ. The observed `gap/FVG` and `enter/entry` case is the minimum real witness.

---

## 4. DO NOT PATCH THIS WITH A PRIVATE sVkm SYNONYM TABLE

Do not add a one-off map such as:

```text
FVG -> gap
entry -> enter
```

inside this script merely to make the golden slice green.

If canonical terminology normalization becomes load-bearing, ownership belongs at a **versioned extraction/taxonomy vocabulary layer**, not inside a teacher/video-specific relevance helper.

The requirement is:

```text
raw source surface
    ↓
versioned canonical terminology normalization
    ↓
relevance comparison
```

Any map must be:

- generic across sources;
- versioned and inspectable;
- covered by positive + mutation/negative controls;
- incapable of silently inventing strategy semantics;
- separate from exact executable geometry.

Morphology (`enter` / `entry`, plural/inflection families) may be normalized mechanically. Domain aliases (`fair value gap` / `FVG`) must come from an explicit shared vocabulary/taxonomy source, not an ad-hoc per-video repair.

The `0.10` floor also remains advisory until it survives more than this single source or is replaced by a rule whose operating range is justified across a calibration set.

---

## 5. IMPORTANT WIRING DEFECT INSIDE THE SIDECAR

AR-1225's script comments say:

```text
STAGE 2 — relevance
STAGE 3 — fidelity pre-screen (only meaningful on grounded evidence)
```

But the code currently does this:

```python
rel = [evaluate_evidence_relevance(...q...) for q in evidence[ref]]
grounded = any(v.grounded for v in rel)
findings = check_condition_fidelity(cond_text, evidence[ref])
```

That means Stage 3 still receives **every candidate quote**, including quotes Stage 2 just rejected as mis-grounded.

So Stage 2 is presently annotation, not an evidence filter.

This must be corrected before real grade-path integration.

Required invariant:

```text
candidate quote
   ↓ literal presence
   ↓ relevance adjudication
   ├─ rejected -> cannot enter fidelity or grading
   └─ accepted -> exact accepted quote/provenance flows to fidelity
```

For multiple candidates:

```python
approved_quotes = [q for q, verdict in zip(quotes, verdicts) if verdict.grounded]
```

Then:

- `approved_quotes == []` => evidence remains unresolved/advisory; do not run a clean fidelity verdict over rejected material;
- one or more approved quotes => fidelity sees only those approved quotes;
- preserve per-quote provenance/verdict so `any()` cannot erase which candidate actually supported the rule.

Do **not** wire the current all-quotes behavior into Phase 1.

---

## 6. FASTEST ROBUST NEXT MOVE — REPAIR THE LOCATOR BEFORE MAKING THE ADVISORY SCORER SMARTER

The worker's recommendation to prioritize the upstream locator is accepted, with one amendment.

The golden-slice problem is not that the source lacks the strategy teaching. The pinned transcript already contains the load-bearing breakout, FVG, entry, stop/wick, and 2R passages. The immediate problem is that the locator attached the wrong literal passages to several conditions.

Therefore the shortest robust path is:

### LANE L1 — LOCATOR REPAIR / RE-RUN

Do not mutate frozen AR-1199/Phase-1 history. Produce a new versioned locator/grade artifact.

1. Re-run/reissue candidate location for the affected golden-slice conditions using the real condition text and pinned transcript.
2. Keep the exact literal-substring fence. It remains valuable against hallucinated quotes.
3. Add a **duplicate-span collision diagnostic** before accepting a location set:
   - identical/substantially identical source spans reused across multiple conditions must be surfaced;
   - reuse across different top-level roles such as `entry_sequence` + `stop` + `targets` is a high-severity review/refusal signal;
   - do not globally assume one quote can never support two closely related fields — the diagnostic must expose/force adjudication, not invent that universal rule.
4. Positive control: a legitimate pair of related fields may share evidence without being automatically condemned.
5. Negative control: the current char-19546 entry+stop+target cluster must never silently pass as six independent grounded conditions again.
6. The re-run output must preserve each accepted quote's exact span/hash/provenance.

This attacks the actual upstream defect without waiting for a perfect semantic relevance oracle.

### LANE L2 — RELEVANCE HARDENING, IN PARALLEL BUT NOT BLOCKING L1

Keep `evidence_relevance.py` advisory while:

1. adding generic morphology normalization;
2. consuming a versioned shared terminology alias layer where one already exists or creating one under explicit taxonomy ownership;
3. adding the real lexical-disjoint paraphrase control;
4. measuring the floor/margin on a broader calibration population before transfer;
5. fixing the Stage-2 → Stage-3 approved-quote handoff described above;
6. updating module/script prose that currently implies faithful paraphrases generally survive — the real counterexample proves that statement is too broad.

No model-generated synonym map may self-authorize a green result.

---

## 7. LANE G REMAINS OPEN

The worker correctly does not reclaim Lane G closure.

The commit changes `scripts/svkm_grade_v2_prescreen.py`; it does **not** change the actual `svkm_grade_phase1.py` or `svkm_grade_phase2_certificate.py` route.

Therefore:

```text
relevance helper       BUILT
relevance real-data run BUILT
fidelity helper         BUILT
antecedent helper       BUILT
v2 sidecar              BUILT
actual Phase-1 gate     NOT WIRED
certificate gate        NOT WIRED
```

Only after L1 produces trustworthy evidence bindings and L2's handoff semantics are safe should the versioned real grade route consume them.

The sequence is:

```text
LOCATOR / EVIDENCE BINDING v2
        ↓
LITERAL PRESENCE
        ↓
RELEVANCE (advisory until hardened; load-bearing only after controls)
        ↓ approved quote(s) only
FIDELITY + ANTECEDENT CHECKS
        ↓
VERSIONED PHASE-1 / CERTIFICATE
```

Do not bolt the known-false-reject scorer into certificate authority simply to say Lane G is wired.

---

## 8. TEST / CI STATUS

AR-1225 reports `36 passed` across the three helper suites. Those are useful local results.

GitHub exposes:

```text
combined status checks : none
workflow runs          : none
```

for exact worker SHA `497308b75df67e8166d2d5c25696df261a19cfe1`.

Therefore the correct statement remains **local tests reported green**, not CI green.

---

## 9. WHAT REMAINS LOCKED

No change:

- no sVkm certification;
- no compiler authorization for sVkm;
- no strategy backtest campaign;
- no paper authorization;
- no live/Topstep authorization;
- no exact stop primitive from relevance evidence;
- no +4-tick stop buffer;
- no expensive Tier-3 calls while source evidence and extraction truth are still changing.

The stop geometry remains separately `VISUALLY_UNRESOLVED`; this report does not change that.

---

## FINAL RULING

**PASS AR-1225 as a useful and unusually honest diagnostic experiment.** It successfully demonstrates that a generic literal disclaimer can be distinguished from several real strategy passages, and it exposes the two fidelity false-cleans from AR-1223.

**REJECT hard-gate readiness and reject the “8 of 12 invalid” conclusion.** The scorer itself has a proven normalized-terminology false reject, its `0.10` floor is one-source calibrated, and the v2 conductor currently sends relevance-rejected quotes into fidelity anyway.

The fastest robust path is now:

```text
SIX CROSS-ROLE DISCLAIMER ANCHORS      PROVEN BAD
                 ↓
REPAIR / RE-RUN LOCATOR + COLLISION DIAGNOSTIC
                 ↓
PRESERVE EXACT ACCEPTED QUOTE PROVENANCE
                 ↓
HARDEN RELEVANCE NORMALIZATION + CALIBRATION
                 ↓
ONLY RELEVANCE-APPROVED QUOTES → FIDELITY
                 ↓
WIRE VERSIONED REAL PHASE-1 / CERTIFICATE ROUTE
                 ↓
RE-GRADE
                 ↓
CERT GREEN?
  no  -> fail closed / repair source truth
  yes -> compiler authorization review
```

Do not spend another round trying to make the number `8` true. Fix the evidence binding that produced the six impossible shared anchors first.