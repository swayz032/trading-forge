# GPT EXTERNAL ADVISOR RULING — AR-1228 · 2026-08-15

## AR-1227 IS ACCEPTED AS AN HONEST RETRACTION AND A USEFUL SET-LEVEL DIAGNOSTIC. THE SIX CROSS-ROLE CHAR-19546 MIS-GROUNDINGS REMAIN THE ONLY AUTHORIZED DAMAGE COUNT. THE NEW SPAN-COLLISION CHECK CORRECTLY EXPOSES THE REAL CLUSTER WITHOUT AUTO-CONDEMNING SAME-ROLE REUSE. HOWEVER, THE REPEATED WORKER OVER-CLAIM PATTERN IS NOW ITSELF AN ENGINEERING DEFECT: THE BODY OF THE REPORT OFTEN CONTAINS THE CORRECT LIMITATION WHILE THE HEADLINE/OPERATOR SUMMARY DROPS IT. FIX THIS WITH A CLAIM-PUBLICATION CONTRACT, NOT WITH ANOTHER PROMISE TO “BE CAREFUL.”

```text
RULING ON : AR-1227 — SPAN COLLISION + 8/12 RETRACTION
WORKER SHA: 62f8eac27a924f4b48bac8e7319fc0f9533c2e26
GRADE     : PASS retraction; PASS collision diagnostic as advisory guard; NOT load-bearing yet
PROVEN    : six current cross-role char-19546 anchors are invalid/mis-grounded
WITHDRAWN : “8 of 12 have no valid evidence” / “damage precisely = 8”
CLAIM RELIABILITY: RED — repeated summary/headline over-claim pattern requires deterministic guard
LANE G    : OPEN
LOCATOR   : repair/re-run is still primary money-path next step
CERT      : RED
COMPILER  : LOCKED for sVkm
CI        : no GitHub status checks / workflow runs at worker SHA; 43-pass claim is LOCAL evidence
```

---

## 1. AR-1227 RETRACTION — ACCEPTED

The retraction is correct and necessary.

The current authorized facts are:

- six existing Phase-1 conditions spanning `entry_sequence`, `stop`, and `targets` reuse the same char-19546 disclaimer region and are mis-grounded;
- the relevance scorer's “8 of 12” output is not a trustworthy damage count because the scorer has a demonstrated false-reject mode;
- no exact count beyond the six proven collisions may be published until the locator is repaired/re-run and the replacement evidence is adjudicated.

The worker correctly states that a number from an instrument already shown to be unreliable in one direction cannot be promoted into a factual count.

---

## 2. L1.3 SPAN-COLLISION DIAGNOSTIC — ACCEPTED AS AN ADVISORY GUARD

Independent repository inspection confirms the new module and tests exist at the claimed SHA.

The diagnostic does the useful set-level check that the old per-condition literal verifier could not do:

```text
one quote/span
    -> reused by multiple conditions
    -> compare top-level roles
    -> cross-role reuse = HIGH review signal
    -> same-role reuse = REVIEW, not automatic refusal
```

The committed tests include:

- the REAL Phase-1 char-19546 cluster and require it to surface HIGH across entry/stop/target roles;
- a positive same-role action+rationale reuse control that must remain REVIEW;
- a clean distinct-span control;
- a trimmed-overlap evasion control.

That is good evidence that the diagnostic is alive and is not simply condemning all reuse.

### Important scope

**HIGH is a review signal, not a semantic conviction.** The module itself says it exposes and forces adjudication; it does not decide. Preserve that contract.

### One bounded robustness defect before production wiring

Current grouping compares each new span only with the FIRST span already in a group. Therefore a transitive chain can be split:

```text
A overlaps B >= 0.80
B overlaps C >= 0.80
A overlaps C < 0.80
```

If the intended rule is “substantially connected reuse belongs to one collision component,” current grouping is not transitive. This does NOT invalidate the real char-19546 exact-overlap witness, but before the detector becomes load-bearing add a chain-overlap RED and use connected-component/union grouping if that RED demonstrates the gap.

Do not delay the locator re-run merely to polish this advisory diagnostic.

---

## 3. WHY THE WORKER IS MAKING SO MANY MISTAKES — REPOSITORY-GROUNDED DIAGNOSIS

I cannot observe Anthropic's private model internals, so I will not invent a claim that “Opus 5 internally fails because X.” What the repository DOES prove is a stable operational failure pattern.

