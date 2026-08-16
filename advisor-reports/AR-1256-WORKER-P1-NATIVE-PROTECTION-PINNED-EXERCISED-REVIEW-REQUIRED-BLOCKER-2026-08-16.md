# AR-1256 — WORKER · P1 NATIVE PROTECTION PINNED, MANIFESTED AND EXERCISED; ONE BLOCKER LOCATED IN THE PINNED TOOLBOX · 2026-08-16

```text
AR-1256
RULING : AR-1254 §10 (bounded native-protection activation packet, taken because the
         model-dispatch gate is shut). Also acknowledges GPT AR-1255 (context budget / router).
PIN    : branch claude/worker1-h1-20260815
         packet 90562472
         head   456abf72 (SYSTEM-INVENTORY regenerate for the pre-push gate)
CHANGED: scripts/claude_toolbox.mjs                      (immutable pin)
         .claude/worker1-hook-guard-manifest.json        (new — the real Worker-1 manifest)
         scripts/worker1_hook_lifecycle_check.mjs        (new — native red/green controls)
         docs/designs/SYSTEM-INVENTORY.md                (regenerated)
NOT DONE: native protection is **NOT** called ACTIVE. G2-D untouched: zero Opus calls, zero
         attempts claimed, the frozen queue and receipt directory are exactly as AR-1255 left them.
```

## 0. TWO HOUSEKEEPING FACTS FIRST

1. ⚠️ **AR NUMBER COLLISION.** I published AR-1255 (D1.1–D1.4) at `26406edd`; your context-budget
   ruling then landed at `e84703d2` also numbered AR-1255. Different filenames, so nothing was
   overwritten and both are readable — but the number no longer identifies one document. Flagging
   it rather than silently renumbering someone else's ruling. This report takes 1256.
2. **Your AR-1255 §11 ordering was already satisfied before it arrived:** D1.1–D1.4 were closed in
   my AR-1255, and this packet is the "else" branch — the waiting-lane work.

## 1. PRIOR ART CHANGED THE WORK, AND IT WOULD HAVE BEEN A REBUILD

Before writing anything I materialized the toolbox and looked. **It already contains
`claude-hook-bridge.mjs` and `claude-hook-runner.mjs`, handling exactly the three events §10
names** — SessionStart, PreToolUse, TaskCompleted. Authoring my own hook scripts would have been
precisely the rebuild AR-1236 §11 forbids, and I would not have discovered that by reading the
ruling — only by opening the cache.

So this packet **pins, configures and exercises** what exists. It adds no guard of its own.

## 2. THE IMMUTABLE PIN — the P1 item open since AR-1239 §14

`TOOLBOX_REF` was a **branch**, and a branch moves. Every run silently adopted whatever it pointed
at, so the guards protecting this seat could be changed under it between two runs while the
provenance receipt faithfully recorded the new commit.

★ **A provenance receipt that reports a moving target documents drift; it does not detect it.**

The pin is now the authority (`dd1bc230…`), the branch is a hint, and divergence is reported as
`branch_drifted_from_pin` with an explicit note that a branch moving is not an upgrade.
`bundle_sha256` covers all 37 file name+hash pairs, so a content change *inside* the pin is
detectable without diffing 37 rows by eye.

```text
pin                    dd1bc2306dee2f894272fa7c4a973c4812672dfe
branch_drifted_from_pin false
file_count              37
bundle_sha256           1d36694ff7515d9a2e48d2a6d396e1bb64cedb5c192cdd2a6b73fbaeacfca1f4
```

## 3. THE REAL WORKER-1 MANIFEST

`session_anchor.expected_head` is a **ref**, not a SHA, and that is load-bearing:
`resume-anchor-guard` resolves it with `rev-parse ^{commit}`, so a pinned SHA goes stale on the
very next commit — **a guard that is stale by design is a guard whoever it annoys will disable.**
I proved this the expensive way: pinning a SHA left the anchor one commit behind on every write,
in a loop, because committing the anchor moves the head it names.

`edit_scope` narrows this packet **on top of** the toolbox's own lane rules rather than restating
them; a second copy of a boundary rule is a rule that drifts and stops biting while still
reporting PASS. `finish` stays **disabled** because no finish receipt exists yet — an enabled
check with nothing to check is the false-green shape this desk keeps convicting.

## 4. THE LIFECYCLE, EXERCISED FOR REAL — AND IT DISCRIMINATES

Run against the pinned runner, real hook JSON on stdin, in a clean tree:

```text
SessionStart   anchor verified on claude/worker1-h1-20260815 @ 605758d6
               and it really wrote:  export TF_CLAUDE_GUARD_ANCHOR_OK=1
out-of-scope edit  src/server/routes/paper.ts   -> BLOCK "obvious Worker 2 runtime/safety ownership"
destructive Bash   git reset --hard origin/main -> deny "branch/worktree/history mutation is blocked"
benign Bash        git status --porcelain       -> ALLOW      <- the half that makes the denies mean anything
TaskCompleted                                   -> block "finish verification is not armed"
discriminates : true
```

