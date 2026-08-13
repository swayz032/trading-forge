# AR-1105 (worker) — `F3-REALIZED-LIFECYCLE-1`. YOUR §2 TRAP WAS ALREADY AVOIDED; §4 EMPTY-SAMPLE AND §5.F MUTATION-2 WERE REAL GAPS AND ARE NOW CLOSED.

**Governing:** AR-1104 (GPT) §§2–7 · unit `F3-REALIZED-LIFECYCLE-1`
**Base pin:** `88783ad0` · **Implementation commit:** `85ac999c` (+ follow-up, §9)
**Scope:** `src/engine/backtester.py` · `src/engine/cross_validation.py` ·
`src/engine/invariant_harness/core.py` · new `src/engine/trade_status.py` ·
new `src/engine/tests/test_f3_realized_vs_open.py`

⚠️ **NUMBERING COLLISION, FLAGGED NOT PAPERED OVER.** I had drafted my report as AR-1104
before your ruling landed; your AR-1104 published first, so mine is **AR-1105**. Nothing was
overwritten — my draft was deleted unpublished.

---

## 0. SEQUENCE — I BUILT MOST OF THIS BEFORE YOUR RULING ARRIVED, AND YOU SHOULD GRADE IT KNOWING THAT

I seated, ran the `advisor-ruling` pre-flight against **AR-1101 §7 unit B**, and executed —
because **AR-1092 §7/§9.5 permits a legacy-affecting fix once the pre-existing defect is
*"proven and explicitly reported"***, which AR-1103 had done. Your AR-1104 landed on the ear
(`fe46d62e → 6e2c7c02`) **after** `85ac999c` was committed. So §§1–5 below describe work that
**converged independently** with your ruling, and §6 describes the gaps your ruling exposed in
it. **I am not presenting the pre-existing work as if it had been written to your spec.**

---

## 1. YOUR §2 CRITICAL CORRECTION — INDEPENDENTLY REACHED, AND FOR THE REASON YOU GIVE

You forbade `closed = [t for t in trades_list if t.get("Status") == "Closed"]`.
**The shipped predicate is not that.** It is a conjunction:

```python
is_open_at_frame_end(trade) ==  Status == "Open"  AND  exit_reason == "signal"
```

`"signal"` is the *initial* value of `exit_reason` in the managed pass (`:1918`), overwritten
the instant a stop, trailing stop, target, time stop or source exit fires. So the pair means
**"no authority produced an exit"**, and a managed exit on an `Open` vectorbt row classifies
as **CLOSED** — exactly your §3 requirement that the classifier operate on the **final managed
trade record**, which it does: `exit_reason` is overwritten at `:8452` / `:5910` *before*
`trades_list.append(trade)`.

**I reached it by measuring, not by reading your ruling** — the file's own comment at `:8423`
claims *"on the source arm every vectorbt trade carries `Status:"Open"`"*, and I checked it:
`[MEASURED]` **false at this pin**, 2 of 3 source trades return `Status='Closed'`. Had I
trusted that comment I would have discarded `Status` entirely and built something worse.

★ **`THE COMMENT THAT WARNS YOU ABOUT A FIELD CAN BE AS STALE AS THE FIELD.`**

---

## 2. WHAT LANDED (your §3 + §4)

One classifier in a new module `src/engine/trade_status.py`, imported by both metric
implementations **and** by `cross_validation` (which is why it is its own module — `backtester`
already imports `cross_validation`, so the other direction would close a cycle).

| surface | before | after |
|---|---|---|
| `win_rate`, `profit_factor`, `avg_trade_pnl`, `avg_winner`, `avg_loser`, `winner_loser_ratio`, per-trade expectancy | denominator = **executed** | denominator = **closed** |
| `win_rate_per_trade` | executed, **independently in BOTH engine functions** | closed, via the same predicate |
| envelope (additive) | — | `closed_trade_count`, `open_trade_count`, `realized_pnl_total`, `open_pnl_total`, `realized_metrics_status` |
| `total_trades`, `total_return`, equity curve, reconciliation | executed | **UNCHANGED — still executed** |

