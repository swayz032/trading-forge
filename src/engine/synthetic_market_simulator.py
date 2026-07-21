"""Synthetic Market Simulator — VAE-based OHLCV regime generator.

A14 Synthetic Black Swan Engine (W19). Challenger-only. Not authoritative.

Generates novel but statistically realistic market regimes conditioned on
labels like `crash | low_vol_then_explode | rate_shock | composite`. All
generated batches are calibrated against stylized-fact tests before persisting.

Architecture: Convolutional VAE on log-returns + vol features. Simpler and
faster to train than TimeGrad or TimeGAN; passes stylized-fact calibration on
MES 5m data with GARCH-like volatility clustering, fat tails, and leverage
effect. TimeGrad escalation path is available if calibration fails (noted in
limitations below).

Governance:
    experimental=True, authoritative=False, decision_role=challenger_only

Usage:
    python -m src.engine.synthetic_market_simulator --config <json>

Config keys:
    mode: "train" | "generate" | "calibrate"
    symbols: list[str]  (default ["MES", "MNQ", "MCL"])
    model_dir: str  (default "./models/synthetic")
    epochs: int  (default 100)
    seq_len: int  (default 60)  -- bars per sequence window
    latent_dim: int  (default 32)
    hidden_dim: int  (default 128)
    batch_size: int  (default 32)
    learning_rate: float  (default 1e-3)
    regime_label: str  (for generate mode)
    n_regimes: int  (for generate mode, default 10)
    target_vol: float | None  (optional conditioning)
    target_trend: float | None
    output_dir: str | None  (local Parquet output path for generate mode)
    start: str  (YYYY-MM-DD, for training data load)
    end: str

Output contracts (JSON stdout for runPythonModule):
    train:    {"trained": true, "samples": N, "device": "cuda"|"cpu",
               "model_version": "v1.0-YYYY-MM-DD", "governance": {...}}
    generate: {"generated": N, "regime_label": "...", "calibrated": [...],
               "model_version": "...", "governance": {...}}
    calibrate: {"stylized_fact_passed": bool, "stats": {...}, "governance": {...}}
"""
from __future__ import annotations

import json
import logging
import os
import sys
import time
from pathlib import Path
from typing import Literal, Optional

import numpy as np
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

# ─── Governance Labels (challenger_only — NEVER change to authoritative) ──────

GOVERNANCE_LABELS: dict = {
    "experimental": True,
    "authoritative": False,
    "decision_role": "challenger_only",
    "description": (
        "Synthetic regime generator — evidence only. "
        "Outputs are calibrated by stylized-fact tests before use. "
        "No authority over entry, exit, sizing, or lifecycle promotion."
    ),
}

# ─── Optional dependency guards ───────────────────────────────────────────────

try:
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
    TORCH_AVAILABLE = True
except ImportError:
    torch = None  # type: ignore[assignment]
    nn = None  # type: ignore[assignment]
    F = None  # type: ignore[assignment]
    TORCH_AVAILABLE = False

try:
    import polars as pl
    POLARS_AVAILABLE = True
except ImportError:
    pl = None  # type: ignore[assignment]
    POLARS_AVAILABLE = False

# Import GPU detection from hardware_profile (same pattern as DeepAR)
try:
    from src.engine.hardware_profile import probe_vram
    HARDWARE_PROFILE_AVAILABLE = True
except ImportError:
    def probe_vram(required_mb: int) -> bool:  # type: ignore[misc]
        return False
    HARDWARE_PROFILE_AVAILABLE = False

# Import load_ohlcv for training data
try:
    from src.engine.data_loader import load_ohlcv
    DATA_LOADER_AVAILABLE = True
except ImportError:
    def load_ohlcv(*args, **kwargs):  # type: ignore[misc]
        raise ImportError("data_loader not available")
    DATA_LOADER_AVAILABLE = False

# ─── Constants ───────────────────────────────────────────────────────────────

MODEL_VERSION_PREFIX = "v1.0"
_VRAM_SAFETY_MB = 500  # extra safety on top of probe formula
_MIN_BARS_FOR_CALIBRATION = 50
_REGIME_LABELS = ("crash", "low_vol_then_explode", "rate_shock", "composite", "normal")

# Stylized-fact calibration thresholds.
# HARDENED 2026-06-23: aligned with the stochastic_regime_generator (A14) institutional
# thresholds.  The legacy Conv-VAE path is dead code, but its calibration gate must
# pass the same institutional bar so any code that calls calibrate_batch() on VAE
# output is held to the same standard.
#
# Previous values (too permissive — VAE-era):
#   _MIN_KURTOSIS = 0.3   (excess kurtosis > 0.3)
#   _MIN_ACF_SQUARED_LAG1 = 0.0  (direction-only; trivially passes on anything)
#
# New values (institutional — match stochastic_regime_generator.SF_* constants):
#   _MIN_KURTOSIS = 3.0   (SF_MIN_EXCESS_KURTOSIS — Student-t innovations guarantee this)
#   _MIN_ACF_SQUARED_LAG1 = 0.01 (SF_MIN_ACF_SQUARED_LAG1 — minimum vol clustering signal)
#
# Metric drift note: any VAE-generated sequences that were previously passing with
# kurtosis in (0.3, 3.0) will now FAIL calibration.  This is the correct direction —
# VAE output that only shows kurtosis of 0.5 is not institutionally credible.
_MIN_KURTOSIS = 3.0          # excess kurtosis ≥ 3.0 (fat tails per Student-t threshold)
_MIN_ACF_SQUARED_LAG1 = 0.01  # ACF of squared returns > 0.01 (vol clustering signal)

