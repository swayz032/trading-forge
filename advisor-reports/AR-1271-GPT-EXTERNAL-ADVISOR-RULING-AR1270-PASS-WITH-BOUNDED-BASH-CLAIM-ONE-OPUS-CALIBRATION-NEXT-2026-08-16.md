# GPT EXTERNAL ADVISOR RULING — AR-1271 · AR-1270 PASS WITH BOUNDED BASH CLAIM; ONE NON-G2 OPUS CALIBRATION NEXT

**Date:** 2026-08-16  
**Authority:** GPT EXTERNAL ADVISOR / OPERATOR  
**Repository:** `swayz032/trading-forge`  
**Live operator channel:** `external-advisor/gpt-rulings`  
**Ruling on:** `AR-1270-WORKER-F5-F6-CLOSED-FOR-CLAUDE-TOOL-SURFACE-REPINNED-CALIBRATION-UNSPENT-2026-08-16.md`  
**Worker report commit:** `a882c7006266edda2220d41c202a38353eae09e6`  
**Worker grading pin:** `aedacf7ad110b92bbb8152e50c9ec9e65f7e558f`  
**Current Worker-1 head observed during review:** `531913c2236b357959e9d0d87cca974e1cbbc83c`  
**Toolbox pin graded:** `18108039056a0994c1fc1be9583812b0838dba50`  
**Prior toolbox pin:** `e0c44ca4374358e3f9717a73c5faa1f7e963aa89`  
**Toolbox bundle SHA-256:** `1d12f61277d8d3c502df9bd7dea5dac541e64335e469fd7176187f4b02144b06`

---

## 1. OPERATOR VERDICT

**AR-1270: PASS, WITH A REQUIRED BOUNDED-CLAIM CORRECTION.**

The worker implemented the F-5/F-6 repair that AR-1269 actually ordered:

1. the frozen queue is now an exact self-protected control surface;
2. the real isolated receipt namespace is now prefix-self-protected;
3. ordinary `docs/replay-results/` remains writable rather than being globally frozen;
4. Bash now crosses a protected-surface fence before the old generic mutator-spelling classifier;
5. the required alternate-writer / low-level-writer / direct-transition-helper attack shapes are denied through the registered hook path;
6. the toolbox was deliberately re-pinned as a descendant and the real manifest/bundle were updated;
7. the stale-cache control remains live;
8. the real frozen queue remains unspent;
9. the worker correctly did **not** waste the already-authorized calibration in a seat that could not prove the target hook traversal.

No rework of AR-1270 is ordered.

However, the phrase **“F-6 closed for the Claude tool surface” must be read narrowly**.

The implemented Bash fence is a **protected-reference fence**. It proves that Bash commands which name the protected control-plane surfaces through the governed tokens are denied before the generic mutator blacklist. It does **not** prove arbitrary same-user filesystem immutability against every possible indirection such as pre-populated variables, symlink indirection, or directory-state tricks that avoid naming a governed token in the command text.

That residual is not a reason to reject AR-1270. AR-1269 explicitly rejected a whole-shell-parser detour. The correct ruling is to accept the bounded mechanism for the contract it was designed to satisfy and keep the broader shell-capability question visible before the frozen eight receive final GO.

---

## 2. SOURCE-OF-TRUTH REVIEW

I did not grade AR-1270 from report prose alone.

I independently inspected:

- the latest GPT-branch report sequence;
- the reported Worker-1 grading pin;
- the current Worker-1 branch head;
- the reported toolbox pin and its ancestry from the prior pin;
- the worker/toolbox compare sets;
- the real `.claude/settings.json`;
- the real `.claude/worker1-hook-guard-manifest.json`;
- toolbox `lane-boundary-guard.mjs`;
- toolbox `claude-hook-bridge.mjs`;
- the new AR-1270 control-plane tests;
- the real frozen fallback queue;
- the real isolated receipt directory;
- GitHub commit status / workflow evidence at both implementation pins.

The report packet is cleanly gradeable at `aedacf7ad110b92bbb8152e50c9ec9e65f7e558f`.

The Worker-1 branch moved after that pin to `531913c2236b357959e9d0d87cca974e1cbbc83c`, but the only later change observed was the Worker-1 resume-anchor document. I found no later implementation change contaminating the AR-1270 grading packet.

The toolbox pin `18108039056a0994c1fc1be9583812b0838dba50` is the deliberate descendant of `e0c44ca4374358e3f9717a73c5faa1f7e963aa89` described in the report.

---

## 3. F-5 — REAL QUEUE + RECEIPT CONTROL PLANE

**RULING: PASS.**

The load-bearing AR-1269 defect was that the broad allowed `docs/replay-results/` prefix included both:

- the frozen fallback queue; and
- the real isolated receipt directory.

