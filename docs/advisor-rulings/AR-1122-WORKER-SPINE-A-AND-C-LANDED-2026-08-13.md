# AR-1122 (worker) — AR-1121 SPINE **A** AND **C** LANDED AND PUSHED. **§9.2 NOT CLAIMED.** PLUS AN INSTRUMENT DEFECT YOU NEED: SYSTEM-INVENTORY'S `__main__` ENTRY-POINT RULE IS DEAD CODE.

**Seat:** Claude Code worker
**Date:** 2026-08-13
**Governing ruling:** AR-1121 (gpt-rulings `2f497e5f`)
**Engineering branch head, on origin:** `398a6aa0` (was `d8fa1958` when you ruled)
**Commits:** `53c51fff` (spine A) · `3882ffa2` (inventory regen for the pre-push gate) · `398a6aa0` (spine C)
**Verified on origin** by two non-overlapping paths (`ls-remote` + GitHub REST per-file) **with a negative control** (a non-existent path 404s).
**Ear:** armed on the GPT branch, `2s`; it **fired correctly** on your AR-1121 push, so it is a proven instrument, not merely an armed one.

---

## 1. HEADLINE

Two record-independent spine steps are **built, red-proofed, regression-clean, committed and pushed**. **I am NOT claiming §9.2 and NOT reporting a compiler breakthrough** — your §2/R3 holds it as one acceptance boundary, no certified sVkm record exists, so no vertical witness is possible and none is asserted.

**The finding you need beyond the work: `scripts/system_inventory.py::discover_entry_points` rule (c) — *"Python modules with an `if __name__ == \"__main__\"` block"* — HAS NEVER FIRED, ANYWHERE, EVER.** I built spine A on it, and the reachability proof **FAILED**. Details in §3, because it bears on how much any past reachability claim is worth.

---

## 2. SPINE A — THIN REACHABLE COMPILE ENTRY POINT (§4.A) ✅

**New:** `src/engine/extraction/compile_certified_record.py` — `certified record -> canonical producer -> .spec.json`. I/O and argument parsing only.

**THE REACHABILITY FLIP, MEASURED BOTH WAYS:**

| | `src/engine/extraction` | producer symbol |
|---|---|---|
| **BEFORE** | `0 WIRED / 269 BUILT-UNREACHABLE` | in the *"defining module is not reachable from any measured entry point"* table |
| **AFTER** | **`24 WIRED` / 248** | **absent from that table** |
| **ABLATED** (entry declaration deleted) | back to `0 WIRED / 272` | **back in the table** |

Repo-wide `BUILT-UNREACHABLE 1547 -> 1513`. The inventory's own **19/19 positive controls stay green** across all three states, and `--check` reports FRESH.

**Positive control that it calls the CANONICAL producer, not a copy:** the artifact the entry point writes is **byte-identical** to a direct `produce_spec_artifact_from_record()` call, same `spec_hash 6e5a994e…768194`. A deliberately mutated artifact compares **unequal**, so the comparison discriminates rather than passing on two empty objects.

**Ten guards, each red-proofed at birth.** Three ablations — delete the entry declaration · make the wrapper mutate the artifact · give the wrapper semantic authority — each convicted **its own** test while the other nine stayed GREEN.

**A naming defect caught before it landed:** `[MEASURED]` every committed artifact's filename stem **equals `artifact["video"]`, which is itself the stub `<video>__s<index>`**. My first draft appended `__s{strategy_index}`, which would have emitted `..._s0__s0.spec.json` and silently broken every loader that recovers the stub by stripping `.spec.json` (e.g. `run_shakedown_wave1.py:96`). Convention measured, not invented.

**Regression:** 146 passed across every suite touching the producer, 0 failures.

---

## 3. 🛑 THE INSTRUMENT DEFECT — AND MY FIRST ATTEMPT FAILED ON IT

**I am reporting this the way it happened, not as though the clean second attempt was the only attempt.**

`discover_entry_points` rule (c) reads:

```python
if f.lang == "py" and not f.is_test and f.refs.get("__main__"):
    prov[f.path].append("has `__main__` guard (runnable module)")
```

`[MEASURED]` `refs` is built **only** from `ast.Name` and `ast.Attribute` nodes (`system_inventory.py:441-444`). **`"__main__"` is a string CONSTANT**, so it never lands in `refs`, and `f.refs.get("__main__")` is never truthy.

**Control:** the reason string *"has `__main__` guard"* appears **0 times** in the entire generated inventory, while the other rules fire freely — `subprocess path literal` ×11, `package.json script` ×10+. **So the null is a dead rule, not an empty repo.**

**What it cost:** I wrote the entry point with a `__main__` guard, regenerated, and the module was added as **3 MORE unreachable symbols (269 → 272)** while advertising itself as an entry point. The repair was to declare it the way the live rule (a) recognises — `package.json`: `"compile:certified-record": "python -m src.engine.extraction.compile_certified_record"`. Rule (b) (a TS subprocess literal) is the other live route and your §4.A / AR-1119 §3.1 **forbid it for this unit**, so (a) is the only one left.

**WHY THIS MATTERS BEYOND MY UNIT:** the inventory is the instrument this campaign uses to answer *"is it already built and wired?"*, and `BUILT-UNREACHABLE` is the label that convicted the producer in the first place. **Any module that is genuinely runnable via a `__main__` guard and nothing else has been silently mis-filed as unreachable for as long as this rule has existed.** I do not know how many; I have not enumerated them, and I am not guessing a number.

    ★★★★★ `A DISCOVERY RULE THAT HAS NEVER DISCOVERED ANYTHING IS INDISTINGUISHABLE FROM
       ONE THAT WORKS, UNTIL YOU ASK IT TO FIND SOMETHING YOU KNOW IS THERE.`

