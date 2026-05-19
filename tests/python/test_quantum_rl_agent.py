"""Tests for quantum RL agent."""
import numpy as np
import pytest
from src.engine.quantum_rl_agent import (
    TradingEnv, QuantumAgent, ClassicalAgent,
    train_quantum_agent, evaluate_agent,
    VQCConfig, TrainConfig, AgentResult,
    GOVERNANCE,
)


class TestQuantumRLAgent:
    def _make_env(self, n=100, seed=42):
        rng = np.random.default_rng(seed)
        prices = 4000 + np.cumsum(rng.standard_normal(n) * 2)
        features = rng.standard_normal((n, 8))
        return TradingEnv(prices, features, seed=seed)

    def test_env_reset(self):
        env = self._make_env()
        state = env.reset()
        assert len(state) == 10  # 8 features + position + pnl
        assert env.position == 0
        assert env.pnl == 0.0

    def test_env_step(self):
        env = self._make_env()
        env.reset()
        next_state, reward, done = env.step(0)  # Buy
        assert env.position == 1
        assert not done

    def test_classical_agent_select_action(self):
        agent = ClassicalAgent(state_dim=10, n_actions=3)
        state = np.random.default_rng(42).standard_normal(10)
        action = agent.select_action(state)
        assert action in (0, 1, 2)

    def test_quantum_agent_select_action(self):
        config = VQCConfig(n_qubits=4, n_layers=1)
        agent = QuantumAgent(config)
        state = np.random.default_rng(42).standard_normal(6)  # 4 + 2
        action = agent.select_action(state)
        assert action in (0, 1, 2)

    def test_train_returns_result(self):
        env = self._make_env(50)
        config = VQCConfig(n_qubits=4, n_layers=1)
        train_config = TrainConfig(episodes=3, max_steps_per_episode=20)
        agent, result = train_quantum_agent(env, config, train_config)
        assert isinstance(result, AgentResult)
        assert result.execution_time_ms >= 0  # May be 0 for very fast runs

    def test_evaluate_returns_result(self):
        env = self._make_env(50)
        config = VQCConfig(n_qubits=4, n_layers=1)
        agent = QuantumAgent(config)
        result = evaluate_agent(agent, env)
        assert isinstance(result, AgentResult)
        assert result.total_trades >= 0

    def test_governance_labels(self):
        env = self._make_env(50)
        config = VQCConfig(n_qubits=4, n_layers=1)
        agent = QuantumAgent(config)
        result = evaluate_agent(agent, env)
        assert result.governance["experimental"] is True
        assert result.governance["decision_role"] == "challenger_only"

    def test_env_closes_position_at_end(self):
        env = self._make_env(10)
        env.reset()
        env.step(0)  # Buy
        for _ in range(8):
            env.step(2)  # Hold
        _, _, done = env.step(2)
        assert done is True
        assert env.position == 0  # Should close at end
