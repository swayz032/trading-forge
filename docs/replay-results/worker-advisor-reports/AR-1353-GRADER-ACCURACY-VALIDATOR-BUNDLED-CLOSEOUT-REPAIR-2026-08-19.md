# AR-1353

RULING : AR-1350A (GPT external advisor) SS8.C -- ONE bundled independent post-fix re-grade of
         the complete repaired closeout surface: Opus batch locator driver, provenance-inventory
         receipt validation (F-2/F-3/F-4/F-5), Stage-1/Stage-2 adjudication task/response
         binding, manifest-row projection identity logic, and all required negative/mutation
         controls. Dispatched under `ratify-packet` doer != grader.
GRADER                                : accuracy-validator (independent). I did NOT author,
         design, or previously grade any of these repairs. LINEAGE DECLARATION: AR-1351 -- the
         grade whose findings F-1..F-5 these repairs answer -- was written by a *different*
         accuracy-validator dispatch. I am a fresh dispatch and re-derived every band from
         current artifacts only; where I reuse an AR-1351 number I re-measured it myself and say
         so. I did not write, and was not consulted on, any line of the repaired code.
GRADED HEAD (start)                   : `2322088ca15b80adf0ef92e6a8c6a5aea65bf80a`
GRADED HEAD (end)                     : `71c0dbc28deb3463b5116c485b316b4beb6a6ccd`
         HEAD MOVED MID-GRADE (again -- one `SYSTEM-INVENTORY: regenerate` bot commit).
         **MEASURED HERE:** `git diff --stat 2322088c 71c0dbc2 -- scripts/ src/engine/extraction/
         docs/replay-results/strategy-factory-census/` is EMPTY; the only delta across the move
         is one line of `Trading Forge System Map v2.md`. This verdict therefore describes BOTH
         commits, and the blob pins below are identical at start and end.
BLOBS PINNED (this verdict describes these exact objects, not a branch name):
         `d8c7d3bb40eb3431be8121a28477ff263f4031c7`  scripts/strategy_factory_opus_batch_locator.py
         `6902121acb9f84ac506d86e50e3bafbd7a035186`  scripts/strategy_factory_prepare_and_finalize.py
         `cf430291fe8ec77a182c54155fed742b40aa1589`  scripts/strategy_factory_prep_provenance_inventory.py
         `d4efbeead2c7cb57c5e63e438413eb68dc449a7f`  scripts/strategy_factory_manifest_row_projection.py
         `5b02c9ea0fafd2fa3dc43d2b156552c16ebd0ba8`  scripts/_ar1350a_adjudication_binding_proof.py
         `b9f817422f1919dbc24f2f63409b494d78ff527d`  scripts/_ar1350a_multistrategy_failclosed_proof.py
         `2f5b328c5e063e5bcc1c141333abebb091f1dddf`  .../extraction-vault/prep-provenance-inventory.json
         `55015cc26bddb27954abc7fb9632be9095fab511`  .../manifest-row-disposition-projection.json
         UNCHANGED since AR-1351's pins (re-verified by blob equality, not by report):
         `19cf51766d099b88af945758682934cd6e8a5b6a`  src/engine/extraction/batch_locator.py
         `d7e4573430d062388c912f83d35f3368920dab5d`  src/engine/extraction/pilot_conveyor.py
         `af71f710ee15c18b9beaea506eca3db278bd550b`  src/engine/extraction/anchor_locator.py
CHANGED SINCE AR-1351                 : locator driver `6c824ccf` -> `d8c7d3bb`, +43/-2 lines,
         two hunks only (F-2 duplicate-text refusal at emit, F-3 `newline="\n"` at two write
         sites). Full diff read. **No disguised behavior change: the reuse-not-rebuild shape is
         intact** (see V-1).
WORKTREE IDENTITY                     : linked worktree; `git rev-parse --git-common-dir` =
         `C:/Users/tonio/Projects/trading-forge/trading-forge/.git`. Every null result below is
         scoped to THIS tree and named as such (Law 10).
TREE HYGIENE                          : I mutated committed files during controls and restored
         every one by BINARY backup/restore (never `git checkout`/`reset`/`add -A`). `git status
         --short` at the end of this grade is identical to its state at the start: one
         pre-existing untracked file, `scripts/.ar1351_f1_test_scratch.py`, which is WORKER
         residue I did not create and deliberately did not delete (preserve-evidence rule). All
         six of my own grader scripts were removed; zero residue from me.

## SUMMARY: THE TWO ORDERED REPAIRS ARE REAL AND BITE. ONE CRITICAL REMAINS -- GPT'S CHAIN IS OPEN AT ITS TERMINAL LINK. BAND 6 VERIFIED OVERALL. DO NOT RERUN THE 42.

The mandate was DISPROVE. I attacked six things: that the locator diff is the point-fix it claims
rather than a behavior change; that the F-4 receipt validation can actually go red; that the
adjudication binding refuses all seven attack shapes GPT named; that the multi-strategy
fail-closed is causal rather than coincidental; that `needs_regeneration = 0` survives an
independent recompute; and that the projection's published counts are its real counts.

**All six survived** -- every one of them, measured by me, on units and by methods the worker did
not use. I did not manufacture a finding to compensate, and I want the strength of the repair on
the record: **all 7 GPT-mandated negative controls FAIL correctly and both positive controls
SUCCEED**, reproduced independently on `1HFoStW_wsc__s0` / `mNcoaNdAyIE__s0` (the worker's own
proof used `E8Wg6tFPYjo__s0` / `75DJN5UVQnw__s0` -- disjoint coverage by design).

