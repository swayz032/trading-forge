# GRADE — F-4 SOURCE TRADE POPULATION — 2026-08-12

**Mandate:** DISPROVE. Independent grader; doer may not certify its own repair.
**Verdict:** claim **PARTIALLY CONFIRMED**. The trade-population mechanism and the per-trade
source identity are CONFIRMED through paths that do not reuse the doer's instrument. The word
**"disclosed"** in the claim is **REFUTED**, and the counts the claim calls "counted" are **plan
counts that nothing reconciles against execution** — I built a witness where the disclosure line
asserts a population that did not execute.

---

## PINS ACTUALLY MEASURED — AND THE HEAD MOVED MID-GRADE

| Item | Value | How established |
|---|---|---|
| Tree | `C:\Users\tonio\Projects\wt-h1-wave4-20260712` | `git rev-parse --git-common-dir` → `C:/Users/tonio/Projects/trading-forge/trading-forge/.git` (linked worktree, NOT a standalone repo — law 10) |
| Branch | `h1-wave4-sealed12-driver` | `git rev-parse --abbrev-ref HEAD` |
| **Pin measured** | **`45e4ca840c45762b68569d31c4b246352377b21e`** | `git rev-parse HEAD` at grade start |
| Baseline pin | `66c9a4762832d18c48b6e30fd5b81e76b03ecec4` | worktree `C:\Users\tonio\Projects\wt-grade-f4`, `git rev-parse HEAD` verified inside that tree |
| Head at grade end | `055f7c698c33161c7bcb7da8dcc538041b965ca4` | `git rev-parse HEAD` re-run before writing |

🛑 **THE HEAD MOVED UNDER ME MID-GRADE** (`45e4ca84` → `02ea6462` → `055f7c69`). I re-derived
rather than assumed: `git diff --stat 45e4ca84 HEAD -- src/` is **EMPTY**, and
`git status --porcelain -- src/` is **EMPTY**. The two new commits touch only
`docs/designs/AR-1094-WORKER-F4-TRADE-POPULATION-2026-08-12.md` and
`docs/designs/SYSTEM-INVENTORY.md`. `[MEASURED HERE]` **Every measurement below therefore
describes the graded surface at `45e4ca84`, unchanged at `055f7c69`.** Had the diff been
non-empty this grade would have been void, not adjusted.

---

## GRADE TABLE

| System | Band | Status | Evidence | Open risks |
|---|---|---|---|---|
| F-4 source trade population (`_apply_source_faithful_occupancy` + `_resolve_source_managed_exit`, SOURCE_FAITHFUL Band C single-run) | **6** | **VERIFIED** (independent; I neither designed nor built this and have no prior grade in its lineage) | Two non-overlapping paths per claim, §Coverage | F-1 (HIGH), F-2 (HIGH, novel), F-3 (MEDIUM, novel), F-4 (MEDIUM), F-5 (MEDIUM), F-6 (LOW), F-7 (LOW/HYPOTHESIS) |

**Why 6 and not 7.** Band 7 requires *adversarially tested with residual risks documented*. The
adversarial testing is genuinely there — the P5 ablation is a real red-proof and I could not
break the core arithmetic on fixtures I built myself. But the **disclosure limb has a live
false-green route (F-2) that the repair's own primary evidence anchor cannot detect**, the
metadata never crosses the artifact boundary (F-1), and the repair introduced an unpinned
open-record contamination of the trade population (F-3) that no test holds. Those are residual
risks that are *not* documented. Band 6 is scoped to: this worktree, this pin, the Band C
single-run route, the sVkm vertical fixture family + my own four fixtures, vectorbt 1.0.0.

⚠️ **The claimed band was not stated numerically, so no >1-band reconciliation is owed.** The
claim's own prose ("F-4 is repaired… N executed trades… explicit, counted, disclosed policy")
reads as a band-7/8 assertion; my band is 6 and the gap is entirely in the last clause.

---

## FINDINGS, SEVERITY-RANKED

### Discrepancy F-2: `trades_opened` is a PLAN count and nothing reconciles it against execution — **THIS IS THE NOVEL ATTACK**
**Severity:** CRITICAL-class route, graded **HIGH** (false positive / silent disagreement)
**Claim:** `"[Source occupancy] events=3 trades_opened=3 overlap_suppressed=0 …"` — the line the
repair uses as its disclosure, and the string P2/P4 assert against.
**Reality:** `trades_opened` counts entries the pass *planned*. It is incremented before
`vbt.Portfolio.from_signals` has run and is never compared to `pf.trades.count()`. When
vectorbt declines to open a planned entry, the line reports a population that did not exist.

