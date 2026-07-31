# External Advisor Ruling — AR-527 / AR-528 Technical Review

**Date:** 2026-07-31  
**Scope:** AR-527 `I8` refusal + `I21` follow-up; AR-528 `I7` deployed-scope tripwire and RED-proof extension  
**Decision:** **PUBLICATION ACCEPTED; `I7` NOT CLOSED. MATERIAL ADDITIVE CORRECTIONS REQUIRED.**

## 1. Evidence status

The publication gate is discharged. Generator commit `f7586b108428ef348a9c77297b63c2eeccc7acfa` and RED-proof commit `7c4bb0c8bf6b6af53f843a3a2e095af12986eeaa` resolve publicly. The campaign branch contains the generator, the two result artifacts, the identity-level maps, the source-closure receipt, and the mutation harness. The main artifact reports 30 passing assertions, Corpus A and Corpus B separately, and the deployed-scope block. The RED-proof receipt reports an unmutated green control and six discriminating mutation cases. fileciteturn46file0L1-L11 fileciteturn47file0L1-L12 fileciteturn52file0L1-L2 fileciteturn65file0L1-L7

That clears the prior **evidence unavailable** objection. It does **not** clear the technical review.

## 2. What is accepted

The following `I7` measurements are accepted as campaign-lane facts:

- Corpus A and Corpus B are reported separately; no pooled rate is installed.
- Binding movement and diagnostic refusal-reason movement are correctly separated.
- Corpus A reports `0 / 155` global, `0 / 27` `WAIT_SESSION`, and `0 / 27` baseline-defined C2 binding movement; diagnostic reason movement is `17 / 155`, `17 / 27`, and `17 / 27` respectively.
- Corpus B reports `0 / 6450` global binding movement and `45 / 6450` global diagnostic reason movement, with its C2 population explicitly labelled as OFF-control-derived rather than baseline-artifact-derived.
- Corpus A proves identity equality between the baseline-derived C2 set and the OFF-control-derived surrogate.
- The earlier invalidation discrepancy is corrected to `6` for Corpus A and `603` for Corpus B.
- The `18 / 17 / 9` reconciliation is now identity-level: the one unchanged recognized row is named, the changed-with-zone and changed-without-zone identities are listed, and zero unrecognized rows changed.
- The campaign measurement closure records zero dirty-path intersection and equality to the named HEAD blobs for the executed campaign inputs. fileciteturn64file0L1-L4 fileciteturn68file0L1-L7 fileciteturn70file0L1-L2

The correct narrow reading remains:

> Under the measured campaign checkout, enabling the session-role resolver changed no `bound_and_concrete` disposition in either corpus. It changed refusal-reason classification for 17 Corpus A rows and 45 Corpus B rows. This is diagnostic movement, not production activation and not proof that the refusals are ground-truth-correct.

## 3. AR-528 does not discharge R-506 §5

### A. The assertion named `STRICT_SUBSET` is not a strict-subset assertion

The generator defines `STRICT_SUBSET` as `len(dep - camp) == 0`. That proves **subset-or-equal**. A strict subset additionally requires at least one campaign-only symbol. The defect is demonstrated by M5 itself: M5 points the deployed path at the campaign binder, making the two symbol sets equal, while requiring the assertion named `SCOPE_deployed_binder_is_a_STRICT_SUBSET_of_campaign` to stay green. Equality therefore passes the alleged strict-subset guard. fileciteturn46file0L1-L11 fileciteturn63file0L1-L7

The current snapshot does contain `70` campaign-only names and `0` deployed-only names, so the current top-level name sets are strictly ordered. The executable assertion still encodes the wrong contract.

### B. The serialized JSON does not self-destruct when production changes

The artifact is a static file. It goes red only when the generator is rerun on a machine that can read the hard-coded deployed path. A later deployment does not mutate the existing JSON, invalidate its 30 green assertions, or force any reader to regenerate it. The scope block carries no deployed commit SHA, deployed binder blob SHA, generated-at timestamp, or freshness comparison against current production. Therefore the claim that the artifact “self-destructs the moment the capability is ported” is false.

Correct description:

> The generator contains a rerun-time stale-scope guard. The published artifact is a snapshot and does not auto-update; it must be regenerated after any deployed-binder change.

### C. Six absent top-level names do not prove engine-wide capability absence

`top_level_symbols()` counts only top-level function, class, simple assignment, and annotated-assignment names in one file. It does not inspect imported aliases, tuple assignments, nested implementations, renamed functions, call graphs, or shared-symbol bodies. Thus the evidence proves only:

> The six named top-level definitions were absent from the measured deployed `spec_family_bindings.py` snapshot.

It does **not** prove that the session-role capability “does not exist as code in the deployed engine.” A semantically equivalent implementation under different names or inside common function bodies would evade this check. fileciteturn46file0L1-L11

## 4. AR-527 `I21` follow-up is useful but not closed

The measured symbol-set result is accepted:

> `TOP-LEVEL-SYMBOL-SET-SUBSET`: `70` campaign-only names, `0` deployed-only names, across the measured binder snapshots.

The stronger phrases **“purely subtractive divergence,” “one lineage with 70 things removed,”** and **“there is no deployed-side code to reconcile”** are rejected. Zero deployed-only *names* does not establish equality of the 33 shared symbol bodies. Shared functions can carry divergent implementations while preserving the same names. No common-symbol AST/body-hash comparison was provided.

Accordingly:

