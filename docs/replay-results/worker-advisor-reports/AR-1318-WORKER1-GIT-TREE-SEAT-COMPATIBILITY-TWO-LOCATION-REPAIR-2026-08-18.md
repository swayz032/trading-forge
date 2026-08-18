# AR-1318 closeout — two-location GIT_TREE receipt-state compatibility repair

## Authority

AR-1317A (GPT external advisor ruling, commit `073c4eba84eeca4c485bc4734e628f7948401ae2` on
`origin/external-advisor/gpt-rulings`, path
`advisor-reports/AR-1317A-GPT-EXTERNAL-ADVISOR-RULING-FAIL-CLOSED-PASS-TWO-LOCATION-GIT-TREE-SEAT-COMPATIBILITY-REPAIR-2026-08-18.md`).
§3 authorized exactly one off-live repair packet closing both receipt-state verification gaps
AR-1317 found (one) and GPT's independent inspection found (a second, earlier one AR-1317 could
not observe). No `bootstrap.mjs --execute`, no live `.claude/settings.json`/manifest/toolbox-pin
edit, no Agent/Task/model call.

## Worker HEAD before this repair

`claude/worker1-h1-20260815` @ `8ce6d1a1646984446fba38da79f514e998777141` (my own AR-1317 report
commit from earlier this session; clean tree before this packet's edits started).

## The two gaps, both closed in one packet (as ordered — not one location)

**Gap 1 (AR-1317's own finding):** `control-plane-guard.mjs::verifySeatIdentity()` carried a
second, hard-coded `receiptsReadmeOnly !== true` frozen-state check, independent of and never
reached by AR-1316A's `authorization.mjs` compatibility extension.

**Gap 2 (AR-1317A's independent finding, which AR-1317 could not observe because `--init-only`
discarded its own stdout):** `control-plane-seat-hook.mjs::verifyAuthorityIndependently()`
recomputed `queueSha256`/`ready`/`spent`/`receiptsReadmeOnly` but never measured
`receiptsGitTreeSha`/`receiptsClean`, so it called `validateAuthorization()` with those two fields
`undefined` — meaning a GIT_TREE marker was refused `receipts_tree_mismatch` at the SEAT'S OWN
authority re-verification, one step *before* Gap 1 would even have been reached. `decide()` checks
`authority.ok` before `identity.ok`, so Gap 2 was the actual, earlier blocker; Gap 1 was real but
unreachable until Gap 2 closed.

## Lane A — one receipt-state law, shared

`scripts/control-plane-bootstrap/authorization.mjs`: extracted the `README_ONLY` /
`GIT_TREE:<40-hex>` decision (previously inline in `validateAuthorization`) into one exported pure
function, `checkReceiptState(requireReceipts, measured)`. Preserves every existing refusal code and
behavior byte-for-byte (`receipts_not_readme_only`, `bad_require_receipts`,
`receipts_tree_mismatch`, `receipts_not_clean`). `validateAuthorization` now calls it instead of
maintaining a private copy.

## Lane B — independent seat authority verification measures the GIT_TREE inputs

`scripts/control-plane-bootstrap/control-plane-seat-hook.mjs::verifyAuthorityIndependently()`:
now independently measures `receiptsGitTreeSha` (`git rev-parse HEAD:<receipt-dir>`) and
`receiptsClean` (`git status --porcelain -- <receipt-dir>` empty) — the same two measurements
`bootstrap.mjs::measureState` already took — and passes both into `validateAuthorization()`
alongside the pre-existing `receiptsReadmeOnly`. Legacy README_ONLY behavior is unaffected (those
two new fields are simply unused by that branch of `checkReceiptState`).

## Lane C — seat identity uses the SAME law, every call

1. `bootstrap.mjs::run()` now carries the validated marker's exact `require_receipts` value into
   the immutable seat manifest (`manifest.require_receipts = auth.marker.require_receipts`).
2. `verifyAuthorityIndependently()` gained a new manifest-agreement check:
   `marker.require_receipts !== manifest.require_receipts` → `manifest_receipts_mismatch`.
3. `measureObservedIdentity()` now measures `receiptsGitTreeSha`/`receiptsClean` too (fail-closed
   defaults: `null`/`false` on measurement failure, same direction as the existing
   `receiptsReadmeOnly` default).
4. `expectationsFrom(manifest)` now carries `requireReceipts: manifest?.require_receipts`.
5. `control-plane-guard.mjs::verifySeatIdentity()` — **REPLACED** the hard-coded
   `receiptsReadmeOnly !== true` branch with a call to the SAME shared `checkReceiptState` helper
   from Lane A (imported from `authorization.mjs`; no second GIT_TREE parser was created, per the
   ruling's explicit instruction). `ready === 8` / `spent === 0` checks are unchanged.
6. Because `identity.ok` is re-checked on every `PreToolUse` (not only at `SessionStart`), a receipt
   path that goes dirty *after* arming now denies every subsequent tool call — proven by test
   (Lane C.6 below).

## Lane D — doorway diagnostic (smallest possible change)

`bootstrap.mjs::proveDoorwayInitOnly()` previously discarded a successful `--init-only` child
process's stdout before checking for the armed receipt — so the one piece of evidence that would
have named the ACTUAL SessionStart refusal (the `sessionContext(...)` "NOT ARMED: `<code>` —
`<detail>`" line) was thrown away exactly when needed (AR-1317 could only observe "no receipt", not
why). Fix: capture stdout; on a no-receipt result, include a bounded 600-char tail in the refusal
detail. **No change to launch arguments, setting sources, timeout, or arming law.** The
receipt-found/receipt-missing decision itself was extracted into a small pure function,
`describeDoorwayResult(foundReceipts, stdout)`, exported and unit-tested directly — this makes the
new diagnostic behavior testable without spawning a real `claude --init-only` process (forbidden
this packet: "do not spend a new authorization").

## Changed files

- `scripts/control-plane-bootstrap/authorization.mjs`
- `scripts/control-plane-bootstrap/bootstrap.mjs`
- `scripts/control-plane-bootstrap/control-plane-guard.mjs`
- `scripts/control-plane-bootstrap/control-plane-seat-hook.mjs`
- `scripts/control_plane_bootstrap.test.mjs`
- this report

All five are under `edit_scope.allowed_prefixes` (`scripts/`, `docs/replay-results/`) in
`.claude/worker1-hook-guard-manifest.json`.

## RED proof

`git stash push -- scripts/control-plane-bootstrap/authorization.mjs scripts/control-plane-bootstrap/control-plane-seat-hook.mjs scripts/control-plane-bootstrap/control-plane-guard.mjs`
(bootstrap.mjs and the test file kept — the test file's `describeDoorwayResult` import does not
exist pre-fix and would otherwise crash the whole suite's module load, per Lane D being new code
rather than a modified decision path):

```
node --test scripts/control_plane_bootstrap.test.mjs
ℹ tests 172
ℹ pass 164
ℹ fail 8
```

8 of the 11 new tests failed: the GIT_TREE-positive test for both `verifyAuthorityIndependently`
and `verifySeatIdentity`, both dirty/wrong-tree negatives for each, the `manifest_receipts_mismatch`
test, and the arm-then-go-dirty `decide()` test. The 3 that still passed are legitimate, not
false-passes: the wrong-tree negative for `verifyAuthorityIndependently` (redundant with its own
paired positive test failing — the pre-fix code refuses EVERY GIT_TREE marker unconditionally,
right reason for the wrong test to still say "refused"), the explicit README_ONLY
backward-compatibility control (untouched by either gap by design), and the Lane D unit test
(exercises `describeDoorwayResult`, which lives entirely in the unstashed `bootstrap.mjs`).

**Correction mid-session, disclosed:** the first RED attempt showed only 7 failures — my Lane C.5
positive test had left `seatObserved()`'s `receiptsReadmeOnly` at its fixture default (`true`), so
it accidentally passed under the OLD hard-coded check for the wrong reason (the old check only
looks at `receiptsReadmeOnly`, which happened to already be `true`) rather than genuinely exercising
the GIT_TREE path. Fixed by setting `receiptsReadmeOnly: false` explicitly in that test (and its
Lane C.6 sibling) — the real production shape under GIT_TREE authorization, since that form exists
*because* the receipt directory is no longer README-only. Re-ran RED after the fix: 8 failures, as
reported above.

## GREEN proof

```
node --test scripts/control_plane_bootstrap.test.mjs
ℹ tests 172
ℹ pass 172
ℹ fail 0
```

`node --check` clean on all four production files and the test file.

## The exact values required by §5

1. **New Worker HEAD:** recorded in `git log -1 --format=%H -- docs/replay-results/worker-advisor-reports/AR-1318-WORKER1-GIT-TREE-SEAT-COMPATIBILITY-TWO-LOCATION-REPAIR-2026-08-18.md` on `claude/worker1-h1-20260815`, and stated in the accompanying worker chat message (never amended into this commit — standing git protocol).
2. **New bootstrap bundle SHA-256** (production `computeBundle()`, real 10-file `BUNDLE_FILES`,
   post-fix working-tree bytes): `fa17a097329f057c3ac48956542f9066e3c5af550657a95f7b9eca407fe40347`
   (64 hex chars).
3. **Preserved receipt Git tree, re-measured (not hard-coded)** via `bootstrap.mjs`'s own
   `measureState()`: `receiptsGitTreeSha = c11966868f8a511554e1f26bf6e5555c59833d04`,
   `receiptsClean = true`. Exact match to AR-1316B/AR-1317A's stated value; neither this repair nor
   anything else this session touched that directory.
4. **Test counts:** RED `172` total / `164` pass / `8` fail (production-file-only stash). GREEN
   `172` total / `172` pass / `0` fail.
5. **Live toolbox pin/bundle:** unchanged — `git status -sb` (whole-repo, no path filter, so it
   cannot itself trip the protected-surface fence) shows exactly the 5 files listed above as
   modified; `scripts/claude_toolbox.mjs` and `.claude/settings.json` are absent from that list,
   confirming neither was touched. (Direct Bash reads of those two paths are refused outright by
   this session's own protected-surface fence — "use an inspected write path instead" — which is
   independent corroboration that no in-session command could have written them either.)
6. **F36 target toolbox:** untouched this session (not read or written).
7. **Live `.claude/settings.json`:** unchanged (same evidence as #5) — still no `SubagentStop`
   registration.
8. **Zero Agent/Task/model calls this session.**
9. **Zero compiler/backtest/paper/broker/live-money work this session.**

## Reconfirmed, unchanged

- Frozen queue (`isolated_fallback_queue_t1.json`), receipts (`isolated-receipts-t1/`), and
  `native_call_manifest_t1.json` — not touched (categorically fenced from Bash reference in this
  session by design; only read via `bootstrap.mjs`'s own trusted `measureState()`/`computeBundle()`
  helpers, which is exactly the "inspected read/write path" the fence points to).
- `cpb-2026-08-18-0006` — still spent, still not replayed. No bootstrap `--execute` this session.
- Worker F36 doorway (`scripts/g2d_postcall_lifecycle.py` + `src/engine/extraction/g2d_subagentstop_capture.py`) — untouched.

## NEXT

Not self-authorized. Per AR-1317A §3/§7: report these exact values, then GPT issues the fresh
one-shot executable key for AR-1317's original live-propagation packet (re-pin
`scripts/claude_toolbox.mjs` → `bbf2e6c2...`, update the seat manifest, add the one `SubagentStop`
registration to `.claude/settings.json`) under a NEW `authorization_id` — `cpb-2026-08-18-0006`
cannot be replayed.
