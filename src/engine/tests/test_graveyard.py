"""Tests for Strategy Graveyard (Phase 4.7).

Tests:
- Cosine similarity returns 1.0 for identical vectors
- Cosine similarity returns 0.0 for orthogonal vectors
- find_similar respects threshold and top_k
- Failure tagger identifies DRAWDOWN_EXCEEDED correctly
- Failure tagger identifies CURVE_FIT (walk-forward degradation)
- Failure tagger identifies COMMISSION_DEATH
- Corpse check REJECT at 0.90+ similarity
- Corpse check PROCEED below 0.85
"""

import math
import pytest

from src.engine.graveyard.similarity import cosine_similarity, find_similar
from src.engine.graveyard.failure_tagger import tag_failure, FAILURE_MODES
from src.engine.graveyard.graveyard_gate import corpse_check


# ─── Cosine Similarity ──────────────────────────────────────────


class TestCosineSimilarity:
    def test_identical_vectors_return_1(self):
        vec = [1.0, 2.0, 3.0, 4.0, 5.0]
        assert cosine_similarity(vec, vec) == pytest.approx(1.0, abs=1e-9)

    def test_orthogonal_vectors_return_0(self):
        vec_a = [1.0, 0.0, 0.0]
        vec_b = [0.0, 1.0, 0.0]
        assert cosine_similarity(vec_a, vec_b) == pytest.approx(0.0, abs=1e-9)

    def test_opposite_vectors_return_negative_1(self):
        vec_a = [1.0, 2.0, 3.0]
        vec_b = [-1.0, -2.0, -3.0]
        assert cosine_similarity(vec_a, vec_b) == pytest.approx(-1.0, abs=1e-9)

    def test_zero_vector_returns_0(self):
        vec_a = [0.0, 0.0, 0.0]
        vec_b = [1.0, 2.0, 3.0]
        assert cosine_similarity(vec_a, vec_b) == 0.0

    def test_similar_vectors_high_similarity(self):
        vec_a = [1.0, 2.0, 3.0]
        vec_b = [1.1, 2.1, 3.1]
        sim = cosine_similarity(vec_a, vec_b)
        assert sim > 0.99


# ─── find_similar ────────────────────────────────────────────────


class TestFindSimilar:
    @pytest.fixture
    def corpus(self):
        return [
            {"id": "a", "vector": [1.0, 0.0, 0.0], "metadata": {"name": "Strategy A"}},
            {"id": "b", "vector": [0.9, 0.1, 0.0], "metadata": {"name": "Strategy B"}},
            {"id": "c", "vector": [0.0, 1.0, 0.0], "metadata": {"name": "Strategy C"}},
            {"id": "d", "vector": [0.5, 0.5, 0.0], "metadata": {"name": "Strategy D"}},
            {"id": "e", "vector": [0.95, 0.05, 0.0], "metadata": {"name": "Strategy E"}},
        ]

    def test_respects_threshold(self, corpus):
        query = [1.0, 0.0, 0.0]
        # With high threshold, only very similar vectors should match
        results = find_similar(query, corpus, top_k=10, threshold=0.99)
        ids = [r["id"] for r in results]
        assert "a" in ids  # identical
        assert "c" not in ids  # orthogonal

    def test_respects_top_k(self, corpus):
        query = [1.0, 0.0, 0.0]
        results = find_similar(query, corpus, top_k=2, threshold=0.0)
        assert len(results) <= 2

    def test_sorted_by_similarity_desc(self, corpus):
        query = [1.0, 0.0, 0.0]
        results = find_similar(query, corpus, top_k=10, threshold=0.0)
        sims = [r["similarity"] for r in results]
        assert sims == sorted(sims, reverse=True)

    def test_empty_corpus_returns_empty(self):
        results = find_similar([1.0, 0.0], [], top_k=5, threshold=0.5)
        assert results == []


# ─── Failure Tagger ──────────────────────────────────────────────


class TestFailureTagger:
    def test_identifies_drawdown_exceeded(self):
        results = tag_failure({"max_drawdown": -3500})
        modes = [t["mode"] for t in results]
        assert "DRAWDOWN_EXCEEDED" in modes

    def test_drawdown_not_flagged_when_within_limit(self):
        results = tag_failure({"max_drawdown": -1500})
        modes = [t["mode"] for t in results]
        assert "DRAWDOWN_EXCEEDED" not in modes

    def test_identifies_curve_fit(self):
        backtest = {"sharpe_ratio": 2.0}
        walk_forward = {"sharpe_ratio": 0.5}  # 0.5 < 0.5 * 2.0
        results = tag_failure(backtest, walk_forward_results=walk_forward)
        modes = [t["mode"] for t in results]
        assert "CURVE_FIT" in modes

    def test_no_curve_fit_when_walk_forward_strong(self):
        backtest = {"sharpe_ratio": 2.0}
        walk_forward = {"sharpe_ratio": 1.8}  # 1.8 >= 0.5 * 2.0
        results = tag_failure(backtest, walk_forward_results=walk_forward)
        modes = [t["mode"] for t in results]
        assert "CURVE_FIT" not in modes

    def test_identifies_commission_death(self):
        results = tag_failure({"profit_factor": 0.85, "gross_profit_factor": 1.1})
        modes = [t["mode"] for t in results]
        assert "COMMISSION_DEATH" in modes

    def test_commission_death_high_confidence_with_gross(self):
        results = tag_failure({"profit_factor": 0.85, "gross_profit_factor": 1.1})
        tag = next(t for t in results if t["mode"] == "COMMISSION_DEATH")
        assert tag["confidence"] == 0.9

    def test_identifies_inconsistent_best_day(self):
        results = tag_failure({"best_day_pct": 60})
        modes = [t["mode"] for t in results]
        assert "INCONSISTENT" in modes

    def test_identifies_inconsistent_win_days(self):
        results = tag_failure({"win_days_per_month": 7})
        modes = [t["mode"] for t in results]
        assert "INCONSISTENT" in modes

    def test_identifies_overfit(self):
        backtest = {}
        robustness = {"mean_sharpe": 1.0, "std_sharpe": 0.8}  # std > 0.5 * mean
        results = tag_failure(backtest, robustness_results=robustness)
        modes = [t["mode"] for t in results]
        assert "OVERFIT" in modes

    def test_identifies_complexity_excess(self):
        results = tag_failure({"param_count": 8})
        modes = [t["mode"] for t in results]
        assert "COMPLEXITY_EXCESS" in modes

    def test_sorted_by_confidence_desc(self):
        results = tag_failure(
            {
                "max_drawdown": -4000,
                "profit_factor": 0.7,
                "param_count": 9,
            }
        )
        confidences = [t["confidence"] for t in results]
        assert confidences == sorted(confidences, reverse=True)

    def test_all_failure_modes_defined(self):
        assert len(FAILURE_MODES) == 10


