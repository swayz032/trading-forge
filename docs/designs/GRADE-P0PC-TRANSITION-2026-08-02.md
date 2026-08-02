# GRADE — P0PC TRANSITION: "ALL TEN ACCEPTANCE FRAGMENTS ARE MET"

**Independent `accuracy-validator`, dispatched by R-593 §5.1, briefed to REFUTE.**
**Date:** 2026-08-02 · **Tree:** `C:/Users/tonio/Projects/wt-h1-wave4-20260712` (linked worktree;
`git rev-parse --git-common-dir` → `C:/Users/tonio/Projects/trading-forge/trading-forge/.git`)
**Branch:** `h1-wave4-sealed12-driver` · **Object pinned at:** `c9f5ab51`

---

## §0 — PIN, VERIFIED THREE WAYS BEFORE ANYTHING ELSE (and re-verified after HEAD moved)

The brief asserted `prototypes/` is byte-identical between `c9f5ab51` and HEAD `d278e261`.
**`[MEASURED HERE]` CONFIRMED on three non-overlapping paths:**

1. `git diff --stat c9f5ab51 d278e261 -- prototypes/` → **empty**.
2. Tree-object identity: `git ls-tree <c> prototypes/` → `prototypes/p0-vnext-admission` is tree
   **`3bbae4faf3dff7e60ee8a523f5682c6109f7f2be` at BOTH commits.**
3. Per-blob: all **18** blob SHAs under `p0-vnext-admission/` identical at both commits.

🛑 **HEAD MOVED MID-GRADE — d278e261 → `c08bf85b`** ("ADVISOR-STATE: R-593 position").
**`[MEASURED HERE]` The object is UNAFFECTED:** `git diff --stat c9f5ab51 c08bf85b -- prototypes/`
is **empty**; the only change in the interval is `docs/designs/ADVISOR-STATE.md` (+15/−5).
**This verdict describes `prototypes/` as of `c9f5ab51`, tree `3bbae4fa`.** This is the fourth
consecutive grade in this campaign during which the target head moved.

**EXECUTION RIGHTS USED AND DISCHARGED.** Three `Edit`-based mutations were made and reverted
(never `git checkout`/`reset`/`stash`). **Final state `[MEASURED HERE]`: all 18 `sha256`s identical
to the opening baseline; `git status --porcelain -- prototypes/` EMPTY.**
No commit was made to `h1-wave4-sealed12-driver`. No scratch branch was needed.

---

## §1 — VERDICT

| System | Band | Status | Evidence | Open risks |
|---|---|---|---|---|
| `P0PC` acceptance — the ten-fragment claim | **7 / 10** | 🛑 **UNVERIFIED** — the claim as stated is **NOT** confirmed | 9 fragments re-derived or corroborated here; 2 novel injections of the grader's own design; full mutation of the F-2 conjunct; 6 scripts executed | **`4d` is UNKNOWN on one of its three obligations** (F-1). `4d`'s dropped clause has no instrument and two of its own cited evidence rows contradict its natural reading |

🛑 **THE CLAIM — *"All ten of `P0PC`'s acceptance fragments … are MET"* — DOES NOT SURVIVE.**
**NINE fragments hold. `4d` is `UNKNOWN`, and I decline to round it to MET or UNMET.**

✅ **This is a strong delivery and the band says so.** Every opening target except one came back
**NOT REFUTED**, three of them under attacks the doer had explicitly declared it had not run. The
single finding is not a bug in the instrument — it is a clause that fell out of the decomposition.

**LINEAGE DECLARED (`grading-integrity`):** this seat did not design, build or previously grade
`P0PC`. Prior grades in this lineage by other seats are recorded in `R-582/585/587/589/591`; **no
prior band was consulted in setting this one** — the band is re-derived from `c9f5ab51` only.

---

## §2 — 🛑 F-1 (CRITICAL) — CLAUSE `4d`'s THIRD OBLIGATION WAS LOST IN DECOMPOSITION, AND TWO OF THE 43 ROWS CITED AS ITS EVIDENCE CONTRADICT IT

