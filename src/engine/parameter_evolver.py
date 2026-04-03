"""Parameter Evolver — LLM-guided strategy mutation engine.

When a strategy enters DECLINING, this engine:
1. Loads current params + Optuna robust ranges
2. Calls Ollama qwen3 for 3 mutation candidates
3. Returns structured mutations for re-backtesting

Called by evolution-service.ts via subprocess (same pattern as backtester.py).
"""

from __future__ import annotations

import json
import sys
import argparse
from typing import Optional

import requests


OLLAMA_URL = "http://127.0.0.1:11434/api/generate"
MODEL = "qwen3-coder:30b"


def build_mutation_prompt(
    name: str,
    symbol: str,
    timeframe: str,
    params: dict,
    robust_ranges: dict,
    current_sharpe: float,
    baseline_sharpe: float,
    window_sharpes: list[float],
    mutation_history: list[dict] | None = None,
) -> str:
    """Build the LLM mutation prompt.

    Args:
        mutation_history: Optional list of prior mutation outcomes for this
            strategy/archetype. Each entry is a dict with keys:
            param_name, direction, magnitude, improvement, success, regime.
            When provided, the summary is injected into the prompt so the
            LLM can avoid repeating failed directions and reinforce working ones.
    """
    history_section = ""
    if mutation_history:
        # Summarise: group by (param_name, direction) and show avg improvement + success rate
        from collections import defaultdict
        summary: dict[str, dict] = defaultdict(lambda: {"attempts": 0, "successes": 0, "total_improvement": 0.0})
        for entry in mutation_history:
            key = f"{entry.get('param_name', '?')} {entry.get('direction', '?')}"
            summary[key]["attempts"] += 1
            if entry.get("success"):
                summary[key]["successes"] += 1
            summary[key]["total_improvement"] += float(entry.get("improvement", 0))

        lines = []
        for key, data in sorted(summary.items(), key=lambda x: -x[1]["total_improvement"]):
            avg_imp = data["total_improvement"] / max(data["attempts"], 1)
            win_rate = data["successes"] / max(data["attempts"], 1)
            lines.append(
                f"  - {key}: {data['attempts']} tries, "
                f"{win_rate:.0%} success, avg Sharpe delta {avg_imp:+.3f}"
            )

        history_section = (
            "\nPrior mutation history for this strategy archetype:\n"
            + "\n".join(lines)
            + "\nPrefer directions with high success rates. Avoid repeating high-attempt, low-success directions.\n"
        )

    return f"""Strategy "{name}" ({symbol} {timeframe}) is declining.
Current params: {json.dumps(params)}
Robust ranges from Optuna: {json.dumps(robust_ranges)}
Last 30-day rolling Sharpe: {current_sharpe:.4f} (was {baseline_sharpe:.4f})
Walk-forward window performance trend: {window_sharpes}
{history_section}
Suggest 3 parameter mutations that:
1. Stay within robust ranges (avoid cliff-edge params)
2. Target the SPECIFIC weakness (if Sharpe dropped -> adjust R:R params; if win rate dropped -> tighten entries)
3. Are meaningfully different from each other

Return a JSON object with a "mutations" key containing an array of 3 objects. Each object has keys matching param names with new values, plus a "reason" key explaining the change.
Example: {{"mutations": [{{"ind_0_period": 15, "reason": "Faster MA to catch trend reversals earlier"}}]}}

IMPORTANT: Return ONLY valid JSON. No markdown code blocks."""


def call_ollama(prompt: str, max_retries: int = 2) -> list[dict]:
    """Call Ollama and parse the JSON response."""
    for attempt in range(max_retries + 1):
        try:
            resp = requests.post(
                OLLAMA_URL,
                json={
                    "model": MODEL,
                    "prompt": f"/no_think\n{prompt}",
                    "stream": False,
                    "format": "json",
                    "options": {"temperature": 0.7, "num_predict": 2048},
                },
                timeout=120,
            )
            resp.raise_for_status()
            text = resp.json().get("response", "").strip()

            parsed = json.loads(text)
            # Handle both {"mutations": [...]} and bare [...]
            if isinstance(parsed, dict):
                mutations = parsed.get("mutations", [])
            elif isinstance(parsed, list):
                mutations = parsed
            else:
                mutations = []
            if isinstance(mutations, list) and len(mutations) > 0:
                return mutations[:3]
        except (json.JSONDecodeError, requests.RequestException) as e:
            print(f"  Attempt {attempt + 1} failed: {e}", file=sys.stderr)
            if attempt == max_retries:
                return []

    return []


def validate_mutations(
    mutations: list[dict],
    robust_ranges: dict,
    current_params: dict,
) -> list[dict]:
    """Validate mutations stay within robust ranges and are meaningfully different."""
    validated = []
    for mut in mutations:
        reason = mut.pop("reason", "No reason given")
        valid = True
        clamped = {}

        for param_name, value in mut.items():
            if param_name in robust_ranges:
                low, high = robust_ranges[param_name]
                clamped_val = max(low, min(high, value))
                clamped[param_name] = clamped_val
                if clamped_val != value:
                    print(f"  Clamped {param_name}: {value} -> {clamped_val} (range [{low}, {high}])", file=sys.stderr)
            else:
                clamped[param_name] = value

        # Check meaningful difference from current (at least one param differs by >5%)
        has_diff = False
        for pname, pval in clamped.items():
            if pname in current_params:
                curr = current_params[pname]
                if curr != 0 and abs(pval - curr) / abs(curr) > 0.05:
                    has_diff = True
                    break
                elif curr == 0 and pval != 0:
                    has_diff = True
                    break

        if has_diff and clamped:
            validated.append({"params": clamped, "reason": reason})

    return validated


def evolve(config_path: str) -> dict:
    """Main evolution entry point. Reads config JSON, calls LLM, returns mutations.

    The config JSON may optionally contain a "mutation_history" key carrying a
    list of prior mutation outcome records (see mutationOutcomes schema).  When
    present, a summarised version is injected into the LLM prompt so the model
    can learn from what has and has not worked before.
    """
    with open(config_path, "r") as f:
        config = json.load(f)

    name = config["name"]
    symbol = config["symbol"]
    timeframe = config["timeframe"]
    params = config.get("current_params", {})
    robust_ranges = config.get("robust_ranges", {})
    current_sharpe = config.get("current_sharpe", 0.0)
    baseline_sharpe = config.get("baseline_sharpe", 0.0)
    window_sharpes = config.get("window_sharpes", [])
    mutation_history: list[dict] | None = config.get("mutation_history") or None

    print(f"Evolving: {name} ({symbol} {timeframe})", file=sys.stderr)
    print(f"  Current Sharpe: {current_sharpe:.4f}, Baseline: {baseline_sharpe:.4f}", file=sys.stderr)
    if mutation_history:
        print(f"  Mutation history: {len(mutation_history)} prior outcomes provided", file=sys.stderr)

    prompt = build_mutation_prompt(
        name, symbol, timeframe, params, robust_ranges,
        current_sharpe, baseline_sharpe, window_sharpes,
        mutation_history=mutation_history,
    )

    raw_mutations = call_ollama(prompt)
    if not raw_mutations:
        return {"mutations": [], "error": "LLM returned no valid mutations"}

    validated = validate_mutations(raw_mutations, robust_ranges, params)
    print(f"  Generated {len(raw_mutations)} mutations, {len(validated)} validated", file=sys.stderr)

    return {
        "mutations": validated,
        "model": MODEL,
        "parent_params": params,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True, help="Path to evolution config JSON")
    args = parser.parse_args()

    result = evolve(args.config)
    print(json.dumps(result))
