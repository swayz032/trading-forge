# GRADE — Independent reading of "terminal acceptance failure" in `P0PC.acceptance`

**Date:** 2026-08-03
**Grader:** accuracy-validator (independent; see §0 lineage declaration)
**Mode:** DEFINITIONAL adjudication of a written acceptance criterion
**Tree:** `C:\Users\tonio\Projects\wt-h1-wave4-20260712`
`git rev-parse --git-common-dir` → `C:/Users/tonio/Projects/trading-forge/trading-forge/.git` (linked worktree, law 10 discharged)
**Tree HEAD at grade time:** `6691921e94b66d5ddb3a02ea6f7831a772ac8d90`

## 0. Lineage declaration (required before any band is read)

My own lineage has graded objects in this cluster: `GRADE-P0PC-4D-READING`, `GRADE-P0PC-4D-READING-B`,
`GRADE-4D-POPULATION`, `GRADE-P0PC-TRANSITION`, `GRADE-P0PC-PARTITION` (all 2026-08-02). **I did not read
any of them while forming this verdict.** Every finding below was derived from the pinned object and its
referenced documents directly. Where the campaign record later turned out to agree with me, I say so and
mark it `CORROBORATED` — never as a source. Nothing here is inherited.

**I did not at any point consider which reading makes any node pass, fail, or transition.** No such
reasoning was formed and therefore none had to be discarded. Node status does not appear below.

---

## 1. The authoritative object, pinned

| item | value |
|---|---|
| path | `docs/designs/V4-PHASE1-EXECUTION-GRAPH-2026-08-02.json` |
| blob claimed by brief | `876c3a230d51815f49f98c36ea4109fe0b236b97` |
| blob at HEAD (`git rev-parse HEAD:<path>`) | `876c3a230d51815f49f98c36ea4109fe0b236b97` ✅ |
| blob of worktree file (`git hash-object`) | `876c3a230d51815f49f98c36ea4109fe0b236b97` ✅ |
| size | 29698 bytes, 846 lines |

Subject blob is identical at all three sites. `[MEASURED HERE]`

### 1.1 `P0PC.acceptance` — IN FULL AND VERBATIM

> The six populations are disjoint and sum to the frozen 52; surface-invalid rows are inadmissible,
> mutation-as-type-error rows name the type checker, and only surface-valid fixture-valid rows may credit
> 1b-S. Type-only identifiers stay silent while the same spelling in value position is exclusively
> FREE_REF, with POSITION_UNCLASSIFIED fail-closed. Fixture scaffolding preserves emitted behavior. The
> effective compiler-emitter-loader tuple is an input; one source is executed as CJS and ESM; exactly one
> callable project export is required; every terminal acceptance failure exits non-zero after evidence
> collection while the restored control exits zero.

`sha256(acceptance)` = `fc5e0f9ce084…` `[MEASURED HERE]`

### 1.2 The clause is external-authored and has never been edited

The acceptance string is **byte-identical across all five revisions** of the graph
(`6d8c4f20` → `0f035ab7` → `a23f62f0` → `8151560c` → `27448ee2`), same `sha256 fc5e0f9ce084…`, final clause
present in the first landing, `FAILURE_CLASSES` absent in every one. `[MEASURED HERE]`

The first landing commit `6d8c4f20` states the graph was copied from an external candidate and that the
campaign refreshed **"only the freshness fields"**; the object's own `authority.status` is
`"external-advisor candidate for Fable adoption"`. `[ARTIFACT-SOURCED]`

**Consequence:** the clause was written by a party outside the implementation lane, and no campaign edit
has ever adjusted it. Any reading that requires the author to have been reaching into repository
implementation internals must carry that burden explicitly.

---

## 2. The prior measurement — RE-RUN, NOT INHERITED

**Claim on record:** the literal `FAILURE_CLASSES` appears nowhere in the graph JSON, positive-controlled
by confirming `terminal acceptance failure` is present on the same surface.

