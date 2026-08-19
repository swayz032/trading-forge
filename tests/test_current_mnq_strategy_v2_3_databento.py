from __future__ import annotations

import pandas as pd

from research import current_mnq_strategy_v2_3_databento as dbsrc


class FakeStore:
    def __init__(self, df):
        self.df = df
    def to_df(self):
        return self.df.copy()


def test_databento_raw_symbol_is_explicit_contract_not_vendor_continuous():
    assert dbsrc.databento_raw_symbol("CON.F.US.MNQ.H26") == "MNQH6"
    assert dbsrc.databento_raw_symbol("CON.F.US.MNQ.M26") == "MNQM6"
    assert dbsrc.databento_raw_symbol("CON.F.US.MNQ.U25") == "MNQU5"
    assert dbsrc.databento_raw_symbol("CON.F.US.MNQ.Z24") == "MNQZ4"


def test_databento_ohlcv_frame_preserves_canonical_contract_and_tick_grid():
    idx = pd.DatetimeIndex([
        "2026-03-13T13:30:00Z",
        "2026-03-13T13:31:00Z",
    ], name="ts_event")
    source = pd.DataFrame({
        "open": [20000.0, 20000.25],
        "high": [20000.5, 20000.75],
        "low": [19999.75, 20000.0],
        "close": [20000.25, 20000.5],
        "volume": [10, 20],
        "instrument_id": [123, 123],
    }, index=idx)
    out = dbsrc._to_frame(FakeStore(source), "CON.F.US.MNQ.H26", "MNQH6")
    assert list(out.contract_id.unique()) == ["CON.F.US.MNQ.H26"]
    assert list(out.raw_symbol.unique()) == ["MNQH6"]
    assert out.datetime.dt.tz is not None
    assert out.close.tolist() == [20000.25, 20000.5]
