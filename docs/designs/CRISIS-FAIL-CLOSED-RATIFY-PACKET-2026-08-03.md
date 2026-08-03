# RATIFY PACKET — CRISIS FAIL-CLOSED CLASS (`R-639 §6.2`)

**AUTHORED:** 2026-08-03 · **WORKER SEAT** (`AR-687` START-RECEIPT) · **BRANCH** `h1-wave4-sealed12-driver` · **BASE HEAD AT AUTHORING** `95a4da08`
**RULING:** `R-639 §6.2` — ONE packet for the CLASS, not three tickets (`fix-pattern`).
**CLASS PROPERTY:** *a crisis evaluation that did not happen, or that was compared against the wrong limit, must never score as clean.*
**CLASSIFICATION:** instrument-touching (`compute_forge_score` is a promotion-gate surface producing a number other decisions trust) → packet before code, per `ratify-packet`.
**RESERVED CLASS? NO.** Nothing live-trades today; no frozen ref is re-baselined; no operator data is destroyed. → **AUTONOMOUS under independent grade**, operator holds the standing veto. The grader is `accuracy-validator` (doer ≠ grader) and the desk dispatches it.

---

## 🛑🛑★★★★★ READ THIS FIRST — MEMBER 3 (`F-G4`) AS WRITTEN CANNOT BE IMPLEMENTED WITHOUT CHANGING THREE EXISTING TESTS, AND ONE OF THEM ENCODES A PRODUCT DECISION THE DESK RESERVED TO ITSELF

**`[MEASURED HERE, materialised scratch copy of `HEAD`, `git archive HEAD | tar -x`; the shared tree was never mutated]`**

| tree | `python -m pytest src/engine/tests/test_performance_gate.py -q` |
|---|---|
| campaign tree, unmodified (baseline) | **`1 failed, 30 passed`** — the failure is `test_tier1_passes`, pre-existing and unrelated (`AR-685` reported the same) |
| scratch + **`F-G4` exactly as `§6.2.3` words it** | 🛑 **`3 failed, 28 passed`** — `test_tier1_passes` **plus** `test_crisis_veto_all_pass_no_score_change` **plus** `test_crisis_partial_fail_without_dd_breach_no_veto` |

🛑 **AND A THIRD TEST CHANGES MEANING WITHOUT CHANGING VERDICT — the more dangerous half.** `test_score_capped_at_100` stays GREEN because its only assertion is `score <= 100`; under `F-G4` its fixture vetoes and the score it asserts on is `0.0` `[MEASURED HERE: `score= 0.0 veto= True`]`. ★★★★★ **A CAP TEST THAT ONLY EVER SEES `0.0` IS NOT TESTING A CAP. The failure-set diff would have reported "2 new failures" and hidden this one completely.**

### WHY THE COLLISION IS REAL AND NOT A BUG IN MY PROBE
All three fixtures use scenario dicts **with no `max_drawdown` key at all** (`{"passed": True}`, `{"passed": False}`) — `test_performance_gate.py:256`, `:323`, `:338`. `F-G4` routes a **missing** `max_drawdown` to `crisis-stress-unevaluated`, so every one of those scenarios vetoes.

### ✅ THE DISCRIMINATOR — AND IT IS CHECKABLE, NOT A MATTER OF TASTE
🛑 **THE REAL PRODUCER CANNOT EMIT A SCENARIO WITHOUT `max_drawdown`.** `[MEASURED HERE, `stress_test.py`]` `_run_crisis_backtest` has exactly two return paths and **both** carry the key: `:121-128` (success, `"max_drawdown": result.get("max_drawdown", 0)`) and `:131-139` (the CRASHED shape, `"max_drawdown": 0`). `run_stress_test` (`:181-186`) passes those dicts straight through. **`Q1` sole-producer was already confirmed at `R-639 §5` and re-confirmed here: the only non-test assignment of `crisis_results=` is `backtester.py:8420`.**
✅ **SO THE THREE FIXTURES ASSERT A SHAPE PRODUCTION CANNOT PRODUCE** — hand-built dicts, not captured output.
🛑 **BUT `test_crisis_partial_fail_without_dd_breach_no_veto` IS NOT MERELY A FIXTURE — `performance_gate.py:332-342` NAMES IT AS "a deliberate product decision that partial failure without a drawdown breach must not veto", and `R-633` ruled on it.** ★★★★★ **`A BEHAVIOUR PROTECTED BY A TEST IS NOT NECESSARILY INTENDED BEHAVIOUR` (`R-639 §8`) — but deciding WHICH of those two this is, is a product call, and `R-639 §6.4` shows the desk takes product calls. I am not taking it, and I am not editing an assertion to make my own change pass.**

