# GRADE — SOURCE_FAITHFUL B/C/D/F VERTICAL (Band C at the production default)

**Grader:** `accuracy-validator` (independent; I did not design, write or previously grade this unit).
**Mandate:** DISPROVE.
**Date:** 2026-08-12.
**Engineering pin graded:** `4936aae810b4a80ceefe0b0ca1ae248f7f461415`
**Baseline compared against:** `b609f039` · predecessors in unit: `001c1758`, `162e6fa1`
**Worktree:** `C:\Users\tonio\Projects\wt-h1-wave4-20260712` (branch `h1-wave4-sealed12-driver`)
**Tree identity check:** `git rev-parse --git-common-dir` → `C:/Users/tonio/Projects/trading-forge/trading-forge/.git`
(the shared repo, NOT the session cwd's decoy `.git`). `git status --porcelain -- src/` → **empty**, so every
measurement below describes the pinned source exactly. `MEASURED HERE`.

---

## VERDICT

| System | Band | Status | Evidence | Open risks |
|---|---|---|---|---|
| SOURCE_FAITHFUL B/C/D/F vertical, `mode="single"` Band C route @ `4936aae8` | **7** | **VERIFIED** (2+ non-overlapping paths per claim) | My own fixture through `bt.main.callback` reproduces every load-bearing value predicted by an oracle that imports no engine code (§1); binding differential over 18 real specs with 5 red witnesses (§3) | F-1 walkforward arm of the SAME dispatch silently reinstates every bypass; F-2 stale `Exit Timestamp` → false prop-firm overnight violation; F-3 the vertical route never exercises the warmup rebase; F-4 97.5% entry attrition at 40 sessions |

**THE CLAIM AS WORDED IS CONFIRMED. I could not refute it.** Every load-bearing value in the verbatim claim
was reproduced on a fixture the doer never authored, at prices ~20× different, through the real
`bt.main.callback` route at the shipped flag defaults.

Band 7, not 8, for one reason: **F-1**. The claim names "the real `bt.main.callback` Band C dispatch". That
dispatch has two arms. The `mode="single"` arm is everything the claim says it is. The `mode="walkforward"`
arm of the *same* `elif config.get("compiled_spec")` block executes the source entry population under full
legacy plumbing — no roll skip, no source stop map, no contract validation, every house guard back on — with
no refusal. That is an open HIGH inside the dispatch the claim names, so band 9 (zero open HIGHs) is
unreachable and 8 is not earned.

No band was CLAIMED by the doer, so there is no >1-band gap to reconcile in writing.

**Scope of this band:** commit `4936aae8` · Python 3.13.0 / polars 1.40.1 / numpy 2.3.5 · MES 5m synthetic
frames (mine + the doer's) · env: `TF_FVG_IDENTITY_ENABLED` **unset**, `BACKTEST_STRUCTURAL_STOP_PARITY_ENABLED`
**unset**, `TF_ALLOW_FIXED_1=true` · `mode="single"` unless stated. It is **not** a claim about real market
data, about any corpus artifact (none carries `source_risk` — §3), or about walk-forward.

---

## 1 — THE CLAIM, RE-DERIVED THROUGH A FIXTURE THE DOER DID NOT AUTHOR

I refused to grade from the doer's fixture alone. I built `SESSION_A` at a completely different price level
and wrote an oracle (`scratchpad/grader_fixture.py::oracle`) that imports **nothing** from `src.engine` and
re-derives the taught sequence from the raw OHLC table with its own arithmetic.

| | oracle (path B, no engine import) | production (path A, `bt.main.callback`) |
|---|---|---|
| decision bar | 8 | `entry_idx` = 8, `Entry Idx` = 8 |
| entry price | `close[8]` = 2088.0 | `Avg Entry Price` = 2088.0 |
| direction | long (breakout side) | `Direction` = "Long" |
| stop | `low[7]` = 2061.0 | `risk_points` = 27.0, `stop_basis` = `source_exact` (2088 − 27 = 2061) |
| risk | 2088 − 2061 = 27.0 | 27.0 |
| 2R target | 2088 + 2×27 = 2142.0 | `Avg Exit Price` = 2142.0 |
| exit | fixed-R target | `exit_reason` = `source_fixed_r_target`, `Size` = 1.0 |

`MEASURED HERE`. Doer's constants are 111.5/119.0/7.5/134.0; mine are 2061/2088/27.0/2142. **No shared
constant, no shared arithmetic, exact agreement on all seven.** A hard-coded value anywhere in the production
path could not have survived this.

**First-principles P&L:** contracts 1 × points (2142−2088 = 54) × MES point value $5 = **$270** →
`GrossPnL` = 270.0. Net = 270 − 1.24 commission − 0 slippage = **268.76** → `PnL` = 268.76. `MEASURED HERE`.
MES point value and commission both reconcile; no off-by-one.

### 1.1 Direction authority — attacked at the vertical layer

The doer's direction control lives in the join test (unit layer). I attacked it through the full route by
flipping the *spec's own* declared direction:

```
spec direction=  both -> Direction='Long' entry_idx=8 price=2088.0 stop_basis=source_exact risk=27.0
spec direction=  long -> Direction='Long' entry_idx=8 price=2088.0 stop_basis=source_exact risk=27.0
spec direction= short -> Direction='Long' entry_idx=8 price=2088.0 stop_basis=source_exact risk=27.0
```

`MEASURED HERE`. The breakout side wins over the artifact's own `direction` field. Claim CONFIRMED, and see
F-6 for the disclosure consequence.

---

## 2 — THE FIVE NAMED ATTACKS

### Attack 1 — warmup index → **see F-3 (MEDIUM). Partially refuted.**
The rebase is *correctly implemented* and *genuinely discriminated at the unit layer*: `test_17b_the_rebase_
is_BY_TIMESTAMP_not_by_subtracting_a_count` slices two extra rows so offset arithmetic lands two candles late
and only a timestamp join lands right. That is a real path to red. `ARTIFACT-SOURCED` + I read the executable
line.

But the **vertical** route — the one the claim names — never exercises it. I measured `warmup_rows`:

```
warmup line present: False        # doer's own 3-session fixture through bt.main.callback
```

`main()`'s `mode="single"` branch passes no `warmup_data`, so `warmup_rows = 0` and `_build_source_stop_map`'s
rebase is the identity map. **A naked-offset implementation would produce a byte-identical vertical proof.**
Confirmed non-zero only on the walkforward arm (`prepended 660 IS bars … stripped 660 IS rows`) — which is
exactly the arm that never calls `_build_source_stop_map` at all (F-1).

### Attack 2 — per-session opening range → **CLAIM SURVIVES.**
I built `SESSION_B`: identical shape, but its own ORH is **2075** while its FVG's lower edge is **2070**.
Under its own range the zone is not outside (2070 > 2075 is false) → no event. Under `SESSION_A`'s ORH 2060 it
*would* qualify (2070 > 2060). A smeared or borrowed range therefore shows up as a second raw signal.

```
A2  A then B : Signal pipeline: raw=1 (L:1 S:0)     <- B contributed ZERO
A3  B alone  : Signal pipeline: raw=0 (L:0 S:0)     <- positive witness: B is genuinely inert
```

`MEASURED HERE`. The range is not borrowed. A3 is the control that stops A2 being vacuous.

### Attack 3 — same-FVG identity → **the named sub-case is STRUCTURALLY UNREACHABLE.**
"Two overlapping zones with the same `start_idx`" cannot occur. `detect_fvg_zones` emits at most one bullish
(`low[i] > high[i-2]`) and one bearish (`high[i] < low[i-2]`) zone per index, and both together imply
`low[i] > high[i-2] >= low[i-2] > high[i] >= low[i]` — a contradiction. Likewise "a zone whose displacement
candle is index 0" cannot occur: `start_idx >= 2` by construction, so `start_idx - 1 >= 1`, and
`select_session_source_events` further requires `start_idx >= lock_idx`. `MEASURED HERE` (read off
`fvg_native.py:detect_fvg_zones` and `source_entry_events.py:425`). Identity itself is preserved by list
filtering, which does not copy members — verified by reading `select_session_source_events`.

### Attack 4 — same-candle entry order → **CLAIM SURVIVES, and now it has a test.**
The doer said the property was structural and untested. I built `SESSION_C` so the **decision candle's own
low (2070) sits below the taught stop (2075)** — the stop is "touched" inside the entry bar.

```
A4  C: TRADE entry_idx=8  Avg Entry Price=2088.0  risk_points=13.0  stop_basis=source_exact
        Avg Exit Price=2114.0  exit_reason=source_fixed_r_target
```

`MEASURED HERE`. No retroactive `source_stop`; the trade survived to its 2R target (2088 + 2×13 = 2114,
matching my oracle). The `entry_idx + 1` scan floor holds under a fixture built to break it.
Note this required `low[i-1] > high[i-2]` — reachable, but a narrow shape; the doer's fixture could not
produce it.

### Attack 5 — my own novel attack → **F-1. REFUTATION FOUND (out of the claim's literal scope, inside its named dispatch).**
See §4.

---

## 3 — THE THREE "I MAY HAVE BEEN WRONG" ITEMS

### 3a. Does the claim survive a fixture the doer did not author? — **YES.** §1 above.
I additionally attacked the exit engine with three fixtures of my own:

```
D stop only     : Avg Exit Price=2061.0  exit_reason=source_stop   GrossPnL=-135.0
E both same bar : Avg Exit Price=2061.0  exit_reason=source_stop   GrossPnL=-135.0
F gap through   : Avg Exit Price=2050.0  exit_reason=source_stop   GrossPnL=-190.0
```

`MEASURED HERE`. D exits at the *exact* stop (−27 × $5 = −$135 ✓). E touches stop **and** target on the same
bar and resolves conservatively to the stop, as documented rather than in the trade's favour. F opens below
the stop and fills at the **open** (2050), not the stop: (2050 − 2088) × $5 = −$190 ✓. All three reconcile to
first principles.

### 3b. Did the FVG-routing bypass change any LEGACY binding? — **NO. Verified independently, with a red witness.**

Path 1 — differential. I created a baseline worktree at `b609f039` (`C:\b609`, sparse), ran
`compile_binding_plan` in **both** trees over the **same** 16 spec bodies read from a fixed absolute corpus
path (the corpus is the join key; only the code varies), and diffed the JSON:

```
C:\Users\tonio\Projects\wt-h1-wave4-20260712: 16 specs compiled -> bind_head.json
C:\b609:                                       16 specs compiled -> bind_base.json
=== DIFF ===
IDENTICAL (0 differing lines)
```

Path 2 — **positive control**, because a differential with no path to red proves nothing:

```
flag default fvg_identity_enabled() = False
specs=18  FVG-family(WAIT_STRUCTURE/FILTER) conditions reachable by the changed line = 14
specs whose bindings CHANGE when SOURCE_FAITHFUL is planted: 5
   RED WITNESS: ('-igpOZs8LsM__s0.spec.json', 0, 4)
   RED WITNESS: ('CLDEIsNpVRc__s0.spec.json', 0, 3)
   RED WITNESS: ('WEhmadJArQo__s0.spec.json', 0, 2)
   RED WITNESS: ('kFyD3H6I1I8__s0.spec.json', 0, 1)
```

`MEASURED HERE`. The changed line **is** reachable on 14 real conditions and planting the known-bad
(`source_risk.mode = SOURCE_FAITHFUL`) flips 5 specs' bindings — so the zero-diff null is a **meaningful**
null, not a vacuous one. Also confirmed here: `fvg_identity_enabled()` is `False` at the production default,
as the doer stated.

Corroborating: exactly one file in the repo carries `source_risk`
(`src/engine/extraction/fixtures/svkm_source_risk_canonical.json`), so no library artifact takes the source
route today. `MEASURED HERE`.

### 3c. Were the rewritten Style-C tests weakened? — **NO. They were strengthened.** But see F-5.

| before (`b609f039`) | after (`4936aae8`) | assessment |
|---|---|---|
| `test_style_c_under_source_faithful_REFUSES_rather_than_mislabelling` — one unconditional refusal | `test_source_faithful_with_NO_target_contract_REFUSES` + 5 parametrized malformed-contract refusals + `test_a_VALID_target_contract_PASSES_the_gate` | **stronger** — a positive witness was added that the five refusals are worthless without |
| `test_the_refusal_names_style_c_and_the_missing_wiring` | `test_the_refusal_names_the_missing_contract` | equivalent |
| `test_source_faithful_with_a_non_styleC_engine_passes_the_exit_gate` — a *negative* assertion on a string the ruling deleted | `test_the_contract_gate_is_NOT_scoped_to_style_c` — a *positive* `pytest.raises` | **stronger** — a vacuous green replaced by a real one |
| single `MAP` keyed at bar 9 shared by both arms | `MAP` (9) + `SOURCE_MAP` (10) + new `test_the_two_arms_do_NOT_share_a_lookup_key` | **stronger** — a new discriminator; the assertions themselves are unchanged |

Test count in that file: **31 → 34**. The retired refusal string
`"REFUSING rather than mislabelling"` is genuinely **absent from all production code** (grep over `src/`
returns only this test file and a comment), so the rewrite was not a cover for keeping a dead branch alive.
`MEASURED HERE`.

---

## 4 — FINDINGS, RANKED

### Discrepancy F-1: the walkforward arm of the same Band C dispatch runs the SOURCE population under LEGACY plumbing
**Severity:** HIGH (silent disagreement / parity gap)
**Claim:** "driven through the real `bt.main.callback` Band C dispatch … no ATR fallback, no ceiling clamp, no
Style-C ladder, no partials, no trailing stop, and no legacy +1-bar entry roll."
**Reality:** true for `mode="single"`. On `mode="walkforward"` — the sibling branch of the *same*
`elif isinstance(config, dict) and config.get("compiled_spec")` block — `source_risk_mode` is **never
threaded**, so `_source_faithful` is `False` in `run_class_backtest` while the compiler still takes the source
route off `self.spec["source_risk"]["mode"]`. Every bypass the claim enumerates is silently reinstated.

**Sources compared:**
- signature: `run_walk_forward_class` params = `['strategy','start_date','end_date','slippage_ticks','commission_per_side','firm_key','n_splits','is_ratio','embargo_bars','optimize','skip_eligibility_gate']` → `'source_risk_mode' in params: False`
- surface: `grep -n "source_risk\|source_faithful" src/engine/walk_forward.py` → **0 rows**
- execution, same config, both modes:
```
--- mode=single        --- source_risk_mode='SOURCE_FAITHFUL'  trades=1
     Signal pipeline: raw=40 (L:40 S:0) -> gate=40 -> rollover=40
--- mode=walkforward   --- source_risk_mode=None               trades=0
     Signal pipeline: raw=20 (L:20 S:0) -> gate=20 -> rollover=19
       Class backtest IS warmup: prepended 660 IS bars ... stripped 660 IS rows
```
**Source of truth:** the execution. Two independent tells, neither of which needs the other:
1. `rollover=19 != gate=20` — rollover-day suppression fired. That guard is `if … and not _source_faithful`,
   so its firing *proves* the backtester ran as legacy.
2. `raw=20` on a 20-session window can only be the **source** population: I measured the legacy arm on this
   identical price action at `raw=0` (`LEGACY(no source_risk) → raw=0 (L:0 S:0)`). So the compiler was on the
   source route while the backtester was on the legacy one.

**Fix point:** `src/engine/backtester.py:9144` — `run_walk_forward_class(...)` is missing
`source_risk_mode=_source_risk_mode_from_spec(config.get("compiled_spec"))`, which its sibling at
`src/engine/backtester.py:9190` does pass. `src/engine/walk_forward.py:2476` must accept and forward it.
**Repro:**
```
python scratchpad/wf_attack.py     # drives bt.main.callback in both modes on one config
```
**Blast radius:** any Band C walk-forward of a SOURCE_FAITHFUL artifact. On that route the teacher's entries
are executed with the +1 roll (wrong candle, wrong price), the house eligibility-gate stop map keyed at
`entry_idx - 1`, ATR fallback, the ceiling clamp, the Style-C ladder, the 15:55 flatten, DLL halt, the 2/day
cap and rollover suppression — and `_resolve_source_fixed_r`'s contract validation never runs, so a malformed
`spec.source_risk.target` does **not** refuse. It does *not* mislabel (`source_risk_mode` reports `None`), which
is what keeps this HIGH rather than CRITICAL. But AR-1082 §7 authorises no source-faithful performance
backtest, and walk-forward is precisely the performance path — this is the route by which such a number could
be produced with no refusal anywhere. The doer's own comment at `_resolve_stop_risk_points` says the roll skip
and the `entry_idx` offset "are the SAME decision expressed twice"; on this arm **neither** is expressed while
the entry population still changes.

---

### Discrepancy F-2: `Exit Timestamp` is never updated to the managed exit → false prop-firm overnight violation
**Severity:** HIGH to the desk / **PRE-EXISTING, and OUTSIDE the claim's scope**
**Claim:** (not made by the doer — surfaced by the vertical proof)
**Reality:** the trade-construction loop overrides `Avg Exit Price`, `Exit Idx`, `exit_reason`, `PnL` with the
managed exit but leaves `Exit Timestamp` as vectorbt's. On the source arm every trade is `Status: "Open"`
(the strategy never sets `exit_long`), so vectorbt's exit timestamp is always the **last bar of the frame**.
**Sources compared:** on the doer's own 3-session fixture —
`"Exit Idx": 11` (= 2024-01-02 10:25 ET) vs `"Exit Timestamp": "2024-01-04T17:10:00+00:00"` (= bar 98).
`"hold_type": "INTRADAY_ONLY"` in the same record.
**Source of truth:** `Exit Idx`/`Avg Exit Price`. `prop_sim.py:84-94` derives `overnight_days` by comparing
`Entry Timestamp[:10]` to `Exit Timestamp[:10]`, so on that fixture the desk reports
`"overnight_risk_days": 1, "overnight_violation": true, "overnight_gap_risk": true` for a trade that in fact
exited **15 minutes** after entry — and `overnight_violation` is a term in `passed`.
**Fix point:** `src/engine/backtester.py:8051` — `trade["Exit Idx"] = exit_idx` with no companion
`trade["Exit Timestamp"] = <ts at exit_idx>`.
**Repro:** `python scratchpad/probe_warmup.py` (doer's fixture) — read `trades[0]` and `prop_compliance`.
**Attribution:** `git diff b609f039 4936aae8 -- src/engine/backtester.py` does **not** touch this block
(`git log -L` dates it to `95068a7a`, "deep engine audit"). It is a generic, legacy-shared defect; this unit
merely surfaces it. I am reporting it because it is a **false value in the record the claim asks me to read**.
**Blast radius:** `prop_compliance.*.overnight_violation` / `overnight_risk_days` /
`overnight_margin_warning` / `passed`, on **both** arms, for every class-path trade whose managed exit is
earlier than the vectorbt exit.

---

### Discrepancy F-3: the vertical route never exercises the warmup rebase
**Severity:** MEDIUM (unfalsifiable-on-this-route)
**Claim:** implicit in "driven through the real `bt.main.callback` Band C dispatch".
**Reality:** `warmup_rows = 0` on that route, so `_build_source_stop_map`'s timestamp rebase is the identity.
**Sources compared:** stderr contains no `Class backtest IS warmup` line on `mode="single"`; it appears
(660–1234 IS bars) only on `mode="walkforward"`, which never calls `_build_source_stop_map`.
**Source of truth:** the stderr diagnostic, which `main()` emits unconditionally when `warmup_rows > 0`.
**Fix point:** none required in production — this is a **proof-coverage** gap, not a defect. The rebase is
correctly implemented and discriminated at the unit layer (`test_17b`). It is recorded so no reader upgrades
the vertical green into "the rebase is proven end to end".
**Repro:** `python scratchpad/probe_warmup.py` → `warmup line present: False`.
**Blast radius:** none today. It becomes load-bearing the moment F-1 is fixed, because the only route with a
non-zero strip is the one that currently skips the source path entirely.

---

### Discrepancy F-4: entry attrition — 40 taught entries produce 1 trade
**Severity:** MEDIUM (disclosed at 3 sessions; its magnitude is not)
**Claim:** "produces exactly one auditable trade".
**Reality:** true, but not because one setup occurred. On the doer's 3-session fixture the engine itself
prints `raw=3 … vectorbt drop: 67%` and the doer pins this honestly in
`test_only_one_of_three_signals_becomes_a_trade_and_that_is_DISCLOSED`. I extended the measurement:
```
40 identical sessions -> Signal pipeline: raw=40 (L:40 S:0) -> gate=40 -> rollover=40 -> trades=1
```
`MEASURED HERE`. **97.5% of the taught population is discarded**, because `exit_long` is framework-owned and
never set, so the position opened at the first entry is still open in the vectorbt simulation when the other
39 fire; the managed exit is retro-fitted afterwards and the simulation is never re-run.
**Source of truth:** the engine's own signal-pipeline line, cross-checked against my oracle, which found one
qualifying event per session.
**Fix point:** none proposed — this is pre-existing position-model behaviour, correctly disclosed. Recorded
because the "exactly one auditable trade" phrasing reads as precision and is partly an artifact.
**Blast radius:** any future source-faithful trade-count, expectancy or performance claim on this route.

---

### Discrepancy F-5: a surviving decayed negative control, in the same file as the one that was repaired
**Severity:** LOW
**Claim:** "I … REPAIRED one decayed negative control."
**Reality:** one instance was repaired; another instance of the identical class survives in the same file.
`src/engine/tests/test_source_faithful_execution_mode.py:149`:
```python
assert "REFUSING rather than mislabelling" not in msg
```
That string exists nowhere in production code, so the assertion has no path to red.
**Sources compared:** I enumerated the whole class rather than closing the instance — every
`assert "…" not in …` across all four test files, each subject checked against a 298-file / 5.29 M-char
production blob, behind a **self-test that must distinguish a known-present from a known-absent subject
before any result is emitted**:
```
SELF-TEST OK: method distinguishes present from absent
LIVE     test_source_faithful_fvg_routing.py:146   'TF_FVG_IDENTITY_ENABLED'
LIVE     test_source_faithful_fvg_routing.py:148   'TF_FVG_IDENTITY_ENABLED'
LIVE     test_source_faithful_execution_mode.py:130 'source_risk.target'
LIVE     test_source_faithful_execution_mode.py:148 'not a declared ownership mode'
DECAYED  test_source_faithful_execution_mode.py:149 'REFUSING rather than mislabelling'
LIVE     test_source_faithful_execution_mode.py:158 'not a declared ownership mode'
LIVE     test_source_faithful_execution_mode.py:500 '_apply_dsl_stop_loss_and_time_stop'
LIVE     test_source_faithful_execution_mode.py:539 '_apply_dll_halt_to_entries'
negative string assertions scanned: 8
```
**Source of truth:** the enumeration. **1 of 8 decayed** — the class is bounded and now closed.
**Fix point:** `src/engine/tests/test_source_faithful_execution_mode.py:149` — delete the line (its companion
at :148 is still live, so the test itself keeps a real subject).
**Repro:** `python scratchpad/decay_scan.py`.
**Blast radius:** none beyond that assertion.

---

### F-6 (LOW): the artifact's declared `direction` is silently ignored on the source arm
`spec.direction="short"` still produces `Direction='Long'` (§1.1). This is *intended* — AR-1079 §4 retires the
legacy direction route — but nothing in the result envelope discloses that a declared direction was
overridden. `dsl_guards.source_faithful_bypassed` lists six bypassed house guards and does not list this one.
`MEASURED HERE`. Suggest adding it to that list, where it would be read.

### F-7 (LOW): `test_a_VALID_target_contract_PASSES_the_gate` is a weak positive witness
It asserts `pytest.raises(Exception)` and then that the message lacks the contract strings. It therefore
witnesses "not refused **by this gate**", not "the gate passed" — any later exception satisfies it. The doer
labels it "THE POSITIVE WITNESS", which slightly overstates it. The Band C vertical file supplies the real
positive witness, so the gap is covered elsewhere.

---

## 5 — MANDATORY COVERAGE SECTION

### 5.1 What I verified, and via which two-plus non-overlapping paths

| Claim element | Path 1 | Path 2 |
|---|---|---|
| entry bar = third FVG candle | production `entry_idx`/`Entry Idx` = 8 on **my** fixture | my oracle's independent zone scan (`low[i] > high[i-2]`) → bar 8 |
| entry price = that candle's close | `Avg Entry Price` = 2088.0 | oracle `close[8]` = 2088.0 |
| direction from breakout side | `Direction='Long'` with `spec.direction="short"` | oracle close-crossing transition scan → long at bar 5 |
| stop = exact displacement wick low | `stop_basis='source_exact'`, `risk_points`=27.0 | oracle `low[7]`=2061; 2088−27=2061 |
| whole-position fixed 2R target | `exit_reason='source_fixed_r_target'`, `Size`=1.0 | oracle 2088+2×27=2142 = `Avg Exit Price` |
| no ATR fallback / ceiling clamp | `stop_basis != 'atr_fallback'`; risk 27.0 survived (MES ceiling is below it) | read `_resolve_stop_risk_points` — `source_faithful` returns before `min(distance, stop_ceiling)` |
| no Style-C / partials / trailing | `exit_reason` not in {tp1,tp2,trail,runner,time_stop}; `Size`=1.0 | `_apply_trade_management` branches to `_apply_source_fixed_r_management` **above** the exit_policy ladder |
| no +1-bar roll | `entry_idx`=8 = decision bar, price = its close | `run_class_backtest` `if _source_faithful:` branches around `np.roll` |
| per-session OR never borrowed | SESSION_B contributes 0 signals alongside SESSION_A | SESSION_B alone → `raw=0` (control) |
| same-candle stop cannot retro-exit | SESSION_C: stop breached inside the entry bar, no `source_stop` | scan floor `entry_idx+1` read off the source line |
| legacy bindings unchanged | HEAD-vs-`b609f039` JSON diff over the same 16 specs → 0 lines | planted-bad control → 5 specs flip (14 reachable conditions) |
| exit engine arithmetic | three fixtures (stop / ambiguous / gap-through) | first-principles `points × $5` reconciliation on each |
| P&L | `GrossPnL` 270.0, `PnL` 268.76 | 1 × 54 × 5 = 270; 270 − 1.24 = 268.76 |

Two further paths on the doer's own greens: I re-ran the four named test files (**84 passed in 11.62s**) — but
that is the doer's instrument and I have **not** counted it as one of the two paths for any claim above.

### 5.2 Positive-control witnesses for every absence claim I make

| absence claim | its positive control |
|---|---|
| "the FVG-routing bypass changed 0 legacy bindings" | planting `source_risk.mode=SOURCE_FAITHFUL` flips 5 specs; 14 conditions are reachable by the changed line |
| "SESSION_B produced no source event" | SESSION_A on the same run produced exactly one (`raw=1`), so the detector was alive |
| "no retroactive same-candle exit" | the same fixture *does* produce `source_stop` when the breach is at bar 9 (case D) |
| "7 of 8 negative assertions are live" | the scanner self-tests present-vs-absent before emitting |
| "the old Style-C refusal string is gone from production" | the *other* refusal string `not a declared ownership mode` **is** found by the same grep |
| "`warmup_rows` = 0 on the single route" | the `IS warmup` line **does** appear on the walkforward route, so the diagnostic works |
| "legacy produced no trades on my fixture" | the source arm produced one on the identical frame |

### 5.3 Join keys checked for every "identical / unchanged / matches" claim

- **binding differential**: join key = the **spec body**, read from one fixed absolute corpus path
  (`C:\Users\tonio\Projects\wt-h1-wave4-20260712\docs\...`) by *both* trees, so only the code varied. Result
  keys are `basename#index`; 16 keys on each side, 16 matched, 0 unmatched.
- **oracle ↔ production**: join key = the **bar index within the frame** plus the price value at it. Both
  sides address the same `SESSION_A` table; production's `entry_idx` and `Entry Idx` agree with each other
  and with the oracle's `bar`.
- **`Exit Idx` ↔ `Exit Timestamp`**: join key = the bar index. They disagree by 87 bars / 3 days — that
  disagreement *is* F-2.
- **mode carriers**: `spec.source_risk.mode` (compiler) vs the `source_risk_mode` parameter (backtester).
  They agree on the `mode="single"` route (same `_source_risk_mode_from_spec(config["compiled_spec"])`
  origin) and **disagree** on walkforward — that disagreement *is* F-1.
- **tree identity**: `git rev-parse --git-common-dir` on both worktrees, plus `git rev-parse HEAD`
  (`4936aae8…` / `b609f039…`) before every measurement.

### 5.4 What I did NOT verify, and why

1. **Real market data.** Every measurement uses synthetic frames (mine and the doer's) with `load_ohlcv`
   patched on both `src.engine.backtester` and `src.engine.data_loader`. This box has no market data
   (a known desk condition), so nothing here says how the source route behaves on real MES bars, on DST
   transitions, on half sessions, or on frames with genuine gaps or duplicate timestamps. **The DST /
   half-session / gap sub-cases of attack 2 are therefore UNMEASURED by me** — the doer's unit tests cover
   the refusal shapes, but I did not independently reproduce them.
2. **Unsorted frames.** `SourceSessionRange` takes `first_idx = min(indices)` / `last_idx = max(indices)`,
   which assumes each session's bars are contiguous. On a frame whose rows are not in timestamp order that
   span would enclose foreign sessions' bars. I did **not** build that fixture (time), so this is a
   `HYPOTHESIS`, not a finding. Production `load_ohlcv` presumably returns sorted data — I did not verify
   that either.
3. **A ≤10-minute opening-range variant.** With a 1-bar OR the lock lands at `first_idx+1`, so
   `lo = first_idx+1` and a zone at that index would read `first_idx-1` — the **previous session's** last bar
   — as candle A. The taught 15m variant makes `lo = first_idx+3` and closes this structurally. I did not
   execute a 5-minute-variant fixture. `HYPOTHESIS`, bounded: unreachable for the taught variant.
4. **Post-RTH / overnight bars.** Sessions are grouped by **local ET calendar date**, so `last_idx` is the
   last bar of that date, not the RTH close. A qualifying FVG hours after the cash session still produces a
   taught entry under that morning's range. The module discloses "NO MAXIMUM DISTANCE IS IMPOSED", so this
   is declared rather than hidden — but I did not measure it. `UNENUMERATED`.
5. **The doer's "7 pre-existing failures across 63 files" claim — NOT VERIFIED. See the restriction below.**
   I could not name the 63-file denominator: `ls src/engine/tests/test_*.py | wc -l` returns **363**, so
   "63 files" is a denominator I cannot reconstruct from the repo. I launched full-suite censuses at both
   `4936aae8` and `b609f039` and they had not completed within my grading window; the baseline tree also
   needed two sparse-checkout widenings because several tests hardcode tree-relative fixture paths
   (`tests/fixtures/style_c_parity_fixtures.json`, `docs/replay-results/h1-battery/...`) and a
   `docs/replay-results/h1-scripts/frontier-birth-gate/...` filename exceeds Windows `MAX_PATH`, which made
   a full `git worktree add` impossible. **This claim remains `RELAYED`. Do not treat it as verified.**
6. **`TF_OVERLAY_VARIANT` behaviour "unchanged".** I confirmed it does not take the source route
   (`source_risk_mode='TF_OVERLAY_VARIANT'`, 0 trades on my frame, identical to legacy's 0) and that the
   binding differential covers it, but I did **not** run an overlay artifact end to end and diff its full
   result envelope against `b609f039`. `PARTIALLY VERIFIED`.
7. **The correlation_id → audit_log → SSE hops.** Not applicable — this is an offline engine path with no
   state transition, no DB write and no broadcast. Nothing to walk.
8. **Anything downstream of the returned envelope** (Node service, frontend, promotion gates). Out of scope.

### 5.5 Restrictions that made a claim uncheckable

| restriction | which claim it makes uncheckable | is the restriction wrong? |
|---|---|---|
| no market data on this box | "the claim holds on real MES bars" | No — the claim never asserted it, and AR-1082 §7 forbids a performance run. Correctly scoped. |
| `MAX_PATH` on `docs/replay-results/h1-scripts/frontier-birth-gate/...` blocks a full baseline worktree | the 7-pre-existing-failures census | **Yes, this one is worth fixing.** A baseline the desk cannot check out is a baseline the desk cannot diff against, and this unit's regression claim depends on exactly that diff. |
| the brief pinned no expected failure **names**, only a count | I cannot join HEAD failures to baseline failures by name even once the censuses finish | Yes — a count is not a join key. Future briefs should name the 7. |

---

## 6 — WHAT WOULD MOVE THIS TO BAND 8

1. Close **F-1**: thread `source_risk_mode` into `run_walk_forward_class`, or make that arm **REFUSE** for a
   SOURCE_FAITHFUL artifact. The desk's own law applies — *the OFF branch is where the defect lives; OFF must
   refuse, never fall back.* Today it falls back, silently.
2. Add a vertical test with a **non-zero warmup strip** so the rebase is proven on the route the claim names
   (F-3) — it becomes reachable the moment (1) lands.
3. Fix or explicitly quarantine **F-2**, since it puts a false `overnight_violation` on a prop-compliance
   record the desk reads.
4. Delete the decayed assertion at `test_source_faithful_execution_mode.py:149` (F-5).
5. Complete the pre-existing-failure census **by name**, at both pins.

---

*Grader independence: I did not author, review or previously grade any commit in this unit. This document is
left UNCOMMITTED in the worktree per the brief.*
