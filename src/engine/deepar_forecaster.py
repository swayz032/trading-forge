"""DeepAR Regime Forecaster — Probabilistic time series forecasting for Trading Forge.

Trains on multi-instrument OHLCV + VIX data to produce forward-looking regime probabilities.
Runs locally via GluonTS (PyTorch). $0/month cost.

Governance: experimental=true, authoritative=false, decision_role=challenger_only

Usage:
    python -m src.engine.deepar_forecaster --config <json>

Config keys:
    mode: "train" | "predict"
    data_dir: str (default "./data")
    model_dir: str (default "./models/deepar")
    symbols: list[str] (default ["NQ", "ES", "CL"])
    epochs: int (default 50)
    prediction_length: int (default 5)
    context_length: int (default 60)
"""
from __future__ import annotations

import json
import math
import os
import sys
import time
from pathlib import Path
from typing import Literal, Optional

import numpy as np
from pydantic import BaseModel, Field

# ─── Optional Imports (guarded) ──────────────────────────────────

try:
    import polars as pl
    POLARS_AVAILABLE = True
except ImportError:
    pl = None  # type: ignore[assignment]
    POLARS_AVAILABLE = False

try:
    import pandas as pd
    PANDAS_AVAILABLE = True
except ImportError:
    pd = None  # type: ignore[assignment]
    PANDAS_AVAILABLE = False

try:
    import torch
    TORCH_AVAILABLE = True
except ImportError:
    torch = None  # type: ignore[assignment]
    TORCH_AVAILABLE = False

try:
    from gluonts.torch import DeepAREstimator
    from gluonts.dataset.pandas import PandasDataset
    from gluonts.torch.model.predictor import PyTorchPredictor
    GLUONTS_AVAILABLE = True
except ImportError:
    GLUONTS_AVAILABLE = False

try:
    import duckdb
    DUCKDB_AVAILABLE = True
except ImportError:
    duckdb = None  # type: ignore[assignment]
    DUCKDB_AVAILABLE = False


# ─── Governance Labels ──────────────────────────────────────────

GOVERNANCE_LABELS = {
    "experimental": True,
    "authoritative": False,
    "decision_role": "challenger_only",
    "description": "DeepAR regime forecasts are experimental — weight starts at 0.0, auto-graduates through WF+MC validation",
}


# ─── Pydantic Models ───────────────────────────────────────────

class DeepARConfig(BaseModel):
    """Configuration for DeepAR forecaster."""
    mode: Literal["train", "predict"] = "predict"
    prediction_length: int = Field(default=5, ge=1, le=30, description="Forecast 1-N days ahead")
    context_length: int = Field(default=60, ge=20, le=252, description="Lookback window in days")
    freq: str = "1D"
    num_layers: int = Field(default=2, ge=1, le=4)
    hidden_size: int = Field(default=40, ge=16, le=256)
    epochs: int = Field(default=50, ge=1, le=500)
    model_dir: str = "./models/deepar"
    data_dir: str = "./data"
    symbols: list[str] = Field(default_factory=lambda: ["NQ", "ES", "CL"])
    learning_rate: float = Field(default=1e-3, gt=0)
    batch_size: int = Field(default=32, ge=8, le=256)


class TrainingResult(BaseModel):
    """Result of DeepAR model training."""
    training_loss: float
    validation_loss: Optional[float] = None
    duration_ms: int
    model_path: str
    epochs: int
    symbols: list[str]
    data_range: Optional[dict] = None  # {"start": "2020-01-01", "end": "2024-12-31"}
    num_series: int = 0
    num_datapoints: int = 0
    gpu_used: bool = False
    governance_labels: dict = Field(default_factory=lambda: GOVERNANCE_LABELS.copy())


class RegimeForecast(BaseModel):
    """Forward-looking regime forecast for a single symbol."""
    symbol: str
    forecast_date: str  # ISO date of when forecast was generated
    prediction_horizon: int  # Number of days ahead
    # Regime probabilities (0.0-1.0)
    p_high_vol: float = Field(ge=0.0, le=1.0)
    p_trending: float = Field(ge=0.0, le=1.0)
    p_mean_revert: float = Field(ge=0.0, le=1.0)
    p_correlation_stress: float = Field(default=0.0, ge=0.0, le=1.0)
    # Confidence and quantiles
    forecast_confidence: float = Field(ge=0.0, le=1.0)
    quantile_p10: float
    quantile_p50: float
    quantile_p90: float
    # Raw quantiles for downstream consumers
    quantile_p25: Optional[float] = None
    quantile_p75: Optional[float] = None
    governance_labels: dict = Field(default_factory=lambda: GOVERNANCE_LABELS.copy())


