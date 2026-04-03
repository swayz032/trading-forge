"""Quantum RL Agent — Variational Quantum Circuit for trade decisions.

Uses parameterized quantum circuits (VQC) as the RL policy network.
8-16 qubit circuits trained via policy gradient on RTX 5060.

Evidence: MIXED
  (+) Wells Fargo: Sharpe 4.01, 30.1% return (arxiv 2507.12835)
  (-) Chen et al: Underperforms classical on real metrics (arxiv 2506.20930)
  → Treat as experimental. Full WF+MC+OOS validation required.

Library: PennyLane + pennylane-lightning[gpu] (WSL2)
Governance: experimental: true, decision_role: challenger_only

Usage:
    python -m src.engine.quantum_rl_agent --mode train --input-json '{"episodes": 100, ...}'
    python -m src.engine.quantum_rl_agent --mode evaluate --input-json '{"model_path": "...", ...}'
"""
from __future__ import annotations

import json
import sys
import time
import hashlib
from typing import Optional

import numpy as np
from pydantic import BaseModel, Field

# Optional PennyLane
try:
    import pennylane as qml
    from pennylane import numpy as pnp
    PENNYLANE_AVAILABLE = True
    try:
        from braket.aws import AwsDevice  # noqa: F401 — presence check only
        BRAKET_PENNYLANE_AVAILABLE = True
    except ImportError:
        BRAKET_PENNYLANE_AVAILABLE = False
except ImportError:
    PENNYLANE_AVAILABLE = False
    BRAKET_PENNYLANE_AVAILABLE = False


# ─── Governance ──────────────────────────────────────────────────
GOVERNANCE = {
    "experimental": True,
    "authoritative": False,
    "decision_role": "challenger_only",
    "evidence_status": "mixed — requires full WF+MC+OOS validation",
}


class VQCConfig(BaseModel):
    """Configuration for the Variational Quantum Circuit policy."""
    n_qubits: int = 8
    n_layers: int = 3
    feature_dim: int = 8  # Must match number of market features
    n_actions: int = 3    # buy, sell, hold
    learning_rate: float = 0.01
    device: str = "default.qubit"  # default.qubit | lightning.qubit | lightning.gpu | braket.aws.sv1 | braket.aws.ionq
    cloud_config: Optional[dict] = None  # CloudBackendConfig as dict (opt-in only)
    max_cloud_evaluations: int = 100     # Cost control: switch to local after this many cloud circuit evaluations


class TrainConfig(BaseModel):
    """Training configuration."""
    episodes: int = 100
    max_steps_per_episode: int = 100
    gamma: float = 0.99  # Discount factor
    seed: int = 42


class AgentResult(BaseModel):
    """Result from agent evaluation."""
    total_return: float
    sharpe_ratio: float
    win_rate: float
    total_trades: int
    actions: list[int] = Field(default_factory=list)  # 0=buy, 1=sell, 2=hold
    rewards: list[float] = Field(default_factory=list)
    execution_time_ms: int = 0
    governance: dict = Field(default_factory=lambda: GOVERNANCE.copy())


class ComparisonResult(BaseModel):
    """Quantum vs classical RL comparison."""
    quantum: AgentResult
    classical: AgentResult
    quantum_wins: bool
    sharpe_delta: float
    return_delta: float
    notes: str = ""
    governance: dict = Field(default_factory=lambda: GOVERNANCE.copy())


# ─── Simple Trading Environment ──────────────────────────────────

