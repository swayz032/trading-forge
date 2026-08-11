# GRADE — RATIFY-1 [G] [H] [I] — INDEPENDENT VERDICT

**Grader:** accuracy-validator (fresh-eyes, dispatched by ADVISOR desk seat claude.exe 26972)
**Date:** 2026-08-11
**Claim under test:** AR-986 — *"[G] [H] [I] ALL SATISFIED ON THE FULL GOVERNED POPULATION — 108 CHILDREN, 2419 NODES, 0 DIFFERING NODES IN BOTH DIRECTIONS AND ACROSS REPEATS."*
**Pins:** EXECUTION EVIDENCE `4032d954` · FINAL COMPARATOR `c5da1d4f` · INVENTORY `a0d54ab3`
**Worktree writes:** NONE. Tree cleanliness controlled before/after every execution (83 porcelain entries, identical each time). All instruments extracted from the object DB into an isolated scratch harness.

---

## 0. VERDICT TABLE

| Obligation | Band | Status | Verdict | Evidence |
|---|---|---|---|---|
| **[G]** exact node-outcome identity under reordering | 6 | **VERIFIED** | **CONFIRMED AS MEASURED — SCOPE NARROWER THAN THE WORDING** | Both paths: 0 differing nodes. But "reordering" = FILE-level only; I measured real intra-file order-dependence the arms never varied (F-5) |
| **[H]** serial, no concurrency, ≤10.0 min | 7 | **VERIFIED** | **CONFIRMED — by an independent channel, not the claimed field** | JUnit timestamps: 0 overlapping child pairs, arms non-overlapping, 9.25/9.14/9.19 min. Ceiling genuinely pre-registered. But instrument never gates it (F-2) |
| **[I]** repeatability at an identical pin | 7 | **VERIFIED** | **CONFIRMED — genuine second execution** | 5/108 identical durations only, mean delta 0.077s, distinct time windows; 0 differing nodes by both paths |
| **The comparator as an instrument** | 5 | **VERIFIED** | **CERTIFIES A FORGED PAIR** | F-1, measured |

**Overall: the three obligations are TRUE of the artifacts presented. The instrument that certifies them is not sound enough to have established that on its own.** Those are different statements and I keep them apart throughout.

---

## 1. WHAT AGREED — TWO NON-OVERLAPPING PATHS

**Path 1** — the project's own comparator `g_order_identity.py` at pin `c5da1d4f`, run in an isolated scratch harness (`scratchpad/harness/`) reconstructed from the object DB.
**Path 2** — `MEASURED HERE`, my own parser (`scratchpad/path2_junit.py`) over the 324 per-child `acceptance-run.xml` files. **It never opens `aggregate.json`.** Node IDs reconstructed from JUnit `classname`+`name` against the committed population authority; outcomes derived from the XML **element shape** (`<failure>`/`<skipped type=…>`/`<error>`/bare); my own union-diff logic.

These are non-overlapping in artifact (aggregate summary vs pytest's own junitxml serializer), in derivation (runner's five disjoint lists vs XML element shape), and in logic (their `diff()` vs mine).

| Quantity | Path 1 (comparator/aggregate) | Path 2 (my JUnit parse) | Agree |
|---|---|---|---|
| children | 108 | 108 child dirs | ✅ |
| governed nodes observed, all 3 arms | 2419 | 2419 | ✅ |
| governed nodes REQUIRED (authority) | 2419 | 2419 (my own re-derivation) | ✅ |
| [G] fwd vs rev differing nodes | 0 | 0 | ✅ |
| [I] fwd vs rpt differing nodes | 0 | 0 | ✅ |
| rev vs rpt differing nodes | not run | 0 | ✅ |
| missing-required / invented | 0 / 0 | 0 / 0 | ✅ |
| distribution | 287/2127/3/2 | 287 failed, 2127 passed, 3 skipped, 2 xfailed | ✅ |
| duplicate node IDs | 0 | 0 | ✅ |
| unresolved node IDs | n/a | 0 | ✅ |

`MEASURED HERE` **287 + 2127 + 3 + 2 = 2419.** Arithmetic reconciles exactly.
`MEASURED HERE` **45 of 108 files hold ≥1 failure**, in all three arms, from JUnit's own `failures` attribute. Confirmed.
`MEASURED HERE` **106 distinct files contribute required node IDs; 108 children = 106 + 2 helper files** (`_a_packet_harness.py`, `_forensics_fixtures.py`, both `tests=0`). The 106/108 gap reconciles with the runner's `empty_by_design` exit-5 path.