What I broke is different, and it is load-bearing. GPT's Section 4 provenance chain ends with a
line the repair did not implement: **"finalize consumes only that bound receipt/output."** It does
not. `cmd_finalize` takes arbitrary `--stage1`/`--stage2` paths and never looks at a receipt, an
emit record, or a hash. **MEASURED HERE:** I hand-wrote a Stage-1 and Stage-2 answer file for
`1HFoStW_wsc__s0`, never ran `adjudication-emit`, never ran `adjudication-ingest`, produced no
receipt of any kind -- and `finalize` exited 0 and wrote `pilot_grade: true` over a committed
certificate whose real value is `pilot_grade: false`. The binding is genuine but **advisory**: it
guards a door that the certificate does not have to walk through. And **MEASURED HERE**, the
factory currently holds **0 stage receipts, 0 task indexes, 0 stage raw responses against 42+42
committed answer files** -- so AR-1351's original F-1 complaint ("the number deciding
`pilot_grade` has zero provenance") remains literally true of **100% of live units**.

**This does NOT invalidate the 42.** Explicitly, per GPT's standing instruction: I found no defect
that impeaches their authority or semantic outcome, and I recommend **no mass rerun** (see V-5).

---

## GRADING TABLE

| System | Band | Status | Evidence | Open risks |
|---|---|---|---|---|
| `strategy_factory_opus_batch_locator.py` -- F-2/F-3 point-fixes, reuse shape | 7 | **VERIFIED** | Full read of the +43/-2 diff vs AR-1351's pin `6c824ccf`; three mechanics blobs byte-identical to AR-1351's pins; F-2 proven RED on a real duplicate-text unit and GREEN on a clean one; F-3 proven on a fresh write (no CRLF in bytes, `sha256(disk bytes) == recorded task sha`) | F-6: 4/42 authoritative units were built under the batch shape this guard now refuses, undisclosed and unflagged |
| `strategy_factory_prep_provenance_inventory.py` -- F-4 content validation, F-5 scope line | 6 | **VERIFIED** | PC1 (the exact planted-bad AR-1351 used) now FIRES -> `gemma` / `needs_regeneration=true`; F-5 `scope` block present in the committed artifact; artifact re-runs byte-identical | F-5(new): escalated plant defeats it -- 2 of the 4 available checks implemented |
| `needs_regeneration_count = 0` | 7 | **VERIFIED** | Path A script re-run (byte-identical); Path B my own independently-written predicate over 47 units from raw disk -- 42 `opus_batch` / 5 `none` / 0 `gemma`, **AGREE** | Bounded to the published enumeration surface (now disclosed, F-5 closed) |
| Stage-1/2 `adjudication-emit`/`-ingest` **as an ingest-time guard** | 7 | **VERIFIED** | 7/7 GPT-mandated negative controls FAIL + 2/2 positive controls SUCCEED, on units the worker did not use; item-ID sets independently proven non-colliding and non-empty across all 42 packets | F-3(new) clobber; F-4(new) unbound task_index anchor |
| Stage-1/2 binding **as GPT SS4's closed provenance chain** | 4 | **UNVERIFIED -- NOT CLOSED** | Terminal link "finalize consumes only that bound receipt/output" is absent and demonstrably bypassable (F-1); element 4 "actual model/invocation identity" is DECLARED-only (F-7); 0 production units carry a receipt (F-2) | This is the one blocking closeout item |
| `strategy_factory_manifest_row_projection.py` -- multi-strategy identity | 8 | **VERIFIED** | Path A script summary vs Path B my own recompute from raw manifest+inventory: 120/102/15/3 **AGREE**; causal discrimination proven BOTH directions (collapse -> projected, split -> unresolved); zero multi-strategy leakage into the accepted set | F-8: predicate counts units not distinct indices (latent today, errs fail-closed) |
| "No unnecessary 42-unit mass rerun occurred" | 8 | **VERIFIED** | `git diff --name-only 0360a65e 71c0dbc2` over `opus-batch/` and `preps/` returns **0 files**; 42/42 committed raw responses still hash to their receipts | none |

**Overall: band 6 VERIFIED** -- happy-path plus real adversarial testing, but one CRITICAL open
defect prevents the 7-8 band. Not 7: a guard that the artifact of record is not required to pass
is not yet a control, and the chain GPT specified is open at its last link with zero production
coverage. Not lower: every ordered repair is real, non-vacuous, has a proven path to red, and
reproduced under independent method.

**CLAIMED vs VERIFIED reconciliation:** the worker's commit messages `dd126a74` / `9194b6ff` claim
"All 7 required negative controls proven FAIL ... plus 1 positive control proven PASS" and "4
controls proven". Both claims are **CORROBORATED by independent re-execution** -- I reproduced
them on different units and got the same behavior, and I found the worker's own duplicate count
(4 pairs in `h6TnE7QClJg__s0`) to be right where AR-1351's prose said 1. No band gap >1 to
reconcile at the component level. The gap is at the **closeout** level: the commit messages
describe the seam as "complete Stage-1/2 provenance binding," and it is not complete against
GPT's own written chain. That is the reconciliation this report exists to make.

---

## DISCREPANCIES

