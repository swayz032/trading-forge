# WORKER-1 REPORT — AR-1355

**Date:** 2026-08-19
**Ruling executed:** AR-1353A (`eb9ac65e`), controlling: AR-1352A (`23f5c660`)
**Grade target:** `external-advisor/gpt-engineering` @ `eb1c2959d91039033a5fe1a2cea77d440bbac73f`
**Worker-1 base:** `74a9dbfc29d9b857df60c6aaeec720de8b14d717` (confirmed ancestor of session HEAD)
**Session:** `913ac6cb-abc2-48ce-ad1f-b2c73403b269`

---

## 1. DISCLOSURE FIRST: the dispatched independent grader could not execute

Per AR-1353A / worker-execution §11c, I dispatched `accuracy-validator` (Agent tool,
`isolation:"worktree"`) with a DISPROVE mandate against the exact handoff SHA.

**Every Bash/PowerShell/Write call in that isolated agent was refused**, verbatim:

```
worker session is not armed: no armed guard session for this session id;
SessionStart never verified the resume anchor here
```

**Root cause, confirmed by reading `scripts/worker1_seat_launch.ps1`:** the guard arms a
per-session marker (`tf-claude-guard-session-<sessionId>.json`, keyed off a verified
resume-anchor match) at seat launch. An `isolation:"worktree"` agent gets a **synthetic
per-agent branch** (`worktree-agent-<id>`, confirmed: the agent's own HEAD was
`refs/heads/worktree-agent-a6aed8a663a11a458`), which cannot match the anchor the
guard checks for, so the doorway fails closed for that session id. **This is a
structural gap, not a flake: any future `isolation:"worktree"` grader dispatch will hit
the same wall.** Flagging for GPT/operator — this blocks the whole "self-dispatch the
independent grader" mechanism (0-CTRL.2 / §11c) whenever real command execution is
required, not just this once.

The blocked agent still did real work: pure Read/Grep static analysis (no execution).
Its full report is preserved below in §5 because two of its findings are real and
independently useful, even though it never reached the target commit (the branch was
never fetched in its tree either, for the same reason — `git fetch` is blocked).

**Because the grader mechanism could not execute, I (worker-1) performed the required
execution myself, in a manually pinned worktree, using my own already-armed session.**
This is not a self-grade of my own code — GPT authored the patch under grade, not me —
but it is not the independent `accuracy-validator` identity either. I am reporting the
full evidence; **GPT rules on whether this satisfies Step-12 closure.**

---

## 2. Setup — pinned worktree, not branch tip

```
git worktree add /c/Users/tonio/Projects/wt-worker1-gpt-eng-grade eb1c2959d91039033a5fe1a2cea77d440bbac73f
```
Detached HEAD confirmed at `eb1c2959`. Removed cleanly after grading
(`git worktree remove ... --force`; `git worktree list` confirms it is gone).

Diff vs Worker-1 base, scope check:
```
git diff --stat 74a9dbfc..eb1c2959
 7 files changed, 1402 insertions(+), 47 deletions(-)
```
6 of 7 are new files (GPT's proof scripts, the Factory-handoff bridge, the durable
handoff doc). The one modified production file is exactly the one under grade:
`scripts/strategy_factory_prep_provenance_inventory.py` (+93/−47 in that file). No
unrelated file touched. Scope matches the ruling's claim.

---

## 3. RED/GREEN — the three minimum blocking commands, executed for real

### Command 1 — GPT's own red proof
```
$ python scripts/_gpt_ar1354_missing_task_anchor_red_proof.py
```
Output (all 8 sub-checks `pass: true`):
```
baseline_real_artifacts_pass          pass
missing_receipt_task_sha_refused      pass  "receipt has no batch_task_sha256 to verify"
missing_task_index_refused            pass  "no batch_task_index.json exists for this unit..."
malformed_task_index_refused          pass  "batch_task_index.json unreadable/malformed: ..."
missing_index_task_sha_refused        pass  "batch_task_index.json has no task_sha256 to verify"
task_index_identity_mismatch_refused  pass  "index claims video_id='WRONG_UNIT' ... expected video_id='75DJN5UVQnw'"
missing_actual_task_refused           pass  "no batch_task.txt exists for this unit..."
mutated_actual_task_refused           pass  "batch_task.txt SHA256 MISMATCH: ..."
GREEN: locator task authority is bound and fails closed across all tested anchor attacks
EXIT=0
```
**Non-vacuous, confirmed:** it builds real fixtures under an isolated tempdir per case
(paths shown are `%TEMP%\gpt-ar1354-task-authority-*`), not against the live vault.

