"""R-030 §2/§3 — the CLI-OWNED blind dispatch loop.

The CLI (not the conductor) shells `claude -p` with NO tools (`--tools ""` = physical
blindness) and the transcript / rater-packet CONTENT embedded in the prompt; it
strict-parses the captured stdout, and on a RawJsonNonCompliant (the SOLE mechanical
trigger) re-dispatches up to a hard cap of 2 (3 attempts total), QUARANTINING each
non-compliant raw (persisted, never ingested), and wraps the first compliant raw into
the ingested artifact. The run-total format-retry count is reported (never gating) in
the verdict.

NO live model: the `claude_fn` seam is a scripted stub in every test.

Pins proven here (R-030 mutation scope):
  * retry ONLY on RawJsonNonCompliant, NEVER on a property of parsed content;
  * cap = initial + 2 (never a 4th call); exhausted -> HALT NON-COMPLIANT;
  * non-compliant raws quarantined; a schemaless-but-parsed raw HALTs un-retried;
  * an infra failure HALTs immediately (not a format-retry);
  * the emitted `claude -p` argv carries `--tools ""` and NEVER `--allowedTools Read`;
  * the transcript is EMBEDDED (content in the prompt), never handed as a path to read;
  * raters swept the same way (packet embedded, no tools, no frozen system prompt);
  * dispatch_health is additive (None -> absent; int -> reported, never moves the bar).
"""

from __future__ import annotations

import importlib.util
import json
import os
import sys

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
_CLI_PATH = os.path.join(_ROOT, "scripts", "h1_seal_conductor_cli.py")
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)
_spec = importlib.util.spec_from_file_location("h1_seal_conductor_cli", _CLI_PATH)
cli = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cli)


def _wd_with_transcript(tmp_path, vid: str, text: str = "some strategy transcript body") -> str:
    wd = str(tmp_path / "workdir")
    os.makedirs(os.path.join(wd, "transcripts"), exist_ok=True)
    with open(os.path.join(wd, "transcripts", f"{vid}.txt"), "w", encoding="utf-8") as fh:
        fh.write(text)
    return wd


class _ScriptedClaude:
    """Injected `claude_fn` stub — returns scripted outputs per attempt, records calls.
    NEVER touches a real model (the whole point of the injectable seam)."""

    def __init__(self, outputs):
        self._outputs = list(outputs)
        self.calls = []

    def __call__(self, model_id, system_text, user_text, timeout=300):
        self.calls.append({"model_id": model_id, "system_text": system_text, "user_text": user_text})
        if not self._outputs:
            raise AssertionError("stub called more times than scripted")
        out = self._outputs.pop(0)
        if isinstance(out, Exception):
            raise out
        return out


_CLEAN_PHASE_A = '{"strategies": [{"name": "s1"}], "enumeration_note": null}'
_PREAMBLED = "Here is the extraction you asked for:\n" + _CLEAN_PHASE_A + "\nDone."


def test_r030_dispatch_retries_on_noncompliant_then_succeeds(tmp_path):
    vid = "VIDRETRY01"
    wd = _wd_with_transcript(tmp_path, vid)
    stub = _ScriptedClaude([_PREAMBLED, _CLEAN_PHASE_A])  # attempt0 bad, attempt1 clean
    code, text = cli.run_dispatch(wd, "phase_a", vid, 0, claude_fn=stub)
    assert code == 0, text
    assert "retries=1" in text and "attempts=2" in text
    assert len(stub.calls) == 2
    draw = json.load(open(os.path.join(wd, "phase_a", vid, "draw_0.json"), encoding="utf-8"))
    assert draw["count"] == 1 and draw["strategy_refs"] == [f"{vid}__s0"]
    qpath = os.path.join(wd, "quarantine", f"phase_a__{vid}__d0", "attempt_0.txt")
    assert os.path.exists(qpath)  # non-compliant raw persisted-but-quarantined
    rec = json.load(open(os.path.join(wd, "attempts", f"phase_a__{vid}__d0.json"), encoding="utf-8"))
    assert rec["resolved"] is True and rec["retry_count"] == 1
    assert [a["outcome"] for a in rec["attempts"]] == ["non_compliant", "ok"]


