"""
Strategy embedder using Ollama nomic-embed-text.
Converts strategy DSL + failure context into a vector for similarity search.
"""
import json
from urllib.request import urlopen, Request

OLLAMA_URL = "http://localhost:11434"
EMBED_MODEL = "nomic-embed-text"


def embed_strategy(strategy_dsl: dict, failure_context: str = "") -> list[float]:
    """
    Create embedding vector from strategy DSL + failure context.
    Combines strategy description, entry/exit types, params, and failure reason
    into a text representation, then embeds via Ollama.

    Returns: 768-dimensional vector (nomic-embed-text output dim)
    """
    parts: list[str] = []

    name = strategy_dsl.get("name", "unnamed")
    parts.append(name)

    description = strategy_dsl.get("description", "")
    if description:
        parts.append(description)

    entry = strategy_dsl.get("entry", {})
    entry_type = entry.get("type", "")
    entry_indicator = entry.get("indicator", "")
    if entry_type:
        parts.append(f"Entry: {entry_type} with {entry_indicator}")

    exit_cfg = strategy_dsl.get("exit", {})
    exit_type = exit_cfg.get("type", "")
    if exit_type:
        parts.append(f"Exit: {exit_type}")

    symbol = strategy_dsl.get("symbol", "")
    if symbol:
        parts.append(f"Symbol: {symbol}")

    timeframe = strategy_dsl.get("timeframe", "")
    if timeframe:
        parts.append(f"Timeframe: {timeframe}")

    # Include parameter names/values for fingerprinting
    params = strategy_dsl.get("params", {})
    if params:
        param_str = ", ".join(f"{k}={v}" for k, v in params.items())
        parts.append(f"Params: {param_str}")

    if failure_context:
        parts.append(f"Failure: {failure_context}")

    text = ". ".join(parts)
    return embed_text(text)


def embed_text(text: str) -> list[float]:
    """Raw text embedding via Ollama API."""
    payload = json.dumps({"model": EMBED_MODEL, "prompt": text}).encode()
    req = Request(
        f"{OLLAMA_URL}/api/embeddings",
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    resp = urlopen(req, timeout=30)
    result = json.loads(resp.read())
    return result["embedding"]
