# WORKER-1 REPORT — AR-1361 (read-only bootstrap pin packet)

Following AR-1358A §2. Read-only measurement only — no control-plane mutation, no bootstrap
`--execute`, no self-protected-file edit. Measured by importing `measureState`/`makeRealIo`
directly from the pinned `scripts/control-plane-bootstrap/bootstrap.mjs` (same functions
`--plan` mode uses), so this is the exact state that module would see if invoked right now.

## The packet (AR-1358A §2, items 1-9)

```
1. worker_branch          : claude/worker1-h1-20260815
2. worker_head_sha         : e56ecd94d7d84775c671778232d6538788d9fa6f
3. bootstrap_source_sha    : e56ecd94d7d84775c671778232d6538788d9fa6f
                              (authorization.mjs requires this == measured.workerHead exactly —
                              they are the same value by construction, not two independent facts)
4. bootstrap_bundle_sha256 : fa17a097329f057c3ac48956542f9066e3c5af550657a95f7b9eca407fe40347
                              (10-file bundle under scripts/control-plane-bootstrap/, unchanged
                              from the value AR-1357A-era --plan already reported)
5. target_packet           : NOT KNOWN — cannot be measured, only reported as ambiguous per
                              AR-1358A's own instruction ("if another blocker appears, report it
                              instead of masking it"). `authorization.mjs` requires it to match
                              /^AR-\d{3,5}[A-Z]?$/ and `plan.mjs` uses it only to derive the
                              branch/worktree name (deriveBranch/deriveWorktreeDirName) — it does
                              not independently verify the string against anything measured, so I
                              cannot derive it from repo state. PRECEDENT (existing
                              control-plane/* branches): each prior execution used the AR number
                              of the ruling that ordered THAT bootstrap run as target_packet
                              (ar-1278-guard-repair, ar-1311-guard-repair, ar-1317-guard-repair,
                              ar-1319-guard-repair). AR-1358A itself is explicitly NON-EXECUTABLE
                              and says "a separate newest ruling will carry the ... authorization
                              ... only after the exact current pins below are published" — so by
                              the same precedent the natural target_packet is that FUTURE ruling's
                              own AR-NNNN identifier, which does not exist yet. I am not choosing
                              a value; GPT names it when it issues the executable marker.
6. guard_v2_candidate_sha  : 4c6f36ea7e2f68e3eb50cf555390b3c4e98ddbd4  (matches AR-1358A §1 exactly)
7. frozen-queue / ready-spent-receipt preconditions — UNCHANGED from the values already reported
   under AR-1357A-era measurement; measured again now, fresh:
     frozen_queue_sha256 : 5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939
     ready                : 8   (marker requires require_ready===8 AND measured.ready===8 — both match)
     spent                : 0   (marker requires require_spent===0 AND measured.spent===0 — both match)
     receipts_readme_only : false  -- this means `require_receipts:"README_ONLY"` WILL NOT
                              validate (authorization.mjs's own comment: correct before the 8 Opus
                              calls existed, stale now that they happened and left real receipts).
                              The only valid form now is the GIT_TREE compatibility extension:
     receipts_git_tree_sha : c11966868f8a511554e1f26bf6e5555c59833d04
                              (= `git rev-parse HEAD:docs/replay-results/svkm-extraction-certified/
                              grade/opus-v2/isolated-receipts-t1`)
     receipts_clean        : true  (`git status --porcelain` scoped to that dir is empty)
     ⇒ so `require_receipts` in the marker must be exactly:
       "GIT_TREE:c11966868f8a511554e1f26bf6e5555c59833d04"
8. fresh proposed authorization_id — none claimed/spent yet for today's date. Currently claimed
   (measured, union of both stores): cpb-2026-08-17-0001..0005, cpb-2026-08-18-0006,
   cpb-2026-08-18-0007. PROPOSING (not self-authorizing) the next unclaimed value in the existing
   sequence: `cpb-2026-08-19-0008`. This is a suggestion for GPT's marker, not a claim I am
   making — `authorization_id` must be 8-128 chars of [A-Za-z0-9._:-] and is chosen by whoever
   issues the executable marker.
9. read-only --plan structured output, this exact measurement:
```
```json
{
  "workerBranch": "claude/worker1-h1-20260815",
  "workerHead": "e56ecd94d7d84775c671778232d6538788d9fa6f",
  "repoRemote": "swayz032/trading-forge",
  "queueSha256": "5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939",
  "ready": 8,
  "spent": 0,
  "receiptsReadmeOnly": false,
  "receiptsGitTreeSha": "c11966868f8a511554e1f26bf6e5555c59833d04",
  "receiptsClean": true,
  "gptAuthorityHead": "7d1f36c98250b65f04f7a3797eb874ae81f93e36",
  "rulingId": "AR-1358A",
  "isNewestRuling": true,
  "claimedAuthorizationIds": ["cpb-2026-08-17-0002","cpb-2026-08-17-0003","cpb-2026-08-17-0004",
    "cpb-2026-08-17-0005","cpb-2026-08-18-0006","cpb-2026-08-18-0007","cpb-2026-08-17-0001"],
  "bootstrapBundleSha256": "fa17a097329f057c3ac48956542f9066e3c5af550657a95f7b9eca407fe40347",
  "existingControlPlaneBranches": ["control-plane/ar-1278-guard-repair",
    "control-plane/ar-1278-guard-repair-cpb-2026-08-17-0003",
    "control-plane/ar-1278-guard-repair-cpb-2026-08-17-0004",
    "control-plane/ar-1311-guard-repair-cpb-2026-08-17-0005",
    "control-plane/ar-1317-guard-repair-cpb-2026-08-18-0006",
    "control-plane/ar-1319-guard-repair-cpb-2026-08-18-0007"],
  "agentModelExecutions": 0
}
```

