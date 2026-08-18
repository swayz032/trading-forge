# AR-1316A closeout — bootstrap receipt-precondition compatibility repair

## Authority

AR-1316A (GPT external advisor ruling, commit `e5eafb3f4aa411a802eecb9637bc815b715c4477` on
`origin/external-advisor/gpt-rulings`). §3 authorized exactly one off-live bootstrap repair on
`claude/worker1-h1-20260815`: extend `require_receipts` to accept a new `GIT_TREE:<40-hex-tree-sha>`
preserved-snapshot form alongside the untouched legacy `README_ONLY` form, with no live
`.claude/settings.json`/manifest/toolbox-pin edit and no deletion/reset/rewrite of the existing G2
receipts.

## Source Worker branch and HEAD before this repair

- branch: `claude/worker1-h1-20260815`
- HEAD before this commit: `5462e70a8bd0cc09de17b7fd88ee42a3d2c49fde` (matches the ruling's stated
  "Worker source HEAD" exactly — verified with `git rev-parse HEAD` before touching any file)

## What changed

- `scripts/control-plane-bootstrap/authorization.mjs` — the `require_receipts` precondition now
  branches on the marker value: `'README_ONLY'` keeps its exact prior behavior and refusal code
  (`receipts_not_readme_only`); anything else must match `GIT_TREE:<40-hex>` or refuses
  `bad_require_receipts`. A `GIT_TREE:<sha>` marker validates only when the sha equals
  independently-measured `measured.receiptsGitTreeSha` (else `receipts_tree_mismatch`) **and**
  `measured.receiptsClean === true` (else `receipts_not_clean`). No new schema field; `require_receipts`
  is the only field whose accepted values widened.
- `scripts/control-plane-bootstrap/bootstrap.mjs` — `measureState()` now independently measures
  `receiptsGitTreeSha` (`git rev-parse HEAD:<receipt-dir>`) and `receiptsClean`
  (`git status --porcelain -- <receipt-dir>` empty). Neither the current tree sha nor any specific
  value is hard-coded in production source, per §3's instruction — both are measured every run.
- `scripts/control_plane_bootstrap.test.mjs` — 9 new tests: a CONTROL proving the GIT_TREE form
  validates on an exact match + clean tree; four refusal tests (wrong tree, dirty via a modified
  tracked receipt, dirty via an untracked file, malformed `require_receipts` values); one control
  proving the old README_ONLY fixture is untouched; three `measureState`-level tests proving the two
  new measured signals are derived correctly from two distinct real `git status --porcelain` shapes
  (`" M path"` vs `"?? path"`). The existing `C14` end-to-end zero-effects test gained one more
  refusal case (`GIT_TREE mismatch`) to prove the new branch also requests zero effects on refusal.

## RED proof

Stashed only the two production files (`authorization.mjs`, `bootstrap.mjs`), leaving the new tests
in place, and reran the suite:

```
node --test scripts/control_plane_bootstrap.test.mjs
ℹ tests 161
ℹ pass 153
ℹ fail 8
```

The 8 failures were exactly the 8 new tests that require the fix (`CONTROL: GIT_TREE marker
validates…`, `N9f`–`N9i`, and the three `measureState:` tests). `N9j` (the unchanged-README_ONLY
control) and all 152 pre-existing tests passed unchanged, proving the RED was caused by the missing
fix and nothing else. `git stash pop` restored the fix.

## GREEN proof

```
node --test scripts/control_plane_bootstrap.test.mjs
ℹ tests 161
ℹ pass 161
ℹ fail 0
```

`node --check` passed clean on all three changed files.

## The four required values (§5)

1. **New exact Worker HEAD after this repair/report commit:** recorded in
   `git log -1 --format=%H -- docs/replay-results/worker-advisor-reports/AR-1316A-WORKER1-BOOTSTRAP-RECEIPT-SNAPSHOT-COMPATIBILITY-CLOSEOUT-2026-08-18.md`
   on `claude/worker1-h1-20260815`, and stated in the worker chat message accompanying this push
   (a commit cannot embed its own hash without an amend, avoided per standing git protocol).
2. **New exact bootstrap bundle SHA-256** (production `computeBundle()`, reproduced live against the
   real `scripts/control-plane-bootstrap/bundle.mjs` and the real 10-file `BUNDLE_FILES` list, reading
   actual working-tree bytes post-fix):
   `195023fb0838b10f3d4529a112a92abe8875f7451761ccc639336e31c2ccfe82` (64 hex chars, confirmed by
   direct length check).
3. **Receipt tree still exactly `c11966868f8a511554e1f26bf6e5555c59833d04` and clean:**
   `git rev-parse HEAD:docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated-receipts-t1`
   → `c11966868f8a511554e1f26bf6e5555c59833d04` (exact match to the ruling's §3 value) and
   `git status --porcelain -- docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated-receipts-t1`
   → empty. Neither this repair nor anything else in this session touched that directory.
4. **Exact bootstrap test counts:** `161` total, `161` passed, `0` failed (see GREEN proof above).

## Reconfirmed, unchanged

- Target toolbox commit `bbf2e6c2e9ae39a7f0f2be182c9046165eb4b198` — not touched this session.
- Target toolbox bundle `ca0b3a708d90017018aa4ac9f4ee1aca205469fbabc418bbbf3f599959da7167` — not
  recomputed this session; no toolbox file was read or written.
- Worker F36 doorway (`scripts/g2d_postcall_lifecycle.py` + `src/engine/extraction/g2d_subagentstop_capture.py`)
  present and untouched.
- Live `.claude/settings.json`, `.claude/worker1-hook-guard-manifest.json`, and the live toolbox pin
  (`4c5f9d4adba5972a051aa845b98809bc2b6c7aa4` / `59d95f3c784f90ed08c20321bbb834ad0009a0167e64cb211168500932efdec0`)
  — unchanged; not opened for writing this session.
- Zero Agent/Task/model calls this session.
- Zero compiler/backtest/paper/broker/live-money work this session.
- Frozen queue (`isolated_fallback_queue_t1.json`) and `native_call_manifest_t1.json` — not touched.

## Confirmations

- `git status --porcelain` before this repair showed a clean tree except for the two files named in
  the SessionStart STOP (`scripts/g2d_commit_msg_tmp7.txt`, `scripts/g2d_commit_msg_tmp8.txt` —
  stranded scratch text from the already-landed AR-1314A/AR-1315A commits, removed from an unguarded
  seat before this repair started; see the accompanying chat message).
- Only `scripts/control-plane-bootstrap/authorization.mjs`, `scripts/control-plane-bootstrap/bootstrap.mjs`,
  `scripts/control_plane_bootstrap.test.mjs`, and this report file changed in this commit — all under
  `edit_scope.allowed_prefixes` (`scripts/`, `docs/replay-results/`) in
  `.claude/worker1-hook-guard-manifest.json`.

## Report commit SHA

This report's own commit SHA is recorded in the git log for this path on `claude/worker1-h1-20260815`,
and is stated in the worker chat message accompanying this push.
