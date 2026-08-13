# WORKER REPORT — AR-1114 / `SVKM-ROLE-EXEC-1` LANDED AND WIRED / STALE F-3 TEST RETIRED / §9.2–§9.4 UNSTARTED

**Seat:** Claude Code worker
**Date:** 2026-08-13
**Governing ruling:** AR-1113 (gpt-rulings `12b565ad`)
**Branch:** `h1-wave4-sealed12-driver`
**Baseline pin at seating:** `365dfa0bfdff3b9a550c8e56da9f0cca1717ef4e` — IDENTICAL to the head AR-1113 inspected. No stale-premise gap.

**IMPLEMENTATION PIN:** `04231a130fb2…` — `SVKM-ROLE-EXEC-1` + §7 stale-test retirement
**INVENTORY PIN:** `25229a80d05c48950d95d86994fb9dc04b6cc71c` — branch head, ON ORIGIN

**PUBLICATION VERIFIED BY TWO NON-OVERLAPPING PATHS, WITH A NEGATIVE CONTROL:**
`git ls-remote` returns `25229a80…`; GitHub REST resolves both commit objects by SHA and
returns their subjects; `git cat-file -e origin/…:src/engine/svkm_role_execution.py`
succeeds. **Negative control fired correctly** — REST on an all-zero SHA returns
`422 No commit found`, so the positive results are not the API agreeing with anything I
handed it. All three pre-push gates passed, including `SYSTEM-INVENTORY freshness`.

---

## 1. WHAT I DID, IN ONE PARAGRAPH

AR-1113 §9.1 (`SVKM-ROLE-EXEC-1`) and §9.5 (stale F-3 test) are COMPLETE. The narrow
5m-window / 1m-execution seam exists, is red-proofed, and — the part that distinguishes
this from the step you just reclassified — **it is CONSUMED by the production
opening-range handler**, so the role VALUE now selects which bar series the taught range
is aggregated from. §9.2 (real persistence), §9.3 (source/candidate pairing) and §9.4
(discriminators A–G end-to-end) are **UNSTARTED**, and I say so rather than implying the
unit closed the whole sequence.

---

## 2. I INDEPENDENTLY CONFIRMED YOUR §2.4 CORRECTION BEFORE BUILDING ON IT

Your §2.4 was `RELAYED` to me until I measured it. `[MEASURED HERE, 365dfa0b]`:

```
$ grep -rn "_cls_source_timeframe_roles" --include=*.py .
./src/engine/backtester.py:7534:    _cls_source_timeframe_roles = None
./src/engine/backtester.py:7537:        _cls_source_timeframe_roles = _resolve_source_timeframe_roles(strategy)
```

Two lines: the initialisation and the assignment. **Zero reads.** Your reclassification
from "consumed" to "gate-consumed" is correct at the executable line, not merely in
prose.

And the consumer I then found makes the point sharper than the variable does.
`spec_condition_compiler._h_opening_range` built its `OpeningRangeBar`s from
`ctx["high"]`/`ctx["low"]` — **the execution frame** — at `self._bar_interval_minutes()`,
i.e. **the execution timeframe scalar**. So for sVkm the engine would have aggregated the
"5-minute" opening range from five 1-minute bars. `[HYPOTHESIS, NOT MEASURED ON REAL
DATA]` on consistent data that yields the same high/low, which is exactly the shape your
§4 warns about: a right answer from a wrong mechanism.

---

## 3. WHAT LANDED

### 3.1 `src/engine/svkm_role_execution.py` (NEW)

The narrow seam. Refuses every role combination that is not sVkm's
(`OPENING_RANGE_WINDOW=5m`, the other three `=1m`), so it cannot become the generic MTF
engine §3 forbids by accreting one role at a time.

- **Two explicit frames, no resampler** (§3.1). There is no aggregation path in the
  module at all, so the 1m→5m equivalence question is not answered by assumption — it is
  not asked. `src/data/scripts/resample_timeframes.py` already produces stored 5m series
  at the DATA layer; nothing was re-implemented.
- **No second calculator.** Range arithmetic delegates to
  `opening_range_adapter.compute_opening_range_state` (R-736 §5-1).
- **`verify_spacing()` reads the ACTUAL bar spacing**, because a declared-vs-declared
  check compares a label with itself and always passes. This is what catches a 1m series
  wearing a 5m label.
- **Causal gate**: `CausalOpeningRange.state_as_of(as_of)` — levels are unreachable
  without passing an instant, half-open `[start, lock)`.

### 3.2 `spec_condition_compiler.py` — THE WIRING (this is the load-bearing change)

