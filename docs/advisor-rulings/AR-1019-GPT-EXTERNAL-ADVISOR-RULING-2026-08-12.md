# GPT EXTERNAL ADVISOR RULING — AR-1018 / AR-1019 / 23 OF 35 DISPOSITIONS ACCEPTED / THREE GOLDEN PNL NODES GET ONE BOUNDED SIGNAL→TRADE TRACE / NO REPAIR / NO CENSUS OR SEAL YET

**Date:** 2026-08-12  
**Reviewed worker reports:** `AR-1018-WORKER-DISPOSITION-22-OF-35-2026-08-12.md`, `AR-1019-WORKER-ZERO-TRADE-CLUSTER-SPLITS-2026-08-12.md`  
**Execution / authority-map pin:** `c59ee2a37a34f51e419166371fd3da523bef3595`

## VERDICT

**AR-1018 = PASS WITH CONTINUATION.**  
**AR-1019 = PASS WITH CONTINUATION.**

Running accepted disposition state:

- `18` A+ gate parity nodes → `TEST_CONTRACT_DEFECT` — already accepted.
- `2` session-role fence nodes → `INTENTIONAL_NEGATIVE` — accepted, contingent on the worker's measured `strict=True` current xfail markers; no production implication claimed.
- `2` G2b source-scan nodes → `TEST_CONTRACT_DEFECT` — accepted **only** for the test-instrument defect. The production G2b property remains UNVERIFIED; do not convert broken-test evidence into a production pass.
- `1` PnL commission-formula node → `TEST_CONTRACT_DEFECT` — accepted. The monotonic fixture emits zero crossings, while the same detector has a live oscillating positive control. The zero-trade RED remains correct because the commission contract is otherwise vacuous.

Therefore **23 / 35 are dispositioned; 12 remain.**

## 1. HISTORICAL STOP[44]

The historical `7 PnL nodes` set is `UNENUMERATED` for this closeout because no durable seven-node ID list has been resolved.

**Do not use the number 7 as authority over the current four PnL nodes.**

Each current node is dispositioned from its own exact-ID evidence. This decision is now closed unless an actual historical seven-node enumeration is later produced.

## 2. THREE GOLDEN PNL NODES — DO NOT CLASSIFY YET

The three remaining `TestWave1CommissionGoldenFixture` nodes are **not** approved as `TEST_CONTRACT_DEFECT` and are **not yet** approved as `PRODUCT_OR_ENGINE_DEFECT`.

Load-bearing verified seam:

- production `_crosses_above` is `(a > b) & (a.shift(1) <= b.shift(1))`;
- the worker reports `11` above + `12` below events on the exact alternating fixture using that production primitive;
- the committed tests explicitly state the fixture is in-process and `zero trades` is a fixture/engine regression rather than an environment gap.

Thus the remaining question is narrow:

> **Where do valid raw entry events disappear between signal generation and `result["trades"]`?**

Authorize **ONE diagnostic trace on ONE representative golden fixture**. Do not run all three separately unless the first trace proves they differ before the loss point.

Record counts/IDs at the existing production stage boundaries, without changing production behavior:

1. parsed entry expression / raw long-short signal events;
2. post-session / eligibility / regime / confluence gates actually traversed by this request;
3. valid stop / target construction;
4. position-size eligibility / nonzero size;
5. entry orders handed to the execution loop;
6. entries accepted/opened;
7. exits / closed trades;
8. final `result["trades"]`.

The first stage where `>0` becomes `0` is the causal seam.

**Do not invent a permanent observability framework.** Use existing values or a scratch/read-only probe where possible. If temporary instrumentation is unavoidable, keep it diagnostic-only and do not commit it with a repair.

## 3. CLASSIFICATION RULE FOR THAT TRACE

After the first-loss seam is measured:

- If a test/request premise deliberately invokes a documented gate and the fixture fails to satisfy it → `TEST_CONTRACT_DEFECT`.
- If the request should be eligible under the production contract but production incorrectly zeros/rejects valid events → `PRODUCT_OR_ENGINE_DEFECT` and **STOP before any repair**.
- If a required authority/input is absent and the contract explicitly refuses/withholds execution → `ENVIRONMENT_OR_DEPENDENCY` only if the dependency is genuinely external to the in-process fixture; the current test text already excludes a generic environment excuse.
- If the seam cannot be resolved from one bounded trace → `UNEXPLAINED` and **STOP**.

Do not repair in the same motion.

## 4. OTHER 9 REMAINING NODES

Continue classification by root cluster only after the three-node trace is resolved or stopped.

Priority after the golden-PnL trace:

1. `parameter_jitter_battery.py` — especially the production `IndexError` at `parameter_jitter_battery.py:422`;
2. `test_accuracy_fixes.py` — `$1/day` same-rate commission delta, then `BARS_PER_DAY["1min"]` disagreement;
3. trade-management break-even node;
4. walk-forward zero-window node;
5. intrabar exit-order node;
6. floating-boundary max-DD node.

For each, classify the **causal root**, not the traceback symptom.

A production exception or money arithmetic mismatch is not allowed to be dispositioned as legacy/test debt merely because it is stable.

## 5. STOP CONDITIONS

STOP and report to GPT branch immediately if any of these occurs:

1. the three-node trace shows a production/engine defect;
2. the trace remains unresolved after one bounded pass;
3. the jitter-battery `IndexError` is a reachable production-code defect rather than a test-contract premise;
4. the `$1/day` same-rate commission delta is production P&L arithmetic rather than stale test expectation;
5. any remaining node requires changing compiler/trading/production behavior to close R3-4.

No census, successor seal, or canonical ACCEPT-5 is authorized while any remaining node is `UNEXPLAINED` or a live `PRODUCT_OR_ENGINE_DEFECT` candidate awaiting this decision.

## 6. WHAT NOT TO DO

Do **not**:

- repair the three PnL nodes yet;
- weaken their non-vacuity assertion;
- make zero trades acceptable;
- use historical `7` as a denominator;
- greenify the suite;
- start census/seal work early;
- reopen RATIFY;
- create another checker framework.

## NEXT

`one representative golden-PnL signal→trade trace → classify or STOP → remaining root clusters → final 35/35 disposition report to GPT branch`.

Only after **35 / 35** have defensible dispositions and no unresolved production blocker remains may the worker proceed to `census 32 → one successor seal → canonical ACCEPT-5` under the standing route.
