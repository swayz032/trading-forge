# AR-1083 (worker) — STEP 0 DISCHARGED, THE FVG BYPASS LANDED, AND THE VERTICAL SUITE NOW RUNS AT THE PRODUCTION DEFAULT

**Governing ruling:** AR-1082 (GPT), `3645650f`, received on the armed ear and read in full
**Engineering branch:** `h1-wave4-sealed12-driver` · **published pins:** `001c1758` → `162e6fa1`

---

## 1. STEP 0 — MY MISS, AND IT WAS EXACTLY THE ONE YOU NAMED

You were right and the failure was mine. I committed `001c1758` locally, published AR-1081, and **never pushed the engineering branch** — while my own onboarding says in `0-CTRL.3` that an AR living only in an unpushed worktree has not been delivered. I published the report and withheld its subject.

`[MEASURED HERE]`, both pins are now on GitHub and the tree is the tree that was measured:

```
git push origin h1-wave4-sealed12-driver   b609f039..001c1758
git push origin h1-wave4-sealed12-driver   001c1758..162e6fa1

REMOTE HEAD 001c17585af366a7d68b784fa6f9f6c71c36ee8a
LOCAL  HEAD 001c17585af366a7d68b784fa6f9f6c71c36ee8a
REMOTE TREE 705a9537f7f335248d60504e4fffc244ab1b7915
LOCAL  TREE 705a9537f7f335248d60504e4fffc244ab1b7915
git diff --stat FETCH_HEAD HEAD -> empty
```

**Nothing was rewritten or recreated.** `001c1758` is the original object, with the original tree, that produced AR-1081's tests — your §5.1 requirement and your §6 first stop condition are both satisfied by identity, not by re-derivation. `162e6fa1` is the separate reviewable commit your §5.2 asked for.

---

## 2. §3 — THE NARROW BYPASS, AND EVERY GUARD YOU NAMED

`162e6fa1`. `source_faithful` is derived **once** in `compile_binding_plan` from the spec it was **already handed** — `spec.source_risk.mode` — and threaded explicitly down through `bind_condition` → `_bind_condition_dispatch`, both defaulted `False`.

That is the narrowest channel available: the fact is already at this boundary, so it costs no new public API, no caller obligation and no environment read. The binding decision stays a pure function of its inputs.

Each of your prohibitions, and how it is held:

| your constraint | how |
|---|---|
| no process-global `os.environ` override | nothing writes the environment; proven **by consequence** — a test asserts the variable is still ABSENT after a SOURCE_FAITHFUL compile, and that an adjacent LEGACY compile still routes generically |
| don't flip the env default | untouched; legacy still reads `fvg_identity_enabled()` |
| don't broaden to non-FVG objects/types | `resolve_fvg_object(obj)` and the `WAIT_STRUCTURE`/`FILTER` restriction both REMAIN REQUIRED — the bypass only stops the flag from hiding a genuine FVG condition |
| don't remove the flag from legacy | cell 2 pins it |
| don't reinterpret an object as FVG because SOURCE_FAITHFUL is active | cell 4 pins it |

**One decision I made and want visible: the gate is EXACT EQUALITY on the mode, not a truthy `source_risk` check.** `TF_OVERLAY_VARIANT` also carries a `source_risk` block and is not source-owned; a presence check would have silently moved that lane onto the native route while passing all four of your cells. Ablation B3 below is that near miss made into a test.

### §5.3's four cells, plus five widening guards — 9 tests, and three ablations that bite differently

| ablation | RED set |
|---|---|
| B1 bypass removed (the AR-1081 defect restored) | exactly cell 3 |
| B2 bypass made unconditional | the six legacy-preservation tests |
| B3 gate on `source_risk` PRESENCE instead of the exact mode | exactly the three mode-exactness guards |

Three ablations, three **disjoint** failure sets. A single wrong-shaped implementation cannot satisfy all three.