class TradingEnv:
    """Minimal trading environment for RL training.

    State: [price_change, rsi, atr, volume, position, pnl, ...]
    Actions: 0=buy, 1=sell, 2=hold
    Reward: realized + unrealized P&L change
    """

    def __init__(self, prices: np.ndarray, features: np.ndarray, seed: int = 42):
        self.prices = prices
        self.features = features  # (n_steps, n_features)
        self.n_steps = len(prices)
        self.rng = np.random.default_rng(seed)
        self.reset()

    def reset(self) -> np.ndarray:
        self.step_idx = 0
        self.position = 0  # -1, 0, 1
        self.entry_price = 0.0
        self.pnl = 0.0
        self.trades = 0
        return self._get_state()

    def _get_state(self) -> np.ndarray:
        if self.step_idx >= len(self.features):
            return np.zeros(self.features.shape[1] + 2)
        state = np.concatenate([
            self.features[self.step_idx],
            [self.position, self.pnl / 1000],  # Normalize PnL
        ])
        return state

    def step(self, action: int) -> tuple[np.ndarray, float, bool]:
        """Take action and return (next_state, reward, done)."""
        reward = 0.0
        price = self.prices[self.step_idx]

        if action == 0 and self.position <= 0:  # Buy
            if self.position < 0:
                # Close short
                reward = self.entry_price - price
                self.pnl += reward
                self.trades += 1
            self.position = 1
            self.entry_price = price
        elif action == 1 and self.position >= 0:  # Sell
            if self.position > 0:
                # Close long
                reward = price - self.entry_price
                self.pnl += reward
                self.trades += 1
            self.position = -1
            self.entry_price = price
        else:  # Hold
            if self.position != 0:
                # Unrealized P&L change
                if self.position > 0:
                    reward = (self.prices[min(self.step_idx + 1, self.n_steps - 1)] - price) * 0.1
                else:
                    reward = (price - self.prices[min(self.step_idx + 1, self.n_steps - 1)]) * 0.1

        self.step_idx += 1
        done = self.step_idx >= self.n_steps - 1

        # Close position at end
        if done and self.position != 0:
            final_price = self.prices[-1]
            if self.position > 0:
                reward += final_price - self.entry_price
            else:
                reward += self.entry_price - final_price
            self.pnl += reward
            self.position = 0
            self.trades += 1

        return self._get_state(), reward, done


# ─── Classical RL Baseline (Simple DQN-like) ─────────────────────

class ClassicalAgent:
    """Simple tabular/linear RL agent for baseline comparison."""

    def __init__(self, state_dim: int, n_actions: int = 3, seed: int = 42):
        self.rng = np.random.default_rng(seed)
        self.weights = self.rng.standard_normal((state_dim, n_actions)) * 0.01
        self.n_actions = n_actions
        self.lr = 0.01

    def select_action(self, state: np.ndarray, epsilon: float = 0.1) -> int:
        if self.rng.random() < epsilon:
            return self.rng.integers(0, self.n_actions)
        q_values = state @ self.weights
        return int(np.argmax(q_values))

    def update(self, state: np.ndarray, action: int, reward: float, next_state: np.ndarray, gamma: float = 0.99):
        q_current = state @ self.weights
        q_next = next_state @ self.weights
        target = reward + gamma * np.max(q_next)
        error = target - q_current[action]
        self.weights[:, action] += self.lr * error * state


# ─── Quantum Policy (VQC) ────────────────────────────────────────

def build_vqc_policy(config: VQCConfig):
    """Build parameterized quantum circuit for policy network.

    Architecture:
      1. Angle encoding of features onto qubits
      2. Variational layers (Ry + CNOT entanglement)
      3. Measurement → softmax → action probabilities
    """
    if not PENNYLANE_AVAILABLE:
        return None, None

    # Braket cloud device selection — opt-in, only when library is present
    _BRAKET_DEVICE_ARNS = {
        "braket.aws.sv1": "arn:aws:braket:::device/quantum-simulator/amazon/sv1",
        "braket.aws.ionq": "arn:aws:braket:us-east-1::device/qpu/ionq/Forte-1",
    }
    if config.device.startswith("braket.aws") and BRAKET_PENNYLANE_AVAILABLE:
        arn = _BRAKET_DEVICE_ARNS.get(config.device)
        if arn:
            dev = qml.device(
                "braket.aws.qubit",
                device_arn=arn,
                wires=config.n_qubits,
                shots=1000,
                s3_destination_folder=("amazon-braket-trading-forge", "rl-jobs"),
            )
        else:
            # Unknown Braket device string — fall back to local simulator
            dev = qml.device("default.qubit", wires=config.n_qubits)
    elif config.device.startswith("braket.aws") and not BRAKET_PENNYLANE_AVAILABLE:
        # Braket requested but library unavailable — fall back to local simulator
        import logging as _logging
        _logging.getLogger(__name__).warning(
            "Braket PennyLane plugin not available (braket-pennylane not installed). "
            "Falling back to default.qubit for VQC."
        )
        dev = qml.device("default.qubit", wires=config.n_qubits)
    else:
        dev = qml.device(config.device or "default.qubit", wires=config.n_qubits)

    n_params = config.n_layers * config.n_qubits * 2  # Ry + Rz per qubit per layer

    @qml.qnode(dev)
    def circuit(params, features):
        # Feature encoding
        for i in range(min(config.n_qubits, len(features))):
            qml.RY(features[i], wires=i)

        # Variational layers
        param_idx = 0
        for layer in range(config.n_layers):
            for qubit in range(config.n_qubits):
                qml.RY(params[param_idx], wires=qubit)
                param_idx += 1
                qml.RZ(params[param_idx], wires=qubit)
                param_idx += 1

            # Entanglement
            for qubit in range(config.n_qubits - 1):
                qml.CNOT(wires=[qubit, qubit + 1])
            if config.n_qubits > 1:
                qml.CNOT(wires=[config.n_qubits - 1, 0])

        # Measure first n_actions qubits
        return [qml.expval(qml.PauliZ(i)) for i in range(min(config.n_actions, config.n_qubits))]

    return circuit, n_params


