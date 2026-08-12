# GRADE — RATIFY-1 [G]/[I] COMPARATOR, ROUND 4 (FINAL)

    GRADE TARGET       : 1155e2705a1299df6e0ea035eae3b9595e75bbb9
                         "Verifier-only: raw child artifact becomes the authority;
                          node-sequence anchored"
                         scripts/ratify1_controls/g_order_identity.py  (1693 lines)

    EXECUTION EVIDENCE : f4e9a9d2711d9bf132efcc4fcb1546da4fcaa060
                         — a SEPARATE commit. The five arms A'-E' were minted HERE,
                         in C:\Users\tonio\Projects\wt-cert5b-f4e9a9d2\cert-arms-new.
                         THE ARMS DID NOT RUN ON 1155e270. The verifier is downstream
                         of the evidence and only READS it. Neither pin is on origin.

    GRADER TREE        : C:\Users\tonio\Projects\wt-h1-wave4-20260712 (verifier tree)
    WORKBENCH          : %TEMP%\claude\...\scratchpad\forged\  — every tamper is on a
                         COPY. cert-arms-new was never modified.
    DATE               : 2026-08-12

    ⚖️  LINEAGE DECLARED — INDEPENDENCE IS STRUCTURAL, NOT A MATTER OF INTENT.
        I graded this instrument's lineage three times before: R1 (`4032d954`/
        `c5da1d4f`), R2 (`fb71a3ef`) and R3 (`e9eeb845`@`7090da86`). The repairs at
        `1155e270` are repairs to MY OWN R3 findings (the receipt-summary root and the
        unread `node_sequence_sha256` anchor are both mine). Every band below is
        re-derived from the artifacts in front of me at these two pins ONLY. Prior
        scores were not consulted as evidence.

---

## VERDICT

| System | Band | Status | Evidence | Open risks |
|---|---|---|---|---|
| `g_order_identity.py` @ `1155e270` | **6** | **VERIFIED** | 10/10 pairings re-run unpiped; substance corroborated by TWO paths that never import the verifier; 12 adversarial tampers on resealed copies with an R0 no-op control | **1 CRITICAL + 2 HIGH + 2 MEDIUM + 1 LOW false-green routes remain live** |

**BOUNDED PASS.** The instrument's *conclusion* is true and I corroborated it
independently. The instrument's *authority* is not what its docstrings claim: seven
distinct forgeries certify at exit 0 with a complete evidence contract.

Band 6 and not 5: five separately-measured proofs that did not exist in R3 now exist
and genuinely go RED (§FINDINGS/HELD). Band 6 and not 7: 7 requires *residual risks
documented*, and a route that rewrites test outcomes wholesale is not a documented
residual — the file's own docstring at line 349 asserts that class closed.

**Claim dispositions** (verbatim claims in §PASS / §FINDINGS):

| Claim | Disposition |
|---|---|
| C1 all ten pairings certify | **CONFIRMED** (with one correction, below) |
| C2 REQUIRED == OBSERVED, absent proof = refusal | **CONFIRMED** |
| C3 `--no-chain` can never certify | **CONFIRMED** |
| C4 raw `acceptance-run.json` is *the authority* | **REFUTED** (F-R4-1) |
| C5 `node_sequence_sha256` recomputed and enforced | **CONFIRMED** |
| C6 order evidence cannot be vacuously satisfied | **PARTLY REFUTED** (F-R4-2) |
| C7 a downward timing forgery refuses | **REFUTED** (F-R4-3) |
| C8 full population, five independent executions | **CONFIRMED on population / REFUTED on independence** (F-R4-4) |

---

## ATTACKS PERFORMED

Every command below was run from `C:\Users\tonio\Projects\wt-h1-wave4-20260712`.
`$G` = `scripts\ratify1_controls\g_order_identity.py`, `$P` =
`f4e9a9d2711d9bf132efcc4fcb1546da4fcaa060`, `$A` =
`C:/Users/tonio/Projects/wt-cert5b-f4e9a9d2/cert-arms-new`, `$F` = my forged workbench.
**Exit codes were measured UNPIPED**; the grep summaries ran afterwards against a
file, never in a pipe with the instrument.

### R0 — the harness control that makes every RED below attributable

