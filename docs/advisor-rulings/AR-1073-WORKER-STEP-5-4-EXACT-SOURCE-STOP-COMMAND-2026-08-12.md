# AR-1073 — WORKER — **STEP 5+4 SECOND HALF: THE SOURCE STOP COMMAND IS NOW EXACT.** The ceiling clamp and the ATR substitution are both closed, and the mode reaches the stop through the whole chain. 🛑 **ONE FINDING CHANGED BEHAVIOUR ON MY OWN REASONING AND I WANT IT RULED ON (§3).**

```
RULING  : AR-1068 (gpt-rulings 06d63e2b) §7, §8
TREE    : C:\Users\tonio\Projects\wt-h1-wave4-20260712        [MEASURED HERE]
PIN OUT : d4e3b459   [MEASURED] pushed, re-read from origin
COMMITS : 32d39f4d STEP 5+4 second half · d4e3b459 SYSTEM-INVENTORY
FOLLOWS : AR-1072 (first half — the three overlay bypasses)
```

---

## 1. TWO SILENT MUTATIONS OF THE TAUGHT STOP, BOTH CLOSED

`_resolve_stop_risk_points()` had **two** ways to change the teacher's stop without saying so.
Both are §8's defect, and I had not seen the second one until I opened the function.

**(a) THE CEILING CLAMP.** `return min(float(distance), stop_ceiling), "structural"`.
Correct as a Trading Forge risk policy. **Wrong as source-strategy research**, because the stop
distance *is* the R unit: clamping it changes the risk distance, therefore the R multiple,
therefore the 2R target price, therefore the outcome — **silently, under a SOURCE_FAITHFUL
label.** §8: *"the exact source stop must remain the source stop… may not silently delete or
tighten the source trade."*
⇒ under `source_faithful` the exact distance survives, stamped **`"source_exact"`** rather than
`"structural"`, so a receipt can tell a taught stop from a house stop.

**(b) THE ATR SUBSTITUTION.** With no structural distance the function returned
`atr_fallback_points`. §7: *"no ATR fallback when a REQUIRED taught source anchor is missing."*
⇒ under `source_faithful` this **REFUSES**. ★ **A plausible wrong stop is worse than no stop,
because nothing downstream can tell it was invented.**

**Threading**, mirroring `structural_stop_map`'s own existing pattern, default `False` at every
hop so legacy is untouched:
`run_class_backtest → _apply_trade_management → {naked, stop_only, static_styleC, adaptive} → _resolve_stop_risk_points`

## 2. THE FLOOR NEEDED NO SECOND MECHANISM

§7 also forbids the **MES 6-point stop floor**. `[MEASURED]` it has exactly **one** call site, and
it is inside `_apply_dsl_stop_loss_and_time_stop` — **which AR-1072's E.3/E.5 bypass already makes
unreachable on the source arm.** So it is closed by a branch that already exists, not by new code.

**I pinned that with a test anyway**, because it is a **JOIN between two facts** ("the floor lives
in X" + "X is bypassed"), and a join rots silently when one side moves. The test fails if the floor
gains a second call site or migrates out of that function.

## 3. 🛑 THE FINDING — I CHANGED BEHAVIOUR ON MY OWN REASONING. RULE ON IT.

`BACKTEST_STRUCTURAL_STOP_PARITY_ENABLED` **DEFAULTS FALSE** `[MEASURED — the executable line
is `os.environ.get(..., "false")`]`. With it off, the structural branch never runs at all.

**Consequence had I left it alone:** every source-faithful run would fall straight through to my
new refusal — **the teacher's own stop would be unreachable by default and SOURCE_FAITHFUL would
be permanently inoperative.**

**Its documented purpose is to keep LEGACY backtests comparable** — "flipping it ON re-baselines
every backtest". **That reason cannot apply to a SOURCE_FAITHFUL artifact: it has no legacy
baseline to protect, and the taught stop is not an opt-in parity experiment — it IS the strategy.**

⇒ **I made `source_faithful` bypass the flag.** Legacy is still governed by it, and a test pins
**both** directions with the flag off: source-faithful reaches the taught stop; legacy still takes
the ATR fallback exactly as before.

★ **`A CORRECTNESS PATH GATED BEHIND A COMPARABILITY FLAG IS OFF, AND OFF IS THE DEFECT.`**

**This is the one place in this unit where I resolved an ambiguity by reasoning rather than by
citation.** AR-1068 does not mention this flag. **If you want the flag to keep governing the
source path, it is a one-line revert — but then SOURCE_FAITHFUL cannot run until the operator
sets an env var, which is precisely the env-only-global shape §7 objected to.**

## 4. PROOF

**23 tests** (was 12). ★ **`_resolve_stop_risk_points` is a PURE function**, so unlike the class
backtest these are **real behavioural proofs executed against production code with no market
data** — not the routing proofs AR-1072 had to settle for.

**Baseline first, then the change** — the clamp test asserts legacy still clamps `20.0 → 10.0`.
Without that, "source-faithful returns 20.0" proves nothing about what changed.

**Five more ablations, all biting:** re-apply the clamp on the source arm → 3 RED · restore the ATR
fallback → 1 · put the parity flag back in the way → 1 · stop passing the mode into trade
management → 1 · flip one engine's default to `True` → 1. **Restored: 23 passed.**

**A constant-return discriminator** asserts the source stop *tracks* the taught distance across
three values — without it, `return 20.0` would satisfy every other assertion.

**Regression, measured not assumed.** All **29** test files referencing any changed symbol:
**4 failed / 432 passed.** Baselined by swapping in the `HEAD` copy of `backtester.py`: **the same
4 failure names**, 409 passed. **Pre-existing.** The `+23` is this file.

## 5. A NEAR MISS I OWE YOU

Mid-verification I read **`grep -c` → 27** against **`str.count` → 36** for the same token and
briefly took it as evidence the file had lost content. **They measure different populations —
matching LINES versus substring OCCURRENCES.** I re-measured with one instrument: **sha256
identical, 468,296 B**, AST clean.

★ **`TWO NUMBERS FROM TWO INSTRUMENTS ARE NOT A DISAGREEMENT UNTIL THEY MEASURE THE SAME
POPULATION.`** It cost a minute here; the same shape has cost this campaign whole sessions.

## 6. WHAT IS STILL OPEN

- **The fixed-R TARGET command is still not consumed.** The stop is exact; the whole-position 2R
  target is not yet wired, which is why Style C still **refuses** rather than being replaced.
  **This is the last piece of UNIT 3.**
- **STEP 6 / UNIT 4 — UNSTARTED.** Still no class backtest executed, still no trade population
  measured. **Everything in AR-1072 and AR-1073 is WIRED, not EFFECTIVE.**
- **STEP 2B is still BUILT-UNREACHABLE** — nothing joins `source_entry_events.py` to this mode.
- **E.4 DLL halt** still suppresses source entries (AR-1072 §6a, unanswered).
- **AR-1070 §4** — the `displacement_candle_high` narrowing, still unanswered.
- **Entry timing (§9)** — untouched.

## 7. NEXT

The fixed-R target command, so the Style-C refusal can become a Style-C **replacement** and UNIT 3
closes — unless §3 or the two older open questions change the order.
