# GRADE — RATIFY-1 FINAL CERTIFICATION EVIDENCE (AR-1003)

**Grader:** `accuracy-validator`, dispatched adversarially to DISPROVE.
**Date:** 2026-08-11
**Graded pin:** `fb71a3efa99af94e37b94738dcdd85e92b571aea`
**Cert worktree:** `C:/Users/tonio/Projects/wt-cert5-fb71a3ef` (detached at the pin; `git symbolic-ref -q HEAD` empty → **cannot advance**; re-measured at end of grade, unmoved)
**Receipt written to:** `C:/Users/tonio/Projects/wt-h1-wave4-20260712/docs/designs/GRADE-RATIFY1-FINAL-2026-08-11.md`

> ⚖️ **LINEAGE DECLARED — READ THIS FIRST.** I graded `RATIFY-1 [G][H][I]` earlier on 2026-08-11 at pins
> `4032d954` / `c5da1d4f`, and returned 1 CRITICAL + 2 HIGH, all on the instrument: (a) a forged arm flipping only
> `"reverse"` certified 15/15 exit 0; (b) `[H]`'s ceiling was printed but never joined the verdict list; (c) `[G]`
> reordered FILES ONLY, so the node axis was never varied. **The evidence set I am grading here is the repair of my
> own findings.** Independence is structural, not a matter of how honestly I look, so this is stated in the verdict
> rather than in a footnote. I mitigated it by re-deriving every number through a path that shares no code with the
> comparator, and by attacking surfaces my prior grade did not touch.

> 🛑 **BOUNDS HONOURED.** The instrument is FROZEN (`STOP [50]`). I modified nothing under `scripts/`. Every
> mutation-based attack ran on a COPY in a scratchpad outside the repo. I repaired nothing, sealed nothing, promoted
> nothing, and **publish no RATIFY-1 score**. The 33 failures were not adjudicated, not opened, not repaired, and not
> compared to the retired 287/31 counts.

---

## §0 — DISPOSITION

**THE CLAIM IS CONFIRMED IN EVERY CLAUSE.** All 13 requested verifications PASS. I could not refute the oracle,
the axes, the pin binding, the repeat independence, or the 33.

**AND I FOUND ONE REAL FALSE-GREEN SURFACE ON THE INSTRUMENT** — not in these runs. It is reported at §4 as
`F-RATIFY1-1` (HIGH), demonstrated live with a three-arm experiment including both controls. **The runs are genuine;
the instrument cannot prove one clause of what it certifies.** Those two statements are kept strictly apart, because
conflating them is how this desk has previously lost a grade.

| System | Band | Status | Evidence | Open risks |
|---|---|---|---|---|
| AR-1003 measurement claim (5 arms, oracle, axes, pin, 33) | **8** | `VERIFIED` | 13/13 re-derived through 2+ non-overlapping paths; §1–§3 | `F-RATIFY1-1` qualifies clause `[H]` only |
| `g_order_identity.py` as a certifying gate @`56fc73a4` | **6** | `VERIFIED` | 26/26 own red-proof controls fire; my 3-arm injection; §4 | 1 HIGH + 3 LOW open |

**Neither number is a RATIFY-1 score and neither authorizes promotion.** Band 9 is unavailable to the instrument
row by my own rubric while a HIGH is open. Band 8 on the claim reflects that the claim survived adversarial testing
with residual risk documented — the realistic ceiling for a maintained production system.

---

## §1 — EVIDENCE FILES AND HASHES

Instruments (git blob OIDs, verified byte-identical between the worktree and the pin; positive control below):

| Path (at pin) | blob OID |
|---|---|
| `scripts/ratify1_controls/g_order_identity.py` | `56fc73a4a2d71dd4b058a368a86d266387721e2c` |
| `scripts/accept5_isolated_runner.py` | `74c97cf610da4288672fe47f77ccbd817e4ce53c` |
| `scripts/accept5_isolation_plugin.py` | `32e5a2fbb72f3497e203ca385a7cefac9ac59dbc` |
| `scripts/accept5_isolated_population.py` | `d4eff9cac5518eba707675c818f4e5b0059295fb` |

