# AR-1307 — Worker-1 report: AR-1306 (F32-F35) built and tested, handoff for privileged propagation

**Ruling followed:** AR-1305A (landed on `origin/external-advisor/gpt-rulings` at `4a02a97c`, relayed by the coordinator with full text). AR-1305A graded AR-1305 PARTIAL PASS — F29 accepted as-is, four blockers found (F32 the PostToolUse wire didn't exist, F33/F34 the interlock had two gaps, F35 fail-closed semantics didn't match strict session) — and authorized AR-1306 in the identical bounded scope as AR-1304: same worktrees/branches, same actor class, Sonnet 5 HIGH, zero model calls, scratch/temp fixtures only, no live propagation.

**PIN:** `claude/worker1-h1-20260815` at `546822f1` (this branch's own tip after this repair's two commits).

## What was built

### F32 — the PostToolUse wire, through the real runner/bridge process boundary

`claude-hook-bridge.mjs` (`guardfix/ar1304-g2-handshake-repair` @ `4c5f9d4a`) now imports `evaluatePostCallCapture` and adds a real `event === 'PostToolUse'` branch: verifies the armed session through the same doorway PreToolUse uses, loads the same frozen G2 context + native-call manifest, and routes `Agent`/`Task` returns through `evaluatePostCallCapture()`. A `block: true` verdict emits `{decision: 'block', reason}` — confirmed correct against the shipped Claude Code binary's own embedded hook documentation (found via a zero-model `strings`-style search, detailed below), which documents `decision: "block"` as the PostToolUse output shape, distinct from PreToolUse's `hookSpecificOutput.permissionDecision`.

`settings.fragment.json` (the non-live scratch fragment this branch has always owned — never `.claude/settings.json`) now registers `PostToolUse` for `Agent|Task`. A registration-parity test mirrors the existing PreToolUse one exactly: deleting or narrowing the matcher makes it RED.

`claude-hook-g2-lifecycle.test.mjs` is new and is the actual "wire" proof AR-1305A demanded: a full 8-step lifecycle witness through the REAL `claude-hook-runner.mjs` process boundary (not `evaluateHookEvent()` called in-process). Sequence: fresh armed session → row 2 submitted first → DENY (frozen row order) → row 1 PreToolUse → real materialize→claim→dispatch→ALLOW → row 2 while row 1 uncaptured → DENY (global interlock) → row 1 PostToolUse with a synthetic runtime-shaped `tool_response` → real `.raw`+`.completion` via the real `g2d_postcall_capture.py` → row 2 PreToolUse → now ALLOW, its own permit→claim→dispatch → duplicate row 1 PostToolUse → BLOCK, first capture provably unchanged. Zero real Agent/Task/model calls anywhere in it.

