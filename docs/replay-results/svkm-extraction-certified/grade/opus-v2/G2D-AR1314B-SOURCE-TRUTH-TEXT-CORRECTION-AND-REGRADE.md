# AR-1320A Lane B — Source-Truth Condition-Text Correction + Regrade

**Ruling followed:** AR-1320A §4 (Lane A: no existing revision seam found — see below; Lane B:
smallest explicit derived revision artifact; Lane C: same production grading path; Lane D: this
report). Zero new Agent/Task/model calls throughout.

**Script:** `scripts/g2d_ar1313b_text_correction_regrade_tmp.py`
**Output artifact:** `docs/replay-results/svkm-extraction-certified/grade/opus-v2/opus_phase1_route_t1_g2d_final_ar1314b.json`

## Lane A — existing revision seam search (repeated, broader than AR-1313's scope)

AR-1313's report searched `src/engine/extraction/` for revision/correction/amendment/role-link/
duplicate-of naming and found none. This pass repeated the search repo-wide:

- `**/*revision*.py` — no hits.
- `**/*correction*.py` — no hits.
- `**/*source_faithful*` — only `test_source_faithful_execution_mode.py`,
  `test_source_faithful_fvg_routing.py`, `test_source_faithful_stop.py` (execution-mode/stop-routing
  tests, unrelated to extraction-text revision).

No existing mechanism takes a certified extraction as immutable input and emits a successor
source-truth artifact with field-level provenance. Proceeding to Lane B per the ruling.

## Original (unchanged) source artifacts

- Extraction: `docs/replay-results/svkm-extraction-certified/sVkmZklJDHI.json`
  `extraction_sha256 = c37ff26f753449c35b6ec0402a3152dc287a8ae427eb0d86661b3fb43ec01823`
- Transcript: `src/engine/extraction/fixtures/source-evidence/sVkmZklJDHI.transcript.txt`
  `transcript_sha256 = df72444f70e8c79db0e1692867913f14d37c18fd063f681a2b562fe103ce99cc`
  (pinned identity per AR-1138/AR-1234; unchanged by this pass — verified via `git status --porcelain`
  showing neither file touched by this commit)
- Task index: `docs/replay-results/svkm-extraction-certified/o1-batch/batch_task_index.json`
  (unchanged; this pass reads it and deep-copies `conditions` before mutating the copy)

**Neither the original extraction JSON, the transcript, the frozen queue
(`isolated_fallback_queue_t1.json`), nor any isolated receipt was modified.** This report and its
paired output JSON are the only new files this pass wrote.

## Field-level corrections (exactly 4, each with literal transcript support)

| condition_ref | before | after | literal transcript evidence |
|---|---|---|---|
| `entry_sequence[1].rationale` | "The breakout confirms the market direction (up or down) for the trade." | "The breakout gives an indication of the market direction (up or down) for the trade." | `"...That gives us an idea of the direction in which the market wants to go for the day..."` — verbatim, transcript offset 10499. A hedge ("gives us an idea"), not a confirmation. Full-text search for a stronger "confirm(s)" statement tied to the breakout returns nothing; this is the only transcript sentence describing what the breakout tells the trader about direction. |
| `entry_sequence[2].rationale` | "The FVG provides a high-probability entry point after the initial directional breakout." | "The FVG provides an entry point after the initial directional breakout." | Full-transcript search for `probability` / `high-probability` / `high probability` returns **zero matches** — the term appears nowhere in the source. The trader's only nearby certainty statement is the opposite: `"...I do want to reiterate that this model is not perfect. You are going to lose on this model. You're going to lose on every single model, okay? Because there is no perfect entry model..."` (offset 19588) — an explicit disclaimer against any probability/certainty claim. "high-probability" is unsupported and removed; the grounded mechanical claim (FVG as the entry point following the breakout) is preserved. |
| `entry_sequence[3].rationale` | "Entering on the closure confirms the FVG structure and minimizes entry risk." | "Entering on the closure confirms the FVG structure." | Full-transcript search for `minimiz*` / `entry risk` returns **zero matches** — the phrase appears nowhere in the source. "and minimizes entry risk" is removed as an unsupported causal/risk claim. "confirms the FVG structure" is retained unchanged — GPT's F39 finding named only "minimizes entry risk" as unsupported, not the structural-confirmation clause, so only the proven clause is touched. |
| `confluences[0].description` | "The trade must be initiated during the 9:30 AM ET New York session." | "The trade must be initiated at 9:30 AM ET New York time." | `"This strategy needs to be traded at 9:30 a.m. Eastern time, New York time."` — the row's own pinned `transcript_quote` in the extraction, already literal. The source names a single point in time; "during the ... session" widened it into a duration/window the source never states. Corrected to name the point in time directly, with no window implication added or removed beyond what the source itself says. |

Untouched by design (not proven correctable in this lane):

- `entry_sequence[0].rationale` — AR-1313 flagged this as `OTHER_EXPLICIT_BLOCKER`: the condition
  text conflates two separate trader statements and AR-1313 could not fully justify a single
  correction class for it. No new evidence resolves that ambiguity in this pass, so it is left as-is
  rather than guessed at.