> ⚠️ **The brief's instrument path `scripts/g_order_identity.py` DOES NOT EXIST at the pin.** The real path is
> `scripts/ratify1_controls/g_order_identity.py`. This matters because my first freeze check,
> `git diff --stat <pin> -- scripts/g_order_identity.py`, **returned empty and read as "identical"** — a false null of
> exactly the class this desk has been convicted on. It was caught by pairing the diff with
> `git rev-parse <pin>:<path>`, which errored. **An empty diff over a path that exists in neither side is not a match.**
> Positive control for the freeze check: appending one byte to a copy moved the OID to `75fd5d55d3f1e06e…`, so the
> comparison had a demonstrated path to red before I trusted its green.

Arm evidence (sha256 of file bytes):

| Arm | `aggregate.json` | `manifest.json` |
|---|---|---|
| A `isolated-a9356283ade7` | `5e6dee1cf2bc96074820ed1b602aecdcd5868279a886a34c5cf970ca31e6a437` | `f1a73a7d795da4f4e792620918f68c0fd4833f672f8597ae3fb36596346e4b61` |
| B `isolated-296e5425e283` | `5bdc02d1098b93f6019707e3f41fc7863bcdad1f18c7b1275034ffb8ed79acab` | `fabd5b3a806aca4278b93799a32f65b3000e2d51a56f2408a3702717f0872566` |
| C `isolated-2f06532fc4ed` | `074868615cf55a7a7e906151693a8911cb38dd39be93836b8f7aabd1e5edeab6` | `5a4c37a6a1f4276549fe351a75fdda47cc065db45556c7dadf24fd595708cde4` |
| D `isolated-2f85f4d38f45` | `101d156645c770a1b35cc451fe587a4134c6a86f7eb5eb4563f7c41877caf8b9` | `e8d1bd579de2f87f698d7ce1d10e42de69d9fa68a7eeacd42c3cb612d9a52aab` |
| E `isolated-63a5b88766fe` | `933d9e2c50836362c39cbbfe58d1ba581db42c53102f1bfca5a9beeb40df2593` | `1035cd53a649538111a8d8cf2bcd83fcefde694b929b9b3793cf0472b2c02b37` |

Comparison outputs: `cmp_A_vs_B_[G-FILE].txt` `c0670dbe765c3a86…` · `cmp_A_vs_C_[G-NODE].txt` `668cd197573ef246…` ·
`cmp_A_vs_D_[G]_both_axes.txt` `85b6e70f888c5ea9…` · `cmp_A_vs_E_[I]_repeat.txt` `89dc109a234defea…` ·
`cmp_B_vs_D_[G-NODE]_2nd.txt` `12758779451f1ad2…` · `cmp_C_vs_D_[G-FILE]_2nd.txt` `e974ac2c019ec0c8…` ·
`cmp_AC.txt` (REFUSED, excluded from evidence) `2081737f7a8734f9…`.

Authority: `docs/replay-results/h1-battery/acceptance-collection-seal-08062e12.json` blob `56cbd71ef3a7…` ·
`…/acceptance-population-successor.json` blob `7d6b66ec0f65…`. **Both byte-identical on disk and at the pin in all six
worktrees checked** (`wt-cert5-fb71a3ef`, `wt-h1-wave4-20260712`, `wt-gnode-fb71a3ef`, `wt-ctl-d66e46aa`,
`wt-m3-44db4eae`, `wt-ratify1-final-f3225b69`).

---

## §2 — THE TWO NON-OVERLAPPING PATHS

**Path 1 — the committed comparator, re-run by me.** I did not read the worker's output and call it verified; I
re-executed `g_order_identity.py` at the frozen OID and **byte-diffed my output against the committed evidence file**.
For `A vs D`:

