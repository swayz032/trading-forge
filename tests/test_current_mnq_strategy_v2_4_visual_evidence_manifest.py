from __future__ import annotations

import json
from pathlib import Path


MANIFEST = (
    Path(__file__).resolve().parents[1]
    / "research"
    / "current_mnq_strategy_v2_4_visual_evidence_manifest_2026_08_20.json"
)


def load():
    return json.loads(MANIFEST.read_text())


def test_screenshot_archive_is_exact_closed_world_65_file_corpus():
    m = load()
    s = m["screenshot_corpus"]
    assert s["source_archive"] == "Trading screenshots (5).zip"
    assert s["archive_sha256"] == "da25a0577a1317d3282aa40e7da9da60d36a0416319d8f452cee021a442c9f17"
    assert s["count"] == 65
    assert len(s["filenames"]) == 65
    assert len(set(s["filenames"])) == 65
    assert m["provenance_rules"]["closed_world"] is True
    assert m["provenance_rules"]["broad_library_search_cannot_add_authority"] is True
    assert m["provenance_rules"]["same_symbol_MNQ_is_not_sufficient_provenance"] is True


def test_direct_1m_5m_15m_clarification_images_are_hash_bound():
    rows = {x["name"]: x for x in load()["screenshot_corpus"]["directly_verified_pair"]}
    assert rows["Screenshot 2026-08-20 231718.png"]["sha256"] == "8e460dce9bfab2a8de4e216ced02a5d16efae1cafabaea4e531e8120149b773b"
    assert rows["Screenshot 2026-08-20 231723.png"]["sha256"] == "85d8d8e94384ed06c7df4e3d8b636c6023216fc577ab69b8bc8d9d0f3c80a985"
    assert rows["Screenshot 2026-08-20 232649.png"]["sha256"] == "383f04dbb0b606d8a5e0541f34a4d6f5093aada9e02627fb3cb859c02370fc6d"


def test_verified_video_corpus_is_bound_and_scope_excludes_named_daily_weekly_levels():
    m = load()
    videos = {x["name"]: x["sha256"] for x in m["verified_video_corpus"]}
    assert videos == {
        "Desktop 2026.08.19 - 02.12.06.01.mp4": "1e39083c6a8078022b5c84827b63e5b63908979177407d1868521934d48d3733",
        "Desktop 2026.08.19 - 02.13.19.02.mp4": "95bcbb3f7bf3893385f77eb612e2bbb82e772c546d53a3a9a816c1f4e1ce4f00",
        "Desktop 2026.08.20 - 20.37.47.04.mp4": "218ca9bb827db2c540d19782f6cef2227e45492a1a04b847dd78a6b3e23cda72",
    }
    scope = m["strategy_scope_confirmed_2026_08_20"]
    assert set(scope["forbidden_named_levels"]) == {"PDH", "PDL", "PWH", "PWL"}
    assert "active_15m_FVG_midpoint" in scope["tp_destinations"]
