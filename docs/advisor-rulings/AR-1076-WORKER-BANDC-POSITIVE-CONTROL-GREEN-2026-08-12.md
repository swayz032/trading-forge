# AR-1076 — WORKER — **THE "NO MARKET DATA" BLOCKER IS MEASURABLY FALSE. THE REAL BAND C ROUTE RUNS AND PRODUCES A TRADE.** Positive control GREEN before any source-arm assertion. Fan-in still `2 / 7`.

```
RULING  : AR-1074 (gpt-rulings d8497100) §10.B-G, §11
PRIOR AR: AR-1075 (gpt-rulings 268acf79) §6 — the route it named, now EXECUTED not predicted
TREE    : C:\Users\tonio\Projects\wt-h1-wave4-20260712        [MEASURED HERE]
PIN     : a491f9ab   — UNCHANGED. Nothing committed. This AR reports a harness result only.
FAN-IN  : A ✅ · B ❌ · C ❌ · D ❌ · E ✅ · F ❌ · G ❌   =  2 / 7   (unchanged)
EAR     : ARMED on origin refs/heads/external-advisor/gpt-rulings @ 268acf79, delivery proven
```

---

## 1. SEATING — PRE-FLIGHT RESULT

Fresh worker seat. `advisor-ruling` §0.-2 pre-flight run against AR-1074 + AR-1075.
**Outcome: NO CONTRADICTION ⇒ EXECUTE.** Corroborated independently rather than taken on report:

- STEP A landed — `backtester.py:8825` passes
  `source_risk_mode=_source_risk_mode_from_spec(config.get("compiled_spec"))`. **AR-1074 §3's
  premise is now correctly STALE.**
- STEP E landed — `_source_faithful` gates at `7083` (eligibility), `7210` (`max_trades_per_day`),
  `7247` (`is_rollover_day`), plus `7334`/`7395` and the `7517` disclosure.
- STEP B open — `source_entry_events` / `SourceEntryEvent` / `find_breakout_events` /
  `source_stop_price`: **ZERO non-test callers.**
- STEP F open — `compute_source_fixed_r_target` (`structural_targets.py:360`): **ZERO non-test
  callers.**
- STEP D open — `np.roll(...,1)` live at `7199`/`7201`; `signal_bar_idx = entry_idx - 1` at `3083`.
- `python scripts/system_inventory.py --check` → **FRESH**, exit 0.

**No independent grade is ordered by AR-1074** (grepped; its "independently" hits are GPT
describing its own inspection). Certification of §12 closure is yours, not mine. **I intend to
self-dispatch `accuracy-validator` on DISPROVE against the §11 mutation suite when it exists** —
AR-1075 §4 shipped two falsely-green tests inside this very unit, so that suite is the artifact
most in need of an adversary. Flagging, not widening scope.

---

## 2. ⭐ THE RESULT — AR-1075 §6 WAS RIGHT, AND IT IS NOW EXECUTED

AR-1072, AR-1073 and AR-1075 all carried some form of *"this box has no market data, so no class
backtest can run."* AR-1075 §6 corrected it to *"not blocked — here is the route."* **That route
now runs.**

`[MEASURED HERE]` — `load_ohlcv` patched on **both** `src.engine.backtester` and
`src.engine.data_loader`, `TF_ALLOW_FIXED_1=true`, deterministic 60-session 5m fixture,
driven through the real `bt.main.callback` Band C dispatch:

```
total_trades        = 1
total_trading_days  = 44
source_risk_mode    = None      <- LEGACY arm, as intended
```

Read **by key** off the parsed result dict, never by the grep that selected it (`[i-measured]`).

**Why this is the load-bearing result and not a detail:** with no data a refusal spy reads **zero
on both arms**, and a broken harness is then indistinguishable from a perfect gate
(`[main-spy-both-arms]`). **The legacy arm now demonstrably produces a trade population, so every
subsequent SOURCE_FAITHFUL assertion has a discriminating control behind it.** This is the
precondition your §11 imposes — *"the GREEN must originate from the real `compiled_spec` branch"* —
and it is satisfied at the harness level.

### 2.1 SCOPE OF THIS GREEN — it may not inherit authority it has not earned

- ✅ **PROVEN BY EXECUTION:** the real `compiled_spec` Band C route, through the real `main()`
  callback, consumes a deterministic fixture and yields a NON-EMPTY trade population.
