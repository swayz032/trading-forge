# AR-1317 closeout — bootstrap execution FAILED at the doorway; no live propagation occurred

## AR-1317

RULING : AR-1316B (`4742ca48fe8218ac9b013dbd08a75cfb1e154afb` on `origin/external-advisor/gpt-rulings`,
path `advisor-reports/AR-1316B-GPT-EXTERNAL-ADVISOR-RULING-BOOTSTRAP-COMPAT-PASS-EXECUTABLE-F36-LIVE-PROPAGATION-2026-08-18.md`)
§3 "FIRST ACTION" — the one command this worker-1 seat was authorized to run.

PIN : `claude/worker1-h1-20260815` @ `1e65bc5b5b313485927026ea212be48af6d548c3` (clean tree,
unchanged by this packet — see CHANGED below).

CHANGED: nothing in `claude/worker1-h1-20260815` except this report file. The bootstrap's own
mutations (claim file, new branch, new worktree) live outside this tracked tree — see EFFECTS below.

## Pre-flight (worker mode, `advisor-ruling` skill)

Answered the seven questions against measured repo state before touching anything:
1. **Scope** — `allowed_paths` in AR-1316B's authorization JSON: `scripts/claude_toolbox.mjs`,
   `.claude/worker1-hook-guard-manifest.json`, `.claude/settings.json`,
   `docs/replay-results/g2d-prompt-transport/`, `docs/replay-results/worker-advisor-reports/`,
   `scripts/control-plane-bootstrap/.cp-commit-msg.tmp`. §3 itself authorizes exactly one command:
   `node scripts/control-plane-bootstrap/bootstrap.mjs --execute`.
2. **Stop conditions** — §3: "If any measurement differs, STOP without privilege mutation." §6: "If
   any check differs, STOP. Do not improvise." §8: no retry of a claimed/spent authorization.
3. **Prohibited** — no new Agent/Task/model calls, no receipt deletion/reset, no frozen-plane
   mutation, no new guard architecture, no compiler/backtest/paper/broker/live-money work.
4. **Required proofs** — zero-model-call verification only (bootstrap's own measured-vs-required
   fields, `node --test scripts/control_plane_bootstrap.test.mjs`). No independent grade required
   for this packet.
5. **Measured repo state before acting** — confirmed via `bootstrap.mjs` default `--plan` mode
   (no side effects) before running `--execute`: `bootstrap_source_sha_measured` ==
   `bootstrap_source_sha_required` == `1e65bc5b...`; `bootstrap_bundle_sha256_measured` ==
   `_required` == `195023fb...`; `frozen_queue_sha256_measured` == `_required` ==
   `5935b1c6...`; `ready_measured=8` == `ready_required=8`; `spent_measured=0` == `spent_required=0`;
   `branch_namespace_conflict.collision=false`; `cpb-2026-08-18-0006` absent from
   `claimed_authorization_ids` (no replay); `newest_ruling="AR-1316B"`; `authorized: true`.
6. **Already landed?** — no. `--plan` confirmed `executed: false` before I ran `--execute`.
7. **Metric/grade mix** — none; all mechanical.

**No contradiction found.** Also resolved the ambiguity in my own pre-flight question — is §4's
"AR-1317 PRIVILEGED SEAT" a distinct session I am not? Read `bootstrap.mjs`'s `run()`/
`makeRealEffects()` before acting: `--execute` does not itself edit `.claude/settings.json` or
`scripts/claude_toolbox.mjs`. It claims the one-shot authorization, creates an isolated
branch+worktree from my HEAD, writes a seat guard into that worktree's **local** (untracked)
settings, proves the doorway via `claude --init-only` (top-level, not a subagent), then launches a
**separate supervised `claude -p --dangerously-skip-permissions` process** in that isolated
worktree — that spawned process is §4's privileged seat, not me. This is exactly why an earlier
direct `Bash` attempt to reference `.claude/settings.json` was refused by the protected-surface
fence with "use an inspected write path instead" — the bootstrap mechanism *is* that inspected
write path. Confirmed EXECUTE WITHOUT ANOTHER PERMISSION ROUND-TRIP per `0-CTRL.1`.