class PredictionResult(BaseModel):
    """Aggregated prediction result for all symbols."""
    forecasts: dict[str, dict]  # symbol -> RegimeForecast.model_dump()
    model_path: str
    prediction_date: str
    duration_ms: int
    governance_labels: dict = Field(default_factory=lambda: GOVERNANCE_LABELS.copy())


# ─── Data Loading ───────────────────────────────────────────────

def _load_parquet_data(data_dir: str, symbol: str) -> Optional[pl.DataFrame]:
    """Load OHLCV data for a symbol from local Parquet files.

    Looks for files matching common conventions:
      - {data_dir}/{symbol}/consolidated/daily.parquet
      - {data_dir}/{symbol}/1D.parquet
      - {data_dir}/{symbol}.parquet
    Falls back to S3 via DuckDB if local files not found and DuckDB available.
    """
    if not POLARS_AVAILABLE:
        raise RuntimeError("Polars is required for data loading (pip install polars)")

    base = Path(data_dir)
    candidates = [
        base / symbol / "consolidated" / "daily.parquet",
        base / symbol / "consolidated" / "1D.parquet",
        base / symbol / "1D.parquet",
        base / f"{symbol}.parquet",
        base / f"{symbol}_daily.parquet",
    ]

    for path in candidates:
        if path.exists():
            df = pl.read_parquet(str(path))
            return df

    # S3 fallback via DuckDB
    if DUCKDB_AVAILABLE:
        bucket = os.environ.get("S3_BUCKET", "trading-forge-data")
        s3_path = f"s3://{bucket}/futures/{symbol}/consolidated/1D.parquet"
        try:
            con = duckdb.connect(":memory:")
            con.execute("INSTALL httpfs; LOAD httpfs;")
            con.execute("SET enable_object_cache=true;")
            region = os.environ.get("AWS_REGION", "")
            if region:
                con.execute(f"SET s3_region='{region.replace(chr(39), '')}';")
            arrow_table = con.execute(f"SELECT * FROM '{s3_path}'").fetch_arrow_table()
            df = pl.from_arrow(arrow_table)
            con.close()
            return df
        except Exception as e:
            print(f"[deepar] S3 fallback failed for {symbol}: {e}", file=sys.stderr)
            return None

    return None


