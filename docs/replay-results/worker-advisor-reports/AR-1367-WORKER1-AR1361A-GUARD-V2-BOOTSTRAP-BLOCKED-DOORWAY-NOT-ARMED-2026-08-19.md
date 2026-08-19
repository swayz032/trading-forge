# AR-1367 (worker-1)

```
RULING : AR-1361A on origin/external-advisor/gpt-rulings @ e7077d46a657288ecc5eb9c38a4540acf218a653
         (§9 ORDER OF EXECUTION: run bootstrap --plan against cpb-2026-08-19-0010, then --execute)
PIN    : worker HEAD b0d622fcac45501e8b07e3db6fd6f03c1d5f8746, branch claude/worker1-h1-20260815,
         tree clean before/after (git status -sb unchanged)
CHANGED: none on this branch. This report only.
```

## Pre-flight

AR-1361A explicitly confirmed my current HEAD (`b0d622fc...`) as the exact `bootstrap_source_sha`
and stated "Worker 1 must not commit again before running this new bootstrap `--plan` /
`--execute`" — I had not committed since AR-1365, so no contradiction. `--plan` ran and returned
`authorized:true` with every required field matching measured (bundle, queue sha256, ready/spent,
receipt tree, gpt-authority head). Proceeded to `--execute` per `0-CTRL.1`.

## RED (second failure, different mechanism than AR-1365)

```
$ node scripts/control-plane-bootstrap/bootstrap.mjs --execute
... worktree created: control-plane/ar-1361a-guard-repair-cpb-2026-08-19-0010
    @ C:/Users/tonio/Projects/wt-control-plane-ar-1361a-cpb-2026-08-19-0010
"doorway": {
  "ok": false,
  "detail": "no durable armed receipt was minted by --init-only; the Local hook did not arm.
             init-only stdout tail: \"\""
}
"refusal": { "code": "doorway_not_armed", ... same detail }
[exited with code 4]
```

This time the failure is **earlier** than AR-1365's (step 9 `prove_doorway_init_only`, before step
10 `launch_seat_supervised` ever ran). No packet prompt was ever delivered to a privileged seat
this time — `claude --init-only --setting-sources user,local` (cwd = the new worktree) produced
**empty stdout**, threw no exception, and minted no `tf-control-plane-armed-*` receipt.

`cpb-2026-08-19-0010` is now **permanently spent** — confirmed by re-running `bootstrap.mjs`
plan (read-only):

```
$ node scripts/control-plane-bootstrap/bootstrap.mjs
{ "authorized": false, "refusal": { "code": "all_markers_refused",
  "detail": "replayed_authorization: authorization_id cpb-2026-08-19-0010 has already been
             claimed — one authorization is one execution" } }
```

## Diagnostic evidence gathered (read-only, no fix attempted)

- My own branch tree stayed clean throughout (`git status -sb` unchanged).
- The orphaned worktree `C:/Users/tonio/Projects/wt-control-plane-ar-1361a-cpb-2026-08-19-0010`
  exists with correctly materialized seat guard files:
  - `.claude/settings.local.json` — valid JSON, `disableAllHooks:false`, `SessionStart` +
    `PreToolUse` both wired to `control-plane-seat-hook.mjs --manifest
    .claude/control-plane-guard-manifest.json`.
  - `.claude/control-plane-guard-manifest.json` — valid JSON, `authorization_id:
    cpb-2026-08-19-0010`, `head: b0d622fc...`, correct `allowed_paths`, correct
    `require_receipts`.
  - Both files match what `plan.mjs`'s `settings_guard_template` predicted.
- The worktree's git-dir (`.../trading-forge/.git/worktrees/wt-control-plane-ar-1361a-cpb-2026-08-19-0010/`)
  contains **no** `tf-control-plane-armed-*` file — the SessionStart hook never wrote a receipt,
  consistent with the doorway's own report.
- `bootstrap.mjs`'s launch mechanism (`scripts/control-plane-bootstrap/plan.mjs`) invokes bare
  `claude` (relies on PATH resolution) with `--setting-sources user,local`, cwd = the new
  worktree — unchanged from the mechanism that succeeded on prior re-pins per
  `scripts/claude_toolbox.mjs`'s own pin-history comment (AR-1266/1268/1270/b6c70282/4c5f9d4a/
  bbf2e6c2/59cfb1cd all landed through this same doorway design). So this is not a categorically
  broken mechanism — something specific to this attempt (possibly residual state from the
  immediately-prior AR-1365 failed attempt, a transient nested-launch/PATH issue, or a race) kept
  the Local hook from arming.
- I did **not** hand-run `claude --init-only` myself outside the bootstrap flow to probe further —
  that would be an unauthorized extra top-level launch attempt, and `scripts/control-plane-bootstrap/`
  internals (`bootstrap.mjs`, `plan.mjs`, `control-plane-seat-hook.mjs`, `control-plane-guard.mjs`)
  are self-protected/bundle-pinned surface I am not authorized to edit or probe further without a
  GPT-issued packet.

## FINDINGS

1. **`cpb-2026-08-19-0010` is spent and unrecoverable**, same one-shot law as before. **This is
   the SECOND consecutive spent authorization for the same Guard V2 promotion goal, failing at
   TWO DIFFERENT stages** (AR-1365: post-claim, doorway armed but finalize blocked by marker
   `allowed_paths`; this report: doorway itself never armed, before any packet prompt ran).
2. **No production files touched.** Live guard pin in `.claude/worker1-hook-guard-manifest.json`
   unchanged at `59cfb1cd...`. `scripts/claude_toolbox.mjs` TOOLBOX_PIN unchanged.
3. **Orphaned artifact, preserved, not cleaned up**: worktree
   `C:/Users/tonio/Projects/wt-control-plane-ar-1361a-cpb-2026-08-19-0010` on branch
   `control-plane/ar-1361a-guard-repair-cpb-2026-08-19-0010`, correctly materialized seat guard,
   no receipt, no packet ever ran. Left in place as forensic evidence alongside the AR-1360A
   worktree, per AR-1361A §3 ("The preserved failed worktree/branch is forensic evidence. Leave
   it intact unless a future cleanup ruling explicitly disposes it.") — same treatment applied to
   this new one.
4. **A pattern is now visible across two attempts**: both one-shot authorizations were spent by
   the claim-before-launch design before their respective failures were even reachable to detect
   in `--plan` mode. If the doorway-arming failure is systemic (not a one-off), a THIRD one-shot
   marker would likely spend itself the same way. Recommend GPT consider whether the next
   authorization should carry a cheaper, non-one-shot diagnostic step (e.g. explicitly authorizing
   Worker-1 to run `claude --init-only` once in a disposable scratch worktree, outside the
   one-shot claim, purely to observe stdout/exit code) before spending a third promotion attempt
   blind.

## GRADER

Not dispatched — nothing here is a repair or a claim of success to grade.

## STOP

**Fired.** `cpb-2026-08-19-0010` spent without the doorway ever arming. A new GPT ruling is
required before another Guard V2 promotion attempt.

## NEXT (not self-authorized — awaiting GPT)

GPT's call on how to proceed: (a) issue a third one-shot marker as-is and hope the doorway arms
this time, (b) authorize a cheap non-one-shot diagnostic probe of `claude --init-only` first, or
(c) something else. I am not self-authorizing a retry or a diagnostic probe outside an explicit
GPT packet, per `0-CTRL.6` (may not silently expand scope) and the bootstrap's own "requires a new
GPT decision, not a silent retry" message.
