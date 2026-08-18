# AR-1322A — source-graph-projection-v2 Repair

Supersedes `G2D-AR1321A-SOURCE-GRAPH-PROJECTION.md` (v1, rejected). **Not a rewrite** — v1's
driver, artifact, and report remain committed history exactly as AR-1322A required
("do not rewrite the rejected v1 artifact as if it never existed"). This report cites v1's exact
committed hashes where relevant and states what changed.

**New driver:** `scripts/ar1322a_source_graph_projection_v2_driver_tmp.py` — factored into
`build_record()` (shared by the CLI and the permanent test module, so they cannot silently drift
apart) + a thin `main()`.

**New permanent tests:** `src/engine/tests/test_source_graph_projection.py` — 19 tests, all
passing, including regression witnesses named for the exact F49/F51/F50 findings below and an
end-to-end integration test against the real sVkm v2 build.

**Module version bump:** `source-graph-projection-v1` → `source-graph-projection-v2` in
`src/engine/extraction/source_graph_projection.py` (same file; module extended, not replaced).

**Output artifact:**
`docs/replay-results/svkm-extraction-certified/grade/opus-v2/source_graph_projection_v2.json`

Zero new Agent/Task/model calls throughout.

## RESULT

**`GREEN_PENDING_CERTIFICATION` — 9/9 canonical accepted, graph complete (9/9 canonical nodes
reachable from the declared root, 0 unreachable).** Still a certification CANDIDATE, not a
self-issued certificate.

## Every AR-1322A finding, and exactly what changed

### F47 — checklist honesty
This report states pass/fail per item in the table below, same discipline as v1, corrected where
v1 was wrong (F52).

### F48 — direction evidence now contains the actual words it claims
v1's `entry_sequence[1].rationale` extra evidence was "we have our break to the upside" — no
`short`, `long`, or `buy`. **Replaced** with two literal spans that contain the actual order-type
words:

- downside → short: `"...it means that the price is going down. So, we want to be taking a
  short"` (transcript offset 10892, verified literal)
- upside → buy: `"So we can go ahead and get this one ready for a buy."` (transcript offset
  18922, verified literal)

Condition text changed from "...an upside break is taken long" to "...taken as a buy" — the
source's own word, not an invented "long" normalization (GPT permitted recording a normalization
instead; using the literal word directly needs no normalization ledger entry at all). Re-ran the
full pipeline: **no new fidelity finding**, row still `ACCEPTED_PENDING_CERTIFICATION`. Permanent
regression witness: `test_real_svkm_v2_projection_is_green_9_of_9_with_complete_graph` asserts
both `"short"` and `"buy"` are literally present in the row's `evidence_quotes`.

