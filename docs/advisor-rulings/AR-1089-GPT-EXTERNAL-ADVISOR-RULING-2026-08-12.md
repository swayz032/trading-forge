# GPT EXTERNAL ADVISOR RULING — AR-1089 / AR-1088 ACCEPTED / FIRST SOURCE_FAITHFUL BAND-C TRADE VERIFIED / REMAINING GUARDS RECLASSIFIED / F-2 MICROFIX THEN F-4 MONEY-PATH REPAIR

**Desk:** GPT External Advisor  
**Date:** 2026-08-12  
**Governing worker report:** AR-1088  
**Engineering branch independently inspected:** `h1-wave4-sealed12-driver`  
**Engineering head independently observed:** `1e1e872c1bb945ea25793dd0c0d73001b9202422`  
**Independent grade inspected:** `docs/designs/GRADE-SOURCE-BCDF-VERTICAL-2026-08-12.md`  
**Prior GPT authority:** AR-1082 (`3645650ffe9e048a44e26b56997fd50e74062059`)

## 1. RULING

**AR-1088 is ACCEPTED. Discriminators 13 and 16 are CLOSED as real committed behavior tests.**

I independently inspected the pushed engineering tree at `1e1e872c...`, the actual test diff, the prior vertical proof at `4936aae8`, the source-faithful FVG-routing bypass at `162e6fa1`, the independent grade, the walk-forward fail-closed repair at `11efed54`, and the decayed-control repair at `744ab54`.

The project has crossed an important threshold:

> **The real single-run Band C route can now produce one independently verified SOURCE_FAITHFUL deterministic trade at the shipped default configuration: breakout-side entry on the third FVG candle close, exact displacement-candle wick stop, whole-position fixed-R target, no ATR substitution, no house ceiling clamp, no Style-C ladder, and no legacy +1-bar entry roll.**

The independent accuracy-validator did not merely re-run the worker fixture. It built a different price fixture and a separate oracle that imports no engine code, then reproduced the load-bearing entry/stop/target arithmetic. That is real independent confirmation. The grade correctly remains bounded: it verifies `mode="single"` Band C mechanical fidelity, not real-market profitability and not walk-forward.

The grader's F-1 HIGH is now independently observed CLOSED FAIL-SAFE in the current tree: SOURCE_FAITHFUL + `mode="walkforward"` refuses before execution rather than silently falling into legacy plumbing. That refusal is the correct current behavior because AR-1079 explicitly did not certify source-faithful walk-forward.

---

## 2. AR-1088 DISCRIMINATOR 13 — ACCEPT

The new `r_multiple` test is load-bearing and correctly shaped.

Only the persisted artifact changes:

`spec.source_risk.target.r_multiple: 2.0 -> 3.0`

On the same frame:

- entry stays unchanged;
- source stop/risk stays unchanged;
- executable exit moves from exact 2R to exact 3R.

This is exactly the test needed to distinguish **"the engine consumed the taught R multiple"** from **"the engine happened to hard-code 2R, which matches this source."**

The worker's ablation is also meaningful: hard-coding `2.0` kills the new test while leaving the unrelated source geometry intact.

**Disposition: CLOSED.**

---

## 3. AR-1088 DISCRIMINATOR 16 — ACCEPT

The first attempted fixture was invalid because it destroyed the bullish FVG it was supposed to test. The worker correctly rejected that fixture rather than weakening the assertion.

The replacement geometry is valid and materially better:

`high[6] < low[8] < low[7]`, with `high[6] > ORH`.

That allows the decision candle itself to trade through the taught stop while preserving:

- the FVG;
- the same entry candle;
- the same displacement-candle stop;
- the same risk.

The result then proves that price action occurring **inside the decision candle before its close** cannot retroactively stop out a position that does not exist until that close.

Opening the source exit scan to the entry bar makes the test fail.

**Disposition: CLOSED.**

---

## 4. CORRECTION — ITEMS 11 / 14 / 15 ARE NOT ALL "ABLATION-ONLY"

The worker is right about one principle:

> **An ablation is evidence; it is not a permanent guard.**

But the next conclusion is too strong. A committed regression test does **not** need to mutate production code itself. It only needs a fixture whose observable result would change if the old defect came back.

### 15 — legacy +1-bar roll

**This is already guarded by the committed Band C vertical proof.**

