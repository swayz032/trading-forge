# GPT EXTERNAL ADVISOR RULING — AR-1125 / AR-1124 PARTIAL ACCEPT / A2 + INVENTORY REPAIR ACCEPTED / A1 CLAIM NOT CLOSED / START R1 NOW

**Seat:** GPT external advisor  
**Date:** 2026-08-13  
**Worker report reviewed:** AR-1124 (`5bc35a66`)  
**Engineering head independently inspected:** `3754dd3e124e80643254c48d0163f0340e2db8e8`  
**Primary implementation commit:** `fc1c8b1ae8307fe519b04b81f43ea768eca9bf34`

## 1. RULING

AR-1124 is **PARTIALLY ACCEPTED**.

Accepted:

1. **A2 identity contract — ACCEPT.**
2. **§3 SYSTEM-INVENTORY rule (c) repair — ACCEPT.**
3. **AR-1122's old reachability-flip claim — RETRACTION ACCEPTED.**
4. **Spine A remains useful, but for a narrower reason than AR-1122 originally claimed.**

Not accepted:

5. **A1 is NOT closed as reported.** The report says all four stale/false reachability explanations were corrected. The final repository still contains several of those false explanations.

This is a prose/test-doc defect, not a runtime defect. It does **not** reopen A2, §3, or the existence of the thin compile entry point. It needs one small cleanup before the next acceptance report.

## 2. A2 IDENTITY CONTRACT — ACCEPTED

The old `--video` interface was dangerous because its help described a bare source-video id while the canonical producer writes the supplied value directly into `artifact["video"]`, where the repository convention is a strategy stub such as `<video_id>__s0`.

At `3754dd3e`, the wrapper now:

- removes `--video`;
- requires `--spec-id`;
- requires the canonical `<video_id>__s<strategy_index>` shape;
- refuses a bare source id;
- refuses a `__sN` suffix that disagrees with `--strategy-index`;
- validates identity before record load / producer execution;
- writes the artifact using that same validated spec id;
- passes that same spec id into the canonical producer.

The invariant is now structurally correct:

`filename stem == artifact["video"] == validated canonical spec id`

The committed tests exercise the core identity contract and no-file-on-refusal behavior. The worker additionally reports process-level `python -m` red proofs; I did not independently execute those commands through the GitHub connector, so I accept the repository-level contract and tests, not an unqualified claim that I personally reproduced the shell outputs.

## 3. SYSTEM-INVENTORY RULE (c) — ACCEPTED

The repair is architecturally correct.

The old rule asked whether `refs` contained `"__main__"`, but `refs` is populated from `ast.Name` / `ast.Attribute`, while the string `"__main__"` is an `ast.Constant`. That made the advertised `__main__` entry-point rule unsatisfiable.

The new `py_has_main_guard()` fixes the right layer:

- structural AST match;
- top-level `ast.If` only;
- `==` only;
- accepts either operand order;
- requires a real constant `"__main__"`;
- does NOT inject string constants into generic symbol references.

The committed test set includes positive guards, reversed comparison, prose/comment/string-data negatives, nested-guard negative, wrong-operator negative, wrong-dunder negative, and an end-to-end discovery-rule test.

The regenerated inventory now reports:

- 174 measured entry points;
- 3679 WIRED;
- 1159 BUILT-UNREACHABLE;
- 19/19 inventory controls passing.

That is consistent with the worker's disclosure that the repair materially changed the measured population.

## 4. AR-1122 REACHABILITY RETRACTION — ACCEPTED

The old claim:

`package.json line removed -> extraction returns to 0 WIRED / producer becomes unreachable`

is no longer valid under the corrected instrument.

The worker correctly re-ran the measurement after repairing the instrument and retracted the flattering result.

Do **not** use the old `0 -> 24 WIRED` flip as evidence for Spine A again.

### What still justifies Spine A

The thin compile entry point remains useful because it gives us an explicit, operator-callable path:

`certified record -> compile_certified_record -> produce_spec_artifact_from_record -> .spec.json`

and the wrapper is a direct non-test caller of the canonical producer.

That is enough. We do not need a false claim that one package.json line is the sole reason the producer is statically reachable.

## 5. A1 IS NOT CLOSED — REPORT/REPOSITORY MISMATCH

AR-1124 states that the module docstring, bottom comment, test-module docstring, and assertion message were all corrected.

That is not true at final head `3754dd3e`.

Examples still present:

### In `compile_certified_record.py`

The module docstring still says, in substance:

- `NOT the __main__ guard`;
- rule (c) has never fired;
- the package.json declaration is the reachability edge.

But rule (c) is now repaired in the same final tree.

The bottom comment still says:

- rule (c) is dead code at the time of writing;
- the package.json declaration is the reachability edge.

That is stale after the accepted §3 repair.

### In `test_spine_a_compile_entry_point.py`

`test_package_json_declares_the_entry_point()` still has a docstring saying:

`THE REACHABILITY CARRIER. Deleting this declaration is what actually reverts src/engine/extraction to BUILT-UNREACHABLE — proven by ablation`

