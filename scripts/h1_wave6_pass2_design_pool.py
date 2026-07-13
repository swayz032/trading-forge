"""H1 Wave-6 Pass-2 — TWO-PHASE DESIGN-POOL measurement driver (Gates 2 & 3 + Guard 1 screen).

Per the frozen packet (docs/designs/h1-wave6-pass2-two-phase-PACKET-2026-07-13.md
§5, Gates 2-3 carried forward + §4 Guard 1): re-runs the TWO-PHASE conveyor
(Phase A `src/agents/strategy-enumerator.md` + Phase B
`src/agents/transcript-extractor-minimal.md`, scoped per Phase-A-enumerated
strategy) over the spent-16 gold regression corpus's ALREADY-CACHED
transcripts (no re-fetch, no anchor-locator, no tier-1/tier-3
classification — those are explicitly OUT of scope per packet §6).

Adapted from `scripts/h1_wave6_pass1_design_pool.py` (pass-1's single-phase
measurement driver). Differences from pass-1's script:
  1. Calls `extractor_bridge.run_two_phase_extraction` instead of
     `invoke_real_extractor` directly (the §2 handoff wiring: Phase A once,
     N scoped Phase B calls, downstream-assembled into the same top-level
     `strategies[]` shape pass-1's script already consumed).
  2. RESUMABLE per packet's own read-once/vault discipline AND this build's
     explicit resumability requirement — a video whose vault file already
     exists is loaded, never re-run, so a mid-batch Ollama blip does not
     force a full re-run (mirrors pass-1's own vault-skip behavior, applied
     to the two-phase result as one atomic per-video record).
  3. Guard 1 (over-enumeration fence) SCREEN is computed per video
     (`src/engine/extraction/enumeration_guard.screen_enumeration_count`)
     against the ORIGINAL spent-16 baseline strategy count. For the three
     videos this campaign has ALREADY adjudicated
     (`enumeration_guard.KNOWN_ADJUDICATIONS`), a trip is auto-resolved
     against the pre-committed non-trip band with NO further LLM call. Any
     OTHER trip (unknown video, or a known video whose count falls outside
     its non-trip band) is reported as `needs_escalation` — this script
     does NOT invoke a fresh blind adjudicator itself (that is a separate,
     manual/agent-loop step per packet §4 step 2); it never silently
     resolves an escalation it owes.
  4. Gate-2 coverage's per-strategy guard uses a VIDEO-LEVEL aggregate
     comparison (baseline total spine conditions for the video vs. pass-2
     total spine conditions across ALL of that video's resulting Phase-B
     strategy objects), not a per-baseline-strategy-array-INDEX comparison.
     This directly implements packet §5's corrected-denominator note ("not
     per pass-2 output array index — the index-based comparison is exactly
     what generated the false WEh trip in pass-1"): comparing by video
     identity instead of by output-array position removes the positional
     bug at its root. A per-original-baseline-strategy breakdown is still
     reported for observability, but ONLY the video-level aggregate feeds
     the >50%-loss screen; any video-level trip is a `needs_escalation`
     flag (screen only), resolved by the same content-preservation decider
     Guard 1 uses — this script does not auto-resolve it either.
  5. Gate 3 support-miss reporting carries BOTH numbers side by side, per
     the coordinator's mid-build reporting-completeness requirement
     (2026-07-13, NOT a gate-threshold change — the frozen ≤8% gate still
     reads only the GATED number):
       - GATED support-miss: numerator/denominator over QUOTED conditions
         ONLY (null/sentinel conditions excluded from both) — this is what
         the frozen ≤8% gate reads, unchanged from pass-1's calculation.
       - TERMINAL-EQUIVALENT support-miss: numerator/denominator over ALL
         quote-bearing condition slots (quoted AND null/sentinel), with
         EVERY null/sentinel condition counted as a MISS — this is the
         number the fresh-12 terminal read will actually reproduce, because
         an unanchored condition fails all-conditions-clean at certificate
         time (packet §4 pre-reg §4). A degenerate extractor that nulls the
         hard conditions to ace the GATED ratio over an easy remainder
         would clear #1 but visibly fail #2 in this same report — both
         numbers must be visible so a SHA-freeze decision never rests on
         only the number a gaming extractor could win.
       - The raw null/sentinel rate (scoped to entry_sequence[]+confluences[]
         — the two locations where null is the NEW honest sentinel, not the
         pre-existing stop/targets null-cascade) is reported alongside, with
         the §3.4 15%-of-quote-bearing-conditions soft ceiling flagged
         (advisory, non-gating, per packet §3.4).

Writes to a NEW vault dir (docs/replay-results/h1-scripts/wave6-pass2-design-pool/) —
NEVER touches docs/replay-results/h1-scripts/pilot-run/ or
docs/replay-results/h1-scripts/wave6-pass1-design-pool/ (both frozen
read-once artifacts).

Outputs:
  - extraction-vault/{video_id}.json  — raw two-phase result per video
                                         (run_two_phase_extraction's return
                                         value: assembled strategies[] +
                                         phase_a_enumeration +
                                         per_strategy_extractions)
  - gate2_gate3_report.json           — coverage counts (Gate 2) + Guard 1
                                         screen + BOTH Gate-3 support numbers
                                         (gated + terminal-equivalent) + the
                                         sentinel usage rate

Gate 3's one-rater semantic pass is NOT automated here (it is a judgment
call) — this script prints every mechanically-surviving (quote, condition-
text) pair for manual one-rater review; the rating itself is recorded
separately, exactly as pass-1's script did.

Run from repo root: python scripts/h1_wave6_pass2_design_pool.py
"""
from __future__ import annotations

