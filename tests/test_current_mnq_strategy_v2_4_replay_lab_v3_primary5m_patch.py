from pathlib import Path

from research.current_mnq_strategy_v2_4_replay_lab_v3_primary5m_patch import (
    OLD_OVERLAYS,
    READY,
    patch_html,
)


def test_primary5m_patch_relabels_entry_role_and_renders_15m_fvg_context():
    base = f"""<html><body>
<script>
{OLD_OVERLAYS}
panel5.querySelector('h3').textContent = 'Main Structure / Key Zones + TP Reaction Cluster';
const warn = document.querySelector('.warn');
warn.innerHTML = 'The bottom chart is only for 1m force and exact entry timing.';
document.title = 'MNQ Replay Lab — Unified Main + 1m Entry';
  updateMainControlStatus('READY');
}})();
</script>
<div>1m Live Force / Tug-of-War</div>
</body></html>"""
    got = patch_html(base)
    assert "5m PRIMARY ENTRY / Key Zones + TP" in got
    assert "1m BOT CAUSAL RECONSTRUCTION — DIAGNOSTIC ONLY" in got
    assert "ENTER from the 5m chart" in got
    assert "context_15m_active_fvgs_at_replay_start" in got
    assert "15m FVG MID" in got
    assert READY in got
    assert "trader_zones" in got
    assert "trader_tp_long" in got and "trader_tp_short" in got


def test_primary5m_contract_files_lock_5m_and_bilateral_context():
    req = Path("research/current_mnq_strategy_v2_4_replay_calibration_requirements.json").read_text(encoding="utf-8")
    gold = Path("research/current_mnq_strategy_v2_4_user_momentum_visual_gold.json").read_text(encoding="utf-8")
    contract = Path("research/current_mnq_strategy_v2_4_replay_lab_v3_contract.json").read_text(encoding="utf-8")
    assert '"primary_trader_entry_timeframe": "5m"' in req
    assert '"5m_is_primary_trader_entry_timeframe"' in gold
    assert '"primary_trader_entry_chart": "5m"' in contract
    assert "BOT_CAUSAL_INTRABAR" in req
    assert "ACTIVE_15M_FVG_MIDPOINT_WHEN_IT_OWNS_FIRST_REACTION" in req
    assert "AT_LEAST_ONE_CAUSAL_MEANINGFUL_REACTION_DESTINATION_ABOVE_AND_BELOW_REFERENCE_PRICE" in req
