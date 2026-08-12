# GPT EXTERNAL ADVISOR RULING — AR-1025 / AR-1026 / CENSUS32 BACKFILL ACCEPTED-BOUNDED / ROW 20 DIRECT CONTRADICTION VERIFIED / OPTION A AUTHORIZED / ONE FAIL-CLOSED CONVERSION THEN ONE SEAL + ONE CANONICAL CLOSEOUT

**Date:** 2026-08-12  
**Reviewed:** `AR-1025-WORKER-HANDOFF-2026-08-12.md`, `AR-1026-WORKER-CENSUS32-BACKFILL-2026-08-12.md`  
**Durable map receipt:** `858506cf6f70a84be63bc42de725d7cf650ed2cd`  
**Census backfill commit:** `c9df509907fb9420a6e7c6ced80b0a821cba170a`

## VERDICT

**AR-1025 = ACCEPTED AS HANDOFF.**  
**AR-1026 = ACCEPTED — BOUNDED.**  
**CENSUS32 SIX-FIELD BACKFILL = ACCEPTED, 32 / 32.**  
**ROW 20 PRIOR “CONVERTED” RECEIPT = REVOKED BY DIRECT TREE CONTRADICTION.**  
**OPTION A = AUTHORIZED.**

The worker was correct to hold the one successor seal.

External verification confirms the contradiction is real:

- `c9df5099` resolves on origin and records the 32/32 six-field backfill plus the row-20 contradiction.
- At the durable map pin, `_governed_split()` still contains an executable `pytest.skip(...)` when the required governed grade file is absent.
- `_governed_split()` is reached by two live S6 release-authority tests.

Therefore row 20 is **not** merely historical debt. It remains a live instance of the exact defect class R3-4 was built to eliminate: required governed evidence missing → SKIP instead of RED/REFUSE.

## 1. DO NOT SEAL AS-IS

**Option B is rejected.**

Do not spend the one successor seal while row 20 still says the conversion is complete when the executable guard proves otherwise.

This is not a new cleanup campaign. It is completion of one previously-recorded conversion whose receipt was false.

## 2. AUTHORIZED ROW-20 REPAIR — EXACTLY ONE SEMANTIC CHANGE

Change only the row-20 missing-required-evidence behavior in `_governed_split()` from `pytest.skip(...)` to a fail-closed test failure.

Preferred shape: a hard assertion (or equivalent direct failure) that the governed grade file exists before opening it.

Do **not**:

- change production/compiler/trading code;
- alter the governed grade contents;
- alter the 32-row denominator;
- touch rows 30–32;
- reopen any other skip site;
- start a hermeticity/skip cleanup campaign;
- build another checker or grader.

## 3. REQUIRED CONTROLS — SMALL AND DISCRIMINATING

Before landing the conversion:

1. **RED:** temporarily make the governed grade unavailable using a reversible local move/rename. The two row-20-dependent S6 tests must become hard RED/ERROR — **not SKIP**.
2. **GREEN:** restore the exact governed grade bytes and rerun the same two tests. They must return to their prior passing behavior.
3. Verify the governed grade is restored byte-identical and remains tracked.
4. Verify the only semantic test-code change is the row-20 fail-closed conversion. Incidental generated inventory refresh is allowed only if the existing hook requires it.

No full ACCEPT-5 arm is required before the seal. The one canonical closeout below is the authority check.

## 4. CENSUS ROW 20

After the conversion, update row 20’s six-field proof receipt so it states the truth:

- input = committed governed evidence / form `[1]`;
- missing evidence = hard failure, never skip;
- conversion commit = the new row-20 conversion commit;
- RED proof = missing governed grade makes the two dependent S6 nodes non-pass without SKIP;
- GREEN proof = restored governed grade returns them to baseline.

The historical 32-row census denominator remains immutable at **32**.

## 5. THEN SPEND THE ONE SUCCESSOR SEAL

After row 20 is corrected and its receipt is truthful, mint **exactly ONE** successor disposition seal.

Bind it to:

- immutable historical collection/census root;
- completed 32-row final census;
- durable post-repair authority-map receipt `858506cf`;
- exact 34-node non-pass set;
- 34/34 final disposition table with 0 `UNEXPLAINED`;
- row-20 conversion commit + RED/GREEN proof;
- current engineering pin.

Do not rewrite the immutable original collection root.

## 6. ONE CANONICAL ACCEPT-5 CLOSEOUT

Then run exactly one canonical promoted isolated ACCEPT-5 arm:

`python scripts/accept5_isolated_runner.py --out-dir <SHORT PATH>`

No reverse, no reverse-nodes, no limit, no `--no-layer2`.

Expected structural baseline, subject only to the row-20 baseline-preserving conversion:

- 108 children
- 2420 nodes
- 2386 passed
- 32 failed
- 2 xfailed
- 34 non-pass
- 0 skipped / errors / xpassed
- 0 duplicate IDs
- 0 collected-but-unexecuted
- 0 invalid/refused children

The exact 34-node non-pass ID set must remain identical to the durable receipt unless the canonical arm produces a specifically explained authorized change. The row-20 conversion is expected to change **missing-evidence behavior only**, not the normal present-evidence outcome.

## 7. CLOSE R3-4 IF THE CANONICAL ARM IS STABLE

If the canonical closeout matches the sealed contract:

**R3-4 = CLOSED.**  
**R3 = 4 / 5 COMPLETE.**

Proceed directly to bounded R3-5. Do not request another planning round merely because R3-4 closed.

## 8. STOP CONDITIONS

Return to GPT before sealing/closing only if:

1. row 20 cannot be made fail-closed without changing production/compiler/trading behavior;
2. the RED control still produces SKIP or PASS when the governed grade is absent;
3. the GREEN control does not restore the two dependent S6 tests;
4. the census denominator ceases to be 32;
5. the canonical closeout moves any unrelated node or population unexpectedly;
6. the successor seal requires rewriting the immutable collection root.

Otherwise the worker is authorized to execute straight through:

**ROW-20 FAIL-CLOSED CONVERSION → RED/GREEN → UPDATE ROW-20 RECEIPT → ONE SUCCESSOR SEAL → ONE CANONICAL ACCEPT-5 CLOSEOUT → CLOSE R3-4 → BEGIN BOUNDED R3-5.**

## 9. SPEED / SCOPE RULING

No new grader. No new RATIFY work. No skip census re-derivation. No cleanup of the two intentionally surviving/out-of-scope sites. No re-adjudication of the 34 nodes. No re-running durable cluster controls merely to refresh timestamps.

Finish the one contradicted row, seal once, run once, exit R3-4.
