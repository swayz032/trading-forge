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
| 19 | `test_spec_family_bindings.py:569` | `_load_battery` **(helper)** | `h1-battery fixture unavailable at {path}` | h1-battery fixture | ✅ **CLOSED** — Cluster `D`, converted to form `[1]` hard assert (now `:575`); see `§11` | **DID NOT FIRE** |
| 20 | `test_spec_family_bindings.py:901` | `_governed_split` **(helper)** | `governed grade unavailable at {path}` | blind-readjudication `LOCKED.json` | ✅ **CLOSED** — converted to form `[1]` at `e55a9ef1`, sha `920557eb…`, 978 bytes | **DID NOT FIRE** |
| 21 | `test_spec_family_bindings.py:914` | `_corpus_wait_session_rows` **(helper)** | `corpus unavailable at {d}` | corpus dir | ✅ **CLOSED** — Cluster `D`, converted to form `[1]` hard assert (now `:924`); see `§11` | **DID NOT FIRE** |
| 22 | `test_spec_family_bindings.py:1914` | `_load_module_at_ref` **(helper)** | `git unavailable for parent-diff: {exc}` | **git history** | ✅ **CLOSED** — Cluster `F`, converted to form `[3]` pinned+identity-verified; see `§12` | **DID NOT FIRE** |
| 23 | `test_spec_family_bindings.py:1916` | `_load_module_at_ref` **(helper)** | `revision {ref} unavailable` | **git history** | ✅ **CLOSED** — Cluster `F`, converted to form `[3]`; see `§12` | **DID NOT FIRE** |
| 24 | `test_spec_family_bindings.py:2815` | `test_both_flag_arms_agree_on_every_refusal_path_object` | `docs/ corpora unavailable in this checkout` | `docs/` corpora | ✅ **CLOSED** — Cluster `D`, converted to form `[1]` hard assert (now `:2833`); see `§11` | **DID NOT FIRE** |
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
        ::test_signal_vector_path_never_reaches_the_remote_loader   <- RENAMED,
        see R-817 sec3(1)(a); the name asserted the OPPOSITE of what AR-968 sec4
        measured. TRUE NODE ID OF RECORD, and the one admitted to the chain:
        ::test_signal_vector_contracts_survive_remote_loader_failure
        Body UNCHANGED -- identity corrected, evidence untouched.
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
            RENAMED at R-817 sec3(1)(a) to its true property; ADMITTED to the
            successor chain under that truthful ID at canonical 2419 (AR-972):
            ...::test_signal_vector_contracts_survive_remote_loader_failure
  NOTE: postA's 2418 was MANIFEST-DERIVED, not the canonical authority
        (R-816 sec1). Canonical after admission = 2419, DERIVED not asserted.
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

---

## 11. ✅ CLUSTER `D` — LANDED. ROWS `19`/`21`/`24` CARRY A `FINAL_DISPOSITION` AND A `PROOF_RECEIPT`

**Ruling:** `R-818 §7[3]`, continued by `R-819 §8[1]`. **Schema:** `R-815 §7`'s adopted six fields, as
Cluster `A` used at `§10`. **Tree:** `wt-h1-wave4-20260712`, pin `48a7d0ac` (`STOP [36]` — a figure
states its tree).

| field | row `19` (`:569`) | row `21` (`:914`) | row `24` (`:2815`) |
|---|---|---|---|
| `FIRED_C0` | **NO** | **NO** | **NO** |
| `FIRED_C1` | **NO** | **NO** | **NO** |
| `AXIS_VARIED` | **NOT VARIED** — resource present in both arms | **NOT VARIED** | **NOT VARIED** |
| `ROOT_CAUSE` | tracked artifact treated as machine-local | tracked corpus dir treated as machine-local | tracked corpora treated as machine-local |
| `FINAL_DISPOSITION` | ✅ **`R-799 §5` form `[1]`** — committed governed evidence; `pytest.skip` **DELETED**, replaced by a hard `assert` | ✅ **form `[1]`**, same shape | ✅ **form `[1]`**, same shape |
| `PROOF_RECEIPT` | `§11.1` arms `R19` | `§11.1` arms `R21` | `§11.1` arms `R24` |

**TRACKED-NESS RE-MEASURED HERE, NOT INHERITED FROM `AR-966 §6`** (`git ls-files`, this pin):
`session-ab-blind-grade-RESULT.json` **TRACKED** · `session-ab-blind-grade-sample.json` **TRACKED** ·
`shakedown_specs/*.spec.json` **16 tracked / 16 on disk / 0 untracked** ·
`docs/**/*.json` **1082 on disk = 1025 tracked + 57 untracked**.

