# RATIFY-1 PROVENANCE CHAIN — DESIGN SPEC

**Authority:** `R-826 §8[2]`/`§8[3]`, **AMENDED under `R-827 §8[1]`**. **Seat:** worker `claude.exe 23968`.
**Date:** 2026-08-11. **Status:** DESIGN SPEC. **Approved in DIRECTION at `R-827`, amended in SCOPE here.**

> ## ⚡ AMENDMENT `A1` — 2026-08-11, `R-827 §8[1]`
> **The grade landed and `STOP [50]` is LIFTED (`R-827 §7`). `d5076656` is APPROVED IN DIRECTION AND
> INCOMPLETE IN SCOPE — `R-827 §8[1]` forbids implementing it verbatim.** This revision absorbs:
> - **`F-1`** the forged-pair certification — **CONFIRMED CRITICAL, no longer `[HYPOTHESIS]`.**
> - **`F-2`** `[H]` is printed, never gated ⇒ **§3.4[8] + `C8`/`C9`.**
> - **`F-3`** intra-file node-order dependence is **REAL and MEASURED** ⇒ **the `[G-NODE]` axis,
>   the per-child NODE EXECUTION SEQUENCE in §3.1, and `C11`.**
> - **`F-5`** the pin is self-consistent but UNANCHORED ⇒ **§3.4[5a] + `C10`.**
> - **`F-6`** mid-run pin drift ⇒ **already covered by `arm_start_head`/`arm_end_head`; RETAINED.**
> - **`C8`–`C12`** added (§4.2). ✅ **`C7` RETAINED — `R-827 §8[1]` calls it "the sharpest control in
>   the set".**
> - **§3.1's storage shape RELAXED per `R-827 §9`** — one file per child is an OPTION, not a requirement.
>
> ✅ **`§1`'s correction of `R-826 §1` was ACCEPTED (`R-827`, "already struck at source; three
> independent paths agreed") and the grader reached it independently.** It stands unchanged below.

> 🛑 **`STOP [50]` RE-ARMS at `R-827 §8[9]`** — the moment the desk dispatches the FINAL grader, this
> instrument freezes again. **It is lifted now, and only now.**

---

## §1 — THE FOUNDATION FACT, MEASURED HERE, AND IT CORRECTS `R-826 §1` IN THE STRICT DIRECTION

`R-826 §1` corrected the external read's *"`aggregate.json` does NOT contain the child receipt/hash
chain"* to *"a chain too short to bind the population"*, inferring from `sha256` appearing exactly once
that **"AT MOST ONE CHILD IS DIGEST-BOUND"**.

🛑 **`[MEASURED HERE — `json.load` + key-partitioned substring census over the preserved forward map
`4ca0aab3…`]` THE INFERENCE IS TOO GENEROUS. THE COUNT IS RIGHT; THE OBJECT IT COUNTS IS NOT
PROVENANCE.**

```
                                  IN outcomes NODE IDs      OUTSIDE outcomes
'receipt'                                   34 / 39                        0
'sha256'                                          1                        0
per-child records of any kind                   n/a                     NONE
```

- The single `sha256` is the **test node ID**
  `src/engine/tests/test_pilot_conveyor.py::test_prepare_strategy_computes_sha256_when_not_supplied`
  — a test about a *product* feature, carrying no provenance meaning whatsoever.
- Every `receipt` occurrence is likewise a **test node ID** (`test_mp1_candidate_receipt.py`,
  `test_run_receipt.py`, `TestRunReceipt::…`).
- ⚖️ **Count reconciliation, so this does not read as a disagreement with the desk:** the desk's
  `34` is the case-SENSITIVE `grep -o 'receipt'`; `39` is the case-INSENSITIVE total (the extra `5`
  are the capital-`R` `TestRunReceipt` class names). **Both count the same objects. Neither is wrong.**

⇒ ★★★★★ **`ZERO CHILDREN ARE DIGEST-BOUND — NOT "AT MOST ONE". THE EXTERNAL READ'S ORIGINAL WORDING
WAS CORRECT AS WRITTEN, AND THE DESK'S REFINEMENT OF IT WAS THE ERROR — IT COUNTED TEST NAMES AND READ
THEM AS PROVENANCE FIELDS.`** (`[i-measured]`: the join key is the claim; the neighbouring object was
measured. This is offered as a correction to a desk measurement, and the desk owns whether to adopt it.)

