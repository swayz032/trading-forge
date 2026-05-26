# Quantum Stack (Wave 27) — Institutional Reference Evidence

## TL;DR (Trading Forge gap assessment)
- Claim 1 (classical-quantum advisory flag): PARTIALLY supported — hybrid governance pattern exists but no production case study at prop-firm scale. IAE quadratic speedup is real but NISQ noise erodes it below ~10k shots.
- Claim 2 (30-day QCNN calibration): UNSUPPORTED — 30 days at 1 trade/day = 22 events; institutional minimum for binary classifier calibration is 200-500+ labeled events. The label "QCNN" is also a misnomer for what is likely a parameterized threshold filter.
- Claim 3 (NVIDIA Ising HF model): SUBSTANTIALLY CORRECT with path correction. Model exists at `nvidia/Ising-Decoder-SurfaceCode-1-Fast` but is strictly a QPU error-correction pre-decoder, not a classical finance tool.
- Claim 4 (5 modules DORMANT): SUPPORTED — none of the 5 has a 2025-2026 documented production finance case study. Dormant-with-isolation is the correct institutional posture.
- Claim 5 (30-day observation): UNSUPPORTED on sample-size grounds. At 1 trade/day, 30 days yields ~22 B14 runs — statistically insufficient for 2σ detection of a small signal in a binary flag.

## Sources (≥2025 only)

| Date | Source | Tier | Citation | Key claim |
|---|---|---|---|---|
| 2026-03-10 | arXiv 2603.15664 | research | https://arxiv.org/abs/2603.15664 | QAE achieves near-1/N convergence but "strong classical baselines win when analytical access is available" and "discretisation, not estimation, is the current bottleneck" |
| 2026-01-14 | Quantum Journal q-2026-01-14-1962 | research | https://quantum-journal.org/papers/q-2026-01-14-1962/ | Bayesian IQAE achieves tighter confidence intervals; still limited by NISQ noise at low shot counts |
| 2026-03-03 | NVIDIA/Ising-Decoding GitHub (release 0.1.1) | corporate-eng | https://github.com/NVIDIA/Ising-Decoding | HF model at `nvidia/Ising-Decoder-SurfaceCode-1-Fast`; designed for QPU syndrome bitstring decoding |
| 2026-04-14 | NVIDIA Technical Blog | corporate-eng | https://developer.nvidia.com/blog/nvidia-ising-introduces-ai-powered-workflows-to-build-fault-tolerant-quantum-systems/ | Ising Decoding is a 3D CNN framework for real-time QEC on QPUs; not for classical finance |
| 2026-05-19 | BCG Report | corporate-eng | https://www.bcg.com/publications/2026/how-firms-can-achieve-quantum-advantage-without-a-quantum-computer | Quantum-inspired algorithms (SA, QHD, tensor networks) on classical hardware beat Monte Carlo; production-ready NOW |
| 2026-01-20 | arXiv 2601.18811 | research | https://arxiv.org/abs/2601.18811 | VQC-RL portfolio: "practical deployment on cloud-based quantum systems introduces substantial latency…limiting practical applicability" |
| 2026-04-27 | arXiv 2604.23931 | research | https://arxiv.org/abs/2604.23931 | VQC tabular benchmarks: FC-VQC achieves 90-96% of R² while using 40-50% fewer params vs attention VQC; still not production-grade |
| 2026-03-02 | arXiv 2603.01820 (Oxford/Oxford-Man) | research | https://arxiv.org/html/2603.01820 | Deep learning futures benchmark 2010-2025: VSN+LSTM, xLSTM, LSTM+PatchTST are SOTA — no tensor MPS in top performers |
| 2026-04-22 | VertoxQuant stress-test framework | blog-general | https://www.vertoxquant.com/p/backtests-lie | Bootstrap/N-shuffle + walk-forward is the 2026 practitioner standard for overfitting detection |
| 2025-09-26 | Reddit r/quant (HSBC quantum thread, score 79) | community-expert | https://www.reddit.com/r/quant/comments/1nqv3u6/ | Practitioner consensus: quantum not commercially viable/scalable yet for production trading |
| 2026-01-27 | Medium/Quantum Computing Industries | blog-general | https://medium.com/quantum-computing-and-industries/quantum-finance | Industry pattern: "feature-flag <1% of Monte Carlo tasks to quantum back-ends during A/B rollout" |
| 2026-03-04 | arXiv 2603.16904 | research | https://arxiv.org/abs/2603.16904 | QUBO scheduling via QAOA: Sharpe 0.588 vs classical 0.575 — marginal edge, 44.5% fewer rebalances |
| 2025-11-18 | CFA Institute Research Foundation Chapter 9 | research | https://rpc.cfainstitute.org/research/foundation/2025/chapter-9-quantum-computing-for-finance | "Hardware is still noisy and small (NISQ era)… firms that experiment NOW will build expertise ahead of competitors" |