### 11.1 THE PROOF RECEIPT — THREE ARMS PER ROW, IN A DISPOSABLE WORKTREE PINNED AT `48a7d0ac`
🛑 **All three skips are `DID NOT FIRE` on this box, so the absence was PLANTED. A `POST` arm alone
cannot tell "the guard bites" from "it always fails", so the `PRE` arm is mandatory.**

```
ROW 19  _load_battery -- reached from a MODULE-LEVEL @parametrize (:813), COLLECTION time
  PRE  + artifact absent   exit=2  1 error   <- NOT a skip; see 11.2
  POST + artifact absent   exit=2  1 error, AssertionError naming the exact missing file
  POST + artifact present  exit=0  339 passed                     (no regression)

ROW 21  _corpus_wait_session_rows -- shakedown_specs/ moved aside
  PRE  + corpus absent     exit=0  1 skipped  <- the false green, reproduced
  POST + corpus absent     exit=1  1 failed, "these 16 spec files are committed"
  POST + corpus present    exit=0  1 passed                       (no regression)

ROW 24  empty census -- MUTATION planted on the real path (_all_wait_session_objects -> set())
        the plant REFUSES to arm if its target string is absent (MUTATION TARGET ABSENT)
  PRE  + empty census      exit=0  1 skipped  <- the false green, reproduced
  POST + empty census      exit=1  1 failed, "an empty census is a broken checkout"
  POST + unmutated         exit=0  1 passed                       (no regression)

WHOLE-FILE CONTROL, fixed tree, nothing planted:  exit=0  339 passed
BASELINE, unfixed tree, nothing planted:          exit=0  339 passed   => 0 flips
```
⚠️ **Exit codes captured DIRECTLY from `python -m pytest`, never through a pipe** (`[ps-counting-encoding]`
— a piped exit code is the last stage's).

### 11.2 🛑 A CORRECTION TO THIS CENSUS'S OWN SEVERITY CLAIM FOR ROW `19`
🛑 **`[MEASURED HERE, pytest 9.0.3]` row `19`'s pre-repair behaviour was **NOT** a silent skip.** `pytest`
refuses a module-level `pytest.skip()` without `allow_module_level=True` and raises a **collection ERROR**:
> *"Using pytest.skip outside of a test will skip the entire module. If that's your intention, pass
> `allow_module_level=True`."*

⇒ **On this pytest version row `19` was already fail-closed, and the repair's value is DIAGNOSTIC, not a
false-green removal: the old error names no artifact at all, the new one names the exact missing tracked
file and says the checkout is broken.** ⚠️ **The false-green risk was real on older `pytest`, where a
module-level skip silently retired all `339` tests — so the conversion is still required by `R-799 §5`;
but this census's implied "silent skip" severity for row `19` is `[CORRECTED]` here.**
★★★★★ **`I EXPECTED A SKIP, GOT AN ERROR, AND THE HONEST MOVE WAS TO CORRECT THE CENSUS RATHER THAN LET
MY OWN RED-PROOF HARNESS'S "UNEXPECTED" VERDICT BE QUIETLY RE-LABELLED AS THE PREDICTED ONE.`**

### 11.3 ⚠️ WHAT CLUSTER `D` DOES **NOT** ESTABLISH
⚠️ **NO portability claim.** The three arms ran on ONE box in ONE linked worktree; `[fresh-worktree-varies-nothing]`
— a linked worktree varies `0` of `5` env axes, so this is a PLANT-based proof, not an environment-variation proof.
⚠️ **Row `24`'s guard is now DOMINATED by row `19`'s:** on a genuinely docs-less checkout, collection fails at
`_load_battery` before row `24`'s test runs. Row `24`'s assert is defence-in-depth, and its conviction rests on a
**planted mutation**, not on a reachable natural state. **Stated, not hidden.**
⚠️ **`57` untracked `docs/**/*.json` contribute **ZERO** WAIT_SESSION objects on this box** (census reads `395`
tracked-only and `395` as-committed) — **but that is a measurement of THIS working copy, not a guarantee about
any other.**
🛑 **ROWS `2`–`12`, `25`–`29` (Clusters `B`, `C`, `G`) STILL CARRY THE RETIRED SINGLE BOOLEAN and no
`FINAL_DISPOSITION`/`PROOF_RECEIPT`.** `R-819`'s `ACCEPTANCE` requires all `32` rows to carry them.
**REPORTED AS AN OPEN DEBT, NOT REPAIRED — those rows are not Cluster `D`'s** (`R-819 §8[8]`, no scope expansion).

---

## 12. ✅ CLUSTER `F` — LANDED. ROWS `22`/`23` CARRY A `FINAL_DISPOSITION` AND A `PROOF_RECEIPT`

**Ruling:** `R-818 §7[3]`, continued by `R-820 §9[1]`. **Schema:** `R-815 §7`'s six fields.
**Tree:** `wt-h1-wave4-20260712`, pin `2d8b1da1` (`STOP [36]`).

| field | row `22` (`:1914`) | row `23` (`:1916`) |
|---|---|---|
| `FIRED_C0` | **NO** | **NO** |
| `FIRED_C1` | **NO** | **NO** |
| `AXIS_VARIED` | **NOT VARIED** — `[AR-966 §6]` a linked worktree SHARES the object store, so a fresh tree cannot vary the git-history axis | **NOT VARIED**, same reason |
| `ROOT_CAUSE` | `git` invocation failure treated as an environment gap | pinned revision absent treated as an environment gap |
| `FINAL_DISPOSITION` | ✅ **`R-799 §5` form `[3]`** — explicitly pinned external input, **identity VERIFIED before execution**; `pytest.skip` **DELETED** | ✅ **form `[3]`**, same boundary |
| `PROOF_RECEIPT` | `§12.1` | `§12.1` |

**THE PIN, MEASURED AT `2d8b1da1` — all four commits verified ANCESTORS of `origin/h1-wave4-sealed12-driver`,
so this history is fetchable from a full clone and is NOT machine-local evidence:**
```
ee49fdca~1  ->  blob f9a56c7e0016a4675e259c9abbccd012771019b2    50116 bytes
d8cf8043    ->  blob 02c6bf25b50886671b218f3ce506cce765078da1    75796 bytes
6dd3a00f    ->  blob 133df1979f8895a380f0161e094abae1943be206    96633 bytes
6a56618b    ->  blob c34250cae48c73ed186fadbab5b939fb4a17e1a6   108090 bytes
```
⭐ **`_load_module_at_ref` is called with FOUR distinct refs across FIVE sites, so form `[3]` needed a MAP,
not a constant. A ref exec'd but ABSENT from the map is itself a hard failure** — an unpinned historical
input is exactly the dependency `R3-4` exists to remove.

### 12.1 THE PROOF RECEIPT — PLANTED TRIGGERS, PRE/POST, IN A DISPOSABLE WORKTREE AT `2d8b1da1`
```
ROW 22  git not runnable (OSError branch); plant refuses to arm if target absent
  PRE  + git unavailable  exit=0  1 skipped  <- REAL false green, reproduced
  POST + git unavailable  exit=1  1 failed   "...is a broken checkout, not an environment gap"
ROW 23  bad revision -- REAL trigger, not a forced branch: _MODULE_REL_PATH mutated
        so `git show` legitimately exits 128
  PRE  + bad revision     exit=0  1 skipped  <- REAL false green, reproduced
  POST + bad revision     exit=1  1 failed   git's own stderr quoted back, "broken or shallow"
NEW form-[3] IDENTITY GUARD (no PRE arm exists -- the guard is new)
  POST + wrong blob id    exit=1  1 failed   "does not match its recorded identity"
  POST + correct blob     exit=0  1 passed
WHOLE FILE  POST 339 passed  ==  PRE 339 passed   => 0 flips, 0 node changes
```
⚠️ **Exit codes captured DIRECTLY, never through a pipe** (`[ps-counting-encoding]`).
⇒ **BOTH rows `22` and `23` were REAL FALSE-GREEN REMOVALS** — unlike Cluster `D`'s row `19`, which was
already fail-closed. **Cluster `F` accounting: `2` false-green removals `+ 1` new identity guard `+ 1`
latent-defect repair (`§12.2`).**

### 12.2 🛑🛑 A LATENT DEFECT FOUND WHILE BUILDING THE FORM-`[3]` VERIFIER, AND IT IS THE BIGGER FINDING
🛑 **`[MEASURED HERE]` the committed helper ran `subprocess.run(..., text=True)` with NO `encoding=`, so it
decoded each historical revision with the LOCALE codec — `cp1252` on this box — before `exec`ing it.**
```
raw bytes   len=50116  blob id f9a56c7e...  == the pinned object   MATCH
text=True   len=52288  blob id d9eb7c36...  != the pinned object   MISMATCH (+2172 bytes)
```
⇒ **the differential was exec'ing a MIS-DECODED module.** `[MEASURED]` the four revisions carry
`1308`/`1677`/`1814`/`1913` non-ASCII bytes each. **The repair reads BYTES, verifies the blob id, then
decodes UTF-8 explicitly.**
⚖️ **NOT SCOPE CREEP — ENTAILED: form `[3]` requires identity verification, identity is a property of BYTES,
and the old call could not produce bytes.** ★★★★★ **`THE ENCODING BUG WAS INVISIBLE FOR AS LONG AS NOBODY
ASKED THE INPUT TO PROVE ITS IDENTITY — 339 TESTS PASSED OVER A CORRUPTED MODULE BECAUSE NOTHING EVER READ
THE CORRUPTED PART.`** ⚠️ **`[MEASURED]` `339 passed` before and after, so no assertion ever depended on the
mis-decoded bytes. The defect was LATENT, not live.**

### 12.3 ⚖️ A COUNT CORRECTION I OWE THE DESK — AND THE PHANTOM IS MINE
🛑 **`R-820 §4` records *"`test_spec_family_bindings.py` STILL CONTAINS `5` `pytest.skip` CALLS"*.
`[MEASURED HERE at `e60b1909`, the exact commit that ruling measured]` **the executable count is `4`.**
```
UNANCHORED  grep -c 'pytest\.skip'        5
EXECUTABLE  grep -cE '^\s*pytest\.skip\(' 4   <- :47 :910 :1927 :1929
COMMENT                                    1   <- :573
```
⚠️ **AND `:573` IS A COMMENT I ADDED IN CLUSTER `D`** describing the skip I had just deleted. **My own
documentation manufactured a phantom obligation in the desk's next count.** ★★★★★ **`THE CENSUS'S OWN §1
RECORDS FOUR COMMENT-ONLY MATCHES THAT WOULD HAVE INFLATED THE ORIGINAL DENOMINATOR — AND I THEN WROTE A
FIFTH INTO EXISTENCE BY EXPLAINING MYSELF IN A COMMENT.`**
✅ **AFTER `F`, EXECUTABLE `pytest.skip` IN THIS FILE = `2`:** `:47` (row `18`, Cluster `E`, **HELD** by
`R-820 §9[4]`) and `:910` (row `20`, already form `[1]` since `e55a9ef1` — the resource is committed, so the
branch is unreachable dead code). 🛑 **NEITHER IS TOUCHED.**
⚖️ **SCOPE READING I DECLARE RATHER THAN ASSUME: `R-820 §9[8]` says *"do not touch the `5` remaining
`pytest.skip`"* while `§9[1]` orders *"FINISH `F` (rows `22`,`23`)"* — and rows `22`/`23` ARE two of those
five. I read `§9[1]` as controlling, because `§9[8]`'s fence is explicitly `(§4, out of scope)` i.e. out of
CLUSTER `D`'s scope, and the alternative reading makes `§9[1]` unexecutable.** **If the desk meant
otherwise, this is the line to correct.**

### 12.4 ⚠️ WHAT CLUSTER `F` DOES **NOT** ESTABLISH
⚠️ **NO PORTABILITY CLAIM.** `[AR-966 §6]` a linked worktree shares the object store, so **the git-history
axis was never varied by any tree on this box.** The proof is PLANT-based. **A genuinely shallow clone was
NOT tested.**
⚠️ **The pinned blob ids are correct AT THIS PIN.** A history rewrite would break them — **deliberately**:
that is the guard firing, not a defect.
⚠️ **`_load_module_at_ref` writes a synthetic key into `sys.modules` (`:1938`) and pops it only on
exception.** `[MEASURED]` the key is uniquely derived from the ref (`_gitref_spec_family_bindings_*`) so it
shadows no production module. **NAMED, NOT REPAIRED** — it belongs to the `28` `[UNADJUDICATED]`
nominations, which `R-820 §6` will record `CONTAINED_BY_ACCEPT5_PROCESS_BOUNDARY` if ratification passes.

---

## 13. ✅ DISPOSABLE WORKTREE DISPOSITION — RECORDED, THEN REMOVED (`R-820 §7`, `R-821 §7[3]`)

**Order:** record artifact paths + hashes FIRST, then remove. `R-820 §7` reversed `R-819 §8[6]` on the
mechanism that *"a worktree is RECONSTRUCTIBLE from the commit and carries no evidence the commit does not"*
— ★ **so I MEASURED that premise before acting on it rather than taking it on relay.**

| worktree | pin | on origin? | own output artifacts |
|---|---|---|---|
| `wt-accept5-pin-20260811` | `c2193868` | ✅ **ANCESTOR of `origin/h1-wave4-sealed12-driver`** | **NONE** — `git status --porcelain` shows only `docs/wave25-exit-engine-ab-report.md`, which was modified before that worktree existed |
| `wt-r34-clusterD-redproof` | `2d8b1da1` | ✅ **ANCESTOR of `origin`** | **NONE** — working tree completely clean |

⇒ ✅ **THE PREMISE HOLDS BY MEASUREMENT: neither worktree contained a single byte that is not reproducible
from a commit on `origin`.** Both removed.

**GOVERNED-AUTHORITY ARTIFACTS AT `c2193868`, PINNED BY CONTENT HASH so the receipt's inputs stay joinable
after the worktree is gone:**
```
blob 56cbd71ef3a75985409ad0f120bfd3970871b999  298208 B  acceptance-collection-seal-08062e12.json
blob 8b37749f0ecff967929c3212d3c02fe6c0a61368  299504 B  acceptance-disposition-seal-08062e12.json
blob 7d6b66ec0f65702b7e13b1d8758a7f264724a9f3    7555 B  acceptance-population-successor.json
blob b71c164147201f7a42dcd1899402a56ae19a6f32    6302 B  acceptance-baseline-2026-08-09.json
```

### 13.1 🛑 A GAP I FOUND WHILE DISCHARGING THIS, AND IT IS NOT CLOSED BY REMOVING THE WORKTREE
🛑 **`[MEASURED HERE]` the canonical run reported in `AR-974 §4` (`2419/2419/31/0/2`, feeders agree,
`NEW failures 0`, `ACCEPTANCE: REFUSED — SEALED DISPOSITION CHANGED`) wrote its machine-readable outputs to
`acceptance_runner.py --out-dir` (`:536` default `.`, `:612` `run-{run_id}`), and NO `run-*` directory exists
in the pinned worktree.** ⇒ **those JSON / JUnit receipts went to the previous seat's scratchpad and that
seat is GONE.**
⚖️ **CONSEQUENCE, STATED PLAINLY: the receipt survives as NUMBERS IN AN AR, not as a re-checkable artifact.
That is `[RELAYED]` evidence, not `[ARTIFACT-SOURCED]`, and removing the worktree does not cause this — the
worktree never held them.** ★★★★★ **`I WENT TO RECORD THE ARTIFACT HASHES AND DISCOVERED THERE WERE NO
ARTIFACTS TO HASH. THE THING I WAS ORDERED TO PRESERVE HAD ALREADY BEEN LOST BEFORE THE ORDER WAS WRITTEN —
AND THE WORKTREE'S CONTINUED EXISTENCE WAS MAKING IT LOOK OTHERWISE.`**
⚡ **NOT REPAIRED HERE: the next authoritative run belongs AFTER `RATIFY-1` (`R-821 §2`), and `[C]` already
requires unique per-child receipt dirs. ⇒ RECORDED so `RATIFY-1` inherits the requirement that its receipt
dir live INSIDE the repo tree or be hashed into the census at write time, never in a seat-local scratchpad.**

### 13.2 🛑 I CORRECT `§13`'s OWN CLAIM — `git worktree remove` REFUSED AND IT WAS RIGHT
🛑 **`§13` STATED *"neither worktree contained a single byte that is not reproducible from a commit on
`origin`."* THAT IS `[RETRACTED]`.** `git worktree remove` refused `wt-accept5-pin-20260811` — *"contains
modified or untracked files"* — **and the refusal was CORRECT.**
⚠️ **MY ENUMERATION WAS TOO NARROW: I ran `git status --porcelain` (default), read one modified tracked
file, and generalised to "no evidence".** `[MEASURED HERE, `--untracked-files=all` + `--ignored`]`:
```
modified tracked   1     docs/wave25-exit-engine-ab-report.md
untracked          0
IGNORED          344     243 src/engine/__pycache__ · 96 .numba_cache · 5 scripts/__pycache__
```
✅ **THE `344` IGNORED ARE ALL BUILD CACHE — `[MEASURED]` searched for `run-*` / `accept` / `junit` /
`receipt` / `*.xml`: the only hits are `.pyc` files. `§13.1`'s finding STANDS: the canonical run's receipts
were never in this worktree.**
🛑 **BUT THE MODIFIED FILE IS NOT BYTE-IDENTICAL TO THE MAIN WORKTREE'S COPY, SO "REPRODUCIBLE FROM A
COMMIT" WAS FALSE AS WRITTEN:**
```
pin worktree  sha256 27aea7cdbbdd130c2ae6a5686d48d251daf9df2350853ecbc93e4d9712a5bc02
main worktree sha256 0ff352c12fed8d85344edce7dc15c0cbdb2d9fcbbff719bb9fd639b8d087fd4b
ONLY semantic delta:  **Run date:** 2026-08-11 06:04 UTC   (pin)
                      **Run date:** 2026-08-11 06:08 UTC   (main)
remainder: line-ending difference only; every measured value identical
           (P&L 1500.00 · Sharpe 1.20 · MaxDD 800.00 · trades 20 · Overall Gate PASS)
```
⇒ ✅ **PRESERVED BY RECORD, THEN REMOVED.** The pin copy is a generated Wave-25 A/B report belonging to
neither seat, whose sole unique content is the line quoted above; with that line and the main worktree's
copy it is fully reconstructible. **`--force` used ONLY after this record existed.**
★★★★★ **`I WROTE "NOT A SINGLE BYTE" FROM A DEFAULT `git status` THAT HIDES IGNORED FILES, AND THE TOOL I
WAS ABOUT TO OVERRIDE WITH `--force` WAS THE ONLY THING THAT KNEW BETTER. THE REFUSAL WAS THE MEASUREMENT.`**
⚠️ **AND THE GENERAL FORM, WHICH IS THE PART WORTH KEEPING: `A CLEAN `git status` IS NOT AN EMPTY DIRECTORY.
AN ABSENCE CLAIM OVER A WORKING TREE MUST NAME WHICH CLASSES IT ENUMERATED — TRACKED, UNTRACKED, IGNORED.`**


## 14. ✅ THE 32-ROW SIX-FIELD BACKFILL (`AR-1024 §3`) — AND ONE ROW WHOSE RECORDED DISPOSITION IS REFUTED

**Ruling:** GPT `AR-1024 §3` — *"backfill the final six-field disposition / proof-receipt contract for
all 32 rows using durable existing evidence first"*, explicitly **a receipt-backfill lane, not a
re-certification lane**. **Schema:** `R-815 §7`'s adopted six fields (`FIRED_C0` · `FIRED_C1` ·
`AXIS_VARIED` · `ROOT_CAUSE` · `FINAL_DISPOSITION` · `PROOF_RECEIPT`).
**Pin:** `858506cf` (`h1-wave4-sealed12-driver`), the durable map receipt `AR-1024` names.
**Denominator:** `32`, unchanged. **`AR-1024 §4[4]` honoured: a converted row KEEPS its census seat.**

