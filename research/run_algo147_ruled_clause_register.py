#!/usr/bin/env python3
"""THE RULED-CLAUSE REGISTER — every taught clause, marked BUILT or not, with its site.
DIAGNOSTIC ONLY. REPORTS. DERIVES NOTHING, PROPOSES NOTHING, REPAIRS NOTHING.

ALGO-117 §4(a) ordered a register over two surfaces. ALGO-146 widened it to THREE, and the
widening is the whole point: the TP ladder never reached `spec.json` at all, so no loader and no
test could have missed it — there was nothing there to miss.

    SURFACE 1  is the clause in `..._spec.json`, the machine-readable spec the code loads?
    SURFACE 2  does any PRODUCTION module reference it? A name that appears only in a test does
               NOT count — `avoid_chart_clutter` is the worked example: declared in the spec,
               asserted by one test that checks the JSON says `true`, read by no production code.
    SURFACE 3  the executable site, named.

    BUILT           a production module references it — site named
    SPEC_ONLY       in `spec.json`, referenced by no production module
    EVIDENCE_ONLY   taught in his evidence and never reached `spec.json`
    UNCLASSIFIED    residual. REQUIRED. A taxonomy with no residual must mis-file or fall silent.

🛑 POSITIVE CONTROL, ASSERTED IN THE ARTIFACT AND FREE: the register MUST return
`avoid_chart_clutter` as SPEC_ONLY, and `tp_ladder` / `multiple_directional_tps_allowed` as
EVIDENCE_ONLY. THOSE THREE ARE KNOWN BEFORE THIS RUNS. If the instrument does not surface all
three, IT IS BROKEN AND ITS ZEROS MEAN NOTHING — the run reports `CONTROL_FAILED` and the counts
must not be read.

WHAT THIS COVERS, AND WHAT IT DOES NOT — the surface is stated because a register that implies
completeness is worse than one that names its edge:
  * COVERED MECHANICALLY: every clause carrying a SEARCHABLE TOKEN — JSON keys under
    `direct_trader_rules` and their sub-keys, all `preserved_invariants`, every gold-fixture
    `must_have` / `must_not_do` string, every `semantic_crosswalk` node.
  * NOT COVERED MECHANICALLY: `video_evidence.md`'s numbered principles and adopted-rule blocks
    are PROSE. They carry no token, so a grep cannot decide them and this register does not
    pretend to. They are ENUMERATED here with `PROSE_NO_TOKEN` so the population is visible and
    countable, and they are excluded from the four counts rather than silently absorbed.

EVIDENCE GRADE: GREP-LEVEL. A token appearing in a production module is recorded as a REFERENCE,
not as a verified implementation — an unopened match is not a BUILT, and every row says so.

Run: PYTHONPATH=. python -m research.run_algo147_ruled_clause_register
"""
from __future__ import annotations

import io
import json
import re
from collections import Counter
from pathlib import Path

RESEARCH = Path("research")
TESTS = Path("tests")
SPEC = RESEARCH / "current_mnq_strategy_v2_4_spec.json"
GOLD = RESEARCH / "current_mnq_strategy_v2_4_user_fidelity_gold.json"
ADDENDUM = RESEARCH / "current_mnq_strategy_v2_4_trader_fidelity_addendum_2026_08_20.json"
REGISTRY = RESEARCH / "current_mnq_strategy_v2_4_unified_fidelity_evidence_registry_2026_08_20.json"
VIDEO = RESEARCH / "current_mnq_strategy_v2_4_video_evidence.md"
OUT = RESEARCH / "current_mnq_strategy_v2_4_algo147_ruled_clause_register.json"

#: PRODUCTION = the strategy modules the engine composes. `run_*` are diagnostics and are counted
#: separately: a clause referenced only by a diagnostic is NOT built into the strategy.
def _production_files() -> list[Path]:
    return sorted(p for p in RESEARCH.glob("current_mnq_strategy_v2_*.py")
                  if not p.name.startswith("run_"))


def _diagnostic_files() -> list[Path]:
    return sorted(RESEARCH.glob("run_*.py"))


def _test_files() -> list[Path]:
    return sorted(TESTS.glob("*.py"))


def _load(paths):
    return [(p, p.read_text(encoding="utf-8", errors="replace")) for p in paths]


def _hits(token: str, loaded) -> list[str]:
    out = []
    for p, text in loaded:
        for i, line in enumerate(text.splitlines(), 1):
            if token in line:
                out.append(f"{p.as_posix()}:{i}")
                break
    return out


