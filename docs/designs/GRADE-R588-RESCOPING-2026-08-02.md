# GRADE — R-588 RE-SCOPING RULING (adversarial, ordered by R-588 §7.4)

**Target:** `docs/designs/ADVISOR-RULINGS.md`, R-588 (newest at top).
**Pinned commit:** `bded7a5e2c54d18f042d6620f42a684b7573affc` · branch `h1-wave4-sealed12-driver`
**Tree:** `C:/Users/tonio/Projects/wt-h1-wave4-20260712` (linked worktree; `git rev-parse --git-common-dir` → `C:/Users/tonio/Projects/trading-forge/trading-forge/.git`)
**Ruling blob at pin:** `b4e88269eace35e48137ff173b057e22446bbad6`
**Grader:** accuracy-validator, independent. Ordered target was to REFUTE §2. I attacked §2, §1/§5, §3, and the four asserted-MEASURED side claims.

> ⚠️ **HEAD MOVED MID-GRADE.** At dispatch HEAD was `bded7a5e`; at `18:55:12 EDT` HEAD was
> `5267fa2a` (5 new commits: `7572d37f`, `20861791`, `078838eb`, `bf30cdfc`, `5267fa2a`).
> **Every verdict below is scoped to `bded7a5e`.** I re-derived the four load-bearing artifacts at
> both commits and all four are byte-identical (`ADVISOR-RULINGS.md` `b4e88269`, graph `876c3a23`,
> `BLUEPRINT-V4-DRAFT.md` `fa1ce960`, `GRADE-P0PC-BATCH5` `132ce4d0`), and
> `git diff bded7a5e HEAD -- prototypes/p0-vnext-admission/` is EMPTY — so the move does not
> invalidate this grade. Noting it because a verdict that does not name its hash is unfalsifiable.

---

## VERDICT TABLE

| System | Band | Status | Evidence | Open risks |
|---|---|---|---|---|
| R-588 as a whole | **4 / 10** | **VERIFIED** | Two of three central claims survive adversarial attack; the third is refuted on both of its stated supports, by the very artifact the ruling cites as adopted | Decision half "TAKE SURFACE B NOW, IN PARALLEL" rests on two false `[MEASURED HERE]` claims; §8 would persist a false lesson |
| — C-A scope (tamper-evidence out of acceptance) | 7 | **NOT REFUTED** | Attacked on 4 independent fields; mechanism independently confirmed | Enumeration covered 1 of 4 node fields |
| — C-A evidence (`43/43` ⇒ in-scope property MET on the committed object) | 2 | **REFUTED** | Join key wrong (43 ≠ 25) **and** measurement stale across a new conjunct | The single evidentiary pivot of the ruling |
| — C-B (P0PC is Surface A / no edge / no node) | 2 | **REFUTED** | `BFREEZE` node exists; 11 hard edges P0PC→BFREEZE | Work authorized on a node the adopted graph marks BLOCKED |
| — C-C (§15.7 fires at two, we are at five) | 7 | **NOT REFUTED** | Reproduced under R-516 §4's own method | none found |
| — §0 per-commit blob table | 8 | **VERIFIED CORRECT** | 4/4 re-derived independently | one stale `(HEAD)` caption |
| — §2 instrument self-audit | 8 | **VERIFIED CORRECT** | reproduced byte-for-byte | none |

**Rubric note:** band 4 = "implemented but unproven". R-588 is unusually self-adversarial — it audited
its own instrument, caught its own false positive pointing *against* its thesis, and dispatched a
grade against itself. That discipline is real and is why this is not band 2. It is not band 5+
because three claims carrying `[MEASURED HERE]` are false, and two of them are load-bearing for the
half of the decision that moves the campaign.

---

## Discrepancy F-1: Surface B HAS a node in the graph — the ruling's central novel claim is false

**Severity:** CRITICAL (false negative on an absence claim; drives the decision)
**Claim:** R-588, GRAPH FAN-IN section, verbatim: *"the problem is that Surface `B` HAS NO NODE IN THIS GRAPH AT ALL `[MEASURED HERE — 28 nodes, none of them a tier-A compile-fidelity membership node]`"*. Repeated as §8 lesson 1: *"Surface `B` has no node in the `28`."*
**Reality:** Node **`BFREEZE`** exists, and is titled **"Freeze current Surface-B membership and consumer profile"** — the term "Surface-B" appears literally in the node title. `kind: evidence_freeze`, `phase: 1C-tier-a`, `owner: "advisor/worker"`, `state_at_epoch: "blocked_by_RESPIN"`.

