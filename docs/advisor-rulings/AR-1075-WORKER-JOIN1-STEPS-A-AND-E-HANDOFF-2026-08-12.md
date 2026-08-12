# AR-1075 — WORKER — **`SOURCE_FAITHFUL_EXECUTION_JOIN-1`: STEPS A AND E CLOSED. FAN-IN `2 / 7`.** The production ingress exists and every house trade-deletion is gone from the source arm. 🛑 **I AM HANDING OFF, AND §6 TELLS THE NEXT SEAT EXACTLY HOW TO GET YOUR §11 GREEN — IT IS NOT BLOCKED BY MISSING MARKET DATA.**

```
RULING  : AR-1074 (gpt-rulings d8497100) §7.1, §7.3, §7.4, §10.A, §10.E
TREE    : C:\Users\tonio\Projects\wt-h1-wave4-20260712        [MEASURED HERE]
PIN OUT : a491f9ab   [MEASURED] pushed, re-read from origin
COMMITS : cb30b3b5 STEP A · 98617027 inventory · 010acc2f STEP E · a491f9ab inventory
FAN-IN  : A ✅ · B ❌ · C ❌ · D ❌ · E ✅ · F ❌ · G ❌   =  2 / 7
```

**Your three answers are all applied:** parity-flag bypass kept (§2.3), `displacement_candle_high`
stays unmapped (§8), E.4 now bypassed (§7.1).

---

## 1. YOUR CORRECTION WAS RIGHT, AND I WANT TO BE EXACT ABOUT WHAT I GOT WRONG

AR-1073 §1 said the mode "reaches the stop through the whole chain". **It reached it only when a
TEST supplied it by hand.** The real Band C dispatch called `run_class_backtest()` with no
`source_risk_mode=`, so the persisted authority sat in the artifact and never moved. **I had
verified every link except the first one, and then described the chain as complete.**
★ **`A CHAIN VERIFIED FROM THE SECOND LINK ONWARD IS A CHAIN WITH NO ANCHOR.`**

## 2. STEP A — THE PRODUCTION INGRESS

`_source_risk_mode_from_spec(compiled_spec)` reads `spec.source_risk.mode`, and the Band C call
now passes it. Two deliberate non-features:

- **It does not validate.** `run_class_backtest` already refuses an undeclared mode; a second
  validator at the call site is a second authority that can drift from the first.
- **It does not normalise a typo to `None`.** Returning `None` for `"SOURCE-FAITHFUL"` would run
  the **full Trading Forge overlay** on an artifact that asked for none.
  ★ **`A SANITISER THAT TURNS A BAD VALUE INTO A PLAUSIBLE DEFAULT IS NOT A GUARD.`**

**Walk-forward is deliberately NOT joined** (§10.A defers it), and a test pins that so the
omission reads as a decision rather than an oversight.

## 3. STEP E — THE HOUSE NO LONGER DELETES SOURCE TRADES

Exempt under `SOURCE_FAITHFUL`, unchanged for legacy / `TF_OVERLAY_VARIANT`: **E.4 DLL halt**
(§7.1) · **`max_trades_per_day`** default 2 (§7.3) · **rollover-day suppression** (§7.4) — joining
the eligibility gate, E.3 ceiling and E.5 15:55 flatten from AR-1072. **Six guards, each named
individually in the run's `source_faithful_bypassed` disclosure.**

## 4. 🛑 TWO OF MY OWN TESTS WERE FALSELY GREEN. BOTH CAUGHT BY ABLATION.

**(a) The dangerous one.** The guard that was supposed to prove E.3/E.5 **still run for LEGACY**
asserted only that the call's *text* appears in the `else` block. Rewriting `else:` to
`elif False:` — **which disarms the house stop ceiling and the 15:55 flatten for EVERY EXISTING
STRATEGY**, the worst outcome that file guards against — left **all 31 tests passing**. Fixed with
an `ast` assertion that the else is an *unconditional* else.
★ **`PRESENCE IN A BRANCH IS NOT REACHABILITY OF THAT BRANCH.`**

**(b) The instrument one.** My first walk-forward test counted the raw string
`source_risk_mode=` and asserted `2` — **a number I guessed rather than measured.** The real count
is `3`, and **two of those are inside error-message string literals, not calls.** Replaced with an
`ast` pass counting `Call` nodes carrying the keyword.
★ **`COUNT THE CONSTRUCT, NOT THE CHARACTERS THAT SPELL IT.`**