🛑 **FIRST, THE THING THAT INVALIDATES A NAIVE READ OF `§3` AND `§7`: THOSE SECTIONS DESCRIBE THE TREE
AS IT WAS ON 2026-08-11, AND SEVEN CLUSTERS HAVE LANDED SINCE.** `[MEASURED HERE @ 858506cf]`
executable `pytest.skip(` sites across all nine census files — comment lines excluded, because
`§3`'s own laws forbid counting a comment as code:

```
test_accuracy_fixes.py 0 · test_fvg_identity_dispatch.py 0 · test_levelzone_routing.py 0
test_pnl_accuracy.py 0 · test_signal_vector.py 0 · test_spec_family_bindings.py 1
test_static_c_partials_ab.py 0 · test_walk_forward_wrc_spa_emission.py 0
test_wave_b_intrabar_stops.py 1
```
⇒ **`30` of the `32` census sites are GONE at `HEAD`; exactly `2` executable skip sites survive.**
⚠️ **A FIRST COUNT OF MINE READ `1` SURVIVOR IN `test_signal_vector.py` AND IT WAS A COMMENT** —
R-815's own note *describing* the deleted skip, at `:235`. **The count above excludes comment lines;
the naive count does not.** ★★★ **`A GREP THAT MATCHES A COMMENT IS NOT A MEASUREMENT OF CODE.`**