Its `acceptance` is a near-verbatim restatement of what R-588 §4 says Surface B requires:

> `BFREEZE.acceptance` = *"Current N, exact spec hashes, load-bearing membership, authority citations, and consumer profile are frozen before any result is read."*
> R-588 §4 = *"current re-ranking · exact spec hashes · load-bearing adjudication · and a consumer profile frozen BEFORE any result is read"*

Node **`RERANK`** ("Re-rank current Tier-A spearheads") supplies the "current re-ranking" clause; node **`FIDELITY`** carries edge 25 to `PH1_EXIT` captioned *"current **Surface-B** compile-fidelity calibration receipt"*.

**Sources compared:**
- Source A (`nodes[]` registry): `BFREEZE` present, index 18 of 28 · `FIDELITY` index 20
- Source B (`node_states_at_epoch`, a structurally independent index): `"blocked": [... "RERANK", "RESPIN", "BFREEZE", "BIND", "FIDELITY", ...]` — `BFREEZE` explicitly listed
- Source C (`edges[]` artifact captions): edge 21 `BFREEZE→BIND` artifact *"frozen current Surface-B membership and consumer profile"*; edge 25 *"current Surface-B compile-fidelity calibration receipt"*
- Source D (R-588's own text): "no node at all"

**Source of truth:** A, B and C — three non-overlapping regions of the same adopted object all name it. D is false.
**Root cause (measured):** the desk searched for the token `SURFACE B`. The graph spells it `Surface-B` (hyphen) and the ledger overwhelmingly spells it `` Surface `B` `` (backtick). Same defect as F-2.
**Fix point:** `docs/designs/ADVISOR-RULINGS.md` R-588 — the GRAPH FAN-IN paragraph and §8 lesson 1 must be struck, not softened. §8 lesson 1 is queued for persistence into campaign memory; a false lesson that survives into `MEMORY.md` is durable damage.
**Repro:**
```bash
cd C:/Users/tonio/Projects/wt-h1-wave4-20260712
git show bded7a5e:docs/designs/V4-PHASE1-EXECUTION-GRAPH-2026-08-02.json > /tmp/g.json
node -e "const g=require('/tmp/g.json');
  console.log(g.nodes.filter(n=>/surface[ -_]?b\b/i.test(JSON.stringify(n))).map(n=>n.id+': '+n.title));
  console.log('blocked:', g.node_states_at_epoch.blocked.includes('BFREEZE'));"
```
**Blast radius:** R-588 §7.3 authorizes this desk to START `BFREEZE` on the ground that it is unscheduled because absent. It is not absent; it is **BLOCKED**. Deliverable `078838eb` (`SURFACE-B-POPULATION-FREEZE-2026-08-02.md`) has already landed against a node the adopted graph marks blocked.

---

## Discrepancy F-2: "Surface B appears exactly twice in the entire ledger" — it appears 44 times across 22 rulings

**Severity:** CRITICAL (false absence claim under `[MEASURED HERE]`; sole support for the "58 rulings" narrative)
**Claim:** R-588 header: *"it appears exactly TWICE in the entire ledger, both inside `R-529` … and then nothing ever took it"*, `[MEASURED HERE]`. §4: *"`grep 'SURFACE B'` over the entire ledger returns `2` hits, BOTH inside `R-529`"*.
**Reality:** Variant-tolerant search over the same pinned blob returns **44 occurrences across 22 distinct rulings**. Excluding R-588 itself and R-529: **20 other rulings, 24 occurrences.**

Spelling census of the 44 (this is the whole finding):

| form | count |
|---|---|
| `` Surface `B `` | 28 |
| `` SURFACE `B `` | 7 |
| `SURFACE B` ← *the only form the desk's grep matches* | 4 |
| `surface B` / `Surface B` | 2 |
| `` Surface-`B `` / `SURFACE-B` / `` SURFACE-`B `` | 3 |

**The narrative this refutes:** R-588 §8 lesson 2 asserts *"writing it down is what makes the next seat think it is handled … that sentence then functioned as a receipt for 58 rulings."* The ledger shows the exact opposite. **15 rulings — R-532, R-533, R-540, R-541, R-542, R-544, R-546, R-548, R-550, R-551, R-555, R-556, R-557, R-558, R-559 — carry the standing invariant line `Surface `B` UNOWNED`.** Successor seats did not read it as handled; they re-declared it OPEN in a status line, ruling after ruling.

Further, **R-530 §8** — the ruling immediately after R-529 — already issued the order R-588 §4 presents as its own new contribution:

> R-530 §8: *"**BLUEPRINT SURFACE `B`:** relabel `11 / 99 / 53 @ be194136` as the **HISTORICAL SEED/REFERENCE POPULATION**; current membership and `N` are **UNKNOWN until current re-ranking, exact spec hashes, load-bearing adjudication and consumer-profile freeze**, frozen BEFORE results are read."*

and R-530 already carried R-588 §6's stop condition: *"If Surface `B` freezes historical counts without current hashes and adjudicated membership, STOP: the stale baseline has become the admission denominator again."*

**Sources compared:** [desk grep `SURFACE B`: 2 pre-authorship hits | variant-tolerant: 44 hits / 22 rulings | `UNOWNED` invariant line: 15 rulings | graph: `BFREEZE` node]
**Source of truth:** the variant-tolerant census; corroborated independently by the graph containing `BFREEZE`.
**Positive control (mandatory for an absence claim):** ledger line 1836 (R-559) is known to contain `` Surface `B` UNOWNED `` — confirmed by direct extraction. The desk's exact pattern `grep "SURFACE B"` against that same line returns **0 matches**. The instrument demonstrably misses a real, present mention; my pattern catches it. Control fires.
**Fix point:** R-588 header + §4 + §8 lesson 2.
**Repro:**
```bash
git show bded7a5e:docs/designs/ADVISOR-RULINGS.md > /tmp/led.md
grep -c "SURFACE B" /tmp/led.md                                    # desk pattern
grep -oiE "surface[ \`_-]{0,3}\`?B\`?\b" /tmp/led.md | wc -l        # 44
grep -ciE "surface\s*\`?B\`?\s*UNOWNED" /tmp/led.md                 # the standing invariant
```
**Blast radius:** the "unowned and forgotten for 58 rulings" framing is the emotional and evidentiary core of the decision to reprioritise the campaign. The obligation was tracked continuously; what was missing was an unblocked predecessor, not an owner.

---

## Discrepancy F-3: "THERE IS NO EDGE" — the adopted graph encodes 11 hard edges from P0PC to Surface B

**Severity:** CRITICAL (mechanism claim, unmeasured against the cited artifact)
**Claim:** R-588 §5: *"**graph-engineering's fake-edge test, applied to `P0PC → Surface B`** … **THERE IS NO EDGE.** Surface `B`'s population freeze was **runnable on day one of `R-529` and every day since** — it was serialized behind `P0PC` by ADJACENCY IN A QUEUE."*
**Reality:** In the same graph the ruling names as ADOPTED and explicitly declares it does not modify, there is a directed path from `P0PC` to `BFREEZE` of length 11, **every hop `hard: true`**:

```
P0PC →(data) P0PG →(authority) P0VC →(data) P0DG →(authority) P0I →(data) P0IG
     →(authority) GBP →(data) GBR →(data) GBS →(data) RERANK →(decision) RESPIN →(data) BFREEZE
```

**The graph pre-empts this exact defence.** Its own `scheduler.edge_rule` reads:

> *"Every hard edge names the exact output artifact consumed. **An ordering claim without a consumed artifact is a fake edge and is removed.**"*

Each of the 11 hops names a consumed artifact (e.g. `RESPIN→BFREEZE`: *"targeted current spec set with transcript-audit receipts"*). The fake-edge test R-588 §5 applies by hand had **already been applied to this graph as a construction rule**, and these edges survived it. And `BFREEZE.state_at_epoch` is the literal string `"blocked_by_RESPIN"`.

**Corroborating second path — the blueprint's own ordering.** §15.6 opens *"The ordered path is now:"* and §15.6a states it assigns *"which of those steps qualify the instrument (**1–2**) and which bear on the exit (**7–10**)"*. Steps 3–6 (freeze P1+P2 · rule P3 · implement Gate B · run the sweep) sit **between** Surface A and Surface B, and step 7 is *"Re-rank the Tier-A spearheads **on the current output**"* — an artifact-consumption relation. §15.8's status table lists *"Gate-B implementation / ablation — **not started; blocked on P0–P3**"*.

**The join-key error:** §5 supports "no edge" by quoting §15.6a's *"over distinct, presently unjoined **populations**."* That sentence is about **population disjointness**, not scheduling dependency. Two nodes can operate on disjoint populations and still be hard-ordered — which is exactly what this graph encodes. Population disjointness was used to prove execution independence; they are different keys.
**Sources compared:** [R-588 §5: no edge | graph `edges[]`: 11 hard edges | graph `node_states_at_epoch`: BFREEZE ∈ blocked | `BFREEZE.state_at_epoch`: "blocked_by_RESPIN" | §15.6 ordered path + §15.8 "blocked on P0–P3"]
**Source of truth:** the graph and the blueprint agree against the ruling.
**Fix point:** R-588 §5 in full, and §7.3's "IN PARALLEL (no edge, §5)".
**Repro:**
```bash
node -e "const g=require('/tmp/g.json');
 const q=[['P0PC']],s=new Set(['P0PC']);
 while(q.length){const p=q.shift(),c=p[p.length-1];
  for(const e of g.edges){ if(e.from!==c||e.hard!==true) continue;
   if(e.to==='BFREEZE'){console.log(p.concat('BFREEZE').join(' -> '));process.exit(0);}
   if(!s.has(e.to)){s.add(e.to);q.push(p.concat(e.to));}}}"
```
**Blast radius:** R-588 §7.3 starts `BFREEZE` "in parallel" on the strength of "no edge". Under `scheduler.ready_rule` (*"ready only when every incoming hard edge has a present, pinned artifact"*), `BFREEZE` is not ready. Its missing predecessor `RESPIN` is what supplies the *current* spec set — so a freeze authored now has no current membership to enumerate, and the only population available to it is `be194136`'s `11 / 99 / 53`. **That is precisely the defect R-588 §6 declares a STOP condition.** The ruling's own stop condition is the risk its scheduling error creates.

---

## Discrepancy F-4: `43/43` measures a different population than the property it is cited for

**Severity:** HIGH (wrong join key on the ruling's single "acceptance is MET" evidence)
**Claim:** R-588 §2: *"✅ **IN SCOPE — every DECLARED failure class has a demonstrated red path**, and the clean control is green. `[MEASURED BY GRADED INSTRUMENT, grade 5 C6]` `red-proof.mjs` → `CONTROL GREEN: true | 43 / 43` · `ENFORCING GATE` · `EXIT 0`. **THIS IS MET ON THE COMMITTED OBJECT.**"*
**Reality:** The `43` is not the count of declared failure classes. `red-proof.mjs:606` prints

```js
console.log(`CONTROL GREEN: ${controlOk} | CLASSES WITH A DEMONSTRATED RED PATH: ${rows.filter((r) => r.ok).length} / ${EXPECTED_ROW_COUNT}`);
```

and `:452` defines
`EXPECTED_ROW_COUNT = CLASSES.length + SHARED.length + EXPECT.length + FREEZE_EXPECT.length + STANDALONE_ROWS` — **red-proof.mjs's own four row tables**, measured at `bded7a5e` as `16 + 2 + 21 + 2 + 2 = 43` ✓.

The declared failure classes live in **`run.mjs`'s `FAILURE_CLASSES`**, measured at `bded7a5e` as **25**, and they are checked by a *different* line, `red-proof.mjs:601`:

> `COMPLETENESS (F-4): all ${declaredFailureClasses.length} of run.mjs's declared FAILURE_CLASSES have a demonstrated red path — ASSERTED, not assumed.`

So the sentence *"every DECLARED failure class has a demonstrated red path"* (a claim over 25) is evidenced by a magnitude over 43. Two different populations, two different cardinalities, one citation.

**Sources compared:** [R-588: "43/43" ⇒ declared classes | `red-proof.mjs:606` + `:452`: 43 = own row tables | `run.mjs` `FAILURE_CLASSES`: 25 | `red-proof.mjs:601`: the line that *does* speak to declared classes]
**Source of truth:** the executable lines. The property is *transitively* implied by `EXIT 0` (since `allOk` conjoins `completenessOk`), but **`EXIT 0` is the evidence, not `43/43`** — and the ruling cited the number, not the exit code, as the thing that is "MET".
**Method note (two paths, my own harness):** both counts were produced by two independent parsers over `git show bded7a5e:` blobs — comma-depth scan and tuple-opener scan. They AGREE on every table at both commits, and `16+2+21+2+2` reproduces the reported denominator `43` exactly, which is the cross-check that my parser is not the thing that is wrong.

### F-4b — and the measurement is stale across a changed exit expression

`[MEASURED BY GRADED INSTRUMENT, grade 5 C6]` is honest labelling, but grade 5 pinned `613a7c15` (its §own receipt: *"`git diff --stat 613a7c15 HEAD -- prototypes/` EMPTY"*). Between `613a7c15` and `bded7a5e`:

```
prototypes/p0-vnext-admission/module-collections.mjs |  16 +-
prototypes/p0-vnext-admission/red-proof.mjs          | 209 ++++++-
prototypes/p0-vnext-admission/run.mjs                | 112 +++-
3 files changed, 325 insertions(+), 12 deletions(-)
```

and the pass/fail expression itself gained a conjunct:

| commit | `allOk` |
|---|---|
| `613a7c15` | `controlOk && countOk && identityOk && provenanceOk && completenessOk && rows.every(r=>r.ok)` |
| `bded7a5e` | `controlOk && countOk && identityOk && provenanceOk && completenessOk && **effectOk** && rows.every(r=>r.ok)` |

`effectOk` occurs **0 times** at `613a7c15` and **2 times** at `bded7a5e`. A newly added conjunct can only make `allOk` false more often. Therefore *"THIS IS MET ON THE COMMITTED OBJECT"* — present tense, about `bded7a5e` — is not established by a measurement taken at `613a7c15`. The desk is barred from running it (`R-576 §5`), which makes this a claim it structurally could not have measured and should have routed to the grader (its own `R-585 §8`).

**Fix point:** R-588 §2, the IN SCOPE bullet — cite `EXIT 0` and the `COMPLETENESS (F-4)` line at a named commit, not `43/43`.
**Repro:**
```bash
git show bded7a5e:prototypes/p0-vnext-admission/red-proof.mjs | grep -n "const allOk\|EXPECTED_ROW_COUNT ="
git show 613a7c15:prototypes/p0-vnext-admission/red-proof.mjs | grep -c "effectOk"   # 0
git diff --shortstat 613a7c15 bded7a5e -- prototypes/p0-vnext-admission/
```
**Blast radius:** this is the ruling's only evidence that the in-scope half of P0PC's acceptance is satisfied. It is the pivot on which eleven CRITICAL findings are re-scoped out of the node.

---

## F-5 — LOW — a hash labelled with a commit that was not HEAD, in the ruling that mints "a hash is true of a commit"

R-588 GRAPH OBJECT: *"blob `876c3a230d51815f49f98c36ea4109fe0b236b97` at `85500e93` `[MEASURED HERE, `git rev-parse HEAD:<path>`]`"*, and `ADVISOR-STATE.md:118` reads *"`85500e93` (HEAD) → `876c3a23…`"*. At authorship HEAD was `627a7ee1` (= `bded7a5e^`); `85500e93` was three commits back. The cited command (`HEAD:<path>`) and the stated commit disagree.
**No numeric error** — the blob is `876c3a23` at `85500e93`, `3978c1c5`, `627a7ee1` and `bded7a5e` alike, so the value is right at every candidate. Recorded only because §0 of this same ruling mints `A HASH IS TRUE OF A COMMIT, NEVER OF A FILE`, and the caption attaches it to the wrong commit.

---

## WHAT SURVIVED — the honest null on two of the three claims

### C-A scope thesis: NOT REFUTED (attacked on four independent fields)

I could not refute *"tamper-evidence is not required by P0PC's acceptance."*

1. **`acceptance`** — read in full at the pin. No clause requires the harness to detect edits to itself. The nearest candidate, *"every terminal acceptance failure exits non-zero after evidence collection while the restored control exits zero"*, governs the injected-fault/control cycle, not self-tampering.
2. **`title`** — *"Correct and **red-proof** the executable admission prototype."* Red-proofing is in scope. **The ruling states this against itself**, which is correct and is the strongest thing in §2.
3. **`outputs`** — the field the ruling never enumerates. It contains **`"runner mutation red-proof"`** (and edge `P0PC→P0PG` carries `mutation_bearing: true`, artifact *"…and runner red-proof"*). This was my best candidate for a refutation and **it does not hold**: `red-proof.mjs` is the artifact that discharges it, and it performs **zero file writes** — `grep -n "writeFileSync\|appendFile\|rmSync\|copyFileSync\|renameSync\|mkdtemp"` returns **nothing**. Its only mutation channel is `:192` `env: { ...process.env, PROTO_INJECT: inject }`, and its header declares its unit of work as planting *"ONE real defect (a broken fixture, a rejected green, a non-identical twin, a genuinely CommonJS emitted artifact, a real broken compilation root)"*. "Runner mutation red-proof" means *red-proof of the runner by planting fixture defects*, not *red-proof against edits to the runner*. The desk's reading is the correct one.
4. **`kind`** — `prototype_correction`. Nothing.

**Coverage gap recorded without inflating it:** the ruling's `[MEASURED HERE, full acceptance text read]` covers 1 of the node's 4 text-bearing fields, and its own tamper regex returns **false** on `outputs` anyway — so widening the search would not have changed the answer. The conclusion is sound; the enumeration was narrower than the sentence implies.

### §2's instrument self-audit: VERIFIED CORRECT, reproduced exactly

The ruling reports that `/tamper|adversar|edit|disarm/i` returned TRUE on the acceptance text via `edit` inside `credit`, and that a word-bounded re-run leaves only `mutation`. Independently reproduced at the pin: regex → `true`; the only `edit`-containing substring is **`credit`** (from *"may credit 1b-S"*); the only word-bounded hit is **`mutation`** (from *"mutation-as-type-error rows"*). Exact match. A desk that catches its own false positive when it points *against* its thesis has done the hard version of the work.

### C-C (§15.7 fires at two, we are at five): NOT REFUTED under the corrected join key

The join key was corrected in **R-516 §4**, which I located and read:

> *"I suspected §15.7's count was landing on the WRONG JOIN KEY — `DELIVERY ATTEMPTS` rather than `PATCH ROUNDS ON THE INSTRUMENT`. `[MEASURED HERE]` `git diff --stat` across the three transitions … THE CHECKER'S CODE MOVED SUBSTANTIALLY EVERY ROUND — these ARE patch rounds."*

R-516 established the key **by measuring code movement per round on the named instrument**. R-588 cites the key but evidences it by counting items in each ruling's §6. I therefore re-ran **R-516's method**, not R-588's, over `prototypes/p0-vnext-admission/`:

| round | transition | movement |
|---|---|---|
| R-575 | `b16997a0..2a69454c` | 4 files, +110 / −6 |
| R-578 | `2a69454c..0a557e37` | 2 files, +165 / −15 |
| R-582 | `0a557e37..5a5838bc` | 3 files, +129 / −18 |
| R-585 | `5a5838bc..613a7c15` | 3 files, +50 / −6 |
| R-587 item 2 | `613a7c15..627a7ee1` | 3 files, +325 / −12 |

All five moved the instrument's code substantially, all inside one instrument directory. **Under the join key a prior seat itself corrected, the count of five is CORROBORATED by a method the ruling did not use.** C-C stands.

### §0's per-commit blob table: VERIFIED CORRECT, 4/4

| commit | table claims | I re-derived | ✓ |
|---|---|---|---|
| `d7ac56d8` | `4b806d35…` | `4b806d3555486c5eb0b79444ea1e6499b973050f` | ✓ |
| `8151560c` | `f235065c…` | `f235065cd2214e74d368891637e93efe11aee2ba` | ✓ |
| `27448ee2` | `876c3a23…` | `876c3a230d51815f49f98c36ea4109fe0b236b97` | ✓ |
| `85500e93` | `876c3a23…` | `876c3a230d51815f49f98c36ea4109fe0b236b97` | ✓ |

The self-correction is accurate: `f235065c` is the blob at `8151560c`, and the second epoch refresh moved it to `876c3a23`. The correction the desk made against itself is correct in every value. (See F-5 for the `(HEAD)` caption only.)

---

## RECOMMENDED DISPOSITION

1. **The retirement half of R-588 STANDS.** C-A's scope thesis and C-C's count both survive independent attack, C-C under a stricter method than the ruling used. Retiring the P0PC tamper-hardening lane after item 2 is supported.
2. **The Surface-B half must be re-issued.** Not reversed — re-issued on measured facts. Surface B is `BFREEZE`; it exists, it is owned `advisor/worker`, and it is `blocked_by_RESPIN` behind 11 hard edges. The correct finding is not *"the graph omits the only surface that exits the phase"* but *"the surface that exits the phase is 11 hard edges downstream and nothing has moved its predecessors"* — which is a **worse** finding for the campaign and a **better** one for the desk, because it is true and it identifies `RESPIN`/`RERANK`/`GBS` as the actual blockers.
3. **§8 lessons 1 and 2 must not be persisted.** Both are false as written. Lesson 3 (finite declared set vs unbounded edit space) and lesson 4 (a substring match is most dangerous when it contradicts you) are sound and worth keeping.
4. **Re-cite §2's IN SCOPE bullet** to `EXIT 0` + the `COMPLETENESS (F-4)` line at a named commit, and route the "MET on the committed object" claim to the grader, which has execution rights (`R-585 §8`).
5. **A lesson this grade earns, offered for §8:** `A TOKEN-EXACT GREP IS AN INSTRUMENT, AND A CAMPAIGN THAT SPELLS ITS OWN TERMS THREE WAYS WILL BE TOLD ITS TERMS DO NOT EXIST.` One grep pattern produced F-1, F-2 and F-3 — an absent node, an absent obligation, and an absent edge, all present.

---

## MANDATORY CLOSING COVERAGE

### 1. What I verified, and via which two-plus non-overlapping paths

| claim | path A | path B | path C |
|---|---|---|---|
| Surface B has a graph node | `nodes[]` registry: `BFREEZE` | `node_states_at_epoch.blocked` lists `BFREEZE` | edge artifact captions 21 & 25 name "Surface-B" |
| P0PC → Surface B is hard-blocked | BFS over `edges[]`, 11 hops all `hard:true` | `BFREEZE.state_at_epoch = "blocked_by_RESPIN"` | §15.6 ordered path 1→10 + §15.8 "Gate-B … blocked on P0–P3" |
| "twice in the ledger" is false | variant-tolerant regex census (44/22 rulings) | `Surface `B` UNOWNED` invariant in 15 rulings | graph contains `BFREEZE` |
| `43` ≠ declared failure classes | `red-proof.mjs:606` + `:452` executable lines | two independent static parsers over the pinned blob, agreeing, reproducing 43 = 16+2+21+2+2 | `run.mjs FAILURE_CLASSES` = 25 via the same two parsers |
| measurement is stale | `git diff --shortstat 613a7c15 bded7a5e` = +325/−12 | `effectOk` 0→2 occurrences; `allOk` gained a conjunct | grade 5's own receipt pins itself to `613a7c15` |
| §15.7 count = 5 | R-516 §4's method (`git diff --stat` per round) | commit-log round boundaries on the prototype dir | R-588's item counts (the ruling's own path) |
| §0 blob table | `git rev-parse <commit>:<path>` × 4 | `git log` ancestry ordering of the four commits | — |
| §2 instrument audit | re-ran the desk's regex on the pinned acceptance | word-bounded re-run + substring extraction (`credit`) | — |
| red-proof does not mutate source | write-API grep returns empty | `env: PROTO_INJECT` is the sole mutation channel (`:192`) | file header declares fixture-defect planting |

### 2. Positive-control witnesses for every absence claim I make

- **"The desk's grep misses real mentions"** — ledger line 1836 (R-559) verifiably contains `` Surface `B` UNOWNED ``; `grep -c "SURFACE B"` on that exact line returns **0**, while my variant pattern returns it. Control fires (instrument misses a known-present target).
- **"`red-proof.mjs` performs no file writes"** — the write-API grep pattern is not vacuous: the same pattern's read counterpart (`readFileSync`) returns multiple hits in the same file (`:353`, `:589`, and others), so the grep reaches the file and matches when a match exists. Absence of writes is a real zero, not a dead search.
- **"No tamper clause in `acceptance`"** — the search is not vacuous: the *same* regex returns TRUE on that same string (via `credit`), proving the pattern reaches the text. The finding is that the only hit is a substring artefact.
- **"`effectOk` absent at 613a7c15"** — `grep -c` returns 0 at `613a7c15` and **2** at `bded7a5e` using the identical command against the identical file path. The non-zero arm is the control.
- **My own parser** — two independent counting methods (comma-depth, tuple-opener) agree on all five arrays at both commits, and independently reproduce the harness's published denominator (43). Disagreement would have been visible rather than silent.

### 3. Join keys checked for every "identical / unchanged / matches" claim

- **"Artifacts unchanged across the HEAD move"** — key = `git rev-parse <commit>:<path>` blob SHA at `bded7a5e` vs current HEAD, for all four load-bearing docs. All four identical (listed in the header banner).
- **"The object grade 5 measured vs the object R-588 asserts about"** — key = commit (`613a7c15` vs `bded7a5e`) × path (`prototypes/p0-vnext-admission/`). **NOT identical** — that is F-4b.
- **"43 vs 25"** — key = which declaration the magnitude is computed from (`EXPECTED_ROW_COUNT` from red-proof's own tables vs `FAILURE_CLASSES` from `run.mjs`). **Different keys** — that is F-4.
- **"P0PC is Surface A"** — key = `node.phase` = `1A-instrument`, cross-checked against §15.6a's "PARITY INSTRUMENT — P0-vNext, steps 1–2". **This join holds; C-B's premise that P0PC is Surface A is correct.** It is the "no node"/"no edge" conclusions that fail, not the classification.
- **"Same instrument across five rounds"** — key = path prefix `prototypes/p0-vnext-admission/` on every round transition. Holds for all five.

### 4. What I did NOT verify, and why

- **I did not execute anything in `prototypes/`.** Per the brief the worker was live and mid-edit in `run.mjs`. Therefore `red-proof.mjs`'s actual exit code and its `COMPLETENESS (F-4)` output **at `bded7a5e` are UNMEASURED by me**. F-4b establishes that the prior green cannot be carried forward; it does **not** establish that the object is now red. **The correct disposition is UNKNOWN, not FAILING** — and someone with execution rights must run it at a named commit.
- **I did not verify all eleven instances are tamper-evidence.** Only ordinals FOUR, FIVE, SIX, EIGHT, NINE, TEN, ELEVEN appear as `INSTANCE <ordinal>` in the ledger; ONE, TWO, THREE and SEVEN do not, so I could not enumerate them from the ledger alone. For the three I could inspect (nine, ten, eleven) the characterisation holds — all are "edit the harness, gate stays green". **`[UNENUMERATED]` for the remainder.** I did not find a counter-example, but I did not search exhaustively, and an absence I did not enumerate is not a zero.
- **I did not verify `[MEASURED HERE, `git diff` = 1 line]` on `run.mjs`.** By the time I measured, the worker had committed (`5267fa2a`) and the working tree was clean. The claim was true-or-false at a moment I cannot reconstruct. **Not counted against the ruling.**
- **I did not run the graph validator**, so "the validator does not check completeness" (§8) is untested. It is also now moot: the graph *does* contain the node.
- **I did not audit the landed Surface-B pre-registration** (`078838eb`, `SURFACE-B-POPULATION-FREEZE-2026-08-02.md`). It post-dates the pin and is outside this grade's scope. Given F-3, **it should be graded specifically for whether it inherited `be194136`'s `11 / 99 / 53` as a denominator** — the risk R-588 §6 names and F-3 shows the scheduling error creates.
- **I did not hunt for a twelfth tamper-evidence instance**, per the brief. None was encountered incidentally.
- **I did not evaluate whether taking Surface B is the right *strategic* call.** I evaluated whether its stated evidentiary basis is true. Two of the three supports are false; the decision may still be defensible on other grounds, and re-deriving those grounds is the desk's job, not mine.

---

**Grader independence:** I did not design, build, or previously grade R-588 or the Surface-B lane. My memory holds prior P0PC *harness* grades (batches 1–5) from the same lineage; that lineage is declared here, and this grade's findings derive from artifacts re-read at the pin, not from those receipts. F-4's join key and F-1/F-2/F-3 are novel to this grade.
