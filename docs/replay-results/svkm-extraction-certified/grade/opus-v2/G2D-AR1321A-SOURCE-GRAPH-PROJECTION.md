# AR-1321A — Versioned Source-Graph Certification Projection

**New generic module:** `src/engine/extraction/source_graph_projection.py` (PROJECTION_VERSION
`source-graph-projection-v1`) — reuses `batch_locator`, `span_collision`,
`evidence_antecedent.bind_qualifier_to_antecedent`, `evidence_relevance.evaluate_evidence_relevance`,
`source_fidelity_guard.check_condition_fidelity`, and `opus_phase1_route._same_requirement` /
`_validate_composition_specs` BY IMPORT. Contains no fixture-specific string (no video ID, no
strategy vocabulary) — every text/quote/bucket assignment is caller-supplied.

**Fixture-specific driver:** `scripts/ar1321a_source_graph_projection_driver_tmp.py` — the sVkm
adjudications live here, per AR-1321A §6.3.

**Controls:** `scripts/ar1321a_projection_controls_tmp.py`

**Output artifacts:**
`docs/replay-results/svkm-extraction-certified/grade/opus-v2/source_graph_projection_v1.json`,
`.../ar1321a_projection_controls.json`

Zero new Agent/Task/model calls throughout. Original pinned extraction, transcript, frozen queue,
and isolated receipts are read-only inputs, unmodified (verified: neither
`sVkmZklJDHI.json` nor `batch_task_index.json` nor any receipt file appears in `git status`
after this work).

## RESULT

**`GREEN_PENDING_CERTIFICATION` — 9/9 canonical nodes accepted.** Conservation:
`12 input refs = 9 canonical + 1 alias + 2 preserved_metadata`, verified programmatically (the
module raises on any mismatch; it did not raise). **This is a CERTIFICATION CANDIDATE, not a
self-issued certificate** — same standing caveat every route in this pipeline carries.

## Conservation (9 + 1 + 2 = 12)

**9 canonical gate nodes**, all `ACCEPTED_PENDING_CERTIFICATION` under role-bounded relevance:

| ref | represents | text change from AR-1314B |
|---|---|---|
| `entry_sequence[0].action` | 9:30 five-minute range definition | unchanged |
| `entry_sequence[1].action` | 1m candle closes outside range (breakout) | dropped unsupported "established" (new `RED_SOURCE_FIDELITY` finding this pass caught — see below) |
| `entry_sequence[1].rationale` | **RETYPED**: breakout-side direction selector | was "confirms" prose; now hedge-phrased + explicit short/long mapping |
| `entry_sequence[2].action` | FVG sequence prints outside range | near-literal; antecedent-bound to `entry_sequence[0].action` for "the range" |
| `entry_sequence[3].rationale` | **RETYPED**: FVG-validity prerequisite (3rd candle printed) | was "confirms...minimizes..." prose; now the literal validity passage |
| `entry_sequence[3].action` | enter on 3rd candle close | unchanged |
| `confluences[0].description` | 9:30 ET NY timing | AR-1314B correction, unchanged this pass |
| `stop.rationale` | FVG-candle-extreme wick stop | unchanged |
| `targets[0].rationale` | fixed 2R target | unchanged |

**1 alias:** `confluences[1].description` → `entry_sequence[1].action`. Both isolated-recovery
agents independently located the byte-identical literal span `"the candles need to close outside
of this 5m minute range"` — mechanically verified via the same `_same_requirement` Jaccard-overlap
test the collision gate already used to classify this pair `HELD_DUPLICATE_ROLE_AMBIGUITY`
(reused by import, not reimplemented). Original text/quote/span preserved on the alias outcome
record.

**2 preserved non-executable metadata:** `entry_sequence[0].rationale` (AR-1313:
`OTHER_EXPLICIT_BLOCKER`, unresolved), `entry_sequence[2].rationale` (AR-1313/AR-1314D:
`EVIDENCE_SET_EXHAUSTED / CAUSE_NOT_YET_DISCRIMINATED`). Both refused by the mechanical
role-check unless their claim-role is `rationale` — verified by the mutation control below.

