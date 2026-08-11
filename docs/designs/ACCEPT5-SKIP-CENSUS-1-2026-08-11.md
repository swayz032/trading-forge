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

✅ **`FIRED-IN-PRISTINE` IS NOW POPULATED FROM OBSERVATION FOR ALL `32` ROWS** — see `§6` (axis matrix)
and `§7` (the run, by membership). **Every `DID NOT FIRE` carries a POSITIVE WITNESS that the owning
test actually EXECUTED**, because an unfired guard and an unrun test are indistinguishable from a
blank cell.
🛑 **AND THE CONTROL THAT WAS SUPPOSED TO PRODUCE THIS COLUMN DOES NOT WORK: `[MEASURED, §6]` a FRESH
LINKED WORKTREE ON THIS BOX VARIES ZERO AXES.** `R-812 §7`'s *"positive control must be the FRESH
isolated tree"* cannot discriminate here — it is a control with no contrast. **The column below is
therefore a statement about THIS BOX's state, not a portability claim** (`R-813 §8 [P2]`), and
`SAMPLES_DIR` still passes HERE precisely because this box is that box.

| # | file · line | owner | trigger | external input | §5 class | fired-in-pristine |
|---|---|---|---|---|---|---|
| 1 | `test_accuracy_fixes.py:466` | `test_delta_only_applied_when_firm_more_expensive` | `mffu_50k not in FIRM_COMMISSIONS` | in-repo config table | **NOT machine-local** — config-shape skip | **DID NOT FIRE** |
| 2 | `test_accuracy_fixes.py:561` | `_import_validate` **(helper)** | `exits module has pre-existing import error` | importability of `exits` | **VIOLATION** — masks a real import defect | ✅ **SITE REMOVED** (converted) |
| 3 | `test_accuracy_fixes.py:568` | `test_divisible_by_3_passes_unchanged` | `exits import error` | same | **VIOLATION** | ✅ **SITE REMOVED** (converted) |
| 4 | `test_accuracy_fixes.py:578` | `test_non_divisible_rounds_down_with_warning` | `exits import error` | same | **VIOLATION** | ✅ **SITE REMOVED** (converted) |
| 5 | `test_accuracy_fixes.py:594` | `test_result_never_below_3` | `exits import error` | same | **VIOLATION** | ✅ **SITE REMOVED** (converted) |
| 6 | `test_fvg_identity_dispatch.py:182` | `test_trace_shows_distinct_fvg_primitive_contributor_when_enabled` | `no entry signal fired on this synthetic fixture/seed` | own synthetic fixture | **VIOLATION** — form `[2]` fixture that skips on its own output | **DID NOT FIRE** |
| 7 | `test_levelzone_routing.py:346` | `test_trace_shows_distinct_levelzone_primitive_contributor_when_enabled` | `no entry signal fired on this synthetic fixture/seed` | own synthetic fixture | **VIOLATION** — same class as 6 | **DID NOT FIRE** |
| 8 | `test_pnl_accuracy.py:866` | `test_topstep_mes_commission_per_trade_contract` | `Fixture produced no trades in this environment` | fixture outcome | **VIOLATION** — "in this environment" is the tell | **DID NOT FIRE** |
| 9 | `test_pnl_accuracy.py:909` | `test_mffu_mes_commission_per_trade_contract` | `Fixture produced no trades in this environment` | fixture outcome | **VIOLATION** | **DID NOT FIRE** |
| 10 | `test_pnl_accuracy.py:975` | `test_prop_sim_trusts_net_pnl_no_double_deduction` | `No trades generated — fixture needs more data` | fixture data volume | **VIOLATION** | **DID NOT FIRE** |
| 11 | `test_pnl_accuracy.py:992` | `test_prop_sim_trusts_net_pnl_no_double_deduction` | `No daily_pnl_records available — check run_backtest output shape` | backtest output shape | **VIOLATION** — skips on a shape defect | **DID NOT FIRE** |
| 12 | `test_signal_vector.py:185` | `test_signal_vector_present_in_result` | `backtester not importable in this test environment` | importability | **VIOLATION** | ✅ **SITE REMOVED** (converted) |
| 13 | `test_signal_vector.py:195` | `test_signal_vector_present_in_result` | `Data not available: {e}` | **S3 + AWS creds** | **VIOLATION** — input `[3]` of `R-803`'s four | 🛑 **FIRED** |
| 14 | `test_signal_vector.py:206` | `test_signal_vector_values_valid` | `backtester not importable` | importability | **VIOLATION** | ✅ **SITE REMOVED** (converted) |
| 15 | `test_signal_vector.py:215` | `test_signal_vector_values_valid` | `Data not available: {e}` | **S3 + AWS creds** | **VIOLATION** | 🛑 **FIRED** |
| 16 | `test_signal_vector.py:228` | `test_signal_vector_is_json_serializable` | `backtester not importable` | importability | **VIOLATION** | ✅ **SITE REMOVED** (converted) |
| 17 | `test_signal_vector.py:237` | `test_signal_vector_is_json_serializable` | `Data not available: {e}` | **S3 + AWS creds** | **VIOLATION** | 🛑 **FIRED** |
| 18 | `test_spec_family_bindings.py:47` | `_load_sample` **(helper)** | `reference sample corpus unavailable at {path}` | **`SAMPLES_DIR`** — 141 files, **0 tracked**, absolute path into ANOTHER worktree | **VIOLATION** — input `[2]` of `R-803`'s four | **DID NOT FIRE** |
| 19 | `test_spec_family_bindings.py:569` | `_load_battery` **(helper)** | `h1-battery fixture unavailable at {path}` | h1-battery fixture | **VIOLATION** | **DID NOT FIRE** |
| 20 | `test_spec_family_bindings.py:901` | `_governed_split` **(helper)** | `governed grade unavailable at {path}` | blind-readjudication `LOCKED.json` | ✅ **CLOSED** — converted to form `[1]` at `e55a9ef1`, sha `920557eb…`, 978 bytes | **DID NOT FIRE** |
| 21 | `test_spec_family_bindings.py:914` | `_corpus_wait_session_rows` **(helper)** | `corpus unavailable at {d}` | corpus dir | **VIOLATION** | **DID NOT FIRE** |
| 22 | `test_spec_family_bindings.py:1914` | `_load_module_at_ref` **(helper)** | `git unavailable for parent-diff: {exc}` | **git history** | **VIOLATION** — input `[4]` of `R-803`'s four | **DID NOT FIRE** |
| 23 | `test_spec_family_bindings.py:1916` | `_load_module_at_ref` **(helper)** | `revision {ref} unavailable` | **git history** | **VIOLATION** — input `[4]` | **DID NOT FIRE** |
| 24 | `test_spec_family_bindings.py:2815` | `test_both_flag_arms_agree_on_every_refusal_path_object` | `docs/ corpora unavailable in this checkout` | `docs/` corpora | **VIOLATION** — "in this checkout" is the tell | **DID NOT FIRE** |
| 25 | `test_static_c_partials_ab.py:183` | `test_pf_computation_flag_independent` | `fixture_perfect.json not found in golden dir` | `fixture_perfect.json` | ⚠️ **`R-803`: TRACKED, dead-skip debt, NOT a fifth input** — tracked ⇒ absence must be HARD FAILURE | **DID NOT FIRE** |
| 26 | `test_walk_forward_wrc_spa_emission.py:177` | `test_wrc_spa_values_present_when_sufficient_obs` | `CPCV paths unavailable — acceptable: {reason}` | computed `wrc.available` | **VIOLATION** — see §4 | **DID NOT FIRE** |
| 27 | `test_walk_forward_wrc_spa_emission.py:192` | `test_wrc_spa_p_values_are_floats_in_unit_interval` | `CPCV unavailable in test environment` | computed `wrc.available` | **VIOLATION** — see §4 | **DID NOT FIRE** |
| 28 | `test_walk_forward_wrc_spa_emission.py:305` | `test_wrc_spa_values_present_when_sufficient_obs` | `Plain WF unavailable in test environment` | computed `wrc.available` | **VIOLATION** — see §4 | **DID NOT FIRE** |
| 29 | `test_walk_forward_wrc_spa_emission.py:318` | `test_wrc_spa_p_values_in_unit_interval_plain` | `Plain WF unavailable in test environment` | computed `wrc.available` | **VIOLATION** — see §4 | **DID NOT FIRE** |
| 30 | `test_wave_b_intrabar_stops.py:380` | `test_eligibility_gate_no_htf_passthrough_preserves_signals` | `backtester not imported — avoid vectorbt JIT hang` | importability | 🛑 **OUT OF SCOPE — `STOP [11]`** | **DID NOT FIRE** |
| 31 | `test_wave_b_intrabar_stops.py:405` | `test_eligibility_gate_empty_htf_passthrough` | same | importability | 🛑 **OUT OF SCOPE — `STOP [11]`** | **DID NOT FIRE** |
| 32 | `test_wave_b_intrabar_stops.py:426` | `test_eligibility_gate_unregistered_strategy_passthrough` | same | importability | 🛑 **OUT OF SCOPE — `STOP [11]`** | **DID NOT FIRE** |

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

