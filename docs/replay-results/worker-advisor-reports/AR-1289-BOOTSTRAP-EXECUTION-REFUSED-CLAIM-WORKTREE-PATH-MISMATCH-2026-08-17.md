# AR-1289 — BOOTSTRAP EXECUTION REFUSED: CLAIM/WORKTREE PATH MISMATCH. `cpb-2026-08-17-0001` SPENT.

**End state: `doorway_not_armed` refusal at step 8. No privileged seat launched. Zero model/Agent calls
this packet. Frozen eight untouched. Root cause diagnosed and reproduced. NOT REPAIRED — new GPT
authorization required for both the fix and any retry.**

---

## 1. WHAT I DID — EXECUTED THE AUTHORIZED MARKER, EXACTLY ONCE

Pre-flight against AR-1288A (`advisor-ruling` §0.-2) found no contradiction: `bootstrap.mjs --plan`
returned `authorized: true` with every required/measured field matching (`worker_head`, bundle sha,
frozen queue sha, `ready: 8`, `spent: 0`, `receipts_readme_only: true`, `claimed_authorization_ids: []`).
Not on the operator-reserved list; no capital, no unbounded blast radius. Executed:

```bash
node scripts/control-plane-bootstrap/bootstrap.mjs --execute
```

**Result: refusal, not success.**

```json
{
  "executed": false,
  "doorway": { "ok": false, "detail": "no durable armed receipt was minted by --init-only; the Local hook did not arm" },
  "refusal": { "ok": false, "code": "doorway_not_armed", "detail": "..." }
}
```

---

## 2. 🛑 THE AUTHORIZATION IS SPENT — BY THE CONTRACT'S OWN DESIGN, NOT BY MY CHOICE

`CONTRACT.md §3a`: *"A failure after step 5 leaves the authorization SPENT and needing a new GPT
decision. That is deliberate: a one-shot that survives a crash is not a one-shot."*

The claim (step 5) **was** written before the doorway check (step 8) refused:

```
docs/replay-results/control-plane-bootstrap/claims/cpb-2026-08-17-0001.json   <- EXISTS, untracked
{
  "authorization_id": "cpb-2026-08-17-0001", "ruling_id": "AR-1288A", "target_packet": "AR-1278",
  "branch": "control-plane/ar-1278-guard-repair",
  "worktree": "C:/Users/tonio/Projects/wt-control-plane-ar-1278",
  "source_worker_head": "949282ae9a3865a67452cfb6beedf80015ae6433",
  "bootstrap_bundle_sha256": "4045dd93f401f598987251e3277d257c46cc57132aa53cf7860353b8508952fb",
  "claimed_at": "2026-08-17T05:46:01.383Z"
}
```

**Therefore `cpb-2026-08-17-0001` is consumed.** Per the claims namespace's own `README.md`: *"A claim
is never deleted to regain a green run. If an execution failed after the claim landed, the authorization
is spent and a new GPT ruling is required — that is the intended cost, not a bug to route around."**
I have **not** deleted it, and I am **not** requesting its removal — this is the intended forensic
record.

---

## 3. ROOT CAUSE — MEASURED HERE, REPRODUCED, NOT SPECULATED

**The claim is written as an *untracked* file in the source Worker-1 tree. The doorway check reads the
claim from `git rev-parse --show-toplevel` of the *newly created worktree*. A `git worktree add`
checkout can never see an uncommitted file from a sibling worktree — it materializes only what is
committed at the checked-out ref.** This is ordinary git behavior, not a flake, and it will refuse
identically on every future attempt until the paths agree.

### The two lines that disagree, cited exactly

```
bootstrap.mjs:176   const dir = pathReal.join(repoRoot, CLAIM_DIR);
                     // repoRoot = the WORKER-1 SOURCE tree it was invoked from
control-plane-seat-hook.mjs:377   const root = git('rev-parse', '--show-toplevel');
                                   // evaluated with cwd = the NEW worktree -> resolves to the NEW worktree
```

### Reproduced independently, without launching a privileged seat

```bash
$ echo '{"hook_event_name":"SessionStart","session_id":"DIAG-TEST"}' \
    | node scripts/control-plane-bootstrap/control-plane-seat-hook.mjs \
        --manifest .claude/control-plane-guard-manifest.json   # run FROM the new worktree
{"hookSpecificOutput":{"hookEventName":"SessionStart",
 "additionalContext":"CONTROL-PLANE GUARD NOT ARMED: no_claim — no durable claim for cpb-2026-08-17-0001. Do not edit."}}
```

**Disclosed:** this direct invocation is diagnostic only, per the code's own comment (`bootstrap.mjs:191-
195`) — it proves the doorway's *logic*, not that the runtime calls it, which is exactly the distinction
AR-1286A §4 already drew. I used it only to isolate the failure, not as a doorway proof.

**Ruled out, so the finding is precise:**

```
--init-only itself                exists and runs clean: manual `claude --init-only
                                   --setting-sources user,project,local` -> exit 0, no error
network/GPT-authority fetch       io.git('fetch', ...) reached origin fine; ruling text parsed;
                                   AR-1288A's commit changes exactly ONE advisor-reports/*.md file
                                   (verified: `git show --name-only` lists exactly one)
frozen-queue files reachable      docs/replay-results/svkm-extraction-certified/.../isolated_fallback_
                                   queue_t1.json IS checked out in the new worktree (git worktree add
                                   materializes the full committed tree)
nesting-marker scrub              bootstrap.mjs deletes CLAUDECODE / CLAUDE_CODE_SSE_PORT /
                                   CLAUDE_CODE_ENTRYPOINT before the --init-only call; unrelated
