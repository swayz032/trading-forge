# AR-1305 — Worker-1 report: AR-1304 F29/F30 repair built and tested, handoff for privileged propagation

**Ruling followed:** AR-1304A (`advisor-reports/AR-1304A-GPT-EXTERNAL-ADVISOR-RULING-NORMAL-CLAUDE-SEAT-BOUNDARY-AND-PRIVILEGED-PROPAGATION-HANDOFF-2026-08-17.md`, landed on `origin/external-advisor/gpt-rulings` at `909caa7e`, caught by the armed GPT-branch ear). AR-1304A confirmed the prior session's stop was correct, clarified that only the *live guard mutation* was reserved to a privileged actor, and directed: implement F29+F30 in the existing controlled repair worktree on non-live/scratch surfaces, run the required zero-model tests, then **STOP BEFORE ORDINARY-SEAT LIVE PROPAGATION** and hand off. This report is that handoff.

**PIN:** `claude/worker1-h1-20260815` at `3a8c45d2` (this branch's own tip after this repair's two Python-side commits). No drift from the graded `bba03d7c` tip beyond this repair's own work.

## What was built

### F29 — hook-owned exact permit materialization

**File:** `advisor-prepared/gpt-speed-engineering-lane/tooling/g2-precall-guard.mjs`, on branch `guardfix/ar1304-g2-handshake-repair`, commit `f8bb3a37` (based on the currently-pinned toolbox commit `b6c70282`; `git merge-base --is-ancestor b6c70282 d35634e2` exits 0 — descendant confirmed).

Added `permitPathFor(receiptDir, conditionRef)` (the one place a permit path is ever computed) and `materializePermitIfNeeded(...)`, wired into `evaluateG2PreCall()` immediately before the existing permit read. When the `G2D-PERMIT:` marker names a path that does not exist yet, the guard may now create that exact file — create-only, never overwriting — but only when every one of these holds, using nothing but frozen/remeasured values:

- the frozen native-call manifest is loaded and frozen against the live queue SHA;
- the actual call's canonical `{model, subagent_type, prompt}` hash matches **exactly one** row in that manifest (this is also how `condition_ref` is resolved — never trusted from the caller);
- the actual `model` field is exactly `'opus'`;
- `subagent_type` matches the frozen row (structurally already enforced by the hash match itself);
- the marker's path is **byte-identical** to `permitPathFor(receiptDir, condition_ref)` — any other path is refused, never redirected;
- the condition is not already spent (queue-attempts witness or any receipt-file witness).

Once materialized (or found already present, and validated but never touched), control falls through unchanged into the pre-existing steps 1–9 (queue SHA / condition membership / task hash / model / condition-in-prompt / one-shot / outstanding-capture / actual-model / native-call-identity) and the pre-existing step 10 (the `claim -> dispatch` transition via `g2d_precall_transition.py`) — materialization is a doorway into that path, not a shortcut around it.

**Diff shape:** +140 lines, 0 removed, in `g2-precall-guard.mjs`; test file grew from 415 to 649 lines (23 pre-existing + 11 new = 34 tests). One pre-existing test's expected error string was updated with an inline comment explaining why (materialization now answers a no-manifest, no-file scenario earlier and more specifically than the old straight-to-read-error path; the call is still denied before the model runs either way).

### F30 — trusted post-Agent return capture

**Python doorway:** `scripts/g2d_postcall_capture.py` on `claude/worker1-h1-20260815`, commit `e26a4004`. Loads the ledger and calls the existing `capture_native_return()` in `isolated_bridge.py` — adds no receipt law of its own. Raw text and completion metadata arrive via files, never argv (a real return can be large and contain shell-hostile bytes).

**JS gate:** `advisor-prepared/gpt-speed-engineering-lane/tooling/g2-postcall-capture.mjs` on `guardfix/ar1304-g2-handshake-repair`, commit `d35634e2`. Exports `evaluatePostCallCapture()`: re-identifies the call by the same exact canonical-hash match F29 uses (never a caller-supplied `condition_ref`), requires exactly one row at `NATIVE_TASK_DISPATCHED` (dispatch file present, raw/completion absent), then shells out to the Python doorway. A non-G2 or unresolved call returns `handled:false` and is left untouched.