Two typed constructor inputs (`source_timeframe_roles`, `opening_range_source_frame`),
following the `opening_range_candidate` precedent (R-779 §7-1), plus a new
`_resolve_opening_range_source()` that `_h_opening_range` now calls to decide **which
frame owns the range**.

The handler already separated "which bars make the range" from "which bars may see it" —
the lock loop gates execution indices against the adapter's own `lock`. Nothing before
now chose the *first* one by anything but the execution timeframe. Three outcomes, no
fourth:

| roles | outcome |
|---|---|
| absent | legacy — execution frame owns the range, byte-identical to before |
| window tf == execution tf | same bars, but by DECLARATION not assumption |
| window tf != execution tf | the supplied source frame owns it, **or it REFUSES** |

No fallback to `strategy.timeframe` / `trigger_tf` / lowest-timeframe exists in the code,
and `test_the_module_has_no_scalar_fallback_path` proves that on the **AST with all
docstrings stripped**, with a positive control, a negative control on the stripper, and
the forbidden tokens checked against executable code only.

### 3.3 Stale F-3 test retired (§9.5, surgical)

`test_the_unresolved_trade_still_COUNTS_toward_the_reported_metrics` →
`test_the_unresolved_trade_is_EXCLUDED_from_the_realized_metrics`. `[MEASURED]` the win
rate is now `1.0`, not `0.6667`. The old test carried its own retirement instruction and
had become a permanent suite member demanding the contaminated behaviour back. It now
asserts: open trade still present and still `Status=="Open"`, `exit_reason=="signal"`
(no synthetic source close invented), `total_trades==3` unchanged,
`closed_trade_count==2` / `open_trade_count==1`, `realized_metrics_status=="OK"`,
`win_rate==1.0`. No F-3 architecture reopened.

---

## 4. EVIDENCE

### 4.1 Suite

```
src/engine/tests/test_svkm_role_execution.py .................  25 passed
```

### 4.2 ABLATION RED-PROOF — isolated worktree `wt-svkm-ablate` at `365dfa0b`

Module identity witnessed before trusting any run:

```
$ python -c "import src.engine.svkm_role_execution as m; print(m.__file__)"
C:\Users\tonio\Projects\wt-svkm-ablate\src\engine\svkm_role_execution.py
```

| ablation | result |
|---|---|
| CONTROL (unmodified) | **19 passed** |
| causal gate removed (`state_as_of` ignores the lock) | **3 failed**, 16 passed |
| sVkm role-combination guard removed | **1 failed**, 18 passed |
| declared-vs-actual spacing check removed | **2 failed**, 17 passed |
| incomplete-5m-window refusal removed | **1 failed**, 18 passed |
| RESTORED | **19 passed** |

Every guard has a demonstrated path to RED.

### 4.3 BLAST RADIUS — and an honest change of population you must see

🛑 **I COULD NOT USE THE FULL ENGINE SUITE AND I AM NOT PRETENDING I DID.** I started
`pytest src/engine/tests/` on both trees. **After one hour of wall clock both runs stood
at 9% of collection**, while the targeted suites do 238 tests in 8 seconds. At that rate
the full suite is an ~11-hour instrument, so I stopped it. **That is a measured tooling
finding, not an excuse, and it means no full-suite green exists for this unit.**

I replaced it with a population I can defend: the **IMPORT CLOSURE** of everything I
changed — every test file referencing `spec_condition_compiler` / `SpecConditionStrategy`
/ `opening_range_adapter` / `opening_range_definition` / `opening_range_candidate` /
`source_timeframe_roles` / `svkm_role_execution`, **38 files**, plus the F-3 findings file
I edited. Both trees, `-p no:randomly`, ~50s each.

| | mine (`25229a80`) | baseline (`365dfa0b`, clean, my files absent) |
|---|---|---|
| passed | **799** | 773 |
| failed | **2** | 3 |

**Compared by MEMBERSHIP, not by count:**

```
--- REGRESSIONS I CAUSED (mine, not baseline) ---
        (empty)
--- NO LONGER FAILING (baseline, not mine) ---
test_source_population_grade_findings.py::…::test_the_unresolved_trade_still_COUNTS_toward_the_reported_metrics
--- COMMON (pre-existing on BOTH) ---
test_flag_off_parameterized_refusal.py::test_the_canonical_population_matches_its_committed_manifest_by_member
test_opening_range_grammar_firebreak.py::test_existing_parameter_acceptance_guards_stay_green
```

**Zero regressions.** The single disappearance is the retired §7 ID, by construction. The
two survivors fail identically without my files present.

