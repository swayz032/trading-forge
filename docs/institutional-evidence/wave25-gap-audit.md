# Wave 25 Institutional-Grade Gap Audit — Evidence Library

## Audit date: 2026-05-24
## Auditor: institutional-edge-researcher subagent

---

## Sources (all ≥ 2025-01-01)

| Date | Source | Tier | URL | Key claim |
|---|---|---|---|---|
| 2025-12 | arxiv 2512.12924 (Dec 15 2025) | research | https://arxiv.org/html/2512.12924v1 | WFO (252-day train / 63-day test) described as "gold standard" for trading strategy validation; CPCV outperforms WFO on PBO metric |
| 2025-10 | AIMS Press ensemble-HMM paper (Oct 29 2025) | research | https://www.aimspress.com/article/id/69045d2fba35de34708adb5d | 3-state HMM (bull/bear/neutral) within voting ensemble; HMM as advisory component, not hard gate |
| 2025-04 | CME Group Reassessing Liquidity (2025) | corporate-eng | https://www.cmegroup.com/articles/2025/reassessing-liquidity-beyond-order-book-depth.html | April 7 2025: ES volume +99% above Q1 avg while book depth -68%; fill quality degraded 6.7 ticks; recovered by April 21 |
| 2025-04 | Global Trading / BMLL (Apr 15 2025) | practitioner-interview | https://www.globaltrading.net/sp500-futures-liquidity-declined-90-at-height-of-tariff-turmoil/ | "S&P500 futures liquidity declined 90% at height of tariff turmoil" — acute, not permanent |
| 2026-05 | lunefi TopstepX Auto Trader (May 6 2026, updated May 16 2026) | blog-general | https://lunefi.com/blog/topstepx-auto-trader-2026-best-bots-api-setup-rules-success-stories | TopstepX API launched late April 2026; local-only, no VPS/cloud bots; TradersPost benchmark 100-250ms latency |
| 2025-11 | MFFU Fair Play policy (Nov 24 2025) | corporate-eng | https://help.myfundedfutures.com/en/articles/8444599-fair-play-and-prohibited-trading-practices | Same-device ban, collaborative trading ban confirmed; family-account no explicit carve-out |
| 2026-05 | proptradingvibes MFFU Rules (May 10 2026) | blog-general | https://proptradingvibes.com/blog/myfundedfutures-rules-overview | 2026: zero activation fees confirmed; no daily loss limit differentiator; no retro rule changes |
| 2026-03 | traderssecondbrain pass rates (Mar 2026) | blog-general | https://traderssecondbrain.com/guides/prop-firm-pass-rate | Traders who passed: risk 0.5-1% of account; failures: risk 2-3%; 50% of failures from hitting max loss limit |
| 2025-12 | ScienceDirect backtest ML era (Knowledge-Based Systems, 2024 pub online, SSRN 4686376) | research | https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4686376 | CPCV demonstrates "marked superiority in mitigating overfitting risks" vs WFO; Bagged CPCV and Adaptive CPCV are 2025 novel variants |
| 2026-03 | preprints.org HMM Bitcoin 202603.0831 (March 2026) | research | https://www.preprints.org/manuscript/202603.0831 | HMM for regime detection 2024-2026; 3-state and 2-state remain dominant in practice |

---

## Trading Forge vs Institutional Comparison

| Aspect | Trading Forge W24 implementation | Institutional reference (2026) | Gap |
|---|---|---|---|
| Cross-validation | CPCV + Purged WF; PBO gate; DSR N-trials correction | CPCV + Bagged/Adaptive CPCV variants (2025 research); DSR with regime-conditioning emerging | YELLOW: symmetric CPCV variant not yet in stack |
| HMM regime | 3-state Gaussian HMM (advisory); 4-state macro C11 HMM | 3-state remains dominant in 2026 research; hierarchical HMM emerging but not standard | GREEN |
| Liquidity caps | MES 100 / MNQ 50 / MCL 30 + vol-scale + haircut | CME data: April 2025 depth -68-90% but recovered within 2 weeks; not permanent shift | GREEN (caps are conservative; recovery confirmed temporary) |
| Risk sizing | 2% max risk per trade, 67% personal DLL | Industry guidance: 0.5-1% of account recommended to pass; 2% correlates with evaluation failure | RED |
| Execution path | TradingView → TradersPost → broker (1-1.5s baseline; up to 45s TradingView delay) | TopstepX API (local): <1s; CrossTrade: 34ms; websocket: 5-10ms | YELLOW |
| Audit log | standard SQL audit_log table | Crypto-grade HMAC hash chain = 2026 general compliance best practice; NOT a Topstep/MFFU requirement | GREEN (gold-plating at our scale) |
| Family distribution | per-recipient Pine + own device | MFFU: same-device ban confirmed Nov 2025, collaborative ban confirmed; pattern is correct | GREEN |
| Confluence scoring W25.1 | 9-factor weighted probabilistic + hard-block contract | Multi-factor confluence is institutional standard; hard-block contract pattern matches Lopez de Prado's feature importance gating | GREEN |
| SMC structure engine W25.2 | BOS/CHoCH/MSS detection as independent gate | SMC ubiquitous in 2026 retail/prop; institutional desks use liquidity-pool targeting; no academic corroboration as standalone edge | YELLOW |
| B14 Survival Twin | Phase 0 advisory; consistency cap 40% | Phase 1 graduation criterion well-designed (Day 60+, survival_prob < 0.50 hard gate) | GREEN |
| B15 Parameter Robustness Battery | SDR ≥ 0.85, PSI ≤ 0.05, RWS ≤ 0.20 | Regime-conditioned parameter stability is 2025 research direction; current thresholds defensible | GREEN |
| Volatility targeting | vol-scale applied in backtester parity | CTA standard: daily vol-target rescaling is Carver/Hurst consensus | GREEN |
