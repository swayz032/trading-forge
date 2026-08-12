# AR-1018 — WORKER REPORT — DISPOSITION 22 / 35 · 13 NODES ACCUSE PRODUCTION MATH · REPORTING EARLY PER §6

```
RULING : GPT ruling on AR-1017 (2026-08-12) §2 (continue the 17), §3 (STOP[44] join),
         §4 (prove xfail intent), §5 (do NOT classify from truncated reprs), §6 (report
         early if a PRODUCT_OR_ENGINE_DEFECT or UNEXPLAINED cluster appears).
PIN    : c59ee2a37a34f51e419166371fd3da523bef3595   map commit 0f478211
STATUS : 22 of 35 classified. 13 remain. Nothing repaired, nothing skipped, nothing
         xfailed, no seal, no census.
WHY NOW: §6 -- several of the remaining 13 accuse production/engine arithmetic. That
         is the trigger to report, not to keep going quietly.
```

**PRE-FLIGHT:** `advisor-ruling §0.-2`. `[MEASURED]` that skill is unmodified since commit `3e6c37e`
(`git log -1` + clean `git status` on the file), so the copy I hold is current — the re-invocation
rule's own rationale is staleness, and I checked for staleness rather than asserting freshness.

**METHOD, per §5:** every classification below comes from **re-running each failing file in its own
pytest subprocess** (the same one-process-per-file condition the promoted runner uses) and reading
the full traceback, **not** from the truncated `failure_reprs`. All 17 reproduced exactly:
`15 failed + 2 xfailed`, per-file counts identical to the canonical map.

---

## 1. NEWLY CLASSIFIED THIS UNIT — 4 NODES

### 1a. `test_session_role_adversarial_fence.py` — 2 nodes — `INTENTIONAL_NEGATIVE`

**§4 required proof that the xfail is intentional and current. Proven from source:**

```
:615  @pytest.mark.xfail(  ... reason: "...fence was authored FIRST (its preamble), so the
      direction is tuning-copied-from-fence... Tracked as a finding; strict xfail
      SELF-ALERTS when the contamination is removed."
:769  marks = [pytest.mark.xfail(strict=True,
      reason="pre-existing recognizer leak (finding, not a sub-packet-1 regression);
      see _KNOWN_FINDING_ROW_IDS")]
:115  # Pre-existing findings the fence CORRECTLY catches, tracked as strict-xfail
:762  """SCORED rows as params; the known pre-existing findings (B02) carry a strict
      xfail so the suite is green while the assertion stays UNCHANGED and alerts if..."""
```

**Both are `strict=True`** — so if the underlying condition were fixed, the node would go `XPASS`
and **fail the suite**. The marker is not a mute button; it is a live alarm pointed the other way.
The assertions themselves are unmodified. **Intentional: yes. Current: yes, by construction of
`strict`.** Production not implicated. No repair required.

### 1b. `test_production_hardening_g2a_g2b.py` — 2 nodes — `TEST_CONTRACT_DEFECT`

| field | value |
|---|---|
| nodes | `TestG2bClassifierErrorSourceContract::test_exception_handler_does_not_use_indeterminate_as_fallback`, `::test_exception_handler_sets_confidence_to_none` |
| causal root | **The test asserts a behavioural property with a raw source-text substring scan.** It does `inspect.getsource(run_walk_forward)`, finds the comment marker `"classifier CRASH must NOT"`, slices **600 characters**, and asserts `'"indeterminate"' not in exc_block`. |
| proof | `[MEASURED HERE]` inside that exact 600-char window: **executable lines containing `indeterminate` = `0`; COMMENT lines containing it = `2`.** The window's only executable content is `print(`. **The test is failing on comments that explain the very policy it is checking** — and its window does not even span the handler's executable body (`_rc_confidence` assignments in window: `0`). |
| production implicated? | **NOT ESTABLISHED — AND THIS BOUND IS LOAD-BEARING** (below). |
| repair required before closeout? | **NO.** |

🛑 **THE BOUND I WILL NOT CROSS:** this proves **the test cannot establish its claim**. It does
**NOT** prove the production behaviour is correct. **The G2b property — that the exception handler
assigns `classifier_error` rather than `indeterminate`, and sets `_rc_confidence = None` — is
currently UNVERIFIED BY ANY WORKING INSTRUMENT.** Converting *"the test is broken"* into *"the code
is fine"* is the exact widening `[never-flag]` forbids. **Recorded as an evidence gap, not as a
pass.** It does not block closeout (a dispositioned non-pass may remain non-pass), but it should
not be forgotten either.

