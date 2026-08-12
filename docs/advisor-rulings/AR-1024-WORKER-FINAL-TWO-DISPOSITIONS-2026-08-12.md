# AR-1024 — WORKER — THE FINAL TWO NODES ARE BOTH `TEST_CONTRACT_DEFECT` · ZERO `UNEXPLAINED` · MAP RECEIPT DURABLE · AND THE CENSUS STEP IS BIGGER THAN IT READS

```
RULING : AR-1023 GPT ruling, gpt-rulings a10b7595
PIN    : 858506cf  (PUSHED; origin/h1-wave4-sealed12-driver resolves it)
STATUS : §6 step 1 DONE · step 2 DONE (34/34 dispositioned, 0 UNEXPLAINED)
         §4 STOP RULE does NOT fire -- neither node implicates production.
         step 3 (census backfill) NOT STARTED -- scope disclosure in §4.
```

## 1. `test_e2e_backtest::TestE2EBacktest::test_walk_forward_mode` = `TEST_CONTRACT_DEFECT`

**Observed failure:** `assert len(result["windows"]) == 3` → `assert 0 == 3`.

**Test premise:** that `run_walk_forward(request, data, n_splits=3)` returns three per-window records.

**Production behaviour at the causal seam** `[MEASURED HERE]` — `src/engine/walk_forward.py`, the
executable line and its own comment:

```python
# FIX 3 (2026-06-22): Default changed from "plain" to "cpcv".
# Priority: explicit wf_mode param > WF_MODE env > "cpcv" (new default)
os.environ.get("WF_MODE", "cpcv")   # FIX 3: default changed plain->cpcv
```
and at the CPCV return site:
```python
"windows": [],
# deep-scan Backtest F-2: CPCV has no per-WINDOW structure (windows=[]), but it DOES have ...
```

Measured return: `wf_metadata = {'mode': 'cpcv', 'n_folds': 6, 'n_paths': 15, ...}`, `windows = []`.
**The splitter itself is not broken:** `split_walk_forward_windows(data, 3, 0.7)` returns **3**
windows when called directly. The empty list is CPCV's documented shape, not a failure to split.

**DISCRIMINATING CONTROL** — the only variable is the mode:
```
WF_MODE=cpcv    mode=cpcv    len(windows)=0    test would PASS: False
WF_MODE=plain   mode=plain   len(windows)=3    test would PASS: True
```
Under `plain`, **all three of the test's assertions pass**, including `oos_metrics.total_return`
and `sharpe_ratio`.

⇒ **The test encodes the pre-2026-06-22 `plain`-mode contract and was never updated when the
production default became CPCV.** **Production implicated: NO. Production change required before
R3-4 closes: NO.**

★ **`THE TEST DID NOT ROT; THE CONTRACT MOVED UNDER IT AND LEFT IT ASSERTING A SHAPE PRODUCTION NO
LONGER PROMISES.`**

## 2. `test_three_fixes::TestWFIntraMaxDD::test_equity_bars_key_present_in_backtest_result` = `TEST_CONTRACT_DEFECT`

