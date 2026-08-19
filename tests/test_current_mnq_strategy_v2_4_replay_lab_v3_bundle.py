from pathlib import Path

from research.current_mnq_strategy_v2_4_replay_lab_v3_bundle import bundle


def test_v3_bundle_inlines_required_browser_runtimes(tmp_path):
    html = tmp_path / "review_v3.html"
    lwc = tmp_path / "lightweight-charts.standalone.production.js"
    enhance = tmp_path / "replay_v3_enhance.js"
    html.write_text(
        '<html><head><script src="lightweight-charts.standalone.production.js"></script></head>'
        '<body><script src="replay_v3_enhance.js"></script></body></html>',
        encoding="utf-8",
    )
    lwc.write_text("window.LightweightCharts={};", encoding="utf-8")
    enhance.write_text(
        "if (l.final_action) return; /* RESET DECISION */",
        encoding="utf-8",
    )
    out = bundle(html, lwc, enhance)
    assert 'src="lightweight-charts.standalone.production.js"' not in out
    assert 'src="replay_v3_enhance.js"' not in out
    assert "window.LightweightCharts={};" in out
    assert "RESET DECISION" in out
    assert "if (l.final_action) return;" in out


def test_v3_generator_explicitly_excludes_all_prior_v2_review_sessions():
    text = Path("research/current_mnq_strategy_v2_4_replay_lab_v3_generate.py").read_text()
    for session in (
        "2026-03-23", "2026-03-24", "2026-03-25", "2026-03-26",
        "2026-03-30", "2026-03-31", "2026-04-01", "2026-04-02",
    ):
        assert session in text
    assert "PRIOR_V2_REVIEW_SESSIONS" in text
    assert "REPLAY_V3_PRIOR_SESSION_REUSE" in text
    assert '"prior_v2_session_overlap_count": 0' in text
