#!/usr/bin/env python3
"""AR-1349A SS9.B -- rebuild the manifest-row disposition projection from the now-authoritative
frozen certificates/refusals, per AR-1340A's steady-state disposition law. Never invents a
strategy name, market/timeframe mapping, or compile eligibility -- every row's identity comes
from the frozen `library-manifest-v1.1.json` (120 rows, sourced from the live DB at manifest
freeze, tagged `spec_video:<video_id>`), and every row's disposition comes from that video's own
real certificate/extraction-refusal artifact, never fabricated to fill a row.

DISPOSITION RULE (evidenced, matching AR-1342's own precedent for each case):
  - extraction produced ZERO strategy objects (this cleanup's `locator_backend="none"` units) ->
    OTHER_MEASURED_REFUSAL, reason = the extraction's own `rejected_strategies[0]` detail
    (matches AR-1342's video-2 `FqxEKDxemtI` treatment exactly).
  - `unanchored_condition_count > 0` on the real Opus-authorized certificate ->
    EXTRACTION_MISSING_REQUIRED_INFORMATION (matches AR-1342's pre-correction video-3 treatment:
    "more than half/some of the conditions have no literal transcript evidence the mechanical
    verifier can confirm").
  - `unanchored_condition_count == 0` and `pilot_grade == False` -> OTHER_MEASURED_REFUSAL
    (matches video 1 / E8Wg6tFPYjo / corrected video 3: condition-level paraphrase drift from
    what the located quote literally supports, not covered by any of the other 10 named
    categories).
  - `pilot_grade == True` -> FAITHFUL_COMPILE_READY_FOR_BACKTEST (none currently observed; the
    rule is stated so the script does not silently mishandle a future clean pass).

A manifest row whose `spec_video` tag has NO corresponding inventory unit (only `sVkmZklJDHI` at
time of writing -- the separately-managed sVkm/G2-D lane) is marked OUT_OF_SCOPE, never given an
invented disposition.

A `strategy_index` this session's re-extraction discovered that has NO corresponding row in the
FROZEN manifest (the manifest predates multi-strategy extraction; only index 0 existed at freeze
time) is reported separately as "unrepresented in manifest" -- a real, disclosed gap, not folded
silently into the 120-row table.
"""
from __future__ import annotations

import json
import os
import re

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
MANIFEST_PATH = os.path.join(REPO_ROOT, "docs/replay-results/strategy-factory-census/library-manifest-v1.1.json")
INVENTORY_PATH = os.path.join(REPO_ROOT, "docs/replay-results/strategy-factory-census/extraction-vault/prep-provenance-inventory.json")
OUT_PATH = os.path.join(REPO_ROOT, "docs/replay-results/strategy-factory-census/manifest-row-disposition-projection.json")


def disposition_for_unit(unit: dict) -> tuple[str, str]:
    if unit["locator_backend"] == "none":
        extraction_path = os.path.join(REPO_ROOT, unit["extraction_path"])
        with open(extraction_path, "r", encoding="utf-8") as f:
            rec = json.load(f)
        rejected = (rec.get("extraction") or {}).get("rejected_strategies") or []
        if rejected:
            r0 = rejected[0]
            return "OTHER_MEASURED_REFUSAL", f"{r0.get('reason')}: {r0.get('detail')}"
        return "OTHER_MEASURED_REFUSAL", "extraction produced zero strategy objects (no rejected_strategies detail recorded)"

    cert = unit.get("certificate_status") or {}
    unanchored = unit.get("unanchored_condition_count") or 0
    if unanchored > 0:
        return "EXTRACTION_MISSING_REQUIRED_INFORMATION", (
            f"{unanchored}/{unit.get('spine_condition_count')} conditions have no literal "
            "transcript evidence the mechanical verifier can confirm under the authorized Opus "
            "locator"
        )
    if cert.get("pilot_grade") is True:
        return "FAITHFUL_COMPILE_READY_FOR_BACKTEST", "clean certificate, all conditions confirmed"
    diag = cert.get("diagnosis") or {}
    unresolved = diag.get("classification_fallthrough_unresolved")
    return "OTHER_MEASURED_REFUSAL", (
        f"{unresolved} condition(s) show extractor-paraphrase drift from what the located quote "
        "literally supports (Stage-2 partial/unresolved support) -- not covered by any other "
        "named disposition category"
    )