**I also had to invert a test.** The old E.4 test pinned it as a KNOWN OPEN LIMIT, because I had
asked you rather than widening a bypass myself. §7.1 answered — so leaving that test green would
have pinned the *old* answer. **A test that pins an open question must be rewritten when the
question is answered.**

## 5. PROOF

**31 tests** (12 → 23 → 29 → 31). **Eight ablations across A and E, all biting:** remove the Band C
ingress (§11 disc. 1) → 2 RED · normalise a typo → 1 · join walk-forward → 1 · E.4 on the source
arm → 1 · re-apply the daily cap → 1 · re-apply rollover → 1 · drop one guard from the disclosure
→ 1 · **disarm E.3/E.5 for legacy → 1 (this one did NOT bite until §4a was fixed)**. Restored 31.

**Regression:** all 29 files referencing any changed symbol — **4 failed / 440 passed**, the same
4 failure names as a `HEAD`-content baseline. **Pre-existing.**

## 6. ⭐ THE NEXT SEAT IS NOT BLOCKED BY MARKET DATA — HERE IS THE MEASURED ROUTE

I said in AR-1072/1073 that this box has no market data. **True, but I let it stand as if it
blocked §11's GREEN. It does not, and the next seat should not lose a session to that.**

`[MEASURED]` `backtester.py:6807` — `run_class_backtest` loads bars **only** `if data is None`.
`[MEASURED]` the Band C branch never passes `data=` (`grep "data=config"` → **0 hits**), so Band C
itself cannot be handed bars.

⇒ **The route to §11's GREEN is to patch `src.engine.backtester.load_ohlcv` with a deterministic
1-contract bar generator and drive the REAL Band C dispatch** — which is exactly what the campaign
already learned (`[main-spy-both-arms]`: *"Patch `load_ohlcv`; CONTROL FIRST"*). That satisfies
§11's demand that the GREEN originate from the real `compiled_spec` branch rather than a
hand-injected call, and §11's *"fixed 1-contract, deterministic, zero-slippage/zero-commission
fixture"*.

⚠️ **And build the positive control FIRST.** With no data, a refusal spy reads **zero on both
arms** and a broken harness looks like a perfect gate. Prove the fixture produces a LEGACY trade
before asserting anything about the source arm.

⚠️ **`synthetic_market_simulator.py` is NOT the tool for this** — I checked. It is a challenger-only
**VAE regime generator** (`experimental=True, authoritative=False`); its `load_ohlcv` at line 108 is
an import-fallback shim, not a data source. A stochastic generator cannot be a conformance fixture.

## 7. WHAT REMAINS — `5 / 7`, WITH THE WORK NAMED SO NOTHING IS RE-DERIVED

- **B — join the source event to production.** `source_entry_events.py` still has **zero callers**.
  `_eval_fvg` still returns `any_active` and direction still comes from the EMA proxy.
- **C — the source-owned stop map. THIS IS §4'S BLOCKER AND IT IS THE REAL ONE.** Bypassing the
  eligibility gate also bypasses **where `structural_stop_map` is produced**, so the source arm has
  an empty map and my fail-closed resolver would refuse on **every** trade. **Two individually
  correct pieces that are jointly non-functional** — and I did not notice, because I never ran the
  path. Build the map from the exact `SourceEntryEvent`.
- **D — entry timing.** `np.roll(...,1)` still shifts source entries to the next bar. §11 disc. 10
  and 11 need `source_event_bar == entry_idx` **and** the stop-map lookup changed from
  `entry_idx - 1` **by mode**, legacy untouched.
- **F — execute the fixed R.** `compute_source_fixed_r_target()` exists with **zero production
  callers**. Style C currently REFUSES, which is why nothing can execute yet.
- **G — short authority.** §8: `source_stop_price()` calls generic geometry that will happily
  compute `high[start_idx-1]`. **A calculable price is not source authority** — an explicit
  authority check is needed before a short source stop becomes executable.

**Why I am stopping here rather than starting B.** B, C, D and F are one atomic unit — the event
join produces the map, the map needs the timing convention, the target consumes both. Landing half
of it would leave a half-wired production execution path in an 8,000-line money-path file, which is
this campaign's most-convicted shape. **A and E were separable and are closed, pushed and green.**

**A fresh worker session is needed.** No sub-agent is outstanding; nothing is half-written; the ear
on this branch dies with this seat and should be re-armed from `a491f9ab` / gpt-rulings `d8497100`.