### The one field worth flagging rather than trusting at face value

`agentModelExecutions: 0` is **0 by construction of the bootstrap script itself** — its own
comment says so ("this process dispatches no Agent/subagent"). It does NOT mean "no Agent/
subagent calls happened in this worker session." As of this packet, **this same worker session
has already dispatched 5 real Agent-tool calls** (the AR-1357A five-video Opus source readers,
still in flight). If `require_agent_model_executions_before_launch: 0` is meant as a check against
the WORKER's own session activity rather than the bootstrap tool's own activity, this measured `0`
does not prove that — it is trivially always `0` regardless of what the worker session did. Flagging
this now so it is not read as a stronger guarantee than it is; not blocking on it since GPT's
instruction was to publish the packet, not interpret it.

## Only remaining reason for refusal

`node scripts/control-plane-bootstrap/bootstrap.mjs` (`--plan`, read-only, re-run at this same
pin) still returns `authorized:false, code:"no_marker", detail:"no
CONTROL_PLANE_BOOTSTRAP_AUTHORIZATION_V1 block in AR-1358A"` — expected, since AR-1358A is
deliberately non-executable. No other blocker surfaced by `--plan` at this pin. If HEAD moves
before GPT issues the executable ruling, `bootstrap_source_sha`/`bootstrap_bundle_sha256` will
both go stale and this packet must be re-measured.

```
AR-1361
RULING : AR-1358A §2 (read-only pin-packet request)
PIN    : worker branch claude/worker1-h1-20260815 @ e56ecd94
CHANGED: this report file; scripts/_worker1_pin_packet_measure.mjs (small read-only measurement
         helper, imports bootstrap.mjs's own measureState/makeRealIo, no new logic, prints the
         full measured object --plan's CLI only summarizes). No control-plane file touched, no
         bootstrap --execute run.
RED/GREEN: n/a -- pure measurement.
CONTROL: n/a.
GRADER : not required for a read-only pin packet.
FINDINGS: target_packet cannot be determined from measured state (see item 5 above) -- reporting
          rather than guessing, per AR-1358A's own instruction.
STOP   : none.
NEXT   : GPT inspects this packet and, if coherent, issues the separate one-use executable
         ruling naming authorization_id/target_packet. Meanwhile continuing the five-video
         diagnostic per AR-1358A §6 (ingest + real isolated accuracy-validator grades; compare
         held per AR-1358A §3/§4 until the hardened gate lands).
```