**VERIFIED — and I replaced the positive control with a stronger one.**

Two non-overlapping paths:

- **Path 1 — byte-level `grep -F` on the pinned blob:** `FAILURE_CLASSES` → **0**; `FAILURE` → **0**;
  `failure_class` → 0; case-insensitive `failure[_ ]?class` → **no match**.
- **Path 2 — structural walk over the parsed object** (independent of byte/line layout; covered
  **528 keys, 551 strings, 16 277 string chars**): `FAILURE_CLASSES` → **0 occurrences in any key or any
  value**.

**Positive controls — the control on record was too weak.** The prior pass controlled with
`terminal acceptance failure` (→ present), which proves only that the surface is searchable. That does not
exclude the possibility that the method or the surface systematically lacks *identifier-shaped* tokens. I
therefore controlled with two tokens **of the same lexical class as `FAILURE_CLASSES`** (SCREAMING_SNAKE
implementation identifiers):

| control token | occurrences | location |
|---|---|---|
| `FREE_REF` | **1** | `$.nodes[2].acceptance` |
| `POSITION_UNCLASSIFIED` | **1** | `$.nodes[2].acceptance` |
| `terminal acceptance failure` | 1 | `$.nodes[2].acceptance` |
| `zzz_absent_control_zzz` (negative) | 0 | — |

Both positive controls land **inside the very field under test**. The method demonstrably finds
SCREAMING_SNAKE implementation identifiers in `P0PC.acceptance`. The absence of `FAILURE_CLASSES` is
therefore **neither a method artifact nor a surface artifact.** `[MEASURED HERE]`

### 2.1 What this implies for reading (A) — stated precisely

It refutes the *naming* form of (A) and nothing more. The acceptance field **names implementation
identifiers verbatim when it means them** — twice, in the same sentence group. It did not name this one.
That is strong evidence against "the clause names the array", and it is the evidence the desk already had.

It does **not** by itself refute the *definite-description* form of (A) — that the clause **refers** to the
array without naming it. The same field contains `"mutation-as-type-error rows name the type checker"`,
where "the type checker" denotes a real implementation object by description, not by name. So (A) survives
this measurement in its stronger form and must be attacked on other ground. §5 does that.

---

## 3. `run.mjs` — located by my own sweep, not assumed

`find . -name "*.mjs" -not -path "*/node_modules/*"` → the only candidate is
**`prototypes/p0-vnext-admission/run.mjs`** (blob `af540a0259c8c5d6c7d989fe6c160819f170fa6b`, 842 lines),
corroborated by `git ls-files "*.mjs"`. The brief's line numbers check out: `FAILURE_CLASSES` defined at
**:746**, consumed at **:830**, gating at **:840**. `[MEASURED HERE]`

### 3.1 The implementation does not speak this clause's language

Counts in `run.mjs`, instrument controlled (`const`→102, `process`→8, junk token→0):

| token | count |
|---|---|
| `acceptance` / `Acceptance` / `ACCEPTANCE` | **0 / 0 / 0** |
| `terminal` / `Terminal` / `TERMINAL` | **0 / 0 / 0** |
| `FAILURE_CLASSES` | 6 |
| `POSITION_UNCLASSIFIED` | 3 |

`run.mjs` contains **neither word of the phrase**. `[MEASURED HERE]`

Across the whole prototype directory, the only file containing "terminal" or "acceptance" is
`evidence-order.mjs` — which exists solely to quote and study *this clause* (see §6). Positive control:
"failure" appears in 11 prototype files, so the directory sweep is live. `[MEASURED HERE]`

### 3.2 The prototype's own domain word is "admission", not "acceptance"

In the graph: `admission` appears 6× (`P0P`/`P0PC`/`P0PG` titles; three edge `type` values), and
`inadmissible` appears **inside `P0PC.acceptance` itself** ("surface-invalid rows are inadmissible").
`[MEASURED HERE]`