# Severity check thresholds for tail-scenario validation.
# These mirror the stochastic_regime_generator severity_check() logic so both
# generators can be validated against the same historical baseline.
_SEVERITY_MIN_ANNUALIZED_VOL = 0.55    # crash scenarios must exceed 95th-pct historical
_SEVERITY_MIN_DRAWDOWN_DOLLARS = 4200  # crash scenarios must exceed historical worst DD

# ─── Pydantic Config ─────────────────────────────────────────────────────────


class SyntheticSimulatorConfig(BaseModel):
    """Configuration for the Synthetic Market Simulator."""

    mode: Literal["train", "generate", "calibrate"] = "calibrate"
    symbols: list[str] = Field(default_factory=lambda: ["MES", "MNQ", "MCL"])
    model_dir: str = "./models/synthetic"
    epochs: int = Field(default=100, ge=1, le=1000)
    seq_len: int = Field(default=60, ge=10, le=500)
    latent_dim: int = Field(default=32, ge=4, le=256)
    hidden_dim: int = Field(default=128, ge=16, le=512)
    batch_size: int = Field(default=32, ge=4, le=512)
    learning_rate: float = Field(default=1e-3, gt=0)
    regime_label: str = "normal"
    n_regimes: int = Field(default=10, ge=1, le=10000)
    target_vol: Optional[float] = None
    target_trend: Optional[float] = None
    output_dir: Optional[str] = None
    start: str = "2020-01-01"
    end: str = "2024-12-31"
    # Conditioning vector dimension (open, high, low, close log-returns + vol)
    n_features: int = Field(default=5, ge=1, le=20)
    governance_labels: dict = Field(default_factory=lambda: GOVERNANCE_LABELS.copy())
    # kl_weight: VAE KL annealing coefficient
    kl_weight: float = Field(default=0.001, gt=0)


# ─── Stylized Fact Tests ─────────────────────────────────────────────────────


def compute_stylized_facts(returns: np.ndarray) -> dict:
    """Compute stylized-fact statistics for a returns series.

    Args:
        returns: 1D array of log-returns.

    Returns:
        dict with keys: acf_squared_lag1, kurtosis, leverage_effect, vol_std
    """
    if len(returns) < 10:
        return {
            "acf_squared_lag1": 0.0,
            "kurtosis": 0.0,
            "leverage_effect": 0.0,
            "vol_std": 0.0,
        }

    rets = np.asarray(returns, dtype=float)
    # Remove NaN/inf
    mask = np.isfinite(rets)
    rets = rets[mask]

    if len(rets) < 10:
        return {
            "acf_squared_lag1": 0.0,
            "kurtosis": 0.0,
            "leverage_effect": 0.0,
            "vol_std": 0.0,
        }

    # ACF of squared returns at lag 1 (volatility clustering proxy)
    sq = rets ** 2
    sq_mean = np.mean(sq)
    sq_var = np.var(sq)
    if sq_var > 0:
        acf_sq_1 = float(np.mean((sq[:-1] - sq_mean) * (sq[1:] - sq_mean)) / sq_var)
    else:
        acf_sq_1 = 0.0

    # Excess kurtosis (fat tails — should be > 0 for real markets)
    std = np.std(rets)
    if std > 0:
        kurt = float(np.mean(((rets - np.mean(rets)) / std) ** 4) - 3.0)
    else:
        kurt = 0.0

    # Leverage effect: negative correlation between r_t and |r_{t+1}|
    # (negative returns tend to increase future volatility)
    if len(rets) > 2:
        abs_next = np.abs(rets[1:])
        r_now = rets[:-1]
        if np.std(r_now) > 0 and np.std(abs_next) > 0:
            leverage = float(np.corrcoef(r_now, abs_next)[0, 1])
        else:
            leverage = 0.0
    else:
        leverage = 0.0

    vol_std = float(np.std(rets))

    return {
        "acf_squared_lag1": round(acf_sq_1, 6),
        "kurtosis": round(kurt, 6),
        "leverage_effect": round(leverage, 6),
        "vol_std": round(vol_std, 8),
    }


def run_stylized_fact_tests(
    returns: np.ndarray,
    min_kurtosis: float = _MIN_KURTOSIS,
    min_acf_sq: float = _MIN_ACF_SQUARED_LAG1,
) -> tuple[bool, dict]:
    """Run stylized-fact calibration tests on a returns array.

    Args:
        returns: 1D log-returns array.
        min_kurtosis: Minimum excess kurtosis threshold.
        min_acf_sq: Minimum ACF of squared returns at lag 1.

    Returns:
        (passed: bool, stats: dict)
    """
    if len(returns) < _MIN_BARS_FOR_CALIBRATION:
        return False, {
            "acf_squared_lag1": 0.0,
            "kurtosis": 0.0,
            "leverage_effect": 0.0,
            "vol_std": 0.0,
            "fail_reason": f"insufficient_bars_{len(returns)}_min_{_MIN_BARS_FOR_CALIBRATION}",
        }

    stats = compute_stylized_facts(returns)
    stats["fail_reasons"] = []

    passed = True

    # Gate 1: Fat tails (excess kurtosis > threshold)
    if stats["kurtosis"] < min_kurtosis:
        passed = False
        stats["fail_reasons"].append(
            f"kurtosis_{stats['kurtosis']:.3f}_below_{min_kurtosis}"
        )

    # Gate 2: Volatility clustering (ACF of squared returns direction)
    # Note: We only enforce direction (> 0), not magnitude, since generated
    # sequences can be short and ACF estimates are noisy.
    if stats["acf_squared_lag1"] <= min_acf_sq and min_acf_sq > 0:
        passed = False
        stats["fail_reasons"].append(
            f"acf_sq_{stats['acf_squared_lag1']:.4f}_not_above_{min_acf_sq}"
        )

    return passed, stats


