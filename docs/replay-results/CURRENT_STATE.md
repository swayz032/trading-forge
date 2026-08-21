# CURRENT_STATE

**NAVIGATION POINTER — NOT AUTHORITY.** If this file disagrees with the newest ruling on
`external-advisor/gpt-rulings`, the repository wins. The authoritative ruling channel is
`origin/external-advisor/gpt-rulings` (AR-1382A section 8) — resolve the newest ruling by THAT
branch's commit time (`git log -1 --format="%H %ad %s" --date=iso origin/external-advisor/gpt-rulings`),
never by filename or AR-number sort. A newer commit on `gpt-engineering` or any other
`external-advisor/*` branch does NOT become a ruling by being newer. See
`.claude/skills/worker-onboarding/SKILL.md` section 1.

- **Path deviation, disclosed:** AR-1381A section 8B asked for this file at
  `docs/governance/CURRENT_STATE.md`. Worker-1's guard `edit_scope` (`.claude/worker1-hook-guard-manifest.json`)
  does not cover `docs/governance/`; it does cover `docs/replay-results/`. Placed here instead of
  requesting a guard widening for a navigation file, matching the AR-1380A precedent on the
  `AGENT-LOGS.md` friction (widen nothing merely for logging ceremony). GPT/operator may relocate it
  if a wider path is authorized.

## Architecture stage

3 — Strategy Factory.

## Latest controlling GPT ruling

AR-1382A, `origin/external-advisor/gpt-rulings @ 188b41e39908518f8909f6e9e54a45c346813276`
(`advisor-reports/AR-1382A-GPT-EXTERNAL-ADVISOR-RULING-AR1390-PASS-WITH-SOURCE-FAITHFUL-OWNERSHIP-CORRECTION-TARGETED-VISION-3-2026-08-20.md`),
2026-08-20 20:21:49 -0400. Accepts AR-1390 (read-only compiler-readiness preflight) with one
load-bearing architecture correction, and authorizes targeted Visual Intelligence for three
questions.

**The correction matters:** Extraction Compiler Blueprint v4 SUPERSEDES the older scout-pipeline
assumption that stop/take-profit are always framework-owned. Source-taught stop/target MUST survive
in `SOURCE_FAITHFUL`; a Trading Forge overlay may be tested separately as `TF_OVERLAY_VARIANT` but
never reported as the educator's exact strategy. Framework fallback is allowed only for genuinely
untaught fields and must be provenance-stamped.

## Worker branch + last verified head

`claude/worker1-h1-20260815`, verified at `f92031b55b93efe4445449d731fd9e5c2581e4c6` (AR-1390 commit)
at the time AR-1382A was written; advances with each subsequent commit.

## Current locks (AR-1382A section 9)

- No hand-editing/reusing rejected E8 candidate SHA `b50729b928e51980088f2e4a73c30771eb3665147443753edcc8be44d5fb0041`.
- No blind Round-4 Opus reconstruction before visual evidence returns.
- No invented Fibonacci anchors, wick identity, HTF-range selector, BOS/FVG parameters, target ranking, expiry, or other source semantics.
- **No source-taught stop/target replacement by ATR/Style C inside `SOURCE_FAITHFUL`.**
- No new semantic-audit machinery absent a demonstrated new trust defect.
- No certifier/compiler promotion, SOURCE_FAITHFUL backtest, broad Factory rerun, 160-video intake, PAPER, or broker/Topstep/live.

## Exact next money-path action

**Lane A: CLOSED** (AR-1382A section 5 — do not run another compiler-readiness preflight cycle).

**Lane B: BLOCKED, awaiting GPT decision on an executor.** The three questions (VI-E8-1 sell-side
Fibonacci anchors, VI-E8-2 buy-side stop wick, VI-E8-3 4H premium/discount range construction) are
fully specified with exact derived timestamp windows in
`docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/visual-intelligence-e8-round1/E8Wg6tFPYjo/vi_task.json`.
**MEASURED (AR-1391): the "existing Visual Intelligence capability" AR-1382A section 6 points at does
not exist in this repository** — no frame extraction, no ffmpeg use, no vision runner; the only
occurrence of the phrase is a comment string. Worker-side media acquisition also failed on both
attempted paths (yt-dlp 403 across all clients even with a Node JS runtime; browser automation loads
the player and seeks correctly but media never buffers). Reported as a ruling-premise contradiction
rather than routed around.

**Lane C: WAIT on Lane B.** One fresh E8 candidate identity only after visual evidence returns —
never an edit of the rejected SHA. If any hard source blocker remains unresolved after the targeted
visual pass, emit an honest E8 source-completeness refusal and move to the next calibration source
(AR-1382A section 7 — "no endless reconstruction until green").

**Lane D: CLOSED.** This file plus the `worker-onboarding/SKILL.md` fixes (branch-head-by-commit-time
authority scan, the AR-1382A section 8 routing correction that `gpt-rulings` is authoritative and a
newer `gpt-engineering` commit is not a ruling, and the wrong-ref ear-arming warning in section 2a).