This is a **within-field minimal pair**: writing one sentence group, the author used *admission* vocabulary
for prototype-internal state and *acceptance* for the other thing. That is evidence the two words are not
interchangeable for this author.

### 3.3 The graph never references the implementation

`run.mjs` → **0**, `.mjs` → **0**, `prototypes` → **0** in the pinned graph, on both paths. Meanwhile the
object pins **12 artifacts by blob/commit OID** and its own `edge_rule` states *"Every hard edge names the
exact output artifact consumed."* The author's demonstrated discipline is to name and pin. No
implementation file is named or pinned anywhere. `[MEASURED HERE]`

### 3.4 Chronology does NOT refute (A) — reported against interest

`FAILURE_CLASSES` entered `run.mjs` at commit `1958ba5d`, **2026-08-02 03:54:33 -0400**. The graph landed at
`6d8c4f20`, **2026-08-02 12:25:07 -0400**. The array **pre-dates the graph by ~8.5 hours**, so the external
author *could* have seen it. I looked for a chronological kill and there isn't one. `[MEASURED HERE]`

---

## 4. Does any referenced document define the term?

Only a document the object itself points at counts. The graph points at these by path **and** blob OID. I
censused every one with a self-tested instrument (self-test: RED on planted token, GREEN on clean, case
sensitivity, multiword — all pass before any count is emitted).

| referenced document (OID) | role in the object | `terminal acceptance failure` | `terminal acceptance` | `acceptance failure` |
|---|---|---|---|---|
| `BLUEPRINT-V4-DRAFT.md` `fa1ce960` | **`requirements_source`** | **0** | **0** | **0** |
| `P0-vNext design contract` `a5ca0323` | `P0D_DESIGN_BLOB`, artifact on hard edge `P0D→P0P` | **0** | **0** | **0** |
| `GRAPH-LANES-FAKE-EDGE-MAP` `1e58d094` | `dependency_source` | **0** | **0** | **0** |
| `ADVISOR-STATE.md` `63f40d93` | `status_source`, `EPOCH_STATE` | **0** | **0** | **0** |
| `ADVISOR-RULINGS.md` `765a2fea` | `EPOCH_RULINGS` | **0** | **0** | **0** |
| `AGENT-REPORTS.md` `17ebb20e` | `EPOCH_REPORTS` | **0** | **0** | **0** |
| `GRADE-P0PC-PARTITION` `b74bd655` | `P0PC_UNSOUND_GRADE`, pinned **to node `P0PC`** | **0** | **0** | **0** |

**Positive controls proving the sweep is live on these surfaces:** bare `terminal` → 4 / 26 / 34 in
STATE / RULINGS / REPORTS; `FAILURE_CLASSES` → 4 / 9 / 14 in the same three. **Negative control**
`zzz_absent_control_zzz` → 0 in every file. `[MEASURED HERE]`

> **The phrase "terminal acceptance failure" is a hapax legomenon of the entire referenced corpus.** It
> occurs exactly once — in the field under test — and nowhere else in the authoritative object or in any
> document that object references, at the OIDs it references them by.

Two further negatives worth stating, both against readings I might have wanted:

- The **declared requirements owner** (`authority.rule`: *"The blueprint owns requirements"*) never uses
  `terminal`, `acceptance failure`, or `FAILURE_CLASSES`. It uses `acceptance` 3× — as **"acceptance
  command"** (:763, :950, something you *run*) and once as *"acceptance = the six pinned condition
  identities, never the count"* (:229, a **set of criteria**). Those two senses point in **different
  directions** and neither is the clause's sense. `[MEASURED HERE]`
- The **P0-vNext design contract** — the artifact this whole lane implements — uses the word "acceptance"
  **zero times**. The node's `acceptance` field is therefore not echoing its own design contract's
  vocabulary. `[MEASURED HERE]`

### 4.1 The blueprint does supply the clause's *shape* — but not its *population*

The requirements owner states the red-proof law generically:

> :738 — *"Under an intentionally loosened after-lane, that control must flip, be named, and make the
> receipt command **exit non-zero**; under the real repair it remains `false→false`."*
> :12 — *"a **non-zero enforcement path**"*; :708 — mismatched authority *"exits non-zero"*.

So `mutated → non-zero` / `clean control → zero` is blueprint law, and `P0PC`'s final clause instantiates
it. **But the blueprint states this law over *commands and receipts* — behavioural units — and never over a
named internal collection.** This is a weak lean toward a behavioural reading and is **not** a definition.
`[ARTIFACT-SOURCED]`

### 4.2 Later documents that use the phrase are the debate, not the definition

The phrase does occur in **working-tree** copies of `ADVISOR-RULINGS.md`, `ADVISOR-STATE.md`,
`AGENT-REPORTS.md`, four `GRADE-*` docs, `P0PC-CLAUSE-STATUS`, and `evidence-order.mjs`. **Every one
post-dates the graph and is downstream discussion of this very question.** A document that post-dates and
cites the question is not an independent path to its meaning. None is pinned by the object; the pinned OIDs
of the first three contain the phrase **zero** times. They are excluded from authority and used below only
as `CORROBORATED`. `[MEASURED HERE]`

---

## 5. Reading (A) — an entry in the `FAILURE_CLASSES` array

### Grade: **REFUTED**

Refuted on three independent grounds, none of which is the naming argument of §2.1.

**(A-i) The definite description fails uniqueness — measured.** `run.mjs` maintains a terminal gate class
that is deliberately **not** in the array. At `:107-117`:

> `// 🛑★★★★★ R-568 item (5) — THE SET OF SETS, BEYOND corpus.mjs. THIS RUNS BEFORE ANYTHING`
> `// ELSE AND IS DELIBERATELY **NOT** A FAILURE_CLASSES ENTRY.`
> … `// It prints GATE: FAIL and names its class so red-proof.mjs can assert it exactly like`
> `// any other class, then exits immediately — nothing downstream can downgrade it.`

It prints `GATE: FAIL` and calls `process.exit(1)` at `:138`. `red-proof.mjs:100-101` red-proofs it under
class name `module_collections` alongside every other class. So the implementation's own **terminal gate
population is 26 — 25 array entries plus one deliberately outside it.** Reading (A) makes the clause's
universal quantifier range over 25 of 26, excluding precisely the class the implementation most deliberately
protects. A definite description that misses a member the implementation itself calls a peer does not
uniquely denote the array. `[MEASURED HERE]` (25 enumerated programmatically, not by hand.)

**(A-ii) `run.mjs` has seven non-zero exit paths; only one is array-driven.** `process.exit(1)` at `:138`;
five `throw new Error("INSTRUMENT FAULT: …")` at `:201, :397, :410, :412, :738` (each exits non-zero
uncaught); and `process.exitCode = failures.length ? 1 : 0` at `:840` — the only `FAILURE_CLASSES`-driven
one. Under (A), the clause is silent about six of seven ways this runner terminates non-zero.
`[MEASURED HERE]`

**(A-iii) (A) makes the acceptance criterion self-certifying — and the implementation has measured this.**
`run.mjs` is a node **output** (`P0PC.outputs[0]` = *"corrected 1b-S and 1b-R prototype commit"*; the
`P0P→P0PC` edge carries the prototype as defect evidence). Letting a mutable array *inside the artifact
under test* fix the denotation of that artifact's own acceptance criterion means the criterion's population
can be shrunk by the doer. The file records this as measured fact at `:110-115`:

> *"deleting the `collection_shape` entry from `FAILURE_CLASSES` (5 lines) made the very injection that
> reddens this gate report `GATE: PASS`, `EXIT 0`. `failures` is `FAILURE_CLASSES.filter(...)` — BOTH
> OPERANDS FROM THE SAME MUTABLE ARRAY … A check registered IN that array could be retired by the same
> edit it exists to catch."*