## 4b. `[P4]` THE SURFACE EXTENDED FROM THE **MARKER** TO THE **CONSEQUENCE** (`R-813 §2`)

🛑 **`R-813 §2` is right and the gap is real: §3's population is `pytest.skip` — a MARKER. The defect
CLASS is "a governed test whose environmental branch SWALLOWS instead of announcing", and a swallowed
exception reports `PASSED`, so it is invisible to a skip census by construction.**

**INSTRUMENT: `ast`, not grep** — an `ExceptHandler` whose body has no observable effect
(`pass` / `continue` / bare `return`), docstring-only statements stripped.

```
members from manifest ............ 107      missing on disk 0      parsed 107/107
SWALLOW handlers (no effect) ..... 14
ACTIVE handlers (do something) ... 14       <- NEGATIVE CONTROL, must be >> 0
distinct FILES with a swallow .... 8
DESK SEED test_walk_forward.py:379 in population: True   <- POSITIVE CONTROL
```

### Individual review — `ACCEPT5-GOVERNED-SKIP-SCOPE-1` forbids a blanket verdict

| site | handler | disposition |
|---|---|---|
| `test_walk_forward.py:379` | `except Exception: pass` | ✅ **LEGITIMATE NARROW-PROPERTY HANDLER** — 🛑 **RETRACTED FROM `CONFIRMED DEFECT` BY `R-814 §0`, AND THE RETRACTION IS THE DESK'S OWN.** `[ARTIFACT-SOURCED, `R-814 §0`, read at `src/engine/walk_forward.py:2521-2536`]` the `optimize` guard raises **TWELVE LINES BEFORE** the data load, with no intervening branch ⇒ at `optimize=False` the property under test is **already decided** before any S3/data exception can occur; a wrongly-firing guard raises `NotImplementedError`, which the FIRST handler converts to `pytest.fail`. **The broad arm can only swallow errors occurring AFTER the verdict.** 🛑 **DO NOT REPAIR: deleting it would convert unrelated S3 unavailability into a FALSE RED in a governed member** |
| `test_black_swan_evaluator.py:682` | `except Exception: pass` | ⚠️ **CANDIDATE** — swallows an `__import__` failure; the bound name is not used by the assertion that follows. Needs its own read; **not claimed as a defect** |
| `test_trigger_safety_refusal.py:1042` · `:1102` | `except Exception: pass` | ✅ **DELIBERATE** — carries `# noqa: BLE001` and a written rationale: the neighbour arm may fail *downstream* of the consumers, and the question asked is *which consumers were reached*. Same shape, documented intent |
| `test_trigger_safety_refusal.py:1040` · `:1100` · `:1173` | `except SystemExit: pass` | ✅ **LEGITIMATE** — absorbing a CLI `SystemExit` is the point of the call |
| `test_mp1_candidate_persistence.py:287` · `test_mp1_candidate_receipt.py:402` | `except Exception: return` | ✅ **CORRECT FAIL-CLOSED IDIOM** — *"refusing is the correct behaviour"*, and the non-raising path falls through to `pytest.fail(...)`. 🛑 **ALSO FORBIDDEN SCOPE — MP1 files, `R-813 §8`. Named, not touched** |
| `test_spec_family_bindings.py:536` · `:545` · `:2794` | `except OSError/SyntaxError/Exception: continue` | ✅ **LEGITIMATE ITERATION** — skipping unparseable members while walking a corpus |
| `test_flag_off_parameterized_refusal.py:331` · `test_s6_candidate_transport_and_adapter_execution.py:552` | `except SyntaxError/TypeError` | ✅ **LEGITIMATE** — narrow, typed, control-flow |