def main() -> int:
    with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
        manifest = json.load(f)
    with open(INVENTORY_PATH, "r", encoding="utf-8") as f:
        inventory = json.load(f)

    units_by_video_s0 = {
        u["video_id"]: u for u in inventory["units"]
        if u.get("strategy_index") in (0, None)
    }
    inventory_video_ids = {u["video_id"] for u in inventory["units"]}

    # AR-1350A SS5/6: count how many modern strategy_index units this session's re-extraction
    # found per video. The frozen manifest predates multi-strategy extraction -- every row was
    # authored when each video had exactly one strategy. Silently projecting a multi-strategy
    # video's rows onto strategy_index=0 would assume, without proof, that modern index 0 is the
    # SAME source strategy the frozen row represents. No crosswalk mechanism exists in this
    # pipeline that proves that identity (the manifest carries no modern-strategy-index field at
    # all), so for any video with MORE THAN ONE strategy_index unit, every one of that video's
    # manifest rows fails closed as IDENTITY_UNRESOLVED rather than guessing index 0.
    strategy_indices_by_video: dict[str, list[int]] = {}
    for u in inventory["units"]:
        strategy_indices_by_video.setdefault(u["video_id"], []).append(u["strategy_index"])
    # AR-1353 F-8: len(set(idxs)), not len(idxs) -- the inventory's own units list could in
    # principle carry a duplicate (video_id, strategy_index) pair from an upstream defect, which
    # would inflate a length-of-list count without indicating real multi-strategy ambiguity. A
    # distinct-index count is the actual identity signal; errs fail-closed either way, but this
    # makes the predicate correct rather than merely safe by accident.
    multi_strategy_videos = {
        v for v, idxs in strategy_indices_by_video.items() if len(set(idxs)) > 1
    }

    rows = []
    out_of_scope = []
    identity_unresolved = []
    crosswalked_count = 0
    fail_closed_count = 0
    for row in manifest:
        spec_video = None
        for t in row.get("tags", []):
            m = re.match(r"spec_video:(.+)", t)
            if m:
                spec_video = m.group(1)
                break
        if spec_video is None:
            out_of_scope.append({"strategy_id": row["strategy_id"], "name": row.get("name"),
                                  "reason": "manifest row carries no spec_video tag"})
            continue
        if spec_video not in inventory_video_ids:
            out_of_scope.append({
                "strategy_id": row["strategy_id"], "name": row.get("name"),
                "spec_video": spec_video,
                "reason": "video not in this cleanup's inventory -- separately-managed lane "
                          "(e.g. sVkm/G2-D), not a gap in this factory's own population",
            })
            continue

        if spec_video in multi_strategy_videos:
            # No durable crosswalk exists (per the module docstring's Option 1/Option 2 rule) --
            # fail closed rather than pick strategy_index=0 by convenience. Every modern strategy
            # index for this video is still named here, so none silently disappears from
            # diagnostics even though no row is assigned to any of them.
            fail_closed_count += 1
            identity_unresolved.append({
                "strategy_id": row["strategy_id"],
                "name": row.get("name"),
                "symbol": row.get("symbol"),
                "timeframe": row.get("timeframe"),
                "spec_video": spec_video,
                "disposition": "IDENTITY_MATERIALIZATION_UNRESOLVED",
                "disposition_reason": (
                    f"this video now has {len(strategy_indices_by_video[spec_video])} modern "
                    f"strategy indices ({sorted(strategy_indices_by_video[spec_video])}) but the "
                    "frozen manifest row predates multi-strategy extraction and carries no field "
                    "identifying which one it represents. No durable crosswalk proving that "
                    "identity exists in this repository. Failing closed per AR-1350A SS6 Option "
                    "2 rather than assuming strategy_index=0 by convenience."
                ),
            })
            continue

        unit = units_by_video_s0.get(spec_video)
        if unit is None:
            out_of_scope.append({
                "strategy_id": row["strategy_id"], "name": row.get("name"),
                "spec_video": spec_video,
                "reason": "spec_video present in inventory but no strategy_index=0 unit found "
                          "(unexpected -- flag for investigation)",
            })
            continue
        # Single-strategy video: strategy_index=0 IS the only modern strategy that exists, so
        # there is no ambiguity to cross a walk over -- this is not the guessed case AR-1350A
        # objected to (that case never had a competing strategy_index to disambiguate from).
        crosswalked_count += 1
        disposition, reason = disposition_for_unit(unit)
        rows.append({
            "strategy_id": row["strategy_id"],
            "name": row.get("name"),
            "symbol": row.get("symbol"),
            "timeframe": row.get("timeframe"),
            "spec_video": spec_video,
            "locator_backend": unit["locator_backend"],
            "disposition": disposition,
            "disposition_reason": reason,
        })

    # Every modern strategy_index for a multi-strategy video, INCLUDING index 0 -- once a video
    # fails closed to IDENTITY_MATERIALIZATION_UNRESOLVED, none of its strategy indices (not even
    # 0) may claim a manifest row, so all of them must stay visible here rather than index 0
    # silently reading as "handled" while the others read as "extra". Single-strategy videos'
    # index 0 is excluded -- it legitimately IS represented via the crosswalked row above.
    unrepresented = [
        {"video_id": u["video_id"], "strategy_index": u["strategy_index"],
         "locator_backend": u["locator_backend"],
         "reason": "multi-strategy video, no row assigned to any index (fail-closed)"}
        for u in inventory["units"]
        if u["video_id"] in multi_strategy_videos
    ] + [
        {"video_id": u["video_id"], "strategy_index": u["strategy_index"],
         "locator_backend": u["locator_backend"],
         "reason": "extra strategy index beyond the frozen manifest's single-strategy assumption"}
        for u in inventory["units"]
        if u["video_id"] not in multi_strategy_videos and u.get("strategy_index") not in (0, None)
    ]

    disposition_counts: dict[str, int] = {}
    for r in rows:
        disposition_counts[r["disposition"]] = disposition_counts.get(r["disposition"], 0) + 1
    for r in identity_unresolved:
        disposition_counts[r["disposition"]] = disposition_counts.get(r["disposition"], 0) + 1

    out = {
        "artifact": "ar-1349a-manifest-row-disposition-projection",
        "authority": "AR-1349A SS9.B / AR-1350A SS6 -- rebuild from now-authoritative frozen "
                     "certificates, AR-1340A steady-state disposition law, no invented "
                     "names/markets/eligibility; multi-strategy videos fail closed rather than "
                     "assume strategy_index=0 without a proven crosswalk",
        "manifest_source": os.path.relpath(MANIFEST_PATH, REPO_ROOT),
        "inventory_source": os.path.relpath(INVENTORY_PATH, REPO_ROOT),
        "summary": {
            "total_manifest_rows": len(manifest),
            "rows_projected": len(rows),
            "rows_identity_unresolved": len(identity_unresolved),
            "rows_out_of_scope": len(out_of_scope),
            "disposition_counts": disposition_counts,
            "multi_strategy_videos_failed_closed": len(multi_strategy_videos),
            "rows_crosswalked_single_strategy": crosswalked_count,
            "rows_failed_closed_multi_strategy": fail_closed_count,
            "strategy_indices_unrepresented_total": len(unrepresented),
        },
        "rows": rows,
        "identity_unresolved_rows": identity_unresolved,
        "out_of_scope": out_of_scope,
        "unrepresented_strategy_indices": unrepresented,
    }
    with open(OUT_PATH, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, indent=2)

    print(json.dumps(out["summary"], indent=2))
    print(f"\nfull projection written to {os.path.relpath(OUT_PATH, REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
