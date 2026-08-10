from pathlib import Path


SRC = Path("indicator/pine/slumdawg_platform_parity_v0_17_2_macro_regime_deep_tp.pine")


def text():
    return SRC.read_text(encoding="utf-8")


def test_macro_direction_uses_daily_authority_and_slow_major_4h_structure():
    s = text()
    assert "BIG_4H_PIVOT_LEFT = 6" in s
    assert "DAILY MACRO STRUCTURE" in s
    assert "BEARISH MACRO PERSISTS THROUGH BULLISH PULLBACK" in s
    assert "weightedDirectionScore" not in s
    assert "bigAuthority" in s


def test_current_move_remains_separate_15m_bos_state():
    s = text()
    assert "BEARISH LEG BELOW LOWER-HIGH PROTECTION" in s
    assert "BULLISH 15M BOS" in s
    assert "currentMoveDir == bigDir" in s


def test_tp_collection_retains_long_and_short_histories_separately():
    s = text()
    assert "array<float> longLos" in s
    assert "array<float> shortLos" in s
    assert "recent irrelevant reactions cannot fill one shared cap" in s
    assert "f_tp_ladder_local(320, 80" in s
    assert "f_tp_ladder_local(600, 100" in s
    assert "bodyTurn" in s


def test_tp_lines_and_missing_reasons_are_explicit():
    s = text()
    assert "🎯 TAKE PROFIT ZONE 1" in s
    assert "🎯 TAKE PROFIT ZONE 2" in s
    assert "🎯 TAKE PROFIT ZONE 3" in s
    assert "TP DATA/DETECTOR UNAVAILABLE" in s
    assert "NO QUALIFIED TP SHELF AFTER DEEP SEARCH" in s
    assert "tpPenetrationFraction" in s


def test_entry_and_candle_lanes_are_preserved():
    s = text()
    assert "🟢 LONG - ENTRY ZONE" in s
    assert "🔴 SHORT - ENTRY ZONE" in s
    assert "qualifiedMomentumEntry" in s
    assert "REFERENCE ARMED" in s
    assert "PUSH_1" in s
    assert "ENTRY_READY" in s
