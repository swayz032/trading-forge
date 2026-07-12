# Ratify-Packet — freshscan11 CONFIRMED CRITICAL (2026-07-12): F4 same-bar TP1 contracts-column corruption

**STATUS: IMPLEMENTED. Staged for independent grade (doer != grader).** Per the operator-amended
`ratify-packet` skill (2026-07-11): this is the autonomous class, not the irreversible/live-capital
class — Trading Forge is pre-live (nothing trading real capital yet, by design; see memory
`feedback_pre_live_by_design_not_a_gap`), and this is a straight correctness fix (wrong contract
count -> right contract count) to existing paper-execution state, not a new behavior requiring an
opt-in flag. It proceeds: stage packet -> implement (done, this commit) -> independent grader
re-derives correctness -> post-hoc summary to the operator (standing veto). No permission-wait. This
packet is the receipt the independent grader rules on.

Base: `wt-ds-goalfix` worktree, tip `edfa7edf` = `origin/hardening/phase-0` (this fix is PRE-EXISTING,
not introduced by `edfa7edf`'s F4 equity fix — it shares the same F4 same-bar block but is an
independent, previously-undiscovered defect in that block's OWN `tp1ClosedCount` computation).

> **Relationship to prior findings:** an independent accuracy-validator found this while grading the
> `edfa7edf` F4 equity fix (`freshscan11-2026-07-12-samebar-partial-full-equity.md`). That packet's
> own "Residual risks" section had already flagged the exact gap this packet closes: *"The
> pre-existing `tp1ClosedCount` naive-fraction-vs-`styleCScaleOut` divergence... means
> `updatedPos.contracts` — and therefore [the equity fix's] `c1` term — can be wrong for N >= 4
> positions..."* and recommended *"a dedicated pass to make the F4 block's `tp1ClosedCount` call the
> SAME `styleCScaleOut`-based helper `applyExitDecision`'s own TP1 branch uses."* This packet is that
> dedicated pass. Neither prior fix (`84490aa5` closePosition, `8db9ff19` bookPartialClose, or
> `edfa7edf`'s own F4 equity-residual fix) is being reverted or re-derived — this fix corrects the
> INPUT (`tp1ClosedCount`) those fixes' formulas consume, which also makes the `edfa7edf` equity
> invariant hold exactly for N != 2 (previously only proven exact at N=2, where naive and real
> happened to coincide).

---

## What & why now (defect + receipt)

**File:** `src/server/services/paper-execution-service.ts` — the F4 same-bar re-invocation block
inside `updatePositionPrices` (`if (!positionClosed && handlerResult.decision ===
"FILL_TP1_50PCT")`, `~5011-5039`), specifically the pre-existing `tp1ClosedCount` computation.

**The bug (contracts-column corruption, CONFIRMED CRITICAL):** the F4 block computed
`tp1ClosedCount` via a NAIVE fraction (`Math.max(1, Math.floor(pos.contracts * 0.33))`), but
`applyExitDecision`'s OWN `FILL_TP1_50PCT` branch (`~4171-4174`, invoked a few lines above this
block, in the SAME bar) books the actual TP1 close via the cumulative-rounding helper
`styleCScaleOut(pos.entryContracts).tp1` (`src/server/lib/style-c-scaleout.ts`). These two values
DIVERGE for every N where `Math.floor(N*0.33) != styleCScaleOut(N).tp1` — enumerated below,
confirming the divergence set includes the operator's canonical pyramid sizes (base 9 MES/MNQ, +3
per tier -> 9,12,15,18,21; CLAUDE.md §4):

```
N=1  SAME  (naive=1, real=1)      N=13 SAME  (naive=4, real=4)
N=2  SAME  (naive=1, real=1)      N=14 DIVERGES (naive=4, real=5)
N=3  SAME  (naive=1, real=1)      N=15 DIVERGES (naive=4, real=5)  <- pyramid tier
N=4  SAME  (naive=1, real=1)      N=16 SAME  (naive=5, real=5)
N=5  DIVERGES (naive=1, real=2)   N=17 DIVERGES (naive=5, real=6)
N=6  DIVERGES (naive=1, real=2)   N=18 DIVERGES (naive=5, real=6)  <- pyramid tier
N=7  SAME  (naive=2, real=2)      N=19 SAME  (naive=6, real=6)
N=8  DIVERGES (naive=2, real=3)   N=20 DIVERGES (naive=6, real=7)
N=9  DIVERGES (naive=2, real=3)   <- pyramid base   N=21 DIVERGES (naive=6, real=7) <- pyramid tier
N=10 SAME  (naive=3, real=3)      N=22 SAME  (naive=7, real=7)
N=11 DIVERGES (naive=3, real=4)   N=23 DIVERGES (naive=7, real=8)
N=12 DIVERGES (naive=3, real=4)  <- pyramid tier    N=24 DIVERGES (naive=7, real=8)
                                   N=25 SAME  (naive=8, real=8)
```
(Enumerated via `node -e` executing both formulas side-by-side; reproduced in the ratify-packet
verification below.)

**Consequence:** the F4 block builds `updatedPos.contracts = pos.contracts - tp1ClosedCount`
(`~5077`) from the WRONG naive count. When the F4-reinvoked TP2 is a PARTIAL (runner stays open —
the normal case for N>=3), `applyExitDecision`'s `FILL_TP2` partial branch computes
`positionStateUpdate.contracts = updatedPos.contracts - contractsToClose` (`~4303`) and
`bookPartialClose` spreads that verbatim into the DB write (`~4013-4019`) — `bookPartialClose`'s own
correctly-computed remaining count (`totalContractsBeforeClose - contractsToClose`, from its
row-locked claim) is used ONLY to rebase `previousUnrealizedPnl`, NEVER to correct `.contracts`
(`~3942-3962`).

**Worked example N=9** (real `styleCScaleOut(9)={tp1:3,tp2:3,runner:3}`): F4's naive
`tp1ClosedCount=Math.floor(9*0.33)=2` -> `updatedPos.contracts=9-2=7` (should be `9-3=6`) -> TP2's
`positionStateUpdate.contracts = 7-3=4` is persisted, when the TRUE remaining runner is
`9-3-3=3`. **A phantom contract is written to `paperPositions.contracts` PERMANENTLY.**

**Blast radius:** the corrupted `.contracts` feeds every later bar's MTM
(`unrealizedPnl = direction x (price-entry) x pointValue x pos.contracts`, `~4599`), permanently
overstating the runner's unrealized P&L + `currentEquity` + `realizedPeakEquity` (the Topstep/Apex
trailing-DD high-water-mark) — the OPPOSITE direction from the `edfa7edf` equity-residual fix (which
under-stated), so this is a distinct failure mode, not a duplicate. Also overstates final realized
P&L when the runner eventually closes (commission/P&L computed against a phantom extra contract),
distorting promotion-gate `finalPnl` and any live-copy sizing math that reads `paperPositions
.contracts` mid-trade. Reachable at the operator's real position sizes (9/12/15/18/21).