My tamper tool reseals the entire digest chain bottom-up (child bytes →
`receipt.artifact_sha256` → `manifest.entries[].receipt_sha256` →
`entries[].node_sequence_sha256` → `aggregate.manifest_sha256`), so the verifier is
handed a *perfectly sealed* forgery and must catch the SEMANTIC defect.

    python forge.py none A A0 ; python forge.py none E E0
    python $G --forward $F/A0/aggregate.json --reverse $F/E0/aggregate.json \
              --mode repeat --pin $P --node-axis same
    -> EXIT 0, 0 FAIL verdicts, "[I] SATISFIED"

`[MEASURED HERE]` A reseal with no semantic change stays GREEN. Without this, every
RED below would be mis-attributed to my reseal rather than to the attack. (This is the
harness law my R3 grade minted; it is applied to myself here.)

### Surface 1 — `--no-chain` and every flag combination

Eight invocations, exit codes unpiped:

| invocation | exit | outcome |
|---|---|---|
| `--pin $P --node-axis same --no-chain` | 1 | `ACCEPTANCE INSTRUMENT REFUSED` |
| `--node-axis same --no-chain` (no pin) | 1 | `DIAGNOSTIC RUN — NOT A CERTIFICATION` |
| `--no-chain` alone | 1 | `DIAGNOSTIC RUN` |
| `--pin $P` (no `--node-axis`) | 1 | `REFUSED` |
| `--pin "" --node-axis same --no-chain` | 1 | `DIAGNOSTIC RUN` |
| `--pin ""` (falsy — bypasses BOTH fail-closed guards) | 1 | `REFUSED — INCOMPLETE CERTIFICATION EVIDENCE` |
| `--pin 1155e270…` (real commit, wrong one) | 1 | `NOT SATISFIED` |
| no `--pin`, chain ON, axis given | 1 | `NOT SATISFIED` |

**HELD, and one row deserves naming.** `--pin ""` is *falsy*, so it slips past both
`if args.pin and args.node_axis is None` (line 1655) and `if args.pin and
args.no_chain` (line 1673) — the two hand-written fail-closed guards. It is caught
anyway, by the completeness property: with `node_axis=None` the `PAIR/GNODE_*` proofs
are never emitted, `completeness()` reports them MISSING, and the run refuses. `[MEASURED
HERE]` **This is the evidence contract catching a hole in its own guard clauses — the
strongest single result in this grade.**

### Surface 2 — REQUIRED_PROOFS completeness

Required set: 73 proofs (`same` axis) / 74 (`reverse` axis) = 9 pair + 32 per-arm × 2
(+1 anti-vacuity). Observed == required in all ten certifying runs.

I enumerated every load-bearing fact against the frozen set. Facts with **NO** required
proof ID, measured by reader-count in the verifier source:

