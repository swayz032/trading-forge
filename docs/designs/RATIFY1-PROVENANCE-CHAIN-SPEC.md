# RATIFY-1 PROVENANCE CHAIN — DESIGN SPEC

**Authority:** `R-826 §8[2]`/`§8[3]`. **Seat:** worker `claude.exe 23968`. **Date:** 2026-08-11.
**Status:** DESIGN SPEC ONLY. **No instrument code is changed by this document.**

> 🛑 **`STOP [50]` HELD.** `g_order_identity.py` and `accept5_isolated_runner.py` are FROZEN while the
> grader attacks them. This spec was written by READING them and EDITING NEITHER. **Reading is not
> editing; `STOP [50]` freezes the instrument, not the documentation of it.**
> 🛑 **`R-826 §3`'s copied-aggregate attack WAS NOT EXECUTED BY THIS SEAT.** That is the grader's
> surface; a doer's pre-emptive result muddies `doer ≠ grader`. **Every statement below about what the
> comparator *does* is labelled `[HYPOTHESIS]` and is the grader's to settle.**

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
DERIVED (spec)     reverse := (observed ordinal sequence == reverse(canonical population order))
                              ^ recomputed by the verifier from the manifest, every time
```

A forged copy carries the FORWARD ordinal sequence while asserting `reverse=true`. **The two disagree,
and the disagreement is arithmetic, not trust.** ⇒ 🛑 **`R-826 §8[3]` FORBIDS `provenance_verified=true`
and this spec generalises that: NO field in the chain may be believed because it was written down.
Every provenance property is RECOMPUTED FROM LOWER-LAYER BYTES OR IT DOES NOT EXIST.**

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

Per `R-826 §8[2]`, each child persists `receipts/<ordinal>-<target-slug>.json`:

| field | meaning | why it is load-bearing |
|---|---|---|
| `run_id` | the child's own minted UUID | joins child ↔ record; already minted and already checked |
| `target` | exact governed file path | the child's identity |
| `ordinal` | **1-based EXECUTION position within this arm** | ⭐ **the field that makes order forgery-evident** |
| `head` | **the commit THIS CHILD measured** | catches a tree that moved mid-arm |
| `returncode` | child process exit code | validity |
| `outcomes` | exact node-ID → outcome membership | the payload |
| `n_collected` | collected count | reconciles against `outcomes` |
| `json_sha256` | digest of the child's result JSON **bytes** | binds the artifact, not its summary |
| `junit_sha256` | digest of the child's JUnit XML **bytes** | second, independent artifact path |
| `layer2_witness` | the Layer-2 eviction witness | proves the boundary ran |
| `validity` | `VALID` \| `REFUSED:<exact reason>` | no partial scoring |

🛑 **`json_sha256`/`junit_sha256` are digests of BYTES ON DISK, taken before the artifact can be
re-read.** A digest recomputed from an in-memory object the producer already trusts proves nothing.

### 3.2 — LAYER 2: the ordered parent manifest

`manifest.json`, written **after all children, before the aggregate**:

```jsonc
{
  "arm_start_head":  "<SHA at arm launch>",
  "arm_end_head":    "<SHA at arm completion>",
  "population_digest": "<sha256 over the canonical ordered child list from population_successor>",
  "entries": [                       // ORDER IS THE EVIDENCE - never sorted, never a set
    {"ordinal": 1, "target": "<path>", "receipt_sha256": "<digest of the LAYER-1 file's bytes>"},
    …
  ]
}
```

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
6. **DERIVE** `reverse` from the ordinal sequence against the canonical population order; compare to
   the aggregate's claim.
7. Assert `ordinal` values are exactly `1..N`, no gaps, no duplicates.

Then **across** the two arms: assert both `population_digest`s are equal, both `head`s are equal, and
the two arms' `run_id` sets are **disjoint** — 🛑 **an arm compared against itself is not two pieces of
evidence, and disjoint run IDs is the cheapest test that they are two runs at all.**

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

---

## §5 — SCOPE, AND WHAT THIS SPEC DOES NOT COVER (honest-partial, `R-826 §8[6]`)

**COVERED:** the evidence format and the verification obligations for the `RATIFY-1` `[G]`/`[H]`/`[I]`
comparison surface — child receipt, ordered manifest, derived aggregate, comparator duties, seven
controls.

**NOT COVERED, AND NAMED RATHER THAN IMPLIED:**
- **The grader's question is untouched.** Whether today's comparator *actually* consults the summary
  fields only is `[HYPOTHESIS — THE GRADER'S]`. **This spec says what the chain must become; it does
  not diagnose the current one, and it is deliberately valid in BOTH branches of the grade.**
- **No migration or back-fill path** for the three existing `PRE-GRADE / WORKER-MEASURED` maps. Per
  `R-826 §5` they are historical evidence and are **not** to be canonised; re-deriving a chain over
  them retroactively would manufacture provenance that did not exist at run time. 🛑 **A chain minted
  after the fact is a claim about the past, not a receipt from it.**
- **No cost measurement.** `108` extra receipt writes + digest computation land inside `[H]`'s
  **`7.2%`** headroom against a **FROZEN** `10.0`-minute ceiling (`R-826 §6`, `ACCEPT5-RUNTIME-HEADROOM-1`).
  ⚠️ **`[UNMEASURED — OPEN]` I have not measured the added wall-clock, and the ceiling may not be
  raised to accommodate it** (`[pre-register-criteria]`: raising a just-passed ceiling is a goalpost
  with a citation). **This is a real risk to `§8[4]`'s conditional microrepair and the desk should
  see it before that lane opens, not after.**
- **Nothing about the `287`/`11`/`7` populations** — `STOP [44]`/`STOP [37]`, and they are
  `ACCEPT5-ISOLATED-FAILURE-DISPOSITION-1`'s, not this spec's.
- **No authority over `acceptance_runner.py` promotion**, which stays `NOT AUTHORIZED` (`R-826 §8[5]`).

---

## §6 — IMPLEMENTATION IS NOT AUTHORIZED BY THIS DOCUMENT

Per `R-826 §8[4]`, implementing this chain is **CONDITIONAL** on the grader confirming
`ACCEPT5-AGGREGATE-PROVENANCE-1`, and then only in a **DISPOSABLE worktree pinned at an explicit
commit** (`STOP [35]`), scoped to `RATIFY` instrumentation, with all controls red-proofed before
`[G]`/`[H]`/`[I]` are re-run and re-graded.

🛑 **If the grader does NOT confirm the defect, this spec stays a design document and the instrument
stays frozen until the desk rules otherwise.** ⚡ **Either way `§1`'s measurement stands on its own and
is the desk's to adopt: the aggregate carries no provenance at all, and the one `sha256` in it is the
name of a test.**