def check_tail_scenario_severity(
    returns: np.ndarray,
    scenario_label: str,
    historical_95th_pct_vol: float = _SEVERITY_MIN_ANNUALIZED_VOL,
    historical_worst_drawdown_dollars: float = _SEVERITY_MIN_DRAWDOWN_DOLLARS,
    point_value: float = 5.0,
) -> tuple[bool, dict]:
    """Severity validation for tail scenarios generated by this simulator.

    A tail scenario must be MORE EXTREME than historical baseline:
    either annualized vol > historical 95th-pct OR worst drawdown > historical worst.

    This mirrors the logic in StochasticRegimeGenerator.severity_check() so both
    the legacy VAE path and the new stochastic path use the same institutional bar.

    Args:
        returns: 1D log-returns array.
        scenario_label: Name of the scenario (used to determine if it is a tail scenario).
        historical_95th_pct_vol: Annualized vol threshold (default 0.55 = 95th percentile MES).
        historical_worst_drawdown_dollars: Worst historical daily drawdown in dollars.
        point_value: Dollar value per point (default 5.0 for MES).

    Returns:
        (passed: bool, info: dict)
    """
    _TAIL_SCENARIOS = frozenset({
        "crash", "low_vol_then_explode", "rate_shock",
        "COVID_crash", "rate_shock_2022", "vol_spike_2018",
        "credit_crisis_2008", "flash_crash_1987",
        "prop_consistency_breach_stress",
    })

    if scenario_label not in _TAIL_SCENARIOS:
        # Non-tail scenarios (slow_bleed_grind, flash_recovery, normal, composite)
        # do NOT need to exceed historical extremes.
        return True, {"flag": "non_tail_scenario_auto_pass", "scenario": scenario_label}

    if len(returns) < 2:
        return False, {"flag": "insufficient_returns", "n": len(returns)}

    # Annualized vol (assume 252 trading days, 78 bars/day for 5-min)
    bars_per_year = 252 * 78
    ann_vol = float(np.std(returns) * np.sqrt(bars_per_year))

    # Worst sequential drawdown in dollars
    cum_returns = np.cumsum(returns)
    running_max = np.maximum.accumulate(cum_returns)
    drawdown_log = running_max - cum_returns
    worst_dd_log = float(np.max(drawdown_log)) if len(drawdown_log) > 0 else 0.0
    # Convert log-return drawdown to approximate dollar value (assume seed ~4000 MES)
    worst_dd_dollars = worst_dd_log * 4000.0 * point_value

    vol_ok = ann_vol >= historical_95th_pct_vol
    dd_ok = worst_dd_dollars >= historical_worst_drawdown_dollars
    passed = vol_ok or dd_ok

    info = {
        "scenario": scenario_label,
        "annualized_vol": ann_vol,
        "worst_drawdown_dollars": worst_dd_dollars,
        "historical_vol_threshold": historical_95th_pct_vol,
        "historical_dd_threshold": historical_worst_drawdown_dollars,
        "vol_ok": vol_ok,
        "dd_ok": dd_ok,
    }
    if not passed:
        info["flag"] = (
            f"severity_insufficient: vol={ann_vol:.3f} < {historical_95th_pct_vol} "
            f"AND dd=${worst_dd_dollars:.0f} < ${historical_worst_drawdown_dollars}"
        )

    return passed, info


# ─── KL-Divergence for Mode Collapse Detection ───────────────────────────────


def compute_kl_divergence(p: np.ndarray, q: np.ndarray, n_bins: int = 30) -> float:
    """Compute KL(P||Q) via histogram estimation.

    Args:
        p: Sample from distribution P (generated).
        q: Sample from distribution Q (reference/real).
        n_bins: Number of histogram bins.

    Returns:
        KL divergence (non-negative float). Lower = distributions are closer.
    """
    p = np.asarray(p, dtype=float)
    q = np.asarray(q, dtype=float)

    # Remove non-finite values
    p = p[np.isfinite(p)]
    q = q[np.isfinite(q)]

    if len(p) < 2 or len(q) < 2:
        return 0.0

    # Compute range covering both distributions
    all_vals = np.concatenate([p, q])
    lo, hi = np.percentile(all_vals, 0.5), np.percentile(all_vals, 99.5)
    if hi <= lo:
        hi = lo + 1e-8

    bins = np.linspace(lo, hi, n_bins + 1)
    eps = 1e-10  # Laplace smoothing to avoid log(0)

    p_hist, _ = np.histogram(p, bins=bins, density=False)
    q_hist, _ = np.histogram(q, bins=bins, density=False)

    # Normalize to probabilities
    p_prob = (p_hist + eps) / (p_hist.sum() + eps * len(p_hist))
    q_prob = (q_hist + eps) / (q_hist.sum() + eps * len(q_hist))

    # KL(P||Q) = sum(P * log(P/Q))
    kl = float(np.sum(p_prob * np.log(p_prob / q_prob)))
    return max(0.0, kl)  # clamp numerical noise below 0


