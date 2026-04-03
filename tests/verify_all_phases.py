"""Comprehensive verification of all plan phases — functional tests."""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import numpy as np

passed = 0
failed = 0

def check(name, condition, detail=""):
    global passed, failed
    if condition:
        passed += 1
        print(f"  PASS: {name} {detail}")
    else:
        failed += 1
        print(f"  FAIL: {name} {detail}")


print("=== Test 1: Critic end-to-end ===")
from src.engine.critic_optimizer import run_critic_optimizer
result = run_critic_optimizer({
    "strategy_config": {
        "indicators": [{"type": "sma", "period": 20}, {"type": "rsi", "period": 14}, {"type": "atr", "period": 14}],
        "stop_loss": {"multiplier": 2.0},
    },
    "backtest_metrics": {
        "total_return": 15000, "sharpe_ratio": 1.8, "max_drawdown": -1500,
        "win_rate": 0.65, "profit_factor": 2.2, "avg_daily_pnl": 350,
    },
    "walk_forward": {
        "param_stability": {
            "sma_period": {"robust_min": 15, "robust_max": 25, "importance": 0.3},
            "rsi_period": {"robust_min": 10, "robust_max": 18, "importance": 0.15},
            "atr_period": {"robust_min": 10, "robust_max": 20, "importance": 0.1},
        }
    },
    "sqa_result": {
        "best_params": {"sma_period": 18, "rsi_period": 12, "atr_period": 14},
        "robust_plateau": {"center": {"sma_period": 19, "rsi_period": 13, "atr_period": 14}, "width": 0.15},
        "all_solutions": [
            {"params": {"sma_period": 17, "rsi_period": 11, "atr_period": 13}, "energy": -1.5},
            {"params": {"sma_period": 19, "rsi_period": 13, "atr_period": 15}, "energy": -1.8},
            {"params": {"sma_period": 20, "rsi_period": 14, "atr_period": 14}, "energy": -1.6},
            {"params": {"sma_period": 18, "rsi_period": 12, "atr_period": 14}, "energy": -1.9},
            {"params": {"sma_period": 21, "rsi_period": 15, "atr_period": 16}, "energy": -1.4},
        ],
    },
    "mc_result": {"survival_rate": 0.85},
    "quantum_mc_result": {"breach_probability": 0.08},
    "tensor_prediction": {"fragility_score": 0.25},
    "qubo_timing": {"backtest_improvement": 0.12},
    "max_candidates": 3,
    "pennylane_enabled": False,
})
check("candidates generated", len(result["candidates"]) > 0, f"count={len(result['candidates'])}")
check("no kill signal", result["kill_signal"] is None)
check("governance", result["governance"]["decision_role"] == "challenger_only")
for c in result["candidates"]:
    check(f"candidate rank {c['rank']} valid", all(k in c for k in ["changed_params", "composite_score", "source_of_change"]))

print("\n=== Test 2: EVT tail ===")
from src.engine.evt_tail import fit_generalized_pareto, compare_normal_vs_evt
losses = np.abs(np.random.normal(0, 100, 1000))
evt = fit_generalized_pareto(losses)
check("EVT fit", "error" not in evt, f"method={evt.get('method')}")
check("tail probs", "tail_probabilities" in evt)
cmp = compare_normal_vs_evt(losses)
check("underestimation ratio", "underestimation_ratio_p99" in cmp)

print("\n=== Test 3: Changepoint ===")
from src.engine.changepoint import detect_changepoints, detect_strategy_edge_death
signal = np.concatenate([np.random.normal(100, 10, 80), np.random.normal(50, 10, 80)])
cp = detect_changepoints(signal)
check("detects mean shift", cp["n_changes"] >= 1, f"breaks={cp['breakpoints']}")
pnls = np.concatenate([np.random.normal(200, 30, 50), np.random.normal(-100, 50, 50)])
sharpe = np.concatenate([np.ones(50) * 2.0, np.ones(50) * -0.5])
death = detect_strategy_edge_death(pnls, sharpe)
check("edge death function runs", "edge_death_detected" in death)

print("\n=== Test 4: Robust covariance ===")
from src.engine.robust_covariance import estimate_covariance, portfolio_risk_decomposition
returns = np.random.randn(200, 4)
cov = estimate_covariance(returns, method="ledoit_wolf")
check("covariance method", cov["method"] in ("ledoit_wolf", "sample_fallback"))
check("condition number", cov["condition_number"] > 0)
weights = np.array([0.25, 0.25, 0.25, 0.25])
decomp = portfolio_risk_decomposition(weights, np.array(cov["covariance"]))
check("portfolio vol", decomp["portfolio_volatility"] > 0)
check("pct sums to 1", abs(sum(decomp["pct_contribution"]) - 1.0) < 0.05)

print("\n=== Test 5: QMC sampler ===")
from src.engine.qmc_sampler import QMCSampler
qmc = QMCSampler()
sobol = qmc.sobol_sample(100, 3)
check("sobol shape", sobol.shape == (100, 3))
check("sobol range", np.all(sobol >= 0) and np.all(sobol <= 1))
scenarios = qmc.stress_scenarios(10, {"loss_mult": (1.0, 3.0), "win_red": (0.5, 1.0)})
check("stress scenarios", len(scenarios) == 10)