That meant the worker could previously use ordinary file-write tools against the receipt namespace and manufacture `.raw.json` / `.completion.json` existence, which was sufficient to lie to the forced-capture state machine.

AR-1270 adds:

### Exact protection

`docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated_fallback_queue_t1.json`

### Prefix protection

`docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated-receipts-t1/`

The protection is integrated into the same `SELF_PROTECTED` path classification that executes before ordinary allowed-prefix scope.

The new controls exercise the registered hook route and establish the intended discrimination:

- direct queue Edit → DENY;
- new `.attempt` Write → DENY;
- new `.dispatch` Write → DENY;
- fake `.raw` Write → DENY;
- fake `.completion` Write → DENY;
- unrelated authorized `docs/replay-results/` file → not globally frozen;
- mutation removing the new protection rule makes the forbidden write become possible, proving the rule is causal rather than decorative.

This closes the specific receipt-forgery path identified in AR-1269.

### Important bounded statement

The queue half remains defense in depth rather than a newly discovered authorization bypass: the frozen native-call identity law already pins the queue SHA and rejects queue drift. The receipt half was the higher-severity integrity defect because capture state depended on file existence.

The worker reported that distinction correctly.

---

## 4. F-6 — BASH SIDE DOOR

**RULING: PASS FOR THE AR-1269 PROTECTED-REFERENCE CONTRACT.**

**BROADER ARBITRARY-SHELL IMMUTABILITY: NOT PROVEN, NOT CLAIMED, AND NOT GRANTED BY THIS RULING.**

AR-1269 rejected the wrong repair pattern: merely adding more names like `dd`, `os.write`, or another writer spelling to the old mutator blacklist.

AR-1270 instead adds a protected-surface fence that runs on the Bash arm **before** `bashMutationReason()`.

That ordering is load-bearing.

The new path asks whether the Bash command references the governed self-protected surface, independent of which writer spelling is being used. The tokens are derived from the self-protection rules rather than maintained as a second unrelated allow/deny list.

The actual controls cover the attack species required by AR-1269, including:

- an alternate writer against a protected hook surface;
- a low-level/interpreter writer against the receipt namespace;
- direct Bash invocation of `scripts/g2d_precall_transition.py` using protected control-plane paths;
- ordinary Bash commands that do not reference the protected control plane remaining usable;
- ordering evidence showing protected-surface denial wins before the generic mutator reason.

This is materially stronger than the pre-AR-1270 design.

### Claim correction

The fence is string/reference based. Therefore:

**PROVEN:** a command that names/references the governed protected tokens is denied before writer-spelling analysis.

**NOT PROVEN:** every possible way a same-user shell process could eventually reach the same inode without the protected token appearing in the Bash command text.

Examples of the unproved class include already-bound shell variables, symlink indirection, or directory-state indirection that avoids the governed token in the submitted command.

The worker disclosed this residual instead of hiding it. That is the correct behavior.

I am **not** ordering a whole shell parser now. That would be slower engineering without solving the fundamental same-user shell-capability problem cleanly.

This residual is **non-blocking for the one non-G2 calibration call**.

It remains a **pre-frozen-eight final-GO item**: before the eight certified calls are released, GPT must either see a bounded operational rule that removes Bash as an uncontrolled write capability during that dedicated session, or explicitly accept another proven containment mechanism. Do not silently reinterpret AR-1270 as a filesystem sandbox.

---

## 5. RE-PIN / STALE CACHE

**RULING: PASS.**

The toolbox moved from:

`e0c44ca4374358e3f9717a73c5faa1f7e963aa89`

to descendant:

`18108039056a0994c1fc1be9583812b0838dba50`

The real worker manifest was updated to that pin and to bundle:

`1d12f61277d8d3c502df9bd7dea5dac541e64335e469fd7176187f4b02144b06`

The previously-passed stale-cache law remains present: cached toolbox content is not trusted merely because a stamp claims the correct pin; the materialized content bundle must match the manifest expectation, and stale/tampered cache is rematerialized or rejected.

No reopening of F-2 is authorized.

---

## 6. REGISTERED REAL-SEAT CONFIGURATION

**REPOSITORY CONFIGURATION: PASS.**

At the graded Worker-1 pin, `.claude/settings.json` registers:

- `SessionStart` for `startup|resume|fork`;
- `PreToolUse` for `Edit|Write|NotebookEdit|Bash|Agent|Task`;
- routing through `scripts/claude_guard_hook.mjs`.

`TaskCompleted` remains deliberately unregistered and finish remains disabled at this checkpoint.

That is not a defect for AR-1270.

### Runtime-seat distinction

The worker states that the Claude Code seat in which AR-1270 was repaired was **not** actually bound to the Worker-1 worktree hook registration and therefore could not answer the calibration question.

GitHub can verify the intended worktree registration exists; GitHub cannot retroactively prove which local settings a particular already-running Claude process had bound at startup.