### Discrepancy F-1: the certificate hot path does not require the binding at all
**Severity:** CRITICAL (guard bypassable at the artifact of record)
**Claim:** commit `9194b6ff` -- "complete Stage-1/Stage-2 provenance binding". GPT SS4's mandated
chain terminates in "**finalize consumes only that bound receipt/output**".
**Reality:** `cmd_finalize` (blob `6902121a`, lines 415-420) opens whatever paths `--stage1` /
`--stage2` name and `json.load`s them. It never reads a `.stage{1,2}_receipt.json`, never checks
`parsed_answer_sha256`, never checks that `adjudication-emit`/`-ingest` ever ran. The docstring
says "USE THIS instead of hand-writing ... directly" -- an instruction, not an enforcement.
**MEASURED HERE**, against real committed data:
```
committed certificate pilot_grade = False | diagnosis = {"unanchored": 0, "coverage_miss": 0,
    "classification_fallthrough_unresolved": 1, "tier3_fail": 0, "lint_fail": 0, "ok": 8}

FINALIZE-BYPASS exit = 0
   fabricated-input certificate pilot_grade = True
   control_gate = {"gate_ok": 5, "context_ok": 5, "passed": true}
   diagnosis = {"unanchored": 0, "coverage_miss": 0,
                "classification_fallthrough_unresolved": 0, "tier3_fail": 0, "lint_fail": 0, "ok": 9}
   committed certificate on disk was OVERWRITTEN: True
```
The Stage-1/Stage-2 answers were written by me by hand, with the justification string
`"HAND-WRITTEN BY GRADER, NEVER ADJUDICATED"`, with no emit, no ingest and no receipt anywhere on
disk. The pipeline produced a clean `pilot_grade: true` certificate from them and overwrote the
real one. (Restored binary; `git status` clean.)
**Sources compared:** [GPT SS4 chain: finalize must consume only bound output | code at
`strategy_factory_prepare_and_finalize.py:415-420`: consumes any path | executed result:
fabricated certificate accepted]
**Source of truth:** the executed result. The chain is open at its terminal link.
**Fix point:** `scripts/strategy_factory_prepare_and_finalize.py:415-420` -- `cmd_finalize` must
default to `_adjudication_paths(...)["answers"]`, require the sibling
`.stage{1,2}_receipt.json`, and refuse unless `sha256(json.dumps(answers, sort_keys=True))`
equals the receipt's `parsed_answer_sha256` (and the receipt's packet/task hashes still verify).
An explicit `--allow-unreceipted` escape hatch, if one is wanted for the 42 historical units,
should be a named flag that stamps the certificate, not the default.
**Repro:**
```
python scripts/strategy_factory_prepare_and_finalize.py finalize 1HFoStW_wsc \
  --strategy-index 0 --stage1 <hand-written.json> --stage2 <hand-written.json>
```
with no `adjudication-emit`/`-ingest` ever run for that unit. Exit 0.
**Blast radius:** every `*.certificate.json` in the vault, therefore every
`disposition` in `manifest-row-disposition-projection.json`, therefore the V1.1 library
disposition table. The binding cannot become load-bearing until this link is closed.

### Discrepancy F-2: the binding has zero production coverage; the original F-1 gap is still open on 100% of live units
**Severity:** HIGH (mechanism exists, gap unclosed)
**Claim:** AR-1351 F-1 -- "the sole determinant of the headline number (Stage-2) is unreceipted" --
is presented as repaired.
**Reality:** **MEASURED HERE** in `.../extraction-vault/preps/`: `stage[12]_receipt.json` = **0**,
`stage[12]_task_index.json` = **0**, `stage[12]_raw_response.txt` = **0**, against
`stage1_answers.json` = **42** and `stage2_answers.json` = **42**. Every answer file that decides
`pilot_grade` today is unbound. The module docstring honestly discloses this for the historical
42 ("predate this subcommand ... keep their existing, disclosed limitation") and GPT explicitly
allowed it -- but it also instructs "USE THIS ... for every unit processed after AR-1351", and
per F-1 nothing enforces that for future units either.
**Sources compared:** [docstring: historical limitation disclosed | filesystem: 0 receipts |
`cmd_finalize`: no receipt required]
**Source of truth:** the filesystem count. The capability is built; the gap is not closed.
**Fix point:** same as F-1. Once `finalize` requires a receipt, coverage becomes measurable
instead of aspirational.
**Repro:** count the four globs above under `.../extraction-vault/preps/`.
**Blast radius:** any future reader of a certificate who infers from commit `9194b6ff` that
Stage-1/2 provenance now exists for the factory's units. It does not yet exist for any of them.

