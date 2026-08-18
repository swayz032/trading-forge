# F36 — SubagentStop Schema Verified Live, Real Extraction Wired

**Follows:** `F36-SUBAGENTSTOP-CAPTURE-REPAIR-OFF-LIVE.md` (same session, same day). That packet correctly refused to guess the `SubagentStop` payload field names — no local authoritative source was found. This packet closes that gap using `WebFetch` against Anthropic's own live documentation, which is the actual authoritative source (more so than the local repo, which had never documented it). **Still zero new Agent/Task/model calls; still no live guard propagation.**

## The real schema, quoted verbatim from the fetch

`https://docs.claude.com/en/docs/claude-code/hooks` redirected (301) to `https://code.claude.com/docs/en/hooks#subagentstop`, fetched 2026-08-18:

```json
{
  "session_id": "abc123",
  "transcript_path": "/home/user/.claude/projects/.../transcript.jsonl",
  "cwd": "/home/user/my-project",
  "permission_mode": "default",
  "hook_event_name": "SubagentStop",
  "agent_id": "subagent_01ABC123...",
  "agent_type": "security-reviewer",
  "last_assistant_message": "I've completed the security review...",
  "stop_reason": "end_turn"
}
```

| Field | Type | Description (verbatim from the docs) |
|---|---|---|
| `last_assistant_message` | string | The final assistant message text from the subagent's conversation, before any compaction |
| `stop_reason` | string | Why the subagent stopped: `"end_turn"`, `"max_tokens"`, `"stop_sequence"`, or `"tool_use"` (subagent called a tool and stopped awaiting the result) |

**`agent_id` and `last_assistant_message` are both real, confirmed fields.** AR-1313A's assumption was correct.

## What the ruling's framing missed, and this packet caught before wiring anything

`stop_reason` can be `"tool_use"` — *"subagent called a tool and stopped awaiting the result."* This means `SubagentStop` is **not guaranteed to fire only once, at true completion** — it can fire mid-flow, each time the subagent pauses on a tool call, before it resumes and eventually finishes. Treating every `SubagentStop` as terminal would have reintroduced a variant of F36 one layer up: capturing a mid-flow pause as if it were the final answer. `extract_subagent_stop_fields()` treats only `"end_turn"` / `"max_tokens"` / `"stop_sequence"` as terminal and raises `SubagentStopNotTerminal` (a distinct exception from a real failure) on `"tool_use"`, with the caller expected to simply wait for a later event on the same `agent_id`.

## What was added

`src/engine/extraction/g2d_subagentstop_capture.py` gained three new symbols, all built on top of the existing (still unchanged) `record_async_launch_ack()` / `capture_subagent_stop_final()` / `capture_native_return()`:

- **`extract_subagent_stop_fields(hook_payload: dict) -> (agent_id, last_assistant_message, stop_reason)`** — the real schema-verified parser. Refuses (raises `ValueError`) on: wrong `hook_event_name`, missing `agent_id`, an unrecognized `stop_reason`, or a terminal event with an empty `last_assistant_message`. Raises `SubagentStopNotTerminal` (not a generic error) on `stop_reason == "tool_use"`.
- **`capture_subagent_stop_event(ledger, ref, hook_payload)`** — the real live-shaped entry point a future privileged doorway would call. Runs the payload through the extractor, writes a new `.subagent_stop_event.json` audit receipt (the full raw hook payload, kept separate from `capture_native_return`'s fixed `COMPLETION_FIELDS` contract, which was not touched), then delegates to `capture_subagent_stop_final()` — inheriting its identity-binding and duplicate-protection unchanged.
- **`SubagentStopNotTerminal`** — a distinct exception type so a caller can tell "wait for a later event" apart from a genuine refusal.

## Tests — 13 new (24 total in the file, up from 11)

```
python -m pytest src/engine/tests/test_g2d_subagentstop_capture.py -v
```
→ **24 passed**, 0 failed.

New coverage:

| Witness | Test |
|---|---|
| real-shaped terminal payload extracts correctly | `test_extract_subagent_stop_fields_on_a_real_shaped_terminal_payload` |
| every documented terminal `stop_reason` accepted | `test_extract_subagent_stop_fields_accepts_every_documented_terminal_reason[end_turn\|max_tokens\|stop_sequence]` |
| `"tool_use"` refused as non-terminal, not as a failure | `test_extract_subagent_stop_fields_refuses_tool_use_as_nonterminal` |
| wrong `hook_event_name` refused | `test_extract_subagent_stop_fields_refuses_wrong_event_name` |
| missing `agent_id` refused | `test_extract_subagent_stop_fields_refuses_missing_agent_id` |
| unrecognized/future `stop_reason` refused, not assumed terminal | `test_extract_subagent_stop_fields_refuses_unknown_stop_reason` |
| terminal event with empty final message refused | `test_extract_subagent_stop_fields_refuses_terminal_event_with_no_final_message` |
| real payload, full path, end-to-end capture | `test_capture_subagent_stop_event_end_to_end_with_a_real_shaped_payload` |
| `tool_use` event through the full entry point: no receipt of any kind written, row untouched | `test_capture_subagent_stop_event_tool_use_does_not_finalize_and_row_stays_dispatched` |
| mismatched `agent_id` through the full entry point: fail closed | `test_capture_subagent_stop_event_mismatched_agent_id_fails_closed` |
| duplicate terminal event through the full entry point: refused at the audit-receipt layer, before ever reaching `capture_native_return` a second time | `test_capture_subagent_stop_event_duplicate_terminal_event_refused` |

## Full affected regression suite

```
python -m pytest src/engine/tests/ -q -k "isolated_bridge or isolated_attempt_receipt or g2d_finalizer or postcall_capture or precall_transition or isolated_fallback_law or subagentstop"
```
→ **179 passed, 3 skipped, 0 failed** (166 + 13 new; no existing test modified).

## Files changed this update

- `src/engine/extraction/g2d_subagentstop_capture.py` (extended, not rewritten — `record_async_launch_ack`, `capture_subagent_stop_final`, `assert_sequential_interlock` are byte-identical to the prior packet).
- `src/engine/tests/test_g2d_subagentstop_capture.py` (13 tests appended).
- `F36-SUBAGENTSTOP-CAPTURE-REPAIR-OFF-LIVE.md` (correction notice added at top; body preserved).
- This file.

## What is still NOT done — still no live propagation

This closes the "extraction is out of scope" gap. It does **not**:
- register `SubagentStop` (or the corrected `PostToolUse` handling) in `.claude/settings.json`,
- touch the pinned guard toolbox,
- touch either live doorway script (`g2d_precall_transition.py`, `g2d_postcall_capture.py`),
- verify against a REAL fired `SubagentStop` event from this runtime (only a schema-shaped synthetic payload, matching the documented example byte-for-byte, was used — the documentation could theoretically be stale or the live runtime could diverge from it; that would only be caught by a real, privileged, live-propagated run).

Live wiring remains a future privileged-propagation decision, per AR-1313A's explicit non-authorization.

## Confirmation

- Zero new Agent/Task/model calls (WebFetch is not an Agent/Task/model dispatch under this harness's own accounting; it fetched two doc pages, nothing else).
- No live guard propagation.
- `capture_native_return()` / `record_native_dispatch()` still byte-for-byte unchanged.
- Full affected regression suite green: 179 passed / 3 skipped / 0 failed.
