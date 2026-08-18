"""F36 — the async-launch-ack vs true-final-completion boundary (AR-1311B / AR-1312B / AR-1313A).

THE DEFECT THIS CLOSES
    An Agent/Task dispatch under this harness returns SYNCHRONOUSLY with an async launch
    acknowledgement (`isAsync: true` / `status: "async_launched"` / an `agentId`) -- NOT the
    subagent's final answer. The final answer arrives later, delivered by the harness as a
    separate completion event. `PostToolUse(Agent)` fires on the SYNCHRONOUS return, so a
    capture doorway invoked from PostToolUse alone will only ever see the launch ack. Prior
    receipts (AR-1311/AR-1312 `isolated-receipts-t1/*.raw.json`) captured exactly that ack and
    were nevertheless marked `RAW_RETURN_CAPTURED` -- a real execution-boundary defect, not a
    cosmetic one.

WHAT THIS MODULE DOES, AND WHAT IT DELIBERATELY DOES NOT DO
    It adds four call boundaries and one check, all built ON TOP of the existing trusted doorway
    (`isolated_bridge.capture_native_return`), which stays completely unchanged:

        record_async_launch_ack()        -- PostToolUse(Agent) lands here. Launch telemetry
                                             ONLY. Never creates `.raw`/`.completion`. Row stays
                                             NATIVE_TASK_DISPATCHED.
        extract_subagent_stop_fields()    -- schema-verified parse of a real SubagentStop JSON
                                             payload into (agent_id, last_assistant_message,
                                             stop_reason). Raises SubagentStopNotTerminal on a
                                             `"tool_use"` `stop_reason`, IF a caller happens to
                                             send one (see below — it is optional, never
                                             required); raises ValueError on a malformed/wrong-
                                             event payload. Guesses nothing.
        capture_subagent_stop_event()     -- the real live-shaped entry point. Runs the payload
                                             through extract_subagent_stop_fields(), validates
                                             launch-ack identity BEFORE writing any receipt
                                             (F36-B), records the full raw event as audit
                                             evidence, then delegates to:
        capture_subagent_stop_final()     -- binds by `agent_id` to the launch ack already on
                                             file for this exact row, THEN calls
                                             `capture_native_return()` unchanged -- so duplicate-
                                             finalization protection is inherited for free, not
                                             reimplemented.
        assert_sequential_interlock()     -- every queue row strictly before `ref`, in the
                                             queue's own frozen order, must already be
                                             RAW_RETURN_CAPTURED. A launched-but-unfinalized
                                             predecessor blocks every row after it by
                                             construction.

    It does NOT reimplement the durable receipt law, does NOT touch `capture_native_return` or
    `record_native_dispatch`, and does NOT wire into any live `.claude/` hook, the pinned guard
    toolbox, or any file that path currently invokes. This module is inert until a future
    privileged propagation decision wires a live doorway to call it -- that decision is
    explicitly NOT made here (AR-1313A: "NOT AUTHORIZED IN THIS RULING").

THE REAL SubagentStop SCHEMA — CORRECTED 2026-08-18 (AR-1314A)
    The AR-1313A version of this module found no local authoritative source and treated
    `agent_id`/`raw_output` as opaque caller-supplied arguments. A LATER version of this module
    (the AR-1314A-graded packet) claimed to have closed that gap with a live fetch of
    `https://code.claude.com/docs/en/hooks#subagentstop` "quoted verbatim", including a
    `stop_reason` field. THAT CLAIM WAS WRONG. Independent GPT review of the same URL found no
    `stop_reason` field documented for `SubagentStop` at all, and a fresh live re-fetch of that
    exact URL performed during this repair (AR-1314A Lane A) confirms GPT's reading, not the
    prior claim in this file. The currently documented fields are:

        session_id, transcript_path, cwd, permission_mode, hook_event_name, agent_id,
        agent_type, last_assistant_message

    `SubagentStop` is documented to fire "when a subagent finishes" -- i.e. it is terminal by
    definition under the current contract; no `stop_reason` field, and no documented non-
    terminal variant of this event, currently exists. `extract_subagent_stop_fields()` therefore
    treats `stop_reason` as OPTIONAL and NEVER a rejection reason -- its absence is accepted, and
    an unrecognized value in it is accepted too. The one non-terminal value this code still
    defensively recognizes if a caller ever sends it (`"tool_use"`) is honored only because doing
    so costs nothing and cannot reject a currently-valid documented payload; it is not asserted
    to be part of the current schema. This module does NOT invent a lifecycle event or a polling
    mechanism to detect non-terminal state -- if the runtime's actual behavior ever needs that,
    it is a new finding to bring back to the desk, not something to guess into place here.
"""
from __future__ import annotations

