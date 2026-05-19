#!/bin/bash
echo "=== PLAN DELIVERABLE CHECK ==="
echo ""
pass=0
fail=0

check() {
  local label="$1"
  local count="$2"
  if [ "$count" -ge 1 ]; then
    echo "  OK ($count): $label"
    ((pass++))
  else
    echo "  FAIL (0): $label"
    ((fail++))
  fi
}

echo "--- PHASE 1: Quantum Persistence ---"
check "P1.1 sqa_optimization_runs" $(grep -c "sqaOptimizationRuns" src/server/db/schema.ts)
check "P1.2 qubo_timing_runs" $(grep -c "quboTimingRuns" src/server/db/schema.ts)
check "P1.3 tensor_predictions" $(grep -c "tensorPredictions" src/server/db/schema.ts)
check "P1.4 rl_training_runs" $(grep -c "rlTrainingRuns" src/server/db/schema.ts)
check "P1.5 critic_optimization_runs" $(grep -c "criticOptimizationRuns" src/server/db/schema.ts)
check "P1.6 critic_candidates" $(grep -c "criticCandidates" src/server/db/schema.ts)
check "P1.7 migration" $(ls src/server/db/migrations/0022*.sql 2>/dev/null | wc -l)
check "P1.8 QUBO auto-trigger" $(grep -c "qubo_trade_timing" src/server/services/backtest-service.ts)
check "P1.9 tensor auto-trigger" $(grep -c "tensor_signal_model" src/server/services/backtest-service.ts)
check "P1.10 SQA dual-write" $(grep -c "sqaOptimizationRuns" src/server/services/backtest-service.ts)

echo ""
echo "--- PHASE 2: NVTX Profiling ---"
check "P2.1 nvtx_markers.py" $(ls src/engine/nvtx_markers.py 2>/dev/null | wc -l)
check "P2.2 NVTX backtester" $(grep -c "range_push" src/engine/backtester.py)
check "P2.3 NVTX monte_carlo" $(grep -c "@annotate" src/engine/monte_carlo.py)
check "P2.4 NVTX walk_forward" $(grep -c "range_push" src/engine/walk_forward.py)
check "P2.5 NVTX SQA" $(grep -c "@annotate" src/engine/quantum_annealing_optimizer.py)
check "P2.6 NVTX tensor" $(grep -c "@annotate" src/engine/tensor_signal_model.py)

echo ""
echo "--- PHASE 3: GPU Pipeline ---"
check "P3.1 gpu_pipeline.py" $(ls src/engine/gpu_pipeline.py 2>/dev/null | wc -l)
check "P3.2 GPU wired MC" $(grep -c "block_bootstrap_gpu" src/engine/monte_carlo.py)
check "P3.3 GPU wired risk" $(grep -c "gpu_risk_metrics" src/engine/risk_metrics.py)
check "P3.4 GPU wired graveyard" $(grep -c "find_similar_gpu" src/engine/graveyard/similarity.py)

echo ""
echo "--- PHASE 4: Tensor Fragility ---"
check "P4.1 compute_fragility_score" $(grep -c "def compute_fragility_score" src/engine/tensor_signal_model.py)
check "P4.2 fragility in trigger" $(grep -c "compute_fragility" src/server/services/backtest-service.ts)

echo ""
echo "--- PHASE 5: Critic Optimizer ---"
check "P5.1 critic_optimizer.py" $(ls src/engine/critic_optimizer.py 2>/dev/null | wc -l)
check "P5.2 CompositeObjective" $(grep -c "class CompositeObjective" src/engine/critic_optimizer.py)
check "P5.3 EvidenceAggregator" $(grep -c "class EvidenceAggregator" src/engine/critic_optimizer.py)
check "P5.4 PennyLaneRefiner" $(grep -c "class PennyLaneRefiner" src/engine/critic_optimizer.py)
check "P5.5 CandidateGenerator" $(grep -c "class CandidateGenerator" src/engine/critic_optimizer.py)
check "P5.6 kill signals" $(grep -c "catastrophic_risk" src/engine/critic_optimizer.py)

echo ""
echo "--- PHASE 6: cuOpt ---"
check "P6.1 cuopt_helpers.py" $(ls src/engine/cuopt_helpers.py 2>/dev/null | wc -l)
check "P6.2 CandidateSelector wired" $(grep -c "CandidateSelector" src/engine/critic_optimizer.py)

echo ""
echo "--- PHASE 7: Strategy Memory ---"
check "P7.1 strategy_memory.py" $(ls src/engine/strategy_memory.py 2>/dev/null | wc -l)
check "P7.2 StrategyMemory wired" $(grep -c "StrategyMemory" src/engine/critic_optimizer.py)

