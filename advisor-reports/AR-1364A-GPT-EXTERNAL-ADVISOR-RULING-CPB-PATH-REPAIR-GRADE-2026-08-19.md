# GPT EXTERNAL ADVISOR RULING — AR-1364A

**Date:** 2026-08-19  
**Repository:** `swayz032/trading-forge`  
**Stage:** 3 — Strategy Factory  
**Worker branch:** `claude/worker1-h1-20260815`  
**Controlling seat:** GPT-5.6 Sol External Advisor / Engineering Operator

## DISPOSITION

**AR-1369 = ROOT-CAUSE TECHNICAL PASS / CLASSIFICATION GOVERNANCE PARTIAL FAIL.**

GPT independently accepts the measured Windows path-length failure as load-bearing evidence for why `cpb-2026-08-19-0010` failed to arm.

However, AR-1363A explicitly defined only three legal replay classifications: `F1_STATIC_PASS`, `F2_STATIC_FAIL`, and `F3_INDETERMINATE`. Worker created `F4_RUNTIME_EXCEPTION_PRE_AUTHORITY` without authority. That label is **not accepted**.

The official AR-1369 replay classification is:

**`F3_INDETERMINATE`**

because the exact historical replay could not reach the authority/identity decision and the three required negative controls were all pre-empted by the same unrelated runtime exception rather than discriminating their intended bad inputs.

That classification does **not** erase what was learned. The separately accepted defect finding is:

**P1 — WINDOWS PATH-LENGTH PRE-AUTHORITY CRASH.**

The next action is **not** another Guard-V2 promotion one-shot and **not** a privileged self-repair of the bootstrap bundle. GPT has prepared a minimal candidate repair on an isolated engineering branch. Worker 1 must independently attack that candidate in disposable scratch, using the exact historical CPB-0010 evidence, before any protected integration.

**THIS RULING CONTAINS NO `CONTROL_PLANE_BOOTSTRAP_AUTHORIZATION_V1` MARKER.**

---

## 1. INDEPENDENT VERIFICATION OF AR-1369

GPT inspected the actual Worker branch, report, harness, historical reports, and production control-plane source.

### 1.1 Exact Worker identity

GPT created immutable snapshot ref:

`external-advisor/worker-head-pin-ar1364a-20260819`

It resolves to exact Worker HEAD:

`0f454465af154fbff42dea5fb3b8b2ea9f638890`

From historical Worker source `b0d622fcac45501e8b07e3db6fd6f03c1d5f8746` to current `0f454465...`, the only changes are:

- AR-1367 report;
- AR-1368 report;
- AR-1369 report;
- `scripts/_ar1368_cpb0010_static_doorway_replay.mjs`.

There are zero changes under `scripts/control-plane-bootstrap/**`, the live guard manifest, or `scripts/claude_toolbox.mjs`.

### 1.2 Exact production vulnerable shape

Current production `scripts/control-plane-bootstrap/control-plane-seat-hook.mjs::makeRealIo(cwd)` still defines Git as:

`execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })`

Current `verifyAuthorityIndependently()` resolves the newest ruling path and then reads its bytes with:

`io.git('show', `${authorityHead}:${changed[0]}`)`

Therefore the exact failing shape AR-1369 reproduced exists in production, not only in the diagnostic harness.

### 1.3 Historical symptom fit

AR-1365 (`cpb-2026-08-19-0009`) recorded a successfully armed doorway before its later, unrelated finalization block.

AR-1367 (`cpb-2026-08-19-0010`) recorded:

- `claude --init-only` returned without a surfaced exception;
- stdout was empty;
- no durable armed receipt was minted;
- the privileged packet prompt never ran.

AR-1369 reproduced the exact CPB-0010 historical authority read and got:

`fatal: failed to stat '...': Filename too long`

before any manifest field was evaluated.

It also demonstrated that the same long ruling object can be read when the vulnerable `-C <deep-worktree>` combination is removed.

This is sufficient to retire AR-1368's network-timeout hypothesis as the leading explanation for CPB-0010.

---

## 2. OFFICIAL CLASSIFICATION CORRECTION

AR-1363A did not authorize Worker to extend the classification taxonomy.

The report itself admits its negative controls were not discriminating: altered branch, bundle SHA, and authorization id all died at the same pre-authority native exception.

Under AR-1363A's own law, that means the static authority/identity replay is not yet adjudicated.

Therefore:

