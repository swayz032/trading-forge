# External Advisor Ruling — P1/P2 Re-Census

**Date:** 2026-08-01  
**Ruling:** R-524  
**Objects:** repaired artifacts `f362a80b64e3def4fa9039cb0fd906df63f6250f`; re-census `a9c0d557`  
**Decision:** **PRIOR FAIL LIFTED. P1/P2 SUBSTANTIVE CLAIM ACCEPTED AT BAND 7. AUTHORIZE EXACTLY ONE TWO-LINE VERIFIER CLOSEOUT, THEN BEGIN P0-vNext DESIGN.**

## 1. What is now proven

The re-census establishes through independent, adversarial measurement that:

- the row universe is independently frozen from twelve pinned source fixture specs;
- the universe contains `43` unique entry-condition rows;
- the seven-axis contract yields exactly `301` cells;
- the distribution is `ASSERTED 140 / NOT-APPLICABLE 9 / UNADJUDICATED 152`;
- the `43` undeclared cells remain exactly the same 43-cell set;
- all `210` pre-repair cells preserve their classifications, bases, values, and declared reasons;
- the `91` added cells are honestly `UNADJUDICATED` and assert nothing;
- row- and axis-deletion forgeries remain RED even when the forger repairs counts and fingerprints;
- an adversary freely editing the oracle and ledger cannot shrink the membership universe;
- the condition × seven-axis frame is correctly bounded, and fixture-level scalar/relational surfaces are explicitly out of frame.

The previous `FAIL — NAMED MEMBERSHIP DEFECT` is therefore lifted.

> `THE DENOMINATOR IS NOW INDEPENDENT OF THE ARTIFACT IT JUDGES.`

## 2. Residual HIGH is real but bounded

The integrity verifier protects the `cells[]` truth payload but does not yet protect all human-facing manifest and summary claims.

A forged ledger can currently preserve the 301 cells while changing statements such as:

- `UNDECLARED 43 → 0`;
- `row_count 43 → 30`;
- the frame declaration;
- classification and basis summaries.

That is not a defect in the truth membership itself. It is a defect in the guard around the published report of that truth.

The `43` count is load-bearing and must not remain an unprotected caption.

## 3. Authorized closeout — exactly two verifier comparisons

Amend only the verifier listing in the packet, regenerate/re-paste its proof output, and update the worker report.

### Comparison 1 — protect the complete manifest

In `check()`, compare the ledger’s published canonical document digest against the independently regenerated expected digest:

```python
doc["digests"]["canonical_document_sha256"] == exp["digests"]["canonical_document_sha256"]
```

Do **not** accept a digest produced by re-canonicalizing the possibly forged ledger as its own authority.

This must turn RED on every manifest/summary/frame mutation reached by the re-census, including `UNDECLARED 43 → 0`.

### Comparison 2 — protect the non-canonical digest fields

Compare these expected fields directly because the canonicalization excludes the `digests` object:

- `row_universe_sha256`;
- `cell_id_set_sha256`;
- `digest_definition` if it remains a published contract field.

No data cell, classification, basis, value, citation, row identity, axis, count, or frame meaning may move.

## 4. Closeout proof

Run a focused verifier closeout, not another redesign and not another full membership re-census.

Require:

- clean pinned artifact → PASS;
- all previously shipped 11 mutants → RED;
- all 20 reported manifest/digest escapes → RED;
- `UNDECLARED 43 → 0` specifically → RED;
- `row_universe_sha256` and `cell_id_set_sha256` forgery → RED;
- final summary line and exit status;
- the 301-cell ledger blob semantically unchanged.

If either clean control fails, stop and return the exact defect. No widening.

## 5. Source durability action accepted

The annotated remote tag anchoring `c304b098` is accepted as the correct time-sensitive durability repair:

`p1p2-frozen-source-universe-c304b098`

Its peeled object must remain `c304b098b156106a5a81b714c7a5a3ed166d68ef` while P1/P2 or any P0-vNext consumer is live. Name the tag beside the source commit in the packet during the authorized closeout.

Do not delete or retarget the tag.

## 6. Transition to P0-vNext

After the focused closeout passes and is committed/published:

- **P1 is CLOSED** as the observed baseline and independently frozen row universe;
- **P2 is CLOSED** as the 301-cell condition-axis truth ledger with declared unknowns;
- **P0-vNext DESIGN is AUTHORIZED** immediately;
- **P0-vNext implementation is not yet authorized** until that design is externally read.

The P0-vNext design must consume cells, not trust captions:

- reconstruct exact row × axis membership independently;
- check TS/Python agreement for every projected cell;
- check correctness only for `ASSERTED` cells;
- require no assertion/predicate for `NOT-APPLICABLE` cells;
- emit named `INCOMPLETE_AUTHORITY` and fail closed for any depended-on `UNADJUDICATED` cell;
- recompute summary counts from cells and verify them against the protected manifest;
- keep the fixture-level out-of-frame surfaces as a named P3/downstream obligation.

## 7. State

- Prior P1/P2 census FAIL: **LIFTED**
- P1/P2 substantive truth membership: **PASS / BAND 7 VERIFIED**
- Frozen universe: **43 rows × 7 axes = 301 cells**
- Undeclared truth: **43, PRESERVED**
- Two-line integrity closeout: **AUTHORIZED NOW**
- Full additional P1/P2 re-census: **NOT REQUIRED**
- P0-vNext design: **AUTHORIZED AFTER CLOSEOUT PASS**
- P0-vNext implementation: **HOLD**
- P3 / Gate B / merge / deploy / release: **HOLD**

> `THE DATA IS NOW SOUND; PROTECT THE SENTENCE THAT REPORTS WHAT THE DATA SAYS.`

> `A CONSUMER MUST RECOMPUTE TRUTH FROM THE CELLS, NEVER INHERIT A HEADLINE COUNT.`
