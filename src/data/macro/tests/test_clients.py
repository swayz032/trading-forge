"""
Tests for FRED, BLS, and EIA macro data clients.
All API calls are mocked -- no real HTTP requests.
"""

from __future__ import annotations

import json
import unittest
from io import BytesIO
from unittest.mock import MagicMock, patch

from src.data.macro.fred_client import FRED_SERIES, fetch_all_macro, fetch_series, get_latest_values
from src.data.macro.bls_client import BLS_SERIES, fetch_all_bls, fetch_bls_series
from src.data.macro.eia_client import EIA_SERIES, fetch_all_eia, fetch_eia_series


def _mock_response(data: dict, status: int = 200) -> MagicMock:
    """Create a mock HTTP response with JSON data."""
    body = json.dumps(data).encode("utf-8")
    mock = MagicMock()
    mock.read.return_value = body
    mock.__enter__ = lambda s: s
    mock.__exit__ = lambda s, *a: None
    mock.status = status
    return mock


# ─── FRED Client Tests ──────────────────────────────────────────

class TestFredClient(unittest.TestCase):

    @patch("src.data.macro.fred_client.urlopen")
    def test_fetch_series_basic(self, mock_urlopen):
        """FRED client returns parsed observations."""
        mock_urlopen.return_value = _mock_response({
            "observations": [
                {"date": "2025-01-01", "value": "4.33"},
                {"date": "2025-01-02", "value": "4.35"},
                {"date": "2025-01-03", "value": "4.31"},
            ]
        })

        result = fetch_series("DGS10", api_key="test_key")
        self.assertEqual(len(result), 3)
        self.assertEqual(result[0]["date"], "2025-01-01")
        self.assertAlmostEqual(result[0]["value"], 4.33)

    @patch("src.data.macro.fred_client.urlopen")
    def test_fetch_series_handles_missing_values(self, mock_urlopen):
        """FRED client filters out '.' missing value markers."""
        mock_urlopen.return_value = _mock_response({
            "observations": [
                {"date": "2025-01-01", "value": "4.33"},
                {"date": "2025-01-02", "value": "."},
                {"date": "2025-01-03", "value": ""},
                {"date": "2025-01-04", "value": "4.35"},
                {"date": "2025-01-05", "value": None},
            ]
        })

        result = fetch_series("DGS10", api_key="test_key")
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]["date"], "2025-01-01")
        self.assertEqual(result[1]["date"], "2025-01-04")

    @patch("src.data.macro.fred_client.urlopen")
    def test_fetch_series_empty_response(self, mock_urlopen):
        """FRED client handles empty observations list."""
        mock_urlopen.return_value = _mock_response({"observations": []})

        result = fetch_series("DGS10", api_key="test_key")
        self.assertEqual(result, [])

    def test_fetch_series_no_api_key(self):
        """FRED client raises ValueError without API key."""
        with patch.dict("os.environ", {}, clear=True):
            with self.assertRaises(ValueError):
                fetch_series("DGS10")

    @patch("src.data.macro.fred_client.urlopen")
    def test_fetch_all_macro(self, mock_urlopen):
        """fetch_all_macro returns dict for all series."""
        mock_urlopen.return_value = _mock_response({
            "observations": [
                {"date": "2025-01-01", "value": "4.33"},
            ]
        })

        result = fetch_all_macro(lookback_days=30, api_key="test_key")
        # Should have an entry for every configured series
        for name in FRED_SERIES:
            self.assertIn(name, result)

    @patch("src.data.macro.fred_client.urlopen")
    def test_get_latest_values(self, mock_urlopen):
        """get_latest_values returns most recent value per series."""
        mock_urlopen.return_value = _mock_response({
            "observations": [
                {"date": "2025-01-01", "value": "3.50"},
                {"date": "2025-01-15", "value": "3.75"},
            ]
        })

        result = get_latest_values(api_key="test_key")
        for name in FRED_SERIES:
            self.assertIn(name, result)
            # All should have the latest value (3.75)
            self.assertAlmostEqual(result[name], 3.75)


# ─── BLS Client Tests ──────────────────────────────────────────