```
### Discrepancy F-1: clause 4d's "after evidence collection" has no instrument, and its own
###                  evidence population contains the counterexample
**Severity:** CRITICAL (silent scope loss on a universally-quantified acceptance clause)
**Claim:** "every terminal acceptance failure exits non-zero after evidence collection while the
           restored control exits zero" — ruled MET (R-592 §4, re-affirmed R-593 §2)
**Reality:** the clause carries THREE obligations. (i) and (iii) are MET and I re-measured both.
           (ii) "after evidence collection" has NO instrument, was DELETED from the desk's own
           restatement, and two of the 43 rows the artifact cites as 4d's evidence exit non-zero
           having printed 5 of the control's 225 lines.
**Sources compared:**
  [acceptance text @ graph node: "...exits non-zero AFTER EVIDENCE COLLECTION while..."
 | R-592 §1 desk restatement: "4d terminal failure non-zero / restored control zero"  <- CLAUSE GONE
 | artifact :111 bearing-prints column: CONTROL line, 43 PASS rows, CONTROL GREEN, VERDICT, allOk
   — none of which speaks to ordering
 | MEASURED stdout volume: clean 225 lines exit 0 · module_collection_add 5 lines exit 1
   · module_collection_delete 5 lines exit 1 · fixture_invalid 230 lines exit 1]
**Source of truth:** the acceptance text in
  docs/designs/V4-PHASE1-EXECUTION-GRAPH-2026-08-02.json (blob 876c3a23), which says EVERY.
**Fix point:** run.mjs:138 `process.exit(1)` — or, if the early exit is intended, the desk must
  rule on what "evidence collection" means and 4d needs an instrument either way.
**Repro:**
    cd prototypes/p0-vnext-admission
    node run.mjs | wc -l                                  # 225, exit 0
    PROTO_INJECT=module_collection_add  node run.mjs | wc -l   # 5,  exit 1
    PROTO_INJECT=module_collection_delete node run.mjs | wc -l # 5,  exit 1
    PROTO_INJECT=fixture_invalid        node run.mjs | wc -l   # 230, exit 1
**Blast radius:** P0PC is the head of the 11-hop hard chain to BFREEZE (R-591 §3). A transition
  ruled on "ten of ten" propagates an unsettled fragment down all eleven hops.
```

### §2.1 — THE DECOMPOSITION LOSS, SHOWN SIDE BY SIDE

**Acceptance sentence 4, verbatim from the node:**
> "The effective compiler-emitter-loader tuple is an input; one source is executed as CJS and ESM;
> exactly one callable project export is required; **every terminal acceptance failure exits
> non-zero after evidence collection while the restored control exits zero.**"

**R-592 §1's split, verbatim:**
> "**Sentence 4** (four conjuncts) → `4a` tuple-is-an-input · `4b` CJS+ESM · `4c` exactly one
> callable export · **`4d` terminal failure non-zero / restored control zero**."

🛑 **The words *"after evidence collection"* do not appear in the desk's restatement.**
The artifact (`:111`) quotes the fragment **in full** — so the ARTIFACT preserved the clause and
the **DESK's decomposition dropped it**, then ruled the fragment MET.

`4d` therefore carries **three** independently-checkable obligations, not two:

| | obligation | instrument | status |
|---|---|---|---|
| 4d-i | terminal acceptance failure **exits non-zero** | red-proof's 43 rows, each `exit=1` | ✅ **MET** `[MEASURED HERE]` — 43/43 reproduced |
| 4d-ii | …**after evidence collection** | **NONE** | 🛑 **UNKNOWN** |
| 4d-iii | the **restored control exits zero** | clean control + `sha256` before/after | ✅ **MET** `[MEASURED HERE]` at my own hands, post-mutation |

### §2.2 — WHY 4d-ii IS NOT A PEDANTIC READING

**`[MEASURED HERE, executable lines]`** `run.mjs` has exactly **two** terminal non-zero paths:

- **`:840` `process.exitCode = failures.length ? 1 : 0;`** — the `FAILURE_CLASSES` path. Runs
  **after** the whole evidence body prints. **Satisfies 4d-ii.** (`[MEASURED HERE]` `grep -c
  'process.exitCode' run.mjs` = **1** — this is the only `exitCode` assignment in the file.)