def _prepare_series(
    df: pl.DataFrame,
    symbol: str,
    context_length: int,
) -> Optional[pd.DataFrame]:
    """Prepare a single symbol's data for GluonTS.

    Target: log returns of close price (stationary).
    Dynamic features: ATR(14), VIX (if available), volume_ratio, realized_vol.
    """
    if not PANDAS_AVAILABLE:
        raise RuntimeError("Pandas is required at the GluonTS boundary (pip install pandas)")

    # Normalize column names to lowercase
    df = df.rename({c: c.lower() for c in df.columns})

    required = {"close", "high", "low"}
    if not required.issubset(set(df.columns)):
        print(f"[deepar] Missing columns for {symbol}: need {required}, have {set(df.columns)}", file=sys.stderr)
        return None

    # Ensure datetime index
    date_col = None
    for candidate in ["date", "datetime", "timestamp", "ts", "time"]:
        if candidate in df.columns:
            date_col = candidate
            break

    if date_col is None:
        print(f"[deepar] No date column found for {symbol}", file=sys.stderr)
        return None

    # Sort by date
    df = df.sort(date_col)

    # Compute log returns (target — stationary)
    close = df["close"].cast(pl.Float64)
    log_returns = close.log().diff().fill_null(0.0).fill_nan(0.0)

    # ATR(14) — manual computation (avoid importing indicators for isolation)
    high = df["high"].cast(pl.Float64)
    low = df["low"].cast(pl.Float64)
    prev_close = close.shift(1)
    # pl.max_horizontal works on expressions inside select, so compute via DataFrame
    tr_df = pl.DataFrame({
        "hl": (high - low).to_list(),
        "hc": (high - prev_close).abs().to_list(),
        "lc": (low - prev_close).abs().to_list(),
    }).select(pl.max_horizontal("hl", "hc", "lc").alias("tr"))
    tr = tr_df["tr"].fill_null(0.0)
    atr_14 = tr.rolling_mean(window_size=14).fill_null(0.0).fill_nan(0.0)

    # Realized volatility: 20-day rolling std of log returns
    realized_vol = log_returns.rolling_std(window_size=20).fill_null(0.0).fill_nan(0.0)

    # Volume ratio: volume / 20-day average volume
    if "volume" in df.columns:
        vol = df["volume"].cast(pl.Float64).fill_null(0.0)
        vol_avg = vol.rolling_mean(window_size=20).fill_null(1.0)
        volume_ratio = (vol / vol_avg.clip(lower_bound=1.0)).fill_nan(1.0).fill_null(1.0)
    else:
        volume_ratio = pl.Series("volume_ratio", [1.0] * len(df))

    # VIX — check if column exists (may be joined from external data)
    if "vix" in df.columns:
        vix = df["vix"].cast(pl.Float64).fill_null(0.0).fill_nan(0.0)
    else:
        # Use realized_vol as VIX proxy (annualized)
        vix = (realized_vol * math.sqrt(252) * 100).fill_null(0.0).fill_nan(0.0)

    # Build pandas DataFrame for GluonTS
    dates = df[date_col].cast(pl.Date)
    pdf = pd.DataFrame({
        "date": dates.to_list(),
        "target": log_returns.to_list(),
        "atr_14": atr_14.to_list(),
        "vix": vix.to_list(),
        "volume_ratio": volume_ratio.to_list(),
        "realized_vol": realized_vol.to_list(),
    })
    pdf["date"] = pd.to_datetime(pdf["date"])
    pdf = pdf.set_index("date")
    pdf = pdf.asfreq("B")  # Business day frequency — fill gaps
    pdf = pdf.ffill().bfill()  # Forward then backward fill for holidays

    # Need at least context_length + some margin
    min_rows = context_length + 20
    if len(pdf) < min_rows:
        print(f"[deepar] Insufficient data for {symbol}: {len(pdf)} rows < {min_rows} required", file=sys.stderr)
        return None

    return pdf


# ─── DeepAR Forecaster ─────────────────────────────────────────