### H1 — IS "observed == required" VACUOUS? **NO. REFUTED.**
`MEASURED HERE` The two sides trace to genuinely independent origins:
- **required** ← `population_successor.required_population()` reads the **immutable committed seal** `acceptance-collection-seal-08062e12.json` (2392 nodes) plus a hash-anchored successor chain, each entry's `resulting_population_sha256` re-derived from its own additions. My own arithmetic: **2392 + 25 + 1 + 1 = 2419.**
- **observed** ← live pytest execution, recovered by me from JUnit XML.

The circularity vector that *would* make it vacuous — recording a successor from the very collection being checked — **did not fire here**: last chain commit `e0d55514` at **01:31:54**, runs began **03:57:50**. The authority was frozen **2h26m before** the first child. `MEASURED HERE`

### H7 — IS THERE A HIDDEN ERROR BUCKET? **NO.**
`MEASURED HERE` JUnit's own `testsuite@errors` attribute summed across all 108 children = **0** in all three arms, and `sum(testsuite@tests)` = **2419**. I read pytest's independent error channel, not the runner's five buckets. No silently-dropped category.

### H3 — ARE THE ARMS GENUINELY OPPOSED? **YES, PROVEN BY EXECUTION, NOT BY THE FLAG.**
`MEASURED HERE` Ordering the children by the **JUnit `timestamp` pytest embedded in each child artifact** — a channel entirely independent of the aggregate's `reverse` field:
- `rev_seq == reversed(fwd_seq)` → **True**
- positions where fwd and rev ran the same child: **0/108**
- `rpt_seq == fwd_seq` → **True** (correct for [I])

The `reverse` flag is not merely a label. Execution order genuinely inverted.

### H4 — IS THE REPEAT A REAL SECOND EXECUTION? **YES.**
`MEASURED HERE` Only **5/108** children share a byte-identical JUnit `@time` (all sub-second, rounding); mean per-child delta 0.077s, max 1.140s; arm totals 399.7 / 395.1 / 398.0s; time windows disjoint. Not a copy or cache.

### H5 — IS THE 10.0 MIN CEILING PRE-REGISTERED? **YES.**
`MEASURED HERE` R-825 committed `65dbe85f` **03:51:15** carrying *"Pre-registered ceiling ≤ 10 MINUTES"*. `CEILING_MIN = 10.0` first appears in `4032d954` **03:56:58**. First child started **03:57:50**. Threshold predates measurement by 6m35s (ruling) / 52s (code). Genuine, though the lead is thin and non-adversarial (same session authored both).

### DESK QUESTION — THE ONE `sha256` AND 34 `receipt` STRINGS
`MEASURED HERE` **All of them are inside test node-ID names.** Occurrences outside the `outcomes` keys: **`sha256` = 0, `receipt` = 0.** The single `sha256` is the test `test_prepare_strategy_computes_sha256_when_not_supplied`; 25 node IDs contain `receipt`. **They are decoration in the strictest sense — they are test names, not provenance.** The external read's conclusion was right; its wording was loose. `aggregate.json` carries **no** child hash chain, and the per-child `artifact_sha256` the runner *does* compute (`accept5_isolated_runner.py:268-271`) is stored only in the in-memory receipt and **discarded when `main()` returns** — `summary` (`:349-358`) never includes it. That is the causal defect behind F-1.

---

## 2. FINDINGS — RANKED

### Discrepancy F-1: the comparator certifies a FORGED pair
**Severity:** CRITICAL (false positive) — banked as **ACCEPT5-AGGREGATE-PROVENANCE-1**, promotion blocker until adjudicated
**Claim:** "arms genuinely OPPOSED (fwd.reverse=False, rev.reverse=True)" is presented as the guard that makes [G] non-vacuous — the comparator's own docstring says *"the arms must PROVE they are opposed … A comparison that cannot fail is not evidence."*
**Reality:** `MEASURED HERE` I copied the forward `aggregate.json`, changed **one byte-region** — `"reverse": false` → `"reverse": true`, a one-line unified diff over a 327,081-byte file, all 2419 outcomes byte-identical — and fed it back as the reverse arm. **Result: 15/15 verdicts OK, "[G] SATISFIED", exit 0.** The forged arm was never executed and sat alone in a directory **containing no child artifacts at all**.
**Sources compared:** genuine pair → GREEN exit 0 | forged pair → **GREEN exit 0** | one-outcome-corrupted pair → RED exit 1 (control fires)
**Source of truth:** the comparator reads `reverse` as a **self-asserted field**. `load_arm()` opens only `aggregate.json`; nothing in the call path ever opens a child artifact, so attacks 3/4/5 (post-hoc edits to aggregate or children) are all confirmed by this single measurement.
**Fix point:** `scripts/accept5_isolated_runner.py:349-358` — `summary` must carry the per-child `artifact_sha256` map already computed at `:268-271`; `scripts/ratify1_controls/g_order_identity.py:67` `load_arm()` must verify it.
**Repro:** `python scripts/ratify1_controls/g_order_identity.py --forward <genuine-fwd> --reverse <copy-with-reverse-flipped> --mode order` → exit 0
**Blast radius:** every [G]/[I] verdict; any future ratification reusing this comparator.
**Precise scope — do not merge these:** this does **NOT** mean the worker's three runs were fake. I verified independently (§1, §3) that they were not. It means **the instrument is incapable of telling a genuine pair from a forged one.**