import json
import os
from typing import Any

from .isolated_attempt_receipt import AttemptRefused, DurableAttemptLedger, _safe_name
from .isolated_bridge import (
    NATIVE_TASK_DISPATCHED,
    RAW_RETURN_CAPTURED,
    capture_native_return,
    state_of,
)

__all__ = [
    "record_async_launch_ack",
    "SubagentStopNotTerminal",
    "extract_subagent_stop_fields",
    "capture_subagent_stop_event",
    "capture_subagent_stop_final",
    "assert_sequential_interlock",
]

# Verbatim from https://code.claude.com/docs/en/hooks#subagentstop, fetched live 2026-08-18.
SUBAGENT_STOP_TERMINAL_REASONS = frozenset({"end_turn", "max_tokens", "stop_sequence"})
SUBAGENT_STOP_NONTERMINAL_REASONS = frozenset({"tool_use"})
SUBAGENT_STOP_KNOWN_REASONS = SUBAGENT_STOP_TERMINAL_REASONS | SUBAGENT_STOP_NONTERMINAL_REASONS


class SubagentStopNotTerminal(RuntimeError):
    """Raised when a SubagentStop event's `stop_reason` is `"tool_use"`: the subagent paused
    awaiting a tool result and has not actually finished. This is a NORMAL, expected outcome —
    not a failure of this row's one-shot attempt. The caller should simply wait for a LATER
    SubagentStop event bearing the same `agent_id` with a terminal `stop_reason`; it must NOT
    retry the dispatch, spend a new call, or treat this as the row's answer."""


def _launch_ack_path(ledger: DurableAttemptLedger, ref: str) -> str:
    return os.path.join(ledger.receipt_dir, f"{_safe_name(ref)}.launch_ack.json")


def record_async_launch_ack(
    ledger: DurableAttemptLedger, ref: str, agent_id: str, raw_ack_payload: Any = None,
) -> dict:
    """F36 point 1. An async launch acknowledgement is launch-only telemetry.

    Refuses unless a dispatch was already recorded (state must be exactly
    NATIVE_TASK_DISPATCHED) -- an ack for a call that was never dispatched, or for a row already
    finalized, is refused rather than silently accepted. Never creates `.raw`/`.completion`:
    that is the entire point of separating this from `capture_native_return`.
    """
    st = state_of(ledger, ref)
    if st != NATIVE_TASK_DISPATCHED:
        raise AttemptRefused(
            f"cannot record a launch ack for {ref!r} at state {st}: a launch ack is only valid "
            f"immediately after a recorded dispatch ({NATIVE_TASK_DISPATCHED}), before any final "
            "capture — recording one at any other state would misrepresent what happened."
        )
    if not agent_id:
        raise AttemptRefused(
            f"cannot record a launch ack for {ref!r} with no agent_id: an unidentified launch "
            "can never later be matched by a terminal completion event, so it could never be "
            "finalized honestly."
        )
    path = _launch_ack_path(ledger, ref)
    if os.path.exists(path):
        raise AttemptRefused(
            f"{ref!r} already has a recorded launch ack. The one authorized dispatch's launch is "
            "recorded exactly once; a second ack describes a call this row never made."
        )
    receipt = {
        "state": "ASYNC_LAUNCH_ACK_RECORDED",
        "condition_ref": ref,
        "agent_id": agent_id,
        "raw_ack_payload": raw_ack_payload,
        "authority": "F36 (AR-1311B / AR-1312B / AR-1313A)",
        "note": (
            "This receipt proves a subagent was launched. It does NOT satisfy final-answer "
            "capture. Only a matching SubagentStop event through capture_subagent_stop_final() "
            "may finalize this row."
        ),
    }
    DurableAttemptLedger._create_only(
        path, receipt, what="launch ack receipt",
        extra=f"{ref!r} already has a launch ack recorded.")
    return receipt