class DeepARForecaster:
    """Probabilistic time series forecaster using GluonTS DeepAR (PyTorch backend).

    Trains on multi-instrument OHLCV data to produce quantile forecasts.
    Downstream classifiers convert quantiles into regime probabilities.
    """

    def __init__(self, config: DeepARConfig):
        self.config = config
        self._predictor = None

    def train(self, data_dir: Optional[str] = None, symbols: Optional[list[str]] = None) -> TrainingResult:
        """Train DeepAR model on multi-symbol OHLCV data.

        Args:
            data_dir: Directory containing Parquet files (overrides config.data_dir)
            symbols: List of symbols to train on (overrides config.symbols)

        Returns:
            TrainingResult with training metrics and model path
        """
        if not GLUONTS_AVAILABLE:
            raise RuntimeError(
                "GluonTS PyTorch is required for training. Install: "
                "pip install 'gluonts[torch]' pytorch-lightning"
            )

        start_ms = int(time.time() * 1000)
        data_dir = data_dir or self.config.data_dir
        symbols = symbols or self.config.symbols

        # Load and prepare data for all symbols
        all_series = {}
        for symbol in symbols:
            df = _load_parquet_data(data_dir, symbol)
            if df is None:
                print(f"[deepar] Skipping {symbol}: no data found in {data_dir}", file=sys.stderr)
                continue
            pdf = _prepare_series(df, symbol, self.config.context_length)
            if pdf is not None:
                all_series[symbol] = pdf

        if not all_series:
            raise ValueError(f"No valid data found for any symbol in {data_dir}")

        # Build GluonTS PandasDataset
        # Each series is a separate item with its own item_id
        dataset_frames = []
        total_points = 0
        date_min, date_max = None, None

        for symbol, pdf in all_series.items():
            frame = pdf.copy()
            frame["item_id"] = symbol
            dataset_frames.append(frame)
            total_points += len(frame)
            if date_min is None or frame.index.min() < date_min:
                date_min = frame.index.min()
            if date_max is None or frame.index.max() > date_max:
                date_max = frame.index.max()

        combined = pd.concat(dataset_frames)
        feat_cols = ["atr_14", "vix", "volume_ratio", "realized_vol"]

        dataset = PandasDataset.from_long_dataframe(
            combined.reset_index().rename(columns={"date": "timestamp"}),
            target="target",
            item_id="item_id",
            timestamp="timestamp",
            feat_dynamic_real=feat_cols,
            freq="B",
        )

        # Detect GPU
        gpu_used = False
        trainer_kwargs = {
            "enable_progress_bar": False,  # Suppress stdout noise for subprocess JSON output
        }
        if TORCH_AVAILABLE and torch.cuda.is_available():
            gpu_used = True
            trainer_kwargs["accelerator"] = "gpu"
            trainer_kwargs["devices"] = 1
        else:
            trainer_kwargs["accelerator"] = "cpu"

        # Train DeepAR
        estimator = DeepAREstimator(
            prediction_length=self.config.prediction_length,
            context_length=self.config.context_length,
            freq="B",
            num_layers=self.config.num_layers,
            hidden_size=self.config.hidden_size,
            lr=self.config.learning_rate,
            batch_size=self.config.batch_size,
            trainer_kwargs={
                "max_epochs": self.config.epochs,
                **trainer_kwargs,
            },
        )

        predictor = estimator.train(training_data=dataset)

        # Save model
        model_dir = Path(self.config.model_dir) / "latest"
        model_dir.mkdir(parents=True, exist_ok=True)
        predictor.serialize(model_dir)

        # Save config alongside model for reproducibility
        config_path = model_dir / "deepar_config.json"
        config_path.write_text(self.config.model_dump_json(indent=2))

        duration_ms = int(time.time() * 1000) - start_ms

        # Extract training loss from trainer (best effort)
        training_loss = 0.0
        try:
            if hasattr(predictor, "network") and hasattr(predictor.network, "trainer"):
                trainer = predictor.network.trainer
                if hasattr(trainer, "callback_metrics"):
                    training_loss = float(trainer.callback_metrics.get("train_loss", 0.0))
        except Exception:
            pass

        return TrainingResult(
            training_loss=training_loss,
            validation_loss=None,
            duration_ms=duration_ms,
            model_path=str(model_dir),
            epochs=self.config.epochs,
            symbols=list(all_series.keys()),
            data_range={
                "start": str(date_min.date()) if date_min else None,
                "end": str(date_max.date()) if date_max else None,
            },
            num_series=len(all_series),
            num_datapoints=total_points,
            gpu_used=gpu_used,
        )

    def predict(
        self,
        data_dir: Optional[str] = None,
        symbols: Optional[list[str]] = None,
    ) -> dict[str, RegimeForecast]:
        """Generate probabilistic forecasts for each symbol.

        Args:
            data_dir: Directory containing recent OHLCV data
            symbols: Symbols to forecast

        Returns:
            Dict of symbol -> RegimeForecast with quantile-derived regime probabilities
        """
        if not GLUONTS_AVAILABLE:
            raise RuntimeError(
                "GluonTS PyTorch is required for prediction. Install: "
                "pip install 'gluonts[torch]' pytorch-lightning"
            )

        start_ms = int(time.time() * 1000)
        data_dir = data_dir or self.config.data_dir
        symbols = symbols or self.config.symbols

        # Load predictor
        model_dir = Path(self.config.model_dir) / "latest"
        if not model_dir.exists():
            raise FileNotFoundError(
                f"No trained model found at {model_dir}. Run training first."
            )

        predictor = PyTorchPredictor.deserialize(model_dir)

        # Build dataset for prediction (needs context_length of recent data)
        all_series = {}
        for symbol in symbols:
            df = _load_parquet_data(data_dir, symbol)
            if df is None:
                print(f"[deepar] Skipping {symbol}: no data found", file=sys.stderr)
                continue
            pdf = _prepare_series(df, symbol, self.config.context_length)
            if pdf is not None:
                all_series[symbol] = pdf

        if not all_series:
            raise ValueError(f"No valid data found for prediction in {data_dir}")

        # Build prediction dataset
        dataset_frames = []
        for symbol, pdf in all_series.items():
            frame = pdf.copy()
            frame["item_id"] = symbol
            dataset_frames.append(frame)

        combined = pd.concat(dataset_frames)
        feat_cols = ["atr_14", "vix", "volume_ratio", "realized_vol"]

        dataset = PandasDataset.from_long_dataframe(
            combined.reset_index().rename(columns={"date": "timestamp"}),
            target="target",
            item_id="item_id",
            timestamp="timestamp",
            feat_dynamic_real=feat_cols,
            freq="B",
        )

        # Run forecast
        forecast_it = predictor.predict(dataset)
        forecasts = list(forecast_it)

        # Map forecasts back to symbols
        symbol_list = list(all_series.keys())
        results: dict[str, RegimeForecast] = {}
        today_str = time.strftime("%Y-%m-%d")

        for i, (symbol, forecast) in enumerate(zip(symbol_list, forecasts)):
            # Extract quantiles
            q10 = float(np.mean(forecast.quantile(0.1)))
            q25 = float(np.mean(forecast.quantile(0.25)))
            q50 = float(np.mean(forecast.quantile(0.5)))
            q75 = float(np.mean(forecast.quantile(0.75)))
            q90 = float(np.mean(forecast.quantile(0.9)))

            # Compute regime probabilities from quantile spread
            spread_width = q90 - q10

            # Historical spread for normalization (use realized_vol as proxy)
            pdf = all_series[symbol]
            hist_returns = pdf["target"].dropna()
            if len(hist_returns) >= 60:
                hist_spread = float(hist_returns.rolling(60).std().iloc[-1]) * 2 * 1.645  # ~90% CI
            else:
                hist_spread = float(hist_returns.std()) * 2 * 1.645

            # Avoid division by zero
            hist_spread = max(hist_spread, 1e-8)

            # p_high_vol: spread width relative to historical
            spread_ratio = spread_width / hist_spread
            p_high_vol = min(1.0, max(0.0, (spread_ratio - 0.8) / 1.4))  # linear ramp: 0.8x→0, 2.2x→1

            # p_trending: based on p50 slope direction and confidence
            # Use the forecast median path slope
            median_path = forecast.quantile(0.5)
            if len(median_path) >= 2:
                slope = float(median_path[-1] - median_path[0]) / len(median_path)
                # Normalize slope relative to historical daily return magnitude
                hist_daily_std = max(float(hist_returns.std()), 1e-8)
                slope_normalized = abs(slope) / hist_daily_std
                p_trending = min(1.0, max(0.0, slope_normalized / 1.5))  # saturates at 1.5 std moves/day
            else:
                p_trending = 0.5

            # p_mean_revert: inverse of trending (simplified; refine later)
            p_mean_revert = 1.0 - p_trending

            # forecast_confidence: inverse of prediction interval width
            # Narrower spread = higher confidence
            confidence = min(1.0, max(0.0, 1.0 - (spread_ratio - 0.5) / 2.0))

            results[symbol] = RegimeForecast(
                symbol=symbol,
                forecast_date=today_str,
                prediction_horizon=self.config.prediction_length,
                p_high_vol=round(p_high_vol, 4),
                p_trending=round(p_trending, 4),
                p_mean_revert=round(p_mean_revert, 4),
                p_correlation_stress=0.0,  # Computed by classifier cross-symbol
                forecast_confidence=round(confidence, 4),
                quantile_p10=round(q10, 6),
                quantile_p25=round(q25, 6),
                quantile_p50=round(q50, 6),
                quantile_p75=round(q75, 6),
                quantile_p90=round(q90, 6),
            )

        return results