- **`:138` `process.exit(1)`** — inside the `collectionFindings.length` block, which `:106-107`
  states **"RUNS BEFORE ANYTHING ELSE"** and `:117` **"then exits immediately — nothing downstream
  can downgrade it."** **Prints 5 lines and terminates.**

**Is the `:138` class a "terminal acceptance failure"?** By the instrument's own framing, yes:
it prints the same `GATE: FAIL (n class(es))` banner as `:840`; `run.mjs:117` says it "names its
class **so `red-proof.mjs` can assert it exactly like any other class**"; and
**`[MEASURED HERE]` `module_collection_delete` and `module_collection_add` are `PASS` rows 36 and
37 of red-proof's 43** (stdout lines 40-41) — members of the exact population `:111` cites as
`4d`'s evidence. It is
deliberately *not* a `FAILURE_CLASSES` entry (`:107-108`), but that is a structural choice about
*where the check lives*, not a claim that it is not a gate failure.

★★★★★ **AND THE FILE ALREADY KNOWS.** `run.mjs:96-100` moved the `EFFECT-DIGEST` emission into a
`process.on('exit')` hook for exactly this reason, in its own words:

> "Emitted from an `exit` hook rather than at the end of the file, **because the collection gate
> below EXITS EARLY (`process.exit(1)`)** — a fingerprint missing exactly when a class fires would
> be blind to the classes that matter most."

**The instrument built a workaround for the early exit's evidence suppression, and nothing
anywhere checks the clause that the early exit bears on.**

### §2.3 — WHY I SAY `UNKNOWN` AND NOT `UNMET`

Two readings of "evidence collection" are available and **no ruling has ever chosen between them**:

- **(A) the run collects its diagnostic body, then exits non-zero.** Under (A) the `:138` path
  **VIOLATES** `4d` — measured, 5 lines vs 225.
- **(B) the failing class's own finding is printed before exit.** Under (B) `4d` is satisfied
  everywhere, trivially — `:135-137` do print the finding and the `INJECTION:` line.

**The fragment cannot be ruled MET under either reading, because under (A) it is false and under
(B) it was still never measured.** `UNKNOWN` is the honest answer and I decline to round it.

