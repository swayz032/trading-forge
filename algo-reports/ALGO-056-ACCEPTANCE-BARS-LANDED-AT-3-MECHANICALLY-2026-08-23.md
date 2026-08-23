# ALGO-056 — THE AMENDED SENSITIVITY RAN, `acceptance_bars` LANDED AT 3 MECHANICALLY, AND THE AMENDMENT IS VISIBLE IN THE NUMBERS

**Strategy head:** `7a997327` (pushed, remote-verified with a negative control).
**Chain since ALGO-053:** `1b0e2ddf` (09:30 run-config) → `d150d87d` (ALGO-054 amendment) →
`1e65d042` (dual-window instrument + FLAKE-1 split) → `7a997327` (acceptance_bars = 3).
**PR #38: DRAFT / DO NOT MERGE — unchanged.**
**Semantic files modified:** YES — `breakout_derivation.py` and `entry_authority.py` defaults.
This IS the kernel's semantics: the kernel passes no explicit `acceptance_bars`.
**Gate state:** ALGO lane **787 passed, 0 failed**. §7 mutation campaign **19/19 KILLED**;
wiring red-proof **9/9 KILLED** — both re-run against the changed semantics.

---

## 1. The measurement [MEASURED HERE]

On the ALGO-054 **CONSIDERED** population — 29,775 candidates, **identical at all three
values**, which is the whole point:

| `acceptance_bars` | Route D grants |
|---|---|
| 1 | **363** |
| 2 | 228 ← the value in force |
| 3 | **186** |

**R2** the spec's silence on the count was RE-CHECKED, not remembered. **R3** monotonicity was
ASSERTED against the measurement rather than assumed, and it holds strictly — so *stricter* is
a property here and not a word. **R4** chosen by STRICTNESS alone; no agreement rate, fidelity
headline, PnL, realized outcome or winner/loser label participated, and the module imports none
of the code that computes them.

**Verdict: `R3_SILENT_STRICTER_WINS` → 3. Landed mechanically (ALGO-046 §1.3). No surprise, so
no round-trip: the rule also selected 3 on the pre-wiring run.**

### 1.1 THE AMENDMENT IS VISIBLE, and this is the sentence that matters

**Grants at 1 (363) EXCEED grants at 2 (228).** Under the old survivor-selected population that
rise was **structurally impossible** — every member had already been granted at 2 — so R3's
monotonicity would have held BY CONSTRUCTION. It is now a measurement. Your §7 circularity
call is confirmed by the data, not only at the executable lines.

---

## 2. Landed at every site that carries the value

The `break_retest` default · the `decide` default the kernel relies on · the
`UNFROZEN_CHOICES` declaration · the exam's `CURRENT`. The declaration now records **how** it
moved, so nobody later reads 3 as frozen or as a judgement call.

**Five tests went red and every one had the old number baked in** — as a literal, or as the
SHAPE of its bars. All re-anchored to DERIVE rather than type:

* the declaration-vs-default test asserted `== 2`; it now extracts the number **from the
  declaration text** and asserts they match — which is the property the declaration exists for;
* four Route D fixtures built exactly two closes beyond. They now build `ACCEPT_N` closes read
  from the signature. What they test — acceptance, retest, force — never depended on the number;
* the R3 test asserted `changed is True` — a fact about a moment, not a property. It now
  asserts the flag TRACKS `chosen != CURRENT`.

---

## 3. FLAKE-1 split — all three parts, RED-PROOFED against a real corruption

§1 custody hashed against the committed lock **before any comparison**. §2 every red persists
the custody report **and every disagreeing row** to a retained artifact. §3 the recurrence rule
is written INTO that artifact: derivation red with custody GREEN = genuine nondeterminism =
STOP-THE-LINE; custody red alone = data incident, no semantic alarm.

**Red-proof:** appending one line to the pinned 5m CSV turns it RED as `DATA_CUSTODY_ERROR`,
naming the file and the expected-vs-observed sha256 and byte count; the cross-check **refuses
to compare at all**; the artifact records `kind=DATA_CUSTODY_ERROR` with zero disagreeing rows.
Restored byte-exact by SHA256; 17 green.

---

## 4. The dual-window exam instrument is built and its rules are pre-registered

A1 no lost agreement **by MEMBERSHIP** — pinned by a test where both arms have the SAME count
and differ by a swap, which a count-shaped rule would pass. A2 the window is never the fix and
never the casualty — enforced on what the module **EMITS**, on both branches. A3 08:00
unconditional, a failing arm BLOCKS FREEZE, and **a PASS is a precondition, never a grant** —
a test asserts the passing verdict points at you. A4 censored cases neither convict nor acquit,
using a PREFIX test because `BOT_ONLY_ENTRY_UNCENSORED_DECLINE` contains the word meaning the
opposite. A5 no outcome reader imported.

The six teaching hashes (ALGO-050 ×1, 051 ×3, 052 ×2) are pinned as **rationale only**, with a
test that no teaching artifact is read as input.

**The 09:30 run-config is CALIBRATED:** in a read-only arena at the pre-wiring pin `8dc9d7e2`
it reproduces the frozen **5/8** exactly (14-of-14 traded, 0 declines, 7 entered, 39 decisions).
Six alias sites rebound — `replay_lab_v3` binds `TRADE_START` at IMPORT time, the half-move
hazard. ROLE 2 guarded: coupling the session-open anchor to `TRADE_START` is now a red test.

**The exam is RUNNING as this is published** (arm 1 of 2). Its verdict rides in the next packet.

---

## 5. Three defects of my own, found by my own new work

1. **My DISCRIMINATES fixture's retest bar closed BEYOND the level**, extending the acceptance
   run instead of retesting it — refused at both values, which would have read as *the
   parameter does nothing* when it was the fixture doing the wrong thing.
2. **The anti-circularity guard convicted this module's own amendment note**, which necessarily
   quotes the selector it replaced. Now strips docstrings via the AST.
3. **A substring-over-prose test, for the THIRD time in this packet** — A2's guard scanned the
   source for phrases its own rule text contains. It now checks the emitted verdict instead.
   Three instances of one shape in one packet is a habit, not an accident, and I am naming it
   rather than quietly fixing the third.

Also: the "stopped" background exam process had **left its Python child alive** — the same
wrapper-is-not-the-child shape as the leaked ear. Two concurrent writers to one artifact; I
verified identity by command line and birth time before killing the duplicate.

---

**Suite line, enumerated:** ALGO lane `787 passed / 0 failed`. Full-tree failures unchanged at
7 by MEMBERSHIP, all pre-existing and outside this lane:
`test_current_mnq_strategy_v2_2_engine_final.py::test_final_engine_installs_one_gold_lifecycle_everywhere`;
`test_deepscan_fixwave_2026_06_29.py::TestH6FreqMapAlias::test_bars_per_day_4hr_is_6`;
`…::test_4h_and_4hour_still_present`;
`test_eligibility_gate_stop_ceiling.py::TestBugProof::test_mnq_30pt_stop_clamped_to_6pt_with_old_hardcoded_args`;
`…::TestFixVerification::test_mnq_above_ceiling_is_clamped`;
`…::test_mes_stop_above_14pt_ceiling_is_clamped`; `…::test_mcl_stop_above_1pt_ceiling_is_clamped`.

No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision
in this packet.
