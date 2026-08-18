# F36 — Async-Launch-Ack vs True-Final-Completion Repair (Off-Live)

**Ruling followed:** AR-1313A, "F36 OFF-LIVE NEXT." **Zero new Agent/Task/model calls** — synthetic queues and synthetic events only, throughout. **No live guard propagation** — nothing under `.claude/`, no pinned toolbox file, and neither of the two live doorway scripts (`scripts/g2d_precall_transition.py`, `scripts/g2d_postcall_capture.py`) was touched.

## Files changed

Two new files only:

- `src/engine/extraction/g2d_subagentstop_capture.py` — the repair itself.
- `src/engine/tests/test_g2d_subagentstop_capture.py` — the required test suite.

`git status --porcelain` before commit shows exactly these two paths, nothing else.

## Exact lifecycle binding used for terminal completion

```
PreToolUse Agent -> permit/claim/dispatch (UNCHANGED, existing doorway)
  -> PostToolUse Agent observes the synchronous async-launch ACK
       -> record_async_launch_ack(ledger, ref, agent_id, raw_ack_payload)
          -- launch telemetry ONLY. Never creates .raw/.completion.
          -- row stays NATIVE_TASK_DISPATCHED.
  -> [subagent runs in the background]
  -> matching terminal subagent-completion event (candidate: SubagentStop)
       -> capture_subagent_stop_final(ledger, ref, agent_id, raw_output, completion)
          -- binds by agent_id to the launch ack already on file for this exact row
          -- THEN calls the existing, UNCHANGED capture_native_return() doorway
          -- row becomes RAW_RETURN_CAPTURED only here
  -> next row's claim first passes assert_sequential_interlock(ledger, next_ref)
       -- requires every earlier queue row to already be RAW_RETURN_CAPTURED
```

### Disclosed, unresolved: the exact SubagentStop JSON field names are UNVERIFIED

Per AR-1313A ("prove the event/schema from the implementation or authoritative local contract before wiring it; do not guess field names"), I searched for a local authoritative source for the `SubagentStop` hook's payload shape before writing anything:

- `scripts/claude_guard_hook.mjs` (this repo's own live hook doorway) — only reads `hook_event_name` from stdin; does not document or branch on `SubagentStop` today (it isn't registered in `.claude/settings.json` yet — that registration is exactly what a future privileged-propagation packet would add).
- The installed `@anthropic-ai/claude-code` npm package's `README.md` and `sdk-tools.d.ts` — document tool schemas (Read/Write/Bash/etc.), not the hook event contract. Neither mentions `SubagentStop`, `agent_id`, or `last_assistant_message`.

**No local authoritative schema was found.** I did not guess field names into the contract. Instead, `record_async_launch_ack()` / `capture_subagent_stop_final()` take `agent_id` and `raw_output`/`completion` as **opaque caller-supplied arguments** — the state-machine correctness this repair exists to prove (async≠final, identity-bound finalization, no duplicate overwrite, sequential interlock) is verified independent of the open field-name question. **Extracting the real `(agent_id, raw_output)` pair from the actual `SubagentStop` JSON payload is explicitly out of scope for this off-live packet** and is the one open item before any live wiring.

## Test commands and results

```
python -m pytest src/engine/tests/test_g2d_subagentstop_capture.py -v
```
→ **11 passed** (full list below), 0 failed.

```
python -m pytest src/engine/tests/ -q -k "isolated_bridge or isolated_attempt_receipt or g2d_finalizer or postcall_capture or precall_transition or isolated_fallback_law or subagentstop"
```
→ **166 passed, 3 skipped, 0 failed** — the full affected regression surface (every existing G2/isolated-fallback/finalizer test file plus the 11 new ones) is green. No existing test was modified.

## Required proof, mapped to the actual test names