⇒ ★★★★★ **CORRECTED BY `R-814 §1`: THE EXTENSION ADDS `0` CONFIRMED DEFECTS, `1` CANDIDATE, `13`
LEGITIMATE — NOT `14`, AND NOT `1`.** 🛑 **The single "confirmed" was the desk's own seed and it has
been RETRACTED IN FULL** (`§0` of `R-814`); this census carried it for one round and no longer does.
⚠️ **`ACCEPT5-SILENT-SWALLOW-SURFACE-1` IS RE-SPECIFIED, NOT CLOSED** — `0` confirmed, `1` candidate,
further expansion **DEFERRED on measured low yield**, and `DEFERRED ≠ CLOSED` (`[instance-not-condition]`).
**`R-813 §2` predicted the shape** (*"several will be legitimate teardown"*), and the individual review is
what separates them. ★★★★★ **`AN UNSCOPED ALARM IS AS WRONG AS AN UNSCOPED REASSURANCE — IT JUST FEELS
LIKE DILIGENCE INSTEAD OF COMPLACENCY.`** ⚠️ **The `[P4]` instrument used that retracted seed as its
POSITIVE CONTROL. The control still fired correctly (the handler IS a no-effect handler); what was
wrong was the DISPOSITION assigned to it, one layer up — so the instrument is sound and only its
verdict column changed.** ★★★★ **`A WIDER POPULATION IS NOT A LONGER DEFECT LIST — WIDENING THE SURFACE
AND CLASSIFYING IT ARE TWO ACTS, AND SHIPPING ONLY THE FIRST MANUFACTURES ALARM.`**
⚠️ **`[UNENUMERATED — OPEN]`** the swallow pattern covers `pass` / `continue` / bare `return`. A
handler that logs-and-continues, or returns a sentinel, has the same consequence and is **NOT** in
this population.

## 4c. `[P5]` THE A1 PRE-FIX ARM THE DESK SAID I OWED — NOW RUN

`R-813 §4` was right that `"7 / 32 with a control each"` over-read. The missing arm is now executed,
in a disposable worktree at `c6362fc3` (the parent of the A1 conversion), same planted import:

