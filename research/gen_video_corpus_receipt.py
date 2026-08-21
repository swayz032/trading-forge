"""Render the video-corpus custody receipt from the evidence registry.

This module exists because an earlier version of the receipt CLAIMED to be generated from
the registry when no generator existed anywhere in the repository. A fresh independent
grader caught it: the receipt's text happened to be faithful, but the mechanism it named
was fiction, and the failure class it claimed to have removed was still live.

The claim is now true. `render()` is the only thing that writes that document, and
`tests/test_current_mnq_strategy_v2_4_video_corpus_registry.py` re-renders in-process and
compares byte-for-byte against the committed file. Editing the registry without
regenerating goes RED; editing the receipt by hand goes RED.

Run `python -m research.gen_video_corpus_receipt` from the repo root to regenerate.
"""
from __future__ import annotations

import io
import json

REGISTRY = "research/current_mnq_strategy_v2_4_unified_fidelity_evidence_registry_2026_08_20.json"
RECEIPT = "research/current_mnq_strategy_v2_4_video_corpus_custody_receipt_2026_08_21.md"
EXT_KEY = "video_corpus_extension_2026_08_21"


def load_registry(path: str = REGISTRY) -> dict:
    return json.load(io.open(path, encoding="utf-8"))


def render(reg: dict) -> str:
    ext = reg[EXT_KEY]
    vids = reg["verified_video_evidence"]
    sealed = [v for v in vids if "role_provenance" not in v]
    added = [v for v in vids if "role_provenance" in v]
    L: list[str] = []
    w = L.append

    w("# Video corpus custody receipt (operator-supplied full set, 2026-08-21)")
    w("")
    w("Status: **LANDED.** The operator authorized the addition (*\"and it gets added\"*) and")
    w("then handed this seat the landing (*\"do it yourself\"*). All eight of his videos are")
    w("bound into the unified fidelity evidence registry, which is build-fingerprinted.")
    w("")
    w("**This file is rendered by `research/gen_video_corpus_receipt.py` and verified by")
    w("re-rendering inside the test suite.** That mechanism is real and you can check it:")
    w("the test imports `render()`, rebuilds this document in memory from the registry, and")
    w("compares byte-for-byte against the committed file. Editing the registry without")
    w("regenerating goes red; editing this file by hand goes red.")
    w("")
    w("It was not always real. An earlier version of this receipt asserted in bold that it")
    w("was generated from the registry when NO generator existed anywhere in the repository.")
    w("A fresh independent grader with no lineage in the work found it: the text happened to")
    w("be faithful, but the mechanism was fiction and the failure class it claimed to have")
    w("removed was still live. A false mechanism claim inside a custody document is worse")
    w("than the drift it was covering for, because it stops the next reader looking.")
    w("")
    w("---")
    w("")

    w("## 1. Custody — all 8 files, hash-verified on disk")
    w("")
    w("| # | File | Location | sha256 | Duration | Provenance |")
    w("|---|---|---|---|---|---|")
    paths = ext.get("file_locations", {})
    for i, v in enumerate(vids, 1):
        prov = v.get("role_provenance", "SEALED_2026_08_20_NO_PROVENANCE_RECORDED")
        dur = v.get("duration_seconds")
        dur = f"{dur:.1f}s" if dur else "—"
        loc = paths.get(v["name"], "—")
        w(f"| {i} | `{v['name']}` | `{loc}` | `{v['sha256'][:16]}…` | {dur} | {prov} |")
    w("")
    w("Hashes were verified by two independent implementations and re-verified from disk by")
    w("two independent graders. The hash is the real binding; the path is recorded so the")
    w("verification is re-locatable, since three of the eight files are not where the other")
    w("five are.")
    w("")

    w("## 2. Roles, and who said them")
    w("")
    w("`OPERATOR_STATED` is the trader's own words, quoted verbatim and pinned by test.")
    w("`DERIVED_NOT_OPERATOR_STATED` is an engineer's reading of the frames — outranked by")
    w("any later direct trader clarification, and never to be mistaken for his words.")
    w("")
    for v in added:
        w(f"### `{v['name']}` — {v['role_provenance']}")
        w("")
        roles = ", ".join("`" + r + "`" for r in v["roles"]) if v["roles"] else \
            "*none — carries no teachable content*"
        w("Roles: " + roles)
        w("")
        if v.get("operator_words"):
            w("> " + v["operator_words"])
            w("")
        w(v["notes"])
        w("")

    w("### The three videos sealed on 2026-08-20")
    w("")
    w("**Their provenance is NOT RECORDED — not by the seal, and not here.** Their entries")
    w("carry exactly three fields (name, roles, sha256) with no method, coverage or")
    w("derivation basis. They are listed separately for that reason: a reader must not take")
    w("the most authoritative evidence in this corpus for the trader's own words, because")
    w("nothing says whether it is.")
    w("")
    for v in sealed:
        w(f"- `{v['name']}` — " + ", ".join("`" + r + "`" for r in v["roles"]))
    w("")

    w("## 3. Coverage — frames read of frames total")
    w("")
    w("A derived role is only as good as the coverage behind it. Every claim states its")
    w("denominator in the same sentence, and EXHAUSTIVE requires literal 100%:")
    w("")
    for k, val in ext["enumeration_status"].items():
        w(f"- `{k}` — {val}")
    w("")

    w("## 4. Audio")
    w("")
    a = ext["audio_disposition"]
    w(a["claim"])
    w("")
    w("**Retracted over-claim.** " + a["retracted_overclaim"])
    w("")
    w("Method: " + a["method"])
    w("")
    w("- Silent end to end, 7 of 8: " + a["silent_end_to_end_7_of_8"])
    exc = a["the_one_exception"]
    w(f"- **The exception:** `{exc['file']}` — {exc['note']} Audible span "
      f"{exc['audible_span_seconds'][0]}s→{exc['audible_span_seconds'][1]}s = "
      f"{exc['audible_duration_seconds']}s. {exc['rest_of_file']}.")
    w("- Reading: " + exc["reading"])
    if exc.get("retracted_reasoning"):
        w("- **Retracted reasoning:** " + exc["retracted_reasoning"])
    w("- Consequence: " + exc["consequence"])
    w("- Positive control: " + a["positive_control"])
    if a.get("operator_confirmation_requested"):
        w("- Operator: " + a["operator_confirmation_requested"])
    w("")

    w("## 5. Independent grading (doer ≠ grader)")
    w("")
    g = ext["independent_grade_2026_08_21"]
    w(f"First grader, commit `{g['commit_graded']}` — **band {g['band']} {g['verdict']}**.")
    w("Defects it convicted, which the doer had published:")
    w("")
    for x in g["confirmed_defects_the_doer_published"]:
        w("- " + x)
    w("")
    w("False-green routes it found, since closed:")
    w("")
    for x in g["false_green_routes_closed_here"]:
        w("- " + x)
    w("")
    w("**Scope:** " + g["band_scope"])
    w("")
    w(g["grader_self_correction"])
    w("")
    g2 = ext["grader_findings_closed_2026_08_21_second_pass"]
    w(f"Re-grade at `{g2['regrade_head']}` — band {g2['band_held']} {g2['verdict']}, HELD.")
    w("")
    w("> " + g2["grader_lineage_caveat"])
    w("")
    for x in g2["closed_here"]:
        w("- " + x)
    w("")
    fresh = ext.get("fresh_grade_2026_08_21")
    if fresh:
        w(f"Fresh grader, no lineage, commit `{fresh['commit_graded']}` — "
          f"**band {fresh['band']} {fresh['verdict']}**.")
        w("")
        for x in fresh["findings_closed_here"]:
            w("- " + x)
        w("")
        w("What it verified closed: " + fresh["verified_closed"])
        w("")
        w("Its own retractions, recorded because a grader that corrects itself in public is")
        w("worth more than one that does not: " + fresh["grader_own_retractions"])
        w("")

    w("## 5b. Session-span arithmetic")
    w("")
    sp = ext.get("session_span_arithmetic")
    if sp:
        w(sp["why"])
        w("")
        for k, val in sp.items():
            if k == "why":
                continue
            w(f"- `{k}` — {val['wall_clock_start']}→{val['wall_clock_end']} "
              f"({val['span_seconds']}s) against a file duration of "
              f"{val['file_duration_seconds']}s. Read at {val['read_at']}. "
              f"**Retracted:** {val['retracted_span']}.")
        w("")

    w("## 6. The denominator rule")
    w("")
    r = ext["the_denominator_rule"]
    w("**" + r["rule"] + "**")
    w("")
    w(r["the_pattern_it_prevents"])
    w("")
    for x in r["the_five"]:
        w("- " + x)
    w("")
    w(r["note"])
    w("")

    w("## 7. Instruments")
    w("")
    f = ext["instruments_that_failed_here"]
    w(f["why_recorded"])
    w("")
    w("**Correction:** " + f["CORRECTION_2026_08_21"])
    w("")
    trap = f["THE_ACTUAL_TRAP_ffmpeg_v_error_suppresses_log_filters"]
    w("**The actual trap.** " + trap["what_happens"] + " Affected: " +
      ", ".join("`" + x + "`" for x in trap["affected_filters"]) + ". " +
      trap["measured_proof"] + " " + trap["how_often_it_bit"])
    w("")
    w("- Scene detection: " + f["ffmpeg_scene_change_detection"]["verdict"] + " " +
      f["ffmpeg_scene_change_detection"]["real_limitation_measured"])
    px = f["mean_frame_to_frame_pixel_difference"]
    w("- Pixel difference: " + px["verdict"] + " " + px["within_a_file_it_works"] + " " +
      px["across_files_it_does_not"])
    w("- " + f["python_subprocess_path_trap"])
    w("")

    w("## 8. Finding against the 2026-08-20 seal — recorded, NOT repaired")
    w("")
    s = ext["finding_against_the_2026_08_20_seal"]
    w(s["status"] + " " + s["positive_control"])
    w("")
    w("Zero-hit terms: " + ", ".join("`" + x + "`" for x in s["zero_hit_terms"]) + ".")
    w("Sealed entry shape: " + ", ".join("`" + x + "`" for x in s["sealed_entry_shape"]) + ".")
    w("")
    w("- Does NOT convict: " + s["what_this_does_NOT_convict"])
    w("- DOES establish: " + s["what_it_DOES_establish"])
    w("- The real gap: " + s["the_real_gap"])
    w("- Asymmetry: " + s["asymmetry"])
    w("- Disposition: " + s["disposition"])
    w("")

    w("## 9. What this receipt does not claim")
    w("")
    w("- No evidence bytes are committed — only names, paths, hashes, durations and roles.")
    w("- No file left this machine. No audio was transcribed or sent to any external service.")
    w("- Video evidence is fidelity evidence, never edge evidence.")
    w("- Adding these videos did NOT reopen manual replay collection.")
    w("- PR #38 remains DRAFT / DO NOT MERGE.")
    w("")
    return "\n".join(L)


def main() -> None:
    text = render(load_registry())
    io.open(RECEIPT, "w", encoding="utf-8", newline="\n").write(text)
    print(f"wrote {RECEIPT} ({len(text.splitlines())} lines)")


if __name__ == "__main__":
    main()
