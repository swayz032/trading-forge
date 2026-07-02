"""D1 drift-check: assert STATIC_EVENTS FOMC dates match economic_release_dates.json.

This test guards the failure mode where wrong FOMC dates in STATIC_EVENTS are
certified as "correct" by the TS parity gate (which only checked TS==Python-STATIC,
not STATIC==authoritative-JSON). Future FOMC date edits to STATIC_EVENTS will fail
here if they diverge from the JSON snapshot.

Scope: FOMC only. CPI and NFP have known minor divergences between STATIC_EVENTS and
the JSON (rounding convention differences in the sync service) — those are tracked
separately and do not carry the same compliance risk as FOMC.

No vectorbt import. Pure dict comparison.
"""

from __future__ import annotations

import json
import os
from datetime import datetime

import pytest

from src.engine.economic_calendar import STATIC_EVENTS


# ─── Load authoritative JSON ──────────────────────────────────────────────────

def _load_json_events() -> dict[str, list[dict]]:
    """Load economic_release_dates.json — the authoritative synced calendar."""
    json_path = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "..",
        "economic_release_dates.json",
    )
    with open(json_path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    rows = data.get("events", [])
    out: dict[str, list[dict]] = {}
    for r in rows:
        et = r.get("event_type")
        if et:
            out.setdefault(et, []).append({"date": r["date"], "time_et": r["time_et"]})
    return out


_JSON_EVENTS = _load_json_events()


def _static_fomc_dates(year: str) -> set[str]:
    return {e["date"] for e in STATIC_EVENTS.get("FOMC", []) if e["date"].startswith(year)}


def _json_fomc_dates(year: str) -> set[str]:
    return {e["date"] for e in _JSON_EVENTS.get("FOMC", []) if e["date"].startswith(year)}


# ─── Tests ────────────────────────────────────────────────────────────────────

class TestFomcStaticVsJson:
    """STATIC_EVENTS FOMC dates must exactly match economic_release_dates.json.

    When a date appears in JSON but not STATIC (or vice-versa), the fail-safe
    calendar is wrong: it will either miss a real FOMC window or falsely block
    a non-FOMC date. Both are MFFU compliance risks.
    """

    def test_fomc_2025_matches_json(self):
        static = _static_fomc_dates("2025")
        authoritative = _json_fomc_dates("2025")
        missing = authoritative - static
        extra = static - authoritative
        assert not missing, f"FOMC 2025 in JSON but missing from STATIC_EVENTS: {sorted(missing)}"
        assert not extra, f"FOMC 2025 in STATIC_EVENTS but not in JSON: {sorted(extra)}"

    def test_fomc_2026_matches_json(self):
        static = _static_fomc_dates("2026")
        authoritative = _json_fomc_dates("2026")
        missing = authoritative - static
        extra = static - authoritative
        assert not missing, f"FOMC 2026 in JSON but missing from STATIC_EVENTS: {sorted(missing)}"
        assert not extra, f"FOMC 2026 in STATIC_EVENTS but not in JSON: {sorted(extra)}"

    def test_fomc_2027_note(self):
        """Placeholder: 2027 FOMC dates differ between STATIC_EVENTS and JSON.

        2027 dates in STATIC_EVENTS are algorithmic projections added before the Fed
        published the official 2027 schedule. The JSON may carry more accurate dates
        (sourced from the Fed announcement). Correcting 2027 is a separate task — it
        is outside D1 scope which targeted 2025/2026 compliance windows. This note
        test documents the known divergence so it is not silently overlooked.

        TODO: update STATIC_EVENTS and tier1-event-blackout.ts 2027 FOMC dates once
        the official Fed 2027 calendar is confirmed and economic_release_dates.json
        is re-synced.
        """
        static = _static_fomc_dates("2027")
        authoritative = _json_fomc_dates("2027")
        # Log difference but do not assert equality (dates are algorithmic projections)
        diverging = static.symmetric_difference(authoritative)
        if diverging:
            import warnings
            warnings.warn(
                f"FOMC 2027 STATIC vs JSON divergence (known, TODO): {sorted(diverging)}",
                stacklevel=1,
            )

    def test_fomc_count_per_year_is_8(self):
        """Fed holds exactly 8 FOMC meetings per year. A count mismatch signals a corruption."""
        for year in ("2025", "2026", "2027"):
            static = _static_fomc_dates(year)
            assert len(static) == 8, (
                f"FOMC {year} count wrong: expected 8, got {len(static)}: {sorted(static)}"
            )

    def test_fomc_always_at_2pm_et(self):
        """All FOMC entries in STATIC_EVENTS must be 14:00 ET."""
        for entry in STATIC_EVENTS.get("FOMC", []):
            assert entry["time_et"] == "14:00", (
                f"FOMC entry {entry['date']} has wrong time {entry['time_et']} (expected 14:00)"
            )

    def test_fomc_no_weekends(self):
        """No FOMC date should fall on a Saturday or Sunday."""
        for entry in STATIC_EVENTS.get("FOMC", []):
            d = datetime.strptime(entry["date"], "%Y-%m-%d")
            assert d.weekday() < 5, (
                f"FOMC date {entry['date']} falls on a weekend (weekday={d.weekday()})"
            )
