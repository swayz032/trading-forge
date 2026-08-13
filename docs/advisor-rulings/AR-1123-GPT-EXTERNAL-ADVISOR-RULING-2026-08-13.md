# GPT EXTERNAL ADVISOR RULING — AR-1123

**Seat:** GPT external advisor
**Date:** 2026-08-13
**Governing worker report:** AR-1122 (`04a7ece9`)
**Engineering head independently inspected:** `398a6aa01e734f38e8e2dbffe8604c766c67352f`

## 1. RULING

AR-1122 is **ACCEPTED WITH TWO CORRECTIONS BEFORE THE REAL sVkm RUN**.

The worker was right not to claim §9.2. The two landed commits are useful and real, but neither closes the full source→persistence→execution chain by itself.

- **SPINE A:** implementation accepted as a real operator-reachable compile entry point.
- **SPINE C:** factory→instance transport sub-hop accepted.
- **§9.2:** remains OPEN.
- **Performance:** remains BLOCKED.

## 2. SPINE A — ACCEPTED, BUT ITS IDENTITY CONTRACT AND COMMENTS MUST BE FIXED FIRST

I independently inspected `src/engine/extraction/compile_certified_record.py` and `package.json`.

The good part is real:

`package.json` now contains:

`compile:certified-record = python -m src.engine.extraction.compile_certified_record`

and the wrapper calls the existing canonical `produce_spec_artifact_from_record()` rather than copying compiler semantics.

That satisfies the architecture I authorized: a thin Python entry point, not a second compiler and not a TypeScript→Python runtime subprocess dependency.

However, the file still contains **false reachability documentation** after AR-1122 discovered the inventory defect. Its module docstring and bottom comment still say the `if __name__ == "__main__"` guard is the load-bearing reachability edge. It is not. The worker proved the actual edge is the `package.json` script.

**ORDER A1 — repair those comments now.** Do not leave a known-false architectural explanation in production code.

### A second identity defect exists in the CLI contract

The CLI help currently says `--video` is the **source video id**. But the canonical producer copies that argument directly into `artifact["video"]`, and existing portable artifacts use the strategy stub identity, e.g. `-igpOZs8LsM__s0`, not the bare source-video id.

Therefore running the new CLI exactly as its help currently instructs for sVkm could emit:

`sVkmZklJDHI.spec.json`

with `artifact.video == "sVkmZklJDHI"`, while the existing contract expects a strategy identity such as:

`sVkmZklJDHI__s0.spec.json`

with `artifact.video == "sVkmZklJDHI__s0"`.

That is an identity-boundary bug waiting to happen.

**ORDER A2 — make the identity explicit before any real sVkm compile.** Preferred shape:

- replace/rename `--video` with `--spec-id` (or an equally explicit name),
- require the canonical strategy stub as input,
- for strategy index 0 the expected id is `sVkmZklJDHI__s0`,
- refuse a bare source-video id on this entry point,
- refuse a `--spec-id` whose `__sN` suffix disagrees with `--strategy-index`,
- preserve `filename stem == artifact["video"] == canonical spec id`.

Do NOT “fix” this by silently deriving identity from a filename. The caller supplies the identity; the wrapper validates it.

Required red proof:

1. bare `sVkmZklJDHI` + index 0 => REFUSE;
2. `sVkmZklJDHI__s1` + index 0 => REFUSE;
3. `sVkmZklJDHI__s0` + index 0 => artifact filename and `artifact.video` both equal `sVkmZklJDHI__s0`;
4. direct canonical producer and entry-point output remain byte-equivalent for the same record/spec id.

## 3. SYSTEM-INVENTORY RULE (c) DEFECT — CONFIRMED; NARROW REPAIR AUTHORIZED

The worker's instrument finding is valid.

`scripts/system_inventory.py` builds Python `refs` from `ast.Name` and `ast.Attribute`; the literal `"__main__"` in `if __name__ == "__main__"` is an `ast.Constant`, so the advertised test `f.refs.get("__main__")` cannot discover the normal guard.

This means a real runnable Python module whose only entry-point evidence is a `__main__` guard may be mislabeled BUILT-UNREACHABLE.

**AUTHORIZE a narrow instrument repair now.**

Requirements:

- detect an actual top-level `if __name__ == "__main__"` guard from the AST, not by putting arbitrary string constants into generic refs;
- accept the equivalent reversed comparison if the repository uses it;
- do not count comments/docstrings/string mentions;
- add a positive fixture with a genuine guard;
- add a negative fixture containing only the text `"__main__"` in prose/string data;
- regenerate SYSTEM-INVENTORY;
- report the before/after population affected by this specific repair.

Do NOT remove the new `package.json` compile entry just because the corrected instrument can see `__main__`. The package script is the explicit operator command for this compile lane and remains useful production surface.

## 4. SPINE C — FACTORY SUB-HOP ACCEPTED; §4.C IS NOT FULLY CLOSED

I independently inspected `from_compiled_spec()` and `test_spine_c_factory_role_arrow.py`.

The factory now accepts and forwards the exact `SourceTimeframeRoles` and `RoleFrame` objects without rebuilding or inferring them. The identity-based tests are appropriate for this transport boundary.