### 14.1 THE BACKFILL — ALL `32` ROWS, GROUPED BY THE EVIDENCE THAT PROVES THEM

**Rows sharing a cluster share one receipt because they share one repair** — the grouping is
`R-814`/`AR-1024 §3[3]`'s root-cause acceptance, not a convenience. **Every row number appears exactly
once; `1+4+7+3+3+1+3+1+2+4+3 = 32`.**

| rows | `FIRED_C0` | `FIRED_C1` | `AXIS_VARIED` | `ROOT_CAUSE` | `FINAL_DISPOSITION` | `PROOF_RECEIPT` |
|---|---|---|---|---|---|---|
| **`1`** | NO | NO | CREDENTIAL varied `C0→C1`, no effect; other 4 **NOT VARIED** (`§6`) | in-repo `FIRM_COMMISSIONS` config table — **never machine-local** | ✅ **SKIP DELETED** — replaced by a hard `assert firm_key in FIRM_COMMISSIONS`; a config regression is now RED | Cluster `G`, commit **`1b6257e4`**; executable lines `:465`–`:473` @ `858506cf` |
| **`2`,`3`,`4`,`5`** | N/A — site already removed at the `C0` arm | N/A | N/A — no skip site remains to axis-test | importability of the in-repo `exits` module | ✅ **SKIP DELETED** — the `try/except` is gone and the import is **unguarded**, so an unimportable module raises `ImportError` | Cluster `A2`, commit **`c6362fc3`** *("convert the four exits-import skips")* — **4 rows, 4 in the subject** |
| **`6`,`7`,`8`,`9`,`10`,`11`,`25`** | NO — each owning test observed `passed` (`§7` witness) | NO | as row `1` | fixture-outcome skips: a form-`[2]` fixture skipping on **its own output** (trade count / signal / golden fixture) | ✅ **SKIP DELETED** — converted to hard failures | Cluster `B`, commit **`936d7741`** *("convert 7 fixture-outcome skips")* — **7 rows, 7 in the subject** |
| **`12`,`14`,`16`** | N/A — site already removed at the `C0` arm | N/A | N/A | importability of the backtester | ✅ **SKIP DELETED** — import unguarded ⇒ hard `ImportError` | Cluster `A1`, commit **`1a639679`** *("convert the three backtester import guards")* — **3 rows, 3 in the subject** |
| **`13`,`15`,`17`** | 🛑 **YES** — all three skipped, chain actively disabled | **NO** — all three passed with credentials injected | 🛑 **CREDENTIAL — VARIED.** The only one of five varied | remote S3 OHLCV read converted to a skip by a `str(e)` substring test | ✅ **`R-799 §5` form `[2]`** — deterministic in-test fixture; broad `except → pytest.skip` **DELETED, not narrowed** | Cluster `A`, **`§10`** + `§10.1` four controls executed, `§10.2` population effect |
| **`18`** | NO | NO | as row `1`; `SAMPLES_DIR` itself **NOT VARIED** (absolute path, `§6`) | `SAMPLES_DIR` — a hardcoded absolute path into another worktree, `141` files, `0` tracked | ✅ **`R-799 §5` form `[1]`** — the **exactly 2** consumed samples vendored beside the test, membership proven **by ablation**; a missing sample is now an ERROR | Cluster `E`, commit **`c187322f`**; fail-closed rationale at `:38`–`:52` @ `858506cf` |
| **`19`,`21`,`24`** | NO | NO | as row `1` | h1-battery fixture · corpus dir · `docs/` corpora | ✅ **`R-799 §5` form `[1]`** — `pytest.skip` **DELETED**, replaced by a hard `assert` | Cluster `D`, commit **`e60b1909`**; **`§11`** + `§11.1` three arms per row, worktree `48a7d0ac` |
| **`20`** | NO | NO | as row `1` | blind-readjudication `LOCKED.json` governed grade | 🛑 **SPLIT — SEE `§14.2`. The INPUT satisfies form `[1]`; the SKIP GUARD SURVIVES.** | input verified `[MEASURED HERE]`; guard at `:928` `[MEASURED HERE]` — **`§14.2`** |
| **`22`,`23`** | NO | NO | as row `1`; GIT HISTORY **NOT VARIED** (shared object store, `§6`) | `git show <ref>:<path>` history dependency | ✅ **`R-799 §5` form `[3]`** — explicitly pinned external input, **identity verified before execution** | Cluster `F`, **`§12`** + `§12.1` planted triggers pre/post, worktree `2d8b1da1` |
| **`26`,`27`,`28`,`29`** | NO — `passed` here ⇒ `wrc.available` was `True` | NO | as row `1` | **SUBJECT SELF-EXCUSE** — the test skips on a value the subject under test computes (`wrc.available`) | ✅ **SKIP DELETED** — converted to hard failures, **convicted by TARGETED MUTATION, not observation** | Cluster `C`, commit **`5b59b3a9`** *("convert 4 wrc/spa environment-skips")* — **4 rows, 4 in the subject** |
| **`30`,`31`,`32`** | NO | NO | as row `1` | backtester import skipped to avoid a vectorbt JIT hang | 🛑 **OUT OF SCOPE — `STOP [11]`, `R-814` forbidden list. NAMED, NOT TOUCHED.** One broadcast site survives at `test_wave_b_intrabar_stops.py:82` `[MEASURED HERE]` | `STOP [11]`; deliberately unconverted, and this backfill does **not** convert it |