### THE THREE OPTIONS, WITH MY RECOMMENDATION
- **OPTION A — `F-G4` as written + correct the three fixtures to carry an explicit `max_drawdown`** (e.g. `{"passed": False, "max_drawdown": 100.0}` for the partial-fail case). **Preserves the product decision in its actual meaning — *partial failure WITH a real drawdown under the limit does not veto* — and makes the fixtures producible shapes.** ⚠️ **Cost: it edits three existing tests, which is visually identical to tuning-to-green and must therefore be ruled, not assumed.**
- **OPTION B — narrow `F-G4` to `None` / non-finite only, leave "key absent" un-vetoed.** No existing test moves. 🛑 **But it leaves `s.get("max_drawdown", 0.0)`'s vacuity exactly where `R-639 §4` found it, for the one shape most likely to appear if a future producer is added.**
- **OPTION C — `F-G4` as written, leave the three tests RED**, on the `R-638` precedent that a newly-honest failure is a deliverable. 🛑 **I do not recommend it: two of those three would be red for a shape production cannot emit, which is noise, not honesty.**

**MY RECOMMENDATION: OPTION A**, because the fixtures are non-producible and the product decision survives intact under it. **THIS IS A RECOMMENDATION, NOT A DECISION — members 1 and 2 do not depend on it and proceed now; member 3 waits for the ruling.** (`worker-execution §9`.)

---

## 1 — WHAT & WHY NOW (receipts, not narrative)

**Three holes on ONE gate, all the same shape: a crisis result that was never computed, or was compared to the wrong limit, scores as clean.**

**MEMBER 1 — `F-1b` THREADING.** `backtester.py:8396` builds the stress request with `prop_firm_max_dd=config.get("prop_firm_max_dd", 2000.0)`; **`:8410`'s `full_forge_score(...)` call does not pass `firm_max_dd` at all**, so the veto compares against the signature default `2000.0` (`performance_gate.py:262`) `[MEASURED HERE, both lines read]`. **The two halves of one rule compare against different numbers.** `R-639 §2`'s two-hop table: `cfg_dd=1500 / scen_dd=1800` → stress test says FAIL, gate says PASS, score `17.7`.
**MEMBER 2 — `F-G3` SENTINEL.** `stress_test.py:129` catches only `(ValueError, IndexError, KeyError)`; every other exception propagates out of `run_stress_test` into `backtester.py:8432`, which prints one stderr line and sets `result["crisis_results"] = None` `[MEASURED HERE]`. `performance_gate.py:295` is `if crisis_results is not None:` → **the veto loop never runs.** 🛑 **SECOND HOP: `full_forge_score` at `:8410` is INSIDE the same `try`, so when the stress test raises, `result["forge_score"]` silently retains the crisis-BLIND value computed at `:5592-5609`.**
**MEMBER 3 — `F-G4` SCHEMA.** `performance_gate.py:298` is `s.get("max_drawdown", 0.0)` — **an absent measurement defaults to a passing value**; `crisis_results = {}` yields `scenarios = []` and the loop never runs (`veto=False, passed=True`).

**WHY NOW:** these sit on the **live promotion gate**, which is the only surface in the current queue that reaches capital. `R-639 §6.2` ordered it; `R-640`/`R-641`/`R-642` each re-affirmed it as AUTHORIZED AND UNSTARTED.

