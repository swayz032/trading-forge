# GRADE — F-RATIFY1-1 REPAIR (targeted re-grade)

**Date:** 2026-08-11 · **Grader:** accuracy-validator (independent) · **Mode:** GRADE + HUNT
**Mandate:** disprove the AR-1006 claim that F-RATIFY1-1 is closed at the instrument.

---

## 0. THE TWO PINS ARE TWO IDENTITIES

| Identity | SHA | Status | What it is |
|---|---|---|---|
| **EXECUTION EVIDENCE PIN** | `fb71a3efa99af94e37b94738dcdd85e92b571aea` | on `origin/h1-wave4-sealed12-driver` | the commit arms A/B/C/D/E actually executed at |
| **REPAIRED COMPARATOR PIN** | `7090da86` | local-only, **not** on origin — expected, not a finding | carries the post-grade verifier repair |

`[MEASURED HERE]` `git branch -a --contains` returns `remotes/origin/...` for `fb71a3ef` and **local branch only** for `7090da86`. The brief's characterisation is confirmed.

**The five arms did NOT run on `7090da86`.** This grade checks the **REPAIRED VERIFIER (`7090da86`)** against the **IMMUTABLE EVIDENCE (`fb71a3ef`)**. Every attack below re-verifies frozen `fb71a3ef` artifacts (or copies of them) with the `7090da86` comparator. No arm was re-run.

### Comparator blob actually graded

| Where | Blob | Note |
|---|---|---|
| `7090da86:scripts/ratify1_controls/g_order_identity.py` | `e9eeb845d357fc6a0e315fe9687f30a396e9faa6` | **the graded artifact** — matches the brief exactly |
| campaign-tree HEAD `4ac819e0` + working tree | `e9eeb845…` | `git hash-object` on the working file is identical, so the file I read IS the pinned blob |
| `fb71a3ef:…/g_order_identity.py` | `56fc73a4a2d71dd4b058a368a86d266387721e2c` | pre-repair; +180/−13 lines to reach `e9eeb845` |

### Preflight (done first, per brief)

All four named paths exist; the campaign tree is `C:/Users/tonio/Projects/wt-h1-wave4-20260712` with `--git-common-dir` = `trading-forge/trading-forge/.git`. All five arm directories and their `aggregate.json` / `manifest.json` / `receipts/` (108 each) exist. **No empty result in this grade was interpreted before its target was proven to exist.**

### Evidence artifacts (sha256, first 16)

| Arm | dir | aggregate.json | manifest.json | receipts | reverse / reverse_nodes |
|---|---|---|---|---|---|
| A | `isolated-a9356283ade7` | `5e6dee1cf2bc9607` | `f1a73a7d795da4f4` | 108 | False / False |
| B | `isolated-296e5425e283` | `5bdc02d1098b93f6` | `fabd5b3a806aca42` | 108 | True / False |
| C | `isolated-2f06532fc4ed` | `074868615cf55a7a` | `5a4c37a6a1f42765` | 108 | False / True |
| D | `isolated-2f85f4d38f45` | `101d156645c770a1` | `e8d1bd579de2f87f` | 108 | True / True |
| E | `isolated-63a5b88766fe` | `933d9e2c50836362` | `1035cd53a6495381` | 108 | False / False |

---

## 1. VERDICT

| System | Band | Status | Evidence | Open risks |
|---|---|---|---|---|
| F-RATIFY1-1 repair (`e9eeb845`) | **5** | **VERIFIED** | 8 attacks + 2 harness controls + 10-pair replay via 2 non-overlapping paths | 1 CRITICAL, 3 HIGH, 1 MEDIUM, 1 LOW below |

**F-RATIFY1-1 CANNOT be closed as stated.** The named defect is genuinely fixed **on the default path** — that part is real and independently reproduced. But the *class* of defect it names ("a certification claim that is believed rather than derived") survives in three places, and one flag turns the entire repair off while still printing `[G] SATISFIED`.

Band 5 = implemented and demonstrably working on the happy path and on the exaggeration direction, but adversarial testing in the false-success direction defeats it. Not 3–4: the repair is real, T1 genuinely REDs, and four of my eight attacks were correctly refused. Not 7: a certifying invocation can still emit a false green by three independent routes.