**Evidence (repro executed as a test, not just derived on paper):** extended the existing N=9
double-partial fixture in `paper-execution-service.f4-samebar-partial-full-equity.test.ts`
(`~382-426`, grader-specified repro) with two new assertions:
```
expect(capturedTxPositionUpdates[0].contracts).toBe(6); // TP1 leg: 9 - styleCScaleOut(9).tp1(3)
expect(capturedTxPositionUpdates[1].contracts).toBe(3); // TP2 leg: TRUE runner (was 4 pre-fix)
```
RED-proofed by temporarily reverting the fix in place (Edit tool, never `git stash` per
`feedback_worktree_stash_near_miss_2026_07_12`): the second assertion failed with
`expected 4 to be 3` — the EXACT phantom-contract magnitude derived above. Fix re-applied, test
GREEN again.

---

## Blast radius

- **Which certifications / baselines / frozen refs this invalidates:** none. No frozen-policy hash,
  golden fixture, or certified band depends on the F4 same-bar re-invocation's contract-count
  bookkeeping — the bug silently overstated `.contracts` on a reachable-but-narrow pattern (any
  position that fires TP1 then a same-bar TP2 PARTIAL, at a size where naive-floor and
  `styleCScaleOut` diverge), not a value anything has certified against.
- **Which downstream consumers change behavior:** every subsequent bar's MTM `unrealizedPnl`
  computation for the runner leg (`~4599`), `currentEquity`/`realizedPeakEquity` (read by
  `paper-risk-gate.ts` / `kill-switch.ts` for trailing-DD), the runner's eventual realized P&L at
  final close (commission + gross P&L both scale with `.contracts`), and promotion-gate `finalPnl`.
  All move in the CORRECTING direction (overstated contracts/equity -> correct) — strictly safer,
  never introduces a NEW under-credit. Also corrects the `edfa7edf` equity-residual fix's own `c1`
  term (`tp1ClosedCount` feeds `f4ResidualPrecedingUnrealizedPnl = P0 - Pm*(c1/N)` directly) so that
  fix's capital-safety invariant now holds exactly for every N, not only N=2.