| Required witness | Test |
|---|---|
| async-launch ACK negative (launched ≠ complete) | `test_async_launch_ack_does_not_finalize_the_row` |
| true matching SubagentStop positive | `test_matching_subagent_stop_captures_the_final_answer` |
| wrong/unknown identity → DENY | `test_subagent_stop_with_mismatched_agent_id_is_refused`, `test_subagent_stop_with_no_launch_ack_on_file_is_refused` |
| duplicate completion cannot overwrite first capture | `test_duplicate_subagent_stop_cannot_overwrite_first_capture` |
| next-row pre-call denied while prior row lacks terminal capture | `test_row_two_denied_while_row_one_is_only_launched` |
| next-row pre-call allowed after prior row's valid terminal capture | `test_row_two_allowed_once_row_one_has_a_valid_final_capture` |
| mutation/red control: old premature-capture behavior reproduced, repaired lifecycle does not repeat it | `test_mutation_control_old_bug_would_have_finalized_on_the_ack_new_path_does_not` |
| ancillary fail-closed edges | `test_launch_ack_refused_without_a_prior_dispatch`, `test_launch_ack_refused_with_no_agent_id`, `test_second_launch_ack_for_the_same_row_refused` |

### The mutation/red control, explained

The RED half of `test_mutation_control_...` reproduces F36 exactly as AR-1311B found it: it calls the existing, unchanged `capture_native_return()` **directly** on the raw async-ack JSON, immediately after dispatch — the literal shape of the original defect, because `capture_native_return()` has no opinion about *what text* it is given, only about receipt-state ordering, so this "succeeds" and wrongly reaches `RAW_RETURN_CAPTURED` with the ack (not an answer) stored as the row's final content. The GREEN half runs the same ack payload through the repaired path (`record_async_launch_ack()` only) and shows the row stays `NATIVE_TASK_DISPATCHED` — never finalized. This proves the fix's value is in *which entry point is used*, not in any change to the trusted doorway itself, which was intentionally left untouched.

### Honest limitation on prevention

`capture_native_return()` was deliberately left unchanged (reuse, not a second implementation, per this codebase's own standing rule). That means nothing at the Python level stops a *future* caller from bypassing `record_async_launch_ack()`/`capture_subagent_stop_final()` and calling `capture_native_return()` directly again, exactly reproducing F36. The correctness this repair delivers depends on the eventual live wiring routing PostToolUse(Agent, async ack) through `record_async_launch_ack()` and the terminal completion event through `capture_subagent_stop_final()` **exclusively** — that wiring review belongs to the future privileged-propagation decision, not to this off-live packet.

## Confirmation

- Zero new Agent/Task/model calls during repair or testing — synthetic queues/events only.
- No live guard propagation: `.claude/settings.json`, the guard manifest, the pinned toolbox, and both live doorway scripts (`g2d_precall_transition.py`, `g2d_postcall_capture.py`) are untouched.
- `capture_native_return()` and `record_native_dispatch()` (the existing trusted doorway) are byte-for-byte unchanged.
- Full affected regression suite green, 166 passed / 3 skipped / 0 failed, including the 11 new tests.
- SubagentStop payload field names are explicitly flagged as unverified rather than guessed into the implementation.

**Deterministic source-truth work in parallel:** completed and reported separately this session as AR-1313 (`G2D-AR1313-ATTRIBUTION-AND-REGRADE.md`) — still RED, 4/12 accepted, one real evidence-packaging bug found and fixed in the grading adapter, no gate weakened.

**NEXT:** a future privileged-propagation packet to (1) determine the real `SubagentStop` payload shape from Anthropic's authoritative documentation/schema (not available locally), (2) wire a thin adapter extracting `(agent_id, raw_output)` from it, (3) register `SubagentStop` in `.claude/settings.json`, and (4) route the live PostToolUse(Agent) async-ack path through `record_async_launch_ack()` instead of the current (defective) direct capture. None of that is done here — this packet is proof-of-repair only, per AR-1313A's explicit non-authorization of live propagation.
