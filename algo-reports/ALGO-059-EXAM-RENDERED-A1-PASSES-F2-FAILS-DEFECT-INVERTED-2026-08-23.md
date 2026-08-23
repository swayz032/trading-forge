# ALGO-059 — THE DUAL-WINDOW EXAM RENDERED: **A1 PASSES, F2 FAILS, THE BRAIN IS CONVICTED.** The defect inverted rather than closed.

**Strategy head:** `4c77bb5c` (pushed, remote-verified with a negative control). Row artifacts
for both arms are COMMITTED for your independent re-derivation.
**PR #38: DRAFT / DO NOT MERGE — unchanged.**
**Semantic files modified in this packet:** **NONE.** No edit to kernel, `entry_authority`,
`breakout_derivation`, labels, the exam instrument, or any frozen artifact.
**Gate state:** ALGO lane green; §7 mutation campaign 19/19; wiring red-proof 9/9.

---

## 1. The verdict, as emitted

| | frozen (pre-wiring @ 09:30) | wired @ 09:30 | wired @ 08:00 |
|---|---|---|---|
| **headline** | **5/8** | **1/8** | **1/8** |
| agreeing set | `{03-24, 03-30, 03-31, 04-06, 04-14}` | `{04-14}` | `{04-14}` |
| traded at all | 14 / 14 | 9 / 14 | 12 / 14 |
| genuinely declined in-window | 0 | **5** | 2 |
| unavailable (bullet pre-window) | 7 | 6 | **10** |
| missed trader entries | 2 | **6** | **6** |
| decisions through window end | 39 | 21 | 39 |

**Exam verdict as emitted: `A1_NO_LOST_AGREEMENT_BY_MEMBERSHIP` → PASS.** Freeze line:
*"PRECONDITION MET — freezing is still the advisor's ruling, never this module's."*

---

## 2. **A1 PASSING IS NOT GOOD NEWS, AND F2 IS WHY YOU PRE-REGISTERED IT**

A1 compares the two arms **to each other**. No agreement is lost going 09:30 → 08:00, so as
emitted the exam passes. **It cannot convict a brain that regressed against the baseline on
BOTH arms.** I am reporting it as emitted and as insufficient in the same breath — the score
did not decide anything here, the rules did.

### F2, by membership, fails identically on both arms

```
lost vs frozen (09:30 arm) : {2026-03-24, 2026-03-30, 2026-03-31, 2026-04-06}
lost vs frozen (08:00 arm) : {2026-03-24, 2026-03-30, 2026-03-31, 2026-04-06}
08:00 contains 09:30's set : True   (A1's own lost set is genuinely empty)
```

**F2 ⇒ FAIL. No freeze. The brain is convicted.**

---

## 3. THE FINDING: the defect INVERTED, it did not close

Those four are **the same four sessions the ROLE-1 window amendment destroyed at `025b5a1e`** —
and they die by the **opposite mechanism**.

* **Then:** `BUDGET_CONSUMED_BEFORE_WINDOW` — the bullet was spent before the trader looked.
* **Now (09:30):** `NO_ENTRY_IN_WINDOW` — the brain is **present, considers, and REFUSES** on
  days he entered.

The measured defect this whole phase existed to kill was an entry decision that was a CONSTANT
and therefore carried no information. **The constant is gone.** What replaced it is a brain
that is over-strict exactly where the trader traded: declines 0 → 5, missed entries 2 → 6.

Per-case at 09:30 — `03-24` ENTER_LONG / NO_ENTRY · `03-30` ENTER_SHORT / NO_ENTRY · `03-31`
ENTER_LONG / NO_ENTRY · `04-06` ENTER_SHORT / NO_ENTRY · `03-23` and `04-09` missed via
BUDGET_CONSUMED · `04-02` remains `BOT_ONLY_ENTRY_UNCENSORED_DECLINE` · `04-14` the lone AGREE.

**The two arms reach 1/8 by DIFFERENT mechanisms.** At 08:00 unavailability rises 6 → 10, so
four of its misses are a spent bullet rather than a refusal. Same headline, different cause —
which is exactly why ALGO-058 orders the diagnosis **per session**, not per arm.

---

## 4. F4a — my self-re-derivation, and what it does NOT cover

`research/run_f4_rederive_arm_headlines.py`, committed. **It imports nothing from the exam
module**: a summary read back through the code that wrote it agrees with any internally
consistent lie. It restates the agreement classes from the ruling, rebuilds both headlines from
`cases[]` rows alone, and evaluates F2 by **set inclusion**, not by comparing headline strings.

Re-derived: both arms **1/8, MATCH** published · lost sets as above · **F2 FAIL** · A1's empty
lost set confirmed.

**Coverage honesty — what it does NOT verify:** that each arm actually ran at the window it
claims (that is the run-config's calibration, receipted separately at ALGO-056: it reproduces
the frozen 5/8 exactly at the pre-wiring pin), and that the row-level trader labels are
themselves correct (frozen, custody-pinned). Join key: `session`, present on every row of all
four artifacts.

---

## 5. Nothing repaired, and why that is deliberate

**Two semantic changes sit between 5/8 and 1/8** — the wiring itself, and `acceptance_bars`
2 → 3. Attributing the loss to either without evidence would be a hypothesis dressed as a fix,
and the last time this lane repaired the instance rather than the class it produced eight
false greens. ALGO-058 §3's per-session diagnosis runs next, with `acceptance_bars=2` at the
09:30 config as a **labelled attribution diagnostic only** — R4 stands, nothing is chosen by
agreement.

**ALGO-057 §4.1 single-writer guard is LANDED** (`42b186a0`) — PID-verified, refusing rather
than killing, and it names the holder so identity is checked by command line and birth time
first. It found a defect in itself: `os.kill(pid, 0)` does not raise `ProcessLookupError` on
Windows, so every stale lock would have blocked forever — the exact failure its own docstring
warns about, shipped inside the guard against it. Windows now answers via `OpenProcess` +
`GetExitCodeProcess`. **It is deliberately NOT yet wired into the runners:** the exam was live
and imports `run_frozen_14_case_baseline`, and wiring a guard into a module a live run depends
on is the carelessness the guard exists to prevent. Wiring lands before the diagnostic.

**§4.2 census is done** (read-only, bounded): **51** read-source assertions across the lane's
tests — **28 to CONVERT** (22 on this lane), 11 REVIEW, 5 JUSTIFIED (the target is a *document*,
so prose IS the artifact), 7 already AST-guarded. Conversions follow the diagnosis.

**F4b grader:** still blocked — this session is configured not to dispatch agents without the
operator's word, and a ruling cannot lift a user setting. Moot until an exam passes, as you say.

---

No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision
in this packet.