```
PRE-fix  + planted broken backtester import -> 3 SKIPPED
  SKIPPED [1] test_signal_vector.py:185: backtester not importable in this test environment
  SKIPPED [1] test_signal_vector.py:206: backtester not importable in this test environment
  SKIPPED [1] test_signal_vector.py:228: backtester not importable in this test environment
POST-fix + same plant                       -> 3 FAILED
```
✅ **The `-rs` REASON is the join key: it skipped through the IMPORT clause, not the data clause** —
so the arm convicts the mechanism the conversion actually removed. **Worktree removed; `git worktree
list` shows no orphan.**
⇒ **CORRECTED TALLY: `6` sites with a full pre-fix-false-green + post-fix-red pair (3 `A2` + 3 `A1`)
· `1` site (`_import_validate`) removed on STATIC proof of zero callers, no dynamic arm.**

## 5. 🛑 WHAT THIS ARTIFACT DOES **NOT** ESTABLISH

- ✅ **SUPERSEDED BY `§6`/`§7`: `FIRED-IN-PRISTINE` IS NOW MEASURED FOR ALL 32.** ⚠️ **BUT THE ORIGINAL
  WARNING SURVIVES IN A SHARPER FORM: `[MEASURED, §6]` the fresh tree varies NO axis, so the column
  says what fires ON THIS BOX and is **NOT** a clean-checkout claim.**
- ⚠️ **CONVERSIONS ARE `7 / 32`, NOT `0` AND NOT `32`** (`A1`+`A2`, `AR-964 §2`). The remaining `25`
  are unconverted; `§7` groups them by ROOT CAUSE rather than site-by-site.
- ⚠️ **THE `§5`-CLASS COLUMN IS MY CLASSIFICATION, NOT A RUN.** It is read from the executable
  trigger line at each site. It NOMINATES the conversion work; it does not prove disposition.
- ⚠️ **BROADCAST-SKIP FAN-OUT IS UNCOUNTED.** `§2` names the 6 helper sites but does **not**
  enumerate how many tests each silences. `[UNENUMERATED — OPEN]`
- ⚠️ **`ACCEPT5-GOVERNED-SKIP-SCOPE-1` (worker-owned, `R-803`) REQUIRES CLASS `A`/`C` TO BE REVIEWED
  INDIVIDUALLY, NEVER A BLANKET `fail`.** No blanket conversion is proposed here.

---

## 6. 🛑 `[P2]` THE AXIS MATRIX — AND IT REFUTES THE CONTROL THAT WAS SUPPOSED TO PRODUCE `§3`'s COLUMN

**Instrument:** worker `claude.exe 23692` · **Ruling:** `R-814 §7` (`AUTHORIZED NOW`, items 2–3) ·
**Pin:** disposable worktree `wt-pristine-r34-20260811`, **detached at `120011c8`**.
⚠️ **JOIN KEY — the pin is NOT current `HEAD`, and I state the delta rather than hiding it:**
`[MEASURED HERE]` `git diff --stat 120011c8 4ccad27c` = **2 files, both under `docs/designs/`,
`0` lines of executable code.** ⇒ the run measures the same executable tree as current `HEAD`.

`R-813 §8 [P2]` orders MACHINE-LOCAL state separated from CREDENTIAL state, and forbids citing
*"it skipped there too"* on an axis that was not varied. **So each axis is reported with the command
that measured it, and `NOT VARIED` where it was not varied:**

| axis | mechanism in the code | command that measured it | varied by a FRESH LINKED WORKTREE? |
|---|---|---|---|
| **CREDENTIAL** (S3/AWS) | `load_ohlcv` → S3 read, aborts before DuckDB | `boto3.Session().get_credentials()` → `NONE`; env probe; `ls -A ~/.aws` → `0` entries | 🛑 **NOT VARIED** — absent on the box itself, so a worktree cannot change it |
| **`SAMPLES_DIR`** | `test_spec_family_bindings.py:41`, a **hardcoded ABSOLUTE path**, no env override | `os.path.isdir(...)` from inside the fresh tree → `True`, `141` files | 🛑 **NOT VARIED** — an absolute path resolves identically from any cwd |
| **GIT HISTORY** | `_load_module_at_ref` → `git show <ref>:<path>` | `git rev-parse --git-common-dir` → **the MAIN repo's `.git`** | 🛑 **NOT VARIED** — a linked worktree SHARES the object store |
| **`docs/` CORPORA** | `_BATTERY_DIR`, shakedown corpus, `_all_wait_session_objects` (repo-relative) | `git ls-files` → **146** and **16** TRACKED; present in the fresh tree | 🛑 **NOT VARIED** — a checkout materialises tracked files |
| **GOLDEN FIXTURE** | `GOLDEN_DIR / "fixture_perfect.json"` | `git ls-files` → **1 TRACKED**, `EXISTS on disk` | 🛑 **NOT VARIED** — same reason |

