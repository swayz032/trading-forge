# SEMANTIC-ROLE MIGRATION — `ratify-packet` (DOCUMENT ONLY, NOTHING IMPLEMENTED)

**R-432 · 2026-07-29 · no flag flipped · no artifact mutated · no re-extraction · no backtest.**
**[MEASURED] `backtests total = 0`.**

> **TREES.** Producer code read in the `extraction-100` worktree
> (`trading-forge/.claude/worktrees/extraction-100`, branch `extraction/100pct-evidence`) — **these
> files do not exist in the primary checkout.** Consumer code read in
> `wt-preflight-blockers-20260729` @ `83efd34e`, sha256-identical to `runtime-production` @
> `a6f92822`. **POPULATION: the live library, reported PER-VIDEO (40), never per-row (120).**
>
> ★★★ **ACCEPTANCE CRITERION, carried verbatim: success is that classifications match the
> source-supported FUNCTION of each condition — NOT that more strategies pass. A pass-rate is
> reported as an observation only and is never evidence of correctness.**

---

## 1 — THE EXACT LINE BEING REPLACED

`src/server/lib/graph-to-engine.ts`, inside `resolveConditionRole()`:

```ts
:93   if (!semanticRoleClassifierEnabled()) return inAndGroup.has(a.id) ? "confluence" : "spine";
:100  return inAndGroup.has(a.id) ? "confluence" : "spine";     // rules-1-5 AMBIGUOUS fallback
```

★★★ **`spine` is the else-arm of a topology test. Nothing in that expression reads the source.**
`:100` is the same expression again, reached when the new classifier declines to decide — **which
makes it the fallback that can silently reproduce the old behaviour under the new flag. See §5.**

**Roles NOT produced by this line** (assigned by atom TYPE in `compileToEngineSpec`, unchanged by
this migration): `:142-143` `trigger` on `ENTER`/`ENABLE_ENTRY` terminals — the same statement that
sets `entry_trigger_id` — and `:145` `invalidation`.

---

## 2 — THE DORMANT LABELLER, ITS FLAG, ITS CLASSES, AND THE EVIDENCE EACH USES

**FLAG:** `graph-to-engine.ts:75` — `process.env.TF_SEMANTIC_ROLE_CLASSIFIER === "true"`, **default
OFF**, documented *"Byte-identical-when-OFF"*. **[MEASURED] absent from `runtime-production/.env`
(grep count 0), and all 41 on-disk specs carry `extraction_pipeline_version: compiler-v3-union-1.0`
with NO `semantic_role_classifier` key — so the entire live library was labelled by the topology
heuristic.**

**CLASSES — `gate-strength.ts:53`:** `mandatory | optional | alternative | contextual`.
**MAPPER — `:300-307`:** `mandatory→spine · optional→confluence · alternative→or_branch ·
contextual→context`.

**THE DETERMINISTIC RULES — `classifyGateStrengthDeterministic():185-208`, in order, and every one
of them reads `atom.evidenceQuote`:**