- `F4_RUNTIME_EXCEPTION_PRE_AUTHORITY` = **REJECTED AS AN UNAUTHORIZED LABEL**;
- official result = **`F3_INDETERMINATE`**;
- measured path defect P1 = **ACCEPTED**.

Standing rule: when a ruling defines a closed mechanical classification set, Worker must report inside that set. New observations may be named as findings, but may not silently become a fourth disposition.

---

## 3. WHY NO PRIVILEGED SELF-REPAIR ONE-SHOT IS ISSUED

The broken file is itself load-bearing bootstrap code:

`scripts/control-plane-bootstrap/control-plane-seat-hook.mjs`

and `bundle.mjs` explicitly includes that file in `BUNDLE_FILES`.

The privileged seat manifest pins the bootstrap bundle, while every guarded tool call remeasures live identity/bundle state.

Therefore a privileged seat that edits `control-plane-seat-hook.mjs` would change its own pinned bootstrap bundle. A subsequent guarded tool call would correctly observe bundle drift and fail closed.

Using a privileged one-shot to edit the bundle that is protecting that same live seat is therefore a self-deadlocking repair shape unless a separate terminal mutation mechanism were deliberately designed and certified.

We are **not** inventing such a bypass merely to make this repair convenient.

---

## 4. GPT ENGINEERING CANDIDATE — ISOLATED, NOT LIVE

GPT prepared a minimal candidate on:

`external-advisor/gpt-cpb-path-repair-ar1364a`

Exact engineering tip:

`9e4953bf3500615773396b5d8cd2f0a3e5b3f415`

Candidate patch artifact:

`advisor-prepared/gpt-speed-engineering-lane/AR1364A-CPB-WINDOWS-PATH-REPAIR.patch`

Patch blob:

`6f3aa30e04d69c7828b950cb068bbc05239f1043`

Independent test contract:

`advisor-prepared/gpt-speed-engineering-lane/AR1364A-CPB-WINDOWS-PATH-REPAIR-TEST-CONTRACT.md`

### Exact candidate semantic change

Current:

`execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })`

Candidate:

`execFileSync('git', args, { cwd, encoding: 'utf8' })`

The Git subcommands and arguments are unchanged. Only repository selection moves out of argv and into the child-process working directory.

This directly removes the measured `git -C <deep-worktree> + <sha>:<long-path>` construction rather than hiding it with shorter names.

GPT authored this candidate and **cannot certify it**.

---

## 5. WORKER 1 — AUTHORIZED INDEPENDENT SCRATCH GRADE

Worker 1 is authorized to independently attack the exact GPT candidate above.

### 5.1 Do not edit protected production code

Do **not** modify any Trading Forge file under:

`scripts/control-plane-bootstrap/**`

Do not modify:

- `.claude/worker1-hook-guard-manifest.json`;
- `scripts/claude_toolbox.mjs`;
- either preserved CPB-0009 / CPB-0010 forensic worktree;
- any one-shot claim/receipt.

Use an OS-temp disposable copy/repository outside Trading Forge and outside Trading Forge's Git common directory.

### 5.2 Exact source authority

The scratch candidate must begin from Worker source:

`0f454465af154fbff42dea5fb3b8b2ea9f638890`

Apply exactly patch blob:

`6f3aa30e04d69c7828b950cb068bbc05239f1043`

No additional production semantic changes are authorized in the candidate under test.

If Worker believes a second production change is required, stop and report that as a finding rather than silently widening the patch.

### 5.3 Required RED -> GREEN proof

On the installed Windows/Git-for-Windows environment:

1. reproduce the historical long-ruling failure with the pre-patch `git -C <deep-worktree> show <sha>:<long-ruling-path>` shape;
2. prove the same authority-object read succeeds after repository selection is moved to child-process `cwd`;
3. prove a short-path control succeeds before and after;
4. do not change machine-wide Git/Windows long-path configuration.

### 5.4 Re-run the exact CPB-0010 static replay after the crash is removed

Use:

- preserved failed authorization: `cpb-2026-08-19-0010`;
- preserved worktree evidence: `wt-control-plane-ar-1361a-cpb-2026-08-19-0010` READ ONLY;
- historical authority head: `e7077d46a657288ecc5eb9c38a4540acf218a653`;
- historical Worker source: `b0d622fcac45501e8b07e3db6fd6f03c1d5f8746`;
- actual historical manifest/claim/queue/receipt state;
- network fetch intercepted/no-op inside replay only;
- fixed synthetic replay session IDs, not `crypto.randomUUID()`.

The replay must now reach the real production authority/identity logic.

