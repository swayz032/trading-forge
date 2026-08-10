from pathlib import Path


ENTRY = Path("indicator/fxr/slumdawg_v2_entry_tp_15m.fxr.js")
CONTEXT = Path("indicator/fxr/slumdawg_v2_context_4h.fxr.js")
DOC = Path("indicator/fxr/V2_BUNDLE.md")


def test_fxr_v2_entry_uses_one_documented_mtf_request_and_keeps_5m_fallback():
    s = ENTRY.read_text(encoding="utf-8")
    assert s.count('mtf.timeframe("15")') == 1
    assert s.count("mtf.timeframe(") == 1
    assert 'collectReactionIntervals("15"' in s
    assert 'collectReactionIntervals("5"' in s
    assert "🟢 LONG - ENTRY ZONE" in s
    assert "🔴 SHORT - ENTRY ZONE" in s
    assert "🎯 LONG TAKE PROFIT ZONE" in s
    assert "🎯 SHORT TAKE PROFIT ZONE" in s


def test_fxr_v2_entry_has_bos_persistence_and_separate_momentum_candidate():
    s = ENTRY.read_text(encoding="utf-8")
    assert "currentMove" in s
    assert "if (finite(c) && c > h0) currentMove = 1" in s
    assert "if (finite(c) && c < l0)" in s
    assert 'entryStage = "WAIT_PROOF"' in s
    assert 'entryStage = "BREAK"' in s
    assert 'entryStage = "PUSH_1"' in s
    assert "Slumdawg Momentum Candidate" in s


def test_fxr_v2_context_uses_one_4h_mtf_and_protected_structure():
    s = CONTEXT.read_text(encoding="utf-8")
    assert s.count('mtf.timeframe("240")') == 1
    assert s.count("mtf.timeframe(") == 1
    assert "protectedLevel" in s
    assert "📉 BIG DIRECTION DOWN — PROTECTED HIGH" in s
    assert "📈 BIG DIRECTION UP — PROTECTED LOW" in s


def test_fxr_bundle_documents_full_box_parity_limit_instead_of_faking_it():
    s = DOC.read_text(encoding="utf-8")
    assert "one MTF timeframe request per indicator" in s
    assert "full canonical BIG-DIRECTION/panel parity remains blocked" in s
    assert "silently approximating higher-timeframe state" in s