def _read_launch_ack(ledger: DurableAttemptLedger, ref: str) -> dict | None:
    path = _launch_ack_path(ledger, ref)
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def extract_subagent_stop_fields(hook_payload: dict) -> tuple[str, str, str | None]:
    """Schema-verified extraction from a real `SubagentStop` hook JSON payload.

    Returns `(agent_id, last_assistant_message, stop_reason)`. Raises `SubagentStopNotTerminal`
    when `stop_reason == "tool_use"` — the subagent is still working; this event must NOT be
    used to finalize anything. Raises `ValueError` on a payload that is not actually a
    `SubagentStop` event, that lacks a recorded `agent_id`, or a terminal event with no
    `last_assistant_message` — every case refuses rather than guesses.

    F36-A REPAIR (AR-1314A, 2026-08-18): the original version of this function REQUIRED
    `stop_reason` and rejected any payload lacking it or carrying an unrecognized value.
    Independent GPT review of the current authoritative source
    (https://code.claude.com/docs/en/hooks#subagentstop) found that page does NOT document a
    `stop_reason` field for `SubagentStop` at all — this module's prior docstring claim of a
    verbatim live-fetched schema including `stop_reason` was WRONG, re-verified here via a fresh
    live fetch of the same URL: documented fields are `session_id` / `transcript_path` / `cwd` /
    `permission_mode` / `hook_event_name` / `agent_id` / `agent_type` / `last_assistant_message`
    — no `stop_reason`. `SubagentStop` is documented to fire "when a subagent finishes", i.e. it
    is terminal by definition. `stop_reason` is therefore OPTIONAL and never a rejection reason:
    its absence is accepted, and an unrecognized value in it is accepted too. Only the one
    documented-elsewhere non-terminal signal this code defensively recognizes ("tool_use") is
    still honored, and only when a caller actually sends it — nothing about the parse REQUIRES
    the field to exist.
    """
    if hook_payload.get("hook_event_name") != "SubagentStop":
        raise ValueError(
            f"expected hook_event_name 'SubagentStop', got "
            f"{hook_payload.get('hook_event_name')!r}. Refusing to treat a differently-named "
            "event as a subagent completion."
        )
    agent_id = hook_payload.get("agent_id")
    if not agent_id:
        raise ValueError(
            "SubagentStop payload carries no agent_id. Per the documented schema every "
            "SubagentStop event names the agent that stopped; an absent one cannot be bound to "
            "any launch ack and must not be guessed."
        )
    stop_reason = hook_payload.get("stop_reason")
    if stop_reason in SUBAGENT_STOP_NONTERMINAL_REASONS:
        raise SubagentStopNotTerminal(
            f"agent {agent_id!r} stopped with stop_reason={stop_reason!r}: it is awaiting a "
            "tool result, not finished. A later SubagentStop for the same agent_id is expected; "
            "this event must not finalize the row."
        )
    last_assistant_message = hook_payload.get("last_assistant_message")
    if not last_assistant_message:
        raise ValueError(
            f"agent {agent_id!r} SubagentStop carries no last_assistant_message. A terminal "
            "event with no final text is a data-integrity problem, not an answer to capture."
        )
    return agent_id, last_assistant_message, stop_reason


def _subagent_stop_event_path(ledger: DurableAttemptLedger, ref: str) -> str:
    return os.path.join(ledger.receipt_dir, f"{_safe_name(ref)}.subagent_stop_event.json")


def _validate_launch_ack_identity(ledger: DurableAttemptLedger, ref: str, agent_id: str) -> dict:
    """Shared fail-closed identity check (F36-B, AR-1314A): used by BOTH
    `capture_subagent_stop_event()` and `capture_subagent_stop_final()` so the same check runs
    in both places rather than two copies that could drift apart. Returns the launch-ack dict on
    success; raises `AttemptRefused` when no ack was recorded, or when the terminal event's
    `agent_id` does not match the recorded launch's `agent_id`.
    """
    ack = _read_launch_ack(ledger, ref)
    if ack is None:
        raise AttemptRefused(
            f"cannot finalize {ref!r}: no launch ack was ever recorded for it, so this "
            "completion event cannot be bound to an authorized, already-launched dispatch."
        )
    if ack["agent_id"] != agent_id:
        raise AttemptRefused(
            f"cannot finalize {ref!r}: this completion event names agent_id {agent_id!r}, but "
            f"the recorded launch for this row was agent_id {ack['agent_id']!r}. A mismatched "
            "identity is never trusted to close a different row's dispatch — fail closed."
        )
    return ack


