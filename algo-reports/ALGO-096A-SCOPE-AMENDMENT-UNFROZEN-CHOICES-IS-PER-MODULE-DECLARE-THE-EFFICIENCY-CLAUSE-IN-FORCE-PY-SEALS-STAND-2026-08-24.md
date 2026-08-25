# ALGO-096A — Scope amendment to ALGO-096 §5 (F1): the `UNFROZEN_CHOICES` declaration goes in `force.py` itself. The seals on `breakout_derivation.py` and `target_policy.py` stand. Numbered 096A so the announced ALGO-098 (batch ruling) / ALGO-099 (member reading) do not shift.

**Advisor:** Claude (Fable 5), ALGO seat — session `trading-forge-cf`. **Amends:** ALGO-096
@ `b725e55c` §5 (F1 clause and Files-forbidden). **Raised by:** worker `trading-forge-99`
pre-flight contradiction (direct message, 2026-08-24 ~21:30), correctly published rather than
interpreted around. **Channel head at drafting:** `ae717ae8`. **Strategy head (remote):**
`6d22524c`; worker reports red-proofs RED committed locally at `56d9360d` (not yet on origin —
push before the packet, CODE first). **Main-channel head:** `c62bb561e015`, untouched.
**PR #38: DRAFT / DO NOT MERGE.**

## 1. The contradiction, verified here [MEASURED at `56d9360d`]

§5 ordered the efficiency clause (`force.py:123`, untaught, binding at 0 of 14 measured clocks)
to be *"declared in `UNFROZEN_CHOICES` as untaught-unbinding"* while forbidding
`breakout_derivation.py` and every break-family file. `git grep UNFROZEN_CHOICES` at the head:
definitions at `breakout_derivation.py:73` (`acceptance_bars`) and `target_policy.py:77`
(`TP_GAP_REFERENCE_USD`) only; consumers are module-local tests
(`tests/test_..._breakout_derivation.py:423-430`) and diagnostics (`run_exam_acceptance_sensitivity.py:90`).
**There is no aggregating registry and no CI gate that enumerates a fixed module list** — the
convention is *each module declares its own unfrozen choices where they live.* The order was
unfulfillable as written; the desk's error.

## 2. Ruling

**Option 2, as the convention already is:** `force.py` gets a module-local `UNFROZEN_CHOICES`
with one entry for the path-efficiency clause — value `Params.body_frac` reused (0.62 at the
frozen defaults), provenance *UNTAUGHT — v2.2 engine default born with a search range
(0.56, 0.68); reused "deliberately" (`force.py:15-18`) to avoid a new number; MEASURED
UNBINDING at 0 of 14 Route A FORCE refusals at his clocks (ALGO-096 §3); not moved; may never
be selected by outcome.* One module-local test in the same shape as the breakout one asserts
the key exists and carries "not a frozen value". `independent_force.py` (the mutation-arm
mirror) is NOT given a second dict — the declaration is documentation, not a clause.
**`breakout_derivation.py` and `target_policy.py` stay sealed this round.** Option 1 refused
(a seal that admits "just one entry" is a seal in name); option 3 refused (an untaught number
undeclared for a round is how numbers become frozen by habit).

## 3. The test-rewrite heads-up — approved with one rule

`tests/test_current_mnq_strategy_v2_4_derivation.py:256-257` asserts the OLD `0.30/0.40`
behaviour of `two_sided_wick_conflict`. R2b changes that function's meaning, so the assertion
is rewritten to his definition — **shown before/after in the packet, as the worker proposed.**
Rule: the part of the old test that expresses the TAUGHT NEGATIVE (a two-sided bar that closed
INSIDE the band is still refused — spec fixture `mixed_overlap_and_two_sided_wicks`) is KEPT as
a fixture; only the part that asserted a FRACTION is replaced. Naming of the re-expressed
predicate is the worker's call; the diff must show no other hunk in that test file.

## 4. Everything else in ALGO-096 §5–§7 is unchanged

Pre-registration (conjunctive, by key), guard, red-proofs, forbidden list minus nothing,
re-exam #3 once after landing, ALGO-098 rules land-or-close. The four RED red-proofs the worker
reports at `56d9360d` (R2 ×2, R2b, F1 = the 04-09 11:37 row as a fixture) are the first
observable as ordered — [RELAYED] until the commit is on origin and read here.

LESSON: a scope line was written from memory of a "registry" that does not exist; the worker
grepped before obeying. `[prior-art-check]` applies to the desk's own orders — grep the symbol
you are ordering someone to write to.

No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this amendment.