## RED — the command and its exact result

```
$ node scripts/control-plane-bootstrap/bootstrap.mjs --execute
```

Exit code `4`. Worktree `control-plane/ar-1317-guard-repair-cpb-2026-08-18-0006` created at
`C:/Users/tonio/Projects/wt-control-plane-ar-1317-cpb-2026-08-18-0006` from `1e65bc5b...`. Result
JSON (trimmed to the load-bearing fields):

```json
{
  "mode": "execute",
  "authorized": true,
  "authorization_spent": true,
  "executed": false,
  "doorway": {
    "ok": false,
    "detail": "no durable armed receipt was minted by --init-only; the Local hook did not arm"
  },
  "refusal": {
    "ok": false,
    "code": "doorway_not_armed",
    "detail": "no durable armed receipt was minted by --init-only; the Local hook did not arm"
  }
}
```

stderr: `CONTROL-PLANE BOOTSTRAP EXECUTED BUT NOT VERIFIED COMPLETE (undefined). The authorization is
spent. This requires a new GPT decision, not a silent retry.`

Failure point: step 9 (`prove_doorway_init_only`), strictly before step 10
(`launch_seat_supervised`). **No `claude -p` propagation process was ever launched.**

## Root cause — found by reading, not by re-executing

`scripts/control-plane-bootstrap/control-plane-guard.mjs::verifySeatIdentity()` line 442:

```js
if (observed.ready !== 8 || observed.spent !== 0 || observed.receiptsReadmeOnly !== true) {
  return { ok: false, code: 'frozen_state_drift', ... };
}
```

`observed.receiptsReadmeOnly` is independently re-measured inside `control-plane-seat-hook.mjs`'s
`measureObservedIdentity()` as `io.listDir(receiptRel).filter(f => f !== 'README.md').length === 0`
— literal README-only, no GIT_TREE awareness. AR-1316A patched `authorization.mjs`'s
`require_receipts` precondition (consumed by `bootstrap.mjs`'s top-level `resolveAuthorization`,
which is why `--execute` measured `authorized: true` and reached step 9) to accept the new
`GIT_TREE:<sha>` form specifically because the real receipts directory is populated by design
(tree `c11966868f8a511554e1f26bf6e5555c59833d04`, confirmed clean). It did **not** touch
`verifySeatIdentity`'s separate, hardcoded `receiptsReadmeOnly !== true` check, which is invoked
from the **seat's own** `control-plane-seat-hook.mjs::decide()` at `SessionStart` (via
`identity = verifySeatIdentity(observed, expectationsFrom(manifest))` at line 321) — a second,
independent frozen-state gate that the AR-1316A compatibility repair never reached. Since the real
receipts directory is populated by construction, this check fails `frozen_state_drift` on every
seat launch since GIT_TREE compatibility shipped, `SessionStart` never calls `store.writeReceipt`,
and `--init-only` correctly finds no `tf-control-plane-armed-*` file — exactly what was observed.

This is a two-location gap: `authorization.mjs`'s marker-validation precondition was widened for
GIT_TREE; `control-plane-guard.mjs`'s independent seat-identity frozen-state check was not. Both
gate the same underlying fact (frozen receipts state) from two different code paths that can drift
independently — and did.

**Not verified further** (would require re-invoking the spent authorization's exact doorway
mechanism, which §8 forbids): whether this is the *only* gap, or whether `verifySeatIdentity`'s
`receiptsReadmeOnly` check should instead accept the marker's resolved `require_receipts` value
(GIT_TREE-aware) rather than a second hardcoded boolean. That design choice belongs to the next
ruling, not to this seat.

## Independently confirmed evidence

- `tf-control-plane-claim-cpb-2026-08-18-0006.json` exists in the shared git-common dir — the
  authorization is genuinely, permanently spent (confirmed via `ls`, not by trusting the JSON
  output alone).
