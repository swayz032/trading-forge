# Ratify-Packet — freshscan11 F-3 (2026-07-12): exit-slippage session uses WALL-CLOCK, not the bar

**STATUS: STAGED, NOT STARTED. Zero code written. CRITICAL capital-safety — instrument surface (fill/P&L/slippage). Independent-grader-found.**

Base: origin/hardening/phase-0 (found while grading `98d87367`/`edfa7edf`). Subsystem: paper-execution fill/slippage.
Pre-existing since `13247bcc1` (2026-06-28) — NOT introduced by any freshscan11 commit.

> **How it surfaced (the receipt):** freshscan11's F4 equity tests (and 2 sibling equity-double-count
> tests) began failing DETERMINISTICALLY after the 2026-07-12 power outage / tower reboot, with the
> realized net P&L flipping NEGATIVE (`-47.06`, `-87.06`, `-76.24` — all `×/17`). Root-caused by the
> independent accuracy-validator: the exit-slippage SESSION is classified from `new Date()` (real
> wall-clock at code-execution time), not the market bar being processed. Post-outage catch-up
> processed backlogged bars at a wall-clock that mapped to the CME maintenance halt window, applying a
> 100× slippage multiplier. The test fix (drop the spurious `netPnl > 0` sanity assertions) correctly
> unmasked this — it did NOT hide it; this packet tracks the real defect.

## F-3 — CRITICAL (instrument: fill/slippage/P&L)

**File:** `src/server/services/paper-execution-service.ts` — `bookPartialClose` (~3834-3836, NO `barTimestamp` param exists) + 8 internal `closePosition` callers that omit `context.barTimestamp` (~4254, 4364, 4487, 4735, 5082-5086, 5735, 5793) — subsystem: capital-safety / paper-vs-backtest parity.

**1. What & why (defect + receipt):** `bookPartialClose` computes `closeTimestamp = new Date()` and feeds it to `classifySessionType()` → session multiplier → `calculateSlippage()`. `classifySessionType` (~677-690) maps 16:00–17:00 ET to `CME_HALT`, and `calculateSlippage` (~512-547) applies up to a **100× multiplier** for that window. So exit slippage — and therefore realized P&L — depends on the WALL-CLOCK at the moment the code runs, NOT on the bar being replayed.
> Repro (source arithmetic replica, grader-run): baseSlippageTicks=1 MES → RTH $0.25/contract; at real-world 16:30 ET → `CME_HALT` 100× → $25/contract. Enough to flip the sign of a small partial-close P&L.
> `closePosition` DOES have a `context.barTimestamp` param (~2525) but only `paper-signal-service.ts`'s 5 call sites populate it; the 8 internal `updatePositionPrices`/`applyExitDecision`/F4 call sites never do. `bookPartialClose` has no such param at all.

**Independent verify (accuracy-validator, F-2 grade pass):** CONFIRMED CRITICAL. Sources compared: `closePosition`'s bar-time-aware param (correctly threaded by `paper-signal-service.ts`) vs. the same function's 8 internal callers that omit it vs. `bookPartialClose` which lacks the param — all three disagree on the exact TP1/TP2/time-stop/F4 exit path. Source of truth = bar-time-aware. `git blame` → `13247bcc1` 2026-06-28.

**2. Blast radius:** EVERY TP1/TP2 partial close + Style-C-driven full close (time-stop, F4-chained close) — the primary production exit mechanism (§4 Style C). Non-deterministic, non-replay-safe P&L whenever `updatePositionPrices` processes backlogged bars (post-outage catch-up — the exact scenario that surfaced this) OR a close lands in real 16:00–17:00 ET. Feeds `currentEquity` and the one-way `realizedPeakEquity` (Topstep trailing-DD HWM) ratchet — permanent, never self-correcting. Also breaks paper-vs-backtest parity (backtest uses bar time). A fix re-baselines paper-slippage on affected exits.

**3. Scope-locked change (PROPOSED — do not implement until this packet is graded):**
- Add a real bar `Date` to `StyleExitBarContext` (~3332-3335).
- Thread it from `updatePositionPrices`'s callers (`paper.ts:581`, `paper-trading-stream.ts:360`) into `closePosition`'s `context.barTimestamp` at all 8 internal call sites.
- Add a `barTimestamp` parameter to `bookPartialClose` and use it (fallback to `new Date()` ONLY when genuinely live-real-time with no bar time, documented).
- OUT of scope: `classifySessionType` / `calculateSlippage` internals (correct given the right time); `paper-signal-service.ts`'s already-correct 5 call sites; the slippage magnitude model itself.

**4. Verification plan:** A/B on a fixture where the same bar is processed at two different wall-clocks — must produce IDENTICAL slippage/P&L after the fix (currently differs by up to 100×). Unit test: `bookPartialClose` + each internal `closePosition` caller classifies session from bar time, not `new Date()`. Replay-determinism test: reprocessing backlogged bars yields identical P&L regardless of when run. Independent grade (doer≠grader).

**5. Rollback:** single-commit revert. Consider gating behind `PAPER_EXIT_SLIPPAGE_BARTIME_ENABLED` (default ON once graded, mirroring the parity-flag pattern) so the re-baseline is auditable, since it alters realized paper P&L on affected exits.

## Plain-English summary for the operator

Right now, when the bot closes part of a trade, it decides how much "slippage" (hidden cost) to apply
based on **what time it is on the wall clock when the code runs** — not what time the actual market bar
was. Normally these match (the bot processes bars as they arrive), so it's usually fine. But when the
tower reboots after a power outage and has to catch up on a backlog of bars, or if a close happens to
land in the 4–5 PM ET exchange-maintenance hour, the bot applies a slippage cost up to **100× too big**,
which can flip a winning partial trade into a recorded loss and corrupt the account's high-water-mark
(the number your Topstep trailing-drawdown limit watches). This is a real, pre-existing bug (since
2026-06-28), it's what made the tests go haywire after today's power outage, and it's staged here for a
proper fix in a fresh session — it needs bar-time threaded through ~10 code spots and re-verification, so
it should NOT be rushed at the end of a long day. **No live capital is at risk today (nothing is live-trading),
but this must be fixed before any live/PAPER+ run.**
