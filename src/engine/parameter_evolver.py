"""Parameter Evolver — LLM-guided strategy mutation engine.

When a strategy enters DECLINING, this engine:
1. Loads current params + Optuna robust ranges
2. Calls Ollama for 3 mutation candidates
3. Returns structured mutations for re-backtesting

Called by evolution-service.ts via subprocess (same pattern as backtester.py).

Wave 4 Track 4C governance gates (R2/R3/R5/R8):
  R3 — Lookahead-safe prompts: hard guard instruction + post-response violation scan.
  R5 — 63-trading-day minimum: INSUFFICIENT_SAMPLE tag when total_trades < 63.
  R8 — 5-field pre-commit declaration required in each mutation JSON output.
       Missing any field → mutation governance_meta marks precommit_status=incomplete.
  R2 — trial_n_total from config → injected into prompt for DSR/PBO correction context.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from typing import Optional

import requests

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434/api/generate")
# Pass 21 (2026-05-12) retired qwen3-coder:30b (18GB, can't load on RTX 5060 8GB
# VRAM). qwen2.5-coder:7b is the canonical local model across all roles. Env
# override allows operator to flip to a larger model without code edit.
MODEL = os.getenv("PARAMETER_EVOLVER_MODEL", "qwen2.5-coder:7b")

# ─── Wave 4 Track 4C — Research Governance Constants ────────────────────────

# R3: Hard lookahead guard prepended to every mutation prompt.
# The LLM must restrict its reasoning to the data provided in the prompt and
# must not draw on training-time knowledge about specific price dates or outcomes.
_LOOKAHEAD_GUARD = (
    "GOVERNANCE INSTRUCTION — EVALUATE ONLY PROVIDED DATA:\n"
    "You MUST base your mutations ONLY on the strategy data, metrics, and\n"
    "parameters explicitly provided below. Do NOT use any knowledge from your training\n"
    "about price movements, market outcomes, or strategy performance on any specific date.\n"
    "Cite ONLY the data provided in this prompt.\n\n"
)

# R5: Minimum trading-day sample before a mutation result is adequately evidenced.
# Corresponds to ~3 calendar months of active trading days.
# Override via env for test / paper-mode contexts.
MIN_SAMPLE_TRADING_DAYS: int = int(os.getenv("GOVERNANCE_MIN_SAMPLE_DAYS", "63"))

# R3: Patterns whose presence in a mutation reason indicates possible lookahead bias.
# Compiled once at module load; designed for speed (no catastrophic backtracking).
_LOOKAHEAD_PATTERNS: list[re.Pattern] = [
    re.compile(r"\b(?:in\s+20\d{2}|last\s+(?:year|quarter|month)|this\s+(?:year|quarter|month))\b", re.IGNORECASE),
    re.compile(r"\bI\s+know\s+(?:from|that)\b", re.IGNORECASE),
    re.compile(r"\b(?:from\s+my\s+training|based\s+on\s+my\s+(?:training|knowledge))\b", re.IGNORECASE),
    re.compile(r"\b(?:research\s+shows|studies\s+(?:suggest|show)|according\s+to\s+(?!the\s+provided))\b", re.IGNORECASE),
    re.compile(r"\bhistorically\s+speaking\b", re.IGNORECASE),
]

# R8: Mandatory pre-commit governance fields the LLM must include in each mutation.
_PRECOMMIT_FIELDS: tuple[str, ...] = (
    "economic_rationale",
    "declared_param_space_size",
    "min_sample_size",
    "target_regime",
    "declared_failure_mode",
)


def _validate_lookahead_guard(reason: str) -> list[str]:
    """R3: Scan a mutation reason string for lookahead bias patterns.

    Returns a (possibly empty) list of matched strings. An empty list means no
    violations detected. The caller decides whether to block or only warn.
    """
    violations: list[str] = []
    for pattern in _LOOKAHEAD_PATTERNS:
        match = pattern.search(reason)
        if match:
            violations.append(match.group(0))
    return violations


def _summarise_mutation_outcomes(outcomes: list[dict]) -> str:
    """Shared helper: group mutation outcomes by (param_name, direction) and render
    one summary line per group with attempts, success rate, and avg Sharpe delta.

    Used by both the lineage-history section and the cross-archetype section so the
    rendering format stays consistent across both prompt blocks.
    """
    from collections import defaultdict
    summary: dict[str, dict] = defaultdict(lambda: {"attempts": 0, "successes": 0, "total_improvement": 0.0})
    for entry in outcomes:
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
    return "\n".join(lines)


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
    cross_archetype_history: list[dict] | None = None,
    trial_n_total: int = 1,
) -> str:
    """Build the LLM mutation prompt.

    Args:
        mutation_history: Optional list of prior mutation outcomes for this
            strategy/archetype lineage. Each entry is a dict with keys:
            param_name, direction, magnitude, improvement, success, regime.
            When provided, the summary is injected into the prompt so the
            LLM can avoid repeating failed directions and reinforce working ones.
        cross_archetype_history: Optional list of prior mutation outcomes from
            sibling lineages of the same archetype (excluding this lineage).
            Rendered as ADVISORY context only — these are weaker signals because
            they come from different parent strategies.
        trial_n_total: R2 — cumulative number of mutation proposals emitted for
            this strategy across all prior evolution cycles. Injected into the
            prompt when > 1 so the LLM calibrates significance thresholds
            appropriately (with N trials, required improvements must be larger
            to remain statistically meaningful).
    """
    lineage_section = ""
    if mutation_history:
        lineage_section = (
            "\nYour lineage history (this strategy's prior mutations):\n"
            + _summarise_mutation_outcomes(mutation_history)
            + "\nPrefer directions with high success rates. Avoid repeating high-attempt, low-success directions.\n"
        )

    cross_archetype_section = ""
    if cross_archetype_history:
        cross_archetype_section = (
            "\nCross-archetype insights (advisory — from sibling lineages of the same archetype, NOT this strategy):\n"
            + _summarise_mutation_outcomes(cross_archetype_history)
            + "\nThese are weaker signals than your own lineage history. Use them to break ties or "
            + "explore directions you haven't tried, but defer to your lineage history when in conflict.\n"
        )

    # R2: Inject cumulative trial count context when > 1 night of proposals.
    # With multiple trials, the significance bar rises — the LLM should reflect this
    # in its declared min_sample_size and stated confidence.
    n_total_section = ""
    if trial_n_total > 1:
        n_total_section = (
            f"\nCumulative trials for this strategy: {trial_n_total} "
            "(across all prior evolution cycles).\n"
            "With multiple trials the required improvement must be larger to remain\n"
            "statistically meaningful. Adjust min_sample_size accordingly.\n"
        )

    return (
        _LOOKAHEAD_GUARD
        + f'Strategy "{name}" ({symbol} {timeframe}) is declining.\n'
        + f"Current params: {json.dumps(params)}\n"
        + f"Robust ranges from Optuna: {json.dumps(robust_ranges)}\n"
        + f"Last 30-day rolling Sharpe: {current_sharpe:.4f} (was {baseline_sharpe:.4f})\n"
        + f"Walk-forward window performance trend: {window_sharpes}\n"
        + n_total_section
        + lineage_section
        + cross_archetype_section
        + "\nSuggest 3 parameter mutations that:\n"
        + "1. Stay within robust ranges (avoid cliff-edge params)\n"
        + "2. Target the SPECIFIC weakness (if Sharpe dropped -> adjust R:R params; "
        + "if win rate dropped -> tighten entries)\n"
        + "3. Are meaningfully different from each other\n"
        + "\n"
        + "Return a JSON object with a \"mutations\" key containing an array of 3 objects.\n"
        + "Each mutation object MUST include ALL of the following keys:\n"
        + "  - param name keys with new numeric values (within robust ranges)\n"
        + "  - \"reason\": brief explanation citing the provided metrics only\n"
        + "  - \"economic_rationale\": why this change makes economic sense "
        + "(cite provided data only — no external knowledge)\n"
        + "  - \"declared_param_space_size\": integer count of params being changed\n"
        + "  - \"min_sample_size\": minimum trades to verify improvement "
        + f"(integer >= {MIN_SAMPLE_TRADING_DAYS})\n"
        + "  - \"target_regime\": market regime this mutation targets "
        + "(e.g. TRENDING, RANGING, VOLATILE, ALL)\n"
        + "  - \"declared_failure_mode\": condition under which this mutation would fail\n"
        + "\n"
        + 'Example: {"mutations": [{"ind_0_period": 15, '
        + '"reason": "Faster MA to catch trend reversals earlier", '
        + '"economic_rationale": "Sharpe dropped 0.3 in walk-forward window 3 per provided metrics", '
        + '"declared_param_space_size": 1, '
        + f'"min_sample_size": {MIN_SAMPLE_TRADING_DAYS}, '
        + '"target_regime": "TRENDING", '
        + '"declared_failure_mode": "Will underperform in ranging markets due to increased signal noise"}]}\n'
        + "\n"
        + "IMPORTANT: Return ONLY valid JSON. No markdown code blocks."
    )


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
    total_trades: int = 0,
) -> list[dict]:
    """Validate mutations stay within robust ranges and are meaningfully different.

    Wave 4 Track 4C governance gates:
      R3: Scans each mutation's reason for lookahead bias patterns and records any
          violations in governance_meta. Violations emit a stderr warning but do NOT
          discard the mutation — the TS service decides on enforcement.
      R5: Tags governance_meta with INSUFFICIENT_SAMPLE when total_trades < MIN_SAMPLE_TRADING_DAYS.
      R8: Checks for the 5 mandatory pre-commit governance fields. Missing any →
          precommit_status: "incomplete" in governance_meta. The TS service skips
          candidates with precommit_incomplete at the replay gate.

    Returns the same list shape as before but each entry now carries a "governance_meta" key.
    """
    validated = []
    for mut in mutations:
        # Extract the reason and R8 pre-commit fields BEFORE iterating param keys,
        # so they are not treated as strategy params.
        reason = mut.pop("reason", "No reason given")

        # R8: Extract 5 mandatory pre-commit governance fields.
        economic_rationale: Optional[str] = mut.pop("economic_rationale", None)
        declared_param_space_size: Optional[int] = mut.pop("declared_param_space_size", None)
        min_sample_size: Optional[int] = mut.pop("min_sample_size", None)
        target_regime: Optional[str] = mut.pop("target_regime", None)
        declared_failure_mode: Optional[str] = mut.pop("declared_failure_mode", None)

        clamped: dict = {}

        for param_name, value in mut.items():
            if param_name in robust_ranges:
                low, high = robust_ranges[param_name]
                clamped_val = max(low, min(high, value))
                clamped[param_name] = clamped_val
                if clamped_val != value:
                    print(
                        f"  Clamped {param_name}: {value} -> {clamped_val} (range [{low}, {high}])",
                        file=sys.stderr,
                    )
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

        if not (has_diff and clamped):
            continue

        # R3: Lookahead violation scan on the mutation reason.
        lookahead_violations = _validate_lookahead_guard(reason)
        if lookahead_violations:
            print(
                f"  R3 WARN: lookahead pattern in mutation reason — matches: {lookahead_violations}",
                file=sys.stderr,
            )

        # R8: Build pre-commit status. All 5 fields must be non-null/non-empty.
        missing_fields: list[str] = []
        if not economic_rationale:
            missing_fields.append("economic_rationale")
        if declared_param_space_size is None:
            missing_fields.append("declared_param_space_size")
        if min_sample_size is None:
            missing_fields.append("min_sample_size")
        if not target_regime:
            missing_fields.append("target_regime")
        if not declared_failure_mode:
            missing_fields.append("declared_failure_mode")

        # R5: Sample adequacy tag — emitted even when mutation is otherwise valid.
        sample_tag: Optional[str] = (
            "INSUFFICIENT_SAMPLE" if total_trades < MIN_SAMPLE_TRADING_DAYS else None
        )

        governance_meta: dict = {
            "precommit_status": "incomplete" if missing_fields else "complete",
            "missing_fields": missing_fields,
            "lookahead_violation": bool(lookahead_violations),
            "lookahead_violation_reasons": lookahead_violations,
            "economic_rationale": economic_rationale,
            "declared_param_space_size": declared_param_space_size,
            "min_sample_size": min_sample_size,
            "target_regime": target_regime,
            "declared_failure_mode": declared_failure_mode,
        }
        if sample_tag:
            governance_meta["sample_tag"] = sample_tag

        validated.append({
            "params": clamped,
            "reason": reason,
            "governance_meta": governance_meta,
        })

    return validated


def evolve(config_path: str) -> dict:
    """Main evolution entry point. Reads config JSON, calls LLM, returns mutations.

    The config JSON may optionally contain a "mutation_history" key carrying a
    list of prior mutation outcome records (see mutationOutcomes schema).  When
    present, a summarised version is injected into the LLM prompt so the model
    can learn from what has and has not worked before.

    Wave 4 Track 4C additions:
      - "trial_n_total" (int, default 1): cumulative proposals emitted for this
        strategy across all prior evolution cycles; injected into prompt for R2.
      - "total_trades" (int, default 0): trade count from the triggering backtest;
        used by R5 to tag INSUFFICIENT_SAMPLE when < MIN_SAMPLE_TRADING_DAYS.
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
    cross_archetype_history: list[dict] | None = config.get("cross_archetype_history") or None

    # R2: cumulative trial count injected into prompt for DSR/PBO context.
    trial_n_total: int = int(config.get("trial_n_total", 1))
    # R5: total trades from the triggering backtest for sample adequacy tagging.
    total_trades: int = int(config.get("total_trades", 0))

    print(f"Evolving: {name} ({symbol} {timeframe})", file=sys.stderr)
    print(f"  Current Sharpe: {current_sharpe:.4f}, Baseline: {baseline_sharpe:.4f}", file=sys.stderr)
    print(f"  trial_n_total={trial_n_total}, total_trades={total_trades}", file=sys.stderr)
    if mutation_history:
        print(f"  Mutation history: {len(mutation_history)} prior outcomes provided", file=sys.stderr)
    if cross_archetype_history:
        print(f"  Cross-archetype history: {len(cross_archetype_history)} prior outcomes from sibling lineages", file=sys.stderr)

    prompt = build_mutation_prompt(
        name, symbol, timeframe, params, robust_ranges,
        current_sharpe, baseline_sharpe, window_sharpes,
        mutation_history=mutation_history,
        cross_archetype_history=cross_archetype_history,
        trial_n_total=trial_n_total,
    )

    raw_mutations = call_ollama(prompt)
    if not raw_mutations:
        return {"mutations": [], "error": "LLM returned no valid mutations"}

    validated = validate_mutations(raw_mutations, robust_ranges, params, total_trades=total_trades)
    print(f"  Generated {len(raw_mutations)} mutations, {len(validated)} validated", file=sys.stderr)

    # Build governance summary for the caller.
    governance_complete = sum(
        1 for m in validated
        if (m.get("governance_meta") or {}).get("precommit_status") == "complete"
    )
    lookahead_flagged = sum(
        1 for m in validated
        if (m.get("governance_meta") or {}).get("lookahead_violation")
    )

    return {
        "mutations": validated,
        "model": MODEL,
        "parent_params": params,
        "governance_summary": {
            "trial_n_total": trial_n_total,
            "total_trades": total_trades,
            "precommit_complete": governance_complete,
            "precommit_incomplete": len(validated) - governance_complete,
            "lookahead_flagged": lookahead_flagged,
        },
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True, help="Path to evolution config JSON")
    args = parser.parse_args()

    result = evolve(args.config)
    print(json.dumps(result))