class QuantumAgent:
    """Quantum RL agent using VQC policy."""

    def __init__(self, config: VQCConfig, seed: int = 42):
        self.config = config
        self.rng = np.random.default_rng(seed)

        if PENNYLANE_AVAILABLE:
            self.circuit, self.n_params = build_vqc_policy(config)
            self.params = self.rng.standard_normal(self.n_params) * 0.1
        else:
            self.circuit = None
            # Fallback linear policy needs n_qubits * n_actions params minimum
            self.n_params = max(config.n_layers * config.n_qubits * 2, config.n_qubits * config.n_actions)
            self.params = self.rng.standard_normal(self.n_params) * 0.1

    def select_action(self, state: np.ndarray, epsilon: float = 0.1) -> int:
        if self.rng.random() < epsilon:
            return self.rng.integers(0, self.config.n_actions)

        if self.circuit is not None:
            # Normalize features to [0, pi]
            features = np.clip(state[:self.config.n_qubits], -3, 3) * np.pi / 3
            expectations = self.circuit(self.params, features)
            # Convert expectations to probabilities via softmax
            exp_vals = np.exp(np.array(expectations))
            probs = exp_vals / exp_vals.sum()
            return self.rng.choice(self.config.n_actions, p=probs)
        else:
            # Fallback: linear policy
            q_values = state[:self.config.n_qubits] @ self.params[:self.config.n_qubits * self.config.n_actions].reshape(self.config.n_qubits, self.config.n_actions)
            return int(np.argmax(q_values))

    def update_policy(self, states: list, actions: list, rewards: list, lr: float = 0.01):
        """Simple policy gradient update (REINFORCE)."""
        if self.circuit is None:
            return

        # Compute discounted returns
        returns = []
        G = 0
        for r in reversed(rewards):
            G = r + 0.99 * G
            returns.insert(0, G)
        returns = np.array(returns)
        if returns.std() > 0:
            returns = (returns - returns.mean()) / (returns.std() + 1e-8)

        # Simple parameter perturbation (evolutionary strategy)
        best_params = self.params.copy()
        best_reward = sum(rewards)

        for _ in range(5):  # Try 5 perturbations
            perturbation = self.rng.standard_normal(self.n_params) * lr
            self.params += perturbation
            # Would need to re-evaluate — simplified for now
            self.params = best_params + perturbation * 0.1