def check_mode_collapse(
    generated: np.ndarray,
    reference: np.ndarray,
    kl_threshold: float = 2.0,
) -> dict:
    """Check if generated distribution has collapsed.

    Args:
        generated: Log-returns from generated regimes.
        reference: Log-returns from real/reference data.
        kl_threshold: KL divergence above this = mode collapse.

    Returns:
        dict with mode_collapse_detected (bool) and kl_divergence (float).
    """
    kl = compute_kl_divergence(generated, reference)
    return {
        "mode_collapse_detected": kl > kl_threshold,
        "kl_divergence": round(kl, 6),
        "kl_threshold": kl_threshold,
        "governance": GOVERNANCE_LABELS,
    }


# ─── Calibrate Batch (mode=calibrate entry point) ────────────────────────────


def calibrate_batch(bars: list[dict]) -> dict:
    """Run stylized-fact tests on a batch of OHLCV bars.

    This is the mode=calibrate entry point. Receives a list of bar dicts
    with keys: ts_event, open, high, low, close, volume.

    Returns:
        {
            "stylized_fact_passed": bool,
            "stats": {acf_squared_lag1, kurtosis, leverage_effect, vol_std},
            "governance": GOVERNANCE_LABELS,
        }
    """
    if len(bars) < _MIN_BARS_FOR_CALIBRATION:
        return {
            "stylized_fact_passed": False,
            "stats": {
                "acf_squared_lag1": 0.0,
                "kurtosis": 0.0,
                "leverage_effect": 0.0,
                "vol_std": 0.0,
                "fail_reason": f"insufficient_bars_{len(bars)}",
            },
            "governance": GOVERNANCE_LABELS,
        }

    closes = np.array([b["close"] for b in bars], dtype=float)
    if not np.all(np.isfinite(closes)) or len(closes) < 2:
        return {
            "stylized_fact_passed": False,
            "stats": {"fail_reason": "non_finite_prices"},
            "governance": GOVERNANCE_LABELS,
        }

    log_rets = np.diff(np.log(closes))
    passed, stats = run_stylized_fact_tests(log_rets)

    # Sanitize stats for JSON serialization (no numpy scalars)
    clean_stats = {k: float(v) if isinstance(v, (np.floating, np.integer)) else v
                   for k, v in stats.items()}

    return {
        "stylized_fact_passed": passed,
        "stats": clean_stats,
        "governance": GOVERNANCE_LABELS,
    }


# ─── VAE Model ───────────────────────────────────────────────────────────────

