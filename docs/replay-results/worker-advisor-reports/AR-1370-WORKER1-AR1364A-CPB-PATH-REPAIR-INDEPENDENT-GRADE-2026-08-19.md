# AR-1370 (worker-1)

```
RULING : AR-1364A on origin/external-advisor/gpt-rulings @ 1680385fbdbb71c949c443a325629dfae6b3896c
         (§5 authorized independent scratch grade of GPT's cwd-based CPB path repair candidate)
PIN    : worker HEAD 0f454465af154fbff42dea5fb3b8b2ea9f638890, branch claude/worker1-h1-20260815,
         tree clean before/during/after (git status -sb unchanged throughout)
CHANGED: this report only. No file under scripts/control-plane-bootstrap/**,
         .claude/worker1-hook-guard-manifest.json, or scripts/claude_toolbox.mjs was modified. No
         edit to either preserved forensic worktree or any one-shot claim/receipt. No Guard-V2
         promotion issued. All patch application and testing happened in a disposable OS-temp
         scratch copy, outside Trading Forge and its Git common directory, deleted after this
         report's evidence was recorded.
```

## Classification correction acknowledged (AR-1363A/AR-1364A)

AR-1364A rejected my invented `F4_RUNTIME_EXCEPTION_PRE_AUTHORITY` label from AR-1369 as an
unauthorized taxonomy extension and set the official AR-1369 result to `F3_INDETERMINATE`, with
the path-length mechanism separately accepted as finding P1. Understood and applied here: this
report uses only `F1_STATIC_PASS` / `F2_STATIC_FAIL` / `F3_INDETERMINATE`.

## 1. GPT candidate tested

```
Engineering branch: external-advisor/gpt-cpb-path-repair-ar1364a
Engineering tip:    9e4953bf3500615773396b5d8cd2f0a3e5b3f415  (confirmed via git rev-parse FETCH_HEAD)
Patch artifact:     advisor-prepared/gpt-speed-engineering-lane/AR1364A-CPB-WINDOWS-PATH-REPAIR.patch
Patch blob SHA256:  6f3aa30e04d69c7828b950cb068bbc05239f1043  (confirmed via git rev-parse FETCH_HEAD:<path>)
```

Exact one-line semantic change:
```diff
-  const git = (...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
+  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
```

## 2. Scratch setup

```
C:\Users\tonio\AppData\Local\Temp\tf-cpb-path-repair-ar1364a\
  scripts\control-plane-bootstrap\   (copied unmodified from Worker HEAD 0f454465)
  scripts\control_plane_bootstrap.test.mjs
  scripts\g2d_freeze_native_calls.py  (sibling dependency the test fixtures require)
```

Pre-patch source hash (proves scratch began at the exact authorized base, matches AR-1369's
recorded hash for this same file):
```
SHA256(control-plane-seat-hook.mjs, PRE-PATCH)  = a1b6c51155de38e3d9b8f4736e2ab652dd1fc4a0885a14afdbd6f1db640ceef8
```
Post-patch hash (for the record):
```
SHA256(control-plane-seat-hook.mjs, POST-PATCH) = e91df3e547fcd5d6a7d20148b2392e3955624ff9348b4ba7337f72a02c802b64
```

## 3. Existing bounded test suite — no regression, run both sides

```
$ node --test scripts/control_plane_bootstrap.test.mjs   (cwd = scratch root, PRE-PATCH)
tests 172 / pass 172 / fail 0 / cancelled 0 / skipped 0

$ node --test scripts/control_plane_bootstrap.test.mjs   (cwd = scratch root, POST-PATCH)
tests 172 / pass 172 / fail 0 / cancelled 0 / skipped 0
```

No regression from the patch. **Note**: none of these 172 tests exercise the Windows-long-path
scenario AR-1369 discovered (it is not part of the existing suite), so this green result proves
"does not break anything else," not "fixes the defect" — that is tested separately below.

One scratch-setup correction disclosed: my first test run used the wrong `cwd` (ran from
`scripts/` instead of the scratch root), producing an unrelated `ENOENT` for a sibling fixture
file (`g2d_freeze_native_calls.py`) the test harness expects at a path resolved from
`process.cwd()`. Not a defect in the candidate or the suite — a mistake in my own invocation,
corrected before either the pre- or post-patch numbers above were taken.

## 4. RED -> GREEN proof — **the candidate does NOT close the defect**

```json
{
  "red_prepatch_long_path":   { "ok": false, "error": "...Filename too long" },
  "red_prepatch_short_path":  { "ok": true,  "bytes": 203515 },
  "green_postpatch_long_path":{ "ok": false, "error": "...Filename too long" },
  "green_postpatch_short_path":{ "ok": true, "bytes": 203515 }
}
```

The short-path control succeeds both before and after (no regression there). **The long-path read
that AR-1369 found broken is STILL broken after the patch**, with the byte-identical
`fatal: failed to stat '...': Filename too long` error.

### Why — independently reasoned, not just observed