---

## 2 — BLAST RADIUS

**MEMBER 1 — BOUNDED AND MEASURED.** `[MEASURED HERE]` `firm_max_dd` is referenced in `performance_gate.py` at `:262` (signature), `:274`/`:284`/`:290`/`:305` (docstring + comments) and **`:318`/`:322` — inside the crisis loop only. It touches NO score component.** So threading it changes an outcome **only** when `crisis_results` is non-`None` **and** a scenario's drawdown falls between the caller's configured limit and `2000.0`. **With every registry firm at `2000.0` (`R-639 §2`) and no non-test assignment of `prop_firm_max_dd` anywhere (`[MEASURED HERE]`: `config.py:823` default, `backtester.py:8396`, `stress_test.py:171`/`:213` — all consumers or defaults), today's behaviour is UNCHANGED.** ⚠️ **`[UNENUMERATED — CARRIED FORWARD FROM `R-639 §2`]`: no one has queried Postgres for JSONB-persisted configs. `LATENT` could be wrong there, and this member is the fix either way — the DB question changes urgency, not the remedy.**
**MEMBER 1 — OUT OF SCOPE, DELIBERATELY:** `backtester.py:5609` and `:7759` also omit `firm_max_dd`, but both pass `crisis_results=None`, so threading them is a **no-op today**. Naming them rather than touching them (`§7 small, reversible`).
**MEMBER 2 — CHANGES A PERSISTENCE PATH, AND THIS IS THE ONE TO WATCH.** `[MEASURED HERE]` `src/server/services/backtest-service.ts:1123` is `if (result.crisis_results && ...)` → **today a crashed stress test writes NO `stressTestRuns` row at all; with the sentinel it writes one with `passed: false`.** ✅ **Correct direction — a crash becomes visible in the record instead of silently absent — but it is a new row where there was none, and it is stated, not discovered later.**
**MEMBER 2 — SECOND HOP:** the crisis-aware rescore will now run on the sentinel, so a crashed stress test yields `forge_score = 0.0` **instead of the crisis-blind partial score.** That is the entire point of the member and it is the conservative direction for a gate.
**MEMBER 3 — SEE THE COLLISION BLOCK ABOVE. NOT IMPLEMENTED UNTIL RULED.**
**NO frozen ref, certified band, or golden fixture is re-baselined by any member.**

---

## 3 — THE EXACT CHANGE, SCOPE-LOCKED

**IN SCOPE — exactly three files (plus the test file):**
1. `src/engine/backtester.py:8410` → add `firm_max_dd=config.get("prop_firm_max_dd", 2000.0)`, **the identical expression already at `:8396`.**
2. `src/engine/backtester.py:8432-8434` → replace `result["crisis_results"] = None` with the sentinel, **and run the crisis-aware rescore on it** so the second hop closes.
   ⚠️ **PROPOSED DEVIATION FROM THE RULING'S LITERAL SHAPE, FLAGGED RATHER THAN TAKEN SILENTLY:** `§6.2.2` specifies `{"scenarios": [{...}]}`. I propose **adding `"passed": False` and `"failed_scenarios": ["stress_suite"]`** so the sentinel satisfies the same top-level contract the real producer emits (`stress_test.py:181-186`). **Reason: the TS consumer reads `cr.passed` and `cr.failed_scenarios` (`backtest-service.ts:1127-1129`); a sentinel missing them would persist a crashed run as `failedScenarios: []`, which understates it.** The veto itself does not depend on this — it fires off the scenario's `error` key either way.
3. `src/engine/performance_gate.py:331-341` → **correct the comment.** Once member 1 lands, *"caught by the DD compare above"* becomes true; until then it is a false instruction engineered to stop a reader restoring the condition that would catch the hole (`R-639 §2`).
4. `src/engine/tests/test_performance_gate.py` + `src/engine/tests/test_stress_test.py` → the committed tests below.