- Original `I21` register correction: **CLOSED**.
- R-501 semantic follow-up: **PARTIAL**.
- Required register wording: **`PRESENT; TOP-LEVEL-SYMBOL-SET-SUBSET — 70 campaign-only, 0 deployed-only; shared-symbol semantic parity NOT MEASURED.`**
- Do not use `PRESENT-BUT-SUBTRACTIVELY-DIVERGENT` yet.

## 5. The RED-proof claim is overstated

The receipt says every assertion class has a demonstrated path to red, but no assertion-class taxonomy is defined. The instrument has `30` assertions; six mutations target six assertions. The RED-proof header still says the instrument ships `26` passing assertions. M2, M3, and M4 provide no `must_stay_green` collateral set, so they prove their target goes red but do not prove that each mutation isolates only its intended assertion class. M5 and M6 are cross-constrained, which is good, but M5 simultaneously exposes the strict-subset contract defect. fileciteturn63file0L1-L7 fileciteturn65file0L1-L7

Accepted claim:

> Six targeted mutations discriminate against six named assertions, with an unmutated green control; M1, M5, and M6 also carry selected collateral-green checks.

Rejected claim:

> Every assertion class in the 30-assertion instrument is mutation-proven.

The main artifact’s raw source closure also does not contain the RED-proof harness merely because an assertion name says “INCLUDING generator and any harness.” The direct generator execution does not import that harness, and the RED-proof receipt itself carries no git HEAD, branch, harness blob, generator blob, dirty-state receipt, or reproduction command. The campaign measurement provenance is acceptable; RED-proof provenance remains incomplete. fileciteturn70file0L1-L2 fileciteturn65file0L1-L7

## 6. Additive completion contract

Before `I7` may close, make only these additive evidence corrections:

1. Replace the false strict-subset predicate with two explicit predicates:
   - `DEPLOYED_IS_SUBSET_OR_EQUAL = dep <= camp`
   - `DEPLOYED_IS_STRICT_SUBSET = dep < camp`
   The strict assertion must require both zero deployed-only names and at least one campaign-only name.
2. Add a mutation where the symbol sets are equal and require the strict-subset assertion to go red.
3. Bound every deployed-scope claim to a snapshot carrying deployed commit SHA, deployed binder blob/hash, campaign commit SHA, generator blob/hash, generated-at timestamp, and measured path.
4. Include the deployed binder snapshot in the provenance closure or publish a separately hashed deployed-scope receipt.
5. Replace the engine-wide capability-absence sentence with the narrow six-name statement unless a repository-wide import/alias/renamed-implementation and call-path audit proves more.
6. Compare AST/body hashes for all shared top-level symbols before claiming the port is purely additive or requires no reconciliation.
7. Add an explicit identity assertion `set(C2_A) == set(WAIT_SESSION_A)`; equal counts are not identity proof.
8. Correct the RED-proof header from `26` to `30`, define the assertion classes being claimed, and stop claiming universal mutation coverage unless each class has a demonstrated red path.
9. Add collateral-green contracts for M2–M4 or narrow the prose so it does not claim isolation.
10. Give the RED-proof receipt its own HEAD/branch, harness blob, generator blob, artifact blob, dirty-intersection receipt, and exact reproduction command.
11. Put this sentence in the scope block: **“This artifact is a static snapshot and does not auto-update; rerun is required after any deployed-binder change.”**

No engine, extraction, migration, or production change is authorized by this ruling.

## 7. `I8` ruling

AR-527’s refusal is accepted. Advancing the existing migration lane would require rule expansion while the standing state forbids a fifth semantic-regex patch round and forbids expansion before a fresh untouched population is named. The worker correctly declined to spend `HOLDOUT-26` or silently alter another worktree.

However, this advisor does **not** name a fresh population now. Naming it before `I7` closes would spend a scarce untouched population while its prerequisite measurement contract is still defective.

`I8` state:

**`NOT STARTED — WORKER DECLINE ACCEPTED; ADVISOR POPULATION-NAMING ACT HELD UNTIL I7 TECHNICAL CLOSURE.`**

This is not worker blockage, not authorization to tune `HOLDOUT-26`, and not permission for a fifth patch round.

## 8. Position

- AR-527 `I8` refusal: **ACCEPTED**
- AR-527 top-level symbol census: **ACCEPTED AS A NARROW SNAPSHOT**
- `I21` original correction: **CLOSED**
- `I21` semantic follow-up: **PARTIAL**
- AR-528 publication: **ACCEPTED**
- AR-528 R-506 §5 discharge claim: **REJECTED**
- `I7`: **DELIVERED · PUBLISHED · EXTERNALLY REVIEWED WITH MATERIAL ADDITIVE DEFECTS — NOT CLOSED**
- `I8`: **NOT STARTED**
- `I11`: **CLOSED — NOT-SOUND**
- `c304b098`: **NOT-SOUND, UNCHANGED**
- `P0-v5`: **UNAUTHORIZED**
- Merge / deploy / release: **HOLD**

**Control rules:**

> `A RERUN-TIME GUARD IS NOT A LIVE INVALIDATION MECHANISM.`

> `A SUBSET TEST THAT PASSES EQUALITY IS NOT A STRICT-SUBSET TEST.`

> `ZERO DEPLOYED-ONLY SYMBOL NAMES DOES NOT PROVE ZERO DEPLOYED-SIDE SEMANTIC DIVERGENCE.`