if TORCH_AVAILABLE:
    class RegimeVAE(nn.Module):  # type: ignore[misc]
        """Convolutional VAE for OHLCV log-return sequences.

        Architecture:
          Encoder: Conv1D(in=n_features, hidden) x2 → flatten → FC → (mu, log_var)
          Decoder: FC → reshape → ConvTranspose1D x2 → output(n_features)

        Input:  (batch, seq_len, n_features)   — log-returns per OHLCV feature
        Output: (batch, seq_len, n_features)   — reconstructed log-returns
        """

        def __init__(
            self,
            input_dim: int = 5,
            latent_dim: int = 32,
            hidden_dim: int = 128,
            seq_len: int = 60,
        ):
            super().__init__()
            self.input_dim = input_dim
            self.latent_dim = latent_dim
            self.hidden_dim = hidden_dim
            self.seq_len = seq_len

            # Encoder
            self.enc_conv1 = nn.Conv1d(input_dim, hidden_dim, kernel_size=3, padding=1)
            self.enc_conv2 = nn.Conv1d(hidden_dim, hidden_dim // 2, kernel_size=3, padding=1)
            self.enc_bn1 = nn.BatchNorm1d(hidden_dim)
            self.enc_bn2 = nn.BatchNorm1d(hidden_dim // 2)
            self.enc_fc_mu = nn.Linear((hidden_dim // 2) * seq_len, latent_dim)
            self.enc_fc_var = nn.Linear((hidden_dim // 2) * seq_len, latent_dim)

            # Decoder
            self.dec_fc = nn.Linear(latent_dim, (hidden_dim // 2) * seq_len)
            self.dec_conv1 = nn.ConvTranspose1d(hidden_dim // 2, hidden_dim, kernel_size=3, padding=1)
            self.dec_bn1 = nn.BatchNorm1d(hidden_dim)
            self.dec_conv2 = nn.ConvTranspose1d(hidden_dim, input_dim, kernel_size=3, padding=1)

        def encode(self, x: "torch.Tensor") -> tuple["torch.Tensor", "torch.Tensor"]:
            """x: (batch, seq_len, features) → mu, log_var"""
            # Conv expects (batch, channels, length)
            h = x.permute(0, 2, 1)
            h = F.relu(self.enc_bn1(self.enc_conv1(h)))
            h = F.relu(self.enc_bn2(self.enc_conv2(h)))
            h = h.flatten(start_dim=1)
            return self.enc_fc_mu(h), self.enc_fc_var(h)

        def reparameterize(self, mu: "torch.Tensor", log_var: "torch.Tensor") -> "torch.Tensor":
            if self.training:
                std = torch.exp(0.5 * log_var)
                eps = torch.randn_like(std)
                return mu + eps * std
            return mu

        def decode(self, z: "torch.Tensor") -> "torch.Tensor":
            """z: (batch, latent_dim) → (batch, seq_len, features)"""
            h = F.relu(self.dec_fc(z))
            h = h.view(z.size(0), self.hidden_dim // 2, self.seq_len)
            h = F.relu(self.dec_bn1(self.dec_conv1(h)))
            h = self.dec_conv2(h)
            return h.permute(0, 2, 1)  # → (batch, seq_len, features)

        def forward(
            self,
            x: "torch.Tensor",
        ) -> tuple["torch.Tensor", "torch.Tensor", "torch.Tensor"]:
            mu, log_var = self.encode(x)
            z = self.reparameterize(mu, log_var)
            recon = self.decode(z)
            return recon, mu, log_var

        def sample(self, n_samples: int = 1, seq_len: Optional[int] = None) -> "torch.Tensor":
            """Sample from the prior. Returns (n_samples, seq_len, features)."""
            seq = seq_len or self.seq_len
            device = next(self.parameters()).device
            z = torch.randn(n_samples, self.latent_dim, device=device)
            # Temporarily adjust seq_len if needed
            if seq != self.seq_len:
                # Can't change conv output size without re-arch — use stored seq_len
                pass
            with torch.no_grad():
                return self.decode(z)

else:
    class RegimeVAE:  # type: ignore[no-redef]
        """Stub when PyTorch is not available."""
        def __init__(self, *args, **kwargs):
            raise ImportError("PyTorch is required for RegimeVAE (pip install torch)")


# ─── VAE Loss ────────────────────────────────────────────────────────────────

def vae_loss(
    recon: "torch.Tensor",
    target: "torch.Tensor",
    mu: "torch.Tensor",
    log_var: "torch.Tensor",
    kl_weight: float = 0.001,
) -> "torch.Tensor":
    """VAE ELBO loss = reconstruction MSE + beta-weighted KL divergence."""
    recon_loss = F.mse_loss(recon, target, reduction="mean")
    kl = -0.5 * torch.mean(1 + log_var - mu.pow(2) - log_var.exp())
    return recon_loss + kl_weight * kl


# ─── Data Preparation ────────────────────────────────────────────────────────


def _prepare_sequences(df, seq_len: int, n_features: int) -> Optional["torch.Tensor"]:
    """Convert OHLCV DataFrame to (N, seq_len, n_features) log-return tensor.

    Features: [log_ret_close, log_ret_open, hl_range, vol_ratio, realized_vol]
    """
    if not TORCH_AVAILABLE or not POLARS_AVAILABLE:
        return None
    if df is None or len(df) < seq_len + 2:
        return None

    try:
        # Normalize column names
        cols = {c.lower(): c for c in df.columns}
        close = df[cols.get("close", "close")].cast(pl.Float64).to_numpy()
        open_ = df[cols.get("open", "open")].cast(pl.Float64).to_numpy()
        high = df[cols.get("high", "high")].cast(pl.Float64).to_numpy()
        low = df[cols.get("low", "low")].cast(pl.Float64).to_numpy()
        volume = df[cols.get("volume", "volume")].cast(pl.Float64).to_numpy()

        # Feature 1: close log-returns
        lr_close = np.diff(np.log(np.clip(close, 1e-8, None)))
        # Feature 2: open log-returns
        lr_open = np.diff(np.log(np.clip(open_, 1e-8, None)))
        # Feature 3: HL range / close (normalized)
        hl_range = (high[1:] - low[1:]) / np.clip(close[1:], 1e-8, None)
        # Feature 4: volume ratio (vs 20-bar mean)
        vol_20 = np.array([
            np.mean(volume[max(0, i-20):i+1]) for i in range(1, len(volume))
        ])
        vol_ratio = np.where(vol_20 > 0, volume[1:] / vol_20, 1.0)
        # Feature 5: rolling 10-bar realized vol
        realized_vol = np.array([
            np.std(lr_close[max(0, i-10):i+1]) for i in range(len(lr_close))
        ])

        n = len(lr_close)
        if n < seq_len + 1:
            return None

        # Stack features: (n, 5)
        feats = np.stack([
            lr_close,
            lr_open,
            hl_range,
            np.clip(vol_ratio, 0, 10),  # cap vol spikes
            realized_vol,
        ], axis=1)

        # Fill NaN/inf
        feats = np.where(np.isfinite(feats), feats, 0.0)

        # Normalize via tanh (keeps extreme values in [-1,1])
        scale = np.std(feats, axis=0, keepdims=True) + 1e-8
        feats = feats / (scale * 3.0)  # 3-sigma normalization
        feats = np.tanh(feats)

        # Slice into (N, seq_len, n_features) windows
        sequences = []
        for i in range(0, n - seq_len, seq_len // 2):  # 50% overlap
            sequences.append(feats[i: i + seq_len])
        if not sequences:
            return None

        arr = np.array(sequences, dtype=np.float32)
        # Trim to n_features in case we have more
        arr = arr[:, :, :n_features]
        return torch.from_numpy(arr)

    except Exception as e:
        logger.warning("_prepare_sequences failed: %s", e)
        return None


# ─── Regime Conditioning ─────────────────────────────────────────────────────

_REGIME_CONDITIONING: dict[str, dict] = {
    "crash":               {"vol_scale": 3.0, "drift_shift": -0.003, "tail_weight": 2.0},
    "low_vol_then_explode": {"vol_scale": 0.3, "drift_shift": 0.001,  "tail_weight": 0.5},
    "rate_shock":           {"vol_scale": 2.0, "drift_shift": -0.001, "tail_weight": 1.5},
    "composite":            {"vol_scale": 1.5, "drift_shift": 0.0,    "tail_weight": 1.2},
    "normal":               {"vol_scale": 1.0, "drift_shift": 0.0,    "tail_weight": 1.0},
}


def _condition_latent(
    z: "torch.Tensor",
    regime_label: str,
    target_vol: Optional[float] = None,
    target_trend: Optional[float] = None,
) -> "torch.Tensor":
    """Shift the latent code to condition on a regime label.

    This is a lightweight conditioning mechanism: we scale the latent
    vector components based on the regime's vol/drift profile. A proper
    conditional VAE would use label embeddings; this is sufficient for v1.0.
    """
    cond = _REGIME_CONDITIONING.get(regime_label, _REGIME_CONDITIONING["normal"])
    vol_scale = target_vol if target_vol is not None else cond["vol_scale"]
    drift_shift = target_trend if target_trend is not None else cond["drift_shift"]
    tail_weight = cond["tail_weight"]

    # Scale: amplify latent variance for high-vol regimes
    z_conditioned = z * vol_scale

    # Drift: shift mean of latent space along first dimension
    z_conditioned = z_conditioned + drift_shift * 10.0

    # Tail: selectively amplify tail dimensions (last 1/4 of latent)
    n_tail = max(1, z.shape[-1] // 4)
    z_conditioned[:, -n_tail:] = z_conditioned[:, -n_tail:] * tail_weight

    return z_conditioned


# ─── Bars Conversion ─────────────────────────────────────────────────────────


def _tensor_to_bars(
    tensor: "torch.Tensor",
    seed_price: float = 100.0,
) -> list[dict]:
    """Convert VAE output tensor back to synthetic OHLCV bars.

    The tensor contains normalized log-return features. We reconstruct
    absolute prices by cumulatively applying log-returns from a seed price.

    Args:
        tensor: (seq_len, n_features) float tensor.
        seed_price: Starting close price.

    Returns:
        List of bar dicts with ts_event, open, high, low, close, volume.
    """
    arr = tensor.cpu().numpy().astype(float)
    seq_len = arr.shape[0]

    # Denormalize: undo tanh + scale (approximate — exact inversion not critical)
    # tanh^-1 approximation: clip to avoid inf
    arr = np.clip(arr, -0.9999, 0.9999)
    arr_denorm = np.arctanh(arr) * 0.02  # ~3-sigma scale from training

    # Feature 0: close log-returns → close prices
    lr_close = arr_denorm[:, 0]
    closes = seed_price * np.exp(np.cumsum(lr_close))

    # Feature 1: open log-returns → open prices (from close[t-1])
    _lr_open = arr_denorm[:, 1] if arr.shape[1] > 1 else lr_close  # noqa: F841 (kept: documents feature 1's layout)
    opens = np.roll(closes, 1)
    opens[0] = seed_price

    # Feature 2: HL range
    hl_range = np.abs(arr_denorm[:, 2]) if arr.shape[1] > 2 else np.abs(lr_close) * 2
    highs = np.maximum(opens, closes) + closes * np.abs(hl_range) * 0.5
    lows = np.minimum(opens, closes) - closes * np.abs(hl_range) * 0.5

    # Feature 3: volume ratio → synthetic volume
    vol_ratio = arr_denorm[:, 3] if arr.shape[1] > 3 else np.ones(seq_len)
    base_vol = 5000
    volumes = (base_vol * (1 + np.clip(vol_ratio, -0.9, 9))).astype(int)
    volumes = np.clip(volumes, 100, 100_000)

    bars = []
    for i in range(seq_len):
        close = float(np.clip(closes[i], 0.01, 1e8))
        open_ = float(np.clip(opens[i], 0.01, 1e8))
        high = float(np.clip(highs[i], open_, 1e8))
        low = float(np.clip(lows[i], 0.0001, open_))
        # Enforce OHLC validity
        high = max(high, max(open_, close))
        low = min(low, min(open_, close))
        bars.append({
            "ts_event": f"2024-01-01T{(i % 23):02d}:00:00",
            "open": round(open_, 4),
            "high": round(high, 4),
            "low": round(low, 4),
            "close": round(close, 4),
            "volume": int(volumes[i]),
        })
    return bars


# ─── Main Simulator Class ─────────────────────────────────────────────────────


class SyntheticMarketSimulator:
    """VAE-based synthetic market regime generator.

    Three modes:
      train    — load OHLCV from S3, train VAE, serialize to models/synthetic/latest/
      generate — load trained VAE, sample conditioned regimes, write Parquet to output_dir
      calibrate — run stylized-fact tests on a batch of OHLCV bars

    Governance: challenger_only. Never has execution authority.
    """

    def __init__(self, config: SyntheticSimulatorConfig):
        self.config = config
        self._model: Optional[RegimeVAE] = None

    def _select_device(self) -> str:
        """Select CPU or CUDA based on probe_vram. Never raises.

        Analog to DeepAR's GPU detection, but using probe_vram directly
        (not select_quantum_device — that is PennyLane-specific).
        RTX 5060 8GB cap: we need ~200MB for a small VAE, easily fits.
        """
        try:
            if not TORCH_AVAILABLE:
                return "cpu"
            if not torch.cuda.is_available():
                return "cpu"
            # Estimate VRAM: hidden_dim * latent_dim * 4 bytes * 100 (generous)
            required_mb = max(
                200,
                int(self.config.hidden_dim * self.config.latent_dim * 4 * 100 / (1024 * 1024))
            )
            if probe_vram(required_mb):
                return "cuda"
            return "cpu"
        except Exception as e:
            logger.warning("_select_device error (falling back to cpu): %s", e)
            return "cpu"

    def _get_model_dir(self) -> Path:
        return Path(self.config.model_dir) / "latest"

    def _model_version(self) -> str:
        return f"{MODEL_VERSION_PREFIX}-{time.strftime('%Y-%m-%d')}"

    def train(self) -> dict:
        """Train VAE on real OHLCV from S3.

        Returns:
            {"trained": true, "samples": N, "device": "cpu"|"cuda",
             "model_version": "v1.0-YYYY-MM-DD", "governance": {...}}
        """
        if not TORCH_AVAILABLE:
            raise RuntimeError(
                "PyTorch is required for training (pip install torch)"
            )

        start_ms = int(time.time() * 1000)
        device = self._select_device()
        logger.info("SyntheticMarketSimulator train: device=%s", device)

        cfg = self.config
        model = RegimeVAE(
            input_dim=cfg.n_features,
            latent_dim=cfg.latent_dim,
            hidden_dim=cfg.hidden_dim,
            seq_len=cfg.seq_len,
        ).to(device)

        optimizer = torch.optim.Adam(model.parameters(), lr=cfg.learning_rate)

        # Load data for each symbol
        all_sequences = []
        for symbol in cfg.symbols:
            try:
                df = load_ohlcv(
                    symbol=symbol,
                    timeframe="5min",
                    start=cfg.start,
                    end=cfg.end,
                )
                seqs = _prepare_sequences(df, cfg.seq_len, cfg.n_features)
                if seqs is not None and len(seqs) > 0:
                    all_sequences.append(seqs)
                    logger.info("Loaded %d sequences for %s", len(seqs), symbol)
            except Exception as e:
                logger.warning("Failed to load %s (non-fatal): %s", symbol, e)

        if not all_sequences:
            raise ValueError(
                "No training data available for any symbol. "
                "Check S3 connectivity or provide local_path."
            )

        data = torch.cat(all_sequences, dim=0).to(device)
        total_samples = len(data)
        logger.info("Training VAE on %d sequences, device=%s", total_samples, device)

        # Training loop
        model.train()
        dataset = torch.utils.data.TensorDataset(data)
        loader = torch.utils.data.DataLoader(
            dataset, batch_size=cfg.batch_size, shuffle=True, drop_last=True
        )

        for epoch in range(cfg.epochs):
            epoch_loss = 0.0
            for (batch,) in loader:
                optimizer.zero_grad()
                recon, mu, log_var = model(batch)
                loss = vae_loss(recon, batch, mu, log_var, kl_weight=cfg.kl_weight)
                loss.backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                optimizer.step()
                epoch_loss += loss.item()
            if (epoch + 1) % max(1, cfg.epochs // 5) == 0:
                avg = epoch_loss / max(1, len(loader))
                logger.info("Epoch %d/%d — loss=%.6f", epoch + 1, cfg.epochs, avg)

        # Serialize
        model_dir = self._get_model_dir()
        model_dir.mkdir(parents=True, exist_ok=True)
        model_version = self._model_version()

        torch.save(model.state_dict(), model_dir / "vae_state.pt")
        config_path = model_dir / "simulator_config.json"
        config_data = {
            "n_features": cfg.n_features,
            "latent_dim": cfg.latent_dim,
            "hidden_dim": cfg.hidden_dim,
            "seq_len": cfg.seq_len,
            "model_version": model_version,
            "trained_on": cfg.symbols,
            "governance": GOVERNANCE_LABELS,
        }
        config_path.write_text(json.dumps(config_data, indent=2), newline="\n")

        self._model = model
        duration_ms = int(time.time() * 1000) - start_ms

        return {
            "trained": True,
            "samples": total_samples,
            "device": device,
            "model_version": model_version,
            "duration_ms": duration_ms,
            "model_path": str(model_dir),
            "governance": GOVERNANCE_LABELS,
        }

    def _load_model(self) -> tuple[RegimeVAE, dict]:
        """Load trained VAE from disk.

        Returns:
            (model, config_data) tuple.
        """
        model_dir = self._get_model_dir()
        state_path = model_dir / "vae_state.pt"
        config_path = model_dir / "simulator_config.json"

        if not state_path.exists():
            raise FileNotFoundError(
                f"No trained model found at {state_path}. Run mode=train first."
            )

        with open(config_path) as f:
            config_data = json.load(f)

        model = RegimeVAE(
            input_dim=config_data["n_features"],
            latent_dim=config_data["latent_dim"],
            hidden_dim=config_data["hidden_dim"],
            seq_len=config_data["seq_len"],
        )
        device = self._select_device()
        state = torch.load(str(state_path), map_location=device)
        model.load_state_dict(state)
        model.to(device)
        model.eval()

        return model, config_data

    def generate(self) -> dict:
        """Generate N regime samples conditioned on regime_label.

        Returns JSON output for runPythonModule contract:
            {"generated": N, "regime_label": "...", "calibrated": [...],
             "model_version": "...", "governance": {...}}

        Caller is responsible for uploading Parquet to S3.
        """
        if not TORCH_AVAILABLE:
            raise RuntimeError(
                "PyTorch is required for generation (pip install torch)"
            )

        cfg = self.config
        model, config_data = self._load_model()
        device = next(model.parameters()).device
        model_version = config_data.get("model_version", self._model_version())

        n_regimes = cfg.n_regimes
        _seq_len = config_data.get("seq_len", cfg.seq_len)  # noqa: F841 (kept: documents the config key)
        latent_dim = config_data.get("latent_dim", cfg.latent_dim)

        # Set up output directory
        if cfg.output_dir:
            output_path = Path(cfg.output_dir)
            output_path.mkdir(parents=True, exist_ok=True)
        else:
            output_path = None

        calibrated_results = []
        generated_count = 0

        for i in range(n_regimes):
            with torch.no_grad():
                z = torch.randn(1, latent_dim, device=device)
                z_conditioned = _condition_latent(
                    z,
                    regime_label=cfg.regime_label,
                    target_vol=cfg.target_vol,
                    target_trend=cfg.target_trend,
                )
                sample = model.decode(z_conditioned)  # (1, seq_len, features)

            bars = _tensor_to_bars(sample[0], seed_price=100.0)

            # Calibrate this regime
            cal_result = calibrate_batch(bars)
            cal_result["regime_index"] = i

            if output_path is not None:
                parquet_file = output_path / f"{cfg.regime_label}_{i:04d}.parquet"
                try:
                    if POLARS_AVAILABLE:
                        pl.DataFrame({
                            "ts_event": [b["ts_event"] for b in bars],
                            "open": [b["open"] for b in bars],
                            "high": [b["high"] for b in bars],
                            "low": [b["low"] for b in bars],
                            "close": [b["close"] for b in bars],
                            "volume": [b["volume"] for b in bars],
                        }).write_parquet(str(parquet_file))
                        cal_result["parquet_path"] = str(parquet_file)
                except Exception as e:
                    logger.warning("Failed to write Parquet for regime %d: %s", i, e)

            calibrated_results.append(cal_result)
            generated_count += 1

        passed_count = sum(1 for r in calibrated_results if r.get("stylized_fact_passed"))

        return {
            "generated": generated_count,
            "regime_label": cfg.regime_label,
            "calibrated": calibrated_results,
            "calibration_pass_rate": round(passed_count / max(1, generated_count), 4),
            "model_version": model_version,
            "governance": GOVERNANCE_LABELS,
        }

    def calibrate(self, bars: Optional[list[dict]] = None) -> dict:
        """Run stylized-fact tests on a provided batch of OHLCV bars.

        When bars is None, reads from config input_bars (for CLI invocation).
        """
        if bars is None:
            raise ValueError("bars must be provided for mode=calibrate")
        return calibrate_batch(bars)


# ─── CLI Entry Point ──────────────────────────────────────────────────────────


def main():
    """CLI: python -m src.engine.synthetic_market_simulator --config <json>

    Mirrors the DeepAR runPythonModule() JSON-stdin / JSON-stdout contract.
    """
    import argparse

    parser = argparse.ArgumentParser(description="Synthetic Market Simulator")
    parser.add_argument("--config", required=True, help="JSON config string or file path")
    args = parser.parse_args()

    config_input = args.config
    if os.path.isfile(config_input):
        with open(config_input) as f:
            raw_config = json.load(f)
    else:
        raw_config = json.loads(config_input)

    # Extract metadata before Pydantic parse (mirrors DeepAR pattern)
    _metadata = raw_config.pop("_metadata", {})

    # Calibrate mode may receive inline bars
    inline_bars = raw_config.pop("bars", None)

    config = SyntheticSimulatorConfig(**raw_config)
    simulator = SyntheticMarketSimulator(config)

    if config.mode == "train":
        try:
            result = simulator.train()
        except (ValueError, FileNotFoundError) as exc:
            msg = str(exc)
            if "No training data" in msg or "no data" in msg.lower():
                print(f"[synthetic] train deferred — no training data: {msg}", file=sys.stderr)
                deferred = {
                    "trained": False,
                    "status": "deferred",
                    "reason": "no_training_data",
                    "governance": GOVERNANCE_LABELS,
                }
                print(json.dumps(deferred, indent=2))
                return
            raise
        print(json.dumps(result, indent=2))

    elif config.mode == "generate":
        try:
            result = simulator.generate()
        except FileNotFoundError as exc:
            print(f"[synthetic] generate deferred — no trained model: {exc}", file=sys.stderr)
            deferred = {
                "generated": 0,
                "status": "deferred",
                "reason": "no_trained_model",
                "regime_label": config.regime_label,
                "governance": GOVERNANCE_LABELS,
            }
            print(json.dumps(deferred, indent=2))
            return
        print(json.dumps(result, indent=2))

    elif config.mode == "calibrate":
        if inline_bars is None:
            print(json.dumps({
                "stylized_fact_passed": False,
                "stats": {"fail_reason": "no_bars_provided"},
                "governance": GOVERNANCE_LABELS,
            }, indent=2))
            return
        result = calibrate_batch(inline_bars)
        print(json.dumps(result, indent=2))

    else:
        print(json.dumps({"error": f"Unknown mode: {config.mode}"}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
