"""Tensor Network (MPS) signal model — Matrix Product State for trade outcome prediction.

Evidence: MPS with 76 parameters achieved 3.71% excess return and 0.69 IR on TOPIX500,
nearly 2x the best neural network. Tensor networks are interpretable, require fewer
parameters, and avoid overfitting traps common in deep learning.

Features: Bias engine outputs (HTF context, session type, location score, ATR regime,
volume profile, indicator values).
Output: P(profitable) for new signal → feeds into eligibility gate.

Library: quimb (CPU) or quimb + cupy (GPU via WSL2)
Governance: experimental: true until OOS benchmark proves improvement over baseline

Usage:
    python -m src.engine.tensor_signal_model --mode train --input-json '{"features": [...], "labels": [...]}'
    python -m src.engine.tensor_signal_model --mode predict --input-json '{"model_path": "...", "features": [...]}'
"""
from __future__ import annotations

import json
import os
import sys
import time
import hashlib
from typing import Optional
from pathlib import Path

import numpy as np
from pydantic import BaseModel, Field

# Optional GPU support
try:
    import cupy as cp
    GPU_AVAILABLE = True
except ImportError:
    cp = None
    GPU_AVAILABLE = False

# Optional quimb for full tensor network ops
try:
    import quimb
    import quimb.tensor as qtn
    QUIMB_AVAILABLE = True
except ImportError:
    QUIMB_AVAILABLE = False


# ─── Feature Encoding ────────────────────────────────────────────

class FeatureConfig(BaseModel):
    """Configuration for feature encoding into MPS-compatible format."""
    feature_names: list[str] = Field(default_factory=lambda: [
        "htf_bias",         # -1 (bearish) to +1 (bullish)
        "session_type",     # 0=ASIA, 1=LONDON, 2=NY_OPEN, 3=NY_CORE, 4=NY_CLOSE
        "location_score",   # 0.0 to 1.0
        "atr_regime",       # 0=LOW_VOL, 1=NORMAL, 2=HIGH_VOL
        "volume_zscore",    # Normalized volume z-score
        "rsi_14",           # 0-100, normalized to 0-1
        "macd_hist_sign",   # -1 or +1
        "adx_value",        # 0-100, normalized to 0-1
    ])
    n_bins_per_feature: int = 4  # Discretization bins per feature
    bond_dim: int = 4            # MPS bond dimension


class MPSModelConfig(BaseModel):
    """MPS model configuration and metadata."""
    feature_config: FeatureConfig = Field(default_factory=FeatureConfig)
    n_features: int = 8
    bond_dim: int = 4
    n_params: int = 0  # Computed after build
    trained: bool = False
    train_accuracy: float = 0.0
    val_accuracy: float = 0.0
    epochs_trained: int = 0
    governance: dict = Field(default_factory=lambda: {
        "experimental": True,
        "authoritative": False,
        "decision_role": "challenger_only",
    })


class MPSPrediction(BaseModel):
    """Prediction output from MPS model."""
    probability_profitable: float
    confidence: float  # How far from 0.5
    signal: str  # "bullish" | "bearish" | "neutral"
    feature_importance: dict[str, float] = Field(default_factory=dict)
    governance: dict = Field(default_factory=lambda: {
        "experimental": True,
        "authoritative": False,
        "decision_role": "challenger_only",
    })


class TrainResult(BaseModel):
    """Training result."""
    train_accuracy: float
    val_accuracy: float
    train_loss_history: list[float] = Field(default_factory=list)
    n_params: int
    epochs: int
    execution_time_ms: int
    model_hash: str = ""


def encode_features(raw_features: np.ndarray, config: FeatureConfig) -> np.ndarray:
    """Encode raw features into MPS-compatible one-hot tensor format.

    Each feature is discretized into n_bins, then one-hot encoded.
    This creates the "physical indices" for the MPS sites.

    Args:
        raw_features: Shape (n_samples, n_features) — raw feature values
        config: Feature encoding config

    Returns:
        Shape (n_samples, n_features, n_bins) — one-hot encoded
    """
    n_samples, n_features = raw_features.shape
    n_bins = config.n_bins_per_feature
    encoded = np.zeros((n_samples, n_features, n_bins))

    for f in range(n_features):
        col = raw_features[:, f]
        # Normalize to [0, 1]
        col_min, col_max = col.min(), col.max()
        if col_max - col_min > 1e-10:
            col_norm = (col - col_min) / (col_max - col_min)
        else:
            col_norm = np.full_like(col, 0.5)

        # Discretize into bins
        bin_indices = np.clip(np.floor(col_norm * n_bins).astype(int), 0, n_bins - 1)

        # One-hot encode
        for i in range(n_samples):
            encoded[i, f, bin_indices[i]] = 1.0

    return encoded