### Discrepancy F-2: [H] is PRINTED, NEVER GATED — no path to red *(novel, unprescribed)*
**Severity:** HIGH (check with no path to red)
**Claim:** "[H] … satisfied with 7.2% headroom against a PRE-REGISTERED ceiling of 10.0 min."
**Reality:** `MEASURED HERE` I forged `wall_s` to 36000.0 (600.00 min, 60× the ceiling). The instrument printed `*** EXCEEDS CEILING -- STOP AND REPORT, DO NOT PARALLELIZE ***` **and then printed "[G] SATISFIED" and returned exit 0.**
**Source of truth:** the code. `compare()` builds the verdict list `V`; **no wall-clock entry is ever appended to `V`.** `report()` prints the ceiling line, but `allok = all(ok for _, ok, _ in V)` cannot see it. The [H] obligation has **no path to red inside the instrument**.
**Fix point:** `scripts/ratify1_controls/g_order_identity.py` — `compare()` must append `(f"{tag}: wall clock <= {CEILING_MIN} min", mins <= CEILING_MIN, …)` to `V`.
**Repro:** flip `"wall_s": 556.5` → `"wall_s": 36000.0` in a copy of the forward map, rerun → prints EXCEEDS, exits 0.
**Note:** [H] is nonetheless **true** here — I confirmed it via an independent channel (§3). The finding is that the instrument did not establish it.

