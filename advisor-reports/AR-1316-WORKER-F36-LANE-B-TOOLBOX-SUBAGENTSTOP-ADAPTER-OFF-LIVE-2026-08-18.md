# WORKER REPORT — AR-1316

**Date:** 2026-08-18
**Repository:** `swayz032/trading-forge`
**Responds to:** AR-1315A §5 Lane B ("pinned toolbox live lifecycle adapter, off-live only")
**Worker branch (Lane A/C, already landed by a prior seat):** `claude/worker1-h1-20260815` @ `5462e70a` (repair commit `56244f44`)
**Toolbox branch (this packet, Lane B):** `guardfix/ar1304-g2-handshake-repair` @ `bbf2e6c2` (base pin `4c5f9d4adba5972a051aa845b98809bc2b6c7aa4`)

## 1. What this packet is

AR-1315A authorized exactly one packet before the next GPT ruling: Lane A (Worker-side thin
doorway) + Lane C (settings.json designed, not applied) were already landed by a prior seat
(commit `56244f44`, `AR-1315A Lane A + Lane C -- F36 worker-side lifecycle doorway + draft
SubagentStop hook`). This report covers **Lane B only**: the pinned-toolbox-side lifecycle
adapter, and **Lane D** (proof/measurement), both off-live.

Pre-flight (`advisor-ruling` skill) found one contradiction before any code was written: the
worktree I first picked (`wt-p1-toolbox-20260816` @ `b6c70282`) was **two re-pins behind** the
live pin. `[MEASURED HERE]`: the live manifest's `_toolbox_pin` (`4c5f9d4a...`) and
`_toolbox_bundle_sha256` (`59d95f3c...`) in
`wt-claude-worker1-20260815/.claude/worker1-hook-guard-manifest.json` matched AR-1315A's cited
pin exactly, and `git merge-base --is-ancestor 4c5f9d4a bbf2e6c2` confirms `wt-ar1304-g2-
handshake-repair` (branch `guardfix/ar1304-g2-handshake-repair`) sits exactly at that pin with
nothing built on top yet — the correct source line. No branch anywhere already carried Lane B
(`for b in $(git branch -a); do merge-base --is-ancestor 4c5f9d4a $b ...`: zero strict
descendants before this packet).

## 2. What changed (toolbox line, commit `bbf2e6c2`)

8 files, +661/-50 (`advisor-prepared/gpt-speed-engineering-lane/`):

- `tooling/g2-postcall-capture.mjs` — `evaluatePostCallCapture()` for a resolved strict-G2
  `PostToolUse(Agent|Task)` row now **always** routes to the new `defaultCaptureLaunchAck()` /
  `scripts/g2d_postcall_lifecycle.py launch-ack` (AR-1315A Lane A), never to
  `capture_native_return` — closing the exact F36 defect (a synchronous launch ack persisted as
  the final answer). The row stays `NATIVE_TASK_DISPATCHED`. `defaultCapture`/
  `extractRawResponseText` are kept, unchanged, still tested: `scripts/g2d_postcall_capture.py`
  is still called by `scripts/g2d_bridge_report.py`, unrelated to this gate.
- `tooling/g2-subagentstop-capture.mjs` (new) — the terminal half. Shells out to
  `g2d_postcall_lifecycle.py subagent-stop`. **Never emits `decision:"block"`**: for
  `Stop`/`SubagentStop` hooks that means "force the agent to keep running," the opposite of a
  refusal, and forcing an already-finished subagent to continue on a capture failure would be
  actively wrong. Every outcome (final capture, non-terminal, refused, not-configured) is
  audit-only.
- `tooling/claude-hook-bridge.mjs` — new `SubagentStop` branch: requires an armed session
  (`armedSession`, same law as PostToolUse/TaskCompleted), loads the same G2 queue/receipt
  namespace when `g2_precall.enabled`, delegates to `evaluateSubagentStop`, folds every outcome
  into `_audit` only. A top-level exception for this event already fell through to the
  stderr-only branch in both `claude-hook-bridge.mjs`'s own `main()` and the real entry point
  `claude-hook-runner.mjs` — verified by reading both, no code change needed there; added a
  one-line comment explaining why.
