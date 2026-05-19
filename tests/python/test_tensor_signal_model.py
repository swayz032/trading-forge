"""Tests for MPS tensor network signal model."""
import numpy as np
import pytest
from src.engine.tensor_signal_model import (
    build_mps_model, train_mps, predict_trade_outcome,
    evaluate_mps, encode_features, serialize_mps, load_mps,
    FeatureConfig, MPSModel,
)


class TestTensorSignalModel:
    def _make_data(self, n=100, seed=42):
        rng = np.random.default_rng(seed)
        features = rng.standard_normal((n, 8))
        labels = (features[:, 0] > 0).astype(float)  # Simple rule for testing
        return features, labels

    def test_build_model(self):
        model = build_mps_model(bond_dim=4)
        assert model.n_features == 8
        assert model.bond_dim == 4
        assert model.n_params > 0

    def test_encode_features(self):
        features = np.random.default_rng(42).standard_normal((10, 8))
        config = FeatureConfig()
        encoded = encode_features(features, config)
        assert encoded.shape == (10, 8, 4)
        # Each row should be one-hot
        for i in range(10):
            for f in range(8):
                assert encoded[i, f].sum() == pytest.approx(1.0)

    def test_train_returns_result(self):
        features, labels = self._make_data(50)
        model = build_mps_model(bond_dim=2)
        result = train_mps(model, features, labels, epochs=5)
        assert 0 <= result.train_accuracy <= 1
        assert 0 <= result.val_accuracy <= 1
        assert result.n_params > 0

    def test_predict_returns_probabilities(self):
        features, labels = self._make_data(50)
        model = build_mps_model(bond_dim=2)
        train_mps(model, features, labels, epochs=3)
        predictions = predict_trade_outcome(model, features[:5])
        assert len(predictions) == 5
        for p in predictions:
            assert 0 <= p.probability_profitable <= 1
            assert p.signal in ("bullish", "bearish", "neutral")

    def test_evaluate_returns_metrics(self):
        features, labels = self._make_data(50)
        model = build_mps_model(bond_dim=2)
        train_mps(model, features, labels, epochs=3)
        metrics = evaluate_mps(model, features[:20], labels[:20])
        assert "accuracy" in metrics
        assert "precision" in metrics
        assert "f1" in metrics

    def test_single_sample_prediction(self):
        model = build_mps_model(bond_dim=2)
        model.build()
        features = np.random.default_rng(42).standard_normal(8)
        predictions = predict_trade_outcome(model, features)
        assert len(predictions) == 1

    def test_serialize_deserialize(self, tmp_path):
        model = build_mps_model(bond_dim=2)
        model.build()
        path = str(tmp_path / "model.json")
        serialize_mps(model, path)
        loaded = load_mps(path)
        assert loaded.n_features == model.n_features
        assert loaded.bond_dim == model.bond_dim
        assert len(loaded.tensors) == len(model.tensors)