✅ **RECONCILIATION, THE ONLY WAY A CLUSTER RECEIPT IS ALLOWED TO CARRY MULTIPLE ROWS:** each cluster's
row count is stated **in its own commit subject** — `A1` three, `A2` four, `B` seven, `C` four — and
each matches the row count assigned here. **A cluster whose subject count disagreed with its row count
would be a join error, and that is exactly the check.**

### 14.2 🛑🛑 ROW `20` — ITS RECORDED DISPOSITION IS REFUTED BY THE TREE, AND I AM NOT SEALING OVER IT

**`§3`'s row `20` reads: *"✅ CLOSED — converted to form `[1]` at `e55a9ef1`, sha `920557eb…`, 978
bytes"*. Two of those three claims verify. The word `converted` does not.**

**WHAT VERIFIES `[MEASURED HERE @ 858506cf]`:**
```
docs/replay-results/blind-readjudication/blind-second-judge-LOCKED.json
  size    978 bytes          <- matches the census exactly
  sha256  920557eb3d32100e…  <- matches the census tail exactly
  git ls-files              -> TRACKED  (= committed governed evidence, form [1])
git cat-file -t e55a9ef1    -> commit,  touching exactly that JSON file
```
⚠️ **`920557eb` IS A CONTENT SHA256, NOT A GIT OBJECT** — `git cat-file -t 920557eb` returns
`fatal: Not a valid object name`. **I checked that before trusting it** (`[external-sha-fabrication]`:
external sha tails have been invented here before). **It is genuine; it is simply a different kind of
hash than the neighbouring `e55a9ef1`.** ★★★ **`TWO HASHES IN ONE SENTENCE NEED NOT BE THE SAME KIND
OF HASH.`**

