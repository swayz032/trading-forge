# Ratify-Packet — freshscan11 F-3 (2026-07-12): exit-slippage session uses WALL-CLOCK, not the bar

**STATUS: CLOSED — LANDED 2026-07-16 (campaign W1). Implemented + class-extended (bookPartialClose day-key sibling) + hardened (2 time-fragile regression guards pinned) + INDEPENDENTLY GRADED band 7 VERIFIED SAFE-TO-LAND (accuracy-validator, doer≠grader, 2 non-overlapping re-derivation paths, genuine RED-proof, scope-lock byte-clean, independent class-sweep found no missed sibling) + parent final-verify (tsc exit 0, 223/223 vitest). CRITICAL capital-safety — instrument surface (fill/P&L/slippage). Scope was re-verified against `hardening/phase-0` @ `61bb20a3` (unchanged from stage-time).**

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

**5. Rollback:** single-commit revert.

---

## AMENDMENT (2026-07-16, campaign W1 — scope re-verified + design-refined; supersedes the "consider gating" suggestion in part 5)

**Re-anchored @ `61bb20a3` (unchanged from stage-time): `classifySessionType` :677, CME_HALT :684, `sessionMult = 100.0` :542, `bookPartialClose` `new Date()` :3834.**

**A. NO env flag (supersedes part-5's `PAPER_EXIT_SLIPPAGE_BARTIME_ENABLED` suggestion).** Nothing is live; the internal simulator is pre-PAPER evidence only; the "legacy behavior" is nondeterministic-w.r.t.-processing-time, so there is no baseline worth preserving. A flag would be a one-env-edit knob that RESTORES a known CRITICAL, doubling the test matrix for negative value. Auditability is delivered per-trade instead: add a `exitSlippageTimeSource: "bar"|"wallclock"` span attribute at the `closePosition` slippage site + the landing SHA marks the boundary. (If the independent grader rules a flag mandatory, implement default-ON module-scope read isolated to the two `closeTimestamp` lines.)

**B. Corrected site disposition (design-agent, receipts-verified).** The stage-time "8 internal callers" list is refined:
- THREAD bar time (bar-driven): `bookPartialClose` gains `barTimestamp?: Date` (last param); `applyExitDecision` gains `barTimestamp?: Date`, threaded to its bookPartialClose(tp1/tp2) + closePosition(tp1-full/tp2-full/time-stop) sites; both `applyExitDecision` invocations pass `exitBarContext.barTimestamp`; the in-loop stop-breach `closePosition` passes `exitBarContext?.barTimestamp` (optional-chain preserves wall-clock for the bare `/prices` route).
- `StyleExitBarContext` gains `barTimestamp?: Date` — **verified NO Python-bridge impact** (`callExitHandler` builds subprocess state by explicit field picks, never serializes the interface). `paper-trading-stream.ts buildExitBarContext` already computes `new Date(bar.timestamp)` → add it to the ctx literal.
- **DOCUMENTED wall-clock-CORRECT (comment, no thread) — `:5383` roll handler is the CORRECTION to the stage-time list: its sole production caller is the 16:30 ET scheduler cron (real-time), so wall-clock is correct; it gets the optional `barTimestamp` param for class-closure only.** Also documented-correct: `forceCloseAllPositions` (kill-switch real-time), `routes/paper.ts` manual/external close, `feed-silence-service.ts` (feed silent → no bar exists).

**C. Rider added to scope — `closedAt = new Date()` (~:2561) trading-day attribution.** On the D5 delayed feed, a bar stamped 16:55 ET arrives ~17:05 wall-clock and books its close to the WRONG CME trading day (daily-cap counting + daily P&L breakdown). Derive `closedAt`'s trading-day from the same threaded bar time on bar-driven paths (wall-clock on genuinely-real-time paths, same disposition table). Adds a unit test (bar 16:55 ET arriving 17:05 wall → books to the BAR's trading day).

**D. D5 escalation (why this is the hard prerequisite for the Massive $29 switch):** on a 10-min-delayed feed, bars stamped 15:50–16:00 ET arrive 16:00–16:10 wall-clock — INSIDE the CME_HALT window — so the wall-clock bug would 100× essentially EVERY end-of-day exit, EVERY day, not just post-outage. No Massive subscription payment until this lands.

**E. Restore the 3 neutered assertions:** the freshscan11 `netPnl > 0` waivers (f4-samebar, bookpartialclose-equity, equity-double-count) become deterministic again post-fix and are restored as standing F-3 regression guards (fixture gross P&L dwarfs RTH slippage ~$1.47/contract).

**Adjacent class flagged, NOT in scope (future packet candidate):** the 16:30 ET roll sweep intentionally prices flattens inside the 100× CME_HALT window (product decision: move sweep pre-16:00?).

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