def test_r030_dispatch_cap_exhausted_halts_noncompliant(tmp_path):
    vid = "VIDCAP01"
    wd = _wd_with_transcript(tmp_path, vid)
    stub = _ScriptedClaude([_PREAMBLED, _PREAMBLED, _PREAMBLED])  # all 3 non-compliant
    code, text = cli.run_dispatch(wd, "phase_a", vid, 0, claude_fn=stub)
    assert code == 1 and "NON-COMPLIANT" in text and "exhausted" in text
    assert len(stub.calls) == 3  # initial + cap(2) = 3, never a 4th
    assert not os.path.exists(os.path.join(wd, "phase_a", vid, "draw_0.json"))  # fail-closed
    for i in range(3):
        assert os.path.exists(os.path.join(wd, "quarantine", f"phase_a__{vid}__d0", f"attempt_{i}.txt"))
    rec = json.load(open(os.path.join(wd, "attempts", f"phase_a__{vid}__d0.json"), encoding="utf-8"))
    assert rec["resolved"] is False


def test_r030_retry_only_on_noncompliant_never_on_parsed_content(tmp_path):
    """A WELL-FORMED JSON object of the WRONG schema (parses fine, no `strategies`)
    HALTs WITHOUT retrying — retry fires only on RawJsonNonCompliant, never on a
    property of successfully-parsed content."""
    vid = "VIDSHAPE01"
    wd = _wd_with_transcript(tmp_path, vid)
    stub = _ScriptedClaude(['{"foo": 1, "bar": 2}'])  # clean JSON, wrong shape
    code, text = cli.run_dispatch(wd, "phase_a", vid, 0, claude_fn=stub)
    assert code == 1 and "wrap shape" in text
    assert len(stub.calls) == 1  # NOT retried
    assert not os.path.exists(os.path.join(wd, "phase_a", vid, "draw_0.json"))


def test_r030_infra_error_halts_immediately_not_retried(tmp_path):
    vid = "VIDINFRA01"
    wd = _wd_with_transcript(tmp_path, vid)
    stub = _ScriptedClaude([cli.ClaudeDispatchError("claude -p exited 1: boom")])
    code, text = cli.run_dispatch(wd, "phase_a", vid, 0, claude_fn=stub)
    assert code == 1 and "ClaudeDispatchError" in text
    assert len(stub.calls) == 1  # infra failure is NOT a format-retry


def test_r030_dispatch_embeds_transcript_and_frozen_system_prompt(tmp_path):
    vid = "VIDEMBED01"
    body = "UNIQUE-TRANSCRIPT-MARKER strategy body " * 5
    wd = _wd_with_transcript(tmp_path, vid, body)
    stub = _ScriptedClaude([_CLEAN_PHASE_A])
    code, _ = cli.run_dispatch(wd, "phase_a", vid, 0, claude_fn=stub)
    assert code == 0
    call = stub.calls[0]
    assert "UNIQUE-TRANSCRIPT-MARKER" in call["user_text"]  # content embedded
    assert f"transcripts/{vid}.txt" not in call["user_text"]  # NOT a path to read
    assert "you have no tools and no file access" in call["user_text"].lower()
    assert call["system_text"] == cli._frozen_prompt_text(cli.ENUMERATOR_PROMPT_PATH)


def test_r030_run_claude_p_uses_no_tools_and_no_allowedtools(monkeypatch):
    """The physical-blindness pin at the SHELL boundary: the emitted `claude -p` argv
    carries `--tools ""` (all tools disabled) and NEVER `--allowedTools Read`. The user
    prompt is passed via STDIN (not a positional argv element — `--tools` is variadic
    and would swallow a trailing positional prompt as a tool name)."""
    captured = {}

    class _FakeProc:
        returncode = 0
        stdout = _CLEAN_PHASE_A
        stderr = ""

    def _spy(cmd, **kwargs):
        captured["cmd"] = cmd
        captured["input"] = kwargs.get("input")
        return _FakeProc()

    import subprocess

    monkeypatch.setattr(subprocess, "run", _spy)
    out = cli._run_claude_p("some-model", "SYSTEM PROMPT", "USER PROMPT with embedded text")
    assert out == _CLEAN_PHASE_A
    cmd = captured["cmd"]
    assert cmd[:2] == ["claude", "-p"]
    assert "--tools" in cmd and cmd[cmd.index("--tools") + 1] == ""
    assert "--allowedTools" not in cmd and "Read" not in cmd
    # the user prompt is via STDIN, NOT an argv element (variadic --tools safety).
    assert captured["input"] == "USER PROMPT with embedded text"
    assert "USER PROMPT with embedded text" not in cmd
    assert not any(str(c) == ">" for c in cmd)