**WHAT REFUTES IT `[MEASURED HERE @ 858506cf]` — the executable line, not a comment:**
```python
925  def _governed_split() -> dict:
926      path = os.path.join(os.path.dirname(__file__), _GOVERNED_GRADE_FILE)
927      if not os.path.isfile(path):
928          pytest.skip(f"governed grade unavailable at {path}")
```
**The `pytest.skip` is intact and executable.** Its sibling twelve lines below, `_corpus_wait_session_rows`
at `:933`, carries the real Cluster-`D` conversion and cites *"`R-818 §7[3]` Cluster D / `R-799 §5`
form `[1]`"* in its body. **Row `21` was converted. Row `20` was not.**

⇒ **WHAT `e55a9ef1` ACTUALLY DID:** it committed the *evidence file*, which makes the **input** satisfy
form `[1]`. **It never removed the *guard*.** Those are two different repairs and the census recorded
the second one as done on the strength of the first.

**SEVERITY — REACHABLE, NOT THEORETICAL. `[MEASURED HERE]` `_governed_split()` has two live callers,
`:959` and `:995`**, both `S6` coverage assertions — **release-authority tests.** If that JSON ever goes
missing or moves, those two nodes go **SKIP, not RED** — precisely the failure `R-799 §5` was minted to
abolish: *"Missing required evidence ⇒ FAIL/REFUSE. NEVER `SKIP BECAUSE THIS LAPTOP DOES NOT HAVE
IT`."* It does not fire **today** only because the file is tracked.
★★★★★ **`SAFETY BY PRESENCE IS NOT SAFETY BY DESIGN — THIS ROW IS ONE `rm` FROM THE DEFECT THE WHOLE
LANE EXISTS TO ELIMINATE, AND ITS CENSUS SEAT SAYS THE WORK IS DONE.`**

**WHY I STOPPED HERE RATHER THAN REPAIRING IT OR SEALING PAST IT — and I checked all four STOPs first:**
`AR-1024 §4`'s four STOP conditions are `[MEASURED]` **NOT** fired: the row **can** be dispositioned
from durable evidence without guessing (`§14.1` does exactly that); the proof receipt is **present**;
I changed **no** governed production/compiler/trading behaviour; the denominator is **still `32`**.
**So the fast-path was not formally closed to me — I am holding on a different rule.**
`AR-1024 §5` permits **exactly ONE successor disposition seal**, and `§2` says prior receipts stand
*"unless a direct contradiction appears."* **A direct contradiction has appeared.** ⇒ **spending the
one permitted seal on a census whose row `20` is either false-as-written or honest-but-unrepaired is
the one move here that cannot be taken back** (`[irreversible-gap]`: authorize and execute in separate
motions). **The repair itself is out of my lane — `AR-1024 §3` calls this a receipt-backfill lane and
forbids re-certification and skip-site cleanup — so I neither converted it nor sealed over it.**

### 14.3 ⚠️ WHAT THIS BACKFILL DOES **NOT** ESTABLISH

- **It re-verifies no cluster's internal controls.** For `A`/`D`/`F` it **cites** `§10`/`§11`/`§12` per
  `AR-1024 §3[1]`–`[2]`; for `B`/`C`/`E`/`G` it cites the converting commit and the executable line at
  `HEAD`. **It does not re-run those arms**, and `AR-1024 §3[1]` forbids doing so to fill a field.
- **`FIRED_C0`/`FIRED_C1` are inherited from `§7`/`§9`, not re-measured.** No new `C0`/`C1` arm was run.
  For rows whose site was already gone at that arm the honest value is `N/A`, **not `NO`** — a removed
  site cannot be observed not to fire. ★ **`N/A AND NO ARE DIFFERENT ANSWERS AND ONLY ONE OF THEM IS
  AN OBSERVATION.`**
- **`AXIS_VARIED` for the 4 non-credential axes is `NOT VARIED` on this box** (`§6`: a fresh linked
  worktree varies `0/5`). That is a statement about **this box**, not a portability claim.
- **No per-helper execution trace** — `§7`'s `[UNENUMERATED — OPEN]` limit is unchanged by this section.
- **Rows `30`–`32` are named, not measured** beyond the surviving broadcast site's existence.
