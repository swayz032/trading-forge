# INDEPENDENT DESIGN REGRADE — `P0-REDESIGN-PACKET-2026-07-31.md` @ `02557efd`

**Grader:** `accuracy-validator` (pre-implementation architecture regrade — SECOND AND FINAL grade of this packet)
**Date:** 2026-07-31
**Object under grade:** `docs/designs/P0-REDESIGN-PACKET-2026-07-31.md`, blob `7106d91f853af8f50144470d5738a908d745ceb0` (184 lines) [MEASURED HERE]
**Pinned commit:** `02557efdbf09617096f142172372fafd558fc7eb`, branch `h1-wave4-sealed12-driver`; HEAD at grade time `== 02557efd` (did not move) [MEASURED HERE]
**Tree:** `C:/Users/tonio/Projects/wt-h1-wave4-20260712` — linked worktree; `git rev-parse --git-common-dir` → `C:/Users/tonio/Projects/trading-forge/trading-forge/.git` [MEASURED HERE]
**Prior grade, read as an artifact and NOT assumed right:** `GRADE-P0-REDESIGN-PACKET-2026-07-31.md`, blob `34f142d897bd402a35d25bcb783d876c1455df02` @ `48e50d80` [MEASURED HERE]
**Code under redesign:** `git show c304b098:scripts/check-spec-binding-plan-parity.ts`, 1536 lines [MEASURED HERE]
**Oracle data — the input the prior grade did NOT open:** `git show c304b098:ci/fixtures/spec-binding-parity-expanded/ORACLE.json`, 25,095 B, **30 rows across 12 fixtures** [MEASURED HERE]

---

## VERDICT: **FAIL — NAMED DESIGN DEFECT**

**Do not implement as written.** One CRITICAL, one HIGH, one MEDIUM. All three are document-level and all three have small document-level corrections (§ *The smallest correction*).

**What the amendment genuinely fixed, stated first and without hedging:**

- **The MANDATORY TEST is SATISFIED on its own terms.** §4.2b (`:114-116`) specifies that a row's omitted expectation fields are computed and each must be **asserted** or **named in `row.unadjudicated`**, else **FATAL naming `fixture · condition_id · omitted field`**; `ABORT` 2 (`:149`) pre-registers *"remove `bindable` outright from `ORACLE.fixtures["20-nyam-evaluable.spec.json"].conditions.sess` → RED, NON-ZERO EXIT, naming the ROW and the FIELD."* The target row exists and carries `bindable: true` [MEASURED HERE], so the mutation is performable. **`delete bindable` → RED, non-zero exit, key named: specified. D-1's exemplar is closed.**
- **The NON-CIRCULARITY CLAUSE SURVIVES MY ATTACK on the axes it names.** Requiredness is sourced from a frozen contract "declared in the gate's own source and versioned with it" (`:119`), the TS interface is explicitly disqualified as that contract (`:121`), and `ABORT` 2b (`:152`) makes presence-inferred requiredness a refusal condition. For **membership** and **type**, this is genuinely independent of `ORACLE.json` — **not** a restatement that bottoms out in the oracle. I tried to break it and could not.
- `D-2` discharged (§7a ladder, rung 3 named as a real false-green path and declared out of scope); `D-3a` closed (§4.1 extends to `OracleFixture`); `D-3b` closed (§6 GREEN control now asserts the final summary line **and** exit 0).

**The defect is not in what §4.2b says. It is that §4.2b, applied to the oracle it must govern, admits exactly one contract — and that contract closes one field of seven.**

---

## Finding R-1 — CRITICAL — §4.2b's only self-consistent instantiation is the required set `{bindable}`; 111 live expectations stay silently deletable

