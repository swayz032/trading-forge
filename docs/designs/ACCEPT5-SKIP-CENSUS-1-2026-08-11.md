# `ACCEPT5-SKIP-CENSUS-ARTIFACT-1` — R3-4 skip-site census

**Instrument:** worker `claude.exe 6312` · **Ruling:** `R-812 §7` (AUTHORIZED NOW: continue `R3-4`)
· **Contract:** `R-803` (one row per site) · `R-802 §7` (enumerate by TRACKED-NESS and SKIP-BEHAVIOUR,
never by path shape) · `R-799 §5` (the three permitted forms).
**Tree:** `wt-h1-wave4-20260712`, branch `h1-wave4-sealed12-driver`, `HEAD 417eaa22`.

> `R-799 §5`, verbatim, and it is the classification axis:
> *"A RELEASE-AUTHORITY TEST MAY NOT SILENTLY DEPEND ON MACHINE-LOCAL EVIDENCE. Every external
> input must be one of: `[1]` committed governed evidence · `[2]` a deterministic fixture the test
> creates · `[3]` an explicitly pinned external input whose identity is verified before execution.
> Missing required evidence ⇒ FAIL/REFUSE. NEVER `SKIP BECAUSE THIS LAPTOP DOES NOT HAVE IT`."*

---

## 1. DENOMINATOR — MEASURED, AND JOINED TO PRIOR ART BY SITE

```
governed members (manifest, comments stripped)        107
  existence control ...................... 107 / 107 present
  positive control "def test" ............ 105 / 107   (the 2 without are the
                                                        _a_packet_harness.py and
                                                        _forensics_fixtures.py helpers)
raw pattern matches .................................. 36
  comment-only matches (EXCLUDED) ...................... 4   <- would have inflated it
EXECUTABLE SKIP SITES ................................ 32
AR-950 prior art ..................................... 32   <- RECONCILED EXACTLY
owner derivation: blank owners ........................ 0
negative control (a governed file with no skips) ...... 0 matches
```

⚠️ **MY FIRST CENSUS READ `0` AND WAS FALSE.** The manifest stores member paths relative to `src/`;
my first pass looked them up from the repo root, so all 107 lookups missed and the run reported
`0 skip sites`. **The positive control convicted it — `def test` matched `0 of 107`, which is
impossible.** Recorded because a silent `0` here is a false all-clear on the whole item.

⚠️ **THE 4 EXCLUDED MATCHES ARE COMMENTS, NOT CODE** — all in `test_paper_backtest_sizing_parity.py`
(`:289`, `:321`, `:362`, `:375`), and every one is a `SWEEP-F3` notice recording a
`except Exception → pytest.skip` that was **already removed**. **A grep matching only comments is
not a verification**, and here it would have manufactured 4 phantom obligations.

## 2. ⭐ A SITE IS NOT A TEST — SIX OF THE 32 ARE BROADCAST SKIPS

`[MEASURED, nearest enclosing `def` above each site]` **6 of the 32 sites live in HELPER functions,
not in tests.** A `pytest.skip` inside a helper fires for **every test that calls it**, so the
site count is a floor on the affected-test count, never the count itself.

```
_import_validate            test_accuracy_fixes.py:561
_load_sample                test_spec_family_bindings.py:47      <- SAMPLES_DIR
_load_battery               test_spec_family_bindings.py:569
_governed_split             test_spec_family_bindings.py:901     <- blind-readjudication (CLOSED)
_corpus_wait_session_rows   test_spec_family_bindings.py:914
_load_module_at_ref         test_spec_family_bindings.py:1914/:1916  <- git history
```

★★★★★ `A SKIP IN A HELPER IS A BROADCAST SKIP: ONE SITE, AN UNCOUNTED NUMBER OF SILENCED TESTS —
AND THE CENSUS ROW LOOKS EXACTLY LIKE A SINGLE-TEST ONE.`

## 3. THE CENSUS — 32 ROWS

`FIRED-IN-PRISTINE` is **`UNMEASURED` in every row.** It requires the FRESH isolated worktree
(`R-812 §7`: *"positive control must be the FRESH isolated tree, never this one"*), which has not
been run in this pass. **It is not blank because the answer is no; it is blank because I have not
measured it, and `SAMPLES_DIR` passes HERE precisely because this box is that box.**