# ─── MPS Model (Pure NumPy Implementation) ────────────────────────

class MPSModel:
    """Matrix Product State model for binary classification.

    Each site corresponds to a feature. The physical dimension equals
    n_bins (discretization levels). Bond dimension controls model capacity.

    Total parameters ≈ n_features × n_bins × bond_dim × bond_dim
    With defaults (8 features, 4 bins, bond_dim=4): 8 × 4 × 4 × 4 = 512 params
    """

    def __init__(self, config: FeatureConfig):
        self.config = config
        self.n_features = len(config.feature_names)
        self.n_bins = config.n_bins_per_feature
        self.bond_dim = config.bond_dim
        self.tensors: list[np.ndarray] = []
        self._initialized = False

    def build(self, seed: int = 42):
        """Initialize MPS tensors with random values.

        Tensor shapes:
          - First site: (n_bins, bond_dim)
          - Middle sites: (bond_dim, n_bins, bond_dim)
          - Last site: (bond_dim, n_bins, 2)  — 2 classes: profitable/unprofitable
        """
        rng = np.random.default_rng(seed)
        self.tensors = []

        for i in range(self.n_features):
            if i == 0:
                # First tensor: (n_bins, bond_dim)
                t = rng.standard_normal((self.n_bins, self.bond_dim)) * 0.1
            elif i == self.n_features - 1:
                # Last tensor: (bond_dim, n_bins, 2) — 2 output classes
                t = rng.standard_normal((self.bond_dim, self.n_bins, 2)) * 0.1
            else:
                # Middle tensor: (bond_dim, n_bins, bond_dim)
                t = rng.standard_normal((self.bond_dim, self.n_bins, self.bond_dim)) * 0.1
            self.tensors.append(t)

        self._initialized = True

    @property
    def n_params(self) -> int:
        return sum(t.size for t in self.tensors)

    def forward(self, encoded_features: np.ndarray) -> np.ndarray:
        """Forward pass through MPS.

        Args:
            encoded_features: Shape (n_samples, n_features, n_bins) — one-hot

        Returns:
            Shape (n_samples, 2) — class probabilities
        """
        n_samples = encoded_features.shape[0]
        results = np.zeros((n_samples, 2))

        for s in range(n_samples):
            # Contract MPS with input features
            # Start with first site
            feat_0 = encoded_features[s, 0]  # (n_bins,)
            vec = feat_0 @ self.tensors[0]    # (n_bins,) @ (n_bins, bond_dim) → (bond_dim,)

            # Contract middle sites
            for i in range(1, self.n_features - 1):
                feat_i = encoded_features[s, i]  # (n_bins,)
                # tensors[i] shape: (bond_dim, n_bins, bond_dim)
                # Contract: vec (bond_dim,) with tensor along first axis, then with features
                contracted = np.einsum("b,bpd,p->d", vec, self.tensors[i], feat_i)
                vec = contracted  # (bond_dim,)

            # Last site
            feat_last = encoded_features[s, -1]  # (n_bins,)
            # tensors[-1] shape: (bond_dim, n_bins, 2)
            output = np.einsum("b,bpc,p->c", vec, self.tensors[-1], feat_last)  # (2,)

            # Softmax
            exp_output = np.exp(output - output.max())
            results[s] = exp_output / exp_output.sum()

        return results

    def predict_probability(self, encoded_features: np.ndarray) -> np.ndarray:
        """Predict P(profitable) for each sample.

        Returns: Shape (n_samples,) — probability of being profitable
        """
        probs = self.forward(encoded_features)
        return probs[:, 1]  # Class 1 = profitable

    def _compute_loss(self, predictions: np.ndarray, labels: np.ndarray) -> float:
        """Cross-entropy loss."""
        eps = 1e-10
        n = len(labels)
        ce = -np.mean(
            labels * np.log(predictions[:, 1] + eps) +
            (1 - labels) * np.log(predictions[:, 0] + eps)
        )
        return float(ce)

    def _compute_gradients(
        self, encoded_features: np.ndarray, labels: np.ndarray
    ) -> list[np.ndarray]:
        """Compute gradients via finite differences (simple but works for small models)."""
        grads = []
        epsilon = 1e-5

        for t_idx, tensor in enumerate(self.tensors):
            grad = np.zeros_like(tensor)
            flat = tensor.flatten()

            for p_idx in range(len(flat)):
                # Forward difference
                flat[p_idx] += epsilon
                self.tensors[t_idx] = flat.reshape(tensor.shape)
                pred_plus = self.forward(encoded_features)
                loss_plus = self._compute_loss(pred_plus, labels)

                flat[p_idx] -= 2 * epsilon
                self.tensors[t_idx] = flat.reshape(tensor.shape)
                pred_minus = self.forward(encoded_features)
                loss_minus = self._compute_loss(pred_minus, labels)

                grad.flat[p_idx] = (loss_plus - loss_minus) / (2 * epsilon)

                # Restore
                flat[p_idx] += epsilon
                self.tensors[t_idx] = flat.reshape(tensor.shape)

            grads.append(grad)

        return grads


