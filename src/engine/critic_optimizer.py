"""Critic Optimization Service — Core Python Module.

Aggregates evidence from classical + quantum sources, finds consensus regions,
generates ranked parameter candidates, and emits them for governed replay.

Usage:
    python -m src.engine.critic_optimizer --config '{...evidence packet...}'

The critic does NOT make decisions. It proposes candidates.
The backtester judges. Classical gates decide what survives.
"""
from __future__ import annotations

import json
import sys
import time
from dataclasses import dataclass, field, asdict
from typing import Any, Optional

import numpy as np

from src.engine.nvtx_markers import annotate, range_push, range_pop


# ─── Composite Objective ─────────────────────────────────────────────


class CompositeObjective:
    """Weighted multi-objective scorer for strategy quality.

    9 factors: 4 positive (reward) + 5 negative (penalty).
    Higher score = better candidate.
    """

    WEIGHTS = {
        "oos_return": 0.15,
        "survival_rate": 0.15,
        "profit_factor": 0.15,
        "payout_feasibility": 0.10,
        "max_drawdown": -0.15,       # Penalty
        "breach_probability": -0.10,  # Penalty (from quantum MC)
        "param_instability": -0.10,   # Penalty (from walk-forward)
        "regime_fragility": -0.05,    # Penalty (from tensor fragility)
        "timing_fragility": -0.05,    # Penalty (from QUBO instability)
    }

    def score(self, metrics: dict) -> float:
        """Compute weighted composite score from normalized metrics."""
        total = 0.0
        for key, weight in self.WEIGHTS.items():
            val = float(metrics.get(key, 0) or 0)
            total += weight * val
        return total

    def breakdown(self, metrics: dict) -> dict[str, float]:
        """Return per-factor contribution to composite score."""
        result = {}
        for key, weight in self.WEIGHTS.items():
            val = float(metrics.get(key, 0) or 0)
            result[key] = weight * val
        return result

    def normalize_metrics(self, raw: dict) -> dict:
        """Normalize raw backtest metrics to [0, 1] for scoring.

        Normalization targets based on CLAUDE.md tier thresholds.
        """
        return {
            "oos_return": min(float(raw.get("total_return", 0) or 0) / 50000, 1.0),
            "survival_rate": float(raw.get("survival_rate", 0) or 0),
            "profit_factor": min(float(raw.get("profit_factor", 0) or 0) / 5.0, 1.0),
            "payout_feasibility": min(float(raw.get("avg_daily_pnl", 0) or 0) / 500, 1.0),
            "max_drawdown": min(abs(float(raw.get("max_drawdown", 0) or 0)) / 5000, 1.0),
            "breach_probability": float(raw.get("breach_probability", 0) or 0),
            "param_instability": float(raw.get("param_instability", 0) or 0),
            "regime_fragility": float(raw.get("fragility_score", 0) or 0),
            "timing_fragility": float(raw.get("timing_fragility", 0) or 0),
        }


# ─── Evidence Aggregator ─────────────────────────────────────────────