### Claim-by-claim adjudication (AR-1006)

| # | Claim | Verdict |
|---|---|---|
| 1 | T1 (`wall_s=1.0`, receipts untouched) now goes RED, and is the ONLY verdict that catches it | **CONFIRMED** — exactly 1 FAIL line, from `[5]` |
| 2 | `[H]` is two checks: reconciliation + ceiling | **CONFIRMED** — both fire, independently |
| 3 | Five self-asserted fields rebuilt from durable child receipts | **TRUE AS WORDED, MATERIALLY INSUFFICIENT** — 2 of the 5 rebuild from the receipt's *own summary field*, so the lie moved down one layer instead of being removed |
| 4 | All 10 pairings replay at 0 differences | **CONFIRMED** — two non-overlapping paths |
| 5 | Node-axis is mandatory / fail-closed | **CONFIRMED at the argument level; FALSE in effect** — `--no-chain` skips every `[G-NODE]` verdict |
| 6 | `--red-proof` 26/26 | **CONFIRMED** — exit 0, 26 controls |
| 7 | F-RATIFY1-1 closed at the instrument | **REFUTED as unconditional** — conditional on `--no-chain` not being passed |

---

## 2. HARNESS CONTROLS (run BEFORE any attack)

A tamper harness whose reseal is unfaithful makes every attack RED for the wrong reason and manufactures false confidence.

| Control | Result | What it licenses |
|---|---|---|
| **R0** — full reseal of all 216 receipts + both manifests + both aggregates, **zero semantic change** | **GREEN, exit 0, 0 FAIL** | my reseal is faithful ⇒ every later RED is attributable to the semantic tamper, not to my rewriting |
| **R0b** — tamper one receipt, **no reseal** | **RED**, `every receipt digest RECOMPUTES  1 mismatched` | the digest layer is live and my writes land on disk |

Reseal path: receipt bytes → `manifest.entries[].receipt_sha256` → manifest bytes → `aggregate.manifest_sha256`. Every attack below hands the verifier a **perfectly sealed chain**.

---

## 3. ATTACKS AND RESULTS

Pairing `A→B`, `--mode order --pin fb71a3ef… --node-axis same`, unless noted.

| # | Attack (direction) | Expected | Result | Caught by |
|---|---|---|---|---|
| T1 | `wall_s = 1.0`, receipts untouched (down) | RED | **RED**, 1 FAIL | **NEW** `[5]` reconciliation |
| T2 | `wall_s = 700.0` (up, over ceiling) | RED | **RED**, 1 FAIL | pre-existing ceiling, now folding `max(declared, derived)` |
| D1 | real duplicate node, aggregate claims 0 | RED | **RED**, 2 FAIL | **NEW** `[1]` + pre-existing `outcomes REBUILD` |
| D4 | real subset, aggregate claims full | RED | **RED**, 3 FAIL | **NEW** `[4]` + pre-existing `missing required nodes` + `[G]` oracle |
| **D2** | **real collected-but-unexecuted, aggregate claims 0** | RED | **GREEN, exit 0, 0 FAIL** | **NOTHING** |
| **D3** | **real invalid child, aggregate claims none** | RED | **GREEN, exit 0, 0 FAIL** | **NOTHING** |
| **N1a/N1c** | **node-order evidence stripped (novel)** | RED | **GREEN, exit 0, 0 FAIL** | **NOTHING** |
| **N2** | **stale `node_sequence_sha256` (novel)** | RED | **GREEN, exit 0, 0 FAIL** | **NOTHING** |
| **N3** | **receipt contradicts its digest-bound artifact (novel)** | RED | **GREEN, exit 0, 0 FAIL** | **NOTHING** |
| **P3** | **`--no-chain` + `--pin` + `--node-axis`, forged `wall_s=1.0`** | RED | **GREEN, exit 0, `[G] SATISFIED`** | **NOTHING** |