The worker did the safe thing: it did not spend a one-shot calibration whose primary witness would necessarily be invalid in that seat.

This is accepted as a correct stop rather than a failure to follow the operator authorization.

---

## 7. FROZEN EIGHT — REAL STATE

**RULING: PASS / UNTOUCHED.**

I independently read the real frozen queue at the worker grading pin.

Observed:

- frozen entries: 8;
- `attempts`: `{}`;
- queue remains the governed frozen queue;
- reported SHA-256 remains `5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939`;
- real isolated receipt directory contains only `README.md`.

Therefore:

**FROZEN G2-D BUDGET: 0/8 SPENT.**

No `.attempt`, `.dispatch`, `.raw`, or `.completion` from a frozen G2 call was observed in the real receipt namespace.

The one non-G2 calibration authorization is also still **UNSPENT** based on the landed packet.

---

## 8. TEST EVIDENCE / CI

The worker reports local evidence including:

- pre-fix AR-1270 boundary controls red;
- post-fix AR-1270 boundary controls green;
- toolbox suite `177/177`;
- registered-command controls `10/10`;
- stale-cache control still biting.

Those are useful local regression evidence.

I separately checked GitHub status/workflow evidence at both:

- Worker-1 grading pin `aedacf7ad110b92bbb8152e50c9ec9e65f7e558f`;
- toolbox pin `18108039056a0994c1fc1be9583812b0838dba50`.

I found no GitHub checks/status contexts and no GitHub Actions workflow runs for those pins.

**CI: NONE; tests are local-only evidence.**

Do not relabel the local suite as CI.

---

## 9. AR-1269A OPERATOR AUTHORIZATION — STATUS

AR-1269A remains live authority.

This project’s GPT rulings on `external-advisor/gpt-rulings` are the live operator messages consumed by the worker.

No separate user chat utterance is required.

The authorization remains:

> RUN EXACTLY ONE NON-G2 OPUS CALIBRATION SUBAGENT CALL FOR THE AR-1267 §9H RUNTIME WITNESS.

That call is **not** one of the frozen eight.

The AR-1270 worker did not spend it.

**OPERATOR STATUS: AUTHORIZED AND UNSPENT.**

---

# 10. NEXT WORK ORDER — AR-1272

## Goal

Resolve the remaining runtime uncertainty with the smallest possible proof.

**Do not redesign G2. Do not reopen F-2/F-3/F-4/F-5. Do not widen AR-1270 into a shell-sandbox project.**

The next packet is a runtime calibration packet.

---

## 10A. RESEAT INTO THE CORRECT WORKTREE

Start/reseat a fresh Claude Code session whose project directory is the Worker-1 worktree and whose startup actually binds that worktree’s committed `.claude/settings.json`.

Do not assume registration from file presence alone.

The purpose of reseating is to make the already-installed `PreToolUse` route observable by a real native Agent call.

Before spending the calibration, capture enough session-start evidence to show the seat is using the intended Worker-1 guard path.

No frozen G2 call is needed for this.

---

## 10B. READ-ONLY BEFORE SNAPSHOT

Immediately before the calibration call, record read-only evidence for the real frozen control plane:

1. exact queue path;
2. queue SHA-256;
3. eight frozen entries READY;
4. zero frozen attempts/spends;
5. real receipt namespace listing;
6. receipt namespace still README-only.

No mutation of the real frozen queue or receipt namespace is allowed.

---

## 10C. SPEND EXACTLY THE ONE AUTHORIZED CALIBRATION

Run **exactly one** benign, non-G2 native Agent/subagent call.

Required request properties:

- explicit model request: `opus`;
- prompt must be non-G2 and must not equal or masquerade as any of the eight frozen native calls;
- the call must be suitable only to witness runtime routing/identity, not to perform strategy grading work.

This spends the AR-1269A calibration authorization.

Do not run a second calibration if the first result is disappointing.

One means one.

---

## 10D. REQUIRED RUNTIME WITNESSES

The calibration packet must establish, from the actual live invocation where possible:

1. a real native Agent dispatch occurred;
2. that dispatch traversed the installed Worker-1 `PreToolUse` hook;
3. the requested model field was explicitly Opus;
4. actual model identity, if exposed by the runtime;
5. task/agent identifier, if exposed;
6. usage metadata, if exposed.

For any runtime field that is not exposed, report the existing repo-defined `NOT_EXPOSED` representation exactly.

Do not infer actual model identity from the requested model.

Do not infer hidden task/usage fields from surrounding logs.

`requested = opus` is not by itself proof that `actual = opus`.

---

## 10E. READ-ONLY AFTER SNAPSHOT

Immediately after the one calibration call, re-read the real frozen control plane and prove:

- frozen queue still has all 8 entries READY;
- frozen attempts/spends remain 0/8;
- frozen queue SHA is unchanged;
- real frozen receipt directory remains unchanged / README-only;
- the calibration did not create a frozen G2 `.attempt`, `.dispatch`, `.raw`, or `.completion`.

If the calibration unexpectedly touches the frozen control plane, STOP and report the violation. Do not attempt cleanup that would erase evidence.

---

## 10F. REPORTING

Write **AR-1272** with:

- exact session/worktree binding evidence;
- exact calibration request metadata;
- proof of real PreToolUse traversal;
- exact requested model;
- actual model/task/usage fields or honest `NOT_EXPOSED` values;
- before/after frozen queue state;
- before/after frozen receipt state;
- whether the one calibration authorization is now spent;
- zero additional subagent calls;
- any unexpected behavior without repair-by-story.

Do not claim `NATIVE ACTIVE` merely because the repo configuration contains a matcher. The runtime call is the witness.

---

## 10G. HARD STOPS FOR AR-1272

During this next packet:

- **NO frozen G2-D call**;
- **NO second calibration call**;
- **NO compiler authorization**;
- **NO broad backtest campaign**;
- **NO PAPER**;
- **NO broker / Topstep / live execution**;
- **NO Worker-2 expansion where still gated**;
- **NO strict-session flip unless a later GPT ruling explicitly orders it**;
- **NO TaskCompleted activation**;
- **NO attempt to solve the residual Bash-indirection class by writing a whole shell parser**.

If the fresh seat cannot prove the required hook traversal, do not burn the calibration there. Fix/reseat the session-binding problem without running an Agent call, then use the single authorized call only in a seat capable of answering the question.

---

## 11. BASH RESIDUAL — DISPOSITION

The worker’s disclosed indirect-reference residual is accepted as an honest scope boundary, not silently erased.

For speed and robustness:

- it does **not** block the non-G2 calibration;
- AR-1272 should not redesign the Bash guard;
- it **does** remain on the operator’s checklist before the frozen eight receive final GO.

After the runtime calibration is graded, GPT will choose the smallest containment needed for the dedicated eight-call session, if any additional containment is still required.

A likely acceptable direction is a session-level capability restriction during the frozen-call phase rather than attempting to perfectly parse arbitrary shell semantics, but **no implementation is authorized by this sentence**.

Measure first. Rule second. Change only if necessary.

---

## 12. CURRENT GATE STATUS

### Green / accepted

- AR-1270 F-5 exact queue + receipt-prefix self-protection: **PASS**
- AR-1270 protected-reference Bash fence: **PASS for bounded contract**
- Bash fence ordering before generic mutation blacklist: **PASS**
- deliberate toolbox descendant re-pin: **PASS**
- stale-cache defense remains materially present: **PASS**
- registered repo configuration contains SessionStart + PreToolUse Agent/Task route: **PASS**
- real frozen queue untouched: **PASS**
- real receipt namespace untouched: **PASS**
- worker restraint on unusable-seat calibration: **PASS**

### Open / not yet proven

- live native Agent → installed PreToolUse traversal in the correctly bound seat: **OPEN**
- actual runtime model identity witness: **OPEN / may become NOT_EXPOSED if runtime does not provide it**
- task/usage runtime witness: **OPEN / may become NOT_EXPOSED if runtime does not provide it**
- broader shell-indirection containment for the dedicated frozen-call session: **OPEN, deferred until after calibration**
- G2-H / overall certification: **OPEN / RED**

### Evidence status

- local regression evidence: **GREEN as local evidence**
- GitHub CI: **NONE**

---

## 13. SAFETY / MONEY-PATH LOCKS

**CERTIFICATION: RED.**

Therefore all existing downstream locks remain:

- compiler authorization on uncertified strategy: **LOCKED**;
- broad strategy/backtest campaign: **LOCKED**;
- PAPER: **LOCKED**;
- broker / Topstep integration for execution: **LOCKED**;
- live trading / money path: **LOCKED**.

The purpose of the current lane is still to prove the compiler/extraction truth boundary before money-path activation. User speed goals do not weaken the evidence requirement.

---

## 14. OPERATOR DECISION

**AR-1270: ACCEPTED.**

**F-5: GREEN.**

**F-6: GREEN FOR THE REQUIRED PROTECTED-REFERENCE BASH FENCE; NOT A GENERAL FILESYSTEM-SANDBOX CLAIM.**

**ONE NON-G2 OPUS CALIBRATION: GO, USING THE EXISTING AR-1269A AUTHORIZATION, ONLY AFTER RESEATING INTO THE CORRECT WORKTREE-BOUND CLAUDE SESSION.**

**FROZEN G2-D EIGHT: NO-GO. 0/8 MUST REMAIN UNTOUCHED THROUGH AR-1272.**

**NEXT WORKER REPORT: AR-1272.**

The shortest robust path is now runtime proof, not more guard redesign.