| rule | condition | class |
|---|---|---|
| 1 | `CONTEXT_LANG` matches (any type) — scene-setting / narrative example / refuted strawman / UI artifact | `contextual` |
| 2 | type ∈ `{WAIT_CONFIRMATION}` **and** `MANDATORY_LANG` | `mandatory` |
| 3 | `ALT_LANG` (interchangeable-route framing) | `alternative` |
| 4 | `OPTIONAL_LANG` (bonus / enhancement framing) | `optional` |
| 5 | type ∈ `{WAIT_STRUCTURE, WAIT_BIAS, WAIT_RETEST, CONFIRM_DIRECTION, ENABLE_ENTRY, ENTER}` **and** `MANDATORY_LANG` | `mandatory` |
| 5b | `TRIGGER_LANG` (directional entry-trigger discourse, any type) | `mandatory` |
| 6 | none fired → `null` → **gemma adjudication** (`gemma4:e4b-it-qat`, DRI taxonomy, **the module's only network I/O**) — or, in the synchronous compiler, the `:100` topology fallback | — |

★★ **So the evidence is: the TEXT of the condition's evidence quote, plus the atom TYPE.** That is a
genuine semantic contract — it reads what the speaker said — which is exactly what `:93` does not.

### ★★★ 2a — THE BLOCKER THIS PACKET EXISTS TO SURFACE

**The classifier consumes `evidenceQuote`. [MEASURED, AR-397] in STORED artifacts the `evidence`
field is a POINTER (`T-<vid>-C####`) on 1347 of 2351 values — 57.3%.** A pointer contains no
language, so **every regex family fails, rules 1–5 return `null`, and `:100` falls back to the
topology heuristic.**

★★★ **CONSEQUENCE: a shadow run over stored artifacts WITHOUT resolving pointers would produce
labels that are ~57% identical to today's by construction, while appearing to exercise the new
classifier. It would look like "the new labeller mostly agrees" and would mean "the new labeller
mostly did not run."** ★★ **That is a false-green by construction, and defeating it is the single
most important control in this packet (§5-C).** ★ The classifier is designed to run IN-PIPELINE,
where `a.provenance.evidence_quote` is live text; the pointer form is a property of the stored
artifact.

### 2b — A ROLE-DOMAIN MISMATCH THE CONSUMER DOES NOT KNOW ABOUT

The new mapper can emit **`or_branch`** and **`context`**. **[MEASURED, `spec_execution_preflight.py:114-140`]
the consumer maps `spine`/`invalidation`→MANDATORY, `confluence`→OPTIONAL_CANDIDATE, and
**everything else → `UNKNOWN_REQUIREDNESS`, which BLOCKS.**

★★★ **So conditions reclassified `alternative` or `contextual` would move from a passing class into a
REFUSING one. The pass count can therefore FALL. That is fail-closed and correct, and it is stated
here so nobody reads a drop as a regression — and it is a second reason the acceptance criterion is
not pass-rate.** ★ **Whether `or_branch`/`context` deserve their own consumer classes is a SEPARATE
ruling and is explicitly out of scope.**

---

## 3 — SHADOW-MODE EVALUATION (stored strategies unchanged)

Compute flags-on classifications **out-of-band** and compare; **write nothing back.**
**Unit = VIDEO (40), not row (120)** — [MEASURED] all 40 triples are byte-identical, so per-row
counting inflates every figure 3×.

**Procedure.** For each of the 40 videos: load the stored `compiled_spec` · **resolve every pointer
to its clause text** via `clause-segmenter.ts:60 segmentTranscript` (§4) · call
`classifyGateStrengthDeterministic({type, object, evidenceQuote: RESOLVED_TEXT})` · map via
`gateStrengthToRole` · emit a per-condition row: `video · condition_id · type · object · old_role ·
new_class · new_role · rule_that_fired · evidence_text`. **Publish the rule-that-fired distribution,
including the `null`/rule-6 margin — a large margin is itself a finding.**

★ **No environment variable is set in any live path. The classifier is called DIRECTLY as a
function.** ★★ **Nothing is written to the DB, to `runtime-production`, or to any spec file.**

---

## 4 — TRANSCRIPT-GROUNDED GRADING

**[MEASURED, AR-397] 1458 of 1458 pointers resolve (100.0%), and the recorded `span` is byte-exact
on 1218 of 1238 cross-checked (98.4%).** So every condition can be graded against the words actually
spoken.

**Grade each classification against the RESOLVED clause**, doer ≠ grader, on the question *"does the
speaker's language make this condition required, optional, an alternative route, or scene-setting?"*
— **never** *"did the strategy pass."* ★★ **The 20 span disagreements (AR-397) must be excluded or
individually adjudicated before grading; a condition whose two provenance claims disagree cannot
ground a fidelity judgment.** ★ Sample size and selection are pre-registered before any run.

---

## 5 — CONTROLS, BOTH DIRECTIONS

**A · POSITIVE (must classify correctly, source-supported):** a genuine entry trigger → `mandatory` ·
an invalidation → unchanged `invalidation` (type-assigned) · a gate-language confirmation
(*"wait for that retest"*) → `mandatory` via rule 5 · a real session constraint → per its language ·
**a chart-navigation statement (*"let's go to the 4-hour and zoom in"*) → `contextual`** ·
an annotation → `contextual`.

**B · ★★★ NEGATIVE — THE ONE THAT MATTERS MOST: proof that non-rules are NOT promoted into
executable mandatory conditions.** Use the AR-393 exhibits as the fixture set — `'timeframe'`,
`'time frame'`, `'timeframe selection'`, `'1 hour chart'`, `'intraday time frames'` — **two of which
carry `role=spine` TODAY.** **PASS = none of them classifies `mandatory`. A single one promoted to
`mandatory` FAILS the migration**, because it would launder a chart parameter into a source-mandatory
execution rule with a semantic label attesting to it.

**C · ★★★ THE FLAGS-OFF CONTROL, AND THE ANTI-FALSE-GREEN DISCRIMINATOR.**
**C1 — flags-off must reproduce the current 120-row library EXACTLY, per condition, not in
aggregate.** Any difference means something other than the labeller changed, and the migration stops.
**C2 — the run must PROVE the new classifier actually decided.** Publish the count of conditions
where rules 1–5 fired versus where they returned `null` and fell back to `:100`. ★★★ **If the
fallback share is large, the comparison is measuring the OLD heuristic wearing the new flag's name
(§2a). A high agreement rate with a high fallback rate is a FAILED run, not a reassuring one.**
**C3 — a resolved-vs-unresolved A/B on the same conditions**, to demonstrate the pointer resolution
is doing real work: unresolved evidence must produce materially more rule-6/fallback outcomes.
Without C3, C2's numbers have no reference.

---

## 6 — IMMUTABLE ARTIFACT VERSIONING

Every artifact produced under the new labeller carries, in `extraction_provenance`:
`role_classifier: "gate-strength-v1"` · `role_classifier_flag: true` · the classifier source hash ·
and **per condition, the rule that fired** (`rule_1`…`rule_5b`, `rule_6_gemma`, `topology_fallback`).
★★★ **Old and new role semantics must never mix silently: any artifact lacking
`role_classifier` is topology-labelled, and any consumer comparing the two populations must
partition on that field.** ★★ **Existing artifacts are NOT mutated — the migration is
forward-only, by new extraction, never by in-place rewriting of a stored `compiled_spec`.**
★ **[MEASURED] the DB envelope currently DROPS `extraction_provenance` entirely** (on-disk artifacts
carry it; stored rows do not) — **so this versioning is unenforceable until the onboarding path
preserves that field, and that is a PREREQUISITE, not a follow-up.**

---

## 7 — ROLLBACK + COMPARISON

**Rollback:** the flag defaults OFF and is documented byte-identical-when-OFF; unsetting it restores
current behaviour with no data change. **No stored artifact is altered at any point, so there is
nothing to migrate back.** **Comparison:** artifacts are partitioned by the `role_classifier`
provenance field (§6); any cross-partition metric is labelled cross-version. ★ Stamp the classifier
version into the artifact rather than relying on timestamps.

---

## 8 — PROOF THAT NO REFUSAL IS SOFTENED

★★★ **This packet proposes NO change to any refusal.** `_MANDATORY_ROLES = {spine, invalidation}`,
`blocks_execution`, the `UNKNOWN_REQUIREDNESS` class, the empty-spine blocker and the confluence
fail-closed policy are ALL untouched. **The migration changes which conditions are LABELLED `spine`,
not what the guard does when it sees one.**
★★ **Directionally it can only add refusals** (§2b: `or_branch`/`context` fall into
`UNKNOWN_REQUIREDNESS`, which blocks).
★★★ **And the honest statement of what the finding does NOT license: proving `spine` is an invalid
proxy does not authorize relaxing it. Until validated classifications exist, the topology label stays
wired to a fail-closed guard — over-refusal is the safe direction of this error, and [MEASURED]
`backtests total = 0` means it costs nothing operationally today.**

---

## PREREQUISITES BEFORE ANY IMPLEMENTATION

★★★ **(a) the onboarding path must stop dropping `extraction_provenance`** (§6) — without it the
versioning contract cannot be enforced. **(b) the 20 span disagreements adjudicated** (§4).
**(c) an independent grader, fresh context, doer ≠ grader.** **(d) the advisor's word — this is a
document, and R-432 scoped it to a document.**

## WHAT THIS PACKET DOES NOT KNOW

★ **[NOT MEASURED]** how many of the 923 `spine` conditions would change class — **that is the
sizing question and it needs the §3 run, not an estimate.**
★ **[NOT MEASURED]** the rule-6 / ambiguous-margin rate on this corpus — **the single number most
likely to decide whether the deterministic rules are sufficient or gemma adjudication is on the
critical path.**
★ **[NOT MEASURED]** freeze status of the `extraction-100` worktree.
★ **[NOT MEASURED]** whether `classifyGateStrengthDeterministic`'s regex families were tuned on a set
that includes these 40 videos — **if they were, a shadow evaluation over the same corpus is not an
independent test, and that must be checked before any grade is believed.**

---

# AMENDMENT — R-433 (A) CONTAMINATION CHECK · (B) POINTER-RESOLUTION DESIGN

**2026-07-29 · document only · nothing run, no flag flipped.**

★ **Citation correction:** the regex families and `classifyGateStrengthDeterministic` live at
**`gate-strength.ts:185-208`**, not `graph-to-engine.ts:185-208`. `graph-to-engine.ts` holds the flag
(`:75`) and the topology line (`:93`/`:100`). Both files are in the `extraction-100` worktree.

## (A) ★★★ VERDICT: **CONTAMINATED.** The design corpus is 14 videos and ALL 14 ARE LIVE.

**The classifier documents its own split, so this was measured, not inferred.**
`gate-strength.ts:41` cites `docs/replay-results/corpus-v3-heldout-split-2026-07-05.json`; commit
`1521b467` (2026-07-05) is *"corpus-v3(steps2-4): **held-out split** + gate-strength classifier +
Gate 1 (FAIL, honest)"*; `15abe2d5` (2026-07-06) is iteration pass 2.

**[MEASURED, that split file]**
- `method`: `sha256(condition_id) low-byte mod 10 < 3 -> held-out` — deterministic, **per CONDITION**.
- `source_file`: `docs/replay-results/dri-audit-2026-07-05.json` · `total` **221** →
  `rules_design_count` **143** / `held_out_count` **78** (35.3%).
- sample design key: `75DJN5UVQnw||WAIT_SESSION:timeframe selection#0`.

**[MEASURED, overlap against the 40 live videos]**

| | |
|---|---:|
| distinct videos in the **rules-design** split | **14** |
| ★★★ of those, videos that are in the LIVE library | ★★★ **14 — all of them** |
| videos in the held-out split | 13 |
| ★★ videos in **BOTH** splits | ★★ **13** |
| ★★★ **live videos NEVER seen by the design split** | ★★★ **26** |

★★★ **THE PRE-REGISTERED ARM THAT FIRES: "tuned on a set that INCLUDES these 40 videos → the shadow
evaluation over the same 40 is NOT an independent test; it is a consistency check only and must be
labelled as one; a held-out corpus is required before any grade is believed."** It fires on the
strongest possible form of the condition — the design corpus is a *subset* of the live library.

★★ **AND THE SHARPER PROBLEM THE HEADLINE HIDES: the split is per-CONDITION, so 13 of the 14 videos
have conditions on BOTH sides. Video-level separation does not exist inside the design corpus — the
rule author saw text from the same videos whose held-out conditions would later grade the rules.**
★ The 2026-07-06 iteration explicitly disclaims tuning on the held-out set or on the
`snNkQSyWX4k`/`jlShztsY3oA` behavioural pairs, which is good discipline — **but it does not undo the
video-level leakage, because the design conditions themselves come from those same videos.**

### ★★★ THE CONSTRUCTIVE RESULT: A CLEAN HELD-OUT CORPUS ALREADY EXISTS

**26 of the 40 live videos were never seen by the design split** — a genuine held-out set, inside the
population we actually care about, at no extraction cost:

`1HFoStW_wsc · 7ieYBa7Z-Hg · E8Wg6tFPYjo · FAKWJ-1NlLE · LOcaRWcc1xI · N7SM8a7Dc9s · Qxlu8v_6G3Y ·
VTEQ2fhGLqE · WV1fyudd7fw · aHLIE_TXjpo · bQp37aD1JLE · dE4lPhAWke8 · dHmOosYof48 · deymRD3kSD0 ·
e5HQXYBUW-Q · gddYspvW0_w · h6TnE7QClJg · iU8ww5MC2FQ · l-2iKbcm5UI · lRMFcsqhYBU · mNcoaNdAyIE ·
nV9gknhy2Ew · qLtq73bTPBA · x1ydP8bC7OE · xTTDH5iRhJc · z3Qn3fBoe2I`

**REQUIRED PARTITIONING for the shadow run, from here on:**
**ARM-CLEAN (26 videos)** — the only arm whose grade may be called independent.
**ARM-CONTAMINATED (14 videos)** — run it, report it, and **label every figure from it a CONSISTENCY
CHECK, never a validation.** ★★ **The two arms must never be pooled into one accuracy number.**
★ **[SCOPE OF THE CLEAN CLAIM, stated so it is not over-read] the 26 are clean with respect to the
corpus-v3 rules-design split, which is the tuning input the classifier documents. I did not audit
every possible tuning input in the module's history — that is [NOT MEASURED], and a stronger claim
than "clean w.r.t. the documented design split" is not supported.**

## (B) POINTER-RESOLUTION DESIGN — resolve BEFORE classify

**Ordered steps, to be executed only when the shadow run is authorized:**
1. Per video, load `<video>.transcript.txt` and call the REAL
   `clause-segmenter.ts:60 segmentTranscript(t, "T-" + video.slice(0,4))`; build `id → {text, start,
   end}`. ★★ **Publish a CONTROL line proving the real function loaded** — a silently-stubbed runner
   is a known trap here.
2. Classify each `evidence` value's SHAPE: `plain (T-x-C####)` · `brace-set {a, b}` ·
   `range "A to B"` · `start:/end:` · `verbatim text` · `short non-pointer`.
3. **Resolve:** plain → that clause's text; brace-set / range / start-end → the referenced clauses'
   text concatenated in document order; verbatim → itself; **short non-pointer → itself, but FLAGGED
   `low-information` — [MEASURED] 1004 of 2351 values are non-pointer and 902 are ≤25 chars, and a
   regex family cannot fairly judge a 12-character string.**
4. **Resolution coverage gate:** pointer-shaped values must resolve at **100%** — [MEASURED, AR-397]
   1458 of 1458 do. ★★★ **If coverage is below 100% on the run, STOP and report; do not classify a
   partially-resolved corpus.**
5. Feed the RESOLVED text as `evidenceQuote` to `classifyGateStrengthDeterministic`.
6. **Record per condition:** `evidence_shape · resolution_status · resolved_char_len · rule_fired
   (rule_1…rule_5b | null) · gate_strength | null · mapped_role · old_role`.
7. **Publish the fired-vs-fallback split OVERALL and BROKEN DOWN BY `evidence_shape`.**
   ★★★ **The by-shape breakdown is the proof the resolution did work: if fallback rates are the same
   for pointer-shaped and verbatim evidence, the resolver did not change what the classifier saw, and
   the run is void.** This is the operational form of §5-C3.
8. **Exclude the 20 span-disagreement conditions** (AR-397) or adjudicate each first.
9. Grade **ARM-CLEAN only**; report ARM-CONTAMINATED separately and labelled.

★★ **Nothing in this design sets an environment variable in any live path — the classifier is called
directly as a function, over data read read-only.**