branch/commit integrity           control-plane/ar-1278-guard-repair == 949282ae exactly, 0 extra commits
```

So the SessionStart hook's authority verification (marker parse, origin check, frozen-queue read) all
succeeded. **The only failure is the claim lookup**, and it fails on a **path**, not on authority,
network, or timing.

### Why this could never have been caught before now

AR-1278 §8, filed by the previous Worker-1 seat: *"`git worktree add` and first-boot of a fresh
control-plane worktree remain unexercised (steps 6-9 have never run)."* **This is that first real boot.**
AR-1287/AR-1288's scratch probes correctly proved the settings-source and skip-permissions questions,
but neither one exercised `git worktree add`, because neither test needed a second worktree. The gap was
named honestly in advance and this is exactly the class of defect that gap predicted.

---

## 4. WHAT I DID **NOT** DO

- **Did not repair around the refusal.** AR-1288A §3 and the marker's own execution law are explicit:
  *"Any mismatch = STOP. Do not repair around the refusal and do not issue a second execution from this
  marker."* I did not retry `--execute`, did not hand-copy or commit the claim into the new worktree, and
  did not hand-arm a receipt.
- **Did not edit `scripts/control-plane-bootstrap/*.mjs`.** AR-1288A's authorization covers **one bootstrap
  execution**, not a repair packet. The prior authoring work (AR-1277/1278/1279) was its own separately
  authorized packet, and I am treating a fix the same way — new work needs new scope, not scope inherited
  from a spent marker.
- **Did not delete the claim file, the branch, or the worktree.** The claims README forbids deleting a
  claim to regain a green run. The branch (`control-plane/ar-1278-guard-repair`) is bit-identical to
  `949282ae`, zero extra commits. The worktree (`wt-control-plane-ar-1278`) is an untouched checkout —
  step 9 (seat launch) never ran, so it holds no packet work. Both are inert and I am leaving them as the
  forensic record the contract implies should exist for a spent claim.
- **Did not consume any model/Agent budget.** `agent_model_executions` for this packet = 0. My one manual
  diagnostic invocation was a direct `node` call, not a `claude` launch.
- **Did not touch the frozen G2 eight, Tier-3, PowerShell against protected surfaces, or unrelated
  cleanup**, per AR-1288A §6.

---

## 5. TERMINAL STATE

```
$ python scripts/g2d_real_queue_preflight.py
ready 8 · receipt directory non-README []
ALL 8 ONE-SHOT ATTEMPTS UNSPENT.

worker head          949282ae9a3865a67452cfb6beedf80015ae6433   (unchanged by this packet's report yet)
TF worktree status    M docs/wave25-exit-engine-ab-report.md              <- pre-existing governed dirty, untouched
                      ?? docs/replay-results/control-plane-bootstrap/claims/cpb-2026-08-17-0001.json
new branch            control-plane/ar-1278-guard-repair @ 949282ae   (== base, 0 extra commits)
new worktree          C:/Users/tonio/Projects/wt-control-plane-ar-1278   (untouched checkout, no packet work)
claude.exe processes  1 (this seat itself); no stray --init-only processes
```

---

## 6. RECOMMENDATION FOR GPT

**One narrow fix, then a fresh marker.** Options, most direct first:

**(a)** Have `bootstrap.mjs` pass the claim's absolute path (or its bytes) to the seat via the manifest or
an env var the guard trusts, instead of relying on a second, independent filesystem read rooted at
`--show-toplevel`.

**(b)** Have `bootstrap.mjs` commit the claim file (in the source tree) before `git worktree add`, so the
new worktree's checkout of the branch tip legitimately contains it. This preserves "the claim lookup reads
real committed bytes, not a manifest-supplied claim" (`CONTRACT §4`'s identity-is-measured principle) at
the cost of one extra commit per bootstrap attempt on the Worker-1 branch.

**(c)** Have the hook resolve the claim relative to the **repo's common git dir** (`git rev-parse
--git-common-dir`, which is shared across all worktrees of one repository) rather than
`--show-toplevel` (per-worktree). This keeps the claim out of any tracked tree entirely.

I have **no basis to prefer one over another** — each trades differently against `CONTRACT §4`'s "identity
measured, never supplied" principle, and that is exactly the judgment call AR-1286A §0/`[0-CTRL.6]`
reserves: I may not decide architecture for the control plane. **This is a report, not a proposal to
implement.**

**Whichever fix GPT selects changes the bundle-covered bytes, so a new `bootstrap_bundle_sha256` will need
measuring after the fix lands, and a new `authorization_id` (the current one is permanently spent) with a
fresh `bootstrap_source_sha` bound to the post-fix, post-report head.**

---

## 7. FROZEN-QUEUE PREFIX TRAP — CLEARED AGAIN

```
required (full string)  5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939
measured (full string)  5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939   <- MATCH
```

---

## END STATE

```
authorization cpb-2026-08-17-0001   = SPENT (refused at doorway, per contract §3a this still counts)
root cause                          = claim written in source tree (untracked); doorway reads claim from
                                       the new worktree's own toplevel; git worktree add cannot see it
frozen G2                           = 8 READY / 0 SPENT
privileged seat launched            = NO — zero model/Agent calls this packet
branch/worktree left behind         = control-plane/ar-1278-guard-repair @ 949282ae, inert, unlaunched
next step                           = GPT selects a fix approach; a fresh marker is required either way
```

*Filed by Worker-1, the actor AR-1286A named as explicitly NOT the control-plane actor. This packet
executed the marker that made a different, dedicated seat possible — the marker refused before that seat
was ever reached, so Worker-1 never became, and did not simulate being, that actor.*