**Observed failure** (the node's own convicting output):
```
AssertionError: Bar-level max_dd=210.66 should not be less than daily_dd=210.67
assert 210.65999999999622 >= (210.67000000000004 - 0.01)
```

**Test premise:** bar-level max drawdown must be `>=` daily-close max drawdown, **within one cent**:
```python
assert bar_dd >= daily_dd - 0.01
```

**Production behaviour at the causal seam** `[MEASURED HERE]` — the two series are accumulated at
**different precisions**:
```
daily PnL is rounded to 2dp at five sites:  round(float(p), 2) · round(pnl, 2) · round(net_pnl, 2) ...
equity_bars is NOT rounded:                 "equity_bars": equity.tolist()
```
So `cumsum(daily_pnls)` is a sum of cent-quantised values while `equity_bars` is the raw intrabar
equity path. A sub-cent-to-cent divergence between them is expected, **and the test's author
anticipated it — that is what the `0.01` tolerance is for.**

**The arithmetic, exactly:**
```
gap (daily_dd - bar_dd)          = 0.010000000003827836
tolerance                        = 0.01
|gap - 0.01|                     = 3.83e-12
shortfall past tolerance         = 3.836930773104541e-12
```
**The gap is exactly ONE 2dp quantum, and the tolerance is exactly ONE 2dp quantum.** The
comparison therefore sits precisely ON its own boundary, where IEEE-754 representation alone
decides pass/fail — and it loses by `3.8e-12`.

⇒ **`TEST_CONTRACT_DEFECT`: a tolerance set exactly equal to the quantum it exists to absorb is not
a tolerance.** The correct form is a strictly larger epsilon or `math.isclose`. **Production
implicated: NO** (no drawdown inversion — the property holds to within the rounding quantum the
test itself declares acceptable). **Production change required before R3-4 closes: NO.**

⚠️ **RESIDUAL I AM REPORTING RATHER THAN ABSORBING, and it is a MECHANISM claim so it carries its
grade:** I showed the rounding seam **exists** (rounded daily vs unrounded bars) and that the gap
**equals** one quantum. I did **NOT** prove the gap arises *solely* from that seam — I did not
reconstruct both series and attribute the cent. **`HYPOTHESIS / UNPROVEN` on causation; MEASURED on
the seam's existence and on the boundary arithmetic.** It does not change the disposition, because
the disposition rests on the tolerance-vs-quantum identity, not on the cause of the cent.

★ **`I ALSO RECORD A HARNESS FAULT: my first attempt to reconstruct this test's inputs failed
(exit 1). I did not report a null from it. The numbers above come from the node's own failure
output — the convicting instrument, fewest layers.`**

## 3. §6 STEPS 1-2 COMPLETE

**Step 1 — durable map receipt on the ENGINEERING branch:** `858506cf`, pushed, origin-resolvable.
`docs/designs/ACCEPT5-POSTREPAIR-AUTHORITY-MAP-RECEIPT-2026-08-12.md` carries pin, the
`2420 / 2386 / 32 / 2 / 34` counts, exact pre/post movement, the exact new boundary-test node ID,
and **the full 34-node non-pass set by exact ID**.

**Step 2 — all 34 dispositioned, ZERO `UNEXPLAINED`:**

| count | file | disposition |
|---:|---|---|
| 18 | `test_a_plus_gate_parity.py` | `TEST_CONTRACT_DEFECT` |
| 4 | `test_pnl_accuracy.py` | `TEST_CONTRACT_DEFECT` (3 golden fixtures + 1 commission formula) |
| 2 | `test_accuracy_fixes.py` | `TEST_CONTRACT_DEFECT` |
| 2 | `test_production_hardening_g2a_g2b.py` | `TEST_CONTRACT_DEFECT` |
| 2 | `test_parameter_jitter_battery.py` | `TEST_CONTRACT_DEFECT` (key collision · `rws_failure_blocks`) |
| 2 | `test_session_role_adversarial_fence.py` | `INTENTIONAL_NEGATIVE` (strict xfail) |
| 1 | `test_apply_trade_management_branching.py` | `TEST_CONTRACT_DEFECT` (accepted, `AR-1023` §3) |
| 1 | `test_wave_b_intrabar_stops.py` | `TEST_CONTRACT_DEFECT` (accepted, `AR-1023` §3) |
| 1 | `test_e2e_backtest.py` | `TEST_CONTRACT_DEFECT` (§1 above) |
| 1 | `test_three_fixes.py` | `TEST_CONTRACT_DEFECT` (§2 above) |
| **34** | | **0 `UNEXPLAINED` · 0 production mutations owed** |

**`§4` STOP RULE does not fire. Neither open node implicates production.**

## 4. 🛑 SCOPE DISCLOSURE ON §6 STEP 3 — THE CENSUS IS NOT A TABLE EDIT

**I have not started it, and I am flagging its size before anyone budgets it as bookkeeping.**

`[MEASURED HERE]` the census is `docs/designs/ACCEPT5-SKIP-CENSUS-1-2026-08-11.md`, **702 lines**,
and its `32` rows are **`pytest.skip` SITES — a different population from the 34 non-pass nodes.**
Do not conflate them.

Its state:
```
Cluster A  rows 13/15/17  LANDED  (census §10, four controls executed)
Cluster D  rows 19/21/24  LANDED  (census §11)
Cluster F  rows 22/23     LANDED  (census §12)
Clusters B/C/G  rows 2-12, 25-29  STILL CARRY THE RETIRED SINGLE BOOLEAN
```
Each landed cluster's `PROOF_RECEIPT` is **executed controls**, not prose — cluster A's is four
controls plus a population-effect re-derivation. **Backfilling B/C/G to the same contract is
~16 rows of the same kind of work**, and `AGENT-REPORTS.md:1943` already records it as an **OPEN
DEBT scheduled by `R-820`'s `ACCEPTANCE` after `E`** — i.e. it is a known, previously-deferred lane,
not a formality that fell out of this repair.

⇒ **I am NOT going to open it at the tail of a long session and hand back a half-filled census.**
A partial census that reads as complete is the exact shape this campaign convicts most often.

## 5. LIMITATIONS

- **Census 32 not started; no successor seal; no canonical closeout; R3-4 NOT closed.**
- The 32 `TEST_CONTRACT_DEFECT` dispositions in §3 are **not all mine** — 30 were carried from
  `AR-1018`/`AR-1021` and accepted by prior rulings; I measured only the 4 named in §1, §2 and
  `AR-1023` §6-7. **I did not re-verify the other 30 in this session.**
- The causation residual in §2 is `HYPOTHESIS / UNPROVEN`, stated inline.
- No independent grader dispatched — `AR-1023` §5 requires none.

★★★★★ **`THE R3-4 DENOMINATOR IS NOW CLOSED AND EVERY ROW HAS A NAME. WHAT REMAINS IS NOT
ADJUDICATION -- IT IS A DEFERRED CENSUS LANE THAT WAS ALREADY OWED BEFORE THIS REPAIR EXISTED.`**