def test_r030_run_claude_p_unsets_claudecode_for_child(monkeypatch):
    """R-030 §4 live-found: the conductor is itself a Claude Code session, and a bare
    `claude -p` child refuses to launch until CLAUDECODE is unset. `_run_claude_p`
    must spawn the child with CLAUDECODE removed from its env."""
    captured = {}

    class _FakeProc:
        returncode = 0
        stdout = _CLEAN_PHASE_A
        stderr = ""

    def _spy(cmd, **kwargs):
        captured["env"] = kwargs.get("env")
        return _FakeProc()

    import subprocess

    monkeypatch.setenv("CLAUDECODE", "1")
    monkeypatch.setattr(subprocess, "run", _spy)
    cli._run_claude_p("m", "SYS", "USER")
    assert captured["env"] is not None and "CLAUDECODE" not in captured["env"]


def test_r030_run_claude_p_omits_system_flag_when_empty(monkeypatch):
    """A rater dispatch has no frozen system prompt -> no `--append-system-prompt`;
    the prompt still rides on STDIN so the variadic --tools can't eat it."""
    captured = {}

    class _FakeProc:
        returncode = 0
        stdout = "{}"
        stderr = ""

    def _spy(cmd, **kwargs):
        captured["cmd"] = cmd
        captured["input"] = kwargs.get("input")
        return _FakeProc()

    import subprocess

    monkeypatch.setattr(subprocess, "run", _spy)
    cli._run_claude_p("m", "", "USER")
    assert "--append-system-prompt" not in captured["cmd"]
    # with no system flag, --tools "" is the LAST flag; the prompt MUST be on stdin.
    assert captured["input"] == "USER" and "USER" not in captured["cmd"]


def test_r030_exhaust_path_logs_true_retry_count(tmp_path):
    """Grader LOW-finding fix: the exhaust-path attempts record logs the TRUE
    non-compliant count (not 0), so `_scan_dispatch_retry_total` never undercounts."""
    vid = "VIDLOG01"
    wd = _wd_with_transcript(tmp_path, vid)
    stub = _ScriptedClaude([_PREAMBLED, _PREAMBLED, _PREAMBLED])
    code, _ = cli.run_dispatch(wd, "phase_a", vid, 0, claude_fn=stub)
    assert code == 1
    rec = json.load(open(os.path.join(wd, "attempts", f"phase_a__{vid}__d0.json"), encoding="utf-8"))
    assert rec["resolved"] is False and rec["retry_count"] == 2  # 2 retries, not 0


def _write_rater_packets(wd):
    """A minimal but real-shaped rater packet emit (R-031): stage1_view (blind — carries
    the closed_taxonomy + a STAGE1-MARKER, NO revealed conditions), stage2_items (the
    REVEALED conditions with a STAGE2-MARKER), and the stage-scoped output_contract."""
    os.makedirs(os.path.join(wd, "emit"), exist_ok=True)
    packet = {
        "cid": "V__s0",
        "stage1_view": {"closed_taxonomy": {"gate-strength": "d", "context": "d", "cannot-determine": "d"},
                        "sections": [{"items": [{"item_id": "i1", "quote_anchor": "STAGE1-MARKER-QUOTE"}]}]},
        "stage2_items": [{"item_id": "i1", "extracted_condition_text": "STAGE2-MARKER-REVEALED"}],
        "output_contract": {
            "stage1": {"answer_store_shape": {"stage1": {"<item_id>": "<role>"}},
                       "allowed_role": ["cannot-determine", "context", "gate-strength"], "commitment": "roles from quote alone"},
            "stage2": {"answer_store_shape": {"stage2": {"<item_id>": {"support": "<support>", "support_justification": "<str>"}}},
                       "allowed_support": ["confirmed", "partial", "denied"], "commitment": "justification required"},
        },
    }
    with open(cli._emit_path(wd, cli._RATER_PKT_EMIT), "w", encoding="utf-8") as fh:
        json.dump({"stage": "certify", "packets": [packet]}, fh)