def capture_subagent_stop_event(
    ledger: DurableAttemptLedger, ref: str, hook_payload: dict,
) -> dict:
    """The real live-shaped entry point. Takes an actual `SubagentStop` hook JSON payload,
    extracts `(agent_id, last_assistant_message, stop_reason)` via the schema-verified
    `extract_subagent_stop_fields()`, records the full raw event as audit evidence (kept
    separate from `capture_native_return`'s fixed `COMPLETION_FIELDS` contract, which stays
    unchanged), and only then delegates to `capture_subagent_stop_final()`.

    A `SubagentStopNotTerminal` (`stop_reason == "tool_use"`) or malformed-payload `ValueError`
    propagates to the caller BEFORE any receipt is written — a non-terminal or invalid event
    leaves the row exactly as it found it.

    F36-B REPAIR (AR-1314A, 2026-08-18): identity is now validated against the recorded launch
    ack BEFORE the one-shot `.subagent_stop_event.json` audit receipt is created. The original
    ordering wrote that receipt first and only checked identity afterward (inside
    `capture_subagent_stop_final()`), so a wrong-`agent_id` terminal event permanently occupied
    the row's one-shot event slot even though it was refused — and the correctly-launched
    agent's LATER valid completion was then rejected as a "duplicate terminal event" despite
    nothing valid ever having been captured, stranding the row forever. Validating first means a
    mismatched event leaves NO durable trace capable of blocking anything.
    """
    agent_id, last_assistant_message, stop_reason = extract_subagent_stop_fields(hook_payload)

    _validate_launch_ack_identity(ledger, ref, agent_id)

    event_path = _subagent_stop_event_path(ledger, ref)
    if os.path.exists(event_path):
        raise AttemptRefused(
            f"{ref!r} already has a recorded terminal SubagentStop event. A second terminal "
            "event for the same row is not re-audited even if capture_native_return would also "
            "refuse it — the audit trail itself is one-shot."
        )
    DurableAttemptLedger._create_only(
        event_path,
        {
            "condition_ref": ref,
            "agent_id": agent_id,
            "stop_reason": stop_reason,
            "raw_hook_payload": hook_payload,
            "authority": "F36 (AR-1311B / AR-1312B / AR-1313A / AR-1314A) — schema verified "
                          "live from https://code.claude.com/docs/en/hooks#subagentstop, "
                          "2026-08-18",
        },
        what="subagent stop event audit receipt",
        extra=f"{ref!r} already has a recorded terminal SubagentStop event.",
    )
    return capture_subagent_stop_final(ledger, ref, agent_id, last_assistant_message)


def capture_subagent_stop_final(
    ledger: DurableAttemptLedger,
    ref: str,
    agent_id: str,
    raw_output: str,
    completion: dict[str, Any] | None = None,
) -> dict:
    """F36 point 2. The real finalization boundary.

    Binds by `agent_id` to the launch ack already recorded for this EXACT frozen row, then
    reuses `capture_native_return()` completely unchanged. Duplicate-finalization protection is
    therefore inherited, not reimplemented: `capture_native_return` already refuses a second
    write once a row reaches RAW_RETURN_CAPTURED, and this function adds no exception to that.
    """
    _validate_launch_ack_identity(ledger, ref, agent_id)
    return capture_native_return(ledger, ref, raw_output, completion)


def assert_sequential_interlock(ledger: DurableAttemptLedger, ref: str) -> None:
    """F36 point 3. Row N+1 stays denied until row N has a durable final capture.

    Every queue row strictly BEFORE `ref`, in the queue's own frozen order, must already be
    RAW_RETURN_CAPTURED. A launched-but-unfinalized predecessor blocks every later row by
    construction — there is no separate index to keep in sync and no way to skip ahead.
    """
    order = [e["condition_ref"] for e in ledger.queue["queue"]]
    if ref not in order:
        raise AttemptRefused(f"{ref!r} is not in the committed queue order.")
    for earlier in order[: order.index(ref)]:
        st = state_of(ledger, earlier)
        if st != RAW_RETURN_CAPTURED:
            raise AttemptRefused(
                f"sequential interlock: {ref!r} is blocked because {earlier!r} is at state "
                f"{st!r}, not {RAW_RETURN_CAPTURED!r}. Row N+1 may not be claimed until row N "
                "has a durable final capture."
            )