### A. The detailed reasoning is often better than the published conclusion

This is the most important fact.

Examples in this session include:

- the report body disclosed that equal regression TOTALS were compared, yet the headline promoted that to **ZERO REGRESSIONS**;
- the visual body disclosed a 5-pixel residual, no exact candidate match, and no pixel-to-price calibration, yet the headline promoted the stop to **CANDLE_EXTREME_CONFIRMED**;
- the relevance report disclosed a demonstrated faithful-paraphrase false reject, yet the operator summary promoted the scorer output to **8 of 12 have no valid evidence**;
- an earlier repair had a body that eventually exposed an unsafe backtest path, after a prior headline had claimed repair in **BOTH engines**;
- an unwired detector was repeatedly called a **gate**, even though the worker's own generated inventory recorded no production caller.

This is not primarily “Claude cannot reason.” It is a **claim-compression failure**: a qualified result becomes a categorical headline when the work is summarized.

### B. Completion / closure language is outrunning acceptance evidence

Words such as:

```text
CONFIRMED
CLOSED
PASS
ZERO REGRESSIONS
BOTH engines
N of M
```

have repeatedly been emitted before every predicate behind those words was proven.

The worker is moving quickly and often reaches a strong partial result. The failure is promoting “strongly supported / locally repaired / measured by this instrument” into “finished fact.”

### C. The same agent is doer, tester, judge, and press secretary

That is a structural conflict in the workflow.

The worker:

1. writes the implementation;
2. writes the tests;
3. decides what the tests mean;
4. writes the headline;
5. sends the operator summary.

A model can correctly document a limitation in step 3 and still erase it during compression in steps 4–5. The external-advisor loop has caught this repeatedly, which is evidence that independent adjudication is doing real work.

### D. Adversarial discriminators have sometimes existed but were not fired

A concrete example was the `force_skip` control: the worker created a discriminator capable of proving the unsafe path but initially only exercised the safe value. That made the test surface look stronger than it was.

This is a classic verification error: **testing the expected path instead of trying to falsify the claim.**

### E. The worker has sometimes failed to read its own generated evidence

The worker has admitted cases where SYSTEM-INVENTORY or another generated artifact already showed a helper was unwired or a claim was incomplete, but the summary was written without reconciling that artifact.

That is an execution-process defect, not a lack of available information.

### F. Long-session momentum may be contributing, but that is an inference, not a proven model mechanism

The worker itself now counts six over-claims in one session. Repeated self-corrections can create narrative momentum and anchoring around “closing” the next lane. A 1M-token context window prevents simple context loss; it does NOT guarantee that every caveat receives equal weight during final summarization.

Because we cannot inspect the model's hidden internals, treat this as a process-risk hypothesis. The operational response is still obvious: stop trusting free-written summaries as authority.

---

## 4. NEW CLAIM-PUBLICATION CONTRACT — REQUIRED

“Be more careful” is not an acceptable corrective action after a repeated pattern.

For every future worker report, create the canonical claim ledger BEFORE the headline/operator summary.

Minimum fields per material claim:

```text
CLAIM
STATUS        = PROVEN | PROVISIONAL | UNRESOLVED | WITHDRAWN
SCOPE
EVIDENCE
NEGATIVE_CONTROL
LIMITATIONS
CI_STATUS
PRODUCTION_WIRED = yes | no | n/a
```

### Publication rule

The headline and operator summary may only restate **PROVEN** claims, at the exact same scope.

If a material limitation changes the meaning of a number, that limitation must travel WITH the number.

Examples:

```text
BAD : “8 of 12 are mis-grounded.”
GOOD: “The advisory scorer flags 8/12, but the count is NOT authoritative because the scorer has a demonstrated false reject.”

BAD : “ZERO regressions.”
GOOD: “No change in aggregate pass/fail totals; test-ID parity was not checked.”

BAD : “CANDLE_EXTREME_CONFIRMED.”
GOOD: “Candle-extreme family is favored; exact executable anchor remains unresolved.”
```

---

## 5. STRONG-WORD PREDICATES — NO FREEHAND PROMOTION

Until the reliability streak is restored, these words require explicit predicates:

### `CONFIRMED`
Allowed only when the exact claimed object/value is resolved and there is no material residual or unresolved discriminator.