| fact | readers in `g_order_identity.py` | consequence |
|---|---|---|
| `acceptance-run.xml` (pytest's own JUnit output) | **1** — a `glob` in the C2 tamper fixture; **never parsed** | F-R4-1 (CRITICAL) |
| `manifest.population_digest` | **0** | F-R4-5 (MEDIUM) |
| raw `n_collected` / `n_passed` / `n_failures` … | **0** | F-R4-6 (MEDIUM) |
| bucket mutual-disjointness (runner enforces at mint) | **0** | F-R4-6 |
| `aggregate.layer2` / `ownership_blind` / `run_root` | **0** each | unproven, not load-bearing for these claims |
| `receipt.elapsed_s` | 5 — but anchored to no raw artifact | F-R4-3 |

Positive control for those zero-counts: the same grep method returns **2** for
`MANIFEST_DIGEST_RECOMPUTES`, so it finds a binding proof when one exists.

### Surface 3 — removal of an entire evidence layer

    python drop2.py node-sequence.json A And ; ... E End      # deleted + unbound + resealed
    -> EXIT 1, 10 FAIL verdicts
       "every child's RAW acceptance-run + node-sequence PARSE  108 unusable"

    python forge.py dropxml A Ax ; python forge.py dropxml E Ex   # same treatment, XML layer
    -> EXIT 0, 0 FAIL, "[I] SATISFIED"

`[MEASURED HERE]` **Landing verified from disk: 0 `acceptance-run.xml` remaining in
either arm, 108 `acceptance-run.json` remaining.** Deleting a layer the verifier
*parses* is caught by ten verdicts; deleting the layer it never parses is invisible.
The discriminating property is "is it read", not "is it removable" — the digest
binding is not protection when the label is removed with the file.

### Surface 4 — raw ↔ receipt contradiction, BOTH directions

    forge.py receiptonly A Aro    (edit the RECEIPT only, reseal)  -> EXIT 1
        FAIL forward: receipt claims AGREE with the raw artifact … 1 disagreement
             ['…: node->outcome map']  <- a RESEALED receipt contradicting its artifact
    forge.py rawonly A Arw        (edit the RAW only, reseal)      -> EXIT 1, 3 FAILs

**HELD in both directions.** `VERIFIED/RECEIPT_MATCHES_RAW` is real and discriminates.

### Surface 5 — raw node-sequence vs receipt

Covered by the `rawonly`/`emptyseq` arms: `VERIFIED/NODE_SEQUENCE_MATCHES_RAW` and
`VERIFIED/NODE_SEQUENCE_ACCOUNTS` both fire. **HELD.**

### Surface 6 — `node_sequence_sha256` reseal

    forge.py seqdigest A Asd   (reverse the raw sequence, reseal everything
                                EXCEPT restore the stale anchor)  -> EXIT 1
        FAIL forward: manifest node_sequence_sha256 RECOMPUTES … 1 mismatched

**HELD.** C5 confirmed: the anchor my R3 grade found *written but never read* is now
read and enforced. Bound: it binds the receipt to the raw bytes; it cannot bind the
raw bytes to reality (see F-R4-2).

### Surface 7 — order-witness vacuity

    forge.py emptyseq A Aes    (empty ONE child's raw sequence, reseal) -> EXIT 1
        FAIL forward: every executed node appears EXACTLY ONCE in the order witness
             1 child(ren) … ['…test_a_plus_gate_parity.py (seq=0 outcomes=38)']
        FAIL [G-NODE] intra-file order is SAME … 1 violating

**HELD against emptying.** Coverage is genuine: all ten runs report "108 expected, 108
witnessed, 0 MISSING". Does NOT hold against joint fabrication — F-R4-2.

### Surface 8 — duplicate / execution-identity / population reseals

    forge.py relabel A Ar    (byte clone of A, all 108 run_ids replaced) -> EXIT 0 GREEN
    forge.py double_bucket A Ad ; E Ed  (node in BOTH passed and failures) -> EXIT 0 GREEN
    forge.py Asub            (unbound file inside a SUBDIRECTORY of a child) -> EXIT 0 GREEN
                             printing "NO UNBOUND FILE … 0 unbound"

Three false greens. See F-R4-4, F-R4-6, F-R4-7.

### Surface 9 — downward timing forgery

    forge.py timing A At 0.1 ; forge.py timing E Et 0.1
      (×0.1 applied to ALL THREE timing layers: manifest.timing.wall_s,
       aggregate.wall_s, and every receipt.elapsed_s; then full reseal)
    python $G --forward $F/At/aggregate.json --reverse $F/Et/aggregate.json \
              --mode repeat --pin $P --node-axis same
    -> EXIT 0, 0 FAIL, "[I] SATISFIED"
       OK forward: [H] runtime <= 10.0 min, from the OWNER's clock
                   0.63 min (runner=37.90s receipt-derived=37.88s ceiling=600s)

A 379 s arm certified as 37.9 s. See F-R4-3.

### Surface 10 — pin binding and execution independence

`PAIR/PIN_BOUND` holds: a real-but-wrong pin (`1155e270`) and an absent pin both fail.
All 108 child `head_sha` values in every arm are `f4e9a9d2…` — verified by my own
manifest/receipt walk, not by the verifier. Execution independence is **refuted** as a
*proof* (F-R4-4) although **true in fact** for the genuine arms (my own measurement:
5 × 106 = 530 run_ids, 530 distinct, 0 shared in 10 of 10 pairings).

### Surface 11 — NOVEL (see §NOVEL ATTACK)

---

## PASS — what I independently corroborated, and through which non-overlapping paths

I did **not** establish any ground truth by importing the verifier under grade. My
reconstruction (`scratchpad/indep.py`) is stdlib-only and touches neither
`g_order_identity.py` nor `accept5_isolated_runner.py`.

**C1 — "All ten unique A'-E' pairings certify: 0 exact node→outcome differences, 0
missing required proofs, and NO failing verdicts."** — **CONFIRMED, three paths.**

* *Path A — the instrument itself.* Ten unpiped runs; ten exit 0; ten `SATISFIED`
  headlines; 0 `FAIL` verdicts; `required 73 == observed 73` (or 74/74 on the reverse
  axis), `MISSING 0`, every run.
* *Path B — my own diff over the runner's plugin records.* I rebuilt each arm's
  node→outcome map by reading all 106 scoring `acceptance-run.json` files myself and
  diffed all ten pairings: **0 differing nodes in 10 of 10.**
* *Path C — my own diff over pytest's JUnit XML.* Same ten pairings rebuilt from
  `acceptance-run.xml` document contents, a wholly different artifact written by a
  different code path: **0 differing nodes in 10 of 10.**

  Path C also self-validates: XML-derived and JSON-derived maps agree exactly in all
  five arms — `only-in-json=0, only-in-xml=0, outcome-disagreements=0` — so my XML
  parser is not silently mis-mapping node IDs.

  ⚠️ **ONE CORRECTION TO C1's WORDING.** A "pairing" does not determine its own
  invocation. `B'–D'` share a file direction (both `reverse=True`) but differ on the
  node axis (`B'.reverse_nodes=False`, `D'.reverse_nodes=True`), so it certifies under
  `--mode repeat --node-axis reverse`. I first ran it with `--node-axis same` and the
  instrument **correctly refused**: exit 1, `[G-NODE] intra-file order is SAME … 104
  violating` plus `arms' declared node axis matches the request … FAIL`. `[MEASURED
  HERE]` That is a live discrimination witness, not a defect — but C1 is only true for
  the *axis each pairing's arms imply*, and it does not say so.

**C8 — population.** **CONFIRMED on substance, by my own walk.** Every arm: 108
manifest children (106 scoring + 2 `empty_by_design` harness files), **2419 nodes**,
outcome histogram identical across all five arms (`2384 passed / 33 failed / 2
xfailed`), child exit statuses identical (`97×0, 9×1`), `arm_start_head ==
arm_end_head == f4e9a9d2…`, file axis `A/C/E` sorted and `B/D` exactly reversed, node
axis `A/B` canonical and `C/D` reversed with 104 of 106 children multi-node. The
required-population authority independently recomputes to **2419** nodes with an
empty `problems` list.

**C2, C3, C5** — confirmed by direct adversarial execution above.

**Positive controls for every absence claim I make here:**

| absence claimed | positive control that proves the method fires |
|---|---|
| "the XML is never parsed" | the same reader-count method returns 1 for the C2 fixture glob and 5 for `elapsed_s`; and the *behavioural* control — deleting the parsed layer (`node-sequence.json`) reds with 10 verdicts while deleting the XML certifies |
| "`population_digest` has no reader" | `MANIFEST_DIGEST_RECOMPUTES` returns 2 under the identical grep |
| "no flag combination certifies" | the enumeration includes two combinations that DO run to a verdict (`NOT SATISFIED`), so the method distinguishes refuse / diagnostic / fail / certify |
| "the verifier does not re-check raw self-consistency" | the runner's own source *does* (lines 366-373), so the check is a real thing that can be found when present |
| "0 shared run_ids" | the same comparator reports `shared=108` when I feed it a self-comparison |

**Join keys checked for every "identical / unchanged / matches" claim:** exact pytest
node ID (`file::Class::test`) for every outcome comparison; `manifest.entries[].target`
for child identity; `entries[].ordinal` for sequence position; `run_id` for execution
identity; `head_sha` per child for pin identity; sha256 over file bytes for every
digest claim.

---

## FINDINGS

### F-R4-1 — CRITICAL — the authority chain terminates one layer above the measurement

**Claim attacked:** C4, verbatim — *"The digest-bound RAW acceptance-run.json is the
authority for run_id, exit status, collected and the exact node→outcome map."*

**Reality:** `acceptance-run.json` is not primary evidence. It is a **summary the
runner's own pytest plugin writes** (`instrument: "acceptance_pytest_plugin"`). Sitting
beside it in the same digest-bound child directory is `acceptance-run.xml` — pytest's
own JUnit output, which independently carries the node→outcome map, the executed
document order, per-test durations and a wall-clock timestamp. The verifier requires it
to be PRESENT and INTACT and **never parses a byte of it**.

This is the R3 defect displaced by exactly one layer. R3's root was "the rebuild stops
at the receipt's own summary". `1155e270` moved the stop to the plugin's own summary.
The genuinely independent witness is still unread.

**Repro (both arms, so the oracle cannot catch it):**

    python forge.py flip A Af 1 ; python forge.py flip E Ef 1
    python $G --forward $F/Af/aggregate.json --reverse $F/Ef/aggregate.json \
              --mode repeat --pin $P --node-axis same
    -> EXIT 0 · 0 FAIL · required 73 observed 73 MISSING 0 · "[I] SATISFIED"

`[MEASURED HERE]` The forgery relabels
`src/engine/tests/test_a_plus_gate_parity.py::TestAPlus_Gate_Wiring::test_empty_factors_list_bypasses_gate`
from `failed` to `passed` in the raw record, the receipt and the aggregate, and reseals.
Landing verified from disk: the raw record has it in `passed`, and
`acceptance-run.xml` in the very same directory **still carries 18 `<failure>`
elements**. Every one of these printed OK:
`receipt claims AGREE with the raw artifact … 0 disagreement(s)`,
`outcomes REBUILD from the receipts rebuilt=2419`,
`node_sequence_sha256 RECOMPUTES … 0 mismatched`.

**Sharpest form** — you may delete the entire XML layer instead:

    python forge.py dropxml A Ax ; python forge.py dropxml E Ex
    -> EXIT 0 · 0 FAIL · "[I] SATISFIED"      (0 XML files left in either arm)

**That the XML is a *sufficient* witness is measured, not assumed:** its derived
node→outcome map matches the plugin's exactly in all 5 arms (0 disagreements, 0
side-only, 2419 nodes each), and its **document order equals `node-sequence.json` for
106 of 106 children in every arm I checked (A, C, E)**.

**Fix point:** `scripts/ratify1_controls/g_order_identity.py:346` `_raw_child_facts()`
— parse `cd/"acceptance-run.xml"` and require the XML-derived node→outcome map, the
XML document order and the XML testcase set to agree with the plugin record. Add proof
IDs `CHAIN/JUNIT_PARSES` and `VERIFIED/RAW_MATCHES_JUNIT` to `_PER_ARM_REQUIRED`.

**Blast radius:** every RATIFY-1 `[G]`/`[I]` certification, and any downstream ruling
that reads "0 exact node→outcome differences" as evidence about what pytest observed.

### F-R4-2 — HIGH — the node-order axis is self-declared and jointly forgeable

**Claim attacked:** C6 — *"every multi-node child must genuinely reverse under a
reverse axis."*

**Repro:**

    python forge.py order E Eo        # reverse EVERY raw node_sequence in arm E,
                                      # set reverse_nodes=True, full reseal
    python $G --forward $F/A0/aggregate.json --reverse $F/Eo/aggregate.json \
              --mode repeat --pin $P --node-axis reverse
    -> EXIT 0 · 0 FAIL · required 74 observed 74 · "[I] SATISFIED"
       OK [G-NODE] EVERY multi-node child genuinely reversed
          104 eligible (>=2 nodes), 0 failing [], 4 legitimate 0/1-node no-ops
       OK [G-NODE] arms' declared node axis matches the request
          fwd.reverse_nodes=False rev.reverse_nodes=True

`[MEASURED HERE]` Arm E ran in **canonical** node order. Landing verified from disk:
`Eo`'s sequence is the exact reverse of pristine E's. The instrument certified a
node-order reversal that never happened, with 104 named witnesses. Every anti-vacuity
guard passed because nothing that could contradict the fabrication was read — the
XML document order in `Eo` still shows canonical order.

The anti-vacuity work is real (emptying a sequence reds; coverage is per-child, all
108). The gap is different: the witness is *inside the resealable chain*, so it proves
self-consistency, never occurrence.

**Fix point:** same as F-R4-1 — derive the order witness from the XML, or require it
to agree with the XML.

### F-R4-3 — HIGH — a downward timing forgery certifies

**Claim attacked:** C7, verbatim — *"[H] runtime is owned by the runner's LIVE
MONOTONIC clock, refused at source above 600 s, and carried as a witness inside the
digest-bound manifest. **A downward timing forgery refuses.**"*

**The first three clauses are TRUE and verified.** The fourth is **FALSE.**

**Repro:**

    python forge.py timing A At 0.1 ; python forge.py timing E Et 0.1
    python $G --forward $F/At/aggregate.json --reverse $F/Et/aggregate.json \
              --mode repeat --pin $P --node-axis same
    -> EXIT 0 · 0 FAIL · "[I] SATISFIED"
       OK forward: [5] [H] declared wall_s RECONCILES with receipt-derived elapsed
                   declared=37.90s derived=37.88s delta=+0.02s slack=1.08s
       OK forward: [H] the RUNNER minted a monotonic timing witness that passed at source
                   clock='time.monotonic' wall_s=37.904 ceiling_s=600.0 within=True
       OK forward: [H] runtime <= 10.0 min, from the OWNER's clock  0.63 min

**Mechanism.** `H_RECONCILES` is a *relative* check — `wall_s >= Σ elapsed_s − slack` —
and `H_CEILING` uses `max(runner_wall, Σ elapsed_s)`. All three inputs
(`manifest.timing.wall_s`, `aggregate.wall_s`, every `receipt.elapsed_s`) live inside
the resealable chain. Scale all three by the same factor and the reconciliation still
holds, at any magnitude. `[MEASURED HERE]` the raw `acceptance-run.json` schema
contains **no duration field at all** — I enumerated its 22 keys — so there is nothing
outside the chain to anchor against. The docstring's own law
(*"A CEILING CHECK THAT READS A NUMBER THE ARM WROTE ABOUT ITSELF CAN ONLY CATCH A
LIAR WHO LIED UPWARD"*) still applies verbatim: the repair moved *which* number the arm
wrote, not the fact that the arm wrote all of them.

**The unforged witness exists and is unread:** `acceptance-run.xml`'s
`<testsuite time=…>` for the pnl child reads `6.058 / 5.519 / 6.070` s in arms A/C/E,
and `timestamp=` carries the wall-clock start of every child — enough to bound the
parent's true interval independently.

**Fix point:** `g_order_identity.py:766-810` — anchor `d_elapsed` to Σ of the XML
`testsuite/@time`, and bound the arm interval by the XML `@timestamp` spread.

### F-R4-4 — HIGH — "two DISTINCT EXECUTIONS" is proved by a relabellable string

**Claim attacked:** C8's final clause — *"run_ids establishing five independent
executions."*

**Repro:**

    python forge.py relabel A Ar      # byte clone of arm A; all 108 run_ids replaced
                                      # with fresh uuid4s in raw + receipt; full reseal
    python $G --forward $F/A0/aggregate.json --reverse $F/Ar/aggregate.json \
              --mode repeat --pin $P --node-axis same
    -> EXIT 0 · 0 FAIL · "[I] SATISFIED"
       OK arms are two DISTINCT EXECUTIONS (run_ids disjoint)  fwd=108 rev=108 shared=0

`[MEASURED HERE]` `A0` and `Ar` are the same clone of arm A. Nothing else differs.
The comparator's own docstring at line 1019 says *"TWO FILES IN TWO DIRECTORIES ARE NOT
TWO PIECES OF EVIDENCE"* and then proves distinctness with a uuid that sits in the same
tamperable layer as everything else. `Ar`'s 108 JUnit XMLs carry **byte-identical
`timestamp=` attributes to A0's** — an independent discriminator, unread.

**This does not impugn the genuine arms.** By my own measurement the five real arms hold
530 run_ids, 530 distinct, 0 shared in all 10 pairings, and their XML timestamps span
four distinct execution windows plus a fifth. The *fact* is true; the *proof* is not.

**Fix point:** `g_order_identity.py:1025-1030` — add the XML `@timestamp` spread to
`PAIR/DISTINCT_EXECUTIONS`, so distinctness rests on a clock rather than a label.

### F-R4-5 — MEDIUM — the node-population authority is not pin-bound, and the anchor that would bind it has zero readers

`authority_nodes()` (line 289) calls `population_successor.required_population(REPO)`,
where `REPO` is the **verifier worktree**, and that function reads the seal, the
successor chain and the manifest as **plain working-tree files**. `[MEASURED HERE]` the
verifier's only git calls are `cat-file -t` (does a SHA name a commit) and `rev-parse
HEAD` inside the red-proof. Nothing binds the authority bytes to `f4e9a9d2`.

Demonstrated on a scratch copy (the shared tree was **not** modified): copying the three
authority files to a temp dir and deleting one node from the copied seal changes the
derived population from 2419 to 2391. So the authority is a function of mutable
working-tree bytes.

**Materially, today, it is correct**: `git diff f4e9a9d2 1155e270 --
src/engine/tests/canonical_regression_population.txt docs/replay-results/h1-battery/`
is EMPTY, and `git status --porcelain` on those exact paths shows no modified tracked
file. So "2419 required" is right — by a clean tree, not by construction.

**The binding artifact already exists and is unread.** The runner writes
`manifest.population_digest` (`accept5_isolated_runner.py:530`) into the digest-bound
manifest. Reader count in the verifier: **0**. This is the same shape as the
`node_sequence_sha256` finding my R3 grade raised — *written, sealed, never read* —
recurring on a different field. Note it digests the sorted child **file** list, not the
node IDs, so it does not by itself bind the 2419; a node-population digest is also owed.

**Fix point:** add `CHAIN/POPULATION_DIGEST` to `_PER_ARM_REQUIRED`, recomputing over
the manifest's child set; and have `authority_nodes()` read the three authority files
via `git show <pin>:<path>` rather than from the worktree.

### F-R4-6 — MEDIUM — the verifier does not re-run the runner's mint-time validation of the raw record

The runner refuses a record whose outcome buckets are not mutually disjoint
(`accept5_isolated_runner.py:352-360`), whose declared totals disagree with the rebuild
(`:366`), or whose `n_collected` disagrees with `len(collected)` (`:370`). The verifier
re-reads the same record and checks **none** of those (`n_collected`, `n_passed`,
… reader count in the verifier: **0**).

**Repro:**

    python forge.py double_bucket A Ad ; python forge.py double_bucket E Ed
      # one node listed in BOTH `passed` and `failures` in the raw record
    -> EXIT 0 · 0 FAIL · "[I] SATISFIED"

`[MEASURED HERE]` `_raw_child_facts` iterates `BUCKETS` in dict order and lets the last
write win, so a record that *cannot say what happened to a node* silently yields one
answer. The claim "the exact node→outcome map" is not well-defined for such a record,
and the instrument that calls it the authority does not enforce the property that makes
it one.

**Fix point:** `g_order_identity.py:388-396` — port the runner's disjointness and
totals reconciliation into `_raw_child_facts`, under a new required proof ID.

### F-R4-7 — LOW — `NO UNBOUND FILE` is non-recursive and its caption is false

`verify_chain` line 562: `present = {p.name for p in cd.iterdir() if p.is_file()}`.
A file inside a subdirectory of a child directory is neither hashed nor reported.

**Repro:** plant `<child>/hidden/stash.txt`, reseal →
`EXIT 0 · OK forward: NO UNBOUND FILE in any child directory  0 unbound []`.

The verdict text says "in any child directory" and means "at the top level of one".
Per the desk's caption law, fix the emitter (recurse with `rglob`), not the wording.

### HELD — what I could not break

`[MEASURED HERE]`, each with a landing check read back from disk and an R0 no-op
control proving my harness does not itself cause reds:

1. Every `--no-chain` / flag combination, including the falsy-`--pin` bypass of both
   hand-written guards (caught by the completeness property).
2. Receipt-contradicts-raw, both directions.
3. `node_sequence_sha256` staleness.
4. Order-witness emptying (per-child, with named child and node counts).
5. Removal of a parsed evidence layer (10 verdicts fire).
6. Arm-relationship and node-axis mis-declaration (my own B'–D' mis-spec, refused with
   104 named violating children — never sliced).
7. Wrong-but-real pin, and absent pin.
8. Population coverage: 108 expected / 108 witnessed / 0 missing in all ten runs.

---

## NOVEL ATTACK

**Name: THE UNREAD NEIGHBOUR — verify the summary, ignore the primary.**

Not in the mandated list, and not one of the worker's controls C1–C13 or K–O.

**Construction.** The repair at `1155e270` is a *layer promotion*: the authority moved
from the receipt to the raw plugin record. I asked the promotion's own question one
level further down — *what wrote the thing that is now the authority, and is its output
still here?* — and enumerated every file in a child directory rather than every field
in the artifact. Three files: `acceptance-run.json` (plugin summary),
`node-sequence.json` (plugin summary), `acceptance-run.xml` (**pytest's own output**).
The verifier hashes all three and parses two.

**Why it is not the worker's control.** C2 tampers `acceptance-run.xml` *without*
resealing, so the digest catches it and the control passes for a reason that has nothing
to do with the file's content. `[MEASURED HERE]` That control would pass identically if
the XML contained the word "banana" — it proves the byte-binding, never the semantics.
The attack is to reseal correctly and let the *content* diverge.

**Why it is one root, not four findings.** The XML independently carries **outcome,
order, duration and start-time**. Every remaining false-green route (F-R4-1, -2, -3, -4)
is caught by parsing it and by nothing else currently in the instrument. The single
strongest demonstration — *delete pytest's entire output from all 216 child directories
across both arms, unbind it, reseal, and certify at exit 0* — is one command.

**Generalised law, offered for the desk's law index:**

    A CHAIN THAT PROMOTES ITS AUTHORITY ONE LAYER DOWN MUST ASK WHAT WROTE THE NEW
    AUTHORITY. IF THE WRITER'S OWN OUTPUT IS STILL ON DISK AND STILL UNREAD, THE
    PROMOTION MOVED THE DEFECT, IT DID NOT CLOSE IT.

    COROLLARY: A CONTROL THAT TAMPERS AN ARTIFACT WITHOUT RESEALING TESTS THE DIGEST,
    NOT THE ARTIFACT — AND WILL PASS FOREVER OVER A FILE NOBODY PARSES.

---

## LIMITATIONS — what I did NOT verify, and why

1. **I did not re-execute the arms.** Re-minting A'-E' costs ~6 min each at
   `f4e9a9d2` and the brief pins them as fixed evidence. Everything I say about *what
   happened during those runs* is artifact-sourced, not observed. Consequence: if all
   five arms were fabricated together at mint time, nothing in this grade would detect
   it — the XML corroboration proves internal consistency across two independent
   writers, not that pytest ran.
2. **I did not run the worker's own `--red-proof` or `--red-proof-chain` suites.**
   Deliberate on two grounds: the brief forbids replaying the worker's controls as
   satisfaction of this grade, and `--red-proof` **writes into the shared verifier
   tree** (`scripts/_c13_surface_probe.tmp`, and it rewrites
   `docs/wave25-exit-engine-ab-report.md`, which I found already `M` in `git status`).
   I therefore have **no independent evidence about C1–C13's or K–O's current status**;
   my findings are additive to them, not a re-grade of them.
3. **I did not audit `accept5_isolated_runner.py` as a target.** The comparator imports
   four authorities from it — `_slug`, `BUCKETS` (read as source text via regex),
   `CEILING_S`, `_REQUIRED_BY_FILE`. All four are read from the **verifier worktree**,
   so a modified runner there would move the comparator's authorities under it. Not
   tested. Related and untested: the `BUCKETS` regex
   `^\s*BUCKETS\s*=\s*(\{.*?\})\s*$` is non-greedy and would mis-read a reformatted or
   nested literal.
4. **I did not audit `population_successor.py`'s chain logic.** I confirmed only that it
   reads working-tree bytes, that it reconciles today with `problems=[]`, and that it
   derives 2419.
5. **I did not adjudicate the 33 stable failures** — explicitly out of scope and ruled
   untouchable. I record only that all five arms carry exactly 33, identically.
6. **I did not test concurrency, locking, or partial-write states** of the arms, nor
   Unicode/CRLF handling of node IDs beyond what the corpus contains.
7. **Bounds, not points.** "7 false-green routes" is a lower bound on what exists — it
   is the count I constructed in this session, over the surfaces I enumerated. The
   surface I did *not* enumerate is the runner (limitation 3). "0 differing nodes ×10"
   is exact for these artifacts; it says nothing about arms not yet minted.
8. **Windows/CRLF caveat**: all digest comparisons here were byte-level via
   `hashlib.sha256(Path(...).read_bytes())`; no text-mode reads were used for any
   claim about equality.

---

## VERDICT

**BOUNDED PASS at band 6.** The certification the instrument issued for A'-E' is
**substantively correct** — I confirmed its central factual content through two paths
that never touch the code under grade, and one of those paths (pytest's JUnit XML) is
the very artifact the instrument fails to consult. The evidence contract, the
fail-closed flag surface and five newly-added raw-anchored proofs are real and were
demonstrated to discriminate.

But the claims about *why* it is trustworthy do not survive. C4, C6, C7 and C8's
independence clause are refuted by reproducible forgeries that certify at exit 0 with a
complete evidence contract, and they share a single root: **the instrument requires
pytest's own output to be present and intact, and never reads it.**

Do not treat a `SATISFIED` headline from `1155e270` as evidence about what pytest
observed until `VERIFIED/RAW_MATCHES_JUNIT` exists.

---
*Grader: accuracy-validator. Doer ≠ grader; lineage declared in the header — this is
round 4 on this instrument and it repairs findings I raised in round 3.*
