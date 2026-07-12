# Ratify-Packet — freshscan11 CONFIRMED HIGH (2026-07-12): F4 same-bar partial+full equity double-count

**STATUS: IMPLEMENTED. Staged for independent grade (doer != grader).** Per the operator-amended
`ratify-packet` skill (2026-07-11): this is the autonomous class, not the irreversible/live-capital
class — Trading Forge is pre-live (nothing trading real capital yet, by design; see memory
`feedback_pre_live_by_design_not_a_gap`), and this is a straight correctness fix to existing paper-
execution equity math, not a new behavior requiring an opt-in flag. It proceeds: stage packet ->
implement (done, this commit) -> independent grader re-derives correctness -> post-hoc summary to
the operator (standing veto). No permission-wait. This packet is the receipt the independent grader
rules on.

Base: `wt-ds-goalfix` worktree tip `db24ffd8` = `origin/hardening/phase-0`. Subsystem: paper
execution engine, equity accounting (`src/server/services/paper-execution-service.ts`).

> **Relationship to prior findings:** this is an INTERACTION bug between two freshscan6 fixes that
> are each individually correct in isolation but compose incorrectly under one specific same-bar
> chaining: `closePosition`'s `precedingUnrealizedPnl` override (fixed `84490aa5`,
> `project_closepos_equity_double_count_2026_07_12`) and `bookPartialClose`'s proportional-split
> backing-out + rebase (fixed `8db9ff19`, `project_bookpartialclose_equity_double_count_2026_07_12`).
> Neither prior fix is being reverted or re-derived here — both remain correct for every case they
> were built for (a stand-alone full close; a partial that leaves the position open). This packet
> closes the ONE case neither fix's contract covers: a TP1 partial immediately followed, same bar,
> by a TP2 that turns out to be a genuine full close via the F4 re-invocation path.

---

## What & why now (defect + receipt)

**File:** `src/server/services/paper-execution-service.ts` — the F4 same-bar re-invocation block
inside `updatePositionPrices` (`~5011-5054`), specifically the construction of `updatedPos` that is
handed to the re-invoked `callExitHandler` / `applyExitDecision`.

**Repro (MES $5/pt, entry 5000, 2 contracts — reachable whenever a 2-contract position exists: PM-
taper 9x0.25->2, DLL `reduce_size` x0.5, or a drawdown/risk cap):**

- Bar1: `unrealizedPnl` P0 = 2 x 8 x $5 = 80; already credited into `currentEquity` via a prior
  bar's aggregate delta write (seeded, not simulated, in the regression test — matches every other
  equity test's convention in this repo).
- Bar2 (single bar): the per-position MTM `UPDATE` runs first (unconditional), computing this bar's
  fresh N=2-basis `unrealizedPnl` ("Pm") = 2 x 20 x $5 = 200, and queuing
  `totalUnrealizedDelta += (Pm - P0) = 120` for the DEFERRED end-of-loop aggregate write.
- `FILL_TP1_50PCT` fires -> `bookPartialClose` closes 1 of 2 contracts (its OWN correct fix,
  unaffected by this one): `equityDelta_tp1 = netPnl_tp1 - Pm*(1/2)`.
- F4 re-invokes the handler with `updatedPos.contracts=1` -> `FILL_TP2`. `contractsToClose =
  Math.max(1, styleCScaleOut(2).tp2=0) = 1` is NOT `< updatedPos.contracts(1)` -> takes the FULL-
  close branch -> `closePosition(pos.id, currentPrice, atr, { precedingUnrealizedPnl:
  Number(pos.previousUnrealizedPnl) })`, where `pos` there is `updatedPos`.
- **THE BUG (before this fix):** `updatedPos` was `{ ...pos, tp1Filled: true, contracts:
  pos.contracts - tp1ClosedCount }` — a bare spread of the ORIGINAL pre-bar position object.
  `updatedPos.previousUnrealizedPnl` was never touched, so it still carried the STALE pre-bar value
  P0=80. `closePosition` backed out 80 directly: `equityDelta_tp2_buggy = netPnl_tp2 - 80`.
- Because the position is now fully closed, the `positionClosed` branch a few lines below cancels
  the ENTIRE queued aggregate delta (`totalUnrealizedDelta -= unrealizedDelta`, the full 120) — the
  end-of-loop aggregate write that `bookPartialClose`'s math implicitly assumed would land NEVER
  fires. Combined delta applied = `(netPnl_tp1 - 100) + (netPnl_tp2 - 80)` = `(netPnl_tp1 +
  netPnl_tp2) - 180`, but the TRUE post-close currentEquity delta (from the P0-baselined starting
  point) must equal `(netPnl_tp1 + netPnl_tp2) - P0 = (netPnl_tp1 + netPnl_tp2) - 80`. **Understated
  by exactly `Pm*(1/2) = 100`, PERMANENTLY** — the position is closed, so no later MTM bar ever
  re-corrects it, and it flows into the `realizedPeakEquity` `GREATEST()` ratchet (the authoritative
  Topstep/Apex trailing-DD high-water-mark `kill-switch.ts` reads), which only ever ratchets UP —
  an under-credited `currentEquity`/`realizedPeakEquity` reads as MORE drawdown consumed than
  actually occurred, which can trip a FALSE Layer-3 trailing-DD force-close (flattens winners) or a
  false Layer-2 DLL halt (blocks a healthy account), and understates promotion-gate `finalPnl`.