### Discrepancy F-3: intra-file order-dependence is REAL, MEASURED, and the axis [G] never varies *(novel, unprescribed — my strongest finding)*
**Severity:** CRITICAL (the defect class [G] exists to detect, outside [G]'s reach)
**Claim:** "[G] EXACT NODE-OUTCOME IDENTITY **UNDER REORDERING** … 0 DIFFERING NODES."
**Reality:** `MEASURED HERE` `accept5_isolated_runner.py:323-324` is the whole of the reordering: `if args.reverse: files.reverse()`. **Only the FILE list is reversed. Intra-file test order is identical in every arm.** Varying that axis myself on `test_run_receipt.py` under the harness's own flags **changes which nodes fail**:

| invocation (all with `--accept5-layer2`) | failing set |
|---|---|
| file target (what the arms ran) | `test_config_hash_deterministic`, `test_config_hash_changes` |
| 3 node IDs, canonical order | `test_config_hash_deterministic`, `test_receipt_has_all_fields` |
| 3 node IDs, **reversed** | `test_config_hash_deterministic`, `test_config_hash_changes` |
| `test_config_hash_deterministic` **alone** | *(none — it PASSES)* |

The failure **count** is stable at 2; the **set** moves. `test_receipt_has_all_fields` and `test_config_hash_changes` each flip passed↔failed purely on intra-file position, and `test_config_hash_deterministic` passes alone but fails with siblings.
**Source of truth:** direct execution. A count-stable, membership-unstable map is exactly what an exact-node oracle is supposed to catch — and [G] cannot, because it holds this axis fixed.
**Fix point:** the claim's wording. "[G] under reordering" must read **"under FILE-LEVEL reordering"**; intra-file order is an untested axis with a measured live positive.
**Repro:** the four rows above, `cwd` = worktree root, `PYTHONDONTWRITEBYTECODE=1 -p no:cacheprovider`.
**Blast radius:** the semantic claim that the isolated architecture is order-independent. The literal 0-differing-nodes result stands; the generalization does not.

### Discrepancy F-4: recorded outcomes are a function of a HARNESS FLAG — symmetric wrongness *(the desk's symmetric-wrongness question, answered by measurement)*
**Severity:** HIGH (measurement validity) — **NOT an adjudication of the 287; that STOP is respected**
**Reality:** `MEASURED HERE` Bisecting the child command isolates a single causal variable, `--accept5-layer2`:

| arm | result on `test_run_receipt.py` |
|---|---|
| plain pytest | **3 passed** |
| + `acceptance_pytest_plugin` | 3 passed |
| + `accept5_isolation_plugin` (no layer2) | 3 passed |
| + `accept5_isolation_plugin` **+ `--accept5-layer2`** | **2 failed, 1 passed** |
| full harness command | **2 failed, 1 passed** — reproduces the recorded map exactly |

Extended to 5 files, plain vs layer2: `test_run_receipt` 3P→2F · `test_gate3_defect6_…` 2P→1F · `test_class_backtest_stop_entry_reference` 3P→1F · `test_gap_fill_stops` 4P→3F · `test_deepscan17_b1_stylec_blended_exit` 4P→2F. **5 of 5 sampled files pass completely without the flag; each layer2 failure count matches the recorded map exactly.**
**Mechanism:** `MEASURED HERE` layer2 evicts call-phase `sys.modules` additions — witness line `keys_evicted=1386` after a single test body. Tests that `import src.engine.backtester` **inside the test body** trigger eviction of the whole tree; sibling re-imports then break at `backtester.py:53` (itself an import line).
**Why [G]/[I] cannot see it:** the flag is constant across all three arms, so the effect is **perfectly symmetric**. A difference-based oracle is blind to it by construction.
**Scope:** 5 files / 9 of 287 nodes sampled. **The other 278 are UNENUMERATED** — I did not extrapolate and the desk should not either.
**Handoff:** whether these are genuine defects revealed by a stricter boundary, or artifacts of an over-aggressive one, is the desk's adjudication. I state only that **the recorded map is harness-conditioned.**

### Discrepancy F-5: the pin is self-consistent but UNANCHORED *(novel)*
**Severity:** MEDIUM
**Reality:** `MEASURED HERE` I set **both** arms' `head` to `deadbeefdeadbeefdeadbeefdeadbeefdeadbeef` — a commit that exists in no tree. Verdict: `OK  both arms measured the SAME commit` → **"[G] SATISFIED", exit 0.** The guard asserts the arms agree *with each other*; nothing binds them to the commit under test, and nothing checks the object exists. *(Control: a head **mismatch** between arms correctly goes RED, exit 1 — that guard does work.)*
**Fix point:** `g_order_identity.py compare()` — add a verdict that `fwd["head"]` resolves via `git cat-file -t` and equals the pin being certified.

### Discrepancy F-6: mid-run pin drift is structurally undetectable
**Severity:** MEDIUM (did not fire here; live risk on a moving tree)
**Reality:** `MEASURED HERE` `main()` captures `head` **once** at `:310` before any child runs. Each child independently re-derives `head_sha` (`:94-95`, because `main()` never passes it) into `receipt["head_sha"]` (`:128`) — which is **never compared to anything and never persisted**. The durable per-child `acceptance-run.json` carries **no** commit/sha/head field at all (keys verified). So the aggregate's `head` is a claim true only of the run's first instant.
**This instance is CLEAN:** `MEASURED HERE` zero commits landed between `4032d954` (03:56:58) and `c5da1d4f` (04:29:01); the entire 03:57:50→04:26:46 run window sits between them. The hole is structural, not realized — but the desk itself describes this tree as one a live worker commits into.

---

## 3. [H] AND [I] ESTABLISHED BY AN INDEPENDENT CHANNEL

Because F-2 shows the instrument does not gate [H], I established it myself from the JUnit timestamps. `MEASURED HERE`

- **Within-arm concurrency:** for each arm, no child starts before the previous finished. **0 overlapping pairs** in all three; minimum inter-child slack 0.731 / 0.728 / 0.716 s. **Strictly serial.**
- **Between-arm:** fwd 03:57:50→04:07:05 · rev 04:07:33→04:16:42 · rpt 04:17:34→04:26:45. Gaps **+27.9s** and **+52.5s** — no overlap, so the arms did not run concurrently either.
- **Spans:** 9.25 / 9.14 / 9.19 min (first-child-start → last-child-start; slightly under the claimed 9.28/9.16/9.21 `wall_s`, as expected since it excludes the final child's duration and spawn overhead). **Consistent, and under the pre-registered 10.0.**

[H] is **true**. It was verified by me, not by the instrument.

---

## 4. WHAT I DID **NOT** VERIFY

1. **I did not re-run the 108-child suite.** Per the desk's Stage-1 stop rule, once F-1 produced an authoritative-looking green the ~28-minute three-arm rerun was not earned. **Consequence:** every statement about the three arms rests on the preserved artifacts plus my independent re-derivation from them — not on a fresh execution.
2. **278 of the 287 failures are UNENUMERATED** for the F-4 layer2 effect. I sampled 5 files / 9 nodes. I do not know the true proportion and deliberately did not estimate it.
3. **I did not adjudicate any failure**, nor the 7/11 PnL nodes — standing STOP respected.
4. **Intra-file order-dependence (F-3) is measured on ONE file.** Whether other files share it is UNENUMERATED.
5. **I did not verify the artifacts were produced by the pinned runner at all** — that is precisely what F-1 says is unverifiable with the current schema. My confidence that these three runs are genuine rests on *converging circumstantial evidence* (junit timestamps consistent with serial execution, order genuinely reversed, durations differing across repeats, aggregate exactly reconstructable from 324 child XMLs), **not on cryptographic binding**. A sufficiently careful forger could have produced all of it; nothing in the artifact set would refuse.
6. **`accept5_isolated_population.build()`** — I read its callers but did not audit its file-selection logic. The 106+2=108 reconciliation against the authority is my only check on it.
7. **The other red-proof arms (H6):** I verified the comparator's own `--red-proof` design by reading it and independently confirmed **3** behaviours (1-outcome corruption → RED; head mismatch → RED; genuine pair → GREEN). I did **not** independently execute all 15 claimed arms. F-1/F-2/F-5 show the red-proof's coverage is the issue, not its honesty: **every arm it tests, it tests correctly; the holes are in what it never tests.**
8. **Single-instrument risk on the authority:** `required_population()` is the only implementation of the population rule. I re-derived its arithmetic (2392+25+1+1) and its chain anchoring, but a second independent implementation does not exist.

---

## 5. COVERAGE — CONTROLS AND JOIN KEYS

**Positive/negative controls for every absence claim:**
- "0 differing nodes" — negative control: corrupting **one** outcome byte produced exactly 1 differing node, printed in full, exit 1. My harness discriminates.
- "comparator never reads child artifacts" — positive control: the forged aggregate sat in a directory with **no child dirs whatsoever** and still certified.
- "[H] not gated" — positive control: 600.00 min printed the EXCEEDS banner and still exited 0.
- "head not anchored" — paired controls: same-fake-head → GREEN; mismatched head → RED.
- "no errors bucket" — read JUnit's independent `errors` attribute (0), not the runner's buckets.
- "no worktree writes" — `git status --porcelain` captured before and after **every** execution batch; 83 entries, identical every time.

**Join keys checked:** node ID (`file::class::name`, 0 unresolved / 0 duplicates across 7257 node-instances) · child dir slug ↔ authority file path (108/108) · `run_id` (child record ↔ minted) · commit SHA (`4032d954` in both arms) · JUnit `timestamp` (execution order) · population chain `parent_population_sha256` → `resulting_population_sha256`.

**Lineage declaration:** I previously graded `ACCEPT5-INSTRUMENT-1` at pins `9b62c439` and `18b46161`. That instrument is **upstream** of this one (the sealed 2392 population re-derives here to the same value via a 4th path). I did not design, build, or advise on `g_order_identity.py`, `accept5_isolated_runner.py`, or any artifact under grade.

---

## 6. BOTTOM LINE

`[G]`, `[H]` and `[I]` **are true of the evidence presented**, and I confirmed each through two non-overlapping paths that agreed on every number — including the exact 2419, the 287/2127/3/2 split, the 45 files, genuinely opposed execution order, and strictly serial timing.

**Three things the claim's wording overstates:**
1. **"[G] under reordering"** is *file-level* reordering. I measured live intra-file order-dependence in the certified population (F-3).
2. **"[H] satisfied"** was established by me, not by the instrument, which cannot fail it (F-2).
3. **"0 DIFFERING NODES"** is a difference-based result and is structurally blind to the harness-conditioned outcomes I measured (F-4).

**And one thing the instrument cannot do at all:** distinguish a genuine pair from a forged one (F-1). That is a HIGH-severity promotion blocker on the *instrument*, and explicitly **not** an allegation about the runs — which, on all the independent evidence I could bring, appear genuine.