**Severity:** CRITICAL (false green; `D-1`'s mechanism survives on 6 of 7 expectation keys, and the pre-registered red-proof is passable by a design that closes exactly its own exemplar)

### The claim under attack
> *"closes the CRITICAL deletion gap (`D-1`) found in the prior grade … sharply enough to authorize ONE implementation attempt."*

### Reality [MEASURED HERE]

§4.2b is a rule over data. `ORACLE.json` at `c304b098` is that data. Applying the rule to the data is arithmetic, requires no gate execution, and settles the question.

The expectation-key universe is 7 (`:576-605`): `bindable` · `primitive_null` · `session_zone` · `approximation` · `reason_null` · `reason_names` · `reason_excludes`. Live presence across the **30 rows**:

| key | rows carrying it |
|---|---|
| `bindable` | 29 |
| `reason_null` | 29 |
| `primitive_null` | 26 |
| `session_zone` | 26 |
| `approximation` | 22 |
| `reason_names` | **4** |
| `reason_excludes` | **4** |

§4.2b's escape hatch is **`row.unadjudicated` only** (`:115`, verbatim: *"NAMED in `row.unadjudicated` as a declared gap"*). Only 8 rows carry `unadjudicated` at all.

**I enumerated all 2⁷ = 128 candidate required sets and tested each against the packet's own two pre-registered controls** — §6's clean control (`A0_noop_reformat_only` GREEN through its final summary line) and `ABORT` 2's deletion case (`delete bindable` → RED):

| namespace reading | required-sets keeping the CLEAN CONTROL green | maximal such set | …that also make `delete bindable` RED |
|---|---|---|---|
| expectation-key names (literal §4.2b) | **2 of 128** | **`{bindable}`** | **1** → `{bindable}` |
| the code's gap names (`:697-701`) | **2 of 128** | **`{bindable}`** | **1** → `{bindable}` |

**Under both readings there is exactly ONE viable frozen contract: `{bindable}` — one key of seven.** Under it, `primitive_null` · `session_zone` · `approximation` · `reason_null` · `reason_names` · `reason_excludes` carry **no totality duty**, so deleting any of them from any row is GREEN, byte-identical, exit 0. **Measured exposure: 111 live expectations across all 30 rows remain silently deletable** — `D-1`'s exact symptom, on 6 of the 7 keys, after the fix.

### Root cause — a single legitimately out-of-scope row collapses the global rule [MEASURED HERE]

`50-family-axis-invalidations.spec.json` → `conditions.inv_in_entry`:

```json
{
  "authority": "authority section 6 — NON-SESSION FAMILY, EXPLICITLY OUT OF ORACLE SCOPE",
  "unadjudicated": { "bindable": "NO EXPECTATION. INVALIDATE placed in entry_conditions … authority §6 leaves it unadjudicated. AGREEMENT is enforced." }
}
```

This row is **correct as authored.** Its out-of-scope status is declared at **FIXTURE** level in `conditions_unadjudicated` prose; only `bindable` is declared at **ROW** level. §4.2b reads `row.unadjudicated` and nothing else, and says *"For every `OracleRow`"* with no population bound — so this one row forces every other key out of the required set for the **entire oracle**. §4.2b runs in `validateOracleContractOrExit()` (§4.1, `:404-409`), whose loop iterates `Object.entries(fx.conditions)` **independently of the plan** [MEASURED HERE, `:404-409`], so the row is reached with certainty.

### Why this is disqualifying rather than residual

The packet's own law, `:150`: **`A RED-PROOF THAT INHERITS THE BLIND SPOT IT WAS WRITTEN TO CATCH PROVES NOTHING.`** `ABORT` 2 registers exactly one deletion case, on `bindable`, and `{bindable}` is exactly the one contract that passes both controls. **The red-proof is satisfiable by a design that closes its own exemplar and nothing else** — and would be certified GREEN. The packet red-proofed `ABORT` 4 against itself and caught an already-red guard (`:155`, the strongest act in the document); it did not run that same self-test on §4.2b, its CRITICAL fix. Had it done so on the real oracle, this is what it would have returned.

**Repro (document + data; no gate execution required):**
```
git show c304b098:ci/fixtures/spec-binding-parity-expanded/ORACLE.json > ORACLE.json
# for each R ⊆ {7 expectation keys}: clean control GREEN iff ∀rows, ∀k∈R: present(k) ∨ k∈keys(row.unadjudicated)
# → only R={} and R={bindable} pass; only R={bindable} also makes `delete bindable` RED.
```
**Blast radius:** every CLAIM-2 correctness expectation except `bindable` — 111 of them.

---

## Finding R-2 — HIGH — the VACUOUS-VALUE operator is unreached: `reason_names: ""` disarms a live expectation, present and well-typed

**Severity:** HIGH (false green; a single-token edit reproducing `F-2`'s exact symptom, unreached by §4.1/§4.2/§4.2b/§4.3 and absent from the pre-registered red-proof)

**The brief asked me not to stop at deletions. This is the class beyond them.**

`reason_names` and `reason_excludes` are **`string`** — substring predicates, not collections (`:584`, `:591`). At `:735-738` the guard is `if (typeof r !== "string" || !r.includes(want.reason_names))`. **`String.prototype.includes("")` is unconditionally true**, so `reason_names: ""` reduces the P-4 zone-attribution assertion to *"reason is a non-null string"*.

**[MEASURED HERE — predicates re-executed verbatim from `:735-748`, with positive controls:]**

| `want.reason_names` | observed reason | result |
|---|---|---|
| `"NY_AM"` | correct reason | GREEN |
| `"NY_AM"` | **wrong** reason | **RED** ← positive control: the instrument discriminates |
| `""` | correct reason | GREEN |
| `""` | **wrong** reason | **GREEN** ← **VACUOUS — the disarm** |
| `"o"` | **wrong** reason | **GREEN** ← vacuous via a 1-char generic substring |
| *(deleted)* | wrong reason | GREEN ← the `D-1` baseline, for comparison |

Direction check: `reason_excludes: ""` goes **RED** (`:743-746`), so it is not a false-green path — the exposure is `reason_names`, live on **4 rows** (`10-lunch-orphan.sess`, `11-premarket-orphan.sess`, `30-compiled-flip.sess`, `40-overrefusal-boundary.sess`).

**Why §4.1–§4.3 all miss it:** the key is known (§4.1 passes) · the type is `string`, correct (§4.2 passes) · §4.2b's own definition of *asserted* is **"present and well-typed"** (`:115`), which `""` satisfies · §4.3 governs the fixture surface.

**This operator is already in the desk's measured evidence base and already classified as a DISARM.** The `c304b098` grade's `N8` set `reasons_must_differ_from: []` → `EXIT=0`, byte-identical, and adjudicated it under `F-3` — a disarm finding, not a correctness one. §4.3 closes the empty-value operator at **fixture** level. **§4.2b leaves it open at ROW level.** That is verbatim the shape the packet itself names at `:109`: *"Closing one level and leaving the adjacent one open is the shape this lineage has now repeated five times."*

**This is not subsumed by the §7a rung-3 scope limit.** Rung 3 is *"the assertion runs and discriminates, but against the wrong value."* A tautological predicate does not discriminate at all — it has **no path to red** on the content axis, and by this desk's standing law a guard that cannot fail is not a guard. Vacuity is a **disarm**, which is rung 2, marked **✅ closed** at `:179`. It therefore **falsifies §7a's headline consequence at `:184`**: *"this design makes the oracle IMPOSSIBLE TO DISARM SILENTLY."* A single-token edit disarms it silently.

**Absence measured with positive controls** [MEASURED HERE, over the packet]: `non-empty` **0** · `vacuous` **0** · `vacuity` **0** · `empty string` **0** · `strength` **0**. Controls on the same pipeline: `4.2b` **8** · `unadjudicated` **9** · `ABORT` **10** · `OracleRow` **5** · `bindable` **6** · `reason_names` **3**. The zeros are measured absences.

**Answer to the brief's non-circularity check, precisely bounded:** the frozen contract is genuinely independent for **membership** and **type**. It does **not** govern **assertion strength**, and for substring predicates strength is a free parameter read from the artifact under test whose floor is vacuous. **That is the residual self-authorizing axis — narrower than "the clause is a mirror", and real.**

---

## Finding R-3 — MEDIUM — §4.2b joins two namespaces that are not equal in live data

**Severity:** MEDIUM (join-key mismatch inside the CRITICAL fix; costs exactly 3 false-FATALs, measured)

§4.2b requires each omitted expectation field to be *"NAMED in `row.unadjudicated`"* — implying the gap key and the expectation key are the same token. **They are not** [MEASURED HERE, `:697-701`]:

| expectation key | gap name the code uses |
|---|---|
| `bindable` · `session_zone` · `approximation` | same |
| **`primitive_null`** | **`primitive`** |
| **`reason_null` · `reason_names` · `reason_excludes`** | **`reason`** (one name for three keys) |

Live usage confirms the mismatch is not theoretical: gap names actually present are `approximation` (7) · **`primitive` (3)** · `session_zone` (3) · `bindable` (1). **The two readings differ by exactly 3 FATALs (59 vs 56) — precisely the 3 rows declaring `primitive`.** [MEASURED HERE] The packet mentions `primitive_null` once (`:121`, the interface listing) and never notices its gap name differs. Under the coarse reading, one `reason` token would discharge three expectation keys at once.

---

## THE TEN QUESTIONS (R-518 §5)

| # | Question | Verdict | Basis |
|---|---|---|---|
| 1 | Closed schema — unknown / **missing** / extra key | **FAIL** | unknown ✓ §4.1 (now incl. `OracleFixture`); extra ✓; **missing: closed only for `bindable` — R-1** |
| 2 | Runtime types — `reason_null: "true"` survives? | **PASS** | §4.2 replaces the `:729`/`:732` double equality with read → assert-boolean → branch |
| 3 | Total semantics — satisfied by absence / skip / unresolved / missing fixture? | **FAIL** | missing fixture ✓ (`:655`); unresolved lookup ✓ (`:1425-1435`, DENIED not skipped); **absence ✗ on 6 of 7 keys (R-1); vacuous predicate ✗ (R-2)** |
| 4 | Relationship integrity — deleting/corrupting `reasons_must_differ_from` NECESSARILY red? | **PASS** | §4.3 removes `?? []` as an acceptance path, asserts + prints the pair count, demands a declared reason; correctly sited at fixture level per premise 2 |
| 5 | Pre-registered red paths incl. **deleted required key** and clean control | **PARTIAL** | all five registered incl. deletion + declared-gap control + final-summary-line clause; **but the deletion case is satisfiable by a one-key contract (R-1) and no vacuity case exists (R-2)** |
| 6 | Next granularity — more than a field-validation patch? | **PARTIAL** | §7a is an **honest declaration**, not an appearance of one: it names rung 3, quotes the grade's *"largest single gap"* against itself, says what would close it, and refuses to claim closure. **Credited.** Deducted only because rung 2 is marked ✅ while R-1/R-2 leave it open |
| 7 | Authority independence — expectations frozen independently of both lanes? | **PARTIAL** | contract independent for membership + type (survives attack); **strength not frozen — R-2**; value-vs-authority explicitly declared out of scope (§7a) |
| 8 | Population totality — adjudicated or explicitly unadjudicated | **FAIL** | fixture ✓; distinctness ✓ §4.3; **row FIELD population ✗ — R-1** |
| 9 | Scope control — baseline-delta, not absolute | **PASS** | §6.4 is a delta against a recorded baseline. **Independently reproduced here:** `git status --porcelain -- scripts ci src` → ` M src/engine/tests/test_synthetic_market_simulator.py`, exactly as premise 3 states |
| 10 | Executable completion signal — final summary line AND exit code | **PASS** | `:149`/`:151` require the GREEN control to assert the final summary line **and** exit 0 (`D-3b` closed) |

---

## THE SMALLEST DOCUMENT-LEVEL CORRECTION

Four edits. **No re-architecture** — §4.2b's mechanism is right; it is under-specified against its own data.

1. **Bound §4.2b's row population (closes R-1).** *"For every `OracleRow`"* → *"for every `OracleRow` **not declared out of scope by its fixture's `conditions_unadjudicated` / `conditions_unadjudicated_ids`**"* — reusing the population boundary the packet already cites at `:460-462` for `F-4`. Then state the frozen contract's required set explicitly. **Without a population bound the only viable required set is `{bindable}`.**
2. **State the gap-name JOIN (closes R-3):** `primitive_null` declares as `primitive`; `reason_null`/`reason_names`/`reason_excludes` declare as `reason`. Say whether one `reason` token may discharge all three.
3. **Add a NON-VACUITY clause to §4.2 (closes R-2):** a substring expectation must be non-empty **and** must discriminate — it must not be satisfied by every string the lane can emit. `""` is a FAILURE, not a well-typed value.
4. **Add two scored cases to `ABORT` 2 / §6:** (a) `reason_names: "" ` → **RED**; (b) deletion of a **non-`bindable`** required expectation (e.g. `session_zone` from `20-nyam-evaluable.sess`) → **RED** — so the red-proof cannot be passed by a one-key contract.

**With those four edits I see no remaining architectural false-green path**, subject to the coverage limits below.

*Supplementary, not part of the brief's outcome vocabulary:* band **6/10** — up from 6 on a materially stronger document (D-2/D-3a/D-3b genuinely closed, the mandatory test genuinely specified, §7a genuinely honest), held at 6 because the CRITICAL it was amended to close survives on 6 of 7 keys. **No band ≥7 is available while a design's own red-proof is passable by a contract that closes only its exemplar.**

---

## MANDATORY CLOSING COVERAGE SECTION

### 1. What I verified, and via which two-plus non-overlapping paths

| Claim | Path A | Path B | Path C |
|---|---|---|---|
| Pin, tree and blob identity | `git cat-file -t 02557efd` → commit; `git rev-parse 02557efd:<path>` → `7106d91f` | HEAD compared to pin (equal — no ancestry assumption needed) | `git rev-parse --git-common-dir` discriminates the linked worktree |
| What the amendment changed | `git diff 7134bb34 02557efd -- <packet>` (+44/−5, hunks read individually) | full re-read of the 184-line amended blob | prior grade's three prescriptions matched one-to-one against the hunks |
| **R-1: only `{bindable}` is viable** | **exhaustive enumeration of all 128 required-sets against the parsed 30-row `ORACLE.json`** | **independent hand-read of `inv_in_entry`, which alone forces the collapse** | **both namespace readings computed separately; identical answer (2 of 128, maximal `{bindable}`)** |
| **R-1: §4.2b reaches that row** | `:404-409` loop iterates `Object.entries(fx.conditions)` independent of the plan | §4.2b's own words *"For every `OracleRow`"* — no population bound | `inv_in_entry` confirmed present in `conditions`, not in `invalidations` |
| **R-2: `reason_names: ""` is vacuous** | **static read of `:735-738`** | **predicates re-executed verbatim with positive controls (true expectation → RED on wrong reason; `""` → GREEN)** | **ECMA-262 `String.prototype.includes("")` is unconditionally true; and the graded instrument already measured the sibling operator `[]` (N8) as a live disarm at fixture level** |
| **R-3: namespace mismatch** | read `:697-701` gap-name literals | census of gap names actually used in live data (`primitive` ×3) | the 59−56 = 3 FATAL delta equals the `primitive` count exactly |
| Mandatory test specified | §4.2b `:114-116` text | `ABORT` 2 `:149` scored case (non-zero exit, row+field named) | target row `20-nyam-evaluable.sess` confirmed to carry `bindable: true` |
| Premise 3 (baseline-delta) | `git status --porcelain -- scripts ci src` → 1 pre-existing modified file | full `git status --short` → 8 modified + 24 untracked `docs/designs`, all other lanes' | packet `:155` self-red-proof record |

### 2. Positive-control witnesses for every absence claim

| Absence claimed | Positive control | Result |
|---|---|---|
| Packet never addresses vacuity / assertion strength (R-2) | same `grep -ic` pipeline for `4.2b` / `unadjudicated` / `ABORT` / `OracleRow` / `bindable` / `reason_names` | 8 / 9 / 10 / 5 / 6 / 3 — pipeline works; probes returned 0 |
| The `reason_names` guard is genuinely disarmed by `""` | the same guard with a real expectation against a **wrong** reason | **RED** — the instrument discriminates, so the `""` GREEN is a real disarm and not a dead path |
| `reason_excludes: ""` is NOT a false-green | same harness, `reason_excludes` branch | **RED** — already-red, correctly excluded from the finding |
| No required-set larger than `{bindable}` survives | enumeration also reports the count of surviving sets (2) and tests the empty set | `{}` and `{bindable}` — arithmetic is total over 128, not sampled |
| Packet never states a required set | `grep -in "required"` → 8 hits, all read; none names a set | search works; the absence is of a *set*, not of the word |

### 3. Join keys checked for every "identical / unchanged / matches" claim

- **Object identity:** git **blob SHA** for packet (`7106d91f`), prior grade (`34f142d8`), code, and `ORACLE.json` — not path, not filename.
- **Pin vs HEAD:** **commit SHA**, verified equal rather than assumed.
- **Packet claim ↔ code:** **line number within the `c304b098` blob**, every citation opened in the shipped blob, never in this worktree's copy (a different blob).
- **R-1's decisive join:** **expectation-key token ↔ `row.unadjudicated` key token**, computed under *both* candidate namespaces rather than assuming one.
- **R-3's join:** **gap-name literal at `:697-701` ↔ expectation-key name at `:576-605`** — the mismatch is the finding.
- **Amendment ↔ prescription:** prior grade's edits 1/2/3 ↔ packet hunks at `:114-122`, `:149-151`, `:172-184`.

### 4. What I did NOT verify, and why

- **I did not execute the real gate.** This worktree's `scripts/check-spec-binding-plan-parity.ts` is a different blob from `c304b098`'s, and running it here would resolve its `refusedSessionZone` import (`:47`) against this tree's engine lane — the wrong object. **R-1 needs no execution** (it is a rule applied to data, computed here in full). **R-2's empirical leg rests on re-executed predicates + language semantics + the graded instrument's `N8`, not on a run of the shipped gate.**
- **Whether the implementation, once written, actually turns these mutations RED.** Unexecutable against a document. I graded design reachability.
- **The authority document** `ORACLE-AUTHORITY-ORPHAN-ZONES-2026-07-30.md`. I did not open it, so I did not test rung 3 — which the packet declares out of scope and which I did not re-litigate.
- **Whether `F-1`/`F-4`/`F-5` are exhaustive of the caption family.** No caption census run, by anyone. `UNENUMERATED`.
- **Whether the desk should grant a third round.** A desk decision, and the brief pre-committed it.

### 5. Left UNDETERMINED

- **The intended content of the frozen contract.** The packet names the mechanism but never states the required set; R-1 shows the live data admits exactly one, which is almost certainly not what the author intended. **The gap between intent and the only viable instantiation is the defect, not a reading error on my part** — I computed both readings and both collapse identically.
- **Operator classes I enumerated but could not fully price:** JSON **duplicate key** (last-wins under `JSON.parse`; passes closed-key, type and totality — a *delivery vehicle* for R-2 rather than an independent class, and it leaves the original correct line visible in the diff); **reorder** (no semantic effect measured); **shadowing at a different nesting level** (not reached — `conditions` is a flat `Record`).

### 6. Independence declaration

I did **not** author, design, or edit `P0-REDESIGN-PACKET-2026-07-31.md`, `GRADE-P0-REDESIGN-PACKET-2026-07-31.md`, `GRADE-C304B098-2026-07-31.md`, any of the five code deliveries, or `R-516`/`R-518`/`R-519`. **I have never previously graded this packet.**

**Lineage I must declare:** I am the same agent **identity** (`accuracy-validator`) that authored both the prior grade of this packet (`48e50d80`) and the `c304b098` code grade — a different instance with no shared context, dispatched from the same parent session. I therefore treated **both** as artifacts to be re-read and re-attacked, not as recalled knowledge: every quotation was re-extracted from its pinned blob, and I did not carry forward the prior band.

**Two consequences I actively controlled for.** First, **the prior grade was itself a claim, and I tested it rather than inheriting it** — I re-derived its `D-1` reasoning, confirmed premises 1–3 independently, and confirmed its three prescriptions were landed. Second, and decisively: **the prior grade's own blind spot is the reason R-1 exists.** It reasoned entirely over the packet and the gate **source**, and never opened `ORACLE.json` — its coverage section says so ("`ORACLE.json`'s full key space … `UNENUMERATED`"). Its prescription was therefore correct in mechanism and untested against the data the mechanism must govern. **Opening that file was my one non-overlapping path, and it is where both R-1 and R-2 came from.** The packet did not introduce R-1; it faithfully implemented a prescription that was never checked against the oracle — the same inheritance the prior grade admitted for `D-1`.

No band was carried forward; the verdict was re-derived from current artifacts only.

### 7. Findings by severity

| Severity | Count | IDs |
|---|---|---|
| CRITICAL | 1 | R-1 |
| HIGH | 1 | R-2 |
| MEDIUM | 1 | R-3 |
| **Total** | **3** | |

**Disposition: FAIL — NAMED DESIGN DEFECT.** The amendment closed `D-2`, `D-3a`, `D-3b` and correctly specified the deletion red-proof. It did not close `D-1`, because the rule that closes it was never tested against the oracle it governs: **its only self-consistent instantiation protects 1 expectation and leaves 111 deletable.** Four document-level edits, all named above, would in my assessment make this packet sound enough to authorize the single implementation attempt.