class EvidenceAggregator:
    """Collects + normalizes evidence from all sources."""

    def __init__(self):
        self.optuna_ranges: dict[str, tuple[float, float]] = {}
        self.sqa_ranges: dict[str, tuple[float, float]] = {}
        self.high_sensitivity_params: list[str] = []
        self.breach_penalty: float = 0.0
        self.fragility_score: float = 0.0
        self.timing_improvement: float = 0.0
        self.rl_scores: dict[str, float] = {}

    def add_classical(
        self,
        walk_forward: dict | None,
    ) -> None:
        """Extract Optuna robust ranges from walk-forward param_stability."""
        if not walk_forward:
            return
        stability = walk_forward.get("param_stability", {})
        for param_name, info in stability.items():
            if isinstance(info, dict):
                lo = float(info.get("robust_min", info.get("min", 0)))
                hi = float(info.get("robust_max", info.get("max", 0)))
                if hi > lo:
                    self.optuna_ranges[param_name] = (lo, hi)
                importance = float(info.get("importance", 0))
                if importance > 0.1:
                    self.high_sensitivity_params.append(param_name)

    def add_sqa(self, sqa_result: dict | None) -> None:
        """Extract SQA robust plateau regions."""
        if not sqa_result:
            return
        plateau = sqa_result.get("robust_plateau", {})
        best_params = sqa_result.get("best_params", {})

        if isinstance(plateau, dict) and "center" in plateau:
            width = float(plateau.get("width", 0.1))
            center = plateau.get("center", {})
            if isinstance(center, dict):
                for param_name, center_val in center.items():
                    center_val = float(center_val)
                    self.sqa_ranges[param_name] = (
                        center_val - width * center_val,
                        center_val + width * center_val,
                    )
        elif isinstance(best_params, dict):
            for param_name, val in best_params.items():
                val = float(val)
                self.sqa_ranges[param_name] = (val * 0.8, val * 1.2)

    def add_quantum_mc(self, qmc_result: dict | None) -> None:
        """Extract breach/ruin as risk penalty."""
        if not qmc_result:
            return
        self.breach_penalty = float(qmc_result.get("breach_probability", 0) or 0)

    def add_tensor(self, tensor_prediction: dict | None) -> None:
        """Extract fragility score + regime disagreement.

        regime_breakdown is expected to be a dict mapping regime name to
        P(profitable) for that regime, e.g.:
            {"trending": 0.75, "ranging": 0.40, "volatile": 0.20}

        Variance across those probabilities measures how regime-dependent the
        strategy is. High variance means the strategy only works in specific
        regimes — a fragility signal. If variance > 0.3 (on a [0,1] scale)
        we add a proportional penalty to fragility_score, capped so the sum
        never exceeds 1.0.
        """
        if not tensor_prediction:
            return
        self.fragility_score = float(tensor_prediction.get("fragility_score", 0) or 0)

        regime_breakdown = tensor_prediction.get("regime_breakdown")
        if isinstance(regime_breakdown, dict) and regime_breakdown:
            probs = [float(v) for v in regime_breakdown.values() if v is not None]
            if len(probs) >= 2:
                regime_variance = float(np.var(probs))
                if regime_variance > 0.3:
                    # Linear penalty: variance 0.3 → +0, variance 1.0 → +0.7
                    # Normalized to the (0.3, 1.0) window so the signal is
                    # proportional rather than a cliff.
                    variance_penalty = min((regime_variance - 0.3) / 0.7, 1.0) * 0.5
                    self.fragility_score = min(self.fragility_score + variance_penalty, 1.0)

    def add_qubo(self, qubo_timing: dict | None) -> None:
        """Extract timing improvement signal."""
        if not qubo_timing:
            return
        self.timing_improvement = float(qubo_timing.get("backtest_improvement", 0) or 0)

    def add_rl(self, rl_result: dict | None) -> None:
        """Extract RL candidate scores (if available)."""
        if not rl_result:
            return
        self.rl_scores = {
            "total_return": float(rl_result.get("total_return", 0) or 0),
            "sharpe": float(rl_result.get("sharpe_ratio", 0) or 0),
        }

    @annotate("forge/critic_consensus")
    def find_consensus_regions(self) -> dict[str, tuple[float, float]]:
        """Find parameter regions where Optuna + SQA agree.

        Consensus = intersection of robust ranges from both optimizers.
        """
        consensus: dict[str, tuple[float, float]] = {}

        all_params = set(self.optuna_ranges.keys()) | set(self.sqa_ranges.keys())

        for param in all_params:
            opt = self.optuna_ranges.get(param)
            sqa = self.sqa_ranges.get(param)

            if opt and sqa:
                # Intersection
                lo = max(opt[0], sqa[0])
                hi = min(opt[1], sqa[1])
                if hi > lo:
                    consensus[param] = (lo, hi)
            elif opt:
                consensus[param] = opt
            elif sqa:
                consensus[param] = sqa

        return consensus

    def identify_high_sensitivity_params(self) -> list[str]:
        """Return params ranked by optimization importance."""
        return self.high_sensitivity_params

    def summary(self) -> dict:
        """Evidence summary for output."""
        return {
            "optuna_params": len(self.optuna_ranges),
            "sqa_params": len(self.sqa_ranges),
            "high_sensitivity_params": self.high_sensitivity_params,
            "breach_penalty": self.breach_penalty,
            "fragility_score": self.fragility_score,
            "timing_improvement": self.timing_improvement,
            "rl_available": bool(self.rl_scores),
        }


# ─── PennyLane Refiner ───────────────────────────────────────────────


