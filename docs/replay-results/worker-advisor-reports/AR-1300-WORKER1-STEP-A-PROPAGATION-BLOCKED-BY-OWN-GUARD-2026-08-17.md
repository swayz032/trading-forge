# AR-1300 — WORKER-1, ordinary seat

RULING : AR-1299C (2026-08-17) — "PHASE1-PASS-PROPAGATE-THEN-PHASE2-CALIBRATION", §3 STEP A
PIN    : HEAD `c124689e4b9cf26546f698b4169fe22684e27c8f` on `claude/worker1-h1-20260815`; working tree clean except the governed dirty exception `docs/wave25-exit-engine-ab-report.md` (AR-1265 §4, unchanged this session)

## SESSION IDENTITY

Fresh ordinary Worker-1 seat this session (not the AR-1299B session). Guard confirmed BOUND at
seating: `.claude/settings.json` PreToolUse matcher = `Edit|Write|NotebookEdit|Bash|Agent|Task`
(no PowerShell), `SessionStart` anchor line arrived in this session's own context
("GPT worker guard: anchor verified on claude/worker1-h1-20260815 at c124689e..."). Ear armed on
`origin/external-advisor/gpt-rulings` at seating baseline `dd6405ebba9be20a4e3cde8284986cd747f787a3`
(after fetching past a stale local ref at `42548206`, which is how AR-1299C itself was found —
it landed on the remote between fetches).

## WHAT WAS ATTEMPTED

AR-1299C §3 STEP A authorizes propagating commit `f60a6abf5064bd3ecd8072454c4ac4d6d18834dc`
(branch `origin/control-plane/ar-1278-guard-repair-cpb-2026-08-17-0004`) onto
`claude/worker1-h1-20260815` via merge or cherry-pick, byte-exact, no manual retyping.

**Independent verification the source commit is real, before touching anything:**
- `git ls-remote origin control-plane/ar-1278-guard-repair-cpb-2026-08-17-0004` ->
  `f60a6abf5064bd3ecd8072454c4ac4d6d18834dc` — matches AR-1299C's claim exactly.
- `git fetch origin control-plane/ar-1278-guard-repair-cpb-2026-08-17-0004` (isolated) succeeded,
  landed at `FETCH_HEAD`, created no local branch.
- `git cat-file -t f60a6abf5064bd3ecd8072454c4ac4d6d18834dc` (isolated) -> `commit`. Object is
  present locally.

**The blocked step — the minimal read-only predicate before any actual merge/cherry-pick:**
- `git merge-base --is-ancestor f60a6abf5064bd3ecd8072454c4ac4d6d18834dc HEAD` ->
  `branch/worktree/history mutation is blocked inside guarded worker sessions`.
- Negative control, same session, immediately after: `git cat-file -t <same sha>` alone succeeds.
  This isolates the trigger to the `merge-base` command itself (the guard's Bash fence appears to
  key on the literal "merge" in the command), not to network access, not to reading the object,
  not to the source branch name.

No `git merge`, `git cherry-pick`, `git checkout`, or any write was attempted — AR-1299C §3
explicitly states an ordinary Worker-1 seat "must not bypass or weaken its guard to perform this
propagation" and that a refusal "is correct." No manual retyping of `.claude/settings.json` or
`.claude/worker1-hook-guard-manifest.json` was attempted (explicitly forbidden by the ruling, and
independently DENY-by-construction per `worker1-hook-guard-manifest.json` §`edit_scope`:
"AR-1263 §7A self-protection is evaluated FIRST and is never scope-overridable").

## MEASURED CURRENT STATE (confirms AR-1299C §2 TRANSITION FACT, no contradiction)

- `.claude/worker1-hook-guard-manifest.json:47` — `g2_precall.strict_session = false`.
- `.claude/settings.json:37` — PreToolUse matcher = `Edit|Write|NotebookEdit|Bash|Agent|Task`
  (PowerShell absent).

Both exactly match what AR-1299C §2 says GitHub independently shows at `c124689e...`. Propagation
has not happened; this seat's attempt to perform it was refused by its own guard before any file
touch occurred.

## FINDING

The guard behaves exactly as AR-1299C anticipated: an ordinary Worker-1 seat cannot even run a
read-only ancestor check on the propagation commit, let alone merge or cherry-pick it, because the
commit's payload includes the seat's own self-protected control files. This is the guard working
as designed, not a defect. Separately, `git merge`/cherry-pick is on the worker-onboarding §4
stop-and-ask list regardless of guard mechanics.

## STOP

AR-1299C §3 STEP A requires "the normal operator/main-advisor/control-plane integration authority"
to perform this propagation. This ordinary seat cannot. Per AR-1299C §2, a fresh Worker-1 seat must
not attempt §4 STEP B (the Phase-2 Agent-DENY calibration) until propagation is complete — so
Phase 2 was not attempted this session. No frozen G2 access, no Agent/Task call, no PowerShell
call, no compiler/backtest/paper/broker/live-money touch, no file changes other than this report.

## NEXT (not self-executable by this seat)

1. Operator, or a privileged control-plane seat, propagates `f60a6abf5064bd3ecd8072454c4ac4d6d18834dc`
   onto `claude/worker1-h1-20260815` exactly (merge or cherry-pick, no retyping).
2. A genuinely fresh ordinary Worker-1 session (not this one) verifies the 7 propagation proofs in
   AR-1299C §3, then runs the single NON-G2 haiku Agent DENY calibration in AR-1299C §5, then
   reports for GPT grade per AR-1299C §7.