That test pins the source entry to the decision bar and its close. Reintroducing the +1 roll changes the entry bar/price and, per the worker's own V1 ablation, collapses the vertical class. A second duplicate test whose only purpose is to say "+1 roll bad" adds little value.

**Disposition: CLOSED by existing committed behavior guard.**

### 11 — house stop buffer / ceiling must not mutate source stop

This is behavior-testable without self-mutating code.

The independent grader already supplied the shape: use a SOURCE_FAITHFUL fixture whose exact taught risk is **larger than the house ceiling** and assert the returned trade still carries the full `source_exact` risk/stop. If the house clamp returns, the test goes red naturally.

Convert that shape into a permanent committed regression test. Do **not** build a generic mutation framework.

**Disposition: OPEN — one small permanent behavior test required.**

### 14 — no Style-C partials / runner / ladder

This is also behavior-testable.

Use a source fixture whose later price path touches a level that would cause a Style-C TP1/partial before the teacher's fixed-R target, while still eventually reaching the teacher target. Assert the SOURCE_FAITHFUL result remains one whole-position `source_fixed_r_target` exit with no TP1/TP2/runner/trailing substitution.

Again: no mutation harness needed. Make the market path discriminate the two behaviors.

**Disposition: OPEN — one small permanent behavior test required.**

---

## 5. ITEM 12 — DO NOT FORCE AN IMPOSSIBLE FULL-VERTICAL FIXTURE

The worker says the current vertical geometry cannot remove the taught anchor without also destroying the source event. That is a valid limitation of that fixture, not a reason to leave the refusal unguarded.

The requirement is:

> **If a REQUIRED taught source anchor is unavailable at execution, SOURCE_FAITHFUL refuses. It never substitutes ATR, a house structure, or another FVG.**

Close this at the **narrowest existing source-authority boundary** that can genuinely represent the missing-anchor condition. A component-level negative guard is acceptable here because the load-bearing positive vertical proof already exists.

Required proof shape:

1. positive witness: the same boundary resolves a valid taught anchor;
2. missing/unavailable required anchor: named refusal;
3. no ATR fallback / nearest-structure fallback / house stop;
4. mutation/removal of the refusal makes the test red.

Do not invent malformed price geometry merely to force the full Band C fixture to represent a state it cannot naturally reach.

**Disposition: OPEN — close cheaply at the correct source-authority boundary.**

---

## 6. OPEN GRADE FINDINGS — PRIORITY

### F-1 walk-forward source/legacy split — CLOSED FAIL-SAFE

Current production code now refuses SOURCE_FAITHFUL walk-forward before `run_walk_forward_class` rather than running the teacher's source population through legacy execution. Keep that refusal until a separate ruling explicitly certifies source-faithful walk-forward transport.

### F-5 decayed negative control — CLOSED

The remaining stale negative assertion was replaced with a live subject. No further campaign is required unless another concrete decayed-control witness appears.

### F-3 warmup rebase vertical coverage — OPEN AS A PROOF GAP, NOT A CURRENT SINGLE-RUN DEFECT

The timestamp rebase is meaningfully guarded at unit level. The current single-run Band C route has `warmup_rows=0`, so it cannot prove the rebase end to end. Do **not** widen into walk-forward just to improve a proof score. Keep this recorded and revisit when source-faithful walk-forward is deliberately implemented.

### Unsorted-frame / contiguity hypothesis — MEASURE FIRST, DO NOT DESIGN A SORTING SUBSYSTEM

The source event selection assumes chronological session/bar order. Before changing anything, measure whether the canonical class-path data contract already guarantees monotonically increasing `ts_event`.

- If the canonical loader/validator already guarantees it, pin that guarantee with one targeted test and close the hypothesis.
- If it does not, SOURCE_FAITHFUL should fail closed on non-monotonic execution input at the narrowest trustworthy boundary.
- Do not silently sort inside the source-event lane; silent sorting could invalidate already-derived event/index identity.

---

## 7. NEXT MONEY-PATH ORDER — FAST + ROBUST

The worker recommended F-2 next. **Approved, but only as a tiny surgical micro-fix. It must not become a prop-sim campaign.**

### STEP 1 — F-2 `Exit Timestamp` micro-fix

The defect is independently confirmed in the current tree: managed execution overwrites `Avg Exit Price`, `Exit Idx`, `exit_reason`, and P&L, but leaves vectorbt's stale `Exit Timestamp` untouched.

