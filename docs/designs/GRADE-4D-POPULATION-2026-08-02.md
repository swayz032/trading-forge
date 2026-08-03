# INDEPENDENT READER — the population of `4d`'s "terminal acceptance failure"

**Commissioned by:** ADVISOR RULING R-607 (interpretive / provenance determination; the desk is
disqualified because it is the party the answer blocks).
**Reader:** `accuracy-validator`, independent seat. **Mode:** interpretive determination, not a
refute-the-doer grade.
**Tree:** `C:/Users/tonio/Projects/wt-h1-wave4-20260712`, branch `h1-wave4-sealed12-driver`.
`git rev-parse --git-common-dir` → `C:/Users/tonio/Projects/trading-forge/trading-forge/.git`
(a linked worktree, not a standalone repo — law 10 discriminator run, not assumed).
**Pin:** every measurement below is against
**`1d622c0cc8314043b3e6d627e53eabed6a9e1854`**, materialised via `git cat-file blob <PIN>:<path>`.

### 🛑 `git status --porcelain -- prototypes/` — START vs END: **IT CHANGED, AND HERE IS WHY**

```
START (22:44:48 EDT), HEAD 1d622c0c        END (23:06 EDT), HEAD 5d8bc158
 M  …/plant-landing.mjs                    (empty — clean)
 ??  …/plant-swallow-redproof.mjs
```

**The tree went dirty → clean and HEAD advanced 3 commits while I was reading. Nothing I did caused
it, and I did not "fix" anything: the live worker COMMITTED its own work.** `MEASURED HERE`:

```
7f36a890  23:01:25  R-607: velocity order accepted; batching becomes default…
35251ab7  23:02:17  R-605 s5.1: landing detector now catches a SWALLOWED plant (AR-651)
5d8bc158  23:04:54  R-608: AR-651 APPROVED -- swallow detector fixed at the right layer…
```

`35251ab7` is the worker landing exactly the two files the brief said it was editing. **I ran no
`checkout`, `reset`, `stash`, `clean`, `commit`, or any index operation at any point** — the clean
status is the worker's commit, not a tidy-up.

★ **EVERY MEASUREMENT IN THIS RECEIPT SURVIVES THE HEAD MOVE, verified rather than assumed** — the
three files I measured are **blob-identical** at `1d622c0c` and at `5d8bc158`
(`red-proof.mjs`, `run.mjs`, `evidence-order.mjs` all UNCHANGED), and the clause substring still
hashes to `c59801ba97821507` at the new HEAD. **Nothing here is stale.**

⚠️ **Recorded against my own draft:** an earlier revision of this header asserted "IDENTICAL at both
ends / no mid-grade HEAD move." **That was true when written and false 20 minutes later.**
`A RED PATH DECAYS ON UNRELATED CHANGES — RE-MEASURE EVERY RUN.` The end-state check caught it; had I
copied the start-state forward as the end-state, this receipt would have shipped a false claim about
a live worker's tree. The only file this read writes in the campaign tree is this receipt.

### ⚠️ LINEAGE DECLARATION (grading-integrity, structural independence)

**This seat has graded this same lineage twice before** — `GRADE-P0PC-4D-READING-2026-08-02.md` and
`GRADE-P0PC-4D-READING-B-2026-08-02.md`, both at `ee31fe44`. Per the standing rule that
independence is structural rather than a matter of how honestly one looks, **every band, number and
finding below is re-derived from the artifacts at `1d622c0c` only.** No prior finding of mine is
carried forward as evidence; where a prior grade reached the same place, that is stated as
convergence, never as support. One prior-grade artifact is corrected below (§6.2).

---

## 0. VERDICT

> ## **UNDER-SPECIFIED.** `4d` binds no population. None of candidates 1–4 is the referent, and the
> clause as written is **not dischargeable** without an authoring decision that names its population.

**Confidence: HIGH on the provenance finding; HIGH on the arithmetic; MEDIUM-HIGH on the
interpretive conclusion.**

The provenance leg is `MEASURED HERE` and decisive rather than argued: **the clause pre-dates every
one of the four candidate artifacts, and its text never changed afterward.** That is a fact about
commit timestamps and blob digests, not a reading. The interpretive conclusion inherits its
remaining uncertainty from one irreducible gap — the clause's author is an external party who left
no definition, and no measurement in this tree can recover an intention that was never written down.

**Two structural findings that reshape the question the desk has been asking:**

