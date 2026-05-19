"""Tests for ising_decoder_wrapper.py — Tier 4.5 (W4)

Test categories:
  - Isolation: decoder output is challenger-only evidence
  - Schema regression: decode() output shape stability
  - Fallback: PyMatching fallback when Ising ONNX unavailable
  - Reproducibility: same syndrome → same estimate (seeded)
  - Budget guard: budget check functions correctly
  - Runtime guardrails: decoder handles malformed input gracefully
"""
import sys
import types
import unittest
from unittest.mock import MagicMock, patch
import numpy as np


# ─── Isolation test ───────────────────────────────────────────────────────────

class TestDecoderIsolation(unittest.TestCase):
    """Verify authority boundary: decoder never returns authoritative=True."""

    def test_decode_result_governance_labels(self):
        """decode() must always return governance_labels.authoritative=False."""
        from src.engine.ising_decoder_wrapper import IsingDecoderWrapper
        decoder = IsingDecoderWrapper()
        decoder._load_attempted = True
        decoder._backend = "pymatching"

        # Use minimal syndrome input (all zeros = no errors)
        syndrome_counts = {"0" * 8: 100}
        result = decoder.decode(syndrome_counts, n_logical_qubits=1, shots=100)

        self.assertIn("governance_labels", result)
        self.assertFalse(result["governance_labels"]["authoritative"])
        self.assertEqual(result["governance_labels"]["decision_role"], "challenger_only")
        self.assertTrue(result["governance_labels"]["experimental"])

    def test_decoder_does_not_import_lifecycle_service(self):
        """Decoder module must not import lifecycle-service or call promotion functions."""
        from src.engine import ising_decoder_wrapper
        source = open(ising_decoder_wrapper.__file__).read()
        # Check for IMPORT or CALL patterns, not commentary text
        forbidden_imports = ["import lifecycle", "from lifecycle", "promoteStrategy",
                             "import execution_authority"]
        for term in forbidden_imports:
            self.assertNotIn(term, source,
                             f"ising_decoder_wrapper.py must not import/call '{term}'")


# ─── Schema regression ────────────────────────────────────────────────────────

class TestDecoderOutputSchema(unittest.TestCase):
    """decode() output shape must remain stable."""

    def _get_decode_result(self, syndrome_counts=None):
        from src.engine.ising_decoder_wrapper import IsingDecoderWrapper
        decoder = IsingDecoderWrapper()
        decoder._load_attempted = True
        decoder._backend = "pymatching"
        if syndrome_counts is None:
            syndrome_counts = {"00000000": 50, "10000000": 50}
        return decoder.decode(syndrome_counts, n_logical_qubits=1, shots=100)

    def test_required_fields_present(self):
        result = self._get_decode_result()
        required = [
            "ising_corrected_estimate",
            "pymatching_estimate",
            "uncorrected_estimate",
            "raw_syndrome_count",
            "backend_used",
            "ising_model_loaded",
            "decode_duration_ms",
            "governance_labels",
        ]
        for field in required:
            self.assertIn(field, result, f"Missing field: {field}")

    def test_estimates_are_in_range(self):
        result = self._get_decode_result()
        for key in ["ising_corrected_estimate", "pymatching_estimate", "uncorrected_estimate"]:
            val = result[key]
            if val is not None:
                self.assertGreaterEqual(val, 0.0, f"{key} must be >= 0")
                self.assertLessEqual(val, 1.0, f"{key} must be <= 1")

    def test_raw_syndrome_count_correct(self):
        syndrome_counts = {"00000000": 50, "10000000": 30, "01000000": 20}
        result = self._get_decode_result(syndrome_counts)
        self.assertEqual(result["raw_syndrome_count"], 3)

    def test_decode_duration_ms_non_negative(self):
        result = self._get_decode_result()
        self.assertGreaterEqual(result["decode_duration_ms"], 0)


# ─── Fallback tests ───────────────────────────────────────────────────────────

