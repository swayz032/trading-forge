"""SELECTION-SIDE DEFLATION CHECK (gate-recalibration checkpoints pre-registration
`docs/designs/gate-recalibration-checkpoints-preregistration-2026-07-19.md`,
sha256 654780c8…, FROZEN under R-072).

THE ONE THING (§2 THE WIRING GAP): the per-spec luck-correction gates
(DSR/PBO/BIF) deflate for PATH multiplicity only — they carry ZERO campaign
SELECTION PRESSURE. Selection pressure is how many DIFFERENT strategies the
factory has tried when it promotes its best; its honest denominator is the trial
counter's LIFETIME effective-N. This module is the SELECTION-SIDE check that joins
survivor candidacy: computed AT candidacy, consuming the CURRENT lifetime
effective-N (§3a epoch boundary — never a stale registration snapshot), and
LATCHING the recalibration obligation at the checkpoints (200 / 500).

WHAT THIS IS AND IS NOT:
  * IS: the MECHANISM (trigger read + checkpoint compare + persistent latch +
    the §3 audit record). It will be correct AT candidacy.
  * IS NOT: the threshold arithmetic. The E[max-SR] functional forms and the
    DSR/PBO/BIF re-derivations are DERIVED AT the checkpoint from then-current
    artifacts, arithmetic shown in the receipt (§6 honest negative space). Pinning
    them now against unknowable corpus shape is exactly the disease the pre-reg
    forbids. This module deliberately computes NO threshold.

INERT TODAY BY CONSTRUCTION: lifetime effective-N is 32 (raw 48) and the
survivor-eligible set is EMPTY, so 32 < 200 and there is no candidate. The check
does not fire and does not latch today. It engages only when a future candidacy
run observes effective-N >= a checkpoint.

LATCH SEMANTICS (F3): the FIRST observation of `effective_n >= checkpoint` creates
a PERSISTENT obligation recorded in the check log; a later effective-N DECREASE
(e.g. a backfill annotation collapsing groups) does NOT un-cross it. `raw_n`
(append-only, monotone) is co-recorded as the tamper-evident companion; an
effective-N that moves DOWN between checks without a named annotation event is an
alarm the receipt must explain, never this module's job to hide.

DETERMINISM/IO: this is a checkpoint-audit writer — wall clock only for the
`observed_at` audit stamp (never a statistic input), atomic write-temp-rename with
`newline="\n"`, same exemption as the trial counter / passage ledger. When
`log_path` is None it is PURE COMPUTATION (no disk write) — the unit red-proofs
run in that mode against synthetic and real counters.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple

# The pre-registered checkpoints (§ header / §3). Frozen ascending.
DEFAULT_CHECKPOINTS: Tuple[int, ...] = (200, 500)

# Canonical counter file the trigger quantity is read from (pre-reg §3, pinned).
CANONICAL_COUNTER_PATH = os.path.join("docs", "replay-results", "h1-battery", "trial-counter.json")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sha256_file(path: Optional[str]) -> Optional[str]:
    """Hash a file's bytes, or None if no path given / file absent. A missing
    canonical file is surfaced as None (the receipt records what it could read),
    never fabricated."""
    if not path or not os.path.exists(path):
        return None
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _atomic_append_check(log_path: str, record: dict) -> List[int]:
    """Append one check record to the log (create on first write), atomic
    write-temp-rename with newline='\\n'. Returns the FULL persistent latched set
    after this append. The log is append-only: latch state is the UNION of every
    record's `crossed`, so once a checkpoint is latched it stays latched even if a
    later effective-N drops below it (F3)."""
    os.makedirs(os.path.dirname(log_path) or ".", exist_ok=True)
    if os.path.exists(log_path):
        with open(log_path, encoding="utf-8") as fh:
            doc = json.load(fh)
    else:
        doc = {"artifact": "selection-deflation-check-log", "checks": []}
    doc["checks"].append(record)
    # Persistent latch = union of every check's crossed set, monotone by construction.
    latched = sorted({cp for c in doc["checks"] for cp in c.get("crossed", [])})
    doc["latched"] = latched
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(log_path) or ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(doc, fh, indent=2)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, log_path)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    return latched


def _prior_latched(log_path: Optional[str]) -> List[int]:
    """The persistent latched set BEFORE this check — the union of prior records'
    crossed sets. Empty when no log exists yet."""
    if not log_path or not os.path.exists(log_path):
        return []
    with open(log_path, encoding="utf-8") as fh:
        doc = json.load(fh)
    return sorted({cp for c in doc.get("checks", []) for cp in c.get("crossed", [])})


def run_selection_deflation_check(
    counter: Any,
    *,
    checkpoints: Sequence[int] = DEFAULT_CHECKPOINTS,
    counter_file_path: Optional[str] = None,
    code_identity: Optional[str] = None,
    log_path: Optional[str] = None,
) -> Dict[str, Any]:
    """Run the selection-side deflation check AT candidacy.

    Reads the trigger quantity EXACTLY as the pre-reg §3 pins it:
    `counter.effective_n(wave=None)["effective_n"]` — lifetime, incomplete-tuple
    rows counting as their own groups (that behavior lives in TrialCounter and is
    consumed here, never re-implemented). Compares to each checkpoint; a checkpoint
    is CROSSED when effective_n >= checkpoint. ENGAGED = any crossed.

    LATCH (F3): with a `log_path`, the crossed set is persisted; `newly_latched`
    are checkpoints crossed for the first time; the returned `latched` is the full
    persistent set (union across all checks) — monotone, never un-crossed by a
    later effective-N decrease. With `log_path=None` this is pure computation and
    `latched` reflects only this check's crossed set (nothing persisted).

    Records per §3: effective_n, raw_n, counter_file_hash, code_identity (file hash
    of trial_counter.py — the effective-N code identity). Every number COMPUTED or
    ABSENT (None) — never fabricated.

    Does NOT compute any threshold (E[max-SR]/DSR/PBO/BIF) — those are derived AT
    the checkpoint from then-current artifacts (§6). This is the mechanism only.

    Fail-closed: an invalid counter (no effective_n contract) raises — the check
    never silently passes a candidate it could not measure.
    """
    checkpoints = sorted(int(c) for c in checkpoints)
    if not checkpoints:
        raise ValueError("checkpoints must be a non-empty ascending sequence")

    # Trigger quantity — pinned call. Fail closed if the counter cannot answer.
    if not hasattr(counter, "effective_n"):
        raise TypeError("counter has no effective_n(wave=...) — cannot measure selection pressure; fail closed")
    en = counter.effective_n(wave=None)
    effective_n = int(en["effective_n"])
    raw_n = int(en["raw_n"])

    counter_file_hash = _sha256_file(counter_file_path)

    crossed = [cp for cp in checkpoints if effective_n >= cp]
    engaged = bool(crossed)

    # Boundary beside the verdict: the next un-crossed checkpoint and the distance.
    uncrossed = [cp for cp in checkpoints if effective_n < cp]
    next_checkpoint = uncrossed[0] if uncrossed else None
    distance_to_next = (next_checkpoint - effective_n) if next_checkpoint is not None else None

    prior = _prior_latched(log_path)
    newly_latched = [cp for cp in crossed if cp not in prior]

    record = {
        "observed_at": _now_iso(),          # audit metadata only, never a statistic input
        "effective_n": effective_n,
        "raw_n": raw_n,                     # monotone tamper-evident companion (F3)
        "checkpoints": checkpoints,
        "crossed": crossed,
        "newly_latched": newly_latched,
        "engaged": engaged,
        "counter_file_hash": counter_file_hash,
        "code_identity": code_identity,     # file hash of trial_counter.py (effective-N code identity)
        "next_checkpoint": next_checkpoint,
        "distance_to_next_checkpoint": distance_to_next,
    }

    if log_path is not None:
        latched = _atomic_append_check(log_path, record)
    else:
        # Pure computation: latch reflects only this check (nothing persisted).
        latched = sorted(set(prior) | set(crossed))

    verdict = "ENGAGED" if engaged else "INERT"
    out = dict(record)
    out["latched"] = latched
    out["verdict"] = verdict
    return out


def _print_boundary(v: Dict[str, Any]) -> None:
    """Print the boundary beside the verdict (the pre-live human-readable line)."""
    nxt = v["next_checkpoint"]
    dist = v["distance_to_next_checkpoint"]
    boundary = (
        f"next checkpoint {nxt} (distance {dist})"
        if nxt is not None else "all checkpoints crossed"
    )
    print(
        f"SELECTION-DEFLATION {v['verdict']}: effective_n={v['effective_n']} "
        f"raw_n={v['raw_n']} checkpoints={v['checkpoints']} crossed={v['crossed']} "
        f"newly_latched={v['newly_latched']} latched={v['latched']} | boundary: {boundary}"
    )


def _main(argv: Sequence[str]) -> int:
    """CLI: run against the canonical counter and print the verdict.
    Exit 0 when INERT (no checkpoint crossed). Exit 2 — a GUARD REFUSAL — when
    ENGAGED: an un-receipted crossed checkpoint must halt candidacy until the
    checkpoint recalibration receipt is produced (fail-closed). Exit 2 also on any
    refusal to measure (missing counter / broken contract)."""
    try:
        # Imported lazily so the module has no import-time dependency direction issue.
        from src.engine.battery.trial_counter import TrialCounter  # noqa: PLC0415
    except Exception:  # pragma: no cover - import-path fallback
        sys.path.insert(0, os.path.join(os.getcwd(), "src"))
        from engine.battery.trial_counter import TrialCounter  # type: ignore  # noqa: PLC0415

    counter_path = argv[1] if len(argv) > 1 else CANONICAL_COUNTER_PATH
    if not os.path.exists(counter_path):
        print(f"REFUSED: canonical counter not found at {counter_path} — cannot measure; fail closed", file=sys.stderr)
        return 2
    code_id = _sha256_file(os.path.join("src", "engine", "battery", "trial_counter.py"))
    counter = TrialCounter(path=counter_path)
    try:
        v = run_selection_deflation_check(
            counter,
            counter_file_path=counter_path,
            code_identity=code_id,
            log_path=None,  # CLI is read-only by default; latching is a candidacy-path write
        )
    except Exception as e:  # fail closed on any measurement failure
        print(f"REFUSED: {e!r}", file=sys.stderr)
        return 2
    _print_boundary(v)
    return 2 if v["engaged"] else 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(_main(sys.argv))
