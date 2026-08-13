# AR-1097 (worker) — GRADE CLOSED (F-1/F-2/F-6 + YOUR §6 BOUNDARY), AND I FOUND WHY MY OWN SUITE WAS NEVER TRUSTWORTHY

**Governing:** AR-1095 §6, §7 · **Grade:** published unedited at `GRADE-F4-TRADE-POPULATION-2026-08-12.md`
**Pin:** `302c7f14` · **Graded pin:** `45e4ca84` (`src/` byte-identical when the grader re-derived)

---

## 1. THE GRADE — BAND 6 VERIFIED, CLAIM PARTIALLY CONFIRMED

It could not break the mechanism. Its **own** frame builder and an oracle importing nothing from
`src.engine` agreed **14/14 end-to-end** and **400/400 randomised unit cases** (planted-bad caught
399/400). It exercised three paths my matrix never touched: end-to-end `source_stop` exits, a real
`overlap_suppressed=1` on a fixture it built, and `unresolved_open=1`.

**Honest nulls it established — I will not re-litigate these:** two-authority asymmetry (**78 field
comparisons across 13 trade pairs, 0 disagreements**), look-ahead (refuted at the executable lines),
entry price (a standalone `from_signals` call with no engine code proves vbt fills at the signal
bar's close), same-bar conflict, and `<=` matching the house convention.

**But the claim's reporting limb failed, and it found a HIGH I did not name.**

---

## 2. F-2 (HIGH, NOVEL) — MY DISCLOSURE COUNTED INTENT AND READ LIKE OUTCOME

`source_trades_opened` is incremented **before** `from_signals` runs. Nothing reconciled it against
`pf.trades.count()` — two numbers, ~55 lines apart in one function, no join. The grader forced
`compute_position_sizes` to return `0.0` at the first planned entry bar:

```
occ: trades_opened=3 ... unresolved_open=0    <-- UNCHANGED
trades: [(41,...), (74,...)]   total_trades: 2
```

No counter moved, no exception, no `guards_failed`. **Six assertions across two of my files
string-matched that stderr line**, so the whole disclosure limb and its green were compatible with a
population that never executed. It found this by mutating the **executor** and reading the
**reporter** — a direction I did not think to attack.

★ **`A COUNT WRITTEN BY THE THING BEING MEASURED IS A CLAIM, NOT A MEASUREMENT.`**

**CLOSED, FAIL-CLOSED.** The plan is now reconciled against `pf.trades.count()` and **REFUSES** on
mismatch — degrading would reproduce exactly the silent-wrong-answer F-4 exists to end.
**Red-proofed with the grader's own mutation** (`ValueError: population mismatch`), with a positive
control on the unmutated route.

---

## 3. F-1 (HIGH) — "DISCLOSED" MEANT "PRINTED"

Your §8 P2 required the policy visible in **audit/result metadata**. I built the metadata, printed
it, and never returned it: the grader's repo-wide sweep of all eight keys found **zero consumers**.
The sibling `dsl_guards` — same shape, carrying `source_faithful_bypassed` — **was** already in the
envelope. The precedent was one line above the line I wrote.

★ **`A LOG LINE IS EVIDENCE THAT SOMETHING RAN; ONLY THE RETURNED ARTIFACT IS SOMETHING A CONSUMER
CAN CHECK.`**

**CLOSED.** `result["source_occupancy"]` now carries events, opened, executed, reconciled,
suppressed count, **suppressed bars**, unresolved, plan and policy — `{}` on every non-source run so
the mode is never inferred from a missing key. The load-bearing P2 assertions now read the envelope;
the stderr string survives only as a weak corroborator on a fixture proven to suppress nothing.

---

## 4. THE REST

| finding | disposition |
|---|---|
| **F-6 (LOW)** | **CLOSED** — the pass now REFUSES if the incoming exit arrays are non-empty. The guarantee lived in the producer, the dependency here, nothing joined them. `AN INVARIANT NOBODY ASSERTS IS A COMMENT, AND A COMMENT CANNOT GO RED.` |
| **F-4 (MEDIUM)** | **CORRECTED** — `vectorbt drop:` conflates collapse with policy rejection (grader measured `25%` with zero collapse). My `drop: 0%` witness was fixture-specific; load-bearing assertions moved to the envelope. |
| **Q3 (LOW ×2)** | **RESTORED** — discriminator 16's entry-bar pin now checks all three sessions (`[8, 41, 74]`), and 14's whole-position claim now checks every record, not `trades[0]`. |
| **your §6** | **CLOSED** — see below. |
| **F-3 (MEDIUM, NOVEL)** | **PINNED, NOT FIXED — ESCALATED. See §6.** |

### YOUR §6 — THE EXIT-BAR RE-ENTRY BOUNDARY

You were right that my P2 **encoded** the `<=` convention rather than testing it. Closed at the
narrowest boundary with a **positive witness on both sides**: an entry on the exact exit bar is
rejected and counted (`suppressed_bars == [3]`, with the first trade proven to exit on bar 3), and
an entry **strictly after** it is accepted — so "rejected" cannot be a pass that suppresses
everything. **The policy is conservative and stated:** within one OHLC bar the tick order is
unknown, so we cannot show the prior stop/target was touched before the new decision candle's close;
accepting would invent a favourable intrabar fill. No intrabar simulator.

---

## 5. 🛑 THE INSTRUMENT FINDING — AND IT CONVICTS MY PROCESS, NOT ONLY A TEST FILE

Running my suites **by path**: `187 passed`. Running the same tests under **whole-directory
collection**: `30 failed, 10 errors`. I bisected 365 files to the exact cause.

**`src/engine/tests/test_black_swan_evaluator.py:33-35`**, at **import** time:

```python
_vbt_mock = types.ModuleType("vectorbt")
_vbt_mock.Portfolio = MagicMock()
sys.modules.setdefault("vectorbt", _vbt_mock)
```

`backtester` imports vectorbt **lazily inside the function**, so every later source run resolves to
that mock — permanently, session-wide. And:

```
$ python -c "from unittest.mock import MagicMock; print(int(MagicMock()))"
1
```

★★ **THE "COLLAPSE TO 1 TRADE" I WAS DEBUGGING WAS `int(MagicMock())`.** It is the same number F-4
produced, in the same field, on the same route — a defect and an artifact wearing one face. If I had
trusted it I would have "re-opened" F-4 and hunted a repair for a bug that was not there.

**THE PART THAT IS MINE:** I shipped `45e4ca84` having run the four source suites and the canonical
population — and **never once under whole-directory collection.** The grader's own §2 says why that
gap was invisible: the committed 107-member population **excludes all six source-faithful test
files**. ⇒ **My regression instrument does not cover my own unit.** A green from it was never
evidence about this work.

★ **`AN ACCEPTANCE POPULATION THAT EXCLUDES THE FILES YOU CHANGED IS NOT A WEAK CONTROL — IT IS NOT
A CONTROL.`**

**I did NOT fix the mock leak.** It is a test-only isolation defect in a file outside your authorized
units, its tests may depend on that mock at call time, and the repo already has the centralised
mechanism it should use (`conftest.py`'s `TF_MOCK_VBT`, whose own comment says it exists to replace
exactly this copy-paste). **That is a load-bearing fork, so I am reporting rather than guessing.**
Recommendation: a one-unit fix restoring `sys.modules` after that module's imports, plus adding the
source-faithful files to the acceptance population — otherwise every future source claim is graded
by an instrument that cannot see it.

---

## 6. F-3 — I AM NOT FIXING THIS ONE, AND HERE IS WHY

`[MEASURED HERE]` on a frame whose last session ends at the decision candle:

```
[0] entry=8  exit=11 Closed source_fixed_r_target  exit_px=134.0  pnl=+73.76
[1] entry=41 exit=44 Closed source_fixed_r_target  exit_px=134.0  pnl=+1031.40
[2] entry=74 exit=74 OPEN   signal                 exit_px=119.0  pnl=-93.60

total_trades=3   win_rate=0.6667   profit_factor=11.8073
```

The third row is a position the frame ended on. It is marked to market, its `exit_reason` is the
generic `signal`, its "loss" is exactly its costs — **and it drags the win rate from 100% to
66.67%.**

★ **`A POSITION THE FRAME ENDED ON IS AN OPEN RISK, NOT A RESULT — AND AVERAGING IT INTO A WIN RATE
TURNS "WE DO NOT KNOW YET" INTO "WE LOST".`**

Excluding open trades from performance metrics changes `win_rate`/`profit_factor` **for legacy too**,
which is your §9.5 and a money-path semantics decision, not mine. **Pinned as three tests so it
cannot be rediscovered by accident; awaiting your ruling.**

---

## 7. STATE AND WHAT I HAVE NOT DONE

- **Source suites (9 files, by path): `187 passed`.**
- **Canonical population re-run: `32 failed / 2387 passed / 2 xfailed`, member-list diff EMPTY in
  BOTH directions vs `66c9a476`** — with the caveat in §5 that this population cannot see my files.
- **Whole-directory collection: still contaminated by the mock leak. I am not reporting a
  whole-suite green and will not until §5 is resolved.**
- `BAND-C-SIZING-INGRESS-1` (AR-1096) is measured and **not started** — your §7 puts it after the
  grade, and I have not touched sizing.
- **No performance claim exists and none is authorized.** With F-3 open and the sizing ingress open,
  no P&L number off this route means anything yet.

**Pin `302c7f14`.**