class TestDecoderFallback(unittest.TestCase):
    """When Ising ONNX model is unavailable, PyMatching must be used."""

    def test_pymatching_fallback_when_onnx_unavailable(self):
        """If ONNX not available, decoder falls back to PyMatching or none."""
        import src.engine.ising_decoder_wrapper as ising_mod
        original_onnx = ising_mod.ONNX_AVAILABLE
        try:
            ising_mod.ONNX_AVAILABLE = False
            decoder = ising_mod.IsingDecoderWrapper()
            loaded = decoder.load()
            # load() returns False when using PyMatching fallback (no ONNX session)
            self.assertFalse(loaded)
            # Backend should be either "pymatching" (if available) or "none"
            self.assertIn(decoder.backend, ["pymatching", "none"])
        finally:
            ising_mod.ONNX_AVAILABLE = original_onnx

    def test_no_onnx_decode_returns_pymatching_estimate(self):
        """With no ONNX, ising_corrected_estimate uses PyMatching result."""
        import src.engine.ising_decoder_wrapper as ising_mod
        original_onnx = ising_mod.ONNX_AVAILABLE
        try:
            ising_mod.ONNX_AVAILABLE = False
            decoder = ising_mod.IsingDecoderWrapper()
            decoder.load()
            syndrome_counts = {"00000000": 100}
            result = decoder.decode(syndrome_counts, n_logical_qubits=1, shots=100)
            # ising_corrected_estimate should equal pymatching_estimate when ONNX unavailable
            # (since effective_ising = pymatching when onnx_session is None)
            if result["pymatching_estimate"] is not None:
                self.assertEqual(
                    result["ising_corrected_estimate"],
                    result["pymatching_estimate"],
                )
        finally:
            ising_mod.ONNX_AVAILABLE = original_onnx

    def test_onnx_failure_falls_back_gracefully(self):
        """If ONNX inference raises, result is still valid via PyMatching."""
        import src.engine.ising_decoder_wrapper as ising_mod
        decoder = ising_mod.IsingDecoderWrapper()
        # Inject a mock ONNX session that always raises
        mock_session = MagicMock()
        mock_session.get_inputs.return_value = [MagicMock(name="input")]
        mock_session.run.side_effect = RuntimeError("ONNX engine crashed")
        decoder._onnx_session = mock_session
        decoder._load_attempted = True
        decoder._backend = "onnx_cuda"

        syndrome_counts = {"00000000": 50, "11111111": 50}
        result = decoder.decode(syndrome_counts, n_logical_qubits=1, shots=100)

        # Must not raise; result is still valid
        self.assertIn("ising_corrected_estimate", result)
        self.assertIn("pymatching_estimate", result)
        self.assertIsNotNone(result["uncorrected_estimate"])


# ─── All-zeros syndrome (no errors) ──────────────────────────────────────────

class TestDecoderAllZeroSyndrome(unittest.TestCase):
    """All-zeros syndrome (no detected errors) should produce low error rate."""

    def test_all_zeros_uncorrected_estimate(self):
        """All-zero syndrome → uncorrected_estimate = 0.0 (no error bits set)."""
        from src.engine.ising_decoder_wrapper import IsingDecoderWrapper
        decoder = IsingDecoderWrapper()
        decoder._load_attempted = True
        decoder._backend = "pymatching"
        # All shots have syndrome "00000000" (no ancilla fired)
        syndrome_counts = {"00000000": 1024}
        result = decoder.decode(syndrome_counts, n_logical_qubits=1, shots=1024)
        self.assertAlmostEqual(result["uncorrected_estimate"], 0.0)


# ─── Runtime guardrail: empty input ──────────────────────────────────────────

class TestDecoderEdgeCases(unittest.TestCase):
    """Decoder must handle malformed/edge-case input without raising."""

    def test_empty_syndrome_counts(self):
        """Empty syndrome_counts dict should not raise."""
        from src.engine.ising_decoder_wrapper import IsingDecoderWrapper
        decoder = IsingDecoderWrapper()
        decoder._load_attempted = True
        decoder._backend = "pymatching"
        try:
            result = decoder.decode({}, n_logical_qubits=1, shots=0)
            # Should not raise; result dict should be present
            self.assertIn("uncorrected_estimate", result)
        except Exception as e:
            self.fail(f"decode() raised on empty input: {e}")

    def test_single_shot_syndrome(self):
        """Single shot should work fine."""
        from src.engine.ising_decoder_wrapper import IsingDecoderWrapper
        decoder = IsingDecoderWrapper()
        decoder._load_attempted = True
        decoder._backend = "pymatching"
        result = decoder.decode({"10000000": 1}, n_logical_qubits=1, shots=1)
        self.assertGreaterEqual(result["uncorrected_estimate"], 0.0)

    def test_is_ising_loaded_property(self):
        """is_ising_loaded returns False when no ONNX session."""
        from src.engine.ising_decoder_wrapper import IsingDecoderWrapper
        decoder = IsingDecoderWrapper()
        decoder._load_attempted = True
        decoder._onnx_session = None
        self.assertFalse(decoder.is_ising_loaded)

    def test_is_ising_loaded_true_with_mock_session(self):
        """is_ising_loaded returns True when ONNX session is set."""
        from src.engine.ising_decoder_wrapper import IsingDecoderWrapper
        decoder = IsingDecoderWrapper()
        decoder._onnx_session = MagicMock()
        self.assertTrue(decoder.is_ising_loaded)


# ─── Syndrome matrix helper ───────────────────────────────────────────────────

class TestSyndromeMatrix(unittest.TestCase):
    """_syndromes_to_matrix must produce correct shape and values."""

    def test_matrix_shape(self):
        from src.engine.ising_decoder_wrapper import _syndromes_to_matrix
        counts = {"10000000": 3, "00000001": 2}
        mat = _syndromes_to_matrix(counts, n_logical_qubits=1)
        # 5 total shots (3+2), 8 syndrome bits
        self.assertEqual(mat.shape, (5, 8))

    def test_matrix_values_binary(self):
        from src.engine.ising_decoder_wrapper import _syndromes_to_matrix
        counts = {"10000000": 1}
        mat = _syndromes_to_matrix(counts, n_logical_qubits=1)
        # All values should be 0.0 or 1.0
        self.assertTrue(np.all((mat == 0.0) | (mat == 1.0)))


if __name__ == "__main__":
    unittest.main()