Verified refusals on the flag surface: `--pin` without `--node-axis` → `ACCEPTANCE INSTRUMENT REFUSED`, **exit 1**. No `--pin` → `arms are bound to the CERTIFIED pin` FAILs, **exit 1**. (Both re-measured unpiped — a piped `$?` reports `tail`'s status, which misread as 0 on my first attempt.)

---

## 4. FINDINGS

### Discrepancy F-REPAIR-1: `--no-chain` turns the entire repair off and still prints `[G] SATISFIED`
**Severity:** CRITICAL (false positive)
**Claim:** "F-RATIFY1-1 is CLOSED at the instrument."
**Reality:** With `--no-chain` supplied alongside `--pin` and `--node-axis`, the T1 forgery (`wall_s = 1.0`) certifies **exit 0**. `verify_chain` never runs, so all five rebuilds vanish; and because the `[G-NODE]` block sits *inside* `if chain:`, **every node-axis verdict silently disappears** while `--node-axis same` was accepted as an argument. The run still prints `[G] SATISFIED - EXACT NODE-OUTCOME IDENTITY UNDER REORDERING`.
**Sources compared:** [repaired comparator, default path: RED | repaired comparator, `--no-chain`: **GREEN exit 0** | receipts: 377.52 s of real elapsed]
**Source of truth:** the receipts. `wall_s=1.0` is physically impossible against 108 serial children.
**Fix point:** `scripts/ratify1_controls/g_order_identity.py:1071` — the fail-closed rule keys only off `--node-axis`. `--no-chain` needs the identical treatment: `if args.pin and args.no_chain: raise SystemExit(REFUSED)`. Its own help text already says "a certifying run must never use it (F-1)" — the prohibition is documented, not enforced.
**Repro:**
```
python scripts/ratify1_controls/g_order_identity.py \
  --forward <T1_copy>/A/aggregate.json --reverse <T1_copy>/B/aggregate.json \
  --mode order --pin fb71a3efa99af94e37b94738dcdd85e92b571aea \
  --node-axis same --no-chain     # -> exit 0, "[G] SATISFIED"
```
**Blast radius:** any RATIFY-1 certification produced with `--no-chain`; the repair's own headline claim.

---

### Discrepancy F-REPAIR-2: a receipt may contradict its own digest-bound child artifact
**Severity:** CRITICAL (false positive)
**Claim:** "Every check RECOMPUTES a value and compares it to a stored one. No field is believed because it was written down." (`verify_chain` docstring)
**Reality:** The chain **opens and hashes** `acceptance-run.json` / `acceptance-run.xml` / `node-sequence.json`, but only to confirm they are the bytes the receipt *named*. **Nothing reconciles the receipt's summary against their content.** I flipped one node `failed → passed` in both arms' receipts and aggregates, left the artifacts untouched, resealed — **exit 0, GREEN**.
**Sources compared:** [receipt `outcomes`: `passed` | aggregate `outcomes`: `passed` | plugin record `failures`: **contains the node**, `n_failures=4` | JUnit XML: **`<failure>`** | artifact digest: **still matches**]
**Source of truth:** the plugin record and JUnit XML — the only artifacts written by the execution itself.
**Fix point:** `g_order_identity.py:232-236` — the loop that hashes `artifact_sha256` should also parse `acceptance-run.json` and reconcile its five disjoint outcome lists against `receipt["outcomes"]`. The digest already proves the file is authentic; the content is simply never read.
**Repro:** `scratchpad/atk2.py N3`, then `scratchpad/witness.py`.
**Blast radius:** the `[G]`/`[I]` oracle itself. Both arms can be forged consistently, so "0 differing nodes" is preserved while the certified map asserts the opposite of what the run measured. This is the deepest of the findings: it defeats the comparison the whole instrument exists to make.

---

### Discrepancy F-REPAIR-3: `collected_but_unexecuted` sums a summary instead of recomputing the runner's rule
**Severity:** HIGH (false positive)
**Claim:** "`[2] collected_but_unexecuted` REBUILDS from receipts."
**Reality:** It sums `len(r["collected_but_unexecuted"])` — the receipt's **own summary copy**. The runner's actual rule is `unexecuted = sorted(set(collected) - set(outcomes))` (`accept5_isolated_runner.py:349`), computable from primitives **in the same receipt the loop already parsed**. I appended a ghost node to `collected`, left the summary `[]` and the aggregate `0` — **GREEN**.
**Positive control:** recomputing the runner's rule on my tampered receipt yields `1` unexecuted node (`…::TestGhost::test_never_ran`); the runner would have raised a `problems` entry and invalidated the child.
**Fix point:** `g_order_identity.py:220` — replace `len(r.get("collected_but_unexecuted") or [])` with the set difference over `r["collected"]` and `r["outcomes"]`.
**Repro:** `scratchpad/atk.py D2`.
**Blast radius:** the exact defect class the runner's own comment names — "invisible to every failure list and reads as NEW=0".

---

### Discrepancy F-REPAIR-4: `invalid_children` reads `problems` instead of re-deriving invalidity
**Severity:** HIGH (false positive)
**Claim:** "`[3] invalid_children` REBUILDS from receipt problems."
**Reality:** It trusts the receipt's `problems` list. Every condition that *populates* that list is independently checkable from the receipt: `returncode ∉ (0,1)`, `n_collected != len(collected)`, outcome totals vs rebuilt count, `run_id` join. I set `returncode = 2` (which `accept5_isolated_runner.py:268` refuses outright, scoring **zero** nodes from the child) while leaving `problems = []` — **GREEN**, with the child's 51 outcomes still counted.
**Positive control:** the tampered receipt carries `returncode=2` **and** 51 scored outcomes — a state the runner cannot produce.
**Fix point:** `g_order_identity.py:221-222` — re-derive the refusal conditions rather than reading `problems`.
**Repro:** `scratchpad/atk.py D3`.

---

### Discrepancy F-REPAIR-5: the node axis is vacuously satisfiable
**Severity:** HIGH (false positive) — **novel, my own**
**Claim:** `[G-NODE] intra-file order is REVERSE across the arms — 108 shared children, 0 violating`.
**Reality:** An **empty** `node_sequence` satisfies both `a == b` and `a == list(reversed(b))`. Stripping sequences in 107 of 108 children (keeping one) still yields **exit 0**, and the guard meant to prevent exactly this — `[G-NODE] the node axis GENUINELY varied` — is `bool(varied)`, a **single global boolean** satisfied by one child. Genuine evidence shows **104** reordered children; the forged arm reports **1** and still certifies.
**Sources compared:** [genuine A/C: `104 child(ren) … of 108` | forged A/C: `1 child(ren) … of 108`, **exit 0** | verdict caption both times: `108 shared children, 0 violating`]
**Fix point:** `g_order_identity.py:541-557` — require per-child evidence: a child with `<1` recorded node contributes no proof and must be counted as unproven, and `varied` should be compared against the shared-child count, not coerced to a bool.
**Repro:** `scratchpad/atk2.py N1a` (axis `same`) and `N1c` re-run with `--mode repeat --node-axis reverse` → exit 0.
**Blast radius:** the `[G-NODE]` obligation. The caption reports 108 children of coverage while as little as one carries evidence — a 108× overstatement.

---

### Discrepancy F-REPAIR-6: `manifest.node_sequence_sha256` is written and never read
**Severity:** MEDIUM (unused anchor) — **novel, my own**
**Claim:** implicit — the manifest seals the node sequence.
**Reality:** `accept5_isolated_runner.py:474` computes and stores `node_sequence_sha256` per entry. **`grep` across the comparator returns zero reads of that field.** I resealed `receipt_sha256` while deliberately leaving `node_sequence_sha256` stale: **106 of 108 entries stale**, exit 0, GREEN. This digest is a second, independent binding that would have caught F-REPAIR-5 outright.
**Fix point:** `g_order_identity.py:197-223` — verify `node_sequence_sha256` beside `receipt_sha256`.
**Repro:** `scratchpad/atk2.py N2`.
**Note:** the 106/108 figure independently corroborates the comparator's own "108 targets, 106 governed files" comment — the 2 unaffected entries are the `empty_by_design` harness files whose sequences are legitimately empty.

---

### Discrepancy F-REPAIR-7: the `[H]` report section prints the unreconciled declared value
**Severity:** LOW (caption)
**Reality:** `report()` at `g_order_identity.py:588-592` prints `arm["wall_s"] / 60.0` only. Under T1 it prints `0.02 min   OK` **in the same output** as the `[5]` FAIL line. The gate is correct; the human-readable summary is not.
**Fix point:** `g_order_identity.py:589-591` — print the effective (reconciled) value. Fix at the emitter, not by hand-editing reports.

---

## 5. WHAT HELD (verified, not assumed)

- **T1 REDs, with exactly one FAIL line, from the new `[5]` check.** The headline claim is true on the default path.
- **Ceiling unchanged.** `CEILING_MIN = 10.0` (600.0 s) byte-identical in the pre-repair blob `56fc73a4` and the graded blob `e9eeb845`. `REQUIRED_FIELDS` unchanged.
- **Upward forgery caught**, now folding `max(declared, derived)`.
- **`[1]` duplicates and `[4]` limited-subset genuinely resist the false-success direction.** `[4]` is the strongest of the five because its authority is **external** (the runner's governed child-file map), so it is not resealable.
- **No regression on genuine evidence.** All **10/10** untouched pairings pass through the repaired comparator with **0 FAIL lines**; `--red-proof` 26/26, exit 0; R0 (full reseal, no semantic change) GREEN.
- **Execution evidence remains bound to `fb71a3ef`** — all five aggregates and all 540 child receipts carry that head, with `arm_start_head == arm_end_head` and `arm_start_tree == arm_end_tree` (`6e340b9cffb3`).
- **The frozen `cmp_*.txt` artifacts are pre-repair output** — their `[H]` lines lack the `(declared=… receipt-derived=…)` suffix, confirming they were produced by `56fc73a4` at `fb71a3ef`, not by the repaired comparator.

---

## 6. INDEPENDENT REPLAY (items 7, 8)

Rebuilt every arm's node→outcome map from each child's **JUnit XML** (`acceptance-run.xml`) — a different artifact from the `aggregate.json` the comparator reads. The comparator was never imported.

- **2419 nodes** per arm, **0 UNMAPPED** node IDs — the rebuild's own self-check. Both mapping branches exercised: 1468 `classname-exact` + 951 `classname-nested` = 2419.
- **All ten pairings: keyset identical, 0 differing nodes, 0 shared `run_id`s** (108 distinct run_ids per arm, 540 total).
- **33 stable failures**, an **identical node-ID set** across all five arms, agreeing across three paths (XML, receipts, aggregate) with 0 differences. *Not adjudicated, not compared to 287 or 31, per the brief.*
- Independently recomputed the four formerly self-asserted properties on the **untouched** evidence: duplicates `0` (from XML), collected-but-unexecuted `0` (**recomputed by the runner's own set-difference rule**, not read from the summary), invalid children `0` (no receipt with `returncode ∉ (0,1)`, none with `problems`), limited-subset `False` (0 governed files absent from 106).
- `wall_s` declared vs receipt-derived: A `377.70/377.52`, B `372.70/372.49`, C `363.20/363.05`, D `368.20/368.02`, E `367.90/367.74` — deltas `+0.15…+0.21 s`, matching the instrument's own figures exactly.

---

## 7. COVERAGE

### Paths used (two or more per load-bearing claim)
| Claim | Path A | Path B |
|---|---|---|
| 10-pair node identity | my JUnit-XML rebuild | repaired comparator over frozen aggregates |
| 33 stable failures | JUnit XML | receipts **and** aggregate (3rd path) |
| Evidence bound to `fb71a3ef` | aggregate `head` | all 540 receipts' `head_sha` + manifest `arm_start/end_head` |
| `wall_s` reconciliation | my own receipt sum | instrument's `_derived_elapsed_s` |
| Governed population | `population_successor.required_population` | manifest targets across 5 arms |
| Comparator identity | `git rev-parse 7090da86:<path>` | `git hash-object` on the working file |

### Positive-control witnesses for every absence claim
- "My reseal is faithful" → **R0** GREEN (and R0b RED proves writes land).
- "Nothing catches D2" → runner's own rule recomputes **1** unexecuted node on the same receipt.
- "Nothing catches D3" → receipt carries `returncode=2` **and** 51 scored outcomes; the runner refuses that child.
- "Nothing catches N3" → plugin record `failures` contains the node, `n_failures=4`, JUnit shows `<failure>`, **and the artifact digest still matches** — proving the chain opened and passed the very file that refutes the receipt.
- "`node_sequence_sha256` is never read" → `grep` over the comparator returns 0 hits, **and** N2 leaves 106/108 stale with exit 0.
- "The instrument can go RED" → 26/26 `--red-proof`, plus 4 of my 8 attacks correctly refused.

### Join keys checked
Exact pytest **node ID** for every identity claim (never counts). Receipt↔manifest on **ordinal**; manifest↔aggregate on **`manifest_sha256`**; receipt↔artifact on **`artifact_sha256`**; arm↔commit on **`head_sha`**; execution distinctness on **`run_id`**. Receipts were resolved by **ordinal prefix**, not by re-implementing the runner's slug rule — my first attempt at a private slug silently missed `_a_packet_harness.py`, which is exactly the "second copy of a naming rule is a second registry" trap the comparator warns about.

### What I did NOT verify
1. **I did not re-run the five arms** (frozen read-only per the brief). Every statement about *what the tests did* rests on the recorded artifacts, not on re-execution.
2. **I did not adjudicate the 33 stable failures** — not compared to 287 or 31, per the brief. I verified only that the same 33 node IDs recur in all five arms.
3. **The population authority was resolved in the campaign tree at HEAD `4ac819e0`, not at `fb71a3ef`.** It yields 2419 nodes matching every arm exactly, so it is consistent — but I did not prove the authority is identical at both commits.
4. **JUnit `time` is a weak runtime anchor.** Per-arm XML sums (247–261 s) run well below `elapsed_s` (363–378 s) because they exclude collection/import/fixture overhead. It bounds real runtime from **below** only; I did not build a tight independent runtime oracle.
5. **I did not attack `population_successor` or `accept5_isolated_runner` themselves.** Both are trusted inputs here. If the governed population can be forged, `[4]` — the strongest of the five rebuilds — falls with it. Unexamined.
6. **I did not exhaustively enumerate the reseal surface.** I demonstrated six false-green routes; I did not prove there are only six.
7. **I did not verify `--mode repeat`'s arm-relationship guard adversarially**, nor the `red_proof_chain` C1–C7 controls' internals — I ran the suite and recorded 26/26, which is a completion signal about *its* artifacts, not an audit of them.
8. **`7090da86` is unreachable from origin**, so nothing I verified about the repaired comparator is reproducible by a party who only has the public branch until it lands.

---

## 8. DISPOSITION

**F-RATIFY1-1 must NOT be closed.**

The specific forgery it names (`wall_s` believed rather than derived) **is genuinely fixed on the default path** — independently reproduced, caught by exactly one new verdict, with no regression across ten genuine pairings. That work is real.

But the finding's *class* — a certification claim believed rather than derived — is not closed:
- `--no-chain` disables the whole repair and still prints `[G] SATISFIED` (**CRITICAL**);
- 2 of the 5 "rebuilt" fields believe the receipt's own summary, so the lie moved down one layer (**HIGH ×2**);
- the node axis is vacuously satisfiable and its dedicated anti-vacuity guard is a single global bool (**HIGH**);
- an available second anchor that would have caught that is written and never read (**MEDIUM**).

**Recommended:** re-scope F-RATIFY1-1 to "declared `wall_s` is derived — CLOSED", and open a successor for the class: *every rebuild must terminate at an artifact the measured process wrote, not at a summary a later stage copied.* The pattern to enforce is the one `[4]` already demonstrates — anchor to an **external** authority, because any check whose two sides come from the same tamperable layer can be resealed into agreement.

**Not promoted, not sealed, not certified. No RATIFY-1 score issued.** Lineage: I produced the original `GRADE-RATIFY1-FINAL-2026-08-11.md`, so this grade re-examines repairs to **my own** prior findings; all bands here were re-derived from current artifacts only.
