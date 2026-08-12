# AR-1017 — WORKER REPORT — DISPOSITION OF THE FINAL 35, IN PROGRESS (18 / 35)

## 0. PROCESS FAILURE FIRST — WHY THIS REPORT IS LATE

🛑 **I did disposition work after the `AR-1016` ruling and reported it ONLY IN CHAT. It never
reached this branch. GPT was correct that no report had arrived.** The operator's 2026-08-12 order
routes reports here precisely so that chat is not the record, and I violated it on the very next
work unit by treating "told the operator" as "delivered."

★★★★★ **`A REPORT THAT EXISTS ONLY IN CHAT HAS NOT BEEN DELIVERED — AND THE SEAT THAT WROTE IT IS
THE LAST ONE WHO CAN TELL.`**

**Correction applied:** an interim report lands here at each disposition milestone, not only at the
end of the authorized route. Nothing below is new work invented for this report; it is the work
that was already done and was sitting undelivered.

```
RULING : GPT ruling on AR-1016 (2026-08-12) §3-§4 -- disposition of the exact 35
         non-pass nodes, fixed vocabulary, root-cluster efficiency rule.
         Pre-flighted with advisor-ruling §0.-2 (second invocation this session --
         I had edited that skill, so my copy of it was stale by its own rule).
PIN    : c59ee2a37a34f51e419166371fd3da523bef3595 (map commit 0f478211, on origin)
STATUS : DISPOSITION IN PROGRESS -- 18 of 35 classified, 17 remaining.
         No seal. No census. No canonical closeout. Nothing repaired.
CHANGED: nothing in the repo this unit. Classification only, as §3[7] requires.
```

## 1. CLUSTER 1 — 18 NODES, ONE ROOT, CLASSIFIED

| field | value |
|---|---|
| **nodes** | 18 (all of `src/engine/tests/test_a_plus_gate_parity.py`) |
| **category** | `TEST_CONTRACT_DEFECT` |
| **causal root** | The tests import `_apply_a_plus_confluence_gate` and `_compute_rolling_volume_mean` from `src.engine.backtester`. **Neither symbol has ever existed** — not in that file, not anywhere in the repo, not at any point in its history. The failures are collection-time `ImportError`s, not assertion failures. |
| **durable proof receipt** | `R-694` (commit `0e17d13f`), ruling on `AR-771 §4`, ledger line 13585 |
| **production implicated?** | **NO.** Nothing was removed or regressed; the API never shipped. |
| **repair required before R3-4 closes?** | **NO.** |

**Evidence, `[MEASURED HERE]` at pin `c59ee2a3`, independent of the prior ruling:**

```
grep -n '_apply_a_plus_confluence_gate|_compute_rolling_volume_mean' src/engine/backtester.py
   -> no matches
POSITIVE CONTROL (same file, same instrument): 459,767 bytes, 52 top-level def/class
grep -rln '_apply_a_plus_confluence_gate' --include=*.py src/ scripts/
   -> src/engine/tests/test_a_plus_gate_parity.py     (the test itself, and nothing else)
git log -S'_apply_a_plus_confluence_gate' -- src/engine/backtester.py
   -> EMPTY: the symbol was never in that file, in any commit
git log -S'def _apply_a_plus_confluence_gate' --all
   -> EMPTY: never defined anywhere, ever
```

**PRIOR ART, and it is the authority here rather than my re-derivation** (`[prior-art-check]`):
`R-694` already confirmed this on a **second instrument** — *"`AR-771 §4`'s headline — **18** of the
30 assert against an API that never existed — CONFIRMED ON A SECOND INSTRUMENT … `def
_apply_a_plus_confluence_gate|def _compute_rolling_volume_mean` → **0** matches"* — with its own
positive control (`def run_backtest` → `backtester.py:3625`) proving the zero came from a tool that
demonstrably finds definitions. **Its `18` joins exactly to the `18` non-pass nodes in this file at
this pin.** I cite it and proceed; I did not re-adjudicate it.

⚠️ **BOUNDED:** this classifies **why the nodes are non-pass**. It does **not** decide whether the
A+ confluence gate *should* exist as a product feature. That question is untouched and is not
mine — it is not a blocker to `R3-4` closeout under `§7` (a stable, fully-dispositioned failure may
remain non-pass).

## 2. REMAINING — 17 NODES, NOT YET CLASSIFIED

**I have NOT looked at these yet. No provisional categories are offered**, because `§4` forbids
`probably legacy` / `seems expected` and a guess recorded now would be read later as a finding.

```
4  test_pnl_accuracy.py                       (see the STOP [44] note below)
3  test_parameter_jitter_battery.py
2  test_accuracy_fixes.py
2  test_production_hardening_g2a_g2b.py
2  test_session_role_adversarial_fence.py     BOTH xfailed, not failed
1  test_apply_trade_management_branching.py
1  test_e2e_backtest.py
1  test_three_fixes.py
1  test_wave_b_intrabar_stops.py
```

⚠️ **`STOP [44]` IS LIVE OVER THE PnL CLUSTER** (`R-826 §5`): *"the 7 PnL nodes are
`UNEARNED_GREEN` … RECORD their exact stable outcomes; DO NOT repair, weaken, or make them match
the old suite."* I will classify them, not touch them. **Note the arithmetic mismatch I have not
resolved: `STOP [44]` speaks of `7` PnL nodes; this map shows `4` non-pass in `test_pnl_accuracy.py`.
Those may be different populations. I will state the join before using either number** — a count
that does not join is exactly `[unenumerated-ladder]`.

⚠️ **The 2 `xfailed` nodes get `§3[4]` treatment specifically: `xfail` does not automatically mean
`INTENTIONAL_NEGATIVE`. I will prove the xfail marker is intentional and current, or classify
otherwise.**

## 3. INSTRUMENT FAULTS, REPORTED AGAINST MYSELF

Both were mine, both were caught, neither changed a conclusion — but they cost time and the second
one nearly produced a false finding:

1. **cp1252 crash.** Printing the failure reprs died on `U+2192`. Forced UTF-8 on stdout.
2. **A CLUSTERING ARTEFACT THAT LOOKED LIKE 17 SEPARATE BUGS.** My first grouping keyed on the tail
   of each stored failure repr. **The artifact truncates `failure_reprs` at VARYING lengths**, so
   one identical `ImportError` root produced 17 distinct "signatures" — it printed
   `DISTINCT ROOT SIGNATURES: 28 over 33 failing nodes`, which is false. The real structure is
   **one** root over 18 nodes. Caught by reading the strings instead of trusting the count, then
   confirmed against the source. ★ **`A CLUSTERING ARTEFACT READS EXACTLY LIKE N BUGS.`**
   ⇒ **Consequence for the remaining 17: I will not classify from `failure_reprs` tails.** The
   stored reprs are truncated and are not adequate durable receipts on their own.

## 4. STOPS — none of the six fired

1. no production/compiler/trading defect surfaced yet (cluster 1 implicates none);
2. nothing is `UNEXPLAINED` yet — 17 are simply **not yet examined**, which is a different state
   and is labelled as such;
3. census not started; 4. no sealing attempted; 5. no canonical run; 6. no closeout refusal.

## 5. NEXT

Classify the remaining 17 by root cluster, from source and durable receipts rather than truncated
reprs. **Interim report lands here at the next milestone rather than at the end of the route** —
that is the §0 correction, applied.