```
python scripts/ratify1_controls/g_order_identity.py \
  --forward cert-arms/A/isolated-a9356283ade7/aggregate.json \
  --reverse cert-arms/D/isolated-2f85f4d38f45/aggregate.json \
  --mode order --node-axis reverse --pin fb71a3efa99af94e37b94738dcdd85e92b571aea
```
`EXIT=0`. Diff against `cmp_A_vs_D_[G]_both_axes.txt`: **3 lines, all of them the absolute-vs-relative path strings I
passed in. Every verdict line identical.** `[MEASURED HERE]`

**Path 2 — my own verifier, sharing no code with the comparator.** Written at
`…/scratchpad/indep_verify.py`; it does not import `g_order_identity`, the runner, or the plugin, and reads
`aggregate.json` only at the final step to compare against values I had already derived. Its inputs are the per-child
**JUnit XML** (pytest's own `junitxml` serializer — a different producer, different derivation, element-shape outcomes),
the per-child `acceptance-run.json` (the accept5 plugin's five disjoint lists), `node-sequence.json`, and the raw
receipts. **Node IDs are rebuilt by my own rule** from JUnit `classname`/`name` against the target file's dotted module
path, not by importing theirs.

> **Why that is a real second path and not the same path in a hat:** the comparator derives outcomes from the runner's
> five-list reconstruction inside the receipts. I derived them from the XML element shape
> (`<failure>`/`<error>`/`<skipped type="pytest.xfail">`/bare). Two serializers, two derivations. They agreed on
> **2419/2419 nodes in all five arms, 0 differing**, and my node-ID reconstruction produced **0 UNMAPPED** classnames —
> which is itself the self-check that my rebuild rule is complete rather than quietly dropping rows.

---

## §3 — THE 13 VERIFICATIONS

| # | Verification | Result | Decided by |
|---|---|---|---|
| 1 | 108 children and 2419 governed nodes in EVERY arm | **PASS** | Path 2: 108 receipts, 108 distinct target files, 2419 nodes from JUnit XML **and** 2419 from plugin records, all 5 arms |
| 2 | required == observed == 2419 in every arm | **PASS** | Authority re-derived independently: root seal `2392` + chain `+25 +1 +1` = **2419**; comparator prints `REQUIRED 2419`; observed 2419 |
| 3 | zero missing / invented / duplicate / collected-but-unexecuted / invalid-child / limited_subset | **PASS** | Path 1 verdicts + Path 2 rebuild from receipts: `problems=0`, `collected_but_unexecuted=0`, sum per-child nodes `2419` == distinct `2419` ⇒ **real duplicates 0**, all 5 arms |
| 4 | each CHILD bound to the exact certification pin | **PASS** | Path 2 over **540/540 receipts**: `head_sha` set == `{fb71a3ef…}`, 1 distinct value per arm |
| 5 | `arm_start_head == arm_end_head ==` pin (HEAD did not move mid-arm) | **PASS** | Read from each `manifest.json` directly: true in all 5. Also `arm_start_tree == arm_end_tree == 6e340b9cffb3` in all 5 (C13) |
| 6 | outcomes REBUILD from raw receipts, not read out of aggregate claims | **PASS** | Comparator: `rebuilt=2419 aggregate=2419` both arms of every pair. **Third path:** my JUnit-derived map is `IDENTICAL=True` to `aggregate.outcomes` in all 5 arms |
| 7 | run IDs establish genuinely DISTINCT executions | **PASS** | Path 2: **540 run_ids across 5 arms, 540 distinct**; shared = 0 in **all 10 pairs**; receipt run_ids == the children's own independently-recorded run_ids |
| 8 | FILE axis actually varies where claimed | **PASS** | Path 2 from receipt ordinals: A/C/E exactly canonical, B/D exactly reversed. **A↔B, A↔D, C↔D: exact-reverse=True, shared positions 0/108** |
| 9 | NODE axis actually varies where claimed (104 of 108) | **PASS** | 104 children have ≥2 nodes; **A↔C, A↔D, B↔D: 104/104 exact-reverse, 104 actually changed**; A↔B, C↔D, A↔E: 104 SAME. **Two independent order witnesses** (`node-sequence.json` vs JUnit `<testcase>` order) **disagree on 0 children in all 5 arms** |
| 10 | A == B == C == D by exact node ID → outcome | **PASS** | My own diff over my own JUnit-derived maps: **0 differing nodes on all 10 arm pairs**, not just the 6 the worker ran |
| 11 | A == E | **PASS** | Same, 0 differing |
| 12 | the same exact 33 failing node IDs in all five arms | **PASS** | Path 2: intersection across 5 arms = **33**, union = **33** ⇒ set-identical. Distribution `33 failed / 2384 passed / 2 xfailed = 2419` in every arm |
| 13 | every arm ≤ 600.0s **and the gate is a VERDICT, not a printed warning** | **PASS**, qualified | Gate is genuinely in the folded verdict list (`:334-337`): my injected `wall_s=36000` produced `FAIL` + `EXIT=1`. Declared: 377.7 / 372.7 / 363.2 / 368.2 / 367.9 s, worst **377.7s of 600.0s**. ⚠️ **Qualified by `F-RATIFY1-1`: the gated value is self-asserted and never rebuilt** |

**Context items checked and correctly filed, not reported as findings:**
- `cmp_AC.txt` is a genuine REFUSAL (`FAIL [G] arms genuinely OPPOSED`, closing `*** [G] NOT SATISFIED ***`).
  **AR-1003 did not harvest its `0 differing node(s)` line** — it states so explicitly and the properly-run A-vs-C
  evidence is a separate file with a different mode. No finding.
- The `[I]` label on A-vs-C and B-vs-D follows `--mode`, and the `[G-NODE]` substance is the
  *"node axis GENUINELY varied — 104 of 108"* assertion, which I verified is real and not vacuous. No finding.
- `manifest_sha256` differs across all five arms while `population_digest` (`552f4f37e67c…`) and `arm_start_tree`
  (`6e340b9cffb3…`) are identical in all five. **The separation holds exactly as briefed.** No finding.

---

## §4 — FINDINGS

### Discrepancy F-RATIFY1-1: the `[H]` gate is unfalsifiable downward — a class of verdict-bearing fields the chain never rebuilds
**Severity:** HIGH (false-green surface on the instrument; **NOT a defect in these runs**)
**Claim:** *"`[H]` passes as a hard gate — worst arm 377.7s of 600.0s."* The gate is described in the instrument's own
source as the repair of my prior F-2: *"A CHECK THAT PRINTS ITS OWN FAILURE AND EXITS ZERO IS NOT A GATE."*
**Reality:** `[H]` is now correctly *gated* — its verdict really does join the list the exit code folds. But it is
computed from `arm["wall_s"]`, **a field `verify_chain()` never recomputes**, while the same arm's 108
digest-bound receipts carry `elapsed_s` summing to 377.5s — the evidence that would falsify a lie is sitting in the same
directory, unread. **The gate can only catch a liar who lies upward.**

This is a **class, not an instance**. Enumerating `REQUIRED_FIELDS` against what `verify_chain()` actually recomputes:

| Field | Status |
|---|---|
| `outcomes` | REBUILT — `rebuilt == arm["outcomes"]` (`:243`) |
| `children` | REBUILT — `len(entries) == arm["children"]` (`:171-173`) |
| `nodes` | REBUILT — `len(rebuilt) == arm["nodes"]` (`:245`) |
| `reverse` | DERIVED — from manifest entry order (`:256-264`) |
| `head` | ANCHORED — child receipts + `cat-file` + `--pin` |
| **`wall_s`** | **BELIEVED** — `mins = arm["wall_s"] / 60.0` (`:335`) |
| **`duplicate_nodes`** | **BELIEVED** — `arm["duplicate_nodes"] == 0` (`:348`) |
| **`collected_but_unexecuted`** | **BELIEVED** — `arm["collected_but_unexecuted"] == 0` (`:350-352`) |
| **`invalid_children`** | **BELIEVED** — `not arm["invalid_children"]` (`:346`) |
| **`limited_subset`** | **BELIEVED** — `is False` (`:340-342`) |

**5 of 10 verdict-bearing fields are self-assertions.** For four of them the receipts contain exactly the data needed to
rebuild the value (`problems`, `collected_but_unexecuted`, per-child outcome counts) and it is never used.
`limited_subset` is defended in depth — a genuine subset would fire `missing required nodes` — so it is the least severe.

**Sources compared:** [aggregate.json `wall_s` = 377.7 | Σ receipt `elapsed_s` = 377.5 | comparator verdict = reads only the former]
**Source of truth:** the receipts — they are digest-bound through `manifest.json` into `aggregate.manifest_sha256`;
`wall_s` is bound by nothing, and editing it invalidates no digest anywhere in the chain.

**Repro (three arms, both controls, on a COPY — the repo was not touched):**
```
cp -r cert-arms/A/isolated-a9356283ade7 <scratch>/armcopy      # 108 receipts, 110 dirs
# CONTROL 1 (positive)  wall_s = 377.7  -> EXIT=0, 0 FAIL lines, "[H] ... 6.29 min"   GREEN
# ATTACK    (downward)  wall_s =   1.0  -> EXIT=0, 0 FAIL lines, "[H] ... 0.02 min"   GREEN
#                                          "[G] SATISFIED - EXACT NODE-OUTCOME IDENTITY UNDER REORDERING"
# CONTROL 2 (upward)    wall_s = 36000  -> EXIT=1, 1 FAIL line,  "FAIL forward: [H] ... 600.00 min"  RED
python scripts/ratify1_controls/g_order_identity.py --forward <scratch>/armcopy/aggregate.json \
  --reverse cert-arms/D/isolated-2f85f4d38f45/aggregate.json --mode order --node-axis reverse \
  --pin fb71a3efa99af94e37b94738dcdd85e92b571aea
```
Control 1 proves the harness can reach green; Control 2 proves the gate is **live in my harness**, so the attack's green
is about **direction**, not a dead check. `[MEASURED HERE]`

**Fix point:** `scripts/ratify1_controls/g_order_identity.py:335` — the `[H]` verdict should fold a value recomputed
from the receipts (e.g. `Σ elapsed_s`, with a stated tolerance for runner overhead — measured here at 0.2s over 377.5s),
and `verify_chain()` should rebuild `invalid_children` / `collected_but_unexecuted` / `duplicate_nodes` from the
receipts' own `problems`, `collected_but_unexecuted`, and per-child outcome-count-vs-distinct-key comparison.
**REPORTED, NOT FIXED** — the instrument is frozen and repairing it inside the evidence set it certifies is the error
this desk keeps re-minting.
**Blast radius:** any future certification that consumes an `[H]` verdict, and any reader treating
`invalid_children == 0` / `duplicate_nodes == 0` as measured rather than declared. **Does not affect the present
certification**, because I rebuilt all four from the receipts independently (§3 row 3) and every one corroborates.

---

### F-RATIFY1-2 (LOW): the `[G]` headline asserts node-order invariance even when the node axis was never checked
`--node-axis` is opt-in (`:388 if node_axis in ("same","reverse")`), and **nothing requires it even when the two arms'
`reverse_nodes` differ.** Omitting it on the genuine A-vs-D pair emits **0 `[G-NODE]` verdict lines** and still prints
`[G] SATISFIED - EXACT NODE-OUTCOME IDENTITY UNDER REORDERING`. The artifact records no flags, so a reader must infer
the axis was checked from the *presence* of three lines rather than from any positive statement.
**INERT HERE** — I confirmed all three `[G-NODE]` lines are present in the four real comparison files that need them.
Related: `reverse_nodes` is **not** in `REQUIRED_FIELDS` and is read via `.get()` at `:417-421`, which is a departure
from the file's own stated discipline at `:36` (*"No `.get(field, default)` reconstruction anywhere"*).
`[MEASURED HERE]`

### F-RATIFY1-3 (LOW): `derived_rev` distinguishes only *exactly canonical* from *exactly reversed*
`:256-264` sets `derived_rev = (targets == reversed(canonical))`, then forces `False` if `targets == canonical`. **Any
other permutation also yields `False`**, so a forward arm whose files ran in an arbitrary shuffle is indistinguishable
from a canonical one. The reverse arm *is* pinned exactly (it must equal `reversed(canonical)`), so the [G-FILE]
"axis varied" claim survives; only "the forward arm was canonical" is unproven.
**INERT HERE** — measured independently: A/C/E are exactly canonical, B/D exactly reversed, 0/108 shared positions.
`[MEASURED HERE]` for the code; **exploitability NOT executed** (would require renaming receipts and resealing).

### F-RATIFY1-4 (LOW): the comparator's output carries no provenance for its own authority
`authority_nodes()` reads the seal from `REPO = Path(__file__).resolve().parents[2]` — **the comparator's own working
tree, on disk, unanchored to the pin** — and the report prints `governed nodes REQUIRED 2419 (population authority)`
**with no seal digest**. A reader of a `cmp_*.txt` cannot tell which seal produced 2419.
**Measured and largely self-defending:** the seal and chain are byte-identical on disk and at the pin in all six
worktrees, and because `missing` **and** `invented` are both checked, *any* divergent authority fires RED. Residual risk
is confined to a tampered-but-identical-membership authority, plus the unreadable provenance.
Empirical: running the comparator from `wt-h1-wave4-20260712` (HEAD `297fb2fe`, a **different commit**) against the
cert5 arms still yields `REQUIRED 2419` and `[G] SATISFIED`, `EXIT=0`. `[MEASURED HERE]`

### F-RATIFY1-5 (LOW, caption): AR-1003 says `--red-proof` has "23 controls"; it emits **26**
Counted from the run: 15 oracle/guard + C8, C9, C8b, C10, C10b, C11, C11b + C13a, C13b, C13c + C12 = 26, all OK,
closing `COMPARATOR DISCRIMINATES`. The undercount is conservative and does not affect any verdict, but a caption is a
claim and is graded like code. **Fix at the report, not by hand-editing the count into a table.**

---

## §5 — COVERAGE (mandatory)

**1. What I verified, and through which non-overlapping paths.**
Every one of the 13 items above carries at least two. The paths were: **(P1)** the committed comparator re-executed by
me at the frozen OID, byte-diffed against the worker's own output; **(P2)** my own verifier over per-child JUnit XML +
plugin records + raw receipts, with my own node-ID reconstruction and my own diff; **(P3)** for the node axis
specifically, two independent execution-order witnesses — the plugin's `pytest_runtest_logstart` sequence and the
JUnit `<testcase>` document order (0 disagreements across 540 children); **(P4)** git object-DB reads for the pin,
instrument OIDs, and authority blobs. The oracle result was additionally extended: the worker ran 6 comparisons, I ran
**all 10 arm pairs** and found 0 differing nodes on every one.

**2. Positive-control witnesses for every absence claim.**
- *Instruments unmodified* → appending one byte to a copy moved the blob OID (`56fc73a4…` → `75fd5d55…`).
- *`[H]` gate is live* → injected `wall_s=36000` produced `FAIL` + `EXIT=1`; injected `wall_s=377.7` produced GREEN.
  Both directions, so neither green nor red is a constant.
- *Comparator discriminates at all* → its own 26-control `--red-proof`, all firing, including a GREEN positive arm
  (`C9`, `C10b`) so the REDs are not vacuous.
- *Node axis genuinely varied* → the same measurement over the pairs that must NOT vary it (A↔B, C↔D, A↔E) returns
  `SAME order=104, EXACT-REVERSE=0`, so the reverse result is discriminating and not an artifact of my method.
- *No XXE / entity tampering in the XML I parsed* → scanned all **540** `acceptance-run.xml` for
  `<!DOCTYPE|<!ENTITY|SYSTEM "`, zero hits; XML bytes are additionally digest-bound by the receipts.
- *My node-ID rebuild is complete* → **0 UNMAPPED** classnames across all five arms; a rule that silently dropped rows
  would have surfaced there and as a node-count shortfall.

**3. Join keys relied on for every "identical / unchanged / matches" claim.**
`(arm, node_id) → outcome` for the oracle · `(arm, target_file) → ordered node_sequence` for the node axis ·
`(arm, ordinal) → target_file` for the file axis · `run_id` (540 distinct) for execution identity ·
`head_sha` per child receipt for pin binding · sha256 of file bytes for every artifact · git blob OID for instrument
freeze and authority identity · `arm_start_tree`/`arm_end_tree` for C13.

**4. WHAT I DID NOT VERIFY.**
- **The merit of the 33 failures.** Not adjudicated, not opened, not repaired, not compared to 287/31 — out of scope by
  the brief and by ruling. I verified only that the *same 33 node IDs* fail in all five arms.
- **Whether the 2 `xfailed` nodes deserve that status.** Counted, not judged.
- **Any production behaviour whatsoever.** This is a referee-determinism result. Order-invariance of a measurement says
  nothing about whether what it measures is correct, and I will not let those two travel in one sentence.
- **`F-RATIFY1-3`'s exploitability** — I read the executable lines and measured the real arms as exactly
  canonical/reversed, but I did **not** construct a shuffled-forward-arm fixture (needs receipt renaming + reseal).
  The code fact is `MEASURED`; the exploit is `UNVERIFIED`.
- **`red_proof_chain` (C1–C7).** I did not run `--red-proof-chain`; it clones and tampers real arm directories, and I
  judged the write volume against a live evidence set not worth the risk when I had already built an independent
  chain rebuild of my own. Its coverage is therefore `RELAYED` from the instrument's source, not `MEASURED HERE`.
- **That the arms were run serially in wall-clock terms.** Directory mtimes are consistent with strict serial execution
  (A 12:51→12:58, B →13:04, C →13:10, D →13:16, E →13:22) but mtimes are weak evidence and I did not corroborate them
  against a second clock. `[CORROBORATED, weak]`
- **Anything about `wt-h1-wave4-20260712`'s own HEAD stability.** It moved during my grade (`29e2fc9b` → `297fb2fe`);
  a live sibling seat is writing there. **My verdict is bound to `fb71a3ef` only**, which is detached and cannot advance,
  and I re-measured it unmoved at the end of the grade.
- **Whether any evidence file changed between my hashing and my reading.** Hashes in §1 were taken once at the start.

---

## §6 — WHAT I WOULD HAVE REPORTED AND DID NOT

The honest null matters as much as the finding. I attacked and **failed to break**: the pin binding (all 540 children),
run-id independence (540/540 distinct), the file axis (0/108 shared positions), the node axis (104/104 exact reverse,
two witnesses), the outcome oracle (0 differing on all 10 pairs, by my own diff over a different serializer), the
manifest→receipt→artifact digest chain, the authority's non-circularity (seal frozen 2026-08-10 03:41 and chain
2026-08-11 01:31, both **before** the 12:51 runs; `2392 + 25 + 1 + 1 = 2419` with hash-anchored parents), and the
refused-run discipline. **I did not manufacture a finding to look diligent, and `F-RATIFY1-1` is reported as a property
of the instrument, not as evidence that these runs were faked — because they were not.**
