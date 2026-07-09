"""Deep-scan Q-2 regression: classical fallbacks must NOT be labeled method="sqa".

When neal/dwave is unavailable, ``qubo_trade_timing.solve_timing()`` runs a greedy
classical selection and ``quantum_annealing_optimizer.run_sqa_optimization()`` runs a
classical random search. Both previously inherited the pydantic model default
``method="sqa"``, mislabeling a purely-classical result as simulated quantum annealing
and corrupting the SQA-vs-classical comparison these challenger modules exist to produce.

These tests pin BOTH branches via monkeypatch so they are deterministic regardless of
whether ``neal`` happens to be installed in the runner.
"""
import src.engine.quantum_annealing_optimizer as qao
import src.engine.qubo_trade_timing as qtt


def _blocks(n=3):
    return [qtt.SessionBlock(index=i, time_range=f"{9 + i}:30-{10 + i}:00") for i in range(n)]


def test_decode_default_labels_greedy_when_neal_unavailable(monkeypatch):
    monkeypatch.setattr(qtt, "NEAL_AVAILABLE", False)
    s = qtt.decode_timing_schedule([True, False, True], _blocks())
    assert s.method == "greedy_classical_fallback"


def test_decode_default_labels_sqa_when_neal_available(monkeypatch):
    monkeypatch.setattr(qtt, "NEAL_AVAILABLE", True)
    s = qtt.decode_timing_schedule([True, False, True], _blocks())
    assert s.method == "sqa"


def test_decode_explicit_method_override_is_honored():
    s = qtt.decode_timing_schedule([True], _blocks(1), method="greedy_classical_fallback")
    assert s.method == "greedy_classical_fallback"


def test_run_sqa_optimization_labels_classical_random_search_when_neal_unavailable(monkeypatch):
    monkeypatch.setattr(qao, "NEAL_AVAILABLE", False)
    monkeypatch.setattr(qao, "_sqa_cache", None)
    param_ranges = [qao.ParamRange(name="p", min_val=0.0, max_val=1.0, n_bits=2)]
    qubo = {(0, 0): -1.0, (1, 1): 0.5}
    res = qao.run_sqa_optimization(qubo, param_ranges, num_reads=5, seed=42)
    assert res.method == "classical_random_search"
    assert res.method != "sqa"