---

## 2. THE REMAINING 13 — MEASURED, DELIBERATELY NOT YET CLASSIFIED

**§6 trigger: several of these accuse PRODUCTION/ENGINE arithmetic, not test scaffolding.** I am
reporting the measurements rather than assigning categories I cannot yet defend.

| # | node(s) | measured failure | first read |
|---|---|---|---|
| 4 | `test_pnl_accuracy.py` — commission contracts ×3 + `test_commission_per_trade_matches_formula` | **zero trades produced**: `assert 0 > 0`, `len(result["trades"]) == 0`. The tests refuse to pass vacuously by design. | root is *why the fixture yields no trades* — **fixture or engine, NOT yet determined** |
| 1 | `test_e2e_backtest.py::test_walk_forward_mode` | `assert 0 == 3`, `0 = len([])` | **plausibly the SAME zero-result root** as the 4 above — cross-file cluster, unproven |
| 3 | `test_parameter_jitter_battery.py` | `assert 2 >= 3` (n_windows) · **`IndexError: list index out of range` at `src/engine/parameter_jitter_battery.py:422`** · `assert 0.0 > 0.2` (rws) | **the IndexError is a crash inside PRODUCTION engine code**, not a test assertion |
| 2 | `test_accuracy_fixes.py` | `[499.0, -201.0, 349.0] == [500.0, -200.0, 350.0]` — **$1 deducted per day when commission rates MATCH**, in the test named `test_no_double_deduction_same_rate` · `BARS_PER_DAY["1min"]` is `860`, test expects `1380` (Globex) | first is **engine arithmetic on money**; second is a constant disagreement |
| 1 | `test_apply_trade_management_branching.py` | `Expected trail_stop >= BE (4000.0), got 3991.0` | break-even move on TP1 not applied, or test premise stale |
| 1 | `test_three_fixes.py` | `bar-level max_dd 210.65999999999622 >= 210.67000000000004 - 0.01` — **short by `0.0000000000038`** | a tolerance sitting exactly on a float boundary |
| 1 | `test_wave_b_intrabar_stops.py` | `expected exit at bar 5; got 3` | intrabar exit ordering |

⚠️ **NONE of these is classified yet, and I will not label them from a one-line read.** Three of
them (`$1` commission delta, the engine `IndexError`, the `BARS_PER_DAY` constant) are candidates
for `PRODUCT_OR_ENGINE_DEFECT` on surfaces that touch **P&L arithmetic**, which is why this report
exists now rather than after the remaining work.

## 3. §3 — THE `STOP [44]` `7`-VS-`4` JOIN: **UNENUMERATED**

`[MEASURED HERE]` I searched the ledger for the historical `7` PnL nodes. `R-826 §5` and its fields
state *"the `7` PnL nodes are `UNEARNED_GREEN`"* and *"The 7 PnL nodes stay UNEARNED_GREEN and
unadjudicated"* — **but neither line, nor any line I can find, ENUMERATES the seven node IDs.**

⇒ **Per §3[4] I mark the historical set `UNENUMERATED` and I do NOT use the number `7` as authority
over the current four.** The four current `test_pnl_accuracy.py` non-pass nodes will be
dispositioned on their own measured evidence. ★ `[unenumerated-ladder]`: **a count I cannot resolve
to named members is not a denominator.**

## 4. RUNNING TALLY

```
18  test_a_plus_gate_parity        TEST_CONTRACT_DEFECT   ACCEPTED (AR-1017 ruling §1)
 2  session_role_adversarial_fence INTENTIONAL_NEGATIVE   proven strict-xfail, this unit
 2  production_hardening_g2a_g2b   TEST_CONTRACT_DEFECT   proven comment-match, this unit
                                                          + an UNVERIFIED-PROPERTY bound
13  remaining                      measured, unclassified
--
35  total
```

## 5. STOPS

**None of §7's four has FIRED yet** — but #2 (`PRODUCT_OR_ENGINE_DEFECT` requiring a production
change) is **approaching**, and #1 (`UNEXPLAINED`) is possible for the zero-trade cluster if the
fixture-vs-engine question does not resolve within a bounded investigation.
§3's PnL join question is **answered, not stopped**: `UNENUMERATED`, and it does not change the
decision because I am not relying on it.

## 6. NEXT

Bounded causal investigation of the 13, largest cluster first (the zero-trade root spanning
`test_pnl_accuracy` + `test_e2e_backtest`). **If it resolves to a production defect, or does not
resolve, that is a STOP and it lands here before any census or seal work.**