That is exactly the claim AR-1124 says it retracted.

`test_entry_module_keeps_its_main_guard()` still says:

`python -m needs it even though the inventory cannot see it.`

The repaired inventory now can see it.

Therefore:

**A1 status = PARTIAL / NOT CLOSED.**

### Required cleanup: A1b

Make a tiny prose-only correction pass over these stale explanations.

Required final meaning:

- `__main__` guard is required for `python -m` execution;
- repaired inventory rule (c) can now discover it;
- package.json remains the explicit operator command for this lane;
- neither the guard nor the package script is claimed to be the sole reason the broader module graph is reachable;
- Spine A's durable value is the explicit callable compile boundary and direct canonical-producer call.

Do not add architecture for this. Do not create another measurement campaign. This is a micro-cleanup.

## 6. INVENTORY BLAST RADIUS — NARROW IT, DO NOT REOPEN THE WHOLE CAMPAIGN

The worker correctly warned that ~354 symbol classifications moved.

We are **not** going to re-audit every old ruling.

Only re-check a prior decision if its load-bearing conclusion specifically depended on the old reason:

`defining module is not reachable from any measured entry point`

Do not reopen conclusions that were independently established by stronger evidence such as:

- zero non-test symbol references;
- direct caller inspection;
- actual production call-site tracing;
- mutation/ablation on the real execution path.

Example: the deleted `build_causal_opening_range` helper was convicted by zero non-test references to the helper itself and then removed after its unique safety assertions were migrated. That conclusion does not automatically reopen because rule (c) changed.

This keeps the repair honest without creating a new multi-day detour.

## 7. CRITICAL-PATH ORDER — CHANGE THE WORKER'S PROPOSED ORDER

The worker proposed:

`C1 -> B/D -> R1`

I am changing that.

**R1 must start now. Do not leave the source-evidence gate until last.**

Why:

The real sVkm certified record is the acceptance-critical fact source. If the certified extraction does not support the expected 5m/1m role semantics, that changes what the remaining transport work must carry. Discover that early, not after all plumbing is complete.

### Fastest robust sequence

1. **A1b micro-cleanup** — prose/test-doc only.
2. **Start R1 real sVkm certification immediately** using the authorized staging + new-manifest lane. Do not touch sealed-12 history.
3. While R1 is in progress / between deterministic stages, continue record-independent work:
   - **C1** `run_class_backtest` validated-role-object -> factory pass-through;
   - **B** TypeScript transport of the hashed role carrier without inference;
   - **D** direct real 5m source-frame supplier, no resampler.
4. When R1 produces the real certified sVkm record, compile it through the new entry point using canonical spec id `sVkmZklJDHI__s0` only if strategy index 0 is what the certified record actually selects.
5. Then run the full §9.2 vertical witness.

If R1 finds that the expected role facts are not supported by certified evidence, STOP and report the evidence gap. Do not hardcode the expected 5m/1m table to make the validator pass.

## 8. §9.2 ACCEPTANCE STILL REQUIRES THE WHOLE VERTICAL PATH

§9.2 remains OPEN.

It closes only when the real path proves:

`real sVkm transcript`
`-> certified sVkm record`
`-> canonical Python producer`
`-> role carrier inside hashed spec`
`-> TypeScript transport`
`-> DB save/reload`
`-> Band C / run_class_backtest`
`-> from_compiled_spec`
`-> SpecConditionStrategy receives the same validated role object`
`-> direct real 5m source frame supplied`
`-> opening range behavior actually depends on 5m source data while execution stays 1m`

Required fail-closed controls from prior rulings still stand.

## 9. STATUS

- A2 identity contract: **ACCEPTED / CLOSED**
- §3 inventory rule (c): **ACCEPTED / CLOSED**
- AR-1122 old reachability-flip claim: **RETRACTED / DO NOT USE**
- Spine A explicit compile boundary: **ACCEPTED, with corrected rationale**
- A1 stale-explanation cleanup: **OPEN — MICRO-FIX**
- R1 real sVkm certification: **AUTHORIZED — START NOW**
- C1 run_class_backtest role pass-through: **OPEN**
- B TypeScript role transport: **OPEN**
- D direct 5m supplier: **OPEN**
- §9.2 full vertical acceptance: **OPEN**
- §9.3 source/candidate pairing: **BLOCKED behind §9.2**
- §9.4 full source-to-trade proof: **BLOCKED**
- Independent grade: **BLOCKED**
- Performance / edge testing: **BLOCKED**

## 10. NEXT REPORT

Return with:

1. A1b stale-prose cleanup evidence;
2. R1 result or fail-closed stop, with the actual certified sVkm evidence artifact committed outside frozen sealed-12 history;
3. C1/B/D progress only where independently completed and red-proofed;
4. no §9.2 victory claim until one real sVkm record crosses the entire vertical path.

**RULING: PROCEED. START THE REAL sVkm CERTIFICATION NOW.**
