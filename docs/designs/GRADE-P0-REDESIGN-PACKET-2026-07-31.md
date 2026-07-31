# INDEPENDENT DESIGN GRADE — `P0-REDESIGN-PACKET-2026-07-31.md` @ `7134bb34`

**Grader:** `accuracy-validator` (pre-implementation architecture grade)
**Date:** 2026-07-31
**Object under grade:** `docs/designs/P0-REDESIGN-PACKET-2026-07-31.md`, blob `0d6b0425579c967b9d7ed4dc3c487bce862575a0` (150 lines, 20,206 B) [MEASURED HERE]
**Pinned commit:** `7134bb343a43389b894f78e1ab57aa62d4bebd3c`, branch `h1-wave4-sealed12-driver` [MEASURED HERE]
**Tree:** `C:/Users/tonio/Projects/wt-h1-wave4-20260712` (linked worktree; `git rev-parse --git-common-dir` → `C:/Users/tonio/Projects/trading-forge/trading-forge/.git`) [MEASURED HERE]
**Evidence base graded against:** `GRADE-C304B098-2026-07-31.md`, blob `027e14303b0f074daeb23c427913be6107f30288` · code `git show c304b098:scripts/check-spec-binding-plan-parity.ts`, blob `48d5cc9522a61d8539d8c9427abb90550e8b011e`, 1536 lines [MEASURED HERE]

> **HEAD MOVED.** At grade time the tree's `HEAD` was `82c17515`, not the pin. `7134bb34` is an ancestor of `82c17515` (`git merge-base --is-ancestor` → yes); the two intervening commits (`05a041da`, `82c17515`) are receipt/state commits. **This verdict describes blob `0d6b0425` at `7134bb34` and nothing else.** [MEASURED HERE]

---

## VERDICT: **FAIL — NAMED DESIGN DEFECT**

**Do not implement as written.** One defect, and it is disqualifying because it is the HIGH finding's own mechanism surviving the redesign.

The packet is, in most respects, the strongest artifact this lineage has produced. It refuses to manufacture a common mechanism where none exists (§2 vs §4.4); it correctly discovers — and partly refutes its own authorizing ruling over — the fact that **no `OracleRow`-scoped rule can close `F-3`** (§2 line 67); it expresses scope control as a **delta against a recorded baseline** and red-proofed that guard on itself, finding it already-red and rewriting it (§6.4); and its red-proof includes a **clean control**, the thing this campaign most often omits. Its line citations are accurate: I checked five and all five resolve.

The defect is a single hole, in one specific place: **the place its own §2 law predicts, and the place the HIGH finding lives.**

### The one-line statement

> **§4's architecture is closed under the TYPO operator and open under the DELETE operator, at the same granularity.**
> `bindable` → `bindible` becomes RED (§4.1 rejects the unknown key). **Deleting `bindable` outright stays GREEN, byte-identical, exit 0** — no unknown key is introduced, no type is wrong, and the row surface has no totality rule. That is `F-2`'s exact symptom, reachable by a *smaller* edit than the mutation `F-2` was found with.

---

## Finding D-1 — CRITICAL — a row's expectation deleted (not typo'd) still passes silently under §4.1–4.3

