# GRADE #2 — S6 EXECUTION ACTIVATION, FINAL SEAL

**Graded tree:** `C:/Users/tonio/Projects/wt-grade-s6-seal-2026-08-10` (isolated worktree, detached)
**Pin:** `4a0a3dcf18461c9fa55fe7ebbf17f886a77b41fb` on `h1-wave4-sealed12-driver`
**Grader:** `accuracy-validator`, independent seat. **Doer ≠ grader.** I did not design, write, or previously grade this change.
**Date:** 2026-08-10

---

> ## `PASS_WITH_BOUNDED_FINDINGS` — **VERIFIED band 9**
>
> **0 CRITICAL · 0 HIGH.** The repaired defect is dead by my own failure injection, not by report.
> The retired `== 7` is confirmed **anti-correlated** with the defect — independently reproduced.
> The §A source-fidelity limb returns a **stated, positive-controlled residual**: taught
> semantics with no consuming executable line, sorted into five disposition classes.

**CLAIMED band:** none. AR-923 §7 explicitly refuses to self-grade (*"`S6` SEAL IS THE DESK'S; THE FINAL GRADE IS OWED AND IS NOT MINE TO DISPATCH"*) `[ARTIFACT-SOURCED]`. Correct posture; nothing to reconcile.

**Why 9, against a pre-registered bar.** The charter §7 fixed the conditions *before* I measured, and my own rubric fixed them before that. Both are met:

| Pre-registered condition | Met? | Witness |
|---|---|---|
| independent re-scan | ✅ | AST + text + dynamic-reach enumeration, each self-tested; ACCEPT-5 re-derived at **both** ends with an emit-blocking extractor check |
| failure injection | ✅ | 3 production mutations (hash-verified restore) + 2 clause-disabling probes; every arm reddened a *named* control |
| zero open HIGHs | ✅ | 0 CRITICAL, 0 HIGH; F-1…F-4 are MEDIUM/LOW/informational, none reachable to capital |
| §A enumeration returning a stated residual **with a positive control** | ✅ | five disposition classes; positive control `opening_range_complete → 1 read`, `source_timezone → 7 reads`; planted-bad RED, clean GREEN |

**I withheld 9 in my first draft and then corrected myself, which is worth recording.** My stated reason was that 3 of 7 acceptance terms lacked an independent witness. I tested that reason instead of asserting it: **8 of the 11 named acceptance suites are inside the 105-member canonical population I executed at both ends**, and I then ran the remaining three (`test_opening_range_definition`, `test_opening_range_lowering`, `test_opening_range_adapter`) directly — **67 passed, exit 0**. The gap I was pricing did not exist. Withholding a band for a deficiency that measurement dissolves would have been a goalpost, not rigour.

**What would have held this at 8** — stated so the band is falsifiable: any NEW failure in ACCEPT-5; any mutation that failed to redden a control (a blind instrument outranks the repair); a causal clause that could not be driven red; or a §A residual reachable to a money decision. None occurred.

**Delta vs grade #1 (band 7).** Grade #1 capped at 7 on one unwitnessed term — `tsc`/TS parity, blocked by absent `node_modules`. That blocker is **dissolved, not worked around**: `[MEASURED HERE]` **zero** TypeScript files changed between `a2527e61` and `4a0a3dcf` (§D3), so term `D` is a re-confirmation of unchanged code rather than evidence about this change. I also added production failure injection and the §A enumeration, neither of which grade #1 performed. **Band 10 remains unreachable by construction.**

**Scope of this band:** commit `4a0a3dcf` · production `src/` byte-identical to repair commit `8f729410` and to seal SHA `08062e12` · the 105-member canonical population · the frozen golden record `st5e-YJRfKc__s0` · 1m bars · fixtures deliberately before the 2026-03-08 US DST transition.

---

## §0 — PIN INTEGRITY (verified before anything else)