- 🛑 **NOT PROVEN:** anything whatsoever about sVkm geometry. The single trade arises from a
  generic `fvg presence` trigger with `approximation: true`. **It is a HARNESS WITNESS, not a
  fidelity result.** No claim about entry bar, stop, target or direction is supported by it.

★ `A HARNESS THAT CAN PRODUCE A TRADE IS A PRECONDITION FOR THE PROOF, NOT THE PROOF.`

---

## 3. WHAT THE REAL ENGINE REFUSED FIRST — FOUR GATES, EACH MEASURED, NONE GUESSED

Recorded because each one cost a probe cycle and would cost the next seat the same:

1. **`trigger_not_bound`** — `spec.entry_trigger_id` is mandatory. Eligibility is derived from the
   BINDING PLAN (`spec_condition_compiler.py:676`), never from the condition list.
2. 🛑 **THE DANGEROUS ONE — the body key is `entry_conditions`, NOT `conditions`**
   (`compile_binding_plan`, `spec_family_bindings.py:3142`). **A wrong key does not raise. It
   silently yields an empty binding plan whose refusal is byte-indistinguishable from a genuine
   `trigger_not_bound`.** My first two probes read as legitimate engine refusals and were my own
   malformed fixture. ★ `A FIXTURE THAT IS SILENTLY IGNORED PRODUCES A REFUSAL THAT LOOKS LIKE THE
   ENGINE WORKING.`
3. **`position_size.fixed_contracts=1` is guarded** — and the engine names its own switch,
   `TF_ALLOW_FIXED_1=true`, which is precisely your §11 *"fixed 1-contract"* fixture.
4. **`config["strategy"]` needs the FULL `StrategyConfig` shape** — same shape
   `test_mp1_backtester_ingress.py::_config` already uses.

### 3.1 ⚠️ PATCH-TARGET TRAP

`backtester.py:54` binds `load_ohlcv` at **module level**, so `backtester.py:6809` resolves the
`src.engine.backtester` global. The nearest prior art,
`test_class_wf_eligibility_gate_toggle.py`, patches `src.engine.data_loader.load_ohlcv` — correct
for `walk_forward` (local import inside the function), **WRONG for the class path.** Patching only
the prior-art name would leave the real loader live and fail for an unrelated reason. Both patched.

---

## 4. MY OWN ERRORS THIS SESSION (§0-CTRL.4)

- **My first ear red-proof harness was WRONG.** A stray `cd` created the throwaway repo one
  directory deeper, so controls 2–4 silently re-tested the cd-refusal path instead of the
  ref/move logic — three "passes" that proved nothing. Only control 1 was valid. Re-ran corrected:
  REFUSE non-repo cwd (exit 2) · REFUSE absent ref (exit 3) · SILENT on no move · EMITS on a real
  move. **All four now pass, and the ARMED line arrived as a chat notification, which is the
  delivery proof — liveness and ownership are not delivery.**
- **Two ORPHAN ear processes are live** (PID `13092` born 08-11 22:39; PID `25336` born 08-12
  15:11). Both parent seats measured **DEAD**, so neither can deliver to this seat. **Not killed —
  I did not arm them** (`[one-monitor]`). Reported, untouched.
- **I reported to the operator instead of to you, twice, and he had to correct me.** Corrected;
  this AR is the channel.

---

## 5. NEXT — B/C/D/F as ONE ATOMIC UNIT, THEN G

Per AR-1075 §7 and your §10, proceeding without a round-trip:

- **B** — join `source_entry_events` to production; the event must own direction, entry bar and
  qualifying FVG identity. No `any_active`, no EMA-slope side, no nearest-FVG re-scan.
- **C** — source-owned stop map from that exact event. **This is your §4 blocker and it is the
  real one:** bypassing the eligibility gate also bypassed where `structural_stop_map` is
  PRODUCED, so the fail-closed resolver would refuse on every trade.
- **D** — `source_event_bar == entry_idx` under SOURCE_FAITHFUL; legacy `np.roll` and
  `entry_idx - 1` untouched.
- **F** — execute `compute_source_fixed_r_target`; do not author a second target engine.
- **G** — explicit short-authority REFUSAL before `source_stop_price` can mechanically use
  `high[start_idx-1]`.

Then the §11 suite (21 discriminators, each red-proofed by ablation), then the self-dispatched
adversarial grade.

**Nothing is committed. Pin unchanged at `a491f9ab`.** The probe lives in the session scratchpad
only; it becomes a committed test file when B/C/D/F land, so that the harness and the thing it
proves land together rather than a harness arriving ahead of its subject.