- **Pre-live scope:** no real capital is exposed by this fix landing directly. Going forward, any
  live paper session that reaches this exact pattern at a divergent N (including every operator
  pyramid-tier size) gets a correct `.contracts` value instead of a permanently-inflated one.

## Scope-locked change (IMPLEMENTED)

**In scope (implemented):**
- `src/server/services/paper-execution-service.ts` — inside the F4 block, replaced the naive-fraction
  `tp1ClosedCount` computation with the SAME authoritative source `applyExitDecision`'s own
  `FILL_TP1_50PCT` branch (`~4171-4174`) uses: `styleCScaleOut((pos.entryContracts ?? pos.contracts))
  .tp1` for Style C (`Math.max(1, ...)`), preserving the legacy `Math.max(1, Math.floor(pos.contracts
  * 0.50))` fallback for Style D (dead per CLAUDE.md §2b, kept byte-identical — its own
  `contractsToClose` calc in `applyExitDecision` is unaffected by the Style-C `styleCScaleOut` change
  and this fallback matches it exactly).
- Corrected the misleading code comment (grader F-1) that stated `styleCScaleOut(2)=
  {tp1:1,tp2:1,runner:0}` (real value: `{tp1:1,tp2:0,runner:1}`) and "true realized total is
  50+200=start+250" (200 was `Pm`, a 2-contract MTM snapshot, not TP2's actual 1-contract realized
  amount) — replaced the specific wrong worked numbers with the symbolic invariant:
  `equityDelta_tp1 + equityDelta_tp2 = netPnl_tp1 + netPnl_tp2 - P0`, with `Pm` proven to be a pure
  accounting intermediate that cancels exactly across the two legs, and an explicit note that this
  cancellation is only exact when `c1` matches what `bookPartialClose`'s TP1 leg actually used — i.e.
  this fix is required for the `edfa7edf` equity invariant to hold for N != 2, not only for the
  contracts-column corruption.
- Extended `paper-execution-service.f4-samebar-partial-full-equity.test.ts`'s existing N=9
  double-partial fixture with 2 assertions on `capturedTxPositionUpdates[0].contracts` (6) and
  `capturedTxPositionUpdates[1].contracts` (3, was 4 pre-fix) — the grader-specified repro.

**Explicitly OUT of scope (not touched):**
- `closePosition`'s `precedingUnrealizedPnlOverride` contract (`84490aa5`) — unchanged.
- `bookPartialClose`'s proportional-split + rebase (`8db9ff19`) — unchanged.
- The `edfa7edf` F4 equity-residual formula itself
  (`f4ResidualPrecedingUnrealizedPnl = prevUnrealized - unrealizedPnl * (tp1ClosedCount /
  pos.contracts)`) — unchanged in SHAPE; it now receives a correct `tp1ClosedCount` input instead of
  the naive one, which is exactly the fix, not a reformulation.