- `claude-hooks/settings.fragment.json` — **prepared fixture only, not live**: one `SubagentStop`
  registration, matcher `general-purpose` (the frozen G2 native-call manifest's subagent type),
  routed through the existing `claude-hook-runner.mjs` doorway. The four existing registrations
  (SessionStart/PreToolUse/PostToolUse/TaskCompleted) are unchanged — proven by a parity test, not
  by inspection.
- Test files updated/added: `g2-postcall-capture.test.mjs` (rewritten for launch-ack semantics +
  2 new INTEGRATION tests against the real doorway), `g2-subagentstop-capture.test.mjs` (new: 9
  tests including 2 INTEGRATION tests against the real doorway), `claude-hook-bridge.test.mjs` (3
  new SubagentStop tests), `claude-hook-g2-lifecycle.test.mjs` (full real-process rewrite: ack →
  interlock still blocks → real `SubagentStop` finalizes → interlock releases → duplicate ack and
  duplicate `SubagentStop` both refused without disturbing the first capture).

## 3. Proof (Lane D witnesses)

All ten required witnesses, `[MEASURED HERE]`:

1. real async ACK → launch receipt only → row stays `NATIVE_TASK_DISPATCHED` — `claude-hook-g2-
   lifecycle.test.mjs` step 5, real process, real Python law.
2. ACK cannot produce `.raw`/`.completion` — same test, asserted directly.
3. matching real `SubagentStop` → final text captured → row `RAW_RETURN_CAPTURED` — same test,
   step 6, `raw_output_sha256` cross-checked against `sha256(last_assistant_message)` (Python's
   own hashing, read from `isolated_bridge.py:254`, not guessed).
4. wrong agent → no blocking receipt → correct later event still closes the row —
   `g2-subagentstop-capture.test.mjs` INTEGRATION test, and `claude-hook-g2-lifecycle.test.mjs`
   step 6b.
5. missing launch identity → refuse — `g2-postcall-capture.test.mjs` / Python's own
   `record_async_launch_ack` (unchanged, Lane A).
6. duplicate terminal → refuse without overwrite — `claude-hook-g2-lifecycle.test.mjs` step 9.
7. row N+1 blocked between launch ACK and terminal event — step 5b.
8. row N+1 allowed after terminal capture — step 7.
9. settings fixture proves exactly one `SubagentStop` registration and no loss/duplication of the
   existing four — `g2-subagentstop-capture.test.mjs` REGISTRATION PARITY test (+ a MUTATION
   control).
10. full affected toolbox + Python regression suites green — see below.

### Bundle / pin measurement

```
positive control (current live pin, UNCHANGED):
  node scripts/claude_toolbox.mjs materialize   (run in wt-claude-worker1-20260815)
  pin:            4c5f9d4adba5972a051aa845b98809bc2b6c7aa4
  file_count:     47
  bundle_sha256:  59d95f3c784f90ed08c20321bbb834ad0009a0167e64cb211168500932efdec0
  == manifest _toolbox_pin / _toolbox_bundle_sha256 exactly.

descendant check:
  git merge-base --is-ancestor 4c5f9d4adba5972a051aa845b98809bc2b6c7aa4 bbf2e6c2
  -> 0 (true)

target bundle (commit bbf2e6c2), TWO INDEPENDENT INSTRUMENTS, byte-identical:
  Node (crypto, ls-tree+show, same algorithm as claude_toolbox.mjs::materialize)
  Python (hashlib, independent re-implementation, separate process)
  file_count:     49   (47 + 2: g2-subagentstop-capture.mjs, g2-subagentstop-capture.test.mjs;
                         claude_toolbox.mjs's filter is `.endsWith('.mjs')`, which the test file
                         also matches)
  bundle_sha256:  ca0b3a708d90017018aa4ac9f4ee1aca205469fbabc418bbbf3f599959da7167
```

**These are values to apply, not an instruction to apply them** — re-verify before any re-pin.
Nothing in this packet edits `.claude/worker1-hook-guard-manifest.json`, `scripts/
claude_toolbox.mjs`'s `TOOLBOX_PIN` constant, or any live `.claude/settings.json`; all three
remain exactly as AR-1315A left them.

### Test counts

- Full toolbox regression, `node --test *.test.mjs` in
  `advisor-prepared/gpt-speed-engineering-lane/tooling/`: **261/261 pass, 0 fail, 0 skipped**
  (skip guards for the sibling worktree were satisfied — it is present).
- New/changed files specifically: `g2-postcall-capture.test.mjs` 28/28,
  `g2-subagentstop-capture.test.mjs` 9/9 (new file), `claude-hook-bridge.test.mjs` 15/15 (3 new),
  `claude-hook-g2-lifecycle.test.mjs` 2/2 (both real-process, real-Python).
- Zero Agent/Task/model calls anywhere in this packet or its tests — verified by reading every
  test file added/changed; every "model call" is a synthetic `PostToolUse`/`SubagentStop` payload
  this packet authored.
- Queue/receipts: every test in this packet uses a fresh scratch directory
  (`fs.mkdtempSync(os.tmpdir())` or a cleaned-up in-worktree scratch dir, pre-existing pattern,
  removed in a `finally`). `[MEASURED HERE]`: `git status --short` in
  `wt-claude-worker1-20260815` after every run above shows no scratch directory left behind, and
  the real frozen `docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated-
  receipts-t1/` was never referenced by any test path in this packet.
- Noted, not mine: two untracked files, `scripts/g2d_commit_msg_tmp7.txt` /
  `g2d_commit_msg_tmp8.txt`, exist in `wt-claude-worker1-20260815` — timestamps `2026-08-18
  01:11`/`01:34`, i.e. from a prior seat's own work before this packet started, not touched or
  created by this packet.

## 4. Compliance with AR-1315A §7 hard limits

Zero Agent/Task/model calls · no new G2 attempt · no live `.claude/settings.json` edit · no live
manifest/pin edit · no live toolbox re-pin · no retry/fallback/batch/reorder · no grader/gate
weakening · no source-fidelity wording hand-patch · no compiler/backtest/paper/broker/live-money
work · no broad guard refactor (`g2-postcall-capture.mjs`'s existing gate logic — dispatch check,
duplicate check, strict-session semantics, frozen-row resolution — is untouched; only the final
capture call changed).

## 5. Not done, and why

- The re-pin to `bbf2e6c2` / `ca0b3a70...` — reserved to GPT/operator per AR-1315A §6, exactly as
  the prior lifecycle re-pin (`b6c70282`) was.
- Witnessing this inside a live guarded Claude seat with hooks actually bound — needs the
  executable propagation key AR-1315A describes.
- Source-truth grade defects (Lane B of AR-1314A, the `4/12` deterministic G2 regrade) — parked
  per AR-1315A §3, untouched here.

## 6. Recommendation

Bundle and descendant proof are exact-green. Requesting the executable privileged control-plane
authorization AR-1315A §6 describes: propagate `bbf2e6c2` / `ca0b3a70...`, add the one
`SubagentStop` project hook, preserve frozen G2 state, run the bounded live F36 proof, then return
to the parked source-truth grade defect.
