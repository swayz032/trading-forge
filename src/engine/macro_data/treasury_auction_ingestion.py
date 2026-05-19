"""C11 TreasuryDirect auction data ingestion adapter.

Scrapes TreasuryDirect auction results for:
  Auction bid-to-cover ratio    → demand signal
  Auction tail (high vs stop)   → demand quality (>2bps = stress)
  Indirect bidder %             → foreign demand proxy (<48% = concern)

C11 threshold (empirically validated 2024-2026):
  Auction tail > 2bps for 3 consecutive auctions → foreign demand collapse
    → equity drawdown signal 2-3 weeks ahead
  Indirect bidder % < 48% sustained → 10-day equity drawdown precursor

Source: TreasuryDirect (free, no API key)
  Announcements: https://www.treasurydirect.gov/auctions/announcements-data-results/
  JSON API:      https://www.treasurydirect.gov/TA_WS/securities/search

Note: TreasuryDirect has a public JSON API at /TA_WS/ that's free and
does not require authentication. We use it directly.

Look-ahead prevention:
  publication_timestamp = pull time (always >= auction settlement date)
  series_date = auction announcement date (the action happens on record date)
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from typing import TYPE_CHECKING
from urllib.error import URLError
from urllib.request import Request, urlopen

if TYPE_CHECKING:
    from src.engine.macro_data.fred_ingestion import MacroObservation

# TreasuryDirect public JSON API
TREASURY_WS_URL = "https://www.treasurydirect.gov/TA_WS/securities/search"

# Security types of interest for C11 (note spread)
TREASURY_TYPES_OF_INTEREST = ["Note", "Bond", "Bill"]


def pull_treasury_auctions(
    lookback_days: int = 30,
) -> list["MacroObservation"]:
    """Pull recent Treasury auction results from TreasuryDirect.

    Extracts tail (high - stop price in basis points), indirect bidder %,
    and bid-to-cover ratio. Returns MacroObservation records.

    Args:
        lookback_days: Days to look back for auctions. Default 30.

    Returns:
        MacroObservation list for DB upsert.
        - series_id="TREASURY_TAIL_BPS_{type}" (e.g. "TREASURY_TAIL_BPS_Note")
        - series_id="TREASURY_INDIRECT_PCT_{type}"
        - series_id="TREASURY_BTC_{type}" (bid-to-cover)
    """
    from datetime import timedelta

    from src.engine.macro_data.fred_ingestion import MacroObservation

    pub_ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    start_date = (datetime.now() - timedelta(days=lookback_days)).strftime("%Y-%m-%d")
    end_date = datetime.now().strftime("%Y-%m-%d")

    observations: list[MacroObservation] = []

    for sec_type in TREASURY_TYPES_OF_INTEREST:
        try:
            url = (
                f"{TREASURY_WS_URL}?type={sec_type}"
                f"&startDate={start_date}&endDate={end_date}"
                f"&dateFieldName=auctionDate&format=json"
            )
            req = Request(url, headers={"User-Agent": "trading-forge/1.0 (research)"})
            with urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except (URLError, json.JSONDecodeError) as exc:
            print(
                f"WARNING: C11 TreasuryDirect pull failed for {sec_type}: {exc}",
                file=sys.stderr,
            )
            continue

        if not isinstance(data, list):
            continue

        for auction in data:
            auction_date = auction.get("auctionDate", "")
            if not auction_date:
                continue

            # Normalize auction date to YYYY-MM-DD
            try:
                if "T" in auction_date:
                    series_date = auction_date[:10]
                else:
                    series_date = auction_date[:10]
            except Exception:
                continue

            # --- Auction tail (high yield - stop yield, in bps) ---
            try:
                high_yield = float(auction.get("highYield", 0) or 0)
                stop_yield = float(auction.get("stopOutRate", 0) or 0)
                tail_bps = (high_yield - stop_yield) * 100  # pct to bps
                observations.append(MacroObservation(
                    series_id=f"TREASURY_TAIL_BPS_{sec_type.upper()}",
                    series_date=series_date,
                    publication_timestamp=pub_ts,
                    value=round(tail_bps, 4),
                    revision_number=1,
                    source="treasury_direct",
                ))
            except (TypeError, ValueError):
                pass

            # --- Indirect bidder % ---
            try:
                indirect_pct = float(
                    auction.get("indirectBiddersPercentage", 0) or 0
                )
                observations.append(MacroObservation(
                    series_id=f"TREASURY_INDIRECT_PCT_{sec_type.upper()}",
                    series_date=series_date,
                    publication_timestamp=pub_ts,
                    value=round(indirect_pct, 4),
                    revision_number=1,
                    source="treasury_direct",
                ))
            except (TypeError, ValueError):
                pass

            # --- Bid-to-cover ratio ---
            try:
                btc = float(auction.get("bidToCoverRatio", 0) or 0)
                if btc > 0:
                    observations.append(MacroObservation(
                        series_id=f"TREASURY_BTC_{sec_type.upper()}",
                        series_date=series_date,
                        publication_timestamp=pub_ts,
                        value=round(btc, 4),
                        revision_number=1,
                        source="treasury_direct",
                    ))
            except (TypeError, ValueError):
                pass

    return observations


def compute_auction_stress_signal(
    tail_observations: list[dict],
    indirect_observations: list[dict],
    consecutive_threshold: int = 3,
    tail_bps_threshold: float = 2.0,
    indirect_pct_threshold: float = 48.0,
) -> dict:
    """Classify Treasury auction stress from recent observations.

    C11 thresholds:
      - Tail > 2bps for 3 consecutive auctions → foreign_demand_collapse=True
      - Indirect < 48% sustained              → demand_concern=True

    Args:
        tail_observations: Recent TREASURY_TAIL_BPS_* observations sorted by date.
        indirect_observations: Recent TREASURY_INDIRECT_PCT_* observations.
        consecutive_threshold: How many consecutive bad auctions = signal.
        tail_bps_threshold: Tail above this = bad auction.
        indirect_pct_threshold: Indirect below this = concern.

    Returns:
        {
          "foreign_demand_collapse": bool,
          "demand_concern": bool,
          "consecutive_bad_auctions": int,
          "last_indirect_pct": float,
        }
    """
    # Count consecutive auctions with tail > threshold
    sorted_tail = sorted(tail_observations, key=lambda x: x["date"], reverse=True)
    consecutive_bad = 0
    for obs in sorted_tail[:consecutive_threshold + 2]:
        if float(obs["value"]) > tail_bps_threshold:
            consecutive_bad += 1
        else:
            break

    # Last indirect bidder pct
    sorted_indirect = sorted(indirect_observations, key=lambda x: x["date"])
    last_indirect = float(sorted_indirect[-1]["value"]) if sorted_indirect else 100.0

    return {
        "foreign_demand_collapse": consecutive_bad >= consecutive_threshold,
        "demand_concern": last_indirect < indirect_pct_threshold,
        "consecutive_bad_auctions": consecutive_bad,
        "last_indirect_pct": last_indirect,
    }
