"""
deepscan14 D1 — Anti-setup miner CLI entrypoint regression test.

Before the fix, `src/engine/anti_setups/miner.py` was a pure library with no
`if __name__ == "__main__":` block. The scheduler invokes it as
`python -m src.engine.anti_setups.miner --config <tmpfile>` (scheduler.ts,
"anti-setup-mine" weekly cron) and expects JSON on stdout. With no CLI
entrypoint, the module ran and exited 0 with ZERO stdout, so
`parsePythonJson("")` threw on the Node side, the exception was swallowed as a
non-blocking warn, and the `anti_setup.mined` audit_log row was NEVER written —
`checkAntiSetupGate` always returned blocked:false forever (a permanent,
silent no-op indistinguishable from "mined, nothing to block").

This test invokes the module as a real subprocess (matching exactly how
scheduler.ts calls it) and asserts non-empty, valid JSON is always produced —
either a real mining result (`anti_setups` key populated from real
trades/bars) or an explicit `gate_status: "inactive"` envelope when the
config lacks trade/bar data (the scheduler's current config shape:
`{"strategy_id": "..."}` only, no trades/bars — a documented data-plumbing
follow-up, NOT a silently-fabricated result).
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]


def _run_miner_cli(config: dict) -> subprocess.CompletedProcess:
    """Invoke `python -m src.engine.anti_setups.miner --config <tmpfile>` exactly
    as scheduler.ts's runPythonModule() does (module + --config tmpfile)."""
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".json", delete=False, dir=tempfile.gettempdir()
    ) as f:
        json.dump(config, f)
        config_path = f.name

    try:
        return subprocess.run(
            [sys.executable, "-m", "src.engine.anti_setups.miner", "--config", config_path],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            timeout=60,
        )
    finally:
        Path(config_path).unlink(missing_ok=True)


class TestAntiSetupMinerCli:
    def test_scheduler_shaped_config_emits_inactive_envelope_not_empty_stdout(self):
        """The scheduler's ACTUAL config shape today: only strategy_id, no
        trades/bars. Before the fix: empty stdout, parse failure, audit_log
        row never written. After the fix: non-empty valid JSON with an
        explicit inactive gate_status — honest, not fabricated."""
        result = _run_miner_cli({
            "strategy_id": "11111111-1111-1111-1111-111111111111",
            "_metadata": {"correlationId": "test-correlation-id"},
        })

        assert result.returncode == 0, f"stderr: {result.stderr}"
        stdout = result.stdout.strip()
        assert stdout != "", "miner CLI produced EMPTY stdout — the exact false-green this fix closes"

        payload = json.loads(stdout)  # must not raise — this is the parsePythonJson contract
        assert "anti_setups" in payload
        assert payload["anti_setups"] == []
        assert payload.get("gate_status") == "inactive"
        assert "reason" in payload and len(payload["reason"]) > 0
        assert payload.get("strategy_id") == "11111111-1111-1111-1111-111111111111"

    def test_config_with_real_trades_runs_real_mining(self):
        """When trades/bars ARE supplied (future scheduler wiring, or any other
        caller), the CLI must run the real mine_anti_setups() and return real
        results — not silently fall back to the inactive envelope."""
        trades = []
        # 25 losing trades all in the 2-4am bucket -> should trip time_of_day miner
        # at the default min_sample_size=20 / min_failure_rate=0.65.
        for i in range(25):
            trades.append({
                "entry_time": f"2026-01-{(i % 27) + 1:02d}T02:15:00",
                "pnl": -50.0,
            })
        result = _run_miner_cli({
            "strategy_id": "22222222-2222-2222-2222-222222222222",
            "trades": trades,
            "bars": [],
        })

        assert result.returncode == 0, f"stderr: {result.stderr}"
        stdout = result.stdout.strip()
        assert stdout != ""

        payload = json.loads(stdout)
        assert payload.get("gate_status") == "active"
        assert "anti_setups" in payload
        assert isinstance(payload["anti_setups"], list)
        assert len(payload["anti_setups"]) >= 1
        top = payload["anti_setups"][0]
        assert top["condition"] == "time_of_day"
        assert top["failure_rate"] == 1.0

    def test_config_with_empty_trades_list_is_inactive_not_error(self):
        """An explicit empty trades list (as opposed to trades key absent) is
        still "nothing to mine" — inactive, not a crash."""
        result = _run_miner_cli({"strategy_id": "s1", "trades": []})
        assert result.returncode == 0, f"stderr: {result.stderr}"
        payload = json.loads(result.stdout.strip())
        assert payload["gate_status"] == "inactive"
        assert payload["anti_setups"] == []

    def test_missing_config_file_fails_loud_not_silent(self):
        """A config path that doesn't exist must fail loud (non-zero exit +
        JSON error), never silent-empty-stdout."""
        result = subprocess.run(
            [sys.executable, "-m", "src.engine.anti_setups.miner", "--config", "/nonexistent/path.json"],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert result.returncode != 0
        stdout = result.stdout.strip()
        assert stdout != ""
        payload = json.loads(stdout)
        assert "error" in payload


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
