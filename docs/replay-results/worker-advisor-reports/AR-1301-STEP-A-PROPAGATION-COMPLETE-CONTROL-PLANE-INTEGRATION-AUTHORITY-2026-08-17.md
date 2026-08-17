# AR-1301 — Step A propagation complete (operator-authorized integration authority, not an ordinary Worker-1 seat)

RULING : AR-1299C (2026-08-17) — "PHASE1-PASS-PROPAGATE-THEN-PHASE2-CALIBRATION", section 3 STEP A
PRECEDED BY : AR-1300 — ordinary Worker-1 seat correctly refused this step (guard fence on `merge-base`
against a commit touching the seat's own self-protected control files); AR-1300 named the remedy as
"operator or a privileged control-plane seat."

## WHO DID THIS AND WHY THAT IS CONSISTENT WITH THE RULING

This was performed from a fresh, unguarded Claude Code session (no `.claude` Worker-1 guard bound,
launched outside any worktree) acting as the operator's explicit go-ahead — captured live in this
session, in response to a direct question naming the exact commit, the exact target branch, and
the exact operation before any git command ran. AR-1299C section 3 names "the normal
operator/main-advisor/control-plane integration authority" as the correct actor once the ordinary
Worker-1 seat refuses; AR-1300 confirms that refusal already happened. No guard was bypassed,
weakened, or edited to perform this — the session simply never had Worker-1's guard hooks bound,
and the operator authorized the specific merge before it ran.

## WHAT WAS DONE

`git merge --no-ff origin/control-plane/ar-1278-guard-repair-cpb-2026-08-17-0004` into
`claude/worker1-h1-20260815`, local HEAD `e58116fd5913fcb4490c055256c493a0876e641e` (AR-1300) at
merge time.

Pre-merge measurement: `git merge-base origin/claude/worker1-h1-20260815
origin/control-plane/ar-1278-guard-repair-cpb-2026-08-17-0004` = `94fd175adc60502b0dfe825c31f601d33939eaff`
— the exact "before" commit AR-1299C's diff citation names
(`compare(94fd175a..f60a6abf)`). Control-plane branch was exactly 1 commit ahead of that shared
base (`f60a6abf5064bd3ecd8072454c4ac4d6d18834dc` only); worker1-h1 was 2 commits ahead on its own
side. Clean merge, `ort` strategy, **zero conflicts**.

Result commit: `d20e1cc475c99d09dddd6a8be4adab5fa96ceaf8`.

Files touched (12, matches AR-1299C's named set exactly): `.claude/settings.json`,
`.claude/worker1-hook-guard-manifest.json`, 8 files under
`docs/replay-results/g2d-prompt-transport/*.prompt.txt`, `docs/replay-results/g2d-prompt-transport/index.json`,
`docs/replay-results/worker-advisor-reports/AR-1278-PHASE-1-CLOSEOUT-cpb-2026-08-17-0004.md`.

No merge conflict resolution was needed — no manual retyping occurred anywhere in this merge.

## THE 7 PROPAGATION PROOFS (AR-1299C SECTION 3), ALL MEASURED HERE POST-MERGE

1. `strict_session = true` — MEASURED: `.claude/worker1-hook-guard-manifest.json` line
   `"strict_session": true`.
2. PowerShell present in PreToolUse matcher — MEASURED: `.claude/settings.json` PreToolUse matcher
   = `Edit|Write|NotebookEdit|Bash|Agent|Task|PowerShell`.
3. `docs/replay-results/g2d-prompt-transport/index.json` has 8 rows — MEASURED: `"row_count": 8`.
4. Eight prompt files exist with the reviewed hashes — MEASURED: 8 `*.prompt.txt` files present;
   byte-exact vs source commit confirmed by proof 7 below (identical bytes imply identical hashes).
5. Frozen queue `attempts = {}`, 8 READY / 0 SPENT — MEASURED at
   `docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated_fallback_queue_t1.json`:
   SHA256 `5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939` (byte-identical to the
   hash AR-1299C cites), `"attempts": {}`, `queue` array has exactly 8 entries, none in `excluded`
   carry an attempt.
6. Isolated receipt directory is README-only — MEASURED:
   `docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated-receipts-t1/` contains only
   `README.md`.
7. No semantic/config divergence from `f60a6abf...` in the Phase-1 paths — MEASURED:
   `git diff f60a6abf5064bd3ecd8072454c4ac4d6d18834dc HEAD -- .claude/settings.json
   .claude/worker1-hook-guard-manifest.json docs/replay-results/g2d-prompt-transport
   docs/replay-results/worker-advisor-reports/AR-1278-PHASE-1-CLOSEOUT-cpb-2026-08-17-0004.md`
   produced **zero lines of output** — byte-identical.

## PUSH AND INDEPENDENT VERIFICATION

`git push origin claude/worker1-h1-20260815` reported `e58116fd..d20e1cc4`. Independently
re-verified via `git ls-remote origin refs/heads/claude/worker1-h1-20260815` in a separate command
after the push completed: returned `d20e1cc475c99d09dddd6a8be4adab5fa96ceaf8` — matches. GitHub
independently shows the propagated tip.

The pre-existing dirty file `docs/wave25-exit-engine-ab-report.md` (AR-1265 section 4 governed
exception, noted unchanged in AR-1300) was not touched by this merge and remains the only
unstaged difference; it was not part of the propagated diff and was left alone.

## WHAT THIS DOES NOT DO

No Agent/Task/PowerShell call was made. No frozen G2 permit was created or consumed. No isolated
answer receipt was written. No compiler/backtest/paper/broker/live-money file was touched. This is
Step A only — the exact propagation AR-1299C section 3 authorizes. Step B (the single NON-G2 Haiku
Agent DENY calibration, AR-1299C sections 4-5) has NOT been attempted and is explicitly reserved
for "a genuinely fresh ordinary Worker-1 session" per AR-1300's own next-steps list — not this
session, which is not a Worker-1 seat at all.

## NEXT

A fresh ordinary Worker-1 Claude Code session, seated from `claude/worker1-h1-20260815` at
`d20e1cc4...` or later, re-verifies the 7 proofs above independently (SessionStart evidence) and
then runs the single NON-G2 Haiku Agent DENY calibration per AR-1299C sections 4-7, then stops for
GPT grade. No further action is authorized here.