⇒ 🛑🛑🛑 **A FRESH LINKED WORKTREE ON THIS BOX VARIES `0` OF `5` AXES.** `R-812 §7`'s *"the positive
control must be the FRESH isolated tree"* **cannot discriminate here — it is a control with no
contrast**, and a green from it would have proven nothing.
★★★★★ **`AN ISOLATED COPY IS NOT AN ISOLATED ENVIRONMENT. THE THING YOU DUPLICATED WAS THE WORKING
DIRECTORY; EVERY INPUT THAT ACTUALLY DECIDES THESE SKIPS LIVES SOMEWHERE ELSE — IN THE MACHINE, IN
THE SHARED OBJECT STORE, OR AT AN ABSOLUTE PATH THAT DOES NOT CARE WHERE YOU RUN FROM.`**
✅ **This was PRE-REGISTERED as `HYPOTHESIS` in `AR-965 §5` before the run and RATIFIED as
pre-registered by `R-814 §4`.** ⚠️ **The measured result is WORSE than my own prediction — I predicted
untracked in-tree state would vary; `[MEASURED]` it does not, because the corpora are TRACKED.**

## 7. ✅ `[P1]`/`[P3]` THE RUN — `ARM C0`, REPORTED BY MEMBERSHIP

**`ARM C0` = credential chain ACTIVELY DISABLED, not merely observed absent** (`R-814 §3`):
`AWS_ACCESS_KEY_ID`/`SECRET`/`SESSION_TOKEN` emptied · `AWS_PROFILE`/`AWS_DEFAULT_PROFILE` emptied ·
`AWS_SHARED_CREDENTIALS_FILE` and `AWS_CONFIG_FILE` pointed at non-existent paths ·
`AWS_EC2_METADATA_DISABLED=true` · container-credential URIs unset.
**Pre-arm control, `[MEASURED HERE]`:** `boto3.Session().get_credentials()` → `NONE`.

```
MEMBERS (by the guard's OWN read_manifest, imported not re-implemented)  107
  resolved 107 / 107      missing 0        <- existence control
NODES COLLECTED                                                        2417
  passed 2381 · failed 31 · skipped 3 · xfail 2
```
🛑 **`3` REAL SKIPS, NOT `5` — AND THE `2` ARE MINE TO OWN:** `[MEASURED HERE]` `junitxml` encodes a
strict `xfail` as `<skipped type="pytest.xfail">`. My first parser read the ELEMENT and would have
reported `5` skips. **Corrected by splitting on the `type` attribute before any claim was made.**
★★★★ **`I READ THE NEIGHBOURING OBJECT AGAIN: THE ELEMENT NAMED "skipped" IS NOT THE EVENT NAMED
"skip".`** (`[i-measured]`.) The `2` are deliberate tracked findings in
`test_session_role_adversarial_fence.py` (`strict=True` xfail), **not environment skips.**

**THE `3` SKIPPED NODE IDS, VERBATIM — `[P3]` MEMBERSHIP, NEVER COUNTS:**
```
src.engine.tests.test_signal_vector.TestBacktesterSignalVectorIntegration::test_signal_vector_present_in_result
src.engine.tests.test_signal_vector.TestBacktesterSignalVectorIntegration::test_signal_vector_values_valid
src.engine.tests.test_signal_vector.TestBacktesterSignalVectorIntegration::test_signal_vector_is_json_serializable
REASON (all three, identical): "Data not available: S3 read for
 's3://trading-forge-data/futures/ES/consolidated/5min.parquet' aborted before DuckDB:
 missing AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY"
```

### `C0` vs the un-disabled baseline arm — a REPRODUCIBILITY control, joined by NODE ID
```
baseline nodes 2417   C0 nodes 2417
only-in-baseline 0    only-in-C0 0    OUTCOME FLIPS 0
POSITIVE CONTROL: 1 planted flip -> detector reports exactly 1  => DISCRIMINATES
```
⇒ ✅ **Actively disabling the chain changed NOTHING, which is itself the finding: it rules out a
profile, a shared-config file, or instance metadata quietly supplying credentials — possibilities
that mere env-var absence does NOT exclude.** ★★★ **`"NO ENV VAR" IS NOT "NO CREDENTIAL SOURCE".`**

### `FIRED-IN-PRISTINE` — every `DID NOT FIRE` carries a POSITIVE WITNESS THAT THE TEST RAN
| verdict | rows | witness |
|---|---|---|
| 🛑 **FIRED** | `13`, `15`, `17` | the 3 node IDs above, with the exact skip reason |
| ✅ **SITE REMOVED** (converted `A1`/`A2`) | `2`, `3`, `4`, `5`, `12`, `14`, `16` | `[MEASURED]` `pytest.skip(` call sites across governed members = **25**; `32 − 7 = 25` **reconciles EXACTLY** against `1a639679` (`A1`, 3) + `c6362fc3` (`A2`, 4) |
| **DID NOT FIRE** | `1`, `6`–`11`, `18`–`32` (22 rows) | each owning test observed **`passed`** in the run; for the 6 helper/broadcast sites the module executed **339 / 339 passed, 0 skipped**, and `[MEASURED]` every helper has live call sites (`_load_sample` 3 · `_load_battery` 2 · `_governed_split` 2 · `_corpus_wait_session_rows` 1 · `_load_module_at_ref` 6) |