**Evidence (repro executed as a test, not just derived on paper):** RED-proofed by temporarily
reverting the fix in place (Edit tool, never `git stash` per
`feedback_worktree_stash_near_miss_2026_07_12`) and re-running
`paper-execution-service.f4-samebar-partial-full-equity.test.ts` — the capital-safety invariant
assertion failed by **exactly 100** (`expected 18.53 to be close to 118.53, received difference is
100`), matching the derived bug magnitude (`Pm*(1/2) = 200*0.5 = 100`) precisely. Fix re-applied,
test GREEN again; full 211-test `paper-execution-service*.test.ts` suite GREEN (no regressions).

**Independent verify performed by this session (doer, not grader — flagged UNVERIFIED until the
independent accuracy-validator re-derives):**
- Confirmed `bookPartialClose` never reads the JS-side `previousUnrealizedPnl` field — it always
  re-reads the row-locked DB value under its own `SELECT ... FOR UPDATE` claim
  (`paper-execution-service.ts:3877-3887`). So this fix is provably a NO-OP for the "correct-by-
  construction" double-partial/runner-stays-open case (a 9-contract position where TP2 leaves a
  3-contract runner open) — covered by a second test in the same file asserting byte-identical
  behavior (2 trade rows via `bookPartialClose`, never via `closePosition`, `capturedTxPositionUpdates`
  has no `closedAt` field).
- Confirmed the 3 other call sites that already correctly pass `precedingUnrealizedPnl` from the
  ORIGINAL (not F4-reconstructed) `pos` object (`applyExitDecision`'s own TP1-full-close and
  TP2-full-close branches, and the intrabar stop-breach block) are untouched — the fix is scoped to
  ONLY the F4 block's local `updatedPos` construction.

---

## Blast radius

- **Which certifications / baselines / frozen refs this invalidates:** none. No frozen-policy hash,
  no golden fixture, no certified band depends on paper-session equity arithmetic for this specific
  same-bar chained pattern — the bug was silently understating equity/`realizedPeakEquity` on a
  rare-but-reachable pattern (any 2-contract Style-C position that crosses both TP1 and TP2 within
  one bar), not a value anything has certified against.
- **Which downstream consumers change behavior:** `paper-risk-gate.ts` / `kill-switch.ts` (trailing-
  DD reads of `realizedPeakEquity`), promotion-gate `finalPnl` computation, and any dashboard/
  analytics reading `paper_sessions.currentEquity`/`realizedPeakEquity` for a session that hits this
  pattern. All move in the CORRECTING direction (understated equity -> correct equity) — strictly
  safer, never introduces a NEW over-credit.