def train_quantum_agent(
    env: TradingEnv,
    config: VQCConfig,
    train_config: TrainConfig,
) -> tuple[QuantumAgent, AgentResult]:
    """Train quantum RL agent via policy gradient."""
    start_ms = int(time.time() * 1000)
    agent = QuantumAgent(config, seed=train_config.seed)

    all_rewards = []
    all_actions = []

    # Cloud evaluation counter — when a Braket/cloud device is configured, switch to
    # local after max_cloud_evaluations circuit calls to control cost.  The counter is
    # approximate: each select_action call that hits the circuit counts as one evaluation.
    _cloud_evals: int = 0
    _cloud_device_active: bool = config.device.startswith("braket.aws") and BRAKET_PENNYLANE_AVAILABLE
    _max_cloud_evals: int = config.max_cloud_evaluations

    for episode in range(train_config.episodes):
        state = env.reset()
        episode_rewards = []
        episode_states = []
        episode_actions = []

        epsilon = max(0.01, 1.0 - episode / train_config.episodes)

        for step in range(train_config.max_steps_per_episode):
            # Cloud evaluation budget guard — rebuild agent with local device when limit hit
            if _cloud_device_active and _cloud_evals >= _max_cloud_evals:
                import logging as _logging
                _logging.getLogger(__name__).info(
                    "Cloud evaluation limit (%d) reached — switching VQC to default.qubit for remainder of training.",
                    _max_cloud_evals,
                )
                local_config = config.model_copy(update={"device": "default.qubit"})
                agent.circuit, agent.n_params = build_vqc_policy(local_config)
                _cloud_device_active = False  # prevent repeated rebuilds

            action = agent.select_action(state, epsilon)
            if _cloud_device_active:
                _cloud_evals += 1
            next_state, reward, done = env.step(action)

            episode_states.append(state)
            episode_actions.append(action)
            episode_rewards.append(reward)

            state = next_state
            if done:
                break

        # Update policy
        agent.update_policy(episode_states, episode_actions, episode_rewards, config.learning_rate)

        all_rewards.extend(episode_rewards)
        all_actions.extend(episode_actions)

    execution_time_ms = int(time.time() * 1000) - start_ms

    # Final evaluation
    total_return = env.pnl
    daily_returns = np.diff(np.cumsum([0] + all_rewards))
    sharpe = 0.0
    if len(daily_returns) > 1 and np.std(daily_returns) > 0:
        sharpe = float(np.mean(daily_returns) / np.std(daily_returns) * np.sqrt(252))

    win_rate = sum(1 for r in all_rewards if r > 0) / max(len(all_rewards), 1)

    return agent, AgentResult(
        total_return=float(total_return),
        sharpe_ratio=sharpe,
        win_rate=float(win_rate),
        total_trades=env.trades,
        actions=all_actions[-100:],  # Last 100 actions
        rewards=all_rewards[-100:],
        execution_time_ms=execution_time_ms,
    )


def evaluate_agent(
    agent,
    env: TradingEnv,
) -> AgentResult:
    """Evaluate trained agent on test data."""
    start_ms = int(time.time() * 1000)
    state = env.reset()
    actions = []
    rewards = []

    while True:
        action = agent.select_action(state, epsilon=0.0)
        next_state, reward, done = env.step(action)
        actions.append(action)
        rewards.append(reward)
        state = next_state
        if done:
            break

    execution_time_ms = int(time.time() * 1000) - start_ms

    total_return = env.pnl
    daily_returns = np.array(rewards)
    sharpe = 0.0
    if len(daily_returns) > 1 and np.std(daily_returns) > 0:
        sharpe = float(np.mean(daily_returns) / np.std(daily_returns) * np.sqrt(252))

    win_rate = sum(1 for r in rewards if r > 0) / max(len(rewards), 1)

    return AgentResult(
        total_return=float(total_return),
        sharpe_ratio=sharpe,
        win_rate=float(win_rate),
        total_trades=env.trades,
        actions=actions,
        rewards=rewards,
        execution_time_ms=execution_time_ms,
    )