print("\n=== Test 6: MC confidence intervals ===")
from src.engine.mc_confidence import compute_mc_confidence_intervals, survival_rate_stat
data = np.random.randn(1000)
ci = compute_mc_confidence_intervals(data, survival_rate_stat, n_resamples=999)
check("CI bounds", ci["ci_low"] <= ci["point_estimate"] <= ci["ci_high"])
check("CI method", ci["method"] in ("BCa", "percentile_fallback"))

print("\n=== Test 7: PCG64DXSM ===")
from src.engine.monte_carlo import create_authoritative_rng
rng1 = create_authoritative_rng(42)[0]
rng2 = create_authoritative_rng(42)[0]
check("reproducible", np.array_equal(rng1.random(10), rng2.random(10)))
check("correct generator", type(rng1.bit_generator).__name__ == "PCG64DXSM")
streams = create_authoritative_rng(42, 3)
check("parallel independent", not np.array_equal(streams[0].random(5), streams[1].random(5)))

print("\n=== Test 8: GPU pipeline fallbacks ===")
from src.engine.gpu_pipeline import block_bootstrap_gpu, gpu_risk_metrics, find_similar_gpu
trades = np.random.randn(100)
paths = block_bootstrap_gpu(trades, 50, 8)
check("bootstrap shape", paths.shape == (50, 100))
metrics = gpu_risk_metrics(paths)
check("risk metrics", "max_drawdown_p50" in metrics and "survival_rate" in metrics)
q = np.random.randn(10)
C = np.random.randn(20, 10)
idx, sims = find_similar_gpu(q, C, top_k=3)
check("similarity", len(idx) == 3)

print("\n=== Test 9: cuOpt selector ===")
from src.engine.cuopt_helpers import CandidateSelector
sel = CandidateSelector()
candidates = [
    {"composite_score": 0.8, "breach_probability": 0.05, "fragility_score": 0.2, "max_drawdown": 1000, "expected_uplift": 0.01},
    {"composite_score": 0.6, "breach_probability": 0.4, "fragility_score": 0.2, "max_drawdown": 1000, "expected_uplift": 0.01},
    {"composite_score": 0.7, "breach_probability": 0.05, "fragility_score": 0.9, "max_drawdown": 1000, "expected_uplift": 0.01},
    {"composite_score": 0.5, "breach_probability": 0.05, "fragility_score": 0.2, "max_drawdown": 1000, "expected_uplift": 0.01},
]
selected = sel.select(candidates, max_k=3)
check("constraint filtering", len(selected) == 2, f"selected {len(selected)}/4")
check("ordering", selected[0]["composite_score"] == 0.8)

print("\n=== Test 10: Strategy memory ===")
from src.engine.strategy_memory import StrategyMemory
mem = StrategyMemory(embedding_dim=16)
embeddings = np.random.randn(10, 16).astype(np.float32)
metadata = [{"id": f"strat_{i}"} for i in range(10)]
mem.build_index(embeddings, metadata)
query = embeddings[3] + np.random.randn(16).astype(np.float32) * 0.1
results = mem.query(query, top_k=3)
check("query returns results", len(results) == 3)
check("nearest neighbor", results[0]["id"] == "strat_3", f"got {results[0]['id']}")

print("\n=== Test 11: Paper analytics ===")
from src.engine.paper_analytics import generate_session_report
pnls = list(np.random.normal(100, 200, 30))
report = generate_session_report(pnls)
check("has all metrics", all(k in report for k in ["sharpe", "sortino", "calmar", "max_drawdown", "profit_factor"]))
check("n_days", report["n_days"] == 30)

print("\n=== Test 12: HMM regime ===")
from src.engine.regime import fit_hmm_regime, HMM_AVAILABLE
rng12 = np.random.default_rng(42)
returns = rng12.standard_normal(200) * 0.01
hmm = fit_hmm_regime(returns)
if HMM_AVAILABLE:
    check("HMM fitted", hmm["method"] == "hmm")
    check("transition matrix", "transition_matrix" in hmm)
else:
    check("HMM fallback", hmm["method"] == "rule_based")

print("\n=== Test 13: Tensor fragility signature ===")
from src.engine.tensor_signal_model import compute_fragility_score
import inspect
sig = inspect.signature(compute_fragility_score)
params = list(sig.parameters.keys())
check("correct params", params == ["model", "features", "regime_labels", "param_perturbations"])

print("\n=== Test 14: NVTX no-op on Windows ===")
from src.engine.nvtx_markers import annotate, range_push, range_pop, NVTX_AVAILABLE
@annotate("test")
def dummy(): return 42
check("annotate no-op", dummy() == 42)
range_push("test")
range_pop()
check("push/pop no-op", True)

print(f"\n{'='*60}")
print(f"RESULTS: {passed} passed, {failed} failed out of {passed+failed}")
if failed > 0:
    print("ISSUES REMAIN — fix before declaring complete")
    sys.exit(1)
else:
    print("ALL TESTS PASS")