import json
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from src.engine.extraction import extractor_bridge as eb  # noqa: E402
from src.engine.extraction import enumeration_guard as eg  # noqa: E402
from src.engine.extraction.pilot_conveyor import extract_spine_condition_texts  # noqa: E402

PILOT_TRANSCRIPT_DIR = os.path.join(ROOT, "docs", "replay-results", "h1-scripts", "pilot-run", "transcripts")
PILOT_PHASE1_SUMMARY = os.path.join(ROOT, "docs", "replay-results", "h1-scripts", "pilot-run", "phase1_summary.json")
PILOT_VIDEOS_DIR = os.path.join(ROOT, "docs", "replay-results", "h1-scripts", "pilot-run", "videos")
OUT_DIR = os.path.join(ROOT, "docs", "replay-results", "h1-scripts", "wave6-pass2-design-pool")
VAULT_DIR = os.path.join(OUT_DIR, "extraction-vault")

for d in (OUT_DIR, VAULT_DIR):
    os.makedirs(d, exist_ok=True)


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip().lower()


# Condition-bearing fields per Phase B's schema (unchanged shape from pass-1;
# the §3.2 sentinel fix is description-only, no structural change).
# `sentinel_eligible=True` marks the two REQUIRED-quote locations
# (entry_sequence[], confluences[]) where a null quote is the NEW honest
# sentinel (§3.2) rather than the pre-existing stop/targets null-cascade.
def iter_quote_bearing_conditions(strategy: dict):
    entry_seq = strategy.get("entry_sequence") or []
    if isinstance(entry_seq, list):
        for i, step in enumerate(entry_seq):
            if not isinstance(step, dict):
                continue
            yield {
                "field": f"entry_sequence[{i}]", "quote": step.get("transcript_quote"),
                "condition_text": step.get("action"), "nullable": False, "sentinel_eligible": True,
            }

    confluences = strategy.get("confluences") or []
    if isinstance(confluences, list):
        for i, c in enumerate(confluences):
            if not isinstance(c, dict):
                continue
            yield {
                "field": f"confluences[{i}]", "quote": c.get("transcript_quote"),
                "condition_text": c.get("description"), "nullable": False, "sentinel_eligible": True,
            }

    stop = strategy.get("stop")
    if isinstance(stop, dict) and stop.get("anchor") is not None:
        yield {
            "field": "stop", "quote": stop.get("transcript_quote"),
            "condition_text": stop.get("rationale") or stop.get("anchor"), "nullable": True, "sentinel_eligible": False,
        }

    targets = strategy.get("targets") or []
    if isinstance(targets, list):
        for i, t in enumerate(targets):
            if not isinstance(t, dict):
                continue
            yield {
                "field": f"targets[{i}]", "quote": t.get("transcript_quote"),
                "condition_text": t.get("rationale") or t.get("type"), "nullable": True, "sentinel_eligible": False,
            }