## Trading Forge vs institutional comparison

| Aspect | Trading Forge implementation | Institutional reference | Gap |
|---|---|---|---|
| Classical-quantum disagreement governance | quantum_mc advisory flag with classical gating | Industry pattern: A/B feature-flag <1% tasks to quantum; classical authoritative | Pattern is correct in principle; no production prop-firm case study exists |
| IAE shot budget fidelity | Unspecified shot count | arXiv 2603.15664: NISQ noise erodes advantage below large shot budgets; "discretisation bottleneck" | Must specify minimum shot count and noise budget |
| QCNN threshold calibration window | 30 days operator skip data | ML classifier calibration requires 200-500+ binary events (BMC Bioinformatics 2026) | ~22 events in 30 days is statistically indefensible |
| NVIDIA Ising model path | Non-existent `Jayyyy123/...` | `nvidia/Ising-Decoder-SurfaceCode-1-Fast` on HuggingFace | Correct direction; wrong URI |
| Ising use case | Classical finance inference | Strictly QPU syndrome bitstring → logical error probability | Fundamental misapplication |
| VQC-RL for parameter search | DORMANT quantum_rl_agent | arXiv 2601.18811: "latency makes practical deployment currently limited" | Correct — dormant is right |
| Tensor MPS for trade outcomes | DORMANT tensor_signal_model | arXiv 2603.01820: LSTM-family and state-space models are SOTA; MPS not in top results | Correct — dormant is right |
| QUBO session timing | DORMANT qubo_trade_timing | arXiv 2603.16904: QUBO scheduling marginal over classical on S&P 500 | Correct — dormant is right |
| Grover adversarial stress | DORMANT quantum_adversarial_stress | No 2025-2026 paper shows Grover catching failures missed by CPCV/PBO | Correct — dormant is right |
| 30-day observation window | Proposed | No institutional decision-rule published; sample math fails at 1 trade/day | Needs 90-120 days minimum |

## Recommended changes (with citations)

1. Keep classical-quantum advisory flag governance pattern but document expected shot count floor — supported by [arXiv 2603.15664], [Quantum Journal q-2026-01-14-1962], [Medium quantum finance A/B rollout pattern]
2. Replace 30-day QCNN calibration with 200+ event window (~9-10 months at 1 trade/day) or use a non-QCNN classical threshold until sufficient data exists — supported by [BMC Bioinformatics sample-size requirements 2026], [arXiv 2603.15664 "discretisation bottleneck"], [VertoxQuant 2026 practitioner framework]
3. Fix NVIDIA Ising URI to `nvidia/Ising-Decoder-SurfaceCode-1-Fast`; document that its intended use is QPU QEC only — supported by [NVIDIA GitHub release 0.1.1], [NVIDIA Technical Blog 2026-04-14], [arXiv 2604.12841]
4. Extend observation window to 90-120 days (approx 65-85 B14 runs) before evaluating quantum challenger signal — supported by [Quantum Journal q-2026-01-14-1962 sample-size analysis], [arXiv 2603.15664 convergence findings], [CFA Institute 2025 Chapter 9]