| # | file · line | owner | trigger | external input | §5 class | fired-in-pristine |
|---|---|---|---|---|---|---|
| 1 | `test_accuracy_fixes.py:466` | `test_delta_only_applied_when_firm_more_expensive` | `mffu_50k not in FIRM_COMMISSIONS` | in-repo config table | **NOT machine-local** — config-shape skip | UNMEASURED |
| 2 | `test_accuracy_fixes.py:561` | `_import_validate` **(helper)** | `exits module has pre-existing import error` | importability of `exits` | **VIOLATION** — masks a real import defect | UNMEASURED |
| 3 | `test_accuracy_fixes.py:568` | `test_divisible_by_3_passes_unchanged` | `exits import error` | same | **VIOLATION** | UNMEASURED |
| 4 | `test_accuracy_fixes.py:578` | `test_non_divisible_rounds_down_with_warning` | `exits import error` | same | **VIOLATION** | UNMEASURED |
| 5 | `test_accuracy_fixes.py:594` | `test_result_never_below_3` | `exits import error` | same | **VIOLATION** | UNMEASURED |
| 6 | `test_fvg_identity_dispatch.py:182` | `test_trace_shows_distinct_fvg_primitive_contributor_when_enabled` | `no entry signal fired on this synthetic fixture/seed` | own synthetic fixture | **VIOLATION** — form `[2]` fixture that skips on its own output | UNMEASURED |
| 7 | `test_levelzone_routing.py:346` | `test_trace_shows_distinct_levelzone_primitive_contributor_when_enabled` | `no entry signal fired on this synthetic fixture/seed` | own synthetic fixture | **VIOLATION** — same class as 6 | UNMEASURED |
| 8 | `test_pnl_accuracy.py:866` | `test_topstep_mes_commission_per_trade_contract` | `Fixture produced no trades in this environment` | fixture outcome | **VIOLATION** — "in this environment" is the tell | UNMEASURED |
| 9 | `test_pnl_accuracy.py:909` | `test_mffu_mes_commission_per_trade_contract` | `Fixture produced no trades in this environment` | fixture outcome | **VIOLATION** | UNMEASURED |
| 10 | `test_pnl_accuracy.py:975` | `test_prop_sim_trusts_net_pnl_no_double_deduction` | `No trades generated — fixture needs more data` | fixture data volume | **VIOLATION** | UNMEASURED |
| 11 | `test_pnl_accuracy.py:992` | `test_prop_sim_trusts_net_pnl_no_double_deduction` | `No daily_pnl_records available — check run_backtest output shape` | backtest output shape | **VIOLATION** — skips on a shape defect | UNMEASURED |
| 12 | `test_signal_vector.py:185` | `test_signal_vector_present_in_result` | `backtester not importable in this test environment` | importability | **VIOLATION** | UNMEASURED |
| 13 | `test_signal_vector.py:195` | `test_signal_vector_present_in_result` | `Data not available: {e}` | **S3 + AWS creds** | **VIOLATION** — input `[3]` of `R-803`'s four | UNMEASURED |
| 14 | `test_signal_vector.py:206` | `test_signal_vector_values_valid` | `backtester not importable` | importability | **VIOLATION** | UNMEASURED |
| 15 | `test_signal_vector.py:215` | `test_signal_vector_values_valid` | `Data not available: {e}` | **S3 + AWS creds** | **VIOLATION** | UNMEASURED |
| 16 | `test_signal_vector.py:228` | `test_signal_vector_is_json_serializable` | `backtester not importable` | importability | **VIOLATION** | UNMEASURED |
| 17 | `test_signal_vector.py:237` | `test_signal_vector_is_json_serializable` | `Data not available: {e}` | **S3 + AWS creds** | **VIOLATION** | UNMEASURED |
| 18 | `test_spec_family_bindings.py:47` | `_load_sample` **(helper)** | `reference sample corpus unavailable at {path}` | **`SAMPLES_DIR`** — 141 files, **0 tracked**, absolute path into ANOTHER worktree | **VIOLATION** — input `[2]` of `R-803`'s four | UNMEASURED |
| 19 | `test_spec_family_bindings.py:569` | `_load_battery` **(helper)** | `h1-battery fixture unavailable at {path}` | h1-battery fixture | **VIOLATION** | UNMEASURED |
| 20 | `test_spec_family_bindings.py:901` | `_governed_split` **(helper)** | `governed grade unavailable at {path}` | blind-readjudication `LOCKED.json` | ✅ **CLOSED** — converted to form `[1]` at `e55a9ef1`, sha `920557eb…`, 978 bytes | UNMEASURED |
| 21 | `test_spec_family_bindings.py:914` | `_corpus_wait_session_rows` **(helper)** | `corpus unavailable at {d}` | corpus dir | **VIOLATION** | UNMEASURED |
| 22 | `test_spec_family_bindings.py:1914` | `_load_module_at_ref` **(helper)** | `git unavailable for parent-diff: {exc}` | **git history** | **VIOLATION** — input `[4]` of `R-803`'s four | UNMEASURED |
| 23 | `test_spec_family_bindings.py:1916` | `_load_module_at_ref` **(helper)** | `revision {ref} unavailable` | **git history** | **VIOLATION** — input `[4]` | UNMEASURED |
| 24 | `test_spec_family_bindings.py:2815` | `test_both_flag_arms_agree_on_every_refusal_path_object` | `docs/ corpora unavailable in this checkout` | `docs/` corpora | **VIOLATION** — "in this checkout" is the tell | UNMEASURED |
| 25 | `test_static_c_partials_ab.py:183` | `test_pf_computation_flag_independent` | `fixture_perfect.json not found in golden dir` | `fixture_perfect.json` | ⚠️ **`R-803`: TRACKED, dead-skip debt, NOT a fifth input** — tracked ⇒ absence must be HARD FAILURE | UNMEASURED |
| 26 | `test_walk_forward_wrc_spa_emission.py:177` | `test_wrc_spa_values_present_when_sufficient_obs` | `CPCV paths unavailable — acceptable: {reason}` | computed `wrc.available` | **VIOLATION** — see §4 | UNMEASURED |
| 27 | `test_walk_forward_wrc_spa_emission.py:192` | `test_wrc_spa_p_values_are_floats_in_unit_interval` | `CPCV unavailable in test environment` | computed `wrc.available` | **VIOLATION** — see §4 | UNMEASURED |
| 28 | `test_walk_forward_wrc_spa_emission.py:305` | `test_wrc_spa_values_present_when_sufficient_obs` | `Plain WF unavailable in test environment` | computed `wrc.available` | **VIOLATION** — see §4 | UNMEASURED |
| 29 | `test_walk_forward_wrc_spa_emission.py:318` | `test_wrc_spa_p_values_in_unit_interval_plain` | `Plain WF unavailable in test environment` | computed `wrc.available` | **VIOLATION** — see §4 | UNMEASURED |
| 30 | `test_wave_b_intrabar_stops.py:380` | `test_eligibility_gate_no_htf_passthrough_preserves_signals` | `backtester not imported — avoid vectorbt JIT hang` | importability | 🛑 **OUT OF SCOPE — `STOP [11]`** | UNMEASURED |
| 31 | `test_wave_b_intrabar_stops.py:405` | `test_eligibility_gate_empty_htf_passthrough` | same | importability | 🛑 **OUT OF SCOPE — `STOP [11]`** | UNMEASURED |
| 32 | `test_wave_b_intrabar_stops.py:426` | `test_eligibility_gate_unregistered_strategy_passthrough` | same | importability | 🛑 **OUT OF SCOPE — `STOP [11]`** | UNMEASURED |

