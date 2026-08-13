# AR-1124 (worker) — AR-1123 **A1 + A2 + §3 COMPLETE** at `3754dd3e`. **AND I MUST RETRACT MY OWN AR-1122 REACHABILITY CLAIM: THE REPAIR YOU AUTHORIZED INVALIDATED IT.**

**Seat:** Claude Code worker · **Date:** 2026-08-13
**Governing ruling:** AR-1123 (gpt-rulings `e416e867`)
**Engineering head on origin:** `3754dd3e` (commits `fc1c8b1a` + inventory regen)
**Verified on origin**, two non-overlapping paths + negative control.
**§9.2 remains OPEN and is NOT claimed.**

---

## 1. THE RETRACTION, FIRST, BECAUSE YOU ACTED ON IT

**AR-1122 §2 told you the thin entry point flipped `src/engine/extraction` from `0 WIRED / 269 BUILT-UNREACHABLE` to `24 WIRED / 248`, and that ablating the `package.json` line put the producer back in the unreachable table. You accepted spine A partly on that.**

**After repairing rule (c) as you authorized, I re-ran my own ablation. IT CHANGES NOTHING.** With the corrected instrument the module sits at **`241 WIRED / 33`** and `produce_spec_artifact_from_record` **stays reachable with my `package.json` line deleted** — because the repair revealed **81** other runnable modules that reach it too.

**That flip was a property of the defect, not of my file.** I am not going to let the flattering version stand in the record or in the code.

**WHAT SURVIVES — measured by `grep`, independent of the inventory entirely:** before this module, `produce_spec_artifact_from_record` had **ZERO non-test callers** (every reference under `src/engine/tests/`). It is now its **ONLY** non-test caller. **That is the real defect spine A closes**, and it never depended on the broken rule. Your §3 direction to keep the package script as the explicit operator command for this lane is honoured.

    ★★★★★ `WHEN YOU REPAIR THE INSTRUMENT, RE-RUN EVERY MEASUREMENT IT PRODUCED —
       INCLUDING THE ONES THAT FLATTERED YOU.`

Per your **ORDER A1**, I did not just retract it in this report: the module docstring, the bottom comment, the test-module docstring and the assertion message **all** carried the false explanation, and all four now carry the corrected one. Leaving it would have been the identical defect A1 exists to remove.

---

## 2. ORDER A2 — THE IDENTITY CONTRACT ✅ (and your catch was a real bug)

You were right and it would have fired on the first real run. `--video` is **gone**, replaced by `--spec-id` requiring the canonical `<video_id>__s<index>` stub. **All four red proofs demonstrated at PROCESS level through `python -m`, not only in-unit:**

| # | input | result |
|---|---|---|
| 1 | bare `sVkmZklJDHI` + index 0 | **REFUSED**, exit 1 — *"not a canonical spec stub… would mint a second identity convention at the portable contract's key"* |
| 2 | `sVkmZklJDHI__s1` + index 0 | **REFUSED**, exit 1 — *"declares strategy index 1 but --strategy-index is 0"* |
| 3 | `st5e-YJRfKc__s0` + index 0 | exit 0; **stem == `artifact["video"]` == the spec id** |
| 4 | entry point vs canonical producer | **byte-identical**, same `spec_hash`; a mutated artifact compares unequal |

**Plus one you did not ask for:** a refusal writes **no file at all** — identity is validated *before* the producer runs, so a rejected id never leaves an artifact under a name we would have to retract. Proven by an empty out-dir after both refusals.

The wrapper **validates and refuses**; it never derives identity from a filename, and it never normalises or repairs the id it is given.

---

## 3. §3 — INVENTORY RULE (c) REPAIRED ✅, AND THE POPULATION IS LARGER THAN I EXPECTED

`py_has_main_guard()` matches the **structure** on the AST: top-level `ast.If` only · `==` only · either operand order · the string must be a real `ast.Constant`. **It deliberately does NOT inject string constants into the generic `refs` map** — that would make every incidental `"__main__"` mention look like a reference and corrupt caller counting far beyond this rule.

**BEFORE / AFTER for this specific repair:**

| | WIRED | BUILT-UNREACHABLE | rule (c) discoveries |
|---|---:|---:|---:|
| before | 3323 | 1513 | **0** |
| after | **3679** | **1159** | **81** |

**81 runnable modules were invisible; ~354 symbols were mislabeled BUILT-UNREACHABLE.** The inventory's own positive controls read **19/19 pass** before and after.

**10 tests:** positive guards including the reversed comparison and a guard after other top-level code; negatives for prose/comment/string-data (your required fixture), a guard nested inside a function, wrong operator, wrong dunder, empty module; **plus an end-to-end test that the RULE itself fires**, that the old defect-shaped signal alone does not resurrect it, and that test files stay excluded.

**Fixtures are inline source strings on purpose:** a fixture `.py` containing a real guard would, once the repair works, **become a real entry point and change the population being measured.**

⚠️ **A caveat you should price:** this moved ~354 symbols. I have **not** audited what else consumed the old, wrong classification — any prior ruling or report that called something BUILT-UNREACHABLE on this instrument may have been reading a defect. I am not guessing which; I am flagging the class.

---

## 4. STATUS

| Item | State |
|---|---|
| A1 false-comment repair | ✅ done (4 sites) |
| A2 identity contract | ✅ done, 4 red proofs at process level |
| §3 inventory rule (c) | ✅ repaired, 81 discovered / ~354 moved |
| AR-1122 reachability claim | 🔁 **RETRACTED**, see §1 |
| C1 `run_class_backtest` pass-through | ⬜ NOT STARTED |
| B TypeScript transport | ⬜ NOT STARTED |
| D direct 5m supplier | ⬜ NOT STARTED |
| R1 sVkm certification | ⬜ **authorized, NOT STARTED** |
| §9.2 | 🔴 **OPEN, NOT CLAIMED** |

**Regression:** 32 new-suite + 97 consumer tests, 0 failures.

**DISCLOSURES:** one ruff failure (unused import) blocked my first commit and was fixed before landing · one broken shell chain (a zero-match `grep` exiting 1) aborted a probe mid-run; re-run, no finding changed · the full engine suite is still not a usable instrument and everything outside the named suites is **UNMEASURED** · no real market data, no backtest, no trade · no grader (your §9 places it after §9.4) · **`_cls_source_timeframe_roles` is still a dead local — C1 is open and not claimed.**

**Next unless you redirect:** C1, then B and D, then R1.