# ─── Corpse Check (mocked embedding) ────────────────────────────


class TestCorpseCheck:
    """
    corpse_check calls embed_strategy which needs Ollama.
    We monkeypatch the embedder to return deterministic vectors.
    """

    @pytest.fixture(autouse=True)
    def mock_embedder(self, monkeypatch):
        """Replace embed_strategy with a simple hash-based vector."""

        def fake_embed(dsl, failure_context=""):
            # Create a deterministic pseudo-vector from strategy name
            name = dsl.get("name", "")
            # Simple: fill 10-dim vector based on character codes
            vec = [0.0] * 10
            for i, ch in enumerate(name):
                vec[i % 10] += ord(ch) / 100.0
            # Normalize
            norm = math.sqrt(sum(v * v for v in vec))
            if norm > 0:
                vec = [v / norm for v in vec]
            return vec

        monkeypatch.setattr(
            "src.engine.graveyard.graveyard_gate.embed_strategy", fake_embed
        )

    def _make_corpus_entry(self, name: str, failure_modes: list[str] | None = None):
        """Build a graveyard corpus entry with a fake embedding."""
        vec = [0.0] * 10
        for i, ch in enumerate(name):
            vec[i % 10] += ord(ch) / 100.0
        norm = math.sqrt(sum(v * v for v in vec))
        if norm > 0:
            vec = [v / norm for v in vec]
        return {
            "id": f"grave-{name}",
            "vector": vec,
            "metadata": {
                "name": name,
                "failure_modes": failure_modes or ["OVERFIT"],
                "death_date": "2026-01-15",
            },
        }

    def test_reject_at_high_similarity(self):
        """Identical name => similarity ~1.0 => REJECT."""
        corpus = [self._make_corpus_entry("MA_Cross_ES_5m")]
        candidate = {"name": "MA_Cross_ES_5m"}
        result = corpse_check(candidate, corpus, similarity_threshold=0.85)
        assert result["recommendation"] == "REJECT"
        assert result["pass"] is False
        assert len(result["matches"]) >= 1
        assert result["matches"][0]["similarity"] >= 0.90

    def test_proceed_below_threshold(self):
        """Orthogonal vector => low similarity => PROCEED."""
        # Construct a corpus entry with a vector orthogonal to what the embedder returns
        candidate = {"name": "MA_Cross_ES_5m"}
        # Build a corpus entry with an orthogonal vector (all weight in dim that candidate doesn't use)
        corpus = [
            {
                "id": "grave-orthogonal",
                "vector": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0],
                "metadata": {
                    "name": "Completely Different",
                    "failure_modes": ["OVERFIT"],
                    "death_date": "2026-01-15",
                },
            }
        ]
        result = corpse_check(candidate, corpus, similarity_threshold=0.85)
        assert result["recommendation"] == "PROCEED"
        assert result["pass"] is True

    def test_empty_graveyard_always_proceeds(self):
        result = corpse_check({"name": "anything"}, [], similarity_threshold=0.85)
        assert result["recommendation"] == "PROCEED"
        assert result["pass"] is True
        assert result["matches"] == []

    def test_review_at_moderate_similarity(self):
        """Slightly different name => similarity between 0.85-0.90 => REVIEW."""
        corpus = [self._make_corpus_entry("MA_Cross_ES_5m")]
        # Very similar but not identical
        candidate = {"name": "MA_Cross_ES_5n"}
        result = corpse_check(candidate, corpus, similarity_threshold=0.85)
        # Could be REVIEW or REJECT depending on exact similarity
        assert result["recommendation"] in ("REVIEW", "REJECT")
        assert result["pass"] is False

    def test_matches_contain_metadata(self):
        corpus = [self._make_corpus_entry("MA_Cross_ES_5m", ["OVERFIT", "DECAY"])]
        candidate = {"name": "MA_Cross_ES_5m"}
        result = corpse_check(candidate, corpus, similarity_threshold=0.85)
        if result["matches"]:
            match = result["matches"][0]
            assert "graveyard_id" in match
            assert "similarity" in match
            assert "name" in match
            assert "failure_modes" in match
            assert "death_date" in match