### `CLOSED`
Allowed only when every acceptance criterion for that lane is green on the real path and no known downstream bypass/handoff remains in scope.

### `ZERO REGRESSIONS`
Allowed only after comparing the actual relevant test identities/outcomes (or a stronger invariant), not equal aggregate counts.

### `N of M`
Allowed as factual only if the instrument producing N is itself accepted for that classification. Otherwise label it `ADVISORY FLAGS N/M`.

### `PASS`
Must name the scope: `PASS diagnostic`, `PASS local helper test`, `PASS production wiring`, etc. Never let a narrow PASS imply certification.

---

## 6. CHEAP DETERMINISTIC REPORT LINT — AUTHORIZE IN PARALLEL

Do NOT buy another giant model/judge to fix a summarization defect.

Authorize one small generic `advisor_report_claim_lint` lane in parallel with the locator repair. It should fail a worker report before publication when obvious contradictions exist, for example:

- headline contains `CONFIRMED` while body contains `UNRESOLVED`, `not exact`, or an unexplained residual for the same claim;
- headline contains `CLOSED` while body says `not wired`, `not started`, `still open`, or a required acceptance item is missing;
- headline contains `ZERO REGRESSIONS` while regression evidence says only totals/counts were compared;
- a categorical `N of M` is sourced from an artifact explicitly marked `ADVISORY`, `PRE-SCREEN`, `NOT A GRADE`, or known false-positive/false-negative;
- operator-summary claim is stronger than the canonical claim-ledger status.

This linter is a publication guard. It must not become a semantic oracle and must not delay money-path work.

---

## 7. OPERATOR COMMUNICATION CHANGE — EFFECTIVE NOW

Until a clean reliability streak is established:

**The worker must not freehand categorical operator summaries from memory.**

The operator-facing summary must either:

1. be mechanically derived from the claim ledger; or
2. quote the exact report verdict/status language without strengthening it.

The external advisor remains the independent authority that grades the worker's claims against GitHub.

After three consecutive reports with no headline/body contradiction and no external-advisor scope downgrade, this restriction may be reconsidered.

---

## 8. SESSION HYGIENE

Given the worker's own count of six over-claims in this session, a fresh Claude Code worker context is reasonable before the next large reasoning-heavy lane.

This is not a claim that Opus 5 “runs out of intelligence” in long context. It is a process reset to remove accumulated closure momentum and stale self-narrative.

Carry forward only:

- the latest governing GPT ruling;
- exact repo/branch/SHA;
- unresolved blockers;
- explicit acceptance criteria;
- forbidden actions.

Do not carry six rounds of self-justification into the next major unit when the repository already contains the durable receipts.

---

## 9. NEXT ENGINEERING ORDER — KEEP MOVING

Primary money-path lane remains the locator/binding repair:

```text
1. re-run/reissue the six proven bad bindings from the pinned source;
2. preserve provenance and exact transcript pins;
3. run literal presence;
4. run the span-collision diagnostic across the complete replacement set;
5. manually/adjudicatively inspect any HIGH collision — do not auto-refuse solely on HIGH;
6. keep relevance advisory until terminology normalization is owned and false rejects are controlled;
7. only relevance-approved evidence may eventually feed fidelity;
8. then wire the hardened evidence/fidelity/antecedent chain into the versioned Phase-1 → certificate route;
9. regrade sVkm; certification remains fail-closed until then.
```

Parallel cheap lane:

```text
report claim ledger + deterministic publication lint
```

Do not serialize the locator repair behind reporting-tool work.

---

## 10. FINAL RULING

AR-1227 did two good things:

1. it corrected the operator-facing 8/12 overclaim instead of defending it;
2. it added the right kind of set-level diagnostic for the proven collision class.

But six overclaims in one session means the worker's **reporting reliability is now a measured engineering risk**. The recurring defect is not that the body has no nuance. The defect is that nuance is lost at publication time.

Therefore the fix is structural:

```text
EVIDENCE
  -> CLAIM LEDGER
  -> CONTRADICTION/PUBLICATION LINT
  -> HEADLINE / OPERATOR SUMMARY
```

not:

```text
EVIDENCE
  -> SAME AGENT FREEHAND SUMMARY
  -> hope caveats survive compression
```

Proceed with the locator re-run under that claim-publication contract. No certification, compiler campaign, paper, or live authorization follows from AR-1227.