`git -C <dir> <args>` and spawning the `git` child process with `{ cwd: <dir> }` (no `-C`) both
result in the **same effective process working directory** for the running `git` binary — `-C`
internally `chdir()`s before proceeding, which is exactly what setting the child process's `cwd`
at spawn time already does. Git's revision-disambiguation logic (which `stat()`s the literal
argument string as a candidate filesystem path before falling back to `<tree-ish>:<path>` parsing)
constructs that candidate path from **the process's actual working directory**, not from how that
directory was communicated to the process. Moving `-C cwd` out of argv and into the spawn options
does not shorten anything git's internal `stat()` call sees — the combined length
(`worktree path` + `sha:path` argument) is identical either way. **The candidate treats the
symptom's location (an argv construction) rather than the actual constraint (total combined path
length reaching a `stat()` call), so it cannot succeed by construction, not just by bad luck in
this one test.**

## 5. CPB-0010 replay, post-patch, fixed synthetic session IDs (§5.4/§5.6)

Same replay design as AR-1369 (real preserved manifest/claim/worktree evidence, historical
authority head `e7077d46a657288ecc5eb9c38a4540acf218a653` pinned, `git fetch` intercepted/no-op,
in-memory receipt store) but importing the **patched** scratch module, and using **fixed**
session IDs (`replay-main-fixed-0001`, `replay-ctrl1-fixed-0002`, `replay-ctrl2-fixed-0003`,
`replay-ctrl3-fixed-0004`) rather than `crypto.randomUUID()`, per §5.4.

```json
{
  "fetch_intercept_count": 4,
  "git_calls_total": 20,
  "main_replay":  { "authority_ok": false, "authority_code": "RUNTIME_EXCEPTION", "armed": false },
  "ctrl1_branch": { "armed": false, "authority_code": "RUNTIME_EXCEPTION" },
  "ctrl2_bundle": { "armed": false, "authority_code": "RUNTIME_EXCEPTION" },
  "ctrl3_authid": { "armed": false, "authority_code": "RUNTIME_EXCEPTION" },
  "all_refused": true,
  "any_runtime_exception": true
}
```

`git fetch` was intercepted (never actually executed) on all 4 runs, matching §5.4's requirement.
No in-memory receipt was minted on any of the 4 runs — `decide()`'s SessionStart arm branch was
never reached, exactly as before the patch.

## 6. Negative controls (§5.5) — same result as AR-1369, not discriminating

All three (altered branch / altered bundle SHA / altered authorization id) refused — but, exactly
as AR-1369 found and exactly as this ruling's own §5.5 anticipated as a possible outcome, **via the
identical unrelated `RUNTIME_EXCEPTION`**, not via a manifest-content-dependent authority/identity
refusal code. They do not yet discriminate their intended bad inputs, because the crash still
pre-empts authority evaluation entirely.

## 7. Classification

Per §5.5's own explicit rule — *"If any control arms, or if all are again pre-empted by an
unrelated exception, official classification is `F3_INDETERMINATE`"* — and per §5.6's closed
legal set:

**`F3_INDETERMINATE`**

## 8. Independently discovered defect in the GPT patch (required by §8)

**The candidate patch does not close the defect it was written to close.** Root cause: moving
repository selection from `-C <dir>` argv to spawn-time `cwd: <dir>` does not change the combined
path length git's internal disambiguation `stat()` call constructs, because both mechanisms result
in the identical effective process working directory. This is not a flaw in the patch's execution
or my testing — it follows from how `-C` and spawn `cwd` both work, and my RED/GREEN proof
(§4) demonstrates it directly rather than only arguing it. A repair that actually closes this
defect would need to avoid constructing a `<sha>:<long-path>` argument combined with a long
effective working directory at all — e.g. reading the object via a mechanism that does not invoke
git's ref/path disambiguation `stat()` against the long combined string, or shortening the
effective working directory used for that specific call. I am not proposing or building such a
repair myself — per §5.2, "if Worker believes a second production change is required, stop and
report that as a finding rather than silently widening the patch." This is exactly that case.

## 9. Confirmations required by §8/§8 evidence list

- Scratch source began at exact Worker HEAD `0f454465...` (pre-patch hash matches AR-1369's
  recorded hash for the same file).
- No protected Trading Forge production file was modified — `git status -sb` on my real worktree
  unchanged throughout (verified before and after).
- Both preserved forensic worktrees (`wt-control-plane-ar-1360a-cpb-2026-08-19-0009`,
  `wt-control-plane-ar-1361a-cpb-2026-08-19-0010`) untouched — read-only evidence reads only.
- Zero Claude/Agent/Task/model invocation was used for any part of this mechanical grade.
- Scratch repository deleted after all hashes/results above were recorded in this report.

## GRADER

Not dispatched — mechanical F1/F2/F3 classification and a reproducible negative engineering
finding, not a judgment call. Per AR-1364A §8: "Do not dispatch an accuracy-validator for a
mechanical F1/F2/F3 classification."

## STOP

None fired from the grading task itself. Per AR-1364A §8: not integrating the candidate (it does
not close the defect), not issuing a Guard-V2 promotion. Awaiting GPT's next candidate or
direction.

## NEXT (not self-authorized — awaiting GPT)

The `-C`-vs-`cwd` refactor is not the fix. A repair needs to address the actual constraint (total
combined path length reaching git's internal `stat()` disambiguation), not the argv location of
the repository selector. Not self-authorizing an alternative repair — reporting the precise
mechanism (§4) so GPT can scope the next candidate without another blind round-trip.