But AR-1122 correctly discloses that `_cls_source_timeframe_roles` in `run_class_backtest` is still parsed and then read by nothing.

So the real chain is still missing the hop:

persisted carrier
→ SOURCE_FAITHFUL parse
→ `run_class_backtest`
→ `from_compiled_spec(source_timeframe_roles=...)`
→ strategy instance

**ORDER C1 — finish this hop.** The exact validated `SourceTimeframeRoles` object produced by the SOURCE_FAITHFUL gate must be the object passed into `from_compiled_spec`; do not parse a second copy downstream.

The frame input is separate and belongs to the direct-5m supplier work. Do not synthesize it from the 1m execution dataframe.

Required red proof: ablate only the `run_class_backtest` pass-through and the real SOURCE_FAITHFUL construction witness must fail while legacy/no-role construction remains green.

## 5. R1 — YES, RUN THE REAL sVkm CERTIFICATION

The worker asked whether dispatching the certified reader for `sVkmZklJDHI` outside the frozen sealed-12 is what R1 authorized.

**YES. That is what R1 means.**

Use a **new staging/golden manifest** dedicated to sVkm. Do not edit the historical sealed-12 manifest. Do not add sVkm to the old Tier-A 13-record population. Do not rewrite any historical census.

The gate code supports staging/rehearsal manifests other than the frozen sealed-12 and explicitly refuses the sealed-12 basename in staging, which is the correct separation.

### Source-byte requirement

AR-1120 reported that the existing evidence archive already holds the sVkm transcript. The certification must be tied to that source evidence, not silently to a different transcript fetched later.

Therefore the new sVkm golden manifest/receipt must publish the transcript content hash used by the certified read.

Preferred path:

- use the already archived sVkm transcript bytes as the source for the certified reader;
- record their SHA-256 in the new manifest/receipt;
- if the current conductor insists on a fresh fetch, compare the fresh bytes/hash to the archived transcript and **REFUSE on mismatch** rather than silently certifying a different source version.

No transcript mismatch may be waved through because “the video id is the same.”

Then run the existing certified reader machinery normally. No hand-authored strategy JSON and no manual insertion of 5m/1m roles.

## 6. CONTINUE THE OTHER §9.2 SPINE WORK IN PARALLEL

While R1 runs, continue the record-independent work:

### B — TypeScript transport

Add `source_timeframe_roles` to the portable `SpecArtifactBody` parser/transport so Python-emitted roles survive:

`.spec.json → parseSpecArtifact → compiled_spec.spec → DB → reload`.

TypeScript validates shape only. It does not infer role values from `recoverSpecTimeframe()` or the 0.4 lowest-timeframe heuristic.

### D — real direct 5m supplier

Use the existing direct ES 5m data path already measured available for MES via the loader mapping. No resampling. No generic MTF framework.

The production supplier must deliver the direct 5m frame to the same strategy instance whose execution bars are 1m.

## 7. §9.2 ACCEPTANCE BOUNDARY REMAINS ONE VERTICAL PROOF

Do not report §9.2 complete until one real sVkm strategy traverses all of this:

archived/certified source transcript
→ certified sVkm record
→ canonical Python producer
→ hashed `source_timeframe_roles`
→ portable `.spec.json`
→ TypeScript transport
→ DB save/reload
→ SOURCE_FAITHFUL parse
→ SAME role object passed through `run_class_backtest`
→ `from_compiled_spec`
→ executing `SpecConditionStrategy`
→ direct 5m `RoleFrame`
→ source-role-driven opening range actually active.

Expected role values remain acceptance expectations only:

- OPENING_RANGE_WINDOW = 5m / EXPLICIT
- BREAKOUT_CONFIRMATION = 1m / EXPLICIT
- FVG_DETECTION = 1m / SOURCE_RESOLVED_BY_CONTINUITY
- ENTRY_COMPLETION = 1m / SOURCE_RESOLVED_BY_CONTINUITY

If the certified source evidence fails to support any one of those, STOP and report the contradiction. Never make the source fit the validator.

## 8. STATUS

- AR-1122 worker report: **ACCEPTED WITH CORRECTIONS**
- SPINE A thin entry point: **ACCEPTED, identity contract cleanup required before real compile**
- SYSTEM-INVENTORY rule (c): **DEFECT CONFIRMED; narrow repair authorized**
- SPINE C factory→instance transport: **ACCEPTED sub-hop**
- `run_class_backtest` role pass-through: **OPEN**
- R1 sVkm certified extraction: **AUTHORIZED TO RUN NOW**
- TypeScript role transport: **OPEN / proceed in parallel**
- direct 5m production supplier: **OPEN / proceed in parallel**
- §9.2: **OPEN**
- §9.3 exact candidate/source pairing: **BLOCKED on §9.2**
- §9.4 full deterministic trade proof: **BLOCKED on §9.2 + §9.3**
- independent grade: **NOT YET**
- performance/edge testing: **BLOCKED**

Fastest robust path from here:

**A identity cleanup + inventory fix + C1 pass-through + B transport + D direct 5m supplier, while R1 certifies the real sVkm source → one vertical §9.2 witness.**