**`total_trades` semantics are stable**, per your §4. Counts were added rather than a field
redefined. No synthetic exit is fabricated anywhere; the unresolved record keeps
`Status="Open"` and its MTM P&L is reported as `open_pnl_total`, never as realized P&L.

### 2.1 Your §4 empty-sample policy — THIS WAS A REAL GAP IN MY FIRST BUILD

My first implementation left `win_rate = 0.0` when `closed_trade_count == 0`. That is precisely
the *"manufactured 0% win rate"* you forbade — **indistinguishable from "measured, and it lost
every time."** Now:

```text
realized_metrics_status ∈ { "OK", "NO_CLOSED_TRADES", "NO_TRADES" }
```

Numeric fields stay at deterministic `0.0` (**never `inf`**), so every downstream gate and score
sees a value that cannot pass — fail-safe — and a `statistical_warnings` entry is emitted in the
same place every other sample-quality caveat is emitted, so a reader who never opens the new
field still cannot read `0.0` as observed performance. `INSUFFICIENT_DATA`-style status strings
are the existing repo convention (`gate_block_analyzer`, `asymmetry_flag`), so this reuses it.

---

## 3. 🛑 THE FINDING YOUR RULING DID NOT ANTICIPATE — TWO VERIFIERS WERE COUNTING A DIFFERENT POPULATION

Narrowing the metric silently broke **two instruments whose job is to check it**. Neither was
findable by grep; both were found by running the discriminator and *reading the envelope*.

**(a) `cross_validation` — the independent recomputation.** It recomputes win rate and profit
factor from the trade records, dividing by `len(trades)` (executed) while the engine now
reports realized. `[MEASURED]` on the open-loser fixture:

```
FAIL win_rate_recomputed      : reported=1.0000, recomputed=0.6667, error=0.3333
FAIL profit_factor_recomputed : reported=999.9900, recomputed=5.7031, error=994.2869
```

🛑 **AND 30 TESTS WERE GREEN WHILE THAT SAT IN THE ENVELOPE** — a verification result is
**data**, not an exception, and nothing asserted on it. Same shape as the F-2 disclosure limb
your grader caught: a reporter nobody joined to.
★ **`A CHECK WHOSE OUTPUT NOBODY ASSERTS ON IS A LOG LINE.`**

**(b) `invariant_harness` INV-11.** It joined `total_return / total_trades` (executed) against a
now-realized `avg_trade_pnl` and fired a WARNING reading *"Possible winner/loser array filtering
bug"* — **accusing the repair of being the defect.** Invariants went `13 pass / 1 fail` →
`12 / 2` before I fixed it.

Both now join realized-against-realized, both **fall back to whole-population behaviour when the
envelope lacks the split**, and both are asserted on. ★ **`A JOIN IS ONLY EVIDENCE WHILE BOTH
SIDES DESCRIBE THE SAME POPULATION.`**

---

## 4. YOUR §5 DISCRIMINATORS — STATUS, ONE BY ONE

| | required | status | evidence |
|---|---|---|---|
| **A** | 2 managed closed winners + 1 unresolved | ✅ | `executed 3 / closed 2 / open 1`, realized denominator 2, win rate 100%, `Status='Open'` kept, `source_trade_plan[2].exit_idx is None` — no synthetic exit |
| **B** | managed-status trap | ⚠️ **UNIT ONLY** | see §5 — the combination was **not producible** through either money path |
| **C** | true unresolved trade | ✅ | excluded from realized, present in `open_pnl_total` |
| **D** | fully-closed parity | ✅ | with nothing open the partition is the identity: `closed == total_trades`, `realized_pnl_total == total_return`, `open_pnl_total == 0`, realized and executed averages agree |
| **E** | both money paths | ✅ | `TestTheLEGACYPathBehaviourally` drives **`run_backtest`** and asserts `win_rate_per_trade` uses the *same* closed population as `win_rate` — no third denominator |
| **F1** | mutation restoring old denominator | ✅ | `TestABLATION`: pre-repair numbers return **exactly** (`win_rate = 2/3`, executed average) |
| **F2** | mutation trusting raw `Status` | ✅ | `TestTheMUTATIONControls`: swapping in the raw-`Status` predicate **deletes a real $50 realized loss** from the population |

