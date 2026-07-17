"""Regression test — compliance_gate.py CLI `no_ruleset` short-circuit scoping.

HIGH fix (capital-safety-compliance-gates wave, 2026-07-17):
`src/engine/compliance/compliance_gate.py`'s `__main__` CLI block previously
ran the "no ruleset provided" short-circuit UNCONDITIONALLY before dispatching
to the requested `action` — so any action invoked without a `ruleset` key,
including ruleset-INDEPENDENT actions like `check_kill_switch` (the D6 kill
switch), `check_two_percent_rule`, `check_hft_limit`,
`check_simultaneous_limit_price`, `check_strategy_compliance`, and
`detect_drift`, silently returned the no-op `{"status": "no_ruleset", ...}`
envelope instead of running the real check. None of those actions read
`ruleset` at all in their normal call signature.

This test drives the CLI as a real subprocess (matching how
`broker-router.ts` / `multi-firm-promotion-service.ts` / the paper kill
switch invoke it) and asserts:
  1. `check_kill_switch` with NO `ruleset` key in the config still runs the
     real kill-switch evaluation (returns a `tripped` key, not `no_ruleset`).
  2. `check_freshness` (a genuinely ruleset-DEPENDENT action) with no
     `ruleset` key still short-circuits to `no_ruleset` — the scoping fix
     must not accidentally widen ruleset-dependent actions into running
     without one.

RED-proof: reverting the `action in RULESET_DEPENDENT_ACTIONS` scoping back
to the old unconditional `if not ruleset:` check makes assertion (1) fail —
`check_kill_switch` would come back as `{"status": "no_ruleset", ...}`
instead of a real tripped/reason/force_close verdict.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[3]


def _run_compliance_gate_cli(config: dict) -> dict:
    """Invoke compliance_gate.py as a real subprocess with stdin JSON config."""
    proc = subprocess.run(
        [sys.executable, "-m", "src.engine.compliance.compliance_gate"],
        input=json.dumps(config),
        cwd=str(PROJECT_ROOT),
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert proc.returncode == 0, (
        f"compliance_gate.py CLI exited {proc.returncode}. "
        f"stdout={proc.stdout!r} stderr={proc.stderr[-2000:]!r}"
    )
    return json.loads(proc.stdout)


def test_check_kill_switch_runs_without_ruleset():
    """D6 kill switch (ruleset-independent) must run its real check even
    when no `ruleset` key is present in the config — it never needed one."""
    config = {
        "action": "check_kill_switch",
        "firm": "topstep",
        # deliberately NO "ruleset" key at all
        "sessionId": "sess-1",
        "firmKey": "topstep",
        "currentDailyPnl": -1000.0,
        "dailyLossLimit": 1000.0,  # daily_pnl_pct = -1.0 -> force-close breach
        "tradesToday": 3,
        "consecutiveLosses": 0,
    }
    result = _run_compliance_gate_cli(config)

    assert "status" not in result or result.get("status") != "no_ruleset", (
        f"check_kill_switch was short-circuited to no_ruleset despite being "
        f"ruleset-independent: {result}"
    )
    assert "tripped" in result, f"expected a real kill-switch verdict, got {result}"
    assert result["tripped"] is True
    assert result["force_close"] is True


def test_check_kill_switch_runs_without_ruleset_key_present_but_empty():
    """Same as above but with an explicit empty `ruleset: {}` — must also
    run the real check, not the no_ruleset fallback."""
    config = {
        "action": "check_kill_switch",
        "firm": "topstep",
        "ruleset": {},
        "sessionId": "sess-2",
        "firmKey": "topstep",
        "currentDailyPnl": -100.0,
        "dailyLossLimit": 1000.0,  # daily_pnl_pct = -0.10 -> no trip
        "tradesToday": 1,
        "consecutiveLosses": 0,
    }
    result = _run_compliance_gate_cli(config)

    assert result.get("status") != "no_ruleset"
    assert "tripped" in result
    assert result["tripped"] is False


def test_check_freshness_still_short_circuits_without_ruleset():
    """check_freshness IS ruleset-dependent — the no_ruleset short-circuit
    must still apply here. Guards against over-widening the fix."""
    config = {
        "action": "check_freshness",
        "firm": "mffu",
        # no "ruleset" key
        "context": "active_trading",
    }
    result = _run_compliance_gate_cli(config)

    assert result.get("status") == "no_ruleset"
    assert result.get("fresh") is False


def test_check_two_percent_rule_runs_without_ruleset():
    """Ruleset-independent pre-order gate — must run for real."""
    config = {
        "action": "check_two_percent_rule",
        "firm": "mffu",
        "intendedMaxLoss": 3000.0,
        "accountBalance": 100000.0,  # 3% > 2% threshold -> should flag
        "pctThreshold": 0.02,
    }
    result = _run_compliance_gate_cli(config)

    assert result.get("status") != "no_ruleset"
    assert "allowed" in result


def test_check_strategy_compliance_runs_without_ruleset():
    """Sibling MED finding (multi-firm-promotion-service.ts::checkFirmEligibility):
    check_strategy_compliance takes `strategy` + `firm_rules`, never `ruleset` —
    it is ruleset-independent. Before this HIGH fix, the unconditional
    short-circuit made EVERY firm-eligibility check return the no_ruleset
    envelope (no `result` key), which multi-firm-promotion-service.ts's
    `result.result === "pass" || result.result === "needs_review"` check reads
    as `undefined === ...` -> always false -> every strategy marked ineligible
    for every firm. This resolves as a side effect of the compliance_gate.py
    fix alone; no change to multi-firm-promotion-service.ts was needed since
    it never had a `ruleset` field to pass in the first place."""
    config = {
        "action": "check_strategy_compliance",
        "firm": "mffu",
        # deliberately NO "ruleset" key
        "strategy": {"max_drawdown": 1000, "daily_loss": 200},
        "firm_rules": {"max_drawdown_limit": 2000},
    }
    result = _run_compliance_gate_cli(config)

    assert result.get("status") != "no_ruleset"
    assert result.get("result") in ("pass", "fail", "needs_review")