- `wt-control-plane-ar-1317-cpb-2026-08-18-0006/.git`'s worktree git-dir contains no
  `tf-control-plane-armed-*` file (confirmed via direct `ls`, independent of the bootstrap's own
  report of the same fact).
- `.claude/settings.local.json` and `.claude/control-plane-guard-manifest.json` **were** written
  into the new worktree (`materialize_seat_guard`, step 8, succeeded) — content matches
  `seatSettingsFor()` exactly.
- New worktree HEAD is `1e65bc5b...`, identical to the base — **zero commits happened there**;
  `.claude/settings.json` (tracked, in this worker-1 tree) is byte-identical to before this
  session; `scripts/claude_toolbox.mjs` TOOLBOX_PIN is unchanged (still `4c5f9d4a...`); no live
  propagation of any kind occurred.
- `git status -sb` on `claude/worker1-h1-20260815` after the run: clean except this report.

## EFFECTS outside the tracked tree (preserved, not cleaned up)

- New branch `control-plane/ar-1317-guard-repair-cpb-2026-08-18-0006` @ `1e65bc5b...` (no commits).
- New worktree `C:/Users/tonio/Projects/wt-control-plane-ar-1317-cpb-2026-08-18-0006`.
- New claim `tf-control-plane-claim-cpb-2026-08-18-0006.json` in the shared git-common dir.

None deleted, reset, or rewritten — preserved as evidence per standing git-safety protocol. The
authorization id `cpb-2026-08-18-0006` cannot be reused regardless.

## CONTROL

Not applicable — this is a diagnostic RED, not a repair. No mutation suite run; no fix attempted.

## GRADER

Not dispatched. No grade is owed on a failed, non-mutating (to the protected surface) execution
attempt; nothing here claims success for an independent grader to test.

## FINDINGS

- The AR-1316A GIT_TREE compatibility repair covered `authorization.mjs`/`bootstrap.mjs` but missed
  a second, independent hardcoded README-only check in `control-plane-guard.mjs::verifySeatIdentity`
  — this is a finding against the prior packet's completeness, not against this session's own work
  (this session made zero code changes; it only ran the authorized command and diagnosed the
  refusal by reading).
- `bootstrap.mjs`'s `proveDoorwayInitOnly` uses `stdio: 'pipe'` and, on a non-throwing `--init-only`
  exit, discards the child process's stdout/stderr entirely — there is no captured transcript of
  what the `--init-only` process itself printed (e.g. the `sessionContext(...)` "CONTROL-PLANE GUARD
  NOT ARMED: frozen_state_drift — ..." line `decide()` would have emitted). I did not attempt to
  recover it by re-running `--init-only` by hand against the now-spent authorization's worktree,
  since that pokes the same doorway mechanism the ruling forbids retrying. The root cause above is
  derived from static code reading and is high-confidence, but this specific evidence gap is honest
  and unclosed.

## STOP

`doorway_not_armed` fired exactly as designed — a genuine refusal, not a crash (no
`post_claim_exception`). Authorization `cpb-2026-08-18-0006` is spent. Per AR-1316B §8: "No
retrying this authorization if it is claimed/spent and execution later fails." A new GPT
authorization is required before any further bootstrap execution or any further edit to
`control-plane-guard.mjs`. This worker-1 seat is not authorized to unilaterally patch
`verifySeatIdentity`'s frozen-state check under its general `scripts/` edit scope — it is the
security boundary for the exact privileged-write mechanism this packet exists to gate, and AR-1316B
did not authorize architecture changes to it ("No new guard architecture or broad refactor").

## NEXT

Not self-authorized. Recommend to GPT: a new ruling (AR-1318 or similar) either (a) widens
`verifySeatIdentity`'s `receiptsReadmeOnly` check to accept the same GIT_TREE-authorized frozen
state `resolveAuthorization`/`authorization.mjs` already accepts (single source of truth for
"is the frozen plane in the state this authorization permits"), issued as a new off-live repair
packet the same way AR-1316A was, or (b) directs a different remediation. Either way it needs a
fresh `authorization_id` — `cpb-2026-08-18-0006` cannot be replayed.