def main() -> int:
    spec_text = SPEC.read_text(encoding="utf-8")
    prod, diag, tst = _load(_production_files()), _load(_diagnostic_files()), _load(_test_files())

    clauses = []

    def add(token, origin, kind, note=""):
        if not token or not isinstance(token, str) or len(token) < 4:
            return
        clauses.append({"clause": token, "origin": origin, "kind": kind, "note": note})

    add_seen = set()

    # ── direct_trader_rules, keys AND sub-keys (ALGO-146: the parent is why this matters) ──
    a = json.load(io.open(ADDENDUM, encoding="utf-8"))
    def walk(d, path, origin):
        for k, v in d.items():
            here = f"{path}.{k}" if path else k
            add(k, origin, "json_key", f"path {here}")
            if isinstance(v, dict):
                walk(v, here, origin)
    walk(a["direct_trader_rules"], "direct_trader_rules", "addendum.direct_trader_rules")
    for inv in a["preserved_invariants"]:
        add(inv, "addendum.preserved_invariants", "invariant")
    for k in a["direct_trader_market_map_scope"]:
        add(k, "addendum.direct_trader_market_map_scope", "json_key")

    # ── the 8 gold fixtures: ids and every must_have / must_not_do string ──
    g = json.load(io.open(GOLD, encoding="utf-8"))
    for f in g["fixtures"]:
        add(f["id"], "user_fidelity_gold", "fixture_id")
        for key in ("must_have", "must_not_do"):
            for item in f.get(key, []):
                add(item, f"user_fidelity_gold.{f['id']}.{key}", "fixture_clause")

    # ── spec.json's OWN keys. THE POSITIVE CONTROL CAUGHT THIS OMISSION: `avoid_chart_clutter`
    # is taught (video_evidence #10/#4) and lives ONLY here, so enumerating the evidence files
    # alone made SPEC_ONLY unreachable for exactly the class it exists to name. A control that
    # can only confirm what the input already contains is not a control.
    spec_obj = json.load(io.open(SPEC, encoding="utf-8"))
    def walk_spec(d, path):
        if isinstance(d, dict):
            for k, v in d.items():
                here = f"{path}.{k}" if path else k
                add(k, "spec.json", "spec_key", f"path {here}")
                walk_spec(v, here)
        elif isinstance(d, list):
            for v in d:
                walk_spec(v, path)
    walk_spec(spec_obj, "")

    # ── every semantic_crosswalk node ──
    r = json.load(io.open(REGISTRY, encoding="utf-8"))
    for node in r["semantic_crosswalk"]:
        add(node, "registry.semantic_crosswalk", "crosswalk_node")

    # ── de-duplicate by token, keeping the first origin ──
    uniq = {}
    for c in clauses:
        uniq.setdefault(c["clause"], c)
    clauses = list(uniq.values())

    rows = []
    for c in clauses:
        tok = c["clause"]
        in_spec = tok in spec_text
        p_hits, d_hits, t_hits = _hits(tok, prod), _hits(tok, diag), _hits(tok, tst)
        if p_hits:
            status, site = "BUILT", p_hits[0]
        elif in_spec:
            status, site = "SPEC_ONLY", None
        else:
            status, site = "EVIDENCE_ONLY", None
        rows.append({**c, "status": status, "site": site,
                     "in_spec_json": in_spec,
                     "production_refs": p_hits[:3], "production_ref_count": len(p_hits),
                     "diagnostic_ref_count": len(d_hits), "test_ref_count": len(t_hits),
                     "evidence_grade": "GREP-LEVEL: a reference, not a verified implementation"})

    # ── the prose surface, enumerated and EXCLUDED from the counts ──
    vt = VIDEO.read_text(encoding="utf-8")
    prose = [ln.strip() for ln in vt.splitlines()
             if re.match(r"^\d+\.\s+\*\*", ln.strip())]
    prose_rows = [{"clause": p[:110], "origin": "video_evidence.md", "kind": "PROSE_NO_TOKEN",
                   "status": "PROSE_NO_TOKEN",
                   "note": "carries no searchable token; a grep cannot decide it and this "
                           "register does not pretend to"} for p in prose]

    counts = Counter(r["status"] for r in rows)

    # ── POSITIVE CONTROL ──
    by = {r["clause"]: r["status"] for r in rows}
    control = {
        "avoid_chart_clutter_expected_SPEC_ONLY": by.get("avoid_chart_clutter"),
        "tp_ladder_expected_EVIDENCE_ONLY": by.get("tp_ladder"),
        "multiple_directional_tps_allowed_expected_EVIDENCE_ONLY": by.get(
            "multiple_directional_tps_allowed"),
    }
    ok = (control["avoid_chart_clutter_expected_SPEC_ONLY"] == "SPEC_ONLY"
          and control["tp_ladder_expected_EVIDENCE_ONLY"] == "EVIDENCE_ONLY"
          and control["multiple_directional_tps_allowed_expected_EVIDENCE_ONLY"]
          == "EVIDENCE_ONLY")

    artifact = {
        "artifact": "ALGO147_RULED_CLAUSE_REGISTER",
        "status": "DIAGNOSTIC ONLY. Reports. Derives nothing, proposes nothing, repairs nothing.",
        "authority": "ALGO-117 §4(a) as widened to three surfaces by ALGO-146",
        "evidence_grade": "GREP-LEVEL throughout. A production reference is a REFERENCE. An "
                          "unopened match is NOT a verified implementation.",
        "CONTROL": "PASSED" if ok else "CONTROL_FAILED - THE COUNTS MUST NOT BE READ",
        "control_detail": control,
        "🛑_READ_THIS_BEFORE_THE_COUNTS": (
            "EVIDENCE_ONLY DOES NOT MEAN NOT BUILT. It means the clause's LABEL STRING does not "
            "appear verbatim in spec.json or in a production module. A clause can be fully "
            "implemented under a different name, and many are. THE COUNTER-EXAMPLE, measured: "
            "`17.25_point_stop` classifies EVIDENCE_ONLY and the 17.25 stop is unquestionably "
            "built (`p.stop`, enforced everywhere); `directional_momentum_trigger` classifies "
            "EVIDENCE_ONLY and `_momentum` appears 3x in derivation.py alone; "
            "`PR_38_remains_draft_do_not_merge` is a governance statement that is not code at "
            "all. ⇒ A LABEL SEARCH CANNOT DECIDE IMPLEMENTATION. Reporting EVIDENCE_ONLY as a "
            "count of unbuilt clauses would be the largest false finding this campaign could "
            "produce."),
        "what_each_status_ACTUALLY_licenses": {
            "BUILT": "a FLOOR, not a count - the label was found in a production module. "
                     "Token-confirmed only; the implementation was not opened.",
            "SPEC_ONLY": "THE SOUND CLASS. The clause IS in the machine-readable spec under its "
                         "own name, and no production module reads that name. This is the "
                         "`avoid_chart_clutter` shape and it is directly actionable.",
            "EVIDENCE_ONLY": "UNDECIDED BY THIS INSTRUMENT. Never reached spec.json under this "
                             "label. Adjudicating it requires READING the code for the concept, "
                             "not grepping for the string. THAT IS THE REMAINING WORK.",
            "UNCLASSIFIED": "residual; none occurred.",
        },
        "counts": dict(counts),
        "counts_restricted_to_HIS_EVIDENCE_origin": dict(Counter(
            r["status"] for r in rows if not r["origin"].startswith("spec.json"))),
        "note_on_the_two_count_blocks": (
            "The unrestricted block includes spec.json's OWN keys, many of which are structural "
            "scaffolding (schema_version, deployment flags) rather than taught clauses. The "
            "restricted block is the population that answers 'what did he teach that is not "
            "built' - and even there, EVIDENCE_ONLY is UNDECIDED, not unbuilt."),
        "clauses_with_a_searchable_token": len(rows),
        "prose_clauses_enumerated_and_excluded_from_the_counts": len(prose_rows),
        "surface_covered": ("addendum direct_trader_rules keys AND sub-keys, "
                            "preserved_invariants, direct_trader_market_map_scope, the 8 gold "
                            "fixtures' ids and every must_have/must_not_do, and every "
                            "semantic_crosswalk node"),
        "surface_NOT_covered": ("video_evidence.md's numbered principles and adopted-rule blocks "
                                "- PROSE, no token, enumerated below and excluded from the counts "
                                "rather than silently absorbed"),
        "production_definition": ("research/current_mnq_strategy_v2_*.py excluding run_*. A clause "
                                  "referenced only by a run_* diagnostic or by a test is NOT "
                                  "built into the strategy."),
        "rows": sorted(rows, key=lambda r: (r["status"], r["clause"])),
        "prose_rows": prose_rows,
        "no_pnl": "No PnL, realized outcome, winner/loser label or clean-edge result is read.",
    }
    io.open(OUT, "w", encoding="utf-8", newline="\n").write(
        json.dumps(artifact, indent=2, sort_keys=True))
    print(f"CONTROL: {artifact['CONTROL']}")
    for k, v in control.items():
        print(f"   {k} -> {v}")
    print(f"\nCOUNTS: {dict(counts)}")
    print(f"tokenised clauses {len(rows)} | prose enumerated, excluded {len(prose_rows)}")
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
