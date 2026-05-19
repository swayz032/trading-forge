"""Tests for surface_code_encoder.py — Tier 4.5 (W4)

Test categories:
  - Isolation: encoder output is challenger-only evidence only
  - Schema regression: EncoderResult shape stability
  - Surface code geometry: d=3, 9 data + 8 ancilla = 17 physical per logical
  - Reproducibility: same inputs → same circuit structure
  - Failure handling: graceful degradation when qiskit unavailable
"""
import sys
import types
import unittest
from unittest.mock import MagicMock, patch


# ─── Isolation test: no leakage into execution paths ─────────────────────────

class TestEncoderIsolation(unittest.TestCase):
    """Verify authority boundary: encoder never returns authoritative=True."""

    def test_governance_labels_challenger_only(self):
        """EncoderResult.governance_labels must have authoritative=False."""
        from src.engine.surface_code_encoder import encode_iae_for_surface_code
        result = encode_iae_for_surface_code(n_logical_qubits=1)
        # governance_labels must be present
        self.assertIn("authoritative", result.governance_labels)
        self.assertFalse(result.governance_labels["authoritative"])
        self.assertEqual(result.governance_labels["decision_role"], "challenger_only")
        self.assertTrue(result.governance_labels["experimental"])

    def test_encoder_does_not_import_lifecycle_service(self):
        """Encoder module must not import lifecycle-service or execute promotions."""
        # Import the module
        from src.engine import surface_code_encoder
        module_source = open(surface_code_encoder.__file__).read()
        # These are import-or-call checks — comments saying "never blocks promotion" are fine
        # We check for IMPORT or CALL patterns, not commentary text
        forbidden_imports = ["import lifecycle", "from lifecycle", "promoteStrategy",
                             "import execution_authority"]
        for term in forbidden_imports:
            self.assertNotIn(term, module_source,
                             f"surface_code_encoder.py must not import/call '{term}'")


# ─── Schema regression: EncoderResult shape ───────────────────────────────────

class TestEncoderResultSchema(unittest.TestCase):
    """EncoderResult fields must remain stable across refactors."""

    def test_result_has_required_fields(self):
        from src.engine.surface_code_encoder import encode_iae_for_surface_code
        result = encode_iae_for_surface_code(n_logical_qubits=1)
        required_fields = [
            "circuit", "n_logical_qubits", "n_physical_qubits",
            "surface_code_distance", "success", "error_message",
            "encode_duration_ms", "governance_labels",
        ]
        for field in required_fields:
            self.assertTrue(hasattr(result, field), f"Missing field: {field}")

    def test_distance_is_always_3(self):
        from src.engine.surface_code_encoder import encode_iae_for_surface_code
        result = encode_iae_for_surface_code(n_logical_qubits=5)
        self.assertEqual(result.surface_code_distance, 3)

    def test_encode_duration_ms_is_non_negative(self):
        from src.engine.surface_code_encoder import encode_iae_for_surface_code
        result = encode_iae_for_surface_code(n_logical_qubits=1)
        self.assertGreaterEqual(result.encode_duration_ms, 0)


# ─── Surface code geometry tests ──────────────────────────────────────────────