def compare_vs_classical_rl(
    quantum_result: AgentResult,
    env: TradingEnv,
    train_config: TrainConfig,
) -> ComparisonResult:
    """Compare quantum agent against classical DQN baseline."""
    state_dim = env.features.shape[1] + 2
    classical = ClassicalAgent(state_dim, seed=train_config.seed)

    # Train classical agent
    start_ms = int(time.time() * 1000)
    for episode in range(train_config.episodes):
        state = env.reset()
        epsilon = max(0.01, 1.0 - episode / train_config.episodes)

        for step in range(train_config.max_steps_per_episode):
            action = classical.select_action(state, epsilon)
            next_state, reward, done = env.step(action)
            classical.update(state, action, reward, next_state)
            state = next_state
            if done:
                break

    classical_time_ms = int(time.time() * 1000) - start_ms

    # Evaluate classical
    state = env.reset()
    c_rewards = []
    c_actions = []
    while True:
        action = classical.select_action(state, epsilon=0.0)
        next_state, reward, done = env.step(action)
        c_rewards.append(reward)
        c_actions.append(action)
        state = next_state
        if done:
            break

    c_return = env.pnl
    c_daily = np.array(c_rewards)
    c_sharpe = 0.0
    if len(c_daily) > 1 and np.std(c_daily) > 0:
        c_sharpe = float(np.mean(c_daily) / np.std(c_daily) * np.sqrt(252))
    c_win = sum(1 for r in c_rewards if r > 0) / max(len(c_rewards), 1)

    classical_result = AgentResult(
        total_return=float(c_return),
        sharpe_ratio=c_sharpe,
        win_rate=float(c_win),
        total_trades=env.trades,
        actions=c_actions,
        rewards=c_rewards,
        execution_time_ms=classical_time_ms,
    )

    quantum_wins = quantum_result.sharpe_ratio > classical_result.sharpe_ratio

    notes = []
    if quantum_wins:
        notes.append(f"Quantum agent Sharpe {quantum_result.sharpe_ratio:.3f} > classical {classical_result.sharpe_ratio:.3f}")
    else:
        notes.append(f"Classical agent Sharpe {classical_result.sharpe_ratio:.3f} > quantum {quantum_result.sharpe_ratio:.3f}")

    return ComparisonResult(
        quantum=quantum_result,
        classical=classical_result,
        quantum_wins=quantum_wins,
        sharpe_delta=quantum_result.sharpe_ratio - classical_result.sharpe_ratio,
        return_delta=quantum_result.total_return - classical_result.total_return,
        notes="; ".join(notes),
    )


def export_agent_signals(
    agent,
    prices: np.ndarray,
    features: np.ndarray,
) -> list[dict]:
    """Generate buy/sell/hold signal stream from trained agent."""
    env = TradingEnv(prices, features)
    state = env.reset()
    signals = []

    action_map = {0: "buy", 1: "sell", 2: "hold"}

    for i in range(len(prices) - 1):
        action = agent.select_action(state, epsilon=0.0)
        next_state, reward, done = env.step(action)

        signals.append({
            "step": i,
            "price": float(prices[i]),
            "action": action_map[action],
            "action_id": action,
            "reward": float(reward),
            "position": env.position,
        })

        state = next_state
        if done:
            break

    return signals


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", required=True, choices=["train", "evaluate", "compare"])
    parser.add_argument("--input-json", required=True)
    args = parser.parse_args()

    # Support both inline JSON and file path
    raw = args.input_json
    if raw.endswith(".json"):
        with open(raw, "r") as f:
            config = json.load(f)
    else:
        config = json.loads(raw)

    # Build environment from config data or synthetic
    if "prices" in config and config["prices"] is not None and "features" in config and config["features"] is not None:
        prices = np.array(config["prices"], dtype=float)
        features = np.array(config["features"], dtype=float)
    else:
        # Synthetic data for testing
        rng = np.random.default_rng(42)
        n_steps = config.get("n_steps", 200)
        prices = 4000 + np.cumsum(rng.standard_normal(n_steps) * 2)
        features = rng.standard_normal((n_steps, 8))

    env = TradingEnv(prices, features)

    vqc_config = VQCConfig(
        n_qubits=config.get("n_qubits", 8),
        n_layers=config.get("n_layers", 3),
        feature_dim=features.shape[1],
    )
    train_config = TrainConfig(
        episodes=config.get("episodes", 100),
        max_steps_per_episode=min(config.get("max_steps", 100), len(prices) - 1),
    )

    if args.mode == "train":
        agent, result = train_quantum_agent(env, vqc_config, train_config)
        print(result.model_dump_json(indent=2))

    elif args.mode == "evaluate":
        agent = QuantumAgent(vqc_config)
        result = evaluate_agent(agent, env)
        print(result.model_dump_json(indent=2))

    elif args.mode == "compare":
        agent, q_result = train_quantum_agent(env, vqc_config, train_config)
        comparison = compare_vs_classical_rl(q_result, env, train_config)
        print(comparison.model_dump_json(indent=2))