class PennyLaneRefiner:
    """Local variational circuit optimizer on bounded subspace.

    Trains a VQC on known (param_vector, composite_score) pairs from SQA + Optuna.
    Uses the trained circuit to evaluate fine-grained points in the bounded subspace.
    Falls back to nearest-neighbor interpolation if PennyLane is unavailable.
    """

    def __init__(self, n_params: int, n_layers: int = 3):
        self.n_qubits = min(n_params, 8)
        self.n_layers = n_layers
        self._available = False
        self._qml = None
        self._dev = None

        try:
            import pennylane as qml
            self._qml = qml
            self._dev = qml.device("default.qubit", wires=self.n_qubits)
            self._available = True
        except ImportError:
            pass

    def _build_vqc(self):
        """Build a VQC circuit using AngleEmbedding + StronglyEntanglingLayers."""
        qml = self._qml
        dev = self._dev
        n_qubits = self.n_qubits
        n_layers = self.n_layers

        @qml.qnode(dev)
        def vqc_circuit(params, x):
            qml.templates.AngleEmbedding(x, wires=range(n_qubits))
            qml.templates.StronglyEntanglingLayers(params, wires=range(n_qubits))
            return qml.expval(qml.PauliZ(0))

        return vqc_circuit

    def _train_vqc(
        self,
        X_norm: np.ndarray,
        y_norm: np.ndarray,
        n_iterations: int,
    ) -> Optional[np.ndarray]:
        """Train VQC weights to predict composite score. Returns trained weights."""
        qml = self._qml
        try:
            vqc = self._build_vqc()
            weight_shape = qml.templates.StronglyEntanglingLayers.shape(
                n_layers=self.n_layers, n_wires=self.n_qubits,
            )
            rng = np.random.default_rng(42)
            weights = rng.uniform(-np.pi, np.pi, weight_shape).astype(np.float64)

            opt = qml.AdamOptimizer(stepsize=0.05)

            def loss(w):
                preds = np.array([float(vqc(w, xi)) for xi in X_norm])
                # MSE between VQC output (in [-1,1]) and y_norm (in [0,1])
                # Rescale y_norm to [-1, 1] for target alignment
                targets = y_norm * 2.0 - 1.0
                return float(np.mean((preds - targets) ** 2))

            for _ in range(n_iterations):
                weights, _ = opt.step_and_cost(loss, weights)

            return weights
        except Exception:
            return None

    @annotate("forge/critic_pennylane")
    def refine(
        self,
        consensus_region: dict[str, tuple[float, float]],
        known_solutions: list[tuple[np.ndarray, float]],
        n_iterations: int = 50,
    ) -> list[dict]:
        """Refine parameter candidates within consensus region.

        Args:
            consensus_region: {param_name: (low, high)}
            known_solutions: [(param_vector, composite_score)] from SQA + Optuna
            n_iterations: VQC gradient descent steps

        Returns:
            List of refined candidate dicts with predicted scores
        """
        if len(known_solutions) < 5:
            return []

        param_names = list(consensus_region.keys())
        n_params = min(len(param_names), self.n_qubits)
        if n_params == 0:
            return []

        # Normalize known solutions to [0, 1] within bounds
        bounds = [consensus_region[p] for p in param_names[:n_params]]
        X = np.array([s[0][:n_params] for s in known_solutions])
        y = np.array([s[1] for s in known_solutions])

        X_norm = np.zeros_like(X, dtype=np.float64)
        for i, (lo, hi) in enumerate(bounds):
            span = hi - lo if hi > lo else 1.0
            X_norm[:, i] = (X[:, i] - lo) / span

        X_norm = np.clip(X_norm, 0, 1)
        y_norm = (y - y.min()) / max(y.max() - y.min(), 1e-10)

        best_idx = int(np.argmax(y))
        best_params_raw = X[best_idx]

        rng_obj = np.random.default_rng(42)
        candidates = []

        if self._available:
            try:
                # ── VQC path ──────────────────────────────────────────────
                # Scale X_norm to [0, pi] for AngleEmbedding
                X_angle = X_norm * np.pi

                trained_weights = self._train_vqc(X_angle, y_norm, n_iterations)

                if trained_weights is not None:
                    vqc = self._build_vqc()

                    # Evaluate fine-grained grid around best point in normalized space
                    # and select top-2 distinct points
                    grid_candidates = []
                    for _ in range(20):
                        candidate_norm = X_norm[best_idx].copy()
                        for i, (lo, hi) in enumerate(bounds):
                            span = hi - lo if hi > lo else 1.0
                            perturbation = rng_obj.uniform(-0.15, 0.15)
                            candidate_norm[i] = np.clip(candidate_norm[i] + perturbation, 0.0, 1.0)

                        x_angle = candidate_norm * np.pi
                        # VQC output in [-1, 1], rescale to [0, 1] predicted score proxy
                        vqc_out = float(vqc(trained_weights, x_angle))
                        predicted_norm = (vqc_out + 1.0) / 2.0
                        # Denormalize predicted score back to original y range
                        predicted_score = predicted_norm * (y.max() - y.min()) + y.min()

                        # Denormalize candidate params back to original space
                        param_dict = {}
                        for i, name in enumerate(param_names[:n_params]):
                            lo, hi = bounds[i]
                            span = hi - lo if hi > lo else 1.0
                            param_dict[name] = float(lo + candidate_norm[i] * span)

                        grid_candidates.append((param_dict, predicted_score, candidate_norm.copy()))

                    # Sort by predicted score descending, take top 2 diverse points
                    grid_candidates.sort(key=lambda t: t[1], reverse=True)
                    selected: list[tuple] = []
                    for gc in grid_candidates:
                        if not selected:
                            selected.append(gc)
                        elif len(selected) < 2:
                            # Enforce diversity: euclidean distance > 0.1 in norm space
                            if all(float(np.linalg.norm(gc[2] - s[2])) > 0.1 for s in selected):
                                selected.append(gc)
                        if len(selected) == 2:
                            break

                    for param_dict, predicted_score, _ in selected:
                        candidates.append({
                            "params": param_dict,
                            "predicted_score": predicted_score,
                            "source": "pennylane_vqc",
                        })
            except Exception:
                pass  # VQC failed — fall through to nearest-neighbor

        if len(candidates) < 2:
            # ── Nearest-neighbor fallback ─────────────────────────────────
            for _ in range(2 - len(candidates)):
                perturbed = best_params_raw.copy()
                for i, (lo, hi) in enumerate(bounds):
                    width = (hi - lo) * 0.1
                    perturbed[i] += rng_obj.uniform(-width, width)
                    perturbed[i] = np.clip(perturbed[i], lo, hi)

                dists = np.linalg.norm(X - perturbed, axis=1)
                weights = np.exp(-dists / max(float(dists.mean()), 1e-10))
                predicted_score = float(np.average(y, weights=weights))

                param_dict = {}
                for i, name in enumerate(param_names[:n_params]):
                    param_dict[name] = float(perturbed[i])

                candidates.append({
                    "params": param_dict,
                    "predicted_score": predicted_score,
                    "source": "pennylane_nn_fallback",
                })

        return candidates[:2]