**RECOMMENDED CLOSURE (not ordered — this is a grader's note):** the desk rules which reading
governs; if (A), `4d-ii` needs a discriminating fixture — e.g. assert that a failing run's stdout
contains the `LIKE-FOR-LIKE` block — which would go **RED** today on the two `module_collection_*`
rows and **GREEN** on the other 41. That fixture has an obvious path to red, which `feedback:
green-check` requires and which `4d` currently has none of.

---

## §3 — 🛑 F-2 (MEDIUM, DESK AUDIT) — R-592 §2's "THREE NON-OVERLAPPING PATHS" ARE THREE READINGS OF ONE INSTRUMENT

```
### Discrepancy F-2: a same-path confirmation captioned as three non-overlapping paths
**Severity:** MEDIUM (method defect; the conclusion it reached is nonetheless defensible)
**Claim:** R-592 §2 — "[MEASURED HERE, three non-overlapping paths] … THE ARTIFACT IS CORRECT
           AND THE HEADER IS WRONG" (ten fragments, not eleven)
**Reality:** all three paths enumerate the DOER'S ARTIFACT. Zero go to the acceptance text.
**Sources compared:**
  [path (i) "enumerating AR-635 §2's summary list" -> the artifact's own summary
 | path (ii) "grep -oE 'READING_(PRESENT|ABSENT|AMBIGUOUS)' over the artifact" -> the artifact
 | path (iii) "enumerating the artifact's table rows :102-111" -> the artifact]
**Source of truth:** the `acceptance` field of node P0PC in the graph JSON — consulted by none
  of the three paths.
**Fix point:** docs/designs/ADVISOR-RULINGS.md R-592 §2 — the caption, not the conclusion.
**Repro:** read R-592 §2 and name, for each of (i)(ii)(iii), the file it reads. All three: the
  artifact.
**Blast radius:** the count TEN is load-bearing for R-593's "all ten … are MET".
```

**The question at issue was *"is TEN the right number of fragments?"* That is answerable only from
the ACCEPTANCE TEXT. A method that counts the artifact three times cannot discover an eleventh
fragment — it can only ever return the artifact's own row count.** This is the campaign's own law
(`feedback: audit-population` — *"a grade reproducing its instrument isn't a 2nd path"*) applied
to a ruling rather than to code.

⚠️ **R-592 §1 IS THE NEAR-MISS, AND IT DOES NOT RESCUE §2.** §1 does go to the text
(`"the four acceptance sentences extracted from the graph node and mapped against the artifact's
ten rows"`) and certifies the split **"CORRECT and COMPLETE, with no acceptance text unmapped."**
But it maps text **onto the artifact's pre-existing ten rows** — it starts from the answer — and
*"no text unmapped"* is a strictly weaker property than *"no obligation left unsplit."*
**F-1 is the proof that the mapping was not obligation-complete:** the desk's own `4d` caption
drops a clause that the artifact's own verbatim quote preserves.

✅ **HONEST NULL ATTACHED — I TESTED THE OBVIOUS ALTERNATIVE AND IT IS FALSE.** I hypothesised the
struck header's *"ELEVEN"* was a competing, more consistent decomposition that the correction
retired. **`[MEASURED HERE]` It was not:** both git revisions of the artifact
(`59514ace`, `c9f5ab51`) contain **exactly ten table rows**, ids `1a 1b 1c 1d 2 3 4a 4b 4c 4d`.
**The header was a plain prose miscount and R-592 §2's conclusion is right.** Only its method is
mis-captioned.

⚠️ **Split asymmetry, recorded but NOT raised as a finding.** The applied rule splits sentence 1 at
`;` **and** at `,` (four fragments) but sentence 2 not at all (`", with POSITION_UNCLASSIFIED
fail-closed"` is a comma-delimited obligation that got no fragment of its own). **I measured
fragment `2`'s three fused obligations individually and all three carry evidence (§5.4), so
nothing is lost — this is hygiene, not a hole.** The same fusion in `4d` is where it cost
something.

---

## §4 — ⚠️ F-3 (LOW, CAPTION) — `red-proof.mjs:601` SAYS "DEMONSTRATED" FOR A DECLARATION-TO-DECLARATION JOIN

**`[MEASURED HERE, executable lines :589-601]`** `uncoveredFailureClasses` = run.mjs's declared
`FAILURE_CLASSES` **minus those NAMED in red-proof's `CLASSES`/`SHARED`/`EXPECT` tables.** That is
a declaration-to-declaration join. The line prints
*"all 25 of run.mjs's declared FAILURE_CLASSES have a **demonstrated** red path — ASSERTED, not
assumed."* **Nothing in that check observes a red path.**

✅ **NO HOLE.** Demonstration is separately asserted by `rows.every((r) => r.ok)` inside `allOk`
(`:603`), so the composite property does hold. **R-593 §3's reading of F-3 is CONFIRMED live at
`c9f5ab51` and it is correctly scoped as a caption defect.** `feedback: report-table` — the fix is
at the emitter, one word: `declared` in place of `demonstrated`.

---

## §5 — WHAT I ATTACKED THAT HELD (the honest nulls — four of the five opening targets)

### §5.1 — ✅ TARGET 1 & 3 — `1d` GENERALIZES. **REFUTATION ATTEMPTED WITH TWO INJECTIONS OF MY OWN DESIGN; IT FAILED.**

`AR-636 §5` declared three non-dos: only two injections tested, and **neither of the doer's own
design** — both were the object's pre-existing plants. **I built two new ones and ran them.**

| | route | row | TS code | mechanism | result |
|---|---|---|---|---|---|
| doer | `fixture_invalid` | `48` | TS2554 | arity | `48` → `fixture_invalid` |
| **grader** | `fixture_invalid` | **`49(a)`** | **TS2345** | **argument type** | **`49(a)` → `fixture_invalid`** |
| doer | `surface_invalid_rows` | `35(b)` | TS7006 | implicit-any param | `35(b)` → `surface_invalid` |
| **grader** | `surface_invalid_rows` | **`49(b)`** | **TS7017** | **globalThis index** | **`49(b)` → `surface_invalid`** |

**`[MEASURED HERE]` the four-way members comparison:**

| run | `48` ∈ attributed | `49(a)` ∈ attributed | `35(b)` ∈ attributed | excluded population | sums | in_two / in_none |
|---|---|---|---|---|---|---|
| CLEAN | true | true | true | both empty | 52 | `[]` / `[]` |
| doer fixture `48` | **false** | true | true | `fixture_invalid: ["48"]` | 52 | `[]` / `[]` |
| doer surface `35(b)` | true | true | **false** | `surface_invalid: ["35(b)"]` | 52 | `[]` / `[]` |
| **grader fixture `49(a)`** | true | **false** | true | `fixture_invalid: ["49(a)"]` | 52 | `[]` / `[]` |
| **grader surface `49(b)`** | true | true | true | `surface_invalid: ["49(b)"]` | 52 | `[]` / `[]` |

**Cross-row isolation holds on my injections too — each moves exactly its own row.**

✅★★★★★ **AND THE MECHANISM CORROBORATES THE WITNESSES, WHICH IS WHY I CALL THIS SETTLED RATHER
THAN MERELY UNREFUTED.** `[MEASURED HERE, exhaustive grep of both identifiers across `run.mjs` and
`source-admission.mjs`]` **there is EXACTLY ONE assignment site per excluded population** —
`run.mjs:289` for `SURFACE_INVALID`, `run.mjs:294` for `FIXTURE_INVALID` — and the partition
(`:604-605`) keys on **the status string alone**. Every route through either code list
(`SURFACE_CODES`, 7 codes; `FIXTURE_INVALID_CODES`, 6 codes) converges on that one line. **Four
observed witnesses across two populations, four rows and four distinct TS codes, plus a
single-assignment-site mechanism. `1d` is MET and it generalizes.**

### §5.2 — ✅ TARGET 3 — F-2's DEAD-vs-FALSE QUESTION: **THE DESK IS RIGHT.** MEASURED, NOT READ.

R-593 §3 flagged its own reasoning for attack: *"`F-2` is a DEAD conjunct, not a FALSE one."*

**`[MEASURED HERE]` mutation `red-proof.mjs:451` `STANDALONE_ROWS = 2` → `3`, full 43-row suite
re-run, then reverted:**

```
*** STOP CONDITION (F-1): built 43 rows, expected exactly 44 ...
*** STOP CONDITION (F-1b): the built rows do not MATCH the declared rows one-for-one.
***   derivations disagree: 43 declared keys vs 44 counted — the guard itself is inconsistent
VERDICT: NOT a gate. row COUNT 43 != declared 44 | row IDENTITY broken (0 never ran, 0 ran more
         than once, 0 undeclared)
```

**Three things this measures at once:**
1. `derivationsAgree` **does have a live path to red** — it fired, and it fired **alone** among the
   identity terms (all three sub-counts printed `0`). ⚠️ **So R-593 §3's stronger phrasing —
   *"a vacuous conjunct sits inside the top-level gate"* — is an OVERSTATEMENT. It is not vacuous;
   it is SUBSUMED.** The desk's *conclusion* is right and its *adjective* is not.
2. `countOk` fired on the same mutation. **`derivationsAgree` never fires alone at the gate level.**
3. The reduction is exact: flipping `STANDALONE_ROWS` flipped the conjunct, confirming
   `derivationsAgree ≡ (2 === STANDALONE_ROWS)` **with the four tables shared**.

**Subsumption is TOTAL, and here is the argument the measurement supports:** `derivationsAgree`
is false ⟺ `|DECLARED_ROW_KEYS| ≠ EXPECTED_ROW_COUNT`. If additionally `rows.length =
EXPECTED_ROW_COUNT`, then `|DECLARED_ROW_KEYS| ≠ rows.length`, so the declared and witnessed
multisets differ, so one of `declaredNotUnique` / `neverWitnessed` / `witnessedRepeatedly` /
`witnessedUndeclared` is non-empty. **Every state that reddens `derivationsAgree` also reddens
`countOk` or another identity term. `allOk` is never made wrong by it.**
✅ **DEAD, NOT FALSE. `4d`'s evidence is not compromised by F-2.**

### §5.3 — ✅ TARGET 6 — THE `613a7c15`→`c9f5ab51` DIFF WEAKENED **NOTHING**

**`[MEASURED HERE]` `+206 / −3`** (reproduces R-593 §3 exactly). **All three deletions enumerated:**

| deleted line | replaced by | direction |
|---|---|---|
| `const fcIsControl = fcW.provenanceOk && fcW.token.startsWith(CONTROL_PREFIX);` | same **`&& freezeArtifactOk`** | **STRONGER** |
| `const occIsControl = occW.provenanceOk && occW.token.startsWith(CONTROL_PREFIX);` | same **`&& occArtifactOk`** | **STRONGER** |
| `const allOk = controlOk && countOk && identityOk && provenanceOk && completenessOk && rows.every(...)` | same **`&& effectOk`** (7th conjunct) | **STRONGER** |

✅ **Nothing weakened.** `[MEASURED HERE]` `derivationsAgree` existed at `613a7c15:352` with the
**identical** definition — **F-2 predates the batch and was not introduced by the +206.**

### §5.4 — ✅ FRAGMENT `2`'s THREE FUSED OBLIGATIONS ALL CARRY EVIDENCE

`[MEASURED HERE, `node type-value-proof.mjs`, exit 0]`

| | obligation | observed | verdict |
|---|---|---|---|
| 2-i | "Type-only identifiers stay silent" | `PASS D Widget in TYPE-ONLY position ADMITTED [-]` · `FREE_REF on Widget = 0` | ✅ |
| 2-ii | "the same spelling in value position is **exclusively** `FREE_REF`" | `PASS E … REJECTED [1b-S:free-captured-reference]` — a **singleton** catcher list, which is what carries "exclusively" · `same spelling in both arms: true` | ✅ |
| 2-iii | "`POSITION_UNCLASSIFIED` fail-closed" | `RESIDUAL REACHABLE (POSITION_UNCLASSIFIED can actually fire): true` + `run.mjs` `position_unclassified` FAILURE_CLASS + red-proof row `PASS position_unclassified exit=1` | ✅ |

`15 / 15 cases pass | property HOLDS`. **Fragment `2` is MET on all three, and unlike `4d` nothing
was lost by fusing them.**

### §5.5 — ✅ TARGET 5 — THE `43` vs `25` MAPPING IS CORRECT, VERIFIED BY EXECUTION

`[MEASURED HERE, `node red-proof.mjs`, exit 0, stderr 0 bytes]` — **two separate prints, two
separate populations, exactly as R-592 §3 ruled:**

```
line 50: COMPLETENESS (F-4): all 25 of run.mjs's declared FAILURE_CLASSES have a demonstrated red path
line 51: CONTROL GREEN: true | CLASSES WITH A DEMONSTRATED RED PATH: 43 / 43
line 52: VERDICT: the runner is an ENFORCING GATE
```

✅ **`4d` rests on the `43` line and that is the right denominator for it** — `43` is red-proof's
own row population (`16+2+21+2+2`), and `4d` quantifies over terminal acceptance failures, which
these rows enumerate across all six scripts rather than only over `run.mjs`'s 25 named classes.
**The desk did not rule a fragment MET on the wrong denominator.**
⚠️ **One residual, non-blocking:** the `43` rows resolve to **38** distinct effect tokens
(`EFFECT IDENTITY: 38 … pairwise-distinct=true`) and no print reconciles 43 against 38. The
shortfall is structural (`SHARED` rows reach a second class through another injection) and both
directions of the 38 are pinned, so this is a caption gap, not a coverage gap.

### §5.6 — ✅ R-593 §0's MECHANISM CLAIM HOLDS (`premise-audit`: a mechanism claim gets its own test)

**Claim:** *"an `EXIT 0` run with a populated excluded population is impossible by design."*
`[MEASURED HERE]` both predicates read at the executable line — `run.mjs:765`
`likeForLike.six_population_partition.surface_invalid > 0`; `:772`
`results.some((r) => r.status === 'FIXTURE_INVALID')` — **and `grep -c 'process.exitCode' run.mjs`
= 1**, so `:840` is the single arbiter. **Plus four executed witnesses: all four populated-
population runs (2 doer routes + 2 of mine) exited `1`.** ✅ **CONFIRMED on two paths.**

### §5.7 — ✅ CLAUSE `1a`'s "FROZEN 52" IS NOT A SUM-vs-SUM TAUTOLOGY

I checked for `pattern: both_operands_from_the_same_declaration`. **`[MEASURED HERE]`
`run.mjs:629` `partition_must_sum_to: 52` and `:766` `partitionSum !== 52` are hard **literals**,
while `partitionSum` is accumulated from the pinned population; `membership.mjs:122`
`EXPECTED_CARDINALITY = 52` is an independent second declaration whose pin is asserted by a throw
at `:124`. **Two independent operands. `1a` is soundly instrumented.**

---

## §6 — MANDATORY CLOSING COVERAGE

### 6.1 — What I verified, and via which two-plus non-overlapping paths

| claim | path A | path B | path C |
|---|---|---|---|
| pin: `prototypes/` identical `c9f5ab51`↔HEAD | `git diff --stat` empty | tree object `3bbae4fa` equal | 18 blob SHAs equal |
| object unchanged after my mutations | 18 `sha256`s vs opening baseline | `git status --porcelain -- prototypes/` empty | `run.mjs` stdout byte-identical to pre-mutation control |
| `4d-i` non-zero exit | red-proof 43/43 re-run here | 4 direct `PROTO_INJECT` runs, all exit 1 | — |
| `4d-ii` ordering **(THE FINDING)** | stdout line counts 225 vs 5 | `run.mjs:138` executable line + `:96-100` self-documenting comment | red-proof rows 40-41 place the offenders inside 4d's cited population |
| `4d-iii` restored control zero | `run.mjs` exit 0, stderr 0B, stdout byte-identical | 5 sibling scripts exit 0 | 18 `sha256`s restored |
| `1d` credit-denial | doer's 2 routes reproduced here | **2 novel routes of my own design** | single-assignment-site mechanism (`:289`,`:294`) |
| F-2 dead-not-false | executed mutation, full suite | algebraic subsumption over the identity terms | pre-existing at `613a7c15:352` |
| `43` vs `25` | executed red-proof, two distinct printed lines | source read at `:452` and `:589` | R-592 §3 (relayed, corroborating only) |
| fragment `2` × 3 | executed `type-value-proof.mjs` | singleton catcher lists in the case table | — |
| the `+206/−3` diff | `git diff --stat` | full enumeration of all 3 deleted lines with replacements | `allOk` compared at both commits |

### 6.2 — Positive-control witnesses for every absence claim I make

| absence claim | positive control |
|---|---|
| **"no instrument asserts 4d-ii"** | the search term is **live**: `"evidence collection"` returns **4 real hits** (artifact `:84`, `:111`, `:277`; `AGENT-REPORTS.md` AR-636 §5) — so the grep works. It returns **zero executable lines** under `prototypes/`; the sole `prototypes/` hit is `run.mjs:98`, a **comment describing the opposite behaviour**. Second surface: I enumerated the bearing-prints column of artifact `:111` item by item — CONTROL line, 43 rows, CONTROL GREEN, VERDICT, `allOk` — none is an ordering assertion. |
| **"only one assignment site per excluded population"** | grepping the same two identifiers **does** return other hits (`:604`, `:605` partition keys; `:772` failure class; `:170/174/179` comments) — the search is not silently empty. Exactly one `return { status: ... }` per population. |
| **"the artifact never had 11 rows"** | the same extraction run against **both** git revisions returns a **non-empty** ten-id list each time — it is not an empty-result artefact. |
| **"F-2 cannot fire alone"** | I did **not** assert this from a clean run. I **forced it red** and observed it print alongside `countOk`. A conjunct I could not redden would have been an unproven absence. |
| **"nothing in the +206 weakened a check"** | I enumerated **all three** deletions rather than reporting "no weakening found" — the deletion set is closed and printed above. |

### 6.3 — Join keys checked for every "identical / unchanged / matches" claim

- **prototypes byte-identical:** join key = **git tree OID** `3bbae4fa…` and 18 **blob OIDs**, not file names or line counts.
- **restored byte-identical:** join key = **`sha256` per file** (all 18), plus stdout `diff` against the pre-mutation control.
- **object still pinned after HEAD moved:** join key = `git diff c9f5ab51 c08bf85b -- prototypes/`, **not** `git status`.
- **`module_collection_*` are inside 4d's evidence population:** join key = the **`PASS`-row labels in red-proof's own stdout** — ordinals **36 and 37 of 43** (stdout lines 40-41) — not the injection names.
- **`43` vs `25`:** join key = the **two distinct printed lines** (50 and 51) in one run, not two runs.
- **desk restatement dropped the clause:** join key = the **verbatim substring** `"after evidence collection"` present in the node's `acceptance` and in artifact `:111`, absent from R-592 §1.

### 6.4 — 🛑 WHAT I DID **NOT** VERIFY

1. **Fragments `1b`, `1c`, `3`, `4a`, `4b`, `4c` were NOT independently re-derived.** I confirmed
   each has a live instrument that runs and exits 0, and I read the artifact's bearing prints, but
   I did **not** build discriminating fixtures for them. **They are `CORROBORATED`, not
   `MEASURED HERE`.** A future grade wanting ten-of-ten at band 9 owes them the same treatment
   §5.1 gave `1d`.
2. **I did not run all 43 red-proof rows under mutation** — only the clean suite (twice) and the
   one `STANDALONE_ROWS` mutation. Row-level red paths are `MEASURED BY GRADED INSTRUMENT`.
3. **I did not enumerate the full `SURFACE_CODES` × `FIXTURE_INVALID_CODES` space** (7 + 6 = 13
   codes). I tested 4. The generalization to the remaining 9 rests on the single-assignment-site
   mechanism (§5.1), which is **read, not executed, for those 9**.
4. **The `INSTRUMENT FAULT` throw sites** (`run.mjs:201/397/410/412/738`; 11 in `membership.mjs`;
   6 in `module-collections.mjs`) also terminate non-zero with no evidence body. **I did not
   determine whether they are "terminal acceptance failures" within `4d`'s meaning** — they are
   captioned as instrument faults, a plausibly distinct category. **If the desk rules they are in
   scope, F-1's blast radius grows by ~22 sites.** This is the largest thing I left open.
5. **I did not grade `P0PC`'s `outputs` list** (8 items) — only the `acceptance` field, which is
   what the claim quantifies over.
6. **No second reader.** This verdict is one seat. Per `ops: second-reader-anchoring`, any read
   that postdates and cites this document is **not** a second path on it.
7. **`runtime-production` NOT touched, NOT read.** No trading, capital or runtime behaviour was
   authorized, executed or inspected. No commit, no branch, no push. No monitor armed or killed.

---

## §7 — DECISION INPUT FOR THE DESK

🛑 **`P0PC` SHOULD NOT TRANSITION ON THE TEN-OF-TEN CLAIM AS WRITTEN.** Nine fragments hold under
adversarial attack — genuinely, including two attacks the doer had declared undone. **`4d` is
`UNKNOWN` on one of its three obligations, and it is the fragment whose clause the desk's own
decomposition deleted.**

★★★★★ **THE LESSON, STATED FOR THE LEDGER: `A FRAGMENT IS LOST NOT WHEN ITS TEXT GOES UNMAPPED
BUT WHEN ITS OBLIGATIONS GO UNCOUNTED.` R-592 §1 certified "no acceptance text unmapped" and was
right. Ten rows covered every word. But `4d` carried three obligations into one row, the desk's
restatement kept two, and the ruling that said `MET` was answering the restatement.**

★★★ **AND THE SECOND: `THREE READINGS OF ONE ARTIFACT IS ONE PATH.` The count TEN was confirmed
against the thing being counted, three times. It happens to be correct. The method could not have
found out otherwise.**