Under (A), *"every terminal acceptance failure exits non-zero"* becomes satisfiable **by deleting array
entries.** A requirements object cannot be read as delegating its own population to an object the graded
party edits. `[ARTIFACT-SOURCED + MEASURED HERE]`

**Reported against the refutation:** chronology does **not** support it (§3.4) — the array pre-dated the
graph and the author could have seen it. (A) is refuted on uniqueness, coverage and self-certification, not
on availability.

---

## 6. Reading (B) — the check's own printed finding

### Grade: **UNSUPPORTED-BUT-NOT-REFUTED**

- **No affirmative textual support.** Nothing in the object or any referenced document says "printed",
  "reported", or otherwise makes the finding the unit. `[MEASURED HERE]`
- **It leaves `acceptance` doing no work.** If any failure the check reports qualifies, the modifier
  *acceptance* selects nothing — the exact mirror of (C)'s problem with *terminal* (§7). Neither reading
  earns both words.
- **Weak lean in its favour:** the blueprint states the enforcement law over *commands and receipts*
  (§4.1), and `"after evidence collection"` is an ordering constraint on output, which is behavioural.
  A lean is not a determination.
- **I found nothing that contradicts it.**

**Live conflation hazard, flagged as a finding.** `prototypes/p0-vnext-admission/evidence-order.mjs` is an
in-tree instrument whose header quotes this exact clause and **already uses the labels (A) and (B)** — but
for a *different sub-question*: whether `"after evidence collection"` means the run printed **its own
finding** (its "(B)") or the **full evidence body** (its "(A)"). Its header states R-596 §3 left that
reading *"OPEN and PROVISIONAL"* and that *"AN INSTRUMENT THAT PICKS AN INTERPRETATION RULES ON IT"*, so it
scores both columns and selects neither. **Its (A)/(B) are not this brief's (A)/(B).** Anyone reading across
the two label sets will measure the neighbouring object. `[MEASURED HERE]`

---

## 7. Reading (C) — failure of an acceptance criterion of THIS node

### Grade: **UNSUPPORTED-BUT-NOT-REFUTED** — attacked hardest, survived; but not on its author's authority

I was directed to refute (C) first and hardest. I could not, and I will not manufacture a refutation. What
follows is every attack I ran, including the ones that failed.

**On provenance.** (C) was proposed by the party who benefits. I gave that **zero weight**. An ad hominem is
not a measurement; the instruction that (C) must not survive on its author's authority carries the
symmetric obligation that it must not die on its author's identity. Nothing below turns on who said it.

### 7.1 Attacks that FAILED

**Attack 1 — "no unmarked level shift is permitted."** The clause is the 4th of four peer semicolon clauses
(decomposed mechanically: `[1]` tuple is an input · `[2]` one source executed as CJS and ESM · `[3]` exactly
one callable project export · `[4]` the clause). The first three are flat first-order requirements; (C)
requires the fourth to become a meta-clause quantifying over its own sentence-mates, with no syntactic
marker. **This attack fails on in-object precedent:** `P1.acceptance` ends *"its verifier closeout is
durable evidence, not standing CI enforcement"* — a meta-remark about the status of the evidence, sitting as
a peer clause in the same position. Level-mixing inside an acceptance field is this object's established
habit. `[MEASURED HERE]`

**Attack 2 — "you cannot *restore* a criterion."** The pairing *"…while the **restored** control exits
zero"* presupposes a mutate/restore cycle, which is runner-level, suggesting the left-hand side is
runner-level too. **This attack fails:** (C) reads coherently as "plant a mutation → some acceptance
criterion of this node is violated → the run exits non-zero; restore the source → exits zero." No category
error. The criteria and the runner's checks substantially overlap.

**Attack 3 — chronology / vocabulary import.** No purchase: the clause never uses implementation vocabulary
that would tie it to the runner, and the runner uses neither of its words (§3.1).

