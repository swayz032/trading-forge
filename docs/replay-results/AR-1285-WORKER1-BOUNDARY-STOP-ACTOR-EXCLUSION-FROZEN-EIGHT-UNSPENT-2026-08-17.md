# AR-1285 — WORKER-1 BOUNDARY STOP: ACTOR EXCLUSION, FROZEN EIGHT STILL 8 READY / 0 SPENT

```text
RULING : AR-1284A (GPT branch d42e3f44effc1fd5c81f597a6fd9b4b1fe2d1fbd, 2026-08-17)
         Clause executed: "AR-1285 — AUTHORIZED: G2 EXECUTION-SEAT CLOSEOUT / ## Actor"
PIN    : worker head ee912092cdcc49c6f650f87461aaafa653aa7b88
         worktree C:\Users\tonio\Projects\wt-claude-worker1-20260815
         branch   claude/worker1-h1-20260815
CHANGED: this report only. No code, no queue, no receipt, no control-plane surface.
```

## STOP — AND IT IS THE RULING'S OWN STOP, NOT A DISCRETIONARY ONE

AR-1284A authorizes AR-1285 but assigns it to

> **"A guard-repair / control-plane-authorized seat, NOT the currently bound Worker-1
> seat granting itself permission."**
> "The existing bound Worker-1 may inspect and report but must not modify
> self-protected guard/toolbox/manifest/settings surfaces."

This seat **is** the currently bound Worker-1 seat (guard armed and verified; see receipt
below). Every substantive AR-1285 step lands on a self-protected surface:

```text
§A arm g2_precall.strict_session = true   -> .claude/worker1-hook-guard-manifest.json  SELF_PROTECTED
§B close/guard the PowerShell surface     -> .claude/settings.json                     SELF_PROTECTED
§C run the canonical prompt emitter       -> scripts/g2d_freeze_native_calls.py        SELF_PROTECTED
§D one live traversal calibration         -> requires §A already armed
```

⇒ **AR-1285 is not executable by this seat by construction.** Reported, not worked around.
No attempt was made to route around the fence.

## MEASURED THIS SESSION (inspection is what this seat *is* allowed to do)

### Frozen queue — re-measured independently, not inherited

Canonical read-only preflight, run by this seat **after** all session activity:

```text
$ python scripts/g2d_real_queue_preflight.py
queue_artifact_sha256     = 5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939
queue_count               = 8
claimed                   = []
dispatched                = []
completed                 = []
crash_shaped              = []
stranded_incomplete       = []
ready                     = 8
receipt directory non-README = []

ALL 8 ONE-SHOT ATTEMPTS UNSPENT.        (exit 0)
```

The `queue_artifact_sha256` **matches** the value AR-1284 recorded (`5935b1c6...f939`),
so the queue is byte-identical across the seat change.

`excluded_count = 4` is still not printed by this CLI — corroborates the same AR-1284
observation. Reading it requires a direct artifact read.

### B-2 corroborated by direct read (not inherited)

`.claude/worker1-hook-guard-manifest.json` read directly via the inspected Read path:

```text
g2_precall.enabled        = true
g2_precall.strict_session = false          <- AR-1285 §A precondition NOT met
```

and the manifest's own text confirms self-protection is evaluated before `edit_scope`:

```text
"_claude_prefix_is_not_authority_over_the_guard": ... "a worker must never gain permission
to edit the file that declares its own permissions merely because a broad prefix covers it."
```

### B-3 corroborated by hitting the fence twice, unintentionally

Two ordinary read-only Bash commands were denied purely for **referencing** protected paths:

```text
referenced isolated_fallback_queue_t1.json      -> DENIED (protected-surface fence)
referenced isolated-receipts-t1/                -> DENIED (protected-surface fence)
```

This is a positive witness that the fence discriminates on the *surface*, not the verb —
exactly as AR-1284A §4 describes. The preflight succeeded only because the script
resolves its own paths internally.

### B-1 narrowed — registration is PRESENT; traversal remains unproven

Direct read of `.claude/settings.json`:

```text
PreToolUse matcher = "Edit|Write|NotebookEdit|Bash|Agent|Task"     <- Agent IS registered
```

So B-1 is **not** a registration gap. It is exactly the live-traversal proof gap AR-1284A §2
states. This seat did **not** attempt to close it: the only discriminating test is an `Agent`
dispatch, and under `strict_session=false` an allowed call would repeat the AR-1272
non-discriminating result while risking an unrecorded model call. Deferred to AR-1285 §D
under a control-plane-authorized seat, as ruled.

