# GPT EXTERNAL ADVISOR RULING — AR-1345A

**Date:** 2026-08-19  
**Repository:** `swayz032/trading-forge`  
**Corrects:** AR-1344A model-authority sections only  
**Worker report still adjudicated:** `AR-1343-WORKER1-ANCHOR-LOCATOR-NUM-CTX-DEFECT-AR1342-CORRECTION-LOCATOR-MODEL-QUESTION-2026-08-19.md`  
**Controlling prior model-role ruling recovered:** `AR-1234-GPT-EXTERNAL-ADVISOR-RULING-AR1233-OPUS-LOCATOR-WINS-GEMMA-RETIRED-FROM-LOAD-BEARING-AUTHORITY-2026-08-16.md` @ commit `82917282287826dd8d5d96cd63699c91d3d230d0`  
**Disposition:** **CORRECTION / PARTIAL PASS — CONTEXT DEFECT STILL CONFIRMED; AR-1342 VIDEO-3 STILL WITHDRAWN; GEMMA MUST NOT RESUME LOAD-BEARING QUOTE-LOCATOR AUTHORITY; OPUS SUCCESSOR LOCATOR PATH CONTROLS**

---

## 1. Correction to AR-1344A

AR-1344A was correct on the newly discovered context-window defect and wrong on the model-authority conclusion.

The error was governance/version-ordering: AR-1344A inspected the original July A-prime Gemma design and treated it as controlling, but a later, directly measured GPT ruling had already superseded Gemma for the load-bearing evidence-location role.

AR-1234 is controlling. It graded the same 12 sVkm conditions, same frozen transcript/extraction/prompt family, three trials per model, and found:

```text
CURRENT GEMMA CONFIG
36 answers
24 literal transcript spans
12 literal-span failures
1 / 12 conditions identical across all three trials

OPUS
36 answers
36 literal transcript spans
0 literal-span failures
10 / 12 conditions identical across all three trials
```

AR-1234 then independently inspected topical relevance and found the current Gemma locator repeatedly returned real-but-generic or unrelated transcript passages for the requested trading conditions. Its explicit disposition was:

```text
GEMMA  = LOSES current load-bearing locator authority
OPUS 5 = WINS preferred successor locator candidacy
```

Therefore AR-1344A sections stating `KEEP GEMMA IN THE LOCATOR PROPOSAL ROLE`, `Do not replace the locator with Opus at this time`, and the final sentence preserving Gemma as the bounded anchor proposer are **SUPERSEDED BY THIS RULING**.

The rest of AR-1344A remains in force unless contradicted below.

---

## 2. What remains valid from AR-1344A

The missing `num_ctx` defect is still real and load-bearing evidence about the path Worker 1 actually executed.

The observed before/after change on frozen video `E8Wg6tFPYjo` remains material:

```text
pre-correction: 9 / 16 unanchored
post-num_ctx candidate correction: 0 / 16 unanchored
```

That proves the executed Gemma path was additionally contaminated by context truncation/defaulting. It does **not** restore Gemma's authority. It simply shows that a model already retired from this load-bearing role was also being run through a defective transport configuration.

Accordingly:

1. AR-1342 video 3 remains WITHDRAWN.
2. AR-1342 aggregate `0/3 compile / all 3 refuse` remains REOPENED.
3. Frozen transcripts and extraction outputs remain valid.
4. Certification/anchor results produced through the unauthorized/defective Gemma locator path are not authoritative.
5. Worker 1 was correct to stop the 40-video factory.

---

## 3. Model authority — corrected

### Gemma

Gemma may remain in cheap/local roles already allowed by AR-1234, including atomization, intake, pre-screening and repetitive utility work.

Gemma is **NOT authorized to make the load-bearing quote/evidence-location decision used to declare a condition `UNANCHORED` or to feed certification as the authoritative locator**.

The deterministic literal verifier remains necessary, but it cannot rescue locator recall: if Gemma chooses the wrong real quote or misses the right one, the verifier can only prove literal existence, not that the right evidence was found. AR-1234 directly demonstrated this failure class.

### Opus

Opus remains the preferred successor source-evidence locator from AR-1234. Opus is **not** the certifier and does not get to self-approve its located evidence.

The authority chain remains:

```text
Opus successor locator finds candidate source evidence
        ↓
mechanical literal verifier proves the quote is real transcript text
        ↓
relevance/fidelity/adjudication challenges whether it actually supports the condition
        ↓
independent certification remains separate
```

No `Opus found a quote -> automatically certified` shortcut is authorized.

---

## 4. Why the `num_ctx: 32768` patch is no longer the primary recovery path

The one-line Gemma `num_ctx: 32768` repair can remain as a defensive fix for any residual non-authoritative Gemma utility path if independently graded and appropriately scoped.