class TestSurfaceCodeGeometry(unittest.TestCase):
    """Verify d=3 rotated surface code qubit counts."""

    DATA_PER_LOGICAL = 9
    ANCILLA_PER_LOGICAL = 8
    PHYSICAL_PER_LOGICAL = 17

    def test_single_logical_qubit_counts(self):
        from src.engine.surface_code_encoder import encode_iae_for_surface_code
        result = encode_iae_for_surface_code(n_logical_qubits=1)
        self.assertEqual(result.n_logical_qubits, 1)
        self.assertEqual(result.n_physical_qubits, self.PHYSICAL_PER_LOGICAL)

    def test_five_logical_qubits_counts(self):
        """5 logical qubits → 85 physical (fits 156-qubit Heron)."""
        from src.engine.surface_code_encoder import encode_iae_for_surface_code
        result = encode_iae_for_surface_code(n_logical_qubits=5)
        self.assertEqual(result.n_logical_qubits, 5)
        self.assertEqual(result.n_physical_qubits, 5 * self.PHYSICAL_PER_LOGICAL)
        # Must fit in 156-qubit Heron
        self.assertLessEqual(result.n_physical_qubits, 156)

    def _get_circuit_qubit_count(self, result):
        """Extract total qubit count from qiskit QuantumCircuit."""
        if result.circuit is None:
            return None
        return result.circuit.num_qubits

    def test_circuit_total_qubits_matches_physical_count(self):
        from src.engine.surface_code_encoder import encode_iae_for_surface_code
        result = encode_iae_for_surface_code(n_logical_qubits=3)
        if result.success and result.circuit is not None:
            actual_qubits = self._get_circuit_qubit_count(result)
            self.assertEqual(actual_qubits, result.n_physical_qubits)

    def test_circuit_syndrome_bits_count(self):
        """Syndrome register = 8 ancilla per logical qubit."""
        from src.engine.surface_code_encoder import encode_iae_for_surface_code, ANCILLA_QUBITS_PER_LOGICAL
        result = encode_iae_for_surface_code(n_logical_qubits=2)
        if result.success and result.circuit is not None:
            syndrome_bits = result.circuit.num_clbits
            self.assertEqual(syndrome_bits, 2 * ANCILLA_QUBITS_PER_LOGICAL)


# ─── Reproducibility tests ────────────────────────────────────────────────────

class TestEncoderReproducibility(unittest.TestCase):
    """Same inputs should produce circuits with identical structure."""

    def test_same_logical_count_produces_same_depth(self):
        from src.engine.surface_code_encoder import encode_iae_for_surface_code
        r1 = encode_iae_for_surface_code(n_logical_qubits=2)
        r2 = encode_iae_for_surface_code(n_logical_qubits=2)
        if r1.success and r2.success and r1.circuit and r2.circuit:
            self.assertEqual(r1.circuit.depth(), r2.circuit.depth())
            self.assertEqual(r1.circuit.num_qubits, r2.circuit.num_qubits)

    def test_physical_count_scales_linearly(self):
        """Physical qubits must scale as n_logical * 17."""
        from src.engine.surface_code_encoder import encode_iae_for_surface_code
        for n in [1, 2, 3, 5]:
            result = encode_iae_for_surface_code(n_logical_qubits=n)
            self.assertEqual(result.n_physical_qubits, n * 17,
                             f"n={n}: expected {n*17}, got {result.n_physical_qubits}")


# ─── Failure handling: qiskit unavailable ─────────────────────────────────────

class TestEncoderFailureHandling(unittest.TestCase):
    """Encoder must degrade gracefully when qiskit is unavailable."""

    def test_qiskit_unavailable_returns_failure_result(self):
        """If qiskit not available, success=False with error_message set."""
        import src.engine.surface_code_encoder as enc_module
        original_available = enc_module.QISKIT_AVAILABLE
        try:
            enc_module.QISKIT_AVAILABLE = False
            result = enc_module.encode_iae_for_surface_code(n_logical_qubits=2)
            self.assertFalse(result.success)
            self.assertIsNone(result.circuit)
            self.assertIsNotNone(result.error_message)
            # Geometry fields still set correctly
            self.assertEqual(result.n_logical_qubits, 2)
            self.assertEqual(result.n_physical_qubits, 34)
        finally:
            enc_module.QISKIT_AVAILABLE = original_available

    def test_failure_result_still_has_governance_labels(self):
        """Even on failure, governance_labels must be set correctly."""
        import src.engine.surface_code_encoder as enc_module
        original_available = enc_module.QISKIT_AVAILABLE
        try:
            enc_module.QISKIT_AVAILABLE = False
            result = enc_module.encode_iae_for_surface_code(n_logical_qubits=1)
            self.assertFalse(result.governance_labels.get("authoritative"))
            self.assertEqual(result.governance_labels.get("decision_role"), "challenger_only")
        finally:
            enc_module.QISKIT_AVAILABLE = original_available


if __name__ == "__main__":
    unittest.main()