### Live tool-registry witness for AR-1285 §B

Measured from this seat's own live tool registry:

```text
Bash       = PRESENT (hook-covered)
Agent      = PRESENT (hook-covered per matcher)
Task       = ABSENT  (matcher registers it defensively; no such tool in this runtime)
PowerShell = PRESENT and NOT in the PreToolUse matcher   <- the AR-1284A §5 gap, still open
```

## FINDINGS — INCLUDING AGAINST MYSELF

1. **I used the unguarded `PowerShell` surface during onboarding.** Disclosed deliberately,
   because it is the exact surface AR-1284A §5 orders closed. Scope of that use:
   - `Get-CimInstance Win32_Process` — read-only process census (required by onboarding §2a,
     which bans `TaskList`).
   - `git init` / `commit` / `push` **inside the session scratchpad only**
     (`…\Temp\claude\…\scratchpad\ear-rp`), to red-proof the ruling-ear detector.

   It touched **no** repository path, **no** protected surface, and was **not** used to route
   around the Bash fence. Positive evidence: the post-activity preflight above still reports
   `ALL 8 ONE-SHOT ATTEMPTS UNSPENT`, and `git status` shows only the governed dirty exception.
   **This is nonetheless a live demonstration that the §5 gap is real and reachable.**

2. **A delivery alarm I raised against my predecessor and then disproved.** The AR-1284 report
   is absent from `origin/external-advisor/gpt-rulings`, which matches §11b's most-convicted
   delivery-failure shape. It is **not** one: AR-1280 / 1281 / 1282 / 1283 worker reports all
   live only on the pushed worker branch under `docs/replay-results/`, and GPT graded every one
   of them. My instrument was wrong, not the predecessor. Recorded because the clean second
   reading should not be presented as the only reading.

3. **Two orphan ruling-ear rigs are running.** Root PIDs `20020` and `3792`, both polling
   `refs/heads/external-advisor/gpt-rulings` against this worktree. Their parent `claude.exe`
   PIDs (`2092`, `29920`) are both **dead**, and only one `claude.exe` exists on the box
   (`10960`, this seat). They deliver into ended sessions. **Not killed** — this seat did not
   arm them (`worker-onboarding` §2a rule 3). Cleanup needs an authorization that names them.

4. **AR-1284's `docs/replay-results/` top-level placement** differs from AR-1280→1283, which
   used `docs/replay-results/worker-advisor-reports/`. Both have precedent (AR-1272 was
   top-level). Cosmetic; flagged only so the location is not read as significance.

## CONTROL — the ruling ear was red-proofed before it was trusted

Armed on the real channel and **delivered into this seat's own chat**:

```text
EAR ARMED on origin refs/heads/external-advisor/gpt-rulings
  @ 81c9ca1c6ac29dd2721d11acd2297b7858adb158 (poll 2s)
```

Red-proofed on a **throwaway** repo, never the real branch — all three legs required by
`worker-onboarding` §2a:

```text
EMITS   : "GPT BRANCH MOVED: f1346a91... -> 5cadeb90..."  (hand-moved throwaway head)
SILENT  : no emission across the no-move interval
REFUSES : exit 2 on non-repo cwd (C:\Users\tonio\Projects\trading-forge)
          exit 3 on an absent ref
```

**The ear then fired for real during this session**, delivering
`81c9ca1c -> d42e3f44` — which is how AR-1284A was read at all. Blind-window backfill:
the ear armed at `81c9ca1c`, so AR-1283A predated it and was read by hand.

## STATE UNCHANGED BY THIS SEAT

```text
frozen G2 ready     = 8
frozen G2 spent     = 0
model/agent calls   = 0
one-shot calibration= UNSPENT
control plane       = UNMODIFIED
tree                = clean except the governed AR-1265 §4 dirty exception
                      (diff sha256 e200765c11e85aeb...7170 — EXACT MATCH to the pin)
head                = ee912092 (unchanged; GPT-graded head 96aefd4e is an ancestor, +1/-0)
```

## NEXT

**Operator / GPT action required — this seat cannot self-authorize it.**
Constitute the control-plane-authorized seat that AR-1285 names as its actor. Until then
AR-1285 §A–§D cannot begin, and the frozen eight stay at 8 ready / 0 spent per AR-1284A's
suspension of the AR-1283A release at the execution boundary.

No compiler, backtest, paper, broker, Tier-3, or live-money work was performed or is proposed.