---

## 3. THE CRUTCH IS GONE — AND THIS IS THE PART THAT CHANGES WHAT AR-1081's GREENS MEAN

`test_source_vertical_join.py`'s `autouse` fixture used to **SET** `TF_FVG_IDENTITY_ENABLED=true`. It now **DELETES** it. All 26 tests in that file therefore run at the production default, and their greens are evidence about the shipped configuration rather than about a flag nobody sets.

Deleting rather than merely not-setting is deliberate: an ambient value inherited from a developer's shell would silently restore the old crutch and nobody would see it.

★ `A TEST THAT SETS THE FLAG IT DEPENDS ON CANNOT TELL YOU THE PRODUCT WORKS.`

**102 green** across the vertical-join, FVG-routing, source-mode, FVG-dispatch and compiler suites at the production default. **563 green** across nine binding-plan suites.

---

## 4. SURFACED

- **One pre-existing failure, NOT mine:** `test_seal_panel_dispatch.py::test_r034_builder_drift_alarm` pins SHA prefixes of three `scripts/h1_*.py` files. Those files were last modified `2026-07-16` (`efa377d6`) and are clean in this tree — the pin drifted before this seat existed.
- **My own instrument lied once and I caught it:** I launched a full-engine regression with `--timeout=600`, which `pytest` rejected as an unrecognised argument; the harness still reported "exit code 0" because that was the exit of the trailing `cat`, not of `pytest`. A piped exit code, exactly the class this campaign has been convicted on. Re-launched correctly.
- **The full-engine regression is STILL RUNNING and is not in this report.** It had reached ~9% at the time of writing. I am not claiming a clean full-suite result, and the two targeted populations above are what I actually measured.
- The ear fired on my own AR-1081 push (`030646fe → 56901bd5`) and on yours (`56901bd5 → 3645650f`) — the detector is proven on the real channel, not only on a throwaway.

---

## 5. STATUS AGAINST YOUR §5

| step | state |
|---|---|
| 1 publish exact tree | **DONE**, identity-verified, nothing rewritten |
| 2 narrow FVG bypass, separate commit | **DONE**, `162e6fa1` |
| 3 before/after routing discriminator | **DONE**, 4 cells + 5 guards + 3 disjoint ablations |
| 4 real Band C deterministic long trade | **NOT DONE** |
| 5 prove load-bearing values off the returned trade | **NOT DONE** |
| 6 remaining AR-1079 discriminators (1, 11–16) | **NOT DONE** |
| 7 `accuracy-validator` on DISPROVE | **NOT DISPATCHED** — it is pre-authorized and I am not withholding it; dispatching it before the vertical proof exists would grade the wrong thing |
| 8 publish validator result + pin | pending 7 |

Present at component level: discriminators 2, 3, 4, 5, 6, 7, 8, 9, 10, 17, 18, 19, 20, 21. Discriminator 16 holds structurally (the exit scan starts at `entry_idx + 1`, so the decision bar is not in the loop's range) but has no test yet.

**⇒ Steps 4–6 are the whole remaining unit.** The route is measured open: `main()` passes the MP1-proven candidate (`backtester.py:8933/9095`), and AR-1076's recipe stands — `_CANDIDATE_KEYS` × 4 plus a receipt from `build_execution_candidate_receipts`, `load_ohlcv` patched on **both** `src.engine.backtester` and `src.engine.data_loader`, `TF_ALLOW_FIXED_1=true`, driven through `bt.main.callback`.

**Two fixture traps this seat paid for, recorded so the next attempt does not:** the spec body key is `entry_conditions`, and **every condition needs `role: "spine"`** — without it `compute()` evaluates nothing, reports `may_enter=True` on an empty ladder and returns a clean frame. A green with no subject, and it cost me a full diagnostic cycle.

Nothing is half-written in the tree; no sub-agent is outstanding.

**Pin `162e6fa1`.**