## A finding this pass caught and fixed (not pre-planned)

`entry_sequence[1].action`'s ORIGINAL text ("...outside of the **established** 5-minute range...")
failed `source_fidelity_guard` on its first run: `UNSUPPORTED_CERTAINTY` on "established" — the
source only says the trader is "waiting for" candles to print outside the range, never that the
range was "established" in that stronger sense. Not something AR-1321A named explicitly; found by
actually running the pipeline against real evidence and reading the real finding, not assumed.
Corrected to "the 5-minute range" (matching how `entry_sequence[0].action` already describes the
same object). Flagging this per the standing "findings against yourself / real findings only"
rule — a rushed version of this packet could have missed it.

## Role-bounded relevance, scored

| ref | own score | role pool size | passes |
|---|---|---|---|
| `entry_sequence[1].rationale` | 0.417 | 3 rivals (rationale) | yes, `best_rival=0.0` |
| `entry_sequence[2].action` | 0.509 (rival 0.297, `entry_sequence[3].action`) | 3 rivals (action) | yes — independently confirms AR-1321A §5's own estimate ("approximately 0.509... versus 0.297") |
| others | all pass; see `source_graph_projection_v1.json` for exact per-row scores | — | yes |

Module verified free of fixture-specific strings (same check pattern `test_evidence_relevance.py`
already asserts on its own module): `svkm`, `fair value`, `nasdaq`, `9:30`, `fvg`,
`risk-to-reward`, `downside`, `upside` — none present in `source_graph_projection.py`'s source.

## Antecedent composition (the one explicit cross-node link this pass built)

`entry_sequence[2].action`'s "the range" bound to `entry_sequence[0].action`'s own literal span
via `evidence_antecedent.bind_qualifier_to_antecedent` (imported, unmodified): entity=`range`,
definitional marker=`gives` (from "...that now gives me is a range on the five minute"), order
holds (antecedent span ends before the reference), no intervening redefinition detected. Bound.

`entry_sequence[1].action`'s two qualifiers ("one minute" + "close outside the range") were **not**
composed via this mechanism — both already co-occur in one contiguous literal passage (transcript
offset 9294–9512, verified `in transcript` before use), so a single wider literal quote carries
both facts without needing a cross-node antecedent link. Noting this explicitly rather than
silently choosing the simpler path: AR-1321A §6.6 asked that this node "carry both... through
literal source evidence/dependency" — this satisfies "literal source evidence"; whether GPT wants
the *dependency* mechanism used here too (even though both qualifiers sit in one span) is an open
question this report surfaces rather than decides.

The bidirectional direction-selector's second worked example (upside break → buy, transcript
offset ~18166–18268) is carried as `extra_evidence_by_ref` — a literal-substring-verified
supplementary span that feeds `source_fidelity_guard` alongside the primary (downside) quote, but
is NOT scored by relevance (relevance runs on the primary span only, same
`evaluated_on: primary_span_only` scoping `opus_phase1_route.py` already documents for
composition). This is a new, narrower mechanism than antecedent composition — it is not a deictic
"earlier definition, later reference" relationship, just two independent literal spans supporting
one bidirectional claim — and its only self-check is that each extra span is a literal substring
of the pinned transcript.

## AR-1321A §7 checklist — exact status, not narrated as complete

