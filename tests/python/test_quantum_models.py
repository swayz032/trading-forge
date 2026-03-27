"""Tests for uncertainty model fitting."""
import numpy as np
import pytest
from src.engine.quantum_models import (
    fit_truncated_normal, fit_mixture_model,
    fit_regime_bucket_model, build_empirical_binned_distribution,
    serialize_uncertainty_model, deserialize_uncertainty_model,
    UncertaintyModel,
)


class TestQuantumModels:
    def _make_data(self, n=200, seed=42):
        rng = np.random.default_rng(seed)
        return rng.normal(100, 50, n)

    def test_truncated_normal_fit(self):
        data = self._make_data()
        model = fit_truncated_normal(data)
        assert model.model_type == "truncated_normal"
        assert model.n_samples == 200
        assert model.bins is not None
        assert model.probabilities is not None
        assert abs(sum(model.probabilities) - 1.0) < 0.01

    def test_truncated_normal_with_bounds(self):
        data = self._make_data()
        model = fit_truncated_normal(data, bounds=(0, 300))
        assert model.bounds == (0, 300)

    def test_mixture_model_fit(self):
        data = self._make_data()
        model = fit_mixture_model(data, n_components=2)
        assert model.model_type == "mixture"
        assert model.parameters["n_components"] >= 1
        assert abs(sum(model.probabilities) - 1.0) < 0.01

    def test_regime_bucket_model(self):
        data = self._make_data(100)
        labels = np.array(["bull"] * 50 + ["bear"] * 50)
        model = fit_regime_bucket_model(data, labels)
        assert model.model_type == "regime_bucket"
        assert "bull" in model.parameters["regimes"]

    def test_empirical_binned(self):
        data = self._make_data()
        model = build_empirical_binned_distribution(data, n_bins=16)
        assert model.model_type == "empirical_binned"
        assert len(model.probabilities) >= 10  # numpy may merge empty edge bins
        assert abs(sum(model.probabilities) - 1.0) < 0.01

    def test_serialization_roundtrip(self):
        data = self._make_data()
        model = fit_truncated_normal(data)
        json_str = serialize_uncertainty_model(model)
        restored = deserialize_uncertainty_model(json_str)
        assert restored.model_type == model.model_type
        assert restored.n_samples == model.n_samples

    def test_small_dataset(self):
        data = np.array([10.0, 20.0, 30.0])
        model = fit_truncated_normal(data)
        assert model.probabilities is not None
        assert len(model.probabilities) > 0

    def test_constant_data(self):
        data = np.full(50, 100.0)
        model = fit_truncated_normal(data)
        assert model.probabilities is not None