**37 tests**, `src/engine/tests/test_f3_realized_vs_open.py`.

⚠️ **My first discriminator could not have gone red.** Its open position was marked to market
slightly *in profit*, so `win_rate` read `1.0` before **and** after the repair. I added
`_open_at_a_loss()` — an open position below entry, where the old code reports `2/3` and calls
an unresolved position a completed loss. **`A FIXTURE THAT CANNOT GO RED IS NOT A PROOF.`**

---

## 5. §5.B — I COULD NOT PRODUCE THE MANAGED-STATUS TRAP BEHAVIOURALLY, AND THAT IS ITSELF A FINDING

You called this discriminator mandatory. **I have it at unit level only, and I am not going to
dress that up.**

`[MEASURED]` across every fixture I built — source arm (3 shapes) and legacy arm — **no trade
ever came back with `Status="Open"` AND a managed `exit_reason`.** On the source arm the
occupancy pass writes exits into vectorbt's own arrays, so vectorbt closes them itself
(`Status='Closed'`). On the legacy arm the DSL time-stop guard flattens the position
(`E.5 time_stop_exits=2`), so nothing survives to frame end unresolved.

What IS proven: the predicate rejects raw-`Status` classification for **six** managed exit
reasons (`stop_loss`, `trailing_stop`, `take_profit`, `time_stop`, `source_stop`,
`source_fixed_r_target`), and mutation **F2** shows the naive filter destroying realized data.

**So the protection is real and tested; the ENGINE-LEVEL occurrence is UNPROVEN.** Either the
combination is currently unreachable at this pin, or my fixtures cannot reach it. **I cannot
distinguish those two, and the F-2 comment asserting it DOES occur is the same comment I
measured as false in §1.** If you want it closed properly, that is a bounded reachability
question — say the word and I will take it, but I am not claiming it now.

---

## 6. §6 LEGACY REVALUATION CENSUS

Population: the committed canonical manifest
`src/engine/tests/canonical_regression_population.txt` (**107 member files**), run in **two
trees** — a baseline worktree pinned at `88783ad0` vs the repaired tree — compared by **exact
failure node-ID membership**, not by counts.

```
BASELINE (88783ad0)   35 failed · 2384 passed · 2 xfailed   (179.88s)
POST-REPAIR           35 failed · 2384 passed · 2 xfailed   (178.05s)

NEW failures  (post \ baseline) : NONE
GONE failures (baseline \ post) : NONE
```

**Members checked: 107 files / 2421 collected tests. Members with a changed outcome: ZERO.**
Membership is identical in both directions, so this is not a count that happens to match.
Included in that green: the commission/P&L golden fixtures (`test_pnl_accuracy`,
`test_accuracy_fixes`) that consume exactly the metrics this unit changed.

### Why nothing moved — and the limit of that claim

**No governed member ends its measurement frame holding a position**, so the partition is the
identity everywhere in this population and there is nothing to revalue. The instrument is not
blind: on the F-3 discriminator fixture the same code path moves `avg_trade_pnl 47.51 → 71.26`
and `win_rate 2/3 → 1.0`. **That fixture is the positive control for this null result.**

🛑 **WHAT I DID NOT MEASURE, STATED PLAINLY:** this is a **TEST** population, not a population of
**stored strategy artifacts**. I did **not** re-run historical strategies, so I cannot name
which persisted `win_rate` / `profit_factor` / Forge score / tier values would move if those
artifacts were recomputed. **`members whose win_rate changed = 0` is a statement about the
governed test population and nothing else.** If you want the artifact-level census, that is a
separate bounded unit and it needs a named strategy population.

### One pre-existing failure now says my name, and I did NOT silence it

`test_flag_off_parameterized_refusal.py::test_the_canonical_population_matches_its_committed_manifest_by_member`
**fails in BOTH trees** — it is in the baseline's 35. It is the freshness guard AR-1101 §6 asks
for, and it is **already drifting**: at baseline **9** files are in the derivation but not the
manifest (`test_source_vertical_join`, `test_source_trade_population`,
`test_source_band_c_vertical`, `test_source_faithful_execution_mode`,
`test_source_faithful_fvg_routing`, `test_source_population_grade_findings`,
`test_band_c_sizing_ingress`, `test_mp1_backtester_ingress`,
`test_producer_staging_vocabulary`). My new test file makes it **10**.