| # | requirement | status |
|---|---|---|
| 1 | 12-ref conservation into 9+1+2 | **DONE** — enforced programmatically, verified it raises on mismatch (see controls) |
| 2 | all 9 canonical pass role-bounded relevance | **DONE** — 9/9, scores in output artifact |
| 3 | all 9 canonical zero fidelity findings on complete evidence | **DONE** — 9/9 `ACCEPTED_PENDING_CERTIFICATION` means `fidelity_findings=[]` for each (one real finding surfaced and was fixed mid-pass, see above) |
| 4 | alias pair = one predicate, two preserved provenance refs | **DONE** — `confluences[1].description` outcome carries `alias_of`, `original_condition_text`, `original_quote`, `original_char_span` |
| 5 | negative control: alias between different requirements refused | **DONE** — `stop.rationale`/`targets[0].rationale` mutation refused, `ALIAS_REFUSED`, overlap=0.000 |
| 6 | mutation control: excluding action/description/stop/target as metadata refused | **DONE** — `entry_sequence[0].action` mutation refused, `PRESERVED_METADATA_REFUSED` |
| 7 | char-19546 disclaimer rejected for every canonical node | **DONE** — re-verified under the NEW role-bounded pools specifically (AR-1320B only checked the old flat pool), 9/9 pass |
| 8 | generic same-role quote reused across two actions stays rejected | **DONE** — synthetic generic quote tested against all 4 canonical actions under role-bounded rivals, rejected in all 4 |
| 9 | 0.10 floor and term-equivalence table byte-unchanged | **DONE** — `git diff --stat` on both files is empty |
| 10 | direction/range/breakout-close/FVG-outside/validity/entry-close/wick-stop/2R target exist as linked facts | **PARTIAL** — all 9 exist as canonical facts; only ONE explicit cross-node link was built (`entry_sequence[2].action` → `entry_sequence[0].action`). `entry_sequence[1].action`'s two qualifiers are co-located in one literal span rather than linked via composition — flagged above as an open question, not silently resolved either way |
| 11 | two independent zero-call runs emit byte-identical artifacts | **DONE** — ran the driver twice; SHA-256 of `source_graph_projection_v1.json` identical both times: `0d2a41fd585e10bc0f07dcbe2fa35dca8a63974400b54ef39baa523dd6a0cfb9` |
| 12 | AR-1314B comparison is a real hash comparison, or the claim is dropped | **N/A, correctly scoped** — this report makes no "byte-identical to AR-1314B" claim at all (different artifact); where THIS report claims reproducibility (item 11) it is a full-file SHA-256 comparison, not grade+count, directly per the F43 correction |
| 13 | focused + neighboring relevance/collision/antecedent/fidelity/finalizer/route suites green | **DONE, with one disclosed pre-existing exception** — `pytest -k "antecedent or fidelity or collision or finalizer or opus_phase1_route or g2d"` + `test_evidence_relevance.py`: **291 passed, 5 skipped, 3 failed**. All 3 failures are in `test_g2d_real_queue_preflight.py` and are the SAME pre-existing condition AR-1320A already diagnosed this session (the fixture assumes a virgin 8-ready/0-spent queue; the real receipt directory now legitimately contains the AR-1311/1312 completed receipts). Not caused by, or related to, this pass's changes — no file this pass touches is imported by that test. Not fixed here; AR-1320A explicitly forbids treating the real receipts as something to reconcile away. |
| 14 | GitHub CI reported separately from local tests | **CI: NONE.** No combined-status checks or workflow runs exist for this repository's pushes in this campaign; all evidence above is local pytest + direct script execution, not CI. |

## What this does NOT claim

Not a certificate. Not proof the 9 canonical facts are the correct or complete executable
representation of the strategy — only that each cleared its mechanical/relevance/fidelity gates
under the new role-bounded pool with zero fabricated evidence. Item 10's open question (explicit
composition vs. co-located literal span for `entry_sequence[1].action`) is surfaced, not resolved,
pending GPT's read. `entry_sequence[2].rationale`'s classification remains
`EVIDENCE_SET_EXHAUSTED / CAUSE_NOT_YET_DISCRIMINATED` from AR-1314D/AR-1320B — not re-tested under
role-bounded rivals in this pass because it is a preserved-metadata ref, outside the 9-canonical
denominator by design, not because the question was avoided.