### 7.2 Attacks that LANDED — but show under-determination, not falsity

**Attack 4 — `terminal` is left with no work.** Under (C), *every* sibling clause is an acceptance
criterion. Nothing in the object distinguishes a **terminal** one from a non-terminal one. So `terminal`
either means "all of them" (vacuous) or selects a subset the object never identifies (undefined). This is a
real textual gap — **but it is symmetrical**: (B) strands *acceptance*, (C) strands *terminal*. A gap in a
reading is not a refutation of it.

**Attack 5 — the population is not enumerable.** Under (C) the domain of "every" is the sibling criteria,
which the object never enumerates and whose split is genuinely ambiguous: mechanical decomposition yields
4 sentences / 7 semicolon-clauses, while a criterion-level reading yields 8–13 depending on the splitting
rule. (C) therefore quantifies over a set the object does not fix. `[MEASURED HERE]`

### 7.3 The affirmative support (C) does have — stated because suppressing it would be the same sin as accepting it

1. **The object's only other prose use of `acceptance` fixes the sense.** `acceptance` occurs 30× in the
   graph: **28 node field keys**, **1** in `scheduler.ready_rule`, **1** inside the clause under test. The
   `ready_rule` reads: *"A node is ready only when every incoming hard edge has a present, pinned artifact
   and every **acceptance predicate** on that artifact is true."* In this object's own vocabulary,
   *acceptance* = a node's acceptance predicate evaluated on an artifact. `[MEASURED HERE]`
2. **The within-field minimal pair** (§3.2): the author used *admission/inadmissible* for prototype-internal
   state in the same sentence group, and *acceptance* for this.
3. **The word is the graph's, not the implementation's:** `run.mjs` → 0, P0-vNext design contract → 0.

This is the only *affirmative* textual traction any of the three readings has. It is an inference from
same-document word usage — **strong evidence, but not a definition.** It fixes what *acceptance* means; it
does not fix what *terminal* selects, and it does not enumerate the population. That is why (C) grades
UNSUPPORTED-BUT-NOT-REFUTED rather than SUPPORTED.

### 7.4 (A) and (C) are genuinely different populations — the question is not academic

`FAILURE_CLASSES` holds **25** entries (enumerated programmatically): `uncaught_gap, wrong_catcher,
ownership, parse, green_rejected, neg_control, getter, ledger_read, surface_health, twin,
tuple_disagreement, emitted_module, surface_invalid_rows, partition_sum, partition_overlap,
partition_orphan, position_unclassified, fixture_invalid, type_invalid_unclassified, membership,
green_membership, disposition, twin_pairs_membership, prereg_membership, collection_shape` — plus the
out-of-array `module_collections` (§5). `[MEASURED HERE]`

Roughly half of those have **no** counterpart criterion in `P0PC.acceptance` (`uncaught_gap, parse,
green_rejected, neg_control, getter, ledger_read, surface_health, membership, green_membership,
disposition, twin_pairs_membership, prereg_membership, collection_shape`). **This mapping is my
interpretive judgement, graded `[HYPOTHESIS]`, not a measurement** — but the size gap is large enough that
(A) and (C) cannot be treated as coextensive. "Every" ranges over materially different sets under the two
readings.

---

## 8. VERDICT