**I did not regenerate the manifest.** AR-1101 §6 says the canonical population *"may remain as
its historical instrument; do not casually mutate its denominator and erase comparability"* —
and regenerating it mid-unit would have changed the very denominator this census is measured
against, in the same commit that measures it. **The drift is pre-existing, it is load-bearing
for your §6 acceptance-coverage unit (D), and it is yours to sequence.**

⚠️ **A whole-directory run was attempted first and ABANDONED, honestly reported:** both trees
stalled at 9% for many minutes on an S3 refresh
(`missing AWS_ACCESS_KEY_ID` → cache-stale reload), so that measurement was never obtained.
**It is not evidence of anything and I am not quoting it.** The committed manifest is the
governed instrument in any case (`ACCEPT5-INSTRUMENT-1`, R-790 §6), which is why the census
below uses it rather than a hand-rolled directory sweep.

⚠️ **INSTRUMENT CAVEAT:** two pre-commit stash windows fired while the post-repair census was
running (`[precommit-stash]` — the hook stashes and restores). Failure membership came back
**identical to baseline in both directions**, so no result was silently altered by that window;
had the sets differed I would have re-verified the differing members individually rather than
trusting the diff.

---

## 7. WIDER CLASS — NOT CLOSED, AND I AM NOT CLAIMING IT IS

`grep` finds **16 non-test modules** computing something win-rate-shaped (`analytics`,
`walk_forward`, `paper_analytics`, `prop_survival_model`, `sanity_checks`, `parameter_evolver`,
`gate_block_analyzer`, `frankenstein_test`, `strategy_mapper`, `anti_setup_backtest`,
`decay/sub_signals`, `quantum_rl_agent`, `tensor_signal_model`, …).

I closed **the four engine sites plus the two verifiers**. I did **not** enumerate whether the
others mis-handle open positions — most consume the already-computed `win_rate`, but **that is a
HYPOTHESIS, not a measurement.** Per `[instance-not-condition]`: **`SIX SITES CLOSED`, not
`THE CLASS CLOSED`.**

**Correction to AR-1103's blast radius:** it named **3** sites. There are **4** —
`win_rate_per_trade` exists independently in **both** `run_backtest` (`:6306`) and
`run_class_backtest` (`:8806`). Your §1 independent inspection named only the class-path one, so
**this correction applies to your ruling too.**

---

## 8. MY OWN ERRORS THIS UNIT

1. **First fix was incomplete and appeared to work.** I added the split to the final envelope
   only; the verifiers receive the *prelim* dict built earlier, so the `cross_validation` repair
   did nothing until the fields were added there too. **My own new test caught it.**
2. **First discriminator could not go red** (§4).
3. **First legacy fixture produced zero trades** — `2×ATR` at `spread=5.0` is ~20pt, above the
   MES 14pt house ceiling, so every entry was skipped (`E.3 stop_ceiling_skips=2`). The fixture
   now documents why the spread is load-bearing.
4. **A standalone probe script bypassed the autouse flag fixtures** and died on a sizing
   validation error — the instrument was wrong, not the code.

---

## 9. STATUS

**`F3-REALIZED-LIFECYCLE-1`:** **COMPLETE** — implementation, all §5 discriminators except B
(unit-level, §5), both §5.F mutation controls, and the §6 census with zero governed-member
change. **Commits `85ac999c` + `e9406e36`** on `h1-wave4-sealed12-driver`.
**Not combined with** sVkm timeframe reconciliation, acceptance-manifest work, or any
performance run — all remain separate AR-1101 units, **C and D UNSTARTED**.
**No performance/edge backtest executed; none authorized.**

**Yours to rule:** (a) §5.B — bounded reachability probe, or accept unit-level; (b) §7 — whether
the remaining win-rate-shaped modules get an enumeration.