**Sources compared:**
- source A (the occupancy disclosure line, engine's own): `events=3 trades_opened=3 overlap_suppressed=0 same_bar_conflicts=0 unresolved_open=0`
- source B (the returned envelope, independent of the print): `total_trades=2`, `trades` = entries at bars **41 and 74 only**
- source C (my own bar table): the bar-8 event is real and was planned; it simply never executed

**Source of truth:** source B. The executed population is 2; the disclosure says 3.

**Repro** (`45e4ca84`, from the worktree root):
```python
# scratchpad/e2e4.py — force the sizer to hand vectorbt a 0 at the FIRST planned entry bar
_cps = bt.compute_position_sizes
def zeroed(df_, *a, **k):
    s, o = _cps(df_, *a, **k); s = np.array(s, float).copy(); s[8] = 0.0; return s, o
run("SIZE-0 at the first planned entry bar",
    extra=patch.object(bt, "compute_position_sizes", zeroed))
```
`[MEASURED HERE]` output:
```
### BASELINE 3 sessions
  occ: events=3 trades_opened=3 overlap_suppressed=0 ... unresolved_open=0
  trades: [(8,'source_fixed_r_target',1.0), (41,...,15.0), (74,...,15.0)]   total_trades: 3
### SIZE-0 at the first planned entry bar
  occ: events=3 trades_opened=3 overlap_suppressed=0 ... unresolved_open=0   <-- UNCHANGED
  trades: [(41,...,15.0), (74,...,15.0)]                                     total_trades: 2
```
No counter moved. No exception. No `guards_failed`. The two arms are **indistinguishable by the
disclosure line**, which is the only thing the repair emits.

**Fix point:** `src/engine/backtester.py` — the occupancy block ends at line 8075; there is no
reconciliation between `_cls_source_occupancy_meta["source_trades_opened"]` and
`total_trades = int(pf.trades.count())` computed at line 8103. One assertion at that join closes
it. `src/engine/backtester.py:8103` is where both numbers are simultaneously in scope.

**Blast radius:** every consumer of the disclosure — the P2/P4/P6 assertions in
`test_source_trade_population.py` and `test_the_occupancy_pass_DISCLOSES_its_policy_and_counts`
in `test_source_band_c_vertical.py` all string-match this line, so **the repair's own test suite
green is compatible with a population that did not execute**. Downstream, any expectancy /
win-rate / Sharpe claim read off a run whose disclosure says N and whose records hold N−1.

**Reachability caveat, stated honestly.** `[HYPOTHESIS]` I have **not** proven that
`compute_position_sizes` (`src/engine/sizing.py:946`) can emit `0.0` on production data;
`run_class_backtest:7544` maps only non-finite sizes to 1.0, so a genuine `0.0` would survive.
**The finding does not depend on that.** Size-0 is one *mechanism*; the *defect* is structural —
a plan count published as an execution count with no reconciliation. Any future divergence
(a pre-existing exit in `exit_long`, a vectorbt version change, a new suppressor between the two
lines) lands in the same blind spot. `★ AN UNRECONCILED PLAN COUNT IS A CLAIM ABOUT THE FUTURE.`

---

### Discrepancy F-1: "disclosed" is stderr-only — the metadata never reaches the artifact
**Severity:** HIGH (the claim's own word fails at the boundary that matters)
**Claim:** *"Overlapping events while a source trade is open are rejected under an explicit,
counted, **disclosed** policy."*
**Reality:** `[MEASURED HERE]` `_cls_source_occupancy_meta` is assigned at
`backtester.py:8045`, populated at `:8050`, interpolated into a `print(..., file=sys.stderr)` at
`:8066-8075`, **and never read again.** A repo-wide sweep for every key it carries
(`source_trades_opened`, `source_overlap_suppressed`, `source_overlap_suppressed_bars`,
`source_trade_plan`, `overlap_policy`, `source_same_bar_conflicts`, `source_unresolved_open`,
`source_occupancy`) over `*.py *.ts *.tsx *.json *.md` returns **zero consumers** outside
`backtester.py` itself and the two test files that monkeypatch the function.

**Sources compared:**
- source A (docstring): *"the rejection is written into the array and **reported in metadata**, so the suppression is a stated policy"*
- source B (the returned envelope, read by key): full top-level key list contains
  `dsl_guards`, `signal_diagnostics`, `source_risk_mode` — and **no occupancy key at all**.
  `[key in result if 'occup' in key or 'overlap' in key]` → `[]`.
- source C (the sibling's convention): `_cls_dsl_guards_meta` — including
  `source_faithful_bypassed`, added for exactly this disclosure purpose — **is** surfaced under
  `result["dsl_guards"]`.

**Source of truth:** source B. Source C proves this is a **parity gap with the engine's own
convention**, not an accepted design.

**Repro:**
```
PYTHONIOENCODING=utf-8 PYTHONPATH=. python scratchpad/e2e2.py
  result keys containing 'occup'/'overlap'/'source': ['source_risk_mode']
  dsl_guards keys: [... 'source_faithful_bypassed']
```

**Fix point:** `src/engine/backtester.py` — the result dict assembly (around `:8867`, where
`run_receipt`/`dsl_guards` are placed); `_cls_source_occupancy_meta` is in scope and unused.

**Blast radius:** the TS `backtest-service` audit path, the promotion layer, and any persisted
receipt. A run in which the engine deliberately refused source events is byte-identical, in the
artifact, to a run in which none arrived. `A POLICY THAT ONLY EXISTS ON STDERR IS NOT DISCLOSED
— IT IS LOGGED.` And per this desk's own law: **a check whose only guard is a `print` is the
shape that has burned us before.**

---

### Discrepancy F-3: the repair silently admits an UNRESOLVED, OPEN position into the trade population
**Severity:** MEDIUM (novel; repair-introduced; unpinned)
**Claim:** *"N separated source events produce N **executed** trades."*
**Reality:** one of those N can be a position that never resolved and was never executed to a
source-owned exit.

`[MEASURED HERE]` fixture: three sessions, the LAST flattened after its decision bar so neither
the taught stop nor the 2R target is reached before the frame ends.
```
occ: events=3 trades_opened=3 ... unresolved_open=1
 entry=8  exitIdx=11 px=119.0->134.0 risk=7.5 reason=source_fixed_r_target size=1.0  status=Closed
 entry=41 exitIdx=44 px=119.0->134.0 risk=7.5 reason=source_fixed_r_target size=15.0 status=Closed
 entry=74 exitIdx=98 px=119.0->119.0 risk=7.5 reason=signal                size=15.0 status=Open
```
The third record carries **`exit_reason="signal"`**, **`Avg Exit Price` = the last bar's close**
(a mark-to-market, not a source exit), and **`Status="Open"`** — and it counts toward
`total_trades`, `win_rate`, `profit_factor` and every derived metric.

**Why this is new.** Pre-repair only the FIRST event ever became a trade, so an unresolved tail
could appear at most as the single record. Post-repair the population systematically ends with
an open MTM record whenever the last source trade has not resolved by the frame edge.

**Source of truth:** the returned records. The docstring *does* state the policy
("A trade that reaches NEITHER level writes NO exit… as today") — but **it states it as an exit
convention, not as a population-and-metric consequence**, and:
- no test in `test_source_trade_population.py` or `test_source_band_c_vertical.py` exercises it
  (I checked: `unresolved_open` never appears in an assertion; the doer's own "never resolves"
  fixture was renamed after it was measured to resolve);
- `unresolved_open=1` is visible only on stderr (see F-1);
- MTM-vs-realized confusion in a trade population is a standing conviction class on this desk.

**Fix point:** either exclude `Status=="Open"` records from the metric population, or surface
`source_unresolved_open` in the envelope and pin the behaviour with a test. Decision is the
doer's; the silence is the finding.

**Repro:** `scratchpad/e2e2.py`, case `C5/D2 unresolved LAST session`.

---

### Discrepancy F-4: the `vectorbt drop: N%` diagnostic now conflates POLICY with COLLAPSE
**Severity:** MEDIUM
**Claim:** `test_every_source_signal_now_becomes_a_trade_F4_CLOSED` asserts
`"vectorbt drop: 0%"` and calls it *"a positive witness that the same instrument is still
measuring the same quantity."*
**Reality:** `[MEASURED HERE]` on my fixture D4 (varied wicks, one genuine overlap) the same
instrument prints **`vectorbt drop: 25%`** while `overlap_suppressed=1` and **zero** events were
swallowed by vectorbt. The quantity the line measures changed meaning at this commit: it now
reads non-zero for *correct, intended, policy-driven* rejection.

**Source of truth:** the occupancy metadata (`overlap_suppressed=1, trades_opened=3`) against
`raw=4`. `4 → 3` is the policy working, not the defect returning.

**Blast radius:** the `0%` assertion is a **fixture-specific** witness. Any future fixture or
production frame containing an overlap makes the F-4-closure test's own positive witness read
like a regression. The next reader will either weaken the assertion or chase a phantom.

**Fix point:** `src/engine/backtester.py:8107-8110` — subtract the disclosed
`source_overlap_suppressed` from the drop denominator on the source arm, or emit a separate
source-arm drop line. Fix at the emitter, not in the test.

---

### Discrepancy F-5: the canonical regression population's own manifest gate is RED at BOTH pins, and the population EXCLUDES every source-faithful test file
**Severity:** MEDIUM (instrument hygiene on the doer's own control)
**Claim (attack surface 8):** *"32 failed / 2387 passed / 2 xfailed at BOTH, member-list diff
EMPTY in BOTH directions."*
**Reality:** `[MEASURED HERE — my own runs, both pins]` **the count claim REPRODUCES exactly.**
- repair pin `45e4ca84`: `32 failed, 2387 passed, 2 xfailed in 131.57s`
- baseline pin `66c9a476` (separate worktree `wt-grade-f4`): `32 failed, 2387 passed, 2 xfailed in 145.43s`
- `diff` of the sorted `FAILED` node-id lists: **IDENTICAL FAILED SETS**, both directions.

**But** one of those 32 is
`test_flag_off_parameterized_refusal.py::test_the_canonical_population_matches_its_committed_manifest_by_member`,
and its CONTENT moved across the pins:

| | committed | derived | derivation-only members |
|---|---|---|---|
| baseline `66c9a476` | 107 | **113** | 6 files |
| repair `45e4ca84` | 107 | **114** | those 6 **+ `engine/tests/test_source_trade_population.py`** |

`[MEASURED HERE]` the six are `test_mp1_backtester_ingress`, `test_producer_staging_vocabulary`,
`test_source_band_c_vertical`, `test_source_faithful_execution_mode`,
`test_source_faithful_fvg_routing`, `test_source_vertical_join`.

Three consequences the claim does not carry:
1. **The committed manifest is stale and its freshness gate is RED**; the doer's change made the
   drift worse by exactly one member (their own new file) and did not regenerate it.
2. **The 107-member population structurally contains no source-faithful test file.** That is
   fine — arguably ideal — *as a legacy/overlay control*, which is what P6 cites it for. It must
   never be read as coverage of the source arm.
3. **The A/B join key is the pytest NODE ID.** A test whose *message* changed while its
   pass/fail state did not is invisible to it — and this manifest test is a live example of
   exactly that. `★ THE JOIN KEY IS THE CLAIM.`

**Repro:** `pytest @scratchpad/pop.txt -q -p no:randomly --tb=no -rf` in each tree;
`pytest src/engine/tests/test_flag_off_parameterized_refusal.py::test_the_canonical_population_matches_its_committed_manifest_by_member -q`.

---

### Discrepancy F-6: the "framework-owned, never set" precondition on `exit_long` is not enforced at the boundary that depends on it
**Severity:** LOW
`_apply_source_faithful_occupancy` copies `exit_long`/`exit_short` and **only ever adds** — it
never zeroes them and never asserts they are empty. Its whole occupancy model
(`occupied_until = planned exit_idx`) is only correct if vectorbt has no *other* reason to close
the position. `[ARTIFACT-SOURCED]` the precondition does hold today: `spec_condition_compiler.py:2472-2473`
sets `exit_long = np.zeros(n, bool)  # framework-owned — NEVER set here` (and the same for
`exit_short`), and my runs confirm `signal_diagnostics.exit_long_count == 0`.
**The gap is that the guarantee lives in the producer and the dependency lives in the consumer,**
with nothing joining them. If a source-family strategy ever emits an exit, the pass would
over-suppress later events (`occupied_until` too long) *and* the management pass's
`scan_bound = original_exit_idx + 1` would truncate below the level, silently downgrading the
exit to `"signal"`. One `assert not exit_long.any()` under `_source_faithful` closes it.

---

### Discrepancy F-7: the short branch is symmetric, live, and its correctness is inherited, not proven
**Severity:** LOW · **evidence grade: HYPOTHESIS, deliberately not upgraded**
`[MEASURED HERE — read the executable lines]` `_apply_source_faithful_occupancy` handles shorts
fully symmetrically and calls `_resolve_source_managed_exit(is_short=True)`, which resolves the
stop from `structural_stop_map["short"]`. `[ARTIFACT-SOURCED]`
`context/source_entry_events.py:277` **REFUSES** short stop authority with a `ValueError`;
`spec_condition_compiler.py:2094-2098` **CATCHES** it and records `refused`;
`_build_source_stop_map` (`backtester.py:3369-3371`) sends a refused record to `audit` with
`disposition="REFUSED"` and `continue`s — so `stop_map["short"]` stays empty for it.
The behavioural question I could **not** settle inside budget: whether a refused short still sets
`entry_short[i] = True`. If it does, the occupancy pass now resolves **every** accepted short
event (pre-repair only the one vectorbt happened to open), each raising
`"source_faithful stop resolution found no structural distance for entry_idx=…"` from a block
the doer deliberately placed **outside** the guard `try/except` — converting a previously
silently-dropped event into a hard run failure whose message names a *missing anchor* rather
than a *refused short*. This is listed under §Coverage as NOT VERIFIED.

---

### LOW — two assertions did lose a little discriminating power (answer to the doer's Q3)
`[MEASURED HERE — `git diff 66c9a476 45e4ca84 -- src/engine/tests/test_source_band_c_vertical.py`]`
I checked all six edits the doer named. **Five are strengthenings or meaning-preserving
renumberings.** Two carry a small, real loss, both LOW:
1. **Discriminator 14** — the old single-trade block asserted
   `t["entry_idx"] == 8 and t["Avg Entry Price"] == ENTRY_PRICE`. The new loop asserts
   `Avg Entry Price` for all three but pins `entry_idx` only via `trades[0]["entry_idx"] == 8`.
   Trades 2 and 3 now have **no entry-bar pin**. Net: strengthened 3× on the stop/exit rule,
   weakened 1 pin on entry-bar identity for two of three records.
2. **`TestTheHousePolicyCannotReachTheSourceTrade`** — `assert t["Size"] == 1.0` ("the position
   was reduced — a partial reached the source arm") still runs on `trades[0]` only, so it now
   covers **1 of 3** records. It *cannot* be extended, because trades 2 and 3 carry the house
   sizer's `15.0`. The count guard `== 3` does still catch a partial split.
**No assertion was loosened under cover of "the population changed."** The replacement of
`test_only_one_of_three_signals_becomes_a_trade_and_that_is_DISCLOSED` quotes the retired
assertions verbatim in its docstring and asserts a strictly stronger condition. That is the right
way to retire a pinned defect.

---

## THE DOER'S FOUR DIRECT QUESTIONS, ANSWERED

**Q1 — Are the greens an artifact of ONE hand-built 3-session fixture that repeats identical bars?
Build your OWN fixture and your OWN oracle.**
**NO.** `[MEASURED HERE]` I built my own frame builder and my own oracle importing nothing from
`src.engine`, and ran **four** fixtures the doer's file does not contain:

| fixture | events | trades | what it exercised that the doer's did not |
|---|---|---|---|
| C1 three normal | 3 | 3 | reproduces the headline on an independent frame builder |
| C2/D3 stop-hit first session | 4 | 4 | **`source_stop` exits end-to-end** — never exercised by P1–P6, all of which end in `source_fixed_r_target`; occupancy releases after a STOP too |
| C4/D4 varied wicks | 4 | 3 | **a real `overlap_suppressed=1` with `suppressed_bars=[74]` on a fixture I built**, plus three DIFFERENT risk/target triples in one run (7.5/134.0, 7.0/133.0, 7.5/133.5) |
| C5/D2 unresolved last | 3 | 3 (one Open) | `unresolved_open=1` → F-3 |

My oracle re-derived, from my own bar tables: entry price, taught stop, risk, 2R target, exit bar
and exit reason. **`AGREE=True` on 14/14 trades.** The per-trade arithmetic is real and it is
per-trade, not a repeated constant.

I also ran the occupancy unit against my oracle on **400 randomised cases** (long + short,
overlaps, same-bar conflicts, unresolved tails, random stop distances):
**disagreements = 0**, and the **positive control** (a planted off-by-one on the overlap boundary)
was caught in **399/400** — the oracle can go red.

**Q2 — Is P6 weak?**
**Yes, and you were right to say so — but I did not have to take the population from you.**
`[MEASURED HERE]` I re-ran the 107-member population at BOTH pins myself, in two separate trees,
and reproduced `32 / 2387 / 2` with an **identical FAILED node-id set** in both directions. So
the structural claim (spy fires on source, never on legacy/overlay) plus my own two-pin
population run is adequate evidence for "legacy and TF_OVERLAY_VARIANT are unchanged" **at
test-name granularity**. What I could *not* do — and neither could you — is build a legacy
fixture that executes a trade through this block, because `_source_faithful` is False there and
the block is not merely inert, it is **not entered at all**. That is not a weakness of P6; it is
the correct shape for an unreachable-path proof. The weakness is F-5 (the population's own gate
is red and it excludes the source files), not the reasoning.

**Q3 — Did you weaken any assertion?** See LOW above. Two minor coverage losses, no loosening.

**Q4 — The `dynamic_atr` Size 1.0 / 15.0 / 15.0 ramp: right call or incomplete repair?**
**The call is right and the disclosure is the best part of the commit.** Sizing is
framework-owned, `_apply_source_faithful_occupancy` touches no sizing code, and fixing it inside
an F-4 repair would have been an unrequested second semantic change. Three additions:
1. `[MEASURED HERE]` I reproduced the ramp independently on my own fixtures — `[1.0, 15.0, 15.0]`
   on C1 and `[1.0, 1.0, 15.0, 15.0]` on the stop-hit fixture. It is an ATR-warmup artefact and
   it means **the first source trade of every run is systematically undersized ~15×**. Any
   expectancy/Sharpe/drawdown number off this route is dominated by it. Your pin says exactly
   this; I am corroborating, not correcting.
2. The pin `sizes == [1.0, 15.0, 15.0]` is **fixture-specific**. My stop-hit fixture produced a
   4-element ramp. The pin catches a change on *this* fixture only — fine as a tripwire,
   not a property.
3. The disclosure lives in a **test docstring**. Like F-1, it never reaches the artifact a
   downstream reader actually holds.

---

## ATTACKS THAT FOUND NOTHING — THE HONEST NULLS

These are complete answers, not gaps. Each names the path that would have shown a defect.

**Attack 1 — two-authority disagreement (the `scan_bound = original_exit_idx + 1` vs `n` asymmetry).**
**NO DISAGREEMENT FOUND.** `[MEASURED HERE]` I wrapped `_resolve_source_managed_exit` with a spy
that phase-labels calls by whether `_apply_source_faithful_occupancy` is on the stack, then
compared the PLAN call and the MANAGEMENT call for the same entry bar on **six** fields —
`entry_price, risk_points, target_price, exit_idx, exit_reason, exit_price` — across four
fixtures: `D1 plan=3 mgmt=3`, `D2 plan=3 mgmt=3` (incl. the unresolved tail),
`D3 plan=4 mgmt=4` (incl. two stop exits), `D4 plan=3 mgmt=3` (incl. a suppressed overlap).
**13 pairs × 6 fields = 78 comparisons, `disagreements: 0`.** And zero `PLANNED n -> NO TRADE
RECORD` lines on the unmutated arms. The asymmetry is benign *because* vectorbt honours the
planned exit bar exactly, which I verified independently (below). It is not benign *by
construction* — F-2 and F-6 are the two routes that break the premise.

**Attack 2 — causality / look-ahead.** **NOT REFUTED.** `[MEASURED HERE — read the executable
lines]` `source_stop` and `target.target_price` are both computed from `entry_price` and the
`structural_stop_map` entry at `entry_idx` **before** the loop; the loop
`for bar in range(entry_idx + 1, min(scan_bound, len(high_np)))` breaks on the FIRST touch. The
exit written at bar `k` is a function of entry-time levels and of `high/low/open` at bars
`entry_idx+1..k` only. No later bar is read before the break. This is a forward simulation, not
look-ahead, and it is the same causal shape `_apply_dsl_stop_loss_and_time_stop` uses.

**Attack 3 — the entry-price assumption (`close_np[i]`).** **CONFIRMED, via a path that imports
no engine code.** `[MEASURED HERE]` I called `vbt.Portfolio.from_signals` directly with
`close = linspace(100,140,40)`, `entries[12]=True`, `exits[20]=True`, `size=1`: the record came
back `Avg Entry Price = 112.307692` = `close[12]` and `Avg Exit Price = 120.512821` = `close[20]`.
**vectorbt 1.0.0 fills at the close of the signal bar with no internal roll.** Independently
corroborated end-to-end: on all four of my fixtures every record's `Avg Entry Price` equalled
`close[entry_idx]` of **my own** bar table (119.0, 118.5, 133.0 as applicable), and every
record's `Exit Idx` equalled my oracle's exit bar.

**Attack 4 — is `i <= occupied_until` the right convention at the exact exit bar?**
**YES — it matches the engine's own sibling.** `[MEASURED HERE — read the executable lines]` In
`_apply_dsl_stop_loss_and_time_stop` the entry-admission check `if bool(entry_long_out[i]) and
not in_long:` sits at `:3821`, and the ATR-stop exit that clears `in_long` sits **after** it at
`:3921-3926`. So in the sibling, an entry on the same bar a stop fires is **rejected** — `in_long`
is still True when admission is tested. `<=` reproduces that. (The 15:55 forced flatten at
`:3809-3817` runs *before* admission and therefore *does* release the bar — a deliberate
difference for a house rule that is bypassed under SOURCE_FAITHFUL anyway.) Separate note, not a
defect: the new pass uses `bar_low <= source_stop` (inclusive) where the sibling uses
`bar_low < long_stop_price` (strict). The inclusive form was extracted **verbatim** from
`_apply_source_fixed_r_management` and matches a wick-inclusive taught stop. Not a regression.

**Attack 5 — the unresolved trade.** Real, and it is **F-3**. It does not "silently suppress
everything after" in the way feared — `occupied_until = n-1` only suppresses events *after* the
unresolved entry, which is the correct occupancy semantics; the honesty gap is the open MTM
record entering the metric population.

**Attack 6 — same-bar long+short: does an entry leak through to vectorbt?**
**NO. Your comment is correct and I verified it directly.** `[MEASURED HERE]` The pass leaves
BOTH `entry_long[i]` and `entry_short[i]` True, so I tested vectorbt's actual behaviour with my
own `from_signals` call, no engine code:
```
A conflict-only bar5 (both True, nothing else):        trades=0
B conflict bar5 + a clean long 12->20:                 trades=1  (entry 112.307692 -> exit 120.512821)
C control: the clean long 12->20 alone:                trades=1  (identical record)
```
`conflict-only opens a position: False` · `B == C (conflict truly inert): True` · vectorbt 1.0.0.
Nothing leaks. `[HYPOTHESIS]` this is a **vectorbt-version-dependent** property that the code
relies on in a comment and does not enforce; clearing both entries would make it independent of
the library. Not a finding at this pin.

**Attack — do any reported metrics come from `pf` (vectorbt's own P&L at close) rather than the
managed exit price?** **NO.** `[MEASURED HERE]` `awk 'NR>=8080 && NR<=9000 && /pf\./'` over
`run_class_backtest` returns exactly two hits: `pf.trades.count()` (`:8103`) and
`pf.trades.records_readable` (`:8104`). Everything else is recomputed from `managed_trades`.
This mattered because the exits now land at target/stop prices while vectorbt's records price
them at `close[exit_idx]` — on C1 that is 134.0 vs 133.0, a 1.0-point × 15-contract gap that
would have leaked into equity/drawdown had any metric been pf-derived. It is not. The project
rule (*compute P&L ourselves*) holds through this change.

---

## MANDATORY CLOSING COVERAGE

### 1. What I verified, and via which two-plus non-overlapping paths

| Claim clause | Path A | Path B | Path C |
|---|---|---|---|
| N separated events → N trades | engine end-to-end via `bt.main.callback` on the doer's fixture (40/40 tests pass at the pin) | **my own** frame builder + four fixtures the doer does not have (C1–C5) | per-session decomposition: each varied session's event survives into the combined run at its own bar |
| per-trade exact source identity (entry / stop / 2R target / exit bar / exit reason) | trade records returned by the engine | **my own oracle over my own bar tables, importing nothing from `src.engine`** — 14/14 `AGREE=True` | 400 randomised unit cases vs the same oracle, 0 disagreements, planted-bad caught 399/400 |
| the two authorities cannot disagree | spy over `_resolve_source_managed_exit`, 78 field comparisons, 0 disagreements | vectorbt honours the planned exit bar: record `Exit Idx` == my oracle's exit bar on all 14 | direct `from_signals` probe confirming close-fill with no roll |
| entry fills at `close[i]` | records vs my own bar tables | **standalone `vbt.Portfolio.from_signals` call with no engine code** | — |
| same-bar conflict opens nothing | standalone `from_signals` A/B/C arms | conflict arm record byte-identical to control arm | — |
| legacy / TF_OVERLAY unchanged | **my own** population run at `45e4ca84`: 32/2387/2 | **my own** population run at `66c9a476` in a separate worktree: 32/2387/2, FAILED sets `diff`-identical | structural: the occupancy spy records `calls == []` on both non-source arms |
| the occupancy metadata is not disclosed | repo-wide key sweep, 0 consumers | envelope key list read **by key** from a live run | sibling `dsl_guards` IS present — parity contrast |

### 2. Positive-control witnesses for every absence claim I make

| Absence claimed | Positive control that fired |
|---|---|
| "no consumer of the occupancy metadata" | the same sweep returns 19 hits inside `backtester.py` and 7 in the test files — the method finds references when they exist; and the sibling key `source_faithful_bypassed` **is** found in the envelope |
| "the two authorities never disagreed" | the spy recorded **13 plan calls and 13 management calls** (not zero) across four fixtures; a silent spy would have printed `plan=0 mgmt=0` |
| "my oracle found no arithmetic defect" | **planted-bad control**: an injected off-by-one on the overlap boundary was caught in **399/400** cases |
| "a same-bar conflict leaks nothing" | arms B and C both produced a real trade record — the harness can produce a non-zero population |
| "no pf-derived metric" | the same `awk` returned two genuine `pf.` hits — the pattern is not silently empty |
| "FAILED sets identical across pins" | both files contain 32 non-empty `FAILED` lines; `-rf` was used (not `-rsxX`, which omits `f` and has faked a failure list on this desk before) |
| "src/ unchanged across the mid-grade head move" | `git diff --stat 45e4ca84 HEAD` is non-empty overall (2 docs files, 313 insertions) — the diff command works; it is empty only when scoped to `-- src/` |

### 3. Join keys checked for every "identical / unchanged / matches" claim

- **population A/B:** join = **pytest node id** (`file::Class::test`), sorted, `diff`-ed both
  directions. `IDENTICAL FAILED SETS`. **Stated limitation (F-5): this join is blind to a
  changed failure message at an unchanged pass/fail state, and one of the 32 is exactly that.**
- **plan ↔ management:** join = `entry_idx`, phase-labelled by call stack; compared on six
  value fields, not on presence.
- **record ↔ my oracle:** join = `(entry_idx, direction)`; compared on `entry_price`,
  `risk_points`, `target`, `Exit Idx`, `exit_reason`.
- **manifest drift:** join = the member path string; the derivation-only set differs by exactly
  `engine/tests/test_source_trade_population.py` between the pins.
- **pin identity:** `git rev-parse HEAD` inside each tree, plus `git rev-parse --git-common-dir`
  to prove which repo the linked worktree belongs to.

### 4. What I did NOT verify, and why

1. **`compute_position_sizes` cannot emit `0.0` on production data** — not proven either way.
   F-2's mechanism is therefore `[HYPOTHESIS]`; **F-2's structural defect (a plan count published
   as an execution count) is `[MEASURED HERE]` and does not depend on it.**
2. **Whether a REFUSED short event still sets `entry_short[i] = True`** (F-7). I traced the
   refusal chain through three files but did not build a short-emitting fixture. Until that is
   run, the claim "shorts are fail-closed for this source" is `[RELAYED]`, and the new hard-failure
   surface outside the guard `try/except` is unquantified.
3. **Real market data.** Everything here is synthetic OHLC. Gaps, duplicate timestamps, DST
   boundaries, rollover days, and the warmup strip were **not** exercised against the occupancy
   pass. The `gap_count` branch (`bar_open` beyond the stop) was never taken in any of my runs.
4. **Multi-symbol / walk-forward / crisis routes.** Band C single-run only, as briefed.
5. **`total_trades > ~4`.** My largest population was 4. The 40-events-→-1-trade scale at which
   F-4 was originally measured was **not** re-run; I have no measurement of the repair at that
   scale.
6. **P&L / expectancy / Sharpe correctness of the new population.** I verified no metric is
   pf-derived and I verified the per-trade exit prices; I did **not** recompute
   `contracts × points × point_value − commission − slippage` end-to-end. Given F-3 (an Open MTM
   record in the population) and the 1.0/15.0 sizing ramp, **no P&L claim off this route should
   be treated as graded.**
7. **The 32 pre-existing failures.** Reproduced at both pins and diffed; **not diagnosed.** They
   are outside this charter and I am not asserting they are benign.
8. **The doer's `docs/designs/AR-1094-WORKER-F4-TRADE-POPULATION-2026-08-12.md`** (landed at
   `02ea6462`, after my grade began). I graded the CODE, not that report. Its claims are ungraded.

---

**Grader independence:** I did not design, build, or previously grade this change or any
ancestor in its lineage. No prior band, no prior "fixed" claim, and no memory of prior work on
`_apply_source_faithful_occupancy` entered this derivation. Every band and every finding above is
re-derived from artifacts at `45e4ca84`.

*Receipt complete as of the final line. Written to the worktree, deliberately not committed.*
