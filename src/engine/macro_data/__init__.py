"""C11 Macro Data Package — ingestion adapters for macro regime overlay.

Provides thin wrappers around the existing macro data clients in
src/data/macro/, surfacing the 10 empirically-validated series used by
the 4-state HMM macro regime classifier.

Series (C11 spec):
  FRED daily (4 PM ET):
    T10Y2Y, DFF, USEPUINDXD, VIXCLS, DTWEXBGS, RRPONTSYD
  H.4.1 weekly (Friday):
    WTREGEN (TGA), RRPONTSYD (RRP) — from Fed H.4.1 release
  BLS monthly (release days 8:35 AM ET):
    NAPM (ISM), NFP, CPI, AHE, JOLTS
  TreasuryDirect (as-published):
    Auction tail, indirect bidder %

All clients use free government APIs (no paid service required).
"""

from src.engine.macro_data.bls_ingestion import pull_bls_release
from src.engine.macro_data.fred_ingestion import pull_fred_daily
from src.engine.macro_data.h41_ingestion import pull_h41_rrp_tga
from src.engine.macro_data.treasury_auction_ingestion import pull_treasury_auctions

__all__ = [
    "pull_fred_daily",
    "pull_bls_release",
    "pull_h41_rrp_tga",
    "pull_treasury_auctions",
]
