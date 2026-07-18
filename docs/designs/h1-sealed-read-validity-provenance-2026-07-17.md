# Sealed-read VALIDITY provenance + engagement audit (R-035, written BEFORE recompute)

> R-035 §4/§5: the fail-closed-INVALID first verdict is recoverable under Campaign
> Law 3's validity-passing-run clause, CONDITIONAL on a genuine independently-graded
> engagement audit written BEFORE the recomputation. This document IS that record:
> the audit finding + the per-element evidence for `validity_inputs.json`. The verdict
> is then recomputed ONCE from the SAME persisted artifacts (no re-dispatch); the
> structural fraction must stay 0.8182 or it is an ALARM → HALT. Recomputed verdict is
> FINAL, read once, reported as AR-027. No further recovery after AR-027 (clause spent).

## 1. Engagement audit — INDEPENDENT (doer≠grader, fresh context), written BEFORE recompute

**GATE VERDICT: ENGAGEMENT EVIDENCED** across all four seams + both provenance chains.
No degeneracy, vacuity, canned-output, or inconsistency. Per-item (read-only audit of
`scratchpad/SEALED-READ`):

1. **Phase-A non-degeneracy — EVIDENCED.** 11/12 videos have 5/5 byte-distinct draw
   content (strategy-block SHAs distinct); the only identical-across-draws video is
   `iyKk9fpMSY8` — the reasoned zero-strategy video (enumeration_note reasons why),
   not degeneracy. Consensus mode_n=5 for all 12 (stable ≥4).
2. **Phase-A count — EVIDENCED.** 60 draws (12×5); 13 distinct strategies; 1 zero-video;
   enumerations quote real transcript mechanics.
3. **Phase-B non-vacuous — EVIDENCED.** 13/13 populated (entry_sequence 3–8, confluences
   2–7, verbatim stop, variants ≤3); all carry instrument_classification + reader_identity;
   the 2 `stop=null` are honest (transcripts teach no concrete stop).
4. **Panels non-vacuous + distinct — EVIDENCED.** 13/13 with all 3 axes; conflation 12
   PASS / 1 REJECT (`SeqVUNanFeY`); completeness 10 True / 3 False; per-cid spend
   $0.017–$0.041 (11 distinct). The 3 non-clean panels map exactly to the verdict's
   non-clean video-units.
5. **Raters both stages + independent — EVIDENCED.** A & B each: stage1=117, stage2=107,
   0 empty justifications; vocab-compliant; independent (support disagreement 23/107 =
   21.5%).
6. **Gemma anchors real — EVIDENCED.** 237 anchors, 0 empty; 107/107 non-control items
   transcript-grounded; 10 W1 controls foreign-by-design (calibration decoys).
7. **Spend consistency — EVIDENCED.** 13 panel log lines, $0.017–$0.041 each, sum
   $0.373; consistent with 13 real 3-grader dispatches.
8. **Attempts integrity — EVIDENCED.** 77 attempt files = 60+13+4; all resolved:true,
   outcome:ok, retry_count:0; certify_stamp hashes chain (phase_a_draws + phase_b).

Full auditor report on file (session transcript). "The INVALID is a real structural
finding produced by real work, eligible for the recovery path the advisor is gating."

## 2. `validity_inputs.json` — per-element evidence (all four classes truthfully supplyable)

| element | value | evidence (from fixed artifacts) |
|---------|-------|--------------------------------|
| `registration_pre_check` | ok, n_registered=12 | Module-A seal-gate verified manifest `4d7b3c29` at runtime; `source_attrition` 12/12 readable, 0 unreadable; the 12 are the frozen sealed set (`h1-wave6-sealed-fresh-set-2026-07-12.json`) |
| `engagement_pre_check` | ok | §1 above — independent doer≠grader audit, ENGAGEMENT EVIDENCED all 8 items |
| `frozen_scan_commit` / `driver_commit` | `405af2d9` | committed 2026-07-17 20:14:30; the read fetched transcripts at 20:19 (commit FROZEN before the read); reader_identity SHAs (enumerator `fe257088`, prompt `4d61b4b0`, tag `efa377d6`) frozen in every artifact |
| `epoch` (read-once) | `2026-07-17T20:19:00-04:00` | one monotonic session window: first draw 20:20 → plan 20:35 → consensus 21:04 → certify/panels 21:24 → raters 21:55 → log end 22:19 (single read) |

## 3. Recompute contract (R-035 §5)

Recompute `run_stage_verdict` from the SAME persisted artifacts. reverify MUST re-MATCH;
the structural `video_unit_clean_fraction` MUST equal the recorded `0.8182` (any
difference is an ALARM → HALT, not a result). The recomputed verdict is FINAL, read
once, reported verbatim as AR-027 — whichever way it lands.