⚠️ **UNMEASURED, AND NAMED:** anything outside that 38-file closure. `test_a_plus_gate_parity.py`
is separately known-broken at baseline (18/38 failing, `ImportError:
_apply_a_plus_confluence_gate`).

### 4.4 The two discriminators that carry the claim

- `test_wiring_a_declared_5m_window_on_a_1m_instance_reads_the_5m_FRAME` — at the
  production seam, with a NEGATIVE CONTROL asserting none of the 1m execution highs
  (100..105) reached the aggregation.
- `test_wiring_red_proof_without_the_role_the_1m_frame_silently_wins` — same instance,
  same supplied 5m frame, no role carrier ⇒ the engine aggregates off the 1m bars and
  says nothing. **The defect has a measured before, not a description.**

---

## 5. 🛑 DISCLOSURES — INCLUDING MY OWN ERRORS

1. **My first red-proof harness was wrong and I nearly believed it.** I ran the ablation
   control through a heredoc whose `git worktree add` failed on a long scratchpad path;
   the `cd` then failed, pytest ran in the ORIGINAL tree, and it printed
   `19 passed` — a perfect-looking control for a worktree that did not exist. Caught by
   reading the stderr I had redirected away. Every ablation number above comes from the
   re-run with the module path witnessed.
2. **My first fallback-absence test was the instrument lying, not the code.** It stripped
   only the MODULE docstring by slicing on `"""`, so `build_causal_opening_range`'s
   docstring — which names the forbidden fallbacks in order to FORBID them — read as a
   violation. The code was clean throughout. Replaced with the AST pass.
3. **`build_causal_opening_range()` is NOT on the production path.** The handler reuses
   the module's *guards* (`assert_svkm_role_combination`, `verify_spacing`,
   `parse_minutes`) and keeps causality in its own already-audited lock loop, because a
   second causal implementation is worse than an unused reference one. So that function
   is a tested reference/standalone form, and I am naming it rather than letting it read
   as wired. **Your call whether to consolidate.**
   ⭐ **AND THIS IS NOW CORROBORATED BY AN INSTRUMENT I DID NOT WRITE.** The regenerated
   `SYSTEM-INVENTORY` classifies the module `5 WIRED / 1 BUILT-UNREACHABLE` on its own
   static pass: `SourceRoleExecutionError`, `parse_minutes`,
   `assert_svkm_role_combination` and `RoleFrame` each carry a non-test reference, while
   `build_causal_opening_range` is flagged *"no non-test reference outside its own
   definition; 1 test file(s) do reference it"*. **A self-reported gap and a generated map
   agree, by two different methods.**
4. **§6.B is satisfied in REFUSAL form, not recomputation form.** Under §3's narrow
   authorisation a divergent `OPENING_RANGE_WINDOW` refuses rather than computing a
   different ORH/ORL. That still proves the value is consumed, but §6.B's literal form
   needs the generic path §3 does not authorise. Recorded in the test's own docstring.
5. **One acceptance-population change**: `..._still_COUNTS_toward_the_reported_metrics`
   is gone, `..._is_EXCLUDED_from_the_realized_metrics` is new. The enclosing CLASS name
   is deliberately unchanged to avoid churning two unrelated passing IDs.
6. **`test_a_plus_gate_parity.py` fails 18/38 at baseline**, unrelated to this work —
   `ImportError: cannot import name '_apply_a_plus_confluence_gate'`. Proven pre-existing
   on a clean `365dfa0b` worktree with my files removed and `git status` empty.
7. **No real market data was used**; every proof here is fixture-level. §6.A's real
   long-side positive witness is NOT claimed.
8. **An orphaned ear process (PID 13092) from a dead session is still running** on the
   box, launched 2026-08-11 with the pre-fix argument signature. I did not kill it — I
   did not arm it.

---

## 6. WHAT IS OPEN

- **§9.2 `SVKM-REAL-PERSIST-1`** — UNSTARTED. No real strategy row carries
  `source_timeframe_roles`; the library still has not walked through the gate. I did not
  trust-wrap the old `confidence: 0.4` scalar and did not create a source artifact.
- **§9.3 `SOURCE-PAIRING-1`** — UNSTARTED.
- **§9.4 `SVKM-E2E-1` discriminators A–G** — only the seam-level forms above exist. A/D/E/G
  are not run end-to-end.
- **§9.7 independent DISPROVE grade** — not dispatched. The sequence you set puts it after
  §9.2–§9.4, and grading a seam whose persistence half does not exist yet spends the pass.
  Say the word and I dispatch it against this pin.
- **Performance** — remains BLOCKED. Nothing here releases it.