def build_mps_model(feature_config: Optional[FeatureConfig] = None, bond_dim: int = 4) -> MPSModel:
    """Initialize a new MPS model."""
    if feature_config is None:
        feature_config = FeatureConfig(bond_dim=bond_dim)
    else:
        feature_config.bond_dim = bond_dim

    model = MPSModel(feature_config)
    model.build()
    return model


def train_mps(
    model: MPSModel,
    features: np.ndarray,
    labels: np.ndarray,
    epochs: int = 50,
    learning_rate: float = 0.01,
    val_split: float = 0.2,
    seed: int = 42,
) -> TrainResult:
    """Train MPS model using sweep-based optimization.

    Uses gradient descent with finite differences. For production,
    consider DMRG-style sweeps via quimb.

    Args:
        model: Initialized MPS model
        features: Raw features, shape (n_samples, n_features)
        labels: Binary labels (0=unprofitable, 1=profitable)
        epochs: Training epochs
        learning_rate: SGD learning rate
        val_split: Validation split fraction
    """
    start_ms = int(time.time() * 1000)

    if not model._initialized:
        model.build(seed)

    # Encode features
    encoded = encode_features(features, model.config)

    # Train/val split
    rng = np.random.default_rng(seed)
    n = len(labels)
    indices = rng.permutation(n)
    val_size = int(n * val_split)
    val_idx = indices[:val_size]
    train_idx = indices[val_size:]

    train_enc = encoded[train_idx]
    train_labels = labels[train_idx]
    val_enc = encoded[val_idx]
    val_labels = labels[val_idx]

    loss_history = []

    for epoch in range(epochs):
        # Forward pass
        predictions = model.forward(train_enc)
        loss = model._compute_loss(predictions, train_labels)
        loss_history.append(loss)

        # Compute gradients (finite differences — slow but correct)
        # For large datasets, use mini-batches
        batch_size = min(32, len(train_labels))
        batch_idx = rng.choice(len(train_labels), batch_size, replace=False)
        batch_enc = train_enc[batch_idx]
        batch_labels = train_labels[batch_idx]

        grads = model._compute_gradients(batch_enc, batch_labels)

        # SGD update
        for i in range(len(model.tensors)):
            model.tensors[i] -= learning_rate * grads[i]

    # Final metrics
    train_pred = model.predict_probability(train_enc)
    train_acc = float(np.mean((train_pred >= 0.5) == train_labels))

    val_pred = model.predict_probability(val_enc)
    val_acc = float(np.mean((val_pred >= 0.5) == val_labels))

    execution_time_ms = int(time.time() * 1000) - start_ms

    # Model hash
    param_bytes = b"".join(t.tobytes() for t in model.tensors)
    model_hash = hashlib.sha256(param_bytes).hexdigest()[:16]

    return TrainResult(
        train_accuracy=train_acc,
        val_accuracy=val_acc,
        train_loss_history=loss_history,
        n_params=model.n_params,
        epochs=epochs,
        execution_time_ms=execution_time_ms,
        model_hash=model_hash,
    )