# ─── RL Modifier Helper ──────────────────────────────────────────────


def _compute_rl_modifier(rl_scores: dict[str, float], parent_sharpe: float) -> float:
    """Compute a small composite score modifier from RL sharpe evidence.

    Rules (symmetric and bounded):
      - RL sharpe > parent sharpe              → +0.02 (RL confirms improvement)
      - RL sharpe < parent sharpe * 0.8        → -0.02 (RL signals degradation)
      - Otherwise                              →  0.00 (neutral / no data)

    The modifier is intentionally small (±0.02) so RL evidence influences
    candidate ranking without overriding classical evidence or act as promotion
    authority. RL does not generate candidates — it only adjusts the margin.
    """
    if not rl_scores:
        return 0.0

    rl_sharpe = float(rl_scores.get("sharpe", 0) or 0)

    if rl_sharpe == 0.0:
        return 0.0

    if rl_sharpe > parent_sharpe:
        return 0.02

    if rl_sharpe < parent_sharpe * 0.8:
        return -0.02

    return 0.0


# ─── Candidate Generator ─────────────────────────────────────────────


class CandidateGenerator:
    """Produces ranked parameter candidate bundles from aggregated evidence."""

    def __init__(self, objective: CompositeObjective):
        self.objective = objective

    @annotate("forge/critic_candidates")
    def generate(
        self,
        consensus_regions: dict[str, tuple[float, float]],
        parent_params: dict,
        parent_metrics: dict,
        evidence: EvidenceAggregator,
        pennylane_candidates: list[dict] | None = None,
        max_candidates: int = 5,
        memory_similar: list[dict] | None = None,
    ) -> list[dict]:
        # RL modifier: compare RL sharpe to parent sharpe once, apply to every candidate.
        # +0.02 if RL confirms improvement; -0.02 if RL signals degradation.
        # Stored as a single float so _build_candidate stays stateless.
        parent_sharpe = float(parent_metrics.get("sharpe_ratio", 0) or 0)
        rl_composite_modifier = _compute_rl_modifier(evidence.rl_scores, parent_sharpe)
        """Generate ranked candidates from consensus + PennyLane refinement.

        memory_similar: nearest historical critic runs. Used to penalize param
        sets that failed in similar contexts and boost those that succeeded.

        Returns list of candidate dicts sorted by composite_score descending.
        """
        parent_normalized = self.objective.normalize_metrics(parent_metrics)
        parent_score = self.objective.score(parent_normalized)

        # Build memory signal: (penalty_weight, boost_weight) from similar runs
        memory_penalty = 0.0
        memory_boost = 0.0
        memory_failed_params: set[str] = set()
        memory_succeeded_params: set[str] = set()

        if memory_similar:
            for sim in memory_similar:
                outcome = sim.get("outcome", "unknown")
                changed = sim.get("changed_params") or {}
                parent_cs = float(sim.get("parent_composite_score") or 0)
                survivor_cs = float(sim.get("survivor_composite_score") or 0)

                if outcome in ("no_survivor", "killed", "failed") or survivor_cs <= parent_cs:
                    memory_penalty += 0.05
                    memory_failed_params.update(changed.keys())
                elif outcome == "survivor_selected" and survivor_cs > parent_cs:
                    memory_boost += 0.03
                    memory_succeeded_params.update(changed.keys())

        candidates = []
        mem_signals = (memory_penalty, memory_boost, memory_failed_params, memory_succeeded_params)

        # Classical candidates from consensus regions using QMC sampling
        if consensus_regions:
            try:
                from src.engine.qmc_sampler import QMCSampler
                qmc = QMCSampler()
                qmc_points = qmc.candidate_points(3, consensus_regions, method="sobol")
                for i, point in enumerate(qmc_points):
                    source = "optuna_consensus" if i == 0 else "sqa_plateau"
                    candidates.append(self._build_candidate(
                        point, parent_params, parent_score, evidence, source, i + 1,
                        mem_signals=mem_signals,
                        rl_modifier=rl_composite_modifier,
                    ))
            except Exception:
                # Fallback: deterministic center/lower/upper
                center = {}
                for param, (lo, hi) in consensus_regions.items():
                    center[param] = (lo + hi) / 2.0
                candidates.append(self._build_candidate(
                    center, parent_params, parent_score, evidence, "optuna_consensus", 1,
                    mem_signals=mem_signals,
                    rl_modifier=rl_composite_modifier,
                ))

                lower = {}
                for param, (lo, hi) in consensus_regions.items():
                    lower[param] = lo + (hi - lo) * 0.25
                candidates.append(self._build_candidate(
                    lower, parent_params, parent_score, evidence, "sqa_plateau", 2,
                    mem_signals=mem_signals,
                    rl_modifier=rl_composite_modifier,
                ))

            upper = {}
            for param, (lo, hi) in consensus_regions.items():
                upper[param] = lo + (hi - lo) * 0.75
            candidates.append(self._build_candidate(
                upper, parent_params, parent_score, evidence, "sqa_plateau", 3,
                mem_signals=mem_signals,
                rl_modifier=rl_composite_modifier,
            ))

        # PennyLane refined candidates
        if pennylane_candidates:
            for i, pc in enumerate(pennylane_candidates):
                candidates.append(self._build_candidate(
                    pc["params"], parent_params, parent_score, evidence,
                    "pennylane_refined", len(candidates) + 1,
                    mem_signals=mem_signals,
                    rl_modifier=rl_composite_modifier,
                ))

        # Sort by composite score descending
        candidates.sort(key=lambda c: c["composite_score"], reverse=True)

        # Re-rank
        for i, c in enumerate(candidates):
            c["rank"] = i + 1

        return candidates[:max_candidates]

    def _build_candidate(
        self,
        changed_params: dict,
        parent_params: dict,
        parent_score: float,
        evidence: EvidenceAggregator,
        source: str,
        rank: int,
        mem_signals: tuple | None = None,
        rl_modifier: float = 0.0,
    ) -> dict:
        """Build a single candidate dict.

        mem_signals: (penalty, boost, failed_param_names, succeeded_param_names)
          penalty — subtracted from composite for each similar failed run
          boost   — added to composite for each similar successful run
          failed_param_names  — params that historically failed; extra penalty if overlap
          succeeded_param_names — params that historically succeeded; extra boost if overlap

        rl_modifier: pre-computed RL sharpe comparison signal (+0.02 / 0.0 / -0.02).
          Applied uniformly to every candidate so the RL signal influences ranking
          without overriding classical evidence.
        """
        # Estimate uplift (heuristic: distance from parent weighted by sensitivity)
        param_delta = {}
        uplift_estimate = 0.0
        for param, new_val in changed_params.items():
            old_val = float(parent_params.get(param, new_val))
            param_delta[param] = {"old": old_val, "new": new_val}
            if old_val != 0:
                pct_change = abs(new_val - old_val) / abs(old_val)
                uplift_estimate += pct_change * 0.05  # 5% uplift per 100% param change

        # Risk penalties from evidence
        risk_penalty = evidence.breach_penalty * 0.3 + evidence.fragility_score * 0.2

        # Memory-informed adjustments
        memory_adjustment = 0.0
        memory_note = ""
        if mem_signals:
            m_penalty, m_boost, failed_params, succeeded_params = mem_signals
            candidate_param_set = set(changed_params.keys())

            # Penalize overlap with historically-failed params
            failed_overlap = candidate_param_set & failed_params
            if failed_overlap:
                memory_adjustment -= m_penalty + len(failed_overlap) * 0.02

            # Boost overlap with historically-successful params
            succeeded_overlap = candidate_param_set & succeeded_params
            if succeeded_overlap:
                memory_adjustment += m_boost + len(succeeded_overlap) * 0.01

            if memory_adjustment != 0.0:
                direction = "penalized" if memory_adjustment < 0 else "boosted"
                memory_note = (
                    f" Memory {direction} {memory_adjustment:+.3f} "
                    f"(failed_overlap={len(failed_overlap)}, "
                    f"succeeded_overlap={len(succeeded_overlap)})."
                )

        composite = parent_score + uplift_estimate - risk_penalty + memory_adjustment + rl_modifier

        # Confidence based on evidence agreement
        n_sources = sum([
            bool(evidence.optuna_ranges),
            bool(evidence.sqa_ranges),
            evidence.breach_penalty > 0,
            evidence.fragility_score > 0,
        ])
        confidence = "high" if n_sources >= 3 else "medium" if n_sources >= 2 else "low"

        rl_note = ""
        if rl_modifier != 0.0:
            direction = "boost" if rl_modifier > 0 else "penalty"
            rl_note = f" RL {direction}: {rl_modifier:+.3f}."

        return {
            "rank": rank,
            "changed_params": {k: v for k, v in changed_params.items()},
            "parent_params": {k: float(parent_params.get(k, 0)) for k in changed_params},
            "source_of_change": source,
            "expected_uplift": float(uplift_estimate),
            "risk_penalty": float(risk_penalty),
            "memory_adjustment": float(memory_adjustment),
            "rl_modifier": float(rl_modifier),
            "composite_score": float(composite),
            "confidence": confidence,
            "reasoning": (
                f"Source: {source}. {len(changed_params)} params changed. "
                f"Breach penalty: {evidence.breach_penalty:.3f}. "
                f"Fragility: {evidence.fragility_score:.3f}."
                + memory_note
                + rl_note
            ),
        }


