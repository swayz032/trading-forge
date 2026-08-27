# ALGO-187 — **BOTH §4 OBLIGATIONS DISCHARGED.** The run is launched.

**Strategy head:** `ffd213ae` — pushed, remote-verified. **PR #38: DRAFT / DO NOT MERGE.**
**Semantic files modified: NONE.** Proofs and runners only.
**The backtest is RUNNING under ALGO-186's authorisation.** No result exists yet; this report is
the discharge of the two obligations that gate it.

---

## 1. OBLIGATION 1 — INDEPENDENCE. **PROVEN, and a grep would not have found the finding.**

**The module set is DERIVED, not listed:** the transitive closure of `research.*` imports from
`current_mnq_strategy_v2_4_kernel` — **20 modules**, printed so the population is auditable. *A
module cannot escape the audit by being absent from someone's list.*

| kind | n |
|---|---|
| MODULE ATTRIBUTE ASSIGNMENT | 4 |
| MODULE-LEVEL MUTABLE | 9 |
| **WRITE INTO A MODULE-LEVEL OBJECT** | **1** |

The 4 attribute assignments (`engine_final:42/43`, `engine_runtime:187/188`) monkeypatch
`zone_state_at` and `run_day` onto imported modules **at import time** — once per process, identical
in every process. **No search for `global` would have found them.**

**🛑 THE ONE LIVE CANDIDATE: `_HTF_CACHE`, keyed on `id(bars5)` — A MEMORY ADDRESS.** CPython reuses
addresses after garbage collection, so a freed frame's address could return **another frame's 15m
bars**. It is also never evicted. **That is a latent correctness hazard in its own right and it is
NOT introduced by parallelism.**

**BUT IT IS UNREACHABLE HERE — proven by call count, not by a clean sample:**

```
gold_zone_state_at   (owns the cache)      0 calls   over 2 full sessions
levels.zone_state_at_v24                   23,451 calls
_HTF_CACHE entries afterwards              0
```

The v2.4 kernel resolves its lifecycle through `zone_state_at_v24`; the patched
`base.zone_state_at` is **not on this path at all**. *"Zero entries over two sessions" would have
been a sample. Zero calls on the function that owns the cache is a statement about the path, and
holds for 1,925 sessions exactly as for 2.*

⇒ **The set of LIVE shared mutable state on the run path is EMPTY.**

**The `id()` keying is reported as a standing hazard for whoever next routes a v2.2 path through
`gold_zone_state_at`. No repair proposed — it is not on the authorized path.**

## 2. OBLIGATION 2 — DETERMINISM. **PROVEN BY KEY.**

```
ARM 1 - same session, TWO SEPARATE PROCESSES
  candidates 11 vs 11 · sha cbc462c788da10e0 vs cbc462c788da10e0 · IDENTICAL BY KEY: True

ARM 2 - solo versus the same sessions inside a 4-way pool
  2026-03-30  11 vs 11  True      2026-04-02  30 vs 30  True
  2026-04-06  19 vs 19  True      2026-03-31  19 vs 19  True

  4 sessions sequentially 433.9s | in a 4-way pool 165.0s | speedup 2.63x
```

**Compared by key — setup, direction, signal time, confirmed time, location id and source, plus the
plan fields — never a count.** Two separate processes rather than two calls in one, because a
same-process repeat shares every import and any warm cache, so agreement would be **guaranteed by
construction rather than earned**. Vacuity guard on every arm.

## 3. THE RUN, AND THE NUMBERS BEHIND THE WORKER COUNT

**Measured on the FULL dataset before launching, not extrapolated from the replay lab:**
`37.8 s/session` → **`20.2 h` sequential.**

| | |
|---|---|
| cores | 16 |
| RAM free | 13.9 GB |
| frames per worker | **0.14 GB** — memory is not the binding constraint |
| **workers chosen** | **8, not `cpu_count()-2` = 14** |

**The cap is deliberate.** 14 would fit. **This machine has a recorded history of freezing under
real workload, the operator uses it while this runs, and a run that wedges the tower at hour three
costs more than the hour it saves.** Expected ≈4 h against 20.2 h sequential.

## 4. TWO THINGS DECLARED BEFORE ANY NUMBER EXISTS

**A DEPARTURE FROM THE CANONICAL RUNNER.** `run_backtest` → `run_day` requires a **sealed dataset
env** (`contract_by_session`, `adjustment_by_session`, `dataset_manifest`) that does not exist for
this ratio-adjusted continuous series. This runner calls `_analysis_run_day`, the layer beneath.
**The difference is that `run_day` additionally de-adjusts analysis prices back to raw per-contract
prices for execution provenance — a price-LABELLING step that changes no gate, no signal, no entry,
no exit and no R.** Raw per-contract prices would need the sealed dataset and are a different run.

**SESSIONS THAT RAISE ARE RECORDED, NEVER DROPPED.** A dropped exception is a silently smaller
population whose count still looks plausible.

**The MAE rule and the §6 report fields are implemented from ALGO-186 and were committed BEFORE the
run** — including the control that can **refuse** a drawdown number rather than caveat it: *if a
winner appears in the stop family, the clamp's premise is wrong and no drawdown figure is
published.*

**No branch is claimed. No result exists.**

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this packet.*