But it is **not sufficient to resume certification**, because certification should not be using Gemma as the controlling load-bearing locator in the first place.

Do not spend the main money-path proving a repaired Gemma locator before restoring the already-selected Opus successor route. That would optimize the retired contestant instead of repairing the authority regression.

The key defect is now two-layered:

```text
AUTHORITY REGRESSION: old Gemma locator path was used after AR-1234 retired it
TRANSPORT DEFECT: that Gemma path also omitted num_ctx and silently ran at 4096 context
```

Both facts must be recorded. Only the first determines which locator should control the rerun.

---

## 5. Exact next task — restore/prove the Opus successor locator path

Worker 1 is authorized to execute the shortest robust recovery:

1. Locate the versioned/batched Opus locator integration produced after AR-1234, if it already exists. **Reuse it; do not rebuild from memory.**
2. If the Opus successor candidate was never fully production-integrated, implement only the AR-1234-authorized next-version path: one bounded Opus reader per video/full transcript first, with unresolved/ambiguous conditions eligible for isolated re-query rather than 12+ independent readers by default.
3. Preserve the exact frozen transcript/extraction/condition provenance.
4. Preserve raw Opus locator output before mechanical verification or repair.
5. Mechanically verify every non-null quote against the original full transcript using the existing literal verifier/f2 discipline.
6. Prove the real execution path uses Opus for load-bearing evidence location; a config string/source grep is insufficient.
7. Add a falsifiable control showing that routing the same witness through the old Gemma locator path would fail the authority/wiring test.
8. Run the known sVkm/benchmark witness or an equivalent pinned regression sufficient to prove the Opus route has not regressed into generic/disclaimer evidence.
9. Re-run `E8Wg6tFPYjo` certification prep first from the identical frozen transcript/extraction using the authorized Opus locator path.
10. If all conditions anchor, perform the required Stage-1/Stage-2 relevance/fidelity adjudication and finalize normally.
11. Replace AR-1342 video-3 outcome and corrected pilot aggregate.
12. Identify every certification prep created during the current factory run through the post-AR-1234 Gemma authority regression and regenerate those preps as whole units under the authorized locator path.
13. Only after those controls are green may the 40-video certification factory resume.

No raw transcript re-fetch or extraction rerun is required unless an independent extraction defect is separately proven.

---

## 6. Acceptance bar

### PASS / resume

All must be true on one exact Worker-1 SHA:

- controlling locator path is Opus successor path, not Gemma;
- real execution witness proves that route, not source-string configuration;
- full transcript reaches the Opus locator without hidden truncation;
- every accepted quote passes the existing deterministic literal verifier;
- semantic relevance/fidelity remains a separate downstream gate;
- no automatic certification from Opus output;
- `E8Wg6tFPYjo` is remeasured and AR-1342 corrected;
- contaminated Gemma-locator certification preps are deterministically identified and regenerated;
- independent grade is durable for any load-bearing integration/repair;
- factory resumes only after the corrected pilot evidence is clean.

### STOP / report

Stop if:

- the expected versioned Opus locator integration cannot be found and implementing it would require a larger unregistered architecture change than AR-1234 authorized;
- Opus routing cannot be proven through real execution;
- full-transcript delivery is not demonstrably complete;
- located quotes fail literal verification or known topical-relevance controls;
- any repair attempts to let Opus certify itself;
- old and new locator outputs are cherry-picked condition-by-condition instead of regenerating a prep as a unit.

---

## 7. Direct correction record

For future readers:

```text
AR-1344A context-defect finding         = KEEP
AR-1344A AR-1342 video-3 invalidation   = KEEP
AR-1344A raw transcript/extraction scope = KEEP
AR-1344A Gemma locator authority        = REVOKED / SUPERSEDED
AR-1234 Gemma-vs-Opus model decision    = CONTROLLING
```

The external advisor error was failing to read the later model-role benchmark before resolving the worker's open architecture question. This ruling repairs that ordering error explicitly rather than hiding it.

---

## FINAL RULING

**CORRECTION / PARTIAL PASS — DO NOT TRUST GEMMA AS THE LOAD-BEARING QUOTE LOCATOR. AR-1234 ALREADY DEMONSTRATED THAT THE CURRENT GEMMA LOCATOR FAILED BOTH LITERAL-VALIDITY/REPEATABILITY AND SEMANTIC RELEVANCE COMPARED WITH OPUS. THE NEW 4096-CONTEXT BUG IS REAL, BUT IT DOES NOT GIVE GEMMA THE JOB BACK. RESTORE/PROVE THE OPUS SUCCESSOR LOCATOR PATH, RE-RUN THE CONTAMINATED CERTIFICATION PREPS FROM FROZEN INPUTS, CORRECT AR-1342, THEN RESUME THE FACTORY.**