def test_r031_rater_stage1_blind_excludes_stage2_from_prompt(tmp_path):
    """★ The read-order lock: a Stage-1 dispatch embeds stage1_view + the stage1
    contract ONLY — the revealed Stage-2 conditions are PHYSICALLY absent from the
    prompt, so the blind role read cannot see them."""
    wd = str(tmp_path / "workdir")
    _write_rater_packets(wd)
    stub = _ScriptedClaude(['{"stage1": {"i1": "context"}}'])
    code, text = cli.run_dispatch(wd, "rater", None, "A", claude_fn=stub, rater_stage="stage1")
    assert code == 0, text
    assert stub.calls[0]["system_text"] == ""  # no frozen system prompt for raters
    up = stub.calls[0]["user_text"]
    assert "STAGE1-MARKER-QUOTE" in up  # blind view embedded
    assert "STAGE2-MARKER-REVEALED" not in up  # ★ Stage-2 physically excluded
    assert '"allowed_role"' in up  # the stage1 output_contract is embedded
    assert '"allowed_support"' not in up  # only the stage1 contract, not stage2's
    written = json.load(open(os.path.join(wd, "raters", "A.json"), encoding="utf-8"))
    assert written["stage1"] == {"i1": "context"} and "stage2" not in written


def test_r031_rater_stage2_embeds_revealed_and_merges(tmp_path):
    """Stage-2 dispatch embeds the revealed conditions + stage2 contract and MERGES
    into the same store, leaving the Stage-1 answer intact."""
    wd = str(tmp_path / "workdir")
    _write_rater_packets(wd)
    # stage1 first, then stage2 — two sequential dispatches, one store.
    cli.run_dispatch(wd, "rater", None, "A", claude_fn=_ScriptedClaude(['{"stage1": {"i1": "gate-strength"}}']), rater_stage="stage1")
    stub2 = _ScriptedClaude(['{"stage2": {"i1": {"support": "confirmed", "support_justification": "y"}}}'])
    code, text = cli.run_dispatch(wd, "rater", None, "A", claude_fn=stub2, rater_stage="stage2")
    assert code == 0, text
    up = stub2.calls[0]["user_text"]
    assert "STAGE2-MARKER-REVEALED" in up and "STAGE1-MARKER-QUOTE" not in up
    store = json.load(open(os.path.join(wd, "raters", "A.json"), encoding="utf-8"))
    assert store["stage1"] == {"i1": "gate-strength"}  # merged, not clobbered
    assert store["stage2"]["i1"]["support"] == "confirmed"


def test_r031_rater_stage_wrong_shape_halts_not_retried(tmp_path):
    wd = str(tmp_path / "workdir")
    _write_rater_packets(wd)
    # a stage2-shaped answer returned to a stage1 dispatch -> wrong shape for stage1.
    stub = _ScriptedClaude(['{"stage2": {"i1": {"support": "confirmed", "support_justification": "y"}}}'])
    code, text = cli.run_dispatch(wd, "rater", None, "B", claude_fn=stub, rater_stage="stage1")
    assert code == 1 and "wrap shape" in text
    assert len(stub.calls) == 1  # content shape is never a retry trigger


def test_r031_rater_requires_stage(tmp_path):
    wd = str(tmp_path / "workdir")
    _write_rater_packets(wd)
    code, text = cli.run_dispatch(wd, "rater", None, "A", claude_fn=_ScriptedClaude(["{}"]), rater_stage=None)
    assert code == 1 and "stage1|stage2" in text


def test_r031_derived_contract_flows_to_cli_enforcement(tmp_path):
    """Integration: build the emit's output_contract with the REAL driver
    `_rater_output_contract` (derived vocab), then dispatch through the CLI and confirm
    the CLI enforcement reads THAT derived contract — a role outside the derived
    closed_taxonomy keys HALTs; an in-derived-vocab role ingests."""
    from src.engine.extraction.sealed_read_driver import _rater_output_contract

    wd = str(tmp_path / "workdir")
    os.makedirs(os.path.join(wd, "emit"), exist_ok=True)
    taxo = {"gate-strength": "d", "context": "d", "cannot-determine": "d"}
    stage1_view = {"closed_taxonomy": taxo,
                   "sections": [{"items": [{"item_id": "i1", "quote_anchor": "Q"}]}]}
    packet = {"cid": "V__s0", "stage1_view": stage1_view,
              "stage2_items": [{"item_id": "i1", "extracted_condition_text": "C"}],
              "output_contract": _rater_output_contract(stage1_view)}
    with open(cli._emit_path(wd, cli._RATER_PKT_EMIT), "w", encoding="utf-8") as fh:
        json.dump({"stage": "certify", "packets": [packet]}, fh)
    # a role NOT in the derived closed_taxonomy keys -> HALT (enforcement read the
    # derived contract, not a hardcoded copy).
    bad = _ScriptedClaude(['{"stage1": {"i1": "not-a-real-role"}}'])
    code, text = cli.run_dispatch(wd, "rater", None, "A", claude_fn=bad, rater_stage="stage1")
    assert code == 1 and "out-of-vocabulary" in text
    # an in-derived-vocab role ingests.
    good = _ScriptedClaude(['{"stage1": {"i1": "gate-strength"}}'])
    code2, _ = cli.run_dispatch(wd, "rater", None, "A", claude_fn=good, rater_stage="stage1")
    assert code2 == 0
    assert cli._rater_allowed_values(wd, "stage1") == set(taxo.keys())