- `entry_sequence[1].action` / `confluences[1].description` (F37 upstream duplicate pair) — AR-1313
  confirmed no existing duplicate-role-linking seam exists under `src/engine/extraction/`; this pass
  did not re-search since AR-1320A does not name F37 as in-scope for this correction lane (§3.5 names
  it as a duplicate-authoring problem "must not be silently deduplicated," distinct from §4's
  source-text-correction lanes). Left `HELD_DUPLICATE_ROLE_AMBIGUITY`, unchanged.

## Regrade result (same pipeline: `g2d_finalizer.finalize()` -> `opus_phase1_route.run_route()`)

Same strict collision law, same relevance floor (0.10), same term-equivalence law, same fidelity
guard. No gate touched. No synonym/alias added. No second comparator. No pick-the-greener fallback.

**Grade: RED. Accepted: 6/12** (AR-1313's regrade was RED, 4/12).

`disposition_counts`: `ACCEPTED_PENDING_CERTIFICATION` 6, `REFUSED_RELEVANCE` 4,
`HELD_DUPLICATE_ROLE_AMBIGUITY` 2.

| condition_ref | disposition | gate | note |
|---|---|---|---|
| `confluences[0].description` | ACCEPTED_PENDING_CERTIFICATION | all_gates | was `RED_SOURCE_FIDELITY` (F38) — now clears |
| `confluences[1].description` | HELD_DUPLICATE_ROLE_AMBIGUITY | span_collision | unchanged (F37, untouched by design) |
| `entry_sequence[0].action` | ACCEPTED_PENDING_CERTIFICATION | all_gates | unchanged from Lane 1/AR-1313 |
| `entry_sequence[0].rationale` | REFUSED_RELEVANCE | evidence_relevance | unchanged (`OTHER_EXPLICIT_BLOCKER`, untouched by design) — own=0.016, below the 0.10 floor |
| `entry_sequence[1].action` | HELD_DUPLICATE_ROLE_AMBIGUITY | span_collision | unchanged (F37, untouched by design) |
| `entry_sequence[1].rationale` | ACCEPTED_PENDING_CERTIFICATION | all_gates | was `CERTAINTY_INFLATION` RED — now clears (text + AR-1313 evidence correction together) |
| `entry_sequence[2].action` | REFUSED_RELEVANCE | evidence_relevance | unchanged — `MISGROUNDED_NOT_DISCRIMINATING`, a separate pre-existing relevance defect independent of any wording |
| `entry_sequence[2].rationale` | REFUSED_RELEVANCE | evidence_relevance | text corrected (F39a) but still `MISGROUNDED_NO_OVERLAP` — the row's isolated evidence quote does not ground *any* version of this condition's text; this is a separate, still-open evidence-packaging/grounding defect, not caused by or fixed by the wording correction |
| `entry_sequence[3].action` | ACCEPTED_PENDING_CERTIFICATION | all_gates | unchanged from Lane 1/AR-1313 |
| `entry_sequence[3].rationale` | REFUSED_RELEVANCE | evidence_relevance | text corrected (F39b) but still `MISGROUNDED_NOT_DISCRIMINATING` — same class of separate, still-open evidence-grounding defect |
| `stop.rationale` | ACCEPTED_PENDING_CERTIFICATION | all_gates | unchanged from Lane 1/AR-1313 |
| `targets[0].rationale` | ACCEPTED_PENDING_CERTIFICATION | all_gates | unchanged from Lane 1/AR-1313 |

Remaining RED/HOLD classification (per AR-1320A §4 Lane D item 7):

- `entry_sequence[0].rationale` — **source wording / unresolved classification** (`OTHER_EXPLICIT_BLOCKER`, not corrected this pass — ambiguous, not proven).
- `entry_sequence[1].action`, `confluences[1].description` — **duplicate authoring** (F37, HOLD intentional, no seam exists).
- `entry_sequence[2].action` — **relevance discrimination** (fits a sibling FVG condition at least as well; a structural limit of term-overlap scoring between two closely related conditions, per AR-1313's proof).
- `entry_sequence[2].rationale`, `entry_sequence[3].rationale` — **evidence packaging / relevance grounding**: the wording defect is now fixed, but each row's isolated-recovery quote still does not ground the (corrected) condition text well enough to clear the 0.10 relevance floor. This is a distinct, still-open defect from the source-truth wording defect this pass closed.

## Confirmation

- Zero new Agent/Task/model calls.
- No synonym/alias added; no relevance/fidelity/collision/term-equivalence gate modified or bypassed.
- Original extraction, transcript, frozen queue, and all isolated receipts unchanged (new files only:
  this report + the new regrade output JSON + the new script).
- All 4 corrections directly supported by literal transcript text, verified by full-document search
  (not paraphrase-of-paraphrase).
- Result remains RED. Reported as-is: 4/12 -> 6/12, a real improvement, not a forced green.

**NEXT:** the two still-`REFUSED_RELEVANCE` rows whose text is now correct
(`entry_sequence[2].rationale`, `entry_sequence[3].rationale`) need their own evidence-grounding
diagnosis — separate from this wording-correction lane — before the route can advance further.
`entry_sequence[0].rationale`'s classification remains open. F37's duplicate-role pair has no
resolution path without a new authoring seam, which is out of this lane's scope.