**AND THE STRUCTURAL CAUSE, `[MEASURED HERE]` at `accept5_isolated_runner.py:349-360`:** `run_child()`
mints a genuinely rich per-child receipt — `run_id`, per-child `head`, `returncode`, `artifact_sha256`,
`layer2_witness`, `problems`. **`aggregate()` then merges only `outcomes` and three counts, and the
`summary` dict written to `aggregate.json` DISCARDS EVERY RECEIPT.** The provenance is *computed and
thrown away*. ⇒ **The repair is not to invent provenance; it is to STOP DISCARDING IT.**

> ★★★★ **`THE EVIDENCE WAS NEVER MISSING FROM THE RUN — IT WAS MISSING FROM THE ARTIFACT, AND ONLY THE
> ARTIFACT SURVIVES TO BE COMPARED.`**

---

## §2 — WHY A FLAG CANNOT CARRY THIS, AND WHAT REPLACES IT

The forged pair in `R-826 §3` works — **`[HYPOTHESIS]`, the grader settles it** — because `reverse` is a
**DECLARED** property: one Boolean, written by the producer, read by the consumer, corroborated by
nothing. Copy the forward map, flip one bit, and every other byte still agrees with itself.

**THE FIX IS NOT A BETTER FLAG. IT IS TO MAKE THE PROPERTY DERIVED.**

```
DECLARED (today)   aggregate["reverse"] = True        <- one bit, self-asserted
DERIVED (spec)     reverse := (observed FILE ordinal sequence == reverse(canonical file order))
                   reverse_nodes := (observed NODE sequence per child
                                     == reverse(canonical collection order for that child))
                              ^ both recomputed by the verifier from the manifest, every time
```

A forged copy carries the FORWARD ordinal sequence while asserting `reverse=true`. **The two disagree,
and the disagreement is arithmetic, not trust.** ⇒ 🛑 **`R-826 §8[3]` FORBIDS `provenance_verified=true`
and this spec generalises that: NO field in the chain may be believed because it was written down.
Every provenance property is RECOMPUTED FROM LOWER-LAYER BYTES OR IT DOES NOT EXIST.**

