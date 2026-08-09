# EXTERNAL READ — 2026-08-09 — AR-821: STEP 1 ACCEPTED; **STEP 2 STARTS ONE LAYER TOO LATE**; STEP 3 HELD

> **PROVENANCE:** **OPERATOR-RELAYED CHAT**, 2026-08-09, responding to `AR-821`.
> **CONSUMED BY `R-728`** — banner written BY that ruling, IN its commit (`R-722 §1`).
>
> 🛑🛑 **THIS READ CATCHES SOMETHING THE DESK'S OWN VERIFICATION MISSED.** `R-727`-era desk re-ran the
> permanent RED, confirmed `1 failed · 1 passed · 1 skipped`, confirmed it failed for the stated
> reason, inspected the skip — **and endorsed it.** It never asked whether the test *starts* in the
> right place. **It does not: it enters at the census, which is already classified.** ★★★★★ **`I
> VERIFIED THE ASSERTION AND NOT THE ENTRY POINT` — the `i-measured-the-neighbouring-object` family,
> committed by the desk while explicitly performing the verification step.**
>
> **A CHANNEL IS NOT AN AUTHOR** — audited on merit; desk amendments live in `R-728`.

---

GPT EXTERNAL ADVISOR RULING — AR-821 STEP 1 ACCEPTED; STEP 2 IS A USEFUL UNIT RED BUT NOT YET THE REQUIRED PERMANENT RED

DECISION

- STEP 1: ACCEPTED provisionally.
- STEP 2: PARTIAL ACCEPT.
- STEP 3 PRODUCTION CODE: HOLD.
- No additional Phase A investigation authorized.

GITHUB STATUS

I attempted to inspect commit `5ed334eb`, but it is not yet on the connected GitHub repository. The remote branch still ends at the previously published head.

Before Step 3, push the documentation and corrected-test commits by plain fast-forward and report their complete SHAs.

WHY STEP 2 IS NOT YET COMPLETE

The report states that the condition is read from census blob `23f30eb0`.

That census is a derived, already-classified artifact. It already contains:

- `WAIT_STRUCTURE`;
- role assignment;
- condition identity;
- binding results.

The actual extraction artifact does not contain that typed condition. It carries prose that must pass through:

`produce_spec_artifact()`
→ `_classify_family()`
→ `compile_binding_plan()`
→ production binding

Therefore, the current RED starts after the handoff B1 is supposed to repair.

It is not hand-building a `ConditionBinding`, but it is still bypassing the real extraction-to-canonicalization boundary.

The census may remain as a comparison oracle. It cannot be the production input.

REQUIRED STEP 2 CORRECTION

Load the real frozen extraction:

`docs/replay-results/h1-battery/tier-a-extraction-provenance/st5e-YJRfKc__s0.json`

Verify its frozen hash.

Select the actual strategy object from that artifact and drive it through the public production entry:

`src/engine/extraction/spec_producer.py`
`produce_spec_artifact()`

Then send the produced spec through the real binding-plan/compiler path.

Required chain:

frozen extraction JSON
→ `produce_spec_artifact`
→ produced condition graph
→ `compile_binding_plan`
→ selected primitive and output contract

The test must prove the current production path itself creates `WAIT_STRUCTURE` and routes it to `compute_structure_state`.

The census should only verify that the reproduced result agrees with the historical census.

SECOND TEST DEFECT — THE WRONG ROUTE MUST BE PROHIBITED NOW

The report says the test is deliberately "generous" and could turn GREEN if the required fields appear through either route.

That is too permissive.

Adding opening-range-shaped fields to `StructureState` would not repair the semantic identity defect. It would allow the old wrong primitive to satisfy the field list cosmetically.

The permanent RED must require both:

1. The correct typed opening-range contract exists.
2. The selected primitive is not:
   `structure_engine.compute_structure_state`

Current production should therefore fail on both route identity and output contract.

After repair, routing back to the structure primitive must fail automatically.

SKIPPED TEST RULING

A skipped test with a named dependency is honest documentation, but it is not an armed control.

Do not count the skipped test as path-to-red evidence.

Either:

- replace it now with the explicit wrong-route assertion above; or
- label it `PLACEHOLDER_NOT_YET_EVIDENCE` until Step 4 activates it.

The preferred answer is to make the main RED reject the structure primitive now. Then no separate skip is needed to protect that invariant.

REQUIRED PASSING CONTROLS

The corrected Step 2 suite must include passing controls proving:

1. The extraction file hash matches the frozen artifact.
2. The intended strategy is selected from the extraction.
3. `produce_spec_artifact()` actually runs.
4. The expected opening-range prose reaches the produced condition graph.
5. The historical census agrees with the newly produced baseline condition.
6. An unrelated genuine structure condition still routes to the structure primitive.

The last control protects against "repairing" opening range by disabling legitimate structure behavior.

EXPECTED CORRECTED RED POPULATION

A valid result may look like:

- PASS — frozen extraction identity.
- PASS — production producer emits the expected current condition.
- PASS — census joins to that independently produced condition.
- PASS — genuine structure condition retains its route.
- FAIL — opening-range artifact still becomes `WAIT_STRUCTURE`.
- FAIL — opening-range artifact still selects `compute_structure_state`.
- FAIL — no typed opening-range output contract exists.

Exact test count is not important. Exact failure membership is.

STEP 1 NOTE

The seven in-place documentation corrections sound consistent with the full grade.

However, commit `5ed334eb` must be pushed before this advisor can independently confirm:

- documentation-only scope;
- all corrections occurred at original claim sites;
- no instrumentation or production code changed.

NEXT AUTHORIZED ACTION

1. Upgrade Step 2 so the actual frozen extraction drives the production producer and binder.
2. Make wrong primitive identity an active failing assertion, not a skipped future control.
3. Commit the corrected RED.
4. Push Step 1 and Step 2 commits by fast-forward.
5. Report the remote head and full commit SHAs.

Do not begin Step 3 production implementation before this correction is visible.

BOTTOM LINE

AR-821 found the correct current failure, but it started from the census after the most important handoff had already happened.

The permanent RED must begin one level earlier:

> The real extraction artifact must enter production lowering and prove that production itself turns preserved opening-range prose into the wrong structure binding.

Correct that now, before code exists that could accidentally make an incomplete test turn GREEN.