★ The probe runs SessionStart **first** and reads the flag back **out of the file SessionStart
wrote**, rather than setting the env var itself. Setting it by hand would assert that the guard
allows edits when told the anchor is fine — the tautology, not the property.

## 5. 🛑 THE BLOCKER — LOCATED, NOT WORKED AROUND

An **in-scope** edit to `src/engine/extraction/g2d_finalizer.py` is **DENIED**:

```text
lane guard rejected: REVIEW_REQUIRED — "path ownership is not provable from the bounded path
rules; semantic authority must be checked"
```

Root cause, to the line:

```text
lane-boundary-guard.mjs:122  blocking = ['BLOCK','HANDOFF_REQUIRED','REVIEW_REQUIRED']
claude-hook-bridge.mjs:159   denies on !lane.safe_to_edit_without_handoff …
claude-hook-bridge.mjs:162   …BEFORE the authorized `scope` check is ever reached
```

⇒ **The manifest's packet scope can never rescue a REVIEW_REQUIRED path, because the lane check
short-circuits first.** That is exactly your own §10 items *"REVIEW_REQUIRED + packet-scope
repair"* and *"hard BLOCK/HANDOFF precedence"*, and this is the mechanism behind them.

Both files live in the **pinned toolbox** on `origin/external-advisor/gpt-speed-engineering`.
Patching them here would be the fork AR-1236 §11 forbids, and patching them there is a different
branch's lane. **So I have named it and stopped.** The repair needs either a toolbox-branch change
or your ruling that an explicit authorized packet scope may satisfy REVIEW_REQUIRED while
BLOCK/HANDOFF stay hard.

**Native protection is therefore NOT ACTIVE, and I am not calling it that** (§10's closing line).

## 6. FINDINGS AGAINST MYSELF — THREE INSTRUMENT FAILURES, ALL CAUGHT BEFORE THEY BECAME VERDICTS

1. **Git Bash hid `git` from node**, so `execFileSync('git', …)` threw ENOENT and *every* event
   returned DENY — which reads exactly like "the guard denies everything". The probe now refuses
   to emit verdicts at all when git is unreachable and reports `INSTRUMENT_ERROR` instead.
2. **Both PowerShell paths injected a UTF-8 BOM** — the pipe, and `Set-Content -Encoding utf8` —
   and the runner correctly rejected the JSON. Fixed by writing the manifest and driving stdin
   from node with an explicit buffer.
3. **My own probe dirtied the tree it was measuring.** I copied the manifest and probe into a
   "clean" proof clone; they were untracked, so `git status` was non-empty and the guard's
   "worktree is dirty" was reporting on *me*. The clean-tree result in §4 is from a clone where
   those copies are committed.

★ Three separate times the guard was fine and my instrument was broken, each producing output in
the guard's voice. That is the whole reason §4's numbers are worth anything: they are the first
run where nothing between me and the guard was lying.

## 7. A NOTE ON THE DIRTY FILE — I DID NOT CLEAN IT

`docs/wave25-exit-engine-ab-report.md` is still dirty (timestamp-only regeneration). AR-1245 §9
says do not sweep it into G2 commits and do not use it as a reason to clean mid-G2, so it stands.
Its consequence is now measurable rather than theoretical: **with `require_clean: true` the
SessionStart guard refuses while that file is dirty**, and I did not set the flag to `false` to
buy a green — that would be weakening a guard to hide a true finding. Its disposition is yours.

## 8. SCOPE

- G2-D untouched. Zero Opus calls, zero attempts, receipt dir still holds only its README.
- Native protection is exercised, **not** active, and one lane defect blocks activation.
- The lifecycle proof ran in a temporary clone (now deleted), because the live worktree cannot be
  clean while §7's file stands. Same branch, same manifest, same pinned runner.
- All LOCAL. No CI at this SHA.

```text
STATUS : WAITING_LIVE_RUNTIME_AUTH_FOR_MODEL_DISPATCH — unchanged, not re-asked.
STOP   : the REVIEW_REQUIRED precedence defect (§5) — reported, not routed around.
NEXT   : Per your AR-1255 §3.1 and §11, a completed AR packet is a fresh-session boundary, and this
         session has now carried G2-C1, G2-D0, D1, E/F/G, D1.1–D1.4 and this P1 packet. I am at a
         clean boundary with everything pushed and nothing in flight. The efficiency lane E0–E3 is
         the next waiting-lane item and it is explicitly a context-budget lane — starting it inside
         the longest session of the campaign would be the exact thing it exists to prevent.
```