🛑 **HONEST GAP, not silently assumed:** the exact PostToolUse payload shape the live Claude Code runtime emits for the `Agent` tool's response was **not observed live** — proving it would require a real dispatch, which this repair is forbidden from making. `extractRawResponseText()` accepts the shapes the public hook docs describe (plain string, or an object exposing `text`/`content`/`result`/`output`) and falls back to a verbatim JSON serialization for anything else, so nothing is silently dropped — but **whoever performs the live propagation must confirm this against a real captured PostToolUse payload before wiring it into `.claude/settings.json`.** This is the one part of F30 this report cannot certify as correct against the real runtime, only against the documented and synthetic shapes.

## Test evidence

All commands run from each file's own worktree; all fixtures are temp directories or (for two named exceptions below) a real support law explicitly invoked to avoid a hand-typed fixture drifting from the real schema.

```
# F29, guardfix/ar1304-g2-handshake-repair (wt-ar1304-g2-handshake-repair)
node --test advisor-prepared/gpt-speed-engineering-lane/tooling/g2-precall-guard.test.mjs
  -> tests 34, pass 34, fail 0   (23 pre-existing + 11 new)

# F30 JS, same worktree
node --test advisor-prepared/gpt-speed-engineering-lane/tooling/g2-postcall-capture.test.mjs
  -> tests 15, pass 15, fail 0   (14 synthetic + 1 real end-to-end INTEGRATION test, which
     shells out to BOTH the real g2d_precall_transition.py claim/dispatch AND the real
     g2d_postcall_capture.py capture, against a queue built by the real
     isolated_fallback_law.freeze_isolated_queue -- not a hand-typed JSON object, which the
     real DurableAttemptLedger.load() correctly rejected on first attempt for missing
     substitution_rule/substitution_rule_sha256)

# FULL toolbox regression, same worktree
node --test advisor-prepared/gpt-speed-engineering-lane/tooling/*.test.mjs
  -> tests 225, pass 225, fail 0   (every pinned .test.mjs in the tooling directory)

# F30 Python, wt-claude-worker1-20260815
python -m pytest src/engine/tests/test_isolated_bridge.py \
  src/engine/tests/test_g2d_precall_transition.py \
  src/engine/tests/test_g2d_postcall_capture.py -q
  -> 54 passed   (41 pre-existing + 13 new)
```

**Zero regressions across all four runs.**

### Negative controls (both files cover every AR-1303A section 8 shape)

F29: wrong condition ref / wrong task hash / wrong queue SHA / Sonnet+Haiku / already-spent (queue witness) / already-spent (receipt-file witness) / no manifest loaded / wrong or arbitrary permit path / wrong subagent_type (via the hash-match mechanism itself) / a pre-existing permit is read-and-validated, never overwritten (mtime-unchanged assertion).

F30: no prior dispatch / claimed-but-not-dispatched / second capture for an already-captured row (first capture's hash provably unchanged) / response for a different condition (isolation proven — the sibling row's receipts are untouched) / malformed completion metadata (directory left exactly as found) / STRANDED_INCOMPLETE never treated as capturable / unreadable raw-output file.

### Mutation controls (red-then-green against the REAL implementation, not a stand-in)

