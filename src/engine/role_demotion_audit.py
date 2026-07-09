"""role_demotion_audit.py — Hard-Constraint Demotion Experiment (docs/designs/
hard-constraint-demotion-experiment-2026-07-05.md) classification-table loader.

Loads the PRE-REGISTERED, already-audited `(video, condition_id) -> classification`
mapping from docs/replay-results/dri-audit-2026-07-05.json's
`full_classification_table_first_pass` (single-label, mutually exclusive by
construction per that audit's own tie-break rule — GATE > ALTERNATIVE > OPTIONAL
> CONTEXTUAL, override to CONTEXTUAL on any transcript negation). This module
does NOT re-judge anything — it is a pure read+index of an already-frozen,
committed artifact. Do NOT re-derive classifications elsewhere; this is the
single source of truth the demotion experiment's spec mandates ("Source = the
committed docs/replay-results/dri-audit-2026-07-05.json ... do NOT re-judge").

Deliberately kept SEPARATE from spec_family_bindings.py (which has a documented
ZERO-I/O purity contract for its TS-mirror parity guarantee — see that module's
docstring). This loader is the one new I/O boundary the demotion experiment
introduces; it is consumed by spec_condition_compiler.py (which already does
file/DB-adjacent work building strategies from compiled specs) and directly by
the experiment's measurement scripts (scripts/role-demotion-*.py).

FAIL-OPEN CONTRACT: a missing/unreadable/malformed audit file, or a lookup miss,
returns None — which every caller treats identically to "no classification found"
(i.e. unchanged/baseline spine behavior). This mirrors the "ship gates STRICT,
default OFF, fail safe" discipline used by every other experiment flag in this
codebase — a broken audit-path can only ever silently no-op the experiment, never
silently mutate production behavior.
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

DEFAULT_AUDIT_PATH: str = "docs/replay-results/dri-audit-2026-07-05.json"

# JUSTIFIED_MANDATORY is a real gate — never demoted. UNRESOLVED is explicitly
# HELD OUT of the primary experiment per the audit's own classification table
# (docs/designs/extraction-overspecification-audit-2026-07-05.md: "UNRESOLVED —
# no clear transcript evidence either way ... flagged separately") and the
# demotion spec's Section 1 ("UNRESOLVED -> HELD OUT of primary; separate
# sensitivity arm"). Only these three classes are ever eligible for demotion
# under any TF_ROLE_DEMOTION_MODE arm built in this codebase.
DEMOTABLE_CLASSES: frozenset[str] = frozenset({"OPTIONAL", "ALTERNATIVE", "CONTEXTUAL"})


def _resolve_audit_path() -> Path:
    """`TF_ROLE_DEMOTION_AUDIT_PATH` overrides the default (relative-to-repo-root
    or absolute) — used by the test suite to point at small synthetic fixtures
    without touching the committed 221-row audit artifact; production/experiment
    callers rely on the default."""
    raw = os.environ.get("TF_ROLE_DEMOTION_AUDIT_PATH", DEFAULT_AUDIT_PATH)
    p = Path(raw)
    if p.is_absolute():
        return p
    repo_root = Path(__file__).resolve().parents[2]  # src/engine/ -> repo root
    return repo_root / raw


@lru_cache(maxsize=8)
def _load_classification_table(path_str: str) -> dict[tuple[str, str], str]:
    """Cached by resolved path string (not by env var) so a test that points
    TF_ROLE_DEMOTION_AUDIT_PATH at a fresh tmp_path fixture per test gets its
    OWN cache entry rather than reusing a stale one from a prior test/path."""
    path = Path(path_str)
    with path.open("r", encoding="utf-8") as f:
        audit = json.load(f)
    table = audit.get("full_classification_table_first_pass", []) or []
    out: dict[tuple[str, str], str] = {}
    for row in table:
        video = str(row.get("video", "") or "")
        cid = str(row.get("condition_id", "") or "")
        cls = str(row.get("classification", "") or "")
        if video and cid and cls:
            out[(video, cid)] = cls
    return out


def get_classification(video: str, condition_id: str) -> str | None:
    """Returns the audit's classification for (video, condition_id), or None
    when: the video/condition_id was never audited (e.g. outside the 14-video/
    221-condition sample), the audit file is missing/unreadable/malformed, or
    either argument is falsy. Never raises."""
    if not video or not condition_id:
        return None
    try:
        table = _load_classification_table(str(_resolve_audit_path()))
    except (OSError, json.JSONDecodeError, ValueError):
        return None
    return table.get((str(video), str(condition_id)))


def get_classifications_for_video(video: str, condition_ids: list[str]) -> dict[str, str]:
    """Batch form of get_classification() — resolves a full
    `{condition_id: classification}` map for every id in `condition_ids` that
    has an audited classification (misses are simply absent from the returned
    dict, never a KeyError downstream). This is the shape
    spec_family_bindings.compile_binding_plan()'s `demotion_classifications`
    parameter expects."""
    if not video:
        return {}
    try:
        table = _load_classification_table(str(_resolve_audit_path()))
    except (OSError, json.JSONDecodeError, ValueError):
        return {}
    out: dict[str, str] = {}
    for cid in condition_ids:
        cls = table.get((str(video), str(cid)))
        if cls is not None:
            out[str(cid)] = cls
    return out


def is_demotable(classification: str | None) -> bool:
    """True iff `classification` is one of the three classes ANY
    TF_ROLE_DEMOTION_MODE arm is permitted to act on (OPTIONAL / ALTERNATIVE /
    CONTEXTUAL). False for JUSTIFIED_MANDATORY, UNRESOLVED, None, or any
    unrecognized string — the fail-closed default that keeps a real gate real."""
    return classification in DEMOTABLE_CLASSES