**Severity:** CRITICAL (false green; the HIGH finding `F-2`'s own mechanism, uncovered by the replacement architecture and untested by its pre-registered red-proof)

**This is the direct answer to the brief's Question 1, middle clause — *"can a missing required key pass silently?"* — and the answer is YES.**

### The evidence, by two non-overlapping paths

**Path A — the executable lines of the object being redesigned [MEASURED HERE].**
Every row expectation in `checkOracle()` is read under present-or-skip. All eight read sites, enumerated by `grep -n "want\." `:

| line | guard |
|---|---|
| `:714` | `!isGap("bindable") && want.bindable !== undefined && …` |
| `:717` | `if (want.primitive_null !== undefined)` |
| `:723` | `want.session_zone !== undefined && …` |
| `:726` | `!isGap("approximation") && want.approximation !== undefined && …` |
| `:729` | `want.reason_null === true && …` |
| `:732` | `want.reason_null === false && …` |
| `:735` | `if (want.reason_names !== undefined)` |
| `:741` | `if (want.reason_excludes !== undefined)` |

An absent key satisfies none of these guards, so it emits **nothing**.

The file contains **exactly one** omission-guard, and it is not on the row. `grep -n "omitted"` returns four hits, all in one block:
- `:619` — `/** Required iff any of the three scalars above is omitted. */`
- `:667` — `const omitted = scalars.filter(([, want]) => want === undefined)…`
- `:668` — `if (omitted.length > 0 && !expect.scalars_unadjudicated) {`
- `:672` — the failure message

That block is scoped to the three **plan scalars** (`spine_total`, `spine_bound`, `compiled`). **No equivalent computation exists for the row's expectation set.**

The `OracleRow` interface (`:576-605`) confirms this is structural, not incidental: **every** expectation field is optional — `bindable?`, `primitive_null?`, `session_zone?`, `approximation?`, `reason_null?`, `reason_names?`, `reason_excludes?` — and `unadjudicated?` is optional too. Only `authority: string` is required. **A row consisting of `{"authority": "…"}` is type-valid, asserts nothing, declares nothing, and prints nothing.**

The row's `unadjudicated` machinery is **one-directional**. At `:694-708` it catches the *contradiction* direction (a field declared as a gap **while** carrying a live expectation). It never checks the *silent-void* direction (a field carrying **neither** an expectation **nor** a declared gap). That is precisely the asymmetry `:667-675` exists to prevent — applied to scalars and not to rows.

**Path B — the graded instrument's own measurements, which entail the same conclusion independently of my reading [MEASURED BY GRADED INSTRUMENT, grade `:51-62`].**
The grade measured five key-typo mutations producing stdout **byte-identical** to the clean PASS at `EXIT=0`. A typo is two simultaneous edits: *known key removed* **+** *unknown key added*. Since the unknown-key sibling is provably ignored (nothing enumerates the row's key set — grade `:66`), the byte-identical output **entails** that the removal of the known key produced no output either. **The grade's own six mutations already demonstrate that an absent row expectation is silent** — nobody read that consequence out of them, because every registered mutation happened to be a typo or a type slip, never a pure deletion.

These are non-overlapping: Path A is a static read of executable lines performed here; Path B is an execution performed by a different instrument. Neither re-runs the other's query.

### Why §4.1, §4.2 and §4.3 each fail to reach it [MEASURED HERE, by reading the packet]

| section | what it closes | does it reach a deleted row expectation? |
|---|---|---|
| §4.1 `OracleRow` closed-key (`:103`) | *"rejects any key **not on** it"* — **unknown** keys | **No.** A deletion introduces no unknown key. |
| §4.2 per-key type-check (`:106`) | a **wrong type** on a **present** key; prescribes *"read `reason_null` **if present** → assert boolean → then branch"* | **No.** Absent ≠ wrong-typed. The wording explicitly preserves present-or-skip for absence. |
| §4.3 distinctness census (`:109`) | `reasons_must_differ_from` at **fixture** level; *"Precedent B moved **one surface** across"* | **No.** Wrong surface, and the packet says so in its own words — one surface, not two. |

The packet's §2 sub-mode table (`:63-65`) makes the gap explicit rather than accidental: sub-mode **(c) REQUIRED key absent** is assigned exactly **one** exemplar — `delete reasons_must_differ_from (F-3)` — and §4.3 is the only section that closes (c). **The row surface is never assigned a (c) closer.** Corroborating word-frequency over the packet, with positive controls: `required` appears **1** time in the entire document (line 65, the sub-mode table); `omitted`/`scalars_unadjudicated` appear only in the Precedent-B description (`:94`) and the §4.3 distinctness application (`:109`). Positive controls on the same pipeline: `closed-key` **6**, `reasons_must_differ_from` **6**, `OracleRow` **3**, `ABORT` **7** — the search works. [MEASURED HERE]

### The aggravating factor: the packet states the correct principle and then does not instantiate it

§2 line 67 states the unifying principle in a form that **would** close this:

> *"parse the oracle under a TOTAL schema — every key known-or-rejected, every value typed, **every absence either declared or fatal**."*

That third clause is exactly the missing rule. But §4 — **the section that gets implemented** — decomposes the principle into §4.1 (known-or-rejected), §4.2 (every value typed), and §4.3 (absence declared, *for one population only*). **The "every absence either declared or fatal" clause is dropped at the row surface between §2 and §4.** The packet correctly labels §2's principle `UNPROVEN` and names a settling test — but the settling test in §6 (`:140`) re-runs *the grade's own six mutations plus N7/N8*, which is the mutation set that already lacks a pure deletion. **The proof mirrors the design's blind spot and therefore cannot discover it.**

### Why this is disqualifying rather than a residual risk

The packet's own §3 (`:84`) names the decisive retired assumption:

> *"`A CHECK ADDED AT THE GRANULARITY WHERE THE LAST DEFECT APPEARED WILL CATCH THE NEXT DEFECT.` It has now failed four times. A design that closes FIELD granularity and stops is attempt five with a new label."*

§4 does not merely stop at field granularity — **it does not finish field granularity.** It closes the operator the last defect was found with (TYPO) and leaves the adjacent operator on the same surface (DELETE) open. This is the fifth consecutive instance of the pattern the grade recorded at `:303`: *"none is a member of the delivery's registered fixture set."* The difference is that this time it is **predictable before the code is written**, which is the entire purpose of a pre-implementation grade.

**Repro (document-level, no code required):** apply §4.1–4.3 exactly as written to `c304b098`; then delete the `bindable` key from `ORACLE.fixtures["20-nyam-evaluable.spec.json"].conditions.sess`. Closed-key sees no unknown key; the type-check sees no wrong type; §4.3 does not govern rows; `:714`'s `want.bindable !== undefined` is false. **Result: no output, `EXIT=0`.**

**Blast radius:** every CLAIM-2 correctness expectation in `ORACLE.json`. A merge artifact, a hand-edit, or a dropped line during a future oracle amendment withdraws an adjudication with zero signal — the failure mode this five-delivery lineage exists to eliminate.

---

## Finding D-2 — MEDIUM — `ABORT` condition 3 is not discharged by the packet itself; the named next rung is the grade's own "largest single gap"

**Severity:** MEDIUM (an un-dischargeable ABORT fires at implementation start; and the one rung below FIELD is neither closed nor declared)

§6 `ABORT` item 3 (`:134`) requires:

> *"The design must state what it does at the **next** granularity down, even if that answer is an explicitly declared scope limit."*

**§4 states nothing at that level, and §7 does not declare it** [MEASURED HERE]. §7's five declared non-coverages are: mutations not re-executed · `ORACLE.json` key space not enumerated · caption family unenumerated · `P1`/`P2`/`P3` untouched · no claim §4 is sufficient. The last is a **blanket disclaimer of sufficiency**, which is not what ABORT 3 asks for — ABORT 3 asks for a *named granularity* with either a mechanism or an explicit scope limit.

**The unnamed rung is identifiable, and the packet's own evidence base names it.** `GRADE-C304B098` `:286` [ARTIFACT-SOURCED]:

> *"**The oracle's expected VALUES against the authority document.** I verified every row *cites* an authority and that the authority file's sha256 matches its pin. I did **not** re-derive the 15 adjudicated expectations from `ORACLE-AUTHORITY-ORPHAN-ZONES-2026-07-30.md` prose. **A correctly-cited but mis-transcribed value would survive this grade. This is the largest single gap.**"*

The packet's own §4.0 (`:100`) builds the exact ladder and stops one rung short: `validateOracleContractOrExit()` was built to answer **"is this expectation SOURCED?"**; §4.1–4.2 add **"is this expectation WELL-FORMED?"**; the third rung — **"is this expectation CORRECT, i.e. does the cited authority actually say this?"** — is never named. This is a genuine false-green path, not a theoretical one: an oracle value transcribed from a wrong lane output rather than derived from the authority makes lanes-agree-and-are-both-wrong pass, which is the specific blind spot the oracle exists to cover (grade `:215`).

**Absence measured with positive control** [MEASURED HERE]: probes over the packet for `transcrib` · `mis-transcrib` · `re-derive` · `rederive` · `value.*authority` · `authority.*value` all return **0**; positive controls on the same pipeline return `closed-key` **6**, `ABORT` **7**, `OracleRow` **3**. The zeros are measured absences, not a broken search.

> **Instrument note against a false absence of my own:** my first probe for the literal `next granularity` returned **0**, which is a **false** zero — the phrase exists at `:134` as `at the **next** granularity down`, split by markdown bold. I caught this by reading `:134` directly rather than trusting the count. The absence claims above were re-checked against read text, not count alone.

---

## Finding D-3 — LOW — two small residuals in the same wave

**D-3a — §4.1's closed-key rule is scoped to `OracleRow` only; `OracleFixture` stays open-key.** §4.1's heading (`:102`) is *"`OracleRow` becomes CLOSED-KEY"*. `OracleFixture` (`:607-637`) carries `authority`, `spine_total`, `spine_bound`, `compiled`, `scalars_unadjudicated`, `conditions`, `conditions_unadjudicated`, `conditions_unadjudicated_ids`, `reasons_must_differ_from` — and remains open to unknown siblings. §4.3's required-key rule covers the one fixture key that matters most, so this is not by itself a false green, but closing one level and not the other is the same shape the lineage keeps repeating. Cheap to close in the same edit.

**D-3b — the completion signal is an exit code but not a finished run.** §6 (`:140`) requires `EXIT=1` with the offending key NAMED, and `A0` still GREEN — correctly exit-code-based, not a grep for expected lines (Question 10 satisfied in substance). Residual: it does not require the **final summary line** to be present on the GREEN control, so a run that exits early still satisfies the letter. One clause fixes it.

---

## RESOLVED — the packet's own open `[HYPOTHESIS]` about the finding count

§1 (`:17`) flags that the grade's §6 prose says *"All six findings"* against its own §7 `Total 5`, labels the reason `[HYPOTHESIS — untested]`, and declines to rely on it. **This resolves cleanly from the artifact and is not an ambiguity** [ARTIFACT-SOURCED]: §7's severity table counts only the `F-`numbered headings (`grep -c "^## Finding "` → **5**, positive control `grep -c "^## "` → **10**) [MEASURED HERE], while §6's prose counts the **six adjudicated items** — the five `F-` findings plus sub-claim `6`, which is adjudicated `NOT-SOUND` in its own section at grade `:224-241` rather than as an `F-` heading. Both statements are true under that reading.

**Premise 1 is therefore CONFIRMED and the packet's repair set of six items is correct.** The packet's decision to grade against all six was right, and the two upstream sources that said "three" were wrong.

---

## THE TEN QUESTIONS

| # | Question | Verdict | Basis |
|---|---|---|---|
| 1 | Closed schema — unknown / **missing** / extra key | **FAIL** | unknown ✓ §4.1, extra ✓ §4.1, **missing ✗ at row level — D-1** |
| 2 | Runtime types — `reason_null: "true"` survives? | **PASS** | §4.2 replaces the `:729`/`:732` double equality with read→assert-boolean→branch |
| 3 | Total semantics — satisfied by absence/skip/missing fixture? | **FAIL** | missing fixture ✓ (grade `N10`, named 3×); unresolved lookup ✓ (§4.3 censuses pairs); **absence ✗ — D-1** |
| 4 | Relationship integrity — deleting `reasons_must_differ_from` NECESSARILY red? | **PASS** | §4.3 removes `?? []` as an acceptance path, asserts+prints the pair count, demands a declared reason; correctly sited at fixture level per premise 2 |
| 5 | Pre-registered red paths, incl. clean control | **PARTIAL** | ABORT 2 pre-registers all four (unknown→RED, wrong-type→RED, deleted-relationship→RED, clean→GREEN) — **but omits deleted-row-expectation→RED, so it mirrors D-1's blind spot** |
| 6 | Next granularity — more than a fifth field patch? | **FAIL** | **D-1** (not closed even at its own granularity, under the DELETE operator) **and D-2** (rung below FIELD neither closed nor declared) |
| 7 | Authority independence — expectations frozen independently of both lanes? | **UNDETERMINED** | population independence inherited (grade `:204`, `:473-474` reads fixture input not the compiled plan); **value-vs-authority independence is nowhere addressed — D-2** |
| 8 | Population totality — adjudicated or explicitly unadjudicated | **PARTIAL** | fixture population ✓ (row census, SOUND); distinctness population ✓ §4.3; **row FIELD population ✗ — D-1** |
| 9 | Scope control — baseline-delta, not absolute | **PASS** | §6.4 is a delta against a baseline recorded at implementation start; **independently reproduced here**: `git status --porcelain -- scripts ci src` → ` M src/engine/tests/test_synthetic_market_simulator.py`, exactly as `:136` claims. The packet red-proofed its own guard, found it already-red, and rewrote it — the strongest single act in the document. |
| 10 | Executable completion signal — exit code, not grep | **PASS** | §6 requires `EXIT=1` per mutation + `A0` GREEN; exit-code based. Minor residual **D-3b** |

---

## THE SMALLEST DOCUMENT-LEVEL CORRECTION

Three edits. **No code, no re-architecture** — the mechanism already exists in the file and the packet already states the principle.

1. **Add §4.2b — "the ROW's expectation set is TOTAL."** Instantiate §2's own third clause (*"every absence either declared or fatal"*) on `OracleRow`, by applying **Precedent B (`:667-675`) to the row exactly as §4.3 applies it to the distinctness population**: compute the row's omitted expectation fields and require each to be either **asserted** or **named in `row.unadjudicated`**, else FAIL naming *fixture · condition id · omitted field*. The machinery is already present and already read at `:694` — only the contradiction direction is currently wired; this adds the silent-void direction. Precedent B then goes **two** surfaces across, not one.
2. **Add one scored case to `ABORT` 2:** *a **deleted** row expectation key (e.g. remove `bindable` from `20-nyam-evaluable.spec.json` → `conditions.sess`) → **RED**, naming the row and the field.* Without it the red-proof cannot discriminate the design's own blind spot. Optionally extend §6's settling test the same way.
3. **Add one clause to §7 discharging `ABORT` 3:** name the granularity below FIELD — **expectation VALUE vs the cited authority document** (`GRADE-C304B098` `:286`, *"the largest single gap"*) — and either close it or declare it an explicit scope limit for this attempt.

Optionally, in the same edit: extend §4.1's closed-key rule to `OracleFixture` (**D-3a**) and require the GREEN control's final summary line (**D-3b**).

**With those three edits I see no remaining architectural false-green path in the packet**, subject to the coverage limits declared below. The corrected packet would, in my assessment, authorize one implementation attempt.

*Supplementary, not part of the brief's outcome vocabulary:* band **6/10** — implemented-as-design, adversarially reasoned, honest about its limits, one open false-green of the class it exists to close.

---

## MANDATORY CLOSING COVERAGE SECTION

### 1. What I verified, and via which two-plus non-overlapping paths

| Claim | Path A | Path B | Path C |
|---|---|---|---|
| Pin identity & tree identity | `git cat-file -t 7134bb34` → commit; `git rev-parse` blob SHAs | `git merge-base --is-ancestor` (pin is ancestor of moved HEAD) | `git rev-parse --git-common-dir` discriminates linked worktree |
| Packet/grade/code contents are the pinned objects | `git show <sha>:<path>` extraction | blob SHA re-derived on the extracted copy (`0d6b0425`, `027e1430`, `48d5cc95`) | line counts match the brief (1536 / 314 / 150) |
| **D-1: row expectations are present-or-skip** | **static read of all 8 `want.` guard sites (`:714`–`:741`) + the sole `omitted` block at `:667` scoped to scalars + `OracleRow` all-optional at `:576`** | **grade's 5 measured typo mutations → byte-identical PASS, which entails the removed known key emitted nothing** | `:619` comment *"Required iff any of the three scalars above is omitted"* bounds the required-declaration machinery to scalars |
| **D-1: §4.1–4.3 do not reach it** | read §4.1/§4.2/§4.3 wording (unknown-key / type-when-present / "one surface across") | §2 sub-mode table assigns (c) exactly one exemplar, at fixture level | word-frequency over the packet with positive controls (`required` = 1) |
| Premise 2 (`reasons_must_differ_from` is fixture-level) | read `:1408` — `expect` bound from `Object.entries(oracle.fixtures)` | packet §2 `:67` states the same, independently derived | grade `:101` cites the same `?? []` site |
| Premise 3 (baseline-delta required) | `git status --porcelain` → 8 modified tracked + 85 untracked | `git status --porcelain -- scripts ci src` → 1 modified file, matching packet `:136` | packet's own self-red-proof record at `:136` |
| Premise 1 (repair set = 6 items) | `grep -c "^## Finding "` → 5 (control `^## ` → 10) | grade §7 severity table Total 5 + sub-claim 6 adjudicated at `:224-241` | grade §6 prose "all six" reconciles under that reading |
| Packet citation accuracy | `:1405-1407` "sharpest assertion" ✓ · `:1408` fixture-level `expect` ✓ · `:297` `UNMAPPED TS FIELD` ✓ · `:667-675` Precedent B ✓ · `:397-399` "THE CITATION IS THE CONTRACT" ✓ | five spot-checks, five exact | — |

### 2. Positive-control witnesses for every absence claim

| Absence claimed | Positive control | Result |
|---|---|---|
| Packet never assigns a required-key/omission rule to the row surface | same `grep -ic` pipeline for `closed-key` / `reasons_must_differ_from` / `OracleRow` / `scalars_unadjudicated` / `ABORT` | 6 / 6 / 3 / 3 / 7 — pipeline works |
| Packet never addresses value-vs-authority (D-2) | same pipeline, controls above non-zero | 0 for all six probes; **re-checked against read text after catching a markdown-bold false zero on `next granularity`** |
| No row-level `omitted` computation exists in 1536 lines | `grep -n "omitted"` returns 4 hits — all present, all in the scalars block | search works; the absence is of a *second* block, not of the pattern |
| No unconditional row expectation read exists | `grep -n "want\."` returns 22 hits, all enumerated and classified | every read site accounted for; none unguarded |

### 3. Join keys checked for every "identical / unchanged / matches" claim

- **Object identity:** git **blob SHA** for all three graded artifacts, re-derived on the extracted copies — not path, not filename.
- **Pin vs HEAD:** **commit SHA** plus an explicit ancestry test, rather than assuming the branch tip was the pin.
- **Packet claim ↔ code:** **line number within blob `48d5cc95`**, each citation opened and read in the shipped blob, never in the worktree copy (which is a **different blob**, `d9f014d3` — see §4).
- **Finding identity:** `F-`number from the grade's **headings**, not from its sub-claim table (the source of AR-540's mislabel).
- **Sub-mode ↔ section:** sub-mode letter `(a)/(b)/(c)` from §2's table ↔ the §4.x section that claims to close it.

### 4. What I did NOT verify, and why

- **I did not execute the gate.** This worktree's `scripts/check-spec-binding-plan-parity.ts` is blob `d9f014d3`, **not** `c304b098`'s `48d5cc95`, and `ci/fixtures/spec-binding-parity-expanded/` is **absent** here [MEASURED HERE]. Materializing the script into scratchpad would resolve its `refusedSessionZone` import (`:47`) against this tree's engine lane rather than `c304b098`'s, which is the wrong blob and would measure the wrong object. `C:/Users/tonio/Projects/wt-ledger-e-delivery-r497-20260730` exists and is where such a run belongs; I did not enter it, as it was outside my pinned tree and is another lane's tree. **D-1's empirical leg therefore rests on Path A (static read of executable lines, MEASURED HERE) plus Path B (the graded instrument's executions, MEASURED BY GRADED INSTRUMENT) — not on an execution by me.**
- **`ORACLE.json`'s full key space.** 25,095 B at `c304b098`; I did not enumerate every row to count how many currently omit an expectation without declaring it. **The population size of D-1's exposure in the live oracle is `UNENUMERATED`** — I establish the path exists, not how many rows currently sit on it.
- **Whether §4.1–4.3, once implemented, actually turn the grade's six mutations RED.** That is unexecutable against a document. I graded the design's reachability by reading, not the implementation's behaviour.
- **The caption family's exhaustiveness** (`F-1`/`F-4`/`F-5`). The packet declares this `UNENUMERATED` at `:148`; I ran no caption census either. Nine known instances of `caption falsifies its own line` on this codebase gives no reason to believe nine is the ceiling.
- **`P1`/`P2`/`P3`, Gate-B, the materiality receipt, and `ORACLE-AUTHORITY-ORPHAN-ZONES-2026-07-30.md`'s rulings.** Out of scope for this packet and untouched by me.
- **Whether the desk should grant a second grade slot** (§5, `:123`). That is a desk decision, not a grader's.

### 5. Left UNDETERMINED

- **Question 7 (authority independence)** — the packet neither asserts nor denies that oracle values are derived from the authority document rather than transcribed from a lane output. Reported as **D-2**, not resolved.
- **The live-oracle exposure count for D-1** — see §4.

### 6. Independence declaration

I did **not** design, build, or author `P0-REDESIGN-PACKET-2026-07-31.md`, and I have never previously graded it. This is its first grade.

**Lineage I must declare:** I am the same agent identity (`accuracy-validator`) that authored `GRADE-C304B098-2026-07-31.md`, the grade this packet is written to answer, and that document is part of my evidence base here. I did not author, and have no lineage to, the packet, the four code deliveries (`2011e8de`, `39948d3c`, `8187b730`, `0d3db53c`, `c304b098`), or `R-516`/`R-518`.

Two consequences I actively controlled for. First, I treated `GRADE-C304B098` as an **artifact to be re-read**, not as recalled knowledge — every quotation above was re-extracted from blob `027e1430` at the pin. Second, and more importantly, **D-1 is a defect in my own prior grade's coverage as much as in the packet**: my six registered `F-2` mutations were all typos or type slips, and none was a pure deletion, which is precisely why the packet — reasoning faithfully from my finding — inherited the blind spot. A grader inheriting its own instrument's blind spot is the failure mode this desk has convicted four times, and **the packet did not introduce it; it inherited it from me.** That is the honest reading, and it is why D-1 is framed as a hole in the *repair set's* coverage rather than as an authoring error by the packet's author.

No band was carried forward; the verdict was re-derived from the current artifacts only.

### 7. Findings by severity

| Severity | Count | IDs |
|---|---|---|
| CRITICAL | 1 | D-1 |
| MEDIUM | 1 | D-2 |
| LOW | 1 | D-3 (a, b) |
| **Total** | **3** | |

**Disposition: FAIL — NAMED DESIGN DEFECT.** Do not implement. Apply the three document-level edits in the section above, then this packet is, in my assessment, sound enough to authorize the single implementation attempt. `D-1` alone is disqualifying; all three corrections are document edits and none requires re-architecting §4.