🛑 **`R-827 §8[4]` NAMES ALL THREE EXPLICITLY: `reverse`, `reverse_nodes` and `provenance_verified`
"must ALL be DERIVED from evidence, never trusted as written fields — they are the same mistake under
three names."** ★★★★★ **`A SELF-ASSERTED FIELD IS NOT EVIDENCE OF THE THING IT NAMES; IT IS EVIDENCE
THAT SOMEBODY WROTE IT DOWN.`**

### 2.1 — `[G]` HAS TWO AXES, AND THE SECOND ONE IS WHERE THE LIVE DEFECT IS

🛑 **`[MEASURED BY GRADED INSTRUMENT, F-3]` `accept5_isolated_runner.py:323-324` is the WHOLE of the
reordering: `files.reverse()`. Only the FILE list moves; intra-file node order is identical in every
arm.** On `test_run_receipt.py` the grader varied that held-fixed axis and **the failing SET moved while
the COUNT stayed at `2`** — `test_config_hash_deterministic` passes ALONE and fails with siblings.

```
[G-FILE]   file execution order across the 108 governed children
[G-NODE]   node execution order WITHIN each governed file      <- NEW, and F-3 is live in it
BOTH must preserve EXACT NODE ID -> OUTCOME.
```
⇒ ★★★★★ **`THE DEFECT CLASS [G] EXISTS TO DETECT WAS LIVE INSIDE THE POPULATION [G] CERTIFIED, AND [G]
HELD FIXED THE ONE AXIS THAT WOULD HAVE SHOWN IT. A COUNT THAT HOLDS WHILE MEMBERSHIP MOVES IS EXACTLY
WHAT AN EXACT-NODE ORACLE IS FOR.`**
🛑 **`STOP [52]`: this is a WIDENED AXIS, NOT AN ELEVENTH RATIFY LETTER** — the same law as `R-825 §2`
(a sub-proof is not a second obligation), applied in the inverse direction.
🛑 **NO second population registry, NO hand-built `NODE_ORDER`, NO rewrite of `population_successor`.**
`[G-NODE]` is a bounded pytest collection-order hook (`--accept5-reverse-nodes`) that reverses the
collected `items` sequence, **preserving whole-file collection, unauthorized-extra detection, and
helper-file behaviour.**

---

## §3 — THE FOUR-LAYER CHAIN

```
LAYER 1  CHILD RECEIPT      one per governed child, digest-bound to its own artifacts
LAYER 2  ORDERED MANIFEST   names every receipt by digest, IN EXECUTION ORDER
LAYER 3  AGGREGATE          DERIVED from the manifest; carries the manifest digest
LAYER 4  COMPARATOR         RECOMPUTES layers 1-3 before it is permitted to compare outcomes
```

🛑 **EACH LAYER IS BOUND TO THE ONE BELOW BY A DIGEST OVER ITS BYTES.** Breaking any link is
detectable at the layer above without consulting anything outside the two artifacts being compared.

### 3.1 — LAYER 1: the child receipt (persisted, not discarded)

⚡ **STORAGE SHAPE IS FREE (`R-827 §9`).** One file per child, one ordered append-only receipt stream,
or one compact arm manifest are all permitted — **provided every child stays INDIVIDUALLY
DIGEST-ADDRESSABLE and `C1`–`C12` still discriminate.** 🛑 **`AR-989`'s "one physical file per child"
was a design option and is NOT a requirement; do not let a representation choice become a `[H]`
breach.** **The fields below are the CONTENT obligation, not a file layout.**

Per `R-826 §8[2]` plus `R-827 §8[1]`, each child contributes:

| field | meaning | why it is load-bearing |
|---|---|---|
| `run_id` | the child's own minted UUID | joins child ↔ record; already minted and already checked |
| `target` | exact governed file path | the child's identity |
| `ordinal` | **1-based EXECUTION position within this arm** | ⭐ **the field that makes order forgery-evident** |
| `head` | **the commit THIS CHILD measured** | catches a tree that moved mid-arm |
| `returncode` | child process exit code | validity |
| `outcomes` | exact node-ID → outcome membership | the payload |
| **`node_sequence`** | ⭐ **the ORDERED list of node IDs AS ACTUALLY EXECUTED in this child** | **`R-827 §8[1]`: the `[G-NODE]` witness. Without it `reverse_nodes` cannot be DERIVED and `F-3`'s axis stays unmeasurable** |
| `n_collected` | collected count | reconciles against `outcomes` |
| `json_sha256` | digest of the child's result JSON **bytes** | binds the artifact, not its summary |
| `junit_sha256` | digest of the child's JUnit XML **bytes** | second, independent artifact path |
| `layer2_witness` | the Layer-2 eviction witness | proves the boundary ran |
| `validity` | `VALID` \| `REFUSED:<exact reason>` | no partial scoring |

🛑 **`json_sha256`/`junit_sha256` are digests of BYTES ON DISK, taken before the artifact can be
re-read.** A digest recomputed from an in-memory object the producer already trusts proves nothing.
🛑 **`node_sequence` IS A SEQUENCE, NOT A SET, AND MUST BE THE EXECUTION ORDER — not the collection
order re-derived afterwards.** **Re-deriving it defeats its only purpose: a child that executed in an
order other than the one it claims must be detectable, and re-derivation would launder exactly that.**
⚡ **`F-6` CLOSED HERE:** the child's own `head` is now PERSISTED and COMPARED. `[MEASURED BY GRADED
INSTRUMENT, F-6]` today each child re-derives `head_sha` into its receipt and **it is never compared to
anything and never persisted**, so the aggregate's `head` is a claim true only of the run's first
instant.

### 3.2 — LAYER 2: the ordered parent manifest

`manifest.json`, written **after all children, before the aggregate**:

```jsonc
{
  "arm_start_head":  "<SHA at arm launch>",
  "arm_end_head":    "<SHA at arm completion>",
  "population_digest": "<sha256 over the canonical ordered child list from population_successor>",
  "entries": [                       // ORDER IS THE EVIDENCE - never sorted, never a set
    {"ordinal": 1, "target": "<path>", "receipt_sha256": "<digest of the LAYER-1 receipt's bytes>",
     "node_sequence_sha256": "<digest over the child's ORDERED node_sequence>"},
    …
  ]
}
```
⚡ **`node_sequence_sha256` lifts the `[G-NODE]` witness to the manifest layer**, so a re-ordered child
is detectable without re-opening every receipt — and re-opening them still catches it if it does.

🛑 **`entries` IS A SEQUENCE, NOT A SET. Serialising it sorted destroys the only witness to execution
order and silently re-creates the defect this chain exists to close.**
⚡ `population_digest` binds the manifest to the *authority's* child list, so a manifest over a
different or truncated population is detectable without re-deriving the population.

### 3.3 — LAYER 3: the aggregate, DERIVED

`aggregate.json` keeps its 13 keys **plus** `manifest_sha256`, and its previously-declared fields
become derived:

```
manifest_sha256   digest of the LAYER-2 file's bytes
head              MUST equal arm_start_head AND arm_end_head AND every child's head
children          MUST equal len(manifest.entries)
nodes             MUST equal |union of receipt outcomes|, recomputed
outcomes          MUST equal that union exactly, recomputed - never copied forward
reverse           DERIVED per §2; the stored value is a CLAIM to be checked, not a fact
reverse_nodes     DERIVED per §2 from every child's node_sequence; likewise a CLAIM
wall_s            a GATED value, not a printed one -- see §3.4[8]
```

### 3.4 — LAYER 4: the comparator's verification obligation

🛑 **VERIFY-BEFORE-COMPARE. The comparator MUST refuse to report a node-outcome verdict until both
arms pass verification** — a `0-differences` result computed over unverified inputs is precisely the
false green `ACCEPT5-AGGREGATE-PROVENANCE-1` describes.

For **each** arm, independently:

1. Recompute `manifest_sha256` from the manifest file's bytes; compare to the aggregate's.
2. For every entry, recompute `receipt_sha256` from the receipt file's bytes; compare.
3. For every receipt, recompute `json_sha256`/`junit_sha256` from the child artifacts' bytes; compare.
4. Recompute `outcomes`, `nodes`, `children` from the receipts; compare to the aggregate's.
5. Assert `arm_start_head == arm_end_head == aggregate.head ==` **every** child's `head`.
5a. 🛑 **ANCHOR THE PIN, DO NOT MERELY AGREE ON IT (`F-5`).** Assert `aggregate.head` **RESOLVES** —
   `git cat-file -t <head>` ⇒ `commit` — **and EQUALS the pin being certified.**
   🛑 **`[MEASURED BY GRADED INSTRUMENT, F-5]` setting BOTH arms' `head` to
   `deadbeefdeadbeef…` today yields `OK both arms measured the SAME commit` ⇒ `[G] SATISFIED`,
   exit `0`.** ★★★★ **`TWO ARMS AGREEING ON A COMMIT THAT DOES NOT EXIST AGREE ABOUT NOTHING.`**
6. **DERIVE** `reverse` from the FILE ordinal sequence against the canonical population order; compare
   to the aggregate's claim.
6a. **DERIVE** `reverse_nodes` from every child's `node_sequence` against that child's canonical
   collection order; compare to the aggregate's claim. **Mixed arms are a REFUSAL, not a rounding:**
   every child in an arm must agree on the node-order direction.
7. Assert `ordinal` values are exactly `1..N`, no gaps, no duplicates.
8. 🛑 **GATE `[H]`, DO NOT PRINT IT (`F-2`).** Append the wall-clock verdict **TO THE VERDICT LIST THAT
   THE EXIT CODE FOLDS**: `wall_s <= 600.0` ⇒ verdict TRUE; `> 600.0` ⇒ verdict FALSE, **nonzero exit,
   STOP.** 🛑 **`[MEASURED BY GRADED INSTRUMENT, F-2]` a forged `wall_s` of `36000.0` — `60×` the
   ceiling — today PRINTS `*** EXCEEDS CEILING ***` and then returns exit `0`, because no wall-clock
   entry is ever appended to `V` and `allok` cannot see it.** ★★★★★ **`A CHECK THAT PRINTS ITS OWN
   FAILURE AND EXITS ZERO IS NOT A GATE — IT IS A LOG LINE WITH AN OPINION.`** (`[green-check]`: a stop
   condition owes a DISCRIMINATES fixture; `[H]` never had one.)

Then **across** the arms: assert both `population_digest`s are equal, both `head`s are equal, and the
arms' `run_id` sets are **disjoint** — 🛑 **an arm compared against itself is not two pieces of
evidence, and disjoint run IDs is the cheapest test that they are two runs at all.**
⚡ **AND ASSERT THE ARMS STAND IN THE CLAIMED RELATIONSHIP ON THE RIGHT AXIS.** With two axes there are
now four final arms (`R-827 §8[6]`), and each comparison must name which axis it varies:
```
A canonical files / canonical nodes      A vs B  varies [G-FILE]
B reverse   files / canonical nodes      A vs C  varies [G-NODE]
C canonical files / reverse   nodes      A vs D  varies BOTH
D reverse   files / reverse   nodes      A vs E  varies NOTHING  ([I] repeat)
E canonical files / canonical nodes  (REPEAT of A, distinct run)
REQUIRED:  A == B == C == D  ([G])   and   A == E  ([I])   by EXACT NODE ID -> OUTCOME
```
🛑 **A comparison whose arms do not actually differ on the axis it claims to vary is not evidence for
that axis** — the existing arms-are-OPPOSED guard is the right shape and must now exist per axis.

> ★★★★★ **`A 0-DIFFERENCE RESULT PROVES THE TWO INPUTS AGREE. THE CHAIN IS WHAT ADDS THE MISSING TERM:
> THAT THEY ARE TWO INDEPENDENT PIECES OF EVIDENCE.`** (`R-826 §3`, and this spec's whole purpose.)

---

## §4 — THE CONTROLS, STATED AS PROPERTIES (`R-826 §8[3]`)

🛑 **Stated as REQUIRED OUTCOMES, deliberately naming no mechanism** — an implementation satisfies
these by any means, and may not satisfy them by special-casing the fixtures.

| # | property | required verdict |
|---|---|---|
| **C1** | An aggregate copied to a new path with **only** `reverse` flipped, all `2419` outcomes byte-identical | 🔴 **RED** |
| **C2** | Any child artifact tampered with after its receipt was minted | 🔴 **RED** |
| **C3** | A child whose `head` differs from the arm's start pin | 🔴 **RED** |
| **C4** | A genuine, unmodified, independently-produced opposed arm | 🟢 **GREEN** |

🛑 **`C4` IS NOT OPTIONAL DECORATION.** Without it, `C1`–`C3` are satisfied by a verifier that refuses
everything. **A control suite with no positive arm cannot distinguish "catches forgery" from "always
red"** (`worker-execution §5`; the campaign's own mutation-control law).

**Each control additionally owes a POSITIVE WITNESS that the verification path RAN** — 🛑 `C1`–`C3`
are negative assertions, and *"did not certify"* is satisfied by a verifier that crashed on startup.
**Name the check that fired and the values it compared, or the RED is unwitnessed.**

⚡ **AND THE VERDICT MUST BE DERIVED:** the controls are satisfied only if the RED arises from a
recomputation disagreeing with a stored value. 🛑 **A `provenance_verified` Boolean — or any field
whose remedy is "trust the flag" — is FORBIDDEN by `R-826 §8[3]` and converts silent drift into
accepted drift.**

### 4.1 — controls this spec ADDS, because the four above leave three doors open

| # | property | required verdict |
|---|---|---|
| **C5** | An arm compared **against itself** (same `run_id` set, both files identical) | 🔴 **RED** |
| **C6** | A manifest with a receipt **removed** (and `children` decremented to match) | 🔴 **RED** |
| **C7** | A manifest whose `entries` are **re-sorted** while every receipt stays valid | 🔴 **RED** |

⭐ **`C7` is the sharpest of the three:** every digest still verifies, every receipt is genuine, and
only the *recorded order* is wrong. **It is the one forgery that a purely digest-based chain cannot
catch** — it is caught only because `reverse` is DERIVED from the ordinal sequence (`§2`). **A chain
that passes `C1`–`C6` and fails `C7` has hashes but no order witness.**
✅ **`R-827 §8[1]` RETAINED `C7` EXPLICITLY as "the sharpest control in the set".**

### 4.2 — `C8`–`C12`, ADDED UNDER `R-827 §8[1]` — EACH ONE ANCHORED TO A MEASURED FINDING

| # | property | required verdict | closes |
|---|---|---|---|
| **C8** | `wall_s` forged **above** the ceiling (e.g. `600.01` s, or the grader's `36000.0`) | 🔴 **RED**, nonzero exit | `F-2` |
| **C9** | `wall_s` genuinely **under** the ceiling | 🟢 **GREEN** | `F-2` positive arm |
| **C10** | **BOTH** arms' `head` set to a commit that resolves in no tree (`deadbeef…`) | 🔴 **RED** | `F-5` |
| **C11** | An arm whose declared `reverse_nodes` disagrees with the `node_sequence` its own children recorded | 🔴 **RED** | `F-3` |
| **C12** | 🛑 **A red-proof fixture built on a SYNTHETIC pin** — the control suite's own fixtures must use a REAL resolvable commit; a fixture whose `head` cannot resolve must itself be REFUSED | 🔴 **RED** | `F-5`'s **root** |

🛑 **`C9` IS NOT PADDING.** Without it, `C8` is satisfied by a gate that reds on every input — **the
same always-red hole `C4` closes for the chain, reopened one obligation later.**

⭐ **`C12` IS THE ONE THAT STOPS THIS RECURRING, AND IT IS THE DEEPEST FINDING IN THE GRADE.**
`[MEASURED BY GRADED INSTRUMENT / MEASURED AT THE LINE, `g_order_identity.py:215`]` **the existing
red-proof fixture hardcodes `"head": "deadbeef"`.** The controls that certify the comparator were
themselves written against a fake pin — **so the instrument was never taught to demand a real one, and
`F-5` was not an oversight in the comparator so much as a property inherited from its own test data.**
⇒ ★★★★★ **`A RED-PROOF FIXTURE IS A SPECIFICATION. WHATEVER IT NORMALIZES, THE INSTRUMENT WILL ACCEPT
FOREVER.`** (`R-827 §4`.) 🛑 **`C12` therefore audits the CONTROLS, not the comparator — it is the only
control in this set whose subject is the other controls, and it may not be dropped as meta.**

### 4.3 — REPORTING OBLIGATION ON EVERY CONTROL (`R-827 §8[5]`)

🛑 **Every RED must NAME which recomputation disagreed, the EXPECTED value and the OBSERVED value.**
A control that reds without naming the disagreement cannot be distinguished from a control that reds
because the verifier fell over. 🛑 **AND "no certification occurred" IS NOT A PASS IF THE VERIFIER
MERELY CRASHED** — every negative control owes a **POSITIVE WITNESS that the verification path ran.**

---

## §5 — SCOPE, AND WHAT THIS SPEC DOES NOT COVER (honest-partial, `R-826 §8[6]`)

**COVERED:** the evidence format and the verification obligations for the `RATIFY-1` `[G]`/`[H]`/`[I]`
comparison surface — child receipt, ordered manifest, derived aggregate, comparator duties, seven
controls.

**RESOLVED SINCE `A1`:**
- ✅ **The `[HYPOTHESIS]` is now a MEASUREMENT.** `F-1` is CONFIRMED: `load_arm()` opens only
  `aggregate.json` and **nothing in the call path ever opens a child artifact**, so a forged arm
  sitting in a directory **with no child artifacts at all** certifies `15/15 OK`, exit `0`.
  🛑 **AND THE SCOPE STAYS SPLIT (`R-827 §1`): this is NOT an allegation that the three runs were
  fake — the grader independently found they were genuine. It is that the instrument CANNOT TELL.**
  ★★★★★ **`THOSE TWO FACTS LOOK IDENTICAL FROM INSIDE THE INSTRUMENT, AND THAT IS WHY doer ≠ grader IS
  STRUCTURAL AND NOT A COURTESY.`**

**STILL NOT COVERED, NAMED RATHER THAN IMPLIED:**
- **No migration or back-fill path** for the three existing `PRE-GRADE / WORKER-MEASURED` maps. Per
  `R-826 §5` they are historical evidence and are **not** to be canonised; re-deriving a chain over
  them retroactively would manufacture provenance that did not exist at run time. 🛑 **A chain minted
  after the fact is a claim about the past, not a receipt from it.**
- **Cost: `[UNMEASURED — OPEN]`, and now with a RULED resolution order.** The persistence + digest
  work must land inside `[H]`'s `7.2%` headroom against a **FROZEN** `10.0`-min ceiling.
  ⚡ **`R-827 §9` settles the collision in advance and I do not re-open it: THE CEILING DOES NOT GIVE
  (`[pre-register-criteria]`) AND THE CHAIN DOES NOT GIVE (weakening it recreates the false green).
  WHAT GIVES IS THE STORAGE REPRESENTATION** (§3.1). ⚡ **MEASURE THE COST; DO NOT SPECULATE — the
  runner ALREADY computes the hashes, so the increment is largely PERSISTING AND VERIFYING DATA THAT
  ALREADY EXISTS.** 🛑 **If an efficient COMPLETE representation still exceeds `10.0` min, the
  one-subprocess-per-file architecture fails `[H]` on this machine ⇒ STOP AND REDESIGN.**
  ★★★★ **`WHEN A BUDGET AND A CORRECTNESS PROPERTY COLLIDE, THE THING THAT YIELDS IS THE
  IMPLEMENTATION — NOT THE BUDGET, AND NEVER THE PROPERTY.`**
- **Nothing about the `287`/`11`/`7` populations** — `STOP [44]`/`STOP [37]`, and `R-827 §8[10]`
  forbids touching them **in any way**. 🛑 **AND `R-827 §5` RETRACTED THEIR TARGET: the `287` is a
  HARNESS-CONDITIONED MIXTURE of unknown composition, not a baseline.** `[MEASURED BY GRADED
  INSTRUMENT, F-4]` `5 of 5` sampled files pass COMPLETELY without `--accept5-layer2`; **`278` of the
  `287` are UNENUMERATED and no proportion is claimed by anyone.** ⇒ **`STOP [53]`: both *"most of the
  `287` are artifacts"* and *"`287` is the honest baseline"* are FORBIDDEN sentences.**
  ★★★★★ **`A MAP IS ONLY AS HONEST AS THE INSTRUMENT THAT DREW IT, AND WE JUST LEARNED OURS EDITS THE
  TERRITORY.`**
- **No authority over `acceptance_runner.py` promotion**, which stays `NOT AUTHORIZED` (`R-826 §8[5]`).

---

## §6 — IMPLEMENTATION IS NOW AUTHORIZED, AND ITS ORDER IS FIXED

✅ **THE CONDITION IS DISCHARGED.** `R-826 §8[4]` made implementation conditional on the grader
confirming `ACCEPT5-AGGREGATE-PROVENANCE-1`. **It is CONFIRMED CRITICAL, and `R-827 §8` authorizes the
full sequence with NO round-trip between green substeps:**

```
1 amend this spec            <- THIS REVISION
2 ACCEPT5-LAYER2-OWNERSHIP-REPAIR-1   (P1..P5; NOT a 32-file mock campaign)
3 re-run [F] and [J] on the REPAIRED layer 2
4 implement chain + pin binding + node-order evidence + a REAL [H] gate
5 run C1..C12 with positive witnesses
6 final arms A..E from ONE clean, exclusive, exact-SHA worktree  (STOP [35])
7 require A == B == C == D  and  A == E   by exact node ID
8 [H] each full arm <= 10.0 min THROUGH THE NEW GATE
9 the DESK dispatches an independent accuracy-validator; STOP [50] RE-ARMS
```

🛑 **THE STOP CONDITIONS ARE `R-827 §8`'s AND THEY OUTRANK PROGRESS:** **`STOP A`** repaired layer 2
cannot BOTH keep the `5` sample files clean AND contain the real `[F]` leak · **`STOP B`** the
intra-file map still moves after the repair — **report the exact moving nodes and TUNE NO
ASSERTIONS** · **`STOP C`** any of `C1`–`C12` fails to discriminate · **`STOP D`** any final arm
exceeds `10.0` min · **`STOP E`** the final grader finds another authoritative-looking false green.

🛑 **STILL NOT AUTHORIZED (`R-827 §8[10]`):** promotion before the SECOND grade · any seal ·
`CLUSTER-E` · touching the `287`/`11`/`7` in any way · raising the ceiling · parallelizing · a second
population registry · HTF production · **`MP1` / the money path** · any production, compiler or
backtester change.

🛑 **AND THE REPAIR THAT IS FORBIDDEN BECAUSE IT LOOKS LIKE A FIX:** **DO NOT DELETE LAYER 2.** Real
`[F]` MEASURED that without a boundary one test's `sys.modules` write is observed by a later test.
★★★★ **`LAYER 2 IS NEEDED; CURRENT LAYER 2 IS TOO BROAD. "CREATED DURING THE TEST BODY" IS NOT THE SAME
PROPERTY AS "POLLUTION OWNED BY THIS TEST" — AN ORDINARY IMPORT IS NOT GARBAGE, AND A BOUNDARY THAT
CANNOT TELL THEM APART MANUFACTURES THE FAILURES IT THEN REPORTS.`** (`R-827 §3`.)