- **Pre-live scope:** paper trading is the trust boundary between backtest and live (per this
  agent's production mandate) but is itself pre-live — no real capital is exposed by this fix
  landing directly (no flag gate needed, unlike the backtest-side sizing/stop-parity opt-ins that
  re-baseline HISTORICAL comparability). Going forward, any live paper session that reaches this
  exact pattern gets correct equity instead of a permanently-understated one.

## Scope-locked change (IMPLEMENTED)

**In scope (implemented):**
- `src/server/services/paper-execution-service.ts` — inside the F4 block
  (`if (!positionClosed && handlerResult.decision === "FILL_TP1_50PCT")`), compute
  `f4ResidualPrecedingUnrealizedPnl = prevUnrealized - unrealizedPnl * (tp1ClosedCount /
  pos.contracts)` (the pre-bar P0 minus the TP1-closed portion's proportional share of this bar's
  fresh N-basis unrealized) and set it onto `updatedPos.previousUnrealizedPnl` (stringified, matching
  the numeric-column convention) before the second `callExitHandler`/`applyExitDecision` call.
- New regression test `paper-execution-service.f4-samebar-partial-full-equity.test.ts` (2 tests): the
  worked-example capital-safety invariant, and the double-partial/runner-stays-open byte-identical
  guard.

**Explicitly OUT of scope (not touched):**
- `closePosition`'s `precedingUnrealizedPnlOverride` contract itself (84490aa5) — unchanged.
- `bookPartialClose`'s proportional-split + rebase (8db9ff19) — unchanged; it never reads the field
  this fix sets, by design (proven via the second test).
- The pre-existing, separate divergence between the F4 block's own naive `tp1ClosedCount =
  Math.floor(pos.contracts * 0.33)` fraction calc and the REAL TP1 close count (which is computed
  via `styleCScaleOut(originalContractsTp1).tp1` inside `applyExitDecision`'s own FILL_TP1_50PCT
  branch, and can differ from the naive fraction for N >= 4 — e.g. N=9: naive floor(9*0.33)=2 vs
  real `styleCScaleOut(9).tp1`=3). This is a PRE-EXISTING bug already affecting `updatedPos.contracts`
  (used for the F4 re-invocation's `tp1_filled`/contract-count context) independent of equity math;
  this fix's `c1` term reuses the SAME (already-fallible) `tp1ClosedCount` value the code already
  uses for `updatedPos.contracts`, so it stays internally self-consistent and does not introduce a
  NEW divergence — but does not fix the pre-existing one. Flagged below as a known remaining risk,
  not fixed here (would expand blast radius beyond the equity-interaction bug this packet targets).
- No env flag / opt-in gate added — this is a straight correctness fix (wrong number -> right
  number), not a new default behavior; unlike the backtest-side historical-comparability opt-ins,
  paper-session equity has no "legacy comparable baseline" to preserve.

## Verification plan (executed)

1. `tsc --noEmit` on the touched file + new test file: **0 errors** (exit 0), both before and after
   the fix.
2. New RED-proof test `paper-execution-service.f4-samebar-partial-full-equity.test.ts`:
   - Test 1 asserts the capital-safety invariant (`sum of both legs' equity deltas == true total
     realized - P0`), the exact residual-basis formula, and a regression guard that the delta is
     NOT the pre-fix (`netPnl - P0`) value.
   - Test 2 proves the double-partial/runner-stays-open case is byte-identical (fix is a no-op for
     any close reached via `bookPartialClose`).
   - RED-proof executed: reverted the `previousUnrealizedPnl` override line in place (never `git
     stash`), re-ran the suite -> Test 1 failed by exactly 100 (the derived bug magnitude), Test 2
     still passed (confirming the fix's blast radius is exactly the F4-chained-full-close case).
     Fix re-applied -> both tests GREEN again.
3. Full regression suite: `node node_modules/vitest/vitest.mjs run
   src/server/services/paper-execution-service*.test.ts` -> **20 files, 211 tests, all GREEN** — no
   regressions in any of the 18 pre-existing paper-execution-service test files, including the two
   freshscan6 equity-fix regression suites this fix reconciles with.
4. Independent grade (doer != grader) — **PENDING**, required before land. This packet + the exact
   diff + test output are the receipt for that grade.

## Rollback

Single-commit revert on this branch (not yet committed — per instructions this change is staged,
not landed). No env flag exists to kill at runtime (none was needed — see scope note above); if a
runtime kill is desired without a code revert, the F4 same-bar re-invocation block itself already
has no independent kill switch (it is gated only by `exitBarContext` presence and
`isPipelineActive()`, both pre-existing, unrelated to this fix) — reverting the single `Edit` that
added `f4ResidualPrecedingUnrealizedPnl` and the `previousUnrealizedPnl` field on `updatedPos`
fully restores pre-fix behavior (proven via the RED-proof above, which is exactly that revert).

---

## Residual risks / known remaining gaps (for the independent grader)

- The pre-existing `tp1ClosedCount` naive-fraction-vs-`styleCScaleOut` divergence noted above (out
  of scope) means `updatedPos.contracts` — and therefore this fix's `c1` term — can be wrong for
  N >= 4 positions where TP1's REAL close count differs from the F4 block's own naive recomputation.
  For N=2 (the confirmed-reachable repro case) both computations agree, so the fix is exact for the
  case it was built to close; for larger N the fix is internally self-consistent with the existing
  (already-fallible) contract-count tracking but does not independently verify against the real TP1
  leg size.
- This fix does not address the broader, pre-existing simplification that BOTH TP1 and TP2 book at
  the SAME `currentPrice` (bar close) when they fire in the same bar via F4 — a separate parity
  question (paper books both legs at one price; a more realistic model might use distinct intrabar
  touch prices) unrelated to the equity-accounting bug this packet fixes.
- Recommended next parity improvement: a dedicated pass to make the F4 block's `tp1ClosedCount`
  call the SAME `styleCScaleOut`-based helper `applyExitDecision`'s own TP1 branch uses, closing the
  pre-existing divergence noted above (would also require re-verifying this fix's formula composes
  correctly with that change).

---

## Plain-English summary for the operator (standing veto; NOT a code decision)

When one of your positions gets trimmed down to 2 contracts (happens automatically sometimes — a
size-taper, a daily-loss-limit dial-down, or a drawdown cap) and then BOTH of your profit targets
get hit in the very same price update, the system was under-counting how much money you actually
made — by exactly the dollar amount of unrealized profit sitting on the contract that closed first.
The trade itself was booked correctly (you got paid the right amount), but the ACCOUNT BALANCE the
safety system reads afterward was short by that amount, permanently, for that trade. Because that
balance feeds the "how close am I to breaching the drawdown limit" check, this could have made the
system think you were closer to a firm-rule breach than you really were — potentially forcing a
winning position closed early, or pausing trading, when neither was actually necessary.

This fix makes the account balance land on the correct number in that specific situation. It does
not change how trades are entered, sized, or exited — only the bookkeeping after a rare two-target-
in-one-tick sequence. Nothing live is trading real money yet, so there is no immediate capital
impact; this closes a gap before it could ever matter. **No action needed from you right now** — an
independent review of this fix is queued next per your standing rule (I don't grade my own work).