def run() -> None:
    video_ids = sorted(
        vid[:-5] for vid in os.listdir(PILOT_TRANSCRIPT_DIR) if vid.endswith(".json")
    )
    print(f"[pass2-design-pool] {len(video_ids)} cached spent-16 transcripts found", flush=True)

    with open(PILOT_PHASE1_SUMMARY, encoding="utf-8") as fh:
        baseline_summary = json.load(fh)
    baseline_by_video = {r["video_id"]: r for r in baseline_summary["rows"]}
    baseline_total = baseline_summary["totals"]["spine_conditions"]

    per_video_rows = []
    quote_bearing_rows = []  # for Gate 3 one-rater pass
    guard1_rows = []
    failures = []

    for idx, vid in enumerate(video_ids):
        print(f"\n[pass2-design-pool] ({idx+1}/{len(video_ids)}) {vid}", flush=True)
        with open(os.path.join(PILOT_TRANSCRIPT_DIR, f"{vid}.json"), encoding="utf-8") as fh:
            tr = json.load(fh)
        transcript = tr["transcript"]

        vault_path = os.path.join(VAULT_DIR, f"{vid}.json")
        if os.path.exists(vault_path):
            print(f"[pass2-design-pool]   RESUME: vault present, skip re-extraction", flush=True)
            with open(vault_path, encoding="utf-8") as fh:
                two_phase_result = json.load(fh)["extraction"]
        else:
            try:
                two_phase_result = eb.run_two_phase_extraction(transcript, f"{vid}-wave6-pass2")
            except (eb.RealExtractorError, eb.EnumeratorError) as exc:
                failures.append((vid, str(exc)[:500]))
                print(f"[pass2-design-pool]   EXTRACTION FAILED (recorded, continuing): {str(exc)[:300]}", flush=True)
                continue
            eb.save_extraction(
                VAULT_DIR, vid, two_phase_result,
                {"seed": 42, "temperature": 0.1, "model": "gemma4:e4b-it-qat", "pass": "wave6-pass2-two-phase"},
            )

        strategies = two_phase_result.get("strategies") or []
        phase_a = two_phase_result.get("phase_a_enumeration") or {}
        phase_a_strategies = phase_a.get("strategies") or []

        # ---- Guard 1 screen (packet §4) ----------------------------------
        # Delegates to enumeration_guard.evaluate_guard1 (the single source
        # of truth for the two-stage routing, including the known-video
        # ground-truth-outranks-baseline-screen priority fix) rather than
        # duplicating its logic inline. No adjudicate_fn/content_preservation_fn
        # is supplied here (this script is a mechanical measurement driver,
        # not an adjudicator) — a ValueError means "this video's trip is not
        # auto-resolvable" and is caught and reported as `needs_escalation`,
        # never silently swallowed.
        baseline_row = baseline_by_video.get(vid, {})
        baseline_strategy_count = baseline_row.get("strategies", 0)
        enumerated_count = len(phase_a_strategies)
        known_band = eg.KNOWN_ADJUDICATIONS.get(vid)
        try:
            g1_verdict = eg.evaluate_guard1(vid, enumerated_count, baseline_strategy_count)
            screen = g1_verdict.screen_result
            g1_routing, g1_note = g1_verdict.routing, g1_verdict.note
        except ValueError as exc:
            screen = eg.screen_enumeration_count(enumerated_count, baseline_strategy_count)
            g1_routing, g1_note = "needs_escalation", str(exc)
        guard1_row = {
            "video_id": vid, "baseline_strategy_count": baseline_strategy_count,
            "phase_a_enumerated_count": enumerated_count, "screen_result": screen,
            "known_video": known_band is not None, "routing": g1_routing, "note": g1_note,
        }
        guard1_rows.append(guard1_row)

        # ---- Gate 2 coverage (video-level aggregate, corrected mapping) --
        n_spine = 0
        n_quote_present = 0
        n_quote_mech_pass = 0
        n_null_all = 0  # every null-quote slot across all 4 field types (terminal-equivalent numerator component)
        n_entry_confluence_slots = 0  # sentinel-eligible denominator
        n_entry_confluence_null = 0   # sentinel-eligible numerator (raw sentinel usage)
        tnorm = norm(transcript)

        for sidx, strat in enumerate(strategies):
            if not isinstance(strat, dict):
                continue
            spine = extract_spine_condition_texts(strat, sidx)
            n_spine += len(spine)

            for qc in iter_quote_bearing_conditions(strat):
                q = qc["quote"]
                row = {
                    "video_id": vid, "strategy_index": sidx, "strategy_name": strat.get("name"),
                    "field": qc["field"], "transcript_quote": q, "condition_text": qc["condition_text"],
                    "nullable": qc["nullable"], "sentinel_eligible": qc["sentinel_eligible"],
                }
                if qc["sentinel_eligible"]:
                    n_entry_confluence_slots += 1
                    if not q:
                        n_entry_confluence_null += 1
                if q:
                    n_quote_present += 1
                    mech_pass = norm(q) in tnorm
                    row["mechanical_substring_pass"] = mech_pass
                    if mech_pass:
                        n_quote_mech_pass += 1
                else:
                    row["mechanical_substring_pass"] = None
                    n_null_all += 1
                    if not qc["nullable"]:
                        row["SENTINEL"] = "honest no-quote sentinel (§3.2) — routes UNANCHORED, counts toward coverage"
                quote_bearing_rows.append(row)

        baseline_spine = baseline_row.get("spine_conditions", "?")
        pct_retained = (n_spine / baseline_spine * 100) if isinstance(baseline_spine, (int, float)) and baseline_spine else None
        row = {
            "video_id": vid, "strategies": len(strategies), "phase_a_enumerated_count": enumerated_count,
            "spine_conditions_pass2": n_spine, "spine_conditions_baseline": baseline_spine,
            "pct_retained_video_level": pct_retained,
            "loses_over_50pct_video_level": (pct_retained is not None and pct_retained < 50.0),
            "quote_bearing_slots": n_quote_present, "quote_mechanical_pass": n_quote_mech_pass,
            "null_or_sentinel_slots_all_fields": n_null_all,
            "entry_confluence_sentinel_slots": n_entry_confluence_slots,
            "entry_confluence_sentinel_null": n_entry_confluence_null,
        }
        per_video_rows.append(row)
        print(
            f"[pass2-design-pool]   phaseA_count={enumerated_count} (baseline={baseline_strategy_count}, "
            f"screen={screen}, routing={g1_routing}) strategies={len(strategies)} spine_pass2={n_spine} "
            f"(baseline={baseline_spine}) quote_slots={n_quote_present} mech_pass={n_quote_mech_pass} "
            f"null_all={n_null_all}",
            flush=True,
        )

    total_pass2 = sum(r["spine_conditions_pass2"] for r in per_video_rows)

    # ---- Gate-2 per-strategy (video-level aggregate) guard --------------
    any_video_loses_over_50pct = any(r["loses_over_50pct_video_level"] for r in per_video_rows)

    # ---- Per-original-baseline-strategy breakdown (observability ONLY —
    #      NOT the guard signal; the guard reads the video-level aggregate
    #      above per packet §5's corrected-denominator note). -------------
    per_strategy_baseline = {}
    for vid in video_ids:
        vp = os.path.join(PILOT_VIDEOS_DIR, f"{vid}.json")
        if not os.path.exists(vp):
            continue
        with open(vp, encoding="utf-8") as fh:
            vart = json.load(fh)
        for s in vart.get("strategies", []):
            key = f"{vid}::s{s['strategy_index']}"
            per_strategy_baseline[key] = s["spine_condition_count"]

    # ---- Gate 3: BOTH support numbers side by side (coordinator req.) ---
    total_quote_slots_quoted_only = sum(r["quote_bearing_slots"] for r in per_video_rows)
    total_mech_pass = sum(r["quote_mechanical_pass"] for r in per_video_rows)
    total_mech_fail = total_quote_slots_quoted_only - total_mech_pass
    total_null_all = sum(r["null_or_sentinel_slots_all_fields"] for r in per_video_rows)

    gated_support_miss_rate = (total_mech_fail / total_quote_slots_quoted_only) if total_quote_slots_quoted_only else None
    gated_floor_met = (gated_support_miss_rate is not None and gated_support_miss_rate <= 0.08)

    terminal_denominator = total_quote_slots_quoted_only + total_null_all
    terminal_numerator = total_mech_fail + total_null_all
    terminal_equivalent_support_miss_rate = (terminal_numerator / terminal_denominator) if terminal_denominator else None

    total_entry_confluence_slots = sum(r["entry_confluence_sentinel_slots"] for r in per_video_rows)
    total_entry_confluence_null = sum(r["entry_confluence_sentinel_null"] for r in per_video_rows)
    sentinel_rate = (total_entry_confluence_null / total_entry_confluence_slots) if total_entry_confluence_slots else None
    sentinel_soft_ceiling_exceeded = (sentinel_rate is not None and sentinel_rate > 0.15)

    report = {
        "artifact": "h1-wave6-pass2-design-pool-gate2-gate3-report",
        "scope": "spent-16 gold regression corpus ONLY (never the fresh Wave-6 sealed set)",
        "extractor_files_measured": [
            "src/agents/strategy-enumerator.md",
            "src/agents/kb/strategy-enumerator-schema.json",
            "src/agents/transcript-extractor-minimal.md",
            "src/agents/kb/transcript-extractor-minimal-schema.json",
        ],
        "n_videos": len(video_ids),
        "n_extraction_failures": len(failures),
        "extraction_failures": failures,
        "guard1_over_enumeration_fence": {
            "per_video": guard1_rows,
            "n_needs_escalation": sum(1 for r in guard1_rows if r["routing"] == "needs_escalation"),
            "note": "Screen + known-band auto-resolution only. Any 'needs_escalation' row requires a fresh blind adjudicator + the content-preservation decider (packet §4 step 2-3) — NOT auto-resolved by this script.",
        },
        "gate2_coverage": {
            "baseline_total_spine_conditions": baseline_total,
            "pass2_total_spine_conditions": total_pass2,
            "floor_required": round(0.9 * baseline_total),
            "floor_met": total_pass2 >= round(0.9 * baseline_total),
            "per_video": per_video_rows,
            "any_video_loses_over_50pct": any_video_loses_over_50pct,
            "per_baseline_strategy_observability_only": per_strategy_baseline,
            "denominator_mapping_note": "Guard evaluated at VIDEO-LEVEL aggregate (baseline total vs. pass-2 total across ALL resulting Phase-B strategy objects for that video), per packet §5's corrected-denominator note — NOT a per-baseline-strategy-array-INDEX comparison (the index-based comparison is exactly what generated the false WEh trip in pass-1). A video-level trip is a screen result requiring the same escalation ladder as Guard 1, not an automatic gate failure.",
        },
        "gate3_gated_support": {
            "description": "GATED support-miss — numerator/denominator over QUOTED conditions ONLY (null/sentinel excluded from both). This is what the frozen <=8% gate reads.",
            "total_quoted_conditions": total_quote_slots_quoted_only,
            "mechanical_substring_pass": total_mech_pass,
            "mechanical_substring_fail": total_mech_fail,
            "gated_support_miss_rate": gated_support_miss_rate,
            "gated_floor_met_le_8pct": gated_floor_met,
        },
        "gate3_terminal_equivalent_support": {
            "description": "TERMINAL-EQUIVALENT support-miss — numerator/denominator over ALL quote-bearing condition slots (quoted AND null/sentinel), every null/sentinel counted as a MISS. This is the number the fresh-12 terminal read will actually reproduce (an unanchored condition fails all-conditions-clean at certificate time). NOT a gate threshold by itself — reported for the SHA-freeze decision, per the 2026-07-13 coordinator reporting-completeness requirement.",
            "total_conditions_all": terminal_denominator,
            "miss_all_fields": terminal_numerator,
            "terminal_equivalent_support_miss_rate": terminal_equivalent_support_miss_rate,
        },
        "sentinel_usage": {
            "description": "Raw no-quote-sentinel rate, scoped to entry_sequence[]+confluences[] (the two locations where null is the NEW honest sentinel, §3.2) — advisory, non-gating soft ceiling at 15% per packet §3.4.",
            "entry_confluence_quote_bearing_slots": total_entry_confluence_slots,
            "entry_confluence_sentinel_null_count": total_entry_confluence_null,
            "sentinel_rate": sentinel_rate,
            "soft_ceiling_15pct_exceeded_advisory_non_gating": sentinel_soft_ceiling_exceeded,
        },
        "quote_bearing_rows_for_one_rater_pass": quote_bearing_rows,
    }
    with open(os.path.join(OUT_DIR, "gate2_gate3_report.json"), "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2, default=str)

    print("\n" + "=" * 70)
    print(f"GUARD 1 — over-enumeration fence: {report['guard1_over_enumeration_fence']['n_needs_escalation']} video(s) need escalation")
    print(f"GATE 2 — coverage: baseline={baseline_total} pass2={total_pass2} "
          f"floor(90%)={round(0.9*baseline_total)} MET={report['gate2_coverage']['floor_met']}")
    print(f"GATE 2 — video-level guard: any video lost >50%? {any_video_loses_over_50pct}")
    if total_quote_slots_quoted_only:
        print(f"GATE 3 (GATED, gate-reading) — {total_mech_pass}/{total_quote_slots_quoted_only} pass "
              f"(miss={gated_support_miss_rate:.1%}, floor<=8% MET={gated_floor_met})")
    else:
        print("GATE 3 (GATED) — no quoted conditions found")
    if terminal_denominator:
        print(f"GATE 3 (TERMINAL-EQUIVALENT, non-gate reporting) — miss={terminal_equivalent_support_miss_rate:.1%} "
              f"over {terminal_denominator} total conditions")
    if total_entry_confluence_slots:
        print(f"SENTINEL USAGE — {sentinel_rate:.1%} (soft ceiling 15% exceeded={sentinel_soft_ceiling_exceeded})")
    print(f"[pass2-design-pool] report written: {os.path.join(OUT_DIR, 'gate2_gate3_report.json')}")
    print("=" * 70)


if __name__ == "__main__":
    run()
