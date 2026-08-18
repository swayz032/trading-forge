# AR-1312A Lane 1 — Deterministic Substitution/Grading Over the 8 RECOVERED_SINGLE_SOURCE Answers

**Ruling followed:** AR-1312A ("LANE A PASS / DETERMINISTIC GRADING NOW / F36 FINAL-CAPTURE REPAIR VIA SUBAGENTSTOP"), Lane 1 only.
**Zero new Agent/Task/model calls** — this is code execution against already-recovered evidence.
**Pipeline reused, not reimplemented:** `src/engine/extraction/g2d_finalizer.finalize()` → `opus_phase1_route.run_route()`, invoked exactly as `scripts/svkm_freeze_isolated_queue.py` invokes it, via the same `svkm_opus_batch_locator.py` driver for `transcript` / `conditions` / trial-1 `batch_answers`. No second comparator was authored.
**Script:** `scripts/g2d_lane1_deterministic_grade_tmp.py`. **Output artifact:** `opus_phase1_route_t1_g2d_final.json` (new — the original `opus_phase1_route_t1.json` history was not touched, per `historical_artifact_policy`).

## Input note — quote extraction from recovered evidence

`finalize()`'s `isolated_results` parameter expects, per condition_ref, the bare literal quote string (or `None`) — the same shape `verify_answer()` consumes for a batch answer. The 8 `isolated-recovery-t1/*.recovered.json` artifacts hold the full agent response (markdown-fenced JSON plus prose grounding notes), so the `quote` field was extracted from each via a small regex+`json.loads` step (visible in the script). All 8 extractions succeeded; none fell back to the bare-object regex path.

## Result

**Grade: RED. Accepted: 4/12 (unchanged from the original batch route). `provenance_counts: {isolated: 8, batch: 4}`.**

## Eight-row disposition table

| condition_ref | old disposition (batch, at freeze time) | recovered isolated quote | final disposition | deciding gate | reason (verbatim) |
|---|---|---|---|---|---|
| `entry_sequence[0].rationale` | `REFUSED_RELEVANCE` | "And what that now gives me is a range on the five minute. Right? So that's how high the price went within the first 5 minutes and that's how low it went." | `REFUSED_RELEVANCE` | `evidence_relevance` | `MISGROUNDED_BELOW_FLOOR: the span covers only 0.016 of the condition's distinctive content (floor 0.10) — it shares a word, not a subject` |
| `entry_sequence[1].action` | `HELD_DUPLICATE_ROLE_AMBIGUITY` | "the candles need to close outside of this 5m minute range" | `HELD_DUPLICATE_ROLE_AMBIGUITY` | `span_collision` | span reused across roles with `['confluences[1].description']`; texts overlap 0.86 of the smaller term set — recorded, not deduplicated |
| `entry_sequence[1].rationale` | `REFUSED_RELEVANCE` | "the candles have printed outside of the range on the lower side of this 5m minute time frame. Right now, this is pretty much what we're looking for because what it's telling us is that price may be looking for a move to the downside" | `REFUSED_RELEVANCE` | `evidence_relevance` | `MISGROUNDED_NO_OVERLAP: the span shares no content term with the condition, so it cannot be evidence for it` |
| `entry_sequence[2].action` | `REFUSED_RELEVANCE` | "What we are looking for is a fair value gap sequence that is printing outside of the range." | `REFUSED_RELEVANCE` | `evidence_relevance` | `MISGROUNDED_NOT_DISCRIMINATING: the span fits a different condition at least as well (0.30 vs 0.28)` |
| `entry_sequence[2].rationale` | `REFUSED_RELEVANCE` | "As soon as we see this gap being printed outside of the range and confirming, then we can enter the trade." | `REFUSED_RELEVANCE` | `evidence_relevance` | `MISGROUNDED_NO_OVERLAP: the span shares no content term with the condition, so it cannot be evidence for it` |
| `entry_sequence[3].rationale` | `REFUSED_RELEVANCE` | "my entry is going to be on the closure of that third candle" | `REFUSED_RELEVANCE` | `evidence_relevance` | `MISGROUNDED_BELOW_FLOOR: the span covers only 0.097 of the condition's distinctive content (floor 0.10) — it shares a word, not a subject` |
| `confluences[0].description` | `RED_SOURCE_FIDELITY` | "this strategy needs to be traded at 9:30 a.m. Eastern time, New York time" | `RED_SOURCE_FIDELITY` | `source_fidelity_guard` | `TIMING_WINDOW_WIDENING: source names a point in time; condition spans it into a window ('during' + extent noun)` |
| `confluences[1].description` | `HELD_DUPLICATE_ROLE_AMBIGUITY` | "the candles need to close outside of this 5m minute range" | `HELD_DUPLICATE_ROLE_AMBIGUITY` | `span_collision` | span reused across roles with `['entry_sequence[1].action']`; texts overlap 0.86 of the smaller term set — recorded, not deduplicated |

**All 8 rows land on the same disposition class as the frozen queue's original entry.** This is not because the isolated pipeline was skipped — `provenance_counts` confirms all 8 used the isolated (recovered) quote, and 5 of the 8 quotes differ in exact span/wording from whatever the original batch answer had been (the two duplicate-role rows and the timing row converge on the same short, unambiguous anchor both times, which is unsurprising for a single-sentence fact stated once in the transcript).

## What this means for the extraction, per row

- **`entry_sequence[1].action` / `confluences[1].description`** — genuine upstream duplication: two extracted conditions describing the identical breakout requirement, correctly HELD rather than silently merged. This is an extraction-authoring issue (the two fields should not both exist as independent conditions), not a locator failure.
- **`confluences[0].description`** — the extractor's condition text widened the source's point-in-time statement ("at 9:30 a.m.") into a duration/window framing. **The extracted condition requires correction** to match the source's actual point-in-time semantics, or the row stays RED by design.
- **`entry_sequence[0/1/2/3].rationale`, `entry_sequence[2].action`** — five `REFUSED_RELEVANCE` rows, all via the relevance gate's exact-term-overlap check against genuinely on-topic, verbatim, correctly-located quotes. The `opus_phase1_route.py` module docstring itself documents this exact failure mode (AR-1225): *"this gate FALSE-REJECTS a faithful paraphrase when the extractor normalised the wording... zero lexical overlap on a topically correct passage."* That is very plausibly what is happening here (e.g. the trader's word "downside"/"breakout" vs. the condition's word "direction"/"confirms"). **This is a known, already-documented limitation of the frozen relevance gate, not a new defect this run discovered** — and per AR-1225/AR-1236 the fix (a synonym map) was explicitly refused as inventing semantics for a source-truth gate. I am not proposing to weaken the gate; I am reporting it as the deciding mechanism, per this ruling's own instruction to preserve negative results.

## Confirmation

- Zero new Agent/Task/model calls.
- No second gate/comparator implementation — `finalize()`/`run_route()` reused by import.
- Original `opus_phase1_route_t1.json` and `isolated-receipts-t1/` untouched.
- Route grade RED is reported as-is; no gate was loosened to rescue the extraction.

**NEXT:** Lane 2 (F36 narrow async-capture repair via `SubagentStop`, off-live only) — not started this pass. Flagging as the next authorized item rather than combining a guard-code change with this grading report in one packet.
