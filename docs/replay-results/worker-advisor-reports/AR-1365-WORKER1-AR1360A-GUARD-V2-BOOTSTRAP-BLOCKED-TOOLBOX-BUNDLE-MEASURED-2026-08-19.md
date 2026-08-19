# AR-1365 (worker-1)

```
RULING : AR-1360A on origin/external-advisor/gpt-rulings @ 1e6ff2a8d5409a5f30f77d293456390cdc0fe94f
         (§9 ORDER OF EXECUTION, steps 1-4: fetch newest ruling, run bootstrap --plan, execute
         one-shot Guard V2 promotion)
PIN    : worker HEAD 6b7d72db82fee80b11ad86b3097ce0965e6b3098, branch claude/worker1-h1-20260815,
         tree clean throughout (git status -sb unchanged before/after)
CHANGED: none on this branch. This report only.
```

## Pre-flight (advisor-ruling, worker mode)

1. SCOPE: exact `allowed_paths` in AR-1360A's fresh marker `cpb-2026-08-19-0009` —
   `scripts/claude_toolbox.mjs`, `.claude/worker1-hook-guard-manifest.json`,
   `docs/replay-results/worker-advisor-reports/AR-1364-CONTROL-PLANE-GUARD-V2-PROMOTION-CLOSEOUT-cpb-2026-08-19-0009.md`.
   These are the PRIVILEGED SEAT's paths (`actor: top-level-control-plane-guard-repair`), not
   mine directly — worker-1 dispatches `bootstrap.mjs`, does not hand-edit them.
2. STOP CONDITIONS: any `--plan` field mismatch (none found); doorway not armed; completion
   receipt absent/unverified (THIS fired).
3. PROHIBITED: reviving `cpb-2026-08-19-0008` (not attempted); editing `.claude/settings.json`
   for this promotion (not attempted); self-authorizing compiler/backtest promotion (not
   attempted).
4. REQUIRED PROOFS: `--plan` match on every measured field, one-shot `--execute`, live Guard V2
   positive/negative controls. First two done; controls unreachable because promotion did not
   complete (see FINDINGS).
5. MEASURED REPO STATE: `external-advisor/gpt-engineering` fetched, tip **exactly**
   `8d0ee514ce09913197f0755fded5d2e7993a2a8d`, matching the ruling's cited packet tip.
   `.claude/worker1-hook-guard-manifest.json` `_toolbox_pin` **exactly** `59cfb1cd...`, matching
   the ruling's stated "Current live pin". Guard V2 candidate `4c6f36ea7e2f68e3eb50cf555390b3c4e98ddbd4`
   resolves as a real commit, descendant of `59cfb1cd` (`git log 4c6f36ea --oneline` contains
   `59cfb1cd`). AR-1364 report path: absent on this branch (never committed — see below).
6. ALREADY LANDED?: grepped `897655fd` and `cpb-2026-08-19-0009` across
   `docs/replay-results/worker-advisor-reports/` — no prior closure. Confirmed via a second
   `bootstrap.mjs` plan run (below) that `cpb-2026-08-19-0009` is now claimed.
7. METRIC/GRADE MIX: none — AR-1360A's §9 steps are mechanical pass/fail, no grading language
   mixed in.

No contradiction found before executing. Executed per `0-CTRL.1`.

## RED (the failing measurement)

```
$ node scripts/control-plane-bootstrap/bootstrap.mjs
{ "mode": "plan", "authorized": true, ... all required==measured fields match ... }
```

```
$ node scripts/control-plane-bootstrap/bootstrap.mjs --execute
... worktree created: control-plane/ar-1360a-guard-repair-cpb-2026-08-19-0009
    @ C:/Users/tonio/Projects/wt-control-plane-ar-1360a-cpb-2026-08-19-0009
"doorway": { "ok": true, "receipts": ["tf-control-plane-armed-1c178a3b-....json"] }
"launch": { "ok": true, "output": "... BLOCKED on two measured, fail-closed gaps ..." }
"completion": null
"completion_verified": false
"completion_failure_reason": "no_completion_receipt"
[exited with code 4]
```

The privileged seat's own `-p` output (RELAYED, not independently re-verified by me):

> 1. Toolbox bundle SHA for `4c6f36ea` — never pre-computed; control-plane seat's Bash allowlist
>    cannot compute it; AR-1310/AR-1311 precedent requires a Worker-1 measurement.
> 2. Commit-message temp file (`scripts/control-plane-bootstrap/.cp-commit-msg.tmp`) — missing
>    from the marker's `allowed_paths`; Write denied; `cp-finalize.mjs` requires it.
>
> The report is staged but cannot be committed or pushed. The existing guard at `59cfb1cd`
> remains live and fully functional (172/172 tests green). No production files were modified.
> No partial re-pin was applied.

Re-running `bootstrap.mjs` plan (read-only) confirms the authorization is now spent:

```
$ node scripts/control-plane-bootstrap/bootstrap.mjs
{ "authorized": false, "refusal": { "code": "all_markers_refused",
  "detail": "replayed_authorization: authorization_id cpb-2026-08-19-0009 has already been
             claimed — one authorization is one execution" } }
```

`cpb-2026-08-19-0009` is **permanently spent** by design (bootstrap.mjs: claim precedes launch;
a post-claim failure requires a new GPT decision, never a silent retry). **Do not attempt to
revive it — same law AR-1360A §7 stated for `cpb-2026-08-19-0008`.**

## Independent measurement performed (closes gap 1 above)

I do not have a dedicated tool to re-run `scripts/claude_toolbox.mjs materialize` against an
arbitrary commit (it is hardcoded to the live `TOOLBOX_PIN` constant, and that file is
self-protected — a Worker-1 edit to it to point at the candidate would itself be the promotion).
Instead I reproduced its exact `bundle_sha256` algorithm (`git ls-tree -r --name-only <commit> --
advisor-prepared/gpt-speed-engineering-lane/tooling`, filter `.mjs`, `git show <commit>:<file>`,
per-file sha256, then sha256 of `file:sha256` lines joined by `\n`) in a temporary, uncommitted
script, deleted after use.

**Positive control first** (required before trusting the instrument): reproduced against the
*current* live pin `59cfb1cd...` → `849253f1e5a08f7c9f1e0f177d9a956e50a249612df24476a97dde6c0f36ee7d`,
50 files — **exact match** to `.claude/worker1-hook-guard-manifest.json`'s
`_toolbox_bundle_sha256`.

**Then measured the candidate:**

```
commit:       4c6f36ea7e2f68e3eb50cf555390b3c4e98ddbd4
file_count:   56  (up from 50 at 59cfb1cd)
bundle_sha256: 5b54027ed3b1bfb2d7e4c37d2644103875539e1bcc641f0abfea26f58fc2d801
```

This value is handed to GPT here so the next marker does not need another round-trip to obtain
it.

## FINDINGS

1. **`cpb-2026-08-19-0009` is spent and unrecoverable** — the promotion did not complete; a new
   GPT marker is required (matches AR-1360A §7's own precedent for the marker it superseded).
2. **The marker AR-1360A shipped was itself incomplete**: `allowed_paths` omitted
   `scripts/control-plane-bootstrap/.cp-commit-msg.tmp`, which `cp-finalize.mjs` unconditionally
   requires to exist. This is a ruling/marker defect, not a worker error — flagging per
   `advisor-ruling` discipline rather than silently working around it.
3. **Toolbox bundle SHA256 for the guard candidate `4c6f36ea` measured here**:
   `5b54027ed3b1bfb2d7e4c37d2644103875539e1bcc641f0abfea26f58fc2d801` (56 files). Instrument
   proved against a positive control before use.
4. **No production files were touched.** My own branch tree stayed clean throughout (verified
   `git status -sb` before and after). The live guard pin in
   `.claude/worker1-hook-guard-manifest.json` is unchanged at `59cfb1cd...`.
5. **Orphaned artifact, preserved, not cleaned up**: worktree
   `C:/Users/tonio/Projects/wt-control-plane-ar-1360a-cpb-2026-08-19-0009` on branch
   `control-plane/ar-1360a-guard-repair-cpb-2026-08-19-0009` holds the privileged seat's staged
   (uncommitted, unpushed) AR-1364 closeout report. Left in place as evidence per
   strike-and-retain / worktree-session discipline — not deleted, not reset.
6. **The "172/172 tests green" claim is RELAYED** (from the privileged seat's own `-p` output), not
   independently re-verified in this report.
7. **AR-1360A §9 steps 6-8** (independent attack on the bound-grade gate at
   `897655fd3ef0b8324aca346a60c3258ef0943cfd`, independent attack on the GPT-5.6 Sol semantic-audit
   packet at `8d0ee514`, emitting the three calibration tasks) are **not attempted in this report**.
   The ruling's §9 states an explicit execution ORDER ("Worker 1 must execute in this order") with
   step 5 (verify live Guard V2 controls) preceding them, and step 5 is unreachable until promotion
   completes. Stopping here rather than reordering past an unresolved prerequisite on my own
   judgment.

## GRADER

Not dispatched — nothing here is a repair or a claim of success to grade. This is a blocked
one-shot authorization report.

## STOP

**Fired.** `cpb-2026-08-19-0009` spent without completion; a new GPT ruling/marker is required
before Guard V2 promotion (or anything downstream of it: §9 steps 5-8) can proceed.

## NEXT (not self-authorized — awaiting GPT)

A corrected marker that (a) adds `scripts/control-plane-bootstrap/.cp-commit-msg.tmp` to
`allowed_paths`, and (b) carries the measured toolbox `bundle_sha256` above for `4c6f36ea` so the
privileged seat does not need to (re-)derive it. On receipt: re-run `bootstrap.mjs --plan` against
the new marker, then `--execute`, then continue AR-1360A §9 steps 5-8 exactly as ordered.