class TestBlsClient(unittest.TestCase):

    @patch("src.data.macro.bls_client.urlopen")
    def test_fetch_bls_series_basic(self, mock_urlopen):
        """BLS client parses response format correctly."""
        mock_urlopen.return_value = _mock_response({
            "status": "REQUEST_SUCCEEDED",
            "Results": {
                "series": [
                    {
                        "seriesID": "CUSR0000SA0",
                        "data": [
                            {"year": "2025", "period": "M01", "value": "310.5"},
                            {"year": "2025", "period": "M02", "value": "312.1"},
                            {"year": "2024", "period": "M12", "value": "308.9"},
                        ],
                    }
                ]
            }
        })

        result = fetch_bls_series(["CUSR0000SA0"], start_year=2024, end_year=2025)
        self.assertIn("CUSR0000SA0", result)
        obs = result["CUSR0000SA0"]
        self.assertEqual(len(obs), 3)
        # Should be sorted chronologically
        self.assertEqual(obs[0]["date"], "2024-12-01")
        self.assertEqual(obs[1]["date"], "2025-01-01")
        self.assertEqual(obs[2]["date"], "2025-02-01")

    @patch("src.data.macro.bls_client.urlopen")
    def test_fetch_bls_skips_annual_average(self, mock_urlopen):
        """BLS client skips M13 (annual average) entries."""
        mock_urlopen.return_value = _mock_response({
            "status": "REQUEST_SUCCEEDED",
            "Results": {
                "series": [
                    {
                        "seriesID": "CUSR0000SA0",
                        "data": [
                            {"year": "2025", "period": "M01", "value": "310.5"},
                            {"year": "2024", "period": "M13", "value": "305.0"},
                        ],
                    }
                ]
            }
        })

        result = fetch_bls_series(["CUSR0000SA0"])
        self.assertEqual(len(result["CUSR0000SA0"]), 1)

    @patch("src.data.macro.bls_client.urlopen")
    def test_fetch_bls_error_status(self, mock_urlopen):
        """BLS client raises on non-success status."""
        mock_urlopen.return_value = _mock_response({
            "status": "REQUEST_FAILED",
            "message": ["Invalid series ID"],
        })

        with self.assertRaises(RuntimeError):
            fetch_bls_series(["INVALID"])

    @patch("src.data.macro.bls_client.urlopen")
    def test_fetch_bls_quarterly_period(self, mock_urlopen):
        """BLS client parses quarterly period codes."""
        mock_urlopen.return_value = _mock_response({
            "status": "REQUEST_SUCCEEDED",
            "Results": {
                "series": [
                    {
                        "seriesID": "TEST",
                        "data": [
                            {"year": "2025", "period": "Q01", "value": "100.0"},
                            {"year": "2025", "period": "Q02", "value": "101.0"},
                        ],
                    }
                ]
            }
        })

        result = fetch_bls_series(["TEST"])
        obs = result["TEST"]
        self.assertEqual(obs[0]["date"], "2025-01-01")
        self.assertEqual(obs[1]["date"], "2025-04-01")

    @patch("src.data.macro.bls_client.urlopen")
    def test_fetch_all_bls(self, mock_urlopen):
        """fetch_all_bls maps series IDs back to friendly names."""
        series_data = []
        for sid in BLS_SERIES.values():
            series_data.append({
                "seriesID": sid,
                "data": [
                    {"year": "2025", "period": "M01", "value": "100.0"},
                ],
            })

        mock_urlopen.return_value = _mock_response({
            "status": "REQUEST_SUCCEEDED",
            "Results": {"series": series_data}
        })

        result = fetch_all_bls(start_year=2025, end_year=2025)
        for name in BLS_SERIES:
            self.assertIn(name, result)


# ─── EIA Client Tests ──────────────────────────────────────────

class TestEiaClient(unittest.TestCase):

    @patch("src.data.macro.eia_client.urlopen")
    def test_fetch_eia_series_basic(self, mock_urlopen):
        """EIA client parses v2 API response format."""
        mock_urlopen.return_value = _mock_response({
            "response": {
                "data": [
                    {"period": "2025-01-15", "value": 75.32},
                    {"period": "2025-01-16", "value": 74.88},
                    {"period": "2025-01-17", "value": 76.01},
                ]
            }
        })

        result = fetch_eia_series("PET.RWTC.D", api_key="test_key")
        self.assertEqual(len(result), 3)
        self.assertEqual(result[0]["date"], "2025-01-15")
        self.assertAlmostEqual(result[0]["value"], 75.32)

    @patch("src.data.macro.eia_client.urlopen")
    def test_fetch_eia_handles_null_values(self, mock_urlopen):
        """EIA client filters out null and empty values."""
        mock_urlopen.return_value = _mock_response({
            "response": {
                "data": [
                    {"period": "2025-01-15", "value": 75.32},
                    {"period": "2025-01-16", "value": None},
                    {"period": "2025-01-17", "value": ""},
                    {"period": "2025-01-18", "value": 76.01},
                ]
            }
        })

        result = fetch_eia_series("PET.RWTC.D", api_key="test_key")
        self.assertEqual(len(result), 2)

    @patch("src.data.macro.eia_client.urlopen")
    def test_fetch_eia_empty_response(self, mock_urlopen):
        """EIA client handles empty data response."""
        mock_urlopen.return_value = _mock_response({
            "response": {"data": []}
        })

        result = fetch_eia_series("PET.RWTC.D", api_key="test_key")
        self.assertEqual(result, [])

    def test_fetch_eia_no_api_key(self):
        """EIA client raises ValueError without API key."""
        with patch.dict("os.environ", {}, clear=True):
            with self.assertRaises(ValueError):
                fetch_eia_series("PET.RWTC.D")

    @patch("src.data.macro.eia_client.urlopen")
    def test_fetch_all_eia(self, mock_urlopen):
        """fetch_all_eia returns dict for all configured series."""
        mock_urlopen.return_value = _mock_response({
            "response": {
                "data": [
                    {"period": "2025-01-15", "value": 75.32},
                ]
            }
        })

        result = fetch_all_eia(lookback_days=30, api_key="test_key")
        for name in EIA_SERIES:
            self.assertIn(name, result)


if __name__ == "__main__":
    unittest.main()