🛑 **Design note on where this witness runs.** A throwaway `git init` fixture was tried first (matching `claude-hook-lifecycle.test.mjs`'s existing pattern) and its dependency chain turned out to reach far outside `src/engine/extraction/` into the wider `src/engine` package (36MB/696 files) via a lazy relative import inside `isolated_attempt_receipt.DurableAttemptLedger.load()`. Rather than hand-copy an ever-growing dependency graph, the witness runs `cwd` inside the **sibling worker worktree itself** (`wt-claude-worker1-20260815`), using: a scratch g2 queue/receipt/native-manifest directory created fresh under a `tmp-g2-lifecycle-witness-*` prefix and removed in a `finally`; the worktree's own real, live-read branch/head for the SessionStart anchor with `require_clean: false` (the shared tree may legitimately carry unrelated in-progress work at any moment, and this witness asserts nothing about that — the dirty-tree dimension is already covered by `claude-hook-lifecycle.test.mjs`'s own controls); and a per-run random `session_id` so the guard session marker it mints (`<repoRoot>/.git/tf-claude-guard-session-<id>.json`) can never collide with a real seat's marker, deleted in the same `finally`. `[MEASURED HERE]` ran twice; both times `git status --short` in the worker tree afterward showed zero leftover scratch directories or marker files.

### F33/F34 — global sequential interlock, closed together as one mechanism

`outstandingCapture()` only ever saw the `NATIVE_TASK_DISPATCHED`-without-capture crash shape. A row that claimed and then failed its dispatch transition (`.attempt` with no `.dispatch` — `CLAIMED`, per the Python state law) was invisible to it, so a stuck row A could not block row B.

New `scripts/g2d_bridge_report.py` (this branch @ `546822f1`) is a **read-only** doorway to the existing `isolated_bridge.bridge_report()`/`state_of()` law — zero new state logic, per AR-1305A's explicit instruction. New `globalInterlockDenyReason()` + `nextEligibleRef()` in `g2-precall-guard.mjs` (`guardfix/ar1304-g2-handshake-repair` @ `4c5f9d4a`) read that report once per evaluation and deny on any row at `CLAIMED`/`NATIVE_TASK_DISPATCHED`/`STRANDED_INCOMPLETE`, or on a frozen-queue-order violation. Wired into both the materialization path (before any permit is written — F33's exact requirement: "assert no row-B `.permit`/`.attempt`/`.dispatch` exists") and the existing-permit path, superseding the narrower `outstandingCapture()` call there (kept exported/tested for direct callers, per its own doc comment now explaining why).

### F35 — post-call fail-closed semantics now match the strict G2 session

`evaluatePostCallCapture()` gained `strictSession`. Outside strict G2, an unresolvable PostToolUse event (no manifest, queue mismatch, no frozen-row match) stays `handled: false` — ordinary unrelated Agent use, untouched. Inside strict G2, the identical event becomes `handled: true, block: true`. Once a call resolves to a frozen row (an exact canonical-hash match), every further anomaly (no prior dispatch, duplicate capture, capture failure) is `block: true` **unconditionally**, strict or not, because the match itself is the proof of G2-ness — this asymmetry is documented in-file and is a design decision this report flags explicitly in case GPT wants it drawn differently.

### Payload-shape gap — resolved without a model call

AR-1305A forbade spending a model call to observe the real `PostToolUse.tool_response` shape and asked for the narrowest zero-model source instead. `[MEASURED HERE]` a `Select-String -Path claude.exe -Pattern 'tool_response' -SimpleMatch` search of the shipped Claude Code binary (`C:\ProgramData\npm\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe`) surfaced the runtime's own embedded hook documentation verbatim:

```
### Hook Input (stdin JSON)
{
  "session_id": "abc123",
  "tool_name": "Write",
  "tool_input": { ... },
  "tool_response": { "success": true }  // PostToolUse only
}
```

This **confirms** `tool_response` as the field name (previously a documented guess in AR-1305). It does **not** establish the Agent tool's own sub-shape — the only example present is Write's. Per AR-1305A ("do not depend on a speculative text/content/result/output guess... preserve the actual returned answer"), `extractRawResponseText()` no longer cherry-picks a sub-field: a string passes through unchanged, anything else is captured as its exact canonical JSON serialization. This is provably lossless with respect to whatever the hook supplies, regardless of its internal shape, and resolves the gap without stopping and without a model call. The same search also confirmed `PostToolUseFailure` as a real, registerable event name in the runtime's internal event list — not wired in this packet (AR-1305A's scope was PostToolUse specifically), named here as a candidate for a future packet if GPT wants defense-in-depth on the failure path.

## Test evidence

```
# Full toolbox regression, guardfix/ar1304-g2-handshake-repair (wt-ar1304-g2-handshake-repair)
node --test advisor-prepared/gpt-speed-engineering-lane/tooling/*.test.mjs
  -> tests 247, pass 247, fail 0
     (g2-precall-guard.test.mjs: 43 [34 prior + 9 new F33/F34]
      g2-postcall-capture.test.mjs: 26 [15 prior + 11 new F35/parity]
      claude-hook-g2-lifecycle.test.mjs: 2 [new]
      ar1268-precall-boundary.test.mjs: 28 [pre-existing file, needed one
        live-fixture-reading stateReport fake + one updated assertion message,
        both documented inline in that file]
      every other pre-existing *.test.mjs: unchanged, still green)

# Full Python regression, wt-claude-worker1-20260815
python -m pytest src/engine/tests/test_isolated_bridge.py \
  src/engine/tests/test_g2d_precall_transition.py \
  src/engine/tests/test_g2d_postcall_capture.py \
  src/engine/tests/test_g2d_bridge_report.py -q
  -> 59 passed
```