echo ""
echo "--- PHASE 8: MC Methodology ---"
check "P8.1 qmc_sampler.py" $(ls src/engine/qmc_sampler.py 2>/dev/null | wc -l)
check "P8.2 mc_confidence.py" $(ls src/engine/mc_confidence.py 2>/dev/null | wc -l)
check "P8.3 PCG64DXSM" $(grep -c "PCG64DXSM" src/engine/monte_carlo.py)
check "P8.4 QMC wired" $(grep -c "QMCSampler" src/engine/critic_optimizer.py)
check "P8.5 CI wired" $(grep -c "mc_confidence" src/engine/monte_carlo.py)

echo ""
echo "--- PHASE 9: Math Stack ---"
check "P9.1 robust_covariance.py" $(ls src/engine/robust_covariance.py 2>/dev/null | wc -l)
check "P9.2 changepoint.py" $(ls src/engine/changepoint.py 2>/dev/null | wc -l)
check "P9.3 evt_tail.py" $(ls src/engine/evt_tail.py 2>/dev/null | wc -l)
check "P9.4 HMM regime" $(grep -c "fit_hmm_regime" src/engine/regime.py)
check "P9.5 robust_cov wired" $(grep -c "robust_covariance" src/engine/analytics.py)
check "P9.6 changepoint wired" $(grep -c "detectStructuralBreaks" src/server/services/drift-detection-service.ts)
check "P9.7 evt wired" $(grep -c "evt_tail" src/engine/gap_risk.py)
check "P9.8 HMM wired" $(grep -c "analyzeMarketHMM" src/server/services/regime-service.ts)

echo ""
echo "--- PHASE 10: Paper Parity ---"
check "P10.1 variable slippage" $(grep -c "orderMod\|sessionMult" src/server/services/paper-execution-service.ts)
check "P10.2 calendar wired" $(grep -c "calendarBlocked" src/server/services/paper-signal-service.ts)
check "P10.3 buffer reset" $(grep -c "lastBarDate" src/server/services/paper-trading-stream.ts)
check "P10.4 tracing.ts" $(ls src/server/lib/tracing.ts 2>/dev/null | wc -l)
check "P10.5 tracing wired" $(grep -c "tracer" src/server/services/paper-signal-service.ts)
check "P10.6 paper_analytics.py" $(ls src/engine/paper_analytics.py 2>/dev/null | wc -l)
check "P10.7 analytics wired" $(grep -c "paper-analytics" src/server/routes/paper.ts)
check "P10.8 auto-shadow" $(grep -c "shadowSignals" src/server/services/paper-execution-service.ts)
check "P10.9 calendar CLI" $(grep -c "__name__" src/engine/skip_engine/calendar_filter.py)

echo ""
echo "--- PHASE 11: TS Service ---"
check "P11.1 critic-optimizer-service.ts" $(ls src/server/services/critic-optimizer-service.ts 2>/dev/null | wc -l)
check "P11.2 critic-optimizer routes" $(ls src/server/routes/critic-optimizer.ts 2>/dev/null | wc -l)
check "P11.3 routes registered" $(grep -c "criticOptimizerRoutes" src/server/index.ts)
check "P11.4 rate limiting" $(grep -c "RATE_LIMIT" src/server/services/critic-optimizer-service.ts)
check "P11.5 runBacktest replay" $(grep -c "runBacktest" src/server/services/critic-optimizer-service.ts)
check "P11.6 SSE events" $(grep -c "broadcastSSE" src/server/services/critic-optimizer-service.ts)
check "P11.7 auto-trigger" $(grep -c "triggerCriticOptimizer" src/server/services/backtest-service.ts)

echo ""
echo "--- PHASE 12: GPT-5-mini ---"
check "P12.1 model-router.ts" $(ls src/server/services/model-router.ts 2>/dev/null | wc -l)
check "P12.2 critic-evaluator.md" $(ls src/agents/critic-evaluator.md 2>/dev/null | wc -l)
check "P12.3 strategy-proposer.md" $(ls src/agents/strategy-proposer.md 2>/dev/null | wc -l)
check "P12.4 nightly-self-critique.md" $(ls src/agents/nightly-self-critique.md 2>/dev/null | wc -l)
check "P12.5 model-router wired" $(grep -c "model-router" src/server/services/agent-service.ts)

echo ""
echo "--- PHASE 13: Execution Bridge (deferred) ---"
count=$(ls src/server/services/execution-bridge-service.ts 2>/dev/null | wc -l)
if [ "$count" -eq 0 ]; then
  echo "  OK: Correctly deferred (no files)"
  ((pass++))
else
  echo "  UNEXPECTED: Execution bridge files exist but should be deferred"
  ((fail++))
fi

echo ""
echo "=========================================="
echo "RESULTS: $pass passed, $fail failed"
if [ "$fail" -eq 0 ]; then
  echo "ALL PLAN DELIVERABLES PRESENT AND WIRED"
else
  echo "GAPS REMAIN"
fi