**`unique rows == denominator`: 32 == 32.** ✅ Asserted, per `ACCEPT5-SKIP-CENSUS-ARTIFACT-1`.

## 4. 🛑 THE FINDING THIS CENSUS PRODUCED THAT THE FOUR NAMED INPUTS DID NOT PREDICT

The four `wrc_spa` sites (rows 26–29) do **not** skip on a missing file. They skip on a value the
**system under test computed about itself**: `if wrc.get("available") is False: pytest.skip(...)`.

`[MEASURED, `test_walk_forward_wrc_spa_emission.py:175`, the comment directly above row 26]`:

```
# in an environment with no S3 access or backtester-level bugs.
if wrc.get("available") is False:
```

⇒ 🛑 **THE SOURCE ITSELF STATES THAT THIS SKIP ABSORBS `backtester-level bugs`.** A genuine defect
that makes `wrc` report itself unavailable is silently converted into a SKIP, and the test that
exists to prove WRC/SPA emission reports nothing at all.

★★★★★ `A SKIP CONDITIONED ON THE SUBJECT'S OWN "AM I AVAILABLE" FLAG IS NOT AN ENVIRONMENT GUARD —
IT IS THE SUBJECT BEING ALLOWED TO EXCUSE ITSELF FROM ITS OWN EXAM.`

⚠️ **AND IT IS INVISIBLE TO A BEHAVIOUR CENSUS THE SAME WAY `SAMPLES_DIR` IS** (`AR-950 §5`,
campaign law): if `wrc` is available on this box these four PASS, appear in no skip list and no
failure list, and the dependency is undetectable from the outcome alone.

## 5. 🛑 WHAT THIS ARTIFACT DOES **NOT** ESTABLISH

- 🛑 **`FIRED-IN-PRISTINE` IS `UNMEASURED` FOR ALL 32.** No fresh-tree run was performed in this
  pass. **Nothing here may be read as "these skip / these do not" in a clean checkout.**
- 🛑 **NO CONVERSION HAS BEEN PERFORMED.** This pass is the census only. `R3-4`'s remaining halves —
  convert each in-scope class to a permitted form, and prove causality in a FRESH isolated
  worktree — are **NOT DONE**.
- ⚠️ **THE `§5`-CLASS COLUMN IS MY CLASSIFICATION, NOT A RUN.** It is read from the executable
  trigger line at each site. It NOMINATES the conversion work; it does not prove disposition.
- ⚠️ **BROADCAST-SKIP FAN-OUT IS UNCOUNTED.** `§2` names the 6 helper sites but does **not**
  enumerate how many tests each silences. `[UNENUMERATED — OPEN]`
- ⚠️ **`ACCEPT5-GOVERNED-SKIP-SCOPE-1` (worker-owned, `R-803`) REQUIRES CLASS `A`/`C` TO BE REVIEWED
  INDIVIDUALLY, NEVER A BLANKET `fail`.** No blanket conversion is proposed here.