**EXPLICITLY OUT OF SCOPE:** the `s.get("max_drawdown", 0.0)` schema change (member 3, blocked on the ruling above) · `stress_test.py:129`'s narrow `except` tuple (widening it is a DIFFERENT fix with its own blast radius; the sentinel makes it safe without widening) · `backtester.py:5609`/`:7759` · `SWEEP-F7`/`F-3` (paused by `R-639`) · the `R-642 §2` exportability boundary (desk-queued) · **no feature flag on any member (`never-flag` — the OFF branch would be the defect).**

---

## 4 — VERIFICATION PLAN (what ships as proof)

**EVERY member ships a COMMITTED test, red-proofed BY DELETION IN A MATERIALISED SCRATCH COPY (`git archive <sha> | tar -x -C <scratch>`) — never by mutating the shared tree. `R-639 §1` is what happens otherwise: an arm is a measurement, a test is a guard.**

| member | committed test | RED without the fix, by deleting… | positive control (must NOT redden) |
|---|---|---|---|
| 1 `F-1b` | `test_crisis_veto_uses_configured_firm_max_dd` — the `1500 / 1800` row: a scenario at `$1800` with a config limit of `$1500` **must** veto | the `firm_max_dd=` kwarg at `:8410` (or its equivalent at the `compute_forge_score` seam) | `test_crisis_veto_triggers_on_dd_breach` stays green |
| 2 `F-G3` | `test_stress_test_crash_emits_unevaluated_sentinel` — a `run_stress_test` raising `RuntimeError` yields a `crisis_results` dict whose scenario carries `error`, **and** `forge_score == 0.0` (the second hop) | the sentinel assignment (revert to `= None`) | the DD-breach and `unevaluated` tests stay green |
| 3 `F-G4` | **blocked on the ruling above** | — | — |

🛑 **A NEGATIVE ASSERTION NEEDS A POSITIVE WITNESS.** Member 2's test must first prove the crash path RAN (the sentinel exists / the stderr line fired) and only then assert the score is `0.0` — otherwise a function that does nothing satisfies it.
🛑 **EACH DELETION MUST CONVICT ONLY ITS OWN GUARD** (`R-637 §1`), reported as a table like `AR-685`'s.
**FULL-FILE RUNS PUBLISHED VERBATIM, BEFORE AND AFTER**, with the pre-existing `test_tier1_passes` failure named each time so the delta is unambiguous.
**STOP CONDITION (`R-639 §6.2`), RESTATED AND ACCEPTED:** if member 1's threading changes any existing test's verdict, I **STOP and report the failure-set diff** — that would mean a test encoded `2000.0` as intended behaviour, and that is a ruling. ★★★ **Member 3 has ALREADY hit that condition; this packet is that report.**

---

## 5 — ROLLBACK

⚠️ **CORRECTED AT DELIVERY — THIS PLANNED "one commit per member" DID NOT SURVIVE CONTACT, AND I AM NOT LEAVING THE PLAN STANDING AS IF IT HAD.** Members 1 and 2 share one enabling change (the two extracted helpers), so splitting them would have meant staging partial hunks inside one function — more risk than the granularity buys. **The packet ships as ONE commit** on `h1-wave4-sealed12-driver`; `git revert <sha>` restores the prior behaviour for the whole class, which is the unit `R-639 §6.2` ordered anyway (`fix-pattern`, one concept). **No flag, no env var, no migration, no schema change, no data written by this work.** Member 2's only persistence effect is a row that would not otherwise exist; reverting stops new ones and leaves the old records untouched.

---

## GRADE (doer ≠ grader)
**I do not grade this.** When the members land, the independent grade belongs to the **`accuracy-validator`** agent, dispatched by the desk, with: the claim verbatim, the pinned commit, the working `pytest` recipe, an explicit **novel false-green hunt**, and a **durable receipt path** (`docs/designs/GRADE-*.md`, committed by the grader itself, per `R-634`).