⚠️ **THE HONEST LIMIT ON ROWS `12`/`14`/`16`:** their witness node is the **SAME NODE** as `13`/`15`/`17`,
which skipped through the DATA clause. **This run cannot independently re-prove the import clause is
gone** — that was proven by the pre/post arms in `AR-964 §2`, and it is cited, not re-derived.
⚠️ **STATIC CALL SITES ARE NOT EXECUTION TRACES.** *"Helper has callers + module had zero skips"* is
strong, but a per-helper execution trace is `[UNENUMERATED — OPEN]`.

### THE REMAINING `25`, GROUPED BY ROOT CAUSE (`R-814` acceptance — not site-by-site)
| root cause | rows | status |
|---|---|---|
| **CREDENTIAL / S3** (the only cause that FIRES today) | `13`, `15`, `17` | 🛑 `ACCEPT5-SIGNAL-VECTOR-DATA-SUBSTRING-1` — **HIGH, REACHABLE.** Repair by typed/deterministic classification, **never a better substring** (`R-813 §6`) |
| **MACHINE-LOCAL artifact paths** (`SAMPLES_DIR`, battery, corpora, git history, golden) | `18`–`25` | tracked-or-present ⇒ **dead-skip debt**: a tracked input's absence must be a HARD FAILURE, not a skip (`R-799 §5`) |
| **SUBJECT SELF-EXCUSE** (`wrc.available is False`) | `26`–`29` | 🛑 `ACCEPT5-SUBJECT-SELF-EXCUSE-1`. **PASSED here ⇒ `available` was `True` ⇒ the clause is UNTESTED by this run**, and `STOP [30]` forbids converting it ahead of evidence |
| **FIXTURE-OUTCOME skips** (own synthetic fixture / trade count) | `1`, `6`–`11` | form `[2]` fixtures that skip on their own output — conversion candidates, unconverted |
| **OUT OF SCOPE** | `30`–`32` | `STOP [11]`, `R-814` forbidden list. **Named, not touched** |

## 8. 🛑 WHAT `§6`–`§7` DO **NOT** ESTABLISH

- ~~🛑 **`ARM C1` (CREDENTIALS ON) IS NOT RUN — BLOCKED ON THE OPERATOR.** `[MEASURED]` this box has
  **no** AWS credential source … the claim *"these 3 skips are caused by the credential axis ALONE"*
  is `[UNPROVEN]`.~~ 🛑 **STRUCK, NOT DELETED (preserve-and-strike) — `C1` RAN; see `§9`.**
  ⚠️ **AND THE STRUCK SENTENCE CONTAINED A REAL ERROR OF MINE, RETAINED HERE DELIBERATELY:** *"this box
  has no AWS credential source"* was **scoped to the standard chain** (env vars, `~/.aws`, instance
  metadata) and **I never enumerated `.env` files.** `[MEASURED]` the operator's gitignored `.env`
  carries live keys. ★★★★★ **`I ENUMERATED THE MECHANISM I KNEW AND REPORTED THE ABSENCE AS TOTAL —
  WHICH IS THIS CENSUS'S OWN CONVICTION (MARKER vs CLASS) COMMITTED BY THE PERSON WRITING IT UP.`**
- ✅ **AND `C1`'s CONTROL WAS RUN FIRST, NOT ASSUMED (`R-814 §3`):** *"credentials present"* is not
  *"the required read succeeds"* — see `§9`.
- ⚠️ **`26`–`29` REMAIN UNTESTED IN BOTH ARMS** — they passed, so the self-excuse clause never
  evaluated. `[UNPROVEN]`, and it is exactly what `C1` would probe.
- ⚠️ **THE `31` FAILURES ARE NOT CHARACTERISED HERE.** This artifact is about SKIPS; the reds are the
  standing baseline population and were neither analysed nor claimed.
- ⚠️ **PORTABILITY IS NOT CLAIMED ANYWHERE IN `§6`/`§7`**, per `R-813 §8 [P2]` and `R-814 §7.3`.

## 9. ✅✅ `ARM C1` — CREDENTIALS ON. THE CREDENTIAL AXIS IS NOW **ISOLATED BY MEASUREMENT**

**Operator authorised the credential use in his own words (*"aws keys are in the files"*) in answer to
the ask filed by `AR-966 §4`.** 🛑 **HANDLING, PER `R-814 §3`: runtime input only — read from the
gitignored `.env`, injected into the child process's environment, NEVER written into the disposable
tree, NEVER committed, NEVER printed. The runner pipes every line of its own output through a
REDACTOR so a boto3/DuckDB error that echoes a key cannot leak into a log or a report.**

