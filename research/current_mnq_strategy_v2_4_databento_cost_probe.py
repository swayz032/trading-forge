#!/usr/bin/env python3
"""Estimate Databento cost for the frozen v2.4 clean MNQ history request.

This script performs metadata cost queries only. It downloads no market data and
never prints the API key. Databento reads DATABENTO_API_KEY from the environment.
"""
from __future__ import annotations

import json
from datetime import date, timedelta

from research.current_mnq_strategy_v2_2_contracts import projectx_contract_id
from research.current_mnq_strategy_v2_3_data import contract_windows
from research.current_mnq_strategy_v2_3_databento import (
    DATASET, MNQ_LAUNCH, SCHEMA, databento_raw_symbol,
)

CLEAN_END = date(2021, 12, 31)


def estimate_clean_history_cost() -> dict:
    try:
        import databento as db
    except ImportError as exc:
        raise RuntimeError(
            "DATABENTO_SDK_MISSING: install research/mnq_v23_databento_requirements.txt"
        ) from exc

    client = db.Historical()
    windows = contract_windows(MNQ_LAUNCH, CLEAN_END, overlap_days=7)
    rows = []
    total_ohlcv = 0.0
    total_definition = 0.0
    for w in windows:
        symbol = databento_raw_symbol(w.contract_id)
        start = max(MNQ_LAUNCH, w.start)
        end = w.end + timedelta(days=1)
        ohlcv = float(client.metadata.get_cost(
            dataset=DATASET, symbols=[symbol], schema=SCHEMA,
            stype_in="raw_symbol", start=str(start), end=str(end),
        ))
        # Definition cost is included because the collector uses it as a source-
        # identity witness. Query full-day boundaries for accurate estimation.
        definition = float(client.metadata.get_cost(
            dataset=DATASET, symbols=[symbol], schema="definition",
            stype_in="raw_symbol", start=str(start), end=str(end),
        ))
        total_ohlcv += ohlcv
        total_definition += definition
        rows.append({
            "projectx_contract_id": w.contract_id,
            "databento_raw_symbol": symbol,
            "start": str(start), "end_exclusive": str(end),
            "ohlcv_1m_cost_usd": ohlcv,
            "definition_cost_usd": definition,
        })

    return {
        "dataset": DATASET,
        "schema": SCHEMA,
        "clean_scope_start": str(MNQ_LAUNCH),
        "clean_scope_end": str(CLEAN_END),
        "contracts": len(rows),
        "ohlcv_1m_cost_usd": total_ohlcv,
        "definition_cost_usd": total_definition,
        "estimated_total_usd": total_ohlcv + total_definition,
        "download_performed": False,
        "rows": rows,
    }


if __name__ == "__main__":
    print(json.dumps(estimate_clean_history_cost(), indent=2, sort_keys=True))
