from pathlib import Path


ENTRY = Path("indicator/fxr/slumdawg_v2_entry_tp_15m_v0_2.fxr.js")
MACRO = Path("indicator/fxr/slumdawg_v2_macro_daily_v0_2.fxr.js")
CONTEXT4H = Path("indicator/fxr/slumdawg_v2_context_4h.fxr.js")
DOC = Path("indicator/fxr/V2_BUNDLE.md")


def test_fxr_v2_entry_uses_one_15m_mtf_request_and_keeps_chart_5m_fallback():
    s = ENTRY.read_text(encoding="utf-8")
    assert s.count('mtf.timeframe("15")') == 1
    assert s.count("mtf.timeframe(") == 1
    assert 'collectDirectionalReactions("15"' in s
    assert 'collectDirectionalReactions("5"' in s
    assert "longRows" in s and "shortRows" in s
    assert "MAX_15_SIDE_REACTIONS" in s
    assert "MAX_5_SIDE_REACTIONS" in s
    assert "🟢 LONG - ENTRY ZONE" in s
    assert "🔴 SHORT - ENTRY ZONE" in s
    assert "🎯 LONG TAKE PROFIT ZONE" in s
    assert "🎯 SHORT TAKE PROFIT ZONE" in s


def test_fxr_v2_entry_preserves_bos_and_standard_entry_state():
    s = ENTRY.read_text(encoding="utf-8")
    assert "currentMove" in s
    assert "if (finite(c) && c > h0) currentMove = 1" in s
    assert "if (finite(c) && c < l0)" in s
    assert 'entryStage = "WAIT_PROOF"' in s
    assert 'entryStage = "BREAK"' in s
    assert 'entryStage = "PUSH_1"' in s
    assert 'entryStage = "ENTRY_READY"' in s


def test_fxr_daily_macro_helper_is_separate_authority():
    s = MACRO.read_text(encoding="utf-8")
    assert s.count('mtf.timeframe("D")') == 1
    assert s.count("mtf.timeframe(") == 1
    assert "protectedLevel" in s
    assert "📉 BIG DIRECTION DOWN — DAILY MACRO" in s
    assert "📈 BIG DIRECTION UP — DAILY MACRO" in s


def test_fxr_bundle_keeps_4h_helper_non_authoritative_and_documents_parity_limit():
    s = DOC.read_text(encoding="utf-8")
    assert "macro BIG DIRECTION authority" in s
    assert "it is **not** the macro authority" in s
    assert "full one-panel Python/Pine/FXR parity remains a certification blocker" in s
    assert "above-entry and below-entry shelves cannot consume each other's history budget" in s
    assert CONTEXT4H.exists()