✅ **PROVENANCE MEASURED BEFORE USE, VALUES NEVER READ ALOUD:**
```
.env          UNTRACKED, and IGNORED at .gitignore:5      <- no credential in git
.env.example  TRACKED, placeholders only
key material  AWS_ACCESS_KEY_ID len=20 · AWS_SECRET_ACCESS_KEY len=40   (lengths only)
```

### 9.1 🛑 THE POSITIVE CONTROL RAN **FIRST**, AND THE ARM WAS CONDITIONAL ON IT
`R-814 §3` is explicit that *"credentials present"* is not a control. So before the population ran,
the runner attempted **the exact object the skipping tests require**, and was written to **REFUSE the
arm (`SystemExit 3`) if it failed**:
```
head_object  Bucket=trading-forge-data  Key=futures/ES/consolidated/5min.parquet
-> CONTROL_OK bytes=7708321
```
⇒ ✅ **THE REQUIRED READ PATH GENUINELY RESOLVES.** ★★★★ **`AN ARM GATED ON ITS OWN CONTROL CANNOT
PRODUCE A GREEN FROM A BROKEN READ — THE REFUSAL BRANCH IS WHAT MAKES THE GREEN MEAN ANYTHING.`**

### 9.2 ✅ `C0` → `C1`, JOINED BY NODE ID — EXACTLY THREE FLIPS, AND NOTHING ELSE MOVED
```
C0 nodes 2417        C1 nodes 2417        only-C0 0        only-C1 0
C1 outcomes: passed 2384 · failed 31 · skipped 0 real (+2 xfail)   <- ZERO real skips

OUTCOME FLIPS C0 -> C1 : 3      ALL skipped -> passed
  test_signal_vector.TestBacktesterSignalVectorIntegration::test_signal_vector_present_in_result
  test_signal_vector.TestBacktesterSignalVectorIntegration::test_signal_vector_values_valid
  test_signal_vector.TestBacktesterSignalVectorIntegration::test_signal_vector_is_json_serializable

NEGATIVE CONTROL: unchanged = 2414   <- the arm moved 3 of 2417, not everything
```
⇒ ✅✅ **THE CREDENTIAL AXIS IS ISOLATED. Rows `13`/`15`/`17` skip because of credentials ALONE —
`[MEASURED]`, two arms, same pin, same machine-local state, one variable changed.**
🛑 **AND THE CLAIM STAYS SCOPED: this isolates the axis FOR THESE THREE NODES. It says nothing about
the other 22 rows, whose inputs were present in BOTH arms and therefore untested by this pair.**

### 9.3 ⚖️ WHAT `C1` SETTLES ABOUT `ACCEPT5-SUBJECT-SELF-EXCUSE-1` — AND WHAT IT DOES NOT
`R-814 §8` banked a conditional: *"if `available=False` persists WITH valid credentials and
deterministic synthetic data, that is evidence of a real backtester/WF defect, not an environment
fact."*
⇒ `[MEASURED]` **THE ANTECEDENT DID NOT FIRE.** Rows `26`–`29` **PASSED in BOTH arms**, so
`wrc.available` was `True` in both and the self-excuse clause **never evaluated in either.**
✅ **THEREFORE: NO evidence of a backtester/WF defect — and equally NO evidence the clause is safe.**
🛑 **`ACCEPT5-SUBJECT-SELF-EXCUSE-1` REMAINS OPEN AND UNTESTED. `STOP [30]` still binds.**
★★★★★ **`A CONDITIONAL BANK WHOSE ANTECEDENT NEVER FIRED IS NOT DISCHARGED — AND THE RUN THAT PASSED
IS EXACTLY THE RUN THAT PROVES NOTHING ABOUT IT.`**

### 9.4 🛑 WHAT `C0`/`C1` STILL DO NOT ESTABLISH
- 🛑 **The `22` `DID NOT FIRE` rows are NOT isolated by this pair.** Their inputs were present in both
  arms; only the credential axis was varied. **`NOT VARIED` still means `NOT VARIED`.**
- 🛑 **Rows `26`–`29` UNTESTED** (`§9.3`), and **`25 / 32` remain UNCONVERTED** — grouped by root cause
  in `§7`, deliberately not edited site-by-site.
- ⚠️ **`C1` PASSING IS NOT A LICENCE TO LEAVE THE SKIP IN PLACE.** `R-799 §5` is unchanged: a
  release-authority test may not silently depend on machine-local evidence. **A test that PASSES only
  because this operator's `.env` happens to hold live keys is exactly the dependency the rule
  forbids** — `C1` proves the CAUSE, it does not make the skip permissible.
- ⚠️ **NO PORTABILITY CLAIM IS MADE ANYWHERE.** Both arms ran on one box.

## 10. ✅ CLUSTER `A` — LANDED. ROWS `13`/`15`/`17` CARRY A `FINAL_DISPOSITION` AND A `PROOF_RECEIPT`

**Ruling:** `R-815 §7` Cluster `A`. **Schema:** `R-815 §7`'s adopted six fields. 🛑 **The single pristine
Boolean is RETIRED — `AXIS_VARIED` is written explicitly, because `FIRED = NO` does NOT mean portable
when the dependency was present in BOTH arms.**