1. ★★★★★ **Candidates 1 and 3 are not rivals — they are the SAME two tables counted in different
   units.** `MEASURED HERE`, exactly and in both directions: `evidence-order.mjs`'s `PINNED_KNOBS`
   (37) **is identical** to (`red-proof.mjs`'s `CLASSES` names ∪ its `EXPECT` injection names), with
   zero members on either side of the difference. `43 = 37 distinct knobs + 2 SHARED re-uses + 2
   FREEZE_EXPECT re-uses + 2 standalone controls`. **So R-596–R-603 were never litigating a
   different object from the one `P0PC-CLAUSE-STATUS:111` assigns.** They counted distinct injection
   knobs where the clause-status doc counted rows. R-606's alarm — *"the last six rulings
   instrumented `4d` over a population the campaign's own clause-status document does not assign to
   `4d`"* — is **over-stated on this measurement.** The six rulings' work is not voided by unit.

2. ★★★★★ **`P0PC-CLAUSE-STATUS:111` is NOT evidence of original intent, and R-606's standing STOP
   mis-describes it.** R-606 protects that line as *"now the primary evidence of the campaign's
   original intent."* `MEASURED HERE`: the clause was authored **16 h 10 min earlier**, by an
   **external GPT advisor**, on a branch that **is not an ancestor of HEAD**, and its authoring
   context document **was never copied into the campaign tree.** The clause-status line is evidence
   of the **campaign's later reading**. The primary evidence of original intent exists — it is just
   somewhere nobody in this campaign has looked.

**What follows for the node:** `4d` cannot be ruled MET or NOT-MET on any candidate without an
authoring act. This does **not** disturb `4d`'s current NOT-MET status (R-600) — an unbindable
quantifier does not yield MET either. It changes what would discharge it: **not another instrument,
an authoring decision.** See §7.

---

## 1. THE OBJECT, VERBATIM AND PINNED

`ARTIFACT-SOURCED` — `docs/designs/V4-PHASE1-EXECUTION-GRAPH-2026-08-02.json:245`, node `P0PC`,
field `acceptance`, final clause:

> *"…every terminal acceptance failure exits non-zero after evidence collection while the restored
> control exits zero."*

**The clause decomposes into a property with an unbound quantifier:**

| part | content | status |
|---|---|---|
| quantifier | "every terminal acceptance failure" | **UNBOUND — this is the whole question** |
| predicate 1 | "exits non-zero" | process exit code ≠ 0 |
| predicate 2 | "after evidence collection" | ordering: evidence precedes the exit |
| predicate 3 | "the restored control exits zero" | a post-restoration clean run exits 0 |

`MEASURED HERE` — the predicates are testable and have been tested by the campaign. **The quantifier
has never been bound by any artifact.** That asymmetry is the finding.

---

## 2. TARGET 1 — CANDIDATE 1'S STANDING: **an early guess by the same parties, not original intent**

### 2.1 The authoring record `[MEASURED HERE]`

```
git log --all -S'every terminal acceptance failure exits non-zero'
git show --stat 337cf11d
git branch -a --contains 337cf11d
git merge-base --is-ancestor 337cf11d HEAD   ->  NO, not an ancestor
```

| # | event | commit | timestamp | evidence grade |
|---|---|---|---|---|
| 1 | `run.mjs` + `corpus.mjs` created (AR-589) | `8297ebbe` | **02:47:56** | `MEASURED HERE` |
| 2 | ★ **clause `4d` FIRST APPEARS** | `337cf11d` | **03:15:14** | `MEASURED HERE` |
| 3 | `red-proof.mjs` created, `FAILURE_CLASSES` created (AR-591) | `1958ba5d` | **03:54:33** | `MEASURED HERE` |
| 4 | acceptance field **rewritten**, clause carried **byte-identical** | `9844355c` | **04:35:44** | `MEASURED HERE` |
| 5 | graph **copied** into campaign `docs/designs/` | `6d8c4f20` | **12:25:07** | `MEASURED HERE` |
| 6 | ★ **the row count first reaches 43** | `7c7b9ab0` | **17:24:15** | `MEASURED HERE` |
| 7 | ★ **`P0PC-CLAUSE-STATUS` committed (AR-636), assigning `4d`→43** | `c9f5ab51` | **19:25:30** | `MEASURED HERE` |
| 8 | `evidence-order.mjs` created (AR-640) | `ee31fe44` | **20:21:12** | `MEASURED HERE` |

**Commit 2 created two files: the graph AND its authoring document**
`docs/advisor-rulings/V4-GRAPH-ENGINEERING-REVISION-2026-08-02.md`, whose own title is
**"External GPT V4 revision — graph-engineered execution plan"** and whose §5 states it is an
*"external-advisor candidate, published for Fable to consume."* `ARTIFACT-SOURCED`.

**Both authoring commits live on `gpt-advisor-ar552-20260801` / `remotes/origin/external-advisor/
gpt-rulings` and NEITHER is an ancestor of HEAD.** `MEASURED HERE`.
*(Git author is `Tonio` on every commit in this repo, so author attribution via git is uninformative
here; the external authorship is established by the document's own text and its branch, not by the
author field. Stated so the join is visible.)*

### 2.2 The three findings that settle candidate 1's standing

**(a) `red-proof.mjs` did not exist when the clause was written.** Created at 03:54:33, **39 minutes
after** 03:15:14. A requirement cannot quantify over an artifact that does not exist.

**(b) The population the doc maps to did not exist until 14 hours later.** The `43` first appears at
`7c7b9ab0` 17:24:15 — **2 h 01 min before** the clause-status doc, and **14 h 09 min after** the
clause.

**(c) At the author's own stated evidence horizon, none of the machinery existed.** The authoring
document's §9 publication receipt pins its epoch to *"newest report `AR-589` at `8297ebbe`"* — which
is `run.mjs`'s creation commit. `MEASURED HERE`, **positive-controlled on the same file and method**:

```
git cat-file blob 8297ebbe:prototypes/p0-vnext-admission/run.mjs   (84 lines, 4273 bytes)
sha256 f4248f62eb86346aec7a3d7150789485d2b142ecf6637d3755181e5ba1fe8b9e

  FAILURE_CLASSES   0     <- ABSENT
  process.exit      0     <- ABSENT
  exitCode          0     <- ABSENT
  restored          0     <- ABSENT
  ----- POSITIVE CONTROLS, same file, same method -----
  CONTROL           3     <- present
  const            16     <- present
  import            4     <- present
```

**At the moment the clause demanding "exits non-zero" was written, the only harness in existence had
no exit-code machinery at all.** The clause was a forward-looking requirement — a thing to *build* —
not a description of an existing population.

### 2.3 Did the 04:35:44 rewrite bind it? **No** `[MEASURED HERE]`

`9844355c` rewrote the acceptance field (90 JSON lines changed) and **the `4d` clause survived
byte-identical.** The 16-char sha256 prefix of the extracted clause text is `c59801ba97821507` at
**all five** graph versions AND the working tree:

| object | clause sha256 prefix |
|---|---|
| `337cf11d:docs/advisor-rulings/…json` | `c59801ba97821507` |
| `9844355c:docs/advisor-rulings/…json` | `c59801ba97821507` |
| `6d8c4f20:docs/designs/…json` | `c59801ba97821507` |
| `27448ee2:docs/designs/…json` | `c59801ba97821507` |
| working tree at `1d622c0c` | `c59801ba97821507` |

**Join key for this "unchanged" claim:** the extracted clause substring itself, hashed — not the
file, not the field, not a line number. The field around it *did* change; the clause did not.

★ **This is the decisive point against candidate 1 as intent.** At the rewrite the author *could*
have seen `red-proof.mjs` — it had existed for 41 minutes. **But its row population was 16, not
43** (§3.3). The author had the artifact in reach, rewrote the field around the clause, and **still
did not bind the clause to it or define the term.**

### 2.4 Was the mapping ever ratified? **No** `[MEASURED HERE]`

- **No ruling ratifies it.** R-606 grades the proposition explicitly: *"`[HYPOTHESIS — NOT RULED]`
  that the `43` is the CORRECT population."* R-604 records without ruling. R-600 rules `4d` NOT MET
  *without* picking a reading, and says so.
- **The graph adoption never touched it.** `docs/designs/V4-GRAPH-ADOPTION-RECEIPT-2026-08-02.md`
  (204 lines, 9,875 bytes) — `terminal acceptance failure` **0**, `terminal` **0**, `4d` **0**,
  `FAILURE_CLASSES` **0**; positive controls on the same file/method: `P0PC` **10**, `red-proof`
  **2**, `acceptance` **2**. Both `acceptance` hits are the *adoption's own* criteria
  (*"acceptance criteria are R-547 §4 items 1–6"*), never `P0PC`'s.
  ★ **The graph was adopted as an execution-ORDERING object** — its authoring doc §3 sets the
  two-layer rule *"blueprint = requirements, graph = execution ordering."* **The acceptance field
  came along as payload and was never ratified as a requirement definition.**

### 2.5 A correction owed to the doc's own independence claim `[MEASURED HERE]`

`P0PC-CLAUSE-STATUS-2026-08-02.md` §3 is headed *"RE-DERIVED HERE, NOT RELAYED FROM R-591"* and
reports *"COUNTED INDEPENDENTLY, **WITH THE CAMPAIGN'S OWN EXTRACTOR**."*

**That extractor is `extractModuleCollections` — the same instrument `red-proof.mjs:589` uses to
read `FAILURE_CLASSES`.** A count that reproduces the instrument it is checking is one path wearing
a second hat. **The doc's numbers are correct (§3 confirms them) but its independence claim is
not.** §3 below is, to my measurement, the first derivation of the `43` that does not route through
the campaign's own extractor.

### 2.6 ⚠️ A correction to R-606's self-criticism — in the desk's favour

R-606 line 41 records: *"`R-604` **would have published a false "never defined anywhere"** had it
ruled."*

`MEASURED HERE` — **that self-criticism is over-stated, and R-604's abandoned conclusion was
TRUE.** `terminal acceptance failure` occurs exactly **twice** in `P0PC-CLAUSE-STATUS`, at `:84` and
`:111`, and **both are verbatim quotations of the clause.** The document **assigns a population**;
it never **defines the term**. Assignment and definition are different acts. R-604 was right to
record rather than rule, but it was right for a different reason than R-606 credits: not because a
definition existed unsearched, but because **the authority of an assignment made 16 hours late was
the open question.** ★ The genuinely unsearched surface was the one in §4 — and it does not define
the term either.

### 2.7 Verdict on target 1

> **`P0PC-CLAUSE-STATUS:111` is an early guess by the same parties — early relative to R-594's
> discovery, sixteen hours LATE relative to the clause.** It is a desk/worker status artifact
> mapping an *external* author's text onto an artifact that post-dates it, never ratified by any
> ruling, and its own claim of independent derivation does not hold. **It carries no authority over
> the requirement.** R-606's STOP protecting it should be re-captioned: it is the primary evidence
> of **the campaign's reading**, not of **original intent**.

---

## 3. TARGET 2 — RE-DERIVING THE 43 AND THE 25 (R-600 §10 / R-605's open item, discharged)

**Both R-600 §10 and R-605 carry the `43` denominator as never re-derived by anyone. It is
re-derived here, through two non-overlapping paths.**

### 3.1 Proxy proof (nothing was executed against the campaign tree)

Blobs materialised from the object DB with `git cat-file blob <PIN>:<path>` — no smudge filters, no
working-tree read, immune to a concurrent agent's mutate-and-revert.

| verdict | file | sha256 (first 32) objdb / copy |
|---|---|---|
| **MATCH** | `red-proof.mjs` | `942b347357cc27cd5eecc63942d410e3` / same |
| **MATCH** | `run.mjs` | `a85c3f0d3541cd465725140af06266eb` / same |
| **MATCH** | `evidence-order.mjs` | `9af0d6eecc247fcf164c3e9559177070` / same |

**File counts on both sides:** 21 blobs under `prototypes/p0-vnext-admission/` at the pin; **3
copied** (plus one scratch temp used by the history loop). **The copy is a deliberate subset, not a
mirror** — stated because a count that differs must explain itself rather than be quietly omitted.
`copy == working-tree` was **not** used as the check; every digest is against the pinned object.

**Blob identity across the clause-status doc's own commit** `[MEASURED HERE]`:
`red-proof.mjs` and `run.mjs` are **blob-identical** at `c9f5ab51` and at `1d622c0c`
(`6410d619…` and `af540a02…`). **Join key: the blob OID, not the path or the count.** So the
object the clause-status doc measured and the object I measured are the same object.
`evidence-order.mjs` **did not exist** at `c9f5ab51` — candidate 3's artifact post-dates the
document that is claimed as intent evidence.

### 3.2 The 43 — CONFIRMED, two non-overlapping paths

`red-proof.mjs:452`:
`EXPECTED_ROW_COUNT = CLASSES.length + SHARED.length + EXPECT.length + FREEZE_EXPECT.length + STANDALONE_ROWS`

| table | Path A — manual structural read of the source | Path B — TypeScript 5.9.3 AST element count |
|---|---|---|
| `CLASSES` (`:26`) | **16** | **16** |
| `SHARED` (`:53`) | **2** | **2** |
| `EXPECT` (`:64`) | **21** | **21** |
| `FREEZE_EXPECT` (`:110`) | **2** | **2** |
| `STANDALONE_ROWS` (`:451`) | **2** (literal, read) | **2** (literal, read) |
| **sum** | **43** | **43** |

- **Path A** — line-by-line read of each array body; comments and section banners excluded by eye.
- **Path B** — `ts.createSourceFile` + `ArrayLiteralExpression.elements.length` via a real parser.
  Non-overlapping with Path A (a parser, not my eye), with the instrument's own printed denominator,
  and with `extractModuleCollections` (the campaign extractor §2.5 flags).

> ✅ **The brief's arithmetic `16 + 2 + 21 + 2 + 2 = 43` is CORRECT.** R-591 §1.3's decomposition
> reproduces exactly. **`43` is re-derived. R-600 §10 / R-605's open item is discharged.**

### 3.3 …and the `43` was never a stable number `[MEASURED HERE]`

The declared row population at **every** commit that touched `red-proof.mjs`, each blob read from
the object DB and counted by the Path-B parser:

| commit | time | CLASSES | SHARED | EXPECT | FREEZE | STAND | **SUM** |
|---|---|---|---|---|---|---|---|
| `1958ba5d` | 03:54:33 | 11 | 0 | 0 | 0 | 0 | **11** |
| `9be6a52a` | 04:09:25 | 14 | 2 | 0 | 0 | 0 | **16** |
| `00289f07` | 04:42:39 | 16 | 2 | 0 | 0 | 0 | **18** |
| `53e80935` | 05:47:35 | 16 | 2 | 7 | 2 | 0 | **27** |
| `46d6b7de` | 06:13:14 | 16 | 2 | 9 | 2 | 0 | **29** |
| `8a40f899` | 06:17:09 | 16 | 2 | 9 | 2 | 0 | **29** |
| `83c9e946` | 06:43:47 | 16 | 2 | 13 | 2 | 0 | **33** |
| `8e62d977` | 06:53:23 | 16 | 2 | 16 | 2 | 0 | **36** |
| `7740292f` | 12:26:56 | 16 | 2 | 18 | 2 | 0 | **38** |
| `dfbad040` | 12:47:05 | 16 | 2 | 19 | 2 | 0 | **39** |
| `a0d54a98` | 14:25:34 | 16 | 2 | 19 | 2 | 2 | **41** |
| `1a1abb46` | 15:26:04 | 16 | 2 | 19 | 2 | 2 | **41** |
| `5a5838bc` | 16:42:07 | 16 | 2 | 19 | 2 | 2 | **41** |
| `7c7b9ab0` | 17:24:15 | 16 | 2 | 21 | 2 | 2 | **43** |
| `3978c1c5` | 18:32:27 | 16 | 2 | 21 | 2 | 2 | **43** |

★★★★★ **The clause text stayed byte-identical while its putative population went 11 → 43 — a 3.9×
change across 15 commits in 14 h 38 min, with no ruling amending the clause.** Note the value at
the 04:35:44 rewrite was **16**.

> **This is the strongest structural objection to candidate 1 and it is arithmetic, not argument.**
> If `4d` quantifies over "`red-proof.mjs`'s 43 rows", then the acceptance criterion silently
> changed meaning fourteen times, and **the doer moves the finish line by editing its own table.**
> An acceptance criterion whose population is the instrument's own mutable array is not a criterion
> the instrument can fail on purpose. *(This is the `ratio-denominator-is-the-instrument's-own-tables`
> shape one layer up: not the denominator of a print, but the population of the REQUIREMENT.)*

### 3.4 The 25 — CONFIRMED, and the non-identity is REAL but is a **unit mismatch**

`run.mjs:746` `FAILURE_CLASSES` — **25** on Path A and Path B, `distinct = 25` (no duplicates).

**Is the non-identity with the 43 real?** Yes — **and it is not a disagreement.** `MEASURED HERE`,
applying `red-proof.mjs:592-594`'s own mapping (`CLASSES[0] | SHARED[0] | EXPECT[1]`):

```
red-proof ROWS                    : 43
red-proof DISTINCT COVERED CLASSES: 26
run.mjs FAILURE_CLASSES           : 25

declared in run.mjs with NO red path : (none)          <- ZERO uncovered
covered by red-proof, not declared   : module_collections   <- exactly ONE

classes carrying >1 red-proof row:
   6 rows -> type_invalid_unclassified
   5 rows -> membership
   3 rows -> green_membership
   2 rows -> module_collections
   2 rows -> uncaught_gap
39 rows map to 26 classes; 4 rows carry NO class name at all
   (freeze:membership_rename, freeze:membership_delete, freeze_control, over_correction_control)
```

**`43` counts (injection, expected-class) ROWS. `25` counts FAILURE CLASSES.** They are counts of
different *kinds of thing*, related by a documented many-to-one map plus 4 class-less rows. The
`26 = 25 + 1` surplus is **deliberate and documented at `run.mjs:107-108`**: the early collection
gate *"RUNS BEFORE ANYTHING ELSE AND IS **DELIBERATELY NOT** A `FAILURE_CLASSES` ENTRY"* — because
`failures = FAILURE_CLASSES.filter(...)` takes both operands from the same mutable array, so a check
registered in that array could be retired by the same edit it exists to catch.

> ⚠️ **`P0PC-CLAUSE-STATUS:143`'s `SAME POPULATION? false` is TRUE but reads as a discrepancy when it
> is a category difference.** Its own §3 prose gets this right (*"the two numbers count different
> sets"*) and explicitly disclaims a verdict. **R-606 then escalated the table line into an alarm
> the prose does not support.** `A CAPTION IS A CLAIM` — and here the caption outran its own body.

### 3.5 A false join re-measured independently

`ARTIFACT-SOURCED` — R-596 records: *"`module_collection_add`/`_delete` … the declared class they
fire is **`collection_shape`, AND IT IS ONE OF THE `25`**."*

`MEASURED HERE` — **FALSE at the pinned object.** `EXPECT` rows 18 and 19 declare
**`module_collections`**, and `module_collections` is the single class **NOT** in the 25.
`collection_shape` is declared by row 16 (`new_unpinned_collection`), a different row.

| `EXPECT` row | injection | declared class | in the 25? |
|---|---|---|---|
| 16 | `new_unpinned_collection` | `collection_shape` | yes |
| 18 | `module_collection_delete` | **`module_collections`** | **no** |
| 19 | `module_collection_add` | **`module_collections`** | **no** |

R-600 already withdrew R-596 §8's join as *"an artifact of a bug"*, so this **converges** with the
desk's own withdrawal rather than adding a new finding — recorded because the measurement is mine
and because the withdrawn sentence is still legible in the ledger.

---

## 4. TARGET 3 — THE UNSEARCHED SURFACE: **found, and it does not define the term**

★ **The brief's own lesson held: the surface the desk had not searched was the one holding the
answer — and the answer it holds is a provenance answer, not a definition.**

### 4.1 What nobody in this campaign has read

**`docs/advisor-rulings/V4-GRAPH-ENGINEERING-REVISION-2026-08-02.md`** — 215 lines at `337cf11d`,
+31 at `9844355c`. Created **in the same commit as the clause**. It is the clause's authoring
document.

★★★★★ **It is not in the campaign tree, and it never was.** `MEASURED HERE`:

- `docs/advisor-rulings/` **does not exist** at HEAD (`git ls-tree` empty) **nor on disk**
  (`ls` → No such file or directory).
- `6d8c4f20` — the commit whose own message says *"copy the external validator byte-identically …
  land the graph in campaign-owned `docs/designs`"* — copied **the graph JSON + 3 scripts** and
  **not** the authoring document.
- Absence in campaign HEAD, **positive-controlled on the same method** (`git grep -l … HEAD`):

  | probe | files at HEAD |
  |---|---|
  | `External GPT V4 revision` | **0** |
  | `Red controls must include` | **0** |
  | `A graph edge is an artifact contract` | **0** |
  | `terminal acceptance failure` *(control)* | **10** |
  | `V4-PHASE1-EXECUTION-GRAPH` *(control)* | **8** |

> **That is why the desk could not find a defining surface: the authoring context was never in the
> tree it was searching.** Not a search failure — a copy that took the payload and left the
> rationale. ★ `A GRAPH CAN BE COPIED BYTE-IDENTICALLY AND STILL ARRIVE STRIPPED OF ITS MEANING.`

### 4.2 What the authoring document actually says — and does not

`ARTIFACT-SOURCED`, read in full at `337cf11d` and diffed against `9844355c`:

- **It never uses the phrase.** `terminal acceptance failure` = **0** occurrences in both revisions.
  The clause appears nowhere in the prose that shipped with it.
- **It contains one structurally parallel passage — §9 "Machine checks required at adoption":** a
  list of *"the JSON graph must fail if…"* conditions, then *"**The clean control** is the current
  graph parsing successfully. **Red controls must include** a planted cycle, a missing endpoint, a
  blank hard-edge artifact, a missing fan-in predecessor…"*
  ⚠️ **`HYPOTHESIS`, and I am explicitly NOT resting the verdict on it: §9 governs the GRAPH
  VALIDATOR, not `P0PC`.** It shares the clause's *shape* (every failure red, one clean control
  green) and is plausibly where the author's phrasing habit comes from. **But treating it as the
  definition would be measuring the neighbouring object with perfect rigor** — the exact conviction
  this desk carries six times. It is recorded as a stylistic lead, nothing more.
- **The +31 lines at `9844355c` define nothing either** — they are Revision-2 scheduling
  corrections, an epoch re-pin (`AR-593` / `R-550`), and a validator receipt. Read in full.
- **§10.3 asked for exactly the ratification that never happened:** *"Copy the graph manifest into
  the campaign branch and record its hash in the adopting ruling."* The hash was recorded; **the
  acceptance text's meaning never was** (§2.4).

### 4.3 Every remaining candidate surface — searched, each with a live control

| surface | size | phrase | controls on the SAME surface/method |
|---|---|---|---|
| `V4-PHASE1-EXECUTION-GRAPH…json` | 846 lines | **1** (the clause) | `acceptance` 30 · `P0PC` 10 · `red-proof` 3 · **`FAILURE_CLASSES` 0** |
| `BLUEPRINT-V4-DRAFT.md` | 966 l / 60,181 B | **0** | `acceptance` **3** · `Phase 1` **7** · `red-proof` 2 · `P0PC` **0** |
| `P0-VNEXT-DESIGN-2026-08-01.md` | 717 l / 137,116 B | **0** | `accept` **3** · `red-proof` **11** · `acceptance` **0** · `P0PC` **0** |
| `V4-GRAPH-ADOPTION-RECEIPT…md` | 204 l / 9,875 B | **0** | `P0PC` **10** · `red-proof` **2** · `acceptance` 2 (its own) |
| `V4-GRAPH-ENGINEERING-REVISION…md` (external) | 215 + 31 l | **0** | §9 red/clean-control language present |
| `ADVISOR-RULINGS.md` | 585 rulings | **12**, earliest **R-594** (`:988`, `:1010`; R-594 spans `950–1067`) | all quotations |
| whole tree, tracked | — | 10 files | `acceptance` 92 files · `terminal` 165 · `red-proof` 64 |
| whole filesystem, **incl. untracked** | — | same 10 + 7 worker run-copies under `tmp/` | negative control `ZZZ-NEVER-PRESENT-CONTROL-4D` → **0**; `restored control` → **9** |

★ **Two brief leads independently VERIFIED, both of which the desk had flagged as
possibly-broken-control:**
- **`FAILURE_CLASSES` appears nowhere in the graph JSON** — **0**, with `acceptance` 30 / `P0PC` 10 /
  `red-proof` 3 live on the same file. **The desk's claim holds.**
- **`P0-VNEXT-DESIGN-2026-08-01.md` contains no occurrence of "acceptance" at all** — confirmed by
  **two engines** (`grep -oi` and Python's UTF-8 decode + `str.count`), 137,116 bytes, **no BOM**,
  with `red-proof` **11** and `accept` **3** proving the method reads the file. **The desk was right
  to reverse its "broken control" call.** The doc does not even contain the string `P0PC`.

**One benign drift from the brief:** the brief reports 11 occurrences in `ADVISOR-RULINGS.md`; I
measure **12**. R-606 landed after the brief was written and quotes the clause. Consistent with a
live ledger, not a discrepancy.

> **CONCLUSION — TARGET 3: no surface anywhere, in or out of the campaign tree, defines "terminal
> acceptance failure."** The 12 ledger occurrences and the 10 tree files are all quotations of, or
> commentary on, the clause. **The clause is the only place the concept appears, and it appears
> undefined.**

---

## 5. TARGET 4 — CANDIDATE 3'S COHERENCE: **coherent, and it is candidate 1 in different units**

### 5.1 The reconciliation `[MEASURED HERE]`

```
CANDIDATE 1  red-proof ROWS                        = 43
CANDIDATE 2  run.mjs FAILURE_CLASSES               = 25
CANDIDATE 3  evidence-order PINNED_KNOBS           = 37
             CLASSES names UNION EXPECT injections = 37

[TEST] PINNED_KNOBS === (CLASSES names U EXPECT injections)?  ***** true *****
   only in PINNED_KNOBS   : (none)
   only in red-proof cols : (none)

16 + 21 distinct knobs + 2 SHARED (both wrong_catcher)
                       + 2 FREEZE_EXPECT (membership_rename, membership_delete)
                       + 2 standalone controls                  = 43
```

★★★★★ **Set equality, exact, both directions, zero members in either difference.** The 37 knobs and
the 43 rows are **the same two tables**. `43 − 37 = 6` is entirely re-used knobs and controls.
**Candidates 1 and 3 are one axis, not two populations.**

### 5.2 Candidate 2 IS a different axis `[MEASURED HERE]`

```
[TEST] PINNED_KNOBS === FAILURE_CLASSES?  false
   in KNOBS not in the 25 (21): green_add green_delete green_duplicate green_to_red
     membership_add membership_delete membership_delete_guard membership_duplicate
     membership_rename module_collection_add module_collection_delete new_unpinned_collection
     own_extra_code own_extra_inside_anchor own_unrelated_attributed own_unrelated_nonowned
     prereg_delete substituted_diagnostic twin_pairs_delete uncaught_stale uncaught_undeclared
   in the 25 not in KNOBS  (9): collection_shape disposition green_membership membership
     partition_orphan partition_sum prereg_membership twin_pairs_membership uncaught_gap
```

The two sets intersect in exactly the 16 `CLASSES` names, which serve double duty as both a class
name and a knob name; `EXPECT` separates the two (injection name ≠ class name).

> **So the real landscape is TWO axes, not four candidates:**
> **CAUSE axis** — what can be injected: **37** distinct knobs, or **43** rows counting re-uses and
> controls. *(candidates 1 and 3)*
> **EFFECT axis** — what can fail: **25** declared classes, **26** detectable including the
> deliberately-excluded gate. *(candidate 2)*

### 5.3 Why six rulings proceeded, and what licenses the knob reading

**Nothing licenses it in the design record** `[MEASURED HERE]` — `P0-VNEXT-DESIGN-2026-08-01.md` has
`FAILURE_CLASSES` **0**, `acceptance` **0**, `terminal` **0**, `P0PC` **0**. `PINNED_KNOBS`'s own
provenance comment reads *"generated from `parseInjectionKnobs(run.mjs)` at commit `19a46ac0`"* —
**self-derived from the implementation.** The knob population was read out of the code, never down
from a requirement.

**It was inherited by momentum — and the desk had already said so about itself.** R-604 §1 records
its own `[UNENUMERATED]`: *"the identification of terminal acceptance failure with `FAILURE_CLASSES`
is an interpretation the campaign made and I inherited; I did not independently justify it."*

> ✅ **But "inherited by momentum" is NOT "wrong object", and that distinction is the deliverable
> here.** Because `PINNED_KNOBS === CLASSES ∪ EXPECT` exactly, **R-596–R-603 instrumented the same
> tables the clause-status doc assigns to `4d`.** They differ from it in *unit* (distinct knob vs
> row), not in *content*. **R-606's "a population the campaign's own clause-status document does not
> assign to `4d`" is over-stated on this measurement, and the six rulings' work is not voided.**

### 5.4 One semantic asymmetry, graded as the hypothesis it is

⚠️ **`HYPOTHESIS`, offered as reasoning and not as measurement:** an injection knob is a **cause**;
"acceptance **failure**" names an **effect**. On plain English the clause quantifies over things that
*fail*, which favours the EFFECT axis (25/26) over the CAUSE axis (37/43). **Countervailing, in the
same text:** *"the **restored** control"* is the injection idiom — "restored" presupposes something
was applied and reverted, which is CAUSE-axis vocabulary. **The clause's two halves lean opposite
ways. This is evidence FOR the under-specified verdict, not a tiebreaker for either axis** — and I
decline to break the tie, because inventing a determination here is exactly the failure mode R-607
sent me to avoid.

---

## 6. TARGET 5 — THE UNDER-SPECIFIED VERDICT, AND WHAT FOLLOWS

### 6.1 Why under-specified is the finding rather than a failure to find one

Five independent measurements converge, no two sharing a path:

1. **No surface defines the term** — §4.3, eight surfaces, each with a live positive control.
2. **The clause pre-dates every candidate artifact** — §2.1–2.2. `red-proof.mjs` by 39 min;
   `FAILURE_CLASSES` by 39 min; the `43` by 14 h 09 min; `evidence-order.mjs` by 17 h 06 min.
3. **The clause never changed while its putative population moved 11 → 43** — §3.3. Its text is
   byte-identical at all five graph versions.
4. **No ratifying act exists** — §2.4. Adoption ratified ordering; the requirement text was payload.
5. **The authoring context was never copied into the campaign** — §4.1, positive-controlled. The
   requirement arrived without its rationale.

**Combined with §5's reconciliation, the candidate landscape collapses:** candidates 1 and 3 are one
axis measured two ways; candidate 2 is the other axis; candidate 4 is a prose reading its own author
graded `[HYPOTHESIS]` and which §4.2 does not license either. ★ **No candidate is the referent
because at authorship there was nothing to refer to.** The clause named a property the future
harness must have and left the population to whoever built it. **Whoever built it then chose — and
what a doer chooses is not what a requirement specifies.**

### 6.2 Is `4d` dischargeable as written? **No.**

The **property** is measurable, and the campaign has measured it repeatedly. The **quantifier** is
unbound and cannot be bound from any artifact in or out of this tree. Concretely:

- Under the CAUSE axis it is dischargeable only against a population **the doer edits**, which
  places the finish line inside the instrument (§3.3).
- Under the EFFECT axis it needs the `module_collections` boundary settled — is the deliberately
  excluded gate a "terminal acceptance failure"? **That is a question about the clause's words, and
  the clause's words are the thing that is missing.**
- Under candidate 4 it needs a failure-mode map over every sibling clause that no artifact provides.

> **`4d` is not dischargeable as written.** Not because the harness is deficient — because the
> requirement is. **An unbindable quantifier cannot be satisfied or violated.**

⚠️ **This does NOT disturb `4d`'s NOT-MET status (R-600), and I checked that before writing it.**
Under every candidate `4d` is either NOT MET or UNMEASURED; **no candidate yields MET.** Nothing here
re-opens `P0PC`, and nothing here licenses a transition. What changes is the *remedy*: **the next
correct act is an authoring decision, not another instrument.**

**Correction to one of my own prior artifacts, per the lineage declaration:**
`GRADE-P0PC-4D-READING-2026-08-02.md:30` recorded clause `4d-i` at **band 8 / VERIFIED** on *"all 37
injection knobs exit 1."* **That band was scoped to a population that no requirement binds.** The
measurement (37 knobs exit 1) stands and I re-confirm the population is 37; **the certification of a
clause against an unbound quantifier does not.** On this read that row should have been
`UNVERIFIED — population unbound`. Recorded here rather than left for a future seat to rediscover.

### 6.3 What would settle it — three routes, ranked, none of them a new instrument

1. ★★★★★ **Ask the clause's author.** The clause has a known origin: `337cf11d`, external GPT
   advisor, branch `origin/external-advisor/gpt-rulings`. **This is the only route that recovers
   *intent* rather than *choice*.** It has never been tried, because the campaign did not know the
   clause had an external author with a surviving authoring document.
2. ★★★★ **An operator/authoring ruling that BINDS the population by fiat and says so.** Legitimate
   and cheap. It must be labelled a **decision**, never a **finding** — and per the standing
   constraint, **not made by the desk the clause blocks.** If taken, §5's reconciliation means
   binding to the CAUSE axis makes R-596–R-603's work count.
3. ★★★ **Amend the clause to name its population explicitly**, then re-measure. Most durable, and it
   ends the class rather than the instance: any acceptance clause quantifying over an unnamed
   population is the same defect waiting to recur.

**Route 2 or 3 must also fix the §3.3 defect**, or the bound population remains an array the doer
edits. A population pinned in the *requirement* cannot be moved by editing the *instrument*.

---

## 7. VERDICT TABLE

| System | Band | Status | Evidence | Open risks |
|---|---|---|---|---|
| **`4d`'s population — the R-607 question** | — | **UNDER-SPECIFIED · VERIFIED** | 5 converging measurements §6.1; clause pre-dates all candidates by 39 min–17 h 06 min; text byte-identical `c59801ba97821507` across 5 versions; no defining surface across 8 surfaces each positive-controlled | Intent is unrecoverable by measurement; only the author or an authoring act can close it |
| **Candidate 1 — `red-proof.mjs`'s 43** | — | **REJECTED as intent · VERIFIED** | Artifact created 39 min after the clause; the `43` 14 h 09 min after; assigning doc 16 h 10 min after, never ratified, own independence claim fails §2.5 | Remains the campaign's de-facto reading; **not** evidence of original intent |
| **Candidate 2 — `FAILURE_CLASSES` = 25** | — | **REJECTED as intent · VERIFIED** | `FAILURE_CLASSES` absent from `run.mjs` at the author's own stated epoch `8297ebbe`, positive-controlled (`CONTROL` 3, `const` 16, `import` 4 present) | The EFFECT axis is the better plain-English fit; `module_collections` boundary unsettled |
| **Candidate 3 — 37 knobs** | — | **NOT A RIVAL · VERIFIED** | `PINNED_KNOBS === CLASSES ∪ EXPECT`, exact both directions, zero difference; artifact created 17 h 06 min after the clause | Inherited by momentum with no licensing artifact — but **the same tables as candidate 1**, so R-596–R-603 are not voided |
| **Candidate 4 — sibling clauses** | — | **UNSUPPORTED · VERIFIED** | Authoring doc (§4.2) does not license it; author graded it `[HYPOTHESIS]`; nothing in 8 surfaces supports it | Cheapest to state, hardest to discharge; correctly deprioritised |
| **The `43` arithmetic (R-600 §10 / R-605 open item)** | 8 | **CONFIRMED · VERIFIED** | Two non-overlapping paths: manual source read + TS 5.9.3 AST. `16+2+21+2+2 = 43`; `FAILURE_CLASSES = 25` | None on the arithmetic. The population's **instability** (§3.3) is the finding, not the value |
| **`P0PC-CLAUSE-STATUS:143` "SAME POPULATION? false"** | — | **TRUE BUT MIS-CAPTIONED · VERIFIED** | 43 = rows, 25 = classes; 26 covered = 25 + deliberate `module_collections`; **zero** declared classes uncovered | R-606 escalated a unit mismatch into an alarm the doc's own prose disclaims |

**Bands are scoped to:** the artifacts at `1d622c0c` · the four candidate populations named in R-607 ·
the eight surfaces enumerated in §4.3 · TypeScript 5.9.3 / Node v24.13.0 as the counting engine.
No band above 8 is issued: nothing here included failure-injection against my own AST counter beyond
the single self-caught artifact in §8.2.

---

## 8. MANDATORY COVERAGE

### 8.1 What I verified, and via which two-plus non-overlapping paths

| claim | path 1 | path 2 | path 3 |
|---|---|---|---|
| `EXPECTED_ROW_COUNT = 43` | manual structural read of source arrays | TS 5.9.3 AST `elements.length` | `red-proof.mjs:452`'s own expression re-evaluated from AST counts |
| `FAILURE_CLASSES = 25` | manual read `run.mjs:746` | TS AST element count | red-proof's own completeness print reports 25 (instrument self-report, corroboration only) |
| clause first appears at `337cf11d` | `git log -S` pickaxe over `--all` | per-blob `grep -c` at each of the 5 graph commits | `git show --stat` on the creating commit |
| clause text never changed | sha256 of the extracted substring at 5 objects + working tree | field-level diff `337cf11d`→`9844355c` showing 90 changed JSON lines with the clause surviving | — |
| `red-proof.mjs` post-dates the clause | `--diff-filter=A` creation commit 03:54:33 | clause commit timestamp 03:15:14 | `FAILURE_CLASSES` first-introduction pickaxe → `1958ba5d` |
| population went 11 → 43 | per-commit object-DB blob + AST count (15 commits) | commit messages independently narrate 11/11 → 16/16 → 18/18 | — |
| `PINNED_KNOBS === CLASSES ∪ EXPECT` | set equality both directions | difference lists empty on both sides | arithmetic `16+21=37` and `43−37=6` accounted row-by-row |
| authoring commits not ancestors of HEAD | `git merge-base --is-ancestor` → NO | `git branch -a --contains` → external branch only | `docs/advisor-rulings/` absent at HEAD and on disk |
| design doc has no "acceptance" | `grep -oi` | Python UTF-8 decode + `str.count` | raw byte length + BOM check (137,116 B, no BOM) |
| `run.mjs`/`red-proof.mjs` unchanged `c9f5ab51`→HEAD | blob OID equality (`6410d619…`, `af540a02…`) | sha256 of materialised content vs object DB | — |

### 8.2 Positive-control witnesses for every absence claim

| absence claimed | positive control, SAME surface + SAME method | control result |
|---|---|---|
| `FAILURE_CLASSES` absent from `run.mjs` @ `8297ebbe` | `CONTROL`, `const`, `import` in that blob | **3 / 16 / 4** |
| `process.exit`, `exitCode`, `restored` absent @ `8297ebbe` | same three controls, same blob | **3 / 16 / 4** |
| `FAILURE_CLASSES` absent from the graph JSON | `acceptance`, `P0PC`, `red-proof` in the same file | **30 / 10 / 3** |
| phrase absent from `BLUEPRINT-V4-DRAFT.md` | `acceptance`, `Phase 1`, `red-proof` | **3 / 7 / 2** |
| `acceptance` absent from `P0-VNEXT-DESIGN` | `accept`, `red-proof`, two engines | **3 / 11**, both engines agree |
| phrase/`4d` absent from the adoption receipt | `P0PC`, `red-proof`, `acceptance` | **10 / 2 / 2** |
| authoring doc absent from campaign HEAD | `terminal acceptance failure`, `V4-PHASE1-EXECUTION-GRAPH` at HEAD | **10 / 8 files** |
| no defining occurrence tree-wide (tracked) | `acceptance`, `terminal`, `red-proof`, `FAILURE_CLASSES` | **92 / 165 / 64 / 17 files** |
| no defining occurrence incl. **untracked** | negative `ZZZ-NEVER-PRESENT-CONTROL-4D` → **0**; positive `restored control` → **9** | both as expected |

⚠️ **One control caught MY OWN instrument, recorded rather than buried:** my AST counter reported
`DECLARED_ROW_KEYS.elements = 6` and `derivationsAgree = false`. **That was my bug, not
`red-proof.mjs`'s.** `DECLARED_ROW_KEYS` (`:481-488`) is built from spread elements
(`...CLASSES.map(...)`), so its **AST element count is not its runtime length** — which is
`16+2+21+2+2 = 43`, and `derivationsAgree` is TRUE at runtime. `A SURPRISING RESULT ACCUSES THE
INSTRUMENT FIRST`; it was checked and the finding died. Recorded because a clean report that hides
its own near-miss is less trustworthy than one that shows it.

### 8.3 Join keys checked for every "identical / unchanged / matches" claim

| claim | join key used |
|---|---|
| clause text unchanged across 5 versions | **sha256 of the extracted clause substring** — not the file, field, or line number |
| `red-proof.mjs`/`run.mjs` unchanged `c9f5ab51`→HEAD | **git blob OID** |
| scratchpad copy faithful to the pin | **per-file sha256 vs `git cat-file blob`**, plus file counts on both sides (21 pinned / 3 copied, subset declared). `copy == working-tree` deliberately NOT used |
| 37 knobs identical to the two red-proof tables | **set equality on knob-name strings, both difference lists printed empty** |
| the 25 fully covered by the 43 | **class-name strings via `red-proof.mjs:592-594`'s own mapping** (`CLASSES[0] | SHARED[0] | EXPECT[1]`) |
| tree identity | **`rev-parse --git-common-dir`**, not `--show-toplevel` |
| measurements survive the HEAD move | **blob OID of each measured file at `1d622c0c` vs `5d8bc158`** (all 3 UNCHANGED) **+ clause substring sha256 at the new HEAD** (`c59801ba97821507`) — not "HEAD didn't move", which would have been false |

### 8.4 ⚠️ WHAT I DID **NOT** VERIFY

1. ★★★★★ **The author's actual intent.** The single irreducible gap. The clause's author is an
   external GPT advisor; the authoring document does not define the term; **no measurement in any
   tree can recover an intention that was never written down.** Everything in §6 is about what the
   evidence *supports*, never about what the author *meant*. **This is why route 1 in §6.3 is ranked
   first: it is the only route that closes this gap rather than papering it.**
2. **I did not execute `red-proof.mjs`, `run.mjs`, or `evidence-order.mjs`.** All counts are static
   (source read + AST) against object-DB blobs. **I therefore did not verify that the runtime prints
   `43` and `25`** — I verified the declarations they are computed from. A defect between declaration
   and print would be invisible to me. *(Non-execution was my choice: a live worker owns two files in
   that directory and running the harness could collide with its run. The restriction is mine and I
   name what it costs.)*
3. **I did not verify that the 43 rows actually exit non-zero, nor that the control exits zero.**
   That is the clause's *predicate*; R-607 sent me for its *population*. Relayed values are
   `RELAYED`, not adopted.
4. **The `module_collections` boundary question** — whether the deliberately-excluded early gate *is*
   a "terminal acceptance failure" — is **NOT settled here and cannot be**, because it depends on the
   definition §4 shows does not exist. It is a live open question under the EFFECT axis.
5. **I did not read the external branch beyond the two commits `337cf11d` and `9844355c`.** There may
   be later external-advisor commits bearing on the clause. `UNENUMERATED` — I enumerated the two
   commits that touch the clause's own file and stopped there.
6. **I did not audit the graph validator scripts** (`scripts/validate-v4-phase1-graph.mjs`,
   `test-validate-v4-phase1-graph.mjs`) beyond noting they were copied at `6d8c4f20`. Whether they
   check the `acceptance` field at all is **unmeasured** — and it is a reasonable next question, since
   a validator that never reads `acceptance` would independently corroborate §2.4.
7. **I did not verify the 4 `??`-untracked worker copies under `tmp/p0vnext-swallow-etIhPM/` are
   byte-identical to the tracked `evidence-order.mjs`.** They matched the phrase sweep; I treated
   them as run artifacts of a live worker and did not touch them.
8. **I report on no surface outside this question.** Per R-607's standing constraint, and noting two
   graders tonight appended false claims about a file neither brief mentioned: **I read no operator
   memory index, made no claim about one, and touched no `runtime-production` path.**

---

## 9. RECEIPT

**Written by:** `accuracy-validator`, independent reader under R-607. **The desk commits this; I do
not commit in the campaign tree.**
**Only file written here:** this receipt.
**Scratchpad (all execution):**
`C:/Users/tonio/AppData/Local/Temp/claude/C--Users-tonio-Projects-trading-forge/bf71e513-390a-4a0f-8dee-135d60168b22/scratchpad/population-read/`
— `ast-count.cjs` (Path B counter) · `set-compare.cjs` (class-set comparison) · `reconcile.cjs`
(four-candidate reconciliation) · `count-one.cjs` + `history.sh` (per-commit population history) ·
pinned blob copies of `red-proof.mjs`, `run.mjs`, `evidence-order.mjs`, `run-at-8297ebbe.mjs`.

**`prototypes/` status: CHANGED during the read — dirty at start, clean at end, because the live
worker committed (`35251ab7`, AR-651).** Full accounting in the header, including the three commits
that landed and the blob-identity proof that every measurement here survives them. **Recorded, not
fixed.** No `checkout`, `reset`, `stash`, `clean`, `commit`, or any index operation was run at any
point in this read.

★ **THE DURABLE LESSON, for the class rather than this instance:**
**`AN ACCEPTANCE CLAUSE THAT PRE-DATES EVERY ARTIFACT IT COULD QUANTIFY OVER BINDS NOTHING — AND A
POPULATION CHOSEN BY THE DOER AFTERWARD IS A CHOICE WEARING A REQUIREMENT'S CLOTHES.`**
Corollary, mintable now: **when a requirements object is copied between trees, copy its authoring
document or record that you did not.** This campaign spent six rulings and three grades on a
population question whose authoring record was one branch away the whole time.