Repair rule:

- when management chooses `exit_idx`, stamp `Exit Timestamp` from the same executed frame at that exact `exit_idx` using the engine's existing timestamp representation;
- do not independently recompute a date/time from strings;
- `Exit Idx` and `Exit Timestamp` must become one identity;
- preserve entry timestamp behavior;
- prove an intraday managed exit no longer becomes a false overnight prop-sim violation;
- add a legacy/shared-path control because this block is generic, not SOURCE_FAITHFUL-only.

This should be one narrow commit.

### STEP 2 — immediately close items 11 / 12 / 14 as the small permanent guards described above

Test-only unless a real defect is discovered. **Item 15 requires no duplicate work.**

### STEP 3 — F-4 IS THE NEXT MAJOR MONEY-PATH UNIT

**F-4 blocks any honest source-faithful performance backtest.**

The independent grader measured:

`40 source entry events -> 1 executed trade`

The cause is architectural: vectorbt opens on the first source entry, sees no source-owned signal exit, remains open while the other source events occur, and only later does Trading Forge retrofit the source stop/target onto the one vectorbt trade record. Therefore the managed exit does not release the simulation to accept the next source setup.

A strategy-performance backtest on that population would be invalid even if every individual trade's stop and target were perfect.

**Do not run the sVkm performance/edge backtest until F-4 is repaired and independently graded.**

### F-4 design constraint

Do not solve this by fabricating `exit_long` from future knowledge or by adding a second source strategy engine beside the class backtester.

First measure the smallest reuse path that can make source fixed-R management release the position and permit the next valid source event. Prefer extending the existing management/execution mechanism over building a parallel trade simulator.

Pre-register the critical proof before editing:

- N separated source events whose prior source-managed trades exit before the next event -> N executed trades;
- overlapping source events while a source trade is still open -> deterministic documented policy, not accidental vectorbt suppression;
- stop and target remain exact source-owned values on every trade;
- no house exits re-enter;
- trade count changes only because completed source trades free the position, not because events are duplicated;
- a mutation restoring the old always-open vectorbt shape must go red;
- legacy and TF_OVERLAY_VARIANT stay unchanged.

After F-4 GREEN, self-dispatch an independent accuracy-validator on DISPROVE before any real performance claim.

---

## 8. WHAT IS AUTHORIZED / NOT AUTHORIZED

**AUTHORIZED NOW:**

1. F-2 Exit Timestamp micro-fix;
2. permanent guards for 11 / 12 / 14;
3. one small monotonic-order premise measurement;
4. F-4 source trade-population repair;
5. independent grade of F-4 after GREEN.

These may proceed sequentially without another advisor round-trip unless a stop condition below fires.

**NOT AUTHORIZED YET:**

- source-faithful walk-forward implementation;
- sVkm source-faithful performance / profitability / edge claims;
- broad prop-sim redesign;
- generic event/trade-engine rewrite;
- broad Visual Intelligence work;
- library-scale compiler campaign.

---

## 9. STOP CONDITIONS

Stop and report instead of guessing if any of these occurs:

1. F-2 cannot make `Exit Timestamp` derive from the exact same `exit_idx` without changing legacy trade timing;
2. item 12 appears impossible to represent even at the source-authority boundary without inventing an anchor state;
3. F-4 requires a second independent source backtester rather than reuse/extension of existing execution machinery;
4. fixing F-4 requires future-looking exits to release a position;
5. the canonical data contract is non-monotonic and repairing it would reorder already-proven event identity;
6. source-faithful walk-forward becomes necessary to make the single-run F-4 repair work;
7. any SOURCE_FAITHFUL fix changes legacy or TF_OVERLAY_VARIANT results outside a named, pre-measured correction.

---

## 10. DESK STATUS

**AR-1088: ACCEPTED.**

**First faithful deterministic Band C single-run trade: VERIFIED.**

**Discriminator status:**

- 11 — OPEN, permanent behavior guard required;
- 12 — OPEN, narrow fail-closed guard required;
- 13 — CLOSED;
- 14 — OPEN, permanent behavior guard required;
- 15 — CLOSED by existing vertical behavior guard;
- 16 — CLOSED.

**Next:** F-2 micro-fix -> close 11/12/14 -> F-4 trade-population repair -> independent grade.

**No source-faithful performance backtest yet.**