### Discrepancy F-3: a REJECTED ingest overwrites the raw response an ACCEPTED receipt attests
**Severity:** MEDIUM (audit-trail corruption on the reject path; F-3-of-AR-1351's defect class,
recurring at a new site)
**Claim:** the receipt's `raw_response_sha256` + `raw_response_path` attest a preserved artifact.
**Reality:** `cmd_adjudication_ingest` writes `paths["raw"]` at line 312 -- **before** the
item-ID-set check, the taxonomy check, and the JSON-shape check. Those checks return early
without touching the receipt or answers. So a rejected response silently replaces the accepted
one's preserved bytes while the receipt keeps pointing at them. **MEASURED HERE** on
`1HFoStW_wsc__s0` stage 1 (clean ingest, then a cross-unit ingest that correctly returned
`ITEM_ID_SET_MISMATCH`, exit 1):
```
[N1] rejected-ingest exit=1 status=ITEM_ID_SET_MISMATCH
    receipt.raw_response_sha256 = 3a9f6cfafae826f6...
    actual file now hashes to    = 1d02f838021e56f5...
    RECEIPT ATTESTS ITS NAMED FILE: False
```
**Sources compared:** [receipt `raw_response_sha256` | on-disk bytes after the failed run | the
accepted response's own hash]
**Source of truth:** the on-disk bytes; the receipt is stale and the file it names is a rejected
response, not the adjudicated one.
**Fix point:** `scripts/strategy_factory_prepare_and_finalize.py:312` -- write the preserved raw
to a rejected-quarantine path (`.stage{N}_raw_rejected_<sha>.txt`) on any non-zero return, or
defer the canonical write until after validation. "Raw is sacred" is right; overwriting the
sacred copy with an unaccepted one is not.
**Repro:** clean ingest, then re-ingest a foreign unit's response for the same unit/stage; compare
`sha256` of `<unit>.stage1_raw_response.txt` against the untouched `<unit>.stage1_receipt.json`.
**Blast radius:** any auditor re-verifying a stage receipt after a failed retry -- a benign
operator retry produces evidence indistinguishable from tampering. Zero live exposure today only
because F-2 means no stage receipts exist yet.

### Discrepancy F-4: `expected_item_ids_sha256` is recorded but never verified -- the task_index is an unbound anchor
**Severity:** MEDIUM (the binding's own root of trust is unprotected)
**Claim:** ingest docstring -- the response "must answer EXACTLY this unit's item set, derived
from THIS unit's own packet, hashed at emission time."
**Reality:** the packet hash and the task hash are re-derived and compared at ingest (both
genuinely bite -- I proved it). The **expected item-ID set is not**: line 333 reads
`task_index["expected_item_ids"]` as trusted input, and the sibling
`expected_item_ids_sha256` is copied into the receipt at line 373 **without ever being
recomputed or compared**. So the set is *not* derived from the hash-verified packet at ingest
time; it is read from an unverified list. **MEASURED HERE** -- I edited only
`1HFoStW_wsc__s0.stage1_task_index.json`'s `expected_item_ids` (dropped one id), left
`expected_item_ids_sha256` stale, and ingested a response missing that id:
```
[N2] tampered-index ingest exit=0 status=INGESTED
    receipt carries expected_item_ids_sha256=8c4bade44fd09eaf3b39
    sha256 of the set ACTUALLY enforced    =7988a105fa85a52c9ba5
```
The receipt asserts a set-hash that is **not** the set that was enforced. The identical control
run against the *packet* file (`C2`) and the *task* file (`C3`) both correctly refuse -- the
index is the one link with no self-check.
**Sources compared:** [`expected_item_ids_sha256` in the receipt | sha256 of the list actually
enforced | the packet, which is hash-verified and could have re-derived it]
**Source of truth:** the enforced set. The receipt's third hash is decorative under tampering.
**Fix point:** `scripts/strategy_factory_prepare_and_finalize.py:333` -- either (a) recompute
`sha256(json.dumps(sorted(task_index["expected_item_ids"])))` and refuse on mismatch, or better
(b) re-derive `expected_item_ids` from the already-hash-verified packet exactly as
`cmd_adjudication_emit` does, and treat the index's copy as advisory. (b) removes the unbound
anchor entirely.
**Repro:** edit `expected_item_ids` in a `.stage1_task_index.json`, leave the sha field, ingest a
correspondingly-trimmed response -> exit 0.
**Blast radius:** the strength of the whole F-1 repair. Everything else in the chain re-derives
from a hashed artifact; this one trusts a file on disk.

### Discrepancy F-5: inventory receipt validation implements 2 of the 4 available checks; an escalated plant defeats it
**Severity:** MEDIUM (detector still has a reachable blind spot -- narrower than AR-1351's, not gone)
**Claim:** inventory docstring -- receipts are now validated "against the unit it is being read
for, not merely its presence"; commit `0b249a9e` closes AR-1351 F-4.
**Reality:** the fix is REAL and I confirmed its path to red -- **PC1, the exact planted-bad
AR-1351 used, now FIRES**:
```
PC1 (verbatim receipt A copied over B): gemma | needs_regeneration= True
   evidence: opus_batch_receipt.json EXISTS but FAILED content validation: receipt identity
   mismatch: file claims video_id='1HFoStW_wsc' strategy_index=0, but lives at the path for
   video_id='mNcoaNdAyIE' ...
```
But `_validate_receipt` performs only the identity check and the raw-hash check. AR-1351's fix
point also named the **task-sha join**, and the receipt carries `batch_task_sha256` while every
unit carries its own `batch_task_index.json` -- the discriminator exists and is unused.
**MEASURED HERE**, escalating the plant by one step (rewrite the two identity fields, and copy
unit A's raw response into unit B's batch directory):
```
PC2 (receipt A relabelled to B + A's raw response copied into B's dir): opus_batch |
   needs_regeneration= False
   evidence: ... AND CONTENT-VALIDATED (AR-1351 F-4): identity + raw_response_sha256 ... verified
   receipt.batch_task_sha256              = 2c4905f770a559f827085e1ccd668691a9099e6c883299f1...
   B's own batch_task_index task sha      = e7b8ac70cf95ef3b895d9f9e6189ad76faffcc2bdea0ce8d...
```
Unit B is credited `opus_batch`, `needs_regeneration=false`, on unit A's adjudication -- and the
two task hashes that would have caught it sit unread in the same directory.
**Sources compared:** [inventory verdict: `opus_batch` | receipt `batch_task_sha256` | B's own
`batch_task_index.json` task sha]
**Source of truth:** the task-sha disagreement. The receipt describes A's batch, not B's.
**Fix point:** `scripts/strategy_factory_prep_provenance_inventory.py:89-106` -- add
`receipt["batch_task_sha256"] == json.load(<unit>/batch_task_index.json)["task_sha256"]`, and
assert `receipt["raw_response_path"]` resolves to the file actually hashed.
**Repro:** the PC2 sequence above; restore binary afterwards.
**Blast radius:** the `needs_regeneration_count: 0` headline. Currently **true** -- I confirmed it
through a second, independently-written path -- but as with AR-1351 F-4, still not true *because*
the inventory established it beyond a one-step forgery.

### Discrepancy F-6: the driver now refuses a batch shape 4 of its own 42 authoritative units were built under -- undisclosed and unflagged
**Severity:** MEDIUM (unbounded absence claim; Law 9)
**Claim:** commit `0b249a9e` / AR-1352 line 31 -- F-2 is repaired; `emit h6TnE7QClJg` now refuses.
The 42 units remain `needs_regeneration=false`.
**Reality:** the refusal is correct and I proved both halves. But **MEASURED HERE via two
non-overlapping paths** (the committed `batch_task_index.json` `conditions` blocks, and a live
re-derivation through `pilot_conveyor.extract_spine_condition_texts` from the vault records --
the two agree exactly on the unit set and on every condition_text sequence), **4 of the 42
committed units carry duplicate `condition_text`**:
```
KXWRtV2LOVc__s0: 1 pair -- targets[0].rationale == targets[1].rationale
N7SM8a7Dc9s__s0: 1 pair -- entry_sequence[0].rationale == confluences[0].description
UBvfsImdI2U__s0: 1 pair -- targets[0].rationale == targets[1].rationale
h6TnE7QClJg__s0: 4 pairs -- entry_sequence[0].rationale == entry_sequence[3].rationale, ...
F-2 PATH TO RED -- real emit on duplicate-text unit KXWRtV2LOVc__s0: exit=1
   status=DUPLICATE_CONDITION_TEXT_REFUSED  duplicates_reported=1
```
(The worker's claim of 4 pairs in `h6TnE7QClJg__s0`, against AR-1351's prose "1", is **confirmed
correct** by my independent count.) The driver now declares this batch shape one it "cannot
safely verify" -- yet all 4 units remain `locator_backend=opus_batch`,
`needs_regeneration=false`, and **12 accepted manifest rows** rest on them
(`OTHER_MEASURED_REFUSAL`), with **0** of them in the 15-row identity-unresolved set. No report,
inventory field, or projection field names this class.
**Sources compared:** [driver: this shape is unverifiable -> refuse | inventory: these 4 units
need no regeneration | projection: 12 rows accepted from them]
**Source of truth:** all three are internally consistent; what is missing is the disclosure that
connects them.
**Severity is bounded DOWN, honestly:** when two conditions share *identical text*, a
misattribution swaps which `condition_ref` owns an anchor, but the located quote is by
construction equally valid for both texts. The exposure is ref-level attribution, not quote
correctness -- and AR-1351 independently semantically re-derived the grounding. **This is not
grounds for a rerun.**
**Fix point:** emit a `duplicate_condition_text: true` field on those 4 units in
`prep-provenance-inventory.json`, and one disclosure line in the projection artifact. Under
CLAUDE.md SS11c (zero carry-forwards) this closes in the same wave; it is a disclosure emission,
not a rerun.
**Repro:** the two-path census above, then
`python scripts/strategy_factory_opus_batch_locator.py emit KXWRtV2LOVc --strategy-index 0`.
**Blast radius:** 12 of 102 accepted manifest rows carry an undisclosed provenance caveat.

### Discrepancy F-7: `invocation` is a hardcoded caption asserting a dispatch topology the script never observed
**Severity:** LOW (caption grading -- Law 12; honestly disclosed in code, not in the artifact)
**Claim:** GPT SS8.A element 4 -- the receipt must bind "actual model/backend/invocation identity".
**Reality:** `strategy_factory_prepare_and_finalize.py:380-384` writes
`"model_declared": model_declared` (argparse default `"opus"`) and an f-string
`"Agent tool, subagent_type=general-purpose, model override={model_declared}, given the stage
task text as its prompt"` -- a constant template emitted regardless of what actually ran. The
ingest docstring is commendably explicit that this is "a DECLARED identity, not independently
attested", and I accept that the harness exposes no per-call model witness. But the **receipt
JSON itself** carries no such marker: a future auditor reading only the receipt sees a confident
statement of invocation topology with nothing behind it.
**Source of truth:** the code. Element 4 of GPT's chain is DECLARED, not ACTUAL, and cannot
currently be otherwise.
**Fix point:** rename to `invocation_declared`, or add
`"invocation_attested": false, "attestation_limit": "harness exposes no per-call model witness"`
to the receipt body so the limitation travels with the artifact.
**Blast radius:** reader inference only. No measurement depends on it.

### Discrepancy F-8: the multi-strategy predicate counts UNITS, not distinct strategy indices
**Severity:** LOW (latent; errs fail-closed)
**Claim:** the projection docstring/reason string -- "for any video with MORE THAN ONE
strategy_index unit"; the emitted reason says "this video now has N modern strategy indices".
**Reality:** `strategy_factory_manifest_row_projection.py:95-98` builds a **list** and tests
`len(idxs) > 1`. Two inventory rows sharing the same `strategy_index` would trip it.
**MEASURED HERE:** no such duplication exists today (`distinct-index set == unit-count set: True`
across the current inventory), so the live number is right. My C-3 control confirms the
sensitivity is real: duplicating unit `1HFoStW_wsc__s0` at index 0 wrongly moved that video to
`IDENTITY_MATERIALIZATION_UNRESOLVED`. Direction of error is fail-CLOSED (over-refusal), which is
the correct direction, so this is precision, not safety.
**Fix point:** `:98` -- `len(set(idxs)) > 1`.
**Blast radius:** none today; a future duplicate inventory row would over-refuse rows and produce
a reason string with a wrong index count.

### Note N-1 (not a finding): `STAGE_IDENTITY_MISMATCH` has a very narrow path to red, but the attack it names is caught anyway
Paths are stage-parameterized (`_adjudication_paths(..., stage)`), so calling `--stage 2` reads
the stage-2 index, whose `stage` field is 2 -- the check at `:271` cannot fire from an operator
passing the wrong `--stage`. **MEASURED HERE**, I confirmed it is reachable only by hand-editing
the index (`C6c` -> `STAGE_IDENTITY_MISMATCH`, exit 1), **and** that the real attack is refused
regardless: with both stages emitted, a stage-1 response ingested under `--stage 2` returns
`ITEM_ID_SET_MISMATCH` exit 1, and stage-2-under-`--stage 1` likewise. Recording it under Law 5
for completeness; the requirement is met, by a different check than the one named.

---

## WHAT SURVIVED THE ATTACK (the disprove attempts that failed)

**V-1. "The locator diff is a point-fix, not a disguised behavior change"** -- UPHELD, MEASURED
HERE. Full read of `git diff 6c824ccf d8c7d3bb`: +43/-2, two hunks, both exactly the F-2 refusal
and the F-3 `newline="\n"`. The three mechanics modules are **byte-identical** to AR-1351's pinned
blobs (`19cf5176`, `d7e45734`, `af71f710`) -- re-verified by blob equality, not by trusting the
prior report. `grep -nE "_verify_and_locate|def verify|substring|\.find\(|re\.search|ollama|
requests|http"` over the current driver matches **one docstring line and nothing else**:
verification authority still lives in `anchor_locator`, and the driver still makes no network
call and reimplements no mechanics.

**V-2. All 7 GPT-mandated negative controls + 2 positive controls, independently reproduced on
units the worker did not use.** MEASURED HERE, unit A = `1HFoStW_wsc__s0`, unit B =
`mNcoaNdAyIE__s0` (worker used `E8Wg6tFPYjo__s0` / `75DJN5UVQnw__s0`):
```
[PASS] C0  positive: clean stage-1 ingest (unit A)      expect=SUCCEED exit=0 status=INGESTED answer_count=19
[PASS] C0b positive: clean stage-2 ingest (unit A)      expect=SUCCEED exit=0 status=INGESTED answer_count=9
[PASS] C1  cross-unit: B's real stage-1 answer AS A     expect=FAIL exit=1 status=ITEM_ID_SET_MISMATCH missing=9 extra=16
[PASS] C2  packet mutated between emit and ingest       expect=FAIL exit=1 status=PACKET_MUTATED_SINCE_EMIT
[PASS] C3  task text mutated between emit and ingest    expect=FAIL exit=1 status=TASK_MUTATED_SINCE_EMIT
[PASS] C4  response missing one expected item id        expect=FAIL exit=1 status=ITEM_ID_SET_MISMATCH missing=['1HFoStW_wsc-S0-B000']
[PASS] C5  response with one extra/unexpected item id   expect=FAIL exit=1 status=ITEM_ID_SET_MISMATCH extra=['GRADER-INJECTED-EXTRA-ID']
[PASS] C6  stage-1 response under --stage 2 (both emitted) expect=FAIL exit=1 status=ITEM_ID_SET_MISMATCH
[PASS] C6b stage-2 response under --stage 1             expect=FAIL exit=1 status=ITEM_ID_SET_MISMATCH
[PASS] C6c STAGE_IDENTITY_MISMATCH reachability         expect=FAIL exit=1 status=STAGE_IDENTITY_MISMATCH
```
The guard is not "permanently refusing everything": two positive controls, at both stages, ingest
cleanly and write receipts.

**V-3. "Cross-unit ingest is caught by item-set equality" is non-vacuous for this population** --
UPHELD, MEASURED HERE, and this is the load-bearing precondition nobody had checked. The docstring
argues cross-unit contamination fails "automatically" because item_ids are video-prefixed. That
argument breaks if any packet has an EMPTY Set-B (leaving only the shared `W1-000x` controls,
identical across units) or if two packets share an id set. I enumerated all 42 packets: **zero**
units with an empty Set-B or empty stage-2 item list, and **zero** pairs sharing an identical
Set-B id set. The mechanism holds -- but it holds *because of a measured property of this corpus*,
not by construction, and it should be re-checked whenever the corpus grows.

**V-4. `needs_regeneration = 0`** -- UPHELD through two non-overlapping paths. Path A: re-ran the
inventory script; output byte-identical to the committed artifact. Path B: I wrote my own
predicate and re-derived every unit from raw disk (vault records -> strategy count -> prep pkl ->
receipt identity + LF-normalized raw hash), never calling the graded script:
`{'opus_batch': 42, 'gemma': 0, 'none': 5, 'unknown_no_prep': 0}, needs: 0` -- **AGREE** with the
script's `{"total_units": 47, "by_backend": {"opus_batch": 42, "none": 5},
"needs_regeneration_count": 0}`. The F-5 `scope` block is present in the committed artifact.

**V-5. "No unnecessary 42-unit mass rerun occurred"** -- UPHELD, MEASURED HERE.
`git diff --name-only 0360a65e 71c0dbc2` over `.../extraction-vault/opus-batch/` and
`.../extraction-vault/preps/` returns **0 files** -- nothing under either tree has changed since
the commit AR-1351 graded. Independently, all 42 committed raw responses still hash to their
receipts. **I found no defect that invalidates the 42's authority or semantic outcome, and I
recommend no rerun**, consistent with GPT's standing instruction.

**V-6. F-3 (CRLF) is genuinely fixed at the write sites, and the historical evidence was never
corrupt** -- UPHELD, MEASURED HERE. A fresh `emit` writes `batch_task.txt` with **no CRLF in the
on-disk bytes** and `sha256(raw disk bytes) == recorded task sha` -> **True**. On the 42
historical raw responses: naive worktree-bytes hash matches **12/42**, LF-normalized **42/42**,
committed **blob 42/42**. Exactly AR-1351's picture; the canonical committed evidence is clean and
new writes no longer need the normalization step.

**V-7. The multi-strategy fail-closed is CAUSAL, not coincidental** -- UPHELD, MEASURED HERE. The
5 multi-strategy videos (`7ieYBa7Z-Hg`[0,1], `VTEQ2fhGLqE`[0,1,2], `deymRD3kSD0`[0,1],
`gddYspvW0_w`[0,1], `ktkqq7QsN9Q`[0,1,2,3]) account for all 15 identity-unresolved rows; 34
single-strategy videos supply 102 accepted rows; **leakage check -- multi-strategy videos in the
accepted set: NONE**. Causal discrimination in **both** directions, by feeding the projection
module synthetic inventories (the real inventory file was never mutated):
```
C-1 COLLAPSE 7ieYBa7Z-Hg to a single index: still identity-unresolved? False | now projected? True
C-2 SPLIT   1HFoStW_wsc into indices [0,1]: now identity-unresolved? True  | still projected? False
            all other rows unchanged? True
```
The exclusion tracks the index count and nothing else.

**V-8. The projection's published counts are its real counts** -- UPHELD. Path A (script summary)
vs Path B (my own recompute from `library-manifest-v1.1.json` + `prep-provenance-inventory.json`,
re-parsing the `spec_video:` tags myself): `total=120, projected=102, identity_unresolved=15,
out_of_scope=3` -- **AGREE** on all four. `multi_strategy_videos_failed_closed: 5` also checks
out: all 5 multi-strategy videos do carry manifest rows, so the field does not overstate. The
artifact re-runs byte-identical to the committed copy. **Explicit count GPT asked for: 102
crosswalked single-strategy rows vs 15 fail-closed multi-strategy rows, 3 out-of-scope, 120
total.**

---

## COVERAGE ENUMERATION (a clean report is trusted only if it bounds itself)

### 1. What I verified, and via which two-plus non-overlapping paths

| Claim | Path A | Path B | Path C |
|---|---|---|---|
| Locator diff is a point-fix only | full read of `git diff 6c824ccf..d8c7d3bb` | mechanics blob equality vs AR-1351's 3 pins | grep for verification/network logic in the current blob |
| F-2 refusal is real | live `emit` on real duplicate unit -> exit 1 | live `emit` on clean unit -> exit 0 EMITTED | two-path duplicate census (committed index vs live re-derivation) agreeing |
| F-3 fixed | fresh-write on-disk bytes carry no CRLF | `sha256(disk bytes) == recorded sha` on that fresh write | 42 historical: naive 12/42, LF 42/42, blob 42/42 |
| Adjudication binding bites | 7 negative + 2 positive controls, my units | packet/task/index files each mutated separately | id-set collision/emptiness census over all 42 packets |
| F-4 inventory validation bites | PC1 planted receipt -> `gemma`/needs_regen | PC2 escalated plant -> still `opus_batch` (bound) | code read of `_validate_receipt` predicate |
| `needs_regeneration = 0` | script re-run byte-identical | my own independently-written recompute over 47 units | committed artifact `scope` block read |
| Projection counts | script's own summary | my recompute from raw manifest + inventory | artifact re-run byte-identical |
| Multi-strategy fail-closed is causal | collapse control (-> projected) | split control (-> unresolved) | leakage check over the accepted row set |
| No mass rerun | `git diff --name-only 0360a65e..71c0dbc2` over both trees = 0 | 42/42 receipt-vs-raw hashes still match | opus-batch `git diff --stat` empty |
| Graded surface stable across HEAD move | `git diff --stat` over graded paths = empty | blob pins re-derived at end, identical | full-repo delta = 1 line of the System Map |
| `finalize` bypass (F-1) | executed the bypass, got `pilot_grade: true` | read the executable lines `:415-420` | grep of all reports for any disclosure -> none |

### 2. Positive-control witnesses for every absence claim I make

| My absence claim | Planted known-bad | Result |
|---|---|---|
| "the adjudication guard refuses cross-unit / mutated / malformed input" | 7 distinct planted-bads (foreign response, mutated packet, mutated task, missing id, extra id, wrong stage x2, hand-edited index) | **9/9 refused, exit 1, with distinct status codes** |
| "the guard is not just refusing everything" | 2 clean, correctly-scoped responses (stage 1 + stage 2) | **both INGESTED, exit 0** |
| "the inventory can now go red" | receipt A copied verbatim into unit B | **FIRED** -> `gemma`, `needs_regeneration=true` |
| "the inventory still has a blind spot" | receipt A relabelled to B + A's raw copied into B's dir | **NOT detected** -> still `opus_batch` (the finding is the witness) |
| "4/42 units carry duplicate condition_text" | my census predicate run against a synthetic `[R1:'same', R2:'other', R3:'same']` probe | **FIRES**. This control exists because my FIRST census returned a **false null of 0/42** -- I had read a `spine_conditions` key that does not exist on the prep pkl. Law 2 caught my own error before it reached this report; I then re-derived through two real sources that agree. |
| "the multi-strategy exclusion is causal" | collapse a real multi to single; split a real single to multi; duplicate an index | **all three flipped the classification as predicted** |
| "`finalize` requires no binding" | hand-written, never-adjudicated answers | **accepted, exit 0, fabricated `pilot_grade: true`** |

### 3. Join keys checked for every "identical / unchanged / matches" claim

- Mechanics unchanged: **git blob SHA** (`19cf5176`/`d7e45734`/`af71f710`), not mtime, not report.
- Graded surface stable across the HEAD move: **path-scoped `git diff` + blob re-derivation** at both ends.
- 42 raw responses attest their receipts: **`raw_response_sha256` vs sha256 of (worktree bytes | LF-normalized bytes | `git show HEAD:<path>` blob bytes)** -- three renderings, stated separately.
- Inventory Path A vs Path B: joined on **(`video_id`, `strategy_index`)**.
- Projection Path A vs Path B: joined on the manifest row's **`spec_video:` tag**, re-parsed by me from the raw tags array.
- No mass rerun: **`git diff --name-only` between commit `0360a65e` (AR-1351's end pin) and `71c0dbc2`** over both artifact trees.
- Duplicate-text census: joined on **`condition_ref`** across the committed `batch_task_index.json` and the live `extract_spine_condition_texts` re-derivation.
- Artifact reproducibility: **byte equality** of the regenerated file against the committed copy, not field-by-field comparison.

### 4. What I did NOT verify, and why

1. **The semantic content of the 42 Opus certificates.** Out of scope by explicit instruction (AR-1351 covered it; GPT forbade repeating it). I re-verified their *provenance hashes* and *immutability*, not their *meaning*.
2. **The Gemma-vs-Opus locator-authority question.** Closed by AR-1234/AR-1345A; not reopened.
3. **`model_declared` / `invocation` as ACTUAL identity.** Unverifiable from this harness by design -- there is no per-call model witness. This is F-7 and it is a genuine, permanent bound on element 4 of GPT's chain, not something I ran out of time for.
4. **GitHub Actions / workflow state at `71c0dbc2`.** `gh run list --branch claude/worker1-h1-20260815` returned **no rows**. I cannot confirm CI green or red at this SHA; GPT's SS8.C deliverable "GitHub status/workflow state at the exact SHA" is therefore **unmet by evidence available to me** and remains the worker's to supply.
5. **The three CI hard gates** (`check:production-isolation`, `check:2026-compliance`, `system-map:check`). Not run -- none of the graded files touch production/compliance surfaces, but I did not execute them and do not claim them green.
6. **Whether the 42 units' Stage-1/Stage-2 answers are semantically correct.** They are unreceipted (F-2) and no raw dispatch text survives for them; that limitation is disclosed and accepted, and independent semantic corroboration is AR-1351's, not mine. Un-reproducible by construction.
7. **`_ar1350a_multistrategy_failclosed_proof.py`.** Read as context, not executed -- I built my own projection controls instead precisely so my result would not reproduce the worker's instrument.
8. **Any population outside this tree.** All null results are scoped to the linked worktree at `C:/Users/tonio/Projects/wt-claude-worker1-20260815` (`--git-common-dir` = `C:/Users/tonio/Projects/trading-forge/trading-forge/.git`). I did not sweep other checkouts.
9. **Uncertainty bound on the coverage claims:** "7/7 controls bite" is measured on **2 of 42 units** (~4.8%) for the adjudication seam and on **1 planted pair** for the inventory. Zero failures on that sample bounds the per-unit failure rate at roughly **≤ ~78% @95%** for 2 units -- i.e. the control results prove the *mechanism* works, and are **not** a coverage claim over the corpus. The corpus-wide claims (42-packet id-set census, 42 receipt hashes, 120 manifest rows, 47 inventory units) are full-population and stated as such.
10. **`scripts/.ar1351_f1_test_scratch.py`** -- pre-existing untracked worker residue referencing a `TESTVIDEO` fixture. I did not execute, modify, or delete it. It contradicts commit `9194b6ff`'s "zero residue after cleanup" claim in the trivial sense that an earlier scratch file survives in the tree; I record it as an observation, not a finding.

---

## VERDICT AGAINST GPT AR-1350A SS8

| Ordered action | Status | Basis |
|---|---|---|
| **A. Finish Stage-1/Stage-2 provenance binding** | **NOT CLOSED** | 8 of GPT's 10 binding elements are present and enforced; element 4 (actual model/invocation) is declared-only and unattestable (F-7); the chain's terminal line "finalize consumes only that bound receipt/output" is **absent and demonstrably bypassable** (F-1), with 0 production units bound (F-2). All 7 mandated negative controls DO bite (V-2). |
| **B. Repair multi-strategy manifest projection** | **CLOSED** | Fail-closed is real, causal in both directions, leak-free, and its published counts reproduce under an independent recompute (V-7, V-8). One LOW precision defect (F-8), fail-closed in direction. |
| **C. One bundled independent post-fix re-grade** | **DELIVERED** | This document. Single grade, all five surfaces, all mandated controls executed by me. |

**Step 12 should NOT close on this SHA.** One CRITICAL (F-1) plus its scope consequence (F-2)
stand between the current state and the chain GPT specified. Both are narrow: F-1 is a
receipt-requirement in `cmd_finalize`; F-3/F-4/F-5/F-6/F-8 are each a few lines at named fix
points, and under CLAUDE.md SS11c none of them may be carried forward. **Neither F-1 nor anything
else I found justifies rerunning the 42 Opus units, and I recommend explicitly against it.**

---

**Grader:** accuracy-validator (independent; no authorship lineage in any graded artifact)
**Verdict SHA:** describes blobs pinned in the header at `2322088c`..`71c0dbc2` (graded surface
byte-identical across both)
**Tree state at completion:** identical to tree state at commencement; all mutations restored by
binary backup; zero grader residue.
