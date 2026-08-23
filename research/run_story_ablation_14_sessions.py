#!/usr/bin/env python3
"""Size every v2.4 rejection-story loosening against the frozen 14 sessions. DIAGNOSTIC ONLY.

For each Route A candidate the kernel GRANTS, ask of each requirement v2.4 dropped from v2.2:
would restoring this ONE requirement have killed the grant?

IT DOES NOT RE-WALK THE KERNEL LOOP. The first version of this runner did, and its positive
control immediately caught it granting 10 candidates the X-ray did not -- which turned out to
be the X-RAY'S OWN ranking bug, not the mirror's. The lesson stuck: this runner now hooks
`xray_session(..., on_rejection_candidate=...)` and evaluates only what the X-ray, after the
kernel's own `_rank_and_yield`, actually records as a grant. There is exactly one loop.

POSITIVE CONTROL, retained in a stronger form: every Route A `SURVIVED_TO_RANKING` record must
have been captured by the hook and must yield a non-None verdict. A grant with no verdict, or
a verdict for a record that is not a grant, raises.

Run: PYTHONPATH=. python -m research.run_story_ablation_14_sessions
"""
from __future__ import annotations

import io
import json
import time
from datetime import date
from pathlib import Path

from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_4_engine as v24
from research.current_mnq_strategy_v2_4_candidate_xray import ROUTE_A_REJECTION, xray_session
from research.current_mnq_strategy_v2_4_story_ablation import (
    ABLATIONS,
    DIAGNOSTIC_ONLY,
    ablation_verdicts,
)

DATA = Path("research/_mnq_v24_replay_lab_v3/data")
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
SCORECARD = Path("research/current_mnq_strategy_v2_4_frozen_14_case_scorecard_2026_08_21.json")
OUT = Path("research/current_mnq_strategy_v2_4_story_ablation_2026_08_22.json")


def ablate_session(env: dict, dte: date, p) -> tuple[list[dict], dict]:
    """Ablation verdicts for every Route A grant in one session, plus its control row."""
    captured: dict[int, dict] = {}

    def hook(record, **inputs):
        captured[id(record)] = inputs

    xr = xray_session(env, dte, p, on_rejection_candidate=hook)

    grants = [r for r in xr["records"]
              if r.get("outcome") == "SURVIVED_TO_RANKING"
              and r.get("route") == ROUTE_A_REJECTION]

    rows: list[dict] = []
    for r in grants:
        inputs = captured.get(id(r))
        if inputs is None:
            raise RuntimeError(f"GRANT_WITHOUT_CAPTURED_INPUTS at {dte} {r.get('clock')}")
        v = ablation_verdicts(**inputs)
        if v is None:
            raise RuntimeError(f"ABLATION_DISAGREED_WITH_THE_GATE_IT_MIRRORS at {dte} "
                               f"{r.get('clock')}")
        rows.append({
            "session": str(dte),
            "bucket": r["bucket"], "clock": r["clock"], "direction": r["direction"],
            "location_id": r["location_id"], "location_source": r["location_source"],
            "tag": r["tag"], "ablation": v,
        })

    control = {
        "session": str(dte),
        "route_a_grants": len(grants),
        "verdicts_computed": len(rows),
        "candidates_captured_by_hook": len(captured),
        "every_grant_has_a_verdict": len(rows) == len(grants),
    }
    return rows, control


def main() -> None:
    t0 = time.perf_counter()
    sc = json.load(io.open(SCORECARD, encoding="utf-8"))
    sessions = sorted({c["session"] for c in sc["cases"]})
    censored = {c["session"]: bool(c["trader_label_censored"]) for c in sc["cases"]}

    observed = old.download_pinned(DATA, include_tick=False)
    old.verify_manifest(observed, json.loads(LOCK.read_text()))
    raw5 = old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name)
    raw1 = old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name)
    env = old.prepare(raw5, raw1)
    p = v24.Params()

    grants: list[dict] = []
    control_rows = []
    for sess in sessions:
        rows, control = ablate_session(env, date.fromisoformat(sess), p)
        if not control["every_grant_has_a_verdict"]:
            raise RuntimeError(f"CONTROL_FAILED at {sess}: {control}")
        control_rows.append(control)
        grants.extend(rows)
        print(f"  {sess}  routeA grants={control['route_a_grants']:4}  "
              f"considered={control['candidates_captured_by_hook']:4}  control=OK")

    total = len(grants)
    unc = [g for g in grants if not censored[g["session"]]]

    def killed(rows, key):
        return sum(1 for g in rows if not g["ablation"][key])

    summary = {}
    for k, why in ABLATIONS.items():
        summary[k] = {
            "requirement": why,
            "grants_killed_all_14": killed(grants, k),
            "grants_killed_uncensored": killed(unc, k),
            "pct_of_grants_killed_all_14": round(100.0 * killed(grants, k) / max(total, 1), 1),
        }
    all_six_kill = killed(grants, "ALL_SIX_RESTORED")

    out = {
        "artifact": "V24_REJECTION_STORY_CONJUNCT_ABLATION",
        "authority": "ALGO-011 section 5B and section 10",
        "status": DIAGNOSTIC_ONLY,
        "produced": "2026-08-22",
        "what_a_number_means": (
            "`grants_killed` counts Route A candidates THE CURRENT KERNEL GRANTS that restoring "
            "that ONE v2.2 requirement would have killed. It sizes the loosening; it does not "
            "argue the requirement is correct."),
        "not_a_claim_about_the_teacher": (
            "v2.2 is the PRIOR IMPLEMENTATION, not the trader. Nothing here shows any restored "
            "requirement matches what the trader means. Only the source evidence can say that."),
        "positive_control": {
            "what": "the runner does not re-walk the kernel loop; it hooks xray_session and "
                    "evaluates only records the kernel's own _rank_and_yield left as grants. "
                    "Every grant must carry a captured input set and a non-None verdict.",
            "per_session": control_rows,
        },
        "totals": {
            "route_a_grants_all_14": total,
            "route_a_grants_uncensored": len(unc),
            "grants_surviving_all_six_restored": total - all_six_kill,
            "grants_killed_by_all_six_restored": all_six_kill,
            "runtime_seconds": round(time.perf_counter() - t0, 2),
        },
        "per_requirement": summary,
        "grants": grants,
    }
    io.open(OUT, "w", encoding="utf-8", newline="\n").write(
        json.dumps(out, indent=2, ensure_ascii=False) + "\n")

    print(f"\nwrote {OUT}")
    print(f"  Route A grants (all 14)   : {total}   (uncensored {len(unc)})")
    for k, s in summary.items():
        print(f"  {k:30} kills {s['grants_killed_all_14']:4} "
              f"({s['pct_of_grants_killed_all_14']:5.1f}%)  unc {s['grants_killed_uncensored']:4}")
    print(f"  ALL SIX RESTORED          : {total - all_six_kill} of {total} grants survive")


if __name__ == "__main__":
    main()