- `applyExitDecision`'s own `FILL_TP1_50PCT`/`FILL_TP2` branches (`~4161-4360`) — unchanged; they
  already used `styleCScaleOut` correctly (freshscan6 HIGH#5) and are the SOURCE this fix now matches.
- No env flag / opt-in gate added — straight correctness fix (wrong count -> right count), matching
  `edfa7edf`'s own no-flag precedent for this exact code block; paper-session contract-count
  bookkeeping has no "legacy comparable baseline" to preserve.

## Verification plan (executed)

1. Enumerated naive-vs-`styleCScaleOut` divergence for N=1..25 via a standalone Node script
   (reproducing `styleCScaleOut`'s exact cumulative-rounding logic) — confirmed the divergence set
   (N=5,6,8,9,11,12,14,15,17,18,20,21,23,24) and the agreement set (N=1,2,3,4,7,10,13,16,19,22,25)
   exactly matches the task's stated repro list, including all 5 operator pyramid sizes (9,12,15,18,
   21) landing in the DIVERGES set.
2. RED-proof: reverted the fix in place (temporarily restored the naive-fraction formula, `void`-ed
   the now-unused `originalContractsTp1` binding to keep `tsc` clean during the revert), re-ran
   `paper-execution-service.f4-samebar-partial-full-equity.test.ts` -> the new N=9 assertion failed
   with `expected 4 to be 3` (exact derived phantom-contract magnitude); the first test (N=2 equity
   invariant) stayed GREEN, confirming N=2 is byte-identical pre/post-fix as required. Fix re-applied
   -> both tests GREEN again.
3. `tsc --noEmit` (real binary, `node node_modules/typescript/bin/tsc --noEmit -p .`, not the `npx`
   troll-stub per `worktree-session` skill) -> **0 errors, exit 0**.
4. Full regression suite: `node node_modules/vitest/vitest.mjs run
   src/server/services/paper-execution-service` -> **20 files, 211 tests, all GREEN** — no
   regressions in any pre-existing paper-execution-service test file, including the two freshscan6
   equity-fix regression suites (`bookpartialclose-equity-double-count`, `equity-double-count`) and
   the `edfa7edf` F4 equity-residual suite (`f4-samebar-partial-full-equity`, HIGH#1 N=2 case
   unaffected — confirmed both by the naive/real agreement table above and by the test staying
   green through the RED-proof).
5. Ran the dedicated `style-c-scaleout` unit suite
   (`src/server/__tests__/deepscan-freshscan-style-c-scaleout.test.ts`) -> **4 tests, all GREEN**
   (unmodified by this fix — confirms the helper itself is untouched, only its NEW caller in F4).
6. Independent grade (doer != grader) — **PENDING**, required before land. This packet + the exact
   diff + test output are the receipt for that grade.

## Rollback

Single-commit revert on this branch (not yet committed — per instructions this change is staged, not
landed). No env flag exists to kill at runtime (none was needed — see scope note above; matches
`edfa7edf`'s own precedent for this code block). Reverting the single `Edit` that replaced the naive
`tp1ClosedCount` formula with the `styleCScaleOut`-based one (and the paired comment correction and
test assertions) fully restores pre-fix behavior — proven via the RED-proof above, which is exactly
that revert.

---

## Residual risks / known remaining gaps (for the independent grader)

- This fix corrects `tp1ClosedCount` for the F4 block's OWN re-invocation logic. It does NOT
  independently re-verify that `applyExitDecision`'s FIRST call (the one a few lines above the F4
  block, `~4989`) and this F4-derived value stay in lockstep under every future code change to either
  site — both now call `styleCScaleOut` with the same `originalContractsTp1` derivation, but they are
  two separate call sites, not a single shared helper invocation. A future edit to one without the
  other would silently reintroduce a narrower version of this class of bug. Recommended follow-up (not
  done here, to keep this fix scope-locked): factor the `originalContractsTp1` + `tp1ClosedCount`
  derivation into a single exported helper both `applyExitDecision`'s FILL_TP1 branch and the F4 block
  call, so there is exactly one place this computation can drift.
- The `tp1ClosedCount / pos.contracts` denominator in the equity-residual formula (unchanged by this
  fix) uses `pos.contracts` (the pre-bar remaining count), not `originalContractsTp1`
  (`pos.entryContracts`). These are expected to be equal in the normal Style C flow (TP1 is always the
  FIRST leg to fire, so no prior partial close can have reduced `pos.contracts` below
  `entryContracts` before this block runs) — this fix does not add a runtime assertion of that
  invariant. If a future change allows some OTHER partial-close path to fire before TP1 on the same
  position, this denominator would silently use the wrong N. Out of scope for this narrowly-targeted
  fix; flagged for the independent grader's judgment on whether a defensive assertion is warranted.
- This fix does not address the broader question of whether the F4 block should instead re-read the
  position from the DB after the first `applyExitDecision` call (eliminating the need to reconstruct
  `updatedPos` in memory at all) — the existing code comment (`~5004-5010`, unchanged) documents a
  deliberate prior decision to avoid that DB round-trip for race-safety/efficiency reasons; this fix
  works within that existing design rather than re-opening it.

---

## Plain-English summary for the operator (standing veto; NOT a code decision)

When one of your positions hits its first profit target (TP1) and then, in that same price update,
also hits its second target in a way that leaves some contracts still open (the normal case at your
real position sizes — 9, 12, 15, 18, or 21 contracts), the system was miscounting how many contracts
were actually left running. It would write down one extra "phantom" contract that doesn't really
exist, permanently, into that trade's record. From then on, every price update for that remaining
position calculated profit/loss as if you had one more contract than you actually do — overstating
your paper account balance and the safety system's drawdown-tracking number. Because that number
feeds the "how close am I to breaching the drawdown limit" check, an overstated balance could make
the system think you have MORE room than you really do — the opposite (and more dangerous) direction
from a prior bug fixed today, which under-counted. This one over-counts.

This fix makes the contract count land on the correct number every time, matching exactly what was
actually bought and sold. It does not change how trades are entered, sized, or exited — only the
bookkeeping of how many contracts remain open after a same-tick double-target sequence. Nothing live
is trading real money yet, so there is no immediate capital impact; this closes a gap before it could
ever matter, and specifically closes it for your real trade sizes (9/12/15/18/21), which is why an
independent reviewer flagged it as more urgent than the equity-only bug fixed earlier today.
**No action needed from you right now** — an independent review of this fix is queued next per your
standing rule (I don't grade my own work).
