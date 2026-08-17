# AR-1290 — BOOTSTRAP RETRY-SAFETY REPAIR: C1–C10 CLOSED, AUTHORING/TESTING ONLY

**Both AR-1289 defects repaired: the claim now lives in the shared Git common directory (AR-1289A
§3), and branch/worktree identity now includes the authorization id (AR-1289A §4). 65/65 tests
pass, including three new tests against REAL git worktrees/repositories that exercise the actual
fix rather than a fake. Zero bootstrap executions, zero privileged launches, zero Agent/subagent
calls, zero frozen G2 spend. Frozen eight: 8 READY / 0 SPENT, verified terminally.**

**Model:** run on Sonnet 5 per this packet's routing law (AR-1288A/AR-1289A §"Model routing for
this packet"), after AR-1290's own required STOP for the model boundary (see the prior report,
`AR-1290-MODEL-BOUNDARY-STOP-2026-08-17.md`). **Disclosed limitation:** this top-level session has
no tool to introspect its own running model identity — the switch to Sonnet 5 is `RELAYED` (the
operator's own action, confirmed by him), not something I can grade `MEASURED HERE`. I have no
reason to doubt it and no way to independently confirm it from inside the session.

---

## 1. WHAT WAS BROKEN, AND WHAT CHANGED

**Defect 1 (AR-1289):** the claim was written as an *uncommitted* file inside the source worktree's
own tracked tree. The receiving seat resolved its claim path from **its own**
`git rev-parse --show-toplevel` — a `git worktree add` checkout, which can only ever contain
committed bytes at the ref it was cut from. Structurally invisible, not a timing bug.

**Fix:** new file `scripts/control-plane-bootstrap/claim-store.mjs`. Both the bootstrap (writer,
running in the source worktree) and the seat hook (reader, running in a brand-new sibling worktree)
independently derive the claim path from `git rev-parse --git-common-dir` — the one physical
directory every worktree of a repository shares. Nothing is passed through the marker, manifest,
model prompt, env, or any caller parameter (AR-1289A §3's explicit constraint). The legacy committed
directory (`docs/replay-results/control-plane-bootstrap/claims/`) is untouched, immutable, and still
checked — the replay refusal is a **union** of both stores.

**Defect 2 (AR-1289A §4):** `deriveBranch`/`deriveWorktreeDirName` took `target_packet` alone, so a
fresh authorization for the same packet would collide with a spent attempt's names — and cleaning
up the spent attempt to make room is forbidden.

**Fix:** both functions now take `(targetPacket, authorizationId)`. Same packet + same id ->
byte-identical names; same packet + different id -> different names; the old attempt never needs
deleting.

**Files touched**, exactly the authorized surface (AR-1289A §5), nothing else:

```
NEW    scripts/control-plane-bootstrap/claim-store.mjs
MOD    scripts/control-plane-bootstrap/bootstrap.mjs
MOD    scripts/control-plane-bootstrap/control-plane-seat-hook.mjs
MOD    scripts/control-plane-bootstrap/plan.mjs
MOD    scripts/control-plane-bootstrap/bundle.mjs
MOD    scripts/control_plane_bootstrap.test.mjs
MOD    docs/replay-results/control-plane-bootstrap/CONTRACT.md
```

`git diff --stat`: 6 files changed, 366 insertions(+), 45 deletions(-), plus the new file.
`[MEASURED HERE]` — reviewed the full diff of every production file before committing; nothing
outside the claim-store repair and attempt-identity repair changed.

---

## 2. C1–C10 — EACH PROOF, WITH ITS COMMAND

### C1 — first mutation still the claim

```
node --test  ->  AR1290-C1 first mutation still the claim: O_EXCL in the shared store;
                 a repeat write refuses                                          PASS
```
Real `git init` fixture, no mocks. Confirms the common directory pre-exists (no `mkdir`), the
first write succeeds, and a **second** write for the same id throws (`{flag:'wx'}`) without
mutating the original claim's bytes (`claimed_at` stays `T1`, not overwritten to `T2`).

### C2 — real sibling-worktree visibility

```
node --test  ->  AR1290-C2 real sibling-worktree visibility ...                  PASS
```
Real fixture: a main worktree writes a claim, **then** a sibling is created via
`git worktree add`, mirroring the actual execution order (claim precedes worktree creation). The
sibling's own `--git-common-dir` resolves to the **same physical path** as the main worktree's
(asserted equal), and the exact same bytes read back. **Two negative controls, not one:**
(1) an uncommitted legacy-style file in the source tree is confirmed absent from the sibling's
checkout — reproducing AR-1289's actual bug; (2) the pre-fix `readClaim` shape (relative to
`--show-toplevel`) is reproduced inline and asserted to return `null` against the claim the new
writer produced — the literal "fails under a mutation that switches the reader back to
`--show-toplevel` storage" requirement.

### C3 — repository isolation

```
node --test  ->  AR1290-C3 repository isolation: a different repository must not
                 see or accept the same authorization id                          PASS
```
Two independent `git init` repositories. Their common dirs are asserted distinct. The same
authorization id string, claimed only in repo A, is confirmed absent from repo B via both the raw
new-store read and the combined legacy+new lookup, and repo B's own store listing is empty.

### C4 — legacy replay remains spent

```
node --test  ->  AR1290-C4  legacy replay remains spent (new store EMPTY)         PASS
node --test  ->  AR1290-C4b new-store replay also refuses (legacy store EMPTY)    PASS
```
Two symmetric cases prove the union, not either store alone: an id claimed only in the legacy
store refuses with the new store empty, and an id claimed only in the new store refuses with the
legacy store empty. Both request **zero** effects (`recordingEffects().calls` is `[]`), matching
the existing `C14`/`C7` no-effect convention for every refusal path.

### C5 — attempt-specific branch/worktree names

```
node --test  ->  AR1290-C5  same packet + different authorization -> different names   PASS
node --test  ->  AR1290-C5b same packet + same authorization -> byte-identical, twice  PASS
```
`deriveBranch`/`deriveWorktreeDirName` take exactly two parameters (`.length === 2`, asserted in
C6 below) — no caller/model/operator path parameter exists.

### C6 — stale spent attempt does not block a fresh plan

```
node --test  ->  AR1290-C6  stale spent attempt does not block a fresh plan            PASS
```
The AR-1289 fixture reproduced literally: `control-plane/ar-1278-guard-repair` /
`wt-control-plane-ar-1278` (the real names left on disk right now) compared against the derived
names for a fresh authorization on the same packet — confirmed different, with **no deletion of
the stale pair anywhere in the test or in this packet's real actions** (verified below, §3).

### C7 — identity/authority invariants remain

Not a new test — a **regression guarantee**: all 56 pre-existing tests (N1–N18, C1–C15 in the
file's own pre-AR-1290 numbering, the LIVE `--init-only` tests, the end-to-end refusal-path tests)
still pass unchanged after the refactor. Wrong repo (N11/C9c), wrong ruling (N10), wrong
authorization id (`C8c`'s `manifest_authorization_mismatch`), wrong source SHA (C8), wrong bundle
(C9), frozen-state drift (N7/N8/N9), missing claim (`C8c`'s `no_claim`) — every one of these still
refuses before any privileged-launch effect is requested. That they kept passing through this
refactor **is** C7's proof.

### C8 — bundle coverage, generated not hand-typed

```
node --test  ->  AR1290-C8  claim-store.mjs is covered by BUNDLE_FILES, asserted
                 from the live export                                             PASS
```
`bundle.mjs`'s `BUNDLE_FILES` array now lists nine files (was eight, per AR-1288A §2's correction;
CONTRACT.md's stale "seven" prose is fixed in the same commit, since I am directly the one
invalidating it further by adding a ninth). Real production bundle, computed from disk:

```
$ node -e "...computeBundle(readFileBytes)..."
bundle_sha256: b2bd6d9c833327cb16b61fe9fef089279ca4b7131d34055210602344cd29a747
```

### C9 — no execution

```
bootstrap executions       = 0   (never ran --execute against the real repo or worktree this session)
privileged model launches  = 0
Agent/subagent calls       = 0
frozen G2 calls             = 0
```
All test-suite git activity happened inside OS-temp `mkdtemp` fixtures, cleaned up in `finally`
blocks. `[MEASURED HERE]`: `git worktree list` for the real repo shows exactly one control-plane
worktree — `wt-control-plane-ar-1278 @ 949282ae [control-plane/ar-1278-guard-repair]` — the
**pre-existing** one AR-1289 left behind, bit-identical to before this packet started. I created no
new worktree, no new branch, no new claim in the real repo.

### C10 — frozen terminal proof

```
$ python scripts/g2d_real_queue_preflight.py
queue_count 8 · claimed [] · dispatched [] · completed [] · crash_shaped [] · stranded_incomplete []
ready 8 · receipt directory non-README []
ALL 8 ONE-SHOT ATTEMPTS UNSPENT.
```

---

## 3. RE-RUN OF THE FULL SUITE, AND A SANITY RUN AGAINST THE REAL REPO

```
$ node --test scripts/control_plane_bootstrap.test.mjs
ℹ tests 65
ℹ pass 65
ℹ fail 0
```
56 pre-existing tests unchanged (2 renamed sub-assertions inside N14 to match the new two-argument
signature; nothing else touched), 9 new (`AR1290-C1..C8`, `AR1290-C4b`, `AR1290-C5/C5b/C6`).

```
$ node scripts/control-plane-bootstrap/bootstrap.mjs --plan
"code": "no_marker"                       <- correct: AR-1290 forbids a new marker; still refuses
"worker_head": "21a0aa9fe93612e89765bbe8d0494171d6e494ca"
"bootstrap_bundle_sha256": "b2bd6d9c833327cb16b61fe9fef089279ca4b7131d34055210602344cd29a747"
"newest_ruling": "AR-1289A"
"ready": 8, "spent": 0
```
This is the exact repaired code, run read-only against the real repository, and it still refuses
correctly with no marker present — the repair did not weaken the refusal path.

---

## 4. WHAT I DID NOT DO

Per AR-1290 §"Explicitly forbidden": no `bootstrap --execute`, no new executable marker, no new
bootstrap claim, no privileged seat launch, no frozen G2 eight, no frozen retries, no Tier-3 calls,
no Agent/subagent calls, no compiler/backtest/paper/broker/live-money work, no settings/guard/
manifest repair unrelated to this defect, no model-router repository implementation, and — the one
most tempting to "just quickly fix" — **no cleanup or deletion of the spent `cpb-2026-08-17-0001`
branch/worktree/claim.** All three remain exactly as AR-1289 left them.

`docs/wave25-exit-engine-ab-report.md`, the governed dirty file, was not touched.

---

## 5. HEADS, FOR THE NEXT MARKER

```
worktree             C:\Users\tonio\Projects\wt-claude-worker1-20260815
branch               claude/worker1-h1-20260815
pre-report head      21a0aa9fe93612e89765bbe8d0494171d6e494ca   (AR-1290 model-boundary stop, graded n/a — not yet ruled)
GPT authority head   1ace6efb8360d70d7bec09244ec7100c9d73414b   (AR-1289A, newest at packet start)
new bundle sha256    b2bd6d9c833327cb16b61fe9fef089279ca4b7131d34055210602344cd29a747
```

🛑 Per AR-1289A §7's own instruction (repeated for the record): **do not pre-copy any head into a
future executable marker.** Publishing this report advances the head; GPT must re-measure
`worker_head` and this new `bootstrap_bundle_sha256` at whatever commit it actually grades, and
`authorization_id` for the next marker should be `cpb-2026-08-17-0002` unless a competing
authorization exists in the meantime.

---

## END STATE

```
AR-1290 bootstrap retry-safety repair   = C1-C10 CLOSED
claim-store defect (AR-1289A §3)        = REPAIRED, proven against real git worktrees
attempt-identity defect (AR-1289A §4)   = REPAIRED
test suite                              = 65/65 PASS (56 pre-existing unchanged + 9 new)
bundle                                  = 9 files, b2bd6d9c833327cb16b61fe9fef089279ca4b7131d34055210602344cd29a747
frozen G2                               = 8 READY / 0 SPENT
bootstrap executions this packet        = 0
new executable marker                   = NOT issued (forbidden this packet — GPT's call, next ruling)
```

*Authoring/testing only, per AR-1290's actor definition — the same class of authority that produced
AR-1277/1278/1279. No control-plane seat was created or impersonated.*