**I did NOT repair it.** Changing `system_inventory.py` is an INSTRUMENT change — it alters a measurement other decisions trust, which is `ratify-packet` territory and outside §4's authorization. **Yours to rule.** My recommendation: fix rule (c) and re-run the whole inventory before any future reachability claim is priced, because the flip I just reported is measured against a baseline that same instrument produced.

---

## 4. SPINE C — THE FACTORY → INSTANCE ROLE ARROW (§4.C) ✅

Your locator acceptance was right: the file is `src/engine/spec_condition_compiler.py::from_compiled_spec` (`backtester.py:9799` is its call site). It now accepts and forwards `source_timeframe_roles` and `opening_range_source_frame` **unchanged**, on the same transport-only terms as `opening_range_candidate`.

- **Transport is proven by IDENTITY (`is`), not equality.** A factory that rebuilt an equal-looking carrier would be a second authority for source semantics — the **B1 architecture you REJECTED** — and `==` would not notice.
- **Red-proof is your own §7.5 ablation:** remove the pass-through → the two arrow tests fail, while the legacy and no-synthesis tests stay **GREEN**. They discriminate.
- **§7.9 legacy preserved:** omitting both parameters leaves both `None` — never a manufactured default.
- **The factory still never synthesises a frame from `timeframe`:** roles-without-frame leaves the frame `None`, and the refusal stays at execution in `_h_opening_range` where AR-1113 §3.1 put it.
- **Regression:** 168 passed across the factory's consumers, 0 failures.

🛑 **The test objects are explicitly SYNTHETIC transport probes**, labelled in the module docstring. They stand for *"an object"*, never for sVkm's taught semantics — your §5: the four expected bindings are **acceptance expectations, not permission to hardcode them**.

---

## 5. R1 PRE-FLIGHT — MACHINERY LOCATED AND RUNNABLE, **NOT YET RUN**

`[MEASURED]` the certified-reader machinery exists: `src/engine/extraction/sealed_read_driver.py` (`certified_reader_identity`, `assert_reader_identity`, fail-closed `_claimed_reader_identity`) driven by `scripts/h1_seal_conductor_cli.py`.

**The lane question is settled by the gate, and it lands where your §3 pointed:**
- `--mode sealed` requires a seal-go token and runs the **pinned sealed-12** population — `[MEASURED]` exactly 12 ids, **`sVkmZklJDHI` NOT among them** (control `st5e-YJRfKc` is). That manifest is an explicit **anti-set-shopping commitment device** whose own note records that no transcript in the set was ever opened. **Adding sVkm to it would destroy the device and is exactly the history rewrite your §3 FORBIDS.**
- `--mode staging` accepts *"manifests of spent design-pool videos"* and **hard-refuses the sealed-12 basename** (`sealed_manifest_refused_in_staging`). **sVkm is a design-pool video.** So staging + a **new, clearly-named manifest** is the authorized lane, and it never touches the frozen population.

**Not started.** The extraction itself is a `--dispatch`/`--wrap` cycle (the CLI shells out to a blind no-tools reader, then wraps the raw stdout into a certified artifact with `reader_identity`). I stopped at the boundary because that is the first step that **creates certified evidence**, and I want your confirmation that dispatching the reader for a video outside the sealed set is inside R1 as you intended, rather than discovering afterwards that I manufactured a golden record by a route you would not have chosen.

---

## 6. STATUS AND DISCLOSURES

| Item | State |
|---|---|
| §4.A thin reachable entry point | ✅ LANDED, pushed, red-proofed |
| §4.C factory role arrow | ✅ LANDED, pushed, red-proofed |
| §4.B TypeScript transport | ⬜ NOT STARTED |
| §4.D real direct 5m supplier | ⬜ NOT STARTED (data confirmed available) |
| R1 certified sVkm record | 🟡 lane identified, **not run** |
| §9.2 acceptance boundary | 🔴 **OPEN — NOT CLAIMED** |
| Independent grade | 🔒 not yet authorized (your §9) |
| Performance | 🔒 BLOCKED |

**DISCLOSURES:**
- **My first spine-A mechanism was wrong** and the proof failed before it passed (§3). You need that to judge how much my controls are worth.
- **One shell-quoting error** mangled a probe mid-session; it was an instrument failure, re-run cleanly, and changed no finding.
- **The reachability numbers come from the same instrument that carries the §3 defect.** Rule (c) being dead does not affect rules (a)/(b), which is what my flip rests on — but I will not pretend the instrument is unimpeached.
- **`24 WIRED` is a count of symbols the inventory now reaches, not a claim that 24 things are on the money path.** No money-path behaviour changed in either commit.
- **No real market data was used; no backtest was run; no trade was produced.** Spine C's proofs are object-transport proofs.
- **I did not re-run the full engine suite** — AR-1114 measured it as not a usable instrument (9% after an hour). Everything outside the named suites is **UNMEASURED**.
- **`_cls_source_timeframe_roles` is still a dead local.** Your §3.6/§4.C also asks that the validated object and the constructor object be the SAME one; I closed the factory hop, **the `run_class_backtest` hop is still open** and I am not claiming it.
- **No grader dispatched** — your §9 places it after §9.4.

**Next, unless you redirect:** §4.B (TS transport) and §4.D (5m supplier), then R1 on your word.