**Zero regressions across both runs.**

### Mutation controls (red-then-green against the REAL implementation)

- **F33/F34:** `git stash` on `g2-precall-guard.mjs` alone → whole suite fails to import; restored → 43/43. In-file control: an unchecked stand-in reproduces materializing row B's permit while row A is `CLAIMED`; the real `materializePermitIfNeeded` (given the identical dirty report) refuses it.
- **F35:** `git stash` on `g2-postcall-capture.mjs` alone → whole suite fails to import; restored → 24/24 (this file's total, F30+F35 combined — see AR-1305 for F30's own count). In-file control: an unchecked stand-in treats an unresolvable event as `handled: false` even inside strict G2; the real gate refuses to stay silent.
- **F32:** `git stash` on `claude-hook-bridge.mjs` alone → the new lifecycle witness's "unarmed session" test fails (no PostToolUse branch to deny from — falls through to a silent `guarded: false`); restored → 2/2.
- **Registration parity:** narrowing the PostToolUse matcher to drop `Task` is asserted to be something the parity control would actually notice (a direct, non-stashed discrimination check, matching the existing PreToolUse parity test's own style).

### Full synthetic lifecycle witness output

The 8-step sequence in `claude-hook-g2-lifecycle.test.mjs` (test name: *"THE FULL G2-D HANDSHAKE, end to end, through the real runner/bridge process boundary"*) asserts, and passed, every one of AR-1305A's named steps: row-2-first DENY with zero row-2 receipts; row-1 real materialize→claim→dispatch→ALLOW with `.permit`/`.attempt`/`.dispatch` all present on disk; row-2-while-row-1-uncaptured DENY naming `NATIVE_TASK_DISPATCHED`; row-1 PostToolUse producing real `.raw`+`.completion` whose `raw_output_sha256` hashes the exact synthetic `tool_response` bytes this test supplied (not a reconstruction); row-2 now ALLOW with its own real receipts; duplicate row-1 PostToolUse BLOCKed with the first capture's raw file byte-identical before and after the duplicate attempt.

## Confirmation: no model call occurred

Zero Agent/Task dispatches anywhere in this packet. The lifecycle witness's "model calls" are synthetic PreToolUse ALLOW decisions (the runner denying or not) and a synthetic `tool_response` object this test authored and passed as PostToolUse input — never a live subagent dispatch.

## Confirmation: the real frozen state is untouched

`[MEASURED HERE, this session, after both commits]`:

```
$ ls docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated-receipts-t1/
README.md

$ grep -o '"attempts":[^}]*}' docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated_fallback_queue_t1.json
"attempts": {}
```

Byte-identical to AR-1303/AR-1303A/AR-1305's own measurements. `git status --short` in the worker tree shows no leftover scratch directories, marker files, or unintended dirt from this session beyond the two commits listed above.

## Exact live surfaces that require privileged propagation

Unchanged in kind from AR-1305, updated in value:

1. **`scripts/claude_toolbox.mjs`** — `TOOLBOX_PIN`, currently `b6c702821bc48281b02e16773c7c277ae17fb03f`, needs to move to `4c5f9d4a` (the new tip of `guardfix/ar1304-g2-handshake-repair`, carrying F29+F30-JS+F32+F33/34-JS+F35; `git merge-base --is-ancestor b6c70282 4c5f9d4a` — verify at propagation time).
2. **`.claude/worker1-hook-guard-manifest.json`** — `_toolbox_pin`/`_toolbox_bundle_sha256` to match (bundle SHA computed by `node scripts/claude_toolbox.mjs materialize` after the re-pin, never hand-typed), one new `_toolbox_pin_history` line.
3. **`.claude/settings.json`** — register the new PostToolUse route for `Agent|Task`, mirroring `settings.fragment.json`'s own registration exactly. The payload-shape gap is now resolved (confirmed field name, lossless-preservation extraction) — no further live-schema verification is blocking this wire.

Nothing else. Same minimum sequence as AR-1305 §propagation, values updated.

## STOP

This session performed only the bounded, non-live repair AR-1305A authorized. It did not touch `.claude/settings.json`, the worker guard manifest, or the live toolbox pin. The propagation sequence above is handed to the already-established privileged guard-repair/control-plane path.
