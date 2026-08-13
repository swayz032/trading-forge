# AR-1096 (worker) — YOUR §2 CORRECTION IS CONFIRMED BY MEASUREMENT, AND IT IS WORSE THAN STATED

**Governing:** AR-1095 §2, §3, §5, §6 · **Pin:** `055f7c69` · **Grade:** still running, not yet returned

---

## 1. I WAS WRONG, AND HERE IS THE MEASUREMENT THAT SAYS SO

AR-1094 §5 said the 1→15 contract swing "is not a defect and it is not mine." **The ownership
principle was right and the conclusion was wrong.** I reasoned from *"sizing is framework-owned,
therefore framework sizing running is correct"* and never asked the next question: **is the sizing
that ran the sizing that was ASKED FOR?** It was not.

`[MEASURED HERE @ 055f7c69]`

| fact | evidence |
|---|---|
| the persisted config carries an explicit fixed size | `test_source_band_c_vertical.py::_config()` → `strategy.fixed_contracts = 1` |
| `run_class_backtest` can consume it | `backtester.py:7251` `fixed_contracts: Optional[int] = None` |
| the Band C call site does **not** pass it | `backtester.py:9504` passes `strategy, start_date, end_date, slippage_ticks, commission_per_side, firm_key, skip_eligibility_gate, exit_engine, adaptive_ctx, source_risk_mode` — **`fixed_contracts` is absent** |
| so the fallback runs | `backtester.py:7538` `if fixed_contracts is not None: ... else: PositionSizeConfig(type="dynamic_atr", target_risk_dollars=500.0)` |

The sibling call at `:9340` omits it too. **`BAND-C-SIZING-INGRESS-1` CONFIRMED.**

★ **`A DEFAULT THAT RUNS BECAUSE AN INSTRUCTION WAS DROPPED IS INDISTINGUISHABLE, AT THE RESULT,
FROM A DEFAULT THAT RUNS BECAUSE IT WAS CHOSEN.`** I read the size off the trade record and asked
whether the *layer* was allowed to own it. I never joined it back to what the artifact *requested*.

---

## 2. TWO THINGS YOUR §2 DID NOT HAVE — BOTH MAKE IT STRONGER

### (a) 🛑 THE INGRESS DEFECT DISABLES THE GUARD BUILT TO CATCH EXACTLY THIS

`config.py:412` carries an H7 fail-fast validator, verbatim:

> *"Fail-fast if `fixed_contracts=1` … A silent `fixed_contracts=1` in production backtests means
> every strategy silently trades 1 contract regardless of account size, producing metrics that
> don't reflect actual risk exposure."*

It raises unless `TF_ALLOW_FIXED_1=true`. **It fires only on the `type="fixed"` branch — the branch
that is unreachable when `fixed_contracts` is dropped at the ingress.** So the guard against silent
sizing is itself silenced by the defect, and the run sails past it into `dynamic_atr`.

★ **`A GUARD ON THE BRANCH NOT TAKEN IS NOT A GUARD.`**

### (b) THE FIXTURE PROVES INTENT — IT SET THE FLAG TO PERMIT A MODE THAT NEVER RAN

`test_source_band_c_vertical.py::_production_flag_state` sets **`TF_ALLOW_FIXED_1=true`**. That flag
exists for one purpose: to permit `fixed_contracts=1`. **The fixture asked for the bypass of a guard
on a code path the ingress never reached.** The intent is therefore not inferred from the config
key alone — it is corroborated by a second, independent artifact.

---

## 3. 🛑 THIS IS THE SECOND INSTANCE OF ONE CLASS AT ONE CALL SITE — AND I OWE YOU THE CLASS

The comment **immediately below the missing argument**, at `:9504`, describes the previous instance
in the same words:

```
persisted source_risk.mode     OK
run_class_backtest can consume OK
Band C joins the two           MISSING
```

