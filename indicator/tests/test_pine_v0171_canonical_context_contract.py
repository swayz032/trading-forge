from pathlib import Path


SRC = Path("indicator/pine/slumdawg_platform_parity_v0_17_1_canonical_context_tp_candles.pine")


def text():
    return SRC.read_text(encoding="utf-8")


def test_v0171_rejects_weighted_direction_vote():
    s = text()
    assert "weightedDirectionScore" not in s
    assert "bigProtectedLevel" in s
    assert "BEARISH STATE PERSISTS THROUGH PULLBACK" in s
    assert "PROTECTED HIGH BROKEN + BULLISH 4H CONFIRMED" in s


def test_v0171_current_move_is_bos_persistent_not_latest_pivot_timestamp():
    s = text()
    assert "most recent pivot" not in s.lower()
    assert "BULLISH 15M BOS" in s
    assert "BEARISH LEG BELOW LOWER-HIGH PROTECTION" in s


def test_v0171_tp_has_multiple_candidate_lanes_and_explicit_missing_reason():
    s = text()
    assert "Lane A: primary 15m shelf evidence" in s
    assert "Lane B: dense 5m reaction fallback" in s
    assert "Lanes C/D: major HTF reaction candidates" in s
    assert '"60"' in s and '"240"' in s
    assert "NO QUALIFIED TP SHELF AFTER FULL SEARCH" in s
    assert "🎯 TAKE PROFIT ZONE 2" in s
    assert "🎯 TAKE PROFIT ZONE 3" in s


def test_v0171_keeps_standard_and_momentum_entry_lanes_separate():
    s = text()
    assert "proof -> reference -> BREAK -> PUSH1 -> quality PUSH2 -> READY" in s
    assert "qualifiedMomentumEntry" in s
    assert "⚡ QUALIFIED MOMENTUM ENTRY" in s
    assert "Slumdawg STANDARD ENTRY READY" in s
    assert "Slumdawg RESEARCH MOMENTUM ENTRY" in s


def test_v0171_panel_reads_canonical_states_and_has_requested_rows():
    s = text()
    for label in (
        "🤖 SLUMDAWG TRADERS",
        "BIG DIRECTION",
        "CURRENT MOVE",
        "ACTIVE PLAN",
        "🟢 LONG ENTRY",
        "🔴 SHORT ENTRY",
        "🎯 TP1",
        "🎯 TP2",
        "🎯 TP3",
        "🕯️ CANDLE SETUP",
    ):
        assert label in s