- **F29:** `git stash` on `g2-precall-guard.mjs` alone → whole suite fails to import (0 pass); `git stash pop` → 34/34 green. A second, in-file control reproduces the attacker-chosen-permit-path bypass with an unchecked stand-in function (proves the scenario is reachable), then shows the real `materializePermitIfNeeded` refuses the identical scenario.
- **F30 JS:** moved `g2-postcall-capture.mjs` aside → whole suite fails to import (0 pass, 1 fail); restored → 15/15 green. An in-file control reproduces an unchecked "capture without a dispatch check" stand-in (proves it would wrongly capture), then shows the real `evaluatePostCallCapture` refuses it.
- **F30 Python:** moved `g2d_postcall_capture.py` aside → all 13 controls fail immediately (subprocess `FileNotFoundError`); restored → 13/13 green. An in-file control writes a raw receipt directly for a never-dispatched row with an unchecked stand-in (proves it would wrongly succeed), then shows the real script (via `capture_native_return`'s own state check) refuses the identical scenario.

## Confirmation: no model call occurred

Zero Agent/Task dispatches were made at any point in this repair. Every test either calls the guard functions directly with fabricated tool-input objects, or shells out to the two Python doorways / the toolbox test suite as ordinary subprocesses — none of which invoke a Claude Code subagent.

## Confirmation: the real frozen state is untouched

`[MEASURED HERE, this session, after both commits]`:

```
$ ls docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated-receipts-t1/
README.md

$ grep -o '"attempts":[^}]*}' docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated_fallback_queue_t1.json
"attempts": {}
```

README-only, `attempts: {}` — byte-identical to the state AR-1303 and AR-1303A both measured. No `.permit`/`.attempt`/`.dispatch`/`.raw`/`.completion` file was ever created in this real directory; every test that exercises the receipt namespace does so inside `fs.mkdtempSync`/`tmp_path` fixtures. The native-call manifest, prompt transport, and frozen queue SHA (`5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939`) were never read for a write path, only cited by fixture-builders as the shape to imitate.

## Exact live surfaces that require privileged propagation

Only three, all in `wt-claude-worker1-20260815` (or wherever the live Worker-1 seat actually runs):

1. **`scripts/claude_toolbox.mjs`** — `TOOLBOX_PIN` constant, currently `b6c702821bc48281b02e16773c7c277ae17fb03f`, needs to move to `d35634e29187b74857c01c9249923db411862e61` (the tip of `guardfix/ar1304-g2-handshake-repair`, which carries both F29 and F30-JS; `b6c70282` is its ancestor — verified above).
2. **`.claude/worker1-hook-guard-manifest.json`** — `_toolbox_pin` (same new SHA) and `_toolbox_bundle_sha256` (recomputed by `node scripts/claude_toolbox.mjs materialize` **after** the re-pin — never hand-typed, per this repo's own `[compute-closure]`/"expected values are COMPUTED" law). `_toolbox_pin_history` should also gain one line naming this re-pin, matching the existing convention.
3. **`.claude/settings.json`** — register the new PostToolUse route for `Agent` (and `Task`, defense-in-depth, per this repo's own existing `Agent|Task` dual-registration convention) pointing at `g2-postcall-capture.mjs`'s gate, through the same `claude_guard_hook.mjs` doorway pattern PreToolUse already uses. **Before wiring this live, confirm the real PostToolUse payload shape against a captured/real event** — the honest gap named above.

Nothing else needs to change. The real frozen queue, receipt directory, and native-call manifest are not among these surfaces and must stay untouched by the propagation step too.

## Minimum privileged propagation sequence

1. Re-pin `TOOLBOX_PIN` in `scripts/claude_toolbox.mjs` to `d35634e29187b74857c01c9249923db411862e61`.
2. Run `node scripts/claude_toolbox.mjs materialize` to get the new `bundle_sha256`.
3. Update `.claude/worker1-hook-guard-manifest.json`'s `_toolbox_pin` and `_toolbox_bundle_sha256` to match, and append one `_toolbox_pin_history` line.
4. Register the new PostToolUse hook in `.claude/settings.json` — after confirming the real payload shape.
5. Verify `git merge-base --is-ancestor b6c70282 d35634e2` (already done here, exits 0) so the re-pin is a genuine descendant, not a lateral swap.
6. Hand off to a **genuinely fresh ordinary Worker-1 seat** for the AR-1303A post-propagation read-only proof (§10 of that ruling) before GPT reauthorizes the frozen eight Opus calls.

## STOP

This session performed only the bounded, non-live repair AR-1304A authorized. It did not touch `.claude/settings.json`, the worker guard manifest, or the live toolbox pin. Per AR-1303A §4/§7 and AR-1304A's own directive, the propagation sequence above is handed to the already-established privileged guard-repair/control-plane path — this seat does not invent a second privilege system or self-elevate to perform it.