| reading | grade | one-line evidence |
|---|---|---|
| **(A)** `FAILURE_CLASSES` entry | **REFUTED** | Fails uniqueness (26 terminal gate classes, 1 deliberately outside the array); covers 1 of 7 non-zero exit paths; makes the criterion satisfiable by deleting array entries — measured in `run.mjs:110-115` |
| **(B)** the check's own printed finding | **UNSUPPORTED-BUT-NOT-REFUTED** | No text makes the printed finding the unit; strands the word *acceptance*; mildly consistent with the blueprint's command-level enforcement law |
| **(C)** failure of a criterion of this node | **UNSUPPORTED-BUT-NOT-REFUTED** | Only reading with affirmative support (`scheduler.ready_rule`'s "acceptance predicate"; the admission/acceptance minimal pair) — but strands the word *terminal* and quantifies over an unenumerated set |

> ## **UNDETERMINED — the requirements object does not fix the meaning.**

The phrase occurs **once**, in the field under test, and **nowhere else** in the authoritative object or in
any document that object references at the OIDs it references them by — under positive controls proving
the sweep is live on every one of those surfaces. The object names the concept and never defines it.

(A) is affirmatively **refuted**. Between (B) and (C) the object under-determines: each earns one of the two
words in "terminal acceptance" and strands the other. (C) carries the only affirmative textual anchor, and
that asymmetry should be recorded — but an anchor for *acceptance* is not a definition of *terminal
acceptance failure*, and I decline to promote a best-supported reading into a determined one.

### 8.1 What would have to be added to fix it

1. **Enumerate the population.** Either (a) name the collection with file path **and blob OID** — the
   discipline this object already applies to 12 artifacts and demands in its own `edge_rule` — or (b) give
   the node's acceptance criteria stable ordered ids so "every … acceptance failure" has a countable
   domain. Today it has neither.
2. **Define `terminal`.** It is the only word in the clause doing selection work and nothing defines it.
   Specifically: does it distinguish *gating* failures from *advisory/reported* ones, or does it just mean
   *process-ending*? Under (C) it currently selects nothing.
3. **Rule on failures raised outside the enumerated set.** The object is silent; the implementation has
   both kinds — five `INSTRUMENT FAULT` throws and one out-of-array early exit. Say whether they are in.
4. **Define `after evidence collection` separately.** Already flagged OPEN and PROVISIONAL by the desk's own
   instrument, and it carries its **own** (A)/(B) labels that are **not** this question's (§6). Whichever
   way this ruling goes, that one is still open, and the two label sets must not be merged.
5. **Do not re-fix the population inside the artifact under test.** Whatever is chosen, §5(A-iii) applies:
   a criterion whose population lives in a mutable array inside the graded output is self-certifying.

---

## 9. MANDATORY COVERAGE

### 9.1 What I verified, and via which non-overlapping paths

| claim | path 1 | path 2 |
|---|---|---|
| Subject blob identity | `git rev-parse HEAD:<path>` | `git hash-object` on worktree file + `git cat-file -s` |
| `FAILURE_CLASSES` absent from graph | byte-level `grep -F` on pinned blob | structural walk of parsed JSON (528 keys / 551 strings / 16 277 chars) |
| Clause never edited | `sha256` of `acceptance` at each of 5 revisions | independent `git hash-object` of each revision blob + landing commit message |
| `run.mjs` location | `find` filesystem sweep | `git ls-files "*.mjs"` |
| `run.mjs` lacks the vocabulary | `grep -c` per casing, controlled | whole-directory `grep -ril` with live positive control |
| Referenced docs lack the phrase | self-tested Node census instrument | `grep -n` spot-reads of context in blueprint |
| 25 array entries | programmatic extraction from the pinned line range | cross-check against `red-proof.mjs` class names |

### 9.2 Positive-control witnesses for every absence claim

| absence claimed | positive control | witness |
|---|---|---|
| `FAILURE_CLASSES` ∉ graph | same-lexical-class identifiers in the **same field** | `FREE_REF`=1, `POSITION_UNCLASSIFIED`=1 at `$.nodes[2].acceptance` |
| `acceptance`/`terminal` ∉ `run.mjs` | tokens known present | `const`=102, `process`=8; negative `zzzznotpresentzzzz`=0 |
| phrase ∉ 7 referenced docs | bare `terminal` and `FAILURE_CLASSES` on the same surfaces | `terminal`=4/26/34 and `FAILURE_CLASSES`=4/9/14 in STATE/RULINGS/REPORTS; `zzz_absent_control_zzz`=0 everywhere |
| census instrument itself | planted-bad self-test run before every count | RED on planted token (finds 2), GREEN on clean, case-sensitivity, multiword — 4/4 pass or the tool exits 9 |
| prototype dir lacks vocabulary | `grep -ril "failure"` | 11 files matched — sweep is live |

### 9.3 Join keys checked for every "identical / unchanged" claim

- Subject blob: `876c3a230d51815f49f98c36ea4109fe0b236b97` — joined across HEAD, worktree, brief.
- Clause stability: `sha256(P0PC.acceptance)` = `fc5e0f9ce084…` — joined across **5 commits**, with node id
  `P0PC` as the row key (not array position, which could drift).
- Referenced documents: joined by **blob OID**, not path — every one re-derived with `git cat-file -p` into
  scratch and re-hashed to confirm (`fa1ce960`, `a5ca0323` verified byte-for-byte).

### 9.4 Instrument faults I hit and corrected — disclosed

1. `grep -c -i -F` returned **empty output** rather than a count on this box, silently blanking ~11 rows of
   a blueprint census. Detected because a token I could see in context printed no count. **Every count in
   this receipt was re-derived with a self-tested Node instrument.**
2. `/tmp` resolves differently for Git-Bash tools (mapped) than for native Node (`C:\tmp`, nonexistent),
   which crashed the first revision-history pass. Re-run entirely inside the scratchpad.
3. A `grep … | head` pipeline masked its own exit status and made a zero-match look like a clean absence.
   Re-run with `grep -c` and explicit controls.

None of these altered a finding, because each was caught before a count was used. They are recorded because
a clean report is trusted only if it says where its instruments lied.

### 9.5 Surfaces I searched

The pinned graph blob (all 846 lines, read in full); `run.mjs` in full at the cited ranges plus whole-file
token counts; the whole `prototypes/p0-vnext-admission/` directory for vocabulary; `red-proof.mjs` and
`evidence-order.mjs` for class handling and the clause quotation; all 7 documents the graph references by
path+OID; all 5 historical revisions of the graph; `git log` for both the graph and `run.mjs`.

### 9.6 What I did **NOT** verify

- **I did not execute `run.mjs`, `red-proof.mjs`, or `evidence-order.mjs`.** All runtime statements about
  exit codes are read from executable source lines, not observed runs. A definitional question does not
  need execution — but if the desk wants "26 terminal gate classes" as an *observed* fact rather than a
  read one, that requires running the 26 injections and is not done here.
- **I did not adjudicate `"after evidence collection"`.** Different sub-question, separately open, with its
  own conflicting (A)/(B) labels (§6).
- **I did not read the campaign's prior 4d/4d-ii grades or rulings while forming this verdict** — that was
  deliberate, to keep the reading independent. Consequence: if one of them contains a *definition* of the
  phrase I have not seen, my "hapax legomenon" claim is scoped to **the pinned OIDs the object references**,
  which is where I measured it, and does not extend to working-tree revisions of those files.
- **I did not verify the external advisor's intent by any channel outside the repository.** No author was
  asked what they meant. If that channel exists, it is the cheapest possible fix and it outranks every
  inference in §7.
- **I did not enumerate `terminal`'s 4/26/34 hits in STATE/RULINGS/REPORTS exhaustively** — I sampled their
  context and found them unrelated (console/terminal-read/terminal-state senses). A term-of-art
  `terminal` hiding in the unsampled remainder is `[UNENUMERATED]`.
- **The (A)↔(C) population mapping in §7.4 is interpretive judgement, not measurement.** The 25-entry count
  and the out-of-array class are measured; which array entries "correspond to" which sibling criterion is
  my reading and is graded `[HYPOTHESIS]`.

### 9.7 Reading I could neither support nor refute

**Both (B) and (C).** That is the finding, not a failure to reach one. Each is coherent, each is consistent
with every measurement I took, and each strands one of the two words the clause turns on. The object does
not choose between them, and neither will I.