### Command 2 — AR-1353's own escalated attack proof (regression check)
```
$ python scripts/_ar1353_f5_escalated_attack_proof.py
{"escalated_attack_caught": true, "ok": false, "detail": "batch_task_sha256 MISMATCH: ..."}
EXIT=0
```
Stays GREEN against the new patch — no regression on the prior worker-authored control.

### Command 3 — inventory regeneration, required baseline
```
$ python scripts/strategy_factory_prep_provenance_inventory.py
{"total_units": 47, "by_backend": {"opus_batch": 42, "none": 5}, "needs_regeneration_count": 0}
EXIT=0
```
**Exact required baseline reproduced: 42 / 5 / 0.** No unit changed disposition.

---

## 4. NOVEL ATTACK — independently constructed, not copied from GPT's script

GPT's own proof (Command 1) already exercises identity-mismatch via a synthetic tempdir
fixture. To get a genuinely independent result I did not trust that script's self-report
and instead **mounted the same attack class against real committed corpus data**,
end-to-end, with a verified restore:

```python
victim = "75DJN5UVQnw__s0"   # real committed unit
donor  = "1HFoStW_wsc__s0"   # different real committed unit
# confirmed donor/victim identities differ before touching anything
shutil.copy(donor/batch_task_index.json -> victim/batch_task_index.json)
shutil.copy(donor/batch_task.txt        -> victim/batch_task.txt)
# ran the real inventory script against the live-mutated worktree
```

Result — the count **flips**, discriminating exactly as it should:
```
before: {"opus_batch": 42, "none": 5},                 needs_regeneration_count: 0
after:  {"opus_batch": 41, "gemma": 1, "none": 5},      needs_regeneration_count: 1
attacked unit locator_evidence:
  "opus_batch_receipt.json EXISTS but FAILED content validation: batch_task_index
   identity mismatch: index claims video_id='1HFoStW_wsc' strategy_index=0,
   expected video_id='75DJN5UVQnw' strategy_index=0 -- not trusted as evidence of a
   real regeneration for THIS unit"
```
Restore executed in the same script's `finally` block, then **independently
re-verified two ways**: (a) re-read the JSON and confirmed identity fields match the
original, (b) re-ran the inventory script a second time and got the clean baseline
back: `{"opus_batch": 42, "none": 5}, needs_regeneration_count: 0`.
`git status --short` in the throwaway worktree after restore showed only the
regenerated inventory-output artifact as modified — the vault source files matched
their committed originals byte-for-byte.

This is the cross-unit-substitution attack the isolated grader's static read
independently proposed as its "novel attack" (its report calls it F-3) — reading the
diff (§6 below) shows GPT's patch added the exact identity check that defeats it. This
live run is the actual execution the grader could not perform.

---

## 5. Preserved in full — the blocked grader's static findings

The dispatched `accuracy-validator` never reached the target commit (its worktree never
fetched `external-advisor/gpt-engineering` — same guard block), so it read only the
**pre-GPT Worker-1 baseline** (`scripts/strategy_factory_prep_provenance_inventory.py`
as it stood before `eb1c2959`) and reported findings against that. Two are real and
worth carrying forward regardless of who wrote what:

- **Its F-2 (methodology):** the 42/5/0 baseline check has **zero discriminating
  power** as fail-closed evidence — every one of the 42 real committed units already
  carries both a non-empty `batch_task_sha256` and a resolvable `batch_task_index.json`,
  so a validator WITH the fix and one WITHOUT it emit byte-identical inventory output
  on the untouched corpus. **42/5/0 is a regression check ("nothing broke"), never a
  fail-closed proof ("the fix works").** That claim survives independent verification
  in this report — it is a fact about the corpus, not about GPT's or my code. I am
  stating it plainly here so no future closeout leans on the preserved count as if it
  were adversarial proof; §3/§4 above are the actual fail-closed evidence.