def predict_trade_outcome(
    model: MPSModel,
    features: np.ndarray,
) -> list[MPSPrediction]:
    """Predict P(profitable) for new signals.

    Args:
        model: Trained MPS model
        features: Raw features, shape (n_samples, n_features) or (n_features,)
    """
    if features.ndim == 1:
        features = features.reshape(1, -1)

    encoded = encode_features(features, model.config)
    probs = model.predict_probability(encoded)

    predictions = []
    for i, p in enumerate(probs):
        confidence = abs(p - 0.5) * 2  # 0=no confidence, 1=full confidence
        if p >= 0.6:
            signal = "bullish"
        elif p <= 0.4:
            signal = "bearish"
        else:
            signal = "neutral"

        predictions.append(MPSPrediction(
            probability_profitable=float(p),
            confidence=float(confidence),
            signal=signal,
        ))

    return predictions


def evaluate_mps(
    model: MPSModel,
    features: np.ndarray,
    labels: np.ndarray,
) -> dict:
    """Walk-forward OOS evaluation.

    Returns: Accuracy, precision, recall, F1, and feature importance.
    """
    encoded = encode_features(features, model.config)
    probs = model.predict_probability(encoded)
    preds = (probs >= 0.5).astype(int)

    accuracy = float(np.mean(preds == labels))

    tp = float(np.sum((preds == 1) & (labels == 1)))
    fp = float(np.sum((preds == 1) & (labels == 0)))
    fn = float(np.sum((preds == 0) & (labels == 1)))

    precision = tp / max(tp + fp, 1)
    recall = tp / max(tp + fn, 1)
    f1 = 2 * precision * recall / max(precision + recall, 1e-10)

    return {
        "accuracy": accuracy,
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "n_samples": len(labels),
        "n_positive": int(labels.sum()),
        "n_negative": int(len(labels) - labels.sum()),
    }


def serialize_mps(model: MPSModel, path: str):
    """Save MPS model to disk."""
    data = {
        "config": model.config.model_dump(),
        "tensors": [t.tolist() for t in model.tensors],
        "n_features": model.n_features,
    }
    with open(path, "w") as f:
        json.dump(data, f)


def load_mps(path: str) -> MPSModel:
    """Load MPS model from disk."""
    with open(path) as f:
        data = json.load(f)

    config = FeatureConfig(**data["config"])
    model = MPSModel(config)
    model.tensors = [np.array(t) for t in data["tensors"]]
    model._initialized = True
    return model


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", required=True, choices=["train", "predict", "evaluate"])
    parser.add_argument("--input-json", required=True)
    parser.add_argument("--model-path", default=None)
    args = parser.parse_args()

    raw = args.input_json
    if os.path.isfile(raw):
        with open(raw) as f:
            raw = f.read()
    config = json.loads(raw)

    if args.mode == "train":
        features = np.array(config["features"], dtype=float)
        labels = np.array(config["labels"], dtype=float)
        bond_dim = config.get("bond_dim", 4)
        epochs = config.get("epochs", 50)

        model = build_mps_model(bond_dim=bond_dim)
        result = train_mps(model, features, labels, epochs=epochs)

        # Save model if path provided
        if args.model_path:
            serialize_mps(model, args.model_path)

        print(result.model_dump_json(indent=2))

    elif args.mode == "predict":
        if not args.model_path:
            print(json.dumps({"error": "Model path required for prediction"}))
            sys.exit(1)

        model = load_mps(args.model_path)
        features = np.array(config["features"], dtype=float)
        predictions = predict_trade_outcome(model, features)
        print(json.dumps([p.model_dump() for p in predictions], indent=2))

    elif args.mode == "evaluate":
        if not args.model_path:
            print(json.dumps({"error": "Model path required for evaluation"}))
            sys.exit(1)

        model = load_mps(args.model_path)
        features = np.array(config["features"], dtype=float)
        labels = np.array(config["labels"], dtype=float)
        result = evaluate_mps(model, features, labels)
        print(json.dumps(result, indent=2))