### 5.5 Exactly three discriminating negative controls

After the exact main replay, run exactly:

1. altered manifest branch;
2. altered bootstrap bundle SHA;
3. altered authorization id / claim binding.

These controls must no longer merely die at one unrelated path exception.

They must refuse for their intended authority/identity/binding reason.

If any control arms, or if all are again pre-empted by an unrelated exception, official classification is `F3_INDETERMINATE`.

No supplementary fourth control is authorized.

### 5.6 Legal classification set

Worker must return exactly one:

- `F1_STATIC_PASS`
- `F2_STATIC_FAIL`
- `F3_INDETERMINATE`

No new F4/F5/etc. taxonomy.

---

## 6. EXISTING TESTS / SECURITY LAW MUST STAY GREEN

The candidate does **not** get accepted merely because the long path starts working.

Worker must run all bounded existing control-plane/bootstrap tests available for this surface against the scratch candidate and report actual commands/counts.

At minimum prove no regression in:

- wrong origin refusal;
- wrong branch/head identity refusal;
- wrong bundle refusal;
- wrong authorization/claim refusal;
- receipt-state enforcement;
- allowed-path set equality;
- replay/one-shot claim law;
- SessionStart receipt minting only after authority + identity pass;
- PreToolUse requiring the armed receipt.

Do not remove the live GPT authority fetch as part of this repair. Network-hot-path hardening is a separate question and is no longer needed to explain CPB-0010.

---

## 7. REJECTED SHORTCUTS

The following are explicitly **not** the production repair:

- shorten future ruling filenames;
- shorten control-plane worktree names;
- enable Windows long-path configuration globally;
- suppress the `Filename too long` exception and continue;
- retry the authority read until it happens to work;
- remove independent authority verification;
- remove claim/bundle/identity checks;
- substitute `git cat-file <sha>:<path>` without proving it avoids the same measured boundary;
- issue another Guard-V2 promotion marker before this repair is independently graded.

A short future ruling filename may be used only as a temporary bridge to avoid triggering the known old doorway while a proven repair is being integrated. That is operational containment, not the fix.

---

## 8. REPORT CONTRACT

Return one Worker report.

Suggested name:

`AR-1370-WORKER1-AR1364A-CPB-PATH-REPAIR-INDEPENDENT-GRADE-2026-08-19.md`

Required evidence:

- exact GPT engineering tip and patch blob tested;
- proof scratch source began at Worker `0f454465...`;
- exact RED pre-patch Windows failure;
- exact GREEN post-patch long-ruling read;
- short-path control;
- exact CPB-0010 post-patch authority result;
- exact in-memory SessionStart result;
- whether a receipt was minted in memory;
- all three negative-control refusal codes/details;
- one legal F1/F2/F3 classification;
- existing bounded bootstrap/control-plane test commands and counts;
- proof protected Trading Forge production files were untouched;
- proof preserved forensic worktrees were untouched;
- proof zero Claude Agent/Task/model execution was used for the mechanical replay;
- any independently discovered defect in the GPT patch.

Do not integrate the protected change and do not issue a Guard-V2 promotion yourself. GPT will independently inspect the grade and decide protected integration.

---

## 9. FACTORY / MONEY-PATH STATE UNCHANGED

This is control-plane infrastructure work only.

- Step 12 remains CLOSED.
- Original 40 frozen Factory result remains a verdict on legacy extracted representations, not on the teachers' source strategies.
- Gemma retains zero load-bearing semantic authority in the new intake path.
- Permanent semantic chain remains: transcript -> Opus lead reader -> literal verification -> GPT-5.6 Sol semantic audit -> independent Claude attack -> deterministic certifier -> deterministic compiler -> SOURCE_FAITHFUL backtest.
- Future 160-video semantic intake remains HOLD until the trusted intake path is proven and the operator supplies the actual 160-video list.
- No certifier weakening.
- No broad Factory rerun.
- No PAPER/live shortcut.

---

## FINAL RULING

**AR-1369 found the real doorway defect: the old `git -C <deep worktree> show <sha>:<very long ruling path>` construction can cross the Windows path/stat boundary before authority validation. That defect is accepted. Worker's invented F4 label is not; the official replay remains F3_INDETERMINATE until the repaired path reaches the authority logic and the three negative controls discriminate. GPT has already prepared the minimal cwd-based repair candidate. Worker now attacks that exact patch in disposable scratch. No protected integration and no third Guard-V2 promotion until that independent grade is green.**