- **Its F-4 (evidence-preservation risk, pre-existing, mine not GPT's):**
  `scripts/_ar1353_f5_escalated_attack_proof.py` (my own AR-1354/AR-1353 lane, lines
  ~39-53) overwrites a real committed `batch_raw_response.txt` with another unit's
  content and restores it as **plain sequential statements with no try/finally**. The
  unguarded `json.load` a few lines away in `_validate_receipt` (now inside GPT's own
  try/except, per §6) means an exception between the mutation and the restore could
  leave real provenance evidence corrupted. **Not touched by GPT's patch — this is a
  gap in my own prior work.** I did not fix it in this report (scope discipline: I was
  grading GPT's commit, not re-opening my own); flagging for a follow-up narrow repair
  (wrap the mutate/run/restore sequence in try/finally, same pattern GPT used for its
  own fixtures in Command 1's tempdir isolation).

Its other findings (F-3 novel-attack proposal, F-6 field-naming question, F-1/F-5
blocked-execution/global-crash observations) are **superseded by §4 and §6** — either
independently reproduced against the real target (F-3) or answered directly by reading
the actual diff (F-5, F-6). Its full raw text is preserved in the task transcript this
report's dispatch produced; not re-pasted here to avoid duplicating an already-superseded
document, per compact-AR discipline (worker-execution §11b.4).

---

## 6. Diff read — confirms the contract, plus more than was required

Read `git diff 74a9dbfc..eb1c2959 -- scripts/strategy_factory_prep_provenance_inventory.py`
directly (not paraphrased from the handoff doc). The repaired `_validate_receipt` now
chains, in order, exactly the anchors AR-1353A §2 named:

```
missing batch_task_sha256          -> FAIL  (empty string also falls under `if not claimed_task_sha`)
missing batch_task_index.json      -> FAIL
malformed/unreadable index         -> FAIL  (wrapped in try/except JSONDecodeError|OSError)
index identity != this unit        -> FAIL  <- the exact check that defeats §4's attack
missing task_index.task_sha256     -> FAIL
task-hash mismatch                 -> FAIL
ALSO: reads the unit's own batch_task.txt and re-hashes it, must equal the claimed sha -> FAIL if not
only then                          -> PASS
```
That last row is **one anchor deeper than the six-row contract in AR-1353A §2** — it
verifies the *actual* task text hashes correctly, not just that two stored hash strings
agree with each other. The success caption was also corrected to name every check that
ran (`identity + raw_response_sha256 + task-index identity + batch_task_sha256`),
closing the false-evidence-caption defect AR-1352A §4 described.

On field naming (my brief asked the grader to check for `invocation_declared` /
`invocation_attested`): confirmed in the diff —
```python
declared_invocation = receipt.get("invocation_declared", receipt.get("invocation"))
invocation_attested = receipt.get("invocation_attested", False)
```
Falls back to the legacy field rather than assuming it is gone. Closes that question.

---

## 7. GET-AHEAD BRIDGE — spot-checked, not required for Step 12

Also ran, since the pinned worktree was already set up (AR-1353A §5, lower priority):

```
$ python scripts/_gpt_factory_faithful_handoff_adversarial_proof.py
... 8/8 admission controls pass=true ...
ALL HANDOFF ADMISSION CONTROLS PASSED   EXIT=0

$ python scripts/strategy_factory_faithful_compile_handoff.py --video-id 75DJN5UVQnw --strategy-index 0 --out-dir tmp/factory-faithful-handoff-negative
{"status": "REFUSED", "reason": "FACTORY_DISPOSITION_NOT_COMPILE_READY", "detail": "current dispositions=['OTHER_MEASURED_REFUSAL']"}
EXIT=0
```
Matches AR-1353A §5's exact required negative-control result. No synthetic survivor
fabricated; real backtest survivor count remains 0, as required.

---

## 8. VERDICT (evidence, not a self-certified band)

```
PASS      : all 3 minimum blocking commands GREEN, exact 42/5/0 baseline reproduced,
            no regression on the prior worker control
PASS      : independently-constructed live cross-unit-substitution attack against real
            corpus data is caught and correctly flips disposition; restore verified twice
PASS      : get-ahead bridge admission controls + required negative control both match
            AR-1353A's stated expectations
FINDING   : the 42/5/0 count has no discriminating power on its own (methodology note,
            not a defect) -- do not cite it alone as fail-closed evidence in any future
            closeout
FINDING   : pre-existing evidence-preservation gap in my own AR-1354 proof harness
            (_ar1353_f5_escalated_attack_proof.py), not touched by GPT's patch --
            open follow-up, narrow fix
STOP      : accuracy-validator (isolation:"worktree") cannot execute anything in this
            guarded repo -- structural, will recur on every future grader dispatch
            until repaired. Reporting, not fixing (guard config is outside my
            authorized edit scope).
NEXT      : GPT rules on Step-12 closure using this evidence. I did not self-certify.
```

No production code was changed by this report. No branch other than the throwaway
pinned worktree (removed) was touched. `external-advisor/gpt-engineering` was read-only
inspected and never pushed to.