def test_r031_rater_out_of_vocab_role_halts(tmp_path):
    """R-031 §a4: an out-of-vocabulary role HALTs at the wrap, never coerced/ingested."""
    wd = str(tmp_path / "workdir")
    _write_rater_packets(wd)
    stub = _ScriptedClaude(['{"stage1": {"i1": "totally-made-up-role"}}'])
    code, text = cli.run_dispatch(wd, "rater", None, "A", claude_fn=stub, rater_stage="stage1")
    assert code == 1 and "out-of-vocabulary" in text
    assert not os.path.exists(os.path.join(wd, "raters", "A.json"))  # never ingested


def test_r031_rater_out_of_vocab_support_and_blank_justification_halt(tmp_path):
    wd = str(tmp_path / "workdir")
    _write_rater_packets(wd)
    bad_support = _ScriptedClaude(['{"stage2": {"i1": {"support": "maybe", "support_justification": "x"}}}'])
    code, text = cli.run_dispatch(wd, "rater", None, "A", claude_fn=bad_support, rater_stage="stage2")
    assert code == 1 and "out-of-vocabulary" in text
    blank_just = _ScriptedClaude(['{"stage2": {"i1": {"support": "confirmed", "support_justification": "  "}}}'])
    code2, text2 = cli.run_dispatch(wd, "rater", None, "B", claude_fn=blank_just, rater_stage="stage2")
    assert code2 == 1 and "support_justification" in text2


def test_r030_dispatch_writes_dispatch_record(tmp_path):
    """R-030 §3: the CLI fills the dispatch record itself so the stage identity guards
    can assert it — written once, from the frozen identity, channel = subscription."""
    vid = "VIDREC01"
    wd = _wd_with_transcript(tmp_path, vid)
    stub = _ScriptedClaude([_CLEAN_PHASE_A])
    code, _ = cli.run_dispatch(wd, "phase_a", vid, 0, claude_fn=stub)
    assert code == 0
    rec = json.load(open(os.path.join(wd, "dispatch_record.json"), encoding="utf-8"))
    ri = cli.certified_reader_identity()
    assert rec["requested_model"] == ri["model_id"] == rec["resolved_model"]
    assert rec["channel_class"] == ri["channel_class"] and rec["dispatch_mode"] == "headless"
    # the wrapped draw embeds the record (self-describing).
    draw = json.load(open(os.path.join(wd, "phase_a", vid, "draw_0.json"), encoding="utf-8"))
    assert draw["dispatch_record"]["resolved_model"] == ri["model_id"]


def test_r030_scan_retry_total_none_without_dir_then_sums(tmp_path):
    wd = str(tmp_path / "workdir")
    os.makedirs(wd, exist_ok=True)
    assert cli._scan_dispatch_retry_total(wd) is None  # keeps rehearsal byte-unchanged
    os.makedirs(os.path.join(wd, "attempts"), exist_ok=True)
    for key, rc in (("a", 2), ("b", 0), ("c", 1)):
        with open(os.path.join(wd, "attempts", f"{key}.json"), "w", encoding="utf-8") as fh:
            json.dump({"retry_count": rc}, fh)
    assert cli._scan_dispatch_retry_total(wd) == 3


# NOTE: the verdict-side additive contract for dispatch_health is proven against the
# REAL Module-D fixture in test_sealed_read_driver.py
# (test_e_dispatch_health_additive_reported_never_gating) — NOT a fabricated stage
# shape here (a hand-built Module-D dict would be a fabricated-safety-claim).