# ─── Kill Signals ────────────────────────────────────────────────────


def check_kill_signals(
    evidence: EvidenceAggregator,
    parent_score: float,
    candidates: list[dict],
) -> str | None:
    """Check if optimization should halt early.

    Returns kill signal string or None.
    """
    if evidence.breach_penalty > 0.5:
        return "catastrophic_risk"

    # fragility_score already incorporates the regime variance penalty added in
    # add_tensor(), so a single threshold covers both raw fragility and
    # regime disagreement.
    if evidence.fragility_score > 0.9:
        return "catastrophic_risk"

    # Kill if ALL candidates fail to reach 95% of the parent score.
    # At 0.95 the threshold is meaningful — any candidate that could plausibly
    # match or beat the parent after replay will clear this bar. Candidates that
    # can't reach 95% of parent are genuinely no improvement and replaying them
    # wastes capacity.
    if candidates and all(c["composite_score"] < parent_score * 0.95 for c in candidates):
        return "no_improvement"

    consensus = evidence.find_consensus_regions()
    if not consensus and evidence.optuna_ranges and evidence.sqa_ranges:
        return "evidence_disagrees"

    return None


# ─── Main Entry Point ────────────────────────────────────────────────


@annotate("forge/critic_optimizer")
def run_critic_optimizer(config: dict) -> dict:
    """Main critic optimizer pipeline.

    Input: Evidence packet (JSON)
    Output: Ranked candidates + evidence summary + kill signal
    """
    start_time = time.time()

    # Parse input
    strategy_config = config.get("strategy_config", {})
    backtest_metrics = config.get("backtest_metrics", {})
    walk_forward = config.get("walk_forward")
    sqa_result = config.get("sqa_result")
    mc_result = config.get("mc_result")
    quantum_mc_result = config.get("quantum_mc_result")
    qubo_timing = config.get("qubo_timing")
    tensor_prediction = config.get("tensor_prediction")
    rl_result = config.get("rl_result")
    deepar_evidence = config.get("deepar_evidence")
    param_ranges = config.get("param_ranges", [])
    max_candidates = config.get("max_candidates", 5)
    pennylane_enabled = config.get("pennylane_enabled", True)
    historical_runs = config.get("historical_runs", [])

    # Build parent params from strategy config
    parent_params: dict[str, float] = {}
    for ind in strategy_config.get("indicators", []):
        if "period" in ind:
            parent_params[f"{ind['type']}_period"] = float(ind["period"])
    sl = strategy_config.get("stop_loss", {})
    if "multiplier" in sl:
        parent_params["stop_loss_multiplier"] = float(sl["multiplier"])

    # ─── Stage A: Evidence Aggregation ────────────────────────
    range_push("forge/critic_evidence")
    evidence = EvidenceAggregator()
    evidence.add_classical(walk_forward)
    evidence.add_sqa(sqa_result)
    evidence.add_quantum_mc(quantum_mc_result)
    evidence.add_tensor(tensor_prediction)
    evidence.add_qubo(qubo_timing)
    evidence.add_rl(rl_result)

    # Add MC survival to metrics for scoring
    if mc_result:
        backtest_metrics["survival_rate"] = mc_result.get("survival_rate", 0)
        backtest_metrics["breach_probability"] = evidence.breach_penalty

    backtest_metrics["fragility_score"] = evidence.fragility_score
    # Derive param instability from walk-forward stability data
    param_instability = 0.0
    if walk_forward:
        stability = walk_forward.get("param_stability", {})
        if isinstance(stability, dict) and stability:
            # Check if any param has high variance across windows
            variances = []
            for param_info in stability.values():
                if isinstance(param_info, dict):
                    robust_min = float(param_info.get("robust_min", 0))
                    robust_max = float(param_info.get("robust_max", 0))
                    importance = float(param_info.get("importance", 0))
                    if robust_max > 0:
                        range_pct = (robust_max - robust_min) / robust_max
                        variances.append(range_pct * importance)
            if variances:
                # High range = unstable params. Normalize to 0-1.
                param_instability = min(1.0, float(np.mean(variances)) * 5.0)
    backtest_metrics["param_instability"] = param_instability
    backtest_metrics["timing_fragility"] = 1.0 - min(evidence.timing_improvement, 1.0)

    consensus = evidence.find_consensus_regions()
    range_pop()

    # ─── Compute parent composite score ───────────────────────
    objective = CompositeObjective()
    parent_normalized = objective.normalize_metrics(backtest_metrics)
    parent_score = objective.score(parent_normalized)

    # ─── DeepAR regime forecast modifier (challenger, advisory only) ────
    # Requires >= 60 days of tracked forecasts to earn any modifier weight.
    # ±0.01 is intentionally tiny — DeepAR earns authority through sustained
    # accuracy, not a large initial boost. No modifier when insufficient data.
    deepar_modifier = 0.0
    if deepar_evidence and deepar_evidence.get("days_tracked", 0) >= 60:
        hit_rate = deepar_evidence.get("hit_rate", 0.5)
        if hit_rate > 0.55:
            deepar_modifier = +0.01   # Small positive: DeepAR is proving useful
        elif hit_rate < 0.45:
            deepar_modifier = -0.01   # Small negative: DeepAR is hurting

    parent_score = parent_score + deepar_modifier

    # ─── Check kill signals early ─────────────────────────────
    # Pre-check before generating candidates
    if evidence.breach_penalty > 0.5 or evidence.fragility_score > 0.9:
        kill_signal = "catastrophic_risk"
        elapsed = int((time.time() - start_time) * 1000)
        return {
            "candidates": [],
            "parent_composite_score": parent_score,
            "evidence_summary": {
                **evidence.summary(),
                "deepar": {
                    "hit_rate": deepar_evidence.get("hit_rate") if deepar_evidence else None,
                    "days_tracked": deepar_evidence.get("days_tracked", 0) if deepar_evidence else 0,
                    "modifier_applied": deepar_modifier,
                },
            },
            "kill_signal": kill_signal,
            "execution_time_ms": elapsed,
            "governance": {
                "experimental": True,
                "authoritative": False,
                "decision_role": "challenger_only",
            },
        }

    # ─── Stage A.5: Strategy Memory Lookup (optional) ──────────
    memory_similar: list[dict] = []
    try:
        from src.engine.strategy_memory import StrategyMemory
        memory = StrategyMemory(embedding_dim=64)
        current_embedding = memory.embed_strategy(strategy_config, backtest_metrics)

        # Build the cuVS/numpy index from historical critic runs passed by TS.
        # Each entry in historical_runs must contain:
        #   strategy_config, backtest_metrics, parent_composite_score,
        #   survivor_composite_score (optional), outcome (str)
        if historical_runs:
            hist_embeddings = []
            hist_metadata: list[dict] = []
            for run in historical_runs:
                try:
                    h_config = run.get("strategy_config") or {}
                    h_metrics = run.get("backtest_metrics") or {}
                    emb = memory.embed_strategy(h_config, h_metrics)
                    hist_embeddings.append(emb)
                    hist_metadata.append({
                        "run_id": run.get("run_id"),
                        "strategy_id": run.get("strategy_id"),
                        "parent_composite_score": float(run.get("parent_composite_score") or 0),
                        "survivor_composite_score": float(run.get("survivor_composite_score") or 0),
                        "outcome": run.get("outcome", "unknown"),
                        "changed_params": run.get("changed_params") or {},
                    })
                except Exception:
                    continue
            if hist_embeddings:
                memory.build_index(np.array(hist_embeddings, dtype=np.float32), hist_metadata)

        memory_similar = memory.query(current_embedding, top_k=3)
    except Exception:
        pass  # Strategy memory is optional — proceed without

    # ─── Stage B: PennyLane Refinement (optional) ─────────────
    pennylane_candidates = []
    if pennylane_enabled and consensus and len(consensus) >= 2:
        refiner = PennyLaneRefiner(n_params=len(consensus))

        # Build known solutions from SQA all_solutions
        known = []
        if sqa_result and "all_solutions" in sqa_result:
            for sol in sqa_result["all_solutions"][:30]:
                if isinstance(sol, dict) and "params" in sol:
                    params = sol["params"]
                    vec = np.array([float(params.get(k, 0)) for k in consensus.keys()])
                    score = -float(sol.get("energy", 0))  # SQA minimizes energy
                    known.append((vec, score))

        if len(known) >= 5:
            pennylane_candidates = refiner.refine(consensus, known)

    # ─── Stage C: Candidate Generation ────────────────────────
    generator = CandidateGenerator(objective)
    candidates = generator.generate(
        consensus_regions=consensus,
        parent_params=parent_params,
        parent_metrics=backtest_metrics,
        evidence=evidence,
        pennylane_candidates=pennylane_candidates,
        max_candidates=max_candidates + 2,  # Generate extra, cuOpt will filter
        memory_similar=memory_similar,
    )

    # ─── Stage D: Constrained Selection (cuOpt or greedy) ────
    if candidates:
        try:
            from src.engine.cuopt_helpers import CandidateSelector
            selector = CandidateSelector()
            # Enrich candidates with constraint-relevant fields for selector
            for c in candidates:
                c["breach_probability"] = evidence.breach_penalty
                c["fragility_score"] = evidence.fragility_score
                c["max_drawdown"] = abs(float(backtest_metrics.get("max_drawdown", 0) or 0))
            candidates = selector.select(candidates, max_k=max_candidates)
            # Re-rank after filtering
            for i, c in enumerate(candidates):
                c["rank"] = i + 1
        except Exception:
            # Fallback: just take top max_candidates by score
            candidates = candidates[:max_candidates]

    # ─── Final kill signal check ──────────────────────────────
    kill_signal = check_kill_signals(evidence, parent_score, candidates)

    if kill_signal:
        candidates = []

    elapsed = int((time.time() - start_time) * 1000)

    return {
        "candidates": candidates,
        "parent_composite_score": parent_score,
        "evidence_summary": {
            **evidence.summary(),
            "consensus_regions": {k: list(v) for k, v in consensus.items()},
            "deepar": {
                "hit_rate": deepar_evidence.get("hit_rate") if deepar_evidence else None,
                "days_tracked": deepar_evidence.get("days_tracked", 0) if deepar_evidence else 0,
                "modifier_applied": deepar_modifier,
            },
            "memory_similar": [
                {
                    "run_id": s.get("run_id"),
                    "strategy_id": s.get("strategy_id"),
                    "outcome": s.get("outcome"),
                    "parent_composite_score": s.get("parent_composite_score"),
                    "survivor_composite_score": s.get("survivor_composite_score"),
                }
                for s in memory_similar
            ],
            "memory_index_size": len(historical_runs),
        },
        "kill_signal": kill_signal,
        "execution_time_ms": elapsed,
        "governance": {
            "experimental": True,
            "authoritative": False,
            "decision_role": "challenger_only",
        },
    }


# ─── CLI Entry Point ─────────────────────────────────────────────────


if __name__ == "__main__":
    import argparse
    import os

    parser = argparse.ArgumentParser(description="Critic Optimizer")
    parser.add_argument("--config", type=str, help="JSON config string")
    parser.add_argument("--config-file", type=str, help="JSON config file path")
    args = parser.parse_args()

    if args.config_file:
        with open(args.config_file) as f:
            config = json.load(f)
    elif args.config:
        config_str = args.config
        if os.path.isfile(config_str):
            with open(config_str) as f:
                config_str = f.read()
        config = json.loads(config_str)
    else:
        config = json.load(sys.stdin)

    result = run_critic_optimizer(config)
    print(json.dumps(result, indent=2))