# ─── CLI Entry Point ────────────────────────────────────────────

def main():
    """CLI: python -m src.engine.deepar_forecaster --config <json>"""
    import argparse

    parser = argparse.ArgumentParser(description="DeepAR Regime Forecaster")
    parser.add_argument("--config", required=True, help="JSON config string or file path")
    args = parser.parse_args()

    # Load config (file path or inline JSON — matches python-runner.ts pattern)
    config_input = args.config
    if os.path.isfile(config_input):
        with open(config_input) as f:
            raw_config = json.load(f)
    else:
        raw_config = json.loads(config_input)

    # Extract metadata (correlation ID etc.) before passing to Pydantic
    _metadata = raw_config.pop("_metadata", {})

    config = DeepARConfig(**raw_config)
    forecaster = DeepARForecaster(config)

    if config.mode == "train":
        result = forecaster.train()
        print(json.dumps(result.model_dump(), indent=2))

    elif config.mode == "predict":
        forecasts = forecaster.predict()
        output = PredictionResult(
            forecasts={k: v.model_dump() for k, v in forecasts.items()},
            model_path=str(Path(config.model_dir) / "latest"),
            prediction_date=time.strftime("%Y-%m-%d"),
            duration_ms=0,  # Already captured per-symbol
        )
        print(json.dumps(output.model_dump(), indent=2))

    else:
        print(json.dumps({"error": f"Unknown mode: {config.mode}"}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