That was `SOURCE_FAITHFUL_EXECUTION_JOIN-1` (AR-1074 §3). **We fixed the instance and never
enumerated the condition**, which is a named conviction on this desk. `fixed_contracts` is the same
defect, at the same boundary, found ten ARs later by a sizing anomaly rather than by a sweep.

**`run_class_backtest` parameters the Band C call site does NOT pass** `[MEASURED, from the
signature at :7239]`: `data`, `fixed_contracts`, `htf_cache`, `daily_data`, `max_trades_per_day`,
`use_performance_gate`, `warmup_data`, `exit_policy`.

⚠️ **I am NOT claiming these are all defects.** Several are legitimately caller-supplied or
deliberately defaulted. The claim is narrower and I can defend it: **nobody has checked which of
them a persisted artifact can request and Band C silently discards.** That is `UNENUMERATED`, and
it is the condition behind both instances. **I am not opening that sweep** — your §5 is surgical and
`SWEEP-*` is closed — but a one-unit repair that leaves the class unnamed is how we get instance
three.

---

## 4. §3 PRIOR ART — SEARCHED, AND THE ANSWER IS "DELIBERATELY RETIRED, DO NOT REBUILD"

You said: *"Do not invent a broad new sizing subsystem if an existing persisted scaling-plan
contract already exists. Search and reuse prior art first."* Searched
`scaling_plan|sizing_plan|sizing_owner|position_size_config|requested_contracts` across `src/`.

**`firm_config.py:97` — `SCALING_PLANS: dict[str, list[dict]] = {}`, deliberately EMPTY.** R-059
(2026-07-19) removed it as **FICTION**, verified against Topstep's own published parameters: account
size is LOCKED to the Combine passed. Its comment carries a standing prohibition — *"Do NOT
repopulate with size-upgrade tiers — that regresses R-059."*

⇒ **There is no live persisted scaling-plan contract to reuse, and the absence is a RULING, not a
gap.** The real model per that same block: within-account micro-contract pyramid, cross-account
horizontal copy-scaling. **Anything I build for §3's `sizing_owner` / `sizing_mode` audit surface
must not become a size-upgrade ladder by another name.** Flagging before building, not after.

The live sizing contract that DOES exist is `PositionSizeConfig` (`config.py:365`) with its `type`
discriminator (`fixed` / `dynamic_atr` / `risk_derived_pyramid`) — **that is the thing to thread and
stamp, not a new subsystem.**

---

## 5. YOUR §6 EXIT-BAR RE-ENTRY BOUNDARY — ACCEPTED AS A REAL GAP IN MY MATRIX

You are right that `i <= occupied_until` silently decides an execution-ordering question. My P2
asserted the rejected event lies in `(entry, exit]` — **which encodes the `<=` convention rather
than testing it.** I asserted the behaviour I wrote. It is unproven, not proven, and I am not
claiming otherwise.

I will resolve it as your §6 requires — bounded test, explicit disclosed policy, fail-closed and
conservative if the bar model cannot order the close-vs-exit sequence, and **no intrabar
simulator.**

---

## 6. SEQUENCING — WHY I HAVE NOT STARTED EITHER UNIT

Your §7 orders the grade first, and **the independent `accuracy-validator` is still running against
pin `45e4ca84` in this worktree.** The grader is a WRITER on this desk `[named prior conviction]`,
and editing `src/` underneath a running grade would corrupt the measurement I asked it for.

**So everything above is READ-ONLY** — signatures, call sites, a validator body, a retired contract,
and one grep. No production file has been touched since `45e4ca84`.

On the grade's return: (1) inspect it, (2) close its findings + your §6 boundary, (3) close
`BAND-C-SIZING-INGRESS-1` against your six proof points, (4) re-run the F-4 three-trade fixture at
explicit normalized research size so the three trades are finally comparable.

**No performance claim exists and none is authorized. Pin `055f7c69`.**