### F49 — the fail-open metadata guard is closed, mechanically, not by comment
Root cause: `_eligible_for_preserved_metadata` (formerly inline in `_validate_projection_spec`)
checked `_claim_role(ref) == "rationale"`, which is also true for `stop.rationale` and
`targets[N].rationale`. **Fixed**: new narrow predicate `_eligible_for_preserved_metadata()`
matches only `^entry_sequence\[\d+\]\.rationale$` — `_claim_role` itself now carries an explicit
docstring warning against reuse for this decision. **Four independent mutations**, each its own
isolated projection run (not one shared mutation that stops at the first exception):
`entry_sequence[0].action`, `confluences[0].description`, `stop.rationale`,
`targets[0].rationale` — all four refused, verified in
`scripts/ar1321a_projection_controls_tmp.py` (updated) and permanently in
`test_source_graph_projection.py::test_F49_mutation_excluding_action_or_stop_as_metadata_is_refused`
(action + stop; description + target coverage lives in the updated controls script against the
real 12-ref fixture, since the minimal pytest fixture doesn't carry those roles).

### F50 — the receipt is now self-contained
`ProjectionSpec` gained `correction_ledger: dict[ref, {original_condition_text, authority}]`.
`run_projection()` computes (never trusts a caller-supplied hash) `original_condition_text_sha256`
and `projected_condition_text_sha256` for **every** outcome, embeds `quote_sha256` on every quoted
outcome, `evidence_quote_sha256` lists, `antecedent_quote_sha256` on composition records, and
`original_quote_sha256` on the alias outcome. Verified against ground truth: the driver's ledger
entry for `entry_sequence[1].rationale`'s *original* text hashes to
`4de8dfed136c14429198063df3717b7002098fca553cc05ab6c18d9185f000a8` — the SAME
`condition_text_sha256` already recorded for that ref in the pinned
`docs/replay-results/svkm-extraction-certified/o1-batch/batch_task_index.json` (independently
cross-checked, not merely asserted). The alias outcome now also **refuses** (raises
`ALIAS_EVIDENCE_REFUSED`) if its own evidence is missing or non-literal, closing the "null
provenance" gap F50 named.

### F51 — an explicit, validated dependency graph
New `GraphEdge` dataclass + `validate_graph_edges()` (generic, structural-only — no fixture
vocabulary; the function never inspects what an `edge_type` string means, only ref existence,
DAG-ness via DFS cycle detection, and forward reachability from declared roots). The sVkm driver
declares 9 edges expressing exactly the order GPT named: timing → range → breakout-close → {
direction selector, FVG-outside } → FVG-validity → entry-close → { stop, target }, plus the F37
alias edge. Root = `confluences[0].description`. **All 9 canonical nodes are reachable** — the
committed artifact's `graph.complete` is `true`, `graph.unreachable_refs` is `[]`. `grade` now
requires graph completeness in addition to 9/9 acceptance (verified by the new
`test_grade_is_RED_when_graph_incomplete_even_if_all_canonical_accepted` regression witness).
The one-minute qualifier for `entry_sequence[1].action` remains a single co-located literal quote
(GPT explicitly said this is acceptable and does not need composition) — the graph edge into it
from `entry_sequence[0].action` still exists and is validated, independent of that evidence-level
choice.

### F52 — corrected, and the mechanism that caused it is fixed at the source
Independently reproduced: v1's report claimed `entry_sequence[1].rationale` own=`0.417`; the
actual committed v1 artifact recorded `0.2768166089965398`. Root cause found by direct comparison:
the probe script that produced `0.417` omitted `source_document=transcript`, so it scored
UNWEIGHTED term overlap instead of the real rarity-weighted production score. **Every score in
this report is pulled directly from the committed v2 JSON via a script that reads the artifact
file, never from a standalone probe with different parameters** (`scripts/ar1322a_pull_scores_tmp.py`).
`entry_sequence[1].rationale`'s real v2 score (text changed slightly for the buy/short fix):
own=`0.2867383512544803`, best_rival=`0.0`. `entry_sequence[2].action` unchanged from v1:
own=`0.5093457943925234`, best_rival=`0.29685621027314896` (still independently confirms
AR-1321A's own ~0.509/0.297 estimate).

Hash methodology fixed at the source: the v2 driver opens the output file with `newline="\n"`
so it writes canonical LF bytes directly — no CRLF worktree normalization to diverge from. Ran
the driver twice; hashed the file exactly as written both times:
`f3ba635e2eefac2092b0fa337b2e95dfefde9757674487c409855126ffca5853` (identical both runs — this is
the byte-identity claim for the ACTUAL file bytes, item 11, not a grade+count summary).

### F53 — durable test surface + frozen RED witness reference
19 new permanent tests in `src/engine/tests/test_source_graph_projection.py` (all passing),
covering conservation, F49's regression witness, alias negative/literal-evidence controls, graph
cycle/reachability/grade-gating, self-verifying provenance hashing, the no-fixture-string
discipline, and an end-to-end integration test against the real build.

**Frozen AR-1314B RED witness, cited by exact committed hash** (per F53 item 1 — referenced, not
re-verified or touched): `opus_phase1_route_t1_g2d_final_ar1314b.json` at committed SHA-256
`18fe5e8c68785d1660905150c128729f3c622b0afed0138995812283a19f8093`, `grade=RED`,
`accepted_count=6`, with exactly these 4 `REFUSED_RELEVANCE` + 2 `HELD_DUPLICATE_ROLE_AMBIGUITY`
refs: `entry_sequence[0].rationale`, `entry_sequence[2].action`, `entry_sequence[2].rationale`,
`entry_sequence[3].rationale` (refused); `entry_sequence[1].action`, `confluences[1].description`
(held). This is the exact population the projection's role-bounding + retyping + alias mechanism
resolves.

**`test_g2d_real_queue_preflight.py` made hermetic** (F53 item 3): its `sandbox` fixture no longer
`shutil.copytree`s the real receipts directory (which now legitimately, permanently contains the
8 completed AR-1311/1312 receipts and made the fixture's virgin-state assertions stale, not
wrong). It now copies only the real `README.md` (byte-identical shape) into a fresh directory —
the queue.json copy is unchanged (still the real committed file). **No real receipt was deleted,
rewritten, or reconciled.** Result: `test_g2d_real_queue_preflight.py` now **6/6 passing** (was
3 failed / 3 passed).

## Full regression suite (F53 item 3 requirement: genuinely green, not "green with an exception")

```
pytest src/engine/tests/test_evidence_relevance.py src/engine/tests/ \
  -k "antecedent or fidelity or collision or finalizer or opus_phase1_route or g2d"
294 passed, 5 skipped, 0 failed
```

Plus the new permanent module standalone: `pytest src/engine/tests/test_source_graph_projection.py`
→ **19 passed**.

**CI: NONE.** No GitHub combined-status checks or workflow runs exist for this repository's
pushes in this campaign — all evidence above is local pytest + direct script execution.

## AR-1322A §3 checklist

| item | requirement | status |
|---|---|---|
| A | fixture spec is data (correction ledger), not hidden script state | **DONE** — `ProjectionSpec.correction_ledger`, self-verifying hashes computed by the module |
| B | direction evidence repaired with real short/buy spans | **DONE** — F48 above |
| C | metadata exclusion fails closed, 4 independent mutations | **DONE** — F49 above, narrow regex predicate + 4 separate isolated mutation runs |
| D | explicit validated graph | **DONE** — F51 above, 9 edges, DAG + full reachability verified |
| E | GREEN requires the whole contract | **PARTIAL, precisely scoped** — `grade` now requires 9/9 + graph completeness (checkable in one run); determinism, controls, and neighboring-suite green are verified EXTERNALLY to `run_projection()` and reported in this document, not folded into the function's return value. This split is a design choice, not an oversight: a single function call cannot itself re-run pytest or diff two of its own invocations. |
| F.1 | freeze/reference old RED witness by hash+identities | **DONE** — above |
| F.2 | permanent focused tests | **DONE** — 19 tests, `test_source_graph_projection.py` |
| F.3 | hermetic preflight test, no receipt reconciliation | **DONE** — `sandbox` fixture repaired, 6/6 passing, real receipts untouched |
| F.4 | two zero-call runs, canonical LF hash, verify against committed bytes | **DONE, fully closed.** Two local runs: identical `f3ba635e2eefac2092b0fa337b2e95dfefde9757674487c409855126ffca5853`. After pushing (`25c57055`), fetched `origin/claude/worker1-h1-20260815:docs/replay-results/svkm-extraction-certified/grade/opus-v2/source_graph_projection_v2.json` directly and hashed those bytes: **identical**, `f3ba635e2eefac2092b0fa337b2e95dfefde9757674487c409855126ffca5853`. The reported hash equals the file on the remote branch, not merely the local one. |
| F.5 | correct the direction score table | **DONE** — F52 above, scores pulled from committed artifact only |
| F.6 | report CI separately | **DONE** — `CI: NONE` stated above, explicitly not conflated with local-test green |

## What this does NOT claim

Not a certificate. Not proof of executable completeness beyond the 9 canonical facts plus the
validated graph order among them. `entry_sequence[0].rationale`'s classification remains open
(AR-1313: unresolved, insufficient evidence); `entry_sequence[2].rationale` remains
`EVIDENCE_SET_EXHAUSTED / CAUSE_NOT_YET_DISCRIMINATED`; neither was re-tested this pass (out of
the 9-canonical scope by design, not by avoidance). F37's duplicate pair is represented as an
explicit alias, not deduplicated.