| Claim | Result | Evidence |
|---|---|---|
| `08062e12..4a0a3dcf` over `src/ scripts/ tests/ docs/replay-results/` is EMPTY | **CONFIRMED** | `MEASURED HERE` |
| …and the command *can* return rows (negative control) | **CONFIRMED** | `a2527e61..08062e12` same paths → exactly 3 files |
| whole-tree `08062e12..4a0a3dcf` touches only docs | **CONFIRMED** | 3 files, all `docs/designs/*.md` |
| `8f729410..4a0a3dcf -- src/` empty (dispatcher's claim) | **CONFIRMED** | `MEASURED HERE` |

The engineering surface I graded is therefore the seal SHA's surface. `[MEASURED HERE]`

---

## §A — THE SOURCE-FIDELITY LIMB

Executed **first and in isolation**, before opening any AR, ruling, or grade #1.

### A0 — Instruments, and their self-tests

Two non-overlapping instruments, because a name grep is not a closure:

1. **AST attribute scanner** (`ast.Attribute` in `Load` context + `ast.Subscript` string keys) over **647** `.py` files under `src/`.
   **Self-test before emitting** — RED on a planted-bad file reading a sentinel attribute; GREEN on an attribute named nowhere; and the sentinel proven absent from the real tree so the control discriminates. All three passed; the script exits `2` and emits nothing otherwise. `[MEASURED HERE]`
2. **Text sweep** (`git grep`) over the **whole repo** including `*.ts`/`*.tsx`/`*.json`, not just `src/`.
3. **Dynamic-reach sweep** — `getattr` / `asdict` / `vars` / `__dict__` / `dataclasses.fields` over the opening-range modules. The only hit is `getattr(self, handler_name)(b, ctx)` at `spec_condition_compiler.py:1326`, which is **handler dispatch, not a field read**. No `asdict`/`vars` serialisation of any `OpeningRange*` object exists in production. **So the AST absences are not defeated by dynamic access.** `[MEASURED HERE]`

### A1 — The taught population (a committed denominator, not one I invented)

The golden record carries its **own** enumeration in `coverage_notes` — nine taught elements. I used that as the denominator rather than inventing one, then widened from the typed fields.

### A2/A3/A4 — Every taught semantic, and the executable line that reads it

| # | Taught semantic (golden record) | Consuming executable line | Class |
|---|---|---|---|
| 1 | session start `09:30` | `opening_range_adapter.py:145` `definition.session_start_local.partition(":")`; `:232` | **(a) CONSUMED** |
| 2 | zone `Eastern` → `America/New_York` | `opening_range_adapter.py:144` `ZoneInfo(definition.source_timezone)`; `spec_condition_compiler.py:929` | **(a) CONSUMED** ← **POSITIVE CONTROL (A4)** |
| 3 | variants 5m / 15m / 30m | `opening_range_adapter.py:154` `timedelta(minutes=variant.duration_minutes)`; `:286`; `:290`; `opening_range_candidate.py:190` | **(a) CONSUMED** |
| 4 | "recomputed every trading day" | `spec_condition_compiler.py:960-964` (group by `ts.astimezone(zone).date()`), `:999-1004` per-session lock | **(a) CONSUMED — as BEHAVIOUR** (see F-2) |
| 5 | window completeness / lifecycle | `spec_condition_compiler.py:994` `if not state.opening_range_complete` | **(a) CONSUMED (partially — see F-3)** |
| 6 | `market_scope` (equities / stocks / S&P 500) | `opening_range_candidate.py:121` — **hash payload only** | **(b) IDENTITY-ONLY** |
| 7 | `trading_day_rule` (the verbatim sentence) | `opening_range_candidate.py:122` — **hash payload only** | **(b) IDENTITY-ONLY** |
| 8 | provenance / `source_quote` | `opening_range_candidate.py:124-125` — hash payload | **(b) IDENTITY-ONLY, by design** |
| 9 | OR high / OR low (the levels) | **NONE** | **(c) COMPUTED BUT UNREAD** |
| 10 | "range value" = high − low | computed `opening_range_definition.py:223`; **read by NONE** | **(c) COMPUTED BUT UNREAD** |
| 11 | window status FORMING vs INCOMPLETE | **NONE** | **(c) COMPUTED BUT UNREAD** |
| 12 | "half range" = range ÷ 2 | **no production field at all** | **(d) OUTSIDE CURRENT SLICE** |
| 13 | half-range target = OR high + half range | **NONE** | **(d) OUTSIDE CURRENT SLICE** |
| 14 | full-range target | **NONE** | **(d) OUTSIDE CURRENT SLICE** |
| 15 | half-range stop | **NONE** | **(d) OUTSIDE CURRENT SLICE** |
| 16 | breakout entry above/below | **NONE** (deliberately refused at classification, stage 1) | **(d) OUTSIDE CURRENT SLICE** |
| 17 | `selected_duration_minutes` | **NONE — and zero reads is CORRECT** (invariant 2: it raises) | **(e) DELIBERATELY UNAVAILABLE** |

**A4 positive control satisfied:** rows 1–5 are semantics the scanner *does* find with concrete lines, so "no consumer found" in rows 9–16 is distinguishable from "my search does not work." Row 17 is the converse control: an item whose zero-read count is the *correct* answer, proving I judge each residual rather than mechanically failing zeros.

**A5 calibration — did my enumeration rediscover the `trading_day_rule` class?** **Yes, and it also exposed a limit of my own instrument, which I state rather than hide.** My field-read scan finds `trading_day_rule` has **zero executor reads even after the repair** — it reaches only the hash payload. What the repair changed is that the daily-reset *semantic* is now executed via date grouping. So a pure field-read enumeration would have reported "no change" across the repair; it is **blind to whether a semantic is behaviourally honoured**. That is precisely why §B exists and why a source-fidelity limb needs both limbs. My enumeration rediscovers the *class*; only mutation settles the *behaviour*.

### THE MANDATORY SENTENCE

> **Five semantics taught by the golden record are carried through the typed definition, validated, and refused-without — yet are read by no executable line in production: the opening-range HIGH, the opening-range LOW, the derived WIDTH ("the range value"), the window STATUS, and — as a field rather than as behaviour — `trading_day_rule` and `market_scope`, which reach only the cache-identity payload.** Of these, `market_scope`, `trading_day_rule` and `provenance` are **correctly** identity-bearing by design; the level/width/status group is the open residual.

---

## §A FINDINGS

### Finding F-1 — the taught LEVELS are computed and discarded
**Severity:** MEDIUM (residual, not a regression; not reachable to capital)
**Reality:** `compute_opening_range_state` derives `opening_range_high`, `opening_range_low`, `opening_range_width`, `opening_range_midpoint` (`opening_range_definition.py:221-224`), and the **only** production consumer — `_h_opening_range` — reads `opening_range_complete` and nothing else (`spec_condition_compiler.py:994`), then re-derives the lock from `_window_bounds`.
**Sources compared:** AST scan `PRODUCTION READS = 0` for all four | text sweep: hits only in `opening_range_definition.py` (declaration + construction) | dynamic-reach: no `asdict`/`getattr` path.
**Positive control:** the same scan reports `opening_range_complete → 1 production read` at `:994`, and `source_timezone → 7`. The instrument sees reads when reads exist.
**Fix point:** none required inside this slice — the gate condition does not need levels. Owner needed for the consumer that will.
**Blast radius:** none today (`SEAM-COMPLETE, CONSUMER-UNWIRED`). It becomes live the moment a breakout/target/stop condition is compiled.

### Finding F-2 — `trading_day_rule` is honoured as behaviour but never read as a field, and the lowering regex is wider than the executor
**Severity:** LOW/MEDIUM (latent; bounded by an out-of-scope limit)
**Reality:** the executor implements daily reset by grouping on `ts.astimezone(zone).date()` (calendar date in the taught zone). It never consults `candidate.definition.trading_day_rule`. The lowering locator `_TRADING_DAY_RE` (`opening_range_lowering.py:115-119`) accepts `resets? (each|every) (day|session)` — so **"resets every session" lowers to READY**, and the executor would then apply *calendar-date* grouping to a *session*-based rule. For an overnight futures session those are different questions.
**Why this is not a defect today:** the golden record teaches `"relative for every single trading day"`, and calendar-date grouping is the correct execution of that. `[MEASURED HERE]` — the lowered value is the verbatim day sentence.
**Coupling nobody enforces:** the regex's accepted language and the executor's hardcoded grouping must agree, and no check binds them.
**Scope:** overnight-futures trading-day assignment is an explicitly out-of-scope limit (§E), so this is reported as latent, not certified either way.

### Finding F-3 — FORMING and INCOMPLETE_OPENING_WINDOW are indistinguishable at the only consumer
**Severity:** LOW (fail-closed is preserved; observability is nil)
**Reality:** the type goes to deliberate lengths to separate "the teacher never said" from "the data was defective" (`TWO DIFFERENT SILENCES DESERVE TWO DIFFERENT NAMES`), but `:994` collapses both into `continue` by reading only the boolean. A day refused for **missing/duplicated/off-grid observations** is silently identical to a day that simply has not locked yet. Nothing is logged or raised.
**Behaviour is correct and safe** — I verified fail-closed-locally and no neighbour poisoning (§B). This is a diagnostics finding, not a correctness one.

### Finding F-4 — a second opening-range calculator lives inside a `.ts` file (OUT OF LANE, pre-existing)
**Severity:** INFORMATIONAL for this seal; flagged because it is the same family and no S6 grade would otherwise see it.
**Reality:** `src/server/services/bias-state-service.ts:449-495` embeds a **Python heredoc** executed via `runPythonModule` that computes `opening_range_high = max(b["high"] for b in or_bars)` over `intraday_bars[:6]` — a hardcoded "30 min = 6 × 5-min bars". It reads **none** of the taught types, uses `datetime.date.today()` (host-local, not the taught zone), performs no completeness check beyond `len >= 6`, and on any exception falls back to `opening_range_high = opening_range_low = current_price` — a **zero-width range** — under a bare `except Exception: pass`.
**Scope discipline:** not introduced by this change, not part of the S6 slice, does not consume S6 types. Reachability beyond one hop **NOT MEASURED**. I am not certifying or condemning it here; I am recording that it exists so it is not discovered later as a surprise.

---

## §B — I KILLED THE REPAIRED DEFECT MYSELF

Mutation protocol: byte copy/restore with a guaranteed `finally`, **never** `git checkout`. Pristine `spec_condition_compiler.py` sha256 `f22bc8368c7d096b5d4c3734f05ab055da38e3d2893223821914b6ae043a15a0`; **restore verified identical after every arm.** `[MEASURED HERE]`

**Baseline first:** S6 suite **18 collected / 18 executed / 18 passed / 0 skipped / 0 xfailed**, all four multi-day controls confirmed present **by name** in both the `--collect-only` list and the executed list. A green suite that quietly stopped collecting a test is not a green suite.

| Mutation | `resets_every_trading_day` | `computes_its_OWN_range` | `once_per_candidate_PER_SESSION` | `incomplete_without_poisoning` | B6 `once_per_taught_candidate` |
|---|---|---|---|---|---|
| **control** (unmutated) | PASS | PASS | PASS | PASS | PASS |
| **B1** all sessions collapsed onto day 1 (reproduces pre-repair carry-over) | **FAIL** | **FAIL** | **FAIL** | **FAIL** | PASS |
| **B2** per-day adapter call, but lock taken from day 1 | **FAIL** | PASS | PASS | **FAIL** | PASS |
| **B2b** incomplete day fails GLOBALLY instead of locally | PASS | PASS | PASS | **FAIL** | PASS |

**B3 — no blind instrument found.** Every mutation reddened at least one named control, and the reddening is *discriminating*, not blanket.

**B2 is the sharp one and it directly settles B5.** Under B2 the adapter *is* called once per day with that day's own observations — so "the adapter was called twice" is satisfied and the call-membership control stays **green** — while the taught answer is still wrong, and only the day-2 decider catches it. **The suite has depth: the membership control alone would have been fooled.**

**B4 — invariant verified by MEMBERSHIP, on my own fixture.** Independent probe (3 days, not the suite's 2; my own price scheme; 50-minute sessions, not 45): **9 observed `(session_date, duration)` pairs, membership exactly equal to the expected 9, zero duplicates.** `[MEASURED HERE]`

**B5 — two INDEPENDENT daily ranges, not one reused.** Per-day adapter inputs differ by day for every taught window: highs `507.0 / 544.5 / 582.0`, lows `495.0 / 532.5 / 570.0`. `[MEASURED HERE]`

**B6 — `test_the_production_dispatch_path_executes_the_adapter_once_per_taught_candidate` passes UNCHANGED**, in the control and in all three mutant arms. Note it passes even under **B1**, i.e. under the live pre-repair defect — which is not a regression but a demonstration that the older single-session invariant was **under-specified exactly as the repair's docstring claims**. `[MEASURED HERE]`

**Additional live probe results** (my fixture, production chain): gate is False pre-lock and True post-lock **per day** for all three windows; `all_true = False` (no constant-True sink); incomplete middle day → day 2 all-False with **day 3 recovering**; missing candidate raises `FamilyMetaEnforcementError`; `ENFORCED_DISPATCH['opening_range_adapter.compute_opening_range_state'] == '_h_opening_range'` and resolves to the **same method object** as the flag-OFF ladder route; three instances produce three distinct arrays with first-True index exactly `5 / 15 / 30`.

---

## §C — THE ACCEPTANCE APPARATUS

### C1 — ACCEPT-5 re-derived with my own instrument → **NEW = 0, GONE = 2**

🛑 **My first extractor was broken and I threw its result away.** It reported `NEW = 49 / GONE = 31`, while pytest's own summary said **31 failed** — I had parsed **51** IDs. Cause: I passed `-rsxX`, which omits `f`, so **no `FAILED` lines existed** and my fallback regex matched *warnings-summary* lines. Rebuilt with `-rf` and an **emit-blocking self-check** (`refuse to print unless parsed == reported`).

| | Result |
|---|---|
| extractor self-check | pytest reported **31** failed; parsed **31** → **VALIDATED** |
| baseline failures | 33 |
| pin failures | 31 |
| **NEW (forbidden)** | **0** |
| **GONE** | **2** |
| GONE identity | `test_no_production_binding_routes_to_the_opening_range_adapter_yet` · `test_no_typed_opening_range_output_contract_exists_in_production` |
| `GONE == baseline.ordered_6b_reds` (by name) | **True** |

**Path B — git object DB, so GONE cannot be a population artifact:** manifest at pin = **105** members, at baseline SHA `f8273f41` = **103**; `ADDED = 2` (`test_opening_range_execution_fanout.py`, `test_s6_candidate_transport_and_adapter_execution.py`), `REMOVED = 0` → **strict superset**. A member cannot have "gone" by being deleted from the population. Preflight `resolved = 105, missing = 0`. `[MEASURED HERE]`

### C2 — THE TWO-LITERAL TRAP: `:412` NOT touched

**The charter's line numbers are pre-repair.** At the pin the bindable-conditions literal sits at **`:468`**, and the migrated assertion at **`:516`**. The shift is exactly **+56**, matching the 56-line insertion at `196`; `468 − 56 = 412`. ✅
Diff hunk ranges are `195-196`, `425-426`, `429`, `434`, `448-450`, `451` — **none covers old line 412.** The surviving `== 7` at `:468` counts *bindable conditions excluding `OPENING_RANGE_DEFINITION`*, a different population, and its neighbouring three-candidate control (all three taught windows, `len(durations) == 3 and len(set(durations)) == 3`) is intact. `[MEASURED HERE]`

### C3 — the migrated assertion is STRICTLY STRONGER, not merely green

Three clauses replace one count: exact membership `_DEFECTIVE_ROUTE_BARS = (30, 60, 110, 160, 300, 380)`; the named absence `_DAILY_RESET_CARRYOVER_BAR = 230 not in defective_bars`; and the causal rule. **Verified RED under the reintroduced defect:** `got (30, 60, 110, 160, 230, 300, 380), expected (30, 60, 110, 160, 300, 380)`. `[MEASURED HERE]`

### C4 — I RED-PROOFED THE CAUSAL CLAUSE MYSELF, and independently confirmed the masking claim

| Arm | Production | Clauses 1a/1b | Result |
|---|---|---|---|
| control | clean | enabled | **PASS** |
| defect live | carry-over | enabled | **FAIL at clause 1a** (masking confirmed) |
| defect live | carry-over | **disabled** | **FAIL at the CAUSAL clause**, alone |
| **masking control** | **clean** | **disabled** | **PASS** |

The causal clause fired with: `bar 230 fires at 2026-01-06 04:40 EST, BEFORE its own session's 09:35 lock for the taught 5m window.` The final row is the half that matters: with the clause exposed and production clean it **passes**, so it is not merely a clause that always fails. **RED on planted-bad, GREEN on clean — both halves.** `[MEASURED HERE]`

### C5 — the printed lock is genuinely derived

`_assert_every_entry_is_at_or_after_its_own_session_lock` imports the production `_window_bounds` and calls it with the resolved candidate and the entry's own local date; the message interpolates `{lock:%H:%M}`. It printed **09:35** for the **5m** window — i.e. taught `session_start_local` `09:30` + the *explicitly selected* candidate's 5 minutes. Corroborated by my probe, where `_window_bounds` produced first-True indices of exactly `5 / 15 / 30` for the three candidates. Not a hand-typed literal. `[MEASURED HERE]`

### C6 — SKIP MEMBERSHIP (carried from grade #1's F-3)

🛑 **MEASURING ONLY THE PIN WOULD HAVE FABRICATED A REGRESSION. I ran both ends.**

| | failed | skipped | xfailed |
|---|---|---|---|
| baseline JSON, as recorded by the doer | 33 | **3** | 2 |
| **baseline SHA `f8273f41`, re-run by me in a fresh worktree** | **33** | **5** | **2** |
| **pin `4a0a3dcf`, my run** | 31 | **5** | **2** |

`[MEASURED HERE]` **Base and pin both read 5 skipped in the same environment — IDENTICAL.** The recorded `3` was measured where the gating artifact was present. The two extra skips are both `test_spec_family_bindings.py:901`, gated on an **untracked** file (*"governed grade unavailable at …"*), absent from any fresh checkout by construction; the other three are `test_signal_vector.py` S3-data skips. **So the 3 → 5 delta is an environment artifact and the commit is CLEAN on skip membership** — a pin-only comparison would have reported a `PASS → SKIP` regression that does not exist.

Two further confirmations fall out: my baseline re-run reproduced **exactly 33 failures** (parsed 33 == reported 33), matching the baseline JSON's `n_failed`, so **the immutable baseline artifact is real and reproducible**; and the drop to 31 at the pin is accounted for entirely by the 2 named `ordered_6b_reds`.

ACCEPT-5 nevertheless compares failure membership only and remains structurally blind to `PASS → SKIP`. That blindness is grade #1's F-3 and is **still unresolved at this pin** — it happened not to bite here, which is not the same as being fixed.

---

## §D — THE SPECIFIC CLAIMS

### D1 — "`== 7` was ANTI-CORRELATED with the defect" → **CONFIRMED, INDEPENDENTLY**

This is the strongest claim in AR-923 and it survives adversarial re-measurement.

```
[MEASURED HERE] carry-over reintroduced in _h_opening_range:
  defective_bars -> (30, 60, 110, 160, 230, 300, 380)     n = 7   contains 230: True
  WOULD THE RETIRED `assert len(defective_bars) == 7` HAVE PASSED?  True
```

So the retired assertion was **green precisely while the defect was live**, and would have gone **red on the repair** (6 ≠ 7). Its polarity was inverted with respect to the defect that moved it. `A STALE ASSERTION STOPS DETECTING; AN ANTI-CORRELATED ONE DEFENDS THE DEFECT.`

⚖️ **One attribution nuance, stated because it is a real difference between my measurement and the report's prose:** AR-923 §4 labels the 7-member result **MUTATION 2** ("carry a COMPLETE session forward") and reports **MUTATION 1** ("collapse every session onto day 1") as yielding `(30, 60, 110, 160)`. My grouping-collapse mutation — which I *described* as collapsing onto day 1 — reproduced the **7-member** population, i.e. AR-923's MUTATION 2. The two mutations are distinguishable in effect, and the prose labels are easy to swap. **The load-bearing tuple matches exactly**; only the mutation label differs. No factual disagreement.

### D2 — acceptance counts A–G

**All 11 named acceptance suites independently witnessed**, by two routes:

- **8 of 11 sit inside the 105-member canonical population** I executed at **both** the baseline SHA and the pin — `test_opening_range_conformance`, `test_opening_range_family_parity`, `test_flag_off_parameterized_refusal`, `test_parameter_acceptance_guard`, `test_trigger_safety_refusal`, `test_spec_producer`, `test_opening_range_execution_fanout`, `test_s6_candidate_transport_and_adapter_execution`. `NEW = 0` across the whole population. `[MEASURED HERE]`
- **the 3 outside it I ran directly** — `test_opening_range_definition`, `test_opening_range_lowering`, `test_opening_range_adapter` → **67 passed, exit 0**. `[MEASURED HERE]`
- plus the **S6 suite** standalone (18 collected / 18 executed / 18 passed, collection asserted) and the **trigger-safety** `six_step` node under a control arm and 4 injected arms.

What I did **not** reproduce is the per-term *arithmetic* as named groupings (25 / 54 / 136 / 57 / 47 / 31); I witnessed the substance rather than re-deriving the doer's bucket boundaries. Term **D** is addressed by D3 below.

### D3 — the `tsc` substitute → **CONFIRMED**

🛑 **My first control here was broken and I caught it.** `git ls-tree -r --name-only 4a0a3dcf -- '*.ts'` returned **0** — on a tree containing **1,566** `.ts`/`.tsx` files. `ls-tree` matches pathspecs against the path prefix, so a bare `*.ext` glob silently matches nothing and **reads exactly like a clean absence**. Rebuilt:

- positive control: `git diff --name-only a2527e61 08062e12 -- '*.py'` → the expected **3** files, so `git diff` pathspec is sound;
- re-measured without pathspec: `git diff --name-only a2527e61 4a0a3dcf | grep -c '\.tsx\?$'` → **0**;
- full changed-file list `a2527e61..4a0a3dcf` → **6 docs + 3 Python files, zero TypeScript.**

**Term `D` is therefore a re-confirmation of unchanged code, not evidence about this change.**

### D4 — test-replica hunt → **REFUTED, by mutation rather than by reading**

All **9** `monkeypatch.setattr` sites in the S6 suite are **delegating spies**: each captures `real = compute_opening_range_state` and ends `return real(...)`. Neither suite reimplements `_h_opening_range`, `compute_opening_range_state`, or `_window_bounds`. The two decider tests (`:1356`, `:1504`) patch **nothing at all**. Decisively: **breaking production reddened them** (§B) — a replica cannot be reddened by mutating the thing it replaced.

---

## §E — WHAT I DO NOT CERTIFY (silence here would read as clearance)

1. **DST crossing · exchange holidays · half-days · overnight-futures trading-day assignment · session transfer · non-minute bars.** All six **OUT OF SCOPE and UNMEASURED.** Fixtures sit deliberately before the 2026-03-08 US DST transition. F-2 is latent in exactly this region.
2. **Money-path reachability.** `SEAM-COMPLETE, CONSUMER-UNWIRED`; `build_execution_instances` has no non-test production caller. Separate question (`MP-1`), **not certified here**.
3. **Wording limit:** this seal certifies **compilation fidelity to what the source taught**. It does **not** assert the teacher demonstrated results on MES/MNQ. (Source-market transfer validity is **not** a residual — `R-653 · 2026-08-03` cleared it on this exact slice and `AR-701` withdrew it. Not reported as a finding.)
4. **No renames found**, and none made. The two `6B` node IDs remain intact as ACCEPT-5 join keys; `test_six_step_mutation_sequence` not renamed. `[MEASURED HERE]`
5. I did **not** write to the campaign worktree. All mutation work happened in my isolated tree, restored by hash.

---

## §F — CHARTER REVIEW: does it have a hole?

**It is the right charter — its §A limb is what found everything above.** Three defects, all minor:

1. **Its line references are pre-repair and it does not say so.** `:412`, `:448`, `~:685` are `a2527e61` numbers; at the pin they are `:468`, `:516`, `:732`. C2 as literally written ("contains TWO `== 7` assertions … the migrated `:448`") is **false at the pin**: the file contains **one** live `== 7` plus three textual mentions in prose. A grader who trusted the numbers would have measured the wrong lines. `A CAPTION IS A CLAIM.`
2. **It asks for a residual but supplies no disposition vocabulary.** "Any taught semantic with no consuming executable line is a FINDING at the same class" would, read literally, force me to fail deliberate designs — `selected_duration_minutes` has zero readers *by construction*, and `provenance` is identity-bearing on purpose. Every ordered taxonomy owes a residual category **and** an "expected zero" category; I added classes (a)–(e) to avoid manufacturing findings.
3. **§A tells me to enumerate consumers but not to check the enumeration against behaviour.** A field-read scan alone would have called the repair a no-op for `trading_day_rule` (A5). The charter should pair the enumeration limb with the mutation limb explicitly, or the next grader may report "no consumer" where the semantic is honoured structurally.

---

## §G — AGREEMENT WITH GRADE #1 (read only after §A and §B were complete)

**The charter's founding premise is verified by my own measurement:** `grep -cin "daily.reset|trading_day_rule|multi-day|session_date|cross-day"` across all 365 lines of `GRADE-S6-ACTIVATION-2026-08-10.md` → **0**. Grade #1 was rigorous — its coverage and positive-control tables are strong, and it correctly scoped its band and named what it did not verify. Its silence on this defect was a **charter gap, not negligence**.

| Grade #1 claim | My finding |
|---|---|
| ACCEPT-5 NEW=0 / GONE=2 by name | **AGREE** — re-derived with my own validated instrument |
| band 7, capped by unwitnessed `tsc` term | **AGREE it was right then; superseded** — D3 dissolves the term |
| F-3 skip blindness (`PASS → SKIP` invisible) | **AGREE and CARRIED** — 3→5 at the pin, untracked gating artifact |
| F-2 retired 6B names now assert the opposite of reality | **AGREE** — and confirmed they must **not** be renamed (join keys) |
| no default / no `candidates[0]` / no runtime selection | **AGREE** — re-verified statically and by live probe |

---

## §H — MANDATORY CLOSING COVERAGE

### 1. What I verified, and via which two-plus non-overlapping paths

| Claim | Path A | Path B | Path C |
|---|---|---|---|
| taught-semantic consumers | AST attribute scan (self-tested) | whole-repo text sweep incl. `.ts` | dynamic-reach sweep (`getattr`/`asdict`/`vars`) |
| daily reset is executed | 3 production mutations, restore hash-verified | my own 3-day probe, different fixture scheme | suite's 4 named controls |
| one call per `(candidate, session_date)` | membership over 9 pairs (my probe) | per-day adapter **input** divergence | suite's own pair-membership assertion |
| ACCEPT-5 | my pytest re-derivation, extractor self-checked | git object-DB manifest superset (105 ⊇ 103, 0 removed) | baseline JSON's own `ordered_6b_reds` matched by name |
| skip membership (C6) | pin run in my worktree (5 skipped) | **baseline SHA `f8273f41` re-run in a second worktree (5 skipped)** | baseline JSON's recorded 3 — shown to be the environment-dependent one |
| baseline artifact is real | my re-run reproduced **33** failures at `f8273f41` | parsed 33 == pytest-reported 33 | matches baseline JSON `n_failed: 33` |
| `== 7` anti-correlation | my carry-over mutation → 7-member tuple | clause-by-clause red-proof | AR-923's independently reported identical tuple |
| `:412` untouched | diff hunk-range enumeration | +56 line-shift arithmetic | content read at `:468` |
| zero TS changed | `git diff` pathspec (positive-controlled) | full changed-file list, no pathspec | tree-wide `.ts` count (1,566) proving the surface is non-empty |
| pin integrity | `08062e12..4a0a3dcf` empty over engineering paths | negative control returns 3 files | whole-tree diff = 3 docs |

### 2. Positive-control witnesses for every absence claim

| Absence claimed | Positive control | Result |
|---|---|---|
| no production reader of the four level fields | same scan on `opening_range_complete` / `source_timezone` | finds `1` and `7` reads — instrument sees reads |
| AST scanner finds nothing hidden | planted-bad file reading a sentinel attribute | **RED** (detected); GREEN on absent attr; sentinel absent from real tree |
| no dynamic field access | `getattr`/`asdict`/`vars`/`fields` sweep | finds the real `getattr` dispatch at `:1326` — method is not blind |
| zero TypeScript changed | `git diff -- '*.py'` returns the 3 expected files | pathspec works; and tree holds 1,566 `.ts` so the surface is real |
| no structure-engine fallback | grep finds the docstring mentions | method sees the string; no import/call exists in the closure |
| causal clause is not vacuous | clean production with clause exposed | **PASS** — clause can be green, so its red is meaningful |
| mutations actually bit | unmutated control arm | 5/5 PASS before every mutation |
| ACCEPT-5 extractor | parsed count vs pytest's reported total | 31 == 31 (the first attempt failed this and was discarded) |

### 3. Join keys named for every "identical / unchanged / matches" claim

- **ACCEPT-5 GONE ↔ baseline:** pytest **node ID**, matched against `ordered_6b_reds` — set equality `True`, not counts.
- **`:412` unchanged:** old-file **line number** vs hunk ranges, plus the +56 shift, plus content.
- **pin ↔ seal SHA:** **path set** over `src/ scripts/ tests/ docs/replay-results/`.
- **manifest superset:** **member path strings**, comments/blanks stripped (105 vs 103).
- **mutation restore:** **sha256** of the file, identical before and after every arm.
- **B6 unchanged:** test **node ID**, green in control and all three mutant arms.

### 4. WHAT I DID NOT VERIFY

1. **`tsc` / TypeScript parity was not executed** — `node_modules` absent from a fresh worktree. Mitigated, not replaced, by D3's zero-TS-changed proof.
2. **The per-term acceptance ARITHMETIC (25 / 54 / 136 / 57 / 47 / 31) was not re-derived** as named buckets. All 11 constituent suites were executed (8 inside the ACCEPT-5 population at both ends, 3 directly), so the substance is witnessed; the doer's grouping boundaries are not.
3. ~~The baseline-SHA skip re-run~~ — **LANDED and is recorded in §C6 as `MEASURED HERE`.** Base and pin both read 5 skipped; the baseline's 33 failures reproduced exactly. No longer an open gap.
4. **DST, exchange holidays, half-days, overnight-futures trading-day assignment, session transfer, non-minute bars** — all unmeasured by construction.
5. **Money-path reachability / `MP-1`** — out of scope.
6. **F-4's reachability** (`bias-state-service.ts` embedded calculator) — measured to exist and read; **not** traced to a trade decision.
7. **Multi-strategy / multi-candidate concurrency** — every probe ran one candidate per instance.
8. **Non-golden records** — only `st5e-YJRfKc__s0` and the refusing neighbour were exercised.
9. **I did not re-verify grade #1's F-1 (line-ending caption) or its byte-identity claims**; carried as `RELAYED`.

### 5. Instrument failures in MY OWN work, disclosed

Two of my instruments produced false results and were caught by internal cross-checks before publication:
- `git ls-tree -- '*.ts'` returned 0 on a tree of 1,566 `.ts` files (a **third** git-pathspec false-absence mode).
- My first ACCEPT-5 extractor reported 51 failures against pytest's own 31, because `-rsxX` omits `f`.
Both conclusions survived on rebuilt instruments. Neither would have been caught by a grader who trusted its own tooling — which is the general lesson: **the surface-counter is an instrument and owes its own control.**

---

## VERDICT ROW

| System | Band | Status | Evidence | Open risks |
|---|---|---|---|---|
| S6 EXECUTION ACTIVATION — `DAILY-RESET-1` seal @ `4a0a3dcf` | **9** | **VERIFIED** | independent AST+text+dynamic enumeration with self-tested controls · 3 production mutations with hash-verified restore, each reddening a named control · own 3-day live probe (pair membership + per-day input divergence) · ACCEPT-5 re-derived at **both** ends with an emit-blocking extractor self-check · causal clause red-proofed on both halves · all 11 acceptance suites executed | F-1 taught levels computed but unread · F-2 `trading_day_rule` honoured as behaviour, not read as a field; lowering regex wider than the executor · F-3 FORMING/INCOMPLETE collapse · F-4 out-of-lane second calculator in `bias-state-service.ts` · ACCEPT-5 structurally blind to `PASS→SKIP` (grade #1 F-3, unresolved — did not bite here) · six named scope limits unmeasured by construction · money path out of scope (`MP-1`) |