| field | rows `13`, `15`, `17` (`test_signal_vector.py:195/:215/:237`) |
|---|---|
| `FIRED_C0` | **YES** — all three skipped, credential chain actively disabled |
| `FIRED_C1` | **NO** — all three passed with credentials injected (positive control `head_object` = `7,708,321` bytes) |
| `AXIS_VARIED` | **CREDENTIAL — VARIED.** The only axis of the five that was varied; the other four are `NOT VARIED` (`§6`) |
| `ROOT_CAUSE` | remote S3 OHLCV read, converted to a skip by a `str(e)` substring test (`"S3" or "No such file" or "data"`) |
| `FINAL_DISPOSITION` | ✅ **CONVERTED to `R-799 §5` form `[2]`** — a deterministic in-test fixture through `run_backtest(request, data=...)`. **The broad `except → pytest.skip` is DELETED, not narrowed** (`R-815`: do not improve the substring) |
| `PROOF_RECEIPT` | `§10.1` below — four controls, all executed |

### 10.1 THE FOUR CONTROLS, EXECUTED
```
[1] PRE-FIX FALSE GREEN      C0 arm: the 3 nodes SKIPPED, reason names the
                             credential variables.                      MEASURED
[2] POST-FIX CLOUD INDEPENDENCE
      backtester.load_ohlcv PLANTED to raise "REMOTE LOADER MUST NOT BE
      CALLED" (the CHOKEPOINT, never a consumer) -> all 3 still PASS.
      RED-PROOF OF THE PLANT ITSELF: same patch with the fixture removed
      -> AssertionError("REMOTE LOADER MUST NOT BE CALLED") raised, so the
      plant provably sits on the live path.                             MEASURED
      Shipped as a PERMANENT test, not a throwaway arm:
        ::test_signal_vector_path_never_reaches_the_remote_loader
[3] THREE CONTRACT MUTATIONS on the REAL result path
      (backtester.py:5825 "signal_vector": signal_vector -- the engine's own
       emission line, NOT a copy of an assertion)
      M1 key removed      -> test_signal_vector_present_in_result     RED
      M2 value 2 injected -> test_signal_vector_values_valid          RED
      M3 non-serializable -> test_signal_vector_is_json_serializable  RED
      pre-battery sha256 PIN c58c8901... re-verified after EVERY arm and at
      the end -> CLEAN. (A killed arm has previously left a mutation live
      under a stale "restore: OK"; the pin is why that cannot happen here.)
[4] UNMUTATED CONTROL        16 passed / 0 skipped                     MEASURED
```
⭐ **AND THE NEW CONTROL IS NOT A RUBBER STAMP: it went RED under all three mutations too** — a guard
that survives every mutation of the thing it guards is not a guard.

### 10.2 ✅ POPULATION EFFECT, BY MEMBERSHIP — AND IT REPRODUCES `C1` **WITHOUT** CREDENTIALS
```
C0 (pre-fix, no creds)  2417 nodes | passed 2381 · failed 31 · REAL SKIPS 3
postA (fix, no creds)   2418 nodes | passed 2385 · failed 31 · REAL SKIPS 0
  new node: ...::test_signal_vector_path_never_reaches_the_remote_loader
  FLIPS: 3, ALL skipped -> passed (the three signal_vector nodes)
  unchanged: 2414        <- NEGATIVE CONTROL; failures 31 -> 31, no regression
```
⇒ ★★★★★ **THE FIX REPRODUCES, ON A CREDENTIAL-LESS BOX, EXACTLY THE OUTCOME THAT INJECTING LIVE
CREDENTIALS PRODUCED IN `C1` — SAME THREE NODES, SAME DIRECTION. THAT IS THE POINT: THE TEST NO LONGER
NEEDS THE OPERATOR'S `.env` TO REPORT ANYTHING.**

### 10.3 🛑 A RESIDUAL SENSITIVITY I AM REPORTING RATHER THAN ABSORBING
🛑 **`[MEASURED HERE, engine stdout]` the fix does NOT make the engine make zero S3 attempts.** The HTF
daily-cache build calls the same loader, FAILS, and **catches it**, emitting
`{"event": "backtest.htf_passthrough_engaged", ... "all signals pass unfiltered"}` — so the eligibility
gate runs in **passthrough** without credentials and **for real** with them.
⚠️ **The asserted `signal_vector` properties hold on both paths (`C1` and `postA` agree), so Cluster `A`'s
claim stands — but the ENGINE'S INTERNAL PATH still differs by environment.**
🛑 **OUT OF CLUSTER `A`'s SCOPE** (`R-815`: tests/evidence only, **no production trading-behaviour
change**), so it is **NAMED, NOT TOUCHED**, and recorded in the test's own docstring so the next reader
cannot mistake a green for full cloud independence. ★★★★ **`A TEST THAT PASSES ON BOTH ARMS CAN STILL BE
MEASURING TWO DIFFERENT ENGINES.`**
